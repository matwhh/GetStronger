-- ============================================================================
-- ПЕРЕКРИТО: elo-partial-cap.sql. НЕ ЗАПУСКАТИ ПО БОЙОВІЙ БАЗІ.
-- ============================================================================
-- Обидва тіла — elo_facts і elo_action_delta — старіші за базу.
--
-- Файл лишається як історія: він пояснює, ЧОМУ база стала такою. Що в
-- ній зараз — db/live-schema.sql. Як міняти базу — db/README.md.
-- Позначку звіряє tools/ci-hygiene.mjs (перевірки 8 і 21).
-- ============================================================================

-- =============================================================================
-- ELO: пропорційне нарахування за тренування + частка по ПІДХОДАХ
-- =============================================================================
-- Міграція elo_proportional_workout. Виконується поверх db/elo-authoritative.sql.
--
-- ЩО ЗМІНЮЄТЬСЯ.
--
--   1. Тренування більше не оцінюється драбиною tolerance.training
--      (0.99→100%, 0.9→45%, 0.5→12%…), а ЛІНІЙНО:
--
--          earned = baseWorkoutElo × done / total
--
--      де baseWorkoutElo — та сама вартість дня, що й була:
--      weeklyBudget × categoryShare × weights.training / planned_days.
--      Половина тренування тепер чесно коштує половину, а не 12%.
--      Драбини ІНШИХ категорій (сон, білок, кроки…) не чіпаються.
--
--   2. Частка рахується по ПІДХОДАХ (doneSets/totalSets із sessionLog),
--      коли запис їх має — це нова форма журналу зі сторінки тренування.
--      Старі записи без підходів рахуються по вправах (done/total), як досі.
--
-- ЩО НЕ ЗМІНЮЄТЬСЯ.
--
--   • Джерело фактів — profiles.data.sessionLog (authoritative), не payload.
--   • Мінімум 3 вправи в дні (floors.workoutTotalMin) — інакше день не
--     тренування і події не існує.
--   • Тижневий бюджет категорії, денна стеля, ідемпотентність за action_key.
--   • Тижнева оцінка: тренування з quality < 0.5 НЕ закриває клітинку плану —
--     завершене з 0 чи 2 підходами з 20 штрафується як пропуск (-8). Це
--     свідомий захист від «тапнув Завершити нуль разів на тиждень — і без
--     штрафів»: кнопка блокує повтор дня, але не оплачує тиждень.
--
-- Застосовується З МОМЕНТУ виконання: минулі події не перераховуються
-- (історія незмінна за принципом усього двигуна).
--
-- Дзеркало клієнтської математики: js/elo-core.js → workoutDelta().
-- =============================================================================

-- --------------------------------------------------------------------------
-- Факти дня: workout-гілка додатково віддає підходи, коли вони записані
-- --------------------------------------------------------------------------
create or replace function public.elo_facts(uid uuid, kind text, p_day date, cfg jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
    -- Тренування з однієї-двох вправ — не тренування, а спосіб отримати
    -- повну вартість категорії за мінімальну роботу.
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
    -- Ціль дня записана в момент закриття (js/history-core.js summarizeDay).
    -- Без неї порівнювати немає з чим — дня для ELO не існує.
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
$$;

-- --------------------------------------------------------------------------
-- Дельта дії: workout — лінійно, по підходах коли вони є
-- --------------------------------------------------------------------------
create or replace function public.elo_action_delta(kind text, payload jsonb, cfg jsonb, planned_days integer, grace boolean)
 returns table(quality numeric, delta integer)
 language plpgsql immutable set search_path to 'public'
as $function$
declare
  weekly numeric := (cfg->>'weeklyBudget')::numeric * (cfg->>'categoryShare')::numeric;
  daily  numeric;
  q numeric := 0; m numeric := 0; d numeric := 0;
  target numeric; ptarget numeric; dev numeric; qk numeric := 0; qp numeric := 0;
  ksh numeric; psh numeric;
begin
  if kind = 'workout' then
    if grace then quality := 0; delta := 0; return next; return; end if;
    -- Частка по підходах точніша за частку по вправах: 2 з 4 підходів
    -- жиму — це половина роботи, а не «вправа не закрита, отже нуль».
    if coalesce((payload->>'totalSets')::numeric, 0) > 0 then
      q := least(1, greatest(0, coalesce((payload->>'doneSets')::numeric, 0)
           / (payload->>'totalSets')::numeric));
    else
      q := least(1, greatest(0, coalesce((payload->>'done')::numeric, 0)
           / greatest(1, coalesce((payload->>'total')::numeric, 0))));
    end if;
    -- ЛІНІЙНО, без драбини: earned = base × done/total.
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
