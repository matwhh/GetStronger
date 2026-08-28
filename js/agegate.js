/**
 * Сторож онбордингу: до Forge пускають лише повний профіль.
 *
 * Виріс із вікового сторожа (17+) і працює за тим самим принципом:
 * перевірка стоїть НЕ на екрані кроку, а перед КОЖНОЮ сторінкою — цей
 * файл підключений синхронно в <head> усіх сторінок Forge, включно з
 * welcome.html, і ухвалює рішення до першого рядка розмітки.
 *
 * Кроки й дозволені сторінки (порядок і критерії — js/onboarding-core.js):
 *   age     -> welcome.html
 *   body    -> welcome.html, account.html   (account — шлях для імпорту копії)
 *   program -> programs.html, plan.html, account.html
 *   done    -> усе, крім welcome.html
 *
 * ЧОМУ СИНХРОННО Й БЕЗ Store/OnboardingCore. Ядра підключені з defer і на
 * момент перевірки ще не виконались, а чекати на них означало б показати
 * сторінку раніше за рішення. Тому тут лежить МІНІМАЛЬНА копія критеріїв
 * ядра (та сама арифметика віку, ті самі межі тіла, той самий критерій
 * програми) — і нічого більше. Розбір, стани екранів, повні межі — в
 * ядрах, які під тестами. Це єдине місце в Forge, що читає 'ib.profile'
 * повз Store; запис лишається за Store, другого джерела правди немає.
 *
 * ДЖЕРЕЛО ПРАВДИ — ПРОФІЛЬ. Окремого прапорця «онбординг пройдено» немає
 * навмисно: такий прапорець і був би тим, що підробляють. Крок щоразу
 * виводиться з наявності полів, тож підстановка «пройдено» в localStorage
 * нічого не дає — потрібні самі дані.
 *
 * ЧЕСНО ПРО МЕЖУ. Forge — статичний сайт без сервера. Будь-яку клієнтську
 * перевірку можна обійти, вписавши повний профіль у localStorage руками
 * або вимкнувши JavaScript. Сторож закриває звичайні шляхи: прямий URL,
 * «назад»/«вперед», перезавантаження, закладку, стерте чи неповне
 * сховище. Справжній барʼєр можливий лише там, де рішення ухвалює сервер.
 */
(function () {
  'use strict';

  const LS_PROFILE = 'ib.profile';
  const MIN_AGE = 17;

  function currentPage() {
    const file = location.pathname.split('/').pop();
    return file === '' ? 'index.html' : file;
  }

  /*
   * ЗАПОБІЖНИК ЦИКЛІВ. Сторож і welcome.js обидва вміють редиректити;
   * якщо їхні уявлення про стан колись розійдуться (порожній localStorage
   * проти повної хмари абощо), сайт втрапляє в нескінченне
   * перезавантаження, і людина не може зробити НІЧОГО. Тому кожен
   * редирект сторожа рахується в sessionStorage: понад 4 за 10 секунд —
   * сторож замовкає і дає сторінці відкритися. Краще один зайвий екран,
   * ніж мертвий сайт.
   */
  function redirectAllowed() {
    try {
      const now = Date.now();
      let st = null;
      try { st = JSON.parse(sessionStorage.getItem('ib.gateloop')); } catch (_) {}
      if (!st || typeof st !== 'object' || now - st.t > 10000) st = { t: now, n: 0 };
      st.n += 1;
      sessionStorage.setItem('ib.gateloop', JSON.stringify(st));
      return st.n <= 4;
    } catch (_) { return true; }
  }

  function go(page) {
    if (!redirectAllowed()) return;
    location.replace(page);
  }

  function lsJson(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v && typeof v === 'object' ? v : null;
    } catch (_) { return null; }
  }

  /* ------------------------------------------------------------------
   * Хмарний режим: спершу автентифікація і статус акаунта.
   *
   * Прапорець ib.cloud пише js/store.js (сторож виконується в <head> до
   * config.js і сам режим знати не може). ib.session і ib.account — теж
   * його кеші. ЦЕ UX-МАРШРУТИЗАЦІЯ, НЕ БАРʼЄР: приватні дані захищає RLS
   * на сервері — pending/rejected/blocked не прочитає їх, навіть якщо
   * підробить усі три ключі. Сторож лише не дає застосунку прикидатись
   * відкритим там, де сервер однаково відмовить.
   *
   *   без сесії                → тільки welcome.html (стартовий Auth-екран)
   *   статус ≠ approved        → тільки welcome.html (екран заявки)
   *   approved / кеш ще пустий → далі профільні кроки, як і раніше
   * ------------------------------------------------------------------ */
  if (localStorage.getItem('ib.cloud') === '1') {
    const here0 = currentPage();
    const sess = lsJson('ib.session');
    if (!sess || !sess.access_token) {
      if (here0 !== 'welcome.html') { go('welcome.html'); }
      return;
    }
    const acct = lsJson('ib.account');
    if (acct && acct.status && acct.status !== 'approved') {
      const ok = here0 === 'welcome.html' || (acct.isAdmin && here0 === 'admin.html');
      if (!ok) { go('welcome.html'); }
      return;
    }
    if (here0 === 'welcome.html') {
      /* Approved (або статус ще не приїхав) на welcome: хай вирішує сам
         welcome.js — він знає і статус, і крок онбордингу. Не редіректимо
         звідси, щоб не зациклитись із його власними replace(). */
      return;
    }
    // далі — звичайні профільні кроки
  }

  function profile() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_PROFILE));
      return raw && typeof raw === 'object' ? raw : null;
    } catch (_) { return null; }
  }

  /* Копія розрахунку з js/age-core.js — навмисна й мінімальна:
     різниця років мінус ненастале цьогоріч день народження. */
  function adult(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const b = new Date(y, mo - 1, d);
    if (b.getFullYear() !== y || b.getMonth() !== mo - 1 || b.getDate() !== d) return false;
    const t = new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    if (b > today) return false;
    let years = today.getFullYear() - y;
    const had = (today.getMonth() > b.getMonth()) ||
      (today.getMonth() === b.getMonth() && today.getDate() >= b.getDate());
    if (!had) years -= 1;
    return years >= MIN_AGE && years <= 120;
  }

  /* Копії критеріїв js/onboarding-core.js — ті самі межі, що й у
     валідатора імпорту (js/account.js). */
  function inRange(v, lo, hi) {
    const n = Number(v);
    return isFinite(n) && n >= lo && n <= hi;
  }

  function hasBody(p) {
    return (p.sex === 'male' || p.sex === 'female') &&
      inRange(p.weight, 30, 300) &&
      inRange(p.height, 120, 250) &&
      ['1.2', '1.375', '1.55', '1.725', '1.9'].indexOf(String(p.activity)) !== -1 &&
      ['novice', 'inter', 'adv', 'elite'].indexOf(p.trainingAge) !== -1;
  }

  function hasProgram(p) {
    if (!p.activePlan || !p.activePlan.programId) return false;
    const w = p.weights;
    if (!w || typeof w !== 'object') return false;
    for (const k in w) {
      const n = Number(w[k]);
      if (isFinite(n) && n > 0) return true;
    }
    return false;
  }

  function nonEmpty(o) {
    if (!o || typeof o !== 'object') return false;
    for (const k in o) return true;
    return false;
  }

  /* Історія користування = онбординг пройдено (захист наявних профілів). */
  function hasHistory(p) {
    return nonEmpty(p.bodyLog) || nonEmpty(p.workLog) ||
      nonEmpty(p.sessionLog) || nonEmpty(p.mealLog) ||
      nonEmpty(p.weightLog) || nonEmpty(p.trackerLog);
  }

  function stepFor(p) {
    if (!p || !adult(p.birthDate)) return 'age';
    if (hasHistory(p)) return 'done';
    if (!hasBody(p)) return 'body';
    if (!hasProgram(p)) return 'program';
    return 'done';
  }

  const ROUTES = {
    age:     { page: 'welcome.html',  allowed: ['welcome.html'] },
    body:    { page: 'welcome.html',  allowed: ['welcome.html', 'account.html'] },
    program: { page: 'programs.html', allowed: ['programs.html', 'plan.html', 'account.html'] },
    done:    { page: 'index.html',    allowed: null }
  };

  const step = stepFor(profile());
  const here = currentPage();
  const route = ROUTES[step];

  const allowed = route.allowed === null
    ? here !== 'welcome.html'
    : route.allowed.indexOf(here) !== -1;

  if (allowed) return;

  /*
   * location.replace, а не assign: сторінка, з якої нас щойно відвернули,
   * не має лишатись в історії — інакше «назад» повертало б на неї, і
   * сторож спрацьовував би знову й знову, замикаючи людину в циклі.
   */
  go(route.page);
})();
