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
--   5. серверну функцію не можна викликати з браузера.
-- =============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000c001';
  ub uuid := '00000000-0000-4000-8000-00000000c002';
  done text := 'SPRING-2026';     -- завершений: межі в минулому
  live text := 'WINTER-2026';     -- ще не завершений
  r jsonb; out text := E'\n'; okn int := 0; alln int := 0;
  n int; ra int; rb int; ea int; b record;
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

  raise exception 'ЗАКРИТТЯ СЕЗОНУ: % з % пройдено%', okn, alln, out;
end $$;
