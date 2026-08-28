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
 * Це НЕ другий редактор плану. «Мій план» відповідає на «як налаштована
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

  const { $, esc, toast, fmtNum } = window.App;
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

  /**
   * Робоча вага з рядка вправи.
   *
   * Пише в ті самі два місця, що й «Мій план»: profile.weights (поточне
   * значення — його читають план, періодизація і прогноз) та weightLog
   * через HistoryCore.appendWeight (історія змін). Власної арифметики тут
   * немає — лише передача значення в наявні функції.
   *
   * Порожнє поле стирає вагу: інакше помилково введене число не було б як
   * прибрати, не йдучи на іншу сторінку.
   */
  function saveWeight(name, raw) {
    if (!name) return;
    const txt = String(raw == null ? '' : raw).trim().replace(',', '.');
    const weights = Object.assign({}, state.profile.weights || {});

    if (!txt) {
      if (!(name in weights)) return;
      delete weights[name];
    } else {
      const kg = Number(txt);
      if (!Number.isFinite(kg) || kg < 0 || kg > 500) { toast('Вага — число від 0 до 500', 'err'); return; }
      if (weights[name] === kg) return;   // нічого не змінилось — не смітимо в історію
      weights[name] = kg;
    }

    state.profile.weights = weights;
    const patch = { weights: weights };

    if (txt && window.HistoryCore) {
      const log = window.HistoryCore.appendWeight(state.profile.weightLog, name, Number(txt));
      state.profile.weightLog = log;
      patch.weightLog = log;
    }

    window.App.stampRating(Object.assign({}, state.profile, patch), patch);
    saveOwn(patch).then(function () {
      toast(txt ? 'Вагу збережено' : 'Вагу прибрано', 'ok');
    }, function (e) {
      toast(e && e.queued ? e.message : 'Не збереглося: ' + (e && e.message), e && e.queued ? 'ok' : 'err');
    });
  }

  function saveDayState() {
    WC.writeDay(state.profile, state.todayKey, state.dayIdx, state.done);
    scheduleSessionLog();
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

  /** Середина діапазону повторень: '6–8' → 7, '10' → 10, сміття → 0. */
  function repMid(reps) {
    const m = String(reps || '').match(/(\d+)\s*[–—-]\s*(\d+)/);
    if (m) return (Number(m[1]) + Number(m[2])) / 2;
    const one = String(reps || '').match(/\d+/);
    return one ? Number(one[0]) : 0;
  }

  /**
   * Факти сесії для знімка в історію: підходи, повторення й оцінка
   * тоннажу ЗАКРИТИХ вправ. Вага — з книги ваг на момент тренування;
   * вправи без ваги (планка, прес) чесно дають 0 кг у тоннаж, але
   * рахуються в підходи. Це оцінка за схемою дня, не ваги кожного
   * підходу — тому сторінка прогресу підписує її «≈».
   */
  function sessionFacts(day, done, weights) {
    let sets = 0, reps = 0, vol = 0;
    day.exercises.forEach(function (ex, i) {
      if (!done[i]) return;
      const s = Number(ex.sets) || 0;
      const r = repMid(ex.reps);
      const w = Number(weights && weights[ex.name]);
      sets += s;
      reps += s * r;
      if (Number.isFinite(w) && w > 0) vol += s * r * w;
    });
    return { sets: sets, reps: Math.round(reps), vol: Math.round(vol) };
  }

  function scheduleSessionLog() {
    if (!state.plan || !window.HistoryCore) return;
    const done = WC.doneCount(state.done);
    if (!done) return;   // порожній день — не сесія

    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(function () {
      const day = state.plan[state.dayIdx];
      const a = state.profile.activePlan || {};
      const facts = sessionFacts(day, state.done, state.profile.weights);
      const now = Date.now();
      const log = window.HistoryCore.upsertSession(
        state.profile.sessionLog, state.todayKey, {
          programId: a.programId,
          days: Number(a.days) || 0,
          dayIdx: state.dayIdx,
          title: day.title || ('День ' + (state.dayIdx + 1)),
          done: done,
          total: day.exercises.length,
          t0: now,   // upsertSession лишає найперший t0 — початок сесії
          t1: now,
          sets: facts.sets,
          reps: facts.reps,
          vol: facts.vol
        });
      state.profile.sessionLog = log;
      saveOwn({ sessionLog: log }).catch(function (e) {
        if (!(e && e.queued)) console.warn('[workout] сесія не збереглась:', e.message);
      });
    }, 1500);
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
        '<p class="small muted" style="margin:6px 0 0">Необовʼязково. Позначай, коли хочеться — ' +
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
  function exerciseRow(ex, i) {
    const w = state.profile.weights && state.profile.weights[ex.name];
    const done = Boolean(state.done[i]);
    const sec = WC.restSecFor(ex);

    return '' +
      '<li class="tdy-ex' + (done ? ' is-done' : '') + '">' +
        '<div class="tdy-ex__top">' +
          '<label class="tdy-ex__main">' +
            '<input type="checkbox" data-ex="' + i + '"' + (done ? ' checked' : '') +
              ' aria-label="Виконано: ' + esc(ex.name) + '">' +
            '<span class="tdy-ex__check" aria-hidden="true"></span>' +
            '<span class="tdy-ex__body">' +
              '<span class="tdy-ex__name">' + esc(ex.name) + '</span>' +
              '<span class="tdy-ex__scheme mono">' +
                esc(ex.sets) + '×' + esc(ex.reps) +
                (ex.rir ? ' · RIR ' + esc(ex.rir) : '') +
              '</span>' +
              (ex.note ? '<span class="tdy-ex__note">' + esc(ex.note) + '</span>' : '') +
            '</span>' +
          '</label>' +
          '<button class="tdy-ex__rest btn btn--ghost btn--sm" type="button" ' +
                  'data-rest-sec="' + sec + '" data-rest-name="' + esc(ex.name) + '">' +
            Math.floor(sec / 60) + ' хв' +
          '</button>' +
        '</div>' +
        '<div class="tdy-ex__wt">' +
          '<label class="tdy-ex__wt-lbl" for="wk-w-' + i + '">Робоча вага</label>' +
          '<input class="input input--sm input--weight num mono" id="wk-w-' + i + '" ' +
            'type="text" inputmode="decimal" placeholder="—" ' +
            /* Кома, а не крапка: людина набирає її і бачить її ж по всьому
               Forge. Назад значення читає saveWeight(), яка приймає обидва
               знаки, тож редагування від цього не змінюється. */
            'value="' + esc(w == null ? '' : fmtNum.kg(w)) + '" ' +
            'data-wt="' + esc(ex.name || '') + '" ' +
            'aria-label="Робоча вага, кг: ' + esc(ex.name) + '">' +
          '<span class="tdy-ex__wt-unit">кг</span>' +
        '</div>' +
      '</li>';
  }

  function emptyCard() {
    return '' +
      '<div class="card">' +
        '<h2 style="margin:0">План ще не обрано</h2>' +
        '<p class="small mt-1">Постав кількість днів у залі, подивись схеми — ' +
          'і тут зʼявиться список вправ із твоїми робочими вагами.</p>' +
        '<a class="btn btn--primary mt-1" href="programs.html">Обрати програму</a>' +
      '</div>';
  }

  function workoutCard() {
    const day = state.plan[state.dayIdx];
    const done = WC.doneCount(state.done);
    const total = day.exercises.length;

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

        '<div class="row mt-1" style="justify-content:space-between;align-items:center">' +
          '<span class="small">Виконано <b class="mono" id="wk-done">' + done + '/' + total + '</b></span>' +
          '<a class="small" href="plan.html">Редагувати план</a>' +
        '</div>' +
        '<div class="vol" style="margin-top:6px"><span class="vol__bar">' +
          '<i id="wk-bar" style="width:' + (total ? Math.round(done / total * 100) : 0) + '%"></i>' +
        '</span></div>' +

        '<ul class="tdy-list mt-2">' + day.exercises.map(exerciseRow).join('') + '</ul>' +

        '<p class="small muted mb-0" style="margin-top:14px">' +
          'Кнопка з хвилинами запускає таймер відпочинку. Галочки живуть до ' +
          'кінця дня — це стан тренування, а не журнал.' +
        '</p>' +
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
  }

  /** Оновити лише прогрес — щоб галочка не перемальовувала список під пальцем */
  function refreshProgress() {
    const day = state.plan[state.dayIdx];
    const done = WC.doneCount(state.done);
    const total = day.exercises.length;
    const bar = $('#wk-bar');
    const label = $('#wk-done');
    if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    if (label) label.textContent = done + '/' + total;
    if (total && done === total) toast('Тренування виконано 💪', 'ok');
  }

  /* ------------------------------------------------------------------ */

  async function init() {
    const host = $('#workout');
    if (!host || !WC) return;

    try { state.profile = await window.Store.getProfile() || {}; }
    catch (_) { state.profile = {}; }

    state.todayKey = WC.todayKey();
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
        state.dayIdx = WC.clampDay(Number(day.value), state.plan.length);
        state.done = [];
        saveDayState();
        render();
        return;
      }

      const ex = e.target.closest('input[data-ex]');
      if (ex) {
        const i = Number(ex.dataset.ex);
        state.done[i] = ex.checked;
        ex.closest('.tdy-ex').classList.toggle('is-done', ex.checked);
        saveDayState();
        refreshProgress();
        return;
      }

      const wt = e.target.closest('[data-wt]');
      if (wt) { saveWeight(wt.dataset.wt, wt.value); }
    });

    host.addEventListener('click', function (e) {
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
