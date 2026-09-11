-- =============================================================================
--  Get Stronger — схема бази для Supabase
--  Виконати один раз: Supabase → SQL Editor → вставити цей файл → Run
-- =============================================================================
--
--  Модель даних навмисно мінімальна: одна таблиця, один рядок на користувача,
--  профіль лежить у jsonb. Причина — набір полів на фронтенді ще змінюватиметься,
--  і кожна зміна не має вимагати міграції.
--
--  Компроміс: jsonb не дає перевірки типів на рівні БД і погано індексується
--  під складні запити. Якщо колись знадобиться аналітика по полях
--  (наприклад «середня вага серед друзів») — винось ці поля в окремі колонки.
--
--  Безпека: RLS увімкнено, кожна політика звіряє auth.uid() з user_id.
--  Публічний anon-ключ у фронтенді сам по собі не дає доступу до чужих даних.
--
--  ВАЖЛИВО про те, чого RLS НЕ закриває: сесія користувача (разом із
--  refresh_token) лежить у localStorage браузера, бо статичний сайт не може
--  поставити httpOnly-cookie. RLS захищає дані від ЧУЖОГО браузера, але не
--  від XSS у власному. Див. коментар угорі js/store.js.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Таблиця профілів
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  public.profiles      is 'Профіль користувача: антропометрія, обрана програма, рекорди 1ПМ';
comment on column public.profiles.data is 'Довільний JSON з фронтенду. Схема описана в js/store.js → blankProfile()';

-- -----------------------------------------------------------------------------
-- Автооновлення updated_at
-- -----------------------------------------------------------------------------
-- security invoker, а не definer: функція лише проставляє new.updated_at,
-- привілеї власника їй не потрібні. Зайвий definer — це зайва поверхня атаки
-- на випадок, якщо колись у тіло функції додасться щось складніше.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- force: RLS має діяти й на власника таблиці. Без цього будь-який запит,
-- виконаний від імені власника (наприклад, із SQL Editor або з майбутньої
-- серверної функції), тихо обходить усі політики нижче.
alter table public.profiles force row level security;

-- Кожна політика окремо на дію: так видно, що саме дозволено, і легше звузити.
-- to authenticated — щоб політики не оцінювались для анонімних запитів:
-- дірки не було й раніше (auth.uid() = null не збігається ні з чим),
-- але кожен анонімний запит їх дарма проганяв.
-- ВАЖЛИВО. Умова is_approved(auth.uid()) — не прикраса, а барʼєр: до
-- підтвердження заявки акаунт не має доступу до profiles ЗОВСІМ. Цей файл
-- раніше створював політики без неї, і виконання документованої процедури
-- («встав уміст у SQL Editor → Run») тихо знімало барʼєр із продакшену.
-- Тепер файл збігається з фактичним станом бази — звірено з pg_policies.
--
-- (select auth.uid()) у дужках навмисно: так планувальник обчислює виклик
-- один раз на запит (InitPlan), а не на кожен рядок.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id and (select public.is_approved(auth.uid())));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id and (select public.is_approved(auth.uid())));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id and (select public.is_approved(auth.uid())))
  with check ((select auth.uid()) = user_id and (select public.is_approved(auth.uid())));

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using ((select auth.uid()) = user_id and (select public.is_approved(auth.uid())));

-- -----------------------------------------------------------------------------
-- Права для ролей PostgREST
-- -----------------------------------------------------------------------------
-- anon (неавторизований) не отримує нічого: до логіну працює локальний режим.
-- revoke — явно, а не «за замовчуванням»: Supabase міг видати права anon
-- через grant на схему, і мовчазна опора на це — не те, на що варто спиратись.
revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Перевірка після виконання
-- -----------------------------------------------------------------------------
--   select tablename, rowsecurity from pg_tables where tablename = 'profiles';
--   -- rowsecurity має бути true
--
--   select policyname, cmd, roles from pg_policies where tablename = 'profiles';
--   -- має бути 4 політики: select / insert / update / delete, усі для {authenticated}
--
--   select relforcerowsecurity from pg_class where relname = 'profiles';
--   -- має бути true
-- =============================================================================
