# Аудит Phase A — домен «Інвентар, архітектурна мапа, підтримуваність» (INV)

Дата: 2026-09-05. Репозиторій `/root/work/forgesite`, гілка `master`, HEAD `964429b`.
Режим: тільки читання; жодних змін у файлах репозиторію, крім цього звіту.
Другий прогін (перший обірвався після розділів 1–3): усі числа першого прогону
перевірено повторно; виправлення позначено «(випр.)».

## 1. Обсяг і метод

- Розділи A1 і A13 `docs/audit/2026-09/PROMPT.md`.
- Метод: `git ls-files`, `grep`/`rg` по вихідних текстах, `node --test`,
  `node tools/ci-hygiene.mjs`, порівняння `db/*.sql` зі списком застосованих
  міграцій (`list_migrations`, `supabase_migrations.schema_migrations.statements`)
  і з живими тілами функцій (`pg_proc.prosrc`, md5 після нормалізації пробілів і
  зняття `--` / `/* */` коментарів), `pg_policies`, `pg_constraint`, `list_tables`;
  звірка README.md / RELEASE.md / tools/README-verify.md з кодом; відтворення
  клієнтської логіки в `node:vm`-пісочниці (без бойового бекенду); чисті
  SQL-функції (`immutable`) — SELECT-ами в бойовій базі без запису.
- Стандарт доказу: CONFIRMED — лише відтворене командою або запитом (вивід
  цитовано); решта — PROBABLE/POSSIBLE.
- Тимчасові скрипти: `/tmp/audit-inventory/` (extract-bodies.mjs, dump-body.mjs,
  nc-compare.mjs, cfg-compare.mjs, hooks-resubmit.mjs, hooks-retry-loop.mjs).

## 2. Що перевірено

### 2.1 Інвентар репозиторію (git ls-files: 2515 файлів)

| Категорія | Кількість | Примітка |
|---|---|---|
| HTML-сторінки | **22** (випр., було 23) | 20 повноцінних + `today.html` (редирект на index) + `legal.html` (без JS-модулів) |
| JS `js/*-core.js` (чиста логіка) | 18 | adherence, age, bmi, day, elo, exercise, history, measure, nutrition, onboarding, onerm, password, periodization, progress, reps, season, tracker, workout |
| JS дані | 6 | `boxing-data`, `programs-data`, `recipes-data`, `exercises`, `foods`, `supplements` |
| JS DOM/інтеграція | 28 | решта `js/*.js`; разом 52 файли, 27 269 рядків |
| CSS | 1 | `css/style.css`, 3 877 рядків |
| SQL у `db/` | 19 + `elo-config.json` | 14 «міграційних»/довідкових файлів, 4 тестові (`*-tests.sql`, `sim-week.sql`), 1 експорт (`backup-export.sql`) |
| Тести `tests/*.test.js` | 24 + `helpers.js` | 483 тести, 125 suites (2.4) |
| `tools/` (без `sim90/`) | **58** файлів (випр., було 55) | **36** `verify*.mjs` (випр., було 38), 7 `.command`, `auto-publish.sh`, `ci-browser.sh`, `ci-offline.sh`, `ci-hygiene.mjs`, `pw.mjs`, `adult.mjs`, `dob.mjs`, `og.mjs`, `shot.mjs`, `simelo.mjs`, `build-meta.js`, `README-verify.md`, 3 шрифти `fonts/*.woff2` |
| `tools/sim90/` | 15 + `out/**` | скрипти симуляції, README, REPORT, `discovery.json` |
| `tools/sim90/out/**` | **2290** | вихід симуляції: 10 профілів Chromium (leveldb, sqlite, LOCK/LOG), логи, чекпоінти — 91 % усіх файлів у git (INV-005) |
| Workflows | 1 | `.github/workflows/ci.yml` |
| Конфіги | 6 | `vercel.json`, `manifest.webmanifest`, `sw.js`, `.vercelignore`, `.gitignore`, `package.json` |
| Статика | 21 | `icons/*` (5 + 10 рівнів), `favicon.*`, `logo-mark.svg`, `og-image.png`, `robots.txt` |
| Документація | 8 | README.md (3161 рядків), RELEASE.md (182), tools/README-verify.md, tools/sim90/README.md, tools/sim90/REPORT.md, docs/audit/2026-09/{PROMPT,README}.md |

Розходження з §2.1 PROMPT.md: жодного по суті (vanilla ES-модулі без бандлера,
без runtime-залежностей — `package.json` без `dependencies`; Playwright не в
`devDependencies`; lock-файл у `.gitignore`; `sw.js` власний). Єдина
невідповідність духу «статичний сайт без збірки» — 2290 бінарних артефактів
симуляції в git (INV-005).

### 2.2 Мапа: сторінка → модулі → ключі сховища → таблиці/RPC Supabase

Спільний «хребет» кожної сторінки (крім `legal.html`, `today.html`):
`agegate.js` (без defer, у `<head>`) → `config.js`, `errors.js`, `age-core.js`,
`onboarding-core.js`, `app.js`, `store.js`, `elo-core.js`, `elo-api.js`,
`elo-hooks.js` (крім `admin.html`, `measure.html`).

| Сторінка | Специфічні модулі (порядок підключення) | Ключі localStorage/sessionStorage, які читає/пише сторінка* | Таблиці / RPC Supabase |
|---|---|---|---|
| index.html («Сьогодні») | history-core, exercises, reps-core, programs-data, foods, recipes-data, day-core, nutrition-core, tracker-core, workout-core, **today.js** | `ib.profile`, `forge.today`, `ib.eloState`, `ib.eloSent`, `ib.pending`, `ib.profile.dirty` | `profiles` (REST), `elo_state`, `elo_submit`, `elo_catch_up`, `elo_close_season` |
| workout.html | history-core, exercises, reps-core, programs-data, tracker-core, workout-core, **workout.js** | `forge.today`, `ib.profile` | `profiles`, `elo_submit` (через хуки) |
| plan.html | history-core, exercises, reps-core, programs-data, workout-core, onerm-core, periodization-core, **programs.js**, **projection.js** + inline-скрипт | `ib.profile` | `profiles` |
| programs.html | history-core, exercises, reps-core, programs-data, workout-core, **programs.js** | `ib.profile` | `profiles` |
| periodization.html | exercises, reps-core, programs-data, onerm-core, periodization-core, **periodization.js** | `ib.profile` | `profiles` |
| journal.html («Прогрес») | history-core, season-core, progress-core, adherence-core, onerm-core, exercise-core, tracker-core, **journal.js** | `ib.profile`, `ib.eloState` | `profiles`, `elo_history`, `elo_recent` |
| meals.html | history-core, foods, recipes-data, day-core, nutrition-core, **meals.js** | `ib.profile`, `ib.meals.fold` | `profiles`, `elo_submit` (meal) |
| nutrition.html | nutrition-core, **nutrition.js** | `ib.profile` | `profiles` |
| calculator.html (1RM) | onerm-core, **onerm.js** | `ib.profile` | `profiles` |
| trackers.html | tracker-core, **trackers-day.js** | `ib.profile` | `profiles`, `elo_submit` (sleep/recovery/activity) |
| trackers-settings.html | tracker-core, **trackers-settings.js** | `ib.profile` | `profiles` |
| measure.html | history-core, measure-core, **measure.js** (без elo-hooks) | `ib.profile` | `profiles` |
| cardio.html | **cardio.js** | `ib.profile` | `profiles` |
| boxing.html | boxing-data, **boxing.js** | `ib.profile` | — |
| supplements.html | supplements, **supplements-view.js** | — | — |
| research.html | (лише хребет) | — | — |
| rating.html | **season.js** | `ib.eloState`, `ib.eloReport`, `ib.eloWeeks`, `ib.eloClosed`, `ib.eloPending` | `elo_state`, `elo_leaderboard`, `elo_history`, `elo_set_name`, `elo_activate_grace`, `elo_close_season` |
| account.html | nutrition-core, bmi-core, measure-core, programs-data, **account.js** | `ib.profile`, `ib.profile.backup`, `ib.session`, `ib.account`, `ib.remember`, усі ключі при «Стерти локальні дані» | `profiles`, `account_state`, `delete_account`, Auth API (`/auth/v1/*`) |
| welcome.html | nutrition-core, bmi-core, password-core, legal-versions, **welcome.js** | `ib.regdraft`, `ib.profile`, `ib.session`, `ib.cloud` | Auth API (signup/login/recover), `register_request`, `username_free`, `account_state` |
| admin.html | **admin.js**, **admin-elo.js** (без elo-hooks) | `ib.account` | `admin_requests`, `admin_decide`, `admin_elo_list`, `admin_elo_set`, `admin_elo_anomalies` |
| legal.html | inline лише тема | `forge.theme`, `forge.scheme` | — |
| today.html | `agegate.js` + `location.replace('index.html')` | — | — |

\* Повний перелік ключів сховища (з `js/*.js`): `ib.profile`, `ib.session`
(localStorage або sessionStorage залежно від `ib.remember`), `ib.remember`,
`ib.cloud`, `ib.account`, `ib.pending`, `ib.profile.dirty`, `ib.profile.owner`,
`ib.profile.backup`, `ib.profile.backup.login`, `ib.regdraft`, `ib.gateloop`
(sessionStorage), `ib.eloState`, `ib.eloPending`, `ib.eloSent`, `ib.eloWeeks`,
`ib.eloClosed`, `ib.eloReport`, `ib.meals.fold` (і застарілий `ib.meals.folds`),
`forge.theme`, `forge.scheme`, `forge.today` — 23 ключі.

Жива схема (`list_tables`, public): `profiles`, `elo_config`, `season_state`,
`elo_events`, `season_history`, `awards`, `account_status`, `admins`,
`consent_log`, `elo_week_plan` — 10 таблиць, усі з RLS; **36** функцій у
`public` (випр., було 37; перелік і звірка — 2.3).

### 2.3 Звірка `db/*.sql` ↔ застосовані міграції ↔ жива схема

- Застосованих міграцій: 29 (`list_migrations`, 2026-08-27 … 2026-09-04);
  усі мають `statements` у `supabase_migrations.schema_migrations`.
- **Таблиці.** У `db/*.sql` є `create table` лише для 4 з 10:
  `profiles` (schema.sql), `account_status`, `admins` (account-approval.sql),
  `elo_week_plan` (elo-integrity.sql). `elo_config`, `season_state`,
  `elo_events`, `season_history`, `awards` створені міграцією `elo_seasonal`
  (20260827170445), `consent_log` — `consents_and_deletion` (20260828204754);
  текстів цих міграцій у репозиторії немає (INV-001).
- **Функції** (36 у `public`). Для кожної порівняно `md5(prosrc)` з тілом
  останнього `create or replace function` у `db/*.sql` (порядок файлів за
  міграціями). Результат (випр.):
  - збіг точний або з точністю до пробілів/коментарів: **25**
    (13 байт-у-байт; 4 — лише пробіли; 7 — лише `--` коментарі; 1 —
    `elo_leaderboard` — лише `/* */` коментар);
  - **розбіжність логіки: 2** — `elo_state`, `elo_activate_grace`
    (у базі є guard `NOT_APPROVED`, у `db/elo-engine.sql` — нема; INV-002);
  - **немає в репозиторії взагалі: 9** — `account_state`, `admin_decide`,
    `admin_requests`, `delete_account`, `elo_cron_eval_week`, `elo_history`,
    `elo_recent`, `season_of`, `username_free` (INV-001);
  - функцій, що є в `db/*.sql`, але відсутні в базі: 0;
  - функцій у базі, не згаданих у жодній міграції (`schema_migrations.statements`):
    1 — `admin_elo_list` (застосована поза міграціями; INV-001).
- **RLS-політики.** `pg_policies`: 12. У `db/*.sql` — 7 (`profiles` ×4 у
  `schema.sql` — збігаються з базою включно з `is_approved`;
  `account_status_select_own`, `admins_select_self`, `elo_config_read`).
  Відсутні в репозиторії 5: `awards_select_own`, `consent_log_select_own`,
  `elo_events_select_own`, `season_history_select_own`,
  `season_state_select_own` (INV-001).
- **Конфіг ELO.** `db/elo-config.json` ↔ `elo_config.data` (id=1, version 2,
  updated 2026-08-30): **ідентичні** (скрипт `cfg-compare.mjs`). `insert` у
  `db/elo-engine.sql` відстає: без гілки `floors` (INV-003).
- **CHECK-обмеження** живої бази (`pg_constraint`): `season_state.elo` 0..2500,
  `season_state.grace_used` 0..2, `elo_week_plan.planned` 3..7,
  `account_status.username` 3..13 символів, `profiles.data` ≤ 1 МіБ,
  `account_status.screening` ≤ 8 КіБ. Перші дві дублюють `seasonMax`
  і `graceWeeksPerSeason` з конфігу числом (INV-007).
- Версії профілю в бойових даних: обидва рядки `profiles` мають `version = 10`
  (= `SCHEMA_VERSION`), `favorites` відсутній, `birthDate` є. Отже ланцюжок
  міграцій 0→10 у `store.js` потрібен лише для локального режиму та імпорту
  старих резервних копій — це не мертвий код, але й не «гаряча» гілка.

### 2.4 Тести й гігієна

- `npm test` (node v22.22.2): **483 tests / 125 suites / 483 pass / 0 fail**,
  4.4 с (повторний прогін 2026-09-05 21:5x — ті самі числа).
- `node tools/ci-hygiene.mjs`: «чисто (2515 файлів перевірено)», <0.2 с.
- Кожен `tests/*.test.js` завантажує лише існуючі файли `js/` (перевірено
  скриптом: 22 різні модулі, жодного відсутнього). Тестів на неіснуючий код немає.
- `*-core.js` без жодного юніт-тесту: `bmi-core.js`, `measure-core.js`
  (див. Спостереження).

### 2.5 Мертві / осиротілі файли

- HTML без вхідних посилань: **0** (перевірено grep-ом по `*.html`, `js/*.js`,
  `sw.js`, `manifest.webmanifest`; `today.html` — навмисний редирект).
- JS у `js/`, не підключений жодним `<script src>`: **0**.
- `verify*.mjs` поза CI (`tools/ci-browser.sh core|full`) і поза
  `tools/README-verify.md`: `verifyauthz.mjs` (ходить у бойовий Supabase anon-ключем,
  лише читання), `verifyerrors.mjs` (офлайн, перехоплює Sentry) — INV-006.
- SQL-файли без відповідної міграції: тестові `elo-tests.sql`,
  `elo-integrity-tests.sql`, `multiuser-tests.sql`, `sim-week.sql` і
  `backup-export.sql` — за призначенням не міграції (усі самовідкочуються або
  лише SELECT). `security-hardening.sql` — «журнал», містить лише одну політику.
- Функції `EloCore.cleanDay/weekPenalty/cleanWeek/applyDayCaps/clampElo`
  застосунком не викликаються (лише `tools/simelo.mjs` і тести) — див. INV-008.
- Ключі `db/elo-config.json`, які не читає жодна SQL-функція: `openMealPenalty`,
  `dayLossFloor`, `leaderboardTops`, `leaderboardRanks` (INV-007).

### 2.6 Дубльована бізнес-логіка клієнт ↔ SQL (звірено попарно)

| Правило | Клієнт | Сервер | Стан |
|---|---|---|---|
| Код сезону за датою | `EloCore.seasonOf` (elo-core.js) | `season_of(date)` (лише в базі) | **збіг, доведено**: md5 послідовності кодів для 2191 днів 2025-01-01…2030-12-31 однаковий з обох боків (`3b0d5782e085f371e85ac3928cab41d1`) |
| Межі сезону | `EloCore.seasonRange` | `season_bounds` (elo-integrity.sql) | **збіг, доведено**: md5 меж 16 сезонів 2025–2028 однаковий (`2c0b32043be9c9dc9d745445523cc457`) |
| Дельта дії (workout/meal/sleep/recovery/activity) | `EloCore.actionDelta` | `elo_action_delta` (elo-proportional.sql) | **формули збігаються, доведено**: сітка 436 комбінацій (258 workout, 108 meal, 36 sleep, 7 recovery, 27 activity) з живим `elo_config` — quality (3 знаки) і delta ідентичні, md5 `c6dc38b02b96eb323810846a68389247` з обох боків (`/tmp/audit-inventory/delta-grid2.mjs` ↔ SELECT з `elo_action_delta`). **Але клієнт не застосовує `floors`** з `elo_facts` (`sleepMax/sleepGoalMin/stepsMax/stepsGoalMin/workoutTotalMin`) — INV-004 |
| План днів на тиждень для бюджету тренування | `payloadPlanned()` в elo-api.js: `clamp(1..7)` з поточного профілю | `elo_planned_for`: `greatest(3, least(7, …))` + знімок тижня в `elo_week_plan` | розбіжність меж (1 vs 3) — лише офлайн-оптимістичний показ |
| Повторна подача того самого дня | `ib.eloSent[key]=true` → ніколи не досилає; коментар: «перше подане значення фіксує якість… навмисно» | `elo_submit`: «реконсиляція вгору», `action_key` не читається | **суперечність задуму** — INV-004 |
| Відповідь `no_data, retry:true` | трактується як тимчасова: подія не позначається, досилається на кожен `Store.onChange` | повертається і для **постійної** умови `total < floors.workoutTotalMin` | INV-004 |
| Стелі сезону/grace | `seasonMax` 2500, `graceWeeksPerSeason` 2 у конфігу | ті ж числа **вшиті** в CHECK `season_state` | INV-007 |
| Нагороди за ранг/перцентиль | — | `elo_close_season`: 1/3/10/100/1000 і 10/5/1 % вшиті; конфіг `leaderboardRanks`/`leaderboardTops` не читається | INV-007 |
| Чистий тиждень / штраф тижня | `EloCore.cleanWeek/weekPenalty` (симуляція) | `elo_eval_week_for` | збіг формул; клієнтські копії живі лише в `tools/simelo.mjs` (INV-008) |
| Денна стеля | `applyDayCaps`: `clamp(sum, dayLossFloor, dayGainCap)` | лише `dayGainCap` для додатних; `dayLossFloor` не існує на сервері | INV-007/INV-008 |

## 3. Що НЕ перевірено і чому

- Живі тіла 9 функцій, яких немає в репозиторії, прочитано повністю, але
  порівнювати їх нема з чим.
- Тексти самих міграцій (`schema_migrations.statements`, ~130 КБ) не
  переносились у репозиторій і не звірялись рядок у рядок з `db/*.sql` —
  це робота Phase B (INV-001, рекомендація).
- Серверна реконсиляція «вгору» в `elo_submit` (INV-004) не виконувалась
  мутуючою пробою: сервер прочитано з `pg_proc` (тіло ідентичне
  `db/elo-integrity.sql` після зняття коментарів), клієнт відтворено в
  `node:vm`. Проба з `BEGIN…ROLLBACK` лишається домену безпеки/бази.
- Браузерні `verify*.mjs` не запускались (домен «tests»).
- Safari/Firefox/мобільні — недоступні (лише Chromium у контейнері).
- Supabase Auth (мін. довжина пароля тощо) — конфіг поза репозиторієм, звірити
  з `password-core.js` неможливо без панелі (домен A11).

## 4. Знахідки

### INV-001

```text
ID:                 INV-001
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Підтримуваність / відновлюваність схеми (дрейф репозиторій ↔ база)
Location:           db/*.sql (усі), supabase_migrations.schema_migrations (29 рядків),
                    pg_proc (36 функцій), pg_policies (12), pg_tables (10)
Description:        Тека db/ не є відтворюваним описом бойової схеми. У живій базі є
                    обʼєкти, яких у репозиторії немає в жодному файлі:
                    • 6 із 10 таблиць без DDL: elo_config, season_state, elo_events,
                      season_history, awards (міграція elo_seasonal 20260827170445),
                      consent_log (consents_and_deletion 20260828204754);
                    • 9 із 36 функцій: account_state, admin_decide, admin_requests,
                      delete_account, elo_cron_eval_week, elo_history, elo_recent,
                      season_of, username_free (у т.ч. season_of — її кличуть майже всі
                      ELO-функції, і elo_cron_eval_week — точка входу pg_cron);
                    • 5 із 12 RLS-політик: awards_select_own, consent_log_select_own,
                      elo_events_select_own, season_history_select_own,
                      season_state_select_own;
                    • тексти міграцій security_lockdown_rpc_and_view,
                      perf_rls_initplan_indexes_pagination, tighten_table_grants,
                      hardening_size_limits_oracles_view, elo_approved_guard(2),
                      age_limit_17 — лише в базі.
                    db/account-approval.sql підписаний «Цей файл — копія для
                    репозиторію», але містить 2 з 6 функцій своєї міграції.
                    Є і зворотний дрейф: функція admin_elo_list (db/admin-elo.sql) живе в
                    базі, але не згадана в жодній із 29 міграцій — її застосували поза
                    системою міграцій (SQL Editor / execute_sql). Перевірка всіх 36 функцій,
                    10 таблиць, 12 політик і 7 індексів через `statements ilike '%name%'`:
                    поза міграціями лише admin_elo_list (індекс elo_events_user_id_action_key_key
                    — автоімʼя inline-constraint, хибний спрацьовувач).
Why it matters:     PROMPT §1.1: «Зміни схеми — лише міграціями з файлом у db/».
                    Без цих текстів неможливо: підняти схему в Supabase branch чи
                    локальному Postgres (A11 «відновлення з бекапу»), зробити code-review
                    правки RLS, знайти регресію в git blame. Єдина копія логіки безпеки
                    (guard NOT_APPROVED, політики elo_*) живе в таблиці однієї бази.
Reproduction:       1) grep -n "create table" db/*.sql | grep -v tests  → 4 таблиці.
                    2) select (regexp_matches(array_to_string(statements,E'\n'),
                       'create table (?:if not exists )?(?:public\.)?([a-z_]+)','gi'))[1]
                       from supabase_migrations.schema_migrations;  → 11 (з site_files).
                    3) node /tmp/audit-inventory/extract-bodies.mjs → 9 рядків LIVE-ONLY.
                    4) select policyname from pg_policies where schemaname='public' → 12;
                       grep -n "create policy" db/*.sql → 7.
Observed:           Вивід п.3: «account_state | LIVE-ONLY (немає в db/*.sql)» … ×9;
                    «REPO-ONLY: —». Вивід п.4: 12 проти 7.
Expected:           Кожен обʼєкт бойової схеми має текст у db/ (як мінімум — дамп
                    statements кожної міграції у db/migrations/<version>_<name>.sql).
Root cause:         Міграції застосовувались через apply_migration з тексту в чаті, а в
                    db/ клались лише «тематичні» файли; частина міграцій (elo_seasonal,
                    consents_and_deletion, security_lockdown…) файла не отримала.
Impact:             Відновлення схеми з репозиторію неможливе; ревʼю змін RLS/RPC —
                    лише через живу базу; ризик «загубити» guard при наступному
                    редагуванні (див. INV-002).
Recommended fix:    Phase B: вивантажити statements усіх 29 міграцій у
                    db/migrations/ (read-only SELECT з schema_migrations) і додати
                    перевірку в tools/ci-hygiene.mjs: кожна функція/таблиця/політика з
                    db/ має відповідник, а db/README пояснює порядок. Далі — тримати
                    правило «apply_migration лише з файла».
Regression test:    Скрипт (node, без мережі) — парсить db/migrations/*.sql і db/*.sql:
                    кожне create table / create policy / create function у другому має
                    бути й у першому; плюс у Phase B/C — один SELECT-звіт
                    «pg_proc ∖ репозиторій = ∅».
```

### INV-002

```text
ID:                 INV-002
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Дрейф безпеки репозиторій ↔ база (guard NOT_APPROVED)
Location:           db/elo-engine.sql:301 (elo_activate_grace), :336 (elo_state);
                    міграції elo_approved_guard / elo_approved_guard2 (20260828202028/45)
Description:        У бойовій базі elo_state() і elo_activate_grace() мають рядок
                      if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
                    У репозиторії останнє (і єдине) визначення обох — у db/elo-engine.sql —
                    цього рядка НЕ має. Guard був доданий міграцією-текстозаміною
                    (do $$ … replace(pg_get_functiondef(...), …) … execute def $$),
                    файла якої в db/ немає. Для решти RPC (elo_submit, elo_close_season,
                    elo_leaderboard, elo_set_name, elo_history, elo_recent) пізніші файли
                    (elo-integrity.sql, leaderboard-name.sql, nick-length.sql) вже містять
                    guard явно — лише ці дві функції лишились «до-guard».
Why it matters:     Будь-хто, хто «перезастосує» db/elo-engine.sql як джерело правди
                    (відновлення, branch, правка сусідньої функції в тому ж файлі через
                    apply_migration), мовчки зніме барʼєр approved з elo_state
                    (віддає конфіг і ранг pending/rejected/blocked акаунтам) та з
                    elo_activate_grace (дозволяє не-approved створювати рядок
                    season_state і витрачати grace). Тести db/multiuser-tests.sql
                    перевіряють NOT_APPROVED, але їх ніхто не запускає автоматично.
Reproduction:       node /tmp/audit-inventory/dump-body.mjs elo-engine.sql elo_state
                    | grep -c NOT_APPROVED   → 0
                    select position('NOT_APPROVED' in prosrc) from pg_proc
                    where proname='elo_state'  → 261 (є; elo_activate_grace → 233)
                    Аналогічно elo_activate_grace: репозиторій 0, база — є.
                    node /tmp/audit-inventory/nc-compare.mjs → «elo_state … DIFF»,
                    «elo_activate_grace … DIFF» (решта MATCH).
Observed:           Тіла збігаються байт-у-байт, крім вставленого guard-рядка
                    (liveLen 1135 vs repoLen 1057; 1180 vs 1102 — рівно довжина рядка).
Expected:           db/elo-engine.sql (або новіший файл) містить guard у явному тексті,
                    а не лише як побічний ефект міграції поза репозиторієм.
Root cause:         Guard застосовано генеративною міграцією без оновлення файлів-джерел.
Impact:             Латентна регресія безпеки при першому ж «переустановленні» з файлу.
Recommended fix:    Phase B: додати явні create or replace для elo_state /
                    elo_activate_grace з guard у db/ (напр. у security-hardening-2.sql
                    або новий файл), зафіксувати міграцією no-op (ті самі тіла), і
                    додати в ci-hygiene перевірку: кожна функція в db/*.sql, що
                    починається з `if uid is null then raise exception 'not authenticated'`
                    і має security definer, мусить містити NOT_APPROVED або явну
                    позначку-виняток.
Regression test:    tests/db-guard.test.js (node, без мережі): парсить db/*.sql, для
                    кожної SECURITY DEFINER функції з auth.uid() вимагає guard.
                    Phase C: `select proname from pg_proc where prosecdef and
                    prosrc like '%auth.uid()%' and prosrc not like '%NOT_APPROVED%'
                    and prosrc not like '%FORBIDDEN%'` → лише account_state,
                    delete_account, username_free, register_request, is_admin,
                    is_approved (навмисно доступні pending / хелпери) — саме такий
                    результат дає запит сьогодні (перевірено).
```

### INV-003

```text
ID:                 INV-003
Severity:           LOW
Confidence:         CONFIRMED
Category:           Дрейф конфігу репозиторій ↔ база
Location:           db/elo-engine.sql:6 (insert into elo_config … values (1, '{…}'));
                    db/elo-config.json; elo_config.data (id=1)
Description:        У репозиторії дві копії конфігу ELO: db/elo-config.json (ідентичний
                    базі, version 2, з гілкою floors) і insert у db/elo-engine.sql
                    (без floors: sleepMax 960, stepsMax 100000, sleepGoalMin 240,
                    stepsGoalMin 3000, workoutTotalMin 3). Insert має
                    `on conflict (id) do update set data = excluded.data`, тобто
                    повторне застосування файла ПЕРЕЗАПИШЕ бойовий конфіг старою
                    версією без floors — і elo_facts почне брати дефолти з коду.
Why it matters:     Та сама природа, що INV-002: файл виглядає як джерело правди, але
                    відкочує стан. Дефолти в elo_facts збігаються з floors, тож
                    поведінка не зміниться одразу, — але зміна floors у майбутньому
                    буде тихо втрачена.
Reproduction:       node /tmp/audit-inventory/cfg-compare.mjs →
                    «repo db/elo-config.json vs LIVE elo_config: identical»;
                    «db/elo-engine.sql insert vs LIVE elo_config: + лише у другому:
                    floors = {…}».
Observed:           Див. вище.
Expected:           Одне джерело конфігу (elo-config.json), insert у SQL — з нього або
                    відсутній (`on conflict do nothing`).
Root cause:         Міграція elo_authoritative_facts додала floors через jsonb_set,
                    не оновивши insert.
Impact:             Мовчазний відкат конфігу при перезастосуванні файла.
Recommended fix:    Замінити `do update` на `do nothing` і додати в тест
                    порівняння insert ↔ elo-config.json (обидва в репозиторії — тест
                    офлайновий).
Regression test:    tests/elo-config-sync.test.js: JSON з insert у elo-engine.sql
                    deepEqual db/elo-config.json.
```

### INV-004

```text
ID:                 INV-004
Severity:           MEDIUM
Confidence:         CONFIRMED (механіка клієнта — node:vm; серверна умова — з тексту
                    функції, ідентичного живому)
Category:           Дубльована/розбіжна бізнес-логіка клієнт ↔ сервер (ELO submit)
Location:           js/elo-hooks.js:16-19 (коментар), :152 (`if (!res) continue;`),
                    :160 (`if (res.ok === false && res.retry) continue;`), :91 (умова
                    подачі тренування); js/elo-core.js (actionDelta без floors);
                    js/elo-api.js:131-136;
                    db/elo-proportional.sql elo_facts (floors, workoutTotalMin);
                    db/elo-integrity.sql elo_submit («Реконсиляція вгору»)
Description:        Три розбіжності однієї пари «клієнт подає — сервер рахує»:
                    (a) Клієнт не знає floors. elo_facts повертає null для тренування з
                        total < floors.workoutTotalMin (3) → elo_submit відповідає
                        {ok:false, error:'no_data', retry:true}. Клієнт трактує retry як
                        тимчасове («профіль ще не доїхав») і НЕ позначає подію
                        надісланою → та сама подія відправляється на КОЖЕН
                        Store.onChange (кожна галочка трекера, кожен прийом їжі)
                        три дні поспіль (lastDays(3)). programs.js:1562 дозволяє
                        видаляти вправи з дня без нижньої межі, тож день з 1–2
                        вправами — легальний стан профілю.
                    (b) Оптимістична дельта (офлайн) рахується без floors: сон 60 хв
                        при цілі 60 → клієнт q=1.0 (+повна вартість), сервер підіймає
                        ціль до sleepGoalMin=240 → q=0.25 → ~5 % вартості. Тост
                        «+6 ELO (досилається)» не збігається з фактом.
                    (a′) Те саме для БУДЬ-ЯКОЇ не-офлайн помилки сервера: EloApi.submit
                        при 400/500 (напр. NOT_APPROVED, out_of_window як exception)
                        повертає null, а elo-hooks.js робить `if (!res) continue;` —
                        подія не позначається і теж досилається на кожен onChange
                        (відтворено: /tmp/audit-inventory/hooks-null-loop.mjs →
                        11 submit-ів на 1 init + 10 onChange).
                    (c) Задум задокументовано протилежно: elo-hooks.js каже «перше
                        подане значення фіксує якість… виправлення заднім числом
                        рейтинг не перерахує, і це навмисно»; elo_submit — «доплачуємо
                        різницю intended − paid», action_key не читається. Клієнт
                        через ib.eloSent ніколи не досилає, тож серверна реконсиляція
                        досяжна лише з іншого пристрою або після очищення сховища —
                        поведінка залежить від того, звідки зайшов користувач.
Why it matters:     (a) — зайві RPC у бойовий Supabase на кожне збереження профілю
                    (для 3 таких днів — ×3), без будь-якого сигналу користувачу, чому
                    тренування «не зараховано». (b)/(c) — розходження між показаним і
                    нарахованим підриває довіру до рейтингу; (c) — недетермінізм між
                    пристроями.
Reproduction:       (a) node /tmp/audit-inventory/hooks-retry-loop.mjs
                        (сервер-заглушка повертає no_data/retry для workout total=2;
                        10 викликів Store.onChange).
                    (c) node /tmp/audit-inventory/hooks-resubmit.mjs
                        (день їжі закрито 1200/2500, потім 2500/2500).
Observed:           (a) «після init: submit-ів = 1»; «після 10 Store.onChange:
                        submit-ів = 11, усі ключі однакові: true ['workout:2026-09-05']»;
                        «ib.eloSent = undefined».
                    (c) «після 1-го закриття дня: submit-ів = 1 [meal kcal=1200]»;
                        «після 2-го закриття дня: submit-ів = 1» — досилання немає;
                        ib.eloSent = {"meal:2026-09-05":true}.
Expected:           Сервер розрізняє тимчасове (профіль не доїхав) і остаточне
                    (замало вправ) — напр. error:'too_few_exercises', retry:false;
                    клієнт позначає остаточні відмови надісланими; оптимістична
                    дельта використовує config.floors з ib.eloState; коментарі обох
                    сторін описують одне правило.
Root cause:         Правило еволюціонувало на сервері (etапи authoritative →
                    proportional → integrity), клієнтські копії й коментарі не
                    оновлювались.
Impact:             Зайве навантаження на RPC; неправдиві тости; різна поведінка з
                    різних пристроїв.
Recommended fix:    Мінімально: у elo_submit повертати retry:false для total <
                    workoutTotalMin; у elo-hooks.js — позначати sent при
                    retry === false; у elo-core.js — застосовувати cfg.floors перед
                    actionDelta (дзеркало elo_facts); виправити коментар у
                    elo-hooks.js. Рішення про (c) — питання правил, узгодити з
                    власником (§1.5).
Regression test:    tests/elo-hooks.test.js у node:vm: відповідь {retry:false} →
                    рівно 1 submit на 10 onChange; tests/elo-core.test.js: sleep 60/60
                    з floors → та сама дельта, що elo_action_delta(…240).
```

### INV-005

```text
ID:                 INV-005
Severity:           LOW
Confidence:         CONFIRMED
Category:           Гігієна репозиторію / мертві файли
Location:           tools/sim90/out/** (2290 файлів у git)
Description:        91 % файлів репозиторію (2290 з 2515) — вихід симуляції sim90:
                    10 профілів Chromium (leveldb/*.ldb, *.log, LOCK, sqlite-бази,
                    Cache), логи й чекпоінти. Вони не потрібні ні сайту, ні тестам,
                    ні CI, але потрапляють у кожен clone, у ci-hygiene (перевіряє всі
                    2515) і в .vercelignore-обробку.
Why it matters:     Бінарні профілі браузера — типове місце витоку (cookies, IndexedDB
                    з локальними даними симульованих користувачів); кожна повторна
                    симуляція дасть diff на тисячі файлів; git-історія розпухає.
Reproduction:       git ls-files 'tools/sim90/out/*' | wc -l → 2290;
                    git ls-files | wc -l → 2515.
Observed:           Див. вище.
Expected:           tools/sim90/out/ у .gitignore; у репозиторії — лише README/REPORT
                    та скрипти.
Root cause:         Не додано до .gitignore при комміті результатів симуляції.
Impact:             Супровід, розмір, потенційний витік.
Recommended fix:    Додати `tools/sim90/out/` у .gitignore і прибрати з індексу
                    (git rm --cached) окремим комітом Phase B; перед тим перевірити,
                    чи не містять профілі персональних даних реальних акаунтів.
Regression test:    tools/ci-hygiene.mjs: падати, якщо в git є шлях під
                    tools/sim90/out/.
```

### INV-006

```text
ID:                 INV-006
Severity:           LOW
Confidence:         CONFIRMED
Category:           Осиротілі перевірки / документація ↔ код
Location:           tools/verifyauthz.mjs, tools/verifyerrors.mjs;
                    tools/ci-browser.sh; tools/README-verify.md
Description:        Два verify-скрипти не згадані ні в tools/ci-browser.sh (core/full),
                    ні в tools/README-verify.md: verifyauthz.mjs (читає бойовий Supabase
                    anon-ключем — перевірка, що anon нічого не бачить) і
                    verifyerrors.mjs (офлайн, перехоплює Sentry-запити).
Why it matters:     Перевірка авторизації anon — саме те, що має бігти регулярно;
                    зараз її ніхто не запускає і ніхто не знає про неї з документації.
Reproduction:       grep -c "verifyauthz\|verifyerrors" tools/ci-browser.sh
                    tools/README-verify.md .github/workflows/ci.yml → 0 у кожному.
Observed:           0/0/0.
Expected:           Кожен verify* або в CI-наборі, або описаний у README-verify.md з
                    причиною виключення.
Root cause:         Додані пізніше за README-verify.md.
Impact:             Мертва (не виконувана) перевірка безпеки.
Recommended fix:    verifyerrors → у ci-browser.sh full; verifyauthz — описати в
                    README-verify.md як ручну перевірку (ходить у бойовий бекенд).
Regression test:    tools/ci-hygiene.mjs: кожен tools/verify*.mjs згаданий у
                    ci-browser.sh або README-verify.md.
```

### INV-007

```text
ID:                 INV-007
Severity:           LOW
Confidence:         CONFIRMED
Category:           Магічні числа / мертві ключі конфігу (клієнт ↔ SQL ↔ DDL)
Location:           db/elo-config.json (leaderboardTops, leaderboardRanks, dayLossFloor,
                    openMealPenalty, seasonMax, graceWeeksPerSeason);
                    db/elo-integrity.sql elo_close_season (нагороди);
                    pg_constraint: season_state_elo_check, season_state_grace_used_check
Description:        (a) Чотири ключі конфігу не читає жодна SQL-функція:
                        leaderboardTops [0.1,0.05,0.01] і leaderboardRanks
                        [1000,100,10,3,1] — elo_close_season вшиває 1/3/10/100/1000 і
                        10/5/1 % літералами (і в інших одиницях: відсотки проти
                        часток); dayLossFloor (−15) — існує лише в клієнтському
                        applyDayCaps (симуляція), сервер денного мінімуму втрат не має;
                        openMealPenalty (−3) — лише tools/simelo.mjs, сервер штрафу за
                        незакритий день не нараховує.
                    (b) CHECK-обмеження дублюють конфіг числом: season_state.elo
                        0..2500 (= seasonMax), grace_used 0..2 (= graceWeeksPerSeason).
                        Зміна конфігу (напр. graceWeeksPerSeason → 3) призведе до
                        check_violation у elo_activate_grace, а seasonMax → 3000 —
                        до помилок у elo_submit/elo_eval_week_for.
Why it matters:     Конфіг виглядає керованим, але половина його — декорація; той,
                    хто змінить leaderboardRanks, нічого не змінить, а хто змінить
                    graceWeeksPerSeason — зламає RPC на продакшені.
Reproduction:       for k in openMealPenalty dayLossFloor leaderboardTops leaderboardRanks;
                    do grep -l "$k" db/*.sql | grep -v tests; done → лише elo-engine.sql
                    (і лише рядок insert). grep -n "my_rank <= \|pctl <= " db/elo-integrity.sql
                    → літерали. select conname, pg_get_constraintdef(oid) from pg_constraint
                    where conrelid='public.season_state'::regclass → 0..2500, 0..2.
Observed:           Див. вище (таблиця ключів у 2.5/2.6).
Expected:           Або функції читають ключі, або ключі видалені з конфігу з
                    коментарем; CHECK виражені через ті ж константи або задокументовані
                    як «змінювати разом».
Root cause:         Конфіг проєктувався ширше, ніж реалізовано.
Impact:             Помилкове відчуття керованості; латентний check_violation.
Recommended fix:    Phase B (мінімально): коментар у elo-config.json біля мертвих
                    ключів + тест, що кожен ключ конфігу зустрічається в db/*.sql поза
                    insert; або прибрати мертві ключі.
Regression test:    tests/elo-config-keys.test.js: для кожного ключа
                    db/elo-config.json — grep у db/*.sql (крім insert/tests) ≥ 1.
```

### INV-008

```text
ID:                 INV-008
Severity:           INFO
Confidence:         CONFIRMED
Category:           Мертвий код клієнта, який утримують тести
Location:           js/elo-core.js: cleanDay, weekPenalty, cleanWeek, applyDayCaps,
                    clampElo (експортуються у window.EloCore)
Description:        Пʼять функцій EloCore не викликає жоден модуль застосунку
                    (grep по js/: 0 звернень); їх використовують лише tools/simelo.mjs
                    і tests/elo-core.test.js. Це «дзеркало» серверних правил тижня, яке
                    не бере участі в роботі сторінок, але покривається тестами — тести
                    перевіряють реалізацію, а не поведінку продукту (A1: «тести
                    реалізації замість поведінки»). applyDayCaps реалізує правило
                    (dayLossFloor), якого на сервері немає.
Why it matters:     Створює хибне враження покриття ELO-тижня тестами; серверна
                    elo_eval_week_for тестами репозиторію (npm test) не покрита взагалі —
                    лише db/elo-tests.sql, що не запускається автоматично.
Reproduction:       grep -rn "\.\(cleanDay\|weekPenalty\|cleanWeek\|applyDayCaps\|clampElo\)\b"
                    js/ tools/ | grep -v elo-core.js → лише tools/simelo.mjs.
Observed:           8 звернень, усі в tools/simelo.mjs.
Expected:           Або позначити ці функції як «лише симуляція» в коментарі/експорті
                    (window.EloSim), або прибрати з ядра сторінок.
Root cause:         Історичний клієнтський розрахунок перенесено на сервер, копію
                    залишено для симуляції.
Impact:             Супровід: правити треба у двох місцях, а тести не помітять
                    розбіжності з сервером.
Recommended fix:    Коментар-попередження + перенесення в tools/ або окремий модуль,
                    який не вантажать сторінки.
Regression test:    —
```

### INV-009

```text
ID:                 INV-009
Severity:           LOW
Confidence:         CONFIRMED
Category:           Документація ↔ код (RELEASE.md — порядок викладення застарів)
Location:           RELEASE.md §1.3, §1.4, §3.1, §5, §6; sw.js; js/app.js:1595-1612;
                    tests/ (483 тести); tools/ (36 verify)
Description:        RELEASE.md — єдиний операційний документ «як викладати», і він
                    суперечить коду в ключових пунктах:
                    • §3.1 «Немає service worker → офлайн працює НЕ повністю» і §5
                      «Service worker — свідомо не реалізовано»: sw.js існує (110 рядків,
                      CACHE='forge-v1', network-first HTML + stale-while-revalidate) і
                      реєструється в js/app.js:1610. Саме версіонування кешу, якого
                      документ вимагає як передумови, у sw.js вирішене інакше (без
                      версій, SWR) — читач документа про це не дізнається.
                    • §1.4 «npm test # 226 модульних тестів» — фактично 483 / 125 suites.
                    • §1.4 і README «Дев'ять скриптів» verify — 36 файлів tools/verify*.mjs;
                      tools/README-verify.md описує 17.
                    • §1.4 «TZ=Europe/Kyiv npm test — обовʼязково у двох поясах» — CI
                      (.github/workflows/ci.yml) ганяє npm test лише в TZ раннера (UTC).
                    • §1.3 «схема — db/schema.sql» — файл містить лише profiles (INV-001).
                    • §6 «ні сторінки, ні ядра не чіпають localStorage напряму» — 11 файлів
                      поза store.js звертаються до localStorage/sessionStorage напряму
                      (agegate 6, app 7, welcome 4, elo-api 3, account 3, workout-core 3,
                      elo-hooks 2, meals 2, season 2, errors 1, nutrition-core 1).
                    • §6 «4225 рядків із 18281» — зараз js/ має 27 269 рядків.
Why it matters:     Хто викладає Forge за цим документом, робить неправильні висновки
                    про офлайн, кеш і покриття; помилкова інструкція гірша за відсутню.
Reproduction:       grep -n "service worker\|226\|Дев'ять\|schema.sql" RELEASE.md;
                    ls sw.js; grep -n "serviceWorker.register" js/app.js;
                    npm test 2>&1 | grep "^# tests"; ls tools/verify*.mjs | wc -l;
                    grep -c "localStorage\.\|sessionStorage\." js/*.js | grep -v ":0"
Observed:           Див. вище (усі числа отримано командами 2026-09-05).
Expected:           RELEASE.md описує фактичний стан: SW є, як він оновлюється, як
                    примусово скинути кеш (?nosw=1), 483 тести, 36 verify, TZ-матриця в CI
                    або чесно «лише UTC».
Root cause:         Документ писався на етапі до PWA/ELO/CI і не оновлювався.
Impact:             Супровід і онбординг нового мейнтейнера.
Recommended fix:    Переписати §1.4, §3.1, §5, §6 RELEASE.md за фактом; додати в
                    tools/ci-hygiene.mjs перевірку, що число після «npm test #» у
                    RELEASE.md/README.md дорівнює фактичному (або прибрати числа).
Regression test:    ci-hygiene: regex на «[0-9]+ (модульних )?тест» у RELEASE.md ==
                    `node --test` підсумок; або відсутність чисел.
```

### INV-010

```text
ID:                 INV-010
Severity:           LOW
Confidence:         CONFIRMED
Category:           Документація ↔ код (README «Що всередині», коментарі в коді)
Location:           README.md:27, :33, :59, :103, :112-113, :122, :126-127;
                    js/config.js:20-22; tools/verifyagegate.mjs:2; vercel.json (X-Robots-Tag)
Description:        Вступні розділи README (не журнал, а індекс «Що всередині») і
                    коментарі в коді суперечать поточному коду:
                    • README:27 «npm test # 213 перевірок» і :122 «253 тести» — 483.
                    • README:33 покриття «rating-core.js» і :1575 tests/rating-core.test.js —
                      файлів не існує (замінено сезонним ELO; js/season-core.js — інше).
                    • README:59, :103 і tools/verifyagegate.mjs:2 — «перевірка 18+»;
                      код: AgeCore.MIN_AGE = 17 (js/age-core.js:18), welcome.js, legal.html:160
                      і сервер (register_request: yrs < 17 → UNDERAGE) — усі 17.
                    • README:112 «db/elo-engine.sql — таблиці сезонів/подій/нагород, RPC…,
                      RLS»: у файлі немає жодного create table і жодної policy
                      (grep -c "create table\|policy" db/elo-engine.sql → 0).
                    • README:126 «db/schema.sql — схема бази» — лише profiles.
                    • README:127 «Дев'ять браузерних перевірок» — 36; README-verify описує 17.
                    • Таблиця сторінок не містить legal.html, measure.html, admin.html
                      (22 файли проти 18 у таблиці); таблиця файлів — без 17 модулів js/
                      (measure-core, bmi-core, password-core, season-core, adherence-core,
                      exercise-core, reps-core, day-core, onboarding-core, errors,
                      admin, admin-elo, boxing, measure, legal-versions, recipes-data,
                      boxing-data).
                    • js/config.js:20-22: «без свого логіна з ним не видно нічого, крім
                      таблиці лідерів» — elo_leaderboard вимагає auth.uid() і is_approved
                      (guard NOT_APPROVED), anon її не викличе.
                    • Індексація: README «SEO» (:3093-3098) і RELEASE §1.2 описують
                      canonical/sitemap як мету, tools/build-meta.js будує sitemap на
                      16 сторінок — а vercel.json ставить X-Robots-Tag: noindex, nofollow
                      на /(.*) (усі сторінки), robots.txt пояснює це як рішення
                      «приватний застосунок». build-meta.js жодного разу не застосовано
                      до поточної розмітки (canonical є лише в today.html; siteUrl у
                      config.js заповнений). measure.html у PAGES build-meta відсутня.
Why it matters:     README — журнал навмисно (§2.1), але його вступ і таблиці читають як
                    карту проєкту; неправильна карта коштує часу кожному, хто прийде
                    після автора. Число 18+ у документації проти 17 у коді й legal — ще й
                    юридично чутливе.
Reproduction:       grep -n "213 перевірок\|253 тести\|rating-core\|18+\|Дев'ять" README.md;
                    ls js/rating-core.js tests/rating-core.test.js (обидва відсутні);
                    grep -n MIN_AGE js/age-core.js; grep -c "create table\|policy"
                    db/elo-engine.sql; grep -l 'rel="canonical"' *.html.
Observed:           Див. вище.
Expected:           Вступ README відповідає коду (числа або прибрані, або автоматично
                    перевіряються); «17+» скрізь; таблиці файлів/сторінок повні або з
                    приміткою «неповний перелік».
Root cause:         Індекс не оновлювався разом із журналом.
Impact:             Супровід.
Recommended fix:    Одноразова правка README:14-128 і коментаря в config.js; вилучити
                    «18+» із README/verifyagegate.mjs; вирішити явно: або прибрати
                    build-meta/sitemap як несумісні з noindex, або прибрати глобальний
                    noindex (питання власника, §1.5).
Regression test:    ci-hygiene: усі згадані в README:55-128 файли існують (`js/*.js`,
                    `db/*.sql`), і навпаки — кожен js/*.js згаданий хоч раз.
```

### INV-011

```text
ID:                 INV-011
Severity:           LOW
Confidence:         CONFIRMED
Category:           Неоднорідна обробка помилок (телеметрія)
Location:           js/errors.js:229-238 (ForgeErrors.report); 107 блоків `catch (_)` у js/*.js
                    (store.js 29, welcome.js 13, app.js 12, season.js 9, elo-api.js 7,
                    agegate.js 6, meals.js 4, account.js 4, …)
Description:        Модуль Sentry експортує ручний репорт `ForgeErrors.report(err, extra)`
                    «виняток спійманий, але означає баг» — його не викликає жоден модуль
                    (grep "ForgeErrors\." js/ поза errors.js → 0). У Sentry потрапляють лише
                    необроблені винятки й unhandledrejection; усі 107 мовчазних catch і всі
                    `catch (e) { … return null }` (EloApi.submit, Store.refreshAccountState,
                    flush) нікуди не звітують. Більшість `catch (_)` — легітимні охоронці
                    localStorage, але сюди ж потрапляють JSON.parse відповідей сервера,
                    помилки RPC 400/500 (ELO), збій refresh стану акаунта.
Why it matters:     Проєкт розраховує на «реальну телеметрію» (PROMPT §3), а ключові
                    відмови хмарного шару (ELO submit/flush, account_state) за задумом
                    коду в телеметрію не потрапляють — Sentry буде «зеленим» при зламаному
                    рейтингу.
Reproduction:       grep -rn "ForgeErrors\." js/ | grep -v "^js/errors.js" → порожньо;
                    grep -c "catch (_)" js/*.js | grep -v ":0" → 15 файлів, сума 107;
                    sed -n '131,151p' js/elo-api.js — catch без report.
Observed:           0 викликів report; 107 мовчазних catch.
Expected:           Мовчазні catch навколо мережі/RPC/JSON звітують через ForgeErrors.report
                    (з троттлінгом), а не лише localStorage-гарди.
Root cause:         API репорту додано пізніше за більшість catch-блоків.
Impact:             Сліпа зона телеметрії саме на хмарних шляхах.
Recommended fix:    Phase B: у EloApi.submit/flush, Store.rpc-помилках (крім offline/noauth/
                    NOT_APPROVED), refreshAccountState — `window.ForgeErrors && ForgeErrors.report(e, {where})`.
Regression test:    tests у node:vm: підмінити window.ForgeErrors.report лічильником, змусити
                    Store.rpc кинути 500 → report викликано 1 раз.
```

### INV-012

```text
ID:                 INV-012
Severity:           INFO
Confidence:         CONFIRMED
Category:           Приховані глобалі
Location:           js/programs-data.js:49-297 (12 top-level const), js/exercises.js:63-213
                    (4 top-level const); файли без IIFE і без 'use strict': config.js,
                    exercises.js, legal-versions.js, programs-data.js, recipes-data.js
Description:        Публічний реєстр глобалей — 45 імен `window.X`, кожне присвоюється
                    рівно один раз (колізій немає). Але два файли даних оголошують
                    16 top-level `const` (COMMON_NOTES, PROGRESSION_DOUBLE, WARMUP, COOLDOWN,
                    UL_UPPER, UL_LOWER, PPL_PUSH, PPL_PULL, PPL_LEGS, W_PUSH, W_PULL, W_FULL,
                    VOLUME_CAP, MUSCLES, EXERCISES, PATTERN_MUSCLES) як класичні скрипти —
                    це спільні лексичні привʼязки глобальної області: друге оголошення
                    того ж імені в будь-якому іншому скрипті сторінки дасть SyntaxError
                    «Identifier has already been declared» і вбʼє той скрипт цілком.
                    Сьогодні колізій немає (boxing-data.js/programs.js оголошують WARMUP/
                    COOLDOWN/MUSCLES усередині IIFE або не на одній сторінці) — перевірено.
Why it matters:     Клас відмови «сторінка мертва без жодної помилки в логіці» при
                    додаванні нового файла даних; 'use strict' відсутній — помилки
                    присвоєння в неоголошені змінні в цих файлах ковтатимуться.
Reproduction:       grep -n "^\(const\|let\|var\|function\) " js/programs-data.js js/exercises.js;
                    grep -L "'use strict'" js/*.js
Observed:           16 оголошень; 5 файлів без 'use strict'.
Expected:           Файли даних обгорнуті в IIFE з 'use strict' і експортують лише window.X.
Root cause:         Історичний стиль файлів даних.
Impact:             Латентний, лише при майбутніх змінах.
Recommended fix:    Обгорнути 2 файли в IIFE (0 змін поведінки; window.X лишаються).
Regression test:    tests/data.test.js: завантажити всі js/*-data.js + exercises.js у один
                    vm-контекст двічі — не має кидати.
```

## 5. Спостереження (INFO)

- **Ключ дня.** Формула локального «YYYY-MM-DD» повторена 16 разів у 14 файлах
  (adherence-core, age-core, app ×2, elo-api, elo-hooks, exercise-core,
  history-core, measure, progress-core, season-core, store, today ×2,
  tracker-core, workout-core). Усі 16 семантично однакові (локальний час,
  `getMonth()+1`, `padStart(2,'0')`); `toISOString().slice(0,10)` (UTC) у js/
  не вживається жодного разу — отже питання A9 «ключ дня в UTC чи локально»
  для застосунку має відповідь «локально, послідовно». RELEASE.md §5 називає
  це навмисним (незалежність ядер).
- **Межі ваги/зросту/віку.** П'ять копій одного правила з однаковими
  значеннями: nutrition-core LIMITS (30–300 / 120–250 / 10–100), onboarding-core
  LIMITS, account.js FIELD_RANGE і NUM_LIMITS, agegate.js inRange(30,300),
  measure.js (30/300 літералами). Розбіжностей немає. `account.js FIELD_RANGE.daysPerWeek
  [1,7]` проти програм (3–6) і сервера `elo_planned_for` (3–7) — розбіжність
  без наслідків для рейтингу (сервер клампить), лише для оптимістичної дельти.
- **Нік.** Клієнт (welcome.js:659) перевіряє лише довжину 3–13; сервер
  (`register_request`) — ще й набір символів `^[[:alnum:]А-Яа-яІіЇїЄєҐґʼ'_. -]+$`
  і CHECK 3..13 у `account_status`. Клієнт показує серверну відмову як
  «Нік зайнятий або некоректний» — не баг, але правило живе лише на сервері,
  а підказка в UI («3–13 символів») неповна.
- **Пароль.** `password-core.js` MIN_LEN=8 дублює «Minimum password length» у
  Supabase Auth (поза репозиторієм) — звірити неможливо без панелі (домен A11).
- **Версії правових документів.** `js/legal-versions.js` (1.1/1.1/1.0),
  legal.html (рядки 71/152/201) і `consent_log` у базі (1.1/1.1/1.0) — збігаються.
- **Обсяг бойових даних (2026-09-05):** account_status 2 (обидва approved),
  profiles 2 (version 10 обидва), consent_log — записи лише в 1 з 2 користувачів
  (другий зареєстрований до міграції consents_and_deletion), admins 1,
  season_state 1, elo_events 2, elo_week_plan 1, season_history 0, awards 0.
  Мала база означає, що продуктивність міграцій/індексів (A10) наразі не
  перевіряється даними.
- **Гілки.** Хмарна копія на `master` без remote; `tools/auto-publish.sh` пушить
  `BRANCH="main"`, і CI слухає лише `main` — для продакшену коректно; лише не
  плутати при перенесенні комітів.
- **Мертві ключі конфігу й вшиті числа нагород** — деталі в INV-007; `elo_close_season`
  також вшиває «2026-12-03» лише в коментарі cron.sql (фактичний кінець AUTUMN-2026 —
  2026-11-30 + submitWindowDays 2 → сезон остаточний із 2026-12-03; збіг).
- **`db/security-hardening.sql`** — «журнал» з однією політикою; корисний як
  документ моделі доступу, але не як установник (INV-001).
- **Тести на неіснуючий код:** немає (усі 22 модулі, які вантажать tests/*.test.js,
  існують). Ядра без тестів: `bmi-core.js`, `measure-core.js`.
- **`EloApi.closeSeasonIfDue` / `elo_close_season` привʼязані до auth.uid()** —
  відома проблема §2.3 PROMPT; підтверджено читанням `db/cron.sql` («ЩО СЮДИ ЩЕ НЕ
  ДОДАНО») і тіла `elo_close_season` (uid := auth.uid()). Не відкриваю повторно.
