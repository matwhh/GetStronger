# Аудит Forge 2026-09 — домен «ops»: операційна готовність поза репозиторієм

Phase A, тільки читання. Агент: ops. Дата: 2026-09-06. Репозиторій `/root/work/forgesite` @ `964429b` (master).

## Обсяг і метод

Розділ A11 PROMPT.md і відомі проблеми з 2.3. Джерела доказів: Supabase MCP
(`get_project`, `query_logs` по 24-годинних вікнах, `execute_sql` лише SELECT,
`get_advisors`), Claude Code Remote (`list_triggers` — заплановані задачі
бекапу/нагадувань), Vercel MCP, Sentry MCP, curl -sI до бойового домену,
читання `tools/*.sh|*.command`, `.github/workflows/ci.yml`, `vercel.json`,
`db/*.sql`, `legal.html`, `js/store.js`, `js/account.js`, `js/errors.js`.
Жодних змін у базі, панелях, репозиторії (крім цього файла).

## Що перевірено


- Supabase: `get_project`, `get_organization` (plan free), `list_projects` (3 проєкти,
  1 INACTIVE), `get_advisors(security)` (24 попередження, з них 1 у моєму домені),
  `cron.job` (1) + `cron.job_run_details` (2 запуски), визначення 4 функцій
  (`elo_close_season`, `season_bounds`, `delete_account`, перелік `elo_*`),
  9 FK на `auth.users`, права execute для `anon`/`authenticated` на 2 RPC,
  `auth.users` (3, без e-mail у звіті), `auth.identities` (3), `auth.audit_log_entries` (0),
  послідовності (2), таблиці `public` (10), лічильники 7 таблиць — **17 SELECT-запитів,
  0 мутацій**.
- Supabase `query_logs`: 12 запитів по 24-годинних вікнах за 2026-08-27 … 09-06
  (auth_logs — усі дні з трафіком, edge_logs — 5 діб, postgres_logs — 2 доби навколо
  запусків бекапу).
- Claude Code Remote `list_triggers` ×2 (enabled / disabled+completed): 3 активні,
  9 завершених задач; задача заявок з 2.3 відсутня.
- Vercel MCP: `list_teams`, `list_projects`, `get_project`, `get_deployment` — доступ до
  `forge` відсутній; замість цього 9 × `curl -sI` до бойового домену.
- Sentry MCP: `find_organizations`, `find_projects`, `search_issues` (3 unresolved),
  `search_events` ×2 (8 подій усього; 7 переглянуто по полях), `get_sentry_resource`
  (1 подія повністю: теги, контекст, user, стек), `search_sentry_tools` (квота недоступна).
- Репозиторій: `vercel.json`, `.vercelignore`, `.gitignore`, `.github/workflows/ci.yml`,
  `package.json`, `RELEASE.md`, `README.md` (grep), `db/backup-export.sql`, `db/cron.sql`,
  `tools/auto-publish.sh`, `autopublish-{on,off,status}.command`, `github-token.command`,
  `fix-push.command`, `enable-ci.command`, `release-cleanup.command`, `ci-offline.sh`,
  `ci-browser.sh`, `ci-hygiene.mjs`, `js/errors.js`, `js/app.js` (injectJsonLd),
  `js/store.js` (emailRedirect/withRedirect/deleteAccount), `js/account.js` (видалення),
  `js/elo-api.js` (закриття сезону), `legal.html` (розділи «Звіти про помилки»,
  «Видалення даних», «Припинення»), `js/config.js` (лише публічні значення; JWT
  anon-ключа декодовано для `exp`).
- `npm test` (483/483, 4,1 с), `node tools/ci-hygiene.mjs` (rc 0).
- Моделювання `auto-publish.sh` у `/tmp/audit-ops` (копія репозиторію + bare-remote,
  без мережі): 6 сценаріїв, 8 прогонів скрипта; 2 сценарії підтвердили дефекти
  (OPS-002), 1 — не відтворився на Linux (OPS-003, PROBABLE).
- GitHub API: 1 спроба — 403 (доступ із контейнера закритий).


## Що НЕ перевірено і чому


- **Restore drill** — не виконано: у контейнері й репозиторії немає жодного дампа,
  на Mac не заглядаю (заборона `/Users/…`), Supabase branch не створював (§1.2 —
  без дозволу; ймовірно платна функція). Замість цього — покроковий план для Phase B
  (розділ нижче) і структурна перевірка самого експортного запиту.
- Причина провалу бекап-задачі 2026-09-06 — транскрипт сесії `cse_01CMZosztNGNbmMwybEPKtBf`
  через доступні інструменти не читається; 8 секунд тривалості лише вказують, що до
  SQL справа не дійшла.
- Причина провалу задачі заявок `trig_01RqLZD26Li8dg69AZmAooCA` — задача видалена,
  історії немає.
- Каскадне видалення акаунта в `BEGIN … ROLLBACK` — не виконувалось через правило 1.1
  («жодного видалення користувачів»); доказ лише декларативний (9 FK `ON DELETE CASCADE`).
- Vercel: deployment protection, список деплоїв, runtime errors, build logs — інтеграція
  не має доступу до проєкту `forge`.
- GitHub: історія прогонів Actions, деплої з червоним CI, дата закінчення PAT,
  публічність репозиторію, залишок хвилин Actions — API з контейнера дає 403,
  а attach з credentials заборонений.
- Провайдер пошти (SMTP-хост, ліміти відправника) — GoTrue не логує; у репозиторії
  не задокументовано; панель Supabase не відкривав.
- Sentry: тариф/квота/ретенція — інструмента в MCP немає; шаблони листів Auth, час
  життя OTP, повний список Redirect URLs — доступні лише в панелі; факти взято з
  поведінки в логах (redirect на welcome.html приймається, cooldown 60 с, ліміт 30/год).
- TCC на реальному macOS, відсутність node, часткова доставка з паузою >5 хв —
  не відтворювались (Linux/час); оцінка з коду.
- Дві сесії з `t0 === t1` — домен history/stats.


## Знахідки

(формат розділу 6 PROMPT.md)

### OPS-001 — Резервної копії бази фактично немає: задача бекапу падає мовчки, успіх не доведено, процедури відновлення не існує

```text
ID:                 OPS-001
Severity:           HIGH
Confidence:         CONFIRMED
Category:           Бекапи / втрата даних
Location:           trig_01CNsyKoU1nVWETfN5DsiTGV («Forge: щоденна резервна копія бази»); db/backup-export.sql; RELEASE.md, README.md (процедури відновлення немає)
Description:        Єдиний механізм резервного копіювання бойової бази (Free-план, автоматичних
                    бекапів Supabase немає) — запланована задача, яка через MCP виконує
                    db/backup-export.sql і кладе JSON на Mac. Її останній запуск —
                    ROUTINE_RUN_STATUS_FAILED (2026-09-06T01:04:35Z → 01:04:43Z, 8 секунд),
                    сповіщення про результат вимкнені (push:false, email:false), у репозиторії й
                    контейнері немає жодного дампа, у логах бази немає слідів експорту, а скрипта
                    або інструкції відновлення з цього JSON не існує. Відновлення, отже, не
                    пройдено й пройти його нема з чого.
Why it matters:     Втрата або пошкодження бази (помилкова міграція, видалення проєкту за
                    неактивність, збій Supabase) — необоротна. PROMPT §7: «Бекап без відновлення
                    не рахується».
Reproduction:       1) mcp__claude-code-remote__list_triggers → trig_01CNsyKoU1nVWETfN5DsiTGV:
                       last_run.status = ROUTINE_RUN_STATUS_FAILED, notifications {push:false,email:false}.
                    2) find / -xdev -name 'forge-backup-*.json' -o -name 'backup-*.json' → порожньо.
                    3) grep -rn -i 'restore\|відновл' db/ tools/ RELEASE.md README.md → лише про
                       локальний ib.profile.backup.
                    4) query_logs postgres_logs 2026-09-05/06 → жодного рядка з 'exported_at'.
Observed:           Немає доказу, що хоч один бекап існує; провал задачі ніхто не побачив би.
Expected:           Щоденний дамп із перевіркою вмісту, сповіщення про провал, задокументована
                    й один раз пройдена процедура відновлення.
Root cause:         Бекап делегований одноразово налаштованій хмарній задачі, залежній від
                    наявності Mac онлайн о 01:04 UTC і device-інструментів; при цьому задача
                    створена БЕЗ привʼязки до пристрою (`folders_state = FOLDERS_STATE_NONE`,
                    J11a) — device-інструменти в ній недоступні за побудовою, і привʼязку не
                    можна додати заднім числом; вимкнені сповіщення; відновлення ніколи не
                    проєктувалось.
Impact:             Повна втрата даних 3 користувачів (профілі ~23 КБ, рейтинг, згоди) у разі
                    інциденту; у майбутньому — всіх користувачів.
Recommended fix:    (поза репозиторієм, точка зупинки §1.5) а) перестворити задачу з
                    `requires_local_device=true` (інакше файл ніколи не дійде до Mac) і
                    notifications {push:true,email:true}; б) додати в задачу крок «перевірити, що
                    попередній файл існує й counts збігаються»; в) у репозиторій — db/backup-restore.sql
                    (або tools/restore-backup.mjs): JSON → тимчасова схема → перевірка лічильників
                    → вставка з ON CONFLICT DO NOTHING і setval для elo_events_id_seq,
                    consent_log_id_seq; г) розширити експорт полями auth.users
                    (raw_app_meta_data, raw_user_meta_data, aud, role, instance_id) і таблицею
                    auth.identities — без них GoTrue-акаунти не відтворюються; д) restore drill
                    у Phase B (нижче, розділ «Restore drill»).
Regression test:    Скрипт tools/verify-backup-roundtrip (Node, без мережі): згенерувати JSON за
                    format_version 1 з тестових рядків → пропустити через restore → порівняти
                    counts і по одному рядку з кожної таблиці. Плюс щоденна перевірка в задачі:
                    файл за вчора існує і має counts.users ≥ 1.
```

### OPS-002 — Після невдалого push автопублікація не повторює відправку: коміт лишається на Mac, а стан каже «усе вже на GitHub»

```text
ID:                 OPS-002
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           Конвеєр публікації / видимість відмов
Location:           tools/auto-publish.sh:127-136 (перевірка приводу), :239-252 (push); tools/autopublish-status.command:36-42
Description:        Скрипт вважає приводом до публікації лише зміни в робочому дереві або файл-запит.
                    Якщо push відхилено (протермінований токен, 403, non-fast-forward), коміт уже
                    створено, дерево чисте — і наступний прогін виходить з rc=0, не пробуючи push
                    знову. Після заміни токена (tools/github-token.command лише робить ls-remote)
                    коміт так само не їде, доки не зʼявиться нова зміна. Статус-скрипт друкує
                    «Зміни: немає — усе вже на GitHub», бо не дивиться `git log origin/main..HEAD`.
Why it matters:     Токен «MOLD mac» спливає 2026-09-12. Перший push після цього дасть одне
                    сповіщення, після чого правки, зроблені у вікні до заміни токена, тихо
                    застрягнуть; людина побачить «немає змін» і вирішить, що сайт оновлено.
Reproduction:       У копії репозиторію з bare-remote /tmp/audit-ops/remote.git: pre-receive hook,
                    що друкує «Authentication failed» і exit 1 → `echo x > .forge-publish; echo y >>
                    robots.txt; bash tools/auto-publish.sh` → rc=1, лог «PUSH НЕ ВДАВСЯ». Зняти хук.
                    `bash tools/auto-publish.sh` → rc=0; `git log --oneline origin/main..HEAD` → 1 коміт.
                    `printf '\n' | bash tools/autopublish-status.command` → «Зміни: немає — усе вже
                    на GitHub».
Observed:           Неопублікований коміт не відправляється жодним наступним прогоном без нової зміни.
Expected:           Кожен прогін перевіряє `git rev-list --count origin/main..HEAD` і, якщо > 0,
                    робить push (без тестів — вони вже пройшли); статус показує кількість
                    невідправлених комітів.
Root cause:         Відбиток стану рахується з `git status --porcelain` + запиту; наявність
                    невідправлених комітів у нього не входить.
Impact:             Тиха затримка публікації на невизначений час; розбіжність між тим, що на Mac,
                    і тим, що на сайті.
Recommended fix:    У auto-publish.sh перед блоком «Чи є привід»: `AHEAD=$(git rev-list --count
                    origin/$BRANCH..HEAD 2>/dev/null || echo 0)`; якщо AHEAD>0 і змін немає —
                    одразу до блоку «Відправка». У autopublish-status.command — рядок
                    «Не відправлено: N комітів». Без нових залежностей.
Regression test:    Сценарій із Reproduction як bash-тест у tools/ (запускається на Linux, bare-remote
                    у mktemp): після зняття хука другий прогін має дати `origin/main..HEAD` = 0.
```

### OPS-003 — Відмова доступу до теки (TCC) не сповіщається: агент щохвилини пише в лог і мовчить

```text
ID:                 OPS-003
Severity:           LOW
Confidence:         PROBABLE
Category:           Конвеєр публікації / видимість відмов
Location:           tools/auto-publish.sh:104-108
Description:        Якщо `git status` не проходить (macOS TCC не пускає фоновий bash до Робочого
                    столу, або git зламаний), скрипт пише `blocked`, рядок у publish.log і
                    `exit 1` — але не викликає `notify()`. Усі інші відмови (тести, push)
                    сповіщаються. Увімкнення (autopublish-on.command) перевіряє blocked лише один
                    раз одразу після встановлення; якщо дозвіл зникне пізніше (оновлення macOS,
                    зміна шляху /bin/bash у списку Full Disk Access), публікація зупиниться без
                    жодного сигналу, а сайт застигне на старій версії.
Why it matters:     Найімовірніша відмова саме цього конвеєра — TCC (сам скрипт це визнає в
                    коментарі) — єдина, яку не видно.
Reproduction:       Код: рядки 104-108 — `log …; echo "no-access" > blocked; exit 1` без notify.
                    На Linux відтворити відмову читання не вдалося (chmod 311 + su nobody: git
                    status проходить), тому PROBABLE.
Observed:           Тиша щохвилини.
Expected:           Одне сповіщення при першому переході в стан blocked (не щохвилини — дедуплікація
                    через існування файла blocked до `rm -f`).
Root cause:         Гілка написана до появи notify() або свідомо, щоб не спамити щохвилини — але
                    дедуплікація вже є (файл blocked).
Impact:             Невидима зупинка публікації.
Recommended fix:    `if [ ! -f "$STATE/blocked" ]; then notify "Немає доступу до теки" "macOS не
                    пускає агент. Автопублікація-стан.command"; fi` перед `echo no-access`.
Regression test:    Ручний: зняти /bin/bash з Full Disk Access → протягом хвилини має прийти
                    сповіщення. Автоматично на Linux не перевіряється (ENVIRONMENTAL).
```

### OPS-004 — CI не є воротами деплою: Vercel публікує кожен push до main незалежно від GitHub Actions

```text
ID:                 OPS-004
Severity:           MEDIUM
Confidence:         CONFIRMED
Category:           CI/CD / класифікація (2.3)
Location:           .github/workflows/ci.yml (on.push.branches: [main]); vercel.json (немає ignoreCommand / git.deploymentEnabled); tools/auto-publish.sh:150-162 (node відсутній → push без тестів)
Description:        Vercel підключений до GitHub і збирає production з кожного push у main. Actions
                    запускаються тим самим push паралельно й нічого не блокують. Локальний
                    запобіжник (auto-publish.sh проганяє юніти перед push) свідомо вимикається,
                    коли node на Mac відсутній або старший за 20, і не охоплює браузерні перевірки.
                    Отже, червоний CI — це сповіщення постфактум, коли зламана версія вже
                    на сайті.
Why it matters:     Класифікація: **CI = сповіщення, не ворота**. За заявленої мети «місяці й роки
                    без нагляду» єдиний автоматичний бар'єр перед продакшеном — локальні юніти на
                    одній машині.
Reproduction:       1) cat vercel.json → жодного ignoreCommand. 2) ci.yml → лише test/browser jobs,
                    без deploy-кроку і без залежності Vercel від них. 3) curl -sI
                    https://forge-mold1.vercel.app/js/config.js → last-modified 16:32:42 GMT
                    2026-09-06: свіжий деплой є, а в ci.yml deploy-кроку немає — отже, він
                    міг прийти лише з Git-інтеграції Vercel, яка не чекає на Actions.
                    4) Історія прогонів Actions недоступна з контейнера (403) — чи були
                    деплої з червоним CI, встановити не вдалось.
Observed:           Vercel деплоїть за секунди після push; CI закінчується через 1–20 хв.
Expected:           Production оновлюється лише після зеленого CI.
Root cause:         Vercel Git-інтеграція слухає main напряму.
Impact:             Регресія, яку ловлять тести, все одно потрапляє до користувачів.
Recommended fix:    Без нових залежностей (одна зміна в панелі Vercel — точка зупинки §1.5):
                    а) у Vercel → Settings → Git → Production Branch = `release`;
                    б) у ci.yml додати job `promote` (needs: [test, browser], if: success() &&
                    github.event_name == 'push' && github.ref == 'refs/heads/main',
                    permissions: contents: write): `git push origin HEAD:release`;
                    в) auto-publish.sh лишається як є (пушить main). Тоді Vercel бачить лише
                    перевірені коміти, а гарячий відкат — це `git push origin <sha>:release`.
                    Альтернатива без зміни панелі — `ignoreCommand` не підходить: він не вміє
                    чекати на статус Actions без токена.
Regression test:    Після впровадження: push у main з навмисно зламаним тестом → release не
                    рухається, сайт не змінюється (curl last-modified), Actions червоні.
```

### OPS-005 — Sentry зберігає IP-адресу й геолокацію користувача всупереч тексту legal.html

```text
ID:                 OPS-005
Severity:           LOW
Confidence:         CONFIRMED
Category:           Приватність / відповідність обіцянкам
Location:           Sentry project mold-t1/forge (події FORGE-2/3/4); js/errors.js:1-15 (заявлено «жодного ідентифікатора користувача»); legal.html:125-134
Description:        Клієнт не шле поле user, але Sentry Relay для platform=javascript сам виводить
                    IP з'єднання і додає геолокацію, доки в проєкті не ввімкнено «Prevent Storing
                    of IP Addresses». У кожній переглянутій події: `user: ip:31.144.xx.xx`,
                    `user.geo: UA, Ukraine`, лічильник «Users: 3» рахується саме за IP. legal.html
                    каже, що звіти «не повʼязуються з конкретним користувачем» і не називає IP
                    серед того, що йде в Sentry (IP згадано лише для Vercel/Supabase/Google Fonts).
Why it matters:     IP — персональні дані; обіцянка в політиці не виконується технічно.
Reproduction:       mcp__Sentry__get_sentry_resource(issue FORGE-3) → розділ User: `ip:…`,
                    `user.geo: UA`. mcp__Sentry__search_events(fields user, user.geo…) — те саме
                    для всіх 7 подій.
Observed:           IP і країна зберігаються в кожній події.
Expected:           Або IP не зберігається (налаштування проєкту Sentry), або legal.html чесно
                    називає IP серед даних звіту.
Root cause:         Дефолт Sentry для JS; політика писалась за кодом клієнта, а не за тим, що
                    реально зберігає сервер.
Impact:             Невідповідність політики; можливість повʼязати помилку з людиною за IP.
Recommended fix:    (панель Sentry — точка зупинки §1.5) Project → Security & Privacy → «Prevent
                    Storing of IP Addresses» = on — це єдиний надійний спосіб: інференс IP
                    робить сервер, а не клієнт, тому правка js/errors.js його не вимкне
                    (у Phase B можна спробувати явне `user: { ip_address: null }` у події і
                    перевірити результат, але покладатись на це не варто). Паралельно доповнити
                    legal.html («IP-адреса на боці Sentry не зберігається» — після увімкнення).
Regression test:    Після зміни — тестова подія через ForgeErrors.report у продакшені (з дозволу
                    власника) і перевірка в Sentry, що поле user порожнє.
```

### OPS-006 — Три невирішені issues Sentry — шум від масиву JSON-LD на калькуляторних сторінках у Safari

```text
ID:                 OPS-006
Severity:           LOW
Confidence:         PROBABLE
Category:           Спостережуваність / шум у Sentry
Location:           js/app.js:378-393 (injectJsonLd: масив [WebSite, WebApplication] для calculator/nutrition/cardio); Sentry FORGE-2, FORGE-3, FORGE-4
Description:        7 із 8 подій Sentry за всю історію проєкту — одна помилка `TypeError: undefined
                    is not an object (evaluating 'r["@context"].toLowerCase')`, усі в Safari 18.4
                    на Mac, стек `code@…/nutrition.html:3:362` (рядок 3 — це `<head>`, там JS немає:
                    код інжектований браузером/розширенням і читає `<script type="application/ld+json">`).
                    Помилка виникає рівно на трьох сторінках, де Forge вставляє JSON-LD верхнього
                    рівня масивом, і на жодній з тих, де це один обʼєкт. Споживач очікує обʼєкт з
                    `@context`; масив валідний за schema.org, але не для нього.
Why it matters:     Sentry — єдиний канал «сайт зламаний»; коли 88 % подій — шум, справжню помилку
                    пропустять. Крім того, IGNORE у js/errors.js фільтрує `extension://`, але цей
                    стек має URL сторінки, тож фільтр не спрацьовує.
Reproduction:       search_events(errors, 90d, fields issue,browser,url) → 7 подій, browser =
                    Safari 18.4, url ∈ {calculator, nutrition, cardio}.html. grep -n '@context'
                    js/app.js → рядки 368, 381; graph.length===2 лише для CALC-сторінок.
                    У Chromium не відтворюється (споживач JSON-LD — на боці Safari/розширення).
Observed:           Issues ростуть із кожним заходом цього користувача на калькулятори.
Expected:           Нуль шумових подій.
Root cause:         Форма JSON-LD «масив на верхньому рівні».
Impact:             Забруднена сигнальна лінія; квота Sentry (Free: 5k подій/міс) не під загрозою —
                    8 подій за 10 днів.
Recommended fix:    js/app.js: замість масиву — один обʼєкт `{ '@context': 'https://schema.org',
                    '@graph': [site, webapp] }` (кожен елемент без власного @context). Це
                    стандартний і рівноцінний для Google запис. Після деплою — resolve FORGE-2/3/4;
                    якщо повернеться — це не JSON-LD.
Regression test:    tests/*: injectJsonLd (через jsdom-подібну заглушку document) на calculator.html
                    повертає обʼєкт з '@context' і '@graph' довжиною 2, а не масив.
```

### OPS-007 — Free-план Supabase: пауза після 7 днів без трафіку зупинить cron і застосунок; в організації це вже сталося з іншим проєктом

```text
ID:                 OPS-007
Severity:           MEDIUM
Confidence:         CONFIRMED (факти) / ENVIRONMENTAL (імовірність)
Category:           Терміни придатності / інфраструктура
Location:           Supabase org jbfxkkrvloaqureojrle (plan free), проєкти forge (ACTIVE), vidbir (ACTIVE), mold (INACTIVE)
Description:        Організація на Free: 2 активних проєкти — ліміт плану вичерпаний (forge +
                    vidbir), третій (mold) уже призупинений. Free-проєкт паузиться після 7 днів
                    без API-запитів; pg_cron усередині бази активністю не вважається і після
                    паузи не виконується (forge-elo-week не підбиватиме тижні → штрафи/бонуси ELO
                    не нарахуються, катап потім наздожене лише те, що вміє elo_catch_up).
                    Реальний трафік: 84–321 запитів/добу з 2–8 адрес, майже все — один
                    користувач (власник). Тобто один тиждень відпустки власника без відкриття
                    сайту (і без інших активних користувачів) = пауза; після відновлення
                    (кнопка в панелі) домен і ключі ті самі, дані на місці, але поки проєкт
                    спить — усі сторінки в хмарному режимі отримують мережеві помилки, а
                    вхід неможливий.
Why it matters:     PROMPT A11 прямо просить оцінити цей ризик.
Reproduction:       get_organization → plan free; list_projects → mold: INACTIVE; query_logs
                    edge_logs по днях (J7) → 2–8 унікальних IP.
Observed:           Ризик реальний і вже матеріалізувався в цій організації для сусіднього проєкту.
Expected:           Або платний план (Pro також дає щоденні бекапи — закриває OPS-001), або
                    зовнішній «пульс» (наприклад, GitHub Actions schedule раз на 3 дні робить
                    один GET до /rest/v1/ з anon-ключем — 0 залежностей, curl уже є).
Root cause:         Тарифна політика Supabase + однокористувацький трафік.
Impact:             Простій до ручного відновлення; пропущені cron-прогони.
Recommended fix:    Короткостроково: job `pulse` у ci.yml на `schedule: '0 4 */3 * *'` —
                    `curl -fsS -H "apikey: $ANON" "$URL/rest/v1/"` де URL і ключ читаються з
                    js/config.js (вони публічні). Не суперечить ci-offline.sh (окремий job без
                    заглушення хостів). Довгостроково — рішення власника про тариф (§1.5).
Regression test:    Через 8 днів після впровадження get_project → ACTIVE_HEALTHY попри відсутність
                    користувацького трафіку (перевіряється лише в реальному часі).
```

### OPS-008 — Нагадування про GitHub PAT спирається на Vercel MCP, який не має доступу до проєкту forge

```text
ID:                 OPS-008
Severity:           LOW
Confidence:         CONFIRMED
Category:           Терміни придатності / моніторинг
Location:           trig_0177qUS6WrJyBrXvkf4tTyp1 («токен GitHub спливає 12 вересня», 2026-09-09T07:00Z); Vercel team mold1
Description:        Токен «MOLD mac» спливає 2026-09-12 (2.3). Нагадування стоїть на 09-09 і має
                    «через Vercel MCP подивитись останній деплой Forge (list_deployments)». Але
                    інтеграція Vercel бачить лише проєкт mold-site-updated: get_project('forge')
                    → 404, list_projects → без forge. Друга половина нагадування (чи жива
                    публікація) відпрацює з помилкою або галюцинацією. Сам термін токена і
                    факт його оновлення з контейнера перевірити не можна (GitHub API → 403).
Why it matters:     Після 09-12 push з Mac відпадає з 403; у поєднанні з OPS-002 і OPS-003
                    зупинка може бути тихою.
Reproduction:       list_teams → mold1; list_projects(team_NzhsIJdicU0EgGebJI3oXARf) → лише
                    prj_ifxbmJjcsGsyXNvxRpSkdIaRgf4p; get_project('forge') → 404.
Observed:           Vercel MCP непридатний для контролю деплоїв Forge.
Expected:           Нагадування перевіряє живість деплою способом, який працює: curl -sI
                    https://forge-mold1.vercel.app/js/config.js → last-modified.
Root cause:         Інтеграції Claude у Vercel не дано доступ до проєкту forge (це фіксувалось
                    ще 2026-08-27 у задачах «Перевірка логіну Vercel»).
Impact:             Хибний або порожній звіт нагадування; сліпа зона моніторингу деплоїв.
Recommended fix:    Оновити prompt задачі (update_trigger): замість list_deployments — curl -sI
                    last-modified; або (панель Vercel, §1.5) дати інтеграції доступ до forge.
Regression test:    fire_trigger з текстом «тест» після правки → відповідь містить дату
                    last-modified.
```

### OPS-009 — legal.html обіцяє необоротне видалення, але бекапи (за задумом) зберігають дані до ~3 місяців і не згадуються в політиці

```text
ID:                 OPS-009
Severity:           LOW
Confidence:         CONFIRMED (на рівні тексту й конфігурації)
Category:           Приватність / право на забуття
Location:           legal.html:136-143; trig_01CNsyKoU1nVWETfN5DsiTGV (ротація: 14 днів + понеділки 3 місяці); js/account.js:1681-1684
Description:        Шлях видалення в UI існує і працює каскадом по всіх 9 таблицях (J8). Але
                    політика каже «видаляє … із бази без можливості відновлення» і не говорить,
                    що щоденна копія бази (з e-mail і профілем) зберігається на компʼютері
                    оператора до ~90 днів після видалення. Крім того, повідомлення в
                    js/account.js:1684 радить «видаліть акаунт у Supabase» — користувач цього
                    зробити не може, кнопка «Видалити акаунт» є поруч.
Why it matters:     Право на забуття декларується ширше, ніж виконується; текст UI вводить в оману.
Reproduction:       sed -n '136,143p' legal.html; list_triggers → КРОК 5 задачі (ротація);
                    sed -n '1680,1685p' js/account.js.
Observed:           Розбіжність між політикою і фактичною ретенцією; застарілий текст підказки.
Expected:           Політика: «копії бази зберігаються до 90 днів»; підказка в account.js
                    вказує на кнопку «Видалити акаунт».
Root cause:         Політика і підказка написані до появи бекапів/кнопки.
Impact:             Юридична неточність; плутанина користувача.
Recommended fix:    legal.html: одне речення про резервні копії й строк; js/account.js:1684 —
                    «…а потім натисніть «Видалити акаунт» нижче». Версію документа в
                    js/legal-versions.js підняти (перевірити, чи це вимагає повторної згоди).
Regression test:    grep -c 'резервн' legal.html ≥ 1; grep -c 'у Supabase' js/account.js = 0.
```



## Статус відомих проблем із розділу 2.3 (перевірено, не відкрито вдруге)

| Що | Статус на 2026-09-06 | Доказ / ризик |
|---|---|---|
| `elo_close_season` привʼязаний до `auth.uid()`, не в cron | **Підтверджено, відкрито.** `cron.job` містить лише `forge-elo-week`; тіло функції починається з `uid uuid := auth.uid()` і `raise exception 'not authenticated'`. | Ризик, якщо сезон не закриється: `season_history`/`awards` не створюються для тих, хто не відкриє застосунок у вікні 2026-12-03 … 2027-02-28. Додатковий нюанс: клієнт (`js/elo-api.js:216-219`) закриває лише **попередній** сезон (`seasonOf(день перед початком поточного)`), тому користувач, що пропустить увесь WINTER-2026, своє AUTUMN-2026 не закриє вже ніколи — сервер при цьому має всі дані. Зараз у `season_state` 1 рядок, тобто матеріальний ризик малий, але він росте з кожним користувачем. Рекомендація до 2026-11-30: `elo_close_season_for(uid, season)` + обгортка + cron `5 0 3 12,3,6,9 *` (як і планувалось у db/cron.sql). |
| Щоденна задача заявок `trig_01RqLZD26Li8dg69AZmAooCA` — FAILED | **Задача видалена.** `list_triggers` (enabled=true / enabled=false / include_completed) її не містить. | Причину провалу з логів знайти неможливо — історія запусків видаленої задачі через API недоступна. Якщо функція «нагадувати про заявки» потрібна — її зараз не існує взагалі; якщо ні — пункт закрити як «прибрано». |
| Дві бойові сесії з `t0 === t1` | Не в цьому домені (history/stats). | — |
| Щоденний бекап `trig_01CNsyKoU1nVWETfN5DsiTGV` — `no_signed_approval`, пише лише в хмару | **Гірше, ніж описано:** останній запуск FAILED, сповіщення вимкнені, відновлюваного бекапу довести не можна. | OPS-001. |
| GitHub PAT «MOLD mac» спливає 2026-09-12 | **Підтверджено як операційний ризик.** Нагадування стоїть на 2026-09-09T07:00Z (push+email). Дату/стан токена з контейнера перевірити не можна (GitHub API 403). | Після 09-12: перший push з Mac → 403 → одне сповіщення «GitHub не пустив» → далі тиша (OPS-002). Друга половина нагадування (Vercel MCP) не працює (OPS-008). CI на GitHub від токена не залежить (використовує GITHUB_TOKEN). |
| Кеш прев'ю Telegram | INFO, не витрачав час. | — |
| CI не є воротами деплою | **Класифіковано: сповіщення.** Рішення без нових залежностей — OPS-004. | — |


## Restore drill для Phase B (покроково; на бойовій базі НЕ виконувати)

Передумови: свіжий файл `forge-backup-РРРР-ММ-ДД.json` (з Mac, `~/Desktop/forge-backups/`,
переданий у контейнер вручну — не через теку релізу) або згенерований у Phase B
SELECT-ом із `db/backup-export.sql`; локальний Postgres 17 у контейнері
(`apt`/`docker` недоступні? — тоді Supabase branch, якщо він доступний без платного
тарифу; інакше `pg_ctl` з пакета `postgresql-17`, перевірити наявність).

1. **Структурна цілісність файла.** `node -e 'const b=require("./f.json");
   for (const k of ["users","account_status","profiles","elo_events","season_state",
   "season_history","awards","consent_log","elo_week_plan","elo_config","admins"])
   if(!Array.isArray(b[k])) throw k; for (const k in b.counts) if (b[k].length!==b.counts[k])
   throw "count "+k;'` — файл валідний JSON, усі 11 масивів є, `counts` збігаються з
   довжинами масивів, `format_version === 1`, `counts.users ≥ 1`.
2. **Порожня схема.** Розгорнути `db/schema.sql` + міграції в порядку
   `list_migrations` (порівняти з `db/*.sql`; дрейф — окрема знахідка домену db) у
   локальний Postgres. Створити ролі `anon`, `authenticated`, `service_role`, схему
   `auth` з мінімальною таблицею `auth.users(id uuid pk, email text, …)` та функцією
   `auth.uid()`; або використати образ `supabase/postgres`.
3. **Завантаження.** `\set content` → `create temp table b(j jsonb); insert …;`
   Далі для кожної таблиці: `insert into public.<t> select * from
   jsonb_populate_recordset(null::public.<t>, (select j->'<t>' from b)) on conflict do
   nothing;` у порядку FK: `auth.users` → `admins`, `account_status`, `profiles`,
   `consent_log`, `season_state`, `elo_events`, `season_history`, `awards`,
   `elo_week_plan`, `elo_config`.
4. **Послідовності.** `select setval('elo_events_id_seq', (select max(id) from
   elo_events));` те саме для `consent_log_id_seq`.
5. **Звірка.** Кількості рядків у кожній таблиці = `counts`; `select count(*) from
   profiles p left join auth.users u on u.id=p.user_id where u.id is null` = 0
   (жодних сиріт); `elo_state()` під імпersonацією одного користувача
   (`set local role authenticated; select set_config('request.jwt.claims',
   '{"sub":"<uid>","role":"authenticated"}', true)`) повертає ті самі `elo`,
   `season`, що і в `season_state` файла.
6. **Те, що НЕ відновиться, — зафіксувати:** паролі (людина проходить «Забули
   пароль?» — але для цього GoTrue має бачити користувача: без `auth.identities`,
   `raw_app_meta_data.provider=email`, `aud='authenticated'`, `role='authenticated'`,
   `instance_id` відновлений рядок `auth.users` може не працювати для входу).
   Це перевіряється лише на Supabase branch/новому проєкті з реальним GoTrue —
   і саме тому експорт треба розширити (OPS-001, пункт г) до того, як бекап
   вважатиметься відновлюваним.
7. **Негативна перевірка.** Обрізати файл посередині → крок 1 має впасти на
   `count`; підмінити `user_id` у `profiles` на невідомий uuid → крок 3 має впасти
   на FK, а не вставити сироту.

## Спостереження (INFO)


- Vercel: team `mold1` на плані **hobby**; Vercel MCP не бачить проєкт `forge` (доступ
  інтеграції не наданий). Заголовки продакшену збігаються з `vercel.json`; HSTS
  `preload`, CSP без `unsafe-eval`, `X-Robots-Tag: noindex` (навмисно).
- `.vercelignore` працює: `db/`, `tools/`, `.github/`, `backup-*.json` → 404 на бойовому
  домені; `tools/ci-hygiene.mjs` стежить, щоб рядки не зникли (перевірено: «чисто,
  2515 файлів»).
- `npm test`: 483 тести / 125 suites / 0 fail за 4,1 с; `node tools/ci-hygiene.mjs` — rc 0.
  RELEASE.md:48,52,84 («226 модульних тестів», «Дев'ять скриптів», «Немає service worker»)
  застарів: тестів 483, verify-скриптів 36, `sw.js` існує з 2026-08-29.
- Хмарний репозиторій на гілці `master`, Mac пушить `main` (`auto-publish.sh:BRANCH`),
  `ci.yml` слухає `main` — узгоджено; `master` у хмарі — лише локальна назва.
- Anon-ключ у `js/config.js`: JWT `iat` 2026-08-27, `exp` 2036-08-26 — не близький термін.
- Supabase Auth: підтвердження пошти увімкнене; Site URL/allow-list полагоджено
  2026-09-04 17:26Z (до того 2 реальних користувачі після підтвердження потрапили
  на `http://localhost:3000` — це вже описано в `js/store.js:531-550`); ліміт листів
  30/год (custom SMTP; провайдер із логів не видно — GoTrue його не логує;
  у репозиторії провайдер пошти не задокументований ніде, окрім згадки в PROMPT
  про ключ Resend); помилок доставки в логах немає; `auth_leaked_password_protection`
  вимкнено (функція Pro-плану).
- Логи Supabase доступні через `query_logs` щонайменше за 10 днів (документація
  Free-плану обіцяє 1 день — розраховувати на це не варто). Sentry: 8 подій за весь
  час, квота не під загрозою; регіон EU (de.sentry.io) — збігається з legal.html.
- GitHub Actions: хвилини не перевірити (403). Оцінка з ci.yml: нічний `browser-full`
  до 60 хв × 30 = до 1800 хв/міс + `browser` (~8 хв з установленням Playwright) на
  кожен push; при автопублікації по «тиші» (≥10 пушів/день) сумарно >2000 хв/міс —
  ліміт Free для **приватного** репозиторію. Якщо репозиторій приватний, CI
  зупиниться посеред місяця мовчки (деплой при цьому продовжиться — OPS-004).
  Публічність репозиторію з контейнера не встановити.
- Пари одночасних `refresh_token`-запитів (J4) — дві вкладки оновлюють токен
  паралельно; обидва 200 завдяки reuse-interval GoTrue. Домен sync варто врахувати.
- `account_status.decided_by` без FK: після видалення адміна лишається uuid, який
  ні на що не вказує (не персональні дані, але сирітське посилання).
- Задачі «Аудит: контрольна копія звітів» (5 одноразових, `run_once_fired`) і
  «Перевірка логіну Vercel» ×3 (серпень) — службові, до продакшену не стосуються.


---

## Журнал перевірок (сирі факти, за порядком виконання)

### J1. Supabase — проєкт
`get_project(sojbyoxcxyiollefupss)`: name `forge`, region `eu-north-1`,
status `ACTIVE_HEALTHY`, Postgres `17.6.1.165`, created `2026-08-27T02:30:54Z`.
Тариф API не повертає; за `db/backup-export.sql:3` і текстом бекап-задачі —
Free («Free-план Supabase не робить автоматичних бекапів узагалі»).

### J2. Supabase — cron
`select * from cron.job` → рівно 1 задача: `jobid=1 forge-elo-week`,
`10 0 * * *`, `select public.elo_cron_eval_week()`, active=true.
`cron.job_run_details` → 2 запуски, обидва `succeeded`, `return_message='1 row'`:
2026-09-05 00:10:00 (77 мс), 2026-09-06 00:10:00 (6 мс).
`elo_close_season(text)` — SECURITY DEFINER, тіло містить `uid uuid := auth.uid()`
і `if uid is null then raise exception 'not authenticated'` → у cron
запустити неможливо (підтверджено 2.3). `season_bounds('AUTUMN-2026')` →
e = 2026-11-30; `elo_config.submitWindowDays = 2` → закриття можливе з 2026-12-03.
Стан бази: `auth.users` = 3, `profiles` = 2, `account_status` approved = 2,
`season_state` AUTUMN-2026 = 1 рядок, `elo_events` = 2, `season_history` = 0,
`awards` = 0.

### J3. Заплановані задачі (Claude Code Remote, `list_triggers`)
- `trig_01CNsyKoU1nVWETfN5DsiTGV` «Forge: щоденна резервна копія бази»,
  cron `0 1 * * *`, enabled=true, `notifications: {push:false, email:false}`,
  `last_run: FAILED`, fired 2026-09-06T01:04:35Z, finished 01:04:43Z (8 с),
  session `cse_01CMZosztNGNbmMwybEPKtBf`. Наступний запуск 2026-09-07T01:04Z.
  Текст задачі: execute_sql → JSON → SendUserFile → `device_commit_files` у
  `/Users/matthew/Desktop/forge-backups/` → ротація через `device_bash`.
- `trig_0177qUS6WrJyBrXvkf4tTyp1` «Forge: токен GitHub спливає 12 вересня» —
  одноразове нагадування на 2026-09-09T07:00Z, push+email увімкнені.
- `trig_01RqLZD26Li8dg69AZmAooCA` (щоденна задача заявок з 2.3) — **відсутня**
  і серед enabled, і серед disabled/completed (`include_completed=true`).
  Задачу видалено; історія запусків через API недоступна.

### J4. Supabase Auth — логи (query_logs, вікна по 24 год, 2026-08-27 … 09-06)
Поле `referer` в auth_logs GoTrue заповнює як *ефективний* redirect
(`redirect_to`, якщо він в allow-list; інакше HTTP Referer, якщо в allow-list;
інакше Site URL).
- До 2026-09-04 17:26Z усі запити реальних користувачів (IP з UA-мереж) мали
  `referer = http://localhost:3000` — тобто Site URL був дефолтним, а
  `redirect_to=…/welcome.html` з `js/store.js:552-568` відкидався.
  Зокрема два підтвердження пошти `GET /verify → 303` (2026-09-04 12:41:53 і
  13:11:10, `user_signedup`) відправили людей на `http://localhost:3000`.
- 2026-09-04 11:36:25Z: `env GOTRUE_RATE_LIMIT_EMAIL_SENT changed, updating
  Email limiter from 2/1h to 30` — ліміт листів піднято з 2/год до 30/год
  (у Supabase це можливо лише з custom SMTP).
- 2026-09-04 17:26:21Z і 17:26:51Z: `reloading api with new configuration`;
  після цього `referer = https://forge-mold1.vercel.app/` і
  `POST /recover 200` о 17:32:36Z з `referer = https://forge-mold1.vercel.app/welcome.html`
  → redirect_to на welcome.html тепер приймається. Site URL/allow-list полагоджено.
- Підтвердження пошти **потрібне**: signup → `user_confirmation_requested`,
  далі `GET /verify 303` → `user_signedup`, `email_confirmed_at` заповнюється
  через 18–50 с після `confirmation_sent_at` (3 з 3 користувачів підтверджені).
- 429: один `POST /resend` 2026-09-04 13:11:05Z, `over_email_send_rate_limit`,
  «you can only request this after 54 seconds» — це per-user cooldown 60 с,
  не глобальний ліміт.
- 400: два `POST /token grant_type=password` `invalid_credentials`
  2026-09-04 19:05; один `refresh_token_not_found` 13:10:02.
- Помилок доставки листів (SMTP/mail error) у логах немає.
- Пари `POST /token grant_type=refresh_token` в одну секунду з одного IP
  (2026-09-05 16:42:57/58, 2026-09-06 13:25:39 ×2) — паралельне оновлення
  токена двома вкладками/запитами; обидва 200 (reuse interval GoTrue рятує).
- `auth.audit_log_entries` порожня (Supabase пише аудит лише в лог-дрейн).
- Логи в `query_logs` доступні щонайменше з 2026-08-27 (10 днів).

### J5. Vercel
`list_teams` → team `mold1` (`team_NzhsIJdicU0EgGebJI3oXARf`), plan **hobby**.
`list_projects(mold1)` → лише `mold-site-updated` (repo `matwhh/MOLD`).
`get_project('forge')` → 404; `get_deployment('forge-mold1.vercel.app')` → 404.
Інтеграції Vercel MCP не дано доступу до проєкту `forge` — усі Vercel-перевірки
(deployment protection, список деплоїв, runtime errors, build logs) з MCP
неможливі. Те саме стосується нагадування `trig_0177…`, яке має «подивитись
через Vercel MCP останній деплой проєкту Forge» — воно теж отримає 404.
curl -sI до https://forge-mold1.vercel.app (9 запитів): `/`, `/index.html`,
`/sw.js` — 200, `x-vercel-cache: HIT`, `last-modified: Sun, 06 Sep 2026 11:24:13 GMT`;
`/js/config.js`, `/admin.html` — `x-vercel-cache: MISS`,
`last-modified: Sun, 06 Sep 2026 16:32:42 GMT` → сьогодні було щонайменше два деплої
(≈11:24Z і ≈16:32Z), автопублікація жива. `/db/schema.sql`,
`/backup-forge-2026-09-01.json`, `/.github/workflows/ci.yml`,
`/tools/auto-publish.sh` → 404 (`.vercelignore` працює, витік бекапу закрито).
CSP, HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`,
`X-Robots-Tag: noindex, nofollow` (навмисно — robots.txt пояснює) — збігаються з
`vercel.json`. `vercel.json` не має `ignoreCommand`/`git.deploymentEnabled`.

### J6. Sentry
`find_organizations` → org `mold-t1`, region `https://de.sentry.io` (EU).
`find_projects` → `forge`. Квота/тариф через MCP недоступні (каталог
`search_sentry_tools` не має інструмента org/quota).
`search_events(errors, 90d)` → усього **8 подій, 4 issues**:
FORGE-1 «ForgeSetupCheck» (тестова, resolved), FORGE-2/3/4 — одна й та сама
`TypeError: undefined is not an object (evaluating 'r["@context"].toLowerCase')`
на `/calculator.html`, `/nutrition.html`, `/cardio.html` (7 подій, 2026-09-04
00:43 … 09-05 13:57), усі 7 — Safari 18.4 / Mac OS X, стек
`code@…/nutrition.html:3:362` (рядок 3 nutrition.html — це `<head>`, там JS
немає → код не Forge, а інжектований у сторінку). Ці три сторінки — рівно ті,
де `js/app.js:378-393 injectJsonLd()` вставляє JSON-LD **масивом**
`[WebSite, WebApplication]`, а не обʼєктом; решта сторінок віддають один обʼєкт
і подій не мають.
PII в подіях: клієнт (`js/errors.js`) не шле `user`, але Sentry сам виводить
`user: ip:31.144.xx.xx (скорочено)` + `user.geo: UA` (Relay за замовчуванням додає IP для
platform=javascript, якщо в проєкті не ввімкнено «Prevent Storing of IP
Addresses»). У breadcrumbs/extra — нічого (клієнт їх не шле). Токенів,
e-mail, ніків у 3 переглянутих подіях немає. `legal.html:125-134` обіцяє, що
звіти «не повʼязуються з конкретним користувачем» і не згадує IP серед того,
що йде в Sentry.

### J7. Supabase Auth — інші факти
`get_advisors(security)`: `auth_leaked_password_protection` WARN (вимкнено;
у Supabase це функція Pro-плану) — решта (SECURITY DEFINER × 22,
`elo_week_plan` без політик) належить домену db/rls.
Трафік (edge_logs): 2026-08-30 — 84 запити/8 IP; 08-31 — 215/7; 09-04 — 143/4;
09-05 — 321/2; 09-06 (до 16:00Z) — ~50/3. Тобто ~100–300 API-запитів на добу
від 2–8 адрес, здебільшого один активний користувач.

### J8. Видалення акаунта
UI: `account.html` → `#p-delete-acc` → `js/account.js:1694-1716` (confirm +
слово «ВИДАЛИТИ») → `Store.deleteAccount()` (`js/store.js:1108`) →
`rpc('delete_account')` → `clearIdentityData()`.
SQL: `public.delete_account()` SECURITY DEFINER, `delete from auth.users where id = uid`,
захист LAST_ADMIN; `has_function_privilege('authenticated', …, 'execute') = true`,
для `anon` — false.
FK на `auth.users(id)` у live-схемі — 9 таблиць, усі `ON DELETE CASCADE`:
profiles, season_state, elo_events, season_history, awards, account_status,
admins, consent_log, elo_week_plan. `account_status.decided_by uuid` — без FK
(після видалення адміна лишається «висячий» uuid; це не персональні дані).
Каскадне видалення в транзакції з відкатом НЕ виконувалось (правило 1.1
«жодного видалення користувачів»); доказ — декларативний (confdeltype='c').

### J9. GitHub
`api.github.com` з контейнера відповідає 403 «GitHub access to this repository
is not enabled for this session» — історія прогонів Actions, статус токена
й дата його закінчення з контейнера не перевіряються.

### J10. Supabase — організація й тариф
`get_organization(jbfxkkrvloaqureojrle)` → name `MOLD`, **plan: free**.
`list_projects` → 3 проєкти в організації: `vidbir` (eu-central-1, ACTIVE_HEALTHY,
створено 2026-09-03), `mold` (eu-north-1, **INACTIVE** — призупинений),
`forge` (ACTIVE_HEALTHY). Free-план дозволяє 2 активних проєкти на організацію;
квоти (500 MB БД, 5 GB egress, 50 000 MAU, 1 день зберігання логів за
документацією) спільні на організацію. Факт паузи `mold` показує, що механізм
паузи в цій організації вже спрацьовував.

### J11. Бекап — що можна довести
- Єдиний механізм: задача `trig_01CNsyKoU1nVWETfN5DsiTGV` (J3). Записів про
  успішний запуск немає: API показує лише `last_run` = FAILED (2026-09-06,
  тривалість 8 с — до кроку з SQL дійти не встигла б); запуск 2026-09-05 01:04
  ніде не зафіксований.
- Слідів експортного запиту в `postgres_logs` за 2026-09-05 і 09-06 немає
  (pg-meta логує лише помилки, тому це не доказ відсутності, але й не доказ наявності).
- У контейнері/хмарному репозиторії жодного `forge-backup-*.json` /
  `backup-*.json` (find по /, `-xdev`). Дамп для перевірки цілісності недоступний;
  на Mac, куди задача мала б класти файл, за правилами аудиту не заглядаю.
- Експортний запит `db/backup-export.sql` виконується (перевірено як SELECT,
  повернуто лише структуру): 15 ключів, `users`=3, `profiles`=2 (22 951 байт),
  `elo_events`=2, `consent_log`=3, `elo_week_plan`=1, `admins`=1, `elo_config`=1,
  `season_state`=1, `awards`=0, `season_history`=0; усі 10 таблиць `public`
  охоплені. Розмір ~28 КБ.
- Що НЕ експортується і що потрібно для відновлення: `auth.identities`
  (3 рядки — GoTrue тримає там провайдера `email`), `auth.users.raw_app_meta_data`
  / `raw_user_meta_data` / `aud` / `role` / `instance_id`, `encrypted_password`
  (навмисно), стан послідовностей `elo_events_id_seq`, `consent_log_id_seq`.
- Процедури відновлення (скрипт або інструкція «JSON → таблиці») в репозиторії
  немає: grep `restore|відновл` по db/, tools/, README.md, RELEASE.md дає лише
  згадки про відновлення локального профілю з `ib.profile.backup`.

### J11a. Бекап — повторна перевірка (другий прогін агента, 2026-09-06)
`list_triggers(enabled=true)` повторно: `trig_01CNsyKoU1nVWETfN5DsiTGV` —
`last_run.status = ROUTINE_RUN_STATUS_FAILED`, `notifications {push:false,email:false}`,
`next_run_at 2026-09-07T01:04Z` — без змін. Новий факт: у задачі
`derived_state.folders_state = "FOLDERS_STATE_NONE"`, `folders: []` — задача
**не привʼязана до компʼютера** (створена через `meta_mcp` без `requires_local_device`).
Кроки 4–5 її тексту (`mcp__remote-devices__device_commit_files`, `device_bash`)
у такому режимі недоступні за побудовою — це узгоджується зі станом
`no_signed_approval` з 2.3 і з тривалістю 8 с. Привʼязку до пристрою додати
після створення не можна (документація `create_trigger`): задачу треба
створити заново з `requires_local_device=true` — точка зупинки §1.5.
Це уточнює Root cause OPS-001: навіть за успішного SQL файл на Mac не потрапить
ніколи; у кращому разі він лишиться у SendUserFile сесії задачі, яку ніхто не читає.

Також повторно: `cron.job` — 1 задача `forge-elo-week` (`10 0 * * *`, active);
`get_project` — `ACTIVE_HEALTHY`, `eu-north-1`, PG 17.6.1.165; Vercel
`list_projects(mold1)` — лише `mold-site-updated`; `legal.html:124-142` — текст
про Sentry («не повʼязуються з конкретним користувачем») і видалення
(«без можливості відновлення») незмінний; термін зберігання подій Sentry і
логів Supabase у політиці не названий («за їхніми політиками»).

### J12. auto-publish.sh — моделювання відмов (копія в /tmp/audit-ops, bare-remote, без мережі)
1. Запит `.forge-publish` + зміна, node є → тести (4.8 с) → коміт → push → лог
   «опубліковано (запит)». OK.
2. Push відхилено (pre-receive імітує «Invalid username or token … Authentication
   failed») → коміт створено локально, лог «PUSH НЕ ВДАВСЯ», rc=1, `notify()`
   (на Linux osascript відсутній — мовчки). **Наступний прогін без нових змін:
   rc=0, жодного повторного push, коміт лишається неопублікованим**
   (`git log origin/main..HEAD` = 1). Після «полагодження токена» (хук знято)
   і ще одного прогону — те саме: rc=0, 1 неопублікований коміт.
   `autopublish-status.command` при цьому друкує «Зміни: немає — усе вже на
   GitHub» (бо дивиться лише `git status --porcelain`), і лише нижче показує
   «Остання помилка відправки» зі старого push.log.
3. TCC (немає доступу до теки): гілка коду `auto-publish.sh:104-108` пише
   `blocked`, рядок у лог і `exit 1` — **без `notify()`**. На Linux відтворити
   відмову читання не вдалось (git status під `nobody` з chmod 311 проходить).
4. Зламаний тест + запит → `failed` з відбитком, лог «ЗУПИНЕНО: юніт-тести не
   пройшли», rc=1, `.forge-publish` лишається; повторний прогін того самого
   стану → rc=0 мовчки (за задумом), сповіщення одне.
5. node відсутній/старий → `run_tests` повертає 0 → коміт і push **без тестів**
   (`auto-publish.sh:150-162`, задокументовано в коментарі). Не відтворювалось
   (PATH зашитий, node не сховати), поведінка однозначна з коду.
6. Два прогони одночасно → `mkdir lock` → один коміт «паралельно», другий
   вийшов мовчки. OK.
7. Часткова доставка: гілка «тиша» (QUIET_SECONDS=300) комітить будь-який стан
   дерева, якщо файли не мінялись 5 хв — доставка з хмари, що зависла на
   >5 хв посеред пакета, буде опублікована частково. Файл-запит це обходить
   лише якщо доставка його не кладе заздалегідь. Не відтворювалось.
