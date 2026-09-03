# FORGE — ELO FIX VALIDATION & SECOND-ORDER SECURITY AUDIT

Дата: 2026-09-02 · READ-ONLY · без змін коду. Runtime-факти — з попередніх
rolled-back проб (ELO-REPORT.md) плюс read-only каталог/налаштування цього
запуску (TimeZone=UTC, індекси elo_events, statement_timeout 8s).

```text
CODE MODIFIED: NO · MIGRATIONS CREATED: NO · COMMIT CREATED: NO · DEPLOYMENT: NO
PRODUCTION STATE RESTORED: YES (checksums незмінні: elo_events aa6524…, season_state feedb7…, profiles 8ec78c…, users 1; git status: clean, HEAD 90ff6eb)
```

## 1. Executive Verdict

```text
NOT SECURE  (поточна система)
Запропоновані fix-и в їх НАЇВНІЙ формі — НЕДОСТАТНІ; у формі, описаній у §2/§9 нижче, вони
закривають клас протокольних атак, але self-report лишається межею моделі (Model 1).
```

## 2. What Was Actually Fixed Conceptually (оцінка кожного proposed fix)

| Proposed fix | Наївна форма | Чи закриває клас | Що потрібно насправді |
|---|---|---|---|
| A. Server event identity `UNIQUE(user_id, kind, day)` | так, для submit-подій | **частково** | `UNIQUE(user_id, event_type, day)` де event_type ∈ {workout, meal, sleep, recovery, activity, cleanday, week}; admin поза індексом (partial unique `where category <> 'admin'`); клієнтський `p_action_key` ігнорується повністю. Наївний варіант по `category` ЛАМАЄ: cleanday-бонус і week-бонус обидва `category='bonus'` у неділю → колізія (§4) |
| B. Server-side planned | `greatest(3, planned)` | **достатньо для економіки** (каталог мін. 3 дні), але не для чесності штрафів | planned ≥ 3 (clamp) + тижневий snapshot planned у `season_state`/окремій таблиці при першому дотику тижня, що не переписується клієнтом (§6–8) |
| C. Global weekly cap | «weekly budget на всі категорії» | **так, якщо** рахувати лише `delta > 0` і включати бонуси | один тижневий cap = weeklyBudget 200 на `sum(delta>0)` по (user, iso-week, category<>'admin'), під тим самим `FOR UPDATE` (§9–11) |
| D. Заборона reserved-ключів | blacklist prefix | **поганий fix** (Unicode/whitespace/case — окремі перевірки; blacklist ніколи не повний) | зникає автоматично при fix A: клієнт не визначає ідентичність події взагалі (§13–14) |
| E. season_end < current_date для close | так | **недостатньо** | close лише коли `current_date > season_end + submitWindowDays` (вікно −2 днів ще пише в минулий сезон → ранги плавають 1–2 дні), інакше ранній closer фіксує rank по неповних даних (§25–26) |
| F. profiles.data як факти | «anomaly detection» | **не змінює trust boundary** | явно обрати Model 1 (self-report adherence) і задокументувати; для Model 2 — неможливо без server-derived фактів (§17–19) |

## 3. Remaining Vulnerabilities (за умови наївних fix-ів)

| ID | Severity | Confidence | Precondition | Exploit | Impact | Evidence |
|---|---|---|---|---|---|---|
| R-1 (F-05) | HIGH (Model 2) / accepted (Model 1) | HIGH | approved | fake facts у profiles.data → ідеальний день 36, тиждень 200 | 2500 без активності на ~день 88–91 (= честний ідеал) | runtime: fake profile → 17+7+5+2+2+3 |
| R-2 | MEDIUM | HIGH (code) | fix A по `category` | `bonus` cleanday (неділя) vs `bonus` week → одна з двох подій втрачається або, за `on conflict do nothing` + компенсація, ELO розсинхронізується | некоректна економіка, не exploit | тіла `elo_try_clean_day`/`elo_eval_week_for`: обидві `category='bonus'`, `day = неділя` |
| R-3 | MEDIUM | HIGH (code) | fix E наївний | close на 00:01 першого дня: ранг рахується, поки інші ще пишуть «учора/позавчора» у минулий сезон (вікно −2) | стабільний rank/awards залежать від часу виклику; ранній closer може отримати #1 «на 2 дні раніше» | `elo_submit`: `szn ∈ {season_of(today−1)}` дозволено; `elo_close_season` рахує rank live |
| R-4 | MEDIUM | HIGH (code) | fix B = clamp 3 без snapshot | план 3 весь тиждень → у неділю ввечері поставити 7? ні — planned читається при eval: **більший** planned = більший штраф; **менший** planned заднім числом = менший штраф → користувач ставить 3 перед evaluate, 7 під час тренувань? Ні: reward = 51/planned читається при submit (менший planned = більший reward), штраф при eval (менший = менший штраф) → оптимум завжди planned=3, легітимно | після clamp економічної переваги над чесним 3-денним планом немає; але «5-денна програма» з planned=3 у профілі = штрафи лише за <3 | runtime: planned=1 → 45; після clamp 3 → 17 |
| R-5 | LOW | HIGH | fix C рахує net | penalty −8 у неділю «звільняє» 8 тижневого бюджету | +8/тиж | арифметика cap; має рахувати `delta > 0` |
| R-6 | LOW | HIGH | будь-який | window −2..+1 + per-day cap → burst 4×45 (після fix C ≤ 200/тиж) | лише згладжування | runtime: 45/45/45 |
| R-7 (F-02 hist) | LOW | HIGH | до fix E | fake awards у власній історії | self-scoped | runtime |
| R-8 | LOW | MEDIUM | multi-device | last-write-wins profiles.data цілим обʼєктом (store.js:983) → втрата фактів, НЕ дублювання (події ключовані сервером) | втрата власного ELO-шансу | code |

## 4. New Vulnerabilities Introduced By Proposed Fixes (second-order)

```text
S-1  UNIQUE(user, category, day): колізія 'bonus' (cleanday ∧ week у неділю), 'penalty' vs 'bonus' — ок, 'admin' — кілька на день → індекс має бути по event_type з винятком admin.
S-2  Server-identity + «перший submit фіксує reward»: часткове тренування вранці (q=0.5) блокує повну винагороду ввечері.
     Потрібне правило реконсиляції: reward(day) = intended(latest facts) − paid(day), з clawback при зниженні або «pay once when final».
     Без clawback: submit «ідеальні факти» → paid → повернути реальні факти → paid лишається (оптимізація self-report, не протокольна).
S-3  Global weekly cap по net-сумі: штраф звільняє бюджет (R-5). Рахувати лише delta>0.
S-4  Weekly cap і week-eval: тиждень заповнений до 200 у суботу → clean-week бонус +9 у неділю відсікається → або бюджет 171 для дій + 29 для бонусів окремо (як задумано categoryShare 0.857), або cap 200 включно.
S-5  Blacklist reserved prefixes: 'WEEK:', 'week：' (U+FF1A), 'week:​…', ' week:' обходять `like 'week:%'`; але після fix A ключ клієнта не читається взагалі → blacklist не потрібен і не рекомендується.
S-6  season_end check без урахування submitWindowDays (R-3).
S-7  planned snapshot «при першому дотику тижня» — атакер ставить planned=3 у понеділок 00:00, потім 7 — snapshot лишає 3 (безпечно); але snapshot має жити в таблиці без write-гранта клієнту (season_state ✔), не в profiles.data.
S-8  Server date = UTC (перевірено TimeZone=UTC): клієнт у UTC+3 о 01:00 понеділка шле p_day=понеділок (= «завтра» для сервера) — дозволено; дублювання неможливе (cap per p_day), але canonical day = клієнтський p_day у межах серверного вікна. Після fix A identity = (kind, p_day) → та сама подія в двох календарях неможлива (один p_day).
```

## 5. Economic Model (intended, з elo_config v2)

```text
weeklyBudget 200 = дії 171.4 (categoryShare 0.857) + бонуси ≈ 28.6 (7×cleanDay 3 + cleanWeek 9 = 30)
Дії/тиждень: training 51.4 (3 тренування × 17.1) · nutrition 51.4 (7×7.3) · sleep 34.3 (7×4.9) · recovery 17.1 (7×2.45) · activity 17.1 (7×2.45)
Intended max/день: тренувальний 36 (17+7+5+2+2+3), інший 19 → dayGainCap 45 НЕ є intended-денною межею (він ширший на 25 %)
Intended max/тиждень: 200 · Сезон (13.14 тиж): 2628 → seasonMax 2500 = «ідеальний гравець упирається в стелю на ~88-й день»
Поточний фактичний max/тиждень: 7×45 = 315 (день-cap) + week bonus 9 = 324 → 1.6× intended.
```

## 6. Honest vs Attacker

| Сценарій | ELO/день | ELO/тиждень | Сезон | Днів до 2500 |
|---|---:|---:|---:|---:|
| Honest типовий (q≈0.8, 2–3 трен.) | ≈20 | ≈140 | ≈1800 | не досягає |
| Honest ідеальний | 27.6 | 193–200 | 2500 (cap) | ≈88–91 |
| Self-report abuser (fake facts, зараз і після fix-ів) | 27.6 | 200 | 2500 | ≈88 |
| Protocol abuser (зараз: F-01+F-03+F-A) | 45 | 315+9 | 2500 | 56 |
| Protocol abuser після fix A+B+C(+E) | 27.6 | 200 | 2500 | ≈88 (= self-report) |

Висновок: fix-и A+B+C зводять протокольного атакера до рівня self-report; self-report = ідеальний чесний. Різниця між ними — лише реальна активність, яку сервер не бачить.

## 7. Security Invariants

| Invariant | Зараз | Після A+B+C+E | Enforcement (де саме) | Evidence |
|---|---|---|---|---|
| P1 same event ≠ multiple rewards | FAIL | PASS | partial UNIQUE(user_id, event_type, day) where category<>'admin' + INSERT під FOR UPDATE | runtime F-01 |
| P2 action_key не впливає | FAIL | PASS | сервер ігнорує p_action_key | runtime: '' / 10 000 симв. прийнято |
| P3 payload не впливає | PASS | PASS | payload не читається в elo_submit | 14 payload → однакова дельта |
| P4 p_day у вікні ≠ необмежене дублювання | PARTIAL (burst 180) | PASS | identity містить day; weekly cap | runtime 45/45/45 |
| P5 client facts ≤ server limits | PASS лише як стелі | PASS (Model 1) / FAIL (Model 2) | clamp q≤1, floors, day/week/season caps | fake day 36 |
| P6 Σ(delta>0)/тиждень ≤ 200 | FAIL (315) | PASS | `sum(delta>0)` по iso-тижню під lock, включно з bonus/penalty-гілками | F-03 |
| P7 ELO ≤ seasonMax | PASS | PASS | `least()` у кожному update + CHECK 0..2500 | 2490+45→2500 |
| P8 service keys не pre-claim | FAIL | PASS (ключ клієнта не читається) | identity серверна; week/cleanday — окремі event_type | F-B |
| P9 season не закривається до кінця | FAIL | PASS лише з `today > end + submitWindowDays` | перевірка дати в elo_close_season | F-02 runtime |
| P10 bonuses не replay | PASS | PASS | 'cleanday:'/'week:' keys → event_type у новій моделі | runtime duplicate |
| P11 planned не з клієнта | FAIL | PASS (≥3 + тижневий snapshot у season_state) | greatest(3,…) + snapshot без client write | planned=1 → 45 |

## 8. Category semantics (§5 запиту)

| Economic fact | Kind | Інший kind | Double? |
|---|---|---|---|
| тренування | workout (sessionLog) | activity (steps) | ні: різні факти, обидва задумано щоденно/тижнево; workout не читає steps |
| ходьба | activity | recovery | ні: recovery — субʼєктивна оцінка 1–10; 60 % reward за сам факт запису (recoveryFillShare) — це «participation reward», не подвійна монетизація |
| харчування | meal | recovery | ні |
| сон | sleep | recovery | ні |
Висновок: kind = окрема economic event; колізії лише всередині kind (F-01) і в bonus-типах (S-1).

## 9. Key collision search (§15–16)

Усі порівняння `action_key`: `= p_action_key` (elo_submit), `= 'week:'||w` (eval, catch_up), `= 'cleanday:'||p_day` (clean day). `LIKE/ILIKE/regexp/prefix` — відсутні. Magic-простори: `week:`, `cleanday:`, `admin:<epoch>:<md5>` (перевіряється по category, не по ключу). Інших (grace:, season:, system:) немає. Клієнт може зайняти будь-який з них (перевірено 'week:' — прийнято). Після fix A простір ключів клієнта не існує.

## 10. Import / offline / multi-device (§21–23)

- Імпорт JSON (account.js validateImport/cleanDay) валідує форму, не правдивість → ELO-eligible історія на −2 дні (вікно), старіша — не монетизується (out_of_window) — перевірено (day−40 → out_of_window).
- Офлайн-черга ib.eloPending з клієнтськими ключами — після fix A повтори безпечні за визначенням.
- Multi-device: last-write-wins цілим profiles.data → втрата фактів можлива, дублювання винагород — ні (серверні події ключовані). Після fix A — так само.

## 11. Untested

- Runtime concurrency (паралельні elo_submit) — lock-аналіз safe; unsafe without staging.
- Ефект week-eval/penalty (жодного завершеного тижня сезону), реальна межа сезону, поведінка PostgREST body-limit.
- Fix-и не існують у коді → перевірені як модель, не як реалізація.

## 12. Final Release Recommendation

```text
DO NOT RELEASE (competitive ELO) · RELEASE як «self-reported adherence score» після fix A+B+C+E з явним дисклеймером
Мінімальна безпечна архітектура:
  1. event identity серверна: (user_id, event_type, day), partial UNIQUE, p_action_key ігнорується
  2. один тижневий бюджет 200 на sum(delta>0) усіх джерел під тим самим row lock; day cap ≤ 36 або лишити 45 як згладжування
  3. planned = greatest(3, plan) + snapshot тижня у season_state (без client write)
  4. close season лише після end + submitWindowDays; історія/awards — з цього моменту
  5. задокументована Model 1; anomaly-репорт для адміна (q=1 стрік, backdated edits, submit-патерни)
```
