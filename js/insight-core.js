/**
 * ЩО ПРАЦЮЄ САМЕ НА ТОБІ — порівняння тижнів усередині одного журналу.
 *
 * ЩО ЦЕ Й ЧИМ ЦЕ НЕ Є. Це не наука і не «дослідження». Це найпростіше
 * чесне питання, яке можна поставити власним даним: у тижні, коли одного
 * було більше, чи виходило краще з іншим? Вибірка — одна людина, десяток
 * тижнів, жодного контролю. Тому тут немає ні p-значень, ні кореляції
 * Пірсона: обидва створюють враження строгості, якої в цих даних немає.
 *
 * Замість них — порівняння двох половин і розмір різниці в тих самих
 * одиницях, у яких людина веде журнал. Таке число можна перевірити очима,
 * і саме тому йому можна вірити рівно настільки, наскільки воно того варте.
 *
 * ЯК РАХУЄТЬСЯ:
 *   1. журнали розкладаються по ЗАВЕРШЕНИХ тижнях (Пн–Нд); поточний
 *      тиждень не береться — він ще триває, і будь-яке число з нього
 *      читається як падіння;
 *   2. тижні, де невідомий хоч один бік пари, відкидаються;
 *   3. решта ділиться навпіл по МЕДІАНІ показника-причини;
 *   4. порівнюються середні показника-наслідку.
 *
 * ЧОМУ МЕДІАНА, А НЕ ПОРІГ. Поріг («сім годин сну») довелося б вигадати,
 * і він був би різним для різних людей. Медіана ділить власні тижні
 * людини на «більше, ніж у неї зазвичай» і «менше» — питання стає «чи
 * краще, коли БІЛЬШЕ за твою звичайну норму», а це єдине питання, на яке
 * ці дані взагалі можуть відповісти.
 *
 * КОЛИ МОВЧАТИ. Порівняння показується лише якщо завершених тижнів
 * досить (правило одне на весь сайт — window.Enough), по обидва боки
 * медіани є хоча б по три тижні, і різниця більша за розкид усередині
 * самих половин. Останнє — це d Коена ≥ 0,5, тобто «різниця більша за
 * половину типового відхилення». Без нього будь-який шум виглядав би як
 * знахідка, а знахідка тут дорога: людина міняє через неї поведінку.
 */
(function () {
  'use strict';

  /* Скільки завершених тижнів потрібно, щоб питання взагалі мало сенс.
     Вісім — це два місяці: менше означає, що половини складаються з
     трьох-чотирьох тижнів, а в них один хворий тиждень вирішує все. */
  var MIN_WEEKS = 8;

  /* Скільки тижнів мусить бути ПО КОЖЕН бік медіани. */
  var MIN_SIDE = 3;

  /* Наскільки різниця має перевищувати розкид, щоб її називати різницею.
     0,5 — «середній ефект» за Коеном; менше не відрізнити від шуму на
     десятку тижнів. */
  var MIN_EFFECT = 0.5;

  /*
   * null окремо від решти: Number(null) — це НУЛЬ, а не NaN, тож
   * перевірка на скінченність пропускає «невідомо» далі під виглядом
   * виміряного нуля. Саме на цьому вже горів elo-core (pace(null)
   * повертав темп першого рівня), і тут ціна та сама: тиждень без
   * записаного білка потрапляв би в порівняння як тиждень із нулем.
   */
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function mean(xs) {
    if (!xs.length) return null;
    var s = 0;
    for (var i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }

  function median(xs) {
    if (!xs.length) return null;
    var a = xs.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /** Відхилення в тих самих одиницях, що й самі значення. */
  function sd(xs) {
    if (xs.length < 2) return 0;
    var m = mean(xs), s = 0;
    for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
    return Math.sqrt(s / (xs.length - 1));
  }

  /* ---------------- тижні --------------------------------------------- */

  /** Понеділок тижня, у якому лежить ключ. Рахує js/date-core.js. */
  function weekKey(key) {
    var D = window.DateCore;
    var d = D.dateOf(key);
    return D.isValid(d) ? D.keyOf(D.mondayOf(d)) : '';
  }

  /** Сім ключів тижня, від понеділка. */
  function daysOf(wk) {
    var D = window.DateCore, out = [];
    for (var i = 0; i < 7; i++) out.push(D.shiftKey(wk, i));
    return out;
  }

  /** Ключі всіх ЗАВЕРШЕНИХ тижнів журналів, найстаріший перший. */
  function weekKeys(profile, todayKey) {
    var D = window.DateCore;
    var cur = weekKey(todayKey || D.todayKey());
    var seen = Object.create(null);

    var eat = function (log) {
      if (!log || typeof log !== 'object') return;
      Object.keys(log).forEach(function (k) {
        if (!D.isKey(k)) return;
        var w = weekKey(k);
        if (w && w < cur) seen[w] = 1;
      });
    };

    ['sessionLog', 'workLog', 'mealLog', 'bodyLog'].forEach(function (name) {
      eat(profile && profile[name]);
    });
    var tl = profile && profile.trackerLog;
    if (tl && typeof tl === 'object') {
      Object.keys(tl).forEach(function (id) { eat(tl[id]); });
    }
    return Object.keys(seen).sort();
  }

  /** Середнє значення трекера за тиждень; null, якщо записів немає. */
  function trackerAvg(profile, id, days) {
    var TC = window.TrackerCore;
    var log = profile && profile.trackerLog && profile.trackerLog[id];
    if (!log || !TC) return null;
    var vals = [];
    days.forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(log, k)) return;
      var v = TC.entryValue(log[k]);
      if (v !== null && v > 0) vals.push(v);
    });
    return vals.length ? mean(vals) : null;
  }

  /**
   * Скільки вправ поважчало в кожному тижні, одним проходом по книзі ваг.
   *
   * Одним, а не по разу на тиждень: серій стільки, скільки вправ, і
   * перебирати їх заново для кожного з пʼятдесяти тижнів — та сама марна
   * робота, від якої в журналі вже відмовились із сезонним зрізом.
   *
   * @returns {{byWeek:Object, weeks:Object, first:string}}
   *          weeks — усі тижні, у яких книга ваг щось записала (потрібні
   *          для переліку тижнів: книга живе окремо від щоденних
   *          журналів і має свою форму, яку знає js/history-core.js);
   *          first — понеділок тижня, у якому книга почалась: раніше за
   *          нього нуль означає «ще не вели», а не «не росло».
   */
  function liftUps(weightLog) {
    var H = window.HistoryCore;
    var out = { byWeek: Object.create(null), weeks: Object.create(null), first: '' };
    if (!H || !weightLog) return out;
    H.weightNames(weightLog).forEach(function (name) {
      var s = H.weightSeries(weightLog, name);
      for (var i = 0; i < s.length; i++) {
        var w = weekKey(s[i].d);
        if (w) out.weeks[w] = 1;
        if (!out.first || s[i].d < out.first) out.first = s[i].d;
        if (i === 0) continue;                    // перший запис — відлік
        if (!(Number(s[i].kg) > Number(s[i - 1].kg))) continue;
        if (w) out.byWeek[w] = (out.byWeek[w] || 0) + 1;
      }
    });
    if (out.first) out.first = weekKey(out.first);
    return out;
  }

  /**
   * Показники одного тижня. null у полі означає «невідомо» — і саме так
   * воно й поїде далі: тиждень без числа просто не бере участі в парі,
   * де це число потрібне.
   */
  function weekRow(profile, wk, ups) {
    var PC = window.ProgressCore;
    var days = daysOf(wk);
    var row = { week: wk };

    /* --- тренування --- */
    var sessions = 0, doneSets = 0, totalSets = 0, hasSets = false;
    days.forEach(function (k) {
      var s = profile.sessionLog && profile.sessionLog[k];
      if (!s || !PC || !PC.sessionCounts(s)) return;
      sessions++;
      var dn = num(s.doneSets), tt = num(s.totalSets);
      if (dn !== null && tt !== null && tt > 0) {
        doneSets += dn; totalSets += tt; hasSets = true;
      }
    });
    row.sessions = sessions;
    row.setsPct = hasSets ? doneSets / totalSets : null;

    /* --- харчування: частка днів, де білок узято --- */
    var pDays = 0, pHit = 0;
    days.forEach(function (k) {
      var m = profile.mealLog && profile.mealLog[k];
      if (!m) return;
      var p = num(m.p), pt = num(m.pTarget);
      if (pt === null || pt <= 0) return;
      /* Швидкий запис без білка — це «невідомо», а не нуль: те саме
         правило, що в HistoryCore.countsProtein. */
      if (m.partial === true && !(p > 0)) return;
      pDays++;
      if (p !== null && p >= pt) pHit++;
    });
    row.proteinHit = pDays ? pHit / pDays : null;

    /* --- сон і кроки --- */
    row.sleep = trackerAvg(profile, 'sleep', days);
    row.steps = trackerAvg(profile, 'steps', days);

    /* --- скільки вправ поважчало --- */
    row.lifts = (ups.first && wk >= ups.first) ? (ups.byWeek[wk] || 0) : null;

    /* --- вага тіла: СЕРЕДНЄ за тиждень --- */
    var w = [];
    days.forEach(function (k) {
      var v = num(profile.bodyLog && profile.bodyLog[k]);
      if (v !== null && v > 0) w.push(v);
    });
    /* Двох зважувань мало для середнього тижня, але це той компроміс,
       який уже прийнято в TdeeCore (MIN_EDGE_WEIGHTS = 2): вимагати
       щоденних зважувань означало б викинути більшість тижнів. */
    row.bodyAvg = w.length >= 2 ? mean(w) : null;
    row.bodyDelta = null;   // заповнюється в weeks(): треба сусідній тиждень

    return row;
  }

  /**
   * Усі завершені тижні з показниками, найстаріший перший.
   *
   * bodyDelta рахується ТУТ, бо це різниця між сусідніми тижнями:
   * зміна ваги всередині тижня — це переважно вода й сіль, а різниця
   * тижневих середніх — уже щось про жир. Та сама логіка, що у
   * виміряному підтриманні.
   */
  function weeks(profile, todayKey) {
    if (!profile || !window.DateCore) return [];
    var ups = liftUps(profile.weightLog);
    var D0 = window.DateCore;
    var cur = weekKey(todayKey || D0.todayKey());
    /* Тижні книги ваг долучаються до тижнів щоденних журналів: людина
       могла місяць лише піднімати ваги, не ведучи більше нічого. */
    var keys = weekKeys(profile, todayKey);
    var have = Object.create(null);
    keys.forEach(function (k) { have[k] = 1; });
    Object.keys(ups.weeks).forEach(function (k) {
      if (!have[k] && k < cur) { have[k] = 1; keys.push(k); }
    });
    keys.sort();

    var rows = keys.map(function (wk) {
      return weekRow(profile, wk, ups);
    });
    var D = window.DateCore;
    for (var i = 1; i < rows.length; i++) {
      var prev = rows[i - 1], cur = rows[i];
      /* Лише для СУСІДНІХ тижнів: різниця через місяць перерви — це не
         «тиждень», а порожнеча між двома вимірами. */
      if (prev.bodyAvg === null || cur.bodyAvg === null) continue;
      if (D.daysBetween(prev.week, cur.week) !== 7) continue;
      cur.bodyDelta = cur.bodyAvg - prev.bodyAvg;
    }
    return rows;
  }

  /* ---------------- порівняння ---------------------------------------- */

  /**
   * Порівняти наслідок у тижнях із високою й низькою причиною.
   *
   * @returns {{level:'none'|'thin'|'flat'|'ok', weeks:number, enough:object, …}}
   *          'flat' — даних досить, різниці немає. Це теж відповідь, і
   *          показувати її треба: «не впливає» — корисна новина, бо
   *          знімає з людини зайву роботу.
   */
  function compare(rows, driver, outcome) {
    var E = window.Enough;
    var pairs = (rows || []).filter(function (r) {
      return num(r[driver]) !== null && num(r[outcome]) !== null;
    });
    /* share = 1: тут не «частка вікна», а прямий мінімум тижнів. */
    var enough = E.of(pairs.length, MIN_WEEKS, { min: MIN_WEEKS, share: 1 });
    if (!enough.ok) {
      return { level: enough.level, weeks: pairs.length, enough: enough };
    }

    var med = median(pairs.map(function (r) { return r[driver]; }));
    var hi = [], lo = [];
    pairs.forEach(function (r) { (r[driver] > med ? hi : lo).push(r); });

    /* Медіана могла злипнутись: половина тижнів із однаковим числом
       (наприклад, рівно 8 000 кроків) лягає в один бік цілком. */
    if (hi.length < MIN_SIDE || lo.length < MIN_SIDE) {
      return { level: 'thin', weeks: pairs.length, enough: enough, split: true };
    }

    var hv = hi.map(function (r) { return r[outcome]; });
    var lv = lo.map(function (r) { return r[outcome]; });
    /* Наслідок не рухався ЖОДНОГО тижня. Це не «різниці не видно» —
       порівнювати просто нічого, і сказати це треба інакше: «жодна
       вправа не важчала» і «сон не впливає на те, як важчають ваги» —
       різні новини. */
    var all = hv.concat(lv);
    if (sd(all) === 0) {
      return { level: 'flat', still: true, weeks: pairs.length, enough: enough,
               value: all[0] };
    }
    var hm = mean(hv), lm = mean(lv);
    var pooled = Math.sqrt((sd(hv) * sd(hv) + sd(lv) * sd(lv)) / 2);
    var effect = pooled > 0 ? Math.abs(hm - lm) / pooled : (hm === lm ? 0 : Infinity);

    return {
      level: effect >= MIN_EFFECT ? 'ok' : 'flat',
      weeks: pairs.length,
      enough: enough,
      median: med,
      delta: hm - lm,
      effect: effect,
      high: { n: hi.length, avg: hm, driver: mean(hi.map(function (r) { return r[driver]; })) },
      low:  { n: lo.length, avg: lm, driver: mean(lo.map(function (r) { return r[driver]; })) }
    };
  }

  /*
   * Пари, які має сенс питати. Список закритий і короткий НАВМИСНО: що
   * більше пар, то більша ймовірність, що бодай одна «спрацює»
   * випадково. Чотири питання — це чотири питання, а не пошук будь-чого,
   * що корелює хоч із чимось.
   */
  var PAIRS = [
    { id: 'sleep-lifts',  driver: 'sleep',      outcome: 'lifts' },
    { id: 'sleep-sets',   driver: 'sleep',      outcome: 'setsPct' },
    { id: 'protein-sets', driver: 'proteinHit', outcome: 'setsPct' },
    { id: 'steps-weight', driver: 'steps',      outcome: 'bodyDelta' }
  ];

  /** Усі чотири порівняння за журналами профілю. */
  function findings(profile, todayKey) {
    var rows = weeks(profile, todayKey);
    return PAIRS.map(function (p) {
      var r = compare(rows, p.driver, p.outcome);
      r.id = p.id; r.driver = p.driver; r.outcome = p.outcome;
      return r;
    });
  }

  window.InsightCore = {
    MIN_WEEKS: MIN_WEEKS,
    MIN_SIDE: MIN_SIDE,
    MIN_EFFECT: MIN_EFFECT,
    PAIRS: PAIRS,
    weeks: weeks,
    compare: compare,
    findings: findings
  };
})();
