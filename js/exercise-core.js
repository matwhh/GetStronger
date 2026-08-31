/**
 * Прогрес окремої вправи — чисті функції, без DOM.
 *
 * ДЖЕРЕЛО. Знімки сесій: sessionLog[дата].ex = [{n, ds, ps, kg, r}], які
 * пишуться в момент тренування (js/workout.js). Кожна точка графіка — це
 * РЕАЛЬНЕ тренування, а не запис у книзі ваг: людина могла змінити вагу в
 * плані й не піти в зал, і така зміна не є прогресом.
 *
 * ЧОГО ТУТ НЕМАЄ. Знімки зʼявились разом із відміткою по підходах, тож
 * історія починається з того релізу, а не з першого дня Forge. Це чесна
 * межа даних: nodata-стан краще, ніж графік, зібраний із книги ваг і
 * виданий за історію тренувань. Довшу історію САМОЇ ВАГИ показує
 * окремий блок «Робочі ваги» (ProgressCore.liftStats на weightLog).
 *
 * МЕТРИКИ однієї точки:
 *   kg    робоча вага того дня;
 *   sets  закриті підходи (не заплановані);
 *   reps  повторення разом: sets × середина діапазону;
 *   vol   тоннаж: sets × повторення × вага;
 *   e1rm  оцінка разового максимуму (js/onerm-core.js, медіана формул).
 *
 * Вправи без ваги (планка, прес) чесно дають vol = 0 і e1rm = null:
 * їх видно в підходах і повтореннях, але не в тоннажі.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  /** Метрики перемикача. value — ключ точки, unit — підпис осі. */
  const METRICS = [
    { id: 'kg',   label: 'Вага',    unit: 'кг',  digits: 1 },
    { id: 'vol',  label: 'Обʼєм',   unit: 'кг',  digits: 0 },
    { id: 'reps', label: 'Повтори', unit: '',    digits: 0 },
    { id: 'e1rm', label: '1ПМ',     unit: 'кг',  digits: 1 }
  ];

  function isMetric(id) {
    return METRICS.some(function (m) { return m.id === id; });
  }

  /** Оцінка разового максимуму, або null (немає ваги / немає повторень) */
  function e1rmOf(kg, reps) {
    const OR = window.OneRM;
    if (!OR || !OR.oneRepMax) return null;
    const v = OR.oneRepMax(kg, reps);
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  }

  /**
   * Точка серії з рядка знімка. null, якщо в цій сесії вправу не робили
   * (ds = 0) — «був у залі й пропустив жим» не є точкою прогресу жиму.
   */
  function pointOf(date, row) {
    if (!row || typeof row !== 'object') return null;
    const sets = Math.max(0, Math.round(Number(row.ds) || 0));
    if (!sets) return null;

    const kg = Number(row.kg);
    const hasKg = Number.isFinite(kg) && kg > 0;
    const per = Number(row.r);
    const hasReps = Number.isFinite(per) && per > 0;

    const reps = hasReps ? Math.round(sets * per) : 0;
    const vol = (hasKg && hasReps) ? Math.round(sets * per * kg) : 0;

    return {
      d: date,
      kg: hasKg ? kg : null,
      sets: sets,
      perSet: hasReps ? per : null,
      reps: reps,
      vol: vol,
      e1rm: (hasKg && hasReps) ? e1rmOf(kg, per) : null
    };
  }

  /**
   * Усі вправи, за якими є бодай одна точка. Порядок — за свіжістю
   * останнього тренування: те, що робив учора, має бути першим у списку.
   */
  function exerciseNames(sessionLog) {
    if (!sessionLog || typeof sessionLog !== 'object') return [];
    const last = Object.create(null);
    Object.keys(sessionLog).forEach(function (d) {
      if (!DATE_KEY.test(d)) return;
      const s = sessionLog[d];
      if (!s || !Array.isArray(s.ex)) return;
      s.ex.forEach(function (row) {
        const p = pointOf(d, row);
        if (!p || !row.n) return;
        if (!last[row.n] || d > last[row.n]) last[row.n] = d;
      });
    });
    return Object.keys(last).sort(function (a, b) {
      if (last[a] !== last[b]) return last[a] < last[b] ? 1 : -1;
      return a < b ? -1 : 1;
    });
  }

  /**
   * Серія точок вправи за вікном [fromKey..toKey], у хронології.
   * fromKey/toKey необовʼязкові — без них береться вся історія.
   */
  function series(sessionLog, name, fromKey, toKey) {
    if (!sessionLog || typeof sessionLog !== 'object' || !name) return [];
    const out = [];
    Object.keys(sessionLog).forEach(function (d) {
      if (!DATE_KEY.test(d)) return;
      if (fromKey && d < fromKey) return;
      if (toKey && d > toKey) return;
      const s = sessionLog[d];
      if (!s || !Array.isArray(s.ex)) return;
      /* Одна вправа може стояти в дні двічі (різні варіації однієї назви
         редактор не дає, але імпортований профіль — може). Беремо кращий
         за обʼємом рядок: це та робота, яку людина реально зробила. */
      let best = null;
      s.ex.forEach(function (row) {
        if (row && row.n === name) {
          const p = pointOf(d, row);
          if (p && (!best || p.vol > best.vol || (p.vol === best.vol && p.sets > best.sets))) best = p;
        }
      });
      if (best) out.push(best);
    });
    return out.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
  }

  /** Значення метрики точки; null — метрика для цієї точки невідома */
  function valueOf(point, metric) {
    if (!point) return null;
    const v = point[metric];
    return Number.isFinite(v) ? v : null;
  }

  /**
   * Підсумок серії за метрикою.
   * @returns null, якщо жодна точка метрики не має (вправа без ваги в
   *   режимі «Вага» — це не нуль, це «незастосовно»).
   */
  function stats(list, metric) {
    const pts = (list || []).filter(function (p) { return valueOf(p, metric) !== null; });
    if (!pts.length) return null;

    const cur = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const curV = valueOf(cur, metric);
    const prevV = prev ? valueOf(prev, metric) : null;

    let best = pts[0];
    pts.forEach(function (p) { if (valueOf(p, metric) > valueOf(best, metric)) best = p; });

    const delta = prevV === null ? null : Math.round((curV - prevV) * 10) / 10;
    const pct = (prevV === null || prevV === 0)
      ? null
      : Math.round((curV - prevV) / prevV * 1000) / 10;

    return {
      current: curV, currentDate: cur.d,
      previous: prevV, previousDate: prev ? prev.d : null,
      delta: delta, pct: pct,
      pr: valueOf(best, metric), prDate: best.d,
      /* Рекорд саме сьогодні — привід сказати «PR», а не просто «поточне» */
      isPr: best.d === cur.d && pts.length > 1,
      count: pts.length,
      points: pts
    };
  }

  /**
   * Напрям руху за метрикою: порівнюємо середнє ПЕРШОЇ та ОСТАННЬОЇ
   * третини серії, а не дві сусідні точки — один важкий день не є трендом.
   * Поріг 2% відсікає шум округлень і дрібні коливання ваги.
   * @returns 'up' | 'down' | 'flat' | null (замало точок)
   */
  function trend(list, metric) {
    const pts = (list || []).filter(function (p) { return valueOf(p, metric) !== null; });
    if (pts.length < 3) return null;
    const n = Math.max(1, Math.floor(pts.length / 3));
    const avg = function (arr) {
      return arr.reduce(function (a, p) { return a + valueOf(p, metric); }, 0) / arr.length;
    };
    const first = avg(pts.slice(0, n));
    const lastA = avg(pts.slice(-n));
    if (first === 0) return lastA > 0 ? 'up' : 'flat';
    const rel = (lastA - first) / Math.abs(first);
    if (rel > 0.02) return 'up';
    if (rel < -0.02) return 'down';
    return 'flat';
  }

  window.ExerciseCore = {
    METRICS: METRICS,
    isMetric: isMetric,
    pointOf: pointOf,
    exerciseNames: exerciseNames,
    series: series,
    valueOf: valueOf,
    stats: stats,
    trend: trend
  };
})();
