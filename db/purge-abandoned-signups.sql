-- =============================================================================
-- НЕЗАВЕРШЕНА РЕЄСТРАЦІЯ НЕ МАЄ ЛЕЖАТИ ВІЧНО
-- Міграція: purge_abandoned_signups
-- =============================================================================
--
-- ЩО БУЛО. Людина вводить пошту й пароль, Supabase створює рядок в
-- auth.users і надсилає лист. Далі вона передумує, не знаходить листа,
-- помиляється в адресі — і більше не повертається. Рядок лишається
-- назавжди: пошта, хеш пароля, час, IP останньої спроби. Реєстрації
-- не сталося, а сліди від неї є — і прибрати їх ніхто ніколи не прийде,
-- бо про цього чоловіка ніхто не знає.
--
-- Це та сама вимога, що й у браузері (js/welcome.js: пошта не лягає в
-- чернетку, поки акаунта немає). Там вона про диск людини, тут — про
-- нашу базу. Виконувати її наполовину сенсу немає.
--
-- ЩО РОБИМО. Раз на добу прибираємо акаунти, які:
--   * не підтвердили пошту (email_confirmed_at is null),
--   * жодного разу не ввійшли (last_sign_in_at is null),
--   * створені понад GRACE днів тому.
--
-- ЧОМУ САМЕ ЦІ ТРИ УМОВИ. Посилання з листа живе добу; тиждень запасу
-- покриває «підтверджу на вихідних» із великим гаком. Перевірка на
-- last_sign_in_at — страхування від дивних станів (адмін підтвердив
-- пошту руками, autoconfirm вмикали на годину): якщо людина хоч раз
-- була всередині, це вже не «незавершена реєстрація», і чіпати її не
-- можна.
--
-- ЧОМУ НЕ FOREIGN KEY З ON DELETE CASCADE. Таблиці public.* навмисно не
-- посилаються на auth.users зовнішніми ключами (див. db/schema.sql), і
-- міняти це заради прибирання — завелика зміна з завеликими наслідками.
-- Тому прибираємо явно й у тому ж порядку, що й delete_account.
--
-- БЕЗПЕКА. Функція security definer, виконувати може лише service_role
-- (з-під нього ходить pg_cron). Ніякого доступу з браузера.
-- =============================================================================

create or replace function public.purge_abandoned_signups(p_grace_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cut   timestamptz := now() - make_interval(days => greatest(p_grace_days, 1));
  v_ids   uuid[];
  v_count integer := 0;
begin
  select coalesce(array_agg(u.id), '{}')
    into v_ids
    from auth.users u
   where u.email_confirmed_at is null
     and u.last_sign_in_at is null
     and u.created_at < v_cut;

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    return jsonb_build_object('deleted', 0, 'cutoff', v_cut);
  end if;

  /* Спершу похідне, потім сам акаунт: якщо щось упаде посеред дороги,
     краще лишити акаунт без хвостів, ніж хвости без акаунта. */
  delete from public.elo_events     where user_id = any(v_ids);
  delete from public.elo_week_plan  where user_id = any(v_ids);
  delete from public.season_history where user_id = any(v_ids);
  delete from public.season_state   where user_id = any(v_ids);
  delete from public.awards         where user_id = any(v_ids);
  delete from public.consent_log    where user_id = any(v_ids);
  delete from public.account_status where user_id = any(v_ids);
  delete from public.profiles       where user_id = any(v_ids);
  delete from auth.users            where id      = any(v_ids);

  return jsonb_build_object('deleted', v_count, 'cutoff', v_cut);
end $$;

revoke all on function public.purge_abandoned_signups(integer) from public, anon, authenticated;
grant execute on function public.purge_abandoned_signups(integer) to service_role;

/* Обгортка з журналом — за зразком elo_cron_log_eval_week: без запису в
   cron_log мовчазна поламка розкладу помітна лише тоді, коли хтось
   згадає подивитись. */
create or replace function public.cron_purge_abandoned_signups()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb;
begin
  r := public.purge_abandoned_signups(7);
  insert into public.cron_log (job, result) values ('purge_abandoned_signups', r);
end $$;

revoke all on function public.cron_purge_abandoned_signups() from public, anon, authenticated;
grant execute on function public.cron_purge_abandoned_signups() to service_role;

/* 03:20 UTC — коли нікого немає. Окремо від 00:10 (elo_cron_eval_week),
   щоб два довгі завдання не зустрічались. */
select cron.schedule('forge-purge-abandoned-signups', '20 3 * * *',
                     'select public.cron_purge_abandoned_signups()');
