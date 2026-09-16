-- ============================================================================
-- ПЕРЕКРИТО: пізнішими міграціями (чинні тіла — лише в live-schema.sql). НЕ ЗАПУСКАТИ ПО БОЙОВІЙ БАЗІ.
-- ============================================================================
-- register_request і elo_set_name тут старіші за базу, і різниця не
-- косметична: у чинному elo_set_name є перевірка унікальності ніка
-- (USERNAME_TAKEN проти account_status і season_state), а тут її
-- немає ЗОВСІМ. Прогін зніме її з продакшену — рівно той сценарій,
-- що вже стався з NOT_APPROVED (INV-002).
--
-- Файл лишається як історія: він пояснює, ЧОМУ база стала такою. Що в
-- ній зараз — db/live-schema.sql. Як міняти базу — db/README.md.
-- Позначку звіряє tools/ci-hygiene.mjs (перевірки 8 і 21).
-- ============================================================================

/*
 * Нік — до 13 символів (було 24).
 *
 * ДЕ САМЕ ЦЕ МАЄ СТОЯТИ. Довжину перевіряють ЧОТИРИ місця, і всі чотири
 * мусять казати одне: maxlength у полі вводу (js/welcome.js, js/season.js),
 * валідатор імпорту резервної копії (js/account.js), RPC register_request
 * і сам стовпець. Клієнтські три — зручність; справжня межа тут, бо
 * register_request можна викликати повз інтерфейс.
 *
 * CHECK на стовпці стоїть НАД функцією навмисно: якщо колись з'явиться
 * другий шлях запису ніка, він упреться в базу, а не проскочить із
 * довжиною, під яку не розраховані ні дошка лідерів, ні адмінка.
 */

-- 1. Сама межа — на стовпці.
alter table public.account_status
  drop constraint if exists account_status_username_len;

alter table public.account_status
  add constraint account_status_username_len
  check (username is null or char_length(username) between 3 and 13);

-- 2. Заявка: та сама межа, але з людською помилкою замість помилки бази.
create or replace function public.register_request(
  p_username text, p_birth date, p_screening jsonb, p_consents jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into public.consent_log (user_id, document, version)
  select uid, c2 ->> 'document', left(c2 ->> 'version', 16)
  from jsonb_array_elements(p_consents) c2
  where (c2 ->> 'document') in ('privacy_policy','terms_of_use','medical_disclaimer')
    and length(coalesce(c2 ->> 'version', '')) between 1 and 16;

  return jsonb_build_object('status', 'pending');
end
$function$;

-- 3. Підпис у season_state обрізається так само: 24 лишило б хвіст,
--    якого ніде більше не існує.
create or replace function public.elo_set_name(p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  approved text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(auth.uid()) then raise exception 'NOT_APPROVED'; end if;

  select nullif(username, '') into approved
  from account_status where user_id = auth.uid();

  update season_state
     set display_name = left(coalesce(approved, coalesce(p_name, '')), 13)
   where user_id = auth.uid() and season = season_of(current_date);
end;
$function$;
