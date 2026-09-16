/**
 * Сторінка програм: вибір схеми, редагування плану, тижневий обʼєм.
 *
 * Ніякого ранжування й порад: користувач ставить кількість днів, бачить
 * доступні схеми та їх фактичні характеристики і сам обирає потрібну.
 *
 * План можна правити: міняти вправи місцями, замінювати на іншу з тієї ж
 * групи мʼязів, змінювати кількість підходів, видаляти й додавати вправи.
 * Таблиця обʼєму перераховується після кожної правки — прибрав передпліччя,
 * і рядок «Передпліччя» зник із тижневого підсумку.
 *
 * Змінений план зберігається в профіль ЦІЛКОМ (а не як набір відмінностей).
 * Компроміс: якщо базова програма в programs-data.js колись зміниться,
 * збережений план цього не підхопить. Натомість поведінка передбачувана,
 * і завжди є кнопка «Скинути до оригіналу».
 */
(function () {
  'use strict';

  const { $, $$, esc, clamp, toast, plural, dateLabel } = window.App;
  const ALL_PROGRAMS = window.PROGRAMS || [];

  /*
   * СХЕМИ, ДОСТУПНІ ЦІЙ ЛЮДИНІ.
   *
   * Реєстр window.PROGRAMS сирий — у ньому лежать і чоловічі, і жіночі
   * схеми. Уся сторінка працює ТІЛЬКИ з цим зрізом: і сітка вибору, і
   * пошук за id, і крок онбордингу. Якби фільтр стояв лише в розмітці,
   * схема чужої статі лишалась би доступною через збережений state,
   * прямий перехід на plan.html або старий activePlan у профілі.
   *
   * Функція, а не константа: стать читається з профілю, який приїжджає
   * асинхронно, і міняється в налаштуваннях без перезавантаження.
   */
  function PROGRAMS_FOR_ME() {
    const f = window.programsForSex;
    const sex = state.profile && state.profile.sex;
    return typeof f === 'function' ? f(sex, ALL_PROGRAMS) : ALL_PROGRAMS;
  }
  const MUSCLES = window.MUSCLES || [];
  const musclesOfExercise = window.musclesOfExercise;
  const primaryMuscle = window.primaryMuscle;
  const exercisesForMuscles = window.exercisesForMuscles;

  /* ------------------------------------------------------------------ */
  /* Характеристики варіанта                                             */
  /* ------------------------------------------------------------------ */

  function supports(program, days) {
    return Object.prototype.hasOwnProperty.call(program.days, String(days));
  }

  /**
   * Частота тренування групи мʼязів. Береться з даних, а не рахується
   * з кількості днів: у несиметричних splitʼах різні групи мають різну
   * частоту, і формула тут збрехала б.
   */
  function frequencyOf(program, days) {
    const f = (program.frequency || {})[String(days)];
    if (!f) return { min: 0, max: 0, note: '—', label: '—' };
    return Object.assign({}, f, {
      label: f.min === f.max ? f.min + '×' : f.min + '–' + f.max + '×'
    });
  }

  function weeklySets(plan) {
    return plan.reduce(function (sum, day) {
      return sum + day.exercises.reduce(function (s, ex) { return s + (Number(ex.sets) || 0); }, 0);
    }, 0);
  }

  /* Скільки секунд триває сам підхід. Робочий сет на 6–12 повторень —
     це 25–45 секунд під навантаженням плюс підхід до снаряда. */
  const SET_WORK_SEC = 40;

  /* Розминка перед тренуванням із загального блоку */
  const WARMUP_MIN = 10;

  /**
   * Відпочинок після вправи: 3 хв для великих мʼязових груп, 2 хв для малих.
   *
   * Правило замінило рядки з даних плану («2–3 хв», «90 с»…): діапазон
   * щоразу змушував вирішувати на місці, а рішення вже ухвалене — великим
   * групам потрібне повне відновлення, малі відновлюються швидше.
   * Дані в programs-data.js не чіпаються: правило накладається при показі,
   * копіюванні й підрахунку тривалості.
   *
   * Виняток — кругові блоки («—»): там відпочинку між вправами немає
   * за задумом, лише перехід.
   *
   * @returns {'3 хв'|'2 хв'|'—'}
   */
  function restFor(ex) {
    if (String(ex && ex.rest || '').trim() === '—') return '—';

    /*
     * Вирішує ТИП вправи, а не розмір групи.
     *
     * Раніше правило дивилось на size групи, і «Розгинання ніг» отримувало
     * 3 хвилини лише тому, що квадрицепс позначений як large. Обґрунтування
     * «великим групам потрібне повне відновлення» до односуглобової ізоляції
     * не застосовне: там ліміт — локальна втома, а не системна. Через це
     * оцінка fullbody-3 виходила 116 хв на сесію.
     *
     * Поле lift уже є в бібліотеці й уже читається періодизацією.
     */
    if (window.liftKind(ex || {}) !== 'compound') return '2 хв';

    const main = primaryMuscle(ex || {});
    const m = MUSCLES.find(function (x) { return x.id === main; });
    return (m && m.size === 'large') ? '3 хв' : '2 хв';
  }

  /** Секунди відпочинку за тим самим правилом (для таймера й тривалості) */
  function restSecFor(ex) {
    const r = restFor(ex);
    return r === '—' ? 20 : (r === '3 хв' ? 180 : 120);
  }

  /**
   * Оцінка тривалості одного дня, хвилин.
   *
   * Джерело правди — WorkoutCore.dayMinutes: те саме число бачить людина
   * і тут, і на екрані тренування як «залишилось». Локальна формула
   * лишається запасним виходом на випадок, якщо ядро не завантажилось,
   * і зобовʼязана давати ті самі числа (спільні константи).
   */
  function dayMinutes(day) {
    if (window.WorkoutCore && window.WorkoutCore.dayMinutes) {
      return window.WorkoutCore.dayMinutes(day);
    }
    // Після ОСТАННЬОГО підходу дня ніхто не відпочиває — він іде додому.
    let sec = 0, lastRest = 0;
    day.exercises.forEach(function (ex) {
      const sets = Number(ex.sets) || 0;
      if (!sets) return;
      const rest = restSecFor(ex);
      sec += sets * (SET_WORK_SEC + rest);
      lastRest = rest;
    });
    return Math.round(Math.max(0, sec - lastRest) / 60) + WARMUP_MIN;
  }

  /** Середня тривалість сесії по програмі, хвилин */
  function sessionMinutes(plan) {
    if (!plan.length) return 0;
    const total = plan.reduce(function (t, d) { return t + dayMinutes(d); }, 0);
    return Math.round(total / plan.length);
  }

  /* ------------------------------------------------------------------ */
  /* Тижневий обʼєм по групах мʼязів                                     */
  /* ------------------------------------------------------------------ */

  /**
   * @returns {{rows: Array, untagged: number}} рядки лише для груп,
   * які реально навантажуються поточним планом
   */
  function weeklyVolume(plan) {
    const totals = Object.create(null);
    let untagged = 0;

    plan.forEach(function (day) {
      day.exercises.forEach(function (ex) {
        const sets = Number(ex.sets) || 0;
        // Тільки ГОЛОВНА група. Раніше тут стояв ms.forEach по всіх групах,
        // і кожна складена вправа зараховувалась двічі — числа були завищені,
        // а редактор на них ще й забороняв те, що в межу вкладалось.
        const main = primaryMuscle(ex);
        if (!main) { untagged += sets; return; }
        totals[main] = (totals[main] || 0) + sets;
      });
    });

    const rows = MUSCLES
      .filter(function (m) { return totals[m.id]; })
      .map(function (m) {
        const sets = totals[m.id];
        // Стан визначається однією величиною — стелею. «Оптимуму» тут немає
        // навмисно: він читався як норма, якої треба досягти, хоча насправді
        // існує лише межа, вище якої не варто.
        let state, label;
        if (sets > m.cap)       { state = 'over'; label = 'вище межі'; }
        else if (sets === m.cap) { state = 'full'; label = 'на межі'; }
        else                     { state = 'ok';   label = 'у межах'; }
        return {
          id: m.id, name: m.name, size: m.size, region: m.region || '',
          sets: sets, cap: m.cap,
          state: state, label: label
        };
      });

    return { rows: rows, untagged: untagged };
  }

  function volumeBlock(plan) {
    const v = weeklyVolume(plan);
    if (!v.rows.length) return '';

    const over = v.rows.filter(function (r) { return r.state === 'over'; });

    const bars = v.rows.map(function (r, i) {
      // Шкала завжди до межі: повна смуга = стеля. Так видно саме те,
      // що потрібно, — скільки ще лишилось запасу.
      const scale = Math.max(r.cap, r.sets);
      const fill = r.sets / scale * 100;
      return '' +
        /* Регіон іде класом, а не стилем: відтінок належить темі, а не
           цьому рядку розмітки. Стани (на межі, вище межі) фарбують смугу
           поверх регіону — перебір важливіший за те, який це мʼяз. */
        /* --i — номер рядка. З нього CSS рахує затримку появи, тож
           список проявляється хвилею зверху вниз, а не стрибком. */
        '<div class="vol vol--' + r.state +
          (r.region ? ' vol--r-' + r.region : '') +
          '" style="--i:' + i + '" title="' + esc(r.label) + '">' +
          '<span class="vol__name">' + esc(r.name) + '</span>' +
          '<span class="vol__bar"><i style="width:' + fill + '%"></i></span>' +
          '<span class="vol__num mono">' + r.sets +
            '<span class="vol__target">/' + r.cap + '</span>' +
          '</span>' +
        '</div>';
    }).join('');

    return '' +
      '<hr class="divider">' +
      '<h3 style="margin-bottom:4px">Підходів на тиждень по групах мʼязів</h3>' +
      '<p class="small muted" style="margin-bottom:6px">' +
        'Рахується з поточного плану. Видалите вправу — група зникне або впаде в цьому підсумку.' +
      '</p>' +
      '<p class="small muted" style="margin-bottom:18px">' +
        'Числа праворуч: <b>факт / межа</b>. Повна смуга = стеля тижневого обʼєму: ' +
        'велика група — ' + window.VOLUME_CAP.large + ' робочих підходів, мала — ' + window.VOLUME_CAP.small + '. ' +
        'Більше редактор поставити не дасть.' +
      '</p>' +
      '<div class="vol-list">' + bars + '</div>' +

      (over.length
        ? '<div class="notice mt-2">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
            '<div>Вище верхньої межі: ' +
            over.map(function (r) { return '<b>' + esc(r.name) + '</b> ' + r.sets + ' при межі ' + r.cap; }).join(', ') +
            '. Приберіть зайві підходи або перенесіть їх на групу, що недобирає.</div>' +
          '</div>'
        : '') +



      (v.untagged
        ? '<p class="small muted mt-1">' + v.untagged + ' підходів не віднесено до жодної групи — ' +
          'у цих вправ не задано <code>muscles</code> і не розпізнано рухову модель.</p>'
        : '');
  }

  /* ------------------------------------------------------------------ */
  /* Стан сторінки                                                       */
  /* ------------------------------------------------------------------ */

  const state = {
    /* На якій сторінці ми працюємо:
       'picker' — programs.html: є перемикач днів і список схем;
       'mine'   — plan.html: схема вже обрана, показуємо тільки її. */
    mode: 'picker',
    days: 3,
    programId: null,
    plan: null,        // робоча копія плану (можливо, відредагована)
    editing: false,
    active: null,     // обраний робочий план: { programId, days }
    custom: {},       // збережені правки планів
    weights: {},      // робочі ваги за назвою вправи, спільні для всього сайту
    weightLog: {},    // історія цих ваг (append-only; js/history-core.js)
    /* Скільки розминкових підходів у вправи — теж книга по назві, як і
       ваги: вправа одна, отже й сходинки до неї одні. Порожньо означає
       «як вирішує сайт» (js/workout-core.js), а не нуль. */
    warmups: {},
    /* Останнє скидання ваг: { percent, at, before }.
       before — повний знімок книги ваг ДО скидання. Саме знімок, а не
       відсоток: зворотне множення після округлення до 2,5 кг не повертає
       вихідне число (100 → −15% → 85 → +15% → 97,75 → 97,5). */
    deload: null,

    // Останній відомий профіль: стать і стаж для підбору діапазонів
    // повторень, свої вправи, книга ваг.
    profile: {},

    /* Чи вмикати ноги в загальний крок ±2,5 кг.
       Живе тільки в памʼяті й не зберігається в профіль навмисно: галочка
       має бути знята при кожному заході. Дія разова, і «залипла» з минулого
       тижня вона мовчки поміняла б ваги не там, де очікуєш. */
    bumpLegs: false
  };

  const planKey = function (programId, days) { return programId + ':' + days; };

  /* ------------------------------------------------------------------ */
  /* Книга робочих ваг                                                   */
  /* ------------------------------------------------------------------ */
  /*
   * Вага прив'язана до НАЗВИ вправи, а не до її місця в плані.
   * Жим лежачи важить однаково і в понеділок, і в четвер, і в іншій
   * програмі — тримати для цього три окремі поля означало б змушувати
   * вписувати те саме число щоразу й ловити розбіжності руками.
   *
   * Тому в плані ваги НЕ зберігаються: план описує вправи, підходи
   * й повторення, а вага живе окремо в profile.weights.
   */

  /** Робоча вага вправи або null, якщо ще не задана */
  function weightOf(ex) {
    if (!ex || !ex.name) return null;
    const w = state.weights[ex.name];
    return Number.isFinite(Number(w)) && w !== null && w !== '' ? Number(w) : null;
  }

  /** Записати вагу вправи. null стирає запис.
      Кожна реальна зміна лягає і в історію (weightLog): поточне значення
      живе у weights, а ШЛЯХ до нього — у журналі. Стирання ваги історію
      не чіпає: видалена з плану вправа не скасовує того, що було піднято. */
  function setWeight(name, value) {
    if (!name) return;
    if (value === null) { delete state.weights[name]; return; }
    state.weights[name] = value;
    logWeight(name, value);
  }

  /** Додати запис в історію ваг (append-only; той самий день — заміна) */
  function logWeight(name, kg) {
    if (!window.HistoryCore) return;
    state.weightLog = window.HistoryCore.appendWeight(state.weightLog, name, kg);
  }

  /**
   * Копія плану з підставленими вагами.
   * Назовні (прогноз, експорт) план віддається вже «зібраним», щоб решта
   * коду не знала про книгу ваг і працювала зі звичним ex.weight.
   */
  function hydrate(plan) {
    return plan.map(function (day) {
      return Object.assign({}, day, {
        exercises: day.exercises.map(function (ex) {
          return Object.assign({}, ex, { weight: weightOf(ex) });
        })
      });
    });
  }

  /**
   * Перенести ваги зі старих збережених планів у книгу.
   * Потрібно рівно один раз: до цієї версії вага лежала всередині плану.
   * Якщо та сама вправа мала різні ваги в різних днях — лишаємо більшу,
   * бо саме вона є робочою межею.
   */
  function harvestWeights(plans) {
    let moved = 0;
    Object.keys(plans || {}).forEach(function (key) {
      (plans[key] || []).forEach(function (day) {
        (day.exercises || []).forEach(function (ex) {
          const w = Number(ex.weight);
          if (!ex.name || !Number.isFinite(w) || w <= 0) return;
          if (!(ex.name in state.weights) || w > state.weights[ex.name]) {
            state.weights[ex.name] = w;
            moved++;
          }
        });
      });
    });
    return moved;
  }



  /**
   * Глибока копія плану — редагуємо копію, не чіпаючи довідник.
   * Копіюємо день цілком (Object.assign), а не перелічуємо поля руками:
   * інакше кожне нове поле дня — як circuit чи focus — мовчки губилося б
   * після першої ж правки плану.
   */
  function clonePlan(plan) {
    return plan.map(function (day) {
      return Object.assign({}, day, {
        exercises: day.exercises.map(function (ex) { return Object.assign({}, ex); })
      });
    });
  }

  function basePlan(programId, days) {
    const p = PROGRAMS_FOR_ME().find(function (x) { return x.id === programId; });
    if (!p || !supports(p, days)) return null;
    return clonePlan(p.days[String(days)]);
  }

  /* Діапазони повторень — похідне від стажу (js/reps-core.js), єдине
     джерело правди для всіх чотирьох програм. Застосовується і до
     збережених правок (customPlans): reps у них могли бути пораховані
     за старим стажем. */
  function withReps(plan) {
    const RC = window.RepsCore;
    if (!RC || !plan) return plan;
    return RC.applyPlan(plan, state.profile && state.profile.trainingAge);
  }

  function loadPlan(programId, days) {
    const saved = state.custom[planKey(programId, days)];
    return withReps(saved ? clonePlan(saved) : basePlan(programId, days));
  }

  /*
   * Власний запис у профіль. Store.onChange не розрізняє, хто саме змінив
   * профіль, тож наше ж збереження поверталось сюди подією і тягло за
   * собою повну перемальовку сторінки, з якою в цю мить працюють. Сторінка
   * вже показала результат сама (state змінено до запису), тож дублювати
   * його перемальовкою не треба. Вікно тримаємо коротким: справжня зміна
   * з іншого пристрою приходить пізніше й перемальовку отримає.
   */
  const SELF_WRITE_MS = 1200;
  let lastSelfWrite = 0;

  /** Зберегти профіль і позначити запис як власний. Усі збереження цієї
      сторінки йдуть через неї — інакше сторож вище не спрацює. */
  function saveOwn(patch) {
    lastSelfWrite = Date.now();
    return window.Store.saveProfile(patch);
  }

  async function persistPlan() {
    if (!state.programId || !state.plan) return;

    // У плані ваги не зберігаємо: єдине джерело правди — книга ваг.
    // Інакше та сама вправа мала б два різні числа в різних місцях.
    state.custom[planKey(state.programId, state.days)] =
      clonePlan(state.plan).map(function (day) {
        return Object.assign({}, day, {
          exercises: day.exercises.map(function (ex) {
            const copy = Object.assign({}, ex);
            delete copy.weight;
            return copy;
          })
        });
      });

    const patch = {
      customPlans: state.custom,
      weights: state.weights,
      weightLog: state.weightLog,
      warmups: state.warmups
    };
    try {
      await saveOwn(patch);
    } catch (e) {
      toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err');
    }
    announce();
  }

  /**
   * Сповіщає сторінку, що план змінився. Прогноз слухає цю подію й
   * перераховується. Через подію, а не прямий виклик, щоб programs.js
   * не залежав від наявності projection.js — на programs.html його немає.
   */
  function announce() {
    document.dispatchEvent(new CustomEvent('plan:change'));
  }

  /** Читання поточного стану ззовні (використовує js/projection.js) */
  window.PlanEngine = {
    current: function () {
      return {
        programId: state.programId,
        days: state.days,
        program: PROGRAMS_FOR_ME().find(function (p) { return p.id === state.programId; }) || null,
        plan: state.plan ? hydrate(state.plan) : null
      };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Крок робочої ваги                                                   */
  /* ------------------------------------------------------------------ */
  /*
   * Підняти або опустити всю книгу ваг на крок. Це щоденна дія: закрив
   * діапазон повторень — додав 2,5 кг і пішов далі. Перебирати два десятки
   * полів руками заради цього безглуздо.
   *
   * Ноги окремо, бо крок у них інший. Присід і жим ногами тягнуть +5 кг
   * там, де жим лежачи тягне +2,5: м'язова маса більша, і відносний приріст
   * від тих самих 2,5 кг менший. Це практична конвенція силових програм,
   * а не висновок дослідження.
   *
   * Тому кнопка «+2,5» за замовчуванням ноги НЕ чіпає — для них є своя
   * «+5». Галочка поруч вмикає ноги в загальний крок, якщо цього тижня
   * п'ятірка завелика.
   */

  /* Групи, які вважаємо ногами. Литки сюди входять: крок у них теж
     більший за верх тіла, хоч і не завжди 5 кг. */
  const LEG_MUSCLES = ['quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'calves'];

  /**
   * Чи це вправа на ноги — за назвою, бо книга ваг ключується назвами.
   *
   * Вправи, доданої в бібліотеку, може й не бути: у книзі лишаються назви
   * зі старих планів. Такі вважаємо не-ногами — промах у цей бік означає
   * лише те, що вправа не отримає +5, і це помітно одразу.
   */
  function isLegExercise(name) {
    const ex = (window.EXERCISES || []).find(function (e) { return e.name === name; });
    if (!ex) return false;
    return musclesOfExercise(ex).some(function (m) { return LEG_MUSCLES.indexOf(m) !== -1; });
  }

  /** Скільки ваг у книзі підпадає під крок */
  function countFor(legs) {
    return Object.keys(state.weights).filter(function (name) {
      const w = Number(state.weights[name]);
      if (!Number.isFinite(w) || w <= 0) return false;
      return legs === null ? true : (isLegExercise(name) === legs);
    }).length;
  }

  /**
   * Додати delta до ваг книги.
   *
   * @param {number} delta        на скільки кг, може бути відʼємним
   * @param {'legs'|'other'|'all'} scope які вправи чіпати
   */
  async function bumpWeights(delta, scope) {
    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) return;

    let changed = 0;
    Object.keys(state.weights).forEach(function (name) {
      const w = Number(state.weights[name]);
      if (!Number.isFinite(w) || w <= 0) return;

      const legs = isLegExercise(name);
      if (scope === 'legs' && !legs) return;
      if (scope === 'other' && legs) return;

      // Мінімум 1 кг: нуль у книзі читається як «не заповнено», і крок
      // униз не повинен стирати вправу з плану.
      const next = Math.max(1, Math.round((w + d) * 2) / 2);
      if (next !== w) { state.weights[name] = next; logWeight(name, next); changed++; }
    });

    if (!changed) { toast('Нема яких ваг міняти', 'err'); return; }

    /*
     * Крок вгору «зʼїдає» знімок скидання.
     *
     * Інакше виходить пастка: захворів → скинув на 10% → одужав →
     * три тижні піднімав ваги → натиснув «повернути як було» і втратив
     * усю прогресію, бо знімок описує стан ДО хвороби. Перевірено:
     * біцепс 25 → 22,5 → 30 → знову 25.
     *
     * «Повернути» означає «відкотити щойно зроблене скидання», а не
     * «перемотати на довільну точку в минулому». Щойно ти рушив далі —
     * відкочувати вже нема чого, і кнопка зникає.
     */
    const hadDeload = Boolean(state.deload);
    if (hadDeload) state.deload = null;

    // Одним записом, а не двома: окремий saveProfile({deload:null}) міг би
    // пройти, а наступний із вагами — впасти, і в профілі лишився б стан,
    // якого користувач не робив: знімка вже немає, а ваги старі.
    await saveWeights(hadDeload ? { deload: null } : null);
    refresh();
    toast((d > 0 ? '+' : '−') + Math.abs(d) + ' кг у ' + changed + ' ' +
          plural(changed, 'вправі', 'вправах', 'вправах'), 'ok');
  }

  function progressBlock() {
    if (state.mode !== 'mine') return '';

    const other = countFor(false);
    const legs = countFor(true);
    if (!other && !legs) return '';

    const withLegs = Boolean(state.bumpLegs);

    return '' +
      '<div class="row" style="justify-content:space-between;align-items:baseline;gap:12px">' +
        '<h3 style="margin:0">Крок робочої ваги</h3>' +
        '<span class="small muted">' + other + ' зверху · ' + legs + ' на ноги</span>' +
      '</div>' +

      '<div class="row mt-2" style="gap:10px;flex-wrap:wrap">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-bump="-2.5">−2,5 кг</button>' +
        '<button class="btn btn--primary btn--sm" type="button" data-bump="2.5">+2,5 кг</button>' +
        '<label class="check">' +
          '<input type="checkbox" id="bump-legs"' + (withLegs ? ' checked' : '') + '>' +
          '<span>і на ноги теж</span>' +
        '</label>' +
        '<span class="small muted" style="flex-basis:100%;margin:0"></span>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-bump-legs="-5">−5 кг на ноги</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-bump-legs="5">+5 кг на ноги</button>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Скидання робочих ваг                                                */
  /* ------------------------------------------------------------------ */
  /*
   * Після хвороби, відпустки чи будь-якої перерви попередні робочі ваги
   * стають недосяжними, і починати з них — це або зірваний підхід, або
   * травма. Класичний вихід — зайти нижче й підійти назад за кілька тижнів.
   *
   * Скидання множить УСЮ книгу ваг на один коефіцієнт. Одна дія на всі
   * вправи, а не перебирання кожної руками: після двох тижнів без залу
   * просідає все одразу, а не окремо жим.
   *
   * Скільки саме віднімати — залежить від довжини перерви, і ніякої точної
   * формули для цього немає. Орієнтир на сторінці, вибір за тобою.
   */

  /**
   * Скидання — необовʼязкова частина сторінки, і воно живе в окремому
   * файлі (js/periodization-core.js). Якщо його не підключили або він не
   * завантажився, план має відрендеритись без цього блоку, а не впасти
   * цілком: решта сторінки від деслоуду не залежить ніяк.
   */
  function hasDeload() {
    return Boolean(window.Periodization && window.Periodization.applyDeload);
  }

  /** Скільки ваг у книзі реально заповнено */
  function filledWeights() {
    return Object.keys(state.weights).filter(function (k) {
      const w = Number(state.weights[k]);
      return Number.isFinite(w) && w > 0;
    }).length;
  }

  async function saveWeights(patch) {
    const extra = Object.assign({}, patch || {});
    // Знімок скидання ваг протух через ручне редагування — записуємо це
    // тим самим збереженням, що й самі ваги, щоб не робити другий запит
    // і не лишати вікна, у якому кнопка «Повернути як було» ще активна.
    if (state.deloadDirty && !('deload' in extra)) {
      extra.deload = null;
      state.deloadDirty = false;
    }
    const full = Object.assign({ weights: state.weights, weightLog: state.weightLog }, extra);
    try {
      await saveOwn(full);
    } catch (e) {
      toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err');
    }
    updateOnboardBanner();
    announce();
  }

  /** Опустити всі ваги на percent відсотків, запамʼятавши знімок «до» */
  async function doDeload(percent) {
    const p = Number(percent);
    if (!hasDeload() || !Number.isFinite(p) || p <= 0) return;
    if (!filledWeights()) { toast('Книга ваг порожня — нема чого скидати', 'err'); return; }

    // Знімок беремо ДО скидання і тільки якщо його ще немає: два скидання
    // поспіль не повинні затерти справжній вихідний стан другим, уже
    // зменшеним. Інакше «повернути» відновило б не ті числа.
    const before = (state.deload && state.deload.before) || Object.assign({}, state.weights);

    state.weights = window.Periodization.applyDeload(state.weights, p);
    // Скидання — теж подія в історії: без цих записів графік ваги вправи
    // показував би «100 → 105», хоча між ними був місяць на 90.
    Object.keys(state.weights).forEach(function (n) { logWeight(n, Number(state.weights[n])); });
    state.deload = { percent: p, at: new Date().toISOString(), before: before };

    await saveWeights({ deload: state.deload });
    refresh();
    toast('Ваги знижено на ' + p + '%', 'ok');
  }

  /** Повернути ваги до знімка «до скидання» */
  /**
   * Знімок скидання ваг більше не чинний.
   *
   * Кнопки ±кг і «+10%» знімок зʼїдали, а поле вводу ваги — ні. Через це
   * сценарій «скинув −10%, за три тижні відпрацював 80 -> 85 руками» лишав
   * кнопку «Повернути як було» активною, і вона повертала 80, стираючи
   * зароблені 5 кг — при тому що обіцяла «точні числа, які були до цього».
   * Будь-яке ручне редагування ваги означає, що «до цього» вже не існує.
   */
  function invalidateDeload() {
    if (!state.deload) return;
    state.deload = null;
    // Збереження зробить той самий persistPlan/saveWeights, що йде далі
    // за викликом applyEdit — окремий запис тут лише плодив би гонки.
    state.deloadDirty = true;
  }

  async function undoDeload() {
    if (!state.deload || !state.deload.before) return;
    /*
     * ЗЛИТТЯ, а не заміна.
     *
     * Було Object.assign({}, before) — повна підміна книги ваг знімком.
     * Через це вправа, додана вже ПІСЛЯ скидання, у знімку не значилась і
     * при поверненні втрачала вагу повністю: щойно вписані 30 кг просто
     * зникали, а вправа знову ставала «без ваги» й випадала з періодизації.
     * Знімок має повертати те, що в ньому є, і не чіпати решту.
     */
    state.weights = Object.assign({}, state.weights, state.deload.before);
    Object.keys(state.deload.before || {}).forEach(function (n) {
      logWeight(n, Number(state.deload.before[n]));
    });
    state.deload = null;
    await saveWeights({ deload: null });
    refresh();
    toast('Ваги повернуто', 'ok');
  }

  /**
   * Підняти всі ваги на percent відсотків.
   *
   * Зʼїдає знімок скидання, як і ручний прогрес (+2,5): після підйому
   * «повернути як було» відкотило б і зароблене, тому чесніше прибрати
   * кнопку, ніж лишити її з пасткою всередині.
   */
  async function doRaise(percent) {
    const p = Number(percent);
    if (!window.Periodization || !window.Periodization.applyRaise) return;
    if (!Number.isFinite(p) || p <= 0) return;
    if (!filledWeights()) { toast('Книга ваг порожня — нема чого піднімати', 'err'); return; }

    state.weights = window.Periodization.applyRaise(state.weights, p);
    Object.keys(state.weights).forEach(function (n) { logWeight(n, Number(state.weights[n])); });
    const hadDeload = Boolean(state.deload);
    if (hadDeload) state.deload = null;

    await saveWeights(hadDeload ? { deload: null } : null);
    refresh();
    toast('Ваги піднято на ' + p + '%', 'ok');
  }

  /**
   * Панель скидання. Тільки на «Моєму плані»: на сторінці програм книга ваг
   * не показується взагалі, і кнопка, яка мовчки міняє числа на іншій
   * сторінці, була б пасткою.
   */
  function deloadBlock() {
    if (state.mode !== 'mine' || !hasDeload()) return '';

    const filled = filledWeights();
    const d = state.deload;

    const options = window.Periodization.DELOAD_STEPS.map(function (p) {
      return '<option value="' + p + '"' + (p === 10 ? ' selected' : '') + '>−' + p + '%</option>';
    }).join('');

    return '' +
      '<div class="row" style="justify-content:space-between;align-items:baseline;gap:12px">' +
        '<h3 style="margin:0">Зниження робочої ваги у всіх вправах</h3>' +
        (d
          ? '<span class="chip">знижено на ' + d.percent + '%</span>'
          : '<span class="small muted">' + filled + ' ' + plural(filled, 'вага', 'ваги', 'ваг') + ' у книзі</span>') +
      '</div>' +

      '<p class="small muted mt-1">' +
        'Знижує робочу вагу в усіх вправах одразу — після хвороби, перерви ' +
        'або коли підходи перестали закриватись. Повернути можна одним кліком: ' +
        'числа «до» зберігаються. «Додати +10%» робить зворотне — піднімає ' +
        'всі ваги одразу, наприклад після повернення до нормальних тренувань.' +
      '</p>' +

      '<div class="row mt-2" style="gap:10px;align-items:center;flex-wrap:wrap">' +
        '<label class="small muted" for="deload-pct">Знизити на</label>' +
        '<select class="select select--sm" id="deload-pct" style="max-width:110px"' +
          (filled ? '' : ' disabled') + '>' + options + '</select>' +
        '<button class="btn btn--ghost btn--sm" type="button" id="deload-go"' +
          (filled ? '' : ' disabled') + '>Знизити ваги</button>' +
        (window.Periodization.applyRaise
          ? '<button class="btn btn--ghost btn--sm" type="button" id="deload-add"' +
            (filled ? '' : ' disabled') + '>Додати +10%</button>'
          : '') +
        (d
          ? '<button class="btn btn--ghost btn--sm" type="button" id="deload-undo">Повернути як було</button>'
          : '') +
      '</div>' +
      /* Причина вимкнення — текстом, а не тільки сірим кольором. Три
         вимкнені елементи поспіль без пояснення читаються як зламаний
         блок; сама умова («книга ваг порожня») уже є в коді нижче, але
         досі показувалась лише тим, хто примудрився натиснути. */
      (filled ? '' : '<p class="small muted" style="margin:8px 0 0">Спершу впишіть хоч одну робочу вагу у плані — скидати поки нічого.</p>') +

      (d
        ? '<p class="small muted mt-1">Скинуто ' + esc(dateLabel(d.at)) + '. ' +
          '«Повернути» відновить точні числа, які були до цього.</p>'
        : '') +

      '<div class="notice mt-2">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
        '<div class="small">' +
          'Скільки знімати — питання без точної відповіді. Груба прикидка: ' +
          'тиждень без залу — зазвичай нічого не треба, 2–3 тижні — 5–10%, ' +
          'місяць — 10–20%, від двох місяців — 20–30%, після хвороби з ліжковим ' +
          'режимом — більше. Це орієнтир із практики, а не висновок дослідження: ' +
          'швидкість втрати залежить від стажу, віку й причини перерви. ' +
          'Краще зайти нижче, ніж треба, і повернутись за два тижні, ніж зірвати підхід.' +
        '</div>' +
      '</div>';
  }

  /**
   * Ваги — це налаштування, а не щоденна дія: кроком ваги й зниженням
   * користуються раз на тиждень або раз на місяць. Тримати два блоки
   * кнопок постійно розгорнутими на сторінці плану означає щодня гортати
   * повз них. Тому — один згорнутий акордеон; за замовчуванням закритий.
   */
  function weightsAcc() {
    const prog = progressBlock();
    const del = deloadBlock();
    if (!prog && !del) return '';

    return '' +
      '<div class="acc mt-3">' +
        '<button class="acc__head" type="button" aria-expanded="false">' +
          '<span>' +
            '<h3>Робочі ваги</h3>' +
            '<span class="small muted">Крок ваги та зниження ваги в усіх вправах</span>' +
          '</span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          prog +
          (prog && del ? '<hr class="divider">' : '') +
          del +
        '</div></div></div>' +
      '</div>';
  }



  function isEdited() {
    return Boolean(state.custom[planKey(state.programId, state.days)]);
  }

  /** Чи є схема, яку зараз дивимось, тією, що обрана як робоча */
  function isActive() {
    return Boolean(state.active &&
      state.active.programId === state.programId &&
      Number(state.active.days) === Number(state.days));
  }


  /* ------------------------------------------------------------------ */
  /* Копіювання плану текстом                                            */
  /* ------------------------------------------------------------------ */
  /*
   * Віддаємо звичайний текст, а не таблицю: він однаково лягає в нотатки,
   * месенджер і на папірець. Розминка й заминка не входять — вони спільні
   * для всіх планів і в шпаргалці на тренування лише заважають.
   *
   * Дні, що повторюються за тиждень, виводяться ОДИН раз: у шестиденному
   * PPL це Push, Pull, Legs, а не шість блоків. Але порівнюємо не назви,
   * а вміст: після правок два дні з однаковим заголовком можуть розʼїхатись,
   * і тоді обидва потрібні.
   */

  /** Підпис дня разом із його вмістом — для пошуку однакових днів */
  function daySignature(day) {
    return (day.title || '') + '|' + (day.exercises || []).map(function (ex) {
      return [ex.name, ex.sets, ex.reps, ex.rir, weightOf(ex)].join('~');
    }).join(';');
  }

  /** Один рядок вправи: усе, що потрібно біля стійки */
  function exerciseLine(ex, i) {
    const w = weightOf(ex);
    const parts = [];

    parts.push((ex.sets || '?') + '×' + (ex.reps || '?'));
    if (w !== null) parts.push(w + ' кг');
    if (ex.rir) parts.push('RIR ' + ex.rir);
    if (restFor(ex) !== '—') parts.push('відп. ' + restFor(ex));

    return (i + 1) + '. ' + (ex.name || ex.pattern || 'вправа не задана') +
           '\n   ' + parts.join('  ·  ') +
           (ex.note ? '\n   ' + ex.note : '');
  }

  /**
   * Увесь план у вигляді тексту.
   * @returns {string}
   */
  function planToText(program, days, plan) {
    const seen = Object.create(null);
    const blocks = [];

    plan.forEach(function (day) {
      const sig = daySignature(day);
      if (seen[sig]) return;        // такий самий день уже виведено
      seen[sig] = true;

      const sets = (day.exercises || []).reduce(function (n, ex) {
        return n + (Number(ex.sets) || 0);
      }, 0);

      const head = '── ' + String(day.title || 'День').toUpperCase() + ' ──' +
                   (day.focus ? '\n' + day.focus : '') +
                   '\n' + (day.exercises || []).length + ' вправ · ' + sets + ' підходів';

      const body = (day.exercises || []).map(exerciseLine).join('\n\n');
      blocks.push(head + '\n\n' + body);
    });

    const repeated = plan.length - blocks.length;

    return [
      'Get Stronger — ' + program.name,
      days + ' днів на тиждень' +
        (repeated > 0 ? ' · показано ' + blocks.length + ' різних тренування, решта повторюються' : ''),
      new Date().toLocaleDateString('uk-UA'),
      '',
      blocks.join('\n\n\n'),
      '',
      'Розминка й заминка — спільні для всіх днів, у цей список не входять.'
    ].join('\n');
  }


  /**
   * Той самий план, але розміткою — щоб у нотатках, Word чи Google Docs
   * він вставився ТАБЛИЦЕЮ, а не рядками тексту.
   *
   * Оформлення старими атрибутами (border, cellpadding), а не CSS:
   * редактори при вставці зазвичай викидають стилі, а атрибути таблиці
   * розуміють. Виглядає архаїчно, зате доїжджає.
   */
  function planToHtml(program, days, plan) {
    const seen = Object.create(null);
    const parts = [];

    plan.forEach(function (day) {
      const sig = daySignature(day);
      if (seen[sig]) return;
      seen[sig] = true;

      const list = day.exercises || [];
      const sets = list.reduce(function (n, ex) { return n + (Number(ex.sets) || 0); }, 0);

      // Примітки вправ — це не робочий обʼєм, тому не в таблиці,
      // а окремим списком під нею, як позначки на полях
      const notes = [];

      const rows = list.map(function (ex, i) {
        const w = weightOf(ex);
        if (ex.note) notes.push((ex.name || ex.pattern || 'вправа') + ' — ' + ex.note);
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + esc(ex.name || ex.pattern || 'вправа не задана') + '</td>' +
          // esc і на sets теж: поле приходить із customPlans, а той може
          // приїхати з імпортованого файла. Розмітка звідси потрапляє в
          // живий DOM запасним шляхом copyRich (app.js), тобто це XSS-вектор.
          '<td>' + esc(ex.sets || '?') + '×' + esc(ex.reps || '?') + '</td>' +
          '<td>' + (w === null ? '—' : w + ' кг') + '</td>' +
          '<td>' + esc(ex.rir || '—') + '</td>' +
          '<td>' + esc(restFor(ex)) + '</td>' +
        '</tr>';
      }).join('');

      parts.push(
        '<h3>' + esc(String(day.title || 'День').toUpperCase()) + '</h3>' +
        (day.focus ? '<p><i>' + esc(day.focus) + '</i></p>' : '') +
        '<p>' + list.length + ' вправ · ' + sets + ' робочих підходів</p>' +
        '<table border="1" cellspacing="0" cellpadding="6">' +
          '<thead><tr>' +
            '<th>№</th><th>Вправа</th><th>Підходи × повторення</th>' +
            '<th>Вага</th><th>RIR</th><th>Відпочинок</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
        (notes.length
          ? '<p><b>Примітки:</b></p><ul>' +
            notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
            '</ul>'
          : '')
      );
    });

    const repeated = plan.length - parts.length;

    return '<div>' +
      '<h2>' + esc(program.name) + '</h2>' +
      '<p>' + days + ' днів на тиждень' +
        (repeated > 0 ? ' · показано ' + parts.length + ' різних тренування, решта повторюються' : '') +
        ' · ' + new Date().toLocaleDateString('uk-UA') + '</p>' +
      '<p><i>Розминка й заминка — спільні для всіх тренувальних днів і в обʼєм не включені.</i></p>' +
      parts.join('<hr>') +
    '</div>';
  }

  /**
   * Копіювання в буфер живе в js/app.js: тим самим шляхом користується
   * ще й сторінка періодизації, а чотирирівневий запасний механізм —
   * не те, що варто мати у двох копіях.
   */
  const copyRich = window.App.copyRich;
  const fmt = window.App.fmt;

  /* ------------------------------------------------------------------ */
  /* Рендер: список схем                                                 */
  /* ------------------------------------------------------------------ */

  function renderList() {
    const host = $('#program-list');
    if (!host) return;
    const days = state.days;

    /* data-tilt вмикає нахил і блик (js/app.js), .picker дає світло під
       сіткою, без якого скляна поверхня нічим не відрізняється від
       матової. Ефект прибитий саме до цієї сітки: вибір програми — єдине
       місце, де людина порівнює варіанти, а не читає дані. */
    /*
     * ЩО ВЗАГАЛІ ВИРІШУЄ ЦЕЙ ВИБІР (B3).
     *
     * Картки дають три числа — частоту, тижневий обʼєм і тривалість, — і
     * з них здається, що схеми відрізняються результатом. Насправді
     * головне про цей вибір сказане в одному реченні, і доти воно жило
     * на іншій сторінці: при однаковому тижневому обʼємі частота
     * тренування групи не дає значущої різниці в гіпертрофії
     * (PMID 30558493). Тобто це вибір розкладу, а не результату.
     *
     * Речення стоїть НАД сіткою, а не в картці: воно стосується всіх
     * схем однаково, і шість його копій у шести картках були б шістьма
     * місцями, які розійдуться. Місце в картці теж не випадкове —
     * довга назва плюс зайвий абзац уже одного разу розсипали три числа
     * на три рядки.
     */
    const why = '' +
      '<p class="small muted" style="margin:0 0 16px">' +
        'Схеми відрізняються <b>розкладом, а не результатом</b>: при однаковому ' +
        'тижневому обʼємі частота тренування групи мʼязів не дає значущої різниці ' +
        'в гіпертрофії. Обирайте ту, у яку реально вміщається ваш тиждень — ' +
        'а числа нижче кажуть, чого вона коштує за часом. ' +
        '<a href="research.html">Джерело</a>.' +
      '</p>';

    host.innerHTML = why + '<div class="grid grid-3 picker" data-tilt>' + PROGRAMS_FOR_ME().map(function (p) {
      if (!supports(p, days)) {
        return '' +
          '<article class="card card--glass card--off">' +
            '<div class="row row--split">' +
              '<h3 class="card__title">' + esc(p.name) + '</h3>' +
            '</div>' +
            '<p class="small muted mb-0">Доступна при ' + p.daysSupported.join(', ') + ' дн./тиждень.</p>' +
          '</article>';
      }

      const selected = p.id === state.programId;
      const plan = loadPlan(p.id, days);
      const freq = frequencyOf(p, days);
      const total = plan.reduce(function (n, d) { return n + d.exercises.length; }, 0);

      /*
       * ПОРОЖНІЙ КАРКАС НЕ ОПИСУЮТЬ ЧИСЛАМИ.
       *
       * У власного плану, поки в ньому нічого немає, усі три показники —
       * нулі: «0 підх./тиждень · ~0 хв». Три нулі в ряд читаються як
       * поламка сторінки, а не як «ви ще нічого не додали». Тому замість
       * них — одне речення про те, що це таке.
       */
      const facts = total
        ? '<div class="row small muted" style="gap:16px;margin-bottom:16px">' +
            '<span><b class="mono">' + esc(freq.label) + '</b> на групу</span>' +
            '<span><b class="mono">' + weeklySets(plan) + '</b> підх./тиждень</span>' +
            '<span><b class="mono">~' + sessionMinutes(plan) + '</b> хв/тренування</span>' +
          '</div>'
        : '<p class="small muted" style="margin-bottom:16px">' +
            'Порожній каркас на ' + days + ' ' + plural(days, 'день', 'дні', 'днів') +
            '. Вправи, підходи й повторення ставите ви — назву дня теж.' +
          '</p>';

      return '' +
        '<article class="card card--glass card--hover' + (selected ? ' is-selected' : '') + '">' +
          '<div class="row row--split">' +
            '<h3 class="card__title">' + esc(p.name) + '</h3>' +
            /*
             * ПЛАШОК ТУТ НЕМАЄ ЖОДНИХ — ні «обрана», ні «змінена».
             *
             * «Обрана» повторювала те, що картка й так каже тричі: акцентна
             * межа, смужка зліва й підпис на кнопці («Показана нижче»
             * замість «Показати план»).
             *
             * «Змінена» несла справжній факт, але не тут: щоб він щось
             * означав, треба знати, ЩО саме змінено, а це видно лише у
             * відкритому плані. Там факт нікуди не подівся — кнопка
             * «Початковий план» активна рівно тоді, коли правки є, і поруч
             * стоїть рядок «Правок ще немає…», коли їх немає. Тобто
             * інформація лишилась там, де з нею можна щось зробити.
             *
             * Практична причина прибрати: довга назва плюс плашка не
             * вміщались в один рядок, і три числа під ними розсипались на
             * три рядки замість одного.
             */
          '</div>' +
          facts +
          '<button class="btn ' + (selected ? 'btn--ghost' : 'btn--primary') + ' btn--sm" type="button" data-pick="' + esc(p.id) + '">' +
            (selected ? 'Показана нижче' : (total ? 'Показати план' : 'Скласти свій')) +
          '</button>' +
        '</article>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Рендер: рядок вправи                                                */
  /* ------------------------------------------------------------------ */

  function muscleNames(ids) {
    return ids.map(function (id) {
      const m = MUSCLES.find(function (x) { return x.id === id; });
      return m ? m.name : id;
    }).join(' + ');
  }

  /**
   * Поле робочої ваги. Редагується завжди, а не тільки в режимі правок:
   * це єдина цифра в плані, яку міняєш мало не щотренування, і ганяти
   * заради неї режим редагування було б зайвим тертям.
   */
  function weightInput(ex, dayIdx, i) {
    const w = weightOf(ex);
    // data-name потрібен, щоб після правки одразу оновити поля тієї самої
    // вправи в інших днях, не перемальовуючи весь план
    return '<input class="input input--sm input--weight num mono" type="text" ' +
      'inputmode="decimal" placeholder="—" ' +
      /* Кома, як і на «Сьогодні»: те саме число має виглядати однаково
         в обох полях. onEdit() читає обидва знаки. */
      'value="' + esc(w === null ? '' : window.App.fmtNum.kg(w)) + '" data-act="weight" ' +
      'data-day="' + dayIdx + '" data-i="' + i + '" ' +
      'data-name="' + esc(ex.name || '') + '" ' +
      'aria-label="Робоча вага, кг">';
  }

  /**
   * Перерахувати повторення однієї вправи ПРЯМО В state.plan.
   *
   * Потрібне після заміни вправи: розмір цільової групи міг змінитись, а
   * від нього залежить і діапазон за таблицею, і стеля власного числа.
   * Без цього рядок після заміни грудей на біцепс показував би 8–10 замість
   * 10–12 до наступного заходу на сторінку — і саме це число поїхало б у
   * тренування.
   */
  function refreshReps(ex) {
    const RC = window.RepsCore;
    if (!RC) return;
    const own = RC.normUserReps(ex.userReps, ex);
    if (own === null) {
      delete ex.userReps;
      ex.reps = RC.repRangeFor(state.profile && state.profile.trainingAge, ex);
    } else {
      ex.userReps = own;          /* могло підтягнутись до нижчої стелі */
      ex.reps = String(own);
    }
  }

  /**
   * Поле повторень у режимі правки.
   *
   * Порожнє = «за таблицею стажу»: у placeholder тоді стоїть той самий
   * діапазон, який показує звичайний перегляд, тож людина бачить, ЩО саме
   * буде, якщо нічого не вписувати. Вписане число замінює діапазон і
   * доїжджає до екрана тренування як є.
   *
   * max стоїть у розмітці, але БЕЗ title і без підказки поруч: стрілки
   * поля просто не піднімуться вище, а набране руками більше число
   * підтягнеться до стелі мовчки (див. RepsCore.normUserReps). Пояснення
   * тут було б правилом, якого людина мусить памʼятати; рамка, з якої
   * неможливо вийти, не потребує пояснення.
   */
  function repsInput(ex, dayIdx, i) {
    const RC = window.RepsCore;
    const max = RC ? RC.maxRepsFor(ex) : 15;
    const own = RC ? RC.normUserReps(ex.userReps, ex) : null;
    /* Підказка — діапазон за стажем, той самий, що дала б таблиця. */
    const hint = RC && state.profile
      ? RC.repRangeFor(state.profile.trainingAge, ex)
      : String(ex.reps || '');
    return '<input class="input input--sm input--reps num mono" type="number" min="1" max="' + max + '" step="1" ' +
      'value="' + (own === null ? '' : own) + '" placeholder="' + esc(hint) + '" ' +
      'data-act="reps" data-day="' + dayIdx + '" data-i="' + i + '" aria-label="Повторення">';
  }

  /**
   * Поле запасу до відмови.
   *
   * Було просто число з даних програми — незмінне. Але RIR — це не
   * властивість вправи, а домовленість людини з собою: наскільки близько
   * до відмови вона сьогодні працює. У даних він стоїть як орієнтир
   * автора програми, і саме тому порожнє поле означає «без RIR», а не
   * «поверни авторський»: прибрати запас із вправи — така сама
   * осмислена дія, як поставити його.
   *
   * Стеля 5 — з js/reps-core.js, та сама, до якої однаково обрізає
   * періодизація, коли рахує разовий максимум.
   */
  function rirInput(ex, dayIdx, i) {
    const RC = window.RepsCore;
    const own = RC ? RC.normRir(ex.rir) : null;
    return '<input class="input input--sm input--reps num mono" type="number" min="0" max="' +
      (RC ? RC.RIR_MAX : 5) + '" step="1" ' +
      'value="' + (own === null ? '' : own) + '" placeholder="—" ' +
      'data-act="rir" data-day="' + dayIdx + '" data-i="' + i + '" aria-label="RIR, запас до відмови">';
  }

  /**
   * Поле «скільки розминкових підходів».
   *
   * Розминка — не властивість плану, а книга по назві вправи (як і
   * робоча вага): вправа одна, отже й сходинки до неї одні, у якому б
   * дні вона не стояла. Тому поле пише в profile.warmups, а не в
   * customPlans.
   *
   * Порожнє поле означає «як вирішує сайт»: три сходинки для великої
   * групи в багатосуглобовому русі, жодної для решти (js/workout-core.js).
   * Нуль — це вибір «без розминки», і він не те саме, що порожньо.
   */
  /** Скільки сходинок у вправи зараз — числом, для режиму перегляду. */
  function warmupCount(ex) {
    const WC = window.WorkoutCore;
    if (!WC) return '—';
    const n = WC.warmupCountFor({ warmups: state.warmups || {} }, ex);
    return n ? String(n) : '—';
  }

  function warmupInput(ex, dayIdx, i) {
    const WC = window.WorkoutCore;
    const own = WC ? WC.normWarmupCount((state.warmups || {})[ex.name]) : null;
    const auto = WC ? WC.warmupCountFor({}, ex) : 0;
    const max = WC ? WC.WARMUP_MAX : 5;
    return '<input class="input input--sm input--reps num mono" type="number" min="0" max="' + max + '" step="1" ' +
      'value="' + (own === null ? '' : own) + '" placeholder="' + auto + '" ' +
      'data-act="warmup" data-day="' + dayIdx + '" data-i="' + i + '" ' +
      'aria-label="Розминкові підходи">';
  }

  function exerciseRow(ex, i, dayIdx, total) {
    const ms = musclesOfExercise(ex);
    const filled = Boolean(ex.name && ex.name.trim());

    const title = filled
      ? '<b>' + esc(ex.name) + '</b>'
      : '<b>' + esc(ex.pattern || '—') + '</b><br><span class="small" style="color:var(--g1)">слот вільний</span>';

    const sub = ms.length
      ? '<span class="small muted">' + esc(muscleNames(ms)) + '</span>'
      : '<span class="small" style="color:var(--g1)">група не задана</span>';

    if (!state.editing) {
      return '' +
        // data-l — підпис колонки для телефона: там таблиця складається
        // в стовпчик карток (.tbl--plan у style.css), і заголовок рядка
        // ::before бере текст саме звідси. Розмітка лишається таблицею,
        // тому на десктопі й у друку нічого не міняється.
        '<tr>' +
          '<td class="num muted mono tbl__idx">' + (i + 1) + '</td>' +
          '<td class="tbl__main">' + title + '<br>' + sub +
            (ex.note ? '<br><span class="small muted">' + esc(ex.note) + '</span>' : '') + '</td>' +
          '<td class="num mono" data-l="Підходи">' + esc(ex.sets) + '</td>' +
          '<td class="num mono" data-l="Повтори">' + esc(ex.reps) + '</td>' +
          '<td data-l="Вага, кг">' + weightInput(ex, dayIdx, i) + '</td>' +
          '<td class="num mono" data-l="RIR">' + esc(ex.rir) + '</td>' +
          '<td class="num mono" data-l="Розминка">' + warmupCount(ex) + '</td>' +
          '<td data-l="Відпочинок">' +
            (restFor(ex) === '—'
              ? '<span class="num mono muted">—</span>'
              // Кнопка, а не напис: клік запускає відлік саме цієї вправи.
              : '<button class="rest-btn" type="button" data-rest-sec="' + restSecFor(ex) + '" ' +
                        'data-rest-name="' + esc(ex.name) + '" ' +
                        'aria-label="Таймер відпочинку ' + restFor(ex) + '">' +
                  restFor(ex) +
                '</button>') +
          '</td>' +
        '</tr>';
    }

    // Режим редагування: заміна вправи, підходи, порядок, видалення
    const options = exercisesForMuscles(ms);
    const known = options.some(function (o) { return o.name === ex.name; });

    const select = '' +
      '<select class="select select--sm" aria-label="Замінити вправу" data-act="swap" data-day="' + dayIdx + '" data-i="' + i + '">' +
        (known ? '' : '<option value="" selected>' + esc(ex.name || '— оберіть вправу —') + '</option>') +
        options.map(function (o) {
          return '<option value="' + esc(o.name) + '"' + (o.name === ex.name ? ' selected' : '') + '>' +
            esc(o.name) + '</option>';
        }).join('') +
      '</select>';

    return '' +
      '<tr>' +
        '<td class="num muted mono tbl__idx">' + (i + 1) + '</td>' +
        '<td class="tbl__main">' + select + '<br>' + sub + '</td>' +
        '<td data-l="Підходи">' +
          // max рахується від решти плану: стрілки поля просто не дадуть
          // піднятись вище тижневої стелі, а не покажуть перевищення потім
          '<input class="input input--sm num mono" type="number" min="1" max="' + maxSetsFor(dayIdx, i) + '" step="1" ' +
            'value="' + esc(ex.sets) + '" title="Максимум за тижневою межею: ' + maxSetsFor(dayIdx, i) + '" ' +
            'data-act="sets" data-day="' + dayIdx + '" data-i="' + i + '" aria-label="Підходи">' +
        '</td>' +
        '<td data-l="Повтори">' + repsInput(ex, dayIdx, i) + '</td>' +
        '<td data-l="Вага, кг">' + weightInput(ex, dayIdx, i) + '</td>' +
        '<td data-l="RIR">' + rirInput(ex, dayIdx, i) + '</td>' +
        '<td data-l="Розминка">' + warmupInput(ex, dayIdx, i) + '</td>' +
        '<td class="tbl__acts">' +
          '<div class="row-actions">' +
            '<button class="icon-btn" type="button" data-act="up" data-day="' + dayIdx + '" data-i="' + i + '"' +
              (i === 0 ? ' disabled' : '') + ' aria-label="Вище">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg>' +
            '</button>' +
            '<button class="icon-btn" type="button" data-act="down" data-day="' + dayIdx + '" data-i="' + i + '"' +
              (i === total - 1 ? ' disabled' : '') + ' aria-label="Нижче">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
            '</button>' +
            '<button class="icon-btn icon-btn--danger" type="button" data-act="del" data-day="' + dayIdx + '" data-i="' + i + '" aria-label="Видалити">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }

  /* Скільки символів лишаємо в назві дня. Довша не влізе в заголовок
     акордеона на телефоні й у смугу тижня — обріжеться трьома крапками,
     тобто збережеться те, чого людина не побачить. */
  const DAY_TITLE_MAX = 28;
  const DAY_FOCUS_MAX = 40;
  /* Сім — бо тиждень. Восьмий день нікуди поставити в розкладі. */
  const DAYS_MAX = 7;

  /* Порожній день — нормальний стан власного плану, а не поламка. Але
     порожня таблиця без жодного слова читається саме як поламка. */
  function emptyDayNote() {
    return '<p class="small muted mt-0 mb-2">Поки що порожньо. ' +
      (state.editing
        ? 'Додайте першу вправу списком під таблицею.'
        : 'Натисніть «Редагувати» й додайте вправи.') +
      '</p>';
  }

  function dayBlock(day, dayIdx) {
    const head = state.editing
      /* «Повт.» у правці ширша за перегляд: там просто число, а тут поле
         з лічильником і підказкою на пʼять знаків («10–12»). На 70px
         підказка обрізалась до «10–1» — тобто показувала неправду. */
      ? '<th style="width:90px">Підх.</th><th style="width:104px">Повт.</th><th style="width:90px">Вага, кг</th><th style="width:84px">RIR</th><th style="width:84px">Розм.</th><th style="width:120px">Дії</th>'
      : '<th style="width:70px">Підх.</th><th style="width:70px">Повт.</th><th style="width:90px">Вага, кг</th><th style="width:60px">RIR</th><th style="width:70px">Розм.</th><th style="width:90px">Відпоч.</th>';

    // 6 колонок у head + «#» і «Вправа»
    const cols = 8;

    const addRow = state.editing
      ? '<div class="row mt-1">' +
          '<select class="select select--sm" aria-label="Додати вправу на групу мʼязів" data-act="add-muscle" data-day="' + dayIdx + '" style="max-width:240px">' +
            '<option value="">+ додати вправу на групу…</option>' +
            MUSCLES.map(function (m) {
              return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>';
            }).join('') +
          '</select>' +
          /* Своя вправа — поруч із вибором групи, а не в окремому розділі:
             її створюють саме тоді, коли в списку не знайшлось потрібного. */
          '<button class="btn btn--ghost btn--sm" type="button" data-own-new="' + dayIdx + '">' +
            '+ своя вправа</button>' +
        '</div>'
      : '';

    /*
     * ПРАВКИ САМОГО ДНЯ, А НЕ ЛИШЕ ЙОГО ВПРАВ.
     *
     * Редактор умів усе всередині дня — і нічого з самим днем. «День A ·
     * Усе тіло» був незмінним написом навіть у власному плані, який
     * людина склала з нуля: назвати його «Понеділок — груди» було
     * неможливо. І видалити зайвий день теж: лишалось по одному
     * прибирати з нього вправи, а порожній день усе одно стояв у
     * розкладі тижня.
     *
     * Два поля й дві кнопки стоять НАД таблицею: спершу «що це за день»,
     * потім «що в ньому».
     */
    const dayTools = state.editing
      ? '<div class="row mt-0 mb-2" style="gap:10px;flex-wrap:wrap;align-items:flex-end">' +
          '<label class="field" style="flex:1 1 190px;margin:0">' +
            '<span class="field__label">Назва дня</span>' +
            '<input class="input input--sm" type="text" maxlength="' + DAY_TITLE_MAX + '" ' +
              'data-act="day-title" data-day="' + dayIdx + '" ' +
              'value="' + esc(day.title || '') + '" placeholder="Понеділок — груди">' +
          '</label>' +
          '<label class="field" style="flex:1 1 190px;margin:0">' +
            '<span class="field__label">Про що день</span>' +
            '<input class="input input--sm" type="text" maxlength="' + DAY_FOCUS_MAX + '" ' +
              'data-act="day-focus" data-day="' + dayIdx + '" ' +
              'value="' + esc(day.focus || '') + '" placeholder="груди, трицепс, дельти">' +
          '</label>' +
          '<button class="btn btn--ghost btn--sm" type="button" ' +
            'data-act="day-del" data-day="' + dayIdx + '"' +
            (state.plan.length <= 1 ? ' disabled title="Це останній день плану"' : '') + '>' +
            'Видалити день' +
          '</button>' +
        '</div>'
      : '';

    /*
     * Шаблон завжди віддає день ЗГОРНУТИМ. Раніше перший розкривався сам,
     * і сторінка відкривалась одразу довгою таблицею, крізь яку треба
     * гортати до решти днів.
     *
     * Раніше тут був виняток `open = state.editing` — у режимі правки
     * розкривались УСІ дні. На тижневому плані це означало, що натиснути
     * «Редагувати», щоб поміняти одну вправу в одному дні, розгортало всі
     * шість, і сторінка стрибала на кілька екранів. Тепер який день
     * відкритий — вирішує людина, а renderPlan() лише зберігає її вибір
     * між перемальовками (див. applyOpenAcc).
     */
    const open = false;

    return '' +
      '<div class="acc' + (open ? ' is-open' : '') + '">' +
        '<button class="acc__head" type="button" aria-expanded="' + open + '">' +
          '<span class="chip chip--acc">' + (dayIdx + 1) + '</span>' +
          '<span>' +
            '<h3>' + esc(day.title) + '</h3>' +
            '<span class="small muted">' + esc(day.focus) + ' · ' + day.exercises.length + ' вправ · ' +
              day.exercises.reduce(function (s, e) { return s + (Number(e.sets) || 0); }, 0) + ' підходів' +
              /* Тривалість КОЖНОГО дня, не середня по програмі: дні різні,
                 і людина планує час під конкретний день. */
              ' · ~' + dayMinutes(day) + ' хв</span>' +
          '</span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          dayTools +
          (day.exercises.length ? '' : emptyDayNote()) +
          '<div class="table-wrap">' +
            '<table class="tbl tbl--plan">' +
              '<thead><tr><th style="width:40px">#</th><th>Вправа</th>' + head + '</tr></thead>' +
              '<tbody>' +
                day.exercises.map(function (ex, i) {
                  const prev = day.exercises[i - 1];
                  // Заголовок кругової частини ставимо один раз — там,
                  // де circuit зʼявляється або змінює номер
                  const opensCircuit = ex.circuit && (!prev || prev.circuit !== ex.circuit);
                  const head = opensCircuit
                    ? '<tr class="tbl__band"><td colspan="' + cols + '">' +
                        '<b>Кругова частина</b> · ' + esc(ex.sets) + ' кола підряд, ' +
                        'відпочинок тільки між колами' +
                      '</td></tr>'
                    : '';
                  return head + exerciseRow(ex, i, dayIdx, day.exercises.length);
                }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +
          addRow +
        '</div></div></div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Рендер: план                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Розминка й заминка. Спільні для всіх програм, тому беруться з довідника,
   * а не з плану. У тижневий обʼєм не входять — це не робочі підходи.
   */
  function ritualBlock(title, subtitle, items, openByDefault) {
    if (!items || !items.length) return '';
    return '' +
      '<div class="acc' + (openByDefault ? ' is-open' : '') + '">' +
        '<button class="acc__head" type="button" aria-expanded="' + Boolean(openByDefault) + '">' +
          // Лічильника вправ тут немає навмисно: розминка — не набір,
          // який треба «виконати повністю», а послідовність до відчуття.
          '<span>' +
            '<h3>' + esc(title) + '</h3>' +
            '<span class="small muted">' + esc(subtitle) + '</span>' +
          '</span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          // ul, а не ol: порядок тут не обовʼязковий, тож і нумерація зайва.
          // Модифікатор --plain міняє цифру на крапку; у кардіо той самий
          // .ritual лишається нумерованим, бо там кроки йдуть послідовно.
          '<ul class="ritual ritual--plain">' +
            items.map(function (it) {
              return '<li>' +
                '<span class="ritual__name">' + esc(it.name) + '</span>' +
                (it.detail ? '<span class="ritual__detail">' + esc(it.detail) + '</span>' : '') +
              '</li>';
            }).join('') +
          '</ul>' +
        '</div></div></div>' +
      '</div>';
  }

  function restDivider(count) {
    const n = count || 1;
    const label = n === 1 ? 'День відпочинку' :
                  n < 5   ? n + ' дні відпочинку'
                          : n + ' днів відпочинку';
    return '' +
      '<div class="rest-day">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
          '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>' +
        '</svg>' +
        '<span>' + label + '</span>' +
      '</div>';
  }

  /**
   * Розклад тижня з програми: числа — індекси днів, 'rest' — відпочинок.
   * Якщо розкладу немає, показуємо просто всі дні поспіль.
   */
  /*
   * Розклад тижня для ЦЬОГО плану.
   *
   * Ключ — довжина плану, а не перемикач днів угорі сторінки: день можна
   * видалити або додати просто в редакторі, і тоді в плані лишається,
   * скажімо, три дні, а перемикач досі каже «4». Брати розклад за
   * перемикачем означало б малювати тиждень із днем, якого вже немає
   * (plan[3] → undefined → «—» у смузі).
   *
   * Якщо готового розкладу на таку довжину немає — тренування підряд,
   * решта тижня відпочинок. Так само робить «Сьогодні» (js/today.js).
   */
  function weekSchedule(program, days, plan) {
    const byLen = (program.schedule || {})[String(plan.length)];
    const byDays = (program.schedule || {})[String(days)];
    /*
     * Придатний розклад мусить не лише не показувати неіснуючих днів, а
     * й ПОКАЗАТИ кожен наявний. Дні малюються саме обходом розкладу
     * (див. renderPlan), тож день, якого в ньому немає, просто зникає з
     * екрана — а в плані лишається. Це і сталось би після «додати день»
     * на схемі, у якої розкладу на таку довжину не заготовлено.
     */
    const fits = function (sch) {
      if (!Array.isArray(sch)) return false;
      const seen = new Set();
      for (let k = 0; k < sch.length; k++) {
        const x = sch[k];
        if (x === 'rest') continue;
        if (!Number.isInteger(x) || x < 0 || x >= plan.length) return false;
        seen.add(x);
      }
      return seen.size === plan.length;
    };
    if (fits(byLen)) return byLen;
    if (fits(byDays)) return byDays;
    const out = [];
    for (let i = 0; i < 7; i++) out.push(i < plan.length ? i : 'rest');
    return out;
  }

  /** Рядок «Верх · Низ · відпочинок · …» над розкладом */
  function weekLine(schedule, plan) {
    return schedule.map(function (x) {
      return x === 'rest'
        ? '<span class="week__rest">відпочинок</span>'
        : '<span class="week__day">' + esc((plan[x] || {}).title || '—') + '</span>';
    }).join('<span class="week__sep">·</span>');
  }

  /**
   * Які дні зараз розгорнуті — за індексом акордеона в #plan.
   *
   * Розмітку плану перемальовує будь-яка правка, зміна кількості днів і
   * приліт профілю з іншого пристрою, а шаблон дня завжди віддає день
   * згорнутим. Через це кожна перемальовка закривала все, що людина
   * відкрила, і скидала скрол у початок таблиці. Знімаємо стан до запису
   * innerHTML і повертаємо після.
   */
  function openAccIndexes(host) {
    const out = [];
    $$('.acc', host).forEach(function (acc, i) {
      if (acc.classList.contains('is-open')) out.push(i);
    });
    return out;
  }

  /**
   * Привести акордеони до заданого набору: перелічені відкрити, решту
   * закрити. Саме «привести», а не «доввідкривати» — інакше стан умів би
   * лише накопичуватись, і вийти з режиму правки з шістьма розгорнутими
   * днями було б неможливо.
   */
  function applyOpenAcc(host, indexes) {
    const want = {};
    (indexes || []).forEach(function (i) { want[i] = true; });
    $$('.acc', host).forEach(function (acc, i) {
      const open = Boolean(want[i]);
      acc.classList.toggle('is-open', open);
      // Ті самі атрибути, що ставить initAccordions при кліку: без них
      // читалка вважала б день закритим, а inert лишив би вміст поза
      // таб-порядком — видимий, але недосяжний із клавіатури.
      const head = acc.querySelector('.acc__head');
      if (head) head.setAttribute('aria-expanded', String(open));
      const inner = acc.querySelector('.acc__inner');
      if (!inner) return;
      if (open) inner.removeAttribute('inert');
      else inner.setAttribute('inert', '');
    });
  }

  /** Індекс першого акордеона, у якому справді є вправи (не «Розминка»). */
  function firstDayAccIndex(host) {
    const accs = $$('.acc', host);
    for (let i = 0; i < accs.length; i++) {
      if (accs[i].querySelector('[data-act]')) return i;
    }
    return -1;
  }

  /**
   * @param {number[]} [wantOpen] які дні лишити відкритими. Не передали —
   *        беремо ті, що відкриті зараз: перемальовка не має міняти вигляд
   *        сторінки, якщо про це не просили явно.
   */
  /* ------------------------------------------------------------------ */
  /* Свої вправи                                                         */
  /* ------------------------------------------------------------------ */
  /*
   * ДОКЛЕЮЄМО ПРЯМО В window.EXERCISES, а не тримаємо поруч.
   *
   * exercisesForMuscles, primaryMuscle і liftKind замкнені на той самий
   * масив усередині js/exercises.js — другого списку вони не побачать.
   * Тому свої вправи саме дописуються в нього, а перед дописуванням
   * старі свої прибираються: інакше видалена вправа лишалася б у
   * випадайці до перезавантаження сторінки.
   *
   * Позначка user:true — єдине, чим своя відрізняється від бібліотечної,
   * і потрібна вона рівно для цього прибирання.
   */
  function muscleIds() {
    return MUSCLES.map(function (m) { return m.id; });
  }

  function syncUserExercises() {
    const UE = window.UserExercises;
    const lib = window.EXERCISES;
    if (!UE || !Array.isArray(lib)) return [];
    for (let i = lib.length - 1; i >= 0; i--) {
      if (lib[i] && lib[i].user) lib.splice(i, 1);
    }
    const own = UE.list(state.profile, muscleIds());
    UE.applyTo(lib, own).slice(lib.length).forEach(function (e) { lib.push(e); });
    return own;
  }

  /** Список своїх вправ під розкладом — лише в режимі правки. */
  function ownExercisesBlock() {
    const UE = window.UserExercises;
    if (!state.editing || !UE) return '';
    const own = UE.list(state.profile, muscleIds());
    if (!own.length) return '';
    return '' +
      '<div class="mt-3">' +
        '<h3 style="margin:0 0 4px">Мої вправи</h3>' +
        '<p class="small muted" style="margin:0 0 8px">Стоять у заміні поруч із бібліотечними. ' +
          'Прибрати звідси — прибрати з бібліотеки: там, де вправа вже стоїть у плані, ' +
          'вона лишається разом зі своєю вагою.</p>' +
        '<ul class="own-ex">' +
          own.map(function (e) {
            return '<li class="own-ex__row">' +
              /* Назва й групи — стовпчиком: поруч на телефоні обрізались
                 обидві, і рядок не казав ні що це за вправа, ні на що. */
              '<span class="own-ex__txt">' +
                '<span class="own-ex__name">' + esc(e.name) + '</span>' +
                '<span class="small muted own-ex__ms">' + esc(muscleNames(e.muscles)) +
                  (e.lift === 'compound' ? ' · багатосуглобова' : '') + '</span>' +
              '</span>' +
              '<button class="icon-btn icon-btn--danger" type="button" data-own-del="' + esc(e.name) + '" ' +
                'aria-label="Прибрати вправу ' + esc(e.name) + ' з бібліотеки">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>' +
              '</button>' +
            '</li>';
          }).join('') +
        '</ul>' +
      '</div>';
  }

  /*
   * ВІКНО СТВОРЕННЯ.
   *
   * Питаємо рівно два: назву й ГОЛОВНУ групу. Додаткові групи в
   * бібліотеці існують (румунська тяга згадує сідниці), але потрібні
   * вони лише для того, щоб вправа знаходилась у заміні й з їхнього
   * боку — на обʼєм вони не впливають. Складати заради цього список
   * галочок означало б поставити перед людиною вибір, наслідків якого
   * вона не побачить.
   *
   * Тип (багатосуглобова чи ні) питаємо, бо в нього є видимий наслідок:
   * стеля відсотків у періодизації. За замовчуванням — ізоляція, як і в
   * бібліотеці: помилка в цей бік дає нижчу стелю, а в інший — 92% від
   * разового максимуму в махах гантелями.
   */
  function openOwnExerciseSheet(dayIdx) {
    const UE = window.UserExercises;
    const sheet = window.App.sheet;
    if (!UE || !sheet) return;

    sheet({
      title: 'Своя вправа',
      sub: 'Далі вона нічим не відрізняється від бібліотечної: стоїть у заміні, ' +
           'а її підходи йдуть у тижневий обʼєм головній групі.',
      body:
        '<div class="field">' +
          '<label class="field__label" for="own-name">Назва</label>' +
          '<input class="input" id="own-name" type="text" autocomplete="off" ' +
            'maxlength="' + UE.NAME_MAX + '" placeholder="Жим у хаммері">' +
        '</div>' +
        '<div class="field mt-2">' +
          '<label class="field__label" for="own-muscle">Головна група мʼязів</label>' +
          '<select class="select" id="own-muscle">' +
            MUSCLES.map(function (m) {
              return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        /* .check, а не голий input: рідний квадратик у рамці з підписом —
           той самий орган керування, що в акаунті й на вітальній. */
        '<label class="check mt-2">' +
          '<input type="checkbox" id="own-compound">' +
          '<span>Багатосуглобова — присідання, жими, тяги</span>' +
        '</label>' +
        '<p class="field__hint mt-1">Саме цій групі підуть підходи в таблиці ' +
          'тижневого обʼєму.</p>',
      onSave: function (box) {
        const ids = muscleIds();
        const raw = {
          name: box.querySelector('#own-name').value,
          muscles: [box.querySelector('#own-muscle').value],
          lift: box.querySelector('#own-compound').checked ? 'compound' : 'isolation'
        };
        /* Зайнятими вважаємо лише БІБЛІОТЕЧНІ назви: свої UE.add звірить
           сам, а якби сюди потрапили ще й вони, дублікат ловився б двічі. */
        const taken = (window.EXERCISES || [])
          .filter(function (e) { return !e.user; })
          .map(function (e) { return e.name; });
        const res = UE.add(UE.list(state.profile, ids), raw, taken, ids);
        if (!res.ok) {
          toast(res.why === 'dup'
            ? 'Вправа з такою назвою вже є — у бібліотеці або серед ваших'
            : res.why === 'muscles'
              ? 'Оберіть групу мʼязів'
              : 'Назва — від 1 до ' + UE.NAME_MAX + ' знаків', 'err');
          return false;
        }

        state.profile.customExercises = res.list;
        syncUserExercises();
        saveOwn({ customExercises: res.list }).catch(function (e) {
          if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err');
        });

        /* Ставимо одразу в той день, з якого відкрили: людина створила
           вправу в конкретному місці плану, а не «в бібліотеку взагалі». */
        const name = res.list[res.list.length - 1].name;
        if (Number.isFinite(dayIdx)) onEdit('add-named', dayIdx, 0, name);
        else renderPlan();
        toast('Вправу «' + name + '» додано', 'ok');
        return true;
      }
    });
  }

  /** Прибрати свою вправу з бібліотеки (у плані вона лишається). */
  function removeOwnExercise(name) {
    const UE = window.UserExercises;
    if (!UE) return;
    const left = UE.remove(UE.list(state.profile, muscleIds()), name);
    state.profile.customExercises = left;
    syncUserExercises();
    saveOwn({ customExercises: left }).catch(function (e) {
      if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err');
    });
    renderPlan();
    toast('«' + name + '» більше немає в бібліотеці', 'ok');
  }

  function renderPlan(wantOpen) {
    const host = $('#plan');
    if (!host) return;

    const wasOpen = Array.isArray(wantOpen) ? wantOpen : openAccIndexes(host);

    const program = PROGRAMS_FOR_ME().find(function (p) { return p.id === state.programId; });
    if (!program || !state.plan) { host.innerHTML = ''; return; }

    const plan = state.plan;
    const freq = frequencyOf(program, state.days);
    const edited = isEdited();
    const schedule = weekSchedule(program, state.days, plan);

    host.innerHTML = '' +
      '<div class="card">' +
        '<div class="row row--split">' +
          '<div>' +
            /* Без плашки «змінена»: нижче на цій самій картці стан правок
               показує кнопка «Початковий план» — активна, коли правки є, і
               вимкнена з поясненням, коли їх немає. Плашка в заголовку
               казала те саме втретє й ламала рядок на довгих назвах. */
            '<h2 style="margin:0 0 6px">' + esc(program.name) + '</h2>' +
            '<p class="small muted" style="margin:0">' + state.days + ' дн./тиждень</p>' +
          '</div>' +
          (state.mode === 'mine'
            ? '<button class="btn btn--ghost btn--sm" type="button" id="copy-plan">Скопіювати план</button>'
            : '') +
        '</div>' +

        // Кнопка вибору живе тільки на сторінці програм: на «Моєму плані»
        // схема вже обрана, і пропонувати обрати її ще раз — безглуздо.
        (state.mode === 'picker'
          ? '<div class="row mt-3" style="align-items:center;gap:12px">' +
              '<button class="btn btn--primary" type="button" id="adopt-plan">' +
                (isActive() ? 'Це мій поточний план' : 'Обрати цей план') +
              '</button>' +
              '<span class="small muted">' +
                (isActive()
                  ? 'Уже у «Моєму плані» — правки потрапляють туди ж.'
                  : 'Після вибору план зʼявиться в «Моєму плані».') +
              '</span>' +
            '</div>'
          : '') +

        '<div class="kpis mt-3">' +
          '<div class="kpi"><div class="kpi__val">' + state.days + '</div><p class="kpi__lbl">днів / тиждень</p></div>' +
          '<div class="kpi"><div class="kpi__val">' + esc(freq.label) + '</div><p class="kpi__lbl">' + esc(freq.note) + '</p></div>' +
          '<div class="kpi"><div class="kpi__val">' + weeklySets(plan) + '</div><p class="kpi__lbl">підходів / тиждень</p></div>' +
          '<div class="kpi"><div class="kpi__val">~' + sessionMinutes(plan) + ' хв</div><p class="kpi__lbl">одне тренування</p></div>' +
        '</div>' +

        volumeBlock(plan) +

        weightsAcc() +

        '<hr class="divider">' +
        '<h3>Перед кожним тренуванням</h3>' +
        ritualBlock('Розминка', 'Однакова для всіх тренувань · у тижневий обʼєм не входить',
                    window.WARMUP, false) +

        '<hr class="divider">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline">' +
          '<h3 style="margin:0">Розклад тижня</h3>' +
          (state.editing
            ? '<span class="small muted">Заміна показує лише вправи на ту саму групу</span>'
            : '') +
        '</div>' +
        // Кнопка редагування живе просто в смузі розкладу: редагують саме
        // дні тижня, тож і вмикач правок має бути поряд із ними, а не в шапці
        '<div class="week mt-1">' + weekLine(schedule, plan) +
          '<span class="week__actions">' +
            /* Скасування останньої правки — ВИДИМОЮ кнопкою, а не лише
               Ctrl+Z. Правлять план здебільшого з телефона, де сполучення
               клавіш немає взагалі: видалена вправа зникала остаточно, і
               єдиний шлях назад був недоступний саме там, де потрібен. */
            (state.editing && undoStack.length
              ? '<button class="btn btn--ghost btn--sm" type="button" id="undo-edit">Скасувати правку</button>'
              : '') +
            // Кнопка є завжди, а не лише після правок: базовий обсяг плану —
            // точка опори, і до неї мусить бути видимий шлях у будь-який
            // момент. Поки правок немає — підпис прямо каже, чому вимкнена
            // (title на тач-екрані не спрацьовує ніколи).
            '<button class="btn btn--ghost btn--sm" type="button" id="reset-plan"' +
              (edited ? '' : ' disabled') +
              ' title="Повернути вправи й підходи до початкового обсягу плану">' +
              'Початковий план</button>' +
            /* Додати день можна лише в режимі правки — поряд із рештою
               правок, а не окремою кнопкою, яка стоїть завжди. */
            (state.editing
              ? '<button class="btn btn--ghost btn--sm" type="button" id="add-day"' +
                  (plan.length >= DAYS_MAX ? ' disabled title="У тижні сім днів"' : '') +
                  '>+ день</button>'
              : '') +
            '<button class="btn ' + (state.editing ? 'btn--primary' : 'btn--ghost') + ' btn--sm" type="button" id="toggle-edit">' +
              (state.editing ? 'Готово' : 'Редагувати') +
            '</button>' +
          '</span>' +
        '</div>' +
        // Причина вимкнення — окремим рядком. title= на тач-екрані не
        // спрацьовує ніколи, а саме там цю сторінку й правлять.
        (edited ? '' : '<p class="small muted" style="margin:6px 0 0">Правок ще немає — повертати до початкового плану нічого.</p>') +

        '<div class="mt-2">' +
          (function () {
            // Ідемо розкладом, а не масивом днів: підряд кілька 'rest'
            // склеюємо в один блок, інакше два дні відпочинку виглядали б
            // як дві однакові плашки поспіль.
            const out = [];
            let rest = 0;
            schedule.forEach(function (x) {
              if (x === 'rest') { rest++; return; }
              if (rest) { out.push(restDivider(rest)); rest = 0; }
              if (plan[x]) out.push(dayBlock(plan[x], x));
            });
            if (rest) out.push(restDivider(rest));
            return out.join('');
          })() +
        '</div>' +

        ownExercisesBlock() +

        '<hr class="divider">' +
        '<h3>Після кожного тренування</h3>' +
        ritualBlock('Заминка', 'Однакова для всіх тренувань', window.COOLDOWN, false) +

        /* Техніка — не в акордеоні: це те, що новачок має побачити, а не
           знайти. Зовнішнє посилання, тому rel=noopener. */
        '<p class="small muted mt-3">' +
              'Техніку виконання вправ рекомендуємо дивитися на каналі ' +
              '<a href="https://www.youtube.com/@JeffNippard" target="_blank" rel="noopener">Jeff Nippard</a> (YouTube, англійською).' +
        '</p>' +

        /* Довідка про програму: читається один раз, а потім щодня займає
           екран. Той самий згорнутий акордеон, що й решта довгих
           пояснень на сайті. */
        '<div class="acc acc--longform mt-3">' +
          '<button class="acc__head" type="button" aria-expanded="false">' +
            '<span>' +
              '<h3>Прогресія та як це виконувати</h3>' +
              '<span class="small muted">Як додавати вагу і як читати план</span>' +
            '</span>' +
            '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
            '<div class="grid grid-2">' +
              '<div>' +
                '<h3>Прогресія</h3>' +
                '<p class="small">' + esc(program.progression) + '</p>' +
              '</div>' +
              '<div>' +
                '<h3>Як це виконувати</h3>' +
                '<ul class="small list-note" style="margin-bottom:0">' +
                  program.notes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') +
                '</ul>' +
              '</div>' +
            '</div>' +
          '</div></div></div>' +
        '</div>' +
      '</div>';

    window.App.initAccordions(host);
    applyOpenAcc(host, wasOpen);
  }

  /* ------------------------------------------------------------------ */
  /* Правки плану                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Максимум підходів, який можна поставити вправі, не перевищивши стелю
   * її ГОЛОВНОЇ групи.
   *
   * Рахуємо обʼєм БЕЗ цієї вправи, а потім дивимось, скільки лишилось запасу.
   * Дивимось саме на головну групу, бо тільки вона й отримує підходи
   * (див. primaryMuscle у js/exercises.js): раніше тут перебирались усі
   * групи вправи, і запас рахувався від завищених чисел.
   *
   * @param {number} dayIdx день у плані
   * @param {number} i      індекс вправи в дні
   * @returns {number} від 1 до 10
   */
  function maxSetsFor(dayIdx, i) {
    const target = state.plan[dayIdx].exercises[i];
    const main = primaryMuscle(target);
    if (!main) return 10;

    const muscle = MUSCLES.find(function (m) { return m.id === main; });
    if (!muscle) return 10;

    let others = 0;
    state.plan.forEach(function (day, di) {
      day.exercises.forEach(function (ex, ei) {
        if (di === dayIdx && ei === i) return;   // саму вправу не рахуємо
        if (primaryMuscle(ex) !== main) return;
        others += Number(ex.sets) || 0;
      });
    });

    return clamp(muscle.cap - others, 1, 10);
  }

  /** Чи лишився запас у групі, щоб додати туди ще одну вправу */
  function roomInMuscle(id) {
    const muscle = MUSCLES.find(function (m) { return m.id === id; });
    if (!muscle) return 0;
    const v = weeklyVolume(state.plan);
    const row = v.rows.find(function (r) { return r.id === id; });
    return muscle.cap - (row ? row.sets : 0);
  }

  function applyEdit(act, dayIdx, i, value) {
    /*
     * ДІЇ НАД САМИМ ДНЕМ ідуть до того, як ми беремо список вправ: у них
     * немає індексу вправи, а «додати день» узагалі не має дня-джерела.
     */
    if (act === 'day-add') {
      if (state.plan.length >= DAYS_MAX) {
        toast('Більше ' + DAYS_MAX + ' днів у тижні не буває', 'err');
        return false;
      }
      /*
       * Номер беремо вільний, а не «довжина + 1»: після видалення
       * середнього дня довжина зменшується, і наступний доданий дістав
       * би імʼя, яке в плані вже є. Два «День 4» поспіль у розкладі
       * тижня — це вже не назва, а загадка.
       */
      const used = new Set(state.plan.map(function (d) { return String(d.title || '').trim(); }));
      let n = state.plan.length + 1;
      while (used.has('День ' + n)) n++;
      state.plan.push({ title: 'День ' + n, focus: 'Заповніть самі', exercises: [] });
      return true;
    }

    const day = state.plan[dayIdx];
    if (!day) return false;
    const list = day.exercises;

    if (act === 'day-title' || act === 'day-focus') {
      const max = act === 'day-title' ? DAY_TITLE_MAX : DAY_FOCUS_MAX;
      /* Переноси рядків із вставленого тексту зіпсували б і заголовок
         акордеона, і смугу тижня — зводимо до пробілів. */
      const txt = String(value == null ? '' : value)
        .replace(/\s+/g, ' ').trim().slice(0, max);
      const field = act === 'day-title' ? 'title' : 'focus';
      /* Порожню назву не лишаємо: день без імені неможливо ні знайти в
         розкладі, ні назвати в «Сьогодні». Порожнє «про що день» —
         можна, це справді необовʼязково. */
      if (field === 'title' && !txt) {
        day.title = 'День ' + (dayIdx + 1);
      } else {
        day[field] = txt;
      }
      return true;
    }

    if (act === 'day-del') {
      /* Останній день не видаляємо: план без жодного дня — це не план, і
         жодна сторінка не знає, що з ним робити. Кнопка в такому разі
         вимкнена, але перевірка потрібна й тут: дію можна викликати не
         лише кнопкою. */
      if (state.plan.length <= 1) {
        toast('Це останній день — план не може лишитись порожнім', 'err');
        return false;
      }
      state.plan.splice(dayIdx, 1);
      return true;
    }

    if (act === 'up' && i > 0) {
      const t = list[i - 1]; list[i - 1] = list[i]; list[i] = t;
      return true;
    }
    if (act === 'down' && i < list.length - 1) {
      const t = list[i + 1]; list[i + 1] = list[i]; list[i] = t;
      return true;
    }
    if (act === 'del') {
      list.splice(i, 1);
      return true;
    }
    if (act === 'weight') {
      const name = list[i].name;
      if (!name) return false;

      // Порожнє поле — це «вагу ще не задано», а не нуль
      const raw = String(value == null ? '' : value).trim().replace(',', '.');
      if (raw === '') { setWeight(name, null); invalidateDeload(); return true; }
      const n = Number(raw);
      if (!Number.isFinite(n)) return false;
      /* Стеля своя для кожної вправи (js/weight-limits-core.js): спільні
         500 кг для махів гантелями — не запобіжник, а формальність. */
      const cap = window.WeightLimits ? window.WeightLimits.maxFor(name) : 500;
      setWeight(name, clamp(Math.round(n * 2) / 2, 0, cap));   // крок 0,5 кг
      invalidateDeload();
      return true;
    }
    if (act === 'sets') {
      // Обмежуємо 1–10: нуль означав би «вправи немає», для цього є видалення.
      // Додатково — стеля тижневого обʼєму: більшу за неї цифру просто
      // не даємо поставити, а не показуємо постфактум як перевищення.
      const want = clamp(Math.round(Number(value) || 1), 1, 10);
      const max = maxSetsFor(dayIdx, i);
      if (want > max) {
        const names = muscleNames(musclesOfExercise(list[i]));
        toast('Більше не можна: ' + names + ' упреться в тижневу межу', 'err');
      }
      list[i].sets = Math.min(want, max);
      return true;
    }
    if (act === 'reps') {
      /*
       * Порожнє поле знімає власне число — вправа повертається до
       * діапазону за стажем. Саме тому тут delete, а не запис нуля:
       * нуль був би «нуль повторень», а не «як у таблиці».
       *
       * reps проставляємо тут же, а не чекаємо наступного завантаження:
       * renderPlan() малює з state.plan, і без цього рядка колонка
       * показувала б старе значення до перезаходу на сторінку.
       */
      const RC = window.RepsCore;
      const ex = list[i];
      const own = RC ? RC.normUserReps(value, ex) : null;
      if (own === null) {
        delete ex.userReps;
        ex.reps = RC && state.profile
          ? RC.repRangeFor(state.profile.trainingAge, ex)
          : ex.reps;
      } else {
        ex.userReps = own;
        ex.reps = String(own);
      }
      return true;
    }
    if (act === 'rir') {
      /* Порожнє поле прибирає RIR зовсім — у схемі тоді немає «· RIR n».
         Нуль тут значущий: це «до відмови», а не «не задано». */
      const RC = window.RepsCore;
      const own = RC ? RC.normRir(value) : null;
      if (own === null) delete list[i].rir; else list[i].rir = String(own);
      return true;
    }
    if (act === 'warmup') {
      /* Книга по назві вправи, а не поле плану: та сама вправа в іншому
         дні мусить мати ту саму розминку. Порожньо — «як вирішує сайт»,
         тому ключ прибирається зовсім, а не пишеться нулем. */
      const WC = window.WorkoutCore;
      const n = WC ? WC.normWarmupCount(value) : null;
      if (!state.warmups || typeof state.warmups !== 'object') state.warmups = {};
      if (n === null) delete state.warmups[list[i].name];
      else state.warmups[list[i].name] = n;
      return true;
    }
    if (act === 'swap' && value) {
      const found = (window.EXERCISES || []).find(function (e) { return e.name === value; });
      if (!found) return false;

      /*
       * Заміна раніше не перевіряла НІЧОГО: міняла name/muscles і виходила.
       * Через це два кліки на дефолтному плані давали і дублікат в одному
       * дні, і мовчазне перевищення стелі — при тому що поруч написано
       * «більше редактор поставити не дасть».
       */
      const dup = list.some(function (ex, idx) { return idx !== i && ex.name === found.name; });
      if (dup) {
        toast('«' + found.name + '» уже є в цьому дні', 'err');
        return false;
      }

      const prev = { name: list[i].name, muscles: list[i].muscles };
      list[i].name = found.name;
      // Групи беремо з бібліотеки: інакше обʼєм рахувався б на стару групу
      list[i].muscles = found.muscles.slice();
      // …а від групи залежать повторення: і діапазон за таблицею, і стеля
      // власного числа. Нова вправа може бути малою там, де стояла велика.
      refreshReps(list[i]);

      // Перевіряємо ПІСЛЯ підстановки: нова вправа може мати іншу головну
      // групу, і саме її стеля тепер має значення.
      const max = maxSetsFor(dayIdx, i);
      if ((Number(list[i].sets) || 0) > max) {
        if (max < 1) {
          list[i].name = prev.name;
          list[i].muscles = prev.muscles;
          const mn = muscleNames([primaryMuscle(found)]);
          toast(mn + ' уже на тижневій межі — цю заміну не поставити', 'err');
          return false;
        }
        list[i].sets = max;
        toast('Підходи зменшено до ' + max + ': ' +
              muscleNames([primaryMuscle(found)]) + ' упирається в тижневу межу', 'err');
      }
      return true;
    }
    /*
     * ДОДАТИ КОНКРЕТНУ ВПРАВУ ЗА НАЗВОЮ.
     *
     * Потрібне рівно одному місцю — щойно створеній своїй вправі: людина
     * зробила її в цьому дні й очікує побачити її саме тут, а не шукати
     * в заміні. Перевірки ті самі, що в add-muscle (стеля групи,
     * дублікат у плані), бо своя вправа нічим не привілейована.
     */
    if (act === 'add-named' && value) {
      const found = (window.EXERCISES || []).find(function (e) { return e.name === value; });
      if (!found) return false;

      const dup = state.plan.some(function (d) {
        return (d.exercises || []).some(function (e) { return e.name === found.name; });
      });
      if (dup) {
        toast('Ця вправа вже є в плані — додайте їй підходів замість другого рядка', 'err');
        return false;
      }

      const main = primaryMuscle(found);
      const room = main ? roomInMuscle(main) : 3;
      if (room < 1) {
        const muscle = MUSCLES.find(function (m) { return m.id === main; });
        toast((muscle ? muscle.name : 'Група') + ' уже на межі ' +
              (muscle ? muscle.cap : '') + ' підходів на тиждень', 'err');
        return false;
      }

      list.push({
        pattern: '', name: found.name, muscles: (found.muscles || []).slice(),
        lift: found.lift,
        sets: Math.min(3, room), reps: '8–12', rir: '2', rest: '90 с', note: ''
      });
      return true;
    }
    if (act === 'add-muscle' && value) {
      // Група вже на стелі — нову вправу туди класти нікуди
      const room = roomInMuscle(value);
      if (room < 1) {
        const muscle = MUSCLES.find(function (m) { return m.id === value; });
        toast((muscle ? muscle.name : 'Група') + ' уже на межі ' +
              (muscle ? muscle.cap : '') + ' підходів на тиждень', 'err');
        return false;
      }

      /*
       * Беремо вправу, ГОЛОВНА група якої і є запитана — інакше підходи
       * підуть не туди, куди людина просила: exercisesForMuscles повертає
       * усе, що групу бодай зачіпає, і румунська тяга, обрана «на сідниці»,
       * навантажила б біцепс стегна.
       *
       * І пропускаємо те, що вже є в плані. Раніше тут стояло просто pool[0],
       * а базові схеми складені саме з перших елементів бібліотеки — тож
       * дублікат виходив у 16 випадках із 16. Два рядки з однаковою назвою
       * до того ж ділять одне значення робочої ваги.
       */
      const pool = exercisesForMuscles([value]).filter(function (e) {
        return primaryMuscle(e) === value;
      });
      if (!pool.length) {
        toast('Для цієї групи немає вправ, де вона головна', 'err');
        return false;
      }

      const used = new Set();
      state.plan.forEach(function (d) {
        d.exercises.forEach(function (ex) { used.add(ex.name); });
      });
      const first = pool.find(function (e) { return !used.has(e.name); });
      if (!first) {
        toast('Усі вправи на цю групу вже є в плані — заміни підходи в наявних', 'err');
        return false;
      }

      list.push({
        pattern: '', name: first.name, muscles: first.muscles.slice(),
        lift: first.lift,
        sets: Math.min(3, room), reps: '8–12', rir: '2', rest: '90 с', note: ''
      });
      return true;
    }
    return false;
  }

  /**
   * Підставити щойно введену вагу в усі інші поля тієї самої вправи.
   * Поле, у якому зараз друкують, не чіпаємо — інакше курсор стрибав би
   * на початок після кожної цифри.
   */
  /**
   * @param {string|null} name конкретна вправа, або null — оновити ВСІ поля
   *   (так робить підписка на зміни профілю: там невідомо, що саме змінилось,
   *   а перемальовувати сторінку не можна — курсор у полі).
   * Поле під курсором не чіпаємо ніколи: інакше збереження власного вводу
   * затирало б те, що людина продовжує набирати.
   */
  /*
   * Чи працює людина ЗАРАЗ із полем плану.
   *
   * Раніше це питання зводилось до document.activeElement, і саме там був
   * баг: коли з одного поля ваги тицяєш у сусіднє, браузер спершу знімає
   * фокус зі старого (тоді ж і летить change → збереження), а ставить його
   * на нове ВЖЕ ПІСЛЯ того, як відпрацюють мікрозадачі. У момент, коли
   * Store.onChange питав activeElement, там стояв <body> — сторож не
   * спрацьовував, сторінка перемальовувалась, і день, у якому набирали,
   * згортався разом із полем, куди людина щойно тицьнула.
   *
   * Тому дивимось не лише на «фокус зараз», а й на «фокус був щойно».
   * Вікна в пів секунди досить, щоб перекрити розрив між blur і focus, і
   * замало, щоб проґавити справжню зміну з іншого пристрою.
   */
  const FIELD_GRACE_MS = 500;
  let lastFieldTouch = 0;


  function planFieldFocused(el) {
    return Boolean(el && el.closest && el.closest('#plan input, #plan select, ' +
      '#my-plan input, #my-plan select, #program-list input, #program-list select'));
  }

  function busyWithField() {
    if (planFieldFocused(document.activeElement)) return true;
    return (Date.now() - lastFieldTouch) < FIELD_GRACE_MS;
  }

  function watchFieldFocus() {
    // focusin/focusout спливають (на відміну від focus/blur), тож одного
    // слухача на документі досить і він переживає будь-яку перемальовку.
    /* Набір оновлює мітку нарівні з фокусом: вікно має відлічуватись від
       останньої ДІЇ в полі, а не від моменту, коли в нього стали. */
    ['focusin', 'focusout', 'input'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (planFieldFocused(e.target)) lastFieldTouch = Date.now();
      });
    });
  }

  /*
   * Показати в конкретному полі рівно те, що збережено (UX-005).
   *
   * syncWeightInputs навмисно не чіпає поле у фокусі — інакше воно
   * перебивало б набір. Але після події change набір уже завершено, і
   * саме те поле мусить показати збережене значення: нормалізований
   * запис (80,5 замість 80.50), обрізаний до межі, а при нечисловому
   * вводі — попереднє число замість набраного тексту. Без цього
   * «абв» лишалось у полі, у профілі — стара вага, і жодного слова.
   */
  function showStoredWeight(dayIdx, i) {
    const el = document.querySelector(
      '[data-act="weight"][data-day="' + dayIdx + '"][data-i="' + i + '"]');
    if (!el) return;
    const w = weightOf({ name: el.dataset.name });
    el.value = w === null ? '' : window.App.fmtNum.kg(w);
  }

  function syncWeightInputs(name) {
    $$('[data-act="weight"]').forEach(function (el) {
      if (name && el.dataset.name !== name) return;
      if (el === document.activeElement) return;
      const w = weightOf({ name: el.dataset.name });
      el.value = w === null ? '' : window.App.fmtNum.kg(w);
    });
  }

  /*
   * Скасування правок. Знімок стану плану ложиться в стек ПЕРЕД кожною
   * правкою структури (підходи, заміна, порядок, видалення, додавання).
   * Ваги в стек не йдуть навмисно: вони набираються посимвольно, і кожен
   * символ став би окремим «кроком назад», а в текстовому полі й так
   * працює рідне скасування браузера.
   */
  const UNDO_MAX = 30;
  const undoStack = [];

  async function undoEdit() {
    if (!undoStack.length) return;
    const snap = JSON.parse(undoStack.pop());
    // План перемкнули після знімка — стек чужий, чесніше викинути,
    // ніж «скасувати» правку в іншій схемі
    if (snap.p !== state.programId || snap.d !== state.days) {
      undoStack.length = 0;
      return;
    }
    state.plan = snap.plan;
    await persistPlan();
    renderPlan();
    renderList();
    toast('Правку скасовано', 'ok');
  }

  async function onEdit(act, dayIdx, i, value) {
    /*
     * ВИДАЛЕННЯ ДНЯ ПИТАЄМО ВГОЛОС.
     *
     * Вправу повертає «Скасувати правку», і ціна помилки — один клік.
     * День — це десяток вправ, їхні підходи, повторення й порядок; на
     * телефоні кнопка стоїть за півсантиметра від поля з назвою дня.
     * Тому перед ним — вікно з назвою саме того дня, який зникне.
     */
    if (act === 'day-del') {
      const day = state.plan[dayIdx];
      if (!day) return;
      const CB = window.App.confirmBox;
      const cnt = (day.exercises || []).length;
      const text = 'День «' + (day.title || ('День ' + (dayIdx + 1))) + '»' +
        (cnt ? ' разом із ' + cnt + ' ' + plural(cnt, 'вправою', 'вправами', 'вправами') : ' (він порожній)') +
        ' зникне з плану. Повернути можна кнопкою «Скасувати правку» — ' +
        'але лише поки ви не пішли зі сторінки.';
      const yes = CB
        ? await CB({
            title: 'Ви точно бажаєте видалити цей день з плану тренувань?',
            text: text,
            ok: 'Видалити день',
            cancel: 'Залишити'
          })
        : window.confirm('Видалити день «' + (day.title || '') + '» із плану тренувань?');
      if (!yes) return;
    }

    const snap = act === 'weight'
      ? null
      : JSON.stringify({ p: state.programId, d: state.days, plan: state.plan });
    if (!applyEdit(act, dayIdx, i, value)) {
      /*
       * Правку не прийнято. Для ваги це видно лише тут: поле лишалося з
       * набраним текстом, у профілі — старе число, повідомлення не було
       * взагалі (UX-005). Повертаємо поле до збереженого і кажемо межі.
       */
      if (act === 'weight') {
        if (String(value == null ? '' : value).trim() !== '') {
          const nm = (state.plan[dayIdx].exercises[i] || {}).name || '';
          toast(window.WeightLimits ? window.WeightLimits.message(nm)
                                    : 'Робоча вага — число від 0 до 500 кг', 'err');
        }
        showStoredWeight(dayIdx, i);
      }
      return;
    }
    if (snap) {
      undoStack.push(snap);
      if (undoStack.length > UNDO_MAX) undoStack.shift();
    }

    /*
     * Спершу перемальовуємо, потім зберігаємо.
     *
     * Було навпаки, і в хмарному режимі await persistPlan() — це мережевий
     * запит: сотні мілісекунд стара розмітка лишалась на екрані з
     * НЕАКТУАЛЬНИМИ data-i. Подвійний клік по кошику видаляв вправу #2
     * і ту, що встигла зайняти індекс 2. Показ від збереження не залежить —
     * state.plan уже змінено, а помилку запису обробляє persistPlan.
     */
    if (act !== 'weight') {
      renderPlan();
      renderList();
    }
    await persistPlan();

    // Вага ні на що не впливає, крім себе самої: обʼєм, кількість підходів
    // і тривалість сесії лишаються тими самими. Перемальовувати план заради
    // неї не можна — згорнулися б відкриті дні й стрибнув би скрол.
    // Натомість руками синхронізуємо решту полів цієї ж вправи в інших днях.
    if (act === 'weight') {
      syncWeightInputs(state.plan[dayIdx].exercises[i].name);
      /* Поле, у якому щойно набрали, sync пропускає (воно ще у фокусі при
         change з Enter) — показуємо в ньому збережене число саме тут. */
      showStoredWeight(dayIdx, i);
      /* Число поза межами мовчки обрізалось: у полі лишалось 900, у
         профілі — стеля. Тепер про обрізання кажемо вголос, і стеля
         своя для кожної вправи. */
      const nm = (state.plan[dayIdx].exercises[i] || {}).name || '';
      const cap = window.WeightLimits ? window.WeightLimits.maxFor(nm) : 500;
      const raw = String(value == null ? '' : value).trim().replace(',', '.');
      const n = Number(raw);
      if (raw !== '' && Number.isFinite(n) && (n < 0 || n > cap)) {
        toast(window.WeightLimits ? window.WeightLimits.message(nm)
                                  : 'Робоча вага — від 0 до 500 кг', 'err');
      }
      /* Перша збережена вага завершує онбординг — банер має це сказати. */
      updateOnboardBanner();
    }

    if (act === 'del') toast('Вправу видалено — «Скасувати правку» поверне', 'ok');
    if (act === 'day-del') toast('День видалено — «Скасувати правку» поверне', 'ok');
    if (act === 'day-add') toast('День додано — назвіть його й додайте вправи', 'ok');
  }

  /* ------------------------------------------------------------------ */
  /* Оновлення сторінки                                                  */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* Банер онбордингу.                                                   */
  /*                                                                     */
  /* Під час кроку «програма» ці дві сторінки — весь доступний Get Stronger,    */
  /* тож людині треба сказати, де вона і що лишилось. Банер живе в JS,   */
  /* а не в розмітці сторінок: він потрібен лише поки stepFor() каже     */
  /* 'program', і зникає назавжди після першої ж збереженої ваги.        */
  /* ------------------------------------------------------------------ */

  /** Крок онбордингу зі СВІЖИМ станом сторінки, не зі знімка профілю. */
  function onboardStep() {
    const OC = window.OnboardingCore;
    if (!OC) return 'done';
    const p = Object.assign({}, state.profile || {}, {
      weights: state.weights,
      activePlan: state.active
    });
    return OC.stepFor(p);
  }

  /* Крок на момент відкриття сторінки: 'program' означає, що людина
     прийшла сюди онбордингом — лише тоді після першої ваги показуємо
     «Готово», а не мовчки прибираємо банер. */
  let onboardEntry = null;

  function updateOnboardBanner() {
    const target = $('#program-list') || $('#my-plan');
    if (!target) return;

    const step = onboardStep();
    if (onboardEntry === null) onboardEntry = step;

    let box = $('#onboard-banner');
    const wanted = step === 'program' || (step === 'done' && onboardEntry === 'program');
    if (!wanted) { if (box) box.remove(); return; }

    if (!box) {
      box = document.createElement('div');
      box.id = 'onboard-banner';
      box.className = 'card mt-3';
      box.setAttribute('role', 'status');
      target.parentNode.insertBefore(box, target);
    }

    if (step === 'done') {
      box.innerHTML =
        '<p class="small" style="margin:0 0 10px"><b>Готово — профіль повний.</b> ' +
          'Решту ваг можна вписати будь-коли просто в плані.</p>' +
        '<a class="btn btn--primary btn--sm" href="index.html">Відкрити Get Stronger</a>';
      return;
    }

    box.innerHTML = state.mode === 'picker'
      ? '<p class="small mb-0"><b>Крок 3 з 3: оберіть програму.</b> ' +
          'Натисніть «Показати план», перегляньте дні й оберіть свій — далі ' +
          'лишиться вписати робочу вагу.</p>'
      : '<p class="small mb-0"><b>Останній крок: впишіть робочу вагу хоча б для однієї вправи.</b> ' +
          'Після першої збереженої ваги Get Stronger відкриється повністю; решту ' +
          'можна додати будь-коли.</p>';
  }

  function refresh() {
    const available = PROGRAMS_FOR_ME().filter(function (p) { return supports(p, state.days); });

    if (state.programId && !available.some(function (p) { return p.id === state.programId; })) {
      state.programId = null;
      state.plan = null;
      state.editing = false;
    }
    if (state.programId && !state.plan) {
      state.plan = loadPlan(state.programId, state.days);
    }

    renderList();
    renderPlan();
    updateOnboardBanner();

    const hint = $('#pick-hint');
    if (hint) hint.style.display = state.plan ? 'none' : '';
  }

  /* ------------------------------------------------------------------ */

  async function init() {
    const isPicker = Boolean($('#program-list'));
    const isMine   = Boolean($('#my-plan'));
    if (!isPicker && !isMine) return;
    state.mode = isPicker ? 'picker' : 'mine';

    let profile = {};
    try {
      profile = await window.Store.getProfile() || {};
      state.profile = profile;
      /* Свої вправи доклеюємо ДО першої перемальовки: інакше випадайка
         заміни вперше малюється без них і мовчки «не знає» вправу, яка
         вже стоїть у плані. */
      syncUserExercises();
      if (profile.customPlans && typeof profile.customPlans === 'object') {
        state.custom = profile.customPlans;
      }
      // Копії, а не аліаси: state.weights = profile.weights мутував кеш
      // Store прямо на місці, тож навіть провалене збереження лишало
      // сторінку й кеш у стані, якого немає ні в localStorage, ні в хмарі.
      if (profile.weights && typeof profile.weights === 'object') {
        state.weights = Object.assign({}, profile.weights);
      }
      if (profile.weightLog && typeof profile.weightLog === 'object') {
        state.weightLog = Object.assign({}, profile.weightLog);
      }
      if (profile.warmups && typeof profile.warmups === 'object') {
        state.warmups = Object.assign({}, profile.warmups);
      }

      // Разова міграція: до цієї версії вага лежала всередині плану.
      // Забираємо її звідти в книгу, щоб старі збережені плани не втратили
      // введені числа.
      /*
       * Разова — означає РАЗОВА. Раніше вона крутилась при кожному
       * завантаженні, а правило «беремо більше число» щоразу воскрешало
       * скинуті ваги: делоуд 100 -> 90, F5, міграція бачить 100 у старому
       * плані й повертає 100. Скидання мовчки скасовувалось.
       */
      if (!profile.weightsHarvested) {
        const moved = harvestWeights(state.custom);
        Object.keys(state.weights).forEach(function (n) {
          logWeight(n, Number(state.weights[n]));
        });
        saveOwn({
          weights: state.weights,
          weightLog: state.weightLog,
          weightsHarvested: true
        }).catch(function (e) {
          if (!(e && e.queued)) console.warn('[programs] міграція ваг не збереглась:', e.message);
        });
      }
      if (profile.activePlan && profile.activePlan.programId) {
        state.active = profile.activePlan;
      }
      if (profile.deload && typeof profile.deload === 'object' && profile.deload.before) {
        state.deload = profile.deload;
      }
    } catch (_) { /* профіль необовʼязковий */ }

    /*
     * Профіль міг змінитись деінде — і найчастіше саме так і буває:
     * робочу вагу тепер правлять на «Сьогодні», а ця сторінка тримала
     * weights/weightLog/customPlans з МОМЕНТУ ЗАВАНТАЖЕННЯ і писала їх
     * назад цілими обʼєктами. Будь-яке натискання «+2,5 кг» після правки
     * в сусідній вкладці стирало і нову вагу, і її запис в історії.
     *
     * Перемальовуємо лише коли користувач зараз не набирає в полі: інакше
     * власне ж збереження ваги вибивало б курсор із поля, у яке вписують.
     */
    watchFieldFocus();

    window.Store.onChange(function (profile) {
      if (!profile) return;
      state.profile = profile;
      /*
       * typing — людина зараз (або щойно) у полі. selfWrite — профіль
       * змінили МИ САМІ секунду тому: власне збереження ваги поверталось
       * сюди через onChange і перебудовувало сторінку, з якою в цю мить
       * працюють. В обох випадках стан нижче оновлюємо як завжди — губити
       * дані не можна, — але повний refresh() замінюємо на точкове
       * оновлення полів.
       */
      const typing = busyWithField();
      const selfWrite = (Date.now() - lastSelfWrite) < SELF_WRITE_MS;

      if (profile.weights && typeof profile.weights === 'object') {
        state.weights = Object.assign({}, profile.weights);
      }
      if (profile.weightLog && typeof profile.weightLog === 'object') {
        state.weightLog = Object.assign({}, profile.weightLog);
      }
      if (profile.warmups && typeof profile.warmups === 'object') {
        state.warmups = Object.assign({}, profile.warmups);
      }
      if (profile.customPlans && typeof profile.customPlans === 'object') {
        state.custom = profile.customPlans;
      }
      syncUserExercises();
      state.deload = (profile.deload && typeof profile.deload === 'object' && profile.deload.before)
        ? profile.deload : null;

      if (typing || selfWrite) { syncWeightInputs(null); return; }
      refresh();
    });

    if (state.mode === 'mine') {
      // Сторінка «Мій план тренувань» показує рівно те, що обрано. Немає вибору —
      // немає й плану: далі все віддає порожній стан у розмітці сторінки.
      if (!state.active) { renderEmpty(); return; }
      state.programId = state.active.programId;
      state.days = Number(state.active.days) || 3;
      if (!basePlan(state.programId, state.days)) { renderEmpty(); return; }
      wirePlanHost();
      refresh();
      announce();
      return;
    }

    if (profile.daysPerWeek) {
      const el = $$('input[name="days"]').find(function (x) { return Number(x.value) === profile.daysPerWeek; });
      if (el) el.checked = true;
    }
    if (profile.programId) state.programId = profile.programId;

    const readDays = function () {
      const el = $$('input[name="days"]').find(function (r) { return r.checked; });
      return el ? Number(el.value) : 3;
    };

    /*
     * Показуємо лише ті кількості днів, для яких у ЦІЄЇ статі є хоч одна
     * схема. Раніше жінка бачила 3/4/5/6, а план був лише на 4 — вибір
     * 3, 5 чи 6 давав порожній список «Доступна при 4 дн.» і глухий кут
     * в онбордингу. Зайві варіанти ховаємо, а не вимикаємо: вимкнена
     * кнопка виглядає як зламана.
     */
    const syncDayOptions = function () {
      const allowed = {};
      PROGRAMS_FOR_ME().forEach(function (p) {
        (p.daysSupported || []).forEach(function (d) { allowed[d] = true; });
      });
      let checked = null;
      $$('input[name="days"]').forEach(function (el) {
        const ok = Boolean(allowed[Number(el.value)]);
        const item = el.closest('label') || el;
        item.hidden = !ok;
        if (!ok && el.checked) el.checked = false;
        if (ok && el.checked) checked = el;
      });
      if (!checked) {
        const first = $$('input[name="days"]').find(function (el) { return allowed[Number(el.value)]; });
        if (first) first.checked = true;
      }
    };
    syncDayOptions();
    state.days = readDays();

    $$('input[name="days"]').forEach(function (el) {
      el.addEventListener('change', function () {
        state.days = readDays();
        state.plan = state.programId ? loadPlan(state.programId, state.days) : null;
        state.editing = false;
        refresh();
      });
    });


    $('#program-list').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
      state.programId = btn.dataset.pick;
      state.plan = loadPlan(state.programId, state.days);
      saveOwn({ programId: state.programId, daysPerWeek: state.days }).catch(function (e) { if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err'); });
      refresh();
      $('#plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    wirePlanHost();
    refresh();
  }

  /** Порожній стан сторінки «Мій план тренувань» */
  function renderEmpty() {
    const host = $('#my-plan');
    if (host) host.dataset.state = 'empty';
    announce();
  }

  /* Таймер відпочинку тепер спільний — window.App.restTimer (js/app.js):
     ним користуються «Мій план тренувань» і «Сьогодні». Тут лишився тільки виклик. */

  /** Спільна для обох сторінок обробка кліків і правок усередині плану */
  function wirePlanHost() {
    const planHost = $('#plan');
    if (!planHost) return;

    planHost.addEventListener('click', function (e) {
      if (e.target.closest('#toggle-edit')) {
        state.editing = !state.editing;
        /*
         * Режим правки більше не розгортає весь тиждень. Але вмикати його
         * над повністю згорнутим планом теж безглуздо — правити було б
         * нічого. Тому: відкриті дні лишаються як були, а якщо не відкрито
         * жодного — розкриваємо один, перший із вправами.
         */
        let want = openAccIndexes(planHost);
        if (state.editing && !want.length) {
          const first = firstDayAccIndex(planHost);
          if (first >= 0) want = [first];
        }
        renderPlan(want);
        return;
      }
      const bump = e.target.closest('[data-bump]');
      if (bump) {
        // Галочка вирішує, чи їдуть ноги разом із верхом
        bumpWeights(Number(bump.dataset.bump), state.bumpLegs ? 'all' : 'other');
        return;
      }
      const bumpLegs = e.target.closest('[data-bump-legs]');
      if (bumpLegs) {
        bumpWeights(Number(bumpLegs.dataset.bumpLegs), 'legs');
        return;
      }
      const restBtn = e.target.closest('[data-rest-sec]');
      if (restBtn) {
        window.App.restTimer.start(Number(restBtn.dataset.restSec) || 120, restBtn.dataset.restName || '');
        return;
      }
      if (e.target.closest('#deload-go')) {
        const sel = $('#deload-pct');
        doDeload(sel ? sel.value : 10);
        return;
      }
      if (e.target.closest('#deload-undo')) {
        undoDeload();
        return;
      }
      if (e.target.closest('#deload-add')) {
        doRaise(10);
        return;
      }
      if (e.target.closest('#adopt-plan')) {
        /* Перевірка перед записом, а не лише при показі: у стан можна
           потрапити не тільки кліком по картці. */
        const picked = PROGRAMS_FOR_ME().find(function (x) { return x.id === state.programId; });
        if (!picked || !supports(picked, state.days)) {
          toast('Цей план недоступний', 'err');
          refresh();
          return;
        }
        /* days — ціле число: дробове валить серверний elo_planned_for
           при першому дотику кожного нового тижня (ELO-003). */
        state.active = { programId: state.programId, days: Math.round(Number(state.days) || 0) };
        saveOwn({
          activePlan: state.active,
          programId: state.programId,
          daysPerWeek: state.days
        }).catch(function (e) { if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err'); });
        toast('План обрано — далі заповніть робочі ваги', 'ok');
        setTimeout(function () { location.href = 'plan.html'; }, 500);
        return;
      }
      if (e.target.closest('#copy-plan')) {
        const btn = e.target.closest('#copy-plan');
        const program = PROGRAMS_FOR_ME().find(function (x) { return x.id === state.programId; });
        if (!program || !state.plan) return;
        const ready = hydrate(state.plan);
        const text = planToText(program, state.days, ready);
        const html = planToHtml(program, state.days, ready);
        copyRich(html, text).then(function (ok) {
          // Підтвердження ще й на самій кнопці: тост унизу екрана, а очі — тут
          if (ok) window.App.flashDone(btn, 'Скопійовано');
          if (ok === 'rich') { toast('План скопійовано таблицею', 'ok'); return; }
          if (ok === 'text') { toast('Скопійовано текстом: таблицю браузер не віддав', 'ok'); return; }
          // Буфер недоступний — показуємо текст, щоб виділити вручну
          const box = $('#copy-fallback');
          if (box) {
            box.hidden = false;
            box.querySelector('textarea').value = text;
            box.querySelector('textarea').select();
          }
          toast('Буфер недоступний — текст нижче, скопіюйте вручну', 'err');
        });
        return;
      }
      if (e.target.closest('#add-day')) {
        onEdit('day-add', 0, 0);
        return;
      }
      if (e.target.closest('#undo-edit')) {
        // Та сама функція, що й Ctrl+Z: другого механізму скасування немає.
        undoEdit();
        return;
      }
      if (e.target.closest('#reset-plan')) {
        if (!confirm('Повернути оригінальний план? Твої правки буде втрачено.')) return;
        delete state.custom[planKey(state.programId, state.days)];
        state.plan = basePlan(state.programId, state.days);
        undoStack.length = 0;
        saveOwn({ customPlans: state.custom }).catch(function (e) { if (!(e && e.queued)) toast('Не збереглося: ' + e.message, 'err'); });
        toast('План повернуто до оригіналу', 'ok');
        refresh();
        return;
      }
      const own = e.target.closest('[data-own-new]');
      if (own) { openOwnExerciseSheet(Number(own.dataset.ownNew)); return; }

      const del = e.target.closest('[data-own-del]');
      if (del) { removeOwnExercise(del.dataset.ownDel); return; }

      const btn = e.target.closest('button[data-act]');
      if (btn && !btn.disabled) {
        onEdit(btn.dataset.act, Number(btn.dataset.day), Number(btn.dataset.i));
      }
    });

    planHost.addEventListener('change', function (e) {
      // Галочка «і на ноги теж» нічого не рахує сама — лише перемикає
      // область дії кнопок ±2,5. Перемальовуємо, щоб підпис під ними
      // одразу показував, скільки вправ це зачепить.
      if (e.target.id === 'bump-legs') {
        state.bumpLegs = Boolean(e.target.checked);
        renderPlan();
        return;
      }

      const el = e.target.closest('[data-act]');
      if (!el || el.tagName === 'BUTTON') return;
      onEdit(el.dataset.act, Number(el.dataset.day), Number(el.dataset.i), el.value);
    });

    /* Cmd+Z (мак) або Ctrl+Z — скасувати останню правку плану.
       e.code, а не e.key: на українській розкладці клавіша та сама,
       а символ інший, і по key сполучення б не ловилось. */
    document.addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const isZ = e.code === 'KeyZ' || String(e.key).toLowerCase() === 'z';
      if (!isZ) return;
      // У полях вводу працює рідне скасування тексту — не перехоплюємо
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (!state.editing || !undoStack.length) return;
      if (e.preventDefault) e.preventDefault();
      undoEdit();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
