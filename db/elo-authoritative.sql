-- =============================================================================
-- ELO: сервер більше не вірить клієнтові на слово
-- =============================================================================
-- Міграція elo_authoritative_inputs. Виконується поверх db/elo-engine.sql.
--
-- ЩО БУЛО НЕ ТАК. elo_action_delta рахувала дельту з p_payload: goal, target,
-- proteinTarget, minutes, steps, kcal, done, total. Жодне з цих чисел сервер
-- не звіряв із власними даними. Наслідки, обидва відтворені:
--
--   1. Ціль сну = 1 хвилина (штатний UI, TrackerCore.setGoal вимагає лише
--      g > 0) → quality 1.0 → повна вартість категорії. Те саме з кроками.
--   2. Прямий виклик RPC із будь-яким payload → будь-який рейтинг.
--
-- ЩО ЗМІНЕНО. p_payload більше НЕ бере участі в розрахунку. Він лишився в
-- сигнатурі лише тому, що в чергах у браузерах користувачів лежать події зі
-- старим форматом — прибрати параметр означало б втратити їх. Факти сервер
-- читає сам із profiles.data — тих самих журналів, які малює інтерфейс:
--
--   workout  → sessionLog[day]  {done, total}
--   meal     → mealLog[day]     {kcal, p, target, pTarget}
--   sleep    → trackerLog.sleep[day]     + trackers.sleep.goal
--   activity → trackerLog.steps[day]     + trackers.steps.goal
--   recovery → trackerLog.recovery[day]
--
-- ЧОГО ЦЕ НЕ РОБИТЬ, і це треба сказати чесно: додаток самозвітний. Людина
-- може написати «спав 8 годин», не спавши. Захистити від брехні про власні
-- дані технічно неможливо. Захист тут інший і він реальний: ELO стало
-- ДЕТЕРМІНОВАНОЮ ФУНКЦІЄЮ збереженого стану профілю. Не можна нарахувати
-- очки за дію, якої немає в журналі; не можна підсунути іншу ціль, ніж та,
-- що стоїть у трекері; не можна отримати різний результат за той самий день
-- залежно від того, з якої сторінки прийшов запит.
--
-- Нижні межі цілей (floors) — другий рубіж, не перший. Вони не дають
-- перетворити ціль на одиницю, але основний захист — читання фактів із бази.
-- =============================================================================

-- --------------------------------------------------------------------------
-- Конфіг: нижні межі цілей і мінімальний розмір тренування
-- --------------------------------------------------------------------------
-- Живуть у elo_config, а не в коді функції: баланс міняється одним UPDATE,
-- без міграції. Дзеркало — db/elo-config.json.
update public.elo_config
set data = data || jsonb_build_object('floors', jsonb_build_object(
      'sleepGoalMin',   240,     -- 4 години: нижче цього це не ціль сну
      'sleepMax',       960,     -- 16 годин: більше — помилка вводу
      'stepsGoalMin',   3000,
      'stepsMax',       100000,
      'workoutTotalMin', 3       -- день з однієї вправи не є тренуванням
    )),
    updated_at = now()
where id = 1;

-- --------------------------------------------------------------------------
-- Безпечне читання числа з jsonb
-- --------------------------------------------------------------------------
-- Профіль — довільний JSON з фронтенду. Рядок замість числа в journalі не
-- має валити функцію винятком: це 500 у клієнта і вічний ретрай у черзі.
create or replace function public.elo_num(j jsonb, dflt numeric default 0)
returns numeric language sql immutable set search_path to 'public' as $$
  select case
    when j is null then dflt
    when jsonb_typeof(j) = 'number' then j::text::numeric
    when jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (j #>> '{}')::numeric
    else dflt
  end;
$$;

-- --------------------------------------------------------------------------
-- Значення трекера за день
-- --------------------------------------------------------------------------
-- trackerLog[id][day] буває числом (старі записи) або {value, source, date}
-- (етап 6, js/tracker-core.js:16-27). Читаємо обидві форми.
create or replace function public.elo_tracker_value(d jsonb, tid text, p_day date)
returns numeric language sql immutable set search_path to 'public' as $$
  select case
    when e is null then null
    when jsonb_typeof(e) = 'object' then public.elo_num(e->'value', null)
    else public.elo_num(e, null)
  end
  from (select d #> array['trackerLog', tid, p_day::text] as e) s;
$$;

-- --------------------------------------------------------------------------
-- ФАКТИ ДНЯ — єдине джерело чисел для розрахунку
-- --------------------------------------------------------------------------
-- Повертає null, якщо дії в журналі немає. Виклик відрізняє «немає даних»
-- від «дані є, але нульової якості»: перше не карається, друге рахується.
create or replace function public.elo_facts(uid uuid, kind text, p_day date, cfg jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  d jsonb; rec jsonb; fl jsonb;
  v numeric; g numeric; tot numeric; dn numeric;
begin
  select data into d from profiles where user_id = uid;
  if d is null then return null; end if;
  fl := coalesce(cfg->'floors', '{}'::jsonb);

  if kind = 'workout' then
    rec := d #> array['sessionLog', p_day::text];
    if rec is null or jsonb_typeof(rec) <> 'object' then return null; end if;
    tot := public.elo_num(rec->'total', 0);
    dn  := public.elo_num(rec->'done', 0);
    -- Тренування з однієї-двох вправ — не тренування, а спосіб отримати
    -- повну вартість категорії за мінімальну роботу.
    if tot < public.elo_num(fl->'workoutTotalMin', 3) then return null; end if;
    return jsonb_build_object('done', greatest(0, least(dn, tot)), 'total', tot);

  elsif kind = 'meal' then
    rec := d #> array['mealLog', p_day::text];
    if rec is null or jsonb_typeof(rec) <> 'object' then return null; end if;
    -- Ціль дня записана в момент закриття (js/history-core.js summarizeDay).
    -- Без неї порівнювати немає з чим — дня для ELO не існує.
    if public.elo_num(rec->'target', 0) <= 0 then return null; end if;
    return jsonb_build_object(
      'kcal',          greatest(0, public.elo_num(rec->'kcal', 0)),
      'target',        public.elo_num(rec->'target', 0),
      'protein',       greatest(0, public.elo_num(rec->'p', 0)),
      -- pTarget пишеться з етапу «authoritative ELO». У старих записах його
      -- немає — тоді калорії беруть усю вагу категорії (див. elo_action_delta).
      'proteinTarget', greatest(0, public.elo_num(rec->'pTarget', 0)));

  elsif kind = 'sleep' then
    v := public.elo_tracker_value(d, 'sleep', p_day);
    if v is null or v <= 0 then return null; end if;
    g := public.elo_num(d #> '{trackers,sleep,goal}', null);
    if g is null or g <= 0 then g := 480; end if;
    return jsonb_build_object(
      'minutes', least(v, public.elo_num(fl->'sleepMax', 960)),
      'goal',    greatest(g, public.elo_num(fl->'sleepGoalMin', 240)));

  elsif kind = 'activity' then
    v := public.elo_tracker_value(d, 'steps', p_day);
    if v is null or v <= 0 then return null; end if;
    g := public.elo_num(d #> '{trackers,steps,goal}', null);
    if g is null or g <= 0 then g := 8000; end if;
    return jsonb_build_object(
      'steps', least(v, public.elo_num(fl->'stepsMax', 100000)),
      'goal',  greatest(g, public.elo_num(fl->'stepsGoalMin', 3000)));

  elsif kind = 'recovery' then
    v := public.elo_tracker_value(d, 'recovery', p_day);
    if v is null then return null; end if;
    return jsonb_build_object('value', greatest(1, least(10, v)));
  end if;

  return null;
end;
$$;

revoke execute on function public.elo_facts(uuid, text, date, jsonb) from public, anon, authenticated;
revoke execute on function public.elo_num(jsonb, numeric) from public, anon, authenticated;
revoke execute on function public.elo_tracker_value(jsonb, text, date) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Формула дельти
-- --------------------------------------------------------------------------
-- Сама математика НЕ змінена — ті самі драбини, ті самі ваги, ті самі числа.
-- Змінено дві речі:
--   1. на вхід приходять факти з elo_facts, а не payload із запиту;
--   2. якщо цільового білка немає (день закритий до цієї міграції), калорії
--      беруть усю вагу категорії замість 0.55. Інакше той самий день коштував
--      би різне залежно від того, чи знав клієнт ціль білка в момент подання
--      — саме та недетермінованість, яку ловив аудит (M5).
create or replace function public.elo_action_delta(kind text, payload jsonb, cfg jsonb, planned_days integer, grace boolean)
 returns table(quality numeric, delta integer)
 language plpgsql immutable set search_path to 'public'
as $function$
declare
  weekly numeric := (cfg->>'weeklyBudget')::numeric * (cfg->>'categoryShare')::numeric;
  daily  numeric;
  q numeric := 0; m numeric := 0; d numeric := 0;
  target numeric; ptarget numeric; dev numeric; qk numeric := 0; qp numeric := 0;
  ksh numeric; psh numeric;
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
$function$;

-- --------------------------------------------------------------------------
-- Чистий день: бонус тепер під денною стелею
-- --------------------------------------------------------------------------
-- Було: бонус додавався повз dayGainCap, і фактичний максимум за добу
-- дорівнював 48 при заявлених 45. Тепер бонус ділить ту саму стелю, що й
-- решта нарахувань дня (M3).
create or replace function public.elo_try_clean_day(uid uuid, szn text, p_day date, cfg jsonb, planned integer, grace boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  got int; bonus int; room int; day_sum int; st season_state;
begin
  if exists (select 1 from elo_events where user_id = uid and action_key = 'cleanday:' || p_day) then
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
  from elo_events where user_id = uid and season = szn and day = p_day and delta > 0;
  room := greatest(0, (cfg->>'dayGainCap')::int - day_sum);
  bonus := least((cfg->>'cleanDayBonus')::int, room);
  if bonus <= 0 then return; end if;

  update season_state
    set elo = least((cfg->>'seasonMax')::int, elo + bonus),
        today_delta = case when today_date = current_date then today_delta + bonus else bonus end,
        today_date = current_date, updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  insert into elo_events (user_id, season, day, category, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_day, 'bonus', 'cleanday:' || p_day, 1, bonus, st.elo, 'Чистий день — усі цілі закриті');
end;
$function$;

-- --------------------------------------------------------------------------
-- Оцінка тижня: серверна, лінива, без участі клієнта
-- --------------------------------------------------------------------------
-- Було: тижневу оцінку зі штрафами ініціював КЛІЄНТ і лише за два тижні
-- назад. Хто не заходив довше або заблокував один RPC — штрафів не отримував
-- узагалі, а бонуси й далі капали. Тепер оцінка наздоганяє себе сама при
-- будь-якому сабміті: усі завершені тижні сезону, для яких немає маркера
-- 'week:', оцінюються по черзі (M4).
--
-- Пізні події за вже оцінений тиждень його не переоцінюють: вікно подання
-- 2 дні, тож зачепити можна щонайбільше минулий тиждень у понеділок-вівторок,
-- а маркер робить оцінку остаточною. Це свідомий вибір на користь
-- незмінності історії.
create or replace function public.elo_eval_week_for(uid uuid, p_week_start date, cfg jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  szn text; st season_state;
  planned int; done int; meals int;
  grace_days int := 0; expected int; missed int;
  pen int := 0; bon int := 0; d int;
begin
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
               else 'Тиждень оцінено' end)
  on conflict (user_id, action_key) do nothing;
  return jsonb_build_object('ok', true, 'delta', d, 'elo', st.elo, 'missed', missed, 'cleanWeek', bon > 0);
end;
$$;

revoke execute on function public.elo_eval_week_for(uuid, date, jsonb) from public, anon, authenticated;

-- Наздогнати всі неоцінені завершені тижні поточного сезону.
create or replace function public.elo_catch_up_weeks(uid uuid, szn text, cfg jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  season_start date;
  w date;
  guard int := 0;
begin
  -- Початок сезону = перший день його першого місяця. season_of ділить рік
  -- на квартали, тож достатньо взяти найраніший день, який ще належить szn.
  season_start := date_trunc('week', (
    select min(day) from elo_events where user_id = uid and season = szn
  ))::date;
  if season_start is null then return; end if;

  w := season_start;
  while w + 6 < current_date and guard < 20 loop
    guard := guard + 1;
    if season_of(w + 6) = szn
       and not exists (select 1 from elo_events where user_id = uid and action_key = 'week:' || w) then
      perform public.elo_eval_week_for(uid, w, cfg);
    end if;
    w := w + 7;
  end loop;
end;
$$;

revoke execute on function public.elo_catch_up_weeks(uuid, text, jsonb) from public, anon, authenticated;

-- Публічний RPC лишається для сумісності з чергою в браузерах.
create or replace function public.elo_evaluate_week(p_week_start date)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); cfg jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;
  return public.elo_eval_week_for(uid, p_week_start, cfg);
end;
$$;

-- --------------------------------------------------------------------------
-- elo_submit
-- --------------------------------------------------------------------------
-- p_payload лишився в сигнатурі, але В РОЗРАХУНКУ НЕ БЕРЕ УЧАСТІ. Причина
-- саме сумісність: у localStorage користувачів лежать черги зі старим
-- форматом, і зміна сигнатури втратила б їх.
--
-- Порядок операцій має значення і він змінився:
--   1. блокування season_state (for update) — СПОЧАТКУ;
--   2. лише потім перевірка дубліката за action_key.
-- Було навпаки, і дві паралельні вкладки обидві бачили «немає», після чого
-- друга падала на унікальному індексі з 500. Тепер друга транзакція чекає
-- на блокуванні, а прокинувшись — бачить чужий рядок і чесно повертає
-- duplicate (M2).
create or replace function public.elo_submit(p_kind text, p_action_key text, p_day date, p_payload jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  cfg jsonb; szn text; st season_state;
  planned int; grace boolean := false;
  facts jsonb;
  q numeric; d int;
  day_sum int; week_spent int; week_budget int;
  wk_start date;
  reason text; cat text;
  existing elo_events;
  ins_id bigint;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  if p_kind not in ('workout','meal','sleep','recovery','activity') then
    raise exception 'unknown kind %', p_kind;
  end if;

  select data into cfg from elo_config where id = 1;
  szn := season_of(p_day);

  -- Вікно подання. Сезон беремо від дня події, а не лише від сьогодні:
  -- о 00:30 першого дня сезону в UTC+3 локальна дата вже нова, а
  -- current_date ще вчорашня — раніше такі події тихо гинули в черзі.
  if p_day > current_date + 1
     or p_day < current_date - (cfg->>'submitWindowDays')::int
     or szn not in (season_of(current_date), season_of(current_date + 1), season_of(current_date - 1)) then
    return jsonb_build_object('ok', false, 'error', 'out_of_window');
  end if;

  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;

  -- Перевірка дубліката ПІСЛЯ блокування — див. коментар вище.
  select * into existing from elo_events where user_id = uid and action_key = p_action_key;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true,
      'delta', existing.delta, 'elo', coalesce(st.elo, existing.elo_after));
  end if;

  -- Борги минулих тижнів — до нарахування за сьогодні.
  perform public.elo_catch_up_weeks(uid, szn, cfg);
  select * into st from season_state where user_id = uid and season = szn for update;

  grace := st.grace_until is not null and p_day <= st.grace_until;
  planned := coalesce((select greatest(1, least(7,
      coalesce((data#>>'{activePlan,days}')::int, (data->>'daysPerWeek')::int, 3)))
    from profiles where user_id = uid), 3);

  -- ФАКТИ З БАЗИ, а не з запиту.
  facts := public.elo_facts(uid, p_kind, p_day, cfg);
  if facts is null then
    -- Дії в журналі немає. Це не помилка й не привід карати: профіль міг
    -- ще не доїхати в хмару (черга Store незалежна від черги ELO). retry
    -- каже клієнтові не помічати подію як надіслану.
    return jsonb_build_object('ok', false, 'error', 'no_data', 'retry', true);
  end if;

  select t.quality, t.delta into q, d
  from elo_action_delta(p_kind, facts, cfg, planned, grace) t;

  -- ТИЖНЕВИЙ БЮДЖЕТ ТРЕНУВАНЬ (C2).
  --
  -- Було: вартість тренування = тижнева частка / planned_days, без жодного
  -- обмеження на кількість тренувань за тиждень. План «1 день/тиждень» давав
  -- 51 ELO за одне тренування щодня — 1,7× чесного максимуму.
  --
  -- Стало: сума нарахувань за тренування в межах ISO-тижня не може
  -- перевищити тижневу частку категорії. planned_days тепер визначає лише
  -- ТЕМП (скільки коштує одне тренування), а не тижневу суму. Зменшення
  -- daysPerWeek більше не дає нічого: бюджет однаковий.
  if p_kind = 'workout' and d > 0 then
    wk_start := date_trunc('week', p_day)::date;
    select coalesce(sum(delta), 0) into week_spent
      from elo_events
      where user_id = uid and season = szn and category = 'training' and delta > 0
        and day between wk_start and wk_start + 6;
    week_budget := round(
      (cfg->>'weeklyBudget')::numeric * (cfg->>'categoryShare')::numeric
      * (cfg#>>'{weights,training}')::numeric)::int;
    d := least(d, greatest(0, week_budget - week_spent));
  end if;

  -- Денна стеля.
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
  values (uid, szn, p_day, cat, p_action_key, q, d, st.elo, reason)
  on conflict (user_id, action_key) do nothing
  returning id into ins_id;

  if ins_id is null then
    -- Хтось устиг раніше в цій же мілісекунді. Відкочувати нарахування не
    -- можна (транзакція одна), тому просто не подвоюємо: знімаємо додане.
    update season_state
      set elo = least((cfg->>'seasonMax')::int, greatest(0, elo - d)),
          today_delta = today_delta - d, updated_at = now()
      where user_id = uid and season = szn
      returning * into st;
    select * into existing from elo_events where user_id = uid and action_key = p_action_key;
    return jsonb_build_object('ok', true, 'duplicate', true,
      'delta', coalesce(existing.delta, 0), 'elo', st.elo);
  end if;

  perform elo_try_clean_day(uid, szn, p_day, cfg, planned, grace);
  select * into st from season_state where user_id = uid and season = szn;

  return jsonb_build_object('ok', true, 'delta', d, 'quality', q,
    'elo', st.elo, 'today', st.today_delta, 'grace', grace);
end;
$function$;
