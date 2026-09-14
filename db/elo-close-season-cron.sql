-- ============================================================================
-- DB-008: закриття сезону переїжджає на сервер
--
-- ЯК БУЛО. elo_close_season бере користувача з auth.uid(), тобто закрити
-- сезон могла лише сама людина, відкривши сторінку після його кінця. Поки
-- користувач один, це виглядало як дрібниця; насправді це означає, що
-- підсумок сезону — season_history і до 14 рядків awards — не зʼявиться
-- ніколи, якщо в потрібний тиждень ніхто не зайшов. Дедлайн живий:
-- осінь-2026 добігає 2026-12-03.
--
-- Є й тонша вада. Ранг у підсумку рахується по ВСІХ учасниках сезону, а
-- elo_catch_up_weeks може дорахувати останній тиждень і змінити ELO. Поки
-- кожен закривається сам і в різні дні, ранги виходять залежними від
-- того, хто зайшов першим: перший бачить себе серед недорахованих.
--
-- ЩО ЗРОБЛЕНО. Тіло винесене в elo_close_season_for(p_user, p_season) —
-- без auth.uid() і без перевірок доступу, бо це серверна функція, і
-- виконувати її може лише service_role. Клієнтська elo_close_season
-- лишається з тією самою сигнатурою й тими самими перевірками, тільки
-- тепер делегує. Жоден виклик із браузера не змінився.
--
-- Розклад закриває сезон у ДВА ПРОХОДИ: спершу догнати останній тиждень
-- усім, і лише потім рахувати ранги й писати підсумок. Саме заради цього
-- порядку робота й переїхала на сервер — поодинці його не досягти.
--
-- ІДЕМПОТЕНТНІСТЬ. Другий прогін нічого не додає: season_history має
-- первинний ключ (user_id, season), awards — on conflict do nothing, а
-- сама функція повертає duplicate=true, якщо підсумок уже є.
-- ============================================================================

-- 1. Серверне закриття для одного користувача.
--
--    Копія тіла клієнтської функції з однією зміною: uid приходить
--    параметром. Перевірки auth.uid() і is_approved лишились у
--    клієнтській обгортці — тут вони не потрібні й були б шкідливі:
--    розклад закриває сезон і тим, хто того дня не заходив.
create or replace function public.elo_close_season_for(p_user uuid, p_season text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  uid uuid := p_user;
  cfg jsonb; st season_state;
  my_rank int; total int; pctl numeric;
  lvl int; elite boolean;
  d_active int; d_total int;
  stats jsonb; b record;
begin
  if uid is null then raise exception 'no user'; end if;
  select data into cfg from elo_config where id = 1;
  select * into b from season_bounds(p_season);
  if b.e is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_season');
  end if;
  if current_date <= b.e + (cfg->>'submitWindowDays')::int then
    return jsonb_build_object('ok', false, 'error', 'season_running', 'finalAfter', b.e + (cfg->>'submitWindowDays')::int);
  end if;
  if exists (select 1 from season_history where user_id = uid and season = p_season) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  -- ELO-005: останній тиждень сезону оцінюємо ДО підбиття підсумку, поки
  -- season_history ще порожня — інакше він не оцінюється ніколи.
  perform public.elo_catch_up_weeks(uid, p_season, cfg);

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

  -- DB-015: імена колонок замість позицій.
  if lvl >= 5  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level5',  'Season Badge') on conflict do nothing; end if;
  if lvl >= 7  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level7',  'Profile Frame') on conflict do nothing; end if;
  if lvl >= 8  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level8',  'Seasonal Cosmetic') on conflict do nothing; end if;
  if lvl >= 9  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level9',  'Exclusive Reward') on conflict do nothing; end if;
  if lvl >= 10 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level10', 'Legendary Season Reward') on conflict do nothing; end if;
  if elite     then insert into awards (user_id, season, kind, label) values (uid, p_season, 'elite',   'ELITE 2000+') on conflict do nothing; end if;
  if my_rank = 1 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'first', '#1 сезону') on conflict do nothing; end if;
  if my_rank <= 3 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top3', 'Top 3') on conflict do nothing; end if;
  if my_rank <= 10 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top10', 'Top 10') on conflict do nothing; end if;
  if my_rank <= 100 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top100', 'Top 100') on conflict do nothing; end if;
  if my_rank <= 1000 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top1000', 'Top 1000') on conflict do nothing; end if;
  if pctl is not null and pctl <= 10 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top10pct', 'Top 10%') on conflict do nothing; end if;
  if pctl is not null and pctl <= 5  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top5pct',  'Top 5%') on conflict do nothing; end if;
  if pctl is not null and pctl <= 1  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top1pct',  'Top 1%') on conflict do nothing; end if;

  return jsonb_build_object('ok', true, 'elo', st.elo, 'level', lvl, 'elite', elite,
    'rank', my_rank, 'of', total, 'percentile', pctl,
    'daysActive', d_active, 'daysTotal', d_total, 'graceUsed', st.grace_used, 'stats', stats);
end;
$function$;

-- 2. Клієнтська обгортка. Сигнатура й перевірки ті самі, що були.
create or replace function public.elo_close_season(p_season text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  return public.elo_close_season_for(uid, p_season);
end;
$function$;

-- 3. Закриття всіх завершених сезонів. Два проходи — див. шапку.
create or replace function public.elo_cron_close_seasons()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  cfg jsonb; closed int := 0; failed int := 0;
  seasons text[] := '{}'; reasons text[] := '{}';
  s record; u record; b record; r jsonb;
begin
  select data into cfg from elo_config where id = 1;

  for s in select distinct season from season_state loop
    select * into b from season_bounds(s.season);
    continue when b.e is null;
    -- Сезон ще йде або не минуло вікно дописування.
    continue when current_date <= b.e + (cfg->>'submitWindowDays')::int;
    -- Усіх уже закрито — нема чого робити.
    continue when not exists (
      select 1 from season_state ss
      where ss.season = s.season
        and not exists (select 1 from season_history h
                        where h.user_id = ss.user_id and h.season = ss.season));

    seasons := seasons || s.season;

    -- ПРОХІД 1: догнати останній тиждень УСІМ.
    for u in select user_id from season_state where season = s.season loop
      begin
        perform public.elo_catch_up_weeks(u.user_id, s.season, cfg);
      exception when others then
        failed := failed + 1;
        reasons := reasons || (u.user_id::text || ' catchup: ' || sqlerrm);
      end;
    end loop;

    -- ПРОХІД 2: підсумок. Рангу можна вірити лише тепер.
    for u in select user_id from season_state where season = s.season loop
      begin
        r := public.elo_close_season_for(u.user_id, s.season);
        if coalesce((r->>'ok')::boolean, false)
           and not coalesce((r->>'duplicate')::boolean, false) then
          closed := closed + 1;
        end if;
      exception when others then
        failed := failed + 1;
        reasons := reasons || (u.user_id::text || ' close: ' || sqlerrm);
      end;
    end loop;
  end loop;

  return jsonb_build_object('closed', closed, 'failed', failed,
                            'seasons', to_jsonb(seasons), 'reasons', to_jsonb(reasons));
end;
$function$;

-- 4. Обгортка з журналом — та сама форма, що в elo_cron_log_eval_week:
--    результат лягає в cron_log, а помилки піднімаються винятком, щоб
--    невдалий прогін було видно в cron.job_run_details, а не лише в тиші.
create or replace function public.elo_cron_log_close_seasons()
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb;
begin
  r := public.elo_cron_close_seasons();
  insert into public.cron_log (job, result) values ('elo_cron_close_seasons', r);
  if coalesce((r->>'failed')::int, 0) > 0 then
    raise exception 'elo_cron_close_seasons: % помилок — %', r->>'failed', r->>'reasons';
  end if;
end $function$;

-- 5. Права. Клієнт кличе лише elo_close_season; решта — серверна.
revoke execute on function public.elo_close_season_for(uuid, text) from public, anon, authenticated;
revoke execute on function public.elo_cron_close_seasons() from public, anon, authenticated;
revoke execute on function public.elo_cron_log_close_seasons() from public, anon, authenticated;
grant execute on function public.elo_close_season(text) to authenticated;
