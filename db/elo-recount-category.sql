-- =============================================================================
--  ПЕРЕРАХУНОК СЕЗОНУ ПІСЛЯ ЗМІНИ НАБОРУ КАТЕГОРІЙ
-- =============================================================================
--
--  ЩО ЦЕ. db/elo-skip-category.sql навчив рейтинг не рахувати вимкнену
--  категорію — але лише ВПЕРЕД. Людина, яка вимикає харчування в середині
--  сезону, лишалась із половиною сезону, порахованою за старими вагами:
--  недосяжні 30 % за перші півсезону нікуди не дівались, і вимикач
--  виглядав як «з понеділка буде чесно, а до понеділка терпи».
--
--  Тепер зміна набору категорій перераховує ПОТОЧНИЙ сезон.
--
--  ЧОГО ЦЕЙ КОД НЕ РОБИТЬ. Він не переписує дельти старих подій. Подія в
--  журналі — це факт: «того дня нараховано стільки». Людина бачила «+10»,
--  і претензія «чому там тепер +14, я такого не бачив» була б
--  справедливою. Різниця заходить ОДНІЄЮ подією категорії 'admin' — тим
--  самим механізмом, що в db/elo-pace-recount.sql, звідки взято й усю
--  решту обережності нижче. Заразом 'admin' — єдина категорія, яку двигун
--  виключає з денних і тижневих стель, тож перерахунок не зʼїдає бюджет
--  майбутніх днів.
--
--  САМОПЕРЕВІРКА, БЕЗ ЯКОЇ ФУНКЦІЯ НЕ МАЄ ПРАВА ПИСАТИ. Нова дельта
--  рахується не з готового числа, а з quality самої події — тією ж
--  формулою, що в elo_action_delta. Перш ніж узяти нову, функція мусить
--  ВІДТВОРИТИ ту, що вже записана. Не відтворилась — значить формула тут
--  не та, що в двигуні, і весь перерахунок недійсний: виняток, нуль
--  записів.
--
--  ЖУРНАЛ ЗМІШАНИЙ, І ЦЕ НОРМАЛЬНО. Події до вимкнення категорії
--  писались одним конфігом, після — іншим, а перерахунок ми нікому не
--  переписуємо. Тому самоперевірка питає не «той самий конфіг», а
--  «будь-який із МОЖЛИВИХ»: базовий і персональний. Якщо жодним не
--  виходить — це вже не змішаний журнал, а розходження з двигуном, і
--  функція падає.
--
--  Через це їй і не потрібен аргумент «що було до»: набір кандидатів
--  вона знає сама, а брехати нема про що.
--
--  СТЕЛІ НЕ МОДЕЛЮЮТЬСЯ, А ПЕРЕВІРЯЮТЬСЯ. Повторити elo_submit цілком
--  означало б написати другу копію двигуна — саме те, чого цей проєкт не
--  робить. Натомість ведуться денні й тижневі суми й доводиться, що
--  жодна стеля не спрацьовує: поки суми лежать під межами, порядок подій
--  у добі на результат не впливає. Щойно якась підходить до межі —
--  перерахунок скасовується, а вимикач усе одно лишається чинним уперед.
--
--  ДВІЧІ НА СЕЗОН. Перерахунок дає вибрати кращу з двох оцінок уже
--  ПІСЛЯ того, як сезон зіграно: у кого щоденник їжі вівся абияк, тому
--  вигідно вимкнути категорію заднім числом. Тому ліміт — той самий, що
--  в Grace Weeks: два на сезон. Далі вимикач працює, але лише вперед.
--
--  Дзеркало клієнта тут не потрібне: перерахунок робить тільки сервер,
--  клієнт після відповіді просто питає стан наново.
--  Відкат: db/elo-recount-category-rollback.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Конфіг із заданим списком вимкнених категорій
-- -----------------------------------------------------------------------------
-- Та сама арифметика, що в elo_cfg_for, але список приходить аргументом, а
-- не з профілю: перерахунку потрібні ОБИДВА конфіги — старий і новий, — і
-- старого в профілі вже немає.
--
-- elo_cfg_for тепер делегує сюди: дві копії нормування ваг розійшлися б на
-- першій же правці, і розійшлися б тихо.
create or replace function public.elo_cfg_apply(cfg jsonb, skip text[])
returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  keys text[];
  total numeric := 0;
  w jsonb := '{}'::jsonb;
  k text;
begin
  if cfg is null or cfg->'weights' is null then return cfg; end if;
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

revoke all on function public.elo_cfg_apply(jsonb, text[]) from public;
grant execute on function public.elo_cfg_apply(jsonb, text[]) to service_role;

create or replace function public.elo_cfg_for(uid uuid, cfg jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  raw jsonb;
  skip text[];
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
  return public.elo_cfg_apply(cfg, skip);
end $$;

revoke all on function public.elo_cfg_for(uuid, jsonb) from public;
grant execute on function public.elo_cfg_for(uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Дельта однієї ПОДІЇ за заданим конфігом
-- -----------------------------------------------------------------------------
-- У журналі лежить quality, а не сирі факти дня, тож дельта відновлюється
-- саме з неї. Сон і активність тримають у quality СИРЕ відношення, а бюджет
-- множиться на драбину від нього; харчування й recovery кладуть у quality
-- уже готовий множник — тому в них драбини тут немає. Це не вибір цього
-- файла, а форма elo_action_delta, і повторена вона тут дослівно.
create or replace function public.elo_event_delta(cfg jsonb, cat text, q numeric,
                                                  p_pace numeric, planned int)
returns int
language plpgsql immutable set search_path = public as $$
declare
  base numeric;
  w numeric := coalesce((cfg#>>array['weights', cat])::numeric, 0);
  weekly numeric := (cfg->>'weeklyBudget')::numeric * p_pace * (cfg->>'categoryShare')::numeric;
begin
  -- Вимкнена категорія — ваги немає, отже нуль. Саме так вона й перестає
  -- рахуватись у перерахованому сезоні.
  if w = 0 then return 0; end if;
  if cat = 'training' then
    base := weekly * w / greatest(1, planned) * q;
  elsif cat = 'sleep' then
    base := weekly * w / 7 * public.elo_ladder(cfg#>'{tolerance,sleep}', q);
  elsif cat = 'activity' then
    base := weekly * w / 7 * public.elo_ladder(cfg#>'{tolerance,activity}', q);
  else
    base := weekly * w / 7 * q;
  end if;
  return round(base)::int;
end $$;

revoke all on function public.elo_event_delta(jsonb, text, numeric, numeric, int) from public;
grant execute on function public.elo_event_delta(jsonb, text, numeric, numeric, int) to service_role;

-- -----------------------------------------------------------------------------
-- Сам перерахунок
-- -----------------------------------------------------------------------------
create or replace function public.elo_recount_categories()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cfg jsonb := (select data from public.elo_config where id = 1);
  szn text := public.season_of(current_date);
  new_cfg jsonb;
  cands jsonb[];
  c jsonb;
  e record;
  v_elo int := 0; was int; diff int;
  d_new int; d_try int; matched boolean; planned int; p_pace numeric;
  day_cap int; week_cap int; train_cap int;
  cur_day date; cur_week date;
  day_sum int := 0; week_sum int := 0; week_train int := 0;
  used int;
  akey text;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;

  new_cfg := public.elo_cfg_for(uid, cfg);
  /* Кандидати самоперевірки: базовий конфіг і персональний. Зʼявиться
     третій вимикач — цей масив мусить вирости разом із ним; поки що
     невідповідність валить функцію вголос, а не мовчки псує рейтинг. */
  cands := array[cfg, new_cfg];

  select count(*) into used from public.elo_events
    where user_id = uid and season = szn and action_key like 'admin:cat-recount:%';
  if used >= 2 then
    return jsonb_build_object('ok', false, 'error', 'limit', 'used', used);
  end if;
  akey := 'admin:cat-recount:' || szn || ':' || (used + 1);

  for e in
    select * from public.elo_events
    where user_id = uid and season = szn
    order by day, id
  loop
    -- Темп береться від ELO ПЕРЕД подією — так само, як у elo_submit, де
    -- st.elo читається до нарахування.
    p_pace := public.elo_pace(v_elo, cfg);

    if e.day is distinct from cur_day then cur_day := e.day; day_sum := 0; end if;
    if date_trunc('week', e.day)::date is distinct from cur_week then
      cur_week := date_trunc('week', e.day)::date; week_sum := 0; week_train := 0;
    end if;

    if e.category in ('training','nutrition','sleep','recovery','activity') then
      planned := null;
      if e.category = 'training' then
        select p.planned into planned from public.elo_week_plan p
          where p.user_id = uid and p.week_start = cur_week;
        if planned is null then
          raise exception 'НЕМА ЗНІМКА ПЛАНУ на тиждень % (подія %) — перерахунок неможливий',
            cur_week, e.id;
        end if;
      end if;

      matched := false;
      foreach c in array cands loop
        d_try := public.elo_event_delta(c, e.category, e.quality, p_pace, coalesce(planned, 1));
        if d_try = e.delta then matched := true; exit; end if;
      end loop;
      if not matched then
        raise exception 'ФОРМУЛА НЕ СХОДИТЬСЯ на події % (% %): у журналі % — перерахунок скасовано',
          e.id, e.category, e.day, e.delta;
      end if;

      d_new := public.elo_event_delta(new_cfg, e.category, e.quality, p_pace, coalesce(planned, 1));
    elsif e.action_key like 'admin:cat-recount:%' then
      /*
       * РЯДКИ ПОПЕРЕДНІХ ПЕРЕРАХУНКІВ У ЗАМІР НЕ ВХОДЯТЬ.
       *
       * Перерахунок відтворює сезон із нуля за подіями категорій — а
       * рядок попереднього перерахунку і є різницею між двома такими
       * замірами. Порахувати його ще раз означало б накладати поправку
       * на поправку: другий перерахунок додавав би +9 до числа, яке цих
       * +9 уже не потребує. Знайдено тестом «двічі на сезон».
       *
       * Стан (season_state.elo) їх, навпаки, містить — і саме тому
       * різниця нижче рахується як «новий замір мінус нинішній стан».
       */
      d_new := 0;
    else
      -- Штрафи, бонуси й адмінські правки вагами НЕ масштабуються: ціна
      -- пропуску однакова, хоч скільки категорій людина веде.
      d_new := e.delta;
    end if;

    if d_new > 0 then
      day_sum := day_sum + d_new;
      week_sum := week_sum + d_new;
      if e.category = 'training' then week_train := week_train + d_new; end if;
    end if;

    day_cap   := round((cfg->>'dayGainCap')::numeric * p_pace)::int;
    week_cap  := floor((cfg->>'weeklyBudget')::numeric * p_pace)::int;
    train_cap := round((cfg->>'weeklyBudget')::numeric * p_pace
                       * (cfg->>'categoryShare')::numeric
                       * coalesce((new_cfg#>>'{weights,training}')::numeric, 0))::int;
    if day_sum > day_cap or week_sum > week_cap or week_train > train_cap then
      return jsonb_build_object('ok', false, 'error', 'cap',
        'day', day_sum, 'dayCap', day_cap,
        'week', week_sum, 'weekCap', week_cap,
        'training', week_train, 'trainingCap', train_cap);
    end if;

    v_elo := least((cfg->>'seasonMax')::int, greatest(0, v_elo + d_new));
  end loop;

  select s.elo into was from public.season_state s
    where s.user_id = uid and s.season = szn;
  if was is null then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'no_season');
  end if;
  diff := v_elo - was;
  if diff = 0 then
    return jsonb_build_object('ok', true, 'changed', false, 'reason', 'equal', 'elo', was);
  end if;

  update public.season_state set elo = v_elo, updated_at = now()
    where user_id = uid and season = szn;
  insert into public.elo_events
    (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (uid, szn, current_date, 'admin', 'admin', akey, 0, diff, v_elo,
          'Перерахунок сезону за новим набором категорій');

  return jsonb_build_object('ok', true, 'changed', true,
                            'before', was, 'after', v_elo, 'diff', diff,
                            'used', used + 1);
end $$;

revoke all on function public.elo_recount_categories() from public;
grant execute on function public.elo_recount_categories() to authenticated;
grant execute on function public.elo_recount_categories() to service_role;
