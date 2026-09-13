-- ============================================================================
-- Приблизний день харчування: стеля нижча за поріг чистого дня
--
-- ЩО БУЛО НЕ ТАК
--
-- Швидкий запис дня (js/history-core.js quickDay, «Швидкі калорії») писав
-- pTarget навіть тоді, коли білка в записі немає. Для elo_facts pTarget > 0
-- означає «є з чим порівнювати», тож нуль білка йшов у драбину й падав на
-- найнижчу сходинку — 0.05. Тобто «невідомо» рахувалось як «зʼїв нуль
-- білка»: день із бездоганними калоріями коштував 0.5725 замість 1.0, а
-- застосунок показував людині тост «білкова частина рейтингу за цей день
-- не рахується».
--
-- Гілка «калорії беруть усю вагу при pTarget = 0» тут була від етапу
-- authoritative. До неї просто ніколи не доходило.
--
-- ЩО ВИРІШЕНО
--
-- Клієнт більше не пише pTarget для дня без білка (js/history-core.js) —
-- отже наявна гілка нарешті працює. Але самих калорій замало: без стелі
-- бездоганний приблизний день коштував би рівно стільки ж, скільки
-- розібраний по грамах, і розбирати їжу не було б сенсу взагалі.
--
-- Тому приблизний день зрізається стелею partialNutritionCap = 0.85.
-- Число вибране НЕ на око: cleanThreshold = 0.9, і 0.85 туди не дотягує за
-- побудовою. Отже «приблизний день ніколи не буває чистим» — це наслідок
-- одного числа, а не окремої заборони. Перелік заборон розходиться з
-- правилом на першій же правці; одне число — ні.
--
-- Стеля зрізає лише верх: поганий приблизний день і без неї нижчий, тож
-- карати його вдруге нема за що.
--
-- Драбина за день харчування (бюджет 7.35 ELO, калорії в межах 2 %):
--   розібраний, білок у нормі      1.00   +7
--   приблизний, будь-який          0.85   +6
--   приблизний без білка ДО ЦЬОГО  0.57   +4   ← лагодимо
--   день не записано               —       0
--
-- Заднім числом нічого не переписується: elo_action_delta рахує в момент
-- подання, уже записані події лишаються як є.
--
-- Дзеркало в клієнті — js/elo-core.js mealDelta. Міняти разом: інакше
-- показаний прогноз розійдеться з нарахованим.
-- ============================================================================

-- 1. Конфіг. Окремим update, а не засівом: рядок один і він уже є
--    (INV-003 — засів з `on conflict do update` відкочував би бойовий
--    конфіг застарілим текстом).
update public.elo_config
   set data = jsonb_set(data, '{partialNutritionCap}', '0.85'::jsonb, true)
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
      -- pTarget пишеться з етапу «authoritative ELO». Його немає у старих
      -- записах І в приблизних днях без білка — тоді калорії беруть усю
      -- вагу категорії (див. elo_action_delta).
      'proteinTarget', greatest(0, public.elo_num(rec->'pTarget', 0)),
      -- Приблизний запис: одне число рукою замість розбору по грамах.
      'partial',       coalesce((rec->>'partial')::boolean, false));

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
    -- Стеля приблизного дня. coalesce на 1 — щоб конфіг без ключа поводився
    -- рівно як до цієї міграції, а не обнуляв категорію.
    if coalesce((payload->>'partial')::boolean, false) then
      m := least(m, coalesce((cfg->>'partialNutritionCap')::numeric, 1));
    end if;
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
