-- =============================================================================
-- ВІДКАТ db/cron-keep-work.sql
-- =============================================================================
-- Повертає raise exception в обидві обгортки й прибирає admin_cron_health.
--
-- УВАГА: разом із винятком повертається і його ціна — провал одного
-- користувача знову відкочує оцінені тижні решти і сам рядок cron_log.
-- Відкочувати варто лише якщо щось піде не так із самою admin_cron_health.
-- =============================================================================

create or replace function public.elo_cron_log_eval_week(p_weeks_back integer default 4)
returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.elo_cron_eval_week(p_weeks_back);
  insert into public.cron_log (job, result) values ('elo_cron_eval_week', r);
  if coalesce((r->>'failed')::int, 0) > 0 then
    raise exception 'elo_cron_eval_week: % помилок — %', r->>'failed', r->>'reasons';
  end if;
end $$;

create or replace function public.elo_cron_log_close_seasons()
returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.elo_cron_close_seasons();
  insert into public.cron_log (job, result) values ('elo_cron_close_seasons', r);
  if coalesce((r->>'failed')::int, 0) > 0 then
    raise exception 'elo_cron_close_seasons: % помилок — %', r->>'failed', r->>'reasons';
  end if;
end $$;

drop function if exists public.admin_cron_health();
