-- =============================================================================
-- ТЕМП ЗА РІВНЕМ: на початку швидко, далі важче
-- Міграція: elo_pace
-- =============================================================================
--
-- ЩО БУЛО. Бюджет плаский: 200 ELO на тиждень і на першому рівні, і на
-- девʼятому. Наслідків два, обидва погані.
--
-- Старт нудний. Два тижні бездоганної роботи — коли звички ще немає і
-- кинути найлегше — давали Level 2 із десяти. Нагорода за найважчий
-- період була найменшою.
--
-- Верх шкали не належав нікому. Сильний гравець із 90–95% виконання
-- закінчував сезон на ~1800 із 2500: верхня третина існувала лише на
-- папері, а «відоме відхилення TST-011» роками стояло в списку боргів
-- саме про це.
--
-- ЩО РОБИМО. Множник темпу за рівнем (levelPace у конфігу). На першому
-- рівні дія коштує вдвічі більше, ніж давала стара плоска шкала; на
-- десятому — стільки ж; в ELITE менше. Шкала розтягнута разом із темпом:
-- стеля 3000 замість 2500, ELITE від 2400 замість 2000, рівень по 240
-- замість 200 — інакше при новому темпі навіть середній гравець залітав
-- у ELITE, і верх переставав щось означати.
--
-- ШТРАФИ НЕ МАСШТАБУЮТЬСЯ. Пропущене тренування коштує ті самі −8 і на
-- другому рівні, і на девʼятому. Разом зі спадним темпом це і дає «далі
-- тільки важче»: нагорода меншає, ціна помилки — ні.
--
-- ТРИ МІСЦЯ, А НЕ ОДНЕ. Темп множить тижневий бюджет (elo_action_delta),
-- тижневу стелю (elo_week_room) і стелю дня (elo_submit,
-- elo_try_clean_day). Забути будь-яке — і крива не працює: перші два
-- підбори впирались саме в плаский dayGainCap, який зрізав увесь розгін
-- до сорока пʼяти очок на добу.
--
-- ДЗЕРКАЛО КЛІЄНТА. Те саме рахує js/elo-core.js (pace, weeklyBudget,
-- applyDayCaps). Розбіжність ловить tools/verify-elo-week.mjs — він
-- звіряє SQL із JS на тих самих даних.
--
-- Баланс підібрано симуляцією: tools/simelo.mjs, 400 сезонів на профіль.
-- Бездоганний бере 5-й рівень за 21 день і закінчує на ~2980; сильний
-- (90–95%) — 2400; середній (70–80%) — ~1550 і в ELITE не потрапляє.
-- =============================================================================

-- 1. Крива темпу. Індекс масиву 0-based, рівні 1-based — звідси -1.
create or replace function public.elo_pace(p_elo numeric, cfg jsonb)
returns numeric
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_elo is null then 1
    when cfg->'levelPace' is null or jsonb_typeof(cfg->'levelPace') <> 'array' then 1
    when p_elo >= (cfg->>'eliteFloor')::numeric
      then coalesce((cfg->>'elitePace')::numeric, 1)
    else coalesce(
      (cfg->'levelPace' ->> (
        least((cfg->>'levelCount')::int,
              floor(greatest(0, p_elo) / (cfg->>'levelSize')::numeric)::int + 1) - 1
      ))::numeric, 1)
  end;
$function$;
grant execute on function public.elo_pace(p_elo numeric, cfg jsonb) to service_role;

-- 2. Вартість дії залежить від рівня.
CREATE OR REPLACE FUNCTION public.elo_action_delta(kind text, payload jsonb, cfg jsonb, planned_days integer, grace boolean, p_elo numeric)
 RETURNS TABLE(quality numeric, delta integer)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  -- Темп за рівнем: та сама крива, що в js/elo-core.js (pace). Множиться
  -- саме тижневий бюджет, тож усі пʼять категорій масштабуються разом.
  weekly numeric := (cfg->>'weeklyBudget')::numeric * public.elo_pace(p_elo, cfg)
                    * (cfg->>'categoryShare')::numeric;
  daily  numeric;
  q numeric := 0; m numeric := 0; d numeric := 0;
  target numeric; ptarget numeric; dev numeric; qk numeric := 0; qp numeric := 0;
  ksh numeric; psh numeric;
begin
  if kind = 'workout' then
    if grace then quality := 0; delta := 0; return next; return; end if;
    if coalesce((payload->>'totalSets')::numeric, 0) > 0 then
      q := least(1, greatest(0, coalesce((payload->>'doneSets')::numeric, 0)
           / (payload->>'totalSets')::numeric));
    else
      q := least(1, greatest(0, coalesce((payload->>'done')::numeric, 0)
           / greatest(1, coalesce((payload->>'total')::numeric, 0))));
    end if;
    m := q;
    d := weekly * (cfg#>>'{weights,training}')::numeric / greatest(1, planned_days) * m;
  elsif kind = 'meal' then
    daily := weekly * (cfg#>>'{weights,nutrition}')::numeric / 7;
    target  := coalesce((payload->>'target')::numeric, 0);
    ptarget := coalesce((payload->>'proteinTarget')::numeric, 0);
    ksh := (cfg#>>'{nutritionSplit,kcal}')::numeric;
    psh := (cfg#>>'{nutritionSplit,protein}')::numeric;
    if ptarget <= 0 then ksh := 1; psh := 0; end if;
    if target > 0 then
      dev := abs(coalesce((payload->>'kcal')::numeric, 0) - target) / target;
      qk := public.elo_band(cfg#>'{tolerance,kcalBand}', dev);
    end if;
    if ptarget > 0 then
      qp := public.elo_ladder(cfg#>'{tolerance,protein}',
        least(1, greatest(0, coalesce((payload->>'protein')::numeric, 0) / ptarget)));
    end if;
    m := qk * ksh + qp * psh;
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
$function$
;
grant execute on function public.elo_action_delta(kind text, payload jsonb, cfg jsonb, planned_days integer, grace boolean, p_elo numeric) to service_role;

-- 3. Тижнева стеля — теж за темпом.
CREATE OR REPLACE FUNCTION public.elo_week_room(uid uuid, p_day date, cfg jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cur numeric;
  spent int;
begin
  -- ЧОМУ plpgsql, А НЕ sql. Тіло sql-функції розбирається в момент
  -- створення, а season_of у знімку схеми оголошена нижче: дамп
  -- упорядкований за іменами, а не за залежностями. Плоска версія цієї
  -- функції залежностей не мала й проблеми не помічала; щойно зʼявився
  -- темп за рівнем — розгортання знімка впало на «function does not exist».
  select s.elo into cur from season_state s
    where s.user_id = uid and s.season = public.season_of(p_day);
  select coalesce(sum(delta), 0) into spent from elo_events
    where user_id = uid and delta > 0 and category <> 'admin'
      and day between date_trunc('week', p_day)::date and date_trunc('week', p_day)::date + 6;
  -- Тижнева стеля масштабується темпом так само, як вартість дії:
  -- інакше на першому рівні дії дорожчі, а кімнати під них немає.
  return greatest(0, floor((cfg ->> 'weeklyBudget')::numeric
                           * public.elo_pace(cur, cfg))::int - spent);
end;
$function$
;
grant execute on function public.elo_week_room(uid uuid, p_day date, cfg jsonb) to service_role;

-- 4. Нарахування дії: стеля дня й тижневий бюджет тренувань за темпом.
CREATE OR REPLACE FUNCTION public.elo_submit(p_kind text, p_action_key text, p_day date, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  cfg jsonb; szn text; st season_state;
  planned int; grace boolean := false;
  facts jsonb; has_row boolean;
  q numeric; d int; inc int; paid int := 0;
  day_sum int; week_spent int; week_budget int; room int;
  wk_start date;
  reason text; cat text; skey text;
  existing elo_events;
  ins_id bigint;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  if p_kind not in ('workout','meal','sleep','recovery','activity') then
    raise exception 'unknown kind %', p_kind;
  end if;
  if p_day is null then raise exception 'BAD_DAY'; end if;
  select data into cfg from elo_config where id = 1;
  szn := season_of(p_day);
  if p_day > current_date + 1
     or p_day < current_date - (cfg->>'submitWindowDays')::int
     or szn not in (season_of(current_date), season_of(current_date + 1), season_of(current_date - 1)) then
    return jsonb_build_object('ok', false, 'error', 'out_of_window');
  end if;
  if exists (select 1 from season_history where user_id = uid and season = szn) then
    return jsonb_build_object('ok', false, 'error', 'season_closed');
  end if;
  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;
  skey := p_kind || ':' || p_day;
  select * into existing from elo_events where user_id = uid and event_type = p_kind and day = p_day;
  if found then paid := greatest(0, existing.delta); end if;
  perform public.elo_catch_up_weeks(uid, szn, cfg);
  select * into st from season_state where user_id = uid and season = szn for update;
  grace := st.grace_until is not null and p_day <= st.grace_until;
  planned := public.elo_planned_for(uid, p_day);
  facts := public.elo_facts(uid, p_kind, p_day, cfg);
  if facts is null then
    if existing.id is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'delta', existing.delta, 'elo', st.elo);
    end if;
    -- INV-004: «даних ще немає» і «даних не дотягує до порога» — різні речі.
    -- Друге повторювати марно: день від повторного запиту більшим не стане,
    -- а клієнт повторював його на КОЖЕН Store.onChange протягом трьох днів.
    select (data #> array[case p_kind
                            when 'workout' then 'sessionLog'
                            when 'meal'    then 'mealLog'
                            else 'trackerLog' end,
                          p_day::text]) is not null
      into has_row from profiles where user_id = uid;
    return jsonb_build_object('ok', false, 'error', 'no_data',
                              'retry', not coalesce(has_row, false));
  end if;
  select t.quality, t.delta into q, d
  from elo_action_delta(p_kind, facts, cfg, planned, grace, st.elo) t;
  inc := greatest(0, d - paid);
  if p_kind = 'workout' and inc > 0 then
    wk_start := date_trunc('week', p_day)::date;
    select coalesce(sum(delta), 0) into week_spent
      from elo_events
      where user_id = uid and season = szn and category = 'training' and delta > 0
        and day between wk_start and wk_start + 6;
    week_budget := round(
      (cfg->>'weeklyBudget')::numeric * public.elo_pace(st.elo, cfg)
      * (cfg->>'categoryShare')::numeric
      * (cfg#>>'{weights,training}')::numeric)::int;
    inc := least(inc, greatest(0, week_budget - week_spent));
  end if;
  if inc > 0 then
    select coalesce(sum(delta), 0) into day_sum
    from elo_events
    where user_id = uid and season = szn and day = p_day and delta > 0 and category <> 'admin';
    -- Стеля дня масштабується темпом, підлога втрат — ні: інакше плаский
    -- dayGainCap зрізав би весь розгін перших рівнів (див. js/elo-core.js,
    -- applyDayCaps).
    room := least(greatest(0, round((cfg->>'dayGainCap')::numeric
                                    * public.elo_pace(st.elo, cfg))::int - day_sum),
                  public.elo_week_room(uid, p_day, cfg));
    inc := least(inc, room);
  end if;

  -- DB-006: стеля сезону зрізає ДЕЛЬТУ, а не стан. Інакше при 2495 ELO
  -- нарахування +9 давало стан 2500, а в журналі лишалось +9 — і sum(delta)
  -- переставала дорівнювати season_state.elo назавжди.
  inc := least((cfg->>'seasonMax')::int, greatest(0, st.elo + inc)) - st.elo;

  if existing.id is not null then
    if inc <= 0 then
      return jsonb_build_object('ok', true, 'duplicate', true, 'delta', existing.delta, 'elo', st.elo);
    end if;
    update season_state
      set elo = least((cfg->>'seasonMax')::int, greatest(0, elo + inc)),
          today_delta = case when today_date = current_date then today_delta + inc else inc end,
          today_date = current_date, updated_at = now()
      where user_id = uid and season = szn
      returning * into st;
    update elo_events
      set delta = delta + inc, quality = q, elo_after = st.elo
      where id = existing.id;
    perform elo_try_clean_day(uid, szn, p_day, cfg, planned, grace);
    select * into st from season_state where user_id = uid and season = szn;
    return jsonb_build_object('ok', true, 'delta', inc, 'reconciled', true, 'paid', paid + inc,
      'quality', q, 'elo', st.elo, 'today', st.today_delta, 'grace', grace);
  end if;
  d := inc;
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
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_day, cat, p_kind, skey, q, d, st.elo, reason)
  on conflict do nothing
  returning id into ins_id;
  if ins_id is null then
    -- Тепер відкат точний: d уже зрізаний, тому «elo - d» повертає рівно
    -- те значення, що було до оновлення (DB-006).
    update season_state
      set elo = least((cfg->>'seasonMax')::int, greatest(0, elo - d)),
          today_delta = today_delta - d, updated_at = now()
      where user_id = uid and season = szn
      returning * into st;
    select * into existing from elo_events where user_id = uid and event_type = p_kind and day = p_day;
    return jsonb_build_object('ok', true, 'duplicate', true,
      'delta', coalesce(existing.delta, 0), 'elo', st.elo);
  end if;
  perform elo_try_clean_day(uid, szn, p_day, cfg, planned, grace);
  select * into st from season_state where user_id = uid and season = szn;
  return jsonb_build_object('ok', true, 'delta', d, 'quality', q,
    'elo', st.elo, 'today', st.today_delta, 'grace', grace);
end;
$function$
;
grant execute on function public.elo_submit(p_kind text, p_action_key text, p_day date, p_payload jsonb) to authenticated;

-- 5. Бонус чистого дня — та сама стеля дня.
CREATE OR REPLACE FUNCTION public.elo_try_clean_day(uid uuid, szn text, p_day date, cfg jsonb, planned integer, grace boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  got int; bonus int; room int; day_sum int; st season_state;
begin
  if exists (select 1 from elo_events where user_id = uid and event_type = 'cleanday' and day = p_day) then
    return;
  end if;
  select count(distinct category) into got
  from elo_events
  where user_id = uid and season = szn and day = p_day
    and category in ('nutrition','sleep','recovery','activity')
    and quality >= (cfg->>'cleanThreshold')::numeric;
  if got < 4 then return; end if;
  if not grace and exists (
       select 1 from elo_events
       where user_id = uid and season = szn and day = p_day
         and category = 'training' and quality < (cfg->>'cleanThreshold')::numeric) then
    return;
  end if;
  select coalesce(sum(delta), 0) into day_sum
  from elo_events
  where user_id = uid and season = szn and day = p_day and delta > 0 and category <> 'admin';
  -- Стан потрібен ДО розрахунку кімнати: від поточного ELO залежить темп,
  -- а отже й стеля дня. Доти st заповнювався лише після update, і
  -- elo_pace(null) мовчки давав би одиницю — тобто бонус чистого дня
  -- рахувався б за старою, плаcкою стелею.
  select * into st from season_state where user_id = uid and season = szn;
  room := least(greatest(0, round((cfg->>'dayGainCap')::numeric
                                  * public.elo_pace(st.elo, cfg))::int - day_sum),
                public.elo_week_room(uid, p_day, cfg));
  bonus := least((cfg->>'cleanDayBonus')::int, room);
  if bonus <= 0 then return; end if;
  update season_state
    set elo = least((cfg->>'seasonMax')::int, elo + bonus),
        today_delta = case when today_date = current_date then today_delta + bonus else bonus end,
        today_date = current_date, updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_day, 'bonus', 'cleanday', 'cleanday:' || p_day, 1, bonus, st.elo, 'Чистий день — усі цілі закриті')
  on conflict do nothing;
end;
$function$
;
grant execute on function public.elo_try_clean_day(uid uuid, szn text, p_day date, cfg jsonb, planned integer, grace boolean) to service_role;

-- 6. Стара пʼятиаргументна версія більше не потрібна. Знімається ПІСЛЯ
--    того, як elo_submit перевели на нову: інакше між двома операторами
--    міграції нарахування падало б із «function does not exist».
drop function if exists public.elo_action_delta(kind text, payload jsonb, cfg jsonb, planned_days integer, grace boolean);

-- 7. Новий конфіг у бойову базу. Саме update, а не insert: рядок один і
--    він уже є, а `on conflict do nothing` тихо не зробив би нічого
--    (INV-003 — рівно та пастка, на якій конфіг уже одного разу завис).
update public.elo_config set data = '{"version":3,"seasonMax":3000,"levelSize":240,"levelCount":10,"levelPace":[2.1,1.9,1.75,1.6,1.45,1.3,1.2,1.1,1.0,0.9],"elitePace":0.8,"eliteFloor":2400,"weeklyBudget":200,"weights":{"training":0.3,"nutrition":0.3,"sleep":0.2,"recovery":0.1,"activity":0.1},"categoryShare":0.857,"cleanDayBonus":3,"cleanWeekBonus":9,"cleanThreshold":0.9,"nutritionSplit":{"kcal":0.55,"protein":0.45},"tolerance":{"training":[[0.99,1.0],[0.97,0.82],[0.9,0.45],[0.8,0.45],[0.65,0.3],[0.5,0.12],[0,0.05]],"kcalBand":[[0.02,1.0],[0.05,0.82],[0.1,0.5],[0.2,0.45],[0.35,0.15],[1,0.05]],"protein":[[0.99,1.0],[0.95,0.82],[0.85,0.5],[0.7,0.45],[0.5,0.15],[0,0.05]],"sleep":[[0.99,1.0],[0.97,0.82],[0.9,0.55],[0.8,0.5],[0.65,0.22],[0,0.05]],"activity":[[0.99,1.0],[0.97,0.82],[0.85,0.5],[0.7,0.45],[0.5,0.15],[0,0.05]]},"recoveryFillShare":0.6,"recoveryGoodValue":7,"missedWorkoutPenalty":-8,"openMealPenalty":-3,"dayLossFloor":-15,"dayGainCap":45,"graceWeeksPerSeason":2,"graceDays":7,"submitWindowDays":2,"minUsersForPercentile":8,"leaderboardTops":[0.1,0.05,0.01],"leaderboardRanks":[1000,100,10,3,1],"floors":{"sleepGoalMin":240,"sleepMax":960,"stepsGoalMin":3000,"stepsMax":100000,"workoutTotalMin":3}}'::jsonb where id = 1;
