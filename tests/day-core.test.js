/**
 * Арифметика дня раціону (js/day-core.js).
 *
 * Цим модулем користуються три сторінки (раціон, «Сьогодні», головна),
 * тому головна властивість — передбачуваність на брудному вводі: биті
 * id продуктів і рецептів мовчки дають нуль внеску, а не NaN у сумі.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/date-core.js', 'js/foods.js', 'js/recipes-data.js', 'js/day-core.js']);
const D = ctx.DayCore;
const Foods = ctx.Foods;

const chicken = Foods.byId('chicken-breast');

describe('day-core: базова арифметика', () => {
  it('порожній день — нулі, не NaN', () => {
    for (const day of [null, undefined, {}, { meals: [] }, { meals: 'сміття' }]) {
      const t = D.dayTotals(day, []);
      assert.equal(t.kcal, 0);
      assert.equal(t.p, 0);
    }
  });

  it('сума продуктів збігається з Foods.amount', () => {
    const day = { meals: [{ items: [
      { kind: 'food', foodId: 'chicken-breast', grams: 200, cooked: false },
      { kind: 'food', foodId: 'olive-oil', grams: 10, cooked: false }
    ] }] };
    const t = D.dayTotals(day, []);
    const expected = D.add(
      Foods.amount(chicken, 200, false),
      Foods.amount(Foods.byId('olive-oil'), 10, false)
    );
    assert.ok(Math.abs(t.kcal - expected.kcal) < 1e-9);
    assert.ok(Math.abs(t.p - expected.p) < 1e-9);
  });

  it('битий foodId і битий recipeId дають нуль внеску, а не NaN', () => {
    const day = { meals: [{ items: [
      { kind: 'food', foodId: 'не-існує', grams: 100 },
      { kind: 'recipe', recipeId: 'теж-ні', portions: 2 },
      { kind: 'food', foodId: 'chicken-breast', grams: 100, cooked: false }
    ] }] };
    const t = D.dayTotals(day, []);
    const only = Foods.amount(chicken, 100, false);
    assert.ok(Number.isFinite(t.kcal));
    assert.ok(Math.abs(t.kcal - only.kcal) < 1e-9);
  });
});

describe('day-core: рецепти', () => {
  const recipe = {
    id: 'r-test', name: 'Тест', containers: 4,
    items: [{ foodId: 'chicken-breast', grams: 400, cooked: false }]
  };

  it('perContainer ділить на кількість контейнерів', () => {
    const per = D.perContainer(recipe);
    const whole = Foods.amount(chicken, 400, false);
    assert.ok(Math.abs(per.kcal * 4 - whole.kcal) < 1e-9);
  });

  it('власний рецепт із профілю бере участь у сумі дня', () => {
    const day = { meals: [{ items: [{ kind: 'recipe', recipeId: 'r-test', portions: 2 }] }] };
    const t = D.dayTotals(day, [recipe]);
    const per = D.perContainer(recipe);
    assert.ok(Math.abs(t.kcal - per.kcal * 2) < 1e-9);
  });

  it('вбудовані рецепти доступні без списку користувача', () => {
    const base = D.allRecipes([]);
    assert.ok(base.length > 0, 'BASE_RECIPES порожній?');
    const first = base[0];
    const t = D.dayTotals(
      { meals: [{ items: [{ kind: 'recipe', recipeId: first.id, portions: 1 }] }] },
      []
    );
    assert.ok(t.kcal > 0, 'вбудований рецепт дав нуль калорій');
  });

  it('containers=0 або сміття не дає ділення на нуль', () => {
    const bad = { id: 'r-b', containers: 0, items: recipe.items };
    const per = D.perContainer(bad);
    assert.ok(Number.isFinite(per.kcal) && per.kcal > 0);
  });
});
