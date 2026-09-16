-- =============================================================================
-- ЩО МОЖНА ВИМКНУТИ В РЕЙТИНГУ — ВИРІШУЄ СЕРВЕР  (аудит 2026-09-16)
-- =============================================================================
-- Міграція: elo_skip_whitelist
--
-- ЩО БУЛО НЕ ТАК. Список вимкнених категорій живе в profiles.data->'eloSkip',
-- а цей рядок пише КЛІЄНТ: у нього є і grant update (data) на profiles, і
-- RPC profile_patch. elo_cfg_for перевіряла рівно одне — що це масив:
--
--     if jsonb_typeof(raw) is distinct from 'array' then return cfg; end if;
--     select array_agg(x) into skip from jsonb_array_elements_text(raw) x;
--
-- Далі elo_cfg_apply прибирає названі категорії з ваг і нормує решту до
-- одиниці. Тобто будь-хто, хто вміє надіслати PATCH зі своїм токеном, міг
-- лишити в грі ОДНУ категорію — і весь тижневий бюджет рейтингу поїхав би
-- у неї. Якщо це sleep або activity, де факт — це набране руками число,
-- сезон закривається набором цифр без жодного тренування.
--
-- Списків, до речі, було три й усі різні:
--   js/season.js       — пропонує вимкнути лише «Харчування»;
--   js/import-core.js  — при імпорті приймає чотири назви;
--   сервер             — приймав будь-що.
--
-- ЯК ТЕПЕР. Дозволений список лежить у конфізі рейтингу (elo_config.data
-- -> 'skippable'), тобто там само, де ваги й бюджети, — одне число правди
-- на сервер і клієнт. elo_cfg_for перетинає eloSkip із ним; усе, чого в
-- списку немає, мовчки ігнорується (як досі ігнорувалась вигадана назва).
--
-- Сьогодні в списку одна назва — nutrition: рівно те, що пропонує екран.
-- Додати сюди sleep означатиме свідоме рішення, а не побічний ефект того,
-- що поле пише клієнт.
-- =============================================================================

-- 1. Дозволений список у конфіг. Те саме значення лежить у
--    db/elo-config.json (ключ "skippable") — tools/ci-hygiene.mjs стежить,
--    щоб файл і js/season.js не розійшлися з цим рядком.
update public.elo_config
   set data = jsonb_set(data, '{skippable}', '["nutrition"]'::jsonb, true)
 where id = 1;

-- 2. Сервер більше не вірить клієнтському списку на слово.
create or replace function public.elo_cfg_for(uid uuid, cfg jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  raw jsonb;
  allowed jsonb;
  skip text[];
begin
  if cfg is null or cfg->'weights' is null then return cfg; end if;

  -- jsonb_typeof, а не просто coalesce: jsonb_array_elements_text кидає
  -- «cannot extract elements from a scalar» на будь-чому, крім масиву, —
  -- і один зіпсований профіль («eloSkip»: 123 з відредагованого руками
  -- експорту) ламав би цій людині elo_submit ЦІЛКОМ. Знайдено тестом.
  select coalesce((select p.data->'eloSkip' from profiles p where p.user_id = uid), '[]'::jsonb)
    into raw;
  if jsonb_typeof(raw) is distinct from 'array' then return cfg; end if;

  -- Білий список із конфігу. Немає ключа — вимикати не можна нічого:
  -- мовчазний дозвіл тут коштував би дорожче за мовчазну заборону.
  allowed := coalesce(cfg->'skippable', '[]'::jsonb);
  if jsonb_typeof(allowed) is distinct from 'array' then allowed := '[]'::jsonb; end if;

  select array_agg(x) into skip
    from jsonb_array_elements_text(raw) x
   where allowed ? x;

  return public.elo_cfg_apply(cfg, skip);
end $$;

revoke all on function public.elo_cfg_for(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.elo_cfg_for(uuid, jsonb) to service_role;
