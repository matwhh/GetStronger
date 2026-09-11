-- =============================================================================
-- ADMIN ELO ANOMALIES — сигнали self-report-зловживань для адмінки
-- =============================================================================
-- Міграція: admin_elo_anomalies
--
-- Рейтинг Get Stronger — MODEL 1 (self-reported adherence): сервер не може довести,
-- що тренування було. Протокол після db/elo-integrity.sql захищений, але
-- вигаданий «ідеальний» профіль дає стільки ж, скільки ідеальний чесний
-- гравець. Цей RPC не карає — він показує адміну, на кого подивитись:
--
--   perfectDays    днів сезону, коли ВСІ 5 категорій мали quality ≥ 0.99
--   perfectStreak  найдовша серія таких днів поспіль
--   activeDays     днів із хоча б однією позитивною подією
--   capWeeks       тижнів, коли позитивна сума впирається у weeklyBudget
--   backdated      подій, поданих через ≥ 2 дні після дня факту
--   flags          текстові прапорці за порогами нижче
--
-- Пороги — евристика, не вирок: perfect_streak ≥ 14 днів; all_perfect —
-- ≥ 90 % активних днів ідеальні при ≥ 14 активних; cap_weeks ≥ 3;
-- backdated ≥ 50 % подій при ≥ 10 подіях.
-- =============================================================================

create or replace function public.admin_elo_anomalies(p_season text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  szn text := coalesce(p_season, season_of(current_date));
  budget int := (select (data->>'weeklyBudget')::int from elo_config where id = 1);
  out jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;

  with ev as (
    select user_id, day, category, quality, delta, created_at
    from elo_events
    where season = szn and category in ('training','nutrition','sleep','recovery','activity')
  ),
  days as (
    select user_id, day,
           count(*) filter (where quality >= 0.99) = 5 as perfect,
           bool_or(delta > 0) as active
    from ev group by user_id, day
  ),
  streaks as (
    -- сусідні ідеальні дні: day - row_number по ідеальних днях дає сталу групу
    select user_id, count(*) as len
    from (
      select user_id, day, day - (row_number() over (partition by user_id order by day))::int as grp
      from days where perfect
    ) g group by user_id, grp
  ),
  weeks as (
    select user_id, date_trunc('week', day)::date as wk, sum(delta) filter (where delta > 0) as pos
    from ev group by user_id, date_trunc('week', day)
  ),
  agg as (
    select d.user_id,
           count(*) filter (where d.perfect) as perfect_days,
           count(*) filter (where d.active)  as active_days,
           coalesce((select max(len) from streaks s where s.user_id = d.user_id), 0) as perfect_streak,
           (select count(*) from weeks w where w.user_id = d.user_id and w.pos >= budget) as cap_weeks,
           (select count(*) from ev e where e.user_id = d.user_id and (e.created_at::date - e.day) >= 2) as backdated,
           (select count(*) from ev e where e.user_id = d.user_id) as events
    from days d group by d.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', a.user_id,
      'perfectDays', a.perfect_days,
      'perfectStreak', a.perfect_streak,
      'activeDays', a.active_days,
      'capWeeks', a.cap_weeks,
      'backdated', a.backdated,
      'events', a.events,
      'flags', (
        select coalesce(jsonb_agg(f), '[]'::jsonb) from (
          select 'perfect_streak' f where a.perfect_streak >= 14
          union all select 'all_perfect' where a.active_days >= 14 and a.perfect_days::numeric / a.active_days >= 0.9
          union all select 'cap_weeks' where a.cap_weeks >= 3
          union all select 'backdated' where a.events >= 10 and a.backdated::numeric / a.events >= 0.5
        ) fl)
    ) order by a.perfect_streak desc, a.cap_weeks desc), '[]'::jsonb)
  into out from agg a;

  return jsonb_build_object('season', szn, 'rows', out);
end;
$$;

revoke execute on function public.admin_elo_anomalies(text) from public, anon;
grant execute on function public.admin_elo_anomalies(text) to authenticated;
