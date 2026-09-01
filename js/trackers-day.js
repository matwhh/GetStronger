/**
 * Трекери дня — окрема сторінка (trackers.html).
 *
 * Раніше цей блок жив на «Сьогодні» й робив головну довгим списком шкал
 * 1..10, а плитка «Трекери» вела на НАЛАШТУВАННЯ трекерів — тобто не
 * туди, куди очікуєш, тицяючи в «Трекери». Тепер:
 *
 *   trackers.html          ← ЦЯ сторінка: ввести сьогоднішні значення
 *   trackers-settings.html ← що ввімкнено, цілі, добавки/звички, історія
 *
 * Плитка на «Сьогодні» веде сюди; «Налаштування» — праворуч угорі тут.
 *
 * Лише УВІМКНЕНІ трекери, і лише як один компактний рядок кожен: назва,
 * сьогоднішнє значення, мінімальний швидкий ввід.
 *
 * workoutMood сюди не потрапляє: він привʼязаний до сьогоднішнього
 * тренування, а не до дня загалом, тому живе на сторінці тренування.
 */
(function () {
  'use strict';

  const $ = function (s, r) { return (r || document).querySelector(s); };
  const esc = function (s) { return window.App.esc(s); };
  const toast = function (m, k) { return window.App.toast(m, k); };

  const state = {
    profile: {},
    trackers: {},
    trackerLog: {},
    todayKey: ''
  };

  /* Власні збереження повертаються через Store.onChange; перемальовувати
     ту саму сторінку з тих самих даних, поки людина набирає, — зайве. */
  const SELF_WRITE_MS = 1200;
  let lastSelfWrite = 0;

  function saveOwn(patch) {
    lastSelfWrite = Date.now();
    return window.Store.saveProfile(patch);
  }

  function readState() {
    const TC = window.TrackerCore;
    state.trackers = TC.ensureBuiltins(state.profile.trackers);
    state.trackerLog = (state.profile.trackerLog && typeof state.profile.trackerLog === 'object')
      ? state.profile.trackerLog : {};
  }

  /*
   * Дві (чи більше) шкали 1..10 в одному трекері — біль/втома. Настрій
   * до/після тренування теж pair, але він живе на сторінці тренування:
   * там у нього є контекст сесії, до якої він і привʼязаний.
   */
  const PAIR_LABELS = { pain: 'Біль', fatigue: 'Втома' };

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

  function trackerRow(t, def) {
    const todayRaw = (state.trackerLog[t.id] || {})[state.todayKey];
    // duration/value можуть прийти як {value, source, date} (напр. дані з Apple
    // Health у майбутньому) — entryValue() прозоро розпаковує обидві форми,
    // не чіпаючи інші види трекерів (вони й досі пишуться голими числами).
    const today = (def.kind === 'duration' || def.kind === 'value')
      ? (window.TrackerCore ? window.TrackerCore.entryValue(todayRaw) : todayRaw)
      : todayRaw;

    let val, action;
    if (def.kind === 'cumulative') {
      val = (today || 0) + (t.goal ? ' / ' + t.goal : '') + ' ' + def.unit;
      action = def.presets.map(function (p) {
        return '<button class="btn btn--ghost btn--sm" type="button" data-trk-add="' + esc(t.id) + '" data-amount="' + p + '">+' + p + '</button>';
      }).join('');
    } else if (def.kind === 'duration') {
      val = today != null ? window.TrackerCore.formatDuration(today) : '—';
      /* Два поля замість сітки готових кнопок: сон буває 6:47, і
         округлення до найближчої кнопки псувало саме те число, заради
         якого трекер вмикають. Порожні поля = стерти запис. */
      const sp = window.TrackerCore.splitDuration(today);
      action = '<div class="qi-dur">' +
        '<input class="input input--sm num mono" type="text" inputmode="numeric" ' +
          'data-trk-durh="' + esc(t.id) + '" placeholder="—" ' +
          'value="' + (sp.h == null ? '' : sp.h) + '" ' +
          'aria-label="' + esc(t.name) + ', годин">' +
        '<span class="qi-dur__u">год</span>' +
        '<input class="input input--sm num mono" type="text" inputmode="numeric" ' +
          'data-trk-durm="' + esc(t.id) + '" placeholder="—" ' +
          'value="' + (sp.m == null ? '' : sp.m) + '" ' +
          'aria-label="' + esc(t.name) + ', хвилин">' +
        '<span class="qi-dur__u">хв</span>' +
      '</div>';
    } else if (def.kind === 'value') {
      val = today != null ? String(today) : '—';
      action = '<input class="input input--sm mono" type="text" inputmode="decimal" data-trk-value="' + esc(t.id) + '" ' +
        'aria-label="' + esc(t.name) + (def.unit ? ', ' + esc(def.unit) : '') + '" ' +
        'style="width:90px" min="' + def.min + '" max="' + def.max + '" value="' + (today != null ? esc(today) : '') + '" placeholder="0">';
    } else if (def.kind === 'pair') {
      const cur = today || {};
      val = def.fields.map(function (f) { return cur[f] != null ? cur[f] : '—'; }).join(' / ');
      action = pairPicker(t.id, def, cur);
    } else { // scale
      val = today != null ? today + '/10' : '—';
      action = '<div class="qi-scale" role="group" aria-label="' + esc(t.name) + ', оцінка від 1 до 10">' +
        Array.from({ length: def.max - def.min + 1 }, function (_, i) { return def.min + i; }).map(function (n) {
          return '<button class="qi-scale__btn' + (today === n ? ' is-on' : '') + '" type="button" ' +
            'aria-pressed="' + (today === n) + '" ' +
            'data-trk-scale="' + esc(t.id) + '" data-val="' + n + '">' + n + '</button>';
        }).join('') + '</div>';
    }

    return '<div class="tdy-trk__row">' +
      '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
        '<span class="tdy-trk__name">' + esc(t.name) + '</span>' +
        '<span class="small muted mono">' + esc(val) + '</span>' +
      '</div>' +
      '<div class="mt-1">' + action + '</div>' +
    '</div>';
  }

  function customChecklist(type, title) {
    const items = window.TrackerCore.byType(state.trackers, type).filter(function (t) { return t.enabled; });
    if (!items.length) return '';
    const TC = window.TrackerCore;
    const rows = items.map(function (t) {
      const raw = (state.trackerLog[t.id] || {})[state.todayKey];
      const done = TC.taken(raw);
      /* Добавка з дозою: галочка пише типову дозу, а поле поруч дає
         вписати скільки реально випив — 3, 5, 7,5 г. Порожнє поле = не
         приймав. Простий чекбокс лишається для добавок без дози. */
      const dosed = TC.isDosed(t);
      const grams = dosed ? (TC.gramsOf(raw) != null ? TC.gramsOf(raw) : '') : null;
      return '<li class="tr-custom-row">' +
        '<label class="tdy-ex__main" style="flex:1;padding:9px 0">' +
          '<input type="checkbox" data-trk-mark="' + esc(t.id) + '"' + (done ? ' checked' : '') + '>' +
          '<span class="tdy-ex__check" aria-hidden="true"></span>' +
          '<span class="tr-custom-row__name">' + esc(t.name) + '</span>' +
        '</label>' +
        (dosed
          ? '<span class="qi-dose">' +
              '<input class="input input--sm num mono" type="text" inputmode="decimal" ' +
                'data-trk-dose="' + esc(t.id) + '" placeholder="' + esc(String(TC.doseOf(t))) + '" ' +
                'value="' + esc(grams === '' ? '' : String(grams)) + '" ' +
                'aria-label="' + esc(t.name) + ', грамів">' +
              '<span class="qi-dose__u">г</span>' +
            '</span>'
          : '') +
      '</li>';
    }).join('');
    return '<p class="small muted mt-2" style="margin-bottom:2px">' + esc(title) + '</p>' +
      '<ul class="tr-custom-list">' + rows + '</ul>';
  }

  function pageHtml() {
    const TC = window.TrackerCore;
    const active = TC.active(state.trackers).filter(function (t) {
      return TC.TRACKER_DEFS[t.type] && t.type !== 'workoutMood';
    });
    const supplements = customChecklist('supplement', 'Добавки');
    const habits = customChecklist('habit', 'Звички');

    if (!active.length && !supplements && !habits) {
      return '' +
        '<div class="card">' +
          '<p class="small mt-0">Жодного трекера не ввімкнено. Увімкніть те, що хочете ' +
            'бачити щодня, — і воно зʼявиться тут одним рядком.</p>' +
          '<a class="btn btn--primary btn--sm mt-1" href="trackers-settings.html">Увімкнути трекери</a>' +
        '</div>';
    }

    return '' +
      '<div class="card">' +
        active.map(function (t) { return trackerRow(t, TC.defFor(t)); }).join('') +
        supplements + habits +
      '</div>';
  }

  function render() {
    const host = $('#trk-day');
    if (!host) return;
    host.innerHTML = pageHtml();
  }

  /* ------------------------------------------------------------------ */
  /* Події                                                               */
  /* ------------------------------------------------------------------ */

  function wire() {
    $('#trk-day').addEventListener('change', function (e) {
      const TC = window.TrackerCore;
      if (!TC) return;

      /* Тривалість: два поля, одна величина. Читаємо ОБИДВА, бо зміна
         годин без хвилин не має скидати хвилини — і навпаки. */
      const dh = e.target.closest('[data-trk-durh]');
      const dm = e.target.closest('[data-trk-durm]');
      if (dh || dm) {
        const id = (dh || dm).dataset.trkDurh || (dh || dm).dataset.trkDurm;
        const box = (dh || dm).closest('.qi-dur');
        const hEl = box && box.querySelector('[data-trk-durh]');
        const mEl = box && box.querySelector('[data-trk-durm]');
        const hv = hEl && hEl.value;
        const mv = mEl && mEl.value;
        /*
         * УСЕ — наступним тактом. change у текстовому полі приходить
         * усередині зміни фокуса, а saveTrackerLog перемальовує картку:
         * заміна innerHTML прямо тут валить DOM-помилкою.
         */
        setTimeout(function () {
          const trk = TC.list(state.trackers).find(function (x) { return x.id === id; });
          const def = trk ? TC.defFor(trk) : null;
          const mins = TC.joinDuration(hv, mv, def || { min: 0, max: 1440 });
          if (mins === false) {
            toast('Не схоже на час: перевірте години й хвилини', 'err');
            render();
            return;
          }
          saveTrackerLog(mins === null
            ? TC.removeEntry(state.trackerLog, id, state.todayKey)
            : TC.logValue(state.trackers, state.trackerLog, id, mins, state.todayKey));
        }, 0);
        return;
      }

      const val = e.target.closest('[data-trk-value]');
      if (val) {
        // Порожнє поле прибирає запис дня, а не пише нуль: Number('') === 0
        // проходив Number.isFinite, і просто очистивши поле людина
        // отримувала фантомний нульовий день (див. trackers-settings.js).
        const raw = String(val.value || '').trim();
        if (!raw) {
          saveTrackerLog(TC.removeEntry(state.trackerLog, val.dataset.trkValue, state.todayKey));
          return;
        }
        const n = Number(raw.replace(',', '.'));
        if (Number.isFinite(n)) saveTrackerLog(TC.logValue(state.trackers, state.trackerLog, val.dataset.trkValue, n, state.todayKey));
        return;
      }

      /* Грами добавки. Порожнє поле = не приймав; сміття або поза межами
         (0,1..500 г) — поле повертається до записаного, з підказкою. */
      const dose = e.target.closest('[data-trk-dose]');
      if (dose) {
        const id = dose.dataset.trkDose;
        const raw = String(dose.value || '').trim();
        if (raw !== '' && TC.normDose(raw) === null) {
          toast('Доза: від 0,1 до 500 г', 'err');
          setTimeout(render, 0);
          return;
        }
        setTimeout(function () {
          saveTrackerLog(raw === ''
            ? TC.removeEntry(state.trackerLog, id, state.todayKey)
            : TC.logValue(state.trackers, state.trackerLog, id, raw, state.todayKey));
        }, 0);
        return;
      }

      const mark = e.target.closest('[data-trk-mark]');
      if (mark) saveTrackerLog(TC.logValue(state.trackers, state.trackerLog, mark.dataset.trkMark, mark.checked, state.todayKey));
    });

    $('#trk-day').addEventListener('click', function (e) {
      const TC = window.TrackerCore;
      if (!TC) return;

      const add = e.target.closest('[data-trk-add]');
      if (add) { saveTrackerLog(TC.addDelta(state.trackers, state.trackerLog, add.dataset.trkAdd, Number(add.dataset.amount), state.todayKey)); return; }

      const sc = e.target.closest('[data-trk-scale]');
      if (sc) { saveTrackerLog(TC.logValue(state.trackers, state.trackerLog, sc.dataset.trkScale, Number(sc.dataset.val), state.todayKey)); return; }

      const pr = e.target.closest('[data-trk-pair]');
      if (pr) {
        const patch = {}; patch[pr.dataset.field] = Number(pr.dataset.val);
        saveTrackerLog(TC.logValue(state.trackers, state.trackerLog, pr.dataset.trkPair, patch, state.todayKey));
      }
    });
  }

  /** Записати зміну трекера дня й одразу оновити сторінку */
  function saveTrackerLog(next) {
    state.trackerLog = next;
    render();
    saveOwn({ trackerLog: next }).catch(function (e) {
      if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Старт                                                               */
  /* ------------------------------------------------------------------ */

  async function init() {
    if (!$('#trk-day') || !window.TrackerCore) return;
    state.todayKey = window.TrackerCore.todayKey();

    try { state.profile = await window.Store.getProfile() || {}; }
    catch (_) { state.profile = {}; }
    readState();
    render();
    wire();

    /*
     * Сторож вводу — той самий, що на «Сьогодні»: наш власний onChange
     * не має зносити поле, у якому людина зараз набирає (сон, кроки).
     */
    const FIELD_GRACE_MS = 500;
    let lastFieldTouch = 0;
    let pendingRender = false;

    function fieldFocused(el) {
      return Boolean(el && el.closest && el.closest('#trk-day input, #trk-day select'));
    }
    function fieldBusy() {
      if (fieldFocused(document.activeElement)) return true;
      return (Date.now() - lastFieldTouch) < FIELD_GRACE_MS;
    }
    ['focusin', 'focusout', 'input'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (fieldFocused(e.target)) lastFieldTouch = Date.now();
      });
    });

    window.Store.onChange(async function () {
      try { state.profile = await window.Store.getProfile() || {}; } catch (_) { return; }
      readState();
      if (fieldBusy() || (Date.now() - lastSelfWrite) < SELF_WRITE_MS) {
        pendingRender = true;
        return;
      }
      render();
    });

    $('#trk-day').addEventListener('focusout', function () {
      if (!pendingRender) return;
      setTimeout(function () {
        if (fieldFocused(document.activeElement)) return;
        pendingRender = false;
        render();
      }, 120);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
