/**
 * FORGE Seasonal ELO — чисте ядро. Без DOM, без мережі, під тестами.
 *
 * Правила гри (ТЗ «Gamification, Seasonal ELO & Account System»):
 *   • сезон ≈ 3 місяці (SPRING 03–05, SUMMER 06–08, AUTUMN 09–11,
 *     WINTER 12–02), кожен починається з 0 ELO;
 *   • 0–2500, рівні по 200 (L1 = 0–199 … L10 = 1800–1999),
 *     2000–2500 — Level 10 ELITE, нового рівня там немає;
 *   • ELO приходить ОДРАЗУ за дію (тренування, закритий день їжі, сон,
 *     recovery, кроки) — не раз на день;
 *   • цінність дії = бюджет категорії × tolerance-крива якості;
 *   • оцінюється ВЛАСНИЙ план: тижневий бюджет тренувань ділиться на
 *     кількість запланованих днів, тож 4/тиж і 6/тиж, виконані на 100%,
 *     коштують однаково;
 *   • Level 10 має бути важким: драбини якості круті (90% виконання — це
 *     0.65 цінності, не 0.9), а бонуси чистого дня/тижня дістаються лише
 *     майже ідеальним — саме вони відділяють perfect від excellent.
 *
 * УСІ числа — у конфігу (db/elo-config.json → таблиця elo_config), тут
 * лише механіка. Авторитетний розрахунок робить сервер (RPC elo_submit з
 * тим самим конфігом); це ядро дає миттєвий показ і симуляцію балансу.
 * Тест еквівалентності ганяє обидві реалізації на одному наборі подій.
 */
(function () {
  'use strict';

  /* ---------------- Сезони ---------------- */

  function seasonOf(d) {
    const m = d.getMonth() + 1, y = d.getFullYear();
    if (m >= 3 && m <= 5) return 'SPRING-' + y;
    if (m >= 6 && m <= 8) return 'SUMMER-' + y;
    if (m >= 9 && m <= 11) return 'AUTUMN-' + y;
    return 'WINTER-' + (m === 12 ? y : y - 1);
  }

  /** Межі сезону за його кодом: [перший день, останній день]. */
  function seasonRange(code) {
    const p = String(code).split('-');
    const y = Number(p[1]);
    switch (p[0]) {
      case 'SPRING': return [new Date(y, 2, 1), new Date(y, 5, 0)];
      case 'SUMMER': return [new Date(y, 5, 1), new Date(y, 8, 0)];
      case 'AUTUMN': return [new Date(y, 8, 1), new Date(y, 11, 0)];
      default:       return [new Date(y, 11, 1), new Date(y + 1, 2, 0)];
    }
  }

  function seasonLabel(code) {
    const p = String(code).split('-');
    const n = { SPRING: 'Весна', SUMMER: 'Літо', AUTUMN: 'Осінь', WINTER: 'Зима' };
    return (n[p[0]] || p[0]) + ' ' + p[1];
  }

  /* ---------------- Рівні ---------------- */

  function levelFor(elo, cfg) {
    const e = clamp(Math.round(Number(elo) || 0), 0, cfg.seasonMax);
    const idx = Math.min(cfg.levelCount, Math.floor(e / cfg.levelSize) + 1);
    const elite = e >= cfg.eliteFloor;
    const floor = (Math.min(idx, cfg.levelCount) - 1) * cfg.levelSize;
    const ceil = elite ? cfg.seasonMax : Math.min(idx * cfg.levelSize, cfg.eliteFloor) - 1;
    return {
      level: Math.min(idx, cfg.levelCount),
      elite: elite,
      name: 'Level ' + Math.min(idx, cfg.levelCount) + (elite ? ' — ELITE' : ''),
      floor: elite ? cfg.eliteFloor : floor,
      ceil: ceil,
      pct: elite
        ? Math.round((e - cfg.eliteFloor) / (cfg.seasonMax - cfg.eliteFloor) * 100)
        : Math.round((e - floor) / cfg.levelSize * 100)
    };
  }

  /* ---------------- Бюджети ---------------- */

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /** Тижневий бюджет категорії в ELO (без бонусної частки). */
  function weeklyBudget(cat, cfg) {
    return cfg.weeklyBudget * cfg.categoryShare * cfg.weights[cat];
  }

  function dailyBudget(cat, cfg) { return weeklyBudget(cat, cfg) / 7; }

  /** Драбина якості: [[поріг, множник], …] згори вниз. */
  function ladder(steps, x) {
    for (let i = 0; i < steps.length; i++) {
      if (x >= steps[i][0]) return steps[i][1];
    }
    return steps[steps.length - 1][1];
  }

  /* ---------------- Дії → якість і дельта ---------------- */
  /*
   * Кожна дія повертає { quality: 0..1 (до драбини), mult: множник,
   * delta: ELO (округлене) }. ctx = { plannedDays, grace } — персональний
   * план і активний grace week.
   */

  /*
   * Тренування — ЛІНІЙНА пропорція, а не драбина: earned = base × done/total
   * (етап «завершення тренування»). Закрив половину підходів — отримав
   * половину вартості дня; драбини лишаються іншим категоріям. Якщо запис
   * має підходи (doneSets/totalSets) — частка рахується по них, це точніше;
   * старі записи без підходів рахуються по вправах, як раніше.
   * Дзеркало серверної elo_action_delta (db/elo-proportional.sql).
   */
  function workoutDelta(payload, cfg, ctx) {
    if (ctx && ctx.grace) return { quality: 0, mult: 0, delta: 0 };
    const bySets = Number(payload.totalSets) > 0;
    const total = Math.max(1, Number(bySets ? payload.totalSets : payload.total) || 0);
    const done = Number(bySets ? payload.doneSets : payload.done) || 0;
    const q = clamp(done / total, 0, 1);
    const per = weeklyBudget('training', cfg) / Math.max(1, Number(ctx && ctx.plannedDays) || 3);
    return { quality: q, mult: q, delta: Math.round(per * q) };
  }

  function mealDelta(payload, cfg) {
    const target = Number(payload.target) || 0;
    const pTarget = Number(payload.proteinTarget) || 0;
    const day = dailyBudget('nutrition', cfg);
    /*
     * Без цільового білка (старі записи до етапу authoritative) калорії
     * беруть УСЮ вагу категорії — як на сервері (db/elo-authoritative.sql,
     * M5): інакше той самий день коштував би тут 55% від серверної оцінки,
     * і оптимістична дельта з adherence розходилися б із рейтингом.
     */
    let kSh = cfg.nutritionSplit.kcal, pSh = cfg.nutritionSplit.protein;
    if (pTarget <= 0) { kSh = 1; pSh = 0; }
    let qK = 0, qP = 0;
    if (target > 0) {
      const dev = Math.abs((Number(payload.kcal) || 0) - target) / target;
      /* Смуга відхилення: менше — краще. Драбина за |відхиленням|. */
      const band = cfg.tolerance.kcalBand;
      let mult = band[band.length - 1][1];
      for (let i = 0; i < band.length; i++) {
        if (dev <= band[i][0]) { mult = band[i][1]; break; }
      }
      qK = mult;
    }
    if (pTarget > 0) {
      qP = ladder(cfg.tolerance.protein, clamp((Number(payload.protein) || 0) / pTarget, 0, 1));
    }
    const mult = qK * kSh + qP * pSh;
    return { quality: mult, mult: mult, delta: Math.round(day * mult) };
  }

  function sleepDelta(payload, cfg) {
    const goal = Math.max(1, Number(payload.goal) || 480);
    const q = clamp((Number(payload.minutes) || 0) / goal, 0, 1);
    const mult = ladder(cfg.tolerance.sleep, q);
    return { quality: q, mult: mult, delta: Math.round(dailyBudget('sleep', cfg) * mult) };
  }

  function recoveryDelta(payload, cfg) {
    /* Заповнити трекер — більша частина цінності (звичка помічати стан);
       гарний стан (≥ recoveryGoodValue) — решта. Не карати за чесне
       «мені погано» — інакше трекер брехатиме. */
    const day = dailyBudget('recovery', cfg);
    const filled = payload.value !== null && payload.value !== undefined;
    if (!filled) return { quality: 0, mult: 0, delta: 0 };
    const good = Number(payload.value) >= cfg.recoveryGoodValue;
    const mult = cfg.recoveryFillShare + (good ? 1 - cfg.recoveryFillShare : 0);
    return { quality: mult, mult: mult, delta: Math.round(day * mult) };
  }

  function activityDelta(payload, cfg) {
    const goal = Math.max(1, Number(payload.goal) || 10000);
    const q = clamp((Number(payload.steps) || 0) / goal, 0, 1);
    const mult = ladder(cfg.tolerance.activity, q);
    return { quality: q, mult: mult, delta: Math.round(dailyBudget('activity', cfg) * mult) };
  }

  const ACTIONS = {
    workout: workoutDelta,
    meal: mealDelta,
    sleep: sleepDelta,
    recovery: recoveryDelta,
    activity: activityDelta
  };

  function actionDelta(kind, payload, cfg, ctx) {
    const fn = ACTIONS[kind];
    if (!fn) return { quality: 0, mult: 0, delta: 0 };
    return fn(payload || {}, cfg, ctx || {});
  }

  /* ---------------- Бонуси і штрафи ---------------- */

  /**
   * Чистий день: усі присутні категорії дня з mult ≥ порога, і категорій
   * не менше 4 (тренувальний день) чи 3 (день відпочинку — без training).
   */
  function cleanDay(dayMults, isTrainingDay, cfg) {
    const need = ['nutrition', 'sleep', 'recovery', 'activity'].concat(isTrainingDay ? ['training'] : []);
    return need.every(function (c) { return (dayMults[c] || 0) >= cfg.cleanThreshold; });
  }

  /** Штраф тижня: недобір тренувань проти плану. grace вимикає. */
  function weekPenalty(workoutsDone, plannedDays, graceDaysInWeek, cfg) {
    const graceShare = clamp((Number(graceDaysInWeek) || 0) / 7, 0, 1);
    const expected = Math.round(plannedDays * (1 - graceShare));
    const missed = Math.max(0, expected - (Number(workoutsDone) || 0));
    return missed === 0 ? 0 : missed * cfg.missedWorkoutPenalty; // без -0
  }

  /** Чистий тиждень: план закритий повністю, без штрафів. */
  function cleanWeek(workoutsDone, plannedDays, mealDaysClosed, cfg) {
    return workoutsDone >= plannedDays && mealDaysClosed >= 7 ? cfg.cleanWeekBonus : 0;
  }

  /** Застосувати денні межі і стелю сезону. */
  function applyDayCaps(deltas, cfg) {
    const sum = deltas.reduce(function (a, d) { return a + d; }, 0);
    return clamp(sum, cfg.dayLossFloor, cfg.dayGainCap);
  }

  function clampElo(elo, cfg) { return clamp(Math.round(elo), 0, cfg.seasonMax); }

  window.EloCore = {
    seasonOf: seasonOf,
    seasonRange: seasonRange,
    seasonLabel: seasonLabel,
    levelFor: levelFor,
    weeklyBudget: weeklyBudget,
    dailyBudget: dailyBudget,
    ladder: ladder,
    actionDelta: actionDelta,
    cleanDay: cleanDay,
    weekPenalty: weekPenalty,
    cleanWeek: cleanWeek,
    applyDayCaps: applyDayCaps,
    clampElo: clampElo
  };
})();
