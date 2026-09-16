/**
 * Адаптивні витрати: підтримання, ВИМІРЯНЕ по факту.
 *
 * Формула Міффліна (js/nutrition-core.js) бере зріст, вагу, вік і
 * коефіцієнт активності, обраний один раз на онбордингу. Вона за
 * визначенням не знає, що людина перейшла з трьох тренувань на пʼять,
 * почала ходити пішки або має обмін повільніший за середній. Похибка
 * формули на окремій людині — сотні калорій, і це не недолік формули:
 * вона описує СЕРЕДНЮ людину, якої в житті не буває.
 *
 * Натомість арифметика балансу чесна й коротка:
 *
 *     підтримання = середнє спожите − (зміна ваги × 7700 / дні)
 *
 * Тобто: їв 2500, за три тижні втратив кілограм — отже витрачав більше,
 * ніж їв, рівно на той кілограм, поділений на дні.
 *
 * ЧОГО ЦЕЙ МОДУЛЬ НЕ РОБИТЬ. Він нічого не радить і нічого не зберігає.
 * Він також не існує для того, хто не веде харчування: без закритих днів
 * немає першого доданка, і функція чесно віддає null. Це вимога, а не
 * обмеження — нічого в застосунку не має карати за невведення їжі.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  /* Енергоємність жирової тканини. ТЕ САМЕ число, що в
     js/nutrition-core.js (KCAL_PER_KG_FAT): друга константа з тим самим
     змістом розійшлася б із першою на першій же правці. */
  const KCAL_PER_KG = 7700;

  /* Вікно: коротше за два тижні не рахуємо взагалі. Вода, глікоген і
     сіль рухають вагу на ±1,5 кг незалежно від жиру, і на тижневому
     вікні цей шум більший за сам сигнал. */
  const MIN_DAYS = 14;

  /* Скільки днів харчування має бути закрито, часткою від вікна.
     Менше — результату немає, а не результат зі зіркою: середнє з
     половини днів описує цю половину, а не місяць. */
  const MIN_MEAL_SHARE = 0.7;

  /* Зважувань у крайніх тижнях вікна. Один запис на край — це один
     ранок, тобто одна випадкова цифра; два вже усереднюються. */
  const MIN_EDGE_WEIGHTS = 2;

  /*
   * Шум одного ТИЖНЕВОГО СЕРЕДНЬОГО, кг. Практична конвенція, не
   * висновок дослідження: денна вага гуляє на ±1–1,5 кг, тижневе
   * середнє з кількох зважувань — приблизно вчетверо менше.
   *
   * Із нього й береться смуга: різниця двох середніх має шум у корінь
   * із двох разів більший, а кожен кілограм похибки коштує 7700 ккал,
   * поділених на довжину проміжку. Тому на двох тижнях смуга виходить
   * удвічі ширшою, ніж на чотирьох, — і це правда про дані, а не
   * песимізм.
   */
  const WEIGHT_NOISE_KG = 0.4;

  function dayKeys(log, fromKey, toKey) {
    return Object.keys(log || {})
      .filter(function (k) { return DATE_KEY.test(k) && k >= fromKey && k <= toKey; })
      .sort();
  }

  /** Середнє валідних ваг за перелічені дні, або null */
  function avgWeight(bodyLog, keys) {
    let sum = 0, n = 0;
    keys.forEach(function (k) {
      const v = Number(bodyLog[k]);
      if (Number.isFinite(v) && v > 20 && v < 400) { sum += v; n += 1; }
    });
    return n ? { kg: sum / n, n: n } : null;
  }

  /** Середина списку днів як дата (для довжини проміжку між краями) */
  function midDate(keys) {
    const D = window.DateCore;
    const a = D.dateOf(keys[0]).getTime();
    const b = D.dateOf(keys[keys.length - 1]).getTime();
    return (a + b) / 2;
  }

  /**
   * Виміряне підтримання за вікном у `days` днів, що закінчується
   * сьогодні.
   *
   * Зміна ваги береться між СЕРЕДНІМИ за перший і останній тиждень
   * вікна, а не між двома точками: одна вага — це один ранок і одна
   * випадкова цифра. Спожите усереднюється по всьому вікну; проміжок,
   * на який ділиться зміна, — відстань між серединами крайніх тижнів.
   * Це наближення, і воно свідоме: точніша модель вимагала б регресії
   * по всіх днях, а даних для неї в реальному журналі однаково немає.
   *
   * @param {object} bodyLog вага тіла по днях
   * @param {object} mealLog закриті дні харчування
   * @param {number} days    вікно (14 або 28)
   * @param {Date}   [now]   «сьогодні» — аргументом, щоб тести не
   *                         залежали від дня запуску
   * @returns {?object} {kcal, lo, hi, days, mealDays, intake, deltaKg,
   *                     spanDays, confidence}
   */
  function measure(bodyLog, mealLog, days, now) {
    const D = window.DateCore;
    if (!D) return null;
    const win = Math.round(Number(days) || 0);
    if (!(win >= MIN_DAYS)) return null;

    const today = now instanceof Date ? now : new Date();
    const toKey = D.keyOf(today);
    const fromKey = D.shiftKey(toKey, -(win - 1));

    /* ---- спожите ---- */
    const mealKeys = dayKeys(mealLog, fromKey, toKey).filter(function (k) {
      const v = Number((mealLog[k] || {}).kcal);
      return Number.isFinite(v) && v > 0;
    });
    if (mealKeys.length < Math.ceil(win * MIN_MEAL_SHARE)) return null;
    const intake = mealKeys.reduce(function (s, k) {
      return s + Number(mealLog[k].kcal);
    }, 0) / mealKeys.length;

    /* ---- зміна ваги ---- */
    const edge = 7;
    const headKeys = dayKeys(bodyLog, fromKey, D.shiftKey(fromKey, edge - 1));
    const tailKeys = dayKeys(bodyLog, D.shiftKey(toKey, -(edge - 1)), toKey);
    const head = avgWeight(bodyLog, headKeys);
    const tail = avgWeight(bodyLog, tailKeys);
    if (!head || !tail) return null;
    if (head.n < MIN_EDGE_WEIGHTS || tail.n < MIN_EDGE_WEIGHTS) return null;

    const spanDays = (midDate(tailKeys) - midDate(headKeys)) / 86400000;
    if (!(spanDays >= 7)) return null;

    const deltaKg = tail.kg - head.kg;
    const kcal = intake - (deltaKg * KCAL_PER_KG / spanDays);
    if (!Number.isFinite(kcal) || kcal <= 0) return null;

    /* ---- смуга ---- */
    const noise = WEIGHT_NOISE_KG * Math.SQRT2;          // шум різниці двох середніх
    const band = noise * KCAL_PER_KG / spanDays;

    /* Впевненість — про ДАНІ, не про число. Повне чотиритижневе вікно
       дає вужчу смугу й більше зважувань, ніж дві тижні з дірками, і
       людина має бачити різницю, а не однаково впевнене число. */
    const coverage = mealKeys.length / win;
    let confidence = 'low';
    if (win >= 28 && coverage >= 0.9 && head.n >= 3 && tail.n >= 3) confidence = 'high';
    else if (win >= 14 && coverage >= 0.8) confidence = 'mid';

    return {
      kcal: Math.round(kcal),
      lo: Math.round(kcal - band),
      hi: Math.round(kcal + band),
      days: win,
      mealDays: mealKeys.length,
      weightDays: head.n + tail.n,
      intake: Math.round(intake),
      deltaKg: Math.round(deltaKg * 100) / 100,
      /* Вага, при якій це виміряли (середня за останній тиждень).
         Без неї число не можна перенести: витрати падають разом із
         масою, і прогноз на пів року, порахований від сьогоднішнього
         підтримання, систематично завищував би. */
      refKg: Math.round(tail.kg * 10) / 10,
      spanDays: Math.round(spanDays * 10) / 10,
      confidence: confidence
    };
  }

  /*
   * Наскільки формула схибила. Поріг у 100 ккал — не статистика, а
   * практика: менша різниця тоне у власній смузі вимірювання й у
   * похибці зважування, і показувати її означало б змушувати людину
   * реагувати на шум.
   */
  const MATTERS_KCAL = 100;

  /** @returns {?{measured:number, formula:number, diff:number, matters:boolean}} */
  function compare(measured, formulaKcal) {
    const f = Number(formulaKcal);
    if (!measured || !Number.isFinite(f) || f <= 0) return null;
    const diff = measured.kcal - f;
    return {
      measured: measured.kcal,
      formula: Math.round(f),
      diff: Math.round(diff),
      matters: Math.abs(diff) >= MATTERS_KCAL
    };
  }

  window.TdeeCore = {
    KCAL_PER_KG: KCAL_PER_KG,
    MIN_DAYS: MIN_DAYS,
    MIN_MEAL_SHARE: MIN_MEAL_SHARE,
    MATTERS_KCAL: MATTERS_KCAL,
    measure: measure,
    compare: compare
  };
})();
