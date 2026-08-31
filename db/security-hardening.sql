/*
 * SECURITY HARDENING — журнал застосованих у продакшені правок доступу.
 *
 * Цей файл — історія, а не «чистий установник»: базові політики й гранти
 * лежать у db/elo-engine.sql / db/account-approval.sql, а тут — точкові
 * посилення, застосовані міграціями поверх.
 *
 * ── elo_config: read лише для approved ──────────────────────────────────
 * Таблиця elo_config містить самі КОНСТАНТИ рейтингу (ваги, стелі,
 * tolerance-зони) — не дані користувачів. Застосунок читає їх НЕ напряму, а
 * всередині RPC elo_state (SECURITY DEFINER, is_approved-gated), тож для
 * фронту нічого не змінюється. Відкритий read для будь-якого залогіненого
 * користувача був зайвим шляхом для не-approved — прибрано.
 *
 * Міграція: harden_elo_config_read_approved_only
 */
drop policy if exists elo_config_read on public.elo_config;
create policy elo_config_read on public.elo_config
  for select to authenticated
  using ((select public.is_approved(auth.uid())));

/*
 * ── МОДЕЛЬ ДОСТУПУ (для довідки; вже діє в базі) ─────────────────────────
 *
 * anon                         → 0 (жодного grant, крім публічного site_files)
 * authenticated, НЕ approved   → 0 захищеного:
 *      profiles / season_state / elo_events / awards / season_history /
 *      consent_log — усі політики містять is_approved(auth.uid());
 *      account_status / admins — БЕЗ write-grant для authenticated взагалі
 *        (self-approve і self-admin фізично неможливі);
 *      усі elo_* RPC та account_state — raise NOT_APPROVED / повертають 'none';
 *      admin_* RPC — raise FORBIDDEN (перевіряють is_admin).
 * approved                     → лише власні рядки (auth.uid() = user_id).
 * admin                        → admin_* RPC (перевірка is_admin у тілі).
 *
 * Єдиний шлях зробити акаунт approved — admin_decide('approve'), який на
 * вході перевіряє is_admin(auth.uid()). Клієнтські поля payload (approved,
 * role, isApproved, user_id) сервером ІГНОРУЮТЬСЯ: рішення завжди від
 * auth.uid() із підписаного Supabase JWT.
 *
 * FAIL-CLOSED: немає рядка / null-статус / помилка is_approved → доступ
 * заборонено (exists(...) = false, політика падає в deny).
 */
