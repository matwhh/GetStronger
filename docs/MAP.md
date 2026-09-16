# MAP — карта репозиторію

Що де лежить і від чого залежить. Мета файла одна: щоб на питання «а де
це міняти?» відповідь займала хвилину, а не годину читання коду.

Правила й заборони — в [`../AGENTS.md`](../AGENTS.md).
Як увійти в проєкт з нуля — в [`CONTINUE.md`](CONTINUE.md).
Покрокові рецепти — в [`RECIPES.md`](RECIPES.md).
Чому рішення саме такі — в [`ENGINEERING.md`](ENGINEERING.md).
Як зроблене скло — в [`GLASS.md`](GLASS.md).
Останній аудит — у [`audit/2026-09-12/AUDIT.md`](audit/2026-09-12/AUDIT.md).

---

## 1. Як влаштований сайт узагалі

```
запит сторінки
   ↓
*.html                 самостійна сторінка, без спільного шаблону
   ↓ <script defer>    порядок підключення в розмітці = порядок виконання
js/*.js                глобали window.*, без імпортів і бандлера
   ↓
window.Store           читає/пише профіль: localStorage або Supabase
```

Спільного шаблону немає навмисно: шапку, підвал і нижню панель малює
`js/app.js` у рантаймі. Тому нова сторінка — це порожній каркас плюс
свій скрипт, а не копія чужої розмітки.

**Спільний префікс скриптів** є на 18 «повних» сторінках, у цьому
порядку:

```
agegate · nosw · theme-boot · config · date-core · errors ·
age-core · onboarding-core · app · help · store ·
elo-core · elo-api · elo-hooks
```

Далі кожна сторінка додає своє.

Три файли в розмітці **не підключені** — їх вантажать ліниво:

| Файл | Хто вантажить | Коли |
|---|---|---|
| `js/help-content.js` | `js/help.js` | при першому відкритті довідки |
| `js/help-search-core.js` | `js/help.js` | там само, одразу після вмісту |
| `js/liquid-glass.js` · `js/tabbar-glass.js` | `js/app.js` | коли нижня панель справді видима |

Довідка важить 1058 рядків тексту, і до вересня 2026 вони їхали на
кожну сторінку разом із рештою. Тепер — тільки тим, хто натиснув книжку.

**`js/date-core.js` стоїть у префіксі перед усім, що рахує дні.** Це
єдина реалізація `keyOf`, `todayKey`, `dateOf`, `mondayOf` і
`daysBetween` у проєкті; решта модулів мають у себе лише делегат в один
рядок. Сторожить `tools/ci-hygiene.mjs`, перевірки 14 і 15.

---

## 2. Сторінки

| Сторінка | Для користувача | Свої скрипти (після спільного префікса) |
|---|---|---|
| `index.html` | «Сьогодні»: огляд дня | history-core, daylog-core, exercises, reps-core, programs-data, nutrition-core, tracker-core, tracker-tile-core, workout-core, progression-core, measure-core, **today** |
| `workout.html` | Екран тренування в залі | history-core, exercises, reps-core, programs-data, tracker-core, workout-core, weight-limits-core, finish-core, **workout** |
| `programs.html` | Вибір і редагування плану | history-core, exercises, reps-core, programs-data, workout-core, **programs** |
| `plan.html` | Мій план + прогноз ваг | …, onerm-core, periodization-core, programs, projection, **plan-ui** |
| `periodization.html` | Цикл на 8–16 тижнів | exercises, reps-core, programs-data, onerm-core, periodization-core, **periodization** |
| `journal.html` | Прогрес: вага, сила, тренування, «що працює саме на тобі» | daycal-core, history-core, daylog-core, progression-core, statwindow-core, progress-core, tdee-core, coach-core, adherence-core, onerm-core, exercise-core, tracker-core, enough-core, insight-core, **journal** |
| `nutrition.html` | План харчування: норма КБЖВ | donut-core, nutrition-core, **nutrition** |
| `meals.html` | Раціон: продукти, рецепти, день | history-core, foods, recipes-data, donut-core, day-core, nutrition-core, **meals** |
| `measure.html` | Заміри тіла | history-core, measure-core, **measure** |
| `train-log.html` | «Дні тренувань»: календар і одна позначка | daycal-core, daylog-core, **train-log** |
| `weight-log.html` | «Зважування»: поле вводу й календар | daycal-core, daylog-core, **weight-log** |
| `trackers.html` | «Трекери»: **тільки налаштування** — що відстежувати й з якою ціллю | measure-core, tracker-core, **trackers-settings** |
| `trackers-settings.html` | Стара адреса | nosw, **trackers-settings-redirect**, agegate |
| `rating.html` | Сезонний рейтинг ELO: стрічка подій (згортається), таблиця лідерів, нагороди в самому низу | daycal-core, award-core, elo-view-core, **season** |
| `seasons.html` | Розбір завершених сезонів: підсумки, драбина, категорії, нагороди сезону | award-core, elo-view-core, **seasons** |
| `awards.html` | Окрема вітрина нагород: фільтри за сезоном і рідкістю; місце під тамагочі | award-core, **awards** |
| `calculator.html` | Калькулятор 1ПМ | onerm-core, **onerm** |
| `cardio.html` | Пульсові зони, LISS vs HIIT | **cardio** |
| `boxing.html` | Тренування на мішку | boxing-data, **boxing** |
| `supplements.html` | Добавки: що працює | supplements, **supplements-view** |
| `account.html` | Акаунт, профіль, експорт/імпорт | nutrition-core, bmi-core, measure-core, programs-data, import-core, **account** |
| `welcome.html` | Онбординг: вік і дані тіла | nutrition-core, bmi-core, password-core, auth-msg-core, legal-versions, **welcome** |
| `admin.html` | Заявки й ручний ELO | admin, **admin-elo** |
| `research.html` | Статті з PubMed | — (тільки спільний префікс) |
| `legal.html` | Правові документи | nosw, theme-boot, **legal-back** |
| `offline.html` | Немає звʼязку | **offline-retry** |
| `today.html` | Стара адреса | nosw, **today-redirect**, agegate |

**Трекери живуть на «Сьогодні», а не на своїй сторінці.** До вересня
2026 їх було дві: `trackers.html` (вводити значення) і
`trackers-settings.html` (вибирати, що відстежувати). Ввід переїхав на
головну — саме там людина й відкриває застосунок, — і сторінки злились
в одну, з налаштуваннями. Стара адреса лишилась редиректом, бо вона є в
закладках і в історії браузера.

---

## 3. Ядра — `js/*-core.js`, `js/*-data.js`

Без DOM, без `location`, без слухачів. Під юніт-тестами. Саме тому їх
можна перенести в мобільний застосунок без переписування.

38 файлів, ~13 200 рядків.

| Файл | Ряд. | Що робить | Глобал і ключові функції | Залежить від |
|---|---:|---|---|---|
| `programs-data.js` | 893 | каталог програм, розминка, доступ за статтю | `PROGRAMS`, `WARMUP`, `COOLDOWN`, `programAllowedFor` | — |
| `tracker-core.js` | 869 | реєстр трекерів, записи, стріки, закріплення на «Сьогодні» | `TrackerCore`: `ensureBuiltins`, `logValue`, `entriesFor`, `streak`, `goalAdherence`, `setPinned`, `pinnedList`, `pinnedCards`, `isCard` | `DateCore` |
| `import-core.js` | 851 | валідація імпортованого профілю: що взяти, що відкинути мовчки, що показати | `ImportCore`: `ALLOWED_KEYS`, `validate` | — |
| `nutrition-core.js` | 585 | BMR/TDEE/ціль/макроси/прогноз маси | `NutritionCalc`: `targetFor`, `bmrMifflin`, `bmrKatch`, `macros`, `massForecast`, `LIMITS` | — |
| `workout-core.js` | 485 | тренувальний день: план, галочки, підходи | `WorkoutCore`: `resolvePlan`, `readDay`/`writeDay`, `plannedSets`, `dayStats`, `weekStartKey` | `PROGRAMS`, `MUSCLES`, `RepsCore`, `DateCore` |
| `periodization-core.js` | 470 | лінійний цикл, % від 1ПМ, дельоуд | `Periodization`: `buildCycle`, `pctForWeek`, `currentWeek`, `applyDeload`, `applyRaise` | `OneRM` |
| `progress-core.js` | 445 | зведена аналітика над журналами | `ProgressCore`: `bodyStats`, `forecast`, `liftStats`, `trainingStats`, `prList` | `HistoryCore`, `DateCore`, `Enough` |
| `enough-core.js` | 135 | **скільки даних стоїть за числом** — одне правило на весь сайт: `none` / `thin` / `ok` замість «є або немає» | `Enough`: `of`, `label`, `gate` | — |
| `insight-core.js` | 310 | «що працює саме на тобі»: порівняння власних тижнів по медіані причини | `InsightCore`: `weeks`, `compare`, `findings` | `DateCore`, `Enough`, `HistoryCore`, `TrackerCore`, `ProgressCore` |
| `tracker-tile-core.js` | 383 | кубик трекера на «Сьогодні»: свій ввід під кожен вид | `TrackerTile`: `html`, `grid`, `isWide` | `TrackerCore` |
| `elo-core.js` | 374 | сезони, рівні, бюджети, дельти дій | `EloCore`: `seasonOf`, `seasonRange`, `levelFor`, `weeklyBudget`, `actionDelta`, `applyDayCaps` | — |
| `award-core.js` | 361 | двобічна картка нагороди, 8 щаблів рідкості (Common…Legendary), вітрина з силуетами | `Award`: `html`, `grid`, `showcase`, `CODES`, `ORDER`, `TIERS`, `tierOf` | — |
| `elo-view-core.js` | 335 | показ серверних даних рейтингу: події → дні, підсумки сезонів, драбина | `EloView`: `groupByDay`, `eventsSummary`, `seasonStats`, `seasonLadder`, `dayLabel`, `human`, `catLabel` | `DateCore` |
| `exercise-core.js` | 350 | прогрес однієї вправи зі знімків сесій | `ExerciseCore`: `series`, `stats`, `trend`, `prFromSessions`, `METRICS` | `OneRM` |
| `progression-core.js` | 335 | «пора підняти вагу»: коли підказати й на скільки | `ProgressionCore`: `due`, `hitTop`, `weekComplete`, `ages`, `snoozeUntil`, `STEP_LEGS`, `STEP_OTHER` | `DateCore` |
| `history-core.js` | 320 | журнали: ваги, сесії, закриті дні | `HistoryCore`: `appendWeight`, `weightSeries`, `upsertSession`, `closeDay` | `DateCore` |
| `daylog-core.js` | 233 | ⭐ **правила обох журналів дня**: чи був тренувальний день, як пишеться вага | `DayLogCore`: `trained`, `toggleTrained`, `dayLevel`, `LEVEL_TEXT`, `parseKg`, `setWeight`, `weightEntries`, `pickDay`, `weekTally` | `DateCore` |
| `boxing-data.js` | 267 | одна готова боксерська сесія | `BOXING`: `session`, `sessionText` | — |
| `onerm-core.js` | 259 | математика 1ПМ, набір млинців | `OneRM`: `oneRepMax`, `estimates`, `percentOfMax`, `toPlates`, `PLATE_STEP` | — |
| `password-core.js` | 256 | надійність пароля за правилами Supabase | `PasswordCore`: `check`, `MIN_LEN`, `MAX_LEN` | — |
| `measure-core.js` | 236 | заміри тіла: поля, валідація, серії, зведення на «Сьогодні» | `MeasureCore`: `FIELDS`, `validValue`, `buildEntry`, `series`, `stats`, `homeSummary`, `STALE_DAYS` | `DateCore` |
| `adherence-core.js` | 236 | % дисципліни за період | `AdherenceCore`: `trainingAdherence`, `nutritionAdherence`, `PERIODS` | `EloCore`, `DateCore` |
| `daycal-core.js` | 198 | спільна сітка календаря днів | `DayCal`: `html`, `keyOf`, `dateOf`, `mondayOf` | `DateCore` |
| `help-search-core.js` | 186 | пошук по довідці: нормалізація, індекс, ранжування | `HelpSearchCore`: `norm`, `buildIndex`, `search` | — |
| `onboarding-core.js` | 176 | крок онбордингу з полів профілю | `OnboardingCore`: `stepFor`, `pageFor`, `isAllowed`, `LIMITS` | `AgeCore` |
| `bmi-core.js` | 168 | BMI, категорія, попередження | `BmiCore`: `bmi`, `category`, `shouldWarn`, `showWarnModal` | `App.lockScroll` ⚠️ |
| `donut-core.js` | 163 | SVG-кільце складу з анімацією | `Donut`: `html`, `animate` | — |
| `statwindow-core.js` | 158 | вікно, за яке рахується статистика (НЕ сезон рейтингу) | `StatWindow`: `current`, `at`, `contains`, `clipSeries` | `DateCore` |
| `reps-core.js` | 151 | діапазон повторень зі стажу й групи | `RepsCore`: `repRangeFor`, `tierFor`, `applyPlan`, `RANGES` | `MUSCLES` |
| `date-core.js` | 149 | ⭐ **єдине джерело правди про дати** | `DateCore`: `keyOf`, `todayKey`, `dateOf`, `mondayOf`, `addDays`, `shiftKey`, `daysBetween`, `lastKeys` | — |
| `auth-msg-core.js` | 148 | людські тексти помилок входу й реєстрації | `AuthMsg`: `emailProblem`, `loginPassProblem`, `signInProblem` | — |
| `day-core.js` | 136 | арифметика КБЖВ дня, рецепти | `DayCore`: `dayTotals`, `recipeTotals`, `perContainer`, `MEAL_ITEM_CAP` | `Foods`, `BASE_RECIPES` |
| `recipes-data.js` | 121 | вбудовані рецепти, лише читання | `BASE_RECIPES` | — |
| `finish-core.js` | 121 | завершення тренування: чи питати про біль, яка цитата | `FinishCore`: `shouldAsk`, `painToday`, `pickQuote`, `QUOTES` | — |
| `age-core.js` | 113 | вік і вердикт повноліття | `AgeCore`: `ageOn`, `isAdult`, `gateState` | — |
| `weight-limits-core.js` | 110 | стеля робочої ваги за групою мʼязів | `WeightLimits`: `maxFor`, `check`, `message`, `BY_MUSCLE` | — |

⚠️ `bmi-core.js` — єдине ядро, що торкається DOM. Це борг, а не зразок.

### Дві шкали часу, і їх не можна плутати

Це найчастіше джерело помилок у проєкті, тож написано прямо в
`js/date-core.js`, а тут — коротко:

- **Ключ дня — МІСЦЕВИЙ.** `keyOf(new Date())` дає `2026-09-12` за
  годинником людини. Усі журнали профілю ключовані саме так.
- **Різниця днів — В UTC.** `daysBetween('2026-03-28','2026-03-29')` = 1,
  хоча через перехід на літній час місцева доба тривала 23 години.
  Рахувати різницю місцевими датами означає отримати 0 або 2 двічі на рік.

### Один журнал — три входи

`profile.workLog` і `profile.bodyLog` пише тепер троє: «Сьогодні»
(плитки), окремі сторінки «Дні тренувань» і «Зважування», і «Прогрес».
Правила запису в усіх одні — `js/daylog-core.js`. Це не формальність:
до вересня 2026 питання «чи був цього дня тренувальний день» відповідали
`journal.js` і `today.js` кожен своїм кодом, і код збігався «майже».
Журнал умів явний нуль як «знято руками», і достатньо було правки в
одному з двох, щоб теплокарта й квадратик на головній почали розповідати
про той самий день різне — мовчки.

---

## 4. Інтерфейс і сервіси — решта `js/`

| Файл | Ряд. | Що робить | Де працює |
|---|---:|---|---|
| `journal.js` | 2932 | графіки, календарі, історія прогресу | journal |
| `programs.js` | 2582 | вибір схеми, редактор плану, обʼєм | programs, plan |
| `store.js` | 2514 | сховище профілю: локально або Supabase | усюди |
| `app.js` | 2263 | каркас: шапка, нав, таб-бар, тости, хелпери | усюди |
| `meals.js` | 1880 | продукти, рецепти, план дня | meals |
| `welcome.js` | 1769 | онбординг, заявка на акаунт | welcome |
| `workout.js` | 1144 | підходи, ваги, таймер відпочинку, завершення | workout |
| `help-content.js` | 1058 | ТЕКСТ контекстної довідки (ліниво) | усюди |
| `account.js` | 971 | вхід/реєстрація, профіль, експорт/імпорт | account |
| `today.js` | 967 | складання головного екрана | index |
| `nutrition.js` | 860 | норма калорій і макросів | nutrition |
| `help.js` | 749 | механізм довідки (кнопка-книжка) + ліниве довантаження | усюди |
| `trackers-settings.js` | 708 | налаштування трекерів і цілей | trackers |
| `periodization.js` | 519 | налаштування циклу й таблиця | periodization |
| `foods.js` | 502 | довідник продуктів | index, meals |
| `season.js` | 827 | показ ELO, шкала рівня, стрічка подій по днях, лідери, календар сезону | rating |
| `seasons.js` | 416 | підсумки завершених сезонів, драбина, розбір кожного | seasons |
| `liquid-glass.js` | 492 | оптика «рідкого скла» (вендор, MIT) | таб-бар |
| `projection.js` | 441 | прогноз робочих ваг на 6/12/24 міс. | plan |
| `tabbar-glass.js` | 429 | жест і геометрія нижньої панелі | таб-бар |
| `measure.js` | 425 | ввід і історія замірів | measure |
| `elo-api.js` | 380 | клієнт RPC сезонного ELO | усюди |
| `agegate.js` | 367 | сторож віку й онбордингу перед сторінкою | усюди |
| `exercises.js` | 328 | довідник груп мʼязів і вправ | workout, plan |
| `onerm.js` | 281 | інтерфейс калькулятора 1ПМ | calculator |
| `cardio.js` | 281 | пульсові зони (Tanaka), план бігу | cardio |
| `elo-hooks.js` | 251 | `Store.onChange` → події ELO | більшість |
| `errors.js` | 247 | репорт JS-помилок у Sentry | усюди |
| `supplements-view.js` | 244 | рендер сторінки добавок | supplements |
| `admin-elo.js` | 243 | ручне виставлення ELO | admin |
| `boxing.js` | 219 | рендер сесії + копіювання | boxing |
| `admin.js` | 191 | заявки й рішення адміна | admin |
| `awards.js` | 187 | вітрина нагород, фільтри за сезоном і рідкістю | awards |
| `supplements.js` | 180 | дані про добавки | supplements |
| `config.js` | 52 | ключі Supabase, Sentry, домен | усюди |
| `theme-boot.js` | 43 | оформлення до розмітки, без миготіння | усюди |
| `plan-ui.js` | 43 | порожній/заповнений стан плану | plan |
| `nosw.js` | 34 | аварійне зняття SW (`?nosw=1`) | усюди |
| `trackers-settings-redirect.js` · `legal-back.js` · `legal-versions.js` · `offline-retry.js` · `today-redirect.js` | 8–16 | дрібні помічники | відповідні сторінки |

### Що конкретно робить `app.js`

Шапка й підвал (`buildNav`, `buildFooter`) · бургер до 1060px ·
нижня панель розділів (`buildTabBar` + ліниве довантаження скла) ·
жетон рівня й стан синхронізації в шапці · `og:url` ·
ефекти (`initReveal`, `initTilt`, `initSegs`, `initAccordions`,
`initBadgeGlass`, `initLongform`) · тости · таймер відпочинку ·
реєстрація service worker · перехід через північ (`onDayChange`) ·
`rescue()` — знімає клас `.js`, якщо `boot()` не дійшов до кінця, щоб не
лишити білу сторінку.

Публічне API — `window.App`:
`$`, `$$`, `esc`, `round`, `clamp`, `num`, `toast`, `initReveal`,
`safeUrl`, `initAccordions`, `initSegs`, `initTilt`, `initLongform`,
`copyRich`, `restTimer`, `plural`, `fmt`, `fmtNum`, `stampRating`,
`flashDone`, `busy`, `dateLabel`, `levelIcon`, `lockScroll`,
`onDayChange`, `whenReady`.

---

## 5. Дані

### localStorage

| Ключ | Що це |
|---|---|
| `ib.profile` | сам профіль, один JSON |
| `ib.profile.backup` | копія перед імпортом («Відкотити імпорт») |
| `ib.profile.backup.login` | копія перед розвʼязанням конфлікту входу |
| `ib.profile.owner` | чий це локальний профіль |
| `ib.profile.dirty` | «є зміни, які могли не доїхати» (ставиться ДО запису) |
| `ib.profile.corrupt.<час>` | відкладена копія пошкодженого профілю |
| `ib.pending` | черга офлайн-патчів |
| `ib.session` · `ib.remember` · `ib.auth.await` | сесія й вхід |
| `ib.account` | кеш статусу акаунта (лише UX; барʼєр — RLS) |
| `ib.cloud` | підказка `agegate.js`, який стартує до `config.js` |
| `ib.elo*` | стан, черга й дедуплікація ELO |
| `ib.regdraft` · `ib.meals.fold` · `forge.today` | чернетки й згорнуті блоки |

`PERSONAL_KEYS` у `store.js` — **один** перелік на весь файл. Три списки
вже розходились (SYN-006).

`SCHEMA_VERSION = 12` — версія ФОРМИ даних. Росте лише при зміні
структури, не при додаванні поля. `migrate()` веде профіль по одному
кроку; версія 5 зайнята назавжди (прибране «Обране»).

### Ключі профілю, що ростуть журналами

| Ключ у профілі | Хто пише | Хто читає |
|---|---|---|
| `weightLog` | account, welcome, journal | `HistoryCore`, `ProgressCore` |
| `sessions` | workout | `ExerciseCore`, `ProgressCore`, ELO |
| `sessionLog` | workout | `ProgressCore` (зокрема `rirStats`), `ExerciseCore`, журнал; підходи лежать у `ex[].s[]` як `{w, r, q}` — вага, повтори, RIR |
| `days` | workout, today | `WorkoutCore`, теплокарта, ELO |
| `measureLog` | measure | `MeasureCore` (зокрема `homeSummary` на «Сьогодні») |
| `trackers` · `trackerLog` | trackers, today | `TrackerCore` |
| `mealLog` | meals | `DayCore`, `AdherenceCore` |
| `gym` | «Мій план» (`gym-view.js`) | `GymCore` — крок ваги, розминкові сходинки; `null` = стара поведінка |
| `tdeeMode` | «Харчування» | `NutritionCalc.targetFor` — `'measured'` рахує ціль від виміряного підтримання (`TdeeCore`); `null` = формула |

Усі вони ключовані **місцевим** днем — див. кінець розділу 3.

### Supabase

| Назва | Звідки | Що робить |
|---|---|---|
| `profiles` (REST) | `store.js` | один рядок на користувача, профіль у `jsonb` |
| `/auth/v1/*` | `store.js` | реєстрація, вхід, refresh, recover, logout |
| `profile_patch` | `store.js` | часткове збереження при закритті вкладки (keepalive, ≤64 КБ) |
| `account_state` · `delete_account` | `store.js` | статус акаунта, видалення |
| `register_request` · `username_free` | `welcome.js` | заявка й перевірка ніка |
| `elo_state` · `elo_submit` | `elo-api.js` | стан сезону; **єдина точка запису події** |
| `elo_catch_up` · `elo_close_season` · `elo_activate_grace` | `elo-api.js` | пропущені тижні, закриття сезону, пільговий тиждень |
| `elo_leaderboard` · `elo_set_name` · `elo_history` · `elo_recent` | `elo-api.js`, `season.js`, `seasons.js` | дошка, імʼя, історія сезонів, стрічка подій |
| `admin_requests` · `admin_decide` | `admin.js` | заявки й рішення |
| `admin_elo_list` · `admin_elo_anomalies` · `admin_elo_set` | `admin-elo.js` | адмінський ELO |

### `db/`

Джерело правди про бойову схему — **`db/live-schema.sql`** (знімок,
генерується `dump-live-schema.sql`, руками не редагується). Решта файлів
— історія змін, тести й точкові виправлення; **виконувати їх по
продакшену не можна**. Порядок і правила — `db/README.md`.

Rollback-файлів сім, усі з суфіксом `-rollback.sql`: `award-beta`,
`elo-partial-cap`, `elo-recount-category`, `elo-skip-category`,
`elo-skip-whitelist`, `season-week-bounds`, `cron-keep-work`. Так і має
бути в кожної ризикованої міграції: відкат пишеться разом із нею, а не
тоді, коли вже треба відкочуватись.

### `sw.js`

`CACHE = 'forge-v1'`, і імʼя навмисно не змінюється. HTML — мережа перша
(тайм-аут 4 с); CSS і JS — мережа перша (2 с); картинки —
stale-while-revalidate. Свіжий HTML звіряється з кешованим, і при
розбіжності кеш зноситься ЦІЛКОМ, щоб скрипти приїхали з тієї самої
публікації. Чуже походження, не-GET і `?nosw=1` не перехоплюються.

---

## 6. Перевірки

Три рівні, від найдешевшого до найдорожчого.

| Рівень | Чим | Скільки | Коли |
|---|---|---|---|
| Юніт | `node --test`, без залежностей | скільки саме — друкує `npm test` | `npm test`, ~15 с |
| Гігієна | `tools/ci-hygiene.mjs` | **20 перевірок**; по скількох файлах — каже сам скрипт | `node tools/ci-hygiene.mjs`, ~1 с |
| Браузер | Playwright на справжньому Chromium | **14 наборів у `core`, 55 у `full`** | `bash tools/ci-browser.sh core` |

Скільки тут файлів і тестів — у [`../AGENTS.md`](../AGENTS.md) §2.2 і
ніде більше: копія числа не падає, вона просто старіє, тому перевірка 20
гігієни звіряє ту таблицю з репозиторієм.

Ще 6 файлів `verify*.mjs` — не браузерні: `verify-sql-suites.mjs`,
`verify-schema-perms.mjs`, `verify-elo-week.mjs`,
`verify-backup-roundtrip.mjs`, `verify-elo-skip.mjs`, `verifyauthz.mjs`.

Набори задає `tools/ci-browser.sh`:

- **core** (кожен пуш, ~8 хв), 14 наборів: `verifyhistory`,
  `verifyworkout`, `verifydata`, `verifyroundtrip`, `verifyloop`,
  `verify7`, `verifyaccountmix`, `verifylink`, `verifysw`, `verifyhelp`,
  `verifymeasurewidget`, `verifyawards`, `verifyseasons`, `verifydaylogs`.
- **full** (раз на добу): core + 41, зокрема `verifylvlbar`, `verifya11y`,
  `verifythemes`, `verifyresponsive`, `verifyperf`, `verifychaos`,
  `verifychaos2`, `verifyhardening`, `verifytabbar`, `verifydonut`,
  `verifydaycal`, `verifylevelicon`, `verifyprogression`.
- **Тільки вручну, з дозволу власника — ходять у бойовий бекенд:**
  `verifyregister`, `verifyregfail`, `verifyregresume`, `verifyrecover`,
  `verifyproduction`, `verifyauthz`.

`.github/workflows/ci.yml`: `test` — юніт, гігієна, відновлення з
резервної копії (`verify-backup-roundtrip`), оцінка тижня
(`verify-elo-week`), права й політики (`verify-schema-perms`),
SQL-набори (`verify-sql-suites`), вимкнена категорія рейтингу
(`verify-elo-skip`) і баланс (`simelo`); `browser` (core) на кожен пуш;
`browser-full` — за розкладом; `pulse` — щоденний `curl` у Supabase,
щоб free-план не заснув.

### Що стереже гігієна

1–11 — чужі ключі й токени, заборонені файли, розбір JWT Supabase,
оболонка service worker проти `index.html`, inline-скрипти (їх забороняє
CSP), дрейф барʼєрів між `db/*.sql` і бойовою схемою.
Додані у вересні 2026:

| № | Перевірка | Чому зʼявилась |
|---:|---|---|
| 12 | біт виконання `*.command` / `*.sh` **в індексі git** | кнопка публікації приїхала з хмари як 0644 і не запускалась |
| 13 | адреса репозиторію написана однаково всюди | у скрипті стояло `Get-Stronger`, а репозиторій `GetStronger` |
| 14 | лише `js/date-core.js` має власне тіло `keyOf`/`dateOf`/`mondayOf`/… | `mondayOf` жив у 4 файлах із 4 різними реалізаціями |
| 15 | сторінка, що вантажить модуль із датами, вантажить і `date-core` | інакше делегат падає на `undefined` |
| 16 | у CSS немає правил під класи, яких ніде немає | мертві правила лишались після кожного переписаного екрана |
| 17 | назви місяців і днів тижня — лише в `js/date-core.js` | список місяців жив чотирма копіями; такі словники не падають, вони розходяться написанням |

Інші скрипти в `tools/`: `adult.mjs` (садить пройдений профіль),
`pw.mjs` (шляхи до Chromium), `ci-offline.sh` (вішає Supabase і Sentry
на 127.0.0.1), `ci-hygiene.mjs`, `build-meta.js`, `og.mjs`, `shot.mjs`,
`simelo.mjs` (баланс ELO, має лишатись 6/6), `restore-backup.mjs`.

Кнопки в корені репозиторію — подвійний клік у Finder:

| Кнопка | Що робить |
|---|---|
| `Опублікувати.command` | тести → гігієна → коміт → пуш. Червоні тести = нічого не відправлено |
| `Токен GitHub.command` | записує новий токен у звʼязку ключів і одразу публікує |
| `Прибрати-сміття.command` | чистить тимчасові файли перед релізом |
| `Увімкнути-CI.command` | вмикає прогін GitHub Actions на цьому клоні |

Біт виконання на них стереже перевірка 12 гігієни — і саме **в індексі
git**, бо файл, що приїхав з хмари як 0644, у Finder не запускається.
