/**
 * Сторінка «Періодизація». Математика — у js/periodization-core.js,
 * тут тільки налаштування, таблиця й збереження.
 *
 * Вправи й робочі ваги беруться з профілю (обраний план + книга ваг),
 * а не вводяться заново: два місця для тієї самої ваги неминуче розійшлись
 * би, і в якийсь момент цикл рахувався б від чисел, яких уже немає.
 */
(function () {
  'use strict';

  const { $, esc, round, toast, plural, dateLabel } = window.App;
  const P = window.Periodization;
  const PROGRAMS = window.PROGRAMS || [];

  const state = {
    cfg: P.defaults(),
    exercises: [],   // унікальні вправи плану
    weights: {},
    records: {},
    cycle: null,
    wired: false
  };

  /* ------------------------------------------------------------------ */
  /* Дані плану                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Унікальні вправи обраного плану, у порядку появи.
   *
   * Унікальні саме за назвою: у PPL на 6 днів кожен день іде двічі на
   * тиждень, і без згортання таблиця показала б жим лежачи двома
   * однаковими рядками.
   */
  function uniqueExercises(plan) {
    const seen = new Set();
    const out = [];
    (plan || []).forEach(function (day) {
      (day.exercises || []).forEach(function (ex) {
        if (!ex || !ex.name || seen.has(ex.name)) return;
        seen.add(ex.name);
        out.push(ex);
      });
    });
    return out;
  }

  function planKey(programId, days) { return programId + ':' + days; }

  /**
   * Відновити план так само, як це робить programs.js: спершу збережені
   * правки, потім базова схема. Ключ у бібліотеці — рядок, а не число
   * (`p.days['6']`), і саме на цьому місці я вже один раз промахнувся.
   */
  function planFor(profile) {
    const active = profile.activePlan;
    if (!active || !active.programId) return null;

    const days = Number(active.days) || 3;
    const custom = (profile.customPlans || {})[planKey(active.programId, days)];
    if (custom) return custom;

    const program = PROGRAMS.find(function (p) { return p.id === active.programId; });
    if (!program || !program.days) return null;
    /* Та сама перевірка статі, що в resolvePlan: цикл не має рахуватись
       на схемі, яка людині більше не належить (js/programs-data.js). */
    const allowed = window.programAllowedFor;
    if (typeof allowed === 'function' && !allowed(program, profile.sex)) return null;
    return program.days[String(days)] || null;
  }

  function weightOf(name) {
    const w = Number(state.weights[name]);
    return Number.isFinite(w) && w > 0 ? w : null;
  }

  /* ------------------------------------------------------------------ */
  /* Налаштування циклу                                                  */
  /* ------------------------------------------------------------------ */

  function segItem(name, value, label, current) {
    return '<label class="seg__item"><input type="radio" name="' + name + '" value="' + value + '"' +
           (String(current) === String(value) ? ' checked' : '') +
           '><span>' + esc(label) + '</span></label>';
  }

  function setupBlock() {
    const c = state.cycle.config;
    const started = Boolean(c.startedAt);
    const week = P.currentWeek(c);

    // На старті формула дає більше повторень, ніж має сенс робити.
    // Показуємо не сире число, а те, що реально стоятиме в таблиці:
    // стелю в 12 повторень і запас, який лишається в баку.
    const toFailure = window.OneRM.repsAtPercent(c.startPct);
    const firstReps = toFailure === null ? null : Math.min(P.REP_CAP, Math.round(toFailure));
    const firstReserve = toFailure === null ? 0 : Math.max(0, Math.round(toFailure) - firstReps);

    return '' +
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">Цикл</h2>' +
          (started
            ? '<span class="chip chip--acc">' +
                (week ? 'тиждень ' + week + ' з ' + c.weeks : 'цикл завершено') +
              '</span>'
            : '<span class="chip">не запущено</span>') +
        '</div>' +

        '<div class="grid grid-2 mt-3">' +

          '<div class="field">' +
            '<label class="field__label" for="pd-weeks">Тривалість</label>' +
            '<select class="select" id="pd-weeks">' +
              (function () {
                let out = '';
                for (let w = P.LIMITS.weeks[0]; w <= P.LIMITS.weeks[1]; w++) {
                  out += '<option value="' + w + '"' + (w === c.weeks ? ' selected' : '') + '>' +
                         w + ' тижнів</option>';
                }
                return out;
              })() +
            '</select>' +
            '<span class="field__hint">Менше 8 тижнів цикл не встигає нічого дати, більше 16 — набридає.</span>' +
          '</div>' +

          '<div class="field">' +
            '<label class="field__label">Піднімати вагу</label>' +
            '<div class="seg">' +
              segItem('pd-cadence', 1, 'щотижня', c.cadence) +
              segItem('pd-cadence', 2, 'кожні 2 тижні', c.cadence) +
            '</div>' +
            '<span class="field__hint">Кожні 2 тижні — повільніше, але кожна вага встигає закріпитись.</span>' +
          '</div>' +

          '<div class="field">' +
            '<label class="field__label" for="pd-start">Старт, % від 1ПМ</label>' +
            '<input class="input" type="number" id="pd-start" value="' + round(c.startPct, 1) + '" ' +
              'min="' + P.LIMITS.startPct[0] + '" max="' + P.LIMITS.startPct[1] + '" step="1">' +
            '<span class="field__hint">' +
              'На ' + round(c.startPct, 0) + '% це ' +
              (firstReps === null ? '—' : firstReps) + ' повторень' +
              (firstReserve ? ' із запасом ≈' + firstReserve : ' майже до відмови') + '. ' +
              'Нижче ' + P.LIMITS.startPct[0] + '% поставити не можна: це вже розминка.' +
            '</span>' +
          '</div>' +

          '<div class="field">' +
            '<label class="field__label">Що задаємо</label>' +
            '<div class="seg">' +
              segItem('pd-mode', 'target', 'кінцевий %', c.mode) +
              segItem('pd-mode', 'step', 'крок', c.mode) +
            '</div>' +
            '<span class="field__hint">' +
              'Задати можна щось одне: друге рахується. Інакше числа суперечили б одне одному.' +
            '</span>' +
          '</div>' +

          (c.mode === 'target'
            ? '<div class="field">' +
                '<label class="field__label" for="pd-end">Фініш, % від 1ПМ</label>' +
                '<input class="input" type="number" id="pd-end" value="' + round(c.endPct, 1) + '" ' +
                  'min="' + P.LIMITS.endPct[0] + '" max="' + P.LIMITS.endPct[1] + '" step="1">' +
                '<span class="field__hint">Стеля 95%: вище цього однократний підйом уже не оцінюється формулами.</span>' +
              '</div>'
            : '<div class="field">' +
                '<label class="field__label" for="pd-step">Крок, % за раз</label>' +
                '<input class="input" type="number" id="pd-step" value="' + round(c.stepPct, 2) + '" ' +
                  'min="' + P.LIMITS.stepPct[0] + '" max="' + P.LIMITS.stepPct[1] + '" step="0.5">' +
                '<span class="field__hint">Скільки відсотків додається за один підйом.</span>' +
              '</div>') +

          '<div class="field">' +
            '<label class="field__label">Виходить</label>' +
            '<div class="pd-derived">' +
              '<span class="mono">' + round(c.startPct, 0) + '%</span>' +
              '<span class="muted"> → </span>' +
              '<span class="mono">' + round(c.endPct, 0) + '%</span>' +
              '<span class="muted small">' +
                ' · ' + c.steps + ' ' + plural(c.steps, 'підйом', 'підйоми', 'підйомів') +
                ' по ' + round(c.stepPct, 2) + '%' +
              '</span>' +
            '</div>' +
            '<span class="field__hint">' +
              (c.mode === 'target'
                ? 'Крок порахований із тривалості й цілі.'
                : 'Фініш порахований із кроку й тривалості.') +
            '</span>' +
          '</div>' +

        '</div>' +

        (c.cappedByLimit
          ? '<div class="notice mt-2">' +
              icoWarn() +
              '<div class="small">З таким кроком цикл вилітає за 95% ще до кінця. ' +
              'Останні тижні впруться в стелю й підуть рівно. Або зменшіть крок, ' +
              'або скороти тривалість.</div>' +
            '</div>'
          : '') +

        (firstReserve >= 6
          ? '<div class="notice mt-2">' +
              icoWarn() +
              '<div class="small">' +
                'Старт на ' + round(c.startPct, 0) + '% — це ' + firstReps + ' повторень ' +
                'із запасом близько ' + firstReserve + '. Перші тижні свідомо далеко від ' +
                'відмови: завдання — відновити рух і техніку, а не навантажити мʼяз. ' +
                'Якщо перерва була короткою, 60–65% буде ближче до діла.' +
              '</div>' +
            '</div>'
          : '') +

        '<div class="row mt-3" style="gap:10px;flex-wrap:wrap">' +
          (started
            ? '<button class="btn btn--ghost" type="button" id="pd-stop">Зупинити цикл</button>' +
              '<button class="btn btn--ghost" type="button" id="pd-refresh">Перерахувати 1ПМ</button>'
            : '<button class="btn btn--primary" type="button" id="pd-start-cycle">Запустити цикл</button>') +
          '<button class="btn btn--ghost" type="button" id="pd-copy">Скопіювати таблицю</button>' +
        '</div>' +

        (started
          ? '<p class="small muted mt-2">' +
              'Запущено ' + esc(dateLabel(c.startedAt)) + '. Оцінки 1ПМ заморожені на цю дату — ' +
              'зміна робочих ваг у плані або скидання ваг більше не зсувають цикл. ' +
              '«Перерахувати 1ПМ» оновлює їх із поточної книги ваг.' +
            '</p>'
          : '<p class="small muted mt-2">' +
              'Поки цикл не запущено, таблиця перераховується від поточних робочих ваг. ' +
              'Запуск заморожує оцінки 1ПМ, щоб цифри не їхали посеред циклу.' +
            '</p>') +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Таблиця                                                             */
  /* ------------------------------------------------------------------ */

  function tableBlock() {
    const cy = state.cycle;
    if (!cy.rows.length) {
      return '' +
        '<div class="card">' +
          '<h2 style="margin-top:0">Нема з чого рахувати</h2>' +
          '<p class="small">' +
            'Щоб оцінити разовий максимум, потрібна робоча вага хоча б однієї вправи. ' +
            'Заповніть їх у «Моєму плані» — цикл підхопить їх звідти.' +
          '</p>' +
          '<a class="btn btn--primary mt-1" href="plan.html">Заповнити ваги</a>' +
        '</div>';
    }

    const week = P.currentWeek(cy.config);

    const head = '<tr>' +
      '<th>Вправа</th>' +
      '<th style="width:70px">1ПМ</th>' +
      cy.weeks.map(function (w) {
        return '<th class="num' + (w === week ? ' is-now' : '') + '" style="width:78px">' +
                 'Т' + w +
               '</th>';
      }).join('') +
    '</tr>';

    const body = cy.rows.map(function (r) {
      return '<tr>' +
        '<td>' +
          '<b class="small">' + esc(r.name) + '</b>' +
          (r.kind === 'isolation'
            ? '<span class="small muted"> · стеля ' + r.ceiling + '%</span>'
            : '') +
        '</td>' +
        '<td class="num mono small">' +
          round(r.oneRM, 0) +
          (r.source === 'record' ? '<span class="muted" title="виміряний рекорд">✓</span>' : '') +
        '</td>' +
        r.cells.map(function (c, i) {
          const now = (i + 1) === week;
          // Запас показуємо просто числом «+N»: це не помилка й не попередження,
          // а вказівка зупинитись, маючи ще N повторень у баку.
          const tip = round(c.pct, 0) + '% від 1ПМ · ' + c.reps + ' повторень' +
            (c.reserve
              ? ', зупиніться із запасом ≈' + c.reserve + ' (до відмови вийшло б ' + (c.reps + c.reserve) + ')'
              : ', це майже до відмови');
          return '<td class="num pd-cell' + (now ? ' is-now' : '') + (c.capped ? ' is-capped' : '') + '" ' +
                     'title="' + esc(tip) + '">' +
                   '<span class="mono">' + round(c.weight, 1) + '</span>' +
                   '<span class="pd-cell__sub">' + round(c.pct, 0) + '% · ×' + (c.reps === null ? '—' : c.reps) +
                     (c.reserve ? '<i class="pd-res">запас ' + c.reserve + '</i>' : '') +
                   '</span>' +
                 '</td>';
        }).join('') +
      '</tr>';
    }).join('');

    return '' +
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:12px">' +
          '<h2 style="margin:0">Тижні</h2>' +
          '<span class="small muted">вага, кг · % від 1ПМ · повторень</span>' +
        '</div>' +

        '<div class="table-wrap mt-2">' +
          '<table class="tbl tbl--pd">' +
            '<thead>' + head + '</thead>' +
            '<tbody>' + body + '</tbody>' +
          '</table>' +
        '</div>' +

        '<p class="small muted mt-2">' +
          'Повторення обрізані на ' + P.REP_CAP + ': формула на легких тижнях дає 20+, ' +
          'але підхід на двадцять разів тренує витривалість, а не силу. ' +
          '«Запас N» означає — зробіть ' + P.REP_CAP + ' і зупиніться, маючи ще N у баку. ' +
          'Саме в цьому сенс легких тижнів: рух і техніка, а не втома. ' +
          'Підходи лишаються ті самі, що в плані. ' +
          'Базові ваги округлені до 2,5 кг, ізоляція до 1 кг; беріть найближче, що є в залі.' +
          (cy.rows.some(function (r) { return r.cells.some(function (c) { return c.capped; }); })
            ? ' Затемнені клітинки вперлись у стелю інтенсивності для ізоляції — так і має бути.'
            : '') +
        '</p>' +

        (cy.skipped.length
          ? '<div class="notice mt-2">' +
              icoWarn() +
              '<div class="small">' +
                'Без робочої ваги, тому не в таблиці: ' +
                esc(cy.skipped.join(', ')) + '. ' +
                'Заповніть їх у «Моєму плані».' +
              '</div>' +
            '</div>'
          : '') +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Копіювання                                                          */
  /* ------------------------------------------------------------------ */

  function cycleToText() {
    const cy = state.cycle;
    const c = cy.config;
    const lines = [
      'Get Stronger — цикл на ' + c.weeks + ' тижнів',
      round(c.startPct, 0) + '% → ' + round(c.endPct, 0) + '% від 1ПМ, ' +
        'крок ' + round(c.stepPct, 2) + '% ' +
        (c.cadence === 1 ? 'щотижня' : 'кожні 2 тижні'),
      ''
    ];
    cy.rows.forEach(function (r) {
      lines.push(r.name + '  (1ПМ ≈ ' + round(r.oneRM, 0) + ' кг)');
      cy.weeks.forEach(function (w, i) {
        const cell = r.cells[i];
        lines.push('  Тиждень ' + w + ': ' + round(cell.weight, 1) + ' кг · ' +
                   round(cell.pct, 0) + '% · ' + (cell.reps === null ? '—' : cell.reps) + ' повт.');
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function cycleToHtml() {
    const cy = state.cycle;
    const c = cy.config;
    // Таблиця для вставки в нотатки: рамки атрибутами, а не CSS, бо
    // зовнішні стилі при вставці не переживають майже ніде.
    return '' +
      '<p><b>Get Stronger — цикл на ' + c.weeks + ' тижнів</b><br>' +
      round(c.startPct, 0) + '% → ' + round(c.endPct, 0) + '% від 1ПМ, крок ' +
      round(c.stepPct, 2) + '% ' + (c.cadence === 1 ? 'щотижня' : 'кожні 2 тижні') + '</p>' +
      '<table border="1" cellpadding="6" cellspacing="0">' +
        '<thead><tr><th>Вправа</th><th>1ПМ</th>' +
          cy.weeks.map(function (w) { return '<th>Т' + w + '</th>'; }).join('') +
        '</tr></thead>' +
        '<tbody>' +
          cy.rows.map(function (r) {
            return '<tr><td>' + esc(r.name) + '</td><td>' + round(r.oneRM, 0) + '</td>' +
              r.cells.map(function (cell) {
                return '<td>' + round(cell.weight, 1) + ' кг<br>' +
                       round(cell.pct, 0) + '% · ×' + (cell.reps === null ? '—' : cell.reps) + '</td>';
              }).join('') +
            '</tr>';
          }).join('') +
        '</tbody>' +
      '</table>';
  }

  /* ------------------------------------------------------------------ */
  /* Дрібниці                                                            */
  /* ------------------------------------------------------------------ */

  function icoWarn() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
           '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
  }



  /* ------------------------------------------------------------------ */
  /* Рендер і збереження                                                 */
  /* ------------------------------------------------------------------ */

  function rebuild() {
    state.cycle = P.buildCycle(state.cfg, state.exercises, weightOf, state.records);
    state.cfg = state.cycle.config;
  }

  function render() {
    rebuild();
    const setup = $('#pd-setup');
    const table = $('#pd-table');
    if (setup) setup.innerHTML = setupBlock();
    if (table) table.innerHTML = tableBlock();
  }

  function persist() {
    window.Store.saveProfile({ periodization: state.cfg }).catch(function (e) {
      toast('Не збереглося: ' + e.message, 'err');
    });
  }

  /** Заморозити поточні оцінки 1ПМ у налаштуваннях циклу */
  function freezeOneRM() {
    const frozen = {};
    // Рахуємо від книги ваг наново, ігноруючи попередню заморозку:
    // саме цього чекають і від запуску, і від кнопки «Перерахувати».
    const clean = Object.assign({}, state.cfg, { oneRM: {} });
    const fresh = P.buildCycle(clean, state.exercises, weightOf, state.records);
    fresh.rows.forEach(function (r) { frozen[r.name] = r.oneRM; });
    return frozen;
  }

  function wire() {
    if (state.wired) return;
    const host = $('#pd');
    if (!host) return;
    state.wired = true;

    host.addEventListener('change', function (e) {
      const t = e.target;
      if (!t || !t.id && !t.name) return;

      if (t.id === 'pd-weeks')  state.cfg.weeks = Number(t.value);
      else if (t.name === 'pd-cadence') state.cfg.cadence = Number(t.value);
      else if (t.name === 'pd-mode')    state.cfg.mode = t.value;
      else if (t.id === 'pd-start') state.cfg.startPct = Number(t.value);
      else if (t.id === 'pd-end')   state.cfg.endPct = Number(t.value);
      else if (t.id === 'pd-step')  state.cfg.stepPct = Number(t.value);
      else return;

      render();
      persist();
    });

    host.addEventListener('click', function (e) {
      if (e.target.closest('#pd-start-cycle')) {
        state.cfg.startedAt = new Date().toISOString();
        state.cfg.oneRM = freezeOneRM();
        render();
        persist();
        toast('Цикл запущено', 'ok');
        return;
      }
      if (e.target.closest('#pd-stop')) {
        state.cfg.startedAt = null;
        state.cfg.oneRM = {};
        render();
        persist();
        toast('Цикл зупинено', 'ok');
        return;
      }
      if (e.target.closest('#pd-refresh')) {
        state.cfg.oneRM = freezeOneRM();
        render();
        persist();
        toast('Оцінки 1ПМ оновлено з поточних ваг', 'ok');
        return;
      }
      if (e.target.closest('#pd-copy')) {
        const btn = e.target.closest('#pd-copy');
        if (!state.cycle || !state.cycle.rows.length) return;
        window.App.copyRich(cycleToHtml(), cycleToText()).then(function (ok) {
          if (ok) window.App.flashDone(btn, 'Скопійовано');
          if (ok === 'rich') { toast('Скопійовано таблицею', 'ok'); return; }
          if (ok === 'text') { toast('Скопійовано текстом', 'ok'); return; }
          toast('Буфер недоступний', 'err');
        });
      }
    });
  }

  /* ------------------------------------------------------------------ */

  async function init() {
    const host = $('#pd');
    if (!host) return;

    let profile = {};
    try { profile = await window.Store.getProfile() || {}; } catch (_) { /* необовʼязково */ }

    const plan = planFor(profile);
    if (!plan) { host.dataset.state = 'empty'; return; }

    state.exercises = uniqueExercises(plan);
    state.weights = (profile.weights && typeof profile.weights === 'object') ? profile.weights : {};
    state.records = (profile.records && typeof profile.records === 'object') ? profile.records : {};
    state.cfg = P.normalize(profile.periodization || {});

    host.dataset.state = 'ready';
    wire();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
