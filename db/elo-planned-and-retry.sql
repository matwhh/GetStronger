-- =============================================================================
-- ELO-003 і INV-004 (аудит 2026-09)
-- =============================================================================
-- Міграції: elo_planned_for_safe_cast_and_retry_flag,
--           elo_submit_restore_original_plus_retry_flag
--
-- ELO-003. elo_planned_for кастував текст із профілю в int напряму:
--   coalesce((data #>> '{activePlan,days}')::int, (data ->> 'daysPerWeek')::int, 3)
-- Значення '4.5', 'abc', '5 днів' або 99999999999 кидали виняток при
-- ПЕРШОМУ дотику кожного нового ISO-тижня — тобто падав кожен elo_submit і
-- кожен elo_catch_up. Клієнт повертав null, подія не позначалась
-- надісланою і повторювалась на кожен Store.onChange; у cron людина
-- потрапляла у failed. Дробове значення потрапляло в профіль легально:
-- перевірка на клієнті приймала 4.5 як «скінченне число».
--
-- Тепер значення проходить через elo_num (розбирає і число, і числовий
-- рядок, на решту віддає замовчування) і floor. На клієнті days і
-- daysPerWeek округлюються до цілого — і при імпорті, і при виборі плану.
--
-- INV-004. elo_facts повертає null для тренування, у якому вправ менше за
-- floors.workoutTotalMin (типово 3) — а це легальний день: видаляти вправи
-- з плану можна без нижньої межі. elo_submit віддавав на це
-- {ok:false, error:'no_data', retry:true}, тобто «спробуй ще». Клієнт і
-- пробував — на КОЖЕН Store.onChange протягом трьох діб.
--
-- Тепер розрізняються два різні «даних немає»:
--   retry = true  — запису дня в профілі немає взагалі (черга профілю і
--                   черга подій незалежні, подія могла випередити
--                   збереження) — повтор доречний;
--   retry = false — запис є, але не дотягує до порога — це остаточно.
-- На клієнті 4xx теж повертає retry:false замість null, інакше подію
-- нікому було закрити.
--
-- ОКРЕМА ПРИМІТКА ПРО ДРУГУ МІГРАЦІЮ. Перша версія переписала elo_submit з
-- реконструйованого тексту (хвіст функції не влазив у вивід) і втратила
-- elo_try_clean_day, тижневу стелю через elo_week_room, компенсацію при
-- програній гонці вставки й правильну назву ключа конфігу (dayGainCap, а
-- не dailyCap). Друга міграція повернула ТОЧНИЙ текст функції з єдиною
-- зміною — прапорцем retry. Урок у db/README.md: функцію переписують
-- цілком лише з її фактичного тексту, а не з памʼяті про нього.
-- =============================================================================

create or replace function public.elo_planned_for(uid uuid, p_week_start date)
returns integer
language plpgsql security definer set search_path = public as $$
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
end $$;

revoke all on function public.elo_planned_for(uuid, date) from public;
grant execute on function public.elo_planned_for(uuid, date) to service_role;

-- Зміна в elo_submit — рівно одна, у гілці facts is null. Повний текст
-- функції дивись у db/live-schema.sql: дублювати його тут означало б
-- завести ще одну копію, яка розʼїдеться з базою.
--
--   select (data #> array[case p_kind
--                           when 'workout' then 'sessionLog'
--                           when 'meal'    then 'mealLog'
--                           else 'trackerLog' end,
--                         p_day::text]) is not null
--     into has_row from profiles where user_id = uid;
--   return jsonb_build_object('ok', false, 'error', 'no_data',
--                             'retry', not coalesce(has_row, false));
