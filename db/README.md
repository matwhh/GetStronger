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
| **Інструменти** | `backup-export.sql`, `snapshot-before-plan.sql`, `restore-skeleton.sql`, `RESTORE.md`, `*-tests.sql`, `sim-week.sql` | Виконуються свідомо й окремо. Див. `RESTORE.md`. |

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
20260912224504  elo_pace_level_curve                   → elo-pace.sql            ← перебаланс
20260912230526  deny_public_execute                    → deny-public-execute.sql ← SEC
20260912230827  season_end_plpgsql                     → season-end-plpgsql.sql
20260912231110  season_helpers_execute_authenticated   → season-helpers-grant.sql
20260913173713  elo_week_ready_revoke_authenticated    → elo-week-ready-revoke.sql ← SEC
20260913175326  lint_followups_comments_and_fk_index   → lint-followups.sql
20260913223623  elo_partial_day_cap                    → elo-partial-cap.sql     ← правила
```

**Про `elo-pace.sql`.** Це не точкова правка, а зміна БАЛАНСУ: вартість дії
починає залежати від рівня, а шкала розтягується (стеля 3000, ELITE від
2400, рівень по 240). Міграція чіпає пʼять функцій, два CHECK і рядок
`elo_config`. Накочено на бойову базу 12.09.2026 як
`20260912224504 elo_pace_level_curve`; тіла всіх пʼяти функцій звірені з
файлом побайтово (`md5(prosrc)`), конфіг у базі звірений із
`db/elo-config.json` полем у поле.

**Два CHECK — усередині ТІЄЇ САМОЇ міграції (розділ 7), до `update
elo_config`.** `season_state.elo` і `elo_events.elo_after` мали
`<= 2500` ще з `cron-log-and-guards.sql`. Спершу цього в файлі не було
взагалі: конфіг піднімав стелю до 3000, обмеження лишались на 2500, і
DB-005 спрацював би не одразу, а в людини під час звичайної дії — у той
день, коли рейтинг уперше перевалить за старі 2500.

**Відкоту окремим файлом немає.** Старі тіла всіх пʼяти функцій лежать у
git: `git show <коміт перед перебалансом>:db/live-schema.sql`. Разом із
ними треба повернути `elo-config.json` версії 2 і опустити обидва CHECK —
і саме в такому порядку: спершу конфіг, тоді обмеження, інакше стан 2600
не влізе в `<= 2500`.

**Три міграції, які випливли з перезняття знімка.** Знімок схеми відстав від
бази на три міграції (09–11.09) і був виправлений руками. Щойно його перезняли
справжнім запитом, показалось три речі, кожну з яких ховала саме ця
застарілість:

- `deny_public_execute` — шість функцій мали `execute` для `anon`. Postgres
  дає нову функцію ролі PUBLIC за замовчуванням, а `anon` входить у PUBLIC;
  одноразовий `revoke` з `elo-engine.sql` на пізніше створені функції не діє,
  а `default-privileges.sql` знімав право «з anon, authenticated» — тобто не
  з того, від кого воно приходить. Тепер знято з PUBLIC і закрито типове
  право на майбутнє.
- `season_end_plpgsql` — знімок не розгортався ЗОВСІМ: дамп упорядкований за
  алфавітом, а `season_end` мовою sql кликала `season_nominal_end`, яка нижче.
  Тіло sql-функції розбирається при створенні. Та сама пастка, що колись із
  `elo_week_room`, і те саме лікування — plpgsql.
- `season_helpers_execute_authenticated` — `season_of` мала грант для
  `authenticated`, але після `season_week_bounds` кличе чотири помічники, на
  які гранта немає, і не є definer. Виклик падав із «permission denied for
  function season_bounds» три дні; побачили тести, а не люди, бо клієнт
  `season_of` не кличе.

**`elo_week_ready_revoke_authenticated` — витік факту про чужий акаунт
(аудит 13.09.2026).** `public.elo_week_ready(uid, p_week_start, cfg)` —
SECURITY DEFINER, приймає uid ПАРАМЕТРОМ (а не бере `auth.uid()`), і в
бойовій базі мала `grant execute … to authenticated`. Відповідь — рядок
про ЧУЖИЙ акаунт: `season_closed` (людина закрила сезон),
`before_first_event` (подій у сезоні немає), `null` (є). Тобто будь-хто,
хто ввійшов і знає чужий UUID, дізнавався, чи грає та людина в сезоні.

Гранта не було в жодному файлі `db/`: `elo-week-eval-fix.sql`, яка цю
функцію створила, робить `revoke all … from public` і дає execute лише
`service_role`. Право лишилось у базі від типового PUBLIC і закріпилось
іменним. Тобто продакшн розійшовся зі своїм джерелом, і побачити це можна
було тільки запитом до бази — що й сталось аж через тиждень.

Серверні виклики не постраждали: `elo_catch_up_weeks` і
`elo_eval_week_for` самі SECURITY DEFINER, тобто ходять від власника;
клієнт цю функцію не кличе взагалі. Сторожем стала нова перевірка в
`tools/verify-schema-perms.mjs` — саме там, а не в гігієні: розходження
було між файлом і БАЗОЮ, і файл про нього не знав.

**`lint_followups_comments_and_fk_index` — хвости лінтера (аудит
13.09.2026).** Supabase advisors показують п'ять зауважень; чотири з них —
не дефекти, а рішення, про які ніде не було сказано.

- `cron_log` і `elo_week_plan` мають RLS **без жодної політики** — це
  deny-all, найсуворіший можливий стан: пишуть у них лише SECURITY
  DEFINER-функції, які політик не питають. Лінтер показує це як
  `rls_enabled_no_policy`, і наступний, хто побачить звіт, «полагодить» це
  політикою — тобто ВІДКРИЄ таблицю. Тому пояснення тепер лежить
  `comment on table` — там само, де й зауваження.
- `account_status.decided_by` — зовнішній ключ без покривного індексу.
  Єдине справжнє зауваження, і закрите: без індексу видалення акаунта
  змушує прочитати `account_status` цілком. На теперішніх обсягах це
  мілісекунди, але `delete_account` людина натискає з почуттям «зараз усе
  зникне», і чекати там не варто взагалі.
- `unused_index` на `cron_log_job_time` і
  `account_status_status_requested_idx` — правда, яка нічого не означає: у
  таблицях одиниці рядків, планувальник бере seq scan. Обидва обслуговують
  уже написані запити й знадобляться саме тоді, коли рядків стане багато.
  Не чіпаємо.
- `auth_rls_initplan` на `elo_config_read` — хибна тривога: політика вже
  має вигляд `(select is_approved(auth.uid()))`, тобто скалярний підзапит,
  обчислений один раз. До того ж у `elo_config` рівно один рядок
  (`CHECK id = 1`).

**`db/elo-pace-recount.sql` — одноразовий добір, не міграція.** Сезон
AUTUMN-2026 уже йшов, тож набране за плоскою шкалою перераховано під новий
темп: не переписуванням старих подій (людина бачила ті числа), а однією
подією `admin`. Прогнано 12.09.2026: 24 → 52 ELO. Скрипт ідемпотентний і
відмовляється писати, якщо його формула не відтворює старі дельти з
темпом 1. Порядок операторів усередині файла має значення: стара
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

**Знімок мусить РОЗГОРТАТИСЬ, а не лише читатись.** Функції в ньому стоять за
алфавітом — не за залежностями. Тіло `language sql` розбирається в момент
створення, тож sql-функція, яка кличе функцію з іменем НИЖЧЕ за алфавітом,
робить знімок нерозгортовним, а з ним падають усі 92 серверні тести
(`tools/verify-sql-suites.mjs`). Лікування — plpgsql: його тіло компілюється
при першому виклику. Так уже двічі: `elo_week_room`, `season_end`.

Він бачить і те, чого не показує `information_schema.role_table_grants`:
колонкові права. Саме через їхню відсутність у знімку ледь не лишилось
непоміченим зникнення `update` на `profiles`.

## Відомі розбіжності репозиторію й бази

- Шість таблиць і дев'ять функцій існують лише в міграціях (INV-001). Для
  відтворення схеми береться `live-schema.sql`.
- **Коментарі трьох функцій не доїхали в базу.** `season_of`,
  `season_nominal_end` і `purge_abandoned_signups` у базі лежать без
  коментарів, які є у файлах міграцій; код збігається слово в слово. Отже
  знімок (він бере текст із бази) у цих трьох місцях коротший за
  репозиторій. Правити немає чого: різниця лише в коментарях, а
  перестворювати функцію заради коментаря — зайвий риск на бойовій базі.
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
