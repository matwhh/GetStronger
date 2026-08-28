/**
 * Ядро разового максимуму.
 *
 * Кожен тест тут відповідає або канонічній формулі з літератури, або
 * конкретному дефекту, знайденому в аудиті. Другий випадок позначений
 * коментарем «регресія:» — щоб через рік було видно, що цей тест не
 * академічний, а стоїть на місці реальної помилки.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadOneRM } from './helpers.js';

const OneRM = loadOneRM();
const byId = (id) => OneRM.FORMULAS.find((f) => f.id === id);
const near = (v, expected, tol = 0.05) => assert.ok((Math.abs(v - expected)) < (tol), `Math.abs(v - expected) має бути < tol`);

describe('формули 1ПМ — звірка з канонічними', () => {
  const W = 100, R = 5;

  it('Epley: w(1 + r/30)', () => near(byId('epley').fn(W, R), 100 * (1 + 5 / 30)));
  it('Brzycki: 36w/(37 − r)', () => near(byId('brzycki').fn(W, R), 36 * 100 / (37 - 5)));
  it('Lombardi: w · r^0.1', () => near(byId('lombardi').fn(W, R), 100 * Math.pow(5, 0.1)));
  it("O'Conner: w(1 + 0.025r)", () => near(byId('oconner').fn(W, R), 100 * (1 + 0.025 * 5)));
  it('Lander: 100w/(101.3 − 2.67123r)', () => near(byId('lander').fn(W, R), 100 * 100 / (101.3 - 2.67123 * 5)));
  it('Wathen: 100w/(48.8 + 53.8·e^−0.075r)', () =>
    near(byId('wathen').fn(W, R), 100 * 100 / (48.8 + 53.8 * Math.exp(-0.075 * 5))));
  it('Mayhew: 100w/(52.2 + 41.9·e^−0.055r)', () =>
    near(byId('mayhew').fn(W, R), 100 * 100 / (52.2 + 41.9 * Math.exp(-0.055 * 5))));

  it('на 5 повтореннях усі сім дають 112–119 кг зі 100', () => {
    const vals = OneRM.FORMULAS.map((f) => f.fn(100, 5));
    assert.ok((Math.min(...vals)) > (112), `Math.min(...vals) має бути > 112`);
    assert.ok((Math.max(...vals)) < (119.5), `Math.max(...vals) має бути < 119.5`);
  });
});

describe('estimates — запобіжники', () => {
  it('регресія: 100 кг × 30 не дає 514 кг (Brzycki за межами валідності)', () => {
    // Аудит: калькулятор показував 514,3 кг як легітимну оцінку, бо
    // абсолютна межа MAX_WEIGHT*2 = 1000 кг таке значення пропускала.
    const vals = OneRM.estimates(100, 30).map((e) => e.value);
    assert.ok((Math.max(...vals)) <= (250), `Math.max(...vals) має бути <= 250`);
  });

  it('жодна оцінка не перевищує 2,5 ваги підходу', () => {
    for (let r = 1; r <= 20; r++) {
      for (const e of OneRM.estimates(100, r)) {
        assert.ok((e.value) <= (250), `e.value має бути <= 250`);
      }
    }
  });

  // Масиви приходять із vm-контексту, тому в них інший прототип —
  // deepEqual зі strict на цьому спотикається. Перевіряємо довжину:
  // тут важливо саме «нічого не повернулось», а не тип обгортки.
  it('вага понад MAX_WEIGHT відкидається', () => {
    assert.equal(OneRM.estimates(OneRM.MAX_WEIGHT + 1, 5).length, 0);
  });

  it('нуль і відʼємні на вході дають порожній набір', () => {
    assert.equal(OneRM.estimates(0, 5).length, 0);
    assert.equal(OneRM.estimates(100, 0).length, 0);
    assert.equal(OneRM.estimates(-100, 5).length, 0);
  });

  it('сміття на вході не дає NaN', () => {
    for (const bad of ['abc', null, undefined, NaN, Infinity, 1e308]) {
      for (const e of OneRM.estimates(bad, 5)) assert.equal(Number.isFinite(e.value), true);
      for (const e of OneRM.estimates(100, bad)) assert.equal(Number.isFinite(e.value), true);
    }
  });
});

describe('oneRepMax', () => {
  it('одне повторення — це і є разовий максимум', () => {
    assert.equal(OneRM.oneRepMax(100, 1), 100);
  });

  it('регресія: нуль повторень означає «підхід не зроблено», а не 1ПМ', () => {
    // Було: умова r <= 1 ловила і нуль, тож oneRepMax(100, 0) повертав 100.
    assert.equal(OneRM.oneRepMax(100, 0), null);
    assert.equal(OneRM.oneRepMax(100, -5), null);
  });

  it('медіана семи формул для 100 × 5 лежить у 116–117', () => {
    const v = OneRM.oneRepMax(100, 5);
    assert.ok((v) > (116), `v має бути > 116`);
    assert.ok((v) < (117.5), `v має бути < 117.5`);
  });

  it('зростає з кількістю повторень при тій самій вазі', () => {
    let prev = 0;
    for (let r = 1; r <= 12; r++) {
      const v = OneRM.oneRepMax(100, r);
      assert.ok((v) > (prev), `v має бути > prev`);
      prev = v;
    }
  });
});

describe('percentOfMax / repsAtPercent', () => {
  it('одне повторення — 100%', () => assert.equal(OneRM.percentOfMax(1), 100));

  it('відповідає підписам на сторінці періодизації', () => {
    const table = [[12, 12.2], [8, 7.9], [6, 5.9], [4, 4.0], [2, 2.2]];
    for (const [reps, expected] of table) {
      // percentOfMax(reps) -> repsAtPercent має повернутись назад
      near(OneRM.repsAtPercent(OneRM.percentOfMax(reps)), reps, 0.01);
      assert.ok((Math.abs(OneRM.repsAtPercent(OneRM.percentOfMax(reps)) - expected)) < (0.5), `Math.abs(OneRM.repsAtPercent(OneRM.percentOfMax(reps)) - expected) має бути < 0.5`);
    }
  });

  it('монотонно спадає', () => {
    let prev = 101;
    for (let r = 1; r <= 30; r++) {
      const p = OneRM.percentOfMax(r);
      assert.ok((p) < (prev), `p має бути < prev`);
      prev = p;
    }
  });

  it('repsAtPercent обертає percentOfMax', () => {
    for (let r = 2; r <= 20; r++) near(OneRM.repsAtPercent(OneRM.percentOfMax(r)), r, 0.01);
  });
});

describe('toPlates', () => {
  it('округлює до кроку млинців', () => {
    assert.equal(OneRM.toPlates(101.2, 2.5), 100);
    assert.equal(OneRM.toPlates(103.8, 2.5), 105);
    assert.equal(OneRM.toPlates(10.4, 1), 10);
  });
});

/*
 * Монотонність.
 *
 * Санітарний фільтр «оцінка не більша за 2,5 ваги підходу» стояв усередині
 * estimates(), тобто відсівав ОКРЕМІ формули. На 23 повтореннях одразу дві
 * (Brzycki і Lander) випадали разом: набір стрибав із семи на пʼять,
 * медіана міняла спосіб обчислення, і 1ПМ падав із 169,1 до 157,5 кг —
 * більше повторень давало менший максимум.
 */
describe('oneRepMax: монотонність за повтореннями', () => {
  it('оцінка не спадає зі зростанням повторень', () => {
    [20, 50, 100, 150, 200].forEach((w) => {
      let prev = null;
      for (let r = 1; r <= 35; r++) {
        const v = OneRM.oneRepMax(w, r);
        if (v === null) { prev = null; continue; }
        if (prev !== null) {
          assert.ok(v >= prev - 1e-9,
            'w=' + w + ' r=' + (r - 1) + '→' + r + ': ' + prev + ' → ' + v);
        }
        prev = v;
      }
    });
  });

  it('перехід 22→23 повторення більше не провалюється', () => {
    const a = OneRM.oneRepMax(100, 22);
    const b = OneRM.oneRepMax(100, 23);
    assert.ok(b >= a, '22: ' + a + ', 23: ' + b);
  });

  it('крайні значення лишились коректними', () => {
    assert.equal(OneRM.oneRepMax(100, 1), 100, 'один підйом — це і є максимум');
    assert.equal(OneRM.oneRepMax(100, 0), null);
    assert.equal(OneRM.oneRepMax(0, 5), null);
    assert.equal(OneRM.oneRepMax(100, -3), null);
  });
});
