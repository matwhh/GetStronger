-- ============================================================================
-- ПЕРЕКРИТО: elo-skip-category.sql. НЕ ЗАПУСКАТИ ПО БОЙОВІЙ БАЗІ.
-- ============================================================================
-- elo_eval_week_for тут старіша за базу.
--
-- Файл лишається як історія: він пояснює, ЧОМУ база стала такою. Що в
-- ній зараз — db/live-schema.sql. Як міняти базу — db/README.md.
-- Позначку звіряє tools/ci-hygiene.mjs (перевірки 8 і 21).
-- ============================================================================

-- ELO-006. Тиждень, у якому людина приєдналась, оцінювався як повний.
--
-- ЩО БУЛО. expected = round(planned × (1 − grace/7)). planned — це план на
-- ТИЖДЕНЬ, мінімум 3. Якщо заявку схвалили в четвер, у людини лишалось
-- чотири дні, а спитали з неї як за сім: три тренування, з них зроблено
-- одне-два, решта — «пропуски» по −8 ELO. Перше, що бачив новий
-- користувач у понеділок, — мінус за тиждень, у якому його ще не було.
--
-- ЩО СТАЛО. Очікувана кількість масштабується часткою тижня, яка людині
-- була доступна:
--
--   avail    = (кінець тижня) − max(початок тижня, день вступу) + 1
--   expected = round(planned × (1 − grace/7) × avail/7)
--
-- День вступу — найраніше з: дати схвалення заявки (account_status.decided_at)
-- і дня першої події. Друге потрібне для акаунтів, схвалених до появи
-- decided_at; least() у Postgres ігнорує null, тож достатньо одного з двох.
--
-- ЧОГО НЕ ЧІПАЄМО. Бонус за чистий тиждень і далі вимагає done >= planned
-- і 7 днів харчування, тобто в неповному тижні недосяжний. Це навмисно:
-- масштабувати ще й бонус означало б платити повну суму за неповний
-- тиждень, а це вже інша економіка, а не виправлення несправедливості.
--
-- Текст функції взято з pg_get_functiondef бойової бази; змінено рівно два
-- місця — оголошення двох змінних і рядок expected (див. db/README.md про
-- те, чому переписування «як памʼятаю» тут заборонене).

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
  if done >= planned and meals >= 7 then
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
$function$;
