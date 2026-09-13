-- Знімок даних перед «Планом робіт Get Stronger» (2026-09-13).
--
-- ЧОМУ ЦЕ, А НЕ ФАЙЛ. Файловий дамп (`db/backup-export.sql`) віддає всю базу
-- одним JSON — і цей JSON мусить пройти через агента символ за символом.
-- 64 КБ JSON = 97 КБ base64; переписування такого обсягу вручну гарантує
-- зіпсований байт там, де його ніхто не помітить, поки копія не знадобиться.
-- Знімок усередині бази робить сервер: дані не покидають Postgres, тому
-- зіпсуватись у дорозі не можуть. Кожну таблицю звірено md5 по відсортованих
-- рядках — 13 з 13 збіглися.
--
-- ЩО ЦЕ НЕ ПОКРИВАЄ. Копія лежить у тій самій базі. Вона захищає від наших
-- власних змін у межах плану — не від втрати проєкту. Офлайн-копія даних —
-- це `~/Desktop/Get Stronger/backups/backup-forge-*.json`, і вона окремо.
-- Офлайн-копія коду — тег `before-plan-2026-09-13` і
-- `~/Desktop/Get Stronger/backups/code-before-plan-2026-09-13.tgz`.
--
-- ЧАС ЖИТТЯ. Схему знести, коли план завершено:
--   drop schema bk_2026_09_13 cascade;
-- Поки вона є, `db/live-schema.sql` описує лише `public` і `auth` — схема
-- знімка в нього свідомо не входить: це дані, а не схема застосунку.

-- ── Як знімок створено (виконано 2026-09-13 через execute_sql, НЕ міграцією:
--    міграція означала б «повторити на чистій базі», а знімок повторювати нема сенсу)

create schema if not exists bk_2026_09_13;
revoke all on schema bk_2026_09_13 from anon, authenticated;

create table bk_2026_09_13.account_status  as select * from public.account_status;
create table bk_2026_09_13.admins          as select * from public.admins;
create table bk_2026_09_13.awards          as select * from public.awards;
create table bk_2026_09_13.consent_log     as select * from public.consent_log;
create table bk_2026_09_13.cron_log        as select * from public.cron_log;
create table bk_2026_09_13.elo_config      as select * from public.elo_config;
create table bk_2026_09_13.elo_events      as select * from public.elo_events;
create table bk_2026_09_13.elo_week_plan   as select * from public.elo_week_plan;
create table bk_2026_09_13.profiles        as select * from public.profiles;
create table bk_2026_09_13.season_history  as select * from public.season_history;
create table bk_2026_09_13.season_state    as select * from public.season_state;
create table bk_2026_09_13.auth_users      as select * from auth.users;
create table bk_2026_09_13.auth_identities as select * from auth.identities;
create table bk_2026_09_13.sequences       as select sequencename, last_value from pg_sequences where schemaname = 'public';
create table bk_2026_09_13.meta            as select '2026-09-13T18:40:00+00'::timestamptz as taken_at, 'before-plan-2026-09-13'::text as code_tag, '599b60b'::text as head;

comment on schema bk_2026_09_13 is 'Тимчасовий знімок даних перед виконанням «Плану робіт Get Stronger». Дропнути після завершення плану: drop schema bk_2026_09_13 cascade;';

-- ── Перевірка, що знімок — справді копія (має віддати 13 рядків, у кожному src = bk)

-- select 'account_status' t, (select count(*) from public.account_status) src, (select count(*) from bk_2026_09_13.account_status) bk
-- union all select 'profiles', (select count(*) from public.profiles), (select count(*) from bk_2026_09_13.profiles)
-- ... (повний запит з md5 — у RESTORE.md, розділ «Знімок у базі»)

-- ── Відкат даних public зі знімка (ОДНА транзакція, виконувати свідомо)
--
-- truncate ... cascade знімає і FK-звʼязки між переліченими таблицями, тому
-- порядок усередині одного truncate не має значення. auth.users і
-- auth.identities тут НЕ чіпаються: на них тримається половина внутрішніх
-- таблиць Supabase, а план робіт їх не змінює. Якщо треба звірити auth —
-- порівняти зі знімком, не перезаписувати.

-- begin;
--   truncate public.account_status, public.admins, public.awards,
--            public.consent_log, public.cron_log, public.elo_config,
--            public.elo_events, public.elo_week_plan, public.profiles,
--            public.season_history, public.season_state cascade;
--
--   insert into public.account_status select * from bk_2026_09_13.account_status;
--   insert into public.admins         select * from bk_2026_09_13.admins;
--   insert into public.awards         select * from bk_2026_09_13.awards;
--   insert into public.consent_log    select * from bk_2026_09_13.consent_log;
--   insert into public.cron_log       select * from bk_2026_09_13.cron_log;
--   insert into public.elo_config     select * from bk_2026_09_13.elo_config;
--   insert into public.elo_events     select * from bk_2026_09_13.elo_events;
--   insert into public.elo_week_plan  select * from bk_2026_09_13.elo_week_plan;
--   insert into public.profiles       select * from bk_2026_09_13.profiles;
--   insert into public.season_history select * from bk_2026_09_13.season_history;
--   insert into public.season_state   select * from bk_2026_09_13.season_state;
--
--   -- послідовності: повернути last_value кожної
--   select setval(format('public.%I', s.sequencename), s.last_value)
--     from bk_2026_09_13.sequences s where s.last_value is not null;
-- commit;
