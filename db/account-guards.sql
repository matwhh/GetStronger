-- =============================================================================
-- БАРʼЄРИ АКАУНТА Й ФОРМА ДАНИХ  (аудит 2026-09)
-- =============================================================================
-- Міграції: account_guards_and_data_shape, awards_named_columns_and_kind_check
--
-- SEC-001. register_request перевіряв лише blocked і approved. Для rejected
-- він робив upsert зі status='pending' і обнуляв decided_at/decided_by —
-- тобто відхилений сам повертав собі розгляд і стирав рішення адміна.
-- Тепер відмова лишається відмовою: RAISE 'REJECTED'. Це видиме
-- користувачам правило, і воно свідоме — інакше відмова нічого не значить.
--
-- SEC-002. Якщо адмін схвалював користувача БЕЗ заявки (admin_decide на
-- порожньому рядку), username лишався null. register_request потім просто
-- повертав 'approved', не зберігаючи введений нік, а elo_set_name писав у
-- season_state.display_name довільний рядок без жодної перевірки — і саме
-- він показувався всім у elo_leaderboard. Тепер нік дописується, а
-- elo_set_name застосовує ті самі правила, що й заявка, плюс перевірку на
-- зайнятість.
--
-- SEC-003. profiles.data приймала масив, рядок і null. Серверні читачі
-- (elo_facts, elo_planned_for, elo_tracker_value) працюють через #> і ->>,
-- на не-обʼєкті мовчки віддають null — «даних немає», без винятку. Додано
-- CHECK jsonb_typeof(data) = 'object'. Заразом created_at прибрано з
-- дозволених клієнту колонок: момент створення рядка — не його справа.
--
-- DB-004. account_status.decided_by не мав FK: після видалення адміна в
-- рядку лишався uuid, що ні на що не вказує. on delete set null, а не
-- cascade: рішення про акаунт має пережити зникнення того, хто його ухвалив.
--
-- DB-014. Перевірка ніка й вставка були двома операторами без блокування:
-- два паралельні виклики з тим самим ніком обидва проходили exists, і
-- другий падав із 23505, який клієнт показував як невідому помилку. Тепер
-- unique_violation перетворюється на зрозумілий USERNAME_TAKEN. Дедуп
-- згод так само переїхав з «перевір, потім встав» на унікальний індекс
-- consent_log_uniq: журнал згод — юридичний документ, а не статистика.
--
-- DB-015. Усі 14 insert у awards були позиційні. Порядок колонок сьогодні
-- збігається, але будь-яке додавання колонки не в кінець ламає всі
-- чотирнадцять одночасно й мовчки. Тепер імена колонок і CHECK на набір
-- kind. Заразом elo_close_season добиває останній тиждень сезону ДО
-- підбиття підсумку (ELO-005): поки season_history порожня, оцінка ще
-- можлива.
--
-- DB-016. elo_config була єдиною таблицею без FORCE ROW LEVEL SECURITY.
-- Практичного наслідку сьогодні немає (власник має rolbypassrls), але
-- розходження у зразку захисту саме по собі є проблемою: копіюють завжди
-- найближчий приклад.
--
-- SEC-005 (leaked password protection) закрити з коду не можна: це
-- перемикач у панелі Supabase. Лишається за власником.
--
-- Фактичний текст функцій — у db/live-schema.sql.
-- =============================================================================

alter table public.profiles
  add constraint profiles_data_object check (jsonb_typeof(data) = 'object') not valid;
alter table public.profiles validate constraint profiles_data_object;

-- УВАГА, ДОРОГО КУПЛЕНЕ. Тут спершу стояло grant update (data) — і цим
-- збереження профілю ламалось ЦІЛКОМ. PostgREST на upsert
-- (POST /rest/v1/profiles?on_conflict=user_id) виконує
--   on conflict (user_id) do update set user_id = excluded.user_id, data = ...
-- тобто пише і user_id. Без права на цю колонку — 42501 permission denied
-- на КОЖНЕ збереження. Виправлено міграцією
-- profiles_update_user_id_column_grant; перевірку, яка ловить саме цей клас
-- помилок, додано в tools/verify-schema-perms.mjs.
--
-- Підміна чужого рядка правом на user_id не відкривається: політика
-- profiles_update_own має with check (auth.uid() = user_id).
revoke update on public.profiles from authenticated;
grant update (user_id, data) on public.profiles to authenticated;

alter table public.account_status
  add constraint account_status_decided_by_fkey
  foreign key (decided_by) references auth.users(id) on delete set null;

create unique index if not exists consent_log_uniq
  on public.consent_log (user_id, document, version);

alter table public.elo_config force row level security;

alter table public.awards
  add constraint awards_kind_check check (kind in (
    'level5','level7','level8','level9','level10','elite',
    'first','top3','top10','top100','top1000',
    'top10pct','top5pct','top1pct')) not valid;
alter table public.awards validate constraint awards_kind_check;

-- -----------------------------------------------------------------------------
-- TIM-007 (частина 1): вікові ворота за локальним днем
-- -----------------------------------------------------------------------------
-- Клієнт пускає з 00:00 ЛОКАЛЬНОГО дня 17-річчя, а сервер рахував вік від
-- current_date (UTC). У Києві між 00:00 і 03:00 дня народження людина
-- проходила гейт на сторінці й отримувала UNDERAGE від сервера — тобто
-- застосунок суперечив сам собі рівно три години на рік.
--
-- current_date + 1 покриває всі пояси: UTC ніколи не відстає від
-- локального дня більше ніж на добу.
--
--   yrs := date_part('year', age(current_date + 1, p_birth));
--   if p_birth is null or p_birth > current_date + 1 then BIRTH_INVALID
--
-- Друга половина TIM-007 (today_delta на current_date) закрита окремо —
-- міграція elo_state_local_day, див. db/elo-state-local-day.sql: клієнт
-- передає свій локальний день, сервер валідує його у вікні −2..+1.
-- grace_until лишається на current_date: це межа тривалістю в дні, а не
-- показник за добу, і зсув на кілька годин її не спотворює.
