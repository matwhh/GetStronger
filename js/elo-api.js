/**
 * Клієнтський шар сезонного ELO.
 *
 * Розподіл ролей:
 *   • РАХУЄ сервер (RPC elo_submit і компанія, db/elo-engine.sql):
 *     клієнт не пише в таблиці рейтингу і не може вигадати собі дельту;
 *   • ПОКАЗУЄ клієнт одразу: оптимістична дельта з js/elo-core.js і
 *     кешованого конфігу, поки летить запит. Відповідь сервера — істина:
 *     кеш звіряється з нею при кожному submit/refresh.
 *
 * Офлайн: подія стає в чергу ('ib.eloPending') і досилається при
 * поверненні мережі — так само, як це вже робить Store для профілю.
 * Ідемпотентність — на сервері: ідентичність події (user, kind, day) виводить
 * сам сервер (db/elo-integrity.sql); action_key лишається лише як ключ
 * локальної черги і сервером не читається.
 *
 * Локальний режим (без Supabase) або без входу: submit тихо no-op —
 * Get Stronger працює як раніше, просто без сезонного рейтингу.
 */
(function () {
  'use strict';

  const LS_STATE = 'ib.eloState';
  const LS_QUEUE = 'ib.eloPending';

  const listeners = new Set();
  let state = null;      // { season, elo, today, graceUsed, graceUntil, rank, of, config }
  let flushing = false;

  function lsGet(k, fb) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? fb : v; }
    catch (_) { return fb; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (_) {} }); }

  function available() {
    return Boolean(window.Store && window.Store.isCloud && window.Store.user());
  }

  function cached() {
    if (state) return state;
    state = lsGet(LS_STATE, null);
    return state;
  }

  function setState(next) {
    state = next;
    lsSet(LS_STATE, next);
    emit();
  }

  /* ---------------- Черга ---------------- */

  function queueGet() { return lsGet(LS_QUEUE, []); }
  /** id користувача поточної сесії — черга належить саме йому. */
  function currentUid() {
    try {
      const u = window.Store && window.Store.user && window.Store.user();
      return (u && u.id) || null;
    } catch (_) { return null; }
  }

  function queuePush(item) {
    const q = queueGet();
    if (q.some(function (x) { return x.key === item.key; })) return;
    /* uid у самому елементі — другий рубіж поверх очищення при виході.
       Раніше черга переживала вихід, і події одного користувача
       досилалися під сесією наступного. */
    item.uid = currentUid();
    q.push(item);
    /* Ліміт: черга не має рости безмежно, коли мережі немає тижнями. */
    lsSet(LS_QUEUE, q.slice(-200));
  }

  async function flush() {
    if (flushing || !available()) return;
    const q = queueGet();
    if (!q.length) return;
    flushing = true;
    try {
      const me = currentUid();
      const drop = function (key) {
        lsSet(LS_QUEUE, queueGet().filter(function (x) { return x.key !== key; }));
      };
      for (const item of q.slice()) {
        /* Чужа подія (лишилась від попереднього користувача) не відправляється
           взагалі — і з черги прибирається, щоб не висіти вічно. */
        if (item.uid && me && item.uid !== me) { drop(item.key); continue; }
        try {
          const res = await window.Store.rpc('elo_submit', {
            p_kind: item.kind, p_action_key: item.key, p_day: item.day, p_payload: item.payload
          });
          /* no_data: профіль ще не доїхав у хмару (черга Store незалежна).
             Подію лишаємо в черзі — повтор має сенс. */
          if (res && res.ok === false && res.retry) continue;
          drop(item.key);
        } catch (e) {
          /*
           * Симетрично до submit (SYN-012): раніше будь-яка помилка без
           * ознаки offline видаляла подію з черги НАЗАВЖДИ — включно з 429,
           * де повтор якраз і має сенс, і з 500, де сервер просто моргнув.
           */
          const st = e && e.status;
          if (e && (e.offline || !st || st >= 500 || st === 429)) break;  // решта почекає
          // 4xx (out_of_window тощо) — з черги прибираємо, повтор марний
          drop(item.key);
        }
      }
      await refresh().catch(function () {});
    } finally { flushing = false; }
  }

  /* ---------------- Публічне ---------------- */

  /** Свіжий стан із сервера (і кеш для бейджа між сторінками). */
  /*
   * Невдала спроба теж має бути ВИДИМОЮ (UX-003).
   *
   * Картка «Сезон» на головній малює «Завантажується…», поки Api.cached()
   * порожній, — і лишалась у цьому стані НАЗАВЖДИ, якщо elo_state
   * недоступна (мережа, 500) або повернула відповідь без config. Ні
   * помилки, ні повтору, ні кнопки. rating.html у тих самих умовах
   * поводиться правильно, і саме тому розбіжність ніхто не помічав.
   */
  let lastError = null;

  async function refresh() {
    if (!available()) return cached();
    try {
      /*
       * ДЕНЬ ПЕРЕДАЄ КЛІЄНТ (ELO-007).
       *
       * «Сьогодні: +X ELO» рахувалось за UTC-днем бази, а події лягають з
       * локальним днем браузера. У Києві з 00:00 до 03:00 це різні дати:
       * картка показувала вчорашню суму й о 03:00 обнулялась сама, без
       * жодної дії людини. Сервер валідує це значення у вузькому вікні.
       */
      const data = await window.Store.rpc('elo_state', { p_today: localDayKey() });
      lastError = null;
      setState(data);
      return data;
    } catch (e) {
      lastError = (e && e.message) || 'сервер не відповів';
      reportUnexpected('elo_state', e);
      throw e;
    }
  }

  /*
   * ПОМИЛКА, ЯКОЇ НІХТО НЕ БАЧИТЬ, — ЦЕ НЕ ПОМИЛКА (INV-011).
   *
   * Sentry отримував лише необроблені винятки. А всі відмови серверних RPC
   * ловились у catch і перетворювались на null або на позначку в черзі:
   * 400 через зіпсований payload, 500 через баг у функції, 403 через
   * несподіваний статус акаунта виглядали однаково — «нічого не сталось».
   *
   * Сюди йдуть лише НЕСПОДІВАНІ відмови. Офлайн, відсутність сесії й
   * штатні 4xx (out_of_window, дубль) — не баги, і засмічувати ними звіт
   * означає перестати їх читати.
   */
  function reportUnexpected(where, e) {
    if (!e || e.offline || e.noauth || e.queued) return;
    const st = Number(e.status) || 0;
    if (st >= 400 && st < 500 && st !== 429) return;
    try { if (window.ForgeErrors) window.ForgeErrors.report(e, { rpc: where, status: st || null }); }
    catch (_) {}
  }

  /** Остання невдача refresh() або null. Для картки «Сезон». */
  function stateError() { return cached() ? null : lastError; }

  /**
   * Подати дію. Повертає СЕРВЕРНУ відповідь {delta, elo, today} або
   * оптимістичну {delta, optimistic:true}, якщо мережі немає.
   * kind: workout | meal | sleep | recovery | activity
   * key:  унікальний ключ дії, напр. 'workout:2026-09-14'
   */
  async function submit(kind, key, day, payload) {
    if (!available()) return null;

    /* Оптимістична дельта — з того самого ядра і кешованого конфігу */
    let optimistic = null;
    const st = cached();
    if (window.EloCore && st && st.config) {
      const planned = payloadPlanned();
      const grace = st.graceUntil && day <= st.graceUntil;
      /* ELO обовʼязково: відколи вартість дії залежить від рівня
         (levelPace), без нього клієнт показав би число з найнижчого
         рівня — на першому рівні вдвічі більше за правду, в ELITE
         навпаки. Сервер усе одно перерахує, але людина встигла б
         побачити «+8», а отримати «+3». */
      optimistic = window.EloCore.actionDelta(kind, payload, st.config,
        { plannedDays: planned, grace: grace, elo: st.elo }).delta;
    }

    try {
      const res = await window.Store.rpc('elo_submit', {
        p_kind: kind, p_action_key: key, p_day: day, p_payload: payload
      });
      if (res && res.ok) {
        /*
         * res.today приходить із season_state.today_delta, а той прибитий
         * до UTC-дня (ELO-007). Беремо лише elo, а «сьогодні» перепитуємо
         * у elo_state — там воно рахується за локальним днем. Один зайвий
         * запит на подану дію, тобто кілька на добу.
         */
        setState(Object.assign({}, cached() || {}, { elo: res.elo }));
        refresh().catch(function () {});
      }
      return res;
    } catch (e) {
      /*
       * ЩО ВАРТО ПОВТОРИТИ, А ЩО НІ (SYN-012).
       *
       * Раніше в чергу подія потрапляла лише при offline або noauth. Будь-яка
       * інша відмова — 500, 502, 429 — давала return null: подія не
       * записувалась нікуди, і тренування просто не зараховувалось. Тимчасова
       * відмова сервера коштувала людині дня.
       *
       * Тепер: мережа, автентифікація, 5xx і 429 — у чергу (повтор має сенс);
       * 4xx — ні (out_of_window, дубль, невідомий kind повторювати марно).
       */
      const st = e && e.status;
      if (e && (e.offline || e.noauth || !st || st >= 500 || st === 429)) {
        queuePush({ kind: kind, key: key, day: day, payload: payload });
        return optimistic === null ? null : { ok: true, delta: optimistic, optimistic: true };
      }
      /*
       * 4xx — остаточна відмова (out_of_window, невідомий kind, сезон
       * закрито). Раніше тут повертався null, і js/elo-hooks.js не
       * позначав подію надісланою — тобто довбав сервер тією самою подією
       * на кожен Store.onChange три доби (INV-004). Повертаємо явну
       * відмову з retry:false, щоб її можна було закрити.
       */
      reportUnexpected('elo_submit:' + kind, e);
      return { ok: false, error: 'rejected', status: st, retry: false };
    }
  }

  /**
   * Скільки тренувань на тиждень бере СЕРВЕР (ELO-008).
   *
   * Оптимістична дельта рахується тим самим ядром, що й серверна, але
   * planned раніше брався з іншого джерела і за іншими межами: клієнт —
   * Math.max(1, …) з ПОТОЧНОГО профілю, сервер — greatest(3, least(7, …))
   * зі ЗНІМКА тижня (elo_week_plan). Для плану «1 день на тиждень» це
   * давало тост «+51 ELO» там, де сервер нараховував +17, і людина бачила
   * як число зменшується саме собою.
   *
   * Тепер джерело одне: elo_state віддає plannedWeek — те саме число, яким
   * рахує сервер. Профіль лишається запасним варіантом на випадок, коли
   * стану ще немає (перший запуск, офлайн до першого refresh) — але вже з
   * серверними межами 3..7.
   */
  function payloadPlanned() {
    const st = cached();
    const fromServer = st && Number(st.plannedWeek);
    if (fromServer >= 1) return fromServer;
    try {
      const p = JSON.parse(localStorage.getItem('ib.profile')) || {};
      return Math.max(3, Math.min(7, Math.floor(
        Number(p.activePlan && p.activePlan.days) || Number(p.daysPerWeek) || 3)));
    } catch (_) { return 3; }
  }

  /** Локальний день браузера у форматі РРРР-ММ-ДД. */
  function localDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /**
   * Дооцінити ВСІ пропущені тижні (штрафи за недобір / бонуси за чистий).
   *
   * Раніше клієнт крутив фіксоване вікно «2 тижні назад від сьогодні» —
   * і в цьому були дві діри: (1) хто зникав на 3+ тижні, за старіші тижні
   * штрафу не діставав; (2) вікно рахувалось від СЬОГОДНІ без прив'язки до
   * дати вступу, тож той, хто приєднається в середині сезону, дістав би
   * штраф за тижні ДО реєстрації.
   *
   * Тепер одна серверна RPC elo_catch_up: вона йде від першого запису
   * людини в сезоні до сьогодні й оцінює кожен незакритий тиждень
   * (ідемпотентно; тижні до вступу не чіпає — прив'язка до min(day) подій).
   * Дросель — раз на добу: новий тиждень закривається лише в понеділок,
   * тож частіше кликати нема сенсу, а щоденний виклик ловить свіжозакритий.
   */
  function dayStamp(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  async function evaluateWeeks() {
    if (!available()) return;
    const stamp = dayStamp(new Date());
    /* ib.eloWeeks лишається тим самим ключем (його вже чистить вихід із
       акаунта), але тепер тримає дату останнього прогону, а не мапу тижнів. */
    if (lsGet('ib.eloWeeks', null) === stamp) return;
    try {
      const res = await window.Store.rpc('elo_catch_up', {});
      if (res && res.ok) lsSet('ib.eloWeeks', stamp);
    } catch (_) { /* офлайн або NOT_APPROVED — спробуємо наступного заходу */ }
  }

  /** Закрити минулий сезон, якщо ще не закритий (звіт + нагороди). */
  async function closeSeasonIfDue() {
    if (!available() || !window.EloCore) return null;

    /*
     * ПОПЕРЕДНІЙ СЕЗОН = день перед початком поточного.
     *
     * Було setMonth(getMonth() - 3), і воно переповнювалось: 31 травня
     * мінус три місяці — це «31 лютого», тобто 3 березня, тобто ВЕСНА —
     * поточний сезон. Сервер відповідав season_running, а клієнт усе одно
     * позначав сезон закритим. Коли він реально закінчувався, done[code]
     * уже стояв — і сезон не закривався ніколи: ні історії, ні нагород,
     * ні звіту. Вікно бага: 29–31 травня щороку.
     *
     * seasonRange повертає межі поточного сезону; день перед його початком
     * гарантовано належить попередньому, у будь-якому місяці.
     */
    /* Арифметика живе в ядрі (EloCore.previousSeasonCode) — там її й
       перевіряють тести. Раніше вона була тут, а тест ганяв власну копію
       (TST-001). */
    const code = window.EloCore.previousSeasonCode(new Date());

    const done = lsGet('ib.eloClosed', {});
    if (done[code]) return null;

    /*
     * B8 (вартість): неостаточна відповідь (season_running, no_data,
     * помилка мережі) не може змінитись протягом дня — сезон закривається
     * лише з першого дня наступного (і тоді code вже інший). Тож після
     * неостаточної відповіді повторна спроба для того самого коду — не
     * раніше наступного дня, а не на кожному завантаженні сторінки.
     * Ключ ib.eloClosed чиститься виходом із акаунта разом з ib.eloWeeks.
     */
    const stamp = dayStamp(new Date());
    if (done['try:' + code] === stamp) return null;
    try {
      const res = await window.Store.rpc('elo_close_season', { p_season: code });
      /*
       * Позначка ставиться ЛИШЕ на остаточний результат. Раніше вона
       * ставилась безумовно, тож тимчасова відповідь (season_running,
       * no_data) назавжди блокувала закриття сезону.
       */
      if (res && (res.ok === true)) { done[code] = true; delete done['try:' + code]; }
      else done['try:' + code] = stamp;
      lsSet('ib.eloClosed', done);
      return res && res.ok && !res.duplicate ? res : null;
    } catch (_) {
      done['try:' + code] = stamp;
      lsSet('ib.eloClosed', done);
      return null;
    }
  }

  window.EloApi = {
    available: available,
    cached: cached,
    refresh: refresh,
    stateError: stateError,
    submit: submit,
    flush: flush,
    evaluateWeeks: evaluateWeeks,
    closeSeasonIfDue: closeSeasonIfDue,
    activateGrace: function () { return window.Store.rpc('elo_activate_grace', {}); },
    /* Перерахунок сезону після зміни набору категорій. Аргументів немає
       навмисно: сервер сам знає і нинішній набір, і те, чим перевіряти
       старі дельти (db/elo-recount-category.sql). */
    recountCategories: function () { return window.Store.rpc('elo_recount_categories', {}); },
    leaderboard: function (n) { return window.Store.rpc('elo_leaderboard', { p_limit: n || 50 }); },
    setName: function (name) { return window.Store.rpc('elo_set_name', { p_name: name }); },
    history: function () {
      return window.Store.rpc('elo_history', {});
    },
    onChange: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; }
  };

  /* Черга досилається сама: при появі мережі й на старті сторінки */
  window.addEventListener('online', function () { flush(); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(flush, 800); });
  } else { setTimeout(flush, 800); }
})();
