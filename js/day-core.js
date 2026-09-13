/**
 * Арифметика дня раціону — чисті функції, без DOM.
 *
 * Винесено з js/meals.js, бо підсумок дня тепер потрібен трьом місцям:
 * раціону (смуги проти норми), «Сьогодні» (залишок калорій) і головній
 * (картка стану харчування). Три власні реалізації однієї суми — це три
 * відповіді на питання «скільки я зʼїв», які рано чи пізно розійдуться.
 *
 * Модуль знає про window.Foods (КБЖВ і перерахунок сире/готове) і про
 * window.BASE_RECIPES (вбудовані рецепти). Власні рецепти живуть у профілі
 * й передаються аргументом — читати профіль звідси означало б сховану
 * залежність від сховища в чистій арифметиці.
 */
(function () {
  'use strict';

  const ZERO = function () { return { kcal: 0, p: 0, f: 0, c: 0, fiber: 0 }; };

  function add(a, b) {
    return { kcal: a.kcal + b.kcal, p: a.p + b.p, f: a.f + b.f, c: a.c + b.c, fiber: a.fiber + b.fiber };
  }

  function scale(a, k) {
    return { kcal: a.kcal * k, p: a.p * k, f: a.f * k, c: a.c * k, fiber: a.fiber * k };
  }

  /** Вбудовані рецепти + власні з профілю; власні можуть перекривати нічого */
  function allRecipes(userRecipes) {
    const base = Array.isArray(window.BASE_RECIPES) ? window.BASE_RECIPES : [];
    return base.concat(Array.isArray(userRecipes) ? userRecipes : []);
  }

  function recipeById(id, userRecipes) {
    return allRecipes(userRecipes).find(function (r) { return r.id === id; }) || null;
  }

  /** Сума по всьому рецепту (на всі контейнери) */
  function recipeTotals(recipe) {
    const Foods = window.Foods;
    return (recipe.items || []).reduce(function (sum, it) {
      const food = Foods.byId(it.foodId);
      if (!food) return sum;
      return add(sum, Foods.amount(food, it.grams, Boolean(it.cooked)));
    }, ZERO());
  }

  /** На один контейнер */
  function perContainer(recipe) {
    const n = Math.max(1, Number(recipe.containers) || 1);
    return scale(recipeTotals(recipe), 1 / n);
  }

  /* ------------------------------------------------------------------ */
  /* Заморожена позиція                                                  */
  /* ------------------------------------------------------------------ */
  /*
   * kind:'snap' — позиція, що більше не посилається ні на продукт, ні на
   * рецепт: усе потрібне лежить у ній самій. Зʼявилась разом із копією дня
   * (F1): день, закритий місяць тому, посилався на продукт, якого в
   * довіднику вже немає, і посилання дало б нуль калорій — тобто копія
   * дня тихо виходила б меншою за день.
   *
   * Одна форма для грамів і для контейнерів: `per` — КБЖВ на ОДНУ одиницю
   * (один грам або один контейнер), `qty` — скільки цих одиниць. Тому
   * множення одне: per × qty. Ціна — некруглі числа в per для грамів
   * (0.0165 ккал/г); вигода — жодної другої гілки в арифметиці, рендері й
   * валідаторі імпорту.
   */
  const SNAP_UNIT_LABEL = { g: 'г', portion: 'конт.' };

  function num(v, max) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, max || 1e6);
  }

  function snapUnit(it) { return it && it.unit === 'portion' ? 'portion' : 'g'; }

  function snapPer(it) {
    const p = (it && it.per) || {};
    return { kcal: num(p.kcal), p: num(p.p), f: num(p.f), c: num(p.c), fiber: num(p.fiber) };
  }

  /** КБЖВ однієї позиції дня, якого б виду вона не була */
  function itemNutrition(it, userRecipes) {
    if (!it || typeof it !== 'object') return ZERO();
    if (it.kind === 'snap') return scale(snapPer(it), num(it.qty));
    if (it.kind === 'recipe') {
      const r = recipeById(it.recipeId, userRecipes);
      return r ? scale(perContainer(r), Number(it.portions) || 0) : ZERO();
    }
    const food = window.Foods.byId(it.foodId);
    return food ? window.Foods.amount(food, it.grams, Boolean(it.cooked)) : ZERO();
  }

  /** Сума по одному прийому їжі */
  function mealTotals(meal, userRecipes) {
    return ((meal && meal.items) || []).reduce(function (sum, it) {
      return add(sum, itemNutrition(it, userRecipes));
    }, ZERO());
  }

  /** Підсумок усього дня. day — profile.day, userRecipes — profile.recipes */
  function dayTotals(day, userRecipes) {
    if (!day || !Array.isArray(day.meals)) return ZERO();
    return day.meals.reduce(function (sum, m) {
      return add(sum, mealTotals(m, userRecipes));
    }, ZERO());
  }

  /* ------------------------------------------------------------------ */
  /* Копія дня (F1)                                                      */
  /* ------------------------------------------------------------------ */
  /*
   * Історія харчування (mealLog) тримала тільки підсумки: ккал, БЖВ, ціль.
   * Позицій у ній не було взагалі, тому «скопіювати день» не було з чого
   * робити — і план, який казав «нічого нового, та сама форма mealLog»,
   * тут помилявся. Тому при закритті дня в запис кладеться ще й знімок
   * прийомів: freezeMeals нижче, а зберігає його HistoryCore.closeDay.
   *
   * Знімок — заморожений (див. kind:'snap'), але несе й id джерела. Через
   * це копія віддає перевагу живому посиланню: скопійований учорашній рис
   * лишається рисом, який можна перерахувати в готовий, а не числом.
   */

  /** Одна позиція дня → заморожена. null, якщо джерело вже зникло. */
  function freezeItem(it, userRecipes) {
    if (!it || typeof it !== 'object') return null;

    if (it.kind === 'snap') {
      const kept = { kind: 'snap', name: String(it.name || ''), unit: snapUnit(it), qty: num(it.qty), per: snapPer(it) };
      if (it.foodId) { kept.foodId = String(it.foodId); kept.cooked = it.cooked === true; }
      if (it.recipeId) kept.recipeId = String(it.recipeId);
      return kept;
    }

    if (it.kind === 'recipe') {
      const r = recipeById(it.recipeId, userRecipes);
      /* Джерела вже немає — морозити нічого: у дні воно теж рахувалось
         як нуль, і копія мусить бути копією дня, а не його домислом. */
      if (!r) return null;
      return { kind: 'snap', name: String(r.name || ''), unit: 'portion',
               qty: num(it.portions), per: perContainer(r), recipeId: String(r.id) };
    }

    const food = window.Foods.byId(it.foodId);
    if (!food) return null;
    return { kind: 'snap', name: String(food.name || ''), unit: 'g',
             qty: num(it.grams), per: window.Foods.amount(food, 1, Boolean(it.cooked)),
             foodId: String(food.id), cooked: it.cooked === true };
  }

  /** Знімок прийомів дня для історії. Прийоми без позицій зберігаються теж:
   *  назви — частина дня, і копія має лягати в ті самі прийоми. */
  function freezeMeals(day, userRecipes) {
    if (!day || !Array.isArray(day.meals)) return [];
    return day.meals.map(function (m, i) {
      const items = (Array.isArray(m && m.items) ? m.items : [])
        .map(function (it) { return freezeItem(it, userRecipes); })
        .filter(Boolean);
      return { name: String((m && m.name) || ('Прийом ' + (i + 1))), items: items };
    });
  }

  /** Чи є в знімку хоч одна позиція (порожній знімок не зберігаємо) */
  function hasFrozenItems(frozen) {
    return Array.isArray(frozen) && frozen.some(function (m) {
      return m && Array.isArray(m.items) && m.items.length > 0;
    });
  }

  /** Заморожена позиція → позиція дня. Живе посилання, якщо джерело є. */
  function thawItem(it, userRecipes) {
    if (!it || it.kind !== 'snap') return null;
    if (it.recipeId && recipeById(it.recipeId, userRecipes)) {
      return { kind: 'recipe', recipeId: String(it.recipeId), portions: num(it.qty) };
    }
    if (it.foodId && window.Foods.byId(it.foodId)) {
      return { kind: 'food', foodId: String(it.foodId), grams: num(it.qty), cooked: it.cooked === true };
    }
    return { kind: 'snap', name: String(it.name || ''), unit: snapUnit(it), qty: num(it.qty), per: snapPer(it) };
  }

  /**
   * Вкласти знімок дня в поточний день.
   *
   * Прийоми зводяться ЗА НОМЕРОМ, а не за назвою: схема прийомів могла
   * змінитись між тим днем і цим, і зведення за назвою тоді молча губило
   * б обід. Зайві прийоми джерела зливаються в останній — те саме
   * правило, що в applySchema, щоб їжа не зникала.
   *
   * @param {Array} targetMeals прийоми поточного дня
   * @param {Array} frozen знімок із mealLog[дата].meals
   * @param {'add'|'replace'} mode додати до наявного чи замінити
   * @param {Array} [userRecipes] власні рецепти профілю
   * @param {object} [report] {added, dropped, frozen} — для повідомлення
   * @returns {Array} НОВИЙ масив прийомів
   */
  function copyDayInto(targetMeals, frozen, mode, userRecipes, report) {
    const src = Array.isArray(frozen) ? frozen : [];
    const out = (Array.isArray(targetMeals) ? targetMeals : []).map(function (m, i) {
      return {
        name: String((m && m.name) || ('Прийом ' + (i + 1))),
        items: (mode === 'replace' || !Array.isArray(m && m.items)) ? [] : m.items.slice()
      };
    });
    let added = 0, dropped = 0, froze = 0;
    if (!out.length) {
      if (report) { report.added = 0; report.dropped = 0; report.frozen = 0; }
      return out;
    }

    for (let i = 0; i < src.length; i++) {
      const into = out[Math.min(i, out.length - 1)];
      const items = Array.isArray(src[i] && src[i].items) ? src[i].items : [];
      for (let j = 0; j < items.length; j++) {
        const live = thawItem(items[j], userRecipes);
        if (!live) continue;
        /* Стеля позицій — та сама, що у валідаторі імпорту. Понад неї
           позиції ВТРАЧАЮТЬСЯ, і саме тому dropped існує: мовчки
           викидати їжу з копії не можна. */
        if (into.items.length >= MEAL_ITEM_CAP) { dropped++; continue; }
        if (live.kind === 'snap') froze++;
        into.items.push(live);
        added++;
      }
    }

    if (report) { report.added = added; report.dropped = dropped; report.frozen = froze; }
    return out;
  }

  /**
   * Привести список прийомів до схеми: перейменувати за іменами, зайві
   * прийоми злити в останній.
   *
   * ЖИВЕ ТУТ, А НЕ В js/meals.js (TST-002). Там її не міг завантажити
   * жоден тест — файл тягне DOM і window.App, — тому в тестах лежала
   * КОПІЯ, і сигнатури вже розійшлись (count проти report). Продакшен-
   * функція не перевірялась узагалі: мутант, що прибирає злиття прийомів,
   * проходив усі 483 тести.
   *
   * MEAL_ITEM_CAP — та сама стеля, що у валідаторі імпорту (js/account.js):
   * інакше після злиття профіль став би таким, який сам сайт не приймає.
   * Позиції понад стелю ВТРАЧАЮТЬСЯ — і саме тому report.dropped існує:
   * мовчки викидати їжу з дня не можна.
   *
   * @param {Array} meals прийоми як вони є зараз
   * @param {string[]} names назви прийомів за схемою
   * @param {object} [report] {moved, into, dropped} — для повідомлення
   * @returns {Array} прийоми за схемою
   */
  const MEAL_ITEM_CAP = 60;

  function applySchema(meals, names, report) {
    const list = Array.isArray(names) && names.length ? names : ['Прийом 1'];
    const src = Array.isArray(meals) ? meals : [];

    const out = list.map(function (name, i) {
      const m = src[i];
      return { name: name, items: (m && Array.isArray(m.items)) ? m.items : [] };
    });

    const last = out[out.length - 1];
    let moved = 0;
    for (let i = list.length; i < src.length; i++) {
      const extra = src[i];
      if (extra && Array.isArray(extra.items) && extra.items.length) {
        last.items = last.items.concat(extra.items);
        moved += extra.items.length;
      }
    }

    const dropped = Math.max(0, last.items.length - MEAL_ITEM_CAP);
    last.items = last.items.slice(0, MEAL_ITEM_CAP);

    if (report) { report.moved = moved; report.into = last.name; report.dropped = dropped; }
    return out;
  }

  window.DayCore = {
    MEAL_ITEM_CAP: MEAL_ITEM_CAP,
    SNAP_UNIT_LABEL: SNAP_UNIT_LABEL,
    applySchema: applySchema,
    itemNutrition: itemNutrition,
    freezeItem: freezeItem,
    freezeMeals: freezeMeals,
    hasFrozenItems: hasFrozenItems,
    thawItem: thawItem,
    copyDayInto: copyDayInto,
    ZERO: ZERO,
    add: add,
    scale: scale,
    allRecipes: allRecipes,
    recipeTotals: recipeTotals,
    perContainer: perContainer,
    mealTotals: mealTotals,
    dayTotals: dayTotals
  };
})();
