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
  r := public.elo_submit('sleep','t:sleep',y,forged);
  c := coalesce((r->>'delta')::int,0) = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'ціль сну = 1 хв не дає нарахування' || E'\n';
  r := public.elo_submit('activity','t:act',y,forged);
  c := coalesce((r->>'delta')::int,0) = 0; alln:=alln+1; okn:=okn+c::int;
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
  c := (r->>'delta')::int = 9; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесне тренування = 9 (план 6)' || E'\n';
  r := public.elo_submit('meal','h:meal',y,'{}');
  c := (r->>'delta')::int = 7; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесне харчування = 7' || E'\n';
  r := public.elo_submit('sleep','h:sleep',y,'{}');
  c := (r->>'delta')::int = 5; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесний сон = 5' || E'\n';
  r := public.elo_submit('recovery','h:rec',y,'{}');
  c := (r->>'delta')::int = 2; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесний recovery = 2' || E'\n';
  r := public.elo_submit('activity','h:act',y,'{}');
  c := (r->>'delta')::int = 2; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесна активність = 2' || E'\n';
  select elo as e into st from public.season_state where user_id = ub;
  c := st.e = 28; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесний день = 25 + 3 бонус = 28' || E'\n';
  r := public.elo_submit('sleep','h:sleep',y,'{}');
  c := (r->>'duplicate')::boolean is true; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'повторний сабміт → duplicate' || E'\n';
  select elo as e into st from public.season_state where user_id = ub;
  c := st.e = 28; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'повторний сабміт не змінює ELO' || E'\n';
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

  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  r := public.elo_submit('workout','wb1',current_date - 2,'{}');
  -- На 1–2 день сезону «позавчора» належить минулому сезону → out_of_window;
  -- це не регресія, тому день просто не рахується в тижневу суму.
  c := coalesce((r->>'delta')::int = 17, r->>'error' = 'out_of_window', false); alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'план=1 у профілі: сервер бере план ≥ 3 → 17 (db/elo-integrity.sql)' ||
         case when r->>'error' = 'out_of_window' then ' [позавчора — минулий сезон, пропущено]' else '' end || E'\n';
  w1 := coalesce((r->>'delta')::int, 0);
  r := public.elo_submit('workout','wb2',current_date - 1,'{}');
  c := (r->>'delta')::int = 17; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'друге тренування = 17' || E'\n';
  r := public.elo_submit('workout','wb3',current_date,'{}');
  c := (r->>'delta')::int = 17; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'третє = 17 (тижневий бюджет тренувань 51 вичерпано)' || E'\n';
  reset role;
  select coalesce(sum(delta),0) as s into st from public.elo_events
    where user_id = ua and category='training' and day between wk and wk + 6;
  -- У понеділок «учора/позавчора» — інший ISO-тиждень, у сумі лише сьогоднішнє.
  c := st.s = case when date_trunc('week', current_date - 1)::date = wk then 34 + w1 else 17 end; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'тижневий бюджет тренувань = 51 незалежно від плану (факт ' || st.s || ' при ' || (2 + (w1 > 0)::int) || ' тренуваннях у вікні)' || E'\n';

  raise exception E'ELO-ТЕСТИ: % з % пройдено\n%', okn, alln, out;
end $$;
