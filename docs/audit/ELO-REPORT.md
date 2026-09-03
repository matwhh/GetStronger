# FORGE — ELO ADVERSARIAL PENETRATION AUDIT

Дата: 2026-09-02 · READ-ONLY · всі мутації в `BEGIN … ROLLBACK` (результат
через `RAISE EXCEPTION`, транзакція відкочена завжди).

```text
CODE MODIFIED: NO
MIGRATIONS CREATED: NO
COMMIT CREATED: NO
DEPLOYMENT: NO
PRODUCTION STATE RESTORED: YES  (checksums BEFORE == AFTER, див. §3)
```

## 1. Executive Verdict

```text
ELO NOT SECURE
```

Підтверджено runtime: одна реальна (або вигадана) подія дня монетизується
до денної стелі (45) через ротацію `action_key`; `profiles.data` — єдине
джерело «фактів» і повністю контролюється клієнтом, включно з `planned`
(кількість запланованих тренувань), яке визначає і розмір винагороди за
тренування, і поріг штрафів. Атакер без жодної активності досягає
seasonMax 2500 на ~56-й день сезону (чесний ідеальний гравець — на ~91-й);
з 25-го дня він стабільно вище будь-якого чесного користувача.

## 2. Scope

Усі 16 ELO/акаунт RPC (тіла з live-каталогу), helper-и `elo_facts`,
`elo_action_delta`, `elo_ladder`, `elo_band`, `elo_num`, `elo_tracker_value`,
`elo_eval_week_for`, `elo_catch_up_weeks`, `elo_try_clean_day`, `admin_elo_set`;
таблиці `elo_events`, `season_state`, `season_history`, `awards`, `elo_config`,
`profiles`; constraints/indexes/lock-и; клієнт `js/elo-hooks.js`, `js/elo-api.js`.
Runtime-проби: 6 rolled-back транзакцій з транзитним approved-користувачем C.

## 3. Exact Baseline

```text
commit 90ff6eb (master), working tree clean до/після (git status: 0 змін)
SCHEMA_VERSION 10; elo_config.version 2
BEFORE  elo_events 1/Σ10/aa65242246a284df0ff4c0b2aa08e2a0  season_state 1/feedb72f587dceb46bbbe4ec194dac18
        profiles 1/8ec78cae95e1a851b09866f9fd3543b8  season_history 0  awards 0  auth.users 1
AFTER   ІДЕНТИЧНО (усі md5/лічильники збігаються)
```

## 4. ELO Architecture (фактична)

```text
elo_config (id=1): weeklyBudget 200 × categoryShare 0.857 = 171.4/тиж
  weights: training .3  nutrition .3  sleep .2  recovery .1  activity .1
  dayGainCap 45 · seasonMax 2500 · submitWindowDays 2 · cleanDayBonus 3 · cleanWeekBonus 9
  missedWorkoutPenalty −8 · graceDays 7 · graceWeeksPerSeason 2 · minUsersForPercentile 8
Формули (elo_action_delta):
  workout  = 171.4×0.3/planned × q        planned ∈ [1..7] з profiles.data (activePlan.days | daysPerWeek | 3)
  meal     = 171.4×0.3/7 × (band(kcal dev)×.55 + ladder(protein)×.45) ≈ 7
  sleep    = 171.4×0.2/7 × ladder(min/goal)  ≈ 5
  recovery = 171.4×0.1/7 × (0.6 | 1.0)       ≈ 2
  activity = 171.4×0.1/7 × ladder(steps/goal) ≈ 2
Стелі в elo_submit: тижневий training-бюджет 171.4×0.3 ≈ 51 (лише workout);
  dayGainCap 45 на p_day (усі категорії, крім 'admin'); seasonMax через least() у кожному update + CHECK elo 0..2500.
Ідемпотентність: UNIQUE(user_id, action_key); action_key — довільний текст клієнта.
```

## 5. ELO State Machine

```text
profiles.data (client, PostgREST UPDATE own) ──▶ elo_facts(uid, kind, p_day)      [server читає JSON клієнта]
   p_kind, p_action_key, p_day (client) ──▶ elo_submit ──▶ window(−2..+1, season∈{prev,cur,next})
        ──▶ season_state upsert + FOR UPDATE ──▶ dup-check(action_key) ──▶ elo_catch_up_weeks (week: keys)
        ──▶ elo_action_delta ──▶ [workout] week budget ──▶ dayGainCap(p_day) ──▶ season_state.elo (least seasonMax)
        ──▶ elo_events insert (on conflict do nothing → компенсація) ──▶ elo_try_clean_day (cleanday: key)
elo_evaluate_week(p_week_start) / elo_catch_up ──▶ elo_eval_week_for (key 'week:<monday>', лише минулі повні тижні поточного сезону)
elo_activate_grace ──▶ season_state.grace_until (≤2/сезон; workout у grace = 0)
elo_close_season(p_season ≠ поточний) ──▶ season_history + awards (rank live з season_state)
elo_leaderboard ──▶ live season_state поточного сезону
```

## 6. Security Invariants → результат

| Inv | Формулювання | Результат |
|---|---|---|
| I1 | одна активність — обмежена винагорода | **FAIL**: межа = dayGainCap, не «одна винагорода» (F-01) |
| I2 | action_key не є економічною істиною | **FAIL**: новий ключ = нова винагорода |
| I3 | payload не створює активності | PASS: 14 payload-варіантів → однакова дельта (ігнорується) |
| I4 | дата не створює нової винагороди | PARTIAL: вікно −2..+1 тримає; кожен p_day має власний cap (дизайн), майбутній сезон — F-02 |
| I5 | caps глобальні для всіх RPC | PASS для day/season cap; **FAIL** для weekly (лише workout) |
| I6 | порядок операцій не додає ELO | PASS (усі шляхи ключовані; catch_up/evaluate ідемпотентні) |
| I7 | одна подія — один RPC | PASS: catch_up/evaluate/grace/close не монетизують submit-факти повторно |
| I8 | ELO ≤ seasonMax, без overflow | PASS (2490 + 45 → 2500; 1e30/1e31/−5/"1e400" → clamp або no_data) |
| I9 | «планове навантаження» — не під контролем гравця | **FAIL**: planned з profiles.data (F-A) |

## 7. Attack Surface

| Input | Client controlled | Server trusted | Economic impact | Exploitable |
|---|---|---|---|---|
| p_kind | yes | whitelist | вибір категорії | no (кожна категорія — свої факти) |
| p_action_key | yes | **як ідентичність події** | так | **YES (F-01)** |
| p_day | yes | вікно −2..+1 | окремий day cap на дату | burst до 4×45 за сесію; сезонний темп незмінний |
| p_payload | yes | ignored | none | no |
| profiles.data.sessionLog/mealLog/trackerLog | yes | **as facts** | так | **YES (F-05 design)** |
| profiles.data.activePlan.days | yes | **as planned** | 51/planned за тренування; поріг штрафу | **YES (F-A)** |
| profiles.data.trackers.*.goal | yes | floors (goal ≥ 240/3000) | q=1 при мінімальній цілі | частина F-05 |

## 8. Attack Matrix

| Attack | Expected | Actual | Impact | Evidence |
|---|---|---|---|---|
| action replay (same key) | blocked | blocked (duplicate) | — | `{"ok":true,"duplicate":true}` |
| key rotation (new key, same fact) | blocked | **ALLOWED** до day cap | 45/день з 1 факту | sleep 5 → 12 replay = +40; workout 17+17+11 |
| key variants ('', ' ', unicode, 10 000 символів, UUID) | rejected | **accepted** усі | необмежений простір ключів | key[](len 0) ok … len 10000 ok |
| kind switching | blocked | blocked | — | факти per-kind; чужі факти → no_data |
| payload manipulation (14 варіантів) | no effect | no effect | — | усі delta=5 q=1 |
| backdating (−2, −1) | blocked | allowed by design, окремий cap | burst 3×45 | day sums 45/45/45 |
| future date (+1) | blocked | allowed by design | створює season_state наступного сезону на межі | F-02 |
| profile.data forgery | no extra ELO | **full ELO без активності** | = ідеальний чесний гравець | honest day 36 з fake facts |
| planned=1 | n/a | 45 за одне тренування (замість 17), штрафи ≈ 0 | F-A | `"delta": 45` |
| catch-up replay | blocked | blocked ('week:' key, exists-check) | — | code + evaluate_week idempotent |
| week eval replay/other week | blocked | blocked (other_season / week_not_over / duplicate) | — | runtime |
| pre-claim 'week:<monday>' через submit | rejected | **accepted** (events with week: key = 1) | блокує майбутній штраф тижня | CODE-REVIEW для ефекту (жодного повного тижня сезону ще нема) |
| weekly bypass (non-workout) | blocked | **no weekly budget** для sleep/meal/activity/recovery | 45/день | F-03 |
| season cap bypass | blocked | blocked (least + CHECK) | — | 2490+45 → 2500 |
| grace replay | blocked | blocked (already_active, ≤2) | — | runtime |
| close replay | blocked | duplicate | — | runtime |
| close future season | blocked | **ALLOWED** | fake awards, зламане власне закриття | F-02 runtime |
| RPC double spend | blocked | blocked | — | усі шляхи ключовані окремими просторами (week:, cleanday:) |
| concurrent submit | safe | RUNTIME UNTESTED; lock-аналіз: safe | — | §18 |
| numeric edge (−5, 0, 1e30, "1e400", 99999) | safe | safe | — | clamp/no_data |

## 9. Confirmed Findings

### F-01 — action_key rotation (CONFIRMED, HIGH → у ланцюзі §10 CRITICAL-impact)
```text
Affected: elo_submit; UNIQUE(user_id, action_key) як єдиний anti-replay
Preconditions: approved акаунт; ≥1 факт дня в profiles.data (реальний або вигаданий)
Attacker: звичайний користувач, curl/консоль браузера
Exploit: for i in 1..9: POST rpc/elo_submit {p_kind:"sleep", p_action_key:"x"+i, p_day:today}
Before: elo 0 → After: elo 45 (day cap); чесний максимум за сон = 5
Why failed: сервер не виводить ідентичність події з (kind, day); ключ — довільний, навіть порожній
Max impact: 45/день × 92 = 4140 → seasonMax 2500 на день 56; leaderboard: так; cross-user data: ні
Automation: тривіальна (9 запитів/день)
Fix direction: action_key := p_kind||':'||p_day серверно; UNIQUE(user_id, category, day) для submit-категорій
```

### F-A — planned (activePlan.days) під контролем клієнта (CONFIRMED, MEDIUM)
```text
Affected: elo_submit (d = 51/planned), elo_eval_week_for (expected = planned)
Exploit: profiles.data.activePlan.days = 1 → одне тренування = 45 (замість 17 при 3); штраф лише якщо 0 тренувань/тиждень;
         cleanWeekBonus +9 за 1 тренування + 7 днів харчування
Evidence: {"ok":true,"elo":2500,"delta":45} з planned=1
Impact: обмежено weekly training budget 51 → +9/тиж бонус без ризику штрафів; не дає >45/день, але робить F-05 «безштрафним»
Fix direction: серверний planned з program catalog / мінімум 3; штраф від фактичного плану на момент вибору
```

### F-05 — profiles.data як єдине джерело фактів (CONFIRMED design limitation, HIGH у ланцюзі)
```text
Evidence: профіль із fake sessionLog/mealLog/trackerLog → «чесний» день 36 ELO (17+7+5+2+2+3) без жодної активності
Impact: нульова активність = ідеальний чесний гравець (~193/тиж, 2500 на день ~91)
```

### F-02 — закриття майбутнього сезону (CONFIRMED функція / CODE-REVIEW передумова, MEDIUM)
```text
Evidence: season_state(WINTER-2026, 30) → elo_close_season('WINTER-2026') → ok, rank 1/1, awards first,top3,top10,top100,top1000; повтор → duplicate
Precondition: останній день сезону, elo_submit(p_day = завтра) створює season_state наступного сезону
Impact: self-scoped fake awards; реальне закриття того сезону неможливе; leaderboard/rank інших — НЕ змінює (live season_state)
```

### F-03 — weekly budget лише для workout (CONFIRMED, MEDIUM, підсилює F-01)
sleep/meal/activity/recovery обмежені лише dayGainCap → саме вони дають 45/день у F-01.

### F-B — pre-claim службових ключів `week:<monday>` (CONFIRMED reachable, CODE-REVIEW ефект, MEDIUM)
`elo_submit('sleep','week:2026-08-31',…)` приймається; `elo_eval_week_for` пропускає тиждень, якщо `exists(action_key='week:'||w)` — незалежно від category → штраф −8×missed за тиждень ніколи не нарахується. Ефект не відтворено runtime (у AUTUMN-2026 ще немає завершеного тижня; неможливо без зміни дати).

### F-C — ключі без валідації (CONFIRMED, LOW): '', ' ', 10 000 символів приймаються; ріст `elo_events` без ліміту (cost).

## 10. Exploit Chains

```text
CHAIN-1 «нуль активності → seasonMax за 56 днів» (CRITICAL-impact для рейтингу)
  F-05 fake facts (1 PATCH profiles/день або один раз на 3 дні)
  + F-01 ротація ключів (9× sleep/день)                → 45/день
  + F-A planned=1                                     → жодних тижневих штрафів, +9/тиж бонус
  + (опц.) F-B pre-claim 'week:' ключів               → штрафи виключені навіть без F-A
  = 2500 на день 56; з дня ~25 вище за будь-якого чесного гравця; #1 leaderboard; top-1% при ≥8 користувачах.
CHAIN-2 «burst»: window −2..+1 → 4 дні × 45 = 180 за одну сесію (не збільшує сезонний темп).
CHAIN-3 F-02: submit(завтра) в останній день сезону → close(next) → fake «#1 сезону» у власній історії.
```

## 11. Maximum ELO Farming Scenario

```text
Мінімальний exploit: 1 approved акаунт · 0 реальної активності · 1 PATCH профілю (sleep=480 на 3 дні) ·
9 викликів elo_submit/день з різними ключами · ≈ +45/день.
Дні 1–55: 45/день → 2475; день 56: 2500 (стеля). Далі — утримання #1 без дій.
```

## 12. Honest vs Attacker

```text
Чесний ідеальний (3 тренування, ідеальні харчування/сон/кроки/recovery щодня, clean days/weeks):
   день з тренуванням 36, без 19 → 193/тиж → ≈ 27.6/день → 2500 на день ~91 (кінець сезону)
Чесний типовий (реалістичні q≈0.8, 2–3 тренування): ≈ 18–22/день → ≈ 1700–2000 за сезон
Атакер CHAIN-1: 45/день → 2500 на день 56.
Ratio/день: 45 / 27.6 = 1.63× проти ідеалу; ≈ 2.2× проти типового.
Атакер лише F-05 (без F-01): = ідеальний чесний (27.6/день, день ~91) з нульовою активністю.
```

## 13. Cap Analysis

| Mechanism | Daily cap | Weekly cap | Season cap | Shared? |
|---|---:|---:|---:|---|
| workout | 45 (dayGainCap, спільний) | ≈51 (training budget) | 2500 | day cap спільний для всіх категорій |
| sleep | 45 | **none** | 2500 | — |
| meal | 45 | **none** | 2500 | — |
| activity | 45 | **none** | 2500 | — |
| recovery | 45 | **none** | 2500 | — |
| cleanday bonus | у межах 45 | 1/день (key) | 2500 | так |
| week bonus/penalty | поза day cap | 1/тиж (key) | 2500 | так |
| admin | поза day cap | — | 2500 | admin only |

Enforcement: dayGainCap — `sum(delta>0) where day=p_day and category<>'admin'` під `FOR UPDATE`; seasonMax — `least()` у всіх update + `CHECK (elo BETWEEN 0 AND 2500)`; weekly — лише гілка `p_kind='workout'`.

## 14. Replay Analysis (per RPC: що фізично зупиняє 100 повторів)

| RPC | Ключ унікальності | Що зупиняє | Обхід |
|---|---|---|---|
| elo_submit | UNIQUE(user_id, action_key) | UNIQUE + on conflict + компенсація | **новий ключ** (F-01); стоп = dayGainCap |
| elo_evaluate_week / elo_catch_up | action_key 'week:<monday>' | exists-check + UNIQUE | немає (крім pre-claim F-B, який лише блокує) |
| elo_try_clean_day | 'cleanday:<date>' | exists-check | немає |
| elo_activate_grace | grace_until / grace_used ≤ 2 | already_active + exhausted | немає |
| elo_close_season | PK season_history(user, season) | exists → duplicate | немає |
| admin_elo_set | random key | admin only | n/a |

## 15. Date Manipulation

Вікно: `p_day ∈ [current_date−2, current_date+1]` і сезон ∈ {season_of(today−1), today, today+1} → на 2-й день сезону −2 вже out_of_window (перевірено: Aug 31 → out_of_window). Кожен p_day — власний day cap (перевірено 45/45/45 для −1/0/+1 за одну сесію). Ключ-ефект: burst, не темп. Межа сезону: +1 створює state наступного сезону (F-02).

## 16. profile.data Trust

Economic inputs (усі client-controlled): `sessionLog[d].{total,done,totalSets,doneSets}`, `mealLog[d].{kcal,target,p,pTarget}`, `trackerLog.{sleep,steps,recovery}[d]`, `trackers.{sleep,steps}.goal`, `activePlan.days`/`daysPerWeek`. Серверні захисти: clamp q≤1, floors (sleepMax 960, sleepGoalMin 240, stepsGoalMin 3000, workoutTotalMin 3), `elo_num` regex (відкидає "1e400", NaN, Infinity). Нічого не перевіряє правдоподібність.

## 17. RPC Composition

Перевірено пари submit↔catch_up, submit↔evaluate, submit↔grace, submit↔close, close↔close, grace↔grace: додаткового ELO порядок не дає; єдиний cross-RPC ефект — F-B (submit блокує evaluate).

## 18. Concurrency (lock analysis; RUNTIME UNTESTED)

`elo_submit`: `insert season_state … on conflict do nothing` → `select … for update` → дубль-перевірка, catch-up, cap-розрахунок і update — усе під row lock → паралельні виклики одного користувача серіалізуються; той самий ключ → другий бачить existing → duplicate; різні ключі → послідовно до cap (без race на cap). `elo_eval_week_for`, `elo_activate_grace`: for update. `elo_close_season`: без lock → паралельний дубль впаде на PK (безпечно). `elo_try_clean_day`: викликається під lock викликача. Ризик lost update не знайдено. Runtime паралельний прогін проти production не виконувався.

## 19. False Positives

- payload-маніпуляція — ігнорується (14 варіантів);
- kind switching — факти per-kind, подвійної винагороди немає;
- numeric overflow/negative/scientific — clamp/no_data; seasonMax тримає;
- grace як монетизація — workout у grace = 0, grace лише знижує expected;
- catch_up після submit — той самий простір ключів 'week:';
- порядок RPC — без ефекту;
- today_delta 47 > 45 — косметика (сума по різних p_day), не економічний обхід.

## 20. Untested

- Runtime concurrency (N паралельних elo_submit) — unsafe without staging.
- Ефект F-B на реальному тижневому штрафі (потребує завершеного тижня сезону / зміни дати).
- F-02 передумова на реальній межі сезону (30.11).
- Реальний PostgREST body-limit для великого profiles.data.

## 21. Recommended Fix Priority

```text
P0  F-01  серверний action_key з (kind, day); UNIQUE(user_id, category, day) для submit-подій
P1  F-03  weekly budget на всі категорії (або глобальний тижневий cap ≈171)
    F-A   planned не з клієнта (мінімум 3 / з програми на сервері)
    F-B   заборонити клієнтські ключі з префіксами 'week:', 'cleanday:', 'admin:' (і порожні/довгі)
P2  F-02  закривати лише завершені сезони; F-05 — anomaly-детекція (q=1 щодня, submit-патерни)
P3  F-C   довжина/формат ключа; ліміт elo_events на день
```

## 22. Final ELO Security Verdict

```text
ELO NOT SECURE
```
Причина: підтверджений runtime-exploit (F-01) дозволяє без активності досягати seasonMax на 56-й день і стабільно перевершувати чесних гравців; профільні факти й planned повністю під контролем клієнта (F-05, F-A); тижневий бюджет діє лише на тренування (F-03).
