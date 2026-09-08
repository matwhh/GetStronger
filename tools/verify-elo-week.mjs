#!/usr/bin/env node
/*
 * ОЦІНКА ТИЖНЯ: перевірка міграції db/elo-week-eval-fix.sql
 * =============================================================================
 * Чотири HIGH з аудиту 2026-09 (ELO-001, ELO-002, ELO-004, ELO-005) — усі про
 * одне: коли саме тиждень вважається порахованим і хто має право його
 * рахувати. Помилки тут тихі: людина бачить мінус там, де тренувалась, або
 * плюс там, де ні, і зрозуміти це з інтерфейсу неможливо.
 *
 * Тому перевірка не на бойовій базі, а на копії схеми: тимчасовий локальний
 * Postgres, у нього — db/live-schema.sql (знімок продакшену) і зверху
 * міграція. Мережі не потрібно. Кластер зноситься в кінці.
 *
 *   node tools/verify-elo-week.mjs
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
function check(n, fn) { try { fn(); ok(n); } catch (e) { bad(n, (e && (e.stderr || e.message)) || e); } }

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
/** SQL-літерал: подвоєні лапки всередині рядка. */
const lit = (s) => "$fx$" + String(s) + "$fx$";
const sh = (cmd) => execFileSync(RUN_AS ? 'su' : 'bash', RUN_AS ? [RUN_AS, '-c', cmd] : ['-c', cmd],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (!PG_BIN) {
  console.log('\n  – ПРОПУЩЕНО: у системі немає Postgres, перевірити оцінку тижня нема на чому\n');
  process.exit(3);
}

/*
 * Мінімальний auth: рівно те, на що спираються функції продакшену.
 * auth.uid() читає той самий request.jwt.claims, що й у Supabase, тож
 * імперсонація в тестах іде штатним шляхом, а не обходом.
 */
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-elo-'));
const data = path.join(dir, 'data'), sock = path.join(dir, 'sock');
const port = 5432 + 600 + Math.floor(Math.random() * 300);
let started = false;
const write = (n, c) => { const p = path.join(dir, n); fs.writeFileSync(p, c); if (RUN_AS) execFileSync('chmod', ['644', p]); return p; };
const psql = (args) => sh(q(PG_BIN + '/psql') + ' -h ' + q(sock) + ' -p ' + port + ' -U postgres -d postgres -v ON_ERROR_STOP=1 ' + args);
const val = (sql) => psql('-tAc ' + q(sql)).trim();
const run = (sql) => psql('-c ' + q(sql));

console.log('\nОцінка тижня: ELO-001, ELO-002, ELO-004, ELO-005, ELO-006\n');

try {
  fs.mkdirSync(data); fs.mkdirSync(sock); fs.chmodSync(dir, 0o711);
  if (RUN_AS) execFileSync('chown', ['-R', RUN_AS, dir]);
  sh(q(PG_BIN + '/initdb') + ' -D ' + q(data) + ' -U postgres -A trust -E UTF8 --locale=C');
  sh(q(PG_BIN + '/pg_ctl') + ' -D ' + q(data) + ' -o "-k ' + sock + " -h '' -p " + port + '" -l ' + q(path.join(dir, 'pg.log')) + ' -w start');
  started = true;

  psql('-f ' + q(write('prelude.sql', PRELUDE)));
  psql('-f ' + q(write('live.sql', fs.readFileSync(path.join(ROOT, 'db', 'live-schema.sql'), 'utf8'))));
  ok('знімок бойової схеми розгортається');
  /* FORGE_ELO_BASELINE=1 — прогнати ті самі перевірки БЕЗ міграції.
     Тест, який проходить і до фіксу, нічого не доводить. */
  if (process.env.FORGE_ELO_BASELINE === '1') {
    console.log('  · режим «до міграції»: перевірки МАЮТЬ падати');
  } else {
    psql('-f ' + q(write('fix.sql', fs.readFileSync(path.join(ROOT, 'db', 'elo-week-eval-fix.sql'), 'utf8'))));
    psql('-f ' + q(write('partial.sql', fs.readFileSync(path.join(ROOT, 'db', 'elo-partial-first-week.sql'), 'utf8'))));
    ok('міграції застосовуються');
  }

  /* ---------------------------------------------------------------- посів */
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const C = '00000000-0000-4000-8000-00000000000c';
  run(`insert into elo_config (id, data) values (1, '{
    "submitWindowDays": 2, "missedWorkoutPenalty": -8, "cleanWeekBonus": 9,
    "graceDays": 7, "graceWeeksPerSeason": 2, "seasonMax": 2500,
    "weeklyBudget": 60, "categoryShare": 0.5,
    "weights": {"training": 0.5, "nutrition": 0.2, "sleep": 0.15, "recovery": 0.1, "activity": 0.05}
  }'::jsonb)`);
  for (const u of [A, B, C]) {
    run(`insert into auth.users (id, email) values ('${u}', '${u}@t');
         insert into account_status (user_id, status, username) values ('${u}', 'approved', 'user' || '${u.slice(-1)}')`);
  }

  const today = val('select current_date');
  const monday = (n) => val(`select (date_trunc('week', current_date)::date - ${n} * 7)::text`);
  const lastWeek = monday(1), twoWeeksAgo = monday(2), threeWeeksAgo = monday(3);
  console.log('  · сьогодні ' + today + ', минулий тиждень із ' + lastWeek);

  const ev = (u, day, cat, type, key, qual) =>
    run(`insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
         values ('${u}', season_of('${day}'::date), '${day}', '${cat}', '${type}', '${key}', ${qual}, 1, 1, 'test')`);

  /* ------------------------------------------------- ELO-001: вікно подання */
  ev(A, twoWeeksAgo, 'training', 'workout', 'w:' + twoWeeksAgo, 1);
  check('тиждень, чия неділя минула менше ніж вікно подання тому, ще не оцінюється', () => {
    /* Тиждень, що закінчився вчора: вікно подання (2 дні) ще відкрите. */
    const wk = val(`select (date_trunc('week', current_date - 1)::date)::text`);
    const r = val(`select public.elo_week_ready('${A}', '${wk}'::date, (select data from elo_config where id = 1))`);
    if (r !== 'week_not_over') throw new Error('очікувалось week_not_over, отримано ' + (r || 'null'));
  });

  check('той самий тиждень стає придатним після вікна подання', () => {
    const r = val(`select coalesce(public.elo_week_ready('${A}', '${twoWeeksAgo}'::date,
                    (select data from elo_config where id = 1)), 'ГОТОВИЙ')`);
    if (r !== 'ГОТОВИЙ') throw new Error('очікувалась придатність, отримано ' + r);
  });

  /* --------------------------------------------- ELO-002: до першої події */
  check('тижні до першої події людини не оцінюються', () => {
    const r = val(`select public.elo_week_ready('${A}', '${threeWeeksAgo}'::date,
                    (select data from elo_config where id = 1))`);
    if (r !== 'before_first_event') throw new Error('отримано ' + (r || 'null'));
  });

  check('cron не чіпає акаунт без жодної події', () => {
    run(`select public.elo_cron_eval_week(4)`);
    const n = val(`select count(*) from season_state where user_id = '${C}'`);
    const e = val(`select count(*) from elo_events where user_id = '${C}'`);
    if (n !== '0' || e !== '0') throw new Error('season_state ' + n + ', elo_events ' + e);
  });

  check('cron не штрафує за тижні до реєстрації', () => {
    const n = val(`select count(*) from elo_events
                   where user_id = '${A}' and event_type = 'week' and day < '${twoWeeksAgo}'::date`);
    if (n !== '0') throw new Error(n + ' рядків week до першої події');
  });

  check('свій тиждень cron таки оцінив', () => {
    const n = val(`select count(*) from elo_events
                   where user_id = '${A}' and event_type = 'week' and day = '${twoWeeksAgo}'::date + 6`);
    if (n !== '1') throw new Error('рядків week: ' + n);
  });

  /* ------------------------------------------------- ELO-004: подвійна оцінка */
  check('повторна оцінка того самого тижня — duplicate, а не друга дельта', () => {
    const before = val(`select elo from season_state where user_id = '${A}' and season = season_of('${twoWeeksAgo}'::date + 6)`);
    const r = val(`select public.elo_eval_week_for('${A}', '${twoWeeksAgo}'::date, (select data from elo_config where id = 1))`);
    if (!r.includes('"duplicate": true') && !r.includes('"duplicate":true')) throw new Error('відповідь: ' + r);
    const after = val(`select elo from season_state where user_id = '${A}' and season = season_of('${twoWeeksAgo}'::date + 6)`);
    if (before !== after) throw new Error('elo змінився: ' + before + ' → ' + after);
  });

  check('стан збігається з журналом (ledger не розходиться)', () => {
    /*
     * DB-006: у журнал пишеться ДЕЛЬТА, на яку стан справді змінився, а не
     * та, що вийшла з формули. При 0 ELO штраф −16 не може відняти нічого,
     * тож у журналі має стояти 0 — інакше сума дельт назавжди розходиться
     * зі станом. Саме тому тут рівність, а не «приблизно»: раніше стояло
     * max(0, сума + 1), і воно проходило навіть коли в журналі лежало −16
     * при стані 0.
     *
     * Посіяні вручну події (ev()) сюди не входять: вони не проходили через
     * elo_submit і стану не міняли, тому й рахуються лише week-рядки.
     */
    const st = val(`select elo from season_state where user_id = '${A}' and season = season_of('${twoWeeksAgo}'::date + 6)`);
    const sum = val(`select coalesce(sum(delta), 0) from elo_events
                     where user_id = '${A}' and event_type = 'week' and season = season_of('${twoWeeksAgo}'::date + 6)`);
    if (Number(st) !== Number(sum)) throw new Error('season_state ' + st + ', сума дельт ' + sum);
  });

  check('паралельні виклики нараховують тиждень рівно один раз', () => {
    /* Два зʼєднання, обидва починають ДО коміту першого — саме та гонка,
       через яку раніше можна було нарахувати собі +9 × N. */
    ev(B, lastWeek, 'training', 'workout', 'w:' + lastWeek, 1);
    const wk = twoWeeksAgo;
    ev(B, wk, 'training', 'workout', 'wb:' + wk, 1);
    const script = `
      begin;
      select public.elo_eval_week_for('${B}', '${wk}'::date, (select data from elo_config where id = 1));
    `;
    /* psql у два процеси: перший тримає транзакцію відкритою, другий чекає. */
    const f1 = write('p1.sql', script + `select pg_sleep(1); commit;`);
    const f2 = write('p2.sql', `select pg_sleep(0.2); ` + script + ` commit;`);
    sh(`(${q(PG_BIN + '/psql')} -h ${q(sock)} -p ${port} -U postgres -d postgres -f ${q(f1)} > /dev/null 2>&1 &) ; ` +
       `${q(PG_BIN + '/psql')} -h ${q(sock)} -p ${port} -U postgres -d postgres -f ${q(f2)} > /dev/null 2>&1 ; sleep 2`);
    const n = val(`select count(*) from elo_events where user_id = '${B}' and event_type = 'week' and day = '${wk}'::date + 6`);
    const st = val(`select elo from season_state where user_id = '${B}' and season = season_of('${wk}'::date + 6)`);
    const d = val(`select delta from elo_events where user_id = '${B}' and event_type = 'week' and day = '${wk}'::date + 6`);
    if (n !== '1') throw new Error('рядків week: ' + n);
    if (Number(st) !== Math.max(0, Number(d))) throw new Error('season_state ' + st + ' проти дельти ' + d);
  });

  check('elo_evaluate_week більше не викликається з браузера', () => {
    const n = val(`select count(*) from information_schema.routine_privileges
                   where routine_name = 'elo_evaluate_week' and grantee = 'authenticated'`);
    if (n !== '0') throw new Error('право лишилось');
  });

  /* --------------------------------------- ELO-005: останній тиждень сезону */
  check('останній тиждень минулого сезону оцінюється, а не гине', () => {
    /* Тиждень, чия неділя ще в минулому сезоні, а придатність настає вже в
       поточному — рівно той випадок, через який у базі немає жодного
       week-рядка за серпень. */
    const wk = val(`select (select s from season_bounds(season_of(current_date))) - 7`);
    const wkMon = val(`select (date_trunc('week', '${wk}'::date)::date)::text`);
    const sunday = val(`select ('${wkMon}'::date + 6)::text`);
    const prevSeason = val(`select season_of('${sunday}'::date)`);
    const curSeason = val(`select season_of(current_date)`);
    if (prevSeason === curSeason) { ok('  (сезони збігаються — випадок не відтворюється сьогодні)'); return; }

    ev(A, sunday, 'training', 'workout', 'w:' + sunday, 1);
    const r = val(`select coalesce(public.elo_week_ready('${A}', '${wkMon}'::date,
                    (select data from elo_config where id = 1)), 'ГОТОВИЙ')`);
    if (r !== 'ГОТОВИЙ') throw new Error('тиждень ' + wkMon + ' (' + prevSeason + ') визнано непридатним: ' + r);

    run(`select set_config('request.jwt.claims', '{"sub":"${A}","role":"authenticated"}', false);
         select public.elo_catch_up()`);
    const n = val(`select count(*) from elo_events where user_id = '${A}'
                   and event_type = 'week' and day = '${sunday}'::date`);
    if (n !== '1') throw new Error('week-рядка за ' + sunday + ' немає');
  });

  /* --------------------------------- ELO-006: тиждень вступу — неповний */
  check('тиждень, у якому людина приєдналась, питає не за весь тиждень', () => {
    /*
     * Заявку схвалено в четвер, план — 3 тренування на тиждень, зроблено
     * одне. Було: expected = 3, missed = 2, −16 ELO за дні, коли людини
     * ще не було в застосунку. Стало: доступних днів 4, expected =
     * round(3 × 4/7) = 2, missed = 1.
     */
    const D = '00000000-0000-4000-8000-00000000000d';
    const wk = twoWeeksAgo;
    const thu = val(`select ('${wk}'::date + 3)::text`);
    run(`insert into auth.users (id, email) values ('${D}', '${D}@t');
         insert into account_status (user_id, status, username, decided_at)
         values ('${D}', 'approved', 'userd', '${thu}'::date)`);
    run(`insert into elo_week_plan (user_id, week_start, planned)
         values ('${D}', '${wk}'::date, 3) on conflict do nothing`);
    ev(D, thu, 'training', 'workout', 'wd:' + thu, 1);

    const r = val(`select public.elo_eval_week_for('${D}', '${wk}'::date,
                    (select data from elo_config where id = 1))`);
    const j = JSON.parse(r);
    if (j.ok !== true) throw new Error('оцінка не пройшла: ' + r);
    if (j.availableDays !== 4) throw new Error('доступних днів ' + j.availableDays + ', очікувалось 4');
    if (j.missed !== 1) throw new Error('пропусків ' + j.missed + ', очікувався 1 (було б 2 до фіксу)');
  });

  check('повний тиждень і далі питає за весь тиждень', () => {
    /* Зворотний бік: масштабування не має послабити звичайний тиждень. */
    const E = '00000000-0000-4000-8000-00000000000e';
    const wk = twoWeeksAgo;
    run(`insert into auth.users (id, email) values ('${E}', '${E}@t');
         insert into account_status (user_id, status, username, decided_at)
         values ('${E}', 'approved', 'usere', '${wk}'::date - 30)`);
    run(`insert into elo_week_plan (user_id, week_start, planned)
         values ('${E}', '${wk}'::date, 3) on conflict do nothing`);
    ev(E, wk, 'training', 'workout', 'we:' + wk, 1);

    const j = JSON.parse(val(`select public.elo_eval_week_for('${E}', '${wk}'::date,
                    (select data from elo_config where id = 1))`));
    if (j.availableDays !== 7) throw new Error('доступних днів ' + j.availableDays);
    if (j.missed !== 2) throw new Error('пропусків ' + j.missed + ', очікувалось 2');
  });

  /* ------------------------------------------- TST-004: паритет JS ↔ SQL */
  check('SQL дає ті самі дельти, що й JS-ядро', () => {
    /*
     * Дельти живуть у двох реалізаціях: js/elo-core.js показує число
     * людині, public.elo_action_delta записує його в базу. Розбіжність не
     * падає й не логується — на екрані одне, в акаунті інше.
     *
     * Фікстури згенеровані з ЯДРА (tools/gen-elo-parity.mjs) і перевірені
     * з боку JS у tests/elo-parity.test.js. Тут ті самі входи йдуть крізь
     * SQL.
     */
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/elo-parity.fixtures.json'), 'utf8'));
    const cfgFile = path.join(ROOT, 'db/elo-config.json');
    run("update elo_config set data = " + lit(fs.readFileSync(cfgFile, 'utf8')) + "::jsonb where id = 1");

    const bad = [];
    for (const c of fx.cases) {
      const got = val("select quality || '|' || delta from public.elo_action_delta(" +
        lit(c.kind) + ", " + lit(JSON.stringify(c.payload)) + "::jsonb," +
        " (select data from elo_config where id = 1), " + Number(c.plannedDays) + ", " +
        (c.grace ? 'true' : 'false') + ")");
      const [q, d] = got.split('|');
      const qNum = Math.round(Number(q) * 1000) / 1000;
      if (Number(d) !== c.delta || qNum !== c.quality) {
        bad.push(c.kind + ' ' + JSON.stringify(c.payload) +
          ': SQL ' + qNum + '/' + d + ' проти JS ' + c.quality + '/' + c.delta);
      }
    }
    if (bad.length) throw new Error(bad.length + ' розбіжностей:\n      ' + bad.join('\n      '));
  });

  check('закритий сезон більше не переоцінюється', () => {
    const wk = twoWeeksAgo;
    const szn = val(`select season_of('${wk}'::date + 6)`);
    run(`insert into season_history (user_id, season, final_elo, level) values ('${A}', '${szn}', 100, 1)
         on conflict do nothing`);
    const r = val(`select public.elo_week_ready('${A}', '${wk}'::date, (select data from elo_config where id = 1))`);
    run(`delete from season_history where user_id = '${A}' and season = '${szn}'`);
    if (r !== 'season_closed') throw new Error('отримано ' + (r || 'null'));
  });
} catch (e) {
  bad('розгортання', (e && (e.stderr || e.message)) || e);
} finally {
  if (started) { try { sh(q(PG_BIN + '/pg_ctl') + ' -D ' + q(data) + ' -m immediate -w stop'); } catch (_) {} }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n' + pass + ' пройдено, ' + fail + ' впало\n');
process.exit(fail ? 1 : 0);
