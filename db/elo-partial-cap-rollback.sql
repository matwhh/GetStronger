-- ============================================================================
-- ВІДКАТ db/elo-partial-cap.sql
--
-- Повертає elo_facts і elo_action_delta до стану ДО стелі приблизного дня
-- і прибирає ключ partialNutritionCap із конфігу.
--
-- Тіла функцій тут — не переписані з памʼяті, а взяті з тієї ж міграції зі
-- знятими трьома доданими місцями. Відкат, написаний окремо від міграції,
-- розходиться з нею на першій же правці.
--
-- УВАГА: разом із цим файлом треба відкотити й клієнта — js/elo-core.js
-- (стеля в mealDelta) і js/history-core.js (pTarget для дня без білка).
-- Інакше клієнт показуватиме прогноз, якого сервер більше не нарахує.
-- ============================================================================

update public.elo_config
   set data = data - 'partialNutritionCap'
 where id = 1;

-- 2. elo_facts: у payload дня харчування додається прапорець partial.
--    Решта тіла — копія чинної функції без змін.
create or replace function public.elo_facts(uid uuid, kind text, p_day date, cfg jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
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
      -- pTarget пишеться з етапу «authoritative ELO». У старих записах його
      -- немає — тоді калорії беруть усю вагу категорії (див. elo_action_delta).
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
$function$;

-- 3. elo_action_delta: стеля для приблизного дня. Решта тіла — копія
--    чинної функції без змін.
create or replace function public.elo_action_delta(
  kind text, payload jsonb, cfg jsonb, planned_days integer, grace boolean, p_elo numeric
) returns table (quality numeric, delta integer)
language plpgsql immutable set search_path to 'public'
as $function$
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
$function$;

-- 4. Права. create or replace їх зберігає, але грант, який живе ТІЛЬКИ в
--    базі й не названий у жодному файлі, — це вже було (elo_week_ready).
--    Тому чинний стан називається вголос: виконує лише service_role.
revoke execute on function public.elo_facts(uuid, text, date, jsonb)
  from public, anon, authenticated;
revoke execute on function public.elo_action_delta(text, jsonb, jsonb, integer, boolean, numeric)
  from public, anon, authenticated;
