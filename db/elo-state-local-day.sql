-- ============================================================================
-- ПЕРЕКРИТО: elo-skip-category.sql. НЕ ЗАПУСКАТИ ПО БОЙОВІЙ БАЗІ.
-- ============================================================================
-- elo_state тут старіша за базу. Плюс файл робить drop function
-- public.elo_state() — прогін по базі, де вона вже інша, незворотний
-- без ручного відновлення.
--
-- Файл лишається як історія: він пояснює, ЧОМУ база стала такою. Що в
-- ній зараз — db/live-schema.sql. Як міняти базу — db/README.md.
-- Позначку звіряє tools/ci-hygiene.mjs (перевірки 8 і 21).
-- ============================================================================

-- ELO-007. «Сьогодні: +X ELO» рахувалось за UTC-днем сервера.
--
-- ЩО БУЛО. season_state.today_date/today_delta пише elo_submit і ставить
-- today_date = current_date, тобто UTC-дату бази. Події ж записуються з
-- p_day — ЛОКАЛЬНИМ днем клієнта (вікно −2..+1 покриває всі часові пояси).
-- У Києві влітку (UTC+3) з 00:00 до 03:00 це різні дати:
--   · тренування, зроблене о 00:30, лягало в подію за СЬОГОДНІ, а
--     today_delta — у рядок за ВЧОРА (UTC ще вчора);
--   · картка на головній до 03:00 показувала вчорашню суму, а о 03:00
--     вона стрибком обнулялась — без жодної дії людини.
--
-- ЩО СТАЛО. elo_state приймає необовʼязковий p_today — локальний день
-- клієнта — і рахує суму з elo_events саме за цей день. Значення
-- валідується у вікні current_date−2..current_date+1: більше за будь-яку
-- реальну різницю часових поясів (UTC−12..UTC+14) і достатньо вузьке, щоб
-- ним не можна було витягти «суму за довільний день» — утім, це й не
-- таємниця: усі події належать самому запитувачу.
--
-- ЧОМУ САМЕ ЦІ event_type. Рівно ті, які пише elo_submit і які раніше
-- потрапляли в today_delta. Тижневий бонус/штраф (category bonus/penalty,
-- day = кінець тижня) у today_delta не входив і тут не входить — інакше
-- у неділю «сьогодні» стрибало б на весь тижневий бонус.
--
-- Стовпці today_date/today_delta лишаються: їх пише і читає elo_submit.
-- Тут вони більше не використовуються.

create or replace function public.elo_state(p_today date default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  szn text := season_of(current_date);
  st season_state;
  my_rank int; total int;
  cfg jsonb;
  tday date;
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
  if st is null then
    return jsonb_build_object('season', szn, 'elo', 0, 'today', 0,
      'graceUsed', 0, 'graceUntil', null, 'rank', null, 'of', total, 'config', cfg);
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
    'rank', my_rank, 'of', total, 'config', cfg);
end;
$function$;

-- Стара функція без аргументів лишилась би окремим перевантаженням і
-- продовжила б відповідати за UTC-днем. Прибираємо явно.
drop function if exists public.elo_state();

revoke execute on function public.elo_state(date) from public;
grant execute on function public.elo_state(date) to authenticated;
grant execute on function public.elo_state(date) to service_role;

-- ---------------------------------------------------------------------------
-- ELO-008 (міграція elo_state_planned_week). Клієнт рахував оптимістичну
-- дельту з ПОТОЧНОГО профілю (Math.max(1, …)), а сервер — зі знімка тижня
-- в elo_week_plan із межами 3..7: для плану «1 день» тост казав «+51 ELO»
-- проти реальних «+17». Тому elo_state віддає ще й plannedWeek — саме те
-- число, яким рахує сервер. Доступу до elo_week_plan це не дає: функція
-- SECURITY DEFINER і віддає лише рядок самого запитувача.
--
-- elo_planned_for тут НЕ викликається: вона за відсутності знімка його
-- створює, а знімок має зʼявлятись при поданні дії, не при відкритті
-- сторінки. Формула та сама, але без insert.
--
-- Повний текст — у міграції elo_state_planned_week; тут лишається різниця
-- відносно версії вище: змінна planned, поле 'plannedWeek' в обох гілках
-- return.
