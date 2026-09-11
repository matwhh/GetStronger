-- ============================================================
-- Get Stronger: заявки на акаунт, ручне підтвердження, адміни.
-- Застосовано до продакшн-БД міграціями account_approval,
-- elo_approved_guard, elo_approved_guard2 (28.08.2026).
-- Цей файл — копія для репозиторію.
--
-- Барʼєр справжній, серверний:
--   * public.account_status — статус кожного акаунта
--     (pending | approved | rejected | blocked); пишеться лише
--     SECURITY DEFINER RPC-функціями, клієнтських політик запису немає.
--   * public.admins — хто адмін; вирішує база, не фронтенд.
--   * RLS на profiles / elo_* вимагає is_approved(auth.uid()):
--     pending/rejected/blocked не читає й не пише приватні дані,
--     хоч би як підробляв localStorage чи викликав API напряму.
--   * register_request() перевіряє вік (17+, міграція age_limit_17) НА СЕРВЕРІ й
--     унікальність ніка; underage відсікається й прямим викликом.
--   * усі elo_* RPC мають guard NOT_APPROVED.
--   * consent_log — журнал згод (документ/версія/час); пише
--     register_request, обовʼязкові privacy_policy + terms_of_use +
--     medical_disclaimer (міграція consents_and_deletion).
--   * delete_account() — повне видалення акаунта користувачем
--     (delete from auth.users каскадом зносить усі дані).
-- ============================================================

create table if not exists public.account_status (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending','approved','rejected','blocked')),
  username     text,
  birth_date   date,
  screening    jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid,
  note         text
);

create unique index if not exists account_status_username_key
  on public.account_status (lower(username)) where username is not null;

alter table public.account_status enable row level security;
alter table public.account_status force row level security;
create policy account_status_select_own on public.account_status
  for select to authenticated using (auth.uid() = user_id);

create table if not exists public.admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
alter table public.admins force row level security;
create policy admins_select_self on public.admins
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.is_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.admins where user_id = uid) $$;

create or replace function public.is_approved(uid uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.account_status where user_id = uid and status = 'approved') $$;

-- Grandfather: наявні профілі лишаються approved.
insert into public.account_status (user_id, status, requested_at, decided_at)
select user_id, 'approved', now(), now() from public.profiles
on conflict (user_id) do nothing;

-- RLS: приватні дані лише для approved (profiles select/insert/update/
-- delete, elo_events / season_state / season_history / awards select) —
-- повні тексти політик див. у міграції account_approval.

-- RPC: username_free(text), register_request(text, date, jsonb),
-- account_state(), admin_requests(), admin_decide(uuid, text) —
-- повні тіла див. у міграції; всі security definer, execute лише
-- для authenticated.

-- ============================================================
-- ДОДАТОК: security hardening + performance (аудит 28.08.2026)
-- Міграції: security_lockdown_rpc_and_view,
--           perf_rls_initplan_indexes_pagination
--
-- CRITICAL (виправлено): elo_try_clean_day — SECURITY DEFINER,
--   доступна anon, приймала uid І cfg параметрами без перевірки
--   авторизації → будь-хто міг накрутити ELO будь-кому. EXECUTE
--   відкликано в anon і authenticated (це внутрішній помічник
--   elo_submit; SECURITY DEFINER-функції викликають його від owner).
--
-- HIGH (виправлено): view public.leaderboard був SECURITY DEFINER із
--   SELECT для anon → дамп ніків і ELO всіх користувачів без входу.
--   Тепер security_invoker = true, anon доступу не має.
--
-- WARN (виправлено): решту elo_* відкликано в anon; season_of,
--   elo_ladder, elo_band, elo_action_delta, touch_updated_at
--   отримали SET search_path.
--
-- PERFORMANCE: усі RLS-політики переписані на (select auth.uid()) —
--   auth-функція стає InitPlan і рахується раз на запит, а не на
--   кожен рядок (важливо для elo_events, що росте необмежено).
--   Індекси: season_state(season, elo desc) під elo_leaderboard,
--   account_status(status, requested_at desc) під адмінку.
--   admin_requests() отримав (p_status, p_limit, p_offset) —
--   раніше тягнув УСІ заявки з усім скринінгом одним запитом.
--
-- ЗАЛИШИЛОСЬ ВРУЧНУ: у Supabase Dashboard увімкнути
--   Authentication → Password protection (перевірка пароля за
--   HaveIBeenPwned). Через API це не вмикається.
-- ============================================================
