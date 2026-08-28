/**
 * Схема прийомів їжі — спільна для калькулятора й раціону.
 *
 * Головне, що тут перевіряється: при зменшенні кількості прийомів їжа
 * не зникає, а переїжджає в останній прийом. Це єдине місце, де зміна
 * налаштування на одній сторінці може мовчки видалити дані на іншій.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNutrition } from './helpers.js';

const NC = loadNutrition();

test('mealNames: кількість назв дорівнює кількості прийомів', () => {
  for (let n = NC.MEALS_MIN; n <= NC.MEALS_MAX; n++) {
    assert.equal(NC.mealNames(n).length, n);
  }
});

test('mealNames: повертає копію, а не спільний масив', () => {
  const a = NC.mealNames(3);
  a[0] = 'зіпсовано';
  assert.equal(NC.mealNames(3)[0], 'Сніданок');
});

test('mealCount: порожнє значення дає замовчування, а не нуль', () => {
  assert.equal(NC.mealCount(null), NC.MEALS_DEFAULT);
  assert.equal(NC.mealCount(undefined), NC.MEALS_DEFAULT);
  assert.equal(NC.mealCount(''), NC.MEALS_DEFAULT);
  assert.equal(NC.mealCount('сміття'), NC.MEALS_DEFAULT);
});

test('mealCount: виходи за межі підтягуються до меж', () => {
  assert.equal(NC.mealCount(1), NC.MEALS_MIN);
  assert.equal(NC.mealCount(99), NC.MEALS_MAX);
  assert.equal(NC.mealCount('5'), 5);
  assert.equal(NC.mealCount(4.4), 4);
});

test('замовчування лежить у дозволених межах', () => {
  assert.ok(NC.MEALS_DEFAULT >= NC.MEALS_MIN && NC.MEALS_DEFAULT <= NC.MEALS_MAX);
});

/* Копія applySchema з js/meals.js: сам файл тягне DOM і window.App,
   тому в пісочницю не вантажиться. Логіка звірена з оригіналом. */
function applySchema(meals, count) {
  const names = NC.mealNames(count);
  const src = Array.isArray(meals) ? meals : [];
  const out = names.map((name, i) => ({
    name: name,
    items: (src[i] && Array.isArray(src[i].items)) ? src[i].items : []
  }));
  const last = out[out.length - 1];
  for (let i = names.length; i < src.length; i++) {
    if (src[i] && Array.isArray(src[i].items) && src[i].items.length) {
      last.items = last.items.concat(src[i].items);
    }
  }
  last.items = last.items.slice(0, 60);
  return out;
}

test('зменшення кількості прийомів не втрачає жодної позиції', () => {
  const six = [1, 2, 3, 4, 5, 6].map(function (n) {
    return { name: 'x', items: [{ kind: 'food', foodId: 'f' + n, grams: 100 }] };
  });

  for (let n = NC.MEALS_MIN; n <= NC.MEALS_MAX; n++) {
    const out = applySchema(six, n);
    const total = out.reduce(function (s, m) { return s + m.items.length; }, 0);
    assert.equal(out.length, n);
    assert.equal(total, 6, 'при ' + n + ' прийомах загубились позиції');
  }
});

test('збільшення кількості прийомів додає порожні картки, не чіпаючи наявні', () => {
  const three = [
    { name: 'a', items: [{ kind: 'food', foodId: 'f1', grams: 100 }] },
    { name: 'b', items: [] },
    { name: 'c', items: [{ kind: 'food', foodId: 'f2', grams: 50 }] }
  ];
  const out = applySchema(three, 6);
  assert.equal(out.length, 6);
  assert.equal(out[0].items.length, 1);
  assert.equal(out[2].items.length, 1);
  assert.equal(out[5].items.length, 0);
});

test('назви завжди перезаписуються схемою', () => {
  const out = applySchema([{ name: 'Моя назва', items: [] }], 3);
  assert.equal(out[0].name, 'Сніданок');
});
