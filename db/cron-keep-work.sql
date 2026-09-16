-- =============================================================================
-- КРОН БІЛЬШЕ НЕ ВІДКОЧУЄ ЗРОБЛЕНЕ  (аудит 2026-09-16)
-- =============================================================================
-- Міграції: cron_wrappers_keep_work, admin_cron_health
--
-- ЩО БУЛО НЕ ТАК. Обгортки elo_cron_log_eval_week і elo_cron_log_close_seasons
-- написані однаково:
--
--     r := public.elo_cron_...();          -- корисна робота
--     insert into public.cron_log ...;     -- журнал
--     if (r->>'failed')::int > 0 then raise exception ...
--
-- pg_cron виконує завдання ОДНІЄЮ транзакцією. Виняток у кінці відкочує не
-- тільки свою скаргу, а й усе, що було до нього:
--
--   1. усі успішно оцінені тижні / закриті сезони цього прогону — якщо з
--      пʼятдесяти користувачів упав один, решта 49 лишаються неоціненими;
--   2. САМ рядок cron_log, заради якого обгортку й писали.
--
-- Тобто внутрішній `exception when others`, який старанно ізолює кожного
-- користувача окремо (elo_cron_eval_week, elo_cron_close_seasons), зовнішній
-- raise знецінював повністю. А в cron.job_run_details лишалось
-- status = 'failed' без жодної причини — причина щойно відкотилась разом
-- із журналом.
--
-- Поки що не вкусило: користувач один, падінь не було (cron.job_run_details
-- на 16.09.2026 — самі 'succeeded'). Пастка спрацювала б рівно тоді, коли
-- людей стане більше, тобто коли ціна найвища.
--
-- ЯК ТЕПЕР. Обгортка пише журнал і, якщо були помилки, кидає raise warning:
-- воно їде в лог Postgres, нічого не відкочує, і рядок cron_log лишається
-- на місці разом з усією зробленою роботою.
--
-- ЧИМ ЗАМІНЕНО СИГНАЛ. Виняток був єдиним будильником: cron_log ніхто не
-- читає, бо читати його можна лише руками в SQL Editor. Тому тут же
-- зʼявляється admin_cron_health() — RPC для адмінки, який каже по кожному
-- запланованому завданню: коли був останній прогін, скільки помилок і чи
-- не застряг розклад. Її показує сторінка admin.html, вкладка «Розклад».
-- =============================================================================

-- 1. Обгортка тижневої оцінки.
create or replace function public.elo_cron_log_eval_week(p_weeks_back integer default 4)
returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.elo_cron_eval_week(p_weeks_back);
  insert into public.cron_log (job, result) values ('elo_cron_eval_week', r);
  /* warning, а не exception: виняток відкотив би і оцінені тижні, і цей
     самий рядок журналу. Провал видно в admin_cron_health(). */
  if coalesce((r->>'failed')::int, 0) > 0 then
    raise warning 'elo_cron_eval_week: % помилок — %', r->>'failed', r->>'reasons';
  end if;
end $$;

revoke all on function public.elo_cron_log_eval_week(integer) from public, anon, authenticated;
grant execute on function public.elo_cron_log_eval_week(integer) to service_role;

-- 2. Обгортка закриття сезонів — та сама правка.
create or replace function public.elo_cron_log_close_seasons()
returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.elo_cron_close_seasons();
  insert into public.cron_log (job, result) values ('elo_cron_close_seasons', r);
  if coalesce((r->>'failed')::int, 0) > 0 then
    raise warning 'elo_cron_close_seasons: % помилок — %', r->>'failed', r->>'reasons';
  end if;
end $$;

revoke all on function public.elo_cron_log_close_seasons() from public, anon, authenticated;
grant execute on function public.elo_cron_log_close_seasons() to service_role;

-- 3. Будильник замість винятку.
--
-- Три завдання, які має виконувати розклад, перелічені ТУТ, а не читаються
-- з cron.job: якщо завдання зникло з розкладу зовсім, читання з cron.job
-- не показало б нічого — саме та тиша, від якої ця функція й лікує.
create or replace function public.admin_cron_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  expected text[] := array['elo_cron_eval_week',
                           'elo_cron_close_seasons',
                           'purge_abandoned_signups'];
  out jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;

  select coalesce(jsonb_agg(x order by x->>'job'), '[]'::jsonb) into out from (
    select jsonb_build_object(
             'job',     j.job,
             'lastRun', l.run_at,
             'failed',  coalesce((l.result->>'failed')::int, 0),
             'result',  l.result,
             'state',
               case
                 when l.run_at is null then 'never'
                 when coalesce((l.result->>'failed')::int, 0) > 0 then 'failed'
                 /* Дві доби, а не одна: всі три завдання добові, і прогін,
                    що спізнився на годину, не привід світити червоним. */
                 when l.run_at < now() - interval '48 hours' then 'stale'
                 else 'ok'
               end) x
    from unnest(expected) j(job)
    left join lateral (
      select run_at, result from public.cron_log c
      where c.job = j.job order by c.run_at desc limit 1
    ) l on true
  ) g;

  return jsonb_build_object('ok', true, 'jobs', out, 'now', now());
end $$;

revoke all on function public.admin_cron_health() from public, anon;
grant execute on function public.admin_cron_health() to authenticated;
