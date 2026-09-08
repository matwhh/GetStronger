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

  /*
   * ПОКАЗАНА СТОРІНКА РОЗРИВАЄ ЛАНЦЮГ (UX-007).
   *
   * Лічильник рахував УСІ редиректи за 10 секунд, а обнулявся лише за
   * часом. Тобто пʼять звичайних переходів на закриті сторінки поспіль
   * (людина тицяє в меню, поки заповнює онбординг) вичерпували ліміт — і
   * шостий раз сторож мовчав, пускаючи в застосунок із порожнім профілем.
   * Запобіжник має ловити ЦИКЛ, а не суму окремих переходів.
   *
   * ЧОМУ НЕ СКИДАЄМО ТУТ-ТАКИ. Сторож виконується в <head>. Скидання в
   * цю ж мить обнуляло б лічильник і в справжньому циклі, де кожне друге
   * коло проходить через дозволену сторінку (саме такий пінг-понг
   * описаний нижче в хмарній гілці) — і запобіжник не спрацював би вже
   * ніколи. Тому скидаємо, лише коли сторінка протрималась на екрані
   * півтори секунди: цикл стільки не живе, а людина — так.
   */
  function redirectChainDone() {
    try {
      setTimeout(function () {
        try { sessionStorage.removeItem('ib.gateloop'); } catch (_) {}
      }, 1500);
    } catch (_) {}
  }

  /*
   * Редирект сторожа НЕ МАЄ губити фрагмент із листа.
   *
   * Supabase повертає людину з токенами у фрагменті (#access_token=… або
   * #error=…), а приймає їх лише welcome.js. Якщо лист привів на іншу
   * сторінку (Site URL вказує на корінь, стара закладка, ручний перехід),
   * сторож відсилає на welcome.html — і при звичайному location.replace
   * фрагмент відпадає разом із токеном: людина приходить не ввійденою,
   * а підтвердження вже витрачене. Тому фрагмент їде далі.
   *
   * Переносимо тільки те, що справді від Supabase: інакше сюди можна було б
   * підкласти будь-який фрагмент і протягти його на іншу сторінку.
   */
  /*
   * ТОКЕН З ЛИСТА НЕ МАЄ ЛИШАТИСЬ В АДРЕСНОМУ РЯДКУ (WEB-009).
   *
   * Фрагмент #access_token=… споживає лише welcome.js. Якщо сторож
   * редиректить, фрагмент їде з ним (див. go). Але коли редиректу немає —
   * а це рівно випадок «людина вже ввійшла і профіль заповнений», —
   * welcome.js не виконується, і токен лишається і в адресному рядку, і в
   * записі історії назавжди: у скріншоті, у «поділитися», у синхронізації
   * вкладок браузера.
   *
   * Два різні випадки:
   *   • сесії НЕМАЄ — токен, найпевніше, свій; відправляємо на welcome.html
   *     разом із фрагментом, там його приймуть як належить;
   *   • сесія Є — приймати чужий токен поверх наявної сесії не можна
   *     (WEB-001), тому фрагмент просто стираємо з адреси без переходу.
   */
  function handleStrayFragment() {
    let hash = '';
    try { hash = String(location.hash || ''); } catch (_) {}
    if (!/(^|[#&])(access_token=|error=|error_code=)/.test(hash)) return;
    if (currentPage() === 'welcome.html') return;   // тут його і мають прийняти

    /*
     * ПЕРЕХОДУ ТУТ НЕ БУВАЄ — ЛИШЕ СТИРАННЯ.
     *
     * Спокуса «відправити токен на welcome.html, хай приймуть» дає
     * нескінченний цикл: із повним профілем сторож welcome.html не
     * дозволяє і жене назад. А везти токен туди й не треба — випадки, коли
     * він потрібен (немає сесії, статус не approved), сторож перехоплює
     * ВИЩЕ й редиректить сам, разом із фрагментом (див. go). Сюди
     * виконання доходить лише тоді, коли людина вже ввійшла й схвалена, —
     * а приймати чужий токен поверх наявної сесії заборонено (WEB-001).
     */
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (_) {
      /* Старий браузер або file:// — фрагмент лишиться, але це найгірше,
         що станеться: жодної логіки на ньому вже не тримається. */
    }
  }

  function go(page) {
    if (!redirectAllowed()) return;
    let hash = '';
    try { hash = String(location.hash || ''); } catch (_) {}
    let carry = /(^|[#&])(access_token=|error=|error_code=)/.test(hash) ? hash : '';
    /*
     * Токен переносимо ЛИШЕ коли сесії ще немає.
     *
     * Інакше достатньо було посилання на будь-яку сторінку сайту з чужим
     * access_token у фрагменті: сторож сумлінно тягнув його на welcome.html,
     * і той приймав чужу сесію поверх наявної (WEB-001). Повідомлення про
     * помилку (#error=…) переносимо завжди — воно нікого нікуди не садить.
     */
    if (carry.indexOf('access_token=') !== -1 && hasSession()) carry = '';
    location.replace(page + carry);
  }

  /** Чи є збережена сесія — у будь-якому зі сховищ. */
  function hasSession() {
    try { if (localStorage.getItem('ib.session')) return true; } catch (_) {}
    try { if (sessionStorage.getItem('ib.session')) return true; } catch (_) {}
    return false;
  }

  function lsJson(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v && typeof v === 'object' ? v : null;
    } catch (_) { return null; }
  }
  function ssJson(key) {
    try {
      const v = JSON.parse(sessionStorage.getItem(key));
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
  /*
   * ЄДИНЕ звернення до сховища без try/catch у всьому сторожі — і воно
   * стояло тут. У браузері, який забороняє доступ до localStorage
   * (жорсткі налаштування приватності, третьосторонній контекст),
   * getItem кидає SecurityError, виконання сторожа обривається на цьому
   * рядку — і сторінка відкривається повністю: ні вікової перевірки, ні
   * маршрутизації онбордингу (LOC-008).
   */
  let cloudFlag = null;
  try { cloudFlag = localStorage.getItem('ib.cloud'); } catch (_) {}
  if (cloudFlag === '1') {
    const here0 = currentPage();
    /* Сесія лежить у localStorage («запамʼятати мене») АБО в sessionStorage
       (галочку знято — живе до закриття вкладки). Сторож мусить бачити
       обидва сховища, інакше знята галочка кидала кожен перехід на
       welcome, а welcome (який бачить сесію) — назад: пінг-понг до
       спрацювання лімітера. */
    const sess = lsJson('ib.session') || ssJson('ib.session');
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

  /* Історія користування = онбординг пройдено (захист наявних профілів).
     Копія правила з js/onboarding-core.js — сторож виконується в <head>
     до нього. Змінюєш там — зміни тут. */
  function hasLoggedWeight(log) {
    if (!nonEmpty(log)) return false;
    for (const name in log) {
      const recs = log[name];
      if (!Array.isArray(recs)) continue;
      for (const r of recs) {
        const n = Number(r && r.kg);
        if (Number.isFinite(n) && n > 0) return true;
      }
    }
    return false;
  }

  function hasHistory(p) {
    return nonEmpty(p.bodyLog) || nonEmpty(p.workLog) ||
      nonEmpty(p.sessionLog) || nonEmpty(p.mealLog) ||
      /* Нульова робоча вага — не подія журналу (UX-004). */
      hasLoggedWeight(p.weightLog) || nonEmpty(p.trackerLog);
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

  const prof = profile();
  const step = stepFor(prof);
  const here = currentPage();
  const route = ROUTES[step];

  let allowed = route.allowed === null
    ? here !== 'welcome.html'
    : route.allowed.indexOf(here) !== -1;

  /*
   * ВІДНОВЛЕННЯ З ФАЙЛА МАЄ БУТИ ДОСЯЖНИМ (LOC-005).
   *
   * Єдиний інтерфейс імпорту резервної копії — account.html. У чистому
   * браузері (або одразу після кнопки «Стерти дані в цьому браузері»)
   * профілю немає, крок = age, і людину пускало лише на welcome.html, де
   * слова «імпорт» немає взагалі. Тобто відновитися з власного експорту
   * було неможливо саме тоді, коли це й потрібно.
   *
   * ЛИШЕ коли дати народження немає ЗОВСІМ. Профіль із дитячою датою — це
   * не «дані ще не введені», а відповідь «ні»: його account.html не пускає
   * і пускати не має. Після імпорту сторож відпрацює знову вже на нових
   * даних, і дитяча дата з файла так само відверне на гейт.
   */
  if (!allowed && step === 'age' && here === 'account.html' &&
      !(prof && typeof prof.birthDate === 'string' && prof.birthDate)) {
    allowed = true;
  }

  if (allowed) {
    redirectChainDone();
    handleStrayFragment();
    return;
  }

  /*
   * location.replace, а не assign: сторінка, з якої нас щойно відвернули,
   * не має лишатись в історії — інакше «назад» повертало б на неї, і
   * сторож спрацьовував би знову й знову, замикаючи людину в циклі.
   */
  go(route.page);
})();
