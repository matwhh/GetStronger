/* Перевірка міграції на копії бойової схеми. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT = process.cwd();
let pass = 0, fail = 0;
const ok = (n, x) => { pass++; console.log('  ✓ ' + n + (x ? ' :: ' + x : '')); };
const bad = (n, x) => { fail++; console.log('  ✗ ' + n + '\n      ' + String(x).split('\n').slice(0,3).join(' | ')); };
const check = (n, fn) => { try { fn(); ok(n); } catch (e) { bad(n, (e && (e.stderr || e.message)) || e); } };
const PG_BIN = fs.readdirSync('/usr/lib/postgresql').sort().reverse().map(v => '/usr/lib/postgresql/'+v+'/bin')[0];
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
/* Postgres не запускається від root — під ним і команди, і файли мусять
   належати postgres. Той самий прийом, що в tools/verify-elo-week.mjs. */
const RUN_AS = (typeof process.getuid === 'function' && process.getuid() === 0) ? 'postgres' : null;
const sh = (c) => execFileSync(RUN_AS ? 'su' : 'bash', RUN_AS ? [RUN_AS, '-c', c] : ['-lc', c],
  { encoding: 'utf8' });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skip-'));
const data = path.join(dir, 'd'), sock = path.join(dir, 's');
const port = 7100 + Math.floor(Math.random()*300);
const write = (n, c) => { const p = path.join(dir, n); fs.writeFileSync(p, c); if (RUN_AS) execFileSync('chmod',['644',p]); return p; };
const psql = (a) => sh(q(PG_BIN+'/psql')+' -h '+q(sock)+' -p '+port+' -U postgres -d postgres -v ON_ERROR_STOP=1 '+a);
const val = (s) => psql('-tAc '+q(s)).trim();
const run = (s) => psql('-c '+q(s));
const PRELUDE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (
  id uuid primary key, instance_id uuid, aud varchar, role varchar, email varchar,
  encrypted_password varchar, created_at timestamptz, updated_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;
create schema if not exists extensions;
`;
let started = false;
try {
  fs.mkdirSync(data); fs.mkdirSync(sock); fs.chmodSync(dir, 0o711);
  if (RUN_AS) execFileSync('chown', ['-R', RUN_AS, dir]);
  sh(q(PG_BIN+'/initdb')+' -D '+q(data)+' -U postgres -A trust -E UTF8 --locale=C');
  sh(q(PG_BIN+'/pg_ctl')+' -D '+q(data)+' -o "-k '+sock+" -h '' -p "+port+'" -l '+q(path.join(dir,'pg.log'))+' -w start');
  started = true;
  psql('-f '+q(write('p.sql', PRELUDE)));
  psql('-f '+q(write('live.sql', fs.readFileSync(path.join(ROOT,'db','live-schema.sql'),'utf8'))));
  ok('знімок схеми розгортається');
  psql('-f '+q(write('skip.sql', fs.readFileSync(path.join(ROOT,'db','elo-skip-category.sql'),'utf8'))));
  ok('міграція накочується');

  const A = '00000000-0000-4000-8000-0000000000a1';
  const B = '00000000-0000-4000-8000-0000000000b1';
  const CFG = fs.readFileSync(path.join(ROOT,'db','elo-config.json'),'utf8');
  run(`insert into elo_config (id, data) values (1, ${"$$"}${CFG}${"$$"}::jsonb) on conflict (id) do update set data = excluded.data`);
  for (const u of [A, B]) {
    run(`insert into auth.users (id, email) values ('${u}','${u}@t');
         insert into account_status (user_id, status, username) values ('${u}','approved','u'||'${u.slice(-2)}')`);
  }
  run(`insert into profiles (user_id, data) values ('${A}', '{}'::jsonb)`);
  run(`insert into profiles (user_id, data) values ('${B}', '{"eloSkip":["nutrition"]}'::jsonb)`);

  check('без вимикача конфіг не міняється', () => {
    const w = val(`select (public.elo_cfg_for('${A}', (select data from elo_config where id=1))#>>'{weights,nutrition}')`);
    if (w !== '0.3') throw new Error('вага ' + w);
  });

  check('з вимикачем категорія зникає', () => {
    const w = val(`select coalesce(public.elo_cfg_for('${B}', (select data from elo_config where id=1))#>>'{weights,nutrition}', 'НЕМА')`);
    if (w !== 'НЕМА') throw new Error(w);
  });

  check('сума ваг лишається одиницею', () => {
    const sum = val(`select round(sum(value::numeric), 4) from jsonb_each_text(
      public.elo_cfg_for('${B}', (select data from elo_config where id=1))->'weights')`);
    if (Number(sum) !== 1) throw new Error('сума ' + sum);
  });

  check('тренування дорожчає рівно на вивільнену частку', () => {
    const w = val(`select public.elo_cfg_for('${B}', (select data from elo_config where id=1))#>>'{weights,training}'`);
    if (Math.abs(Number(w) - 0.3/0.7) > 1e-5) throw new Error(w);
  });

  check('вартість того самого тренування вища без харчування', () => {
    const one = (u) => val(`select delta from elo_action_delta('workout',
      '{"done":14,"total":14}'::jsonb, public.elo_cfg_for('${u}', (select data from elo_config where id=1)), 4, false, 0)`);
    const a = Number(one(A)), b = Number(one(B));
    if (!(b > a)) throw new Error(a + ' → ' + b);
    if (Math.abs(b / a - 1/0.7) > 0.02) throw new Error('очікувалось ×1,43, вийшло ×' + (b/a).toFixed(3));
  });

  /*
   * Головне про дірку: стеля тижня НЕ ЗАЛЕЖИТЬ від категорій. Тому
   * перемикати вимикач посеред сезону немає сенсу — більше за спільну
   * стелю не взяти, хоч як поділи ваги.
   */
  check('дірку не зробили: тижнева стеля однакова з вимикачем і без', () => {
    const room = (u) => val(`select public.elo_week_room('${u}', current_date,
      public.elo_cfg_for('${u}', (select data from elo_config where id=1)))`);
    if (room(A) !== room(B)) throw new Error(room(A) + ' проти ' + room(B));
  });

  check('вимкнути все неможливо — конфіг лишається цілим', () => {
    run(`update profiles set data = '{"eloSkip":["training","nutrition","sleep","recovery","activity"]}'::jsonb where user_id = '${B}'`);
    const sum = val(`select round(sum(value::numeric), 4) from jsonb_each_text(
      public.elo_cfg_for('${B}', (select data from elo_config where id=1))->'weights')`);
    if (Number(sum) !== 1) throw new Error('сума ' + sum);
    run(`update profiles set data = '{"eloSkip":["nutrition"]}'::jsonb where user_id = '${B}'`);
  });

  check('сміття в eloSkip нічого не ламає', () => {
    for (const junk of ['"ні"', '123', '{"a":1}', '["вигадана"]']) {
      run(`update profiles set data = jsonb_build_object('eloSkip', $$${junk}$$::jsonb) where user_id = '${B}'`);
      const sum = val(`select round(sum(value::numeric), 4) from jsonb_each_text(
        public.elo_cfg_for('${B}', (select data from elo_config where id=1))->'weights')`);
      if (Number(sum) !== 1) throw new Error(junk + ' → сума ' + sum);
    }
    run(`update profiles set data = '{"eloSkip":["nutrition"]}'::jsonb where user_id = '${B}'`);
  });

  /* Чистий день: три категорії замість чотирьох. */
  check('чистий день без харчування дається за три категорії', () => {
    const day = val(`select current_date - 1`);
    const szn = val(`select season_of('${day}'::date)`);
    run(`insert into season_state (user_id, season, elo) values ('${B}', '${szn}', 100)
         on conflict (user_id, season) do update set elo = 100`);
    for (const [cat, ev] of [['sleep','sleep'],['recovery','recovery'],['activity','activity']]) {
      run(`insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
           values ('${B}','${szn}','${day}','${cat}','${ev}','${ev}:${day}', 1, 3, 100, 'test')`);
    }
    run(`select public.elo_try_clean_day('${B}', '${szn}', '${day}'::date, (select data from elo_config where id=1), 4, false)`);
    const n = val(`select count(*) from elo_events where user_id = '${B}' and event_type = 'cleanday' and day = '${day}'::date`);
    if (n !== '1') throw new Error('бонусів: ' + n);
  });

  check('а зі щоденником їжі трьох категорій не досить', () => {
    const day = val(`select current_date - 1`);
    const szn = val(`select season_of('${day}'::date)`);
    run(`insert into season_state (user_id, season, elo) values ('${A}', '${szn}', 100)
         on conflict (user_id, season) do update set elo = 100`);
    for (const [cat, ev] of [['sleep','sleep'],['recovery','recovery'],['activity','activity']]) {
      run(`insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
           values ('${A}','${szn}','${day}','${cat}','${ev}','${ev}:${day}', 1, 3, 100, 'test')`);
    }
    run(`select public.elo_try_clean_day('${A}', '${szn}', '${day}'::date, (select data from elo_config where id=1), 4, false)`);
    const n = val(`select count(*) from elo_events where user_id = '${A}' and event_type = 'cleanday' and day = '${day}'::date`);
    if (n !== '0') throw new Error('бонусів: ' + n);
  });

  /*
   * ЧИСТИЙ ТИЖДЕНЬ. Вимагав семи закритих днів їжі — для того, хто
   * вимкнув категорію, це «ніколи». Тепер сім днів питають лише тоді,
   * коли їжа в грі.
   */
  check('чистий тиждень без харчування дається за самі тренування', () => {
    const wk = val(`select (date_trunc('week', current_date)::date - 14)::text`);
    const szn = val(`select season_of('${wk}'::date + 6)`);
    run(`update profiles set data = '{"eloSkip":["nutrition"],"activePlan":{"programId":"fullbody","days":3},"daysPerWeek":3}'::jsonb where user_id = '${B}'`);
    /* Три тренування тижня й жодного дня їжі. */
    for (let i = 0; i < 3; i++) {
      run(`insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
           values ('${B}','${szn}','${wk}'::date + ${i},'training','workout','w:${i}:' || '${wk}', 1, 5, 100, 'test')`);
    }
    run(`insert into season_state (user_id, season, elo) values ('${B}', '${szn}', 100)
         on conflict (user_id, season) do update set elo = 100`);
    const r = val(`select public.elo_eval_week_for('${B}', '${wk}'::date, (select data from elo_config where id=1))`);
    const j = JSON.parse(r);
    if (j.ok !== true) throw new Error(r);
    const reason = val(`select reason from elo_events where user_id = '${B}' and event_type = 'week' and day = '${wk}'::date + 6`);
    if (!/Чистий тиждень/.test(reason)) throw new Error('причина: ' + reason + ' (' + r + ')');
  });

  console.log('\n' + pass + ' пройдено, ' + fail + ' впало');
} finally {
  if (started) { try { sh(q(PG_BIN+'/pg_ctl')+' -D '+q(data)+' -m immediate -w stop'); } catch (_) {} }
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);
