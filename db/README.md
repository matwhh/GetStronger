# db/ — що це і в якому порядку

Аудит 2026-09 (DB-007, HIGH) описав цю теку так: нашарування версій без
порядку застосування. Повторний прогін `db/elo-engine.sql` повертав частину
функцій до старішого стану — і саме так із продакшену зникав барʼєр
`NOT_APPROVED` (INV-002). Файли виглядали як «схема», а насправді були
історією змін, кожна з яких перезаписує попередню.

Цей документ не міняє файли. Він каже, чим вони є, щоб ніхто більше не
виконав їх «щоб оновити базу».

## Три різні речі в одній теці

| Що | Файли | Як з цим поводитись |
|---|---|---|
| **Знімок бойової схеми** | `live-schema.sql` | Джерело правди про те, що ЗАРАЗ у базі. Згенеровано, руками не редагується. Цілком по продакшену не виконується. |
| **Історія змін** | `schema.sql`, `elo-*.sql`, `admin-elo*.sql`, `account-approval.sql`, `security-hardening*.sql`, `nick-length.sql`, `leaderboard-name.sql`, `cron.sql` | Те, чим базу доводили до нинішнього стану. Читати — так. Виконувати по продакшену — ні. |
| **Інструменти** | `backup-export.sql`, `restore-skeleton.sql`, `RESTORE.md`, `*-tests.sql`, `sim-week.sql` | Виконуються свідомо й окремо. Див. `RESTORE.md`. |

## Як міняти базу

Тільки міграцією: `apply_migration` з осмисленою назвою, і той самий текст —
файлом у `db/`. Після цього перезняти `live-schema.sql` тим самим запитом,
яким його згенеровано, і закомітити разом із міграцією. Тоді різницю між
репозиторієм і базою видно в `git diff`, а не через аудит раз на півроку.

`tools/ci-hygiene.mjs` перевіряє одну річ автоматично: якщо функція має в
`live-schema.sql` барʼєр `is_approved`, вона мусить мати його в кожному файлі
`db/`, який її перевизначає. Це рівно той випадок, який стався (INV-002).

## Порядок застосування на чистій базі

Відповідає порядку міграцій у `supabase_migrations.schema_migrations`
(стан на 2026-09-07, 38 міграцій). Файли покривають його не один-в-один:
шість таблиць і частина функцій живуть ЛИШЕ в міграціях (INV-001), і саме
тому для відтворення схеми береться `live-schema.sql`, а не список нижче.

```
20260827170414  profiles_base                          → schema.sql
20260827170445  elo_seasonal                           → (лише міграція)
20260827171306  elo_engine                             → elo-engine.sql
20260827171448  elo_history_fn                         → (лише міграція)
20260827171902  elo_recent_fn                          → (лише міграція)
20260827173821  site_files_bundle                      → знято 20260902232812
20260827232322  elo_close_season_v2_report_stats       → elo-engine.sql
20260828202003  account_approval                       → account-approval.sql
20260828202028  elo_approved_guard                     → (лише міграція)  ← барʼєр is_approved
20260828202045  elo_approved_guard2                    → (лише міграція)  ← барʼєр is_approved
20260828203640  age_limit_17                           → account-approval.sql
20260828204754  consents_and_deletion                  → (лише міграція)
20260828225845  security_lockdown_rpc_and_view         → security-hardening.sql
20260828230009  perf_rls_initplan_indexes_pagination   → security-hardening.sql
20260829102536  elo_authoritative_facts                → elo-authoritative.sql
20260829102608  elo_delta_and_cleanday_cap             → elo-authoritative.sql
20260829102636  elo_weekly_eval_server_side            → elo-authoritative.sql
20260829102705  elo_submit_authoritative               → elo-authoritative.sql
20260829103742  tighten_table_grants                   → security-hardening.sql
20260830221214  leaderboard_name_from_approved_username→ leaderboard-name.sql
20260830221909  username_max_13_chars                  → nick-length.sql
20260831000226  harden_elo_config_read_approved_only   → security-hardening-2.sql
20260831004231  elo_catch_up_rpc                       → elo-catchup.sql
20260831151139  elo_proportional_workout               → elo-proportional.sql
20260902210736  elo_integrity_server_identity          → elo-integrity.sql
20260902223423  hardening_size_limits_oracles_view     → security-hardening-2.sql
20260902232812  drop_stale_site_files                  → (лише міграція)
20260902235137  admin_elo_anomalies                    → admin-elo-anomalies.sql
20260904221130  elo_cron_eval_week                     → (лише міграція; див. cron.sql)
20260907204822  elo_week_eval_fix                      → elo-week-eval-fix.sql
20260907205xxx  default_privileges_deny_public         → default-privileges.sql
2026090721xxxx  elo_planned_for_safe_cast_and_retry_flag → elo-planned-and-retry.sql
2026090721xxxx  elo_submit_restore_original_plus_retry_flag → elo-planned-and-retry.sql
2026090721xxxx  cron_log_and_blocked_delete_guard      → cron-log-and-guards.sql
2026090721xxxx  cron_use_logged_wrapper                → cron-log-and-guards.sql
2026090721xxxx  elo_ledger_matches_state               → cron-log-and-guards.sql
2026090721xxxx  elo_delta_equals_actual_change         → cron-log-and-guards.sql
2026090721xxxx  elo_submit_delta_equals_actual_change  → cron-log-and-guards.sql
20260907220219  account_guards_and_data_shape          → account-guards.sql
20260907220324  awards_named_columns_and_kind_check    → account-guards.sql
20260907222400  register_age_gate_local_day            → account-guards.sql
20260907224951  profile_patch_rpc                      → profile-patch-rpc.sql   ← PRF-006
20260907225015  profile_patch_revoke_public            → profile-patch-rpc.sql
20260907230556  fixate_out_of_band_objects             → fixate-out-of-band.sql  ← DB-010
20260907230756  elo_state_local_day                    → elo-state-local-day.sql ← ELO-007
20260907230917  elo_state_planned_week                 → elo-state-local-day.sql ← ELO-008
20260907231404  elo_partial_first_week                 → elo-partial-first-week.sql ← ELO-006
2026090723xxxx  profiles_update_user_id_column_grant   → account-guards.sql
2026090723xxxx  revoke_anon_elo_week_ready             → (лише міграція)
2026090721xxxx  elo_submit_delta_equals_actual_change  → cron-log-and-guards.sql
20260911xxxxxx  purge_abandoned_signups                → purge-abandoned-signups.sql
20260912xxxxxx  elo_pace_level_curve                   → elo-pace.sql            ← перебаланс
```

**Про `elo-pace.sql`.** Це не точкова правка, а зміна БАЛАНСУ: вартість дії
починає залежати від рівня, а шкала розтягується (стеля 3000, ELITE від
2400, рівень по 240). Міграція чіпає пʼять функцій, два CHECK і рядок
`elo_config`. Порядок операторів усередині файла має значення: стара
пʼятиаргументна `elo_action_delta` знімається ОСТАННЬОЮ, уже після того,
як `elo_submit` переведено на нову, — інакше між двома операторами
нарахування падало б із «function does not exist».

Числа підібрані симуляцією (`tools/simelo.mjs`, 400 сезонів на профіль), а
не на око; цілі й причина — у шапці того файла.

**Правило, куплене дорого.** Функцію переписують ЦІЛКОМ лише з її
фактичного тексту (`pg_get_functiondef`), а не з памʼяті про нього. Одна
міграція цього дня переписала `elo_submit` із реконструкції — і мовчки
втратила виклик `elo_try_clean_day`, тижневу стелю через `elo_week_room`,
компенсацію при програній гонці вставки й правильну назву ключа конфігу
(`dayGainCap`, а не `dailyCap`). Наступна міграція повернула точний текст.
Якщо змінюєш одну гілку — міняй саме її, а решту копіюй байт у байт.

## Межі, які НЕ міняються одним UPDATE elo_config

`seasonMax` і `graceWeeksPerSeason` продубльовані в CHECK-обмеженнях
(`season_state.elo <= 2500`, `grace_used <= 2`). Підняти їх у
`db/elo-config.json` можна — помилки не буде одразу, вона вилізе пізніше
як 23514 всередині `elo_submit` або `elo_activate_grace`, у людини під час
звичайної дії (DB-005). Тому: спершу міграція, що піднімає CHECK, і лише
потім конфіг. `tools/ci-hygiene.mjs` звіряє їх при кожній збірці.

## Як перезняти live-schema.sql

`db/dump-live-schema.sql` — той самий запит, яким знято знімок. Раніше його
в репозиторії не було взагалі, тобто вимога «перезняти тим самим запитом»
була невиконанною. Supabase → SQL Editor → цей файл → Run → єдине поле
`b64` (прибрати переноси, розкодувати) → `db/live-schema.sql`.

Він бачить і те, чого не показує `information_schema.role_table_grants`:
колонкові права. Саме через їхню відсутність у знімку ледь не лишилось
непоміченим зникнення `update` на `profiles`.

## Відомі розбіжності репозиторію й бази

- Шість таблиць і дев'ять функцій існують лише в міграціях (INV-001). Для
  відтворення схеми береться `live-schema.sql`.
- `elo_cron_eval_week` виконується планувальником; тіла в репозиторії немає,
  воно є у `live-schema.sql`.
- `elo_close_season` привʼязана до `auth.uid()` і в cron не стоїть — сезон
  закривається вручну (дедлайн 2026-12-03, DB-008). Вона пише `season_history`
  і до 14 рядків `awards` ЛИШЕ для того, хто її викликав, тож серверний
  варіант потребує окремого параметра `p_user` і виклику з розкладу.
- **UTC проти локального дня (TIM-007 / ELO-007, закрито).** «Сьогодні:
  +N ELO» рахувалось від `current_date`, тобто від UTC, тоді як події
  лягають із локальним днем клієнта: у Києві між 00:00 і 03:00 картка
  показувала вчорашню суму і о 03:00 обнулялась сама. Тепер `elo_state`
  приймає `p_today` і валідує його у вікні `current_date−2..+1`, а суму
  бере з `elo_events` за цей день. `today_date`/`today_delta` в
  `season_state` лишились — їх пише й читає `elo_submit`, — але на показ
  більше не впливають. `grace_until` свідомо лишається на `current_date`:
  це межа тривалістю в дні, а не показник за добу.
- **Права на `profiles` (дорого куплене).** Клієнт має табличні
  `select/insert/delete` і КОЛОНКОВЕ `update (user_id, data)`. Спроба
  залишити тільки `update (data)` зламала збереження профілю цілком:
  PostgREST на upsert пише і `user_id`. Перевірка, яка ловить саме цей
  клас помилок, — `tools/verify-schema-perms.mjs` (у CI).
- Результати щоденного підбиття лежать у `public.cron_log`:
  `select run_at, result from cron_log where job = 'elo_cron_eval_week'
   order by run_at desc limit 10;`
- Тижні, що лишились неоціненими через ELO-005 (серпень 2026), НЕ добиті
  свідомо: перерахунок минулого змінив би людям поточний рахунок. Правила
  виправлені на майбутнє.
