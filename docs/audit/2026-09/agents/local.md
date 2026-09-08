# Аудит Phase A — домен «Локальний режим і цілісність даних у localStorage» (LOC)

Агент: `local`. Режим: ТІЛЬКИ ЧИТАННЯ репозиторію + браузерні проби по `file://`
у контейнері. Бойовий Supabase не викликався жодного разу (усі проби — у
локальному режимі `tools/adult.mjs localMode()`, зовнішня мережа обрізана
`ctx.route(...abort())`).

> Файл пишеться інкрементально під час аудиту.

## Обсяг і метод

Домен охоплює розділ A5 PROMPT.md:
- схема профілю в `localStorage`, версія та ланцюжок міграцій;
- поведінка кожної сторінки при пошкодженому сховищі;
- Export → clear → import (тотожність, імпорт пошкодженого/старого/чужого файла);
- часткові й подвійні записи, дві сторінки в одному контексті;
- відсутність/недоступність `localStorage` (приватний режим, виняток на доступі);
- вичерпана квота.

Джерела доказу: читання `js/store.js`, `js/account.js`, `js/agegate.js`,
`js/workout-core.js`, `js/today.js`, `js/meals.js`, `js/welcome.js`,
`js/elo-api.js`, `js/elo-hooks.js`, `js/app.js`; власні Playwright-скрипти в
`/tmp/audit-local/`; запуск наявних `tools/verifyhardening.mjs` і
`tools/verifyroundtrip.mjs`.

## Мапа сховища (станом на аудит)

Ключі, які пише сайт (усі — `localStorage`, крім `ib.session`, що може
лежати в `sessionStorage`):

| Ключ | Власник (файл) | Що зберігає | Формат |
|---|---|---|---|
| `ib.profile` | `js/store.js` | увесь профіль користувача | один JSON-обʼєкт |
| `ib.profile.backup` | `js/account.js` | копія профілю ПЕРЕД імпортом | JSON + `savedAt` |
| `ib.profile.backup.login` | `js/store.js` | копія перед розвʼязанням конфлікту входу / чужі дані | JSON + `savedAt`, `owner` |
| `ib.profile.owner` | `js/store.js` | `user_id` власника локальних даних | JSON-рядок |
| `ib.profile.dirty` | `js/store.js` | позначка «є незіслані зміни» | рядок з `Date.now()` (НЕ JSON) |
| `ib.session` | `js/store.js` | сесія Supabase (+ `refresh_token`) | JSON |
| `ib.remember` | `js/store.js` | `'0'`/`'1'` — тримати сесію між сеансами | сирий рядок |
| `ib.pending` | `js/store.js` | черга незісланих патчів (останні 200) | JSON-масив |
| `ib.account` | `js/store.js` | кеш статусу акаунта | JSON |
| `ib.cloud` | `js/store.js` | `'1'`/`'0'` — підказка синхронному сторожу | сирий рядок |
| `ib.gateloop` | `js/agegate.js` | лічильник циклів редиректу сторожа | сирий рядок |
| `ib.regdraft` | `js/welcome.js` | чернетка реєстрації/онбордингу | JSON |
| `ib.eloState`, `ib.eloPending`, `ib.eloSent`, `ib.eloWeeks`, `ib.eloClosed`, `ib.eloReport` | `js/elo-api.js`, `js/elo-hooks.js`, `js/season.js` | стан і черга ELO | JSON |
| `forge.theme`, `forge.scheme` | `js/app.js` | оформлення | сирий рядок |
| `forge.today` | `js/workout-core.js` | денний стан тренування (галочки, обраний день) | JSON |
| `ib.meals.fold` | `js/meals.js` | згорнуті блоки на «Раціоні» | JSON |

Профіль — **один** JSON у `ib.profile`; денний стан тренування — **окремий**
ключ `forge.today`; згортання блоків «Раціону» — ще один. Тобто стан
користувача розкладено щонайменше на три незалежні записи, які пишуться
різними моментами (див. LOC-*).

`SCHEMA_VERSION = 10` (`js/store.js:111`). Ланцюжок `migrate()`: 0→1→2→…→10,
кроки 5 і 1 порожні (номер зайнято). Крок 1→2 засіває `weightLog`, 9→10
перейменовує вправи.

## Знахідки

### LOC-001

```text
ID:                 LOC-001
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Цілісність даних / тиха втрата
Location:           js/store.js:121-128 (lsGet), js/store.js:521-524 (readLocalProfile),
                    js/store.js:1564 (doSave → lsSet), js/programs.js:1924-1933
Description:        Якщо значення ключа `ib.profile` не розбирається як JSON
                    або розбирається не в обʼєкт (рядок, число, true, null,
                    масив), Store мовчки вважає, що профілю НЕМАЄ, віддає
                    порожній `blankProfile()` — і перше ж автоматичне
                    збереження на сторінці ПЕРЕЗАПИСУЄ сирий вміст ключа
                    дефолтним профілем на 656 байтів. Резервна копія
                    (`ib.profile.backup` / `ib.profile.backup.login`) НЕ
                    робиться, повідомлення користувачу немає.
Why it matters:     У локальному режимі `ib.profile` — ЄДИНА копія даних.
                    Після перезапису відновити нічого: сирий рядок, у якому
                    ще лежали читабельні дані людини, знищено назавжди.
Reproduction:       ГОЛОВНИЙ, «людський» шлях —
                    /tmp/audit-local/reonboard.mjs (localMode, file://):
                    1) localStorage.setItem('ib.profile',
                       '{"version":10,"weight":82,…,"weights":{"Присідання зі
                        штангою":100},"bodyLog":{"2026-01-01":82,"2026-01-0')
                       — обрізаний JSON, дані ще читабельні;
                    2) відкрити будь-яку сторінку → сторож відвертає на
                       welcome.html (профіль нечитабельний = «профілю немає»);
                    3) натиснути «Зареєструватися», ввести дату народження,
                       натиснути «Продовжити».
                    Спостережено: після кроку 2 ib.profile ще ЦІЛИЙ; одразу
                    після «Продовжити» ib.profile = 663-байтний бланк
                    {"version":10,"birthDate":"1990-06-15","sex":null,
                    "age":36,"height":null,"weight":null,…}; ключі сховища —
                    ib.cloud, ib.profile, ib.regdraft (жодної копії
                    пошкоджених даних). JS-помилок немає, повідомлення
                    користувачу немає.

                    ДРУГИЙ шлях (без онбордингу) —
                    /tmp/audit-local/who-writes.mjs:
                    1) localStorage.setItem('ib.profile',
                       '{"version":10,"weight":82,"birthDate":"1990-06-15",
                        "sex":"male","height":180,"activity":1.55,
                        "trainingAge":"inter","bodyLog":{"2026-01-0')
                       (обрізаний JSON — дані в рядку ще читабельні);
                    2) відкрити account.html → admin.html → boxing.html →
                       calculator.html (сторож 4 рази редиректить на welcome
                       і замовкає через запобіжник ib.gateloop);
                    3) відкрити plan.html.
Observed:           Перехоплений Storage.prototype.setItem дав:
                      ib.profile [656] {"version":10,"birthDate":null,
                      "sex":null,"age":null,...}
                        at lsSet (js/store.js:140:20)
                        at doSave (js/store.js:1564:21)
                    Ключі сховища після: `ib.cloud, ib.profile` — жодної
                    резервної копії. Той самий результат для payload
                    'НЕ JSON {{{', '', '"рядок"', '42', 'null', 'true',
                    '[1,2,3]' (26 класів пошкодження × 22 сторінки —
                    /tmp/audit-local/corrupt.mjs).
Expected:           Сирий нерозбірний вміст переїжджає в окремий ключ
                    (напр. `ib.profile.corrupt`) ПЕРЕД першим записом, і
                    користувач бачить повідомлення «дані пошкоджено, копію
                    збережено».
Root cause:         lsGet ковтає виняток JSON.parse і повертає fallback;
                    readLocalProfile не розрізняє «ключа немає» і «ключ є,
                    але битий». Object.assign(blankProfile(), stored)
                    приймає будь-що. Далі doSave пише cache поверх.
Impact:             Незворотна втрата профілю (журнали ваги, тренувань,
                    харчування, трекери) у локальному режимі; у хмарному —
                    втрата офлайн-резерву, який store.js сам оголошує
                    критичним (коментар js/store.js:130-137).
Recommended fix:    У readLocalProfile: якщо `localStorage.getItem` повернув
                    непорожній рядок, а JSON.parse упав АБО результат не
                    plain-object — перекласти сирий рядок у
                    `ib.profile.corrupt.<timestamp>` і підняти прапорець,
                    який сторінка показує банером. Жодного запису в
                    `ib.profile` до підтвердження.
Regression test:    Юніт на readLocalProfile (виніс би розбір у *-core) +
                    браузерна перевірка в tools/verifyhardening.mjs: після
                    прогону сторінок сирий пошкоджений рядок має лишитись
                    доступним (у самому ключі або в копії).
```

### LOC-002

```text
ID:                 LOC-002
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Цілісність даних / тиха втрата при вичерпаній квоті
Location:           js/workout-core.js:426-433 (writeDay), ключ `forge.today`
Description:        Денний стан тренування (обраний день + кількість
                    закритих підходів по кожній вправі) пишеться в окремий
                    ключ `forge.today` з `try { … } catch (_) { }`. При
                    QuotaExceededError запис не відбувається, виняток
                    ковтається, і сторінка далі показує галочки, яких у
                    сховищі немає.
Why it matters:     У ту саму мить `Store.saveProfile` чесно кидає помилку
                    («Сховище браузера переповнене…»), тобто половина стану
                    тренування скаржиться, а половина мовчить. Після F5
                    прогрес підходів зникає без жодного пояснення.
Reproduction:       /tmp/audit-local/quota2.mjs (localMode, file://):
                    1) забити localStorage до QuotaExceededError
                       (256 КБ × N, потім 1 КБ × N, потім 32 Б × N —
                       282 ключі, 5 244 599 символів);
                    2) відкрити workout.html;
                    3) у консолі сторінки:
                       WorkoutCore.writeDay({activePlan:{programId:'fullbody',
                         days:3}}, '2026-09-06', 0, [3,2]);
                       localStorage.getItem('forge.today');
Observed:           writeDay: "без винятку"; forge.today: null.
                    Той самий прогін, Store.saveProfile:
                    "виняток: Сховище браузера переповнене — локальну копію
                    не збережено" (тобто механізм сповіщення в застосунку є).
Expected:           writeDay повертає ознаку невдачі; сторінка тренування
                    показує ту саму помилку, що й профіль.
Root cause:         Коментар у коді прямо каже «показ важливіший за памʼять»
                    — але наслідок (мовчазна втрата підходів) не показується.
Impact:             Втрата денного прогресу тренування без сповіщення;
                    неконсистентність між `forge.today` і `sessionLog`.
Recommended fix:    writeDay повертає boolean; виклики на workout.html і
                    today.html показують тост при false.
Regression test:    Браузерна перевірка: забити сховище → поставити галочку
                    → очікувати видиме повідомлення про помилку.
```

### LOC-003

```text
ID:                 LOC-003
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Цілісність даних / тиха втрата
Location:           js/store.js:1458-1501 (saveProfileBeacon),
                    js/account.js:662-685 (flushSave), js/account.js:687-690
Description:        saveProfileBeacon повертає `okLocal` — результат запису в
                    localStorage. Жоден виклик цього значення не перевіряє:
                    account.js flushSave() лише повертає його далі, а
                    слухачі `visibilitychange` і `pagehide` результат
                    ігнорують. При переповненому сховищі патч не лягає
                    нікуди (у локальному режимі мережі немає взагалі), і
                    людина йде зі сторінки, вважаючи, що вагу записано.
Why it matters:     Це рівно той сценарій, заради якого beacon і писався
                    («набрав вагу й одразу пішов на іншу сторінку»), — але
                    у переповненому сховищі він мовчки не працює.
Reproduction:       /tmp/audit-local/quota2.mjs, крок 3:
                    Store.saveProfileBeacon({weight:66.6}) → повернуто false;
                    JSON.parse(localStorage.getItem('ib.profile')).weight → 82
                    (старе значення), Store.getProfile() → 66.6 (кеш).
Observed:           beacon: false, storageAfterBeacon: 82, cacheAfterBeacon: 66.6.
Expected:           false піднімається до UI: тост «не збереглося».
Root cause:         Значення, що повертається, ніде не читається.
Impact:             Тиха втрата останньої правки при переході між сторінками.
Recommended fix:    У flushSave перевіряти результат і показувати тост;
                    у локальному режимі — обовʼязково, бо черги немає.
Regression test:    Браузерна: забити сховище → змінити вагу → перейти на
                    іншу сторінку → очікувати видиме повідомлення.
```

### LOC-004

```text
ID:                 LOC-004
Severity:           LOW
Confidence:         CONFIRMED
Category:           Консистентність стану
Location:           js/store.js:1562-1564 (doSave), js/store.js:1461 (beacon)
Description:        cache присвоюється ДО перевірки успішності lsSet. Після
                    невдалого запису (квота) кеш у памʼяті містить дані,
                    яких у сховищі немає; getProfile повертає їх, і всі
                    сторінки в цій вкладці показують «збережене» значення
                    аж до перезавантаження.
Reproduction:       /tmp/audit-local/quota2.mjs: після невдалого saveProfile
                    Store.getProfile().weight = 77.7, а в ib.profile — 82.
Observed:           cacheWeight 77.7 / storageWeight 82.
Expected:           Після невдалого локального запису кеш відкочується до
                    попереднього значення (у локальному режимі це єдине
                    джерело правди), або сторінка перемальовується з правди.
Impact:             Людина бачить свої дані на екрані й після F5 їх не
                    знаходить; тост про помилку вже зник.
Recommended fix:    У локальному режимі при !okLocal повернути cache до
                    попереднього обʼєкта перед киданням помилки.
Regression test:    Браузерна перевірка порівнює getProfile() з
                    localStorage після невдалого запису.
```

### LOC-005

```text
ID:                 LOC-005
Severity:           LOW
Confidence:         CONFIRMED
Category:           Відновлення даних / UX локального режиму
Location:           js/agegate.js:213-218 (ROUTES.age), js/account.js (імпорт),
                    js/welcome.js
Description:        Єдиний інтерфейс імпорту резервної копії — account.html.
                    Сторож пускає на account.html лише з кроку `body` і далі.
                    У чистому браузері (або одразу після кнопки «Стерти
                    локальні дані») профілю немає → крок `age` → дозволено
                    ЛИШЕ welcome.html. Тобто людина з експортованим
                    forge-profile.json не має жодного шляху його відновити,
                    доки не пройде екран віку. На welcome.html слова «імпорт»
                    немає взагалі.
Reproduction:       /tmp/audit-local/afterclear.mjs (localMode, file://):
                    чистий контекст → welcome.html → текст екрана:
                    «FORGE / Forge / Увійти / Зареєструватися / Сайт у
                    локальному режимі…»; згадок імпорту: false;
                    перехід на account.html → редирект на welcome.html.
                    Той самий глухий кут відтворюється в
                    /tmp/audit-local/roundtrip2.mjs: після справжньої кнопки
                    «Стерти локальні дані» `p.setInputFiles('#p-import-file')`
                    падає за таймаутом, бо account.html недосяжна.
Observed:           account.html → welcome.html; на welcome.html немає кнопки
                    імпорту.
Expected:           Або welcome.html пропонує «відновити з файлу» на першому
                    екрані, або крок `age` дозволяє account.html так само,
                    як крок `body` (комент у js/agegate.js:11 стверджує, що
                    account — «шлях для імпорту копії», але цей шлях
                    відкривається на крок пізніше, ніж потрібно).
Impact:             Після втрати даних (LOC-001) або після «Стерти локальні
                    дані» відновлення з власної копії неочевидне; людина
                    вважає копію непридатною.
Recommended fix:    Додати ROUTES.age.allowed = ['welcome.html','account.html']
                    (імпорт усе одно не пропускає дитячу birthDate —
                    js/account.js case 'birthDate'), або кнопку «Відновити з
                    файлу» на першому екрані welcome.
Regression test:    Браузерна: чистий контекст → account.html має відкритись,
                    імпорт файла має пройти.
```

### LOC-006

```text
ID:                 LOC-006
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Міграції / цілісність після відновлення з копії
Location:           js/account.js:777-795 (ALLOWED_KEYS — без `version`),
                    js/store.js:359-519 (migrate), js/store.js:521-524
Description:        Імпорт файла НЕ проходить ланцюжок міграцій. `version`
                    свідомо не входить у ALLOWED_KEYS, тож патч лягає на
                    профіль поточної версії (10) і `migrate()` більше не
                    виконує ЖОДНОГО кроку. Через це старий експорт
                    відновлюється в іншому стані, ніж той самий обʼєкт,
                    покладений напряму в `ib.profile`.
Why it matters:     Резервна копія — головний (у локальному режимі —
                    єдиний) інструмент відновлення. Вона мовчки повертає
                    дані у формі, якої застосунок більше не розуміє.
Reproduction:       /tmp/audit-local/oldimport.mjs (localMode, file://).
                    Один і той самий обʼєкт version:1 з
                    weights {'Присідання зі штангою':100, 'Згинання ніг':55,
                    'Згинання ніг лежачи':45} і customPlans з вправою
                    «Згинання ніг»:
                      A) покладено прямо в localStorage;
                      B) імпортовано через #p-import-file на account.html.
Observed:           A: weights = {'Присідання зі штангою':100,
                       'Згинання ніг сидячи':55},
                       weightLog = ['Присідання зі штангою','Згинання ніг сидячи'],
                       weightLogSeeded = true, вправа плану «Згинання ніг сидячи».
                    B: weights = {'Присідання зі штангою':100,
                       'Згинання ніг':55, 'Згинання ніг лежачи':45},
                       weightLog = [] (порожній), weightLogSeeded = false,
                       вправа плану «Згинання ніг».
Expected:           Обидва шляхи дають однаковий результат.
Root cause:         migrate() бере версію зі СХОВИЩА, а імпорт — це патч на
                    вже версійований профіль; версія файла ніде не читається.
Impact:             Після відновлення старої копії: історія робочих ваг не
                    засівається (розділ «Сила» в «Прогресі» лишається
                    порожнім), назви вправ лишаються тими, яких уже немає в
                    реєстрі js/programs-data.js — вправа не має ні опису, ні
                    групи мʼязів. Проблема тим гірша, чим старіша копія, і
                    зростатиме з кожним новим кроком міграції.
Recommended fix:    Прогнати обʼєкт файла через migrate() ДО validateImport
                    (використавши data.version як `stored`), або приймати
                    `version` у патч і викликати migrate() після імпорту.
Regression test:    Юніт (migrate — чиста функція, її можна винести в
                    *-core) + браузерна: імпорт файла version:1 має дати
                    той самий профіль, що й той самий обʼєкт у localStorage.
```

### LOC-007

```text
ID:                 LOC-007
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Конкурентність / тиха втрата даних
Location:           js/store.js:1027 (saveChain — на ВКЛАДКУ),
                    js/store.js:1544-1564 (doSave — read-modify-write з cache),
                    js/store.js:1674-1702 (слухач storage)
Description:        Дві вкладки одного браузера ділять localStorage, але
                    кожна має власний `cache` і власний `saveChain`. Синхро-
                    нізація між ними — подія `storage`, яка приходить
                    АСИНХРОННО й скидає кеш уже після того, як друга вкладка
                    зібрала свій `next` зі старого кеша. Результат — класична
                    втрачена правка: патч однієї вкладки зникає повністю.
Reproduction:       /tmp/audit-local/tabs.mjs (localMode, file://):
                    один BrowserContext, дві сторінки journal.html,
                    посіяний профіль weight=82, height=180, records={}.
                    Крок 1: Promise.all([
                      p1: Store.saveProfile({weight:100, bodyLog:{'2026-09-02':100}}),
                      p2: Store.saveProfile({height:200, records:{squat:555}}) ]).
                    Крок 4: обидві вкладки читають профіль і дописують свою
                    дату в bodyLog.
Observed:           Крок 1 → ib.profile = {"weight":100,"height":180,
                    "records":{},"bodyLog":{"2026-09-02":100}} — увесь патч
                    другої вкладки втрачено.
                    Крок 4 → bodyLog = {"2026-09-02":100,"2026-09-10":81};
                    запису '2026-09-11' від другої вкладки немає.
                    Крок 5 (forge.today, дві вкладки workout.html) →
                    {"dayIdx":0,"done":[3,0,0]} — стан другої вкладки зник.
                    Послідовні записи з паузою 200 мс і 1500 мс зливаються
                    правильно (крок 2 і 3), тобто вікно втрати < 200 мс.
Expected:           Запис читає актуальний localStorage безпосередньо перед
                    злиттям; жоден патч не зникає.
Root cause:         cache вважається актуальним, доки не прийшла подія
                    storage; doSave не перечитує ib.profile перед злиттям.
Impact:             Мовчазна втрата змін при роботі у двох вкладках
                    (типово: «Журнал» і «Тренування» поруч). Жодного
                    повідомлення, обидві вкладки показують «збережено».
Recommended fix:    У doSave (локальний режим — обовʼязково) будувати `next`
                    від СВІЖОГО readLocalProfile(), а не від cache, коли
                    між читанням і записом могла пройти чужа зміна; або
                    порівнювати updatedAt перед записом і зливати.
Regression test:    Браузерна перевірка з двома сторінками в одному
                    контексті (як /tmp/audit-local/tabs.mjs), очікування —
                    обидва поля на місці.
```

### LOC-008

```text
ID:                 LOC-008
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Стійкість / обхід воріт при заблокованому сховищі
Location:           js/agegate.js:114
                    `if (localStorage.getItem('ib.cloud') === '1') {`
Description:        Це ЄДИНЕ звернення до localStorage в застосунку, не
                    загорнуте в try/catch (перевірено всі 40+ звернень у js/).
                    Якщо браузер забороняє доступ до сховища (Safari/Chrome
                    із блокуванням даних сайтів, деякі WebView, корпоративні
                    політики), виклик кидає SecurityError — і сторож
                    ПРИПИНЯЄ ВИКОНАННЯ на цьому рядку, не дійшовши ні до
                    вікової перевірки, ні до маршрутизації онбордингу.
                    Сторінка відкривається повністю.
Why it matters:     Віковий барʼєр 17+ і весь онбординг зникають саме там,
                    де їх найлегше зустріти випадково; крім того, кожна
                    сторінка кидає необроблену помилку (шум у Sentry).
Reproduction:       /tmp/audit-local/gate-storage.mjs (localMode, file://):
                    БАЗА (чистий браузер, сховище працює):
                      index.html → welcome.html, pageerror немає.
                    Мок, у якому кидає РІВНО ОДНЕ читання
                    (`getItem('ib.cloud')`), решта сховища робоча:
                      index.html → index.html, pageerror: insecure.
                    Повний мок (усі методи кидають) — те саме на всіх 21
                    сторінці зі сторожем (/tmp/audit-local/nostorage.mjs,
                    прогони A і B); legal.html (без agegate.js) помилки не
                    дає — це й локалізує причину.
Observed:           index.html відкривається без профілю й без редиректу;
                    `Uncaught SecurityError` на кожній сторінці.
Expected:           Читання загорнуте в try/catch; при недоступному сховищі
                    сторож поводиться як із порожнім профілем (крок `age`)
                    і відсилає на welcome.html.
Root cause:         Пропущений try/catch у гілці хмарного режиму.
Impact:             Обхід вікових воріт і онбордингу; необроблена помилка на
                    кожному завантаженні; далі застосунок працює без будь-
                    якого сховища (усі записи мовчки нікуди не йдуть).
Recommended fix:    `let cloudFlag = null; try { cloudFlag =
                    localStorage.getItem('ib.cloud'); } catch (_) {}` — і
                    далі за прапорцем. Один рядок.
Regression test:    Браузерна перевірка з addInitScript, що робить
                    localStorage кидаючим: усі сторінки мають відвернути на
                    welcome.html і не дати pageerror.
```

### LOC-009

```text
ID:                 LOC-009
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Часткові записи / тиха втрата
Location:           js/workout.js:112-115 (saveDayState), js/workout.js:267-274
                    (scheduleSessionLog — помилка йде в console.warn),
                    js/workout.js:303-306 (finishWorkout: writeDay + saveOwn)
Description:        Одна дія людини (закрити підхід, завершити тренування)
                    змінює ДВА незалежні записи: `forge.today` (галочки) і
                    `ib.profile.sessionLog` (історія). Вони пишуться окремо,
                    без спільної транзакції, і кожен може впасти самостійно.
                    Жоден із двох відмов не показується користувачу:
                    writeDay ковтає виняток (LOC-002), а помилка
                    saveProfile у scheduleSessionLog іде лише в console.warn.
Reproduction:       /tmp/audit-local/partial.mjs (localMode, file://,
                    справжні кліки по [data-set-ex] на workout.html):
                    (а) мок, у якому падає лише setItem('forge.today');
                    (б) мок, у якому падає лише setItem('ib.profile').
Observed:           (а) forge.today = null, але sessionLog має запис
                        {done:2,total:14,doneSets:3,totalSets:34,…};
                        тостів — жодного. Після reload сторінка тренування
                        показує 0 закритих підходів, а «Прогрес» — сесію.
                    (б) forge.today = {"date":"2026-09-06","plan":"fullbody:3",
                        "dayIdx":0,"done":[[{"r":9},{"r":9}],[{"r":9}]]},
                        sessionLog = {} після reload; тостів — жодного.
Expected:           Або обидва записи, або жодного; будь-яка відмова видима.
Root cause:         Два сховища для одного факту; проковтнуті помилки.
Impact:             Неконсистентна історія тренувань: «Прогрес» рахує
                    сесію, якої на сторінці тренування немає (або навпаки).
                    Оскільки sessionLog годує ELO/рейтинг, розбіжність
                    їде далі за межі localStorage.
Recommended fix:    Мінімум — показувати тост на обох шляхах (writeDay
                    повертає bool; scheduleSessionLog замість console.warn
                    робить toast). Далі — писати денний стан у профіль
                    одним записом або відновлювати галочки з sessionLog.ex,
                    коли forge.today порожній, а сесія на сьогодні є.
Regression test:    Браузерна перевірка з мокованим setItem (як
                    /tmp/audit-local/partial.mjs): після відмови будь-якого
                    з двох записів на сторінці має зʼявитись повідомлення.
```

### LOC-010

```text
ID:                 LOC-010
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Стійкість до пошкоджених даних
Location:           js/meals.js:308-311 (loadFolds), js/meals.js:1324-1325
Description:        loadFolds() робить `JSON.parse(...) || {}` і повертає
                    БУДЬ-ЯКЕ істинне значення — зокрема рядок, число або
                    true. Далі `state.folds.foods = true` кидає TypeError у
                    строгому режимі, і сторінка «Раціон» помирає НАЗАВЖДИ:
                    ключ ніхто не перезаписує, тож кожне наступне
                    відкриття падає так само.
Why it matters:     Це саме той випадок, який розділ A5 називає головним —
                    «застосунок не має вмирати назавжди через погані дані».
                    tools/verifyhardening.mjs перевіряє лише `ib.profile`,
                    тому цей клас пошкодження не покритий взагалі.
Reproduction:       /tmp/audit-local/foldbug.mjs (localMode, file://):
                    localStorage.setItem('ib.meals.fold', '"рядок"')
                    (так само '5', 'true'); відкрити meals.html тричі.
Observed:           Кожен із трьох проходів:
                      PAGEERROR «Cannot create property 'foods' on string 'рядок'»
                      (відповідно «on number '5'», «on boolean 'true'»),
                      довжина тексту сторінки 937 символів — самі меню,
                      кнопок дня немає (`[data-add-to]` не знайдено),
                      ключ лишається незмінним.
                    Значення 'НЕ JSON {{{', '[]', '{}' проблеми не дають.
Expected:           Нерозпізнана форма → {} і сторінка працює.
Root cause:         Немає перевірки, що розібране значення — plain-object.
Impact:             Сторінка «Раціон» (щоденне харчування, найчастіша
                    сторінка після тренування) недоступна без DevTools.
Recommended fix:    `const v = JSON.parse(...); return (v && typeof v ===
                    'object' && !Array.isArray(v)) ? v : {};`
Regression test:    Додати `ib.meals.fold` (і решту не-профільних ключів) до
                    матриці tools/verifyhardening.mjs з payload'ами
                    '"рядок"', '5', 'true', '[]', 'НЕ JSON'.
```

### LOC-011

```text
ID:                 LOC-011
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Приватність / неповне стирання
Location:           js/store.js:1512-1527 (clearLocal — перелік ключів),
                    js/store.js:821-828 (clearIdentityData),
                    js/welcome.js:76-93 (ib.regdraft)
Description:        Кнопка «Стерти локальні дані» (і вихід з акаунта) не
                    прибирають `ib.regdraft` — чернетку реєстрації, у якій
                    лежать нік, e-mail, дата народження, стать, вага, зріст,
                    активність, стаж, пульс і позначки згод. Чернетка
                    стирається лише тоді, коли заявку подано (js/welcome.js:591)
                    або через кнопку виходу НА welcome.html (:924); людина,
                    яка почала реєстрацію й покинула її, лишає ці дані в
                    браузері назавжди.
Why it matters:     Текст самої кнопки: «Стерти всі дані в цьому браузері?
                    Дію не можна скасувати — іншої копії немає»; коментар у
                    коді: «Прибирає ВСЕ, що сайт тут лишив». Обидва
                    неправдиві. На спільному компʼютері наступна людина
                    бачить попередню чернетку у формі реєстрації (loadDraft
                    сам піднімає її в поля).
Reproduction:       /tmp/audit-local/clearlocal.mjs (localMode, file://):
                    1) welcome.html → «Зареєструватися» → ввести дату
                       народження. Ключ ib.regdraft зʼявляється зі
                       справжніми даними:
                       {"v":1,…,"dob":{"d":"15","m":"06","y":"1990"},…}
                    2) посіяти ib.regdraft із ніком/поштою/тілом,
                       відкрити account.html, натиснути «Стерти локальні дані».
Observed:           до кнопки: ib.cloud, ib.gateloop, ib.profile, ib.regdraft,
                    ib.remember
                    після:     ib.cloud, ib.gateloop, ib.regdraft, ib.remember
                    ib.regdraft = {"v":1,"stage":"body","username":"nick",
                    "email":"…","dob":{…},"body":{"weight":"82","height":"180"},
                    "consents":{"c-terms":true}}
Expected:           `ib.regdraft` входить у перелік clearLocal і
                    clearIdentityData (вихід з акаунта на будь-якій сторінці).
Impact:             Персональні дані (пошта, дата народження, антропометрія)
                    переживають явне стирання й вихід з акаунта.
Recommended fix:    Додати 'ib.regdraft' (а також 'ib.remember' і 'ib.cloud',
                    якщо кнопка справді має повертати браузер у стан «сайт
                    тут не був») до обох переліків у js/store.js.
Regression test:    Браузерна: посіяти всі відомі ключі → clearLocal() →
                    у localStorage не лишається жодного ключа з префіксом
                    `ib.` / `forge.`, крім тих, що явно оголошені винятком.
```

## Що перевірено (з числами)

| Проба | Обсяг | Результат |
|---|---|---|
| Пошкодження `ib.profile` (`/tmp/audit-local/corrupt.mjs`) | 26 класів × 22 сторінки = **572 завантаження** у локальному режимі | JS-помилок 0 на всіх; але 8–10 сторінок ПЕРЕЗАПИСУЮТЬ профіль (LOC-001) |
| Класи пошкодження | битий JSON (обрізаний і сміття), порожній рядок, JSON-рядок/число/`null`/`true`, масив, `{}`, лише `version`, неправильні типи в 13 полях, `"NaN"`/`"Infinity"`, `null` у числових, відʼємні, `1e308`, `1e999`→`null`, невідомі enum, версії 1/2/без version/999, зайві поля, `__proto__`, `constructor`/`prototype` як ключі ваг, вкладеність 200 рівнів, профіль 4 МБ | — |
| Пошкодження ІНШИХ 20 ключів (`otherkeys2.mjs`) | 20 ключів × 4 payload × 22 сторінки, з бісекцією | 1 знахідка: `ib.meals.fold` (LOC-010) |
| Ланцюжок міграцій (`migrate.mjs`) | 21 значення `version`: немає, 0…11, 999, −1, `"5"`, `"abc"`, `null`, 1.5, `true` | падінь немає; перейменування 9→10 і засів weightLog 1→2 працюють; версія з майбутнього зберігається як є |
| Квота (`quota2.mjs`, `quotapages.mjs`) | заповнення до `QuotaExceededError` (282 ключі, 5 244 599 символів), потім 22 сторінки | сторінки живі, `saveProfile` чесно кидає помилку і показує тост; `forge.today` і beacon мовчать (LOC-002, LOC-003) |
| Відсутнє/заблоковане сховище (`nostorage.mjs`, `gate-storage.mjs`) | 3 сценарії × 22 сторінки + ізольована проба одного читання | LOC-008: `js/agegate.js:114` — єдине звернення без try/catch, ворота вимикаються |
| Export → clear → import (`verifyroundtrip.mjs`) | 42 перевірки, хмарний режим (двійник) | **42/42 пройшло** |
| Export → clear → import (`roundtrip2.mjs`) | ЛОКАЛЬНИЙ режим, профіль із 38 заповненими полями (включно з `measureLog`, `day`, `bmiAck`, `pet`, `displayName`, `scheme`, `ratingLog`, `ratingSeen`, `sessionLog.ex[].s`) | **тотожність повна**, 0 розбіжностей |
| Імпорт чужого/битого/старого/ворожого файла (`oldimport.mjs`) | 5 сценаріїв | чужий JSON, битий JSON, масив і ворожі значення відхиляються коректно й нічого не псують; СТАРИЙ файл — LOC-006 |
| Дві сторінки в одному контексті (`tabs.mjs`) | 5 сценаріїв (одночасно, 200 мс, 1500 мс, дописування в журнал, `forge.today`) | LOC-007: втрачена правка при вікні < 200 мс |
| Часткові записи (`partial.mjs`) | 2 сценарії з мокованим `setItem` + справжні кліки по підходах | LOC-009: обидва боки мовчать |
| Подія `storage` з чужим битим записом (`storageevent.mjs`) | 3 сценарії | падінь немає; кеш скидається правильно; чужий `clearLocal` не воскрешає дані |
| Реалістичний профіль за 1 і 3 роки (`bigprofile.mjs`) | 0.42 МБ і 1.26 МБ, 2 × 22 сторінки | помилок немає; `journal.html` 4.4 с, `trackers.html` 3.4 с на трирічному профілі |
| `NaN`/`Infinity` через JSON (`nan.mjs`) | 7 полів | у сховище лягає `null`; кеш у памʼяті лишається `NaN` до перезавантаження |
| Повнота `clearLocal` (`clearlocal.mjs`) | усі ключі | LOC-011: `ib.regdraft` переживає стирання |
| `tools/verifyhardening.mjs` | 23 перевірки | **23/23 пройшло** |

Разом: **≈1 300 завантажень сторінок** у контейнерному Chromium по `file://`,
жодного звернення до бойового Supabase (усі зовнішні запити обірвані
`ctx.route(...abort())`, ключі Supabase погашені `localMode()`).

### Чого саме НЕ робить `tools/verifyhardening.mjs`

Питання з A5 — «визнач точно, чого він не робить». Перевірено читанням
файла й порівнянням із власними прогонами:

1. Псує **лише `ib.profile`**. Решта 20 ключів (`forge.today`,
   `ib.meals.fold`, `ib.pending`, `ib.session`, `ib.account`, `ib.regdraft`,
   6 ключів ELO, `ib.profile.backup*`, `ib.profile.owner`,
   `ib.profile.dirty`, `ib.remember`, `ib.cloud`, `forge.theme`,
   `forge.scheme`) не псуються жодного разу — так і пропущено LOC-010.
2. Працює **лише в хмарному режимі** (`adultContext(b, …)` без
   `{local:true}`): у сховищі сидить фейкова сесія й `ib.account:approved`,
   а `/rest/v1/profiles` віддає `[]`. Локальний режим — той, у якому
   `localStorage` єдине сховище — не перевіряється взагалі.
3. Критерій успіху — **тільки відсутність JS-помилок**. Ані «чи вціліли
   дані», ані «чи не перезаписано профіль», ані «чи показано помилку»
   не перевіряється. Саме тому LOC-001 (тихий перезапис) проходить
   повз усі 23 перевірки.
4. **Квоти немає.** Жодна перевірка не заповнює сховище, тому LOC-002,
   LOC-003, LOC-004, LOC-009 невидимі.
5. **Недоступного сховища немає** (приватний режим, SecurityError) —
   LOC-008 невидимий.
6. **Конкурентності між сторінками немає**: усі сценарії — одна сторінка
   в одному контексті. LOC-007 невидимий.
7. Не перевіряє **міграцій**: у payload'ах є `version: 5` і `version: 999`,
   але результат міграції не звіряється.
8. Не перевіряє **round-trip** (це окремий `verifyroundtrip.mjs`), і жоден
   із двох не імпортує СТАРИЙ файл — LOC-006 невидимий.

## Що НЕ перевірено і чому

1. **Safari, Firefox, WebKit і мобільні браузери.** У контейнері є лише
   Chromium (`/opt/pw-browsers/chromium-1194`). Поведінку приватного
   режиму Safari змодельовано моком (`localStorage` кидає SecurityError),
   але це модель, а не браузер. Квота localStorage в Safari (≈5 МБ) і
   7-денне видалення сховища за ITP не перевірялись.
2. **Реальне пошкодження сховища на диску** (LevelDB браузера) — відтворити
   в контейнері неможливо; пошкодження моделювалось записом битого рядка.
3. **Хмарний режим проти БОЙОВОГО Supabase** — заборонено §1.2 PROMPT.md.
   Усі хмарні гілки (`enforceOwner`, `resolveFirstLogin`,
   `adoptLocalProfile`, `discardLocalProfile`, черга `ib.pending`,
   `flushPending`) перевірялись лише через двійник із `tools/adult.mjs`
   або читанням коду; висновків рівня CONFIRMED по них не подано.
4. **Зростання `ib.pending` за довгий офлайн** (200 патчів × повні журнали
   трирічного профілю = сотні МБ) — не відтворено: у локальному режимі
   черга не наповнюється взагалі (`queuedError`/`pendingPush` викликаються
   лише в гілці `CLOUD && session`), а хмарний сценарій потребує бойового
   бекенду. Ризик описано в INFO-4 як POSSIBLE.
5. **Взаємодія зі Service Worker** (стара версія JS читає новіший профіль,
   `version` з майбутнього) — домен A8, тут лише зафіксовано, що профіль
   із `version: 11/999` зберігається без змін.
6. **Доказ, що застосунок сам ніколи не запише в `ib.profile`
   не-обʼєкт.** Спостережено, що в жодному з прогонів цього не сталось,
   але формального доведення (усі шляхи запису) не робилось.
7. **Поведінка при `localStorage`, який мовчки не зберігає** (деякі
   WebView повертають успіх, але не пишуть) — не змодельовано.
8. **IndexedDB / Cache Storage** — застосунок їх для даних користувача не
   використовує (перевірено `grep`), тому поза доменом.

## Спостереження (INFO)

```text
ID:        LOC-I-1
Severity:  INFO
Category:  Довгостроковість
Опис:      Реалістичний профіль за 3 роки (1095 днів bodyLog + mealLog,
           626 сесій із поперсетовим знімком, 6 трекерів × 1095 днів,
           30 вправ × 219 записів історії ваг, 2190 ключів ratingSeen)
           важить 1.26 МБ (1 318 459 символів). Квота Chromium у пробі —
           ≈5 244 599 символів, тобто профіль займе ~25 %. Помилок немає,
           але рендер journal.html — 4.4 с, trackers.html — 3.4 с,
           programs.html — 2.3 с (проти <1 с на порожньому профілі).
```

```text
ID:        LOC-I-2
Severity:  INFO
Category:  Числа
Опис:      NaN та ±Infinity у профілі при записі перетворюються JSON.stringify
           на null, тобто поле мовчки стає «не задано»
           (/tmp/audit-local/nan.mjs: weight/height/bodyfat/weights.X/
           records.squat/bodyLog[date] → null). Сторінки на такому профілі
           не падають і слів «NaN»/«Infinity» не показують. Побічний
           ефект: у памʼяті кеш тримає справжній NaN
           (Number.isNaN(getProfile().weight) === true), а у сховищі вже
           null — розбіжність зникає після перезавантаження.
```

```text
ID:        LOC-I-3
Severity:  INFO
Category:  Міграції
Опис:      `version` більший за SCHEMA_VERSION не нормалізується: профіль із
           version 11 або 999 зберігає своє число, жоден крок міграції не
           виконується, і застосунок працює з ним як із поточним. Поки
           деплой один — нешкідливо; у парі зі stale-while-revalidate SW
           (стара вкладка + новий профіль) це шлях до мовчазної розбіжності
           форм. Пропозиція: `if (v > SCHEMA_VERSION) v = SCHEMA_VERSION`
           не годиться (сховає проблему) — краще журналювати факт.
```

```text
ID:        LOC-I-4
Severity:  INFO
Confidence: POSSIBLE
Category:  Квота / хмарний режим
Опис:      `pendingPush` кладе в `ib.pending` ЦІЛИЙ патч, а патчі Forge
           містять повні журнали (`sessionLog`, `trackerLog`, `weightLog`
           передаються обʼєктом цілком — див. js/workout.js:271,
           js/programs.js:1929). На трирічному профілі один такий патч —
           сотні кілобайтів, а межа черги — 200 записів
           (js/store.js:928). Тобто довгий офлайн у хмарному режимі
           теоретично вичерпує квоту сховища самою чергою. Не відтворено
           (потребує бойового бекенду) — тому POSSIBLE, а не CONFIRMED.
```

```text
ID:        LOC-I-5
Severity:  INFO
Category:  Сторож
Опис:      Запобіжник циклів (js/agegate.js:54-64, ключ `ib.gateloop` у
           sessionStorage) після 4 редиректів за 10 секунд ВІДКРИВАЄ будь-яку
           сторінку без перевірки. Це свідомий компроміс («краще один зайвий
           екран, ніж мертвий сайт»), але саме він і є другим шляхом до
           LOC-001: людина з битим профілем, яка за 10 секунд натиснула
           п'ять пунктів меню, потрапляє на plan.html — і та перезаписує
           профіль. Варто хоча б не РОБИТИ ЗАПИСІВ у режимі «сторож
           замовк».
```

```text
ID:        LOC-I-6
Severity:  INFO
Category:  Стійкість — позитивне
Опис:      Що витримало все, що я кинув:
           · setItem атомарний — жодна проба з квотою не лишила частково
             записаного JSON (ib.profile завжди або старий, або новий);
           · валідатор імпорту (js/account.js) не пропустив жодного
             ворожого значення: `weightLog:null`, `sessionLog:null`,
             `bodyLog:null`, дитяча birthDate, `activity:1.4`, `sex:'m'`,
             `displayName` на 200 символів, `url:'javascript:…'` — усе
             відхилено поіменно, профіль лишився цілим;
           · невідомий `sex` не ламає розрахунки — сторож бачить неповне
             тіло й веде на крок онбордингу;
           · `__proto__` у профілі, у ключах `weights` і в інших ключах не
             дав ані забруднення прототипу, ані помилок;
           · профіль на 4 МБ і вкладеність у 200 рівнів — жодної помилки на
             22 сторінках;
           · подія `storage` з чужим битим записом не валить сусідню вкладку;
           · `verifyroundtrip.mjs` 42/42 і власний round-trip на 38 полях у
             локальному режимі — тотожність повна.
```

## Зведена таблиця

| ID | Severity | Confidence | Category | Location |
|---|---|---|---|---|
| LOC-001 | HIGH | CONFIRMED | Тиха втрата даних | js/store.js:121,521,1564 |
| LOC-008 | HIGH | CONFIRMED | Обхід воріт при заблокованому сховищі | js/agegate.js:114 |
| LOC-002 | MEDIUM | CONFIRMED | Тиха втрата при квоті | js/workout-core.js:426 |
| LOC-003 | MEDIUM | CONFIRMED | Тиха втрата при квоті | js/store.js:1458 |
| LOC-006 | MEDIUM | CONFIRMED | Міграції при імпорті | js/account.js:777 |
| LOC-007 | MEDIUM | CONFIRMED | Конкурентність двох вкладок | js/store.js:1027,1544 |
| LOC-009 | MEDIUM | CONFIRMED | Часткові записи | js/workout.js:271,303 |
| LOC-010 | MEDIUM | CONFIRMED | Сторінка гине назавжди | js/meals.js:308 |
| LOC-011 | MEDIUM | CONFIRMED | Приватність / неповне стирання | js/store.js:1512 |
| LOC-004 | LOW | CONFIRMED | Кеш ≠ сховище | js/store.js:1562 |
| LOC-005 | LOW | CONFIRMED | Недосяжний імпорт після стирання | js/agegate.js:213 |

## Відповідь на головне питання розділу A5

**Застосунок ПЕРЕЗАПИСУЄ пошкоджений профіль дефолтним.** Резервної копії
пошкоджених байтів не робиться, повідомлення користувачу немає, відкотити
нічого. У локальному режимі, де `ib.profile` — єдина копія, це остаточна
втрата (LOC-001). Водночас «померти назавжди» через пошкоджений
`ib.profile` застосунок не може: жодна з 22 сторінок не падає на жодному з
26 класів пошкодження. Єдина сторінка, яка гине назавжди, гине не від
профілю, а від службового ключа `ib.meals.fold` (LOC-010).
