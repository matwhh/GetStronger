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
  function queuePush(item) {
    const q = queueGet();
    if (q.some(function (x) { return x.key === item.key; })) return;
    q.push(item);
    lsSet(LS_QUEUE, q);
  }

  async function flush() {
    if (flushing || !available()) return;
    const q = queueGet();
    if (!q.length) return;
    flushing = true;
    try {
      for (const item of q.slice()) {
        try {
          await window.Store.rpc('elo_submit', {
            p_kind: item.kind, p_action_key: item.key, p_day: item.day, p_payload: item.payload
          });
          lsSet(LS_QUEUE, queueGet().filter(function (x) { return x.key !== item.key; }));
        } catch (e) {
          if (e && e.offline) break;         // мережі немає — решта почекає
          // 4xx (out_of_window тощо) — з черги прибираємо, повтор марний
          lsSet(LS_QUEUE, queueGet().filter(function (x) { return x.key !== item.key; }));
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

  /** Ліниво оцінити минулі тижні (штрафи/бонуси). Раз на сесію сторінки. */
  async function evaluateWeeks() {
    if (!available() || !window.EloCore) return;
    const done = lsGet('ib.eloWeeks', {});
    const now = new Date();
    for (let back = 1; back <= 2; back++) {
      const d = new Date(now);
      d.setDate(d.getDate() - 7 * back);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // понеділок
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (done[key]) continue;
      try {
        const res = await window.Store.rpc('elo_evaluate_week', { p_week_start: key });
        if (res && res.ok !== undefined) { done[key] = true; lsSet('ib.eloWeeks', done); }
      } catch (_) { break; }
    }
  }

  /** Закрити минулий сезон, якщо ще не закритий (звіт + нагороди). */
  async function closeSeasonIfDue() {
    if (!available() || !window.EloCore) return null;
    const prev = new Date();
    prev.setMonth(prev.getMonth() - 3);
    const code = window.EloCore.seasonOf(prev);
    const done = lsGet('ib.eloClosed', {});
    if (done[code]) return null;
    try {
      const res = await window.Store.rpc('elo_close_season', { p_season: code });
      done[code] = true; lsSet('ib.eloClosed', done);
      return res && res.ok && !res.duplicate ? res : null;
    } catch (_) { return null; }
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
