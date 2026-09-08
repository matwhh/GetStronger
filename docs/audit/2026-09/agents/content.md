# Аудит 2026-09 — домен «Контент і консистентність текстів» (TXT)

Phase A, лише читання. Репозиторій `/root/work/forgesite`, гілка `master`.
Розділ A12 PROMPT.md. Пріоритет нижчий, знахідки LOW/INFO, згруповані за типом.

## Обсяг і метод

- Джерела тексту: 22 файли `*.html` (видимий текст + атрибути `placeholder`, `title`,
  `aria-label`, `alt`, `content`), 52 файли `js/*.js` (рядкові літерали з кирилицею —
  3755 рядків після вилучення коментарів), `manifest.webmanifest`, `sitemap.xml`,
  `robots.txt`, `sw.js`.
- Інструменти (усе в `/tmp/audit-content/`): власні скрипти `text.mjs` (витяг тексту
  з HTML), `strings.mjs` (літерали з JS), `links.mjs` (внутрішні href/якорі, перелік
  зовнішніх), `spell.mjs` — перевірка орфографії проти словника
  `dict_uk` (hunspell uk_UA 6.6.1, ~3,4 млн словоформ після розгортання афіксів
  власним експандером; готового hunspell/nspell у контейнері нема — npm і apt
  заборонені проксі).
- Перевірка тверджень UI/legal проти коду: `grep` по `js/*.js`, `db/*.sql`,
  `db/elo-config.json`.
- Жодних звернень до бойового Supabase/Vercel; зовнішні посилання — лише перелік.

## Що перевірено

| Перевірка | Обсяг | Результат |
|---|---|---|
| Внутрішні href/src у HTML і JS | 22 HTML + 52 JS; 27 унікальних цілей `*.html` | усі файли існують; 0 мертвих файлових посилань |
| Якорі `#…` (внутрішні та `page.html#id`) | усі href з `#` | 1 «якір» без `id` — `journal.html#history` — обробляється JS (`js/journal.js:1758`), не мертвий |
| Зовнішні посилання | 19 унікальних URL | лише перелік (fonts.googleapis/gstatic, 15× pubmed.ncbi.nlm.nih.gov, youtube.com/@JeffNippard); запитів не робилось |
| `<title>` / `og:title` / `h1` / пункт меню | 22 сторінки | 4 розбіжності + measure.html без og (TXT-006) |
| Навігація | `NAV_GROUPS`, `NAV_EDGE`, `NAV_ITEMS` у `js/app.js:266-328` | шапка й футер рендеряться з одного модуля на 19 сторінках; `legal.html`, `welcome.html`, `today.html` без `#site-nav` навмисно |
| Орфографія | ~1000 рядків HTML-тексту + 3755 JS-літералів | 87 невідомих словнику слів переглянуто вручну; 4 реальні помилки/русизми + 3 нетипові апострофи (TXT-001) |
| Термінологія | лічильники: «сет» 0, «воркаут» 0, «повторення» 57 / «повтор(и)» 5+3 скорочення, «ккал» 46 / «kcal» 0, «кг» 132 / «kg» 0, «см» 14 / «cm» 0 | 7 розривів, найпомітніший — повтори/повторення (TXT-003) |
| Формат чисел | десяткова кома через `App.fmtNum` (`js/app.js:59-160`); пошук `[0-9]\.[0-9]` у видимому тексті | 0 випадків десяткової крапки в UI-тексті; діапазони скрізь через «–», множення через «×» |
| Формат дат | `dateLabel` («11 серпня»), `toLocaleString('uk-UA')` (account.js ×3, programs.js ×2), `dd.mm.yyyy hh:mm` (admin.js) | три різні формати (TXT-007, INFO) |
| Форма звертання (ви/ти) | увесь текст | базова форма «ви»; 14 місць із «ти»/однина (TXT-002) |
| Капіталізація кнопок | 73 унікальні підписи `<button>`, 12 `a.btn` | послідовно речення з великої; відхилень нема |
| legal.html проти коду | 12 фактичних тверджень | 2 неточності + 1 INFO (TXT-009) |
| Згадки прибраних/неіснуючих функцій | пошук назв сторінок/кнопок у текстах | 1 сторінка з прибраним контентом (TXT-004) + 8 застарілих інструкцій (TXT-005) |

## Що НЕ перевірено і чому

- Зовнішні URL не відкривались (умова завдання: лише перелік).
- Граматика/стиль поза словниковою перевіркою — вибірково, вручну; повного
  лінгвістичного аналізу 4700 рядків не робив.
- Відправник листів підтвердження (`js/welcome.js:1111` обіцяє
  `noreply@mail.app.supabase.io`) — залежить від SMTP-конфігурації Supabase поза
  репозиторієм; MCP-перевірка конфігурації Auth не входить у мій домен (A11).
- Текст README.md/RELEASE.md/docs як «журнал проєкту» (§2.1) не аудитував на
  консистентність — це не користувацький контент.

## Знахідки

### TXT-001 · Орфографія, русизми, типографіка

```text
ID:                 TXT-001
Severity:           LOW
Confidence:         CONFIRMED
Category:           content/spelling
Location:           periodization.html:191; js/exercises.js:178-179; js/programs-data.js:277;
                    js/foods.js:140; js/programs-data.js:114; cardio.html:289;
                    nutrition.html:249; research.html:410
Description:        Після словникової перевірки (dict_uk 6.6.1) з 87 невідомих слів
                    реальні помилки:
                    - «непериодизованого» (periodization.html:191) — має бути
                      «неперіодизованого» (сторінка називається «Періодизація»);
                    - «Ягодичний міст зі штангою», «Ягодичний міст у тренажері»
                      (exercises.js:178-179, programs-data.js:277) — русизм; у тому
                      самому файлі група мʼязів названа «Сідничні» (exercises.js:221),
                      а на programs.html:151 — «сідницям»;
                    - «творог» у синонімах пошуку (foods.js:140) — русизм
                      (українською «сир кисломолочний»; як пошуковий синонім
                      прийнятно, але це видимий текст підказки);
                    - «Запригування на степ» (programs-data.js:114) — русизм,
                      українською «застрибування»;
                    - апостроф: 180 випадків ʼ (U+02BC) і 3 винятки — ASCII «'»
                      у «зап'ясті» (cardio.html:289), «пов'язаний» (research.html:410)
                      і «’» (U+2019) у «вп’ятеро» (nutrition.html:249).
Why it matters:     Довіра до довідникового контенту; русизми в назвах вправ
                    видно в плані щодня.
Reproduction:       node /tmp/audit-content/spell.mjs → /tmp/audit-content/unknown.txt;
                    grep -n "Ягодичн\|Сідничн" js/exercises.js js/programs-data.js;
                    grep -n "непериодиз" periodization.html
Observed:           див. Description
Expected:           «неперіодизованого», «Сідничний міст …», «Застрибування …»,
                    єдиний апостроф ʼ.
Root cause:         Ручне наповнення без словникової перевірки.
Impact:             Косметичний.
Recommended fix:    Правки тексту; для exercises.js — назва вправи є ключем у книзі
                    ваг (weights/weightLog), тому перейменування потребує міграції
                    ключа (див. tests/rename-exercise.test.js) — не «просто замінити».
Regression test:    Скрипт орфографії у tools/ci-hygiene.mjs або тест на список
                    заборонених слів («ягодичн», «творог», «запригув»).
```

### TXT-002 · Змішане звертання «ви» / «ти»

```text
ID:                 TXT-002
Severity:           LOW
Confidence:         CONFIRMED
Category:           content/consistency
Location:           js/account.js:173-174; js/season.js:201-202; js/periodization.js:198-199;
                    js/bmi-core.js:56-61; js/meals.js:1466-1467; js/programs.js:1665, 2172;
                    periodization.html:213; programs.html:125; cardio.html:119;
                    js/foods.js:109, 310, 350; index.html:7; nutrition.html:31
Description:        Базова форма на сайті — «ви» (сотні вживань: «Заповніть», «Оберіть»,
                    «ваш план»). Винятки, частина — в одному реченні з «ви»:
                    - account.js:173-174: «заповніть ключі Supabase … і виконай db/schema.sql»;
                    - season.js:201-202: «Закрийте тренування, день харчування чи відміть сон»;
                    - periodization.js:198-199: «Або зменшіть крок, або скороти тривалість»;
                    - bmi-core.js:56-61: «Ваш BMI … проконсультуйся з кваліфікованим
                      спеціалістом» (у паралельному тексті для низького BMI, :46-52,
                      «радимо проконсультуватися»);
                    - meals.js:1466 «Дай рецепту назву» поруч із :1467 «Додайте хоча б
                      один інгредієнт»;
                    - programs.js:1665 «заміни підходи в наявних»; :2172 «Твої правки
                      буде втрачено»;
                    - periodization.html:213 «повтори його й рухайся далі»;
                    - programs.html:125 «якщо зробив 9 — вага замала» (чоловічий рід,
                      однина); cardio.html:119 «Максимум (якщо міряв)»;
                    - foods.js:109/310/350 «звір з етикеткою / із пляшкою / із обгорткою»;
                    - index.html:7 «Твій день у Forge», nutrition.html:31 «під твої
                      зріст» (мета-описи).
Why it matters:     Тон інтерфейсу стрибає посеред фрази; для жінок-користувачок
                    «зробив/міряв» звучить як не про них (реєстрація має обидві статі,
                    welcome.js:1114 навмисно пише «підтвердив(ла)»).
Reproduction:       grep -n "виконай\|відміть\|скороти\|проконсультуйся\|Дай рецепту\|заміни підходи\|Твої правки\|рухайся\|зробив 9\|міряв\|звір " js/*.js *.html
Observed:           14 місць із «ти»/однина на тлі «ви».
Expected:           Одна форма звертання на весь застосунок.
Root cause:         Тексти писались у різний час без стайлгайду.
Impact:             Косметичний.
Recommended fix:    Привести до «ви»; для past-форм — безособове («якщо вийшло 9»,
                    «якщо є виміряний»).
Regression test:    Перевірка в ci-hygiene на список «ти»-форм у UI-рядках.
```

### TXT-003 · Термінологічні розриви (одне поняття — кілька слів)

```text
ID:                 TXT-003
Severity:           LOW
Confidence:         CONFIRMED
Category:           content/terminology
Location:           див. перелік
Description:        Що витримано: підхід (0 «сет»), тренування/сесія (сесія — один
                    екземпляр тренування, послідовно), кг/ккал/см (0 латинських),
                    десяткова кома (0 крапок у видимому тексті), «–» у діапазонах, «×».
                    Розриви:
                    1) повторення vs повтори. «повторення» — 57 вживань (зокрема
                       programs.js:961 «Підходи × повторення», journal.js:1493
                       «повторень»); «повтори/повт.» — workout.js:410-411, 465
                       («Повтори: 1–200»), journal.js:916 («Подивіться «Повтори»»),
                       :952, :1379, onerm.js:161, periodization.js:355,
                       exercise-core.js:34, programs.js:1153-1154 («Повт.»),
                       workout.html:31 (og:description «Підходи, повтори»).
                    2) recovery vs відновлення. Трекер називається «Recovery»
                       (tracker-core.js:109), ELO-подія «Recovery» (elo-hooks.js:129 —
                       усі інші причини українською: «Тренування», «Сон», «Кроки»),
                       rating.html:83, trackers-settings.html:7,103 — «recovery»;
                       та сама ELO-категорія на season.js:271 — «Відновлення».
                    3) програма vs план. Сторінка/меню/title — «Плани тренувань»,
                       кнопки — «Обрати програму» (today.js:153, workout.js:532,
                       plan.html:111, periodization.html:109, welcome.js:446);
                       на одній сторінці workout.js:529 «План ще не обрано» і
                       :620 «Програму ще не обрано».
                    4) Назви цілей харчування. bulk: «Набір маси» (nutrition.html:139,
                       account.js:16) vs «Набір мʼязової маси» (nutrition-core.js:32 —
                       саме цей label показує select в акаунті через goalOptions(),
                       account.js:381-384); cut: «Скидання» (nutrition.html:143) vs
                       «Скидання ваги» (nutrition-core.js:46, account.js:17).
                    5) Вправа: «Жим стоячи» (calculator.html:113, onerm.js:32) vs
                       «Армійський жим штанги стоячи» (exercises.js:105,
                       periodization-core.js:210) — це одна й та сама вправа, рекорд
                       ohp з калькулятора підставляється саме в неї.
                    6) BMI vs ІМТ: nutrition.html:310 «ІМТ», bmi-core.js/legal.html —
                       «BMI».
                    7) Скорочення тижня: journal.js:219,225,234,301,320 «тиж» vs
                       :357 «/ тижд.»; «30д» без пробілу (journal.js:1091,
                       trackers-settings.js:78,90) при «за 30 днів» поруч
                       (journal.js:254,555).
                    8) «Elo» як одиниця в App.fmtNum.elo (app.js:132) при «ELO» усюди
                       (64 вживання) — функція не використовується, INFO.
Why it matters:     Користувач бачить «Повтори» в одному стовпці й «повторення» в
                    сусідній підказці; «Recovery»/«Відновлення» — та сама категорія
                    ELO у двох назвах на одній сторінці рейтингу.
Reproduction:       grep -n -i "повтор" js/workout.js js/journal.js js/onerm.js;
                    grep -n "Recovery\|Відновлення" js/tracker-core.js js/elo-hooks.js js/season.js;
                    grep -n "Обрати програму\|ще не обрано" js/*.js *.html;
                    grep -n "label:" js/nutrition-core.js | head -8; grep -n "Набір маси\|Скидання" nutrition.html js/account.js
Observed:           див. вище
Expected:           Один термін на поняття; словник термінів у docs/.
Root cause:         Відсутність глосарія.
Impact:             Косметичний; п.4 — користувач бачить у формі акаунта інший підпис
                    цілі, ніж у формі харчування, для того самого ключа.
Recommended fix:    Глосарій + заміна; для п.4 — брати підписи з NutritionCalc.GOALS
                    в nutrition.html так само, як це вже робить account.js.
Regression test:    Тест, що nutrition.html radio-підписи == GOALS[k].label.
```

### TXT-004 · Сторінка «Добавки» описує прибрані позиції

```text
ID:                 TXT-004
Severity:           LOW
Confidence:         CONFIRMED
Category:           content/stale
Location:           supplements.html:6-7, 91, 98-99, 126-127; js/supplements-view.js:177;
                    js/supplements.js:31-32, 40, 106
Description:        Комітом a4ce7d2 (2026-09-01) з js/supplements.js прибрано
                    «Ашваганда», «Мелатонін», «Магній гліцинат»; лишилось 2 позиції
                    (креатин, сироватковий протеїн). Але:
                    - <title> і description (supplements.html:6-7): «Креатин, протеїн,
                      ашваганда, мелатонін, магній…»;
                    - :91 «Пʼять позицій, за якими стоять дослідження»;
                    - :99 «частина з них має задокументовані ризики — найпомітніший
                      тут в ашваганди» — ашваганди на сторінці немає;
                    - :126-127 приклад для рівня «Помірні» — «магній помітно працює
                      переважно в тих, кому його бракує» — магнію немає, і рівень
                      «Помірні докази» (supplements.js:32) тепер порожній;
                    - supplements-view.js:177 виводить SUPPLEMENTS.length + ' позицій'
                      → «2 позицій» (правильно «2 позиції»).
Why it matters:     Заголовок вкладки й прев'ю посилання обіцяють пʼять добавок, а
                    сторінка показує дві; текст посилається на неіснуючий контент.
Reproduction:       grep -c "name: '" js/supplements.js  → 2
                    grep -n "Пʼять\|ашваганд\|магній" supplements.html
                    git show a4ce7d2 -- js/supplements.js | grep "^-.*name:"
Observed:           5 обіцяних позицій проти 2 реальних; «2 позицій».
Expected:           Текст сторінки відповідає даним; чип із правильною формою множини.
Root cause:         Дані змінили, статичний HTML — ні.
Impact:             Косметичний, але помітний одразу.
Recommended fix:    Переписати вступ/мета під 2 позиції або рахувати число зі
                    SUPPLEMENTS.length; для чипа — plural() (у коді вже є хелпери
                    відмінювання, напр. journal.js:303, 688).
Regression test:    Тест: у supplements.html немає назв добавок, яких нема в
                    SUPPLEMENTS; chip = plural(n).
```

### TXT-005 · Інструкції посилаються на неіснуючі елементи або застарілу поведінку

```text
ID:                 TXT-005
Severity:           LOW
Confidence:         CONFIRMED
Category:           content/stale
Location:           periodization.html:129-130; account.html:7, 93, 115; programs.html:174;
                    js/journal.js:1261-1262; journal.html:156, 162-163; js/account.js:11-12, 544,
                    1681-1684; meals.html:92; js/meals.js:912-913; js/account.js:565
Description:
  a) periodization.html:129-130: 1ПМ для присідань/жиму/армійського жиму береться
     «з поля рекордів в «Акаунті», якщо воно заповнене». В акаунті поля рекордів
     немає (account.js:516-555 — sex/age/height/weight/bodyfat/activity/goal/meals/
     daysPerWeek/trainingAge/hrRest/hrMax); рекорди зберігаються лише на
     calculator.html («Зберегти як рекорд», «Мої рекорди», onerm.js:204). При цьому
     account.html:7 і :115 перелічують «рекорди 1ПМ» серед даних, що «редагуються
     просто тут» (:93).
  b) programs.html:174: «Кнопка «Скинути» повертає оригінальний план» — кнопка
     називається «Початковий план» (programs.js:1433); слова «Скинути» в UI
     programs.js немає (лише в коментарі :15).
  c) journal.js:1261-1262: «оберіть програму на сторінці «Програми»» — сторінки з
     такою назвою немає; в меню, title і h1 — «Плани тренувань».
  d) journal.html:156: «Останні 12 тижнів календарем» — код показує рівно 7
     календарних місяців (journal.js:466-470, HM_MONTHS = 7; aria-label «Календар
     тренувань за 7 місяців»; коміт a4ce7d2 «7 місяців у прогресі»).
  e) account.js:1681-1684 (діалог «Стерти локальні дані» у хмарному режимі при
     вході): «Щоб видалити їх назовсім … видаліть акаунт у Supabase». Користувач
     не має доступу до Supabase; за тієї самої умови (Store.isCloud && Store.user(),
     account.js:587) поруч рендериться кнопка «Видалити акаунт» (:588), яку і описує
     legal.html:136.
  f) account.js:11-12 PROGRAM_NAMES містить лише fullbody/upperlower/ppl; у
     programs-data.js є ще ulppl, women4, women3. Для них account.js:544 виводить
     сирий id: «Зараз обрано: women3, 3 дн.».
  g) meals.html:92, meals.js:912-913, account.js:565: «на сторінці «Харчування»»
     — сторінка називається «План харчування» (nav, title, h1); «Харчування» — назва
     групи меню, що веде на «Раціон» (meals.html).
  h) journal.html:162-163: день позначається «коли на «Моєму плані» додзвонив
     таймер» — тепер таймер і завершення сесії є й на «Тренуванні»
     (workout.js:836, journal.js:434), текст описує лише старий шлях.
Why it matters:     Користувач шукає поле рекордів в акаунті, кнопку «Скинути» і
                    сторінку «Програми» — їх немає; у діалозі йому радять дію, яку він
                    не може виконати.
Reproduction:       a) grep -n "records\|рекорд" js/account.js → лише coerce (:1105);
                    b) grep -n "Скинути" js/programs.js; c) grep -n "«Програми»" js/journal.js;
                    d) grep -n "HM_MONTHS\|12 тижнів" js/journal.js journal.html;
                    e) sed -n 1679,1690p js/account.js; f) grep -n "^    id: '" js/programs-data.js
                    проти PROGRAM_NAMES; g) grep -n "сторінці .Харчування" meals.html js/*.js
Observed:           див. пункти
Expected:           Тексти відповідають поточному UI.
Root cause:         Функції переїжджали (рекорди → калькулятор, «Сьогодні» → workout,
                    7 місяців), тексти лишились.
Impact:             Косметичний; e) вводить в оману щодо видалення даних.
Recommended fix:    a) або додати блок рекордів в акаунт, або переписати periodization.html
                    і account.html на «Калькулятор 1ПМ»; b,c,g) виправити назви;
                    d) «7 місяців»; e) «…а потім натисніть «Видалити акаунт» нижче»;
                    f) брати назву з window.PROGRAMS (programs-data.js уже підключений на
                    account.html:163) замість локальної мапи.
Regression test:    Для f) — тест: кожен id у PROGRAMS має людську назву в акаунті.
```

### TXT-006 · Заголовки сторінок і мета-теги: розбіжності

```text
ID:                 TXT-006
Severity:           INFO
Confidence:         CONFIRMED
Category:           content/titles
Location:           index.html:6; nutrition.html:30; welcome.html:30-31; calculator.html:6,30,90;
                    measure.html (head); sitemap.xml
Description:        - index.html <title> «FORGE — сьогодні» — єдина сторінка з порядком
                      «FORGE — X»; решта 20 — «X — FORGE».
                    - nutrition.html og:title «Харчування» при h1/title/nav «План
                      харчування» («Харчування» — назва групи меню, яка веде на Раціон).
                    - welcome.html og:title = слоган «Тренування · Харчування · Прогрес»,
                      а og:description — опис; на всіх інших сторінках навпаки.
                    - Калькулятор: nav/og «Калькулятор 1ПМ», h1 «Разовий максимум»,
                      title «Калькулятор разового максимуму (1ПМ)» — три назви.
                    - measure.html не має og:* (10 тегів на інших сторінках), twitter:card
                      і apple-mobile-web-app-* мета; агент agegate.js підключено після
                      css (:23-24), тоді як на інших сторінках — перед і з коментарем
                      «найпершим».
                    - sitemap.xml: немає measure.html (є в меню) при тому, що сайт
                      цілком noindex (vercel.json X-Robots-Tag) — сайтмап тут
                      декоративний; lastmod усіх URL = 2026-09-01.
                    - Навігація: шапка й футер рендеряться одним модулем на всіх 19
                      сторінках із #site-nav — однакові; коментар app.js:305-309
                      суперечить сам собі (два абзаци про футер), код — плоский список
                      з іншим порядком, ніж у групах шапки (Бокс/Кардіо після
                      Рейтингу, Трекери між Харчуванням і Прогресом).
Reproduction:       grep -n "<title>\|og:title" *.html; for f in *.html; do grep -c 'property="og:' $f; done
Recommended fix:    Уніфікувати title index.html; og:title nutrition → «План харчування»;
                    додати og-блок у measure.html.
Regression test:    ci-hygiene: кожна сторінка з #site-nav має og:title == h1 або nav-label.
```

### TXT-007 · Формат дат і чисел

```text
ID:                 TXT-007
Severity:           INFO
Confidence:         CONFIRMED
Category:           content/format
Location:           js/app.js:1417-1435; js/account.js:592, 729, 1653; js/programs.js:906, 980;
                    js/admin.js:40-42; js/admin-elo.js:40
Description:        app.js:1417-1428 декларує правило «Не toLocaleDateString» і дає
                    dateLabel → «11 серпня». Водночас account.js (×3) і programs.js
                    (×2) використовують toLocaleString/toLocaleDateString('uk-UA') →
                    «11.08.2026, 14:05:07» / «11.08.2026», admin.js — власний
                    «dd.mm.yyyy hh:mm». Три формати дати в одному інтерфейсі
                    («Збережено 06.09.2026, 22:10:31» в акаунті проти «6 вересня» у
                    журналі). Числа: єдиний виняток «≥ 90 %» з пробілом
                    (admin-elo.js:40) при 90 вживаннях «N%» без пробілу.
Reproduction:       grep -n "toLocale" js/*.js
Recommended fix:    Пропустити ці місця через App.dateLabel/новий App.dateTimeLabel.
```

### TXT-008 · Суперечливі числа в інструкціях і межах

```text
ID:                 TXT-008
Severity:           LOW
Confidence:         CONFIRMED
Category:           content/contradiction
Location:           journal.html:149-150 vs nutrition.html:313-314, js/nutrition.js:356;
                    js/onerm.js:73-74, 123-125, 147-149 vs calculator.html:161;
                    js/journal.js:77, js/measure.js:192, js/onboarding-core.js:45,
                    js/account.js:623 vs js/account.js:516-518, nutrition.html:112-120
Description:        1) Корекція калорій: journal.html «Калькулятор харчування каже: …
                       коригуйте калорії на 100–150»; сам калькулятор каже «100–200 ккал»
                       (nutrition.html:314, nutrition.js:356).
                    2) Діапазон для точної оцінки 1ПМ: onerm.js:125 «підхід на 3–6
                       повторень», onerm.js:149 «на 3–8 разів», calculator.html:161
                       «Найточніший діапазон — 3–6». Поріг поганої оцінки: «Понад 10»
                       (onerm.js:123, calculator.html:156) і «Понад 12» (onerm.js:73,147).
                    3) Межі ваги тіла в підказках/валідації: 30–300 кг (journal.js:77 і
                       toast :1674, measure.js:192, onboarding-core.js:45, coerce в
                       account.js:623) проти input min=35 max=250 (account.js:518,
                       nutrition.html:120); зріст 120–250 (onboarding, coerce) проти
                       max=230 (account.js:517, nutrition.html:116).
                    4) Вік: сайт «від 17 років» (legal.html:160, welcome.js:161), а поле
                       «Вік, років» приймає min=14 (account.js:516, nutrition.html:112),
                       coerce — [10, 100] (account.js:623).
Why it matters:     Користувач отримує дві різні поради з одного джерела («калькулятор
                    каже 100–150» — ні, він каже 100–200); ті самі дані мають різні
                    межі на різних сторінках.
Reproduction:       grep -n "100–150\|100–200" *.html js/*.js;
                    grep -n "3–6\|3–8\|Понад 1[02]" js/onerm.js calculator.html;
                    grep -n "min=\"35\"\|min: 35\|W_MIN\|LIMITS" js/*.js *.html
Observed:           див. пункти
Expected:           Одне число на одну пораду; одні межі на одну величину.
Root cause:         Дублювання констант у тексті.
Impact:             Косметичний; п.3-4 — інша поведінка валідації залежно від сторінки
                    (домен local/data має оцінити окремо).
Recommended fix:    Винести межі в один модуль (є OnboardingCore.LIMITS) і
                    посилатись на нього; узгодити тексти.
Regression test:    Тест: LIMITS однакові в onboarding-core, account coerce, journal, measure.
```

### TXT-009 · legal.html проти фактичної поведінки

```text
ID:                 TXT-009
Severity:           LOW
Confidence:         CONFIRMED
Category:           content/legal
Location:           legal.html:99-100, 136, 190; js/store.js:703-717; js/legal-versions.js
Description:        Перевірено 12 тверджень; збігаються: хеш пароля в Supabase Auth,
                    перелік даних скринінгу (hrRest/hrMax — welcome.js:440-441), нік і
                    рейтинг у таблиці лідерів, журнал згод (welcome.js:583-588), Sentry
                    без PII (errors.js — за описом; підтвердження — домен xss/ops),
                    кнопка «Видалити акаунт» (account.js:588), «Експортувати JSON»
                    (account.js:576), кнопка очищення (account.js:586). Розбіжності:
                    1) :99-100 «Сесія входу зберігається у сховищі вашого браузера
                       (localStorage)» — насправді sessionStorage, якщо не увімкнено
                       «Запамʼятати мене» (store.js:703-717), тобто за замовчуванням
                       живе лише до закриття вкладки. Для політики це в бік більшої
                       приватності, але твердження неточне.
                    2) :190 «Ви можете будь-коли видалити акаунт в налаштуваннях» —
                       сторінки «Налаштування» немає (є «Налаштування трекерів»);
                       кнопка — на сторінці «Акаунт», як і написано в :136.
                    3) На сторінці 4 документи (privacy, terms, medical, fitness),
                       :57-59 «Тут зібрано все, з чим ви погоджуєтесь», а
                       LEGAL_VERSIONS і журнал згод (welcome.js:583-588) охоплюють 3 —
                       «Застереження щодо тренувань і харчування» (#fitness) без версії
                       й без згоди. INFO.
                    4) Дати: privacy/terms «3 вересня 2026», medical/fitness «28 серпня
                       2026» — узгоджено з LEGAL_VERSIONS.updated (одне поле на всі).
Reproduction:       sed -n 700,720p js/store.js; grep -n "налаштуваннях" legal.html;
                    cat js/legal-versions.js
Recommended fix:    1) «…у сховищі браузера (sessionStorage, або localStorage при
                    «Запамʼятати мене»)»; 2) «в акаунті»; 3) або додати fitness до
                    згод/версій, або прибрати слово «все».
Regression test:    Тест: усі якорі doc-секцій legal.html мають запис у LEGAL_VERSIONS.
```

## Спостереження (INFO)

- **TXT-I1.** `js/welcome.js:1111` обіцяє, що лист приходить від
  `noreply@mail.app.supabase.io`. Це відправник за замовчуванням Supabase; якщо
  налаштовано власний SMTP (у PROMPT згадано Resend), текст хибний. Перевірити в
  домені ops/A11 за фактом (`auth_logs`), не за кодом.
- **TXT-I2.** `account.html:133` «мають власні акаунти і своїх даних одне одного не
  бачать» — синтаксично зайве «своїх» («даних одне одного не бачать»).
- **TXT-I3.** `research.html:7` «Джерела всіх рекомендацій сайту» — 14 PMID на
  сторінці (лічильник «Чотирнадцять» :92, :522 збігається), але два джерела
  періодизації (PMID 28497285, 35044672) є лише на periodization.html; добавки —
  навмисно в картках (supplements.html:142-144). 16 унікальних PubMed-URL на сайті.
- **TXT-I4.** Мертвих внутрішніх посилань нема. `journal.html#history` (меню
  app.js:290, season.js:136) не є id — це стан, який читає `journal.js:1756-1760`;
  без JS сторінка й так не працює (є noscript-заглушка), тому не дефект.
- **TXT-I5.** `today.html` — навмисний редирект на index.html (коментар у файлі),
  `<meta refresh>` + `location.replace`; текст «Сьогодні» тепер на головній» —
  узгоджено.
- **TXT-I6.** Зовнішні посилання (без запитів): fonts.googleapis.com,
  fonts.gstatic.com, 15 URL pubmed.ncbi.nlm.nih.gov, youtube.com/@JeffNippard
  (workout.js:606, programs.js:1467). Усі з `rel="noopener"` там, де `target=_blank`
  (перевірено grep).
- **TXT-I7.** Англійські терміни в UI без перекладу, вжиті послідовно (не дефект,
  фіксую): Grace Week / Grace Weeks, ELITE, Level N, tolerance-зони, RIR, PR, BMR/TDEE,
  Full Body / UL / PPL, Recovery (див. TXT-003 п.2 — там саме непослідовно).
- **TXT-I8.** У `js/account.js:15-18` GOAL_NAMES містить ключі `muscle/strength/
  fatloss`, яких немає в NutritionCalc.GOALS (це `goals` програм у programs-data.js) —
  мапа не використовується ніде, крім оголошення (мертвий код, домен maintainability).
- **TXT-I9.** Множина: хелпери відмінювання є (journal.js:303, 688, 1059; measure.js:300),
  але не всюди: «2 позицій» (TXT-004), «N учасн.» (season.js:225 — скорочення, ок).
- **TXT-I10.** Відомі проблеми з §2.3 PROMPT до цього домену не належать; кеш прев'ю
  Telegram для index.html (§2.3) стосується og-тегів — og:title/og:image на index.html
  присутні й коректні, нового нічого.
