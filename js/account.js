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
   * ВИБОРУ ОФОРМЛЕННЯ ТУТ БІЛЬШЕ НЕМАЄ.
   *
   * Був перемикач «світла тема» й дев'ять плашок акценту (монохром +
   * вісім кольорових). Прибрано разом із самими темами — див. блок
   * «Оформлення» в js/app.js: лишилась одна монохромна темна основа, і
   * вибирати нічого.
   *
   * Ключі theme / scheme у профілі лишились і не заважають: правил під
   * ці значення в CSS немає, тож старі профілі просто малюються
   * монохромом. Імпорт чужого JSON їх так само приймає й так само нічого
   * не міняє на екрані.
   */

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
          /*
           * «Запамʼятати мене» типово УВІМКНЕНО: Get Stronger відкривають у залі
           * з телефона між підходами, і вводити пароль щоразу — гарантія,
           * що тренування просто не запишуть. Знята галочка тримає сесію
           * лише поки жива вкладка — це для спільного компʼютера.
           */
          '<label class="check">' +
            '<input type="checkbox" id="a-remember"' +
              (!window.Store || window.Store.remember === undefined || window.Store.remember() ? ' checked' : '') + '>' +
            '<span>Запамʼятати мене на цьому пристрої</span>' +
          '</label>' +
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
    /*
     * Правило злиття живе в Store.resolveMerge — воно однакове й тут, і на
     * welcome.html. Сторінка дає лише свої способи спитати й сказати.
     */
    function handleMerge(merge) {
      return Store.resolveMerge(merge, {
        ask: function (text) { return confirm(text); },
        notify: function (text, kind) { toast(text, kind); }
      });
    }

    async function submit() {
      if (!email.value || pass.value.length < 8) {
        toast('Заповніть пошту й пароль (від 8 символів)', 'err');
        return;
      }
      const buttons = $$('#a-form button');
      buttons.forEach(function (b) { b.disabled = true; });

      try {
        /* Прапорець ставимо ДО входу: signIn одразу пише сесію, і після
           нього переносити її між сховищами було б зайвим кроком. */
        const rem = $('#a-remember');
        if (rem && Store.remember) Store.remember(rem.checked);
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
    /* Дробові поля (вага, жир) — text, а не number: number у Chromium з
       англійською локаллю викидає кому, і «58,5» ставало 585. Межі й кома
       обробляються в coerce(), браузерні min/max тут і так не барʼєр. */
    if (o.decimal) {
      return '<input class="input" id="' + fieldId(key) + '" ' +
             'type="text" inputmode="decimal" autocomplete="off" ' +
             'placeholder="' + esc(o.placeholder || '—') + '" ' +
             'value="' + esc(num(value)) + '" data-p="' + key + '">';
    }
    return '<input class="input" id="' + fieldId(key) + '" ' +
           'type="number" inputmode="numeric" ' +
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
            /*
             * МЕЖІ ПОЛІВ — ЗВІДТИ Ж, ЗВІДКИ КЛАМП (TXT-008).
             *
             * Тут стояли свої числа (вік 14–90, зріст 120–230, вага
             * 35–250), а coerce нижче різав за FIELD_RANGE (10–100,
             * 120–250, 30–300), і те саме значення сторінка то не давала
             * ввести, то мовчки приймала при імпорті. Три набори меж на
             * одну величину — це не суворість, а розбіжність.
             */
            field('Вік, років', numberInput('age', p.age, { min: FIELD_RANGE.age[0], max: FIELD_RANGE.age[1], placeholder: '25' }), '', fieldId('age')) +
            field('Зріст, см', numberInput('height', p.height, { min: FIELD_RANGE.height[0], max: FIELD_RANGE.height[1], placeholder: '180' }), '', fieldId('height')) +
            field('Вага, кг', numberInput('weight', p.weight, { min: FIELD_RANGE.weight[0], max: FIELD_RANGE.weight[1], step: 0.1, decimal: true, placeholder: '80' }), '', fieldId('weight')) +
            field('Жир, %', numberInput('bodyfat', p.bodyfat, { min: FIELD_RANGE.bodyfat[0], max: FIELD_RANGE.bodyfat[1], step: 0.5, decimal: true }),
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
          'План тренувань редагується на сторінці <a href="plan.html">Мій план тренувань</a>.' +
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

  /* Чи число в межах поля. Значення поза межами НЕ клампиться мовчки
     («1,5» кг ставало 30 без жодного знаку) — воно не зберігається, а на
     виході з поля людина бачить підказку з межами. */
  function outOfRange(key, raw) {
    const r = FIELD_RANGE[key];
    if (!r) return false;
    const n = Number(String(raw == null ? '' : raw).trim().replace(',', '.'));
    return Number.isFinite(n) && (n < r[0] || n > r[1]);
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
    /*
     * Результат читаємо (LOC-003). saveProfileBeacon повертає, чи ліг патч
     * у localStorage; при переповненому сховищі — false, і тоді в
     * локальному режимі (черги й хмари немає) значення не потрапляє
     * НІКУДИ. Раніше слухачі visibilitychange і pagehide результат просто
     * ігнорували: людина йшла зі сторінки, вважаючи, що записано.
     *
     * Тост на pagehide уже не побачити, тому лишаємо слід у сховищі —
     * наступне відкриття акаунта скаже про це вголос.
     */
    const ok = Store.saveProfileBeacon(patch);
    if (!ok) {
      try { sessionStorage.setItem('ib.save.failed', '1'); } catch (_) {}
      toast('Сховище браузера переповнене — зміни не збережено', 'err');
    }
    return ok;
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
     * Перевірка вмісту переїхала в js/import-core.js: вона займала 800 із
     * 1036 рядків цієї функції й була недосяжна для юніт-тестів, бо жила
     * всередині обробника подій. Тут лишилось те, заради чого ця функція
     * існує, — звʼязок розмітки з діями.
     *
     * Перед записом — confirm: імпорт ПЕРЕЗАПИСУЄ поточні дані, і зробити
     * це випадково подвійним кліком не можна.
     */

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

      /*
       * Спершу міграції, потім перевірка (LOC-006). Файл річної давнини
       * має приїхати у формі поточної версії, інакше він відновиться
       * застарілим — і жодна наступна міграція його вже не полагодить,
       * бо профіль і так свіжої версії.
       */
      if (Store.migrateImported) {
        try { data = Store.migrateImported(data); }
        catch (err) { console.warn('[account] міграція імпорту не вдалась:', err && err.message); }
      }

      const res = window.ImportCore.validate(data);
      const known = res.taken.length;

      if (!known && !res.rejected.length) {
        toast('У файлі немає жодного поля профілю Get Stronger', 'err');
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
      /*
       * СТЕЛЯ РАХУЄТЬСЯ ВІД КВОТИ СХОВИЩА, А НЕ ЗІ СТЕЛІ (PRF-005).
       *
       * Коментар «1 МБ — вище стелі реального профілю за роки» був
       * неправдою: власний експорт відмовляється імпортуватись приблизно з
       * 400 сесій реального плану, а валідатор при цьому дозволяє 4000 дат
       * трекерів (тобто 4–8 МБ). Дві стелі не були узгоджені між собою, і
       * людина отримувала «файл завеликий» на файл, який сама ж і зробила.
       *
       * Реальна межа — квота localStorage (близько 5 М символів у всіх
       * браузерах, де це взагалі перевіряється) мінус місце під резервну
       * копію перед імпортом і під чергу. Половина квоти — чесний ліміт:
       * профіль плюс його доімпортна копія мусять уміститись разом.
       */
      const MAX_PATCH_BYTES = 2 * 1024 * 1024;
      let patchBytes = 0;
      try {
        patchBytes = new Blob([JSON.stringify(res.patch)]).size;
      } catch (_) {
        patchBytes = JSON.stringify(res.patch).length * 2;   // груба оцінка UTF-16
      }
      if (patchBytes > MAX_PATCH_BYTES) {
        toast('Файл завеликий: ' + Math.round(patchBytes / 1024) + ' КБ при межі ' +
              Math.round(MAX_PATCH_BYTES / 1024) + ' КБ. Нічого не змінено. ' +
              'Сховище браузера має вмістити і профіль, і доімпортну копію.', 'err');
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
            /* Порада «видаліть акаунт у Supabase» відсилала людину туди,
               куди вона не має доступу: панель проєкту бачить лише
               власник (OPS-009). Кнопка для цього є тут-таки, нижче. */
            'копію, а потім натисніть «Видалити акаунт» нижче.'
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
        if (outOfRange(el.dataset.p, el.value)) {
          if (evt === 'change') {
            const r = FIELD_RANGE[el.dataset.p];
            toast('Допустимо від ' + r[0] + ' до ' + r[1] + ' — значення не збережено', 'err');
          }
          return;
        }
        const v = coerce(el.dataset.p, el.value);
        /* Текстові дробові поля (вага, жир) пропускають будь-які символи:
           «abc» не має стирати збережене число (порожня вага = крок
           онбордингу «тіло» для сторожа). Порожнє поле — свідоме очищення. */
        if (v === null && String(el.value).trim() !== '') return;
        queueSave(el.dataset.p, v);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Інтерфейс: що людина хоче бачити                                     */
  /* ------------------------------------------------------------------ */
  /*
   * ЧОМУ ВИМИКАЧ ДОВІДКИ ЖИВЕ ТУТ, А НЕ В САМІЙ ДОВІДЦІ.
   *
   * Кнопка книжки стоїть на КОЖНІЙ сторінці. Перші тижні вона рятує, а
   * через пів року це просто значок у кутку кожного екрана — і прибрати
   * його не було як. Вимикач у самому вікні довідки був би пасткою:
   * вимкнувши кнопку, людина втратила б і спосіб її повернути.
   *
   * Прапорець лежить у профілі (а не лише в браузері), бо це побажання
   * людини, а не налаштування пристрою: вимкнув на телефоні — вимкнено й
   * на компʼютері.
   */
  async function renderUiPrefs() {
    const host = $('#ui-prefs');
    if (!host) return;

    let p = {};
    try { p = (await Store.getProfile()) || {}; } catch (_) {}
    const on = p.hideHelp !== true;

    host.innerHTML =
      '<div class="card">' +
        '<h3 class="card__title">Довідка</h3>' +
        '<p class="small muted mt-1">Значок розгорнутої книжки у правому верхньому ' +
          'куті кожної сторінки. Відкриває пояснення саме про той екран, де ви ' +
          'стоїте, пошук по всій довідці й загальну інструкцію до сайту.</p>' +
        '<label class="check mt-2">' +
          '<input type="checkbox" id="a-help-btn"' + (on ? ' checked' : '') + '>' +
          '<span>Показувати значок довідки на сторінках</span>' +
        '</label>' +
        '<p class="small muted mt-2 mb-0">Вимкнена кнопка нічого не видаляє: ' +
          'довідка лишається на місці, її можна повернути тут будь-коли.</p>' +
      '</div>';

    const box = $('#a-help-btn', host);
    if (!box) return;
    box.addEventListener('change', function () {
      const hide = !box.checked;
      Store.saveProfile({ hideHelp: hide })
        .catch(function (e) { if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err'); });
      /* Кнопка має зникнути й зʼявитись одразу, без перезавантаження. */
      try { if (window.Help && window.Help.sync) window.Help.sync(hide); } catch (_) {}
      toast(hide ? 'Значок довідки прибрано' : 'Значок довідки повернуто', 'ok');
    });
  }

  /* ------------------------------------------------------------------ */

  async function renderAll() {
    renderMode();
    renderAuth();
    renderUiPrefs();

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

    /* Слід від невдалого запису при виході зі сторінки (LOC-003): тост на
       pagehide людина побачити не могла, тому кажемо це тут. */
    try {
      if (sessionStorage.getItem('ib.save.failed') === '1') {
        sessionStorage.removeItem('ib.save.failed');
        toast('Минулого разу зміни не збереглися: сховище браузера переповнене. ' +
              'Звільніть місце — наприклад, зробіть експорт і видаліть старі дані.', 'err');
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
