/**
 * ============================================================================
 *  ЯДРО ПЕРІОДИЗАЦІЇ
 * ============================================================================
 *
 * Будує лінійний цикл: починаєш із легкої ваги, щотижня (або кожні два)
 * додаєш відсоток від разового максимуму, за 8–16 тижнів виходиш на важке.
 * Класична схема повернення в роботу після хвороби, перерви або просто
 * після довгого плато.
 *
 * Тут тільки математика. DOM, профіль і рендер — у js/periodization.js.
 *
 * ----------------------------------------------------------------------------
 * ЧОМУ ПОВТОРЕННЯ РАХУЮТЬСЯ, А НЕ БЕРУТЬСЯ З ПЛАНУ
 * ----------------------------------------------------------------------------
 * Відсоток від 1ПМ і кількість повторень — це одне й те саме число, сказане
 * двома способами. 50% від максимуму — це підхід приблизно на 25 повторень,
 * 85% — на 5, 95% — на 2. Не можна одночасно поставити 90% і «6–8 повторень»:
 * такої ваги на вісім разів не існує.
 *
 * План задає діапазон 6–8 і RIR 2 — це приблизно 70–75% від максимуму, і на
 * звичайних тижнях так і має бути. Але на тижнях циклу головним стає
 * відсоток, тому таблиця показує повторення, виведені з нього. Діапазон
 * плану на цих тижнях не діє, і сторінка каже про це прямо.
 *
 * ----------------------------------------------------------------------------
 * ЧОМУ В ІЗОЛЯЦІЇ ОКРЕМА СТЕЛЯ
 * ----------------------------------------------------------------------------
 * 90% від 1ПМ у махах з гантелями — це не важкий підхід, це плече.
 * Односуглобові вправи з довгим важелем не тестуються на максимум і не
 * тренуються біля нього: 1ПМ там ні виміряти, ні оцінити надійно, а
 * навантаження на суглоб зростає швидше за корисний стимул.
 *
 * Тому для ізоляції стеля 75% (це десь 10 повторень), для базових — 95%.
 * Цикл однаково рухає всі вправи, просто ізоляція впирається в свою межу
 * раніше й далі йде рівно. У таблиці такі клітинки позначені.
 *
 * ----------------------------------------------------------------------------
 * МЕЖІ ЦІЄЇ МОДЕЛІ — ПРОЧИТАЙ, ПЕРШ НІЖ ВІРИТИ ЧИСЛАМ
 * ----------------------------------------------------------------------------
 * 1. Лінійний ріст інтенсивності — це конвенція силових програм, а не
 *    висновок конкретного дослідження. Дані підтверджують, що періодизація
 *    загалом працює не гірше за непериодизований підхід, і що варіант із
 *    прогресією інтенсивності дає перевагу в силі. Точні відсотки по тижнях
 *    жодне дослідження не називає.
 * 2. Оцінка 1ПМ через формули має похибку, і в ізоляції вона більша.
 *    Число на 12-му тижні — це оцінка від оцінки.
 * 3. Модель не знає про твій сон, стрес, харчування й травми. Якщо вага
 *    тижня не йде — вона не йде, і таблиця тут не аргумент.
 * ============================================================================
 */
(function () {
  'use strict';

  const OneRM = window.OneRM;

  /* ========================================================================
     МЕЖІ Й ЗАМОВЧУВАННЯ
     ======================================================================== */

  /** Стеля інтенсивності за типом вправи, % від 1ПМ */
  const CEILING = { compound: 95, isolation: 75 };

  /**
   * Крок округлення ваги, кг.
   *
   * Для базових 2,5 кг — пара млинців по 1,25, найдрібніше, що реально
   * зібрати на штанзі. Для ізоляції той самий крок був би завеликим:
   * на махах із 10 кг це стрибок на чверть ваги. Тому 1 кг — і поруч
   * у таблиці стоїть примітка, що число це орієнтир, а брати треба
   * найближчу гантель, яка в залі є.
   */
  const ROUND_STEP = { compound: 2.5, isolation: 1 };

  /**
   * Дозволені діапазони налаштувань. Перевіряються тут, у ядрі, а не в
   * полях форми: у поля можна не тільки друкувати, до них ще й приходять
   * збережені значення з профілю, які могли зіпсуватись.
   */
  const LIMITS = {
    weeks:    [8, 16],   // менше — цикл не встигає нічого дати, більше — набридає
    cadence:  [1, 2],    // піднімати щотижня або кожні два тижні
    startPct: [50, 70],  // нижче 50% це вже не тренування, а розминка
    endPct:   [70, 95],
    stepPct:  [0.5, 10]
  };

  /**
   * Стеля повторень у підході, скільки б їх не дозволяв відсоток.
   *
   * Формула на 50% від 1ПМ дає близько 22 повторень до відмови — і це
   * математично правильно, але як припис — безглуздо. Підхід на 22 рази
   * тренує витривалість, а не силу, і до завдання перших тижнів циклу
   * (зайти легко, відновити рух, поставити техніку) стосунку не має.
   *
   * Тому кількість повторень обрізається на 12, а різниця йде в запас:
   * на 50% ти робиш 12 разів і зупиняєшся, маючи ще десяток у баку.
   * Це і є сенс легких тижнів — робота свідомо далеко від відмови.
   *
   * 12 — межа, за якою підхід перестає бути силовим у звичайному сенсі;
   * це робочий орієнтир силових програм, не висновок дослідження.
   */
  const REP_CAP = 12;

  function defaults() {
    return {
      weeks: 12,
      cadence: 1,
      mode: 'target',   // 'target' — фіксуємо кінцевий %, 'step' — фіксуємо крок
      startPct: 50,
      endPct: 90,
      stepPct: 3.5,
      startedAt: null,  // ISO-дата початку, ставиться при запуску циклу
      oneRM: {}         // заморожені оцінки 1ПМ по назвах вправ
    };
  }

  function clamp(v, range, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(range[1], Math.max(range[0], n));
  }

  /* ========================================================================
     НОРМАЛІЗАЦІЯ Й ПОХІДНІ ЧИСЛА
     ======================================================================== */

  /**
   * Скільки разів вага підніметься за цикл.
   *
   * Тижні розбиваються на блоки по cadence штук: при кроці «кожні 2 тижні»
   * і 12 тижнях виходить 6 блоків. Підйомів на один менше за блоки —
   * перший блок це і є старт.
   */
  function stepsIn(weeks, cadence) {
    return Math.max(1, Math.ceil(weeks / cadence) - 1);
  }

  /**
   * Довести налаштування до коректного стану й дорахувати похідне.
   *
   * Два режими — це рівно те, чого не можна задати одночасно: якщо
   * зафіксувати старт, фініш, кількість тижнів І крок, система стає
   * перевизначеною і якесь із чисел доведеться мовчки зламати. Тому одне
   * з двох завжди рахується, а не вводиться.
   *
   * @returns нормалізований config із полями steps, stepPct, endPct і
   *          прапорцем cappedByLimit, якщо режим кроку вилетів за 95%
   */
  function normalize(cfg) {
    const c = Object.assign(defaults(), cfg || {});

    c.weeks    = Math.round(clamp(c.weeks, LIMITS.weeks, 12));
    c.cadence  = Math.round(clamp(c.cadence, LIMITS.cadence, 1));
    c.startPct = clamp(c.startPct, LIMITS.startPct, 50);
    c.mode     = c.mode === 'step' ? 'step' : 'target';

    const steps = stepsIn(c.weeks, c.cadence);
    c.steps = steps;
    c.cappedByLimit = false;

    if (c.mode === 'target') {
      c.endPct = clamp(c.endPct, LIMITS.endPct, 90);
      // Ціль нижча за старт — це не цикл, а спуск. Розсуваємо на крок вгору.
      if (c.endPct <= c.startPct) c.endPct = Math.min(LIMITS.endPct[1], c.startPct + 5);
      c.stepPct = (c.endPct - c.startPct) / steps;
    } else {
      c.stepPct = clamp(c.stepPct, LIMITS.stepPct, 3.5);
      const reached = c.startPct + c.stepPct * steps;
      if (reached > LIMITS.endPct[1]) {
        // Не ріжемо крок мовчки: рахуємо як задано, але кажемо сторінці,
        // що останні тижні впруться в стелю.
        c.cappedByLimit = true;
      }
      c.endPct = Math.min(LIMITS.endPct[1], reached);
    }

    if (!Number.isFinite(c.stepPct)) c.stepPct = 0;
    if (!c.oneRM || typeof c.oneRM !== 'object') c.oneRM = {};
    return c;
  }

  /**
   * Відсоток від 1ПМ на заданому тижні (нумерація з 1), без урахування
   * стелі конкретної вправи.
   */
  function pctForWeek(cfg, week) {
    const c = normalize(cfg);
    const w = Math.min(c.weeks, Math.max(1, Math.round(Number(week) || 1)));
    const block = Math.floor((w - 1) / c.cadence);
    const pct = c.startPct + c.stepPct * block;
    return Math.min(LIMITS.endPct[1], pct);
  }

  /* ========================================================================
     ОЦІНКА 1ПМ ДЛЯ ВПРАВИ
     ======================================================================== */

  /**
   * Вправи, для яких у профілі є виміряний рекорд. Виміряне завжди краще
   * за оцінене, тому для них формули не потрібні.
   *
   * Список навмисно короткий: у бібліотеці немає класичної станової й тяги
   * в нахилі, а вішати рекорд станової на «станову на прямих ногах» —
   * це різні вправи з різними цифрами.
   */
  const RECORD_BY_NAME = {
    'Присідання зі штангою':       'squat',
    'Жим штанги лежачи':           'bench',
    'Армійський жим штанги стоячи': 'ohp'
  };

  /** Середина діапазону повторень із рядка плану: '6–8' → 7, '8' → 8 */
  function midReps(reps) {
    const nums = String(reps == null ? '' : reps).match(/\d+/g);
    if (!nums || !nums.length) return null;
    const a = Number(nums[0]);
    const b = nums.length > 1 ? Number(nums[1]) : a;
    const m = (a + b) / 2;
    return Number.isFinite(m) && m > 0 ? m : null;
  }

  /**
   * Оцінка разового максимуму вправи.
   *
   * Порядок джерел: виміряний рекорд → оцінка з робочої ваги → нічого.
   *
   * Оцінка рахується не з самої кількості повторень, а з повторень «до
   * відмови»: якщо в плані 6–8 при RIR 2, то до відмови було б 7 + 2 = 9.
   * Без цієї поправки 1ПМ систематично занижувався б, бо робоча вага
   * береться з підходу, який свідомо не доводиться до кінця.
   *
   * @param {{name:string, reps?:string, rir?:number|string}} ex вправа плану
   * @param {number|null} weight робоча вага з книги ваг, кг
   * @param {object} records profile.records
   * @returns {{value:number, source:'record'|'estimate'}|null}
   */
  function estimateOneRM(ex, weight, records) {
    if (!ex || !ex.name) return null;

    const recKey = RECORD_BY_NAME[ex.name];
    if (recKey && records) {
      const rec = Number(records[recKey]);
      if (Number.isFinite(rec) && rec > 0) return { value: rec, source: 'record' };
    }

    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) return null;

    const reps = midReps(ex.reps) || 8;
    const rir = Number(ex.rir);
    const toFailure = reps + (Number.isFinite(rir) && rir >= 0 ? Math.min(rir, 5) : 0);

    const est = OneRM.oneRepMax(w, toFailure);
    return est === null ? null : { value: est, source: 'estimate' };
  }

  /* ========================================================================
     ПОБУДОВА ЦИКЛУ
     ======================================================================== */

  /**
   * Один рядок таблиці: вправа × тиждень.
   * @typedef {{pct:number, weight:number, reps:number, capped:boolean}} Cell
   */

  /**
   * Порахувати цикл для набору вправ.
   *
   * @param {object} cfg налаштування циклу
   * @param {{name:string, reps?:string, rir?:number, lift?:string}[]} exercises
   *        унікальні вправи плану
   * @param {(name:string)=>number|null} weightOf доступ до книги ваг
   * @param {object} records profile.records
   * @returns {{config:object, rows:Array, weeks:number[], skipped:string[]}}
   */
  function buildCycle(cfg, exercises, weightOf, records) {
    const c = normalize(cfg);
    const weeks = [];
    for (let i = 1; i <= c.weeks; i++) weeks.push(i);

    const rows = [];
    const skipped = [];

    (exercises || []).forEach(function (ex) {
      if (!ex || !ex.name) return;

      // Заморожений 1ПМ має пріоритет: цикл не повинен «попливти» від того,
      // що посеред нього змінилась робоча вага в книзі або спрацював деслоуд.
      const frozen = Number(c.oneRM[ex.name]);
      const est = Number.isFinite(frozen) && frozen > 0
        ? { value: frozen, source: 'frozen' }
        : estimateOneRM(ex, weightOf ? weightOf(ex.name) : null, records);

      if (!est) { skipped.push(ex.name); return; }

      const kind = window.liftKind ? window.liftKind(ex) : 'isolation';
      const ceiling = CEILING[kind];

      const cells = weeks.map(function (w) {
        const raw = pctForWeek(c, w);
        const pct = Math.min(raw, ceiling);

        // Скільки вийшло б до відмови — і скільки з цього насправді робимо
        const toFailure = OneRM.repsAtPercent(pct);
        const full = toFailure === null ? null : Math.max(1, Math.round(toFailure));
        const reps = full === null ? null : Math.min(full, REP_CAP);

        return {
          pct: pct,
          weight: OneRM.toPlates(est.value * pct / 100, ROUND_STEP[kind]),
          reps: reps,
          // Запас: скільки повторень лишається в баку після підходу.
          // На важких тижнях це 0 — там 12 і так недосяжні.
          reserve: (full === null || reps === null) ? 0 : Math.max(0, full - reps),
          capped: raw > ceiling
        };
      });

      rows.push({
        name: ex.name,
        kind: kind,
        ceiling: ceiling,
        oneRM: est.value,
        source: est.source,
        cells: cells
      });
    });

    return { config: c, rows: rows, weeks: weeks, skipped: skipped };
  }

  /**
   * Який тиждень циклу йде зараз, якщо цикл запущено.
   * @returns {number|null} 1…weeks, або null якщо не запущено чи вже завершено
   */
  function currentWeek(cfg, today) {
    const c = normalize(cfg);
    if (!c.startedAt) return null;
    const start = new Date(c.startedAt);
    const now = today ? new Date(today) : new Date();
    if (isNaN(start.getTime()) || isNaN(now.getTime())) return null;

    /*
     * Рахуємо КАЛЕНДАРНІ дні, а не проміжок часу.
     *
     * startedAt зберігається як повний ISO-час, тому цикл, запущений о 23:00,
     * перемикав «тиждень 2» о 23:00 всередині сьомого дня — посеред
     * тренування. Тиждень має мінятись на межі доби, як його й розуміє людина.
     */
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((nowDay - startDay) / 86400000);
    if (days < 0) return null;
    const week = Math.floor(days / 7) + 1;
    return week > c.weeks ? null : week;
  }

  /* ========================================================================
     СКИДАННЯ ВАГ (деслоуд)
     ======================================================================== */

  /** Дозволені відсотки скидання — від 5 до 50 з кроком 5 */
  const DELOAD_STEPS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

  /**
   * Крок округлення для конкретної ваги.
   *
   * Штангу дрібніше за 2,5 кг не зібрати, але книга ваг не знає, штанга це
   * чи гантель. Розділяємо за самою вагою: усе, що легше за 20 кг, — це
   * майже завжди гантелі, блок або махи, де 2,5 кг занадто грубо.
   */
  function stepFor(weight) {
    return weight >= 20 ? OneRM.PLATE_STEP : 1;
  }

  /**
   * Зменшити всі ваги книги на percent відсотків.
   *
   * Округлення тільки ВНИЗ. Це не дрібниця: при звичайному округленні до
   * найближчого 12 кг мінус 5% дає 11,4 → 12,5, тобто скидання піднімало б
   * вагу. Вниз — гірше на пів кроку, ніж просили, зате ніколи не вгору,
   * а для деслоуду помилка в бік легшого безпечна за визначенням.
   *
   * Повертає НОВИЙ обʼєкт, старий не чіпає: знімок до скидання зберігається
   * окремо, щоб «повернути» відновлював рівно ті числа, а не намагався
   * поділити назад. Ділення назад після округлення не повертає вихідне
   * число, і після двох скидань поспіль розбіжність уже помітна.
   *
   * @param {Object<string, number>} weights книга ваг
   * @param {number} percent 5…50
   * @returns {Object<string, number>}
   */
  function applyDeload(weights, percent) {
    const p = Number(percent);
    const out = {};
    if (!weights || typeof weights !== 'object') return out;

    const k = 1 - p / 100;
    const valid = Number.isFinite(p) && p > 0 && p < 100;

    Object.keys(weights).forEach(function (name) {
      const w = Number(weights[name]);
      if (!Number.isFinite(w) || w <= 0) return;
      if (!valid) { out[name] = w; return; }

      const step = stepFor(w);
      const down = Math.floor((w * k) / step) * step;
      // Мінімум — один крок. Нуль у книзі ваг читається як «не заповнено»,
      // і скидання не повинно мовчки стирати вправу з плану.
      // Math.min страхує від будь-якого зростання остаточно.
      out[name] = Math.min(w, Math.max(step, down));
    });
    return out;
  }

  /**
   * Підняти всі ваги книги на percent відсотків.
   *
   * Дзеркало applyDeload, і округлення так само ВНИЗ: обіцяно «плюс 10%»,
   * і перестрибнути обіцянку вгору при підйомі небезпечніше, ніж недодати
   * пів кроку. Один виняток — мінімум один крок млинця: якщо відсоток дає
   * менше за крок, піднімаємо на крок, бо менший приріст фізично не зібрати.
   * Стеля — MAX_WEIGHT, та сама, що в ручного вводу ваги.
   *
   * @param {Object<string, number>} weights книга ваг
   * @param {number} percent 1…100
   * @returns {Object<string, number>} новий обʼєкт, старий не чіпає
   */
  function applyRaise(weights, percent) {
    const p = Number(percent);
    const out = {};
    if (!weights || typeof weights !== 'object') return out;

    const k = 1 + p / 100;
    const valid = Number.isFinite(p) && p > 0 && p <= 100;

    Object.keys(weights).forEach(function (name) {
      const w = Number(weights[name]);
      if (!Number.isFinite(w) || w <= 0) return;
      if (!valid) { out[name] = w; return; }

      const step = stepFor(w);
      const up = Math.floor((w * k) / step) * step;
      out[name] = Math.min(OneRM.MAX_WEIGHT, Math.max(w + step, up));
    });
    return out;
  }

  /* ======================================================================== */

  window.Periodization = {
    ROUND_STEP: ROUND_STEP,
    REP_CAP: REP_CAP,
    LIMITS: LIMITS,
    DELOAD_STEPS: DELOAD_STEPS,
    defaults: defaults,
    normalize: normalize,
    pctForWeek: pctForWeek,
    /* Експортовані заради тестів (TST-007): обидві — чиста арифметика, і
       перевіряти їх крізь buildCycle означало б перевіряти не те. */
    midReps: midReps,
    estimateOneRM: estimateOneRM,
    CEILING: CEILING,
    buildCycle: buildCycle,
    currentWeek: currentWeek,
    applyDeload: applyDeload,
    applyRaise: applyRaise
  };
})();
