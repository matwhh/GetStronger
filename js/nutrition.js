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
      Обгортка над спільним форматером — правило одне на весь Get Stronger
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
  /*
   * КІЛЬЦЕ МАКРОСІВ: три сектори й калорії в дучці.
   *
   * Той самий компонент, що в дні на «Харчуванні» (js/donut-core.js) —
   * і це не економія коду, а те, заради чого компонент виносився: план і
   * факт мають виглядати однаково, інакше порівняти їх оком неможливо.
   * Різниця лише в тому, ЩО ділиться: тут — ціль, там — з'їдене.
   *
   * Клас кольору спільний із маркерами в таблиці нижче (.macrobar__p і
   * далі): синє скрізь на сторінці має означати білок.
   */
  function macroRing(target, m, pP, pF, pC, pCarbOnly, pFib) {
    if (!window.Donut) return '';
    const KF = window.NutritionCalc.KCAL_FIBER;
    const g = function (v) { return round(v, 0); };
    const slices = [
      { label: 'Білок', value: pP, cls: 'donut__slice--p',
        title: 'Білок: ' + g(m.protein) + ' г · ' + g(m.protein * KCAL.protein) +
               ' ккал · ' + g(pP) + '% енергії' },
      { label: 'Жири', value: pF, cls: 'donut__slice--f',
        title: 'Жири: ' + g(m.fat) + ' г · ' + g(m.fat * KCAL.fat) +
               ' ккал · ' + g(pF) + '% енергії' },
      { label: 'Вуглеводи', value: pC, cls: 'donut__slice--c',
        title: 'Вуглеводи: ' + g(m.carb) + ' г + ' + g(m.fiber) + ' г клітковини · ' +
               g(m.carb * KCAL.carb + m.fiber * KF) + ' ккал · ' + g(pC) + '% енергії' }
    ];
    const grams = [m.protein, m.fat, m.carb];

    return '<div class="macro-ring mt-2">' +
      window.Donut.html({
        slices: slices,
        center: round(target, 0),
        sub: 'ккал на добу',
        label: 'Склад норми за енергією'
      }) +
      '<div class="macro-ring__side">' +
        '<ul class="macro-ring__legend">' +
          slices.map(function (s, i) {
            return '<li><i class="' + s.cls + '"></i>' +
              '<span class="macro-ring__name">' + esc(s.label) + '</span>' +
              '<b class="mono">' + g(s.value) + '%</b>' +
              '<span class="muted mono">' + g(grams[i]) + ' г</span>' +
            '</li>';
          }).join('') +
        '</ul>' +
        /*
         * Останнє речення — не багатослівність, а закриття питання, яке
         * інакше виникне. У таблиці нижче клітковина стоїть окремим
         * рядком зі своєю часткою, тож «Вуглеводи» там менші, ніж у
         * кільці. Два різні числа під одним словом на одному екрані
         * зобовʼязані пояснити самі себе — інакше далі не вірять жодному.
         */
        '<p class="small muted macro-ring__note">Частки — за енергією, а не за вагою: ' +
          'грам жиру несе 9 ккал, грам білка — 4. Клітковина (' + g(m.fiber) + ' г) ' +
          'порахована тут у вуглеводах; у таблиці нижче вона окремим рядком — ' +
          g(pCarbOnly) + '% плюс ' + g(pFib) + '% і дають ці ' + g(pC) + '%.</p>' +
      '</div>' +
    '</div>';
  }

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

  /*
   * ЖУРНАЛИ ПОТРІБНІ САМІЙ ЦІЛІ.
   *
   * Сторінка рахує від того, що в ПОЛЯХ, — і це правильно: людина
   * крутить вагу й активність, щоб подивитись «а якби». Але виміряне
   * підтримання береться не з полів, а з журналів їжі та зважувань,
   * тож вони їдуть у targetFor окремо від форми.
   */
  let logs = { bodyLog: null, mealLog: null, tdeeMode: null };

  /* Профіль для ядра — з полів форми плюс журнали. Одна функція на всі
     виклики targetFor цієї сторінки: два способи зібрати той самий
     обʼєкт розійшлись би, і сторінка показувала б числа з різних
     профілів поруч. */
  function profileOf(input, bodyfat) {
    const i = input || {};
    const L = window.NutritionCalc.LIMITS;
    const bf = bodyfat === undefined
      ? (Number.isFinite(i.bodyfat) && i.bodyfat >= L.bodyfat[0] && i.bodyfat <= L.bodyfat[1]
          ? i.bodyfat : null)
      : bodyfat;
    return {
      sex: i.sex === 'female' ? 'female' : 'male',
      weight: i.weight, height: i.height, age: i.age,
      bodyfat: bf,
      activity: i.activity, goal: i.goalKey,
      bodyLog: logs.bodyLog, mealLog: logs.mealLog, tdeeMode: logs.tdeeMode
    };
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
    const t = window.NutritionCalc.targetFor(profileOf(input, hasBF ? bodyfat : null));
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
    /*
     * ТРИ ЧАСТКИ, А НЕ ЧОТИРИ: клітковина всередині вуглеводів.
     *
     * Вона і є вуглевод — окремим рядком її тримає довідник продуктів,
     * бо засвоюється вона як 2 ккал/г, а не 4. Але в картині «з чого
     * складається доба» четвертий сектор перетворював КБЖВ на КБЖВК, і
     * найдрібніша частка (≈3%) з'їдала стільки ж уваги, скільки жири.
     *
     * Сума трьох часток рівно 100%: ядро гарантує, що макроси складаються
     * в ціль (див. macros у js/nutrition-core.js), а калорійність
     * клітковини вже відняте з вуглеводів — тож повертаючи її туди, ми
     * відновлюємо ту саму суму, а не додаємо зайве.
     */
    const kcalFiber = m.fiber * window.NutritionCalc.KCAL_FIBER;
    const pP = m.protein * KCAL.protein / target * 100;
    const pF = m.fat * KCAL.fat / target * 100;
    const pCarbOnly = m.carb * KCAL.carb / target * 100;
    const pFib = kcalFiber / target * 100;
    const pC = pCarbOnly + pFib;

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
        /*
         * Кільце замість смуги. Смуга відповідала на те саме питання, але
         * гірше: на 3% клітковини лишалась риска в два пікселі, а межі
         * між сегментами доводилось малювати лінією тла, бо сусідні
         * заливки не тримали 3:1 одна до одної. У кільці частки читаються
         * кутом, який не залежить від контрасту сусідів, а калорії стоять
         * у центрі — вони ж і є те ціле, яке ділиться.
         */
        macroRing(target, m, pP, pF, pC, pCarbOnly, pFib) +

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
              macroRow('Клітковина', m.fiber, window.NutritionCalc.KCAL_FIBER, target, 'macrobar__fib') +
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

    /* Розгортання кільця робиться ПІСЛЯ вставки: розмітка вже несе
       кінцеві сектори, тож без цього виклику діаграма просто стоїть
       намальованою (див. Donut.animate). */
    window.Donut && window.Donut.animate(out);
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
  /* Цільова вага. Живе тут, а не в readInput(): вона не бере участі в
     жодному розрахунку норми — лише відповідає на питання «коли». */
  let goalWeight = null;

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

  /* Профіль для прогнозу — в одному місці: його читають і малювання
     блока, і обробник цілі. Дві копії розійшлися б на першому ж полі. */
  function forecastProfile(input) {
    return {
      sex: input.sex, age: input.age, height: input.height,
      weight: input.weight, bodyfat: input.bodyfat,
      activity: input.activity, goal: input.goalKey,
      trainingAge: trainingAge
    };
  }

  /*
   * Строк у слова. МІСЯЦЬ І РІК, А НЕ КОНКРЕТНИЙ ДЕНЬ.
   *
   * Модель помиляється на ±10–15% уже в оцінці витрат, тож «17 березня»
   * було б вигаданою точністю: людина прочитала б це як обіцянку, якою
   * воно не є. Місяць — найдрібніша одиниця, за яку тут можна ручатись.
   */
  function etaLabel(months) {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(months * 30.44));
    const M = window.DateCore.MONTHS_NOM[d.getMonth()].toLowerCase();
    const whole = Math.round(months);
    const word = whole === 1 ? 'місяць' : (whole < 5 ? 'місяці' : 'місяців');
    return months < 0.5
      ? 'цього місяця'
      : M + ' ' + d.getFullYear() + ' — приблизно ' + whole + ' ' + word;
  }

  /** Рядок під полем цілі: або строк, або чому строку немає. */
  function etaHint(profile) {
    if (goalWeight === null) {
      return 'Впишіть ціль — і побачите, коли за цією нормою до неї дійдете.';
    }
    const e = window.NutritionCalc.etaToWeight(profile, goalWeight);
    if (!e.reachable) {
      /* Причина, а не «недосяжно». «Недосяжно» без причини читається як
         поломка сторінки, а не як відповідь моделі. */
      return 'До ' + round(goalWeight, 1) + ' кг за цією нормою не дійдете: ' + e.reason + '.';
    }
    if (e.months === 0) return 'Ви вже на цій вазі.';
    return 'До ' + round(goalWeight, 1) + ' кг — ' + etaLabel(e.months) + '.';
  }

  /* ------------------------------------------------------------------ */
  /* Виміряні витрати                                                    */
  /* ------------------------------------------------------------------ */
  /*
   * Картка існує тільки тоді, коли є що показати: або вимірювання
   * вийшло, або воно майже вийшло і людині варто знати, чого бракує.
   * Порожня картка «увімкніть і ведіть журнали» на сторінці, де людина
   * просто рахує норму, — це докір ні за що.
   */
  const TDEE_CONF = {
    high: 'дані повні',
    mid: 'даних достатньо',
    low: 'даних обмаль'
  };

  function renderTdee(input) {
    const host = $('#nutri-tdee');
    if (!host || !window.TdeeCore) return;

    const T = window.TdeeCore;
    const m = T.measure(logs.bodyLog, logs.mealLog, 28)
           || T.measure(logs.bodyLog, logs.mealLog, T.MIN_DAYS);
    const on = logs.tdeeMode === 'measured';

    if (!m) {
      /* Нічого не виміряли. Кажемо про це лише тим, хто вже щось веде:
         для решти це просто зайвий шум на сторінці калькулятора. */
      const days = Object.keys(logs.mealLog || {}).length;
      host.innerHTML = days
        ? '<div class="card mt-3">' +
            '<h2 style="margin-top:0">Виміряні витрати</h2>' +
            '<p class="small muted mb-0">Щоб виміряти підтримання по факту, ' +
              'потрібні два тижні: закриті дні харчування (щонайменше сім із десяти) ' +
              'і зважування на початку й наприкінці. Поки їх немає, ціль рахується ' +
              'за формулою — і це нормально, у перші тижні інакше й не буває.</p>' +
          '</div>'
        : '';
      return;
    }

    /* Формульне число беремо з того ж ядра й тих самих полів — інакше
       на екрані стояли б два числа з різних джерел, і різниця між ними
       нічого б не означала. */
    const ft = window.NutritionCalc.targetFor(profileOf(input));
    const formula = ft ? Math.round(ft.formulaTdee) : 0;

    host.innerHTML =
      '<div class="card mt-3">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Виміряні витрати</h2>' +
          '<span class="small muted">' + m.days + ' днів · ' +
            esc(TDEE_CONF[m.confidence] || '') + '</span>' +
        '</div>' +
        '<div class="kpis mt-2">' +
          '<div class="kpi"><div class="kpi__val mono">' + fmtNum.kcal(m.kcal) + '</div>' +
            '<p class="kpi__lbl">підтримання, ккал</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + fmtNum.kcal(m.lo) + '–' + fmtNum.kcal(m.hi) + '</div>' +
            '<p class="kpi__lbl">смуга</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + fmtNum.kcal(m.intake) + '</div>' +
            '<p class="kpi__lbl">їли в середньому</p></div>' +
          /* fmtNum.signed, а не рядок із мінусом з клавіатури: знак у
             проєкті — типографський «−», і два способи його писати
             розійдуться на першій же правці. */
          '<div class="kpi"><div class="kpi__val mono">' +
            fmtNum.signed(m.deltaKg, 2) + '</div>' +
            '<p class="kpi__lbl">зміна ваги, кг</p></div>' +
        '</div>' +
        (formula > 0
          ? '<p class="small mt-2 mb-0">Формула на цих даних дає <b>' + fmtNum.kcal(formula) +
            '</b> — різниця ' + fmtNum.signed(m.kcal - formula, 0) +
            ' ккал. Формула описує середню людину; вимірювання — вас.</p>'
          : '') +
        '<label class="check mt-2" style="width:100%;box-sizing:border-box">' +
          '<input type="checkbox" data-tdee-mode' + (on ? ' checked' : '') + '>' +
          '<span>Рахувати ціль від виміряних витрат</span>' +
        '</label>' +
        '<p class="small muted mb-0" style="margin-top:10px">' +
          'Підтримання = середнє спожите мінус зміна ваги, переведена в калорії ' +
          '(1 кг ≈ 7700). Зміна береться між середніми за перший і останній тиждень, ' +
          'а не між двома ранками: денна вага гуляє на кілограм від води й солі. ' +
          'Смуга — це чесна похибка такого вимірювання, і на коротшому вікні вона ширша. ' +
          'Вимкнете перемикач — ціль одразу повернеться до формули.' +
        '</p>' +
      '</div>';
  }

  function renderForecast(input) {
    const host = $('#nutri-forecast');
    if (!host) return;

    const profile = forecastProfile(input);

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

        '<div class="field mt-3">' +
          '<label class="field__label" for="n-goalw">Цільова вага, кг</label>' +
          '<input class="input" id="n-goalw" name="goalw" type="text" inputmode="decimal" ' +
            'min="30" max="300" step="0.1" placeholder="напр. 78"' +
            (goalWeight === null ? '' : ' value="' + round(goalWeight, 1) + '"') + '>' +
          '<span class="field__hint">' + esc(etaHint(profile)) + '</span>' +
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
      if (Number.isFinite(Number(p.goalWeight)) && Number(p.goalWeight) > 0) {
        goalWeight = Number(p.goalWeight);
      }
      /*
       * МЕТА ВІДНОВЛЮЄТЬСЯ З ПРОФІЛЮ.
       *
       * Сторінка мету ЗБЕРІГАЛА (saveProfile → goal: i.goalKey), а при
       * відкритті ставила «Підтримання» — воно жорстко позначене в
       * розмітці перемикача. Тобто людина обирала «Скидання», поверталась
       * назавтра й бачила чужу норму, не розуміючи, чому вона змінилась.
       *
       * Знайдено браузерною перевіркою дати фінішу: строк щоразу виходив
       * «за цим режимом вага стоїть», бо режимом за замовчуванням було
       * підтримання, а не те, що людина обрала.
       */
      if (p.goal && GOALS[p.goal]) {
        const g = $$('#n-goal-seg input[name="goal"]').find(x => x.value === p.goal);
        if (g) g.checked = true;
      }
      if (p.activity && act) {
        act.value = p.activity;
        /* Значення поза списком не «не обирається» — воно робить select
           ПОРОЖНІМ, і далі parseFloat('') = NaN вбиває весь розрахунок.
           Старі й імпортовані профілі таке значення мати можуть, тож
           відкочуємось до помірної активності, а не до порожнечі. */
        if (!act.value) act.value = '1.55';
      }
      if (p.meals >= MEALS_MIN && p.meals <= MEALS_MAX) mealCount = p.meals;
      logs = {
        bodyLog: p.bodyLog || null,
        mealLog: p.mealLog || null,
        tdeeMode: p.tdeeMode === 'measured' ? 'measured' : null
      };
    } catch (_) { /* профіль необовʼязковий */ }

    const update = () => {
      const i = readInput();
      render(i);
      renderTdee(i);
      renderForecast(i);
      window.App.initAccordions($('#nutri-forecast'));
    };

    /* Перемикач режиму витрат. Зберігаємо й перемальовуємо все: ціль
       міняється зараз, а не «з наступного відкриття». */
    const tdeeHost = $('#nutri-tdee');
    if (tdeeHost) {
      tdeeHost.addEventListener('change', async function (e) {
        const box = e.target.closest('[data-tdee-mode]');
        if (!box) return;
        /* Вимкнено пишемо як null: «вимкнув» і «не чіпав» — одне й те
           саме, а рядок 'formula' у профілі зробив би порожній браузер
           «непорожнім» (js/store.js, isMeaningful). */
        logs.tdeeMode = box.checked ? 'measured' : null;
        try {
          await window.Store.saveProfile({ tdeeMode: logs.tdeeMode });
          window.App.toast(box.checked
            ? 'Ціль рахується від виміряних витрат'
            : 'Ціль рахується за формулою', 'ok');
        } catch (err) {
          window.App.toast(err.queued ? err.message : 'Не збереглося: ' + err.message,
            err.queued ? 'ok' : 'err');
        }
        update();
      });
    }

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
        if (e.target.name === 'goalw') {
          /* Саме change, а не input: renderForecast перемальовує блок
             цілком, і на кожному натисканні клавіші поле втрачало б фокус. */
          const raw = String(e.target.value || '').replace(',', '.').trim();
          const v = Number(raw);
          const L = window.NutritionCalc.LIMITS.weight;
          if (raw === '') {
            goalWeight = null;
          } else if (!Number.isFinite(v) || v < L[0] || v > L[1]) {
            window.App.toast('Цільова вага: від ' + L[0] + ' до ' + L[1] + ' кг', 'err');
            return;
          } else {
            goalWeight = v;
          }
          window.Store.saveProfile({ goalWeight: goalWeight }).catch(function (err) {
            if (!(err && err.queued)) window.App.toast('Не збереглося: ' + err.message, 'err');
          });
          /*
           * ОНОВЛЮЄМО ЛИШЕ ПІДКАЗКУ, А НЕ ВЕСЬ БЛОК.
           *
           * update() перемальовує #nutri-forecast через innerHTML — разом
           * із полем, у якому щойно сталася подія. Браузер кидає на цьому
           * «The node to be removed is no longer a child of this node»:
           * change прилітає з blur, і вузол зникає посеред обробки.
           *
           * Але й без помилки перемальовувати було б нема чого: від цілі
           * не залежить жодне інше число на екрані — ні норма, ні прогноз.
           * Міняється рівно один рядок, його й міняємо.
           */
          const hint = e.target.parentElement
            && e.target.parentElement.querySelector('.field__hint');
          if (hint) hint.textContent = etaHint(forecastProfile(readInput()));
          return;
        }
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
