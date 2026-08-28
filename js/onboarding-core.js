/**
 * Онбординг Forge як СТАН ДАНИХ, а не екран і не прапорець.
 *
 * Єдине джерело правди про те, де людина зараз: stepFor(profile).
 * Крок щоразу ВИВОДИТЬСЯ з наявності полів у профілі — окремого
 * «onboardingComplete» немає навмисно: такий прапорець і був би тим,
 * що підробляють у localStorage за пʼять секунд. Щоб пройти далі,
 * потрібні самі дані — а профіль із даними і є пройдений онбординг.
 *
 * Кроки (порядок фіксований):
 *   'age'     — дата народження, 18+ (js/age-core.js).
 *   'body'    — стать, вага, зріст, рівень активності.
 *   'program' — обрана програма (activePlan) і хоча б одна робоча вага.
 *   'done'    — Forge відкритий повністю.
 *
 * ЧОМУ «хоча б одна вага», а не всі вправи плану. Повний план — це
 * 20–40 полів перед першим входом у застосунок; така стіна на порозі
 * гарантовано втрачає людей. Одна вага означає, що людина знайшла поле,
 * зрозуміла механіку й почала — решту ваг План і «Сьогодні» просять
 * контекстно, поруч із вправою, як і було задумано. Критерій «усі ваги
 * першого дня» відкинутий ще й технічно: синхронний сторож у <head>
 * не може розгорнути план (programs-data.js вантажиться з defer), а
 * критерій, який сторож не може перевірити, — не критерій.
 *
 * ЧОМУ hasHistory зараховує онбординг. Профіль із журналами (вага тіла,
 * тренування, харчування, трекери) — це людина, яка вже жила у Forge до
 * появи цих кроків. Ганяти її по онбордингу заново не можна, а окремий
 * прапорець «старий користувач» — заборонений. Історія і є доказ,
 * виведений з даних: нізвідки, крім користування застосунком (або
 * імпорту повної резервної копії — теж легітимний шлях), вона взятись
 * не може.
 *
 * ЧЕСНА МЕЖА. Forge — статичний сайт без сервера: будь-який критерій
 * можна виконати, вписавши потрібні поля в localStorage руками. Сторож
 * закриває звичайні шляхи (URL, історія, перезавантаження), а не захищає
 * від людини з відкритою консоллю — це можливо лише там, де рішення
 * ухвалює сервер.
 */
(function () {
  'use strict';

  /* Ті самі межі, що в валідаторі імпорту (js/account.js NUM_LIMITS/ENUMS):
     два різні уявлення про «коректну вагу» дали б профіль, який імпорт
     приймає, а онбординг — ні. */
  const LIMITS = { weight: [30, 300], height: [120, 250] };
  const SEX = ['male', 'female'];
  const ACTIVITY = ['1.2', '1.375', '1.55', '1.725', '1.9'];
  const TRAINING_AGE = ['novice', 'inter', 'adv', 'elite'];

  function inRange(v, lim) {
    const n = Number(v);
    return Number.isFinite(n) && n >= lim[0] && n <= lim[1];
  }

  function nonEmpty(obj) {
    return Boolean(obj) && typeof obj === 'object' && Object.keys(obj).length > 0;
  }

  /** Вік підтверджено: доросла дата народження. now — для тестів. */
  function hasAge(p, now) {
    if (!p || typeof p.birthDate !== 'string') return false;
    const AC = (typeof window !== 'undefined' && window.AgeCore) || null;
    return Boolean(AC && AC.isAdult(p.birthDate, now));
  }

  /** Тіло: стать, вага, зріст, активність і стаж — усі пʼять, у межах.
      Обидва пульси — опційні, критерію не тримають: без них кардіо
      рахує зони від віку (208 − 0,7 × вік, зони у % від максимуму). */
  function hasBody(p) {
    if (!p) return false;
    return SEX.indexOf(p.sex) !== -1 &&
      inRange(p.weight, LIMITS.weight) &&
      inRange(p.height, LIMITS.height) &&
      ACTIVITY.indexOf(String(p.activity)) !== -1 &&
      TRAINING_AGE.indexOf(p.trainingAge) !== -1;
  }

  /** Програма: activePlan обрано і хоча б одна робоча вага введена. */
  function hasProgram(p) {
    if (!p || !p.activePlan || !p.activePlan.programId) return false;
    const w = p.weights;
    if (!w || typeof w !== 'object') return false;
    return Object.keys(w).some(function (k) {
      const n = Number(w[k]);
      return Number.isFinite(n) && n > 0;
    });
  }

  /**
   * Профіль уже жив: є журнали. Доказ користування, виведений з даних, —
   * захист наявних користувачів від повторного онбордингу.
   */
  function hasHistory(p) {
    if (!p) return false;
    return nonEmpty(p.bodyLog) || nonEmpty(p.workLog) ||
      nonEmpty(p.sessionLog) || nonEmpty(p.mealLog) ||
      nonEmpty(p.weightLog) || nonEmpty(p.trackerLog);
  }

  /**
   * Де людина зараз. ЄДИНЕ місце, що знає порядок кроків.
   * Вік — завжди перший і без винятків: це не зручність, а межа 18+.
   */
  function stepFor(p, now) {
    if (!hasAge(p, now)) return 'age';
    if (hasHistory(p)) return 'done';
    if (!hasBody(p)) return 'body';
    if (!hasProgram(p)) return 'program';
    return 'done';
  }

  /* ------------------------------------------------------------------ */
  /* Маршрути: який крок де живе і що на ньому дозволено.                */
  /* account.html відкритий з кроку «тіло»: людина з резервною копією    */
  /* мусить мати куди її імпортувати — після імпорту повного профілю     */
  /* онбординг зарахується сам, бо стан виводиться з даних.              */
  /* ------------------------------------------------------------------ */

  const ROUTES = {
    age:     { page: 'welcome.html',  allowed: ['welcome.html'] },
    body:    { page: 'welcome.html',  allowed: ['welcome.html', 'account.html'] },
    program: { page: 'programs.html', allowed: ['programs.html', 'plan.html', 'account.html'] },
    done:    { page: 'index.html',    allowed: null } // null = усе, крім welcome
  };

  /** Сторінка, на якій живе крок. */
  function pageFor(step) {
    return (ROUTES[step] || ROUTES.age).page;
  }

  /** Чи можна бути на цій сторінці на цьому кроці. */
  function isAllowed(step, page) {
    const r = ROUTES[step] || ROUTES.age;
    if (r.allowed === null) return page !== 'welcome.html';
    return r.allowed.indexOf(page) !== -1;
  }

  window.OnboardingCore = {
    hasAge: hasAge,
    hasBody: hasBody,
    hasProgram: hasProgram,
    hasHistory: hasHistory,
    stepFor: stepFor,
    pageFor: pageFor,
    isAllowed: isAllowed
  };
})();
