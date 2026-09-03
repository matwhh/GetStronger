# FORGE — ELO SECURITY REMEDIATION REPORT

Дата: 2026-09-02 · Режим: IMPLEMENTATION (без commit/deploy)

```text
CODE MODIFIED: YES        (db/elo-integrity.sql — нова міграція; db/elo-integrity-tests.sql — нові тести;
                           db/elo-tests.sql — оновлені очікування; js/elo-api.js — лише коментар)
MIGRATIONS CREATED: YES   (файл у репозиторії; НЕ застосовано до production)
TESTS ADDED: YES          (28 DB/RPC-тестів + adversarial replay)
COMMIT CREATED: NO
DEPLOYMENT: NO
PRODUCTION STATE RESTORED: YES — усі перевірки виконано у BEGIN … (exception) → rollback;
   checksums elo_events aa6524…/season_state feedb7…/profiles 8ec78c… незмінні; у production немає
   колонки event_type, таблиці elo_week_plan і нових функцій (перевірено після прогонів).
```

## 1. Changes made

| Файл | Що |
|---|---|
| `db/elo-integrity.sql` (new) | міграція `elo_integrity_server_identity`: `elo_events.event_type` + partial UNIQUE `(user_id, event_type, day) where event_type <> 'admin'`; таблиця `elo_week_plan` (server-owned, без гранту клієнту); функції `elo_planned_for`, `elo_week_room`, `season_bounds`; переписані `elo_submit`, `elo_try_clean_day`, `elo_eval_week_for`, `elo_catch_up_weeks`, `elo_close_season`, `admin_elo_set` |
| `db/elo-integrity-tests.sql` (new) | 28 транзакційних тестів (завершуються винятком → rollback) |
| `db/elo-tests.sql` | 3 очікування «план=1 → 45/6/0» → «17/17/17» (нова модель planned ≥ 3) |
| `js/elo-api.js` | коментар про серверну ідентичність; код і API клієнта незмінні |

Frontend, offline-черга, імпорт/експорт, UI — без змін.

## 2. Migration details

Порядок: додати `event_type` → backfill з існуючих рядків (`admin`/`week:`/`cleanday:`/category) → **стоп з помилкою, якщо є дублі (user, event_type, day)** (у production 1 рядок, дублів немає) → NOT NULL + CHECK → partial UNIQUE index → `elo_week_plan` (RLS FORCE, без політик, REVOKE від anon/authenticated) → helper-и (EXECUTE лише service_role) → CREATE OR REPLACE RPC. Детермінована; історія не видаляється; існуючий `UNIQUE(user_id, action_key)` лишається (серверні ключі `kind:day` йому не суперечать). Відкат: `drop index elo_events_identity; alter table … drop column event_type; drop table elo_week_plan;` + повернення функцій із `db/elo-authoritative.sql`/`elo-engine.sql`.

## 3. Database invariants

| Property | Enforcement |
|---|---|
| one event / (user, type, day) | partial UNIQUE INDEX `elo_events_identity` + INSERT під `FOR UPDATE` season_state |
| action_key не впливає | `elo_submit` не читає `p_action_key`; ключ = `p_kind||':'||p_day` |
| paid ≤ intended (реконсиляція вгору) | `inc := greatest(0, intended − paid)`; delta події лише зростає |
| weekly cap 200 на Σ(delta>0) усіх джерел | `elo_week_room()` у submit, cleanday, week-bonus; під row lock |
| training weekly 51 | збережено як частка категорії |
| day cap 45 | збережено як smoothing guard (intended день = 36) |
| season cap 2500 | `least()` у кожному update + CHECK `season_state.elo` |
| planned snapshot | `elo_week_plan` PK (user, week_start), клієнт без гранту; `greatest(3, least(7, …))` |
| reserved event types | `week`/`cleanday` створюються лише серверними функціями; `p_kind` whitelist |
| season close | `current_date > season_end + submitWindowDays` (`season_bounds`) |
| historical immutability | submit → `season_closed`, якщо є `season_history`; після вікна submit у сезон неможливий |
| bonus replay | `event_type` cleanday/week + UNIQUE |
| concurrency | усі нарахування під `SELECT … FOR UPDATE` рядка season_state; unique-конфлікт → компенсація |

## 4. RPC changes

- `elo_submit(p_kind, p_action_key, p_day, p_payload)` — сигнатура та сама; `p_action_key`/`p_payload` ігноруються; нові відповіді: `reconciled:true, paid:N`, `error:'season_closed'`.
- `elo_close_season` — нові відповіді `invalid_season`, `season_running` (+`finalAfter`).
- `elo_evaluate_week`/`elo_catch_up` — без змін сигнатур; використовують знімок плану.
- Гранти незмінні; нові helper-и — лише service_role.

## 5. Frontend compatibility

Клієнт (`js/elo-hooks.js`, `js/elo-api.js`) шле `kind:day` ключі — вони збігаються із серверними; будь-який інший/старий/випадковий ключ безпечний (P12, перевірено). `duplicate:true` повертає `delta` події (як і раніше) — UI не змінюється. Офлайн-черга `ib.eloPending` — повтори безпечні.

## 6. Tests added

`db/elo-integrity-tests.sql` — 28/28 (прогін у транзакції з міграцією):
replay 9 ключів (порожній, пробіл, Unicode, 5000 символів, UUID, `week:`, `cleanday:`) → ELO 5; одна подія; payload ігнорується; planned=1 → 17 і знімок 3 незмінний після правки профілю на 7; `elo_week_plan` недоступна клієнту; реконсиляція 9 → +8 → paid 17; гірші факти → duplicate; no_data; тижневий бюджет 199 → +1 → 200 → +0; close: current/next/2030/invalid → блок; минулий → ok/duplicate/awards 1×; submit у закритий сезон → `season_closed`; DB: дубль (user,type,day) неможливий; week+cleanday в один день не колізують.

## 7. Previous vulnerabilities

| Finding | Before (runtime, до fix) | After (runtime, після fix у транзакції) | Status |
|---|---|---|---|
| F-01 key rotation | sleep 5 → 12 replay = 45/день | 15 replay/kind/день → 36/день (intended), 1 подія/тип | FIXED |
| F-A planned=1 | workout 45 | 17; знімок тижня 3; правка профілю не впливає | FIXED |
| F-03 weekly bypass | 315/тиж | Σ(delta>0)/тиж ≤ 200 (199 → +1 → +0) | FIXED |
| F-B week preclaim | `week:` ключ прийнято | `p_kind='week'` → unknown kind; ключ клієнта не читається; service events = 0 | FIXED |
| F-02 future close | WINTER-2026 закрито, 5 awards | next/2030 → `season_running`; close лише після end+2 | FIXED |
| F-05 self-report | 36/день без активності | 36/день без активності | BY DESIGN (Model 1) |

## 8. Second-order vulnerabilities (перевірено проти нової реалізації)

- S-1 колізія bonus-типів у неділю — усунуто `event_type` (тест: week + cleanday в один день OK).
- S-2 «перший submit блокує» — реконсиляція вгору (тест 9 → 17); clawback навмисно відсутній: paid ≤ max(intended) над усіма поданими версіями фактів, що і є верхньою межею.
- S-3 net-сума бюджету — рахується лише `delta > 0`.
- S-4 бонус тижня при повному бюджеті — обрізається до лишку (Option A задокументована).
- S-6 close без вікна — `end + submitWindowDays`.
- Reconciliation abuse: підняти intended можна лише кращими фактами тієї ж події; стелі застосовуються до приросту → не перевищує 36/день, 200/тиж.
- Timezone (сервер UTC): identity містить `p_day` → одна подія в одному дні незалежно від локального часу клієнта.

## 9. Economic model after fixes

```text
intended max/день: 36 (тренувальний) / 19 · max/тиждень: 200 (Σ delta>0, включно з бонусами) · сезон: 2500 (cap)
dayGainCap 45 — лишено як smoothing guard (тижневий бюджет його перекриває)
```

## 10. Honest vs attacker

| | ELO/день | ELO/тиждень | днів до 2500 |
|---|---:|---:|---:|
| Honest ідеальний | 27.6 | 200 | ≈88 |
| Self-report abuser (fake facts) | 27.6 | 200 | ≈88 |
| Protocol abuser **до** fix (F-01+F-A+F-03) | 45 | 324 | 56 |
| Protocol abuser **після** fix (15 replay/kind/день, planned=1, payload) | 36 → 27.6 avg | 200 | ≈88 |

Протокольна маніпуляція більше не дає переваги над intended self-report моделлю.

## 11. Self-report limitations

`PROTOCOL INTEGRITY: PASS` · `FACT AUTHENTICITY: SELF-REPORTED BY DESIGN` — сервер не верифікує реальність тренувань/сну/кроків; рейтинг = adherence score. UI-термінологія не змінювалась.

## 12. Remaining risks

- Runtime concurrency (паралельні elo_submit) — lock-аналіз safe; не проганялось.
- `db/elo-tests.sql` (легасі) шле `wb1` на current_date−2 — на 1–2 день сезону це `out_of_window` (pre-existing date-sensitivity, не регресія); запускати з 3-го дня сезону.
- Міграція зупиниться, якщо в production зʼявляться дублі (user, event_type, day) до її застосування — тоді розібрати адміном.

## 13. Untested

Реальний week-eval/штраф (немає завершеного тижня сезону), реальна межа сезону, PostgREST body-limit, паралельний прогін — unsafe without staging. Міграція НЕ застосована до production — лише транзакційно (3 прогони, кожен відкочено).

## 14. Final security verdict

```text
PROTOCOL SECURITY: PASS   (за транзакційним прогоном міграції + 28 тестів + adversarial replay)
FACT AUTHENTICITY: SELF-REPORTED BY DESIGN
ELO SECURITY (після застосування db/elo-integrity.sql): PASS для economic invariants P1–P12
```
Наступний крок (не виконано): `apply_migration elo_integrity_server_identity` з `db/elo-integrity.sql`, потім `db/elo-integrity-tests.sql` у SQL Editor (очікується `ELO-INTEGRITY: 28 з 28`).
