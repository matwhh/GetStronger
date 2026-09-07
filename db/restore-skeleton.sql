-- =============================================================================
-- СКЕЛЕТ ДЛЯ ВІДНОВЛЕННЯ З РЕЗЕРВНОЇ КОПІЇ
-- =============================================================================
-- Це НЕ схема продакшену (вона в db/schema.sql + міграції) і не заміна їй.
-- Це мінімальна структура, у яку можна залити forge-backup-*.json і довести,
-- що файл справді відновлюється: ті самі імена таблиць і колонок, ті самі
-- первинні ключі, зовнішні ключі та унікальні обмеження, ті самі
-- послідовності. RLS, політик, тригерів і функцій тут навмисно немає —
-- вони перевіряються іншими тестами, а тут заважали б: RLS ховає рядки
-- саме тоді, коли треба їх порахувати.
--
-- Використання: tools/verify-backup-roundtrip.mjs розгортає цей файл у
-- тимчасовому локальному Postgres, заливає бекап через tools/restore-backup.mjs
-- і звіряє кількості та вміст.
--
-- ЩО ЦЕ ДОВОДИТЬ: у файлі лежать усі рядки, вони проходять PK/FK/NOT NULL,
-- сироти неможливі, послідовності відновлюються.
-- ЧОГО ЦЕ НЕ ДОВОДИТЬ: що GoTrue пустить відновленого користувача в акаунт.
-- Це перевіряється лише на справжньому Supabase (branch або новий проєкт) —
-- див. db/RESTORE.md, розділ «Чого драйв не покриває».
--
-- ДРЕЙФ. Якщо в продакшені зʼявиться нова колонка, експорт (to_jsonb) забере
-- її автоматично, а тут її не буде — і verify-backup-roundtrip.mjs впаде з
-- «у файлі є колонки, яких немає в скелеті». Це не поломка тесту, це
-- нагадування оновити цей файл.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- auth: рівно те, на що посилаються таблиці public
-- -----------------------------------------------------------------------------
create schema if not exists auth;

create table auth.users (
  instance_id                 uuid,
  id                          uuid primary key,
  aud                         varchar,
  role                        varchar,
  email                       varchar,
  encrypted_password          varchar,
  email_confirmed_at          timestamptz,
  invited_at                  timestamptz,
  confirmation_token          varchar,
  confirmation_sent_at        timestamptz,
  recovery_token              varchar,
  recovery_sent_at            timestamptz,
  email_change_token_new      varchar,
  email_change                varchar,
  email_change_sent_at        timestamptz,
  last_sign_in_at             timestamptz,
  raw_app_meta_data           jsonb,
  raw_user_meta_data          jsonb,
  is_super_admin              boolean,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  phone                       text default null,
  phone_confirmed_at          timestamptz,
  phone_change                text default '',
  phone_change_token          varchar default '',
  phone_change_sent_at        timestamptz,
  -- generated, як у продакшені: у бекапі його немає й бути не повинно
  confirmed_at                timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current  varchar default '',
  email_change_confirm_status smallint default 0,
  banned_until                timestamptz,
  reauthentication_token      varchar default '',
  reauthentication_sent_at    timestamptz,
  is_sso_user                 boolean not null default false,
  deleted_at                  timestamptz,
  is_anonymous                boolean not null default false
);

create table auth.identities (
  provider_id     text        not null,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  identity_data   jsonb       not null,
  provider        text        not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  -- generated, як у продакшені
  email           text generated always as (lower(identity_data ->> 'email')) stored,
  id              uuid        not null default gen_random_uuid(),
  primary key (id),
  unique (provider_id, provider)
);

-- -----------------------------------------------------------------------------
-- public
-- -----------------------------------------------------------------------------
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_status (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  status       text        not null default 'pending',
  username     text,
  birth_date   date,
  screening    jsonb       not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid,
  note         text
);

create table public.admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create sequence public.elo_events_id_seq as bigint;
create table public.elo_events (
  id         bigint      not null default nextval('public.elo_events_id_seq') primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  season     text        not null,
  day        date        not null,
  category   text        not null,
  action_key text        not null,
  quality    numeric     not null default 0,
  delta      integer     not null,
  elo_after  integer     not null,
  reason     text        not null,
  created_at timestamptz not null default now(),
  event_type text        not null,
  unique (user_id, action_key)
);
alter sequence public.elo_events_id_seq owned by public.elo_events.id;

create table public.season_state (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  season       text        not null,
  elo          integer     not null default 0,
  today_delta  integer     not null default 0,
  today_date   date,
  grace_used   integer     not null default 0,
  grace_until  date,
  display_name text,
  updated_at   timestamptz not null default now(),
  primary key (user_id, season)
);

create table public.season_history (
  user_id           uuid        not null references auth.users (id) on delete cascade,
  season            text        not null,
  final_elo         integer     not null,
  level             integer     not null,
  elite             boolean     not null default false,
  rank              integer,
  of_users          integer,
  percentile        numeric,
  days_active       integer,
  days_total        integer,
  grace_weeks_used  integer     not null default 0,
  stats             jsonb       not null default '{}'::jsonb,
  closed_at         timestamptz not null default now(),
  primary key (user_id, season)
);

create table public.awards (
  user_id   uuid        not null references auth.users (id) on delete cascade,
  season    text        not null,
  kind      text        not null,
  label     text        not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, season, kind)
);

create sequence public.consent_log_id_seq as bigint;
create table public.consent_log (
  id          bigint      not null default nextval('public.consent_log_id_seq') primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  document    text        not null,
  version     text        not null,
  accepted_at timestamptz not null default now()
);
alter sequence public.consent_log_id_seq owned by public.consent_log.id;

create table public.elo_week_plan (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  week_start date        not null,
  planned    integer     not null,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create table public.elo_config (
  id         integer     not null default 1 primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);
