-- =====================================================================
--  МЕЖА СЕЗОНУ = МЕЖА ТИЖНЯ
--  season_bounds / season_of: сезон закінчується в НЕДІЛЮ, наступний
--  починається в ПОНЕДІЛОК.
-- =====================================================================
--
--  НАВІЩО. Сезон рахує ТИЖНЕВІ цілі: тижневий бюджет ELO, штраф за
--  незакритий тиждень, «чистий тиждень». Календарний квартал у тижні не
--  ділиться — 1 вересня 2026 випадає на вівторок, — тож перший і
--  останній тижні сезону виходили обрубками. Людина отримувала повний
--  тижневий штраф за три дні, які встигла в сезон, а
--  elo_catch_up_weeks мусив окремо відсіювати тижні, що перетинають
--  межу (умова season_of(w + 6) = szn). Тепер межа сезону збігається з
--  межею тижня, і ці обрубки зникають самі.
--
--  ПРАВИЛО. Кінець сезону — найближча НЕДІЛЯ на або після останнього дня
--  його кварталу. Початок — наступний день після кінця попереднього,
--  тобто завжди понеділок. Якщо квартал уже закінчується в неділю,
--  нічого не зсувається.
--
--  ДАТА ВВЕДЕННЯ (RULE_FROM = 2026-09-01). Правило діє для сезонів, чий
--  квартал закінчується 1 вересня 2026 або пізніше. Це не примха, а
--  вимога до вже записаних даних: осінь-2026 стартувала 1 вересня, і за
--  1–6 вересня вже нараховано ELO. Якби правило діяло заднім числом,
--  season_of переклав би ці дні в літо-2026 — тобто ELO за них зникло б
--  із поточного сезону й таблиці лідерів, а elo_events лишились би
--  лежати з чужим season_of. Тому осінь-2026 лишається з 1 вересня, але
--  закінчується в неділю 6 грудня; зима починається в понеділок
--  7 грудня, і з неї кожен сезон — ціле число тижнів.
--
--  ЩО ЦЕ ЗМІНЮЄ В ДАНИХ. Нічого вже записаного. Єдиний зсув — кінець
--  поточного сезону з 30 листопада на 6 грудня, тобто сезон триває на
--  шість днів довше. Жоден день не змінює свого season_of:
--    • до 2026-08-31 межі ті самі, що були;
--    • 2026-09-01 … 2026-11-30 як були осінню, так і лишились;
--    • 2026-12-01 … 2026-12-06 БУЛИ зимою за старим правилом, але зими
--      ще не існувало (перший сезон почався 1 вересня 2026), тож
--      переносити нема чого.
--
--  ПАРНІСТЬ. Те саме правило живе в js/elo-core.js (seasonRange,
--  seasonOf) і стережеться tests/elo-core.test.js. Розходження клієнта й
--  сервера тут не помітне на око: обидва показуватимуть свій «день N із
--  M», а закриється сезон тоді, коли вирішить сервер.
--
--  ІДЕМПОТЕНТНО: лише CREATE OR REPLACE двох IMMUTABLE-функцій, жодних
--  DDL над таблицями й жодних UPDATE над даними.
-- =====================================================================

-- Останній день кварталу сезону, без правила тижня.
create or replace function public.season_nominal_end(p_season text)
returns date
language plpgsql
immutable
set search_path to 'public'
as $$
declare m text[]; y int;
begin
  m := regexp_match(coalesce(p_season, ''), '^(SPRING|SUMMER|AUTUMN|WINTER)-(\d{4})$');
  if m is null then return null; end if;
  y := m[2]::int;
  case m[1]
    when 'SPRING' then return make_date(y, 5, 31);
    when 'SUMMER' then return make_date(y, 8, 31);
    when 'AUTUMN' then return make_date(y, 11, 30);
    else               return make_date(y + 1, 3, 1) - 1;   -- 28/29 лютого
  end case;
end $$;

-- Кінець сезону з урахуванням правила: неділя, якщо правило вже діє.
-- extract(isodow) = 7 у неділю, тому додаємо (7 - isodow) mod 7.
create or replace function public.season_end(p_season text)
returns date
language sql
immutable
set search_path to 'public'
as $$
  select case
    when nom is null then null
    when nom < date '2026-09-01' then nom
    else nom + ((7 - extract(isodow from nom)::int) % 7)
  end
  from (select public.season_nominal_end(p_season) as nom) q;
$$;

-- Код сезону, що йде перед даним.
create or replace function public.season_prev(p_season text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
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
end $$;

-- Межі сезону: початок = наступний день після кінця попереднього.
create or replace function public.season_bounds(p_season text, out s date, out e date)
returns record
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  e := public.season_end(p_season);
  if e is null then s := null; return; end if;
  s := public.season_end(public.season_prev(p_season)) + 1;
end $$;

-- Сезон дати. Квартальна відповідь — перше наближення: межа зсунута
-- максимум на шість днів, тож дата біля стику може належати сусідньому
-- сезону. Уточнюємо не більш ніж двома кроками.
create or replace function public.season_of(d date)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
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
      -- наступний сезон = той, для якого поточний є попереднім
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
end $$;

grant execute on function public.season_nominal_end(text) to service_role;
grant execute on function public.season_end(text) to service_role;
grant execute on function public.season_prev(text) to service_role;
grant execute on function public.season_bounds(text) to service_role;
grant execute on function public.season_of(date) to authenticated;
grant execute on function public.season_of(date) to service_role;
