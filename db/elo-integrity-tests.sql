-- =============================================================================
-- Тести цілісності ELO (db/elo-integrity.sql): серверна ідентичність події,
-- реконсиляція, знімок плану, тижневий бюджет, закриття сезону.
-- =============================================================================
-- Виконувати в SQL Editor як є: скрипт створює тимчасових користувачів і
-- НАВМИСНО завершується винятком — уся транзакція відкочується.
-- Успіх:  ERROR:  ELO-INTEGRITY: N з N пройдено
-- Числа — з db/elo-config.json (weeklyBudget 200, dayGainCap 45, план 3 → 17).
-- =============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000f101';
  ub uuid := '00000000-0000-4000-8000-00000000f102';
  t date := current_date; y date := current_date - 1;
  wk date := date_trunc('week', current_date)::date;
  r jsonb; out text := E'\n'; okn int := 0; alln int := 0; n int; s int; c boolean; k text; i int;
  kinds1 text; kinds2 text;   -- TST-016: набір нагород до і після повторного закриття
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','eloint-a@local','x',now(),now()),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','eloint-b@local','x',now(),now());
  insert into public.account_status (user_id, status) values (ua,'approved'), (ub,'approved');
  -- A: план 1 (атака), ідеальні факти на y і t
  insert into public.profiles (user_id, data) values (ua, jsonb_build_object(
    'activePlan', jsonb_build_object('days', 1),
    'sessionLog', jsonb_build_object(y::text, '{"total":10,"done":10}'::jsonb, t::text, '{"total":10,"done":5}'::jsonb),
    'mealLog',    jsonb_build_object(y::text, '{"kcal":2500,"target":2500,"p":180,"pTarget":180}'::jsonb),
    'trackers',   '{"sleep":{"goal":480},"steps":{"goal":8000}}'::jsonb,
    'trackerLog', jsonb_build_object('sleep', jsonb_build_object(y::text, 480, t::text, 480),
                                     'steps', jsonb_build_object(y::text, 12000),
                                     'recovery', jsonb_build_object(y::text, 8))));

  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;

  -- ---- F-01: ротація ключів ----
  r := public.elo_submit('sleep','sleep:'||y, y, '{}');
  c := (r->>'delta')::int = 5; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чесний сон = 5' || E'\n';
  s := 0;
  foreach k in array array['', ' ', 'x1', 'SLEEP:'||y, 'ѕleep:'||y, repeat('k',5000), gen_random_uuid()::text, 'week:'||wk, 'cleanday:'||y] loop
    r := public.elo_submit('sleep', k, y, '{}'); s := s + coalesce((r->>'delta')::int, 0);
  end loop;
  select elo into n from public.season_state where user_id = ua and season = season_of(y);
  c := n = 5; alln:=alln+1; okn:=okn+c::int;   -- відповідь duplicate повторює delta події, ELO не росте
  out := out || case when c then 'OK   ' else 'FAIL ' end || '9 повторів з іншими ключами (включно з week:/cleanday:): ELO лишається 5' || E'\n';
  select count(*) into n from public.elo_events where user_id = ua and day = y; c := n = 1; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'одна подія в elo_events, ключ серверний' || E'\n';
  select count(*) into n from public.elo_events where user_id = ua and action_key like 'week:%'; c := n = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'F-B: клієнт не створив service-ключ week:' || E'\n';
  r := public.elo_submit('sleep','sleep:'||y, y, '{"minutes":100000,"goal":1}');
  c := (r->>'duplicate')::boolean is true and (r->>'delta')::int = 5; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'повтор → duplicate, payload ігнорується' || E'\n';

  -- ---- F-A: planned=1 → сервер бере ≥3 і фіксує знімок ----
  r := public.elo_submit('workout','w', y, '{}');
  c := (r->>'delta')::int = 17; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'план=1 у профілі → тренування = 17 (план ≥ 3)' || E'\n';
  reset role;
  update public.profiles set data = jsonb_set(data, '{activePlan,days}', '7') where user_id = ua;
  select planned into n from public.elo_week_plan where user_id = ua and week_start = date_trunc('week', y)::date;
  c := n = 3; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'знімок тижня = 3 і не змінюється правкою профілю' || E'\n';
  /*
   * Знімок ПОТОЧНОГО тижня — теж 3, і теж явно.
   *
   * У понеділок y (вчора) і t (сьогодні) належать РІЗНИМ ISO-тижням, тож
   * для тижня t знімка ще немає, і elo_planned_for створив би його вже з
   * виправленого профілю (days = 7). Реконсиляція нижче рахує від плану,
   * і всі три її перевірки падали рівно щопонеділка — фікстура, а не
   * сервер (TST-015, той самий клас).
   */
  insert into public.elo_week_plan (user_id, week_start, planned)
  values (ua, date_trunc('week', t)::date, 3) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  begin
    perform 1 from public.elo_week_plan; c := false;
  exception when others then c := true; end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'elo_week_plan недоступна клієнту' || E'\n';

  -- ---- Реконсиляція: часткове → повне тренування доплачує різницю ----
  r := public.elo_submit('workout','w2', t, '{}');
  c := (r->>'delta')::int = 9; alln:=alln+1; okn:=okn+c::int;   -- 5/10 → q 0.5 → 8.57 → 9
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'часткове тренування (q .5) = 9' || E'\n';
  reset role;
  update public.profiles set data = jsonb_set(data, array['sessionLog', t::text], '{"total":10,"done":10}'::jsonb) where user_id = ua;
  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  r := public.elo_submit('workout','w3', t, '{}');
  c := (r->>'delta')::int = 8 and (r->>'paid')::int = 17; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'завершене тренування доплачує 8 → paid 17' || E'\n';
  reset role;
  update public.profiles set data = jsonb_set(data, array['sessionLog', t::text], '{"total":10,"done":1}'::jsonb) where user_id = ua;
  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  r := public.elo_submit('workout','w4', t, '{}');
  c := (r->>'duplicate')::boolean is true; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'гірші факти нічого не змінюють (paid ≤ intended)' || E'\n';
  select delta into n from public.elo_events where user_id = ua and event_type = 'workout' and day = t;
  c := n = 17; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'подія дня одна, delta = 17' || E'\n';

  -- ---- Тижневий бюджет тренувань 51 незалежно від плану ----
  r := public.elo_submit('meal','m5', t, '{}');   -- mealLog за сьогодні немає → no_data
  c := r->>'error' = 'no_data'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'без фактів — no_data' || E'\n';

  -- ---- F-03: глобальний тижневий бюджет 200 ----
  reset role;
  -- B: ідеальні факти на весь тиждень (усі 5 категорій щодня)
  insert into public.profiles (user_id, data) select ub, jsonb_build_object(
    'activePlan', '{"days":3}'::jsonb,
    'sessionLog', (select jsonb_object_agg(d::date::text, '{"total":10,"done":10}'::jsonb) from generate_series(wk, wk + 6, '1 day') d),
    'mealLog',    (select jsonb_object_agg(d::date::text, '{"kcal":2500,"target":2500,"p":180,"pTarget":180}'::jsonb) from generate_series(wk, wk + 6, '1 day') d),
    'trackers',   '{"sleep":{"goal":480},"steps":{"goal":8000}}'::jsonb,
    'trackerLog', jsonb_build_object(
      'sleep',    (select jsonb_object_agg(d::date::text, 480) from generate_series(wk, wk + 6, '1 day') d),
      'steps',    (select jsonb_object_agg(d::date::text, 12000) from generate_series(wk, wk + 6, '1 day') d),
      'recovery', (select jsonb_object_agg(d::date::text, 8) from generate_series(wk, wk + 6, '1 day') d)));
  insert into public.season_state (user_id, season, elo) values (ub, season_of(current_date), 0);
  -- Емуляція «майже повного тижня»: 6 інших днів по 30 = 180 із 200.
  insert into public.elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  select ub, season_of(d::date), d::date, 'sleep', 'legacy', 'legacy:'||d::date, 1, 30, 0, 't'
    from generate_series(wk, wk + 6, '1 day') d where d::date <> t;
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  s := 0;
  foreach k in array array['meal','sleep','activity','recovery'] loop
    r := public.elo_submit(k, k, t, '{}'); s := s + coalesce((r->>'delta')::int, 0);
  end loop;
  c := s = 16; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'у межах бюджету нараховується повністю (16)' || E'\n';
  select coalesce(sum(delta),0) into n from public.elo_events where user_id = ub and delta > 0 and category <> 'admin' and day between wk and wk + 6;
  c := n = 199; alln:=alln+1; okn:=okn+c::int;   -- 180 + 16 + cleanday 3
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'тиждень = 199 (з чистим днем)' || E'\n';
  r := public.elo_submit('workout', 'w', t, '{}');
  c := (r->>'delta')::int = 1; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'тренування 17 обрізано до лишку бюджету 1' || E'\n';
  select coalesce(sum(delta),0) into n from public.elo_events where user_id = ub and delta > 0 and category <> 'admin' and day between wk and wk + 6;
  c := n = 200; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'сума позитивного ELO тижня = 200 (weeklyBudget)' || E'\n';
  r := public.elo_submit('sleep', 'again', case when t < wk + 6 then t + 1 else t - 1 end, '{}');
  c := coalesce((r->>'delta')::int, 0) = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'після 200 — +0 навіть за інший день тижня (або no_data поза тижнем)' || E'\n';
  reset role;

  -- ---- F-02: закриття сезону ----
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  r := public.elo_close_season(season_of(current_date));
  c := r->>'error' = 'season_running'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'поточний сезон не закривається' || E'\n';
  r := public.elo_close_season(season_of(current_date + 100));
  c := r->>'error' = 'season_running'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'майбутній сезон не закривається' || E'\n';
  r := public.elo_close_season('WINTER-2030');
  c := r->>'error' = 'season_running'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'далекий майбутній сезон не закривається' || E'\n';
  r := public.elo_close_season('hack'); c := r->>'error' = 'invalid_season'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'невалідний код → invalid_season' || E'\n';
  reset role;
  -- минулий сезон зі станом: закривається, повтор → duplicate, нагороди 1 раз
  insert into public.season_state (user_id, season, elo) values (ub, season_of(current_date - 200), 1234);
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  r := public.elo_close_season(season_of(current_date - 200));
  c := (r->>'ok')::boolean and (r->>'elo')::int = 1234; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'минулий сезон (після вікна) закривається' || E'\n';
  /* Знімок набору нагород ПЕРЕД повторним закриттям (TST-016). */
  select coalesce(string_agg(kind, ',' order by kind), '')
    into kinds1 from public.awards where user_id = ub and season = season_of(current_date - 200);
  r := public.elo_close_season(season_of(current_date - 200));
  c := (r->>'duplicate')::boolean is true; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'повторне закриття → duplicate' || E'\n';
  /*
   * TST-016. Тут стояло count(*) >= 1 — і воно проходило на будь-чому:
   * і на семи нагородах, і на чотирнадцяти (тобто на подвоєнні, від якого
   * перевірка й мала стерегти), і на одній замість рівневих. Тепер
   * порівнюється сам НАБІР до і після повторного закриття.
   */
  select coalesce(string_agg(kind, ',' order by kind), '')
    into kinds2 from public.awards where user_id = ub and season = season_of(current_date - 200);
  c := kinds2 = kinds1 and kinds1 <> '';
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'повторне закриття не додало нагород :: ' || kinds2 || E'\n';

  /* Рівневі нагороди — не «щось видали», а конкретний перелік для 1234 ELO
     (Level 5 = 800, Level 7 = 1200; Level 8 = 1400 вже ні). */
  c := kinds2 like '%level5%' and kinds2 like '%level7%' and kinds2 not like '%level8%';
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'рівневі нагороди відповідають 1234 ELO' || E'\n';
  -- submit у закритий сезон неможливий навіть у вікні (емуляція: історія є)
  reset role;
  insert into public.season_history (user_id, season, final_elo, level, elite, grace_weeks_used, stats)
    values (ua, season_of(current_date), 0, 1, false, 0, '{}');
  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  r := public.elo_submit('sleep', 'x', t, '{}');
  c := r->>'error' = 'season_closed'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'після закриття сезону submit → season_closed' || E'\n';
  reset role;

  -- ---- Тиждень: оцінка з planned зі знімка, week-подія серверна ----
  begin
    insert into public.elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
    values (ua, season_of(current_date), y, 'sleep', 'sleep', 'dup-attempt', 1, 5, 0, 't');
    c := false;
  exception when unique_violation then c := true; end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'DB: друга подія (user, type, day) фізично неможлива' || E'\n';
  begin
    insert into public.elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
    values (ua, season_of(current_date), t, 'bonus', 'week', 'week:x', 0, 9, 0, 't'),
           (ua, season_of(current_date), t, 'bonus', 'cleanday', 'cleanday:x2', 1, 3, 0, 't');
    c := true;
  exception when unique_violation then c := false; end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'DB: week і cleanday в один день не колізують (event_type, не category)' || E'\n';

  raise exception E'ELO-INTEGRITY: % з % пройдено\n%', okn, alln, out;
end $$;
