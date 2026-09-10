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
  const TC = window.TrackerCore;

  /* Мить власного запису. Store.onChange спрацьовує і на НАШ власний
     запис — без цієї позначки кожен дотик по кубику викликав би зайву
     перемальовку одразу після тієї, яку ми вже зробили самі. */
  let lastSelfWrite = 0;
  const SELF_WRITE_MS = 1200;

  /*
   * ЧОМУ ПЕРЕМАЛЬОВКА БУВАЄ ВІДКЛАДЕНОЮ.
   *
   * render() переписує #today цілком — разом із полем, у якому людина
   * зараз набирає. Для кнопок це не біда (натиснув — і відпустив), а для
   * полів згубно, і згубно тихо: у сон із двох полів вводять «7», потім
   * переходять у хвилини — перехід викликає change на годинах, той пише
   * 7 год і перемальовує кубик, а щойно набрані «20» зникають разом зі
   * старим елементом. У профілі лишається 7:00, і людина цього не
   * помічає, бо на екрані все виглядає нормально.
   *
   * Тому запис із поля нічого не перемальовує одразу: значення вже стоїть
   * у полі, показувати нема чого. Перемальовка чекає, доки фокус піде з
   * полів.
   */
  let pendingRender = false;
  let lastFieldTouch = 0;
  const FIELD_GRACE_MS = 500;

  function fieldFocused(el) {
    return Boolean(el && el.closest && el.closest('#today input'));
  }
  function fieldBusy() {
    return fieldFocused(document.activeElement) ||
           (Date.now() - lastFieldTouch) < FIELD_GRACE_MS;
  }

  const state = {
    profile: {},
    program: null,
    plan: null,
    todayKey: '',
    trackers: {},     // profile.trackers — реєстр трекерів
    trackerLog: {},   // profile.trackerLog — { id: { 'РРРР-ММ-ДД': значення } }
    week: 1,      // номер тижня сезону
    slot: 0       // обраний день тижня: Пн = 0 … Нд = 6
  };

  /** Перечитати трекери з профілю. Биті типи не мають валити екран. */
  function readTrackers() {
    const p = state.profile || {};
    state.trackers = (p.trackers && typeof p.trackers === 'object') ? p.trackers : {};
    state.trackerLog = (p.trackerLog && typeof p.trackerLog === 'object') ? p.trackerLog : {};
  }

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
   * Чи був того дня факт тренування.
   *
   * Правило списане з теплокарти журналу (js/journal.js → trained): явний
   * 0 у workLog знімає день навіть за наявної сесії, інакше рахується
   * сесія з бодай одним закритим підходом або вправою. Тримаємо його в
   * одному місці — від нього залежать і відлік тижнів, і плитка звички.
   */
  function trainedOn(key) {
    const v = Number((state.profile.workLog || {})[key]);
    if (Number.isFinite(v)) return v > 0;
    const x = (state.profile.sessionLog || {})[key];
    return !!x && typeof x === 'object' && (Number(x.done) > 0 || Number(x.doneSets) > 0);
  }

  /** Чи є того дня запис ваги тіла. */
  function weighedOn(key) {
    const v = Number((state.profile.bodyLog || {})[key]);
    return Number.isFinite(v) && v > 0;
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
    let best = '';
    Object.keys(wl).concat(Object.keys(sl)).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      if (best && k >= best) return;
      if (trainedOn(k)) best = k;
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

    /*
     * ПОСИЛАННЯ НЕСЕ НОМЕР ДНЯ.
     *
     * Раніше воно вело просто на workout.html, а та сторінка обирала день
     * сама — «наступний після того, що робили востаннє». Це дві різні
     * відповіді на одне питання: віджет каже «сьогодні Пуш», сторінка
     * відкриває Пул, бо минулого разу був Пуш. Людина натискає на слово
     * «Пуш» і потрапляє не туди, куди тицьнула.
     *
     * Тепер день передається явно — і саме той, що показує віджет. Це
     * важливо: у смузі тижня можна обрати четвер, віджет покаже
     * четверговий день, і посилання відкриє його, а не сьогоднішній.
     * Одне, що видно на екрані, — одне, що відкриється.
     *
     * Сторінка тренування має право цю підказку відхилити: якщо в
     * поточному дні вже закриті підходи, вона лишає як є, щоб не стерти
     * роботу (див. js/workout.js, dayFromUrl).
     */
    return '<div class="tdy-widget" data-tilt>' +
      (rest
        ? '<div class="card card--glass tdy-card is-rest">' + body + '</div>'
        : '<a class="card card--glass card--hover tdy-card" href="workout.html?day=' +
          encodeURIComponent(idx) + '">' + body + '</a>') +
      '</div>';
  }

  /**
   * ПЛИТКИ ЗВИЧОК: тренування і зважування.
   *
   * Тридцять квадратиків — останні 30 днів, найстаріший зліва зверху.
   * Заповнений = того дня факт був. Це та сама шкала «є / немає», що в
   * теплокарті журналу, лише без сходинок обсягу: плитка відповідає на
   * питання «чи роблю я це регулярно», а не «скільки я зробив».
   *
   * Обидві ведуть у журнал — у той самий розділ, який показує повну
   * історію того ж факту. Нових даних плитки не заводять: усе, що вони
   * показують, уже лежить у профілі.
   */
  function habitCells(has) {
    const today = new Date();
    let out = '';
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      out += '<i class="hbt__cell' + (has(keyOf(d)) ? ' is-on' : '') + '"></i>';
    }
    return out;
  }

  function habitCard(href, title, has, footNum, footTail) {
    return '<a class="card hbt" href="' + href + '">' +
        '<span class="hbt__title">' + esc(title) + '</span>' +
        '<span class="hbt__sub">Останні 30 днів</span>' +
        '<span class="hbt__grid" aria-hidden="true">' + habitCells(has) + '</span>' +
        '<span class="hbt__foot">' +
          /* Число й підпис — ОКРЕМІ елементи, а не один рядок тексту:
             на вузькому екрані вони стають двома рядками за задумом, а
             не переносом посеред фрази. */
          '<span class="hbt__val">' +
            '<b class="hbt__num">' + esc(footNum) + '</b>' +
            '<span class="hbt__tail">' + esc(footTail) + '</span>' +
          '</span>' +
          '<svg class="hbt__go" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
        '</span>' +
      '</a>';
  }

  function habitsHtml() {
    /* Тиждень — від понеділка, як і скрізь у проєкті. */
    const mon = mondayOf(new Date());
    let trainWeek = 0, weighWeek = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      const k = keyOf(d);
      if (trainedOn(k)) trainWeek++;
      if (weighedOn(k)) weighWeek++;
    }
    /* Ціль тренувань — кількість днів обраного плану, як у журналі. Без
       плану цілі немає, і вигадувати її нема з чого. */
    const target = state.plan ? state.plan.length : 0;

    return '<div class="hbts">' +
      habitCard('journal.html#jr-train', 'Тренування', trainedOn,
        target ? trainWeek + '/' + target : String(trainWeek), 'цього тижня') +
      habitCard('journal.html#jr-weight', 'Зважування', weighedOn,
        weighWeek + '/7', 'цього тижня') +
    '</div>';
  }


  /* ================================================================== */
  /* КУБИКИ ТРЕКЕРІВ                                                     */
  /* ================================================================== */
  /*
   * ЧОМУ ТРЕКЕРИ ПОВЕРНУЛИСЬ НА ГОЛОВНУ — І ЧОМУ НЕ ВСІ.
   *
   * Колись вони тут уже жили: усі підряд, довгим стовпчиком шкал 1..10,
   * — і саме тому їх звідси прибрали (див. шапку js/trackers-day.js).
   * Помилкою був не сам факт, а «усі підряд»: екран дня перетворювався
   * на анкету, яку треба прогорнути, щоб дійти до тренування.
   *
   * Тепер сюди потрапляє тільки те, що людина сама закріпила
   * (TrackerCore.pinnedList). Типово — нічого: екран лишається таким,
   * яким був, доки власник не винесе перший кубик зі сторінки
   * налаштувань трекерів.
   *
   * ЗАПИС ІДЕ ПРЯМО ЗВІДСИ. Кубик, який тільки показує число й відсилає
   * на іншу сторінку, не варт місця на головній: щоб відмітити склянку
   * води, довелося б зробити три дотики замість одного. Тому обробники
   * тут повні — ті самі data-атрибути, що на сторінці «Трекери».
   */

  function trackersHtml() {
    if (!TC || !window.TrackerTile) return '';
    const grid = window.TrackerTile.grid(state.trackers, {
      log: state.trackerLog,
      todayKey: state.todayKey,
      now: new Date()
    });
    if (grid) return grid;

    /*
     * ПІДКАЗКА ЗАМІСТЬ ПОРОЖНЕЧІ — і тільки тоді, коли є що закріплювати.
     *
     * Людині, яка веде трекери, але не знає про цю можливість, порожній
     * екран нічого не скаже. Людині, яка трекерів не веде взагалі,
     * підказка про них — просто ще один рядок, який вона не просила:
     * тому за відсутності увімкнених трекерів тут немає нічого.
     */
    if (!TC.active(state.trackers).length) return '';
    return '<a class="twt-hint" href="trackers-settings.html">' +
      '<span>Винести трекер на цей екран</span>' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 18l6-6-6-6"/></svg>' +
    '</a>';
  }

  /*
   * Запис дня.
   *
   * Патч — ФУНКЦІЯ, а не обʼєкт: trackerLog зберігається як одне поле
   * профілю, і обʼєктний патч замінив би весь журнал разом з історією та
   * зі значеннями, які встигла записати сусідня вкладка. TrackerCore.
   * mergeDay переносить лише сьогоднішній день — та сама функція, що на
   * сторінці «Трекери».
   */
  function saveTrackerLog(next, quiet) {
    state.trackerLog = next;
    lastSelfWrite = Date.now();
    if (quiet) pendingRender = true;
    else render();
    const key = state.todayKey;
    window.Store.saveProfile(function (p) {
      return { trackerLog: TC.mergeDay(p && p.trackerLog, next, key) };
    }).catch(function (e) {
      if (e && e.queued) return;   /* офлайн: піде з черги */
      if (window.App && window.App.toast) window.App.toast('Не збереглося: ' + e.message, 'err');
    });
  }

  /** Число з поля вводу: порожньо — стерти запис, сміття — не чіпати. */
  function fieldNumber(el) {
    const raw = String(el.value == null ? '' : el.value).trim().replace(',', '.');
    if (!raw) return null;
    const v = Number(raw);
    return isFinite(v) ? v : false;
  }

  function wireTrackers(host) {
    host.addEventListener('click', function (e) {
      const el = e.target.closest && e.target.closest('[data-trk-add], [data-trk-scale], [data-trk-pair]');
      if (!el) return;

      if (el.dataset.trkAdd) {
        saveTrackerLog(TC.addDelta(state.trackers, state.trackerLog,
          el.dataset.trkAdd, Number(el.dataset.amount), state.todayKey));
        return;
      }
      if (el.dataset.trkScale) {
        const id = el.dataset.trkScale;
        const val = Number(el.dataset.val);
        /* Повторний дотик по вже обраному числі стирає запис: інакше
           помилковий тап неможливо скасувати, не йдучи на іншу сторінку. */
        const cur = (state.trackerLog[id] || {})[state.todayKey];
        saveTrackerLog(cur === val
          ? TC.removeEntry(state.trackerLog, id, state.todayKey)
          : TC.logValue(state.trackers, state.trackerLog, id, val, state.todayKey));
        return;
      }
      const id = el.dataset.trkPair;
      const patch = {};
      patch[el.dataset.field] = Number(el.dataset.val);
      saveTrackerLog(TC.logValue(state.trackers, state.trackerLog, id, patch, state.todayKey));
    });

    host.addEventListener('change', function (e) {
      const t = e.target;

      const mark = t.closest && t.closest('[data-trk-mark]');
      if (mark) {
        const id = mark.dataset.trkMark;
        const tr = state.trackers[id];
        /* Галочка в дозованої добавки пише ТИПОВУ дозу, а не true:
           інакше «прийняв» і «прийняв 5 г» були б різними записами. */
        const val = t.checked ? (TC.isDosed(tr) ? TC.doseOf(tr) : true) : null;
        saveTrackerLog(val === null
          ? TC.removeEntry(state.trackerLog, id, state.todayKey)
          : TC.logValue(state.trackers, state.trackerLog, id, val, state.todayKey));
        return;
      }

      const dose = t.closest && t.closest('[data-trk-dose]');
      if (dose) {
        const v = fieldNumber(t);
        /* Сміття в полі не пишемо й не перемальовуємо: перемальовка під
           фокусом забрала б у людини поле разом із тим, що вона набирає. */
        if (v === false) { pendingRender = true; return; }
        saveTrackerLog(v === null
          ? TC.removeEntry(state.trackerLog, dose.dataset.trkDose, state.todayKey)
          : TC.logValue(state.trackers, state.trackerLog, dose.dataset.trkDose, v, state.todayKey), true);
        return;
      }

      const val = t.closest && t.closest('[data-trk-value]');
      if (val) {
        const v = fieldNumber(t);
        if (v === false) { pendingRender = true; return; }
        saveTrackerLog(v === null
          ? TC.removeEntry(state.trackerLog, val.dataset.trkValue, state.todayKey)
          : TC.logValue(state.trackers, state.trackerLog, val.dataset.trkValue, v, state.todayKey), true);
        return;
      }

      /* Тривалість: два поля, одна величина — читаємо обидва, щоб зміна
         годин не скидала хвилини. */
      const dh = t.closest && t.closest('[data-trk-durh]');
      const dm = t.closest && t.closest('[data-trk-durm]');
      if (!dh && !dm) return;
      const id = (dh || dm).dataset.trkDurh || (dh || dm).dataset.trkDurm;
      const hEl = host.querySelector('[data-trk-durh="' + CSS.escape(id) + '"]');
      const mEl = host.querySelector('[data-trk-durm="' + CSS.escape(id) + '"]');
      const prev = TC.entryValue((state.trackerLog[id] || {})[state.todayKey]);
      const mins = TC.joinDuration(hEl ? hEl.value : '', mEl ? mEl.value : '', prev);
      if (mins === false) { pendingRender = true; return; }
      saveTrackerLog(mins === null
        ? TC.removeEntry(state.trackerLog, id, state.todayKey)
        : TC.logValue(state.trackers, state.trackerLog, id, mins, state.todayKey), true);
    });
  }

  function render() {
    const host = $('#today');
    if (!host) return;
    host.innerHTML = headHtml() + weekHtml() + widgetHtml() + habitsHtml() + trackersHtml();
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
    readTrackers();
    readWeek();
    render();
    wireTrackers(host);

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
    /* Сторож вводу: позначаємо, що людина зараз у полі. */
    ['focusin', 'focusout', 'input'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (fieldFocused(e.target)) lastFieldTouch = Date.now();
      });
    });
    host.addEventListener('focusout', function () {
      if (!pendingRender) return;
      setTimeout(function () {
        if (fieldFocused(document.activeElement)) return;
        pendingRender = false;
        render();
      }, 120);
    });

    window.Store.onChange(async function () {
      try { state.profile = await window.Store.getProfile() || {}; } catch (_) { return; }
      readPlan();
      readTrackers();
      if (fieldBusy() || (Date.now() - lastSelfWrite) < SELF_WRITE_MS) {
        pendingRender = true;
        return;
      }
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
