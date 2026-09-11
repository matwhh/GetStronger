#!/usr/bin/env node
/*
 * ВІДНОВЛЕННЯ З РЕЗЕРВНОЇ КОПІЇ: backup-forge-*.json → SQL
 * =============================================================================
 * Бекап, з якого не відновлювались, — не бекап, а файл. Цей скрипт перетворює
 * експорт db/backup-export.sql на SQL-скрипт, який заливає дані назад.
 *
 *   node tools/restore-backup.mjs backup.json > restore.sql
 *   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f restore.sql
 *
 * ПРИНЦИПИ, ЯКІ ТУТ НАВМИСНО ЗАКЛАДЕНІ:
 *
 * 1. Скрипт нічого не видаляє. Жодного truncate, delete, drop. Відновлення в
 *    базу з даними — це `on conflict do nothing`: наявні рядки лишаються, з
 *    файла доливається те, чого бракує. Помилитись файлом і стерти живу базу
 *    тут неможливо.
 * 2. Одна транзакція. Або відновилось усе, або нічого — половина відновленої
 *    бази гірша за жодної.
 * 3. Скрипт перевіряє сам себе. У кінці — do-блок, який звіряє кількості рядків
 *    із `counts` файла і кидає виняток, якщо не збіглось. Мовчазний неповний
 *    restore неможливий.
 * 4. Порядок таблиць — за зовнішніми ключами. Спершу auth.users, далі все, що
 *    на них посилається. FK не вимикаються: якщо у файлі сирота, restore має
 *    впасти, а не створити рядок, що вказує в нікуди.
 * 5. Список колонок береться з самого файла, а не зашитий тут. Тому додана в
 *    продакшені колонка потрапляє у відновлення сама, а зникла — не ламає
 *    скрипт. Ціна: колонка, якої немає в цільовій схемі, дасть чесну помилку
 *    «column ... does not exist» замість тихої втрати даних.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Порядок = порядок зовнішніх ключів. Міняти лише разом зі схемою. */
export const TABLES = [
  { key: 'users',          target: 'auth.users' },
  { key: 'identities',     target: 'auth.identities' },
  { key: 'admins',         target: 'public.admins' },
  { key: 'account_status', target: 'public.account_status' },
  { key: 'profiles',       target: 'public.profiles' },
  { key: 'consent_log',    target: 'public.consent_log' },
  { key: 'season_state',   target: 'public.season_state' },
  { key: 'elo_events',     target: 'public.elo_events' },
  { key: 'season_history', target: 'public.season_history' },
  { key: 'awards',         target: 'public.awards' },
  { key: 'elo_week_plan',  target: 'public.elo_week_plan' },
  { key: 'elo_config',     target: 'public.elo_config' }
];

/* У format_version 1 цих ключів не було. Старий файл має відновлюватись —
 * саме на старий файл і розраховуєш у поганий день. */
const SINCE_V2 = new Set(['identities']);

const DOLLAR_TAG = 'forge_backup';

/**
 * Перевірка файла без бази. Кидає Error з людським текстом.
 * @param {any} b розібраний JSON бекапу
 * @returns {{version:number, rows:Record<string,number>, warnings:string[]}}
 */
export function validate(b) {
  const warnings = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    throw new Error('Це не обʼєкт бекапу: очікувався JSON-обʼєкт верхнього рівня.');
  }

  const version = b.format_version;
  if (version !== 1 && version !== 2) {
    throw new Error('Невідомий format_version: ' + JSON.stringify(version) + ' (підтримуються 1 і 2).');
  }
  if (typeof b.exported_at !== 'string' || !b.exported_at) {
    throw new Error('Немає exported_at — незрозуміло, що це за копія і коли знята.');
  }

  const rows = {};
  for (const t of TABLES) {
    if (version === 1 && SINCE_V2.has(t.key)) { warnings.push('format_version 1: немає ' + t.key); continue; }
    const arr = b[t.key];
    if (!Array.isArray(arr)) throw new Error('Ключ ' + t.key + ' відсутній або не масив.');
    rows[t.key] = arr.length;
  }

  /* counts — окремий, незалежний від масивів рахунок. Саме він ловить
   * обрізаний посеред запису файл: JSON тоді або не розбереться взагалі,
   * або масив коротший за свій лічильник. */
  const counts = b.counts;
  if (!counts || typeof counts !== 'object') throw new Error('Немає блоку counts.');
  for (const [k, n] of Object.entries(counts)) {
    if (!(k in rows)) continue;                  /* counts ширший за TABLES — не біда */
    if (rows[k] !== n) {
      throw new Error('counts.' + k + ' = ' + n + ', а в масиві ' + rows[k] + ' рядків — файл неповний.');
    }
  }
  for (const k of Object.keys(rows)) {
    if (!(k in counts)) warnings.push('counts не покриває ' + k);
  }

  if (!(counts.users >= 1)) {
    throw new Error('counts.users = ' + counts.users + '. Бекап без жодного користувача — це не бекап бази Get Stronger.');
  }

  /* Однорідність ключів: якщо рядки одної таблиці мають різні набори колонок,
   * значить файл склеєний із різних версій експорту, і insert нижче
   * побудується за першим рядком, тихо загубивши поля решти. */
  for (const t of TABLES) {
    const arr = b[t.key];
    if (!Array.isArray(arr) || arr.length < 2) continue;
    const first = Object.keys(arr[0]).sort().join(',');
    for (let i = 1; i < arr.length; i++) {
      const k = Object.keys(arr[i]).sort().join(',');
      if (k !== first) throw new Error(t.key + ': рядок #' + i + ' має інший набір колонок, ніж перший.');
    }
  }

  /* Попередження про sequences не залежить від версії: у format_version 1
   * блоку немає за визначенням, і саме тоді про нього треба сказати — інакше
   * після відновлення зі старого файла перший же insert упаде на дублікаті id,
   * і виглядатиме це як поломка застосунку, а не як наслідок бекапу. */
  if (!b.sequences || typeof b.sequences !== 'object') {
    warnings.push('немає блоку sequences — після відновлення перший insert може впасти на дублікаті id');
  }

  return { version, rows, warnings };
}

/**
 * @param {any} b розібраний JSON бекапу (уже пройшов validate)
 * @returns {string} SQL-скрипт відновлення
 */
export function buildSql(b) {
  const payload = JSON.stringify(b);
  if (payload.includes('$' + DOLLAR_TAG + '$')) {
    /* Практично неможливо, але мовчазне псування SQL — не той ризик,
     * який приймають заради одного рядка коду. */
    throw new Error('У даних трапився роздільник $' + DOLLAR_TAG + '$ — так екранувати не можна.');
  }

  const out = [];
  out.push('-- Згенеровано tools/restore-backup.mjs');
  out.push('-- Джерело: exported_at = ' + String(b.exported_at) + ', format_version = ' + b.format_version);
  out.push('-- Нічого не видаляє: усі вставки — on conflict do nothing.');
  out.push('');
  out.push('\\set ON_ERROR_STOP on');
  out.push('begin;');
  out.push('');
  out.push('create temporary table _forge_backup (j jsonb) on commit drop;');
  out.push("insert into _forge_backup values ($" + DOLLAR_TAG + "$" + payload + "$" + DOLLAR_TAG + "$::jsonb);");
  out.push('');

  for (const t of TABLES) {
    const arr = b[t.key];
    if (!Array.isArray(arr)) continue;
    out.push('-- ' + t.target + ': ' + arr.length + ' рядків');
    if (!arr.length) { out.push(''); continue; }
    const cols = Object.keys(arr[0]).map(quoteIdent);
    const list = cols.join(', ');
    out.push('insert into ' + t.target + ' (' + list + ')');
    out.push('select ' + list);
    out.push("from jsonb_populate_recordset(null::" + t.target + ", (select j -> '" + t.key + "' from _forge_backup))");
    out.push('on conflict do nothing;');
    out.push('');
  }

  const seqs = (b.sequences && typeof b.sequences === 'object') ? b.sequences : {};
  const seqNames = Object.keys(seqs).sort();
  if (seqNames.length) {
    out.push('-- Послідовності: без цього перший же insert після відновлення');
    out.push('-- впаде на дублікаті первинного ключа.');
    for (const name of seqNames) {
      const v = seqs[name];
      if (v === null || v === undefined) continue;
      if (!Number.isInteger(Number(v))) throw new Error('sequences.' + name + ' не ціле: ' + v);
      out.push("select setval(" + quoteLiteral('public.' + name) + ", " + String(Number(v)) + ", true);");
    }
    out.push('');
  } else {
    out.push('-- УВАГА: у файлі немає блоку sequences (format_version 1).');
    out.push('-- Після відновлення виконай вручну, інакше нові рядки конфліктуватимуть:');
    out.push("--   select setval('public.elo_events_id_seq',  (select max(id) from public.elo_events));");
    out.push("--   select setval('public.consent_log_id_seq', (select max(id) from public.consent_log));");
    out.push('');
  }

  /* Самоперевірка. Порівнюємо з counts файла, а не з довжинами масивів:
   * counts рахувала сама база під час експорту. */
  out.push('-- Самоперевірка: якщо відновилось не все — виняток і відкат усієї транзакції.');
  out.push('do $forge_check$');
  out.push('declare expected bigint; actual bigint;');
  out.push('begin');
  for (const t of TABLES) {
    const n = b.counts && b.counts[t.key];
    if (typeof n !== 'number') continue;
    out.push('  expected := ' + n + ';');
    out.push('  select count(*) into actual from ' + t.target + ';');
    out.push("  if actual < expected then raise exception '" + t.target +
      ": відновлено %, а в бекапі %', actual, expected; end if;");
  }
  out.push('end');
  out.push('$forge_check$;');
  out.push('');
  out.push('commit;');
  out.push('');
  return out.join('\n');
}

function quoteIdent(s) {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) return '"' + String(s).replace(/"/g, '""') + '"';
  return s;
}
function quoteLiteral(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/* ------------------------------------------------------------------ CLI -- */

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2).filter(function (a) { return a !== '--'; });
  const file = args[0];
  if (!file) {
    process.stderr.write('Використання: node tools/restore-backup.mjs <backup.json> [--out restore.sql]\n');
    process.exit(2);
  }
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    process.stderr.write('Файл не читається як JSON: ' + e.message + '\n');
    process.exit(1);
  }

  let info;
  try {
    info = validate(backup);
  } catch (e) {
    process.stderr.write('Бекап не пройшов перевірку: ' + e.message + '\n');
    process.exit(1);
  }
  info.warnings.forEach(function (w) { process.stderr.write('УВАГА: ' + w + '\n'); });

  const sql = buildSql(backup);
  if (outFile) {
    fs.writeFileSync(outFile, sql);
    process.stderr.write('Готово: ' + outFile + '\n');
  } else {
    process.stdout.write(sql);
  }
}
