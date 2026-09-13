/**
 * ПЕРЕВІРКА ІМПОРТОВАНОГО ПРОФІЛЮ — чисті функції, без DOM.
 *
 * ЗВІДКИ ЦЕЙ ФАЙЛ. Він жив усередині wireProfileForm() у js/account.js —
 * функції на 1036 рядків, із яких 800 займала саме ця перевірка. Тисяча
 * рядків в одній функції означає, що її ніхто не читає цілком, отже ніхто
 * і не знає, що вона робить.
 *
 * Але головне не довжина. Перевірка імпорту — найнедовірливіший код у
 * проєкті: вона розбирає ФАЙЛ, який людина могла відредагувати руками або
 * взяти зовсім чужий. Замкнена в обробнику подій, вона не піддавалась
 * жодному юніт-тесту — перевірити її можна було лише через браузер, тобто
 * повільно й не до кінця. Тепер це модуль, як усі решта *-core.
 *
 * ЩО ТУТ Є. Білий список ключів, чистильники кожного типу значення й сам
 * validate(). Жодного DOM, жодного сховища, жодного тосту: функція каже,
 * ЩО можна взяти з файлу, а вирішує й показує це сторінка.
 */
(function () {
  'use strict';

  /*
   * Імпорт — відновлення з файлу, який зробив «Експортувати JSON».
   *
   * Вміст перевіряється за білим списком ключів blankProfile: файл міг
   * бути відредагований руками або взагалі бути чужим JSON. Невідомі
   * ключі мовчки відкидаються — інакше зіпсований файл засмічує профіль
   * полями, яких сайт не знає й ніколи не почистить.
   *
   * Перед записом — confirm: імпорт ПЕРЕЗАПИСУЄ поточні дані, і зробити
   * це випадково подвійним кліком не можна.
   */
  const ALLOWED_KEYS = ['birthDate','sex','age','height','weight','goalWeight','bodyfat','daysPerWeek',
    'programId','goal','customPlans','weights','activePlan','trainingAge',
    'activity','meals','recipes','day','hrRest','hrMax','records',
    'displayName','pet','scheme',
    'bodyLog','workLog','theme','periodization','deload',
    'weightLog','sessionLog','mealLog','trackers','trackerLog',
    'measureLog','bmiAck','hideHelp',
    'ratingLog','ratingSeen','ratingAlgorithmVersion',
    /* Латки разових міграцій. Без них імпорт на чистий браузер знімав
       позначку weightsHarvested, і programs.js на завантаженні знову
       прогонив одноразове перенесення ваг зі старих планів — дописуючи
       сьогоднішній запис в історію кожної вправи. version і updatedAt
       свідомо НЕ тут: імпорт — це патч на вже версійований профіль. */
    'weightsHarvested','weightLogSeeded'];

  /*
   * Білого списку ключів МАЛО.
   *
   * Він захищає від засмічення профілю чужими полями, але не від
   * зіпсованого вмісту всередині своїх. Файл із { "day": { "meals": [{}] } }
   * проходив білий список і вбивав сторінку «Раціон» назавжди: renderDay
   * читав m.items.length у обʼєкті без items, падав із TypeError — і
   * полагодити це можна було тільки через DevTools, бо биті дані вже
   * лежали в профілі (а в хмарному режимі ще й розлітались на всі пристрої).
   *
   * Тому кожне значення перевіряється за формою. Що не проходить —
   * відкидається ПОІМЕННО, а не мовчки: людина має бачити, що саме з її
   * файлу не взяли.
   */

  const NUM_LIMITS = {
    age: [10, 100], height: [120, 250], weight: [30, 300], bodyfat: [3, 60],
    /* Ті самі межі, що у ваги: ціль — це вага, лише в майбутньому.
       Ширший діапазон дозволив би поставити ціль, якої модель не рахує. */
    goalWeight: [30, 300],
    daysPerWeek: [1, 7], meals: [1, 8],
    hrRest: [30, 120], hrMax: [120, 230]
  };
  /* Ключі, для яких null — чинне «не задано» (дивись blankProfile()).
     Усе, що не тут, при null відкидається: журнали й реєстри мають
     порожню форму {} або [], і підміна їх на null — це втрата даних. */
  const NULLABLE = {
    birthDate: 1,
    sex: 1, age: 1, height: 1, weight: 1, goalWeight: 1, bodyfat: 1, daysPerWeek: 1,
    programId: 1, goal: 1, activity: 1, meals: 1, trainingAge: 1,
    hrRest: 1, hrMax: 1, theme: 1, scheme: 1,
    activePlan: 1, day: 1, periodization: 1, deload: 1
  };

  /*
   * Рівень активності — ПЕРЕЛІК, а не діапазон.
   *
   * Було NUM_LIMITS.activity = [1, 2.5], тобто імпорт пропускав будь-яке
   * число: 1.4 проходило перевірку, але такого пункту в списку немає.
   * <select>.value з невідомим значенням стає порожнім рядком, далі
   * parseFloat('') = NaN — і сторінка «Харчування» мовчки переставала
   * рахувати взагалі, показуючи порожній селект без жодного пояснення.
   * Ті самі пʼять значень визначені в NutritionCalc.ACTIVITY.
   */
  const ENUMS = {
    activity: ['1.2', '1.375', '1.55', '1.725', '1.9'],
    // Додаток скрізь пише 'male'/'female' (account.js, nutrition.js,
    // nutrition-core.js). Тут стояло ['m','f'], тому власний експорт
    // ЗАВЖДИ втрачав стать при імпорті — а з нею й гілку BMR: жіночий
    // профіль мовчки рахувався за чоловічою формулою (+166 ккал).
    sex: ['male', 'female'],
    trainingAge: ['novice', 'inter', 'adv', 'elite'],
    /* Поле мертве (оформлення одне), але список лишається: у старих
       резервних копіях ці значення є, і відкидати їх поіменно означало б
       показувати людині «відкинуто 1 поле» щоразу, коли вона імпортує
       власний давній експорт. Приймаємо й кладемо в профіль — воно
       нічого не малює. */
    theme: ['pink', 'wood', 'violet',
            'crimson', 'amber', 'moss', 'emerald', 'ocean',
            'graphite', 'graphite-navy', 'graphite-pink', 'graphite-violet',
            'graphite-crimson', 'graphite-amber', 'graphite-moss',
            'graphite-emerald', 'graphite-ocean'],
    scheme: ['dark', 'light']
  };
  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  function isPlain(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  /** Налаштування трекера: до 20 скалярних ключів, рядки до 120 символів. */
  function cleanSettings(v) {
    if (!isPlain(v)) return {};
    const out = {};
    let n = 0;
    Object.keys(v).forEach(function (k) {
      if (n >= 20 || k.length > 40) return;
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      const x = v[k];
      const t = typeof x;
      if (t === 'number' && Number.isFinite(x)) { out[k] = x; n++; }
      else if (t === 'boolean') { out[k] = x; n++; }
      else if (t === 'string' && x.length <= 120) { out[k] = x; n++; }
    });
    return out;
  }
  function finite(v, lo, hi) {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
  }
  /** Рядок обмеженої довжини: захист і від сміття, і від роздування профілю */
  function str(v, max) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s && s.length <= (max || 120) ? s : null;
  }

  /** Одна вправа в кастомному плані */
  function cleanExercise(ex) {
    if (!isPlain(ex)) return null;
    const name = typeof ex.name === 'string' ? ex.name.slice(0, 120) : '';
    const out = {
      name: name,
      sets: finite(ex.sets, 0, 20) || 0,
      reps: str(ex.reps, 20) || '',
      rir: str(ex.rir, 20) || '',
      rest: str(ex.rest, 30) || '',
      note: typeof ex.note === 'string' ? ex.note.slice(0, 300) : ''
    };
    if (str(ex.pattern, 60)) out.pattern = str(ex.pattern, 60);
    // lift визначає тип вправи (базова/ізоляція), а від нього залежать
    // час відпочинку й стеля інтенсивності в періодизації. circuit —
    // номер кругової частини. Обидва мовчки зникали при імпорті.
    if (str(ex.lift, 40)) out.lift = str(ex.lift, 40);
    const circuit = finite(ex.circuit, 1, 20);
    if (circuit !== null) out.circuit = Math.round(circuit);
    /* Власне число повторень із «Мого плану». Верхня межа тут — найвища
       зі стель RepsCore.MAX; точну стелю саме цієї вправи (вона залежить
       від розміру групи) ставить RepsCore.applyPlan на читанні, і зробити
       це можна тільки там: тут ще немає ні MUSCLES, ні гарантії, що
       muscles у файлі взагалі чинні. */
    const userReps = finite(ex.userReps, 1, 15);
    if (userReps !== null) out.userReps = Math.round(userReps);
    if (Array.isArray(ex.muscles)) {
      out.muscles = ex.muscles.filter(function (m) { return str(m, 40); }).slice(0, 6);
    }
    return out;
  }

  function cleanPlan(days) {
    if (!Array.isArray(days) || days.length > 14) return null;
    const out = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (!isPlain(d) || !Array.isArray(d.exercises)) return null;
      if (d.exercises.length > 40) return null;
      const exercises = d.exercises.map(cleanExercise);
      if (exercises.some(function (e) { return e === null; })) return null;
      /* title і focus — це те, як день названо в інтерфейсі («День A»,
         «Усе тіло»). Без них відредагований план після відновлення
         втрачав підписи: акордеони порожні, вкладки на «Сьогодні»
         перетворювались на «День 1/2/3». */
      out.push({
        name: str(d.name, 80) || ('День ' + (i + 1)),
        title: str(d.title, 80) || '',
        focus: str(d.focus, 80) || '',
        exercises: exercises
      });
    }
    return out;
  }

  /*
   * Заморожена позиція (DayCore, kind:'snap') — та, що не посилається ні
   * на продукт, ні на рецепт: КБЖВ на одну одиницю лежить у ній самій.
   * Валідатор мусить її знати у двох місцях — у поточному дні й у знімку
   * прийомів у mealLog, — тому перевірка тут одна.
   *
   * Межі: per — на ОДНУ одиницю (один грам або один контейнер), тож
   * стеля мусить покривати і те, й те: 20000 ккал — це вже не контейнер,
   * а помилка, а 9 ккал на грам жиру в неї вкладається із запасом.
   */
  function cleanSnapItem(it) {
    if (!isPlain(it) || it.kind !== 'snap') return null;
    const qty = finite(it.qty, 0, 5000);
    if (qty === null) return null;
    const src = isPlain(it.per) ? it.per : {};
    const per = {
      kcal: finite(src.kcal, 0, 20000) || 0,
      p: finite(src.p, 0, 2000) || 0,
      f: finite(src.f, 0, 2000) || 0,
      c: finite(src.c, 0, 4000) || 0,
      fiber: finite(src.fiber, 0, 500) || 0
    };
    const out = {
      kind: 'snap',
      name: str(it.name, 120) || 'Позиція',
      unit: it.unit === 'portion' ? 'portion' : 'g',
      qty: qty,
      per: per
    };
    /* id джерела — підказка, а не посилання: якщо продукт у довіднику ще
       є, копія дня віддасть перевагу живій позиції. Без цих полів
       скопійований рис перестав би перераховуватись у готовий. */
    const foodId = str(it.foodId, 80);
    if (foodId) { out.foodId = foodId; out.cooked = it.cooked === true; }
    const recipeId = str(it.recipeId, 80);
    if (recipeId) out.recipeId = recipeId;
    return out;
  }

  /** Знімок прийомів у записі mealLog. null — знімка немає або він битий. */
  function cleanFrozenMeals(meals) {
    if (!Array.isArray(meals) || !meals.length || meals.length > 12) return null;
    const out = [];
    let any = false;
    for (let i = 0; i < meals.length; i++) {
      const m = meals[i];
      if (!isPlain(m) || !Array.isArray(m.items) || m.items.length > 60) return null;
      const items = [];
      for (let j = 0; j < m.items.length; j++) {
        const snap = cleanSnapItem(m.items[j]);
        if (!snap) return null;
        items.push(snap);
      }
      if (items.length) any = true;
      out.push({ name: str(m.name, 60) || ('Прийом ' + (i + 1)), items: items });
    }
    /* Знімок без жодної позиції — це не знімок: копіювати з нього нічого,
       а в списку джерел він обіцяв би день, якого немає. */
    return any ? out : null;
  }

  function cleanDay(day) {
    if (!isPlain(day) || !Array.isArray(day.meals) || day.meals.length > 12) return null;
    const meals = [];
    for (let i = 0; i < day.meals.length; i++) {
      const m = day.meals[i];
      // Саме той випадок, що вбивав сторінку: meals є, items немає.
      if (!isPlain(m) || !Array.isArray(m.items) || m.items.length > 60) return null;
      const items = [];
      for (let j = 0; j < m.items.length; j++) {
        const it = m.items[j];
        if (!isPlain(it)) return null;
        if (it.kind === 'snap') {
          const snap = cleanSnapItem(it);
          if (!snap) return null;
          items.push(snap);
        } else if (it.kind === 'recipe') {
          const p = finite(it.portions, 0.25, 10);
          if (!str(it.recipeId, 80) || p === null) return null;
          items.push({ kind: 'recipe', recipeId: it.recipeId, portions: p });
        } else {
          const g = finite(it.grams, 0, 5000);
          if (!str(it.foodId, 80) || g === null) return null;
          /* Позначка «готове» живе в it.cooked — так її пишуть meals.js
             і читає day-core.js. Валідатор натомість переносив поле
             it.state, якого ніхто не пише й ніхто не читає: після
             експорту-імпорту 200 г вареного рису рахувались як сирий,
             тобто КБЖВ дня їхали в рази. */
          items.push({
            kind: 'food', foodId: it.foodId, grams: g,
            cooked: it.cooked === true || it.state === 'cooked'
          });
        }
      }
      meals.push({ name: str(m.name, 60) || ('Прийом ' + (i + 1)), items: items });
    }
    /* Дата дня (js/meals.js): за нею закривається незакритий день. */
    const DK = /^\d{4}-\d{2}-\d{2}$/;
    return { meals: meals, date: DK.test(day.date) ? day.date : null };
  }

  function cleanRecipes(list) {
    if (!Array.isArray(list) || list.length > 200) return null;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!isPlain(r)) return null;
      const containers = finite(r.containers, 1, 20);
      if (!str(r.id, 80) || !str(r.name, 120) || containers === null) return null;
      if (!Array.isArray(r.items) || r.items.length > 60) return null;
      const items = [];
      for (let j = 0; j < r.items.length; j++) {
        const it = r.items[j];
        const g = isPlain(it) ? finite(it.grams, 0, 10000) : null;
        if (!isPlain(it) || !str(it.foodId, 80) || g === null) return null;
        items.push({
          foodId: it.foodId, grams: g,
          cooked: it.cooked === true || it.state === 'cooked'
        });
      }
      out.push({
        id: r.id, name: r.name,
        // Посилання на джерело — частина рецепта, а не оздоблення:
        // без нього після відновлення з копії нема куди повернутись.
        // safeUrl прибирає javascript:/data: ще до збереження.
        url: window.App.safeUrl(str(r.url, 300) || '') || '',
        author: str(r.author, 120) || '',
        containers: Math.round(containers),
        prepMin: finite(r.prepMin, 0, 600) || 0,
        cookMin: finite(r.cookMin, 0, 600) || 0,
        items: items
      });
    }
    return out;
  }

  /** Журнали: ключ — дата, значення — число в межах */
  function cleanLog(obj, lo, hi) {
    if (!isPlain(obj)) return null;
    const keys = Object.keys(obj);
    if (keys.length > 4000) return null;
    const out = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!DATE_KEY.test(k)) continue;
      const v = obj[k];
      if (v === true) { out[k] = true; continue; }        // workLog
      const n = finite(v, lo, hi);
      if (n !== null) out[k] = n;
    }
    return out;
  }

  /** Плаский словник «рядок -> число» (weights, records) */
  function cleanNumMap(obj, lo, hi) {
    if (!isPlain(obj)) return null;
    const keys = Object.keys(obj);
    if (keys.length > 1000) return null;
    const out = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (k.length > 120) continue;
      const n = finite(obj[k], lo, hi);
      if (n !== null) out[k] = n;
    }
    return out;
  }

  /**
   * @returns {{patch: object, taken: string[], rejected: string[]}}
   */
  function validateImport(data) {
    const patch = {}, taken = [], rejected = [];

    /*
     * СТОРОЖ НА ВХОДІ — ТУТ, А НЕ В ТОГО, ХТО КЛИЧЕ.
     *
     * Досі перевірка «це взагалі обʼєкт?» стояла в обробнику подій у
     * account.js, а сюди приходило вже перевірене. Поки виклик був один,
     * це працювало; з появою другого — впало б на «Cannot use 'in'
     * operator», бо ALLOWED_KEYS.forEach одразу питає (k in data).
     *
     * Функція, яка розбирає ЧУЖИЙ файл, не має права покладатись на те,
     * що хтось перевірив його за неї.
     */
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { patch: patch, taken: taken, rejected: rejected };
    }

    function accept(key, value) { patch[key] = value; taken.push(key); }
    function reject(key) { rejected.push(key); }

    ALLOWED_KEYS.forEach(function (k) {
      if (!(k in data)) return;
      const v = data[k];

      /*
       * null означає «не задано» лише для СКАЛЯРІВ.
       *
       * Для журналів і реєстрів «не задано» — це {} або [], а не null:
       * так їх оголошує blankProfile(). Файл із "weightLog": null
       * проходив як успішно імпортоване поле й обнуляв усю історію ваг,
       * і жодна міграція цього вже не лікувала (кроки версійні, а профіль
       * і так свіжої версії). У хмарному режимі — одразу на всі пристрої.
       */
      if (v === null) {
        if (NULLABLE[k]) { accept(k, null); return; }
        return reject(k);
      }

      if (NUM_LIMITS[k]) {
        let n = finite(v, NUM_LIMITS[k][0], NUM_LIMITS[k][1]);
        /* Кількість днів і прийомів — ЦІЛІ (ELO-003). 4.5 проходило як
           «скінченне число», лягало в профіль і валило серверний
           elo_planned_for при першому дотику кожного нового тижня. */
        if (n !== null && (k === 'daysPerWeek' || k === 'meals')) n = Math.round(n);
        return n === null ? reject(k) : accept(k, n);
      }
      if (ENUMS[k]) {
        /* Порівнюємо як РЯДКИ: activity зберігається числом (1.55), а
           перелік описаний рядками — інакше власний же експорт відкидався б.
           Назад повертаємо в рідному типі поля. */
        if (ENUMS[k].indexOf(String(v)) === -1) return reject(k);
        return accept(k, k === 'activity' ? Number(v) : v);
      }

      switch (k) {
        case 'programId':
        case 'goal':
          return str(v, 60) ? accept(k, v.trim()) : reject(k);

        case 'displayName':
          /* 13 — та сама межа, що в register_request і в CHECK на
             account_status.username (db/nick-length.sql). Довше ім'я з
             давньої копії відхиляється ГУЧНО (потрапляє в список
             відхилених полів), а не лягає в профіль значенням, під яке
             не розрахована ні дошка лідерів, ні адмінка. */
          return str(v, 13) ? accept(k, v.trim()) : reject(k);

        case 'pet': {
          // Місце під маскота: приймаємо лише мінімальну відому форму.
          if (v === null) return accept(k, null);
          if (!isPlain(v)) return reject(k);
          const lvl = finite(v.level, 1, 100);
          return accept(k, { level: lvl === null ? 1 : lvl, skin: str(v.skin, 40) ? v.skin : null });
        }

        case 'activePlan': {
          if (!isPlain(v)) return reject(k);
          /*
           * ЦІЛЕ ЧИСЛО, А НЕ ПРОСТО «У МЕЖАХ» (TIM-006).
           *
           * profiles.data пише клієнт, а сервер читає days у
           * elo_planned_for. Нецілий 3.5 із файла проходив, лягав у
           * хмару — і кожен наступний elo_submit цього користувача
           * повертав 400, тобто рейтинг для нього переставав існувати
           * мовчки. Серверний бік уже захищений (elo_num + floor);
           * тут — щоб таке значення взагалі не потрапляло в базу.
           */
          const days = finite(v.days, 1, 7);
          if (!str(v.programId, 60) || days === null) return reject(k);
          return accept(k, { programId: v.programId, days: Math.round(days) });
        }

        case 'weights':  { const m = cleanNumMap(v, 0, 500);  return m ? accept(k, m) : reject(k); }
        case 'records':  { const m = cleanNumMap(v, 0, 500);  return m ? accept(k, m) : reject(k); }
        case 'bodyLog':  { const m = cleanLog(v, 20, 400);    return m ? accept(k, m) : reject(k); }
        case 'workLog':  { const m = cleanLog(v, 0, 1);       return m ? accept(k, m) : reject(k); }

        /* ---- журнали історії (етап памʼяті) ---- */

        case 'weightLog': {
          // { 'Вправа': [ {d:'YYYY-MM-DD', kg}, … ] } — append-only серії.
          // Межі ті самі, що у weights (0..500 кг); дата обовʼязкова.
          if (!isPlain(v)) return reject(k);
          const names = Object.keys(v);
          if (names.length > 300) return reject(k);
          const out = {};
          /*
           * Битий рядок пропускаємо, а не відкидаємо весь ключ.
           *
           * Раніше будь-який один запис поза межами (описка 520 кг,
           * дата в іншому форматі зі старішого білда) повертав reject
           * на ВЕСЬ weightLog — тобто роки історії зникали через один
           * рядок, а людина бачила бадьоре «Імпортовано полів: N».
           * Так само вже поводяться trackerLog і ratingLog.
           */
          for (let i = 0; i < names.length; i++) {
            const name = str(names[i], 120);
            const arr = v[names[i]];
            if (!name || !Array.isArray(arr) || arr.length > 2000) continue;
            const series = [];
            for (let j = 0; j < arr.length; j++) {
              const e = arr[j];
              if (!isPlain(e) || !DATE_KEY.test(String(e.d))) continue;
              const kg = finite(e.kg, 0, 500);
              if (kg === null) continue;
              series.push({ d: e.d, kg: kg });
            }
            if (series.length) out[name] = series;
          }
          return accept(k, out);
        }

        case 'sessionLog': {
          // { 'YYYY-MM-DD': {programId, days, dayIdx, title, done, total} }
          if (!isPlain(v)) return reject(k);
          const dates = Object.keys(v);
          if (dates.length > 4000) return reject(k);
          const out = {};
          for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            if (!DATE_KEY.test(d)) continue;
            const s = v[d];
            // continue, а не reject: один день поза межами не привід
            // викидати всю історію сесій (те саме правило, що у weightLog).
            if (!isPlain(s)) continue;
            const done = finite(s.done, 0, 50);
            const total = finite(s.total, 0, 50);
            if (done === null || total === null) continue;
            out[d] = {
              programId: str(s.programId, 60) || '',
              /* Ціле: дробове число днів валить серверний elo_planned_for
                 (ELO-003). */
              days: Math.round(finite(s.days, 0, 7) || 0),
              dayIdx: finite(s.dayIdx, 0, 6) || 0,
              title: str(s.title, 60) || '',
              done: Math.round(done),
              total: Math.round(total)
            };
            // Знімок фактів сесії (етап аналітики): час, підходи,
            // повторення, тоннаж. Необовʼязкові — старі записи їх не мають.
            const t0 = finite(s.t0, 0, 4102444800000);
            const t1 = finite(s.t1, 0, 4102444800000);
            if (t0) out[d].t0 = Math.round(t0);
            if (t1) out[d].t1 = Math.round(t1);
            const sets = finite(s.sets, 0, 200);
            const reps = finite(s.reps, 0, 5000);
            const vol = finite(s.vol, 0, 200000);
            if (sets !== null) out[d].sets = Math.round(sets);
            if (reps !== null) out[d].reps = Math.round(reps);
            if (vol !== null) out[d].vol = Math.round(vol);
            /* Етап «завершення тренування»: закриті/планові підходи,
               позначка завершення і знімок вправ. Без них відновлений
               із файлу профіль втрачав би блокування тижня і сировину
               аналітики — форма та сама, що пише history-core. */
            const dSets = finite(s.doneSets, 0, 300);
            const tSets = finite(s.totalSets, 0, 300);
            if (dSets !== null) out[d].doneSets = Math.round(dSets);
            if (tSets !== null) out[d].totalSets = Math.round(tSets);
            if (s.end) out[d].end = 1;
            if (Array.isArray(s.ex)) {
              const rows = [];
              for (let j = 0; j < s.ex.length && rows.length < 30; j++) {
                const e = s.ex[j];
                if (!isPlain(e)) continue;
                const nEx = str(e.n, 60);
                const ps = finite(e.ps, 1, 10);
                if (!nEx || ps === null) continue;
                const row = { n: nEx, ps: Math.round(ps),
                  ds: Math.round(Math.min(finite(e.ds, 0, 10) || 0, ps)) };
                const kg = finite(e.kg, 0, 500);
                if (kg !== null && kg > 0) row.kg = kg;
                const r = finite(e.r, 0, 50);
                if (r !== null && r > 0) row.r = r;
                /* s — вага й повтори кожного підходу. Довжина обрізана
                   закритими підходами: більше, ніж зроблено, у знімку
                   бути не може навіть у підробленому файлі. */
                if (Array.isArray(e.s) && row.ds > 0) {
                  const sets = [];
                  for (let q = 0; q < e.s.length && sets.length < row.ds; q++) {
                    const x = e.s[q];
                    if (!isPlain(x)) { sets.push({}); continue; }
                    const o = {};
                    const w = finite(x.w, 0, 500);
                    if (w !== null) o.w = Math.round(w * 2) / 2;
                    const rr = finite(x.r, 1, 200);
                    if (rr !== null) o.r = Math.round(rr);
                    sets.push(o);
                  }
                  if (sets.length) row.s = sets;
                }
                rows.push(row);
              }
              if (rows.length) out[d].ex = rows;
            }
          }
          return accept(k, out);
        }

        case 'mealLog': {
          // { 'YYYY-MM-DD': {kcal,p,f,c,fiber,target?} } — закриті дні.
          // Межі широкі, але скінченні: 20000 ккал — уже не їжа, а помилка.
          if (!isPlain(v)) return reject(k);
          const dates = Object.keys(v);
          if (dates.length > 4000) return reject(k);
          const out = {};
          for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            if (!DATE_KEY.test(d)) continue;
            const s = v[d];
            if (!isPlain(s)) continue;
            const kcal = finite(s.kcal, 0, 20000);
            if (kcal === null) continue;
            const entry = {
              kcal: Math.round(kcal),
              p: Math.round(finite(s.p, 0, 2000) || 0),
              f: Math.round(finite(s.f, 0, 2000) || 0),
              c: Math.round(finite(s.c, 0, 4000) || 0),
              fiber: Math.round(finite(s.fiber, 0, 500) || 0)
            };
            const target = finite(s.target, 500, 20000);
            if (target !== null) entry.target = Math.round(target);
            /* Цільовий білок дня (див. HistoryCore.summarizeDay): з нього
               сервер рахує ELO за харчування. Межі — ті самі, що в
               nutrition-core: нижче 20 г це не ціль, вище 500 — помилка. */
            const pTarget = finite(s.pTarget, 20, 500);
            if (pTarget !== null) entry.pTarget = Math.round(pTarget);
            /* Знімок позицій дня (HistoryCore.closeDay) — з нього робиться
               копія дня. Білий список полів означає, що все не перелічене
               тут при імпорті ЗНИКАЄ: без цієї гілки відновлення з копії
               мовчки забирало б у людини можливість скопіювати день. */
            /* Швидкий запис (HistoryCore.quickDay): ккал і, може, білок,
               без розбору по грамах. Прапорець мусить пережити імпорт —
               інакше після відновлення з копії такий день починає
               рахуватись як повний, тобто його нульовий жир і нульовий
               білок стають «виміряними». */
            if (s.partial === true) entry.partial = true;
            const snap = cleanFrozenMeals(s.meals);
            if (snap) entry.meals = snap;
            out[d] = entry;
          }
          return accept(k, out);
        }

        /* Латки разових міграцій — прості булеві прапорці. */
        case 'weightsHarvested':
        case 'weightLogSeeded':
          return accept(k, v === true);

        /* ---- модульні трекери (етап 4) ---- */

        case 'trackers': {
          // { id: {id,type,name,enabled,settings,goal,source,order,createdAt} }
          if (!isPlain(v)) return reject(k);
          const ids = Object.keys(v);
          if (ids.length > 200) return reject(k);
          const TYPES = ['water', 'sleep', 'mood', 'steps', 'caffeine',
            'recovery', 'painFatigue', 'workoutMood', 'supplement', 'habit'];
          /*
           * Ключ — це ІДЕНТИФІКАТОР, а не текст користувача.
           *
           * Раніше приймався будь-який рядок до 80 символів, і він потім
           * потрапляв у розмітку як значення атрибутів (data-toggle,
           * id="val-…", name="src-…"). Ключ на кшталт
           *   h" onfocus="…" autofocus x="
           * вивалювався з лапок і виконував код у походженні сайту — а
           * там же лежить ib.session із refresh_token. Перевірено: цей
           * файл проходив офіційний імпорт і спрацьовував на trackers.html
           * і today.html.
           *
           * Формат збігається з тим, що видає TrackerCore.addCustom
           * ('habit-lz4k9x2b') і з іменами вбудованих типів ('sleep').
           * Ключ поза цим форматом — не наш; пропускаємо запис, але не
           * відкидаємо весь реєстр через один битий рядок.
           */
          const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;
          const out = {};
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            if (!ID_OK.test(id)) continue;
            const t = v[id];
            if (!isPlain(t) || TYPES.indexOf(t.type) === -1) continue;
            const name = str(t.name, 60);
            if (!name) continue;
            const entry = {
              id: id, type: t.type, name: name,
              enabled: t.enabled === true,
              /* Закріплення на «Сьогодні». Прапорець, не текст — тому
                 перевірка та сама, що й для enabled. */
              pinned: t.pinned === true,
              /* settings не мали ЖОДНОГО обмеження — ні за розміром, ні за
         глибиною, ні за кількістю ключів, і множились на 200 трекерів.
         Беремо лише скаляри верхнього рівня, не більше 20 ключів. */
      settings: cleanSettings(t.settings),
              goal: t.goal === null ? null : finite(t.goal, 0, 100000),
              /* Тижнева ціль x/7 (F3). Без неї трекер після відновлення
                 повертається до денного стріку — тобто до показника, який
                 карає за пропуск, дозволений правилами самої звички. */
              weekGoal: finite(t.weekGoal, 1, 7) === null ? null : Math.round(finite(t.weekGoal, 1, 7)),
              source: (t.source === 'manual' || t.source === 'apple_health') ? t.source : null,
              order: finite(t.order, 0, 100000) || 0,
              createdAt: DATE_KEY.test(t.createdAt) ? t.createdAt : null
            };
            out[id] = entry;
          }
          return accept(k, out);
        }

        case 'trackerLog': {
          // { trackerId: {'YYYY-MM-DD': value} } — value: true, число,
          // або пара чисел (біль/втома, настрій до/після), як задає kind
          // трекера в TrackerCore. Форма перевіряється тут структурно,
          // без прив'язки до конкретного трекера — той самий принцип,
          // що й у weightLog: невідома пізніше додана пара теж пройде.
          if (!isPlain(v)) return reject(k);
          const ids = Object.keys(v);
          if (ids.length > 200) return reject(k);
          const out = {};
          for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            if (id.length > 80) return reject(k);
            const dayMap = v[id];
            if (!isPlain(dayMap)) return reject(k);
            const dates = Object.keys(dayMap);
            if (dates.length > 4000) return reject(k);
            const cleanDays = {};
            for (let j = 0; j < dates.length; j++) {
              const d = dates[j];
              if (!DATE_KEY.test(d)) continue;
              const val = dayMap[d];
              if (val === true) { cleanDays[d] = true; continue; }
              const n = finite(val, -100000, 1000000);
              if (n !== null) { cleanDays[d] = n; continue; }
              if (isPlain(val) && typeof val.source === 'string') {
                // Запис hasSource-трекера (сон/кроки, етап 6): {value,source,date} —
                // перевіряємо ДО загальної "пари", інакше value/source потрапили б
                // під generic-гілку нижче й провалили б перевірку (не числа).
                const vn = finite(val.value, -100000, 1000000);
                if (vn === null) continue;
                cleanDays[d] = {
                  value: Math.round(vn),
                  source: str(val.source, 40) || 'manual',
                  date: DATE_KEY.test(val.date) ? val.date : d
                };
                continue;
              }
              if (isPlain(val)) {
                const fields = Object.keys(val);
                if (!fields.length || fields.length > 4) continue;
                const pair = {};
                let ok = true;
                fields.forEach(function (f) {
                  const fn = finite(val[f], -100000, 1000000);
                  if (fn === null) { ok = false; return; }
                  pair[f] = fn;
                });
                if (ok) cleanDays[d] = pair;
              }
            }
            out[id] = cleanDays;
          }
          return accept(k, out);
        }

        /* ---- Get Stronger Rating (етап 5) ---- */

        case 'ratingAlgorithmVersion': {
          const n = finite(v, 0, 1000);
          return n === null ? reject(k) : accept(k, Math.round(n));
        }

        case 'ratingLog': {
          // { 'YYYY-MM-DD': {rating,delta,quality,reasons:[{key,label,pts}]} } —
          // це КЕШ RatingCore.recompute(), не джерело правди (rating-core.js).
          // Форма перевіряється структурно; биту причину просто відкидаємо,
          // а не весь запис дня — recompute() однаково перебудує його заново.
          if (!isPlain(v)) return reject(k);
          const dates = Object.keys(v);
          if (dates.length > 4000) return reject(k);
          const out = {};
          for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            if (!DATE_KEY.test(d)) continue;
            const e = v[d];
            if (!isPlain(e)) return reject(k);
            const rating = finite(e.rating, 0, 10000000);
            const delta = finite(e.delta, -1000, 1000);
            const quality = finite(e.quality, 0, 1000);
            if (rating === null || delta === null || quality === null) return reject(k);
            const reasons = Array.isArray(e.reasons)
              ? e.reasons.filter(function (r) {
                  return isPlain(r) && str(r.key, 80) && str(r.label, 200) && finite(r.pts, -1000, 1000) !== null;
                }).slice(0, 30).map(function (r) {
                  return { key: r.key, label: r.label, pts: finite(r.pts, -1000, 1000) };
                })
              : [];
            out[d] = { rating: rating, delta: delta, quality: quality, reasons: reasons };
          }
          return accept(k, out);
        }

        case 'ratingSeen': {
          // { 'train:YYYY-MM-DD'|'meal:…'|'body:…'|'lift:Назва:…': 'YYYY-MM-DD' } —
          // дата, коли Rating ВПЕРШЕ побачив факт. Не карається, якщо загубилось
          // при імпорті: recompute() просто не зарахує факт без графового ключа
          // (той самий, «чесний» шлях, що й для щойно доданого факту).
          if (!isPlain(v)) return reject(k);
          const keys = Object.keys(v);
          if (keys.length > 20000) return reject(k);
          const out = {};
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (key.length > 200) continue;
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            if (DATE_KEY.test(v[key])) out[key] = v[key];
          }
          return accept(k, out);
        }

        case 'customPlans': {
          if (!isPlain(v)) return reject(k);
          const keys = Object.keys(v);
          if (keys.length > 50) return reject(k);
          const out = {};
          for (let i = 0; i < keys.length; i++) {
            if (keys[i].length > 60) return reject(k);
            const plan = cleanPlan(v[keys[i]]);
            if (!plan) return reject(k);
            out[keys[i]] = plan;
          }
          return accept(k, out);
        }

        /*
         * Дата народження — не просто рядок формату.
         *
         * З неї виводиться доступ до Get Stronger, тому імпорт не може стати
         * дірою в обхід гейта: файл із дитячою датою (як і з битою)
         * поле просто не отримує. Профіль лишається без birthDate, і
         * сторож на наступному ж відкритті попросить ввести її руками.
         */
        case 'birthDate': {
          const str_ = str(v, 10);
          const AC = window.AgeCore;
          if (!str_ || !AC || !AC.isAdult(str_)) return reject(k);
          return accept(k, str_);
        }

        case 'day':      { const d = cleanDay(v);     return d ? accept(k, d) : reject(k); }
        case 'recipes':  { const r = cleanRecipes(v); return r ? accept(k, r) : reject(k); }

        case 'deload': {
          // programs.js пише { percent, at, before }. Тут читалось v.pct
          // із діапазоном -50..0 — поля, якого ніхто не пише, та ще й із
          // протилежним знаком. Наслідок: після імпорту чип показував
          // «знижено на undefined%».
          if (!isPlain(v)) return reject(k);
          const before = cleanNumMap(v.before, 0, 500);
          if (!before) return reject(k);
          return accept(k, {
            before: before,
            at: str(v.at, 40) || null,
            percent: finite(v.percent, 0, 50)
          });
        }

        case 'periodization': {
          // Форма циклу міняється частіше за решту, тому тут перевіряємо
          // лише те, на що спирається periodization-core: без цих полів
          // сторінка все одно почне цикл заново, а не впаде.
          if (!isPlain(v)) return reject(k);
          const weeks = finite(v.weeks, 4, 24);
          if (weeks === null) return reject(k);
          return accept(k, {
            weeks: weeks,
            // startedAt порожній у налаштованого, але ще не запущеного
            // циклу — раніше такий цикл відкидався цілком.
            startedAt: str(v.startedAt, 40) || null,
            startPct: finite(v.startPct, 30, 100),
            endPct: finite(v.endPct, 30, 100),
            cadence: finite(v.cadence, 1, 4) || 1,
            // stepPct і oneRM пише normalize(), і саме проти oneRM
            // рахується вся таблиця циклу. Без них відновлений цикл
            // мовчки перераховувався від поточних ваг.
            stepPct: finite(v.stepPct, 0, 20),
            oneRM: cleanNumMap(v.oneRM, 0, 1000) || {},
            mode: str(v.mode, 30) || null
          });
        }

        case 'measureLog': {
          // { 'YYYY-MM-DD': { t?: 'ГГ:ХХ', <поле>: число } } — заміри тіла.
          // Межі полів — ті самі, що на формі (js/measure-core.js).
          if (!isPlain(v)) return reject(k);
          const MC = window.MeasureCore;
          if (!MC) return reject(k);
          const dates = Object.keys(v);
          if (dates.length > 4000) return reject(k);
          const out = {};
          for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            if (!DATE_KEY.test(d)) continue;
            const e = v[d];
            if (!isPlain(e)) continue;
            const entry = {};
            let any = false;
            MC.FIELDS.forEach(function (f) {
              const n = finite(e[f.k], f.min, f.max);
              if (n !== null) { entry[f.k] = Math.round(n * 10) / 10; any = true; }
            });
            if (/^\d{2}:\d{2}$/.test(String(e.t || ''))) entry.t = e.t;
            if (any) out[d] = entry;
          }
          return accept(k, out);
        }

        case 'hideHelp':
          /* Побажання «не показувати значок довідки». Проста булева
             ознака: усе, що не true, означає «показувати». */
          return typeof v === 'boolean' ? accept(k, v) : reject(k);

        case 'bmiAck': {
          // Підтвердження BMI-попередження: категорія + значення + час.
          if (!isPlain(v)) return reject(k);
          const cat = str(v.category, 10);
          if (['under', 'over', 'obese'].indexOf(cat) === -1) return reject(k);
          const b = finite(v.bmi, 5, 100);
          if (b === null) return reject(k);
          return accept(k, { category: cat, bmi: b, at: str(v.at, 40) || null });
        }

        default:
          return reject(k);
      }
    });

    return { patch: patch, taken: taken, rejected: rejected };
  }

  window.ImportCore = {
    ALLOWED_KEYS: ALLOWED_KEYS,
    validate: validateImport
  };
})();
