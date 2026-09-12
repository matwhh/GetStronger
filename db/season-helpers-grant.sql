-- =============================================================================
-- ПОМІЧНИКИ СЕЗОНУ: ДОЗВІЛ authenticated НА ТЕ, ЩО ЙОМУ ВЖЕ ПОТРІБНО
-- Міграція: season_helpers_execute_authenticated
-- =============================================================================
--
-- ЩО БУЛО ЗЛАМАНО. season_of має грант для authenticated ще з першої схеми —
-- і працювала, поки рахувала сезон сама, з місяця й року. Міграція
-- season_week_bounds (09.09.2026) переписала її так, що вона кличе
-- season_bounds → season_end → season_nominal_end і season_prev. Гранта на
-- жодну з цих чотирьох authenticated не має, а season_of — не SECURITY
-- DEFINER, тобто виконується від імені того, хто кличе. Результат:
--
--   ERROR:  permission denied for function season_bounds
--
-- Тобто грант на season_of три дні існував як обіцянка, якої база не могла
-- виконати.
--
-- ЧОМУ НЕ ПОМІТИЛИ. Клієнт season_of не кличе — жодного разу в жодному з
-- девʼятнадцяти RPC (див. docs/MAP.md). Усі серверні виклики йдуть
-- усередині SECURITY DEFINER-функцій, тобто від власника, якому права є.
-- Зламане було саме там, куди ніхто не дивиться, і вилізло на
-- db/elo-integrity-tests.sql — щойно знімок схеми перезняли й тести
-- побачили СПРАВЖНЮ season_of замість застарілої.
--
-- ЧОМУ САМЕ ГРАНТ, А НЕ SECURITY DEFINER. Зробити season_of definer —
-- означало б дати їй права власника назавжди заради чистої арифметики дат.
-- Чотири функції, яким тут відкривається execute, не читають ані рядка з
-- таблиць: усі IMMUTABLE, усі рахують із текстового імені сезону. Віддавати
-- їм повноваження власника дорожче, ніж дозволити їх кликати.
--
-- anon НЕ ОТРИМУЄ НІЧОГО: грант іменний, для authenticated. Після
-- deny_public_execute типове право PUBLIC більше не зʼявляється.
-- =============================================================================

grant execute on function public.season_bounds(text) to authenticated;
grant execute on function public.season_end(text) to authenticated;
grant execute on function public.season_nominal_end(text) to authenticated;
grant execute on function public.season_prev(text) to authenticated;
