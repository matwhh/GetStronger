/**
 * Сховище даних користувача.
 *
 * Два режими, той самий інтерфейс:
 *   • "cloud" — Supabase (GoTrue для логіну + PostgREST для даних),
 *     якщо в config.js заповнені url і anonKey.
 *   • "local" — localStorage, якщо ключі порожні або хмара недоступна.
 *
 * Реалізовано на чистому fetch, без SDK: менше залежностей і видно,
 * що саме летить на сервер. Захист даних — на боці Postgres через RLS
 * (див. db/schema.sql).
 *
 * ЧЕСНО ПРО РИЗИК ТОКЕНІВ. anon-ключ справді публічний за задумом Supabase,
 * і сам собою нічого не відкриває. Але тут же, у localStorage, лежить сесія
 * користувача — разом із refresh_token. Це означає, що будь-який XSS на сайті
 * дає нападнику не сесію на годину, а довгоживучий ключ оновлення, тобто
 * повне захоплення акаунта, яке переживе закриття вкладки й зміну IP.
 * Для статичного сайту без бекенду альтернативи немає (httpOnly-cookie
 * поставити нікому), тому єдиний захист — не мати XSS: усе, що йде в innerHTML,
 * проходить через App.esc(), а імпорт профілю валідується за схемою.
 * Це усвідомлений компроміс, а не «все гаразд».
 *
 * Публічний API (усі методи async, крім позначених):
 *   Store.mode                       -> 'cloud' | 'local'
 *   Store.user()                     -> { id, email } | null       (sync)
 *   Store.signUp(email, password)
 *   Store.signIn(email, password)    -> { user, merge }            див. нижче
 *   Store.signOut()
 *   Store.getProfile()               -> object
 *   Store.saveProfile(patch)         -> object (злиття з наявним)
 *   Store.saveProfileBeacon(patch)   -> bool   (sync, для pagehide)
 *   Store.onChange(fn)               -> відписка
 *   Store.adoptLocalProfile()        -> залити локальний профіль у хмару
 *   Store.discardLocalProfile()      -> викинути локальний, лишити хмарний
 *   Store.pendingCount()             -> скільки збережень чекає на мережу
 *   Store.flushPending()             -> спробувати досилання
 *
 * onChange(profile, user) спрацьовує на вхід, вихід, збереження профілю
 * та на зміну даних в іншій вкладці браузера. ПЕРШИЙ аргумент — профіль:
 * раніше сюди приходив користувач, і js/journal.js, який чекав на профіль,
 * мовчав у обох режимах (у локальному user() завжди null).
 */
(function () {
  'use strict';

  const CFG  = (window.APP_CONFIG || {}).supabase || {};
  const URL_ = String(CFG.url || '').replace(/\/+$/, '');
  const KEY  = String(CFG.anonKey || '');
  const CLOUD = Boolean(URL_ && KEY);

  /*
   * Підказка синхронному сторожу (js/agegate.js): він виконується в <head>
   * до config.js і не може знати, чи сайт у хмарному режимі. Пишемо
   * прапорець тут — сторож читає його на НАСТУПНІЙ навігації.
   */
  try { localStorage.setItem('ib.cloud', CLOUD ? '1' : '0'); } catch (_) {}

  const LS_SESSION = 'ib.session';
  const LS_REMEMBER = 'ib.remember';   // '0' = не тримати сесію між сеансами
  const LS_PROFILE = 'ib.profile';
  const LS_BACKUP  = 'ib.profile.backup';         // копія ПЕРЕД імпортом
  /*
   * Копія перед розвʼязанням конфлікту входу — окремий слот.
   *
   * Був один. resolveFirstLogin писав у нього при КОЖНОМУ вході, тому
   * невдалий імпорт + повторний вхід затирали доімпортну копію поточним
   * (уже зіпсованим) станом, і кнопка «Відкотити імпорт» відновлювала
   * зіпсоване. Два слоти — два незалежні рішення користувача.
   */
  const LS_BACKUP_LOGIN = 'ib.profile.backup.login';
  /*
   * Чий це локальний профіль. Без цього поля дані попереднього
   * користувача на спільному пристрої вважалися «своїми» для наступного:
   * resolveFirstLogin бачив непорожній локальний профіль і заливав його
   * в чужий акаунт.
   */
  const LS_OWNER   = 'ib.profile.owner';
  /*
   * Стійка позначка «є зміни, які могли не доїхати».
   *
   * Ставиться ПЕРЕД мережевим записом і знімається лише після
   * підтвердження. Черга (ib.pending) для цього не годиться: коли
   * сторінку вивантажують посеред fetch, запит скасовується, а
   * .catch(pendingPush) уже не виконується — черга лишається порожньою,
   * і getProfile робив висновок «локальних змін немає» та затирав
   * локальну копію хмарною.
   */
  const DIRTY_KEY  = 'ib.profile.dirty';
  /*
   * Стан ELO прив'язаний до особи так само, як профіль. Раніше ці ключі
   * переживали вихід, і черга подій одного користувача досилалася під
   * сесією наступного.
   */
  const ELO_KEYS = ['ib.eloState', 'ib.eloPending', 'ib.eloSent',
                    'ib.eloWeeks', 'ib.eloClosed', 'ib.eloReport'];
  const LS_PENDING = 'ib.pending';
  const LS_ACCOUNT = 'ib.account';   // кеш статусу акаунта (UX; барʼєр — RLS)

  /*
   * Підказка синхронному сторожу (js/agegate.js): він виконується в <head>
   * до config.js і не може знати, чи сайт у хмарному режимі. Пишемо
   * прапорець один раз тут — сторож читає його на НАСТУПНІЙ навігації.
   */


  /**
   * Версія форми даних. Зростає, коли міняється СТРУКТУРА вкладених обʼєктів
   * (не коли додається нове поле — для цього досить blankProfile).
   * migrate() нижче переганяє старі профілі вперед по одному кроку.
   */
  const SCHEMA_VERSION = 10;

  const listeners = new Set();
  let session = null;   // { access_token, refresh_token, expires_at, user }
  let cache   = null;   // кеш профілю в памʼяті

  /* ------------------------------------------------------------------ */
  /* Локальні помічники                                                  */
  /* ------------------------------------------------------------------ */

  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  /**
   * Повертає false, якщо запис не вдався.
   *
   * Раніше цей false ніхто не перевіряв, і переповнене сховище означало
   * тиху втрату: saveProfile резолвився успішно, акаунт малював «Збережено»,
   * а після F5 даних не було. У локальному режимі localStorage — ЄДИНЕ
   * сховище, тож мовчати тут не можна.
   */
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[store] запис у localStorage не вдався:', e && e.name);
      return false;
    }
  }

  function emit() {
    const p = cache;
    const u = api.user();
    listeners.forEach(function (fn) {
      try { fn(p, u); } catch (e) { console.error('[store] listener', e); }
    });
  }

  /** Порожній профіль за замовчуванням */
  function blankProfile() {
    return {
      // Версія форми даних. Дивись SCHEMA_VERSION і migrate().
      version: SCHEMA_VERSION,
      // Антропометрія.
      // birthDate ('YYYY-MM-DD') — джерело правди про вік: з нього
      // виводиться і доступ до Forge (17+, див. js/agegate.js), і саме
      // поле age. age лишається числом, бо його читають розрахунки
      // харчування й пульсу; воно похідне, а не друге джерело.
      birthDate: null,
      sex: null, age: null, height: null, weight: null, bodyfat: null,
      // Нік для таблиці лідерів сезону (не email — його нікому не показуємо)
      displayName: null,
      // Місце під майбутнього маскота (pixel-art companion). Структура
      // закладена зараз, щоб потім не мігрувати: рівень, скін, настрій.
      pet: null,
      // Тренування
      daysPerWeek: null, programId: null, goal: null,
      // Відредаговані плани: { "ppl:6": [дні...] }
      customPlans: {},
      // Робочі ваги за НАЗВОЮ вправи: { "Жим штанги лежачи": 90 }.
      // Спільні для всіх програм і днів — вправа одна, отже й вага одна.
      weights: {},
      // Обраний робочий план: { programId, days }. null = ще не обрано.
      activePlan: null,
      // Стаж силових: 'novice' | 'inter' | 'adv' | 'elite'. Потрібен лише прогнозу.
      trainingAge: null,
      // Харчування
      activity: null, meals: null,
      // Раціон: власні рецепти й поточний день
      recipes: [],
      day: null,
      // Кардіо
      hrRest: null, hrMax: null,
      // Журнал: вага тіла по днях і позначки тренувань.
      // Ключ — локальна дата 'YYYY-MM-DD'. Саме журнали, а не знімки:
      // це єдині дані сайту, що навмисно накопичують історію.
      bodyLog: {},
      workLog: {},
      // ІСТОРІЯ (етап памʼяті). Форма записів — js/history-core.js.
      // weightLog: історія робочих ваг по вправах (append-only).
      //   weights лишається ПОТОЧНИМ значенням — його читають план,
      //   періодизація і прогноз; weightLog — те, як воно змінювалось.
      // sessionLog: виконання плану по днях (який день, скільки вправ).
      // mealLog: закриті дні харчування (підсумок + ціль того дня).
      weightLog: {},
      sessionLog: {},
      // Заміри тіла: обхвати по датах (js/measure-core.js)
      measureLog: {},
      mealLog: {},
      // МОДУЛЬНІ ТРЕКЕРИ (етап 4). Форма — js/tracker-core.js.
      // trackers:    реєстр { id: {id,type,name,enabled,settings,goal,source,order,createdAt} }.
      //   Убудовані типи (вода/сон/настрій/…) засіваються ліниво через
      //   TrackerCore.ensureBuiltins() при читанні, не тут: так новий тип,
      //   доданий пізніше, з'являється сам, без нової міграції профілю.
      // trackerLog:  дані { trackerId: {'YYYY-MM-DD': value} } — та сама
      //   форма, що bodyLog/workLog.
      trackers: {},
      trackerLog: {},
      // FORGE RATING (етап 5). Форма — js/rating-core.js.
      // ratingLog — ЦЕ КЕШ, не джерело правди: {'YYYY-MM-DD': {rating,delta,quality,reasons}},
      //   будь-коли перебудовується заново RatingCore.recompute() з history + ratingSeen.
      // ratingSeen — коли Rating ВПЕРШЕ побачив кожен факт ('train:D'/'meal:D'/…),
      //   не дата самого факту. Захист від заднього заповнення (див. rating-core.js).
      // ratingAlgorithmVersion — версія формули, якою рахувався ratingLog востаннє;
      //   0 = ще не рахувався. Зміна RatingCore.RATING_ALGORITHM_VERSION у майбутньому
      //   означає повний recompute(), а не тиху розбіжність зі старими числами.
      ratingLog: {},
      ratingSeen: {},
      ratingAlgorithmVersion: 0,
      // Обраний акцент оформлення ('graphite-*'; null = типовий Navy Blue).
      // Кольорові сімʼї прибрані на етапі оформлення; старі id переносить
      // App.normTheme на читанні, а не міграція — щоб імпорт старої копії
      // теж потрапляв під перенесення, а не лише локальний профіль.
      theme: null,
      // Схема поверхонь: 'dark' (типова) | 'light'. Незалежна від акценту.
      scheme: null,
      // Рекорди 1ПМ: { squat: 120, bench: 90, ... }
      records: {},
      // Стан циклу періодизації та знімок скидання ваг.
      // Обидва вже зберігались, але в blankProfile не значились — через це
      // не потрапляли в білий список імпорту й виглядали «зайвими» ключами.
      periodization: null,
      deload: null,
      // Позначка, що разова міграція ваг зі старих планів уже відпрацювала.
      // Без неї вона крутилась при кожному завантаженні й воскрешала
      // щойно скинуті ваги (див. programs.js, harvestWeights).
      weightsHarvested: false,
      // Позначка разового засіву weightLog із поточних weights (migrate 1->2)
      weightLogSeeded: false,
      updatedAt: null
    };
  }

  /**
   * Порожній профіль містить лише null, {} і []. Якщо хоч десь є реальне
   * значення — людина працювала. Це потрібно, щоб при першому вході
   * не затерти місяць локальної роботи порожнім хмарним рядком.
   */
  function isMeaningful(p) {
    if (!p || typeof p !== 'object') return false;
    /*
     * SKIP — поля, які НЕ є ознакою роботи людини.
     *
     * Сюди довелось додати бухгалтерію міграцій, і це був не косметичний
     * недогляд: blankProfile() ставить ratingAlgorithmVersion: 0, а
     * migrate() виставляє weightLogSeeded: true. Нуль не дорівнює false,
     * тож some() спрацьовував на порожньому профілі й isMeaningful()
     * повертав true ЗАВЖДИ. Через це кожен вхід у чистому браузері
     * пропонував «взяти дані з цього браузера», де даних не було.
     */
    const SKIP = { version: 1, updatedAt: 1, theme: 1, scheme: 1, weightsHarvested: 1,
                   weightLogSeeded: 1, ratingAlgorithmVersion: 1,
                   ratingLog: 1, ratingSeen: 1 };
    return Object.keys(p).some(function (k) {
      if (SKIP[k]) return false;
      const v = p[k];
      if (v === null || v === undefined || v === '' || v === false) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    });
  }

  /**
   * Міграції форми даних. Кожен крок піднімає профіль рівно на одну версію,
   * щоб профіль будь-якого віку доїхав до поточної, а не ламався мовчки.
   */
  /**
   * @param {object} p профіль (уже злитий з blankProfile)
   * @param {object|null} [stored] СИРИЙ обʼєкт зі сховища, до злиття
   *
   * stored передається окремо, бо всі виклики виглядають як
   * `migrate(Object.assign(blankProfile(), stored))`, а blankProfile()
   * містить version: SCHEMA_VERSION. Object.assign перезаписує ключ лише
   * тоді, коли він Є у stored — тож профіль, збережений ДО появи поля
   * version, приїжджав сюди вже позначений поточною версією, і жоден крок
   * міграції не спрацьовував. Найбільше від цього страждав крок 1→2: він
   * засіває weightLog із наявних weights, і без нього розділ «Сила» в
   * «Прогресі» лишався порожнім назавжди.
   *
   * Передаємо саме ОБʼЄКТ, а не stored.version: `undefined` як значення
   * («версії не було») і `undefined` як «аргумент не передали» — це два
   * різні випадки, а розрізнити їх по самому значенню неможливо.
   */
  /**
   * Зливає дві історії робочих ваг однієї вправи в одну.
   *
   * Записи ЦІЛЬОВОЇ назви йдуть першими, тож при збігу дати виграють вони:
   * під новою назвою значення свідоміше — його вводили пізніше.
   */
  function mergeWeightLog(fromLog, toLog) {
    const A = Array.isArray(fromLog) ? fromLog : [];
    const B = Array.isArray(toLog) ? toLog : [];
    const seen = Object.create(null);
    const out = [];
    B.concat(A).forEach(function (rec) {
      if (!rec || typeof rec !== 'object' || seen[rec.d]) return;
      seen[rec.d] = 1;
      out.push(rec);
    });
    return out.sort(function (x, y) { return String(x.d) < String(y.d) ? -1 : 1; });
  }

  /**
   * Перейменовує ключі словника за мапою {стара назва: нова}.
   * merge — необовʼязкове злиття, коли обидва ключі зайняті; без нього
   * цільове значення лишається як є, а старе зникає.
   */
  function renameKeys(box, map, merge) {
    if (!box || typeof box !== 'object') return;
    Object.keys(map).forEach(function (from) {
      const to = map[from];
      if (from === to || !Object.prototype.hasOwnProperty.call(box, from)) return;
      if (!Object.prototype.hasOwnProperty.call(box, to)) box[to] = box[from];
      else if (merge) box[to] = merge(box[from], box[to]);
      delete box[from];
    });
  }

  /** Та сама мапа — і по збережених правках планів, і по вагах. */
  function renameExercises(p, map) {
    const plans = p.customPlans;
    if (plans && typeof plans === 'object') {
      Object.keys(plans).forEach(function (key) {
        const days = plans[key];
        if (!Array.isArray(days)) return;
        days.forEach(function (day) {
          const list = day && day.exercises;
          if (!Array.isArray(list)) return;
          list.forEach(function (ex) {
            if (ex && typeof ex === 'object' && map[ex.name]) ex.name = map[ex.name];
          });
        });
      });
    }
    /* Поточна вага: під новою назвою значення свідоміше — воно й лишається. */
    renameKeys(p.weights, map, null);
    /* Історія ваг: НІЧОГО не втрачаємо, записи зливаються за датою. */
    renameKeys(p.weightLog, map, mergeWeightLog);
  }

  function migrate(p, stored) {
    if (!p || typeof p !== 'object') return p;
    const hasStored = stored !== undefined && stored !== null && typeof stored === 'object';
    let v = Number(hasStored ? stored.version : p.version) || 0;

    // 0 -> 1: поля periodization/deload/weightsHarvested зʼявились у blankProfile.
    // Дані вже могли там бути (їх писали програми), тож нічого не рухаємо —
    // достатньо проставити версію, щоб наступні кроки знали, звідки починати.
    if (v < 1) { v = 1; }

    /*
     * 1 -> 2: зʼявилась історія (weightLog / sessionLog / mealLog).
     *
     * Старі профілі мають лише поточні ваги. Засіваємо weightLog одним
     * записом на вправу з СЬОГОДНІШНЬОЮ датою: чесніше не вигадувати
     * минуле, якого ніхто не записував, — історія починається з моменту,
     * коли її почали вести. Позначка weightLogSeeded не дає міграції
     * крутитись повторно й воскрешати скинуті ваги (той самий урок,
     * що з weightsHarvested).
     */
    if (v < 2) {
      if (!p.weightLog || typeof p.weightLog !== 'object') p.weightLog = {};
      if (!p.sessionLog || typeof p.sessionLog !== 'object') p.sessionLog = {};
      if (!p.mealLog || typeof p.mealLog !== 'object') p.mealLog = {};

      if (!p.weightLogSeeded && p.weights && typeof p.weights === 'object') {
        const d = new Date();
        const key = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        Object.keys(p.weights).forEach(function (name) {
          const kg = Number(p.weights[name]);
          if (!Number.isFinite(kg) || kg < 0) return;
          if (Array.isArray(p.weightLog[name]) && p.weightLog[name].length) return;
          p.weightLog[name] = [{ d: key, kg: kg }];
        });
      }
      p.weightLogSeeded = true;
      v = 2;
    }

    /*
     * 2 -> 3: зʼявились модульні трекери (вода/сон/настрій/…).
     *
     * Тут лише гарантія типу — порожні обʼєкти, якщо їх не було. Сам
     * каталог убудованих трекерів (хто увімкнений за замовчуванням) не
     * засівається тут: цим займається TrackerCore.ensureBuiltins() при
     * кожному читанні на сторінках, що показують трекери. Це навмисно
     * не міграція «раз назавжди» — інакше новий тип трекера з наступного
     * етапу знову вимагав би підняття SCHEMA_VERSION.
     */
    if (v < 3) {
      if (!p.trackers || typeof p.trackers !== 'object') p.trackers = {};
      if (!p.trackerLog || typeof p.trackerLog !== 'object') p.trackerLog = {};
      v = 3;
    }

    /*
     * 3 -> 4: зʼявився Forge Rating.
     *
     * Лише гарантія типу — ratingLog/ratingSeen порожні, ratingAlgorithmVersion 0.
     * Свідомо НЕ рахуємо тут перший ratingLog: recompute() потребує window.HistoryCore
     * (сторінка, не store.js) і має відпрацювати один раз при першому відкритті
     * rating.html/today.html — там і виставиться ratingAlgorithmVersion.
     */
    if (v < 4) {
      if (!p.ratingLog || typeof p.ratingLog !== 'object') p.ratingLog = {};
      if (!p.ratingSeen || typeof p.ratingSeen !== 'object') p.ratingSeen = {};
      if (!Number.isFinite(Number(p.ratingAlgorithmVersion))) p.ratingAlgorithmVersion = 0;
      v = 4;
    }

    /*
     * 4 -> 5: версія, під якою на етапі 6 існувало «Обране».
     *
     * Функцію прибрано на етапі 7, тож крок нічого не додає — але номер
     * лишається зайнятим назавжди. Перевикористати 5 під щось інше не можна:
     * профілі, які вже дійшли до 5, пропустили б новий крок мовчки.
     */
    if (v < 5) { v = 5; }

    /*
     * 5 -> 6: додано birthDate — дата народження як джерело правди про вік.
     *
     * Старим профілям її не вигадуємо: з числа age відновити дату
     * неможливо (у 30-річного це діапазон завдовжки в рік), а поставити
     * приблизну означало б підсунути людині чужі дані про себе. Тому
     * birthDate лишається null, і на першому ж відкритті сторож
     * (js/agegate.js) попросить її ввести — рівно один екран.
     *
     * Саме age при цьому не чіпаємо: розрахунки харчування й пульсу
     * читають його далі, а після проходження гейта воно перезапишеться
     * значенням, порахованим із дати.
     */
    if (v < 6) {
      if (typeof p.birthDate !== 'string') p.birthDate = null;
      v = 6;
    }
    if (v < 7) {
      if (typeof p.displayName !== 'string') p.displayName = null;
      if (p.pet === undefined) p.pet = null;
      v = 7;
    }
    /*
     * 7 -> 8: зʼявилась друга вісь оформлення — схема (світло/темрява).
     *
     * Акцент НЕ чіпаємо навмисно. Прибрані кольорові id ('pink', 'wood', …)
     * лишаються в профілі як є, а переносить їх App.normTheme на читанні:
     * так під перенесення потрапляє і профіль з хмари, і щойно імпортована
     * резервна копія, а не лише той рядок, який один раз пройшов міграцію.
     */
    if (v < 8) {
      if (p.scheme !== 'light' && p.scheme !== 'dark') p.scheme = null;
      v = 8;
    }

    /* 9: зʼявились заміри тіла (measureLog). */
    if (v < 9) {
      if (!p.measureLog || typeof p.measureLog !== 'object' || Array.isArray(p.measureLog)) p.measureLog = {};
      v = 9;
    }

    /*
     * 9 -> 10: вправу перейменовано в реєстрі — переносимо назву і в
     * ЗБЕРЕЖЕНІ ПРАВКИ ПЛАНІВ.
     *
     * customPlans — заморожена копія плану з редактора, і вона СИЛЬНІША за
     * реєстр: js/workout-core.js бере її першою. Тому правка назви у
     * js/programs-data.js сама по собі до людини не доходить — на екрані
     * лишається стара назва, а робоча вага, ключована назвою, висить під
     * старим ключем і в новий рядок не підставляється.
     *
     * Перейменування — не редагування плану: стару назву людина не
     * обирала, це та сама вправа. Тому переносимо мовчки.
     *
     * ІСТОРІЮ НЕ ЧІПАЄМО: sessionLog зберігає день і кількість вправ, а не
     * назви, тож переписувати там нічого. weightLog — історія саме цієї
     * вправи, і вона переїжджає разом із назвою, а не зникає.
     */
    if (v < 10) {
      renameExercises(p, {
        'Згинання ніг': 'Згинання ніг сидячи',
        'Згинання ніг лежачи': 'Згинання ніг сидячи'
      });
      v = 10;
    }

    /*
     * Зняття legacy-поля favorites («Обране», етап 6; прибране на етапі 7).
     *
     * Свідомо БЕЗ версійного гейта: профілі, що вже мають version 5, жодного
     * кроку міграції більше не проходять, а поле в них лежить. Та й імпорт
     * старого експорту приносить його знову — і мовчазне воскресіння ключа,
     * якого код більше не знає, гірше за зайвий рядок тут. Дані від цього не
     * страждають: нічого, крім самого «Обраного», на це поле не спиралось.
     */
    if (p.favorites !== undefined) delete p.favorites;

    p.version = v;
    return p;
  }

  function readLocalProfile() {
    const stored = lsGet(LS_PROFILE, {});
    return migrate(Object.assign(blankProfile(), stored), stored);
  }

  /* ------------------------------------------------------------------ */
  /* HTTP до Supabase                                                    */
  /* ------------------------------------------------------------------ */

  /*
   * КУДИ ПОВЕРТАЄ ЛИСТ.
   *
   * GoTrue кладе в лист адресу з параметра redirect_to; якщо його не
   * передати — бере Site URL із налаштувань проєкту. Поки там стояв
   * http://localhost:3000, КОЖЕН лист підтвердження вів людину на мертву
   * сторінку: сервер пошту підтверджував (303 і email_confirmed_at у базі),
   * а людина бачила «не вдається відкрити сторінку» й вважала, що
   * реєстрація не пройшла. Саме так і загубився перший сторонній
   * користувач.
   *
   * Ціль — welcome.html, а не корінь: токени приходять у ФРАГМЕНТІ
   * (#access_token=…), а фрагмент не переживає редиректу сторожа
   * (js/agegate.js) з index.html. Приймає їх лише welcome.js.
   *
   * Порожньо для file:// — там origin дорівнює 'null', і такий
   * redirect_to GoTrue відкине.
   *
   * Адресу все одно має бути дозволено в Supabase → Authentication →
   * URL Configuration → Redirect URLs, інакше сервер мовчки підставить
   * Site URL. Тобто це половина полагодження, друга половина — там.
   */
  function emailRedirect() {
    try {
      if (typeof location === 'undefined') return '';
      if (!/^https?:$/.test(location.protocol || '')) return '';
      const origin = location.origin;
      if (!origin || origin === 'null') return '';
      return origin + '/welcome.html';
    } catch (_) { return ''; }
  }

  /** Додати redirect_to до шляху auth-запиту, якщо адресу вдалось скласти. */
  function withRedirect(path) {
    const to = emailRedirect();
    if (!to) return path;
    return path + (path.indexOf('?') === -1 ? '?' : '&') +
           'redirect_to=' + encodeURIComponent(to);
  }

  function authHeaders(useSession) {
    const h = { 'apikey': KEY, 'Content-Type': 'application/json' };
    h['Authorization'] = (useSession !== false && session && session.access_token)
      ? 'Bearer ' + session.access_token
      : 'Bearer ' + KEY;
    return h;
  }

  /*
   * Людський текст замість коду Supabase.
   *
   * Раніше сюди йшов сирий англійський рядок — і людина бачила
   * «email rate limit exceeded» без жодної підказки, що робити далі.
   * Найважливіший тут саме ліміт листів: у вбудованої пошти Supabase він
   * низький, і при кількох спробах поспіль реєстрація просто перестає
   * працювати на годину — виглядає як «сайт зламався».
   */
  const AUTH_MSG = {
    over_email_send_rate_limit:
      'Забагато листів за короткий час. Пошта підтвердження тимчасово недоступна — ' +
      'спробуйте за годину або увійдіть, якщо акаунт уже створено.',
    email_not_confirmed:
      'Пошту ще не підтверджено. Відкрийте лист і натисніть посилання в ньому.',
    invalid_credentials:
      'Пошта або пароль не підходять.',
    user_already_exists:
      'Ця пошта вже зареєстрована.',
    email_exists:
      'Ця пошта вже зареєстрована.',
    weak_password:
      'Пароль надто простий — додайте довжини й різних символів.',
    over_request_rate_limit:
      'Забагато спроб поспіль. Зачекайте хвилину й повторіть.',
    validation_failed:
      'Дані у формі не пройшли перевірку.',
    signup_disabled:
      'Реєстрація тимчасово вимкнена на сервері.'
  };

  function authMessage(code, raw, status) {
    if (code && AUTH_MSG[code]) return AUTH_MSG[code];
    if (status === 429) return AUTH_MSG.over_request_rate_limit;
    return raw;
  }

  async function req(path, options) {
    const opts = options || {};
    const headers = Object.assign(authHeaders(opts.auth), opts.headers || {});

    let res;
    try {
      res = await fetch(URL_ + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        keepalive: opts.keepalive === true
      });
    } catch (e) {
      // Мережі немає. Розрізняти це від помилки сервера важливо:
      // офлайн ставимо в чергу, 4xx у чергу ставити марно.
      const err = new Error('Немає звʼязку з сервером');
      err.offline = true;
      throw err;
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = text; }
    }

    if (!res.ok) {
      const raw = (data && (data.error_description || data.msg || data.message || data.error)) ||
                  ('HTTP ' + res.status);
      /* Машинний код Supabase зберігаємо окремо від тексту: інтерфейс має
         розрізняти «пошта не підтверджена» й «пароль не той» — англійський
         рядок для цього не годиться, а перекладений тим паче. */
      const code = (data && (data.error_code || data.code)) || '';
      const err = new Error(authMessage(code, raw, res.status));
      err.code = code;
      err.rawMessage = raw;
      err.status = res.status;

      /*
       * 401/403 від PostgREST означає, що сесія більше не чинна на СЕРВЕРІ:
       * змінили пароль, натиснули «вийти з усіх пристроїв», відкликали токен.
       * Локальний expires_at про це не знає, тому без цієї гілки кожне
       * збереження вічно падало б із «JWT expired», а користувач так і не
       * зрозумів би, що треба просто перезайти.
       */
      /*
       * 401 і 403 — РІЗНІ речі, і плутати їх не можна.
       *
       * 401 — сесії немає або токен не чинний: перезайти.
       * 403 — сесія чинна, але прав на цей рядок немає. Для Forge це
       *       звичайний стан акаунта зі статусом pending: RLS не пускає
       *       його до profiles. Раніше 403 теж стирав сесію, тому людина
       *       з правильним паролем бачила «Не вдалося увійти» одразу
       *       після успішного входу.
       */
      /*
       * ОДНА СПРОБА ОНОВИТИ, і лише потім вихід.
       *
       * Це й був головний спосіб «мовчки вилетіти з акаунта»: локальний
       * expires_at ще не минув (годинник пристрою відстає, вкладка спала,
       * інша вкладка вже прокрутила токен), сервер віддає 401 — і сесія
       * стиралась НАЗАВЖДИ, хоч refresh_token був цілком робочий.
       */
      if (res.status === 401 && opts.auth !== false && !opts.noRetry &&
          session && session.refresh_token) {
        const revived = await doRefresh();
        if (revived) {
          return req(path, Object.assign({}, opts, { noRetry: true }));
        }
      }

      if (res.status === 401 && opts.auth !== false) {
        err.authExpired = true;
        clearSession();
        emit();
      } else if (res.status === 403) {
        err.forbidden = true;
      }
      throw err;
    }
    return data;
  }

  /* ------------------------------------------------------------------ */
  /* «Запамʼятати мене»                                                  */
  /* ------------------------------------------------------------------ */
  /*
   * Сесія лежить у localStorage (переживає закриття браузера) або в
   * sessionStorage (живе рівно стільки, скільки вкладка). Вибір робить
   * людина галочкою на вході; типово — запамʼятовуємо, бо телефон у залі
   * не місце для повторного вводу пароля між підходами.
   *
   * Прапорець зберігається ОКРЕМО від сесії: після виходу він має
   * пережити стирання сесії, інакше галочка щоразу поверталась би в
   * типовий стан і «не запамʼятовувати» на спільному компʼютері
   * доводилось би ставити при кожному вході.
   */
  function rememberOn() {
    try { return localStorage.getItem(LS_REMEMBER) !== '0'; } catch (_) { return true; }
  }

  function sessionStore() {
    try { return rememberOn() ? localStorage : sessionStorage; }
    catch (_) { return localStorage; }
  }

  function readSavedSession() {
    /* Читаємо ОБИДВА сховища: людина могла зняти галочку, а вкладка з
       попередньою сесією ще жива — і навпаки. */
    for (const box of [localStorage, sessionStorage]) {
      try {
        const raw = box.getItem(LS_SESSION);
        if (!raw) continue;
        const v = JSON.parse(raw);
        if (v && v.access_token) return v;
      } catch (_) { /* наступне сховище */ }
    }
    return null;
  }

  function writeSavedSession(v) {
    const keep = sessionStore();
    const drop = keep === localStorage ? sessionStorage : localStorage;
    try { drop.removeItem(LS_SESSION); } catch (_) {}
    try { keep.setItem(LS_SESSION, JSON.stringify(v)); return true; }
    catch (_) { return false; }
  }

  function storeSession(s) {
    if (!s || !s.access_token) return;
    session = {
      access_token:  s.access_token,
      /* Ротація: сервер видає новий refresh_token при кожному оновленні,
         але у відповіді на деякі виклики його немає — тоді лишаємо той,
         що вже маємо, інакше наступне оновлення нічим було б робити і
         людину викидало б рівно через годину. */
      refresh_token: s.refresh_token || (session && session.refresh_token) || '',
      // expires_in приходить у секундах
      expires_at:    Date.now() + (Number(s.expires_in || 3600) * 1000),
      user:          s.user ? { id: s.user.id, email: s.user.email }
                            : (session && session.user) || null
    };
    writeSavedSession(session);
  }

  /*
   * Звірити власника локальних даних із поточною сесією.
   *
   * Викликається і при вході, і при відновленні сесії. Позначку НЕ можна
   * ставити в storeSession: вона виконується ДО resolveFirstLogin, і тоді
   * порівнювати вже не було б із чим — чужі дані виглядали б своїми.
   *
   * Повертає true, якщо локальні дані належали іншій людині й були
   * відкладені (нічого не видалено назавжди: попередній користувач
   * побачить їх, коли ввійде знову).
   */
  function enforceOwner(local) {
    const me = (session && session.user) ? session.user.id : null;
    if (!me) return false;
    const owner = lsGet(LS_OWNER, null);
    if (!owner) { lsSet(LS_OWNER, me); return false; }
    if (owner === me) return false;

    lsSet(LS_BACKUP_LOGIN, Object.assign(
      { savedAt: new Date().toISOString(), owner: owner },
      local || lsGet(LS_PROFILE, {})));
    [LS_PROFILE, LS_PENDING, DIRTY_KEY].concat(ELO_KEYS).forEach(function (k) {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    cache = null;
    lsSet(LS_OWNER, me);
    return true;
  }

  /**
   * Забути ТОКЕН. Дані лишаються на місці.
   *
   * Викликається з двох місць, де сесія перестала бути чинною на сервері
   * (401/403 і невдалий refresh). Раніше ця сама функція заодно стирала
   * ib.profile та ib.pending — і це була найдорожча помилка у файлі:
   *
   *   людина працює офлайн, патчі лежать у черзі, локальний профіль свіжий →
   *   мережа повертається → GET профілю → 403 (RLS, відкликаний токен,
   *   призупинений проєкт) → стиралась ЄДИНА копія даних, яка ще нікуди
   *   не доїхала. Резервної копії немає: ib.profile.backup пишеться лише
   *   при першому вході й імпорті.
   *
   * Прострочений токен — не привід знищувати дані. Він привід попросити
   * перезайти. Прибирання чужих даних у спільному браузері лишається за
   * ЯВНИМ виходом (signOut) — там для цього clearIdentityData().
   */
  function clearSession() {
    session = null;
    cache = null;
    try { localStorage.removeItem(LS_SESSION); } catch (_) {}
    try { sessionStorage.removeItem(LS_SESSION); } catch (_) {}
  }

  /**
   * Явний вихід: прибрати й профіль, і чергу.
   *
   * У спільному браузері наступна людина не повинна бачити чужі дані, і —
   * гірше — варто було б їй щось змінити, як saveProfile злив би чужий
   * профіль зі своїм патчем і відправив усе це в ЇЇ хмарний рядок.
   * Викликається ТІЛЬКИ з signOut, де людина сама попросила вийти.
   */
  function clearIdentityData() {
    clearSession();
    [LS_PROFILE, LS_PENDING, LS_ACCOUNT, LS_OWNER, LS_BACKUP_LOGIN]
      .concat(ELO_KEYS).forEach(function (k) {
        try { localStorage.removeItem(k); } catch (_) {}
      });
    try { localStorage.removeItem(DIRTY_KEY); } catch (_) {}
  }

  /*
   * Чи має сенс ходити в мережу по профіль. Поки акаунт не approved,
   * RLS однаково відповість 403 — тож не шумимо запитами і не плодимо
   * чергу: дані реєстрації живуть локально до підтвердження. Це UX-шар;
   * справжній барʼєр — політики Postgres.
   */
  /*
   * Чи можна писати в хмару. FAIL-CLOSED: без відомого статусу — не можна.
   *
   * Було `!a || a.status === 'approved'`, тобто відсутність кешу означала
   * «дозволено». Перший запис не-approved акаунта йшов у хмару, отримував
   * 403 і (через попередній баг) знищував сесію. Тепер невідомий статус
   * означає «почекати, поки статус приїде», а не «спробувати й зламатись».
   */
  function cloudAllowed() {
    const a = lsGet(LS_ACCOUNT, null);
    return !!(a && a.status === 'approved');
  }

  /**
   * Оновити токен, якщо лишилось менше хвилини життя.
   *
   * ОДНА обіцянка на всіх. Supabase ротує refresh-токени: повторне
   * використання вже витраченого відкликає ВСЮ сесію. На plan.html профіль
   * паралельно читають три модулі, тож без цього локу вони слали три
   * одночасні refresh з одним токеном — і користувача мовчки викидало.
   */
  let refreshing = null;

  /** Безумовне оновлення токена (одна обіцянка на всіх викликів) */
  function doRefresh() {
    if (!session || !session.refresh_token) return Promise.resolve(false);
    if (refreshing) return refreshing;

    refreshing = (async function () {
      try {
        const data = await req('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          auth: false,
          body: { refresh_token: session.refresh_token }
        });
        storeSession(data);
        return true;
      } catch (e) {
        // Мережа лягла — сесію не чіпаємо: токен, найімовірніше, ще живий,
        // просто зараз до сервера не достукатись. Викидати людину з акаунта
        // через втрачений Wi-Fi — це і є та «тиха втрата», яку тут ловимо.
        if (e && e.offline) return false;
        clearSession();
        emit();
        return false;
      } finally {
        refreshing = null;
      }
    })();

    return refreshing;
  }

  async function ensureFresh() {
    if (!session) return false;
    if (Date.now() < session.expires_at - 60000) return true;
    if (!session.refresh_token) { clearSession(); emit(); return false; }
    return doRefresh();
  }

  /* ------------------------------------------------------------------ */
  /* Черга незбережених патчів                                           */
  /* ------------------------------------------------------------------ */

  /*
   * Офлайн-зміни раніше нікуди не доїжджали: патч лягав у localStorage,
   * а getProfile при живій хмарі завжди віддавав перевагу хмарі й локальну
   * копію ігнорував. Людина заповнювала тренування в метро, вдома відкривала
   * сайт — і бачила вчорашні дані.
   *
   * Тепер кожен патч, який не долетів, лишається в черзі; вона розсмоктується
   * при події online і при наступному завантаженні сторінки.
   */

  function pendingGet() {
    const q = lsGet(LS_PENDING, []);
    return Array.isArray(q) ? q : [];
  }

  /**
   * @returns {boolean} чи патч РЕАЛЬНО ліг у чергу.
   *
   * Раніше результат lsSet тут викидався, і при переповненому сховищі
   * doSave однаково кидав помилку з ознакою .queued — тобто інтерфейс
   * казав «збережеться, коли зʼявиться мережа», хоч патч не було записано
   * взагалі нікуди. Це саме та тиха втрата, яку коментар біля lsSet
   * оголошує закритою.
   */
  function pendingPush(patch) {
    const q = pendingGet();
    q.push({ at: Date.now(), patch: patch });
    // Черга не має рости нескінченно: 200 патчів — це вже кількасот КБ.
    return lsSet(LS_PENDING, q.slice(-200));
  }

  /*
   * ОДИН ланцюг записів на вкладку.
   *
   * flushPending робить власний read-modify-write профілю (getProfile →
   * накладання патчів → pushToCloud → перезапис cache і ib.profile) і
   * викликався з трьох місць повз saveChain. Коли мережа поверталась
   * (подія online) саме під час збереження, flush устигав перезаписати
   * cache своїм старішим знімком — після зеленого тоста «збережено».
   * Тепер обидві операції стоять в одну чергу.
   */
  function queueWrite(fn) {
    saveChain = saveChain.then(fn, fn);
    return saveChain;
  }

  function flushPending() {
    return queueWrite(doFlushPending);
  }

  async function doFlushPending() {
    if (!CLOUD || !session) return 0;
    const q = pendingGet();
    if (!q.length) return 0;

    const ok = await ensureFresh();
    if (!ok) return 0;

    // Патчі накладаються по порядку на поточний профіль, і в хмару йде
    // один запис — так само, як зробив би звичайний saveProfile.
    let merged = await api.getProfile();
    q.forEach(function (item) {
      if (item && item.patch) merged = Object.assign({}, merged, item.patch);
    });
    merged.updatedAt = new Date().toISOString();

    await pushToCloud(merged);

    cache = merged;
    lsSet(LS_PROFILE, merged);

    /*
     * Знімаємо з черги РІВНО те, що відправили, а не всю чергу.
     *
     * Між знімком q і цим рядком стоять два мережні виклики (getProfile і
     * pushToCloud). Якщо за цей час звʼязок знову впав і doSave устиг
     * покласти новий патч, removeItem видаляв би його разом із рештою —
     * після того, як інтерфейс уже пообіцяв, що патч у черзі.
     */
    const after = pendingGet();
    if (after.length > q.length) {
      lsSet(LS_PENDING, after.slice(q.length));
    } else {
      try { localStorage.removeItem(LS_PENDING); } catch (_) {}
    }
    emit();
    return q.length;
  }

  function markDirty() {
    try { localStorage.setItem(DIRTY_KEY, String(Date.now())); } catch (_) {}
  }
  function clearDirty() {
    try { localStorage.removeItem(DIRTY_KEY); } catch (_) {}
  }
  function isDirty() {
    try { return !!localStorage.getItem(DIRTY_KEY); } catch (_) { return false; }
  }

  async function pushToCloud(profile, keepalive) {
    markDirty();
    const out = await req('/rest/v1/profiles?on_conflict=user_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: [{ user_id: session.user.id, data: profile }],
      keepalive: keepalive === true
    });
    clearDirty();
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Публічний API                                                       */
  /* ------------------------------------------------------------------ */

  /*
   * Збереження виконуються ПОСЛІДОВНО.
   *
   * saveProfile — це read-modify-write. Два паралельні виклики на щойно
   * завантаженій сторінці (наприклад, renderProfile ще чекає на getProfile,
   * а людина вже клікнула тему) будували next з однакової бази, і той, хто
   * фінішував другим, затирав чужий патч. Черга це прибирає всередині вкладки.
   *
   * Між ПРИСТРОЯМИ це не рятує: там і далі last-write-wins цілим обʼєктом.
   * Чесний фікс — версія рядка й перевірка при записі, але це вимагає
   * окремої колонки та іншої схеми; поки що обмеження назване вголос.
   */
  let saveChain = Promise.resolve();
  /* Скільки записів у хмару зараз у польоті. Читає saveProfileBeacon:
     він працює поза saveChain (сторінка вже закривається, чекати нічого),
     і без цього прапорця міг обігнати незавершений saveProfile. */
  let saveInFlight = 0;

  const api = {
    mode: CLOUD ? 'cloud' : 'local',
    isCloud: CLOUD,

    user: function () {
      if (!CLOUD) return null;
      return session && session.user ? session.user : null;
    },

    onChange: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },

    /**
     * «Запамʼятати мене»: чи тримати сесію між сеансами браузера.
     *
     * Без аргументу — читає стан (типово true). З аргументом — ставить і
     * ОДРАЗУ переносить поточну сесію в потрібне сховище: людина знімає
     * галочку вже після входу, і без переносу вона б нічого не зробила.
     */
    remember: function (on) {
      if (on === undefined) return rememberOn();
      try { localStorage.setItem(LS_REMEMBER, on ? '1' : '0'); } catch (_) {}
      if (session) writeSavedSession(session);
      return rememberOn();
    },

    pendingCount: function () { return pendingGet().length; },
    flushPending: flushPending,

    /**
     * Виклик серверної функції (PostgREST RPC) від імені сесії.
     * Єдиний шлях, яким шар ELO говорить із базою: клієнт не пише в
     * таблиці рейтингу напряму — все рахує сервер.
     */
    rpc: async function (name, args) {
      if (!CLOUD) { const e = new Error('Хмарний режим вимкнено'); e.local = true; throw e; }
      await ensureFresh();
      if (!session || !session.access_token) {
        const e = new Error('Потрібен вхід в акаунт'); e.noauth = true; throw e;
      }
      return req('/rest/v1/rpc/' + encodeURIComponent(name), {
        method: 'POST',
        body: args || {}
      });
    },

    /* ---- Статус акаунта (заявки/підтвердження) ---- */

    /**
     * Стан акаунта з сервера: none | pending | approved | rejected |
     * blocked (+ isAdmin). Кешується в localStorage для синхронного
     * сторожа й швидких рішень UI; джерело правди — RPC + RLS.
     */
    refreshAccountState: async function () {
      if (!CLOUD || !session) return null;
      try {
        const st = await api.rpc('account_state');
        if (st && st.status) lsSet(LS_ACCOUNT, { status: st.status, username: st.username || null, isAdmin: Boolean(st.isAdmin), t: Date.now() });
        return st;
      } catch (e) {
        // AUTH_REQUIRED тощо — кеш не чіпаємо, хай вирішує наступний виклик
        return null;
      }
    },

    /** Кешований стан акаунта (sync). null — ще не питали. */
    accountCached: function () { return lsGet(LS_ACCOUNT, null); },

    /**
     * Повне видалення акаунта: серверний RPC delete_account() зносить
     * запис auth.users, і каскади прибирають профіль, журнали, рейтинг,
     * статус заявки і журнал згод. Після успіху чистимо все локальне.
     */
    deleteAccount: async function () {
      if (!CLOUD) throw new Error('Хмарний режим вимкнено');
      await api.rpc('delete_account');
      clearIdentityData();
      try { localStorage.removeItem(LS_BACKUP); } catch (_) {}
      emit();
      return true;
    },

    /* ---- Авторизація ---- */

    signUp: async function (email, password) {
      if (!CLOUD) throw new Error('Хмарний режим вимкнено. Заповніть ключі Supabase у js/config.js.');
      const local = readLocalProfile();
      const data = await req(withRedirect('/auth/v1/signup'), {
        method: 'POST', auth: false,
        body: { email: email, password: password }
      });

      // Якщо в проєкті увімкнене підтвердження пошти — сесії ще немає
      if (data && data.access_token) {
        storeSession(data);
        cache = null;
        await api.refreshAccountState();
        const merge = await resolveFirstLogin(local);
        emit();
        return { confirmed: true, merge: merge };
      }

      /*
       * ПОШТА ВЖЕ ЗАРЕЄСТРОВАНА — і це НЕ помилка з погляду Supabase.
       *
       * Щоб не давати стороннім перевіряти, чи є така пошта в базі, сервер
       * на повторну реєстрацію відповідає 200 і схожим на справжній
       * обʼєктом користувача. Відрізнити можна одним полем: у
       * несправжнього identities порожній.
       *
       * Без цієї гілки людина з уже створеним акаунтом потрапляла на екран
       * «Підтвердіть пошту», якого ніколи не пройде: листа немає, а пароль
       * в акаунті лишився СТАРИЙ — новий, щойно введений, не підійде
       * ніколи. Саме в цей тупик впирались реальні спроби реєстрації.
       */
      const u = (data && data.user) ? data.user : data;
      if (u && Array.isArray(u.identities) && u.identities.length === 0) {
        return { confirmed: false, exists: true };
      }
      return { confirmed: false };
    },

    /**
     * Прийняти сесію з URL після кліку в листі.
     *
     * Supabase повертає людину на сайт із токенами у ФРАГМЕНТІ адреси
     * (#access_token=…&type=signup|recovery). Досі їх ніхто не читав —
     * тому після підтвердження пошти людина поверталась на сайт
     * НЕ ввійденою, і мусила тиснути «Я підтвердив» та вводити пароль
     * ще раз. Саме там усе й ламалось, якщо пароль виявлявся іншим.
     *
     * Фрагмент прибираємо одразу: токен не має лишатись ні в адресному
     * рядку, ні в історії, ні в Referer наступного переходу.
     *
     * @returns {{type: string}|null} тип події з листа, якщо сесію взято
     */
    adoptUrlSession: async function () {
      if (!CLOUD) return null;
      let h = '';
      try { h = String(location.hash || '').replace(/^#/, ''); } catch (_) { return null; }
      if (!h) return null;

      /*
       * Помилка замість токенів. Supabase повертає її тим самим фрагментом
       * (#error=access_denied&error_code=otp_expired) — це найчастіший
       * фінал листа, який пролежав добу або який уже відкривали. Без цієї
       * гілки фрагмент мовчки ігнорувався: людина приходила на стартовий
       * екран без жодного пояснення, чому підтвердження не спрацювало.
       */
      if (h.indexOf('error=') !== -1 && h.indexOf('access_token=') === -1) {
        const eq = new URLSearchParams(h);
        const code = eq.get('error_code') || eq.get('error') || '';
        try { history.replaceState(null, '', location.pathname + location.search); }
        catch (_) { try { location.hash = ''; } catch (_2) {} }
        const err = new Error(/expired/i.test(code)
          ? 'Посилання з листа застаріло. Надішліть новий лист і відкрийте його одразу.'
          : 'Посилання з листа не спрацювало. Надішліть новий лист.');
        err.code = 'link_error';
        throw err;
      }

      if (h.indexOf('access_token=') === -1) return null;

      const q = new URLSearchParams(h);
      const at = q.get('access_token');
      const rt = q.get('refresh_token');
      if (!at) return null;

      const expIn = parseInt(q.get('expires_in') || '3600', 10);
      storeSession({
        access_token: at,
        refresh_token: rt || '',
        expires_in: isFinite(expIn) ? expIn : 3600,
        user: null
      });
      /* Фрагмент прибираємо ДО мережевих викликів: якщо запит нижче впаде,
         токен усе одно не лишиться в адресному рядку. */
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (_) { try { location.hash = ''; } catch (_2) {} }

      /* У фрагменті приходять лише токени, без даних користувача, а
         storeSession без них лишає user: null — і Store.user() каже
         «не ввійшов» при цілком робочій сесії. Тому питаємо сервер. */
      try {
        const me = await req('/auth/v1/user', { method: 'GET' });
        if (me && me.id) {
          session.user = { id: me.id, email: me.email };
          writeSavedSession(session);   // те саме сховище, що й решта входів
        }
      } catch (e) {
        // Прострочене або вже використане посилання з листа.
        clearSession();
        emit();
        const err = new Error('Посилання з листа вже використане або застаріле. Надішліть новий лист.');
        err.code = 'link_expired';
        throw err;
      }
      cache = null;
      emit();
      return { type: q.get('type') || 'signup' };
    },

    /** Лист для відновлення пароля. */
    requestPasswordReset: async function (email) {
      if (!CLOUD) throw new Error('Хмарний режим вимкнено.');
      return req(withRedirect('/auth/v1/recover'), {
        method: 'POST', auth: false,
        body: { email: email }
      });
    },

    /** Новий пароль для поточної сесії (після листа відновлення). */
    updatePassword: async function (password) {
      if (!CLOUD) throw new Error('Хмарний режим вимкнено.');
      if (!session) throw new Error('Немає активної сесії.');
      const data = await req('/auth/v1/user', {
        method: 'PUT',
        body: { password: password }
      });
      return data;
    },

    /**
     * Надіслати лист підтвердження ще раз.
     * Окремий метод, бо екран підтвердження — єдине місце, де людина
     * може застрягти без жодної дії: лист не дійшов, а зробити нічого.
     */
    resendConfirmation: async function (email) {
      if (!CLOUD) throw new Error('Хмарний режим вимкнено.');
      return req(withRedirect('/auth/v1/resend'), {
        method: 'POST', auth: false,
        body: { type: 'signup', email: email }
      });
    },

    /**
     * Вхід повертає { user, merge }.
     *
     * merge — це те, що НЕ можна вирішити за людину:
     *   null              — питати нічого, дані одні
     *   'adopted'         — локальні дані залиті в порожній хмарний рядок
     *   'conflict'        — непорожні обидва, чекаємо на вибір користувача
     *
     * До цієї гілки перший вхід просто затирав локальну роботу: хмарний рядок
     * порожній -> Object.assign(blankProfile(), null) -> перше ж збереження
     * писало бланк поверх усього, що людина накопичила за місяць.
     */
    signIn: async function (email, password) {
      if (!CLOUD) throw new Error('Хмарний режим вимкнено. Заповніть ключі Supabase у js/config.js.');
      const local = readLocalProfile();
      const data = await req('/auth/v1/token?grant_type=password', {
        method: 'POST', auth: false,
        body: { email: email, password: password }
      });
      storeSession(data);
      cache = null;
      await api.refreshAccountState();
      const merge = await resolveFirstLogin(local);
      emit();
      return { user: api.user(), merge: merge };
    },

    signOut: async function () {
      if (CLOUD && session) {
        try { await req('/auth/v1/logout', { method: 'POST' }); } catch (_) {}
      }
      // Явний вихід — єдине місце, де дані в браузері прибираються разом
      // із токеном (див. коментар біля clearIdentityData).
      clearIdentityData();
      emit();
    },

    /* ---- Розвʼязання конфлікту першого входу ---- */

    /** Залити локальний профіль у хмару (кнопка «взяти мої дані з цього браузера») */
    adoptLocalProfile: async function () {
      /* Саме копія ВХОДУ, не копія перед імпортом: це розвʼязання
         конфлікту входу, і брати чужий слот означало б відкотити імпорт. */
      const local = lsGet(LS_BACKUP_LOGIN, null);
      if (!local) throw new Error('Резервної копії немає.');
      cache = migrate(Object.assign(blankProfile(), local), local);
      return api.saveProfile({});
    },

    /** Лишити хмарний, локальний викинути (він лишається в резервній копії) */
    discardLocalProfile: function () {
      cache = null;
      emit();
    },

    /* ---- Профіль ---- */

    /**
     * Те, що відомо ПРЯМО ЗАРАЗ, без мережі.
     *
     * getProfile() у хмарному режимі чекає на відповідь сервера, і до неї
     * сторінка не знає нічого. Для рішень, які треба ухвалити до першого
     * кадру (наприклад, яка кнопка на головній головна), це означало б
     * видимий стрибок. Тут — кеш або локальна копія, синхронно.
     *
     * НЕ замінює getProfile: під хмарною сесією локальна копія може бути
     * залишком попереднього акаунта. Викликати варто лише там, де помилка
     * нешкідлива й самовиправляється, коли приїде справжній профіль.
     */
    localProfile: function () {
      return cache || readLocalProfile();
    },

    getProfile: async function () {
      if (cache) return cache;

      if (CLOUD && session && cloudAllowed()) {
        const ok = await ensureFresh();
        if (ok) {
          try {
            const rows = await req('/rest/v1/profiles?select=data&user_id=eq.' + session.user.id + '&limit=1');
            const data = Array.isArray(rows) && rows[0] ? rows[0].data : null;

            /*
             * РЯДКА В ХМАРІ ЩЕ НЕМАЄ — це не те саме, що «в хмарі порожньо».
             *
             * Було: data || {} перетворювало відсутність рядка на порожній
             * бланк, і той бланк ставав cache, а далі lsSet затирав ним
             * локальний профіль. Тобто достатньо було відкрити сайт із
             * сесією, для якої рядок ще не створено (щойно зареєструвався,
             * перший запис не доїхав, рядок видалили) — і локальні дані
             * зникали без жодного повідомлення.
             *
             * Порожня відповідь означає лише, що записувати ще нічого не
             * встигли. Профіль у цьому випадку — локальний; наступне
             * збереження створить рядок.
             */
            if (!data) {
              cache = readLocalProfile();
              return cache;
            }

            const remote = migrate(Object.assign(blankProfile(), data), data);

            /*
             * Локальна копія перемагає, якщо вона НОВІША і є незіслані патчі.
             * Це той самий випадок «працював офлайн»: у хмарі лежить вчорашній
             * рядок, а сьогоднішня робота чекає в черзі. Сліпа перевага хмари
             * тут стирала б день роботи при кожному відкритті сайту.
             *
             * !remote.updatedAt — окремий випадок: старий хмарний рядок без
             * позначки часу не має вигравати в локального, який її має.
             */
            const local = lsGet(LS_PROFILE, null);
            if (local && (pendingGet().length || isDirty()) &&
                local.updatedAt && (!remote.updatedAt ||
                local.updatedAt > remote.updatedAt)) {
              cache = migrate(Object.assign(blankProfile(), local), local);
              flushPending().catch(function () {});
              return cache;
            }

            cache = remote;
            /*
             * ДЗЕРКАЛО В localStorage — критично для сторожа.
             *
             * agegate.js — синхронний скрипт у <head>: він бачить лише
             * ib.profile і вирішує, куди пускати. Без цього рядка вхід у
             * чистому браузері зациклював сайт: welcome читав повний
             * профіль із хмари й слав на index, а сторож на index бачив
             * ПОРОЖНІЙ localStorage і гнав назад на welcome — нескінченне
             * перезавантаження. Тепер прочитане з хмари одразу лягає туди,
             * куди дивиться сторож.
             */
            lsSet(LS_PROFILE, cache);
            return cache;
          } catch (e) {
            console.warn('[store] хмара недоступна, читаю локально:', e.message);
            /*
             * Сесію відкликано (401/403). Локальний профіль лишається на
             * місці — clearSession більше його не стирає — і саме він тут
             * єдина копія даних, які могли не доїхати. Читаємо його, а не
             * підсовуємо порожній бланк: людині треба перезайти, а не
             * побачити застосунок без своєї історії.
             */
          }
        }
      }

      cache = readLocalProfile();
      return cache;
    },

    /**
     * Зберегти патч.
     *
     * Кидає виняток, якщо запис НЕ доїхав. Раніше було дві тихі дірки:
     *   • ensureFresh() повернув false -> гілка POST просто не виконувалась,
     *     і функція резолвилась успішно, хоч у хмарі лишалось старе;
     *   • переповнений localStorage -> lsSet повертав false, який ніхто не читав.
     * Тепер обидва випадки видно нагорі, і UI може сказати правду.
     *
     * Помилка мережі — окремий випадок: патч іде в чергу, помилка кидається
     * з ознакою .queued, щоб інтерфейс сказав «збережеться, коли зʼявиться
     * мережа», а не «втрачено».
     */
    saveProfile: function (patch) {
      return queueWrite(function () { return doSave(patch); });
    },

    /**
     * Синхронне збереження для pagehide.
     *
     * Звичайний fetch у момент закриття вкладки браузер скасовує — саме через
     * це «вписав вагу й одразу клікнув інший розділ» губило дані. keepalive
     * дозволяє запиту пережити вивантаження сторінки (ліміт тіла 64 КБ).
     * sendBeacon тут не годиться: він не дає проставити apikey й Authorization.
     */
    /**
     * ЛОКАЛЬНИЙ запис виконується завжди; у хмару йде лише коли черга
     * збережень порожня. Раніше beacon будував свій next із кеша й слав
     * власний keepalive-POST повз saveChain: якщо в цю мить у польоті вже
     * був звичайний saveProfile, два записи в той самий рядок ішли без
     * жодної гарантії порядку, і той, що приходив другим, вигравав.
     * Тепер конкурентний випадок іде в чергу — вона доїде при наступному
     * відкритті сайту.
     */
    saveProfileBeacon: function (patch) {
      const current = cache || readLocalProfile();
      const next = Object.assign({}, current, patch || {}, { updatedAt: new Date().toISOString() });
      cache = next;
      const okLocal = lsSet(LS_PROFILE, next);

      if (!(CLOUD && session)) return okLocal;

      const body = JSON.stringify([{ user_id: session.user.id, data: next }]);
      /*
     * Ліміт keepalive — 64 КБ БАЙТІВ, а не символів. body.length рахує
     * UTF-16, і кирилиця (назви вправ, трекерів, рецептів) важить удвічі
     * більше: тіло на 60 000 символів могло сягати ~120 КБ, тобто браузер
     * відхиляв запит, який за оцінкою «мав влізти».
     */
    let bytes;
    try { bytes = new Blob([body]).size; }
    catch (_) { bytes = body.length * 2; }
    if (bytes > 60000) {
        // Не вліземо в ліміт keepalive — краще чесно покласти в чергу,
        // ніж відправити запит, який браузер обірве на півдорозі.
        pendingPush(patch || {});
        return okLocal;
      }

      // Звичайне збереження ще в польоті — не шлемо другий запис у той
      // самий рядок повз чергу: порядок двох одночасних POST не визначений.
      if (saveInFlight) {
        pendingPush(patch || {});
        return okLocal;
      }

      try {
        fetch(URL_ + '/rest/v1/profiles?on_conflict=user_id', {
          method: 'POST',
          headers: Object.assign(authHeaders(true), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: body,
          keepalive: true
        }).catch(function () { pendingPush(patch || {}); });
      } catch (_) {
        pendingPush(patch || {});
      }
      return okLocal;
    },

    /**
     * Стерти дані в цьому браузері.
     *
     * Прибирає ВСЕ, що сайт тут лишив, а не лише ib.profile: раніше кнопка
     * не чіпала ні сесію, ні тему, ні згорнуті блоки — і одразу після неї
     * renderProfile тягнув усе назад із хмари, тож виглядало, наче нічого
     * не сталося. Хмарний рядок ця кнопка не чіпає й тепер: для цього є
     * окрема дія в акаунті, і плутати їх не можна.
     */
    clearLocal: function () {
      /* Повний перелік того, що сайт лишає в цьому браузері. Тут бракувало
         'forge.today' (галочки вправ і обраний день на «Сьогодні») і був
         неправильний 'ib.meals.folds' — meals.js пише 'ib.meals.fold', без
         s. Тобто кнопка обіцяла прибрати все, а стан тренування лишався
         видимим наступній людині за спільним компʼютером. Стару назву
         тримаємо для прибирання за минулими версіями. */
      [LS_PROFILE, LS_SESSION, LS_BACKUP, LS_BACKUP_LOGIN, LS_PENDING, LS_OWNER,
       LS_ACCOUNT, DIRTY_KEY, 'forge.theme', 'forge.scheme',
       'forge.today', 'ib.meals.fold', 'ib.meals.folds'].concat(ELO_KEYS).forEach(function (k) {
        try { localStorage.removeItem(k); } catch (_) {}
      });
      session = null;
      cache = null;
      emit();
    }
  };

  /** Помилка «лягло в чергу», якщо патч справді ліг; інакше — чесна
      помилка про переповнене сховище. Без цієї розвилки інтерфейс обіцяв
      відкладене збереження навіть тоді, коли записати не вдалось нікуди. */
  function queuedError(patch, message) {
    const stored = pendingPush(patch || {});
    emit();
    if (!stored) {
      return new Error('Сховище браузера переповнене — зміни не збереглись');
    }
    const err = new Error(message);
    err.queued = true;
    return err;
  }

  async function doSave(patch) {
    const current = await api.getProfile();
    const next = Object.assign({}, current, patch || {}, { updatedAt: new Date().toISOString() });

    /*
     * ensureFresh ДО запису локальної копії.
     *
     * Було навпаки, і при невдалому оновленні токена (Supabase відкликає
     * сесію за повторне використання refresh-токена) ensureFresh викликав
     * clearSession, який тоді ще стирав ib.profile — тобто щойно записану
     * копію. Далі код спокійно клав патч у чергу й кидав помилку з ознакою
     * .queued, і кожна сторінка друкувала дружнє «збережеться пізніше».
     * clearSession більше даних не чіпає, але правильний порядок лишається
     * правильним порядком: спершу зʼясувати, чи можемо писати.
     */
    let fresh = true;
    if (CLOUD && session && cloudAllowed()) fresh = await ensureFresh();

    cache = next;
    // Локальна копія пишеться завжди — офлайн-резерв
    const okLocal = lsSet(LS_PROFILE, next);

    if (CLOUD && session && cloudAllowed()) {
      if (!fresh) {
        throw queuedError(patch, 'Сесія прострочена або немає звʼязку — збережеться пізніше');
      }
      try {
        saveInFlight++;
        try { await pushToCloud(next); } finally { saveInFlight--; }
        /*
         * Доїхали — саме час спробувати й те, що чекало в черзі. БЕЗ await
         * і поза ланцюгом: flushPending сам стає в чергу, а чекати на нього
         * зсередини ланцюга означало б чекати на самого себе.
         */
        if (pendingGet().length) {
          setTimeout(function () { flushPending().catch(function () {}); }, 0);
        }
      } catch (e) {
        if (e && (e.offline || !e.status)) {
          throw queuedError(patch, 'Немає звʼязку — збережеться, коли зʼявиться мережа');
        }
        console.warn('[store] не збереглось у хмару:', e.message);
        emit();
        throw e;
      }
    }

    /*
     * Переповнене сховище — помилка В ОБОХ режимах.
     *
     * Було: перевірка стояла в гілці «хмари немає». У хмарному режимі
     * результат lsSet не дивився ніхто, тому офлайн-резерв зникав мовчки,
     * а сторож (agegate.js читає саме ib.profile) починав ганяти сторінки
     * по колу. Тепер запис у хмару вже стався — дані не втрачені, — але
     * людина мусить знати, що локальної копії немає.
     */
    if (!okLocal) {
      emit();
      throw new Error('Сховище браузера переповнене — локальну копію не збережено');
    }

    // Раніше цього виклику тут не було, і підписники Store.onChange
    // мовчали при кожному збереженні профілю: сторінка акаунта могла
    // записати нову вагу, а решта інтерфейсу цього не помічала.
    emit();
    return next;
  }

  /**
   * Що робити з локальними даними в момент першого входу.
   * Викликається одразу після storeSession, до будь-якого збереження.
   */
  async function resolveFirstLogin(local) {
    /*
     * ЧУЖІ ЛОКАЛЬНІ ДАНІ.
     *
     * clearSession (401, відкликаний токен, зміна пароля) навмисно лишає
     * ib.profile: це може бути єдина копія незісланої роботи. Але без
     * позначки власника наступний користувач за тим самим браузером
     * успадковував її як свою — і resolveFirstLogin заливав журнали
     * попередньої людини в чужий акаунт БЕЗ жодного діалогу (гілка
     * 'adopted' спрацьовує сама, коли в хмарі порожньо).
     */
    if (enforceOwner(local)) return 'foreign';

    if (!isMeaningful(local)) return null;
    // Не-approved акаунт хмарного рядка не має і мати не може (RLS):
    // локальні дані реєстрації просто чекають підтвердження на місці.
    if (!cloudAllowed()) return null;

    // Резервна копія — завжди, ще до того, як щось вирішимо. Навіть якщо
    // далі щось піде не так, локальна робота лишиться відновлюваною.
    lsSet(LS_BACKUP_LOGIN, Object.assign({ savedAt: new Date().toISOString() }, local));

    let remote = null;
    try {
      const rows = await req('/rest/v1/profiles?select=data&user_id=eq.' + session.user.id + '&limit=1');
      remote = Array.isArray(rows) && rows[0] ? rows[0].data : null;
    } catch (_) {
      // Не змогли прочитати хмару — нічого не вирішуємо й нічого не чіпаємо.
      return null;
    }

    if (!isMeaningful(remote)) {
      // У хмарі порожньо: локальне просто стає хмарним.
      cache = migrate(Object.assign(blankProfile(), local), local);
      await pushToCloud(cache);
      return 'adopted';
    }

    // Непорожні обидва — вибір за людиною, не за кодом.
    cache = null;
    return 'conflict';
  }

  /* ------------------------------------------------------------------ */
  /* Відновлення сесії при завантаженні                                  */
  /* ------------------------------------------------------------------ */

  /*
   * Синхронізація між вкладками.
   *
   * Подія storage приходить лише в ІНШІ вкладки того самого сайту — та,
   * що писала, її не отримує. Тому просто скидаємо кеш і повідомляємо
   * підписників: наступне читання візьме свіжі дані з localStorage.
   *
   * Слухач стоїть ЗЗОВНІ if (CLOUD): раніше він був усередині, і в локальному
   * режимі (тобто за замовчуванням) синхронізації між вкладками не було
   * зовсім — у вкладці A додав рецепт, у вкладці B зберіг вагу, рецепт зник.
   */
  window.addEventListener('storage', function (e) {
    /*
     * Сесія теж їздить між вкладками. Supabase РОТУЄ refresh-токени:
     * якщо вкладка A оновила токен, у вкладки B в памʼяті лишається вже
     * витрачений — і перше ж її збереження отримувало 401 і викидало
     * людину з акаунта в обох вкладках. Тепер B просто підхоплює те, що
     * записала A; стерта сесія так само розʼїжджається як вихід.
     */
    if (e.key === LS_SESSION) {
      if (e.newValue == null) {
        if (session) { session = null; cache = null; emit(); }
        return;
      }
      try {
        const next = JSON.parse(e.newValue);
        if (next && next.access_token &&
            (!session || Number(next.expires_at) > Number(session.expires_at))) {
          session = next;
          cache = null;
          emit();
        }
      } catch (_) { /* чужий запис — ігноруємо */ }
      return;
    }

    if (e.key !== LS_PROFILE) return;
    cache = null;
    api.getProfile().then(emit, function () {});
  });

  if (CLOUD) {
    const saved = readSavedSession();
    if (saved && saved.access_token) {
      session = saved;
      /* Та сама звірка власника, що й при вході: сесія могла відновитись
         у браузері, де лишились дані іншої людини. */
      enforceOwner(null);
      ensureFresh().then(function (ok) {
        if (!ok) return;
        emit();
        if (pendingGet().length) flushPending().catch(function () {});
      });
    }

    // Мережа повернулась — досилаємо все, що чекало.
    window.addEventListener('online', function () {
      flushPending().catch(function () {});
    });
  }

  window.Store = api;
})();
