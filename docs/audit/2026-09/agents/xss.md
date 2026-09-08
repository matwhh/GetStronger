# Аудит 2026-09 — домен «Клієнтська безпека: XSS, URL, токени, CSP, SW»

Агент: `xss` · префікс знахідок: `WEB` · Phase A (тільки читання)
Репозиторій: `/root/work/forgesite`, гілка `master`, HEAD `964429b`
Дата прогону: 2026-09-06

---

## Обсяг і метод

Перевірено клієнтську частину розділу A3 PROMPT.md:

1. інвентар усіх DOM-синків (`innerHTML`, `outerHTML`, `insertAdjacentHTML`,
   `document.write`, `srcdoc`, `eval`/`new Function`, `setAttribute` з
   `href`/`src`/`on*`) у `js/*.js` та inline-`<script>` у `*.html`;
2. **практична** перевірка XSS у Chromium по `file://` з посадженим профілем
   (payload-и в кожному текстовому полі профілю; штатний імпорт JSON;
   обхід усіх сторінок + клік по всіх кнопках/вкладках);
3. URL/hash: `js/agegate.js` (перенесення auth-фрагмента), `js/store.js`
   (`adoptUrlSession`), `js/welcome.js`, усі `location.*`;
4. токени й сесія: ключі `localStorage`, чистка при виході / зміні акаунта /
   протермінуванні, `js/errors.js` (що йде в Sentry);
5. CSP і заголовки з бойового домену (`curl -sI`) проти `vercel.json`;
6. `sw.js` — стратегія кешу, ключі, чи може віддати чужу/застарілу сторінку;
7. відсутність CDN і сторонніх скриптів.

Інструменти: `grep`/власний статичний сканер (`/tmp/audit-xss/scan.mjs`),
Playwright/Chromium по `file://` (5 власних харнесів у `/tmp/audit-xss/`),
`curl -sI` до `https://forge-mold1.vercel.app` (8 адрес).
Бойову базу не змінювано; жодного verify-скрипта з §1.2 не запускано.

---

## Що перевірено (з числами)

| Що | Кількість | Результат |
|---|---|---|
| файлів `js/*.js` | 53 | усі проскановано на синки |
| HTML-сторінок | 22 | усі проскановано |
| `innerHTML` (присвоєння + читання) | **125** у 23 файлах | розібрано, див. таблицю нижче |
| `insertAdjacentHTML` | 1 | константна розмітка |
| `outerHTML` / `document.write` / `srcdoc` / `eval(` / `new Function` | **0** | немає взагалі |
| `setAttribute` | 24 | жодного з `href`/`src`/`on*` і динамічним значенням |
| блоків-синків, розібраних вручну | 120 | 64 позначено сканером як «є неекранована вставка», кожен перевірено |
| сторінок, відкритих у Chromium із payload-профілем | 21 | 0 спрацювань |
| payload-полів профілю в посіві | 28 | див. нижче |
| кліків по кнопках/вкладках під час прогону | до 60 на сторінку | 0 спрацювань |
| штатний імпорт JSON із payload-ами | 1 файл, 24 поля | 5 полів прийнято, 0 спрацювань |
| адрес перевірено `curl -sI` | 8 | заголовки збігаються з `vercel.json` |
| сторонніх скриптів (`<script src=` на чужий домен) | **0** | підтверджено |

### Практичний XSS-стенд

`/tmp/audit-xss/deep.mjs` — профіль із payload-ами в полях: `displayName`,
`goal`, `pet.skin`, ключі `weights`, `records`, `weightLog`, `sessionLog.title`,
`sessionLog.ex[].n`, назви трекерів (`habit`, `supplement`, `water`),
`trackerLog` (значення з `source`), `ratingLog.reasons[].label`, ключі
`ratingSeen`, `customPlans` (`title`, `ex[].name`), `recipes` (`name`, `author`,
`items[].foodId`), `day.meals[].name`, `day.meals[].items[].foodId`, `deload.at`,
`periodization.mode`, `bmiAck.at`, `ib.eloReport.stats.bestCategory`.
Payload-и двох форм: текстова (`<img src=x onerror=…>`) та атрибутна
(`" autofocus onfocus=… q="`).

Результат: **жодного спрацювання** на 21 сторінці ні до, ні після кліків.
Payload-и видно в DOM у екранованому вигляді (`journal.html`, `meals.html`,
`trackers.html`, `trackers-settings.html`, `index.html`, `rating.html`) — тобто
дані справді доходять до рендеру і саме там екрануються.

### Штатний імпорт JSON

`/tmp/audit-xss/imp.mjs` — файл із payload-ами у 24 полях, завантажений через
`#p-import-file` на `account.html`. Валідатор `validateImport` (js/account.js)
прийняв payload лише в 5 полях (`weights`, `records`, `weightLog`, `ratingLog`,
`ratingSeen`) — решту відкинули обмеження довжини (13/40/60/80/120 символів) і
формати ключів. Жодне з прийнятих полів не рендериться неекранованим.

---

## Що НЕ перевірено і чому

- **Safari, Firefox, мобільні браузери** — у контейнері є лише Chromium
  (`tools/pw.mjs`). Поведінка `innerHTML`, CSP і SW у них не перевірялась.
- **Реальний потік листа Supabase** (`redirect_to`, Site URL, allow-list) —
  вимагав би реєстрації в бойовому проєкті (§1.2). Клієнтську половину
  перевірено підміною відповіді `/auth/v1/user` через `page.route()`.
- **CSP у бойовому браузері проти реального XSS** — синк, який вдалося
  підпалити (WEB-002), відтворено по `file://`, де CSP немає. Висновок про те,
  що бойова CSP його не зупинить, зроблено з тексту політики
  (`script-src 'self' 'unsafe-inline'` дозволяє inline-обробники), не з прогону
  в продакшені.
- **Sentry MCP / Vercel MCP** — див. розділ «Спостереження»; частина перевірок
  винесена в notPerformed структурованого результату.
- **Серверні обмеження на нік** — перевірено читанням `db/*.sql` і схеми; проби
  в бойовій базі не робились (домен `rls`/`db`).

---

## Знахідки

### WEB-001

```text
ID:                 WEB-001
Severity:           HIGH
Confidence:         CONFIRMED
Category:           auth / session fixation (login CSRF)
Location:           js/store.js:1171-1215 (adoptUrlSession)
                    js/agegate.js:79-85 (go(): перенос auth-фрагмента)
                    js/welcome.js:1239
```

**Description.** `Store.adoptUrlSession()` бере `access_token` і `refresh_token`
з фрагмента адреси й записує їх як власну сесію, не перевіряючи НІЧОГО, що
привʼязувало б фрагмент до цього браузера: немає ні `state`-nonce, ні позначки
«ми щойно надсилали лист», ні підтвердження від людини. Єдина перевірка —
`GET /auth/v1/user` з цим токеном, тобто «токен чинний», а не «токен наш».

Крім того `js/agegate.js` навмисно ПЕРЕНОСИТЬ фрагмент з будь-якої сторінки на
`welcome.html` (`carry` у `go()`), тому достатньо посилання на корінь сайту.

**Reproduction** (`/tmp/audit-xss/frag2.mjs`, Chromium, `file://`, відповідь
`/auth/v1/user` підмінена через `page.route()` — сервер бойовий не чіпався):

```
A: чистий браузер, вхід через index.html
   → сторінка welcome.html, hash порожній,
     ib.session = {"access_token":"ATTACKER_JWT","refresh_token":"ATTACKER_REFRESH",
                   "user":{"id":"aaaaaaaa-…-ffff","email":"attacker@evil.test"}}
C: жертва вже ввійшла (ib.session = VICTIM), відкриває welcome.html#access_token=…
   → ib.session замінено на ATTACKER_JWT; ib.profile.owner ще «жертва»
```

Крок за кроком:
1. Зловмисник реєструє власний акаунт у Forge (заявка може лишатись `pending`).
2. Бере з `localStorage.ib.session` свої `access_token` і `refresh_token`.
3. Надсилає жертві посилання
   `https://forge-mold1.vercel.app/#access_token=<його токен>&refresh_token=<його>&expires_in=3600&type=signup`.
4. `agegate` переносить фрагмент на `welcome.html`, `welcome.js` викликає
   `adoptUrlSession()`, сесія стає зловмисниковою. Фрагмент прибирається
   `history.replaceState` — в адресному рядку не лишається слідів.

**Observed.** Жертва мовчки працює під акаунтом зловмисника. Усе, що вона
введе далі (тренування, заміри, харчування, події ELO), пишеться в ХМАРНИЙ
рядок зловмисника і стає йому видимим. Якщо жертва була ввійдена, її власну
сесію витіснено, а локальний профіль на наступній навігації відкладається в
`ib.profile.backup.login` (`enforceOwner`, js/store.js:771-786) — тобто вона ще
й бачить порожній застосунок.

**Expected.** Фрагмент із листа приймається лише тоді, коли цей браузер сам
ініціював відповідну дію: одноразовий nonce у `sessionStorage`, покладений при
`signUp`/`resetPassword` і переданий у `redirect_to`; за наявності чинної чужої
сесії — явне питання людині, а не тиха заміна.

**Root cause.** Реалізовано «як у supabase-js `detectSessionInUrl`», але без
жодного звʼязку фрагмента з ініціатором; `agegate` додатково розширив площу
атаки з `welcome.html` на будь-яку сторінку сайту.

**Impact.** Дані про здоровʼя (вага, заміри, харчування, дати тренувань)
потрапляють до чужого акаунта; жертву вибиває з власного. Це не крадіжка
токена жертви, а протилежне — підсадка чужого; наслідок той самий: втрата
контролю над тим, куди їдуть дані.

**Recommended fix.** У `Store.adoptUrlSession()`: (1) вимагати збіг
одноразового nonce, записаного в `sessionStorage` перед відправкою листа;
(2) якщо чинна сесія вже є і `user.id` інший — не приймати мовчки, а показати
екран «увійти як інша людина?»; (3) звузити `carry` в `agegate.js` — переносити
фрагмент лише на `welcome.html` (уже так) і лише коли сесії немає.

**Regression test.** Браузерний: `welcome.html#access_token=…` без nonce у
`sessionStorage` не має створювати `ib.session`; із правильним nonce — має.

---

### WEB-002

```text
ID:                 WEB-002
Severity:           MEDIUM
Confidence:         CONFIRMED (синк відтворено; вхідна точка потребує контролю
                    над відповіддю RPC або над localStorage)
Category:           XSS (DOM sink без екранування)
Location:           js/season.js:299-320 (renderReport) і js/season.js:275-296
                    (reportStats); джерело — js/elo-hooks.js:180
```

**Description.** `renderReport()` читає `localStorage['ib.eloReport']`, парсить
JSON і вставляє в `innerHTML` дев'ять полів БЕЗ `esc()`: `rep.elo`, `rep.level`
(через `levelIcon`, там безпечно), `rep.rank`, `rep.of`, `rep.percentile`,
`rep.daysActive`, `rep.daysTotal`, `rep.graceUsed`, а `reportStats()` — ще
`s.elo`, `st.biggestGain`, `st.biggestLoss`. Значення в цей ключ кладуться
ВЕРБАТИМ із відповіді RPC `elo_close_season` (`js/elo-hooks.js:180`:
`if (report) lsSet('ib.eloReport', report);`) — без жодної перевірки типів.

Це єдине місце в застосунку, де мені вдалося підпалити код: решта 125 синків
екранує все, що не число.

**Reproduction** (`/tmp/audit-xss/elorep.mjs`):

```js
localStorage.setItem('ib.eloReport', JSON.stringify({
  ok:true, level:5,
  elo:'<img src=x onerror="window.__x=(window.__x||[]).concat(\'rep.elo\')">',
  rank:'<img src=x onerror=…>', percentile:'…', daysActive:'…', graceUsed:'…',
  stats:{ training:{elo:'…',avgQuality:0.8}, biggestGain:'…' } }));
// відкрити rating.html
```

**Observed.**
`rating.html FIRED: ["graceUsed","daysActive","biggestGain","rep.rank","rep.percentile","rep.elo","stats.elo"]`
— сім із семи payload-ів виконались.

**Expected.** Числа з відповіді сервера приводяться до числа
(`Number(x) || 0`) або екрануються, як усе інше в файлі.

**Root cause.** Автор виходив із того, що ці поля «завжди числа, бо їх
рахує Postgres». Решта файла (`esc(e.reason)`, `esc(r.name)`, `esc(a.label)`)
такого припущення не робить — тут воно просто загубилось.

**Impact.** Код у походженні сайту, де в `localStorage` лежить `ib.session` з
`access_token` і `refresh_token` — тобто повне захоплення акаунта. CSP це не
зупиняє (див. WEB-006). Вхідна точка — зміна відповіді `elo_close_season`
(баг у міграції, компрометація бази) або будь-який інший запис у
`localStorage`; від чужого користувача цей ключ зараз недосяжний.

**Recommended fix.** У `js/season.js` обгорнути кожну вставку в
`Number(...)`/`esc(...)`; у `js/elo-hooks.js:180` перед записом лишати з
`report` тільки очікувані числові поля.

**Regression test.** Юніт/браузерний: посадити в `ib.eloReport` рядок із
`<img onerror>` і перевірити, що `rating.html` не виконує його і не показує
розмітку.

---

### WEB-003

```text
ID:                 WEB-003
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           приватність / залишкові дані
Location:           js/welcome.js:76 (DRAFT_KEY 'ib.regdraft'), js/store.js:822-827
                    (clearIdentityData), js/store.js:1512-1527 (clearLocal),
                    js/account.js:218-222 (кнопка «Вийти»)
```

**Description.** Чернетка реєстрації `ib.regdraft` тримає **пошту**, дату
народження, стать, вагу й зріст та згоди. Вона НЕ входить ні в
`clearIdentityData()` (яку викликає `Store.signOut()`), ні в `clearLocal()`
(кнопка «Стерти дані в цьому браузері», чий коментар обіцяє «Прибирає ВСЕ, що
сайт тут лишив»). `clearDraft()` викликається лише в двох місцях
`welcome.js` — після подання заявки й у `doSignOut()` на самому welcome; вихід
із `account.html` іде повз нього.

**Reproduction** (`/tmp/audit-xss/draft.mjs`):

```
посів: ib.regdraft = {"email":"userA@example.com","dob":{"y":"1990","m":"06","d":"15"},
                      "body":{"sex":"male","weight":"82","height":"180"}, …}
клік «Вийти» на account.html
→ після виходу лишилось: ib.cloud, ib.regdraft
далі відкриваємо welcome.html
→ B бачить: {"emailInDom":true, "draft":"…userA@example.com…"}
```

**Observed.** Наступна людина за тим самим браузером відкриває `welcome.html` і
бачить у розмітці пошту попереднього користувача (екран «лист надіслано на …»),
а `loadDraft()` підставляє його дату народження й антропометрію у форму.
`Store.clearLocal()` теж лишає `ib.regdraft` на місці.

**Expected.** І явний вихід, і «стерти дані» прибирають чернетку.

**Root cause.** Ключ додано у `welcome.js` пізніше, ніж складались списки в
`store.js`; єдиного переліку «що сайт лишає в браузері» немає — він
продубльований у трьох місцях.

**Impact.** Витік персональних даних (пошта + дата народження + антропометрія)
на спільному пристрої; кнопка «стерти все» не виконує обіцяного.

**Recommended fix.** Винести перелік ключів у одну константу в `js/store.js`
і додати `ib.regdraft` до `clearIdentityData()` і `clearLocal()`.

**Regression test.** Браузерний: посадити всі ключі, викликати
`Store.signOut()` і `Store.clearLocal()`, звірити `Object.keys(localStorage)` з
очікуваним списком (порожній, крім `ib.cloud`/`ib.remember`).

---

### WEB-004

```text
ID:                 WEB-004
Severity:           LOW
Confidence:         CONFIRMED
Category:           приватність / залишкові дані
Location:           js/store.js:822-827 (clearIdentityData)
```

**Description.** Крім `ib.regdraft` (WEB-003), явний вихід лишає:
`ib.profile.backup` — повний знімок профілю перед імпортом (дата народження,
вага, журнали), і `forge.today` — стан сьогоднішнього тренування (галочки
вправ). У `clearLocal()` обидва є — тобто списки розійшлись.

**Reproduction** (`/tmp/audit-xss/sess.mjs`):

```
ДО виходу: forge.today, ib.account, ib.cloud, ib.eloReport, ib.eloState,
           ib.meals.fold, ib.pending, ib.profile, ib.profile.backup,
           ib.profile.backup.login, ib.profile.owner, ib.regdraft, ib.session
ПІСЛЯ Store.signOut(): forge.today, ib.cloud, ib.meals.fold,
                       ib.profile.backup, ib.regdraft
```

**Observed.** `ib.profile.backup` і `forge.today` переживають вихід.
**Expected.** Вихід прибирає всі особисті дані, як обіцяє коментар до
`clearIdentityData`.
**Impact.** Дані про здоровʼя лишаються доступними наступному користувачу
браузера (через DevTools або через кнопку «Відкотити імпорт» на account.html).
**Recommended fix.** Додати `LS_BACKUP` і `'forge.today'` до
`clearIdentityData()`.
**Regression test.** Той самий, що в WEB-003.

---

### WEB-005

```text
ID:                 WEB-005
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           приватність / телеметрія
Location:           js/errors.js:9-14 (декларація), js/errors.js:176-181 (event.request)
```

**Description.** Заголовок `js/errors.js` стверджує: «ЩО СВІДОМО НЕ
ВІДПРАВЛЯЄТЬСЯ: жодного ідентифікатора користувача — ні пошти, ні uid, ні
ніка». Клієнт справді нічого такого не кладе — але Sentry сам додає IP-адресу
з мережевого запиту й виводить із неї геолокацію.

**Reproduction.** Sentry MCP, організація `mold-t1`, issue `FORGE-3`
(подія `7589fc04dcb7837e481c82ea88cf10ea`):

```
### User
**user**: ip:31.144.72.87
**user.geo**: UA, Ukraine
```

**Observed.** У Sentry зберігається IP і країна кожного, у кого впав скрипт.
**Expected.** Або в проєкті Sentry вимкнено збереження IP
(Settings → Security & Privacy → «Prevent Storing of IP Addresses»), або текст у
`js/errors.js` і в політиці конфіденційності виправлено на чесний.
**Root cause.** Клієнтський модуль контролює лише тіло конверта; `user.ip`
проставляє сервер Sentry за замовчуванням.
**Impact.** IP — персональні дані за GDPR; застосунок про здоровʼя декларує
їх відсутність. Розбіжність між заявою й фактом — ризик і для довіри, і
формальний.
**Recommended fix.** Точка зупинки §1.5 (зміна налаштувань панелі Sentry) —
рішення за власником. Мінімум у репозиторії: привести коментар
`js/errors.js:9-14` і `legal.html` у відповідність до факту.
**Regression test.** Неавтоматизовний у репозиторії; перевіряти вручну після
зміни налаштувань проєкту Sentry.

---

### WEB-006

```text
ID:                 WEB-006
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           CSP / глибина захисту
Location:           vercel.json:10-13 (заголовок Content-Security-Policy)
```

**Description.** Фактична CSP на бойовому домені (перевірено `curl -sI`, збіг
із `vercel.json` побайтово):

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'
https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;
img-src 'self' data:; connect-src 'self' https://*.supabase.co
https://o4511925239676928.ingest.de.sentry.io; manifest-src 'self'; worker-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Дві проблеми:

1. `script-src 'unsafe-inline'` дозволяє inline-обробники подій, тобто саме ту
   форму payload-а (`<img src=x onerror=…>`), якою підпалюється WEB-002. CSP
   не зупиняє жодного знайденого синка — вона зараз не є другим рубежем узагалі.
   `'unsafe-inline'` потрібен через inline-`<script>` теми в `<head>` кожної
   сторінки (22 сторінки) і `onload="this.media='all'"` на шрифтах (20 сторінок).
2. `connect-src https://*.supabase.co` — це не «наш проєкт», а **будь-який**
   проєкт Supabase. Отже з боку CSP вивід украдених токенів у чужу базу
   дозволений. `img-src 'self' data:` вихід картинкою закриває, `connect-src` —
   ні.

**Reproduction.** `curl -sI https://forge-mold1.vercel.app/` (і ще 7 адрес) —
заголовок наведено вище; `/tmp/audit-xss/elorep.mjs` показує, що payload має
форму inline-обробника.

**Observed.** Жоден XSS не блокується політикою.
**Expected.** `script-src 'self' 'sha256-…'` (по одному хешу на кожен inline-
блок; вони ідентичні на всіх сторінках) або `'nonce-…'` — але статичний
хостинг nonce не дає, тож реалістичний шлях саме хеші. `connect-src` —
конкретний хост `https://sojbyoxcxyiollefupss.supabase.co`.
**Root cause.** CSP писалась під наявну розмітку, а не розмітка під CSP.
**Impact.** Немає другого рубежу проти XSS; дозволений канал ексфільтрації.
**Recommended fix.** (а) винести inline-скрипт теми в `js/theme-boot.js` і
`onload` шрифтів — у той самий файл, після чого прибрати `'unsafe-inline'` зі
`script-src`; (б) звузити `connect-src` до власного проєкту.
**Regression test.** `tools/ci-hygiene.mjs`: перевірка, що в `*.html` немає
`<script>` без `src` і немає атрибутів `on*`, і що `vercel.json` не містить
`'unsafe-inline'` у `script-src`.

---

### WEB-007

```text
ID:                 WEB-007
Severity:           MEDIUM
Confidence:         CONFIRMED (невалідний JSON-LD) / PROBABLE (причинний звʼязок
                    із помилками в Sentry)
Category:           продакшен-помилка / структуровані дані
Location:           js/app.js:362-394 (injectJsonLd)
```

**Description.** Коли сторінка має більш ніж один обʼєкт schema.org,
`injectJsonLd()` серіалізує МАСИВ: `JSON.stringify(graph)`. Верхнього рівня
`@context` у такому документі немає — це не валідний JSON-LD (для набору
потрібен `{"@context":…, "@graph":[…]}`). Змінна навіть названа `graph`, але
`@graph` не пишеться.

Масив зʼявляється рівно на трьох сторінках — тих, що є в словнику `CALC`:
`calculator.html`, `nutrition.html`, `cardio.html`.

У Sentry (`mold-t1`, проєкт Forge) три незакриті issue з ідентичним текстом
`TypeError: undefined is not an object (evaluating 'r["@context"].toLowerCase')`:
`FORGE-2` — culprit `/calculator.html`, `FORGE-3` — `/nutrition.html`,
`FORGE-4` — `/cardio.html`. Разом 7 подій, 6 користувачів, Safari 18.4/macOS,
перші за 2026-09-04. Набір сторінок збігається зі словником `CALC` один в один.

**Reproduction** (`/tmp/audit-xss/ld2.mjs`, Chromium, `file://`):

```
{ path: '…/calculator.html', page: 'calculator.html',
  all: [ '[{"@context":"https://schema.org","@type":"WebSite",…},
          {"@context":"https://schema.org","@type":"WebApplication",…}]' ] }
```

— тобто `<script type="application/ld+json">` починається з `[`.
На `index.html`/`journal.html` — звичайний обʼєкт, і в Sentry цих сторінок немає.

**Observed.** Невалідні структуровані дані; споживач JSON-LD у Safari падає з
`TypeError` на реальних користувачах, і `js/errors.js` шле це в Sentry.
**Expected.** `{'@context':'https://schema.org','@graph':[site, app]}`.
**Root cause.** Гілка з двома обʼєктами ніколи не перевірялась: жоден тест не
відкриває `calculator.html`/`nutrition.html`/`cardio.html` і не читає ld+json.
**Impact.** Пошук не читає розмітку трьох сторінок; у продакшені стабільно
падає скрипт і витрачається квота Sentry; три «живі» issue приховують справжні
регресії.
**Recommended fix.** У `js/app.js:393`: замість `graph.length === 1 ? graph[0] : graph`
віддавати `{'@context':'https://schema.org','@graph': graph.map(без @context)}`.
**Regression test.** Браузерний: на кожній із трьох сторінок
`JSON.parse(ld.textContent)` має бути обʼєктом і мати `@context`.

---

### WEB-008

```text
ID:                 WEB-008
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           auth / надійність
Location:           js/store.js:1196-1235 (adoptUrlSession)
```

**Description.** `adoptUrlSession()` прибирає фрагмент із адреси
(`history.replaceState`) ДО мережевого виклику `/auth/v1/user`, а в `catch`
цього виклику робить `clearSession()` і кидає «Посилання з листа вже
використане або застаріле». Гілка `catch` не розрізняє «сервер сказав ні» і
«мережі немає»: `req()` для мережевої відмови кидає `Error` з `offline: true`
(js/store.js:626-632 (`err.offline = true` — рядок 631)), але тут ця ознака не перевіряється — на відміну від
`doRefresh()` (js/store.js:877), де вона перевіряється явно.

**Reproduction** (`/tmp/audit-xss/frag.mjs`, перша редакція — усі зовнішні
запити обірвано, тобто «телефон без мережі»):

```
{ "hash": "", "href": "…/welcome.html", "session": null, "user": null }
```

Токен із фрагмента прийнято, фрагмент стерто, потім мережевий виклик впав —
і сесію знищено. Фрагмента вже немає, перезавантаження не допоможе.

**Observed.** Перехід із листа в метро/ліфті/поганому Wi-Fi «спалює»
посилання: людина не ввійшла, а токен уже витрачено.
**Expected.** Мережева відмова лишає сесію (токен уже збережено) і показує
«немає звʼязку», або фрагмент не стирається до успішної перевірки.
**Root cause.** У `catch` немає гілки `if (e && e.offline)`, яка є в
`doRefresh()`.
**Impact.** Найкрихкіший момент життєвого циклу акаунта (підтвердження пошти,
відновлення пароля) ламається від однієї втраченої відповіді.
**Recommended fix.** У `catch` `adoptUrlSession`: `if (e && e.offline) return {type: …}`
без `clearSession()`.
**Regression test.** Браузерний: `page.route()` обриває `/auth/v1/user`,
`welcome.html#access_token=…` → `ib.session` має лишитись.

---

### WEB-009

```text
ID:                 WEB-009
Severity:           LOW
Confidence:         CONFIRMED
Category:           витік токена в історію браузера
Location:           js/agegate.js:114-139, js/welcome.js:1239
```

**Description.** Фрагмент із токеном споживає лише `welcome.js`. Якщо лист
привів людину, яка вже має чинну сесію зі статусом `approved`, на будь-яку
іншу сторінку — `agegate` не редиректить (гілка «approved → далі профільні
кроки»), `welcome.js` не виконується, і `#access_token=…` лишається в
адресному рядку та в записі історії назавжди.

**Reproduction** (`/tmp/audit-xss/frag2.mjs`, сценарій B):

```
B: жертва вже ввійшла, вхід через index.html
   {"page":"index.html",
    "hash":"#access_token=ATTACKER_JWT&refresh_token=ATTACKER_REFRESH&expires_in=3600&type=signup", …}
```

**Observed.** Токен лишився в `location.hash`.
**Expected.** Будь-яка сторінка, побачивши auth-фрагмент, або передає його
`welcome.html`, або принаймні очищає (`history.replaceState`).
**Root cause.** `agegate` переносить фрагмент лише в тих гілках, де він і так
редиректить; для approved-користувача гілка виходить раніше.
**Impact.** `refresh_token` у історії браузера й у списку недавніх адрес
(синхронізація історії між пристроями, скріншоти, спільний компʼютер).
У `Referer` він не потрапляє — фрагмент туди не передається за специфікацією,
а `Referrer-Policy: strict-origin-when-cross-origin` додатково обрізає шлях.
**Recommended fix.** У `agegate.js`, коли редиректу не буде, а хеш містить
`access_token=`/`error=`, — зробити `location.replace('welcome.html' + hash)`
або `history.replaceState` без фрагмента.
**Regression test.** Браузерний: approved-сесія + `index.html#access_token=…`
→ `location.hash` порожній після завантаження.

---

### WEB-010

```text
ID:                 WEB-010
Severity:           LOW
Confidence:         CONFIRMED
Category:           service worker / сховище
Location:           sw.js:77-93 (гілка isHTML)
```

**Description.** `c.put(req, copy)` кладе в кеш `Request` цілком, разом із
query-рядком. Кожна унікальна адреса — окремий запис. Стелі розміру кешу немає,
витіснення немає, чистка відбувається лише при зміні `CACHE = 'forge-v1'`.

**Reproduction** (`/tmp/audit-xss/sw.mjs`, локальний HTTP-сервер із теки
проєкту — бойовий домен не використовувався):

```
кеші: [ 'forge-v1' ]
index.html із query: [ '…/index.html', '…/index.html?a=1',
                       '…/index.html?a=2', '…/index.html?utm_source=zzz' ]
чужого походження в кеші: []
```

**Observed.** Чотири копії однієї сторінки. Позитивне: відповідей Supabase у
кеші немає — гілка `url.origin !== self.location.origin` працює (перевірено
явним `fetch()` на бойовий URL із підмінами маршрутів).
**Expected.** Ключ HTML нормалізується (без query) або кеш має стелю.
**Root cause.** Ключем узято `Request` без нормалізації.
**Impact.** Будь-яке посилання з міткою (`?utm_source=`, `?fbclid=`) додає копію
сторінки; за роки використання кеш росте без обмежень, а тиск на квоту сховища
в браузері витісняє дані походження цілком.
**Recommended fix.** У гілці `isHTML` класти в кеш за нормалізованим ключем:
`c.put(new Request(url.origin + url.pathname), copy)`.
**Regression test.** Розширити `tools/verifysw.mjs`: після відкриття
`index.html?a=1` і `index.html?a=2` у кеші має бути один запис `index.html`.

---

### WEB-011

```text
ID:                 WEB-011
Severity:           LOW
Confidence:         CONFIRMED
Category:           service worker / розсинхрон версій
Location:           sw.js:95-109 (stale-while-revalidate для assets)
```

**Description.** HTML береться з мережі (свіжий), а `js/*.js` — з кешу з
фоновим оновленням. Отже перше відкриття після деплою виконує НОВИЙ HTML зі
СТАРИМ JavaScript.

**Reproduction** (`/tmp/audit-xss/sw.mjs`, локальний сервер підміняє версію в
`js/config.js` між відкриттями):

```
версія JS: до деплою= OLD   1-ше відкриття після деплою= OLD   2-ге= NEW
```

**Observed.** Рівно одна навігація зі старим кодом.
**Expected.** Або HTML і JS оновлюються разом, або зміни JS сумісні назад на
один деплой уперед.
**Root cause.** Свідомий компроміс stale-while-revalidate (описаний у шапці
`sw.js`), але наслідок «свіжий HTML + старий JS» у коментарі не названий.
**Impact.** Виправлення безпеки (наприклад, WEB-001/WEB-002) на одну навігацію
не діють. Якщо HTML і JS зміняться разом (новий `id`, новий контейнер) —
сторінка на одне відкриття зламана.
**Recommended fix.** Не змінювати стратегію заради стилю; достатньо додати в
`sw.js` коментар-попередження і правило релізу «HTML і JS міняємо сумісно».
Альтернатива без нових залежностей: у гілці HTML після успішного `fetch`
викидати з кешу застарілі `js/*.js` того самого деплою.
**Regression test.** Той самий сценарій у `tools/verifysw.mjs`.

---

### WEB-012

```text
ID:                 WEB-012
Severity:           LOW
Confidence:         CONFIRMED
Category:           стійкість до битих даних
Location:           js/programs.js (гілка малювання плану), поверхня —
                    plan.html, programs.html, workout.html
```

**Description.** День у `customPlans` без поля `exercises` валить сторінку
неперехопленим `TypeError: Cannot read properties of undefined (reading 'map')`.
Сторінка лишається порожньою, і сама себе не лікує.

**Reproduction** (`/tmp/audit-xss/cp.mjs`):

```
без customPlans                    ok
customPlans з ex-масивом           ERR: Cannot read properties of undefined (reading 'map')
customPlans = []                   ok
```

(де «ex-масив» = `{'fullbody:3':[{title:'X', ex:[…]}]}` — день, у якого є
масив вправ, але під іншим іменем поля.)

**Observed.** Три сторінки застосунку мертві, доки людина не почистить
`localStorage` вручну.
**Expected.** Безпечна відмова: день без `exercises` пропускається або
показується як порожній.
**Root cause.** `day.exercises` читається без перевірки.
**Impact.** Обмежений: штатний імпорт таку форму відкидає (`cleanPlan`,
js/account.js:910-930, вимагає `Array.isArray(d.exercises)`), тож увійти
можна лише прямим записом у сховище або зі старішої форми даних. Але вихід із
цього стану — тільки DevTools.
**Recommended fix.** `const list = Array.isArray(day.exercises) ? day.exercises : [];`
**Regression test.** Юніт на рендер плану з днем без `exercises`.
**Примітка.** Перетинається з доменом «цілісність даних / локальний режим» —
там знахідка може мати інший ID.

---

## Спостереження (INFO)

**WEB-013 — Google Fonts у критичному шляху, локальні шрифти не використовуються.**
`*.html` (20 сторінок, рядки ~45-52) вантажать `https://fonts.googleapis.com/css2?…`
і `https://fonts.gstatic.com`; CSP їх дозволяє явно. Водночас у репозиторії
лежать `tools/fonts/archivo-black.woff2`, `inter-cyr.woff2`, `inter-lat.woff2`,
на які ніщо не посилається (`grep -rn "woff2" css/ *.html js/` — нуль збігів у
розмітці). Це розходження з §2.1 («без CDN») і, для застосунку про здоровʼя,
передача IP кожного відвідувача Google на кожному відкритті сторінки.
Сторонніх **скриптів** немає: `<script src=` на чужий домен — 0.

**WEB-014 — `ForgeErrors.report()` не викликається ніде.**
`js/errors.js:229-235` описує ручний репорт (і навіть наводить приклад
`{ where: 'elo-api.submit' }`), але `grep -rn "ForgeErrors.report" js/` дає лише
сам файл. Тобто всі місця, де виняток спійманий `catch (_) {}` (їх у
`js/season.js`, `js/elo-api.js`, `js/store.js` десятки), мовчать назавжди.

**WEB-015 — друга, слабша реалізація `esc()`.**
`js/bmi-core.js:88-93` має власний `esc`, який НЕ екранує `'` (одинарну лапку),
на відміну від `js/app.js:18-22`. Зараз усі значення там константні
(`WARN[category(b)]`), тож наслідків немає, але це друге джерело правди про
екранування.

**WEB-016 — набір символів ніка перевіряється лише в одній із двох функцій.**
`register_request` (db/nick-length.sql:41-44, живе визначення звірено —
`has_charset_check: true`) вимагає
`^[[:alnum:]А-Яа-яІіЇїЄєҐґʼ''_. -]+$` і 3–13 символів. `elo_set_name`
(db/leaderboard-name.sql:60-72, живе визначення збігається з репозиторієм)
для акаунта БЕЗ затвердженого ніка бере `p_name` як є й лише обрізає до 13
символів — без перевірки набору символів. Практичного XSS це не дає:
`js/season.js:230` екранує `r.name`, а 13 символів замало для робочого
payload-а. Живий стан бази чистий:

```sql
select count(*) from account_status;                                  -- 2
select count(*) from account_status
 where status='approved' and (username is null or username='');       -- 0
select count(*) from season_state
 where display_name !~ '^[[:alnum:]А-Яа-яІіЇїЄєҐґʼ''_. -]+$';          -- 0
select max(char_length(display_name)) from season_state;              -- 11
```

Таблична `CHECK` — тільки на довжину (`account_status_username_len`), набір
символів у схемі не закріплений.

**WEB-017 — `access-control-allow-origin: *` на всіх відповідях; немає COOP/CORP.**
Перевірено `curl -sI` на 8 адресах. Для статики без автентифікації наслідків
немає (вміст і так публічний), але це означає, що будь-який сайт може читати
розмітку й скрипти Forge через `fetch`. Заголовків `Cross-Origin-Opener-Policy`
і `Cross-Origin-Resource-Policy` немає. `Strict-Transport-Security:
max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Permissions-Policy` — на місці й збігаються
з `vercel.json`. HTML, `js/*`, `css/*`, `sw.js` — `max-age=0, must-revalidate`;
`icons/*` — `max-age=604800`. Захист розгортань Vercel: `ssoProtection.enabled:
true` (`all_except_custom_domains`), пароля й Trusted IPs немає — прев'ю
закриті, бойовий домен відкритий, як і має бути.

**WEB-018 — `ib.account` переживає протермінування сесії.**
`clearSession()` (js/store.js:806-811) прибирає лише `ib.session`. Кеш
`ib.account` зі `status`, `username` і `isAdmin` лишається, тому після смерті
токена наступна людина за браузером може побачити посилання «Адмін-панель»
(js/account.js:213-215). Барʼєр серверний (`is_admin()` у кожному RPC), тож це
косметика, але кеш «хто я» не має переживати «я вже ніхто».

**Refresh-логіка — перевірено, тримається (позитивне спостереження).**
`ensureFresh()` (js/store.js:888-893) оновлює токен за 60 с до `expires_at`;
`doRefresh()` (js/store.js:860-886) розрізняє «мережі немає» (`e.offline` —
сесію НЕ чіпає) і «сервер відмовив» (`clearSession()` + `emit()`, дані
лишаються на місці). Паралельні виклики зливаються через змінну `refreshing`.
Один повтор 401 із оновленням токена є (js/store.js:678-684), 403 сесію не
знищує. Це саме та поведінка, якої бракує в `adoptUrlSession` (WEB-008).

**WEB-019 — весь сайт віддається з `X-Robots-Tag: noindex, nofollow`.**
При цьому в репозиторії є `sitemap.xml`, `robots.txt`, `og:*`-розмітка на
кожній сторінці й JSON-LD (WEB-007). Це не баг безпеки, а розходження між
наміром і конфігурацією; перетинається з доменом інвентаря/контенту.

**Спостереження про сторонній код у продакшені.** Стек подій `FORGE-2/3/4`
(`code@https://forge-mold1.vercel.app/nutrition.html:3:362`) вказує на код,
якого в репозиторії немає: у `nutrition.html` рядок 3 — це `<head>`. Safari
приписує документу код, впроваджений розширенням або власними функціями
браузера. Фільтр `IGNORE` у `js/errors.js:38` ловить лише `extension://` у
тексті помилки, тому такі події доходять до Sentry як «помилки Forge».

---

## Підсумок: що конкретно може зробити зловмисник з боку клієнта

1. **Посадити жертву у свій акаунт одним посиланням** (WEB-001) — і зібрати всі
   дані, які вона введе далі. Це найсерйозніше з знайденого.
2. **Виконати код у походженні сайту**, якщо контролює відповідь
   `elo_close_season` або має інший запис у `localStorage` (WEB-002), — а там
   лежить `ib.session` з `access_token` і `refresh_token`. CSP цього не спиняє
   (WEB-006), вивід у чужий проєкт Supabase дозволений (WEB-006).
3. **Прочитати пошту й дату народження попереднього користувача** на спільному
   пристрої після його виходу (WEB-003, WEB-004).
4. **Спалити посилання з листа**, якщо жертва відкриє його без мережі (WEB-008)
   — не атака, але той самий результат: людина не входить.

Чого зробити **не** вдалося, хоч і пробувалось:

- XSS через власний профіль (28 полів із payload-ами, 21 сторінка, кліки по
  всьому інтерактиву) — 0 спрацювань;
- XSS через штатний імпорт JSON — валідатор `validateImport` відкинув payload у
  19 із 24 полів за довжиною й форматом ключів, решта 5 ніде не рендериться без
  екранування;
- XSS через нік іншого користувача в таблиці лідерів — сервер обмежує набір
  символів і довжину, клієнт екранує;
- підміна `href`/`src` (`safeUrl`, js/app.js:35-42, ріже все, крім
  `http`/`https`/`mailto`);
- отримання чужої сесії з кешу service worker — кеш тримає лише статику свого
  походження;
- `eval`, `new Function`, `document.write`, `srcdoc`, `outerHTML` — у коді
  відсутні як клас.

---

## Таблиця синків (зведено)

Повний перелік — 125 входжень `innerHTML` + 1 `insertAdjacentHTML` у 23 файлах.
Нижче — зведення за файлами з класифікацією джерела даних; окремими рядками
винесено всі місця, де в розмітку потрапляє **неекранована** вставка.

| Файл | Синків | Джерело даних | Екранування | Вердикт |
|---|---|---|---|---|
| js/journal.js | 17 | власний профіль: назви вправ (`weightLog`, `sessionLog.ex[].n`), заголовки сесій, назви трекерів; числа | `esc()` на всіх текстах; числа — сирі | безпечно |
| js/season.js | 16 | сервер: `elo_leaderboard.name` (чужі ніки), `elo_recent.reason/day`, нагороди; `ib.eloReport` | ніки й тексти — `esc()`; **`ib.eloReport` — ні** | **WEB-002** |
| js/welcome.js | 15 | константи + власні поля форми (`state.acc.email`, `username`), `state.err` | `esc()` | безпечно |
| js/meals.js | 9 | довідник продуктів (константа), власні рецепти (`name`, `author`, `url`), назви прийомів | `esc()` + `safeUrl()` на `url` | безпечно |
| js/account.js | 9 | власний профіль, `e.message` помилок, статус акаунта | `esc()` | безпечно |
| js/app.js | 8 | константи навігації, `CFG.siteName`, рівень ELO | `esc()`; `levelIcon` приводить до числа | безпечно |
| js/measure.js | 7 | власні заміри (числа), підписи полів із `MeasureCore.FIELDS` | `esc()` | безпечно |
| js/programs.js | 6 | каталог програм (константа) + `customPlans` (назви вправ, днів, нотатки) | `esc()`, у т.ч. на `sets`/`reps` | безпечно |
| js/nutrition.js | 6 | числа розрахунку, константи | числа | безпечно |
| js/onerm.js | 5 | числа, `records` (числа) | числа | безпечно |
| js/admin-elo.js | 4 | **дані інших користувачів**: `username`, `email`, `userId`, аномалії | `esc()` на всьому, включно з атрибутами `id`/`data-uid` | безпечно |
| js/admin.js | 3 | **дані інших користувачів**: заявки — нік, пошта, скринінг, згоди | `esc()` на всьому | безпечно |
| js/trackers-settings.js | 3 | власні трекери: `t.name`, `t.id` в атрибутах | `esc()`; ключі трекерів додатково обмежені `^[A-Za-z0-9_-]{1,80}$` при імпорті | безпечно |
| js/projection.js | 3 | числа прогнозу | числа | безпечно |
| js/cardio.js | 3 | числа, константи `ZONES`, `goal.pmid` | числа/константи | безпечно |
| js/trackers-day.js | 2 | власні трекери | `esc()` (локальна обгортка над `App.esc`) | безпечно |
| js/supplements-view.js | 2 | довідник добавок (константа), `s.pmid` у `href` | `esc()` | безпечно |
| js/periodization.js | 2 | назви вправ із профілю, числа циклу | `esc()` | безпечно |
| js/workout.js | 1 + 1 `insertAdjacentHTML` | назви вправ, введені ваги/повтори | `esc()` | безпечно |
| js/today.js | 1 | склад із підфункцій, усі з `esc()` | `esc()` | безпечно |
| js/store.js | 1 | константний банер | — | безпечно |
| js/boxing.js | 1 | константні дані боксу | `esc()` | безпечно |
| js/bmi-core.js | 1 | константи `WARN`, число BMI | локальний `esc` (див. WEB-015) | безпечно |
| `*.html`, inline `<script>` | 22 блоки | `localStorage['forge.theme'/'forge.scheme']` | значення йде в `setAttribute`, а не в розмітку, і має починатись із `graphite` | безпечно |

Окремо:

| Місце | Вставка без `esc` | Джерело | Вердикт |
|---|---|---|---|
| js/season.js:305-313 | `rep.elo`, `rep.rank`, `rep.of`, `rep.percentile` | `ib.eloReport` ← RPC `elo_close_season` | **WEB-002** |
| js/season.js:281-292 | `s.elo`, `rep.daysActive`, `rep.daysTotal`, `rep.graceUsed`, `st.biggestGain`, `st.biggestLoss` | те саме | **WEB-002** |
| js/journal.js:283 | `t.val` | завжди число з `ProgressCore` | безпечно |
| js/app.js:526,843,1009 | `g.href`, `i.href` | константи `NAV_ITEMS`/`NAV_EDGE` | безпечно |
| js/today.js:350 | `href` | константа виклику | безпечно |
| js/app.js:1371 | `box.innerHTML = html` у `copyRich` (запасний шлях копіювання, вставляється в живий DOM) | `planToHtml`/`cycleToHtml`/`boxing` — усі три екранують | безпечно (ризик задокументовано в js/programs.js:947) |

