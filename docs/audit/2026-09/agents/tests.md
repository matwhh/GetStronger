# Аудит 2026-09 — домен «Тести, довіра до них, мутаційна перевірка» (TST)

Агент: tests. Phase A, тільки читання. Уся робота — в ізольованій копії
`/tmp/audit-tests/repo` (git clone з `/root/work/forgesite`, HEAD `964429b`).
Оригінальний репозиторій не змінювався (окрім цього файла).

## Обсяг і метод

- `npm test` (node:test, Node v22.22.2) — двічі, порівняння виводу без полів тривалости.
- `node tools/ci-hygiene.mjs`.
- Кожен `tests/*.test.js` окремо (`node --test tests/<файл>`) — перевірка залежности від порядку.
- Читання кожного тестового файла: що перевіряє, поведінка чи реалізація, витік стану, тавтології.
- Мутаційна перевірка: правдоподібний баг у `js/*-core.js` → `npm test` → `git checkout -- <файл>`.
- Таблиця покриття підсистем (A2) — юніт/інтеграція/браузер/негативні/конкурентність; браузерні — лише за читанням `tools/verify*.mjs` (Playwright у копії недоступний, node_modules нема).
- Шляхи «тести зелені — продакшен зламаний».
- Другий прогін (2026-09-06, після обриву контексту): повторна перевірка тверджень першого прогону (`npm test`,
  hygiene, `simelo`, 6 вибіркових мутантів M07/M18/M35/M42/M51/M52 — усі відтворились), чотири SQL-набори
  `db/*-tests.sql` + `db/sim-week.sql` проти бойової бази в `BEGIN … ROLLBACK` (відкат гарантований `RAISE EXCEPTION`,
  контрольні SELECT-и після кожного — 0 слідів), розбір усіх 24 тестових файлів, таблиця покриття, шляхи «зелено при
  зламаному продакшені».

## Що перевірено

### Прогони

| Прогін | tests | suites | pass | fail | cancelled | skipped | todo | duration_ms | wall |
|---|---|---|---|---|---|---|---|---|---|
| `npm test` #1 | 483 | 125 | 483 | 0 | 0 | 0 | 0 | 3149.2 | 3.93 s |
| `npm test` #2 | 483 | 125 | 483 | 0 | 0 | 0 | 0 | 3085.8 | 3.27 s |
| `node tools/ci-hygiene.mjs` | — | — | — | — | — | — | — | — | 0.12 s, «чисто (2515 файлів перевірено)», exit 0 |

Порівняння прогонів #1 і #2 (`diff` без рядків `duration_ms`/`real`/`user`/`sys`): **ідентичні** — недетермінізму
на рівні результатів не виявлено.

### Кожен файл окремо (`node --test tests/<файл>`)

| Файл | tests | suites | pass | fail | duration_ms |
|---|---|---|---|---|---|
| adherence-core.test.js | 22 | 4 | 22 | 0 | 107 |
| age-core.test.js | 20 | 4 | 20 | 0 | 104 |
| boxing.test.js | 18 | 3 | 18 | 0 | 103 |
| data.test.js | 24 | 6 | 24 | 0 | 126 |
| day-core.test.js | 7 | 2 | 7 | 0 | 99 |
| elo-core.test.js | 28 | 8 | 28 | 0 | 121 |
| elo-season-close.test.js | 4 | 1 | 4 | 0 | 96 |
| exercise-core.test.js | 19 | 3 | 19 | 0 | 112 |
| history-core.test.js | 24 | 6 | 24 | 0 | 119 |
| meals-schema.test.js | 8 | 0 | 8 | 0 | 92 |
| nutrition-core.test.js | 24 | 8 | 24 | 0 | 540 |
| onboarding-core.test.js | 29 | 5 | 29 | 0 | 114 |
| onerm-core.test.js | 25 | 6 | 25 | 0 | 116 |
| password-core.test.js | 22 | 7 | 22 | 0 | 111 |
| per-set-weight.test.js | 30 | 6 | 30 | 0 | 113 |
| periodization-core.test.js | 12 | 5 | 12 | 0 | 101 |
| programs-sex.test.js | 27 | 5 | 27 | 0 | 119 |
| progress-core.test.js | 18 | 6 | 18 | 0 | 108 |
| rename-exercise.test.js | 13 | 3 | 13 | 0 | 140 |
| reps-core.test.js | 12 | 4 | 12 | 0 | 102 |
| season-core.test.js | 12 | 3 | 12 | 0 | 97 |
| store-core.test.js | 23 | 11 | 23 | 0 | 181 |
| tracker-core.test.js | 46 | 15 | 46 | 0 | 151 |
| workout-core.test.js | 16 | 4 | 16 | 0 | 107 |
| **Разом** | **483** | **125** | **483** | **0** | — |

Сума по файлах = сумі `npm test` (483/125). Жоден файл не падає поодинці — залежности від порядку файлів немає.

### Детермінізм: часовий пояс і системний час

`npm test` під `TZ=` UTC, Europe/Kyiv, America/Los_Angeles, Pacific/Kiritimati (+14), Pacific/Pago_Pago (−11),
Asia/Kolkata (+5:30), Australia/Lord_Howe (+10:30/DST 30 хв) — усі 7 прогонів 483/483.

Підміна «зараз» (власний preload `/tmp/audit-tests/fake-now.mjs`: `new Date()` без аргументів і `Date.now()` повертають
фіксований час; перевірено, що підміна доходить у vm-пісочницю `tests/helpers.js` — `HistoryCore.todayKey()` повертав
підроблену дату). Дати: 2026-09-05 12:00, 2026-12-31 23:59:30, 2027-01-01 00:00:10, 2027-02-28, 2028-02-29,
2026-03-01 00:00, 2030-06-15, 2026-05-31 (вікно бага `setMonth(-3)`), 2026-10-25 02:30 (перехід на зимовий час) —
усі 9 прогонів 483/483. **Тести не залежать ні від пояса, ні від дня запуску.**

### Фактичне покриття модулів `js/` юніт-тестами

`node --experimental-test-coverage` не бачить скриптів, виконаних через `vm.runInContext` (показує лише `tests/*`),
тому покриття зібрано з сирого `NODE_V8_COVERAGE` власним скриптом (`/tmp/audit-tests/covreport.mjs`; рядки без
порожніх і коментарів; функція «не виконана», якщо лічильник входу = 0 у всіх 24 процесах):

| Модуль | Рядки | Іменовані функції | Не виконано жодного разу |
|---|---|---|---|
| js/adherence-core.js | 151/152 = 99.3 % | 8/8 | — |
| js/age-core.js | 55/58 = 94.8 % | 5/6 | `isValidBirthDate` |
| js/boxing-data.js | 211/211 = 100 % | 4/4 | — |
| js/day-core.js | 58/58 = 100 % | 9/9 | — |
| js/elo-core.js | 145/160 = 90.6 % | 17/20 | `seasonLabel`, **`activityDelta`**, **`cleanWeek`** |
| js/exercise-core.js | 233/240 = 97.1 % | 10/11 | `isMetric` |
| js/exercises.js | 172/178 = 96.6 % | 3/4 | `exercisesForMuscles` |
| js/foods.js | 345/364 = 94.8 % | 4/7 | `convertible`, `rawFor`, `cookedFrom` |
| js/history-core.js | 163/173 = 94.2 % | 10/10 | рядки 240–249: санітизація `ex[].s` (вага/повтори кожного підходу) |
| js/nutrition-core.js | 264/264 = 100 % | 10/10 | — |
| js/onboarding-core.js | 82/82 = 100 % | 9/9 | — |
| js/onerm-core.js | 115/115 = 100 % | 13/13 | — |
| js/password-core.js | 147/147 = 100 % | 10/10 | — |
| js/periodization-core.js | **120/206 = 58.3 %** | 8/12 | **`buildCycle`**, **`estimateOneRM`**, **`applyRaise`**, `midReps` |
| js/programs-data.js | 634/634 = 100 % | 2/2 | — |
| js/progress-core.js | 213/254 = 83.9 % | 17/21 | **`sessionEntries`, `sessionMinutes`, `timeStats`, `prList`** |
| js/recipes-data.js | 64/64 = 100 % | — | — |
| js/reps-core.js | 38/38 = 100 % | 4/4 | — |
| js/season-core.js | 64/68 = 94.1 % | 8/8 | рядки 112–114, 139 |
| js/store.js | 686/833 = 82.4 % | 51/60 | `onChange`, `remember`, `pendingCount`, `accountCached`, **`deleteAccount`**, **`updatePassword`**, **`adoptLocalProfile`**, **`discardLocalProfile`**, **`saveProfileBeacon`** |
| js/tracker-core.js | 450/464 = 97.0 % | 38/40 | `setSource`, `byType` |
| js/workout-core.js | 225/266 = 84.6 % | 20/24 | `clampDay`, **`rawDay`, `readDay`, `writeDay`** |

Модулі `js/`, які **не завантажує жоден тест** (26 із 52): account.js (1771 рядків), admin-elo.js, admin.js, agegate.js,
app.js (1732), **bmi-core.js (119)**, boxing.js, cardio.js, elo-api.js, elo-hooks.js, errors.js, journal.js (1877),
legal-versions.js, **measure-core.js (150)**, measure.js, nutrition.js, onerm.js, periodization.js, projection.js,
season.js, supplements-view.js, supplements.js, today.js, trackers-day.js, trackers-settings.js, welcome.js (1422).
За конвенцією §2.1 (`*-core.js` — «чиста логіка під тести») два `*-core.js` без тестів — розходження з описом (див. TST-INFO).

### Паритет `js/elo-core.js` ↔ бойова `public.elo_action_delta` (SELECT-only)

1. `select data from public.elo_config where id = 1` → 39 листових ключів, **0 розходжень** із `db/elo-config.json`
   (`updated_at` 2026-08-30 22:12 UTC).
2. Сітка 324 payload-ів (workout по вправах і по підходах × plannedDays 1…7, grace, `total=0`; meal 12 рівнів kcal ×
   10 варіантів білка, `target=0`; sleep 4 цілі × 11 значень і без `goal`; recovery 8 значень включно з `null`;
   activity 3 цілі × 14 значень і без `goal`) порахована в `EloCore.actionDelta` і в бойовій `elo_action_delta(kind,
   payload, cfg, pd, grace)` (функція `immutable`, один SELECT з `lateral`). **delta: 324/324 збігів; quality: 324/324
   (допуск 0.0015 через `round(q,3)` на сервері).** Скрипти: `/tmp/audit-tests/parity-gen.mjs`, `parity.sql`.

Отже сьогодні паритет є, але його не стереже жоден автоматичний тест (див. TST-004).

### Інші безпечні інструменти

- `node tools/simelo.mjs` (детермінована симуляція сезону, без мережі): **exit 1, «5/6 цілей балансу влучено»** —
  профіль Excellent дає 1841 і 1849 ELO (Level 10) у 2 з 5 сідів при цілі `< 1800` (див. TST-011). 0.10 с.
- `tools/sim90/*` — «TEMPORARY AUDIT HARNESS» під Playwright, не запускався.

### SQL-тести проти бойової бази (другий прогін агента, 2026-09-06)

Три скрипти `db/*-tests.sql` — це `DO $$ … RAISE EXCEPTION $$` (усе відкочується самим винятком — патерн §1.1);
запущені через `execute_sql` додатково всередині `BEGIN … ROLLBACK`. Після кожного — контрольний SELECT на тестові
uuid `00000000-0000-4000-8000-00000000…` у `auth.users`, `profiles`, `account_status`, `season_state`, `elo_events`,
`awards`: **0 рядків** (слідів немає).

| Скрипт | Результат | Примітка |
|---|---|---|
| `db/elo-tests.sql` | **20 з 20 пройдено** | атаки payload-ом, дублікати, вікно, тижневий бюджет тренувань 51 |
| `db/elo-integrity-tests.sql` | **28 з 28 пройдено** | ротація ключів, знімок плану, реконсиляція, бюджет 200, закриття сезону, unique-обмеження |
| `db/multiuser-tests.sql` | **21 з 21 пройдено** | нік, RLS, незалежні бюджети, лідерборд, pending, адмін-RPC |

Разом **69 SQL-перевірок зелені** на живих функціях і живому `elo_config`. Жоден із них не в CI (потребують запису в
`auth.users`, хай і з відкатом) — див. TST-015. Слабкий assert: «нагороди видано один раз» перевіряє `n >= 1`, а факт —
**7 нагород** за сезон із `daysActive: 0` (див. TST-016).

### Мутаційна перевірка — 57 мутантів

Метод: `/tmp/audit-tests/mutate.mjs` підміняє один рядок (точний унікальний збіг), запускає
`node --test --test-reporter=tap tests/*.test.js`, збирає `# pass/# fail` і назви впалих тестів, повертає файл
`git checkout -- <файл>` і перевіряє `git status --porcelain` (порожній після кожного мутанта). Базова лінія до і після —
483/483. Повний журнал: `/tmp/audit-tests/mutation-run.log`, `mutation-results*.json`.

| ID | Файл | Мутант (правдоподібний баг) | Результат |
|---|---|---|---|
| M01 | elo-core.js | стеля сезону 2500 знята (`clampElo`) | ВПАВ (1): «стеля 2500» |
| M02 | elo-core.js | workout без clamp частки до 1 | ВПАВ (1): «накрутка понад план клампиться» |
| **M03** | elo-core.js | activity без clamp кроків до цілі | **ВИЖИВ** — `activityDelta` не має жодного тесту; майже еквівалентний: драбина все одно дає 1.0, різниться лише `quality` (adherence-core його клампить) |
| **M04** | elo-core.js | `cleanWeek` `>=` → `>` | **ВИЖИВ** — `cleanWeek` без тестів; у продакшен-сторінках не викликається (лише `tools/simelo.mjs`), бонус рахує сервер |
| M05 | elo-core.js | знак штрафу `weekPenalty` | ВПАВ (2) |
| M06 | elo-core.js | прибрано «без proteinTarget — калорії 100 %» | ВПАВ (1, через adherence-core.test) |
| **M07** | elo-core.js | ELITE з `>= 2000` → `> 2000` | **ВИЖИВ** — межа рівня рівно на 2000 не перевіряється (тести беруть 1942 і 2247) |
| M08 | elo-core.js | `seasonDay` без `+1` | ВПАВ (2) |
| M09 | elo-core.js | зима січня підписана поточним роком | ВПАВ (2) |
| M10 | elo-core.js | знято підлогу втрат дня | ВПАВ (1) |
| M11 | history-core.js | t0 = `tNew \|\| tOld` (старий баг) | ВПАВ (1): «початок сесії не перетирається» |
| M12 | history-core.js | t1 без `prev.t1` (старий баг) | ВПАВ (1): «запис не по порядку» |
| M13 | history-core.js | знято `t1 >= t0` | ВПАВ (1) |
| M14 | history-core.js | відʼємна вага дозволена | ВПАВ (1) |
| **M15** | history-core.js | `ex[].s[].w` без межі 500 кг | **ВИЖИВ** — рядки 240–249 (санітизація підходів у знімку) не виконуються жодним тестом |
| M16 | history-core.js | `ex[].kg` без межі 500 | ВПАВ (1) |
| M17 | nutrition-core.js | підлога калорійности знята | ВПАВ (2) |
| **M18** | nutrition-core.js | `PROTEIN_MAX_SHARE` 0.35 → 0.50 | **ВИЖИВ** — тест «білок ніколи не перевищує 35 %» порівнює з самою константою `N.PROTEIN_MAX_SHARE` |
| M19 | nutrition-core.js | `LIMITS.age` до 1000 | ВПАВ (1) |
| M20 | nutrition-core.js | Mifflin: `5·age` → `4·age` | ВПАВ (3) |
| **M21** | onerm-core.js | `oneRepMax` без фільтра 2.5× | **ВИЖИВ** — еквівалентний: у межах `MAX_REPS=36` медіана/вага ≤ 1.908, фільтр недосяжний |
| **M22** | onerm-core.js | `oneRepMax(w>500, 1)` повертає вагу | **ВИЖИВ** — межа `MAX_WEIGHT` в `oneRepMax` не тестується (див. TST-009) |
| M23 | onerm-core.js | `estimates` приймає 0 повторень | ВПАВ (1) |
| M24 | periodization-core.js | `pctForWeek` off-by-one | ВПАВ (2) |
| M25 | periodization-core.js | `currentWeek` round замість floor | ВПАВ (1) |
| M26 | periodization-core.js | знак деслоуду | ВПАВ (2) |
| **M27** | periodization-core.js | `buildCycle` без стелі інтенсивности (ізоляція 75 % → 90 %) | **ВИЖИВ** — `buildCycle` без тестів |
| **M28** | periodization-core.js | `buildCycle` ігнорує заморожений 1ПМ | **ВИЖИВ** |
| **M29** | periodization-core.js | `estimateOneRM`: RIR без стелі 5 | **ВИЖИВ** |
| M30 | age-core.js | `MIN_AGE` 17 → 16 | ВПАВ (5) |
| M31 | age-core.js | без поправки «ДН ще не настав» | ВПАВ (4) |
| M32 | age-core.js | дата з майбутнього приймається | ВПАВ (2) |
| M33 | onboarding-core.js | історія обходить ворота віку | ВПАВ (1) |
| M34 | onboarding-core.js | activePlan без programId зараховано | ВПАВ (1) |
| **M35** | progress-core.js | `sessionMinutes` `min >= 1` → `>= 0` (t0 === t1 → 0 хв у статистику) | **ВИЖИВ** — `sessionMinutes`/`timeStats` без тестів (§2.3: дві бойові сесії з t0 === t1) |
| **M36** | progress-core.js | `sessionMinutes` без стелі 6 год | **ВИЖИВ** |
| **M37** | progress-core.js | `cutKey` — старий баг «31 день замість 30» | **ВИЖИВ** — регресія, описана в коментарі коду, тестом не закрита |
| **M38** | progress-core.js | `foodStats` ±5 % → ±10 % | **ВИЖИВ** |
| M39 | progress-core.js | явний 0 у workLog не перекриває сесію | ВПАВ (1) |
| **M40** | progress-core.js | `prList`: перший запис — рекорд | **ВИЖИВ** — `prList` без тестів |
| M41 | progress-core.js | вага тіла без стелі 300 | ВПАВ (1) |
| **M42** | workout-core.js | `readDay` без перевірки дати (учорашні галочки сьогодні) | **ВИЖИВ** — `rawDay/readDay/writeDay/clampDay` без тестів |
| M43 | workout-core.js | `normWeight` без стелі 500 | ВПАВ (2) |
| M44 | adherence-core.js | знято кеп 100 % | ВПАВ (1) |
| M45 | tracker-core.js | вода без стелі 15 л | ВПАВ (1) |
| M46 | season-core.js | `contains` виключає день старту | ВПАВ (1) |
| M47 | store.js | `cloudAllowed` fail-open | ВПАВ (1) |
| M48 | store.js | `isMeaningful` без SKIP | ВПАВ (2) |
| M49 | password-core.js | `MIN_LEN` 8 → 6 | ВПАВ (1) |
| M50 | elo-core.js | recovery `null` дає повну цінність | ВПАВ (1) |
| **M51** | elo-api.js | `closeSeasonIfDue`: повернуто старий баг `setMonth(-3)` | **ВИЖИВ** — `tests/elo-season-close.test.js` тестує власну копію функції, а не `js/elo-api.js` (TST-001) |
| **M52** | meals.js | `applySchema`: зайві прийоми не переїжджають в останній (їжа зникає) | **ВИЖИВ** — `tests/meals-schema.test.js` тестує копію, а не `js/meals.js` (TST-002) |
| **M53** | elo-core.js | `seasonLabel` Весна ↔ Осінь | **ВИЖИВ** — функція без тестів (лише підпис) |
| **M54** | store.js | `adoptLocalProfile` бере копію ПЕРЕД імпортом замість копії входу | **ВИЖИВ** — розвʼязання конфлікту входу без тестів (TST-010) |
| **M55** | history-core.js | `ex[].s[].r` без межі 200 | **ВИЖИВ** (те саме місце, що M15) |
| M56 | age-core.js | `latestAdultBirthDate` на рік пізніше | ВПАВ (1) |
| **M57** | store.js | `discardLocalProfile` не скидає кеш | **ВИЖИВ** (TST-010) |

**Підсумок: 57 мутантів, 35 упало, 22 вижило** (з них 2 практично еквівалентні — M03, M21). Правила, де вижили
мутанти, зібрано в знахідках TST-001, TST-002, TST-003, TST-005…TST-010. Ключові правила з ТЗ (t0 через `Math.min`,
t1 через `Math.max`, ворота віку 17+, стеля 2500, підлога калорійности, паритет бюджету 4/тиж = 6/тиж, fail-closed хмари,
власник локальних даних) — **тестами закриті**.

### Розбір кожного тестового файла (24 файли, 483 тести)

Метод: читання повного тексту кожного файла; перевірка на `.skip/.todo/.only` (**0**), `assert.ok(true)` (**0**), реальний
час (`new Date()`/`Date.now()` без аргументів — 4 місця, усі нешкідливі: `expires_at` у майбутньому, `t` патча,
`currentWeek` без `startedAt` → `null` незалежно від дати). Усі модулі вантажаться через `vm.runInContext`
(`tests/helpers.js`), кожен файл робить власний контекст — стан між файлами не тече. Усередині файла контексти
переважно спільні на рівні `describe` (`const X = loadModules(...)`), але ядра чисті й повертають копії (це саме
перевіряють тести «не мутує вхід» у history/reps/season/tracker).

| Файл | Що перевіряє | Поведінка чи реалізація | Стан між тестами | Слабкі/тавтологічні assert-и |
|---|---|---|---|---|
| adherence-core | відсоток виконання плану тренувань/харчування, обрізання періоду, стани `noplan/nodata/resttoday/openday` | поведінка (приклад ТЗ 90 %, пропуск = 0) | чистий | «68 %» — пін дзеркала зон (визнано в коментарі) |
| age-core | `ageOn/isAdult/gateState/latestAdultBirthDate`, високосні дні, межа 17 | поведінка | чистий | — |
| boxing | дані сесії боксу ↔ текст для буфера: жоден пункт не губиться | поведінка (дані) | чистий (`TEXT` обчислений раз) | «функція чиста» порівнює з тим самим викликом — слабкий, але не тавтологія |
| data | довідники MUSCLES/EXERCISES/FOODS/PROGRAMS: унікальність, посилання, стелі обʼєму, КБЖВ, пошук | дані | чистий | **«стеля обʼєму відповідає розміру групи» — тавтологія** (TST-013) |
| day-core | сума дня раціону, биті id → 0, рецепти, `containers=0` | поведінка | чистий | — |
| elo-core | сезони, рівні, `actionDelta` по категоріях, grace, `weekPenalty`, `cleanDay`, стелі дня, `seasonDay` | поведінка + паритет із SQL (`base` формула) | чистий | межа ELITE = 2000 не перевірена (TST-003); `activityDelta`, `cleanWeek`, `seasonLabel` — 0 тестів |
| elo-season-close | попередній сезон для `elo_close_season`, 366 днів | **реалізація-копія в тесті**, не `js/elo-api.js` (TST-001) | чистий | тест «стара реалізація ламалась» — доказ, а не охорона |
| exercise-core | серія вправи, метрики із закритих підходів, PR, тренд по третинах | поведінка | чистий | — |
| history-core | append-only weightLog, `upsertSession`, `closeDay`, **t0 = min / t1 = max**, `t1 >= t0`, санітизація `ex[]` | поведінка | чистий | `ex[].s` (підходи) не подаються (TST-005) |
| meals-schema | `mealNames/mealCount` + **копія `applySchema`** | копія реалізації (TST-002) | чистий | «не втрачає жодної позиції» хибне при > 60 позиціях |
| nutrition-core | BMR (Mifflin/Katch), баланс макросів на > 10 000 профілів, білок 1,6–2,2, підлога калорій, прогноз маси, ІМТ | поведінка (сітки) | чистий | **«білок ≤ 35 %» порівнює з константою модуля** (TST-008) |
| onboarding-core | `stepFor` по кожному полю, історія = доказ, вік не обходиться, маршрути `isAllowed` | поведінка | чистий | — |
| onerm-core | 7 формул vs канон, `estimates` запобіжники, `oneRepMax` монотонність, `percentOfMax` | поведінка | чистий | `oneRepMax` межі не перевірені (TST-009) |
| password-core | довжина, латиниця, 4 класи, словники/візерунки, власні дані, що МАЄ проходити | поведінка | чистий | — |
| per-set-weight | вага належить підходу: `normWeight/normReps/setDoneSets/editSet`, `pointOf/prFromSessions` | поведінка | чистий (`base` не мутується — перевірено) | — |
| periodization-core | `normalize`, `pctForWeek` межі, `currentWeek` календарно, `applyDeload` | поведінка | чистий | «не чіпає некоректні» приймає майже будь-що (TST-013); `buildCycle/estimateOneRM/applyRaise` — 0 тестів (TST-007) |
| programs-sex | доступ до схем за статтю, `resolvePlan` (в т. ч. `customPlans`), дані women3/women4, обʼєми | поведінка + дані | чистий | пінні числа обʼємів (навмисно) |
| progress-core | `bodyStats`, `forecast`, `liftStats/bestLift`, `trainingStats`, `foodStats`, `sessionCounts/trainedDates` | поведінка | чистий | `sessionMinutes/timeStats/prList/cutKey` — 0 тестів (TST-006) |
| rename-exercise | міграція профілю 9→10: customPlans, weights, weightLog злиття, сміття | поведінка через `Store.localProfile()` | окремий `loadStore` на тест | — |
| reps-core | стаж × розмір групи → діапазон, `applyPlan` не мутує, усі програми | поведінка | чистий | `ALLOWED` оголошена й не вжита (TST-013) |
| season-core | межа періоду 2026-09-01, локальна доба, `clip/clipSeries` не мутують | поведінка | чистий | — |
| store-core | `isMeaningful`, власник локальних даних (A→B), 401 vs 403, fail-closed хмари, квота, dirty-позначка, порожній рядок, гонка `saveProfile`+`flushPending`, `clearLocal`, `redirect_to` | поведінка через підроблені `localStorage`/`fetch` | окремий `loadStore` на тест | сценарії обриваються на `merge === 'conflict'` (TST-010) |
| tracker-core | реєстр, custom, `logValue/addDelta` клампи, streak, summaries, години/хвилини, креатин | поведінка | спільний `trackers` (immutable API) | — |
| workout-core | `plannedSets/doneSetsFor/dayStats/dayMinutes`, тиждень, блокування завершених | поведінка | чистий | `readDay/writeDay/rawDay/clampDay` — 0 тестів (TST-010) |

Висновок: тести переважно **поведінкові**, детерміновані, ізольовані. Три файли тестують не продакшен-код, а його копію
або дзеркало (`elo-season-close`, `meals-schema`, частково `elo-core` для SQL). Тавтологій — 1, слабких assert-ів — 4
(TST-013, TST-016).

### Таблиця покриття підсистем (A2)

Легенда: ✓ є; ~ частково; — немає; (CI core) — на кожен пуш у `main`; (CI full) — лише щоночі/вручну; (ручн.) — не в
CI; браузерні оцінено **лише читанням** `tools/verify*.mjs`.

| Підсистема | Юніт | Інтеграція | Браузер | Негативні | Конкурентність | Статус |
|---|---|---|---|---|---|---|
| Автентифікація | ~ store-core: signIn/signOut/401/403/redirect_to/adoptUrlSession (9 тестів) | — | verifyregister/regfail/regresume/recover (ручн., бойовий Supabase); verifysleepremember «Запамʼятати» (CI full) | ~ 401/403/429/зайнята пошта (verifyregfail ручн.) | — | **частково; серверна частина лише вручну** |
| Онбординг | ✓ onboarding-core 29, age-core 20 | — | verifyonboard (щасливий шлях), verifyonboarding (обхід URL/історія/localStorage), verifyagegate 43 (CI full) | ✓ підроблений localStorage, дитяча дата, імпорт | — | добре; браузер лише щоночі |
| Профіль | ✓ store-core 23, rename-exercise 13 | ~ store ↔ fetch-підробка | verifydata, verifyroundtrip (CI core); verifyimport (full) | ✓ квота, битий JSON (verifyhardening) | ~ 1 тест (`saveProfile`+`flushPending`) | добре |
| Плани | ✓ programs-sex 27, reps-core 12, data 24 | — | verifysexplans, verifyplanfields, verifyreps, verifywomen3 (full) | ~ чужа стать, `customPlans` | — | добре |
| Виконання тренування | ✓ workout-core 16, per-set-weight 30 | — | verifyworkout 76, verifyloop (CI core); verifypersetweight (full) | ✓ сміття в підходах; verifychaos2 | ~ подвійні кліки в verifychaos/chaos2 | **`readDay/writeDay` без юніта (TST-010)** |
| Історія / час сесії (t0/t1) | ✓ history-core 24 (6 на t0/t1) | — | verifyhistory 21 (CI core) | ✓ `t1 < t0`, без часу | — | добре для history; `sessionMinutes` — TST-006 |
| Прогрес / статистика | ~ progress-core 18, exercise-core 19 | — | verifyexercise (full) | ~ | — | **аналітика часу сесій, PR, `cutKey` без тестів (TST-006)** |
| Харчування | ✓ nutrition-core 24, day-core 7, data(foods) | — | verifyflows, verifya11y модалка (full); verifyfix90 грами/опівніч | ✓ LIMITS, NaN, Infinity | — | **`applySchema` (втрата позицій) — TST-002; 35 % — TST-008** |
| 1RM | ✓ onerm-core 25 | — | — | ~ лише `estimates` | — | `oneRepMax` межі — TST-009 |
| Періодизація | ~ periodization-core 12 (58 % рядків) | — | tools/sim90/repro-periodization (ручн.) | ~ `normalize` | — | **`buildCycle` без тестів (TST-007)** |
| ELO / рейтинг | ✓ elo-core 28 + adherence-core 22 | ✓ **SQL: 69/69** (elo-tests 20, integrity 28, multiuser 21) + sim-week 21/22 (ручн., цей аудит) | verifyloop (сабміт через UI, offline) | ✓ payload-атаки, ключі, вікно, бюджет (SQL) | ✓ гонка «подія вже є» (SQL, але див. TST-015) | сервер добре; **паритет JS↔SQL не стережеться (TST-004); клієнт `elo-api.js` без тестів (TST-001)** |
| Статистика (періоди) | ✓ season-core 12 | — | verifyproduction (ручн., бойовий домен) | ✓ межа доби | — | добре |
| Локальний режим | ✓ store-core `local:true`, rename-exercise | — | усі verify по `file://` працюють у локальному режимі | ✓ verifyhardening (битий JSON, quota) | — | добре |
| Хмара | ✓ store-core (fail-closed, статуси, 401/403) | ~ fetch-підробка | — (CI глушить домени навмисно) | ✓ 500 від `account_state`, мережевий збій | ~ | добре на рівні store |
| Синхронізація | ✓ store-core dirty/pending/порожній рядок | — | — | ✓ обрив запису | ~ 1 тест | **`adoptLocalProfile/discardLocalProfile` без тестів (TST-010)** |
| Вихід / зміна акаунта | ✓ store-core A→B, обірвана сесія, `clearLocal`, ELO-стан | — | verifyfix90 B6 «Вийти» (full) | ✓ | — | добре |
| Адмін | — | ✓ SQL multiuser: `admin_requests/anomalies/decide` FORBIDDEN для звичайного | — | ✓ (SQL) | — | UI (`admin.js`, `admin-elo.js`) без тестів |
| PWA / SW | — | — | verifysw 3 перевірки (full; HTTP-сервер) | — | — | **слабко: лише «відкривається офлайн»; оновлення/застрягання не перевіряється** |
| Помилки / Sentry | — | — | verifyerrors 21 (PII у конвертах) — **поза CI** (TST-012) | ✓ (у verifyerrors) | — | слабко |
| RLS | — | ✓ SQL: чужий профіль 0 рядків, `elo_week_plan` недоступна, `is_approved` чужого | verifyauthz (ручн., anon по бойовому) | ✓ | — | лише ручні SQL-скрипти; матриця — домен rls |
| Функції БД | — | ✓ SQL 69/69 | — | ✓ | ✓ 1 сценарій | добре, але поза CI (TST-017) |
| Cron | — | ~ sim-week: запобіжники `elo_eval_week_for` (week_not_over/not_monday/other_season) | — | ✓ | — | сама математика тижня не перевірена автоматично |
| Міграції | — | — | — | — | — | **немає: дрейф `db/*.sql` ↔ жива схема ніхто не стереже** |

### Чи можуть тести бути зеленими при зламаному продакшені — конкретні шляхи

Так. Ворота перед пушем (`tools/auto-publish.sh`) — це лише `node --test tests/*.test.js` + `ci-hygiene`; браузерні
перевірки йдуть у GitHub Actions **паралельно** з деплоєм Vercel (§2.3 «CI не є воротами»). Отже все, чого не бачить
`npm test`, доїжджає в продакшен:

1. **`js/config.js`** — жоден тест його не вантажить (grep по `tests/` — 0 збігів). Хибний `supabase.url`/`anonKey`
   або `siteUrl` → сайт «локальний» для всіх; `npm test` 483/483. `ci-hygiene` ловить лише роль JWT ≠ anon і DSN.
2. **26 із 52 модулів `js/`** не завантажуються тестами: `app.js`, `journal.js`, `account.js`, `welcome.js`,
   `elo-api.js`, `agegate.js`, `errors.js`, `today.js`, `nutrition.js`, `periodization.js`, `admin*.js` тощо.
   Синтаксична помилка в будь-якому з них → біла сторінка; `npm test` зелений. Ловить лише `verify7` (CI core,
   після пушу).
3. **`js/elo-api.js` — клієнт ELO** (черга `ib.eloPending`, `closeSeasonIfDue`, catch-up) — 0 тестів; M51 показав, що
   старий баг закриття сезону повертається непомітно.
4. **Паритет ELO JS ↔ SQL**: правка `db/elo-proportional.sql` або `elo-core.js` окремо → клієнт показує одну дельту,
   сервер пише іншу; жоден автоматичний тест не звіряє (TST-004; сьогодні 324/324 збігів — вручну).
5. **`db/elo-config.json` ↔ `public.elo_config`**: тести беруть JSON із репозиторію; якщо в базі змінити `weeklyBudget`,
   усі 28 тестів elo-core лишаються зеленими (сьогодні 0 розходжень — перевірено SELECT-ом у першому прогоні).
6. **Схема бази**: жоден тест не звіряє `db/*.sql` із живою `information_schema`; перейменування колонки в
   `profiles`/`elo_events` → 500 від REST, тести зелені.
7. **HTML-сторінки та `<script src>`**: юніти не читають HTML. Сьогодні всі посилання цілі (перевірено скриптом — 0
   відсутніх), але зламати можна без червоного `npm test`.
8. **`sw.js`**: `SHELL` із 7 файлів (усі існують), `CACHE = 'forge-v1'` — жоден тест не перевіряє, що нова версія
   доїжджає (`verifysw` лише «відкривається офлайн», і лише щоночі).
9. **`auto-publish.sh` без `node`** (або node < 20): тести пропускаються, пуш іде (задокументовано в самому скрипті) —
   тобто навіть юніти не є гарантованими воротами.
10. **CI слухає `branches: [main]`**, а хмарний репозиторій `/root/work/forgesite` — гілка `master` без remote
    (INFO-4): результати Phase B потраплять під CI лише після доставки в теку релізу й пушу в `main`.

## Що НЕ перевірено і чому

- `tools/ci-browser.sh full` і будь-які `tools/verify*.mjs` — у копії немає `node_modules`/Playwright (за умовою домену);
  браузерні перевірки оцінено лише читанням коду скриптів.
- `verifyregister/verifyregfail/verifyregresume/verifyrecover/verifyproduction` — заборонені §1.2.
- ~~`db/*-tests.sql` не запускались~~ — **запущено в другому прогоні** (див. «SQL-тести проти бойової бази»): усі
  чотири скрипти, кожен у `BEGIN … DO … RAISE EXCEPTION … ROLLBACK`, слідів 0.
- Мутації в SQL-функціях — неможливі без DDL у бойовій базі (заборонено §1.1); паритет SQL перевірено лише
  «як є».
- Справжня тижнева оцінка `elo_eval_week_for` (математика бонусів/штрафів тижня) — sim-week перевіряє лише її
  запобіжники; сама формула вимагає завершеного тижня в поточному сезоні (перший — 7 вересня), тож автоматично
  не перевірена ніким.
- `tools/sim90/*` (Playwright) — не запускався (немає Playwright у копії).
- Vercel/Sentry-телеметрія — поза доменом (лише `list_teams/list_projects/get_project` для гілки деплою; у команді
  `mold1` видно лише проєкт `mold-site-updated`, а не Forge — проєкт Forge, ймовірно, в іншому scope; не досліджував).
- Тест паритету «11/11» з README — у репозиторії відсутній, отже відтворити неможливо (див. TST-004).

## Знахідки

### TST-001 — `elo-season-close.test.js` тестує копію логіки, а не `js/elo-api.js`

```text
ID:                 TST-001
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           test-validity / ELO season close
Location:           tests/elo-season-close.test.js:19-23 (prevSeason визначена В ТЕСТІ); js/elo-api.js:216-219 (closeSeasonIfDue)
Description:        Тест «Обчислення попереднього сезону для elo_close_season» ганяє 366 днів через функцію prevSeason,
                    оголошену в самому тестовому файлі. Продакшен-реалізація в js/elo-api.js жодним тестом не завантажується
                    (grep loadModules по tests/ — elo-api.js відсутній; покриття V8 — файла нема в списку скриптів).
Why it matters:     Тест зелений незалежно від того, що написано в elo-api.js. Саме той баг, який він «стереже» (setMonth(-3)
                    → сезон не закривався ніколи: ні звіту, ні нагород), може повернутись непомітно.
Reproduction:       cd /tmp/audit-tests/repo; у js/elo-api.js:217-219 замінити на
                    `const p = new Date(now); p.setMonth(p.getMonth() - 3); const code = window.EloCore.seasonOf(p);`
                    (мутант M51); npm test → 483/483 зелені. git checkout -- js/elo-api.js.
Observed:           483 pass / 0 fail при відновленому бага.
Expected:           Щонайменше один тест падає.
Root cause:         elo-api.js — DOM/мережевий модуль без чистого ядра; замість винесення prevSeason у EloCore тест продублював логіку.
Impact:             Регресія закриття сезону (звіт, нагороди, історія сезонів) невидима для npm test і CI.
Recommended fix:    Винести `previousSeasonCode(now)` в js/elo-core.js, викликати його з elo-api.js і тестувати саме його;
                    прибрати копію з тесту (лишити prevSeasonOld як доказ).
Regression test:    tests/elo-core.test.js: `EloCore.previousSeasonCode(new Date(2026,4,31)) === 'WINTER-2025'` для всіх 365 днів
                    + grep-тест, що elo-api.js не містить `setMonth(`.
```

### TST-002 — `meals-schema.test.js` тестує копію `applySchema`; заявлена властивість «жодна позиція не губиться» хибна

```text
ID:                 TST-002
Severity:           MEDIUM
Confidence:         CONFIRMED (для тесту й його копії); PROBABLE (для js/meals.js — код ідентичний у частині зрізу)
Category:           test-validity / data-loss
Location:           tests/meals-schema.test.js:45-61 (копія applySchema(meals, count)); js/meals.js:89-111 (applySchema(meals, report))
Description:        Три тести файла («зменшення кількості прийомів не втрачає жодної позиції» та ін.) працюють із копією
                    applySchema, оголошеною в тесті. Копія вже розійшлась із оригіналом за сигнатурою (count ↔ report,
                    mealNames(count) ↔ mealSchema()). Продакшен-функція не тестується (мутант M52 — злиття прийомів вилучено —
                    483/483). Крім того, властивість тесту тримається лише на 1 позиції на прийом: обидві реалізації обрізають
                    останній прийом `slice(0, 60)`, і при 6 прийомах × 20 позицій → 3 прийоми виживає 100 зі 120.
Why it matters:     Зміна налаштування «кількість прийомів» на одній сторінці мовчки видаляє позиції раціону; report.moved у
                    meals.js рахується ДО зрізу, тож повідомлення «перенесено N» завищує те, що реально збережено.
Reproduction:       1) M52: у js/meals.js прибрати `last.items = last.items.concat(extra.items);` → npm test зелений.
                    2) node --input-type=module -e "…копія applySchema з тесту…; 6 прийомів по 20 позицій → applySchema(six, 3)"
                       → 100 позицій (було 120). Скрипт наведено в журналі агента.
Observed:           120 → 100 позицій без помилки; тест стверджує протилежне.
Expected:           Або обрізання явне (з відмовою/повідомленням), або тест перевіряє реальну межу.
Root cause:         meals.js тягне DOM і window.App — у пісочницю не вантажиться; логіку продублювали в тесті.
Impact:             Тиха втрата даних раціону при зменшенні кількости прийомів у користувача з > 60 позицій на «хвості».
Recommended fix:    Винести applySchema у js/nutrition-core.js (або day-core.js) з параметром names і полем report.dropped;
                    тестувати оригінал; у UI показувати, що частину позицій не перенесено.
Regression test:    applySchema(6×20 → 3): total === 120 або report.dropped === 20 і UI попереджає.
```

### TST-003 — Межа ELITE рівно на 2000 ELO не перевіряється

```text
ID:                 TST-003
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           test-gap / ELO рівні (відображення)
Location:           js/elo-core.js:78 (`const elite = e >= cfg.eliteFloor`); tests/elo-core.test.js:44-48
Description:        Мутант M07 (`>=` → `>`) виживає: тести перевіряють 1942 (не ELITE) і 2247 (ELITE), але не 2000. levelFor
                    використовують season.js, app.js, today.js, admin-elo.js.
Why it matters:     Користувач, який рівно досяг 2000, побачить «Level 10» замість «Level 10 — ELITE», інший floor/ceil/pct.
                    Правило належить економіці ELO (§A3), хоч і лише на боці показу — серверне значення не змінюється.
Reproduction:       M07 у /tmp/audit-tests/mutants.json → npm test 483/483.
Observed:           Зелено.
Expected:           Падіння тесту на межі.
Root cause:         Відсутній boundary-тест.
Impact:             Показ рівня; серверний ELO не зачеплено.
Recommended fix:    Додати `levelFor(2000).elite === true`, `levelFor(1999).elite === false`, `levelFor(2000).floor === 2000`.
Regression test:    те саме.
```

### TST-004 — Заявлений «тест паритету JS↔SQL 11/11» відсутній у репозиторії; паритет ELO не стережеться

```text
ID:                 TST-004
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           test-gap / documentation / ELO
Location:           js/elo-core.js:22 («Тест еквівалентності ганяє обидві реалізації…»); README.md:1635 («закрито тестом
                    паритету 11/11»); tools/README-verify.md («перевірявся разово при деплої рушія (11/11)… міняй ОБИДВА:
                    js/elo-core.js і db/elo-engine.sql»)
Description:        У tests/, tools/, db/ немає жодного артефакту цього тесту (grep «паритет|еквівалент»). Правила дельти
                    існують у двох реалізаціях (JS для оптимістичного показу/adherence і SQL для авторитетного запису), і
                    жоден автоматичний тест не звіряє їх. Крім того, README-verify вказує на db/elo-engine.sql, тоді як чинне
                    визначення elo_action_delta — у db/elo-proportional.sql (пізніший create or replace).
Why it matters:     Розходження JS↔SQL означає, що клієнт показує одну дельту, а сервер записує іншу (див. власний коментар у
                    elo-core.js про 55 % при відсутньому pTarget — такий баг уже був).
Reproduction:       Власна перевірка паритету (SELECT-only): 324 payload-и × EloCore.actionDelta проти бойової
                    public.elo_action_delta з бойовим elo_config → 324/324 збігів delta і quality (скрипти
                    /tmp/audit-tests/parity-gen.mjs, parity.sql). Тобто СЬОГОДНІ паритет є — але його ніщо не стереже.
Observed:           Документ посилається на тест, якого нема; паритет підтверджено вручну.
Expected:           Відтворюваний тест паритету в репозиторії.
Root cause:         Разова ручна перевірка при деплої, зафіксована лише текстом.
Impact:             Наступна правка формули в одній із реалізацій пройде npm test і CI.
Recommended fix:    Додати tests/elo-parity.fixtures.json (payload → очікувана delta), який (а) ганяє EloCore у npm test і
                    (б) окремим SQL-скриптом db/elo-parity-tests.sql (BEGIN…RAISE EXCEPTION) звіряє ті самі фікстури з
                    elo_action_delta. Виправити посилання README-verify на db/elo-proportional.sql.
Regression test:    елo-parity fixtures 324 випадки (готові в /tmp/audit-tests/parity-cases.json).
```

### TST-005 — Санітизація ваги/повторів кожного підходу у знімку сесії (`ex[].s`) не тестується

```text
ID:                 TST-005
Severity:           HIGH (за правилом домену: правило збереження даних без жодного тесту); фактичний ризик — MEDIUM,
                    бо перша лінія захисту (workout-core.normWeight/normReps при вводі) тестами закрита
Confidence:         CONFIRMED
Category:           test-gap / data-persistence
Location:           js/history-core.js:239-249 (upsertSession → row.s); tests/history-core.test.js
Description:        Рядки 240–249 не виконуються жодним тестом (покриття V8). Мутанти M15 (`w <= 500` знято) і M55
                    (`r <= 200` знято) виживають. Це єдина санітизація на шляху «імпорт резервної копії / битий localStorage →
                    sessionLog», з якого exercise-core бере топ-сет, обʼєм, e1RM і рекорди.
Why it matters:     Без цієї межі імпортований підхід `{w: 9999}` стає рекордом і точкою графіка; per-set-weight.test.js
                    перевіряє лише workout-core (вхід), а не збережений знімок.
Reproduction:       M15/M55 у /tmp/audit-tests/mutants*.json → npm test 483/483.
Observed:           Зелено.
Expected:           Падіння.
Root cause:         Тест «doneSets/totalSets/end/ex … санітизуються» подає ex без поля s.
Impact:             Регресія санітизації історії невидима.
Recommended fix:    Додати в history-core.test.js кейс із `s: [{w: 9999, r: 8}, {w: 82.4, r: 0}, {w: 100, r: 500}]` →
                    очікувати `s[0].w === undefined`, `s[1].w === 82.5`, `s[1].r === undefined`, `s[2].r === undefined`,
                    довжина s обрізана до ds.
Regression test:    те саме.
```

### TST-006 — Аналітика часу сесій і рекордів у `progress-core.js` без тестів (t0 === t1 legacy включно)

```text
ID:                 TST-006
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           test-gap / статистика
Location:           js/progress-core.js:351-405 (sessionEntries, sessionMinutes, timeStats, prList), 46-51 (cutKey);
                    tests/progress-core.test.js
Description:        Чотири функції ніколи не виконуються тестами; мутанти M35 (0-хвилинні сесії потрапляють у статистику),
                    M36 (без стелі 6 год), M37 (вікно 31 день — старий баг з коментаря коду), M38 (±10 % замість ±5 %),
                    M40 (перший запис = рекорд) виживають. Історія бага t0/t1 (history-core.test.js:185-200) прямо називає
                    sessionMinutes «жертвою», але тестує лише history-core.
Why it matters:     §2.3: у бойовій базі є дві legacy-сесії з t0 === t1. Сьогодні sessionMinutes повертає для них null
                    (перевірено: sessionMinutes({t0:1000,t1:1000}) === null; 7 годин → null) — але це не закріплено тестом.
Reproduction:       M35–M38, M40 → npm test 483/483.
Observed:           Зелено.
Expected:           Падіння.
Root cause:         Тести progress-core писались до появи аналітики сесій.
Impact:             Регресія «замало даних»/середньої тривалости/PR-списку непомітна; вікно періодів може знову стати 31 день.
Recommended fix:    Тести: sessionMinutes для t0===t1 → null, 30 с → null, 361 хв → null, 45 хв → 45; timeStats з міксом
                    legacy і нових записів; prList: один запис → []; cutKey(30, 2026-08-17) === '2026-07-19'.
Regression test:    те саме.
```

### TST-007 — `periodization-core.js` покритий на 58 %: `buildCycle`, `estimateOneRM`, `applyRaise`, `midReps` без тестів

```text
ID:                 TST-007
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           test-gap / періодизація (безпека навантаження)
Location:           js/periodization-core.js:214-331, 430-450; tests/periodization-core.test.js
Description:        Мутанти виживають: M27 — знято стелю інтенсивности за типом вправи (CEILING isolation 75 % → ізоляція
                    отримує 90 % від 1ПМ); M28 — заморожений 1ПМ ігнорується (цикл «пливе» за книгою ваг, що прямо
                    заперечує коментар у коді); M29 — RIR без стелі 5. Перевірено, що сьогодні стеля працює:
                    buildCycle для «Махи з гантелями стоячи» дає 60→75 %, capped=6 з 12 тижнів.
Why it matters:     buildCycle — це числа, які людина несе в зал; помилка в стелі — травмонебезпечна для ізоляції.
Reproduction:       M27–M29 → npm test 483/483.
Observed:           Зелено.
Expected:           Падіння.
Root cause:         Тести покривають лише normalize/pctForWeek/currentWeek/applyDeload.
Impact:             Регресія побудови циклу непомітна для npm test; браузерний tools/sim90/repro-periodization.mjs — ручний.
Recommended fix:    Тести buildCycle: ізоляція capped і pct ≤ 75; compound ≤ 95; oneRM з cfg.oneRM має пріоритет над
                    weightOf; estimateOneRM з rir 20 → toFailure = reps + 5; midReps('6–8') === 7; applyRaise симетричний
                    applyDeload.
Regression test:    те саме.
```

### TST-008 — Стеля білка 35 % не захищена: тест порівнює з самою константою

```text
ID:                 TST-008
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           test-validity / нутриціологія
Location:           tests/nutrition-core.test.js:101-116; js/nutrition-core.js:148
Description:        Тест «регресія: білок ніколи не перевищує 35 % калорійності» перевіряє share <= N.PROTEIN_MAX_SHARE + 0.001.
                    Мутант M18 (0.35 → 0.50) виживає: тест слідує за константою. Коментар у коді описує 63,7 % енергії з білка як
                    зону інтоксикації — саме це число тест і мав би не пропустити.
Why it matters:     Значення 35 % — медичне правило продукту, а не деталь реалізації.
Reproduction:       M18 → npm test 483/483.
Observed:           Зелено.
Expected:           Падіння.
Root cause:         Очікування виражене через тестований модуль.
Recommended fix:    `assert.equal(N.PROTEIN_MAX_SHARE, 0.35)` і share <= 0.351 літералом; додатковий кейс профілю
                    120 кг / 120 см / 90 р. на дефіциті: share ≤ 0.35.
Regression test:    те саме.
```

### TST-009 — `oneRepMax` не узгоджений з `estimates`: приймає вагу понад MAX_WEIGHT, повтори понад MAX_REPS і NaN-повтори

```text
ID:                 TST-009
Severity:           LOW
Confidence:         CONFIRMED
Category:           correctness / test-gap / 1RM
Location:           js/onerm-core.js:130-166 (oneRepMax), 91-94 (estimates); tests/onerm-core.test.js:66-71
Description:        Тест «сміття на вході не дає NaN» перевіряє лише estimates(). oneRepMax перевіряє MAX_WEIGHT лише для r === 1
                    (мутант M22 виживає) і взагалі не перевіряє MAX_REPS/NaN. Виміряно в пісочниці:
                    oneRepMax(600, 5) = 699.5, тоді як estimates(600, 5) = []; oneRepMax(100, 100) = 204.8 при estimates = [];
                    oneRepMax(100, undefined) = oneRepMax(100, 'abc') = oneRepMax(100, Infinity) = 99.36 (формули з r=0);
                    oneRepMax(1e308, 5) = 1.17e308. Фільтр `med <= w*2.5` (мутант M21) недосяжний у межах MAX_REPS
                    (макс. співвідношення 1.908 при 20×36).
Why it matters:     exercise-core.e1rmOf і periodization.estimateOneRM викликають oneRepMax; перша захищена власним hasKg&&hasReps,
                    друга — ні для ваги > 500 (робоча вага в книзі клампиться на вводі, але не при імпорті).
Reproduction:       cd /tmp/audit-tests/repo && node --input-type=module -e "import {loadModules} from './tests/helpers.js';
                    const O=loadModules(['js/onerm-core.js']).OneRM; console.log(O.oneRepMax(600,5), O.estimates(600,5).length,
                    O.oneRepMax(100,undefined), O.oneRepMax(100,100))"  → 699.49 0 99.36 204.79
Observed:           Число там, де estimates каже «поза межами».
Expected:           null для w > MAX_WEIGHT, r > MAX_REPS, нечислових r (як у estimates).
Root cause:         Дві функції з різними вхідними перевірками; тести покривають лише одну.
Impact:             Вигаданий e1RM/1ПМ при імпортованих або битих даних; невидимо для тестів.
Recommended fix:    Спільний валідатор входу для estimates і oneRepMax; тест «oneRepMax і estimates відкидають одне й те саме».
Regression test:    для кожного bad із [600×5, 100×100, 100×NaN, 1e308×5]: oneRepMax === null ⇔ estimates.length === 0.
```

### TST-010 — Розвʼязання конфлікту першого входу (`adoptLocalProfile`/`discardLocalProfile`) і денний стан (`readDay`/`writeDay`) без тестів

```text
ID:                 TST-010
Severity:           HIGH
Confidence:         CONFIRMED
Category:           test-gap / data-authority (A6) / ELO-факти
Location:           js/store.js:1311-1324; js/workout-core.js:381-431; tests/store-core.test.js; tests/workout-core.test.js
Description:        Покриття V8: adoptLocalProfile, discardLocalProfile, deleteAccount, updatePassword, saveProfileBeacon у
                    store.js і rawDay/readDay/writeDay/clampDay у workout-core.js не виконуються жодним тестом. Мутанти
                    виживають: M54 — «взяти мої дані з цього браузера» заливає в хмару копію ПЕРЕД імпортом (ib.profile.backup)
                    замість копії входу; M57 — «лишити хмарний» не скидає кеш (локальний профіль лишається активним);
                    M42 — readDay віддає стан іншої дати (учорашні закриті підходи показуються сьогодні, і «Завершити»
                    зарахує їх у сьогоднішній ELO-сабміт).
Why it matters:     Це рівно ті рішення «хто авторитетний» (A6) і «які факти поїдуть у elo_submit», де помилка = тиха втрата
                    або підміна даних. Заголовок store-core.test.js сам називає store «найризикованішим файлом».
Reproduction:       M42, M54, M57 (/tmp/audit-tests/mutants*.json) → npm test 483/483 кожен.
Observed:           Зелено.
Expected:           Падіння.
Root cause:         Пісочниця loadStore уже вміє все потрібне (localStorage, fetch), але сценарії конфлікту описані лише до
                    моменту `res.merge === 'conflict'` і не йдуть далі.
Impact:             Регресія у виборі джерела правди або в денному стані невидима для npm test; браузерні перевірки (verifyloop,
                    verifyworkout) ганяються лише в CI на push у main / щоночі — не перед деплоєм.
Recommended fix:    store-core.test.js: після 'conflict' викликати adoptLocalProfile → у f.state.row опиняється ЛОКАЛЬНИЙ профіль
                    (з ib.profile.backup.login), ib.profile.backup недоторкана; discardLocalProfile → getProfile() повертає
                    хмарний. workout-core.test.js: readDay з localStorage-підробкою: інша дата → fresh:true, done:[]; той самий
                    план+дата → done як є; чужий план → fresh.
Regression test:    те саме.
```

### TST-011 — `tools/simelo.mjs` червоний (5/6): профіль Excellent сягає Level 10, документ вимагає 6/6

```text
ID:                 TST-011
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           ELO balance / невиконуваний інваріант
Location:           tools/simelo.mjs:119 (target Excellent: elo >= 1400 && elo < 1800); tools/README-verify.md («мусить лишатись
                    6/6»); js/elo-core.js:15-17 («Level 10 має бути важким»)
Description:        `node tools/simelo.mjs` → exit 1: «FAIL Excellent середнє 1778 ELO прогони: 1841 (L10), 1735, 1697, 1770,
                    1849 (L10)». Симуляція детермінована (mulberry32), ганяє той самий js/elo-core.js і db/elo-config.json,
                    що й продакшен. Не входить ні в npm test, ні в CI.
Why it matters:     Ціль балансу з ТЗ (Excellent 90–95 % → L8–L9, НЕ Level 10) порушена. Ймовірна причина (PROBABLE): перехід
                    тренувань на лінійну пропорцію (workoutDelta `mult = q` без драбини `tolerance.training`): 93 % виконання
                    коштує 0.93, а не 0.45 (драбина 0.9–0.97 → 0.45). Дельти дій на сервері збігаються з JS (паритет 324/324),
                    тож бойовий рейтинг такого користувача теж ітиме до Level 10 — за умови, що тижневі бонуси/штрафи в SQL
                    відповідають JS (їх паритет не звірявся — поза SELECT-можливостями).
Reproduction:       cd /tmp/audit-tests/repo && node tools/simelo.mjs; echo $?  → «5/6 цілей балансу влучено», 1.
Observed:           2 з 5 сідів Excellent ≥ 1800.
Expected:           6/6 (усі сіди < 1800) або оновлена ціль з рішенням власника (§1.5 — зміна правил, видимих користувачам).
Root cause:         Зміна формули тренування (elo-proportional) не супроводжувалась перерахунком балансу/цілей симуляції.
Impact:             Інваріант «Level 10 важкий» фактично не діє; інструмент, що мав це ловити, ніхто не запускає.
Recommended fix:    Рішення власника: або підкрутити конфіг (categoryShare/weights) до 6/6, або визнати нову ціль і оновити
                    simelo + README. Далі — simelo у ci.yml job `test` (0.1 с).
Regression test:    simelo.mjs exit 0 у CI.
```

### TST-012 — `verifyperf.mjs` без жодної перевірки стоїть у `ci-browser.sh full`; `verifyerrors.mjs` (PII у Sentry) поза CI

```text
ID:                 TST-012
Severity:           LOW
Confidence:         CONFIRMED
Category:           CI / test-validity
Location:           tools/ci-browser.sh:24-27 (FULL містить verifyperf); tools/verifyperf.mjs (немає ok()/process.exit(1));
                    tools/verifyerrors.mjs, tools/verifyauthz.mjs — відсутні в CORE/FULL
Description:        verifyperf лише друкує таблицю і завжди завершується 0 (README-verify це визнає: «Усі, крім verifyperf.mjs,
                    повертають ненульовий код»), але ci-browser.sh рахує його як пройдену перевірку. verifyerrors.mjs повністю
                    офлайн (route abort + перехоплення ingest) і перевіряє відсутність пошти/токенів у Sentry-конвертах — у CI
                    не запускається. verifyauthz.mjs бʼє по бойовому Supabase — його виключення виправдане, але не задокументоване
                    в коментарі «ЧОГО ТУТ НЕМАЄ» (там лише 5 скриптів).
Why it matters:     «✓ verifyperf» у звіті CI — хибне відчуття покриття; перевірка PII в Sentry — саме та, що має бути автоматичною.
Reproduction:       grep -c "ok(\|process.exit" tools/verifyperf.mjs → 0; grep verifyerrors tools/ci-browser.sh → нічого.
Observed:           як описано.
Expected:           Скрипти без assert — поза списком CI або з порогами; verifyerrors — у FULL.
Recommended fix:    Додати пороги в verifyperf (напр., КБ ≤ X, nodes ≤ Y) або винести його в «звіти»; verifyerrors → FULL;
                    доповнити коментар про verifyauthz.
Regression test:    ci-browser.sh full містить verifyerrors; verifyperf має exit 1 на перевищенні порогу.
```

### TST-013 — Тавтологічний і слабкий assert-и

```text
ID:                 TST-013
Severity:           LOW
Confidence:         CONFIRMED
Category:           test-validity
Location:           tests/data.test.js:29-35; tests/periodization-core.test.js:122-128; tests/reps-core.test.js:98
Description:        1) data.test.js «стеля обʼєму відповідає розміру групи»: `expected = m.cap != null ? m.cap : VOLUME_CAP[m.size]`,
                    а далі `assert.equal(m.cap ?? VOLUME_CAP[m.size], expected)` — той самий вираз з обох боків, впасти не може
                    (змістовний лише другий assert 0 < cap ≤ 30). 2) periodization «не чіпає порожні й некоректні значення»:
                    `after[k] === undefined || !Number.isFinite(after[k]) || after[k] === 0 || after[k] === null` — приймає майже
                    будь-який результат для сміття. 3) reps-core: константа ALLOWED оголошена й не використана.
Why it matters:     Тести з назвою правила, які правило не перевіряють, спотворюють оцінку покриття.
Reproduction:       читання коду за вказаними рядками.
Recommended fix:    1) перевіряти конкретні значення VOLUME_CAP.large/small і що m.cap, якщо є, ≤ VOLUME_CAP[m.size];
                    2) очікувати точні виходи applyDeload для null/0/'abc'; 3) прибрати ALLOWED або застосувати.
Regression test:    —
```

### TST-014 — Дрейф документації тестів

```text
ID:                 TST-014
Severity:           LOW
Confidence:         CONFIRMED
Category:           documentation
Location:           tools/README-verify.md; tools/sim90/discover.mjs:7; tools/README-verify.md (розділ ELO)
Description:        README-verify перелічує 17 verify-скриптів із 36 наявних (немає verifyworkout-суміжних: verifycreatine,
                    verifyexercise, verifyfix90, verifyhistory, verifypersetweight, verifysexplans, verifysleepremember, verifysw,
                    verifytrackerspage, verifywomen3, verifychaos, verifychaos2, verifyerrors, verifyauthz і 5 «бойових»);
                    стверджує «Шлях до браузера зашитий як /opt/pw-browsers/chromium-1194/…», тоді як §2.4 і tools/pw.mjs уже
                    рахують шляхи переносно; tools/sim90/discover.mjs і далі має цей шлях зашитим; розділ ELO вказує на
                    db/elo-engine.sql як «другу реалізацію», хоч чинна — db/elo-proportional.sql.
Recommended fix:    Генерувати перелік із ci-browser.sh або оновити вручну; прибрати згадку зашитого шляху.
Regression test:    —
```

### TST-015 — `db/sim-week.sql`: перевірка «гонка звелась до реконсиляції» хибно падає в суботу й неділю

```text
ID:                 TST-015
Severity:           LOW
Confidence:         CONFIRMED
Category:           test-validity / SQL simulation / day-of-week dependency
Location:           db/sim-week.sql:212-228 (сценарій «гонка», користувач 5 «лише тренування», план 6);
                    db/elo-integrity.sql:349-361 (реконсиляція обмежена тижневим бюджетом тренувань)
Description:        Прогін 2026-09-06 (неділя): «SIM: 21 з 22 пройдено», FAIL «гонка звелась до реконсиляції :: подій 1, +0
                    r={"ok":true,"elo":55,"delta":4,"duplicate":true}». Причина — фікстура, а не сервер: у користувача 5
                    тижневий бюджет тренувань 51 уже вичерпаний (посів Пн–Чт 4×10 + Пт 9 + Сб 2 = 51); тест видаляє
                    сьогоднішню подію (delta 0), вставляє вручну delta 4 (55 > 51 повз бюджет) і чекає доплати — сервер
                    правильно повертає duplicate, бо inc = least(intended − paid, budget − spent) = 0. Той самий сценарій
                    у db/elo-integrity-tests.sql (без вичерпаного бюджету) проходить: «доплачує 8 → paid 17». Розрахунок
                    показує, що FAIL відтворюється в суботу (30+9+9+3=51) і неділю; у Пн–Пт бюджет має запас і тест зелений.
Why it matters:     Скрипт, який «мусить бути N з N», дає FAIL залежно від дня запуску — довіра до єдиної багатокористувацької
                    симуляції сервера падає, а справжня регресія в реконсиляції губиться серед «відомого» червоного.
Reproduction:       execute_sql: BEGIN; <db/sim-week.sql>; ROLLBACK; у суботу або неділю → «SIM: 21 з 22», FAIL на гонці.
Observed:           21/22 у неділю 2026-09-06.
Expected:           22/22 у будь-який день тижня.
Root cause:         Сценарій гонки використовує користувача з максимальним планом і без інших категорій — саме того, хто
                    впирається в бюджет тренувань наприкінці тижня.
Impact:             Хибнонегативний результат 2 дні з 7; сам сервер — коректний.
Recommended fix:    Для сценарію гонки брати користувача з запасом бюджету (напр., uids[8] «новачок» або uids[3]) або
                    перед сценарієм скидати training-події тижня; додати в assert очікуване inc = intended − paid.
Regression test:    sim-week.sql 22/22 у прогоні в неділю.
```

### TST-016 — Слабкі assert-и в SQL-тестах: «нагороди видано один раз» перевіряє лише `n >= 1`

```text
ID:                 TST-016
Severity:           LOW
Confidence:         CONFIRMED
Category:           test-validity / ELO season close
Location:           db/elo-integrity-tests.sql:158-160; db/elo-integrity.sql:509-522 (видача нагород)
Description:        Assert після ДВОХ викликів elo_close_season перевіряє count(*) >= 1, а факт — 7 нагород (level5, level7 за
                    ELO 1234 → Level 7; first/top3/top10/top100/top1000 за ранг 1 з 1). Тест не ловить ні подвоєння (7 → 14
                    пройшло б), ні відсутність рівневих нагород (лише top-нагороди — теж пройшло б), ні зайві.
                    Ідемпотентність доводить лише `on conflict do nothing` у коді, який тест і мав перевірити.
Why it matters:     Закриття сезону — подія раз на 3 місяці, помилку побачать усі одразу і назавжди (season_history/awards
                    незмінні за задумом).
Reproduction:       прогін db/elo-integrity-tests.sql з доданим виводом факту: «нагороди видано один раз (факт 7)».
Observed:           7 нагород, assert n >= 1.
Expected:           assert n = 7 (або точний набір типів) і рівність count до/після другого виклику.
Recommended fix:    select array_agg(kind order by kind) і порівняти з очікуваним масивом; другий close → той самий масив.
Regression test:    те саме.
```

### TST-017 — 69 SQL-перевірок сервера ELO/RLS виконуються лише вручну; жодного сліду останнього прогону

```text
ID:                 TST-017
Severity:           LOW
Confidence:         CONFIRMED
Category:           CI / process
Location:           db/elo-tests.sql, db/elo-integrity-tests.sql, db/multiuser-tests.sql, db/sim-week.sql; .github/workflows/ci.yml
                    (немає кроку з SQL); README.md:2744 (згадано лише elo-tests.sql)
Description:        Єдині тести авторитетного сервера (атаки payload-ом, ротація ключів, бюджети, RLS, адмін-RPC) не
                    входять ні в npm test, ні в CI, ні в auto-publish; у репозиторії немає запису, коли й з яким
                    результатом вони востаннє виконувались. У цьому аудиті: 20/20, 28/28, 21/21, 21/22 (TST-015).
                    README згадує лише один із чотирьох скриптів; README-verify — жодного.
Why it matters:     Будь-яка правка db/*.sql (у т. ч. Phase B) може зламати серверні інваріанти, і це не побачить ніхто, крім
                    того, хто згадає запустити скрипт у SQL Editor.
Reproduction:       grep -rn "elo-tests\|multiuser-tests\|integrity-tests\|sim-week" .github tools README.md → лише README:2744.
Observed:           як описано.
Expected:           Перелік SQL-наборів із очікуваним «N з N» у README-verify і журнал прогонів (дата, N/N) поруч із
                    міграціями; у Phase B — обовʼязковий прогін після кожної SQL-зміни.
Recommended fix:    Додати розділ у tools/README-verify.md; для CI — Supabase branch або локальний Postgres із db/*.sql
                    (нова залежність → §1.5, рішення власника).
Regression test:    —
```

## Спостереження (INFO)

- **INFO-1.** Два `*-core.js` без жодного тесту: `js/bmi-core.js` (119 рядків), `js/measure-core.js` (150) —
  розходження з конвенцією §2.1 «`*-core.js` — чиста логіка під тести».
- **INFO-2.** `tools/simelo.mjs` детермінований (mulberry32), 0,1 с, ганяє продакшен-`elo-core.js` — але не входить у
  `npm test`/CI і сьогодні червоний (TST-011).
- **INFO-3.** `tools/verifyauthz.mjs` бʼє по бойовому Supabase anon-ключем (2 перевірки: таблиці/RPC/view закриті для
  anon) — його виключення з CI виправдане (CI глушить домени), але в коментарі «ЧОГО ТУТ НЕМАЄ» не згадане (TST-012).
- **INFO-4.** Хмарний репозиторій `/root/work/forgesite` — гілка `master`, remote відсутній; `ci.yml` (`branches: [main]`)
  і `auto-publish.sh` (`BRANCH="main"`) працюють із `main`. Для Phase B це означає: коміти в хмарі не проходять CI,
  доки не доставлені в теку релізу.
- **INFO-5.** `tests/helpers.js` підміняє в пісочниці `Array/Object` зовнішнього realm, тому автори тестів системно
  уникають `deepEqual` (join/JSON.stringify) — задокументовано в 6 файлах; це не дефект, але пастка для нових тестів.
- **INFO-6.** У SQL-тестах `username_free('Ірина') = true` залежить від того, що такого ніка нема в бойовій базі —
  сьогодні true; при появі реального користувача з таким ніком тест хибно впаде.
- **INFO-7.** `sim-week.sql` показує «тижневий бюджет :: 172 (ліміт 200)» для ідеального профілю за повний тиждень.
  Розклад: бюджет тренувань 51 вичерпується (4 посіяні дні × 10 + 10 + 1), далі тренування дають 0; посів не додає
  бонус чистого дня (лише 3 живі дні по +3). Тобто 172 — артефакт фікстури (7 тренувань при плані 5 + посів без
  cleanday), а не показник того, що 200 недосяжні. Не дефект.
- **INFO-8.** Час прогонів: `npm test` 3,1–3,7 с (483 тести), кожен файл 0,1–0,5 с; найдовший — `nutrition-core`
  (сітка > 10 000 профілів, 0,54 с). Мутаційний прогін 57 мутантів — ~4 хв.

## Підсумок домену

- **Виконано:** `npm test` ×2 (483/483, ідентичні), `ci-hygiene` (чисто), 24 файли поодинці (усі зелені), 7 TZ × 9
  дат (усі зелені), покриття V8 по 22 модулях, 57 мутантів (35 упало / 22 вижило / 2 еквівалентні), паритет JS↔SQL
  324/324, `simelo` (5/6, червоний), 4 SQL-набори проти бойової бази з відкатом (90 перевірок: 89 OK, 1 FAIL —
  TST-015), таблиця покриття 23 підсистем, 10 шляхів «зелено при зламаному продакшені».
- **Знахідок:** 17 (HIGH 2: TST-005, TST-010; MEDIUM 8; LOW 7). Усі CONFIRMED.
- **Найважливіше для Phase B:** тести-копії (TST-001/002), паритет ELO (TST-004), санітизація знімка сесії (TST-005),
  джерело правди при вході (TST-010), `buildCycle` (TST-007), `simelo` червоний (TST-011).
- Копія `/tmp/audit-tests/repo`: `git status --porcelain` порожній після всіх мутантів (перевірено після кожного).
