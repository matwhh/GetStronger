/**
 * Перші екрани Forge: вік (17+) і базові дані тіла.
 *
 * Це ПЕРШІ КРОКИ онбордингу, а не окрема система. Усе лягає в той самий
 * профіль (Store), яким живе застосунок; власного сховища й прапорця
 * «пройдено» тут немає — крок щоразу виводиться з даних профілю
 * (js/onboarding-core.js), а пильнує за цим сторож (js/agegate.js).
 *
 * Після тіла людина йде на programs.html — обрати програму й вписати
 * робочу вагу. Це вже наявні сторінки: онбординг не будує їм двійників.
 *
 * Заразом заповнюємо profile.age — числове поле, яке читають розрахунки
 * харчування й пульсу. Це не друге джерело правди, а похідне: дата
 * народження керує, age рахується з неї.
 */
(function () {
  'use strict';

  const { $, esc } = window.App;
  const AC = window.AgeCore;
  const OC = window.OnboardingCore;
  const HOME = 'index.html';
  const NEXT = 'programs.html';

  const TRAINING_AGE = [
    { v: 'novice', label: 'До 1 року' },
    { v: 'inter',  label: '1–2 роки' },
    { v: 'adv',    label: '3–5 років' },
    { v: 'elite',  label: 'Понад 5 років' }
  ];

  /*
   * Дата народження зберігається ТРЬОМА частинами, а не одним рядком.
   *
   * Було <input type="date"> — і воно відкривало рідний календар, у якому
   * доводиться гортати роки назад від сьогоднішнього. Для дати народження
   * це найгірший можливий спосіб вводу: людина знає свою дату напамʼять і
   * хоче просто набрати цифри.
   *
   * state.birth лишається головним ('YYYY-MM-DD') — його читають перевірки
   * й запис у профіль. Частини — це лише те, що набрано в полях, і birth
   * складається з них, коли всі три заповнені.
   */
  const state = {
    /* step: start | login | reg | confirm | name | age | body |
             pending | rejected | blocked */
    step: 'start',
    dob: { d: '', m: '', y: '' },
    birth: '',
    body: { sex: null, weight: '', height: '', activity: '', trainingAge: '', hrRest: '', hrMax: '' },
    acc: { username: '', email: '', pass: '', pass2: '' },
    consents: {},   // c-terms / c-privacy / c-medical
    err: '',
    busy: false
  };

  const CLOUD = Boolean(window.Store && window.Store.isCloud);

  /* Лічильник кроків реєстрації: акаунт → вік → тіло. У локальному
     режимі акаунта немає, тож і лічильник коротший. */
  function stepBadge(n) {
    const total = CLOUD ? 3 : 2;
    const i = CLOUD ? n : n - 1;
    return '<p class="small muted" style="margin:0 0 10px">Крок ' + i + ' із ' + total + '</p>';
  }

  /* ------------------------------------------------------------------ */
  /* Крок 1: вік                                                         */
  /* ------------------------------------------------------------------ */

  function messageFor(g) {
    if (g.state === 'invalid') {
      return '<p class="gate__msg gate__msg--err" role="alert">' +
        'Перевірте дату: вона має бути справжньою й не з майбутнього.</p>';
    }
    if (g.state === 'minor') {
      /*
       * Текст під забороною — не докір, а пояснення. Він має відповісти на
       * питання «чому», інакше єдиний висновок, який робить людина, — що
       * треба вписати іншу дату.
       */
      return '' +
        '<div class="gate__msg gate__msg--block" role="alert">' +
          '<p class="gate__msg-title">Forge доступний лише користувачам віком від 17 років.</p>' +
          '<p class="small mb-0">Платформа та її тренувальні програми розроблені для ' +
            'користувачів віком 17 років і старше.</p>' +
        '</div>';
    }
    return '';
  }

  /** Частини → 'YYYY-MM-DD'. Поки заповнені не всі три — порожньо. */
  function dobToBirth(dob) {
    if (dob.y.length !== 4 || !dob.m || !dob.d) return '';
    return dob.y + '-' + dob.m.padStart(2, '0') + '-' + dob.d.padStart(2, '0');
  }

  /** 'YYYY-MM-DD' → частини (для профілю, який уже має дату). */
  function birthToDob(birth) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birth || ''));
    return m ? { d: m[3], m: m[2], y: m[1] } : { d: '', m: '', y: '' };
  }

  const DOB_PARTS = [
    { k: 'd', len: 2, ph: 'ДД',   label: 'День' },
    { k: 'm', len: 2, ph: 'ММ',   label: 'Місяць' },
    { k: 'y', len: 4, ph: 'РРРР', label: 'Рік' }
  ];

  function renderAge(host) {
    host.innerHTML = '' +
      stepBadge(2) +
      '<h1 class="gate__title">Вкажіть вашу дату народження</h1>' +

      '<div class="field mt-2" style="text-align:center">' +
        '<span class="field__label" id="dob-label">Дата народження</span>' +
        /*
         * Три числові поля замість календаря. inputmode="numeric" піднімає
         * на телефоні цифрову клавіатуру, autocomplete розбитий по частинах —
         * браузер уміє підставити збережену дату народження й сюди.
         */
        '<div class="dob" role="group" aria-labelledby="dob-label">' +
          DOB_PARTS.map(function (p, i) {
            return (i ? '<span class="dob__sep" aria-hidden="true">.</span>' : '') +
              '<input class="input dob__part dob__part--' + p.k + '" id="dob-' + p.k + '" ' +
                'type="text" inputmode="numeric" pattern="[0-9]*" ' +
                'maxlength="' + p.len + '" placeholder="' + p.ph + '" ' +
                'autocomplete="bday-' + (p.k === 'y' ? 'year' : p.k === 'm' ? 'month' : 'day') + '" ' +
                'aria-label="' + p.label + '" data-dob="' + p.k + '" ' +
                'value="' + esc(state.dob[p.k]) + '">';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div id="gate-msg"></div>' +

      '<button class="btn btn--primary btn--wide mt-2" type="button" id="gate-go">Продовжити</button>' +

      '<p class="small muted gate__note" id="gate-note"></p>';

    refreshAge();
  }

  /**
   * Оновити тільки те, що залежить від набраної дати.
   *
   * Саме тому це окремо від renderAge: перемальовка всього кроку на кожній
   * цифрі забирала б фокус із поля, і на телефоні клавіатура закривалась би
   * після кожного натискання. Поля лишаються на місці — міняються лише
   * повідомлення, підпис і активність кнопки.
   */
  function refreshAge() {
    state.birth = dobToBirth(state.dob);
    const g = AC.gateState(state.birth);
    const canGo = g.state === 'adult';

    const msg = $('#gate-msg');
    if (msg) msg.innerHTML = messageFor(g);

    const go = $('#gate-go');
    if (go) go.disabled = !canGo;

    const note = $('#gate-note');
    if (note) {
      note.textContent = canGo
        ? 'Вік: ' + g.age + ' ' + window.App.plural(g.age, 'рік', 'роки', 'років') + '.'
        : '';
    }
  }

  async function proceedAge() {
    if (state.busy) return;
    /*
     * Перевіряємо ще раз перед записом, а не покладаємось на disabled:
     * атрибут кнопки — це підказка інтерфейсу, і зняти його в консолі
     * може будь-хто. Рішення ухвалює умова, а не вигляд кнопки.
     */
    if (!AC.isAdult(state.birth)) { render(); return; }

    state.busy = true;
    const age = AC.ageOn(state.birth);
    try {
      await window.Store.saveProfile({ birthDate: state.birth, age: age });
    } catch (e) {
      /* Черга офлайн-збережень уже прийняла патч — далі можна йти. */
      if (!(e && e.queued)) {
        state.busy = false;
        window.App.toast('Не збереглося: ' + (e && e.message), 'err');
        return;
      }
    }
    /* Без навігації: наступний крок живе на цьому ж екрані. */
    state.busy = false;
    state.step = 'body';
    render();
    const first = $('#b-height');
    if (first) first.focus();
  }

  /* ------------------------------------------------------------------ */
  /* Крок 2: тіло                                                        */
  /* ------------------------------------------------------------------ */

  function draftProfile() {
    const b = state.body;
    const num = function (v) { return v === '' ? null : Number(v); };
    return {
      sex: b.sex,
      weight: num(b.weight),
      height: num(b.height),
      activity: num(b.activity),
      trainingAge: b.trainingAge || null
    };
  }

  /* Обидва пульси — необовʼязкові: порожнє поле легальне, але вписане
     значення мусить бути справжнім пульсом, інакше воно мовчки не
     збереглося б і людина думала б, що ввела. */
  function hrOk(v, lo, hi) {
    if (v === '') return true;
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi;
  }

  function bodyReady() {
    return OC.hasBody(draftProfile()) &&
      hrOk(state.body.hrRest, 30, 120) &&
      hrOk(state.body.hrMax, 120, 230);
  }

  function numField(id, key, label, hint, opts) {
    return '<div class="field mt-2">' +
      '<label class="field__label" for="' + id + '">' + label + '</label>' +
      '<input class="input" id="' + id + '" data-b="' + key + '" type="number" ' +
        'inputmode="decimal" min="' + opts.min + '" max="' + opts.max + '" ' +
        'step="' + (opts.step || 1) + '"' +
        (opts.ph ? ' placeholder="' + opts.ph + '"' : '') +
        ' value="' + esc(String(state.body[key])) + '">' +
      (hint ? '<p class="small muted" style="margin:6px 0 0">' + hint + '</p>' : '') +
    '</div>';
  }

  function renderBody(host) {
    const NC = window.NutritionCalc;
    const acts = Object.keys(NC.ACTIVITY);
    const canGo = bodyReady();

    const sexBtn = function (v, label) {
      return '<label class="seg__item">' +
        '<input type="radio" name="b-sex" value="' + v + '"' +
          (state.body.sex === v ? ' checked' : '') + '>' +
        '<span>' + label + '</span>' +
      '</label>';
    };

    host.innerHTML = '' +
      stepBadge(3) +
      '<h1 class="gate__title">Розкажіть про себе</h1>' +
      '<p class="small muted gate__lead">З цього рахуються калорії, білок і пульсові зони. ' +
        'Дані зберігаються лише на цьому пристрої.</p>' +

      '<div class="field mt-2">' +
        '<span class="field__label" id="b-sex-l">Стать</span>' +
        /* Біологічна стать для формули BMR (Mifflin–St Jeor), не ідентичність. */
        '<div class="seg" role="radiogroup" aria-labelledby="b-sex-l" style="margin-top:6px">' +
          sexBtn('male', 'Чоловік') + sexBtn('female', 'Жінка') +
        '</div>' +
      '</div>' +

      numField('b-height', 'height', 'Зріст, см', '', { min: 120, max: 250, ph: '0' }) +
      numField('b-weight', 'weight', 'Вага тіла, кг', '', { min: 30, max: 300, step: 0.1, ph: '0' }) +

      /* BMI рахується сам, щойно є зріст і вага — без окремої кнопки.
         Це скринінговий показник, і підпис каже це прямо. */
      '<div id="b-bmi" class="small" style="margin-top:6px"></div>' +

      '<div class="field mt-2">' +
        '<label class="field__label" for="b-activity">Рівень активності</label>' +
        '<select class="select" id="b-activity" data-b="activity">' +
          '<option value="">—</option>' +
          acts.map(function (k) {
            return '<option value="' + k + '"' +
              (String(state.body.activity) === String(k) ? ' selected' : '') + '>' +
              esc(NC.ACTIVITY[k].label) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      '<div class="field mt-2">' +
        '<label class="field__label" for="b-trainage">Стаж тренувань</label>' +
        '<select class="select" id="b-trainage" data-b="trainingAge">' +
          '<option value="">—</option>' +
          TRAINING_AGE.map(function (o) {
            return '<option value="' + o.v + '"' +
              (state.body.trainingAge === o.v ? ' selected' : '') + '>' + o.label + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +

      numField('b-hrrest', 'hrRest', 'Пульс спокою', '', { min: 30, max: 120, ph: 'Необовʼязково' }) +
      numField('b-hrmax', 'hrMax', 'Максимальний пульс', '', { min: 120, max: 230, ph: 'Необовʼязково' }) +

      consentBlock() +

      '<button class="btn btn--primary btn--wide mt-2" type="button" id="body-go"' +
        (canGo ? '' : ' disabled') + '>Далі — обрати програму</button>' +

      '<p class="small muted gate__note" id="body-note">' +
        (canGo ? 'Крок 2 з 3. Далі: програма тренувань і робоча вага.' : '') +
      '</p>';
  }

  /* Точкове оновлення замість повного render(): перемальовка на кожну
     цифру вибивала б фокус із поля, у яке людина зараз вписує. */
  /*
   * Згоди перед поданням заявки. Три ОКРЕМІ чекбокси, жоден не
   * відмічений заздалегідь; документи відкриваються в новій вкладці.
   * Показуються лише в хмарному режимі з акаунтом — тобто рівно там,
   * де заявка реально подається і згоди лягають у серверний журнал.
   */
  function consentBlock() {
    if (!CLOUD || !window.Store.user()) return '';
    const box = function (id, html) {
      return '<label class="check" style="align-items:flex-start;margin-top:10px">' +
        '<input type="checkbox" id="' + id + '"' + (state.consents[id] ? ' checked' : '') + '>' +
        '<span class="small">' + html + '</span>' +
      '</label>';
    };
    return '<div class="mt-2" id="b-consents" style="border-top:1px solid var(--line);padding-top:14px">' +
      box('c-terms', 'Я прочитав(ла) та погоджуюсь із ' +
        '<a href="legal.html#terms" target="_blank" rel="noopener">Умовами використання</a> Forge.') +
      box('c-privacy', 'Я прочитав(ла) ' +
        '<a href="legal.html#privacy" target="_blank" rel="noopener">Політику конфіденційності</a>.') +
      box('c-medical', 'Я розумію, що Forge не є медичним сервісом, а інформація на платформі ' +
        'не замінює консультацію лікаря (<a href="legal.html#medical" target="_blank" rel="noopener">медичне застереження</a>).') +
    '</div>';
  }

  function consentsOk() {
    if (!CLOUD || !window.Store.user()) return true;
    return Boolean(state.consents['c-terms'] && state.consents['c-privacy'] && state.consents['c-medical']);
  }

  /** BMI-рядок під полями: живе оновлення, без кнопки Calculate. */
  function syncBmi() {
    const el = $('#b-bmi');
    const BC = window.BmiCore;
    if (!el || !BC) return;
    const b = BC.bmi(state.body.weight, state.body.height);
    if (b === null) { el.innerHTML = ''; return; }
    const cat = BC.category(b);
    el.innerHTML = 'BMI: <b class="mono">' + String(b).replace('.', ',') + '</b> — ' +
      BC.CAT_LABEL[cat] +
      '<span class="muted"> · скринінговий показник, не діагноз</span>';
  }

  function syncBodyControls() {
    syncBmi();
    const go = $('#body-go');
    const note = $('#body-note');
    const canGo = bodyReady() && consentsOk();
    if (go) go.disabled = !canGo;
    if (note) {
      note.textContent = canGo
        ? 'Крок 2 з 3. Далі: програма тренувань і робоча вага.'
        : '';
    }
  }

  /**
   * Попередження BMI поза нормою — ОДИН раз на категорію.
   * Підтвердження лягає в профіль (bmiAck): при наступних збереженнях
   * тієї самої категорії модалка не зʼявляється — без спаму попапами.
   * Повертає true, коли можна продовжувати (підтверджено або не треба).
   */
  function bmiWarnModal() {
    const BC = window.BmiCore;
    if (!BC) return Promise.resolve(true);
    const b = BC.bmi(state.body.weight, state.body.height);
    const ack = (window.Store.localProfile() || {}).bmiAck;
    if (!BC.shouldWarn(b, ack)) return Promise.resolve(true);

    return new Promise(function (resolve) {
      BC.showWarnModal(b, function () {
        window.Store.saveProfile({ bmiAck: BC.ackFor(b) }).catch(function () {});
        resolve(true);
      });
    });
  }

  async function proceedBody() {
    if (state.busy) return;
    if (!bodyReady() || !consentsOk()) { syncBodyControls(); return; }
    /*
     * busy ставиться ДО очікування модалки BMI, а не після. Було навпаки,
     * і поки людина читала попередження, кнопка лишалась активною — два
     * натискання давали дві заявки.
     */
    state.busy = true;
    await bmiWarnModal();

    const b = state.body;
    const patch = {
      sex: b.sex,
      weight: Number(b.weight),
      height: Number(b.height),
      activity: Number(b.activity),
      trainingAge: b.trainingAge
    };
    /* Пульси — опційні: пишемо лише вписані валідні значення. */
    const hrR = Number(b.hrRest), hrM = Number(b.hrMax);
    if (b.hrRest !== '' && hrR >= 30 && hrR <= 120) patch.hrRest = hrR;
    if (b.hrMax !== '' && hrM >= 120 && hrM <= 230) patch.hrMax = hrM;

    try {
      await window.Store.saveProfile(patch);
    } catch (e) {
      if (!(e && e.queued)) {
        state.busy = false;
        window.App.toast('Не збереглося: ' + (e && e.message), 'err');
        return;
      }
    }

    /* Локальний режим: акаунтів немає — далі одразу вибір програми. */
    if (!CLOUD || !window.Store.user()) {
      location.replace(NEXT);
      return;
    }

    /*
     * Хмарний режим: скринінг завершено — подаємо ЗАЯВКУ. Сервер ще раз
     * перевіряє вік (underage не пройде і прямим викликом API) та
     * унікальність ніка, і ставить статус pending. Доступу до Forge це
     * ще не дає — RLS відкриється лише після ручного підтвердження.
     */
    const uname = (window.Store.localProfile() || {}).displayName || state.acc.username || '';
    const scr = Object.assign({}, patch);
    try {
      const LV = window.LEGAL_VERSIONS || {};
      await window.Store.rpc('register_request', {
        p_username: uname, p_birth: state.birth, p_screening: scr,
        p_consents: [
          { document: 'terms_of_use',       version: LV.terms_of_use || '1.0' },
          { document: 'privacy_policy',     version: LV.privacy_policy || '1.0' },
          { document: 'medical_disclaimer', version: LV.medical_disclaimer || '1.0' }
        ]
      });
      await window.Store.refreshAccountState();
      state.busy = false;
      nav('pending');
    } catch (e) {
      state.busy = false;
      const msg = String((e && e.message) || '');
      if (msg.indexOf('UNDERAGE') !== -1) {
        state.err = 'Forge доступний із 17 років.';
        nav('age');
      } else if (msg.indexOf('USERNAME_TAKEN') !== -1 || msg.indexOf('USERNAME_INVALID') !== -1) {
        state.err = 'Нік зайнятий або некоректний — оберіть інший.';
        nav('name');
      } else if (msg.indexOf('BLOCKED') !== -1) {
        nav('blocked');
      } else {
        window.App.toast('Не вдалося подати заявку: ' + msg, 'err');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Дії автентифікації                                                  */
  /* ------------------------------------------------------------------ */

  /** Після входу/реєстрації: розвести за статусом акаунта. */
  async function routeAfterAuth() {
    const st = (await window.Store.refreshAccountState()) ||
               window.Store.accountCached() || { status: 'none' };
    const status = st.status || 'none';

    if (status === 'pending')  { nav('pending');  return; }
    if (status === 'rejected') { nav('rejected'); return; }
    if (status === 'blocked')  { nav('blocked');  return; }

    if (status === 'approved') {
      /*
       * Підтверджений акаунт. Якщо хмарний профіль ще порожній, а скринінг
       * реєстрації лежить локально — доливаємо його (тепер RLS пускає).
       */
      let p = {};
      try { p = await window.Store.getProfile() || {}; } catch (_) {}
      const localSnap = window.Store.localProfile() || {};
      if (!p.birthDate && localSnap.birthDate) {
        const KEYS = ['birthDate', 'age', 'sex', 'weight', 'height', 'activity',
                      'trainingAge', 'hrRest', 'hrMax', 'displayName'];
        const fill = {};
        KEYS.forEach(function (k) { if (localSnap[k] != null) fill[k] = localSnap[k]; });
        try { p = await window.Store.saveProfile(fill); } catch (_) {}
      }
      const step = OC.stepFor(p);
      if (step === 'done') { location.replace(HOME); return; }
      if (step === 'program') { location.replace(NEXT); return; }
      seedFromProfile(p);
      nav(step);   // 'age' | 'body' — дозаповнити скринінг
      return;
    }

    /* 'none': акаунт є, заявки ще немає — продовжити реєстрацію з того
       кроку, до якого дійшли (дані живуть локально). */
    const localSnap = window.Store.localProfile() || {};
    seedFromProfile(localSnap);
    if (!((localSnap.displayName || state.acc.username || '').trim())) { nav('name'); return; }
    if (!localSnap.birthDate || !AC.isAdult(localSnap.birthDate)) { nav('age'); return; }
    nav('body');
  }

  function validAccount() {
    const a = state.acc;
    if (a.username.trim().length < 3 || a.username.trim().length > 24) return 'Нік — від 3 до 24 символів.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())) return 'Перевірте адресу пошти.';

    /* Надійність пароля — окреме ядро (js/password-core.js), тут лише
       його вердикт. Мінімальна довжина продубльована на сервері
       (Supabase Auth), щоб правило не трималось на самому браузері. */
    const PC = window.PasswordCore;
    if (PC) {
      const v = PC.check(a.pass, { email: a.email, username: a.username });
      if (!v.ok) return v.problem;
    } else if (a.pass.length < 8) {
      return 'Пароль — щонайменше 8 символів.';
    }

    if (a.pass !== a.pass2) return 'Паролі не збігаються.';
    return '';
  }

  /** Живий індикатор надійності під полем пароля. */
  function syncPwMeter() {
    const box = $('#au-pw-meter');
    const PC = window.PasswordCore;
    if (!box || !PC) return;
    const pass = state.acc.pass || '';
    if (!pass) { box.hidden = true; return; }
    const v = PC.check(pass, { email: state.acc.email, username: state.acc.username });
    box.hidden = false;
    box.dataset.score = String(v.score);
    const fill = box.querySelector('.pwm__bar i');
    if (fill) fill.style.width = (v.score / 3 * 100) + '%';
    const txt = box.querySelector('.pwm__txt');
    if (txt) txt.textContent = v.ok ? v.label : v.problem;
  }

  function readAccFields() {
    const g = function (id) { const el = $('#' + id); return el ? el.value : ''; };
    if ($('#au-name'))  state.acc.username = g('au-name');
    if ($('#au-email')) state.acc.email = g('au-email');
    if ($('#au-pass'))  state.acc.pass = g('au-pass');
    if ($('#au-pass2')) state.acc.pass2 = g('au-pass2');
  }

  async function doLogin() {
    if (state.busy) return;
    readAccFields();
    if (!CLOUD) { state.err = 'Сайт у локальному режимі — вхід вимкнено.'; render(); return; }
    if (!state.acc.email || state.acc.pass.length < 8) {
      state.err = 'Заповніть пошту й пароль (від 8 символів).'; render(); return;
    }
    state.busy = true; state.err = ''; render();
    try {
      await window.Store.signIn(state.acc.email.trim(), state.acc.pass);
      state.busy = false;
      await routeAfterAuth();
    } catch (e) {
      state.busy = false;
      state.err = 'Не вдалося увійти: ' + ((e && e.message) || 'помилка');
      render();
    }
  }

  async function doRegister() {
    if (state.busy) return;
    readAccFields();
    if (!CLOUD) { nav('age'); return; }   // локальний режим — одразу скринінг
    const v = validAccount();
    if (v) { state.err = v; render(); return; }

    state.busy = true; state.err = ''; render();
    try {
      const res = await window.Store.signUp(state.acc.email.trim(), state.acc.pass);
      // Нік — у профіль (локально до підтвердження) і в заявку далі
      try { await window.Store.saveProfile({ displayName: state.acc.username.trim() }); } catch (_) {}

      if (res && res.exists) {
        /*
         * Пошта вже зареєстрована. Сервер каже це не помилкою, а мовчазним
         * 200 з порожнім identities (див. Store.signUp) — і без цієї гілки
         * людина йшла на екран «Підтвердіть пошту», де застрягала назавжди:
         * листа немає, а пароль в акаунті лишився старий.
         */
        state.busy = false;
        navMsg('login', 'Ця пошта вже зареєстрована. Увійдіть — або відновіть пароль, якщо не памʼятаєте.');
        return;
      }
      if (!res || res.confirmed === false) {
        // Увімкнене підтвердження пошти: сесії ще немає
        state.busy = false;
        nav('confirm');
        return;
      }
      state.busy = false;
      await afterSignupChecks();
    } catch (e) {
      state.busy = false;
      const msg = String((e && e.message) || '');
      if (/already|зареєстр|registered/i.test(msg)) {
        // Продовження незавершеної реєстрації: акаунт уже є — входимо
        try {
          await window.Store.signIn(state.acc.email.trim(), state.acc.pass);
          try { await window.Store.saveProfile({ displayName: state.acc.username.trim() }); } catch (_) {}
          await routeAfterAuth();
          return;
        } catch (e2) {
          state.err = 'Ця пошта вже зареєстрована, але пароль не підійшов.';
          render(); return;
        }
      }
      state.err = 'Не вдалося створити акаунт: ' + msg;
      render();
    }
  }

  /** Після появи сесії: перевірити нік і рушити в скринінг. */
  async function afterSignupChecks() {
    try {
      const free = await window.Store.rpc('username_free', { p_username: state.acc.username.trim() });
      if (free === false) { state.err = 'Цей нік уже зайнятий — оберіть інший.'; nav('name'); return; }
    } catch (_) { /* перевірить register_request */ }
    nav('age');
  }

  /** Лист для відновлення пароля. */
  async function doForgot() {
    if (state.busy) return;
    readAccFields();
    const mail = (state.acc.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      state.err = 'Перевірте адресу пошти.'; render(); return;
    }
    state.busy = true; state.err = ''; render();
    try {
      await window.Store.requestPasswordReset(mail);
      state.busy = false;
      /* Навмисно НЕ кажемо, чи є така пошта в базі: інакше форму можна
         використати як перевірку «чи зареєстрований цей чоловік». */
      navMsg('login', 'Якщо акаунт із такою поштою існує — лист уже в дорозі. ' +
             'Перевірте теку «Спам».');
    } catch (e) {
      state.busy = false;
      state.err = (e && e.message) || 'Не вдалося надіслати лист.';
      render();
    }
  }

  /** Зберегти новий пароль після переходу з листа відновлення. */
  async function doNewPass() {
    if (state.busy) return;
    readAccFields();
    const PC = window.PasswordCore;
    if (PC) {
      const v = PC.check(state.acc.pass, { email: state.acc.email, username: state.acc.username });
      if (!v.ok) { state.err = v.problem; render(); return; }
    } else if ((state.acc.pass || '').length < 8) {
      state.err = 'Пароль — щонайменше 8 символів.'; render(); return;
    }
    if (state.acc.pass !== state.acc.pass2) { state.err = 'Паролі не збігаються.'; render(); return; }

    state.busy = true; state.err = ''; render();
    try {
      await window.Store.updatePassword(state.acc.pass);
      state.busy = false;
      window.App.toast('Пароль змінено', 'ok');
      await routeAfterAuth();
    } catch (e) {
      state.busy = false;
      state.err = (e && e.message) || 'Не вдалося зберегти пароль.';
      render();
    }
  }

  /** Повторний лист підтвердження. */
  async function doResend() {
    if (state.busy) return;
    state.busy = true; state.err = ''; render();
    try {
      await window.Store.resendConfirmation(state.acc.email.trim());
      state.busy = false;
      window.App.toast('Лист надіслано ще раз', 'ok');
      render();
    } catch (e) {
      state.busy = false;
      /* Ліміт листів — найчастіша причина, і вона не про людину: у
         вбудованої пошти Supabase він низький. Текст уже перекладений
         у Store (AUTH_MSG), тут лишається його показати. */
      state.err = (e && e.message) || 'Не вдалося надіслати лист.';
      render();
    }
  }

  async function doConfirmed() {
    if (state.busy) return;
    state.busy = true; state.err = ''; render();
    try {
      await window.Store.signIn(state.acc.email.trim(), state.acc.pass);
      state.busy = false;
      await afterSignupChecks();
    } catch (e) {
      state.busy = false;
      /*
       * Дві РІЗНІ причини, і плутати їх не можна — саме на цьому люди
       * і застрягали. email_not_confirmed означає «клікніть у листі»;
       * invalid_credentials — що акаунт існує з ІНШИМ паролем (реєстрація
       * на вже зайняту пошту старий пароль не міняє), і чекати листа
       * марно: треба входити старим паролем або відновлювати його.
       */
      const code = (e && e.code) || '';
      if (code === 'invalid_credentials') {
        navMsg('login', 'Акаунт із цією поштою вже існує, але з іншим паролем. ' +
               'Увійдіть тим паролем, який ставили спершу, або відновіть його.');
      } else if (code === 'email_not_confirmed') {
        state.err = 'Пошту ще не підтверджено. Відкрийте лист і натисніть посилання в ньому.';
        render();
      } else {
        state.err = (e && e.message) || 'Не вдалося продовжити. Спробуйте ще раз.';
        render();
      }
    }
  }

  async function doNameGo() {
    readAccFields();
    const n = state.acc.username.trim();
    if (n.length < 3 || n.length > 24) { state.err = 'Нік — від 3 до 24 символів.'; render(); return; }
    try { await window.Store.saveProfile({ displayName: n }); } catch (_) {}
    try {
      const free = await window.Store.rpc('username_free', { p_username: n });
      if (free === false) { state.err = 'Цей нік теж зайнятий.'; render(); return; }
    } catch (_) {}
    const localSnap = window.Store.localProfile() || {};
    if (localSnap.birthDate && AC.isAdult(localSnap.birthDate) &&
        localSnap.sex && localSnap.weight) {
      // скринінг уже пройдено — одразу подаємо заявку повторно
      nav('body');
    } else {
      nav('age');
    }
  }

  async function doSignOut() {
    try { await window.Store.signOut(); } catch (_) {}
    state.acc = { username: '', email: '', pass: '', pass2: '' };
    nav('start');
  }

  async function doRecheck() {
    if (state.busy) return;
    state.busy = true; render();
    const st = await window.Store.refreshAccountState();
    state.busy = false;
    if (st && st.status === 'approved') { await routeAfterAuth(); return; }
    if (st && st.status === 'rejected') { nav('rejected'); return; }
    if (st && st.status === 'blocked')  { nav('blocked');  return; }
    window.App.toast('Поки що очікує підтвердження', 'ok');
    render();
  }

  /** Часткове заповнення стану з профілю (продовження після перерви). */
  function seedFromProfile(p) {
    if (!p) return;
    if (typeof p.birthDate === 'string') {
      state.birth = p.birthDate;
      state.dob = birthToDob(p.birthDate);
    }
    ['sex', 'trainingAge'].forEach(function (k) { if (p[k]) state.body[k] = p[k]; });
    ['weight', 'height', 'activity', 'hrRest', 'hrMax'].forEach(function (k) {
      if (p[k] !== null && p[k] !== undefined) state.body[k] = String(p[k]);
    });
    if (p.displayName && !state.acc.username) state.acc.username = p.displayName;
  }

  /* ------------------------------------------------------------------ */
  /* Автентифікація і статус заявки                                      */
  /* ------------------------------------------------------------------ */
  /*
   * Стартовий екран — чистий вибір «Увійти / Зареєструватися». Питань
   * скринінгу тут немає: вони починаються лише всередині реєстрації.
   * Уся серверна частина — наявні Store.signIn/signUp (Supabase GoTrue)
   * плюс RPC register_request / account_state; жодної фейкової
   * автентифікації.
   */

  function errLine() {
    return state.err
      ? '<p class="small" style="color:var(--warn, #d66);margin:10px 0 0">' + esc(state.err) + '</p>'
      : '';
  }

  function renderStart(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title" style="text-align:center">Forge</h1>' +
      '<p class="small muted" style="text-align:center;margin:6px 0 0">' +
        'Тренування, харчування і прогрес — за вашим планом.' +
      '</p>' +
      '<div class="grid mt-3" style="gap:12px;max-width:320px;margin-left:auto;margin-right:auto">' +
        '<button class="btn btn--primary" type="button" data-nav="login">Увійти</button>' +
        '<button class="btn btn--ghost" type="button" data-nav="' + (CLOUD ? 'reg' : 'age') + '">Зареєструватися</button>' +
      '</div>' +
      (!CLOUD
        ? '<p class="small muted mt-2" style="text-align:center">Сайт у локальному режимі: акаунти вимкнені, ' +
          'реєстрація збереже дані лише в цьому браузері.</p>'
        : '') +
      /* Стартовий екран теж має вміти пояснити, чому нас сюди викинуло:
         сюди потрапляє людина з протухлим посиланням із листа, і без
         цього рядка вона бачила б просто головний екран без причини. */
      errLine() +
      '<p class="small muted mt-3" style="text-align:center">' +
        '<a href="legal.html">Правові документи</a> · від 17 років' +
      '</p>';
  }

  function renderLogin(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Вхід</h1>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-email">Пошта</label>' +
        '<input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com" value="' + esc(state.acc.email) + '">' +
        '<span class="field__hint">Вхід — за поштою. Нік показується в таблиці лідерів.</span>' +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass">Пароль</label>' +
        '<input class="input" id="au-pass" type="password" autocomplete="current-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ваш пароль">' +
      '</div>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-login"' + (state.busy ? ' disabled' : '') + '>Увійти</button>' +
        '<button class="btn btn--ghost" type="button" data-nav="start">← Назад</button>' +
      '</div>' +
      /* Без цього виходу акаунт із забутим паролем був назавжди втрачений:
         відновлення не існувало ніде на сайті. */
      '<p class="small muted mt-2 mb-0">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-nav="forgot">Забули пароль?</button>' +
      '</p>';
  }

  /** Крок «надішліть лист для відновлення». */
  function renderForgot(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Відновлення пароля</h1>' +
      '<p class="small mt-1">Впишіть пошту акаунта — надішлемо лист із посиланням, ' +
        'за яким можна поставити новий пароль.</p>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-email">Пошта</label>' +
        '<input class="input" id="au-email" type="email" autocomplete="email" ' +
          'placeholder="you@example.com" value="' + esc(state.acc.email) + '">' +
      '</div>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn--primary" type="button" id="au-forgot-go"' + (state.busy ? ' disabled' : '') + '>Надіслати лист</button>' +
        '<button class="btn btn--ghost" type="button" data-nav="login">← Назад</button>' +
      '</div>';
  }

  /** Крок «поставте новий пароль» — після переходу з листа відновлення. */
  function renderNewPass(host) {
    const PC = window.PasswordCore;
    const v = PC ? PC.check(state.acc.pass, { email: state.acc.email, username: state.acc.username }) : null;
    host.innerHTML = '' +
      '<h1 class="gate__title">Новий пароль</h1>' +
      '<p class="small mt-1">Посилання прийнято. Поставте новий пароль — після цього ' +
        'ви одразу ввійдете.</p>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass">Новий пароль</label>' +
        '<input class="input" id="au-pass" type="password" autocomplete="new-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="від 8 символів">' +
        (v && state.acc.pass && !v.ok ? '<span class="field__hint">' + esc(v.problem || '') + '</span>' : '') +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass2">Ще раз</label>' +
        '<input class="input" id="au-pass2" type="password" autocomplete="new-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="повторіть">' +
      '</div>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-newpass-go"' + (state.busy ? ' disabled' : '') + '>Зберегти пароль</button>' +
      '</div>';
  }

  function renderReg(host) {
    host.innerHTML = '' +
      stepBadge(1) +
      '<h1 class="gate__title">Створити акаунт</h1>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-name">Нік</label>' +
        '<input class="input" id="au-name" maxlength="24" autocomplete="username" placeholder="3–24 символи" value="' + esc(state.acc.username) + '">' +
        '<span class="field__hint">Публічне імʼя в таблиці лідерів. Має бути унікальним.</span>' +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-email">Пошта</label>' +
        '<input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com" value="' + esc(state.acc.email) + '">' +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass">Пароль</label>' +
        /* lang="en" + autocapitalize/spellcheck — підказки мобільним
           клавіатурам. Перемкнути РОЗКЛАДКУ з коду неможливо (такого API
           в браузері немає), тому кирилицю ловить перевірка й одразу
           каже про це прямо. */
        '<input class="input" id="au-pass" type="password" autocomplete="new-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
          'placeholder="мінімум ' + (window.PasswordCore ? window.PasswordCore.MIN_LEN : 8) + ' символів">' +
        /* Індикатор надійності: оцінка приходить із PasswordCore, тут
           лише показ. Порожній, поки нічого не введено. */
        '<div id="au-pw-meter" class="pwm" hidden>' +
          '<span class="pwm__bar"><i></i></span>' +
          '<span class="pwm__txt small"></span>' +
        '</div>' +
        '<span class="field__hint">Тільки англійська розкладка. Потрібні велика й мала літери, ' +
          'цифра і символ — наприклад <b class="mono">Kyiv#Gym24</b>. Довший пароль — надійніший.</span>' +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass2">Пароль ще раз</label>' +
        '<input class="input" id="au-pass2" type="password" autocomplete="new-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="той самий пароль">' +
      '</div>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-reg"' + (state.busy ? ' disabled' : '') + '>Продовжити</button>' +
        '<button class="btn btn--ghost" type="button" data-nav="start">← Назад</button>' +
      '</div>';
  }

  function renderConfirm(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Підтвердіть пошту</h1>' +
      '<p class="small mt-1">Ми надіслали лист на <b>' + esc(state.acc.email) + '</b>. ' +
        'Відкрийте його і натисніть посилання підтвердження, потім поверніться сюди ' +
        'і натисніть кнопку нижче.</p>' +
      /* Найчастіша причина «нічого не працює» — лист у спамі або взагалі
         не дійшов. Раніше на цьому екрані не було ЖОДНОЇ дії, крім
         «продовжити», яка без підтвердження нічого не дає. */
      '<p class="small muted mt-1">Листа немає? Перевірте теку «Спам». ' +
        'Він приходить від <b>noreply@mail.app.supabase.io</b>.</p>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn--primary" type="button" id="au-confirmed"' + (state.busy ? ' disabled' : '') + '>Я підтвердив(ла) — продовжити</button>' +
        '<button class="btn btn--ghost" type="button" id="au-resend"' + (state.busy ? ' disabled' : '') + '>Надіслати лист ще раз</button>' +
      '</div>' +
      '<div class="row mt-2" style="gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-nav="login">Уже маю акаунт — увійти</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-nav="start">← Назад</button>' +
      '</div>';
  }

  function renderName(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Оберіть нік</h1>' +
      '<p class="small muted mt-1">Цей нік уже зайнятий або ще не вказаний. Потрібен унікальний.</p>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-name">Нік</label>' +
        '<input class="input" id="au-name" maxlength="24" placeholder="3–24 символи" value="' + esc(state.acc.username) + '">' +
      '</div>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-name-go"' + (state.busy ? ' disabled' : '') + '>Продовжити</button>' +
      '</div>';
  }

  function renderPending(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Заявку на створення акаунта отримано</h1>' +
      '<p class="small mt-1">Ваш профіль зараз очікує підтвердження. ' +
        'Після підтвердження ви отримаєте доступ до Forge.</p>' +
      '<p class="small muted mt-1">Це ручна перевірка — зазвичай недовго. ' +
        'Сторінку можна закрити: заявка нікуди не дінеться.</p>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-recheck"' + (state.busy ? ' disabled' : '') + '>Оновити статус</button>' +
        '<button class="btn btn--ghost" type="button" id="au-out">Вийти</button>' +
      '</div>';
  }

  function renderRejected(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Заявку відхилено</h1>' +
      '<p class="small mt-1">Цю заявку не підтверджено. Можете подати нову — ' +
        'дані скринінгу заповните ще раз.</p>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" data-nav="age">Подати ще раз</button>' +
        '<button class="btn btn--ghost" type="button" id="au-out">Вийти</button>' +
      '</div>';
  }

  function renderBlocked(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Акаунт заблоковано</h1>' +
      '<p class="small mt-1">Доступ до Forge для цього акаунта закрито адміністратором.</p>' +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--ghost" type="button" id="au-out">Вийти</button>' +
      '</div>';
  }

  function render() {
    const host = $('#gate-card');
    if (!host) return;
    switch (state.step) {
      case 'start':    return renderStart(host);
      case 'login':    return renderLogin(host);
      case 'reg':      return renderReg(host);
      case 'confirm':  return renderConfirm(host);
      case 'forgot':   return renderForgot(host);
      case 'newpass':  return renderNewPass(host);
      case 'name':     return renderName(host);
      case 'body':     return renderBody(host);
      case 'pending':  return renderPending(host);
      case 'rejected': return renderRejected(host);
      case 'blocked':  return renderBlocked(host);
      default:         return renderAge(host);
    }
  }

  /*
   * Перехід між кроками. err чиститься лише коли крок СПРАВДІ міняється:
   * раніше nav() викликали і для того, щоб лишитись на місці й показати
   * помилку (UNDERAGE, USERNAME_TAKEN, «нік зайнятий») — і повідомлення
   * гасло тим самим викликом, який мав його показати.
   */
  function nav(step) {
    if (step !== state.step) state.err = '';
    state.step = step;
    render();
  }

  /**
   * Перейти на інший крок І показати там пояснення.
   *
   * nav() навмисно гасить state.err при зміні кроку — інакше стара
   * помилка тягнулась би за людиною по всіх екранах. Але є випадки, де
   * повідомлення саме й пояснює, ЧОМУ нас сюди перекинуло («ця пошта вже
   * зареєстрована»), і без нього перехід виглядає як збій.
   */
  function navMsg(step, msg) {
    state.step = step;
    state.err = msg;
    render();
  }

  async function init() {
    if (!$('#gate-card') || !AC || !OC) return;

    if (CLOUD) {
      /*
       * ПЕРЕХІД ІЗ ЛИСТА — найперше.
       *
       * Supabase повертає людину на сайт із токенами у фрагменті адреси
       * (#access_token=…&type=signup|recovery). Раніше їх ніхто не читав:
       * людина клікала в листі, поверталась НЕ ввійденою і мусила
       * вводити пароль ще раз — а якщо пароль був інший (повторна
       * реєстрація на ту саму пошту), то не входила вже ніколи.
       */
      let fromLink = null;
      try { fromLink = await window.Store.adoptUrlSession(); }
      catch (e) { state.err = (e && e.message) || ''; }

      if (fromLink && fromLink.type === 'recovery') {
        /* Лист відновлення: сесія вже є, але вести людину в застосунок не
           можна — спершу новий пароль. Виходити з init() тут не можна:
           нижче ще навішуються обробники, без них екран мертвий. */
        state.step = 'newpass';
        render();
      } else if (window.Store.user()) {
        /*
         * Хмарний режим: спершу автентифікація, потім статус заявки, і лише
         * для approved — профільні кроки. Скринінг більше не перший екран.
         */
        render();               // тимчасовий стан, поки їде статус
        await routeAfterAuth(); // сам зробить render/redirect
      } else {
        state.step = 'start';
        render();
      }
    } else {
      /*
       * Локальний режим (ключі Supabase порожні): акаунтів немає. Стартовий
       * екран той самий; «Зареєструватися» веде одразу в скринінг, дані
       * живуть у цьому браузері — як і до цієї зміни.
       */
      let p = {};
      try { p = await window.Store.getProfile() || {}; } catch (_) {}
      seedFromProfile(p);
      const step = OC.stepFor(p);
      if (step === 'program') { location.replace(NEXT); return; }
      if (step === 'done') { location.replace(HOME); return; }
      state.step = (step === 'age' && !p.birthDate) ? 'start' : step;
      render();
    }

    const host = $('#gate-card');

    /** Наступне/попереднє поле дати — для автопереходу. */
    function dobNeighbour(key, dir) {
      const i = DOB_PARTS.findIndex(function (p) { return p.k === key; });
      const n = DOB_PARTS[i + dir];
      return n ? $('#dob-' + n.k) : null;
    }

    host.addEventListener('input', function (e) {
      const t = e.target;
      /* Пароль: оновлюємо лише індикатор. Повний render() тут знищив би
         поле під пальцями разом із набраним. */
      if (t.id === 'au-pass' || t.id === 'au-pass2' || t.id === 'au-email' || t.id === 'au-name') {
        readAccFields();
        if (state.step === 'reg') syncPwMeter();
        return;
      }
      const key = t.dataset && t.dataset.dob;
      if (key) {
        /* Поле текстове, а не number: type=number пускає 'e', '+' і
           прокручує значення колесом миші — для дати це шкода, а не користь.
           Тому чистимо самі. */
        const max = DOB_PARTS.find(function (p) { return p.k === key; }).len;
        const clean = t.value.replace(/\D+/g, '').slice(0, max);
        if (clean !== t.value) t.value = clean;
        state.dob[key] = clean;
        refreshAge();
        /* Автоперехід уперед, щойно поле заповнене: 28 → 08 → 2000 без
           жодного натискання Tab. */
        if (clean.length === max) {
          const next = dobNeighbour(key, 1);
          if (next) { next.focus(); next.select(); }
        }
        return;
      }
      const b = t.closest('[data-b]');
      if (b) { state.body[b.dataset.b] = b.value; syncBodyControls(); }
    });

    host.addEventListener('keydown', function (e) {
      const t = e.target;
      const key = t.dataset && t.dataset.dob;
      if (!key) return;
      /* Backspace у порожньому полі повертає в попереднє — інакше з «року»
         не вийти назад, не тягнучись до миші. */
      if (e.key === 'Backspace' && t.value === '') {
        const prev = dobNeighbour(key, -1);
        if (prev) { e.preventDefault(); prev.focus(); prev.setSelectionRange(prev.value.length, prev.value.length); }
        return;
      }
      if (e.key === 'ArrowLeft' && t.selectionStart === 0) {
        const prev = dobNeighbour(key, -1);
        if (prev) { e.preventDefault(); prev.focus(); }
        return;
      }
      if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) {
        const next = dobNeighbour(key, 1);
        if (next) { e.preventDefault(); next.focus(); next.setSelectionRange(0, 0); }
        return;
      }
      /* Крапка, кома чи слеш — звичний спосіб відділити частини дати */
      if (e.key === '.' || e.key === ',' || e.key === '/') {
        e.preventDefault();
        const next = dobNeighbour(key, 1);
        if (next) { next.focus(); next.select(); }
      }
    });

    /* Вставка цілої дати: '28.08.2000', '28/08/2000' чи '28082000' —
       розкладаємо по полях, а не пхаємо все в одне. */
    host.addEventListener('paste', function (e) {
      const t = e.target;
      if (!(t.dataset && t.dataset.dob)) return;
      const raw = (e.clipboardData || window.clipboardData).getData('text') || '';
      const digits = raw.replace(/\D+/g, '');
      if (digits.length < 8) return;
      e.preventDefault();
      state.dob = { d: digits.slice(0, 2), m: digits.slice(2, 4), y: digits.slice(4, 8) };
      DOB_PARTS.forEach(function (p) {
        const el = $('#dob-' + p.k);
        if (el) el.value = state.dob[p.k];
      });
      refreshAge();
    });

    host.addEventListener('change', function (e) {
      const t = e.target;
      if (t.dataset && t.dataset.dob) { refreshAge(); return; }
      if (t.id === 'c-terms' || t.id === 'c-privacy' || t.id === 'c-medical') {
        state.consents[t.id] = t.checked;
        syncBodyControls();
        return;
      }
      if (t.name === 'b-sex') { state.body.sex = t.value; syncBodyControls(); return; }
      const b = t.closest('[data-b]');
      if (b) { state.body[b.dataset.b] = b.value; syncBodyControls(); }
    });

    /* Enter у полях дати = натиснути «Продовжити» */
    host.addEventListener('keypress', function (e) {
      if (e.key !== 'Enter') return;
      if (!(e.target.dataset && e.target.dataset.dob)) return;
      e.preventDefault();
      const go = $('#gate-go');
      if (go && !go.disabled) proceedAge();
    });
    host.addEventListener('click', function (e) {
      const navBtn = e.target.closest('[data-nav]');
      if (navBtn) {
        readAccFields();
        nav(navBtn.dataset.nav);
        return;
      }
      if (e.target.closest('#gate-go')) { proceedAge(); return; }
      if (e.target.closest('#body-go')) { proceedBody(); return; }
      if (e.target.closest('#au-login')) { doLogin(); return; }
      if (e.target.closest('#au-reg')) { doRegister(); return; }
      if (e.target.closest('#au-confirmed')) { doConfirmed(); return; }
      if (e.target.closest('#au-resend')) { doResend(); return; }
      if (e.target.closest('#au-forgot-go')) { doForgot(); return; }
      if (e.target.closest('#au-newpass-go')) { doNewPass(); return; }
      if (e.target.closest('#au-name-go')) { doNameGo(); return; }
      if (e.target.closest('#au-recheck')) { doRecheck(); return; }
      if (e.target.closest('#au-out')) { doSignOut(); return; }
    });

    /* Enter у полях автентифікації = головна кнопка екрана */
    host.addEventListener('keypress', function (e) {
      if (e.key !== 'Enter') return;
      if (!e.target.closest('#au-email, #au-pass, #au-pass2, #au-name')) return;
      e.preventDefault();
      readAccFields();
      if (state.step === 'login') doLogin();
      else if (state.step === 'reg') doRegister();
      else if (state.step === 'name') doNameGo();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
