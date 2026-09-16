/**
 * Розрахунок харчування — чиста математика, без жодного DOM.
 *
 * Винесено з js/nutrition.js окремим файлом, бо цими формулами користуються
 * дві сторінки: калькулятор (nutrition.html) і раціон (meals.html).
 * Раціону потрібна рівно одна функція — targetFor — і тягнути заради неї
 * весь інтерфейс калькулятора немає сенсу.
 *
 * Ланцюг розрахунку:
 *   BMR  — базовий обмін. Mifflin-St Jeor (PMID 2305711), а якщо відомий
 *          відсоток жиру — Katch-McArdle, бо він враховує суху масу.
 *   TDEE — BMR × коефіцієнт активності.
 *   Ціль — TDEE ± відсоток залежно від мети.
 *   Білок — від маси тіла, решта — жир і вуглеводи.
 *
 * Усі формули — популяційні регресії. Реальні витрати конкретної людини
 * можуть відрізнятися на ±10–15%. Тому головний інструмент — не калькулятор,
 * а зважування раз на тиждень і корекція калорій за фактичною динамікою.
 */
(function () {
  'use strict';

  const ACTIVITY = {
    1.2:   { label: 'Сидяча робота, тренувань немає',        desc: 'Офіс, менше 5 тис. кроків' },
    1.375: { label: 'Легка активність, 1–3 тренування',      desc: 'Трохи ходьби, легкі тренування' },
    1.55:  { label: 'Помірна активність, 3–5 тренувань',     desc: 'Регулярний зал, 8–10 тис. кроків' },
    1.725: { label: 'Висока активність, 6–7 тренувань',      desc: 'Щоденні тренування або фізична робота' },
    1.9:   { label: 'Дуже висока, 2 тренування на день',     desc: 'Спорт + важка фізична праця' }
  };

  const GOALS = {
    bulk:     { label: 'Набір мʼязової маси',  pct:  0.12, rate: '+0,25…0,5% маси тіла на тиждень' },
    /* Агресивний набір дає більше ваги, але не більше мʼязів: у Garthe 2013
       група з вищою калорійністю набрала 3,9% маси проти 1,5%, жиру +15%
       проти +3%, а приріст СУХОЇ маси між групами не відрізнявся (PMID 23679146).
       Тому цей режим існує як інструмент для дуже худих, а не як «швидший шлях». */
    bulkfast: { label: 'Агресивний набір',     pct:  0.20, rate: '+0,5…0,8% маси тіла на тиждень',
      warn: '<b>Швидше — не означає більше мʼязів.</b> У рандомізованому дослідженні на 39 елітних ' +
            'спортсменах група, яка їла більше (3585 проти 2964 ккал), набрала 3,9% маси проти 1,5% — ' +
            'але <b>жирова маса зросла на 15% проти 3%, а приріст сухої маси між групами не відрізнявся</b>. ' +
            'Тобто зайві калорії пішли в жир, не в мʼязи. Цей режим має сенс, якщо ви дуже худі і вага стоїть ' +
            'навіть на +12%, або якщо вам важливіше набрати вагу як таку. Інакше беріть звичайний набір.',
      pmid: '23679146' },
    recomp:  { label: 'Рекомпозиція',        pct:  0.00, rate: 'вага стоїть, склад тіла змінюється' },
    maintain:{ label: 'Підтримання',         pct:  0.00, rate: 'вага стабільна ±0,5 кг' },
    cut:     { label: 'Скидання ваги',       pct: -0.18, rate: '−0,5…1% маси тіла на тиждень' },
    // Темп перевірений розрахунком по всьому діапазону ваг: −25% від TDEE
    // дає −0,75…−0,79% маси тіла на тиждень. Раніше тут було заявлено −1%,
    // чого ця гілка не досягає ніде.
    // maxMonths — не косметика, а частина моделі: прогноз мусить рахувати
    // те, що сам і радить. Продовжувати −25% дванадцять місяців поспіль
    // ніхто не пропонує, а стара модель саме це й екстраполювала.
    cutfast: { label: 'Агресивне схуднення', pct: -0.25, maxMonths: 3, rate: '≈−0,8% маси тіла на тиждень, макс. 8–12 тижнів' }
  };

  const KCAL = { protein: 4, fat: 9, carb: 4 };

  /*
   * СХЕМА ПРИЙОМІВ ЇЖІ — одна на весь сайт.
   *
   * Була лише в js/nutrition.js, тобто знав про неї тільки калькулятор.
   * Раціон вів власний список прийомів із перейменуванням, і два місця
   * розходились: у калькуляторі 5 прийомів, у раціоні — три свої назви.
   * Тепер джерело одне: profile.meals задає кількість, mealNames — назви.
   */
  const MEALS_MIN = 3;
  const MEALS_MAX = 6;
  /* Скільки прийомів показувати, поки людина нічого не обрала. Значення
     мусить бути спільним: калькулятор відкривався з чотирма прийомами,
     а раціон будувався з трьох — і до першого збереження профілю сторінки
     показували різне. */
  const MEALS_DEFAULT = 4;

  const MEAL_SETS = {
    3: ['Сніданок', 'Обід', 'Вечеря'],
    4: ['Сніданок', 'Обід', 'Перекус', 'Вечеря'],
    5: ['Сніданок', 'Перекус', 'Обід', 'Перекус', 'Вечеря'],
    6: ['Сніданок', 'Перекус', 'Обід', 'Перекус', 'Вечеря', 'Перед сном']
  };

  /** Назви прийомів для заданої кількості. Копія, а не сам масив. */
  function mealNames(count) {
    return (MEAL_SETS[mealCount(count)] || MEAL_SETS[MEALS_DEFAULT]).slice();
  }

  /**
   * Кількість прийомів із профілю, приведена до дозволених меж.
   *
   * null і порожній рядок — це «не обрано», а не нуль: Number(null) дає 0,
   * і без окремої перевірки порожній профіль мовчки клампився б до
   * MEALS_MIN замість замовчування.
   */
  function mealCount(value) {
    if (value === null || value === undefined || value === '') return MEALS_DEFAULT;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return MEALS_DEFAULT;
    return Math.min(MEALS_MAX, Math.max(MEALS_MIN, n));
  }

  /* ------------------------------------------------------------------ */
  /* Розрахунки                                                          */
  /* ------------------------------------------------------------------ */

  /** Mifflin-St Jeor, ккал/добу */
  function bmrMifflin(sex, weightKg, heightCm, age) {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return sex === 'female' ? base - 161 : base + 5;
  }

  /** Katch-McArdle — точніший, якщо відомий % жиру */
  function bmrKatch(weightKg, bodyfatPct) {
    const lbm = weightKg * (1 - bodyfatPct / 100);
    return 370 + 21.6 * lbm;
  }

  /**
   * Норма білка — ДІАПАЗОН 1,6–2,0 г на кг маси тіла.
   *
   * Обидва числа — з одного джерела, мета-аналізу Morton 2018
   * (PMID 28698222). Точкова оцінка перелому — 1,62 г/кг/добу, а 95%
   * довірчий інтервал до неї: (1,03; 2,20). Дослівно з роботи:
   * «break point = 1.62 (1.03, 2.20) g/kg/day».
   *
   * 1,6 г/кг — точкова оцінка: далі приріст сухої маси від додаткового
   * білка не росте. 2,2 г/кг — ВЕРХНЯ МЕЖА довірчого інтервалу: значення,
   * при якому плато настало б за найобережнішого прочитання тих самих
   * даних. Тому діапазон 1,6–2,2 — це не «мінімум і запас навмання», а
   * ширина невизначеності однієї цифри.
   *
   * Раніше верх стояв 2,0 г/кг і обґрунтовувався як «запас на дефіцит» —
   * тобто числом без джерела. До того було глухе 2,0 із посиланням на
   * Helms 2014 (PMID 24864135), і воно було хибне: та робота говорить про
   * 2,3–3,1 г на кг СУХОЇ маси, а не загальної (research.html цитує її
   * правильно). Тепер обидві межі читаються з одного рядка Morton 2018.
   */
  const PROTEIN_MIN_PER_KG = 1.6;
  const PROTEIN_MAX_PER_KG = 2.2;

  /**
   * Стеля білка як частки калорійності.
   *
   * Без неї при великій вазі виходили абсурдні числа: 150 кг -> 300 г
   * білка = 44% калорійності, а профіль 120 кг / 120 см / 90 років на
   * агресивному дефіциті давав 63,7% енергії з білка. Понад ~35% — це вже
   * зона, де описана білкова інтоксикація, і видавати таке як «норму»
   * не можна незалежно від того, звідки взялась вага.
   */
  const PROTEIN_MAX_SHARE = 0.35;

  /** Клітковина: 14 г на 1000 ккал (рекомендація IOM/DRI) */
  const FIBER_PER_1000 = 14;

  /**
   * Енергетична цінність клітковини.
   *
   * Це і є виправлення подвійної оплати. Раніше carb рахувався як увесь
   * залишок енергії, поділений на 4 — тобто клітковина неявно тарифікувалась
   * по 4 ккал/г усередині вуглеводів, і ЩЕ РАЗ показувалась окремою смугою
   * по 2 ккал/г. Хто закривав усі пʼять смуг рівно на 100%, зʼїдав на 2,8%
   * більше за ціль, і смуга «Калорії» показувала перебір, поки решта
   * показувала «точно».
   *
   * У довіднику продуктів поле c не містить клітковини (вона окремо),
   * тому цільові вуглеводи теж мають бути НЕТТО.
   */
  const KCAL_FIBER = 2;

  /**
   * Цільові макронутрієнти.
   *
   * Гарантія, яку тепер дає ця функція: сума p·4 + f·9 + c·4 + fiber·2
   * ДОРІВНЮЄ заданій калорійності (з точністю до плаваючої коми), або
   * повертається infeasible: true. Мовчазного розходження більше немає.
   *
   * Раніше Math.max(0, …) в кінці обрізав відʼємні вуглеводи, і сума
   * макросів ставала БІЛЬШОЮ за ціль — до +604 ккал (+22,7%) — без жодного
   * сигналу. Смуга при цьому нормувалась на суму макросів і показувала
   * рівно 100%, тобто сторінка суперечила сама собі.
   *
   * @returns {{protein:number, fat:number, carb:number, fiber:number,
   *            infeasible:boolean, proteinCapped:boolean}} грами на добу
   */
  function macros(kcal, weightKg) {
    // Захист на випадок прямого виклику зі сміттям: без нього одна
    // нескінченність на вході робить NaN усі три макронутрієнти
    kcal = Number(kcal);
    weightKg = Number(weightKg);
    const empty = { protein: 0, fat: 0, carb: 0, fiber: 0, infeasible: true, proteinCapped: false };
    if (!Number.isFinite(kcal) || !Number.isFinite(weightKg) || kcal <= 0 || weightKg <= 0) {
      return empty;
    }

    const fiber = kcal / 1000 * FIBER_PER_1000;
    const fiberKcal = fiber * KCAL_FIBER;

    // Білок: ціль — верх діапазону, але не понад частку калорійності.
    const proteinCap = kcal * PROTEIN_MAX_SHARE / KCAL.protein;
    let protein = Math.min(weightKg * PROTEIN_MAX_PER_KG, proteinCap);
    const proteinCapped = protein < weightKg * PROTEIN_MIN_PER_KG;

    // Жир: 25% калорійності, але не менше 0,6 г/кг маси тіла — нижче
    // страждає гормональний фон і засвоєння жиророзчинних вітамінів.
    let fat = Math.max(kcal * 0.25 / KCAL.fat, weightKg * 0.6);

    // Вуглеводи — усе, що лишилось ПІСЛЯ клітковини
    const carbFrom = function () {
      return (kcal - protein * KCAL.protein - fat * KCAL.fat - fiberKcal) / KCAL.carb;
    };
    let carb = carbFrom();

    /*
     * На жорсткому дефіциті вуглеводи йдуть у мінус. Ріжемо спочатку жир
     * до 0,5 г/кг, і лише потім білок до 1,6 г/кг — саме білок найбільше
     * впливає на збереження мʼязів при нестачі енергії.
     */
    if (carb < 50) {
      let need = (50 - carb) * KCAL.carb;

      const canCutFat = Math.max(0, fat - weightKg * 0.5);
      const fromFat = Math.min(canCutFat, need / KCAL.fat);
      fat -= fromFat;
      need -= fromFat * KCAL.fat;

      if (need > 0) {
        const canCutProtein = Math.max(0, protein - weightKg * PROTEIN_MIN_PER_KG);
        protein -= Math.min(canCutProtein, need / KCAL.protein);
      }
      carb = carbFrom();
    }

    /*
     * Якщо вуглеводи все одно відʼємні — задана калорійність фізично не
     * вміщує навіть підлогу з білка, жиру й клітковини. Раніше цей випадок
     * мовчки обрізався до нуля, і сума макросів перевищувала ціль.
     *
     * Тепер: масштабуємо білок і жир так, щоб сума ТОЧНО дорівнювала цілі,
     * і повертаємо прапорець. Сторінка мусить це показати, а не вдавати,
     * що все зійшлось.
     */
    let infeasible = false;
    if (carb < 0) {
      infeasible = true;
      const room = Math.max(0, kcal - fiberKcal);
      const need = protein * KCAL.protein + fat * KCAL.fat;
      const k = need > 0 ? room / need : 0;
      protein *= k;
      fat *= k;
      carb = 0;
    }

    // Остання перевірка результату. Вхід може бути формально скінченним
    // (1e308), але арифметика з нього все одно дає Infinity − Infinity = NaN.
    // Дешевше перевірити вихід, ніж передбачити всі шляхи туди.
    if (![protein, fat, carb, fiber].every(Number.isFinite)) return empty;

    return {
      protein: protein, fat: fat, carb: carb, fiber: fiber,
      infeasible: infeasible, proteinCapped: proteinCapped
    };
  }

  /** Індекс маси тіла та його трактування */
  function bmiInfo(weightKg, heightCm) {
    const h = heightCm / 100;
    const bmi = weightKg / (h * h);
    let label;
    if (bmi < 18.5) label = 'Недостатня вага';
    else if (bmi < 25) label = 'Норма';
    else if (bmi < 30) label = 'Надлишкова вага';
    else label = 'Ожиріння';
    return { bmi: bmi, label: label };
  }

  /**
   * Добова норма з даних профілю — щоб сторінка «Раціон» показувала залишок
   * до цілі, не змушуючи вводити зріст і вагу вдруге.
   *
   * Свідомо не кешуємо результат у профіль: якщо змінити вагу чи мету
   * в калькуляторі, збережене число мовчки застаріло б, а перерахунок
   * тут коштує мікросекунди.
   *
   * @returns {null|{kcal,protein,fat,carb,fiber,tdee,bmr,goalLabel}}
   *          null, якщо профіль ще не заповнено
   */
  /**
   * Межі, у яких формули взагалі щось означають. Це не примха, а захист:
   * раніше перевірялось лише «більше нуля», тому вага 1e308 проходила далі
   * й перетворювала весь розрахунок на Infinity, а потім на NaN. Такі числа
   * потрапляють не лише з клавіатури — профіль можна імпортувати або
   * відредагувати в localStorage.
   */
  const LIMITS = {
    weight:   [30, 300],
    height:   [120, 250],
    age:      [10, 100],
    bodyfat:  [3, 60],
    activity: [1.0, 2.5]
  };

  /** Число в межах або null. Рядки на кшталт '80' приймаємо, '80abc' — ні. */
  function bounded(value, range) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return (n >= range[0] && n <= range[1]) ? n : null;
  }

  /* Вікно вимірювання: чотири тижні, бо один день застілля в ньому
     важить учетверо менше, ніж у тижневому. Коротше (два тижні) —
     запасний варіант, коли даних ще мало. */
  const TDEE_WINDOW_DAYS = 28;

  /* Стать РЯДКОМ для формули Міффліна. Назва саме sexOf, а не
     isFemale*: перша версія поверталась 'male'/'female', і рядок пішов
     у `isFemale ? 1200 : 1500` як умова — обидва рядки істинні, тож
     чоловіки почали отримувати жіночу підлогу 1200. Зловив старий
     регресійний тест підлоги, і саме для цього він і писався. */
  function sexOf(p) { return (p && p.sex === 'female') ? 'female' : 'male'; }

  function targetFor(profile) {
    const p = profile || {};
    const weight = bounded(p.weight, LIMITS.weight);
    const height = bounded(p.height, LIMITS.height);
    const age = bounded(p.age, LIMITS.age);
    if (weight === null || height === null || age === null) return null;

    const bodyfat = bounded(p.bodyfat, LIMITS.bodyfat);
    const hasBF = bodyfat !== null;
    const bmr = hasBF ? bmrKatch(weight, bodyfat) : bmrMifflin(sexOf(p), weight, height, age);

    const activity = bounded(p.activity, LIMITS.activity) || 1.55;
    const formulaTdee = bmr * activity;

    /*
     * ВИМІРЯНЕ ПІДТРИМАННЯ ЗАМІСТЬ ФОРМУЛИ.
     *
     * Формула описує СЕРЕДНЮ людину, якої в житті не буває: похибка на
     * конкретній людині — сотні калорій. Якщо є щоденник їжі й регулярні
     * зважування, підтримання можна не вгадувати, а виміряти
     * (js/tdee-core.js). Перемикач у профілі, бо це рішення людини:
     * вимірювання вимагає вести обидва журнали.
     *
     * Формула лишається запасним варіантом НАЗАВЖДИ — у перші два тижні
     * іншого просто немає, і тоді ніщо не має зламатись чи почервоніти.
     *
     * МАСШТАБУВАННЯ ПО ВАЗІ. Виміряне число описує людину, яка важить
     * refKg сьогодні. Прогноз маси кличе targetFor із ІНШОЮ вагою —
     * саме щоб побачити, як зміняться витрати. Переносити сьогоднішнє
     * підтримання на 70 кг без поправки означало б прогнозувати
     * схуднення, якого не буде: витрати падають разом із масою.
     * Вимірювання дає РІВЕНЬ, формула — форму залежності від ваги.
     */
    const TC = window.TdeeCore;
    let measured = null;
    let tdee = formulaTdee;
    if (p.tdeeMode === 'measured' && TC && typeof TC.measure === 'function') {
      const m = TC.measure(p.bodyLog, p.mealLog, TDEE_WINDOW_DAYS)
             || TC.measure(p.bodyLog, p.mealLog, TC.MIN_DAYS);
      if (m && m.refKg > 0) {
        const refBmr = hasBF
          ? bmrKatch(m.refKg, bodyfat)
          : bmrMifflin(sexOf(p), m.refKg, height, age);
        const scale = refBmr > 0 ? bmr / refBmr : 1;
        tdee = m.kcal * scale;
        measured = m;
      }
    }

    /*
     * ДЕЛЬТА ВИТРАТ СЦЕНАРІЮ (tdeeBonus).
     *
     * Це НЕ переоснова обміну й не «тренувальний доданок» до звичайного
     * рахунку — такий доданок був би подвійним (коефіцієнт активності вже
     * включає тренування, а виміряні витрати включають їх за визначенням;
     * див. docs/ENGINEERING.md, розділ 24). Тут інше: різниця витрат у
     * сценарії «а якби я ходив у зал на два рази більше». Різниця —
     * величина, якої в базовому рахунку немає, отже подвоювати нічого.
     */
    const bonus = bounded(p.tdeeBonus, [1, 2000]);
    if (bonus !== null) tdee = tdee + bonus;

    const goal = GOALS[p.goal] || GOALS.maintain;
    /*
     * СВОЄ ЧИСЛО КАЛОРІЙ (kcalOverride) — важіль симулятора.
     *
     * Мета з перемикача задає ВІДСОТОК від витрат; тут людина називає
     * саме число. Далі все як звичайно: підлога калорійності, макроси,
     * прогноз маси — жоден запобіжник не обходиться, інакше симулятор
     * показував би те, чого в застосунку не буває.
     */
    const own = bounded(p.kcalOverride, [500, 12000]);
    const raw = own !== null ? own : tdee * (1 + goal.pct);

    /*
     * ПІДЛОГА калорійності.
     *
     * Відсоток застосовувався до TDEE без жодної нижньої межі, і в межах,
     * які дозволяє сама форма, знаходилось 2475 комбінацій із ціллю нижче
     * 1200 ккал і 2240 — нижче базового обміну. Цілком звичайний профіль
     * (жінка 50 кг, 160 см, сидяча робота, агресивне схуднення) отримував
     * ~1025 ккал/добу без жодного попередження.
     *
     * Дві межі, і спрацьовує вища:
     *   • базовий обмін — нижче нього дефіцит створюють рухом, а не їжею;
     *   • 1200/1500 ккал — загальноприйнятий поріг, нижче якого раціон
     *     складно закрити за мікронутрієнтами.
     * Обрізання не мовчазне: floored повідомляє інтерфейсу, що сталося.
     */
    const isFemale = p.sex === 'female';
    const hardMin = isFemale ? 1200 : 1500;
    const floorKcal = Math.max(bmr, hardMin);
    const floored = raw < floorKcal;
    const kcal = floored ? floorKcal : raw;

    const m = macros(kcal, weight);

    return {
      kcal: kcal,
      protein: m.protein,
      fat: m.fat,
      carb: m.carb,
      // Клітковину бере macros: там вона враховується в енергетичному
      // балансі, і рахувати її вдруге тут означало б знову їх розсинхронити.
      fiber: m.fiber,
      proteinRange: [weight * PROTEIN_MIN_PER_KG, weight * PROTEIN_MAX_PER_KG],
      infeasible: m.infeasible,
      proteinCapped: m.proteinCapped,
      floored: floored,
      floorKcal: floorKcal,
      rawKcal: raw,
      tdee: tdee,
      /* Формульне значення лишається поруч навмисно: екран має вміти
         показати ОБИДВА числа й різницю між ними, інакше «ціль раптом
         змінилась» виглядає як збій. */
      formulaTdee: formulaTdee,
      measured: measured,
      /* Позначка «це сценарій, а не ваша ціль»: екран мусить уміти
         сказати це вголос, інакше симульоване число не відрізнити від
         справжнього. */
      simulated: own !== null,
      tdeeBonus: bonus || 0,
      bmr: bmr,
      goalLabel: goal.label
    };
  }


  /* ------------------------------------------------------------------ */
  /* Прогноз маси                                                        */
  /* ------------------------------------------------------------------ */
  /*
   * Тут дві РІЗНІ за надійністю речі, і плутати їх не можна.
   *
   * 1. ЗАГАЛЬНА ВАГА — майже чиста арифметика. Дефіцит чи профіцит за
   *    N днів ділимо на енергоємність жирової тканини (~7700 ккал/кг).
   *
   *    Але навіть тут є системна похибка: 7700 — це саме про ЖИР.
   *    Суха тканина «коштує» дешевше (близько 1800 ккал/кг разом із водою,
   *    яку вона тягне), а глікоген взагалі приходить із водою в перші дні.
   *    Тому на наборі реальна вага росте ШВИДШЕ за модель, особливо
   *    перші два тижні, і це не мʼязи.
   *
   * 2. РОЗПОДІЛ НА МʼЯЗИ Й ЖИР — це модель, а не розрахунок.
   *    Ключова ідея: приріст мʼязової маси має СТЕЛЮ ШВИДКОСТІ, якої
   *    калорії не піднімають. Скільки не їж, за місяць не набереш 5 кг
   *    мʼязів — надлишок піде в жир. Саме це показав Garthe 2013:
   *    група з вищою калорійністю набрала втричі більше маси, але
   *    приріст СУХОЇ маси між групами не відрізнявся (PMID 23679146).
   *
   *    Стеля залежить від тренувального стажу. Конкретні числа нижче —
   *    ПРАКТИЧНА КОНВЕНЦІЯ, не висновок дослідження: робіт, які вимірювали б
   *    максимальну швидкість набору сухої маси за стажем, немає.
   */

  /** Енергоємність жирової тканини, ккал на кг */
  const KCAL_PER_KG_FAT = 7700;

  /** Стеля приросту СУХОЇ маси, кг на місяць. Конвенція, не дослідження. */
  const LEAN_CEILING = {
    novice: 0.90,   // до 1 року
    inter:  0.45,   // 1–2 роки
    adv:    0.22,   // 3–5 років
    elite:  0.11    // понад 5 років
  };

  const DAYS_PER_MONTH = 30.44;

  /**
   * Прогноз зміни маси на задану кількість місяців.
   *
   * @param {object} profile   профіль користувача
   * @param {number} months    горизонт
   * @returns {null|object}    null, якщо даних не вистачає
   */
  function massForecast(profile, months) {
    const t = targetFor(profile);
    if (!t) return null;

    const tier = LEAN_CEILING[profile && profile.trainingAge] ? profile.trainingAge : 'inter';
    const ceiling = LEAN_CEILING[tier] * months;

    /*
     * Прогноз ПОМІСЯЧНИЙ, з перерахунком витрат.
     *
     * Було: deltaKcal рахувався один раз від початкового TDEE й множився на
     * 365 днів. Вага в моделі мінялась, витрати — ні. Для цілком звичайного
     * профілю (чоловік 80 кг, 180 см, 30 років, активність 1,55, агресивне
     * схуднення) це давало −32,7 кг за рік і кінцеву вагу 47,3 кг, тобто
     * ІМТ 14,6. У межах форми знаходилось 12 профілів із прогнозом ≤ 0 кг.
     *
     * Тепер кожен місяць рахується від поточної ваги: витрати падають разом
     * із нею, дефіцит у кілокалоріях меншає, і крива сама виходить на плато —
     * саме так, як це відбувається насправді.
     *
     * Плюс підлога: нижче ІМТ 16 модель не опускається взагалі. Це не
     * прогноз, а межа, за якою розмова вже не про калькулятор.
     */
    const heightM = (Number(profile.height) || 0) / 100;

    let w = Number(profile.weight) || 0;
    const startW = w;

    /*
     * Нижня межа — ІМТ 18,5, нижня межа норми. Нижче модель не рахує:
     * там уже не питання калькулятора.
     *
     * Межа застосовується ЛИШЕ якщо стартова вага вища за неї. Інакше
     * виходив зворотний абсурд: підліток 35 кг при зрості 210 см отримував
     * на дефіциті прогноз +35 кг, бо вагу підтягувало вгору до порога.
     */
    const bmiFloor = heightM > 0 ? 18.5 * heightM * heightM : 0;
    const minWeight = (bmiFloor && startW > bmiFloor) ? bmiFloor : 0;

    /*
     * Стартова вага вже нижча за норму, а мета — дефіцит. Прогнозувати
     * подальше схуднення тут неправильно в принципі: єдина чесна відповідь —
     * сказати, що для цієї ваги така мета не рахується.
     */
    const goalPct = (GOALS[profile && profile.goal] || GOALS.maintain).pct;
    const belowNorm = Boolean(bmiFloor && startW < bmiFloor && goalPct < 0);

    const goalCfg = GOALS[profile && profile.goal] || GOALS.maintain;
    const maxMonths = goalCfg.maxMonths || Infinity;

    let hitFloor = false;
    let phaseEnded = false;

    for (let i = 0; i < months && !belowNorm; i++) {
      /*
       * Після maxMonths режим сам собою закінчується — далі рахуємо
       * підтримання. Це і є та частина, якої моделі бракувало найбільше:
       * дефіцит не триває вічно, він має кінець, і кінець уже написаний
       * у самій цілі.
       */
      const phase = (i >= maxMonths) ? 'maintain' : profile.goal;
      if (i >= maxMonths) phaseEnded = true;

      const step = targetFor(Object.assign({}, profile, { weight: w, goal: phase }));
      if (!step) break;

      /*
       * Метаболічна адаптація. Понад те, що дає сама втрата ваги, витрати
       * на тривалому дефіциті просідають ще на ~10%: менше спонтанного руху,
       * дешевша робота м'язів, нижча активність щитоподібної. Вводимо
       * поступово за перші три місяці дефіциту, щоб не робити стрибка.
       */
      const inDeficit = step.kcal < step.tdee;
      /*
       * Адаптація ПРОПОРЦІЙНА ГЛИБИНІ дефіциту, а не однакові 10 % на
       * будь-який. Плоскі 10 % означали, що дефіцит у 290 ккал (це ~10 %
       * витрат) з'їдається адаптацією повністю й вага стоїть НАЗАВЖДИ —
       * тобто модель стверджувала, що худнути на помірному дефіциті
       * неможливо в принципі. Десять відсотків — це верхня оцінка, і
       * міряна вона на глибоких дефіцитах; на чверті витрат беремо її
       * повністю, на дрібніших — пропорційну частку.
       */
      const depth = inDeficit
        ? Math.min(1, (step.tdee - step.kcal) / (step.tdee * 0.25))
        : 0;
      const adapt = 1 - 0.10 * Math.min(1, (i + 1) / 3) * depth;
      /*
       * Адаптація ЗМЕНШУЄ дефіцит, але ніколи його не ПЕРЕВЕРТАЄ.
       *
       * Без цієї межі дрібний дефіцит ставав профіцитом: витрати 3042,
       * їжа 2900 — дефіцит 142, а мінус 10 % витрат це вже 304, і
       * модель показувала НАБІР ваги на дефіциті. Найпомітніше на
       * сценаріях симулятора, де різниця між їжею й витратами мала
       * навмисно: додаєш два тренування на тиждень — і прогноз росте.
       *
       * Фізіологічно адаптація виводить на плато, а не розвертає
       * напрямок: тому адаптовані витрати не опускаються нижче за
       * з'їдене.
       */
      let expend = step.tdee * adapt;
      if (inDeficit && expend < step.kcal) expend = step.kcal;
      const dKcal = step.kcal - expend;

      let next = w + dKcal * DAYS_PER_MONTH / KCAL_PER_KG_FAT;
      if (minWeight && next < minWeight) { next = minWeight; hitFloor = true; }
      w = next;
    }

    const totalKg = w - startW;
    const deltaKcal = t.kcal - t.tdee;

    // «Вага стоїть» — це не рівно нуль, а коридор: похибка розрахунку
    // витрат більша за дрібний профіцит
    const flat = Math.abs(totalKg) < 0.25 * months;

    let lean, fat;
    if (flat) {
      // Рекомпозиція: вага на місці, склад тіла зсувається. Іде повільніше
      // за набір у профіциті, тому від стелі береться частина.
      lean = ceiling * 0.4;

      /*
       * Не можна спалити жир, якого немає.
       *
       * Наявна жирова маса не враховувалась узагалі: чоловік 60 кг із 8%
       * жиру (тобто 4,8 кг жирової маси) отримував прогноз −4,32 кг жиру,
       * і в залишку виходило 0,48 кг = 0,8% маси тіла — нижче есенційного
       * жиру, тобто фізіологічно неможливо. І це друкувалось як факт.
       *
       * Лишаємо 5% маси тіла як есенційний мінімум (для чоловіків ~3%,
       * для жінок ~12%; беремо обережну середину, бо стать тут не завжди
       * відома, а помилятись краще в бік меншої обіцянки).
       */
      const bf = Number(profile.bodyfat);
      if (Number.isFinite(bf) && bf > 0) {
        const fatMass = (Number(profile.weight) || 0) * bf / 100;
        const essential = (Number(profile.weight) || 0) * 0.05;
        const burnable = Math.max(0, fatMass - essential);
        lean = Math.min(lean, burnable);
      }
      fat = totalKg - lean;
    } else if (totalKg > 0) {
      // У профіциті мʼязи ростуть не швидше за стелю; решта — жир
      lean = Math.min(totalKg, ceiling);
      fat = totalKg - lean;
    } else {
      // На дефіциті приріст сухої маси — виняток, а не правило.
      // Новачок ще може, досвідчений у кращому разі втримає наявне.
      lean = tier === 'novice' ? ceiling * 0.3 : 0;
      fat = totalKg - lean;
    }

    return {
      months: months,
      tier: tier,
      totalKg: totalKg,
      lean: lean,
      fat: fat,
      // Розкид, а не одна цифра: показує, наскільки результат залежить
      // від припущення про стелю
      leanLow: lean * 0.6,
      leanHigh: lean * 1.4,
      ceiling: ceiling,
      cappedByCeiling: totalKg > 0 && totalKg > ceiling,
      flat: flat,
      weightNow: startW,
      weightEnd: w,
      hitFloor: hitFloor,
      belowNorm: belowNorm,
      phaseEnded: phaseEnded,
      maxMonths: Number.isFinite(maxMonths) ? maxMonths : null,
      deltaKcal: deltaKcal
    };
  }

  /*
   * ГОРИЗОНТ ПОШУКУ ДАТИ ФІНІШУ.
   *
   * Пʼять років. Не тому, що далі неможливо, а тому, що далі відповідь
   * перестає бути відповіддю: модель адаптації калібрована на місяцях, а
   * не на роках, і «дійдете за 74 місяці» — це не план, а шум із виглядом
   * точності. За горизонтом чесніше сказати «не за цим режимом».
   */
  const ETA_HORIZON = 60;

  /**
   * Коли вага дійде до цілі.
   *
   * ЦЕ НЕ НОВА МОДЕЛЬ. Функція ганяє той самий massForecast і шукає
   * місяць, у якому крива перетинає ціль. Окрема формула для дати
   * розійшлася б із прогнозом на першій же правці самої моделі —
   * адаптація, стеля набору, підлога ІМТ, кінець агресивного режиму, — і
   * сторінка показувала б дві різні відповіді на одне питання. Тут вони
   * не можуть розійтись за побудовою.
   *
   * Ціна — 60 прогонів прогнозу замість одного. Кожен дешевий (цикл по
   * місяцях із арифметикою), і рахується це раз на ввід, а не в циклі
   * малювання.
   *
   * Місяці повертаються ДРОБОМ: перетин майже ніколи не випадає рівно на
   * межу місяця, і округлення вгору до цілого зсувало б дату на три тижні.
   *
   * @param {object} profile той самий профіль, що для massForecast
   * @param {number} targetWeight ціль, кг
   * @param {number} [horizon] горизонт у місяцях
   * @returns {{reachable:boolean, months:number|null, reason:string|null}}
   */
  function etaToWeight(profile, targetWeight, horizon) {
    const target = Number(targetWeight);
    if (!Number.isFinite(target) || target <= 0) {
      return { reachable: false, months: null, reason: 'ціль не задана' };
    }

    const h = Math.max(1, Math.min(ETA_HORIZON, Math.round(Number(horizon) || 36)));
    const first = massForecast(profile, 1);
    if (!first) return { reachable: false, months: null, reason: 'замало даних про профіль' };

    const start = first.weightNow;
    if (!Number.isFinite(start)) {
      return { reachable: false, months: null, reason: 'замало даних про профіль' };
    }

    /* Похибка ваги в пів кіло — це коливання води за день, а не прогрес.
       Ціль у цьому коридорі вважається вже досягнутою. */
    if (Math.abs(target - start) < 0.5) {
      return { reachable: true, months: 0, reason: null };
    }

    if (first.belowNorm) {
      return { reachable: false, months: null,
               reason: 'за цієї ваги така мета не рахується' };
    }

    const down = target < start;
    const end = massForecast(profile, h);
    if (!end) return { reachable: false, months: null, reason: 'замало даних про профіль' };

    const crossedAtEnd = down ? end.weightEnd <= target : end.weightEnd >= target;
    if (!crossedAtEnd) {
      /* Причина називається, а не ховається за «недосяжно». Порядок
         перевірок від найконкретнішої до найзагальнішої. */
      let reason;
      if (end.flat) reason = 'за цим режимом вага стоїть';
      else if (end.hitFloor) reason = 'вага впирається в мінімальну для вашого зросту';
      else if (down !== (end.weightEnd < start)) reason = 'цей режим веде вагу в інший бік';
      else reason = 'за цим режимом не встигає за ' + h + ' міс.';
      return { reachable: false, months: null, reason: reason };
    }

    let prev = start;
    for (let m = 1; m <= h; m++) {
      const w = massForecast(profile, m).weightEnd;
      const crossed = down ? w <= target : w >= target;
      if (crossed) {
        /* Лінійна інтерполяція всередині місяця: усередині кроку модель
           однаково лінійна, тож це не вигадка точності, а той самий крок. */
        const span = w - prev;
        const frac = span === 0 ? 0 : (target - prev) / span;
        return { reachable: true,
                 months: (m - 1) + Math.max(0, Math.min(1, frac)),
                 reason: null };
      }
      prev = w;
    }

    /* Сюди дійти не можна: crossedAtEnd уже сказав, що перетин є. Але
       мовчазний вихід із циклу — це саме той випадок, коли «не може
       статись» одного дня стається. */
    return { reachable: false, months: null, reason: 'за цим режимом не встигає за ' + h + ' міс.' };
  }

  /* ------------------------------------------------------------------ */
  /* Симулятор «що якщо»                                                 */
  /* ------------------------------------------------------------------ */
  /*
   * Два важелі, і жодного більше: скільки їсти й скільки разів на тиждень
   * заходити в зал. Це рівно те, чим людина справді керує. Третій важіль
   * («а якби обмін був швидшим») був би не симулятором, а втішанням.
   *
   * НОВОЇ МАТЕМАТИКИ ТУТ НЕМАЄ. Усе рахує massForecast — той самий, що
   * малює звичайний прогноз, з тими самими запобіжниками: підлога
   * калорійності, межа ІМТ, стеля приросту сухої маси, метаболічна
   * адаптація. Симулятор лише підставляє в нього інші вхідні числа.
   * Друга модель «для сценаріїв» розійшлася б із першою на першій правці,
   * і на одному екрані стояли б два різні прогнози.
   */

  /** Горизонти сценарію. Три числа, бо четверте вже ніхто не читає. */
  const SIM_MONTHS = [3, 6, 12];

  /**
   * @param {object} profile профіль (потрібні зріст, вага, вік)
   * @param {object} opts
   *   kcal          — скільки їсти; без нього береться поточна ціль
   *   sessionsDelta — на скільки тренувань на тиждень більше (чи менше)
   *   perSession    — скільки коштує одне тренування, ккал
   *                   (CoachCore.trainingKcal.perSession)
   *   goalWeight    — цільова вага для дати досягнення
   * @returns {?{kcal:number, tdee:number, rows:Array, eta:object,
   *             perDay:number, simulated:boolean}}
   */
  function simulate(profile, opts) {
    const p = profile || {};
    const o = opts || {};
    const base = targetFor(p);
    if (!base) return null;

    /* Дельта витрат від зміни кількості тренувань, у розрахунку на добу.
       Тиждень має сім днів — зайве тренування не коштує стільки ж
       щодня. */
    const delta = Number(o.sessionsDelta);
    const per = Number(o.perSession);
    const bonus = (Number.isFinite(delta) && delta > 0 && Number.isFinite(per) && per > 0)
      ? Math.round(delta * per / 7)
      : null;

    const kcal = bounded(o.kcal, [500, 12000]);
    const sim = Object.assign({}, p, {
      kcalOverride: kcal === null ? base.kcal : kcal,
      tdeeBonus: bonus
    });

    const t = targetFor(sim);
    if (!t) return null;

    const rows = SIM_MONTHS.map(function (m) {
      return massForecast(sim, m);
    }).filter(Boolean);
    if (!rows.length) return null;

    return {
      kcal: t.kcal,
      tdee: t.tdee,
      perDay: Math.round(t.kcal - t.tdee),
      bonus: bonus || 0,
      simulated: t.simulated,
      floored: t.floored,
      rows: rows,
      eta: etaToWeight(sim, o.goalWeight, ETA_HORIZON)
    };
  }

  window.NutritionCalc = {
    ACTIVITY: ACTIVITY,
    LIMITS: LIMITS,
    GOALS: GOALS,
    KCAL: KCAL,
    MEALS_MIN: MEALS_MIN,
    MEALS_MAX: MEALS_MAX,
    MEALS_DEFAULT: MEALS_DEFAULT,
    mealNames: mealNames,
    mealCount: mealCount,
    PROTEIN_MIN_PER_KG: PROTEIN_MIN_PER_KG,
    PROTEIN_MAX_PER_KG: PROTEIN_MAX_PER_KG,
    PROTEIN_MAX_SHARE: PROTEIN_MAX_SHARE,
    KCAL_FIBER: KCAL_FIBER,
    bmrMifflin: bmrMifflin,
    bmrKatch: bmrKatch,
    macros: macros,
    bmiInfo: bmiInfo,
    targetFor: targetFor,
    massForecast: massForecast,
    simulate: simulate,
    SIM_MONTHS: SIM_MONTHS,
    etaToWeight: etaToWeight,
    ETA_HORIZON: ETA_HORIZON,
    LEAN_CEILING: LEAN_CEILING
  };
})();
