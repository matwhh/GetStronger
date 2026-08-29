/**
 * Прогноз робочих ваг на 6 / 12 / 24 місяці.
 *
 * ============================ ЧЕСНО ПРО МОДЕЛЬ ============================
 *
 * Це НЕ прогноз у науковому сенсі. Це арифметика на припущеннях, які
 * видно на екрані й можна змінити. Дослідження, яке дозволяло б передбачити
 * ріст робочої ваги конкретної людини на рік уперед, не існує — ані в PubMed,
 * ані деінде. Розкид індивідуальних відповідей на однакову програму
 * у дослідженнях більший за середній ефект самої програми.
 *
 * Що тут закладено і звідки воно:
 *
 * 1. ФОРМА КРИВОЇ — логарифмічна:
 *
 *        w(t) = w0 × (1 + g × T × ln(1 + t/T))
 *
 *    Приріст сповільнюється з часом, але ніколи не зупиняється остаточно.
 *    Це класична «крива навчання», і вона якісно збігається з тим, що
 *    новачок додає швидко, а досвідчений — повільно. Сама ФОРМА обґрунтована;
 *    конкретні КОЕФІЦІЄНТИ — ні.
 *
 *    Чому не пряма: подвійна прогресія «+2,5 кг кожні 3 тижні» в лінійному
 *    вигляді дає +43 кг за рік і +217 кг за пʼять. Сайт показує цю пряму
 *    поруч — саме щоб було видно, що вона неможлива.
 *
 *    Чому не насичена експонента: вона має жорстку стелю, після якої приріст
 *    рівно нуль. Це теж неправда — люди прогресують десятиліттями, просто
 *    дедалі повільніше.
 *
 * 2. КОЕФІЦІЄНТ g (початковий місячний приріст) — ПРАКТИЧНА КОНВЕНЦІЯ,
 *    не висновок дослідження. Взятий за стажем силових тренувань.
 *    Ці числа можна і варто підправляти під власну історію.
 *
 * 3. T = 12 місяців — характерний час сповільнення. Теж конвенція.
 *
 * 4. СЦЕНАРІЇ — просто множник до g: 0,6× / 1,0× / 1,5×. Вони показують
 *    чутливість результату до припущення, а не «ймовірність».
 *
 * Чого модель не враховує взагалі: травми, перерви, сон, стрес, дефіцит
 * калорій (на ньому сила росте гірше), зміну техніки, зміну власної ваги,
 * стелю конкретної вправи, вік і генетику.
 * ==========================================================================
 */
(function () {
  'use strict';

  const { $, $$, esc, round, toast } = window.App;

  /* ------------------------------------------------------------------ */
  /* Параметри моделі                                                    */
  /* ------------------------------------------------------------------ */

  /** Характерний час сповільнення, місяців */
  const TAU = 12;

  /**
   * Початковий місячний відносний приріст робочої ваги за стажем.
   * ПРАКТИЧНА КОНВЕНЦІЯ. Жодне дослідження цих чисел не називає.
   */
  const TIERS = [
    { id: 'novice', label: 'До 1 року',   g: 0.030, note: 'приріст найшвидший і найменш передбачуваний' },
    { id: 'inter',  label: '1–2 роки',    g: 0.015, note: 'типовий «середняк»: прогрес є, але вже за роботу' },
    { id: 'adv',    label: '3–5 років',   g: 0.008, note: 'приріст помітний на горизонті кварталу, не тижня' },
    { id: 'elite',  label: 'Понад 5 років', g: 0.004, note: 'кілька кілограмів на рік — це вже добрий рік' }
  ];

  const SCENARIOS = [
    { id: 'low',  label: 'Обережний', mult: 0.6 },
    { id: 'mid',  label: 'Базовий',   mult: 1.0 },
    { id: 'high', label: 'Вдалий',    mult: 1.5 }
  ];

  /** Горизонти прогнозу, місяців */
  const HORIZONS = [6, 12, 24];

  /** Крок млинців: реальна вага завжди квантована */
  const PLATE_STEP = 2.5;

  /* ------------------------------------------------------------------ */
  /* Математика                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Відносний приріст за t місяців.
   * @param {number} t місяців від старту
   * @param {number} g початковий місячний приріст (частка)
   * @returns {number} частка приросту, напр. 0.25 = +25%
   */
  function growth(t, g) {
    const months = Number(t);
    const rate = Number(g);
    if (!Number.isFinite(months) || !Number.isFinite(rate) || months <= 0) return 0;
    const v = rate * TAU * Math.log(1 + months / TAU);
    return Number.isFinite(v) ? v : 0;
  }

  /**
   * Прогнозована вага, округлена до кроку, ДОРЕЧНОГО для цієї ваги.
   *
   * Раніше тут стояв єдиний PLATE_STEP = 2,5 кг для всіх вправ без винятку —
   * при тому що решта проєкту цей крок давно розділяє (periodization-core,
   * stepFor: від 20 кг — млинці, нижче — 1 кг), і README це обґрунтовує:
   * «на махах з 10 кг крок був би чвертю ваги». Прогноз про це не знав, і
   * виходили рядки на кшталт «махи 8 кг за пів року -> 7,5», тобто прогноз
   * РОСТУ показував падіння. Гірше: вправа на 10 кг за рік давала «10 +0»
   * поруч із легендою «Базовий +13% за рік» на тому ж екрані.
   */
  function project(w0, t, g) {
    // Вага приходить із книги ваг, яку можна відредагувати в localStorage
    // повз усі поля вводу, — тому межа тут, а не лише у формі
    const base = Number(w0);
    if (!Number.isFinite(base) || base <= 0) return 0;
    const raw = Math.min(base, 500) * (1 + growth(t, g));
    if (!Number.isFinite(raw)) return 0;

    const step = stepForWeight(base);
    const out = Math.round(raw / step) * step;

    // Прогноз росту не має показувати падіння навіть після округлення вниз.
    return Math.max(out, base);
  }

  /**
   * Крок округлення за вагою — те саме правило, що в періодизації.
   * Дублюємо його тут лише тому, що periodization-core не завантажується
   * на цій сторінці; значення 20 кг і кроки мають лишатись однаковими.
   */
  function stepForWeight(weight) {
    return weight >= 20 ? PLATE_STEP : 1;
  }

  /** Лінійна прогресія без сповільнення — для перевірки реальністю */
  function naive(w0, t, stepKg, weeksPerStep) {
    const stepsPerMonth = (365 / 12 / 7) / weeksPerStep;
    return w0 + stepKg * stepsPerMonth * t;
  }

  /* ------------------------------------------------------------------ */
  /* Дані з плану                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Унікальні вправи з заданою вагою.
   * Одна вправа може стояти в кількох днях — беремо найбільшу вагу,
   * бо саме вона є робочою межею, а не найлегший із варіантів.
   */
  function liftsOf(plan) {
    const map = new Map();
    (plan || []).forEach(function (day) {
      (day.exercises || []).forEach(function (ex) {
        const w = Number(ex.weight);
        if (!ex.name || !Number.isFinite(w) || w <= 0) return;
        const prev = map.get(ex.name);
        if (!prev || w > prev.weight) map.set(ex.name, { name: ex.name, weight: w });
      });
    });
    return Array.from(map.values()).sort(function (a, b) { return b.weight - a.weight; });
  }

  /** Скільки вправ у плані взагалі й скільки з них із вагою */
  function coverage(plan) {
    const all = new Set();
    const filled = new Set();
    (plan || []).forEach(function (day) {
      (day.exercises || []).forEach(function (ex) {
        if (!ex.name) return;
        all.add(ex.name);
        const w = Number(ex.weight);
        if (Number.isFinite(w) && w > 0) filled.add(ex.name);
      });
    });
    return { total: all.size, filled: filled.size };
  }

  /* ------------------------------------------------------------------ */
  /* Графік                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Крива відсоткового приросту. Вона однакова для всіх вправ, бо модель
   * відносна: 100 кг і 20 кг ростуть на однаковий відсоток. Тому графік
   * один, а не по графіку на вправу.
   */
  function chart(g) {
    const W = 640, H = 240, PAD_L = 44, PAD_B = 28, PAD_T = 12, PAD_R = 12;
    const months = 24;
    const maxPct = Math.max(0.10, growth(months, g * 1.5) * 1.08);

    const x = function (t) { return PAD_L + (t / months) * (W - PAD_L - PAD_R); };
    const y = function (p) { return H - PAD_B - (p / maxPct) * (H - PAD_B - PAD_T); };

    const line = function (mult, cls) {
      const pts = [];
      for (let t = 0; t <= months; t += 0.5) {
        pts.push(x(t).toFixed(1) + ',' + y(growth(t, g * mult)).toFixed(1));
      }
      return '<polyline class="' + cls + '" points="' + pts.join(' ') + '"/>';
    };

    // Сітка по осі Y
    const steps = 4;
    let grid = '';
    for (let i = 0; i <= steps; i++) {
      const p = maxPct * i / steps;
      grid +=
        '<line class="pj-grid" x1="' + PAD_L + '" x2="' + (W - PAD_R) + '" y1="' + y(p) + '" y2="' + y(p) + '"/>' +
        '<text class="pj-tick" x="' + (PAD_L - 8) + '" y="' + (y(p) + 4) + '" text-anchor="end">+' +
          Math.round(p * 100) + '%</text>';
    }

    // Позначки горизонтів
    let marks = '';
    HORIZONS.forEach(function (t) {
      marks +=
        '<line class="pj-mark" x1="' + x(t) + '" x2="' + x(t) + '" y1="' + PAD_T + '" y2="' + (H - PAD_B) + '"/>' +
        '<text class="pj-tick" x="' + x(t) + '" y="' + (H - PAD_B + 18) + '" text-anchor="middle">' + t + ' міс</text>';
    });

    return '' +
      '<div class="pj-chart mt-2">' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
             'aria-label="Криві відсоткового приросту робочої ваги за трьома сценаріями на 24 місяці">' +
          grid + marks +
          line(1.5, 'pj-line pj-line--high') +
          line(1.0, 'pj-line pj-line--mid') +
          line(0.6, 'pj-line pj-line--low') +
        '</svg>' +
        '<div class="pj-legend">' +
          SCENARIOS.slice().reverse().map(function (sc) {
            return '<span class="pj-key pj-key--' + sc.id + '">' + esc(sc.label) +
                   ' <span class="mono muted">+' + Math.round(growth(12, g * sc.mult) * 100) + '% за рік</span></span>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Рендер                                                              */
  /* ------------------------------------------------------------------ */

  const state = { tier: 'inter' };

  function tierObj() {
    return TIERS.find(function (t) { return t.id === state.tier; }) || TIERS[1];
  }

  function tierPicker() {
    return '' +
      '<div class="field">' +
        '<label class="field__label">Скільки часу тренуєтесь з залізом</label>' +
        '<div class="seg">' +
          TIERS.map(function (t) {
            return '<label class="seg__item">' +
              '<input type="radio" name="tier" value="' + t.id + '"' +
                (t.id === state.tier ? ' checked' : '') + '>' +
              '<span>' + esc(t.label) + '</span>' +
            '</label>';
          }).join('') +
        '</div>' +
        '<span class="field__hint">' + esc(tierObj().note) + '. ' +
          'Це єдине, що керує швидкістю кривої.</span>' +
      '</div>';
  }

  function table(lifts, g) {
    const head = HORIZONS.map(function (t) {
      return '<th class="num">' + t + ' міс</th>';
    }).join('');

    const rows = lifts.map(function (l) {
      const cells = HORIZONS.map(function (t) {
        const w = project(l.weight, t, g);
        const d = w - l.weight;
        // Знак рахується, а не захардкоджений: раніше тут стояло ' +' завжди,
        // і від\u02bcємна дельта друкувалась як «+−0,5».
        const sign = d > 0 ? '+' : '';
        return '<td class="num mono">' + round(w, 1) +
               '<span class="muted small"> ' + sign + round(d, 1) + '</span></td>';
      }).join('');
      return '<tr><td>' + esc(l.name) + '</td>' +
             '<td class="num mono"><b>' + round(l.weight, 1) + '</b></td>' + cells + '</tr>';
    }).join('');

    return '' +
      '<div class="table-wrap mt-2">' +
        '<table class="tbl">' +
          '<thead><tr><th>Вправа</th><th class="num">Зараз</th>' + head + '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<p class="small muted mt-1">' +
        'Сценарій «Базовий», округлено до ' + String(PLATE_STEP).replace('.', ',') + ' кг ' +
        '(для ваг до 20 кг — до 1 кг: на махах крок у 2,5 кг був би чвертю ваги) — ' +
        'дрібніших кроків на штанзі зазвичай і не буває.' +
      '</p>';
  }

  function realityCheck(lifts) {
    if (!lifts.length) return '';
    const l = lifts[0];
    const y1 = naive(l.weight, 12, PLATE_STEP, 3);
    const y5 = naive(l.weight, 60, PLATE_STEP, 3);

    return '' +
      '<div class="notice mt-3">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
        '<div class="small">' +
          '<b>Перевірка реальністю.</b> Якщо вірити, що подвійна прогресія працює вічно — ' +
          '+' + String(PLATE_STEP).replace('.', ',') + ' кг кожні 3 тижні без жодного сповільнення — ' +
          'то <b>' + esc(l.name) + '</b> зі своїх ' + round(l.weight, 1) + ' кг стає ' +
          '<b>' + round(y1, 0) + ' кг через рік</b> і <b>' + round(y5, 0) + ' кг через пʼять</b>. ' +
          'Друге число — за межами світових рекордів у більшості вправ. ' +
          'Саме тому крива вище загинається, а не йде прямою.' +
        '</div>' +
      '</div>';
  }

  function limits() {
    return '' +
      '<div class="acc mt-3">' +
        '<button class="acc__head" type="button" aria-expanded="false">' +
          '<span class="chip chip--warn">Межі</span>' +
          '<span><h3>Чому це модель, а не прогноз</h3></span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          '<p class="small">' +
            'Дослідження, яке дозволяло б передбачити ріст робочої ваги конкретної людини ' +
            'на рік уперед, не існує. У розділі «Дослідження» кожна цифра має PMID — ' +
            '<b>у цієї сторінки PMID немає й бути не може</b>, і це навмисно сказано вголос.' +
          '</p>' +
          '<p class="small">Обґрунтоване тут тільки одне — <b>форма кривої</b>:</p>' +
          '<ul class="small list-note">' +
            '<li>приріст сповільнюється з часом, але не зупиняється — це логарифм, а не пряма й не стеля;</li>' +
            '<li>новачок додає швидше за досвідченого — тому єдиний перемикач тут це стаж.</li>' +
          '</ul>' +
          '<p class="small">' +
            'Конкретні коефіцієнти (' + TIERS.map(function (t) {
              return esc(t.label) + ' — ' + round(t.g * 100, 1) + '%/міс';
            }).join(', ') + ') — <b>практична конвенція</b>. ' +
            'Характерний час сповільнення T = ' + TAU + ' міс — теж. ' +
            'Три сценарії це просто множник 0,6× / 1× / 1,5× до одного й того ж числа: ' +
            'вони показують, наскільки результат чутливий до припущення, а не «ймовірність».' +
          '</p>' +
          '<p class="small">Модель не враховує взагалі нічого з цього:</p>' +
          '<ul class="small list-note">' +
            '<li>травми й перерви — один місяць пропуску зʼїдає кілька місяців кривої;</li>' +
            '<li>сон і стрес;</li>' +
            '<li>дефіцит калорій — на ньому сила росте гірше, а часто просто стоїть;</li>' +
            '<li>зміну власної ваги: +10 кг маси тіла самі по собі піднімають робочі ваги;</li>' +
            '<li>зміну техніки й глибини — те саме число на штанзі може означати іншу роботу;</li>' +
            '<li>стелю конкретної вправи, вік, генетику.</li>' +
          '</ul>' +
          '<p class="small mb-0">' +
            'Як цим користуватись по-людськи: дивитись не на число через рік, а на <b>порядок величини</b> ' +
            'і на те, наскільки різні сценарії розходяться. Якщо факт іде нижче «обережного» ' +
            'сценарію кілька місяців поспіль — питання не до моделі, а до сну, їжі або обʼєму.' +
          '</p>' +
        '</div></div></div>' +
      '</div>';
  }

  function render() {
    const host = $('#projection');
    if (!host) return;

    const cur = (window.PlanEngine && window.PlanEngine.current()) || {};
    if (!cur.plan) { host.innerHTML = ''; return; }

    const cov = coverage(cur.plan);
    const lifts = liftsOf(cur.plan);
    const g = tierObj().g;

    if (!lifts.length) {
      host.innerHTML =
        '<div class="card">' +
          '<h2 style="margin-top:0">Прогноз</h2>' +
          '<div class="notice">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
            '<div>Спершу заповніть робочі ваги в плані вище — хоч в одній вправі. ' +
            'Рахувати приріст немає від чого.</div>' +
          '</div>' +
        '</div>';
      return;
    }

    host.innerHTML =
      '<div class="card">' +
        '<div class="row row--split">' +
          '<h2 style="margin:0">Прогноз робочих ваг</h2>' +
          '<span class="chip chip--warn">модель, не дослідження</span>' +
        '</div>' +
        '<p class="small muted mt-1">' +
          'Порахований для <b>' + cov.filled + '</b> ' +
          (cov.filled === 1 ? 'вправи' : 'вправ') + ' із ' + cov.total + ', де задано вагу.' +
          (cov.filled < cov.total
            ? ' Решта зʼявиться тут, щойно впишете їм вагу.'
            : '') +
        '</p>' +

        '<div class="mt-3">' + tierPicker() + '</div>' +
        chart(g) +
        table(lifts, g) +
        realityCheck(lifts) +
        limits() +
      '</div>';
  }

  /* ------------------------------------------------------------------ */

  async function init() {
    if (!$('#projection')) return;

    try {
      const p = await window.Store.getProfile();
      if (p && p.trainingAge && TIERS.some(function (t) { return t.id === p.trainingAge; })) {
        state.tier = p.trainingAge;
      }
    } catch (_) { /* профіль необовʼязковий */ }

    // План рендериться асинхронно в programs.js — чекаємо на його сигнал
    document.addEventListener('plan:change', render);

    $('#projection').addEventListener('change', function (e) {
      const el = e.target.closest('input[name="tier"]');
      if (!el) return;
      state.tier = el.value;
      window.Store.saveProfile({ trainingAge: state.tier }).catch(function (e) { if (!(e && e.queued)) window.App.toast('Не збереглося: ' + e.message, 'err'); });
      render();
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
