-- ============================================================================
-- ПЕРЕКРИТО: elo-recount-category.sql, далі elo-skip-whitelist.sql. НЕ ЗАПУСКАТИ ПО БОЙОВІЙ БАЗІ.
-- ============================================================================
-- elo_cfg_for тут старіша за базу — у ній немає білого списку
-- дозволених категорій, тобто прогін поверне дірку, яку закрив
-- elo-skip-whitelist.sql: клієнт зміг би вимкнути будь-що.
--
-- Файл лишається як історія: він пояснює, ЧОМУ база стала такою. Що в
-- ній зараз — db/live-schema.sql. Як міняти базу — db/README.md.
-- Позначку звіряє tools/ci-hygiene.mjs (перевірки 8 і 21).
-- ============================================================================

-- =============================================================================
--  ВИМКНЕНА КАТЕГОРІЯ РЕЙТИНГУ (харчування)
-- =============================================================================
--
--  ЩО ЛАГОДИМО. Тижнева стеля в грі спільна: weeklyBudget × темп, і її
--  рахує elo_week_room, нічого не знаючи про категорії. Ваги лише ділять
--  цю стелю. Тому людина, яка не веде щоденник їжі, не «заробляла менше
--  за ті самі дії» — вона мала НЕДОСЯЖНИЙ кусок власного бюджету: 30 %,
--  закріплені за категорією, якої в неї немає. Хоч як добре вона
--  тренувалась, сезон закінчувався нижче, ніж у того самого гравця зі
--  щоденником.
--
--  ЯК. У профілі зʼявляється data->'eloSkip' — список вимкнених
--  категорій. elo_cfg_for() прибирає їхні ваги й нормує решту назад до
--  одиниці, тож сума лишається тією самою. Далі НІ ОДНА формула про
--  вимикач не знає: elo_action_delta, бюджети, стелі — усе працює з
--  конфігом, який їм дали. Те саме роблять клієнт (js/elo-core.js,
--  cfgFor) і симуляція балансу (tools/simelo.mjs).
--
--  ЧОМУ ЦЕ НЕ ДІРКА. Перемикати категорію посеред сезону немає сенсу:
--  більше за тижневу стелю все одно не взяти, а вже нараховані події
--  лишаються як є. Міняється тільки те, куди можна дотягтись далі.
--
--  ЩО ЩЕ МУСИЛО ЗМІНИТИСЬ. Бонуси питали категорії списком у коді:
--  чистий день вимагав чотирьох категорій поіменно, чистий тиждень —
--  семи закритих днів їжі. Для вимкненої категорії обидва стали б
--  недосяжними назавжди. Тепер обидва питають КОНФІГ.
--
--  Дзеркало клієнта: js/elo-core.js (cfgFor, cleanDay, cleanWeek).
--  Відкат: db/elo-skip-category-rollback.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Персональний конфіг
-- -----------------------------------------------------------------------------
-- STABLE, а не IMMUTABLE: читає профіль. SECURITY DEFINER — бо викликається
-- з функцій, які вже працюють від імені сервера, а таблиця profiles закрита
-- політиками.
--
-- Порожній чи зіпсований список, спроба вимкнути ВСЕ, нульова сума ваг —
-- усе це повертає конфіг як є. Вимкнути все означало б ділення на нуль і
-- бюджет NaN; такого вибору немає в інтерфейсі, але профіль міг приїхати
-- з відредагованого руками експорту.
create or replace function public.elo_cfg_for(uid uuid, cfg jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  raw jsonb;
  skip text[];
  keys text[];
  total numeric := 0;
  w jsonb := '{}'::jsonb;
  k text;
begin
  if cfg is null or cfg->'weights' is null then return cfg; end if;

  -- jsonb_typeof, а не просто coalesce: jsonb_array_elements_text кидає
  -- «cannot extract elements from a scalar» на будь-чому, крім масиву, —
  -- і один зіпсований профіль («eloSkip»: 123 з відредагованого руками
  -- експорту) ламав би цій людині elo_submit ЦІЛКОМ. Знайдено тестом.
  select coalesce((select p.data->'eloSkip' from profiles p where p.user_id = uid), '[]'::jsonb)
    into raw;
  if jsonb_typeof(raw) is distinct from 'array' then return cfg; end if;

  select array_agg(x) into skip from jsonb_array_elements_text(raw) x;
  if skip is null or array_length(skip, 1) is null then return cfg; end if;

  select array_agg(x) into keys
    from jsonb_object_keys(cfg->'weights') x where not (x = any (skip));
  if keys is null or array_length(keys, 1) is null then return cfg; end if;
  if array_length(keys, 1) = (select count(*) from jsonb_object_keys(cfg->'weights')) then
    return cfg;
  end if;

  foreach k in array keys loop
    total := total + coalesce((cfg#>>array['weights', k])::numeric, 0);
  end loop;
  if total <= 0 then return cfg; end if;

  foreach k in array keys loop
    w := w || jsonb_build_object(k,
      round(coalesce((cfg#>>array['weights', k])::numeric, 0) / total, 6));
  end loop;
  return jsonb_set(cfg, '{weights}', w);
end $$;

revoke all on function public.elo_cfg_for(uuid, jsonb) from public;
grant execute on function public.elo_cfg_for(uuid, jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.elo_try_clean_day(uid uuid, szn text, p_day date, cfg jsonb, planned integer, grace boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  got int; bonus int; room int; day_sum int; st season_state;
  -- Категорії дня беремо з КОНФІГУ, а не списком у коді: людина могла
  -- вимкнути категорію в рейтингу, і тоді чистий день не має її вимагати.
  cats text[];
  need int;
begin
  cfg := public.elo_cfg_for(uid, cfg);
  select array_agg(k) into cats
    from jsonb_object_keys(cfg->'weights') k where k <> 'training';
  need := coalesce(array_length(cats, 1), 0);
  if need = 0 then return; end if;
  if exists (select 1 from elo_events where user_id = uid and event_type = 'cleanday' and day = p_day) then
    return;
  end if;
  select count(distinct category) into got
  from elo_events
  where user_id = uid and season = szn and day = p_day
    and category = any (cats)
    and quality >= (cfg->>'cleanThreshold')::numeric;
  if got < need then return; end if;
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
CREATE OR REPLACE FUNCTION public.elo_eval_week_for(uid uuid, p_week_start date, cfg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  szn text; st season_state;
  planned int; done int; meals int;
  grace_days int := 0; expected int; missed int;
  pen int := 0; bon int := 0; d int;
  why text; ev_id bigint;
  start_day date; avail int := 7;          -- ELO-006
begin
  why := public.elo_week_ready(uid, p_week_start, cfg);
  if why is not null then
    return jsonb_build_object('ok', false, 'error', why);
  end if;

  cfg := public.elo_cfg_for(uid, cfg);
  szn := season_of(p_week_start + 6);

  planned := public.elo_planned_for(uid, p_week_start);
  select count(*) into done from elo_events
    where user_id = uid and category = 'training' and quality >= 0.5
      and day between p_week_start and p_week_start + 6;
  select count(distinct day) into meals from elo_events
    where user_id = uid and category = 'nutrition'
      and day between p_week_start and p_week_start + 6;

  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn;

  if st.grace_until is not null then
    grace_days := greatest(0, least(st.grace_until, p_week_start + 6)::date
                            - greatest(st.grace_until - ((cfg->>'graceDays')::int - 1), p_week_start)::date + 1);
  end if;

  -- ELO-006: скільки днів цього тижня людина взагалі мала.
  select least(
           (select min(e.day) from elo_events e where e.user_id = uid),
           (select a.decided_at::date from account_status a where a.user_id = uid)
         ) into start_day;
  if start_day is not null and start_day > p_week_start then
    avail := greatest(1, least(7, (p_week_start + 6) - start_day + 1));
  end if;

  expected := round(planned * (1 - grace_days / 7.0) * avail / 7.0);
  missed := greatest(0, expected - done);
  pen := missed * (cfg->>'missedWorkoutPenalty')::int;
  -- Сім закритих днів їжі питаємо лише тоді, коли їжа взагалі в грі:
  -- інакше чистий тиждень був би недосяжним для того, хто свідомо
  -- вимкнув категорію.
  if done >= planned
     and (not (cfg->'weights' ? 'nutrition') or meals >= 7) then
    bon := least((cfg->>'cleanWeekBonus')::int, public.elo_week_room(uid, p_week_start, cfg));
  end if;
  d := pen + bon;

  -- DB-006: зрізаємо ДЕЛЬТУ, а не стан. Далі d — це рівно те, на скільки
  -- зміниться season_state.elo, тож журнал і стан не розходяться.
  d := least((cfg->>'seasonMax')::int, greatest(0, st.elo + d)) - st.elo;

  -- Унікальний (user_id, action_key) означає, що вставити маркер може рівно
  -- один виклик. Конкурент блокується тут, після коміту переможця отримує
  -- нуль рядків і чесно каже duplicate, не чіпаючи season_state.
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_week_start + 6,
          case when d >= 0 then 'bonus' else 'penalty' end,
          'week', 'week:' || p_week_start, 0, d, 0,
          case when bon > 0 then 'Чистий тиждень — план закрито повністю'
               when missed > 0 then 'Недобір тренувань: ' || missed || ' пропуск(и)'
               else 'Тиждень оцінено' end)
  on conflict do nothing
  returning id into ev_id;

  if ev_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  update season_state
    set elo = least((cfg->>'seasonMax')::int, greatest(0, elo + d)), updated_at = now()
    where user_id = uid and season = szn
    returning * into st;

  update elo_events set elo_after = st.elo where id = ev_id;

  return jsonb_build_object('ok', true, 'delta', d, 'elo', st.elo, 'missed', missed,
                            'cleanWeek', bon > 0, 'planned', planned, 'availableDays', avail);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.elo_state(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  szn text := season_of(current_date);
  st season_state;
  my_rank int; total int;
  cfg jsonb;
  tday date;
  planned int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;

  tday := coalesce(p_today, current_date);
  if tday > current_date + 1 or tday < current_date - 2 then
    tday := current_date;
  end if;

  select data into cfg from elo_config where id = 1;
  cfg := public.elo_cfg_for(uid, cfg);
  select * into st from season_state where user_id = uid and season = szn;
  select count(*) into total from season_state where season = szn;

  planned := coalesce(
    (select p.planned from elo_week_plan p
       where p.user_id = uid and p.week_start = date_trunc('week', tday)::date),
    (select greatest(3, least(7, floor(coalesce(
        nullif(public.elo_num(data #> '{activePlan,days}', 0), 0),
        nullif(public.elo_num(data -> 'daysPerWeek', 0), 0),
        3))::int))
     from profiles where user_id = uid),
    3);

  if st is null then
    return jsonb_build_object('season', szn, 'elo', 0, 'today', 0,
      'graceUsed', 0, 'graceUntil', null, 'rank', null, 'of', total,
      'plannedWeek', planned, 'config', cfg);
  end if;
  select r into my_rank from (
    select user_id, rank() over (order by elo desc) r from season_state where season = szn
  ) x where x.user_id = uid;
  return jsonb_build_object('season', szn, 'elo', st.elo,
    'today', (select coalesce(sum(e.delta), 0) from elo_events e
                where e.user_id = uid and e.day = tday
                  and e.event_type in ('workout','meal','sleep','recovery','activity')),
    'graceUsed', st.grace_used,
    'graceUntil', case when st.grace_until >= current_date then st.grace_until else null end,
    'rank', my_rank, 'of', total, 'plannedWeek', planned, 'config', cfg);
end;
$function$
;
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
  -- Персональний конфіг: вимкнені категорії прибрані, ваги решти
  -- перенормовані. Далі все рахується як завжди — жодна формула про
  -- вимикач не знає (js/elo-core.js, cfgFor).
  cfg := public.elo_cfg_for(uid, cfg);
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
