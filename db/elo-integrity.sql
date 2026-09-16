-- ============================================================================
-- ПЕРЕКРИТО: elo-week-eval-fix.sql, elo-skip-category.sql і elo-pace.sql. НЕ ЗАПУСКАТИ ПО БОЙОВІЙ БАЗІ.
-- ============================================================================
-- Сім тіл із восьми старіші за базу. Прогін відкотить season_bounds до
-- квартальної межі (сезон знову закінчуватиметься не в неділю) і
-- elo_planned_for до небезпечного касту ::int.
--
-- Файл лишається як історія: він пояснює, ЧОМУ база стала такою. Що в
-- ній зараз — db/live-schema.sql. Як міняти базу — db/README.md.
-- Позначку звіряє tools/ci-hygiene.mjs (перевірки 8 і 21).
-- ============================================================================

-- =============================================================================
-- ELO INTEGRITY — серверна ідентичність економічної події, тижневий бюджет,
-- знімок плану тижня, безпечне закриття сезону.
-- =============================================================================
-- Міграція: elo_integrity_server_identity
--
-- ЩО ВИПРАВЛЯЄ (forensic-аудити 2026-09-02):
--   F-01  p_action_key клієнта був ідентичністю події: новий ключ = нова
--         винагорода за той самий факт (до dayGainCap щодня).
--   F-A   planned (activePlan.days) читався з profiles.data у момент
--         нарахування: planned=1 давав 45 за одне тренування і скасовував
--         штрафи.
--   F-03  тижневий бюджет діяв лише на training; решта категорій — лише
--         денна стеля (45/день замість ≈27.6 задуманих).
--   F-B   клієнт міг зайняти службові ключі 'week:…' / 'cleanday:…' і тим
--         вимкнути тижневу оцінку.
--   F-02  сезон закривався до кінця вікна подачі (і навіть майбутній).
--
-- МОДЕЛЬ ПІСЛЯ МІГРАЦІЇ (інваріанти, кожен — з фізичним enforcement):
--   P1/P2/P7  Ідентичність події = (user_id, event_type, day), event_type
--             виводить СЕРВЕР із p_kind; p_action_key ігнорується (лишається
--             в сигнатурі для сумісності зі старими клієнтами).
--             Enforcement: partial UNIQUE INDEX elo_events_identity
--             (event_type <> 'admin') + row lock season_state.
--   Реконсиляція (MODEL B, лише вгору): повторний submit тієї самої події
--             з кращими фактами доплачує різницю intended − paid у межах
--             стель; гірші факти нічого не забирають. Отже
--             paid(user,type,day) ≤ max intended reward — за будь-якої
--             кількості запитів, ключів, payload-ів, пристроїв.
--   P4        planned — знімок тижня в elo_week_plan (без гранту клієнту),
--             створюється сервером при першому дотику тижня (submit або
--             оцінка) і не змінюється profiles.data. Межі 3..7: мінімальна
--             програма каталогу — 3 дні.
--   P5        Один тижневий бюджет позитивного ELO = weeklyBudget (200) на
--             sum(delta > 0) усіх подій тижня, крім 'admin' — ВКЛЮЧНО з
--             бонусами (Option A: 171.4 дії + ≈28.6 бонуси = 200). Бюджет
--             training (51) лишається як частка категорії.
--   P6        seasonMax — least() у кожному update + CHECK season_state.elo.
--   P8        'cleanday' і 'week' — серверні event_type, клієнт їх не
--             створює (p_kind whitelist).
--   P9/P10    close лише після season_end + submitWindowDays; після цього
--             жоден submit у той сезон неможливий (вікно), тож
--             season_history/awards незмінні.
--   P11       усі нарахування під SELECT … FOR UPDATE рядка season_state.
--   P12       старий клієнт із випадковим p_action_key — безпечний.
--
-- ФАКТИ ЛИШАЮТЬСЯ SELF-REPORTED (MODEL 1 — adherence score): сервер не може
-- перевірити, чи тренування було. Стелі/ідентичність/бюджет захищають
-- ЕКОНОМІКУ, не автентичність фактів.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Схема: event_type + серверна ідентичність
-- ---------------------------------------------------------------------------
alter table public.elo_events add column if not exists event_type text;

update public.elo_events set event_type = case
  when category = 'admin'                 then 'admin'
  when action_key like 'week:%'           then 'week'
  when action_key like 'cleanday:%'       then 'cleanday'
  when category = 'training'              then 'workout'
  when category = 'nutrition'             then 'meal'
  when category in ('sleep','recovery','activity') then category
  else 'legacy' end
where event_type is null;

-- Історія не переписується. Якщо серед старих рядків уже є два записи однієї
-- події за день (наслідок F-01), міграція зупиняється: дублі треба
-- розібрати руками (admin), а не мовчки стерти.
do $$
declare n int;
begin
  select count(*) into n from (
    select user_id, event_type, day from public.elo_events
    where event_type <> 'admin' group by 1, 2, 3 having count(*) > 1) d;
  if n > 0 then
    raise exception 'elo_integrity: % груп (user, event_type, day) з дублями — розберіть перед міграцією', n;
  end if;
end $$;

alter table public.elo_events alter column event_type set not null;
alter table public.elo_events drop constraint if exists elo_events_event_type_check;
alter table public.elo_events add constraint elo_events_event_type_check
  check (event_type in ('workout','meal','sleep','recovery','activity','cleanday','week','admin','legacy'));

create unique index if not exists elo_events_identity
  on public.elo_events (user_id, event_type, day) where event_type <> 'admin';

-- ---------------------------------------------------------------------------
-- 2. Знімок плану тижня (server-owned)
-- ---------------------------------------------------------------------------
create table if not exists public.elo_week_plan (
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  planned    int  not null check (planned between 3 and 7),
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table public.elo_week_plan enable row level security;
alter table public.elo_week_plan force row level security;
revoke all on public.elo_week_plan from anon, authenticated;
-- Політик навмисно немає: читати/писати може лише SECURITY DEFINER-код.

-- Планове навантаження тижня. Перший дотик тижня (submit у цей тиждень або
-- його оцінка) фіксує значення з profiles.data, обрізане до 3..7; далі
-- profiles.data на цей тиждень не впливає.
create or replace function public.elo_planned_for(uid uuid, p_week_start date)
returns int language plpgsql security definer set search_path = public as $$
declare p int; w date := date_trunc('week', p_week_start)::date;
begin
  select planned into p from elo_week_plan where user_id = uid and week_start = w;
  if found then return p; end if;
  p := coalesce((select greatest(3, least(7,
         coalesce((data #>> '{activePlan,days}')::int, (data ->> 'daysPerWeek')::int, 3)))
       from profiles where user_id = uid), 3);
  insert into elo_week_plan (user_id, week_start, planned) values (uid, w, p)
  on conflict (user_id, week_start) do nothing;
  select planned into p from elo_week_plan where user_id = uid and week_start = w;
  return p;
end $$;
revoke all on function public.elo_planned_for(uuid, date) from public, anon, authenticated;

-- Скільки позитивного ELO ще можна нарахувати цього ISO-тижня (усі джерела,
-- крім ручних правок адміна).
create or replace function public.elo_week_room(uid uuid, p_day date, cfg jsonb)
returns int language sql security definer stable set search_path = public as $$
  select greatest(0, (cfg ->> 'weeklyBudget')::int - coalesce((
    select sum(delta) from elo_events
    where user_id = uid and delta > 0 and category <> 'admin'
      and day between date_trunc('week', p_day)::date and date_trunc('week', p_day)::date + 6), 0))::int;
$$;
revoke all on function public.elo_week_room(uuid, date, jsonb) from public, anon, authenticated;

-- Межі сезону з його коду ('AUTUMN-2026'); null для невалідного коду.
create or replace function public.season_bounds(p_season text, out s date, out e date)
language plpgsql immutable set search_path = public as $$
declare m text[]; y int;
begin
  m := regexp_match(coalesce(p_season, ''), '^(SPRING|SUMMER|AUTUMN|WINTER)-(\d{4})$');
  if m is null then s := null; e := null; return; end if;
  y := m[2]::int;
  case m[1]
    when 'SPRING' then s := make_date(y, 3, 1);  e := make_date(y, 5, 31);
    when 'SUMMER' then s := make_date(y, 6, 1);  e := make_date(y, 8, 31);
    when 'AUTUMN' then s := make_date(y, 9, 1);  e := make_date(y, 11, 30);
    else               s := make_date(y, 12, 1); e := make_date(y + 1, 3, 1) - 1;
  end case;
end $$;
revoke all on function public.season_bounds(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Чистий день — серверний event_type 'cleanday', у тижневому бюджеті
-- ---------------------------------------------------------------------------
create or replace function public.elo_try_clean_day(uid uuid, szn text, p_day date, cfg jsonb, planned integer, grace boolean)
 returns void language plpgsql security definer set search_path to 'public' as $$
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
  room := least(greatest(0, (cfg->>'dayGainCap')::int - day_sum), public.elo_week_room(uid, p_day, cfg));
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
$$;

-- ---------------------------------------------------------------------------
-- 4. Оцінка тижня — planned зі знімка, event_type 'week', бонус у бюджеті
-- ---------------------------------------------------------------------------
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
  if exists (select 1 from elo_events where user_id = uid and event_type = 'week' and day = p_week_start + 6) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;

  planned := public.elo_planned_for(uid, p_week_start);

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
  if done >= planned and meals >= 7 then
    bon := least((cfg->>'cleanWeekBonus')::int, public.elo_week_room(uid, p_week_start, cfg));
  end if;
  d := pen + bon;

  update season_state
    set elo = least((cfg->>'seasonMax')::int, greatest(0, elo + d)), updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_week_start + 6,
          case when d >= 0 then 'bonus' else 'penalty' end,
          'week', 'week:' || p_week_start, 0, d, st.elo,
          case when bon > 0 then 'Чистий тиждень — план закрито повністю'
               when missed > 0 then 'Недобір тренувань: ' || missed || ' пропуск(и)'
               else 'Тиждень оцінено' end)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'delta', d, 'elo', st.elo, 'missed', missed, 'cleanWeek', bon > 0,
                            'planned', planned);
end;
$$;

create or replace function public.elo_catch_up_weeks(uid uuid, szn text, cfg jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  season_start date;
  w date;
  guard int := 0;
begin
  season_start := date_trunc('week', (
    select min(day) from elo_events where user_id = uid and season = szn
  ))::date;
  if season_start is null then return; end if;

  w := season_start;
  while w + 6 < current_date and guard < 20 loop
    guard := guard + 1;
    if season_of(w + 6) = szn
       and not exists (select 1 from elo_events where user_id = uid and event_type = 'week' and day = w + 6) then
      perform public.elo_eval_week_for(uid, w, cfg);
    end if;
    w := w + 7;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. elo_submit — серверна ідентичність + реконсиляція + бюджети
-- ---------------------------------------------------------------------------
create or replace function public.elo_submit(p_kind text, p_action_key text, p_day date, p_payload jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  cfg jsonb; szn text; st season_state;
  planned int; grace boolean := false;
  facts jsonb;
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
  -- Закритий сезон незмінний.
  if exists (select 1 from season_history where user_id = uid and season = szn) then
    return jsonb_build_object('ok', false, 'error', 'season_closed');
  end if;

  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;

  -- Ідентичність події — серверна. p_action_key НЕ читається.
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
    return jsonb_build_object('ok', false, 'error', 'no_data', 'retry', true);
  end if;

  select t.quality, t.delta into q, d
  from elo_action_delta(p_kind, facts, cfg, planned, grace) t;

  -- Реконсиляція вгору: доплачуємо лише різницю intended − paid.
  inc := greatest(0, d - paid);

  if p_kind = 'workout' and inc > 0 then
    wk_start := date_trunc('week', p_day)::date;
    select coalesce(sum(delta), 0) into week_spent
      from elo_events
      where user_id = uid and season = szn and category = 'training' and delta > 0
        and day between wk_start and wk_start + 6;
    week_budget := round(
      (cfg->>'weeklyBudget')::numeric * (cfg->>'categoryShare')::numeric
      * (cfg#>>'{weights,training}')::numeric)::int;
    inc := least(inc, greatest(0, week_budget - week_spent));
  end if;

  if inc > 0 then
    -- Денна стеля (усі категорії) та єдиний тижневий бюджет позитивного ELO.
    select coalesce(sum(delta), 0) into day_sum
    from elo_events
    where user_id = uid and season = szn and day = p_day and delta > 0 and category <> 'admin';
    room := least(greatest(0, (cfg->>'dayGainCap')::int - day_sum), public.elo_week_room(uid, p_day, cfg));
    inc := least(inc, room);
  end if;

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
    -- Паралельний виклик встиг першим (теоретично: рядок season_state під
    -- FOR UPDATE серіалізує) — повертаємо нарахування назад.
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
$$;

-- ---------------------------------------------------------------------------
-- 6. Закриття сезону — лише після кінця вікна подачі
-- ---------------------------------------------------------------------------
create or replace function public.elo_close_season(p_season text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  cfg jsonb; st season_state;
  my_rank int; total int; pctl numeric;
  lvl int; elite boolean;
  d_active int; d_total int;
  stats jsonb; b record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;

  select * into b from season_bounds(p_season);
  if b.e is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_season');
  end if;
  -- Сезон остаточний лише коли жоден submit у нього вже неможливий:
  -- вікно подачі дозволяє писати ще submitWindowDays днів після кінця.
  if current_date <= b.e + (cfg->>'submitWindowDays')::int then
    return jsonb_build_object('ok', false, 'error', 'season_running', 'finalAfter', b.e + (cfg->>'submitWindowDays')::int);
  end if;
  if exists (select 1 from season_history where user_id = uid and season = p_season) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into st from season_state where user_id = uid and season = p_season;
  if st is null then return jsonb_build_object('ok', false, 'error', 'no_data'); end if;

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
  d_total := b.e - b.s + 1;

  select coalesce(jsonb_object_agg(category, s), '{}'::jsonb) into stats from (
    select category, jsonb_build_object('events', count(*), 'elo', sum(delta),
                                        'avgQuality', round(avg(quality), 2)) s
    from elo_events where user_id = uid and season = p_season
      and category in ('training','nutrition','sleep','recovery','activity')
    group by category
  ) g;
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
  values (uid, p_season, st.elo, lvl, elite, my_rank, total, pctl, d_active, d_total, st.grace_used, stats)
  on conflict (user_id, season) do nothing;

  if lvl >= 5  then insert into awards values (uid, p_season, 'level5',  'Season Badge') on conflict do nothing; end if;
  if lvl >= 7  then insert into awards values (uid, p_season, 'level7',  'Profile Frame') on conflict do nothing; end if;
  if lvl >= 8  then insert into awards values (uid, p_season, 'level8',  'Seasonal Cosmetic') on conflict do nothing; end if;
  if lvl >= 9  then insert into awards values (uid, p_season, 'level9',  'Exclusive Reward') on conflict do nothing; end if;
  if lvl >= 10 then insert into awards values (uid, p_season, 'level10', 'Legendary Season Reward') on conflict do nothing; end if;
  if elite     then insert into awards values (uid, p_season, 'elite',   'ELITE 2000+') on conflict do nothing; end if;
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

-- ---------------------------------------------------------------------------
-- 7. Ручні правки адміна — event_type 'admin' (поза ідентичністю користувача)
-- ---------------------------------------------------------------------------
create or replace function public.admin_elo_set(p_user uuid, p_elo integer, p_reason text default null)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := auth.uid();
  szn text := season_of(current_date);
  cfg jsonb;
  st season_state;
  target int; diff int; note text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;
  if p_user is null then raise exception 'BAD_USER'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NO_USER'; end if;

  select data into cfg from elo_config where id = 1;
  target := greatest(0, least(coalesce(p_elo, 0), (cfg->>'seasonMax')::int));

  insert into season_state (user_id, season) values (p_user, szn) on conflict do nothing;
  select * into st from season_state where user_id = p_user and season = szn for update;

  diff := target - st.elo;
  if diff = 0 then
    return jsonb_build_object('ok', true, 'elo', target, 'delta', 0, 'noop', true);
  end if;

  note := coalesce(nullif(btrim(p_reason), ''), 'Ручне виставлення (адмін)');

  update season_state
    set elo = target, updated_at = now()
  where user_id = p_user and season = szn;

  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (p_user, szn, current_date, 'admin', 'admin',
          'admin:' || extract(epoch from clock_timestamp())::bigint || ':' || md5(random()::text),
          0, diff, target, note);

  return jsonb_build_object('ok', true, 'elo', target, 'delta', diff, 'season', szn);
end;
$$;

-- Гранти незмінні: elo_submit / elo_close_season / admin_elo_set — authenticated;
-- нові helper-и — лише service_role (виклик зсередини SECURITY DEFINER).
