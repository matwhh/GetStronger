/**
 * Аналітика прогресу — чисті функції над журналами профілю.
 *
 * Джерела правди ті самі, що їх ведуть сторінки (етап памʼяті):
 *   bodyLog    — вага тіла по днях (journal)
 *   weightLog  — серії робочих ваг по вправах (history-core)
 *   workLog    — позначки «був у залі» (таймер/рука)
 *   sessionLog — виконання плану по днях («Сьогодні»)
 *   mealLog    — закриті дні харчування з ціллю свого дня
 *
 * Цей модуль їх ЛИШЕ ЧИТАЄ і зводить у висновки. Жодного власного
 * сховища: один факт → одне джерело правди → багато способів показати.
 *
 * Усі висновки детерміновані. Жодних порад («їж більше») — тільки
 * факти («середнє 2840 із цілі 2900»): порада вимагає моделі людини,
 * якої в цих даних немає.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const DAY_MS = 86400000;

  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 4 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function dateOf(k) { return window.DateCore.dateOf(k); }

  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 3 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function keyOf(d) { return window.DateCore.keyOf(d); }

  /**
   * Ключ ПЕРШОГО дня вікна завдовжки `days`, рахуючи сьогодні включно.
   *
   * Було `- days * DAY_MS`, а фільтри всюди інклюзивні з обох боків — тож
   * «за 30 днів» насправді захоплювало 31 календарний день, і середні
   * рахувались по неправильному знаменнику. rating-core рахує вікно
   * інакше (рівно N днів), і два модулі розходились у тому, що таке 30 днів.
   *
   * setDate замість мілісекунд: у ніч переходу на зимовий час доба триває
   * 25 годин, і віднімання DAY_MS зсувало межу вікна на день.
   */
  function cutKey(days, now) {
    const base = now instanceof Date ? now : new Date();
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() - (Math.max(1, Number(days) || 1) - 1));
    return keyOf(d);
  }

  const r1 = function (n) { return Math.round(n * 10) / 10; };

  /* ------------------------------------------------------------------ */
  /* Вага тіла                                                           */
  /* ------------------------------------------------------------------ */

  /** Відсортовані валідні записи ваги: [{d, kg}] старі → нові */
  function bodyEntries(bodyLog, fromKey) {
    if (!bodyLog || typeof bodyLog !== 'object') return [];
    return Object.keys(bodyLog)
      .filter(function (k) {
        const v = Number(bodyLog[k]);
        return DATE_KEY.test(k) && Number.isFinite(v) && v >= 30 && v <= 300 &&
               (!fromKey || k >= fromKey);
      })
      .sort()
      .map(function (k) { return { d: k, kg: Number(bodyLog[k]) }; });
  }

  /**
   * Статистика ваги за період.
   * delta — між першим і останнім записом ПЕРІОДУ; perWeek — той самий
   * приріст, приведений до тижня за фактичним інтервалом дат (не за
   * кількістю записів: пропуски не мають розтягувати час).
   */
  function bodyStats(bodyLog, periodDays, now) {
    const from = periodDays ? cutKey(periodDays, now) : null;
    const s = bodyEntries(bodyLog, from);
    if (!s.length) return null;

    const first = s[0], last = s[s.length - 1];
    const spanDays = Math.max(1,
      (dateOf(last.d).getTime() - dateOf(first.d).getTime()) / DAY_MS);
    const avg = s.reduce(function (sum, e) { return sum + e.kg; }, 0) / s.length;
    const delta = last.kg - first.kg;

    return {
      current: last.kg,
      currentDate: last.d,
      first: first.kg,
      firstDate: first.d,
      delta: r1(delta),
      /*
       * Темп — лише коли за ним стоять хоча б три зважування.
       *
       * Двох вистачало «математично»: два числа дають нахил. Але відрізок
       * між двома випадковостями — це не тренд, і вода з сіллю рухають
       * вагу на ±1,5 кг незалежно від жиру. Той самий поріг уже стояв у
       * forecast() нижче; тепер він один на обидві функції й називається
       * window.Enough — правило «скільки даних стоїть за числом».
       */
      perWeek: window.Enough.gate(window.Enough.of(s.length, 0, { min: 3 }),
                                  r1(delta / spanDays * 7)),
      avg: r1(avg),
      count: s.length,
      spanDays: Math.round(spanDays)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Прогноз проти факту (вага тіла)                                     */
  /* ------------------------------------------------------------------ */

  /*
   * Очікувана ШВИДКІСТЬ зміни ваги за ціллю — %, маси тіла на тиждень.
   * Числа — ті самі діапазони, що написані людям у GOALS.rate
   * (js/nutrition-core.js): тут вони потрібні числами, щоб намалювати
   * коридор. maintain і recomp — абсолютний коридор ±0,5 кг: «вага
   * стабільна» означає межу в кілограмах, а не у відсотках.
   */
  const GOAL_RATES = {
    bulk:     { lo: 0.25,  hi: 0.5 },
    bulkfast: { lo: 0.5,   hi: 0.8 },
    cut:      { lo: -1.0,  hi: -0.5 },
    cutfast:  { lo: -0.9,  hi: -0.7 },
    recomp:   { abs: 0.5 },
    maintain: { abs: 0.5 }
  };

  /**
   * Коридор прогнозу від якірної точки.
   *
   * Якір — ПЕРШИЙ запис ваги у вибраному періоді: модель веде відлік
   * звідти, куди дивиться людина. Повертає функції lo(t)/hi(t) від
   * кількості днів після якоря і зведення проти фактичної кінцевої ваги.
   *
   * null, якщо порівнювати нема чого: без цілі, без записів або період
   * закороткий (менш як 2 тижні шуму ±300 г води — ще не сигнал).
   */
  function forecast(bodyLog, goalKey, periodDays, now) {
    const rate = GOAL_RATES[goalKey];
    if (!rate) return null;

    const s = bodyEntries(bodyLog, periodDays ? cutKey(periodDays, now) : null);
    if (s.length < 3) return null;

    const anchor = s[0], last = s[s.length - 1];
    const days = (dateOf(last.d).getTime() - dateOf(anchor.d).getTime()) / DAY_MS;
    if (days < 14) return null;

    const weeks = days / 7;
    const kgAt = function (pctPerWeek, t) {
      // Складний відсоток чесніший за лінійний: −1%/тиж від нової ваги щотижня
      return anchor.kg * Math.pow(1 + pctPerWeek / 100, t / 7);
    };

    const lo = function (t) {
      return rate.abs != null ? anchor.kg - rate.abs : kgAt(Math.min(rate.lo, rate.hi), t);
    };
    const hi = function (t) {
      return rate.abs != null ? anchor.kg + rate.abs : kgAt(Math.max(rate.lo, rate.hi), t);
    };

    const expectLo = r1(lo(days) - anchor.kg);
    const expectHi = r1(hi(days) - anchor.kg);
    const actual = r1(last.kg - anchor.kg);

    return {
      anchor: anchor, last: last, days: Math.round(days), weeks: r1(weeks),
      lo: lo, hi: hi,
      expectLo: expectLo, expectHi: expectHi, actual: actual,
      verdict: actual < Math.min(expectLo, expectHi) ? 'below'
             : actual > Math.max(expectLo, expectHi) ? 'above' : 'within'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Сила                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Повна статистика однієї вправи з weightLog.
   * Рекорд — найбільша вага серії; isRecord — поточна вага і є рекордом
   * (і це не єдиний запис: перший запис — точка відліку, а не досягнення).
   */
  function liftStats(weightLog, name) {
    const H = window.HistoryCore;
    const s = H ? H.weightSeries(weightLog, name) : [];
    if (!s.length) return null;

    const first = s[0], last = s[s.length - 1];
    let max = s[0];
    s.forEach(function (e) { if (Number(e.kg) >= Number(max.kg)) max = e; });

    const delta = r1(Number(last.kg) - Number(first.kg));
    return {
      name: name,
      series: s,
      first: Number(first.kg), firstDate: first.d,
      last: Number(last.kg), lastDate: last.d,
      delta: delta,
      pct: Number(first.kg) > 0 ? Math.round(delta / Number(first.kg) * 1000) / 10 : null,
      max: Number(max.kg), maxDate: max.d,
      isRecord: s.length > 1 && Number(last.kg) === Number(max.kg) && delta > 0,
      count: s.length
    };
  }

  /**
   * Найбільший приріст серед вправ за останні N днів — для рядка
   * «Жим: +12,5 кг за 8 тижнів» в огляді. null, якщо росту не було.
   */
  function bestLift(weightLog, periodDays, now) {
    const H = window.HistoryCore;
    if (!H || !weightLog) return null;
    const from = cutKey(periodDays, now);
    let best = null;

    H.weightNames(weightLog).forEach(function (name) {
      const s = H.weightSeries(weightLog, name);
      // Точка відліку — останній запис ДО періоду (вага, з якою в період
      // увійшли); якщо такого немає — перший запис усередині періоду.
      let base = null, last = null;
      s.forEach(function (e) {
        if (e.d < from) base = e;
        else last = e;
      });
      if (!last) return;
      if (!base) base = s.filter(function (e) { return e.d >= from; })[0];
      const delta = r1(Number(last.kg) - Number(base.kg));
      if (delta > 0 && (!best || delta > best.delta)) {
        best = { name: name, delta: delta, from: Number(base.kg), to: Number(last.kg) };
      }
    });
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Тренування                                                          */
  /* ------------------------------------------------------------------ */

  /*
   * Чи є в записі сесії робота.
   *
   * done — це закриті ВПРАВИ, і відколи виконання відмічається по
   * підходах, день із чотирма закритими підходами, але жодною добитою
   * вправою, мав done === 0: людина тренувалась, а статистика його не
   * бачила. Дзеркало journal.js → sessionCounts().
   */
  function sessionCounts(s) {
    if (!s || typeof s !== 'object') return false;
    return Number(s.done) > 0 || Number(s.doneSets) > 0;
  }

  /** День тренувальний, якщо є позначка АБО сесія з прогресом */
  function trainedDates(workLog, sessionLog) {
    const set = {};
    const wl = workLog || {};
    Object.keys(wl).forEach(function (k) {
      if (DATE_KEY.test(k) && Number(wl[k]) > 0) set[k] = true;
    });
    Object.keys(sessionLog || {}).forEach(function (k) {
      const s = sessionLog[k];
      if (!DATE_KEY.test(k) || !sessionCounts(s)) return;
      /*
       * Явний 0 у workLog — це «знято руками в календарі» і має
       * перекривати сесію. Інакше день, знятий у «Прогресі», однаково
       * лишався б тренувальним для статистики й для Rating, і зняти його
       * було б неможливо взагалі.
       */
      if (Number(wl[k]) === 0 && Object.prototype.hasOwnProperty.call(wl, k)) return;
      set[k] = true;
    });
    return Object.keys(set).sort();
  }

  /**
   * Регулярність. adherence — виконання плану за останні N ПОВНИХ тижнів:
   * фактичні тренування проти daysTarget*тижні, обрізане до 100%.
   * Без обраного плану adherence відсутній — вигадувати ціль нема з чого.
   */
  function trainingStats(workLog, sessionLog, daysTarget, now) {
    const dates = trainedDates(workLog, sessionLog);
    const base = now instanceof Date ? now : new Date();

    const monday = new Date(base);
    const dow = (base.getDay() + 6) % 7;   // Пн=0
    monday.setDate(base.getDate() - dow);
    const weekKey = keyOf(monday);

    const monthKey = cutKey(30, base);
    const thisWeek = dates.filter(function (d) { return d >= weekKey; }).length;
    const thisMonth = dates.filter(function (d) { return d >= monthKey; }).length;

    let adherence = null;
    const WEEKS = 6;
    if (daysTarget > 0) {
      /* Через setDate, а не мілісекунди (TIM-002): у ніч переходу на
         зимовий час доба триває 25 годин, і віднімання DAY_MS зсуває межу
         вікна на день. Той самий підхід, що й у cutKey вище. */
      const fromDate = new Date(monday);
      fromDate.setDate(fromDate.getDate() - WEEKS * 7);
      const from = keyOf(fromDate);
      const done = dates.filter(function (d) { return d >= from && d < weekKey; }).length;
      const planned = daysTarget * WEEKS;
      adherence = {
        done: done, planned: planned, weeks: WEEKS,
        pct: Math.min(100, Math.round(done / planned * 100))
      };
    }

    return { total: dates.length, thisWeek: thisWeek, thisMonth: thisMonth, adherence: adherence };
  }

  /* ------------------------------------------------------------------ */
  /* Харчування                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Статистика закритих днів за період. inTarget — день у межах ±5% від
   * ЦІЛІ СВОГО дня; дні без цілі в цю частку не входять.
   *
   * Швидкі записи (partial, див. HistoryCore.quickDay) рахуються в
   * СЕРЕДНЄ СПОЖИТЕ разом з усіма: інакше кожен ресторан занижував би
   * середнє, і витрати виходили б завищеними — тобто аналітика брехала б
   * саме там, де людина була найчеснішою.
   *
   * А от у СЕРЕДНІЙ БІЛОК швидкий день без білка не входить. Там нуль
   * означає «невідомо», а не «не їв білка»: порахувати його нулем — це
   * тихо занизити білкову частку за кожен день, коли точність була
   * неможлива. Скільки таких днів — видно в partialDays, щоб «замало
   * даних» не виглядало як «мало білка».
   */
  function foodStats(mealLog, periodDays, now) {
    if (!mealLog || typeof mealLog !== 'object') return null;
    const from = periodDays ? cutKey(periodDays, now) : null;
    const days = Object.keys(mealLog)
      .filter(function (k) { return DATE_KEY.test(k) && (!from || k >= from); })
      .sort()
      .map(function (k) { return Object.assign({ d: k }, mealLog[k]); });
    if (!days.length) return null;

    const sum = function (f) {
      return days.reduce(function (s, e) { return s + (Number(e[f]) || 0); }, 0);
    };
    const withTarget = days.filter(function (e) { return Number(e.target) > 0; });
    const inTarget = withTarget.filter(function (e) {
      return e.kcal >= e.target * 0.95 && e.kcal <= e.target * 1.05;
    }).length;

    /* Нуль калорій — це «невідомо», а не «нічого не зʼїв». День міг
       закритись без жодного запису (порожній день теж закривається), і
       такі дні тягли середнє вниз: 2000 і 0 давали «1000 ккал/день»,
       і людина бачила дефіцит, якого не було.

       Те саме правило вже стояло поруч у двох місцях — countsProtein для
       білка й TdeeCore.measure для спожитого (там kcal > 0 з самого
       початку). Тут його не було. */
    const kcalDays = days.filter(function (e) { return Number(e.kcal) > 0; });
    const proteinDays = days.filter(function (e) { return window.HistoryCore.countsProtein(e); });
    const partialDays = days.filter(function (e) { return e.partial === true; }).length;

    return {
      count: days.length,
      days: days,
      avgKcal: kcalDays.length
        ? Math.round(kcalDays.reduce(function (t, e) { return t + Number(e.kcal); }, 0) / kcalDays.length)
        : null,
      kcalDays: kcalDays.length,
      avgP: proteinDays.length
        ? Math.round(proteinDays.reduce(function (t, e) { return t + (Number(e.p) || 0); }, 0) / proteinDays.length)
        : null,
      proteinDays: proteinDays.length,
      partialDays: partialDays,
      avgTarget: withTarget.length
        ? Math.round(withTarget.reduce(function (s, e) { return s + e.target; }, 0) / withTarget.length)
        : null,
      withTarget: withTarget.length,
      inTarget: inTarget
    };
  }

  /* ------------------------------------------------------------------ */
  /* Аналітика сесій: обʼєм, час, підсумки періодів                      */
  /* ------------------------------------------------------------------ */
  /*
   * Джерело — знімки sessionLog (history-core.upsertSession): sets/reps/
   * vol/t0/t1 зняті в момент тренування. Старі записи цих полів не мають;
   * функції нижче це чесно повертають у полях hasVol/withTime, а сторінка
   * показує «замало даних» замість вигаданих чисел.
   */

  /** Валідні сесії періоду: [{d, done, total, sets, reps, vol, t0, t1}] */
  function sessionEntries(sessionLog, fromKey, toKey) {
    if (!sessionLog || typeof sessionLog !== 'object') return [];
    return Object.keys(sessionLog)
      .filter(function (k) {
        return DATE_KEY.test(k) && sessionCounts(sessionLog[k]) &&
               (!fromKey || k >= fromKey) && (!toKey || k <= toKey);
      })
      .sort()
      .map(function (k) { return Object.assign({ d: k }, sessionLog[k]); });
  }

  /** Тривалість сесії, хв; null якщо знімка часу немає або він сміттєвий */
  function sessionMinutes(s) {
    const t0 = Number(s && s.t0), t1 = Number(s && s.t1);
    if (!(t0 > 0) || !(t1 > t0)) return null;
    const min = (t1 - t0) / 60000;
    // Понад 6 годин — забута вкладка, а не тренування; таке не рахуємо.
    return (min >= 1 && min <= 360) ? min : null;
  }

  /** Час тренувань за період: середня і сумарна тривалість */
  function timeStats(sessionLog, periodDays, now) {
    const list = sessionEntries(sessionLog, periodDays ? cutKey(periodDays, now) : null);
    const mins = list.map(sessionMinutes).filter(function (m) { return m !== null; });
    if (!mins.length) return null;
    const total = mins.reduce(function (a, b) { return a + b; }, 0);
    return {
      count: mins.length,
      avgMin: Math.round(total / mins.length),
      totalMin: Math.round(total)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Рекорди і тренд сили                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Особисті рекорди: максимум серії кожної вправи.
   * isNew — рекорд поставлено за останні recentDays (за замовчуванням 14).
   * Перший запис вправи рекордом не вважається — це точка відліку.
   */
  function prList(weightLog, recentDays, now) {
    const H = window.HistoryCore;
    if (!H || !weightLog) return [];
    const from = cutKey(recentDays || 14, now);
    return H.weightNames(weightLog).map(function (name) {
      const s = H.weightSeries(weightLog, name);
      if (s.length < 2) return null;
      let max = s[0];
      s.forEach(function (e) { if (Number(e.kg) >= Number(max.kg)) max = e; });
      if (Number(max.kg) <= Number(s[0].kg)) return null;  // росту не було
      return { name: name, kg: Number(max.kg), date: max.d, isNew: max.d >= from };
    }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  /**
   * СКІЛЬКИ ПІДХОДІВ ЗА ОСТАННІЙ ПОВНИЙ ТИЖДЕНЬ.
   *
   * Єдине ВИМІРЯНЕ число про обʼєм. Поруч у знімку сесії лежать reps і
   * vol, але обидва похідні від нижньої межі запланованого діапазону
   * повторень — тобто оцінки. Підходи закриває сам користувач.
   *
   * ВІКНО — ТИЖДЕНЬ, І ЦЕ НЕ ДРІБНИЦЯ. Спершу тут стояло «останні сім
   * тренувань». Воно здавалось точнішим (порівнює сесію з сесією), але
   * заводило ДРУГУ одиницю обʼєму: весь проєкт міряє його на тиждень —
   * weeklySets у планах, «Підходів на тиждень по групах мʼязів», стеля на
   * групу. Два різні вікна на одне поняття не порівняти очима, а саме
   * заради порівняння число й показують.
   *
   * Береться ОСТАННІЙ ПОВНИЙ тиждень (Пн–Нд), а не поточний: поточний ще
   * триває, і посеред нього будь-яке число читається як падіння.
   *
   * База — середнє N попередніх повних тижнів. Чотири за замовчуванням:
   * те саме вікно, яким правило β з плану визначає «обʼєм виріс на
   * третину». Тиждень без тренувань входить у середнє НУЛЕМ, а не
   * пропускається: пропустити його означало б винагородити простій.
   *
   * @param {object} sessionLog журнал сесій
   * @param {number} [baseWeeks] скільки попередніх тижнів у базі
   * @returns {{total:number, sessions:number, from:string, to:string,
   *            prev:?{avg:number, weeks:number}, deltaPct:?number}|null}
   */
  function setsStats(sessionLog, baseWeeks, now) {
    const back = Math.max(1, Math.round(Number(baseWeeks) || 4));
    const D = window.DateCore;
    const today = now instanceof Date ? now : new Date();

    /* Понеділок ОСТАННЬОГО ПОВНОГО тижня — попередній відносно поточного. */
    const lastMon = D.shiftKey(D.keyOf(D.mondayOf(today)), -7);

    /** Підходи й сесії за тиждень, що починається в monKey. */
    const weekOf = function (monKey) {
      let total = 0, sessions = 0;
      for (let i = 0; i < 7; i++) {
        const s = (sessionLog || {})[D.shiftKey(monKey, i)];
        const n = Number(s && s.sets);
        if (n > 0) { total += n; sessions += 1; }
      }
      return { total: total, sessions: sessions };
    };

    const cur = weekOf(lastMon);
    if (!cur.sessions) return null;

    /* База. Тижні беруться підряд, порожні — нулями. Якщо перед останнім
       повним тижнем немає ЖОДНОГО запису, бази ще немає: середнє з самих
       нулів показало б «зростання на сотні відсотків» на порожньому місці. */
    let sum = 0, any = false;
    for (let k = 1; k <= back; k++) {
      const wk = weekOf(D.shiftKey(lastMon, -7 * k));
      sum += wk.total;
      if (wk.sessions) any = true;
    }
    const prev = any ? { avg: Math.round(sum / back * 10) / 10, weeks: back } : null;

    return {
      total: cur.total,
      sessions: cur.sessions,
      from: lastMon,
      to: D.shiftKey(lastMon, 6),
      prev: prev,
      deltaPct: (prev && prev.avg > 0)
        ? Math.round((cur.total - prev.avg) / prev.avg * 100)
        : null
    };
  }

  /* ------------------------------------------------------------------ */
  /* Запас до відмови                                                    */
  /* ------------------------------------------------------------------ */
  /*
   * RIR відповідає на питання, на яке вага й повтори не відповідають:
   * НАСКІЛЬКИ ВАЖКО це було. Дві людини жмуть 60 на вісім — одна на межі,
   * друга могла зробити дванадцять. У журналі вони виглядають однаково.
   *
   * Два висновки, заради яких це рахується, і обидва — про причину, а не
   * про пораду:
   *
   *   light — середній запас великий. Це не плато й не втома: вага
   *           просто застара, і графік, який «стоїть», стоїть саме тому.
   *   hard  — більшість підходів доводиться до відмови. Тижнями поспіль
   *           це не героїзм, а рахунок, який приходить розвантаженням.
   *
   * ПОРІГ КІЛЬКОСТІ ВАЖЛИВІШИЙ ЗА ПОРІГ ЗНАЧЕННЯ. Два підходи з великим
   * запасом — це один поганий день, а не характеристика ваги. Тому
   * висновок вимагає і підходів, і різних тренувань: на одному
   * тренуванні буває що завгодно.
   */
  const RIR_LIGHT_AVG = 3.5;     // середній запас, вище якого вага застара
  const RIR_HARD_SHARE = 0.6;    // частка підходів до відмови
  const RIR_MIN_SETS = 4;        // менше — випадковість, а не висновок
  const RIR_MIN_SESSIONS = 2;    // один день не характеризує вагу

  /**
   * Запас до відмови по вправах за період.
   *
   * Рахуються ЛИШЕ підходи з явно вписаним числом: підхід без нього не
   * «нуль», а невідомість (js/workout-core.js, performedSets). Через це
   * total і sets різні, і саме їхнє співвідношення чесно каже, наскільки
   * висновкам узагалі можна вірити.
   *
   * @param {object} sessionLog журнал сесій
   * @param {number} periodDays вікно, днів (включно з сьогодні)
   * @param {Date}   [now]      «сьогодні» — аргументом, щоб тести не
   *                            залежали від дня запуску
   * @returns {{days:number, sets:number, total:number, avg:?number,
   *            zero:number, rows:Array}}
   */
  function rirStats(sessionLog, periodDays, now) {
    const from = cutKey(periodDays, now);
    const byName = {};
    let sets = 0, total = 0, sum = 0, zero = 0;

    Object.keys(sessionLog || {}).forEach(function (k) {
      if (!DATE_KEY.test(k) || k < from) return;
      const day = sessionLog[k];
      if (!day || !Array.isArray(day.ex)) return;
      day.ex.forEach(function (row) {
        const name = row && typeof row.n === 'string' ? row.n.trim() : '';
        if (!name || !Array.isArray(row.s)) return;
        const cap = Math.max(0, Math.round(Number(row.ds) || 0));
        const list = row.s.slice(0, cap || row.s.length);

        let n = 0, s = 0, z = 0;
        list.forEach(function (x) {
          const q = Number(x && x.q);
          if (!Number.isFinite(q) || q < 0) return;
          n += 1; s += q;
          if (q === 0) z += 1;
        });

        const e = byName[name] || (byName[name] = {
          name: name, sets: 0, total: 0, sum: 0, zero: 0, days: {}
        });
        e.total += list.length;
        total += list.length;
        if (!n) return;
        e.sets += n; e.sum += s; e.zero += z; e.days[k] = 1;
        sets += n; sum += s; zero += z;
      });
    });

    const rows = Object.keys(byName).map(function (name) {
      const e = byName[name];
      const sessions = Object.keys(e.days).length;
      const avg = e.sets ? Math.round((e.sum / e.sets) * 10) / 10 : null;
      const share = e.sets ? e.zero / e.sets : 0;
      let flag = null;
      if (e.sets >= RIR_MIN_SETS && sessions >= RIR_MIN_SESSIONS) {
        if (avg >= RIR_LIGHT_AVG) flag = 'light';
        else if (share >= RIR_HARD_SHARE) flag = 'hard';
      }
      return {
        name: name, sets: e.sets, total: e.total, sessions: sessions,
        avg: avg, zero: e.zero, flag: flag
      };
    }).filter(function (r) { return r.sets > 0; })
      .sort(function (a, b) {
        if (a.flag !== b.flag) return a.flag ? -1 : 1;   // з висновком — угору
        if (b.sets !== a.sets) return b.sets - a.sets;
        return a.name < b.name ? -1 : 1;
      });

    return {
      days: Math.max(1, Math.round(Number(periodDays) || 1)),
      sets: sets,
      total: total,
      avg: sets ? Math.round((sum / sets) * 10) / 10 : null,
      zero: zero,
      rows: rows
    };
  }

  window.ProgressCore = {
    bodyStats: bodyStats,
    forecast: forecast,
    GOAL_RATES: GOAL_RATES,
    liftStats: liftStats,
    bestLift: bestLift,
    sessionCounts: sessionCounts,
    trainedDates: trainedDates,
    trainingStats: trainingStats,
    foodStats: foodStats,
    sessionEntries: sessionEntries,
    setsStats: setsStats,
    rirStats: rirStats,
    RIR_LIGHT_AVG: RIR_LIGHT_AVG,
    RIR_HARD_SHARE: RIR_HARD_SHARE,
    sessionMinutes: sessionMinutes,
    timeStats: timeStats,
    prList: prList
  };
})();
