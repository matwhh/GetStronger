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

  /** Сума по одному прийому їжі */
  function mealTotals(meal, userRecipes) {
    const Foods = window.Foods;
    return (meal.items || []).reduce(function (sum, it) {
      if (it.kind === 'recipe') {
        const r = recipeById(it.recipeId, userRecipes);
        if (!r) return sum;
        return add(sum, scale(perContainer(r), Number(it.portions) || 0));
      }
      const food = Foods.byId(it.foodId);
      if (!food) return sum;
      return add(sum, Foods.amount(food, it.grams, Boolean(it.cooked)));
    }, ZERO());
  }

  /** Підсумок усього дня. day — profile.day, userRecipes — profile.recipes */
  function dayTotals(day, userRecipes) {
    if (!day || !Array.isArray(day.meals)) return ZERO();
    return day.meals.reduce(function (sum, m) {
      return add(sum, mealTotals(m, userRecipes));
    }, ZERO());
  }

  window.DayCore = {
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
