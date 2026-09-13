-- =============================================================================
-- ЗНІМОК БОЙОВОЇ СХЕМИ  (згенеровано, не редагувати руками)
-- =============================================================================
-- Генератор: db/dump-live-schema.sql. Порядок секцій значущий:
-- таблиці → обмеження → індекси → функції → RLS → політики → тригери → права.
-- Функції стоять перед політиками, бо політики на них посилаються (is_approved).
--
-- Це ДОВІДКА, а не міграція: виконувати цілком по бойовій базі не можна.
-- Повний опис — у db/README.md.
--
-- Знято: 2026-09-12. PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit, проєкт postgres.
-- =============================================================================

create table if not exists public.account_status (
  user_id uuid not null,
  status text default 'pending'::text not null,
  username text,
  birth_date date,
  screening jsonb default '{}'::jsonb not null,
  requested_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  decided_by uuid,
  note text
);

create table if not exists public.admins (
  user_id uuid not null,
  added_at timestamp with time zone default now() not null
);

create table if not exists public.awards (
  user_id uuid not null,
  season text not null,
  kind text not null,
  label text not null,
  earned_at timestamp with time zone default now() not null
);

create table if not exists public.consent_log (
  id bigint generated always as identity not null,
  user_id uuid not null,
  document text not null,
  version text not null,
  accepted_at timestamp with time zone default now() not null
);

create table if not exists public.cron_log (
  id bigint generated always as identity not null,
  run_at timestamp with time zone default now() not null,
  job text not null,
  result jsonb not null
);

create table if not exists public.elo_config (
  id integer default 1 not null,
  data jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.elo_events (
  id bigint generated always as identity not null,
  user_id uuid not null,
  season text not null,
  day date not null,
  category text not null,
  action_key text not null,
  quality numeric(5,3) default 0 not null,
  delta integer not null,
  elo_after integer not null,
  reason text not null,
  created_at timestamp with time zone default now() not null,
  event_type text not null
);

create table if not exists public.elo_week_plan (
  user_id uuid not null,
  week_start date not null,
  planned integer not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.profiles (
  user_id uuid not null,
  data jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.season_history (
  user_id uuid not null,
  season text not null,
  final_elo integer not null,
  level integer not null,
  elite boolean default false not null,
  rank integer,
  of_users integer,
  percentile numeric(5,2),
  days_active integer,
  days_total integer,
  grace_weeks_used integer default 0 not null,
  stats jsonb default '{}'::jsonb not null,
  closed_at timestamp with time zone default now() not null
);

create table if not exists public.season_state (
  user_id uuid not null,
  season text not null,
  elo integer default 0 not null,
  today_delta integer default 0 not null,
  today_date date,
  grace_used integer default 0 not null,
  grace_until date,
  display_name text,
  updated_at timestamp with time zone default now() not null
);

-- обмеження
alter table public.account_status add constraint account_status_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.account_status add constraint account_status_pkey PRIMARY KEY (user_id);
alter table public.account_status add constraint account_status_screening_size CHECK ((octet_length((screening)::text) <= 8192));
alter table public.account_status add constraint account_status_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'blocked'::text])));
alter table public.account_status add constraint account_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.account_status add constraint account_status_username_len CHECK (((username IS NULL) OR ((char_length(username) >= 3) AND (char_length(username) <= 13))));
alter table public.admins add constraint admins_pkey PRIMARY KEY (user_id);
alter table public.admins add constraint admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.awards add constraint awards_kind_check CHECK ((kind = ANY (ARRAY['level5'::text, 'level7'::text, 'level8'::text, 'level9'::text, 'level10'::text, 'elite'::text, 'first'::text, 'top3'::text, 'top10'::text, 'top100'::text, 'top1000'::text, 'top10pct'::text, 'top5pct'::text, 'top1pct'::text, 'beta'::text])));
alter table public.awards add constraint awards_pkey PRIMARY KEY (user_id, season, kind);
alter table public.awards add constraint awards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.consent_log add constraint consent_log_document_check CHECK ((document = ANY (ARRAY['privacy_policy'::text, 'terms_of_use'::text, 'medical_disclaimer'::text])));
alter table public.consent_log add constraint consent_log_pkey PRIMARY KEY (id);
alter table public.consent_log add constraint consent_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.cron_log add constraint cron_log_pkey PRIMARY KEY (id);
alter table public.elo_config add constraint elo_config_id_check CHECK ((id = 1));
alter table public.elo_config add constraint elo_config_pkey PRIMARY KEY (id);
alter table public.elo_events add constraint elo_events_category_check CHECK ((category = ANY (ARRAY['training'::text, 'nutrition'::text, 'sleep'::text, 'recovery'::text, 'activity'::text, 'penalty'::text, 'bonus'::text, 'admin'::text])));
alter table public.elo_events add constraint elo_events_elo_after_range CHECK (((elo_after >= 0) AND (elo_after <= 3000)));
alter table public.elo_events add constraint elo_events_event_type_check CHECK ((event_type = ANY (ARRAY['workout'::text, 'meal'::text, 'sleep'::text, 'recovery'::text, 'activity'::text, 'cleanday'::text, 'week'::text, 'admin'::text, 'legacy'::text])));
alter table public.elo_events add constraint elo_events_pkey PRIMARY KEY (id);
alter table public.elo_events add constraint elo_events_quality_range CHECK (((quality >= (0)::numeric) AND (quality <= (1)::numeric)));
alter table public.elo_events add constraint elo_events_user_id_action_key_key UNIQUE (user_id, action_key);
alter table public.elo_events add constraint elo_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.elo_week_plan add constraint elo_week_plan_pkey PRIMARY KEY (user_id, week_start);
alter table public.elo_week_plan add constraint elo_week_plan_planned_check CHECK (((planned >= 3) AND (planned <= 7)));
alter table public.elo_week_plan add constraint elo_week_plan_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_data_object CHECK ((jsonb_typeof(data) = 'object'::text));
alter table public.profiles add constraint profiles_data_size CHECK ((octet_length((data)::text) <= 1048576));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (user_id);
alter table public.profiles add constraint profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.season_history add constraint season_history_pkey PRIMARY KEY (user_id, season);
alter table public.season_history add constraint season_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.season_state add constraint season_state_elo_check CHECK (((elo >= 0) AND (elo <= 3000)));
alter table public.season_state add constraint season_state_grace_used_check CHECK (((grace_used >= 0) AND (grace_used <= 2)));
alter table public.season_state add constraint season_state_pkey PRIMARY KEY (user_id, season);
alter table public.season_state add constraint season_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX account_status_decided_by_idx ON public.account_status USING btree (decided_by);
CREATE INDEX account_status_status_requested_idx ON public.account_status USING btree (status, requested_at DESC);
CREATE UNIQUE INDEX account_status_username_key ON public.account_status USING btree (lower(username)) WHERE (username IS NOT NULL);
CREATE UNIQUE INDEX consent_log_uniq ON public.consent_log USING btree (user_id, document, version);
CREATE INDEX consent_log_user_idx ON public.consent_log USING btree (user_id, document);
CREATE INDEX cron_log_job_time ON public.cron_log USING btree (job, run_at DESC);
CREATE UNIQUE INDEX elo_events_identity ON public.elo_events USING btree (user_id, event_type, day) WHERE (event_type <> 'admin'::text);
CREATE INDEX elo_events_user_season ON public.elo_events USING btree (user_id, season, day);
CREATE INDEX season_state_season_elo_idx ON public.season_state USING btree (season, elo DESC);

-- функції

CREATE OR REPLACE FUNCTION public.account_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  cur public.account_status%rowtype;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into cur from public.account_status where user_id = uid;
  if not found then return jsonb_build_object('status', 'none'); end if;
  return jsonb_build_object(
    'status', cur.status,
    'username', cur.username,
    'requestedAt', cur.requested_at,
    'isAdmin', public.is_admin(uid)
  );
end
$function$
;
grant execute on function public.account_state() to authenticated;
grant execute on function public.account_state() to service_role;

CREATE OR REPLACE FUNCTION public.admin_decide(p_user uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  new_status text;
begin
  if not public.is_admin(uid) then raise exception 'FORBIDDEN'; end if;
  new_status := case p_action
    when 'approve' then 'approved'
    when 'reject'  then 'rejected'
    when 'block'   then 'blocked'
    else null end;
  if new_status is null then raise exception 'ACTION_INVALID'; end if;
  -- Самоблокування вимкнено: один адмін не має замкнути себе зовні.
  if p_user = uid and new_status <> 'approved' then raise exception 'SELF_DECIDE'; end if;

  insert into public.account_status (user_id, status, requested_at, decided_at, decided_by)
  values (p_user, new_status, now(), now(), uid)
  on conflict (user_id) do update set
    status = excluded.status, decided_at = now(), decided_by = uid;

  return jsonb_build_object('userId', p_user, 'status', new_status);
end
$function$
;
grant execute on function public.admin_decide(p_user uuid, p_action text) to authenticated;
grant execute on function public.admin_decide(p_user uuid, p_action text) to service_role;

CREATE OR REPLACE FUNCTION public.admin_elo_anomalies(p_season text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  szn text := coalesce(p_season, season_of(current_date));
  budget int := (select (data->>'weeklyBudget')::int from elo_config where id = 1);
  out jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;
  with ev as (
    select user_id, day, category, quality, delta, created_at
    from elo_events
    where season = szn and category in ('training','nutrition','sleep','recovery','activity')
  ),
  days as (
    select user_id, day,
           count(*) filter (where quality >= 0.99) = 5 as perfect,
           bool_or(delta > 0) as active
    from ev group by user_id, day
  ),
  streaks as (
    select user_id, count(*) as len
    from (
      select user_id, day, day - (row_number() over (partition by user_id order by day))::int as grp
      from days where perfect
    ) g group by user_id, grp
  ),
  weeks as (
    select user_id, date_trunc('week', day)::date as wk, sum(delta) filter (where delta > 0) as pos
    from ev group by user_id, date_trunc('week', day)
  ),
  agg as (
    select d.user_id,
           count(*) filter (where d.perfect) as perfect_days,
           count(*) filter (where d.active)  as active_days,
           coalesce((select max(len) from streaks s where s.user_id = d.user_id), 0) as perfect_streak,
           (select count(*) from weeks w where w.user_id = d.user_id and w.pos >= budget) as cap_weeks,
           (select count(*) from ev e where e.user_id = d.user_id and (e.created_at::date - e.day) >= 2) as backdated,
           (select count(*) from ev e where e.user_id = d.user_id) as events
    from days d group by d.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', a.user_id,
      'perfectDays', a.perfect_days,
      'perfectStreak', a.perfect_streak,
      'activeDays', a.active_days,
      'capWeeks', a.cap_weeks,
      'backdated', a.backdated,
      'events', a.events,
      'flags', (
        select coalesce(jsonb_agg(f), '[]'::jsonb) from (
          select 'perfect_streak' f where a.perfect_streak >= 14
          union all select 'all_perfect' where a.active_days >= 14 and a.perfect_days::numeric / a.active_days >= 0.9
          union all select 'cap_weeks' where a.cap_weeks >= 3
          union all select 'backdated' where a.events >= 10 and a.backdated::numeric / a.events >= 0.5
        ) fl)
    ) order by a.perfect_streak desc, a.cap_weeks desc), '[]'::jsonb)
  into out from agg a;
  return jsonb_build_object('season', szn, 'rows', out);
end;
$function$
;
grant execute on function public.admin_elo_anomalies(p_season text) to authenticated;
grant execute on function public.admin_elo_anomalies(p_season text) to service_role;

CREATE OR REPLACE FUNCTION public.admin_elo_list(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  szn text := season_of(current_date);
  out jsonb;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;

  select coalesce(jsonb_agg(t.x order by t.elo desc, t.created_at), '[]'::jsonb) into out from (
    select coalesce(ss.elo, 0) as elo,
           u.created_at as created_at,
           jsonb_build_object(
             'userId',   u.id,
             'email',    u.email,
             'username', coalesce(ss.display_name, ar.username),
             'elo',      coalesce(ss.elo, 0),
             'me',       (u.id = me)) as x
    from auth.users u
    left join season_state ss on ss.user_id = u.id and ss.season = szn
    left join account_status ar on ar.user_id = u.id
    order by coalesce(ss.elo, 0) desc, u.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) t;

  return jsonb_build_object('season', szn, 'rows', out);
end;
$function$
;
grant execute on function public.admin_elo_list(p_limit integer) to authenticated;
grant execute on function public.admin_elo_list(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.admin_elo_set(p_user uuid, p_elo integer, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  szn text := season_of(current_date);
  cfg jsonb;
  st season_state;
  target int; diff int; note text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin(me) then raise exception 'FORBIDDEN'; end if;
  if p_user is null then raise exception 'BAD_USER'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'NO_USER'; end if;
  select data into cfg from elo_config where id = 1;
  target := greatest(0, least(coalesce(p_elo, 0), (cfg->>'seasonMax')::int));
  insert into season_state (user_id, season) values (p_user, szn) on conflict do nothing;
  select * into st from season_state where user_id = p_user and season = szn for update;
  diff := target - st.elo;
  if diff = 0 then
    return jsonb_build_object('ok', true, 'elo', target, 'delta', 0, 'noop', true);
  end if;
  note := coalesce(nullif(btrim(p_reason), ''), 'Ручне виставлення (адмін)');
  update season_state
    set elo = target, updated_at = now()
  where user_id = p_user and season = szn;
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (p_user, szn, current_date, 'admin', 'admin',
          'admin:' || extract(epoch from clock_timestamp())::bigint || ':' || md5(random()::text),
          0, diff, target, note);
  return jsonb_build_object('ok', true, 'elo', target, 'delta', diff, 'season', szn);
end;
$function$
;
grant execute on function public.admin_elo_set(p_user uuid, p_elo integer, p_reason text) to authenticated;
grant execute on function public.admin_elo_set(p_user uuid, p_elo integer, p_reason text) to service_role;

CREATE OR REPLACE FUNCTION public.admin_requests(p_status text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
        off int := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_admin((select auth.uid())) then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(r order by r_requested_at desc) from (
      select jsonb_build_object(
        'userId', s.user_id,
        'status', s.status,
        'username', s.username,
        'email', u.email,
        'birthDate', s.birth_date,
        'screening', s.screening,
        'requestedAt', s.requested_at,
        'decidedAt', s.decided_at,
        'consents', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'document', cl.document, 'version', cl.version, 'acceptedAt', cl.accepted_at)
            order by cl.accepted_at desc), '[]'::jsonb)
          from public.consent_log cl where cl.user_id = s.user_id
        )
      ) as r, s.requested_at as r_requested_at
      from public.account_status s
      join auth.users u on u.id = s.user_id
      where p_status is null or s.status = p_status
      order by s.requested_at desc
      limit lim offset off
    ) q
  ), '[]'::jsonb);
end
$function$
;
grant execute on function public.admin_requests(p_status text, p_limit integer, p_offset integer) to authenticated;
grant execute on function public.admin_requests(p_status text, p_limit integer, p_offset integer) to service_role;

CREATE OR REPLACE FUNCTION public.cron_purge_abandoned_signups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  r := public.purge_abandoned_signups(7);
  insert into public.cron_log (job, result) values ('purge_abandoned_signups', r);
end $function$
;
grant execute on function public.cron_purge_abandoned_signups() to service_role;

CREATE OR REPLACE FUNCTION public.delete_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Обхід блокування через самовидалення (DB-003).
  if exists (select 1 from public.account_status
             where user_id = uid and status = 'blocked') then
    raise exception 'BLOCKED';
  end if;

  -- Останній адмін не може видалити себе: інакше нікому підтверджувати.
  if public.is_admin(uid) and (select count(*) from public.admins) = 1 then
    raise exception 'LAST_ADMIN';
  end if;

  delete from auth.users where id = uid;
  return jsonb_build_object('deleted', true);
end
$function$
;
grant execute on function public.delete_account() to authenticated;
grant execute on function public.delete_account() to service_role;

CREATE OR REPLACE FUNCTION public.elo_action_delta(kind text, payload jsonb, cfg jsonb, planned_days integer, grace boolean, p_elo numeric)
 RETURNS TABLE(quality numeric, delta integer)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  -- Темп за рівнем: та сама крива, що в js/elo-core.js (pace). Множиться
  -- саме тижневий бюджет, тож усі пʼять категорій масштабуються разом.
  weekly numeric := (cfg->>'weeklyBudget')::numeric * public.elo_pace(p_elo, cfg)
                    * (cfg->>'categoryShare')::numeric;
  daily  numeric;
  q numeric := 0; m numeric := 0; d numeric := 0;
  target numeric; ptarget numeric; dev numeric; qk numeric := 0; qp numeric := 0;
  ksh numeric; psh numeric;
begin
  if kind = 'workout' then
    if grace then quality := 0; delta := 0; return next; return; end if;
    if coalesce((payload->>'totalSets')::numeric, 0) > 0 then
      q := least(1, greatest(0, coalesce((payload->>'doneSets')::numeric, 0)
           / (payload->>'totalSets')::numeric));
    else
      q := least(1, greatest(0, coalesce((payload->>'done')::numeric, 0)
           / greatest(1, coalesce((payload->>'total')::numeric, 0))));
    end if;
    m := q;
    d := weekly * (cfg#>>'{weights,training}')::numeric / greatest(1, planned_days) * m;
  elsif kind = 'meal' then
    daily := weekly * (cfg#>>'{weights,nutrition}')::numeric / 7;
    target  := coalesce((payload->>'target')::numeric, 0);
    ptarget := coalesce((payload->>'proteinTarget')::numeric, 0);
    ksh := (cfg#>>'{nutritionSplit,kcal}')::numeric;
    psh := (cfg#>>'{nutritionSplit,protein}')::numeric;
    if ptarget <= 0 then ksh := 1; psh := 0; end if;
    if target > 0 then
      dev := abs(coalesce((payload->>'kcal')::numeric, 0) - target) / target;
      qk := public.elo_band(cfg#>'{tolerance,kcalBand}', dev);
    end if;
    if ptarget > 0 then
      qp := public.elo_ladder(cfg#>'{tolerance,protein}',
        least(1, greatest(0, coalesce((payload->>'protein')::numeric, 0) / ptarget)));
    end if;
    m := qk * ksh + qp * psh;
    q := m; d := daily * m;
  elsif kind = 'sleep' then
    daily := weekly * (cfg#>>'{weights,sleep}')::numeric / 7;
    q := least(1, greatest(0, coalesce((payload->>'minutes')::numeric, 0)
         / greatest(1, coalesce((payload->>'goal')::numeric, 480))));
    m := public.elo_ladder(cfg#>'{tolerance,sleep}', q);
    d := daily * m;
  elsif kind = 'recovery' then
    daily := weekly * (cfg#>>'{weights,recovery}')::numeric / 7;
    if payload->>'value' is null then q := 0; d := 0;
    else
      m := (cfg->>'recoveryFillShare')::numeric
         + case when (payload->>'value')::numeric >= (cfg->>'recoveryGoodValue')::numeric
                then 1 - (cfg->>'recoveryFillShare')::numeric else 0 end;
      q := m; d := daily * m;
    end if;
  elsif kind = 'activity' then
    daily := weekly * (cfg#>>'{weights,activity}')::numeric / 7;
    q := least(1, greatest(0, coalesce((payload->>'steps')::numeric, 0)
         / greatest(1, coalesce((payload->>'goal')::numeric, 10000))));
    m := public.elo_ladder(cfg#>'{tolerance,activity}', q);
    d := daily * m;
  end if;
  quality := round(q, 3); delta := round(d)::int;
  return next;
end;
$function$
;
grant execute on function public.elo_action_delta(kind text, payload jsonb, cfg jsonb, planned_days integer, grace boolean, p_elo numeric) to service_role;

CREATE OR REPLACE FUNCTION public.elo_activate_grace()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  cfg jsonb; szn text := season_of(current_date);
  st season_state;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;
  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;

  if st.grace_until is not null and st.grace_until >= current_date then
    return jsonb_build_object('ok', false, 'error', 'already_active', 'until', st.grace_until);
  end if;
  if st.grace_used >= (cfg->>'graceWeeksPerSeason')::int then
    return jsonb_build_object('ok', false, 'error', 'exhausted');
  end if;

  update season_state
    set grace_used = grace_used + 1,
        grace_until = current_date + ((cfg->>'graceDays')::int - 1),
        updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  return jsonb_build_object('ok', true, 'until', st.grace_until,
    'remaining', (cfg->>'graceWeeksPerSeason')::int - st.grace_used);
end;
$function$
;
grant execute on function public.elo_activate_grace() to authenticated;
grant execute on function public.elo_activate_grace() to service_role;

CREATE OR REPLACE FUNCTION public.elo_band(steps jsonb, dev numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select (s->1)::numeric from jsonb_array_elements(steps) s
      where dev <= (s->0)::numeric
      order by (s->0)::numeric asc limit 1),
    (select (s->1)::numeric from jsonb_array_elements(steps) s
      order by (s->0)::numeric desc limit 1)
  );
$function$
;
grant execute on function public.elo_band(steps jsonb, dev numeric) to service_role;

CREATE OR REPLACE FUNCTION public.elo_catch_up()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); cfg jsonb; prev text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;
  prev := season_of((select s from season_bounds(season_of(current_date))) - 1);
  if prev <> season_of(current_date) then
    perform public.elo_catch_up_weeks(uid, prev, cfg);
  end if;
  perform public.elo_catch_up_weeks(uid, season_of(current_date), cfg);
  return jsonb_build_object('ok', true);
end;
$function$
;
grant execute on function public.elo_catch_up() to authenticated;
grant execute on function public.elo_catch_up() to service_role;

CREATE OR REPLACE FUNCTION public.elo_catch_up_weeks(uid uuid, szn text, cfg jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  season_start date;
  w date;
  guard int := 0;
begin
  season_start := date_trunc('week', (
    select min(day) from elo_events where user_id = uid and season = szn
  ))::date;
  if season_start is null then return; end if;
  w := season_start;
  while w <= (select e from season_bounds(szn)) and guard < 20 loop
    guard := guard + 1;
    if season_of(w + 6) = szn
       and public.elo_week_ready(uid, w, cfg) is null then
      perform public.elo_eval_week_for(uid, w, cfg);
    end if;
    w := w + 7;
  end loop;
end;
$function$
;
grant execute on function public.elo_catch_up_weeks(uid uuid, szn text, cfg jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.elo_close_season(p_season text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  cfg jsonb; st season_state;
  my_rank int; total int; pctl numeric;
  lvl int; elite boolean;
  d_active int; d_total int;
  stats jsonb; b record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;
  select * into b from season_bounds(p_season);
  if b.e is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_season');
  end if;
  if current_date <= b.e + (cfg->>'submitWindowDays')::int then
    return jsonb_build_object('ok', false, 'error', 'season_running', 'finalAfter', b.e + (cfg->>'submitWindowDays')::int);
  end if;
  if exists (select 1 from season_history where user_id = uid and season = p_season) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  -- ELO-005: останній тиждень сезону оцінюємо ДО підбиття підсумку, поки
  -- season_history ще порожня — інакше він не оцінюється ніколи.
  perform public.elo_catch_up_weeks(uid, p_season, cfg);

  select * into st from season_state where user_id = uid and season = p_season;
  if st is null then return jsonb_build_object('ok', false, 'error', 'no_data'); end if;
  select count(*) into total from season_state where season = p_season;
  select r into my_rank from (
    select user_id, rank() over (order by elo desc) r from season_state where season = p_season
  ) x where x.user_id = uid;
  pctl := case when total >= (cfg->>'minUsersForPercentile')::int
               then round(my_rank::numeric / total * 100, 1) else null end;
  lvl := least((cfg->>'levelCount')::int, floor(st.elo / (cfg->>'levelSize')::int)::int + 1);
  elite := st.elo >= (cfg->>'eliteFloor')::int;
  select count(distinct day) into d_active from elo_events
    where user_id = uid and season = p_season and delta > 0;
  d_total := b.e - b.s + 1;
  select coalesce(jsonb_object_agg(category, s), '{}'::jsonb) into stats from (
    select category, jsonb_build_object('events', count(*), 'elo', sum(delta),
                                        'avgQuality', round(avg(quality), 2)) s
    from elo_events where user_id = uid and season = p_season
      and category in ('training','nutrition','sleep','recovery','activity')
    group by category
  ) g;
  stats := stats || coalesce((
    select jsonb_build_object('biggestGain', max(s), 'biggestLoss', least(min(s), 0))
    from (select day, sum(delta) s from elo_events
          where user_id = uid and season = p_season group by day) dd
  ), '{}'::jsonb);
  stats := stats || coalesce((
    select jsonb_build_object(
      'bestCategory', (array_agg(category order by aq desc))[1],
      'weakestCategory', (array_agg(category order by aq asc))[1])
    from (select category, avg(quality) aq from elo_events
          where user_id = uid and season = p_season
            and category in ('training','nutrition','sleep','recovery','activity')
          group by category) c
  ), '{}'::jsonb);
  insert into season_history (user_id, season, final_elo, level, elite, rank, of_users,
                              percentile, days_active, days_total, grace_weeks_used, stats)
  values (uid, p_season, st.elo, lvl, elite, my_rank, total, pctl, d_active, d_total, st.grace_used, stats)
  on conflict (user_id, season) do nothing;

  -- DB-015: імена колонок замість позицій.
  if lvl >= 5  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level5',  'Season Badge') on conflict do nothing; end if;
  if lvl >= 7  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level7',  'Profile Frame') on conflict do nothing; end if;
  if lvl >= 8  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level8',  'Seasonal Cosmetic') on conflict do nothing; end if;
  if lvl >= 9  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level9',  'Exclusive Reward') on conflict do nothing; end if;
  if lvl >= 10 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'level10', 'Legendary Season Reward') on conflict do nothing; end if;
  if elite     then insert into awards (user_id, season, kind, label) values (uid, p_season, 'elite',   'ELITE 2000+') on conflict do nothing; end if;
  if my_rank = 1 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'first', '#1 сезону') on conflict do nothing; end if;
  if my_rank <= 3 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top3', 'Top 3') on conflict do nothing; end if;
  if my_rank <= 10 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top10', 'Top 10') on conflict do nothing; end if;
  if my_rank <= 100 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top100', 'Top 100') on conflict do nothing; end if;
  if my_rank <= 1000 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top1000', 'Top 1000') on conflict do nothing; end if;
  if pctl is not null and pctl <= 10 then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top10pct', 'Top 10%') on conflict do nothing; end if;
  if pctl is not null and pctl <= 5  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top5pct',  'Top 5%') on conflict do nothing; end if;
  if pctl is not null and pctl <= 1  then insert into awards (user_id, season, kind, label) values (uid, p_season, 'top1pct',  'Top 1%') on conflict do nothing; end if;

  return jsonb_build_object('ok', true, 'elo', st.elo, 'level', lvl, 'elite', elite,
    'rank', my_rank, 'of', total, 'percentile', pctl,
    'daysActive', d_active, 'daysTotal', d_total, 'graceUsed', st.grace_used, 'stats', stats);
end;
$function$
;
grant execute on function public.elo_close_season(p_season text) to authenticated;
grant execute on function public.elo_close_season(p_season text) to service_role;

CREATE OR REPLACE FUNCTION public.elo_cron_eval_week(p_weeks_back integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cfg jsonb; today date := current_date;
  wk date; i int; r record; res jsonb;
  n_ok int := 0; n_dup int := 0; n_err int := 0; n_skip int := 0;
  weeks date[] := '{}'; errs text[] := '{}';
begin
  select data into cfg from elo_config where id = 1;

  wk := today - (extract(isodow from today)::int - 1);
  for i in 1..greatest(1, p_weeks_back) loop
    wk := wk - 7;
    weeks := weeks || wk;
  end loop;

  foreach wk in array weeks loop
    for r in
      select distinct e.user_id
      from elo_events e
      join account_status a on a.user_id = e.user_id and a.status = 'approved'
      where e.season = season_of(wk + 6) and e.day <= wk + 6
    loop
      begin
        res := public.elo_eval_week_for(r.user_id, wk, cfg);
        if coalesce((res->>'duplicate')::boolean, false) then n_dup := n_dup + 1;
        elsif coalesce((res->>'ok')::boolean, false)     then n_ok  := n_ok  + 1;
        else
          n_skip := n_skip + 1;
          errs := errs || coalesce(res->>'error', '?');
        end if;
      exception when others then
        n_err := n_err + 1;
        errs := errs || sqlerrm;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', n_err = 0,
    'weeks', to_jsonb(weeks),
    'evaluated', n_ok, 'duplicate', n_dup, 'skipped', n_skip, 'failed', n_err,
    'reasons', to_jsonb((select array_agg(distinct e) from unnest(errs) e)));
end $function$
;
grant execute on function public.elo_cron_eval_week(p_weeks_back integer) to service_role;

CREATE OR REPLACE FUNCTION public.elo_cron_log_eval_week(p_weeks_back integer DEFAULT 4)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb;
begin
  r := public.elo_cron_eval_week(p_weeks_back);
  insert into public.cron_log (job, result) values ('elo_cron_eval_week', r);
  if coalesce((r->>'failed')::int, 0) > 0 then
    raise exception 'elo_cron_eval_week: % помилок — %', r->>'failed', r->>'reasons';
  end if;
end $function$
;
grant execute on function public.elo_cron_log_eval_week(p_weeks_back integer) to service_role;

CREATE OR REPLACE FUNCTION public.elo_eval_week_for(uid uuid, p_week_start date, cfg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  szn text; st season_state;
  planned int; done int; meals int;
  grace_days int := 0; expected int; missed int;
  pen int := 0; bon int := 0; d int;
  why text; ev_id bigint;
  start_day date; avail int := 7;          -- ELO-006
begin
  why := public.elo_week_ready(uid, p_week_start, cfg);
  if why is not null then
    return jsonb_build_object('ok', false, 'error', why);
  end if;

  szn := season_of(p_week_start + 6);

  planned := public.elo_planned_for(uid, p_week_start);
  select count(*) into done from elo_events
    where user_id = uid and category = 'training' and quality >= 0.5
      and day between p_week_start and p_week_start + 6;
  select count(distinct day) into meals from elo_events
    where user_id = uid and category = 'nutrition'
      and day between p_week_start and p_week_start + 6;

  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn;

  if st.grace_until is not null then
    grace_days := greatest(0, least(st.grace_until, p_week_start + 6)::date
                            - greatest(st.grace_until - ((cfg->>'graceDays')::int - 1), p_week_start)::date + 1);
  end if;

  -- ELO-006: скільки днів цього тижня людина взагалі мала.
  select least(
           (select min(e.day) from elo_events e where e.user_id = uid),
           (select a.decided_at::date from account_status a where a.user_id = uid)
         ) into start_day;
  if start_day is not null and start_day > p_week_start then
    avail := greatest(1, least(7, (p_week_start + 6) - start_day + 1));
  end if;

  expected := round(planned * (1 - grace_days / 7.0) * avail / 7.0);
  missed := greatest(0, expected - done);
  pen := missed * (cfg->>'missedWorkoutPenalty')::int;
  if done >= planned and meals >= 7 then
    bon := least((cfg->>'cleanWeekBonus')::int, public.elo_week_room(uid, p_week_start, cfg));
  end if;
  d := pen + bon;

  -- DB-006: зрізаємо ДЕЛЬТУ, а не стан. Далі d — це рівно те, на скільки
  -- зміниться season_state.elo, тож журнал і стан не розходяться.
  d := least((cfg->>'seasonMax')::int, greatest(0, st.elo + d)) - st.elo;

  -- Унікальний (user_id, action_key) означає, що вставити маркер може рівно
  -- один виклик. Конкурент блокується тут, після коміту переможця отримує
  -- нуль рядків і чесно каже duplicate, не чіпаючи season_state.
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_week_start + 6,
          case when d >= 0 then 'bonus' else 'penalty' end,
          'week', 'week:' || p_week_start, 0, d, 0,
          case when bon > 0 then 'Чистий тиждень — план закрито повністю'
               when missed > 0 then 'Недобір тренувань: ' || missed || ' пропуск(и)'
               else 'Тиждень оцінено' end)
  on conflict do nothing
  returning id into ev_id;

  if ev_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  update season_state
    set elo = least((cfg->>'seasonMax')::int, greatest(0, elo + d)), updated_at = now()
    where user_id = uid and season = szn
    returning * into st;

  update elo_events set elo_after = st.elo where id = ev_id;

  return jsonb_build_object('ok', true, 'delta', d, 'elo', st.elo, 'missed', missed,
                            'cleanWeek', bon > 0, 'planned', planned, 'availableDays', avail);
end;
$function$
;
grant execute on function public.elo_eval_week_for(uid uuid, p_week_start date, cfg jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.elo_evaluate_week(p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); cfg jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;
  return public.elo_eval_week_for(uid, p_week_start, cfg);
end;
$function$
;
grant execute on function public.elo_evaluate_week(p_week_start date) to service_role;

CREATE OR REPLACE FUNCTION public.elo_facts(uid uuid, kind text, p_day date, cfg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d jsonb; rec jsonb; fl jsonb;
  v numeric; g numeric; tot numeric; dn numeric; ts numeric; ds numeric;
begin
  select data into d from profiles where user_id = uid;
  if d is null then return null; end if;
  fl := coalesce(cfg->'floors', '{}'::jsonb);

  if kind = 'workout' then
    rec := d #> array['sessionLog', p_day::text];
    if rec is null or jsonb_typeof(rec) <> 'object' then return null; end if;
    tot := public.elo_num(rec->'total', 0);
    dn  := public.elo_num(rec->'done', 0);
    if tot < public.elo_num(fl->'workoutTotalMin', 3) then return null; end if;
    ts := public.elo_num(rec->'totalSets', 0);
    ds := public.elo_num(rec->'doneSets', 0);
    return jsonb_build_object(
      'done', greatest(0, least(dn, tot)), 'total', tot,
      'doneSets', case when ts > 0 then greatest(0, least(ds, ts)) else 0 end,
      'totalSets', greatest(0, ts));

  elsif kind = 'meal' then
    rec := d #> array['mealLog', p_day::text];
    if rec is null or jsonb_typeof(rec) <> 'object' then return null; end if;
    if public.elo_num(rec->'target', 0) <= 0 then return null; end if;
    return jsonb_build_object(
      'kcal',          greatest(0, public.elo_num(rec->'kcal', 0)),
      'target',        public.elo_num(rec->'target', 0),
      'protein',       greatest(0, public.elo_num(rec->'p', 0)),
      'proteinTarget', greatest(0, public.elo_num(rec->'pTarget', 0)));

  elsif kind = 'sleep' then
    v := public.elo_tracker_value(d, 'sleep', p_day);
    if v is null or v <= 0 then return null; end if;
    g := public.elo_num(d #> '{trackers,sleep,goal}', null);
    if g is null or g <= 0 then g := 480; end if;
    return jsonb_build_object(
      'minutes', least(v, public.elo_num(fl->'sleepMax', 960)),
      'goal',    greatest(g, public.elo_num(fl->'sleepGoalMin', 240)));

  elsif kind = 'activity' then
    v := public.elo_tracker_value(d, 'steps', p_day);
    if v is null or v <= 0 then return null; end if;
    g := public.elo_num(d #> '{trackers,steps,goal}', null);
    if g is null or g <= 0 then g := 8000; end if;
    return jsonb_build_object(
      'steps', least(v, public.elo_num(fl->'stepsMax', 100000)),
      'goal',  greatest(g, public.elo_num(fl->'stepsGoalMin', 3000)));

  elsif kind = 'recovery' then
    v := public.elo_tracker_value(d, 'recovery', p_day);
    if v is null then return null; end if;
    return jsonb_build_object('value', greatest(1, least(10, v)));
  end if;

  return null;
end;
$function$
;
grant execute on function public.elo_facts(uid uuid, kind text, p_day date, cfg jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.elo_history()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  hist jsonb; awds jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'season', season, 'elo', final_elo, 'level', level, 'elite', elite,
      'rank', rank, 'of', of_users, 'percentile', percentile,
      'daysActive', days_active, 'daysTotal', days_total,
      'graceUsed', grace_weeks_used, 'stats', stats) order by season desc), '[]'::jsonb)
    into hist from season_history where user_id = uid;
  select coalesce(jsonb_agg(jsonb_build_object(
      'season', season, 'kind', kind, 'label', label) order by earned_at desc), '[]'::jsonb)
    into awds from awards where user_id = uid;
  return jsonb_build_object('history', hist, 'awards', awds);
end;
$function$
;
grant execute on function public.elo_history() to authenticated;
grant execute on function public.elo_history() to service_role;

CREATE OR REPLACE FUNCTION public.elo_ladder(steps jsonb, x numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select (s->1)::numeric from jsonb_array_elements(steps) s
      where x >= (s->0)::numeric
      order by (s->0)::numeric desc limit 1),
    (select (s->1)::numeric from jsonb_array_elements(steps) s
      order by (s->0)::numeric asc limit 1)
  );
$function$
;
grant execute on function public.elo_ladder(steps jsonb, x numeric) to service_role;

CREATE OR REPLACE FUNCTION public.elo_leaderboard(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  szn text := season_of(current_date);
  rows jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(auth.uid()) then raise exception 'NOT_APPROVED'; end if;
  select jsonb_agg(jsonb_build_object('rank', r, 'name', name, 'elo', elo,
                                      'me', user_id = auth.uid()) order by r)
    into rows
  from (
    select s.user_id,
           coalesce(nullif(a.username, ''), nullif(s.display_name, ''), 'Атлет') as name,
           s.elo,
           rank() over (order by s.elo desc) as r
    from season_state s
    left join account_status a on a.user_id = s.user_id
    where s.season = szn
  ) x
  where x.r <= p_limit or x.user_id = auth.uid();
  return coalesce(rows, '[]'::jsonb);
end;
$function$
;
grant execute on function public.elo_leaderboard(p_limit integer) to authenticated;
grant execute on function public.elo_leaderboard(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.elo_num(j jsonb, dflt numeric DEFAULT 0)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when j is null then dflt
    when jsonb_typeof(j) = 'number' then j::text::numeric
    when jsonb_typeof(j) = 'string' and (j #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (j #>> '{}')::numeric
    else dflt
  end;
$function$
;
grant execute on function public.elo_num(j jsonb, dflt numeric) to service_role;

CREATE OR REPLACE FUNCTION public.elo_pace(p_elo numeric, cfg jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_elo is null then 1
    when cfg->'levelPace' is null or jsonb_typeof(cfg->'levelPace') <> 'array' then 1
    when p_elo >= (cfg->>'eliteFloor')::numeric
      then coalesce((cfg->>'elitePace')::numeric, 1)
    else coalesce(
      (cfg->'levelPace' ->> (
        least((cfg->>'levelCount')::int,
              floor(greatest(0, p_elo) / (cfg->>'levelSize')::numeric)::int + 1) - 1
      ))::numeric, 1)
  end;
$function$
;
grant execute on function public.elo_pace(p_elo numeric, cfg jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.elo_planned_for(uid uuid, p_week_start date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p int; w date := date_trunc('week', p_week_start)::date;
begin
  select planned into p from elo_week_plan where user_id = uid and week_start = w;
  if found then return p; end if;

  p := coalesce((
    select greatest(3, least(7, floor(coalesce(
      nullif(public.elo_num(data #> '{activePlan,days}', 0), 0),
      nullif(public.elo_num(data -> 'daysPerWeek', 0), 0),
      3))::int))
    from profiles where user_id = uid), 3);

  insert into elo_week_plan (user_id, week_start, planned) values (uid, w, p)
  on conflict (user_id, week_start) do nothing;
  select planned into p from elo_week_plan where user_id = uid and week_start = w;
  return p;
end $function$
;
grant execute on function public.elo_planned_for(uid uuid, p_week_start date) to service_role;

CREATE OR REPLACE FUNCTION public.elo_recent(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(auth.uid()) then raise exception 'NOT_APPROVED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'day', day, 'category', category, 'delta', delta, 'reason', reason,
      'eloAfter', elo_after) order by id desc)
    from (
      select id, day, category, delta, elo_after, reason
      from elo_events
      where user_id = auth.uid() and season = season_of(current_date)
      order by id desc limit least(greatest(p_limit, 1), 100)
    ) x
  ), '[]'::jsonb);
end;
$function$
;
grant execute on function public.elo_recent(p_limit integer) to authenticated;
grant execute on function public.elo_recent(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.elo_set_name(p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  approved text;
  want text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(auth.uid()) then raise exception 'NOT_APPROVED'; end if;

  select nullif(username, '') into approved
  from account_status where user_id = auth.uid();

  -- Підтверджений нік із заявки має пріоритет: він уже перевірений і
  -- унікальний. Довільне імʼя приймається лише за його відсутності.
  if approved is null then
    if length(want) < 3 or length(want) > 13
       or want !~ '^[[:alnum:]А-Яа-яІіЇїЄєҐґʼ''_. -]+$' then
      raise exception 'USERNAME_INVALID';
    end if;
    if exists (select 1 from account_status
               where lower(username) = lower(want) and user_id <> auth.uid()) then
      raise exception 'USERNAME_TAKEN';
    end if;
    if exists (select 1 from season_state
               where lower(display_name) = lower(want) and user_id <> auth.uid()) then
      raise exception 'USERNAME_TAKEN';
    end if;
  end if;

  update season_state
     set display_name = left(coalesce(approved, want), 13)
   where user_id = auth.uid() and season = season_of(current_date);
end $function$
;
grant execute on function public.elo_set_name(p_name text) to authenticated;
grant execute on function public.elo_set_name(p_name text) to service_role;

CREATE OR REPLACE FUNCTION public.elo_state(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  szn text := season_of(current_date);
  st season_state;
  my_rank int; total int;
  cfg jsonb;
  tday date;
  planned int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;

  tday := coalesce(p_today, current_date);
  if tday > current_date + 1 or tday < current_date - 2 then
    tday := current_date;
  end if;

  select data into cfg from elo_config where id = 1;
  select * into st from season_state where user_id = uid and season = szn;
  select count(*) into total from season_state where season = szn;

  planned := coalesce(
    (select p.planned from elo_week_plan p
       where p.user_id = uid and p.week_start = date_trunc('week', tday)::date),
    (select greatest(3, least(7, floor(coalesce(
        nullif(public.elo_num(data #> '{activePlan,days}', 0), 0),
        nullif(public.elo_num(data -> 'daysPerWeek', 0), 0),
        3))::int))
     from profiles where user_id = uid),
    3);

  if st is null then
    return jsonb_build_object('season', szn, 'elo', 0, 'today', 0,
      'graceUsed', 0, 'graceUntil', null, 'rank', null, 'of', total,
      'plannedWeek', planned, 'config', cfg);
  end if;
  select r into my_rank from (
    select user_id, rank() over (order by elo desc) r from season_state where season = szn
  ) x where x.user_id = uid;
  return jsonb_build_object('season', szn, 'elo', st.elo,
    'today', (select coalesce(sum(e.delta), 0) from elo_events e
                where e.user_id = uid and e.day = tday
                  and e.event_type in ('workout','meal','sleep','recovery','activity')),
    'graceUsed', st.grace_used,
    'graceUntil', case when st.grace_until >= current_date then st.grace_until else null end,
    'rank', my_rank, 'of', total, 'plannedWeek', planned, 'config', cfg);
end;
$function$
;
grant execute on function public.elo_state(p_today date) to authenticated;
grant execute on function public.elo_state(p_today date) to service_role;

CREATE OR REPLACE FUNCTION public.elo_submit(p_kind text, p_action_key text, p_day date, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  cfg jsonb; szn text; st season_state;
  planned int; grace boolean := false;
  facts jsonb; has_row boolean;
  q numeric; d int; inc int; paid int := 0;
  day_sum int; week_spent int; week_budget int; room int;
  wk_start date;
  reason text; cat text; skey text;
  existing elo_events;
  ins_id bigint;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  if p_kind not in ('workout','meal','sleep','recovery','activity') then
    raise exception 'unknown kind %', p_kind;
  end if;
  if p_day is null then raise exception 'BAD_DAY'; end if;
  select data into cfg from elo_config where id = 1;
  szn := season_of(p_day);
  if p_day > current_date + 1
     or p_day < current_date - (cfg->>'submitWindowDays')::int
     or szn not in (season_of(current_date), season_of(current_date + 1), season_of(current_date - 1)) then
    return jsonb_build_object('ok', false, 'error', 'out_of_window');
  end if;
  if exists (select 1 from season_history where user_id = uid and season = szn) then
    return jsonb_build_object('ok', false, 'error', 'season_closed');
  end if;
  insert into season_state (user_id, season) values (uid, szn)
  on conflict (user_id, season) do nothing;
  select * into st from season_state where user_id = uid and season = szn for update;
  skey := p_kind || ':' || p_day;
  select * into existing from elo_events where user_id = uid and event_type = p_kind and day = p_day;
  if found then paid := greatest(0, existing.delta); end if;
  perform public.elo_catch_up_weeks(uid, szn, cfg);
  select * into st from season_state where user_id = uid and season = szn for update;
  grace := st.grace_until is not null and p_day <= st.grace_until;
  planned := public.elo_planned_for(uid, p_day);
  facts := public.elo_facts(uid, p_kind, p_day, cfg);
  if facts is null then
    if existing.id is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'delta', existing.delta, 'elo', st.elo);
    end if;
    -- INV-004: «даних ще немає» і «даних не дотягує до порога» — різні речі.
    -- Друге повторювати марно: день від повторного запиту більшим не стане,
    -- а клієнт повторював його на КОЖЕН Store.onChange протягом трьох днів.
    select (data #> array[case p_kind
                            when 'workout' then 'sessionLog'
                            when 'meal'    then 'mealLog'
                            else 'trackerLog' end,
                          p_day::text]) is not null
      into has_row from profiles where user_id = uid;
    return jsonb_build_object('ok', false, 'error', 'no_data',
                              'retry', not coalesce(has_row, false));
  end if;
  select t.quality, t.delta into q, d
  from elo_action_delta(p_kind, facts, cfg, planned, grace, st.elo) t;
  inc := greatest(0, d - paid);
  if p_kind = 'workout' and inc > 0 then
    wk_start := date_trunc('week', p_day)::date;
    select coalesce(sum(delta), 0) into week_spent
      from elo_events
      where user_id = uid and season = szn and category = 'training' and delta > 0
        and day between wk_start and wk_start + 6;
    week_budget := round(
      (cfg->>'weeklyBudget')::numeric * public.elo_pace(st.elo, cfg)
      * (cfg->>'categoryShare')::numeric
      * (cfg#>>'{weights,training}')::numeric)::int;
    inc := least(inc, greatest(0, week_budget - week_spent));
  end if;
  if inc > 0 then
    select coalesce(sum(delta), 0) into day_sum
    from elo_events
    where user_id = uid and season = szn and day = p_day and delta > 0 and category <> 'admin';
    -- Стеля дня масштабується темпом, підлога втрат — ні: інакше плаский
    -- dayGainCap зрізав би весь розгін перших рівнів (див. js/elo-core.js,
    -- applyDayCaps).
    room := least(greatest(0, round((cfg->>'dayGainCap')::numeric
                                    * public.elo_pace(st.elo, cfg))::int - day_sum),
                  public.elo_week_room(uid, p_day, cfg));
    inc := least(inc, room);
  end if;

  -- DB-006: стеля сезону зрізає ДЕЛЬТУ, а не стан. Інакше при 2495 ELO
  -- нарахування +9 давало стан 2500, а в журналі лишалось +9 — і sum(delta)
  -- переставала дорівнювати season_state.elo назавжди.
  inc := least((cfg->>'seasonMax')::int, greatest(0, st.elo + inc)) - st.elo;

  if existing.id is not null then
    if inc <= 0 then
      return jsonb_build_object('ok', true, 'duplicate', true, 'delta', existing.delta, 'elo', st.elo);
    end if;
    update season_state
      set elo = least((cfg->>'seasonMax')::int, greatest(0, elo + inc)),
          today_delta = case when today_date = current_date then today_delta + inc else inc end,
          today_date = current_date, updated_at = now()
      where user_id = uid and season = szn
      returning * into st;
    update elo_events
      set delta = delta + inc, quality = q, elo_after = st.elo
      where id = existing.id;
    perform elo_try_clean_day(uid, szn, p_day, cfg, planned, grace);
    select * into st from season_state where user_id = uid and season = szn;
    return jsonb_build_object('ok', true, 'delta', inc, 'reconciled', true, 'paid', paid + inc,
      'quality', q, 'elo', st.elo, 'today', st.today_delta, 'grace', grace);
  end if;
  d := inc;
  cat := case p_kind when 'workout' then 'training'
                     when 'meal' then 'nutrition'
                     else p_kind end;
  reason := case p_kind
    when 'workout' then 'Тренування виконано'
    when 'meal' then 'День харчування закрито'
    when 'sleep' then 'Сон записано'
    when 'recovery' then 'Recovery відмічено'
    else 'Активність записана' end;
  update season_state
    set elo = least((cfg->>'seasonMax')::int, greatest(0, elo + d)),
        today_delta = case when today_date = current_date then today_delta + d else d end,
        today_date = current_date,
        updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_day, cat, p_kind, skey, q, d, st.elo, reason)
  on conflict do nothing
  returning id into ins_id;
  if ins_id is null then
    -- Тепер відкат точний: d уже зрізаний, тому «elo - d» повертає рівно
    -- те значення, що було до оновлення (DB-006).
    update season_state
      set elo = least((cfg->>'seasonMax')::int, greatest(0, elo - d)),
          today_delta = today_delta - d, updated_at = now()
      where user_id = uid and season = szn
      returning * into st;
    select * into existing from elo_events where user_id = uid and event_type = p_kind and day = p_day;
    return jsonb_build_object('ok', true, 'duplicate', true,
      'delta', coalesce(existing.delta, 0), 'elo', st.elo);
  end if;
  perform elo_try_clean_day(uid, szn, p_day, cfg, planned, grace);
  select * into st from season_state where user_id = uid and season = szn;
  return jsonb_build_object('ok', true, 'delta', d, 'quality', q,
    'elo', st.elo, 'today', st.today_delta, 'grace', grace);
end;
$function$
;
grant execute on function public.elo_submit(p_kind text, p_action_key text, p_day date, p_payload jsonb) to authenticated;
grant execute on function public.elo_submit(p_kind text, p_action_key text, p_day date, p_payload jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.elo_tracker_value(d jsonb, tid text, p_day date)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when e is null then null
    when jsonb_typeof(e) = 'object' then public.elo_num(e->'value', null)
    else public.elo_num(e, null)
  end
  from (select d #> array['trackerLog', tid, p_day::text] as e) s;
$function$
;
grant execute on function public.elo_tracker_value(d jsonb, tid text, p_day date) to service_role;

CREATE OR REPLACE FUNCTION public.elo_try_clean_day(uid uuid, szn text, p_day date, cfg jsonb, planned integer, grace boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  got int; bonus int; room int; day_sum int; st season_state;
begin
  if exists (select 1 from elo_events where user_id = uid and event_type = 'cleanday' and day = p_day) then
    return;
  end if;
  select count(distinct category) into got
  from elo_events
  where user_id = uid and season = szn and day = p_day
    and category in ('nutrition','sleep','recovery','activity')
    and quality >= (cfg->>'cleanThreshold')::numeric;
  if got < 4 then return; end if;
  if not grace and exists (
       select 1 from elo_events
       where user_id = uid and season = szn and day = p_day
         and category = 'training' and quality < (cfg->>'cleanThreshold')::numeric) then
    return;
  end if;
  select coalesce(sum(delta), 0) into day_sum
  from elo_events
  where user_id = uid and season = szn and day = p_day and delta > 0 and category <> 'admin';
  -- Стан потрібен ДО розрахунку кімнати: від поточного ELO залежить темп,
  -- а отже й стеля дня. Доти st заповнювався лише після update, і
  -- elo_pace(null) мовчки давав би одиницю — тобто бонус чистого дня
  -- рахувався б за старою, плаcкою стелею.
  select * into st from season_state where user_id = uid and season = szn;
  room := least(greatest(0, round((cfg->>'dayGainCap')::numeric
                                  * public.elo_pace(st.elo, cfg))::int - day_sum),
                public.elo_week_room(uid, p_day, cfg));
  bonus := least((cfg->>'cleanDayBonus')::int, room);
  if bonus <= 0 then return; end if;
  update season_state
    set elo = least((cfg->>'seasonMax')::int, elo + bonus),
        today_delta = case when today_date = current_date then today_delta + bonus else bonus end,
        today_date = current_date, updated_at = now()
    where user_id = uid and season = szn
    returning * into st;
  insert into elo_events (user_id, season, day, category, event_type, action_key, quality, delta, elo_after, reason)
  values (uid, szn, p_day, 'bonus', 'cleanday', 'cleanday:' || p_day, 1, bonus, st.elo, 'Чистий день — усі цілі закриті')
  on conflict do nothing;
end;
$function$
;
grant execute on function public.elo_try_clean_day(uid uuid, szn text, p_day date, cfg jsonb, planned integer, grace boolean) to service_role;

CREATE OR REPLACE FUNCTION public.elo_week_ready(uid uuid, p_week_start date, cfg jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  swd int := coalesce((cfg->>'submitWindowDays')::int, 2);
  szn text;
  first_day date;
begin
  if extract(isodow from p_week_start) <> 1 then return 'not_monday'; end if;
  -- ELO-001: чекаємо не лише кінця тижня, а й кінця вікна подання.
  if p_week_start + 6 + swd >= current_date then return 'week_not_over'; end if;
  szn := season_of(p_week_start + 6);
  -- ELO-005: сезон тижня, а не поточний; оцінюємо, поки він не закритий.
  if exists (select 1 from season_history h where h.user_id = uid and h.season = szn) then
    return 'season_closed';
  end if;
  -- ELO-002: до першої події людини тижнів не існує.
  select min(day) into first_day from elo_events e where e.user_id = uid and e.season = szn;
  if first_day is null or p_week_start + 6 < first_day then
    return 'before_first_event';
  end if;
  return null;
end;
$function$
;
grant execute on function public.elo_week_ready(uid uuid, p_week_start date, cfg jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.elo_week_room(uid uuid, p_day date, cfg jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cur numeric;
  spent int;
begin
  -- ЧОМУ plpgsql, А НЕ sql. Тіло sql-функції розбирається в момент
  -- створення, а season_of у знімку схеми оголошена нижче: дамп
  -- упорядкований за іменами, а не за залежностями. Плоска версія цієї
  -- функції залежностей не мала й проблеми не помічала; щойно зʼявився
  -- темп за рівнем — розгортання знімка впало на «function does not exist».
  select s.elo into cur from season_state s
    where s.user_id = uid and s.season = public.season_of(p_day);
  select coalesce(sum(delta), 0) into spent from elo_events
    where user_id = uid and delta > 0 and category <> 'admin'
      and day between date_trunc('week', p_day)::date and date_trunc('week', p_day)::date + 6;
  -- Тижнева стеля масштабується темпом так само, як вартість дії:
  -- інакше на першому рівні дії дорожчі, а кімнати під них немає.
  return greatest(0, floor((cfg ->> 'weeklyBudget')::numeric
                           * public.elo_pace(cur, cfg))::int - spent);
end;
$function$
;
grant execute on function public.elo_week_room(uid uuid, p_day date, cfg jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.grant_beta_award()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  insert into public.awards (user_id, season, kind, label)
  values (new.user_id, '', 'beta', 'Бета')
  on conflict (user_id, season, kind) do nothing;
  return new;
end;
$function$
;
grant execute on function public.grant_beta_award() to service_role;

CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select uid is not null and uid = auth.uid()
     and exists (select 1 from public.admins where user_id = uid) $function$
;
grant execute on function public.is_admin(uid uuid) to authenticated;
grant execute on function public.is_admin(uid uuid) to service_role;

CREATE OR REPLACE FUNCTION public.is_approved(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select uid is not null and uid = auth.uid()
     and exists (select 1 from public.account_status where user_id = uid and status = 'approved') $function$
;
grant execute on function public.is_approved(uid uuid) to authenticated;
grant execute on function public.is_approved(uid uuid) to service_role;

CREATE OR REPLACE FUNCTION public.profile_patch(p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'BAD_PATCH';
  end if;

  insert into public.profiles (user_id, data)
  values (uid, p_patch)
  on conflict (user_id) do update
    set data = public.profiles.data || excluded.data;
end
$function$
;
grant execute on function public.profile_patch(p_patch jsonb) to authenticated;
grant execute on function public.profile_patch(p_patch jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.purge_abandoned_signups(p_grace_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cut   timestamptz := now() - make_interval(days => greatest(p_grace_days, 1));
  v_ids   uuid[];
  v_count integer := 0;
begin
  select coalesce(array_agg(u.id), '{}')
    into v_ids
    from auth.users u
   where u.email_confirmed_at is null
     and u.last_sign_in_at is null
     and u.created_at < v_cut;

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    return jsonb_build_object('deleted', 0, 'cutoff', v_cut);
  end if;

  delete from public.elo_events     where user_id = any(v_ids);
  delete from public.elo_week_plan  where user_id = any(v_ids);
  delete from public.season_history where user_id = any(v_ids);
  delete from public.season_state   where user_id = any(v_ids);
  delete from public.awards         where user_id = any(v_ids);
  delete from public.consent_log    where user_id = any(v_ids);
  delete from public.account_status where user_id = any(v_ids);
  delete from public.profiles       where user_id = any(v_ids);
  delete from auth.users            where id      = any(v_ids);

  return jsonb_build_object('deleted', v_count, 'cutoff', v_cut);
end $function$
;
grant execute on function public.purge_abandoned_signups(p_grace_days integer) to service_role;

CREATE OR REPLACE FUNCTION public.register_request(p_username text, p_birth date, p_screening jsonb, p_consents jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  cur public.account_status%rowtype;
  yrs int;
  uname text := trim(coalesce(p_username, ''));
  c jsonb;
  seen text[] := '{}';
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(uname) < 3 or length(uname) > 13
     or uname !~ '^[[:alnum:]А-Яа-яІіЇїЄєҐґʼ''_. -]+$' then
    raise exception 'USERNAME_INVALID';
  end if;
  -- TIM-007: майбутньою вважається дата ПІСЛЯ завтра за UTC — інакше
  -- відкидався б цілком нормальний «сьогодні» в поясах UTC+X.
  if p_birth is null or p_birth > current_date + 1 then raise exception 'BIRTH_INVALID'; end if;
  yrs := date_part('year', age(current_date + 1, p_birth));
  if yrs > 120 then raise exception 'BIRTH_INVALID'; end if;
  if yrs < 17 then raise exception 'UNDERAGE'; end if;
  if p_screening is not null and octet_length(p_screening::text) > 8192 then
    raise exception 'SCREENING_TOO_LARGE';
  end if;
  if p_consents is null or jsonb_typeof(p_consents) <> 'array' then
    raise exception 'CONSENT_REQUIRED';
  end if;
  for c in select * from jsonb_array_elements(p_consents) loop
    if (c ->> 'document') in ('privacy_policy','terms_of_use','medical_disclaimer')
       and length(coalesce(c ->> 'version', '')) between 1 and 16 then
      seen := array_append(seen, c ->> 'document');
    end if;
  end loop;
  if not (seen @> array['privacy_policy','terms_of_use','medical_disclaimer']) then
    raise exception 'CONSENT_REQUIRED';
  end if;

  select * into cur from public.account_status where user_id = uid;
  if found and cur.status = 'blocked' then raise exception 'BLOCKED'; end if;

  -- SEC-001: відмова не скасовується самим користувачем.
  if found and cur.status = 'rejected' then
    raise exception 'REJECTED';
  end if;

  if found and cur.status = 'approved' then
    -- SEC-002: схвалений без заявки не має лишатись без ніка.
    if cur.username is null then
      begin
        update public.account_status
           set username = uname, birth_date = coalesce(birth_date, p_birth)
         where user_id = uid;
      exception when unique_violation then
        raise exception 'USERNAME_TAKEN';
      end;
    end if;
    return jsonb_build_object('status', 'approved');
  end if;

  if found and cur.status = 'pending' and cur.requested_at > now() - interval '60 seconds' then
    return jsonb_build_object('status', 'pending', 'throttled', true);
  end if;

  -- DB-014 (a): рішення ухвалює унікальний індекс, exists — швидка відмова.
  if exists (
    select 1 from public.account_status
    where lower(username) = lower(uname) and user_id <> uid
  ) then
    raise exception 'USERNAME_TAKEN';
  end if;

  begin
    insert into public.account_status
      (user_id, status, username, birth_date, screening, requested_at)
    values
      (uid, 'pending', uname, p_birth, coalesce(p_screening, '{}'::jsonb), now())
    on conflict (user_id) do update set
      status = 'pending',
      username = excluded.username,
      birth_date = excluded.birth_date,
      screening = excluded.screening,
      requested_at = now(),
      decided_at = null,
      decided_by = null;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN';
  end;

  -- DB-014 (b): дедуп тримає унікальний індекс consent_log_uniq.
  insert into public.consent_log (user_id, document, version)
  select uid, c2 ->> 'document', left(c2 ->> 'version', 16)
  from jsonb_array_elements(p_consents) c2
  where (c2 ->> 'document') in ('privacy_policy','terms_of_use','medical_disclaimer')
    and length(coalesce(c2 ->> 'version', '')) between 1 and 16
  on conflict do nothing;

  return jsonb_build_object('status', 'pending');
end $function$
;
grant execute on function public.register_request(p_username text, p_birth date, p_screening jsonb, p_consents jsonb) to authenticated;
grant execute on function public.register_request(p_username text, p_birth date, p_screening jsonb, p_consents jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.season_bounds(p_season text, OUT s date, OUT e date)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  e := public.season_end(p_season);
  if e is null then s := null; return; end if;
  s := public.season_end(public.season_prev(p_season)) + 1;
end $function$
;
grant execute on function public.season_bounds(p_season text, OUT s date, OUT e date) to authenticated;
grant execute on function public.season_bounds(p_season text, OUT s date, OUT e date) to service_role;

CREATE OR REPLACE FUNCTION public.season_end(p_season text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare nom date;
begin
  nom := public.season_nominal_end(p_season);
  if nom is null then return null; end if;
  -- До вересня 2026 сезон закінчувався номінальною датою; далі — найближчою
  -- неділею від неї, щоб тижні сезону були цілими (season_week_bounds).
  if nom < date '2026-09-01' then return nom; end if;
  return nom + ((7 - extract(isodow from nom)::int) % 7);
end $function$
;
grant execute on function public.season_end(p_season text) to authenticated;
grant execute on function public.season_end(p_season text) to service_role;

CREATE OR REPLACE FUNCTION public.season_nominal_end(p_season text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare m text[]; y int;
begin
  m := regexp_match(coalesce(p_season, ''), '^(SPRING|SUMMER|AUTUMN|WINTER)-(\d{4})$');
  if m is null then return null; end if;
  y := m[2]::int;
  case m[1]
    when 'SPRING' then return make_date(y, 5, 31);
    when 'SUMMER' then return make_date(y, 8, 31);
    when 'AUTUMN' then return make_date(y, 11, 30);
    else               return make_date(y + 1, 3, 1) - 1;
  end case;
end $function$
;
grant execute on function public.season_nominal_end(p_season text) to authenticated;
grant execute on function public.season_nominal_end(p_season text) to service_role;

CREATE OR REPLACE FUNCTION public.season_of(d date)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  szn text;
  m int := extract(month from d)::int;
  y int := extract(year from d)::int;
  b record;
  i int := 0;
begin
  if d is null then return null; end if;
  szn := case
    when m between 3 and 5  then 'SPRING-'  || y
    when m between 6 and 8  then 'SUMMER-'  || y
    when m between 9 and 11 then 'AUTUMN-' || y
    when m = 12             then 'WINTER-' || y
    else                         'WINTER-' || (y - 1)
  end;
  loop
    exit when i >= 4;
    i := i + 1;
    select * into b from public.season_bounds(szn);
    if d < b.s then
      szn := public.season_prev(szn);
    elsif d > b.e then
      szn := case
        when szn like 'SPRING-%' then 'SUMMER-' || split_part(szn, '-', 2)
        when szn like 'SUMMER-%' then 'AUTUMN-' || split_part(szn, '-', 2)
        when szn like 'AUTUMN-%' then 'WINTER-' || split_part(szn, '-', 2)
        else 'SPRING-' || (split_part(szn, '-', 2)::int + 1)
      end;
    else
      exit;
    end if;
  end loop;
  return szn;
end $function$
;
grant execute on function public.season_of(d date) to authenticated;
grant execute on function public.season_of(d date) to service_role;

CREATE OR REPLACE FUNCTION public.season_prev(p_season text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare m text[]; y int;
begin
  m := regexp_match(coalesce(p_season, ''), '^(SPRING|SUMMER|AUTUMN|WINTER)-(\d{4})$');
  if m is null then return null; end if;
  y := m[2]::int;
  case m[1]
    when 'SPRING' then return 'WINTER-' || (y - 1);
    when 'SUMMER' then return 'SPRING-' || y;
    when 'AUTUMN' then return 'SUMMER-' || y;
    else               return 'AUTUMN-' || y;
  end case;
end $function$
;
grant execute on function public.season_prev(p_season text) to authenticated;
grant execute on function public.season_prev(p_season text) to service_role;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
grant execute on function public.touch_updated_at() to service_role;

CREATE OR REPLACE FUNCTION public.username_free(p_username text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select not exists (
    select 1 from public.account_status
    where lower(username) = lower(trim(p_username))
      and user_id is distinct from auth.uid()
  )
$function$
;
grant execute on function public.username_free(p_username text) to authenticated;
grant execute on function public.username_free(p_username text) to service_role;

-- жодна функція public не має execute для PUBLIC
revoke execute on all functions in schema public from public;

-- RLS
alter table public.account_status enable row level security;
alter table public.account_status force row level security;
alter table public.admins enable row level security;
alter table public.admins force row level security;
alter table public.awards enable row level security;
alter table public.awards force row level security;
alter table public.consent_log enable row level security;
alter table public.consent_log force row level security;
alter table public.cron_log enable row level security;
alter table public.cron_log force row level security;
alter table public.elo_config enable row level security;
alter table public.elo_config force row level security;
alter table public.elo_events enable row level security;
alter table public.elo_events force row level security;
alter table public.elo_week_plan enable row level security;
alter table public.elo_week_plan force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.season_history enable row level security;
alter table public.season_history force row level security;
alter table public.season_state enable row level security;
alter table public.season_state force row level security;

-- політики
create policy account_status_select_own on public.account_status as PERMISSIVE for SELECT to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));

create policy admins_select_self on public.admins as PERMISSIVE for SELECT to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));

create policy awards_select_own on public.awards as PERMISSIVE for SELECT to authenticated
  using (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)));

create policy consent_log_select_own on public.consent_log as PERMISSIVE for SELECT to authenticated
  using ((( SELECT auth.uid() AS uid) = user_id));

create policy elo_config_read on public.elo_config as PERMISSIVE for SELECT to authenticated
  using (( SELECT is_approved(auth.uid()) AS is_approved));

create policy elo_events_select_own on public.elo_events as PERMISSIVE for SELECT to authenticated
  using (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)));

create policy profiles_delete_own on public.profiles as PERMISSIVE for DELETE to authenticated
  using (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)));

create policy profiles_insert_own on public.profiles as PERMISSIVE for INSERT to authenticated
  with check (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)));

create policy profiles_select_own on public.profiles as PERMISSIVE for SELECT to authenticated
  using (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)));

create policy profiles_update_own on public.profiles as PERMISSIVE for UPDATE to authenticated
  using (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)))
  with check (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)));

create policy season_history_select_own on public.season_history as PERMISSIVE for SELECT to authenticated
  using (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)));

create policy season_state_select_own on public.season_state as PERMISSIVE for SELECT to authenticated
  using (((( SELECT auth.uid() AS uid) = user_id) AND ( SELECT is_approved(auth.uid()) AS is_approved)));

CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_grant_beta AFTER INSERT ON public.account_status FOR EACH ROW EXECUTE FUNCTION grant_beta_award();

-- права на таблиці
grant SELECT on public.account_status to authenticated;
grant SELECT on public.admins to authenticated;
grant SELECT on public.awards to authenticated;
grant SELECT on public.consent_log to authenticated;
grant SELECT on public.elo_config to authenticated;
grant SELECT on public.elo_events to authenticated;
grant DELETE on public.profiles to authenticated;
grant INSERT on public.profiles to authenticated;
grant SELECT on public.profiles to authenticated;
grant SELECT on public.season_history to authenticated;
grant SELECT on public.season_state to authenticated;
grant DELETE on public.account_status to service_role;
grant INSERT on public.account_status to service_role;
grant REFERENCES on public.account_status to service_role;
grant SELECT on public.account_status to service_role;
grant TRIGGER on public.account_status to service_role;
grant TRUNCATE on public.account_status to service_role;
grant UPDATE on public.account_status to service_role;
grant DELETE on public.admins to service_role;
grant INSERT on public.admins to service_role;
grant REFERENCES on public.admins to service_role;
grant SELECT on public.admins to service_role;
grant TRIGGER on public.admins to service_role;
grant TRUNCATE on public.admins to service_role;
grant UPDATE on public.admins to service_role;
grant DELETE on public.awards to service_role;
grant INSERT on public.awards to service_role;
grant REFERENCES on public.awards to service_role;
grant SELECT on public.awards to service_role;
grant TRIGGER on public.awards to service_role;
grant TRUNCATE on public.awards to service_role;
grant UPDATE on public.awards to service_role;
grant DELETE on public.consent_log to service_role;
grant INSERT on public.consent_log to service_role;
grant REFERENCES on public.consent_log to service_role;
grant SELECT on public.consent_log to service_role;
grant TRIGGER on public.consent_log to service_role;
grant TRUNCATE on public.consent_log to service_role;
grant UPDATE on public.consent_log to service_role;
grant DELETE on public.cron_log to service_role;
grant INSERT on public.cron_log to service_role;
grant REFERENCES on public.cron_log to service_role;
grant SELECT on public.cron_log to service_role;
grant TRIGGER on public.cron_log to service_role;
grant TRUNCATE on public.cron_log to service_role;
grant UPDATE on public.cron_log to service_role;
grant DELETE on public.elo_config to service_role;
grant INSERT on public.elo_config to service_role;
grant REFERENCES on public.elo_config to service_role;
grant SELECT on public.elo_config to service_role;
grant TRIGGER on public.elo_config to service_role;
grant TRUNCATE on public.elo_config to service_role;
grant UPDATE on public.elo_config to service_role;
grant DELETE on public.elo_events to service_role;
grant INSERT on public.elo_events to service_role;
grant REFERENCES on public.elo_events to service_role;
grant SELECT on public.elo_events to service_role;
grant TRIGGER on public.elo_events to service_role;
grant TRUNCATE on public.elo_events to service_role;
grant UPDATE on public.elo_events to service_role;
grant DELETE on public.elo_week_plan to service_role;
grant INSERT on public.elo_week_plan to service_role;
grant REFERENCES on public.elo_week_plan to service_role;
grant SELECT on public.elo_week_plan to service_role;
grant TRIGGER on public.elo_week_plan to service_role;
grant TRUNCATE on public.elo_week_plan to service_role;
grant UPDATE on public.elo_week_plan to service_role;
grant DELETE on public.profiles to service_role;
grant INSERT on public.profiles to service_role;
grant REFERENCES on public.profiles to service_role;
grant SELECT on public.profiles to service_role;
grant TRIGGER on public.profiles to service_role;
grant TRUNCATE on public.profiles to service_role;
grant UPDATE on public.profiles to service_role;
grant DELETE on public.season_history to service_role;
grant INSERT on public.season_history to service_role;
grant REFERENCES on public.season_history to service_role;
grant SELECT on public.season_history to service_role;
grant TRIGGER on public.season_history to service_role;
grant TRUNCATE on public.season_history to service_role;
grant UPDATE on public.season_history to service_role;
grant DELETE on public.season_state to service_role;
grant INSERT on public.season_state to service_role;
grant REFERENCES on public.season_state to service_role;
grant SELECT on public.season_state to service_role;
grant TRIGGER on public.season_state to service_role;
grant TRUNCATE on public.season_state to service_role;
grant UPDATE on public.season_state to service_role;

-- права на окремі колонки
grant UPDATE (data) on public.profiles to authenticated;
grant UPDATE (user_id) on public.profiles to authenticated;

-- заплановані завдання (для довідки, не виконується цим файлом)
-- cron: forge-elo-week  «10 0 * * *»  select public.elo_cron_log_eval_week()
-- cron: forge-purge-abandoned-signups  «20 3 * * *»  select public.cron_purge_abandoned_signups()
