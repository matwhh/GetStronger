-- =============================================================================
-- Get Stronger: серверний двигун ELO. ЄДИНА точка запису — elo_submit().
-- Конфіг читається з elo_config (дзеркало db/elo-config.json).
-- =============================================================================

-- ЗАСІВ КОНФІГУ — ТІЛЬКИ НА ПОРОЖНЮ БАЗУ (INV-003).
--
-- Тут стояло on conflict do update: повторний прогін файла ЗАТИРАВ бойовий
-- конфіг цим рядком. А рядок відставав — у ньому не було блоку floors
-- (sleepMax, stepsMax, sleepGoalMin, stepsGoalMin, workoutTotalMin), тож
-- elo_facts тихо переходила на дефолти з коду. Сьогодні вони збігаються,
-- завтрашні зміни floors зникли б без сліду — рівно той сценарій, яким із
-- продакшену колись зник guard NOT_APPROVED (INV-002, DB-007).
--
-- Тепер do nothing: файл засіває конфіг там, де його ще немає, і не чіпає
-- там, де він уже є. Зміна конфігу — окремою міграцією.
--
-- Значення — рівно db/elo-config.json (tests/elo-config-sync.test.js
-- звіряє їх посимвольно й валить збірку при розбіжності).
insert into public.elo_config (id, data) values (1, '{"version":3,"seasonMax":3000,"levelSize":240,"levelCount":10,"levelPace":[2.1,1.9,1.75,1.6,1.45,1.3,1.2,1.1,1.0,0.9],"elitePace":0.8,"eliteFloor":2400,"weeklyBudget":200,"weights":{"training":0.3,"nutrition":0.3,"sleep":0.2,"recovery":0.1,"activity":0.1},"categoryShare":0.857,"cleanDayBonus":3,"cleanWeekBonus":9,"cleanThreshold":0.9,"nutritionSplit":{"kcal":0.55,"protein":0.45},"tolerance":{"training":[[0.99,1.0],[0.97,0.82],[0.9,0.45],[0.8,0.45],[0.65,0.3],[0.5,0.12],[0,0.05]],"kcalBand":[[0.02,1.0],[0.05,0.82],[0.1,0.5],[0.2,0.45],[0.35,0.15],[1,0.05]],"protein":[[0.99,1.0],[0.95,0.82],[0.85,0.5],[0.7,0.45],[0.5,0.15],[0,0.05]],"sleep":[[0.99,1.0],[0.97,0.82],[0.9,0.55],[0.8,0.5],[0.65,0.22],[0,0.05]],"activity":[[0.99,1.0],[0.97,0.82],[0.85,0.5],[0.7,0.45],[0.5,0.15],[0,0.05]]},"recoveryFillShare":0.6,"recoveryGoodValue":7,"missedWorkoutPenalty":-8,"openMealPenalty":-3,"dayLossFloor":-15,"dayGainCap":45,"graceWeeksPerSeason":2,"graceDays":7,"submitWindowDays":2,"minUsersForPercentile":8,"leaderboardTops":[0.1,0.05,0.01],"leaderboardRanks":[1000,100,10,3,1],"floors":{"sleepGoalMin":240,"sleepMax":960,"stepsGoalMin":3000,"stepsMax":100000,"workoutTotalMin":3}}'::jsonb)
on conflict (id) do nothing;

-- Драбина якості: масив [[поріг, множник], ...] згори вниз
create or replace function public.elo_ladder(steps jsonb, x numeric)
returns numeric language sql immutable as $$
  select coalesce(
    (select (s->1)::numeric from jsonb_array_elements(steps) s
      where x >= (s->0)::numeric
      order by (s->0)::numeric desc limit 1),
    (select (s->1)::numeric from jsonb_array_elements(steps) s
      order by (s->0)::numeric asc limit 1)
  );
$$;

-- Смуга відхилення (калорії): менше відхилення — краще
create or replace function public.elo_band(steps jsonb, dev numeric)
returns numeric language sql immutable as $$
  select coalesce(
    (select (s->1)::numeric from jsonb_array_elements(steps) s
      where dev <= (s->0)::numeric
      order by (s->0)::numeric asc limit 1),
    (select (s->1)::numeric from jsonb_array_elements(steps) s
      order by (s->0)::numeric desc limit 1)
  );
$$;

-- Дельта однієї дії. Дзеркало js/elo-core.js → actionDelta().
create or replace function public.elo_action_delta(
  kind text, payload jsonb, cfg jsonb, planned_days int, grace boolean
) returns table (quality numeric, delta int)
language plpgsql immutable as $$
declare
  weekly numeric := (cfg->>'weeklyBudget')::numeric * (cfg->>'categoryShare')::numeric;
  daily  numeric;
  q numeric := 0; m numeric := 0; d numeric := 0;
  target numeric; ptarget numeric; dev numeric; qk numeric := 0; qp numeric := 0;
begin
  if kind = 'workout' then
    if grace then quality := 0; delta := 0; return next; return; end if;
    q := least(1, greatest(0, coalesce((payload->>'done')::numeric, 0)
         / greatest(1, coalesce((payload->>'total')::numeric, 0))));
    m := public.elo_ladder(cfg#>'{tolerance,training}', q);
    d := weekly * (cfg#>>'{weights,training}')::numeric / greatest(1, planned_days) * m;
  elsif kind = 'meal' then
    daily := weekly * (cfg#>>'{weights,nutrition}')::numeric / 7;
    target  := coalesce((payload->>'target')::numeric, 0);
    ptarget := coalesce((payload->>'proteinTarget')::numeric, 0);
    if target > 0 then
      dev := abs(coalesce((payload->>'kcal')::numeric, 0) - target) / target;
      qk := public.elo_band(cfg#>'{tolerance,kcalBand}', dev);
    end if;
    if ptarget > 0 then
      qp := public.elo_ladder(cfg#>'{tolerance,protein}',
        least(1, greatest(0, coalesce((payload->>'protein')::numeric, 0) / ptarget)));
    end if;
    m := qk * (cfg#>>'{nutritionSplit,kcal}')::numeric + qp * (cfg#>>'{nutritionSplit,protein}')::numeric;
    q := m; d := daily * m;
  elsif kind = 'sleep' then
    daily := weekly * (cfg#>>'{weights,sleep}')::numeric / 7;
    q := least(1, greatest(0, coalesce((payload->>'minutes')::numeric, 0)
         / greatest(1, coalesce((payload->>'goal')::numeric, 480))));
    m := public.elo_ladder(cfg#>'{tolerance,sleep}', q);
    d := daily * m;
  elsif kind = 'recovery' then
    daily := weekly * (cfg#>>'{weights,recovery}')::numeric / 7;
    if payload->>'value' is null then q := 0; d := 0;
    else
      m := (cfg->>'recoveryFillShare')::numeric
         + case when (payload->>'value')::numeric >= (cfg->>'recoveryGoodValue')::numeric
                then 1 - (cfg->>'recoveryFillShare')::numeric else 0 end;
      q := m; d := daily * m;
    end if;
  elsif kind = 'activity' then
    daily := weekly * (cfg#>>'{weights,activity}')::numeric / 7;
    q := least(1, greatest(0, coalesce((payload->>'steps')::numeric, 0)
         / greatest(1, coalesce((payload->>'goal')::numeric, 10000))));
    m := public.elo_ladder(cfg#>'{tolerance,activity}', q);
    d := daily * m;
  end if;
  quality := round(q, 3); delta := round(d)::int;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- ГОЛОВНА: подати дію. Ідемпотентно; сервер сам рахує дельту і стелі.
-- -----------------------------------------------------------------------------
create or replace function public.elo_submit(
  p_kind text, p_action_key text, p_day date, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cfg jsonb;
  szn text;
  st season_state;
  planned int;
  grace boolean := false;
  q numeric; d int;
  day_sum int;
  reason text;
  cat text;
  existing elo_events;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  /* Барʼєр повернено (INV-002 / DB-013): у базі він є з міграцій
     elo_approved_guard/elo_approved_guard2, а в цьому файлі його не було —
     виконання файла «щоб оновити функції» знімало перевірку з продакшену. */
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  if p_kind not in ('workout','meal','sleep','recovery','activity') then
    raise exception 'unknown kind %', p_kind;
  end if;

  select data into cfg from elo_config where id = 1;
  szn := season_of(p_day);

  -- Дія має бути «зараз»: сезон поточний, день у вікні ±submitWindowDays
  if szn <> season_of(current_date)
     or p_day > current_date + 1
     or p_day < current_date - (cfg->>'submitWindowDays')::int then
    return jsonb_build_object('ok', false, 'error', 'out_of_window');
  end if;

  -- Ідемпотентність: та сама дія вдруге повертає перший результат
  select * into existing from elo_events where user_id = uid and action_key = p_action_key;
  if found then
    select * into st from season_state where user_id = uid and season = szn;
    return jsonb_build_object('ok', true, 'duplicate', true,
      'delta', existing.delta, 'elo', coalesce(st.elo, existing.elo_after));
  end if;

  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;

  grace := st.grace_until is not null and p_day <= st.grace_until;
  planned := coalesce((select greatest(1, least(7,
      coalesce((data#>>'{activePlan,days}')::int, (data->>'daysPerWeek')::int, 3)))
    from profiles where user_id = uid), 3);

  select t.quality, t.delta into q, d
  from elo_action_delta(p_kind, p_payload, cfg, planned, grace) t;

  -- Денна стеля здобутків: сума додатних подій дня не вище dayGainCap
  select coalesce(sum(delta), 0) into day_sum
  from elo_events where user_id = uid and season = szn and day = p_day and delta > 0;
  if d > 0 then
    d := least(d, greatest(0, (cfg->>'dayGainCap')::int - day_sum));
  end if;

  cat := case p_kind when 'workout' then 'training'
                     when 'meal' then 'nutrition'
                     else p_kind end;
  reason := case p_kind
    when 'workout' then 'Тренування виконано'
    when 'meal' then 'День харчування закрито'
    when 'sleep' then 'Сон записано'
    when 'recovery' then 'Recovery відмічено'
    else 'Активність записана' end;

  update season_state
    set elo = least((cfg->>'seasonMax')::int, greatest(0, elo + d)),
        today_delta = case when today_date = current_date then today_delta + d else d end,
        today_date = current_date,
        updated_at = now()
    where user_id = uid and season = szn
    returning * into st;

  insert into elo_events (user_id, season, day, category, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_day, cat, p_action_key, q, d, st.elo, reason);

  -- Бонус чистого дня: всі потрібні категорії дня з quality >= порога
  perform elo_try_clean_day(uid, szn, p_day, cfg, planned, grace);
  select * into st from season_state where user_id = uid and season = szn;

  return jsonb_build_object('ok', true, 'delta', d, 'quality', q,
    'elo', st.elo, 'today', st.today_delta, 'grace', grace);
end;
$$;

-- Чистий день: окремою функцією, викликається після кожного submit
create or replace function public.elo_try_clean_day(
  uid uuid, szn text, p_day date, cfg jsonb, planned int, grace boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  need int;
  got int;
  bonus int;
  st season_state;
begin
  if exists (select 1 from elo_events where user_id = uid and action_key = 'cleanday:' || p_day) then
    return;
  end if;
  -- Тренувальний день = день, коли подано workout. Потрібні категорії:
  -- nutrition, sleep, recovery, activity (+ training, якщо він був)
  select count(distinct category) into got
  from elo_events
  where user_id = uid and season = szn and day = p_day
    and category in ('nutrition','sleep','recovery','activity')
    and quality >= (cfg->>'cleanThreshold')::numeric;
  need := 4;
  if got < need then return; end if;
  if not grace and exists (
       select 1 from elo_events
       where user_id = uid and season = szn and day = p_day
         and category = 'training' and quality < (cfg->>'cleanThreshold')::numeric) then
    return;
  end if;

  bonus := (cfg->>'cleanDayBonus')::int;
  update season_state
    set elo = least((cfg->>'seasonMax')::int, elo + bonus),
        today_delta = case when today_date = current_date then today_delta + bonus else bonus end,
        today_date = current_date, updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  insert into elo_events (user_id, season, day, category, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_day, 'bonus', 'cleanday:' || p_day, 1, bonus, st.elo, 'Чистий день — усі цілі закриті');
end;
$$;

-- -----------------------------------------------------------------------------
-- Тижнева оцінка: штраф за недобір тренувань + бонус чистого тижня.
-- Викликається ліниво з клієнта для МИНУЛОГО тижня (пн..нд); ідемпотентно.
-- -----------------------------------------------------------------------------
create or replace function public.elo_evaluate_week(p_week_start date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cfg jsonb; szn text;
  st season_state;
  planned int; done int; meals int;
  grace_days int := 0;
  expected int; missed int;
  pen int := 0; bon int := 0; d int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  /* Барʼєр повернено (INV-002 / DB-013): у базі він є з міграцій
     elo_approved_guard/elo_approved_guard2, а в цьому файлі його не було —
     виконання файла «щоб оновити функції» знімало перевірку з продакшену. */
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  if extract(isodow from p_week_start) <> 1 then
    return jsonb_build_object('ok', false, 'error', 'not_monday');
  end if;
  if p_week_start + 6 >= current_date then
    return jsonb_build_object('ok', false, 'error', 'week_not_over');
  end if;
  szn := season_of(p_week_start + 6);
  if szn <> season_of(current_date) then
    return jsonb_build_object('ok', false, 'error', 'other_season');
  end if;
  if exists (select 1 from elo_events where user_id = uid and action_key = 'week:' || p_week_start) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select data into cfg from elo_config where id = 1;
  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;

  planned := coalesce((select greatest(1, least(7,
      coalesce((data#>>'{activePlan,days}')::int, (data->>'daysPerWeek')::int, 3)))
    from profiles where user_id = uid), 3);

  select count(*) into done from elo_events
    where user_id = uid and category = 'training' and quality >= 0.5
      and day between p_week_start and p_week_start + 6;
  select count(distinct day) into meals from elo_events
    where user_id = uid and category = 'nutrition'
      and day between p_week_start and p_week_start + 6;

  if st.grace_until is not null then
    grace_days := greatest(0, least(st.grace_until, p_week_start + 6)::date
                            - greatest(st.grace_until - ((cfg->>'graceDays')::int - 1), p_week_start)::date + 1);
  end if;

  expected := round(planned * (1 - grace_days / 7.0));
  missed := greatest(0, expected - done);
  pen := missed * (cfg->>'missedWorkoutPenalty')::int;
  if done >= planned and meals >= 7 then bon := (cfg->>'cleanWeekBonus')::int; end if;
  d := pen + bon;

  update season_state
    set elo = least((cfg->>'seasonMax')::int, greatest(0, elo + d)), updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  insert into elo_events (user_id, season, day, category, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_week_start + 6,
          case when d >= 0 then 'bonus' else 'penalty' end,
          'week:' || p_week_start, 0, d, st.elo,
          case when bon > 0 then 'Чистий тиждень — план закрито повністю'
               when missed > 0 then 'Недобір тренувань: ' || missed || ' пропуск(и)'
               else 'Тиждень оцінено' end);
  return jsonb_build_object('ok', true, 'delta', d, 'elo', st.elo, 'missed', missed, 'cleanWeek', bon > 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grace Week: активація. 2 на сезон, по 7 днів, без дострокового скасування.
-- -----------------------------------------------------------------------------
create or replace function public.elo_activate_grace()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cfg jsonb; szn text := season_of(current_date);
  st season_state;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  /* БАРʼЄР ДОДАНО НАЗАД (INV-002 / DB-013, аудит 2026-09). Він живе в
     базі з міграцій elo_approved_guard/elo_approved_guard2, а в цьому
     файлі його не було — тобто виконання цього файла «щоб оновити
     функції» ЗНІМАЛО перевірку з продакшену: непідтверджений акаунт
     отримував доступ до сезонних RPC. Файл і база тепер збігаються. */
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;
  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;

  if st.grace_until is not null and st.grace_until >= current_date then
    return jsonb_build_object('ok', false, 'error', 'already_active', 'until', st.grace_until);
  end if;
  if st.grace_used >= (cfg->>'graceWeeksPerSeason')::int then
    return jsonb_build_object('ok', false, 'error', 'exhausted');
  end if;

  update season_state
    set grace_used = grace_used + 1,
        grace_until = current_date + ((cfg->>'graceDays')::int - 1),
        updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  return jsonb_build_object('ok', true, 'until', st.grace_until,
    'remaining', (cfg->>'graceWeeksPerSeason')::int - st.grace_used);
end;
$$;

-- -----------------------------------------------------------------------------
-- Мій стан сезону + ранг (одним запитом для бейджа/сторінки сезону)
-- -----------------------------------------------------------------------------
create or replace function public.elo_state()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  szn text := season_of(current_date);
  st season_state;
  my_rank int; total int;
  cfg jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  /* БАРʼЄР ДОДАНО НАЗАД (INV-002 / DB-013, аудит 2026-09). Він живе в
     базі з міграцій elo_approved_guard/elo_approved_guard2, а в цьому
     файлі його не було — тобто виконання цього файла «щоб оновити
     функції» ЗНІМАЛО перевірку з продакшену: непідтверджений акаунт
     отримував доступ до сезонних RPC. Файл і база тепер збігаються. */
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;
  select * into st from season_state where user_id = uid and season = szn;
  select count(*) into total from season_state where season = szn;
  if st is null then
    return jsonb_build_object('season', szn, 'elo', 0, 'today', 0,
      'graceUsed', 0, 'graceUntil', null, 'rank', null, 'of', total, 'config', cfg);
  end if;
  select r into my_rank from (
    select user_id, rank() over (order by elo desc) r from season_state where season = szn
  ) x where x.user_id = uid;
  return jsonb_build_object('season', szn, 'elo', st.elo,
    'today', case when st.today_date = current_date then st.today_delta else 0 end,
    'graceUsed', st.grace_used,
    'graceUntil', case when st.grace_until >= current_date then st.grace_until else null end,
    'rank', my_rank, 'of', total, 'config', cfg);
end;
$$;

-- Лідерборд сезону: топ N + мій рядок
-- УВАГА: обидві функції нижче ПЕРЕВИЗНАЧЕНІ пізнішими міграціями —
-- db/account-approval.sql (перевірка is_approved) і db/leaderboard-name.sql
-- (ім'я береться із затвердженого account_status.username). Порядок при
-- чистій установці: цей файл → account-approval.sql → leaderboard-name.sql.
create or replace function public.elo_leaderboard(p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  szn text := season_of(current_date);
  rows jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* Барʼєр повернено (INV-002 / DB-013): у базі він є з міграцій
     elo_approved_guard/elo_approved_guard2, а в цьому файлі його не було —
     виконання файла «щоб оновити функції» знімало перевірку з продакшену. */
  if not public.is_approved(auth.uid()) then raise exception 'NOT_APPROVED'; end if;
  select jsonb_agg(jsonb_build_object('rank', r, 'name', name, 'elo', elo,
                                      'me', user_id = auth.uid()) order by r)
    into rows
  from (
    select user_id, coalesce(nullif(display_name, ''), 'Атлет') as name, elo,
           rank() over (order by elo desc) as r
    from season_state where season = szn
  ) x
  where x.r <= p_limit or x.user_id = auth.uid();
  return coalesce(rows, '[]'::jsonb);
end;
$$;

-- Імʼя для лідерборду (з профілю)
create or replace function public.elo_set_name(p_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  /* Барʼєр повернено (INV-002 / DB-013): у базі він є з міграцій
     elo_approved_guard/elo_approved_guard2, а в цьому файлі його не було —
     виконання файла «щоб оновити функції» знімало перевірку з продакшену. */
  if not public.is_approved(auth.uid()) then raise exception 'NOT_APPROVED'; end if;
  update season_state set display_name = left(coalesce(p_name, ''), 24)
  where user_id = auth.uid() and season = season_of(current_date);
end;
$$;

-- -----------------------------------------------------------------------------
-- Закриття сезону: викликається ліниво при першому заході після кінця.
-- Пише season_history + awards; ідемпотентно.
-- -----------------------------------------------------------------------------
create or replace function public.elo_close_season(p_season text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cfg jsonb; st season_state;
  my_rank int; total int; pctl numeric;
  lvl int; elite boolean;
  d_active int; d_total int;
  stats jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  /* Барʼєр повернено (INV-002 / DB-013): у базі він є з міграцій
     elo_approved_guard/elo_approved_guard2, а в цьому файлі його не було —
     виконання файла «щоб оновити функції» знімало перевірку з продакшену. */
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  if p_season = season_of(current_date) then
    return jsonb_build_object('ok', false, 'error', 'season_running');
  end if;
  if exists (select 1 from season_history where user_id = uid and season = p_season) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into st from season_state where user_id = uid and season = p_season;
  if st is null then return jsonb_build_object('ok', false, 'error', 'no_data'); end if;

  select data into cfg from elo_config where id = 1;
  select count(*) into total from season_state where season = p_season;
  select r into my_rank from (
    select user_id, rank() over (order by elo desc) r from season_state where season = p_season
  ) x where x.user_id = uid;
  pctl := case when total >= (cfg->>'minUsersForPercentile')::int
               then round(my_rank::numeric / total * 100, 1) else null end;
  lvl := least((cfg->>'levelCount')::int, floor(st.elo / (cfg->>'levelSize')::int)::int + 1);
  elite := st.elo >= (cfg->>'eliteFloor')::int;

  select count(distinct day) into d_active from elo_events
    where user_id = uid and season = p_season and delta > 0;
  d_total := 92;

  select coalesce(jsonb_object_agg(category, s), '{}'::jsonb) into stats from (
    select category, jsonb_build_object('events', count(*), 'elo', sum(delta),
                                        'avgQuality', round(avg(quality), 2)) s
    from elo_events where user_id = uid and season = p_season
      and category in ('training','nutrition','sleep','recovery','activity')
    group by category
  ) g;

  -- §19: денні екстремуми і най-/найслабша категорія — у stats і в звіт
  stats := stats || coalesce((
    select jsonb_build_object('biggestGain', max(s), 'biggestLoss', least(min(s), 0))
    from (select day, sum(delta) s from elo_events
          where user_id = uid and season = p_season group by day) dd
  ), '{}'::jsonb);
  stats := stats || coalesce((
    select jsonb_build_object(
      'bestCategory', (array_agg(category order by aq desc))[1],
      'weakestCategory', (array_agg(category order by aq asc))[1])
    from (select category, avg(quality) aq from elo_events
          where user_id = uid and season = p_season
            and category in ('training','nutrition','sleep','recovery','activity')
          group by category) c
  ), '{}'::jsonb);

  insert into season_history (user_id, season, final_elo, level, elite, rank, of_users,
                              percentile, days_active, days_total, grace_weeks_used, stats)
  values (uid, p_season, st.elo, lvl, elite, my_rank, total, pctl, d_active, d_total, st.grace_used, stats);

  -- Нагороди рівнів
  if lvl >= 5  then insert into awards values (uid, p_season, 'level5',  'Season Badge') on conflict do nothing; end if;
  if lvl >= 7  then insert into awards values (uid, p_season, 'level7',  'Profile Frame') on conflict do nothing; end if;
  if lvl >= 8  then insert into awards values (uid, p_season, 'level8',  'Seasonal Cosmetic') on conflict do nothing; end if;
  if lvl >= 9  then insert into awards values (uid, p_season, 'level9',  'Exclusive Reward') on conflict do nothing; end if;
  if lvl >= 10 then insert into awards values (uid, p_season, 'level10', 'Legendary Season Reward') on conflict do nothing; end if;
  if elite     then insert into awards values (uid, p_season, 'elite',   'ELITE 2000+') on conflict do nothing; end if;
  -- Ранги
  if my_rank = 1 then insert into awards values (uid, p_season, 'first', '#1 сезону') on conflict do nothing; end if;
  if my_rank <= 3 then insert into awards values (uid, p_season, 'top3', 'Top 3') on conflict do nothing; end if;
  if my_rank <= 10 then insert into awards values (uid, p_season, 'top10', 'Top 10') on conflict do nothing; end if;
  if my_rank <= 100 then insert into awards values (uid, p_season, 'top100', 'Top 100') on conflict do nothing; end if;
  if my_rank <= 1000 then insert into awards values (uid, p_season, 'top1000', 'Top 1000') on conflict do nothing; end if;
  if pctl is not null and pctl <= 10 then insert into awards values (uid, p_season, 'top10pct', 'Top 10%') on conflict do nothing; end if;
  if pctl is not null and pctl <= 5  then insert into awards values (uid, p_season, 'top5pct',  'Top 5%') on conflict do nothing; end if;
  if pctl is not null and pctl <= 1  then insert into awards values (uid, p_season, 'top1pct',  'Top 1%') on conflict do nothing; end if;

  return jsonb_build_object('ok', true, 'elo', st.elo, 'level', lvl, 'elite', elite,
    'rank', my_rank, 'of', total, 'percentile', pctl,
    'daysActive', d_active, 'daysTotal', d_total, 'graceUsed', st.grace_used, 'stats', stats);
end;
$$;

grant execute on function public.elo_submit(text, text, date, jsonb) to authenticated;
grant execute on function public.elo_evaluate_week(date) to authenticated;
grant execute on function public.elo_activate_grace() to authenticated;
grant execute on function public.elo_state() to authenticated;
grant execute on function public.elo_leaderboard(int) to authenticated;
grant execute on function public.elo_set_name(text) to authenticated;
grant execute on function public.elo_close_season(text) to authenticated;
revoke execute on all functions in schema public from anon;
