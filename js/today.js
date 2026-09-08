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
 *
 * Тиждень рахується від ПЕРШОГО ВИКОНАНОГО ТРЕНУВАННЯ, а не від старту
 * сезону: сезон починається за календарем і однаковий для всіх, а «мій
 * тиждень 3» має означати третій тиждень МОГО тренування. Людина, яка
 * зайшла в застосунок посеред сезону, інакше бачила б «Тиждень 7» у свій
 * перший день у залі.
 *
 * Тиждень 1 — календарний тиждень (Пн→Нд), у якому те перше тренування
 * сталось: увесь проєкт рахує тижні від понеділка (теплокарта, календар
 * історії, adherence), і заводити тут власний відлік означало б, що два
 * екрани називають «тижнем» різні сім днів. Поки тренувань немає — це
 * тиждень 1.
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
    week: 1,      // номер тижня сезону
    slot: 0       // обраний день тижня: Пн = 0 … Нд = 6
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
   * Номер тижня для дати, рахуючи від тижня, у якому лежить startKey.
   * 1 — той самий тиждень. null — startKey немає.
   */
  function weekNoOf(date, startKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startKey || ''))) return null;
    const p = String(startKey).split('-');
    const base = mondayOf(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    const here = mondayOf(date);
    /* Різниця в добах, а не в мілісекундах: перехід на зимовий час робить
       тиждень 169-годинним, і ділення мілісекунд дало б 0.99 тижня. */
    const days = Math.round((here - base) / 86400000);
    return Math.floor(days / 7) + 1;
  }

  /**
   * Дата першого виконаного тренування, або ''.
   *
   * Правило «що вважається тренуванням» списане з теплокарти журналу
   * (js/journal.js → trained): явний 0 у workLog знімає день навіть за
   * наявної сесії, інакше рахується сесія з бодай одним закритим
   * підходом або вправою. Два екрани не можуть по-різному відповідати на
   * питання «чи тренувався я того дня».
   */
  function firstTrainedKey() {
    const wl = state.profile.workLog || {};
    const sl = state.profile.sessionLog || {};
    const counts = function (x) {
      return !!x && typeof x === 'object' && (Number(x.done) > 0 || Number(x.doneSets) > 0);
    };
    let best = '';
    Object.keys(wl).concat(Object.keys(sl)).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      if (best && k >= best) return;
      const v = Number(wl[k]);
      const on = Number.isFinite(v) ? v > 0 : counts(sl[k]);
      if (on) best = k;
    });
    return best;
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
    const todaySlot = dowIndex(new Date());

    let days = '';
    for (let i = 0; i < 7; i++) {
      const rest = sch.length ? sch[i] === 'rest' : false;
      const here = i === todaySlot;
      const sel = i === state.slot;
      days +=
        '<button type="button" class="tdy-day' + (rest ? ' is-rest' : '') +
            (here ? ' is-now' : '') + (sel ? ' is-sel' : '') + '"' +
            ' data-slot="' + i + '" aria-pressed="' + sel + '"' +
            (here ? ' aria-current="date"' : '') + '>' +
          '<span class="tdy-day__dot" aria-hidden="true"></span>' +
          /*
           * ЗНАЧЕННЯ ЗВЕРХУ, ПІДПИС ПІД НИМ — І ЦЕ НЕ СМАК.
           *
           * Було навпаки, і на телефоні смуга розсипалась: підписаний
           * лише відпочинок, тож у тренувальних днів верхній рядок
           * порожній. Виходило, що REST стоїть високо, число — низько, і
           * сім клітинок читались як випадково розкидані значки.
           * Тепер верхній рядок ЗАВЖДИ зайнятий (число або місяць), а
           * підпис іде під ним — сім однакових стовпчиків.
           */
          '<span class="tdy-day__val">' + (rest ? MOON : (i + 1)) + '</span>' +
          '<span class="tdy-day__lbl">' + (rest ? 'REST' : '') + '</span>' +
        '</button>';
    }

    /* Стрілок перемикання тижнів немає навмисно: гортати сезон уперед і
       назад тут нема куди — минулі тижні живуть в «Історії», майбутніх ще
       не було. Номер тижня лишається як позначка, де ти в сезоні. */
    return '' +
      '<div class="tdy-week">' +
        '<b class="tdy-week__num">Тиждень ' + state.week + '</b>' +
        '<div class="tdy-days">' + days + '</div>' +
      '</div>';
  }

  /**
   * ВІДЖЕТ ДНЯ — те, що смуга робить натиснутим.
   *
   * Показує день ОБРАНОГО слота: назву з плану (Push, Upper, День A) або
   * REST зі значком. Прив'язка — до дня тижня й циклу плану, а не до
   * того, що людина реально зробила: пропущений понеділок не зсуває
   * середу, бо цикл у всіх планів рівно семиденний і йде по колу.
   *
   * Тренувальний день — посилання на workout.html. День відпочинку —
   * не посилання: відкривати там нічого, і кнопка, яка нікуди не веде,
   * гірша за її відсутність.
   */
  function widgetHtml() {
    const sch = weekSchedule();
    if (!sch.length) return '';

    const idx = sch[state.slot];
    const rest = idx === 'rest';
    const day = rest ? null : (state.plan[idx] || null);
    const today = state.slot === dowIndex(new Date());

    /*
     * ОЦІНКА ЧАСУ — ТА САМА ФУНКЦІЯ, ЩО НА СТОРІНЦІ ТРЕНУВАННЯ.
     *
     * WC.dayMinutes рахує підхід плюс відпочинок за кожен підхід (мінус
     * відпочинок після останнього). Другим аргументом іде стан галочок —
     * передаємо порожній, бо віджет показує, скільки день займе ЦІЛКОМ, а
     * не скільки лишилось: смуга живе поза сьогоднішнім днем, і для
     * четверга «лишилось» не означає нічого.
     */
    let mins = 0;
    if (day && WC && WC.dayMinutes) {
      try { mins = WC.dayMinutes(day, []) || 0; } catch (_) { mins = 0; }
    }

    const body =
      '<span class="tdy-card__kicker">' +
        (today ? 'Сьогодні' : 'День ' + (state.slot + 1) + ' тижня') +
      '</span>' +
      (rest
        ? '<span class="tdy-card__title tdy-card__title--rest">' + MOON + 'REST</span>' +
          '<span class="tdy-card__sub">День відпочинку</span>'
        : '<span class="tdy-card__title">' + esc(day && day.title || '—') + '</span>' +
          '<span class="tdy-card__sub">' +
            (day && day.focus ? esc(day.focus) : '') +
            (mins > 0 ? (day && day.focus ? ' · ' : '') + '≈' + mins + ' хв' : '') +
          '</span>' +
          '<span class="tdy-card__cta">Відкрити тренування →</span>');

    return '<div class="tdy-widget" data-tilt>' +
      (rest
        ? '<div class="card card--glass tdy-card is-rest">' + body + '</div>'
        : '<a class="card card--glass card--hover tdy-card" href="workout.html">' + body + '</a>') +
      '</div>';
  }

  function render() {
    const host = $('#today');
    if (!host) return;
    host.innerHTML = headHtml() + weekHtml() + widgetHtml();
    /* Нахил вішається на щойно створений віджет: initTilt позначає вже
       оброблені контейнери, тож повторний виклик безпечний. */
    if (window.App && window.App.initTilt) window.App.initTilt(host);
  }

  /* ------------------------------------------------------------------ */

  function readPlan() {
    const r = WC && WC.resolvePlan ? WC.resolvePlan(state.profile) : null;
    state.program = r ? r.program : null;
    state.plan = r ? r.plan : null;
  }

  function readWeek() {
    const n = weekNoOf(new Date(), firstTrainedKey());
    /* Тренувань ще не було — це перший тиждень. */
    state.week = (n && n > 0) ? n : 1;
    state.slot = dowIndex(new Date());
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

    /* Вибір дня в смузі. Делегуванням: смуга перемальовується цілком. */
    host.addEventListener('click', function (e) {
      const b = e.target.closest && e.target.closest('[data-slot]');
      if (!b) return;
      const n = Number(b.dataset.slot);
      if (!(n >= 0 && n <= 6) || n === state.slot) return;
      state.slot = n;
      render();
    });

    /* Північ: змінився день — змінився і поточний тиждень. */
    if (window.App && window.App.onDayChange) {
      window.App.onDayChange(function () {
        state.todayKey = localDateKey();
        readWeek();   /* новий день — новий обраний слот */
        render();
      });
    }

    /* Профіль міг змінитись у сусідній вкладці: інша програма — інша
       назва й інша кількість тренувальних днів у смузі. */
    window.Store.onChange(async function () {
      try { state.profile = await window.Store.getProfile() || {}; } catch (_) { return; }
      readPlan();
      /* Журнал міг поповнитись у сусідній вкладці — а разом із першим
         тренуванням з'являється й точка відліку тижнів. */
      const n = weekNoOf(new Date(), firstTrainedKey());
      state.week = (n && n > 0) ? n : 1;
      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
