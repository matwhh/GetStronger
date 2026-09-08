# Аудит Phase A — домен «db»: схема, міграції, обмеження, cron, advisors

Дата: 2026-09-06. Агент: db. Режим: тільки читання (SELECT / `DO $$ … RAISE EXCEPTION $$`).
Репозиторій: `/root/work/forgesite`, гілка `master`, HEAD `964429b` (2026-09-05).
Проєкт Supabase: `sojbyoxcxyiollefupss`.

> Це другий прогін домену (перший обірвано лімітом). Кожне твердження попереднього прогону
> переперевірено власними запитами; числа, які розійшлись, виправлено (див. DB-011).
> Додано чотири нові знахідки (DB-013 … DB-016) і посилено DB-006 і DB-010.

## Обсяг і метод

- Прочитано всі 19 файлів `db/*.sql` (3844 рядки) і `db/elo-config.json` (187 рядків).
- Жива схема — лише SELECT: `supabase_migrations.schema_migrations` (29 міграцій, повні тіла
  `statements`), `information_schema.tables/columns`, `pg_constraint`, `pg_indexes`, `pg_policies`,
  `pg_class` (RLS/FORCE/ACL), `pg_proc` (36 функцій: `prosrc`, `proconfig`, `prosecdef`, `proacl`),
  `pg_trigger`, `pg_roles`, `cron.job`, `cron.job_run_details`.
- 18 читальних запитів + 2 мутуючі проби, кожна у `DO`-блоці, що завершується `RAISE EXCEPTION`
  (відкат гарантований; після проб перевірено `count(*)` пробних рядків = 0 і незмінність
  загальних лічильників усіх 10 таблиць).
- `get_advisors` (security і performance), `list_migrations`, `list_triggers`.
- Приватність: лише скорочені `user_id` (перші 8 символів), жодних e-mail/ніків.
- Перетини з іншими доменами (INV-*, ELO-*, SEC-*) позначені явно; повторно не відкриваю.

## Що перевірено

| Перевірка | Обсяг / результат |
|---|---|
| Структура живої схеми | 10 таблиць, 66 колонок, 36 функцій, 17 індексів, 12 RLS-політик, 11 CHECK, 9 FK, 10 PK (таблиць без PK немає), 1 тригер. |
| Дрейф репозиторій → база | 19 файлів `db/` проти 29 міграцій. У `db/` лише **4** `create table` (profiles, account_status, admins, elo_week_plan) і **27** унікальних імен функцій. У живій базі — 10 таблиць і 36 функцій → DB-001. |
| Дрейф база → міграції (нова перевірка) | Точний тест: чи зустрічається тіло живої функції дослівно в `array_to_string(statements)` хоч якоїсь міграції. **31 з 36 — так, 5 — ні**: `admin_elo_list`, `elo_activate_grace`, `elo_history`, `elo_recent`, `elo_state` → DB-013. |
| «Є в репозиторії, але не застосовано» | Не знайдено: кожен DDL/DML-оператор з `db/*.sql` (крім тестових `*-tests.sql`, `sim-week.sql`, `backup-export.sql`) має відповідник у живій базі. |
| Обʼєкти поза `apply_migration` | `admin_elo_list` — 0 згадок у міграціях; `cron.schedule` — 0; `elo_events_category_check` — 0 (див. DB-010, DB-013). |
| Nullable / defaults | 66 колонок. Nullable за змістом: `account_status.username/birth_date/decided_at/decided_by/note`, `season_state.today_date/grace_until/display_name`, `season_history.rank/of_users/percentile/days_active/days_total` — усі виправдані (grandfather-акаунти, percentile лише при ≥ `minUsersForPercentile`). Небезпечних defaults немає: усі `now()`, `0`, `'{}'::jsonb`, `'pending'`, `false`. |
| CHECK на бізнес-межі | 11 CHECK: `status` (4 значення), `category` (8), `event_type` (9), `document` (3), `elo 0..2500`, `grace_used 0..2`, `planned 3..7`, `username 3..13`, `profiles.data ≤ 1 MB`, `screening ≤ 8 KB`, `elo_config.id = 1`. **Відсутні** на `elo_events.delta/quality/elo_after/day` і на `season_history.final_elo/level/rank/percentile` → DB-006. |
| UNIQUE для ідемпотентності | `elo_events(user_id, action_key)`; частковий `elo_events_identity(user_id, event_type, day) where event_type <> 'admin'`; частковий `account_status_username_key(lower(username)) where username is not null`; PK `(user_id, season)` у season_state/season_history; `(user_id, season, kind)` в awards; `(user_id, week_start)` в elo_week_plan. `consent_log` — без UNIQUE → DB-014. |
| FK і ON DELETE | 9 FK, усі → `auth.users(id) ON DELETE CASCADE`. Проба (відкат): видалення користувача зносить рядки з усіх таблиць — сиріт 0. `account_status.decided_by` — **без FK** → DB-004. |
| Сироти й аномалії (SELECT count) | 18 перевірок одним запитом: profiles без auth 0; account_status без auth 0; season_state/elo_events не-approved 0; approved без профілю 0; `day > current_date + 1` 0; `elo_after` поза 0..2500 0; `quality` поза 0..1 0; `season <> season_of(day)` 0; `created_at::date < day` 0; `today_date > current_date` 0; `display_name` без відповідного username 0; `week_start` не понеділок 0; `final_elo` поза межами 0; `decided_by` висячий 0. Ненульові: `approved` з `birth_date is null` = 1 (grandfather), `decided_at is not null and decided_by is null` = 1 (той самий рядок). |
| Обсяг даних | users 3 / profiles 2 / account_status 2 / admins 1 / season_state 1 / elo_events 2 / consent_log 3 / elo_week_plan 1 / season_history 0 / awards 0. |
| Індекси | 17. Предикати RLS (`user_id`) покриті PK або індексом у всіх 10 таблицях. Гарячі запити: `elo_leaderboard`/`elo_state` (rank) → `season_state_season_elo_idx`; денна стеля й `elo_week_room` → `elo_events_user_season(user_id, season, day)`; адмінка → `account_status_status_requested_idx`; нік → `account_status_username_key`. |
| Грант-матриця | `anon` — жодного гранта на таблицю чи функцію. `authenticated`: `profiles` = arwd (прямий CRUD), решта 8 таблиць = лише `r`, `elo_week_plan` = нічого. 36/36 функцій мають явний ACL (жодної з дефолтним PUBLIC); 22 з них видані `authenticated`, з них 21 — `SECURITY DEFINER` (звідси рівно 21 попередження advisor). |
| RLS | Увімкнено на всіх 10 таблицях. `FORCE` — на 9; `elo_config` без `FORCE` → DB-016. `postgres` має `rolbypassrls = true`, тому `FORCE` для SECURITY DEFINER-коду декоративний. |
| search_path | 36/36 функцій мають `SET search_path = public`. |
| Тригери | 1: `profiles_touch_updated_at` (BEFORE UPDATE, security invoker, тіло — `new.updated_at := now(); return new;`). Побічних ефектів немає. Тригерів на `auth.users` у схемі `public` немає. |
| Атомарність | Прочитано живі тіла 20 функцій. Усі RPC — одна транзакція PostgREST; нарахування під `SELECT … FOR UPDATE season_state`. Проблемні: `elo_eval_week_for` (exists до lock → DB-012), `elo_submit`/`elo_try_clean_day`/`elo_eval_week_for` (зріз стану без зрізу журналу → DB-006), компенсаційний «відкат» у `elo_submit` (не точний → DB-006c). `elo_cron_eval_week` ізолює користувачів субтранзакціями. |
| Cron | `cron.job`: 1 завдання `forge-elo-week`, `10 0 * * *`, active, `select public.elo_cron_eval_week()`. `job_run_details`: 2 запуски (2026-09-05 00:10 — 76 мс, 2026-09-06 00:10 — 5,7 мс), обидва `succeeded`, `return_message = '1 row'` → DB-002. Закриття сезону в cron немає → DB-008. |
| Advisors | security: 21 × WARN `authenticated_security_definer_function_executable`, 1 × WARN `auth_leaked_password_protection`, 1 × INFO `rls_enabled_no_policy` (**усього 23**); performance: 1 × WARN `auth_rls_initplan`, 1 × INFO `unused_index`. Класифікація — DB-011. |
| Файли міграцій | Порядок, ідемпотентність, деструктивні оператори — DB-007. Деструктивні в `db/`: `drop table site_files`, `drop view leaderboard`, `alter … drop constraint if exists` (5×), `delete from` лише всередині тестових DO-блоків, що завершуються `raise exception`. `TRUNCATE`, `DELETE` без WHERE, `ALTER … TYPE` з втратою даних — немає. |

## Що НЕ перевірено і чому

- **Повторний прогін `db/elo-engine.sql` на бойовій базі** (DB-007) — не виконувався навіть у
  транзакції: `create or replace function` бере ексклюзивний lock на бойові `elo_submit`/
  `elo_action_delta`. Висновок зроблено з тексту файла й порівняння з живим тілом. Потрібен
  Supabase branch або локальний Postgres.
- **Гонка `elo_eval_week_for`** (DB-012) — потрібні дві одночасні сесії; `execute_sql` дає одну.
  Підтверджено лише порядок операторів у живому `prosrc`.
- **Зріз штрафом до нуля** (DB-006b) — не відтворений: `elo_eval_week_for` сьогодні (2026-09-06)
  недосяжний для жодного тижня (поточний тиждень — `week_not_over`, попередній — `other_season`,
  бо 2026-08-30 ∈ SUMMER-2026). Відтворено інший бік того самого дефекту — зріз стелею
  `seasonMax` (DB-006a, CONFIRMED).
- **Відновлення з бекапу** (A11) — поза доменом; але див. DB-001/DB-009/DB-013: бекап містить
  лише дані, а DDL немає ні в `db/`, ні (для 5 функцій) у міграціях.
- **Задача заявок `trig_01RqLZD26Li8dg69AZmAooCA`** (відома проблема §2.3) — у `list_triggers`
  такої задачі немає (є лише 3: контрольна копія аудиту, нагадування про PAT, щоденний бекап).
  Причину FAILED знайти неможливо: задачі не існує, логів немає.
- **Навантажувальні характеристики індексів** — у базі 2 події й 3 користувачі; жодних висновків
  про плани на масштабі, лише структура. `pg_stat_statements` не аналізувався з тієї ж причини.
- **`query_logs`** — не використовувався: cron пише не в postgres_logs, а в `job_run_details`,
  і за 24 год немає жодного прогону, крім уже прочитаних.

---

## Знахідки

### DB-001 — DDL 6 таблиць і 9 функцій існує лише в `supabase_migrations`, у `db/` його немає (= INV-001)

```text
ID:                 DB-001
Severity:           HIGH
Confidence:         CONFIRMED
Category:           drift / відновлюваність схеми
Location:           db/ (відсутні файли); міграції elo_seasonal (20260827170445), elo_history_fn,
                    elo_recent_fn, account_approval, consents_and_deletion, elo_cron_eval_week
Description:        У репозиторії немає `create table` для public.elo_config, season_state, elo_events,
                    season_history, awards, consent_log і тіл season_of(), elo_history(), elo_recent(),
                    delete_account(), admin_requests(), admin_decide(), username_free(), account_state(),
                    elo_cron_eval_week(). db/cron.sql містить лише планування, а не функцію, яку планує;
                    db/account-approval.sql прямо каже «повні тіла див. у міграції».
Why it matters:     db/ — єдина копія схеми поза бойовою базою; db/backup-export.sql експортує ЛИШЕ дані
                    (перевірено текст задачі бекапу: 11 таблиць у jsonb, жодного DDL). Відновити базу
                    «з нуля» за репозиторієм неможливо: db/elo-engine.sql падає на першому `insert into
                    elo_config`, решта — на season_state. Перевірка відновлення (A11) без цього беззмістовна.
Reproduction:       grep -c "create table" db/*.sql            # → 4 у 4 файлах
                    SQL: select count(*) from information_schema.tables where table_schema='public';  # → 10
                    grep -o "create or replace function public\.[a-z_]*" db/*.sql | sort -u | wc -l    # → 27
                    SQL: select count(*) from pg_proc where pronamespace='public'::regnamespace;       # → 36
Observed:           10 таблиць / 36 функцій у базі; 4 таблиці / 27 функцій описані в db/.
Expected:           Кожен обʼєкт живої схеми має джерело в репозиторії.
Root cause:         Міграції застосовували через apply_migration з інлайн-SQL, файл у db/ додавали не завжди.
Impact:             Втрата проєкту Supabase = втрата схеми; branch/локальний Postgres з репозиторію не піднімається.
Recommended fix:    Експортувати тіла з supabase_migrations.schema_migrations у db/migrations/<version>_<name>.sql
                    (1:1 з базою) + перевірка в tools/ci-hygiene.mjs, що список файлів = списку міграцій.
Regression test:    Скрипт звірки (version, name) у базі зі списком файлів db/migrations/ — падає при розходженні.
Статус перетину:    = INV-001; тут незалежне підтвердження запитами до schema_migrations.
```

### DB-013 — П'ять живих функцій не відтворюються з міграцій; у чотирьох guard `NOT_APPROVED` існує ЛИШЕ в бойовій базі

```text
ID:                 DB-013
Severity:           HIGH
Confidence:         CONFIRMED
Category:           drift / регресія безпеки при відновленні
Location:           public.elo_state(), public.elo_activate_grace(), public.elo_history(),
                    public.elo_recent(integer), public.admin_elo_list(integer);
                    міграції elo_engine (20260827171306), elo_history_fn (20260827171448),
                    elo_recent_fn (20260827171902); db/elo-engine.sql:301,336
Description:        Точний тест дрейфу: тіло живої функції шукається дослівно серед тіл усіх 29 міграцій.
                    31 з 36 функцій знайдено, 5 — ні.
                    · admin_elo_list — жодна міграція навіть не згадує імені (є лише в db/admin-elo.sql:300).
                    · elo_state, elo_activate_grace — востаннє ОЗНАЧЕНІ міграцією elo_engine (27.08);
                      elo_history, elo_recent — міграціями elo_history_fn / elo_recent_fn (27.08).
                      Пізніше їх замінили поза apply_migration: живі тіла містять
                      `if not public.is_approved(uid) then raise exception 'NOT_APPROVED'`,
                      якого в жодній міграції немає (міграція security_lockdown_rpc_and_view лише
                      робить revoke, не перевизначає).
                    · У db/ теж немає версій із guard: єдиний elo_state/elo_activate_grace у репозиторії —
                      db/elo-engine.sql, і там `grep -n "is_approved" db/elo-engine.sql` дає лише коментар
                      у рядку 367. elo_history/elo_recent у db/ відсутні взагалі (DB-001).
Why it matters:     Барʼєр «непідтверджений акаунт не бачить ELO» для чотирьох RPC не існує НІДЕ, крім
                    живої бази. Відновлення схеми з міграцій (supabase db push, branch, новий проєкт)
                    або прогін db/elo-engine.sql поверне версії БЕЗ guard: будь-який зареєстрований,
                    але не схвалений користувач зможе читати elo_state/elo_history/elo_recent і
                    витрачати grace-тижні. Це мовчазна регресія безпеки під час аварійного відновлення —
                    саме тоді, коли ніхто не переглядає код.
Reproduction:       SQL (точний тест):
                      with allm as (select string_agg(array_to_string(statements,E'\n'),E'\n') txt
                                    from supabase_migrations.schema_migrations)
                      select proname, case when position(prosrc in (select txt from allm))>0
                             then 'in-migration' else 'NOT IN ANY MIGRATION' end
                      from pg_proc where pronamespace='public'::regnamespace order by 2 desc;
                    → 5 рядків «NOT IN ANY MIGRATION».
                    SQL: select prosrc from pg_proc where proname='elo_state';   → містить NOT_APPROVED
                    SQL: select count(*) from supabase_migrations.schema_migrations
                         where array_to_string(statements,E'\n') like '%replace function public.elo_state%';
                         → 1 (elo_engine, 27.08, без NOT_APPROVED)
                    shell: grep -n "is_approved\|NOT_APPROVED" db/elo-engine.sql   → лише рядок 367 (коментар)
Observed:           5 функцій не відтворюються з міграцій; 4 з них у будь-якому відновленому середовищі
                    втратять перевірку схвалення; admin_elo_list зникне повністю (адмінка ELO не працюватиме).
Expected:           Кожне тіло живої функції збігається з тілом останньої міграції, що її означує (§1.1
                    «Зміни схеми — лише міграціями»).
Root cause:         Guard додавали правкою в SQL Editor, а не міграцією; файл у db/ не оновили.
Impact:             Прихована регресія авторизації при відновленні/клонуванні бази; неповна адмінка.
Recommended fix:    Міграція-«фіксація», що `create or replace` усі 5 функцій рівно тими тілами, які зараз
                    у бойовій базі (взяти з pg_get_functiondef), і паралельно оновити файли в db/.
Regression test:    Той самий SQL-тест «prosrc ⊂ statements» як частина ci-hygiene (через збережений
                    знімок) або як SQL-перевірка перед релізом: 0 рядків «NOT IN ANY MIGRATION».
```

### DB-006 — Стан ELO зрізається межами, а журнал `elo_events` записує незрізану дельту: `sum(delta) ≠ season_state.elo`

```text
ID:                 DB-006
Severity:           MEDIUM
Confidence:         CONFIRMED (стеля seasonMax — відтворено) / PROBABLE (підлога 0 і компенсаційний відкат)
Category:           цілісність даних / журнал ELO
Location:           public.elo_submit — `update season_state set elo = least((cfg->>'seasonMax')::int,
                    greatest(0, elo + d))` і слідом `insert into elo_events (… delta …) values (… d …)`;
                    те саме в public.elo_try_clean_day і public.elo_eval_week_for
                    (db/elo-integrity.sql:245-256); компенсаційний відкат у elo_submit
                    `update season_state set elo = least(seasonMax, greatest(0, elo - d))`;
                    таблиця public.elo_events (delta, quality, elo_after, day — жодного CHECK)
Description:        (a) СТЕЛЯ. Стан зрізається до seasonMax, у журнал іде повна дельта.
                    (b) ПІДЛОГА. Симетрично: при штрафі нижче 0 стан стає 0, у журнал іде повний
                        відʼємний delta (той самий вираз `greatest(0, …)`).
                    (c) ВІДКАТ. Якщо `insert … on conflict do nothing` не вставив рядок, elo_submit
                        компенсує `elo - d` під тими самими межами. Якщо перше оновлення зрізалось,
                        компенсація НЕ повертає початкове значення: 2495 → least(2500, 2504) = 2500 →
                        відкат least(2500, greatest(0, 2500-9)) = 2491, тобто мінус 4 з нічого.
                        `today_delta` при цьому зменшується без обмеження й може стати відʼємним.
                    (d) Немає CHECK: quality 0..1, elo_after 0..2500, delta в межах dayGainCap/dayLossFloor,
                        day <= created_at::date + 1. Єдина точка запису — SECURITY DEFINER-функції, тож
                        дані сьогодні чисті (перевірено: 0 порушень), але захист лише кодом.
Why it matters:     «Кожна зміна ELO — транзакція в elo_events» (коментар міграції elo_seasonal) перестає
                    бути правдою. admin_elo_anomalies, звіт сезону (biggestGain/biggestLoss у
                    elo_close_season), відновлення стану з журналу й будь-яка звірка journal↔state дають
                    фантомні числа. Розбіжність накопичується й незворотна.
Reproduction:       Мутуюча проба у DO-блоці з RAISE EXCEPTION (відкат гарантований), 2026-09-06:
                      insert into auth.users(...) values (u, ...);
                      insert into account_status(user_id,status,username) values (u,'approved','dbprobea');
                      insert into profiles(user_id,data) values (u, {'trackers':{'sleep':{'goal':480}},
                        'trackerLog':{'sleep':{'2026-09-06':480}}, 'activePlan':{'days':4}});
                      insert into season_state(user_id,season,elo) values (u,'AUTUMN-2026',2498);
                      set local role authenticated; -- request.jwt.claims.sub = u
                      select elo_submit('sleep','sleep:2026-09-06', current_date, '{}');
                      select elo from season_state ...; select sum(delta) from elo_events ...;
Observed:           submit → {"ok": true, "elo": 2500, "delta": 5, "today": 5, "quality": 1.000}
                    season_state.elo = 2500 ; event.delta = 5 ; event.elo_after = 2500
                    ЖУРНАЛ 2498 + sum(delta) = 2503   СТАН season_state.elo = 2500   → розбіжність 3
                    Крім того `today` = 5, хоча фактично сьогодні набрано 2.
Expected:           У elo_events записується фактично застосована дельта: `st.elo(after) − st.elo(before)`.
Root cause:         Дельта обчислюється до оновлення й пишеться в журнал незалежно від зрізу.
Impact:             Незворотна розбіжність журналу і стану в кожного, хто дійде до 2500 або до 0;
                    хибні цифри в звіті сезону та в адмінському детекторі аномалій.
Recommended fix:    В усіх трьох місцях писати в elo_events `st.elo` до і після (або одразу різницю):
                    зберегти `old_elo`, після update — `delta = st.elo - old_elo`. Компенсаційний відкат
                    у elo_submit замінити на відновлення збереженого `old_elo`. Додати
                    CHECK (quality between 0 and 1) і CHECK (elo_after between 0 and 2500).
Regression test:    SQL-тест у db/elo-integrity-tests.sql: користувач з elo = seasonMax−2 подає дію на +5 →
                    після виклику `sum(delta) = elo − початковий elo`; окремо користувач з elo = 3 і
                    штрафом −32 → те саме. Обидва падають на поточному коді.
```

### DB-007 — `db/*.sql` — нашарування версій без порядку застосування; повторний прогін `db/elo-engine.sql` повертає довіру до клієнтського payload

```text
ID:                 DB-007
Severity:           HIGH
Confidence:         PROBABLE (текст файлів і живих тіл підтверджено; прогін на бойовій базі навмисно не виконувався)
Category:           міграції / ідемпотентність / операційний ризик
Location:           db/elo-engine.sql:34-93 (elo_action_delta з payload), :94-183 (elo_submit:
                    `p_action_key` як ідентичність, без is_approved, без elo_facts), :406+ (elo_close_season
                    без season_bounds); db/schema.sql:1-3 («Виконати один раз … Run»), :86 (посилання на
                    is_approved, якого schema.sql не створює); db/account-approval.sql:43-53
Description:        1) ELO-функції означені по 2–4 рази в різних файлах через `create or replace`:
                       elo_submit — 4 рази (elo-engine, elo-authoritative, elo-integrity, admin-elo),
                       elo_try_clean_day — 3, elo_action_delta — 3, elo_eval_week_for — 2, elo_set_name — 3.
                       Порядок застосування ніде не зафіксований повністю. Повторний прогін
                       db/elo-engine.sql (файл починається з «ЄДИНА точка запису — elo_submit()», без
                       попередження «не запускати повторно») замінить бойові функції старими версіями:
                       дельта рахуватиметься з p_payload (вразливість, закрита міграцією
                       elo_authoritative_facts), зникнуть guard NOT_APPROVED, тижневий бюджет,
                       серверна ідентичність події, перевірка season_bounds.
                    2) db/schema.sql на порожній базі падає: політики посилаються на is_approved(),
                       який створює account-approval.sql.
                    3) db/account-approval.sql не ідемпотентний: 2 × `create policy` без
                       `drop policy if exists` → 42710 при повторному прогоні (у db/schema.sql і
                       db/security-hardening.sql drop є, тут — ні).
Why it matters:     Документована процедура («SQL Editor → вставити файл → Run») уже одного разу знімала
                    барʼєр (коментар у db/schema.sql:74-78). Той самий сценарій з elo-engine.sql — відкат
                    усіх виправлень економіки ELO за один клік, без сліду в міграціях.
Reproduction:       shell: grep -c "p_payload" db/elo-engine.sql      # → 2 (передається в elo_action_delta)
                           grep -c "elo_facts" db/elo-engine.sql      # → 0
                           grep -n "is_approved" db/elo-engine.sql    # → лише коментар у рядку 367
                           sed -n '126,131p' db/elo-engine.sql        # → ідентичність за p_action_key
                    SQL: select prosrc from pg_proc where proname='elo_submit';
                         → живе тіло: `if not public.is_approved(uid) …`, `facts := public.elo_facts(...)`,
                           `skey := p_kind || ':' || p_day` (p_action_key не використовується взагалі).
                    Перевірка ідемпотентності: for f in db/*.sql; порівняти кількість `create policy`
                    і `drop policy` → account-approval.sql: create=2 drop=0.
Observed:           Жива база = останні версії; репозиторій містить і старі, і нові тіла без маркера «застаріло».
Expected:           Один упорядкований набір міграцій (DB-001) або явні заголовки «HISTORY — не виконувати».
Root cause:         db/ ведеться як журнал правок, а не як відтворюваний набір міграцій.
Impact:             Один необережний прогін — регресія безпеки ELO (HIGH за §6: експлуатована бізнес-вада).
Recommended fix:    Разом із DB-001/DB-013: db/*.sql → db/history/ (read-only, із заголовком-попередженням),
                    згенерувати db/migrations/ з бази, у README описати єдиний спосіб застосування.
Regression test:    tools/ci-hygiene.mjs: жоден файл поза db/migrations/ не містить
                    `create or replace function public.elo_submit` без заголовка «HISTORY».
Статус перетину:    INV-002 — окремий прояв тієї самої причини.
```

### DB-003 — Заблокований акаунт може викликати `delete_account()` і стерти власний блок

```text
ID:                 DB-003
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           функції БД / обхід адмін-рішення
Location:           public.delete_account() (міграція consents_and_deletion; у db/ тіла немає — DB-001);
                    account_status_user_id_fkey … ON DELETE CASCADE
Description:        Живе тіло delete_account() — 386 символів, повний текст перевірок: `auth.uid() is null`
                    → AUTH_REQUIRED; `is_admin(uid) and count(admins)=1` → LAST_ADMIN; далі
                    `delete from auth.users where id = uid`. Рядок account_status зі status='blocked'
                    зноситься каскадом. Той самий e-mail реєструється знову й подає нову заявку як
                    «чистий» pending; звільняється й заблокований нік (account_status_username_key).
Why it matters:     Блок — єдиний інструмент адміна проти зловживань; він має переживати дії самого
                    користувача. Нова заявка приходить адмінові без жодної ознаки, що це вже блокований акаунт.
                    Для порівняння: register_request блокованого відхиляє (`raise exception 'BLOCKED'`) —
                    тобто правило існує, але обходиться видаленням акаунта.
Reproduction:       DO-блок з RAISE EXCEPTION (відкат гарантований), виконано 2026-09-06:
                      insert into auth.users (a=адмін, b=жертва);
                      insert into admins(a); insert into account_status(a,'approved');
                      set local role authenticated (sub=a); select admin_decide(b,'block');
                      set local role authenticated (sub=b); select delete_account();
                      select count(*) from account_status where user_id=b;
Observed:           1) admin_decide(block) -> {"status":"blocked","userId":"…db12"} ; status=blocked
                    2) delete_account() ВІД ЗАБЛОКОВАНОГО -> {"deleted": true}  (ПРОЙШЛО, винятку немає)
                       лишилось: account_status(blocked)=0 , auth.users=0
Expected:           Для status='blocked' — виняток BLOCKED (або видалення auth-акаунта зі збереженням
                    запису блокування).
Root cause:         Функція не читає account_status.status.
Impact:             Обхід блокування повторною реєстрацією; адмін мусить розпізнавати повторні заявки вручну.
Recommended fix:    У delete_account(): `if exists (select 1 from account_status where user_id=uid
                    and status='blocked') then raise exception 'BLOCKED'; end if;`
                    Правило видиме користувачам → §1.5, узгодити з власником.
Regression test:    db/multiuser-tests.sql: blocked → delete_account() = виняток BLOCKED; approved → deleted.
```

### DB-012 — `elo_eval_week_for`: exists-перевірка стоїть до `FOR UPDATE`; гонку може ініціювати сам користувач

```text
ID:                 DB-012
Severity:           MEDIUM
Confidence:         PROBABLE (порядок операторів у живому prosrc підтверджено; гонка не відтворювалась — одна сесія)
Category:           атомарність / конкурентність
Location:           public.elo_eval_week_for — послідовність: `if exists (… event_type='week' … ) return
                    duplicate` → `insert into season_state … on conflict do nothing` → `select … for update`
                    → `update season_state` → `insert into elo_events … on conflict do nothing`;
                    db/elo-integrity.sql:215-221. Точки входу: cron (elo_cron_eval_week, 00:10 UTC),
                    elo_submit → elo_catch_up_weeks, elo_catch_up(), і **elo_evaluate_week(p_week_start)**.
Description:        Дедуплікація тижня спирається на `exists`, зроблений ДО взяття блокування. Два виклики
                    для одного (uid, week) обидва бачать exists = false; другий, дочекавшись lock, повторно
                    застосовує d до season_state, а вставка події гаситься `on conflict do nothing`.
                    Результат: подвійний штраф/бонус у стані й ОДНА подія в журналі.
                    Посилення проти попереднього прогону: `elo_evaluate_week(p_week_start date)` —
                    SECURITY DEFINER, `grant execute … to authenticated`, приймає ДОВІЛЬНУ дату тижня.
                    Тобто вікно гонки не рідкісний збіг з cron, а щось, що будь-який схвалений користувач
                    може відкривати сам, коли завгодно, паралельними HTTP-запитами до /rest/v1/rpc/
                    elo_evaluate_week (клієнтська економіка → §A3).
Why it matters:     Ще один шлях розбіжності журнал↔стан (поряд із DB-006), цього разу з подвоєнням.
                    Для бонусного тижня це подвоєний бонус.
Reproduction:       Дві сесії (потрібен branch або два psql):
                      S1: begin; select elo_submit('sleep', …);            -- тримає lock season_state
                      S2: begin; select elo_evaluate_week('<минулий понеділок>');
                      commit S1; commit S2;
                      → season_state.elo змінено на 2·d, подій event_type='week' — 1.
                    Підтверджене читанням: select prosrc from pg_proc where proname='elo_eval_week_for';
                    та select proacl from pg_proc where proname='elo_evaluate_week';
                      → authenticated=X/postgres
Observed:           Живе тіло: `if exists (…)` стоїть перед `select … for update` (як у db/elo-integrity.sql).
Expected:           Lock → exists → нарахування (як зроблено в elo_submit після виправлення M2).
Root cause:         Порядок операторів.
Impact:             Рідкісна, але незворотна розбіжність; за навмисної експлуатації — подвоєння бонусу.
Recommended fix:    Перенести exists-перевірку ПІСЛЯ `select … for update`; вставку події робити ДО
                    update season_state і перевіряти `returning id` (як зроблено в elo_submit).
Regression test:    Тест на два зʼєднання у branch (pg_background/dblink у проєкті недоступні).
Статус перетину:    = ELO-004; тут додано доказ, що вхід у гонку відкритий клієнту.
```

### DB-002 — pg_cron не зберігає результат `elo_cron_eval_week`: провали всередині функції невидимі

```text
ID:                 DB-002
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           cron / спостережуваність
Location:           cron.job jobid=1 'forge-elo-week', command `select public.elo_cron_eval_week()`;
                    public.elo_cron_eval_week(p_weeks_back integer default 4) — блок
                    `exception when others then n_err := n_err + 1; errs := errs || sqlerrm`;
                    db/cron.sql:22-23 (коментар «return_message = наш jsonb» — хибний)
Description:        Функція ловить помилку кожного користувача окремо, рахує n_err і повертає jsonb
                    {'ok': false, 'failed': N, 'reasons': [...]}, але pg_cron у job_run_details записує
                    лише return_message = '1 row' і status = 'succeeded'. Уміст jsonb не зберігається ніде.
Why it matters:     Якщо elo_eval_week_for почне падати для частини користувачів (напр. нечислове
                    `activePlan.days` → 22P02 у `(data #>> '{activePlan,days}')::int` всередині
                    elo_planned_for, або 23514 на season_state_elo_check), тижні лишаться неоціненими,
                    а cron виглядатиме здоровим. Це і є «тиха деградація економіки».
Reproduction:       select runid, status, return_message, start_time, end_time-start_time
                    from cron.job_run_details order by start_time desc;
Observed:           runid 2: 2026-09-06 00:10:00.194+00 succeeded '1 row' 5,7 мс
                    runid 1: 2026-09-05 00:10:00.222+00 succeeded '1 row' 76,5 мс
                    (обидва прогони — 0 придатних тижнів, див. INFO про межу сезону)
Expected:           Результат прогону зберігається; провал видно як status='failed' або рядок у журналі.
Root cause:         Команда завдання — SELECT функції; pg_cron не зберігає результати SELECT.
Impact:             Тиха втрата штрафів/бонусів тижня без сигналу; неможливо відповісти «чи виконався cron насправді».
Recommended fix:    Таблиця public.cron_log(run_at, job, result jsonb) без грантів клієнту, запис із функції;
                    або команда `do $$ declare r jsonb; begin r := public.elo_cron_eval_week();
                    insert into cron_log …; if (r->>'failed')::int > 0 then raise exception '%', r; end if; end $$`.
Regression test:    SQL-тест у BEGIN…ROLLBACK: виклик → рядок у cron_log; штучний виняток у elo_eval_week_for
                    → status='failed' у job_run_details (перевіряється в branch).
```

### DB-008 — [відома проблема §2.3] `elo_close_season` привʼязаний до `auth.uid()`, у cron його немає — підтверджено

```text
ID:                 DB-008
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           cron / закриття сезону
Location:           cron.job (1 рядок — лише forge-elo-week); public.elo_close_season(p_season)
                    — `uid uuid := auth.uid()`; db/cron.sql:29-34
Description:        Підтверджено: у cron.job одне завдання. elo_close_season вимагає сесію користувача
                    і пише season_history/awards ЛИШЕ для викликача (`insert into season_history …
                    values (uid, …)`, 14 × `insert into awards values (uid, …)`).
Why it matters:     Після 2026-12-02 (кінець AUTUMN-2026 = 2026-11-30 + submitWindowDays 2) історію сезону
                    й нагороди отримають лише ті, хто відкриє застосунок. Хто не повернувся — без
                    season_history назавжди (elo_history() поверне порожній масив). Ранг і percentile
                    рахуються на момент виклику, але після вікна подання season_state незмінний, тож
                    числа стабільні — доставка, а не коректність.
Reproduction:       select jobname, command from cron.job;                        → forge-elo-week
                    select prosrc from pg_proc where proname='elo_close_season';  → `uid uuid := auth.uid()`
Observed:           Як описано у §2.3; дедлайн 2026-12-03 дійсний.
Expected:           elo_close_season_for(uid, season) + cron-обгортка по всіх season_state сезону
                    в перший день після b.e + submitWindowDays.
Root cause:         Функцію ще не розділено (задокументовано в db/cron.sql).
Impact:             Неповна доставка результатів сезону; залежність від активності користувача.
Recommended fix:    Зробити до 2026-11-25; разом із межею сезону (див. INFO нижче).
Regression test:    Симуляція в branch: сезон завершено, жоден користувач не заходив → season_history для всіх.
```

### DB-009 — [відома проблема §2.3] Щоденний бекап: останній запуск FAILED, сповіщення вимкнені, DDL не бекапиться

```text
ID:                 DB-009
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           операційна готовність / бекап
Location:           scheduled task trig_01CNsyKoU1nVWETfN5DsiTGV «Forge: щоденна резервна копія бази»,
                    cron 0 1 * * *; db/backup-export.sql
Description:        list_triggers: last_run.status = ROUTINE_RUN_STATUS_FAILED, fired 2026-09-06T01:04:35Z,
                    finished 01:04:43Z (8,7 с — падіння до або на початку роботи).
                    notifications: {push: false, email: false} — про провал ніхто не дізнається.
                    Задача пише файл на Mac через device_commit_files, тобто залежить від підключеного
                    компʼютера. Текст задачі експортує 11 наборів даних у jsonb — DDL немає, а взяти
                    його нізвідки (DB-001, DB-013).
Why it matters:     Free-план Supabase без автобекапів: сьогодні єдина копія даних — production.
                    Навіть якби файл писався щодня, відновити з нього базу неможливо без схеми.
Reproduction:       mcp__claude-code-remote__list_triggers → trig_01CNsyKoU1nVWETfN5DsiTGV.last_run
Observed:           FAILED 2026-09-06T01:04:35Z; next_run 2026-09-07T01:04Z; push=false, email=false.
Expected:           Успішний щоденний файл + увімкнені сповіщення про провал + DDL поруч із даними.
Root cause:         Залежність від локального пристрою; сповіщення вимкнені.
Impact:             Немає відновлюваного бекапу.
Recommended fix:    Увімкнути notifications; зберігати копію незалежно від Mac; додати до експорту
                    вивантаження db/migrations (DB-001, DB-013).
Regression test:    Перевірка відновлення (A11) у branch із файла бекапу + db/migrations.
```

### DB-010 — Три обʼєкти бойової схеми створені поза `apply_migration`: історія міграцій неповна

```text
ID:                 DB-010
Severity:           LOW
Confidence:         CONFIRMED
Category:           міграції / повнота історії
Location:           CHECK elo_events_category_check (розширений значенням 'admin'); cron.job 'forge-elo-week';
                    public.admin_elo_list(integer) (див. також DB-013);
                    db/admin-elo.sql:4 («Виконувати в Supabase SQL Editor ОДИН раз»);
                    db/cron.sql:5 («Застосовано міграцією elo_cron_eval_week»)
Description:        Пошук по тілах усіх 29 міграцій: 'admin_elo_list' — 0 збігів, 'cron.schedule' — 0,
                    'category_check' — 0. Твердження db/cron.sql, що розклад «застосовано міграцією»,
                    хибне: міграція elo_cron_eval_week створює функцію, але не викликає cron.schedule.
Why it matters:     supabase_migrations не відтворює бойову базу: branch чи новий проєкт піднімуться
                    без cron-завдання (тижні ніколи не оцінюватимуться) і без значення 'admin' у
                    category_check (admin_elo_set падатиме на 23514).
Reproduction:       select 'admin_elo_list' n, count(*) from supabase_migrations.schema_migrations
                      where array_to_string(statements,E'\n') like '%admin_elo_list%'
                    union all select 'cron.schedule', count(*) … like '%cron.schedule%'
                    union all select 'category_check', count(*) … like '%category_check%';
Observed:           0 / 0 / 0 — при тому, що всі три обʼєкти в базі є.
Expected:           Кожна зміна схеми — міграцією (§1.1).
Root cause:         SQL Editor замість apply_migration.
Impact:             Branch/відновлення без cron і без розширеного CHECK; порушено власне правило §1.1.
Recommended fix:    Міграція-«фіксація» разом із DB-013: `alter table elo_events drop constraint if exists
                    elo_events_category_check; alter … add constraint …;` та ідемпотентний
                    `select cron.schedule('forge-elo-week', '10 0 * * *', 'select public.elo_cron_eval_week()')`.
Regression test:    Скрипт звірки pg_proc / pg_constraint / cron.job ↔ statements міграцій.
```

### DB-004 — `account_status.decided_by` без FK: після видалення адміна лишається висячий uuid

```text
ID:                 DB-004
Severity:           LOW
Confidence:         CONFIRMED
Category:           схема / referential integrity
Location:           public.account_status.decided_by uuid (db/account-approval.sql:36; міграція account_approval)
Description:        decided_by заповнює admin_decide(), але колонка не має FK. У pg_constraint для
                    account_status є лише account_status_user_id_fkey.
Why it matters:     Аудит рішень («хто схвалив») після ротації адмінів показує неіснуючий id; неможливо
                    відрізнити «видалений адмін» від «сміття».
Reproduction:       DO-блок з RAISE EXCEPTION (відкат), виконано 2026-09-06:
                      admin a вирішує заявку b (decided_by = a); delete from auth.users where id = a;
                      select count(*) from account_status where decided_by = a;
Observed:           3) після delete адміна: auth.users(a)=0 , рядків account_status з decided_by=a: 1
Expected:           FK decided_by → auth.users(id) ON DELETE SET NULL.
Root cause:         Колонка додана без обмеження.
Impact:             Лише аудит-слід; функціональних наслідків немає (жоден код decided_by не читає).
Recommended fix:    alter table account_status add constraint account_status_decided_by_fkey
                    foreign key (decided_by) references auth.users(id) on delete set null;
Regression test:    Той самий DO-блок → decided_by is null після видалення адміна.
```

### DB-005 — Межі CHECK зашиті числами і дублюють `elo_config` (seasonMax = 2500, graceWeeksPerSeason = 2)

```text
ID:                 DB-005
Severity:           LOW
Confidence:         CONFIRMED
Category:           схема / дубльовані константи
Location:           season_state_elo_check CHECK ((elo >= 0) AND (elo <= 2500));
                    season_state_grace_used_check CHECK ((grace_used >= 0) AND (grace_used <= 2));
                    elo_config.data.seasonMax = 2500, graceWeeksPerSeason = 2;
                    db/elo-authoritative.sql:43 («баланс міняється одним UPDATE, без міграції»)
Description:        Коментарі стверджують, що баланс змінюється одним UPDATE elo_config. Але дві межі
                    продубльовано у CHECK. UPDATE seasonMax → 3000 або graceWeeksPerSeason → 3 не дасть
                    помилки сам по собі, а вилізе пізніше як 23514 всередині elo_submit / elo_activate_grace
                    (500 клієнту, вічний ретрай у черзі).
Why it matters:     Розбіжність між «джерелом правди» і фізичним обмеженням; помилка проявиться не в момент зміни.
Reproduction:       select conname, pg_get_constraintdef(oid) from pg_constraint
                    where conname in ('season_state_elo_check','season_state_grace_used_check');
                    select data->>'seasonMax', data->>'graceWeeksPerSeason' from elo_config;
Observed:           CHECK 0..2500 / 0..2  =  конфіг 2500 / 2 — сьогодні збігаються.
Expected:           Або CHECK як єдина межа (і коментар про UPDATE-без-міграції прибрати), або CHECK
                    ширший за будь-який реалістичний конфіг із приміткою.
Root cause:         Межі задані двічі під час міграції elo_seasonal.
Impact:             Ризик при першій же зміні балансу вгору.
Recommended fix:    Задокументувати в db/elo-config.json: «seasonMax ≤ 2500, graceWeeksPerSeason ≤ 2 —
                    межі CHECK; вище — тільки міграцією». Або перевірка в ci-hygiene: значення json ≤ CHECK.
Regression test:    ci-hygiene: читає db/elo-config.json і падає, якщо seasonMax > 2500 або
                    graceWeeksPerSeason > 2.
```

### DB-014 — `register_request`: перевірка ніка й дедуп згод — «перевір, потім встав» без блокування

```text
ID:                 DB-014
Severity:           LOW
Confidence:         CONFIRMED (структура коду; гонка не відтворювалась — одна сесія)
Category:           конкурентність / ідемпотентність / обробка помилок
Location:           public.register_request(p_username, p_birth, p_screening, p_consents) —
                    `if exists (select 1 from account_status where lower(username)=lower(uname)
                    and user_id <> uid) then raise exception 'USERNAME_TAKEN'` перед
                    `insert … on conflict (user_id) do update`; далі `insert into consent_log …
                    where not exists (…)`; public.consent_log (без UNIQUE)
Description:        (a) Нік. Перевірка зайнятості й вставка — два різні оператори без блокування.
                    Два паралельні register_request з тим самим ніком: обидва проходять exists,
                    один падає на унікальному індексі account_status_username_key з 23505
                    unique_violation. Клієнт отримує сирий текст Postgres замість USERNAME_TAKEN —
                    js/ порівнює саме рядок помилки, тож повідомлення користувачеві буде технічним.
                    Цілісність при цьому НЕ страждає (індекс тримає), тому severity LOW.
                    (b) Згоди. consent_log не має UNIQUE(user_id, document, version); дедуп зроблено
                    анти-джойном `not exists` у тому ж операторі. У межах одного оператора це
                    коректно, між паралельними транзакціями — ні: два виклики створять дублікати
                    доказів згоди. Сьогодні дублікатів 0 (3 рядки на 1 користувача).
Why it matters:     Юридичний журнал згод має бути точним; повідомлення «нік зайнятий» — зрозумілим.
                    Обидва шляхи відкриті: register_request доступний будь-якому authenticated.
Reproduction:       select prosrc from pg_proc where proname='register_request';
                      → `if exists (… lower(username) = lower(uname) …) then raise exception 'USERNAME_TAKEN'`
                        і нижче `insert into account_status … on conflict (user_id) do update`
                    select conname, contype from pg_constraint
                    where conrelid='public.consent_log'::regclass;   → лише pkey, fkey, document_check
                    select count(*) from (select user_id, document, version, count(*) c
                      from consent_log group by 1,2,3 having count(*)>1) d;   → 0 (поки що)
Observed:           Немає UNIQUE на consent_log; USERNAME_TAKEN не гарантований при гонці.
Expected:           `insert … on conflict on constraint account_status_username_key` з перетворенням
                    unique_violation на USERNAME_TAKEN; UNIQUE(user_id, document, version) на consent_log.
Root cause:         Шаблон «check-then-act» замість опори на обмеження бази.
Impact:             Технічне повідомлення про помилку замість людського; можливі дублікати доказів згоди.
Recommended fix:    (a) обгорнути insert у `exception when unique_violation then raise exception
                    'USERNAME_TAKEN'`; (b) `create unique index consent_log_uniq on consent_log
                    (user_id, document, version)` + `on conflict do nothing`.
Regression test:    db/multiuser-tests.sql: повторний register_request з тими самими згодами →
                    count(consent_log) незмінний; вставка дубля вручну → unique_violation.
```

### DB-015 — `elo_close_season` вставляє в `awards` позиційно, без списку колонок

```text
ID:                 DB-015
Severity:           LOW
Confidence:         CONFIRMED
Category:           супроводжуваність / крихкість схеми
Location:           public.elo_close_season(p_season) — 14 операторів вигляду
                    `insert into awards values (uid, p_season, 'level5', 'Season Badge') on conflict do nothing;`
                    (kinds: level5, level7, level8, level9, level10, elite, first, top3, top10, top100,
                    top1000, top10pct, top5pct, top1pct)
Description:        Жоден із 14 insert не називає колонок. Сьогодні порядок (user_id, season, kind, label,
                    earned_at) збігається з очікуваним. Будь-яке `alter table awards add column` (крім як
                    у кінець зі значенням за замовчуванням) або зміна порядку колонок при відтворенні
                    схеми зламає всі 14 одразу — і зламає їх у момент закриття сезону, тобто один раз
                    на три місяці, коли перевіряти вже пізно.
                    Додатково: awards не має CHECK на `kind`, тож помилковий рядок нічим не відсічеться.
Why it matters:     Закриття сезону — операція, яка виконується рідко і не покрита автотестом на живій
                    схемі. Тиха несумісність тут коштує цілого сезону нагород.
Reproduction:       select prosrc from pg_proc where proname='elo_close_season';
                      → grep 'insert into awards values' → 14 збігів, жодного списку колонок
                    select column_name, ordinal_position from information_schema.columns
                    where table_name='awards' order by 2;   → user_id, season, kind, label, earned_at
Observed:           14 позиційних insert; CHECK на kind відсутній.
Expected:           `insert into awards (user_id, season, kind, label) values (…)`.
Root cause:         Скорочений синтаксис у первинній міграції elo_seasonal.
Impact:             Латентна поломка закриття сезону при будь-якій зміні таблиці awards.
Recommended fix:    Переписати 14 операторів зі списком колонок; додати CHECK на дозволений набір kind
                    (або окрему довідкову таблицю).
Regression test:    SQL-тест у branch: додати колонку в awards посередині → elo_close_season має
                    працювати (на поточному коді впаде).
```

### DB-016 — `elo_config` — єдина таблиця без `FORCE ROW LEVEL SECURITY`

```text
ID:                 DB-016
Severity:           LOW
Confidence:         CONFIRMED
Category:           схема / консистентність захисту
Location:           public.elo_config (relrowsecurity = true, relforcerowsecurity = false);
                    db/security-hardening.sql:17-25 (drop/create policy elo_config_read без alter … force)
Description:        Дев'ять таблиць мають і ENABLE, і FORCE RLS; elo_config — лише ENABLE. Практичного
                    наслідку сьогодні немає: власник таблиці (postgres) має rolbypassrls = true, тому
                    FORCE для нього нічого не змінює, а authenticated має лише SELECT під політикою
                    elo_config_read. Це розходження у зразку захисту, а не діра: якщо колись зʼявиться
                    роль-власник без BYPASSRLS (типовий сценарій при відновленні в інший проєкт або
                    при переході на окремого owner-роля), elo_config стане єдиною таблицею, де RLS
                    не діятиме для власника.
Why it matters:     Конфіг ELO — джерело правди балансу; несиметричний захист непомітний доти, доки
                    не змінилося оточення.
Reproduction:       select relname, relrowsecurity, relforcerowsecurity from pg_class
                    where relnamespace='public'::regnamespace and relkind='r' order by 1;
                    → elo_config: true / false ; решта 9: true / true
                    select rolname, rolbypassrls from pg_roles where rolname='postgres';  → true
Observed:           1 таблиця з 10 без FORCE.
Expected:           Однаковий режим на всіх таблицях або явний коментар, чому elo_config — виняток.
Root cause:         db/security-hardening.sql міняє лише політику, alter … force не додавали.
Impact:             Латентна невідповідність; сьогодні нульова.
Recommended fix:    `alter table public.elo_config force row level security;` у міграції-фіксації (DB-013).
Regression test:    SQL-перевірка в ci-скрипті: 0 рядків із relrowsecurity and not relforcerowsecurity.
```

### DB-011 — Advisors: класифікація всіх 25 попереджень

```text
ID:                 DB-011
Severity:           INFO
Confidence:         CONFIRMED
Category:           advisors
Location:           get_advisors(security) і get_advisors(performance), знімок 2026-09-06T11:21Z
Description:
  SECURITY — 23 записи (у попередньому прогоні було вказано 24 і «22×»; фактично 21 + 1 + 1).
  · 21 × WARN authenticated_security_definer_function_executable:
      account_state, admin_decide, admin_elo_anomalies, admin_elo_list, admin_elo_set, admin_requests,
      delete_account, elo_activate_grace, elo_catch_up, elo_close_season, elo_evaluate_week, elo_history,
      elo_leaderboard, elo_recent, elo_set_name, elo_state, elo_submit, is_admin, is_approved,
      register_request, username_free.
      (22-га функція з грантом для authenticated — season_of(date) — не SECURITY DEFINER, тому
       в списку advisor її немає.)
      Класифікація: ПРИЙНЯТИЙ ДИЗАЙН (§2.1: фронтенд говорить із Supabase напряму, RPC — єдина точка
      запису). У кожній перевірено внутрішній guard у prosrc: auth.uid() + is_approved/is_admin.
      Винятки за змістом: delete_account (DB-003 — guard не покриває blocked) і elo_evaluate_week
      (DB-012 — приймає довільну дату й відкриває вікно гонки).
  · 1 × INFO rls_enabled_no_policy public.elo_week_plan — НАВМИСНО (§1.1 «elo_week_plan клієнту не
      відкривати»): revoke all + force RLS без політик, доступ лише SECURITY DEFINER-коду. Не знахідка.
  · 1 × WARN auth_leaked_password_protection — ВІДКРИТО; закривається лише в панелі Supabase
      (§1.5, = SEC-005). Не закривається з репозиторію.
  PERFORMANCE — 2 записи.
  · 1 × WARN auth_rls_initplan, політика elo_config_read: `(select is_approved(auth.uid()))`. Зовнішній
      select уже дає InitPlan; лінтер реагує на auth.uid() усередині аргументу. Таблиця з 1 рядка.
      Класифікація: шум лінтера, LOW. Переписати як `(select is_approved((select auth.uid())))` — за бажанням.
  · 1 × INFO unused_index account_status_status_requested_idx — у таблиці 2 рядки, планувальник обирає
      seqscan. Індекс потрібен адмінці (p_status + requested_at desc + limit/offset у admin_requests).
      Класифікація: залишити, не знахідка.
Recommended fix:    Жодних дій, крім DB-003, DB-012 і SEC-005.
```

---

## Спостереження (INFO)

- **Межа сезону з'їдає останній тиждень.** `elo_cron_eval_week` пропускає тиждень умовою
  `continue when season_of(wk + 6) <> season_of(today)`, а `elo_eval_week_for` — умовою
  `if szn <> season_of(current_date) then return 'other_season'`. На 2026-09-06 це видно наочно:
  поточний тиждень 31.08–06.09 — `week_not_over`, попередній 24.08–30.08 — `other_season`
  (30.08 ∈ SUMMER-2026). Тобто останній тиждень кожного сезону не оцінюється НІКОЛИ, і саме тому
  обидва прогони cron відпрацювали за 6–76 мс без роботи. Це той самий дефект, який домен ELO веде
  як ELO-005; тут — незалежне підтвердження з живого коду й з `job_run_details`.
- **`elo_week_room` не фільтрує за сезоном:** `where user_id = uid and delta > 0 and category <> 'admin'
  and day between date_trunc('week', p_day) and +6`. На тижні, що перетинає межу сезону (31.08–06.09),
  тижневий бюджет рахує події обох сезонів. Ймовірно навмисно (бюджет — календарний тиждень), але
  ніде не задокументовано.
- **`elo_planned_for` матеріалізує план заднім числом:** якщо рядка в `elo_week_plan` немає, він
  бере `activePlan.days` з ПОТОЧНОГО профілю й вставляє його як план того тижня. Тобто тиждень,
  оцінений із запізненням, судиться за планом, який діє сьогодні, а не тоді. Крім того,
  `(data #>> '{activePlan,days}')::int` кине 22P02 на нечисловому значенні — у cron це з'їсть
  `exception when others` (DB-002), у `elo_submit` завалить увесь RPC.
- **`admin_decide('approve')` створює рядок approved для акаунта без заявки** — з `username = null`,
  `birth_date = null` і без жодного рядка в consent_log. Побічно підтверджено пробою DB-003:
  `admin_decide(b,'block')` створив account_status для користувача, який ніколи не подавав заявки.
  Обхід анкети й вікових воріт руками адміна; навмисність не задокументована.
- **`admin_elo_list` повертає `u.email` кожного користувача** (не лише адмінських). Гранти правильні
  (лише is_admin), але це найширший канал PII в системі; варто зафіксувати рішення явно.
- **Grandfather-акаунт** `3ed0794f`: approved із `birth_date is null`, `decided_at` заповнено,
  `decided_by is null`, 0 рядків consent_log (міграція account_approval лишила наявні профілі
  approved). Формально користувач без зафіксованих згод і віку. Юридична частина — A11.
- **Користувач без заявки** `56169bf9`: auth-акаунт від 2026-09-04, без account_status і profiles.
  `is_approved` → false, доступу немає (правильно). Політики видалення таких «порожніх» акаунтів
  немає — при масовій реєстрації накопичуватимуться (A11: термін зберігання).
- **`consent_log` видаляється каскадом разом з auth.users** (delete_account). Доказ згоди зникає
  одночасно з акаунтом — узгодити з юридичним підходом (право на забуття vs доказ згоди).
- **Ідентифікатор `elo_events.id`**: `last_value` послідовності значно випереджає 2 наявні рядки —
  тестові скрипти (`db/*-tests.sql`, `sim-week.sql`) споживають identity навіть при відкаті. Норма
  Postgres, але видно, що вони виконуються на бойовій базі. Не проблема, поки id не лічильник.
- **Тестові SQL-скрипти** (`elo-tests.sql`, `multiuser-tests.sql`, `elo-integrity-tests.sql`,
  `sim-week.sql`) — усі чотири завершуються `raise exception`, відкат гарантований (перевірено
  `tail -6` кожного). Усі вставляють у `auth.users` напряму, тобто потребують ролі postgres.
- **`db/backup-export.sql`** — єдиний файл у `db/`, який НЕ завершується виключенням, бо це чистий
  SELECT. Безпечний.
- **cron.timezone = GMT, TimeZone = UTC**: «день» у базі — UTC; 00:10 UTC = 03:10 Києва. Клієнт шле
  локальну дату, вікно ±1 день покриває зсув. Межові випадки — домен «час/дата».
- **`elo_config` мертві ключі** `dayLossFloor`, `openMealPenalty`, `leaderboardTops`, `leaderboardRanks`
  — у SQL не читаються (= INV-007).
- **`account_status` seq_scan ≫ idx_scan**: `is_approved()` у кожній RLS-політиці робить `exists` по
  таблиці з 2 рядків; планувальник обирає seqscan. На сотнях рядків перейде на PK. Не дія.
- **Задача `trig_01RqLZD26Li8dg69AZmAooCA`** (§2.3, «щоденна задача заявок — FAILED») у списку задач
  акаунта відсутня: `list_triggers` повертає рівно 3 задачі. Перевірити неможливо.
