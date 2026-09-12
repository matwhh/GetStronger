-- =============================================================================
-- EXECUTE ДЛЯ PUBLIC: ЗАКРИТИ Й НЕ ДАТИ ВІДКРИТИСЬ ЗНОВУ
-- Міграція: deny_public_execute
-- =============================================================================
--
-- ЩО ЗНАЙШЛОСЬ. У бойовій базі шість функцій public мали execute для anon:
--
--   elo_pace, elo_action_delta        — додані міграцією elo_pace_level_curve
--   grant_beta_award                  — award_beta
--   season_end, season_nominal_end, season_prev — season_week_bounds
--
-- Права їм ніхто не давав. Postgres при створенні функції САМ дає execute
-- ролі PUBLIC, а anon і authenticated входять у PUBLIC. Тобто кожна нова
-- функція відкривається для anon за замовчуванням, і єдине, що це колись
-- закрило, — одноразовий `revoke ... from public` у elo-engine.sql. На
-- функції, створені ПІСЛЯ того разу, він не діє.
--
-- ЧОМУ НЕ ВРЯТУВАВ default-privileges.sql. Він знімає типові права
-- «from anon, authenticated» — і це нічого не дає: право приходить не їм
-- особисто, а ролі PUBLIC, через яку вони його й успадковують. Знімати
-- треба саме з PUBLIC. Один із тих випадків, де запит виконався без
-- помилки й не зробив нічого.
--
-- НАСКІЛЬКИ ЦЕ БУЛО СТРАШНО. Помірно: elo_pace й elo_action_delta —
-- IMMUTABLE-обчислення, які нічого не читають із таблиць і повертають
-- рівно те, що їм передали; season_* рахують межі сезону з рядка.
-- grant_beta_award пише в awards, але СВОЄМУ auth.uid(), якого в anon
-- немає. Даних це не віддавало. Але інвентар «anon — жодної функції» з
-- аудиту переставав бути правдою, і наступна функція могла виявитись уже
-- не такою безневинною.
--
-- ЧОМУ REVOKE БЕЗПЕЧНИЙ. Усі дев'ятнадцять RPC, які кличе клієнт, мають
-- ЯВНИЙ грант для authenticated (account_state, elo_submit, elo_state,
-- profile_patch, register_request, … — повний список у docs/MAP.md). Ті
-- шість, що втрачають доступ, клієнт не кличе ні разу: вони працюють
-- усередині SECURITY DEFINER-функцій, тобто від імені власника.
-- Перевірено прогоном db/elo-tests.sql, elo-integrity-tests.sql,
-- multiuser-tests.sql і sim-week.sql на копії схеми ПІСЛЯ цієї міграції:
-- 92 з 92.
-- =============================================================================

-- 1. Прибрати вже видане.
revoke execute on all functions in schema public from public;

-- 2. Щоб не поверталось із кожною новою функцією.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
