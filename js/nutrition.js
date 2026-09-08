/**
 * План харчування — інтерфейс сторінки nutrition.html.
 *
 * Формули тут НЕ живуть: вони в js/nutrition-core.js, який має підключатись
 * раніше за цей файл. Такий поділ потрібен, щоб сторінка «Раціон» могла
 * взяти добову норму, не завантажуючи весь цей рендер.
 *
 * Ланцюг розрахунку:
 *   BMR  — базовий обмін. Mifflin-St Jeor (PMID 2305711), а якщо відомий
 *          відсоток жиру — Katch-McArdle, бо він враховує суху масу.
 *   TDEE — BMR × коефіцієнт активності.
 *   Ціль — TDEE ± відсоток залежно від мети.
 *   Білок — 1,6–2,2 г на кг маси тіла зі стелею за часткою калорійності,
 *   далі жир, клітковина, і вуглеводи як залишок енергії.
 *
 * Усі формули — популяційні регресії. Реальні витрати конкретної людини
 * можуть відрізнятися на ±10–15%. Тому головний інструмент — не калькулятор,
 * а зважування раз на тиждень і корекція калорій за фактичною динамікою.
 */
(function () {
  'use strict';

  const { $, $$, esc, round, num, toast, fmtNum } = window.App;

  // Уся математика живе в js/nutrition-core.js — тут лише показ
  const {
    ACTIVITY, GOALS, KCAL, PROTEIN_MIN_PER_KG, PROTEIN_MAX_PER_KG,
    MEALS_MIN, MEALS_MAX, mealNames,
    bmrMifflin, bmrKatch, macros, bmiInfo
  } = window.NutritionCalc;

  /* ------------------------------------------------------------------ */
  /* Довідники                                                           */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* Рендер                                                              */
  /* ------------------------------------------------------------------ */

  /** Дробове число в українському записі: 2.2 -> «2,2».
      Обгортка над спільним форматером — правило одне на весь Forge
      (App.fmtNum), тут лишається тільки коротка назва для цієї сторінки. */
  function dec(n) { return fmtNum.n(n, 1); }

  /**
   * Рядок таблиці макронутрієнтів.
   *
   * @param {number} [low] — нижня межа діапазону в грамах. Є тільки в білка:
   *   його норма — це відрізок 1,6–2,2 г/кг, а не одна цифра, і в таблиці
   *   мусить стояти те саме, що в поясненні під нею. Колонки «Ккал» і
   *   «Частка» рахуються від ВЕРХУ діапазону — саме він іде в баланс
   *   калорійності, тому сума рядків, як і раніше, сходиться з ціллю.
   */
  function macroRow(name, grams, kcalPerG, totalKcal, colorClass, low) {
    const kcal = grams * kcalPerG;
    const pct = totalKcal > 0 ? kcal / totalKcal * 100 : 0;
    const hasRange = Number.isFinite(low) && round(low, 0) < round(grams, 0);

    return '' +
      '<tr>' +
        '<td><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px" class="' + colorClass + '"></i>' + esc(name) + '</td>' +
        // nowrap: «110–152 г» — одне значення, і розривати його між числом
        // і одиницею не можна за жодної ширини екрана
        '<td class="num mono" style="white-space:nowrap">' +
          (hasRange ? round(low, 0) + '–' : '') +
          '<b>' + round(grams, 0) + ' г</b>' +
        '</td>' +
        '<td class="num mono">' + round(kcal, 0) + '</td>' +
        '<td class="num mono">' + round(pct, 0) + '%</td>' +
      '</tr>';
  }

  /* MEALS_MIN/MEALS_MAX і mealNames() тепер у js/nutrition-core.js —
     ту саму схему читає сторінка «Раціон», щоб кількість і назви прийомів
     збігались з обраними тут. */

  /**
   * Таблиця прийомів їжі. Ділимо порівну, а різницю від округлення
   * (вона може бути як додатною, так і відʼємною) списуємо на перший прийом —
   * інакше сума рядків не збігалася б із добовою нормою, і це кидалось би в очі.
   */
  function mealTable(kcal, m, count, weightKg) {
    const names = mealNames(count);

    /*
     * Рахуємо в цілих грамах/калоріях, щоб таблиця сходилась точно.
     *
     * Раніше залишок від округлення списувався на перший прийом БЕЗ перевірки
     * знака, і при малих сумах він робив цей прийом відʼємним:
     * split(3, 6) давало [-2, 1, 1, 1, 1, 1]. Тепер розподіляємо залишок
     * по одиниці, починаючи з перших прийомів, — сума сходиться так само
     * точно, але жодна клітинка не йде в мінус.
     */
    const split = function (total) {
      const t = Math.max(0, Math.round(Number(total) || 0));
      const per = Math.floor(t / count);
      const arr = new Array(count).fill(per);
      let rest = t - per * count;
      for (let i = 0; i < count && rest > 0; i++, rest--) arr[i]++;
      return arr;
    };

    const kc = split(kcal);
    const pr = split(m.protein);
    const fa = split(m.fat);
    const cb = split(m.carb);

    const proteinPerMeal = m.protein / count / weightKg;

    return '' +
      '<p class="small muted mt-1">' +
        'Порівну на ' + count + ' ' + (count < 5 ? 'прийоми' : 'прийомів') + '. ' +
        'Це <b>' + round(proteinPerMeal, 2) + ' г білка на кг маси тіла</b> за прийом. ' +
        'Добова сума важливіша за розкладку, тож числа можна зсувати між прийомами під свій графік.' +
      '</p>' +
      '<div class="table-wrap">' +
        '<table class="tbl">' +
          '<thead><tr>' +
            '<th>Прийом</th><th style="width:90px">Ккал</th>' +
            '<th style="width:100px">Білки, г</th>' +
            '<th style="width:100px">Жири, г</th>' +
            '<th style="width:120px">Вуглеводи, г</th>' +
          '</tr></thead>' +
          '<tbody>' +
            names.map((name, i) =>
              '<tr>' +
                '<td>' + esc(name) + '</td>' +
                '<td class="num mono">' + kc[i] + '</td>' +
                '<td class="num mono">' + pr[i] + '</td>' +
                '<td class="num mono">' + fa[i] + '</td>' +
                '<td class="num mono">' + cb[i] + '</td>' +
              '</tr>'
            ).join('') +
            '<tr style="border-top:2px solid var(--line-2)">' +
              '<td><b>Разом</b></td>' +
              '<td class="num mono"><b>' + kc.reduce((a, b) => a + b, 0) + '</b></td>' +
              '<td class="num mono"><b>' + pr.reduce((a, b) => a + b, 0) + '</b></td>' +
              '<td class="num mono"><b>' + fa.reduce((a, b) => a + b, 0) + '</b></td>' +
              '<td class="num mono"><b>' + cb.reduce((a, b) => a + b, 0) + '</b></td>' +
            '</tr>' +
          '</tbody>' +
        '</table>' +
      '</div>';
  }

  function render(input) {
    const out = $('#nutri-out');
    if (!out) return;

    const { sex, age, height, weight, bodyfat, activity, goalKey } = input;

    /*
     * Межі беруться З ЯДРА, а не задаються тут удруге.
     *
     * Раніше на одній сторінці жили ТРИ різні набори: атрибути форми
     * (14–90 років), LIMITS у ядрі (10–100) і оця перевірка «будь-що > 0».
     * Через розбіжність профіль 20 кг / 100 см / 5 років давав угорі
     * «1248 ккал, ІМТ 20,0 · Норма», а прогноз і «Раціон» на тому ж профілі
     * казали «заповни дані».
     */
    const L = window.NutritionCalc.LIMITS;
    const inRange = function (v, r) { return Number.isFinite(v) && v >= r[0] && v <= r[1]; };
    const bad = [];
    if (!inRange(weight, L.weight)) bad.push('вага ' + L.weight[0] + '–' + L.weight[1] + ' кг');
    if (!inRange(height, L.height)) bad.push('зріст ' + L.height[0] + '–' + L.height[1] + ' см');
    if (!inRange(age, L.age))       bad.push('вік ' + L.age[0] + '–' + L.age[1] + ' років');

    if (bad.length) {
      const filled = Number.isFinite(weight) || Number.isFinite(height) || Number.isFinite(age);
      out.innerHTML = '<div class="notice notice--acc">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
        '<div>' + (filled
          ? 'Значення поза межами, на яких формули щось означають: ' + esc(bad.join(', ')) + '.'
          : 'Заповніть зріст, вагу і вік — розрахунок зʼявиться одразу.') +
        '</div></div>';
      return;
    }

    // Межа жиру — та сама, що в ядрі (включно), а не строга: раніше
    // тут стояло > 3 && < 60, а в ядрі >= 3 && <= 60, і на рівно 60%
    // сторінка «Харчування» рахувала за Mifflin (2759 ккал), а «Раціон» —
    // за Katch (1645 ккал). Різниця 1114 ккал для одного профілю.
    const hasBF = inRange(bodyfat, L.bodyfat);
    /*
     * ПРОІГНОРОВАНИЙ ЖИР ТРЕБА НАЗВАТИ ВГОЛОС (UX-008).
     *
     * Поле необовʼязкове, тому в bad воно не йде — блокувати розрахунок
     * через нього не можна. Але мовчазне ігнорування було гірше за
     * блокування: значення лишалось у полі, а формула непомітно
     * переходила з Katch-McArdle на Mifflin-St Jeor. Для одного профілю
     * це понад 1000 ккал різниці — і жодної підказки, звідки вона.
     */
    const bfIgnored = Number.isFinite(bodyfat) && !hasBF;
    const method = hasBF ? 'Katch-McArdle (за сухою масою)' : 'Mifflin-St Jeor';
    const lbm = hasBF ? weight * (1 - bodyfat / 100) : null;

    /*
     * Ціль рахує ЯДРО, а не ця сторінка.
     *
     * Раніше тут стояло власне target = tdee * (1 + goal.pct) — те саме,
     * що в targetFor, але без підлоги калорійності, яку туди додано. Дві
     * копії однієї формули розходяться завжди; питання лише коли.
     */
    const t = window.NutritionCalc.targetFor({
      sex: sex === 'female' ? 'female' : 'male',
      weight: weight, height: height, age: age,
      bodyfat: hasBF ? bodyfat : null,
      activity: activity, goal: goalKey
    });
    if (!t) {
      out.innerHTML = '<div class="notice notice--acc">Не вдалося порахувати за цими даними.</div>';
      return;
    }

    const bmr = t.bmr;
    const tdee = t.tdee;
    const goal = GOALS[goalKey];
    const target = t.kcal;
    const delta = target - tdee;

    const m = {
      protein: t.protein, fat: t.fat, carb: t.carb, fiber: t.fiber,
      infeasible: t.infeasible, proteinCapped: t.proteinCapped
    };
    const bmi = bmiInfo(weight, height);

    // Клітковину дає macros: вона входить в енергетичний баланс, і рахувати
    // її тут удруге означало б знову розсинхронити ціль по калоріях із
    // цілями по макросах — саме та подвійна оплата, що давала +2,8%.
    const fiber = m.fiber;
    const water = weight * 0.033;

    // Очікувана швидкість зміни ваги: 1 кг жиру ≈ 7700 ккал
    const weeklyKg = delta * 7 / 7700;

    /*
     * Частки рахуються від ЦІЛІ, а не від суми макросів.
     *
     * Раніше нормування на суму приховувало розходження: коли макроси
     * перевищували ціль, смуга все одно показувала рівно 100%, і сторінка
     * суперечила сама собі. Тепер сума макросів гарантовано дорівнює цілі
     * (див. macros у ядрі), тож нормувати на ціль і чесно, і безпечно.
     */
    const pP = m.protein * KCAL.protein / target * 100;
    const pF = m.fat * KCAL.fat / target * 100;
    const pC = m.carb * KCAL.carb / target * 100;
    const pFib = m.fiber * window.NutritionCalc.KCAL_FIBER / target * 100;

    out.innerHTML = '' +
      '<div class="card">' +
        '<span class="eyebrow"><span class="eyebrow__dot"></span>' + esc(goal.label) + '</span>' +
        '<div style="font-size:clamp(2.6rem,7vw,4rem);font-weight:800;letter-spacing:-0.04em;line-height:1.05;margin-top:12px" class="gradient-text mono">' +
          round(target, 0) + ' ккал' +
        '</div>' +
        '<p class="small muted" style="margin:6px 0 0">' +
          'На добу. Це ' + (delta >= 0 ? '+' : '') + round(delta, 0) + ' ккал відносно витрат (' + round(tdee, 0) + ' ккал).' +
          (Math.abs(weeklyKg) > 0.02
            ? ' Очікувана динаміка: ' + (weeklyKg > 0 ? '+' : '') + round(weeklyKg, 2) + ' кг/тиждень.'
            : ' Вага має триматись стабільною.') +
        '</p>' +

        (t.floored
          ? '<div class="notice mt-2">Обрана мета дала б ' + round(t.rawKcal, 0) + ' ккал — ' +
            'нижче за ' + (t.floorKcal === t.bmr ? 'ваш базовий обмін' : 'загальноприйнятий поріг') +
            ' (' + round(t.floorKcal, 0) + ' ккал). Показано саме поріг: глибший дефіцит створюють ' +
            'рухом, а не подальшим зрізанням їжі — інакше страждає мʼязова маса й закриття ' +
            'раціону за вітамінами та мінералами.</div>'
          : '') +

        (t.proteinCapped
          ? '<div class="notice mt-2">Білок обмежено часткою калорійності (' +
            round(window.NutritionCalc.PROTEIN_MAX_SHARE * 100, 0) + '%), а не масою тіла: ' +
            'за верхом діапазону (' + dec(PROTEIN_MAX_PER_KG) + ' г на кг) вийшло б ' +
            round(weight * PROTEIN_MAX_PER_KG, 0) + ' г, ' +
            'і це була б більша частина всієї добової енергії.</div>'
          : '') +

        '<div class="kpis mt-3">' +
          '<div class="kpi"><div class="kpi__val mono">' + round(bmr, 0) + '</div><p class="kpi__lbl">BMR, ккал</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + round(tdee, 0) + '</div><p class="kpi__lbl">TDEE, ккал</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + round(bmi.bmi, 1) + '</div><p class="kpi__lbl">ІМТ · ' + esc(bmi.label) + '</p></div>' +
          (lbm
            ? '<div class="kpi"><div class="kpi__val mono">' + round(lbm, 1) + '</div><p class="kpi__lbl">суха маса, кг</p></div>'
            : '<div class="kpi"><div class="kpi__val mono">' + round(water, 1) + '</div><p class="kpi__lbl">вода, л/добу</p></div>') +
        '</div>' +

        '<hr class="divider">' +

        '<h3>Макронутрієнти</h3>' +
        '<div class="macrobar">' +
          '<span class="macrobar__p" style="width:' + pP + '%"></span>' +
          '<span class="macrobar__f" style="width:' + pF + '%"></span>' +
          '<span class="macrobar__c" style="width:' + pC + '%"></span>' +
        '</div>' +
        '<div class="legend">' +
          '<span><i class="macrobar__p"></i>Білок ' + round(pP, 0) + '%</span>' +
          '<span><i class="macrobar__f"></i>Жири ' + round(pF, 0) + '%</span>' +
          '<span><i class="macrobar__c"></i>Вуглеводи ' + round(pC, 0) + '%</span>' +
        '</div>' +

        '<div class="table-wrap mt-2">' +
          '<table class="tbl">' +
            // Ширина лишається 110px. Діапазон білка («110–152 г») вміщається
            // в неї завдяки nowrap у самій клітинці; збільшення колонки до
            // 140px тиснуло перший стовпчик, і на 380px «Клітковина» їхала
            // під свій маркер.
            '<thead><tr><th>Нутрієнт</th><th style="width:110px">На добу</th><th style="width:90px">Ккал</th><th style="width:80px">Частка</th></tr></thead>' +
            '<tbody>' +
              macroRow('Білок', m.protein, KCAL.protein, target, 'macrobar__p', t.proteinRange[0]) +
              macroRow('Жири', m.fat, KCAL.fat, target, 'macrobar__f') +
              macroRow('Вуглеводи', m.carb, KCAL.carb, target, 'macrobar__c') +
              // Клітковина стоїть у тій самій таблиці, бо тепер вона й
              // рахується в тому самому балансі: її 2 ккал/г уже відняті
              // з вуглеводів, а не оплачені двічі.
              macroRow('Клітковина', m.fiber, window.NutritionCalc.KCAL_FIBER, target, 'macrobar__c') +
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<p class="small muted mt-2">' +
          // Норма білка — ДІАПАЗОН, а не одне число: 1,6 г/кг це точкова
          // оцінка плато (Morton 2018), 2,2 — верхня межа її 95% ДІ.
          'Білок: <b>' + round(t.proteinRange[0], 0) + '–' + round(t.proteinRange[1], 0) + ' г</b> ' +
          '(' + dec(PROTEIN_MIN_PER_KG) + '–' + dec(PROTEIN_MAX_PER_KG) + ' г на кг маси тіла), ' +
          'у розрахунку взято <b>' + round(m.protein, 0) + ' г</b> — це ' +
          dec(round(m.protein / weight, 2)) + ' г/кг. ' +
          'Вуглеводи вказані БЕЗ клітковини, як і в довіднику продуктів. ' +
          'Вода: <b>' + dec(round(water, 1)) + ' л</b> плюс те, що випʼєте на тренуванні.' +
        '</p>' +

        '<hr class="divider">' +

        '<div class="row" style="justify-content:space-between;align-items:flex-end">' +
          '<h3 style="margin:0">Розподіл на прийоми їжі</h3>' +
          '<div class="seg" id="meals-seg">' +
            mealOptions().map(n =>
              '<label class="seg__item">' +
                '<input type="radio" name="meals" value="' + n + '"' + (n === input.meals ? ' checked' : '') + '>' +
                '<span>' + n + '</span>' +
              '</label>'
            ).join('') +
          '</div>' +
        '</div>' +
        mealTable(target, m, input.meals, weight) +

        '<hr class="divider">' +

        (goal.warn
          ? '<div class="notice">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9L2.4 17a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>' +
              '<div>' + goal.warn +
                (goal.pmid
                  ? ' <a href="https://pubmed.ncbi.nlm.nih.gov/' + goal.pmid + '/" target="_blank" rel="noopener">PMID ' + goal.pmid + '</a>'
                  : '') +
              '</div>' +
            '</div>'
          : '') +

        (bfIgnored
          ? '<div class="notice">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9L2.4 17a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>' +
              '<div>Відсоток жиру (' + round(bodyfat, 1) + '%) поза межами ' +
                L.bodyfat[0] + '–' + L.bodyfat[1] + '% — це поле проігноровано, ' +
                'розрахунок пішов за Mifflin-St Jeor. Виправте його або приберіть, ' +
                'щоб отримати оцінку за сухою масою.</div>' +
            '</div>'
          : '') +

        '<div class="notice notice--acc">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
          '<div>' +
            '<b>Розрахунок за формулою ' + esc(method) + ' — це стартова точка, не істина.</b> ' +
            'Індивідуальні витрати можуть відрізнятися на ±10–15%. ' +
            'Зважуйтесь 3–4 рази на тиждень у тих самих умовах і дивіться на середнє за тиждень. ' +
            'Якщо за 2–3 тижні динаміка не збігається з ціллю (' + esc(goal.rate) + ') — ' +
            'змініть калорії на 100–200 ккал і спостерігайте далі.' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */

  /** Кількість прийомів їжі. Живе поза формою — перемикач у блоці результату.
      Замовчування спільне з раціоном (js/nutrition-core.js). */
  let mealCount = window.NutritionCalc.MEALS_DEFAULT;

  /** Доступні варіанти кількості прийомів */
  function mealOptions() {
    const out = [];
    for (let n = MEALS_MIN; n <= MEALS_MAX; n++) out.push(n);
    return out;
  }

  /**
   * Поля поза допустимими межами — списком підписів для повідомлення.
   * Межі беремо з NutritionCalc.LIMITS, щоб не завести другу копію правил:
   * саме за ними targetFor() і вирішує, рахувати чи повернути null.
   */
  function badFields(i) {
    const L = window.NutritionCalc.LIMITS;
    const out = [];
    const check = function (v, range, label) {
      if (v === null || v === undefined || v === '') return;   // порожнє — не помилка
      const n = Number(v);
      if (!Number.isFinite(n) || n < range[0] || n > range[1]) {
        out.push(label + ' (' + range[0] + '–' + range[1] + ')');
      }
    };
    check(i.age, L.age, 'вік');
    check(i.height, L.height, 'зріст');
    check(i.weight, L.weight, 'вага');
    check(i.bodyfat, L.bodyfat, '% жиру');
    return out;
  }

  function readInput() {
    const sexEl = $$('input[name="sex"]').find(r => r.checked);
    const goalEl = $$('input[name="goal"]').find(r => r.checked);
    return {
      sex: sexEl ? sexEl.value : 'male',
      age: num($('#n-age')),
      height: num($('#n-height')),
      weight: num($('#n-weight')),
      bodyfat: num($('#n-bodyfat')),
      activity: parseFloat($('#n-activity') ? $('#n-activity').value : '1.55'),
      goalKey: goalEl ? goalEl.value : 'maintain',
      meals: mealCount
    };
  }


  /* ------------------------------------------------------------------ */
  /* Прогноз маси                                                        */
  /* ------------------------------------------------------------------ */
  /*
   * Показує дві речі поруч і навмисно різними словами: скільки набереш
   * ВАГИ (арифметика) і скільки з того буде МʼЯЗІВ (модель зі стелею).
   * Різниця між цими числами — і є вся суть питання «на скільки їсти».
   */

  const HORIZONS = [1, 3, 6, 12];

  const AGE_LABEL = {
    novice: 'До 1 року',
    inter:  '1–2 роки',
    adv:    '3–5 років',
    elite:  'Понад 5 років'
  };

  /* Стаж живе в профілі: його ж використовує прогноз робочих ваг. */
  let trainingAge = 'inter';

  /** Смуга «мʼязи проти жиру» в межах набраної ваги */
  function splitBar(f) {
    const lean = Math.abs(f.lean);
    const fat = Math.abs(f.fat);
    const total = lean + fat;
    if (!total) return '';
    const p = lean / total * 100;
    return '<span class="split" aria-hidden="true">' +
             '<i class="split__lean" style="width:' + p + '%"></i>' +
             '<i class="split__fat" style="width:' + (100 - p) + '%"></i>' +
           '</span>';
  }

  function sign(n, digits) {
    const v = round(n, digits === undefined ? 1 : digits);
    return (n > 0 ? '+' : '') + v;
  }

  function renderForecast(input) {
    const host = $('#nutri-forecast');
    if (!host) return;

    const profile = {
      sex: input.sex, age: input.age, height: input.height,
      weight: input.weight, bodyfat: input.bodyfat,
      activity: input.activity, goal: input.goalKey,
      trainingAge: trainingAge
    };

    const rows = HORIZONS.map(function (m) { return window.NutritionCalc.massForecast(profile, m); });
    /* Мовчазне зникнення блока читається як поламана сторінка. Кажемо, чого
       саме бракує — так само, як це вже робить сторінка акаунта. */
    if (!rows[0]) {
      host.innerHTML =
        '<div class="notice mt-3">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
          '<div class="small">Прогноз маси зʼявиться, коли будуть заповнені стать, вік, зріст і вага — ' +
            'без них немає з чого рахувати траєкторію.</div>' +
        '</div>';
      return;
    }

    const year = rows[rows.length - 1];

    host.innerHTML =
      '<div class="card mt-3">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">Прогноз маси</h2>' +
          '<span class="chip chip--warn">модель, не обіцянка</span>' +
        '</div>' +
        '<p class="small muted mt-1">' +
          'Ліворуч — скільки зміниться <b>вага</b>. Це майже чиста арифметика з калорій. ' +
          'Праворуч — скільки з того буде <b>мʼязів</b>. Це вже модель, і вона впирається ' +
          'у стелю швидкості, яку калоріями не обійти.' +
        '</p>' +

        '<div class="field mt-3">' +
          '<label class="field__label">Скільки часу тренуєтесь з залізом</label>' +
          '<div class="seg">' +
            Object.keys(AGE_LABEL).map(function (k) {
              return '<label class="seg__item">' +
                '<input type="radio" name="tage" value="' + k + '"' +
                  (k === trainingAge ? ' checked' : '') + '><span>' + esc(AGE_LABEL[k]) + '</span></label>';
            }).join('') +
          '</div>' +
          '<span class="field__hint">' +
            'Єдине, що керує стелею приросту мʼязів: ' +
            round(window.NutritionCalc.LEAN_CEILING[trainingAge], 2) + ' кг сухої маси на місяць. ' +
            'Зберігається в профіль — той самий стаж використовує прогноз робочих ваг.' +
          '</span>' +
        '</div>' +

        '<div class="table-wrap mt-2">' +
          '<table class="tbl">' +
            '<thead><tr>' +
              '<th>Через</th><th class="num">Вага</th><th class="num">Мʼязи</th>' +
              '<th class="num">Жир</th><th>Склад приросту</th>' +
            '</tr></thead>' +
            '<tbody>' +
              rows.map(function (f) {
                return '<tr>' +
                  '<td>' + f.months + ' ' + (f.months === 1 ? 'місяць' : (f.months < 5 ? 'місяці' : 'місяців')) + '</td>' +
                  '<td class="num mono"><b>' + sign(f.totalKg) + '</b>' +
                    (f.weightNow ? '<div class="small muted">' + round(f.weightNow + f.totalKg, 1) + ' кг</div>' : '') +
                  '</td>' +
                  '<td class="num mono">' + sign(f.lean) +
                    '<div class="small muted">' + round(f.leanLow, 1) + '…' + round(f.leanHigh, 1) + '</div>' +
                  '</td>' +
                  '<td class="num mono">' + sign(f.fat) + '</td>' +
                  '<td>' + splitBar(f) + '</td>' +
                '</tr>';
              }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>' +

        (year.cappedByCeiling
          ? '<div class="notice mt-2">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
              '<div class="small">' +
                'При цій калорійності за рік набереться <b>' + sign(year.totalKg) + ' кг ваги</b>, ' +
                'але мʼязів із них — не більше <b>' + round(year.lean, 1) + ' кг</b>. ' +
                'Решта, <b>' + round(year.fat, 1) + ' кг</b>, піде в жир: приріст мʼязової маси ' +
                'упирається у стелю швидкості, і зайві калорії її не піднімають. ' +
                'Щоб набирати чистіше — зменшіть профіцит.' +
              '</div>' +
            '</div>'
          : '') +

        (year.flat
          ? '<div class="notice notice--acc mt-2">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
              '<div class="small">' +
                'Вага стоїть, а склад тіла зсувається: приблизно <b>' + round(year.lean, 1) + ' кг</b> ' +
                'мʼязів за рік на місце такої ж кількості жиру. Ваги цього не покажуть взагалі — ' +
                'орієнтуйся на обхвати й фото.' +
              '</div>' +
            '</div>'
          : '') +

        limitsBlock() +
      '</div>';
  }

  function limitsBlock() {
    return '' +
      '<div class="acc mt-3">' +
        '<button class="acc__head" type="button" aria-expanded="false">' +
          '<span class="chip chip--warn">Межі</span>' +
          '<span><h3>Чому вага рахується точніше за мʼязи</h3></span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          '<p class="small">' +
            '<b>Вага.</b> Різниця між зʼїденим і витраченим ділиться на енергоємність ' +
            'жирової тканини — приблизно 7700 ккал на кг. Це майже чиста арифметика, ' +
            'і єдина її слабка ланка — оцінка витрат, яка може помилятись на ±10–15%. ' +
            'Прогноз перераховує витрати щомісяця від поточної ваги: раніше він ' +
            'множив початковий дефіцит на 365 днів і для звичайного профілю ' +
            '(80 кг, схуднення) обіцяв кінцеву вагу 47 кг.' +
          '</p>' +
          '<p class="small">' +
            'Але й тут є системний зсув: 7700 — це про <i>жир</i>. Суха тканина ' +
            '«коштує» дешевше, а глікоген приходить разом із водою. Тому в перші ' +
            'один-два тижні набору вага росте швидше за модель — і це не мʼязи, ' +
            'а вода. На дефіциті рівно навпаки: перший тиждень падає надто швидко.' +
          '</p>' +
          '<p class="small">' +
            '<b>Мʼязи.</b> Тут порахувати нема з чого. Модель тримається на одній ідеї: ' +
            'приріст мʼязової маси має <b>стелю швидкості</b>, і калорії її не піднімають. ' +
            'Стеля падає зі стажем — новачок набирає за місяць стільки, скільки досвідчений ' +
            'за пів року.' +
          '</p>' +
          '<p class="small">' +
            'Конкретні числа стелі (' +
            Object.keys(AGE_LABEL).map(function (k) {
              return esc(AGE_LABEL[k]) + ' — ' + round(window.NutritionCalc.LEAN_CEILING[k], 2) + ' кг/міс';
            }).join(', ') +
            ') — <b>практична конвенція</b>. Досліджень, які вимірювали б максимальну ' +
            'швидкість набору сухої маси за стажем, немає. Тому поруч стоїть діапазон, ' +
            'а не одна цифра.' +
          '</p>' +
          '<p class="small">' +
            'Сама ідея стелі перевірена: у рандомізованому дослідженні на елітних спортсменах ' +
            'група з вищою калорійністю набрала втричі більше ваги, але приріст <b>сухої маси ' +
            'між групами не відрізнявся</b> — уся різниця пішла в жир.' +
          '</p>' +
          /*
           * Голих номерів більше немає.
           *
           * Раніше одразу після фрази «досліджень немає» стояли три PMID
           * без жодного пояснення, що саме кожне показало — тобто порушувалось
           * власне правило проєкту з research.html: «для кожного вказано,
           * що воно показало». Два з трьох не були описані ніде на сайті.
           */
          '<p class="small">' +
            '<b>Метаболічна адаптація.</b> Витрати на тривалому дефіциті падають ' +
            'сильніше, ніж пояснює сама втрата ваги: менше спонтанного руху, ' +
            'дешевша робота меншого тіла, нижчий тонус щитоподібної. Модель ' +
            'закладає близько −10% і виводить їх поступово за перші три місяці. ' +
            'Тому крива схуднення тут сама виходить на плато, а не падає прямою.' +
          '</p>' +
          '<p class="small mb-0">' +
            'Джерела: ' +
            '<a href="https://pubmed.ncbi.nlm.nih.gov/23679146/" target="_blank" rel="noopener">PMID 23679146</a>' +
            ' — Garthe та ін.: удвічі більший профіцит дав утричі більший набір ваги, ' +
            'але приріст сухої маси між групами не відрізнявся. ' +
            '<a href="https://pubmed.ncbi.nlm.nih.gov/28698222/" target="_blank" rel="noopener">PMID 28698222</a>' +
            ' — Morton та ін., мета-аналіз: приріст сухої маси від білка виходить ' +
            'на плато приблизно на 1,6 г на кг маси тіла.' +
          '</p>' +
        '</div></div></div>' +
      '</div>';
  }

  async function init() {
    if (!$('#nutri-out')) return;

    /*
     * МЕТИ — З ЯДРА, А НЕ З РОЗМІТКИ (TXT-003).
     *
     * У nutrition.html підписи були написані руками: «Набір маси» проти
     * «Набір мʼязової маси» і «Скидання» проти «Скидання ваги» в ядрі.
     * Та сама мета під двома назвами на сусідніх сторінках — і жодного
     * способу помітити розходження, крім читання очима. Сторінка «Акаунт»
     * уже бере підписи з NutritionCalc.GOALS; тепер і ця.
     *
     * Порядок фіксований: від набору до дефіциту, як було в розмітці.
     */
    const goalSeg = $('#n-goal-seg');
    if (goalSeg && !goalSeg.children.length) {
      const ORDER = ['bulk', 'bulkfast', 'recomp', 'maintain', 'cut', 'cutfast'];
      goalSeg.innerHTML = ORDER.filter(k => GOALS[k]).map(k =>
        '<label class="seg__item"><input type="radio" name="goal" value="' + k + '"' +
        (k === 'maintain' ? ' checked' : '') + '><span>' + esc(GOALS[k].label) + '</span></label>'
      ).join('');
    }

    // Заповнити список активності
    const act = $('#n-activity');
    if (act && !act.children.length) {
      act.innerHTML = Object.keys(ACTIVITY).map(k =>
        '<option value="' + k + '"' + (k === '1.55' ? ' selected' : '') + '>' +
          esc(ACTIVITY[k].label) +
        '</option>'
      ).join('');
    }

    // Підтягнути профіль
    try {
      const p = await window.Store.getProfile();
      if (p.trainingAge && AGE_LABEL[p.trainingAge]) trainingAge = p.trainingAge;
      if (p.sex) {
        const el = $$('input[name="sex"]').find(x => x.value === p.sex);
        if (el) el.checked = true;
      }
      if (p.age)     $('#n-age').value = p.age;
      if (p.height)  $('#n-height').value = p.height;
      if (p.weight)  $('#n-weight').value = p.weight;
      if (p.bodyfat) $('#n-bodyfat').value = p.bodyfat;
      if (p.activity && act) {
        act.value = p.activity;
        /* Значення поза списком не «не обирається» — воно робить select
           ПОРОЖНІМ, і далі parseFloat('') = NaN вбиває весь розрахунок.
           Старі й імпортовані профілі таке значення мати можуть, тож
           відкочуємось до помірної активності, а не до порожнечі. */
        if (!act.value) act.value = '1.55';
      }
      if (p.meals >= MEALS_MIN && p.meals <= MEALS_MAX) mealCount = p.meals;
    } catch (_) { /* профіль необовʼязковий */ }

    const update = () => {
      const i = readInput();
      render(i);
      renderForecast(i);
      window.App.initAccordions($('#nutri-forecast'));
    };

    $$('#nutri-form input, #nutri-form select').forEach(el => {
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });

    // Перемикач прийомів їжі живе всередині блоку результату й перемальовується
    // разом із ним, тому слухач вішається на контейнер, а не на самі радіо.
    $('#nutri-out').addEventListener('change', e => {
      const el = e.target.closest('input[name="meals"]');
      if (!el) return;
      mealCount = window.App.clamp(Number(el.value), MEALS_MIN, MEALS_MAX);
      update();
    });

    // Стаж зберігається одразу: він потрібен не лише тут, а й прогнозу
    // робочих ваг на сторінці «Мій план тренувань», і другого поля для нього немає.
    const fc = $('#nutri-forecast');
    if (fc) {
      fc.addEventListener('change', function (e) {
        if (e.target.name !== 'tage') return;
        trainingAge = e.target.value;
        window.Store.saveProfile({ trainingAge: trainingAge }).catch(function (e) { if (!(e && e.queued)) window.App.toast('Не збереглося: ' + e.message, 'err'); });
        update();
      });
    }

    const saveBtn = $('#n-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        const i = readInput();
        /*
         * Перевіряємо ПЕРЕД записом.
         *
         * min/max на <input type=number> не діють для набраного руками
         * значення, а readInput бере його як є. Вага 1000 чи вік 999
         * лягали в профіль, після чого NutritionCalc.targetFor() назавжди
         * повертав null — і «Сьогодні», «Раціон» та головна хором казали
         * «заповни зріст, вагу й вік», хоч на цій сторінці всі поля
         * виглядали заповненими. Знайти винне поле було нічим.
         */
        const bad = badFields(i);
        if (bad.length) { toast('Поза межами: ' + bad.join(', '), 'err'); return; }

        const done = window.App.busy(this, 'Зберігаю…');
        try {
          await window.Store.saveProfile({
            sex: i.sex, age: i.age, height: i.height,
            weight: i.weight, bodyfat: i.bodyfat,
            activity: i.activity, goal: i.goalKey, meals: i.meals
          });
          toast('Дані збережено' + (window.Store.user() ? '' : ' локально'), 'ok');
        } catch (e) {
          toast('Не збереглося: ' + e.message, 'err');
        } finally { done(); }
      });
    }

    update();
  }

  /* ------------------------------------------------------------------ */
  /* Експорт розрахунку для інших сторінок                               */
  /* ------------------------------------------------------------------ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
