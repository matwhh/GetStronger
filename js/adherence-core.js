/**
 * Ядро «наскільки добре я виконую свій план» — чисті функції, без DOM.
 *
 * Два числа для сторінки прогресу:
 *
 *   тренування — сума ЧАСТОК виконання сесій проти кількості запланованих
 *     тренувань за період. Частка сесії = закриті/планові підходи (нові
 *     записи) або закриті/планові вправи (старі). Пропущене тренування
 *     важить нуль — тож 10/10, 7/10 і пропуск дають (1 + 0.7 + 0)/3, а не
 *     «два з трьох були». Це та сама модель, якою сервер ELO оцінює
 *     тиждень, лише в відсотках і за довільний період.
 *
 *   харчування — середня ЯКІСТЬ закритих днів раціону проти цілі дня.
 *     Якість рахує window.EloCore.actionDelta('meal') — та сама формула
 *     tolerance-зон, якою сервер нараховує рейтинг: 96% калорій ≈ повне
 *     попадання, 160% — ні; «зʼїв удвічі більше» НЕ означає «виконав план
 *     на 200%». День без запису після старту ведення — нуль: не записав =
 *     не виконав. Ціль береться З ЗАПИСУ дня (вона зафіксована в момент
 *     закриття), тож пізніша зміна плану історію не переписує.
 *
 * ЧЕСНІ МЕЖІ. Період обрізається до першого реального запису журналу:
 * людина, що почала вести Get Stronger тиждень тому, за «рік» бачить свій
 * тиждень, а не 2% через 358 порожніх днів (нема даних ≠ поганий
 * результат). «День» — окремий випадок: без сьогоднішньої сесії/закритого
 * дня показується стан «ще нічого», а не 0%.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  /* Окремо з групами: DATE_KEY — для .test, PARSE — для читання чисел */
  const DATE_PARSE = /^(\d{4})-(\d{2})-(\d{2})$/;

  /** Періоди перемикача — спільні для обох карток */
  const PERIODS = [
    { days: 1,   label: 'День' },
    { days: 7,   label: 'Тиждень' },
    { days: 30,  label: 'Місяць' },
    { days: 90,  label: '3 міс' },
    { days: 180, label: '6 міс' },
    { days: 270, label: '9 міс' },
    { days: 365, label: 'Рік' }
  ];

  /*
   * Запасний конфіг tolerance-зон харчування — ДЗЕРКАЛО db/elo-config.json.
   * Використовується лише коли живий конфіг сервера недоступний (локальний
   * режим, офлайн): формула та сама, числа ті самі. Міняється баланс на
   * сервері — оновити й тут.
   */
  const DEFAULT_CFG = {
    weeklyBudget: 200, categoryShare: 0.857,
    weights: { training: 0.3, nutrition: 0.3, sleep: 0.2, recovery: 0.1, activity: 0.1 },
    nutritionSplit: { kcal: 0.55, protein: 0.45 },
    tolerance: {
      kcalBand: [[0.02, 1.0], [0.05, 0.82], [0.1, 0.5], [0.2, 0.45], [0.35, 0.15], [1, 0.05]],
      protein:  [[0.99, 1.0], [0.95, 0.82], [0.85, 0.5], [0.7, 0.45], [0.5, 0.15], [0, 0.05]]
    }
  };

  /* ---------------- дати (локальний календар, як усі журнали) --------- */

  /* Делегат: єдина реалізація — js/date-core.js. Сміття тут повертає сам
     ключ (як і раніше), а не порожнечу: виклики вище передають його далі
     як межу діапазону, і порожній рядок зробив би діапазон нескінченним. */
  function addDays(key, n) {
    return window.DateCore.shiftKey(key, n) || key;
  }

  /** Різниця в днях між ISO-ключами (b − a) */
  function diffDays(a, b) {
    const pa = DATE_PARSE.exec(a), pb = DATE_PARSE.exec(b);
    if (!pa || !pb) return 0;
    const da = new Date(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
    const db = new Date(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
    return Math.round((db - da) / 86400000);
  }

  /** Найраніший датований ключ журналу, або null */
  function firstDate(log) {
    if (!log || typeof log !== 'object') return null;
    let min = null;
    Object.keys(log).forEach(function (k) {
      if (!DATE_KEY.test(k)) return;
      if (min === null || k < min) min = k;
    });
    return min;
  }

  /* ---------------- тренування ---------------------------------------- */

  /** Частка виконання сесії 0..1: підходи, коли записані; інакше вправи */
  function completionOf(s) {
    if (!s || typeof s !== 'object') return 0;
    const ts = Number(s.totalSets), ds = Number(s.doneSets);
    if (Number.isFinite(ts) && ts > 0) {
      return Math.min(1, Math.max(0, (Number.isFinite(ds) ? ds : 0) / ts));
    }
    const t = Number(s.total), d = Number(s.done);
    if (Number.isFinite(t) && t > 0) {
      return Math.min(1, Math.max(0, (Number.isFinite(d) ? d : 0) / t));
    }
    return 0;
  }

  function plannedDaysOf(profile) {
    const a = (profile && profile.activePlan) || {};
    const n = Number(a.days) || Number(profile && profile.daysPerWeek) || 0;
    return Math.min(7, Math.max(0, Math.round(n)));
  }

  /**
   * Виконання плану тренувань за останні `days` днів (включно з сьогодні).
   * @returns {{state:string, pct?:number, sessions?:number, expected?:number,
   *            doneSets?:number, totalSets?:number, effDays?:number}}
   *   state: 'ok' | 'noplan' | 'nodata' | 'resttoday' (лише для days=1)
   */
  function trainingAdherence(profile, todayK, days) {
    const planned = plannedDaysOf(profile);
    if (!planned) return { state: 'noplan' };
    const log = (profile && profile.sessionLog) || {};
    const first = firstDate(log);
    if (!first || first > todayK) return { state: 'nodata' };

    if (Number(days) === 1) {
      const s = log[todayK];
      if (!s || typeof s !== 'object') return { state: 'resttoday' };
      const c = completionOf(s);
      return {
        state: 'ok', pct: Math.round(c * 100), sessions: 1, expected: 1,
        doneSets: Number(s.doneSets) || 0, totalSets: Number(s.totalSets) || 0, effDays: 1
      };
    }

    const start = (function () {
      const winStart = addDays(todayK, -(Number(days) - 1));
      return winStart > first ? winStart : first;
    })();
    const effDays = diffDays(start, todayK) + 1;
    /*
     * Очікувані сесії — ЦІЛЕ число, не дріб.
     *
     * Було planned × днів / 7 без округлення: два дні даних при плані
     * 5/тиж давали «очікувано 1,43 сесії», і одне повне тренування
     * оцінювалось у 70 % — за «недороблені 0,43 сесії», яких у два дні
     * фізично не буває. Ціле очікування + мінімум 1: перший тиждень
     * ведення показує чесний відсоток від того, що реально можна було
     * зробити, а на повному тижні число те саме, що й було.
     */
    const expected = Math.max(1, Math.round(planned * effDays / 7));

    let sum = 0, n = 0, ds = 0, ts = 0;
    Object.keys(log).forEach(function (d) {
      if (!DATE_KEY.test(d) || d < start || d > todayK) return;
      const s = log[d];
      if (!s || typeof s !== 'object') return;
      sum += completionOf(s);
      n += 1;
      ds += Number(s.doneSets) || 0;
      ts += Number(s.totalSets) || 0;
    });

    if (!n && effDays < 2) return { state: 'nodata' };
    const pct = expected > 0 ? Math.min(100, Math.round(sum / expected * 100)) : 0;
    return {
      state: 'ok', pct: pct, sessions: n,
      expected: expected,
      doneSets: ds, totalSets: ts, effDays: effDays
    };
  }

  /* ---------------- харчування ---------------------------------------- */

  /** Якість закритого дня 0..1 тією самою формулою, що й сервер ELO */
  function mealQuality(rec, cfg) {
    if (!rec || typeof rec !== 'object') return null;
    const target = Number(rec.target) || 0;
    if (target <= 0) return null;
    const EC = window.EloCore;
    if (!EC || !EC.actionDelta) return null;
    const r = EC.actionDelta('meal', {
      kcal: Number(rec.kcal) || 0,
      target: target,
      protein: Number(rec.p) || 0,
      proteinTarget: Number(rec.pTarget) || 0
    }, cfg || DEFAULT_CFG, {});
    return Math.min(1, Math.max(0, Number(r && r.quality) || 0));
  }

  /**
   * Виконання плану харчування за останні `days` днів.
   * Сьогодні входить лише ЗАКРИТИМ днем: відкритий день триває і нулем
   * не карається. День без запису після старту ведення — нуль.
   * @returns state: 'ok' | 'nodata' | 'openday' (лише для days=1)
   */
  function nutritionAdherence(profile, todayK, days, cfg) {
    const log = (profile && profile.mealLog) || {};
    const first = firstDate(log);
    if (!first || first > todayK) return { state: 'nodata' };

    if (Number(days) === 1) {
      const q = mealQuality(log[todayK], cfg);
      if (q === null) return { state: 'openday' };
      return { state: 'ok', pct: Math.round(q * 100), closed: 1, counted: 1 };
    }

    const winStart = addDays(todayK, -(Number(days) - 1));
    const start = winStart > first ? winStart : first;

    let sum = 0, counted = 0, closed = 0;
    for (let d = start; d <= todayK; d = addDays(d, 1)) {
      const q = mealQuality(log[d], cfg);
      if (d === todayK && q === null) continue;   // сьогодні ще не закрито
      counted += 1;
      if (q !== null) { sum += q; closed += 1; }
    }
    if (!counted) return { state: 'nodata' };
    return {
      state: 'ok', pct: Math.round(sum / counted * 100),
      closed: closed, counted: counted
    };
  }

  window.AdherenceCore = {
    PERIODS: PERIODS,
    DEFAULT_CFG: DEFAULT_CFG,
    addDays: addDays,
    diffDays: diffDays,
    firstDate: firstDate,
    completionOf: completionOf,
    plannedDaysOf: plannedDaysOf,
    mealQuality: mealQuality,
    trainingAdherence: trainingAdherence,
    nutritionAdherence: nutritionAdherence
  };
})();
