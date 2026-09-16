-- ============================================================================
-- ПЕРЕКРИТО: пізнішими міграціями (чинне тіло — лише в live-schema.sql). НЕ ЗАПУСКАТИ ПО БОЙОВІЙ БАЗІ.
-- ============================================================================
-- elo_set_name тут старіша за базу й без перевірки унікальності ніка
-- (USERNAME_TAKEN). Довжина теж інша: 24 проти чинних 13.
--
-- Файл лишається як історія: він пояснює, ЧОМУ база стала такою. Що в
-- ній зараз — db/live-schema.sql. Як міняти базу — db/README.md.
-- Позначку звіряє tools/ci-hygiene.mjs (перевірки 8 і 21).
-- ============================================================================

/*
 * Ім'я в таблиці лідерів = ЗАТВЕРДЖЕНИЙ нік, а не те, що людина вписала собі.
 *
 * ЩО БУЛО НЕ ТАК. Унікальність ніка стереже індекс
 * account_status_username_key (унікальний, за lower(username)) — його
 * заповнює register_request під час заявки, і саме його бачить адмін,
 * коли підтверджує акаунт. А на дошку йшло season_state.display_name,
 * яке клієнт пише сам через elo_set_name зі свого profile.displayName.
 * Це поле НІЧИМ не обмежене: жодної унікальності, жодного зв'язку із
 * затвердженим ніком. Двоє могли показатись однаковими іменами, і будь-хто
 * міг вписати собі чуже.
 *
 * На одному користувачі це непомітно. На десятьох — це вже дошка, якій
 * не можна вірити.
 *
 * ЯК СТАЛО. Джерело імені — account_status.username. season_state.display_name
 * лишається запасним варіантом для акаунтів, створених до появи анкети
 * (у них username = null), і тільки для них.
 */

create or replace function public.elo_leaderboard(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
           /* Затверджений нік → давнє власне ім'я → підпис за замовчуванням. */
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
$function$;

/*
 * elo_set_name більше не приймає довільний рядок від того, у кого є
 * затверджений нік: воно записує саме затверджений. Клієнт як викликав
 * його з profile.displayName, так і викликає — просто тепер це не може
 * розійтися з тим, що бачить адмін і що стереже унікальний індекс.
 *
 * Аргумент лишається робочим для акаунтів без ніка (створених до анкети):
 * інакше вони втратили б єдиний спосіб підписатись.
 */
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
     set display_name = left(coalesce(approved, coalesce(p_name, '')), 24)
   where user_id = auth.uid() and season = season_of(current_date);
end;
$function$;

/*
 * Поріг відсотків: 20 → 8.
 *
 * leaderboardTops [10%, 5%, 1%] на десятьох дає 1, 0.5 і 0.1 людини —
 * тобто реально спрацьовує лише верхні 10%. Але поріг 20 ховав і його:
 * на групі з десяти відсотки не з'явились би НІКОЛИ. Вісім — це момент,
 * коли рейтинг уже щось означає, а не змагання трьох.
 */
update public.elo_config
   set data = jsonb_set(data, '{minUsersForPercentile}', '8'::jsonb),
       updated_at = now()
 where id = 1;
