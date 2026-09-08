-- =============================================================================
-- ТИПОВІ ПРАВА СХЕМИ public  (міграція default_privileges_deny_public)
-- =============================================================================
-- SEC-004 з аудиту 2026-09.
--
-- ЩО БУЛО. pg_default_acl схеми public віддавав КОЖНІЙ новій таблиці
-- arwdDxtm для anon і authenticated, а кожній новій функції — EXECUTE. RLS
-- на новій таблиці вимкнено за замовчуванням. Тобто щойно міграція
-- створювала таблицю, PostgREST одразу починав її роздавати — а закривали
-- це шістнадцять ручних revoke, розкиданих по db/*.sql. Жодного з них
-- машина не перевіряла: `revoke on all functions` у db/elo-engine.sql діє
-- лише на функції, що вже існують на момент виконання.
--
-- Сьогодні всі 10 таблиць і 36 функцій закриті правильно. Це знахідка не
-- про сьогодні, а про наступну міграцію: одна забута строчка — і нова
-- таблиця публічна, причому мовчки.
--
-- ЩО СТАЛО. Типові права для обʼєктів, створених роллю postgres (саме нею
-- виконуються міграції проєкту), більше не містять anon і authenticated.
-- Доступ треба відкривати свідомо — інакше PostgREST нової таблиці не
-- побачить. Наявних обʼєктів це не торкнулось: alter default privileges діє
-- лише вперед, а явно видані права лишаються.
--
-- ЧОГО НЕ ВДАЛОСЬ. Ті самі типові права для ролі supabase_admin змінити з
-- ролі postgres не можна (permission denied) — вони лишились як були.
-- Обʼєкти, створені платформою, і далі народжуються відкритими; на практиці
-- це не наш шлях, бо міграції проєкту виконуються від postgres.
-- =============================================================================

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
