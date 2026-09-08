/**
 * Калькулятор разового максимуму (1ПМ / 1RM).
 *
 * Жодна формула не «правильна» — усі це регресії, побудовані на вибірках
 * людей. Тому рахуємо кількома одразу і показуємо розкид: якщо формули
 * розходяться на 10 кг, значить оцінка груба, і це чесніше сховати не можна.
 *
 * Похибка зростає з кількістю повторень: при r > 10 оцінка ненадійна.
 */
(function () {
  'use strict';

  const { $, $$, esc, round, toast } = window.App;

  /* ------------------------------------------------------------------ */
  /* Формули                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Математика живе в js/onerm-core.js — цю ж таблицю формул використовує
   * сторінка періодизації. Тут лишився тільки рендер.
   */
  const OneRM = window.OneRM;
  const { FORMULAS, percentOfMax } = OneRM;

  const REP_ROWS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];

  const LIFTS = [
    { id: 'squat',    name: 'Присідання' },
    { id: 'bench',    name: 'Жим лежачи' },
    { id: 'deadlift', name: 'Станова тяга' },
    { id: 'ohp',      name: 'Жим стоячи' },
    { id: 'row',      name: 'Тяга в нахилі' },
    { id: 'other',    name: 'Інша вправа' }
  ];

  /* ------------------------------------------------------------------ */
  /* Рендер                                                              */
  /* ------------------------------------------------------------------ */

  function render(weight, reps) {
    const out = $('#onerm-out');
    if (!out) return;

    if (!(weight > 0) || !(reps >= 1)) {
      out.innerHTML = '<div class="notice notice--acc">Введіть вагу й кількість повторень, які ви зробили у підході.</div>';
      return;
    }

    /*
     * Рахує ЯДРО, а не ця сторінка.
     *
     * Раніше тут викликалось f.fn(weight, reps) напряму, в обхід
     * OneRM.estimates — і разом із ним губились обидва запобіжники ядра:
     * MAX_REPS = 36 і відсів значень понад MAX_WEIGHT * 2. Наслідок:
     * ввід 100 кг × 30 повторень (у межах max="30" самого поля!) давав
     * у таблиці Brzycki 514,3 кг і підпис «розкид 204%» — як легітимну
     * оцінку. Дублювати математику поза ядром не можна, про що прямо
     * попереджає шапка onerm-core.js.
     */
    const results = reps === 1
      ? FORMULAS.map(f => ({ ...f, value: weight }))
      : OneRM.estimates(weight, reps);

    if (!results.length) {
      /*
       * Розділяємо дві різні причини. «Забагато повторень» і «вага поза
       * межами» — це не одне й те саме, а раніше обидва давали одну підказку
       * про 1–12 повторень, яка при ваговій помилці збивала з пантелику.
       */
      const msg = (weight > OneRM.MAX_WEIGHT)
        ? 'Вага понад ' + OneRM.MAX_WEIGHT + ' кг — це вже поза межами, на яких перевіряли ці формули.'
        : 'Забагато повторень для цих формул. Вони калібровані на підходах ' +
          'до 12 разів; далі похибка більша за саму оцінку.';
      out.innerHTML = '<div class="notice">' + msg + '</div>';
      return;
    }

    /*
     * Чесне попередження в зоні, де формули ще рахують, але вже брешуть.
     * Ядро пропускає до 36 повторень (щоб periodization могла звідти
     * рахувати), але для людини за екраном 15 повторень — це вже здогад.
     */
    /* TXT-008: тут стояло reps > 12, а поруч у тому самому файлі — > 10,
       і сторінка казала «понад 10» в одному місці й «понад 12» в іншому.
       Поріг один: 10 повторень, як у calculator.html. */
    const shaky = reps > 10;

    // Підсумкове значення — медіана, а не середнє: Mayhew систематично
    // відхиляється вгору й перетягує середнє на себе. Медіана стійка
    // до одного випадаючого значення в наборі з семи.
    const values = results.map(r => r.value).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const avg = values.length % 2
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2;

    const min = values[0];
    const max = values[values.length - 1];
    const spreadPct = (max - min) / avg * 100;

    // Наскільки довіряти результату
    let confidence, confClass;
    if (reps <= 5)      { confidence = 'Висока'; confClass = 'chip--ok'; }
    else if (reps <= 10) { confidence = 'Середня'; confClass = 'chip--acc'; }
    else                 { confidence = 'Низька'; confClass = 'chip--warn'; }

    out.innerHTML = '' +
      '<div class="card">' +
        '<div class="row row--split">' +
          '<div>' +
            '<span class="eyebrow"><span class="eyebrow__dot"></span>Оцінка 1ПМ</span>' +
            '<div style="font-size:clamp(2.6rem,7vw,4rem);font-weight:800;letter-spacing:-0.04em;line-height:1.05;margin-top:12px" class="gradient-text mono">' +
              round(avg, 1) + ' кг' +
            '</div>' +
            '<p class="small muted" style="margin:6px 0 0">' +
              'Діапазон формул: ' + round(min, 1) + '–' + round(max, 1) + ' кг (розкид ' + round(spreadPct, 1) + '%)' +
            '</p>' +
          '</div>' +
          '<span class="chip ' + confClass + '">Надійність: ' + confidence + '</span>' +
        '</div>' +

        (reps > 10
          ? '<div class="notice mt-2">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
              '<div>Понад 10 повторень формули оцінюють погано — розбіжність із реальним 1ПМ ' +
              'зростає, бо на високих повтореннях результат обмежує витривалість, а не сила. ' +
              'Для точнішої оцінки зробіть підхід на 3–6 повторень із запасом 0–1 повторення.</div>' +
            '</div>'
          : '') +

        '<hr class="divider">' +
        '<h3>За формулами</h3>' +
        '<div class="table-wrap">' +
          '<table class="tbl">' +
            '<thead><tr><th>Формула</th><th style="width:110px">1ПМ, кг</th><th>Особливість</th></tr></thead>' +
            '<tbody>' +
              results.map(r =>
                '<tr>' +
                  '<td><b>' + esc(r.name) + '</b></td>' +
                  '<td class="num mono">' + round(r.value, 1) + '</td>' +
                  '<td class="small muted">' + esc(r.note) + '</td>' +
                '</tr>'
              ).join('') +
            '</tbody>' +
          '</table>' +
        '</div>' +

        (shaky
          ? '<div class="notice mt-2">Понад 10 повторень формули оцінюють погано: ' +
            'вони калібровані на коротких підходах, і розкид тут — не точність, а шум. ' +
            'Для реальної оцінки зробіть підхід на 3–6 повторень.</div>'
          : '') +

        '<hr class="divider">' +
        '<h3>Робочі ваги</h3>' +
        '<p class="small muted">Від медіанної оцінки ' + round(avg, 1) + ' кг. ' +
        'Округлено до 2,5 кг — крок стандартних млинців. ' +
        'Відсотки — середнє Epley і Brzycki, тому рядок для ' + reps + ' повторень ' +
        'може відрізнятись від введеної ваги на кілька відсотків: підсумковий 1ПМ ' +
        'рахується по семи формулах, а шкала — по двох.</p>' +
        '<div class="table-wrap">' +
          '<table class="tbl">' +
            '<thead><tr><th style="width:90px">Повт.</th><th style="width:90px">% 1ПМ</th><th style="width:110px">Вага, кг</th><th>Для чого</th></tr></thead>' +
            '<tbody>' +
              REP_ROWS.map(r => {
                const pct = percentOfMax(r);
                // toPlates із ядра, а не власна копія Math.round(x/2.5)*2.5:
                // дві копії одного округлення — це два місця, де воно розійдеться.
                const w = OneRM.toPlates(avg * pct / 100, 2.5);
                let purpose = '';
                if (r <= 3)       purpose = 'Максимальна сила';
                else if (r <= 6)  purpose = 'Сила + маса';
                else if (r <= 12) purpose = 'Гіпертрофія';
                else              purpose = 'Витривалість, метаболічний стрес';
                return '<tr>' +
                  '<td class="mono">' + r + '</td>' +
                  '<td class="num mono">' + round(pct, 0) + '%</td>' +
                  '<td class="num mono"><b>' + round(w, 1) + '</b></td>' +
                  '<td class="small muted">' + purpose + '</td>' +
                '</tr>';
              }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    return round(avg, 1);
  }

  /* ------------------------------------------------------------------ */
  /* Рекорди                                                             */
  /* ------------------------------------------------------------------ */

  async function renderRecords() {
    const host = $('#records');
    if (!host) return;

    let profile;
    try { profile = await window.Store.getProfile(); }
    catch (_) { profile = { records: {} }; }

    const records = profile.records || {};
    const entries = LIFTS.filter(l => Number.isFinite(records[l.id]));

    if (!entries.length) {
      host.innerHTML = '<p class="small muted">Поки що порожньо. Порахуйте 1ПМ і натисніть «Зберегти як рекорд».</p>';
      return;
    }

    host.innerHTML =
      '<div class="kpis">' +
        entries.map(l =>
          '<div class="kpi">' +
            '<div class="kpi__val mono">' + round(records[l.id], 1) + '</div>' +
            '<p class="kpi__lbl">' + esc(l.name) + ', кг</p>' +
          '</div>'
        ).join('') +
      '</div>' +
      (entries.length >= 2
        ? '<p class="small muted mt-2">Сума: <b class="mono">' +
          round(entries.reduce((s, l) => s + records[l.id], 0), 1) + ' кг</b></p>'
        : '');
  }

  /* ------------------------------------------------------------------ */

  function init() {
    const weightEl = $('#orm-weight');
    const repsEl   = $('#orm-reps');
    const liftEl   = $('#orm-lift');
    if (!weightEl || !repsEl) return;

    let lastResult = null;

    const update = () => {
      const w = window.App.num(weightEl);
      const r = window.App.num(repsEl);
      lastResult = render(w, r);
      const saveBtn = $('#orm-save');
      if (saveBtn) saveBtn.disabled = !Number.isFinite(lastResult);
    };

    weightEl.addEventListener('input', update);
    repsEl.addEventListener('input', update);

    const saveBtn = $('#orm-save');
    if (saveBtn) {
      // function, а не стрілка: у стрілці this — це this з init(), тобто
      // undefined у strict-режимі, і App.busy(undefined) мовчки нічого не
      // робив. Кнопка лишалась активною, а кожен клік запускав власний
      // getProfile → saveProfile — саме те, що busy() мав запобігти.
      saveBtn.addEventListener('click', async function () {
        if (!Number.isFinite(lastResult)) return;
        const liftId = liftEl ? liftEl.value : 'other';
        // У хмарному режимі збереження — це запит. Без стану кнопка
        // виглядала незмінною й приймала повторні кліки.
        const done = window.App.busy(this, 'Зберігаю…');
        try {
          const profile = await window.Store.getProfile();
          const records = Object.assign({}, profile.records || {});
          records[liftId] = lastResult;
          await window.Store.saveProfile({ records });
          await renderRecords();
          toast('Рекорд збережено', 'ok');
        } catch (e) {
          toast('Не збереглося: ' + e.message, 'err');
        } finally { done(); }
      });
    }

    update();
    renderRecords();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
