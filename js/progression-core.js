/**
 * ПОДВІЙНА ПРОГРЕСІЯ: КОЛИ ЧАС ДОДАТИ ВАГУ.
 *
 * Ядро без DOM. Правило вже було описане в js/programs-data.js
 * (PROGRESSION_DOUBLE) і показане на сторінці кожної програми, а крок
 * ваги виконувався кнопками «Крок робочої ваги» на «Планах тренувань».
 * Не було одного: НІХТО НЕ ЗВІРЯВ одне з одним. Людина мусила сама
 * помітити, що вже третій тиждень закриває верхню межу.
 *
 * Тут та звірка й живе. Нових даних не заводиться: фактичні повтори
 * кожного підходу лежать у profile.sessionLog[дата].ex[].s, діапазон і
 * RIR — у плані, історія змін ваги — у profile.weightLog[вправа].
 *
 * ЧОТИРИ УМОВИ, І ВСІ МУСЯТЬ ЗБІГТИСЬ:
 *
 *   1. ВПРАВУ ЗРОБЛЕНО СТІЛЬКИ РАЗІВ, СКІЛЬКИ ЇЇ ПЛАНУЄ ТИЖДЕНЬ.
 *      Думка та сама, що була: підняти вагу після тижня, де половина
 *      підходів не зроблена, означає закріпити недоробку. Але доти ця
 *      умова стояла на рівні ВСЬОГО тижня — «усі заплановані дні
 *      завершені», — і тому пропущений день ніг глушив жим, зроблений
 *      двічі й на межі. Вправа, яку зробили як належить, нічого не
 *      винна дню, якого не було; пропуск карається рейтингом
 *      (missedWorkoutPenalty), а не чужою вагою (E6).
 *   2. ВПРАВА НА ВЕРХНІЙ МЕЖІ в УСІХ своїх робочих підходах того тижня.
 *      Один підхід із дев'ятьма повтореннями з діапазону 8–10 — ще не
 *      привід: правило вимагає верхню межу скрізь.
 *   3. ВАГА ПРОСТОЯЛА ЩОНАЙМЕНШЕ ДВА ТРЕНУВАННЯ. Інакше той, хто щойно
 *      підняв вагу й закрив межу з першого разу, отримав би пропозицію
 *      підняти ще — і так щотижня, поки не зірветься.
 *   4. НЕ ВІДКЛАДЕНО Й НЕ ВІДХИЛЕНО (див. нижче).
 *
 * ЧОГО ТУТ НЕМАЄ І ЧОМУ. RIR не перевіряється, бо фактичний RIR ніде не
 * записується: у підході зберігаються тільки вага й повтори. Вигадувати
 * його з повторень не можна — десять повторень на RIR 3 і десять у
 * відмову виглядають у даних однаково. Тому питання про запас ставить
 * сам віджет, і відповідь на нього — це і є натискання кнопки.
 */
(function () {
  'use strict';

  /** Крок ваги: ноги важчі за абсолютними числами, тож крок більший. */
  var STEP_LEGS = 5;
  var STEP_OTHER = 2.5;

  /** Скільки тренувань вага мусить простояти, щоб пропозиція мала сенс. */
  var MIN_SESSIONS = 2;

  /** На скільки днів ховає кнопка «відкласти». */
  var SNOOZE_DAYS = 7;

  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 2 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function keyOf(d) { return window.DateCore.keyOf(d); }

  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 4 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function dateOf(k) { return window.DateCore.dateOf(k); }

  /** Понеділок того тижня, у який потрапляє дата. Тиждень скрізь із Пн. */
  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 1 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function mondayOf(d) { return window.DateCore.mondayOf(d); }

  /* Делегат: єдина реалізація — js/date-core.js.
     ВАЖЛИВО: shiftKey віддає ПОРОЖНІЙ РЯДОК на сміття, а не null. Тут
     раніше був null, і перевірка «if (!d)» ловила саме його; після
     переїзду dateOf на спільну реалізацію вона перестала б спрацьовувати
     мовчки — тому функція делегує цілком, а не наполовину. */
  function addDays(key, n) {
    return window.DateCore.shiftKey(key, n) || null;
  }

  /** Різниця в календарних днях між двома ключами. */
  /* Делегат: єдина реалізація — js/date-core.js. Там різниця рахується
     в UTC, тому доба переходу на літній час (23 години) не зменшує
     відповідь на один день. */
  function daysBetween(fromKey, toKey) {
    return window.DateCore.daysBetween(fromKey, toKey);
  }

  /**
   * Верхня межа діапазону повторень.
   *
   * '8–10' → 10. Одне число ('8') теж має межу — саме це число: коли
   * людина вписала свої повторення замість діапазону, ціль усе одно є,
   * і закрити її в усіх підходах — той самий трігер. Інакше власний
   * набір повторень назавжди вимикав би прогресію (а в реальних планах
   * такі вправи бувають цілим днем).
   *
   * Тире en-dash і звичайний дефіс — обидва: у даних програм стоїть
   * '8–10', а руками вписують і '8-10'.
   */
  function topOfRange(reps) {
    var s = String(reps == null ? '' : reps).trim();
    if (!s) return null;
    /* Провідний мінус — це від'ємне число, а не порожня ліва межа
       діапазону. Ділення по тире перетворювало '-5' на ['', '5'] і
       віддавало 5: від'ємні повторення ставали цілком робочою ціллю. */
    if (/^[–—-]/.test(s)) return null;
    var nums = (s.match(/\d+(?:[.,]\d+)?/g) || [])
      .map(function (x) { return Number(String(x).replace(',', '.')); })
      .filter(function (n) { return Number.isFinite(n) && n > 0; });
    if (!nums.length) return null;
    return Math.max.apply(null, nums);
  }

  /**
   * Чи закрила вправа верхню межу в УСІХ запланованих підходах.
   * @param {object} entry запис вправи із sessionLog[дата].ex[]
   * @param {number} top   верхня межа
   */
  function hitTop(entry, top) {
    if (!entry || !Number.isFinite(top) || top <= 0) return false;
    var planned = Number(entry.ps) || 0;
    var done = Number(entry.ds) || 0;
    if (planned <= 0 || done < planned) return false;

    var sets = Array.isArray(entry.s) ? entry.s : [];
    if (sets.length < planned) return false;

    /* Беремо рівно заплановані підходи: зайві понад план не роблять
       день гіршим, але й вимагати від них межі нема підстав. */
    for (var i = 0; i < planned; i++) {
      var r = Number(sets[i] && sets[i].r);
      if (!Number.isFinite(r) || r < top) return false;
    }
    return true;
  }

  /** Ключі днів тижня, що починається в monKey. */
  function weekDays(monKey) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(monKey, i));
    return out;
  }

  /**
   * Чи закритий тиждень: завершених сесій не менше, ніж днів у плані.
   * Рахуються тільки сесії з end — тобто ті, які людина завершила
   * кнопкою, а не покинула посеред залу.
   */
  function weekComplete(sessionLog, monKey, plannedDays) {
    var need = Number(plannedDays) || 0;
    if (need <= 0) return false;
    var log = sessionLog || {};
    var n = 0;
    weekDays(monKey).forEach(function (k) {
      var s = log[k];
      if (s && s.end) n++;
    });
    return n >= need;
  }

  /**
   * Вік робочої ваги: відколи стоїть і скільки тренувань на ній зроблено.
   *
   * «Тренування на цій вазі» — завершені дні, у яких вправа була, від
   * дати останньої зміни ваги включно. Саме це число має сенс для
   * прогресії: календарні дні минають і в тижні, коли ти хворів.
   */
  function weightAge(profile, name, todayKey) {
    var log = (profile && profile.weightLog) || {};
    var hist = Array.isArray(log[name]) ? log[name] : [];
    var last = hist[hist.length - 1];
    if (!last || !last.d) return null;

    var sessions = 0;
    var sl = (profile && profile.sessionLog) || {};
    Object.keys(sl).forEach(function (k) {
      if (k < last.d) return;
      var s = sl[k];
      if (!s || !s.end) return;
      var ex = Array.isArray(s.ex) ? s.ex : [];
      if (ex.some(function (e) { return e && e.n === name; })) sessions++;
    });

    return {
      since: last.d,
      kg: Number(last.kg),
      days: daysBetween(last.d, todayKey),
      sessions: sessions
    };
  }

  /**
   * Стан кнопок по вправі.
   * profile.progression[name] = { snoozeUntil: 'дата', ackWeek: 'понеділок' }
   */
  function stateFor(profile, name) {
    var all = (profile && profile.progression) || {};
    var one = all[name];
    return (one && typeof one === 'object') ? one : {};
  }

  /**
   * Чи заглушена пропозиція по цій вправі для цього тижня.
   *
   * «Відкласти» ховає на SNOOZE_DAYS днів і повертається саме.
   * «Залишити як є» закриває САМЕ ЦЕЙ трігер: наступний ідеально
   * закритий тиждень запитає знову. Без прив'язки до тижня кнопка
   * означала б «ніколи більше», а це не те, що людина натискає.
   */
  function muted(profile, name, monKey, todayKey) {
    var st = stateFor(profile, name);
    if (st.snoozeUntil && todayKey < st.snoozeUntil) return true;
    if (st.ackWeek && st.ackWeek === monKey) return true;
    return false;
  }

  /** Дата, до якої ховає «відкласти». */
  function snoozeUntil(todayKey) { return addDays(todayKey, SNOOZE_DAYS); }

  /**
   * Вправи, що дозріли до підвищення ваги.
   *
   * @param {object}   o
   * @param {object}   o.profile
   * @param {Array}    o.plan        активний план (дні з exercises)
   * @param {string}   o.today       ключ сьогоднішнього дня
   * @param {function} o.isLeg       (назва) → чи це вправа на ноги
   * @returns {Array} [{name, kg, step, next, top, reps, days, sessions}]
   */
  function due(o) {
    o = o || {};
    var profile = o.profile || {};
    var plan = Array.isArray(o.plan) ? o.plan : [];
    var today = o.today;
    var isLeg = typeof o.isLeg === 'function' ? o.isLeg : function () { return false; };
    /* Наступна вага з ПРОФІЛЮ ЗАЛУ, якщо сторінка його дала. Без нього
       лишається старе правило: 5 кг на ноги, 2,5 на решту. Ядро про
       GymCore не знає навмисно — воно бере функцію, а не залежність. */
    var nextWeight = typeof o.nextWeight === 'function' ? o.nextWeight : null;
    if (!today) return [];

    /* Останній ПОВНИЙ тиждень — попередній відносно поточного. Поточний
       брати не можна: він ще триває, і «усі дні закриті» в середу
       означало б лише, що до середи не було пропусків. */
    var mon = keyOf(mondayOf(dateOf(today) || new Date()));
    var prevMon = addDays(mon, -7);

    var days = Number(profile.daysPerWeek) ||
               (profile.activePlan && Number(profile.activePlan.days)) || plan.length;
    /*
     * Тиждень БІЛЬШЕ НЕ ВОРОТА (E6). Доти тут стояв ранній вихід: один
     * пропущений день — і порожній список для всіх вправ одразу. Тепер
     * повнота тижня лише супроводжує пропозицію (поле weekClosed), щоб
     * екран міг це сказати, а рішення ухвалюється по кожній вправі.
     */
    var weekClosed = weekComplete(profile.sessionLog, prevMon, days);

    /* Скільки разів тиждень планує кожну вправу. Рахується з плану, а не
       з факту: саме з цим числом порівнюється зроблене. */
    var plannedTimes = Object.create(null);
    plan.forEach(function (day) {
      var list = (day && Array.isArray(day.exercises)) ? day.exercises : [];
      list.forEach(function (ex) {
        if (ex && ex.name) plannedTimes[ex.name] = (plannedTimes[ex.name] || 0) + 1;
      });
    });

    var weights = profile.weights || {};
    var sl = profile.sessionLog || {};
    var seen = Object.create(null);
    var out = [];

    plan.forEach(function (day) {
      var list = (day && Array.isArray(day.exercises)) ? day.exercises : [];
      list.forEach(function (ex) {
        var name = ex && ex.name;
        if (!name || seen[name]) return;

        var kg = Number(weights[name]);
        if (!Number.isFinite(kg) || kg <= 0) return;      // вправа без ваги

        var top = topOfRange(ex.reps);
        if (!top) return;

        /* Усі появи вправи в закритому тижні мусять бути на межі, і
           бути їх мусить хоча б одна. */
        var appeared = 0, allTop = true;
        weekDays(prevMon).forEach(function (k) {
          var s = sl[k];
          if (!s || !s.end) return;
          var e = (Array.isArray(s.ex) ? s.ex : []).find(function (x) { return x && x.n === name; });
          if (!e) return;
          appeared++;
          if (!hitTop(e, top)) allTop = false;
        });
        /* Стільки ж разів, скільки планує тиждень, і щоразу на межі. */
        if (appeared < (plannedTimes[name] || 1) || !allTop) return;

        var age = weightAge(profile, name, today);
        if (!age || age.sessions < MIN_SESSIONS) return;

        if (muted(profile, name, prevMon, today)) return;

        seen[name] = true;
        var step = isLeg(name) ? STEP_LEGS : STEP_OTHER;
        var next = kg + step;
        if (nextWeight) {
          var real = Number(nextWeight(name, kg));
          /* Профіль залу може сказати «важчого немає» (null) — тоді
             лишаємо старе число: заборонити вагу, якої в залі нема, ми
             можемо, а вигадати причину не додавати — ні. */
          if (Number.isFinite(real) && real > kg) { next = real; step = real - kg; }
        }
        out.push({
          name: name, kg: kg, step: step, next: next,
          top: top, reps: String(ex.reps || ''),
          days: age.days, sessions: age.sessions, week: prevMon,
          weekClosed: weekClosed
        });
      });
    });

    return out;
  }

  /**
   * Вік ваги для КОЖНОЇ вправи, у якої вага колись мінялась.
   *
   * Джерело — weightLog, а не активний план, і це навмисно. По-перше,
   * «Прогрес» не вантажить ні план, ні бібліотеку вправ, і тягнути їх
   * туди заради однієї картки означало б три зайві файли на сторінці.
   * По-друге, застояла вага цікава й тоді, коли вправа тимчасово випала
   * з плану: саме її потім і забувають.
   *
   * Найзастояліші зверху: вони й потребують уваги.
   */
  function ages(o) {
    o = o || {};
    var profile = o.profile || {};
    var today = o.today;
    var log = profile.weightLog || {};
    var out = [];

    Object.keys(log).forEach(function (name) {
      var age = weightAge(profile, name, today);
      if (!age || !Number.isFinite(age.kg) || age.kg <= 0) return;
      out.push({ name: name, kg: age.kg, since: age.since,
                 days: age.days, sessions: age.sessions });
    });

    out.sort(function (a, b) {
      return (b.days - a.days) || (b.sessions - a.sessions) || a.name.localeCompare(b.name, 'uk');
    });
    return out;
  }

  window.ProgressionCore = {
    STEP_LEGS: STEP_LEGS,
    STEP_OTHER: STEP_OTHER,
    MIN_SESSIONS: MIN_SESSIONS,
    SNOOZE_DAYS: SNOOZE_DAYS,
    topOfRange: topOfRange,
    hitTop: hitTop,
    weekComplete: weekComplete,
    weightAge: weightAge,
    muted: muted,
    snoozeUntil: snoozeUntil,
    due: due,
    ages: ages
  };
})();
