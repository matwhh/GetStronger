/**
 * Діапазони повторень — ЄДИНЕ джерело правди.
 *
 * Правило: стаж тренувань + розмір цільової мʼязової групи → діапазон.
 *
 *   Стаж            | Великі групи | Малі групи
 *   ----------------+--------------+-----------
 *   До 1 року       |     8–10     |   10–12
 *   1–2 роки        |     8–10     |   10–12
 *   3–5 років       |     6–8      |   8–10
 *   Понад 5 років   |     6–8      |   8–10
 *
 * Великі групи (груди, спина, квадрицепс, біцепс стегна, сідниці) й малі
 * (усе інше: дельти, руки, ікри, прес, …) НЕ класифікуються тут заново:
 * розмір лежить у MUSCLES (js/exercises.js, поле size), а цільову групу
 * вправи визначає window.primaryMuscle — перша в masсиві muscles. Це ті
 * самі дані, якими вже живуть тижневий обʼєм і час відпочинку.
 *
 * Застосування централізоване: applyPlan() викликають рівно дві точки —
 * loadPlan/basePlan (js/programs.js: «Плани тренувань», «Мій план») і
 * resolvePlan (js/workout-core.js: «Сьогодні», «Тренування»). Усі чотири
 * типи програм (Full Body, U/L, PPL, UL/PPL) проходять через них, тож
 * окремої логіки на програму немає і бути не може.
 *
 * Чому діапазон НЕ зберігається у профілі: reps — похідне від стажу, а не
 * факт. Зміниш стаж — план перерахується сам при наступному завантаженні,
 * включно зі старими збереженими правками (customPlans): у них reps теж
 * переписується на льоту, бо збережене там значення могло бути пораховане
 * за старим стажем.
 */
(function () {
  'use strict';

  /* Два яруси, а не чотири: перші дві категорії стажу мають однакові
     діапазони, останні дві — теж. Таблиця вище — джерело правди. */
  const RANGES = {
    beginner: { large: '8–10', small: '10–12' },
    advanced: { large: '6–8',  small: '8–10' }
  };

  const TIER_OF = { novice: 'beginner', inter: 'beginner', adv: 'advanced', elite: 'advanced' };

  /**
   * Ярус за стажем. Невідомий/відсутній стаж — 'beginner': безпечний
   * запасний варіант для старих профілів, де trainingAge ще не вказано
   * (вищі повторення з меншою вагою — консервативніший вибір).
   */
  function tierFor(trainingAge) {
    return TIER_OF[trainingAge] || 'beginner';
  }

  /** Розмір цільової групи вправи за наявними даними MUSCLES. */
  function sizeOf(ex) {
    const main = typeof window.primaryMuscle === 'function' ? window.primaryMuscle(ex) : null;
    const m = (window.MUSCLES || []).find(function (x) { return x.id === main; });
    return m && m.size === 'large' ? 'large' : 'small';
  }

  /** Діапазон для однієї вправи. */
  function repRangeFor(trainingAge, ex) {
    return RANGES[tierFor(trainingAge)][sizeOf(ex)];
  }

  /**
   * План із перерахованими reps. Повертає НОВІ обʼєкти днів і вправ:
   * resolvePlan віддає посилання прямо в PROGRAMS/customPlans, і запис у
   * них зіпсував би базові дані програм на весь сеанс.
   *
   * Без MUSCLES (сторінка без js/exercises.js) план повертається як є —
   * краще авторські reps, ніж вигадана класифікація.
   */
  function applyPlan(plan, trainingAge) {
    if (!Array.isArray(plan) || !window.MUSCLES) return plan;
    return plan.map(function (day) {
      if (!day || !Array.isArray(day.exercises)) return day;
      return Object.assign({}, day, {
        exercises: day.exercises.map(function (ex) {
          return Object.assign({}, ex, { reps: repRangeFor(trainingAge, ex) });
        })
      });
    });
  }

  window.RepsCore = {
    RANGES: RANGES,
    tierFor: tierFor,
    sizeOf: sizeOf,
    repRangeFor: repRangeFor,
    applyPlan: applyPlan
  };
})();
