/**
 * Get Stronger Seasonal ELO — чисте ядро. Без DOM, без мережі, під тестами.
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

  /*
   * СЕЗОН ЗАКІНЧУЄТЬСЯ В НЕДІЛЮ, НАСТУПНИЙ ПОЧИНАЄТЬСЯ В ПОНЕДІЛОК.
   *
   * Сезон рахує ТИЖНЕВІ цілі: бюджет тижня, штраф за незакритий тиждень,
   * «чистий тиждень». Календарний квартал у тижні не ділиться — 1 вересня
   * 2026 випадає на вівторок, — тож перший і останній тижні сезону
   * виходили обрубками: людина отримувала повний тижневий штраф за три
   * дні, які встигла в сезон. Тепер межа сезону збігається з межею тижня.
   *
   * ПРАВИЛО. Кінець сезону — найближча НЕДІЛЯ на або після останнього дня
   * його кварталу. Початок — наступний день після кінця попереднього,
   * тобто завжди понеділок. Якщо квартал уже закінчується в неділю,
   * нічого не зсувається.
   *
   * ДАТА ВВЕДЕННЯ. Правило діє для сезонів, чий квартал закінчується
   * 2026-09-01 або пізніше (RULE_FROM). Це не примха, а вимога до вже
   * записаних даних: осінь-2026 стартувала 1 вересня й за 1–6 вересня вже
   * нараховано ELO. Якби правило діяло «заднім числом», ці дні поїхали б
   * у літо-2026 — тобто зникли б із поточного рахунку й таблиці лідерів.
   * Тому осінь-2026 лишається з 1 вересня, але закінчиться в неділю
   * 6 грудня, а зима почнеться в понеділок 7 грудня. З неї й далі кожен
   * сезон — ціле число тижнів.
   *
   * ЦЕ САМЕ ПРАВИЛО МУСИТЬ ЖИТИ Й НА СЕРВЕРІ (db/season-week-bounds.sql).
   * Розходження клієнта й сервера тут не помітне на око: обидва
   * показуватимуть свій «день N із M», а закриється сезон тоді, коли
   * вирішить сервер. Тому парність стереже tests/elo-parity.test.js.
   */
  const RULE_FROM = Date.UTC(2026, 8, 1);        // 2026-09-01

  /** Найближча неділя на або після дати (понеділок = 0 у нашому тижні). */
  function toSunday(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    /* getDay(): неділя = 0. Скільки днів лишилось до неділі — 0, якщо це
       вже неділя. */
    const add = (7 - x.getDay()) % 7;
    x.setDate(x.getDate() + add);
    return x;
  }

  /** Останній день КВАРТАЛУ сезону, без урахування правила тижня. */
  function nominalEnd(code) {
    const p = String(code).split('-');
    const y = Number(p[1]);
    switch (p[0]) {
      case 'SPRING': return new Date(y, 5, 0);        // 31 травня
      case 'SUMMER': return new Date(y, 8, 0);        // 31 серпня
      case 'AUTUMN': return new Date(y, 11, 0);       // 30 листопада
      default:       return new Date(y + 1, 2, 0);    // 28/29 лютого
    }
  }

  /** Код сезону, що йде перед даним. */
  function prevCode(code) {
    const p = String(code).split('-');
    const y = Number(p[1]);
    switch (p[0]) {
      case 'SPRING': return 'WINTER-' + (y - 1);
      case 'SUMMER': return 'SPRING-' + y;
      case 'AUTUMN': return 'SUMMER-' + y;
      default:       return 'AUTUMN-' + y;            // WINTER-y ← AUTUMN-y
    }
  }

  /** Кінець сезону з урахуванням правила: неділя, якщо правило вже діє. */
  function endOf(code) {
    const nom = nominalEnd(code);
    return nom.getTime() >= RULE_FROM ? toSunday(nom) : nom;
  }

  /** Межі сезону за його кодом: [перший день, останній день]. */
  function seasonRange(code) {
    const end = endOf(code);
    const prevEnd = endOf(prevCode(code));
    const start = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() + 1);
    return [start, end];
  }

  function seasonOf(d) {
    const m = d.getMonth() + 1, y = d.getFullYear();
    let code;
    if (m >= 3 && m <= 5) code = 'SPRING-' + y;
    else if (m >= 6 && m <= 8) code = 'SUMMER-' + y;
    else if (m >= 9 && m <= 11) code = 'AUTUMN-' + y;
    else code = 'WINTER-' + (m === 12 ? y : y - 1);

    /*
     * Квартальна відповідь — лише перше наближення: межа зсунута максимум
     * на шість днів, тож дата біля стику може належати сусідньому сезону.
     * Двох кроків вистачає з запасом (зсув менший за півмісяця), але цикл
     * лишається обмеженим — нескінченний тут коштував би зависанням
     * сторінки, а не помилкою в консолі.
     */
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    for (let i = 0; i < 4; i++) {
      const r = seasonRange(code);
      if (day < r[0]) { code = prevCode(code); continue; }
      if (day > r[1]) { code = nextCode(code); continue; }
      break;
    }
    return code;
  }

  /** Код сезону, що йде після даного. */
  function nextCode(code) {
    const p = String(code).split('-');
    const y = Number(p[1]);
    switch (p[0]) {
      case 'SPRING': return 'SUMMER-' + y;
      case 'SUMMER': return 'AUTUMN-' + y;
      case 'AUTUMN': return 'WINTER-' + y;
      default:       return 'SPRING-' + (y + 1);
    }
  }

  /**
   * Який сьогодні день сезону: {passed, total}, обидва з одиниці.
   *
   * Рахується по КАЛЕНДАРНИХ днях, а не по мілісекундах. Було
   * Math.round((now - start) / доба) + 1, і після полудня першого дня
   * округлення давало «2/91»: пів доби округлялось до цілої. Той самий
   * клас помилки, що вже виправлений у js/periodization-core.js —
   * межа доби там, де її бачить людина, а не де вона в таймстемпі.
   */
  function seasonDay(code, now) {
    const range = seasonRange(code);
    const base = now instanceof Date ? now : new Date();
    const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const total = Math.round((range[1] - range[0]) / 86400000) + 1;
    const passed = Math.round((today - range[0]) / 86400000) + 1;
    return { passed: Math.min(total, Math.max(1, passed)), total: total };
  }

  function seasonLabel(code) {
    const p = String(code).split('-');
    const n = { SPRING: 'Весна', SUMMER: 'Літо', AUTUMN: 'Осінь', WINTER: 'Зима' };
    return (n[p[0]] || p[0]) + ' ' + p[1];
  }

  /* ---------------- Рівні ---------------- */

  /**
   * Код сезону, що передував даті. День ПЕРЕД початком поточного сезону.
   *
   * Живе тут, а не в js/elo-api.js, з двох причин. Перша: це чиста
   * арифметика календаря, і їй місце в ядрі. Друга: у тесті лежала копія
   * цієї функції, і перевірявся саме тестовий двійник — сам elo-api.js не
   * завантажував жоден тест (TST-001). Копія розходиться з оригіналом тихо.
   *
   * Наївне setMonth(getMonth() - 3) переповнюється: 31 травня мінус три
   * місяці — це «31 лютого», тобто 3 березня, тобто ВЕСНА, тобто поточний
   * сезон. Сервер відповідав season_running, клієнт позначав сезон
   * закритим — і той не закривався ніколи. Вікно бага: 29–31 травня.
   *
   * @param {Date} now
   * @returns {string} код попереднього сезону
   */
  function previousSeasonCode(now) {
    const range = seasonRange(seasonOf(now || new Date()));
    const before = new Date(range[0].getFullYear(), range[0].getMonth(), range[0].getDate() - 1);
    return seasonOf(before);
  }


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

  /**
   * ТЕМП ЗА РІВНЕМ: на початку дія коштує більше, далі — менше.
   *
   * ЧОМУ ВЗАГАЛІ. Доти бюджет був плаский: 200 ELO на тиждень і на
   * першому рівні, і на девʼятому. Наслідків два, обидва погані. Старт
   * нудний: перші два тижні людина робить усе як треба й бачить Level 2 —
   * нагороди за найважчий період (коли звички ще немає) майже немає. І
   * стеля недосяжна: сильний гравець із 90–95% виконання закінчував сезон
   * на ~1800 із 2500, тобто верхня третина шкали не належала нікому,
   * крім бездоганного.
   *
   * Тепер темп спадає з рівнем. Перші рівні беруться швидко — це аванс за
   * те, що людина тільки входить у режим; далі кожні наступні 200 очок
   * коштують дорожче. Крива в конфігу (levelPace), а не в коді: балансом
   * крутять цифри, а не логіку.
   *
   * ШТРАФИ НЕ МАСШТАБУЮТЬСЯ навмисно. Пропущене тренування коштує ті самі
   * −8 і на другому рівні, і на девʼятому. Разом зі спадним темпом це і
   * дає «далі тільки важче»: нагорода меншає, ціна помилки — ні.
   *
   * БЕЗ ELO В КОНТЕКСТІ МНОЖНИК ДОРІВНЮЄ ОДИНИЦІ. Так рахують місця, яким
   * рівень невідомий або не потрібен: попередній показ дії в довідці,
   * оцінка дотримання плану. Мовчазне множення там дало б число, якого
   * сервер не підтвердить.
   */
  function pace(elo, cfg) {
    const curve = cfg && cfg.levelPace;
    if (!Array.isArray(curve) || !curve.length) return 1;
    /* null окремо від undefined: Number(null) — це 0, тобто «перший
       рівень», і викликач, який чесно сказав «рівень невідомий», мовчки
       отримував би найщедріший множник у грі. */
    if (elo === null || elo === undefined) return 1;
    if (!Number.isFinite(Number(elo))) return 1;
    const lv = levelFor(elo, cfg);
    const raw = lv.elite ? cfg.elitePace : curve[lv.level - 1];
    const v = Number(raw);
    return (Number.isFinite(v) && v > 0) ? v : 1;
  }

  /*
   * КОНФІГ ПІД ЛЮДИНУ: ВИМКНЕНІ КАТЕГОРІЇ.
   *
   * Тижнева стеля в грі спільна — weeklyBudget × темп, незалежно від
   * категорій (elo_week_room на сервері). Ваги лише ділять цю стелю. Тому
   * людина, яка не веде щоденник їжі, не «заробляла менше за ті самі
   * дії» — вона мала НЕДОСЯЖНИЙ кусок власної стелі: 30 %, закріплені за
   * категорією, якої в неї немає.
   *
   * Вимкнення категорії — не знижка й не штраф, а перерозподіл: вага
   * зникає, решта нормується назад до одиниці, спільна стеля лишається
   * тією самою. Через це ж і немає вигоди вмикати-вимикати категорію
   * посеред сезону: більше за тижневу стелю все одно не взяти.
   *
   * Повертає НОВИЙ обʼєкт: cfg приходить із сервера один на весь екран, і
   * правка на місці зачепила б усе, що його вже прочитало.
   */
  function cfgFor(cfg, skip) {
    const src = (cfg && cfg.weights) || null;
    if (!src) return cfg;
    const drop = Array.isArray(skip) ? skip : [];
    const keys = Object.keys(src).filter(function (k) { return drop.indexOf(k) === -1; });
    /* Вимкнути все — це ділення на нуль і бюджет NaN. Такого вибору немає
       в інтерфейсі, але конфіг приходить і з профілю, який могли правити
       руками в експорті. */
    if (!keys.length || keys.length === Object.keys(src).length) return cfg;

    let sum = 0;
    keys.forEach(function (k) { sum += Number(src[k]) || 0; });
    if (!(sum > 0)) return cfg;

    const weights = {};
    keys.forEach(function (k) { weights[k] = (Number(src[k]) || 0) / sum; });
    return Object.assign({}, cfg, { weights: weights });
  }

  /** Категорії, які зараз у грі, — за вагами конфігу. */
  function categories(cfg) {
    return Object.keys((cfg && cfg.weights) || {});
  }

  /** Тижневий бюджет категорії в ELO (без бонусної частки). */
  function weeklyBudget(cat, cfg, elo) {
    return cfg.weeklyBudget * pace(elo, cfg) * cfg.categoryShare * cfg.weights[cat];
  }

  function dailyBudget(cat, cfg, elo) { return weeklyBudget(cat, cfg, elo) / 7; }

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
    const per = weeklyBudget('training', cfg, ctx && ctx.elo) /
                Math.max(1, Number(ctx && ctx.plannedDays) || 3);
    return { quality: q, mult: q, delta: Math.round(per * q) };
  }

  function mealDelta(payload, cfg, ctx) {
    const target = Number(payload.target) || 0;
    const pTarget = Number(payload.proteinTarget) || 0;
    const day = dailyBudget('nutrition', cfg, ctx && ctx.elo);
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
    /*
     * Приблизний запис (HistoryCore.quickDay) — одне число, вписане
     * рукою. Він мусить бути вигіднішим за незаписаний день, інакше в
     * ньому немає сенсу, і дешевшим за розібраний по грамах, інакше
     * немає сенсу розбирати.
     *
     * Стеля нижча за cleanThreshold, тому приблизний день НІКОЛИ не
     * буває чистим — це наслідок одного числа, а не окремої заборони.
     * Перелік заборон розходиться з правилом; одне число — ні.
     *
     * Зрізає лише верх: поганий приблизний день і без стелі нижчий за
     * неї, тож карати його вдруге нема за що.
     */
    const capped = payload.partial ? Math.min(mult, cfg.partialNutritionCap) : mult;
    return { quality: capped, mult: capped, delta: Math.round(day * capped) };
  }

  function sleepDelta(payload, cfg, ctx) {
    const goal = Math.max(1, Number(payload.goal) || 480);
    const q = clamp((Number(payload.minutes) || 0) / goal, 0, 1);
    const mult = ladder(cfg.tolerance.sleep, q);
    return { quality: q, mult: mult,
             delta: Math.round(dailyBudget('sleep', cfg, ctx && ctx.elo) * mult) };
  }

  function recoveryDelta(payload, cfg, ctx) {
    /* Заповнити трекер — більша частина цінності (звичка помічати стан);
       гарний стан (≥ recoveryGoodValue) — решта. Не карати за чесне
       «мені погано» — інакше трекер брехатиме. */
    const day = dailyBudget('recovery', cfg, ctx && ctx.elo);
    const filled = payload.value !== null && payload.value !== undefined;
    if (!filled) return { quality: 0, mult: 0, delta: 0 };
    const good = Number(payload.value) >= cfg.recoveryGoodValue;
    const mult = cfg.recoveryFillShare + (good ? 1 - cfg.recoveryFillShare : 0);
    return { quality: mult, mult: mult, delta: Math.round(day * mult) };
  }

  function activityDelta(payload, cfg, ctx) {
    const goal = Math.max(1, Number(payload.goal) || 10000);
    const q = clamp((Number(payload.steps) || 0) / goal, 0, 1);
    const mult = ladder(cfg.tolerance.activity, q);
    return { quality: q, mult: mult,
             delta: Math.round(dailyBudget('activity', cfg, ctx && ctx.elo) * mult) };
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
    /* Список категорій береться з КОНФІГУ, а не пишеться тут удруге:
       інакше вимкнена категорія робила б чистий день недосяжним
       назавжди — він вимагав би їжі, якої людина свідомо не веде. */
    const need = categories(cfg).filter(function (c) {
      return c !== 'training' || isTrainingDay;
    });
    if (!need.length) return false;
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
    /* Сім закритих днів їжі питаємо лише тоді, коли їжа взагалі в грі. */
    const needMeals = categories(cfg).indexOf('nutrition') !== -1;
    const meals = !needMeals || (Number(mealDaysClosed) || 0) >= 7;
    return workoutsDone >= plannedDays && meals ? cfg.cleanWeekBonus : 0;
  }

  /**
   * Застосувати денні межі і стелю сезону.
   *
   * СТЕЛЯ ДНЯ МАСШТАБУЄТЬСЯ ТЕМПОМ, ПІДЛОГА — НІ.
   *
   * Без цього крива темпу не працює зовсім: на першому рівні бездоганний
   * день коштує під шістдесят очок, а плаский dayGainCap зрізав би його
   * до сорока пʼяти — і весь розгін, заради якого крива й існує,
   * зʼїдався б стелею. Саме на цьому перший підбір крив тупцював:
   * множник рік, а швидкість та сама.
   *
   * Підлога втрат лишається плаcкою навмисно. Разом зі спадним темпом це
   * і є «далі тільки важче»: нагорода меншає з рівнем, ціна пропущеного
   * дня — ні.
   */
  function applyDayCaps(deltas, cfg, elo) {
    const sum = deltas.reduce(function (a, d) { return a + d; }, 0);
    const cap = Math.round(cfg.dayGainCap * pace(elo, cfg));
    return clamp(sum, cfg.dayLossFloor, cap);
  }

  function clampElo(elo, cfg) { return clamp(Math.round(elo), 0, cfg.seasonMax); }

  /**
   * Скільки ELO набрано з дня fromKey включно.
   *
   * НАВІЩО. Панель рейтингу показувала приріст ЗА СЬОГОДНІ, і це число
   * майже завжди нуль або трійка: більшість днів дає одну-дві дії, а в
   * день відпочинку — жодної. Людина дивилась на «+0 ELO» і робила з
   * цього висновок про застій, хоч за тиждень набігало двадцять.
   * Тиждень — природний крок цієї системи: бюджет ELO тижневий
   * (weeklyBudget), план тренувань тижневий, штраф за пропуск теж
   * рахується по тижню. Тому й підсумок має бути тижневий.
   *
   * events — те, що віддає elo_recent: [{day, delta, …}]. Порядок і
   * зайві поля не важать; сміття ігнорується мовчки, бо єдина
   * альтернатива — показати «—» замість числа через один зіпсований
   * рядок історії.
   *
   * Порівняння рядків, а не дат: ключі 'YYYY-MM-DD' лексикографічно
   * упорядковані так само, як хронологічно, і жодного розбору дати тут
   * не потрібно.
   */
  function sumFrom(events, fromKey) {
    if (!Array.isArray(events) || !/^\d{4}-\d{2}-\d{2}$/.test(String(fromKey))) return 0;
    var from = String(fromKey);
    var sum = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || typeof e !== 'object') continue;
      var d = String(e.day || '');
      var v = Number(e.delta);
      if (d >= from && Number.isFinite(v)) sum += v;
    }
    return Math.round(sum);
  }

  window.EloCore = {
    sumFrom: sumFrom,
    seasonOf: seasonOf,
    seasonRange: seasonRange,
    seasonDay: seasonDay,
    seasonLabel: seasonLabel,
    levelFor: levelFor,
    previousSeasonCode: previousSeasonCode,
    pace: pace,
    weeklyBudget: weeklyBudget,
    dailyBudget: dailyBudget,
    ladder: ladder,
    actionDelta: actionDelta,
    cfgFor: cfgFor,
    categories: categories,
    cleanDay: cleanDay,
    weekPenalty: weekPenalty,
    cleanWeek: cleanWeek,
    applyDayCaps: applyDayCaps,
    clampElo: clampElo
  };
})();
