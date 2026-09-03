# FORGE BACKEND SECURITY FORENSIC REPORT

Дата: 2026-09-02 · Режим: READ-ONLY, без fixes, без commit/deploy.
Усі мутаційні проби виконані ВИКЛЮЧНО всередині `BEGIN … ROLLBACK`
(результат повертався через `RAISE EXCEPTION`, тобто транзакція гарантовано
відкочена). Production-стан незмінний: `account_status=1, profiles=1,
admins=1, season_state=1, elo_events=1` до і після.

## 1. Executive Verdict

```text
SECURITY STATUS: READY AFTER SECURITY FIXES
```

Cross-user доступу (read/write), privilege escalation, approval bypass,
service-role витоку — НЕ знайдено (перевірено runtime). Знайдено одну
HIGH-проблему цілісності ELO (replay через довільний `action_key`) та одну
MEDIUM (закриття ще не розпочатого сезону з нагородами). Обидві —
self-scoped (впливають на рейтинг/лідерборд, не на чужі дані).

## 2. Scope

Перевірено: live-каталог Postgres (таблиці, гранти, RLS, функції, тригери,
constraints), тіла всіх 16 RPC, доступних `authenticated`; anon-поверхня
PostgREST/Auth/Storage через HTTP; імперсонація трьох ідентичностей у
rolled-back транзакціях (B — authenticated без акаунта; C — approved
non-admin, транзитно створений і відкочений; A — реальний admin лише як
ЦІЛЬ атак, жодного виклику від його імені); git history на секрети;
frontend-рендер серверних даних на XSS-sinks; CSP/headers у `vercel.json`.

## 3. Environment

```text
commit        90ff6eb (master), working tree clean до і після
SCHEMA_VERSION 10 (js/store.js); 24 міграції в базі, остання elo_proportional_workout
runtime       node v22.22.2; unit 472/472
Supabase      sojbyoxcxyiollefupss (production; staging НЕ існує)
test accounts НЕ створювались; C = транзитний рядок у rolled-back транзакції
edge functions 0; storage buckets 0
```

## 4. Architecture (фактична)

```text
Browser (static, Vercel, CSP) ──anon JWT──▶ Supabase Auth (email+password, confirm ON, signup ON)
        │
        ├─ PostgREST /rest/v1/profiles     (authenticated: SELECT/INSERT/UPDATE/DELETE own, RLS FORCED, is_approved)
        ├─ PostgREST /rest/v1/site_files   (anon+auth SELECT true — публічний бандл сайту, 112 рядків)
        ├─ PostgREST read-only own rows: account_status, admins, awards, consent_log, elo_config, elo_events, season_state, season_history
        └─ RPC (усі SECURITY DEFINER, owner postgres, search_path=public, EXECUTE: authenticated+service_role, anon — жодної):
             account_state, register_request, username_free, delete_account,
             elo_state, elo_submit, elo_catch_up, elo_evaluate_week, elo_close_season,
             elo_activate_grace, elo_history, elo_recent, elo_leaderboard, elo_set_name,
             is_admin(uid), is_approved(uid), admin_decide, admin_requests, admin_elo_set, admin_elo_list
Identity: auth.uid() із підписаного JWT у КОЖНІЙ функції; жоден RPC не приймає user_id від клієнта
(крім admin_* — після is_admin(auth.uid())).
```

## 5. Attack Surface (inventory)

| Table | RLS | anon R | anon W | auth R | own W | cross R | cross W | admin |
|---|---|---:|---:|---:|---:|---:|---:|---|
| profiles | FORCED | DENY (401, tested) | DENY | own+approved (tested) | own+approved (tested) | DENY (tested: 0 rows / RLS violation) | DENY (tested) | via RPC only |
| account_status | FORCED | DENY (tested) | DENY | own (tested) | NONE (no grant; tested) | DENY | DENY | admin_decide |
| admins | FORCED | DENY (tested) | DENY | own | NONE (tested) | DENY | DENY | SQL only |
| season_state / elo_events / awards / season_history / consent_log | FORCED | DENY | DENY | own+approved | NONE (tested) | DENY (tested) | DENY (tested) | RPC |
| elo_config | on | DENY | DENY | approved | NONE | n/a | n/a | SQL |
| site_files | on | ALLOW (by design) | DENY | ALLOW | NONE | n/a | n/a | service_role |
| leaderboard (view, security_invoker) | — | DENY (tested) | — | own row only (див. F-07) | — | — | — | — |

## 6. Authentication Results

Supabase Auth email+password; `mailer_autoconfirm=false` (підтвердження пошти ввімкнено), `disable_signup=false`, anonymous users OFF, OAuth OFF. Сесія — bearer JWT у localStorage/sessionStorage (B1-модель), сервер валідує підпис; `ib.session`/`ib.account` — лише UX-кеш: підроблена сесія без валідного підпису дає 401 на будь-який запит (RLS/RPC ідентичність — виключно `auth.uid()`). Leaked-password protection вимкнено (advisor WARN). Серверна password policy, rate limits Auth, password reset, email flows — NOT TESTED (мутації проти production).

## 7. Authorization Results

Усі перевірки в rolled-back транзакціях:

```text
B (authenticated, без account_status):
  SELECT profiles/account_status/elo_events/season_state/elo_config → 0 рядків
  INSERT profiles as A / own            → RLS violation (не approved)
  UPDATE/DELETE profiles A              → 0 rows
  INSERT/UPDATE account_status, admins  → permission denied (гранта немає)
  UPDATE season_state, INSERT elo_events→ permission denied
  elo_state/elo_submit/elo_leaderboard/elo_close_season → NOT_APPROVED
  admin_decide/admin_requests/admin_elo_set/admin_elo_list → FORBIDDEN
  register_request(underage 2012)       → UNDERAGE (сервер рахує вік сам)
C (approved non-admin):
  SELECT profiles → лише свій; A → 0
  UPDATE profiles SET user_id = A / X   → RLS violation (ownership transfer DENIED)
  INSERT profiles user_id = A           → RLS violation (forged insert DENIED)
  UPDATE season_state (own)             → permission denied
  admin_decide(self,'approve')          → FORBIDDEN
```

## 8. RLS Results

13 політик, усі PERMISSIVE для `authenticated`; кожна містить `auth.uid() = user_id`, дані-таблиці додатково `is_approved(auth.uid())` (fail-closed: немає рядка → false). Небезпечних `USING (true)` — лише `site_files_public_read` (публічний бандл; impact: none). Write-гранти для authenticated існують лише на `profiles`. `elo_config` без FORCE RLS — owner postgres, неістотно.

## 9. IDOR/BOLA

Жоден endpoint не приймає ідентифікатор власника від клієнта; `is_admin(uid)`/`is_approved(uid)` приймають довільний uuid → oracle (F-08, LOW).

## 10. Admin / Privilege Escalation

`admins` — без write-гранта; `admin_*` перевіряють `is_admin(auth.uid())`; `admin_decide` не може block/reject себе; `delete_account` блокує останнього адміна. Escalation-шлях НЕ знайдено (tested).

## 11. Approval / Age

Єдиний шлях до `approved` — `admin_decide` (tested FORBIDDEN для non-admin). `register_request` валідує вік сервером (`age(current_date, p_birth)`, 17–120), нік regex 3–13, три згоди. Клієнтський `birthDate` у profile не впливає на сервер.

## 12. ELO Security

Розрахунок — виключно SQL (`elo_submit` → `elo_facts` з `profiles.data` → `elo_action_delta`); `p_payload` ігнорується; стелі: dayGainCap 45, weekly training budget ≈51, seasonMax 2500; вікно дат −2…+1 день; `for update` серіалізує. Але:

- **F-01 (HIGH, CONFIRMED)** `action_key` — довільний рядок клієнта, унікальність лише по ньому. Новий ключ = нова винагорода за той самий день/факт.
- **F-02 (MEDIUM, CONFIRMED)** `elo_close_season` закриває будь-який сезон ≠ поточному, включно з майбутнім, якщо є `season_state` (створюється `elo_submit(p_day = tomorrow)` в останній день сезону).
- Self-reported facts (profile JSON) — design limitation (F-05).

## 13. RPC / SECURITY DEFINER

Усі 31 функція: owner postgres, `SET search_path=public`, anon без EXECUTE; внутрішні helper-и (`elo_facts`, `elo_eval_week_for`, `elo_catch_up_weeks`, `elo_try_clean_day`, `elo_action_delta`) — лише service_role. Dynamic SQL відсутній. Search_path hijacking: неможливий (fixed search_path, helper-и недоступні). PGRST202 розкриває існування функції/назви параметрів — INFORMATIONAL.

## 14. Input Validation

`elo_num` приймає лише число/числовий рядок (NaN/Infinity/scientific → default); `elo_facts` кламп через floors (sleepMax 960, stepsMax…); `elo_submit` kind whitelist (tested 'hack' → exception); `register_request` username regex, birth bounds, consents; `elo_set_name` перекривається approved username (tested: `<script>` → 'ProbeC'). НЕ валідовано: розмір `profiles.data` та `p_screening` (F-04: 200 KB screening прийнято).

## 15. Data Integrity

Constraints: `elo_events (user_id, action_key)` UNIQUE, `season_state.elo 0..2500`, FK → auth.users ON DELETE CASCADE для всіх user-таблиць (orphan-и після delete_account неможливі). Тригер лише `touch_updated_at`.

## 16. Secrets

Git history (31 коміт, `-p`): єдиний JWT — `"role":"anon"` (публічний за задумом). service_role / паролі / DB creds — НЕ знайдено. Frontend: лише anon key. `.env` відсутній. `Опублікувати.command` на Mac користувача (пише `site_files`?) — поза репозиторієм, NOT TESTED.

## 17. Rate Limiting

Кастомних немає. Auth — платформні дефолти (NOT TESTED). PostgREST/RPC — без лімітів: `elo_submit`/`register_request` можна викликати без обмежень (пов'язано з F-01, F-04).

## 18. Storage / Uploads — N/A (0 buckets, upload відсутній).

## 19. Import / Export

JSON-імпорт — клієнтський (account.js cleanDay та ін.), результат іде в `profiles.data` як власний профіль; сервер довіряє йому лише як self-reported ELO-фактам (F-05). `__proto__` — NOT TESTED (без exploit-path на сервері: jsonb).

## 20. Account Deletion

`delete_account()` → `delete from auth.users where id = auth.uid()` → CASCADE; LAST_ADMIN guard. Для неіснуючого uid повертає `{deleted:true}` (cosmetic). Runtime delete NOT TESTED (мутація).

## 21. Concurrency

`elo_submit`, `elo_activate_grace`: `SELECT … FOR UPDATE` на `season_state` → серіалізація per-user; дубль ключа → UNIQUE + `on conflict do nothing` з компенсацією. `elo_close_season` без lock → паралельний дубль впаде на PK `season_history` (без шкоди). CODE-REVIEW CONFIRMED; реальний паралельний прогін NOT TESTED.

## 22. Findings

### [F-01] ELO replay через довільний action_key
```text
Severity: HIGH        Confidence: HIGH        Status: CONFIRMED (rolled-back txn на production-функціях)
Affected: public.elo_submit(p_kind, p_action_key, p_day, p_payload)
Attacker: approved user (звичайний акаунт)
Preconditions: будь-який один факт за день у власному профілі (реальний або self-reported)
Root cause: ідемпотентність = UNIQUE(user_id, action_key), а ключ — довільний текст клієнта;
            сервер не виводить ключ із (kind, day).
Attack path: POST /rest/v1/rpc/elo_submit {"p_kind":"sleep","p_action_key":"sleep:2026-09-02#N","p_day":"2026-09-02"} для N=1..k
Reproduction: honest sleep = +5; 12 повторів з новими ключами = +40 (до dayGainCap 45).
              workout: 17 → +17 → +11 (упирається у week budget 51 і day cap 45) за один реальний тренувальний день.
Expected: одна логічна винагорода на (kind, day).      Actual: до dayGainCap щодня.
Impact: 45×92 = 4140 > seasonMax 2500 → максимум сезону ~за 56 днів без реальної активності;
        лідерборд/нагороди/percentile інших користувачів — знецінені. Cross-user даних не торкається.
Evidence: тест C (див. §12), events=15 sum=45.
Remediation (напрямок): сервер сам формує action_key := p_kind||':'||p_day (ігноруючи клієнтський),
        або перевіряє формат і UNIQUE(user_id, category, day) для не-bonus категорій.
Release impact: блокує «чесний» рейтинг; не блокує приватне використання.
```

### [F-02] Закриття ще не розпочатого сезону з нагородами
```text
Severity: MEDIUM      Confidence: HIGH (функція) / MEDIUM (передумова)   Status: CONFIRMED (функція), CODE-REVIEW (передумова)
Affected: elo_close_season(p_season); elo_submit (p_day ≤ current_date+1, szn ∈ {cur, next, prev})
Attacker: approved user
Preconditions: останній день сезону (30.11 / 28-29.02 / 31.05 / 31.08): elo_submit з p_day=завтра створює season_state наступного сезону
Root cause: перевірка лише `p_season <> season_of(current_date)`; немає перевірки, що сезон завершився.
Reproduction: season_state('WINTER-2026', elo 30) → elo_close_season('WINTER-2026') → ok, rank 1 of 1,
              awards: first, top3, top10, top100, top1000; повторний виклик → duplicate.
Impact: фальшиві нагороди «#1 сезону» у власній історії; реальне закриття того сезону потім НЕМОЖЛИВЕ
        (duplicate) → власна історія зламана; percentile null (minUsers 8) — top-% не фармиться.
Remediation: дозволяти закриття лише якщо season_end(p_season) < current_date.
```

### [F-03] Weekly-budget діє лише для 'workout'
```text
Severity: MEDIUM (підсилює F-01)   Confidence: HIGH   Status: CONFIRMED
sleep/activity/recovery/meal обмежені лише dayGainCap; без F-01 це не експлуатується (1 ключ/день у клієнті).
Remediation: після F-01 — переглянути, чи потрібен per-category weekly budget.
```

### [F-04] Необмежений розмір client-JSON (profiles.data, p_screening) + повторний register_request
```text
Severity: LOW–MEDIUM (cost/DoS)  Confidence: HIGH  Status: CONFIRMED (200 KB screening прийнято), CODE-REVIEW (profiles)
Немає CHECK на octet_length(data); register_request можна викликати повторно (pending/rejected → pending),
кожен виклик додає 3 рядки consent_log; без rate limit. Attacker: будь-який email-confirmed акаунт (навіть не approved).
Remediation: CHECK на розмір jsonb (напр. ≤ 512 KB profile, ≤ 8 KB screening), throttle register_request.
```

### [F-05] ELO-факти повністю self-reported (design limitation)
```text
Severity: MEDIUM   Confidence: HIGH   Status: CODE-REVIEW CONFIRMED
elo_facts читає sessionLog/mealLog/trackerLog із profiles.data, який клієнт пише напряму через PostgREST.
Це архітектурне рішення (сервер не може верифікувати тренування); стелі (day/week/season) — єдиний барʼєр.
Remediation: прийняти як обмеження; посилити стелі; вести аномалії (admin_elo_list).
```

### [F-06] Leaked-password protection вимкнено
```text
Severity: LOW   Status: CONFIRMED (advisor)   Remediation: увімкнути в Auth settings.
```

### [F-07] View `leaderboard` (security_invoker) повертає лише власний рядок
```text
Severity: INFORMATIONAL (positive-security)   Status: CONFIRMED (0 рядків для C)
Клієнт використовує RPC elo_leaderboard, тож функціонально не ламає; view — мертвий/оманливий артефакт.
```

### [F-08] Oracles: is_admin(uid), is_approved(uid), username_free(name) для будь-якого authenticated
```text
Severity: LOW   Status: CONFIRMED (B отримав is_admin(A)=true, username taken)
Impact: перебір ніків; перевірка статусу за UUID (UUID недоступні іншим користувачам → практично не експлуатується).
Remediation: is_admin/is_approved без EXECUTE для authenticated (RLS викликає їх як owner) — ОБЕРЕЖНО: перевірити політики.
```

### [F-09] site_files публічний бандл сайту
```text
Severity: INFORMATIONAL   Status: CONFIRMED (anon 200)
Вміст = ті самі файли, що й на Vercel; секретів немає. Хто пише (service_role з локального скрипта?) — NOT TESTED.
```

## Rejected / False Positives

- **anon key у фронтенді** — публічний за дизайном; anon має 0 грантів окрім site_files (tested 401 на все).
- **SECURITY DEFINER callable by authenticated (21 advisor WARN)** — кожна функція перевіряє auth.uid()/is_approved/is_admin; search_path фіксований; helper-и недоступні. Не vulnerability.
- **localStorage/ib.session/ib.account підробка** — лише UX-маршрутизація; сервер вимагає підписаний JWT (agegate — не барʼєр за коментарем і фактом).
- **XSS через ім'я в лідерборді** — username валідується regex на сервері, display_name перекривається username, рендер через esc(); admin-панель також esc().
- **CORS `*` / CSRF** — bearer-токен у заголовку, cookies не використовуються → класичний CSRF не застосовний.
- **Prototype pollution через імпорт** — сервер зберігає jsonb; exploit-path не знайдено (NOT TESTED глибше).
- **elo_evaluate_week(p_week_start) з довільною датою** — лише минулі повні тижні поточного сезону, idempotent (tested other_season/week_not_over).
- **admin_decide на неіснуючий uuid** — FK auth.users відхилить.

## UNTESTED

- Реальні signup/email confirmation/password reset/rate limits Auth (мутації production).
- Реальний `delete_account` runtime; реальний паралельний навантажувальний прогін `elo_submit`.
- Максимальний body PostgREST для `profiles.data` (Kong/PostgREST ліміт).
- Джерело запису `site_files` (локальний `.command` користувача).
- Реальний перехід межі сезону (F-02 передумова відтворена логічно, не датою).
- iOS/Android браузери, service worker offline cache, багатопристрійні конфлікти.

## Coverage

```text
Authentication       PARTIAL (settings + модель; flows NOT TESTED)
Authorization/RLS    TESTED (runtime, 3 ідентичності, rolled-back)
IDOR / ownership     TESTED
Admin escalation     TESTED
Approval / age       TESTED
ELO                  TESTED (replay, dates, kinds, close_season)
RPC / DEFINER        TESTED (каталог + тіла)
Secrets / git        TESTED
Rate limiting        CODE-REVIEW
Storage / uploads    N/A
Concurrency          CODE-REVIEW
```

## Final Release Recommendation

```text
P0 — MUST FIX BEFORE EXPOSURE
  F-01 action_key replay — рейтинг фармиться до seasonMax без активності.
P1 — SHOULD FIX BEFORE PRODUCTION
  F-02 закриття майбутнього сезону; F-04 розмір JSON + throttle register_request; F-06 leaked-password protection.
P2 — HARDENING
  F-03 per-category weekly budget; F-08 oracles; F-07 прибрати/виправити view leaderboard.
P3 — OPTIONAL
  F-09 документувати site_files; audit-log для admin_decide/admin_elo_set (є decided_by/elo_events category admin — достатньо).
```

## Відповіді на 15 питань

1. Чужі дані прочитати — **NO** (tested: 0 рядків, RPC лише own).
2. Чужі дані змінити — **NO** (tested: RLS violation / 0 rows / permission denied).
3. Стати admin — **NO** (admins без write-гранта; admin_* FORBIDDEN).
4. Стати approved без authorization — **NO** (account_status без write-гранта; admin_decide FORBIDDEN).
5. Обійти server-side age/approval — **NO** (UNDERAGE/NOT_APPROVED tested).
6. Підробити ELO — **YES, self-scoped**: F-01 replay (CONFIRMED) + self-reported facts (design).
7. Replay ELO reward — **YES** (той самий ключ → duplicate; новий ключ → нова винагорода).
8. Маніпуляція датами — **PARTIAL**: вікно −2…+1 день тримає (tested); межа сезону — F-02 (code-review).
9. Обійти RLS через RPC — **NO** (усі RPC — auth.uid()).
10. Небезпечні SECURITY DEFINER — **NO** структурно; логічні дефекти F-01/F-02 усередині безпечних за доступом функцій.
11. service-role/секрети exposed — **NO** (git history + бандл: лише anon).
12. Destructive action над чужим акаунтом — **NO** (delete_account лише self; admin_* лише admin).
13. Sensitive data exposure — **NO** для non-admin (leaderboard: нік+ELO approved-користувачів — за дизайном); email — лише admin_requests.
14. Race conditions — **NO meaningful** (FOR UPDATE; code-review, runtime NOT TESTED).
15. Untested critical areas — Auth flows/rate limits, реальний delete, PostgREST body limit, реальна межа сезону, site_files writer.
