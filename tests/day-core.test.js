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

/*
 * Копія дня (F1).
 *
 * Головна правда про цю функцію: історія харчування НЕ зберігала позицій —
 * тільки підсумки. Тому копіювати можна лише те, що при закритті дня
 * поклали в знімок, а знімок мусить лишатись правдою навіть тоді, коли
 * продукт із довідника зник. Саме на цьому «копія дня» ламається тихо:
 * зникле джерело дає нуль калорій, і скопійований день виходить меншим за
 * той, який копіювали.
 */
describe('day-core: заморожена позиція', () => {
  it('snap рахується з власного per × qty, без довідника', () => {
    const it = { kind: 'snap', name: 'Щось', unit: 'g', qty: 200,
                 per: { kcal: 1.5, p: 0.2, f: 0.1, c: 0.05, fiber: 0.01 } };
    const t = D.itemNutrition(it, []);
    assert.ok(Math.abs(t.kcal - 300) < 1e-9);
    assert.ok(Math.abs(t.p - 40) < 1e-9);
  });

  it('битий snap не дає NaN у сумі дня', () => {
    const day = { meals: [{ items: [
      { kind: 'snap', name: 'A', unit: 'g', qty: 'сміття', per: { kcal: 'ні' } },
      { kind: 'snap', name: 'B', unit: 'g', qty: -5, per: null },
      { kind: 'snap', name: 'C', unit: 'g', qty: 100, per: { kcal: 2 } }
    ] }] };
    const t = D.dayTotals(day, []);
    assert.ok(Number.isFinite(t.kcal));
    assert.ok(Math.abs(t.kcal - 200) < 1e-9);
  });

  it('заморожування продукту зберігає КБЖВ на ОДИН грам', () => {
    const frozen = D.freezeItem({ kind: 'food', foodId: 'chicken-breast', grams: 250 }, []);
    assert.equal(frozen.kind, 'snap');
    assert.equal(frozen.unit, 'g');
    assert.equal(frozen.qty, 250);
    assert.equal(frozen.foodId, 'chicken-breast');
    const live = Foods.amount(chicken, 250, false);
    const viaSnap = D.itemNutrition(frozen, []);
    assert.ok(Math.abs(live.kcal - viaSnap.kcal) < 1e-9, 'знімок порахувався інакше за джерело');
    assert.ok(Math.abs(live.p - viaSnap.p) < 1e-9);
  });

  it('позиція, чиє джерело вже зникло, у знімок не потрапляє', () => {
    assert.equal(D.freezeItem({ kind: 'food', foodId: 'нема-такого', grams: 100 }, []), null);
    assert.equal(D.freezeItem({ kind: 'recipe', recipeId: 'нема', portions: 1 }, []), null);
  });
});

describe('day-core: копія дня', () => {
  const R = { id: 'r-copy', name: 'Каша', containers: 4,
              items: [{ foodId: 'chicken-breast', grams: 400, cooked: false }] };

  const srcDay = { meals: [
    { name: 'Сніданок', items: [{ kind: 'food', foodId: 'chicken-breast', grams: 200, cooked: false }] },
    { name: 'Обід', items: [{ kind: 'recipe', recipeId: 'r-copy', portions: 2 }] }
  ] };

  const empty = () => [{ name: 'Сніданок', items: [] }, { name: 'Обід', items: [] }];

  it('копія дня дає ту саму калорійність, що джерело', () => {
    const frozen = D.freezeMeals(srcDay, [R]);
    const meals = D.copyDayInto(empty(), frozen, 'add', [R], {});
    const a = D.dayTotals(srcDay, [R]);
    const b = D.dayTotals({ meals: meals }, [R]);
    assert.ok(Math.abs(a.kcal - b.kcal) < 1e-6, a.kcal + ' проти ' + b.kcal);
    assert.ok(Math.abs(a.p - b.p) < 1e-6);
  });

  it('живе джерело копіюється посиланням, а не числом', () => {
    const frozen = D.freezeMeals(srcDay, [R]);
    const meals = D.copyDayInto(empty(), frozen, 'add', [R], {});
    assert.equal(meals[0].items[0].kind, 'food');
    assert.equal(meals[0].items[0].foodId, 'chicken-breast');
    assert.equal(meals[1].items[0].kind, 'recipe');
    assert.equal(meals[1].items[0].portions, 2);
  });

  it('зникле джерело копіюється замороженим і не втрачає калорій', () => {
    const frozen = D.freezeMeals(srcDay, [R]);
    /* Рецепта в профілі більше немає — рівно те, що буває через місяць */
    const report = {};
    const meals = D.copyDayInto(empty(), frozen, 'add', [], report);
    assert.equal(meals[1].items[0].kind, 'snap');
    assert.equal(report.frozen, 1);
    const per = D.perContainer(R);
    assert.ok(Math.abs(D.itemNutrition(meals[1].items[0], []).kcal - per.kcal * 2) < 1e-6);
  });

  it('«додати» додає до наявного, «замінити» — замінює', () => {
    const frozen = D.freezeMeals(srcDay, [R]);
    const had = [{ name: 'Сніданок', items: [{ kind: 'food', foodId: 'olive-oil', grams: 10 }] },
                 { name: 'Обід', items: [] }];
    const added = D.copyDayInto(had, frozen, 'add', [R], {});
    assert.equal(added[0].items.length, 2);
    const replaced = D.copyDayInto(had, frozen, 'replace', [R], {});
    assert.equal(replaced[0].items.length, 1);
    assert.equal(replaced[0].items[0].foodId, 'chicken-breast');
  });

  it('«замінити» ідемпотентна: два натискання = одне', () => {
    const frozen = D.freezeMeals(srcDay, [R]);
    const once = D.copyDayInto(empty(), frozen, 'replace', [R], {});
    const twice = D.copyDayInto(once, frozen, 'replace', [R], {});
    assert.equal(JSON.stringify(once), JSON.stringify(twice));
  });

  it('вхідний масив прийомів не мутується', () => {
    const frozen = D.freezeMeals(srcDay, [R]);
    const had = empty();
    D.copyDayInto(had, frozen, 'add', [R], {});
    assert.equal(had[0].items.length, 0, 'copyDayInto змінила вхід');
  });

  it('зайві прийоми джерела зливаються в останній, їжа не зникає', () => {
    const wide = { meals: [
      { name: 'A', items: [{ kind: 'food', foodId: 'chicken-breast', grams: 100 }] },
      { name: 'B', items: [{ kind: 'food', foodId: 'chicken-breast', grams: 100 }] },
      { name: 'C', items: [{ kind: 'food', foodId: 'chicken-breast', grams: 100 }] }
    ] };
    const frozen = D.freezeMeals(wide, []);
    const meals = D.copyDayInto([{ name: 'Один', items: [] }], frozen, 'add', [], {});
    assert.equal(meals.length, 1);
    assert.equal(meals[0].items.length, 3);
  });

  it('понад стелю позицій — не мовчки: report.dropped', () => {
    const many = { meals: [{ name: 'A', items: [] }] };
    for (let i = 0; i < D.MEAL_ITEM_CAP + 5; i++) {
      many.meals[0].items.push({ kind: 'food', foodId: 'chicken-breast', grams: 10 });
    }
    const report = {};
    const meals = D.copyDayInto([{ name: 'A', items: [] }], D.freezeMeals(many, []), 'add', [], report);
    assert.equal(meals[0].items.length, D.MEAL_ITEM_CAP);
    assert.equal(report.dropped, 5);
  });

  it('порожній день-джерело нічого не додає', () => {
    const report = {};
    const meals = D.copyDayInto(empty(), D.freezeMeals({ meals: [{ name: 'A', items: [] }] }, []), 'add', [], report);
    assert.equal(report.added, 0);
    assert.equal(meals[0].items.length, 0);
    assert.equal(D.hasFrozenItems(D.freezeMeals({ meals: [{ name: 'A', items: [] }] }, [])), false);
  });
});
