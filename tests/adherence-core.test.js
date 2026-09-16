/**
 * Виконання плану (js/adherence-core.js): відсотки тренувань і харчування.
 *
 * Головні властивості під вартою:
 *   • приклад ТЗ: 10/10 + 7/10 + 10/10 при плані 3/тиж = 90%;
 *   • пропущене тренування — нуль, а не «не рахується»;
 *   • перебір калорій НЕ дає >100% (нормалізація, не actual/target);
 *   • період обрізається до першого запису — рік не розмиває тиждень даних;
 *   • «нема даних» — окремий стан, а не 0%.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/date-core.js', 'js/elo-core.js', 'js/adherence-core.js']);
const A = ctx.AdherenceCore;

const T = '2026-09-20';   // неділя; вікно тижня: 14–20.09

function prof(sessions, meals, days) {
  return { activePlan: { days: days || 3 }, sessionLog: sessions || {}, mealLog: meals || {} };
}
function sess(ds, ts) { return { programId: 'p', days: 3, dayIdx: 0, done: 0, total: 5, doneSets: ds, totalSets: ts, end: 1 }; }

describe('adherence: тренування', () => {
  it('приклад ТЗ: 100% + 70% + 100% при плані 3 = 90%', () => {
    const p = prof({
      '2026-09-14': sess(10, 10),
      '2026-09-16': sess(7, 10),
      '2026-09-18': sess(10, 10)
    });
    const r = A.trainingAdherence(p, T, 7);
    assert.equal(r.state, 'ok');
    assert.equal(r.pct, 90);
    assert.equal(r.sessions, 3);
  });

  it('пропуск важить нуль: 2 повні сесії з 3 запланованих = 67%', () => {
    const p = prof({ '2026-09-14': sess(10, 10), '2026-09-16': sess(10, 10) });
    const r = A.trainingAdherence(p, T, 7);
    assert.equal(r.pct, 67);
  });

  it('сам факт «Завершити» не дає 100%: 1/10 підходів = 10% сесії', () => {
    const p = prof({ '2026-09-14': sess(1, 10), '2026-09-16': sess(10, 10), '2026-09-18': sess(10, 10) });
    const r = A.trainingAdherence(p, T, 7);
    assert.equal(r.pct, 70);   // (0.1+1+1)/3
  });

  it('старі записи без підходів рахуються по вправах', () => {
    const p = prof({ '2026-09-14': { done: 4, total: 5 } });
    const r = A.trainingAdherence(p, T, 7);
    // 0.8 сесії з 3 запланованих (повний тиждень даних)
    assert.equal(r.pct, 27);
  });

  it('понад план капиться у 100, а не росте далі', () => {
    const p = prof({
      '2026-09-14': sess(10, 10), '2026-09-15': sess(10, 10),
      '2026-09-16': sess(10, 10), '2026-09-17': sess(10, 10),
      '2026-09-18': sess(10, 10)
    });
    assert.equal(A.trainingAdherence(p, T, 7).pct, 100);
  });

  it('рік не розмивається: перший запис тиждень тому — знаменник із тижня', () => {
    const p = prof({ '2026-09-14': sess(10, 10), '2026-09-16': sess(10, 10), '2026-09-18': sess(10, 10) });
    const y = A.trainingAdherence(p, T, 365);
    assert.equal(y.pct, 100);
    assert.equal(y.effDays, 7);
  });

  it('стани: без плану, без даних, день без сесії', () => {
    assert.equal(A.trainingAdherence({ sessionLog: {} }, T, 7).state, 'noplan');
    assert.equal(A.trainingAdherence(prof({}), T, 7).state, 'nodata');
    assert.equal(A.trainingAdherence(prof({ '2026-09-14': sess(5, 10) }), T, 1).state, 'resttoday');
  });

  it('день із сесією: відсоток саме цієї сесії', () => {
    const p = prof({ '2026-09-20': sess(6, 10) });
    const r = A.trainingAdherence(p, T, 1);
    assert.equal(r.state, 'ok');
    assert.equal(r.pct, 60);
  });
});

describe('adherence: харчування', () => {
  const meal = (kcal, target, pr, pt) => ({ kcal: kcal, target: target, p: pr, pTarget: pt });

  it('ідеальне попадання = 100%', () => {
    const p = prof({}, { '2026-09-19': meal(2500, 2500, 160, 160) });
    const r = A.nutritionAdherence(p, T, 7);
    assert.equal(r.state, 'ok');
    assert.equal(r.pct, 100);
  });

  it('4000 при цілі 2500 — НЕ 160%, а мала якість', () => {
    const p = prof({}, { '2026-09-19': meal(4000, 2500, 160, 160) });
    const r = A.nutritionAdherence(p, T, 7);
    assert.ok(r.pct <= 55, r.pct + '%');   // 60% відхилення калорій: зона 0.05×0.55 + білок 0.45
  });

  it('легкий недобір: рівно за tolerance-зонами (0.82×0.55 + 0.5×0.45 = 68%)', () => {
    const p = prof({}, { '2026-09-19': meal(2400, 2500, 150, 160) });
    const r = A.nutritionAdherence(p, T, 7);
    assert.equal(r.pct, 68);   // пін дзеркала зон: зміниться баланс — тест скаже
  });

  it('незакритий день у вікні важить нуль', () => {
    const p = prof({}, {
      '2026-09-18': meal(2500, 2500, 160, 160)
      // 19-те і 20-те (сьогодні) порожні; сьогодні не рахується — день триває
    });
    const r = A.nutritionAdherence(p, T, 7);
    assert.equal(r.counted, 2);            // 18-те і 19-те
    assert.equal(r.pct, 50);               // (1 + 0) / 2
  });

  it('старий запис без pTarget: калорії беруть усю вагу', () => {
    const p = prof({}, { '2026-09-19': { kcal: 2500, target: 2500, p: 0 } });
    assert.equal(A.nutritionAdherence(p, T, 7).pct, 100);
  });

  it('стани: без даних і відкритий сьогоднішній день', () => {
    assert.equal(A.nutritionAdherence(prof({}, {}), T, 7).state, 'nodata');
    const open = prof({}, { '2026-09-19': meal(2500, 2500, 160, 160) });
    assert.equal(A.nutritionAdherence(open, T, 1).state, 'openday');
  });

  it('день, закритий сьогодні, дає відсоток дня', () => {
    const p = prof({}, { '2026-09-20': meal(2500, 2500, 160, 160) });
    const r = A.nutritionAdherence(p, T, 1);
    assert.equal(r.pct, 100);
  });

  it('ціль береться з ЗАПИСУ дня, а не з поточного профілю', () => {
    // Той самий kcal при різних записаних цілях — різна якість.
    const good = A.nutritionAdherence(prof({}, { '2026-09-19': meal(2000, 2000, 0, 0) }), T, 7).pct;
    const bad = A.nutritionAdherence(prof({}, { '2026-09-19': meal(2000, 3000, 0, 0) }), T, 7).pct;
    assert.ok(good > bad, good + ' > ' + bad);
  });
});

describe('adherence: дати', () => {
  it('addDays через межі місяця й року', () => {
    assert.equal(A.addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(A.addDays('2026-08-31', 1), '2026-09-01');
  });
  it('diffDays симетричний і точний', () => {
    assert.equal(A.diffDays('2026-09-14', '2026-09-20'), 6);
    assert.equal(A.diffDays('2026-09-20', '2026-09-14'), -6);
  });
  it('diffDays відповідає DateCore день у день', () => {
    /* Своя копія рахувала в місцевих мілісекундах — у добу переходу на
       літній час це 23 години замість 24. Що копії більше немає, стереже
       tools/ci-hygiene.mjs (перевірка 14); тут — сам контракт. */
    const D = ctx.DateCore;
    for (const [a, b] of [['2026-03-28', '2026-03-30'], ['2025-12-31', '2026-01-02'],
                          ['2026-10-24', '2026-10-27'], ['2026-09-20', '2026-09-14']]) {
      assert.equal(A.diffDays(a, b), D.daysBetween(a, b), a + ' → ' + b);
    }
    assert.equal(A.diffDays('сміття', '2026-01-01'), 0, 'сміття — нуль, не порожнеча');
  });
  it('firstDate ігнорує сміттєві ключі', () => {
    assert.equal(A.firstDate({ 'x': 1, '2026-09-02': 1, '2026-09-01': 1 }), '2026-09-01');
    assert.equal(A.firstDate({}), null);
  });
});

describe('adherence: перші дні ведення', () => {
  it('2 дні даних, план 5/тиж, одне повне тренування = 100 %, а не 70', () => {
    const p = prof({ '2026-09-20': sess(29, 29) }, {}, 5);
    p.sessionLog['2026-09-19'] = { programId: 'p', days: 5, dayIdx: 0, done: 0, total: 5, doneSets: 0, totalSets: 29 };
    const r = A.trainingAdherence(p, T, 30);
    assert.equal(r.effDays, 2);
    assert.equal(r.expected, 1);
    assert.equal(r.pct, 100);
  });
  it('очікувані сесії — ціле число і не менше однієї', () => {
    const p = prof({ '2026-09-20': sess(10, 10) }, {}, 3);
    const r = A.trainingAdherence(p, T, 90);
    assert.equal(r.expected, 1);
    assert.equal(r.pct, 100);
  });
  it('повний тиждень — знаменник той самий, що й раніше', () => {
    const p = prof({ '2026-09-14': sess(10, 10) });
    assert.equal(A.trainingAdherence(p, T, 7).expected, 3);
  });
});
