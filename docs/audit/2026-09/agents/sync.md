# Аудит 2026-09 — домен «Синхронізація, мережеві збої, конкурентність» (sync)

Автор: агент `sync`, Phase A (тільки читання).
Префікс знахідок: `SYN`.
Дата: 2026-09-06.

---

## Обсяг і метод

Розділ A6 технічного завдання (`docs/audit/2026-09/PROMPT.md`).

Метод:
1. Повне читання `js/store.js` (1726 рядків) — єдиного модуля, який ходить
   у Supabase, і всіх його викликів по репозиторію.
2. Читання `js/elo-api.js`, `js/elo-hooks.js` (друга незалежна черга),
   `js/account.js`, `js/welcome.js`, `js/workout.js` — місць, де мутуючі
   операції запускаються з UI.
3. Практичне відтворення в Playwright по `file://` з посадженим профілем
   (`tools/adult.mjs`) і `page.route()`, який імітує відповіді Supabase.
   Бойовий бекенд НЕ використовувався: усі запити перехоплені маршрутом.
4. Підрахунок мережевих запитів через лічильник у `page.route()`.

Заборонене (реєстрація, `verifyregister*`, стрес-тести, будь-які записи
в бойову базу) не виконувалось.

---

## Що перевірено

**Код.** `js/store.js` (1726 рядків) прочитано повністю. Усі місця, що
роблять `fetch`, знайдено `grep -rn "fetch(" js/ tools/`: три —
`js/store.js:621` (`req`), `js/store.js:1491` (`saveProfileBeacon`),
`js/errors.js:137` (конверт Sentry). Викликів `Store.saveProfile(`
за межами `store.js` — **32** у 20 файлах; викликів `Store.rpc(` — **20**
у 8 файлах; підписників `Store.onChange` — **13**.

**Браузерні проби.** 16 сценарних скриптів у `/tmp/audit-sync/`,
**57 окремих проб**, усі по `file://` з `page.route()`; жодного запиту в
бойовий Supabase (маршрут `/^https?:\/\/(?!127\.0\.0\.1|localhost)/`
у `tools/adult.mjs` обриває решту зовнішнього світу).

| Скрипт | Що перевіряє | Проб |
|---|---|---|
| `t1-matrix.mjs` | 11 відповідей сервера на запис профілю | 11 |
| `t2-beacon.mjs` | 5 відповідей на beacon-запис | 5 |
| `t3-loss.mjs` | повний ланцюг тихої втрати через beacon | 1 |
| `t4-hang.mjs` | запит без відповіді, блокування `saveChain` | 1 |
| `t5-dblclick.mjs` | подвійний клік (measure, workout) + 5 паралельних записів | 3 |
| `t6-foreign.mjs` | зміна акаунта на пристрої, `merge: 'foreign'` | 1 |
| `t7-signout.mjs` | залишки після `signOut`, «Відкотити імпорт» у чужому акаунті | 1 |
| `t8-authority.mjs` | авторитетність local ↔ cloud (4 випадки) | 4 |
| `t9-elo.mjs` | черга ELO при 500/429/400/403/офлайн + flush | 6 |
| `t10-interrupt.mjs` | вихід під час запиту, refresh під час запиту, дві вкладки | 3 |
| `t11-pendingleak.mjs` | чужий патч у черзі доїжджає в новий акаунт | 1 |
| `t12-get.mjs` | 10 відповідей на читання профілю + не-approved запис + мертва сесія | 12 |
| `t13-expired-chain.mjs` | втрата даних після смерті refresh-токена | 1 |
| `t14-session.mjs`, `t14b-session.mjs` | лок оновлення токена, сесія між вкладками, `adoptUrlSession` | 6 |
| `t15-grace.mjs` | подвійний клік на Grace Week (кнопка не відрендерилась) | 2 |

**Мутуючих запитів у бойову базу — 0.** SQL до бойової бази не
виконувався взагалі: домен не потребує серверних проб (серверна
ідемпотентність ELO — домени `db`/`elo`).

---

## Авторитетність local ↔ cloud — зведення (пункт 2 завдання)

| Ситуація | Хто виграє | Стан |
|---|---|---|
| Вхід, локально порожньо | хмара | правильно |
| Вхід, локально є, у хмарі порожньо | локальне (`'adopted'`, автоматично) | правильно |
| Вхід, непорожні обидва, через **account.html** | питає користувача (`confirm`) | працює, але `'foreign'` теж потрапляє сюди → **SYN-003** |
| Вхід, непорожні обидва, через **welcome.html** | хмара, мовчки | **SYN-007** (локальне зникає, UI відновлення немає) |
| Вибір «лишити дані акаунта» при непорожній черзі | локальне (всупереч вибору) | **SYN-008** |
| Читання: локальне новіше + черга/`dirty` | локальне, далі `flushPending` | правильно (js/store.js:1384-1391) |
| Читання: локальне новіше, БЕЗ черги/`dirty` | хмара, локальне затирається | **SYN-009** (правило навмисне, але робить SYN-001/014/015 незворотними) |
| Читання: хмарного рядка немає (`[]`) | локальне | правильно (js/store.js:1368-1371) |
| Читання: помилка хмари (401/403/404/500/битий JSON) | локальне | правильно (SYN-016) |
| Вихід (`signOut`) | стирає профіль, чергу, статус, власника, ключі ELO | **не стирає** `ib.profile.backup`, `forge.today`, `ib.meals.fold` → **SYN-006** |
| Втрата токена (401, відкликана сесія) | локальні дані лишаються | правильно й навмисно (js/store.js:789-811) |
| Зміна акаунта на пристрої | `enforceOwner` відкладає чужі дані | бар'єр є, але обходиться через `adoptLocalProfile` → **SYN-003** і через залишену чергу → **SYN-010** |
| Стара локальна проти новішої хмарної | хмара | правильно |
| Обрив посеред синхронізації (F5) | локальне + черга + `dirty` | правильно (SYN-013) |
| Повторна синхронізація (`flushPending`) | накладає патчі на поточний профіль, знімає рівно відправлене | правильно (js/store.js:958-986) |

---

## Знахідки

### SYN-001

```text
ID:                 SYN-001
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Тиха втрата даних / синхронізація
Location:           js/store.js:1458-1501 (Store.saveProfileBeacon),
                    js/account.js:663-682 (flushSave на pagehide/visibilitychange)
```

**Description.** `saveProfileBeacon` шле власний `fetch` повз `req()` і
обробляє тільки *відхилення* промісу (`.catch(… pendingPush …)`).
`fetch` відхиляється лише при мережевій помилці; **HTTP 401/403/429/5xx
резолвляться нормально**, тому гілка `.catch` не виконується. У результаті
запис у хмару не відбувся, а слідів немає жодних:
черга `ib.pending` порожня, позначка `ib.profile.dirty` не поставлена
(beacon не викликає `pushToCloud`, отже й `markDirty`), помилка нікому не
повертається (метод повертає лише результат запису в `localStorage`).

Далі спрацьовує друге правило: `getProfile` (js/store.js:1384-1392) віддає
перевагу локальній копії **лише** якщо `pendingGet().length || isDirty()`.
Обидві умови хибні — і локальна копія затирається старішим хмарним рядком
(`lsSet(LS_PROFILE, cache)`, js/store.js:1405).

**Why it matters.** Це саме той шлях, заради якого beacon і писався:
«вписав вагу й одразу пішов на іншу сторінку» (коментар у
js/account.js:663-677). Найімовірніша причина 401 тут — прострочений
access_token: beacon **не викликає `ensureFresh()`** взагалі, тож вкладка,
що пролежала понад годину, шле запит із мертвим токеном. Користувач бачить
нове значення в полі, потім переходить на іншу сторінку — і значення
зникає без жодного повідомлення.

**Reproduction** (`/tmp/audit-sync/t3-loss.mjs`, Playwright, `file://`,
бойовий бекенд не задіяний — усе через `page.route`):

1. `adultContext` (посаджений профіль, вага 82, сесія approved).
2. `route('/rest/v1/profiles')`: GET → `[{data:{…, weight:82,
   updatedAt:'2026-09-01T10:00:00.000Z'}}]`, POST → `500`.
3. `Store.saveProfileBeacon({ weight: 66.6 })`.
4. Перезавантажити `account.html`, викликати `Store.getProfile()`.

**Observed.**
```json
"afterBeacon": { "weight": 66.6, "pending": 0, "dirty": false }
"afterReload": { "profileWeight": 82, "lsWeight": 82,
                 "updatedAt": "2026-09-01T10:00:00.000Z" }
```
POST-запитів: 1. Помилок не кинуто, тостів не показано.

Та сама проба для 401 і 403 (`/tmp/audit-sync/t2-beacon.mjs`):
`pending: 0, dirty: false` — тобто змін ніде не зафіксовано.
Контроль: `abort` (мережі немає) → `pending: 1` — цей шлях працює правильно.

**Expected.** Невдалий beacon-запис (будь-який `!res.ok`) має класти патч у
`ib.pending` і/або лишати `ib.profile.dirty`, як це робить звичайний
`doSave` через `pushToCloud`.

**Root cause.** `fetch` не відхиляється на HTTP-помилках; перевірки
`res.ok` в beacon-гілці немає, `markDirty()` теж (він живе всередині
`pushToCloud`, який beacon обходить).

**Impact.** Тиха втрата будь-якої зміни профілю, зробленої безпосередньо
перед переходом/згортанням вкладки: вага, зріст, ціль, робочі ваги —
усе, що йде через `flushSave()` в js/account.js.

**Recommended fix.** У `saveProfileBeacon`: `markDirty()` перед відправкою
і зняття лише в `.then(res => { if (res.ok) clearDirty(); else
pendingPush(patch); })`; `.catch` лишити як є. Мінімальний варіант —
просто `markDirty()` без `clearDirty()`: тоді локальна копія виграє
наступного разу, і дані не зникнуть (ціною зайвого запису).

**Regression test.** Браузерна перевірка `verifybeacon.mjs`: маршрут
POST `/rest/v1/profiles` → 500, виклик `saveProfileBeacon`, перевірка
`ib.pending.length === 1 || ib.profile.dirty`; після перезавантаження зі
старішим хмарним рядком — `profile.weight` дорівнює локально записаному.

---

### SYN-002

```text
ID:                 SYN-002
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Мережа / надійність
Location:           js/store.js:1458-1501 (saveProfileBeacon), js/store.js:889-894 (ensureFresh)
```

**Description.** `saveProfileBeacon` — єдиний мутуючий запис, який не
проходить через `ensureFresh()`. Він бере `session.access_token` як є,
навіть якщо `session.expires_at` уже в минулому.

**Reproduction.** Читання коду: у `doSave` (js/store.js:1560) і в
`api.rpc` (js/store.js:1071) стоїть `await ensureFresh()`; у
`saveProfileBeacon` (js/store.js:1458-1501) його немає — між
`const current = cache || readLocalProfile()` і `fetch(...)` жодної
перевірки строку життя токена. `authHeaders(true)` (js/store.js:570)
підставляє `session.access_token` без перевірки.

**Observed.** Запит із простроченим токеном іде на сервер і отримує 401.
**Expected.** Або оновлення токена (неможливе синхронно на `pagehide`),
або постановка патча в чергу, коли токен уже прострочений.

**Impact.** Разом із SYN-001 дає найчастіший реальний сценарій тихої
втрати: вкладка полежала більше години → людина вписала вагу → перейшла
на іншу сторінку → 401 → дані зникли.

**Recommended fix.** У `saveProfileBeacon`, якщо
`Date.now() >= session.expires_at`, одразу `pendingPush(patch)` замість
приреченого запиту.

**Regression test.** Сесія з `expires_at` у минулому + `saveProfileBeacon`
→ мережевого запиту немає, `ib.pending.length === 1`.

---

### SYN-003

```text
ID:                 SYN-003
Severity:           CRITICAL
Confidence:         CONFIRMED
Category:           Змішування даних різних акаунтів / втрата даних
Location:           js/account.js:286-311 (handleMerge),
                    js/store.js:1311-1318 (adoptLocalProfile),
                    js/store.js:771-787 (enforceOwner), js/store.js:1616-1657 (resolveFirstLogin)
```

**Description.** `enforceOwner()` правильно розпізнає, що локальний профіль
належав іншому користувачеві, відкладає його в окремий слот
`ib.profile.backup.login` (разом із полем `owner`) і повертає
`resolveFirstLogin` код `'foreign'`.

Але `handleMerge` у js/account.js обробляє окремо тільки `'adopted'`:

```js
async function handleMerge(merge) {
  if (!merge) return;
  if (merge === 'adopted') { toast(...); return; }
  const keepLocal = confirm('В акаунті вже є збережені дані, і в цьому браузері теж. …');
  if (keepLocal) { await Store.adoptLocalProfile(); … }
```

Отже `'foreign'` потрапляє в ту саму гілку, що й `'conflict'`. А
`adoptLocalProfile()` читає саме `ib.profile.backup.login` — тобто
профіль ПОПЕРЕДНЬОГО користувача — і пише його в рядок нового:

```js
const local = lsGet(LS_BACKUP_LOGIN, null);
cache = migrate(Object.assign(blankProfile(), local), local);
return api.saveProfile({});
```

**Why it matters.** Дані користувача A (журнал ваги тіла, робочі ваги,
нік, історія) потрапляють в акаунт користувача B і одночасно **знищують**
хмарний рядок B. Текст діалогу при цьому стверджує, що це «дані з цього
браузера», тобто дані самого B — розпізнати підміну людина не може.

**Reproduction** (`/tmp/audit-sync/t6-foreign.mjs`, Playwright, `file://`,
уся мережа замокана через `page.route`):

1. `adultContext`; у сховищі — профіль A (`weight: 95`,
   `bodyLog {2026-08-01:95, 2026-08-02:94}`, `displayName 'A'`),
   `ib.profile.owner = <A>`, сесії немає (як після 401 —
   `clearSession()` навмисно лишає `ib.profile`).
2. `route('/auth/v1/token')` → сесія користувача B (`<B>`);
   `route('/rest/v1/rpc/account_state')` → `approved`;
   `route(GET /rest/v1/profiles)` → непорожній рядок B (`weight: 60`).
3. `Store.signIn('b@example.test', …)` → `merge === 'foreign'` (перевірено).
4. Виконати те, що робить `handleMerge` при натисканні OK у confirm:
   `await Store.adoptLocalProfile()`.

**Observed.** Перехоплений POST у `/rest/v1/profiles`:
```json
{ "user_id": "00000000-0000-4000-8000-00000000000B",
  "weight": 95, "displayName": "A",
  "bodyLog": { "2026-08-01": 95, "2026-08-02": 94 },
  "owner": "00000000-0000-4000-8000-00000000000A" }
```
(`owner` і `savedAt` — службові поля слота резервної копії — теж
поїхали в профіль B: `extraKeys: ["savedAt","owner"]`.)
`Store.getProfile()` після цього повертає `weight: 95, displayName: 'A'`.

**Expected.** При `merge === 'foreign'` жодного діалогу «взяти дані з цього
браузера» бути не має: локальні дані належать іншій людині. Максимум —
повідомлення «у цьому браузері лишались дані іншого акаунта, вони
відкладені».

**Root cause.** Дві причини накладаються: (1) `handleMerge` не має гілки
для `'foreign'`; (2) `adoptLocalProfile` бере дані зі слота, у який
`enforceOwner` кладе саме ЧУЖИЙ профіль, і не звіряє `local.owner` з
`session.user.id`.

**Impact.** Спільний пристрій (сім'я, зал, робочий комп'ютер): дані одного
користувача видно другому і вони затирають його власні хмарні дані.
Відновити рядок B нічим — резервної копії хмарного рядка немає.

**Recommended fix.** У `handleMerge` — окрема гілка `merge === 'foreign'`
без пропозиції злиття. У `adoptLocalProfile` — перевірка
`if (local.owner && local.owner !== session.user.id) throw …` і видалення
службових полів `owner`/`savedAt` перед записом.

**Regression test.** Юніт/браузерна перевірка: посіяти `ib.profile.owner`
= X, увійти як Y, переконатись, що `signIn` повертає `'foreign'`, а
`adoptLocalProfile()` кидає помилку і жодного POST у `/rest/v1/profiles`
не робить.

---

### SYN-004

```text
ID:                 SYN-004
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Мережа / застрягання UI
Location:           js/store.js:615-696 (req), js/store.js:941-944 (queueWrite), js/store.js:1027 (saveChain)
```

**Description.** У `req()` немає ні `AbortController`, ні таймауту.
Запит, який сервер прийняв і не відповідає (типова поведінка при
перевантаженні, «мертвому» мобільному з'єднанні, проксі), висить
необмежено. Оскільки всі записи стоять в один ланцюг
`saveChain` (`queueWrite`), один такий запит блокує **всі** наступні
збереження цієї вкладки назавжди.

**Reproduction** (`/tmp/audit-sync/t4-hang.mjs`):
маршрут на POST `/rest/v1/profiles` не викликає ні `fulfill`, ні `abort`.

**Observed.**
```json
{ "posts": 1,
  "hang":   { "race": "pending", "ms": 8000 },
  "second": "pending" }
```
Перша обіцянка `Store.saveProfile` не резолвиться й не реджектиться за 8 с;
другий виклик `Store.saveProfile` теж лишається в підвішеному стані.

**Expected.** Мережевий запит має мати верхню межу (напр. 20–30 с), після
якої патч іде в чергу `ib.pending` і UI дістає помилку з `.queued`.

**Impact.** Сторінки, які тримають прапорець зайнятості до завершення
`await Store.saveProfile(...)`, застрягають назавжди:
`js/measure.js:203` (`state.busy = true` до `:232`, кнопка «Зберегти»
рендериться з `disabled` при `state.busy`),
`js/welcome.js:259-272` та інші кроки онбордингу (`state.busy`),
`js/account.js:321-335` (кнопки форми входу `disabled = true` до `finally`).
Єдиний вихід для людини — перезавантажити сторінку, при цьому те, що вона
щойно ввела, у хмару не доїхало.

**Root cause.** `fetch` без `signal: AbortSignal.timeout(...)`.

**Recommended fix.** У `req()` — `AbortSignal.timeout(N)` (наявний у всіх
цільових браузерах; для `keepalive`-запиту таймаут не потрібен) і трактування
`AbortError` як офлайну (`err.offline = true`), щоб патч ліг у чергу.

**Regression test.** Браузерна перевірка з маршрутом, який не відповідає:
`Store.saveProfile` має відхилитись із `.queued === true` протягом
таймауту, а `ib.pending.length === 1`.

---

### SYN-005

```text
ID:                 SYN-005
Severity:           INFO (перевірено — дефекту немає)
Confidence:         CONFIRMED
Category:           Конкурентність / подвійний клік
Location:           js/measure.js:162,203; js/workout.js:283-307; js/store.js:1027-1031
```

Подвійний і потрійний клік на кнопках збереження **не** дублює запис.

**Reproduction** (`/tmp/audit-sync/t5-dblclick.mjs`, затримка відповіді 700 мс):
- `measure.html`: «+ Новий замір» → вага 81,5 → три `click()` поспіль по
  `#ms-save` → **1** POST (`state.busy` тримає повторний виклик).
- `workout.html`: три `click()` по `#wk-finish` (діалог приймається
  автоматично) → **1** POST; `sessionLog` містить один запис на день.
- П'ять паралельних `Store.saveProfile({weight: 70..74})` → 5 послідовних
  POST, підсумковий локальний профіль `weight: 74` — тобто ланцюг
  `saveChain` не губить патчі всередині вкладки.

---

### SYN-006

```text
ID:                 SYN-006
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Змішування даних різних акаунтів / залишки після виходу
Location:           js/store.js:821-828 (clearIdentityData), js/account.js:584,599-606,1652-1672,
                    js/store.js:1512-1527 (clearLocal — для порівняння)
```

**Description.** Явний вихід (`signOut → clearIdentityData`) прибирає
`ib.profile`, `ib.pending`, `ib.account`, `ib.profile.owner`,
`ib.profile.backup.login`, ключі ELO і `ib.profile.dirty`. У списку
**немає** `ib.profile.backup` — доімпортної резервної копії ПОВНОГО
профілю, — а також `forge.today` і `ib.meals.fold`. Той самий модуль знає
про них: вони перелічені в `clearLocal()` (js/store.js:1519-1521).

Кнопка «Відкотити імпорт» (js/account.js:584) рендериться щоразу, коли
`ib.profile.backup` існує, і її обробник (js/account.js:1652-1672) робить
`Store.saveProfile(restore)` — тобто пише вміст цього ключа в **хмарний
рядок того, хто зараз увійшов**.

**Reproduction** (`/tmp/audit-sync/t7-signout.mjs`):

1. Стан «користувач A працював і колись імпортував профіль»:
   `ib.profile` (weight 95, displayName A, bodyLog), `ib.profile.owner=<A>`,
   `ib.profile.backup` = копія профілю A, `forge.today`, `ib.meals.fold`,
   сесія A.
2. `await Store.signOut()`.
3. `await Store.signIn('b@example.test', …)` (маршрут `/auth/v1/token`
   повертає користувача B, GET профілю — непорожній рядок B).
4. Виконати те, що робить обробник `#p-restore`:
   `Store.saveProfile(backupBezSavedAt)`.

**Observed.**
```json
"afterSignOut": { "keys": ["forge.today","ib.cloud","ib.meals.fold","ib.profile.backup"] }
"restored":     { "weight": 95, "displayName": "A", "bodyLog": {"2026-08-01":95} }
"postedRows":   [[{ "user_id": "…000B", "weight": 95, "displayName": "A" }]]
```

**Expected.** Після виходу в браузері не має лишатись ані профілю
попереднього користувача (у будь-якому слоті), ані його стану тренування
(`forge.today` — позначені підходи й обраний день).

**Root cause.** Розбіжність двох списків ключів: `clearLocal()` повний,
`clearIdentityData()` — ні.

**Impact.** (1) Наступний користувач за спільним пристроєм бачить кнопку
«Відкотити імпорт» і одним кліком заливає профіль попередника у свій
акаунт, знищуючи власні хмарні дані; (2) `forge.today` показує йому
позначені підходи попередника ще до входу.

**Recommended fix.** Додати `LS_BACKUP`, `'forge.today'`, `'ib.meals.fold'`
(і стару назву `'ib.meals.folds'`) до списку в `clearIdentityData()`; або
звести обидва списки в одну константу. Додатково — прив'язати
`ib.profile.backup` до власника так само, як `ib.profile.backup.login`.

**Regression test.** Браузерна перевірка: посіяти всі ключі, викликати
`Store.signOut()`, перевірити, що з `localStorage` лишились тільки
`ib.cloud` і `ib.remember`.

---

### SYN-007

```text
ID:                 SYN-007
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Тиха втрата даних / авторитетність local ↔ cloud
Location:           js/welcome.js:703-720 (doLogin), :762-766, :868 —
                    результат Store.signIn відкидається;
                    js/store.js:1616-1657 (resolveFirstLogin), js/store.js:1393-1406
```

**Description.** `Store.signIn` повертає `{ user, merge }`, де
`merge === 'conflict'` означає «непорожні і локальні, і хмарні дані —
вибір за людиною». `js/account.js` цей код обробляє (діалог), а
**`js/welcome.js` — ні**: у всіх трьох місцях результат `signIn`
не присвоюється (`await window.Store.signIn(...)` і одразу
`routeAfterAuth()`). `resolveFirstLogin` при `'conflict'` робить
`cache = null`, після чого перший же `getProfile()` бере хмарний рядок і
дзеркалить його в `localStorage` (js/store.js:1405), затираючи локальну
роботу.

**Why it matters.** `welcome.html` — головний вхід у застосунок
(з `account.html` кнопка реєстрації прибрана навмисно, див. коментар у
js/account.js). Тобто типовий шлях входу — саме той, де питання не
ставиться.

**Reproduction** (`/tmp/audit-sync/t8-authority.mjs`, випадок A):
локальний профіль (`weight 95`, 1 рецепт, `updatedAt 2026-09-06`),
хмарний рядок (`weight 60`, 0 рецептів, `updatedAt 2026-09-01`),
черга порожня, `dirty` знято → `Store.signIn(...)`, далі `getProfile()`.

**Observed.**
```json
{ "merge": "conflict", "profileWeight": 60, "profileRecipes": 0,
  "lsWeight": 60, "backupLoginWeight": 95, "backupImport": false }
```
Локальні дані зникли з `ib.profile` без жодного запитання.

**Чому це не «просто резервна копія».** Копія справді лежить у
`ib.profile.backup.login`, але **жоден елемент інтерфейсу її не читає**:
кнопка «Відкотити імпорт» дивиться в інший ключ — `ib.profile.backup`
(у пробі `backupImport: false`), а `Store.adoptLocalProfile()`
викликається лише з діалогу `handleMerge`, який на `welcome.html` не
показується. Копія не потрапляє й в експорт JSON (він віддає
`Store.getProfile()`).

**Expected.** `welcome.js` має обробляти `merge` так само, як
`account.js` (діалог вибору), або принаймні показувати повідомлення й
шлях до відновлення.

**Recommended fix.** Винести `handleMerge` в спільний модуль і викликати
його в обох місцях входу; додати в акаунт кнопку відновлення саме зі
слота `ib.profile.backup.login`.

**Regression test.** Браузерна перевірка входу з welcome.html при
непорожніх обох сторонах: або показано діалог, або локальні дані лишились
відновлюваними через UI.

---

### SYN-008

```text
ID:                 SYN-008
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Втрата даних / рішення користувача ігнорується
Location:           js/store.js:1321-1324 (discardLocalProfile), js/store.js:1384-1391 (getProfile),
                    js/store.js:946-987 (flushPending)
```

**Description.** `discardLocalProfile()` («Скасувати» в діалозі —
«лишити дані АКАУНТА») робить лише `cache = null; emit();`. Він **не
чистить** ані чергу `ib.pending`, ані позначку `ib.profile.dirty`, ані сам
`ib.profile`. Тому наступний `getProfile()` спрацьовує за правилом
«локальна копія новіша + є незіслані патчі» і повертає саме локальний
профіль, який людина щойно попросила не брати. Гірше — `flushPending()`
з тієї ж гілки досилає локальні патчі в хмару й затирає там дані, які
людина обрала зберегти.

**Reproduction** (`/tmp/audit-sync/t8-authority.mjs`, випадок B):
локальний профіль `weight 95` (`updatedAt 2026-09-06`), хмарний `weight 60`
(`updatedAt 2026-09-01`), `ib.pending = [{patch:{weight:95}}]`,
`ib.profile.dirty` виставлено → `signIn` → `merge === 'conflict'` →
`Store.discardLocalProfile()` → `getProfile()`.

**Observed.**
```json
{ "merge": "conflict", "afterDiscardWeight": 95, "lsWeight": 95,
  "posted": [[95]] }
```
Тобто після явного «лишити дані акаунта» застосунок показує локальні дані,
а в хмару відправлено POST з `weight: 95` — хмарні дані знищено.

**Expected.** `discardLocalProfile()` має відкинути локальну сторону
цілком: очистити `ib.pending`, зняти `ib.profile.dirty` і `ib.profile`
(копія вже лежить у `ib.profile.backup.login`).

**Impact.** Класичний сценарій: людина працювала офлайн на телефоні,
потім увійшла в браузері й свідомо обрала дані акаунта — і саме цим
кліком знищила їх.

**Recommended fix.**
```js
discardLocalProfile: function () {
  cache = null;
  try { localStorage.removeItem(LS_PENDING); } catch (_) {}
  clearDirty();
  try { localStorage.removeItem(LS_PROFILE); } catch (_) {}
  emit();
}
```

**Regression test.** Юніт/браузер: `ib.pending` непорожня + dirty →
`discardLocalProfile()` → `pendingCount() === 0`, `getProfile()` віддає
хмарний профіль, POST у `/rest/v1/profiles` не зроблено.

---

### SYN-009

```text
ID:                 SYN-009
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Авторитетність local ↔ cloud
Location:           js/store.js:1384-1406 (getProfile)
```

**Description.** Правило вибору сторони таке: локальна копія виграє
**лише** якщо (`pendingGet().length || isDirty()`) І `local.updatedAt >
remote.updatedAt`. Сам по собі новіший `updatedAt` не важить нічого.

**Reproduction** (`/tmp/audit-sync/t8-authority.mjs`, випадок C):
локальний профіль `updatedAt 2026-09-06T09:00`, хмарний `2026-09-01T10:00`,
черга порожня, `dirty` знято.
**Observed.** `{ "weight": 60, "updatedAt": "2026-09-01T10:00:00.000Z",
"recipes": 0 }` — новіша локальна копія затерта старішою хмарною,
включно з `lsSet(LS_PROFILE, cache)`.

**Why it matters.** Само по собі це навмисне (хмара — джерело правди), але
воно робить будь-яку діру в позначках `dirty`/`pending` **невідворотною
втратою**: SYN-001 (beacon без `markDirty`) і будь-який запис при
`cloudAllowed() === false` не лишають жодного сліду, і саме це правило
довершує втрату.

**Контроль (працює правильно):** випадок D — хмарного рядка немає (GET
повертає `[]`) → `getProfile()` віддає локальний профіль
(`weight: 95, recipes: 1`), локальні дані не затираються.

**Recommended fix.** Не змінювати саме правило, а прибрати діри в
позначках (SYN-001, SYN-013). Додатково варто розглянути: якщо
`local.updatedAt > remote.updatedAt` більш ніж на кілька секунд, а
позначок немає — не мовчати, а хоча б лишити локальну копію в
`ib.profile.backup.login`.

---

### SYN-010

```text
ID:                 SYN-010
Severity:           CRITICAL
Confidence:         CONFIRMED
Category:           Змішування даних різних акаунтів (без жодної дії користувача)
Location:           js/store.js:1298-1306 (signOut), js/store.js:821-828 (clearIdentityData),
                    js/store.js:1533-1542 (queuedError → pendingPush),
                    js/store.js:1704-1721 (відновлення сесії, подія online)
```

**Description.** `signOut()` не координований із ланцюгом записів
`saveChain`. Якщо людина натискає «Вийти», поки мутуючий запит ще в
польоті, і цей запит потім падає з мережевою помилкою, `doSave` виконує
`queuedError(patch, …)` → `pendingPush(patch)` — тобто **записує
`ib.pending` вже ПІСЛЯ того, як `clearIdentityData()` його стер**.
`ib.profile.owner` при цьому теж стертий, тож `enforceOwner()` при
наступному вході не бачить нічого підозрілого і чергу не чистить.

Далі `flushPending()` викликається сам: при відновленні сесії
(js/store.js:1714), на подію `online` (:1719-1721) і після кожного
успішного збереження (:1578-1580). Патч попереднього користувача
накладається на профіль нового і йде в **його** хмарний рядок.

**Reproduction** (`/tmp/audit-sync/t11-pendingleak.mjs`, уся мережа
замокана `page.route`):

1. Сесія A. Маршрут POST `/rest/v1/profiles` тримає запит 400 мс і
   потім `abort('failed')`.
2. `Store.saveProfile({ weight: 99, displayName: 'Секрет A' })` — не чекаємо.
3. Через 150 мс — `Store.signOut()`.
4. Маршрут POST переводимо в 204; `Store.signIn('b@example.test', …)`
   (`/auth/v1/token` повертає користувача B, `account_state` — approved,
   GET профілю — непорожній рядок B з `weight: 60, displayName: 'B'`).
5. `Store.flushPending()` (у житті викликається сам).

**Observed.**
```json
"afterOut": { "pending": 1, "patch": {"weight":99,"displayName":"Секрет A"},
              "owner": null }
"afterIn":  { "weight": 99, "displayName": "Секрет A", "pendingLeft": 0 }
"posted":   [{ "user_id": "…000B", "weight": 99, "displayName": "Секрет A" }]
```

**Expected.** Після виходу в браузері не має лишатись жодного патча
попереднього користувача; черга має бути підписана власником так само, як
це зроблено в `js/elo-api.js` (`item.uid`, js/elo-api.js:65-75, і перевірка
при досиланні :90).

**Root cause.** Гонка між `signOut()` (поза `saveChain`) і
`queuedError()` (усередині ланцюга) плюс відсутність підпису власника в
елементах `ib.pending`.

**Impact.** Дані одного користувача автоматично, без жодного діалогу,
потрапляють в акаунт іншого й затирають там власні дані. На спільному
пристрої цього достатньо, щоб вигадана «вага 99» і нік попередника
опинились у чужому профілі й у таблиці лідерів.

**Recommended fix.** (1) Підписувати кожен елемент черги
`uid: session.user.id` і в `doFlushPending` пропускати чужі (як у
elo-api.js); (2) `signOut()` — `await saveChain` перед
`clearIdentityData()` (або прапорець «виходимо», який забороняє
`pendingPush`).

**Regression test.** Браузерна перевірка: запустити `saveProfile`, який
падає, викликати `signOut()` до його завершення, перевірити, що
`Store.pendingCount() === 0`; після входу іншим користувачем — жодного
POST із чужим патчем.

---

### SYN-011

```text
ID:                 SYN-011
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Конкурентність / втрачене оновлення між вкладками
Location:           js/store.js:1015-1027 (коментар про saveChain), js/store.js:1544-1546 (doSave),
                    js/store.js:1674-1702 (слухач storage)
```

**Description.** Патчі — це цілі значення полів (`{bodyLog: {…весь журнал…}}`,
`{sessionLog: …}`, `{trackerLog: …}`, `{weights: …}`). Дві вкладки, які
прочитали профіль до того, як хоч одна записала, будують свій обʼєкт із
однакової бази — і другий запис затирає перший цілком. Слухач `storage`
(js/store.js:1699-1701) приходить уже після того, як обидві вкладки
порахували свої версії.

Коментар у js/store.js:1015-1026 стверджує, що ланцюг `saveChain`
«прибирає це всередині вкладки», а між ПРИСТРОЯМИ лишається
last-write-wins. Проба показує, що між **вкладками одного браузера**
втрата теж відбувається.

**Reproduction** (`/tmp/audit-sync/t10-interrupt.mjs`, випадок C):
дві вкладки `journal.html` в одному контексті; кожна робить
`getProfile()`, додає СВІЙ день у `bodyLog` і зберігає.

**Observed.**
```json
"C_posted":  [ {"2026-09-02": 81}, {"2026-09-01": 80} ]
"C_two_tabs": { "bodyLog": { "2026-09-01": 80 } }
```
Запис `2026-09-02: 81` зник і локально, і в хмарі (останній POST його не
містить).

**Expected.** Або злиття на рівні полів-журналів, або хоча б перечитування
профілю безпосередньо перед побудовою патча.

**Impact.** Дві відкриті вкладки — звичайна ситуація на телефоні
(«Сьогодні» + «Тренування»). Втрачаються записи журналів: вага тіла,
сесії, трекери.

**Recommended fix.** Мінімальна зміна без нової схеми: у `doSave`
приймати патч-**функцію** для журнальних полів (merge на актуальному
`current`), або в сторінках будувати патч зі свіжого
`await Store.getProfile()` всередині ланцюга, а не з `state`, знятого при
завантаженні. Повне рішення (версія рядка й перевірка при записі)
вимагає зміни схеми — це окреме рішення.

**Regression test.** Дві сторінки в одному контексті, кожна пише свій
ключ у `bodyLog`; після обох записів у профілі мають бути обидва ключі.

---

### SYN-012

```text
ID:                 SYN-012
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Втрата подій рейтингу при збоях сервера
Location:           js/elo-api.js:138-155 (submit), js/elo-api.js:77-107 (flush)
```

**Description.** У чергу `ib.eloPending` подія стає **лише** при
`e.offline || e.noauth`. Будь-яка інша помилка (`500`, `429`, `400`, `403`)
призводить до `return null` — подія нікуди не записується. Симетрично, у
`flush()` `catch` без ознаки `offline` викликає `drop(item.key)`, тобто
**видаляє подію з черги назавжди** — включно з випадком 429, де повтор
якраз має сенс.

**Reproduction** (`/tmp/audit-sync/t9-elo.mjs`):
маршрут `/rest/v1/rpc/elo_submit` віддає задані статуси.

**Observed.**
```json
"A_submit_500": { "res": null, "queue": 0 }
"A_submit_429": { "res": null, "queue": 0 }
"A_submit_400": { "res": null, "queue": 0 }
"A_submit_403": { "res": null, "queue": 0 }
"A_submit_offline": { "res": null, "queue": 1 }     ← контроль, працює
"B_flush_500": { "before": 1, "after": 0 }          ← подію з черги видалено
```

**Часткове помʼякшення.** `js/elo-hooks.js:151-161` при `!res` НЕ ставить
позначку `ib.eloSent`, тож подію буде подано знову — але лише поки день
потрапляє у вікно `collect()` (останні 3 дні, js/elo-hooks.js:77) і поки
його приймає серверне вікно `submitWindowDays`. Збій сервера, довший за це
вікно, означає остаточну втрату нарахування; для події, яка вже лежала в
черзі з офлайну (випадок B), достатньо одного 5xx під час досилання.

**Expected.** 5xx і 429 — тимчасові: подія має лишатись у черзі
(з обмеженням кількості спроб). Остаточно прибирати варто лише 4xx, що
означають «сервер відмовив по суті» (`out_of_window`, `limit`).

**Recommended fix.** У `submit` — класти в чергу при `!e.status ||
e.status >= 500 || e.status === 429`. У `flush` — `drop` лише коли
`e.status >= 400 && e.status < 500 && e.status !== 429`; `break` на 5xx/429.

**Regression test.** Юніт/браузер: `elo_submit` → 500 → `ib.eloPending`
містить подію; `flush` при 500 не спорожнює чергу.

---

### SYN-013

```text
ID:                 SYN-013
Severity:           INFO (перевірено — дефекту немає)
Confidence:         CONFIRMED
Category:           Переривання посеред запиту
Location:           js/store.js:1544-1610 (doSave)
```

**Refresh (F5) під час мутуючого запиту** втрати не спричиняє.
Проба `/tmp/audit-sync/t10-interrupt.mjs`, випадок B: POST тримається
60 с, через 400 мс — `page.reload()`, у хмарі лежить старіший рядок
(`weight 82`). Після перезавантаження:
```json
{ "weight": 71.5, "pending": 1, "dirty": true }
```
Локальний запис зроблено ДО мережевого (js/store.js:1562-1564), позначку
`ib.profile.dirty` виставлено в `pushToCloud` і не знято — тому
`getProfile()` віддає перевагу локальній копії. Патч додатково лежить
у черзі.

---

### SYN-014

```text
ID:                 SYN-014
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Тиха втрата даних / сесія
Location:           js/store.js:1544-1610 (doSave), рядки 1560 і 1566;
                    js/store.js:860-887 (doRefresh → clearSession)
```

**Description.** У `doSave` та сама умова перевіряється двічі:

```js
let fresh = true;
if (CLOUD && session && cloudAllowed()) fresh = await ensureFresh();   // :1560
…
if (CLOUD && session && cloudAllowed()) {                              // :1566
  if (!fresh) throw queuedError(patch, 'Сесія прострочена …');
```

Якщо оновлення токена провалилось **не через мережу** (Supabase відповідає
`400 invalid_grant / Already Used` на повторно використаний ротований
refresh-токен — сценарій, описаний у коментарі js/store.js:849-856),
`doRefresh` викликає `clearSession()`, який ставить `session = null`.
Тому друга перевірка на рядку 1566 **хибна**, увесь блок роботи з хмарою
пропускається — разом із `throw queuedError(...)` — і `doSave`
повертає `next` як успіх.

Це відновлення саме тієї діри, яку коментар js/store.js:1424-1432
оголошує закритою: «ensureFresh() повернув false → гілка POST просто не
виконувалась, і функція резолвилась успішно».

**Reproduction** (`/tmp/audit-sync/t13-expired-chain.mjs`):

1. Сесія з `expires_at` у минулому; маршрут `/auth/v1/token` з
   `grant_type=refresh_token` → `400 {"error":"invalid_grant"}`;
   GET `/rest/v1/profiles` → рядок `weight 82, bodyLog {2026-09-01:82},
   updatedAt 2026-09-01`.
2. `await Store.saveProfile({ weight: 88 })` і
   `await Store.saveProfile({ bodyLog: { '2026-09-06': 88 } })`.
3. `Store.signIn(...)` (повторний вхід), далі `getProfile()`.

**Observed.**
```json
"work": { "saves": ["ok","ok"], "pending": 0, "dirty": false,
          "lsWeight": 88, "lsBodyLog": {"2026-09-06":88} }
"posts": 0
"back": { "merge": "conflict", "weight": 82, "bodyLog": {"2026-09-01":82} }
```
Жодного POST у хмару, жодної помилки в UI («Збережено»), жодної позначки —
і після повторного входу вся робота замінена старими хмарними даними.
Друга проба (`/tmp/audit-sync/t12-get.mjs`, `expired_session`) дає те саме:
`err: null, pending: 0, posts: 0`.

**Expected.** `doSave` має кинути `queuedError` (з `.queued`) і покласти
патч у `ib.pending`, як обіцяє його власний коментар.

**Root cause.** Побічний ефект `ensureFresh()` (обнулення `session`)
змінює умову між двома її перевірками.

**Recommended fix.** Зафіксувати рішення до виклику:
```js
const wantCloud = CLOUD && !!session && cloudAllowed();
let fresh = true;
if (wantCloud) fresh = await ensureFresh();
…
if (wantCloud) { if (!fresh || !session) throw queuedError(patch, '…'); … }
```

**Regression test.** Браузерна перевірка: прострочена сесія +
`/auth/v1/token` → 400 → `Store.saveProfile` має відхилитись із
`.queued === true`, `Store.pendingCount() === 1`.

---

### SYN-015

```text
ID:                 SYN-015
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Тиха втрата даних / статус акаунта
Location:           js/store.js:844-847 (cloudAllowed), js/store.js:1566-1589 (doSave),
                    js/store.js:1088-1098 (refreshAccountState)
```

**Description.** Коли `cloudAllowed()` хибний (кеш `ib.account` не
`approved` або відсутній), `doSave` тихо пропускає всю хмарну гілку:
запис іде лише в `localStorage`, помилки немає, `ib.pending` порожня,
`ib.profile.dirty` не ставиться. Тобто `saveProfile` порушує власний
контракт («Кидає виняток, якщо запис НЕ доїхав», js/store.js:1427).

Другий бік проблеми: кеш статусу оновлює лише `refreshAccountState()`, а
він викликається тільки з `signIn`/`signUp` (js/store.js:1131, :1292) і з
`js/welcome.js` (:590, :617, :932). На жодній іншій сторінці застосунку
статус не перечитується — перевірено `grep -rn "refreshAccountState" js/`.

**Reproduction** (`/tmp/audit-sync/t12-get.mjs`, блок `notApproved_write`):

1. Сесія жива, у хмарі є рядок `weight 82, updatedAt 2026-09-01`.
2. `ib.account = {status:'pending'}`.
3. `await Store.saveProfile({ weight: 77 })` — виконується без помилки.
4. Статус кешу міняється на `approved`, сторінку перезавантажено.

**Observed.**
```json
"posts": 0,
"step":  { "lsWeight": 77, "pending": 0, "dirty": false },
"after": { "weight": 82 }
```
Локальний запис 77 зник — його затерло правило з SYN-009.

**Expected.** Або помилка з `.queued` і патч у черзі, або принаймні
`markDirty()`, щоб локальна копія виграла, коли хмара знову стане доступною.

**Impact.** Вікно втрати вужче за SYN-014 (потрібна зміна статусу з
не-approved на approved за наявного хмарного рядка — наприклад,
розблокування раніше заблокованого акаунта), але механізм той самий:
успішна відповідь без запису й без сліду.

**Recommended fix.** У гілці «хмара недоступна за статусом» — `markDirty()`
і, для acknowledged-станів (`blocked`, `rejected`), явне повідомлення
в UI. Додатково — перечитувати статус акаунта не лише на welcome.html.

**Regression test.** `ib.account.status = 'pending'` + жива сесія →
`saveProfile` → `ib.profile.dirty` виставлено (або `pendingCount() === 1`).

---

### SYN-016

```text
ID:                 SYN-016
Severity:           INFO (перевірено — дефекту немає)
Confidence:         CONFIRMED
Category:           Читання профілю при збоях сервера
Location:           js/store.js:1344-1422 (getProfile)
```

Матриця GET `/rest/v1/profiles` (`/tmp/audit-sync/t12-get.mjs`).
Локальний профіль — `weight 95`; у всіх десяти випадках `getProfile()`
повернув `95`, `ib.profile` не затерто, помилка нагору не пішла,
необроблених винятків на сторінці — 0.

| Відповідь GET | Результат | `ib.session` | refresh |
|---|---|---|---|
| abort (офлайн) | локальний профіль | лишається | 0 |
| 401 | локальний профіль | **стерто** (`authExpired`) | 1 |
| 403 | локальний профіль | лишається | 0 |
| 404 | локальний профіль | лишається | 0 |
| 500 | локальний профіль | лишається | 0 |
| `200 []` | локальний профіль | лишається | 0 |
| `200 [{"data":null}]` | локальний профіль | лишається | 0 |
| `200` битий JSON | локальний профіль | лишається | 0 |
| `200` порожнє тіло | локальний профіль | лишається | 0 |
| `200 {"data":{…}}` (не масив) | локальний профіль | лишається | 0 |

Тобто читання **fail-safe**: жодна відповідь сервера не призводить до
підстановки порожнього бланка чи до знищення локальної копії. Це
відповідає коментарям у js/store.js:1354-1371 і :1407-1416 — вони
підтверджені.

---

### SYN-017

```text
ID:                 SYN-017
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Мережевий збій → незворотна відмова підтвердження пошти
Location:           js/store.js:1171-1236 (adoptUrlSession), рядки 1210-1232
```

**Description.** Після кліку в листі `adoptUrlSession`:
1. бере токени з фрагмента й одразу **прибирає фрагмент**
   (`history.replaceState`, js/store.js:1212-1214);
2. робить `GET /auth/v1/user`;
3. `catch` — **будь-яка** помилка — `clearSession()` і повідомлення
   «Посилання з листа вже використане або застаріле. Надішліть новий лист.»

Гілка не розрізняє 401/403 (токен справді мертвий) і тимчасову відмову
(500, 502, обрив мережі, увімкнений на мить офлайн). Оскільки фрагмент уже
стерто з адресного рядка, повторити спробу тим самим посиланням людина не
може: перезавантаження сторінки токенів більше не містить, а саме
посилання в листі одноразове.

**Reproduction** (`/tmp/audit-sync/t14b-session.mjs`, випадок C):
відкрити `welcome.html#access_token=AAA&refresh_token=BBB&expires_in=3600&type=signup`
з маршрутом `GET /auth/v1/user` → `500`.

**Observed.**
```json
{ "session": false, "user": null, "hash": "",
  "visibleText": "… Посилання з листа вже використане або застаріле. Надішліть новий лист. …" }
```
Той самий текст і той самий результат, що й для чесного 401.

**Expected.** На 5xx/офлайн — не стирати сесію (токен із фрагмента цілком
робочий) і сказати «не вдалося звʼязатися з сервером, спробуйте ще раз»;
`clearSession()` лишити тільки для 401/403.

**Impact.** Один тимчасовий збій сервера на кроці підтвердження пошти
викидає людину назад із хибним поясненням. Наступний лист упирається в
ліміт відправки Supabase (`over_email_send_rate_limit`, js/store.js:588) —
тобто відновитись можна буде лише через годину. Це той самий клас
відмови, через який, за коментарями в цьому ж файлі, «загубився перший
сторонній користувач».

**Recommended fix.**
```js
} catch (e) {
  if (e && (e.offline || (e.status && e.status >= 500))) {
    throw Object.assign(new Error('Сервер не відповів. Спробуйте ще раз за хвилину.'),
                        { code: 'link_retry' });     // сесію НЕ чіпаємо
  }
  clearSession(); …
}
```

**Regression test.** Браузерна перевірка: фрагмент із токенами +
`GET /auth/v1/user` → 500 → `Store.user()` не null, повідомлення не
містить слова «використане».

---

### SYN-018

```text
ID:                 SYN-018
Severity:           INFO (перевірено — дефекту немає)
Confidence:         CONFIRMED
Category:           Сесія / конкурентність
Location:           js/store.js:857-894 (refreshing, doRefresh, ensureFresh),
                    js/store.js:1674-1702 (слухач storage)
```

**Одна обіцянка на всіх при оновленні токена — працює.**
Проба `/tmp/audit-sync/t14b-session.mjs`, випадок A: сесія з
`expires_at` у минулому засіяна через `addInitScript`; чотири паралельні
операції (`rpc('elo_state')` ×3 + `saveProfile`) →
`{"refreshRequests": 1}`. Тобто ротований refresh-токен не витрачається
двічі — ризик, названий у js/store.js:849-856, закритий.

**Сесія між вкладками — працює.**
`/tmp/audit-sync/t14-session.mjs`, випадок B: вкладка A видаляє
`ib.session`; вкладка B через 500 мс віддає `Store.user() === null`
(`{"beforeUserInB": true, "afterUserInB": false}`).

---

### SYN-019

```text
ID:                 SYN-019
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           UI не показує розсинхрон
Location:           js/app.js:736-767 (renderSyncBadge), js/store.js:989-997 (markDirty/isDirty)
```

**Description.** Позначка синхронізації в шапці читає **лише**
`Store.pendingCount()`. Стан «є незіслані зміни» має ще одне джерело —
`ib.profile.dirty`, — і воно позначці недоступне: `isDirty` не
експортовано в `api`.

За матрицею SYN-020 (нижче) **усі** HTTP-помилки запису (400/401/403/404/
409/429/500) дають `pending: 0, dirty: true`. Тобто після одного червоного
тоста інтерфейс більше нічим не показує, що дані в браузері й дані в хмарі
розійшлись — а розійшлись вони всерйоз: `getProfile` тепер віддає перевагу
локальній копії і при кожному відкритті сайту показує локальні дані як
«справжні».

**Reproduction** (`/tmp/audit-sync/t1-matrix.mjs`): будь-який випадок,
крім `offline`, дає `"pending": 0, "dirty": true`.
`Store.pendingCount()` при цьому 0 → `el.hidden = true`.

**Expected.** Позначка має враховувати й `dirty`: «зміни не
синхронізовано».

**Recommended fix.** Додати в API `Store.unsyncedCount()` або
`Store.isDirty()` і врахувати в `renderSyncBadge`.

**Regression test.** Браузерна перевірка: POST профілю → 500 → елемент
`.nav__sync` не має `hidden`.

---

### SYN-020 — матриця відповідей сервера для запису профілю

```text
ID:                 SYN-020
Severity:           INFO (довідкова таблиця, отримана відтворенням)
Confidence:         CONFIRMED
Category:           Довідка
Location:           js/store.js:615-696 (req), :999-1009 (pushToCloud), :1544-1610 (doSave)
```

`Store.saveProfile({weight: 77.7})`, локальна база `weight: 82`
(`/tmp/audit-sync/t1-matrix.mjs`). «POST» — скільки мутуючих запитів
пішло; «refresh» — скільки викликів `/auth/v1/token`.

| Відповідь POST | POST | refresh | Помилка нагору | `.queued` | `ib.pending` | `dirty` | Сесія | Локальна копія |
|---|---|---|---|---|---|---|---|---|
| обрив (офлайн) | 1 | 0 | «Немає звʼязку — збережеться, коли зʼявиться мережа» | **так** | 1 | так | ціла | 77.7 |
| 400 | 1 | 0 | текст сервера | ні | 0 | так | ціла | 77.7 |
| 401 | 2 | 1 | текст сервера, `authExpired` | ні | 0 | так | **стерта** | 77.7 |
| 403 | 1 | 0 | текст сервера, `forbidden` | ні | 0 | так | ціла | 77.7 |
| 404 | 1 | 0 | текст сервера | ні | 0 | так | ціла | 77.7 |
| 409 | 1 | 0 | текст сервера | ні | 0 | так | ціла | 77.7 |
| 429 | 1 | 0 | «Забагато спроб поспіль…» | ні | 0 | так | ціла | 77.7 |
| 500 | 1 | 0 | текст сервера | ні | 0 | так | ціла | 77.7 |
| 200 з порожнім тілом | 1 | 0 | — (успіх) | — | 0 | ні | ціла | 77.7 |
| 200 з битим JSON | 1 | 0 | — (успіх) | — | 0 | ні | ціла | 77.7 |
| 204 (контроль) | 1 | 0 | — (успіх) | — | 0 | ні | ціла | 77.7 |

Висновки:
* **Дані ніколи не губляться локально** — `lsSet` виконується до мережі.
* 401 обробляється правильно: одна спроба оновити токен, потім вихід
  (`res.status === 401 && !opts.noRetry`, js/store.js:678-684).
* **Повторів немає для жодного статусу**, крім 401. 429 і 5xx — теж
  без повтору; єдиний шанс на досилання — черга, у яку при цих статусах
  нічого не кладеться. Практично це не втрата (локальна копія + `dirty`
  виграють у хмари), але й не синхронізація: до наступної вдалої дії
  користувача хмара лишається старою, а UI мовчить (SYN-019).
* Битий JSON і порожнє тіло на 2xx нешкідливі: `Prefer: return=minimal`,
  тіло однаково не читається.

---

## Повна таблиця мережевих запитів

Усі мережеві запити застосунку до Supabase живуть у `js/store.js`
(єдиний виняток — конверт Sentry у `js/errors.js:129-144`, fire-and-forget).
Спільна обробка — у `req()` (js/store.js:615-696):

* мережевий збій → `Error` з `offline = true` (текст «Немає звʼязку з сервером»);
* **таймауту немає** (SYN-004): запит, на який сервер не відповідає, висить вічно;
* тіло читається як текст, потім `JSON.parse` у `try` — битий JSON не кидає
  виняток, лягає в `data` як рядок;
* `!res.ok` → `Error` із `.status`, `.code` (машинний код Supabase),
  `.rawMessage`; текст перекладається таблицею `AUTH_MSG` (js/store.js:587-607);
* 401 із сесією → **один** повтор після `doRefresh()`; якщо і він 401 —
  `authExpired`, `clearSession()`, `emit()`;
* 403 → `forbidden` (сесію не чіпає — свідомо, для статусу `pending`).

| № | Метод / endpoint | Коли | Retry | Особливості обробки | UI при збої | Дані локально |
|---|---|---|---|---|---|---|
| 1 | `POST /auth/v1/signup?redirect_to=…` (`:1122`) | реєстрація на welcome.html | ні | «пошта вже є» = 200 з порожнім `identities` (`:1150-1153`) | `state.err`, кнопка звільняється в `catch` | профіль лишається локальним |
| 2 | `POST /auth/v1/token?grant_type=password` (`:1286`) | вхід | ні | далі `refreshAccountState` + `resolveFirstLogin` | текст помилки; кнопки розблоковано у `finally` (account.js:335) | без змін |
| 3 | `POST /auth/v1/token?grant_type=refresh_token` (`:866`) | `ensureFresh`, 401-повтор | ні (`auth:false`) | один проміс на всіх (`refreshing`, підтверджено SYN-018); офлайн → сесію НЕ чіпаємо | мовчки | без змін |
| 4 | `POST /auth/v1/logout` (`:1300`) | вихід | ні | обгорнуто `try/catch (_)` — помилка ігнорується | немає | локальні дані стираються **завжди** |
| 5 | `GET /auth/v1/user` (`:1220`) | `adoptUrlSession` після листа | ні | **будь-яка** помилка → `clearSession` + «посилання використане» (**SYN-017**) | текст на welcome.html | сесію знищено |
| 6 | `PUT /auth/v1/user` (`:1251`) | зміна пароля | 401→1 | стандартна | текст помилки | — |
| 7 | `POST /auth/v1/recover?redirect_to=…` (`:1241`) | «забув пароль» | ні | `auth:false` | текст помилки | — |
| 8 | `POST /auth/v1/resend?redirect_to=…` (`:1265`) | повторний лист | ні | `auth:false`; 429 → людський текст | текст помилки | — |
| 9 | `GET /rest/v1/profiles?select=data&user_id=eq.…&limit=1` (`:1351`) | `getProfile` (кеш порожній, статус approved) | 401→1 | **fail-safe**: `catch` → локальний профіль (матриця SYN-016) | `console.warn`, без тоста | локальна копія недоторкана |
| 10 | той самий GET (`:1640`) | `resolveFirstLogin` | 401→1 | помилка → `return null`, злиття не вирішується | немає | локальні дані лишаються |
| 11 | `POST /rest/v1/profiles?on_conflict=user_id` (`:1001`, `pushToCloud`) | кожен `saveProfile`, `flushPending`, `adoptLocalProfile` | 401→1 | `markDirty` до, `clearDirty` після; матриця SYN-020 | тост із тексту помилки або `.queued` | завжди записано до мережі |
| 12 | той самий POST, **сирий `fetch`** (`:1491`, `saveProfileBeacon`) | `pagehide` / `visibilitychange` (account.js:679) | ні | **не перевіряє `res.ok`**, немає `ensureFresh`, немає `markDirty` (**SYN-001, SYN-002**) | немає взагалі | записано локально, але без позначки |
| 13 | `POST /rest/v1/rpc/<name>` (`:1075`) | `account_state`, `delete_account`, `register_request`, `username_free`, `elo_*`, `admin_*` | 401→1 | `ensureFresh` до виклику; без сесії — `noauth` | залежить від виклику; ELO — див. SYN-012 | ELO-подія в `ib.eloPending` лише при `offline`/`noauth` |
| 14 | `POST <sentry-envelope>` (`js/errors.js:137`) | необроблена помилка | ні | `keepalive`, `.catch` ігнорує | немає | — |

Порожня відповідь і битий JSON для №1–13 обробляються однаково:
`data` стає рядком або `null`, виняток не кидається (перевірено для №9 і
№11 — SYN-016, SYN-020).

---

## Таблиця ідемпотентності

| Операція | Стан | Доказ |
|---|---|---|
| `saveProfile` (upsert усього документа) | **захищена** всередині вкладки | `saveChain` серіалізує; 5 паралельних викликів → 5 послідовних POST, підсумок правильний (`t5`, `parallel`) |
| те саме, дві вкладки | **вразлива** | лост-апдейт полів-журналів (SYN-011, `t10` C) |
| те саме, два пристрої | **вразлива** (назване обмеження) | last-write-wins цілим документом, js/store.js:1015-1026 |
| «Зберегти замір» (measure.html) | **захищена** | `state.busy` (`js/measure.js:162,203`); 3 кліки → 1 POST (`t5`) |
| «Завершити тренування» (workout.html) | **захищена** | `confirm` + перерендер прибирає кнопку; 3 кліки → 1 POST, один запис у `sessionLog` (`t5`) |
| `saveProfileBeacon` | ідемпотентна за формою, але **вразлива** до тихої втрати | SYN-001 |
| `flushPending` | **захищена** | стоїть у тому ж `saveChain` (`queueWrite`, js/store.js:941-948); з черги знімається рівно стільки, скільки відправлено (js/store.js:979-984) |
| `flushPending` після виходу | **вразлива** | чужий патч доїжджає в новий акаунт (SYN-010) |
| `EloApi.submit` | **ідемпотентна** на сервері (за `user, kind, day`), клієнт має `ib.eloSent` | js/elo-api.js:13-15; повторний виклик повертає `duplicate` і тост не показується (js/elo-hooks.js:163) |
| `EloApi.submit` при 5xx/429 | **вразлива** (втрата події) | SYN-012 |
| `evaluateWeeks` (`elo_catch_up`) | **захищена** дроселем на добу | `ib.eloWeeks` = дата (js/elo-api.js:187-197) |
| `closeSeasonIfDue` (`elo_close_season`) | **захищена** | `ib.eloClosed[code]` лише на остаточну відповідь + `try:<code>` на добу (js/elo-api.js:232-249) |
| `register_request` | **захищена** | `state.busy` у welcome.js (`:533-540`) |
| `admin_decide` | **захищена** | `state.busy` + `confirm` (js/admin.js:157-167) |
| `elo_activate_grace` | **не захищена на клієнті** (POSSIBLE) | js/season.js:177-190: немає ні `busy`, ні `disabled`; де-факто кліки серіалізує `confirm()`, остаточний барʼєр — серверна перевірка `exhausted`. Відтворити не вдалось: кнопка `#sz-grace-go` не рендериться без валідного коду сезону в мок-відповіді |
| `deleteAccount` | **захищена** послідовністю | RPC, потім `clearIdentityData` (js/store.js:1108-1115) |
| `adoptLocalProfile` | **вразлива** (пише чужі дані) | SYN-003 |
| «Відкотити імпорт» | **вразлива** (пише дані попереднього користувача) | SYN-006 |

---

## Що НЕ перевірено і чому

1. **Реальні відповіді бойового Supabase.** Усі коди станів імітовані
   `page.route()`. Заборонено §1.2 промта (жодних записів у бойову базу,
   жодних стрес-тестів). Тому статуси, які реально віддає PostgREST на
   конкретні порушення (напр. 409 на `on_conflict`), не звірялись —
   перевірялась **реакція клієнта** на кожен код.
2. **Поведінка `keepalive`-запиту після знищення документа.** SYN-001
   доведено на HTTP-помилці **без** вивантаження сторінки. Другий
   підваріант — «сторінка вивантажена, запит провалився мережево, `.catch`
   не встиг виконатись» — відтворити в Playwright надійно не вдалось
   (після `page.close()` спостерігати `localStorage` нічим). Лишається
   PROBABLE і посилює SYN-001, але окремою знахідкою не подається.
3. **Safari, Firefox, мобільні браузери.** У контейнері лише Chromium
   (`tools/pw.mjs`). Окремо не перевірено підтримку `fetch(..., {keepalive})`
   у WebKit: за специфікацією вона є, але в Safari історично обмежена
   розміром і не гарантована на `pagehide`. Це впливає на весь шлях
   `saveProfileBeacon`; без другого браузера тверджень не роблю.
4. **Серверна ідемпотентність** `elo_submit`, `elo_catch_up`,
   `elo_close_season`, `register_request`, `admin_decide`. Це домени
   `db` і `elo`; тут зафіксовано лише клієнтську сторону.
5. **Конкурентність між РІЗНИМИ пристроями.** Потребує двох живих сесій у
   бойовій базі — заборонено. Обмеження назване самим кодом
   (js/store.js:1024-1026) і підтверджене логікою; окремої проби немає.
6. **Подвійний клік на «Активувати Grace Week»** (`js/season.js:177`).
   Кнопка `#sz-grace-go` не відрендерилась у пробі: `renderHeader` падає
   раніше на `EloCore.seasonDay()` з вигаданим кодом сезону. Стан у таблиці
   ідемпотентності — POSSIBLE за читанням коду.
7. **Вичерпана квота `localStorage` у поєднанні з чергою.** Код
   прочитано (`lsSet` → `false` → `queuedError` → «Сховище браузера
   переповнене»), відтворення квоти в Playwright не робив — це домен
   `local`.
8. **Вплив service worker на мережеві запити.** `sw.js` кешує статику;
   запити до Supabase крізь нього не йдуть. Детально — домен PWA.
9. **Sentry як мережевий канал** (`js/errors.js`): fire-and-forget,
   `keepalive`, помилки ігноруються — на синхронізацію даних не впливає.
10. **Локальний режим (`localMode`)**: у ньому мережевих запитів немає
    зовсім, тож увесь цей домен до нього не застосовний; перевірка
    локального режиму — домен `local`.

---

## Спостереження (INFO)

**I-1. Черга `ib.pending` обрізається до 200 елементів**
(`js/store.js:928`, `q.slice(-200)`) — найстаріші патчі мовчки випадають.
Практично це не втрата: `doFlushPending` починає з
`await api.getProfile()`, який при виставленому `dirty` повертає повну
локальну копію, а патчі лише накладаються поверх. Черга тут — радше
позначка «є незіслане», ніж журнал. Але залежність неявна: якщо `dirty`
колись зніметься раніше за досилання, обрізана черга справді втратить
поля.

**I-2. `ib.profile.dirty` не має строку давності.** `clearDirty()`
викликається лише після вдалого `pushToCloud`. Після незворотної помилки
(напр. 404 на неіснуючий шлях) позначка лишається назавжди, і локальна
копія цього браузера завжди виграватиме в хмарної — навіть якщо на
іншому пристрої дані свіжіші. Самолікується першим успішним записом.

**I-3. `saveProfileBeacon` не перевіряє `cloudAllowed()`**
(js/store.js:1464: `if (!(CLOUD && session)) return okLocal;`), на
відміну від `doSave` (js/store.js:1560,1566). Не-approved акаунт шле
приречений на 403 запит при кожному `pagehide`. Шкоди немає (RLS
відповість 403, дані лишаться локально), але це зайвий шум у логах auth
і зайва зачіпка для rate limit.

**I-4. `doFlushPending` ігнорує результат `lsSet(LS_PROFILE, merged)`**
(js/store.js:969). При переповненому сховищі чергу буде очищено, а
локальна копія лишиться старою — хмара при цьому правильна. Розбіжність
тиха, але без втрати (хмара авторитетна).

**I-5. `queueWrite` поглинає помилки в ланцюг**
(`saveChain = saveChain.then(fn, fn)`, js/store.js:942). Це правильно —
ланцюг не «отруюється» відхиленням, — але означає, що `saveChain` після
невдалого запису лишається **відхиленим** промісом; наступний
`queueWrite` це виправляє. Викликів `queueWrite` без обробника
відхилення в коді немає (`flushPending().catch(...)` скрізь) — перевірено
`grep -rn "flushPending" js/`.

**I-6. Пояснювальні коментарі в `js/store.js` виявились точними**
там, де я міг їх перевірити: fail-safe читання (`:1354-1371`,
`:1407-1416`), збереження локальної копії при 401 (`:789-811`),
одна обіцянка на refresh (`:849-856`), `enforceOwner` (`:760-787`),
зняття з черги рівно відправленого (`:971-978`). Три коментарі
описують стан, який уже не відповідає коду: обіцянка «кидає виняток,
якщо запис не доїхав» (`:1427`) — спростована SYN-014 і SYN-015;
твердження, що `saveChain` прибирає гонку «всередині вкладки»
(`:1015-1026`), не поширюється на дві вкладки одного браузера (SYN-011);
твердження, що конкурентний beacon іде в чергу (`:1449-1457`), вірне
лише для випадку `saveInFlight`, а не для HTTP-помилки (SYN-001).

---

## Зведення знахідок

| ID | Severity | Confidence | Категорія |
|---|---|---|---|
| SYN-003 | CRITICAL | CONFIRMED | дані користувача A потрапляють в акаунт B через діалог злиття |
| SYN-010 | CRITICAL | CONFIRMED | патч у черзі переживає вихід і доїжджає в чужий акаунт без дій користувача |
| SYN-001 | HIGH | CONFIRMED | `saveProfileBeacon` мовчки губить зміни при HTTP-помилці |
| SYN-006 | HIGH | CONFIRMED | `signOut` лишає `ib.profile.backup`/`forge.today`; «Відкотити імпорт» пише чужі дані |
| SYN-007 | HIGH | CONFIRMED | вхід через welcome.html мовчки затирає локальні дані |
| SYN-008 | HIGH | CONFIRMED | «лишити дані акаунта» не працює й знищує саме їх |
| SYN-014 | HIGH | CONFIRMED | після смерті refresh-токена збереження «успішні», але нікуди не йдуть |
| SYN-002 | MEDIUM | CONFIRMED | beacon шле запит простроченим токеном |
| SYN-004 | MEDIUM | CONFIRMED | немає таймауту: зависання блокує всі записи вкладки |
| SYN-011 | MEDIUM | CONFIRMED | втрачене оновлення між двома вкладками |
| SYN-012 | MEDIUM | CONFIRMED | подія ELO губиться при 5xx/429 і видаляється з черги |
| SYN-015 | MEDIUM | CONFIRMED | запис при не-approved статусі «успішний» і без сліду |
| SYN-017 | MEDIUM | CONFIRMED | тимчасовий 5xx на підтвердженні пошти видається за використане посилання |
| SYN-019 | MEDIUM | CONFIRMED | позначка синхронізації не бачить `dirty` |
| SYN-005 | INFO | CONFIRMED | подвійний клік — дефекту немає |
| SYN-009 | MEDIUM | CONFIRMED | правило переваги хмари робить будь-яку діру в позначках незворотною |
| SYN-013 | INFO | CONFIRMED | refresh під час запиту — дефекту немає |
| SYN-016 | INFO | CONFIRMED | читання профілю fail-safe для всіх 10 відповідей |
| SYN-018 | INFO | CONFIRMED | лок оновлення токена і сесія між вкладками працюють |
| SYN-020 | INFO | CONFIRMED | довідкова матриця відповідей на запис |

**Найкоротший шлях до катастрофи, знайдений у цьому домені:** спільний
пристрій. Три незалежні механізми (SYN-003, SYN-006, SYN-010) переносять
дані одного користувача в акаунт іншого, і один із них (SYN-010) не
потребує від людини жодної дії, крім входу.

**Найтихіший шлях до втрати:** мертвий refresh-токен (SYN-014) — усі
збереження показують «Збережено», нічого не йде в мережу, нічого не
позначено, а після повторного входу через welcome.html (SYN-007) робота
замінюється хмарним станом на момент смерті сесії.
