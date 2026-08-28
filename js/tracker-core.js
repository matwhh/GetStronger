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
 * власний kind. Сторінки (trackers.js/today.js/journal.js) читають
 * каталог і дані через цей модуль — жодна з них не знає формату
 * напряму, тому додавання типу не чіпає жодної з них.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const DAY_MS = 86400000;

  function todayKey(d) {
    const x = d instanceof Date ? d : new Date();
    return x.getFullYear() + '-' +
      String(x.getMonth() + 1).padStart(2, '0') + '-' +
      String(x.getDate()).padStart(2, '0');
  }

  function dateOf(key) {
    const p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

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
      min: 0, max: 960, defaultGoal: 480,
      presets: [360, 390, 420, 450, 480, 510, 540, 570, 600], hasSource: true
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
    }
  };

  const BUILTIN_ORDER = ['water', 'sleep', 'mood', 'steps', 'caffeine', 'recovery', 'painFatigue', 'workoutMood'];

  /* Приклад із теху: користувач бачить чотири увімкнені й чотири вимкнені
     трекери одразу — це той самий набір, лише перелічений явно тут. */
  const DEFAULT_ENABLED = { water: true, sleep: true, mood: true, recovery: true };

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
        settings: {},
        goal: def.defaultGoal != null ? def.defaultGoal : null,
        source: def.hasSource ? 'manual' : null,
        order: i,
        createdAt: null
      };
      changed = true;
    });
    return changed ? out : src;
  }

  /** Створити власний екземпляр (добавка або звичка). Повертає null, якщо
      назва порожня — порожніх пунктів списку не буває. */
  function addCustom(trackers, type, name) {
    if (type !== 'supplement' && type !== 'habit') return null;
    const nm = String(name || '').trim().slice(0, 60);
    if (!nm) return null;

    const src = isPlain(trackers) ? trackers : {};
    const id = type + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const out = Object.assign({}, src);
    out[id] = {
      id: id, type: type, name: nm, enabled: true, settings: {},
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
    delete out[id];
    return out;
  }

  function setEnabled(trackers, id, enabled) {
    const src = isPlain(trackers) ? trackers : {};
    if (!src[id]) return src;
    const out = Object.assign({}, src);
    out[id] = Object.assign({}, out[id], { enabled: Boolean(enabled) });
    return out;
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

  /*
   * Джерело даних (режим трекера): 'manual' | 'apple_health'. Зараз
   * web-середовище Forge не має доступу до Apple Health, і жодного разу
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
   * journal-форматом, зможе зробити майбутній Forge Mobile з
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
    const next = clamp(r1(cur + Number(delta)), def.min, def.max);
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
    while (day[todayKey(cursor)] === true) {
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
      if (DATE_KEY.test(k) && k >= start && day[k] === true) done++;
    });

    return { done: done, total: totalDays, pct: Math.round(done / totalDays * 100), streak: streak(log, id, base) };
  }

  /** Хвилини → «7 год 42 хв» (або «8 год», якщо рівно). */
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
    setGoal: setGoal,
    setSource: setSource,
    ingest: ingest,
    entryValue: entryValue,
    entrySource: entrySource,
    list: list,
    active: active,
    byType: byType,
    defFor: defFor,
    removeEntry: removeEntry,
    logValue: logValue,
    addDelta: addDelta,
    entriesFor: entriesFor,
    lastEntries: lastEntries,
    streak: streak,
    numericSummary: numericSummary,
    pairSummary: pairSummary,
    goalAdherence: goalAdherence,
    boolSummary: boolSummary,
    formatDuration: formatDuration
  };
})();
