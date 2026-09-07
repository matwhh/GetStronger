/**
 * FORGE — гігієна репозиторію.
 *
 * Юніт-тести перевіряють логіку. Цей скрипт перевіряє те, чого вони не
 * бачать: що саме лежить у репозиторії і що з цього роздається сайтом.
 * Приводом став реальний випадок — файл backup-forge-2026-09-01.json з
 * поштою й історією тренувань лежав у корені й віддавався по HTTP з
 * кодом 200. Тести були зелені: ламати там нічого.
 *
 * Запуск:  node tools/ci-hygiene.mjs
 * Код 1 — знайдено проблему (CI падає).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const problems = [];
const fail = (msg) => problems.push(msg);

/** Файли під контролем git — саме вони їдуть на GitHub і на Vercel. */
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/* ---- 1. Персональні дані в репозиторії ------------------------------ */
//
// Експорт акаунта містить пошту, історію тренувань і рейтинг. Такому
// файлу не місце ні в git, ні тим паче в корені сайту.
// Префікс перед словом теж ловиться: дамп бази зветься forge-backup-РРРР-ММ-ДД.json,
// і під старим шаблоном (лише початок імені) він проходив у репозиторій непоміченим.
const BACKUPS = /(^|\/)[a-z0-9_.-]*?(backup|бекап|export)[-_.].*\.json$/i;
for (const f of tracked.filter((f) => BACKUPS.test(f))) {
  fail(`експорт даних користувача у репозиторії: ${f}`);
}

/* ---- 2. Сміття ------------------------------------------------------ */
const JUNK = [/(^|\/)\.DS_Store$/, /^_to_delete\//, /\.zip$/i, /(^|\/)Thumbs\.db$/i];
for (const f of tracked) {
  if (JUNK.some((re) => re.test(f))) fail(`сміття у репозиторії: ${f}`);
}

/* ---- 3. Що сайт не має роздавати ------------------------------------ */
//
// db/ — міграції та схема; tools/ і tests/ — розробницьке;
// docs/ — звіти аудиту з описом кожної діри. Усе це лежить у git
// (приватний репозиторій), але на бойовий сайт потрапити не повинно.
// Vercel відсіює їх за .vercelignore — якщо рядок звідти зникне,
// файли почнуть віддаватись публічно й ніхто цього не помітить.
const MUST_IGNORE = ['db/', 'tools/', 'tests/', 'docs/'];
if (!existsSync('.vercelignore')) {
  fail('немає .vercelignore — сайт роздаватиме db/, tools/, tests/ і docs/');
} else {
  const lines = readFileSync('.vercelignore', 'utf8')
    .split('\n')
    .map((l) => l.trim());
  for (const need of MUST_IGNORE) {
    if (!lines.includes(need)) fail(`.vercelignore більше не приховує ${need}`);
  }
}

/* ---- 4. Ключі Supabase у фронтенді ---------------------------------- */
//
// anon-ключ публічний за задумом: його боронить RLS. service_role-ключ
// обходить RLS повністю — якщо він колись потрапить у js/, це негайний
// повний доступ до бази для кожного, хто відкриє сайт. Тому ключі не
// шукаються за назвою (вона нічого не значить), а розбираються як JWT:
// у корисному навантаженні має бути role: anon.
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
const TEXT = /\.(js|mjs|html|json|md|sql|css|command|yml|yaml|webmanifest)$/i;

for (const f of tracked.filter((f) => TEXT.test(f))) {
  let body;
  try {
    body = readFileSync(f, 'utf8');
  } catch {
    continue; // не текст — пропускаємо
  }
  for (const m of body.matchAll(JWT)) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    } catch {
      continue; // не розібрався — не наша справа
    }
    if (payload.role && payload.role !== 'anon') {
      fail(`у ${f} лежить ключ з роллю "${payload.role}" — у фронтенді дозволено лише anon`);
    }
  }
}

/* ---- 5. DSN Sentry без секрета -------------------------------------- */
//
// Публічний DSN виглядає як https://<ключ>@<хост>/<проєкт>. Старий формат
// із секретом (https://<ключ>:<секрет>@...) дозволяє не лише слати події.
if (existsSync('js/config.js')) {
  const conf = readFileSync('js/config.js', 'utf8');
  const dsn = conf.match(/dsn:\s*'([^']*)'/);
  if (dsn && dsn[1] && /^https:\/\/[^@/]+:[^@/]+@/.test(dsn[1])) {
    fail('DSN Sentry у js/config.js містить секретну частину — потрібен публічний DSN');
  }
}

/* ---- 6. Картка для месенджерів ---------------------------------------
 *
 * og:image мусить бути АБСОЛЮТНОЮ адресою. Відносний шлях Telegram ще
 * розбирає, а Facebook, LinkedIn, X і Slack — ні: там посилання лишалось
 * без картинки, і це не видно нізвідки, крім самої картки.
 * Домен звіряється з siteUrl у js/config.js — щоб при переїзді на свій
 * домен картинка не показувала старий.
 */
{
  const cfg = existsSync('js/config.js') ? readFileSync('js/config.js', 'utf8') : '';
  const m = cfg.match(/siteUrl:\s*'([^']*)'/);
  const site = m ? m[1].replace(/\/+$/, '') : '';
  for (const f of tracked.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    const img = html.match(/<meta property="og:image" content="([^"]*)"/);
    if (!img) continue;
    if (!/^https:\/\//.test(img[1])) {
      fail(`${f}: og:image "${img[1]}" — потрібна абсолютна адреса, інакше картка без картинки`);
    } else if (site && !img[1].startsWith(site + '/')) {
      fail(`${f}: og:image веде на ${img[1]}, а siteUrl у config.js — ${site}`);
    }
    const title = html.match(/<meta property="og:title" content="([^"]*)"/);
    if (!title || !title[1].trim()) fail(`${f}: порожній або відсутній og:title`);

    /*
     * Telegram завжди друкує в картці два рядки: синій — og:site_name,
     * жирний — og:title. Без site_name у синьому рядку стоїть голий
     * домен, а якщо обидва однакові — слово стоїть двічі поспіль.
     */
    const site_ = html.match(/<meta property="og:site_name" content="([^"]*)"/);
    if (!site_ || !site_[1].trim()) {
      fail(`${f}: немає og:site_name — у картці месенджера буде голий домен`);
    } else if (title && site_[1].trim() === title[1].trim()) {
      fail(`${f}: og:site_name і og:title однакові ("${title[1]}") — у картці слово стоятиме двічі`);
    }
  }
}

/* ---- підсумок -------------------------------------------------------- */
if (problems.length) {
  console.error('Гігієна репозиторію — знайдено проблеми:\n');
  for (const p of problems) console.error(`  ✕ ${p}`);
  console.error(`\n${problems.length} шт.`);
  process.exit(1);
}
console.log(`Гігієна репозиторію: чисто (${tracked.length} файлів перевірено).`);
