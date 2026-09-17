/**
 * Сторінка «Заміри тіла».
 *
 * Дані: profile.measureLog (див. js/measure-core.js). Вага з форми
 * пише в profile.bodyLog — ту саму історію, що веде «Прогрес»:
 * другого журналу ваги не зʼявляється. Сторінка лише читає і пише
 * профіль через Store; уся арифметика — в MeasureCore.
 */
(function () {
  'use strict';

  const { $, esc, toast, dateLabel, fmtNum } = window.App;
  const MC = window.MeasureCore;
  const Store = window.Store;

  const state = {
    log: {},        // profile.measureLog
    bodyLog: {},    // вага тіла — спільна історія
    editing: null,  // 'YYYY-MM-DD' | null — відкрита форма
    editMode: 'new',// 'new' — доповнення дня; 'edit' — заміна запису
    param: null,    // обраний параметр для графіка
    histAll: false,
    busy: false
  };

  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 2 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function keyOf(d) { return window.DateCore.keyOf(d); }
  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 2 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function dateOf(k) { return window.DateCore.dateOf(k); }
  function nowHM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  const n1 = function (v) { return fmtNum.n(v, 1); };

  /* ------------------------------------------------------------------ */
  /* Останній замір                                                      */
  /* ------------------------------------------------------------------ */

  function renderLast() {
    const host = $('#ms-last');
    if (!host) return;

    const ds = MC.dates(state.log);
    const last = ds[0] || null;
    const entry = last ? state.log[last] : null;

    let rows = '';
    if (entry) {
      rows = MC.FIELDS.filter(function (f) { return entry[f.k] != null; })
        .map(function (f) {
          return '<div class="wlog-row">' +
            '<span class="small">' + esc(f.label) + '</span>' +
            '<b class="mono">' + n1(entry[f.k]) + ' ' + (f.unit || 'см') + '</b>' +
          '</div>';
        }).join('');
      const w = Number(state.bodyLog[last]);
      if (Number.isFinite(w)) {
        rows += '<div class="wlog-row"><span class="small">Вага</span>' +
          '<b class="mono">' + fmtNum.kg(w) + ' кг</b></div>';
      }
    }

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">' +
          '<h2 style="margin:0">Останній замір</h2>' +
          (last ? '<span class="small muted">' + esc(dateLabel(dateOf(last))) +
                  (entry.t ? ' · ' + esc(entry.t) : '') + '</span>' : '') +
        '</div>' +
        (entry
          ? '<div class="mt-2">' + rows + '</div>'
          : '<p class="small muted mt-1">Ще жодного заміру. Перший стане точкою відліку для графіків.</p>') +
        '<div class="row mt-2" style="gap:10px;flex-wrap:wrap">' +
          '<button class="btn btn--primary" type="button" id="ms-new">+ Новий замір</button>' +
          (entry ? '<button class="btn btn--ghost" type="button" id="ms-edit-last">Редагувати останній</button>' : '') +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Форма заміру                                                        */
  /* ------------------------------------------------------------------ */

  function fieldRow(f, val) {
    return '<div class="field" style="margin:0">' +
      '<label class="field__label" for="ms-' + f.k + '">' + esc(f.label) + '</label>' +
      '<div class="row" style="gap:8px;align-items:center">' +
        '<input class="input mono" type="text" inputmode="decimal" id="ms-' + f.k + '" ' +
          'data-ms="' + f.k + '" style="width:110px" placeholder="—" ' +
          'value="' + (val != null ? esc(String(val).replace('.', ',')) : '') + '">' +
        '<span class="small muted">' + (f.unit || 'см') + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderForm() {
    const host = $('#ms-form');
    if (!host) return;

    if (!state.editing) { host.innerHTML = ''; return; }

    const k = state.editing;
    /* «Новий замір» — чиста форма: заповнене прикладеться до наявного
       запису дня (доповнення), а не перетре його. «Редагувати» — форма
       з поточними значеннями, і збереження ЗАМІНЮЄ запис. */
    const isNew = state.editMode === 'new';
    const entry = isNew ? {} : (state.log[k] || {});
    const w = isNew ? NaN : Number(state.bodyLog[k]);

    const sections = MC.GROUPS.map(function (g) {
      const inner = MC.fieldsOf(g.id).map(function (f) {
        return fieldRow(f, entry[f.k]);
      });
      /* Вага — в «Загальних показниках», але живе в bodyLog */
      if (g.id === 'general') {
        inner.push(
          '<div class="field" style="margin:0">' +
            '<label class="field__label" for="ms-weight">Вага</label>' +
            '<div class="row" style="gap:8px;align-items:center">' +
              '<input class="input mono" type="text" inputmode="decimal" id="ms-weight" ' +
                'style="width:110px" placeholder="—" ' +
                'value="' + (Number.isFinite(w) ? esc(String(w).replace('.', ',')) : '') + '">' +
              '<span class="small muted">кг</span>' +
            '</div>' +
          '</div>');
      }
      return '<h3 style="margin:18px 0 0">' + esc(g.label) + '</h3>' +
        '<div class="row mt-1" style="gap:14px 22px;flex-wrap:wrap">' + inner.join('') + '</div>';
    }).join('');

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
          '<h2 style="margin:0">' + (isNew ? 'Новий замір' : 'Редагування заміру') + '</h2>' +
          '<div class="row" style="gap:8px;align-items:center">' +
            '<label class="small muted" for="ms-date">Дата</label>' +
            '<input class="input input--sm mono" type="text" id="ms-date" style="width:120px;text-align:center" value="' + esc(k) + '">' +
            '<input class="input input--sm mono" type="text" id="ms-time" style="width:70px;text-align:center" ' +
              'value="' + esc(entry.t || nowHM()) + '" aria-label="Час заміру">' +
          '</div>' +
        '</div>' +
        '<p class="small muted mt-1">Заповнюйте лише виміряне — порожні поля не записуються. Кома чи крапка — байдуже.</p>' +
        sections +
        '<div class="row mt-3" style="gap:10px;flex-wrap:wrap">' +
          '<button class="btn btn--primary" type="button" id="ms-save"' + (state.busy ? ' disabled' : '') + '>Зберегти</button>' +
          '<button class="btn btn--ghost" type="button" id="ms-cancel">Скасувати</button>' +
          (!isNew ? '<button class="btn btn--ghost" type="button" id="ms-del" style="margin-left:auto">Видалити замір</button>' : '') +
        '</div>' +
      '</div>';

    const first = host.querySelector('input[data-ms]');
    if (first) first.focus();
  }

  async function saveForm() {
    if (state.busy) return;

    const dateEl = $('#ms-date');
    const d = String(dateEl && dateEl.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > keyOf(new Date())) {
      toast('Дата у форматі РРРР-ММ-ДД, не з майбутнього', 'err');
      return;
    }

    const raw = {};
    let bad = null;
    document.querySelectorAll('#ms-form input[data-ms]').forEach(function (el) {
      raw[el.dataset.ms] = el.value.trim();
      if (!MC.validValue(el.dataset.ms, el.value.trim())) bad = el.dataset.ms;
    });
    if (bad) {
      const f = MC.BY_KEY[bad];
      toast(f.label + ': від ' + f.min + ' до ' + f.max + ' ' + (f.unit || 'см'), 'err');
      return;
    }

    const timeEl = $('#ms-time');
    const entry = MC.buildEntry(raw, timeEl ? timeEl.value.trim() : '');

    const wEl = $('#ms-weight');
    const wRaw = wEl ? wEl.value.trim() : '';
    let weight = null;
    if (wRaw !== '') {
      weight = Number(wRaw.replace(',', '.'));
      if (!Number.isFinite(weight) || weight < 30 || weight > 300) {
        toast('Вага: від 30 до 300 кг', 'err');
        return;
      }
      weight = Math.round(weight * 10) / 10;
    }

    if (!entry && weight === null) {
      toast('Порожній замір — нема чого зберігати', 'err');
      return;
    }

    state.busy = true;

    const nextLog = Object.assign({}, state.log);
    if (state.editMode === 'edit') {
      // Дату могли виправити — запис їде на нову дату, стара звільняється
      if (state.editing !== d && nextLog[state.editing]) delete nextLog[state.editing];
      if (entry) nextLog[d] = entry;
      else if (nextLog[d]) delete nextLog[d];
    } else if (entry) {
      // Новий замір: якщо на цю дату вже щось є — доповнюємо, не стираючи
      nextLog[d] = Object.assign({}, nextLog[d] || {}, entry);
    }

    if (weight !== null) {
      state.bodyLog = Object.assign({}, state.bodyLog);
      state.bodyLog[d] = weight;
    }

    /*
     * ЖУРНАЛ ПЕРЕДАЄТЬСЯ ФУНКЦІЄЮ (SYN-011).
     *
     * Патч — це ПОВНЕ значення поля. Якщо надіслати measureLog, зчитаний
     * при відкритті сторінки, то замір, зроблений тим часом з іншого
     * пристрою, зникне разом із усім журналом — не за день, а цілком.
     * Функція виконується вже на свіжому профілі, тож правка лягає
     * ТОЧКОВО: міняється лише той день, який людина щойно редагувала.
     */
    const editing = state.editing;
    const mode = state.editMode;
    try {
      await Store.saveProfile(function (pr) {
        const log = Object.assign({}, (pr && pr.measureLog) || {});
        if (mode === 'edit') {
          if (editing !== d && log[editing]) delete log[editing];
          if (entry) log[d] = entry;
          else if (log[d]) delete log[d];
        } else if (entry) {
          log[d] = Object.assign({}, log[d] || {}, entry);
        }
        const out = { measureLog: log };
        if (weight !== null) {
          out.bodyLog = Object.assign({}, (pr && pr.bodyLog) || {});
          out.bodyLog[d] = weight;
        }
        return out;
      });
      toast('Замір збережено', 'ok');
    } catch (e) {
      toast(e && e.queued ? e.message : 'Не збереглося: ' + (e && e.message), e && e.queued ? 'ok' : 'err');
    }

    state.log = nextLog;
    state.editing = null;
    state.busy = false;
    renderAll();
  }

  async function deleteEntry(k) {
    if (!state.log[k]) return;
    if (!window.confirm('Видалити замір за ' + k + '? Відновити його буде нічим.')) return;
    const nextLog = Object.assign({}, state.log);
    delete nextLog[k];
    try {
      /* Функцією, а не обʼєктом: видалення одного дня не має відкочувати
         весь журнал до стану на момент відкриття сторінки (SYN-011). */
      await Store.saveProfile(function (pr) {
        const log = Object.assign({}, (pr && pr.measureLog) || {});
        delete log[k];
        return { measureLog: log };
      });
      toast('Замір видалено', 'ok');
    } catch (e) {
      toast(e && e.queued ? e.message : 'Не збереглося: ' + (e && e.message), e && e.queued ? 'ok' : 'err');
    }
    state.log = nextLog;
    if (state.editing === k) state.editing = null;
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* Прогрес параметра                                                   */
  /* ------------------------------------------------------------------ */

  function chartSvg(s, unit) {
    const H = window.HistoryCore;
    const path = H.sparklinePath(
      s.map(function (e) { return { d: e.d, kg: e.v }; }), 600, 140, 8);
    if (!path) return '';
    return '<svg viewBox="0 0 600 140" role="img" aria-label="Графік параметра, ' + esc(unit) + '">' +
      '<path d="' + path + '" fill="none" stroke="var(--acc-bar)" stroke-width="2.5"/>' +
    '</svg>';
  }

  function renderProgress() {
    const host = $('#ms-progress');
    if (!host) return;

    const keys = MC.measuredKeys(state.log);
    if (!keys.length) { host.innerHTML = ''; return; }

    if (!state.param || keys.indexOf(state.param) === -1) state.param = keys[0];
    const st = MC.stats(state.log, state.param);
    const sign = function (v) { return (v > 0 ? '+' : '') + n1(v); };

    const options = keys.map(function (k) {
      return '<option value="' + k + '"' + (k === state.param ? ' selected' : '') + '>' +
        esc(MC.BY_KEY[k].label) + '</option>';
    }).join('');

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
          '<h2 style="margin:0">Прогрес</h2>' +
          '<select class="select select--sm" id="ms-param" style="max-width:220px" aria-label="Параметр">' + options + '</select>' +
        '</div>' +
        (st.series.length >= 2
          ? '<div class="wchart mt-2">' + chartSvg(st.series, st.unit) + '</div>'
          : '<p class="small muted mt-2">Другий замір — і зʼявиться графік.</p>') +
        '<div class="row mt-2" style="gap:16px;flex-wrap:wrap">' +
          '<span class="small">Зараз: <b class="mono">' + n1(st.current) + ' ' + st.unit + '</b></span>' +
          (st.prev !== null
            ? '<span class="small">Попередній: <b class="mono">' + n1(st.prev) + '</b> (' + sign(st.delta) + ')</span>'
            : '') +
          (st.fromFirst !== null
            ? '<span class="small">Від першого: <b class="mono">' + sign(st.fromFirst) + ' ' + st.unit + '</b>' +
              (st.fromFirstPct !== null ? ' (' + sign(st.fromFirstPct) + '%)' : '') + '</span>'
            : '') +
          '<span class="small muted">' + st.count + ' ' + window.App.plural(st.count, 'замір', 'заміри', 'замірів') + '</span>' +
        '</div>' +
        /* Знак зміни навмисно не фарбується «добре/погано»: для талії
           і біцепса плюс означає протилежне — вирішує людина. */
        '<p class="small muted mt-1 mb-0">Значення: ' +
          st.series.map(function (e) { return n1(e.v); }).join(' → ') + ' ' + st.unit + '.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Історія                                                             */
  /* ------------------------------------------------------------------ */

  const HIST_SHOWN = 8;

  function renderHistory() {
    const host = $('#ms-history');
    if (!host) return;

    const ds = MC.dates(state.log);
    if (!ds.length) { host.innerHTML = ''; return; }

    const shown = state.histAll ? ds : ds.slice(0, HIST_SHOWN);

    const rows = shown.map(function (k) {
      const e = state.log[k];
      const filled = MC.FIELDS.filter(function (f) { return e[f.k] != null; }).length;
      return '<div class="wlog-row">' +
        '<span class="small">' + esc(dateLabel(dateOf(k))) + (e.t ? ' <span class="muted">' + esc(e.t) + '</span>' : '') + '</span>' +
        '<span class="small muted">' + filled + ' ' + window.App.plural(filled, 'параметр', 'параметри', 'параметрів') + '</span>' +
        '<span class="row" style="gap:6px">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-ms-edit="' + esc(k) + '">Редагувати</button>' +
          '<button class="icon-btn icon-btn--danger" type="button" data-ms-del="' + esc(k) + '" aria-label="Видалити замір за ' + esc(k) + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</span>' +
      '</div>';
    }).join('');

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Історія</h2>' +
          '<span class="small muted">' + ds.length + ' ' + window.App.plural(ds.length, 'замір', 'заміри', 'замірів') + '</span>' +
        '</div>' +
        '<div class="mt-2">' + rows + '</div>' +
        (ds.length > HIST_SHOWN && !state.histAll
          ? '<button class="btn btn--ghost btn--sm mt-1" type="button" id="ms-hist-more">Показати всі</button>'
          : '') +
      '</div>';
  }

  /* ------------------------------------------------------------------ */

  function renderAll() {
    renderLast();
    renderForm();
    renderProgress();
    renderHistory();
  }

  async function init() {
    if (!$('#ms-last') || !MC) return;

    let p = {};
    try { p = await Store.getProfile() || {}; } catch (_) {}
    state.log = (p.measureLog && typeof p.measureLog === 'object' && !Array.isArray(p.measureLog)) ? p.measureLog : {};
    state.bodyLog = (p.bodyLog && typeof p.bodyLog === 'object') ? p.bodyLog : {};

    renderAll();

    document.addEventListener('click', function (e) {
      if (e.target.closest('#ms-new')) {
        state.editing = keyOf(new Date());
        state.editMode = 'new';
        renderForm();
        $('#ms-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('#ms-edit-last')) {
        state.editing = MC.dates(state.log)[0];
        state.editMode = 'edit';
        renderForm();
        $('#ms-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('#ms-save')) { saveForm(); return; }
      if (e.target.closest('#ms-cancel')) { state.editing = null; renderForm(); return; }
      if (e.target.closest('#ms-del')) { deleteEntry(state.editing); return; }
      const ed = e.target.closest('[data-ms-edit]');
      if (ed) {
        state.editing = ed.dataset.msEdit;
        state.editMode = 'edit';
        renderForm();
        $('#ms-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const del = e.target.closest('[data-ms-del]');
      if (del) { deleteEntry(del.dataset.msDel); return; }
      if (e.target.closest('#ms-hist-more')) { state.histAll = true; renderHistory(); }
    });

    document.addEventListener('change', function (e) {
      if (e.target.closest('#ms-param')) {
        state.param = e.target.value;
        renderProgress();
      }
    });

    Store.onChange(function (profile) {
      if (!profile) return;
      if (profile.measureLog && profile.measureLog !== state.log && !state.editing) {
        state.log = profile.measureLog;
        renderAll();
      }
      if (profile.bodyLog && profile.bodyLog !== state.bodyLog) state.bodyLog = profile.bodyLog;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
