-- =====================================================================
--  ВІДКІТ db/season-week-bounds.sql
-- =====================================================================
--  Повертає season_of і season_bounds до календарних кварталів — рівно
--  ті визначення, що були зняті з бойової бази перед застосуванням
--  правила тижня. Дані не чіпає (їх та міграція й не чіпала).
--
--  Тримається в репозиторії навмисно: міграція міняє ПРАВИЛО, за яким
--  рахується сезон, а не структуру. Якщо правило доведеться відкотити,
--  шукати попередні визначення по історії git — найгірший момент для
--  археології.
--
--  Допоміжні функції (season_nominal_end, season_end, season_prev)
--  лишаються: вони нікому не заважають, а drop їх зробив би відкіт
--  залежним від порядку.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.season_bounds(p_season text, OUT s date, OUT e date)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare m text[]; y int;
begin
  m := regexp_match(coalesce(p_season, ''), '^(SPRING|SUMMER|AUTUMN|WINTER)-(\d{4})$');
  if m is null then s := null; e := null; return; end if;
  y := m[2]::int;
  case m[1]
    when 'SPRING' then s := make_date(y, 3, 1);  e := make_date(y, 5, 31);
    when 'SUMMER' then s := make_date(y, 6, 1);  e := make_date(y, 8, 31);
    when 'AUTUMN' then s := make_date(y, 9, 1);  e := make_date(y, 11, 30);
    else               s := make_date(y, 12, 1); e := make_date(y + 1, 3, 1) - 1;
  end case;
end $function$;

CREATE OR REPLACE FUNCTION public.season_of(d date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when extract(month from d) in (3,4,5)  then 'SPRING-'  || extract(year from d)
    when extract(month from d) in (6,7,8)  then 'SUMMER-'  || extract(year from d)
    when extract(month from d) in (9,10,11) then 'AUTUMN-' || extract(year from d)
    when extract(month from d) = 12         then 'WINTER-' || extract(year from d)
    else 'WINTER-' || (extract(year from d) - 1)
  end;
$function$;

grant execute on function public.season_bounds(p_season text, OUT s date, OUT e date) to service_role;
grant execute on function public.season_of(d date) to authenticated;
grant execute on function public.season_of(d date) to service_role;
