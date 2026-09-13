#!/usr/bin/env node
/*
 * ПРАВА Й ПОЛІТИКИ: чи проходять справжні запити клієнта
 * =============================================================================
 * Навіщо цей файл існує. Міграція account_guards_and_data_shape забрала в
 * ролі authenticated право UPDATE на profiles і видала натомість колонкове
 * update(data). Задум був правильний — не давати клієнтові переписувати
 * created_at. Наслідок — зламане збереження профілю ЦІЛКОМ: PostgREST на
 * upsert виконує
 *
 *   insert into profiles (user_id, data) values (...)
 *   on conflict (user_id) do update set user_id = excluded.user_id, data = ...
 *
 * тобто пише і user_id. Без права на цю колонку сервер відповідає
 * 42501 permission denied — на КОЖНЕ збереження, мовчки для тестів і
 * голосно для людей.
 *
 * Жодна наявна перевірка цього не ловила: юніти працюють із підробленою
 * мережею, браузерні — з file:// і посадженим профілем, а RLS-матриця
 * дивиться на політики, не на GRANT. Тут перевіряються саме права: знімок
 * бойової схеми розгортається в тимчасовий локальний Postgres, і по ньому
 * від імені authenticated і anon виконуються РІВНО ті оператори, які шле
 * застосунок.
 *
 *   node tools/verify-schema-perms.mjs
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
const ok = (n, x) => { pass++; console.log('  ✓ ' + n + (x ? ' :: ' + x : '')); };
const bad = (n, x) => { fail++; console.log('  ✗ ' + n + '\n      ' + String(x).split('\n').slice(0, 3).join(' | ')); };

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
  console.log('\n  – ПРОПУЩЕНО: у системі немає Postgres, права перевірити нема на чому\n');
  process.exit(3);
}

const PRELUDE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (
  id uuid primary key, instance_id uuid, aud varchar, role varchar, email varchar,
  encrypted_password varchar, created_at timestamptz, updated_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists extensions;
create schema if not exists cron;
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-perm-'));
const data = path.join(dir, 'data'), sock = path.join(dir, 'sock');
const port = 5432 + 900 + Math.floor(Math.random() * 90);
let started = false;
const write = (n, c) => { const p = path.join(dir, n); fs.writeFileSync(p, c); if (RUN_AS) execFileSync('chmod', ['644', p]); return p; };
const psql = (args) => sh(q(PG_BIN + '/psql') + ' -h ' + q(sock) + ' -p ' + port + ' -U postgres -d postgres -v ON_ERROR_STOP=1 ' + args);
const val = (sql) => psql('-tAc ' + q(sql)).trim();
const run = (sql) => psql('-c ' + q(sql));

const A = '00000000-0000-4000-8000-0000000000aa';
const B = '00000000-0000-4000-8000-0000000000bb';

/**
 * Виконати оператор від імені ролі й сказати, чим це скінчилось.
 * Повертає 'OK', 'НУЛЬ РЯДКІВ' або 'ВІДМОВА <sqlstate>'.
 */
function asRole(uid, role, stmt) {
  const claims = uid ? `{"sub":"${uid}","role":"${role}"}` : `{"role":"${role}"}`;
  const sql = `
    do $probe$
    declare res text := 'OK';
    begin
      perform set_config('request.jwt.claims', '${claims}', true);
      set local role ${role};
      begin
        ${stmt}
        if not found then res := 'НУЛЬ РЯДКІВ'; end if;
      exception when others then res := 'ВІДМОВА ' || sqlstate;
      end;
      reset role;
      raise exception '%', res;
    end $probe$;`;
  try { run(sql); return 'БЕЗ ВИНЯТКУ'; }
  catch (e) {
    const m = /ERROR:\s+(?:P0001:\s+)?(OK|НУЛЬ РЯДКІВ|ВІДМОВА [0-9A-Z]+)/.exec(String(e.stderr || e.message));
    return m ? m[1] : String(e.stderr || e.message).split('\n')[0];
  }
}
const expect = (name, got, want) => {
  if (got === want) ok(name, got); else bad(name, 'отримано «' + got + '», очікувалось «' + want + '»');
};

console.log('\nПрава й політики: справжні запити клієнта по знімку бойової схеми\n');

try {
  fs.mkdirSync(data); fs.mkdirSync(sock); fs.chmodSync(dir, 0o711);
  if (RUN_AS) execFileSync('chown', ['-R', RUN_AS, dir]);
  sh(q(PG_BIN + '/initdb') + ' -D ' + q(data) + ' -U postgres -A trust -E UTF8 --locale=C');
  sh(q(PG_BIN + '/pg_ctl') + ' -D ' + q(data) + ' -o "-k ' + sock + " -h '' -p " + port + '" -l ' + q(path.join(dir, 'pg.log')) + ' -w start');
  started = true;

  psql('-f ' + q(write('prelude.sql', PRELUDE)));
  psql('-f ' + q(write('live.sql', fs.readFileSync(path.join(ROOT, 'db', 'live-schema.sql'), 'utf8'))));
  ok('знімок бойової схеми розгортається');

  for (const u of [A, B]) {
    run(`insert into auth.users (id, email, created_at) values ('${u}', '${u}@t', now());
         insert into account_status (user_id, status, username, decided_at)
         values ('${u}', 'approved', 'u${u.slice(-2)}', now());
         insert into profiles (user_id, data) values ('${u}', '{"weight":80}'::jsonb)`);
  }

  /* ---------------------------------------------------------------- профіль */
  expect('upsert профілю (саме те, що шле PostgREST) проходить',
    asRole(A, 'authenticated',
      `insert into profiles (user_id, data) values ('${A}', '{"weight":81}'::jsonb)
       on conflict (user_id) do update set user_id = excluded.user_id, data = excluded.data;`),
    'OK');

  expect('перший запис профілю (рядка ще немає) проходить',
    asRole(A, 'authenticated',
      `delete from profiles where user_id = '${A}';
       insert into profiles (user_id, data) values ('${A}', '{"weight":82}'::jsonb)
       on conflict (user_id) do update set user_id = excluded.user_id, data = excluded.data;`),
    'OK');

  expect('profile_patch (гілка keepalive, PRF-006) проходить',
    asRole(A, 'authenticated', `perform public.profile_patch('{"weight":83}'::jsonb);`),
    'OK');

  expect('читання свого профілю проходить',
    asRole(A, 'authenticated', `perform 1 from profiles where user_id = '${A}';`),
    'OK');

  expect('created_at клієнтові недоступний',
    asRole(A, 'authenticated', `update profiles set created_at = now() where user_id = '${A}';`),
    'ВІДМОВА 42501');

  expect('чужий профіль не видно',
    asRole(A, 'authenticated', `update profiles set data = '{"hacked":1}'::jsonb where user_id = '${B}';`),
    'НУЛЬ РЯДКІВ');

  expect('незалогінений профілів не читає',
    asRole(null, 'anon', `perform 1 from profiles limit 1;`),
    'ВІДМОВА 42501');

  /* ------------------------------------------------------------------ ELO */
  expect('elo_state доступна своєму користувачеві',
    asRole(A, 'authenticated', `perform public.elo_state(current_date);`),
    'OK');

  expect('elo_week_plan клієнтові закрита',
    asRole(A, 'authenticated', `perform 1 from elo_week_plan limit 1;`),
    'ВІДМОВА 42501');

  expect('elo_events напряму клієнт не пише',
    asRole(A, 'authenticated',
      `insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
       values ('${A}', 'X', current_date, 'training', 'workout', 'k', 1, 999, 0, 'вручну');`),
    'ВІДМОВА 42501');

  expect('season_state напряму клієнт не пише',
    asRole(A, 'authenticated', `update season_state set elo = 9999 where user_id = '${A}';`),
    'ВІДМОВА 42501');

  expect('elo_week_ready більше не доступна незалогіненому',
    asRole(null, 'anon',
      `perform public.elo_week_ready('${A}', current_date, '{}'::jsonb);`),
    'ВІДМОВА 42501');

  /*
   * І ЗАЛОГІНЕНОМУ ТЕЖ. Ця функція приймає uid ПАРАМЕТРОМ, а не бере
   * auth.uid(), і відповідає рядком про чужий акаунт: 'season_closed' —
   * людина закрила сезон, 'before_first_event' — подій у неї немає.
   * Тобто з грантом для authenticated будь-хто, хто знає чужий UUID,
   * дізнавався, чи грає та людина в сезоні.
   *
   * Грант там був не з міграції (db/elo-week-eval-fix.sql дає execute
   * ЛИШЕ service_role) — він лишився в базі від типового права PUBLIC.
   * Саме тому перевірка стоїть тут, а не в гігієні: розходження було між
   * файлом і БАЗОЮ, і файл про нього не знав.
   *
   * Серверні виклики від цього не страждають: elo_catch_up_weeks і
   * elo_eval_week_for самі SECURITY DEFINER, тобто ходять від власника.
   */
  expect('elo_week_ready не відповідає й залогіненому — вона службова',
    asRole(B, 'authenticated',
      `perform public.elo_week_ready('${A}', current_date, '{}'::jsonb);`),
    'ВІДМОВА 42501');

  /* ------------------------------------------------------------- адмінське */
  expect('не-адмін не дістає списку рейтингу',
    asRole(A, 'authenticated', `perform public.admin_elo_list(10);`),
    'ВІДМОВА P0001');

  /* SELECT на admins ролі authenticated виданий (потрібен is_admin), тож
     барʼєр тут — RLS, а не GRANT: не-адмін бачить нуль рядків. */
  expect('не-адмін не бачить у admins жодного рядка',
    asRole(A, 'authenticated', `perform 1 from admins limit 1;`),
    'НУЛЬ РЯДКІВ');
} catch (e) {
  bad('розгортання', (e && (e.stderr || e.message)) || e);
} finally {
  if (started) { try { sh(q(PG_BIN + '/pg_ctl') + ' -D ' + q(data) + ' -m immediate -w stop'); } catch (_) {} }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n' + pass + ' пройдено, ' + fail + ' впало\n');
process.exit(fail ? 1 : 0);
