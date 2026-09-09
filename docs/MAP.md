# MAP — карта репозиторію

Що де лежить і від чого залежить. Мета файла одна: щоб на питання «а де
це міняти?» відповідь займала хвилину, а не годину читання коду.

Правила й заборони — в [`../AGENTS.md`](../AGENTS.md).
Покрокові рецепти — в [`RECIPES.md`](RECIPES.md).
Чому рішення саме такі — в [`ENGINEERING.md`](ENGINEERING.md).

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

**Спільний префікс скриптів** є на всіх 20 «повних» сторінках, у цьому
порядку:

```
agegate · nosw · theme-boot · config · errors · age-core ·
onboarding-core · app · help-content · help · store ·
elo-core · elo-api · elo-hooks
```

Далі кожна сторінка додає своє. `js/liquid-glass.js` і
`js/tabbar-glass.js` у розмітці **не підключені** — їх лінивo вантажить
`app.js`, коли нижня панель справді видима.

---

## 2. Сторінки

| Сторінка | Для користувача | Свої скрипти (після спільного префікса) |
|---|---|---|
| `index.html` | «Сьогодні»: огляд дня | history-core, exercises, reps-core, programs-data, foods, recipes-data, day-core, nutrition-core, tracker-core, workout-core, season-core, **today** |
| `workout.html` | Екран тренування в залі | history-core, exercises, reps-core, programs-data, tracker-core, workout-core, **workout** |
| `programs.html` | Вибір і редагування плану | history-core, exercises, reps-core, programs-data, workout-core, **programs** |
| `plan.html` | Мій план + прогноз ваг | …, onerm-core, periodization-core, programs, projection, **plan-ui** |
| `periodization.html` | Цикл на 8–16 тижнів | exercises, reps-core, programs-data, onerm-core, periodization-core, **periodization** |
| `journal.html` | Прогрес: вага, сила, тренування | daycal-core, history-core, season-core, progress-core, adherence-core, onerm-core, exercise-core, tracker-core, **journal** |
| `nutrition.html` | План харчування: норма КБЖВ | donut-core, nutrition-core, **nutrition** |
| `meals.html` | Раціон: продукти, рецепти, день | history-core, foods, recipes-data, donut-core, day-core, nutrition-core, **meals** |
| `measure.html` | Заміри тіла | history-core, measure-core, **measure** |
| `trackers.html` | Трекери дня: ввід значень | tracker-core, **trackers-day** |
| `trackers-settings.html` | Що саме відстежувати | tracker-core, **trackers-settings** |
| `rating.html` | Сезонний рейтинг ELO | daycal-core, **season** |
| `calculator.html` | Калькулятор 1ПМ | onerm-core, **onerm** |
| `cardio.html` | Пульсові зони, LISS vs HIIT | **cardio** |
| `boxing.html` | Тренування на мішку | boxing-data, **boxing** |
| `supplements.html` | Добавки: що працює | supplements, **supplements-view** |
| `account.html` | Акаунт, профіль, експорт | nutrition-core, bmi-core, measure-core, programs-data, **account** |
| `welcome.html` | Онбординг: вік і дані тіла | nutrition-core, bmi-core, password-core, legal-versions, **welcome** |
| `admin.html` | Заявки й ручний ELO | admin, **admin-elo** |
| `research.html` | Статті з PubMed | — (тільки спільний префікс) |
| `legal.html` | Правові документи | nosw, theme-boot, **legal-back** |
| `offline.html` | Немає звʼязку | **offline-retry** |
| `today.html` | Стара адреса | nosw, **today-redirect**, agegate |

---

## 3. Ядра — `js/*-core.js`, `js/*-data.js`

Без DOM, без `location`, без слухачів. Під юніт-тестами. Саме тому їх
можна перенести в мобільний застосунок без переписування.

| Файл | Ряд. | Що робить | Глобал і ключові функції | Залежить від |
|---|---:|---|---|---|
| `nutrition-core.js` | 585 | BMR/TDEE/ціль/макроси/прогноз маси | `NutritionCalc`: `targetFor`, `bmrMifflin`, `bmrKatch`, `macros`, `massForecast`, `LIMITS` | — |
| `workout-core.js` | 488 | тренувальний день: план, галочки, підходи | `WorkoutCore`: `resolvePlan`, `readDay`/`writeDay`, `plannedSets`, `dayStats`, `weekStartKey` | `PROGRAMS`, `MUSCLES`, `RepsCore` |
| `periodization-core.js` | 470 | лінійний цикл, % від 1ПМ, дельоуд | `Periodization`: `buildCycle`, `pctForWeek`, `currentWeek`, `applyDeload`, `applyRaise` | `OneRM` |
| `progress-core.js` | 427 | зведена аналітика над журналами | `ProgressCore`: `bodyStats`, `forecast`, `liftStats`, `trainingStats`, `prList` | `HistoryCore` |
| `elo-core.js` | 374 | сезони, рівні, бюджети, дельти дій | `EloCore`: `seasonOf`, `seasonRange`, `levelFor`, `weeklyBudget`, `actionDelta`, `applyDayCaps` | — |
| `exercise-core.js` | 350 | прогрес однієї вправи зі знімків сесій | `ExerciseCore`: `series`, `stats`, `trend`, `prFromSessions`, `METRICS` | `OneRM` |
| `history-core.js` | 321 | журнали: ваги, сесії, закриті дні | `HistoryCore`: `todayKey`, `appendWeight`, `weightSeries`, `upsertSession`, `closeDay` | — |
| `tracker-core.js` | 711 | модульні трекери: реєстр, записи, стріки | `TrackerCore`: `ensureBuiltins`, `logValue`, `entriesFor`, `streak`, `goalAdherence` | — |
| `onerm-core.js` | 259 | математика 1ПМ, набір млинців | `OneRM`: `oneRepMax`, `estimates`, `percentOfMax`, `toPlates`, `PLATE_STEP` | — |
| `password-core.js` | 256 | надійність пароля за правилами Supabase | `PasswordCore`: `check`, `MIN_LEN`, `MAX_LEN` | — |
| `adherence-core.js` | 237 | % дисципліни за період | `AdherenceCore`: `trainingAdherence`, `nutritionAdherence`, `PERIODS` | `EloCore` |
| `daycal-core.js` | 199 | спільна сітка календаря днів | `DayCal`: `html`, `keyOf`, `dateOf`, `mondayOf` | — (навмисно) |
| `onboarding-core.js` | 176 | крок онбордингу з полів профілю | `OnboardingCore`: `stepFor`, `pageFor`, `isAllowed`, `LIMITS` | `AgeCore` |
| `bmi-core.js` | 168 | BMI, категорія, попередження | `BmiCore`: `bmi`, `category`, `shouldWarn`, `showWarnModal` | `App.lockScroll` ⚠️ |
| `donut-core.js` | 163 | SVG-кільце складу з анімацією | `Donut`: `html`, `animate` | — |
| `season-core.js` | 152 | вікно періоду статистики | `SeasonCore`: `current`, `at`, `contains`, `clipSeries` | — |
| `reps-core.js` | 151 | діапазон повторень зі стажу й групи | `RepsCore`: `repRangeFor`, `tierFor`, `applyPlan`, `RANGES` | `MUSCLES` |
| `measure-core.js` | 150 | заміри: поля, валідація, серії | `MeasureCore`: `FIELDS`, `validValue`, `buildEntry`, `series` | — |
| `day-core.js` | 136 | арифметика КБЖВ дня, рецепти | `DayCore`: `dayTotals`, `recipeTotals`, `perContainer`, `MEAL_ITEM_CAP` | `Foods`, `BASE_RECIPES` |
| `age-core.js` | 113 | вік і вердикт повноліття | `AgeCore`: `ageOn`, `isAdult`, `gateState` | — |
| `programs-data.js` | 805 | каталог програм, розминка, доступ за статтю | `PROGRAMS`, `WARMUP`, `COOLDOWN`, `programAllowedFor` | — |
| `boxing-data.js` | 267 | одна готова боксерська сесія | `BOXING`: `session`, `sessionText` | — |
| `recipes-data.js` | 121 | вбудовані рецепти, лише читання | `BASE_RECIPES` | — |

⚠️ `bmi-core.js` — єдине ядро, що торкається DOM. Це борг, а не зразок.

---

## 4. Інтерфейс і сервіси — решта `js/`

| Файл | Ряд. | Що робить | Де працює |
|---|---:|---|---|
| `store.js` | 2507 | сховище профілю: локально або Supabase | усюди |
| `app.js` | 2148 | каркас: шапка, нав, таб-бар, тости, хелпери | усюди |
| `journal.js` | 2804 | графіки, календарі, історія прогресу | journal |
| `programs.js` | 2374 | вибір схеми, редактор плану, обʼєм | programs, plan |
| `meals.js` | 1880 | продукти, рецепти, план дня | meals |
| `account.js` | 1711 | вхід/реєстрація, профіль, експорт | account |
| `welcome.js` | 1498 | онбординг, заявка на акаунт | welcome |
| `workout.js` | 1006 | підходи, ваги, таймер відпочинку | workout |
| `nutrition.js` | 860 | норма калорій і макросів | nutrition |
| `trackers-settings.js` | 604 | налаштування трекерів і цілей | trackers-settings |
| `help-content.js` | 602 | ТЕКСТ контекстної довідки | усюди |
| `periodization.js` | 519 | налаштування циклу й таблиця | periodization |
| `foods.js` | 502 | довідник продуктів | index, meals |
| `season.js` | 470 | показ ELO, рівня, лідерів, календар сезону | rating |
| `help.js` | 468 | механізм довідки (кнопка-книжка) | усюди |
| `projection.js` | 441 | прогноз робочих ваг на 6/12/24 міс. | plan |
| `today.js` | 429 | складання головного екрана | index |
| `measure.js` | 424 | ввід і історія замірів | measure |
| `trackers-day.js` | 407 | шкали 1..10 за сьогодні | trackers |
| `liquid-glass.js` | 401 | оптика «рідкого скла» (вендор, MIT) | таб-бар |
| `tabbar-glass.js` | 400 | жест і геометрія нижньої панелі | таб-бар |
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
| `supplements.js` | 180 | дані про добавки | supplements |
| `config.js` | 47 | ключі Supabase, Sentry, домен | усюди |
| `theme-boot.js` | 43 | оформлення до розмітки, без миготіння | усюди |
| `plan-ui.js` | 43 | порожній/заповнений стан плану | plan |
| `nosw.js` | 34 | аварійне зняття SW (`?nosw=1`) | усюди |
| `legal-back.js` · `legal-versions.js` · `offline-retry.js` · `today-redirect.js` | 8–15 | дрібні помічники | відповідні сторінки |

### Що конкретно робить `app.js`

Шапка й підвал (`buildNav`, `buildFooter`) · бургер до 1060px ·
нижня панель розділів (`buildTabBar` + ліниве довантаження скла) ·
жетон рівня й стан синхронізації в шапці · `canonical` і JSON-LD ·
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

`SCHEMA_VERSION = 11` — версія ФОРМИ даних. Росте лише при зміні
структури, не при додаванні поля. `migrate()` веде профіль по одному
кроку; версія 5 зайнята назавжди (прибране «Обране»).

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
| `elo_leaderboard` · `elo_set_name` · `elo_history` · `elo_recent` | `elo-api.js`, `season.js` | дошка, імʼя, історія |
| `admin_requests` · `admin_decide` | `admin.js` | заявки й рішення |
| `admin_elo_list` · `admin_elo_anomalies` · `admin_elo_set` | `admin-elo.js` | адмінський ELO |

### `db/`

Джерело правди про бойову схему — **`db/live-schema.sql`** (знімок,
генерується `dump-live-schema.sql`, руками не редагується). Решта файлів
— історія змін, тести й точкові виправлення; **виконувати їх по
продакшену не можна**. Порядок і правила — `db/README.md`.

Rollback-файл поки один: `db/season-week-bounds-rollback.sql`. Так має
бути в кожної ризикованої міграції.

### `sw.js`

`CACHE = 'forge-v1'`, і імʼя навмисно не змінюється. HTML — мережа перша
(тайм-аут 4 с); CSS і JS — мережа перша (2 с); картинки —
stale-while-revalidate. Свіжий HTML звіряється з кешованим, і при
розбіжності кеш зноситься ЦІЛКОМ, щоб скрипти приїхали з тієї самої
публікації. Чуже походження, не-GET і `?nosw=1` не перехоплюються.

---

## 6. Перевірки

`tests/` — 34 файли юніт-тестів (708 тестів) на ядра й `store.js`.
`tools/verify*.mjs` — 50 файлів: 46 браузерних перевірок на Playwright
(46 файлів) і 4 SQL-набори.

Набори задає `tools/ci-browser.sh`:

- **core** (кожен пуш, ~6 хв): `verifyhistory`, `verifyworkout`,
  `verifydata`, `verifyroundtrip`, `verifyloop`, `verify7`,
  `verifyaccountmix`, `verifylink`, `verifysw`, `verifyhelp`.
- **full** (раз на добу): core + 31, зокрема `verifya11y`,
  `verifythemes`, `verifyresponsive`, `verifyperf`, `verifychaos`,
  `verifyhardening`, `verifytabbar`, `verifydonut`, `verifydaycal`,
  `verifylevelicon`.
- **Тільки вручну, з дозволу власника — ходять у бойовий бекенд:**
  `verifyregister`, `verifyregfail`, `verifyregresume`, `verifyrecover`,
  `verifyproduction`, `verifyauthz`.

`.github/workflows/ci.yml`: `test` (юніт + гігієна + SQL-набори +
`simelo`) і `browser` (core) на кожен пуш; `browser-full` — за
розкладом; `pulse` — щоденний `curl` у Supabase, щоб free-план не
заснув.

Інші скрипти в `tools/`: `adult.mjs` (садить пройдений профіль),
`pw.mjs` (шляхи до Chromium), `ci-offline.sh` (вішає Supabase і Sentry
на 127.0.0.1), `ci-hygiene.mjs`, `build-meta.js`, `og.mjs`, `shot.mjs`,
`simelo.mjs` (баланс ELO, має лишатись 6/6), `restore-backup.mjs`,
`auto-publish.sh` і `*.command` для керування публікацією.
