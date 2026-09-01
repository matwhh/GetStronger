/**
 * «Сьогодні» — головна Forge і єдиний щоденний екран.
 *
 * Раніше екранів дня було два: index.html переказував стан, а змінити
 * його можна було тільки тут. Кожна щоденна дія коштувала зайвого
 * переходу, і два місця відповідали на одне питання — тобто могли
 * розійтись у показаннях. Тепер цей модуль малює головну, а today.html
 * лишився перенаправленням для старих посилань.
 *
 * Порядок карток на екрані відповідає порядку питань:
 *   1. Стан      — як у мене справи (Rating + три плитки)
 *   2. Тренування — картка-вхід у сьогоднішнє тренування (workout.html)
 *   3. Харчування — скільки лишилось
 *   4. Відновлення — трекери дня
 *   5. Прогрес    — куди це веде
 *
 * Це НЕ другий редактор плану. «Мій план» відповідає на питання «як
 * налаштована програма», ця сторінка — на питання «що робити зараз».
 * Тому тут немає правок: вправи читаються з того самого плану (custom із
 * профілю або базовий), ваги — з тих самих profile.weights, а будь-яка
 * зміна робиться на «Моєму плані» й одразу видна тут.
 *
 * Галочки виконання — СТАН ДНЯ, а не історія: живуть у localStorage разом
 * із датою і зникають наступного дня. Історія підходів — окремий етап,
 * і підробляти її видом галочок ця сторінка не намагається.
 *
 * Mobile-first: список вправ — вертикальні рядки з великими зонами
 * дотику, без таблиць і горизонтального скролу.
 */
(function () {
  'use strict';

  const { $, esc, toast, plural, fmtNum } = window.App;
  /* Розвʼязання плану й денний стан — спільне ядро зі сторінкою
     тренування: два екрани не можуть показати різні дні. */
  const WC = window.WorkoutCore;

  /* Ключ денного стану. Дата всередині значення, а не в ключі:
     старий запис перезаписується, а не накопичується сміттям. */
  const LS_TODAY = 'forge.today';

  const state = {
    profile: {},
    plan: null,        // масив днів обраної програми
    program: null,
    dayIdx: 0,
    done: [],          // галочки вправ ПОТОЧНОГО дня
    todayKey: '',      // 'YYYY-MM-DD' — локальна дата
    trackers: {},      // реєстр трекерів (профіль.trackers, догодований убудованими)
    trackerLog: {},     // профіль.trackerLog
    signals: null,      // розклад сьогоднішнього дня по сигналах Rating
    ratingHasData: false // чи є взагалі факти, з яких рахувати Rating
  };

  /* ------------------------------------------------------------------ */
  /* Дані                                                                */
  /* ------------------------------------------------------------------ */

  function localDateKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** Той самий ключ, що в programs.js: 'programId:days' */

  /* ---- денний стан у localStorage ---- */

  
  
  /*
   * Сесія дня — у профіль (sessionLog): який день програми робили і
   * скільки вправ закрито. Це вже ІСТОРІЯ, тому вона їде в профіль, а не
   * лишається в localStorage, як галочки.
   *
   * Запис зʼявляється з ПЕРШОЮ галочкою: відкрити сторінку — ще не
   * тренуватись. Дебаунс, бо кожна галочка — це збереження, а в хмарному
   * режимі збереження — це запит: серія з восьми галочок за хвилину має
   * поїхати одним записом, а не вісьмома.
   */

  
  
  

  /*
   * Власний запис у профіль.
   *
   * Store.onChange не розрізняє, хто змінив профіль, тож наше ж
   * збереження поверталось сюди подією і перебудовувало екран, з яким у цю
   * мить працюють. Сторожа «людина щойно була в полі» для цього замало:
   * між набором і зміною фокуса може минути скільки завгодно часу —
   * набрав вагу, подумав, і аж потім тицьнув у сусіднє поле. Тому
   * дивимось не на людину, а на ДЖЕРЕЛО події.
   *
   * Сторінка вже показала результат сама (state змінено до запису), тож
   * дублювати його перемальовкою не треба. Вікно коротке: справжня зміна
   * з іншої вкладки приходить пізніше й перемальовку отримає.
   *
   * Той самий запобіжник, що на «Моєму плані» (js/programs.js).
   */
  const SELF_WRITE_MS = 1200;
  let lastSelfWrite = 0;

  /** Зберегти профіль і позначити запис як власний. Усі збереження цієї
      сторінки йдуть через неї — інакше сторож не спрацює. */
  function saveOwn(patch) {
    lastSelfWrite = Date.now();
    return window.Store.saveProfile(patch);
  }

  /* ------------------------------------------------------------------ */
  /* Рендер: тренування                                                  */
  /* ------------------------------------------------------------------ */

  const WEEKDAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота'];
  const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

  function dateLine() {
    const d = new Date();
    return WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  /*
   * Настрій до/після тренування — не самостійний рядок трекера, а частина
   * картки «Тренування»: прив'язаний до сьогоднішньої сесії, а не до дня
   * загалом. Дані все одно живуть у trackerLog['workoutMood'][todayKey] —
   * та сама модульна система, лише вивід у іншому місці.
   */

  /**
   * Картка-вхід у тренування.
   *
   * Це НЕ саме тренування. До цього список вправ розгортався просто тут,
   * і короткий огляд дня перетворювався на нескінченний скрол: на телефоні
   * «Сьогодні» відкривалось довжиною в дванадцять вправ, а щоб дійти до
   * харчування чи трекерів, треба було прогорнути весь зал.
   *
   * Тепер тут рівно те, що потрібно, аби ВИРІШИТИ, чи йти в тренування:
   * яка програма, який день, скільки вправ і скільки з них уже закрито.
   * Самі вправи, ваги, RIR і таймер — на workout.html.
   */
  function trainingCard() {
    if (!state.plan) {
      return '' +
        '<div class="card" id="tdy-training">' +
          '<h2 style="margin:0">Тренування</h2>' +
          '<p class="small mt-1">План ще не обрано. Поставте кількість днів у залі, ' +
            'подивіться плани тренувань — і тут зʼявиться сьогоднішнє тренування ' +
            'із вашими робочими вагами.</p>' +
          '<a class="btn btn--primary mt-1" href="programs.html">Обрати програму</a>' +
        '</div>';
    }

    const day = state.plan[state.dayIdx];
    const st = WC.dayStats(day, state.done);
    const total = st.totalSets;
    const done = st.doneSets;
    const eta = WC.dayMinutes(day, state.done);
    /* «Виконано» тепер означає ЗАВЕРШЕНО кнопкою, а не всі галочки:
       завершити можна і 5/10 — день однаково використаний до понеділка. */
    const ended = WC.completedToday(state.profile, state.todayKey) ||
                  WC.completedThisWeek(state.profile, state.todayKey)[state.dayIdx];
    const finished = Boolean(ended);
    const started = !finished && done > 0;

    return '' +
      /* Уся картка — посилання: у залі ціль дотику має бути картка, а не
         кнопка в її кутку. Той самий патерн, що .dash-main мала на старій
         головній, тому нового компонента не зʼявляється. */
      '<a class="card tdy-entry' + (finished ? ' is-done' : '') + '" id="tdy-training" href="workout.html">' +
        '<span class="tdy-entry__head">' +
          '<span>' +
            '<span class="tdy-entry__title">Тренування</span>' +
            '<span class="tdy-entry__meta">' + esc(state.program.name) +
              ' · ' + esc(day.title || ('День ' + (state.dayIdx + 1))) + '</span>' +
          '</span>' +
          '<span class="tdy-entry__go" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
              'stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' +
          '</span>' +
        '</span>' +

        (day.focus ? '<span class="tdy-entry__focus">' + esc(day.focus) + '</span>' : '') +

        '<span class="tdy-entry__status">' +
          (finished ? 'Завершено — ' + done + ' з ' + total + ' підходів · знову з понеділка'
            : started ? 'Виконано ' + done + ' з ' + total + ' підходів · ≈' + eta + ' хв залишилось'
            : st.totalEx + ' ' + plural(st.totalEx, 'вправа', 'вправи', 'вправ') + ' · ≈' + eta + ' хв · ще не розпочато') +
        '</span>' +

        '<span class="vol" style="margin-top:8px"><span class="vol__bar">' +
          '<i id="tdy-bar" style="width:' + (finished ? 100 : total ? Math.round(done / total * 100) : 0) + '%"></i>' +
        '</span></span>' +

        '<span class="tdy-entry__cta">' +
          (finished ? 'Переглянути тренування →' : started ? 'Продовжити тренування →' : 'Відкрити тренування →') +
        '</span>' +
      '</a>';
  }

  /* ------------------------------------------------------------------ */
  /* Рендер: харчування                                                  */
  /* ------------------------------------------------------------------ */

  function nutritionCard() {
    const NC = window.NutritionCalc;
    const t = NC ? NC.targetFor(state.profile) : null;

    if (!t) {
      return '' +
        '<div class="card">' +
          '<h2 style="margin:0">Харчування</h2>' +
          '<p class="small mt-1">Заповніть зріст, вагу й вік — і тут буде ' +
            'денна норма та залишок калорій.</p>' +
          '<a class="btn btn--ghost mt-1" href="nutrition.html">Скласти план харчування</a>' +
        '</div>';
    }

    const got = window.DayCore.dayTotals(state.profile.day, state.profile.recipes);
    const left = Math.max(0, Math.round(t.kcal - got.kcal));
    const over = got.kcal > t.kcal * 1.05;

    return '' +
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Харчування</h2>' +
          '<span class="small muted">' + esc(t.goalLabel) + '</span>' +
        '</div>' +
        '<div class="kpis mt-2">' +
          '<div class="kpi"><div class="kpi__val mono">' + Math.round(got.kcal) + '</div><p class="kpi__lbl">набрано, ккал</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + Math.round(t.kcal) + '</div><p class="kpi__lbl">ціль, ккал</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + (over ? '+' + Math.round(got.kcal - t.kcal) : left) + '</div>' +
            '<p class="kpi__lbl">' + (over ? 'понад ціль' : 'залишок') + '</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + Math.round(got.p) + '/' + Math.round(t.protein) + '</div><p class="kpi__lbl">білок, г</p></div>' +
        '</div>' +
        '<div class="row mt-2">' +
          '<a class="btn btn--primary btn--sm" href="meals.html">Додати їжу</a>' +
          '<a class="btn btn--ghost btn--sm" href="nutrition.html">План харчування</a>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Рендер: Forge Rating — компактно, деталі на rating.html             */
  /* ------------------------------------------------------------------ */
  /*
   * «Сьогодні» показує лише те, що читається за секунду: рівень, число,
   * прогрес-бар, причина сьогоднішньої зміни. Повний розклад, графік і
   * драбина рівнів — на «Forge Rating» (rating.html), той самий принцип
   * «Overview → детальніше за бажанням», що й у трекерах.
   */

  /* ------------------------------------------------------------------ */
  /* Сезонний ELO: картка сезону                                         */
  /* ------------------------------------------------------------------ */
  /*
   * Число живе на СЕРВЕРІ (сезонний рейтинг 0–2500, js/elo-core.js +
   * db/elo-engine.sql); тут — показ із кешу EloApi і посилання на
   * сторінку сезону. Без акаунта картка чесно каже, що сезонний рейтинг
   * існує лише в акаунті — локального сурогата немає навмисно.
   */
  function seasonCard() {
    const Api = window.EloApi, EC = window.EloCore;
    if (!Api || !EC) return '';

    if (!Api.available()) {
      const cloudOff = !(window.Store && window.Store.isCloud);
      return '' +
        '<div class="card card--rating">' +
          '<div class="row row--split" style="align-items:baseline;gap:10px">' +
            '<h2 style="margin:0">Сезон</h2>' +
          '</div>' +
          '<p class="small muted mt-2" style="margin-bottom:0">' +
            (cloudOff
              ? 'Сезонний рейтинг вимкнено: сайт працює в локальному режимі без сервера.'
              : 'Сезонний ELO, рівні й таблиця лідерів живуть в акаунті. ' +
                '<a href="account.html">Увійдіть або зареєструйтесь</a> — сезон почнеться з 0 ELO.') +
          '</p>' +
        '</div>';
    }

    const st = Api.cached();
    if (!st || !st.config) {
      return '' +
        '<div class="card card--rating">' +
          '<h2 style="margin:0">Сезон</h2>' +
          '<p class="small muted mt-2" style="margin-bottom:0">Завантажується…</p>' +
        '</div>';
    }

    const lvl = EC.levelFor(st.elo, st.config);
    /* День сезону рахує ядро: по календарних днях, а не по мілісекундах
       (див. EloCore.seasonDay — інакше після полудня 1-го числа виходило «2»). */
    const sd = EC.seasonDay(st.season);
    const total = sd.total;
    const passed = sd.passed;

    return '' +
      '<div class="card card--rating">' +
        '<div class="row row--split" style="align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">' + esc(EC.seasonLabel(st.season)) + '</h2>' +
          '<a class="small" href="rating.html">Сезон і лідери</a>' +
        '</div>' +

        '<div class="rating-hero mt-2">' +
          '<span class="rating-hero__val mono">' + st.elo + '<span class="tile__of"> ELO</span></span>' +
          '<span class="rating-hero__meta">' +
            '<span class="lvl-circle">' + window.App.levelIcon(lvl.level, lvl.name) + '</span>' +
            '<span class="small muted">' +
              (lvl.elite
                ? 'ELITE' + (st.rank ? ' · #' + st.rank : '')
                : (st.config.levelSize - (st.elo - lvl.floor)) + ' ELO до ' +
                  (lvl.level >= st.config.levelCount ? 'ELITE' : 'Level ' + (lvl.level + 1))) +
            '</span>' +
          '</span>' +
        '</div>' +
        '<div class="vol" style="margin-top:8px"><span class="vol__bar"><i style="width:' + lvl.pct + '%"></i></span></div>' +

        '<div class="row mt-2" style="gap:16px;flex-wrap:wrap">' +
          '<span class="small">Сьогодні: <b class="mono">' + fmtNum.signed(st.today || 0) + ' ELO</b></span>' +
          (st.rank ? '<span class="small">Місце: <b class="mono">#' + st.rank + '</b> із ' + st.of + '</span>' : '') +
          '<span class="small">День сезону: <b class="mono">' + passed + '/' + total + '</b></span>' +
          (st.graceUntil ? '<span class="small">Grace Week до <b class="mono">' + esc(st.graceUntil) + '</b></span>' : '') +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Плитки стану: коротке «як справи» по трьох напрямках                */
  /* ------------------------------------------------------------------ */
  /*
   * Ті самі три плитки, що були на старій головній. Джерел власних тут
   * немає — усе читається з профілю тими самими ядрами, що й на своїх
   * сторінках, тож розійтись у показаннях нема з чим.
   */

  function tile(href, label, value, sub, mods) {
    return '' +
      '<a class="tile' + (mods || '') + '" href="' + href + '">' +
        '<span class="tile__label">' + esc(label) + '</span>' +
        '<span class="tile__val">' + value + '</span>' +
        '<span class="tile__sub">' + sub + '</span>' +
      '</a>';
  }

  function weightTile() {
    const log = (state.profile.bodyLog && typeof state.profile.bodyLog === 'object') ? state.profile.bodyLog : {};
    const keys = Object.keys(log).sort();
    if (!keys.length) return tile('journal.html', 'Вага', '—', 'перше зважування', ' tile--empty');
    const kg = Number(log[keys[keys.length - 1]]);
    const prev = keys.length > 1 ? Number(log[keys[keys.length - 2]]) : null;
    const d = prev !== null ? kg - prev : null;
    return tile('journal.html', 'Вага',
      '<span class="mono">' + fmtNum.kg(kg) + '</span><span class="tile__of"> кг</span>',
      d === null ? 'перший запис'
        : Math.abs(d) < 0.05 ? 'без змін'
        : fmtNum.signed(d, 1) + ' кг до попереднього');
  }

  function trackerTile() {
    const TC = window.TrackerCore;
    if (!TC) return '';
    const on = TC.active(state.trackers);
    if (!on.length) return '';
    const marked = on.filter(function (t) {
      const v = (state.trackerLog[t.id] || {})[state.todayKey];
      return v !== undefined && v !== null;
    }).length;
    return tile('trackers.html', 'Трекери',
      '<span class="mono">' + marked + '</span><span class="tile__of"> / ' + on.length + '</span>',
      marked >= on.length ? 'усе відмічено' : 'відмічено сьогодні');
  }

  /* ------------------------------------------------------------------ */
  /* Стан: Rating як головна метрика + плитки                            */
  /* ------------------------------------------------------------------ */

  /**
   * Що зараз найбільше впливає на рейтинг.
   *
   * Не порада «загалом», а найбільша ДІРА в сьогоднішньому розкладі:
   * сигнал, якому бракує найбільше балів до свого максимуму. Якщо не
   * бракує нікому — так і кажемо.
   */
  /*
   * Порада залежить не лише від сигналу, а й від того, чи сьогоднішній
   * факт уже є. Інакше екран радив би «закрий тренування дня» тому, хто
   * його щойно закрив: у цій моделі тренування дає бали і за СЬОГОДНІ, і
   * за частоту у вікні, тож сигнал може лишатись низьким при виконаному
   * дні — і причина тоді зовсім інша.
   */
  /*
   * Смужка плиток: вага і трекери.
   *
   * Плитки харчування тут більше немає — просто над нею стоїть повна
   * картка «Харчування» з тими самими числами. Два однакові показники
   * поруч не додають інформації, а змушують звіряти, чи вони збігаються.
   *
   * Через це плиток лишилось дві, і сітка для них своя (.tiles--wide):
   * у ряду на три вони були вузькими колонками, де довгий підпис на
   * кшталт «−0,4 кг до попереднього» ламався на два рядки.
   */
  function tilesStrip() {
    const inner = weightTile() + trackerTile();
    if (!inner) return '';
    return '<div class="tiles tiles--wide">' + inner + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Прогрес: куди це веде                                               */
  /* ------------------------------------------------------------------ */
  /*
   * Не другий «Прогрес» — три числа за тиждень і посилання. Питання, на
   * яке відповідає ця картка, останнє з пʼяти: «куди це веде». Деталі,
   * графіки й історія лишаються на своїй сторінці.
   */
  function addDaysKey(key, n) {
    const p = String(key).split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Дні з тренуванням: обʼєднання workLog і sessionLog, явний 0 у
      workLog перекриває сесію (як у «Прогресі»). Ознака «сесія була» —
      спільна з ProgressCore: підходи рахуються нарівні з вправами. */
  function trainedDatesOf(workLog, sessionLog) {
    const PC = window.ProgressCore;
    const counts = (PC && PC.sessionCounts)
      ? PC.sessionCounts
      : function (s) { return Boolean(s) && (Number(s.done) > 0 || Number(s.doneSets) > 0); };
    const set = {};
    const wl = workLog || {};
    Object.keys(wl).forEach(function (k) { if (Number(wl[k]) > 0) set[k] = true; });
    Object.keys(sessionLog || {}).forEach(function (k) {
      if (!counts(sessionLog[k])) return;
      if (Number(wl[k]) === 0 && Object.prototype.hasOwnProperty.call(wl, k)) return;
      set[k] = true;
    });
    return Object.keys(set).sort();
  }

  function progressCard() {
    const from = addDaysKey(state.todayKey, -6);
    const inWeek = function (k) { return k >= from && k <= state.todayKey; };

    const trained = trainedDatesOf(state.profile.workLog, state.profile.sessionLog)
      .filter(inWeek).length;
    const meals = Object.keys(state.profile.mealLog || {}).filter(inWeek).length;

    const body = state.profile.bodyLog || {};
    const bodyKeys = Object.keys(body).sort();
    const last = bodyKeys.length ? Number(body[bodyKeys[bodyKeys.length - 1]]) : null;
    const weekAgoKey = bodyKeys.filter(function (k) { return k < from; }).pop();
    const before = weekAgoKey ? Number(body[weekAgoKey]) : null;
    const dw = (last !== null && before !== null) ? last - before : null;

    const cell = function (val, lbl) {
      return '<div class="wk__cell"><span class="wk__val mono">' + val +
             '</span><span class="wk__lbl">' + esc(lbl) + '</span></div>';
    };

    return '' +
      '<div class="card">' +
        '<div class="row row--split" style="align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Тиждень</h2>' +
          '<a class="small" href="journal.html">Весь прогрес</a>' +
        '</div>' +
        '<div class="wk mt-2">' +
          cell(trained, plural(trained, 'тренування', 'тренування', 'тренувань')) +
          cell(meals, 'днів харчування') +
          cell(dw === null ? '—' : fmtNum.signed(dw, 1), 'кг ваги тіла') +
        '</div>' +
      '</div>';
  }

  function render() {
    const host = $('#today');
    if (!host) return;

    const dateEl = $('#tdy-date');
    if (dateEl) dateEl.textContent = dateLine();


    /*
     * Порядок = порядок дій дня: спершу що РОБИТИ (тренування, їжа) з
     * плитками стану одразу під їжею, потім рейтинг, далі решта.
     */
    host.innerHTML =
      trainingCard() +
      nutritionCard() +
      tilesStrip() +
      seasonCard() +
      progressCard();
  }

  /**
   * Профіль ще зовсім порожній — тобто це перше відкриття.
   *
   * Перевіряємо саме ті поля, які створює будь-яка перша осмислена дія.
   *
   * Трекери сюди НЕ входять: чотири вбудовані вмикає сам ensureBuiltins,
   * тобто вони є в кожного з першої секунди. Так само не входить age:
   * відколи перед входом стоїть віковий гейт, вік порахований у КОЖНОГО,
   * хто взагалі дійшов до цього екрана, — тобто він більше нікого ні від
   * кого не відрізняє. Лишились вага й зріст: їх вписують руками.
   */
  async function init() {
    if (!$('#today')) return;

    try { state.profile = await window.Store.getProfile() || {}; }
    catch (_) { state.profile = {}; }

    state.todayKey = localDateKey();
    if (window.TrackerCore) {
      state.trackers = window.TrackerCore.ensureBuiltins(state.profile.trackers);
      state.trackerLog = (state.profile.trackerLog && typeof state.profile.trackerLog === 'object') ? state.profile.trackerLog : {};
    }
    /* Сезонна картка оновлюється, коли приїжджає свіжий стан із сервера */
    if (window.EloApi) {
      window.EloApi.onChange(function () {
        if (!fieldBusy()) render();
      });
    }

    /* Свіжий день: підказаний день міг бути завершений цього тижня —
       тоді картка-вхід пропонує перший ще доступний (як на тренуванні). */
    function adjustFreshDay(d) {
      if (!d.fresh || !state.plan || !WC.completedThisWeek) return d.dayIdx;
      if (WC.completedToday(state.profile, state.todayKey)) return d.dayIdx;
      const week = WC.completedThisWeek(state.profile, state.todayKey);
      for (let k = 0; k < state.plan.length; k++) {
        const idx = (d.dayIdx + k) % state.plan.length;
        if (!week[idx]) return idx;
      }
      return d.dayIdx;
    }

    const resolved = WC && WC.resolvePlan(state.profile);
    if (resolved) {
      state.program = resolved.program;
      state.plan = resolved.plan;
      const d = WC.readDay(state.profile, state.todayKey, state.plan.length);
      state.dayIdx = adjustFreshDay(d);
      state.done = d.done;
    }

    render();

    /* Північ: ключ дня оновлюється, день перечитується, екран
       перемальовується — без перезавантаження сторінки. */
    if (window.App && window.App.onDayChange) {
      window.App.onDayChange(function () {
        state.todayKey = localDateKey();
        if (state.plan && state.plan.length) {
          const nd = WC.readDay(state.profile, state.todayKey, state.plan.length);
          state.dayIdx = adjustFreshDay(nd);
          state.done = nd.done;
        }
        if (!fieldBusy()) render();
      });
    }

    /*
     * Сторож вводу.
     *
     * fieldFocused — фокус у полі «Сьогодні» просто зараз.
     * fieldBusy    — або зараз, або щойно: перехід між двома полями
     *                залишає коротку щілину, у якій фокус не стоїть ніде,
     *                і саме в неї прилітає наш власний onChange.
     */
    const FIELD_SETTLE_MS = 120;
    const FIELD_GRACE_MS = 500;
    let lastFieldTouch = 0;
    let pendingRender = false;

    function fieldFocused(el) {
      return Boolean(el && el.closest && el.closest('#today input, #today select'));
    }
    function fieldBusy() {
      if (fieldFocused(document.activeElement)) return true;
      return (Date.now() - lastFieldTouch) < FIELD_GRACE_MS;
    }
    // focusin/focusout спливають, тож одного слухача досить, і він
    // переживає перемальовку #today.
    /*
     * Мітку оновлює й НАБІР, не лише фокус.
     *
     * Спершу тут стояли самі focusin/focusout, і вікно відлічувалось від
     * моменту, коли в поле СТАЛИ. Якщо в ньому потім довго набирали —
     * скажімо, шукали вагу між підходами — мітка встигала протухнути, і
     * change при переході в сусіднє поле знову ловив activeElement === body:
     * сторож не спрацьовував, render() зносив поле, куди щойно тицьнули.
     * Набір — така сама ознака «людина зараз тут», як і фокус.
     */
    ['focusin', 'focusout', 'input'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (fieldFocused(e.target)) lastFieldTouch = Date.now();
      });
    });

    // Профіль міг змінитись у сусідній вкладці (ваги, план, день раціону)
    window.Store.onChange(async function () {
      try { state.profile = await window.Store.getProfile() || {}; } catch (_) { return; }
      const r = WC && WC.resolvePlan(state.profile);
      state.program = r ? r.program : null;
      state.plan = r ? r.plan : null;
      if (r) {
        /* Стан дня перечитуємо з ядра, а не тримаємо свою копію: галочки
           ставлять на сторінці тренування, і головна має показувати
           СВІЖИЙ прогрес, коли на неї повертаються. */
        const d = WC.readDay(state.profile, state.todayKey, r.plan.length);
        state.dayIdx = adjustFreshDay(d);
        state.done = d.done;
      }
      if (window.TrackerCore) {
        state.trackers = window.TrackerCore.ensureBuiltins(state.profile.trackers);
        state.trackerLog = (state.profile.trackerLog && typeof state.profile.trackerLog === 'object') ? state.profile.trackerLog : {};
      }

      /*
       * Не перемальовуємо, поки людина набирає.
       *
       * render() замінює весь #today. Власні збереження цієї ж сторінки
       * (сесія — з дебаунсом 1,5 с, трекери, вага) приходять сюди назад
       * через onChange — і рівно в ту мить, коли між підходами вписують
       * робочу вагу, поле підмінялось збереженим значенням, фокус падав
       * на body, а решта натиснутих цифр ішла в нікуди.
       *
       * Ті самі запобіжники вже мають «Раціон» і сторінка акаунта.
       */
      /*
       * «Набирає» — це не тільки «фокус у полі ЗАРАЗ».
       *
       * Коли з одного поля ваги тицяєш у сусіднє, браузер спершу знімає
       * фокус зі старого (тоді ж летить change → збереження), а ставить
       * його на нове вже після мікрозадач. Саме в цю щілину приходив наш
       * власний onChange, бачив у activeElement <body>, вважав що ніхто не
       * набирає — і render() зносив увесь #today разом із полем, куди
       * людина щойно тицьнула. Значення зберігалось, але клавіатура
       * закривалась і в поле доводилось цілити вдруге.
       *
       * Тому питаємо ще й «фокус був щойно» — див. fieldBusy().
       */
      if (fieldBusy() || (Date.now() - lastSelfWrite) < SELF_WRITE_MS) {
        pendingRender = true;
        return;
      }
      render();
    });

    /* Перемальовка, відкладена через ввід, доганяє після виходу з поля —
       інакше сторінка лишалась би зі старими числами до наступної події.
       Чекаємо трохи довше за розрив між blur і focus: інакше «доганялка»
       спрацьовувала б посеред переходу з поля в поле й забирала б те саме
       поле, яке щойно вибрали. */
    $('#today').addEventListener('focusout', function () {
      if (!pendingRender) return;
      setTimeout(function () {
        if (fieldFocused(document.activeElement)) return;
        pendingRender = false;
        render();
      }, FIELD_SETTLE_MS);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
