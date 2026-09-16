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
  psql('-f '+q(write('recount.sql', fs.readFileSync(path.join(ROOT,'db','elo-recount-category.sql'),'utf8'))));
  psql('-f '+q(write('whitelist.sql', fs.readFileSync(path.join(ROOT,'db','elo-skip-whitelist.sql'),'utf8'))));
  ok('міграції накочуються');

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

  /*
   * Білий список. eloSkip пише КЛІЄНТ (grant update (data) на profiles плюс
   * profile_patch), тож без цієї перевірки будь-хто зі своїм токеном міг
   * лишити в грі одну категорію й забрати в неї весь тижневий бюджет.
   * Дозволене живе в конфізі — elo_config.data->'skippable'.
   */
  check('конфіг несе список того, що взагалі можна вимикати', () => {
    const list = val(`select (select data->>'skippable' from elo_config where id=1)`);
    if (!list || list === '') throw new Error('ключа skippable немає');
  });

  check('категорія поза списком не вимикається', () => {
    run(`update profiles set data = '{"eloSkip":["sleep"]}'::jsonb where user_id = '${B}'`);
    const w = val(`select public.elo_cfg_for('${B}', (select data from elo_config where id=1))#>>'{weights,sleep}'`);
    if (Number(w) !== 0.2) throw new Error('сон вимкнувся попри заборону: ' + w);
    const n = val(`select count(*) from jsonb_object_keys(
      public.elo_cfg_for('${B}', (select data from elo_config where id=1))->'weights')`);
    if (n !== '5') throw new Error('категорій лишилось ' + n);
    run(`update profiles set data = '{"eloSkip":["nutrition"]}'::jsonb where user_id = '${B}'`);
  });

  check('увесь бюджет в одну самозвітну категорію не переливається', () => {
    run(`update profiles set data = '{"eloSkip":["training","nutrition","recovery","activity"]}'::jsonb where user_id = '${B}'`);
    const w = Number(val(`select public.elo_cfg_for('${B}', (select data from elo_config where id=1))#>>'{weights,sleep}'`));
    /* Дозволене — саме харчування, тож лишається 0,2/0,7. Без білого
       списку сон отримав би 1,0, тобто ввесь тижневий бюджет за число,
       набране руками. */
    if (Math.abs(w - 0.2/0.7) > 1e-5) throw new Error('вага сну ' + w);
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

  /* =========================== ПЕРЕРАХУНОК СЕЗОНУ =========================== */
  /*
   * Вимикач без перерахунку лишав людину з половиною сезону за старими
   * вагами. Тут перевіряється те, заради чого перерахунок і є: після
   * вимкнення харчування сезон виглядає так, ніби його з самого початку
   * грали без цієї категорії.
   */
  const C = '00000000-0000-4000-8000-0000000000c1';
  const asUser = (u) => `select set_config('request.jwt.claims', '{"sub":"${u}","role":"authenticated"}', true);`;

  check('перерахунок: підготовка сезону', () => {
    run(`insert into auth.users (id, email) values ('${C}','${C}@t');
         insert into account_status (user_id, status, username) values ('${C}','approved','userc')`);
    run(`insert into profiles (user_id, data) values ('${C}', '{}'::jsonb)`);
    const wk = val(`select (date_trunc('week', current_date)::date)::text`);
    const szn = val(`select season_of(current_date)`);
    run(`insert into elo_week_plan (user_id, week_start, planned) values ('${C}', '${wk}'::date, 3)
         on conflict do nothing`);
    run(`insert into season_state (user_id, season, elo) values ('${C}', '${szn}', 0)
         on conflict (user_id, season) do update set elo = 0`);
    /* Дві події: тренування на повну і день їжі на повну. Дельти
       рахуємо ТИМ САМИМ шляхом, що й двигун, — інакше перевірка
       доводила б лише те, що два наші вирази однакові. */
    const dt = Number(val(`select public.elo_event_delta((select data from elo_config where id=1),
      'training', 1, public.elo_pace(0, (select data from elo_config where id=1)), 3)`));
    run(`insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
         values ('${C}','${szn}',current_date,'training','workout','w:1', 1, ${dt}, ${dt}, 'test')`);
    /* Їжа ведеться абияк (якість 0,4): саме тоді вимкнення категорії
       має сенс, і саме тоді сума до й після перерахунку різна. При
       якості 1 вони випадково збігаються — і перевірка нічого б не
       довела. */
    const dn = Number(val(`select public.elo_event_delta((select data from elo_config where id=1),
      'nutrition', 0.4, public.elo_pace(${dt}, (select data from elo_config where id=1)), 1)`));
    run(`insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
         values ('${C}','${szn}',current_date,'nutrition','meal','m:1', 0.4, ${dn}, ${dt + dn}, 'test')`);
    run(`update season_state set elo = ${dt + dn} where user_id = '${C}' and season = '${szn}'`);
    if (!(dt > 0 && dn > 0)) throw new Error('дельти ' + dt + '/' + dn);
  });

  check('перерахунок переносить вагу їжі на решту сезону', () => {
    const szn = val(`select season_of(current_date)`);
    const before = Number(val(`select elo from season_state where user_id = '${C}' and season = '${szn}'`));
    run(`update profiles set data = '{"eloSkip":["nutrition"]}'::jsonb where user_id = '${C}'`);
    const r = val(`${asUser(C)} select public.elo_recount_categories()`);
    const j = JSON.parse(r.split('\n').pop());
    if (j.ok !== true || j.changed !== true) throw new Error(r);
    const after = Number(val(`select elo from season_state where user_id = '${C}' and season = '${szn}'`));
    /* Тренування дорожчає в 1/0,7 раза, день їжі зникає. Числа беремо не
       «приблизно», а точно — саме заради цього перерахунок і є. */
    const dt = Number(val(`select delta from elo_events where user_id = '${C}' and event_type = 'workout'`));
    const want = Math.round(dt / 0.7);
    if (Math.abs(after - want) > 1) throw new Error(before + ' → ' + after + ', очікувалось ' + want);
  });

  check('журнал не переписано — різниця стоїть окремою подією', () => {
    const szn = val(`select season_of(current_date)`);
    const n = val(`select count(*) from elo_events where user_id = '${C}' and season = '${szn}'
                   and action_key like 'admin:cat-recount:%'`);
    if (n !== '1') throw new Error('подій перерахунку: ' + n);
    const dt = val(`select delta from elo_events where user_id = '${C}' and event_type = 'workout'`);
    /* Стара подія лишилась тим, що людина бачила того дня. */
    if (Number(dt) <= 0) throw new Error('дельта тренування зникла: ' + dt);
  });

  check('стан збігається з журналом після перерахунку', () => {
    const szn = val(`select season_of(current_date)`);
    const st = val(`select elo from season_state where user_id = '${C}' and season = '${szn}'`);
    const sum = val(`select coalesce(sum(delta),0) from elo_events where user_id = '${C}' and season = '${szn}'`);
    if (st !== sum) throw new Error('стан ' + st + ', сума ' + sum);
  });

  check('чужа дельта в журналі валить перерахунок, а не псує рейтинг', () => {
    /* Самоперевірка — головне, що стоїть між перерахунком і зіпсованим
       сезоном: якщо дельту в журналі не відтворює ЖОДЕН можливий
       конфіг, значить формула тут розійшлася з двигуном. */
    const szn = val(`select season_of(current_date)`);
    run(`insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
         values ('${C}','${szn}',current_date,'sleep','sleep','s:зламана', 1, 999, 0, 'битий рядок')`);
    let threw = false;
    try { val(`${asUser(C)} select public.elo_recount_categories()`); } catch (e) { threw = true; }
    run(`delete from elo_events where user_id = '${C}' and action_key = 's:зламана'`);
    if (!threw) throw new Error('битий журнал прийняли');
  });

  check('двічі на сезон — і досить', () => {
    /* Повертаємо харчування: другий перерахунок. Журнал тепер ЗМІШАНИЙ —
       у ньому є і дельти, пораховані з їжею, і рядок першого
       перерахунку; самоперевірка мусить це пережити. */
    run(`update profiles set data = '{}'::jsonb where user_id = '${C}'`);
    const r2 = JSON.parse(val(`${asUser(C)} select public.elo_recount_categories()`).split('\n').pop());
    if (r2.ok !== true) throw new Error(JSON.stringify(r2));
    /* Повернули їжу — рейтинг мусить повернутись туди, звідки пішов, а
       не піднятись ще раз: поправка не накладається на поправку. */
    const szn2 = val(`select season_of(current_date)`);
    const back = val(`select elo from season_state where user_id = '${C}' and season = '${szn2}'`);
    const sum2 = val(`select coalesce(sum(delta),0) from elo_events where user_id = '${C}' and season = '${szn2}'`);
    if (back !== sum2) throw new Error('стан ' + back + ', сума ' + sum2);
    if (Number(back) !== 42) throw new Error('повернулись у ' + back + ', а не 42');
    /* Третій — відмова з названою причиною. */
    run(`update profiles set data = '{"eloSkip":["nutrition"]}'::jsonb where user_id = '${C}'`);
    const r3 = JSON.parse(val(`${asUser(C)} select public.elo_recount_categories()`).split('\n').pop());
    if (r3.ok !== false || r3.error !== 'limit') throw new Error(JSON.stringify(r3));
  });

  check('чужий сезон перерахувати не можна', () => {
    /* Функція працює тільки від імені того, хто її викликав: uid береться
       з auth.uid(), а не з аргументу — аргументу для нього просто немає. */
    const n = val(`select count(*) from information_schema.parameters
                   where specific_name like 'elo_recount_categories%' and parameter_name = 'uid'`);
    if (n !== '0') throw new Error('є параметр користувача — це вже чужий сезон');
  });

  console.log('\n' + pass + ' пройдено, ' + fail + ' впало');
} finally {
  if (started) { try { sh(q(PG_BIN+'/pg_ctl')+' -D '+q(data)+' -m immediate -w stop'); } catch (_) {} }
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);
