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
 * Ідемпотентність на сервері (unique action_key) робить повтор безпечним.
 *
 * Локальний режим (без Supabase) або без входу: submit тихо no-op —
 * Forge працює як раніше, просто без сезонного рейтингу.
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
          if (e && e.offline) break;         // мережі немає — решта почекає
          // 4xx (out_of_window тощо) — з черги прибираємо, повтор марний
          drop(item.key);
        }
      }
      await refresh().catch(function () {});
    } finally { flushing = false; }
  }

  /* ---------------- Публічне ---------------- */

  /** Свіжий стан із сервера (і кеш для бейджа між сторінками). */
  async function refresh() {
    if (!available()) return cached();
    const data = await window.Store.rpc('elo_state', {});
    setState(data);
    return data;
  }

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
      optimistic = window.EloCore.actionDelta(kind, payload, st.config,
        { plannedDays: planned, grace: grace }).delta;
    }

    try {
      const res = await window.Store.rpc('elo_submit', {
        p_kind: kind, p_action_key: key, p_day: day, p_payload: payload
      });
      if (res && res.ok) {
        setState(Object.assign({}, cached() || {}, {
          elo: res.elo, today: res.today !== undefined ? res.today : (cached() || {}).today
        }));
      }
      return res;
    } catch (e) {
      if (e && (e.offline || e.noauth)) {
        queuePush({ kind: kind, key: key, day: day, payload: payload });
        return optimistic === null ? null : { ok: true, delta: optimistic, optimistic: true };
      }
      return null;
    }
  }

  function payloadPlanned() {
    /* План читаємо з кешу профілю СИНХРОННО — submit не має чекати. */
    try {
      const p = JSON.parse(localStorage.getItem('ib.profile')) || {};
      return Math.max(1, Math.min(7,
        Number(p.activePlan && p.activePlan.days) || Number(p.daysPerWeek) || 3));
    } catch (_) { return 3; }
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
    const now = new Date();
    const range = window.EloCore.seasonRange(window.EloCore.seasonOf(now));
    const dayBefore = new Date(range[0].getFullYear(), range[0].getMonth(), range[0].getDate() - 1);
    const code = window.EloCore.seasonOf(dayBefore);

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
    submit: submit,
    flush: flush,
    evaluateWeeks: evaluateWeeks,
    closeSeasonIfDue: closeSeasonIfDue,
    activateGrace: function () { return window.Store.rpc('elo_activate_grace', {}); },
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
