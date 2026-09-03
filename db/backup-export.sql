-- =============================================================================
-- ЕКСПОРТ ДЛЯ РЕЗЕРВНОЇ КОПІЇ
-- =============================================================================
-- Free-план Supabase не робить автоматичних бекапів узагалі (щоденні —
-- лише з Pro). Тобто без цього єдина копія даних усіх користувачів —
-- сам production. Цей запит віддає всю базу одним JSON; заплановане
-- завдання «Forge: щотижнева резервна копія» запускає його раз на тиждень
-- і кладе файл у ~/Desktop/forge-backups на компʼютері.
--
-- ЩО НЕ ЕКСПОРТУЄТЬСЯ І ЧОМУ:
--   · encrypted_password — хеші паролів. Класти їх у файл на робочому
--     столі — гірше, ніж не мати бекапа паролів. При відновленні люди
--     проходять «Забули пароль?».
--   · службові таблиці auth.* (сесії, токени) — відновлювати їх не треба
--     й не можна.
--
-- Читається лише через service_role (SQL Editor або MCP): у RLS-політиках
-- звичайний користувач бачить лише свої рядки, тож із фронтенду цей
-- запит не працює і працювати не повинен.
-- =============================================================================

select jsonb_build_object(
  'exported_at',    now(),
  'project',        current_database(),
  'format_version', 1,

  -- Ідентичність користувачів: без цього решта таблиць — набір
  -- невідомо чиїх uuid.
  'users', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'email', email,
      'created_at', created_at,
      'email_confirmed_at', email_confirmed_at,
      'last_sign_in_at', last_sign_in_at) order by created_at), '[]'::jsonb)
    from auth.users),

  'account_status', (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb) from public.account_status t),
  'profiles',       (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb) from public.profiles t),
  'elo_events',     (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)      from public.elo_events t),
  'season_state',   (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb) from public.season_state t),
  'season_history', (select coalesce(jsonb_agg(to_jsonb(t) order by t.user_id), '[]'::jsonb) from public.season_history t),
  'awards',         (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.awards t),
  'consent_log',    (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.consent_log t),
  'elo_week_plan',  (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.elo_week_plan t),
  'elo_config',     (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.elo_config t),
  'admins',         (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)                    from public.admins t),

  -- Лічильники окремо: щоб зіпсований або обрізаний файл було видно
  -- одразу, не розбираючи весь JSON.
  'counts', jsonb_build_object(
    'users',          (select count(*) from auth.users),
    'account_status', (select count(*) from public.account_status),
    'profiles',       (select count(*) from public.profiles),
    'elo_events',     (select count(*) from public.elo_events),
    'season_state',   (select count(*) from public.season_state),
    'season_history', (select count(*) from public.season_history))
) as backup;
