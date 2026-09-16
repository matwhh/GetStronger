-- =============================================================================
-- Тести закриття сезону з розкладу (DB-008)
-- =============================================================================
-- Виконувати як є: скрипт створює тимчасових користувачів і НАВМИСНО
-- завершується винятком — уся транзакція відкочується.
--
-- Успіх виглядає так:
--     ERROR:  ЗАКРИТТЯ СЕЗОНУ: 9 з 9 пройдено
--
-- Що саме тут стережеться:
--   1. розклад закриває сезон БЕЗ участі людини — заради цього все й
--      робилось, дедлайн 2026-12-03;
--   2. ранги рахуються після того, як останній тиждень догнали ВСІМ:
--      поодинці вони виходили залежними від того, хто зайшов першим;
--   3. другий прогін нічого не дублює;
--   4. сезон, який ще йде, не чіпається;
--   5. серверну функцію не можна викликати з браузера;
--   6. обгортка з журналом НЕ ВІДКОЧУЄ вже закриті сезони, коли на комусь
--      одному закриття впало (pg_cron виконує завдання однією транзакцією,
--      тож raise exception у кінці зносив і чужу роботу, і сам журнал).
-- =============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000c001';
  ub uuid := '00000000-0000-4000-8000-00000000c002';
  uc uuid := '00000000-0000-4000-8000-00000000c003';
  done text := 'SPRING-2026';     -- завершений: межі в минулому
  live text := 'WINTER-2026';     -- ще не завершений
  r jsonb; out text := E'\n'; okn int := 0; alln int := 0;
  n int; m int; ra int; rb int; ea int; b record;
  chk boolean;
begin
  -- Сезон-орієнтир мусить бути справді завершеним, інакше весь файл
  -- перевіряє не те, що думає.
  select * into b from public.season_bounds(done);
  if b.e is null or current_date <= b.e + 2 then
    raise exception 'ТЕСТ НЕПРИДАТНИЙ: % ще не завершений (кінець %)', done, b.e;
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','cs-a@local','x',now(),now()),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','cs-b@local','x',now(),now());
  insert into public.account_status (user_id, status) values (ua,'approved'), (ub,'approved');
  insert into public.profiles (user_id, data) values
    (ua, jsonb_build_object('activePlan', jsonb_build_object('days', 4))),
    (ub, jsonb_build_object('activePlan', jsonb_build_object('days', 4)));

  -- A сильніший за B — отже ранг 1 має дістатись A.
  insert into public.season_state (user_id, season, elo) values
    (ua, done, 1200), (ub, done, 400),
    (ua, live, 300);

  -- 1. Розклад закрив завершений сезон обом.
  alln := alln + 1;
  r := public.elo_cron_close_seasons();
  select count(*) into n from public.season_history where season = done and user_id in (ua, ub);
  if n = 2 then okn := okn + 1; out := out || E'\nOK   розклад закрив сезон обом без участі людини';
  else out := out || format(E'\nFAIL закрито %s із 2 (відповідь %s)', n, r); end if;

  -- 2. Ранги: сильніший перший. Це і є те, заради чого два проходи.
  alln := alln + 1;
  select rank into ra from public.season_history where season = done and user_id = ua;
  select rank into rb from public.season_history where season = done and user_id = ub;
  if ra = 1 and rb = 2 then okn := okn + 1; out := out || E'\nOK   ранги розставлені за ELO';
  else out := out || format(E'\nFAIL ранги: A=%s B=%s, очікувалось 1 і 2', ra, rb); end if;

  -- 3. of_users бачить обох, а не одного.
  alln := alln + 1;
  select of_users into n from public.season_history where season = done and user_id = ua;
  if n = 2 then okn := okn + 1; out := out || E'\nOK   учасників у підсумку двоє';
  else out := out || format(E'\nFAIL of_users = %s, очікувалось 2', n); end if;

  -- 4. Підсумковий ELO збігається зі станом сезону.
  alln := alln + 1;
  select final_elo into ea from public.season_history where season = done and user_id = ua;
  if ea = 1200 then okn := okn + 1; out := out || E'\nOK   підсумковий ELO взято зі стану сезону';
  else out := out || format(E'\nFAIL final_elo = %s, очікувалось 1200', ea); end if;

  -- 5. Нагороди виписані переможцю.
  alln := alln + 1;
  select count(*) into n from public.awards where season = done and user_id = ua and kind = 'first';
  if n = 1 then okn := okn + 1; out := out || E'\nOK   нагорода #1 сезону виписана';
  else out := out || format(E'\nFAIL нагород first: %s, очікувалась 1', n); end if;

  -- 6. Сезон, який ще йде, не чіпали.
  alln := alln + 1;
  select count(*) into n from public.season_history where season = live;
  if n = 0 then okn := okn + 1; out := out || E'\nOK   сезон, що триває, не закривається';
  else out := out || format(E'\nFAIL закрито %s рядків незавершеного сезону', n); end if;

  -- 7. Другий прогін нічого не дублює.
  alln := alln + 1;
  r := public.elo_cron_close_seasons();
  select count(*) into n from public.season_history where season = done and user_id in (ua, ub);
  if n = 2 and coalesce((r->>'closed')::int, -1) = 0 then
    okn := okn + 1; out := out || E'\nOK   повторний прогін нічого не додав';
  else out := out || format(E'\nFAIL після другого прогону рядків %s, closed=%s', n, r->>'closed'); end if;

  -- 8. Клієнтська функція без входу не працює — перевірки на місці.
  alln := alln + 1;
  begin
    set local role authenticated;
    perform public.elo_close_season(done);
    reset role;
    out := out || E'\nFAIL elo_close_season спрацювала без auth.uid()';
  exception when others then
    reset role;
    okn := okn + 1; out := out || E'\nOK   elo_close_season без входу не працює';
  end;

  -- 9. Серверну функцію ролі authenticated не видно взагалі.
  alln := alln + 1;
  select has_function_privilege('authenticated', 'public.elo_close_season_for(uuid, text)', 'execute')
    into chk;
  if chk is not true then okn := okn + 1;
    out := out || E'\nOK   elo_close_season_for недоступна для authenticated';
  else out := out || E'\nFAIL authenticated може закрити сезон за чужий акаунт'; end if;

  -- 10. Провал на одному не відкочує закриття решти — і не зʼїдає журнал.
  --
  -- Переграємо закриття з третім користувачем, на якому воно навмисно
  -- падає (тригер нижче). Із raise exception в обгортці і рядки A та B, і
  -- рядок cron_log відкочувались разом із винятком — по суті нічна робота
  -- зникала цілком через одного зламаного користувача.
  alln := alln + 1;
  delete from public.season_history where season = done;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (uc,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','cs-c@local','x',now(),now());
  insert into public.account_status (user_id, status) values (uc,'approved');
  insert into public.profiles (user_id, data) values
    (uc, jsonb_build_object('activePlan', jsonb_build_object('days', 4)));
  insert into public.season_state (user_id, season, elo) values (uc, done, 700);

  create or replace function public.tst_close_boom() returns trigger
    language plpgsql as $f$
  begin
    if new.user_id = '00000000-0000-4000-8000-00000000c003'::uuid then
      raise exception 'навмисна поламка закриття';
    end if;
    return new;
  end $f$;
  create trigger tst_close_boom before insert on public.season_history
    for each row execute function public.tst_close_boom();

  begin
    perform public.elo_cron_log_close_seasons();
  exception when others then
    /* Саме сюди все й падало до міграції: виняток обгортки. Ловимо, щоб
       побачити, ЩО від прогону лишилось. */
    null;
  end;

  select count(*) into n from public.season_history where season = done and user_id in (ua, ub);
  select count(*) into m from public.cron_log where job = 'elo_cron_close_seasons';
  if n = 2 and m >= 1 then okn := okn + 1;
    out := out || E'\nOK   провал на одному не відкотив ні закриття решти, ні журнал';
  else out := out || format(E'\nFAIL після провалу лишилось %s закритих із 2 і %s рядків журналу', n, m); end if;

  drop trigger tst_close_boom on public.season_history;
  drop function public.tst_close_boom();

  -- 11. Обидві обгортки розкладу більше не кидають виняток.
  --
  -- Перевіряється текст функції, а не поведінка: другу обгортку
  -- (elo_cron_log_eval_week) відтворювати тут дорожче, ніж вона коштує, а
  -- дефект у них обох був буквально однаковим рядком.
  alln := alln + 1;
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('elo_cron_log_eval_week', 'elo_cron_log_close_seasons')
     and p.prosrc ilike '%raise exception%';
  if n = 0 then okn := okn + 1;
    out := out || E'\nOK   жодна обгортка розкладу не кидає винятку';
  else out := out || format(E'\nFAIL обгорток із raise exception: %s', n); end if;

  -- 12. Замість винятку — будильник: admin_cron_health бачить усі три
  --     завдання і закрита для всіх, крім залогінених.
  alln := alln + 1;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_cron_health';
  /* Права питаємо лише тоді, коли функція є: has_function_privilege на
     неіснуючій кидає виняток і завалив би весь файл замість одного рядка. */
  if n = 1 then
    select case when has_function_privilege('anon', 'public.admin_cron_health()', 'execute')
                then 1 else 0 end into m;
  else m := -1; end if;
  if n = 1 and m = 0 then okn := okn + 1;
    out := out || E'\nOK   admin_cron_health на місці й закрита для anon';
  else out := out || format(E'\nFAIL admin_cron_health: функцій %s, доступ anon %s', n, m); end if;

  raise exception 'ЗАКРИТТЯ СЕЗОНУ: % з % пройдено%', okn, alln, out;
end $$;
