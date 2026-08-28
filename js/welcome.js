/**
 * Перші екрани Forge: вік (18+) і базові дані тіла.
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
    step: 'age',
    dob: { d: '', m: '', y: '' },
    birth: '',
    body: { sex: null, weight: '', height: '', activity: '', trainingAge: '', hrRest: '', hrMax: '' },
    busy: false
  };

  /* ------------------------------------------------------------------ */
  /* Крок 1: вік                                                         */
  /* ------------------------------------------------------------------ */

  function messageFor(g) {
    if (g.state === 'invalid') {
      return '<p class="gate__msg gate__msg--err" role="alert">' +
        'Перевір дату: вона має бути справжньою й не з майбутнього.</p>';
    }
    if (g.state === 'minor') {
      /*
       * Текст під забороною — не докір, а пояснення. Він має відповісти на
       * питання «чому», інакше єдиний висновок, який робить людина, — що
       * треба вписати іншу дату.
       */
      return '' +
        '<div class="gate__msg gate__msg--block" role="alert">' +
          '<p class="gate__msg-title">Forge доступний лише користувачам віком від 18 років.</p>' +
          '<p class="small mb-0">Платформа та її тренувальні програми розроблені для ' +
            'повнолітніх користувачів віком 18 років і старше.</p>' +
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
      '<h1 class="gate__title">Вкажіть вашу дату народження</h1>' +

      '<div class="field mt-2">' +
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

      '<button class="btn btn--primary btn--wide mt-2" type="button" id="body-go"' +
        (canGo ? '' : ' disabled') + '>Далі — обрати програму</button>' +

      '<p class="small muted gate__note" id="body-note">' +
        (canGo ? 'Крок 2 з 3. Далі: програма тренувань і робоча вага.' : '') +
      '</p>';
  }

  /* Точкове оновлення замість повного render(): перемальовка на кожну
     цифру вибивала б фокус із поля, у яке людина зараз вписує. */
  function syncBodyControls() {
    const go = $('#body-go');
    const note = $('#body-note');
    const canGo = bodyReady();
    if (go) go.disabled = !canGo;
    if (note) {
      note.textContent = canGo
        ? 'Крок 2 з 3. Далі: програма тренувань і робоча вага.'
        : '';
    }
  }

  async function proceedBody() {
    if (state.busy) return;
    if (!bodyReady()) { syncBodyControls(); return; }

    state.busy = true;
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
      location.replace(NEXT);
    } catch (e) {
      if (e && e.queued) { location.replace(NEXT); return; }
      state.busy = false;
      window.App.toast('Не збереглося: ' + (e && e.message), 'err');
    }
  }

  /* ------------------------------------------------------------------ */

  function render() {
    const host = $('#gate-card');
    if (!host) return;
    if (state.step === 'body') renderBody(host);
    else renderAge(host);
  }

  async function init() {
    if (!$('#gate-card') || !AC || !OC) return;

    /*
     * Профіль уже може бути частково заповнений: людина повернулась
     * «назад» або перезавантажила сторінку посеред кроку. Показуємо
     * рівно той крок, що виводиться з даних, — і з даними в полях.
     */
    let p = {};
    try { p = await window.Store.getProfile() || {}; } catch (_) {}
    if (typeof p.birthDate === 'string') {
      state.birth = p.birthDate;
      state.dob = birthToDob(p.birthDate);
    }
    ['sex', 'trainingAge'].forEach(function (k) { if (p[k]) state.body[k] = p[k]; });
    ['weight', 'height', 'activity', 'hrRest', 'hrMax'].forEach(function (k) {
      if (p[k] !== null && p[k] !== undefined) state.body[k] = String(p[k]);
    });

    const step = OC.stepFor(p);
    /* Тим, хто вже далі, тут робити нічого — сторож каже те саме. */
    if (step === 'program') { location.replace(NEXT); return; }
    if (step === 'done') { location.replace(HOME); return; }
    state.step = step;

    render();

    const host = $('#gate-card');

    /** Наступне/попереднє поле дати — для автопереходу. */
    function dobNeighbour(key, dir) {
      const i = DOB_PARTS.findIndex(function (p) { return p.k === key; });
      const n = DOB_PARTS[i + dir];
      return n ? $('#dob-' + n.k) : null;
    }

    host.addEventListener('input', function (e) {
      const t = e.target;
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
      if (e.target.closest('#gate-go')) proceedAge();
      if (e.target.closest('#body-go')) proceedBody();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
