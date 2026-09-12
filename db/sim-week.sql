-- =============================================================================
-- СИМУЛЯЦІЯ: 10 КОРИСТУВАЧІВ, ТИЖДЕНЬ ЖИТТЯ
-- =============================================================================
-- Досі сервер бачив одного користувача — у production і був один. Скрипт
-- заселяє базу десятьма профілями з різною старанністю, проживає ними всі
-- доступні дні поточного тижня через справжні elo_submit / elo_leaderboard
-- і перевіряє те, що має сенс перевіряти саме на багатьох: чи не з'їдають
-- вони бюджет одне одному, чи не зливаються події, чи тримаються стелі.
--
-- Виконувати як є: скрипт НАВМИСНО завершується винятком — усе відкочується.
-- Успіх:  ERROR:  SIM: N з N пройдено
--
-- ТРИ КАПКАНИ, які знайшлися вже під час написання самої симуляції:
--   1. generate_series по датах повертає TIMESTAMP. Без ::date ключі фактів
--      мали вигляд "2026-09-02 00:00:00", сервер не бачив жодного факту, і
--      всі десятеро закінчили з нулем — а перевірки інваріантів були зелені,
--      бо на порожніх даних порушувати нічого.
--   2. `exception when others then null` навколо elo_submit ховав причину.
--      Помилки тепер рахуються й показуються.
--   3. Посів днів поза вікном ігнорував профіль і давав тренування навіть
--      тим, хто не тренується. У підсумку «новачок» випереджав старанного —
--      таблиця описувала фікстуру, а не поведінку.
--
-- ЧОГО ТУТ НЕМАЄ І ЧОМУ: справжня тижнева оцінка (elo_eval_week_for) вимагає
-- ЗАВЕРШЕНОГО тижня в ПОТОЧНОМУ сезоні. Сезон AUTUMN-2026 почався 1 вересня,
-- перший такий тиждень настане 7-го. Тут перевіряються лише її запобіжники;
-- математику підхопить заплановане завдання на 8 вересня.
-- =============================================================================
do $$
declare
  base text := '00000000-0000-4000-8000-0000000000';   -- + дві цифри номера
  u uuid; uids uuid[] := '{}'; i int; k int;
  d date; dmin date := current_date - 2; dmax date := current_date + 1;
  szn text := season_of(current_date);
  wk  date := date_trunc('week', current_date)::date;
  cfg jsonb := (select data from elo_config where id = 1);
  /* Тренування мають власний тижневий бюджет — частку категорії від
     загального. Саме він, а не денна стеля, обмежує старанного користувача. */
  trainbudget int := round((cfg->>'weeklyBudget')::int * (cfg->>'categoryShare')::numeric
                           * (cfg #>> '{weights,training}')::numeric);
  r jsonb; out text := E'\n'; okn int := 0; alln int := 0; n int; c boolean; txt text;
  elo_a int; elo_b int; elo_c int; elo_d int; mx int; nm text;
  nerr int := 0; firsterr text; days_reachable int; tsum int;
  kinds text[] := array['workout','meal','sleep','recovery','activity'];
  plan_days int[]     := array[5, 4, 3, 3, 6, 3, 4, 3, 5, 7];
  quality   numeric[] := array[1.00, 0.85, 0.62, 0.30, 1.00, 1.00, 0.70, 0.90, 0.95, 1.00];
  label     text[]    := array['ідеальний','добрий','середній','слабкий','лише тренування',
                               'лише харчування','нерівний','новачок','пізній','максималіст'];
begin
  /* Скільки днів тижня взагалі можна прожити сьогодні: майбутні дні не
     існують, а вікно подачі — [сьогодні−2, сьогодні+1]. */
  days_reachable := least(wk + 6, current_date + 1) - wk + 1;

  -- ---- заселення ---------------------------------------------------------
  for i in 1..10 loop
    u := (base || lpad(i::text, 2, '0'))::uuid;
    uids := uids || u;
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'sim' || i || '@local', 'x', now(), now());
    insert into public.account_status (user_id, status, username) values (u, 'approved', 'Sim' || i);
    insert into public.season_state (user_id, season, elo) values (u, szn, 0) on conflict do nothing;

    /* Сервер рахує якість НЕ з payload, а з profiles.data — тому поведінка
       задається тут, а не в аргументах elo_submit. */
    insert into public.profiles (user_id, data)
    select u, jsonb_build_object(
      'activePlan',  jsonb_build_object('days', plan_days[i]),
      'daysPerWeek', plan_days[i],
      'trackers',    '{"sleep":{"goal":480},"steps":{"goal":8000}}'::jsonb,
      'sessionLog', coalesce((
        select jsonb_object_agg(dd::date::text, jsonb_build_object('total', 10, 'done', round(10 * quality[i])))
        from generate_series(wk, wk + 6, '1 day') g(dd)
        /* «новачок» приходить із сьогодні, «лише харчування» не тренується */
        where (i <> 8 or dd::date >= current_date) and i <> 6), '{}'::jsonb),
      'mealLog', coalesce((
        select jsonb_object_agg(dd::date::text, jsonb_build_object(
                 'kcal', round(2500 * quality[i]), 'target', 2500,
                 'p', round(180 * quality[i]), 'pTarget', 180))
        from generate_series(wk, wk + 6, '1 day') g(dd)
        where i <> 5), '{}'::jsonb),   -- «лише тренування» не закриває день
      'trackerLog', jsonb_build_object(
        'sleep',    coalesce((select jsonb_object_agg(dd::date::text, round(480 * quality[i]))
                              from generate_series(wk, wk+6,'1 day') g(dd) where i not in (5,6)), '{}'::jsonb),
        'steps',    coalesce((select jsonb_object_agg(dd::date::text, round(8000 * quality[i]))
                              from generate_series(wk, wk+6,'1 day') g(dd) where i not in (5,6)), '{}'::jsonb),
        'recovery', coalesce((select jsonb_object_agg(dd::date::text, round(8 * quality[i]))
                              from generate_series(wk, wk+6,'1 day') g(dd) where i not in (5,6)), '{}'::jsonb)));
  end loop;

  /* Дні тижня, що вже минули, але випали з вікна подачі, засіваються тими
     самими значеннями, які дав би сервер. Інакше тиждень не набереться і
     тижневі бюджети ніколи не спрацюють. */
  for i in 1..10 loop
    d := wk;
    while d < dmin loop
      /* Посів поважає профіль. Перша редакція засівала всім однаково, і в
         підсумку «новачок», який тренується лише з сьогодні, випереджав
         старанного — цифри описували фікстуру, а не поведінку. */
      if i <> 6 and (i <> 8 or d >= current_date) then
        insert into public.elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
        values (uids[i], szn, d, 'training', 'workout', 'workout:'||d, 1, 10, 0, 'посів');
      end if;
      if i <> 5 then
        insert into public.elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
        values (uids[i], szn, d, 'nutrition', 'meal', 'meal:'||d, 1, 7, 0, 'посів');
      end if;
      if i not in (5, 6) then
        insert into public.elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
        values (uids[i], szn, d, 'sleep',    'sleep',    'sleep:'||d,    1, 5, 0, 'посів'),
               (uids[i], szn, d, 'recovery', 'recovery', 'recovery:'||d, 1, 2, 0, 'посів'),
               (uids[i], szn, d, 'activity', 'activity', 'activity:'||d, 1, 2, 0, 'посів');
      end if;
      d := d + 1;
    end loop;
    update public.season_state set elo = (select coalesce(sum(delta),0) from public.elo_events e
      where e.user_id = uids[i] and e.season = szn) where user_id = uids[i] and season = szn;
  end loop;

  -- ---- життя: кожен подає кожного дня вікна ------------------------------
  for i in 1..10 loop
    perform set_config('request.jwt.claims', json_build_object('sub', uids[i])::text, true);
    set local role authenticated;
    d := dmin;
    while d <= dmax loop
      foreach txt in array kinds loop
        begin
          r := public.elo_submit(txt, txt || ':' || d, d, '{}'::jsonb);
        exception when others then
          nerr := nerr + 1;
          firsterr := coalesce(firsterr, 'Sim' || i || ' ' || txt || ': ' || sqlerrm);
        end;
      end loop;
      d := d + 1;
    end loop;
    reset role;
  end loop;

  c := nerr = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'жодна подача не впала :: винятків ' || nerr || ' ' || coalesce(firsterr,'') || E'\n';

  select count(distinct day) into n from public.elo_events where user_id = uids[1];
  c := n = days_reachable; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'прожито всі доступні дні :: ' || n || ' з ' || days_reachable || E'\n';

  -- ---- ізоляція й цілісність ---------------------------------------------
  select count(*) into n from public.elo_events e where e.user_id = any(uids)
     and not exists (select 1 from public.season_state s where s.user_id = e.user_id and s.season = e.season);
  c := n = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'кожна подія має стан власника :: сиріт ' || n || E'\n';

  select count(*) into n from (select user_id, event_type, day from public.elo_events
    where user_id = any(uids) and event_type <> 'admin' group by 1,2,3 having count(*) > 1) x;
  c := n = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'одна подія на (людину, тип, день) :: дублів ' || n || E'\n';

  select count(*) into n from (select user_id, day from public.elo_events
    where user_id = any(uids) and event_type = 'cleanday' group by 1,2 having count(*) > 1) x;
  c := n = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'бонус за чистий день не подвоївся :: ' || n || E'\n';

  select count(*) into n from public.season_state s where s.user_id = any(uids) and s.season = szn
     and s.elo <> (select coalesce(sum(delta),0) from public.elo_events e where e.user_id = s.user_id and e.season = s.season);
  c := n = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'ELO = сума власних подій :: розбіжностей ' || n || E'\n';

  -- ---- стелі --------------------------------------------------------------
  /*
   * СТЕЛІ БІЛЬШЕ НЕ ПЛОСКІ. Відколи зʼявився темп за рівнем (db/elo-pace.sql),
   * і денна, і тижнева стеля множаться на elo_pace поточного рівня: на
   * першому рівні дії дорожчі, і кімнати під них має бути більше. Порівняння
   * з голим dayGainCap ловило б саме те, що ми навмисно зробили.
   *
   * Темп беремо від НАЙМЕНШОГО elo_after у вікні — це найближче до стану на
   * ПОЧАТКУ дня (чи тижня), тобто від того рівня, за яким сервер і рахував
   * стелю. Якщо рівень усередині вікна виріс, межа виходить трохи щедрішою —
   * для перевірки «ніхто не набрав понад дозволене» це безпечний бік.
   */
  select coalesce(max(over_cap),0) into mx from (
    select sum(delta) - round((cfg->>'dayGainCap')::numeric
                              * public.elo_pace(min(elo_after - delta), cfg))::int as over_cap
    from public.elo_events
    where user_id = any(uids) and delta > 0 group by user_id, day) x;
  c := mx <= 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'денна стеля :: перевищення на ' || mx || ' (з урахуванням темпу рівня)' || E'\n';

  select coalesce(max(over_cap),0) into mx from (
    select sum(delta) - floor((cfg->>'weeklyBudget')::numeric
                              * public.elo_pace(min(elo_after - delta), cfg))::int as over_cap
    from public.elo_events
    where user_id = any(uids) and delta > 0 and category <> 'admin' and day between wk and wk+6
    group by user_id) x;
  c := mx <= 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'тижневий бюджет :: перевищення на ' || mx || ' (з урахуванням темпу рівня)' || E'\n';

  select coalesce(max(over_cap),0) into mx from (
    /* Округлення РАЗ і в тому самому порядку, що на сервері
       (elo_submit): round(бюджет × темп × частка × вага). Два послідовні
       округлення дають розбіжність в одиницю — і перевірка червоніє на
       рівному місці. */
    select sum(delta) - round((cfg->>'weeklyBudget')::numeric
                              * public.elo_pace(min(elo_after - delta), cfg)
                              * (cfg->>'categoryShare')::numeric
                              * (cfg #>> '{weights,training}')::numeric)::int as over_cap
    from public.elo_events
    where user_id = any(uids) and delta > 0 and category = 'training' and day between wk and wk+6
    group by user_id) x;
  c := mx <= 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'тижневий бюджет тренувань :: перевищення на ' || mx || ' (з урахуванням темпу)' || E'\n';

  -- ---- порядок за старанністю ---------------------------------------------
  select elo into elo_a from public.season_state where user_id = uids[1] and season = szn;
  select elo into elo_b from public.season_state where user_id = uids[2] and season = szn;
  select elo into elo_c from public.season_state where user_id = uids[3] and season = szn;
  select elo into elo_d from public.season_state where user_id = uids[4] and season = szn;
  c := elo_a >= elo_b and elo_b >= elo_c and elo_c > elo_d; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'старанніший має більше :: ' || elo_a || ' >= ' || elo_b || ' >= ' || elo_c || ' > ' || elo_d || E'\n';

  -- ---- таблиця лідерів на десятьох ----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', uids[3])::text, true);
  set local role authenticated;
  r := public.elo_leaderboard(50);
  reset role;

  select count(*) into n from jsonb_array_elements(r) e where (e->>'name') like 'Sim%';
  c := n = 10; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'усі десять у таблиці :: ' || n || E'\n';

  select (e->>'name') into nm from jsonb_array_elements(r) e where (e->>'me')::boolean;
  c := nm = 'Sim3'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || '«я» на тому, хто дивиться :: ' || coalesce(nm,'-') || E'\n';

  /* Ранг не має спадати вниз по списку, а однаковий ELO — давати однаковий
     ранг: інакше двоє з тим самим рейтингом побачать різні місця. */
  select count(*) into n from (
    select (e->>'rank')::int rk, (e->>'elo')::int el,
           lag((e->>'rank')::int) over (order by (e->>'rank')::int) prk,
           lag((e->>'elo')::int)  over (order by (e->>'rank')::int) pel
    from jsonb_array_elements(r) e) x
   where prk is not null and ((rk < prk) or (el = pel and rk <> prk));
  c := n = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'ранги послідовні, рівний ELO — рівний ранг :: порушень ' || n || E'\n';

  -- ---- гонка: подія вже є, submit приходить другим -------------------------
  --
  -- TST-015. Тут падало щосуботи й щонеділі, і причина була у ФІКСТУРІ, а не
  -- в сервері. У користувача 5 тижневий бюджет тренувань до кінця тижня вже
  -- вичерпаний посівом (4×10 + 9 + 2 = 51 при бюджеті 51). Тест вставляв
  -- подію з delta 4 повз бюджет і чекав доплати; сервер чесно рахував
  -- inc = least(намір − сплачено, бюджет − витрачено) = 0 і повертав
  -- duplicate. Тобто перевірка вимагала від сервера порушити власну стелю.
  --
  -- Тепер тижневі training-події цього користувача перед сценарієм
  -- прибираються: бюджет звільняється, і реконсиляція має де відбутись.
  u := uids[5];
  delete from public.elo_events
   where user_id = u and category = 'training'
     and day between date_trunc('week', current_date)::date
                 and date_trunc('week', current_date)::date + 6;
  update public.season_state set elo = (select coalesce(sum(delta),0) from public.elo_events e
    where e.user_id = u and e.season = szn) where user_id = u and season = szn;
  delete from public.elo_events where user_id = u and day = current_date and event_type = 'workout';
  insert into public.elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (u, szn, current_date, 'training', 'workout', 'workout:race', 0.5, 4, 0, 'частково зараховано');
  update public.season_state set elo = (select coalesce(sum(delta),0) from public.elo_events e
    where e.user_id = u and e.season = szn) where user_id = u and season = szn;
  select elo into elo_a from public.season_state where user_id = u and season = szn;
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  set local role authenticated;
  r := public.elo_submit('workout', 'workout:'||current_date, current_date, '{}'::jsonb);
  reset role;
  select elo into elo_b from public.season_state where user_id = u and season = szn;
  select count(*) into n from public.elo_events where user_id = u and day = current_date and event_type = 'workout';
  -- Подія має лишитись ОДНА, а доплата — додатною: саме це відрізняє
  -- реконсиляцію від «нічого не сталось» (TST-015: раніше перевірялось
  -- лише n = 1 і прапорець, тож нульова доплата теж вважалась успіхом).
  c := n = 1 and (r->>'reconciled')::boolean is true and (elo_b - elo_a) > 0;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || 'гонка звелась до реконсиляції :: подій ' || n || ', +' || (elo_b - elo_a) || E'\n';

  -- ---- максималіст --------------------------------------------------------
  u := uids[10];
  perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
  set local role authenticated;
  select elo into elo_a from public.season_state where user_id = u and season = szn;
  for k in 1..40 loop
    begin r := public.elo_submit(kinds[1 + (k % 5)], 'rot-'||k||'-'||gen_random_uuid(), current_date,
             jsonb_build_object('minutes', 99999, 'kcal', 99999, 'quality', 9.9));
    exception when others then null; end;
  end loop;
  select elo into elo_b from public.season_state where user_id = u and season = szn;
  reset role;
  c := elo_b = elo_a; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
            || '40 повторів з новими ключами не дали нічого :: ' || elo_a || ' → ' || elo_b || E'\n';

  -- ---- вікно подачі -------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', uids[9])::text, true);
  set local role authenticated;
  r := public.elo_submit('sleep','x', current_date - 5, '{}'::jsonb);
  c := (r->>'error') = 'out_of_window'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'подача на 5 днів назад :: ' || coalesce(r->>'error', r::text) || E'\n';
  r := public.elo_submit('sleep','x', current_date + 5, '{}'::jsonb);
  c := (r->>'error') = 'out_of_window'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'подача на 5 днів уперед :: ' || coalesce(r->>'error', r::text) || E'\n';
  reset role;

  -- ---- запобіжники тижневої оцінки ----------------------------------------
  r := public.elo_eval_week_for(uids[1], wk, cfg);
  c := (r->>'error') = 'week_not_over'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'незавершений тиждень :: ' || coalesce(r->>'error', r::text) || E'\n';
  r := public.elo_eval_week_for(uids[1], wk + 1, cfg);
  c := (r->>'error') = 'not_monday'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'не понеділок :: ' || coalesce(r->>'error', r::text) || E'\n';
  /*
   * Тиждень із ЧУЖОГО сезону.
   *
   * Тут очікувалось 'other_season' — коду, який його повертав, більше немає:
   * після ELO-001/002/005 elo_week_ready віддає 'season_closed', якщо сезон
   * підбито, і 'before_first_event', якщо в цьому сезоні людина ще не існує.
   * Друге — саме наш випадок: симуляція заселяє лише поточний тиждень.
   *
   * wk − 14, а не wk − 7: неділя попереднього тижня ще належить поточному
   * сезону, і відповіддю було б week_not_over (вікно подання не минуло) —
   * тобто перевірка міряла б зовсім інший запобіжник (TST-015).
   */
  r := public.elo_eval_week_for(uids[1], wk - 14, cfg);
  c := (r->>'error') in ('before_first_event', 'season_closed'); alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'тиждень чужого сезону не оцінюється :: ' || coalesce(r->>'error', r::text) || E'\n';

  -- ---- catch_up у всіх ----------------------------------------------------
  n := 0;
  for i in 1..10 loop
    perform set_config('request.jwt.claims', json_build_object('sub', uids[i])::text, true);
    set local role authenticated;
    begin r := public.elo_catch_up(); n := n + 1;
    exception when others then out := out || '   catch_up Sim'||i||': '||sqlerrm||E'\n'; end;
    reset role;
  end loop;
  c := n = 10; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'elo_catch_up відпрацював у всіх :: ' || n || E'\n';

  select count(*) into n from (select user_id, event_type, day from public.elo_events
    where user_id = any(uids) and event_type <> 'admin' group by 1,2,3 having count(*) > 1) x;
  c := n = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'catch_up не наплодив дублів :: ' || n || E'\n';

  -- ---- підсумок -----------------------------------------------------------
  out := out || E'\n  профіль            план  днів  подій  чистих   ELO\n';
  for i in 1..10 loop
    select count(distinct day) into k   from public.elo_events where user_id = uids[i];
    select count(*)            into n   from public.elo_events where user_id = uids[i];
    select count(*)            into tsum from public.elo_events where user_id = uids[i] and event_type = 'cleanday';
    select coalesce(elo,0)     into elo_a from public.season_state where user_id = uids[i] and season = szn;
    out := out || '  ' || rpad(label[i], 18) || lpad(plan_days[i]::text, 4) || lpad(k::text, 6)
               || lpad(n::text, 7) || lpad(tsum::text, 8) || lpad(elo_a::text, 6) || E'\n';
  end loop;

  raise exception 'SIM: % з % пройдено%', okn, alln, out;
end $$;
