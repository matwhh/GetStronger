-- =============================================================================
-- ОЦІНКА ТИЖНЯ: чотири HIGH з аудиту 2026-09
-- =============================================================================
-- Міграція: elo_week_eval_fix
--
-- ELO-001. Тиждень оцінювався щойно неділя минула (w + 6 < current_date), а
--   вікно подання (submitWindowDays, зараз 2 дні) при цьому ще відкрите. Тобто
--   подія за неділю, подана в понеділок після 03:00 Києва — офлайн-черга,
--   сесія без явного завершення, «закрити вчора» — приходила ВЖЕ ПІСЛЯ того,
--   як тиждень порахували без неї. Людина отримувала −8 замість +9, і маркер
--   'week' робив цю оцінку остаточною. Cron цю умову дотримував, клієнтський
--   шлях — ні; тобто чим справніше працював застосунок, тим частіше він же й
--   псував рахунок.
--
-- ELO-002. Cron проходив по ВСІХ approved за останні 4 тижні без жодної
--   прив'язки до першої події людини. Новачок отримував −8 × planned за
--   кожен повний тиждень сезону ДО своєї реєстрації, а для акаунтів, які
--   не подали жодної події, створювались нульові рядки season_state — вони
--   потрапляли в лідерборд і в знаменник percentile.
--
-- ELO-004. Перевірка «тиждень уже оцінено» стояла ДО блокування рядка.
--   Виклики, що стартували до коміту першого, проходили перевірку, чекали на
--   FOR UPDATE і кожен додавав pen + bon до season_state; вставка маркера
--   мовчки пропускалась (on conflict do nothing), і нарахування не
--   поверталось. Наслідок без умислу — подвійний штраф від cron і клієнта;
--   з умислом — паралельні виклики elo_evaluate_week у чистий тиждень
--   давали +9 × N. Ledger розходився зі станом назавжди.
--   Тепер маркер вставляється ПЕРШИМ і саме він є замком: хто вставив, той і
--   рахує. Заразом elo_evaluate_week прибрано в authenticated — фронтенд її
--   не кличе (js/elo-api.js ходить у elo_catch_up), а ручний виклик з
--   браузера потрібен лише для експлуатації.
--
-- ELO-005. Останній тиждень сезону не оцінювався НІКОЛИ: придатність
--   наставала вже в наступному сезоні, а там і cron, і elo_eval_week_for
--   відкидали тиждень як other_season. Через це в базі немає жодного
--   week-рядка за серпень (SUMMER-2026), і те саме сталося б із
--   23–29.11 AUTUMN-2026. Тепер тиждень оцінюється за СВОЇМ сезоном, поки
--   той не закритий у season_history цієї людини.
--
-- НІЧОГО НЕ ПЕРЕРАХОВУЄТЬСЯ ЗАДНІМ ЧИСЛОМ. Міграція міняє правила на
-- майбутнє й не чіпає жодного наявного рядка elo_events чи season_state:
-- переписувати людям минулий рахунок — гірше, ніж лишити його неточним.
-- Тижні, які через ELO-005 лишились неоціненими, можна добити окремо й
-- свідомо (див. кінець файла), а не автоматично.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Одна перевірка придатності тижня на всі шляхи
-- -----------------------------------------------------------------------------
-- Раніше умова була в трьох місцях (cron, elo_catch_up_weeks,
-- elo_eval_week_for) і в двох із трьох — різна. Це і є ELO-001.
create or replace function public.elo_week_ready(uid uuid, p_week_start date, cfg jsonb)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  swd int := coalesce((cfg->>'submitWindowDays')::int, 2);
  szn text;
  first_day date;
begin
  if extract(isodow from p_week_start) <> 1 then return 'not_monday'; end if;

  /* ELO-001: чекаємо не лише кінця тижня, а й кінця вікна подання. */
  if p_week_start + 6 + swd >= current_date then return 'week_not_over'; end if;

  szn := season_of(p_week_start + 6);

  /* ELO-005: сезон тижня, а не поточний. Оцінюємо, поки людина цей сезон
     не закрила — інакше останній тиждень не оцінюється ніколи. */
  if exists (select 1 from season_history h where h.user_id = uid and h.season = szn) then
    return 'season_closed';
  end if;

  /* ELO-002: до першої події людини тижнів не існує. Без цього cron
     штрафував новачків за час до реєстрації. */
  select min(day) into first_day from elo_events e where e.user_id = uid and e.season = szn;
  if first_day is null or p_week_start + 6 < first_day then
    return 'before_first_event';
  end if;

  return null;
end;
$$;

revoke all on function public.elo_week_ready(uuid, date, jsonb) from public;
grant execute on function public.elo_week_ready(uuid, date, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Оцінка тижня: маркер як замок
-- -----------------------------------------------------------------------------
create or replace function public.elo_eval_week_for(uid uuid, p_week_start date, cfg jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  szn text; st season_state;
  planned int; done int; meals int;
  grace_days int := 0; expected int; missed int;
  pen int := 0; bon int := 0; d int;
  why text; ev_id bigint;
begin
  why := public.elo_week_ready(uid, p_week_start, cfg);
  if why is not null then
    return jsonb_build_object('ok', false, 'error', why);
  end if;

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
  expected := round(planned * (1 - grace_days / 7.0));
  missed := greatest(0, expected - done);
  pen := missed * (cfg->>'missedWorkoutPenalty')::int;
  if done >= planned and meals >= 7 then
    bon := least((cfg->>'cleanWeekBonus')::int, public.elo_week_room(uid, p_week_start, cfg));
  end if;
  d := pen + bon;

  /*
   * ELO-004: МАРКЕР ПЕРШИМ, І САМЕ ВІН — ЗАМОК.
   *
   * Унікальний (user_id, action_key) означає, що вставити рядок 'week:<дата>'
   * може рівно один виклик. Конкурент блокується тут же, після коміту
   * переможця отримує нуль рядків — і чесно каже duplicate, не чіпаючи
   * season_state. Раніше замком був FOR UPDATE ПІСЛЯ перевірки exists, і
   * кожен виклик, що встиг пройти перевірку до коміту, додавав свою дельту.
   *
   * elo_after поки нуль: справжнє значення відоме лише після update нижче.
   */
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
                            'cleanWeek', bon > 0, 'planned', planned);
end;
$$;

revoke all on function public.elo_eval_week_for(uuid, date, jsonb) from public;
grant execute on function public.elo_eval_week_for(uuid, date, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Догін тижнів: та сама умова придатності
-- -----------------------------------------------------------------------------
create or replace function public.elo_catch_up_weeks(uid uuid, szn text, cfg jsonb)
returns void
language plpgsql security definer set search_path = public as $$
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
  /*
   * Межа циклу — кінець сезону, а не сьогодні: інакше останній тиждень
   * сезону, придатність якого настає вже в наступному, не догоняється
   * ніколи (ELO-005). Придатність кожного тижня вирішує elo_week_ready.
   */
  while w <= (select e from season_bounds(szn)) and guard < 20 loop
    guard := guard + 1;
    if season_of(w + 6) = szn
       and public.elo_week_ready(uid, w, cfg) is null then
      perform public.elo_eval_week_for(uid, w, cfg);
    end if;
    w := w + 7;
  end loop;
end;
$$;

revoke all on function public.elo_catch_up_weeks(uuid, text, jsonb) from public;
grant execute on function public.elo_catch_up_weeks(uuid, text, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Догін із клієнта: ще й хвіст попереднього сезону
-- -----------------------------------------------------------------------------
create or replace function public.elo_catch_up()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cfg jsonb; prev text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;

  /* Сезон, якому належав тиждень, що закінчився перед поточним: саме його
     останній тиждень раніше лишався неоціненим назавжди (ELO-005). */
  prev := season_of((select s from season_bounds(season_of(current_date))) - 1);
  if prev <> season_of(current_date) then
    perform public.elo_catch_up_weeks(uid, prev, cfg);
  end if;

  perform public.elo_catch_up_weeks(uid, season_of(current_date), cfg);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.elo_catch_up() from public;
grant execute on function public.elo_catch_up() to authenticated;
grant execute on function public.elo_catch_up() to service_role;

-- -----------------------------------------------------------------------------
-- Cron: тільки ті, у кого є події
-- -----------------------------------------------------------------------------
create or replace function public.elo_cron_eval_week(p_weeks_back integer DEFAULT 4)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; today date := current_date;
  wk date; i int; r record; res jsonb;
  n_ok int := 0; n_dup int := 0; n_err int := 0; n_skip int := 0;
  weeks date[] := '{}'; errs text[] := '{}';
begin
  select data into cfg from elo_config where id = 1;

  wk := today - (extract(isodow from today)::int - 1);   -- понеділок цього тижня
  for i in 1..greatest(1, p_weeks_back) loop
    wk := wk - 7;
    weeks := weeks || wk;
  end loop;

  foreach wk in array weeks loop
    /*
     * ELO-002: перебираємо не всіх approved, а тих, у кого є подія В ЦЬОМУ
     * ТИЖНІ або раніше в тому ж сезоні. Раніше цикл ішов по всіх, і новачок
     * отримував −8 × planned за кожен тиждень сезону до своєї реєстрації, а
     * акаунт без жодної події діставав нульовий рядок season_state і місце
     * в лідерборді.
     *
     * Придатність самого тижня (вікно подання, сезон, закритість) перевіряє
     * elo_week_ready усередині elo_eval_week_for — тут її дублювати не
     * можна, інакше умови знову розʼїдуться.
     */
    for r in
      select distinct e.user_id
      from elo_events e
      join account_status a on a.user_id = e.user_id and a.status = 'approved'
      where e.season = season_of(wk + 6) and e.day <= wk + 6
    loop
      begin
        res := public.elo_eval_week_for(r.user_id, wk, cfg);
        if coalesce((res->>'duplicate')::boolean, false) then n_dup := n_dup + 1;
        elsif coalesce((res->>'ok')::boolean, false)     then n_ok  := n_ok  + 1;
        else
          n_skip := n_skip + 1;
          errs := errs || coalesce(res->>'error', '?');
        end if;
      exception when others then
        -- Одна людина не має валити підбиття решти.
        n_err := n_err + 1;
        errs := errs || sqlerrm;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', n_err = 0,
    'weeks', to_jsonb(weeks),
    'evaluated', n_ok, 'duplicate', n_dup, 'skipped', n_skip, 'failed', n_err,
    'reasons', to_jsonb((select array_agg(distinct e) from unnest(errs) e)));
end $$;

revoke all on function public.elo_cron_eval_week(integer) from public;
grant execute on function public.elo_cron_eval_week(integer) to service_role;

-- -----------------------------------------------------------------------------
-- ELO-004: ручний виклик оцінки тижня прибрано в клієнта
-- -----------------------------------------------------------------------------
-- Фронтенд її не кличе (js/elo-api.js ходить у elo_catch_up). Лишати
-- викликуваною з браузера означає лишати кнопку «нарахувати собі тиждень».
revoke execute on function public.elo_evaluate_week(date) from authenticated;
