/**
 * Симулятор «що якщо» (js/nutrition-core.js: kcalOverride, tdeeBonus,
 * simulate).
 *
 * Прогноз маси вже вмів відповідати на питання «що буде за пів року при
 * МОЇЙ меті». Симулятор відповідає на інше: «а якби я їв 2600 замість
 * 2300» і «а якби я ходив у зал пʼять разів замість трьох». Це ті самі
 * два важелі, які людина справді має, і жодного іншого.
 *
 * Дві речі, які тут стережуть тести:
 *   • сценарій НЕ ламає запобіжників: підлога калорійності, межа ІМТ і
 *     стеля приросту сухої маси діють так само, як і в звичайному
 *     прогнозі;
 *   • зайве тренування — це ДЕЛЬТА витрат, а не переоснова: базовий
 *     коефіцієнт активності лишається на місці, інакше вийшов би
 *     подвійний рахунок (див. docs/ENGINEERING.md, розділ 24).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/date-core.js', 'js/tdee-core.js', 'js/nutrition-core.js']);
const N = ctx.NutritionCalc;

const BASE = {
  sex: 'male', age: 31, height: 181, weight: 82,
  activity: 1.55, goal: 'maintain', trainingAge: 'inter'
};

describe('симулятор: своя калорійність', () => {
  it('явне число перемагає мету з перемикача', () => {
    const t = N.targetFor(Object.assign({}, BASE, { goal: 'cut', kcalOverride: 2600 }));
    assert.equal(t.kcal, 2600);
    assert.equal(t.simulated, true, 'число має бути позначене як сценарій');
  });

  it('без числа все лишається як було', () => {
    const plain = N.targetFor(Object.assign({}, BASE, { goal: 'cut' }));
    const same = N.targetFor(Object.assign({}, BASE, { goal: 'cut', kcalOverride: null }));
    assert.equal(same.kcal, plain.kcal);
    assert.equal(same.simulated, false);
  });

  it('сміття ігнорується, а не ламає розрахунок', () => {
    ['', 'багато', NaN, -500, 0].forEach(function (v) {
      const t = N.targetFor(Object.assign({}, BASE, { kcalOverride: v }));
      assert.equal(t.simulated, false, String(v));
      assert.equal(t.kcal > 0, true, String(v));
    });
  });

  it('підлога калорійності діє і в сценарії', () => {
    const t = N.targetFor(Object.assign({}, BASE, { kcalOverride: 600 }));
    assert.equal(t.kcal >= t.bmr - 0.001, true, 'нижче базового обміну не буває');
    assert.equal(t.floored, true, 'і про це сказано прапорцем');
  });

  it('макроси рахуються від СЦЕНАРНОГО числа, а не від старої цілі', () => {
    const a = N.targetFor(Object.assign({}, BASE, { kcalOverride: 2000 }));
    const b = N.targetFor(Object.assign({}, BASE, { kcalOverride: 3200 }));
    assert.equal(b.carb > a.carb, true, a.carb + ' проти ' + b.carb);
  });
});

describe('симулятор: зайве тренування', () => {
  it('додаткові витрати роблять ту саму їжу дефіцитом', () => {
    const flat = N.massForecast(Object.assign({}, BASE, { kcalOverride: 2900 }), 6);
    const moved = N.massForecast(Object.assign({}, BASE, { kcalOverride: 2900, tdeeBonus: 250 }), 6);
    assert.equal(moved.totalKg < flat.totalKg, true,
      flat.totalKg + ' проти ' + moved.totalKg);
  });

  it('дельта витрат не чіпає базового коефіцієнта активності', () => {
    const t = N.targetFor(Object.assign({}, BASE, { tdeeBonus: 300 }));
    const plain = N.targetFor(BASE);
    assert.equal(Math.round(t.tdee - plain.tdee), 300, 'рівно дельта, не більше');
    assert.equal(t.formulaTdee, plain.formulaTdee, 'формульне число не переписується');
  });

  it('відʼємна й божевільна дельта не приймаються', () => {
    [-100, 5000, 'три', null].forEach(function (v) {
      const t = N.targetFor(Object.assign({}, BASE, { tdeeBonus: v }));
      assert.equal(t.tdee, N.targetFor(BASE).tdee, String(v));
    });
  });
});

describe('симулятор: підсумок сценарію', () => {
  it('віддає горизонти, склад приросту й дату цілі', () => {
    const r = N.simulate(BASE, { kcal: 2300, goalWeight: 78 });
    assert.equal(Array.isArray(r.rows), true);
    assert.equal(r.rows.length >= 2, true, JSON.stringify(r.rows && r.rows.length));
    assert.equal(r.rows[0].months < r.rows[r.rows.length - 1].months, true);
    assert.equal(r.eta && r.eta.reachable, true, JSON.stringify(r.eta));
    assert.equal(r.kcal, 2300);
  });

  it('на підтриманні вага стоїть, і ціль недосяжна чесно', () => {
    const maint = N.targetFor(BASE).tdee;
    const r = N.simulate(BASE, { kcal: Math.round(maint), goalWeight: 70 });
    assert.equal(Math.abs(r.rows[r.rows.length - 1].totalKg) < 1.5, true,
      JSON.stringify(r.rows[r.rows.length - 1]));
    assert.equal(r.eta.reachable, false, JSON.stringify(r.eta));
  });

  it('більший дефіцит — швидше до цілі', () => {
    const slow = N.simulate(BASE, { kcal: 2500, goalWeight: 78 });
    const fast = N.simulate(BASE, { kcal: 2100, goalWeight: 78 });
    assert.equal(fast.eta.months <= slow.eta.months, true,
      slow.eta.months + ' проти ' + fast.eta.months);
  });

  it('зайві тренування рахуються як витрати сценарію', () => {
    const a = N.simulate(BASE, { kcal: 2700, sessionsDelta: 0, perSession: 350 });
    const b = N.simulate(BASE, { kcal: 2700, sessionsDelta: 2, perSession: 350 });
    assert.equal(b.tdee > a.tdee, true, a.tdee + ' проти ' + b.tdee);
    assert.equal(Math.round(b.tdee - a.tdee), 100, 'дві сесії по 350 за тиждень = 100 на добу');
  });

  it('без профілю — null, а не вигаданий сценарій', () => {
    assert.equal(N.simulate({ weight: 80 }, { kcal: 2500 }), null);
    assert.equal(N.simulate(null, { kcal: 2500 }), null);
  });
});
