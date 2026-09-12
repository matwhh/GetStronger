-- =============================================================================
-- ПЕРЕРАХУНОК ПОТОЧНОГО СЕЗОНУ ПІД НОВИЙ ТЕМП  (одноразово, після elo-pace.sql)
-- =============================================================================
-- Виконувати в SQL Editor як є. Схему не чіпає — лише рейтинг поточного
-- сезону тих, хто вже щось набрав за СТАРИМ плоским темпом.
--
-- ЧОМУ ВЗАГАЛІ ПЕРЕРАХУНОК. db/elo-pace.sql зробив вартість дії залежною від
-- рівня: на першому рівні множник 2.1. Сезон AUTUMN-2026 почався 1 вересня,
-- тобто дюжина днів уже зіграна за плоскою шкалою. Лишити як є означало б, що
-- той, хто почав раніше, за це й покараний: ті самі тренування коштували йому
-- удвічі менше, ніж коштуватимуть тому, хто прийде завтра.
--
-- ЧОГО СКРИПТ НЕ РОБИТЬ І ЧОМУ. Він НЕ переписує дельти старих подій. Подія в
-- журналі — це факт: «того дня нараховано стільки». Людина бачила «+10», і
-- претензія «чому в журналі тепер +22, я такого не бачив» була б
-- справедливою. Тому різниця заходить ОДНІЄЮ подією категорії 'admin' — тим
-- самим механізмом, що в admin_elo_set. Заразом це єдина категорія, яку
-- двигун виключає з денних і тижневих стель (category <> 'admin'), тож
-- перерахунок не з'їдає бюджет майбутніх днів.
--
-- САМОПЕРЕВІРКА, БЕЗ ЯКОЇ СКРИПТ НЕ МАЄ ПРАВА ПИСАТИ. Нова дельта рахується не
-- з готового числа, а з quality самої події — тією ж формулою, що в
-- elo_action_delta. Перш ніж узяти нову, скрипт рахує СТАРУ (та сама формула з
-- темпом 1) і звіряє з тим, що записано в події. Не збіглося — значить
-- формула тут не та, що в двигуні, і весь перерахунок недійсний: скрипт падає
-- й не пише нічого.
--
-- СТЕЛІ НЕ МОДЕЛЮЮТЬСЯ, А ПЕРЕВІРЯЮТЬСЯ. Повторити elo_submit цілком (стеля
-- дня, тижневий бюджет тренувань, кімната тижня, порядок подій у добі)
-- означало б написати другу копію двигуна — саме те, чого цей проєкт не
-- робить. Натомість скрипт веде денні й тижневі суми й доводить, що жодна
-- стеля не спрацьовує: поки суми лежать під межами, порядок подій на
-- результат не впливає. Щойно якась підходить до межі — скрипт падає з
-- поясненням, і перерахунок робиться руками.
--
-- Успіх виглядає так:
--     NOTICE:  ПЕРЕРАХУНОК: 3ed0794f… AUTUMN-2026: 24 → 52 (+28)
--     NOTICE:  ПЕРЕРАХУНОК: акаунтів змінено 1
-- =============================================================================
do $$
declare
  cfg jsonb := (select data from public.elo_config where id = 1);
  szn text := public.season_of(current_date);
  u record; e record;
  pace numeric; base numeric;
  d_new int; d_old int; planned int;
  v_elo int; was int; diff int;
  day_cap int; week_cap int; train_cap int;
  cur_day date; cur_week date;
  day_sum int; week_sum int; week_train int;
  changed int := 0;
begin
  if (cfg->>'version')::int < 3 or cfg->'levelPace' is null then
    raise exception 'КОНФІГ СТАРИЙ: спершу db/elo-pace.sql, аж потім цей скрипт';
  end if;

  for u in
    select s.user_id
    from public.season_state s
    where s.season = szn
      and exists (select 1 from public.elo_events v
                  where v.user_id = s.user_id and v.season = szn)
  loop
    -- Повторний прогін. Ключ дії унікальний на користувача, тож друга спроба
    -- впала б на unique(user_id, action_key) — і то вже ПІСЛЯ того, як
    -- season_state оновлено, тобто рейтинг поїхав би вдруге, а журнал ні.
    -- Тому вихід тут, до будь-якого запису.
    if exists (select 1 from public.elo_events v
               where v.user_id = u.user_id
                 and v.action_key = 'admin:pace-recount:' || szn) then
      raise notice 'ПЕРЕРАХУНОК: % %: уже робився, пропускаю', u.user_id, szn;
      continue;
    end if;

    v_elo := 0;
    cur_day := null; cur_week := null;
    day_sum := 0; week_sum := 0; week_train := 0;

    for e in
      select * from public.elo_events
      where user_id = u.user_id and season = szn
      order by day, id
    loop
      -- Темп береться від ELO ПЕРЕД подією — так само, як у elo_submit, де
      -- st.elo читається до нарахування.
      pace := public.elo_pace(v_elo, cfg);

      if e.day is distinct from cur_day then cur_day := e.day; day_sum := 0; end if;
      if date_trunc('week', e.day)::date is distinct from cur_week then
        cur_week := date_trunc('week', e.day)::date; week_sum := 0; week_train := 0;
      end if;

      if e.category in ('training','nutrition','sleep','recovery','activity') then
        if e.category = 'training' then
          -- Тренування діляться на ЗАПЛАНОВАНІ дні тижня, решта — на добу.
          select p.planned into planned from public.elo_week_plan p
            where p.user_id = u.user_id and p.week_start = cur_week;
          if planned is null then
            raise exception 'НЕМА ЗНІМКА ПЛАНУ на тиждень % (подія %) — перерахунок неможливий',
              cur_week, e.id;
          end if;
          base := (cfg->>'weeklyBudget')::numeric * pace * (cfg->>'categoryShare')::numeric
                  * (cfg#>>'{weights,training}')::numeric / greatest(1, planned) * e.quality;
        elsif e.category = 'nutrition' then
          base := (cfg->>'weeklyBudget')::numeric * pace * (cfg->>'categoryShare')::numeric
                  * (cfg#>>'{weights,nutrition}')::numeric / 7 * e.quality;
        elsif e.category = 'recovery' then
          base := (cfg->>'weeklyBudget')::numeric * pace * (cfg->>'categoryShare')::numeric
                  * (cfg#>>'{weights,recovery}')::numeric / 7 * e.quality;
        elsif e.category = 'sleep' then
          -- Сон і активність тримають у quality СИРЕ відношення, а бюджет
          -- множиться на драбину від нього (elo_action_delta, гілки sleep і
          -- activity). Харчування й recovery, навпаки, кладуть у quality уже
          -- готовий множник — тому в них драбини тут немає.
          base := (cfg->>'weeklyBudget')::numeric * pace * (cfg->>'categoryShare')::numeric
                  * (cfg#>>'{weights,sleep}')::numeric / 7
                  * public.elo_ladder(cfg#>'{tolerance,sleep}', e.quality);
        else
          base := (cfg->>'weeklyBudget')::numeric * pace * (cfg->>'categoryShare')::numeric
                  * (cfg#>>'{weights,activity}')::numeric / 7
                  * public.elo_ladder(cfg#>'{tolerance,activity}', e.quality);
        end if;

        d_new := round(base)::int;
        d_old := round(base / pace)::int;

        if d_old <> e.delta then
          raise exception 'ФОРМУЛА НЕ СХОДИТЬСЯ на події % (% %): порахували %, у журналі % — перерахунок скасовано',
            e.id, e.category, e.day, d_old, e.delta;
        end if;
      else
        -- Штрафи, бонуси й адмінські правки темпом НЕ масштабуються: ціна
        -- помилки однакова на всіх рівнях, і саме це робить шкалу все важчою.
        d_new := e.delta;
      end if;

      if d_new > 0 then
        day_sum := day_sum + d_new;
        week_sum := week_sum + d_new;
        if e.category = 'training' then week_train := week_train + d_new; end if;
      end if;

      day_cap   := round((cfg->>'dayGainCap')::numeric * pace)::int;
      week_cap  := floor((cfg->>'weeklyBudget')::numeric * pace)::int;
      train_cap := round((cfg->>'weeklyBudget')::numeric * pace
                         * (cfg->>'categoryShare')::numeric
                         * (cfg#>>'{weights,training}')::numeric)::int;
      if day_sum > day_cap or week_sum > week_cap or week_train > train_cap then
        raise exception 'СТЕЛЯ СПРАЦЮВАЛА на події %: доба %/%, тиждень %/%, тренування %/% — перерахунок робити руками',
          e.id, day_sum, day_cap, week_sum, week_cap, week_train, train_cap;
      end if;

      v_elo := least((cfg->>'seasonMax')::int, greatest(0, v_elo + d_new));
    end loop;

    select s.elo into was from public.season_state s
      where s.user_id = u.user_id and s.season = szn;
    diff := v_elo - was;

    if diff <> 0 then
      update public.season_state
        set elo = v_elo, updated_at = now()
        where user_id = u.user_id and season = szn;
      insert into public.elo_events
        (user_id, season, day, category, event_type, action_key,
         quality, delta, elo_after, reason)
      values (u.user_id, szn, current_date, 'admin', 'admin',
              'admin:pace-recount:' || szn,
              0, diff, v_elo,
              'Перерахунок за новою кривою темпу (elo_pace_level_curve)');
      changed := changed + 1;
      raise notice 'ПЕРЕРАХУНОК: % %: % → % (%)', u.user_id, szn, was, v_elo,
        case when diff > 0 then '+' || diff else diff::text end;
    else
      raise notice 'ПЕРЕРАХУНОК: % %: без змін (%)', u.user_id, szn, was;
    end if;
  end loop;

  raise notice 'ПЕРЕРАХУНОК: акаунтів змінено %', changed;
end $$;
