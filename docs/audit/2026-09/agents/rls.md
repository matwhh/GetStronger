# Аудит Phase A — домен «RLS, RPC, авторизація на сервері» (SEC)

Агент: rls. Дати: 2026-09-05 (перший прогін, обірваний лімітом) і 2026-09-06 (продовження). Режим: ТІЛЬКИ ЧИТАННЯ (SELECT або `BEGIN … ROLLBACK`
з `RAISE EXCEPTION`). Проєкт Supabase: `sojbyoxcxyiollefupss`.

## Обсяг і метод

- Живий перелік обʼєктів схеми `public` (pg_tables, pg_views, pg_proc, pg_policies,
  information_schema.role_table_grants / column_privileges / routine_privileges) і звірка з `db/*.sql`.
- RLS-матриця таблиця × роль (anon / authenticated A / authenticated B / адмін) × операція,
  перевірена ІМПЕРСОНАЦІЄЮ в транзакції з відкатом (`set local role`, `set_config('request.jwt.claims', …)`).
- Колонкові привілеї для чутливих колонок (PATCH через PostgREST).
- Функції: SECURITY DEFINER/INVOKER, search_path, EXECUTE-гранти, валідація входу, доступ до чужих рядків.
- Механізм адміна, шляхи ескалації.
- Auth-логи (`query_logs`), advisors.
- Підсумок «зловмисник з anon key і curl».

Приватність: у звіті лише скорочені user_id (перші 8 символів).

**Підсумок обсягу (2026-09-05 + 2026-09-06):** 10 таблиць, 0 view, 36 функцій, 12 політик, 1 тригер, 9 FK, 1 cron-job;
RLS-матриця 268/268 клітинок (двічі); 30 RPC-викликів × 3 ролі = 90 проб функцій; 9 проб колонок `profiles`;
10 проб `register_request`/статусів; 1 проба ескалації через `admin_decide` + `elo_set_name`; 1 проба default ACL
(DDL у відкаті); 5 read-only curl до Supabase + 2 до бойового домену; auth-логи за 2026-09-03…06 (4 вікна по 24 год);
edge-логи за 24 год; `get_advisors(security)` — 23 записи. Усі мутуючі проби — у `DO … RAISE EXCEPTION`; жодного
запису в бойову базу, жодного акаунта, жодного листа.

**Вердикт домену:** обходу RLS, IDOR, ескалації до адміна або запису в ELO-таблиці з клієнта **не знайдено** —
кожна клітинка матриці й кожна з 36 функцій перевірені фактично. Знахідки — 1 MEDIUM (латентні default privileges,
SEC-004), 3 LOW (SEC-001…003), 1 LOW ENVIRONMENTAL (SEC-005).

## Що перевірено

### 1. Живий інвентар схеми `public` (2026-09-05)

Джерело: `pg_class`/`pg_policies`/`information_schema.role_table_grants`/`pg_proc` через `execute_sql`.

| Таблиця | RLS | FORCE | Політик | Гранти `anon` | Гранти `authenticated` |
|---|---|---|---|---|---|
| profiles | on | on | 4 (select/insert/update/delete, `to authenticated`, `auth.uid()=user_id and is_approved`) | — | SELECT, INSERT, UPDATE, DELETE |
| account_status | on | on | 1 (select own) | — | SELECT |
| admins | on | on | 1 (select self) | — | SELECT |
| awards | on | on | 1 (select own + is_approved) | — | SELECT |
| consent_log | on | on | 1 (select own) | — | SELECT |
| elo_config | on | **off** | 1 (select, is_approved) | — | SELECT |
| elo_events | on | on | 1 (select own + is_approved) | — | SELECT |
| elo_week_plan | on | on | **0** (навмисно) | — | — |
| season_history | on | on | 1 (select own + is_approved) | — | SELECT |
| season_state | on | on | 1 (select own + is_approved) | — | SELECT |

- View у `public`: **0** (`public.leaderboard` видалено міграцією `hardening_size_limits_oracles_view`, підтверджено `pg_class relkind='v'` → порожньо).
- Колонкових грантів, відмінних від табличних, для `anon`/`authenticated`/`public`: **0** (`information_schema.column_privileges` мінус `role_table_grants` → порожньо).
- Функцій у `public`: **36**. Усі з `SET search_path=public`. Усі належать `postgres`. Жодна не має EXECUTE для `anon`.
  - EXECUTE для `authenticated` (22): account_state, admin_decide, admin_elo_anomalies, admin_elo_list, admin_elo_set, admin_requests, delete_account, elo_activate_grace, elo_catch_up, elo_close_season, elo_evaluate_week, elo_history, elo_leaderboard, elo_recent, elo_set_name, elo_state, elo_submit, is_admin, is_approved, register_request, season_of, username_free.
  - Лише `postgres`/`service_role` (14): elo_action_delta, elo_band, elo_catch_up_weeks, elo_cron_eval_week, elo_eval_week_for, elo_facts, elo_ladder, elo_num, elo_planned_for, elo_tracker_value, elo_try_clean_day, elo_week_room, season_bounds, touch_updated_at.
  - SECURITY DEFINER (28): усі 22 клієнтські RPC (крім season_of) + elo_catch_up_weeks, elo_cron_eval_week, elo_eval_week_for, elo_facts, elo_planned_for, elo_try_clean_day, elo_week_room. SECURITY INVOKER (8): elo_action_delta, elo_band, elo_ladder, elo_num, elo_tracker_value, season_bounds, season_of, touch_updated_at.
- Міграцій у `supabase_migrations.schema_migrations`: **29** (від `profiles_base` 2026-08-27 до `elo_cron_eval_week` 2026-09-04).
- Default privileges схеми `public` (`pg_default_acl`, власники `postgres` і `supabase_admin`): нові таблиці → `anon`/`authenticated`/`service_role` = **arwdDxtm** (усе), нові функції → **EXECUTE** для `anon`/`authenticated`, нові sequence → rwU. Тобто кожний новий обʼєкт народжується відкритим, доки міграція явно не зробить `revoke` (див. SEC-004).

#### Звірка функцій із `db/*.sql` (md5 тіла після зняття `--`-коментарів і нормалізації пробілів; скрипт `/tmp/audit-rls/cmp2.mjs`)

| Стан | Функції |
|---|---|
| Збігається з файлом у репо (24) | admin_elo_anomalies, admin_elo_list, admin_elo_set(elo-integrity), elo_action_delta(elo-proportional), elo_band, elo_catch_up, elo_catch_up_weeks(elo-integrity), elo_close_season(elo-integrity), elo_eval_week_for(elo-integrity), elo_evaluate_week(elo-authoritative), elo_facts(elo-proportional), elo_ladder, elo_num, elo_planned_for, elo_set_name(nick-length), elo_submit(elo-integrity), elo_tracker_value, elo_try_clean_day(elo-integrity), elo_week_room, is_admin, is_approved, register_request(security-hardening-2), season_bounds, touch_updated_at |
| Є в репо, але жива версія інша (3) | elo_activate_grace, elo_state (жива має `if not is_approved(uid) then raise 'NOT_APPROVED'` — у `db/elo-engine.sql` цього немає), elo_leaderboard (жива = `leaderboard-name.sql` без блочного коментаря — розбіжність лише в коментарі) |
| **Немає в жодному `db/*.sql` (9)** | account_state, admin_decide, admin_requests, delete_account, elo_cron_eval_week, elo_history, elo_recent, season_of, username_free |

Живі тіла всіх 9 «відсутніх» функцій прочитано (`pg_get_functiondef`) і проаналізовано нижче в розділі «Функції».

### 2. RLS-матриця (фактична імперсонація, `BEGIN … RAISE EXCEPTION`)

Метод: один `DO $$ … $$` блок на роль; `set local role anon|authenticated`,
`set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)`; для кожної таблиці —
SELECT (count всього / своїх / чужих), INSERT (свій user_id / чужий), UPDATE чутливої колонки (свій / чужий рядок),
DELETE (свій / чужий). Результат кожної клітинки — SQLSTATE або кількість рядків; у кінці `RAISE EXCEPTION 'RLS_MATRIX …'`,
тож жодна мутація не збережена. Повний скрипт: `/tmp/audit-rls/matrix.sql`.

Ролі: **anon** (без JWT); **A** = `3ed0794f…` (approved, є в `admins`); **B** = `a4c54305…` (approved, не адмін);
**C** = `56169bf9…` (є в `auth.users`, рядка в `account_status` немає → статус `none`). Окремої DB-ролі «адмін» не існує —
адмін = рядок у `public.admins`, тож рядок «A» і є рядком «адмін».

Легенда: `42501 grant` — `permission denied for table` (немає GRANT); `42501 RLS` — `new row violates row-level security policy`;
`0` — рядки відфільтровані RLS (0 рядків зачеплено); `OWN` — лише власні рядки; `OK(n)` — операція пройшла для n власних рядків;
`23505` — дійшло до унікального ключа (тобто RLS/grant пропустили б власний рядок).

| Таблиця | Роль | SELECT | INSERT own | INSERT other | UPDATE own | UPDATE other | DELETE own | DELETE other |
|---|---|---|---|---|---|---|---|---|
| profiles | anon | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| profiles | A | OWN (1/1/0) | 23505 (PK) | 42501 RLS | OK(1) | 0 | OK(1) | 0 |
| profiles | B | OWN (1/1/0) | 23505 (PK) | 42501 RLS | OK(1) | 0 | OK(1) | 0 |
| profiles | C | 0 рядків | 42501 RLS | 42501 RLS | 0 | 0 | 0 | 0 |
| account_status | anon | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| account_status | A | OWN (1/1/0) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| account_status | B | OWN (1/1/0) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| account_status | C | 0 рядків | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| admins | anon | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| admins | A | OWN (1/1/0) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| admins | B | 0 рядків | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| admins | C | 0 рядків | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| awards | anon | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| awards | A/B/C | 0 рядків (таблиця порожня) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| consent_log | anon | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| consent_log | A | 0 (у A немає записів) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| consent_log | B | OWN (3/3/0) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| consent_log | C | 0 рядків | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| elo_config | anon | 42501 grant | 42501 grant | — | 42501 grant | — | 42501 grant | — |
| elo_config | A | 1 рядок | 42501 grant | — | 42501 grant | — | 42501 grant | — |
| elo_config | B | 1 рядок | 42501 grant | — | 42501 grant | — | 42501 grant | — |
| elo_config | C | 0 рядків (is_approved=false) | 42501 grant | — | 42501 grant | — | 42501 grant | — |
| elo_events | anon | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| elo_events | A | OWN (2/2/0) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| elo_events | B | 0 (у B немає) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| elo_events | C | 0 рядків | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| elo_week_plan | anon/A/B/C | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| season_history | anon | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| season_history | A/B/C | 0 рядків (порожня) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| season_state | anon | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| season_state | A | OWN (1/1/0) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| season_state | B | 0 (у B немає) | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |
| season_state | C | 0 рядків | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant | 42501 grant |

Разом: 4 ролі × 10 таблиць × 7 операцій (для elo_config 4) = **268 клітинок, усі заповнені**. Жодна клітинка не дала доступу
до чужого рядка або запису в таблицю без гранту. Єдина клієнтська поверхня запису — власний рядок `profiles`
(INSERT/UPDATE/DELETE), і лише для `approved`.

> Повторний прогін 2026-09-06 (продовження після обриву): інвентар таблиць/політик/грантів і повна матриця
> (4 ролі × 10 таблиць) виконані заново тим самим скриптом — результат **ідентичний** таблиці вище (268/268).
> Фактичні лічильники (read-only): profiles 2, account_status 2, admins 1, awards 0, consent_log 3, elo_config 1,
> elo_events 2, elo_week_plan 1, season_history 0, season_state 1, auth.users 3.

### 3. Колонкові привілеї та «пряме PATCH-ування» через PostgREST

- `information_schema.column_privileges` для `anon`/`authenticated`/`PUBLIC` мінус табличні гранти → **0 рядків**
  (жодного колонкового гранту; діють лише табличні). Отже через REST можна змінювати лише те, що дозволено
  на рівні таблиці: **тільки `public.profiles`** (INSERT/UPDATE/DELETE для `authenticated`, обмежено RLS до
  свого рядка і `is_approved`).
- Чутливі колонки й хто їх може змінити напряму (перевірено матрицею вище, усі `42501 permission denied`):
  `account_status.status/username/birth_date/decided_by` — ніхто з клієнтських ролей; `admins.*` — ніхто;
  `season_state.elo/grace_used/grace_until/display_name` — ніхто; `elo_events.delta/elo_after` — ніхто;
  `elo_config.data` — ніхто; `elo_week_plan.planned` — ніхто (навіть SELECT); `season_history`, `awards` — ніхто.
- Проба колонок `profiles` від імені B (approved, не адмін), усе в `DO … RAISE EXCEPTION`:

| Дія | Результат |
|---|---|
| `update profiles set user_id = <A>` (захоплення чужого PK) | `42501 new row violates row-level security policy` |
| `update profiles set user_id = gen_random_uuid()` | `42501` RLS |
| `update profiles set created_at='2099-01-01', updated_at='1970-01-01'` | **rows=1** — `created_at` переписано; `updated_at` тригером `profiles_touch_updated_at` повернуто на `now()` |
| `update profiles set data = <1 048 600 байт>` | `23514 violates check constraint "profiles_data_size"` |
| `update profiles set data = '[1,2,3]'` / `'null'` / `'"str"'` | **rows=1** — CHECK на тип jsonb відсутній (див. SEC-003) |
| `update profiles set data = '{"isAdmin":true,"approved":true,"elo":2500,"rating":2500}'` | rows=1, але `is_admin(B)=false`, `is_approved(B)=true` (без змін) — сервер цих полів не читає |

Висновок: колонковий вектор ескалації (`is_admin`, `approved`, `elo`, `rating`) **закритий** — таких колонок у
клієнтських таблицях немає взагалі, а таблиці, де вони є, не мають грантів для клієнтських ролей.

### 4. Функції (36 у `public`)

Зведення (`pg_proc`, `pg_get_functiondef`): усі 36 — власник `postgres`, `SET search_path = public`;
`has_schema_privilege('anon'|'authenticated', 'public', 'CREATE') = false` — тобто підміна обʼєктів у `search_path`
клієнтом неможлива. EXECUTE для `anon` — **у жодної**; для `authenticated` — у 22 (перелік у §1).

Проба кожної функції від імені anon / B (approved, не адмін) / C (без заявки), з чужим `user_id` (A) там, де є
параметр (`DO … RAISE EXCEPTION`, повний вивід у сесії):

| Функція | anon | B (approved) | C (none) | Доступ до чужих даних |
|---|---|---|---|---|
| is_admin(A) / is_admin(self) | 42501 | false / false | false / false | ні — `uid = auth.uid()` у тілі |
| is_approved(A) / is_approved(self) | 42501 | false / true | false / false | ні |
| account_state() | 42501 | own | `{"status":"none"}` | ні |
| admin_requests / admin_decide(A) / admin_decide(self) | 42501 | P0001 FORBIDDEN | FORBIDDEN | ні |
| admin_elo_set(A,2500) / admin_elo_set(self,2500) | 42501 | FORBIDDEN | FORBIDDEN | ні |
| admin_elo_list / admin_elo_anomalies | 42501 | FORBIDDEN | FORBIDDEN | ні |
| elo_state / elo_recent / elo_history | 42501 | own | P0001 NOT_APPROVED | ні |
| elo_leaderboard(5) | 42501 | список (name, elo, rank, me) усіх approved-гравців сезону | NOT_APPROVED | навмисно (§2.1) |
| elo_set_name('<img src=x onerror=1>') | 42501 | OK (void) | NOT_APPROVED | лише свій рядок; див. SEC-005 |
| username_free('x') | 42501 | true | **true** (доступно без заявки) | перебір ніків, див. INFO |
| elo_evaluate_week('2026-08-24') | 42501 | `other_season` | NOT_APPROVED | лише `auth.uid()` |
| elo_close_season('SUMMER-2026') | 42501 | `no_data` | NOT_APPROVED | лише `auth.uid()` |
| elo_activate_grace / elo_catch_up / elo_submit | 42501 | own (`elo_submit` → `no_data`) | NOT_APPROVED | лише `auth.uid()` |
| season_of(date) | 42501 | AUTUMN-2026 | AUTUMN-2026 | чиста функція |
| elo_eval_week_for(A,…) / elo_facts(A,…) / elo_planned_for(A,…) / elo_catch_up_weeks(A,…) / elo_cron_eval_week | 42501 | **42501 permission denied for function** | 42501 | недосяжні клієнту |
| delete_account() | 42501 | `{"deleted":true}` (відкочено) | `{"deleted":true}` (відкочено) | лише себе; усі 9 FK — `ON DELETE CASCADE` |

Валідація входу (з тіл): `register_request` — довжина/регекс ніка, вік 17–120, розмір screening ≤ 8 КіБ, три
обовʼязкові consents, throttle 60 с для `pending`; `elo_submit` — `p_kind` з білого списку, `p_day` у вікні
`submitWindowDays`, `p_payload` **не використовується** (факти беруться з `profiles.data` через `elo_facts`);
`admin_decide` — `p_action` з білого списку, заборона self-decide крім approve; `admin_elo_set` — існування
користувача, кламп 0..seasonMax; `elo_leaderboard(p_limit)` — **без верхньої межі** (`admin_elo_list` і
`elo_recent` клампують до 500/100); `elo_eval_week_for` — понеділок, тиждень минув, той самий сезон.

Атомарність: `elo_submit`, `elo_activate_grace`, `admin_elo_set`, `elo_eval_week_for` беруть `for update` на
`season_state`; `elo_close_season` — без блокування, але `insert … on conflict do nothing` + попередня перевірка
`exists`; повторний паралельний виклик дає ідентичні awards (PK), тож подвійної нагороди немає.

Інші обʼєкти: тригер лише один (`profiles_touch_updated_at`), тригерів на `auth.users` немає; `storage.buckets` — 0;
публікація `supabase_realtime` — без таблиць; `cron.job` — 1 (`forge-elo-week`, `10 0 * * *`,
`select public.elo_cron_eval_week()`, active).

### 5. Адмін

- **Як визначається**: виключно рядком у `public.admins` (`is_admin(uid)` = `uid = auth.uid() and exists(select 1 from admins …)`).
  Жодного JWT-claim, жодної колонки в `profiles`/`account_status`. Клієнт кешує `isAdmin` з `account_state()` у
  `localStorage` (`js/store.js:1092`) лише для UI; кожен admin-RPC перевіряє `is_admin` сам (підтверджено §4: B і C →
  `FORBIDDEN`).
- **Як стати адміном**: INSERT у `admins` мають лише `postgres`/`service_role`; жодна з 36 функцій не пише в `admins`;
  REST-гранту для `authenticated` немає (матриця: `42501 permission denied`). Єдиний шлях — ручний SQL власника.
  У `db/*.sql` цей крок не задокументовано (INFO-3).
- **Що дає адмін**: `admin_requests` (усі заявки з e-mail, датою народження, screening, згодами), `admin_decide`
  (approve/reject/block будь-якого `auth.users.id`, крім self-reject/block), `admin_elo_list` (усі користувачі з e-mail
  та ELO), `admin_elo_set` (ELO будь-кого 0..2500, з записом в `elo_events`), `admin_elo_anomalies`. Адмін **не** може
  читати чужі `profiles.data` (RLS без адмін-винятку — перевірено в матриці рядком A) і не може видалити чужий акаунт.
- **Схвалення без заявки** (`admin_decide(uuid)` для користувача без рядка в `account_status`) відтворено в
  `DO … RAISE EXCEPTION`: рядок створюється зі `status=approved`, `username=null`; наступний `register_request`
  повертає `{"status":"approved"}` **не зберігаючи нік**; `elo_set_name` приймає будь-який рядок і в
  `elo_leaderboard(50)` зʼявилось 2 з 2 рядків з ніком адміна, потім рядок з `<b>x</b>` → SEC-002.
- **Рішення адміна `rejected` не є остаточним**: `register_request` від `rejected` користувача повертає `pending`,
  переписує `status/username/birth_date/screening` і обнуляє `decided_at`/`decided_by` (відтворено) → SEC-001.
  `blocked` — остаточний: `register_request` → `P0001 BLOCKED`, `profiles` → 0 рядків, `elo_state` → `NOT_APPROVED`.

### 6. Auth-конфіг доказово (`query_logs`, `auth_logs`/`auth_audit_logs`, публічний `/auth/v1/settings`)

| Питання | Доказ | Висновок |
|---|---|---|
| Підтвердження пошти | 2026-09-04 12:41:35 `POST /signup` → `user_confirmation_requested`; 12:41:53 `GET /verify` 303 → `user_signedup`; лише потім 12:41:59 `POST /token` `login` (актор `a4c54305`). Те саме для `56169bf9` о 13:11. `/auth/v1/settings`: `"mailer_autoconfirm":false` | **обовʼязкове** |
| Redirect-и (`referer`) | усі `/token`, `/recover` з продакшену мають `referer = https://forge-mold1.vercel.app/` або `…/welcome.html`; реєстрації 04.09 — `referer = http://localhost:3000` (verify-скрипти власника) | у логах немає поля `location`/`redirect_to` — фактичний allow-list **не доведено** (див. «Не перевірено») |
| Rate limit | 2026-09-04 13:11:05 `POST /resend` → `429: For security purposes, you can only request this after 54 seconds`; 11:36:25 `env GOTRUE_RATE_LIMIT_EMAIL_SENT changed, updating Email limiter from 2/1h to 30` | rate limit активний; ліміт листів 30/год (тобто підключено власний SMTP) |
| Підозрілі спроби | за 2026-09-03…06: 2× `400: Invalid login credentials` (04.09 19:05, з продакшену), 1× `400: Invalid Refresh Token`, 1× `GET /rest/v1/profiles` 401 (edge_logs, 24 год). Жодних серій, жодних 429 з чужих IP | чисто |
| Провайдери | `/auth/v1/settings`: лише `email:true`; `anonymous_users:false`; `disable_signup:false`; `passkeys_enabled:false` | signup відкритий для всіх (далі — черга заявок) |
| Advisors (security) | 1 INFO `rls_enabled_no_policy` (`elo_week_plan` — навмисно), 21 WARN `authenticated_security_definer_function_executable` (усі 21 мають guard `auth.uid()`/`is_approved`/`is_admin` — перевірено §4), 1 WARN `auth_leaked_password_protection` вимкнено | → SEC-004 |

Edge-логи за 24 год (усі 200/204, крім одного 401): `GET /rest/v1/profiles` ×213, `POST rpc/elo_state` ×112,
`POST /rest/v1/profiles` ×28, `elo_history` ×9, `/auth/v1/token` ×9, `elo_recent`/`elo_leaderboard`/`elo_set_name` ×3,
`elo_catch_up` ×2, `elo_close_season`/`elo_submit` ×1.

### 7. Що бачить зловмисник з anon key і curl (5 read-only запитів, 2026-09-06)

```text
GET  /auth/v1/settings                       200  {"external":{"email":true,…},"disable_signup":false,"mailer_autoconfirm":false,…}
GET  /rest/v1/profiles?select=user_id        401  {"code":"42501","message":"permission denied for table profiles"}
GET  /rest/v1/elo_week_plan?select=*         401  {"code":"42501","message":"permission denied for table elo_week_plan"}
POST /rest/v1/rpc/season_of {"d":…}          401  {"code":"42501","message":"permission denied for function season_of"}
GET  /rest/v1/  (OpenAPI)                    401  {"message":"Invalid API key","hint":"Only the service_role API key can be used for this endpoint."}
```

Заголовки `https://forge-mold1.vercel.app/` (`curl -sI`): `strict-transport-security: max-age=63072000; includeSubDomains; preload`,
`x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`,
`content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; … connect-src 'self' https://*.supabase.co https://o4511925239676928.ingest.de.sentry.io; … frame-ancestors 'none'`,
`x-robots-tag: noindex, nofollow`, `cache-control: public, max-age=0, must-revalidate` (і для `/js/config.js`).

**Перелік можливостей зловмисника (лише anon key + curl):**

1. Прочитати публічні налаштування Auth (`/auth/v1/settings`) — стандарт GoTrue, не витік.
2. Зареєструвати довільну кількість акаунтів (`/auth/v1/signup`, `disable_signup:false`) у межах rate limit GoTrue;
   акаунт без підтвердження пошти не має сесії, з підтвердженням — має роль `authenticated`, але без рядка
   `account_status` = «C» у матриці: **0 рядків у всіх таблицях, усі ELO/профільні RPC → `NOT_APPROVED`**. Доступні
   лише `account_state`, `username_free`, `register_request`, `season_of`, `is_admin/is_approved` (для себе),
   `delete_account`.
3. Ініціювати листи (`/signup`, `/recover`, `/resend`) на довільні адреси — до 30/год (ліміт SMTP), з троттлінгом 54–60 с
   на адресу (429 підтверджено). Це вектор спаму від імені домену власника, не доступу.
4. Перебирати зайнятість ніків через `username_free` (потрібен будь-який підтверджений акаунт, схвалення не потрібне).
5. **Не може**: читати жодну таблицю (усі 10 → `42501`), викликати жодну функцію (36/36 → `42501`), бачити OpenAPI,
   отримати чужий `user_id`, e-mail, профіль, ELO; змінити `elo`, `status`, `admins`; стати адміном; виконати DDL.

Із **чужим `user_id`** та **власним** approved-акаунтом (B) — усе, що перевірено §2 і §4: 0 чужих рядків через REST, усі
функції з параметром `uid` або відхиляють (`FORBIDDEN`, 42501), або ігнорують параметр на користь `auth.uid()`.

### 8. Відомі проблеми з §2.3 PROMPT.md — статус

| Проблема | Статус | Доказ |
|---|---|---|
| `elo_close_season` привʼязаний до `auth.uid()`, не в cron | **підтверджено, відкрито**. `cron.job` = 1 запис (`forge-elo-week`, `10 0 * * *`, `select public.elo_cron_eval_week()`; запуски 05.09 і 06.09 — `succeeded`). `elo_close_season` викликається лише з клієнта (`js/elo-api.js:235` через `closeSeasonIfDue`, `js/elo-hooks.js:179`). Користувач, який не відкриє сайт після `b.e + submitWindowDays`, не отримає `season_history`/`awards`; `elo_submit` за старий сезон і так блокується `out_of_window`, тож ELO не «тече», але нагороди й статистика сезону не зʼявляться, поки він не зайде. Ризик зростає з часом (нове `season_state` за новий сезон створюється незалежно, тому старий сезон лишається незакритим необмежено). | `pg_get_functiondef(elo_close_season)`, `cron.job`, `cron.job_run_details` |

## Що НЕ перевірено і чому

1. **Redirect allow-list і Site URL Supabase Auth** — у `auth_logs` немає поля `location`/`redirect_to` (перевірено
   `mapKeys(log_attributes)` для `/verify`, `/recover`, `/signup`); проба з явним `redirect_to` вимагає `POST /recover`
   або `/signup` на реальну адресу — це лист і запис в `auth.users`, заборонено §1.2/§1.3. Є лише непрямий доказ:
   `referer` усіх продакшен-запитів = `https://forge-mold1.vercel.app/…`.
2. **Реальний HTTP-виклик RPC від імені `authenticated`** (curl з JWT) — потрібен токен реального користувача;
   заборонено (§1.3). Замінено імперсонацією `set local role authenticated` + `request.jwt.claims` у транзакції з
   відкатом — це той самий шлях, яким PostgREST виконує запит, але не перевіряє шар PostgREST (парсинг заголовків,
   `Prefer`, `Accept-Profile`). Один read-only anon-запит до `/rest/v1/profiles` показав очікуване 401/42501.
3. **Паралельні (race) виклики `elo_submit`/`elo_close_season`** — вимагають двох одночасних сесій у бойовій базі
   (§1.2 забороняє). Перевірено лише статично: `for update` на `season_state` у `elo_submit`, `elo_activate_grace`,
   `admin_elo_set`, `elo_eval_week_for`; `elo_close_season` без `for update`, але з `on conflict do nothing` для
   `season_history` і `awards` (PK), тож подвійна нагорода неможлива за конструкцією.
4. **Supabase branch** для adversarial-сценаріїв — не створювався (платний/дозвіл §1.5).
5. **Роль «адмін» як окрема DB-роль** — не існує; рядок «адмін» матриці = користувач A з рядком у `admins` (RLS для нього
   ідентичне звичайному approved — перевірено).
6. **Vercel deployment protection / Sentry** — поза доменом (rls); не запускалось.
7. **Leaked password protection** — стан узято з `get_advisors`; увімкнення — налаштування панелі (точка зупинки §1.5).

## Знахідки

```text
ID:                 SEC-001
Severity:           LOW
Confidence:         CONFIRMED
Category:           Авторизація на сервері / цілісність рішень адміна
Location:           public.register_request (жива версія; db/security-hardening-2.sql), гілка `found and cur.status = 'rejected'` відсутня
Description:        Користувач зі статусом `rejected` може сам повернути собі `pending`: `register_request` не
                    перевіряє `rejected` (лише `blocked` і `approved`), робить `on conflict do update set status='pending',
                    username=…, birth_date=…, screening=…, requested_at=now(), decided_at=null, decided_by=null`.
Why it matters:     Відмова адміна стирається без сліду (`decided_at`/`decided_by` → null, попередні нік/дата
                    народження/screening перезаписані), заявка знову в черзі. Адмін, який хоче остаточності, мусить
                    знати, що потрібен `block`, а не `reject`; журналу попередніх рішень немає.
Reproduction:       BEGIN-транзакція (DO … RAISE EXCEPTION): `update account_status set status='rejected',
                    decided_by=<A> where user_id=<B>`; `set local role authenticated` + claims sub=<B>;
                    `select register_request('auditnick', '1990-01-01', '{}', <3 consents>)`.
Observed:           `{"status":"pending"}`; `account_state()` → `pending`; повторний виклик через <60 с →
                    `{"status":"pending","throttled":true}`. Для `blocked` — `P0001 BLOCKED`.
Expected:           Або `rejected` теж відсікається (як `blocked`), або повторна заявка зберігає історію рішення
                    (окремий журнал / `note`), і поведінка задокументована в db/account-approval.sql.
Root cause:         Відсутня гілка для `rejected`; upsert перезаписує поля рішення.
Impact:             Ескалації привілеїв немає (`pending` = 0 прав). Втрата аудит-сліду; можливість щохвилини
                    (throttle 60 с) повертати себе в чергу — шум для адміна.
Recommended fix:    Якщо повторна заявка після відмови є навмисною — не обнуляти `decided_*`, а зберігати
                    попереднє рішення (`note` або таблиця `account_decisions`); якщо ні — `if found and cur.status =
                    'rejected' then raise exception 'REJECTED'`. Рішення — за власником (§1.5: змінює видимі правила).
Regression test:    db/multiuser-tests.sql: сценарій rejected → register_request → очікуваний результат
                    (виняток або збережений `decided_by`).
```

```text
ID:                 SEC-002
Severity:           LOW
Confidence:         CONFIRMED
Category:           Авторизація на сервері / валідація входу / підміна ідентичності в лідерборді
Location:           public.admin_decide + public.register_request (гілка `cur.status='approved'` → `return` без запису
                    ніка) + public.elo_set_name (db/nick-length.sql: `left(coalesce(approved, coalesce(p_name,'')),13)`)
Description:        Якщо адмін схвалює `auth.users.id`, у якого немає заявки (`admin_decide(uuid,'approve')` —
                    доступно через curl адміну), рядок `account_status` створюється з `username=null`. Далі
                    `register_request` цього користувача повертає `{"status":"approved"}` і **не зберігає** нік;
                    `elo_set_name(p_name)` для такого користувача записує `p_name` без жодної валідації (регекс ніка
                    з `register_request` не застосовується, унікальність не перевіряється), і саме він показується в
                    `elo_leaderboard` усім та в `admin_elo_list` адміну (`coalesce(ss.display_name, ar.username)`).
Why it matters:     Користувач може взяти нік іншого гравця (в т.ч. адміна) або будь-який рядок до 13 символів;
                    для інших гравців два однакові імена в лідерборді нерозрізнювані. Клієнт екранує (`esc()` у
                    js/season.js:234, js/admin-elo.js:63), тож XSS немає.
Reproduction:       DO … RAISE EXCEPTION: (1) claims sub=<A адмін>: `admin_decide(<C>,'approve')` → `approved`;
                    (2) claims sub=<C>: `register_request('legitnick', …)` → `{"status":"approved"}`,
                    `account_state()` → `username=null`; (3) `elo_activate_grace()` (створює season_state),
                    `elo_set_name(<нік A>)`, `elo_leaderboard(50)`.
Observed:           `leaderboard rows with A nick: 2 (of 2)`; після `elo_set_name('<b>x</b>')` — 1 рядок з `<b>x</b>`.
Expected:           `register_request` для approved без ніка зберігає (валідований, унікальний) нік; `elo_set_name`
                    застосовує той самий регекс/унікальність або взагалі не приймає імʼя, якщо нік є обовʼязковим.
Root cause:         Два незалежні джерела імені (`account_status.username` з валідацією та `season_state.display_name`
                    без неї) і ранній `return` у `register_request`.
Impact:             Передумова — схвалення без заявки (адмін-панель показує лише заявки, тож через UI це малоймовірно,
                    але через curl — один виклик). Обмежено репутацією/плутаниною, не доступом.
Recommended fix:    У `register_request`: якщо `approved` і `username is null` — записати нік після перевірок;
                    у `elo_set_name`: валідація як у `register_request` + перевірка `not exists (lower(username)=lower(p_name))`.
Regression test:    db/multiuser-tests.sql: approve без заявки → register_request → username записано;
                    elo_set_name з чужим ніком → виняток.
```

```text
ID:                 SEC-003
Severity:           LOW
Confidence:         CONFIRMED
Category:           Валідація на сервері / цілісність даних
Location:           public.profiles.data — CHECK лише `octet_length(data::text) <= 1048576` (міграція hardening_size_limits_oracles_view)
Description:        Клієнт (approved, через звичайний PATCH/POST `/rest/v1/profiles`) може записати в `data`
                    не-обʼєкт: масив, `null` (jsonb null), рядок. Також `created_at` доступний на запис.
Why it matters:     Усі серверні читачі (`elo_facts`, `elo_planned_for`, `elo_tracker_value`) використовують `#>`/`->>`,
                    які на не-обʼєкті повертають null → `no_data`/план 3, без винятків (перевірено кодом і тим, що
                    `elo_submit` для B повернув `no_data`). Клієнтський `Object.assign(blankProfile(), data)`
                    (js/store.js:1373) масив «переживе», рядок — по символах. Шкода лише власному профілю.
Reproduction:       DO … RAISE EXCEPTION, claims sub=<B>, `set local role authenticated`:
                    `update profiles set data='[1,2,3]' where user_id=<B>` / `'null'` / `'"str"'`;
                    `update profiles set created_at='2099-01-01' where user_id=<B>`.
Observed:           усі → `rows1` (успіх). `updated_at` тригер повертає на now(); 1 048 600 байт → `23514`.
Expected:           `check (jsonb_typeof(data) = 'object')`; `created_at` без UPDATE-гранту або колонковий grant
                    `update (data)` для `authenticated`.
Root cause:         Відсутній CHECK на тип; табличний UPDATE-грант на всі колонки.
Impact:             Самопошкодження профілю (відновлюється export/import або повторним записом); серверна економіка
                    стійка. Для чужих рядків неможливо (RLS).
Recommended fix:    Міграція: `alter table profiles add constraint profiles_data_object check (jsonb_typeof(data)='object')`;
                    `revoke update on profiles from authenticated; grant update (data) on profiles to authenticated`.
Regression test:    SQL-проба в db/multiuser-tests.sql: запис масиву → 23514; update created_at → 42501.
```

```text
ID:                 SEC-004
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Латентна експозиція / процес міграцій
Location:           pg_default_acl схеми public (власники postgres і supabase_admin); db/*.sql — жодного
                    `alter default privileges`
Description:        Default privileges схеми `public`: нові таблиці → `anon`/`authenticated`/`service_role` =
                    `arwdDxtm` (усе), нові функції → `EXECUTE` для `anon` і `authenticated`, нові sequence → `rwU`.
                    Кожен новий обʼєкт народжується повністю відкритим через PostgREST, доки міграція явно не зробить
                    `revoke`; у репозиторії безпека тримається на 16 ручних `revoke` в окремих файлах
                    (`grep -n revoke db/*.sql`), а `db/elo-engine.sql:499` `revoke execute on all functions … from anon`
                    діє лише на обʼєкти, що існували на момент виконання.
Why it matters:     Одна майбутня функція `security definer` без рядка `revoke … from anon, authenticated` (наприклад,
                    внутрішня, з параметром `uid`) миттєво стає `/rest/v1/rpc/<name>` для anon. Advisor
                    `authenticated_security_definer_function_executable` уже дає 21 WARN, тож нове попередження
                    загубиться в шумі. Сьогодні всі 36 функцій і 10 таблиць закриті правильно (перевірено), тобто
                    знахідка про **наступну** міграцію, а не про поточний стан.
Reproduction:       (a) `select defaclnamespace::regnamespace, defaclobjtype, defaclacl from pg_default_acl where
                    defaclnamespace='public'::regnamespace;`
                    (b) DO … RAISE EXCEPTION (відкат гарантовано): `create function public.__audit_probe_fn() … security
                    definer`; `create table public.__audit_probe_tbl(id int)`; `has_function_privilege('anon',…)`,
                    `has_table_privilege('anon',…,'select'|'insert')`, `relrowsecurity`.
Observed:           (a) `r`: `{…,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,…}` (і те саме від supabase_admin);
                    `f`: `{…,anon=X/postgres,authenticated=X/postgres,…}`; `S`: `anon=rwU…`.
                    (b) `anon EXECUTE on new fn: true`, `authenticated EXECUTE on new fn: true`,
                    `anon SELECT on new tbl: true`, `anon INSERT on new tbl: true`, `new tbl RLS enabled: false`.
Expected:           `alter default privileges for role postgres in schema public revoke all on tables from anon,
                    authenticated; … revoke execute on functions from anon, authenticated; … revoke all on sequences …`
                    + правило в db/README або ci-hygiene: кожна нова функція має явний grant лише потрібній ролі.
Root cause:         Дефолт Supabase-проєкту («усе відкрите, закривай RLS-ом»), не змінений під модель «усе закрите,
                    відкривай явно», якої фактично дотримується проєкт.
Impact:             Нуль сьогодні; висока ціна помилки завтра (одна забута команда = публічна SECURITY DEFINER).
Recommended fix:    Міграція з `alter default privileges` для ролей `postgres` і `supabase_admin` у схемі `public`
                    (tables, sequences, functions) + перевірка в `tools/ci-hygiene.mjs`, що кожен `create function`
                    у db/*.sql супроводжується `revoke`/`grant`. Точка зупинки §1.5 — це не зміна правил для
                    користувачів, але змінює поведінку майбутніх міграцій; узгодити з власником.
Regression test:    SQL: у транзакції `create function public.__audit_probe() returns int language sql as 'select 1';
                    select has_function_privilege('anon','public.__audit_probe()','execute')` → має бути false; rollback.
```

```text
ID:                 SEC-005
Severity:           LOW
Confidence:         ENVIRONMENTAL
Category:           Auth-конфіг поза репозиторієм
Location:           Supabase Auth → Password security (панель), advisor `auth_leaked_password_protection`
Description:        Перевірка паролів за HaveIBeenPwned вимкнена; єдиний провайдер — email+пароль, signup відкритий.
Why it matters:     Скомпрометовані паролі приймаються; для акаунта адміна це єдиний фактор (MFA/passkeys вимкнені —
                    `passkeys_enabled:false`).
Reproduction:       `get_advisors(type=security)` → `auth_leaked_password_protection` WARN; `GET /auth/v1/settings`.
Observed:           `"Leaked password protection is currently disabled."`
Expected:           Увімкнено (безкоштовно на всіх тарифах) + для адміна — довгий пароль/MFA.
Root cause:         Дефолт проєкту.
Impact:             Підбір/credential stuffing проти адміна обмежений лише rate limit GoTrue.
Recommended fix:    Увімкнути в панелі (точка зупинки §1.5 — налаштування Supabase; потрібне «так» власника).
Regression test:    Повторний `get_advisors` без цього WARN.
```

## Спостереження (INFO)

- **INFO-1. Дрейф репозиторію ↔ база** (9 функцій лише в базі, 2 з іншим тілом) — уже зафіксовано агентом
  inventory як INV-001; тут лише підтверджено (md5 після нормалізації, `/tmp/audit-rls/cmp2.mjs`). Для домену
  безпеки важливо: жива `elo_state` має guard `NOT_APPROVED`, якого немає в `db/elo-engine.sql` — відновлення схеми з
  репозиторію відкрило б `elo_state` для не-approved.
- **INFO-2. `elo_leaderboard(p_limit)` без верхньої межі й без обробки null**: `p_limit=2147483647` повертає всіх
  гравців сезону (обмежено `statement_timeout=8s` ролі `authenticator`), `p_limit=null` → лише власний рядок
  (`x.r <= null` = null). Клієнт завжди шле 50 (js/elo-api.js:261). Інші пагіновані функції клампують (`admin_elo_list`
  ≤500, `admin_requests` ≤500, `elo_recent` ≤100).
- **INFO-3. Призначення адміна не задокументоване** в db/*.sql (лише коментар «вирішує база»); операційно — ручний
  `insert into public.admins` через SQL Editor. Зафіксувати в README/runbook, щоб втрата єдиного адміна (`delete_account`
  захищає лише останнього) не стала блокером.
- **INFO-4. `elo_config` — FORCE RLS off**: неістотно, бо власник `postgres` має `bypassrls=true`, а клієнтські ролі
  мають лише SELECT з політикою `is_approved`. `postgres` у цьому проєкті — `super=false bypassrls=true createrole=true`.
- **INFO-5. `search_path = public` без `pg_catalog`/`pg_temp`**: для SECURITY DEFINER це прийнятно, бо `CREATE` у
  `public` для `anon`/`authenticated` = false (перевірено), а `pg_temp` Postgres завжди ставить у кінець для
  функцій із `SET search_path`.
- **INFO-6. `username_free` доступна будь-якому підтвердженому акаунту без заявки** — перебір зайнятості ніків
  (13 символів, регекс). Навмисно для форми реєстрації; rate limit — лише PostgREST/Supabase за замовчуванням.
- **INFO-7. CSP `script-src 'self' 'unsafe-inline'` та `connect-src https://*.supabase.co`** (wildcard на всі проєкти
  Supabase) — домен XSS/заголовків; згадано для повноти, тут не оцінюється.
- **INFO-8. `GET /rest/v1/profiles` ×213 за 24 год від одного активного користувача** (~9/год) — інтенсивність
  синхронізації; домен sync.
- **INFO-9. `elo_planned_for` бере план тижня з `profiles.data` (`activePlan.days`/`daysPerWeek`, кламп 3..7)** —
  користувач керує власним «планом», від якого залежить штраф за пропуски; домен ELO-економіки (інший агент), тут
  лише зафіксовано, що серверна перевірка авторизації при цьому не порушена (лише свій рядок).
- **INFO-10. Реєстрації 04.09 з `referer=http://localhost:3000`** — це verify-скрипти власника проти бойового Auth
  (§1.2 тепер забороняє); користувачі `a4c54305` і `56169bf9` — тестові.
- **INFO-11. Advisor: 21 WARN «SECURITY DEFINER доступний authenticated»** — для цієї архітектури (RPC як єдина
  поверхня запису) це очікувано; кожна з 21 функцій має guard (таблиця §4). Не знахідка, але шум, що ховатиме
  справжній пропуск (див. SEC-004).
