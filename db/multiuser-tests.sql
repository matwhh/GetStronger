-- =============================================================================
-- Тести на КІЛЬКОХ КОРИСТУВАЧАХ
-- =============================================================================
-- Досі все перевірялось на одному акаунті — у production і був один. Перед
-- запуском 10 людей треба переконатись у тому, чого один користувач не
-- показує: що вони не бачать даних одне одного, не з'їдають один одному
-- бюджет, не блокують одне одному нік і правильно шикуються в таблиці
-- лідерів (включно з однаковим рейтингом).
--
-- Виконувати в SQL Editor як є: скрипт створює тимчасових користувачів і
-- НАВМИСНО завершується винятком — уся транзакція відкочується.
-- Успіх:  ERROR:  MULTIUSER: N з N пройдено
-- =============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000e201';  -- Аня,  approved
  ub uuid := '00000000-0000-4000-8000-00000000e202';  -- Борис, approved
  uc uuid := '00000000-0000-4000-8000-00000000e203';  -- Віра, pending
  ud uuid := '00000000-0000-4000-8000-00000000e204';  -- новачок без заявки
  y date := current_date - 1;
  r jsonb; out text := E'\n'; okn int := 0; alln int := 0; n int; c boolean; txt text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','mu-a@local','x',now(),now()),
         (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','mu-b@local','x',now(),now()),
         (uc,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','mu-c@local','x',now(),now()),
         (ud,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','mu-d@local','x',now(),now());

  insert into public.account_status (user_id, status, username) values
    (ua,'approved','Аня'), (ub,'approved','Борис'), (uc,'pending','Віра');

  -- Однакові факти в обох: якщо бюджети переплутані, це вилізе одразу.
  insert into public.profiles (user_id, data)
  select u, jsonb_build_object(
    'activePlan', jsonb_build_object('days', 4),
    'trackers',   '{"sleep":{"goal":480}}'::jsonb,
    'trackerLog', jsonb_build_object('sleep', jsonb_build_object(y::text, 480)))
  from unnest(array[ua, ub, uc]) u;

  -- ---- 1. Нік зайнятий іншим користувачем -------------------------------
  --
  -- Перевіряти треба саме НОВАЧКОМ. У вже підтвердженого користувача
  -- register_request виходить раніше з {"status":"approved"} і нічого не
  -- пише — перший варіант цього тесту бив саме в ту гілку й показував
  -- «нік не захищений» там, де насправді просто нічого не відбувалось.
  perform set_config('request.jwt.claims', json_build_object('sub', ud)::text, true);
  set local role authenticated;
  begin
    perform public.register_request('Аня', '1995-01-01'::date, '{}'::jsonb,
      '[{"document":"privacy_policy","version":"1.1"},{"document":"terms_of_use","version":"1.0"},{"document":"medical_disclaimer","version":"1.0"}]'::jsonb);
    c := false; txt := 'заявку прийнято — нік НЕ захищений';
  exception when others then
    c := sqlerrm = 'USERNAME_TAKEN'; txt := sqlerrm;
  end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'чужий нік «Аня» відхилено :: ' || txt || E'\n';

  -- Той самий нік іншим регістром — теж зайнятий (порівняння через lower()).
  begin
    perform public.register_request('аНЯ', '1995-01-01'::date, '{}'::jsonb,
      '[{"document":"privacy_policy","version":"1.1"},{"document":"terms_of_use","version":"1.0"},{"document":"medical_disclaimer","version":"1.0"}]'::jsonb);
    c := false; txt := 'прийнято';
  exception when others then
    c := sqlerrm = 'USERNAME_TAKEN'; txt := sqlerrm;
  end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'нік іншим регістром теж зайнятий :: ' || txt || E'\n';

  c := public.username_free('Аня') = false and public.username_free('Ірина') = true;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'username_free бачить зайнятий і вільний нік' || E'\n';
  reset role;

  -- Підтверджений користувач: повторна заявка — беззмінний no-op.
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  r := public.register_request('Аня', '1995-01-01'::date, '{}'::jsonb,
    '[{"document":"privacy_policy","version":"1.1"},{"document":"terms_of_use","version":"1.0"},{"document":"medical_disclaimer","version":"1.0"}]'::jsonb);
  reset role;
  select username into txt from public.account_status where user_id = ub;
  c := (r->>'status') = 'approved' and txt = 'Борис';
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
              || 'заявка від підтвердженого нічого не змінює :: нік лишився ' || coalesce(txt,'—') || E'\n';

  -- Перейменування: elo_set_name бере нік із заявки й ігнорує аргумент,
  -- тож чужим ім'ям у таблиці лідерів не прикритись.
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  perform public.elo_set_name('Аня');
  reset role;
  select display_name into txt from public.season_state where user_id = ub and season = season_of(current_date);
  c := coalesce(txt, '') <> 'Аня';
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
              || 'elo_set_name не дає взяти чуже ім''я :: ' || coalesce(nullif(txt,''),'(порожньо)') || E'\n';

  -- ---- 2. Ізоляція даних ------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles where user_id = ua;
  c := n = 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'Борис не бачить профіль Ані (RLS) :: рядків ' || n || E'\n';

  select count(*) into n from public.profiles;
  c := n = 1; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'Борис бачить рівно свій профіль :: рядків ' || n || E'\n';

  -- Оракул статусу чужого акаунта (F-08) — на кількох користувачах видно краще.
  c := public.is_approved(ua) = false; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'is_approved(чужий uid) не відповідає' || E'\n';

  -- ---- 3. Бюджети незалежні ---------------------------------------------
  r := public.elo_submit('sleep','x', y, '{}');
  c := (r->>'delta')::int > 0; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'Борис отримав свій сон :: ' || coalesce(r->>'delta','—') || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  r := public.elo_submit('sleep','x', y, '{}');
  c := (r->>'delta')::int > 0 and (r->>'duplicate') is null; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end
              || 'та сама подія в Ані — не duplicate чужої :: ' || coalesce(r->>'delta','—') || E'\n';
  reset role;

  -- Ключова інваріанта: унікальність події — по (user_id, тип, день),
  -- а не глобально по (тип, день). Інакше другий користувач за день
  -- лишався б без нарахування.
  select count(*) into n from public.elo_events where day = y and event_type = 'sleep' and user_id in (ua, ub);
  c := n = 2; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'дві окремі події сну за один день :: ' || n || E'\n';

  -- ---- 4. Таблиця лідерів ------------------------------------------------
  update public.season_state set elo = 500 where user_id = ua and season = season_of(current_date);
  update public.season_state set elo = 300 where user_id = ub and season = season_of(current_date);

  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  r := public.elo_leaderboard(50);
  c := jsonb_array_length(r) >= 2; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'у таблиці ≥ 2 рядки :: ' || jsonb_array_length(r) || E'\n';

  select (e->>'name') into txt from jsonb_array_elements(r) e where (e->>'rank')::int = 1;
  c := txt = 'Аня'; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'перше місце — у більшого ELO :: ' || coalesce(txt,'—') || E'\n';

  select count(*) into n from jsonb_array_elements(r) e where (e->>'me')::boolean;
  c := n = 1; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'рівно один рядок позначено «я» :: ' || n || E'\n';

  select (e->>'me')::boolean into c from jsonb_array_elements(r) e where (e->>'name') = 'Борис';
  c := coalesce(c, false); alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || '«я» стоїть саме на Борисові, а не на першому' || E'\n';
  reset role;

  -- Однаковий рейтинг: обидва мають отримати той самий ранг, а не
  -- випадковий порядок з різними номерами.
  update public.season_state set elo = 500 where user_id in (ua, ub) and season = season_of(current_date);
  perform set_config('request.jwt.claims', json_build_object('sub', ua)::text, true);
  set local role authenticated;
  r := public.elo_leaderboard(50);
  select count(distinct (e->>'rank')) into n from jsonb_array_elements(r) e where (e->>'name') in ('Аня','Борис');
  c := n = 1; alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'рівний ELO → однаковий ранг :: різних рангів ' || n || E'\n';
  reset role;

  -- ---- 5. Непідтверджений акаунт --------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', uc)::text, true);
  set local role authenticated;
  begin
    r := public.elo_leaderboard(50);
    c := false; txt := 'таблицю віддано';
  exception when others then
    c := sqlerrm = 'NOT_APPROVED'; txt := sqlerrm;
  end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'pending не бачить таблиці лідерів :: ' || txt || E'\n';

  begin
    r := public.elo_submit('sleep','x', y, '{}');
    c := false; txt := 'подачу прийнято';
  exception when others then
    c := true; txt := sqlerrm;
  end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'pending не нараховує ELO :: ' || txt || E'\n';
  reset role;

  -- ---- 6. Адмінські RPC для звичайного користувача ----------------------
  perform set_config('request.jwt.claims', json_build_object('sub', ub)::text, true);
  set local role authenticated;
  begin
    r := public.admin_requests('pending', 50, 0);
    c := false; txt := 'список заявок віддано';
  exception when others then
    c := true; txt := sqlerrm;
  end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'звичайний користувач не бачить заявок :: ' || txt || E'\n';

  begin
    r := public.admin_elo_anomalies(null);
    c := false; txt := 'аномалії віддано';
  exception when others then
    c := true; txt := sqlerrm;
  end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'звичайний користувач не бачить аномалій :: ' || txt || E'\n';

  begin
    perform public.admin_decide(ua, 'block');
    c := false; txt := 'блокування виконано';
  exception when others then
    c := true; txt := sqlerrm;
  end;
  alln:=alln+1; okn:=okn+c::int;
  out := out || case when c then 'OK   ' else 'FAIL ' end || 'звичайний користувач не блокує інших :: ' || txt || E'\n';
  reset role;

  raise exception 'MULTIUSER: % з % пройдено%', okn, alln, out;
end $$;
