#!/usr/bin/env node
/*
 * SQL-ТЕСТИ СЕРВЕРА НА КОПІЇ СХЕМИ
 * =============================================================================
 * TST-017. db/elo-tests.sql, db/elo-integrity-tests.sql, db/multiuser-tests.sql
 * і db/sim-week.sql — це 90 перевірок авторитетного шару: атаки підробленим
 * payload, бюджети, реконсиляція, RLS, адмінські RPC. Досі вони виконувались
 * ЛИШЕ руками в SQL Editor, у репозиторії не було навіть сліду останнього
 * прогону, і в CI вони не входили. Тобто єдині тести того шару, де помилка
 * коштує найдорожче, ганялись «коли згадаємо».
 *
 * Тут вони ганяються машиною: знімок бойової схеми (db/live-schema.sql)
 * розгортається в тимчасовий локальний Postgres, і кожен файл виконується як
 * є. Кожен скрипт НАВМИСНО завершується raise exception — так він відкочує
 * все, що насіяв, і водночас віддає підсумок рядком «N з M пройдено».
 *
 *   node tools/verify-sql-suites.mjs
 *
 * Код виходу: 0 — усе пройшло, 1 — щось впало, 3 — немає Postgres.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.FORGE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;

const PG_BIN = (() => {
  const c = [];
  if (process.env.FORGE_PG_BIN) c.push(process.env.FORGE_PG_BIN);
  try { for (const v of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) c.push('/usr/lib/postgresql/' + v + '/bin'); } catch (_) {}
  c.push('/usr/local/bin', '/usr/bin', '/opt/homebrew/bin');
  for (const d of c) { try { if (fs.existsSync(path.join(d, 'initdb'))) return d; } catch (_) {} }
  return null;
})();
const RUN_AS = (typeof process.getuid === 'function' && process.getuid() === 0) ? 'postgres' : null;
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const sh = (cmd) => execFileSync(RUN_AS ? 'su' : 'bash', RUN_AS ? [RUN_AS, '-c', cmd] : ['-c', cmd],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (!PG_BIN) {
  console.log('\n  – ПРОПУЩЕНО: у системі немає Postgres\n');
  process.exit(3);
}

const PRELUDE = `
create extension if not exists pgcrypto;
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (
  id uuid primary key, instance_id uuid, aud varchar, role varchar, email varchar,
  encrypted_password varchar, created_at timestamptz default now(), updated_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
create schema if not exists extensions;
create schema if not exists cron;
`;

/* Порядок має значення лише в одному: sim-week заселяє десятьох і відкочує. */
const SUITES = [
  { file: 'db/elo-tests.sql',            tag: 'ELO-ТЕСТИ' },
  { file: 'db/elo-integrity-tests.sql',  tag: 'ELO-INTEGRITY' },
  { file: 'db/multiuser-tests.sql',      tag: 'MULTIUSER' },
  { file: 'db/sim-week.sql',             tag: 'SIM' },
  { file: 'db/close-season-tests.sql',    tag: 'ЗАКРИТТЯ СЕЗОНУ' }
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sql-'));
const data = path.join(dir, 'data'), sock = path.join(dir, 'sock');
const port = 5432 + 700 + Math.floor(Math.random() * 90);
let started = false;
const write = (n, c) => { const p = path.join(dir, n); fs.writeFileSync(p, c); if (RUN_AS) execFileSync('chmod', ['644', p]); return p; };
const psql = (args) => sh(q(PG_BIN + '/psql') + ' -h ' + q(sock) + ' -p ' + port + ' -U postgres -d postgres -v ON_ERROR_STOP=1 ' + args);

console.log('\nSQL-тести сервера на копії бойової схеми (TST-017)\n');

try {
  fs.mkdirSync(data); fs.mkdirSync(sock); fs.chmodSync(dir, 0o711);
  if (RUN_AS) execFileSync('chown', ['-R', RUN_AS, dir]);
  /* БЕЗ --locale=C: у ньому lower() не чіпає кирилицю, і перевірка
     «той самий нік іншим регістром теж зайнятий» падала б через локаль
     тимчасового кластера, а не через код. */
  /* БЕЗ --locale=C: у ньому lower() не чіпає кирилицю, і перевірка
     «той самий нік іншим регістром теж зайнятий» падала б через локаль
     тимчасового кластера, а не через код. */
  sh(q(PG_BIN + '/initdb') + ' -D ' + q(data) + ' -U postgres -A trust -E UTF8 --locale=C.UTF-8');
  sh(q(PG_BIN + '/pg_ctl') + ' -D ' + q(data) + ' -o "-k ' + sock + " -h '' -p " + port + '" -l ' + q(path.join(dir, 'pg.log')) + ' -w start');
  started = true;

  psql('-f ' + q(write('prelude.sql', PRELUDE)));
  psql('-f ' + q(write('live.sql', fs.readFileSync(path.join(ROOT, 'db', 'live-schema.sql'), 'utf8'))));
  console.log('  ✓ знімок бойової схеми розгортається');

  /*
   * Конфіг ELO. У знімку схеми лежить ТАБЛИЦЯ elo_config, але не її рядок —
   * дані в знімок не входять за задумом. Без рядка cfg усередині функцій
   * null, (cfg->>'x')::int теж null, і перший же insert падає на
   * quality not null — тобто скрипт помирав не там, де мав щось довести.
   * Беремо той самий файл, що й бойова база: db/elo-config.json.
   */
  const cfg = fs.readFileSync(path.join(ROOT, 'db', 'elo-config.json'), 'utf8');
  psql('-f ' + q(write('cfg.sql',
    "insert into public.elo_config (id, data) values (1, $fx$" + cfg + "$fx$::jsonb)\n" +
    "on conflict (id) do update set data = excluded.data;")));
  console.log('  ✓ конфіг ELO залито з db/elo-config.json');

  for (const s of SUITES) {
    const src = path.join(ROOT, s.file);
    if (!fs.existsSync(src)) { console.log('  ? ' + s.file + ' — файла немає'); continue; }
    let out = '';
    try {
      psql('-f ' + q(write(path.basename(s.file), fs.readFileSync(src, 'utf8'))));
      out = '(без винятку — скрипт мав завершитись raise exception)';
    } catch (e) {
      out = String(e.stderr || e.message);
    }
    /* Підсумок скрипт віддає рядком «TAG: N з M пройдено». */
    const m = new RegExp(s.tag + ':\\s+(\\d+)\\s+з\\s+(\\d+)').exec(out);
    if (!m) {
      fail++;
      console.log('  ✗ ' + s.file + ' — підсумку не знайдено\n      ' +
        out.split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 300));
      continue;
    }
    const got = Number(m[1]), all = Number(m[2]);
    if (got === all) { pass++; console.log('  ✓ ' + s.file.padEnd(30) + got + '/' + all); }
    else {
      fail++;
      const bad = out.split('\n').filter((l) => l.indexOf('FAIL ') !== -1).slice(0, 20);
      console.log('  ✗ ' + s.file.padEnd(30) + got + '/' + all + '\n      ' + bad.join('\n      '));
    }
  }
} catch (e) {
  fail++;
  console.log('  ✗ розгортання\n      ' + String((e && (e.stderr || e.message)) || e).split('\n').slice(0, 3).join(' | '));
} finally {
  if (started) { try { sh(q(PG_BIN + '/pg_ctl') + ' -D ' + q(data) + ' -m immediate -w stop'); } catch (_) {} }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n' + pass + ' наборів пройшло, ' + fail + ' впало\n');
process.exit(fail ? 1 : 0);
