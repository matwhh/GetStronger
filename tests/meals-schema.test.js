/**
 * Схема прийомів їжі — спільна для калькулятора й раціону.
 *
 * Головне, що тут перевіряється: при зменшенні кількості прийомів їжа
 * не зникає, а переїжджає в останній прийом. Це єдине місце, де зміна
 * налаштування на одній сторінці може мовчки видалити дані на іншій.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadNutrition, loadModules } from './helpers.js';
import { readFileSync } from 'node:fs';

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

/*
 * ПЕРЕВІРЯЄМО ПРОДАКШЕН-ФУНКЦІЮ (TST-002).
 *
 * Тут лежала КОПІЯ applySchema: js/meals.js тягне DOM і window.App, тож у
 * пісочницю не вантажиться. Сигнатури копії й оригіналу вже розійшлись
 * (count проти report), а сама функція не перевірялась узагалі — мутант,
 * що прибирає злиття прийомів, проходив усі 483 тести.
 *
 * Логіку винесено в js/day-core.js; js/meals.js лишив тонку обгортку, яка
 * лише підставляє назви зі схеми.
 */
const DC = loadModules(['js/date-core.js', 'js/day-core.js']).DayCore;
const applySchema = (meals, count, report) =>
  DC.applySchema(meals, NC.mealNames(count), report);

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

test('позиції понад стелю прийому не зникають мовчки', () => {
  /*
   * Властивість «жодна позиція не губиться» хибна за межею: 6 прийомів по
   * 20 позицій, зведені у 3, дають 100 зі 120. Стеля потрібна (той самий
   * ліміт стоїть у валідаторі імпорту), але втрату треба ПОКАЗУВАТИ —
   * інакше їжа зникає з дня без жодного слова.
   */
  const six = [1, 2, 3, 4, 5, 6].map(function (n) {
    return {
      name: 'x',
      items: Array.from({ length: 20 }, function (_, k) {
        return { kind: 'food', foodId: 'f' + n + '-' + k, grams: 100 };
      })
    };
  });

  const report = {};
  const out = applySchema(six, 3, report);
  const total = out.reduce(function (s2, m) { return s2 + m.items.length; }, 0);

  assert.equal(out.length, 3);
  assert.equal(DC.MEAL_ITEM_CAP, 60, 'стеля прийому — 60 позицій');
  assert.equal(total, 100, '20 + 20 + 60 = 100 зі 120');
  assert.equal(report.dropped, 20, 'втрату видно у звіті');
  assert.equal(report.moved, 60, 'три прибрані прийоми — це 60 позицій');
  assert.equal(report.into, out[2].name);
});

test('без втрат dropped дорівнює нулю', () => {
  const report = {};
  applySchema([{ name: 'a', items: [] }], 3, report);
  assert.equal(report.dropped, 0);
  assert.equal(report.moved, 0);
});

test('js/meals.js не тримає власної копії правила', () => {
  /* Копія розходиться тихо — саме так і сталося. */
  const src = readFileSync(new URL('../js/meals.js', import.meta.url), 'utf8');
  assert.ok(src.includes('window.DayCore.applySchema('), 'meals.js має кликати ядро');
  assert.ok(!/last\.items\s*=\s*last\.items\.slice\(0,\s*60\)/.test(src),
    'у meals.js знову зʼявилась власна стеля прийому');
});
