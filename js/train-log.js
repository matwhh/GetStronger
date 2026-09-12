/**
 * Сторінка «Дні тренувань» — календар і одна позначка.
 *
 * НАВІЩО ОКРЕМА СТОРІНКА. Та сама теплокарта є в «Прогресі» й там
 * лишається. Але там вона — частина великого звіту: над нею графіки, під
 * нею статистика дотримання плану, і з телефона доїхати до неї означає
 * прокрутити сторінку на два екрани й дочекатись, поки домалюється все
 * інше. Тут потрібна одна дія — сказати «цей день був тренувальним», — і
 * вона на першому екрані.
 *
 * ЩО САМЕ ТУТ МОЖНА. Позначити або зняти день. Рівень заливки — похідне
 * від записаних підходів, і клацанням не задається: шкала означає, ЯКУ
 * ЧАСТКУ запланованого закрито, а цього руками не вигадаєш. Тому
 * перемикач бінарний, а рівень рахує ядро (js/daylog-core.js, dayLevel).
 *
 * ЦЕ НЕ ДРУГИЙ ЖУРНАЛ. profile.workLog і profile.sessionLog ті самі, що в
 * «Прогресі» й на «Тренуванні». Правило «явний 0 перекриває сесію» теж
 * одне на всіх — воно в ядрі, а не тут.
 */
(function () {
  'use strict';

  const { $, esc, toast, dateLabel } = window.App;
  const DL = window.DayLogCore;
  const DC = window.DateCore;
  const Store = window.Store;

  /* Те саме вікно, що в «Прогресі»: сім календарних місяців. Інше вікно
     означало б, що два календарі одного журналу показують різні відрізки. */
  const MONTHS = 7;

  const state = { workLog: {}, sessionLog: {}, target: 0, ready: false };

  /* Делегат: єдина реалізація — js/date-core.js. */
  function todayKey() { return window.DateCore.todayKey(); }

  /**
   * Скільки днів на тиждень у обраному плані. 0 — плану немає.
   *
   * Береться з profile.activePlan.days — те саме джерело, що в «Прогресі»
   * (state.daysTarget). Розгортати сам план через WorkoutCore тут не
   * треба: сторінці потрібне ОДНЕ число, а розгортання потягло б за собою
   * programs-data, exercises і reps-core — 1,5 тисячі рядків заради
   * знаменника дробу.
   */
  function planDays(p) {
    const n = Number(p && p.activePlan && p.activePlan.days);
    return (Number.isInteger(n) && n >= 1 && n <= 7) ? n : 0;
  }
  function isTrained(k) { return DL.trained(state.workLog, state.sessionLog, k); }

  /* ------------------------------------------------------------------ */
  /* Малювання                                                           */
  /* ------------------------------------------------------------------ */

  function calHtml() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1), 1);
    return window.DayCal.html({
      from: DC.keyOf(first),
      to: todayKey(),
      label: 'Календар тренувань за ' + MONTHS + ' місяців',
      cls: 'mt-2',
      cell: function (k, d, isFuture) {
        if (isFuture) return null;
        const lvl = DL.dayLevel(state.workLog, state.sessionLog, k);
        return {
          lvl: lvl,
          attrs: 'data-hm="' + k + '"',
          label: dateLabel(DC.dateOf(k)) + ': ' + DL.LEVEL_TEXT[lvl] +
            '. Натисніть, щоб ' + (lvl ? 'зняти позначку' : 'позначити тренування')
        };
      }
    });
  }

  function legendHtml() {
    /* Легенда переписує підписи з ядра, а не свої: тими самими словами
       підписані підказки клітинок. Два формулювання однієї шкали — два
       різні пояснення через півроку. */
    return '<div class="mt-2">' +
      DL.LEVEL_TEXT.map(function (txt, i) {
        return '<div class="row" style="gap:8px;align-items:center;margin-top:4px">' +
            '<i class="mcal__cell" data-lvl="' + i + '" aria-hidden="true"></i>' +
            '<span class="small muted">' + esc(txt) + '</span>' +
          '</div>';
      }).join('') +
    '</div>';
  }

  function headHtml() {
    const today = todayKey();
    const on = isTrained(today);
    const mon = DC.keyOf(DC.mondayOf(new Date()));
    const week = DL.weekTally(isTrained, mon);
    /* Ціль — кількість днів обраного плану, як і в «Прогресі» та на
       «Сьогодні». Без плану цілі немає, і вигадувати її нема з чого. */
    const target = state.target;

    return '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">Сьогодні</h2>' +
          '<span class="chip mono" title="Тренувань цього тижня' +
            (target ? ' із цілі плану' : '') + '">' +
            week + (target ? '/' + target : '') + ' цього тижня</span>' +
        '</div>' +

        '<p class="small mt-2" style="margin-bottom:0">' +
          (on
            ? 'День уже зарахований: ' + esc(DL.LEVEL_TEXT[DL.dayLevel(state.workLog, state.sessionLog, today)]) + '.'
            : 'День ще не зарахований.') +
        '</p>' +

        '<div class="row mt-2" style="gap:10px;flex-wrap:wrap">' +
          '<button class="btn ' + (on ? 'btn--ghost' : 'btn--primary') + '" type="button" id="tl-mark">' +
            (on ? 'Зняти позначку' : 'Позначити тренування') +
          '</button>' +
          '<a class="btn btn--ghost" href="workout.html">До екрана тренування</a>' +
        '</div>' +

        '<p class="small muted mt-2 mb-0">' +
          'Позначка — для тренувань, яких немає в застосунку: зал без телефона, ' +
          'басейн, довга прогулянка. Якщо підходи записані на «Тренуванні», ' +
          'день зараховується сам.' +
        '</p>' +
      '</div>';
  }

  function render() {
    const host = $('#tl-main');
    if (!host) return;
    host.innerHTML = headHtml() +
      '<div class="mt-3"><h2>Календар</h2>' + calHtml() + legendHtml() +
        '<p class="small muted mt-2 mb-0">Натисніть будь-який день, щоб ' +
        'позначити або зняти його. Глибина заливки — частка закритих підходів, ' +
        'і вона не задається вручну.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Запис                                                               */
  /* ------------------------------------------------------------------ */

  async function persist(patch) {
    try { await Store.saveProfile(patch); }
    catch (e) {
      toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err');
    }
  }

  function toggle(k) {
    const next = DL.toggleTrained(state.workLog, state.sessionLog, k);
    state.workLog = next;
    /* Патч — функція: перемикаємо ОДИН день на актуальному профілі. Весь
       журнал, зчитаний при відкритті сторінки, затер би позначки, зроблені
       тим часом у сусідній вкладці або на телефоні. */
    persist(function (p) {
      return {
        workLog: DL.toggleTrained(
          p && p.workLog, p && p.sessionLog, k)
      };
    });
    render();
  }

  /* ------------------------------------------------------------------ */

  async function init() {
    if (!$('#tl-main')) return;

    let p = {};
    try { p = await Store.getProfile() || {}; } catch (_) {}
    state.workLog = (p.workLog && typeof p.workLog === 'object') ? p.workLog : {};
    state.sessionLog = (p.sessionLog && typeof p.sessionLog === 'object') ? p.sessionLog : {};
    state.target = planDays(p);
    state.ready = true;
    render();

    document.addEventListener('click', function (e) {
      const cell = e.target.closest('[data-hm]');
      if (cell) { toggle(cell.dataset.hm); return; }
      if (e.target.closest('#tl-mark')) {
        const k = todayKey();
        toggle(k);
        toast(isTrained(k) ? 'Позначено' : 'Позначку знято', 'ok');
      }
    });

    Store.onChange(function (profile) {
      if (!profile || !state.ready) return;
      let changed = false;
      if (profile.workLog && profile.workLog !== state.workLog) {
        state.workLog = profile.workLog; changed = true;
      }
      if (profile.sessionLog && profile.sessionLog !== state.sessionLog) {
        state.sessionLog = profile.sessionLog; changed = true;
      }
      const t = planDays(profile);
      if (t !== state.target) { state.target = t; changed = true; }
      if (changed) render();
    });

    if (window.App.onDayChange) window.App.onDayChange(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
