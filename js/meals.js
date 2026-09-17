/**
 * Раціон: довідник продуктів, конструктор рецептів на контейнери, план дня.
 *
 * Три блоки, одна арифметика:
 *   1. Продукти — КБЖВ на 100 г, з перемиканням «сире / готове».
 *   2. Рецепти  — інгредієнти в грамах + кількість контейнерів → КБЖВ порції.
 *   3. День     — прийоми їжі з продуктів і контейнерів, підсумок проти норми.
 *
 * Норма береться з калькулятора харчування (window.NutritionCalc.targetFor),
 * а не вводиться вдруге: інакше два числа розʼїхались би після першої ж
 * зміни ваги.
 *
 * Рецепти й день зберігаються в профіль. День — рівно один, поточний:
 * це не щоденник, а «зібрати сьогоднішній раціон і побачити залишок».
 */
(function () {
  'use strict';

  /*
   * ЄДИНІ межі порцій і грамів на весь файл.
   *
   * Раніше їх було три різні: модалка clamp(…, 1, 5000) — і ввід 0 г мовчки
   * ставав 1 г; редактор рецепта clamp(…, 0, 10000); таблиця дня Math.max(0, …)
   * узагалі без верхньої межі — там ввід 999999 показувався як «999999 г»,
   * а калорії рахувались від 100 000 (foods.js мовчки ріже до MAX_GRAMS).
   * Розбіжність у десять разів без жодного сигналу.
   */
  /*
   * Одна ПОЗИЦІЯ в дні — до 5 кг: більше в одному прийомі не їдять, а
   * саме так виглядала помилка «зайвий нуль» (99999 г → день на
   * 38 000 ккал, і він назавжди в історії). Та сама стеля стоїть у
   * валідаторі імпорту (js/account.js) і в атрибуті max поля. Інгредієнт
   * РЕЦЕПТА — до 10 кг: рецепт готують каструлею на кілька днів.
   */
  const GRAMS_MIN = 0, GRAMS_MAX = 5000;
  const RECIPE_GRAMS_MAX = 10000;
  const PORTIONS_MIN = 0, PORTIONS_MAX = 20;
  const CONTAINERS_MIN = 1, CONTAINERS_MAX = 20;

  /*
   * Межі швидкого запису дня (F2). Верхня — та сама, що у валідаторі
   * імпорту для mealLog: 20 000 ккал — це вже не день, а зайвий нуль.
   * Білок необовʼязковий, тому нижня межа в нього своя: 20 г — не ціль, а
   * описка, і приймати її як «білковий день» означало б збрехати рейтингу.
   */
  const QUICK_KCAL_MIN = 200, QUICK_KCAL_MAX = 20000;
  const QUICK_P_MIN = 20, QUICK_P_MAX = 500;

  /**
   * Грами з поля вводу → число в межах, або null.
   *
   * null означає «не приймаємо» — не «нуль»: раніше сміття мовчки ставало
   * 0, а 99999 мовчки обрізалось до стелі, і людина не бачила, що ввела
   * не те. Кома приймається як десятковий роздільник, «1e9», «∞», NaN,
   * відʼємне і понад max — ні.
   */
  /**
   * Контейнери рецепта: те саме правило, що й для грамів (UX-011).
   *
   * Було: clamp(Number(m.portions) || 0, 0.25, PORTIONS_MAX). Тобто
   * значення поза межами мовчки затискалось, а нечисловий ввід ('abc',
   * '-3') давав NaN → 0 → clamp → 0,25 контейнера. Прев'ю модалки при
   * цьому показувало числа для введеного значення, а в день лягало інше:
   * сміття в полі ДОДАВАЛО їжу.
   *
   * @returns {number|null} null — ввід відхилено, повідомити людині
   */
  function parsePortions(raw) {
    const str = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(str)) return null;
    const n = Number(str);
    if (!Number.isFinite(n) || n < 0.25 || n > PORTIONS_MAX) return null;
    return Math.round(n * 100) / 100;
  }

  function parseGrams(raw, max) {
    const str = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(str)) return null;
    const n = Number(str);
    if (!Number.isFinite(n) || n < GRAMS_MIN || n > (max || GRAMS_MAX)) return null;
    return Math.round(n * 10) / 10;
  }

  /*
   * СХЕМА ПРИЙОМІВ ЇЖІ ЗАДАЄТЬСЯ НЕ ТУТ.
   *
   * Раніше раціон вів власний список прийомів: три захардкоджені назви,
   * кнопки «Додати прийом» і «✕», плюс поле перейменування. Через це в
   * калькуляторі могло стояти 5 прийомів, а тут — три чужі назви, і
   * розкладка з «Харчування» ні на що не спиралась.
   *
   * Тепер джерело одне: profile.meals (перемикач 3–6 на nutrition.html),
   * назви — NutritionCalc.mealNames. Скільки прийомів обрано там, стільки
   * карток тут, з тими самими назвами.
   */
  function mealSchema() {
    const NC = window.NutritionCalc;
    return (NC && NC.mealNames) ? NC.mealNames(state.profile && state.profile.meals)
                                : ['Сніданок', 'Обід', 'Вечеря'];
  }

  /**
   * Накласти схему з профілю на наявні прийоми, не загубивши їжу.
   *
   * Якщо кількість прийомів у профілі зменшилась, зайві картки зникають —
   * але їхній вміст переїжджає в останній прийом, а не видаляється мовчки.
   * Втратити набране через перемикач на іншій сторінці — найгірше, що тут
   * може статись.
   */
  /**
   * @param {Array} meals прийоми як вони є зараз
   * @param {object} [report] сюди складається, ЩО саме довелось перенести:
   *   { moved: скільки позицій, into: назва прийому }. Потрібен лише для
   *   повідомлення користувачу — сама логіка перенесення від нього не
   *   залежить і не змінюється.
   */
  /* Сама логіка — у js/day-core.js (TST-002): там її можуть завантажити
     тести, а тут файл тягне DOM і window.App. Обгортка лишається заради
     mealSchema(), який читає профіль. */
  function applySchema(meals, report) {
    return window.DayCore.applySchema(meals, mealSchema(), report);
  }

  /**
   * Привести день із профілю до форми, з якою решта файла вміє працювати.
   *
   * Перевірялось лише Array.isArray(meals) — тобто жодне значення всередині.
   * Профіль редагується імпортом і живе в localStorage, тож туди легко
   * потрапляло сміття: portions: -5 давало підсумок дня −4161 ккал і білок
   * −418 г (смуги прогресу отримували відʼємний got), portions: 1e9 давало
   * 832 мільярди ккал. Модалка й таблиця клампили, а завантаження — ніяк.
   */
  function sanitizeDay(day) {
    const raw = (day && Array.isArray(day.meals)) ? day.meals.slice(0, 12) : [];

    const meals = raw.map(function (m) {
      const items = (m && Array.isArray(m.items) ? m.items : []).slice(0, 60)
        .map(function (it) {
          if (!it || typeof it !== 'object') return null;
          if (it.kind === 'recipe') {
            if (typeof it.recipeId !== 'string') return null;
            return {
              kind: 'recipe',
              recipeId: it.recipeId,
              portions: clamp(Number(it.portions) || 0, PORTIONS_MIN, PORTIONS_MAX)
            };
          }
          if (it.kind === 'snap') {
            /* Заморожена позиція (копія дня, F1): джерела в довіднику
               немає, КБЖВ лежить у самій позиції. Без цієї гілки
               скопійована позиція зникала б при першому ж читанні
               профілю — тобто копія дня жила б до перезавантаження. */
            const snap = window.DayCore.freezeItem(it, state.recipes);
            if (!snap) return null;
            snap.qty = clamp(snap.qty, 0,
              snap.unit === 'portion' ? PORTIONS_MAX : GRAMS_MAX);
            return snap;
          }
          if (typeof it.foodId !== 'string') return null;
          return {
            kind: 'food',
            foodId: it.foodId,
            grams: clamp(Number(it.grams) || 0, GRAMS_MIN, GRAMS_MAX),
            cooked: Boolean(it.cooked)
          };
        })
        .filter(Boolean);

      return { items: items };
    });

    const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
    const date = (day && DATE_KEY.test(day.date)) ? day.date : null;
    return { meals: applySchema(meals), date: date };
  }

  /** Кількість контейнерів рецепта як ціле число в межах */
  function containersOf(r) {
    const n = Math.round(Number(r && r.containers));
    if (!Number.isFinite(n)) return CONTAINERS_MIN;
    return Math.min(CONTAINERS_MAX, Math.max(CONTAINERS_MIN, n));
  }

  const { $, $$, esc, round, clamp, toast, safeUrl, plural, fmtNum } = window.App;
  const Foods = window.Foods;
  const FOODS = window.FOODS || [];
  const FOOD_GROUPS = window.FOOD_GROUPS || [];

  /* ------------------------------------------------------------------ */
  /* Стан                                                                */
  /* ------------------------------------------------------------------ */

  const state = {
    profile: {},
    recipes: [],            // користувацькі рецепти
    day: null,              // { meals: [{ name, items: [...] }] }
    editingRecipe: null,    // чернетка рецепта у формі
    foodQuery: '',
    foodGroup: 'all',
    foodCooked: false,      // показувати КБЖВ готового
    folds: {},              // які блоки згорнуто (памʼять у localStorage)
    openRecipe: null,
    quickMeal: null,        // прийом, з якого почали «+ Додати продукт» (null = останній)
    copyOpen: false,        // чи розгорнуто список днів-джерел для копії (F1)
    quick: false,           // режим швидкого запису дня (F2)
    quickKcal: '',          // що набрано в полі «ккал» швидкого запису
    quickP: '',             // що набрано в полі «білок» швидкого запису
    modal: null             // чернетка додавання в день, див. блок «Вікно додавання»
  };

  /*
   * ДЕНЬ НЕСЕ ВЛАСНУ ДАТУ.
   *
   * Раніше profile.day не мав дати зовсім, і закриття писало підсумок у
   * дату НАТИСКАННЯ кнопки. Забув закрити понеділок — уся понеділкова їжа
   * лягала у вівторок разом із вівторковою, а понеділок лишався порожнім.
   * Переліт на захід міг перезаписати вже закритий день.
   *
   * date проставляється при першому продукті (stampDay) і саме за нею день
   * закривається. null означає «день ще порожній».
   */
  const EMPTY_DAY = function () {
    return { meals: applySchema([]), date: null };
  };

  /** Проставити дату дню, якщо її ще немає. Викликати перед кожним записом. */
  function stampDay() {
    if (!state.day) state.day = EMPTY_DAY();
    if (!state.day.date && window.HistoryCore) {
      state.day.date = window.HistoryCore.todayKey();
    }
    return state.day.date;
  }

  /**
   * Вбудовані рецепти з js/recipes-data.js. Вони йдуть першими й доступні
   * лише для читання: правити те, що прилетіло з оновленням сайту, немає
   * сенсу — наступне оновлення однаково перезапише правку.
   */
  function baseRecipes() {
    const list = window.BASE_RECIPES;
    return Array.isArray(list) ? list : [];
  }

  /** Чи цей рецепт вбудований (а отже, незмінюваний) */
  function isBase(id) {
    return baseRecipes().some(function (r) { return r.id === id; });
  }

  /** Усе, що показуємо: спершу вбудовані, потім власні */
  function allRecipes() {
    return baseRecipes().concat(state.recipes);
  }

  function recipeById(id) {
    return allRecipes().find(function (r) { return r.id === id; }) || null;
  }

  async function persist() {
    try {
      /* Дата дня фіксується на першому ж збереженні з їжею — далі вона
         не міняється, хоч би скільки день лишався незакритим. */
      if (state.day && state.day.meals &&
          state.day.meals.some(function (m) { return m.items && m.items.length; })) {
        stampDay();
      }
      await window.Store.saveProfile({ recipes: state.recipes, day: state.day });
    } catch (e) {
      toast('Не збереглося: ' + e.message, 'err');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Арифметика — window.DayCore (js/day-core.js)                        */
  /* ------------------------------------------------------------------ */
  /*
   * Суми по рецепту, прийому й дню винесені в спільний модуль: той самий
   * підсумок показують «Сьогодні» й головна, і рахувати вони мусять
   * ідентично. Тут лишились тонкі обгортки, які підставляють поточний
   * стан сторінки (власні рецепти).
   */

  const ZERO = window.DayCore.ZERO;
  const scale = window.DayCore.scale;

  function recipeTotals(recipe) { return window.DayCore.recipeTotals(recipe); }
  function perContainer(recipe) { return window.DayCore.perContainer(recipe); }
  function mealTotals(meal) { return window.DayCore.mealTotals(meal, state.recipes); }
  function dayTotals() { return window.DayCore.dayTotals(state.day, state.recipes); }

  function target() {
    return window.NutritionCalc ? window.NutritionCalc.targetFor(state.profile) : null;
  }

  /* ------------------------------------------------------------------ */
  /* Дрібні шматки розмітки                                              */
  /* ------------------------------------------------------------------ */

  function macroLine(t) {
    return '<span class="mono">' + round(t.kcal, 0) + '</span> ккал · ' +
           'Б <span class="mono">' + round(t.p, 1) + '</span> · ' +
           'Ж <span class="mono">' + round(t.f, 1) + '</span> · ' +
           'В <span class="mono">' + round(t.c, 1) + '</span>';
  }

  function foodOptions(selectedId) {
    return FOOD_GROUPS.map(function (g) {
      const list = FOODS.filter(function (f) { return f.group === g.id; });
      if (!list.length) return '';
      return '<optgroup label="' + esc(g.name) + '">' +
        list.map(function (f) {
          return '<option value="' + esc(f.id) + '"' + (f.id === selectedId ? ' selected' : '') + '>' +
                 esc(f.name) + '</option>';
        }).join('') +
      '</optgroup>';
    }).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Згортання блоків                                                    */
  /* ------------------------------------------------------------------ */
  /*
   * Таблиця продуктів — це майже сотня рядків, і вона відсуває день
   * із підсумками далеко вниз. Тому великі блоки можна згорнути,
   * а вибір запамʼятовується.
   *
   * Зберігаємо в localStorage, а не в профіль: це налаштування показу,
   * а не дані користувача, і синхронізувати його між пристроями сенсу немає.
   */
  const FOLD_KEY = 'ib.meals.fold';

  /*
   * Режим запису дня памʼятається (F2). Режим, що скидається на кожному
   * відкритті, — це та сама робота двічі для людини, яка вже вирішила, як
   * веде облік. Ризик «перейдуть на швидкий назавжди» знімається не
   * забуванням, а тим, що перемикач і ціль білка лишаються на екрані.
   */
  const QUICK_KEY = 'ib.meals.quick';

  function loadQuick() {
    try { return localStorage.getItem(QUICK_KEY) === '1'; } catch (_) { return false; }
  }

  function saveQuick(on) {
    try { localStorage.setItem(QUICK_KEY, on ? '1' : '0'); } catch (_) {}
  }

  function loadFolds() {
    /*
     * `|| {}` пропускало будь-яке істинне значення — рядок, число, true.
     * Далі state.folds.foods = true кидало TypeError у строгому режимі,
     * сторінка «Раціон» помирала, ключ ніхто не перезаписував — і кожне
     * наступне відкриття падало так само, назавжди (LOC-010).
     */
    try {
      const v = JSON.parse(localStorage.getItem(FOLD_KEY));
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch (_) { return {}; }
  }

  function saveFolds(f) {
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch (_) {}
  }

  /** Заголовок блоку з кнопкою згортання */
  function foldHead(key, title, summary) {
    const folded = Boolean(state.folds[key]);
    return '' +
      '<div class="row" style="justify-content:space-between;align-items:center;gap:12px">' +
        '<h2 style="margin:0">' + esc(title) + '</h2>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-fold="' + key + '" ' +
                'aria-expanded="' + (!folded) + '">' +
          (folded ? 'Розгорнути' : 'Згорнути') +
        '</button>' +
      '</div>' +
      (folded && summary
        ? '<p class="small muted" style="margin:10px 0 0">' + esc(summary) + '</p>'
        : '');
  }

  /* ------------------------------------------------------------------ */
  /* 1. Довідник продуктів                                               */
  /* ------------------------------------------------------------------ */

  /**
   * РЕЗУЛЬТАТИ пошуку окремо від решти блоку.
   *
   * Раніше кожне натискання клавіші перемальовувало ввесь #foods разом із
   * полем вводу, а потім поле шукали заново й ставили фокус. Фокус
   * повертався, але каретка ставала на позицію 0 — і кожна наступна літера
   * лізла на початок: «курка» перетворювалось на «акрук», пошук показував
   * нуль результатів, і виглядало це так, ніби ввести можна лише одну літеру.
   *
   * Тепер поле вводу НЕ перемальовується взагалі: змінюється тільки вміст
   * #food-results. Каретку нікуди не повертати, бо її ніхто не чіпає.
   *
   * Побічно це полагодило й акордеони «Чому в готовій курці білка більше»
   * та «Номери макаронів»: вони жили в тій самій розмітці, після кожного
   * пошуку створювались наново й переставали розкриватись — initAccordions
   * на них уже не викликався.
   */
  function foodResults() {
    const list = Foods.search(state.foodQuery, state.foodGroup);

    const rows = list.map(function (f) {
      const p = Foods.per100(f, state.foodCooked && Foods.convertible(f));
      const conv = Foods.convertible(f);
      const shown = (state.foodCooked && conv) ? 'готове' : Foods.STATE_LABEL[f.state].short;

      return '<tr>' +
        '<td>' +
          '<b>' + esc(f.name) + '</b>' +
          ' <span class="chip chip--sm">' + esc(shown) + '</span>' +
          (f.unit ? '<div class="small muted">1 ' + esc(f.unit.label) + ' ≈ ' + f.unit.grams + ' г</div>' : '') +
          (f.note ? '<div class="small muted">' + esc(f.note) + '</div>' : '') +
        '</td>' +
        '<td class="num mono">' + round(p.kcal, 0) + '</td>' +
        '<td class="num mono">' + round(p.p, 1) + '</td>' +
        '<td class="num mono">' + round(p.f, 1) + '</td>' +
        '<td class="num mono">' + round(p.c, 1) + '</td>' +
        '<td class="num mono">' + (p.fiber ? round(p.fiber, 1) : '—') + '</td>' +
        '<td class="num">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-add-food="' + esc(f.id) + '">У день</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    return list.length
      // Таблиця скролиться всередині себе, а не тягне за собою сторінку:
      // навіть розгорнутий довідник займає фіксовану висоту, і рецепти
      // з денним підсумком лишаються за один-два оберти колеса.
      ? '<div class="table-wrap table-wrap--tall mt-2">' +
          '<table class="tbl">' +
            '<thead><tr>' +
              '<th>Продукт</th><th class="num">ккал</th><th class="num">Б</th>' +
              '<th class="num">Ж</th><th class="num">В</th><th class="num">кліт.</th><th></th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
        '<p class="small muted" style="margin:8px 0 0">' +
          'Показано ' + list.length + ' з ' + FOODS.length + ' — список гортається всередині таблиці.' +
        '</p>'
      : '<p class="small muted mt-2">Нічого не знайшлось. Спробуйте іншу назву або зніміть фільтр групи.</p>';
  }

  /** Оновити лише результати — поле вводу лишається тим самим вузлом */
  function renderResults() {
    const box = $('#food-results');
    if (box) box.innerHTML = foodResults();
  }

  function renderFoods() {
    const host = $('#foods');
    if (!host) return;

    const folded = Boolean(state.folds.foods);

    host.innerHTML =
      '<div class="card">' +
        foldHead('foods', 'Продукти',
          FOODS.length + ' продуктів у базі · пошук, фільтр і додавання в день') +
        (folded ? '' :

        '<div class="grid mt-2" style="gap:14px">' +
          '<div class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap">' +
            '<div class="field" style="flex:1 1 220px;margin:0">' +
              '<label class="field__label" for="f-q">Пошук</label>' +
              '<input class="input" id="f-q" type="search" placeholder="курка, вівсянка, barilla…" value="' + esc(state.foodQuery) + '">' +
            '</div>' +
            '<div class="field" style="flex:0 1 220px;margin:0">' +
              '<label class="field__label" for="f-group">Група</label>' +
              '<select class="select" aria-label="Фільтр за групою продуктів" id="f-group">' +
                '<option value="all">Усі</option>' +
                FOOD_GROUPS.map(function (g) {
                  return '<option value="' + g.id + '"' + (g.id === state.foodGroup ? ' selected' : '') + '>' + esc(g.name) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
          '</div>' +

          '<div class="field" style="margin:0">' +
            '<label class="field__label">Показувати КБЖВ на 100 г</label>' +
            '<div class="seg">' +
              '<label class="seg__item"><input type="radio" name="fstate" value="raw"' +
                (state.foodCooked ? '' : ' checked') + '><span>Сирого / сухого</span></label>' +
              '<label class="seg__item"><input type="radio" name="fstate" value="cooked"' +
                (state.foodCooked ? ' checked' : '') + '><span>Готового</span></label>' +
            '</div>' +
            '<span class="field__hint">' +
              'Продукти, які не змінюють масу при готуванні (йогурт, олія, банан), в обох режимах однакові.' +
            '</span>' +
          '</div>' +
        '</div>' +

        // Єдине, що змінюється при пошуку. Поле вводу вище лишається тим
        // самим вузлом, тому каретка не стрибає.
        '<div id="food-results">' + foodResults() + '</div>' +

        whyStates()
        ) +
      '</div>';
  }

  /** Пояснення про сире й готове — те, з чого починається половина помилок обліку */
  function whyStates() {
    const ch = Foods.byId('chicken-breast');
    const raw = Foods.per100(ch, false);
    const cooked = Foods.per100(ch, true);

    return '' +
      '<div class="acc mt-3">' +
        '<button class="acc__head" type="button" aria-expanded="false">' +
          '<span class="chip chip--acc">Ваги</span>' +
          '<span><h3>Чому в готовій курці білка «більше»</h3></span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          '<p class="small">Це не помилка довідників. При готуванні мʼясо втрачає воду, ' +
          'а білок нікуди не дівається — він просто концентрується в меншій масі.</p>' +
          '<div class="table-wrap">' +
            '<table class="tbl">' +
              '<thead><tr><th>Куряче філе, 100 г</th><th class="num">ккал</th><th class="num">білок</th></tr></thead>' +
              '<tbody>' +
                '<tr><td>сире</td><td class="num mono">' + round(raw.kcal, 0) + '</td><td class="num mono">' + round(raw.p, 1) + ' г</td></tr>' +
                '<tr><td>готове (лишається ~' + Math.round(ch.yield * 100) + '% маси)</td>' +
                    '<td class="num mono">' + round(cooked.kcal, 0) + '</td><td class="num mono">' + round(cooked.p, 1) + ' г</td></tr>' +
              '</tbody>' +
            '</table>' +
          '</div>' +
          '<p class="small mt-2">' +
            'Перевірка: 200 г сирого філе дають ' + round(200 * ch.yield, 0) + ' г готового і ' +
            round(Foods.amount(ch, 200, false).p, 0) + ' г білка — до й після готування це <b>те саме</b> число. ' +
            'Змінюється лише те, на яку масу воно поділене.' +
          '</p>' +
          '<p class="small">' +
            'З крупами й макаронами все дзеркально: вони воду <b>набирають</b>. ' +
            '100 г сухого басматі стають ~290 г готового, тому на 100 г готового калорій ' +
            'приблизно втричі менше, ніж на 100 г сухого.' +
          '</p>' +
          '<p class="small mb-0">' +
            '<b>Практичний висновок:</b> зважуйте завжди в одному стані, і найкраще — ' +
            'у сирому чи сухому. Вихід залежить від того, скільки й на чому ви готували; ' +
            'суха вага не залежить ні від чого.' +
          '</p>' +
        '</div></div></div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* 2. Рецепти                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Склад рецепта: інгредієнти по стравах, як їх читають.
   *
   * Акордеон — той самий .acc, що блок «Виробництво» на сторінці добавок:
   * довгий список, потрібний не щоразу. Розгорнутим він відсував би сусідні
   * рецепти на екран униз, а картка має лишатись оглядовою.
   *
   * Способу приготування тут немає навмисно — він у відео за посиланням
   * у шапці картки. Раніше кроки були переказані тут, але це означало брати
   * на себе відповідальність за температури й час, яких я не перевіряв.
   *
   * Нічого не рахує й нічого не знає про базу продуктів — просто текст.
   * Таблиця КБЖВ живе окремо, під кнопкою «Склад»: вона відповідає на
   * питання «скільки тут білка», а це — на питання «що купити».
   */
  function recipeBody(r) {
    const parts = Array.isArray(r.parts) ? r.parts : [];
    if (!parts.length) return '';

    return '' +
      '<div class="acc mt-2">' +
        '<button class="acc__head" type="button" aria-expanded="false">' +
          '<span class="chip chip--acc">Інгредієнти</span>' +
          '<span><h3>Що потрібно</h3></span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          '<div class="rc-parts">' +
            parts.map(function (part) {
              return '<div class="rc-part">' +
                       '<b class="small">' + esc(part.title) + '</b>' +
                       '<ul class="rc-list">' +
                         (part.lines || []).map(function (l) {
                           return '<li>' + esc(l) + '</li>';
                         }).join('') +
                       '</ul>' +
                     '</div>';
            }).join('') +
          '</div>' +
        '</div></div></div>' +
      '</div>';
  }

  function recipeCard(r) {
    const per = perContainer(r);
    const tot = recipeTotals(r);
    const open = state.openRecipe === r.id;

    const ingredients = (r.items || []).map(function (it) {
      const f = Foods.byId(it.foodId);
      if (!f) return '';
      const a = Foods.amount(f, it.grams, Boolean(it.cooked));
      const st = Foods.convertible(f)
        ? ' <span class="muted small">(' + (it.cooked ? 'готового' : Foods.STATE_LABEL[f.state].short) + ')</span>'
        : '';
      return '<tr>' +
        '<td>' + esc(f.name) + st + '</td>' +
        '<td class="num mono">' + round(it.grams, 0) + ' г</td>' +
        '<td class="num mono">' + round(a.kcal, 0) + '</td>' +
        '<td class="num mono">' + round(a.p, 1) + '</td>' +
      '</tr>';
    }).join('');

    return '' +
      '<div class="card mt-2">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<div>' +
            '<h3 class="card__title" style="margin:0">' + esc(r.name) + '</h3>' +
            // containers мусить бути ЧИСЛОМ, а не тим, що прийшло у файлі.
            // Це було єдине неекроване поле рецепта в усьому файлі, і разом
            // з імпортом воно давало виконання коду: значення на кшталт
            // "<img src=x onerror=...>" вставлялось у розмітку як є.
            '<p class="card__meta">' + containersOf(r) + ' ' +
              (containersOf(r) === 1 ? 'контейнер' : (containersOf(r) < 5 ? 'контейнери' : 'контейнерів')) +
              (r.prepMin || r.cookMin
                ? ' · ' + ((Number(r.prepMin) || 0) + (Number(r.cookMin) || 0)) + ' хв'
                : '') +
            '</p>' +
          '</div>' +
          '<div class="row" style="gap:8px">' +
            '<button class="btn btn--ghost btn--sm" type="button" data-r-toggle="' + esc(r.id) + '">' +
              (open ? 'Згорнути' : 'Склад') +
            '</button>' +
            (isBase(r.id)
              // Вбудований рецепт правити не можна, але скопіювати собі — так:
              // копія лягає у власні й далі змінюється як завгодно.
              ? '<button class="btn btn--ghost btn--sm" type="button" data-r-copy="' + esc(r.id) + '">Зробити копію</button>'
              : '<button class="btn btn--ghost btn--sm" type="button" data-r-edit="' + esc(r.id) + '">Змінити</button>') +
          '</div>' +
        '</div>' +

        (safeUrl(r.url) || safeUrl(r.recipeUrl)
          ? '<p class="small mt-1">' +
              (r.author ? '<span class="muted">' + esc(r.author) + '</span> · ' : '') +
              (safeUrl(r.url)
                ? '<a href="' + esc(safeUrl(r.url)) + '" target="_blank" rel="noopener noreferrer">Відео ↗</a>'
                : '') +
              (safeUrl(r.url) && safeUrl(r.recipeUrl) ? ' · ' : '') +
              (safeUrl(r.recipeUrl)
                ? '<a href="' + esc(safeUrl(r.recipeUrl)) + '" target="_blank" rel="noopener noreferrer">Рецепт ↗</a>'
                : '') +
            '</p>'
          : '') +
        (r.note ? '<p class="small muted mt-1">' + esc(r.note) + '</p>' : '') +

        '<div class="kpis mt-2">' +
          '<div class="kpi"><div class="kpi__val mono">' + round(per.kcal, 0) + '</div><p class="kpi__lbl">ккал / контейнер</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + round(per.p, 0) + '</div><p class="kpi__lbl">білок, г</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + round(per.f, 0) + '</div><p class="kpi__lbl">жир, г</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">' + round(per.c, 0) + '</div><p class="kpi__lbl">вуглеводи, г</p></div>' +
        '</div>' +

        (open
          ? '<div class="table-wrap mt-2">' +
              '<table class="tbl">' +
                '<thead><tr><th>Інгредієнт</th><th class="num">Маса</th><th class="num">ккал</th><th class="num">Б</th></tr></thead>' +
                '<tbody>' + ingredients + '</tbody>' +
                '<tfoot><tr>' +
                  '<td><b>Разом на ' + containersOf(r) + '</b></td>' +
                  '<td class="num mono"><b>' + round((r.items || []).reduce(function (s, i) { return s + (Number(i.grams) || 0); }, 0), 0) + ' г</b></td>' +
                  '<td class="num mono"><b>' + round(tot.kcal, 0) + '</b></td>' +
                  '<td class="num mono"><b>' + round(tot.p, 0) + '</b></td>' +
                '</tr></tfoot>' +
              '</table>' +
            '</div>' +
            '<p class="small muted mt-1">' +
              'Маси в базовому стані продукту: мʼясо сире, крупи сухі. Готова страва важитиме інакше — ' +
              'на КБЖВ це не впливає.' +
            '</p>'
          : '') +

        '<div class="row mt-2">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-add-recipe="' + esc(r.id) + '">Додати в день…</button>' +
        '</div>' +

        recipeBody(r) +
      '</div>';
  }

  function recipeForm() {
    const d = state.editingRecipe;
    if (!d) {
      return '<button class="btn btn--primary mt-2" type="button" id="r-new">Створити рецепт</button>';
    }

    const rows = d.items.map(function (it, i) {
      const f = Foods.byId(it.foodId);
      const conv = f && Foods.convertible(f);
      return '<tr>' +
        '<td>' +
          '<select class="select select--sm" aria-label="Продукт у рецепті" data-ri="' + i + '" data-rf="food">' + foodOptions(it.foodId) + '</select>' +
        '</td>' +
        '<td class="num">' +
          '<input class="input input--sm num mono" type="number" min="0" max="10000" step="1" ' +
                 'style="width:90px" value="' + esc(it.grams) + '" data-ri="' + i + '" data-rf="grams" ' +
                 'aria-label="Грамів: ' + esc((f && f.name) || 'інгредієнт') + '">' +
        '</td>' +
        '<td>' +
          (conv
            ? '<select class="select select--sm" aria-label="Сире чи готове" data-ri="' + i + '" data-rf="cooked">' +
                '<option value="0"' + (it.cooked ? '' : ' selected') + '>' + esc(Foods.STATE_LABEL[f.state].short) + '</option>' +
                '<option value="1"' + (it.cooked ? ' selected' : '') + '>готове</option>' +
              '</select>'
            : '<span class="small muted">як є</span>') +
        '</td>' +
        '<td class="num">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-ri="' + i + '" data-rf="del">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    const per = perContainer(d);

    return '' +
      '<div class="card mt-2">' +
        '<h3 class="card__title" style="margin-top:0">' + (d.isNew ? 'Новий рецепт' : 'Редагування рецепта') + '</h3>' +

        '<div class="grid grid-2" style="gap:16px">' +
          '<div class="field">' +
            '<label class="field__label" for="r-name">Назва</label>' +
            '<input class="input" id="r-name" type="text" maxlength="80" value="' + esc(d.name) + '" placeholder="Курка в кисло-солодкому">' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="r-cont">Скільки контейнерів виходить</label>' +
            '<input class="input" id="r-cont" type="number" min="1" max="20" step="1" value="' + esc(d.containers) + '">' +
          '</div>' +
        '</div>' +

        '<div class="field">' +
          '<label class="field__label" for="r-url">Посилання на відео чи рецепт <span class="muted">(необовʼязково)</span></label>' +
          '<input class="input" id="r-url" type="url" value="' + esc(d.url || '') + '" placeholder="https://www.youtube.com/watch?v=…">' +
        '</div>' +

        '<h4 class="mt-2" style="margin-bottom:8px">Інгредієнти</h4>' +
        (d.items.length
          ? '<div class="table-wrap">' +
              '<table class="tbl">' +
                '<thead><tr><th>Продукт</th><th class="num">Грамів</th><th>Стан</th><th></th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
              '</table>' +
            '</div>'
          : '<p class="small muted">Поки порожньо. Додайте перший інгредієнт.</p>') +

        '<div class="row mt-2" style="gap:8px">' +
          '<select class="select select--sm" aria-label="Продукт для рецепта" id="r-add-food" style="max-width:320px">' + foodOptions(null) + '</select>' +
          '<button class="btn btn--ghost btn--sm" type="button" id="r-add">Додати інгредієнт</button>' +
        '</div>' +

        (d.items.length
          ? '<div class="kpis mt-3">' +
              '<div class="kpi"><div class="kpi__val mono">' + round(per.kcal, 0) + '</div><p class="kpi__lbl">ккал / контейнер</p></div>' +
              '<div class="kpi"><div class="kpi__val mono">' + round(per.p, 0) + '</div><p class="kpi__lbl">білок, г</p></div>' +
              '<div class="kpi"><div class="kpi__val mono">' + round(per.f, 0) + '</div><p class="kpi__lbl">жир, г</p></div>' +
              '<div class="kpi"><div class="kpi__val mono">' + round(per.c, 0) + '</div><p class="kpi__lbl">вуглеводи, г</p></div>' +
            '</div>'
          : '') +

        '<hr class="divider">' +
        '<div class="row">' +
          '<button class="btn btn--primary btn--sm" type="button" id="r-save">Зберегти рецепт</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" id="r-cancel">Скасувати</button>' +
          (d.isNew ? '' : '<button class="btn btn--ghost btn--sm" type="button" id="r-del">Видалити</button>') +
        '</div>' +
      '</div>';
  }

  function renderRecipes() {
    const host = $('#recipes');
    if (!host) return;

    const folded = Boolean(state.folds.recipes);

    host.innerHTML =
      '<div class="card">' +
        foldHead('recipes', 'Рецепти',
          allRecipes().length
            ? allRecipes().length + ' ' + (allRecipes().length === 1 ? 'рецепт' : 'рецептів')
            : 'жодного рецепта') +
        (folded ? '' :
          (allRecipes().length ? '' :
            '<p class="small muted mt-1">Рецептів ще немає — створіть перший кнопкою нижче.</p>') +
          recipeForm()
        ) +
      '</div>' +
      (folded ? '' : allRecipes().map(recipeCard).join(''));

    // Акордеони прив'язуємо тут, а не в renderAll: renderRecipes()
    // викликається ще й після збереження рецепта, копіювання, розкриття
    // складу й перемикання згортання. Після кожного з них у host лежить
    // новий DOM, і акордеони в ньому не працювали б — мовчки, без помилки,
    // просто не розкривалися б по кліку.
    window.App.initAccordions(host);
  }

  /* ------------------------------------------------------------------ */
  /* 3. День                                                             */
  /* ------------------------------------------------------------------ */

  /*
   * Колір смуги — за нутрієнтом, ті самі відтінки, що в кільці КБЖВ і на
   * «Плані харчування» (--m-protein і далі). Три екрани говорять про одні
   * й ті самі речі, і людина не має щоразу заново з'ясовувати, що тут
   * фіолетове, а що синє.
   *
   * Калорії теж мають колір, і це не суперечність. Вони не четвертий
   * нутрієнт, а СУМА трьох, — тому їм дістався помаранчевий, єдиний у
   * ряду, що не позначає жодної частки. Той самий колір несе число в
   * дучці кільця, бо це та сама величина.
   */
  const MACRO_HUE = {
    'Калорії': 'k', 'Білок': 'p', 'Жири': 'f', 'Вуглеводи': 'c', 'Клітковина': 'fib'
  };

  /* Номер рядка для хвилі появи (див. --i у css/style.css). Лічильник
     скидається на кожному рендері блоку — інакше затримка накопичувалась
     би між перемальовками й смуги з часом виїжджали б усе пізніше. */
  let volSeq = 0;

  /*
   * КБЖВ КІЛЬЦЕМ: три сектори — білок, жири, вуглеводи; калорії — в дучці.
   *
   * Смуги нижче відповідають на питання «скільки ще лишилось до цілі»,
   * і кожна з них про свій нутрієнт окремо. Кільце відповідає на інше:
   * «з чого складається день» — тобто на те, чого п'ять окремих смуг не
   * показують узагалі. Одна й та сама цифра тут не дублюється: у смузі
   * вона в грамах від цілі, у кільці — часткою енергії.
   *
   * Сектори МІРЯЮТЬСЯ В КІЛОКАЛОРІЯХ, а не в грамах. Це не дрібниця:
   * грам жиру несе 9 ккал, а грам білка — 4, тож кільце «за грамами»
   * показувало б жир удвічі меншим, ніж він є в раціоні. Частки мають
   * складатися в калорії, які стоять у центрі, — інакше центр і кільце
   * говорили б про різні речі.
   *
   * Клітковини серед секторів немає: її 2 ккал/г уже відняті з
   * вуглеводів у ядрі, і окремим сектором вона порахувалась би вдруге.
   * У смугах нижче вона лишається — там питання «чи набрав норму», і
   * норма в неї своя.
   */
  function macroDonut(got, t) {
    if (!window.Donut) return '';
    const NC = window.NutritionCalc;
    const K = NC ? NC.KCAL : { protein: 4, fat: 9, carb: 4 };
    const KFIB = NC ? NC.KCAL_FIBER : 2;

    /*
     * КЛІТКОВИНА ЙДЕ У ВУГЛЕВОДИ, А НЕ ОКРЕМИМ СЕКТОРОМ.
     *
     * Вона і є вуглевод; окремим рядком її тримає довідник продуктів,
     * бо засвоюється вона інакше (2 ккал/г замість 4). Але четвертий
     * сектор тут був би зайвим двічі: по-перше, це вже не КБЖВ, по-друге
     * — без її калорій кільце не сходилось би з числом у центрі.
     *
     * А сходитись воно мусить. Перша збірка ставила в центр суму трьох
     * секторів (932), тоді як плитка «ккал за день» за два сантиметри
     * нижче показувала 949. Різниця — рівно калорійність клітковини, і
     * пояснити її не міг ніхто: сторінка просто показувала два різні
     * числа про одне й те саме. Тепер у центрі стоїть та сама цифра, що
     * й у плитці, а кільце ділить саме її.
     */
    const kp = got.p * K.protein;
    const kf = got.f * K.fat;
    const kc = got.c * K.carb + got.fiber * KFIB;
    const sum = kp + kf + kc;

    const part = function (label, grams, kcal, cls, extra) {
      const pct = sum > 0 ? Math.round(kcal / sum * 100) : 0;
      return {
        label: label, value: kcal, cls: cls, pct: pct, grams: grams,
        title: label + ': ' + round(grams, 0) + ' г' + (extra || '') +
               ' · ' + round(kcal, 0) + ' ккал · ' + pct + '% енергії'
      };
    };

    /*
     * У підписі — грами БЕЗ клітковини, як у плитках і в таблиці
     * продуктів. Її грами дописані в підказку окремо: інакше «119 г» у
     * кільці й «119 г» у плитці розійшлися б, і довелося б зʼясовувати,
     * котре з них правда.
     */
    const slices = [
      part('Білок', got.p, kp, 'donut__slice--p'),
      part('Жири', got.f, kf, 'donut__slice--f'),
      part('Вуглеводи', got.c, kc, 'donut__slice--c',
        got.fiber >= 0.5 ? ' + ' + round(got.fiber, 0) + ' г клітковини' : '')
    ];

    return '<div class="macro-ring">' +
      window.Donut.html({
        slices: slices,
        center: round(got.kcal, 0),
        sub: t ? 'з ' + round(t.kcal, 0) + ' ккал' : 'ккал за день',
        label: 'Склад раціону за енергією',
        empty: 'Додайте страву — і тут зʼявиться склад дня.'
      }) +
      (sum > 0
        ? '<div class="macro-ring__side">' +
            '<ul class="macro-ring__legend">' +
              slices.map(function (s) {
                return '<li><i class="' + s.cls + '"></i>' +
                  '<span class="macro-ring__name">' + esc(s.label) + '</span>' +
                  '<b class="mono">' + s.pct + '%</b>' +
                  '<span class="muted mono">' + round(s.grams, 0) + ' г</span>' +
                '</li>';
              }).join('') +
            '</ul>' +
            '<p class="small muted macro-ring__note">Частки — за енергією, а не за вагою: ' +
              'грам жиру несе 9 ккал, грам білка — 4. Клітковина порахована у вуглеводах.</p>' +
          '</div>'
        : '') +
    '</div>';
  }

  function progressRow(label, got, need, unit) {
    if (!need) return '';
    const pct = clamp(got / need * 100, 0, 100);
    const over = got > need * 1.05;
    const left = need - got;
    const hue = MACRO_HUE[label];
    return '' +
      '<div class="vol vol--' + (over ? 'over' : (got >= need * 0.95 ? 'ok' : 'under')) +
        (hue ? ' vol--m-' + hue : '') + '" style="--i:' + (volSeq++) + '">' +
        '<span class="vol__name">' + esc(label) + '</span>' +
        '<span class="vol__bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="vol__num mono">' + round(got, 0) +
          '<span class="vol__target">/' + round(need, 0) + ' ' + esc(unit) + '</span>' +
        '</span>' +
        '<span class="small muted" style="text-align:right">' +
          (Math.abs(left) < 1 ? 'точно' : (left > 0 ? 'ще ' + round(left, 0) : 'понад ' + round(-left, 0))) +
        '</span>' +
      '</div>';
  }

  function itemRow(it, mi, ii) {
    let name, detail, tot;

    /*
     * Позиція, чиє джерело зникло (видалений рецепт, продукт із чужого
     * імпорту), малюється ЯВНО — з робочою кнопкою ✕.
     *
     * Раніше такий рядок повертав порожній рядок: підсумок дня мовчки
     * падав, а прибрати запис було нічим — кнопки видалення просто не
     * існувало. Позиція лишалась у профілі назавжди й воскресала зі
     * старими порціями, щойно рецепт із тим самим id зʼявлявся знову.
     */
    /*
     * Заморожена позиція (kind:'snap') — джерела немає за визначенням,
     * тому перевірка «зникло» до неї не застосовується: вона не зникла,
     * вона й записувалась як число. Підпис це і каже, щоб людина не
     * шукала, чому цей рядок не перераховується в готовий.
     */
    if (it.kind === 'snap') {
      const unitLbl = window.DayCore.SNAP_UNIT_LABEL[it.unit === 'portion' ? 'portion' : 'g'];
      const snapTot = window.DayCore.itemNutrition(it, state.recipes);
      return '<tr>' +
        '<td>' + esc(it.name || 'Позиція') +
          '<div class="small muted">' + round(it.qty, it.unit === 'portion' ? 2 : 0) + ' ' + esc(unitLbl) +
          ' · збережено з копії дня</div></td>' +
        '<td class="num">' +
          '<input class="input input--sm num mono" type="text" inputmode="decimal" ' +
                 'style="width:88px" value="' + esc(it.qty) + '" ' +
                 'data-di="' + mi + '" data-dj="' + ii + '" data-df="amount" ' +
                 'aria-label="' + (it.unit === 'portion' ? 'Контейнерів' : 'Грамів') + ': ' + esc(it.name || 'позиція') + '">' +
        '</td>' +
        '<td class="num mono">' + round(snapTot.kcal, 0) + '</td>' +
        '<td class="num mono">' + round(snapTot.p, 1) + '</td>' +
        '<td class="num">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-di="' + mi + '" data-dj="' + ii + '" data-df="del">✕</button>' +
        '</td>' +
      '</tr>';
    }

    const missing = it.kind === 'recipe' ? !recipeById(it.recipeId) : !Foods.byId(it.foodId);
    if (missing) {
      return '<tr>' +
        '<td><span class="muted">Видалений ' + (it.kind === 'recipe' ? 'рецепт' : 'продукт') + '</span>' +
          '<div class="small muted">не рахується в підсумку дня</div></td>' +
        '<td class="num mono muted">—</td>' +
        '<td class="num mono muted">—</td>' +
        '<td class="num mono muted">—</td>' +
        '<td class="num">' +
          '<button class="btn btn--ghost btn--sm" type="button" data-di="' + mi + '" data-dj="' + ii + '" data-df="del" ' +
                  'aria-label="Прибрати позицію, джерело якої зникло">✕</button>' +
        '</td>' +
      '</tr>';
    }

    if (it.kind === 'recipe') {
      const r = recipeById(it.recipeId);
      name = r.name;
      detail = round(it.portions, 2) + ' конт.';
      tot = scale(perContainer(r), Number(it.portions) || 0);
    } else {
      const f = Foods.byId(it.foodId);
      name = f.name;
      detail = round(it.grams, 0) + ' г' +
        (Foods.convertible(f) ? ' ' + (it.cooked ? 'готового' : Foods.STATE_LABEL[f.state].short) : '');
      tot = Foods.amount(f, it.grams, Boolean(it.cooked));
    }

    return '<tr>' +
      '<td>' + esc(name) + '<div class="small muted">' + esc(detail) + '</div></td>' +
      '<td class="num">' +
        '<input class="input input--sm num mono" type="text" inputmode="decimal" ' +
               'style="width:88px" value="' + esc(it.kind === 'recipe' ? it.portions : it.grams) + '" ' +
               'data-di="' + mi + '" data-dj="' + ii + '" data-df="amount" ' +
               'aria-label="' + (it.kind === 'recipe' ? 'Контейнерів' : 'Грамів') + ': ' + esc(name) + '">' +
      '</td>' +
      '<td class="num mono">' + round(tot.kcal, 0) + '</td>' +
      '<td class="num mono">' + round(tot.p, 1) + '</td>' +
      '<td class="num">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-di="' + mi + '" data-dj="' + ii + '" data-df="del">✕</button>' +
      '</td>' +
    '</tr>';
  }

  /* ------------------------------------------------------------------ */
  /* Копія дня (F1)                                                      */
  /* ------------------------------------------------------------------ */
  /*
   * Джерела — закриті дні, у яких є знімок позицій (HistoryCore.copySources).
   * Днів у mealLog більше: до знімків історія тримала лише підсумки, і з
   * такого дня копіювати нічого. Показувати його в списку означало б
   * обіцяти копію, якої не буде.
   */
  function copySources() {
    const log = state.profile.mealLog;
    const today = (state.day && state.day.date) || window.HistoryCore.todayKey();
    return window.HistoryCore.copySources(log)
      /* Копія в той самий день заборонена: вона або нічого не змінює,
         або подвоює день — і те, й те людина сприйме як збій. */
      .filter(function (e) { return e.d !== today; });
  }

  function copyPanel() {
    if (!state.copyOpen) return '';
    const list = copySources();
    if (!list.length) {
      return '<div class="notice mt-2" id="d-copy-list">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
        '<div>Копіювати поки нема з чого: позиції зберігаються з дня, ' +
        'закритого вже з цією версією. Закрийте день — і наступний можна буде ' +
        'зібрати одним натисканням.</div></div>';
    }
    return '<div class="card mt-2" id="d-copy-list">' +
      '<p class="small muted" style="margin:0 0 8px">Звідки взяти позиції. ' +
      'Ціль дня не копіюється — вона беруться з поточної.</p>' +
      '<div class="table-wrap">' +
        '<table class="tbl">' +
          '<thead><tr><th>День</th><th class="num">ккал</th><th class="num">Б/Ж/В</th><th></th></tr></thead>' +
          '<tbody>' + list.map(function (e) {
            const v = e.v || {};
            return '<tr>' +
              '<td class="mono">' + esc(e.d) + '</td>' +
              '<td class="num mono">' + round(v.kcal, 0) + '</td>' +
              '<td class="num mono small">' + round(v.p, 0) + '/' + round(v.f, 0) + '/' + round(v.c, 0) + '</td>' +
              '<td class="num" style="white-space:nowrap">' +
                '<button class="btn btn--primary btn--sm" type="button" data-copy-add="' + esc(e.d) + '">Додати</button> ' +
                '<button class="btn btn--ghost btn--sm" type="button" data-copy-set="' + esc(e.d) + '">Замінити</button>' +
              '</td>' +
            '</tr>';
          }).join('') + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  /**
   * Скопіювати день-джерело в поточний день.
   * @param {string} date дата джерела
   * @param {'add'|'replace'} mode додати до наявного чи замінити
   */
  async function copyDayFrom(date, mode) {
    const entry = (state.profile.mealLog || {})[date];
    const frozen = entry && Array.isArray(entry.meals) ? entry.meals : null;
    if (!frozen) { toast('У дня ' + date + ' немає збережених позицій', 'err'); return; }

    const today = (state.day && state.day.date) || window.HistoryCore.todayKey();
    if (date === today) { toast('Це той самий день — копіювати нема куди', 'err'); return; }

    const hasItems = state.day.meals.some(function (m) { return m.items && m.items.length; });
    if (mode === 'replace' && hasItems &&
        !confirm('Замінити все, що вже є в дні, позиціями з ' + date + '?')) return;

    const report = {};
    state.day = {
      meals: window.DayCore.copyDayInto(state.day.meals, frozen, mode, state.recipes, report),
      date: state.day.date
    };
    state.copyOpen = false;

    await persist();
    renderDay();

    if (!report.added) { toast('Копіювати було нічого', 'err'); return; }
    toast('Скопійовано позицій: ' + report.added +
      (report.frozen ? ' (' + report.frozen + ' без джерела в довіднику)' : '') +
      (report.dropped ? '. Не влізло: ' + report.dropped : ''), 'ok');
  }

  /* ------------------------------------------------------------------ */
  /* Швидкий запис дня (F2)                                              */
  /* ------------------------------------------------------------------ */
  /*
   * Навіщо: ресторан, гості, чужа кухня. Досі вибір був «розібрати все по
   * грамах» або «лишити день порожнім», а порожній день для аналітики
   * означає «не їв» — і середнє спожите просідало саме за ті дні, коли
   * людина їла найбільше. Приблизне число тут не «менш точні дані», а
   * єдині правдиві.
   *
   * Жир і вуглеводи не питаються навмисно: вгадане число потім рахується
   * як факт. Білок питається, бо він єдиний, кого люди справді знають
   * («стейк на 200 г»), і бо без нього білкова частина рейтингу за цей
   * день не рахується — про що форма й каже, замість тихо дати нуль.
   */
  function quickForm() {
    const t = target();
    return '<div class="card mt-2" id="d-quick-form">' +
      '<div class="row" style="gap:12px;flex-wrap:wrap">' +
        '<div class="field" style="margin:0;flex:1 1 140px">' +
          '<label class="field__label" for="q-kcal">Калорії за день</label>' +
          '<input class="input mono" id="q-kcal" type="text" inputmode="numeric" ' +
                 'autocomplete="off" value="' + esc(state.quickKcal) + '" placeholder="2100">' +
        '</div>' +
        '<div class="field" style="margin:0;flex:1 1 140px">' +
          '<label class="field__label" for="q-p">Білок, г <span class="muted">— якщо знаєте</span></label>' +
          '<input class="input mono" id="q-p" type="text" inputmode="numeric" ' +
                 'autocomplete="off" value="' + esc(state.quickP) + '" placeholder="' +
                 (t ? String(Math.round(t.protein)) : '150') + '">' +
        '</div>' +
      '</div>' +
      /* Ціль лишається на екрані навмисно: швидкий режим не має ставати
         способом не бачити, наскільки день розійшовся з нормою. */
      (t
        ? '<p class="small muted mt-1" style="margin-bottom:0">Ціль дня: <b class="mono">' +
            Math.round(t.kcal) + '</b> ккал, білок <b class="mono">' + Math.round(t.protein) + '</b> г.</p>'
        : '<p class="small muted mt-1" style="margin-bottom:0">Ціль дня не порахована — ' +
          'заповніть дані на сторінці <a href="nutrition.html">Харчування</a>, ' +
          'інакше день ляже в історію без цілі.</p>') +
      '<p class="small muted" style="margin:8px 0 0">Жир і вуглеводи не питаємо: ' +
        'вгадане число далі рахувалося б як виміряне. День ляже в історію позначеним ' +
        'як приблизний' + '.</p>' +
      '<button class="btn btn--primary mt-2" type="button" id="q-save">Записати день</button>' +
    '</div>';
  }

  /** Перемикач «докладно / швидко» */
  function modeSeg() {
    return '<div class="seg mt-2" role="radiogroup" aria-label="Як записати день">' +
      '<label class="seg__item"><input type="radio" name="d-mode" value="full"' +
        (state.quick ? '' : ' checked') + '><span>Докладно</span></label>' +
      '<label class="seg__item"><input type="radio" name="d-mode" value="quick"' +
        (state.quick ? ' checked' : '') + '><span>Швидко</span></label>' +
    '</div>';
  }

  /**
   * Записати день приблизно: ккал і, якщо відомо, білок.
   *
   * Розібрані позиції дня при цьому ЗНИКАЮТЬ — і саме тому їхня сума
   * заздалегідь підставлена в поле: людина або лишає її, або виправляє,
   * але не втрачає непомітно.
   */
  async function saveQuickDay() {
    const kcal = Number(String(state.quickKcal).trim().replace(',', '.'));
    if (!Number.isFinite(kcal) || kcal < QUICK_KCAL_MIN || kcal > QUICK_KCAL_MAX) {
      toast('Калорії: від ' + QUICK_KCAL_MIN + ' до ' + QUICK_KCAL_MAX, 'err');
      return;
    }
    const rawP = String(state.quickP).trim().replace(',', '.');
    let prot = null;
    if (rawP) {
      const n = Number(rawP);
      if (!Number.isFinite(n) || n < QUICK_P_MIN || n > QUICK_P_MAX) {
        toast('Білок: від ' + QUICK_P_MIN + ' до ' + QUICK_P_MAX + ' г, або лишіть порожнім', 'err');
        return;
      }
      prot = n;
    }

    const today = window.HistoryCore.todayKey();
    const key = (state.day && state.day.date) || today;
    const existing = state.profile.mealLog && state.profile.mealLog[key];
    const stale = key !== today;
    const q = (existing
      ? 'День ' + key + ' уже записаний (' + existing.kcal + ' ккал). Перезаписати приблизним?'
      : 'Записати день' + (stale ? ' за ' + key : '') + ' як приблизний: ' +
        Math.round(kcal) + ' ккал' + (prot ? ', білок ' + Math.round(prot) + ' г' : ' (без білка)') + '?');
    if (!confirm(q)) return;

    const t = target();
    const log = window.HistoryCore.quickDay(
      state.profile.mealLog, key, kcal, prot, t ? t.kcal : null, t ? t.protein : null);
    state.profile.mealLog = log;
    state.day = EMPTY_DAY();
    state.quickKcal = '';
    state.quickP = '';

    /* Журнал — ФУНКЦІЄЮ (SYN-011): день, записаний тим часом з іншого
       пристрою, не має зникати разом з усім mealLog. Те саме
       перетворення, що вище, але вже на свіжому профілі. */
    try {
      await window.Store.saveProfile(function (pr) {
        return {
          mealLog: window.HistoryCore.quickDay(
            (pr && pr.mealLog) || {}, key, kcal, prot, t ? t.kcal : null, t ? t.protein : null),
          day: EMPTY_DAY()
        };
      });
      /* Текст мусить збігатися з тим, що робить сервер. Було «білкова
         частина не рахується» — а вона рахувалась, і то як провалена. */
      toast('День записано приблизно: ' + log[key].kcal + ' ккал' +
        (prot ? '' : '. Без білка день міряється самими калоріями') +
        '. Приблизний день не буває чистим', 'ok');
    } catch (e) {
      toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err');
    }
    renderDay();
  }

  function renderDay() {
    const host = $('#day');
    if (!host) return;

    const t = target();
    const got = dayTotals();

    const meals = state.quick ? '' : state.day.meals.map(function (m, mi) {
      const mt = mealTotals(m);
      return '' +
        '<div class="card mt-2">' +
          '<div class="row" style="justify-content:space-between;align-items:center;gap:12px">' +
            // Назва — текст, а не поле вводу: її задає схема прийомів
            // із «Харчування», тому правити її тут нічого не дало б.
            '<h3 class="card__title" style="margin:0">' + esc(m.name) + '</h3>' +
            '<span class="small muted">' + macroLine(mt) + '</span>' +
          '</div>' +
          (m.items.length
            ? '<div class="table-wrap mt-2">' +
                '<table class="tbl">' +
                  '<thead><tr><th>Що</th><th class="num">Скільки</th><th class="num">ккал</th><th class="num">Б</th><th></th></tr></thead>' +
                  '<tbody>' + m.items.map(function (it, ii) { return itemRow(it, mi, ii); }).join('') + '</tbody>' +
                '</table>' +
              '</div>'
            : '<p class="small muted mt-1">Тут поки порожньо — натисніть «Додати продукт» нижче.</p>') +
          /* Кнопка в кожному прийомі — найкоротший шлях до найчастішої дії
             дня. Прийом уже відомий із того, ЯКУ кнопку натиснули, тож
             лишається одне рішення: що саме й скільки. Пошук нижче шукає
             і продукти, і рецепти — окремо йти в довідник не треба. */
          '<button class="btn btn--ghost btn--sm mt-2" type="button" data-add-to="' + mi + '">' +
            '+ Додати продукт' +
          '</button>' +
        '</div>';
    }).join('');

    /* День несе дату першого продукту й не міняє її, поки відкритий (див.
       stampDay). Якщо ця дата вже не сьогодні — кажемо це в заголовку, а не
       лише в діалозі закриття: інакше пʼятничний обід мовчки лягав у
       понеділок, бо людина не бачила, що день досі понеділковий. */
    const todayK = window.HistoryCore ? window.HistoryCore.todayKey() : null;
    const staleKey = (state.day && state.day.date && todayK && state.day.date !== todayK &&
      state.day.meals.some(function (m) { return m.items && m.items.length; })) ? state.day.date : null;

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">День' + (staleKey ? ' <span class="chip chip--sm" id="d-stale">за ' + esc(staleKey) + '</span>' : '') + '</h2>' +
          '<div class="row" style="gap:8px">' +
            /* «Закрити день» — головна дія дня: підсумок із датою і ціллю
               лягає в історію (mealLog), день очищається під наступний.
               «Очистити» лишилась для помилково набраного дня — БЕЗ запису. */
            (state.quick
              ? ''
              : '<button class="btn btn--primary btn--sm" type="button" id="d-close">Закрити день</button>') +
            /* «Скопіювати день» (F1): однакові дні набивались руками
               щоразу, бо копіювався тільки рецепт, а день — ні. */
            '<button class="btn btn--ghost btn--sm" type="button" id="d-copy" ' +
                    'aria-expanded="' + (state.copyOpen ? 'true' : 'false') + '" ' +
                    'aria-controls="d-copy-list">Скопіювати день</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" id="d-clear">Очистити</button>' +
          '</div>' +
        '</div>' +

        modeSeg() +
        copyPanel() +

        (staleKey
          ? '<div class="notice mt-2" id="d-stale-note">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>' +
              '<div>Цей день ще за <b>' + esc(staleKey) + '</b>: усе, що додасте, піде в ту дату. ' +
              'Натисніть «Закрити день», щоб записати його в історію й почати сьогоднішній.</div>' +
            '</div>'
          : '') +
        (state.quick ? quickForm() : macroDonut(got, t)) +

        (state.quick ? '' : t
          ? '<div class="vol-list mt-2">' + (volSeq = 0, '') +
              progressRow('Калорії',   got.kcal,  t.kcal,    'ккал') +
              progressRow('Білок',     got.p,     t.protein, 'г') +
              progressRow('Жири',      got.f,     t.fat,     'г') +
              progressRow('Вуглеводи', got.c,     t.carb,    'г') +
              progressRow('Клітковина', got.fiber, t.fiber,  'г') +
            '</div>'
          : '<div class="notice notice--acc mt-2">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
              '<div>Щоб бачити залишок до норми, заповніть зріст, вагу й вік на сторінці ' +
              '<a href="nutrition.html">Харчування</a> і натисніть «Зберегти мої дані». ' +
              'Підсумок дня рахується й без цього.</div>' +
            '</div>' +
            '<div class="kpis mt-2">' +
              '<div class="kpi"><div class="kpi__val mono">' + round(got.kcal, 0) + '</div><p class="kpi__lbl">ккал за день</p></div>' +
              '<div class="kpi"><div class="kpi__val mono">' + round(got.p, 0) + '</div><p class="kpi__lbl">білок, г</p></div>' +
              '<div class="kpi"><div class="kpi__val mono">' + round(got.f, 0) + '</div><p class="kpi__lbl">жир, г</p></div>' +
              '<div class="kpi"><div class="kpi__val mono">' + round(got.c, 0) + '</div><p class="kpi__lbl">вуглеводи, г</p></div>' +
            '</div>') +
        /* Швидке додавання ПРЯМО ТУТ. Раніше єдиний шлях лежав через
           довідник угорі сторінки (розгорнути → знайти → «У день»), тобто
           найчастіша операція вимагала найдовшої дороги. Пошук шукає і
           продукти, і рецепти; вибір відкриває ту саму модалку — рішення
           про масу і прийом лишаються в одному місці. */
        (state.quick
          ? ''
          : '<div class="field" style="margin:16px 0 0">' +
              '<label class="field__label" for="d-quick">Додати в день</label>' +
              '<input class="input" id="d-quick" type="search" autocomplete="off" ' +
                     'placeholder="курка, вівсянка, рецепт…">' +
              '<div id="d-quick-list" class="quick-list" hidden></div>' +
            '</div>' +

            '<p class="small muted" style="margin:14px 0 0">' +
              'Кількість і назви прийомів — на сторінці <a href="nutrition.html">Харчування</a>.' +
            '</p>') +
      '</div>' +
      meals;

    /* Розгортання кільця робиться ПІСЛЯ вставки: розмітка вже несе
       кінцеві сектори, тож без цього виклику діаграма просто стоїть
       намальованою (див. Donut.animate). */
    window.Donut && window.Donut.animate(host);
  }

  /**
   * Підказки швидкого додавання: продукти + рецепти за назвою.
   * Рендеряться окремо від renderDay, щоб не збивати фокус із поля.
   */
  function quickMatches(q) {
    const query = String(q || '').trim().toLowerCase();
    if (!query) return [];
    const foods = Foods.search(query, 'all').slice(0, 6)
      .map(function (f) { return { kind: 'food', id: f.id, name: f.name }; });
    const recipes = allRecipes()
      .filter(function (r) { return r.name.toLowerCase().indexOf(query) !== -1; })
      .slice(0, 3)
      .map(function (r) { return { kind: 'recipe', id: r.id, name: r.name }; });
    return recipes.concat(foods).slice(0, 8);
  }

  function renderQuickList() {
    const box = $('#d-quick-list');
    const input = $('#d-quick');
    if (!box || !input) return;

    const items = quickMatches(input.value);
    if (!items.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    box.hidden = false;
    box.innerHTML = items.map(function (it) {
      return '<button type="button" class="quick-list__item" ' +
        'data-quick-kind="' + it.kind + '" data-quick-id="' + esc(it.id) + '">' +
        '<span>' + esc(it.name) + '</span>' +
        (it.kind === 'recipe' ? '<span class="chip chip--sm">рецепт</span>' : '') +
      '</button>';
    }).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Дії                                                                 */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* Вікно додавання в день                                              */
  /* ------------------------------------------------------------------ */
  /*
   * Раніше кнопка «У день» мовчки кидала 100 г у останній прийом їжі,
   * і далі це доводилось виправляти в таблиці. Тепер усі три рішення —
   * стан продукту, маса й прийом — ухвалюються в одному місці, до того
   * як щось потрапить у день, і одразу видно, що з цього вийде.
   */

  /* Кому повернути фокус після закриття: діалог, який зʼїдає фокус
     назавжди, змушує клавіатурного користувача табатись із самого верху. */
  let modalOpener = null;

  /**
   * @param {object} draft чернетка додавання
   * @param {number} [mealIndex] куди саме класти. Передається, коли дію
   *   почали з конкретного прийому («+ Додати продукт» у його картці) —
   *   тоді питати про прийом ще раз безглуздо. Без нього лишається старе
   *   правило: останній прийом, бо зазвичай саме його зараз і збирають.
   */
  function openModal(draft, mealIndex) {
    // Схема гарантує щонайменше MEALS_MIN прийомів, тому створювати
    // прийом «про всяк випадок» тут більше не потрібно.
    const last = state.day.meals.length - 1;
    draft.mealIndex = Number.isInteger(mealIndex) ? Math.min(last, Math.max(0, mealIndex)) : last;
    modalOpener = document.activeElement;
    state.modal = draft;
    renderModal();
  }

  function closeModal() {
    state.modal = null;
    renderModal();

    /* Повернення фокуса.
       Кнопка, з якої відкрили вікно, часто вже не існує: підказки швидкого
       додавання перемальовуються одразу після вибору, тож modalOpener
       вказує на видалений вузол. Раніше фокус у цьому випадку падав на
       body — з клавіатури це означало «почни обхід сторінки спочатку».
       Запасний якір — поле швидкого додавання: саме туди людина
       повернеться, щоб додати наступну позицію. */
    const usable = modalOpener && modalOpener.focus &&
      modalOpener !== document.body && document.contains(modalOpener);
    const back = usable ? modalOpener : $('#d-quick');
    if (back && back.focus) back.focus();
    modalOpener = null;
  }

  /** КБЖВ того, що зараз налаштовано у вікні */
  function modalTotals() {
    const m = state.modal;
    if (!m) return ZERO();
    if (m.kind === 'recipe') {
      const r = recipeById(m.recipeId);
      return r ? scale(perContainer(r), Number(m.portions) || 0) : ZERO();
    }
    const f = Foods.byId(m.foodId);
    const g = parseGrams(m.grams);
    return f ? Foods.amount(f, g === null ? 0 : g, Boolean(m.cooked)) : ZERO();
  }

  function modalPreview() {
    const t = modalTotals();
    return '' +
      '<div class="kpis" id="m-preview">' +
        '<div class="kpi"><div class="kpi__val mono">' + round(t.kcal, 0) + '</div><p class="kpi__lbl">ккал</p></div>' +
        '<div class="kpi"><div class="kpi__val mono">' + round(t.p, 1) + '</div><p class="kpi__lbl">білок, г</p></div>' +
        '<div class="kpi"><div class="kpi__val mono">' + round(t.f, 1) + '</div><p class="kpi__lbl">жир, г</p></div>' +
        '<div class="kpi"><div class="kpi__val mono">' + round(t.c, 1) + '</div><p class="kpi__lbl">вугл., г</p></div>' +
      '</div>';
  }

  function mealSelect() {
    return '' +
      '<div class="field">' +
        '<label class="field__label" for="m-meal">У який прийом їжі</label>' +
        '<select class="select" aria-label="У який прийом їжі додати" id="m-meal">' +
          state.day.meals.map(function (mm, i) {
            return '<option value="' + i + '"' + (i === state.modal.mealIndex ? ' selected' : '') + '>' +
                   esc(mm.name || ('Прийом ' + (i + 1))) + '</option>';
          }).join('') +
        '</select>' +
      '</div>';
  }

  /** Тіло вікна для продукту */
  function modalFood() {
    const m = state.modal;
    const f = Foods.byId(m.foodId);
    if (!f) return '';

    const conv = Foods.convertible(f);
    const stLabel = Foods.STATE_LABEL[f.state];

    // Скільки це в «іншому» стані — щоб не рахувати в голові
    const other = conv
      ? (m.cooked
          ? 'Це ' + round(Foods.rawFor(f, m.grams), 0) + ' г ' + stLabel.short + ' до готування.'
          : 'Після готування вийде ~' + round(Foods.cookedFrom(f, m.grams), 0) + ' г.')
      : '';

    const quick = [50, 100, 150, 200].map(function (g) {
      return '<button class="btn btn--ghost btn--sm" type="button" data-m-quick="' + g + '">' + g + ' г</button>';
    }).join('');

    return '' +
      (conv
        ? '<div class="field">' +
            '<label class="field__label">Ви зважуєте його</label>' +
            '<div class="seg">' +
              '<label class="seg__item"><input type="radio" name="mstate" value="raw"' +
                (m.cooked ? '' : ' checked') + '><span>' +
                esc(stLabel.short === 'сухе' ? 'Сухим' : 'Сирим') + '</span></label>' +
              '<label class="seg__item"><input type="radio" name="mstate" value="cooked"' +
                (m.cooked ? ' checked' : '') + '><span>Готовим</span></label>' +
            '</div>' +
            '<span class="field__hint">' +
              'Від цього залежать усі числа: 100 г ' + esc(stLabel.short) + ' і 100 г готового — ' +
              'це різна кількість їжі.' +
            '</span>' +
          '</div>'
        : '<p class="small muted">Цей продукт не змінює масу при готуванні — стан обирати нема потреби.</p>') +

      '<div class="field">' +
        '<label class="field__label" for="m-grams">Скільки грамів</label>' +
        '<input class="input" id="m-grams" type="text" inputmode="decimal" autocomplete="off" ' +
               'value="' + esc(m.grams) + '">' +
        (other ? '<span class="field__hint" id="m-other">' + esc(other) + '</span>' : '') +
      '</div>' +

      '<div class="row" style="gap:8px;margin-bottom:18px">' + quick +
        (f.unit
          ? '<button class="btn btn--ghost btn--sm" type="button" data-m-quick="' + f.unit.grams + '">' +
              '1 ' + esc(f.unit.label) + '</button>'
          : '') +
      '</div>';
  }

  /** Тіло вікна для рецепта */
  function modalRecipe() {
    const m = state.modal;
    const r = recipeById(m.recipeId);
    if (!r) return '';
    const per = perContainer(r);

    return '' +
      '<p class="small muted">Один контейнер — ' + round(per.kcal, 0) + ' ккал, ' +
        round(per.p, 0) + ' г білка.</p>' +
      '<div class="field">' +
        '<label class="field__label" for="m-grams">Скільки контейнерів</label>' +
        '<input class="input" id="m-grams" type="text" inputmode="decimal" ' +
               'value="' + esc(m.portions) + '">' +
      '</div>' +
      '<div class="row" style="gap:8px;margin-bottom:18px">' +
        [0.5, 1, 1.5, 2].map(function (n) {
          return '<button class="btn btn--ghost btn--sm" type="button" data-m-quick="' + n + '">' +
                 fmtNum.n(n, 1) + '</button>';
        }).join('') +
      '</div>';
  }

  let wasOpen = false;

  function renderModal() {
    const host = $('#modal');
    if (!host) return;
    const m = state.modal;

    if (!m) {
      host.hidden = true;
      host.innerHTML = '';
      if (wasOpen) { wasOpen = false; window.App.lockScroll(false); }
      return;
    }

    const title = m.kind === 'recipe'
      ? (recipeById(m.recipeId) || {}).name
      : (Foods.byId(m.foodId) || {}).name;

    host.hidden = false;
    /* renderModal викликається і на кожну перемальовку відкритого вікна —
       без прапорця лічильник блокувань ріс би з кожним натисканням. */
    if (!wasOpen) { wasOpen = true; window.App.lockScroll(true); }
    host.innerHTML =
      '<div class="modal__backdrop" data-m-close></div>' +
      '<div class="modal__box" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h3 id="m-title" style="margin:0">' + esc(title || 'Додати в день') + '</h3>' +
          '<button class="btn btn--ghost btn--sm" type="button" data-m-close aria-label="Закрити">&#10005;</button>' +
        '</div>' +
        '<div class="mt-2">' +
          (m.kind === 'recipe' ? modalRecipe() : modalFood()) +
          mealSelect() +
          modalPreview() +
        '</div>' +
        '<div class="modal__actions">' +
          '<button class="btn btn--primary" type="button" id="m-add">Додати</button>' +
          '<button class="btn btn--ghost" type="button" data-m-close>Скасувати</button>' +
        '</div>' +
      '</div>';

    const input = $('#m-grams');
    if (input) { input.focus(); input.select(); }
  }

  /** Оновити тільки числа, не перемальовуючи вікно — інакше злетить фокус */
  function refreshModalNumbers() {
    const m = state.modal;
    if (!m) return;
    const t = modalTotals();
    const vals = $$('#m-preview .kpi__val');
    if (vals.length >= 4) {
      vals[0].textContent = round(t.kcal, 0);
      vals[1].textContent = round(t.p, 1);
      vals[2].textContent = round(t.f, 1);
      vals[3].textContent = round(t.c, 1);
    }
    const other = $('#m-other');
    if (other && m.kind === 'food') {
      const f = Foods.byId(m.foodId);
      if (f && Foods.convertible(f)) {
        other.textContent = m.cooked
          ? 'Це ' + round(Foods.rawFor(f, m.grams), 0) + ' г ' + Foods.STATE_LABEL[f.state].short + ' до готування.'
          : 'Після готування вийде ~' + round(Foods.cookedFrom(f, m.grams), 0) + ' г.';
      }
    }
  }

  function commitModal() {
    const m = state.modal;
    if (!m) return;

    const meal = state.day.meals[m.mealIndex];
    if (!meal) return;

    if (m.kind === 'recipe') {
      const portions = parsePortions(m.portions);
      if (portions === null) {
        toast('Контейнери: від 0,25 до ' + PORTIONS_MAX, 'err');
        /* Поле контейнерів у розмітці має той самий id, що й поле грамів
                   (#m-grams) — модалка одна на обидва режими. */
        const inp = $('#m-grams'); if (inp) { inp.focus(); inp.select(); }
        return;
      }
      meal.items.push({ kind: 'recipe', recipeId: m.recipeId, portions: portions });
    } else {
      // GRAMS_MIN, а не 1: нуль грамів — це чинний ввід («поки не додаю»),
      // і мовчки перетворювати його на 1 г неправильно.
      const g = parseGrams(m.grams);
      if (g === null) {
        toast('Грами: від 0 до ' + GRAMS_MAX, 'err');
        const inp = $('#m-grams'); if (inp) { inp.focus(); inp.select(); }
        return;
      }
      meal.items.push({ kind: 'food', foodId: m.foodId, grams: g, cooked: Boolean(m.cooked) });
    }

    persist();
    closeModal();
    renderDay();
    toast('Додано в «' + (meal.name || 'прийом') + '»', 'ok');
  }


  /**
   * Закрити день: підсумок → в історію (mealLog), день → порожній.
   *
   * Разом із підсумком зберігається ціль, що діяла САМЕ ЦЬОГО дня:
   * профіль зміниться, а історія має памʼятати, проти чого їли.
   * Повторне закриття того самого дня перезаписує запис — вечеря після
   * «закрив зарано» не має губитись, але й дублікатів бути не повинно.
   */
  async function closeCurrentDay() {
    const got = dayTotals();
    if (!Math.round(got.kcal)) {
      toast('День порожній — нема чого закривати', 'err');
      return;
    }

    /*
     * Закриваємо за ДАТОЮ ДНЯ, а не за датою натискання кнопки. Різниця
     * помітна саме тоді, коли її найлегше не помітити: забув закрити
     * учора — підсумок мусить лягти у вчора.
     */
    const today = window.HistoryCore.todayKey();
    const key = (state.day && state.day.date) || today;
    const t = target();
    const existing = state.profile.mealLog && state.profile.mealLog[key];
    const stale = key !== today;
    const q = existing
      ? (stale ? 'День ' + key + ' уже закривали' : 'Сьогодні вже закривали') +
        ' (' + existing.kcal + ' ккал). Перезаписати підсумок і очистити день?'
      : 'Закрити день' + (stale ? ' за ' + key : '') + '? Підсумок (' +
        Math.round(got.kcal) + ' ккал, білок ' + Math.round(got.p) +
        ' г) ляже в історію, день очиститься.';
    if (!confirm(q)) return;

    /* Разом із підсумком у запис лягає знімок позицій — те, з чого потім
       робиться копія дня (F1). Підсумок історія тримала завжди, позицій у
       ній не було взагалі, тому «скопіювати день» не мало з чого робитись. */
    const frozen = window.DayCore.freezeMeals(state.day, state.recipes);
    const log = window.HistoryCore.closeDay(
      state.profile.mealLog, key, got, t ? t.kcal : null, t ? t.protein : null,
      window.DayCore.hasFrozenItems(frozen) ? frozen : null);
    state.profile.mealLog = log;
    state.day = EMPTY_DAY();

    /* Журнал — ФУНКЦІЄЮ (SYN-011), див. коментар у швидкому записі дня. */
    try {
      await window.Store.saveProfile(function (pr) {
        return {
          mealLog: window.HistoryCore.closeDay(
            (pr && pr.mealLog) || {}, key, got, t ? t.kcal : null, t ? t.protein : null,
            window.DayCore.hasFrozenItems(frozen) ? frozen : null),
          day: EMPTY_DAY()
        };
      });
      toast('День закрито: ' + log[key].kcal + ' ккал в історії', 'ok');
    } catch (e) {
      toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err');
    }
    renderDay();
  }

  function draftFrom(recipe) {
    return {
      id: recipe ? recipe.id : 'r' + Date.now(),
      isNew: !recipe,
      name: recipe ? recipe.name : '',
      url: recipe ? (recipe.url || '') : '',
      containers: recipe ? recipe.containers : 5,
      items: recipe ? recipe.items.map(function (i) { return Object.assign({}, i); }) : []
    };
  }

  function renderAll() {
    renderFoods();
    renderRecipes();
    renderDay();
    renderModal();
    window.App.initAccordions(document);
  }

  /* ------------------------------------------------------------------ */

  async function init() {
    if (!$('#foods')) return;

    try {
      state.profile = await window.Store.getProfile() || {};
    } catch (_) { state.profile = {}; }

    state.folds = loadFolds();
    state.quick = loadQuick();

    // Довідник продуктів за замовчуванням згорнутий. Їх майже сотня, і
    // розгорнутим він займає більшу частину сторінки: до рецептів і дня
    // доводилось гортати крізь усю таблицю. Це саме замовчування, а не
    // примус: щойно блок розгорнули руками, вибір лягає в localStorage
    // і надалі сторінка відкривається так, як залишили.
    if (!Object.prototype.hasOwnProperty.call(state.folds, 'foods')) {
      state.folds.foods = true;
    }
    state.recipes = Array.isArray(state.profile.recipes) ? state.profile.recipes : [];
    state.day = sanitizeDay(state.profile.day);

    renderAll();

    /* Профіль редагується на сторінці акаунта чи харчування — і може
       змінитись просто зараз, у сусідній вкладці. Тоді норма тут застаріє
       мовчки, а це найгірший варіант: цифри є, але вже не ті.

       Разом із нормою може змінитись і кількість прийомів. Її накладаємо
       ЗАВЖДИ й одразу зберігаємо: інакше день лишився б зі старою схемою,
       і наступне збереження записало б її назад у профіль.

       Перемальовуємо лише якщо в дні зараз нічого не набирають — інакше
       вибило б курсор із поля, у яке саме вписують грами. Виняток —
       зміна самої схеми: там перемальовувати обовʼязково, бо картки
       прийомів уже інші. */
    window.Store.onChange(async function () {
      try { state.profile = await window.Store.getProfile() || {}; }
      catch (_) { return; }

      /*
       * Перечитуємо РЕЦЕПТИ з профілю.
       *
       * persist() завжди пише пару {recipes, day}, а state.recipes бралась
       * рівно один раз — при завантаженні сторінки. Тобто рецепт, створений
       * у сусідній вкладці, знищувався першим-ліпшим додаванням продукту
       * в день у цій вкладці. Форма редагування — виняток: поки рецепт
       * набирають, підміняти список під руками не можна.
       */
      if (!state.editingRecipe && Array.isArray(state.profile.recipes)) {
        state.recipes = state.profile.recipes;
      }

      const before = state.day.meals.map(function (m) { return m.name; }).join('|');
      const report = {};
      state.day = { meals: applySchema(state.day.meals, report) };
      const changed = state.day.meals.map(function (m) { return m.name; }).join('|') !== before;
      if (changed) persist();

      /* Кількість прийомів змінили на «Харчуванні» — і день мовчки
         перебудувався: позиції з прибраних прийомів опинились в
         останньому. Раніше про це не було сказано нічого, і людина
         бачила лише те, що їжа «переїхала» сама. Кажемо прямо. */
      if (changed && report.moved) {
        toast('Прийомів стало ' + state.day.meals.length + '. ' +
              report.moved + ' ' + plural(report.moved, 'позицію', 'позиції', 'позицій') +
              ' з прибраних перенесено до «' + report.into + '».', 'ok');
      }
      /* Понад стелю прийому позиції ВТРАТИЛИСЬ — про це не можна мовчати
         (TST-002): 6 прийомів по 20 позицій, зведені у 3, дають 100 зі 120,
         і раніше про зниклі 20 не було сказано нічого. */
      if (report.dropped) {
        toast('Не вмістилось у «' + report.into + '»: ' + report.dropped + ' ' +
              plural(report.dropped, 'позиція', 'позиції', 'позицій') +
              ' (стеля — ' + window.DayCore.MEAL_ITEM_CAP + ' на прийом). ' +
              'Поверніть більше прийомів на «Харчуванні», щоб їжа не губилась.', 'err');
      }

      const active = document.activeElement;
      if (!changed && active && active.closest && active.closest('#day')) return;
      renderDay();
    });

    /* ---- продукти ----
       Усі три фільтри міняють ЛИШЕ результати. Перемальовувати весь блок
       не можна: разом із ним перестворювалось поле пошуку, каретка
       поверталась на початок і слово набиралось задом наперед. */
    $('#foods').addEventListener('input', function (e) {
      if (e.target.id === 'f-q') { state.foodQuery = e.target.value; renderResults(); }
    });
    $('#foods').addEventListener('change', function (e) {
      if (e.target.id === 'f-group') { state.foodGroup = e.target.value; renderResults(); return; }
      if (e.target.name === 'fstate') { state.foodCooked = e.target.value === 'cooked'; renderResults(); }
    });
    /* Одна кнопка згортання обслуговує обидва блоки: слухаємо на рівні
       сторінки, бо самі блоки перемальовуються цілком. */
    document.addEventListener('click', function (e) {
      const b = e.target.closest('[data-fold]');
      if (!b) return;
      const key = b.dataset.fold;
      state.folds[key] = !state.folds[key];
      saveFolds(state.folds);
      if (key === 'foods') renderFoods(); else renderRecipes();
      window.App.initAccordions(document);
    });

    $('#foods').addEventListener('click', function (e) {
      const b = e.target.closest('[data-add-food]');
      if (!b) return;
      const f = Foods.byId(b.dataset.addFood);
      if (!f) return;
      openModal({
        kind: 'food',
        foodId: f.id,
        grams: (f.unit && f.unit.grams) || 100,
        // Підхоплюємо режим, у якому зараз показана таблиця: якщо людина
        // дивиться на КБЖВ готового, вона й важить, найпевніше, готове
        cooked: state.foodCooked && Foods.convertible(f)
      });
    });

    /* ---- рецепти ---- */
    const rHost = $('#recipes');

    rHost.addEventListener('click', function (e) {
      const t = e.target;

      if (t.closest('#r-new')) { state.editingRecipe = draftFrom(null); renderRecipes(); return; }
      if (t.closest('#r-cancel')) { state.editingRecipe = null; renderRecipes(); return; }

      const toggle = t.closest('[data-r-toggle]');
      if (toggle) {
        state.openRecipe = state.openRecipe === toggle.dataset.rToggle ? null : toggle.dataset.rToggle;
        renderRecipes();
        return;
      }


      const edit = t.closest('[data-r-edit]');
      if (edit) { state.editingRecipe = draftFrom(recipeById(edit.dataset.rEdit)); renderRecipes(); return; }

      const copy = t.closest('[data-r-copy]');
      if (copy) {
        const src = recipeById(copy.dataset.rCopy);
        if (src) {
          // Новий id обовʼязково: інакше копія перекриє вбудований рецепт
          // у recipeById() і «Додати в день» бере не той склад.
          const draft = draftFrom(src);
          draft.id = 'r' + Date.now();
          draft.name = src.name + ' (моя копія)';
          state.editingRecipe = draft;
          renderRecipes();
        }
        return;
      }

      if (t.closest('#r-add')) {
        const sel = $('#r-add-food');
        if (sel && sel.value) {
          state.editingRecipe.items.push({ foodId: sel.value, grams: 100, cooked: false });
          renderRecipes();
        }
        return;
      }

      if (t.closest('#r-save')) {
        const d = state.editingRecipe;
        if (!d.name.trim()) { toast('Дай рецепту назву', 'err'); return; }
        if (!d.items.length) { toast('Додайте хоча б один інгредієнт', 'err'); return; }
        const clean = {
          id: d.id, name: d.name.trim(), url: d.url.trim(),
          containers: clamp(Math.round(Number(d.containers) || 1), 1, 20),
          items: d.items
        };
        const i = state.recipes.findIndex(function (r) { return r.id === clean.id; });
        if (i >= 0) state.recipes[i] = clean; else state.recipes.push(clean);
        state.editingRecipe = null;
        persist();
        renderRecipes();
        toast('Рецепт збережено', 'ok');
        return;
      }

      if (t.closest('#r-del')) {
        if (!confirm('Видалити рецепт?')) return;
        state.recipes = state.recipes.filter(function (r) { return r.id !== state.editingRecipe.id; });
        state.editingRecipe = null;
        persist();
        renderRecipes();
        return;
      }

      const del = t.closest('[data-rf="del"]');
      if (del) {
        state.editingRecipe.items.splice(Number(del.dataset.ri), 1);
        renderRecipes();
        return;
      }

      const addR = t.closest('[data-add-recipe]');
      if (addR) {
        openModal({ kind: 'recipe', recipeId: addR.dataset.addRecipe, portions: 1 });
      }
    });

    rHost.addEventListener('input', function (e) {
      const d = state.editingRecipe;
      if (!d) return;
      if (e.target.id === 'r-name') { d.name = e.target.value; return; }
      if (e.target.id === 'r-url')  { d.url = e.target.value; return; }
      if (e.target.id === 'r-cont') { d.containers = e.target.value; return; }

      const el = e.target.closest('[data-rf="grams"]');
      if (el) {
        /* Так само кома, як і всюди в цьому файлі (TIM-005). */
        d.items[Number(el.dataset.ri)].grams = clamp(
          Number(String(el.value == null ? '' : el.value).trim().replace(',', '.')) || 0,
          GRAMS_MIN, RECIPE_GRAMS_MAX);
        // Перемальовуємо тільки підсумок: інакше поле втратило б фокус на кожній цифрі
        const per = perContainer(d);
        const kpis = rHost.querySelectorAll('.kpi__val');
        if (kpis.length >= 4) {
          kpis[0].textContent = round(per.kcal, 0);
          kpis[1].textContent = round(per.p, 0);
          kpis[2].textContent = round(per.f, 0);
          kpis[3].textContent = round(per.c, 0);
        }
      }
    });

    rHost.addEventListener('change', function (e) {
      const d = state.editingRecipe;
      if (!d) return;
      const food = e.target.closest('[data-rf="food"]');
      if (food) { d.items[Number(food.dataset.ri)].foodId = food.value; renderRecipes(); return; }
      const ck = e.target.closest('[data-rf="cooked"]');
      if (ck) { d.items[Number(ck.dataset.ri)].cooked = ck.value === '1'; renderRecipes(); }
    });

    /* ---- вікно додавання ---- */
    const mHost = $('#modal');
    if (!mHost) return;   // без контейнера решта сторінки має лишитись робочою

    mHost.addEventListener('click', function (e) {
      if (e.target.closest('[data-m-close]')) { closeModal(); return; }
      if (e.target.closest('#m-add')) { commitModal(); return; }

      const q = e.target.closest('[data-m-quick]');
      if (q && state.modal) {
        const v = Number(q.dataset.mQuick);
        if (state.modal.kind === 'recipe') state.modal.portions = v; else state.modal.grams = v;
        const inp = $('#m-grams');
        if (inp) inp.value = v;
        refreshModalNumbers();
      }
    });

    mHost.addEventListener('input', function (e) {
      if (!state.modal) return;
      if (e.target.id === 'm-grams') {
        if (state.modal.kind === 'recipe') {
          state.modal.portions = Math.max(0, Number(e.target.value) || 0);
        } else {
          /* Сирий рядок: перевіряє commitModal, а превʼю рахує лише
             чинне значення (сміття/понад стелю показує нулі). */
          state.modal.grams = e.target.value;
        }
        refreshModalNumbers();
      }
    });

    mHost.addEventListener('change', function (e) {
      if (!state.modal) return;
      if (e.target.id === 'm-meal') {
        state.modal.mealIndex = Number(e.target.value);
        return;
      }
      if (e.target.name === 'mstate') {
        state.modal.cooked = e.target.value === 'cooked';
        // Тут перемальовуємо повністю: змінилась не лише цифра, а й підказка
        // про перерахунок, і фокус усе одно повертається на поле маси
        renderModal();
      }
    });

    // Enter додає, Escape закриває — щоб не тягнутись до миші.
    // Tab циклиться всередині вікна: без пастки фокус із «діалогу»
    // втікав у контент під ним, і aria-modal="true" був неправдою.
    document.addEventListener('keydown', function (e) {
      if (!state.modal) return;
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key === 'Enter' && e.target.id === 'm-grams') { e.preventDefault(); commitModal(); return; }
      if (e.key === 'Tab') {
        const focusables = $$('#modal button, #modal input, #modal select, #modal a[href]')
          .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const inModal = e.target.closest && e.target.closest('#modal');

        if (!inModal) { e.preventDefault(); first.focus(); return; }
        if (e.shiftKey && e.target === first) { e.preventDefault(); last.focus(); return; }
        if (!e.shiftKey && e.target === last) { e.preventDefault(); first.focus(); }
      }
    });

    /* ---- день ---- */
    const dHost = $('#day');

    dHost.addEventListener('click', function (e) {
      if (e.target.closest('#d-close')) {
        closeCurrentDay();
        return;
      }
      if (e.target.closest('#q-save')) { saveQuickDay(); return; }
      if (e.target.closest('#d-copy')) {
        state.copyOpen = !state.copyOpen;
        renderDay();
        const list = $('#d-copy-list');
        if (list) list.scrollIntoView({ block: 'nearest' });
        return;
      }
      const cAdd = e.target.closest('[data-copy-add]');
      if (cAdd) { copyDayFrom(cAdd.dataset.copyAdd, 'add'); return; }
      const cSet = e.target.closest('[data-copy-set]');
      if (cSet) { copyDayFrom(cSet.dataset.copySet, 'replace'); return; }
      if (e.target.closest('#d-clear')) {
        if (!confirm('Очистити весь день БЕЗ запису в історію? Рецепти залишаться.')) return;
        state.day = EMPTY_DAY();
        persist(); renderDay(); return;
      }
      const di = e.target.closest('[data-df="del"]');
      if (di) {
        // Додавання каже «Додано в «Обід»», прибирання мовчало. Одна дія —
        // одне правило: кожна зміна дня підтверджується однаково.
        const meal = state.day.meals[Number(di.dataset.di)];
        meal.items.splice(Number(di.dataset.dj), 1);
        persist(); renderDay();
        toast('Прибрано з «' + meal.name + '»', 'ok');
      }
    });

    /* Перемикач «докладно / швидко». change, а не click: радіокнопку
       перемикають і клавіатурою, і клік по label теж дає change. */
    dHost.addEventListener('change', function (e) {
      const r = e.target.closest('input[name="d-mode"]');
      if (!r) return;
      state.quick = r.value === 'quick';
      saveQuick(state.quick);
      /* Перехід у швидкий режим підставляє суму вже набраного дня: інакше
         розібрані позиції зникли б, а людина побачила б порожнє поле і не
         зрозуміла, що втратила. */
      if (state.quick && !state.quickKcal) {
        const got = dayTotals();
        if (got.kcal >= 1) {
          state.quickKcal = String(Math.round(got.kcal));
          if (got.p >= 1) state.quickP = String(Math.round(got.p));
        }
      }
      renderDay();
      const f = $('#q-kcal');
      if (f) f.focus();
    });

    dHost.addEventListener('input', function (e) {
      const q = e.target.closest('#q-kcal, #q-p');
      if (q) {
        if (q.id === 'q-kcal') state.quickKcal = q.value;
        else state.quickP = q.value;
        return;
      }
      const el = e.target.closest('[data-df="amount"]');
      if (el) {
        const it = state.day.meals[Number(el.dataset.di)].items[Number(el.dataset.dj)];
        // Верхня межа тут раніше була відсутня зовсім, і показане число
        // розходилось із порахованим у десять разів.
        if (it.kind === 'snap') {
          /* Заморожена позиція: одиниця своя (грами або контейнери), тому
             й межа своя. Кома як роздільник — так само, як у решті полів. */
          const maxQ = it.unit === 'portion' ? PORTIONS_MAX : GRAMS_MAX;
          const rawQ = Number(String(el.value == null ? '' : el.value).trim().replace(',', '.')) || 0;
          it.qty = clamp(rawQ, 0, maxQ);
          if (String(rawQ) !== String(it.qty)) el.value = it.qty;
        } else if (it.kind === 'recipe') {
          /* Кома як десятковий роздільник (TIM-005). Грами йшли через
             parseGrams із заміною коми, а контейнери — через голий
             Number(): «1,5» → NaN → 0. Поле при цьому не перезаписувалось
             (String(0) === String(0)), тож людина бачила «1,5», а в день
             лягав нуль. */
          const raw = Number(String(el.value == null ? '' : el.value).trim().replace(',', '.')) || 0;
          it.portions = clamp(raw, PORTIONS_MIN, PORTIONS_MAX);
          if (String(raw) !== String(it.portions)) el.value = it.portions;
        } else {
          const g = parseGrams(el.value);
          if (g === null) {
            /* Поза межами — не пишемо і повертаємо в поле те, що записано */
            toast('Грами: від 0 до ' + GRAMS_MAX, 'err');
            el.value = it.grams;
            return;
          }
          it.grams = g;
          if (String(el.value).trim() !== String(g)) el.value = g;
        }
        persist();
        // Оновлюємо тільки підсумки зверху, щоб не збити фокус із поля
        const t = target();
        const got = dayTotals();
        const host = $('#day');
        const bars = host.querySelector('.vol-list');
        if (t && bars) {
          /*
           * ТУТ АНІМАЦІЯ ПОЯВИ ВИМИКАЄТЬСЯ, І ЦЕ ГОЛОВНЕ В ЦЬОМУ МІСЦІ.
           *
           * Цей шлях спрацьовує на КОЖНУ правку грамів у полі. Смуги
           * перемальовуються цілком, тож без is-still вони заново
           * виїжджали б з нуля й давали пробіг світла на кожен
           * натиснутий символ — рух там, де людина просто набирає число.
           * Поява має грати, коли блок ЗʼЯВЛЯЄТЬСЯ, а не коли міняється
           * значення в ньому.
           */
          bars.classList.add('is-still');
          volSeq = 0;
          bars.innerHTML =
            progressRow('Калорії',    got.kcal,  t.kcal,    'ккал') +
            progressRow('Білок',      got.p,     t.protein, 'г') +
            progressRow('Жири',       got.f,     t.fat,     'г') +
            progressRow('Вуглеводи',  got.c,     t.carb,    'г') +
            progressRow('Клітковина', got.fiber, t.fiber,   'г');
        }
        return;
      }
      if (e.target.id === 'd-quick') renderQuickList();
    });

    /* Вибір із підказок швидкого додавання — та сама модалка, що й
       у довідника: рішення про масу і прийом ухвалюються в одному місці */
    dHost.addEventListener('click', function (e) {
      /* «+ Додати продукт» у картці прийому: запамʼятовуємо прийом і
         ведемо до того самого поля пошуку — другого механізму додавання
         не зʼявляється, лише коротший вхід у наявний. */
      const addTo = e.target.closest('[data-add-to]');
      if (addTo) {
        state.quickMeal = Number(addTo.dataset.addTo);
        const input = $('#d-quick');
        if (input) { input.value = ''; renderQuickList(); input.focus(); input.scrollIntoView({ block: 'center' }); }
        return;
      }

      const q = e.target.closest('[data-quick-kind]');
      if (!q) return;
      const input = $('#d-quick');
      /* Спершу відкриваємо вікно, потім чистимо підказки: інакше
         document.activeElement на момент openModal вказував би на щойно
         видалену кнопку, і повертати фокус після закриття було б нікуди. */
      const mealIndex = state.quickMeal;

      if (q.dataset.quickKind === 'recipe') {
        openModal({ kind: 'recipe', recipeId: q.dataset.quickId, portions: 1 }, mealIndex);
      } else {
        const f = Foods.byId(q.dataset.quickId);
        if (!f) return;
        openModal({
          kind: 'food',
          foodId: f.id,
          grams: (f.unit && f.unit.grams) || 100,
          cooked: false
        }, mealIndex);
      }

      state.quickMeal = null;
      if (input) input.value = '';
      renderQuickList();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
