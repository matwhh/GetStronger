# Аудит Phase A — домен «Дата/час і числова коректність» (TIM)

Дата: 2026-09-06. Агент: time. Режим: тільки читання; проби у node
(`/tmp/audit-time/`) та SELECT / `BEGIN … ROLLBACK` у Supabase.

## Обсяг і метод

- `grep` усіх звернень до `Date`, `toISOString`, `getDay`, `Intl`,
  `toLocale*`, `Date.parse` у `js/`; `now()`, `current_date`,
  `date_trunc`, `timezone` у `db/`.
- Практичні прогони `*-core.js` під `TZ=Europe/Kyiv`,
  `TZ=America/Los_Angeles`, `TZ=Pacific/Kiritimati`, `TZ=UTC` о 23:30 і
  00:30, на межах тижня/місяця/року і на датах DST 2026-03-29 / 2026-10-25.
- Числові формули: 0, відʼємні, 1e308, дробові, NaN, Infinity,
  null/undefined, ділення на нуль; чи доходить NaN/Infinity до
  `saveProfile`/бази.
- Парсинг введення (кома, порожній рядок).

## Що перевірено

- **Інвентар дат**: 218 звернень до `Date/toISOString/getDay/toLocale*/Intl/setHours/Date.parse` у 45 файлах `js/` (grep); 150+ рядків із `now()/current_date/date_trunc/isodow` у `db/*.sql`; жива БД: `current_setting('TimeZone') = UTC`, ролі без власного TimeZone.
- **Класифікація**: ключ дня — скрізь ЛОКАЛЬНИЙ (`getFullYear/getMonth/getDate`) у 12 модулях (history-core, workout-core, progress-core, tracker-core, season-core, adherence-core, elo-api, elo-hooks, journal, today, measure, store); `toISOString` лише для позначок часу (`updatedAt`, `savedAt`, `bmiAck.at`, `deload.at`, `periodization.startedAt`) і Sentry. Початок тижня — понеділок локально (`(getDay()+6)%7`) на клієнті і `date_trunc('week')` (ISO, понеділок) на сервері — узгоджено. Сезони: `seasonOf` (JS) ≡ `season_of` (SQL), межі `seasonRange` ≡ `season_bounds`.
- **Практичні прогони у node** (`/tmp/audit-time/tz1.mjs`, 4 пояси × 9 моментів: 23:30/00:30 Києва, UTC-межа, DST 2026-03-29 і 2026-10-25, Новий рік, кінець місяця): `todayKey`, `weekStartKey`, `addDaysKey`, `seasonOf`, `seasonDay` — усі коректні в локальному календарі; DST-арифметика через `setDate`/конструктор Date — без зсувів. Тренування о 23:30 за Києвом → ключ того самого дня, у тижні — той самий (при відкритій сторінці — див. TIM-003).
- **Вікно подачі сервера** (`p_day ∈ [current_date−2, current_date+1]`, UTC): SQL-перебір 96 моментів × 5 поясів (UTC−12 … UTC+14) — 0 `out_of_window` для «зараз»; клієнтський локальний день завжди приймається.
- **Еквівалентність ELO клієнт↔сервер**: 12 194 комбінацій payload (workout 4300, meal 6318, sleep 772, activity 804) — контрольні суми `Σ delta·вага` збігаються для всіх чотирьох категорій (JS `EloCore.actionDelta` vs SQL `elo_action_delta`). Округлення `Math.round` ↔ `round()::int` не розходиться.
- **Числові межі** (`/tmp/audit-time/num1.mjs`, `num2.mjs`): OneRM (22 наборів), NutritionCalc.macros/targetFor/massForecast, BmiCore, HistoryCore.appendWeight/upsertSession/closeDay, ProgressCore.*, AdherenceCore.*, TrackerCore.*, EloCore.levelFor/seasonDay — на 0, відʼємних, 1e308, дробових, NaN, Infinity, null, порожньому рядку, комі.
- **Сервер на сміття в профілі** (BEGIN…ROLLBACK, тимчасовий користувач): `activePlan.days` = 3.5 / 1e10 / "3", `sessionLog.totalSets` = 1e308; CHECK-обмеження таблиць (`season_state.elo 0..2500`, `elo_week_plan.planned 3..7`, розмір `profiles.data` ≤ 1 МБ).
- **Парсинг введення**: 17 місць із `replace(',', '.')`, `App.num` (parseFloat+кома), `parseGrams`, `joinDuration`, `normDose`, `MeasureCore.buildEntry`; поля `type="number"` (recipe grams, periodization) — браузерна валідація.
- **Браузер (Playwright/Chromium, file://, `localMode`, `timezoneId: Europe/Kyiv`, `page.clock`)**: тренування через північ (TIM-003); кома в полі контейнерів раціону (TIM-005); `tools/verifyhistory.mjs` з підміненою датою 3 і 15 вересня (TIM-008) та реальний прогін (23/23).
- `npm test` під `TZ=UTC / Europe/Kyiv / America/Los_Angeles / Pacific/Kiritimati`: 483/483 у кожному.
- Sentry (`mold-t1`, 90 днів): 3 unresolved issues — усі `r["@context"].toLowerCase` (не дати/числа).
- Бойові дані (read-only): 2 `elo_events`, 2 сесії з `t0 === t1`; `cron.job` `forge-elo-week` активний, 2 останні запуски succeeded.

### Статус відомих проблем (§2.3 PROMPT.md)

- **Дві бойові сесії з `t0 === t1`** — підтверджено SQL (`uid 3ed0794f`, дні 2026-09-01 і 2026-09-04): `ProgressCore.sessionMinutes` повертає `null` (вимагає `t1 > t0`), `timeStats` їх пропускає, журнал показує «Записано о» — статистику не ламають (перевірено `verifyhistory` 23/23 і node-пробою).
- **`elo_close_season` привʼязаний до `auth.uid()`** — підтверджено (жива функція); клієнт `closeSeasonIfDue` закриває лише сезон «день перед поточним»: користувач, що пропустив цілий сезон, ніколи не отримає `season_history`/awards за останній активний сезон (наприклад, AUTUMN-2026 у того, хто повернеться навесні 2027). Дедлайн 2026-12-03 лишається.
- Решта пунктів §2.3 — поза доменом.

## Що НЕ перевірено і чому

- Повне відтворення TIM-004 (оцінка тижня до закриття вікна подачі) — потребує `current_date` у понеділок/вівторок; `current_date` у бойовій БД підмінити не можна. Доведено логікою функцій і частковою пробою.
- Safari/Firefox/iOS — недоступні (лише Chromium); поведінка коми на iOS-клавіатурі (TIM-005) — за специфікацією `inputmode="decimal"`, не «протестовано».
- `npm test` із підміненим системним часом (DST-межі, 23:30) — немає faketime у контейнері; юніти й так задають дати явно.
- Числові межі в DOM-файлах без ядра (boxing.js, cardio.js, nutrition.js рендер) — лише читання коду, без прогону.
- Накопичення помилки з плаваючою точкою в ELO — не застосовне: ELO цілочисельний, кожна дельта округлюється окремо (перевірено формулами і CHECK 0..2500).
- Стрес/паралельні виклики ELO — заборонено §1.2.

## Знахідки

### TIM-001 — `OneRM.oneRepMax` ігнорує власні межі MAX_WEIGHT/MAX_REPS і `undefined`-повтори

```text
ID:                 TIM-001
Severity:           LOW
Confidence:         CONFIRMED
Category:           числова коректність / 1RM
Location:           js/onerm-core.js:130-166 (oneRepMax); споживачі js/exercise-core.js:44-47 (e1rmOf), js/periodization-core.js:254
Description:        estimates() відсіює w > MAX_WEIGHT (500) і r > MAX_REPS (36), а oneRepMax()
                    — ні: межа ваги застосовується лише у гілці r === 1; повтори не обмежені
                    взагалі; r = null/undefined/NaN/'5,5' підставляється у формули як 0/NaN і
                    дає «оцінку» ≈ w.
Why it matters:     Медіана формул за межами калібрування (r ≥ 37) — «здогад», який ядро само
                    документує як ненадійний, а сторінка прогресу (e1rmOf) показує його як 1ПМ
                    і як рекорд; normReps дозволяє до 200 повторів у підході.
Reproduction:       TZ=UTC node /tmp/audit-time/num1.mjs
Observed:           oneRepMax(100, 1000) = 204.9; oneRepMax(100, 37) = 191.7 (estimates.len = 0);
                    oneRepMax(1000, 5) = 1165.8; oneRepMax(1e308, 5) = 1.17e308;
                    oneRepMax(100, undefined) = 99.36; oneRepMax(100, '5,5') = 99.36;
                    oneRepMax(100, 0.5) = 100.04.
Expected:           null поза [1..MAX_REPS] і w > MAX_WEIGHT; null для нечислових повторів.
Root cause:         oneRepMax обходить фільтр estimates() навмисно (щоб не стрибала медіана),
                    але не переніс до себе межі MAX_WEIGHT/MAX_REPS і перевірку r === null.
Impact:             Графік «1ПМ» та PR у прогресі можуть показувати фізіологічно неможливі
                    значення при аномальних записах (200 повторів × 100 кг → 1ПМ 205 кг);
                    в базу ці числа не пишуться (e1rm рахується на льоту).
Recommended fix:    у oneRepMax: if (r === null || r < 1 || r > MAX_REPS || w > MAX_WEIGHT) return null.
Regression test:    tests/onerm-core.test.js: oneRepMax(100,37) === null, oneRepMax(600,5) === null,
                    oneRepMax(100, undefined) === null, oneRepMax(100,'5,5') === null.
```

### TIM-002 — Вікна «N днів назад» через мілісекунди зсуваються на день при переході DST

```text
ID:                 TIM-002
Severity:           LOW
Confidence:         CONFIRMED
Category:           дата/час / DST
Location:           js/progress-core.js:290 (trainingStats, вікно adherence 6 тижнів);
                    js/journal.js:120 (фільтр періоду графіка ваги);
                    js/journal.js:340 (weekAgoKey для «тижневої динаміки»);
                    js/journal.js:100 (rolling: start = end − 6·86400000)
Description:        cutKey() у progress-core/tracker-core навмисно рахує через setDate і
                    коментар пояснює чому (25-годинна доба). Але trainingStats робить
                    keyOf(new Date(monday.getTime() − 6·7·DAY_MS)), а journal.js —
                    keyOf(new Date(Date.now() − N·86400000)). Коли між «зараз» і межею вікна
                    лежить перехід на літній/зимовий час, а локальний час близько до опівночі
                    (00:00–01:00 після весняного або 23:00–24:00 після осіннього переходу),
                    ключ межі відрізняється на день від календарного.
Why it matters:     adherence рахує done по вікну 41 або 43 дні замість 42: 41/42 → 98 %
                    замість 100 % при повному виконанні (при 43 — обрізається до 100 %, але
                    done показує 43/42). Графік ваги за «30 днів» показує 29 або 31 день;
                    weekDelta бере точку не з того дня.
Reproduction:       TZ=Europe/Kyiv node /tmp/audit-time/dst1.mjs ; node /tmp/audit-time/dst2.mjs
Observed:           trainingStats(daysTarget=7, now=2026-11-02 23:30 Kyiv) з сесіями щодня →
                    adherence.done=41 planned=42 pct=98; now=2026-04-13 00:30 → done=43.
                    journal.js:120 period=30 при 2026-11-02 23:30 → від 2026-10-04
                    (очікувано 2026-10-03); при 2026-04-05 00:30 → від 2026-03-05 (очікувано 03-06).
                    journal.js:340 weekAgoKey при 2026-11-02 23:30 (Los_Angeles) → 2026-10-27
                    замість 2026-10-26.
Expected:           Межа вікна — календарна: setDate(getDate() − N), як у cutKey().
Root cause:         Арифметика в мілісекундах при тому, що доба в локальному часі буває 23/25 год.
Impact:             Двічі на рік протягом ~1 години (і для progress-core — весь день після
                    переходу, якщо сторінка відкрита вночі) статистика відрізняється на один
                    день; даних не псує, в базу не пише.
Recommended fix:    Замінити три вирази на cutKey(N+1)/addDays; у trainingStats:
                    const f = new Date(monday); f.setDate(f.getDate() − WEEKS·7).
Regression test:    tests/progress-core.test.js: trainingStats з now = 2026-04-13T00:30 і
                    2026-11-02T23:30 (Europe/Kyiv) при щоденних сесіях → adherence.done === 42.
```

### TIM-003 — Тренування, що перетинає північ, обнуляється на екрані, перемикається на наступний день плану і розпадається на дві часткові сесії

```text
ID:                 TIM-003
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           дата/час / ключ дня / цілісність сесії
Location:           js/workout.js:653-666 (App.onDayChange → readDay(new key) → state.done=[] ,
                    state.dayIdx = «наступний день»); js/workout-core.js:394-420 (readDay:
                    raw.date !== key → fresh, done: [], dayIdx = lastIdx+1); js/app.js:580-595
Description:        Сторож півночі App.onDayChange щохвилини (і на focus/visibilitychange)
                    порівнює локальний ключ дня. Коли він змінюється, workout.js перечитує
                    денний стан під новим ключем: 'forge.today' датований учора → readDay
                    повертає fresh-стан із порожнім done і ПІДКАЗКОЮ наступного дня плану.
                    Тобто посеред тренування, що почалось о 23:30, о 00:00 усі закриті
                    підходи зникають з екрана, а обраний день плану перемикається з «День A»
                    на «День B». Подальші тапи пишуться у сесію нового дня під новим dayIdx.
Why it matters:     Одне реальне тренування стає двома частковими сесіями (вчорашня без end,
                    сьогоднішня з іншим dayIdx). Обидві мають quality < 0.5 → сервер
                    elo_eval_week_for не рахує жодну як виконану (count … quality >= 0.5) →
                    штраф missedWorkoutPenalty за «пропуск» при фактично зробленому тренуванні;
                    сьогоднішня частина ще й іде в статистику як «День B». У неділю → понеділок
                    додатково зсувається тиждень (completedThisWeek), і блокування дня знімається.
Reproduction:       cd /root/work/forgesite && node /tmp/audit-time/midnight.mjs
                    (Playwright, Chromium, timezoneId Europe/Kyiv, page.clock 2026-09-06T23:30
                    → клік 3 підходи → runFor 31 хв + 65 с → клік ще 1 підхід)
Observed:           ДО півночі: forge.today.date=2026-09-06, done=[[..,..],[..]], екран 2/2 і 1/1,
                    sessionLog['2026-09-06'].doneSets=3, dayIdx=0 «День A».
                    00:02: екран 0/2, 0/1; forge.today не змінився (ще вчорашній).
                    Наступний тап: forge.today.date=2026-09-07, dayIdx=1, done=[[..]];
                    sessionLog['2026-09-07'] = {title:'День B', doneSets:1, …};
                    sessionLog['2026-09-06'] лишився часткою без end.
Expected:           Незавершена сесія (є forge.today з підходами, немає end) має дожити до
                    «Завершити» під тим ключем дня, під яким почалась (або принаймні не
                    перемикати dayIdx і не втрачати done); зміна дня — після завершення.
Root cause:         onDayChange у workout.js беззастережно перечитує стан під новим ключем,
                    хоча readDay не знає про сесію «в процесі»; коментар у коді оптимізує
                    протилежний випадок (вкладка, залишена з вечора без тренування).
Impact:             Для тих, хто тренується пізно ввечері (23:00+): втрачений прогрес на екрані,
                    хибний день плану, розбита історія, незаслужений штраф ELO (−8) і
                    подвійна витрата днів плану. Даних у профілі не втрачає, але псує їх сенс.
Recommended fix:    У onDayChange workout.js: якщо forge.today має незакриті підходи
                    (dayStats.doneSets > 0) і сесія за raw.date не end — НЕ перечитувати стан,
                    лише оновити позначку; або переносити накопичений done під новий ключ з тим
                    самим dayIdx. Аналогічно для today.js:565.
Regression test:    Браузерний verify (tools/verifyworkout.mjs) з page.clock: старт 23:30, 2 підходи,
                    +35 хв → підходи на екрані на місці, dayIdx той самий; «Завершити» →
                    одна сесія end=1 з усіма підходами.
```

### TIM-004 — Тиждень закривається (штраф/бонус) на UTC-понеділок, до закінчення вікна подачі submitWindowDays

```text
ID:                 TIM-004
Severity:           MEDIUM
Confidence:         PROBABLE
Category:           дата/час / економіка ELO / вікна
Location:           elo_eval_week_for (жива БД; db/elo-authoritative.sql:295) — гейт
                    `p_week_start + 6 >= current_date`; elo_catch_up_weeks
                    (db/elo-authoritative.sql:366) — `while w + 6 < current_date`;
                    elo_submit (жива БД) — `perform elo_catch_up_weeks(...)` ДО вставки події;
                    для порівняння elo_cron_eval_week (db/cron.sql) — `continue when today <= wk + 6 + swd`
Description:        Подія дня можна подати ще submitWindowDays=2 дні після дня (елемент
                    навмисний: «частково виконане подається наступного дня», js/elo-hooks.js:14-16;
                    офлайн-черга ib.eloPending). Але оцінка тижня через elo_catch_up_weeks (яку
                    викликає і клієнт elo_catch_up на кожному завантаженні, і сам elo_submit
                    перед обробкою події) дозволена, щойно current_date (UTC) > неділя.
                    Оцінка одноразова: event_type='week' → далі duplicate; пізніші події
                    тижня «done»/«meals» не перераховують. Cron-версія (elo_cron_eval_week)
                    вікно подачі чекає — дві реалізації одного правила розходяться.
Why it matters:     Сценарій: недільне тренування не дійшло до сервера в неділю (офлайн; сесія
                    без «Завершити», бо частково; TIM-003 — тренування через північ). У
                    понеділок клієнт викликає elo_submit('workout', неділя) → elo_submit спершу
                    виконує catch-up → тиждень оцінюється БЕЗ цієї події → missed=1 →
                    −8 ELO записано назавжди; потім та сама транзакція нараховує +17 за
                    тренування. Чистий тиждень (+9) теж не отримати, якщо остання подія
                    тижня доїхала в понеділок.
Reproduction:       Логіка: (1) elo_eval_week_for гейт week_not_over лише поки p_week_start+6 >= current_date;
                    (2) elo_submit: «perform public.elo_catch_up_weeks(uid, szn, cfg)» стоїть до
                    «insert into elo_events»; (3) submit-вікно p_day >= current_date − 2.
                    Проба з відкатом (виконано 2026-09-06, неділя): elo_evaluate_week('2026-08-31')
                    → week_not_over; elo_submit за 2026-09-04 → ok. Повний сценарій потребує
                    понеділка: у понеділок 2026-09-07 (UTC) той самий elo_submit за 2026-09-06
                    спершу закриє тиждень 08-31…09-06 без цієї події. Перевірити можна
                    db/sim-week.sql-подібною пробою в BEGIN…ROLLBACK у понеділок/вівторок.
Observed:           Гейти двох реалізацій відрізняються на submitWindowDays (2 дні); порядок
                    операцій в elo_submit — catch-up, потім подія.
Expected:           Тиждень оцінюється лише після current_date > неділя + submitWindowDays
                    (як у elo_cron_eval_week), або elo_submit робить catch-up ПІСЛЯ вставки
                    події (для тижня, до якого належить p_day).
Root cause:         elo_catch_up_weeks написаний до появи cron-версії, гейт не оновлено.
Impact:             Незаслужений штраф −8 (і втрата +9 «чистого тижня») для подій неділі, поданих
                    у понеділок; ELO не збільшити цим — лише втратити; для користувача виглядає
                    як «зробив тренування — отримав пропуск».
Recommended fix:    У elo_catch_up_weeks: `while w + 6 + swd < current_date`; у
                    elo_eval_week_for: `if p_week_start + 6 + swd >= current_date then week_not_over`.
                    Це змінює правило, видиме користувачам (момент штрафу) — точка зупинки §1.5.
Regression test:    db/elo-integrity-tests.sql: у понеділок elo_evaluate_week(минулий понеділок) →
                    week_not_over; elo_submit події неділі у понеділок → тиждень без штрафу.
```

### TIM-005 — Кількість контейнерів рецепта в раціоні: кома як роздільник дає 0 (поле показує «1,5», у профіль іде 0)

```text
ID:                 TIM-005
Severity:           LOW
Confidence:         CONFIRMED
Category:           парсинг введення / локаль
Location:           js/meals.js:1633-1636 (таблиця дня, it.kind === 'recipe': Number(el.value) || 0);
                    js/meals.js:1557 (модалка: Math.max(0, Number(e.target.value) || 0));
                    поле — type="text" inputmode="decimal" (js/meals.js:826, 1134)
Description:        Грами продукту проходять через parseGrams() з заміною коми на крапку, а
                    кількість контейнерів рецепта — через голий Number(): «1,5» → NaN → 0.
                    У таблиці дня поле не перезаписується (String(0) === String(0)), тож людина
                    бачить «1,5», а в профіль (day.meals[..].items[..].portions) лягає 0 —
                    підсумок дня рахує цей рецепт як 0 ккал. У модалці commitModal клампить
                    0 до 0.25 контейнера.
Why it matters:     Українська iOS-клавіатура для inputmode="decimal" показує кому. Закритий
                    день (mealLog) і ELO за харчування рахуються з хибних калорій.
Reproduction:       cd /root/work/forgesite && node /tmp/audit-time/comma.mjs
                    (профіль із day.meals[0].items[0] = {kind:'recipe', recipeId:'base-crispy-chicken-mac',
                    portions:1}; у полі [data-df="amount"] набрати «1,5»)
Observed:           {"value":"1,5","portions":0}; з «1.5» — 1.5.
Expected:           «1,5» → 1.5, як у parseGrams / App.num / workout.js:83.
Root cause:         Дві гілки одного обробника парсять по-різному.
Impact:             Тихе заниження калорій дня для тих, хто вводить дроби з комою; зникає, лише
                    якщо ввести з крапкою.
Recommended fix:    Спільний парсер (parseGrams-подібний з комою) для portions у обох місцях.
Regression test:    Браузерний verify: ввід «1,5» у поле контейнерів → portions === 1.5.
```

### TIM-006 — Нецілий або завеликий `activePlan.days` у профілі валить elo_submit / оцінку тижня винятком

```text
ID:                 TIM-006
Severity:           LOW
Confidence:         CONFIRMED
Category:           числова коректність / сервер / валідація
Location:           elo_planned_for (жива БД; db/elo-integrity.sql:109-118):
                    `coalesce((data #>> '{activePlan,days}')::int, (data ->> 'daysPerWeek')::int, 3)`;
                    js/account.js:1097-1101 (імпорт: finite(v.days, 1, 7) без перевірки цілого)
Description:        Приведення ::int тексту з jsonb кидає виняток для '3.5' і для чисел поза
                    int4. Клієнтський імпорт приймає days = 3.5 (finite у [1,7]); profiles.data
                    також пишеться клієнтом напряму через REST. Після цього кожен elo_submit
                    цього користувача падає з SQL-помилкою (PostgREST 400), а elo_eval_week_for
                    для нього — теж (у cron ловиться per-user, тиждень лишається неоціненим).
Why it matters:     Клієнт (js/elo-hooks.js:151-160) на не-offline помилку повертає null,
                    подію не позначає надісланою і повторює на кожному Store.onChange —
                    ELO не нараховується ніколи, тихо, з постійними 400 у мережі/Sentry.
Reproduction:       BEGIN…ROLLBACK-проба (виконано 2026-09-06): тимчасовий користувач, профіль
                    activePlan.days = 3.5 → set local role authenticated → elo_submit('workout',…)
Observed:           days=3.5 → EXCEPTION: invalid input syntax for type integer: "3.5";
                    days=1e10 → EXCEPTION: value "10000000000" is out of range for type integer;
                    days="3" → ok; sessionLog.totalSets=1e308 → ok (numeric, clamp).
Expected:           Нечислове/нецілісне значення → запасне 3 (як для відсутнього), без винятку.
Root cause:         ::int замість elo_num()+round()+greatest/least; імпорт не вимагає цілого.
Impact:             Один користувач із битим профілем (імпорт/ручна правка) втрачає ELO повністю
                    і назавжди до виправлення профілю; на інших не впливає.
Recommended fix:    elo_planned_for: p := greatest(3, least(7, round(coalesce(elo_num(data#>'{activePlan,days}', null),
                    elo_num(data->'daysPerWeek', null), 3))::int)); у імпорті — Math.round(days).
Regression test:    db/elo-integrity-tests.sql: профіль з days 3.5 та 1e10 → elo_submit ok, planned=4/7.
```

### TIM-007 — Сервер рахує «сьогодні» в UTC там, де користувач бачить локальний день: вік при реєстрації, «Сьогодні: +N ELO», grace_until

```text
ID:                 TIM-007
Severity:           LOW
Confidence:         CONFIRMED (розбіжність), ENVIRONMENTAL (проявляється у вікні 0:00–UTC-зсув)
Category:           дата/час / клієнт↔сервер
Location:           register_request (жива БД; db/account-approval.sql): yrs := age(current_date, p_birth);
                    elo_state / elo_submit / elo_try_clean_day: today_date = current_date;
                    elo_activate_grace: grace_until = current_date + graceDays − 1;
                    клієнт: js/age-core.js:56-57 (локальний день), js/season.js:108 і js/app.js:710
                    («Сьогодні: +N ELO»), TimeZone бази = UTC (перевірено: current_setting('TimeZone')).
Description:        Ключ дня подій (p_day) сервер приймає клієнтський і вікно ±1/−2 дні покриває всі
                    пояси (перевірено SQL-перебором зсувів −12…+14: 0 out_of_window). Але
                    три речі лишились на current_date (UTC):
                    (1) вікові ворота: клієнт (AgeCore, локальна дата) пускає з 00:00 дня
                        17-річчя, сервер до 03:00 за Києвом (02:00 узимку) кидає UNDERAGE —
                        welcome.js:597 показує людині помилку «менше 17»;
                    (2) лічильник «Сьогодні: +N ELO» (today_delta/today_date) скидається о
                        03:00 за Києвом, а не опівночі: подія о 01:00 зникає з «сьогодні» о 03:00,
                        а події 00:00–03:00 долучаються до вчорашнього «сьогодні»;
                    (3) grace-тиждень, активований о 00:00–03:00 понеділка за Києвом, закінчується
                        в суботу (6 локальних днів замість 7).
Why it matters:     Помилка UNDERAGE людині, яка щойно стала повнолітньою за своїм календарем;
                    невідповідність бейджа «сьогодні» — плутанина; grace коротший на день.
Reproduction:       SELECT date_part('year', age((timestamptz '2026-09-07 00:30+03' at time zone 'UTC')::date,
                    date '2009-09-07')) → 16; те саме за Києвом → 17. Виконано 2026-09-06.
Observed:           server_yrs=16 / client_yrs=17 для 00:30 і 02:59 за Києвом; 03:01 — 17/17.
Expected:           Сервер приймає день клієнта (p_day/p_today) і перевіряє його у вікні ±1 день
                    від UTC, як уже робить elo_submit; або рахує вік із запасом (current_date + 1).
Root cause:         current_date у SECURITY DEFINER-функціях = UTC-день; клієнт живе в локальному.
Impact:             Рідкісне (день народження ×3 год), але видиме як відмова; «сьогодні» — щодня
                    для тих, хто записує події після півночі.
Recommended fix:    register_request: yrs := date_part('year', age(current_date + 1, p_birth)) з
                    перевіркою p_birth <= current_date + 1; today_date — від p_day, не current_date.
Regression test:    db/multiuser-tests.sql: register_request у транзакції з датою народження
                    «17 років завтра за UTC» → status pending.
```

### TIM-008 — `tools/verifyhistory.mjs` (ядро CI на кожен пуш) детерміновано падає 1–4 числа кожного місяця

```text
ID:                 TIM-008
Severity:           LOW
Confidence:         CONFIRMED
Category:           дата/час / тести / детермінізм
Location:           tools/verifyhistory.mjs:23-32 (dGood/dLegacy/dOld = сьогодні −2/−3/−4 днів,
                    key = toISOString().slice(0,10)); js/journal.js:1420-1432 (клітинки
                    попереднього місяця — pad без data-hday); tools/ci-browser.sh:20 (CORE)
Description:        Сценарій сіє три сесії на 2, 3 і 4 дні тому й шукає їх у календарі
                    ПОТОЧНОГО місяця. 1–4 числа частина цих днів належить попередньому місяцю,
                    який календар не показує (pad-клітинки без data-hday) → перевірки 3 і 4
                    падають, а далі .click() по відсутній клітинці валить скрипт. Додатково
                    ключі рахуються в UTC (toISOString), тоді як t0/t1 — локальним setHours: на Mac
                    у Києві між 00:00 і 03:00 ключ на день раніший за локальний, тож вікно
                    відмови розширюється на 5 число, а «Час: 17:27 → 18:39» стоїть під сусіднім днем.
Why it matters:     verifyhistory входить у CORE ci-browser.sh (запуск на кожен пуш) — червоний
                    CI чотири дні на місяць без жодної регресії; привчає ігнорувати CI.
Reproduction:       Копія скрипта з підміненим часом (node-час і page.clock):
                    FAKE_NOW=2026-09-03T12:00:00+03:00 TZ=Europe/Kyiv node /tmp/audit-time/vh.mjs
                    (проти FAKE_NOW=2026-09-15 — 23/23).
Observed:           FAIL 3. дні з тренуванням зафарбовані :: 1 з 3; FAIL 4. день 2026-08-31
                    клікабельний; FAIL 4. день 2026-08-30 клікабельний; далі TimeoutError на click.
Expected:           Скрипт або сіє дати всередині поточного місяця (напр. −2/−3/−4 від
                    max(сьогодні, 5-те число)), або перемикає календар на місяць потрібного дня.
Root cause:         Відносні дати без урахування межі місяця; UTC-ключ замість локального.
Impact:             Хибно-червоний CI (core на пуш, повний щоночі о 03:00 UTC) 1–4 числа.
Recommended fix:    Локальний key() як у verifyworkout.mjs; дні брати в межах місяця або клікати
                    [data-hnav="-1"], якщо ключ не в поточному місяці.
Regression test:    Сам verify: прогін із FAKE_NOW на 1–4 число має бути зеленим.
```

### TIM-009 — «Завершено <дата>» на сторінці тренування парсить ключ дня як UTC-північ

```text
ID:                 TIM-009
Severity:           LOW
Confidence:         CONFIRMED (логіка), ENVIRONMENTAL (лише пояси на захід від UTC)
Category:           дата/час / серіалізація ключа дня
Location:           js/workout.js:546 — dateLabel(weekDate), де weekDate = 'YYYY-MM-DD';
                    js/app.js:1430 — dateLabel робить new Date(iso)
Description:        Усі інші виклики dateLabel передають dateOf(key) (локальна дата з компонентів)
                    або повний ISO-час. Тут передається голий ключ дня: new Date('2026-09-04') —
                    це UTC-північ, і в поясах UTC−x getDate() дає попередній день.
Why it matters:     Користувачу в UTC−x показується «Завершено 3 вересня» для тренування
                    4 вересня; у Києві (UTC+) непомітно.
Reproduction:       TZ=America/Los_Angeles node -e "const d=new Date('2026-09-04'); console.log(d.getDate())"
Observed:           LA: 3; Kyiv: 4.
Expected:           dateLabel(dateOf(weekDate)) або парсинг за компонентами, як у age-core.
Root cause:         Той самий клас помилки, що описаний у js/age-core.js:27 — проігноровано в одному місці.
Impact:             Косметика; дані не змінює.
Recommended fix:    workout.js:546 → dateLabel(new Date(y, m−1, d)) з розбору ключа (є WC.todayKey/
                    addDaysKey — додати WC.dateOf).
Regression test:    tests/workout-core.test.js під TZ=America/Los_Angeles: підпис дати для '2026-09-04' містить «4».
```


## Спостереження (INFO)

- **TIM-I1.** `js/elo-hooks.js:77` збирає події за 3 локальні дні, а сервер приймає `p_day ≥ current_date − 2` (UTC): у поясах UTC−x увечері день «−2» отримує `out_of_window` (позначається надісланим, циклу немає). Для України невідтворюване.
- **TIM-I2.** `AgeCore.latestAdultBirthDate` 29 лютого повертає `YYYY-03-01` (переповнення конструктора Date), і `isAdult` того ж дня для цієї дати — `false`: атрибут `max` поля на день щедріший за перевірку. Раз на 4 роки, один день.
- **TIM-I3.** JS `ageOn` і PG `age()` для народжених 29 лютого узгоджені (17 років настає 1 березня в обох).
- **TIM-I4.** `OneRM.toPlates(82.3, 1e-320)` → `Infinity`; `toPlates(1e308)` → `1e308` — крок і вага з UI обмежені (`ROUND_STEP`, 500 кг), недосяжно.
- **TIM-I5.** `NutritionCalc.bmiInfo(80, 0)` → `{bmi: Infinity, label: 'Ожиріння'}`; `massForecast(…, 1e6)` рахує 3,3 с — обидва входи в UI фіксовані (LIMITS/select).
- **TIM-I6.** `HistoryCore.upsertSession` не обмежує `sets/reps/vol/done/total/t0/t1` зверху (1e308 приймається), `appendWeight` — `kg` зверху (у книзі ваг межа 500); дістатися можна лише через ручну правку localStorage — імпорт (`account.js`) клампить.
- **TIM-I7.** `journal.js:100` (`rolling`): вікно 7 днів через `end − 6·86400000` — у тиждень після осіннього переходу середня рахується за 6 днів (той самий клас, що TIM-002).
- **TIM-I8.** Бойова подія `workout` за 2026-09-04 (`quality 0.1`, `+1`) створена о 01:24 за Києвом 2026-09-05 — шлях «часткова сесія подається наступного дня» працює у продакшені; ключ дня локальний, `created_at::date` UTC — саме цю пару дивиться `admin_elo_anomalies.backdated` (поріг ≥ 2, тож нічні подачі не позначаються).
- **TIM-I9.** `elo_state.today`/`today_date` — UTC-день (див. TIM-007), клієнт підписує це «Сьогодні».
- **TIM-I10.** Тести `tests/elo-season-close.test.js:38,48` використовують `toISOString().slice(0,10)` лише для тексту повідомлення — на результат не впливає.
