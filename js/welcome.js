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

  const state = {
    step: 'age',
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

  function renderAge(host) {
    const g = AC.gateState(state.birth);
    const canGo = g.state === 'adult';

    host.innerHTML = '' +
      '<h1 class="gate__title">Вкажіть вашу дату народження</h1>' +
      '<p class="small muted gate__lead">Forge доступний користувачам віком від 18 років. ' +
        'Дата зберігається лише на цьому пристрої.</p>' +

      '<div class="field mt-2">' +
        '<label class="field__label" for="gate-date">Дата народження</label>' +
        '<input class="input" id="gate-date" type="date" ' +
          'value="' + esc(state.birth) + '" ' +
          /* max — рівно 18 років тому: рідний вибір дати сам не дасть
             поставити пізнішу, тож більшість людей до заборони й не
             дійде. Перевірку це не замінює — лише прибирає зайвий крок. */
          'max="' + esc(AC.latestAdultBirthDate()) + '" ' +
          'min="1900-01-01" ' +
          'autocomplete="bday" ' +
          'aria-describedby="gate-note">' +
      '</div>' +

      messageFor(g) +

      '<button class="btn btn--primary btn--wide mt-2" type="button" id="gate-go"' +
        (canGo ? '' : ' disabled') + '>Продовжити</button>' +

      '<p class="small muted gate__note" id="gate-note">' +
        (g.state === 'adult'
          ? 'Вік: ' + g.age + ' ' + window.App.plural(g.age, 'рік', 'роки', 'років') + '.'
          : 'Кнопка стане активною, коли дата підтвердить вік 18+.') +
      '</p>';
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
    const first = $('#b-weight');
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

      numField('b-weight', 'weight', 'Вага тіла, кг', '', { min: 30, max: 300, step: 0.1, ph: '0' }) +
      numField('b-height', 'height', 'Зріст, см', '', { min: 120, max: 250, ph: '0' }) +

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
        '<p class="small muted" style="margin:6px 0 0">Найбільше джерело похибки. Сумніваєшся — бери нижчий.</p>' +
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
        '<p class="small muted" style="margin:6px 0 0">Від нього залежать діапазони повторень у плані.</p>' +
      '</div>' +

      numField('b-hrrest', 'hrRest', 'Пульс спокою', 'Виміряний одразу після пробудження, лежачи. Без нього зони пульсу рахуються від віку.', { min: 30, max: 120, ph: 'Необовʼязково' }) +
      numField('b-hrmax', 'hrMax', 'Максимальний пульс', 'Якщо не вказати — рахується за віком (208 − 0,7 × вік).', { min: 120, max: 230, ph: 'Необовʼязково' }) +

      '<button class="btn btn--primary btn--wide mt-2" type="button" id="body-go"' +
        (canGo ? '' : ' disabled') + '>Далі — обрати програму</button>' +

      '<p class="small muted gate__note" id="body-note">' +
        (canGo ? 'Крок 2 з 3. Далі: програма тренувань і робоча вага.'
               : 'Обовʼязкові всі поля, крім пульсів.') +
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
        : 'Обовʼязкові всі поля, крім пульсів.';
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
    if (typeof p.birthDate === 'string') state.birth = p.birthDate;
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
    host.addEventListener('input', function (e) {
      const t = e.target;
      if (t.closest('#gate-date')) {
        state.birth = t.value;
        render();
        /* Перемальовка забирає фокус із поля — повертаємо, інакше вибір
           дати на телефоні закривав би клавіатуру після кожної цифри. */
        const el = $('#gate-date');
        if (el) el.focus();
        return;
      }
      const b = t.closest('[data-b]');
      if (b) { state.body[b.dataset.b] = b.value; syncBodyControls(); }
    });
    host.addEventListener('change', function (e) {
      const t = e.target;
      if (t.closest('#gate-date')) { state.birth = t.value; render(); return; }
      if (t.name === 'b-sex') { state.body.sex = t.value; syncBodyControls(); return; }
      const b = t.closest('[data-b]');
      if (b) { state.body[b.dataset.b] = b.value; syncBodyControls(); }
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
