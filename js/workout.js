/**
 * Тренування — окремий екран для залу.
 *
 * НАВІЩО ОКРЕМА СТОРІНКА. Раніше весь список вправ жив просто на
 * «Сьогодні»: короткий огляд дня перетворювався на нескінченний скрол, а
 * саме тренування неможливо було відкрити чи закрити як окремий контекст.
 * Тепер «Сьогодні» показує компактну картку-вхід, а тут — повний екран
 * тренування: вибір дня, вправи, підходи, робочі ваги, RIR, таймер
 * відпочинку й настрій до/після.
 *
 * Це НЕ другий редактор плану. «Мій план тренувань» відповідає на «як налаштована
 * програма», ця сторінка — на «що робити зараз». Вправи читаються з того
 * самого плану, ваги — з тих самих profile.weights, а розвʼязання дня
 * робить спільне ядро js/workout-core.js — те саме, яким користується
 * головна. Двох різних відповідей на питання «яке сьогодні тренування»
 * бути не може за побудовою.
 *
 * Галочки виконання — СТАН ДНЯ, а не історія: живуть у localStorage разом
 * із датою і зникають наступного дня. У профіль їде тільки підсумок
 * сесії (sessionLog).
 */
(function () {
  'use strict';

  const { $, esc, toast, fmtNum, dateLabel } = window.App;
  const WC = window.WorkoutCore;

  const state = {
    profile: {},
    plan: null,
    program: null,
    dayIdx: 0,
    done: [],
    todayKey: '',
    trackers: {},
    trackerLog: {}
  };

  /* ------------------------------------------------------------------ */
  /* Збереження                                                          */
  /* ------------------------------------------------------------------ */


  /*
   * Власний запис у профіль.
   *
   * Store.onChange не розрізняє, хто змінив профіль, тож наше ж
   * збереження поверталось сюди подією і перебудовувало екран, з яким у цю
   * мить працюють. Сторожа «людина щойно була в полі» для цього замало:
   * між набором і зміною фокуса може минути скільки завгодно часу —
   * набрав вагу, подумав, і аж потім тицьнув у сусіднє поле. Тому
   * дивимось не на людину, а на ДЖЕРЕЛО події.
   *
   * Сторінка вже показала результат сама (state змінено до запису), тож
   * дублювати його перемальовкою не треба. Вікно коротке: справжня зміна
   * з іншої вкладки приходить пізніше й перемальовку отримає.
   *
   * Той самий запобіжник, що на «Моєму плані» (js/programs.js).
   */
  const SELF_WRITE_MS = 1200;
  let lastSelfWrite = 0;

  /** Зберегти профіль і позначити запис як власний. Усі збереження цієї
      сторінки йдуть через неї — інакше сторож не спрацює. */
  function saveOwn(patch) {
    lastSelfWrite = Date.now();
    return window.Store.saveProfile(patch);
  }


  /*
   * Одна дія людини — ДВА незалежні записи: галочки в forge.today і
   * історія в profile.sessionLog. Спільної транзакції немає, кожен може
   * впасти сам, і раніше обидві відмови були мовчазні: writeDay ковтав
   * виняток, а помилка sessionLog ішла лише в console.warn (LOC-002,
   * LOC-009). Людина бачила галочки, яких у сховищі вже немає.
   *
   * Скаржимось один раз на завантаження сторінки: якщо сховище повне,
   * тост на кожен підхід перетворив би тренування на боротьбу з тостами.
   */
  let quotaWarned = false;
  /*
   * Сторінку ховають — дописуємо негайно (PRF-003).
   *
   * Відкладений на 20 секунд запис не має шансу виконатись, якщо людина
   * перейшла на іншу вкладку або заблокувала екран. beacon переживає
   * закриття; звичайний fetch у цей момент браузер скасовує.
   */
  function flushSessionLog() {
    if (!sessionTimer) return;
    clearTimeout(sessionTimer);
    sessionTimer = null;
    if (!state.plan || !window.HistoryCore || endedToday()) return;
    const st = WC.dayStats(state.plan[state.dayIdx], state.done);
    if (!st.doneSets) return;
    const log = window.HistoryCore.upsertSession(
      state.profile.sessionLog, state.todayKey, sessionRecord(false));
    state.profile.sessionLog = log;
    lastSelfWrite = Date.now();
    window.Store.saveProfileBeacon({ sessionLog: log });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSessionLog();
  });
  window.addEventListener('pagehide', flushSessionLog);

  function saveDayState() {
    if (!WC.writeDay(state.profile, state.todayKey, state.dayIdx, state.done) && !quotaWarned) {
      quotaWarned = true;
      toast('Сховище браузера переповнене — галочки цього дня не збережуться. ' +
            'Звільніть місце або видаліть старі дані в акаунті.', 'err');
    }
    scheduleSessionLog();
  }

  /* ------------------------------------------------------------------ */
  /* Стан завершення                                                     */
  /* ------------------------------------------------------------------ */

  /** Сьогоднішня сесія вже закрита кнопкою (будь-який день плану) */
  /** 'РРРР-ММ-ДД' → Date у ЛОКАЛЬНОМУ поясі (TIM-009). */
  function keyToDate(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(key);
  }

  function endedToday() {
    return Boolean(WC.completedToday(state.profile, state.todayKey));
  }

  /** Обраний день плану вже завершено цього тижня → дата, інакше null */
  /*
   * ДЕНЬ, ПІДКАЗАНИЙ ССИЛКОЮ (?day=N).
   *
   * ЗВІДКИ ВІН БЕРЕТЬСЯ. З екрана «Сьогодні»: віджет показує день, що
   * припадає на обраний день тижня, і веде сюди разом із його номером.
   * Без цього сторінка обирала день сама — «наступний після минулого», —
   * і людина, тицьнувши на слово «Пуш», відкривала Пул.
   *
   * ЧОМУ ПІДКАЗКА, А НЕ НАКАЗ. Перемикання дня скидає закриті підходи —
   * саме тому ручне перемикання питає підтвердження. Тихо стерти
   * половину тренування через параметр в адресі неприпустимо, тож
   * підказка діє ЛИШЕ поки нічого не закрито. Почав день — сторінка
   * лишається на ньому, а перемкнути можна вкладками, з підтвердженням.
   *
   * ЧОМУ ПАРАМЕТР ОДРАЗУ ПРИБИРАЄТЬСЯ З АДРЕСИ. Інакше він діяв би й
   * після перезавантаження: людина перемкнула день вручну, натиснула F5
   * — і повернулась туди, звідки прийшла годину тому.
   */
  function applyDayFromUrl() {
    let want = null;
    try {
      const raw = new URLSearchParams(location.search).get('day');
      if (raw !== null) {
        const n = Number(raw);
        if (Number.isInteger(n) && n >= 0) want = n;
      }
    } catch (_) { want = null; }

    if (want !== null && state.plan && state.plan.length) {
      const idx = WC.clampDay(want, state.plan.length);
      const st = WC.dayStats(state.plan[state.dayIdx], state.done);
      if (idx !== state.dayIdx && st.doneSets === 0) {
        state.dayIdx = idx;
        state.done = [];
        if (!locked()) saveDayState();
      }
    }

    /* Адресу чистимо завжди, коли параметр був: навіть якщо підказку
       відхилено, лишати її в адресі означає лишати міну під F5. */
    try {
      if (location.search && /(^|[?&])day=/.test(location.search)) {
        const q = new URLSearchParams(location.search);
        q.delete('day');
        const rest = q.toString();
        history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      }
    } catch (_) { /* file:// або старий браузер — не біда */ }
  }

  function endedThisWeek(dayIdx) {
    return WC.completedThisWeek(state.profile, state.todayKey)[dayIdx] || null;
  }

  /** Чи можна зараз працювати з обраним днем */
  function locked() {
    return endedToday() || Boolean(endedThisWeek(state.dayIdx));
  }

  /*
   * Сесія дня — у профіль (sessionLog): який день програми робили і
   * скільки вправ закрито. Це вже ІСТОРІЯ, тому вона їде в профіль, а не
   * лишається в localStorage, як галочки.
   *
   * Запис зʼявляється з ПЕРШОЮ галочкою: відкрити сторінку — ще не
   * тренуватись. Дебаунс, бо кожна галочка — це збереження, а в хмарному
   * режимі збереження — це запит: серія з восьми галочок за хвилину має
   * поїхати одним записом, а не вісьмома.
   */
  let sessionTimer = null;

  /*
   * Скільки повторень покласти в підхід, якщо людина нічого не вписала.
   *
   * Тут була своя копія цього правила — і вона брала СЕРЕДИНУ діапазону:
   * «8–10» → 9. Число, якого немає в плані й якого людина ніде не
   * бачила, а воно потім їде в тоннаж, повтори й оцінку 1ПМ. Тепер
   * правило одне на весь сайт і живе в js/reps-core.js, разом із самими
   * діапазонами: нижня межа — те, що план і просить.
   */
  function repLow(reps) {
    const RC = window.RepsCore;
    return RC && typeof RC.repLow === 'function' ? RC.repLow(reps) : 0;
  }

  /** Робоча вага вправи з книги ваг — плановий орієнтир, або null */
  function planWeight(name) {
    const w = Number(state.profile.weights && state.profile.weights[name]);
    return Number.isFinite(w) && w > 0 ? w : null;
  }

  /** Фактично виконані підходи вправи i (масив {w, r}) */
  function perfSets(i) {
    const ex = state.plan[state.dayIdx].exercises[i];
    return WC.performedSets(state.done[i], WC.plannedSets(ex),
      planWeight(ex.name), repLow(ex.reps));
  }

  /**
   * Факти сесії для знімка в історію: підходи, повторення й оцінка
   * тоннажу ЗАКРИТИХ вправ. Вага — з книги ваг на момент тренування;
   * вправи без ваги (планка, прес) чесно дають 0 кг у тоннаж, але
   * рахуються в підходи. Це оцінка за схемою дня, не ваги кожного
   * підходу — тому сторінка прогресу підписує її «≈».
   */
  /*
   * Факти рахуються ПО ПІДХОДАХ: закрито 2 з 4 підходів жиму — у тоннаж
   * і повторення йдуть саме два. Вправа вважається закритою, лише коли
   * закриті всі її підходи (це число їде в done/total для сумісності зі
   * старою формою запису і серверною перевіркою «мінімум 3 вправи»).
   */
  function sessionFacts(day, done, weights) {
    let sets = 0, reps = 0, vol = 0;
    const ex = [];
    day.exercises.forEach(function (e, i) {
      const ps = WC.plannedSets(e);
      if (!ps) return;
      const planW = Number(weights && weights[e.name]);
      const fbW = Number.isFinite(planW) && planW > 0 ? planW : null;
      const r0 = repLow(e.reps);

      /* Джерело правди — ФАКТИЧНІ підходи, зафіксовані в момент тапу.
         Книга ваг тут лише запасне значення для легасі-днів, де масиву
         підходів ще немає. Через це пізніша зміна робочої ваги більше
         не переписує вже закриті підходи заднім числом. */
      const list = WC.performedSets(done[i], ps, fbW, r0);
      const ds = list.length;
      sets += ds;

      const row = { n: e.name, ds: ds, ps: ps };
      const s = [];
      let sumR = 0, topKg = null;
      list.forEach(function (p) {
        const w = Number.isFinite(p.w) ? p.w : null;
        const r = Number.isFinite(p.r) && p.r > 0 ? p.r : 0;
        const rec = {};
        if (w !== null) rec.w = w;
        if (r > 0) rec.r = r;
        s.push(rec);
        sumR += r;
        if (w !== null && w > 0) {
          if (r > 0) vol += w * r;
          if (topKg === null || w > topKg) topKg = w;
        }
      });
      reps += sumR;
      if (s.length) row.s = s;

      /* kg і r лишаються для сумісності: старі читачі (і графіки за
         періоди до цього релізу) знають лише «одна вага на вправу».
         kg — найважчий фактичний підхід, r — середні фактичні повтори. */
      if (topKg !== null) row.kg = topKg;
      else if (fbW !== null) row.kg = fbW;
      if (ds > 0 && sumR > 0) row.r = Math.round((sumR / ds) * 10) / 10;
      else if (r0 > 0) row.r = r0;

      ex.push(row);
    });
    return { sets: sets, reps: Math.round(reps), vol: Math.round(vol), ex: ex };
  }

  /** Повний запис сесії за поточним станом; end=true — закрито кнопкою */
  function sessionRecord(end) {
    const day = state.plan[state.dayIdx];
    const a = state.profile.activePlan || {};
    const st = WC.dayStats(day, state.done);
    const facts = sessionFacts(day, state.done, state.profile.weights);
    const now = Date.now();
    const rec = {
      programId: a.programId,
      days: Number(a.days) || 0,
      dayIdx: state.dayIdx,
      title: day.title || ('День ' + (state.dayIdx + 1)),
      done: st.doneEx,
      total: st.totalEx,
      doneSets: st.doneSets,
      totalSets: st.totalSets,
      t0: now,   // upsertSession лишає найперший t0 — початок сесії
      t1: now,
      sets: facts.sets,
      reps: facts.reps,
      vol: facts.vol,
      ex: facts.ex
    };
    if (end) rec.end = 1;
    return rec;
  }

  /*
   * ЧОМУ ДЕБАУНС ТАКИЙ ДОВГИЙ (PRF-003).
   *
   * Профіль пишеться в хмару ЦІЛКОМ: profiles.data — один jsonb без
   * часткових оновлень. Тобто кожна галочка підходу — це POST з усією
   * історією тренувань (при тисячі сесій ~1,4 МБ). Дебаунс 1,5 с у залі не
   * рятує: між підходами хвилини, і кожен підхід ішов окремим запитом.
   *
   * Часткове оновлення на сервері (jsonb_set по дню або окрема таблиця
   * днів) — це зміна схеми й окреме рішення. Дешева половина: рідше
   * писати. 20 секунд — довше за паузу між підходами всередині вправи й
   * коротше за перерву між вправами; плюс примусовий запис, коли сторінку
   * ховають (перехід, згортання вкладки, блокування екрана). Локальний
   * стан forge.today пишеться на кожен тап як і раніше — він дешевий.
   */
  const SESSION_DEBOUNCE_MS = 20000;

  /* Браузерні перевірки не можуть чекати 20 секунд на кожен тап, тому
     дозволяємо вкоротити вікно ззовні. Це не «режим тестів»: значення
     читається щоразу, і в житті його ніхто не ставить. */
  function sessionDebounceMs() {
    const v = Number(window.__FORGE_SESSION_DEBOUNCE_MS);
    return Number.isFinite(v) && v >= 0 ? v : SESSION_DEBOUNCE_MS;
  }

  function scheduleSessionLog() {
    if (!state.plan || !window.HistoryCore) return;
    if (endedToday()) return;   // закриту сесію пізніші дотики не переписують
    const st = WC.dayStats(state.plan[state.dayIdx], state.done);
    if (!st.doneSets) return;   // порожній день — не сесія

    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(function () {
      sessionTimer = null;   /* спрацював — flushSessionLog більше не потрібен */
      const log = window.HistoryCore.upsertSession(
        state.profile.sessionLog, state.todayKey, sessionRecord(false));
      state.profile.sessionLog = log;
      /*
       * Патч — ФУНКЦІЯ (SYN-011): журнал добудовується вже всередині
       * ланцюга збереження, на актуальному профілі. Інакше друга вкладка,
       * яка прочитала профіль раніше, затирала б сесію першої цілком —
       * sessionLog передається як ціле значення поля.
       */
      saveOwn(function (p) {
        return { sessionLog: window.HistoryCore.upsertSession(
          p.sessionLog, state.todayKey, sessionRecord(false)) };
      }).catch(function (e) {
        /* Було лише console.warn — тобто друга половина того самого запису
           падала мовчки (LOC-009). .queued означає «лежить у черзі», це не
           втрата й лякати нею не треба. */
        if (!(e && e.queued)) toast('Історія тренування не збереглася: ' + (e && e.message), 'err');
      });
    }, sessionDebounceMs());
  }

  /*
   * ВІКНО ДОСТРОКОВОГО ЗАВЕРШЕННЯ.
   *
   * Малює те, що вирішив js/finish-core.js. Влаштоване за зразком
   * BmiCore.showWarnModal: та сама розмітка .modal, та сама пастка
   * фокуса, те саме повернення фокуса на місце. Різниця одна — тут
   * ДВА фокусовані елементи, тож Tab ходить між ними по колу, а не
   * повертається в єдиний.
   *
   * ESCAPE І КЛІК ПО ПІДКЛАДЦІ ОЗНАЧАЮТЬ «ПРОДОВЖИТИ». Закриття вікна
   * випадковим дотиком не має завершувати день: завершення незворотне
   * до понеділка, а продовження не коштує нічого.
   */
  function askFinish(st, onFinish) {
    const FC = window.FinishCore;
    const q = FC.pickQuote({
      trackerLog: state.trackerLog, day: state.todayKey, rand: Math.random
    });

    const left = st.totalSets - st.doneSets;
    const line = st.doneSets
      ? 'Виконано ' + st.doneSets + ' з ' + st.totalSets + ' підходів (' +
        st.doneEx + ' з ' + st.totalEx + ' вправ). Лишилось ' + left + '.'
      : 'Жодного підходу не закрито.';
    /* Наслідок той самий, що був у confirm(): він тут головне, а не
       цитата. Людина мусить знати, що день не можна перепройти. */
    const cost = st.doneSets
      ? 'Якщо завершити зараз, повторити цей день можна буде з понеділка.'
      : 'Якщо завершити зараз, день буде використано до понеділка, а тижнева ' +
        'оцінка порахує його як пропуск.';

    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML =
      '<div class="modal__backdrop"></div>' +
      '<div class="modal__box" role="alertdialog" aria-modal="true" aria-labelledby="wk-fin-t">' +
        '<h3 id="wk-fin-t" style="margin:0">Тренування ще не закінчене</h3>' +
        '<p class="small mt-1">' + esc(line) + '</p>' +
        '<p class="lead mt-2" style="max-width:none">' + esc(q.s) + '</p>' +
        '<p class="small muted mt-2">' + esc(cost) + '</p>' +
        '<div class="pills mt-2">' +
          '<button class="pill pill--red" type="button" id="wk-fin-go">Продовжити тренування</button>' +
          '<button class="pill pill--blue" type="button" id="wk-fin-end">Завершити тренування</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    const goBtn = wrap.querySelector('#wk-fin-go');
    const endBtn = wrap.querySelector('#wk-fin-end');
    const prevFocus = document.activeElement;
    let closed = false;

    try { window.App.lockScroll(true); } catch (_) {}

    function close(done) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      try { window.App.lockScroll(false); } catch (_) {}
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (_) {}
      if (done) onFinish();
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      if (e.key !== 'Tab') return;
      /* Двоє фокусованих: Tab з останнього веде в перший, Shift+Tab з
         першого — в останній. За межі box фокус не виходить. */
      e.preventDefault();
      const first = goBtn, last = endBtn;
      const cur = document.activeElement;
      if (e.shiftKey) (cur === first ? last : first).focus();
      else (cur === last ? first : last).focus();
    }

    document.addEventListener('keydown', onKey, true);
    goBtn.addEventListener('click', function () { close(false); });
    endBtn.addEventListener('click', function () { close(true); });
    const backdrop = wrap.querySelector('.modal__backdrop');
    if (backdrop) backdrop.addEventListener('click', function () { close(false); });

    /* Фокус на «Продовжити»: випадковий Enter має лишати в тренуванні. */
    try { goBtn.focus(); } catch (_) {}
  }

  /** Власне завершення: запис сесії з ознакою end. */
  function doFinish() {
    clearTimeout(sessionTimer);
    const log = window.HistoryCore
      ? window.HistoryCore.upsertSession(state.profile.sessionLog, state.todayKey, sessionRecord(true))
      : state.profile.sessionLog;
    state.profile.sessionLog = log;
    if (!WC.writeDay(state.profile, state.todayKey, state.dayIdx, state.done)) {
      toast('Сховище браузера переповнене — стан дня не збережено локально', 'err');
    }
    render();
    saveOwn(function (p) {
      return { sessionLog: window.HistoryCore
        ? window.HistoryCore.upsertSession(p.sessionLog, state.todayKey, sessionRecord(true))
        : log };
    }).catch(function (e) {
      if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err');
    });
  }

  /*
   * «Завершити тренування». Можна в БУДЬ-який момент — 0/10 теж
   * завершення, лише чесно попереджене: день стане використаним до
   * понеділка, а тижнева оцінка ELO порахує його за фактом виконання
   * (нуль підходів для неї — те саме, що пропуск).
   *
   * ПИТАЄМО ТІЛЬКИ ПРО НЕДОРОБЛЕНЕ. Раніше confirm() виринав щоразу —
   * і в того, хто закрив усі підходи, теж. Людина, яку питають про
   * очевидне, за тиждень навчається тиснути «так» не читаючи, і тоді
   * попередження перестає працювати саме там, де воно потрібне.
   */
  function finishWorkout() {
    if (!state.plan || locked()) return;
    const day = state.plan[state.dayIdx];
    const st = WC.dayStats(day, state.done);
    const FC = window.FinishCore;

    /* Без модуля (не завантажився) лишається стара поведінка: краще
       системне вікно, ніж мовчазне завершення дня без попередження. */
    if (!FC) {
      if (!confirm('Завершити тренування?\n\nВиконано ' + st.doneSets + ' з ' +
          st.totalSets + ' підходів.\nПовторити цей день можна буде з понеділка.')) return;
      doFinish();
      return;
    }

    if (!FC.shouldAsk(st)) { doFinish(); return; }
    askFinish(st, doFinish);
  }

  /** Записати зміну трекера дня й одразу оновити екран */
  function saveTrackerLog(next) {
    state.trackerLog = next;
    render();
    saveOwn({ trackerLog: next }).catch(function (e) {
      if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Настрій до/після — опційно, з наявного трекера                      */
  /* ------------------------------------------------------------------ */
  /*
   * Власної системи настрою тут НЕМАЄ. Це вбудований трекер 'workoutMood'
   * (kind: 'pair', поля before/after) з js/tracker-core.js, а дані лежать
   * там, де й решта трекерів: profile.trackerLog.workoutMood[дата]. Тобто
   * запис прив'язаний до сьогоднішньої сесії тією ж датою, якою
   * підписаний sessionLog.
   *
   * Опційність теж не власна: трекер вмикають на «Відновленні», і поки
   * він вимкнений, блок не рендериться взагалі — не займає ні місця, ні
   * уваги, і жодним кроком не стоїть між людиною і тренуванням.
   */
  const PAIR_LABELS = {
    before: 'Настрій перед тренуванням',
    after: 'Настрій після тренування'
  };

  function pairPicker(id, def, cur) {
    return def.fields.map(function (f) {
      return '<p class="small muted mt-1" style="margin-bottom:4px">' + esc(PAIR_LABELS[f] || f) + '</p>' +
        '<div class="qi-scale" role="group" aria-label="' + esc(PAIR_LABELS[f] || f) + ', від 1 до 10">' +
          Array.from({ length: def.max - def.min + 1 }, function (_, i) { return def.min + i; }).map(function (n) {
            return '<button class="qi-scale__btn' + (cur[f] === n ? ' is-on' : '') + '" type="button" ' +
              'aria-pressed="' + (cur[f] === n) + '" ' +
              'data-trk-pair="' + esc(id) + '" data-field="' + f + '" data-val="' + n + '">' + n + '</button>';
          }).join('') +
        '</div>';
    }).join('');
  }

  function moodCard() {
    const TC = window.TrackerCore;
    if (!TC) return '';
    const t = state.trackers.workoutMood;
    if (!t || !t.enabled) return '';

    const def = TC.defFor(t);
    const today = (state.trackerLog.workoutMood || {})[state.todayKey] || {};

    return '' +
      '<div class="card" id="wk-mood">' +
        '<div class="row row--split" style="align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Настрій</h2>' +
          '<a class="small" href="trackers.html">Вимкнути</a>' +
        '</div>' +
        '<p class="small muted" style="margin:6px 0 0">Необовʼязково. Позначайте, коли хочеться — ' +
          'запис привʼязується до цього тренування.</p>' +
        pairPicker('workoutMood', def, today) +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Рендер                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Рядок вправи: назва, схема, робоча вага, таймер. Великі зони дотику.
   *
   * Вага — поле, а не напис. Це єдина цифра плану, яку міняють просто в
   * залі, між підходами. Книга ваг спільна на весь сайт (profile.weights
   * за НАЗВОЮ вправи), тож правка тут — та сама правка, що на «Моєму
   * плані»: жодної другої системи ваг не зʼявляється.
   */
  /**
   * Рядок вправи. Замість однієї галочки — кнопка на КОЖЕН підхід:
   * тап по n-му закриває підходи 1..n, повторний тап по останньому
   * закритому відкочує його. Вправа «виконана», коли закриті всі.
   */
  /**
   * Один фактично виконаний підхід: вага і повтори САМЕ ЦЬОГО підходу.
   *
   * Поля опційні за задумом: тап по кружечку вже записав вагу й повтори
   * станом на ту мить, і в 90 % випадків вони правильні. Сюди лізуть,
   * коли підхід відрізнявся — дроп-сет, недобрані повтори, інший млинець.
   */
  function setRowHtml(i, k, rec, ex) {
    const n = k + 1;
    return '' +
      '<div class="tdy-set">' +
        '<span class="tdy-set__n mono">' + n + '</span>' +
        '<input class="input input--sm num mono tdy-set__w" type="text" inputmode="decimal" ' +
          'placeholder="—" value="' + esc(rec && rec.w != null ? fmtNum.kg(rec.w) : '') + '" ' +
          'data-setw="' + i + '" data-setn="' + n + '" ' +
          'aria-label="Вага підходу ' + n + ', кг: ' + esc(ex.name) + '">' +
        '<span class="tdy-set__u">кг</span>' +
        '<span class="tdy-set__x" aria-hidden="true">×</span>' +
        '<input class="input input--sm num mono tdy-set__r" type="text" inputmode="numeric" ' +
          'placeholder="—" value="' + esc(rec && rec.r != null ? String(rec.r) : '') + '" ' +
          'data-setr="' + i + '" data-setn="' + n + '" ' +
          'aria-label="Повтори підходу ' + n + ': ' + esc(ex.name) + '">' +
        '<span class="tdy-set__u">повт.</span>' +
      '</div>';
  }

  function setLogHtml(i, ex, ps) {
    const list = WC.performedSets(state.done[i], ps, planWeight(ex.name), repLow(ex.reps));
    return list.map(function (rec, k) { return setRowHtml(i, k, rec, ex); }).join('');
  }

  /*
   * ЯКІ ПАНЕЛІ «Ваги підходів» РОЗГОРНУТІ — ЦЕ СТАН, А НЕ АТРИБУТ У РОЗМІТЦІ.
   *
   * Панель закривалась сама приблизно через 120 мс після відкриття (UX-001):
   * фонове збереження профілю давало відкладений render(), а розмітка
   * вправи містить hidden КОНСТАНТОЮ. Тобто перемальовка щоразу згортала
   * те, що людина щойно розгорнула; другий клік «спрацьовував», бо
   * відкладеного render у той момент уже не було.
   */
  const openLogs = new Set();

  /** Повернути розгорнуті панелі після перемальовки списку. */
  function restoreOpenLogs() {
    openLogs.forEach(function (i) {
      const box = document.querySelector('[data-set-log="' + i + '"]');
      const tgl = box && box.closest('.tdy-ex') && box.closest('.tdy-ex').querySelector('[data-log-tgl]');
      if (!box || !tgl || tgl.disabled) { openLogs.delete(i); return; }
      box.hidden = false;
      tgl.setAttribute('aria-expanded', 'true');
      tgl.textContent = 'сховати';
    });
  }

  /**
   * Дописати/прибрати рядки підходів після тапу, НЕ чіпаючи вже наявні:
   * повна перемальовка забирала б фокус із поля, яке зараз редагують.
   */
  function syncSetLog(rowEl, i) {
    const box = rowEl.querySelector('[data-set-log]');
    if (!box) return;
    const ex = state.plan[state.dayIdx].exercises[i];
    const ps = WC.plannedSets(ex);
    const list = perfSets(i);
    const kids = box.querySelectorAll('.tdy-set');
    for (let k = list.length; k < kids.length; k++) kids[k].remove();
    let html = '';
    for (let k = kids.length; k < list.length; k++) html += setRowHtml(i, k, list[k], ex);
    if (html) box.insertAdjacentHTML('beforeend', html);

    const tgl = rowEl.querySelector('[data-log-tgl]');
    if (tgl) {
      tgl.disabled = !list.length;
      if (!list.length) {
        box.hidden = true;
        tgl.setAttribute('aria-expanded', 'false');
        tgl.textContent = 'показати';
        openLogs.delete(i);
      }
    }
    syncLogSum(rowEl, i);
  }

  /** Коротке значення рядка «Ваги підходів» — точково, без перемальовки. */
  function syncLogSum(rowEl, i) {
    const sum = rowEl.querySelector('[data-log-sum]');
    if (sum) sum.textContent = logSummary(i);
  }

  /** Правка ваги/повторів одного підходу з поля */
  function editSetField(i, k, patch, el) {
    if (locked()) return;
    const ex = state.plan[state.dayIdx].exercises[i];
    const ps = WC.plannedSets(ex);
    const fbW = planWeight(ex.name);
    const fbR = repLow(ex.reps);
    const raw = String(patch.w != null ? patch.w : patch.r);

    /*
     * СТЕЛЯ — СВОЯ ДЛЯ КОЖНОЇ ВПРАВИ.
     *
     * Спільні 0–500 у normWeight для присідання майже чесні, а для махів
     * гантелями — ні: 300 кг у бічній дельті проходили мовчки й лягали в
     * журнал, а звідти в історію та графіки. Помилку помічали через
     * тижні, коли графік уже не читався.
     *
     * Перевірка стоїть ПЕРЕД записом, а не після: інакше значення встигає
     * потрапити в стан дня, і відкочувати довелося б із журналу.
     */
    const WL = window.WeightLimits;
    if (WL && patch.w != null && raw !== '') {
      const v = WL.check(ex.name, raw);
      if (!v.ok && v.why === 'big') {
        const shownNow = WC.performedSets(state.done[i], ps, fbW, fbR)[k] || {};
        el.value = shownNow.w == null ? '' : fmtNum.kg(shownNow.w);
        toast(WL.message(ex.name), 'err');
        return;
      }
    }

    state.done[i] = WC.editSet(state.done[i], k, patch, ps, fbW, fbR);
    saveDayState();
    refreshProgress();
    const row = el.closest && el.closest('.tdy-ex');
    if (row) syncLogSum(row, i);

    /* Показуємо назад те, що реально записалось: поза межами значення
       не приймається і підхід повертається до робочої ваги — мовчазне
       «нічого не сталось» тут гірше за видиму відкотку поля. */
    const shown = WC.performedSets(state.done[i], ps, fbW, fbR)[k] || {};
    if ('w' in patch) {
      el.value = shown.w == null ? '' : fmtNum.kg(shown.w);
      if (raw !== '' && WC.normWeight(raw) === null) {
        toast(window.WeightLimits ? window.WeightLimits.message(ex.name)
                                  : 'Вага підходу: 0–500 кг', 'err');
      }
    } else {
      el.value = shown.r == null ? '' : String(shown.r);
      if (raw !== '' && WC.normReps(raw) === null) toast('Повтори: 1–200', 'err');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Розминка                                                            */
  /* ------------------------------------------------------------------ */
  /*
   * «ПІДВОДНІ» Й «РОЗМИНКА» БУЛИ ОДНИМ І ТИМ САМИМ.
   *
   * Під схемою вправи стояли два рядки: авторський текст програми
   * «Підводні: 1–2 підходи × 6» і порахована драбина «40/60/80 %: 20 ·
   * 30 · 40 кг». Обидва описують те саме — сходинки до робочої ваги, —
   * але жили нарізно: текст не знав про вагу, драбина не знала про
   * текст, і на будь-якій правці вони розійшлися б у числах. До того ж
   * удвох вони займали більше місця, ніж сама вправа, а читають їх один
   * раз за тренування.
   *
   * Тепер поняття одне — розминкові підходи, — і в рядку вправи від
   * нього лишається одне коротке число. Самі ваги живуть у вікні, як і
   * робоча вага: обидва «змінити» виглядають і поводяться однаково.
   */
  /* Приймає ВПРАВУ, а не назву: типова кількість сходинок залежить від
     того, багатосуглобова вона чи ізоляція (js/workout-core.js). */
  function warmupLadder(ex) {
    if (!window.OneRM || !WC.warmupSets) return [];
    return WC.warmupSets(planWeight(ex.name), window.OneRM.PLATE_STEP,
      WC.warmupCountFor(state.profile, ex), warmupOwnReps(ex.name));
  }

  /** Свої повтори сходинок із книги, як вони записані (числа або null). */
  function warmupOwnReps(name) {
    const own = WC.normWarmup((state.profile.warmups || {})[name]);
    return own ? own.reps : [];
  }

  /**
   * Рядок розминки — ЦІЛКОМ, а не натяк на нього.
   *
   * Було «3 підходи»: щоб дізнатись, з якої ваги починати, доводилось
   * відкривати вікно — у залі, з телефоном в одній руці. Тепер у рядку
   * стоїть усе, що треба зробити: номер, вага і скільки разів. Відсотка
   * тут немає навмисно — у залі на штангу вішають кілограми.
   */
  function warmupLine(ex) {
    return warmupLadder(ex).map(function (x, i) {
      return (i + 1) + '×' + fmtNum.kg(x.kg) + '×' + x.reps;
    }).join(' · ');
  }

  /** Підказка у вікні: що дадуть N сходинок при цій робочій вазі. */
  function ladderHint(ex, n, kgOverride) {
    const kg = kgOverride === undefined ? planWeight(ex.name) : kgOverride;
    if (kg === null) return 'Робочої ваги ще немає — рахувати нема від чого.';
    const l = window.OneRM ? WC.warmupSets(kg, window.OneRM.PLATE_STEP, n) : [];
    if (!l.length) return 'Без розминкових підходів.';
    return l.map(function (x) { return fmtNum.kg(x.kg) + ' кг'; }).join(' · ');
  }

  /** Коротке значення рядка «Ваги підходів»: що реально записано. */
  function logSummary(i) {
    const ex = state.plan[state.dayIdx].exercises[i];
    const ps = WC.plannedSets(ex);
    const ds = WC.doneSetsFor(state.done[i], ps);
    if (!ds) return '—';
    const kg = [];
    perfSets(i).slice(0, ds).forEach(function (p) {
      const v = Number.isFinite(p.w) ? fmtNum.kg(p.w) : null;
      if (v !== null && kg.indexOf(v) === -1) kg.push(v);
    });
    if (!kg.length) return ds + ' ' + window.App.plural(ds, 'підхід', 'підходи', 'підходів');
    /* Три числа — стеля рядка: далі він переносився б і рядок «Розминка»
       під ним переставав бути на своєму місці. Решту видно у списку. */
    return (kg.length > 3 ? kg.slice(0, 3).join(' · ') + ' …' : kg.join(' · ')) + ' кг';
  }

  /*
   * РОБОЧА ВАГА Й ПОВТОРЕННЯ — ОДНИМ ВІКНОМ.
   *
   * Колись поле робочої ваги стояло просто в рядку вправи й писало в
   * книгу ваг на виході з фокуса. Одна сторінка робила дві протилежні
   * речі одним жестом: «сьогодні я взяв 50» і «віднині моя робоча вага
   * 50». Зменшив через втому — план мовчки поїхав униз назавжди,
   * історія ваг отримала подію, якої не було, а прогресія побачила зміну
   * ваги й обнулила лічильник тренувань на ній. Тому поле прибрали, а
   * «змінити» вело на сторінку плану — тобто виганяло зі сторінки
   * посеред тренування.
   *
   * Вікно знімає обидві біди разом: правка лишилась тут, але перестала
   * бути випадковою. Її роблять окремим рішенням і окремою кнопкою, під
   * підписом, який прямо каже, що міняється план, а не сьогоднішній
   * підхід. Вага ОДНОГО підходу як була, так і лишається в «Вагах
   * підходів» — це різні речі, і плутати їх не можна.
   */
  function openWeightSheet(i) {
    const ex = state.plan[state.dayIdx].exercises[i];
    const RC = window.RepsCore;
    const cur = planWeight(ex.name);
    const own = RC ? RC.normUserReps(ex.userReps, ex) : null;
    const max = RC ? RC.maxRepsFor(ex) : 15;
    const hint = RC && state.profile
      ? RC.repRangeFor(state.profile.trainingAge, ex)
      : String(ex.reps || '');
    const rir = RC ? RC.normRir(ex.rir) : null;
    const warm = WC.warmupCountFor(state.profile, ex);

    window.App.sheet({
      title: ex.name,
      sub: 'Це план, а не сьогоднішній підхід: нова вага стає робочою з цієї миті ' +
           'й лягає в історію ваг. Разовий підхід легше чи важче правиться нижче, ' +
           'у «Вагах підходів».',
      body:
        '<div class="row" style="gap:12px;flex-wrap:wrap">' +
          '<div class="field" style="flex:1 1 140px">' +
            '<label class="field__label" for="wk-sh-w">Робоча вага, кг</label>' +
            '<input class="input num mono" id="wk-sh-w" type="text" inputmode="decimal" ' +
              'autocomplete="off" placeholder="—" value="' +
              esc(cur === null ? '' : fmtNum.kg(cur)) + '">' +
          '</div>' +
          '<div class="field" style="flex:1 1 140px">' +
            '<label class="field__label" for="wk-sh-r">Повторення</label>' +
            '<input class="input num mono" id="wk-sh-r" type="number" min="1" max="' + max + '" ' +
              'step="1" autocomplete="off" placeholder="' + esc(hint) + '" value="' +
              (own === null ? '' : own) + '">' +
          '</div>' +
          '<div class="field" style="flex:1 1 140px">' +
            '<label class="field__label" for="wk-sh-rir">RIR</label>' +
            '<input class="input num mono" id="wk-sh-rir" type="number" min="0" max="' +
              (RC ? RC.RIR_MAX : 5) + '" step="1" autocomplete="off" placeholder="—" value="' +
              (rir === null ? '' : rir) + '">' +
          '</div>' +
        '</div>' +
        '<p class="field__hint mt-1">Порожнє поле повторень — діапазон за вашим стажем (' +
          esc(hint) + '). RIR — скільки повторень лишається в запасі; 0 — до відмови.</p>' +
        /*
         * РОЗМИНКА ТУТ, А НЕ ОКРЕМИМ ВІКНОМ.
         *
         * Окрема кнопка «змінити» біля рядка розминки існувала лише
         * заради одного числа — і зникала разом із рядком, коли розминки
         * немає, тобто саме тоді, коли її треба ввімкнути. Тепер поле
         * стоїть поруч із вагою: вікно вправи є завжди.
         */
        '<div class="field mt-2" style="max-width:190px">' +
          '<label class="field__label" for="wk-sh-n">Розминкових підходів</label>' +
          '<input class="input num mono" id="wk-sh-n" type="number" min="0" max="' +
            WC.WARMUP_MAX + '" step="1" autocomplete="off" value="' + warm + '">' +
        '</div>' +
        '<p class="field__hint mt-1" data-wu-prev>' + esc(ladderHint(ex, warm)) + '</p>',
      onOpen: function (box) {
        /*
         * Підказка живе на ДВОХ полях: кількість сходинок і робоча вага,
         * від якої вони рахуються. Міняємо тільки текст, не перемальовуючи
         * блок: перемальовка під час input зносить поле разом із кареткою.
         */
        const nInp = box.querySelector('#wk-sh-n');
        const wInp = box.querySelector('#wk-sh-w');
        const out = box.querySelector('[data-wu-prev]');
        const sync = function () {
          const v = WC.normWarmupCount(nInp.value);
          out.textContent = ladderHint(ex, v === null ? warm : v,
            WC.normWeight(String(wInp.value || '').replace(',', '.')));
        };
        nInp.addEventListener('input', sync);
        wInp.addEventListener('input', sync);
      },
      onSave: function (box) {
        /* Кома — той самий знак, що й у полі ваги підходу (js/workout.js
           нижче): 47,5 і 47.5 мають означати одне й те саме, бо на
           телефоні клавіатура дає те, що дає. */
        const wRaw = String(box.querySelector('#wk-sh-w').value || '').replace(',', '.').trim();
        const rRaw = String(box.querySelector('#wk-sh-r').value || '').trim();

        /* Стеля своя для кожної вправи — та сама перевірка, що й у ваги
           підходу: 300 кг у бічній дельті не мають доїхати до графіків. */
        const WL = window.WeightLimits;
        const kg = wRaw === '' ? null : WC.normWeight(wRaw);
        if (wRaw !== '' && kg === null) {
          toast(WL ? WL.message(ex.name) : 'Вага: 0–500 кг', 'err');
          return false;
        }
        if (WL && kg !== null && !WL.check(ex.name, wRaw).ok) {
          toast(WL.message(ex.name), 'err');
          return false;
        }
        /* Порожнє поле розминки — «нічого не міняв», а не нуль: нуль
           набирають, і він означає «без розминки». */
        const wu = WC.normWarmupCount(box.querySelector('#wk-sh-n').value);
        saveWorkWeight(ex, kg,
          RC ? RC.normUserReps(rRaw, ex) : null,
          RC ? RC.normRir(box.querySelector('#wk-sh-rir').value) : null,
          wu === null ? warm : wu);
        return true;
      }
    });
  }

  /**
   * Запис робочої ваги й власного числа повторень.
   *
   * Вага живе в книзі ваг, повторення — у збереженому плані: два різні
   * сховища, бо це різні за природою речі (див. js/reps-core.js). Тому
   * і патч один, і запис один — щоб половина правки не доїхала.
   */
  function saveWorkWeight(ex, kg, ownReps, rir, warm) {
    const patch = {};

    const weights = Object.assign({}, state.profile.weights || {});
    const before = Number(weights[ex.name]);
    if (kg === null) delete weights[ex.name]; else weights[ex.name] = kg;
    if (Number(before) !== Number(kg)) {
      state.profile.weights = weights;
      patch.weights = weights;
      if (kg !== null && window.HistoryCore) {
        const log = window.HistoryCore.appendWeight(state.profile.weightLog, ex.name, kg);
        state.profile.weightLog = log;
        patch.weightLog = log;
      }
    }

    const RC = window.RepsCore;
    let planChanged = false;

    const had = RC ? RC.normUserReps(ex.userReps, ex) : null;
    if (RC && had !== ownReps) {
      if (ownReps === null) { delete ex.userReps; ex.reps = RC.repRangeFor(state.profile.trainingAge, ex); }
      else { ex.userReps = ownReps; ex.reps = String(ownReps); }
      planChanged = true;
    }

    /*
     * RIR живе в самому плані, а не окремою книгою: на відміну від ваги,
     * він задається СХЕМОЮ вправи в цьому дні. Порожнє поле прибирає
     * число зовсім — у схемі тоді просто немає «· RIR n», і періодизація
     * рахує запас нулем, як і для будь-якої вправи без RIR.
     */
    const hadRir = RC ? RC.normRir(ex.rir) : null;
    if (RC && hadRir !== rir) {
      if (rir === null) delete ex.rir; else ex.rir = String(rir);
      planChanged = true;
    }

    if (planChanged) {
      patch.customPlans = planWithEdits();
      state.profile.customPlans = patch.customPlans;
    }

    /*
     * Розминка живе КНИГОЮ по назві вправи, як і робоча вага: вправа
     * одна — отже й розминка в неї одна, у якому б дні плану вона не
     * стояла. Тому не в customPlans.
     */
    if (warm !== undefined && warm !== WC.warmupCountFor(state.profile, ex)) {
      patch.warmups = writeWarmup(ex.name, warm, null);
    }

    if (!Object.keys(patch).length) return;
    window.App.stampRating(Object.assign({}, state.profile, patch), patch);
    saveOwn(patch).catch(function (e) {
      toast(e && e.queued ? e.message : 'Не збереглося: ' + (e && e.message), e && e.queued ? 'ok' : 'err');
    });
    render();
  }

  /**
   * Запис у книгу розминки.
   *
   * Одне місце на обидва вікна: у вікні ваги міняють ЛИШЕ кількість, і
   * воно не має права стерти повтори, набрані у вікні розминки. Тому
   * масив повторів не переписується цілком, а підрізається чи
   * доповнюється під нову кількість.
   *
   * Коли своїх повторів немає жодних, у книгу лягає САМЕ ЧИСЛО — та
   * форма, яку писала перша версія і яку читає стара збірка сайту, ще
   * відкрита в іншій вкладці.
   */
  function writeWarmup(name, n, repsOverride) {
    const book = Object.assign({}, state.profile.warmups || {});
    const own = WC.normWarmup(book[name]);
    const prev = own ? own.reps : [];
    const reps = [];
    for (let k = 0; k < n; k++) {
      const v = repsOverride ? repsOverride[k] : prev[k];
      reps.push(WC.normWarmupReps(v));
    }
    book[name] = reps.some(function (r) { return r !== null; }) ? { n: n, reps: reps } : n;
    state.profile.warmups = book;
    return book;
  }

  /**
   * Поточний план як збережена правка користувача.
   *
   * Той самий формат, що пише «Мій план тренувань» (js/programs.js):
   * ключ «програма:днів», ваги всередину не кладемо — єдине джерело
   * правди для них книга ваг. Інші ключі не чіпаємо: у профілі можуть
   * лежати правки до інших програм і до іншої кількості днів.
   */
  function planWithEdits() {
    const a = (state.profile && state.profile.activePlan) || {};
    const key = WC.planKey(a.programId || '', String(Number(a.days) || 0));
    const all = Object.assign({}, state.profile.customPlans || {});
    all[key] = state.plan.map(function (day) {
      return Object.assign({}, day, {
        exercises: (day.exercises || []).map(function (e) {
          const copy = Object.assign({}, e);
          delete copy.weight;
          return copy;
        })
      });
    });
    return all;
  }

  /*
   * ВІКНО РОЗМИНКИ.
   *
   * Кількість сходинок є і у вікні ваги — там її зручно поставити
   * заразом із самою вагою. Але повтори там були б п'ятим і шостим
   * полем у вікні, яке відкривають, щоб змінити одне число. Тому все,
   * що стосується самої розминки, живе окремо: кількість, а під нею —
   * рядок на кожну сходинку, де видно вагу й можна вписати точні
   * повтори замість діапазону з протоколу.
   *
   * Поля всіх п'яти сходинок малюються одразу й ховаються атрибутом
   * hidden: перемальовувати список під час набору означало б забрати
   * фокус із поля, у якому зараз друкують.
   */
  function openWarmupSheet(i) {
    const ex = state.plan[state.dayIdx].exercises[i];
    const n0 = WC.warmupCountFor(state.profile, ex);
    const own0 = warmupOwnReps(ex.name);
    const step = window.OneRM ? window.OneRM.PLATE_STEP : 2.5;
    const kg = planWeight(ex.name);

    let rows = '';
    for (let k = 0; k < WC.WARMUP_MAX; k++) {
      rows += '<div class="wu-row" data-wu-row="' + k + '"' + (k < n0 ? '' : ' hidden') + '>' +
        '<span class="wu-row__n mono">' + (k + 1) + '</span>' +
        '<span class="wu-row__kg mono" data-wu-kg="' + k + '">—</span>' +
        '<span class="wu-row__x">×</span>' +
        '<input class="input input--sm num mono" id="wk-wu-r' + k + '" type="number" ' +
          'min="1" max="' + WC.WARMUP_REPS_MAX + '" step="1" autocomplete="off" ' +
          'value="' + (own0[k] == null ? '' : own0[k]) + '" ' +
          'aria-label="Повтори розминкового підходу ' + (k + 1) + '">' +
      '</div>';
    }

    window.App.sheet({
      title: 'Розминка: ' + ex.name,
      sub: 'Сходинки до робочої ваги. Вага рахується сама, повтори можна ' +
           'замінити своїм числом — порожнє поле лишає діапазон із протоколу.',
      body:
        '<div class="field" style="max-width:190px">' +
          '<label class="field__label" for="wk-sh-n">Скільки підходів</label>' +
          '<input class="input num mono" id="wk-sh-n" type="number" min="0" max="' +
            WC.WARMUP_MAX + '" step="1" autocomplete="off" value="' + n0 + '">' +
        '</div>' +
        '<div class="wu-list mt-2">' + rows + '</div>' +
        '<p class="field__hint mt-1" data-wu-prev></p>' +
        '<p class="small muted mt-2" style="margin-bottom:0">0 — без розминки: ' +
          'тоді рядка про неї в тренуванні немає взагалі.</p>',
      onOpen: function (box) {
        const nInp = box.querySelector('#wk-sh-n');
        const out = box.querySelector('[data-wu-prev]');

        const sync = function () {
          const v = WC.normWarmupCount(nInp.value);
          const n = v === null ? n0 : v;
          const reps = [];
          for (let k = 0; k < WC.WARMUP_MAX; k++) {
            reps.push(box.querySelector('#wk-wu-r' + k).value);
          }
          const l = WC.warmupSets(kg, step, n, reps);
          /* Ваги проставляємо в самі рядки — щоб було видно, що саме
             ставити на штангу, ще до збереження. */
          for (let k = 0; k < WC.WARMUP_MAX; k++) {
            const row = box.querySelector('[data-wu-row="' + k + '"]');
            row.hidden = k >= n;
            const cell = box.querySelector('[data-wu-kg="' + k + '"]');
            cell.textContent = l[k] ? fmtNum.kg(l[k].kg) + ' кг' : '—';
            box.querySelector('#wk-wu-r' + k).placeholder =
              (WC.WARMUP_REPS[n] || [])[k] || '—';
          }
          out.textContent = kg === null
            ? 'Робочої ваги ще немає — рахувати нема від чого.'
            : (l.length ? '' : 'Без розминкових підходів.');
        };

        nInp.addEventListener('input', sync);
        box.querySelectorAll('.wu-row input').forEach(function (el) {
          el.addEventListener('input', sync);
        });
        sync();
      },
      onSave: function (box) {
        const v = WC.normWarmupCount(box.querySelector('#wk-sh-n').value);
        const n = v === null ? n0 : v;
        const reps = [];
        for (let k = 0; k < WC.WARMUP_MAX; k++) {
          reps.push(box.querySelector('#wk-wu-r' + k).value);
        }
        const book = writeWarmup(ex.name, n, reps);
        saveOwn({ warmups: book }).catch(function (e) {
          toast(e && e.queued ? e.message : 'Не збереглося: ' + (e && e.message), e && e.queued ? 'ok' : 'err');
        });
        render();
        return true;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Рядок вправи                                                        */
  /* ------------------------------------------------------------------ */
  /*
   * ТРИ ОДНАКОВІ РЯДКИ ЗАМІСТЬ ЧОТИРЬОХ РІЗНИХ.
   *
   * Під назвою вправи стояли: авторська примітка, рядок підводних, рядок
   * розминки, кружечки підходів із кнопкою журналу збоку і внизу окремо
   * зроблена робоча вага. Шість різних форм на одну вправу — і жодна не
   * підказувала, де тут можна щось змінити.
   *
   * Тепер усе, що правиться, стоїть однаково: підпис — значення — дія.
   * Робоча вага, розминка й ваги підходів виглядають як один список, бо
   * вони й є одним списком: три числа цієї вправи. Кружечки лишились
   * вище — вони не значення, а сама дія тренування.
   */
  /*
   * Кнопка стоїть УСЕРЕДИНІ <dd>, а не поруч із ним: у <dl> всередині
   * обгортки-<div> за специфікацією можуть лежати тільки <dt> і <dd>, і
   * кнопка третім сусідом робила б розмітку невалідною. Візуально нічого
   * не міняється — вирівнює її margin-left: auto.
   */
  function metaRow(label, valHtml, actHtml, extraCls) {
    return '<div class="tdy-ex__meta-row' + (extraCls || '') + '">' +
      '<dt class="tdy-ex__meta-lbl">' + esc(label) + '</dt>' +
      '<dd class="tdy-ex__meta-val">' +
        '<span class="tdy-ex__meta-txt">' + valHtml + '</span>' + actHtml +
      '</dd>' +
    '</div>';
  }

  function exerciseRow(ex, i) {
    const w = state.profile.weights && state.profile.weights[ex.name];
    const ps = WC.plannedSets(ex);
    const ds = WC.doneSetsFor(state.done[i], ps);
    const full = ps > 0 && ds >= ps;
    const sec = WC.restSecFor(ex);
    const off = locked();

    let pips = '';
    for (let n = 1; n <= ps; n++) {
      pips += '<button class="tdy-ex__set' + (n <= ds ? ' is-on' : '') + '" type="button" ' +
        'data-set-ex="' + i + '" data-set-n="' + n + '"' + (off ? ' disabled' : '') +
        ' aria-pressed="' + (n <= ds) + '" aria-label="Підхід ' + n + ': ' + esc(ex.name) + '">' +
        n + '</button>';
    }

    return '' +
      '<li class="tdy-ex' + (full ? ' is-done' : '') + '">' +
        '<div class="tdy-ex__top">' +
          '<div class="tdy-ex__body" style="flex:1;padding:13px 0 6px">' +
            '<span class="tdy-ex__name">' + esc(ex.name) + '</span>' +
            '<span class="tdy-ex__scheme mono">' +
              esc(ex.sets) + '×' + esc(ex.reps) +
              (ex.rir ? ' · RIR ' + esc(ex.rir) : '') +
            '</span>' +
            (ex.note ? '<span class="tdy-ex__note">' + esc(ex.note) + '</span>' : '') +
          '</div>' +
          '<button class="tdy-ex__rest btn btn--ghost btn--sm" type="button" ' +
                  'data-rest-sec="' + sec + '" data-rest-name="' + esc(ex.name) + '">' +
            Math.floor(sec / 60) + ' хв' +
          '</button>' +
        '</div>' +
        '<div class="tdy-ex__sets" role="group" aria-label="Підходи: ' + esc(ex.name) + '">' +
          pips +
          '<span class="tdy-ex__sets-num mono" data-sets-num="' + i + '">' + ds + '/' + ps + '</span>' +
        '</div>' +

        '<dl class="tdy-ex__meta">' +
          metaRow('Робоча вага',
            '<b class="tdy-ex__wt-val num mono">' + (w == null ? '—' : esc(fmtNum.kg(w))) + '</b>' +
            (w == null ? '' : '<span class="tdy-ex__wt-unit"> кг</span>'),
            '<button class="tdy-ex__meta-act tdy-ex__wt-edit" type="button" data-wt-edit="' + i + '"' +
              (off ? ' disabled' : '') +
              ' aria-label="Змінити робочу вагу: ' + esc(ex.name) + '">змінити</button>') +

          /*
           * РЯДКА РОЗМИНКИ НЕМАЄ, КОЛИ НЕМАЄ РОЗМИНКИ.
           *
           * «Розминка · без розминки · змінити» — це три слова про те,
           * чого на екрані не відбувається, і в ізоляції такий рядок
           * стояв у кожній вправі. Порожнє значення краще не показувати
           * зовсім, ніж показувати порожнім.
           *
           * Саме число при цьому не стає недосяжним: розминка правиться
           * у вікні робочої ваги, а воно є в кожної вправи.
           */
          (warmupLadder(ex).length
            ? metaRow('Розминка',
                '<span class="mono" data-wu-val="' + i + '">' + esc(warmupLine(ex)) + '</span>',
                '<button class="tdy-ex__meta-act" type="button" data-wu-edit="' + i + '"' +
                  (off ? ' disabled' : '') +
                  ' aria-label="Змінити розминку: ' + esc(ex.name) + '">змінити</button>',
                ' tdy-ex__meta-row--wrap')
            : '') +

          metaRow('Ваги підходів',
            '<span class="mono" data-log-sum="' + i + '">' + esc(logSummary(i)) + '</span>',
            '<button class="tdy-ex__meta-act" type="button" data-log-tgl="' + i + '" ' +
              'aria-expanded="false" aria-controls="wk-log-' + i + '"' +
              (ds ? '' : ' disabled') + '>показати</button>') +
        '</dl>' +

        '<div class="tdy-ex__log" id="wk-log-' + i + '" data-set-log="' + i + '" hidden>' +
          setLogHtml(i, ex, ps) +
        '</div>' +
      '</li>';
  }

  function emptyCard() {
    return '' +
      '<div class="card">' +
        '<h2 style="margin:0">План ще не обрано</h2>' +
        '<p class="small mt-1">Поставте кількість днів у залі, подивіться плани тренувань — ' +
          'і тут зʼявиться список вправ із вашими робочими вагами.</p>' +
        '<a class="btn btn--primary mt-1" href="programs.html">Обрати програму</a>' +
      '</div>';
  }

  /** Плашка стану завершеного дня (сьогодні чи раніше цього тижня) */
  function endedNote() {
    const weekDate = endedThisWeek(state.dayIdx);
    if (weekDate) {
      const s = WC.sessionFor(state.profile, weekDate) || {};
      const dsTxt = Number.isFinite(Number(s.doneSets)) && Number.isFinite(Number(s.totalSets))
        ? s.doneSets + ' з ' + s.totalSets + ' підходів'
        : (s.done || 0) + ' з ' + (s.total || 0) + ' вправ';
      return '<div class="notice mt-1" id="wk-ended">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>' +
        /* dateLabel хоче Date, а не ключ (TIM-009): new Date('2026-09-04')
           — це UTC-північ, і в поясах на захід від Гринвіча getDate()
           віддає попередній день. Усі інші виклики передають саме Date. */
        '<div><b>Завершено' + (weekDate === state.todayKey ? ' сьогодні' : ' ' + dateLabel(keyToDate(weekDate))) + '</b> — ' +
          dsTxt + '. Цей день знову доступний із понеділка.</div>' +
      '</div>';
    }
    if (endedToday()) {
      return '<div class="notice mt-1" id="wk-ended">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>' +
        '<div><b>Сьогоднішнє тренування вже завершене.</b> Наступне можна ' +
          'почати завтра — один день, одна сесія.</div>' +
      '</div>';
    }
    return '';
  }

  function workoutCard() {
    const day = state.plan[state.dayIdx];
    const st = WC.dayStats(day, state.done);
    const eta = WC.dayMinutes(day, state.done);
    const off = locked();

    const tabs = state.plan.map(function (d, i) {
      return '<label class="seg__item">' +
        '<input type="radio" name="wk-day" value="' + i + '"' + (i === state.dayIdx ? ' checked' : '') + '>' +
        '<span>' + esc(d.title || ('День ' + (i + 1))) + '</span>' +
      '</label>';
    }).join('');

    return '' +
      '<div class="card" id="wk-session">' +
        (state.plan.length > 1
          ? '<div class="seg" role="radiogroup" aria-label="День плану">' + tabs + '</div>'
          : '') +

        (day.focus ? '<p class="small muted" style="margin:12px 0 0">' + esc(day.focus) + '</p>' : '') +
        endedNote() +

        '<div class="row mt-1" style="justify-content:space-between;align-items:center">' +
          '<span class="small">Підходи <b class="mono" id="wk-done">' + st.doneSets + '/' + st.totalSets + '</b></span>' +
          (off
            ? '<a class="small" href="plan.html">Редагувати план</a>'
            : '<span class="small muted mono" id="wk-eta">' +
                (eta > 0 ? '≈' + eta + ' хв залишилось' : 'готово') + '</span>') +
        '</div>' +
        '<div class="vol" style="margin-top:6px"><span class="vol__bar">' +
          '<i id="wk-bar" style="width:' + (st.totalSets ? Math.round(st.doneSets / st.totalSets * 100) : 0) + '%"></i>' +
        '</span></div>' +

        '<ul class="tdy-list mt-2">' + day.exercises.map(exerciseRow).join('') + '</ul>' +

        (off
          ? ''
          : '<button class="btn btn--primary mt-2" type="button" id="wk-finish" style="width:100%">' +
              'Завершити тренування' +
            '</button>' +
            '<p class="small muted mb-0" style="margin-top:10px">' +
              'Тапайте по номерах підходів у міру виконання — час, що залишився, ' +
              'рахується сам. Завершити можна в будь-який момент; після цього ' +
              'день стає використаним до понеділка.' +
            '</p>' +
            '<p class="small muted mb-0" style="margin-top:8px">' +
              'Техніку виконання вправ рекомендуємо дивитися на каналі ' +
              '<a href="https://www.youtube.com/@JeffNippard" target="_blank" rel="noopener">Jeff Nippard</a> (YouTube, англійською).' +
            '</p>') +
      '</div>';
  }

  function render() {
    const host = $('#workout');
    if (!host) return;

    const sub = $('#wk-sub');
    if (sub) {
      sub.textContent = state.plan
        ? state.program.name + ' · ' + (state.plan[state.dayIdx].title || ('День ' + (state.dayIdx + 1)))
        : 'Програму ще не обрано';
    }

    host.innerHTML = state.plan ? (workoutCard() + moodCard()) : emptyCard();
    /* Розгорнуті панелі «Ваги підходів» — стан, а не розмітка (UX-001). */
    restoreOpenLogs();
  }

  /**
   * Оновити лише прогрес — щоб тап по підходу не перемальовував список під
   * пальцем. Старого тоста «Тренування виконано 💪» тут більше немає
   * навмисно: статус видно в лічильнику і в часі, а завершення дня — це
   * тепер явна кнопка, а не побічний ефект останньої галочки.
   */
  function refreshProgress() {
    const day = state.plan[state.dayIdx];
    const st = WC.dayStats(day, state.done);
    const eta = WC.dayMinutes(day, state.done);
    const bar = $('#wk-bar');
    const label = $('#wk-done');
    const etaEl = $('#wk-eta');
    if (bar) bar.style.width = (st.totalSets ? Math.round(st.doneSets / st.totalSets * 100) : 0) + '%';
    if (label) label.textContent = st.doneSets + '/' + st.totalSets;
    if (etaEl) etaEl.textContent = eta > 0 ? '≈' + eta + ' хв залишилось' : 'готово';
  }

  /* ------------------------------------------------------------------ */

  async function init() {
    const host = $('#workout');
    if (!host || !WC) return;

    try { state.profile = await window.Store.getProfile() || {}; }
    catch (_) { state.profile = {}; }

    state.todayKey = WC.todayKey();
    /* Північ: див. App.onDayChange. Тренування, почате ввечері, після
       00:00 має писатись у новий день, а не перетирати вчорашній. */
    if (window.App && window.App.onDayChange) {
      window.App.onDayChange(function () {
        const prevKey = state.todayKey;
        state.todayKey = WC.todayKey();
        if (state.plan && state.plan.length) {
          /*
           * ТРЕНУВАННЯ ЧЕРЕЗ ПІВНІЧ НЕ ОБНУЛЯЄТЬСЯ (TIM-003).
           *
           * Сторож півночі спрацьовує щохвилини. Раніше він просто
           * перечитував стан під новим ключем: forge.today датований учора
           * → readDay віддає fresh із порожнім done і підказкою НАСТУПНОГО
           * дня плану. Тобто о 00:00 закриті підходи зникали з екрана, «День
           * A» ставав «Днем B», а подальші тапи йшли вже в іншу сесію — одне
           * тренування розпадалось на дві часткові.
           *
           * Якщо тренування ще триває (є закриті підходи і день не
           * завершено), переносимо стан під новий ключ ЯК Є, з тим самим
           * dayIdx. Людина сама завершить його кнопкою.
           */
          const st = WC.dayStats(state.plan[state.dayIdx], state.done);
          /* «Завершено» перевіряємо за ВЧОРАШНІМ ключем: сесія, яку ведемо,
             належить ще йому. За новим ключем завершеного дня немає за
             визначенням, і перевірка була б завжди хибною. */
          const alive = Boolean(st && st.doneSets > 0 &&
            !WC.completedToday(state.profile, prevKey));
          if (alive) {
            WC.writeDay(state.profile, state.todayKey, state.dayIdx, state.done);
          } else {
            const nd = WC.readDay(state.profile, state.todayKey, state.plan.length);
            state.dayIdx = nd.dayIdx;
            state.done = nd.done;
          }
          if (prevKey !== state.todayKey && alive) {
            toast('Північ минула — тренування триває під сьогоднішньою датою', 'ok');
          }
        }
        render();
      });
    }
    if (window.TrackerCore) {
      state.trackers = window.TrackerCore.ensureBuiltins(state.profile.trackers);
      state.trackerLog = (state.profile.trackerLog && typeof state.profile.trackerLog === 'object') ? state.profile.trackerLog : {};
    }

    const resolved = WC.resolvePlan(state.profile);
    if (resolved) {
      state.program = resolved.program;
      state.plan = resolved.plan;
      const d = WC.readDay(state.profile, state.todayKey, state.plan.length);
      state.dayIdx = d.dayIdx;
      state.done = d.done;
      /* Свіжий день: якщо підказаний день уже завершено цього тижня,
         пропонуємо перший ще не завершений — а не замкнені двері. */
      if (d.fresh && !endedToday()) {
        const week = WC.completedThisWeek(state.profile, state.todayKey);
        for (let k = 0; k < state.plan.length; k++) {
          const idx = (d.dayIdx + k) % state.plan.length;
          if (!week[idx]) { state.dayIdx = idx; break; }
        }
      }
      applyDayFromUrl();
    }

    render();

    /*
     * Сторож вводу — той самий, що на «Сьогодні». Коли з одного поля ваги
     * тицяєш у сусіднє, браузер спершу знімає фокус зі старого (тоді ж
     * летить change → збереження), а ставить його на нове вже після
     * мікрозадач. У цю щілину приходить наш власний onChange: без сторожа
     * render() зніс би поле, куди людина щойно тицьнула.
     */
    const FIELD_SETTLE_MS = 120;
    const FIELD_GRACE_MS = 500;
    let lastFieldTouch = 0;
    let pendingRender = false;

    function fieldFocused(el) {
      return Boolean(el && el.closest && el.closest('#workout input, #workout select'));
    }
    function fieldBusy() {
      if (fieldFocused(document.activeElement)) return true;
      return (Date.now() - lastFieldTouch) < FIELD_GRACE_MS;
    }
    /*
     * Мітку оновлює й НАБІР, не лише фокус.
     *
     * Спершу тут стояли самі focusin/focusout, і вікно відлічувалось від
     * моменту, коли в поле СТАЛИ. Якщо в ньому потім довго набирали —
     * скажімо, шукали вагу між підходами — мітка встигала протухнути, і
     * change при переході в сусіднє поле знову ловив activeElement === body:
     * сторож не спрацьовував, render() зносив поле, куди щойно тицьнули.
     * Набір — така сама ознака «людина зараз тут», як і фокус.
     */
    ['focusin', 'focusout', 'input'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (fieldFocused(e.target)) lastFieldTouch = Date.now();
      });
    });

    window.Store.onChange(async function () {
      try { state.profile = await window.Store.getProfile() || {}; } catch (_) { return; }
      const r = WC.resolvePlan(state.profile);
      state.program = r ? r.program : null;
      state.plan = r ? r.plan : null;
      if (r) {
        state.dayIdx = WC.clampDay(state.dayIdx, r.plan.length);
        state.done = state.done.slice(0, r.plan[state.dayIdx].exercises.length);
      }
      if (window.TrackerCore) {
        state.trackers = window.TrackerCore.ensureBuiltins(state.profile.trackers);
        state.trackerLog = (state.profile.trackerLog && typeof state.profile.trackerLog === 'object') ? state.profile.trackerLog : {};
      }
      if (fieldBusy() || (Date.now() - lastSelfWrite) < SELF_WRITE_MS) { pendingRender = true; return; }
      render();
    });

    host.addEventListener('focusout', function () {
      if (!pendingRender) return;
      setTimeout(function () {
        if (fieldFocused(document.activeElement)) return;
        pendingRender = false;
        render();
      }, FIELD_SETTLE_MS);
    });

    host.addEventListener('change', function (e) {
      const day = e.target.closest('input[name="wk-day"]');
      if (day) {
        const want = WC.clampDay(Number(day.value), state.plan.length);
        if (want === state.dayIdx) return;
        /* Перемикання дня скидає закриті підходи — це усвідомлений крок,
           а не випадковий тап по сусідній вкладці. */
        const st = WC.dayStats(state.plan[state.dayIdx], state.done);
        if (st.doneSets > 0 && !locked() &&
            !confirm('Змінити день? Закриті підходи поточного (' +
                     st.doneSets + ' з ' + st.totalSets + ') буде скинуто.')) {
          render();
          return;
        }
        state.dayIdx = want;
        state.done = [];
        if (!locked()) saveDayState();
        render();
        return;
      }

      const sw = e.target.closest('[data-setw]');
      if (sw) {
        editSetField(Number(sw.dataset.setw), Number(sw.dataset.setn) - 1,
          { w: String(sw.value || '').replace(',', '.').trim() }, sw);
        return;
      }
      const sr = e.target.closest('[data-setr]');
      if (sr) {
        editSetField(Number(sr.dataset.setr), Number(sr.dataset.setn) - 1,
          { r: String(sr.value || '').trim() }, sr);
        return;
      }

      /* [data-wt] більше немає: робочу вагу з цієї сторінки не міняють. */
    });

    host.addEventListener('click', function (e) {
      const pip = e.target.closest('[data-set-ex]');
      if (pip && !pip.disabled && !locked()) {
        const i = Number(pip.dataset.setEx);
        const n = Number(pip.dataset.setN);
        const ex = state.plan[state.dayIdx].exercises[i];
        const ps = WC.plannedSets(ex);
        const cur = WC.doneSetsFor(state.done[i], ps);
        const next = (n === cur) ? n - 1 : n;   // тап по останньому закритому — відкат
        /* Тап ФІКСУЄ вагу й повтори станом на цю мить. Пізніша правка
           робочої ваги вже не переписує цей підхід заднім числом. */
        state.done[i] = WC.setDoneSets(state.done[i], next, ps,
          planWeight(ex.name), repLow(ex.reps));

        /* Точкове оновлення рядка — без перемальовки списку під пальцем */
        const row = pip.closest('.tdy-ex');
        row.querySelectorAll('[data-set-ex]').forEach(function (b) {
          const on = Number(b.dataset.setN) <= next;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        row.classList.toggle('is-done', ps > 0 && next >= ps);
        const num = row.querySelector('[data-sets-num]');
        if (num) num.textContent = next + '/' + ps;
        syncSetLog(row, i);

        saveDayState();
        refreshProgress();
        return;
      }

      const tgl = e.target.closest('[data-log-tgl]');
      if (tgl && !tgl.disabled) {
        const box = tgl.closest('.tdy-ex').querySelector('[data-set-log]');
        if (box) {
          box.hidden = !box.hidden;
          tgl.setAttribute('aria-expanded', String(!box.hidden));
          tgl.textContent = box.hidden ? 'показати' : 'сховати';
          const idx = Number(box.dataset.setLog);
          if (box.hidden) openLogs.delete(idx); else openLogs.add(idx);
        }
        return;
      }

      /* Обидва «змінити» — однакові кнопки, що відкривають вікно. Під час
         завершеного дня вони вимкнені: план правлять до або після, а не
         в записі, який уже поїхав в історію. */
      const wtBtn = e.target.closest('[data-wt-edit]');
      if (wtBtn && !wtBtn.disabled) { openWeightSheet(Number(wtBtn.dataset.wtEdit)); return; }

      const wuBtn = e.target.closest('[data-wu-edit]');
      if (wuBtn && !wuBtn.disabled) { openWarmupSheet(Number(wuBtn.dataset.wuEdit)); return; }



      if (e.target.closest('#wk-finish')) { finishWorkout(); return; }

      const rest = e.target.closest('[data-rest-sec]');
      if (rest) {
        window.App.restTimer.start(Number(rest.dataset.restSec) || 120, rest.dataset.restName || '');
        return;
      }

      const TC = window.TrackerCore;
      const pr = TC && e.target.closest('[data-trk-pair]');
      if (pr) {
        const patch = {}; patch[pr.dataset.field] = Number(pr.dataset.val);
        saveTrackerLog(TC.logValue(state.trackers, state.trackerLog, pr.dataset.trkPair, patch, state.todayKey));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
