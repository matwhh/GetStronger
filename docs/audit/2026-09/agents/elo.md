# Аудит домену «Економіка ELO / рейтинг» (Phase A, лише читання)

Дата: 2026-09-06. Проєкт Supabase: `sojbyoxcxyiollefupss`. Гілка: `master`.
Префікс знахідок: `ELO-`.

## Обсяг і метод

1. Прочитано весь код ELO в репозиторії: `db/elo-engine.sql`, `db/elo-authoritative.sql`,
   `db/elo-proportional.sql`, `db/elo-integrity.sql`, `db/elo-catchup.sql`, `db/admin-elo.sql`,
   `db/admin-elo-anomalies.sql`, `db/cron.sql`, `db/account-approval.sql`,
   `db/security-hardening-2.sql`, `db/leaderboard-name.sql`, `db/nick-length.sql`,
   `db/elo-config.json`; клієнт `js/elo-core.js`, `js/elo-api.js`, `js/elo-hooks.js`,
   `js/season.js`, `js/season-core.js`, `js/store.js` (RPC), `js/admin-elo.js`.
2. Живу базу звірено з репозиторієм: `pg_proc.prosrc` для 29 функцій (`elo_*`, `season_*`,
   `admin_elo_*`, `is_approved`, `is_admin`), `pg_constraint`, `pg_indexes`,
   `information_schema.columns`, `cron.job`, `cron.job_run_details`, `list_migrations`.
3. Побудовано **локальну пісочницю** (PostgreSQL 16, `/tmp/audit-elo/`, порт 5499) з
   `db/*.sql` у порядку міграцій + функціями, яких у репозиторії немає (скопійовано з
   `pg_proc` живої бази). Після нормалізації (без коментарів і пробілів) md5 тіл 28/29 функцій
   збігаються з живою базою; єдина відмінність — блочний коментар усередині `elo_leaderboard`
   у `db/leaderboard-name.sql`. Пісочниця потрібна для сценаріїв «інший день тижня / інший
   сезон», які на бойовій базі неможливо відтворити без зміни системної дати.
4. Проби на бойовій базі — виключно `BEGIN … ROLLBACK` з `set local role authenticated` +
   `set_config('request.jwt.claims', …)`; результати повертались через `RAISE EXCEPTION`.
5. Стандарт доказу: CONFIRMED — відтворено (запит/скрипт/вивід у звіті); POSSIBLE — обґрунтована
   підозра з коду.

## Модель економіки ELO (як вона є станом на 2026-09-06)

**Хто нараховує.** Єдина точка запису — `public.elo_submit(p_kind, p_action_key, p_day, p_payload)`
(SECURITY DEFINER, `authenticated`, вимагає `is_approved(auth.uid())`). `p_action_key` і
`p_payload` **ігноруються** (лишились у сигнатурі для сумісності черг у браузерах); факти
сервер бере з `profiles.data` (`sessionLog`, `mealLog`, `trackerLog`, `trackers`) через
`elo_facts()`. Ідентичність події — `(user_id, event_type, day)`, `event_type` виводиться з
`p_kind`; фізично забезпечено partial UNIQUE INDEX `elo_events_identity` (`event_type <> 'admin'`)
і рядковим блокуванням `season_state … FOR UPDATE`.

**За що і скільки** (`elo_config.data`, дзеркало `db/elo-config.json`): `weeklyBudget = 200`,
`categoryShare = 0.857` → 171.4 на дії, решта ~28.6 на бонуси. Ваги: training 0.3, nutrition 0.3,
sleep 0.2, recovery 0.1, activity 0.1. Тренування: лінійно `51.42 / planned × doneSets/totalSets`
(або `done/total`, якщо підходів немає); мінімум 3 вправи (`floors.workoutTotalMin`). Харчування:
`7.35/день × (band(kcal) × 0.55 + ladder(protein) × 0.45)`; без `pTarget` калорії беруть 100 %.
Сон: `4.9/день × ladder(minutes/goal)`, ціль не нижче 240 хв, значення не вище 960. Recovery:
`2.45/день × (0.6 + 0.4 якщо ≥ 7)`. Кроки: `2.45/день × ladder(steps/goal)`, ціль ≥ 3000, ≤ 100000.

**Ліміти.** `dayGainCap = 45` (сума позитивних дельт дня, крім `admin`); тижневий бюджет
тренувань 51 (`category = 'training'`, ISO-тиждень від `p_day`); єдиний тижневий бюджет усього
позитивного ELO 200 (`elo_week_room`, включно з бонусами); `seasonMax = 2500` (least() + CHECK).
`planned` — знімок тижня в `elo_week_plan` (3..7), пишеться сервером при першому дотику тижня.
Реконсиляція лише вгору: повторний submit тієї самої події доплачує `intended − paid`.

**Вікно подання** `submitWindowDays = 2`: `current_date − 2 ≤ p_day ≤ current_date + 1`, і сезон
`p_day` ∈ {сезон сьогодні, вчора, завтра}. `current_date` — UTC (TimeZone бази = `UTC`,
`rolconfig` ролі `authenticated` = лише `statement_timeout=8s`).

**Тиждень.** `elo_eval_week_for(uid, monday, cfg)`: штраф `−8 × missed`, бонус чистого тижня 9
(у межах `elo_week_room`), маркер — рядок `event_type = 'week'`, `day = неділя`. Викликається з
трьох місць: (a) `elo_catch_up_weeks` усередині **кожного** `elo_submit` — для всіх тижнів від
`date_trunc('week', min(day))` до сьогодні з умовою `w + 6 < current_date`; (b) RPC `elo_catch_up()`
з клієнта раз на добу (`js/elo-api.js → evaluateWeeks`); (c) `elo_cron_eval_week()` через
pg_cron `forge-elo-week` щодня о 00:10 UTC — з умовою `today > wk + 6 + submitWindowDays`.
Маркер робить оцінку остаточною: пізніші події тиждень не переоцінюють.

**Сезон.** `season_of(date)` — квартали SPRING/SUMMER/AUTUMN/WINTER; `elo_close_season(p_season)`
— від `auth.uid()`, лише після `season_end + submitWindowDays`, пише `season_history` + `awards`.
Клієнт кличе її з `closeSeasonIfDue()` при заході.

**Cron у живій базі.** `cron.job`: `forge-elo-week`, `10 0 * * *`, `select public.elo_cron_eval_week()`,
active. `job_run_details`: 2 запуски (2026-09-05, 2026-09-06), обидва `succeeded`.

**Стан даних.** `season_state`: 1 рядок; `elo_events`: 2 рядки (обидва `workout`, user `3ed0794f…`);
`elo_week_plan`: 1; `season_history`: 0; `awards`: 0; approved-акаунтів: 2.

## Знахідки

### ELO-001 — Тиждень оцінюється при першому дотику сервера в понеділок (UTC), доки вікно подання за неділю ще відкрите: чесна неділя штрафується як пропуск

```text
ID:                 ELO-001
Severity:           HIGH
Confidence:         CONFIRMED (пісочниця з живими тілами функцій; current_date підмінено на sim_today())
Category:           бізнес-логіка / економіка ELO / дата-час
Location:           db/elo-integrity.sql:262-284 (elo_catch_up_weeks: умова `w + 6 < current_date`),
                    db/elo-integrity.sql:332 (elo_submit → perform elo_catch_up_weeks ДО нарахування),
                    db/elo-catchup.sql:22-37 (RPC elo_catch_up), js/elo-api.js:187-197 (evaluateWeeks на кожному
                    завантаженні), js/elo-hooks.js:176-182 (порядок init: evaluateWeeks → sync);
                    контраст: elo_cron_eval_week (жива база, у репозиторії відсутня): `today <= wk + 6 + swd → continue`
Description:        Дизайн (db/cron.sql, коментар у elo_cron_eval_week) каже: тиждень придатний до оцінки лише коли
                    current_date > неділя + submitWindowDays, бо неділю можна здати ще 2 дні. Але elo_catch_up_weeks
                    (яку кличе КОЖЕН elo_submit і RPC elo_catch_up на кожному завантаженні сторінки) оцінює тиждень,
                    щойно `w + 6 < current_date`, тобто з 00:00 UTC понеділка (03:00 Києва). Порядок у elo_submit:
                    спершу catch-up (штраф), потім нарахування за подану подію. Маркер 'week' робить оцінку остаточною.
Why it matters:     Будь-яка подія за неділю, що потрапляє на сервер після 03:00 Києва понеділка (офлайн-черга,
                    сесія без `end`, яку js/elo-hooks.js:91 подає лише наступного дня, «Закрити день» харчування
                    зранку за вчора — js/meals.js:1256 явно підтримує цей сценарій), рахується як пропуск: −8 за
                    тренування, втрата +9 чистого тижня. Користувач бачить у журналі «Недобір тренувань: 1 пропуск(и)»
                    одразу перед «Тренування виконано» за той самий тиждень.
Reproduction:       /tmp/audit-elo/s2.sql → ні, /tmp/audit-elo/s1.sql (пісочниця forge_sim):
                    план 3; тренування 09-08, 09-10 подані в день; тренування 09-13 (нд) подане 09-14 (пн, у вікні).
                    psql -h /tmp/audit-elo -p 5499 -U postgres -d forge_sim -f /tmp/audit-elo/s1.sql
Observed:           2026-09-08 workout +17; 2026-09-10 workout +17; 2026-09-13 week −8 «Недобір тренувань: 1 пропуск(и)»;
                    2026-09-13 workout +17. Підсумок 43 замість 51.
Expected:           Тиждень не оцінюється, доки current_date ≤ неділя + submitWindowDays (як у elo_cron_eval_week);
                    третє тренування закриває план, штрафу немає.
Root cause:         Дві реалізації одного правила з різними умовами придатності тижня: elo_catch_up_weeks
                    (`w + 6 < current_date`) і elo_cron_eval_week (`today > wk + 6 + swd`). Клієнтський/submit-шлях
                    завжди випереджає cron.
Impact:             Систематичний несправедливий штраф (−8) і втрата бонусу (+9) для активних користувачів; економіка
                    залежить від того, о котрій людина відкрила застосунок у понеділок. Псується довіра до рейтингу.
Recommended fix:    У elo_catch_up_weeks використати ту саму умову, що й у cron: `w + 6 + (cfg->>'submitWindowDays')::int
                    < current_date`. Одна умова — в одному місці (helper `elo_week_final(w, cfg)`), обидва шляхи її
                    викликають.
Regression test:    SQL-тест у db/elo-integrity-tests.sql: у понеділок (sim) submit за неділю → жодного рядка
                    event_type='week' за той тиждень; у середу — рядок є, missed = 0.
```

### ELO-002 — elo_cron_eval_week штрафує кожного схваленого користувача за тижні ДО його реєстрації / першої події

```text
ID:                 ELO-002
Severity:           HIGH
Confidence:         CONFIRMED (пісочниця, ті самі тіла функцій; current_date → sim_today())
Category:           бізнес-логіка / економіка ELO / cron
Location:           жива база: public.elo_cron_eval_week(p_weeks_back int default 4) — цикл
                    `for r in select user_id from account_status where status = 'approved'` × останні 4 тижні;
                    db/cron.sql (тільки документація, тіла функції в репозиторії НЕМАЄ);
                    контраст: db/elo-catchup.sql:8-13 (явно описана саме ця діра і її закриття через min(day))
Description:        Cron кличе elo_eval_week_for(user, wk) для ВСІХ схвалених акаунтів за 4 останні тижні сезону без
                    прив'язки до дати реєстрації чи першої події користувача. elo_eval_week_for не має власної
                    прив'язки (це визнано в коментарі elo-catchup.sql). Результат: користувач, який зареєструвався
                    в середині сезону, отримує −8 × planned за кожен повний тиждень сезону до реєстрації.
Why it matters:     Новачок втрачає все зароблене за перший тиждень (ELO має підлогу 0, тож фактично обнуляється),
                    а в журналі бачить «Недобір тренувань: 3 пропуск(и)» за дати, коли акаунта ще не було.
                    Крім того, для всіх схвалених акаунтів без жодної події створюються рядки season_state
                    (0 ELO) — вони потрапляють у лідерборд і в знаменник percentile при закритті сезону.
Reproduction:       /tmp/audit-elo/s2.sql (пісочниця forge_sim): реєстрація 2026-09-17 (чт), план 3, тренування
                    09-17 і 09-19 (+17 +17 = 34). Пн 09-21 клієнтський elo_catch_up → −8 (тиждень реєстрації, окремо
                    LOW нижче). Ср 09-23 elo_cron_eval_week() → weeks ["2026-09-14","2026-09-07","2026-08-31"].
Observed:           після cron: week 2026-09-13 −24, week 2026-09-06 −24; elo = 0 (було 34).
                    cron повернув {"ok":true,"evaluated":2,"duplicate":1}.
Expected:           Тижні до першої події (або до account_status.decided_at) не оцінюються — як робить
                    elo_catch_up_weeks через date_trunc('week', min(day)).
Root cause:         elo_cron_eval_week (міграція elo_cron_eval_week, 2026-09-04) обходить захист, реалізований у
                    elo_catch_up_weeks, і викликає низькорівневу elo_eval_week_for напряму.
Impact:             Кожен акаунт, схвалений не в перший тиждень сезону, обнуляється в першу ж середу; на живій базі
                    2026-09-09 cron оцінить тиждень 08-31 для обох схвалених акаунтів (для a4c5… — без жодної події:
                    −24 → 0 і рядок у season_state).
Recommended fix:    У elo_cron_eval_week ітерувати не account_status, а пари (user_id, season_start) з
                    elo_catch_up_weeks-логікою: `perform elo_catch_up_weeks(uid, season_of(today), cfg)` для
                    користувачів, у яких є хоч одна подія в сезоні; або в elo_eval_week_for додати guard
                    `p_week_start + 6 < (select min(day) …)` → 'before_first_event'.
Regression test:    SQL: користувач з першою подією у тижні N; cron із today у тижні N+2 → рядки 'week' лише для
                    тижнів ≥ N; для акаунта без подій — жодного рядка season_state/elo_events.
```

### ELO-003 — Нечислове або дробове `activePlan.days` / `daysPerWeek` у профілі валить elo_planned_for → усі elo_submit нового тижня і elo_catch_up падають з 500

```text
ID:                 ELO-003
Severity:           MEDIUM
Confidence:         CONFIRMED (бойова база, BEGIN … ROLLBACK)
Category:           надійність / валідація вводу
Location:           db/elo-integrity.sql:113-115 (elo_planned_for: `(data #>> '{activePlan,days}')::int`,
                    `(data ->> 'daysPerWeek')::int`); js/account.js:1099-1101 (імпорт приймає finite(v.days,1,7)
                    — 4.5 проходить), js/account.js:807-811 (NUM_LIMITS.daysPerWeek [1,7] без перевірки цілого)
Description:        elo_planned_for приводить текст до int без захисту (на відміну від решти фактів, які читає
                    elo_num з regex). Значення '4.5', 'abc', '5 днів', 99999999999 кидають виняток. Виклик
                    відбувається при першому дотику кожного нового ISO-тижня (elo_submit, elo_eval_week_for).
Why it matters:     Профіль — довільний JSON користувача (власний рядок profiles через RLS або імпорт JSON у
                    js/account.js). Після такого значення: кожен elo_submit → 400/500 → js/elo-api.js повертає
                    null → js/elo-hooks.js не позначає подію надісланою → повторний виклик на КОЖЕН Store.onChange
                    (без тосту, без пояснення); elo_catch_up падає; у cron користувач потрапляє в `failed`.
                    Рейтинг «мовчки зупиняється» назавжди, поки людина не виправить поле.
Reproduction:       На бойовій базі у BEGIN … ROLLBACK (DO-блок, RAISE EXCEPTION у кінці):
                      update profiles set data = data || '{"activePlan":{"days":"abc"}}' where user_id = <uid>;
                      select elo_planned_for(<uid>, '2026-09-07');
Observed:           D1 days="abc": ERR invalid input syntax for type integer: "abc"
                    D2 days=4.5:   ERR invalid input syntax for type integer: "4.5"
                    D3 dpw="5 днів": ERR invalid input syntax for type integer: "5 днів"
                    D4 days=99999999999: ERR value "99999999999" is out of range for type integer
Expected:           Некоректне значення → planned = 3 (як у інших гілках elo_facts через elo_num).
Root cause:         Прямий каст ::int замість elo_num(); імпорт на клієнті допускає дробові значення.
Impact:             Самопошкодження (не експлуатується для виграшу), але це постійна тиха відмова нарахувань і
                    шум у cron; UI-шлях — імпорт JSON із "days": 4.5.
Recommended fix:    `greatest(3, least(7, floor(coalesce(elo_num(data #> '{activePlan,days}', null),
                    elo_num(data -> 'daysPerWeek', null), 3))))`; у js/account.js — Math.round для days/daysPerWeek.
Regression test:    db/elo-integrity-tests.sql: профіль з days "abc"/4.5 → elo_planned_for = 3 без винятку;
                    tests/… імпорт з days 4.5 → у профілі ціле.
```

### ELO-004 — elo_eval_week_for: перевірка «тиждень уже оцінено» стоїть ДО блокування рядка; паралельні виклики застосовують дельту тижня кілька разів при одному рядку події

```text
ID:                 ELO-004
Severity:           HIGH
Confidence:         CONFIRMED (пісочниця forge_race: транзакція A утримує оцінку 3 с, три B чекають на FOR UPDATE)
Category:           конкурентність / цілісність економіки ELO
Location:           db/elo-integrity.sql:215-217 (exists 'week' — до lock), :219-221 (FOR UPDATE — після),
                    :245-256 (update season_state, потім insert … on conflict do nothing БЕЗ компенсації);
                    контраст: elo_submit :411-427 (ins_id is null → відкат нарахування).
                    Точки входу: RPC elo_evaluate_week(date) — grant authenticated (жива база);
                    RPC elo_catch_up() — grant authenticated; elo_cron_eval_week() — pg_cron 00:10 UTC.
Description:        elo_eval_week_for перевіряє наявність маркера 'week' у READ COMMITTED до захоплення блокування
                    season_state. Два (і більше) виклики, що стартували, поки перший ще не закомітив, проходять
                    перевірку, стають у чергу на FOR UPDATE і після коміту першого кожен оновлює season_state.elo
                    на pen + bon. Вставка маркера в них мовчки ігнорується (on conflict do nothing), і, на відміну
                    від elo_submit, нарахування не повертається назад.
Why it matters:     (а) Експлуатація: у чистий тиждень (done ≥ planned, 7 днів харчування) користувач з anon key
                    паралельно кличе /rpc/elo_evaluate_week або /rpc/elo_catch_up N разів у понеділок — отримує
                    +9 × N при одному рядку події; вікно — тривалість функції (кілька мс), тож треба реальні
                    паралельні HTTP-запити (не перевірялось на бойовій базі, §1.2). (б) Без злого умислу: cron
                    (00:10 UTC середи) + клієнтський elo_catch_up / elo_submit у ту ж мить → штраф −8×missed
                    списується двічі. Ledger (sum(delta) в elo_events) розходиться з season_state.elo назавжди;
                    admin_elo_anomalies це не бачить (перевіряє лише події).
Reproduction:       /tmp/audit-elo (БД forge_race, копія forge_sim; функції = тіла живої бази з current_date→sim_today()):
                    user3, план 3, 3 тренування + 7 днів харчування у тижні 2026-09-07; elo = 100.
                    Сесія A: begin; select elo_evaluate_week('2026-09-07'); pg_sleep(3); commit;
                    Через 1 с — три сесії B: select elo_evaluate_week('2026-09-07');
Observed:           A → {"delta":9,"elo":109}; B1 → {"elo":118}; B2 → {"elo":127}; B3 → {"elo":136} (усі ok, не duplicate).
                    season_state.elo = 136; elo_events: ОДИН рядок week +9; sum(delta) = 109.
Expected:           Після коміту A кожен B повертає {"duplicate":true}; elo = 109 = sum(delta).
Root cause:         Порядок «перевірити → заблокувати» замість «заблокувати → перевірити»; insert маркера не є
                    джерелом істини для оновлення elo (on conflict do nothing без відкату).
Impact:             Маніпуляція ELO (+9 за тиждень × кількість паралельних запитів) і подвійні штрафи; постійна
                    розбіжність ledger ↔ стан; лідерборд і закриття сезону беруть season_state.elo.
Recommended fix:    У elo_eval_week_for: спершу lock (insert season_state … ; select … for update), потім
                    exists-перевірка; або перенести insert маркера ПЕРЕД update season_state з
                    `returning id` і при null повертати duplicate без оновлення (як у elo_submit). Додатково
                    revoke elo_evaluate_week від authenticated (клієнт її вже не кличе — db/elo-catchup.sql:41).
Regression test:    SQL-тест з двома сесіями (dblink/pg_background або два psql): після коміту першої друга
                    повертає duplicate і season_state.elo = sum(delta) elo_events.
```

### ELO-005 — Останній тиждень сезону не оцінюється ніколи (ні cron, ні catch-up): пропуски останнього тижня без штрафу, чистий тиждень без бонусу

```text
ID:                 ELO-005
Severity:           HIGH
Confidence:         CONFIRMED (пісочниця forge_sim, /tmp/audit-elo/s3-season-end.sql; тіла функцій = жива база)
Category:           бізнес-логіка / економіка ELO / межі сезону
Location:           жива база: elo_cron_eval_week — `continue when today <= wk + 6 + swd` і одразу
                    `continue when season_of(wk + 6) <> season_of(today)`; db/elo-integrity.sql:208-214
                    (elo_eval_week_for: week_not_over / other_season); db/elo-catchup.sql (elo_catch_up_weeks
                    працює лише в season_of(current_date)).
Description:        Тиждень стає придатним для cron лише коли today > неділя + submitWindowDays (2). Якщо
                    неділя останнього тижня сезону припадає на ≤ 2 дні до кінця сезону, придатність настає вже в
                    наступному сезоні, а там і cron, і elo_eval_week_for відкидають тиждень як other_season.
                    AUTUMN-2026: останній повний тиждень 23–29.11, кінець сезону 30.11 → придатний з 02.12 =
                    WINTER → не оцінюється. Так само SUMMER-2026 (24–30.08, придатний 02.09 = AUTUMN) — тому
                    в бойовій базі немає жодного 'week'-рядка за серпень. Єдиний шлях, яким тиждень усе ж може
                    оцінитись, — дефектний шлях ELO-001 (клієнт відкрив застосунок 30.11 або 01.12 після
                    03:00 Києва) — тобто результат залежить від того, хто коли зайшов.
Why it matters:     Останній тиждень сезону — саме той, де вирішується рейтинг. Пропустити всі тренування
                    останнього тижня безкарно може будь-хто (штраф −8 × planned не списується); чесний чистий
                    тиждень не отримує +9. Ранжування сезону (elo_close_season) бере season_state.elo, у якому
                    останній тиждень відсутній вибірково.
Reproduction:       psql -h /tmp/audit-elo -p 5499 -U postgres -d forge_sim -f /tmp/audit-elo/s3-season-end.sql
                    user4, план 3, одне тренування 24.11 (+17); cron щодня 30.11–10.12; клієнтський
                    elo_catch_up і elo_evaluate_week('2026-11-23') 03.12.
Observed:           cron 30.11: weeks [11-16, 11-09, 11-02]; cron 01.12–08.12: «жодного придатного тижня»;
                    cron 09.12: weeks [11-30] (уже WINTER). elo_catch_up 03.12 → {"ok":true} без дії;
                    elo_evaluate_week('2026-11-23') → other_season. Рядка 'week' за 2026-11-29 НЕМАЄ.
                    (Побічно видно ELO-002: тижні 11-02/11-09/11-16 до реєстрації − 24 кожен, і тиждень 11-30
                    у WINTER без жодної події − 24.)
Expected:           Тиждень 23–29.11 оцінюється 02.12 (після закриття вікна) як тиждень сезону AUTUMN-2026, до
                    elo_close_season.
Root cause:         Придатність тижня прив'язана до season_of(today), а не до season_of(тиждень); кінець вікна
                    подання виходить за межу сезону.
Impact:             Систематична діра в економіці на кожному сезоні, чий останній тиждень закінчується ≤ 2 днів до
                    кінця сезону (AUTUMN-2026, SUMMER-2026, далі залежно від календаря); нерівні умови між
                    користувачами.
Recommended fix:    У elo_cron_eval_week і elo_eval_week_for порівнювати сезон тижня з season_of(wk + 6) і дозволяти
                    оцінку, поки сезон тижня не закритий у season_history (elo_close_season теж має спершу
                    добити останній тиждень). Умова придатності — одна функція (див. ELO-001).
Regression test:    SQL: подія 24.11; sim_today = 02.12 → після cron існує рядок week за 2026-11-29 у сезоні
                    AUTUMN-2026; після цього elo_close_season враховує його.
```

### ELO-006 — Тиждень реєстрації оцінюється як повний: приєднався в четвер із планом 3 → −8 за «пропуск»

```text
ID:                 ELO-006
Severity:           LOW
Confidence:         CONFIRMED (пісочниця forge_sim, /tmp/audit-elo/s2.sql — той самий прогін, що ELO-002)
Category:           бізнес-логіка / економіка ELO
Location:           db/elo-integrity.sql:223-239 (elo_eval_week_for: expected = round(planned × (1 − grace/7)),
                    без урахування першого дня подій/реєстрації); db/elo-catchup.sql:262-272 (catch-up
                    починає з date_trunc('week', min(day)) — тобто з понеділка тижня, а не з дня вступу)
Description:        Для тижня, у якому користувач зробив першу подію (зареєструвався), очікувана кількість
                    тренувань береться повна (planned), хоча тиждень для нього почався з четверга/пʼятниці.
Reproduction:       s2.sql: реєстрація чт 2026-09-17, план 3, тренування 17.09 і 19.09; пн 21.09 elo_catch_up.
Observed:           2026-09-20 week −8 «Недобір тренувань: 1 пропуск(и)» (34 → 26).
Expected:           Перший (неповний) тиждень пропорційний дням від першої події або не штрафується.
Root cause:         Немає пропорції для першого тижня (є лише для grace).
Impact:             Перше враження нового користувача — штраф у перший же понеділок; не експлуатується.
Recommended fix:    У elo_eval_week_for: expected = round(planned × доступні_дні/7), де доступні_дні рахуються
                    від greatest(p_week_start, min(day) подій або decided_at) — або пропускати перший тиждень.
Regression test:    SQL: перша подія у четвер, 2 тренування → рядок week з delta 0.
```

### ELO-007 — «Сьогодні: +X ELO» і today_delta живуть за UTC-днем: у Києві між 00:00 і 03:00 показується вчорашня сума, а події нового дня зараховуються у «вчора» і зникають о 03:00

```text
ID:                 ELO-007
Severity:           LOW
Confidence:         CONFIRMED (пісочниця forge_sim, /tmp/audit-elo/s4-tz.sql; TimeZone бойової бази = UTC — перевірено
                    `show TimeZone`/current_setting; rolconfig authenticated без TimeZone)
Category:           дата-час / UX
Location:           db/elo-integrity.sql:378-380, 403-407 (today_date = current_date), жива elo_state():
                    `case when st.today_date = current_date then st.today_delta else 0 end`;
                    клієнт: js/season.js:108, js/today.js:331, js/app.js:710 показують st.today;
                    ключ дня клієнта — локальний (js/elo-hooks.js dayKey, js/history-core.js todayKey).
Description:        День події (p_day) — локальний день користувача, вікно −2..+1 це покриває (перевірено: подача
                    за «завтра» проходить). Але лічильник дня season_state.today_delta прив'язаний до UTC-дати
                    сервера, тож у Києві (UTC+2/+3) з 00:00 до 02:00/03:00 бейдж показує суму попереднього
                    дня, а нарахування за новий день додаються до неї й обнуляються о 03:00.
Reproduction:       psql … -d forge_sim -f /tmp/audit-elo/s4-tz.sql: sim_today = 2026-09-08 (UTC, тобто Київ 00:30
                    09.09), submit workout за 2026-09-09; потім sim_today = 2026-09-09.
Observed:           submit → {"delta":17,"today":17}; elo_state().today при UTC 09-08 = 17; при UTC 09-09 = 0;
                    season_state: today_date = 2026-09-08, today_delta = 17.
Expected:           «Сьогодні» відповідає локальному дню користувача або рахується з elo_events за p_day.
Root cause:         Дві різні системи «дня»: p_day (локальний, від клієнта) і current_date (UTC) для today_delta.
Impact:             Лише відображення; ELO і ledger коректні. Помітно щоночі для активних після півночі.
Recommended fix:    elo_state: today = sum(delta) з elo_events за day = p_today, де p_today передає клієнт
                    (валідований у вікні), або прибрати today_delta/today_date взагалі.
Regression test:    SQL: подія за current_date + 1 → elo_state(p_today := current_date + 1).today = delta.
```

### ELO-008 — Оптимістична (офлайн) дельта клієнта рахує план 1..7 із поточного профілю, сервер — знімок тижня 3..7: тост «+51 ELO» проти реальних +17

```text
ID:                 ELO-008
Severity:           LOW
Confidence:         CONFIRMED (node: EloCore.actionDelta('workout', 3/3, cfg, {plannedDays:1}).delta = 51, 2 → 26, 3 → 17;
                    сервер для того ж профілю з days=1 платить 17 — проба Q3 на бойовій базі в ROLLBACK)
Category:           розбіжність клієнт ↔ сервер
Location:           js/elo-api.js:157-163 (payloadPlanned: Math.max(1, Math.min(7, …)) з ib.profile),
                    js/elo-api.js:118-126 (optimistic → тост у js/elo-hooks.js:160-164 «(досилається)»);
                    сервер: db/elo-integrity.sql:107-120 (elo_planned_for 3..7, знімок elo_week_plan)
Description:        Клієнтське ядро — дзеркало серверної формули, але контекст planned береться з іншого джерела:
                    поточний профіль без нижньої межі 3, а не серверний знімок тижня. Також mealDelta клієнта
                    бере proteinTarget з поточного NutritionCalc.targetFor(profile), сервер — mealLog[day].pTarget.
Reproduction:       Профіль activePlan.days = 1; офлайн; завершити тренування 3/3 → тост «+51 ELO — Тренування
                    (досилається)»; після досилання сервер нараховує 17.
Observed:           клієнт 51 / 26 (days 1 / 2), сервер 17.
Expected:           Однакове число або чесний текст без дельти в офлайн-тості.
Root cause:         Дублювання бізнес-правила клієнт/сервер (A13) з різними межами.
Impact:             Обман очікувань лише в офлайні; ELO не змінюється.
Recommended fix:    payloadPlanned: Math.max(3, …) і брати planned зі state (elo_state може повертати planned
                    поточного тижня); або в офлайні показувати тост без числа.
Regression test:    tests/elo-*.test.js: payloadPlanned для days=1 → 3; еквівалентність клієнт/сервер для days=1.
```

## Спостереження (INFO)

- **INFO-1. Відома проблема 2.3 `elo_close_season` — підтверджено, стан без змін.** Тіло функції в живій базі
  = db/elo-integrity.sql:440-528 (md5 після нормалізації збігається). Закриття лише від `auth.uid()` за викликом
  клієнта (`closeSeasonIfDue`, js/elo-api.js:200-259). Проба на бойовій базі: `elo_close_season('AUTUMN-2026')`
  → `season_running, finalAfter 2026-12-02`; `elo_close_season('SUMMER-2026')` → `no_data` (рядків SUMMER у
  season_state немає). Оцінка ризику, якщо сезон «не закриється»: season_state сезону після `season_end + 2`
  незмінний (submit → out_of_window; admin_elo_set пише лише в поточний сезон; cron — інший сезон), тому
  rank/percentile при пізньому закритті консистентні незалежно від моменту. Але: (а) користувач, який не
  зайде в застосунок протягом WINTER-2026, не отримає season_history/awards за AUTUMN ніколи —
  `closeSeasonIfDue` закриває лише «сезон перед поточним» (dayBefore), у SPRING-2027 код буде WINTER-2026;
  (б) через ELO-005 у фінальному рейтингу бракує останнього тижня; (в) `total`/percentile рахуються по всіх
  рядках season_state, включно з нульовими рядками, які створює ELO-002 для акаунтів без подій.
- **INFO-2. `elo_evaluate_week(date)` досі має grant `authenticated`** (жива база), хоча клієнт її не викликає
  (db/elo-catchup.sql:41). Це друга клієнтська точка входу в `elo_eval_week_for` з тими самими дефектами
  ELO-001/ELO-004 і дає користувачу самому вибирати тиждень. Рекомендація: revoke.
- **INFO-3. Тіло `elo_cron_eval_week` є лише в живій базі** (міграція `20260904221130 elo_cron_eval_week`);
  у репозиторії db/cron.sql — тільки коментар і `cron.schedule`. Дрейф репозиторій ↔ база (перетин з доменом db).
- **INFO-4. Результат cron не логується.** db/cron.sql:19-21 обіцяє `return_message = наш jsonb`, але
  `cron.job_run_details.return_message` для `select …` = `"1 row"` (2 запуски, обидва `succeeded`); у
  postgres_logs — лише `cron job 1 starting`. Кількість `failed`/`reasons` (напр. ELO-003) ніхто не побачить.
  Рекомендація: `raise log '%', res` усередині функції або таблиця журналу.
- **INFO-5. Реконсиляція вгору змінює `delta`/`elo_after` уже наявного рядка** (db/elo-integrity.sql:383-385),
  тому `elo_after` наступних рядків більше не є ланцюжком; `admin_elo_anomalies` і журнал користувача читають
  `elo_after` як історичний стан. Не помилка економіки, але історія «не незмінна», всупереч коментарю
  db/elo-proportional.sql:33.
- **INFO-6. Grace week обнуляє тренування:** під час grace `elo_action_delta('workout')` повертає 0
  (db/elo-proportional.sql:118), і повторна подача після grace теж 0 (`grace := p_day <= grace_until`).
  Користувач, що тренувався в grace, не отримує нічого — задум (`sim-week`/тести це закріплюють), але в UI
  (js/season.js:161-175) про це не сказано.
- **INFO-7. Самозвіт без верифікації — задум (db/elo-integrity.sql:47-49).** Проби Q2–Q6 на бойовій базі
  (ROLLBACK) підтверджують: власний `profiles.data` через RLS → будь-які факти → максимум 45/день, 51/тиждень
  за тренування, 200/тиждень усього, 2500/сезон. Стелі працюють; `sleep goal=1` → підлога 240, `steps 1e8` →
  стеля 100000, `doneSets 1e20 / totalSets −5` → рахується по вправах, `done 1e30` → least(done,total).
- **INFO-8. Таблиця `elo_events` не має CHECK на `delta`/`quality`/`elo_after`** (в живій базі є лише CHECK
  на category/event_type і UNIQUE-и; проба іншого агента в postgres_logs показує прийняті `delta 99999,
  elo_after −50` від ролі postgres). Пишуть туди лише SECURITY DEFINER-функції, тож для клієнта це закрито;
  для домену db — як захисна лінія.

## Стан відомих проблем (2.3)

| Що | Стан 2026-09-06 |
|---|---|
| `elo_close_season` привʼязаний до `auth.uid()`, не в cron | Підтверджено, без змін. Ризик описано в INFO-1; додатково ELO-005 (останній тиждень сезону не оцінюється) робить фінальний рейтинг неповним незалежно від того, хто закриває. |

## Що перевірено

- 17 SQL-файлів `db/` з «elo» (grep -il), 29 функцій живої бази (`pg_proc.prosrc`) звірено з репозиторієм
  (28/29 тотожні після нормалізації; `elo_cron_eval_week` — лише в базі).
- Гранти 27 функцій `elo_*/season_*/admin_elo_*` (`information_schema.routine_privileges`): `anon` — жодного;
  `authenticated` — 14 RPC; helper-и (`elo_eval_week_for`, `elo_planned_for`, `elo_week_room`,
  `elo_catch_up_weeks`, `elo_try_clean_day`, `elo_facts`, `elo_cron_eval_week`) — лише postgres/service_role.
- Індекси/обмеження: `elo_events_identity` (partial UNIQUE), `elo_events_user_id_action_key_key`, PK
  `season_state`, PK `elo_week_plan`, CHECK `season_state.elo 0..2500`, `elo_week_plan.planned 3..7`.
- 5 BEGIN … ROLLBACK-проб на бойовій базі (усі повернуто через RAISE EXCEPTION, 41 підпроба):
  повторний submit (той самий і інший ключ/payload) → duplicate; today+2 / today−3 / 1999 → out_of_window;
  today+1 без даних → no_data; kind `week`/`admin` → виняток; p_day null → BAD_DAY; cron/helper-функції
  від authenticated і anon → permission denied; select/update/insert `elo_events`, `season_state`,
  `elo_week_plan`, `elo_config` від authenticated → denied (крім select власних рядків); чужий user не бачить
  чужих подій (0 рядків); `admin_elo_set` від не-адміна → FORBIDDEN, від адміна — працює (очікувано);
  не-approved uid → NOT_APPROVED на всіх RPC; самозвіт через власний профіль (Q2–Q6) — стелі тримають;
  зміна плану посеред тижня не змінює знімок; `days = 4.5` валить elo_submit (ELO-003).
- Конкурентність: доказ з коду й обмежень для `elo_submit` (lock → read → insert з компенсацією при
  `ins_id is null`) — подвійне нарахування виключене; для `elo_eval_week_for` — гонка відтворена в пісочниці
  (ELO-004).
- Дата/час: TimeZone бази UTC; вікно −2..+1 покриває всі TZ (Київ 23:30 і 00:30 перевірено в пісочниці);
  тиждень — ISO (`date_trunc('week')`, понеділок); DST на UTC не впливає; today_delta — ELO-007.
- Пісочниця: 4 сценарії (s1 понеділок/неділя, s2 реєстрація посеред сезону + cron, s3 кінець сезону,
  s4 TZ) + гонка (forge_race, 2 прогони).
- Клієнт: js/elo-core.js, elo-api.js, elo-hooks.js, season.js, journal/today/app (показ `today`),
  account.js (імпорт `days`), meals.js (закриття вчорашнього дня). Оптимістична дельта — ELO-008.
- Sentry (mold-t1, 90 днів): жодної issue, повʼязаної з ELO/RPC. postgres_logs за 24 год: помилки лише від
  проб аудиту; cron — `cron job 1 starting`, без результату.

## Що НЕ перевірено і чому

- Справжня гонка HTTP-запитів на бойовому Supabase (ELO-004 «експлуатованість з клієнта») — заборонено §1.2;
  доведено лише в пісочниці з утриманою транзакцією.
- Supabase branch для adversarial-сценаріїв — не створювався (платний/невідомий тариф, §1.5).
- Перевірка через `curl + anon key` до `/rest/v1/rpc/*` — не виконувалась: те саме доведено імперсонацією
  ролей у SQL (PostgREST лише мапить JWT на ті самі ролі); мережеві запити до бойового бекенду не робились.
- `tools/verifyfix90.mjs` (B8 elo_close_season) та інші verify-скрипти домену — не запускались (домен tests).
- Safari/Firefox поведінка `dayKey`/`Date` — лише міркування: `getFullYear/getMonth/getDate` — стандартний
  локальний час у всіх рушіях.
- `admin_elo_anomalies` — не аналізувалась (адмін-інструмент, не економіка).
