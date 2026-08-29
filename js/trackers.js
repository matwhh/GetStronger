/**
 * «Мої трекери» — одна модульна сторінка на всі типи трекерів.
 *
 * Дані й правила клампу — в js/tracker-core.js (чисті функції). Цей файл
 * лише читає профіль, малює список і передає натискання назад у ядро.
 * Жодна логіка трекера тут не унікальна: новий тип у TRACKER_DEFS
 * зʼявиться в списку сам, без правок цього файлу — крім, за потреби,
 * власного вигляду швидкого вводу (trackerWidget нижче).
 */
(function () {
  'use strict';

  const { $, esc, toast, dateLabel, plural, fmtNum } = window.App;
  const Store = window.Store;
  const T = window.TrackerCore;

  const state = {
    trackers: {},
    log: {},
    openId: null,
    wired: false
  };

  function todayKey() { return T.todayKey(); }
  function dateOf(key) {
    const p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  /* ------------------------------------------------------------------ */
  /* Формат значень                                                       */
  /* ------------------------------------------------------------------ */

  /* Власного форматера тут більше немає: числа Forge показує однаково
     скрізь, і правило живе в App.fmtNum (js/app.js). Локальна копія
     давала «7.5 год» там, де сусідня картка показувала «7,5». */
  function fmtValue(def, v) {
    if (v === true) return '✓';
    if (def.kind === 'duration') return T.formatDuration(v);
    if (def.kind === 'cumulative' || def.kind === 'value' || def.kind === 'scale') {
      return fmtNum.n(v, 1) + (def.unit ? ' ' + def.unit : '');
    }
    return String(v);
  }

  function fmtPair(def, v) {
    if (!v || typeof v !== 'object') return '—';
    return def.fields.map(function (f) {
      const label = f === 'pain' ? 'біль' : f === 'fatigue' ? 'втома'
        : f === 'before' ? 'до' : f === 'after' ? 'після' : f;
      return label + ' ' + (v[f] != null ? v[f] : '—');
    }).join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* Рядок одного трекера: заголовок + деталі за бажанням                 */
  /* ------------------------------------------------------------------ */

  function metaLine(t, def) {
    const todayRaw = (state.log[t.id] || {})[todayKey()];
    // duration/value можуть зберігатися як {value, source, date} (джерело —
    // ручний ввід або, у майбутньому, Apple Health) — entryValue() читає
    // обидві форми прозоро; інші види kind і далі пишуться голими значеннями.
    const today = (def.kind === 'duration' || def.kind === 'value') ? T.entryValue(todayRaw) : todayRaw;

    if (def.kind === 'boolean') {
      const st = T.boolSummary(state.log, t.id, 30, t.createdAt);
      const streakTxt = st.streak > 0 ? st.streak + ' ' + plural(st.streak, 'день', 'дні', 'днів') + ' поспіль' : 'ще без позначок';
      return today === true ? 'Сьогодні: зроблено · ' + streakTxt : streakTxt;
    }

    if (def.kind === 'pair') {
      if (today) return 'Сьогодні: ' + fmtPair(def, today);
      const s1 = T.pairSummary(state.log, t.id, def.fields[0], 30);
      return s1 ? 'Середнє за 30д: ' + fmtNum.n(s1.avg, 1) : 'ще без записів';
    }

    if (today != null) {
      const goalTxt = t.goal ? ' / ' + fmtNum.n(t.goal, 1) + (def.kind === 'duration' ? '' : ' ' + def.unit) : '';
      return def.kind === 'duration'
        ? 'Сьогодні: ' + T.formatDuration(today) + (t.goal ? ' (ціль ' + T.formatDuration(t.goal) + ')' : '')
        : 'Сьогодні: ' + fmtValue(def, today) + goalTxt;
    }
    const s = T.numericSummary(state.log, t.id, 30);
    if (!s) return 'ще без записів';
    const arrow = s.trend === 'up' ? '↑' : s.trend === 'down' ? '↓' : s.trend === 'flat' ? '→' : '';
    return 'Середнє за 30д: ' + fmtValue(def, s.avg) + (arrow ? ' ' + arrow : '');
  }

  /** Швидкий ввід усередині розгорнутого рядка — по kind трекера. */
  function widget(t, def) {
    const todayRaw = (state.log[t.id] || {})[todayKey()];
    const today = (def.kind === 'duration' || def.kind === 'value') ? T.entryValue(todayRaw) : todayRaw;

    if (def.kind === 'cumulative') {
      const pct = t.goal ? Math.min(100, Math.round((Number(today) || 0) / t.goal * 100)) : null;
      return '' +
        (t.goal
          ? '<div class="qi-bar">' +
              '<span class="qi-bar__track"><i style="width:' + pct + '%"></i></span>' +
              '<span class="qi-bar__num mono small">' + fmtNum.n(today || 0, 1) + ' / ' + fmtNum.n(t.goal, 1) + ' ' + esc(def.unit) + '</span>' +
            '</div>'
          : '') +
        '<div class="qi-row">' +
          def.presets.map(function (p) {
            return '<button class="btn btn--ghost btn--sm" type="button" data-add="' + esc(t.id) + '" data-amount="' + p + '">+' + fmtNum.n(p, 1) + ' ' + esc(def.unit) + '</button>';
          }).join('') +
          '<button class="btn btn--ghost btn--sm" type="button" data-add="' + esc(t.id) + '" data-amount="' + (-def.presets[0]) + '">−' + fmtNum.n(def.presets[0], 1) + '</button>' +
        '</div>';
    }

    if (def.kind === 'duration') {
      return '<div class="qi-row">' +
        def.presets.map(function (m) {
          const on = today === m;
          return '<button class="btn btn--sm ' + (on ? 'btn--primary' : 'btn--ghost') + '" type="button" ' +
            'data-duration="' + esc(t.id) + '" data-min="' + m + '">' + T.formatDuration(m) + '</button>';
        }).join('') +
      '</div>';
    }

    if (def.kind === 'value') {
      return '<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">' +
        '<input class="input mono" type="text" inputmode="decimal" id="val-' + esc(t.id) + '" style="width:120px" ' +
          'value="' + (today != null ? esc(today) : '') + '" placeholder="0">' +
        '<button class="btn btn--primary btn--sm" type="button" data-save-value="' + esc(t.id) + '">Зберегти</button>' +
      '</div>';
    }

    if (def.kind === 'scale') {
      return '<div class="qi-scale" role="group" aria-label="Оцінка від 1 до 10">' +
        Array.from({ length: def.max - def.min + 1 }, function (_, i) { return def.min + i; }).map(function (n) {
          return '<button class="qi-scale__btn' + (today === n ? ' is-on' : '') + '" type="button" ' +
            'aria-pressed="' + (today === n) + '" ' +
            'data-scale="' + esc(t.id) + '" data-val="' + n + '">' + n + '</button>';
        }).join('') +
      '</div>';
    }

    if (def.kind === 'pair') {
      return def.fields.map(function (f) {
        const label = f === 'pain' ? 'Біль' : f === 'fatigue' ? 'Втома' : f === 'before' ? 'Перед тренуванням' : 'Після тренування';
        const v = today && today[f];
        return '<p class="small mt-1" style="margin-bottom:4px">' + esc(label) + '</p>' +
          '<div class="qi-scale" role="group" aria-label="' + esc(label) + ', від 1 до 10">' +
            Array.from({ length: def.max - def.min + 1 }, function (_, i) { return def.min + i; }).map(function (n) {
              return '<button class="qi-scale__btn' + (v === n ? ' is-on' : '') + '" type="button" ' +
                'aria-pressed="' + (v === n) + '" ' +
                'data-pair="' + esc(t.id) + '" data-field="' + f + '" data-val="' + n + '">' + n + '</button>';
            }).join('') +
          '</div>';
      }).join('');
    }

    return '';
  }

  function historyBlock(t, def) {
    const entries = T.lastEntries(state.log, t.id, 7);
    if (!entries.length) return '<p class="small muted mt-2 mb-0">Історія почнеться з першого запису.</p>';
    return '<div class="mt-2">' +
      entries.map(function (e) {
        // duration/value з hasSource можуть прийти як {value, source, date} —
        // entryValue()/entrySource() розпаковують обидві форми (стару й нову).
        const v = (def.kind === 'duration' || def.kind === 'value') ? T.entryValue(e.v) : e.v;
        const txt = def.kind === 'pair' ? fmtPair(def, v)
          : def.kind === 'boolean' ? '✓'
          : def.kind === 'duration' ? T.formatDuration(v)
          : fmtValue(def, v);
        // Позначку джерела показуємо лише тут, в історії — щоб не перевантажувати
        // компактний рядок на today.html — і лише коли запис прийшов не вручну.
        const src = def.hasSource ? T.entrySource(e.v) : 'manual';
        const srcTag = src && src !== 'manual' ? ' <span class="muted small">· ' + esc(srcLabel(src)) + '</span>' : '';
        return '<div class="wlog-row">' +
          '<span class="muted small">' + esc(dateLabel(dateOf(e.d))) + '</span>' +
          '<span class="mono">' + esc(txt) + srcTag + '</span>' +
          '<button class="icon-btn icon-btn--danger" type="button" data-entry-del="' + esc(t.id) + ':' + e.d + '" ' +
                  'aria-label="Видалити запис за ' + esc(dateLabel(dateOf(e.d))) + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function srcLabel(src) {
    if (src === 'apple_health') return 'Apple Health';
    return src;
  }

  function sourceRow(t, def) {
    if (!def.hasSource) return '';
    return '<div class="row mt-2" style="gap:8px;align-items:center;flex-wrap:wrap">' +
      '<span class="small muted">Джерело:</span>' +
      '<span class="seg">' +
        '<label class="seg__item"><input type="radio" name="src-' + esc(t.id) + '" checked><span>Вручну</span></label>' +
        '<label class="seg__item" title="Зʼявиться в мобільному застосунку — веб не має доступу до Apple Health">' +
          '<input type="radio" name="src-' + esc(t.id) + '" disabled><span>Apple Health</span></label>' +
      '</span>' +
    '</div>';
  }

  function goalRow(t, def) {
    if (def.defaultGoal == null) return '';
    return '<div class="row mt-2" style="gap:8px;align-items:center;flex-wrap:wrap">' +
      '<label class="small muted" for="goal-' + esc(t.id) + '">Денна ціль</label>' +
      '<input class="input input--sm mono" type="text" inputmode="decimal" id="goal-' + esc(t.id) + '" style="width:100px" ' +
        'min="0" step="' + (def.kind === 'duration' ? '15' : def.unit === 'л' ? '0.1' : '1') + '" ' +
        'value="' + (t.goal != null ? esc(def.kind === 'duration' ? Math.round(t.goal / 60 * 10) / 10 : t.goal) : '') + '">' +
      (def.kind === 'duration' ? '<span class="small muted">год</span>' : '') +
      '<button class="btn btn--ghost btn--sm" type="button" data-goal-save="' + esc(t.id) + '">Зберегти</button>' +
    '</div>';
  }

  function builtinRow(t) {
    const def = T.defFor(t);
    if (!def) return '';
    const open = state.openId === t.id;

    return '<li class="tr-row' + (t.enabled ? '' : ' tr-row--off') + '">' +
      '<div class="tr-row__top">' +
        '<label class="switch" aria-label="Увімкнути: ' + esc(t.name) + '">' +
          '<input type="checkbox" data-toggle="' + esc(t.id) + '"' + (t.enabled ? ' checked' : '') + '>' +
          '<span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>' +
        '</label>' +
        '<button class="tr-row__btn" type="button" data-expand="' + esc(t.id) + '" aria-expanded="' + open + '">' +
          '<span class="tr-row__name">' + esc(t.name) + '</span>' +
          '<span class="tr-row__meta small muted">' + esc(metaLine(t, def)) + '</span>' +
        '</button>' +
      '</div>' +
      (open && t.enabled
        ? '<div class="tr-row__detail">' +
            goalRow(t, def) +
            sourceRow(t, def) +
            '<div class="mt-2">' + widget(t, def) + '</div>' +
            historyBlock(t, def) +
          '</div>'
        : '') +
    '</li>';
  }

  function renderBuiltins() {
    const host = $('#tr-builtins');
    if (!host) return;

    const rows = T.list(state.trackers).filter(function (t) { return T.TRACKER_DEFS[t.type]; });
    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Мої трекери</h2>' +
          '<span class="small muted">' + rows.filter(function (t) { return t.enabled; }).length + ' із ' + rows.length + ' увімкнено</span>' +
        '</div>' +
        '<ul class="tr-list mt-2">' + rows.map(builtinRow).join('') + '</ul>' +
        '<p class="small muted mb-0" style="margin-top:12px">Увімкнені трекери зʼявляються на «Сьогодні» й у «Прогресі». Вимкнені лишаються тут — історія нікуди не зникає.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Добавки та звички: власні позиції користувача                       */
  /* ------------------------------------------------------------------ */

  function customRow(t, kind) {
    const today = (state.log[t.id] || {})[todayKey()] === true;
    const st = T.boolSummary(state.log, t.id, 30, t.createdAt);
    const streakChip = kind === 'habit' && st.streak > 0
      ? '<span class="chip chip--sm chip--acc">' + st.streak + ' ' + plural(st.streak, 'день', 'дні', 'днів') + ' поспіль</span>'
      : '';

    return '<li class="tr-custom-row">' +
      '<label class="tdy-ex__main" style="flex:1;padding:9px 0">' +
        '<input type="checkbox" data-custom-mark="' + esc(t.id) + '"' + (today ? ' checked' : '') + '>' +
        '<span class="tdy-ex__check" aria-hidden="true"></span>' +
        '<span class="tr-custom-row__name">' + esc(t.name) + '</span>' +
      '</label>' +
      streakChip +
      '<span class="small muted">' + st.done + ' із ' + st.total + ' за 30д</span>' +
      '<button class="icon-btn icon-btn--danger" type="button" data-custom-del="' + esc(t.id) + '" aria-label="Видалити: ' + esc(t.name) + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
    '</li>';
  }

  function customGroup(hostId, type, title, hint, addLabel, placeholder) {
    const host = $(hostId);
    if (!host) return;

    const items = T.byType(state.trackers, type);
    host.innerHTML =
      '<div class="card">' +
        '<h2 style="margin:0">' + esc(title) + '</h2>' +
        '<p class="small mt-1">' + esc(hint) + '</p>' +
        (items.length
          ? '<ul class="tr-custom-list mt-2">' + items.map(function (t) { return customRow(t, type); }).join('') + '</ul>'
          : '<p class="small muted mt-2 mb-0">Список порожній. Додай першу позицію нижче — ' +
            'вона зʼявиться на «Сьогодні» щоденною позначкою.</p>') +
        '<div class="row mt-2" style="gap:8px;flex-wrap:wrap">' +
          /* aria-label, а не лише placeholder: підказка зникає з першою
             літерою, і читалка називала поле безіменним. */
          '<input class="input" type="text" id="add-' + type + '" style="max-width:220px" ' +
            'aria-label="' + esc(placeholder) + '" placeholder="' + esc(placeholder) + '" maxlength="60">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-add-custom="' + type + '">' + esc(addLabel) + '</button>' +
        '</div>' +
      '</div>';
  }

  function renderSupplements() {
    customGroup('#tr-supplements', 'supplement', 'Добавки',
      'Прийнято чи ні — без дозувань і графіків, просто щоденна позначка.',
      '+ Додати добавку', 'Наприклад, креатин');
  }

  function renderHabits() {
    customGroup('#tr-habits', 'habit', 'Звички',
      'Своя звичка, щоденне виконання, серія днів поспіль.',
      '+ Додати звичку', 'Наприклад, лягати до 23:00');
  }

  /* ------------------------------------------------------------------ */
  /* Збереження й обробники                                              */
  /* ------------------------------------------------------------------ */

  async function persist(patch) {
    try { await Store.saveProfile(patch); }
    catch (e) { toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err'); }
  }

  function saveTrackers(next) {
    state.trackers = next;
    persist({ trackers: next });
  }

  function saveLog(next) {
    state.log = next;
    persist({ trackerLog: next });
  }

  function renderAll() {
    renderBuiltins();
    renderSupplements();
    renderHabits();
  }

  function wire() {
    if (state.wired) return;
    state.wired = true;

    document.addEventListener('change', function (e) {
      const tog = e.target.closest('[data-toggle]');
      if (tog) {
        saveTrackers(T.setEnabled(state.trackers, tog.dataset.toggle, tog.checked));
        if (!tog.checked && state.openId === tog.dataset.toggle) state.openId = null;
        renderBuiltins();
        return;
      }
      const mark = e.target.closest('[data-custom-mark]');
      if (mark) {
        saveLog(T.logValue(state.trackers, state.log, mark.dataset.customMark, mark.checked, todayKey()));
        renderSupplements();
        renderHabits();
      }
    });

    document.addEventListener('click', function (e) {
      const exp = e.target.closest('[data-expand]');
      if (exp) {
        state.openId = state.openId === exp.dataset.expand ? null : exp.dataset.expand;
        renderBuiltins();
        return;
      }

      const add = e.target.closest('[data-add]');
      if (add) {
        saveLog(T.addDelta(state.trackers, state.log, add.dataset.add, Number(add.dataset.amount), todayKey()));
        renderBuiltins();
        return;
      }

      const dur = e.target.closest('[data-duration]');
      if (dur) {
        saveLog(T.logValue(state.trackers, state.log, dur.dataset.duration, Number(dur.dataset.min), todayKey()));
        renderBuiltins();
        return;
      }

      const sc = e.target.closest('[data-scale]');
      if (sc) {
        saveLog(T.logValue(state.trackers, state.log, sc.dataset.scale, Number(sc.dataset.val), todayKey()));
        renderBuiltins();
        return;
      }

      const pr = e.target.closest('[data-pair]');
      if (pr) {
        const patch = {}; patch[pr.dataset.field] = Number(pr.dataset.val);
        saveLog(T.logValue(state.trackers, state.log, pr.dataset.pair, patch, todayKey()));
        renderBuiltins();
        return;
      }

      const sv = e.target.closest('[data-save-value]');
      if (sv) {
        const id = sv.dataset.saveValue;
        const input = $('#val-' + id);
        const raw = String((input && input.value) || '').trim();
        /*
         * Порожнє поле = «прибрати запис», а не нуль.
         *
         * Було Number('') === 0, і воно проходило Number.isFinite: тобто
         * очистити поле означало ЗАПИСАТИ нуль. Фантомний день із нулем
         * тягнув униз середні, рахувався як «відмічено сьогодні» на
         * головній, і прибрати його можна було лише через ✕ в історії.
         */
        if (!raw) {
          saveLog(T.removeEntry(state.log, id, todayKey()));
          renderBuiltins();
          toast('Запис за сьогодні прибрано', 'ok');
          return;
        }
        const v = Number(raw.replace(',', '.'));
        if (!Number.isFinite(v)) { toast('Введи число', 'err'); return; }
        saveLog(T.logValue(state.trackers, state.log, id, v, todayKey()));
        renderBuiltins();
        toast('Записано', 'ok');
        return;
      }

      const gs = e.target.closest('[data-goal-save]');
      if (gs) {
        const id = gs.dataset.goalSave;
        const input = $('#goal-' + id);
        const def = T.defFor(state.trackers[id]);
        let v = Number(input && String(input.value).replace(',', '.'));
        if (Number.isFinite(v) && def && def.kind === 'duration') v = v * 60;
        saveTrackers(T.setGoal(state.trackers, id, v));
        renderBuiltins();
        toast('Ціль збережена', 'ok');
        return;
      }

      const del = e.target.closest('[data-entry-del]');
      if (del) {
        const parts = del.dataset.entryDel.split(':');
        const id = parts[0], d = parts.slice(1).join(':');
        // Журнал append-only: видалений запис нізвідки не відновити, а ✕
        // стоїть у щільному рядку поруч з іншими елементами.
        if (!window.confirm('Видалити запис за ' + d + '? Відновити його буде нічим.')) return;
        saveLog(T.removeEntry(state.log, id, d));
        renderBuiltins();
        toast('Запис видалено', 'ok');
        return;
      }

      const ac = e.target.closest('[data-add-custom]');
      if (ac) {
        const type = ac.dataset.addCustom;
        const input = $('#add-' + type);
        const r = T.addCustom(state.trackers, type, input && input.value);
        if (!r) { toast('Введи назву', 'err'); return; }
        state.trackers = r.trackers;
        persist({ trackers: r.trackers });
        renderSupplements();
        renderHabits();
        toast('Додано', 'ok');
        return;
      }

      const cd = e.target.closest('[data-custom-del]');
      if (cd) {
        const id = cd.dataset.customDel;
        const name = state.trackers[id] ? state.trackers[id].name : '';
        if (!window.confirm('Видалити «' + name + '» разом з історією позначок?')) return;
        state.trackers = T.removeCustom(state.trackers, id);
        state.log = Object.assign({}, state.log);
        delete state.log[id];
        persist({ trackers: state.trackers, trackerLog: state.log });
        renderSupplements();
        renderHabits();
        return;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('#add-supplement, #add-habit');
      if (!input) return;
      e.preventDefault();
      const btn = input.parentElement.querySelector('[data-add-custom]');
      if (btn) btn.click();
    });
  }

  async function init() {
    if (!$('#tr-builtins')) return;

    let p = {};
    try { p = await Store.getProfile() || {}; } catch (_) {}
    state.trackers = T.ensureBuiltins(p.trackers);
    state.log = (p.trackerLog && typeof p.trackerLog === 'object') ? p.trackerLog : {};

    // Реєстр міг бути порожнім/старим — записуємо догодований варіант
    // одразу, щоб наступне читання (напр. на «Сьогодні») не вигадувало
    // дефолти заново з різними id.
    if (JSON.stringify(state.trackers) !== JSON.stringify(p.trackers || {})) {
      persist({ trackers: state.trackers });
    }

    wire();
    renderAll();

    Store.onChange(function (profile) {
      if (!profile) return;
      if (profile.trackers) { state.trackers = T.ensureBuiltins(profile.trackers); renderBuiltins(); renderSupplements(); renderHabits(); }
      if (profile.trackerLog) { state.log = profile.trackerLog; renderAll(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
