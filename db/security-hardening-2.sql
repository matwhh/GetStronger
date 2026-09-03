-- =============================================================================
-- SECURITY HARDENING 2 — залишки backend-аудиту 2026-09-02 (F-04, F-07, F-08)
-- =============================================================================
-- Міграція: hardening_size_limits_oracles_view
--
-- F-04  Розмір client-JSON не обмежувався: profiles.data і screening заявки
--       приймали будь-який обсяг; register_request можна було кликати без
--       кінця, і кожен виклик додавав 3 рядки consent_log.
--       → CHECK на розмір (profiles.data ≤ 1 MB — у 50× більше за поточний
--         профіль і ≈4 роки росту за симуляцією; screening ≤ 8 KB — клієнт
--         шле ~200 байт), повторна заявка не частіше ніж раз на 60 с
--         (ідемпотентно повертає pending), згоди не дублюються для тієї
--         самої (документ, версія).
-- F-08  is_admin(uid) / is_approved(uid) відповідали для БУДЬ-ЯКОГО uuid —
--       оракул статусу чужого акаунта. EXECUTE зняти не можна (політики RLS
--       викликають їх від імені authenticated), тому функції відповідають
--       лише про самого викликача: чужий uid → false. Усі виклики в базі
--       передають auth.uid(), поведінка для них незмінна.
-- F-07  View public.leaderboard (security_invoker) повертав лише власний
--       рядок і ніде не використовувався (клієнт — RPC elo_leaderboard).
--       Прибрано, щоб не вводити в оману.
-- =============================================================================

-- ---- F-04: межі розміру ---------------------------------------------------
alter table public.profiles drop constraint if exists profiles_data_size;
alter table public.profiles add constraint profiles_data_size
  check (octet_length(data::text) <= 1048576);

alter table public.account_status drop constraint if exists account_status_screening_size;
alter table public.account_status add constraint account_status_screening_size
  check (octet_length(screening::text) <= 8192);

create or replace function public.register_request(p_username text, p_birth date, p_screening jsonb, p_consents jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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

  if p_birth is null or p_birth > current_date then raise exception 'BIRTH_INVALID'; end if;
  yrs := date_part('year', age(current_date, p_birth));
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
  if found and cur.status = 'approved' then
    return jsonb_build_object('status', 'approved');
  end if;
  -- Повторна заявка з тими самими даними не частіше ніж раз на хвилину:
  -- без цього один акаунт міг безмежно плодити рядки consent_log.
  if found and cur.status = 'pending' and cur.requested_at > now() - interval '60 seconds' then
    return jsonb_build_object('status', 'pending', 'throttled', true);
  end if;

  if exists (
    select 1 from public.account_status
    where lower(username) = lower(uname) and user_id <> uid
  ) then
    raise exception 'USERNAME_TAKEN';
  end if;

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

  -- Кожна (документ, версія) фіксується один раз: повторна заявка з тими
  -- самими версіями не додає рядків.
  insert into public.consent_log (user_id, document, version)
  select uid, c2 ->> 'document', left(c2 ->> 'version', 16)
  from jsonb_array_elements(p_consents) c2
  where (c2 ->> 'document') in ('privacy_policy','terms_of_use','medical_disclaimer')
    and length(coalesce(c2 ->> 'version', '')) between 1 and 16
    and not exists (
      select 1 from public.consent_log cl
      where cl.user_id = uid and cl.document = c2 ->> 'document'
        and cl.version = left(c2 ->> 'version', 16));

  return jsonb_build_object('status', 'pending');
end
$$;

-- ---- F-08: оракули відповідають лише про себе -----------------------------
create or replace function public.is_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select uid is not null and uid = auth.uid()
     and exists (select 1 from public.admins where user_id = uid) $$;

create or replace function public.is_approved(uid uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select uid is not null and uid = auth.uid()
     and exists (select 1 from public.account_status where user_id = uid and status = 'approved') $$;

-- ---- F-07: мертвий view ---------------------------------------------------
drop view if exists public.leaderboard;

-- ---- F-09: застаріла публічна копія сайту ---------------------------------
-- Міграція: drop_stale_site_files. Таблиця site_files (112 файлів, останній
-- запис 27.08.2026) лишилась від старого способу публікації; сайт роздає
-- Vercel. Це був єдиний anon-читабельний обʼєкт у схемі.
drop policy if exists site_files_public_read on public.site_files;
drop table if exists public.site_files;
