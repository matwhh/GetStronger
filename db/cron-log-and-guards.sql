-- =============================================================================
-- ЖУРНАЛ ЗАПЛАНОВАНИХ ЗАВДАНЬ І ДВА БАРʼЄРИ  (аудит 2026-09)
-- =============================================================================
-- Міграції: cron_log_and_blocked_delete_guard, cron_use_logged_wrapper,
--           elo_ledger_matches_state, elo_delta_equals_actual_change,
--           elo_submit_delta_equals_actual_change
--
-- DB-002. elo_cron_eval_week ловить помилку кожного користувача окремо і
-- повертає підсумок jsonb {'ok': false, 'failed': N, 'reasons': [...]}. Але
-- pg_cron пише в job_run_details лише return_message = '1 row' і
-- status = 'succeeded' — уміст jsonb не зберігався НІДЕ. Тобто провал
-- усередині функції виглядав як успішний прогін, а коментар у db/cron.sql
-- («return_message = наш jsonb») був неправдою.
--
-- Тепер розклад кличе обгортку elo_cron_log_eval_week: вона пише результат
-- у public.cron_log і кидає виняток, якщо були помилки, — тоді pg_cron
-- нарешті показує failed. Таблиця під RLS без жодної політики й без
-- грантів клієнту: це службовий журнал, а не дані користувача.
--
--   select run_at, result from public.cron_log
--   where job = 'elo_cron_eval_week' order by run_at desc limit 10;
--
-- DB-003. delete_account() перевіряв лише автентифікацію й «останній
-- адмін». Заблокований акаунт міг видалити себе — каскад зносив рядок
-- account_status зі status='blocked', та сама пошта реєструвалась знову як
-- «чистий» pending, а заблокований нік звільнявся. При цьому
-- register_request блокованого відхиляє: правило вже існувало, обхід був
-- поруч. Перевірено на бойовій базі в BEGIN…ROLLBACK: блокованого не
-- пустило, всі троє користувачів на місці.
--
-- DB-006. Стан зрізався межами (0 і seasonMax), а в elo_events писалась
-- ПОВНА дельта: при 2495 ELO нарахування +9 давало стан 2500, а в журналі
-- лишалось +9 — sum(delta) переставала дорівнювати season_state.elo
-- назавжди. Компенсаційний відкат «elo - d» теж не повертав початкове
-- значення: 2495 → 2500 → відкат 2491, мінус 4 з нічого.
--
-- Виправлено найпростішим способом: дельта зрізається ДО оновлення стану.
-- Тоді оновлення нічого не зрізає, у журнал іде те саме число, що додалось
-- до стану, а відкат стає точним за побудовою. Плюс два обмеження на
-- таблицю: quality у [0,1], elo_after у [0,2500]. Перевірено на бойовій
-- базі в BEGIN…ROLLBACK: 2495 → 2500, у журналі delta = 5.
-- =============================================================================

create table if not exists public.cron_log (
  id      bigint generated always as identity primary key,
  run_at  timestamptz not null default now(),
  job     text        not null,
  result  jsonb       not null
);

create index if not exists cron_log_job_time on public.cron_log (job, run_at desc);

alter table public.cron_log enable row level security;
alter table public.cron_log force row level security;
revoke all on public.cron_log from anon, authenticated;
grant select, insert on public.cron_log to service_role;

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

revoke all on function public.elo_cron_log_eval_week(integer) from public;
grant execute on function public.elo_cron_log_eval_week(integer) to service_role;

-- Розклад: 00:10 UTC щодня, як і було; змінилась лише команда.
--   select cron.alter_job(1, command => 'select public.elo_cron_log_eval_week()');

-- Барʼєр DB-003 у delete_account і зміни DB-006 в elo_submit /
-- elo_eval_week_for дивись у db/live-schema.sql: там їхній фактичний
-- текст. Дублювати повні тіла тут означало б завести ще одну копію, яка
-- розʼїдеться з базою — саме те, від чого лікує db/README.md.

alter table public.elo_events
  add constraint elo_events_quality_range check (quality >= 0 and quality <= 1) not valid;
alter table public.elo_events validate constraint elo_events_quality_range;

alter table public.elo_events
  add constraint elo_events_elo_after_range check (elo_after >= 0 and elo_after <= 2500) not valid;
alter table public.elo_events validate constraint elo_events_elo_after_range;
