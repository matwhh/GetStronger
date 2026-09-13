/**
 * Ядро трекерів — одна модульна система замість окремої унікальної
 * реалізації на кожен показник. Чисті функції, без DOM, під тестами.
 *
 * Модель (profile.trackers): { [id]: Tracker }
 *   Tracker = { id, type, name, enabled, settings, goal, source, order, createdAt }
 *
 * Убудовані типи (id === type, один екземпляр на тип) описані в
 * TRACKER_DEFS: water, sleep, mood, steps, caffeine, recovery,
 * painFatigue, workoutMood. Користувацькі типи — 'supplement' і 'habit':
 * людина сама створює скільки завгодно іменованих екземплярів, кожен —
 * окремий Tracker із власним id.
 *
 * Дані (profile.trackerLog): { [trackerId]: { 'YYYY-MM-DD': value } }
 * Та сама форма, що в bodyLog/workLog — ключ дня, нове перекриває старе.
 * value залежить від kind:
 *   cumulative/scale                → число
 *   duration/value (БЕЗ hasSource)  → число
 *   duration/value (З hasSource)    → число (старі записи) АБО
 *                                      { value, source, date } (етап 6) —
 *                                      джерело абстраговане: 'manual',
 *                                      'apple_health' чи будь-яке майбутнє
 *                                      джерело. Читай через entryValue()/
 *                                      entrySource(), пиши через ingest()
 *                                      (logValue() для ручного вводу вже
 *                                      робить це сама). Дивись коментар
 *                                      біля ingest() нижче.
 *   pair                            → { [field]: число, ... }
 *   boolean (supplement/habit)      → true (відсутність запису = ні)
 *
 * Новий тип трекера — це новий рядок у TRACKER_DEFS плюс, за потреби,
 * власний kind. Сторінки (trackers-day.js/trackers-settings.js/journal.js) читають
 * каталог і дані через цей модуль — жодна з них не знає формату
 * напряму, тому додавання типу не чіпає жодної з них.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const DAY_MS = 86400000;

  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 10 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function todayKey(d) { return window.DateCore.todayKey(d); }

  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 2 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function dateOf(k) { return window.DateCore.dateOf(k); }

  /* Перший день вікна завдовжки `days`, сьогодні включно. setDate, а не
     віднімання DAY_MS: у ніч переходу на зимовий час доба 25-годинна, і
     мілісекундна арифметика зсуває межу на добу (див. progress-core.js). */
  function cutKey(days, now) {
    const base = now instanceof Date ? now : new Date();
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate() - (Math.max(1, Number(days) || 1) - 1));
    return todayKey(d);
  }

  function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return null;
    return Math.min(Number.isFinite(hi) ? hi : Infinity, Math.max(Number.isFinite(lo) ? lo : -Infinity, n));
  }
  const r1 = function (n) { return Math.round(n * 10) / 10; };

  /* ------------------------------------------------------------------ */
  /* Каталог убудованих трекерів                                         */
  /* ------------------------------------------------------------------ */
  /*
   * kind визначає форму значення й те, як його рахувати:
   *   cumulative — накопичується за день швидкими кнопками (вода, кофеїн)
   *   duration   — тривалість у хвилинах (сон)
   *   value      — довільне число (кроки)
   *   scale      — оцінка 1..10 (настрій, recovery)
   *   pair       — два поля 1..10 (біль/втома, настрій до/після)
   *
   * hasSource позначає трекери, для яких у майбутньому мають сенс дані
   * з Apple Health (сон, кроки) — див. коментар біля setSource нижче.
   */
  const TRACKER_DEFS = {
    water: {
      type: 'water', name: 'Вода', kind: 'cumulative', unit: 'л',
      min: 0, max: 15, presets: [0.25, 0.5, 1], defaultGoal: 2.5
    },
    sleep: {
      type: 'sleep', name: 'Сон', kind: 'duration', unit: 'хв',
      min: 0, max: 960, defaultGoal: 480, hasSource: true
    },
    mood: {
      type: 'mood', name: 'Настрій', kind: 'scale', unit: '', min: 1, max: 10
    },
    steps: {
      type: 'steps', name: 'Кроки', kind: 'value', unit: 'кроків',
      min: 0, max: 100000, defaultGoal: 8000, presets: [1000, 5000], hasSource: true
    },
    caffeine: {
      type: 'caffeine', name: 'Кофеїн', kind: 'cumulative', unit: 'мг',
      min: 0, max: 2000, presets: [30, 80, 150]
    },
    recovery: {
      type: 'recovery', name: 'Recovery', kind: 'scale', unit: '', min: 1, max: 10
    },
    painFatigue: {
      type: 'painFatigue', name: 'Біль / втома', kind: 'pair',
      fields: ['pain', 'fatigue'], min: 1, max: 10
    },
    workoutMood: {
      type: 'workoutMood', name: 'Настрій до/після тренування', kind: 'pair',
      fields: ['before', 'after'], min: 1, max: 10, linkedToSession: true
    },

    /*
     * ЗАМІРИ ТІЛА — трекер іншої породи, і це навмисно.
     *
     * Усі решта записують ОДНЕ число за день у trackerLog. Заміри — це
     * півтора десятка обхватів, які роблять раз на два-три тижні, і живуть
     * вони у власному журналі (profile.measureLog). Втягувати їх у
     * trackerLog означало б завести друге джерело правди про те саме тіло,
     * а розходження двох джерел — найдорожча вада, яку тільки можна собі
     * зробити в щоденнику.
     *
     * Тому тут зареєстровано не «ще один кубик», а ПРЕДСТАВНИЦТВО розділу
     * в реєстрі трекерів: kind 'card' не має ні значення, ні цілі, ні
     * швидкого вводу. Єдине, чим він користується, — спільний механізм
     * «увімкнено / винесено на Сьогодні». Саме його людина і шукає, коли
     * хоче прибрати картку з головної: вона йде в трекери, а не в код.
     *
     * external каже сторінкам прямо: значення НЕ в trackerLog, не шукайте
     * його там і не рахуйте порожнечу за нуль.
     */
    measure: {
      type: 'measure', name: 'Заміри тіла', kind: 'card', unit: 'см',
      external: 'measureLog', page: 'measure.html'
    }
  };

  const BUILTIN_ORDER = ['water', 'sleep', 'mood', 'steps', 'caffeine', 'recovery', 'painFatigue', 'workoutMood', 'measure'];

  /* Приклад із теху: користувач бачить чотири увімкнені й чотири вимкнені
     трекери одразу — це той самий набір, лише перелічений явно тут. */
  const DEFAULT_ENABLED = { water: true, sleep: true, mood: true, recovery: true, measure: true };

  /*
   * Єдиний трекер, закріплений з коробки. Решта зʼявляються на «Сьогодні»
   * лише коли людина сама їх туди винесе — і це правильно для кубика, що
   * просить щоденного вводу. Заміри нічого не просять: картка лише
   * показує, коли міряли востаннє. Її прибирають тим самим перемикачем,
   * яким закріплюють решту.
   */
  const DEFAULT_PINNED = { measure: true };

  /*
   * Добавки «з коробки». Це ті самі користувацькі трекери типу supplement —
   * просто засіяні наперед, бо їх приймає майже кожен у залі. Людина може
   * вимкнути чи видалити їх так само, як і власні.
   *
   * dose — типова доза в грамах: галочка «прийняв» без вводу числа пише
   * саме її. Добавка без dose лишається простою позначкою так/ні.
   */
  const DEFAULT_SUPPLEMENTS = [
    { id: 'creatine', name: 'Креатин моногідрат', dose: 5, unit: 'г' }
  ];
  const DOSE_MAX = 500;

  /* ------------------------------------------------------------------ */
  /* Реєстр: profile.trackers                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Догодувати реєстр убудованими трекерами, яких там ще немає. Не чіпає
   * наявні записи — увімкнено/ціль/налаштування людини лишаються як були.
   *
   * Безпечно викликати щоразу перед рендером, а не лише один раз під час
   * міграції профілю: якщо пізніше додасться новий тип у TRACKER_DEFS,
   * він з'явиться сам при наступному відкритті сторінки, без нової
   * міграції й без ризику переписати чиїсь вимкнені трекери.
   */
  function ensureBuiltins(trackers) {
    const src = isPlain(trackers) ? trackers : {};
    const out = Object.assign({}, src);
    let changed = false;
    BUILTIN_ORDER.forEach(function (id, i) {
      if (out[id]) return;
      const def = TRACKER_DEFS[id];
      out[id] = {
        id: id, type: def.type, name: def.name,
        enabled: Boolean(DEFAULT_ENABLED[id]),
        pinned: Boolean(DEFAULT_PINNED[id]),
        settings: {},
        goal: def.defaultGoal != null ? def.defaultGoal : null,
        source: def.hasSource ? 'manual' : null,
        order: i,
        createdAt: null
      };
      changed = true;
    });
    DEFAULT_SUPPLEMENTS.forEach(function (d, i) {
      if (out[d.id]) return;
      out[d.id] = {
        id: d.id, type: 'supplement', name: d.name, enabled: true,
        settings: { dose: d.dose, unit: d.unit },
        goal: null, source: null,
        order: 500 + i,
        createdAt: null
      };
      changed = true;
    });
    return changed ? out : src;
  }

  /* ------------------------------------------------------------------ */
  /* Дози добавок                                                        */
  /* ------------------------------------------------------------------ */

  /** Доза в грамах: скінченна, 0,1..500, крок 0,1 г; інакше null */
  function normDose(v) {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > DOSE_MAX) return null;
    return Math.round(n * 10) / 10;
  }

  /** Добавка з дозою (грами), а не проста позначка так/ні */
  function isDosed(t) {
    return Boolean(t && t.type === 'supplement' && isPlain(t.settings) && normDose(t.settings.dose) !== null);
  }

  /** Типова доза добавки, г (null — добавка без дози) */
  function doseOf(t) {
    return isDosed(t) ? normDose(t.settings.dose) : null;
  }

  /** Задати типову дозу; null/сміття — прибрати дозу (стане позначкою) */
  function setDose(trackers, id, grams) {
    const src = isPlain(trackers) ? trackers : {};
    const t = src[id];
    if (!t || t.type !== 'supplement') return src;
    const dose = normDose(grams);
    const settings = Object.assign({}, isPlain(t.settings) ? t.settings : {});
    if (dose === null) { delete settings.dose; delete settings.unit; }
    else { settings.dose = dose; settings.unit = 'г'; }
    const out = Object.assign({}, src);
    out[id] = Object.assign({}, t, { settings: settings });
    return out;
  }

  /**
   * Чи «зроблено» запис булевого трекера. Позначка — true; добавка з
   * дозою пише число грамів, і будь-яке додатне число теж означає
   * «прийнято». Старі записи (true) читаються без міграції.
   */
  function taken(v) {
    return v === true || (typeof v === 'number' && v > 0);
  }

  /** Грами з запису дня (null для простої позначки чи порожнього дня) */
  function gramsOf(v) {
    return (typeof v === 'number' && v > 0) ? v : null;
  }

  /** Створити власний екземпляр (добавка або звичка). Повертає null, якщо
      назва порожня — порожніх пунктів списку не буває. */
  function addCustom(trackers, type, name, dose) {
    if (type !== 'supplement' && type !== 'habit') return null;
    const nm = String(name || '').trim().slice(0, 60);
    if (!nm) return null;

    const src = isPlain(trackers) ? trackers : {};
    const id = type + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const out = Object.assign({}, src);
    const d = type === 'supplement' ? normDose(dose) : null;
    out[id] = {
      id: id, type: type, name: nm, enabled: true,
      settings: d !== null ? { dose: d, unit: 'г' } : {},
      goal: null, source: null,
      order: 1000 + Object.keys(src).length,
      createdAt: todayKey()
    };
    return { trackers: out, id: id };
  }

  /** Прибрати власний екземпляр. Убудовані трекери так не видаляються —
      їх лише вимикають (toggleEnabled), бо їхній тип живе в коді, а не
      тільки в даних. */
  function removeCustom(trackers, id) {
    const src = isPlain(trackers) ? trackers : {};
    const t = src[id];
    if (!t || (t.type !== 'supplement' && t.type !== 'habit')) return src;
    const out = Object.assign({}, src);
    /* Добавка «з коробки» не видаляється, а вимикається: інакше
       ensureBuiltins засіяв би її знову при наступному відкритті, і
       «видалив» перетворювалось на «воскрес через хвилину». */
    if (isDefaultSupplement(id)) {
      out[id] = Object.assign({}, t, { enabled: false });
      return out;
    }
    delete out[id];
    return out;
  }

  function isDefaultSupplement(id) {
    return DEFAULT_SUPPLEMENTS.some(function (d) { return d.id === id; });
  }

  function setEnabled(trackers, id, enabled) {
    const src = isPlain(trackers) ? trackers : {};
    if (!src[id]) return src;
    const on = Boolean(enabled);
    const out = Object.assign({}, src);
    /*
     * ВИМКНЕНИЙ ТРЕКЕР НЕ МОЖЕ ЛИШАТИСЬ ЗАКРІПЛЕНИМ.
     *
     * Інакше зʼявляється привид: трекера немає ніде, а прапорець «на
     * Сьогодні» в нього стоїть — і варто його колись увімкнути знову, як
     * на головній без попередження виринає кубик, про який людина давно
     * забула. Закріплення тут не «памʼятається на потім», воно
     * знімається.
     */
    out[id] = Object.assign({}, out[id], { enabled: on });
    if (!on) out[id].pinned = false;
    return out;
  }

  /*
   * ЗАКРІПЛЕННЯ НА ЕКРАНІ «СЬОГОДНІ».
   *
   * ЧОМУ ЦЕ ОКРЕМИЙ ПРАПОРЕЦЬ, А НЕ enabled. Це різні питання. enabled
   * означає «я веду цей трекер» — він є на сторінці трекерів, входить у
   * зведення, його історія рахується. pinned означає «він мені потрібен
   * перед очима щодня».
   *
   * Різниця не теоретична: колись усі трекери жили на головній, і вона
   * перетворилась на довгий стовпчик шкал 1..10 — саме тому їх звідти й
   * прибрали (див. шапку js/trackers-day.js). Повернути їх усі скопом
   * означало б повторити ту саму помилку. Тому головну наповнює людина:
   * два-три кубики, які вона справді закриває щодня.
   *
   * Типово не закріплено нічого. Порожній екран «Сьогодні» лишається
   * таким, яким був, доки власник сам не винесе туди перший трекер.
   */
  function setPinned(trackers, id, on) {
    const src = isPlain(trackers) ? trackers : {};
    if (!src[id]) return src;
    const out = Object.assign({}, src);
    /* Закріпити можна лише те, що ведеться: кубик трекера, який вимкнено,
       нікуди не запише — сторінка трекерів його вже не показує. */
    const want = Boolean(on) && out[id].enabled === true;
    out[id] = Object.assign({}, out[id], { pinned: want });
    return out;
  }

  /**
   * Трекери для екрана «Сьогодні»: увімкнені, закріплені, у своєму порядку.
   *
   * workoutMood сюди не потрапляє ніколи — не через вибір оформлення, а
   * через саму його природу: linkedToSession означає, що питання «як ти
   * почувався до і після» має сенс лише поруч із тренуванням, і
   * відповідає на нього сторінка тренування. Кубик із ним на головній
   * питав би про підхід, якого сьогодні могло й не бути.
   */
  function pinnedList(trackers) {
    return active(trackers).filter(function (t) {
      if (t.pinned !== true) return false;
      const def = defFor(t);
      if (!def || def.linkedToSession === true) return false;
      /* Картки — не кубики: у них немає значення, яке можна намалювати в
         сітці плиток. Сітка, що отримала б таку, показала б порожнє поле
         вводу для журналу, якого не існує. */
      return def.kind !== 'card';
    });
  }

  /** Чи це представництво розділу, а не кубик із числом. */
  function isCard(tracker) {
    const def = defFor(tracker);
    return Boolean(def) && def.kind === 'card';
  }

  /** Закріплені на «Сьогодні» картки-розділи, у своєму порядку. */
  function pinnedCards(trackers) {
    return active(trackers).filter(function (t) {
      return t.pinned === true && isCard(t);
    });
  }

  /** Чи закріплено конкретний трекер (і чи він узагалі увімкнений). */
  function isPinned(trackers, id) {
    const src = isPlain(trackers) ? trackers : {};
    const t = src[id];
    return Boolean(t && t.enabled === true && t.pinned === true);
  }

  /**
   * Денна ціль трекера.
   *
   * Клампимо за межами САМОГО трекера з каталогу: поле вводу більше не
   * має native min/max (воно стало type="text" inputmode="decimal", бо
   * type="number" на iOS мовчки з'їдає десяткову кому), тож єдиний рубіж
   * тепер тут. Ціль 99999 л води робила смугу прогресу вічно порожньою,
   * а «дотримання цілі» — вічним нулем.
   */
  function setGoal(trackers, id, goal) {
    const src = isPlain(trackers) ? trackers : {};
    if (!src[id]) return src;
    const def = TRACKER_DEFS[src[id].type];
    const g = Number(goal);
    const ok = Number.isFinite(g) && g > 0;
    const capped = ok && def ? Math.min(g, def.max) : g;
    const out = Object.assign({}, src);
    out[id] = Object.assign({}, out[id], { goal: ok ? capped : null });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Тижнева ціль (F3)                                                   */
  /* ------------------------------------------------------------------ */
  /*
   * ЧОМУ ВОНА ПОТРІБНА. Денний стрік карає за пропуск: один забутий
   * понеділок обнуляє серію з тридцяти днів. Але у звички «тричі на
   * тиждень» пропущений понеділок — це не помилка взагалі, це один із
   * чотирьох вільних днів. Тобто показник карав за те, що правилами
   * дозволено, і саме тому люди кидали трекер після першого пропуску.
   *
   * Тиждень — з понеділка, місцевим днем, через DateCore.mondayOf. Жодної
   * власної арифметики дат тут немає навмисно: чотири різні mondayOf у
   * чотирьох файлах — це вже було, і саме воно давало різні тижні на
   * різних екранах у ніч переходу на літній час.
   *
   * Що вважається виконаним днем. Якщо в трекера є ДЕННА ціль — день,
   * який її досягає. Якщо денної цілі немає (звички, добавки, шкали без
   * цілі), то будь-який записаний день: тижнева ціль без денної означає
   * «скільки днів на тиждень я це взагалі робив», і це чесна відповідь на
   * питання, яке людина ставила, коли писала «3 з 7».
   */
  const WEEK_GOAL_MIN = 1, WEEK_GOAL_MAX = 7;

  /**
   * Тижнева ціль трекера: скільки днів на тиждень.
   * @param {number|null} n 1–7; усе поза межами або сміття — знімає ціль
   */
  function setWeekGoal(trackers, id, n) {
    const src = isPlain(trackers) ? trackers : {};
    if (!src[id]) return src;
    const raw = Math.round(Number(n));
    /* Понад 7 — обрізаємо, а не відкидаємо: людина, яка написала «10 днів
       на тиждень», хотіла «щодня», і сказати їй «неправильне значення»
       означало б сперечатись замість зрозуміти. */
    const ok = Number.isFinite(raw) && raw >= WEEK_GOAL_MIN;
    const out = Object.assign({}, src);
    out[id] = Object.assign({}, out[id],
      { weekGoal: ok ? Math.min(raw, WEEK_GOAL_MAX) : null });
    return out;
  }

  /** Тижнева ціль трекера або null */
  function weekGoalOf(tracker) {
    const n = Math.round(Number(tracker && tracker.weekGoal));
    if (!Number.isFinite(n) || n < WEEK_GOAL_MIN) return null;
    return Math.min(n, WEEK_GOAL_MAX);
  }

  /** Ключ понеділка того тижня, у який потрапляє дата */
  function weekStartKey(now) {
    return todayKey(window.DateCore.mondayOf(now instanceof Date ? now : new Date()));
  }

  /**
   * Чи день виконано з погляду тижневої цілі.
   * @param {object} tracker трекер із реєстру
   * @param {*} raw запис журналу за день (може бути обʼєктом зі value)
   */
  function dayDone(tracker, raw) {
    if (raw === null || raw === undefined) return false;
    const def = defFor(tracker);
    if (!def) return false;
    if (def.kind === 'boolean' || def.kind === 'dose') return taken(raw);
    if (def.kind === 'pair' || def.kind === 'card') return false;

    const v = entryValue(raw);
    if (v === null) return false;
    const goal = Number(tracker.goal);
    /* Без денної цілі порівнювати ні з чим: записаний день = зроблений */
    if (!Number.isFinite(goal) || goal <= 0) return true;
    return v >= goal;
  }

  /**
   * Тиждень трекера з тижневою ціллю: {done, goal, start, left}.
   * null — у трекера тижневої цілі немає, і тоді діє старе поводження.
   */
  function weekStats(tracker, log, now) {
    const goal = weekGoalOf(tracker);
    if (!goal) return null;
    const start = weekStartKey(now);
    const day = (isPlain(log) && isPlain(log[tracker.id])) ? log[tracker.id] : {};
    let done = 0;
    for (let i = 0; i < 7; i++) {
      const k = window.DateCore.shiftKey(start, i);
      if (dayDone(tracker, day[k])) done++;
    }
    return { done: done, goal: goal, start: start, left: Math.max(0, goal - done) };
  }

  /**
   * Скільки тижнів ПОСПІЛЬ ціль закрита, рахуючи назад.
   *
   * Поточний тиждень не програний, поки не скінчився: якщо ціль у ньому
   * ще не закрита, рахунок починається з минулого. Те саме правило, що в
   * денному стріку, — інакше в понеділок уранці серія обнулялася б щоразу.
   */
  function weekStreak(tracker, log, now) {
    const goal = weekGoalOf(tracker);
    if (!goal) return 0;
    const day = (isPlain(log) && isPlain(log[tracker.id])) ? log[tracker.id] : {};
    const doneIn = function (startKey) {
      let n = 0;
      for (let i = 0; i < 7; i++) {
        if (dayDone(tracker, day[window.DateCore.shiftKey(startKey, i)])) n++;
      }
      return n;
    };

    let cursor = weekStartKey(now);
    if (doneIn(cursor) < goal) cursor = window.DateCore.shiftKey(cursor, -7);
    let weeks = 0;
    while (doneIn(cursor) >= goal) {
      weeks++;
      cursor = window.DateCore.shiftKey(cursor, -7);
      /* Стеля на випадок журналу, зібраного імпортом: без неї цикл
         крутився б по порожніх тижнях лише доки не скінчиться терпіння. */
      if (weeks > 520) break;
    }
    return weeks;
  }

  /*
   * Джерело даних (режим трекера): 'manual' | 'apple_health'. Зараз
   * web-середовище Get Stronger не має доступу до Apple Health, і жодного разу
   * з-під web його не отримає — тому цю функцію свідомо НЕ підключено до
   * жодної кнопки в інтерфейсі. Поле в моделі й enum тут лишаються
   * заготовкою: коли з'явиться мобільний застосунок, він зможе писати
   * source:'apple_health' в той самий запис без зміни форми даних.
   * Імітувати перемикач, який нічого не робить, гірше, ніж не показувати
   * його зовсім.
   */
  const SOURCES = { MANUAL: 'manual', APPLE_HEALTH: 'apple_health' };

  function setSource(trackers, id, source) {
    const src = isPlain(trackers) ? trackers : {};
    if (!src[id] || (source !== SOURCES.MANUAL && source !== SOURCES.APPLE_HEALTH)) return src;
    const out = Object.assign({}, src);
    out[id] = Object.assign({}, out[id], { source: source });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Абстракція джерела ЗАПИСУ (етап 6): manual / apple_health / ...      */
  /* ------------------------------------------------------------------ */
  /*
   * hasSource-трекери (зараз — сон і кроки) зберігають запис дня не голим
   * числом, а обʼєктом { value, source, date } — те саме, що прийде з
   * майбутнього мобільного застосунку через ingest(). 'date' у записі —
   * це той самий ключ дня, під яким запис лежить у журналі; дублюється
   * всередині обʼєкта, щоб запис лишався самодостатнім, якщо колись
   * знадобиться поза контекстом журналу (наприклад, у черзі синхронізації).
   *
   * Один слот на день на трекер (той самий setEntry, що завжди) означає:
   * другий запис за той самий день ЗАМІНЮЄ перший, а не додається поруч —
   * тому ручний і Apple Health записи за один день ніколи не дублюються,
   * просто останній запис перемагає й несе власний source.
   *
   * Стара форма (голе число) читається й далі — entryValue()/entrySource()
   * приймають обидві форми, тож жодні наявні дані користувача не ламаються.
   */

  /** Число зі старого (голе число) або нового ({value,...}) запису. */
  function entryValue(raw) {
    if (isPlain(raw)) {
      const n = Number(raw.value);
      return Number.isFinite(n) ? n : null;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /** Джерело запису; голі числа (уся історія до цього етапу) — 'manual'. */
  function entrySource(raw) {
    if (isPlain(raw) && typeof raw.source === 'string' && raw.source) return raw.source;
    return SOURCES.MANUAL;
  }

  /**
   * Єдина точка входу для запису значення hasSource-трекера з довільного
   * джерела. Веб-UI викликає її опосередковано через logValue() із
   * source='manual'; той самий виклик, з тим самим id трекера й тим самим
   * journal-форматом, зможе зробити майбутній Get Stronger Mobile з
   * source:'apple_health' (або будь-яким іншим рядком — джерело НЕ
   * звужене жорстко до Apple, звідси приймається будь-який непорожній
   * рядок, а не лише перелік із двох значень).
   */
  function ingest(trackers, log, id, value, source, date) {
    const src = isPlain(log) ? log : {};
    const t = isPlain(trackers) ? trackers[id] : null;
    if (!t) return src;
    const def = TRACKER_DEFS[t.type];
    if (!def || !def.hasSource) return src;

    const d = DATE_KEY.test(date) ? date : todayKey();
    const n = Number(value);
    if (!Number.isFinite(n)) return src;
    const clamped = clamp(Math.round(n), def.min, def.max);
    if (clamped === null) return src;

    const s = (typeof source === 'string' && source.trim()) ? source.trim().slice(0, 40) : SOURCES.MANUAL;
    return setEntry(src, id, { value: clamped, source: s, date: d }, d);
  }

  function list(trackers) {
    const src = isPlain(trackers) ? trackers : {};
    return Object.keys(src).map(function (id) { return src[id]; })
      .filter(Boolean)
      .sort(function (a, b) {
        const oa = Number(a.order) || 0, ob = Number(b.order) || 0;
        if (oa !== ob) return oa - ob;
        return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1;
      });
  }

  function active(trackers) {
    return list(trackers).filter(function (t) { return t.enabled; });
  }

  function byType(trackers, type) {
    return list(trackers).filter(function (t) { return t.type === type; });
  }

  /** Метадані kind/unit/межі для трекера: з каталогу для убудованих,
      булевий тип для кастомних добавок/звичок. */
  function defFor(tracker) {
    if (!tracker) return null;
    if (TRACKER_DEFS[tracker.type]) return TRACKER_DEFS[tracker.type];
    if (isDosed(tracker)) return { type: 'supplement', kind: 'dose', unit: 'г', min: 0, max: DOSE_MAX };
    if (tracker.type === 'supplement' || tracker.type === 'habit') {
      return { type: tracker.type, kind: 'boolean', unit: '' };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Дані: profile.trackerLog                                            */
  /* ------------------------------------------------------------------ */

  /** Записати значення дня (заміна, не додавання). НЕ мутує вхідний журнал. */
  function setEntry(log, id, value, date) {
    const d = DATE_KEY.test(date) ? date : todayKey();
    const src = isPlain(log) ? log : {};
    const prevDay = isPlain(src[id]) ? src[id] : {};
    const out = Object.assign({}, src);
    out[id] = Object.assign({}, prevDay);
    out[id][d] = value;
    return out;
  }

  /**
   * Злити СЬОГОДНІШНІ значення з `next` у базу `base`.
   *
   * ЧОМУ ЦЕ ТУТ, А НЕ НА СТОРІНЦІ. Журнал трекерів зберігається як одне
   * поле профілю, і Store.saveProfile зливає поля поверхнево — тобто
   * { trackerLog: X } замінює ВЕСЬ журнал. Дві вкладки з однаковою базою
   * затирали одна одну повністю (SYN-011). Ліки — патч-функція, яка
   * переносить лише сьогоднішній день кожного трекера в актуальний
   * профіль; історія й трекери, яких ця вкладка не бачила, лишаються.
   *
   * Тепер таких місць два — сторінка трекерів і кубики на «Сьогодні», —
   * а логіка одна. Копія розійшлася б, і розійшлася б тихо: помилка тут
   * не ламає екран, вона просто не зберігає (саме так уже було —
   * next[today] шукало ДАТУ на верхньому рівні журналу, який
   * ключований трекером).
   *
   * @param {object} base   trackerLog з актуального профілю
   * @param {object} next   trackerLog екрана (джерело сьогоднішніх значень)
   * @param {string} date   ключ дня 'РРРР-ММ-ДД'
   */
  function mergeDay(base, next, date) {
    const src = isPlain(base) ? base : {};
    const from = isPlain(next) ? next : {};
    const out = Object.assign({}, src);
    Object.keys(from).forEach(function (id) {
      const day = isPlain(from[id]) ? from[id][date] : undefined;
      const cur = isPlain(out[id]) ? Object.assign({}, out[id]) : {};
      /* undefined означає «сьогодні запису немає» — тобто його стерли.
         Саме тому тут delete, а не пропуск: інакше стерте значення
         поверталося б із профілю при наступному злитті. */
      if (day === undefined) delete cur[date];
      else cur[date] = day;
      if (Object.keys(cur).length) out[id] = cur;
      else delete out[id];
    });
    return out;
  }

  function removeEntry(log, id, date) {
    const src = isPlain(log) ? log : {};
    if (!isPlain(src[id]) || !(date in src[id])) return src;
    const out = Object.assign({}, src);
    out[id] = Object.assign({}, out[id]);
    delete out[id][date];
    return out;
  }

  /**
   * Універсальний запис значення дня з клампом за каталогом трекера.
   * Для булевих (supplement/habit) — true пише позначку, false/null її
   * знімає: відсутність запису й означає «не зроблено», окремого прапорця
   * не треба. Для pair — value це { field: число, ... }, зливається з уже
   * записаним того дня (можна оновити лише одне поле пари).
   */
  function logValue(trackers, log, id, value, date) {
    const src = isPlain(log) ? log : {};
    const t = isPlain(trackers) ? trackers[id] : null;
    if (!t) return src;
    const d = DATE_KEY.test(date) ? date : todayKey();

    if (isDosed(t)) {
      /* true = «прийняв типову дозу»; число = стільки грамів; решта —
         зняти позначку. Нуль грамів — це «не приймав», а не запис. */
      if (value === true) return setEntry(src, id, doseOf(t), d);
      const g = normDose(value);
      return g !== null ? setEntry(src, id, g, d) : removeEntry(src, id, d);
    }
    if (t.type === 'supplement' || t.type === 'habit') {
      return value ? setEntry(src, id, true, d) : removeEntry(src, id, d);
    }

    const def = TRACKER_DEFS[t.type];
    if (!def) return src;

    if (def.kind === 'pair') {
      if (!isPlain(value)) return src;
      const cur = isPlain(src[id]) && isPlain(src[id][d]) ? src[id][d] : {};
      const next = Object.assign({}, cur);
      def.fields.forEach(function (f) {
        if (value[f] === undefined) return;
        const n = clamp(Math.round(Number(value[f])), def.min, def.max);
        if (n !== null) next[f] = n;
      });
      return setEntry(src, id, next, d);
    }

    /* Сон і кроки (hasSource) записуються через ingest() з source:'manual' —
       той самий { value, source, date } запис, що зможе писати мобільний
       застосунок, лише з іншим джерелом. Публічна сигнатура logValue() не
       змінюється: сторінки як і раніше просто передають число. */
    if (def.hasSource && (def.kind === 'duration' || def.kind === 'value')) {
      return ingest(trackers, src, id, value, SOURCES.MANUAL, d);
    }

    const n = Number(value);
    if (!Number.isFinite(n)) return src;
    const clamped = def.kind === 'duration' || def.kind === 'value'
      ? clamp(Math.round(n), def.min, def.max)
      : clamp(r1(n), def.min, def.max);
    if (clamped === null) return src;
    return setEntry(src, id, clamped, d);
  }

  /** Швидке додавання для накопичувальних трекерів (вода, кофеїн):
      сьогоднішнє значення + delta, у межах каталогу. */
  function addDelta(trackers, log, id, delta, date) {
    const src = isPlain(log) ? log : {};
    const t = isPlain(trackers) ? trackers[id] : null;
    const def = t && TRACKER_DEFS[t.type];
    if (!def || def.kind !== 'cumulative') return src;
    const d = DATE_KEY.test(date) ? date : todayKey();
    const cur = Number((src[id] || {})[d]) || 0;
    /* Два знаки, а не один: кнопка каже «+0,25 л», і записати 0,3 —
       означає збрехати на першому ж тапі (а на другому — 0,55 → 0,6). */
    const next = clamp(Math.round((cur + Number(delta)) * 100) / 100, def.min, def.max);
    if (next === null) return src;
    return setEntry(src, id, next, d);
  }

  function entriesFor(log, id) {
    const day = (isPlain(log) && isPlain(log[id])) ? log[id] : {};
    return Object.keys(day)
      .filter(function (k) { return DATE_KEY.test(k); })
      .sort()
      .map(function (k) { return { d: k, v: day[k] }; });
  }

  function lastEntries(log, id, n) {
    return entriesFor(log, id).slice(-Math.max(1, n || 7)).reverse();
  }

  /** Streak — послідовні дні true, рахуючи назад від сьогодні. Якщо
      сьогодні ще не позначено, день не програний, поки він не скінчився:
      рахунок починається з учора. */
  function streak(log, id, now) {
    const day = (isPlain(log) && isPlain(log[id])) ? log[id] : {};
    const cursor = now instanceof Date ? new Date(now) : new Date();
    if (!day[todayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
    let n = 0;
    while (taken(day[todayKey(cursor)])) {
      n++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Зведення для «Моїх трекерів» і Progress                             */
  /* ------------------------------------------------------------------ */

  /** Числові трекери (cumulative/duration/value/scale): середнє, останнє,
      простий тренд — друга половина періоду проти першої. */
  function numericSummary(log, id, periodDays, now) {
    const from = periodDays ? cutKey(periodDays, now) : null;
    const s = entriesFor(log, id)
      .filter(function (e) { return !from || e.d >= from; })
      .filter(function (e) { return entryValue(e.v) !== null; });
    if (!s.length) return null;

    const nums = s.map(function (e) { return entryValue(e.v); });
    const avg = nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
    const latest = s[s.length - 1];

    let trend = null;
    if (s.length >= 4) {
      const mid = Math.floor(s.length / 2);
      const a1 = nums.slice(0, mid).reduce(function (a, b) { return a + b; }, 0) / mid;
      const a2 = nums.slice(mid).reduce(function (a, b) { return a + b; }, 0) / (nums.length - mid);
      const noise = Math.max(0.05 * Math.abs(a1 || 1), 1e-6);
      trend = a2 > a1 + noise ? 'up' : a2 < a1 - noise ? 'down' : 'flat';
    }

    return { avg: r1(avg), count: s.length, latest: entryValue(latest.v), latestDate: latest.d, trend: trend };
  }

  /** Одне поле pair-трекера (наприклад, 'pain' з painFatigue). */
  function pairSummary(log, id, field, periodDays, now) {
    const from = periodDays ? cutKey(periodDays, now) : null;
    const s = entriesFor(log, id)
      .filter(function (e) { return !from || e.d >= from; })
      .filter(function (e) { return isPlain(e.v) && Number.isFinite(Number(e.v[field])); });
    if (!s.length) return null;

    const nums = s.map(function (e) { return Number(e.v[field]); });
    const avg = nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
    const latest = s[s.length - 1];
    return { avg: r1(avg), count: s.length, latest: Number(latest.v[field]), latestDate: latest.d };
  }

  /** Середнє виконання цілі у % (значення/ціль, кожен день обрізаний до
      100% — переперевиконання одного дня не маскує недобір іншого). */
  function goalAdherence(log, id, goal, periodDays, now) {
    if (!(Number(goal) > 0)) return null;
    const from = periodDays ? cutKey(periodDays, now) : null;
    const s = entriesFor(log, id)
      .filter(function (e) { return !from || e.d >= from; })
      .filter(function (e) { return entryValue(e.v) !== null; });
    if (!s.length) return null;

    const ratios = s.map(function (e) { return Math.min(1, entryValue(e.v) / Number(goal)); });
    const pct = Math.round(ratios.reduce(function (a, b) { return a + b; }, 0) / ratios.length * 100);
    return { pct: pct, count: s.length };
  }

  /** Булеві трекери (звички/добавки): скільки днів виконано з календарних
      днів періоду — не з кількості записів (порожній день теж день). */
  function boolSummary(log, id, periodDays, createdAtKey, now) {
    const base = now instanceof Date ? now : new Date();
    const from = periodDays ? cutKey(periodDays, base) : null;
    const start = from && createdAtKey ? (createdAtKey > from ? createdAtKey : from)
      : (from || createdAtKey || todayKey(base));

    const totalDays = Math.max(1, Math.round(
      (dateOf(todayKey(base)).getTime() - dateOf(start).getTime()) / DAY_MS) + 1);

    const day = (isPlain(log) && isPlain(log[id])) ? log[id] : {};
    let done = 0;
    Object.keys(day).forEach(function (k) {
      if (DATE_KEY.test(k) && k >= start && taken(day[k])) done++;
    });

    return { done: done, total: totalDays, pct: Math.round(done / totalDays * 100), streak: streak(log, id, base) };
  }

  /** Хвилини → «7 год 42 хв» (або «8 год», якщо рівно). */
  /**
   * Хвилини → {h, m} для двох полів вводу. Готових кнопок «7 год 30 хв»
   * більше немає: люди сплять 6:47, а не по сітці з кроком у пів години,
   * і округлення до найближчої кнопки псувало саме той показник, заради
   * якого трекер увімкнули.
   */
  function splitDuration(min) {
    /* null / '' — це «запису немає», а не нуль хвилин: Number(null) дає 0,
       і без цієї перевірки порожній день показував би «0 год 0 хв». */
    if (min === null || min === undefined || min === '') return { h: null, m: null };
    const n = Number(min);
    if (!Number.isFinite(n) || n < 0) return { h: null, m: null };
    const t = Math.round(n);
    return { h: Math.floor(t / 60), m: t % 60 };
  }

  /**
   * Години + хвилини → хвилини.
   *
   * Порожні поля — і нульовий підсумок теж — це «стерти запис» (null),
   * а не нуль годин сну. Так само важливо, що стерти можна з БУДЬ-ЯКОГО
   * поля: після запису 6:47 поле годин показує «0», і без цього правила
   * очищення хвилин лишало б у журналі безглузді «0 хв сну».
   *
   * Хвилини понад 59 приймаються й переносяться в години: «90» у полі
   * хвилин означає півтори години, а не помилку.
   *
   * @returns {number|null|false} хвилини, null = очистити, false = сміття
   */
  function joinDuration(h, m, def) {
    const hs = String(h == null ? '' : h).trim().replace(',', '.');
    const ms = String(m == null ? '' : m).trim().replace(',', '.');
    if (hs === '' && ms === '') return null;
    if ((hs && !/^\d+(\.\d+)?$/.test(hs)) || (ms && !/^\d+(\.\d+)?$/.test(ms))) return false;
    const hn = hs === '' ? 0 : Number(hs);
    const mn = ms === '' ? 0 : Number(ms);
    if (!Number.isFinite(hn) || !Number.isFinite(mn)) return false;
    const total = Math.round(hn * 60 + mn);
    const lo = def && Number.isFinite(def.min) ? def.min : 0;
    const hi = def && Number.isFinite(def.max) ? def.max : 1440;
    if (total < lo || total > hi) return false;
    return total === 0 ? null : total;
  }

  function formatDuration(min) {
    const m = Math.round(Number(min));
    if (!Number.isFinite(m) || m < 0) return '';
    const h = Math.floor(m / 60), r = m % 60;
    return r ? (h + ' год ' + r + ' хв') : (h + ' год');
  }

  window.TrackerCore = {
    TRACKER_DEFS: TRACKER_DEFS,
    BUILTIN_ORDER: BUILTIN_ORDER,
    SOURCES: SOURCES,
    todayKey: todayKey,
    ensureBuiltins: ensureBuiltins,
    addCustom: addCustom,
    removeCustom: removeCustom,
    setEnabled: setEnabled,
    setPinned: setPinned,
    pinnedList: pinnedList,
    pinnedCards: pinnedCards,
    isCard: isCard,
    isPinned: isPinned,
    isDefaultSupplement: isDefaultSupplement,
    normDose: normDose,
    isDosed: isDosed,
    doseOf: doseOf,
    setDose: setDose,
    taken: taken,
    gramsOf: gramsOf,
    setGoal: setGoal,
    WEEK_GOAL_MIN: WEEK_GOAL_MIN,
    WEEK_GOAL_MAX: WEEK_GOAL_MAX,
    setWeekGoal: setWeekGoal,
    weekGoalOf: weekGoalOf,
    weekStartKey: weekStartKey,
    dayDone: dayDone,
    weekStats: weekStats,
    weekStreak: weekStreak,
    setSource: setSource,
    ingest: ingest,
    entryValue: entryValue,
    entrySource: entrySource,
    list: list,
    active: active,
    byType: byType,
    defFor: defFor,
    removeEntry: removeEntry,
    mergeDay: mergeDay,
    logValue: logValue,
    addDelta: addDelta,
    entriesFor: entriesFor,
    lastEntries: lastEntries,
    streak: streak,
    numericSummary: numericSummary,
    pairSummary: pairSummary,
    goalAdherence: goalAdherence,
    boolSummary: boolSummary,
    formatDuration: formatDuration,
    splitDuration: splitDuration,
    joinDuration: joinDuration
  };
})();
