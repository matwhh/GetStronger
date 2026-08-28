/**
 * Ядро історії — чисті функції, без DOM і без сховища.
 *
 * Етап «памʼяті» додає профілю три журнали, і всі три пишуться та
 * читаються ЧЕРЕЗ ЦЕЙ МОДУЛЬ, щоб форма записів не розповзлась по
 * сторінках:
 *
 *   weightLog:  { 'Назва вправи': [ { d:'YYYY-MM-DD', kg:100 }, … ] }
 *               Історія робочих ваг. Append-only: нові записи додаються
 *               в кінець, старі не правляться. Виняток один — повторна
 *               зміна В ТОЙ САМИЙ ДЕНЬ замінює сьогоднішній запис:
 *               десять правок ваги за вечір — це одна зміна, а не десять.
 *
 *   sessionLog: { 'YYYY-MM-DD': { programId, days, dayIdx, title, done, total } }
 *               Виконання плану по днях: який день програми робили і
 *               скільки вправ закрито. Один запис на день.
 *
 *   mealLog:    { 'YYYY-MM-DD': { kcal, p, f, c, fiber, target } }
 *               Закриті дні харчування: підсумок дня і ціль, яка діяла
 *               того дня. Ціль зберігається В ЗАПИСІ навмисно: профіль
 *               зміниться, а історія має памʼятати, проти чого їли.
 *
 * Це доповнення до вже наявних журналів bodyLog/workLog (journal.js) —
 * форма та сама: ключ — локальна дата, значення — факт.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  /** Локальна дата 'YYYY-MM-DD'. Локальна, не UTC: запис о 23:40
      має лягти в сьогодні, а toISOString поклав би його у завтра. */
  function todayKey(d) {
    const x = d instanceof Date ? d : new Date();
    return x.getFullYear() + '-' +
      String(x.getMonth() + 1).padStart(2, '0') + '-' +
      String(x.getDate()).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ */
  /* Робочі ваги                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Додати запис ваги. НЕ мутує вхідний журнал — повертає новий обʼєкт
   * (звичка з решти кодової бази: патчі профілю збираються з копій).
   *
   * @param {object} log     поточний weightLog (може бути null)
   * @param {string} name    назва вправи
   * @param {number} kg      нова вага; null/NaN — запис не додається
   * @param {string} [date]  'YYYY-MM-DD'; за замовчуванням сьогодні
   */
  function appendWeight(log, name, kg, date) {
    const d = DATE_KEY.test(date) ? date : todayKey();
    const n = Number(kg);
    const src = (log && typeof log === 'object') ? log : {};
    if (!name || !Number.isFinite(n) || n < 0) return src;

    const prev = Array.isArray(src[name]) ? src[name] : [];
    const last = prev[prev.length - 1];

    // Та сама вага, що й в останньому записі — не подія, а дотик.
    if (last && Number(last.kg) === n) return src;

    const entry = { d: d, kg: n };
    const next = (last && last.d === d)
      ? prev.slice(0, -1).concat([entry])   // сьогоднішня правка сьогоднішнього
      : prev.concat([entry]);

    const out = Object.assign({}, src);
    out[name] = next;
    return out;
  }

  /** Скинути вагу вправи (видалили з плану). Історія ЛИШАЄТЬСЯ:
      видалення вправи з плану не стирає того, що було піднято. */
  function weightSeries(log, name) {
    const arr = log && Array.isArray(log[name]) ? log[name] : [];
    return arr.filter(function (e) {
      return e && DATE_KEY.test(e.d) && Number.isFinite(Number(e.kg));
    });
  }

  /** Дельта по вправі: перший запис, останній, різниця */
  function weightDelta(log, name) {
    const s = weightSeries(log, name);
    if (s.length < 1) return null;
    const first = s[0], last = s[s.length - 1];
    return {
      first: Number(first.kg), firstDate: first.d,
      last: Number(last.kg), lastDate: last.d,
      delta: Math.round((Number(last.kg) - Number(first.kg)) * 10) / 10,
      count: s.length
    };
  }

  /**
   * Вправи журналу, посортовані за давністю останньої зміни (свіже — вище).
   * Саме цей порядок потрібен сторінці прогресу: «що рухалось нещодавно».
   */
  function weightNames(log) {
    if (!log || typeof log !== 'object') return [];
    return Object.keys(log)
      .filter(function (n) { return weightSeries(log, n).length > 0; })
      .sort(function (a, b) {
        const la = weightSeries(log, a), lb = weightSeries(log, b);
        return lb[lb.length - 1].d < la[la.length - 1].d ? -1 : 1;
      });
  }

  /**
   * SVG-шлях спарклайна по серії записів. Чиста геометрія: жодного DOM,
   * тому тестується як звичайна функція.
   * Повертає '' для порожніх/одноточкових серій — крапку малює сторінка.
   */
  function sparklinePath(series, width, height, pad) {
    const s = Array.isArray(series) ? series : [];
    if (s.length < 2) return '';
    const p = Number.isFinite(pad) ? pad : 2;
    const xs = s.map(function (e) { return new Date(e.d + 'T00:00:00').getTime(); });
    const ys = s.map(function (e) { return Number(e.kg); });
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const spanX = (x1 - x0) || 1;
    const spanY = (y1 - y0) || 1;

    return s.map(function (e, i) {
      const x = p + (xs[i] - x0) / spanX * (width - p * 2);
      // y інвертований: більша вага — вище
      const y = y1 === y0
        ? height / 2
        : p + (1 - (ys[i] - y0) / spanY) * (height - p * 2);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Сесії тренувань                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Записати/оновити сесію дня. Один запис на дату: друге тренування
   * того самого дня оновлює прогрес, а не плодить дублікати.
   */
  function upsertSession(log, date, session) {
    const src = (log && typeof log === 'object') ? log : {};
    const d = DATE_KEY.test(date) ? date : todayKey();
    if (!session || typeof session !== 'object') return src;

    const out = Object.assign({}, src);
    out[d] = {
      programId: String(session.programId || ''),
      days: Number(session.days) || 0,
      dayIdx: Number(session.dayIdx) || 0,
      title: String(session.title || '').slice(0, 60),
      done: Math.max(0, Math.round(Number(session.done) || 0)),
      total: Math.max(0, Math.round(Number(session.total) || 0))
    };
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Закриті дні харчування                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Підсумок дня для mealLog. Округлення тут, а не в рендері: історія
   * зберігає те, що показувалось людині, а не сирі дроби.
   * target може бути null — день без порахованої норми теж день.
   */
  function summarizeDay(totals, targetKcal) {
    const t = totals || {};
    const out = {
      kcal: Math.round(Number(t.kcal) || 0),
      p: Math.round(Number(t.p) || 0),
      f: Math.round(Number(t.f) || 0),
      c: Math.round(Number(t.c) || 0),
      fiber: Math.round(Number(t.fiber) || 0)
    };
    const tk = Math.round(Number(targetKcal));
    if (Number.isFinite(tk) && tk > 0) out.target = tk;
    return out;
  }

  /** Закрити день: повертає НОВИЙ mealLog із записом за дату */
  function closeDay(log, date, totals, targetKcal) {
    const src = (log && typeof log === 'object') ? log : {};
    const d = DATE_KEY.test(date) ? date : todayKey();
    const out = Object.assign({}, src);
    out[d] = summarizeDay(totals, targetKcal);
    return out;
  }

  /** Останні N датованих записів будь-якого журналу-мапи, нові — першими */
  function lastEntries(log, n) {
    if (!log || typeof log !== 'object') return [];
    return Object.keys(log)
      .filter(function (k) { return DATE_KEY.test(k); })
      .sort()
      .slice(-Math.max(1, n || 7))
      .reverse()
      .map(function (k) { return { d: k, v: log[k] }; });
  }

  window.HistoryCore = {
    todayKey: todayKey,
    appendWeight: appendWeight,
    weightSeries: weightSeries,
    weightDelta: weightDelta,
    weightNames: weightNames,
    sparklinePath: sparklinePath,
    upsertSession: upsertSession,
    closeDay: closeDay,
    lastEntries: lastEntries
  };
})();
