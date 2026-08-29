-- =============================================================================
-- Адмінський інструмент ELO: ручне виставлення рейтингу (для тестів)
-- =============================================================================
-- Виконувати в Supabase SQL Editor ОДИН раз. Міграція лише додає функції й
-- уточнює дві умови в наявних — нічого не видаляє й не переписує дані.
--
-- НАВІЩО. Щоб перевірити рівні, ELITE-зону, таблицю лідерів і закриття
-- сезону, потрібен акаунт із заданим ELO. Дочекатись 2000 очок «чесно» —
-- це три місяці, тож без цього інструменту такі стани не перевіряються
-- взагалі.
--
-- ЩО ЦЕ НЕ ЛАМАЄ — три речі, і кожна навмисна:
--
--   1. ПРАВО. Обидві функції SECURITY DEFINER й самі питають is_admin()
--      на сервері. Не-адмін дістане FORBIDDEN, що б він не робив із
--      фронтендом: сторінка адмінки — це інтерфейс, а не перевірка.
--
--   2. ІСТОРІЯ. Нічого не видаляється. «Поставити 1500» — це не переписати
--      season_state тихцем, а дописати подію в elo_events із категорією
--      'admin', видимою дельтою й причиною. Журнал лишається повним і
--      чесним: видно, що це рука адміна, коли й на скільки.
--
--   3. ЧЕСНИЙ РАХУНОК. Денна стеля (dayGainCap) рахує суму позитивних
--      дельт за добу. Якби адмінська подія туди потрапляла, накрутка
--      з'їдала б денний бюджет живого користувача — і його справжнє
--      тренування того ж дня коштувало б менше. Тому обидва запити
--      денної стелі нижче тепер виключають category = 'admin'.
--      Тижневий бюджет тренувань фільтрує category = 'training',
--      тож він і так не зачеплений.
-- =============================================================================

-- --------------------------------------------------------------------------
-- 0. Категорія 'admin' у переліку дозволених
-- --------------------------------------------------------------------------
-- elo_events.category має CHECK зі списком категорій; без 'admin' у ньому
-- вставка адмінської події падає з 23514. Констрейнт пересоздається зі
-- старим списком ПЛЮС 'admin' — жодного рядка це не чіпає.
alter table public.elo_events drop constraint if exists elo_events_category_check;
alter table public.elo_events add constraint elo_events_category_check
  check (category = any (array['training','nutrition','sleep','recovery','activity','penalty','bonus','admin']));

-- --------------------------------------------------------------------------
-- 1. Денна стеля не бачить адмінських подій
-- --------------------------------------------------------------------------
-- Правляться дві функції з db/elo-authoritative.sql. Змінено РІВНО одну
-- умову в кожній — решта тіла лишається тією самою; повні тексти нижче,
-- бо create or replace вимагає функцію цілком.

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

  -- category <> 'admin': ручна накрутка адміна не витрачає денний бюджет.
  select coalesce(sum(delta), 0) into day_sum
  from elo_events
  where user_id = uid and season = szn and day = p_day and delta > 0 and category <> 'admin';
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

revoke execute on function public.elo_try_clean_day(uuid, text, date, jsonb, integer, boolean) from public, anon, authenticated;

-- Та сама одна умова в elo_submit. Тіло функції — точна копія з
-- db/elo-authoritative.sql, змінений лише запит денної стелі нижче;
-- create or replace інакше не вміє, тільки функцію цілком.
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

  -- Денна стеля. category <> 'admin': ручна накрутка адміна (db/admin-elo.sql)
  -- не витрачає денний бюджет — інакше подія «поставити 1500» з'їдала б
  -- стелю дня, і чесне тренування того ж дня коштувало б менше.
  select coalesce(sum(delta), 0) into day_sum
  from elo_events
  where user_id = uid and season = szn and day = p_day and delta > 0 and category <> 'admin';
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

revoke execute on function public.elo_submit(text, text, date, jsonb) from public, anon;
grant execute on function public.elo_submit(text, text, date, jsonb) to authenticated;

-- --------------------------------------------------------------------------
-- 2. Виставити ELO користувачеві
-- --------------------------------------------------------------------------
-- Приймає ЦІЛЬОВЕ значення, а не дельту: адмін думає «хочу 1500», а не
-- «хочу +1372». Дельта рахується сама й лягає в журнал.
--
-- Значення затискається в [0, seasonMax] з конфігурації — навіть адмін не
-- ставить 99999, інакше рівні й ELITE-поріг перестають щось означати.
create or replace function public.admin_elo_set(p_user uuid, p_elo integer, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

  -- action_key унікальний на користувача: без нього друге виставлення того
  -- самого дня впало б у unique(user_id, action_key). Мітка часу в ключі
  -- заразом лишає в журналі, коли саме це сталось.
  insert into elo_events (user_id, season, day, category, action_key, quality, delta, elo_after, reason)
  values (p_user, szn, current_date, 'admin',
          'admin:' || extract(epoch from clock_timestamp())::bigint || ':' || md5(random()::text),
          0, diff, target, note);

  return jsonb_build_object('ok', true, 'elo', target, 'delta', diff, 'season', szn);
end;
$$;

revoke execute on function public.admin_elo_set(uuid, integer, text) from public, anon;
grant execute on function public.admin_elo_set(uuid, integer, text) to authenticated;

-- --------------------------------------------------------------------------
-- 3. Список акаунтів із поточним ELO
-- --------------------------------------------------------------------------
-- Щоб адмінка показувала, кому що ставити, і одразу бачила результат.
-- Повертає лише те, що потрібно списку: хто, скільки очок, який рівень
-- рахується на клієнті з тієї самої конфігурації.
create or replace function public.admin_elo_list(p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  szn text := season_of(current_date);
  out jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;

  -- Сортування ЧИСЛОМ, не текстом: jsonb_agg(... order by x->>'elo') дав би
  -- лексикографічний порядок, де «9» стоїть вище за «1500».
  select coalesce(jsonb_agg(t.x order by t.elo desc, t.created_at), '[]'::jsonb) into out from (
    select coalesce(ss.elo, 0) as elo,
           u.created_at as created_at,
           jsonb_build_object(
             'userId',   u.id,
             'email',    u.email,
             'username', coalesce(ss.display_name, ar.username),
             'elo',      coalesce(ss.elo, 0),
             'me',       (u.id = me)) as x
    from auth.users u
    left join season_state ss on ss.user_id = u.id and ss.season = szn
    left join account_status ar on ar.user_id = u.id
    order by coalesce(ss.elo, 0) desc, u.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) t;

  return jsonb_build_object('season', szn, 'rows', out);
end;
$$;

revoke execute on function public.admin_elo_list(integer) from public, anon;
grant execute on function public.admin_elo_list(integer) to authenticated;
