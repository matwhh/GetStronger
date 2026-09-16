-- ============================================================================
-- ПЕРЕКРИТО: elo-week-eval-fix.sql. НЕ ЗАПУСКАТИ ПО БОЙОВІЙ БАЗІ.
-- ============================================================================
-- elo_catch_up тут старіша за базу.
--
-- Файл лишається як історія: він пояснює, ЧОМУ база стала такою. Що в
-- ній зараз — db/live-schema.sql. Як міняти базу — db/README.md.
-- Позначку звіряє tools/ci-hygiene.mjs (перевірки 8 і 21).
-- ============================================================================

/*
 * elo_catch_up — клієнт-виклична обгортка над наявною elo_catch_up_weeks.
 *
 * ЧОМУ. Клієнт (js/elo-api.js) раніше оцінював пропущені тижні фіксованим
 * вікном «2 тижні назад від сьогодні». Дві діри:
 *   1) хто зникав на 3+ тижні — за старіші тижні штрафу не діставав
 *      (фіксоване вікно будь-якого розміру діряве);
 *   2) вікно рахувалось від СЬОГОДНІ, без прив'язки до дати вступу —
 *      той, хто приєднається в середині сезону, дістав би штраф за тижні
 *      ДО реєстрації (elo_eval_week_for сама такої прив'язки не має).
 *
 * elo_catch_up_weeks натомість іде від date_trunc('week', min(day)) подій
 * користувача в сезоні до сьогодні: жоден незакритий тиждень не вислизає,
 * і нічого до першої події не оцінюється. Ідемпотентна (пропускає тижні з
 * уже наявним 'week:'-record), обмежена 20 ітераціями.
 *
 * Ця обгортка лише додає периметр (auth + is_approved) і підставляє cfg —
 * так само, як elo_evaluate_week. Периметр той самий, що в решти elo_* RPC.
 *
 * Міграція: elo_catch_up_rpc
 */
create or replace function public.elo_catch_up()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); cfg jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not public.is_approved(uid) then raise exception 'NOT_APPROVED'; end if;
  select data into cfg from elo_config where id = 1;
  perform public.elo_catch_up_weeks(uid, season_of(current_date), cfg);
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.elo_catch_up() from public, anon;
grant execute on function public.elo_catch_up() to authenticated;

-- Примітка: elo_evaluate_week(date) лишається в базі (approved-gated), але
-- клієнт її більше не викликає — заміщена цим повним проходом.
