/**
 * Сторінка акаунта: логін/реєстрація (якщо ввімкнено Supabase),
 * перегляд і редагування профілю, експорт та очищення даних.
 */
(function () {
  'use strict';

  const { $, $$, esc, round, toast } = window.App;
  const Store = window.Store;

  const PROGRAM_NAMES = {
    fullbody: 'Full Body', upperlower: 'UL', ppl: 'Push / Pull / Legs'
  };

  const GOAL_NAMES = {
    bulk: 'Набір маси', bulkfast: 'Агресивний набір', recomp: 'Рекомпозиція', maintain: 'Підтримання',
    cut: 'Скидання ваги', cutfast: 'Агресивне схуднення',
    muscle: 'Мʼязова маса', strength: 'Сила', fatloss: 'Схуднення'
  };

  /* ------------------------------------------------------------------ */
  /* Оформлення: схема + акцент                                          */
  /* ------------------------------------------------------------------ */
  /*
   * Дві незалежні осі, і саме так вони й показані:
   *
   *   СХЕМА   світло / темрява — поверхні. Типова темна.
   *   АКЦЕНТ  один хроматичний колір. Типовий Navy Blue.
   *
   * Сімей тем більше немає. Раніше їх було дві по девʼять: у «кольорових»
   * тон заходив і в поверхні (фон ставав рожевим, деревʼяним, фіолетовим),
   * у «графітових» поверхні лишались нейтральними. Кольорові прибрані —
   * правило «один відтінок плюс нейтральні» вони порушували в найдорожчому
   * місці, на суцільних поверхнях, і саме через це половина сайту виглядала
   * інакше, ніж задумана графітова основа.
   *
   * Свотчі захардкоджені, а не читаються з CSS: getComputedStyle на
   * невключеній темі повернув би кольори поточної, і всі плашки були б
   * однакові.
   *
   * Перший кружок — ПОВЕРХНЯ (вона спільна для всіх акцентів), другий —
   * те єдине, чим акценти різняться: заливка.
   */
  const SURFACE = { dark: '#171717', light: '#f6f6f6' };

  /*
   * Заливка акценту різна у схемах: у темряві світліший крок палітри (щоб
   * кнопку було видно на графіті), у світлі — темніший (щоб її було видно
   * на папері). Свотч показує ту, яка діє ЗАРАЗ, інакше він брехав би
   * рівно в половині випадків.
   */
  /*
   * Типовий вигляд — МОНОХРОМ (id: null, значення з :root). Кольорові
   * акценти лишаються як додаткові й нічого, крім акценту, не міняють.
   *
   * «Бурштин» прибраний: id 'graphite-amber' більше не чинний, і профілі
   * з ним App.normTheme відкочує на монохром.
   */
  const ACCENTS = [
    { id: null,               name: 'Монохром',   dark: '#e8e8e8', light: '#1a1a1a' },
    { id: 'graphite-navy',    name: 'Navy blue',  dark: '#6685b6', light: '#2c4160' },
    { id: 'graphite',         name: 'Дерево',     dark: '#93663e', light: '#7a5230' },
    { id: 'graphite-pink',    name: 'Рожевий',    dark: '#c43e72', light: '#c43e72' },
    { id: 'graphite-violet',  name: 'Фіолетовий', dark: '#8063c7', light: '#6b4ab8' },
    { id: 'graphite-crimson', name: 'Багрянець',  dark: '#db302a', light: '#c7231d' },
    { id: 'graphite-moss',    name: 'Мох',        dark: '#50802e', light: '#3a7410' },
    { id: 'graphite-emerald', name: 'Смарагд',    dark: '#1f835e', light: '#1e7455' },
    { id: 'graphite-ocean',   name: 'Океан',      dark: '#0d7e9a', light: '#296f81' }
  ];

  /*
   * Поточний акцент читаємо через App.normTheme, а не з атрибута напряму:
   * у профілі може лежати старий id прибраної кольорової теми ('pink'), і
   * тоді жодна плашка не була б активною — людина бачила б список, у якому
   * нічого не обрано, хоча колір на екрані є.
   */
  function currentTheme() {
    const raw = document.documentElement.getAttribute('data-theme') || null;
    return (window.App.normTheme ? window.App.normTheme(raw) : raw) || null;
  }

  function currentScheme() {
    return window.App.currentScheme ? window.App.currentScheme() : 'dark';
  }

  function renderTheme() {
    const host = $('#theme');
    if (!host) return;
    const cur = currentTheme();
    const scheme = currentScheme();
    const light = scheme === 'light';

    const swatches = ACCENTS.map(function (t) {
      const active = (t.id || null) === cur;
      return '<button class="theme-btn' + (active ? ' is-active' : '') + '" type="button" ' +
               'data-theme-pick="' + (t.id || '') + '" aria-pressed="' + active + '">' +
               '<i style="background:' + SURFACE[scheme] + '"></i>' +
               '<i style="background:' + t[scheme] + '"></i>' +
               '<span>' + esc(t.name) + '</span>' +
             '</button>';
    }).join('');

    host.innerHTML =
      '<div class="card">' +
        /* Без підписів: лишились самі контроли. Перемикач і свотчі
           говорять самі за себе, а для читалок екрана підпис нікуди не
           дівся — він у .sr-only всередині <label> і в aria-label свотчів. */
        '<div class="row row--split" style="gap:14px;align-items:center">' +
          '<label class="switch">' +
            '<input type="checkbox" id="p-scheme"' + (light ? ' checked' : '') + '>' +
            '<span class="switch__track"><span class="switch__thumb"></span></span>' +
            '<span class="sr-only">Світла тема</span>' +
          '</label>' +
        '</div>' +

        '<div class="themes mt-3">' + swatches + '</div>' +
      '</div>';
  }

  /* Слухачі вішаються РІВНО ОДИН РАЗ. wireTheme() викликається з renderAll,
     а renderAll — це Store.onChange; без цього guard кожне збереження теми
     (setTheme -> saveProfile -> onChange -> renderAll) додавало б ще один
     click-слухач на постійний #theme і ще один на document. Клік теми тоді
     плодив setTheme -> saveProfile -> onChange по колу, слухачі росли
     експоненційно, і після 3-4 перемикань сторінка зависала. Делегування
     живе на контейнері, що не зникає (renderTheme() міняє лише innerHTML),
     тож одноразового навішування досить назавжди. */
  let themeWired = false;
  function wireTheme() {
    const host = $('#theme');
    if (!host || themeWired) return;
    themeWired = true;
    host.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-theme-pick]');
      if (!btn) return;
      window.App.setTheme(btn.dataset.themePick || null);
      renderTheme();
    });
    /*
     * Схему міняє не лише цей перемикач: App.setScheme викликають
     * adoptProfileTheme (вхід на новому пристрої) та імпорт JSON. Подія
     * forge:scheme розсилалась, але слухача не мав ніхто — перемикач і
     * свотчі лишались у старому стані, показуючи темні поверхні на папері.
     */
    document.addEventListener('forge:scheme', function () { renderTheme(); });

    host.addEventListener('change', function (e) {
      if (!e.target || e.target.id !== 'p-scheme') return;
      window.App.setScheme(e.target.checked ? 'light' : 'dark');
      /* Свотчі показують заливку ДІЮЧОЇ схеми — після перемикання їх треба
         перемалювати, інакше поруч зі світлими поверхнями лишились би
         темні кружки. */
      renderTheme();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Блок режиму роботи                                                  */
  /* ------------------------------------------------------------------ */

  function renderMode() {
    const host = $('#mode');
    if (!host) return;

    if (!Store.isCloud) {
      host.innerHTML =
        '<div class="notice notice--acc">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
          '<div>' +
            '<b>Локальний режим.</b> Дані зберігаються тільки в цьому браузері й нікуди не відправляються. ' +
            'Це працює одразу і нічого не коштує, але з іншого пристрою ви їх не побачите, ' +
            'а очищення історії браузера їх зітре.<br><br>' +
            'Щоб увімкнути спільний акаунт для вас і друзів — заповніть ключі Supabase у ' +
            '<code>js/config.js</code> і виконай <code>db/schema.sql</code>. Інструкція в <code>README.md</code>.' +
          '</div>' +
        '</div>';
      return;
    }

    const user = Store.user();
    host.innerHTML = user
      ? '<div class="notice notice--acc">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></svg>' +
          '<div>Ви увійшли як <b>' + esc(user.email) + '</b>. Дані синхронізуються між пристроями.</div>' +
        '</div>'
      : '<div class="notice notice--acc">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
          '<div>Хмара підключена, але ви не увійшли. Поки що дані зберігаються локально в браузері.</div>' +
        '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Форма входу                                                         */
  /* ------------------------------------------------------------------ */

  function renderAuth() {
    const host = $('#auth');
    if (!host) return;

    if (!Store.isCloud) { host.innerHTML = ''; return; }

    const user = Store.user();

    if (user) {
      const acct = Store.accountCached && Store.accountCached();
      host.innerHTML =
        '<div class="card">' +
          '<h2 class="card__title">Сесія</h2>' +
          '<p class="small">Пошта: <b>' + esc(user.email) + '</b></p>' +
          '<button class="btn btn--ghost btn--sm" type="button" id="a-signout">Вийти</button>' +
          /* Посилання видно лише адміну; самі права перевіряє сервер
             у кожному RPC — сховати/показати лінк нічого не змінює. */
          (acct && acct.isAdmin
            ? '<div class="row mt-2"><a class="small" href="admin.html">Адмін-панель: заявки на акаунт →</a></div>'
            : '') +
        '</div>';

      $('#a-signout').addEventListener('click', async function () {
        await Store.signOut();
        toast('Ви вийшли', 'ok');
        renderAll();
      });
      return;
    }

    host.innerHTML =
      '<div class="card">' +
        '<h2 class="card__title">Вхід</h2>' +
        '<form id="a-form" class="grid" style="gap:16px;max-width:420px">' +
          '<div class="field">' +
            '<label class="field__label" for="a-email">Пошта</label>' +
            '<input class="input" id="a-email" type="email" autocomplete="email" required placeholder="you@example.com">' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="a-pass">Пароль</label>' +
            '<input class="input" id="a-pass" type="password" autocomplete="current-password" required minlength="8" placeholder="мінімум 8 символів">' +
            '<span class="field__hint">Не використовуйте пароль з інших сайтів.</span>' +
          '</div>' +
          '<div class="row">' +
            '<button class="btn btn--primary" type="submit" data-act="in">Увійти</button>' +
            /*
             * Тут БІЛЬШЕ НЕМАЄ кнопки реєстрації.
             *
             * Вона викликала Store.signUp() напряму, тобто повз усе, що
             * робить реєстрацію реєстрацією: перевірку пароля
             * (PasswordCore), нік, підтвердження віку 17+, три обовʼязкові
             * згоди й сам register_request. Створений так користувач не
             * мав рядка в account_status — а отже, за RLS, не мав доступу
             * ні до чого й полагодити це з інтерфейсу не міг.
             *
             * Реєстрація живе в одному місці — welcome.html.
             */
            '<a class="btn btn--ghost" href="welcome.html">Створити акаунт</a>' +
          '</div>' +
        '</form>' +
      '</div>';

    const form  = $('#a-form');
    const email = $('#a-email');
    const pass  = $('#a-pass');

    /**
     * Що робити з локальними даними, які були в браузері до входу.
     *
     * Раніше цього кроку не існувало взагалі, і перший вхід МОВЧКИ знищував
     * усе, що людина накопичила локально: хмарний рядок порожній -> профіль
     * зводився до бланка -> перше ж збереження затирало localStorage.
     * Місяць рецептів, журналу ваги й кастомних планів зникав без питання.
     *
     * Тепер:
     *   'adopted'  — у хмарі було порожньо, локальне просто стало хмарним;
     *   'conflict' — непорожні обидва, і вибір робить людина, а не код.
     * У будь-якому разі локальна копія вже лежить у резервній (ib.profile.backup).
     */
    async function handleMerge(merge) {
      if (!merge) return;

      if (merge === 'adopted') {
        toast('Дані з цього браузера перенесено в акаунт', 'ok');
        return;
      }

      const keepLocal = confirm(
        'В акаунті вже є збережені дані, і в цьому браузері теж.\n\n' +
        'OK — взяти дані З ЦЬОГО БРАУЗЕРА (те, що в акаунті, буде замінено).\n' +
        'Скасувати — лишити дані АКАУНТА.\n\n' +
        'Хай там як, копія локальних даних лишається на випадок помилки: ' +
        'її видно в експорті резервної копії.'
      );

      try {
        if (keepLocal) {
          await Store.adoptLocalProfile();
          toast('Перенесено дані з цього браузера', 'ok');
        } else {
          Store.discardLocalProfile();
          toast('Лишили дані акаунта', 'ok');
        }
      } catch (err) {
        toast('Не вдалося обʼєднати: ' + err.message, 'err');
      }
    }

    async function submit() {
      if (!email.value || pass.value.length < 8) {
        toast('Заповніть пошту й пароль (від 8 символів)', 'err');
        return;
      }
      const buttons = $$('#a-form button');
      buttons.forEach(function (b) { b.disabled = true; });

      try {
        const res = await Store.signIn(email.value.trim(), pass.value);
        toast('Вхід виконано', 'ok');
        await handleMerge(res.merge);
        renderAll();
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        buttons.forEach(function (b) { b.disabled = false; });
      }
    }

    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  }

  /* ------------------------------------------------------------------ */
  /* Профіль                                                             */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* Профіль — редагується просто тут                                    */
  /* ------------------------------------------------------------------ */
  /*
   * Раніше це була таблиця «тільки читати», а міняти дані доводилось на тій
   * сторінці, де їх колись увели: вагу — в харчуванні, пульс — у кардіо,
   * стаж — у прогнозі. Тепер усі скалярні поля живуть тут, а решта сайту
   * бере їх із того самого профілю.
   *
   * Свідомо НЕ редагується тільки план тренувань: це не число, а структура
   * з днями й вправами, у якої є власна сторінка з редактором.
   */

  const SEX = [
    { v: 'male',   label: 'Чоловік' },
    { v: 'female', label: 'Жінка' }
  ];

  const ACTIVITY = [
    { v: 1.2,   label: 'Сидяча робота, тренувань немає' },
    { v: 1.375, label: 'Легка активність, 1–3 тренування' },
    { v: 1.55,  label: 'Помірна активність, 3–5 тренувань' },
    { v: 1.725, label: 'Висока активність, 6–7 тренувань' },
    { v: 1.9,   label: 'Дуже висока, 2 тренування на день' }
  ];

  /* Стаж силових. Тут лише підписи — коефіцієнти, які з них випливають,
     живуть у js/projection.js і на цю сторінку не завантажуються. */
  const TRAINING_AGE = [
    { v: 'novice', label: 'До 1 року' },
    { v: 'inter',  label: '1–2 роки' },
    { v: 'adv',    label: '3–5 років' },
    { v: 'elite',  label: 'Понад 5 років' }
  ];

  /** Мета береться з калькулятора харчування, щоб списки не розʼїхались */
  function goalOptions() {
    const G = (window.NutritionCalc && window.NutritionCalc.GOALS) || {};
    return Object.keys(G).map(function (k) { return { v: k, label: G[k].label }; });
  }

  function num(v) {
    return (v === null || v === undefined || v === '') ? '' : v;
  }

  /**
   * @param {string} label
   * @param {string} inner  розмітка контролу
   * @param {string} [hint]
   * @param {string} [forId] id контролу — тоді підпис зʼєднується з ним через for.
   *                         Для груп радіокнопок id немає, і тоді підпис
   *                         лишається звичайним заголовком групи.
   */
  function field(label, inner, hint, forId) {
    return '<div class="field">' +
             '<label class="field__label"' + (forId ? ' for="' + esc(forId) + '"' : '') + '>' +
               esc(label) +
             '</label>' + inner +
             (hint ? '<span class="field__hint">' + esc(hint) + '</span>' : '') +
           '</div>';
  }

  /** Стабільний id з ключа профілю: hrRest → p-hrRest */
  function fieldId(key) {
    return 'p-' + String(key).replace(/\./g, '-');
  }

  function numberInput(key, value, opts) {
    const o = opts || {};
    return '<input class="input" id="' + fieldId(key) + '" ' +
           'type="number" inputmode="' + (o.decimal ? 'decimal' : 'numeric') + '" ' +
           'min="' + o.min + '" max="' + o.max + '" step="' + (o.step || 1) + '" ' +
           'placeholder="' + esc(o.placeholder || '—') + '" ' +
           'value="' + esc(num(value)) + '" data-p="' + key + '">';
  }

  function selectInput(key, value, list) {
    return '<select class="select" id="' + fieldId(key) + '" data-p="' + key + '">' +
             '<option value="">—</option>' +
             list.map(function (o) {
               return '<option value="' + esc(o.v) + '"' +
                      (String(o.v) === String(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
             }).join('') +
           '</select>';
  }

  function segInput(key, value, list) {
    return '<div class="seg">' +
             list.map(function (o) {
               return '<label class="seg__item">' +
                        '<input type="radio" name="' + key + '" value="' + esc(o.v) + '" data-p="' + key + '"' +
                        (String(o.v) === String(value) ? ' checked' : '') + '>' +
                        '<span>' + esc(o.label) + '</span>' +
                      '</label>';
             }).join('') +
           '</div>';
  }

  /** Скільки полів заповнено — щоб було видно, чого бракує розрахункам */
  function completeness(p) {
    const keys = ['sex', 'age', 'height', 'weight', 'activity', 'goal'];
    const done = keys.filter(function (k) { return p[k] !== null && p[k] !== undefined && p[k] !== ''; });
    return { done: done.length, total: keys.length };
  }

  /**
   * Стать — ТІЛЬКИ показ. Задається один раз при реєстрації і в акаунті не
   * змінюється: від неї залежить набір програм (жіночі/чоловічі схеми), і
   * мовчазна зміна тут відчіпляла б активний план та плутала розрахунки.
   * Якщо стать чомусь не задана (не мало б статись після онбордингу) —
   * лишаємо вибір, щоб користувач не застряг без можливості її вказати.
   */
  /* Адмінові стать редагується (для тестів схем), звичайному користувачу —
     ні. Це UI-запобіжник, не безпека: стать не привілейоване поле, а чужий
     план однаково блокує серверний resolvePlan. isAdmin — із account_state
     (сервер), кешований; підміна кешу відкрила б перемикач лише для власної
     статі, що й так робиться правкою профілю — привілеїв це не піднімає. */
  function isAdmin() {
    try {
      const acc = Store.accountCached && Store.accountCached();
      return Boolean(acc && acc.isAdmin);
    } catch (_) { return false; }
  }

  function sexField(p) {
    const cur = SEX.filter(function (o) { return o.v === p.sex; })[0];
    // Стать не задана (не мало б статись після онбордингу) або адмін —
    // показуємо вибір, щоб було чим її поставити/змінити.
    if (!cur || isAdmin()) {
      return field('Стать', segInput('sex', p.sex, SEX),
        cur ? 'Змінюється лише в адмін-акаунті.' : 'Задається під час реєстрації.');
    }
    return field('Стать',
      '<p class="mono" style="margin:8px 0 0">' + esc(cur.label) + '</p>',
      'Задається під час реєстрації і тут не змінюється.');
  }

  async function renderProfile() {
    const host = $('#profile');
    if (!host) return;

    let p;
    try { p = await Store.getProfile(); }
    catch (e) { host.innerHTML = '<div class="notice">Не вдалося прочитати профіль: ' + esc(e.message) + '</div>'; return; }

    const c = completeness(p);
    const target = window.NutritionCalc ? window.NutritionCalc.targetFor(p) : null;

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 class="card__title" style="margin:0">Мої дані</h2>' +
          '<span class="chip' + (c.done === c.total ? ' chip--acc' : '') + '">' +
            c.done + ' / ' + c.total + ' для розрахунків' +
          '</span>' +
        '</div>' +
        '<p class="small muted mt-1">Зберігається одразу, без окремої кнопки.</p>' +

        '<div class="grid mt-3" style="gap:18px">' +
          sexField(p) +
          '<div class="grid grid-4">' +
            field('Вік, років', numberInput('age', p.age, { min: 14, max: 90, placeholder: '25' }), '', fieldId('age')) +
            field('Зріст, см', numberInput('height', p.height, { min: 120, max: 230, placeholder: '180' }), '', fieldId('height')) +
            field('Вага, кг', numberInput('weight', p.weight, { min: 35, max: 250, step: 0.1, decimal: true, placeholder: '80' }), '', fieldId('weight')) +
            field('Жир, %', numberInput('bodyfat', p.bodyfat, { min: 3, max: 60, step: 0.5, decimal: true }),
                  'Необовʼязково. Якщо вказати — обмін рахується за Katch-McArdle.', fieldId('bodyfat')) +
          '</div>' +
        '</div>' +

        '<hr class="divider">' +
        '<h3 class="group-title">Харчування</h3>' +
        '<div class="grid grid-2" style="gap:18px">' +
          field('Рівень активності', selectInput('activity', p.activity, ACTIVITY),
                'Найбільше джерело похибки. Сумніваєтесь — беріть нижчий.', fieldId('activity')) +
          field('Мета', selectInput('goal', p.goal, goalOptions()), '', fieldId('goal')) +
          field('Прийомів їжі на добу', numberInput('meals', p.meals, { min: 3, max: 6, placeholder: '4' }), '', fieldId('meals')) +
        '</div>' +

        '<hr class="divider">' +
        '<h3 class="group-title">Тренування</h3>' +
        '<div class="grid" style="gap:18px">' +
          field('Днів у залі на тиждень', segInput('daysPerWeek', p.daysPerWeek,
                [3, 4, 5, 6].map(function (n) { return { v: n, label: String(n) }; }))) +
          field('Стаж силових', selectInput('trainingAge', p.trainingAge, TRAINING_AGE),
                'Керує швидкістю кривої в прогнозі робочих ваг.', fieldId('trainingAge')) +
        '</div>' +
        '<p class="small muted">' +
          'План тренувань редагується на сторінці <a href="plan.html">Мій план</a>.' +
          (p.activePlan
            ? ' Зараз обрано: <b>' + esc((PROGRAM_NAMES[p.activePlan.programId] || p.activePlan.programId)) +
              ', ' + esc(p.activePlan.days) + ' дн.</b>'
            : ' Зараз план не обрано.') +
        '</p>' +

        '<hr class="divider">' +
        '<h3 class="group-title">Пульс</h3>' +
        '<div class="grid grid-2" style="gap:18px">' +
          field('Пульс спокою', numberInput('hrRest', p.hrRest, { min: 30, max: 120, placeholder: '60' }),
                'Виміряний одразу після пробудження, лежачи.', fieldId('hrRest')) +
          field('Максимальний пульс', numberInput('hrMax', p.hrMax, { min: 120, max: 230 }),
                'Якщо не вказати — рахується за віком (208 − 0,7 × вік).', fieldId('hrMax')) +
        '</div>' +

        (target
          ? '<hr class="divider">' +
            '<div class="notice notice--acc">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
              '<div class="small">З цих даних виходить <b>' + round(target.kcal, 0) + ' ккал</b> на добу ' +
              '(' + esc(target.goalLabel) + '): білок ' + round(target.protein, 0) + ' г, ' +
              'жир ' + round(target.fat, 0) + ' г, вуглеводи ' + round(target.carb, 0) + ' г. ' +
              'Розклад по прийомах — на сторінці <a href="nutrition.html">Харчування</a>.</div>' +
            '</div>'
          : '<hr class="divider">' +
            '<div class="notice">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
              '<div class="small">Щоб зʼявився розрахунок калорій, заповніть стать, вік, зріст і вагу.</div>' +
            '</div>') +

        '<hr class="divider">' +
        '<div class="row" style="justify-content:space-between">' +
          '<div class="row">' +
            '<button class="btn btn--ghost btn--sm" type="button" id="p-export">Експортувати JSON</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" id="p-import">Імпортувати JSON</button>' +
            '<input type="file" id="p-import-file" accept=".json,application/json" hidden aria-label="Файл профілю JSON">' +
            /* Відкат імпорту. Діалог імпорту обіцяв «імпорт можна відкотити»,
               резервна копія писалась — а кнопки, яка б її повернула, не
               існувало ніде. Тобто помилковий імпорт був незворотним, ще й
               одразу розлітався на всі пристрої в хмарному режимі. */
            (backupInfo()
              ? '<button class="btn btn--ghost btn--sm" type="button" id="p-restore">Відкотити імпорт</button>'
              : '') +
            '<button class="btn btn--ghost btn--sm" type="button" id="p-clear">Стерти локальні дані</button>' +
            (Store.isCloud && Store.user()
              ? '<button class="btn btn--ghost btn--sm" type="button" id="p-delete-acc">Видалити акаунт</button>'
              : '') +
          '</div>' +
          '<span class="small muted" id="p-saved">' +
            (p.updatedAt ? 'Збережено ' + new Date(p.updatedAt).toLocaleString('uk-UA') : 'Ще нічого не збережено') +
          '</span>' +
        '</div>' +
      '</div>';

  }

  /** Резервна копія перед імпортом: { savedAt, ...профіль } або null. */
  function backupInfo() {
    try {
      const raw = localStorage.getItem('ib.profile.backup');
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : null;
    } catch (_) { return null; }
  }

  /* ------------------------------------------------------------------ */
  /* Збереження                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Приводить введене до того типу, який очікує решта сайту.
   * Порожнє поле — це null («не задано»), а не нуль: нуль зіпсував би
   * розрахунки, бо вага 0 кг і «вагу не вказано» — різні речі.
   */
  /* Ті самі межі, за якими NutritionCalc вирішує, рахувати чи повернути
     null. Без клампу тут поле «вага 1000» лягало в профіль і знеструмлювало
     розрахунок калорій на всьому сайті, а сторінка акаунта при цьому
     показувала «6/6 для розрахунків». */
  const FIELD_RANGE = {
    age: [10, 100], height: [120, 250], weight: [30, 300], bodyfat: [3, 60],
    daysPerWeek: [1, 7], hrRest: [30, 110], hrMax: [120, 230], meals: [2, 6]
  };

  function coerce(key, raw) {
    const v = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (v === '') return null;
    if (key === 'sex' || key === 'goal' || key === 'trainingAge') return v;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const r = FIELD_RANGE[key];
    return r ? Math.min(r[1], Math.max(r[0], n)) : n;
  }

  /* Пишемо не на кожну натиснуту клавішу: інакше при вводі «180» профіль
     збережеться тричі, останній раз — уже правильно, але перед тим
     встигне побувати «1» і «18». */
  let saveTimer = null;
  let pending = {};

  /**
   * Записати накопичене негайно, не чекаючи таймера.
   *
   * Потрібне рівно для одного випадку: користувач набрав вагу й одразу
   * пішов на іншу сторінку. Ті 400 мс затримки сторінка не переживає,
   * і зміна губиться мовчки — поле показувало нове число, а в профіль
   * воно не доїхало.
   *
   * @returns {Promise|null} null, якщо писати нема чого
   */
  function flushSave() {
    if (!Object.keys(pending).length) return null;
    clearTimeout(saveTimer);
    saveTimer = null;
    const patch = detachPlanIfForeign(pending);
    pending = {};

    /*
     * Саме тут ховалась головна тиха втрата.
     *
     * Звичайний fetch у момент вивантаження сторінки браузер СКАСОВУЄ, а
     * .catch(() => {}) робив це скасування невидимим: у localStorage нове
     * значення лягало, у хмару — ні, і після F5 воно зникало без жодного
     * попередження. saveProfileBeacon шле запит із keepalive, тобто такий,
     * що переживає закриття вкладки; якщо не влізає — кладе патч у чергу.
     */
    return Store.saveProfileBeacon(patch);
  }

  /* Сторінка ховається (перехід, згортання вкладки, блокування екрана) —
     дописуємо. pagehide, а не beforeunload: другий не спрацьовує на iOS
     і не дає надійного вікна для запису. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSave();
  });
  window.addEventListener('pagehide', flushSave);

  /*
   * ЗМІНА СТАТІ ВІДЧІПЛЮЄ ПЛАН ЧУЖОЇ СТАТІ.
   *
   * Схеми тренувань розділені за статтю (js/programs-data.js). Якщо
   * лишити activePlan як є, профіль указував би на схему, якої людина
   * більше не бачить: сторінки її не покажуть (resolvePlan мовчки віддає
   * null), і замість плану всюди висів би порожній стан без пояснення.
   * Тому прив'язку знімаємо одразу й тим самим збереженням.
   *
   * customPlans НЕ чіпаємо: це правки, зроблені руками. Якщо стать
   * повернуть назад, вони мають бути на місці.
   */
  function detachPlanIfForeign(patch) {
    if (!('sex' in patch)) return patch;
    const allowed = window.programAllowedFor;
    const list = window.PROGRAMS || [];
    /* Локальний знімок профілю — той самий, що читає решта сторінки
       (Store.localProfile), і він синхронний: чекати на мережу тут не
       можна, патч уже збирається на відправку. */
    const active = ((Store.localProfile() || {}).activePlan) || null;
    if (typeof allowed !== 'function' || !active || !active.programId) return patch;
    const program = list.find(function (p) { return p.id === active.programId; });
    if (program && allowed(program, patch.sex)) return patch;
    return Object.assign({}, patch, { activePlan: null, programId: null });
  }

  function queueSave(key, value) {
    pending[key] = value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async function () {
      const patch = detachPlanIfForeign(pending);
      pending = {};

      try {
        await Store.saveProfile(patch);
        const mark = $('#p-saved');
        // toLocaleString, а не ...TimeString: та сама форма, що й при
        // першому малюванні (рядок вище). Інакше позначка мовчки губила
        // дату, щойно людина щось відредагувала.
        if (mark) mark.textContent = 'Збережено ' + new Date().toLocaleString('uk-UA');
        maybeBmiWarn(patch);
      } catch (e) {
        toast('Не збереглося: ' + e.message, 'err');
      }
    }, 400);
  }

  /**
   * BMI-попередження після збереження НОВОЇ ваги/зросту — не при кожному
   * відкритті профілю. Показ один раз на категорію (bmiAck у профілі);
   * та сама логіка, що в скринінгу (js/bmi-core.js).
   */
  function maybeBmiWarn(patch) {
    const BC = window.BmiCore;
    if (!BC) return;
    if (!('weight' in patch) && !('height' in patch)) return;
    const p = Store.localProfile() || {};
    const b = BC.bmi(p.weight, p.height);
    if (!BC.shouldWarn(b, p.bmiAck)) return;
    BC.showWarnModal(b, function () {
      Store.saveProfile({ bmiAck: BC.ackFor(b) }).catch(function () {});
    });
  }

  /**
   * Обробники вішаються ОДИН раз на контейнер, а не на кнопки всередині:
   * розмітку профілю перемальовує renderProfile, і прямі посилання на
   * елементи після цього вказували б у порожнечу.
   */
  let wired = false;

  function wireProfileForm() {
    const host = $('#profile');
    if (!host || wired) return;
    wired = true;

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
    const ALLOWED_KEYS = ['birthDate','sex','age','height','weight','bodyfat','daysPerWeek',
      'programId','goal','customPlans','weights','activePlan','trainingAge',
      'activity','meals','recipes','day','hrRest','hrMax','records',
      'displayName','pet','scheme',
      'bodyLog','workLog','theme','periodization','deload',
      'weightLog','sessionLog','mealLog','trackers','trackerLog',
      'measureLog','bmiAck',
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
      daysPerWeek: [1, 7], meals: [1, 8],
      hrRest: [30, 120], hrMax: [120, 230]
    };
    /* Ключі, для яких null — чинне «не задано» (дивись blankProfile()).
       Усе, що не тут, при null відкидається: журнали й реєстри мають
       порожню форму {} або [], і підміна їх на null — це втрата даних. */
    const NULLABLE = {
      birthDate: 1,
      sex: 1, age: 1, height: 1, weight: 1, bodyfat: 1, daysPerWeek: 1,
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
      /* Прибрані кольорові id лишаються дозволеними НА ВХОДІ: у старих
         резервних копіях вони є, а App.normTheme переносить їх на
         найближчий чинний акцент. Відкинути їх означало б мовчки втратити
         вибір людини під час імпорту. */
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
          if (it.kind === 'recipe') {
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
          const n = finite(v, NUM_LIMITS[k][0], NUM_LIMITS[k][1]);
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
            const days = finite(v.days, 1, 7);
            if (!str(v.programId, 60) || days === null) return reject(k);
            return accept(k, { programId: v.programId, days: days });
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
                days: finite(s.days, 0, 7) || 0,
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
                /* settings не мали ЖОДНОГО обмеження — ні за розміром, ні за
           глибиною, ні за кількістю ключів, і множились на 200 трекерів.
           Беремо лише скаляри верхнього рівня, не більше 20 ключів. */
        settings: cleanSettings(t.settings),
                goal: t.goal === null ? null : finite(t.goal, 0, 100000),
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

          /* ---- Forge Rating (етап 5) ---- */

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
           * З неї виводиться доступ до Forge, тому імпорт не може стати
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

    host.addEventListener('change', async function (e) {
      if (e.target.id !== 'p-import-file') return;
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;

      let raw;
      try { raw = await file.text(); }
      catch (err) { toast('Не вдалося прочитати файл', 'err'); return; }

      let data;
      try { data = JSON.parse(raw); }
      catch (err) { toast('Це не JSON: ' + err.message, 'err'); return; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        toast('У файлі не обʼєкт профілю', 'err');
        return;
      }

      const res = validateImport(data);
      const known = res.taken.length;

      if (!known && !res.rejected.length) {
        toast('У файлі немає жодного поля профілю FORGE', 'err');
        return;
      }
      if (!known) {
        toast('Жодне поле не пройшло перевірку: ' + res.rejected.join(', '), 'err');
        return;
      }

      /*
       * СУМАРНА СТЕЛЯ РОЗМІРУ.
       *
       * Поштучні ліміти були (300 вправ × 2000 записів, 200 трекерів ×
       * 4000 дат, 20000 ключів ratingSeen), але жоден не обмежував суму, а
       * trackers[].settings не обмежувався взагалі. Разом це дозволяло
       * зібрати профіль на десятки мегабайтів: у хмару він писався, у
       * localStorage — ні, і сайт ставав непрацездатним без способу
       * полагодити його з інтерфейсу.
       *
       * Перевірка ПІСЛЯ валідації і ДО резервної копії: відхилений імпорт
       * не чіпає ні даних, ні копії.
       */
      const MAX_PATCH_BYTES = 1024 * 1024;   // 1 МБ — вище стелі реального профілю за роки
      let patchBytes = 0;
      try {
        patchBytes = new Blob([JSON.stringify(res.patch)]).size;
      } catch (_) {
        patchBytes = JSON.stringify(res.patch).length * 2;   // груба оцінка UTF-16
      }
      if (patchBytes > MAX_PATCH_BYTES) {
        toast('Файл завеликий: ' + Math.round(patchBytes / 1024) + ' КБ при межі ' +
              Math.round(MAX_PATCH_BYTES / 1024) + ' КБ. Нічого не змінено.', 'err');
        return;
      }

      let msg = 'Імпортувати ' + known + ' полів із «' + file.name + '»?\n' +
                'Поточні значення цих полів буде перезаписано.';
      if (res.rejected.length) {
        msg += '\n\nНЕ буде взято (зіпсована або незнайома форма даних):\n' +
               res.rejected.join(', ');
      }
      msg += '\n\nПоточний профіль зберігається в резервну копію — імпорт можна відкотити.';
      if (!confirm(msg)) return;

      // Резервна копія ПЕРЕД записом: інакше невдалий імпорт нічим відкотити.
      try {
        const before = await Store.getProfile();
        localStorage.setItem('ib.profile.backup',
          JSON.stringify(Object.assign({ savedAt: new Date().toISOString() }, before)));
      } catch (_) {
        if (!confirm('Не вдалося зробити резервну копію (сховище переповнене?). Імпортувати без неї?')) return;
      }

      try {
        await Store.saveProfile(res.patch);
        toast('Імпортовано полів: ' + known +
              (res.rejected.length ? ' · відкинуто: ' + res.rejected.length : ''), 'ok');
        renderProfile();
        // Тему треба саме ЗАСТОСУВАТИ, а не лише перемалювати перемикач:
        // renderTheme малює вибір, а колір на сторінці ставить App.setTheme.
        if ('theme' in res.patch && App.setTheme) App.setTheme(res.patch.theme, { save: false });
        if ('scheme' in res.patch && App.setScheme) App.setScheme(res.patch.scheme, { save: false });
        renderTheme();
      } catch (err) {
        toast(err.queued ? err.message : 'Не збереглося: ' + err.message, err.queued ? 'ok' : 'err');
      }
    });

    host.addEventListener('click', async function (e) {
      if (e.target.closest('#p-import')) {
        const fileInput = $('#p-import-file');
        if (fileInput) fileInput.click();
        return;
      }
      if (e.target.closest('#p-export')) {
        const data = await Store.getProfile();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'forge-profile.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        return;
      }
      if (e.target.closest('#p-restore')) {
        const bak = backupInfo();
        if (!bak) { toast('Резервної копії немає', 'err'); return; }
        const when = bak.savedAt ? new Date(bak.savedAt).toLocaleString('uk-UA') : 'невідомо коли';
        if (!confirm('Повернути профіль, який був до імпорту (' + when + ')?\n\n' +
                     'Поточні дані буде перезаписано.')) return;
        const restore = Object.assign({}, bak);
        delete restore.savedAt;
        try {
          await Store.saveProfile(restore);
          toast('Профіль повернуто до стану перед імпортом', 'ok');
          renderProfile();
          if (App.setTheme) App.setTheme(restore.theme || null, { save: false });
          if (App.setScheme) App.setScheme(restore.scheme || 'dark', { save: false });
          renderTheme();
        } catch (err) {
          toast(err.queued ? err.message : 'Не вдалося відкотити: ' + err.message, err.queued ? 'ok' : 'err');
        }
        return;
      }

      if (e.target.closest('#p-clear')) {
        /*
         * Текст мусить бути точним. Кнопка стирає дані В ЦЬОМУ БРАУЗЕРІ —
         * профіль, сесію, тему, згорнуті блоки, чергу незбережених патчів.
         * Хмарний рядок вона НЕ чіпає, і раніше це збивало з пантелику:
         * одразу після стирання renderProfile тягнув усе назад із хмари,
         * і виглядало, наче кнопка нічого не зробила.
         */
        const cloud = Store.isCloud && Store.user();
        const msg = cloud
          ? 'Стерти дані в цьому браузері й вийти з акаунта?\n\n' +
            'Те, що збережено в акаунті, ЛИШИТЬСЯ — після наступного входу ' +
            'дані повернуться. Щоб видалити їх назовсім, спершу експортуйте ' +
            'копію, а потім видаліть акаунт у Supabase.'
          : 'Стерти всі дані в цьому браузері? Дію не можна скасувати — ' +
            'іншої копії немає. Спершу варто зробити «Експортувати JSON».';
        if (!confirm(msg)) return;
        Store.clearLocal();
        toast('Дані в цьому браузері стерто', 'ok');
        renderProfile();
        return;
      }

      if (e.target.closest('#p-delete-acc')) {
        /*
         * ПОВНЕ видалення: серверний RPC зносить акаунт із каскадами
         * (профіль, журнали, рейтинг, заявка, згоди) — після цього дані
         * недоступні і через API. Два підтвердження, друге — введенням
         * слова: подвійний confirm мимоволі проклацується.
         */
        if (!confirm('Видалити акаунт НАЗАВЖДИ?\n\nБуде видалено все: профіль, журнали, ' +
          'заміри, рейтинг, історію сезонів і сам обліковий запис. Відновлення немає.\n\n' +
          'Радимо спершу «Експортувати JSON».')) return;
        const word = prompt('Щоб підтвердити, введіть слово: ВИДАЛИТИ');
        if (word !== 'ВИДАЛИТИ') { toast('Видалення скасовано', 'ok'); return; }
        try {
          await Store.deleteAccount();
          alert('Акаунт видалено.');
          location.replace('welcome.html');
        } catch (err) {
          const m = String((err && err.message) || '');
          toast(m.indexOf('LAST_ADMIN') !== -1
            ? 'Останній адміністратор не може видалити себе'
            : 'Не вдалося видалити: ' + m, 'err');
        }
      }
    });

    // input — для полів, де друкують; change — для select і радіо
    ['input', 'change'].forEach(function (evt) {
      host.addEventListener(evt, function (e) {
        const el = e.target.closest('[data-p]');
        if (!el) return;
        if (evt === 'input' && el.tagName !== 'INPUT') return;
        if (evt === 'input' && el.type === 'radio') return;
        queueSave(el.dataset.p, coerce(el.dataset.p, el.value));
      });
    });
  }

  /* ------------------------------------------------------------------ */

  async function renderAll() {
    renderMode();
    renderTheme();
    wireTheme();
    renderAuth();

    // Якщо фокус зараз у полі профілю, значить його саме зараз редагують —
    // перемальовування вибило б курсор і скинуло напівнабране число.
    const active = document.activeElement;
    if (active && active.closest && active.closest('#profile')) return;

    await renderProfile();
    wireProfileForm();
  }

  function init() {
    if (!$('#profile')) return;
    renderAll();
    Store.onChange(renderAll);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
