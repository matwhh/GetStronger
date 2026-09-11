/**
 * Журнал: вага тіла по днях і позначки тренувань.
 *
 * Єдина сторінка сайту, що накопичує історію. Решта профілю — знімок
 * поточного стану; тут дані живуть за датами й не перетираються.
 *
 * bodyLog: { 'YYYY-MM-DD': кг }     — одне число на день, нове перекриває
 * workLog: { 'YYYY-MM-DD': число }  — скільки разів позначено тренування
 *
 * Дати ЛОКАЛЬНІ, не UTC. Зважування о 23:40 має лягти в сьогодні, а
 * toISOString() у Києві поклав би його у завтра.
 */
(function () {
  'use strict';

  const { $, esc, round, toast, dateLabel, fmt, fmtNum } = window.App;
  const Store = window.Store;

  const state = {
    bodyLog: {},
    workLog: {},
    sessionLog: {},  // виконання плану по днях (пише «Сьогодні»)
    weightLog: {},   // історія робочих ваг (пише «Мій план тренувань»)
    mealLog: {},     // закриті дні харчування (пише «Раціон»)
    trackers: {},    // реєстр модульних трекерів (етап 4)
    trackerLog: {},  // їхні дані
    daysTarget: 0,   // скільки днів на тиждень у обраному плані; 0 — план не обрано
    goal: null,      // ціль харчування — для коридора прогнозу на графіку
    period: 90,      // вибраний період графіка ваги, днів; 0 = весь час
    adhPeriod: 7,    // період карток «виконання плану», днів
    exName: '',      // обрана вправа в «Прогресі вправи»; '' — ще не обрано
    exMetric: 'kg',  // метрика її графіка: kg | vol | reps | e1rm
    exPeriod: 90,    // період графіка вправи, днів; 0 = весь час
    exSet: 0,        // підхід у графіку вправи: 0 = усі разом, 1..N — один
    view: 'overview',// 'overview' | 'history'
    wDay: '',        // день, у який пишеться вага (за замовчуванням сьогодні)
    hcalY: 0,        // рік/місяць календаря історії
    hcalM: 0,
    selDay: '',      // обраний день історії 'YYYY-MM-DD'
    wired: false
  };

  /* Періоди графіка ваги. 0 — весь час. */
  const PERIODS = [
    { days: 7,   label: '7д' },
    { days: 30,  label: '30д' },
    { days: 90,  label: '90д' },
    { days: 180, label: '6м' },
    { days: 365, label: 'рік' },
    { days: 0,   label: 'все' }
  ];

  /* ------------------------------------------------------------------ */
  /* Дати                                                                */
  /* ------------------------------------------------------------------ */

  /** Локальна дата → 'YYYY-MM-DD' */
  function keyOf(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayKey() { return keyOf(new Date()); }

  /** 'YYYY-MM-DD' → Date опівночі локального часу */
  function dateOf(key) {
    const p = String(key).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  /* ------------------------------------------------------------------ */
  /* Вага тіла                                                           */
  /* ------------------------------------------------------------------ */

  /* Ті самі фізіологічні межі, що в ядрі харчування */
  const W_MIN = 30, W_MAX = 300;

  /** Відсортовані записи ваги: [{key, kg}] від старих до нових */
  function weightEntries() {
    return Object.keys(state.bodyLog)
      .filter(function (k) {
        const v = Number(state.bodyLog[k]);
        return /^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isFinite(v) && v >= W_MIN && v <= W_MAX;
      })
      .sort()
      .map(function (k) { return { key: k, kg: Number(state.bodyLog[k]) }; });
  }

  /**
   * Ковзна середня за 7 днів для кожної точки.
   *
   * Середня рахується за КАЛЕНДАРНІ 7 днів назад, а не за 7 останніх
   * записів: якщо зважувань було три за тиждень, середня йде по трьох.
   * Інакше пропуски розтягували б вікно на місяць і лінія брехала б.
   */
  /*
   * ЧОМУ ТУТ ДВА ВКАЗІВНИКИ, А НЕ FILTER.
   *
   * Було: для кожного запису — прохід по всьому масиву з двома new Date на
   * ітерацію. Це O(N²) з розбором рядка дати всередині, і викликалось воно
   * двічі на кожен рендер: при відкритті журналу, після кожного «Записати»,
   * при зміні періоду і з кожного Store.onChange. На кількох роках щоденних
   * зважувань це помітне підвисання інтерфейсу на ровному місці (PRF-002).
   *
   * Записи вже відсортовані за ключем (weightEntries сортує), тому вікно
   * рухається одним указівником: складність O(N), а мітка часу рахується
   * рівно раз на запис.
   */
  /*
   * Дата «N днів тому» через setDate, а не мілісекунди (TIM-002).
   *
   * У ніч переходу на зимовий час доба триває 25 годин, і віднімання
   * N × 86400000 зсуває межу вікна на день. Помітно це рівно двічі на рік
   * і рівно там, де людина дивиться на графік і не розуміє, чому запис
   * зник.
   */
  function daysAgo(n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (Number(n) || 0));
    return d;
  }

  function rolling(entries) {
    const ts = entries.map(function (e) { return dateOf(e.key).getTime(); });
    const out = [];
    let from = 0, sum = 0;
    for (let i = 0; i < entries.length; i++) {
      sum += entries[i].kg;
      const start = ts[i] - 6 * 86400000;
      while (ts[from] < start) { sum -= entries[from].kg; from++; }
      out.push({ key: entries[i].key, kg: entries[i].kg, avg: sum / (i - from + 1) });
    }
    return out;
  }

  /*
   * Один розрахунок на рендер замість двох.
   *
   * renderWeight кличе rolling по всіх записах, а chartSvg — ще раз, і лише
   * ПОТІМ обрізає за періодом. Кеш тримається на самому масиві записів:
   * зміниться вміст журналу — зміниться й посилання, і кеш сам застаріє.
   */
  let rollCache = { src: null, out: null };
  function rollingCached(entries) {
    if (rollCache.src === entries) return rollCache.out;
    rollCache = { src: entries, out: rolling(entries) };
    return rollCache.out;
  }

  /* ------------------------------------------------------------------ */
  /* Спільна геометрія графіків                                          */
  /* ------------------------------------------------------------------ */
  /*
   * СТАНДАРТ ГРАФІКІВ Get Stronger: ЛІНІЯ, А НЕ СТОВПЧИКИ.
   *
   * Кожен графік сайту — це ЛІНІЯ з крапками на точках даних, сітка,
   * підписана ліва шкала й заливка під лінією. Стовпчиків на графіках
   * немає ніде: ні як другої серії, ні як «підпори» під крапками. Так
   * малюють і графік ваги, і прогрес вправи, і спарклайни силових
   * (lift__spark / lift__chart), і заміри тіла (js/measure.js), і
   * прогноз маси (js/projection.js). Нові графіки роблять так само.
   *
   * ЧОМУ. Стовпчик — це відстань ВІД ЧОГОСЬ, і читається він як частка
   * від нуля. Але жоден показник Get Stronger не має осмисленого нуля в
   * масштабі свого графіка: вага тіла живе в діапазоні 80–85 кг, 1RM —
   * 95–110. Графік від нуля перетворює всю різницю на плоский паркан, а
   * графік від «зручного» дна робить висоти стовпчиків неправдивими —
   * удвічі вищий стовпчик не означає удвічі більше число. Лінія такої
   * проблеми не має: вона показує ЗМІНУ, а не частку, і зрізана шкала їй
   * не шкодить, бо ніхто й не читає лінію як пропорцію.
   *
   * Це не стосується горизонтальних смуг прогресу (.vol__bar,
   * .macrobar, .qi-bar__track): там нуль реальний і смуга означає саме
   * частку від цілого. Смуга ≠ графік.
   *
   * chartScale() і chartRows() — спільна арифметика шкали для всіх
   * графіків: 12% повітря, крок 1/2/5×10ⁿ, дно й стеля округлені до
   * кроку, не більше шести рядків сітки.
   */

  /** Крок шкали «1 / 2 / 5 × 10ⁿ» для діапазону значень. */
  function niceStep(range) {
    const raw = Math.abs(range || 1) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    return (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  }

  /** Наступний крок того ж ряду: 1 → 2 → 5 → 10. */
  function nextStep(step) {
    const mag = Math.pow(10, Math.floor(Math.log10(step) + 1e-9));
    const norm = Math.round(step / mag);
    return (norm <= 1 ? 2 : norm <= 2 ? 5 : 10) * mag;
  }

  /**
   * Дно, стеля й крок поля для діапазону даних lo…hi.
   *
   * 12% повітря зверху й знизу, потім округлення до кроку — щоб нижній
   * рядок шкали був числом, яке не соромно показати («95», а не
   * «94,73»). Якщо всі дані невідʼємні, а дно вийшло нижче нуля, дно
   * стає нулем: тоді стовпчики чесні від початку й підпис не потрібен.
   */
  function chartScale(lo, hi) {
    const spread = (hi - lo) || Math.max(Math.abs(hi) * 0.1, 1);
    const air = (hi === lo) ? spread / 2 : spread * 0.12;
    const min = lo - air, max = hi + air;
    let step = niceStep(max - min);
    let base = 0, roof = 0;
    /* Крок піднімаємо доти, доки рядків не стане щонайбільше шість. Це
       дешевше, ніж прорідити готовий ряд удвічі: прорідження ламає
       рівність кроків (76·80·84·86 замість 75·80·85·90), а нерівна шкала
       бреше сильніше за зайву лінію. */
    for (let guard = 0; guard < 8; guard++) {
      base = Math.floor(min / step) * step;
      roof = Math.ceil(max / step) * step;
      if (lo >= 0 && base < 0) base = 0;
      if (roof <= base) roof = base + step;
      if (Math.round((roof - base) / step) <= 5) break;
      step = nextStep(step);
    }
    /* Хвіст плаваючої точки: 0.1*3 дає 0.30000000000000004, і це поповзе
       в підпис осі. Округлення на два розряди точніше за крок. */
    const dec = Math.max(0, -Math.floor(Math.log10(step)));
    return {
      base: Number(base.toFixed(dec + 2)),
      roof: Number(roof.toFixed(dec + 2)),
      step: step,
      dec: dec
    };
  }

  /** Значення рядків шкали: від дна до стелі рівним кроком. */
  function chartRows(sc) {
    /* Лічильник, а не накопичення v += step: на кроці 0,1 сорок додавань
       дають 4.000000000000002, і останній рядок промахується повз стелю. */
    const cnt = Math.max(1, Math.round((sc.roof - sc.base) / sc.step));
    const out = [];
    for (let i = 0; i <= cnt; i++) {
      out.push(Number((sc.base + sc.step * i).toFixed(sc.dec + 2)));
    }
    return out;
  }

  /**
   * Графік ваги: стовпчик і крапка на кожне зважування, лінія — ковзна
   * середня за 7 днів, пунктир — коридор цілі.
   *
   * Шкала часу, а не порядкових номерів: пропущений тиждень має виглядати
   * як пропущений тиждень, інакше графік ваги бреше про темп.
   *
   * SVG будується рядком без бібліотек, як і решта графіки сайту.
   */
  /** Записи, які потрапляють на графік у поточному періоді. */
  function chartData(entries) {
    const all = rollingCached(entries);
    return state.period
      ? all.filter(function (e) { return e.key >= keyOf(daysAgo(state.period)); })
      : all;
  }

  /**
   * Чи має сенс показувати ковзну середню на цьому наборі.
   *
   * Середня за 7 днів на двох записах за пʼять днів не згладжує нічого —
   * вона ділить два числа навпіл і малює лінію, якої в даних немає. І
   * саме тоді розрив між лінією та крапками найбільший: графік читається
   * як поламаний.
   *
   * Пʼять записів і тиждень охоплення — та межа, від якої вікно з семи
   * днів справді щось усереднює.
   */
  function avgWorth(data) {
    if (!data || data.length < 5) return false;
    const t0 = dateOf(data[0].key).getTime();
    const t1 = dateOf(data[data.length - 1].key).getTime();
    return (t1 - t0) / 86400000 >= 7;
  }

  function chartSvg(entries) {
    const data = chartData(entries);
    if (data.length < 2) return '';

    /* Полотно вужче на телефоні: viewBox стискає текст разом із графікою,
       і 11 одиниць підпису на 640 px полотна стають 5 фізичними px. */
    const narrow = (window.innerWidth || 1024) < 560;
    const W = narrow ? 380 : 640, H = narrow ? 200 : 220;
    const PAD = {
      l: narrow ? 42 : 50,
      r: narrow ? 12 : 14,
      t: narrow ? 12 : 16,
      b: narrow ? 26 : 30
    };
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const y0 = H - PAD.b;

    const t0 = dateOf(data[0].key).getTime();
    const t1 = dateOf(data[data.length - 1].key).getTime();

    // Коридор прогнозу рахуємо ДО шкали: його межі мають вміститись у
    // полотно, інакше пунктир упирався б у край і брехав плоскою лінією.
    const fc = window.ProgressCore && state.goal
      ? window.ProgressCore.forecast(state.bodyLog, state.goal, state.period || null)
      : null;

    const kgs = data.map(function (e) { return e.kg; })
      .concat(data.map(function (e) { return e.avg; }));
    if (fc) {
      const spanD = (t1 - dateOf(fc.anchor.d).getTime()) / 86400000;
      kgs.push(fc.lo(spanD), fc.hi(spanD));
    }
    let lo = Math.min.apply(null, kgs), hi = Math.max.apply(null, kgs);
    // Мінімальний розмах пів кіло: інакше при стабільній вазі шум ±100 г
    // розтягується на всю висоту й виглядає як драма
    if (hi - lo < 0.5) { const mid = (hi + lo) / 2; lo = mid - 0.25; hi = mid + 0.25; }

    const sc = chartScale(lo, hi);

    /* Інсет 4 px по краях: крайні крапки стоять рівно на межах шкали
       часу, і без нього кружок наполовину зрізало рамкою поля. */
    const span = Math.max(1, t1 - t0);
    const IN = 4;
    const px = function (t) {
      return PAD.l + IN + (innerW - IN * 2) * (t - t0) / span;
    };
    const py = function (kg) { return PAD.t + innerH * (1 - (kg - sc.base) / (sc.roof - sc.base)); };
    const fmtV = function (v) { return fmtNum.n(v, Math.min(sc.dec, 2)); };

    const xs = data.map(function (e) { return px(dateOf(e.key).getTime()); });

    /* ---- сітка й ліва шкала ---- */
    const grid = chartRows(sc).map(function (v) {
      const y = round(py(v), 1);
      return '<line class="exc__grid" x1="' + PAD.l + '" y1="' + y + '" x2="' + (W - PAD.r) + '" y2="' + y + '"/>' +
             '<text class="exc__ylab" x="' + (PAD.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
             esc(fmtV(v)) + '</text>';
    }).join('');

    /* Крапка міряється кроком між зважуваннями: при 120 щоденних записах
       крок падає до 4 px, і кружки радіусом 3,5 злипаються в гусеницю. */
    let gap = innerW;
    for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
    const dr = Math.max(2, Math.min(3.5, gap * 0.34));
    const dsw = Math.max(1.2, Math.min(2, dr * 0.6));

    /*
     * ДВІ ЛІНІЇ, І КРАПКИ ЗАВЖДИ НА СВОЇЙ.
     *
     * Було так: крапки — фактичні зважування, а ЄДИНА лінія — ковзна
     * середня за 7 днів. На папері логічно (вагу треба читати по
     * середній, добові коливання ±1 кг нічого не означають), на екрані —
     * зламано: крапка стоїть на 68,5, лінія над нею на 69,3, і між ними
     * нічого. Око не читає це як «дві різні величини», воно читає це як
     * помилку побудови — і має рацію: у графіку не було лінії, що
     * зʼєднує його ж крапки.
     *
     * Тепер їх дві. Тонка приглушена йде ЧЕРЕЗ крапки — це факт, шум і
     * все. Товста світла — середня, і вона лишається головною.
     *
     * КОЛИ СЕРЕДНЬОЇ НЕМАЄ ВЗАГАЛІ. Ковзна за 7 днів на двох записах за
     * пʼять днів не згладжує нічого: вона просто ділить два числа навпіл
     * і малює лінію, якої в даних немає. Саме цей випадок і виглядав
     * найгірше. Поріг — пʼять записів і тиждень охоплення: менше — і
     * головною стає лінія факту, а середньої на графіку немає.
     */
    const showAvg = avgWorth(data);

    const avgPts = data.map(function (e, i) {
      return round(xs[i], 1) + ' ' + round(py(e.avg), 1);
    });
    const kgPts = data.map(function (e, i) {
      return round(xs[i], 1) + ' ' + round(py(e.kg), 1);
    });

    /* Заливка йде під ГОЛОВНОЮ лінією — під тією, яку читають. */
    const mainPts = showAvg ? avgPts : kgPts;
    const area = '<path class="wc__area" d="M' + round(xs[0], 1) + ' ' + y0 +
                 'L' + mainPts.join('L') + 'L' + round(xs[xs.length - 1], 1) + ' ' + y0 + 'Z"/>';
    const line =
      (showAvg ? '<path class="wc__fact" d="M' + kgPts.join('L') + '"/>' : '') +
      '<path class="exc__line" pathLength="1" d="M' + mainPts.join('L') + '"/>';

    /*
     * Прогноз проти факту — коридор цілі поверх графіка.
     *
     * Дві пунктирні межі від першої точки видимого періоду: де вага мала б
     * бути за обраної цілі (числа — ті самі діапазони, що написані словами
     * в калькуляторі). Це модель, не обіцянка — тому пунктир і нейтральна
     * прозорість, а не друга «справжня» лінія.
     */
    let corridor = '';
    if (fc) {
      const t0a = dateOf(fc.anchor.d).getTime();
      const steps = 24;
      const seg = function (f) {
        const out = [];
        for (let i = 0; i <= steps; i++) {
          const t = t0a + (t1 - t0a) * i / steps;
          out.push((out.length ? 'L' : 'M') +
            round(px(t), 1) + ' ' + round(py(f((t - t0a) / 86400000)), 1));
        }
        return out.join('');
      };
      corridor =
        '<path class="wc__fc" d="' + seg(fc.hi) + '"/>' +
        '<path class="wc__fc" d="' + seg(fc.lo) + '"/>';
    }

    /* ---- колонки: крапка, перехрестя, зона наведення ---- */
    const cols = data.map(function (e, i) {
      const cx = xs[i], cy = py(e.kg);
      const left = i ? (xs[i - 1] + cx) / 2 : cx - gap / 2;
      const right = i < xs.length - 1 ? (cx + xs[i + 1]) / 2 : cx + gap / 2;
      const d = dateLabel(dateOf(e.key));
      return '<g class="exc__col"' +
               ' data-d="' + esc(d) + '"' +
               ' data-v="' + esc(fmtNum.kg(e.kg) + ' кг') + '"' +
               /* Про середню в підказці мовчимо, коли її немає на
                  графіку: підпис до лінії, якої не видно, — це загадка,
                  а не пояснення. */
               ' data-sub="' + (showAvg ? esc('середня ' + fmtNum.kg(e.avg) + ' кг') : '') + '">' +
               '<title>' + esc(d + ': ' + fmtNum.kg(e.kg) + ' кг' +
                 (showAvg ? ' · середня ' + fmtNum.kg(e.avg) + ' кг' : '')) + '</title>' +
               '<line class="exc__cross" x1="' + round(cx, 1) + '" y1="' + PAD.t + '" x2="' + round(cx, 1) + '" y2="' + y0 + '"/>' +
               '<circle class="exc__dot" cx="' + round(cx, 1) + '" cy="' + round(cy, 1) +
                 '" r="' + round(dr, 2) + '"' +
                 ' style="stroke-width:' + round(dsw, 2) + 'px;animation-delay:' +
                 Math.min(240 + i * 12, 520) + 'ms"/>' +
               '<rect class="exc__hit" x="' + round(Math.max(PAD.l, left), 1) + '" y="' + PAD.t +
                 '" width="' + round(Math.min(W - PAD.r, right) - Math.max(PAD.l, left), 1) +
                 '" height="' + innerH + '"/>' +
             '</g>';
    }).join('');

    /* ---- підписи дат: перша, середня, остання ---- */
    const n = data.length;
    const idx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
    const xlab = idx.filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (i) {
      /* Підпис кріпиться до СВОГО стовпчика, а не до рамки поля: інакше
         крайні дати відʼїжджають від своїх стовпчиків на півширини смуги
         й графік читається перекошеним. */
      const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
      const x = i === 0 ? xs[i] - dr : (i === n - 1 ? xs[i] + dr : xs[i]);
      return '<text class="exc__xlab" x="' + round(x, 1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' +
             esc(shortDate(data[i].key)) + '</text>';
    }).join('');

    const axis = '<line class="exc__axis" x1="' + PAD.l + '" y1="' + y0 + '" x2="' + (W - PAD.r) + '" y2="' + y0 + '"/>';

    return '<svg class="exc" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
             'aria-label="Графік ваги тіла: ' + n + ' ' +
               window.App.plural(n, 'зважування', 'зважування', 'зважувань') + '">' +
             '<defs><linearGradient id="wc-fill" x1="0" y1="0" x2="0" y2="1">' +
               '<stop offset="0" stop-color="rgb(var(--acc-rgb))" stop-opacity="0.22"/>' +
               '<stop offset="1" stop-color="rgb(var(--acc-rgb))" stop-opacity="0"/>' +
             '</linearGradient></defs>' +
             grid + area + line + corridor + cols + axis + xlab +
           '</svg>';
  }


  /* ------------------------------------------------------------------ */
  /* Огляд: «прогресую чи ні» за кілька секунд                           */
  /* ------------------------------------------------------------------ */
  /*
   * Чотири плитки — вага, сила, тренування, харчування. Кожна: головне
   * число + один рядок тренду. Деталі — нижче у своїх секціях; огляд не
   * дублює графіки, він відповідає на перше питання сторінки.
   */

  function overviewTiles() {
    const PC = window.ProgressCore;
    /*
     * ВІКНО В ДНЯХ — ЦЕ ВІКНО В ДНЯХ, А НЕ «ЗА СЕЗОН» (UX-002).
     *
     * Плитки з явним вікном (8 тижнів сили, 30 днів харчування, 30 днів
     * часу, adherence за 6 повних тижнів) рахувались по СЕЗОННОМУ зрізу.
     * Сезон AUTUMN-2026 почався 1 вересня, тож увесь інтервал adherence
     * лежав ПОЗА зрізом — і плитка структурно показувала нуль, тоді як
     * картка «Тренування» нижче на тій самій сторінці рахувала по повних
     * журналах і показувала правду. Дві цифри про одне й те саме
     * суперечили одна одній, і жодна не пояснювала, звідки взялась.
     *
     * Тому: «цього тижня» — за сезоном (це сезонний лічильник), усе з
     * вікном у днях — за повними журналами.
     */
    const sign = function (n) { return fmtNum.signed(n, 1); };
    const tiles = [];

    // Вага: середнє за 7 днів + темп за 30 днів
    const b30 = PC.bodyStats(state.bodyLog, 30);
    tiles.push(b30
      ? { val: fmtNum.kg(b30.current) + ' кг', lbl: 'вага',
          trend: b30.perWeek !== null ? sign(b30.perWeek) + ' кг/тиж' : 'перший запис' }
      : { val: '—', lbl: 'вага', trend: 'ще без записів' });

    // Сила: найбільший приріст вправи за 8 тижнів
    const lift = PC.bestLift(state.weightLog, 56);
    tiles.push(lift
      ? { val: sign(lift.delta) + ' кг', lbl: 'сила · ' + lift.name, trend: lift.from + ' → ' + lift.to + ' за 8 тиж' }
      : { val: '—', lbl: 'сила', trend: 'без змін ваг' });

    // Тренування: цього тижня X з Y (або всього)
    const tr = PC.trainingStats(sn.workLog, sn.sessionLog, state.daysTarget);
    /* adherence має вікно в тижнях — беремо його з повних журналів. */
    const trFull = PC.trainingStats(state.workLog, state.sessionLog, state.daysTarget);
    tiles.push({
      val: state.daysTarget ? tr.thisWeek + ' з ' + state.daysTarget : String(tr.thisWeek),
      lbl: 'тренувань цього тижня',
      trend: trFull.adherence
        ? trFull.adherence.done + ' із ' + trFull.adherence.planned + ' за ' + trFull.adherence.weeks + ' тиж'
        : tr.total + ' всього'
    });

    // Харчування: середнє проти цілі за 30 днів
    const f = PC.foodStats(state.mealLog, 30);
    tiles.push(f && f.avgTarget
      ? { val: f.avgKcal + ' / ' + f.avgTarget, lbl: 'ккал: середнє / ціль',
          trend: f.inTarget + ' із ' + f.withTarget + ' днів у межах ±5%' }
      : f
        ? { val: String(f.avgKcal), lbl: 'ккал у середньому', trend: f.count + ' закритих днів' }
        : { val: '—', lbl: 'харчування', trend: 'ще без закритих днів' });

    // Дві плитки нижче зʼявляються лише З ДАНИМИ: порожня плитка з «—»
    // тут була б шумом, а не оглядом (плитки вище — базові чотири осі).

    // Середня тривалість тренування — зі знімків часу сесій
    const ts = PC.timeStats(state.sessionLog, 30);
    if (ts) tiles.push({
      val: durTxt(ts.avgMin), lbl: 'середнє тренування',
      trend: ts.count + ' ' + window.App.plural(ts.count, 'сесія', 'сесії', 'сесій') + ' за 30 днів'
    });

    // Нові особисті рекорди за 30 днів
    const prsNew = PC.prList(state.weightLog, 30).filter(function (x) { return x.isNew; }).length;
    if (prsNew) tiles.push({
      val: '+' + prsNew, lbl: 'PR за 30 днів', trend: 'нові максимуми робочих ваг'
    });

    return tiles;
  }

  function renderOverview() {
    const host = $('#jr-overview');
    if (!host || !window.ProgressCore) return;

    const tiles = overviewTiles();
    const SC = window.SeasonCore;
    host.innerHTML =
      '<div class="card">' +
        (SC
          ? '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">' +
              '<h2 style="margin:0">Огляд</h2>' +
              '<span class="small muted">' + esc(SC.label()) + '</span>' +
            '</div>'
          : '') +
        '<div class="kpis' + (SC ? ' mt-2' : '') + '">' +
          tiles.map(function (t) {
            return '<div class="kpi">' +
              '<div class="kpi__val mono">' + t.val + '</div>' +
              '<p class="kpi__lbl">' + esc(t.lbl) + '</p>' +
              '<p class="kpi__trend small muted">' + esc(t.trend) + '</p>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  /** Рядок статистики вибраного періоду: зміна, темп, середня */
  function weightPeriodLine() {
    const st = window.ProgressCore
      ? window.ProgressCore.bodyStats(state.bodyLog, state.period || null)
      : null;
    if (!st || st.count < 2) return '';
    const sign = function (n) { return fmtNum.signed(n, 1); };
    return '<div class="row mt-1" style="gap:16px;flex-wrap:wrap">' +
      '<span class="small">За період: <b class="mono">' + sign(st.delta) + ' кг</b></span>' +
      (st.perWeek !== null ? '<span class="small">Темп: <b class="mono">' + sign(st.perWeek) + ' кг/тиж</b></span>' : '') +
      '<span class="small">Середня: <b class="mono">' + fmtNum.kg(st.avg) + ' кг</b></span>' +
      '<span class="small muted">' + st.count + ' ' + window.App.plural(st.count, 'запис', 'записи', 'записів') + '</span>' +
    '</div>';
  }

  /** Вердикт «прогноз проти факту» — словами, без ілюзії точності */
  function forecastLine() {
    const fc = window.ProgressCore && state.goal
      ? window.ProgressCore.forecast(state.bodyLog, state.goal, state.period || null)
      : null;
    if (!fc) return '';
    const s = function (n) { return fmtNum.signed(n, 1); };
    const VERDICT = {
      within: 'у межах моделі',
      above: 'вище за коридор моделі',
      below: 'нижче за коридор моделі'
    };
    return '<p class="small mt-1" style="margin-bottom:0">' +
      'Прогноз проти факту за ' + fc.weeks + ' тиж: модель очікувала ' +
      '<b class="mono">' + s(fc.expectLo) + '…' + s(fc.expectHi) + ' кг</b>, ' +
      'фактично <b class="mono">' + s(fc.actual) + ' кг</b> — ' + VERDICT[fc.verdict] + '.' +
    '</p>';
  }

  /**
   * КАЛЕНДАР ЗВАЖУВАНЬ — та сама сітка, що в теплокарті тренувань.
   *
   * Розмітка й класи спільні (.mcal), тож вигляд однаковий без жодного
   * дубля стилів: підписи днів колонкою зліва, тижні колонками вправо,
   * підписи місяців над ними, роздільник у проміжку.
   *
   * ШКАЛА ТУТ ДВІЙКОВА, і це не спрощення. У теплокарті глибина заливки
   * означає частку закритих підходів — у ваги такої величини не існує:
   * зважування або було, або ні. Фарбувати клітинку за самим числом
   * (важчий день — темніший) означало б показати шкалу, у якої немає
   * нуля й немає межі; графік вище відповідає на це питання чесно.
   *
   * Клік по дню не пише нічого сам — він ОБИРАЄ день, у який піде
   * наступний запис. Мовчазна правка ваги за минулий четвер одним тапом
   * була б надто легкою для даних, які потім рахують тренд.
   */
  function weightCalHtml() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - (HM_MONTHS - 1), 1);
    const today = todayKey();
    return window.DayCal.html({
      from: keyOf(first),
      to: today,
      label: 'Календар зважувань за ' + HM_MONTHS + ' місяців',
      cls: 'mt-2',
      cell: function (k, d, isFuture) {
        if (isFuture) return null;
        const kg = Number(state.bodyLog[k]);
        const has = Number.isFinite(kg) && kg > 0;
        const sel = k === weightDay();
        /* Шкала тут БІНАРНА (0 або 4), і це свідома відмінність від
           календаря тренувань. Там рівень означає частку закритих
           підходів; у зважуванні часток немає — вага або записана, або
           ні. Малювати «наполовину зважений день» не було б чим. */
        return {
          lvl: has ? 4 : 0,
          sel: sel,
          attrs: 'data-wday="' + k + '"',
          label: dateLabel(dateOf(k)) +
            (has ? ': ' + fmtNum.kg(kg) + ' кг' : ': запису немає') +
            '. Натисніть, щоб вписати вагу за цей день'
        };
      }
    });
  }

  /** День, у який пишеться вага. Порожній або майбутній → сьогодні. */
  function weightDay() {
    const k = state.wDay;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(k || '')) || k > todayKey()) return todayKey();
    return k;
  }

  function renderWeight() {
    const host = $('#jr-weight');
    if (!host) return;

    const entries = weightEntries();
    const today = todayKey();
    /* Пишемо не обовʼязково в сьогодні: календар нижче обирає день. */
    const day = weightDay();
    const isToday = day === today;
    const todayVal = state.bodyLog[day];
    const last = entries.slice(-10).reverse();
    const withAvg = rollingCached(entries);
    const avgNow = withAvg.length ? withAvg[withAvg.length - 1].avg : null;

    // Тижнева динаміка середньої: те число, з яким порівнюється ціль
    let weekDelta = null;
    if (withAvg.length >= 2) {
      const weekAgoKey = keyOf(daysAgo(7));
      const older = withAvg.filter(function (e) { return e.key <= weekAgoKey; });
      if (older.length) weekDelta = avgNow - older[older.length - 1].avg;
    }

    const svg = chartSvg(entries);

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">Вага тіла</h2>' +
          (avgNow !== null
            /* Кома, як і всюди в показі чисел (App.fmt). Панель показувала
               «82,5 кг», а цей чип за один клік звідти — «82.5 кг»: те саме
               число в тих самих одиницях двома написаннями. */
            ? '<span class="chip chip--acc mono" title="Ковзне середнє за 7 днів">' + fmt(round(avgNow, 1)) + ' кг' +
              (weekDelta !== null
                ? ' · ' + (weekDelta >= 0 ? '+' : '') + fmt(round(weekDelta, 2)) + ' / тижд.'
                : '') + '</span>'
            : '') +
        '</div>' +

        '<div class="row mt-2" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
          '<div class="field" style="margin:0">' +
            '<label class="field__label" for="w-kg">' +
              (isToday ? 'Сьогодні, кг' : esc(dateLabel(dateOf(day))) + ', кг') +
            '</label>' +
            '<input class="input mono" type="text" inputmode="decimal" id="w-kg" style="width:130px" ' +
              'min="' + W_MIN + '" max="' + W_MAX + '" step="0.1" ' +
              'value="' + (todayVal != null ? esc(todayVal) : '') + '" placeholder="82.4">' +
          '</div>' +
          '<button class="btn btn--primary btn--sm" type="button" id="w-add">' +
            (todayVal != null ? 'Оновити' : 'Записати') +
          '</button>' +
          /* Повернутись у «сьогодні» має бути видно одразу: інакше людина,
             що глянула минулий тиждень, потім мовчки перезапише не той
             день. Кнопка є лише тоді, коли обрано НЕ сьогодні. */
          (isToday ? '' :
            '<button class="btn btn--ghost btn--sm" type="button" id="w-today">Сьогодні</button>') +
          '<span class="small muted">' +
            (isToday
              ? 'Найкраще — щоранку після туалету, до їжі. Однакові умови важливіші за точність ваг.'
              : 'Запис піде в цей день. Календар нижче — щоб дописати пропущене.') +
          '</span>' +
        '</div>' +

        (entries.length >= 2
          ? '<div class="seg mt-2" role="radiogroup" aria-label="Період графіка">' +
              PERIODS.map(function (pp) {
                return '<label class="seg__item"><input type="radio" name="w-period" value="' + pp.days + '"' +
                  (pp.days === state.period ? ' checked' : '') + '><span>' + pp.label + '</span></label>';
              }).join('') +
            '</div>'
          : '') +

        (svg ? '<div class="wchart wchart--live mt-2" id="w-chart">' + svg +
                 '<div class="chart-tip" id="w-tip" hidden></div>' +
               '</div>' +
               weightPeriodLine() +
               forecastLine() +
               '<p class="small muted mt-1">Крапки — окремі зважування. ' +
               (avgWorth(chartData(entries))
                 /* Дві лінії треба назвати обидві, інакше тонка читається
                    як помилка малювання. */
                 ? 'Тонка лінія зʼєднує їх, товста — середня за 7 днів; ' +
                   'дивіться на неї, а не на окремі дні. '
                 /* Однієї лінії пояснювати нема чого — вона й так іде
                    через крапки. Про середню мовчимо: її на графіку
                    немає, бо на кількох записах вона нічого не згладжує. */
                 : 'Лінія зʼєднує їх. Середня за 7 днів зʼявиться, коли ' +
                   'записів набереться на тиждень. ') +
               'Шкала починається з нижнього підпису, а не з нуля: від нуля реальні ' +
               'коливання ваги стиснулись би в рівну смужку.' +
               (state.goal && window.ProgressCore && window.ProgressCore.GOAL_RATES[state.goal]
                 ? ' Пунктир — коридор обраної цілі: модель, не обіцянка.' : '') + '</p>'
             : '<p class="small muted mt-2">Два записи' + (state.period ? ' у цьому періоді' : '') + ' — і зʼявиться графік.</p>') +

        weightCalHtml() +
        '<p class="small muted mt-1 mb-0">Зафарбований день — є запис ваги. ' +
          'Клік по дню — вписати або виправити вагу за нього.</p>' +

        (last.length
          ? '<div class="mt-2">' +
              last.map(function (e) {
                return '<div class="wlog-row">' +
                         '<span class="muted small">' + esc(dateLabel(dateOf(e.key))) + '</span>' +
                         '<span class="mono">' + fmtNum.kg(e.kg) + ' кг</span>' +
                         '<button class="icon-btn icon-btn--danger" type="button" data-w-del="' + e.key + '" ' +
                                 'aria-label="Видалити запис за ' + esc(dateLabel(dateOf(e.key))) + '">' +
                           '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
                         '</button>' +
                       '</div>';
              }).join('') +
            '</div>'
          : '') +
      '</div>';

    wireChartTip('#w-chart', '#w-tip');
  }

  /* ------------------------------------------------------------------ */
  /* Тренування: теплокарта                                              */
  /* ------------------------------------------------------------------ */


  /**
   * НАСИЧЕНІСТЬ ДНЯ: 0…4.
   *
   * Раніше клітинка була бінарною, і на те була причина: рівні «1–3
   * тренування за день» заохочували б яскравішим кольором звичку, якої
   * сайт заохочувати не має, а клік-перемикач такими рівнями керувати не
   * може.
   *
   * Ця причина стосувалась КІЛЬКОСТІ ТРЕНУВАНЬ. Тут рівень означає інше —
   * ЯКА ЧАСТКА ЗАПЛАНОВАНИХ ПІДХОДІВ закрита, тобто рівно те, за що
   * нараховує ELO (js/elo-core.js рахує доданок workout як
   * doneSets/totalSets). Двічі за день на цю шкалу не впливає ніяк, а
   * перемикач лишається бінарним: клік вмикає й вимикає ДЕНЬ, рівень
   * усередині нього — похідне від записаних підходів, і клацанням не
   * задається.
   *
   *   0  тренування немає
   *   1  відмічено вручну — підходів не записано, частки ми НЕ ЗНАЄМО
   *   2  закрито менше половини підходів
   *   3  закрито більшу частину
   *   4  закрито все
   *
   * Рівень 1 стоїть окремо навмисно: поставити його поруч із «менше
   * половини» означало б сказати про день те, чого в даних немає. У
   * підказці так і написано, а в легенді він має власну позначку.
   */
  function hmLevel(key) {
    if (!trained(key)) return 0;
    const s = state.sessionLog[key];
    const total = Number(s && s.totalSets);
    const done = Number(s && s.doneSets);
    if (!(total > 0) || !(done > 0)) return 1;      /* відмічено руками */
    const share = done / total;
    if (share >= 0.999) return 4;
    if (share >= 0.5) return 3;
    return 2;
  }

  /** Підпис рівня — той самий текст у підказці й у легенді. */
  const HM_LEVEL_TEXT = [
    'без тренування',
    'відмічено вручну — підходи не записані',
    'закрито менше половини підходів',
    'закрито більшу частину підходів',
    'закрито всі підходи'
  ];

  /**
   * День або тренувальний, або ні — саме це вмикає й вимикає клік.
   */
  function trained(key) {
    const v = Number(state.workLog[key]);
    if (Number.isFinite(v)) {
      /*
       * Явний 0 — це «знято руками», і він ПЕРЕКРИВАЄ сесію.
       *
       * Раніше 0 не відрізнявся від відсутнього запису, а перемикач умів
       * лише delete. Тож день, підсвічений сесією з «Сьогодні», не можна
       * було зняти взагалі: delete нічого не міняв, sessionLog лишався,
       * клітинка світилась далі — і продовжувала годувати статистику
       * дотримання плану та Get Stronger Rating. Підказка «клікни, щоб зняти»
       * була неправдою.
       */
      return v > 0;
    }
    // Сесія з «Тренування» — теж тренування: підходи й таймер — два
    // способи сказати одне й те саме, і клітинка має світитись від обох.
    return sessionCounts(state.sessionLog[key]);
  }

  /*
   * Чи є в записі сесії робота. done — це закриті ВПРАВИ, і відколи
   * виконання відмічається по підходах, день із чотирма закритими
   * підходами, але жодною добитою вправою, мав done === 0: людина
   * тренувалась, а календар лишався порожнім. Тому дивимось і на підходи.
   */
  function sessionCounts(s) {
    if (!s || typeof s !== 'object') return false;
    return Number(s.done) > 0 || Number(s.doneSets) > 0;
  }

  /** Чи є під днем сесія з «Тренування» (тоді зняття треба записати явним 0) */
  function hasSession(key) {
    return sessionCounts(state.sessionLog[key]);
  }

  const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const MON = ['січ','лют','бер','кві','тра','чер','лип','сер','вер','жов','лис','гру'];

  /** Понеділок того тижня, якому належить дата */
  function mondayOf(d) {
    const m = new Date(d);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  }

  /**
   * Вікно календаря — РІВНО сім календарних місяців: поточний і шість
   * попередніх, з першого числа. Не «N тижнів назад»: людина думає
   * місяцями, і кожен місяць має стояти в сітці цілим.
   */
  const HM_MONTHS = 7;

  function hmFirstDay() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth() - (HM_MONTHS - 1), 1);
  }

  /** Кількість тижневих колонок вікна: від понеділка тижня з 1-м числом
      стартового місяця до поточного тижня включно */
  function hmWeeks() {
    const from = mondayOf(hmFirstDay());
    const to = mondayOf(new Date());
    return Math.round((to - from) / (7 * 86400000)) + 1;
  }

  /**
   * Сітка: колонки — тижні вікна, рядки — Пн…Нд з підписами.
   * Кожна клітинка вікна — кнопка: клік ставить або знімає позначку.
   * Дні ПОЗА вікном — хвіст попереднього місяця в першому тижні й
   * майбутнє поточного — порожні заглушки, їх клацати нема чого.
   *
   * ПРО ПІДКАЗКУ. Атрибута title тут немає навмисно: браузер показує його
   * через півтори секунди, системним шрифтом, поза межами вікна прокрутки
   * і взагалі не показує на дотику. Замість нього — власна підказка (див.
   * wireHeatmap), а для читалок екрана лишається aria-label, який був і
   * раніше.
   *
   * ПРО ЗАТРИМКУ ПОЯВИ. Кожна клітинка несе --i: свій номер по порядку.
   * З нього CSS рахує затримку анімації, тож сітка проявляється хвилею
   * зліва направо. Це не прикраса: 31 колонка × 7 днів = 217 клітинок,
   * і поява їх усіх одночасно читається як стрибок розмітки. Хвиля
   * показує, що сітка має напрямок — час іде вліво-вправо.
   */
  function heatmapHtml() {
    const weeks = hmWeeks();
    const start = mondayOf(hmFirstDay());
    const firstK = keyOf(hmFirstDay());
    const todayK = todayKey();

    /*
     * МІСЯЦЬ КОЖНОЇ КОЛОНКИ РАХУЄМО ОДИН РАЗ.
     *
     * Раніше це були два незалежні цикли з однаковою арифметикою: один
     * будував підписи місяців, другий нічого про них не знав. Роздільник
     * доводилось малювати від ПІДПИСУ, а підпис стоїть у власному ряду
     * над сіткою — звідси й бралась розсинхронізація: лінію треба було
     * тягнути вниз наосліп, вгадуючи висоту, і вона лягала на клітинки
     * замість проміжку.
     *
     * Тепер прапорець «тут починається місяць» дістається самій КОЛОНЦІ,
     * і лінія малюється в її власному проміжку — тобто рівно там, де
     * проміжок і є, за будь-якого розміру клітинки.
     *
     * Місяць колонки визначає її ЧЕТВЕР, ЗАТИСНУТИЙ у вікно: перший
     * тиждень може починатись хвостом попереднього місяця (підпис за
     * понеділком дав би «тра» над червнем), а четвер останнього —
     * вилазити в наступний місяць, якого в сітці ще немає.
     */
    const colMonth = [];
    const colFirst = [];
    {
      let prev = -1;
      for (let w = 0; w < weeks; w++) {
        const thu = new Date(start);
        thu.setDate(start.getDate() + w * 7 + 3);
        let k = keyOf(thu);
        if (k > todayK) k = todayK;
        if (k < firstK) k = firstK;
        const m = Number(k.slice(5, 7)) - 1;
        colMonth[w] = m;
        colFirst[w] = (w === 0 || m !== prev);
        prev = m;
      }
    }

    let cols = '';
    let idx = 0;
    for (let w = 0; w < weeks; w++) {
      let cells = '';
      for (let d = 0; d < 7; d++) {
        const day = new Date(start);
        day.setDate(start.getDate() + w * 7 + d);
        const k = keyOf(day);
        const num = day.getDate();
        if (k > todayK || k < firstK) {
          cells += '<i class="heatmap__cell heatmap__cell--future" aria-hidden="true"></i>';
          continue;
        }
        const lvl = hmLevel(k);
        const on = lvl > 0;
        const label = dateLabel(dateOf(k));
        const s = state.sessionLog[k];
        const total = Number(s && s.totalSets);
        const hasSets = total > 0;
        const frac = hasSets ? (Number(s.doneSets) || 0) + '/' + total + ' підходів' : '';
        /*
         * У ПІДКАЗЦІ — дріб, у aria-label — слова.
         *
         * «закрито всі підходи · 20/20 підходів» — це одне й те саме
         * двічі, причому другий раз точніше. Тому оком людина бачить
         * дріб, а читалка екрана читає формулювання: «20/20» вголос
         * звучить гірше за «закрито всі підходи».
         */
        const tip = label + ' · ' + (hasSets ? frac : HM_LEVEL_TEXT[lvl]);
        const aria = label + ': ' + HM_LEVEL_TEXT[lvl] + (hasSets ? ' (' + frac + ')' : '');
        cells += '<button type="button" class="heatmap__cell' + (on ? ' heatmap__cell--on' : '') + '" ' +
                 'data-hm="' + k + '" data-lvl="' + lvl + '" ' +
                 'style="--i:' + (idx++) + '" ' +
                 'data-tip="' + esc(tip) + '" ' +
                 'aria-pressed="' + on + '" ' +
                 'aria-label="' + esc(aria) +
                 '. Натисніть, щоб змінити"><span>' + num + '</span></button>';
      }
      /* is-month — на першій колонці місяця, крім найпершої в сітці:
         зліва від неї роздільник відділяв би сітку від підписів днів. */
      cols += '<div class="heatmap__col' + (colFirst[w] && w > 0 ? ' is-month' : '') + '">' +
              cells + '</div>';
    }

    /* Ряд місяців над колонками — з тих самих порахованих вище даних. */
    let months = '<span class="heatmap__months-pad" aria-hidden="true"></span>';
    for (let w = 0; w < weeks; w++) {
      months += '<span class="heatmap__month">' +
                (colFirst[w] ? MON[colMonth[w]] : '') + '</span>';
    }

    const days = DOW.map(function (n) { return '<span>' + n + '</span>'; }).join('');
    /* Підказка лежить ПОЗА .heatmap. У сітки overflow-x: auto, а це
       обрізає вміст і по вертикалі теж — підказка над верхнім рядом
       зрізалась навпіл. Обгортка дає їй систему координат, з якої нічого
       не обрізається. */
    return '<div class="heatmap-wrap">' +
             '<div class="heatmap" role="group" aria-label="Календар тренувань за ' + HM_MONTHS + ' місяців">' +
               '<div class="heatmap__months" aria-hidden="true">' + months + '</div>' +
               '<div class="heatmap__grid">' +
                 '<div class="heatmap__days" aria-hidden="true">' + days + '</div>' + cols +
               '</div>' +
             '</div>' +
             '<div class="heatmap__tip" hidden></div>' +
           '</div>' +
           hmLegendHtml();
  }

  /**
   * Легенда: «менше → більше» плюс окрема позначка ручного дня.
   *
   * Наведення на крок легенди підсвічує в сітці саме ті дні — інакше
   * шкала з чотирьох майже однакових сірих квадратиків нічого не пояснює:
   * побачити, ЯКІ це дні, можна лише показавши їх.
   */
  function hmLegendHtml() {
    const steps = [2, 3, 4].map(function (l) {
      return '<button type="button" class="heatmap__key" data-key-lvl="' + l + '" ' +
               'aria-label="Підсвітити дні: ' + esc(HM_LEVEL_TEXT[l]) + '">' +
               '<i class="heatmap__cell heatmap__cell--on" data-lvl="' + l + '"></i>' +
             '</button>';
    }).join('');
    return '<div class="heatmap__legend">' +
             '<button type="button" class="heatmap__key heatmap__key--manual" data-key-lvl="1" ' +
               'aria-label="Підсвітити дні: ' + esc(HM_LEVEL_TEXT[1]) + '">' +
               '<i class="heatmap__cell heatmap__cell--on" data-lvl="1"></i>' +
               '<span>вручну</span>' +
             '</button>' +
             '<span class="heatmap__legend-sp"></span>' +
             '<span class="heatmap__legend-lbl">менше</span>' +
             steps +
             '<span class="heatmap__legend-lbl">більше</span>' +
           '</div>';
  }

  /**
   * Підказка й підсвічування — ОДИН слухач на всю сітку.
   *
   * Слухач на кожній із 217 клітинок коштував би 217 підписок, які треба
   * знімати при кожній перемальовці; делегування на контейнері живе
   * стільки ж, скільки сторінка. Контейнер постійний (renderTrain міняє
   * лише innerHTML нащадків), тому навішуємо один раз — той самий guard,
   * що й скрізь у проєкті.
   */
  let hmWired = false;
  function wireHeatmap() {
    const host = $('#jr-train');
    if (!host || hmWired) return;
    hmWired = true;

    const show = function (btn) {
      const wrap = host.querySelector('.heatmap-wrap');
      const tip = wrap && wrap.querySelector('.heatmap__tip');
      if (!wrap || !tip) return;
      tip.textContent = btn.dataset.tip || '';
      tip.hidden = false;
      /*
       * Координати рахуються від ОБГОРТКИ, а не від вікна: сітка всередині
       * прокручується по горизонталі, і позиція, порахована від вікна,
       * лишилась би правильною рівно до першого руху пальцем.
       *
       * getBoundingClientRect кнопки вже враховує прокрутку сітки, тому
       * додавати scrollLeft тут не треба — це саме та помилка на подвійне
       * врахування, через яку підказка від'їжджає в кінці ряду.
       */
      const b = btn.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      const x = b.left - w.left + b.width / 2;
      tip.style.left = x + 'px';
      tip.style.top = (b.top - w.top) + 'px';
      /* Підказка не має вилазити за край картки. Зсув рахується ПІСЛЯ
         показу: до нього в неї ще немає ширини. */
      const t = tip.getBoundingClientRect();
      let shift = 0;
      if (t.left < w.left + 2) shift = w.left + 2 - t.left;
      else if (t.right > w.right - 2) shift = w.right - 2 - t.right;
      if (shift) tip.style.left = (x + shift) + 'px';
    };
    const hide = function () {
      const tip = host.querySelector('.heatmap__tip');
      if (tip) tip.hidden = true;
    };

    host.addEventListener('pointerover', function (e) {
      const btn = e.target.closest('[data-hm]');
      if (btn) show(btn);
    });
    host.addEventListener('pointerout', function (e) {
      if (e.target.closest('[data-hm]')) hide();
    });
    /* Клавіатура: підказка мусить зʼявлятись і без миші. */
    host.addEventListener('focusin', function (e) {
      const btn = e.target.closest('[data-hm]');
      if (btn) show(btn);
    });
    host.addEventListener('focusout', hide);
    /* Прокрутка сітки зсуває клітинку з-під підказки — ховаємо. */
    host.addEventListener('scroll', hide, true);

    /* Легенда: підсвітити дні одного рівня. Працює і наведенням, і
       фокусом з клавіатури, і тапом — на телефоні наведення немає. */
    /*
     * ДВА РІЗНІ ПІДСВІЧУВАННЯ, І ЦЕ ВАЖЛИВО.
     *
     * Наведення — тимчасове: відвів мишу, підсвітка зникла. Клік — стійке:
     * лишається, поки не клікнеш удруге. Без цього поділу підсвітка не
     * працювала на дотику взагалі: Chrome на тапі шле pointerover ПЕРЕД
     * click, тому обробник кліку бачив уже виставлений атрибут, вважав це
     * «другим тапом» і одразу гасив те, що щойно ввімкнулось. На миші
     * помилки не було видно — там pointerover приходить задовго до кліку.
     */
    let stickyLvl = null;
    const mark = function (lvl) {
      const box = host.querySelector('.heatmap');
      if (!box) return;
      if (lvl == null) box.removeAttribute('data-only');
      else box.setAttribute('data-only', String(lvl));
    };
    const hover = function (lvl) {
      if (stickyLvl != null) return;   /* стійкий вибір сильніший */
      mark(lvl);
    };
    host.addEventListener('pointerover', function (e) {
      const k = e.target.closest('[data-key-lvl]');
      if (k) hover(k.dataset.keyLvl);
    });
    host.addEventListener('pointerout', function (e) {
      if (e.target.closest('[data-key-lvl]')) hover(null);
    });
    host.addEventListener('focusin', function (e) {
      const k = e.target.closest('[data-key-lvl]');
      if (k) hover(k.dataset.keyLvl);
    });
    host.addEventListener('click', function (e) {
      const k = e.target.closest('[data-key-lvl]');
      if (!k) return;
      stickyLvl = (stickyLvl === k.dataset.keyLvl) ? null : k.dataset.keyLvl;
      mark(stickyLvl);
      /* Кнопка каже вголос, увімкнена вона чи ні: без цього для читалки
         екрана стійкий вибір нічим не відрізняється від його відсутності. */
      host.querySelectorAll('[data-key-lvl]').forEach(function (el) {
        el.setAttribute('aria-pressed', String(el.dataset.keyLvl === stickyLvl));
      });
    });
  }

  /** Рядок статистики регулярності під теплокартою */
  function trainStatsLine() {
    if (!window.ProgressCore) return '';
    const st = window.ProgressCore.trainingStats(state.workLog, state.sessionLog, state.daysTarget);
    if (!st.total) return '';
    return '<div class="row mt-1" style="gap:16px;flex-wrap:wrap">' +
      '<span class="small">Всього: <b class="mono">' + st.total + '</b></span>' +
      '<span class="small">За 30 днів: <b class="mono">' + st.thisMonth + '</b></span>' +
      (st.adherence
        ? '<span class="small">План за ' + st.adherence.weeks + ' тиж: <b class="mono">' +
            st.adherence.done + ' із ' + st.adherence.planned + '</b> (' + st.adherence.pct + '%)</span>'
        : '') +
    '</div>';
  }

  function renderTrain() {
    const host = $('#jr-train');
    if (!host) return;

    /*
     * Позначки за видиме вікно — та сама рамка, що й сітка.
     *
     * Ключі беруться з ОБОХ журналів. Раніше тут стояв самий workLog, і
     * чіп рахував лише дні, позначені руками: тренування, закриті на
     * «Тренуванні», лежать у sessionLog — клітинки в сітці світились, а
     * чіп над ними писав «0». Саме та підсвічена клітинка, яку видно
     * поруч, не потрапляла в підсумок.
     */
    const startK = keyOf(hmFirstDay());
    const seen = Object.create(null);
    let total = 0;
    [state.workLog, state.sessionLog].forEach(function (log) {
      Object.keys(log || {}).forEach(function (k) {
        if (seen[k] || k < startK || k > todayKey()) return;
        seen[k] = 1;
        if (trained(k)) total++;
      });
    });

    const monday = mondayOf(new Date());
    let thisWeek = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      if (trained(keyOf(d))) thisWeek++;
    }

    // Ціль — кількість днів обраного плану. Хвалимось акцентом, лише
    // коли тиждень закритий повністю.
    const target = state.daysTarget;
    const weekText = target ? thisWeek + ' з ' + target + ' цього тижня' : thisWeek + ' цього тижня';
    const done = target && thisWeek >= target;
    const today = todayKey();

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">Тренування</h2>' +
          '<span class="chip mono' + (done ? ' chip--acc' : '') + '">' +
            weekText + ' · ' + total + ' за ' + HM_MONTHS + ' місяців</span>' +
        '</div>' +

        '<div class="mt-2">' + heatmapHtml() + '</div>' +
        trainStatsLine() +
        '<p class="small muted mt-1">Клікніть по дню, щоб поставити чи зняти позначку.' +
          (target ? '' : ' Оберіть план тренувань — і тут зʼявиться ціль на тиждень.') + '</p>' +

        '<div class="row mt-2" style="gap:10px;align-items:center;flex-wrap:wrap">' +
          // Підпис міняється разом зі станом: сіра кнопка з тим самим
          // текстом читається як поламана, а не як «уже зроблено».
          '<button class="btn btn--primary btn--sm" type="button" id="t-mark"' +
            (trained(today) ? ' disabled' : '') + '>' +
            (trained(today) ? 'Сьогодні позначено' : 'Відмітити тренування') +
          '</button>' +
        '</div>' +
      '</div>';

    /*
     * Теплокарта ширша за екран (455px проти 230–340 на телефоні) і
     * малювалась зі scrollLeft = 0, тобто показувала найстаріші тижні, а
     * ПОТОЧНИЙ день лишався за межами видимої частини на всіх мобільних
     * ширинах. Прокручуємо до кінця — актуальний тиждень має бути видно
     * без пошуку пальцем усередині сторінки, що й сама скролиться.
     */
    /*
     * Прокрутка в кінець — ПІСЛЯ розкладки, а не одразу.
     *
     * Тут стояло присвоєння відразу після innerHTML. На телефоні воно
     * мовчки не спрацьовувало: у момент виконання картка ще не мала
     * ширини, scrollWidth дорівнював clientWidth, умова не виконувалась —
     * і сітка лишалась на найстаріших тижнях, тобто рівно там, звідки її
     * і хотіли зрушити. На робочому столі сітка вміщалась цілком, і
     * помилки не було видно взагалі.
     */
    const hm = host.querySelector('.heatmap');
    if (hm) {
      requestAnimationFrame(function () {
        if (hm.scrollWidth > hm.clientWidth) hm.scrollLeft = hm.scrollWidth;
      });
    }

    wireHeatmap();

    /*
     * Хвиля появи — ТІЛЬКИ при першому малюванні.
     *
     * renderTrain викликається на кожен клік по дню (і на кожну зміну
     * профілю ззовні). Якби анімація йшла щоразу, один тап по клітинці
     * перезапускав би появу всієї сітки з двохсот квадратиків — тобто
     * саме те миготіння, від якого анімація мала б рятувати.
     */
    if (hm && !hmAnimated) {
      hmAnimated = true;
      hm.classList.add('is-in');
    }
  }
  let hmAnimated = false;


  /* ------------------------------------------------------------------ */
  /* Робочі ваги: історія по вправах                                     */
  /* ------------------------------------------------------------------ */
  /*
   * Джерело — profile.weightLog, який пише «Мій план тренувань» при кожній зміні
   * ваги (включно з деолоадами: провал на графіку — це чесна частина
   * шляху, а не шум). Тут лише читання: сторінка прогресу нічого не пише.
   */

  const LIFTS_SHOWN = 8;

  function liftRow(name) {
    const H = window.HistoryCore;
    const st = window.ProgressCore.liftStats(state.weightLog, name);
    if (!st) return '';

    const open = state.openLift === name;
    const path = H.sparklinePath(st.series, 120, 30, 3);
    const spark = path
      ? '<svg class="lift__spark" viewBox="0 0 120 30" aria-hidden="true">' +
          '<path d="' + path + '" fill="none" stroke="var(--acc-bar)" stroke-width="2"/>' +
        '</svg>'
      : '<span class="lift__spark small muted">один запис</span>';

    const kg = function (n) { return fmtNum.kg(n, { unit: true }); };
    const deltaTxt = st.count < 2
      ? 'початок — ' + dateLabel(dateOf(st.firstDate))
      : (st.delta > 0 ? '+' : '') + fmtNum.n(st.delta, 1) + ' кг з ' +
        dateLabel(dateOf(st.firstDate));

    /* Розгорнута картка: великий графік + статистика + рекорд.
       Це «детальніше за бажанням»: огляд лишається рядком, і сторінка
       не перетворюється на 15 графіків одразу. */
    const detail = !open ? '' :
      '<div class="lift__detail">' +
        (H.sparklinePath(st.series, 600, 120, 6)
          ? '<svg class="lift__chart" viewBox="0 0 600 120" aria-label="Історія ваги: ' + esc(name) + '">' +
              '<path d="' + H.sparklinePath(st.series, 600, 120, 6) + '" fill="none" stroke="var(--acc-bar)" stroke-width="2.5"/>' +
              st.series.map(function (e) {
                // точки поверх лінії, з підказками дат
                return '';
              }).join('') +
            '</svg>'
          : '') +
        '<div class="row" style="gap:14px;flex-wrap:wrap;margin-top:10px">' +
          '<span class="small">Початкова: <b class="mono">' + kg(st.first) + '</b> <span class="muted">(' + esc(dateLabel(dateOf(st.firstDate))) + ')</span></span>' +
          '<span class="small">Поточна: <b class="mono">' + kg(st.last) + '</b></span>' +
          '<span class="small">Приріст: <b class="mono">' + (st.delta > 0 ? '+' : '') + fmtNum.n(st.delta, 1) + ' кг' +
            (st.pct !== null ? ' (' + (st.pct > 0 ? '+' : '') + fmtNum.n(st.pct, 1) + '%)' : '') + '</b></span>' +
          '<span class="small">Рекорд: <b class="mono">' + kg(st.max) + '</b> <span class="muted">(' + esc(dateLabel(dateOf(st.maxDate))) + ')</span></span>' +
        '</div>' +
        '<p class="small muted" style="margin:8px 0 0">' + st.count + ' ' +
          window.App.plural(st.count, 'запис', 'записи', 'записів') + '. Значення серії: ' +
          st.series.map(function (e) { return fmtNum.kg(e.kg); }).join(' → ') + ' кг.</p>' +
      '</div>';

    return '<li class="lift' + (open ? ' is-open' : '') + '">' +
        '<button class="lift__head" type="button" data-lift="' + esc(name) + '" aria-expanded="' + open + '">' +
          '<span class="lift__body">' +
            '<span class="lift__name">' + esc(name) +
              (st.isRecord ? ' <span class="chip chip--sm chip--acc">рекорд</span>' : '') + '</span>' +
            '<span class="lift__delta small ' + (st.delta > 0 ? '' : 'muted') + '">' + esc(deltaTxt) + '</span>' +
          '</span>' +
          spark +
          '<b class="lift__now mono">' + kg(st.last) + '</b>' +
        '</button>' +
        detail +
      '</li>';
  }

  function renderLifts() {
    const host = $('#jr-lifts');
    if (!host || !window.HistoryCore) return;

    const names = window.HistoryCore.weightNames(state.weightLog);

    if (!names.length) {
      host.innerHTML =
        '<div class="card">' +
          '<h2 style="margin:0">Робочі ваги</h2>' +
          '<p class="small mt-1">Історія почнеться з першої зміни ваги на ' +
            '<a href="plan.html">«Моєму плані»</a>: кожна нова цифра лягає сюди ' +
            'з датою, і буде видно, як росте кожна вправа.</p>' +
        '</div>';
      return;
    }

    const shown = state.liftsAll ? names : names.slice(0, LIFTS_SHOWN);
    const hidden = names.length - shown.length;

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">Робочі ваги</h2>' +
          '<span class="small muted">' + names.length + ' ' +
            window.App.plural(names.length, 'вправа', 'вправи', 'вправ') + '</span>' +
        '</div>' +
        '<ul class="lift-list mt-2">' + shown.map(liftRow).join('') + '</ul>' +
        (hidden > 0
          ? '<button class="btn btn--ghost btn--sm mt-1" type="button" id="lifts-more">Показати всі (' + names.length + ')</button>'
          : (state.liftsAll && names.length > LIFTS_SHOWN
              ? '<button class="btn btn--ghost btn--sm mt-1" type="button" id="lifts-less">Згорнути</button>'
              : '')) +
        '<p class="small muted mb-0" style="margin-top:12px">Свіжі зміни — вгорі. ' +
          'Провали на лініях — делоади.</p>' +
      '</div>';
  }


  /* ------------------------------------------------------------------ */
  /* Прогрес окремої вправи: графік по метриці + факти + історія         */
  /* ------------------------------------------------------------------ */
  /*
   * Джерело — знімки сесій (js/exercise-core.js). Кожна точка = реальне
   * тренування, тому графік чесно порожній для вправ, яких ще не робили
   * після релізу відмітки по підходах.
   */

  const EX_PERIODS = [
    { days: 30,  label: '30д' },
    { days: 90,  label: '90д' },
    { days: 180, label: '6м' },
    { days: 365, label: 'рік' },
    { days: 0,   label: 'все' }
  ];

  /** Формат значення метрики під її одиниці */
  function exVal(v, m) {
    if (v === null || v === undefined) return '—';
    const n = m.digits ? fmtNum.n(v, m.digits) : thou(v);
    return n + (m.unit ? ' ' + m.unit : '');
  }

  /**
   * СКЛАДЕНИЙ ГРАФІК: стовпчик + крапка на кожне тренування, лінія зверху.
   *
   * Одне значення — одна шкала. Стовпчик росте від дна поля рівно до
   * крапки, крапки зшиті лінією, під лінією заливка. Обʼєм, який раніше
   * жив тут другою серією на правій шкалі, переїхав у підказку й у
   * таблицю: див. великий коментар про це біля chartScale().
   *
   * Точки стоять по центрах смуг (band scale), а не від краю до краю:
   * інакше перший і останній стовпчики наполовину виїжджають за поле.
   *
   * <title> у кожній колонці лишається — це те, що читають скрінрідери й
   * що працює, коли JS-підказка не піднялась.
   */
  function exChartSvg(pts, metric) {
    const EC = window.ExerciseCore;
    const m = EC.METRICS.find(function (x) { return x.id === metric; });
    const vals = pts.map(function (p) { return EC.valueOf(p, metric); });
    if (!vals.length) return '';

    const vols = pts.map(function (p) { return Number(p.vol) || 0; });

    /*
     * ШИРИНА ПОЛОТНА ЗАЛЕЖИТЬ ВІД ЕКРАНА, І ЦЕ НЕ КОСМЕТИКА.
     *
     * SVG із viewBox стискається цілком, разом із текстом. Полотно 640
     * на екрані 375 px віддає графіку ~330 px — коефіцієнт 0,52, і підпис
     * у 11 одиниць стає 5–6 фізичними пікселями. Його не прочитати ні з
     * якого приводу. Вужче полотно означає коефіцієнт близько одиниці,
     * тобто ті самі 11 одиниць лишаються приблизно 11 пікселями.
     *
     * Перемальовки на поворот екрана немає навмисно: після повороту
     * графік лишається читабельним (просто з іншим кроком), а слухач
     * resize на кожну картку — це ціна, якої ця користь не варта.
     */
    const narrow = (window.innerWidth || 1024) < 560;
    const W = narrow ? 380 : 640, H = narrow ? 200 : 220;
    const PAD = {
      l: narrow ? 44 : 54,
      r: narrow ? 12 : 14,
      t: narrow ? 12 : 16,
      b: narrow ? 26 : 30
    };
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    const y0 = H - PAD.b;
    const n = pts.length;
    const slot = innerW / n;
    const px = function (i) { return PAD.l + slot * (i + 0.5); };

    const lo = Math.min.apply(null, vals);
    const hi = Math.max.apply(null, vals);
    const sc = chartScale(lo, hi);
    const py = function (v) { return PAD.t + innerH * (1 - (v - sc.base) / (sc.roof - sc.base)); };

    const fmtV = function (v) {
      return m.digits || sc.dec ? fmtNum.n(v, Math.max(m.digits || 0, Math.min(sc.dec, 2))) : thou(v);
    };

    /* ---- сітка й ліва шкала ---- */
    const grid = chartRows(sc).map(function (v) {
      const y = Math.round(py(v) * 10) / 10;
      return '<line class="exc__grid" x1="' + PAD.l + '" y1="' + y + '" x2="' + (W - PAD.r) + '" y2="' + y + '"/>' +
             '<text class="exc__ylab" x="' + (PAD.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
             esc(fmtV(v)) + '</text>';
    }).join('');

    const dr = Math.max(2, Math.min(3.5, slot * 0.34));
    const dsw = Math.max(1.2, Math.min(2, dr * 0.6));

    /* ---- заливка під лінією + сама лінія ---- */
    const dPts = pts.map(function (p, i) {
      return px(i).toFixed(1) + ' ' + py(vals[i]).toFixed(1);
    });
    let area = '', line = '';
    if (n > 1) {
      line = '<path class="exc__line" pathLength="1" d="M' + dPts.join('L') + '" />';
      area = '<path class="exc__area" d="M' + px(0).toFixed(1) + ' ' + y0 +
             'L' + dPts.join('L') + 'L' + px(n - 1).toFixed(1) + ' ' + y0 + 'Z"/>';
    }

    /* ---- колонки: кружок, перехрестя, зона наведення ---- */
    const cols = pts.map(function (p, i) {
      const v = vals[i];
      const cx = px(i), cy = py(v);
      const sub = p.sets + '×' + (p.perSet ? fmtNum.n(p.perSet, 0) : '?') +
                  (p.kg ? ' × ' + fmtNum.kg(p.kg) + ' кг' : '');
      const ttl = dateLabel(dateOf(p.d)) + ': ' + exVal(v, m) + ' · ' + sub +
                  (vols[i] ? ' · обʼєм ' + thou(vols[i]) + ' кг' : '');
      /* Без tabindex: 90 колонок дали б 90 зупинок Tab перед таблицею,
         яка й так дублює ті самі числа рядками. Для читалок екрана
         працює aria-label усього графіка плюс <title> кожної колонки —
         рівно те, що було тут і до перебудови. */
      return '<g class="exc__col"' +
               ' data-d="' + esc(dateLabel(dateOf(p.d))) + '"' +
               ' data-v="' + esc(exVal(v, m)) + '"' +
               ' data-sub="' + esc(sub) + '"' +
               ' data-vol="' + (vols[i] ? esc(thou(vols[i]) + ' кг') : '') + '">' +
               '<title>' + esc(ttl) + '</title>' +
               '<line class="exc__cross" x1="' + cx.toFixed(1) + '" y1="' + PAD.t + '" x2="' + cx.toFixed(1) + '" y2="' + y0 + '"/>' +
               '<circle class="exc__dot" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
                 '" r="' + round(dr, 2) + '"' +
                 ' style="stroke-width:' + round(dsw, 2) + 'px;animation-delay:' +
                 Math.min(240 + i * 14, 520) + 'ms"/>' +
               '<rect class="exc__hit" x="' + (cx - slot / 2).toFixed(1) + '" y="' + PAD.t +
                 '" width="' + slot.toFixed(1) + '" height="' + innerH + '"/>' +
             '</g>';
    }).join('');

    /* ---- підписи дат: перша, середня, остання ---- */
    const idx = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : (n > 1 ? [0, n - 1] : [0]);
    const xlab = idx.filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (i) {
      /* Підпис кріпиться до СВОГО стовпчика, а не до рамки поля: точки
         стоять по центрах смуг, тож притиснута до краю дата опинялась на
         півсмуги збоку від свого стовпчика. */
      const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
      const x = i === 0 ? px(i) - dr : (i === n - 1 ? px(i) + dr : px(i));
      return '<text class="exc__xlab" x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '">' +
             esc(shortDate(pts[i].d)) + '</text>';
    }).join('');

    const axis = '<line class="exc__axis" x1="' + PAD.l + '" y1="' + y0 + '" x2="' + (W - PAD.r) + '" y2="' + y0 + '"/>';

    return '<svg class="exc" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
             'aria-label="Прогрес: ' + esc(m.label) + ', ' + n + ' тренувань">' +
             '<defs><linearGradient id="exc-fill" x1="0" y1="0" x2="0" y2="1">' +
               '<stop offset="0" stop-color="rgb(var(--acc-rgb))" stop-opacity="0.22"/>' +
               '<stop offset="1" stop-color="rgb(var(--acc-rgb))" stop-opacity="0"/>' +
             '</linearGradient></defs>' +
             grid + area + line + cols + axis + xlab +
           '</svg>';
  }

  /** '2026-08-31' → '31.08' */
  function shortDate(k) { return k.slice(8, 10) + '.' + k.slice(5, 7); }

  function renderExercise() {
    const host = $('#jr-exercise');
    const EC = window.ExerciseCore;
    if (!host || !EC) return;

    const names = EC.exerciseNames(state.sessionLog);

    if (!names.length) {
      host.innerHTML =
        '<div class="card">' +
          '<h2 style="margin:0">Прогрес вправи</h2>' +
          '<p class="small mt-1 mb-0">Ще немає даних. Кожна точка графіка — ' +
            'реальне тренування: позначайте підходи на сторінці ' +
            '<a href="workout.html">«Тренування»</a>, і тут зʼявиться історія ' +
            'кожної вправи — вага, обʼєм, повторення й оцінка разового максимуму.</p>' +
        '</div>';
      return;
    }

    /* Обрана вправа могла зникнути з плану — тоді беремо найсвіжішу */
    const name = names.indexOf(state.exName) >= 0 ? state.exName : names[0];
    const metric = EC.isMetric(state.exMetric) ? state.exMetric : 'kg';
    const m = EC.METRICS.find(function (x) { return x.id === metric; });

    const from = state.exPeriod
      ? window.AdherenceCore.addDays(todayKey(), -(state.exPeriod - 1))
      : '';
    /* Перемикач «Підхід N» зʼявляється лише там, де є дані по підходах:
       у легасі-знімках вага одна на всю вправу, і розкласти її назад на
       підходи неможливо. Обраний підхід міг зникнути (вправу скоротили
       з 4 підходів до 3) — тоді чесно повертаємось до «Усі». */
    const maxSet = EC.maxSetNo ? EC.maxSetNo(state.sessionLog, name, from, todayKey()) : 0;
    const setNo = (state.exSet > 0 && state.exSet <= maxSet) ? state.exSet : 0;

    const pts = EC.series(state.sessionLog, name, from, todayKey(), setNo);
    const st = EC.stats(pts, metric);

    const picker =
      '<select class="select" id="ex-pick" aria-label="Обрати вправу">' +
        names.map(function (n) {
          return '<option value="' + esc(n) + '"' + (n === name ? ' selected' : '') + '>' + esc(n) + '</option>';
        }).join('') +
      '</select>';

    const tabs = '<div class="seg" role="radiogroup" aria-label="Показник">' +
      EC.METRICS.map(function (x) {
        return '<label class="seg__item"><input type="radio" name="ex-metric" value="' + x.id + '"' +
          (x.id === metric ? ' checked' : '') + '><span>' + esc(x.label) + '</span></label>';
      }).join('') + '</div>';

    const periods = '<div class="seg" role="radiogroup" aria-label="Період">' +
      EX_PERIODS.map(function (pp) {
        return '<label class="seg__item"><input type="radio" name="ex-period" value="' + pp.days + '"' +
          (pp.days === state.exPeriod ? ' checked' : '') + '><span>' + pp.label + '</span></label>';
      }).join('') + '</div>';

    let setTabs = '';
    if (maxSet > 1) {
      let items = '<label class="seg__item"><input type="radio" name="ex-set" value="0"' +
        (setNo === 0 ? ' checked' : '') + '><span>Усі</span></label>';
      for (let k = 1; k <= maxSet; k++) {
        items += '<label class="seg__item"><input type="radio" name="ex-set" value="' + k + '"' +
          (setNo === k ? ' checked' : '') + '><span>' + k + '</span></label>';
      }
      setTabs = '<div class="seg" role="radiogroup" aria-label="Підхід">' + items + '</div>';
    }

    let body;
    if (!st) {
      /* Метрика незастосовна (планка не має ваги) або в періоді порожньо —
         це різні речі, і сказати треба різне. */
      const any = pts.length > 0;
      body = '<p class="small muted mt-2 mb-0">' +
        (any
          ? 'Для цієї вправи показник «' + esc(m.label) + '» не рахується: ' +
            'у ній не задано робочої ваги. Подивіться «Повтори».'
          : (setNo
              ? 'За цей період підхід ' + setNo + ' у цій вправі не траплявся. ' +
                'Візьміть ширший період або «Усі».'
              : 'За цей період тренувань із цією вправою не було. Візьміть ширший період.')) +
        '</p>';
    } else {
      const trend = EC.trend(pts, metric);
      /* Дно шкали графіка рахуємо тут ще раз тим самим chartScale, щоб
         підписати його словами під графіком. Дублювання дешевше, ніж
         повертати геометрію з функції, яка віддає рядок SVG. */
      const exVals = st.points.map(function (p) { return EC.valueOf(p, metric); });
      const exBase = chartScale(Math.min.apply(null, exVals), Math.max.apply(null, exVals)).base;
      const TREND = { up: '↑ Росте', down: '↓ Знижується', flat: '→ Стабільно' };
      const dTxt = st.delta === null
        ? 'перший запис'
        : (st.delta > 0 ? '+' : '') + (m.digits ? fmtNum.n(st.delta, m.digits) : thou(st.delta)) +
          (m.unit ? ' ' + m.unit : '') +
          (st.pct === null ? '' : ' (' + (st.pct > 0 ? '+' : '') + fmtNum.n(st.pct, 1) + '%)');

      body =
        '<div class="wchart wchart--live mt-2" id="ex-chart">' +
          exChartSvg(st.points, metric) +
          '<div class="chart-tip" id="ex-tip" hidden></div>' +
        '</div>' +
        /* Легенди немає навмисно: на полі одна серія — стовпчик, крапка й
           лінія показують ОДНЕ число. Пояснювати треба не «що є що», а
           звідки починається відлік — і лише тоді, коли він не з нуля. */
        (exBase > 0
          ? '<p class="small muted mt-1 mb-0">Шкала починається з ' + esc(exVal(exBase, m)) +
              ', а не з нуля: інакше вся різниця між тренуваннями стиснулась би ' +
              'у смужку заввишки кілька пікселів.</p>'
          : '') +
        '<div class="kpis mt-2">' +
          '<div class="kpi"><div class="kpi__val mono">' + exVal(st.current, m) + '</div>' +
            '<p class="kpi__lbl">поточне · ' + esc(shortDate(st.currentDate)) + '</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + exVal(st.previous, m) + '</div>' +
            '<p class="kpi__lbl">попереднє' + (st.previousDate ? ' · ' + esc(shortDate(st.previousDate)) : '') + '</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + esc(dTxt) + '</div>' +
            '<p class="kpi__lbl">зміна</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + exVal(st.pr, m) +
            (st.isPr ? ' <span class="chip chip--acc">PR</span>' : '') + '</div>' +
            '<p class="kpi__lbl">рекорд · ' + esc(shortDate(st.prDate)) + '</p></div>' +
        '</div>' +
        (trend
          ? '<p class="small mt-1" style="margin-bottom:0">Тренд за період: <b>' + TREND[trend] + '</b> ' +
            '<span class="muted">(перша третина серії проти останньої).</span></p>'
          : '') +

        '<div class="table-wrap mt-2">' +
          '<table class="tbl"><thead><tr>' +
            '<th>Дата</th><th class="num">Вага</th><th class="num">Підходи</th>' +
            '<th class="num">Повтори</th><th class="num">Обʼєм</th>' +
          '</tr></thead><tbody>' +
            st.points.slice(-10).reverse().map(function (p) {
              return '<tr>' +
                '<td data-l="Дата">' + esc(dateLabel(dateOf(p.d))) + '</td>' +
                '<td class="num mono" data-l="Вага">' + (p.kg ? fmtNum.kg(p.kg) + ' кг' : '—') + '</td>' +
                '<td class="num mono" data-l="Підходи">' + p.sets + '</td>' +
                '<td class="num mono" data-l="Повтори">' + (p.reps || '—') + '</td>' +
                '<td class="num mono" data-l="Обʼєм">' + (p.vol ? thou(p.vol) + ' кг' : '—') + '</td>' +
              '</tr>';
            }).join('') +
          '</tbody></table>' +
        '</div>' +
        '<p class="small muted mt-1 mb-0">' + st.count + ' ' +
          window.App.plural(st.count, 'тренування', 'тренування', 'тренувань') +
          ' за період. ' +
          (setNo
            ? 'Показано лише підхід ' + setNo + '.'
            : 'Вага — найважчий фактичний підхід дня, обʼєм — сума «вага × повтори» ' +
              'по кожному підходу. Тренування до появи ваг по підходах рахуються ' +
              'за робочою вагою того дня.') + '</p>';
    }

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
          '<h2 style="margin:0">Прогрес вправи</h2>' +
          periods +
        '</div>' +
        '<div class="row mt-2" style="gap:10px;flex-wrap:wrap;align-items:center">' +
          picker + tabs +
        '</div>' +
        (setTabs ? '<div class="row mt-1" style="gap:10px;flex-wrap:wrap;align-items:center">' +
          '<span class="small muted">Підхід</span>' + setTabs + '</div>' : '') +
        body +
      '</div>';

    wireChartTip('#ex-chart', '#ex-tip');
  }

  /*
   * Підказка графіка.
   *
   * <title> у кожній колонці лишається головним джерелом правди — його
   * читає скрінрідер і показує браузер, якщо цей код чомусь не піднявся.
   * Наведення додає до нього те, чого нативний <title> не вміє: миттєвість
   * (без секундної паузи) і спільне перехрестя, за яким видно, до якої
   * саме дати відноситься число.
   *
   * Обробники висять на самій обгортці графіка, а вона перемальовується
   * разом з усією карткою при кожній зміні вправи, дня чи періоду — тому
   * вішаємо їх заново після кожного рендера, а не один раз назавжди.
   * Тим самим кодом живуть обидва графіки сторінки: вправа й вага.
   *
   * Клавіатури тут немає навмисно: колонки не фокусні (див. коментар у
   * exChartSvg), а без миші ті самі числа дає таблиця нижче.
   */
  function wireChartTip(boxSel, tipSel) {
    const box = $(boxSel);
    const tip = $(tipSel);
    if (!box || !tip) return;

    const show = function (g) {
      const rows = [];
      if (g.dataset.d) rows.push('<b>' + esc(g.dataset.d) + '</b>');
      if (g.dataset.v) rows.push('<span class="chart-tip__v mono">' + esc(g.dataset.v) + '</span>');
      if (g.dataset.sub) rows.push('<span class="muted">' + esc(g.dataset.sub) + '</span>');
      if (g.dataset.vol) rows.push('<span class="muted">обʼєм ' + esc(g.dataset.vol) + '</span>');
      tip.innerHTML = rows.join('');
      tip.hidden = false;

      /* Координати рахуються від обгортки, а не від вікна: картка
         прокручується разом зі сторінкою, і абсолютні координати
         протухли б на першому ж русі коліщатка. */
      const dot = g.querySelector('.exc__dot');
      const b = (dot || g).getBoundingClientRect();
      const w = box.getBoundingClientRect();
      const x = b.left - w.left + b.width / 2;
      tip.style.left = x + 'px';
      tip.style.top = (b.top - w.top) + 'px';
      /* Зсув від краю рахується ПІСЛЯ показу: до нього підказка ще не
         має ширини. */
      const t = tip.getBoundingClientRect();
      let shift = 0;
      if (t.left < w.left + 2) shift = w.left + 2 - t.left;
      else if (t.right > w.right - 2) shift = w.right - 2 - t.right;
      if (shift) tip.style.left = (x + shift) + 'px';
    };
    const hide = function () { tip.hidden = true; };

    box.addEventListener('pointerover', function (e) {
      const g = e.target.closest('.exc__col');
      if (g) show(g);
    });
    box.addEventListener('pointerleave', hide);
  }

  /* ------------------------------------------------------------------ */
  /* Харчування: закриті дні                                             */
  /* ------------------------------------------------------------------ */
  /*
   * Джерело — profile.mealLog, який пише кнопка «Закрити день» у раціоні.
   * Кожен запис несе ціль СВОГО дня, тому колонка «до цілі» правдива
   * навіть після зміни профілю.
   */

  function renderFood() {
    const host = $('#jr-food');
    if (!host || !window.HistoryCore) return;

    const entries = window.HistoryCore.lastEntries(state.mealLog, 7);

    if (!entries.length) {
      host.innerHTML =
        '<div class="card">' +
          '<h2 style="margin:0">Харчування</h2>' +
          '<p class="small mt-1">Наприкінці дня натисніть «Закрити день» у ' +
            '<a href="meals.html">раціоні</a> — підсумок із датою ляже сюди, ' +
            'і графік ваги отримає контекст: скільки калорій стояло за кожною точкою.</p>' +
        '</div>';
      return;
    }

    const rows = entries.map(function (e) {
      const v = e.v || {};
      const hasTarget = Number.isFinite(Number(v.target));
      const diff = hasTarget ? Math.round(v.kcal - v.target) : null;
      const over = hasTarget && v.kcal > v.target * 1.05;
      const under = hasTarget && v.kcal < v.target * 0.95;
      return '<tr>' +
        '<td>' + esc(dateLabel(dateOf(e.d))) + '</td>' +
        '<td class="num mono">' + v.kcal + '</td>' +
        '<td class="num mono">' + (v.p || 0) + '</td>' +
        '<td class="num">' + (hasTarget
          ? '<span class="chip chip--sm' + ((over || under) ? ' chip--warn' : ' chip--ok') + '">' +
              (diff > 0 ? '+' + diff : '−' + Math.abs(diff)) + '</span>'
          : '<span class="small muted">без цілі</span>') + '</td>' +
      '</tr>';
    }).join('');

    const st = window.ProgressCore ? window.ProgressCore.foodStats(state.mealLog, 30) : null;

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">Харчування</h2>' +
          (st ? '<span class="chip mono">≈' + st.avgKcal + ' ккал/день</span>' : '') +
        '</div>' +
        (st
          ? '<div class="row mt-1" style="gap:16px;flex-wrap:wrap">' +
              (st.avgTarget
                ? '<span class="small">Середнє / ціль: <b class="mono">' + st.avgKcal + ' / ' + st.avgTarget + '</b></span>'
                : '<span class="small">Середнє: <b class="mono">' + st.avgKcal + ' ккал</b></span>') +
              '<span class="small">Білок: <b class="mono">' + st.avgP + ' г/день</b></span>' +
              (st.withTarget
                ? '<span class="small">У межах ±5%: <b class="mono">' + st.inTarget + ' із ' + st.withTarget + '</b> днів</span>'
                : '') +
            '</div>'
          : '') +
        '<div class="table-wrap mt-2">' +
          '<table class="tbl">' +
            '<thead><tr><th>День</th><th class="num">Ккал</th><th class="num">Білок</th><th class="num">До цілі</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
        '<p class="small muted mb-0" style="margin-top:10px">Останні ' + entries.length + ' закритих ' +
          window.App.plural(entries.length, 'день', 'дні', 'днів') + '. ' +
          'Ціль у кожному рядку — та, що діяла саме того дня.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Трекери: короткий підсумок (етап 4)                                 */
  /* ------------------------------------------------------------------ */
  /*
   * Одна плитка на увімкнений трекер, а не графік: «Overview → детальніше
   * за бажанням» діє тут так само, як у решті сторінки. Повна історія й
   * налаштування — на «Моїх трекерах», сюди виходить лише підсумок за
   * 7 (сон/настрій — щоденні коливання) або 30 днів (решта).
   */

  function trackerLine(t) {
    const TC = window.TrackerCore;
    const def = TC.defFor(t);
    const arrow = { up: '↑', down: '↓', flat: '→' };

    /* dose (добавка в грамах) для підсумку — та сама позначка «прийнято/ні»:
       середні грами тут нічого не кажуть, важлива регулярність. */
    if (def.kind === 'boolean' || def.kind === 'dose') {
      const st = TC.boolSummary(state.trackerLog, t.id, 30, t.createdAt);
      return { name: t.name, val: st.pct + '%', trend: st.done + ' із ' + st.total + ' днів' + (st.streak ? ' · ' + st.streak + ' поспіль зараз' : '') };
    }

    if (def.kind === 'pair') {
      const parts = def.fields.map(function (f) {
        const s = TC.pairSummary(state.trackerLog, t.id, f, 30);
        return s ? (f === 'pain' ? 'біль' : f === 'fatigue' ? 'втома' : f === 'before' ? 'до' : 'після') + ' ' + fmtNum.n(s.avg, 1) : null;
      }).filter(Boolean);
      return parts.length ? { name: t.name, val: parts.join(' / '), trend: 'середнє за 30д' } : null;
    }

    const period = (t.type === 'sleep' || t.type === 'mood') ? 7 : 30;
    const s = TC.numericSummary(state.trackerLog, t.id, period);
    if (!s) return null;

    if (t.goal && (def.kind === 'cumulative' || def.kind === 'value' || def.kind === 'duration')) {
      const ga = TC.goalAdherence(state.trackerLog, t.id, t.goal, period);
      return { name: t.name, val: (ga ? ga.pct + '%' : '—'), trend: 'середнє виконання цілі за ' + period + 'д' };
    }

    const val = def.kind === 'duration' ? TC.formatDuration(s.avg) : fmtNum.n(s.avg, 1) + (def.unit ? ' ' + def.unit : '');
    return { name: t.name, val: val, trend: 'середнє за ' + period + 'д' + (s.trend ? ' · тренд ' + arrow[s.trend] : '') };
  }

  function renderTrackers() {
    const host = $('#jr-trackers');
    if (!host || !window.TrackerCore) return;

    const TC = window.TrackerCore;
    const lines = TC.active(state.trackers).map(trackerLine).filter(Boolean);

    /* Порожній стан, а не зникла картка.
       Раніше при вимкнених трекерах увесь блок просто не малювався — і
       людина, яка ніколи не заходила в «Мої трекери», не дізнавалась, що
       вони взагалі є. Решта блоків цієї сторінки давно поводяться інакше. */
    if (!lines.length) {
      host.innerHTML =
        '<div class="card">' +
          '<h2 style="margin:0">Трекери</h2>' +
          '<p class="small mt-1 mb-0">Жоден трекер не ввімкнено, тому рахувати нічого. ' +
            'Увімкніть сон, кроки чи біль і втому — і тут зʼявиться середнє за період ' +
            'поруч із вагою й тренуваннями. <a href="trackers-settings.html">Увімкнути трекери</a></p>' +
        '</div>';
      return;
    }

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Трекери</h2>' +
          '<a class="small" href="trackers-settings.html">Детальніше</a>' +
        '</div>' +
        '<div class="kpis mt-2">' +
          lines.map(function (l) {
            return '<div class="kpi">' +
              '<div class="kpi__val mono">' + esc(l.val) + '</div>' +
              '<p class="kpi__lbl">' + esc(l.name) + '</p>' +
              '<p class="kpi__trend small muted">' + esc(l.trend) + '</p>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Сезонне вікно аналітики                                             */
  /* ------------------------------------------------------------------ */
  /*
   * «Огляд прогресу» рахує статистику ЗА СЕЗОН (js/season-core.js), а не
   * за весь час: інакше метрики першого тижня Сезону 1 були б розмиті
   * роками попередніх даних. Історія при цьому НЕ чіпається — календар,
   * підсумок дня і графік ваги тіла й далі бачать усе.
   *
   * Зрізи рахуються один раз на завантаження журналів (seasonize), а не
   * в кожному рендері: clip проходить по всіх ключах, і викликати його
   * з чотирьох блоків на кожну перемальовку — марна робота.
   */
  const sn = {
    sessionLog: {}, workLog: {}, weightLog: {}, mealLog: {}
  };

  function seasonize() {
    const SC = window.SeasonCore;
    if (!SC) {
      sn.sessionLog = state.sessionLog; sn.workLog = state.workLog;
      sn.weightLog = state.weightLog;   sn.mealLog = state.mealLog;
      return;
    }
    sn.sessionLog = SC.clip(state.sessionLog);
    sn.workLog = SC.clip(state.workLog);
    sn.weightLog = SC.clipSeries(state.weightLog);
    sn.mealLog = SC.clip(state.mealLog);
  }

  /* ------------------------------------------------------------------ */
  /* Форматування чисел і часу для аналітики                             */
  /* ------------------------------------------------------------------ */

  /** 58420 → '58 420' (тонкий пробіл між тисячами) */
  function thou(n) {
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** Хвилини → '1 год 14 хв' / '48 хв' */
  function durTxt(min) {
    const m = Math.round(Number(min) || 0);
    if (m < 60) return m + ' хв';
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' год' + (r ? ' ' + r + ' хв' : '');
  }

  /** epoch ms → 'ГГ:ХХ' локального часу */
  function hhmm(ms) {
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  const MONTHS_NOM = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                      'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
  const MONTHS_GEN = ['січня','лютого','березня','квітня','травня','червня',
                      'липня','серпня','вересня','жовтня','листопада','грудня'];
  const WEEKDAYS = ['Неділя','Понеділок','Вівторок','Середа','Четвер','Пʼятниця','Субота'];

  /* ------------------------------------------------------------------ */
  /* Виконання плану: тренування і харчування, у відсотках               */
  /* ------------------------------------------------------------------ */
  /*
   * Замість графіка тоннажу (вирізаний: сирі кілограми за тиждень нічого
   * не кажуть про дисципліну). Два числа, які відповідають на справжнє
   * питання «чи тримаюсь я плану»:
   *
   *   тренування — Σ часток виконаних сесій / заплановані тренування
   *     періоду (пропуск = нуль, частка = закриті/планові підходи);
   *   харчування — середня якість закритих днів проти цілі дня, тими
   *     самими tolerance-зонами, якими сервер рахує ELO.
   *
   * Математика — js/adherence-core.js (чисте ядро з тестами). Журнали
   * беруться ПОВНІ (state.*), не сезонний зріз: періоди до року довші за
   * сезон, а дисципліна — не сезонний рейтинг.
   */

  /** Живий конфіг зон із сервера, або вбудоване дзеркало (офлайн/локально) */
  function adhCfg() {
    const st = window.EloApi && window.EloApi.cached && window.EloApi.cached();
    return (st && st.config) || (window.AdherenceCore && window.AdherenceCore.DEFAULT_CFG);
  }

  function adhBar(pct) {
    return '<div class="vol" style="margin-top:10px"><span class="vol__bar">' +
      '<i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></span></div>';
  }

  /* Профіль для ядра — з того, що сторінка вже тримає: повні журнали
     і кількість днів обраного плану (daysTarget = activePlan.days). */
  function adhProfile() {
    return {
      activePlan: { days: state.daysTarget },
      sessionLog: state.sessionLog,
      mealLog: state.mealLog
    };
  }

  /* B7 (презентація): «5 із 3 запланованих» плутає. Розрахунок не чіпаємо —
     відсоток і надалі рахує ядро; змінюється лише текст, коли сесій більше
     за план (наприклад, після зміни програми з 3 на 5 днів). */
  function adhSessionsLabel(sessions, expected) {
    if (sessions > expected) {
      return 'Сесій: <b class="mono">' + sessions + '</b>, за планом на період: <b class="mono">' +
        expected + '</b> (більше плану)';
    }
    return 'Сесій: <b class="mono">' + sessions + '</b> із <b class="mono">' + expected + '</b> запланованих';
  }

  function adhTrainingCard(AC, period) {
    const r = AC.trainingAdherence(adhProfile(), todayKey(), period);
    let body;
    if (r.state === 'noplan') {
      body = '<p class="small muted mt-1 mb-0">План ще не обрано — оберіть програму на сторінці ' +
        '<a href="programs.html">«Плани тренувань»</a>, і тут зʼявиться відсоток виконання.</p>';
    } else if (r.state === 'nodata') {
      body = '<p class="small muted mt-1 mb-0">Ще немає даних. Завершіть перше тренування на сторінці ' +
        '<a href="workout.html">«Тренування»</a> — відсоток рахується з реальних сесій.</p>';
    } else if (r.state === 'resttoday') {
      body = '<p class="small muted mt-1 mb-0">Сьогодні сесії ще не було. Відсоток дня зʼявиться ' +
        'з першим закритим підходом.</p>';
    } else {
      const sub = period === 1
        ? 'Сьогоднішня сесія: закрито <b class="mono">' + r.doneSets + '</b> із <b class="mono">' +
          r.totalSets + '</b> підходів.'
        : adhSessionsLabel(r.sessions, Math.round(r.expected) || 1) +
          (r.totalSets ? ' · підходів закрито: <b class="mono">' + r.doneSets + '/' + r.totalSets + '</b>' : '') +
          (r.effDays < period ? ' · дані ведуться ' + r.effDays + ' дн.' : '') + '.';
      body = '<div class="adh__pct mono">' + r.pct + '%</div>' + adhBar(r.pct) +
        '<p class="small muted mt-1 mb-0">' + sub + ' Пропущене тренування важить нуль, ' +
        'часткове — свою частку підходів.</p>';
    }
    return '<div class="card" id="adh-training">' +
      '<h2 style="margin:0">План тренувань</h2>' +
      '<p class="small muted" style="margin:4px 0 0">Наскільки добре ви виконуєте свій план тренувань</p>' +
      body + '</div>';
  }

  function adhNutritionCard(AC, period) {
    const r = AC.nutritionAdherence(adhProfile(), todayKey(), period, adhCfg());
    let body;
    if (r.state === 'nodata') {
      body = '<p class="small muted mt-1 mb-0">Ще немає даних. Закрийте перший день на сторінці ' +
        '<a href="meals.html">«Раціон»</a> — відсоток рахується проти цілі дня.</p>';
    } else if (r.state === 'openday') {
      body = '<p class="small muted mt-1 mb-0">Сьогоднішній день ще не закрито. Закрийте його в ' +
        '<a href="meals.html">«Раціоні»</a> — і тут буде відсоток попадання в ціль.</p>';
    } else {
      const sub = period === 1
        ? 'Сьогоднішній день закрито проти цілі, записаної в момент закриття.'
        : 'Закрито днів: <b class="mono">' + r.closed + '</b> із <b class="mono">' + r.counted +
          '</b> · незакритий день важить нуль, відкритий сьогоднішній не рахується.';
      body = '<div class="adh__pct mono">' + r.pct + '%</div>' + adhBar(r.pct) +
        '<p class="small muted mt-1 mb-0">' + sub + ' Перебір карається так само, як недобір: ' +
        '4000 ккал при цілі 2500 — це не 160%.</p>';
    }
    return '<div class="card" id="adh-nutrition">' +
      '<h2 style="margin:0">План харчування</h2>' +
      '<p class="small muted" style="margin:4px 0 0">Наскільки добре ви виконуєте свій план харчування</p>' +
      body + '</div>';
  }

  function renderAdherence() {
    const host = $('#jr-adherence');
    const AC = window.AdherenceCore;
    if (!host || !AC) return;

    const seg = '<div class="seg" role="radiogroup" aria-label="Період виконання плану">' +
      AC.PERIODS.map(function (pp) {
        return '<label class="seg__item"><input type="radio" name="adh-period" value="' + pp.days + '"' +
          (pp.days === state.adhPeriod ? ' checked' : '') + '><span>' + pp.label + '</span></label>';
      }).join('') + '</div>';

    host.innerHTML = seg +
      '<div class="grid grid-2 mt-2">' +
        adhTrainingCard(AC, state.adhPeriod) +
        adhNutritionCard(AC, state.adhPeriod) +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Особисті рекорди                                                    */
  /* ------------------------------------------------------------------ */
  /*
   * Максимум серії кожної вправи з weightLog. Повторень тут немає
   * навмисно: журнал ваг зберігає лише вагу, і дописувати «× 6» було б
   * вигадкою. Свіжий рекорд (до 14 днів) — з позначкою і датою.
   */

  function renderPrs() {
    const host = $('#jr-prs');
    const PC = window.ProgressCore;
    if (!host || !PC || !PC.prList) return;

    /*
     * Рекорд — це ПІДНЯТА вага, а не записана в план. Основа — знімки
     * сесій (найважчий фактично виконаний підхід), і лише для вправ,
     * яких у знімках ще немає, беремо максимум із книги ваг: історія
     * книги довша за історію знімків, і обірвати її датою релізу було б
     * гірше, ніж чесно підписати рядок «за журналом ваг».
     */
    const EC = window.ExerciseCore;
    const real = EC && EC.prFromSessions ? EC.prFromSessions(sn.sessionLog, 14, todayKey()) : [];
    const seen = Object.create(null);
    real.forEach(function (x) { seen[x.name] = 1; });

    const book = PC.prList(sn.weightLog, 14).filter(function (x) { return !seen[x.name]; })
      .map(function (x) { x.book = true; return x; });

    const list = real.concat(book).sort(function (a, b) {
      if (a.kg !== b.kg) return b.kg - a.kg;
      return a.name < b.name ? -1 : 1;
    });

    if (!list.length) {
      host.innerHTML =
        '<div class="card">' +
          '<h2 style="margin:0">Особисті рекорди</h2>' +
          '<p class="small mt-1 mb-0">Рекорд зʼявляється, коли фактично виконаний підхід ' +
          'важчий за всі попередні. Поки що перевищувати нічого — все попереду.</p>' +
        '</div>';
      return;
    }

    const hasBook = book.length > 0;
    const rows = list.slice(0, 10).map(function (x) {
      return '<div class="wlog-row">' +
        '<span class="small">' + esc(x.name) +
          (x.isNew ? ' <span class="chip chip--sm chip--acc">Новий PR</span>' : '') +
          (x.book ? ' <span class="chip chip--sm">план</span>' : '') + '</span>' +
        '<span class="muted small">' + esc(dateLabel(dateOf(x.date))) +
          (x.reps ? ' · ' + x.reps + ' повт.' : '') + '</span>' +
        '<b class="mono">' + fmtNum.kg(x.kg) + ' кг</b>' +
      '</div>';
    }).join('');

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Особисті рекорди</h2>' +
          '<span class="small muted">' + list.length + ' ' + window.App.plural(list.length, 'вправа', 'вправи', 'вправ') + '</span>' +
        '</div>' +
        '<div class="mt-2">' + rows + '</div>' +
        '<p class="small muted mb-0" style="margin-top:10px">Найважчий фактично виконаний підхід. ' +
        '«Новий PR» — поставлений за останні два тижні.' +
        (hasBook ? ' Позначка «план» — вправи, яких ще немає у знімках тренувань: ' +
          'для них показано максимум із журналу робочих ваг.' : '') + '</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Історія: календар місяця                                            */
  /* ------------------------------------------------------------------ */
  /*
   * Основна навігація по минулих днях: місяць, Пн→Нд, плоскі клітинки з
   * числом дня, активний день — акцентом теми (токени, не hardcode:
   * зміна теми перефарбовує і його). Клік — підсумок дня нижче.
   * Тут НІЧОГО не редагується: позначки ставляться в теплокарті огляду.
   */

  function renderHcal() {
    const host = $('#jr-hcal');
    if (!host) return;

    /*
     * СІМ МІСЯЦІВ, А НЕ ОДИН.
     *
     * Місяць за раз відповідав на питання «що було у вересні», а питання
     * до історії інше: «як я тренувався останнім часом». Щоб побачити
     * провал у липні, доводилось клацати назад чотири рази й тримати
     * побачене в голові. Вікно те саме, що в теплокарті огляду
     * (HM_MONTHS), тож обидві сітки показують один відрізок часу.
     *
     * Стрілки лишились, але тепер зсувають ВІКНО на місяць, а не гортають
     * місяці: історія глибша за сім місяців нікуди не поділась.
     *
     * Саму сітку малює спільний DayCal — той самий, що в календарі
     * зважувань і в календарі сезону. Тут лишається лише те, чого немає
     * більше ніде: вікно з навігацією й рівень клітинки.
     */
    const now = new Date();
    const endY = state.hcalY, endM = state.hcalM;
    const isCurrentMonth = endY === now.getFullYear() && endM === now.getMonth();

    const firstDay = new Date(endY, endM - (HM_MONTHS - 1), 1);
    const lastOfMonth = new Date(endY, endM + 1, 0);
    const todayK = todayKey();
    const lastK = keyOf(lastOfMonth) > todayK ? todayK : keyOf(lastOfMonth);

    /* Підпис — діапазон, а не один місяць. Рік пишемо двічі лише тоді,
       коли вікно його справді перетинає. */
    const y0 = firstDay.getFullYear(), m0 = firstDay.getMonth();
    const range = y0 === endY
      ? MON[m0] + ' — ' + MON[endM] + ' ' + endY
      : MON[m0] + ' ' + y0 + ' — ' + MON[endM] + ' ' + endY;

    const cal = window.DayCal.html({
      label: 'Календар тренувань: ' + range,
      from: keyOf(firstDay),
      to: lastK,
      cls: 'mt-2',
      cell: function (k, d, isFuture) {
        if (isFuture) return null;
        const lvl = hmLevel(k);
        const sel = k === state.selDay;
        return {
          lvl: lvl,
          sel: sel,
          attrs: 'data-hday="' + k + '"',
          label: dateLabel(dateOf(k)) + ': ' + HM_LEVEL_TEXT[lvl]
        };
      }
    });

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:center;gap:10px">' +
          '<h2 style="margin:0">Історія</h2>' +
          '<div class="row" style="gap:8px;align-items:center">' +
            '<button class="icon-btn" type="button" data-hnav="-1" aria-label="Зсунути вікно на місяць назад">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>' +
            '</button>' +
            '<b class="mono" style="min-width:150px;text-align:center">' + range + '</b>' +
            '<button class="icon-btn" type="button" data-hnav="1" aria-label="Зсунути вікно на місяць уперед"' +
              (isCurrentMonth ? ' disabled' : '') + '>' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        cal +
        '<p class="small muted mt-1 mb-0">' + HM_MONTHS + ' місяців. Глибина заливки — ' +
          'частка закритих підходів, як у теплокарті вище: контур — відмічено вручну, ' +
          'суцільна заливка — закрито всі. Клік по дню — його підсумок нижче.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Історія: підсумок дня                                               */
  /* ------------------------------------------------------------------ */
  /*
   * Детальний журнал одного дня — все, що РЕАЛЬНО записано: сесія
   * тренування (з часом і знімком обʼєму, якщо є), змінені того дня
   * робочі ваги, вага тіла, закритий день харчування, трекери. Це
   * незмінний знімок: пізніші правки плану сюди не просочуються.
   */

  function dayWorkoutHtml(k) {
    const s = state.sessionLog[k];
    const manual = Number(state.workLog[k]) > 0;

    if (sessionCounts(s) && !(Number(state.workLog[k]) === 0 && Object.prototype.hasOwnProperty.call(state.workLog, k))) {
      const min = window.ProgressCore.sessionMinutes(s);
      /*
       * Стрілка «початок → кінець» має сенс лише коли між ними є час.
       * Записи, зроблені до виправлення t0 у history-core, мають t0 = t1
       * і давали рядок «Час: 17:27 → 17:27» — він виглядає як помилка й
       * нею і був. Полагодити ті дані вже не можна: справжній початок не
       * зберігся ніде. Тому для них чесніше показати одну позначку часу,
       * а не стрілку в саму себе.
       */
      const t0 = Number(s.t0) || 0;
      const t1 = Number(s.t1) || 0;
      const timeRow = !t0 ? ''
        : (t1 > t0)
          ? '<span class="small">Час: <b class="mono">' + hhmm(t0) + ' → ' + hhmm(t1) + '</b>' +
            (min !== null ? ' · <b class="mono">' + durTxt(min) + '</b>' : '') + '</span>'
          : '<span class="small">Записано о <b class="mono">' + hhmm(t0) + '</b></span>';
      const facts = [];
      if (Number.isFinite(Number(s.sets)) && s.sets > 0) facts.push('<b class="mono">' + s.sets + '</b> підходів');
      if (Number.isFinite(Number(s.reps)) && s.reps > 0) facts.push('<b class="mono">' + s.reps + '</b> повторень');
      if (Number.isFinite(Number(s.vol)) && s.vol > 0) facts.push('≈<b class="mono">' + thou(s.vol) + '</b> кг');

      return '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">' +
          '<h3 style="margin:0">' + esc(s.title || 'Тренування') + '</h3>' +
          /* Підходи точніші за вправи: 4 з 20 підходів і «0 з 14 вправ» —
             це один і той самий день, але друге читається як «нічого». */
          '<span class="chip chip--acc mono">' +
            (Number(s.totalSets) > 0
              ? (Number(s.doneSets) || 0) + ' з ' + s.totalSets + ' підходів'
              : s.done + ' з ' + s.total + ' вправ') +
          '</span>' +
        '</div>' +
        '<div class="row mt-1" style="gap:16px;flex-wrap:wrap">' +
          timeRow +
          (facts.length ? '<span class="small">' + facts.join(' · ') + '</span>' : '') +
        '</div>' +
        (!timeRow && !facts.length
          ? '<p class="small muted mt-1 mb-0">Стара сесія — без знімка часу й обʼєму: ці факти пишуться з нових тренувань.</p>'
          : '');
    }
    if (manual) {
      return '<h3 style="margin:0">Тренування</h3>' +
        '<p class="small mt-1 mb-0">Позначено вручну в календарі — «був у залі», без деталей сесії.</p>';
    }
    /*
     * СЕСІЯ Є, РОБОТИ НЕМАЄ (UX-006).
     *
     * Кнопка «Завершити» ставить s.end = 1 незалежно від виконання. Такий
     * день блокує день плану до наступного тижня і саме так підписаний на
     * головній і на сторінці тренування — а тут читалось «Цього дня
     * тренування не записано», тобто прямо навпаки. Людина бачила два
     * різні твердження про один день і не мала способу зрозуміти, чому
     * план не дає повторити тренування.
     *
     * Статистику це не міняє: у trainedDates і в теплокарті день і далі
     * не тренувальний — роботи справді не було.
     */
    if (s && Number(s.end) > 0) {
      return '<h3 style="margin:0">Тренування</h3>' +
        '<p class="small mt-1 mb-0">Сесію закрито з нульовим виконанням: жодного підходу не відмічено.</p>' +
        '<p class="small muted mt-1 mb-0">День плану вважається використаним, ' +
        'але в статистику й у теплокарту таке тренування не входить.</p>';
    }
    return '<h3 style="margin:0">Тренування</h3>' +
      '<p class="small muted mt-1 mb-0">Цього дня тренування не записано.</p>';
  }

  function renderDay() {
    const host = $('#jr-day');
    if (!host || !state.selDay) return;
    const k = state.selDay;
    const d = dateOf(k);

    const parts = [];

    // Тренування
    parts.push(dayWorkoutHtml(k));

    // Робочі ваги, змінені цього дня
    const changed = [];
    Object.keys(state.weightLog || {}).forEach(function (name) {
      (state.weightLog[name] || []).forEach(function (e) {
        if (e && e.d === k && Number.isFinite(Number(e.kg))) changed.push({ name: name, kg: Number(e.kg) });
      });
    });
    if (changed.length) {
      parts.push('<h3 style="margin:0">Робочі ваги</h3>' +
        '<div class="mt-1">' + changed.map(function (c) {
          return '<div class="wlog-row"><span class="small">' + esc(c.name) + '</span>' +
                 '<b class="mono">' + fmtNum.kg(c.kg) + ' кг</b></div>';
        }).join('') + '</div>');
    }

    // Вага тіла
    const bw = Number(state.bodyLog[k]);
    if (Number.isFinite(bw)) {
      parts.push('<h3 style="margin:0">Вага тіла</h3>' +
        '<p class="mt-1 mb-0"><b class="mono">' + fmtNum.kg(bw) + ' кг</b></p>');
    }

    // Харчування
    const meal = state.mealLog[k];
    if (meal && Number.isFinite(Number(meal.kcal))) {
      const hasT = Number(meal.target) > 0;
      const diff = hasT ? Math.round(meal.kcal - meal.target) : null;
      parts.push('<h3 style="margin:0">Харчування</h3>' +
        '<div class="row mt-1" style="gap:16px;flex-wrap:wrap">' +
          '<span class="small">Калорії: <b class="mono">' + meal.kcal + '</b>' +
            (hasT ? ' із цілі <b class="mono">' + meal.target + '</b> (' + (diff > 0 ? '+' : '') + diff + ')' : '') + '</span>' +
          '<span class="small">Б <b class="mono">' + (meal.p || 0) + '</b> · Ж <b class="mono">' + (meal.f || 0) +
            '</b> · В <b class="mono">' + (meal.c || 0) + '</b> г</span>' +
        '</div>');
    }

    // Трекери дня
    if (window.TrackerCore) {
      const TC = window.TrackerCore;
      const lines = TC.active(state.trackers).map(function (t) {
        const v = (state.trackerLog[t.id] || {})[k];
        if (v == null) return null;
        const def = TC.defFor(t);
        let txt = '';
        if (def.kind === 'boolean' || v === true) txt = v ? '✓' : '—';
        else if (def.kind === 'pair') {
          txt = def.fields.map(function (f) {
            return v[f] != null ? (f === 'before' ? 'до ' : f === 'after' ? 'після ' : f === 'pain' ? 'біль ' : 'втома ') + v[f] : null;
          }).filter(Boolean).join(' · ');
        } else if (def.kind === 'duration') txt = TC.formatDuration(Number(v) || 0);
        else txt = fmtNum.n(Number(v) || 0, 1) + (def.unit ? ' ' + def.unit : '');
        return txt ? '<div class="wlog-row"><span class="small">' + esc(t.name) + '</span><b class="mono">' + esc(txt) + '</b></div>' : null;
      }).filter(Boolean);
      if (lines.length) {
        parts.push('<h3 style="margin:0">Трекери</h3><div class="mt-1">' + lines.join('') + '</div>');
      }
    }

    host.innerHTML =
      '<div class="card">' +
        '<h2 style="margin:0">' + WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' +
          MONTHS_GEN[d.getMonth()] + ' ' + d.getFullYear() + '</h2>' +
        '<div class="mt-2">' + parts.join('<hr class="divider">') + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Перемикач Огляд / Історія                                           */
  /* ------------------------------------------------------------------ */
  /*
   * Стан живе в location.hash (#history), щоб «Історія» мала пряме
   * посилання з меню й акаунта. replaceState, а не присвоєння hash:
   * присвоєння скролить до якоря, якого тут немає.
   */

  function setView(v, opts) {
    state.view = v === 'history' ? 'history' : 'overview';
    const ov = $('#view-overview'), hi = $('#view-history');
    if (ov) ov.hidden = state.view === 'history';
    if (hi) hi.hidden = state.view !== 'history';
    const radio = document.querySelector('input[name="jr-view"][value="' + state.view + '"]');
    if (radio) radio.checked = true;
    if (!opts || !opts.silent) {
      try {
        history.replaceState(null, '',
          location.pathname + location.search + (state.view === 'history' ? '#history' : ''));
      } catch (_) {}
    }
    if (state.view === 'history') { renderHcal(); renderDay(); }
  }

  /* ------------------------------------------------------------------ */
  /* Збереження й обробники                                              */
  /* ------------------------------------------------------------------ */

  async function persist(patch) {
    /* Патч може бути функцією (SYN-011) — вона виконується всередині
       ланцюга збереження, на актуальному профілі. Для stampRating тут
       потрібен звичайний обʼєкт, тому рахуємо його на тому, що маємо на
       екрані: для позначки «факт побачено» цього досить. */
    const flat = (typeof patch === 'function') ? (patch(state.profile) || {}) : patch;
    // Факт записано тут — тут його й позначаємо побаченим для Rating,
    // інакше він зарахується лише коли (і якщо) людина відкриє «Сьогодні».
    window.App.stampRating(Object.assign({}, state.profile, flat), flat);
    try { await Store.saveProfile(patch); }
    catch (e) {
      // .queued означає «мережі немає, лежить у черзі» — це не втрата даних,
      // і лякати людину червоним тостом тут неправильно.
      toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err');
    }
  }

  /**
   * Перемалювати блок, не втрачаючи клавіатурний фокус.
   *
   * renderWeight і renderTrain перебудовують innerHTML цілком. Через це
   * після Enter на клітинці теплокарти фокус летів на <body>, і людина,
   * яка працює з клавіатури, мусила табати від початку сторінки — після
   * КОЖНОЇ позначки. Запамʼятовуємо елемент за стабільним data-атрибутом
   * і повертаємо фокус на його новий екземпляр.
   */
  function keepFocus(render) {
    const before = document.activeElement;
    let selector = null;
    if (before && before !== document.body && before.dataset) {
      if (before.dataset.hm) selector = '[data-hm="' + before.dataset.hm + '"]';
      else if (before.dataset.wDel) selector = '[data-w-del="' + before.dataset.wDel + '"]';
      else if (before.id) selector = '#' + before.id;
    }

    render();

    if (!selector) return;
    const after = document.querySelector(selector);
    if (after && after.focus) after.focus();
  }

  function wire() {
    if (state.wired) return;
    state.wired = true;

    $('#jr-weight').addEventListener('click', function (e) {
      if (e.target.closest('#w-add')) {
        const input = $('#w-kg');
        const v = Number(String(input && input.value).replace(',', '.'));
        if (!Number.isFinite(v) || v < W_MIN || v > W_MAX) {
          toast('Вага має бути числом від ' + W_MIN + ' до ' + W_MAX + ' кг', 'err');
          return;
        }
        // Пів кроку побутових ваг: 0,1 кг. Точніші цифри — ілюзія точності.
        const kg = Math.round(v * 10) / 10;
        /* День беремо з календаря, а не з годинника: людина могла обрати
           пропущений четвер. weightDay() сам відкочується на сьогодні,
           якщо обране зіпсоване або в майбутньому. */
        const day = weightDay();
        state.bodyLog[day] = kg;
        /* Патч — функція (SYN-011): дописуємо один день на актуальному
           профілі, а не надсилаємо весь журнал, зчитаний колись. Інакше
           сусідня вкладка втрачала б свої записи цілком. */
        persist(function (p) {
          const base = (p && p.bodyLog && typeof p.bodyLog === 'object') ? p.bodyLog : {};
          const out = Object.assign({}, base); out[day] = kg;
          return { bodyLog: out };
        });
        keepFocus(renderWeight);
        toast(day === todayKey() ? 'Записано' : 'Записано за ' + dateLabel(dateOf(day)), 'ok');
        return;
      }

      /* Вибір дня в календарі ваги. Клік нічого не пише — він лише
         переводить поле вводу на цей день; запис робить «Записати». */
      const wcell = e.target.closest('[data-wday]');
      if (wcell) {
        state.wDay = wcell.dataset.wday;
        keepFocus(renderWeight);
        /* Фокус у поле: людина натиснула день саме щоб вписати число, і
           зайвий тап по полю після цього — зайвий. */
        const f = $('#w-kg');
        if (f) { try { f.focus(); f.select(); } catch (_) {} }
        return;
      }
      if (e.target.closest('#w-today')) {
        state.wDay = todayKey();
        keepFocus(renderWeight);
        return;
      }
      const del = e.target.closest('[data-w-del]');
      if (del) {
        const key = del.dataset.wDel;
        // Журнал ваги append-only: видалене нізвідки не відновити, а ✕
        // стоїть у щільному рядку впритул до інших елементів.
        if (!window.confirm('Видалити запис ваги за ' + key + '? Відновити його буде нічим.')) return;
        delete state.bodyLog[key];
        /* Видалення теж адресне: прибираємо один день, решту журналу
           беремо з актуального профілю. */
        persist(function (p) {
          const base = (p && p.bodyLog && typeof p.bodyLog === 'object') ? p.bodyLog : {};
          const out = Object.assign({}, base); delete out[key];
          return { bodyLog: out };
        });
        keepFocus(renderWeight);
        toast('Запис за ' + key + ' видалено', 'ok');
      }
    });

    $('#jr-train').addEventListener('click', function (e) {
      const cell = e.target.closest('[data-hm]');
      if (cell) {
        const k = cell.dataset.hm;
        if (trained(k)) {
          // Під днем є сесія — просте видалення нічого не дало б, бо
          // trained() однаково побачив би її. Пишемо явний 0 як перекриття.
          if (hasSession(k)) state.workLog[k] = 0; else delete state.workLog[k];
        } else {
          state.workLog[k] = 1;
        }
        persist({ workLog: state.workLog });
        keepFocus(renderTrain);
        return;
      }
      if (e.target.closest('#t-mark')) {
        state.workLog[todayKey()] = 1;
        persist({ workLog: state.workLog });
        keepFocus(renderTrain);
        toast('Позначено', 'ok');
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Перехід за якорем                                                    */
  /* ------------------------------------------------------------------ */
  /*
   * ЧОМУ ЦЕ РОБИТЬ КОД, А НЕ БРАУЗЕР.
   *
   * Блоки журналу — порожні <div> у розмітці; усе, що в них є, малює цей
   * файл після читання профілю. Браузер стрибає по якорю ОДРАЗУ на
   * завантаженні, коли #jr-weight ще нульової висоти й стоїть відразу під
   * заголовком, — і людина, що прийшла з плитки «Зважування», опиняється
   * на початку сторінки. Далі приїжджає вміст, штовхає блок на кілька
   * екранів униз, і виглядає це так, ніби посилання нікуди не веде.
   *
   * Тому: після рендера самі знаходимо блок, ПРОЯВЛЯЄМО його (.reveal
   * тримає ще не показані блоки прозорими й зсунутими на 22px — інакше
   * прокрутили б до невидимого) і прокручуємо. Відступ під прилиплу шапку
   * вже враховує scroll-padding-top у CSS.
   *
   * requestAnimationFrame — щоб розкладка встигла злягтись після
   * innerHTML: без нього координати були б із попереднього кадру.
   */
  const HASH_BLOCKS = ['jr-overview', 'jr-adherence', 'jr-weight', 'jr-train',
                       'jr-lifts', 'jr-exercise', 'jr-prs', 'jr-food', 'jr-trackers'];

  function focusHash() {
    const id = String(location.hash || '').replace(/^#/, '');
    if (HASH_BLOCKS.indexOf(id) < 0) return;
    const el = document.getElementById(id);
    if (!el) return;
    requestAnimationFrame(function () {
      el.classList.add('is-in');
      /*
       * Прокручуємо вручну, а не scrollIntoView.
       *
       * Відступ під прилиплу шапку заданий у CSS через scroll-padding-top
       * і константу --nav-h (80px), але шапка з логотипом і кнопками
       * реально вища — 86px на десктопі. Різницю видно: верхні вісім
       * пікселів картки лишались під шапкою. Тому беремо ВИМІРЯНУ висоту
       * шапки й додаємо 16px повітря — тоді картка починається рівно там,
       * де око її шукає, за будь-якого розміру шапки.
       */
      const nav = document.querySelector('#site-nav');
      const navH = nav ? nav.getBoundingClientRect().height : 0;
      /*
       * Позицію беремо з offsetTop, а не з getBoundingClientRect.
       *
       * Rect враховує ТРАНСФОРМИ, а блок, який щойно проявляється,
       * зсунутий на 22px униз (.reveal). Отже rect бреше рівно на ці
       * 22px, ми прокручуємо на стільки ж далі — і картка зупиняється
       * під шапкою замість того, щоб стати під нею. offsetTop — це
       * розкладка, трансформи його не чіпають.
       */
      let top = 0;
      for (let node = el; node; node = node.offsetParent) top += node.offsetTop;
      const y = top - navH - 16;
      try { window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); }
      catch (_) { window.scrollTo(0, Math.max(0, y)); }
      /* Коротка підсвітка: після довгої прокрутки має бути видно, КУДИ
         саме привело посилання, інакше блок губиться серед сусідніх
         карток. Клас знімає сам себе — стан у розмітці не лишається. */
      el.classList.add('is-target');
      setTimeout(function () { el.classList.remove('is-target'); }, 2000);
      settle(el, navH);
    });
  }

  /*
   * ДОВОДКА ПІСЛЯ ПРОКРУТКИ: одного пострілу мало.
   *
   * Прокрутка рахується від висоти блоків, ЯКІ ВЖЕ НАМАЛЬОВАНІ. Але
   * сторінка домальовується й далі: шрифт замінює запасний на Inter і
   * переносить рядки, картинки рівнів отримують розмір, графік
   * перемальовується під ширину. Кожна така подія зсуває цільовий блок
   * на десятки, а то й сотні пікселів — і людина, що прийшла з плитки
   * «Зважування», опиняється не там, куди цілилась. У прогоні перевірок
   * це виглядало як блок на 655px замість 102px, і повторний запуск
   * проходив: класична гонка, яку неможливо зловити оком.
   *
   * Тому півтори секунди після прокрутки стежимо за реальним місцем
   * блоку й доводимо його, якщо він поїхав більше ніж на 4px.
   *
   * ДОВОДКА НЕГАЙНО ЗДАЄТЬСЯ, ЩОЙНО ЛЮДИНА ТОРКНУЛАСЬ ПРОКРУТКИ. Це не
   * ввічливість, а обовʼязкова умова: інтерфейс, який відбирає прокрутку
   * назад, гірший за той, що просто промахнувся.
   */
  function settle(el, navH) {
    let alive = true;
    const stop = function () {
      if (!alive) return;
      alive = false;
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
      clearInterval(timer);
      clearTimeout(end);
    };
    window.addEventListener('wheel', stop, { passive: true, once: true });
    window.addEventListener('touchstart', stop, { passive: true, once: true });
    window.addEventListener('keydown', stop, { once: true });

    const fix = function () {
      if (!alive || !el.isConnected) return stop();
      let top = 0;
      for (let node = el; node; node = node.offsetParent) top += node.offsetTop;
      const want = Math.max(0, top - navH - 16);
      /* window.scrollY дробовий на екранах із масштабом ≠ 1, тому поріг
         у 4px, а не рівність. */
      if (Math.abs(window.scrollY - want) > 4) {
        try { window.scrollTo({ top: want, behavior: 'smooth' }); }
        catch (_) { window.scrollTo(0, want); }
      }
    };
    const timer = setInterval(fix, 250);
    const end = setTimeout(stop, 1500);
  }

  async function init() {
    if (!$('#jr-weight')) return;

    let p = {};
    try { p = await Store.getProfile() || {}; } catch (_) {}
    state.bodyLog = (p.bodyLog && typeof p.bodyLog === 'object' && !Array.isArray(p.bodyLog)) ? p.bodyLog : {};
    state.workLog = (p.workLog && typeof p.workLog === 'object' && !Array.isArray(p.workLog)) ? p.workLog : {};
    state.sessionLog = (p.sessionLog && typeof p.sessionLog === 'object') ? p.sessionLog : {};
    state.weightLog = (p.weightLog && typeof p.weightLog === 'object') ? p.weightLog : {};
    state.mealLog = (p.mealLog && typeof p.mealLog === 'object') ? p.mealLog : {};
    state.goal = typeof p.goal === 'string' ? p.goal : null;
    const days = Number(p.activePlan && p.activePlan.days) || Number(p.daysPerWeek) || 0;
    state.daysTarget = (Number.isInteger(days) && days >= 1 && days <= 7) ? days : 0;
    if (window.TrackerCore) {
      state.trackers = window.TrackerCore.ensureBuiltins(p.trackers);
      state.trackerLog = (p.trackerLog && typeof p.trackerLog === 'object') ? p.trackerLog : {};
    }

    const now = new Date();
    state.hcalY = now.getFullYear();
    state.hcalM = now.getMonth();
    state.selDay = todayKey();

    seasonize();
    wire();
    renderOverview();
    renderAdherence();
    keepFocus(renderWeight);
    keepFocus(renderTrain);
    renderLifts();
    renderPrs();
    renderExercise();
    renderFood();
    renderTrackers();

    // Вигляд з URL: #history відкриває історію одразу (посилання з меню
    // й акаунта). silent — hash уже правильний, не чіпаємо його.
    setView(location.hash === '#history' ? 'history' : 'overview', { silent: true });
    /* Якір із зовнішнього посилання доводиться відпрацьовувати самим —
       браузерний перехід уже стався, коли блоків ще не існувало. */
    focusHash();
    window.addEventListener('hashchange', function () {
      setView(location.hash === '#history' ? 'history' : 'overview', { silent: true });
      focusHash();
    });

    // Перемикач періоду живе всередині блоку ваги й перемальовується
    // разом із ним — слухаємо на рівні документа
    document.addEventListener('change', function (e) {
      const pp = e.target.closest('input[name="w-period"]');
      if (pp) { state.period = Number(pp.value); keepFocus(renderWeight); return; }

      const vp = e.target.closest('input[name="adh-period"]');
      if (vp) { state.adhPeriod = Number(vp.value); renderAdherence(); return; }

      const em = e.target.closest('input[name="ex-metric"]');
      if (em) { state.exMetric = em.value; renderExercise(); return; }
      const ep = e.target.closest('input[name="ex-period"]');
      if (ep) { state.exPeriod = Number(ep.value); renderExercise(); return; }
      const es = e.target.closest('input[name="ex-set"]');
      if (es) { state.exSet = Number(es.value) || 0; renderExercise(); return; }
      if (e.target.id === 'ex-pick') { state.exName = e.target.value; renderExercise(); return; }

      const vw = e.target.closest('input[name="jr-view"]');
      if (vw) setView(vw.value);
    });

    // Календар історії: навігація місяцями і вибір дня
    document.addEventListener('click', function (e) {
      const nav = e.target.closest('[data-hnav]');
      if (nav && !nav.disabled) {
        const m = state.hcalM + Number(nav.dataset.hnav);
        const d = new Date(state.hcalY, m, 1);
        const now2 = new Date();
        // у майбутні місяці не ходимо — там нічого немає за побудовою
        if (d.getFullYear() > now2.getFullYear() ||
            (d.getFullYear() === now2.getFullYear() && d.getMonth() > now2.getMonth())) return;
        state.hcalY = d.getFullYear();
        state.hcalM = d.getMonth();
        renderHcal();
        return;
      }
      const day = e.target.closest('[data-hday]');
      if (day) {
        state.selDay = day.dataset.hday;
        renderHcal();
        renderDay();
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('#lifts-more')) { state.liftsAll = true; renderLifts(); return; }
      if (e.target.closest('#lifts-less')) { state.liftsAll = false; renderLifts(); return; }
      const lf = e.target.closest('[data-lift]');
      if (lf) {
        state.openLift = state.openLift === lf.dataset.lift ? null : lf.dataset.lift;
        renderLifts();
      }
    });

    // Таймер на «Моєму плані» міг позначити день, поки ця вкладка відкрита
    Store.onChange(function (profile) {
      if (!profile) return;
      /*
       * Умови були виду `if (profile.bodyLog)`, а bodyLog у blankProfile —
       * це {}, тобто істина ЗАВЖДИ. Через це будь-яке збереження звідки
       * завгодно перемальовувало картку ваги: набране, але ще не записане
       * число в полі «Сьогодні, кг» зникало (keepFocus повертав фокус, але
       * значення вже було затерте збереженим). Тепер перемальовуємо лише
       * коли обʼєкт РЕАЛЬНО інший, і ніколи — поки в картці щось набирають.
       */
      const active = document.activeElement;
      const typingIn = function (sel) {
        return active && active.closest && active.closest(sel);
      };

      if (profile.activePlan && Number(profile.activePlan.days)) {
        state.daysTarget = Number(profile.activePlan.days);
      }
      if (profile.workLog && profile.workLog !== state.workLog) {
        state.workLog = profile.workLog;
        seasonize();
        keepFocus(renderTrain); renderAdherence();
        if (state.view === 'history') { renderHcal(); renderDay(); }
      }
      if (profile.sessionLog && profile.sessionLog !== state.sessionLog) {
        state.sessionLog = profile.sessionLog;
        seasonize();
        keepFocus(renderTrain); renderOverview(); renderAdherence();
        if (state.view === 'history') { renderHcal(); renderDay(); }
      }
      if (profile.bodyLog && profile.bodyLog !== state.bodyLog) {
        state.bodyLog = profile.bodyLog;
        if (!typingIn('#jr-weight input')) keepFocus(renderWeight);
      }
      if (profile.weightLog && profile.weightLog !== state.weightLog) {
        state.weightLog = profile.weightLog;
        seasonize();
        renderLifts(); renderPrs(); renderExercise(); renderAdherence();
        if (state.view === 'history') renderDay();
      }
      if (profile.mealLog && profile.mealLog !== state.mealLog) {
        state.mealLog = profile.mealLog;
        seasonize();
        renderFood();
        if (state.view === 'history') renderDay();
      }
      if (window.TrackerCore && (profile.trackers || profile.trackerLog)) {
        if (profile.trackers) state.trackers = window.TrackerCore.ensureBuiltins(profile.trackers);
        if (profile.trackerLog) state.trackerLog = profile.trackerLog;
        renderTrackers();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
