-- =============================================================================
-- ЕКСПОРТ ДЛЯ РЕЗЕРВНОЇ КОПІЇ  (format_version 2)
-- =============================================================================
-- Free-план Supabase не робить автоматичних бекапів узагалі (щоденні —
-- лише з Pro). Тобто без цього єдина копія даних усіх користувачів —
-- сам production. Цей запит віддає всю базу одним JSON.
--
-- ВІДНОВЛЕННЯ: tools/restore-backup.mjs (JSON → SQL) + db/restore-skeleton.sql.
-- Перевірка файла і повний прогін відновлення: tools/verify-backup-roundtrip.mjs.
-- Бекап, з якого не відновились, не рахується бекапом — тому обидва скрипти
-- лежать поруч із цим файлом і ганяються в CI.
--
-- ЩО ЗМІНИЛОСЬ У ВЕРСІЇ 2 (2026-09-07):
--   · auth.users віддається повністю (крім секретів і generated-колонок), а не
--     пʼятьма полями. У версії 1 відновлений рядок auth.users не годився для
--     входу: GoTrue шукає користувача за aud/role/instance_id і провайдера за
--     raw_app_meta_data.provider — усього цього у файлі не було.
--   · Додано auth.identities. Без identity-рядка «Забули пароль?» не спрацює:
--     email-провайдера для користувача просто не існує.
--   · Додано стан послідовностей (sequences). Без нього після відновлення
--     перший же insert в elo_events впаде на дублікаті id.
--   · counts тепер покриває всі 12 масивів, а не 6.
--
-- ЩО НЕ ЕКСПОРТУЄТЬСЯ І ЧОМУ:
--   · encrypted_password і всі *_token (confirmation, recovery, email_change,
--     phone_change, reauthentication) — секрети. Класти їх у файл на робочому
--     столі гірше, ніж не мати бекапа паролів. Після відновлення людина
--     проходить «Забули пароль?» — саме тому identities вище обовʼязкові.
--   · auth.sessions / refresh_tokens / mfa_* — після відновлення всі сесії
--     все одно недійсні; відновлювати їх не треба й не можна.
--   · confirmed_at і identities.email — GENERATED ALWAYS, база рахує їх сама.
--
-- Читається лише через service_role (SQL Editor або MCP): у RLS-політиках
-- звичайний користувач бачить лише свої рядки, тож із фронтенду цей
-- запит не працює і працювати не повинен.
-- =============================================================================

select jsonb_build_object(
  'exported_at',    now(),
  'project',        current_database(),
  'format_version', 2,

  -- Ідентичність користувачів: без цього решта таблиць — набір
  -- невідомо чиїх uuid. Перелік колонок явний, а не to_jsonb(t): у auth.users
  -- лежать секрети, і «взяти все» тут — це витік, а не зручність.
  'users', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'instance_id',                instance_id,
      'id',                         id,
      'aud',                        aud,
      'role',                       role,
      'email',                      email,
      'email_confirmed_at',         email_confirmed_at,
      'invited_at',                 invited_at,
      'confirmation_sent_at',       confirmation_sent_at,
      'recovery_sent_at',           recovery_sent_at,
      'email_change',               email_change,
      'email_change_sent_at',       email_change_sent_at,
      'email_change_confirm_status',email_change_confirm_status,
      'last_sign_in_at',            last_sign_in_at,
      'raw_app_meta_data',          raw_app_meta_data,
      'raw_user_meta_data',         raw_user_meta_data,
      'is_super_admin',             is_super_admin,
      'created_at',                 created_at,
      'updated_at',                 updated_at,
      'phone',                      phone,
      'phone_confirmed_at',         phone_confirmed_at,
      'phone_change_sent_at',       phone_change_sent_at,
      'banned_until',               banned_until,
      'reauthentication_sent_at',   reauthentication_sent_at,
      'is_sso_user',                is_sso_user,
      'deleted_at',                 deleted_at,
      'is_anonymous',               is_anonymous) order by created_at), '[]'::jsonb)
    from auth.users),

  -- identity_data містить sub і email — те саме, що вже є в users вище.
  -- Секретів у ньому немає.
  'identities', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',              id,
      'user_id',         user_id,
      'provider_id',     provider_id,
      'provider',        provider,
      'identity_data',   identity_data,
      'last_sign_in_at', last_sign_in_at,
      'created_at',      created_at,
      'updated_at',      updated_at) order by created_at), '[]'::jsonb)
    from auth.identities),

  'account_status', (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb) from public.account_status t),
  'profiles',       (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb) from public.profiles t),
  'elo_events',     (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)      from public.elo_events t),
  'season_state',   (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb) from public.season_state t),
  'season_history', (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb) from public.season_history t),
  'awards',         (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.awards t),
  'consent_log',    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)      from public.consent_log t),
  'elo_week_plan',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.elo_week_plan t),
  'elo_config',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.elo_config t),
  'admins',         (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.admins t),

  -- Стан послідовностей. jsonb_object_agg, а не перелік: якщо зʼявиться нова
  -- таблиця з bigserial, вона потрапить у бекап автоматично.
  'sequences', (
    select coalesce(jsonb_object_agg(sequencename, last_value), '{}'::jsonb)
    from pg_sequences where schemaname = 'public'),

  -- Лічильники окремо: щоб зіпсований або обрізаний файл було видно
  -- одразу, не розбираючи весь JSON. verify-backup-roundtrip.mjs звіряє
  -- кожен із них із фактичною довжиною масиву.
  'counts', jsonb_build_object(
    'users',          (select count(*) from auth.users),
    'identities',     (select count(*) from auth.identities),
    'account_status', (select count(*) from public.account_status),
    'profiles',       (select count(*) from public.profiles),
    'elo_events',     (select count(*) from public.elo_events),
    'season_state',   (select count(*) from public.season_state),
    'season_history', (select count(*) from public.season_history),
    'awards',         (select count(*) from public.awards),
    'consent_log',    (select count(*) from public.consent_log),
    'elo_week_plan',  (select count(*) from public.elo_week_plan),
    'elo_config',     (select count(*) from public.elo_config),
    'admins',         (select count(*) from public.admins))
) as backup;
