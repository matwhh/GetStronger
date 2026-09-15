-- =============================================================================
-- Тести ELO: атаки, межі, ідемпотентність
-- =============================================================================
-- Виконувати в Supabase SQL Editor як є. Скрипт створює тимчасових
-- користувачів, проганяє сценарії й НАВМИСНО завершується винятком — уся
-- транзакція відкочується, у базі не лишається нічого.
--
-- Успіх виглядає так:
--     ERROR:  ELO-ТЕСТИ: 20 з 20 пройдено
--
-- Будь-який рядок FAIL означає реальну регресію. Очікувані числа
-- відповідають db/elo-config.json: weeklyBudget 200, categoryShare 0.857,
-- ваги 0.3/0.3/0.2/0.1/0.1, dayGainCap 45, cleanDayBonus 3.
-- =============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000f001';
  ub uuid := '00000000-0000-4000-8000-00000000f002';
  y date := current_date - 1; wk date := date_trunc('week', current_date)::date;
  r jsonb; out text := E'\n'; okn int := 0; alln int := 0; st record; c boolean; w1 int := 0;
  cfg jsonb; per int; tb int; expect int; sleep_floor int; act_floor int;
  /* Денні вартості категорій рахуються з конфігу: після db/elo-pace.sql
     вони залежать від рівня, і зашиті 5/2/2 ловили б навмисну зміну як
     помилку. Темп — на нулі: у цих тестах користувач не виходить із
     першого рівня. Рахується в declare, до `set local role authenticated`:
     elo_pace видана лише service_role, як і решта чистих помічників. */
  cfgd jsonb := (select data from public.elo_config where id = 1);
  d_sleep int := round((cfgd->>'weeklyBudget')::numeric * public.elo_pace(0, cfgd)
                       * (cfgd->>'categoryShare')::numeric
                       * (cfgd#>>'{weights,sleep}')::numeric / 7)::int;
  d_rec int := round((cfgd->>'weeklyBudget')::numeric * public.elo_pace(0, cfgd)
                     * (cfgd->>'categoryShare')::numeric
                     * (cfgd#>>'{weights,recovery}')::numeric / 7)::int;
  d_act int := round((cfgd->>'weeklyBudget')::numeric * public.elo_pace(0, cfgd)
                     * (cfgd->>'categoryShare')::numeric
                     * (cfgd#>>'{weights,activity}')::numeric / 7)::int;
  d_meal int := round((cfgd->>'weeklyBudget')::numeric * public.elo_pace(0, cfgd)
                      * (cfgd->>'categoryShare')::numeric
                      * (cfgd#>>'{weights,nutrition}')::numeric / 7)::int;
  d_work6 int := round((cfgd->>'weeklyBudget')::numeric * public.elo_pace(0, cfgd)
                       * (cfgd->>'categoryShare')::numeric
                       * (cfgd#>>'{weights,training}')::numeric / 6)::int;

  -- Payload, у якому підроблено ВСЕ, що колись впливало на розрахунок.
  forged jsonb := jsonb_build_object('minutes',480,'goal',1,'steps',20000,'kcal',2500,
    'target',2500,'protein',300,'proteinTarget',1,'done',999999,'total',1,'value',10);
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','elotest-a@local','x',now(),now()),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','elotest-b@local','x',now(),now());
  insert into public.account_status (user_id, status) values (ua,'approved'), (ub,'approved');

  -- A: журнали навмисно «порожні» або мінімальні — усе цікаве в payload.
  insert into public.profiles (user_id, data) values (ua, jsonb_build_object(
    'activePlan', jsonb_build_object('days', 6),
    'trackers',   jsonb_build_object('sleep', jsonb_build_object('goal',1), 'steps', jsonb_build_object('goal',1)),
    'trackerLog', jsonb_build_object('sleep', jsonb_build_object(y::text, 1), 'steps', jsonb_build_object(y::text, 1)),
    'sessionLog', jsonb_build_object(y::text, jsonb_build_object('done',1,'total',1)))),
  -- B: чесно закритий день.
    (ub, jsonb_build_object(
    'activePlan', jsonb_build_object('days', 6),
    'sessionLog', jsonb_build_object(y::text, jsonb_build_object('done',14,'total',14)),
    'mealLog',    jsonb_build_object(y::text, jsonb_build_object('kcal',2500,'p',180,'target',2500,'pTarget',180)),
    'trackers',   jsonb_build_object('sleep', jsonb_build_object('goal',480), 'steps', jsonb_build_object('goal',8000)),
    'trackerLog', jsonb_build_object('sleep', jsonb_build_object(y::text, 480),
       'steps', jsonb_build_object(y::text, 9000),
       'recovery', jsonb_build_object(y::text, jsonb_build_object('value',8,'source','manual')))));

  /* ---------- АТАКИ: підроблений payload не впливає ні на що ---------- */
  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  /*
   * ПІДРОБЛЕНИЙ PAYLOAD ДАЄ НЕ БІЛЬШЕ, НІЖ НИЖНЯ СХОДИНКА ДРАБИНИ.
   *
   * Доти тут стояло «рівно 0», і це працювало випадково: реальна якість
   * (ціль сну підтягується до підлоги 240 хв, факт — 1 хв) давала 0,05
   * від денного бюджету, тобто 0,25 очка, і округлення з'їдало її. Щойно
   * бюджет виріс удвічі, та сама чесна крихта стала одиницею — і
   * перевірка почервоніла на правильній поведінці.
   *
   * Питання ж було не про нуль, а про те, що підробка не купує повної
   * вартості. Так і перевіряємо: не більше за найгіршу сходинку.
   */
  sleep_floor := round(d_sleep * (cfgd#>'{tolerance,sleep}' -> -1 ->> 1)::numeric)::int;
  act_floor   := round(d_act   * (cfgd#>'{tolerance,activity}' -> -1 ->> 1)::numeric)::int;
  r := public.elo_submit('sleep','t:sleep',y,forged);
  c := coalesce((r->>'delta')::int,0) <= sleep_floor; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'ціль сну = 1 хв дає не більше нижньої сходинки (' || sleep_floor || ') :: '
            || coalesce(r->>'delta','—') || E'\n';
  r := public.elo_submit('activity','t:act',y,forged);
  c := coalesce((r->>'delta')::int,0) <= act_floor; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'ціль кроків = 1 не дає нарахування' || E'\n';
  r := public.elo_submit('workout','t:wk',y,forged);
  c := r->>'error' = 'no_data'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'тренування з 1 вправи відхилено' || E'\n';
  r := public.elo_submit('meal','t:meal',y,forged);
  c := r->>'error' = 'no_data'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'харчування без запису відхилено' || E'\n';
  r := public.elo_submit('recovery','t:rec',y,forged);
  c := r->>'error' = 'no_data'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'recovery без запису відхилено' || E'\n';
  c := (select count(*) from public.profiles where user_id = ub) = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чужий профіль не видно (RLS)' || E'\n';
  reset role;

  /* ---------- ЧЕСНИЙ ДЕНЬ: нарахування не змінилось ---------- */
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  r := public.elo_submit('workout','h:wk',y,'{}');
  c := (r->>'delta')::int = d_work6; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесне тренування = ' || d_work6 || ' (план 6)' || E'\n';
  r := public.elo_submit('meal','h:meal',y,'{}');
  c := (r->>'delta')::int = d_meal; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесне харчування = ' || d_meal || E'\n';
  r := public.elo_submit('sleep','h:sleep',y,'{}');
  c := (r->>'delta')::int = d_sleep; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесний сон = ' || d_sleep || E'\n';
  r := public.elo_submit('recovery','h:rec',y,'{}');
  c := (r->>'delta')::int = d_rec; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесний recovery = ' || d_rec || E'\n';
  r := public.elo_submit('activity','h:act',y,'{}');
  c := (r->>'delta')::int = d_act; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесна активність = ' || d_act || E'\n';
  select elo as e into st from public.season_state where user_id = ub;
  expect := d_work6 + d_meal + d_sleep + d_rec + d_act + (cfgd->>'cleanDayBonus')::int;
  c := st.e = expect; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'чесний день = сума пʼяти категорій + бонус = ' || expect || ' :: ' || st.e || E'\n';
  r := public.elo_submit('sleep','h:sleep',y,'{}');
  c := (r->>'duplicate')::boolean is true; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'повторний сабміт → duplicate' || E'\n';
  select elo as e into st from public.season_state where user_id = ub;
  c := st.e = expect; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'повторний сабміт не змінює ELO :: ' || st.e || E'\n';
  r := public.elo_submit('sleep','oow',current_date - 30,'{}');
  c := r->>'error' = 'out_of_window'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'подія поза вікном відхилена' || E'\n';
  r := public.elo_submit('sleep','fut',current_date + 5,'{}');
  c := r->>'error' = 'out_of_window'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'подія з майбутнього відхилена' || E'\n';
  reset role;

  /* ---------- ТИЖНЕВИЙ БЮДЖЕТ: план=1 не дає переваги ---------- */
  update public.profiles set data = jsonb_set(jsonb_set(data,'{activePlan,days}','1'), '{sessionLog}',
    (select jsonb_object_agg((current_date - k)::text, jsonb_build_object('done',14,'total',14))
     from generate_series(0,2) k))
    where user_id = ua;
  delete from public.elo_events where user_id = ua;
  -- Знімок плану тижня (db/elo-integrity.sql) зафіксувався як 6 у попередньому
  -- блоці; для сценарію «план=1» емулюємо новий тиждень, скидаючи фікстуру.
  delete from public.elo_week_plan where user_id = ua;
  insert into public.season_state (user_id, season) values (ua, season_of(current_date)) on conflict do nothing;
  update public.season_state set elo = 0 where user_id = ua;

  /*
   * ВАРТІСТЬ ТРЕНУВАННЯ БІЛЬШЕ НЕ КОНСТАНТА. Доти тут стояло 17 — рівно
   * 200 × 0.857 × 0.3 / 3 при плаcкому бюджеті. Відколи бюджет залежить від
   * рівня (db/elo-pace.sql), на нульовому ELO те саме тренування коштує
   * вдвічі більше, і зашите число ловило б саме ту зміну, яку ми зробили
   * навмисно. Рахуємо з конфігу, у тому самому порядку, що й сервер.
   *
   * Темп беремо на нулі й не перераховуємо: три тренування не виводять
   * користувача навіть із першого рівня, тож множник за весь тест один.
   */
  select data into cfg from public.elo_config where id = 1;
  tb  := round((cfg->>'weeklyBudget')::numeric * public.elo_pace(0, cfg)
               * (cfg->>'categoryShare')::numeric
               * (cfg#>>'{weights,training}')::numeric)::int;
  per := round((cfg->>'weeklyBudget')::numeric * public.elo_pace(0, cfg)
               * (cfg->>'categoryShare')::numeric
               * (cfg#>>'{weights,training}')::numeric / 3)::int;

  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  r := public.elo_submit('workout','wb1',current_date - 2,'{}');
  -- На 1–2 день сезону «позавчора» належить минулому сезону → out_of_window;
  -- це не регресія, тому день просто не рахується в тижневу суму.
  c := coalesce((r->>'delta')::int = per, r->>'error' = 'out_of_window', false); alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'план=1 у профілі: сервер бере план ≥ 3 → ' || per || ' (db/elo-integrity.sql)' ||
         case when r->>'error' = 'out_of_window' then ' [позавчора — минулий сезон, пропущено]' else '' end || E'\n';
  w1 := coalesce((r->>'delta')::int, 0);
  r := public.elo_submit('workout','wb2',current_date - 1,'{}');
  c := (r->>'delta')::int = per; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'друге тренування = ' || per || E'\n';
  r := public.elo_submit('workout','wb3',current_date,'{}');
  c := (r->>'delta')::int = per; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'третє = ' || per || ' (тижневий бюджет тренувань ' || tb || ' вичерпано)' || E'\n';
  reset role;
  select coalesce(sum(delta),0) as s into st from public.elo_events
    where user_id = ua and category='training' and day between wk and wk + 6;
  /*
   * КОЖЕН ІЗ ТРЬОХ ДНІВ ПИТАЄМО ОКРЕМО.
   *
   * Тут стояло «якщо вчора той самий тиждень — то per×2 + w1». У вівторок
   * це неправда: учора (понеділок) у тижні, а позавчора (неділя) — ні, і
   * очікування включало дельту, якої в сумі немає. Набір червонів раз на
   * тиждень від самої лише дати, як і фікстури оцінки тижня до правки
   * (tools/verify-elo-week.mjs).
   *
   * Тепер кожен день додається до очікування ЛИШЕ якщо він справді
   * потрапляє у вікно [wk, wk+6] — і жоден день тижня набір не зачіпає.
   */
  c := st.s = per
       + case when date_trunc('week', current_date - 1)::date = wk then per else 0 end
       + case when date_trunc('week', current_date - 2)::date = wk then w1  else 0 end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'тижневий бюджет тренувань = ' || tb || ' незалежно від плану (факт ' || st.s
            || ' при ' || (1
                 + (date_trunc('week', current_date - 1)::date = wk)::int
                 + (date_trunc('week', current_date - 2)::date = wk and w1 > 0)::int)
            || ' тренуваннях у вікні)' || E'\n';

  raise exception E'ELO-ТЕСТИ: % з % пройдено\n%', okn, alln, out;
end $$;
