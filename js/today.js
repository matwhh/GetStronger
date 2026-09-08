/**
 * «Сьогодні» — головна Forge.
 *
 * ЩО ТУТ Є І ЧОМУ ТАК МАЛО.
 *
 * Сторінку перебрано з нуля на вимогу власника: усе, що було раніше
 * (картка-вхід у тренування, залишок калорій, плитки стану, сезонна
 * картка з рейтингом, блок прогресу), прибрано. Лишились рівно дві
 * речі — назва програми з номером сезону і смуга тижня, з якої видно,
 * на якому ти дні. Це навмисно проміжний стан: екран доробляється далі,
 * і додавати сюди щось «поки що» — означає домальовувати те, про що ще
 * не домовились.
 *
 * ЗВІДКИ ЧИСЛА.
 *
 * Сезон — js/season-core.js, той самий, за яким живе вся аналітика.
 * Тиждень 1 — календарний тиждень (Пн→Нд), у якому сезон почався: увесь
 * проєкт рахує тижні від понеділка (теплокарта, календар історії,
 * adherence), і заводити тут власний відлік означало б, що два екрани
 * називають «тижнем» різні сім днів.
 *
 * Тренувальні дні тижня — з активного плану: у плані N днів на тиждень,
 * тож перші N слотів тижня тренувальні, решта — відпочинок. Це те, що
 * ЗАРАЗ є в даних: прив'язки тренувань до конкретних днів тижня Forge не
 * зберігає, і вигадувати її тут (умовно Пн/Ср/Пт) означало б показати
 * розклад, якого насправді немає.
 *
 * Тут НІЧОГО не редагується й нікуди не веде: смуга — індикатор, а не
 * навігація.
 */
(function () {
  'use strict';

  const { $, esc } = window.App;
  const WC = window.WorkoutCore;

  const state = {
    profile: {},
    program: null,
    plan: null,
    todayKey: '',
    week: 1,      // який тиждень показано
    weekNow: 1    // який тиждень іде насправді
  };

  /* ------------------------------------------------------------------ */
  /* Дати                                                                */
  /* ------------------------------------------------------------------ */

  function keyOf(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function localDateKey() { return keyOf(new Date()); }

  /** Понеділок тижня, у якому лежить дата. Пн = 0, Нд = 6. */
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  /** Індекс дня в тижні: Пн = 0 … Нд = 6. */
  function dowIndex(d) { return (d.getDay() + 6) % 7; }

  /**
   * Номер тижня сезону для дати. 1 — тиждень, у якому сезон почався.
   * null — сезону ще немає (дата раніша за старт першого періоду).
   */
  function weekNoOf(date, season) {
    if (!season) return null;
    const p = String(season.start).split('-');
    const base = mondayOf(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    const here = mondayOf(date);
    /* Різниця в добах, а не в мілісекундах: перехід на зимовий час робить
       тиждень 169-годинним, і ділення мілісекунд дало б 0.99 тижня. */
    const days = Math.round((here - base) / 86400000);
    return Math.floor(days / 7) + 1;
  }

  /* ------------------------------------------------------------------ */
  /* Рендер                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * ЗНАЧОК ВІДПОЧИНКУ — готовий файл власника (rest-icon.svg), вставлений
   * як є: серп плюс дві «z» різного розміру, усе заливкою currentColor.
   *
   * Вбудований у розмітку, а не <img src>: значок має брати колір від
   * дня (поточний день світліший за решту), а зовнішня картинка кольору
   * не успадковує. Заразом це на один мережевий запит менше.
   */
  const MOON =
    '<svg class="tdy-day__moon" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<g fill="currentColor">' +
        /* серп */
        '<path d="M26.50 3.25A21.86 21.86 0 1 0 44.41 21.10A14.37 14.37 0 1 1 26.50 3.25Z"/>' +
        /* велика Z */
        '<path d="M35.02 1.34H47.00L42.01 10.33H47.00V13.32H35.02L40.01 4.33H35.02Z"/>' +
        /* мала z */
        '<path d="M25.04 14.31H35.02L32.03 21.30H35.02V24.29H25.04L28.03 17.30H25.04Z"/>' +
      '</g>' +
    '</svg>';

  function headHtml() {
    const SC = window.SeasonCore;
    const season = SC && SC.current ? SC.current() : null;

    if (!state.program) {
      return '' +
        '<h1 class="tdy-title">Програму не обрано</h1>' +
        '<p class="tdy-sub"><a href="programs.html">Обрати програму тренувань</a></p>';
    }
    return '' +
      '<h1 class="tdy-title">' + esc(state.program.name) + '</h1>' +
      (season ? '<p class="tdy-sub">Сезон ' + season.id + '</p>' : '');
  }

  /**
   * Розклад тижня: 7 слотів, число — індекс дня в плані, 'rest' —
   * відпочинок.
   *
   * ЦЕ ДАНІ ПРОГРАМИ, А НЕ ВИГАДКА ЦІЄЇ СТОРІНКИ. У js/programs-data.js
   * у кожної програми є schedule на кожен варіант по днях: у fullbody на
   * 3 дні це [0,'rest',1,'rest',2,'rest','rest'] — тобто тренування через
   * день, а не три поспіль. Той самий розклад показує «Плани тренувань»
   * (js/programs.js → weekSchedule), тож два екрани не можуть розійтись.
   *
   * Запасний варіант — усі дні поспіль, і він теж не вигаданий: рівно так
   * робить weekSchedule, коли в програми розкладу немає.
   */
  function weekSchedule() {
    const plan = state.plan;
    if (!plan) return [];
    const days = String(plan.length);
    const sch = (state.program && state.program.schedule || {})[days];
    if (Array.isArray(sch) && sch.length === 7) return sch;
    const out = [];
    for (let i = 0; i < 7; i++) out.push(i < plan.length ? i : 'rest');
    return out;
  }

  function weekHtml() {
    /* Без плану смуга однаково малюється: вона показує, який сьогодні
       день тижня, і це правда незалежно від того, чи обрано програму. */
    const sch = weekSchedule();
    const isNow = state.week === state.weekNow;
    const todaySlot = dowIndex(new Date());

    let days = '';
    for (let i = 0; i < 7; i++) {
      const rest = sch.length ? sch[i] === 'rest' : false;
      const here = isNow && i === todaySlot;
      days +=
        '<div class="tdy-day' + (rest ? ' is-rest' : '') + (here ? ' is-now' : '') + '"' +
            (here ? ' aria-current="date"' : '') + '>' +
          '<span class="tdy-day__dot" aria-hidden="true"></span>' +
          /* Підписаний ЛИШЕ відпочинок. Решта днів — самі числа: слово
             «ДЕНЬ» сім разів поспіль нічого не розрізняє, а місце під
             підпис забирає в цифри, які й є змістом смуги. */
          '<span class="tdy-day__lbl">' + (rest ? 'REST' : '') + '</span>' +
          '<span class="tdy-day__val">' + (rest ? MOON : (i + 1)) + '</span>' +
        '</div>';
    }

    return '' +
      '<div class="tdy-week">' +
        '<div class="tdy-week__nav">' +
          '<button class="icon-btn" type="button" data-wk="-1" aria-label="Попередній тиждень"' +
            (state.week <= 1 ? ' disabled' : '') + '>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>' +
          '</button>' +
          '<b class="tdy-week__num">Тиждень ' + state.week + '</b>' +
          '<button class="icon-btn" type="button" data-wk="1" aria-label="Наступний тиждень"' +
            (state.week >= state.weekNow ? ' disabled' : '') + '>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
              'stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="tdy-days">' + days + '</div>' +
      '</div>';
  }

  function render() {
    const host = $('#today');
    if (!host) return;
    host.innerHTML = headHtml() + weekHtml();
  }

  /* ------------------------------------------------------------------ */

  function readPlan() {
    const r = WC && WC.resolvePlan ? WC.resolvePlan(state.profile) : null;
    state.program = r ? r.program : null;
    state.plan = r ? r.plan : null;
  }

  function readWeek() {
    const SC = window.SeasonCore;
    const season = SC && SC.current ? SC.current() : null;
    const n = weekNoOf(new Date(), season);
    /* Сезон ще не почався — показуємо перший тиждень і нікуди не пускаємо. */
    state.weekNow = (n && n > 0) ? n : 1;
    state.week = state.weekNow;
  }

  async function init() {
    const host = $('#today');
    if (!host) return;

    try { state.profile = await window.Store.getProfile() || {}; }
    catch (_) { state.profile = {}; }

    state.todayKey = localDateKey();
    readPlan();
    readWeek();
    render();

    /* Перемикання тижнів. Делегуванням: смуга перемальовується цілком. */
    host.addEventListener('click', function (e) {
      const b = e.target.closest && e.target.closest('[data-wk]');
      if (!b || b.disabled) return;
      const next = state.week + Number(b.dataset.wk);
      if (next < 1 || next > state.weekNow) return;
      state.week = next;
      render();
    });

    /* Північ: змінився день — змінився і поточний тиждень. */
    if (window.App && window.App.onDayChange) {
      window.App.onDayChange(function () {
        state.todayKey = localDateKey();
        readWeek();
        render();
      });
    }

    /* Профіль міг змінитись у сусідній вкладці: інша програма — інша
       назва й інша кількість тренувальних днів у смузі. */
    window.Store.onChange(async function () {
      try { state.profile = await window.Store.getProfile() || {}; } catch (_) { return; }
      readPlan();
      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
