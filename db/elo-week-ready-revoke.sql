-- =============================================================================
-- elo_week_ready БІЛЬШЕ НЕ ВІДПОВІДАЄ НА ПИТАННЯ ПРО ЧУЖИЙ АКАУНТ
-- Міграція: elo_week_ready_revoke_authenticated
-- =============================================================================
--
-- ЩО БУЛО. public.elo_week_ready(uid uuid, p_week_start date, cfg jsonb) —
-- SECURITY DEFINER, і в бойовій базі вона мала
--
--     grant execute on function public.elo_week_ready(...) to authenticated;
--
-- Функція приймає uid ПАРАМЕТРОМ, а не бере auth.uid(), і чесно відповідає
-- рядком:
--
--     'season_closed'      — той користувач уже закрив цей сезон;
--     'before_first_event' — подій у сезоні в нього немає;
--     null                 — є, тиждень можна оцінювати.
--
-- Тобто будь-хто, хто ввійшов і знає чужий UUID, дізнавався, чи грає та
-- людина в сезоні й чи вона його закрила. Не дані, але факт про чужий
-- акаунт — і саме той клас витоку, який форензик-звіт 02.09.2026 окремо
-- перевіряв і зафіксував інваріантом: «жоден RPC не приймає user_id від
-- клієнта (крім admin_*, і ті — після is_admin(auth.uid()))».
--
-- ЗВІДКИ ВЗЯВСЯ ГРАНТ. Не з міграції. db/elo-week-eval-fix.sql, яка цю
-- функцію й створила, робить `revoke all ... from public` і дає execute
-- ЛИШЕ service_role. Гранта для authenticated немає в жодному файлі db/ —
-- він лишився в базі від типового права PUBLIC часів, коли ще не було
-- deny_public_execute, і при першому ж `grant ... to authenticated` на всю
-- схему закріпився іменним. Тобто продакшн розійшовся зі своїм джерелом,
-- і побачити це можна було лише запитом до бази.
--
-- ЧОМУ ВІДКЛИКАТИ БЕЗПЕЧНО. Обидва місця, звідки функція викликається, —
-- elo_catch_up_weeks і elo_eval_week_for — самі SECURITY DEFINER, тобто
-- виконуються від власника (postgres), а не від того, хто прийшов. Клієнт
-- її не кличе взагалі: у js/ немає жодного rpc('elo_week_ready').
--
-- ЧОМУ САМЕ REVOKE, А НЕ auth.uid() ВСЕРЕДИНІ. Перевірка «uid = auth.uid()»
-- зламала б обидва серверні виклики: у cron-контексті auth.uid() порожній,
-- а elo_catch_up_weeks навмисно рахує тижні для переданого користувача.
-- Функція лишається службовою — просто перестає бути доступною ззовні.
-- =============================================================================

revoke execute on function public.elo_week_ready(uuid, date, jsonb) from authenticated;

-- Пояс і підтяжки: типове право PUBLIC теж прибираємо, якщо воно десь
-- уціліло. Повторний revoke на порожньому місці — не помилка.
revoke all on function public.elo_week_ready(uuid, date, jsonb) from public;

-- service_role лишається: ним ходить cron (elo_cron_eval_week).
grant execute on function public.elo_week_ready(uuid, date, jsonb) to service_role;

-- =============================================================================
-- ПЕРЕВІРКА ПІСЛЯ ВИКОНАННЯ
-- =============================================================================
-- Має лишитись рівно два рядки — postgres (власник) і service_role:
--
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_name = 'elo_week_ready';
--
-- І жодна з функцій, доступних authenticated, більше не приймає чужого
-- користувача параметром, окрім admin_*:
--
--   select p.proname, pg_get_function_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and has_function_privilege('authenticated', p.oid, 'execute')
--      and pg_get_function_arguments(p.oid) ~ '\m(uid|user_id|p_user)\M'
--    order by 1;
-- =============================================================================
