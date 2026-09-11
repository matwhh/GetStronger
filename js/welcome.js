/**
 * Перші екрани Get Stronger: вік (17+) і базові дані тіла.
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
    /* Поле, у якому саме помилка (id інпута), і що пропонуємо зробити далі.
       Без цього повідомлення висіло під карткою і не казало, куди дивитись. */
    errField: '',
    errAction: '',
    /* Питання «це ваше посилання з листа?» — воно ж екран, а не діалог.
       Тут живе {email, type, resolve} доти, доки людина не відповість. */
    linkAsk: null,
    busy: false
  };

  const CLOUD = Boolean(window.Store && window.Store.isCloud);

  /* ------------------------------------------------------------------ */
  /* Чернетка реєстрації                                                 */
  /* ------------------------------------------------------------------ */
  /*
   * Екран реєстрації НЕ переживав перезавантаження: людина йшла в пошту
   * по лист підтвердження, поверталась — і всі поля були порожні, а на
   * екрані стояв стартовий «Get Stronger», ніби нічого й не було. Половина
   * кинутих реєстрацій — саме тут.
   *
   * Тому все набране лягає в localStorage і піднімається назад при
   * завантаженні. ПАРОЛЬ СЮДИ НЕ ПИШЕТЬСЯ НІКОЛИ — він живе лише в
   * памʼяті вкладки; після перезавантаження людину веде вхід, а не
   * підставлений із диска пароль.
   *
   * ПОШТА — теж не завжди. Поки заявки на сервер не подано, реєстрація
   * незавершена, і сліду від неї на диску лишатись не має: людина могла
   * передумати на півдорозі, а пошта — це вже особисті дані, та ще й на
   * чужому чи спільному компʼютері. Тому адреса лягає в чернетку лише з
   * того моменту, коли акаунт на сервері ВЖЕ створено (stage === 'confirm')
   * і вона потрібна, щоб надіслати лист підтвердження ще раз. До того —
   * у чернетці лише нік, дата народження, заміри й згоди.
   *
   * Чернетка — не друге джерело правди: профіль сильніший. Вона лише
   * заповнює порожні поля (див. loadDraft) і зникає, щойно заявку подано.
   */
  const DRAFT_KEY = 'ib.regdraft';

  function saveDraft(patch) {
    try {
      let prev = {};
      try { prev = JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch (_) {}
      const stage = (patch && patch.stage) || prev.stage || '';
      const d = {
        v: 1,
        stage: stage,
        username: state.acc.username || '',
        /* Див. коментар вище: до 'confirm' акаунта ще немає — пошту не пишемо. */
        email: stage === 'confirm' ? (state.acc.email || '') : '',
        dob: state.dob,
        body: state.body,
        consents: state.consents
      };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch (_) { /* приватний режим або переповнене сховище — не привід падати */ }
  }

  function readDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      return (d && typeof d === 'object' && d.v === 1) ? d : null;
    } catch (_) { return null; }
  }

  /** Піднімає чернетку в state, НЕ затираючи вже заповнене. */
  function loadDraft() {
    const d = readDraft();
    if (!d) return null;
    if (d.username && !state.acc.username) state.acc.username = String(d.username);
    if (d.email && !state.acc.email) state.acc.email = String(d.email);

    if (d.dob && typeof d.dob === 'object' && !state.birth) {
      DOB_PARTS.forEach(function (part) {
        const v = d.dob[part.k];
        if (typeof v === 'string') state.dob[part.k] = v.replace(/\D+/g, '').slice(0, part.len);
      });
      state.birth = dobToBirth(state.dob);
    }
    if (d.body && typeof d.body === 'object') {
      Object.keys(state.body).forEach(function (k) {
        const cur = state.body[k];
        const val = d.body[k];
        if ((cur === '' || cur === null || cur === undefined) &&
            val !== null && val !== undefined && val !== '') state.body[k] = val;
      });
    }
    if (d.consents && typeof d.consents === 'object') {
      ['c-terms', 'c-privacy', 'c-medical'].forEach(function (k) {
        if (d.consents[k]) state.consents[k] = true;
      });
    }
    return d;
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  }

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
          '<p class="gate__msg-title">Get Stronger доступний лише користувачам віком від 17 років.</p>' +
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
      signOutBtn() +

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
    saveDraft();
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

  /*
   * Число з поля. Кома — десятковий роздільник: люди пишуть «58,5», і в
   * Chromium з англійською локаллю type=number мовчки викидав кому —
   * виходило 585 кг. Тому поля текстові (inputmode=decimal), а
   * перетворення одне на весь крок.
   */
  function toNum(v) {
    const str = String(v == null ? '' : v).trim().replace(',', '.');
    if (str === '' || !/^-?\d+(\.\d+)?$/.test(str)) return NaN;
    return Number(str);
  }

  function draftProfile() {
    const b = state.body;
    const num = function (v) { return String(v).trim() === '' ? null : toNum(v); };
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
    if (String(v).trim() === '') return true;
    const n = toNum(v);
    return Number.isFinite(n) && n >= lo && n <= hi;
  }

  function bodyReady() {
    return OC.hasBody(draftProfile()) &&
      hrOk(state.body.hrRest, 30, 120) &&
      hrOk(state.body.hrMax, 120, 230);
  }

  function numIn(v, lim) {
    const n = toNum(v);
    return String(v).trim() !== '' && Number.isFinite(n) && n >= lim[0] && n <= lim[1];
  }

  /*
   * ЧОГО САМЕ БРАКУЄ.
   *
   * Кнопка «Далі» вимикалась мовчки: людина заповнювала анкету, тиснула —
   * і НІЧОГО не відбувалось, без жодного слова чому. Найчастіша причина —
   * три згоди, які легко прогорнути повз, бо вони під довгою формою.
   * Саме на цьому місці й застрягла жива реєстрація.
   *
   * Перелік будується з ТИХ САМИХ значень, що й критерій (OnboardingCore
   * віддає межі назовні) — тому розійтися з кнопкою він не може.
   */
  const CONSENT_ITEM = 'три згоди';

  function missingBody() {
    const b = state.body;
    const out = [];
    if (OC.SEX.indexOf(b.sex) === -1) out.push('стать');
    if (!numIn(b.height, OC.LIMITS.height)) out.push('зріст (' + OC.LIMITS.height.join('–') + ' см)');
    if (!numIn(b.weight, OC.LIMITS.weight)) out.push('вагу (' + OC.LIMITS.weight.join('–') + ' кг)');
    if (OC.ACTIVITY.indexOf(String(Number(b.activity))) === -1) out.push('рівень активності');
    if (OC.TRAINING_AGE.indexOf(b.trainingAge) === -1) out.push('стаж тренувань');
    if (!hrOk(b.hrRest, 30, 120)) out.push('пульс спокою 30–120 (або лишіть поле порожнім)');
    if (!hrOk(b.hrMax, 120, 230)) out.push('максимальний пульс 120–230 (або лишіть поле порожнім)');
    if (!consentsOk()) out.push(CONSENT_ITEM);
    return out;
  }

  /** Підпис під кнопкою: або що далі, або чого бракує. Порожнім не буває. */
  function bodyNote() {
    const miss = missingBody();
    if (!miss.length) return 'Крок 2 з 3. Далі: програма тренувань і робоча вага.';
    const fields = miss.filter(function (x) { return x !== CONSENT_ITEM; });
    const parts = [];
    if (fields.length) parts.push('Щоб продовжити, заповніть: ' + fields.join(', ') + '.');
    if (miss.indexOf(CONSENT_ITEM) !== -1) {
      parts.push('Відмітьте три згоди вище — без них заявку подати не можна.');
    }
    return parts.join(' ');
  }

  function numField(id, key, label, hint, opts) {
    return '<div class="field mt-2">' +
      '<label class="field__label" for="' + id + '">' + label + '</label>' +
      /* type=text, а не number: number у Chromium з en-локаллю викидає кому
         («58,5» → 585). Межі перевіряє bodyReady(), не браузер. */
      '<input class="input" id="' + id + '" data-b="' + key + '" type="text" ' +
        'inputmode="decimal" autocomplete="off" ' +
        'data-min="' + opts.min + '" data-max="' + opts.max + '"' +
        (opts.ph ? ' placeholder="' + opts.ph + '"' : '') +
        ' value="' + esc(String(state.body[key])) + '">' +
      (hint ? '<p class="small muted" style="margin:6px 0 0">' + hint + '</p>' : '') +
    '</div>';
  }

  function renderBody(host) {
    const NC = window.NutritionCalc;
    const acts = Object.keys(NC.ACTIVITY);
    /* Згоди входять в умову і ТУТ теж. Раніше розмітка малювала кнопку
       активною лише за bodyReady(), а клік перевіряв ще й згоди — тож
       кнопка виглядала робочою, а натискання не робило нічого. */
    const canGo = bodyReady() && consentsOk();

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
      '<p class="small muted gate__lead">З цього рахуються калорії, білок і пульсові зони.</p>' +

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
      signOutBtn() +

      '<p class="small gate__note' + (canGo ? ' muted' : '') + '" id="body-note">' +
        esc(bodyNote()) +
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
        '<a href="legal.html#terms" target="_blank" rel="noopener">Умовами використання</a> Get Stronger.') +
      box('c-privacy', 'Я прочитав(ла) ' +
        '<a href="legal.html#privacy" target="_blank" rel="noopener">Політику конфіденційності</a>.') +
      box('c-medical', 'Я розумію, що Get Stronger не є медичним сервісом, а інформація на платформі ' +
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
    const b = BC.bmi(toNum(state.body.weight), toNum(state.body.height));
    if (b === null) { el.innerHTML = ''; return; }
    const cat = BC.category(b);
    el.innerHTML = 'ІМТ: <b class="mono">' + String(b).replace('.', ',') + '</b> — ' +
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
      note.textContent = bodyNote();
      note.classList.toggle('muted', canGo);
    }
    saveDraft();
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
    const b = BC.bmi(toNum(state.body.weight), toNum(state.body.height));
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
      weight: toNum(b.weight),
      height: toNum(b.height),
      activity: Number(b.activity),
      trainingAge: b.trainingAge
    };
    /* Пульси — опційні: пишемо лише вписані валідні значення. */
    const hrR = toNum(b.hrRest), hrM = toNum(b.hrMax);
    if (String(b.hrRest).trim() !== '' && hrR >= 30 && hrR <= 120) patch.hrRest = hrR;
    if (String(b.hrMax).trim() !== '' && hrM >= 120 && hrM <= 230) patch.hrMax = hrM;

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
     * унікальність ніка, і ставить статус pending. Доступу до Get Stronger це
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
      clearDraft();          // заявка подана — чернетці більше нічого стерегти
      state.busy = false;
      nav('pending');
    } catch (e) {
      state.busy = false;
      const msg = String((e && e.message) || '');
      if (msg.indexOf('UNDERAGE') !== -1) {
        state.err = 'Get Stronger доступний із 17 років.';
        nav('age');
      } else if (msg.indexOf('USERNAME_TAKEN') !== -1 || msg.indexOf('USERNAME_INVALID') !== -1) {
        state.err = 'Нік зайнятий або некоректний — оберіть інший.';
        nav('name');
      } else if (msg.indexOf('REJECTED') !== -1) {
        /* SEC-001: відмова більше не скасовується повторною заявкою — і
           екран має сказати саме це, а не «невідома помилка». */
        nav('rejected');
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

  /**
   * Що не так у формі реєстрації.
   * @returns {{field: string, msg: string}|null} null — усе гаразд
   */
  function validAccount() {
    const a = state.acc;
    const nick = a.username.trim();
    if (!nick) return { field: 'au-name', msg: 'Введіть нік — під ним вас побачать у таблиці лідерів.' };
    if (nick.length < 3) {
      return { field: 'au-name', msg: 'Нік закороткий: ' + nick.length + ' — а треба від 3 символів.' };
    }
    if (nick.length > 13) {
      return { field: 'au-name', msg: 'Нік задовгий: ' + nick.length + ' — а можна не більше 13 символів.' };
    }

    const AM = window.AuthMsg;
    const em = AM ? AM.emailProblem(a.email)
                  : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()) ? '' : 'Перевірте адресу пошти.');
    if (em) return { field: 'au-email', msg: em };

    /* Надійність пароля — окреме ядро (js/password-core.js), тут лише
       його вердикт. Мінімальна довжина продубльована на сервері
       (Supabase Auth), щоб правило не трималось на самому браузері. */
    const PC = window.PasswordCore;
    if (!a.pass) return { field: 'au-pass', msg: 'Придумайте пароль.' };
    if (PC) {
      const v = PC.check(a.pass, { email: a.email, username: a.username });
      if (!v.ok) return { field: 'au-pass', msg: v.problem };
    } else if (a.pass.length < 8) {
      return { field: 'au-pass', msg: 'Пароль — щонайменше 8 символів.' };
    }

    if (!a.pass2) return { field: 'au-pass2', msg: 'Наберіть пароль ще раз — це захист від помилки.' };
    if (a.pass !== a.pass2) {
      return { field: 'au-pass2', msg: 'Паролі не збігаються. Перевірте другий рядок — там інший набір символів.' };
    }
    return null;
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
    /* Нік — у чернетку; паролі й пошта лишаються тільки в памʼяті,
       поки акаунт на сервері не створено (див. saveDraft). */
    saveDraft();
  }


  /*
   * Вхід із welcome.html теж мусить розвʼязувати конфлікт даних.
   *
   * Раніше результат signIn тут просто відкидався в усіх трьох місцях, і
   * merge='conflict' не бачив ніхто: локальна робота тихо затиралась
   * хмарним рядком (SYN-007). Правило — спільне, у Store.resolveMerge.
   */
  async function afterSignIn(res) {
    try {
      await window.Store.resolveMerge(res && res.merge, {
        ask: function (text) { return window.confirm(text); },
        notify: function (text, kind) {
          if (kind === 'err') state.err = text;
        }
      });
    } catch (_) { /* злиття не має ламати вхід */ }
  }

  async function doLogin() {
    if (state.busy) return;
    readAccFields();
    if (!CLOUD) { return fail('', 'Сайт у локальному режимі — вхід вимкнено.'); }

    /*
     * СПЕРШУ КАЖЕМО, ЩО САМЕ НЕ ТАК.
     *
     * Раніше тут стояв один рядок на всі випадки — «Заповніть пошту й
     * пароль (від 8 символів)». Людина з пробілом у кінці адреси, людина
     * з незакритою розкладкою і людина з порожнім полем бачили те саме.
     * Розбір причин — в AuthMsg (js/auth-msg-core.js), тут лише показ.
     */
    const AM = window.AuthMsg;
    if (AM) {
      const em = AM.emailProblem(state.acc.email);
      if (em) return fail('au-email', em);
      const pm = AM.loginPassProblem(state.acc.pass);
      if (pm) return fail('au-pass', pm);
    } else if (!state.acc.email || state.acc.pass.length < 8) {
      return fail('', 'Заповніть пошту й пароль (від 8 символів).');
    }

    state.busy = true; state.err = ''; state.errField = ''; state.errAction = ''; render();
    try {
      await afterSignIn(await window.Store.signIn(state.acc.email.trim(), state.acc.pass));
      state.busy = false;
      await routeAfterAuth();
    } catch (e) {
      state.busy = false;
      const r = AM ? AM.signInProblem(e)
                   : { field: '', action: '', text: (e && e.message) || 'Не вдалося увійти.' };
      /* Непідтверджена пошта — не помилка введення, а незавершений крок:
         ведемо туди, де є кнопка «надіслати лист ще раз». */
      if (r.action === 'confirm') return void navMsg('confirm', r.text);
      fail(r.field, r.text, r.action);
    }
  }

  async function doRegister() {
    if (state.busy) return;
    readAccFields();
    if (!CLOUD) { nav('age'); return; }   // локальний режим — одразу скринінг
    const v = validAccount();
    if (v) { fail(v.field, v.msg); return; }

    state.busy = true; state.err = ''; state.errField = ''; state.errAction = ''; render();
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
        /* Увімкнене підтвердження пошти: сесії ще немає. Позначаємо стадію,
           щоб перезавантаження повернуло людину саме на цей екран, а не на
           стартовий, де про створений акаунт немає й слова. */
        saveDraft({ stage: 'confirm' });
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
          await afterSignIn(await window.Store.signIn(state.acc.email.trim(), state.acc.pass));
          try { await window.Store.saveProfile({ displayName: state.acc.username.trim() }); } catch (_) {}
          await routeAfterAuth();
          return;
        } catch (e2) {
          fail('au-pass', 'Ця пошта вже зареєстрована, а цей пароль до неї не підходить. ' +
               'Увійдіть старим паролем — або відновіть його.', 'forgot');
          return;
        }
      }
      /* Код сервера точніший за текст: weak_password стосується пароля,
         email_exists — пошти. Показуємо помилку там, де її виправляють. */
      const code = String((e && e.code) || '');
      if (code === 'weak_password') return void fail('au-pass', msg);
      if (code === 'email_exists' || code === 'user_already_exists') {
        return void navMsg('login', 'Ця пошта вже зареєстрована. Увійдіть — ' +
                           'або відновіть пароль, якщо не памʼятаєте.');
      }
      if (code === 'validation_failed') return void fail('au-email', msg);
      fail('', 'Не вдалося створити акаунт: ' + msg);
    }
  }

  /** Після появи сесії: перевірити нік і рушити в скринінг. */
  async function afterSignupChecks() {
    try {
      const free = await window.Store.rpc('username_free', { p_username: state.acc.username.trim() });
      if (free === false) { navMsg('name', 'Цей нік уже зайнятий — оберіть інший.', 'au-name'); return; }
    } catch (_) { /* перевірить register_request */ }
    nav('age');
  }

  /** Лист для відновлення пароля. */
  async function doForgot() {
    if (state.busy) return;
    readAccFields();
    const mail = (state.acc.email || '').trim();
    const AM = window.AuthMsg;
    const em = AM ? AM.emailProblem(mail)
                  : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) ? '' : 'Перевірте адресу пошти.');
    if (em) { fail('au-email', em); return; }
    state.busy = true; state.err = ''; state.errField = ''; state.errAction = ''; render();
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
    if (!state.acc.pass) { fail('au-pass', 'Придумайте новий пароль.'); return; }
    if (PC) {
      const v = PC.check(state.acc.pass, { email: state.acc.email, username: state.acc.username });
      if (!v.ok) { fail('au-pass', v.problem); return; }
    } else if ((state.acc.pass || '').length < 8) {
      fail('au-pass', 'Пароль — щонайменше 8 символів.'); return;
    }
    if (state.acc.pass !== state.acc.pass2) {
      fail('au-pass2', 'Паролі не збігаються. Перевірте другий рядок.'); return;
    }

    state.busy = true; state.err = ''; state.errField = ''; state.errAction = ''; render();
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
    state.busy = true; state.err = ''; state.errField = ''; state.errAction = ''; render();
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
    /*
     * Пароль у чернетку не пишеться навмисно, тож після перезавантаження
     * його тут немає. Раніше в цьому місці йшов signIn('', '') — сервер
     * відповідав «невірні дані», і людина читала це як «підтвердження не
     * зарахувалось». Ведемо на вхід і кажемо прямо, що робити.
     */
    if (!state.acc.pass) {
      navMsg('login', 'Пошту підтверджено? Тоді увійдіть тим паролем, який ви створили під час реєстрації.');
      return;
    }
    state.busy = true; state.err = ''; state.errField = ''; state.errAction = ''; render();
    try {
      await afterSignIn(await window.Store.signIn(state.acc.email.trim(), state.acc.pass));
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
    if (!n) { fail('au-name', 'Введіть нік.'); return; }
    if (n.length < 3) { fail('au-name', 'Нік закороткий: ' + n.length + ' — а треба від 3 символів.'); return; }
    if (n.length > 13) { fail('au-name', 'Нік задовгий: ' + n.length + ' — а можна не більше 13.'); return; }
    try { await window.Store.saveProfile({ displayName: n }); } catch (_) {}
    try {
      const free = await window.Store.rpc('username_free', { p_username: n });
      if (free === false) { fail('au-name', 'Цей нік теж зайнятий — спробуйте інший.'); return; }
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

  /* B6 (shared device): на кроках віку/тіла залогінений користувач раніше
     не мав жодного виходу з акаунта — «Вийти» існувало лише на екранах
     pending/blocked. Кнопка не змінює security-модель онбордингу: вона
     просто викликає той самий doSignOut (Store.signOut + clearDraft). */
  function signOutBtn() {
    if (!CLOUD || !window.Store.user()) return '';
    return '<button class="btn btn--ghost btn--wide mt-2" type="button" id="au-out">Вийти з акаунта</button>';
  }

  async function doSignOut() {
    try { await window.Store.signOut(); } catch (_) {}
    clearDraft();
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

  /*
   * ПОМИЛКА ЖИВЕ БІЛЯ СВОГО ПОЛЯ.
   *
   * errLine() лишається для помилок, які не стосуються жодного поля
   * (немає звʼязку, забагато спроб, відмова сервера). Якщо ж відомо,
   * ЩО САМЕ набрано не так, текст іде під тим самим інпутом — fieldErr —
   * а сам інпут позначається aria-invalid і червоною рамкою.
   */
  function errLine() {
    return (state.err && !state.errField)
      ? '<p class="small form-err" role="alert">' + esc(state.err) + '</p>'
      : '';
  }

  /** Повідомлення під конкретним полем. */
  function fieldErr(id) {
    return (state.err && state.errField === id)
      ? '<span class="field__err" role="alert">' + esc(state.err) + '</span>'
      : '';
  }

  /** Позначка «в цьому полі помилка» для самого інпута. */
  function bad(id) {
    return state.errField === id ? ' aria-invalid="true"' : '';
  }

  /**
   * Записати помилку поля й перемалювати.
   * @param {string} field id інпута ('' — помилка не про поле)
   * @param {string} msg   людський текст
   * @param {string} [action] підказка інтерфейсу: 'forgot' | 'confirm'
   */
  function fail(field, msg, action) {
    state.err = msg;
    state.errField = field || '';
    state.errAction = action || '';
    state.busy = false;
    render();
    return false;
  }

  function renderStart(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title" style="text-align:center">Get Stronger</h1>' +
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
        '<input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com"' +
          bad('au-email') + ' value="' + esc(state.acc.email) + '">' +
        fieldErr('au-email') +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass">Пароль</label>' +
        '<input class="input" id="au-pass" type="password" autocomplete="current-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ваш пароль"' +
          bad('au-pass') + '>' +
        fieldErr('au-pass') +
      '</div>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-login"' + (state.busy ? ' disabled' : '') + '>Увійти</button>' +
        '<button class="btn btn--ghost" type="button" data-nav="start">← Назад</button>' +
      '</div>' +
      /* Без цього виходу акаунт із забутим паролем був назавжди втрачений:
         відновлення не існувало ніде на сайті. Коли сервер щойно сказав
         «пароль не підходить», кнопка стає помітною: саме там наступний
         крок людини, яка пароль забула. */
      '<p class="small muted mt-2 mb-0">' +
        '<button class="btn ' + (state.errAction === 'forgot' ? 'btn--primary' : 'btn--ghost') +
          ' btn--sm" type="button" data-nav="forgot">Забули пароль?</button>' +
      '</p>';
  }

  /** Крок «надішліть лист для відновлення». */
  function renderForgot(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Відновлення пароля</h1>' +
      '<p class="small mt-1">Надішлемо лист із посиланням для нового пароля.</p>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-email">Пошта</label>' +
        '<input class="input" id="au-email" type="email" autocomplete="email" ' +
          'placeholder="you@example.com"' + bad('au-email') + ' value="' + esc(state.acc.email) + '">' +
        fieldErr('au-email') +
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
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="від 8 символів"' +
          bad('au-pass') + '>' +
        (fieldErr('au-pass') ||
         (v && state.acc.pass && !v.ok ? '<span class="field__hint">' + esc(v.problem || '') + '</span>' : '')) +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass2">Ще раз</label>' +
        '<input class="input" id="au-pass2" type="password" autocomplete="new-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="повторіть"' +
          bad('au-pass2') + '>' +
        fieldErr('au-pass2') +
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
        '<input class="input" id="au-name" maxlength="13" autocomplete="username" placeholder="3–13 символів"' +
          bad('au-name') + ' value="' + esc(state.acc.username) + '">' +
        (fieldErr('au-name') || '<span class="field__hint">Видно всім у таблиці лідерів.</span>') +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-email">Пошта</label>' +
        '<input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com"' +
          bad('au-email') + ' value="' + esc(state.acc.email) + '">' +
        fieldErr('au-email') +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass">Пароль</label>' +
        /* lang="en" + autocapitalize/spellcheck — підказки мобільним
           клавіатурам. Перемкнути РОЗКЛАДКУ з коду неможливо (такого API
           в браузері немає), тому кирилицю ловить перевірка й одразу
           каже про це прямо. */
        '<input class="input" id="au-pass" type="password" autocomplete="new-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" ' +
          'placeholder="мінімум ' + (window.PasswordCore ? window.PasswordCore.MIN_LEN : 8) + ' символів"' +
          bad('au-pass') + '>' +
        fieldErr('au-pass') +
        /* Індикатор надійності: оцінка приходить із PasswordCore, тут
           лише показ. Порожній, поки нічого не введено. */
        '<div id="au-pw-meter" class="pwm" hidden>' +
          '<span class="pwm__bar"><i></i></span>' +
          '<span class="pwm__txt small"></span>' +
        '</div>' +
        '<span class="field__hint">Латиниця, велика й мала літери, цифра і символ — ' +
          'наприклад <b class="mono">Kyiv#Gym24</b>.</span>' +
      '</div>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-pass2">Пароль ще раз</label>' +
        '<input class="input" id="au-pass2" type="password" autocomplete="new-password" ' +
          'lang="en" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="той самий пароль"' +
          bad('au-pass2') + '>' +
        fieldErr('au-pass2') +
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
      /* Підзаголовок мусить пояснювати ПОЛЕ, а не звинувачувати. Раніше тут
         стояло «Цей нік зайнятий або ще не вказано» — і воно світилось
         завжди, зокрема тому, хто потрапив сюди вперше й нічого ще не
         вводив. Людина читає це як помилку й вирішує, що її не пускають.
         Справжня причина показується нижче через errLine(). */
      '<p class="small muted mt-1">Нік видно іншим у таблиці лідерів. ' +
        '3–13 символів, має бути унікальним.</p>' +
      '<div class="field mt-2">' +
        '<label class="field__label" for="au-name">Нік</label>' +
        '<input class="input" id="au-name" maxlength="13" placeholder="3–13 символів"' +
          bad('au-name') + ' value="' + esc(state.acc.username) + '">' +
        fieldErr('au-name') +
      '</div>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-name-go"' + (state.busy ? ' disabled' : '') + '>Продовжити</button>' +
      '</div>';
  }

  /*
   * ЕКРАН ОЧІКУВАННЯ.
   *
   * Кільця тут не «завантаження»: нічого не вантажиться, і сторінка не
   * опитує сервер у циклі. Вони позначають СТАН — заявка лежить у черзі
   * на розгляд. Тому й обертаються повільно (1,6 с на оберт): швидкий
   * спінер обіцяв би, що відповідь ось-ось, а її розглядає людина.
   *
   * ТЕКСТ ПЕРЕПИСАНО. Стояло «зазвичай недовго» — обіцянка, яку ніхто не
   * контролює: заявку може бути розглянуто за хвилину, а може за добу.
   * І головне, чого бракувало: ЛИСТА ПРО СХВАЛЕННЯ НЕ БУДЕ. Пошта на
   * схвалення не надсилається (перевірено в admin.js і в db/), тож людина,
   * яка чекає листа, чекатиме його вічно. Тепер написано прямо: зайдіть
   * пізніше й натисніть «Оновити статус».
   *
   * role="status" плюс aria-live: для читалки екрана кільця — це не
   * картинка, а повідомлення про поточний стан.
   */
  function renderPending(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Заявку надіслано</h1>' +
      '<div class="gate__wait">' +
        '<div class="loader" role="status" aria-live="polite" ' +
             'aria-label="Заявка на розгляді">' +
          '<i class="loader__ring" aria-hidden="true"></i>' +
          '<i class="loader__ring loader__ring--in" aria-hidden="true"></i>' +
        '</div>' +
        '<div>' +
          '<b>Чекаємо на схвалення</b>' +
          '<span class="small muted">Заявки розглядає людина, тому це не миттєво.</span>' +
        '</div>' +
      '</div>' +
      '<p class="small muted mt-2">Листа про схвалення не буде — зайдіть ' +
        'пізніше й натисніть «Оновити статус». Сторінку можна закрити: ' +
        'заявка нікуди не дінеться.</p>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-recheck"' + (state.busy ? ' disabled' : '') + '>Оновити статус</button>' +
        '<button class="btn btn--ghost" type="button" id="au-out">Вийти</button>' +
      '</div>';
  }

  /*
   * Екран відмови. Кнопки «Подати ще раз» тут більше немає (SEC-001):
   * повторна заявка обнуляла рішення адміна разом із decided_at і
   * decided_by, тобто відхилений сам повертав собі розгляд. Сервер тепер
   * відповідає REJECTED, і обіцяти в інтерфейсі те, чого не буде, — гірше
   * за відсутність кнопки.
   */
  function renderRejected(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Заявку відхилено</h1>' +
      '<p class="small mt-1">Цю заявку не підтверджено, і подати її повторно ' +
        'з цього акаунта не можна. Якщо вважаєте це помилкою — напишіть ' +
        'адміністратору.</p>' +
      errLine() +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--ghost" type="button" id="au-out">Вийти</button>' +
      '</div>';
  }

  /*
   * «ЦЕ ВАШЕ ПОСИЛАННЯ?» — ЕКРАН, А НЕ window.confirm.
   *
   * Питання тут потрібне (WEB-001: чуже посилання садило людину в чужий
   * акаунт), але ставити його системним діалогом виявилось найгіршим із
   * можливих способів. По-перше, у застосунках пошти посилання відкриває
   * вбудований браузер, і сірий системний прямокутник «forge-mold1…
   * каже:» читається як шахрайство — його закривають не читаючи.
   * По-друге, у частині вбудованих браузерів confirm() узагалі не
   * показується і мовчки повертає false.
   *
   * А ціна відмови була найвищою з можливих: токен із листа вже
   * витрачено, на екрані — самий рядок «Вхід за посиланням скасовано»,
   * і ЖОДНОЇ кнопки. Саме так відновлення пароля ставало неможливим:
   * лист приходив, посилання працювало, а людина впиралась у глухий кут.
   */
  function renderLinkAsk(host) {
    const info = state.linkAsk || {};
    const mail = info.email || '';
    const isRecovery = info.type === 'recovery';
    host.innerHTML = '' +
      '<h1 class="gate__title">Це ваше посилання?</h1>' +
      '<p class="small mt-1">Ви відкрили посилання' +
        (isRecovery ? ' для зміни пароля' : ' із листа') +
        ' не в тому браузері, з якого його замовляли — так буває, коли лист ' +
        'читають у застосунку пошти або на іншому пристрої.</p>' +
      '<p class="mt-2 mb-0">Воно веде в акаунт:</p>' +
      '<p class="num mono" style="margin:2px 0 0;word-break:break-all"><b>' + esc(mail) + '</b></p>' +
      '<p class="small muted mt-1">Якщо ця адреса не ваша — не входьте.</p>' +
      '<div class="grid mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" id="au-link-yes">Так, це моя пошта</button>' +
        '<button class="btn btn--ghost" type="button" id="au-link-no">Ні, не входити</button>' +
      '</div>';

    /*
     * Обробники навішуються тут, а не в загальному делегуванні: init()
     * стоїть на await цієї самої відповіді, а спільний bind() виконується
     * ПІСЛЯ нього. Чекати на кнопку, яку ще ніхто не слухає, — вічність.
     */
    const answer = function (yes) {
      const ask = state.linkAsk;
      state.linkAsk = null;
      if (ask && typeof ask.resolve === 'function') ask.resolve(yes);
    };
    const yes = host.querySelector('#au-link-yes');
    const no = host.querySelector('#au-link-no');
    if (yes) yes.addEventListener('click', function () { answer(true); });
    if (no) no.addEventListener('click', function () { answer(false); });
  }

  /*
   * Посилання не спрацювало — і це НЕ кінець дороги.
   *
   * Сюди веде все, що може статись із листом: застаріле посилання, вже
   * використане, відкрите не в тому браузері, відповідь «ні» на питання
   * вище. Спільне в усіх випадках одне: людині треба не пояснення, а
   * наступна кнопка.
   */
  function renderLinkFail(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Посилання не спрацювало</h1>' +
      '<p class="small mt-1">' + esc(state.err || 'Вхід за посиланням не відбувся.') + '</p>' +
      '<p class="small muted mt-1">Посилання з листа одноразове: воно згоряє після ' +
        'першого відкриття й за добу. Замовте новий лист — це безкоштовно й ' +
        'займає хвилину.</p>' +
      '<div class="grid mt-3" style="gap:10px">' +
        '<button class="btn btn--primary" type="button" data-nav="forgot">Надіслати новий лист</button>' +
        '<button class="btn btn--ghost" type="button" data-nav="login">Увійти паролем</button>' +
      '</div>';
  }

  function renderBlocked(host) {
    host.innerHTML = '' +
      '<h1 class="gate__title">Акаунт заблоковано</h1>' +
      '<p class="small mt-1">Доступ до Get Stronger для цього акаунта закрито адміністратором.</p>' +
      '<div class="row mt-3" style="gap:10px">' +
        '<button class="btn btn--ghost" type="button" id="au-out">Вийти</button>' +
      '</div>';
  }

  function render() {
    renderStep();
    afterRender();
  }

  /*
   * Що робиться ПІСЛЯ перемальовування.
   *
   * 1. Паролі в HTML не пишуться (їм там не місце), тому після кожного
   *    render поля виявлялись порожніми — і людина, яка помилилась у
   *    пошті, мусила набирати пароль ще раз. Повертаємо з памʼяті.
   * 2. Фокус іде в поле з помилкою й виділяє набране: наступне ж
   *    натискання клавіші замінює неправильне, а не дописує до нього.
   */
  function afterRender() {
    const put = function (id, val) {
      const el = $('#' + id);
      if (el && val && !el.value) el.value = val;
    };
    put('au-pass', state.acc.pass);
    put('au-pass2', state.acc.pass2);
    try { syncPwMeter(); } catch (_) {}

    if (!state.errField) return;
    const el = $('#' + state.errField);
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
      if (typeof el.select === 'function') el.select();
    } catch (_) { try { el.focus(); } catch (_2) {} }
  }

  function renderStep() {
    const host = $('#gate-card');
    if (!host) return;
    switch (state.step) {
      case 'start':    return renderStart(host);
      case 'login':    return renderLogin(host);
      case 'reg':      return renderReg(host);
      case 'confirm':  return renderConfirm(host);
      case 'forgot':   return renderForgot(host);
      case 'newpass':  return renderNewPass(host);
      case 'linkask':  return renderLinkAsk(host);
      case 'linkfail': return renderLinkFail(host);
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
    if (step !== state.step) { state.err = ''; state.errField = ''; state.errAction = ''; }
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
  function navMsg(step, msg, field, action) {
    state.step = step;
    state.err = msg;
    state.errField = field || '';
    state.errAction = action || '';
    render();
  }

  async function init() {
    if (!$('#gate-card') || !AC || !OC) return;

    /* Найперше — підняти набране до перезавантаження. Профіль, який
       приїде нижче, сильніший: loadDraft заповнює лише порожні поля. */
    const draft = loadDraft();

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
      try {
        fromLink = await window.Store.adoptUrlSession({
          /*
           * Лист відкрили не в тому браузері, з якого його замовляли, або
           * поверх уже відкритого акаунта. Це буває чесно (пошта на іншому
           * пристрої), але саме цією дірою чуже посилання садило людину в
           * чужий акаунт (WEB-001). Тому питаємо — і показуємо пошту, у чий
           * саме акаунт іде вхід.
           */
          confirm: function (info) {
            return new Promise(function (resolve) {
              state.linkAsk = { email: info.email || '', type: info.type || '', resolve: resolve };
              state.step = 'linkask';
              render();
            });
          }
        });
      }
      catch (e) {
        state.err = (e && e.message) || '';
        /* Усе, що зветься link_*, — це одна й та сама ситуація для людини:
           лист є, а всередину не пустило. Їй потрібен вихід, а не рядок
           тексту на стартовому екрані (див. renderLinkFail). */
        if (/^link_/.test(String((e && e.code) || ''))) {
          state.linkAsk = null;
          state.step = 'linkfail';
          render();
          bind();
          return;
        }
      }

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
        /* Сесії немає. Якщо акаунт уже створено і ми чекали лист —
           повертаємо той самий екран, а не стартовий: інакше людина
           бачить «Get Stronger» і вирішує, що реєстрація не зберіглася. */
        state.step = (draft && draft.stage === 'confirm' && state.acc.email) ? 'confirm' : 'start';
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

    bind();
  }

  /*
   * Обробники екрана. Окремо від init() навмисно: гілка «посилання з
   * листа не спрацювало» виходить із init() раніше, і без цього виклику
   * її кнопки були б мертві.
   */
  let bound = false;
  function bind() {
    if (bound) return;
    const host = $('#gate-card');
    if (!host) return;
    bound = true;

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
