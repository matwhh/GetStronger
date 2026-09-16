/**
 * Адмінка → «Розклад»: чи працює нічна робота.
 *
 * ЧОМУ ЦЕ ВЗАГАЛІ Є. Три завдання pg_cron роблять усе, що не можна
 * доручити браузеру: оцінюють тиждень, закривають сезони, прибирають
 * незавершені реєстрації. Результат кожного лягає в public.cron_log.
 *
 * Доти єдиним сигналом про провал був raise exception в обгортці — і він
 * же цей сигнал і знищував: pg_cron виконує завдання ОДНІЄЮ транзакцією,
 * тож виняток відкочував і зроблену роботу, і сам рядок журналу
 * (db/cron-keep-work.sql). Тепер обгортка лише пише журнал, а дивиться в
 * нього ця вкладка.
 *
 * Дані бере admin_cron_health() — SECURITY DEFINER RPC, який сам
 * перевіряє is_admin(). Тут лише інтерфейс: не-адмін побачить відмову
 * сервера, що б він не робив із цією сторінкою.
 */
(function () {
  'use strict';

  const { $, esc } = window.App;
  const Store = window.Store;

  const state = { jobs: null, denied: '', busy: false };

  /* Людські назви завдань. У базі вони зберігаються службовими іменами —
     саме такими, якими їх пише обгортка в cron_log. */
  const JOB_UA = {
    elo_cron_eval_week:      { name: 'Оцінка тижня',        when: 'щодня 00:10 UTC' },
    elo_cron_close_seasons:  { name: 'Закриття сезонів',    when: 'щодня 03:40 UTC' },
    purge_abandoned_signups: { name: 'Прибирання реєстрацій', when: 'щодня 03:20 UTC' }
  };

  const STATE_UA = {
    ok:     { label: 'працює',        cls: 'chip--ok' },
    failed: { label: 'з помилками',   cls: 'chip--warn' },
    stale:  { label: 'не виконувалось', cls: 'chip--warn' },
    never:  { label: 'жодного прогону', cls: 'chip--warn' }
  };

  /** Коли востаннє — людською мовою, з точною датою поруч. */
  function ago(iso) {
    if (!iso) return 'ніколи';
    const D = window.DateCore;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const days = D ? D.daysBetween(D.keyOf(d), D.keyOf(new Date())) : null;
    const when = d.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
    if (days === null) return when;
    if (days <= 0) return 'сьогодні, ' + when;
    if (days === 1) return 'учора, ' + when;
    return days + ' дн. тому, ' + when;
  }

  function jobCard(j) {
    const meta = JOB_UA[j.job] || { name: j.job, when: '' };
    const st = STATE_UA[j.state] || STATE_UA.never;
    const failed = Number(j.failed) || 0;
    return '<div class="card">' +
      '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<h3 class="card__title" style="margin:0">' + esc(meta.name) + '</h3>' +
        '<span class="chip ' + st.cls + '">' + esc(st.label) + '</span>' +
      '</div>' +
      '<p class="small muted" style="margin:6px 0 0">' + esc(meta.when) + '</p>' +
      '<p class="small" style="margin:6px 0 0">Останній прогін: <b>' + esc(ago(j.lastRun)) + '</b></p>' +
      (failed > 0
        ? '<p class="small" style="margin:6px 0 0">Помилок у прогоні: <b class="mono">' + failed + '</b></p>' +
          '<pre class="small mono" style="white-space:pre-wrap;margin:6px 0 0">' +
            esc(JSON.stringify((j.result && j.result.reasons) || j.result || {}, null, 1)) +
          '</pre>'
        : '') +
    '</div>';
  }

  function render() {
    const host = $('#adm-cron');
    if (!host) return;

    if (state.denied) {
      host.innerHTML = '<div class="card"><p class="small mb-0">' + esc(state.denied) + '</p></div>';
      return;
    }
    if (!state.jobs) {
      host.innerHTML = '<div class="card"><p class="small muted mb-0">Завантаження…</p></div>';
      return;
    }

    const bad = state.jobs.filter(function (j) { return j.state !== 'ok'; }).length;
    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">' +
          '<h2 style="margin:0">Нічна робота</h2>' +
          '<button class="btn btn--ghost btn--sm" id="ac-reload" type="button">Оновити</button>' +
        '</div>' +
        '<p class="small muted" style="margin:8px 0 0">' +
          (bad
            ? 'Проблемних завдань: <b>' + bad + '</b>. Причина — у картці нижче.'
            : 'Усі три завдання відпрацювали за останні дві доби.') +
        '</p>' +
      '</div>' +
      '<div class="mt-2">' + state.jobs.map(jobCard).join('') + '</div>';
  }

  async function load() {
    if (state.busy) return;
    state.busy = true;
    render();
    try {
      const res = await Store.rpc('admin_cron_health', {});
      /* Порожня відповідь — це НЕ «все добре». Функція завжди повертає всі
         три завдання; порожній масив означає, що відповів не той, кого
         питали (або не відповів ніхто), і малювати на цьому зелений рядок
         було б брехнею найгіршого ґатунку — заспокійливою. */
      const jobs = res && Array.isArray(res.jobs) ? res.jobs : null;
      if (!jobs || !jobs.length) throw new Error('порожня відповідь сервера');
      state.jobs = jobs;
      state.denied = '';
    } catch (e) {
      const msg = (e && e.message) || '';
      /* FORBIDDEN від сервера — це не поламка, а правильна відповідь тому,
         хто не адмін. Показуємо це словами, а не «щось пішло не так». */
      state.denied = /FORBIDDEN/i.test(msg)
        ? 'Доступ лише для адміністратора.'
        : 'Не вдалося отримати стан розкладу: ' + msg;
      state.jobs = null;
    }
    state.busy = false;
    render();
  }

  function init() {
    const host = $('#adm-cron');
    if (!host) return;

    /* Вантажимо лише коли вкладку відкрили: на сторінці заявок цей запит
       нікому не потрібен. Видимість панелей крутить js/admin.js. */
    document.addEventListener('adm:tab', function (e) {
      if (e.detail === 'cron' && !state.jobs && !state.denied) load();
    });

    host.addEventListener('click', function (e) {
      if (e.target.closest('#ac-reload')) { state.jobs = null; load(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
