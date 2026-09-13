/**
 * ПОКАЗ СЕРВЕРНИХ ДАНИХ РЕЙТИНГУ — чисті перетворення, без DOM.
 *
 * НАВІЩО ОКРЕМИЙ ФАЙЛ. Сервер віддає рейтинг двома плоскими списками:
 * elo_recent — події сезону рядок за рядком, elo_history — по одному
 * рядку на завершений сезон. Жоден із них не готовий до показу: події
 * треба згорнути в дні (двадцять рядків «+3» підряд нічого не
 * розповідають), а історію — звести в підсумки («найкращий сезон»,
 * «скільки разів був ELITE»). Робити це в тому самому файлі, що малює
 * розмітку, означало б, що арифметику не перевіряє жоден тест: браузерні
 * набори бачать лише готовий екран.
 *
 * ЩО ТУТ Є І ЧОГО НЕМАЄ. Тільки дані → дані. Ні document, ні
 * localStorage, ні window.Store: усе приходить аргументами й повертається
 * значеннями. Так само влаштовані EloCore, DayCal і AwardCore.
 *
 * НІЧОГО НЕ РАХУЄМО ЗАНОВО. ELO, рівень, місце, відсоток, нагороди —
 * усе це вже порахував сервер (db/elo-engine.sql). Тут лише групування,
 * максимуми й суми того, що прийшло. Якщо тут з'явиться власна формула
 * нарахування — це помилка за визначенням: клієнт, який уміє рахувати
 * ELO, умів би його й вигадати.
 *
 * СМІТТЯ ІГНОРУЄТЬСЯ МОВЧКИ. Рядок без дати, з нечисловою дельтою, з
 * сезоном як null — пропускається, а не валить підсумок. Причина та
 * сама, що в EloCore.sumFrom: єдина альтернатива — показати прочерк
 * замість усієї картки через один зіпсований рядок історії.
 */
(function () {
  'use strict';

  var KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function num(v) { var x = Number(v); return Number.isFinite(x) ? x : null; }
  function isKey(k) { return KEY_RE.test(String(k)); }

  /* ------------------------------------------------------------------ */
  /* ДАТИ ЛЮДСЬКОЮ                                                       */
  /* ------------------------------------------------------------------ */
  /*
   * Родовий відмінок, бо назва місяця стоїть після числа: «13 вересня».
   * Список один на весь проєкт і живе в js/date-core.js — там, де й
   * решта правди про дати.
   */
  var MONTHS = window.DateCore.MONTHS_GEN;

  /** '2026-09-13' → '13 вересня' (або '13 вересня 2026'). Сміття → ''. */
  function human(key, withYear) {
    if (!isKey(key)) return '';
    var p = String(key).split('-').map(Number);
    if (!MONTHS[p[1] - 1]) return '';
    return p[2] + ' ' + MONTHS[p[1] - 1] + (withYear ? ' ' + p[0] : '');
  }

  /**
   * Підпис дня у стрічці подій: «Сьогодні», «Вчора» або дата.
   *
   * ЧОМУ ДВА СЛОВА, А НЕ ЗАВЖДИ ДАТА. Стрічку читають, щоб зрозуміти
   * «за що мені щойно нарахували», і «сьогодні» — це і є відповідь.
   * Дату для сьогоднішнього дня доводилось порівнювати з календарем у
   * себе в голові.
   *
   * ДАЛІ ВЧОРАШНЬОГО — ДАТА, а не «2 дні тому»: відносний час далі за
   * добу перестає допомагати («5 днів тому» — це яке число?), а в межах
   * доби навпаки, лише він і потрібен.
   *
   * Різницю рахує DateCore.daysBetween — єдина реалізація в проєкті.
   * Тут навмисно немає власної арифметики дат: копії цієї функції в
   * Get Stronger уже одного разу розійшлися по семи файлах.
   */
  function dayLabel(key, todayKey) {
    if (!isKey(key)) return '';
    if (!isKey(todayKey)) return human(key);
    var d = window.DateCore.daysBetween(key, todayKey);
    if (d === 0) return 'Сьогодні';
    if (d === 1) return 'Вчора';
    return human(key);
  }

  /* ------------------------------------------------------------------ */
  /* КАТЕГОРІЇ ПОДІЙ                                                     */
  /* ------------------------------------------------------------------ */
  /*
   * ПЕРЕЛІК МУСИТЬ ЗБІГАТИСЬ ІЗ CHECK У БАЗІ
   * (elo_events_category_check: training, nutrition, sleep, recovery,
   * activity, penalty, bonus, admin). Досі клієнт знав лише перші пʼять —
   * тижневий бонус, штраф за недобір і адмінська правка приходили з
   * категорією, якої в мапі немає, і показувались без підпису взагалі.
   * Саме ті три події найбільше й потребують пояснення: людина бачить
   * «−12» і не знає, звідки воно.
   *
   * tone — не колір, а РОЛЬ: 'plus' нараховує, 'minus' знімає, 'flat'
   * ні те, ні те. Конкретні кольори живуть у CSS, як і належить.
   */
  var CATEGORIES = {
    training:  { label: 'Тренування',  tone: 'plus' },
    nutrition: { label: 'Харчування',  tone: 'plus' },
    sleep:     { label: 'Сон',         tone: 'plus' },
    recovery:  { label: 'Відновлення', tone: 'plus' },
    activity:  { label: 'Активність',  tone: 'plus' },
    bonus:     { label: 'Бонус',       tone: 'plus' },
    penalty:   { label: 'Штраф',       tone: 'minus' },
    admin:     { label: 'Правка',      tone: 'flat' }
  };

  /** Підпис категорії. Невідома — сам код, а не порожнеча: так видно збій. */
  function catLabel(code) {
    var c = CATEGORIES[String(code)];
    return c ? c.label : String(code || '—');
  }

  /* ------------------------------------------------------------------ */
  /* ПОДІЇ → ДНІ                                                         */
  /* ------------------------------------------------------------------ */
  /**
   * Згорнути стрічку подій у дні.
   *
   * ЧОМУ ДНІ, А НЕ ПЛОСКИЙ СПИСОК. Плоский список із чотирнадцяти рядків
   * відповідав на «що нарахували», але не на «як пройшов день»: три
   * події одного дня читались як три різні дні. День — та сама одиниця,
   * у якій людина й живе: сервер нараховує за день, стеля дня теж є.
   *
   * ПОРЯДОК ВХОДУ ЗБЕРІГАЄТЬСЯ. elo_recent віддає найновіше першим
   * (order by id desc), і саме в такому порядку дні й виходять — без
   * жодного сортування тут. Сортувати самому означало б домовитись із
   * сервером двічі: раз у SQL, раз тут, і розійтись на першій правці.
   *
   * @param {Array} events  рядки elo_recent: {day, category, delta, reason, eloAfter}
   * @returns {Array} [{ day, sum, count, eloAfter, events: [...] }]
   */
  function groupByDay(events) {
    var out = [];
    var byDay = {};
    (Array.isArray(events) ? events : []).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      var day = String(e.day || '');
      if (!isKey(day)) return;
      var delta = num(e.delta);
      if (delta === null) return;
      var g = byDay[day];
      if (!g) {
        g = byDay[day] = { day: day, sum: 0, count: 0, eloAfter: null, events: [] };
        out.push(g);
      }
      g.sum += delta;
      g.count += 1;
      g.events.push(e);
      /*
       * ELO НА КІНЕЦЬ ДНЯ — з першої ж події, у якої воно є.
       *
       * Перша — бо стрічка йде від найновішого, тобто перша подія дня це
       * остання за часом. «У якої воно є» — бо тижневу оцінку сервер
       * пише з elo_after = 0 (db/elo-engine.sql, elo_eval_week): там
       * підсумок тижня, а не стан рахунку. Показати той нуль означало б
       * написати людині, що вона обнулилась.
       */
      var after = num(e.eloAfter);
      if (g.eloAfter === null && after !== null && after > 0) g.eloAfter = after;
    });
    out.forEach(function (g) { g.sum = Math.round(g.sum); });
    return out;
  }

  /**
   * Один рядок підсумку над стрічкою: скільки подій і на скільки ELO.
   * fromKey — необовʼязкова межа (напр. понеділок): тоді сума лише з неї.
   */
  function eventsSummary(events, fromKey) {
    var arr = (Array.isArray(events) ? events : []).filter(function (e) {
      return e && typeof e === 'object' && isKey(String(e.day || '')) && num(e.delta) !== null;
    });
    var within = isKey(fromKey)
      ? arr.filter(function (e) { return String(e.day) >= String(fromKey); })
      : arr;
    var sum = 0;
    within.forEach(function (e) { sum += num(e.delta); });
    var days = {};
    arr.forEach(function (e) { days[String(e.day)] = 1; });
    return {
      count: arr.length,
      countWithin: within.length,
      sum: Math.round(sum),
      days: Object.keys(days).length,
      latest: arr.length ? String(arr[0].day) : null
    };
  }

  /* ------------------------------------------------------------------ */
  /* ІСТОРІЯ СЕЗОНІВ → ПІДСУМКИ                                          */
  /* ------------------------------------------------------------------ */
  /*
   * ЩО САМЕ ТУТ ВВАЖАЄТЬСЯ ЗА СЕЗОН. Рядок elo_history з'являється лише
   * після закриття сезону (elo_close_season), тобто це завершені сезони
   * і тільки вони. Поточний сезон у підсумки НЕ входить навмисно: він ще
   * не результат, і «найкращий сезон» посеред нього змінювався б щодня.
   */

  /** Рядки історії, впорядковані від найстарішого до найновішого. */
  function ordered(history) {
    return (Array.isArray(history) ? history : [])
      .filter(function (h) { return h && typeof h === 'object' && h.season; })
      .slice()
      .sort(function (a, b) { return String(a.season) < String(b.season) ? -1 : 1; });
  }

  /**
   * Підсумки за всі завершені сезони.
   *
   * null у полі означає «такого не було»: сезон без місця (сервер не
   * порахував рангу) не має давати «найкраще місце: 0» — нуль тут
   * виглядав би як перше місце, і краще за перше.
   */
  function seasonStats(history) {
    var rows = ordered(history);
    var st = {
      seasons: rows.length,
      best: null,          // найвище ELO: { season, elo, level, elite }
      bestRank: null,      // найкраще місце: { season, rank, of }
      bestPercentile: null,// найкращий відсоток: { season, percentile }
      eliteSeasons: 0,
      daysActive: 0,
      daysTotal: 0,
      consistency: null,   // % активних днів за всі сезони
      graceUsed: 0,
      avgElo: null,
      first: rows.length ? rows[0] : null,
      last: rows.length ? rows[rows.length - 1] : null,
      delta: null          // остання зміна: останній сезон проти попереднього
    };
    if (!rows.length) return st;

    var sum = 0;
    rows.forEach(function (h) {
      var elo = num(h.elo);
      if (elo !== null) {
        sum += elo;
        if (!st.best || elo > st.best.elo) {
          st.best = { season: String(h.season), elo: elo, level: num(h.level), elite: h.elite === true };
        }
      }
      if (h.elite === true) st.eliteSeasons += 1;
      var rank = num(h.rank);
      if (rank !== null && rank > 0 && (!st.bestRank || rank < st.bestRank.rank)) {
        st.bestRank = { season: String(h.season), rank: rank, of: num(h.of) };
      }
      var pct = num(h.percentile);
      if (pct !== null && pct > 0 && (!st.bestPercentile || pct < st.bestPercentile.percentile)) {
        st.bestPercentile = { season: String(h.season), percentile: pct };
      }
      st.daysActive += num(h.daysActive) || 0;
      st.daysTotal += num(h.daysTotal) || 0;
      st.graceUsed += num(h.graceUsed) || 0;
    });

    st.avgElo = Math.round(sum / rows.length);
    if (st.daysTotal > 0) st.consistency = Math.round(st.daysActive / st.daysTotal * 100);
    if (rows.length >= 2) {
      var a = num(rows[rows.length - 2].elo);
      var b = num(rows[rows.length - 1].elo);
      if (a !== null && b !== null) st.delta = b - a;
    }
    return st;
  }

  /**
   * ДРАБИНА СЕЗОНІВ: по одній горизонтальній смузі на сезон.
   *
   * ЧОМУ СМУГА, А НЕ ГРАФІК. У Get Stronger графік — це завжди лінія, а
   * стовпчиків немає ніде (docs/ENGINEERING.md, «Стандарти
   * візуалізації»): жоден показник сайту не має осмисленого нуля в
   * масштабі свого графіка, тому стовпчик там бреше. Тут інакше — і саме
   * тому це не графік, а смуга прогресу, та сама форма, що .vol__bar:
   *
   *   • нуль справжній: кожен сезон починається рівно з 0 ELO;
   *   • стеля справжня: seasonMax — те саме число для всіх сезонів;
   *   • питання інше. Лінія відповідає на «куди я рухаюсь», а тут
   *     питання «наскільки я вибрав сезон» — частка, а не зміна.
   *
   * Сезонів за життя буде чотири на рік: лінія з двох-трьох точок не
   * показує тренду, а смуга з двох рядків відповідає одразу.
   *
   * ШКАЛА ВІД НУЛЯ ДО СТЕЛІ СЕЗОНУ (max), а не до власного максимуму.
   * Якби найдовша смуга завжди була на всю ширину, два сезони по 300 і
   * 320 ELO виглядали б як прірва, а 2400 і 2500 — як однакові.
   *
   * Поточний сезон можна домалювати останнім рядком (now): він ще не в
   * історії, але без нього драбина обривається на минулому й не
   * відповідає на «а зараз як».
   */
  function seasonLadder(history, max, now) {
    var top = num(max);
    var rows = ordered(history).map(function (h) {
      return {
        season: String(h.season),
        elo: num(h.elo) || 0,
        level: num(h.level),
        elite: h.elite === true,
        current: false
      };
    });
    if (now && now.season) {
      rows.push({
        season: String(now.season),
        elo: num(now.elo) || 0,
        level: num(now.level),
        elite: now.elite === true,
        current: true
      });
    }
    if (!top || top <= 0) {
      top = rows.reduce(function (m, r) { return Math.max(m, r.elo); }, 0) || 1;
    }
    return rows.map(function (r) {
      /* Нуль лишається нулем: мінімальної видимої ширини тут немає
         навмисно — намальована смуга при нулі ELO стверджувала б те,
         чого не було. */
      r.pct = Math.max(0, Math.min(100, Math.round(r.elo / top * 1000) / 10));
      return r;
    });
  }

  window.EloView = {
    MONTHS: MONTHS,
    human: human,
    dayLabel: dayLabel,
    CATEGORIES: CATEGORIES,
    catLabel: catLabel,
    groupByDay: groupByDay,
    eventsSummary: eventsSummary,
    ordered: ordered,
    seasonStats: seasonStats,
    seasonLadder: seasonLadder
  };
})();
