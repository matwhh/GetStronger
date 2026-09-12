/**
 * ІМТ: розрахунок, категорія й КОЛИ ПРО ЦЕ ГОВОРИТИ.
 *
 * Єдине ядро проєкту, яке досі не мало жодного юніта, — і водночас
 * єдине, що торкається медичної теми. Помилка тут коштує не верстки:
 * зайве попередження про вагу — це неприємна розмова з людиною, яка про
 * неї не просила, а пропущене — навпаки.
 *
 * Стережеться три речі:
 *   1. арифметика й межі, за якими рахувати нема сенсу;
 *   2. пороги категорій ВООЗ — рівно на межі, а не «десь поруч»;
 *   3. підтвердження: попередження показується ОДИН раз на категорію, і
 *      повертається, коли категорія змінилась.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const B = loadModules(['js/bmi-core.js']).BmiCore;

describe('розрахунок', () => {
  test('рахує за формулою кг / м²', () => {
    assert.equal(B.bmi(80, 180), 24.7);
    assert.equal(B.bmi(60, 170), 20.8);
    assert.equal(B.bmi(100, 200), 25);
  });

  test('округлення до десятої, а не до цілого', () => {
    /* 24 і 25 — різні категорії. Округлення до цілого перекидало б людей
       з однієї в іншу на порожньому місці. */
    assert.equal(B.bmi(72.5, 172), 24.5);
  });

  test('нема з чого рахувати — null, а не NaN і не нуль', () => {
    for (const [w, h] of [[null, 180], [80, null], ['вісімдесят', 180], [80, 'метр'],
                          [NaN, 180], [undefined, undefined]]) {
      assert.equal(B.bmi(w, h), null, String(w) + '/' + String(h));
    }
  });

  test('нефізіологічні числа не рахуються', () => {
    /* Захист не від жарту, а від одруку в профілі: 8 кг або 18 см дали б
       «ІМТ 247» і попередження, яке нічого не означає. */
    assert.equal(B.bmi(8, 180), null, 'вага нижча за 20 кг');
    assert.equal(B.bmi(80, 18), null, 'зріст нижчий за 100 см');
    assert.equal(B.bmi(-80, 180), null);
    assert.equal(B.bmi(20, 100), 20, 'самі межі — ще рахуються');
  });
});

describe('категорії ВООЗ', () => {
  test('пороги стоять рівно там, де домовлено', () => {
    assert.equal(B.category(18.4), 'under');
    assert.equal(B.category(18.5), 'normal', 'межа належить нормі');
    assert.equal(B.category(24.9), 'normal');
    assert.equal(B.category(25), 'over', 'межа належить верхній категорії');
    assert.equal(B.category(29.9), 'over');
    assert.equal(B.category(30), 'obese');
  });

  test('порожнє не має категорії', () => {
    assert.equal(B.category(null), null);
    assert.equal(B.category(NaN), null);
    assert.equal(B.category('двадцять'), null);
  });

  test('у кожної категорії є людський підпис', () => {
    for (const c of ['under', 'normal', 'over', 'obese']) {
      assert.ok(B.CAT_LABEL[c] && B.CAT_LABEL[c].length > 5, c);
    }
  });
});

describe('тексти попереджень', () => {
  test('є для всіх категорій, крім норми', () => {
    for (const c of ['under', 'over', 'obese']) {
      assert.ok(B.WARN[c] && B.WARN[c].title && B.WARN[c].body, c);
    }
    assert.equal(B.WARN.normal, undefined, 'норму не коментуємо');
  });

  test('текст каже, що це НЕ діагноз', () => {
    /* Без цього речення попередження читається як медичний висновок,
       яким воно не є і бути не може. */
    for (const c of ['under', 'over']) {
      assert.match(B.WARN[c].body, /не є медичним сервісом/);
      assert.match(B.WARN[c].body, /скринінгов/);
    }
  });

  test('для високого ІМТ сказано про мʼязову масу', () => {
    /* У людини, яка рік ходить у зал, ІМТ завищений за побудовою — і
       мовчати про це в застосунку ДЛЯ ЗАЛУ означало б лякати дарма. */
    assert.match(B.WARN.over.body, /мʼязову масу/);
  });
});

describe('коли показувати', () => {
  const norm = B.bmi(70, 175);      // ~22.9
  const high = B.bmi(100, 175);     // ~32.7
  const low = B.bmi(45, 175);       // ~14.7

  test('норму не коментуємо ніколи', () => {
    assert.equal(B.shouldWarn(norm, null), false);
    assert.equal(B.shouldWarn(norm, { category: 'over' }), false);
  });

  test('без підтвердження — показуємо', () => {
    assert.equal(B.shouldWarn(high, null), true);
    assert.equal(B.shouldWarn(low, undefined), true);
  });

  test('та сама категорія вже підтверджена — мовчимо', () => {
    assert.equal(B.shouldWarn(high, B.ackFor(high)), false);
  });

  test('категорія ЗМІНИЛАСЬ — говоримо знову', () => {
    /* Людина підтвердила попередження про високий ІМТ, схудла нижче
       норми — це вже інша розмова, і стара галочка її не скасовує. */
    assert.equal(B.shouldWarn(low, B.ackFor(high)), true);
  });

  test('зіпсоване підтвердження не глушить попередження', () => {
    for (const bad of ['так', 42, [], true]) {
      assert.equal(B.shouldWarn(high, bad), true, String(bad));
    }
  });

  test('нема ІМТ — нема про що говорити', () => {
    assert.equal(B.shouldWarn(null, null), false);
  });
});

describe('підтвердження', () => {
  test('несе категорію, число й час', () => {
    const a = B.ackFor(B.bmi(100, 175));
    assert.equal(a.category, 'obese');
    assert.equal(typeof a.bmi, 'number');
    assert.match(a.at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('для порожнього ІМТ не вигадує категорії', () => {
    assert.equal(B.ackFor(null).category, null);
  });
});
