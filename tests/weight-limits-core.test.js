/**
 * СТЕЛЯ РОБОЧОЇ ВАГИ.
 *
 * Стережеться не «правильність» чисел — правильних тут не існує, це
 * практична межа з запасом. Стережеться те, що межа взагалі РІЗНА для
 * різних вправ і що вона не перетворилась назад на спільні 500.
 *
 * Спільні 500 і були вадою: 300 кг у махах гантелями проходили мовчки,
 * лягали в книгу ваг, звідти в тренування, історію та графіки — і
 * помилку помічали через тижні, коли графік уже не читався.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const W = loadModules(['js/exercises.js', 'js/weight-limits-core.js']);
const WL = W.WeightLimits;
const EXERCISES = W.EXERCISES;

describe('межа залежить від вправи', () => {
  test('присідання дозволяють більше, ніж махи гантелями', () => {
    assert.ok(WL.maxFor('Присідання зі штангою') > WL.maxFor('Махи з гантелями сидячи'),
      WL.maxFor('Присідання зі штангою') + ' проти ' + WL.maxFor('Махи з гантелями сидячи'));
  });

  test('ізоляція має нижчу стелю за базовий рух тієї самої групи', () => {
    /* Жим ногами й розгинання ніг — ті самі квадрицепси, але важіль
       інший, і ваги фізично різні. */
    assert.ok(WL.maxFor('Розгинання ніг') < WL.maxFor('Присідання зі штангою'));
  });

  test('шия — найнижча стеля в наборі', () => {
    const neck = WL.maxFor('Розгинання на шию');
    const all = EXERCISES.map((e) => WL.maxFor(e.name));
    assert.equal(neck, Math.min(...all), 'шия: ' + neck);
  });

  test('незнайома вправа дістає спільну стелю — старі назви з планів', () => {
    assert.equal(WL.maxFor('Вправа, якої немає в бібліотеці'), WL.FALLBACK);
    assert.equal(WL.maxFor(''), WL.FALLBACK);
    assert.equal(WL.maxFor(null), WL.FALLBACK);
  });

  /* deepEqual тут не годиться: модулі виконуються в пісочниці node:vm, і
     масив звідти має ІНШИЙ прототип Array, ніж літерал у тесті. Порівняння
     структур падає на однакових значеннях. Тому порівнюємо самі значення. */
  test('жодна вправа бібліотеки не лишилась зі спільними 500', () => {
    const stuck = EXERCISES.filter((e) => WL.maxFor(e.name) === WL.FALLBACK).map((e) => e.name);
    assert.equal(stuck.length, 0, 'без своєї межі: ' + stuck.join(', '));
  });

  test('усі межі — додатні числа', () => {
    for (const e of EXERCISES) {
      const m = WL.maxFor(e.name);
      assert.ok(Number.isFinite(m) && m > 0, e.name + ' → ' + m);
    }
  });
});

describe('перевірка введеного', () => {
  test('нормальна вага приймається', () => {
    const v = WL.check('Присідання зі штангою', '120');
    assert.equal(v.ok, true);
    assert.equal(v.kg, 120);
  });

  test('кома читається так само, як крапка', () => {
    const v = WL.check('Присідання зі штангою', '62,5');
    assert.equal(v.ok, true);
    assert.equal(v.kg, 62.5);
  });

  test('описка з зайвим нулем не проходить саме там, де вона помітна', () => {
    /* 300 у махах — описка; 300 у присіданні — просто сильна людина. */
    assert.equal(WL.check('Махи з гантелями сидячи', '300').ok, false);
    assert.equal(WL.check('Присідання зі штангою', '300').ok, true);
  });

  test('причина відмови названа', () => {
    assert.equal(WL.check('Махи з гантелями сидячи', '300').why, 'big');
    assert.equal(WL.check('Махи з гантелями сидячи', '-5').why, 'neg');
    assert.equal(WL.check('Махи з гантелями сидячи', 'важко').why, 'nan');
    assert.equal(WL.check('Махи з гантелями сидячи', '').why, 'nan');
  });

  test('повідомлення називає вправу і її межу', () => {
    const m = WL.message('Махи з гантелями сидячи');
    assert.match(m, /Махи з гантелями сидячи/);
    assert.match(m, new RegExp(String(WL.maxFor('Махи з гантелями сидячи'))));
  });
});
