/**
 * Аналітика прогресу (js/progress-core.js).
 *
 * Функції детерміновані, тому дата «сьогодні» передається аргументом —
 * тести не залежать від дня запуску.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/history-core.js', 'js/progress-core.js']);
const P = ctx.ProgressCore;

const NOW = new Date(2026, 7, 17); // 17 серпня 2026, локально

describe('вага тіла', () => {
  const log = {
    '2026-06-01': 72.0, '2026-07-01': 71.0,
    '2026-08-03': 70.0, '2026-08-10': 69.6, '2026-08-17': 69.2,
    'сміття': 70, '2026-08-16': 500   // невалідні — ігноруються
  };

  it('період фільтрує записи, дельта й темп рахуються по періоду', () => {
    const s = P.bodyStats(log, 30, NOW);
    assert.equal(s.first, 70.0);
    assert.equal(s.current, 69.2);
    assert.equal(s.delta, -0.8);
    // 14 днів між 03.08 і 17.08 → −0,8 кг за 2 тижні → −0,4/тиж
    assert.equal(s.perWeek, -0.4);
    assert.equal(s.count, 3);
  });

  it('без періоду — вся історія', () => {
    const s = P.bodyStats(log, null, NOW);
    assert.equal(s.first, 72.0);
    assert.equal(s.delta, -2.8);
  });

  it('порожній журнал — null, а не NaN', () => {
    assert.equal(P.bodyStats({}, 30, NOW), null);
    assert.equal(P.bodyStats(null, 30, NOW), null);
  });
});

describe('прогноз проти факту', () => {
  // 4 тижні, старт 70 кг
  const log = {
    '2026-07-20': 70.0, '2026-07-27': 70.3,
    '2026-08-03': 70.8, '2026-08-10': 71.1, '2026-08-17': 71.4
  };

  it('набір: коридор і вердикт рахуються від якоря періоду', () => {
    const f = P.forecast(log, 'bulk', 90, NOW);
    assert.ok(f, 'прогноз має існувати');
    assert.equal(f.anchor.kg, 70.0);
    assert.equal(f.actual, 1.4);
    // 28 днів = 4 тижні: +0,25%/тиж ≈ +0,70 кг; +0,5%/тиж ≈ +1,41 кг
    assert.ok(f.expectLo >= 0.6 && f.expectLo <= 0.8, 'низ коридору ~0,7: ' + f.expectLo);
    assert.ok(f.expectHi >= 1.3 && f.expectHi <= 1.5, 'верх коридору ~1,4: ' + f.expectHi);
    assert.equal(f.verdict, 'within');
  });

  it('схуднення з тією самою динамікою — вердикт above', () => {
    const f = P.forecast(log, 'cut', 90, NOW);
    assert.equal(f.verdict, 'above');   // вага росла, а мала падати
    assert.ok(f.expectHi < 0, 'верх коридору cut відʼємний');
  });

  it('maintain — абсолютний коридор ±0,5 кг', () => {
    const f = P.forecast(log, 'maintain', 90, NOW);
    assert.equal(f.expectLo, -0.5);
    assert.equal(f.expectHi, 0.5);
    assert.equal(f.verdict, 'above');   // +1,4 кг — поза «стабільно»
  });

  it('чесні відмови: без цілі, мало точок, короткий період', () => {
    assert.equal(P.forecast(log, null, 90, NOW), null);
    assert.equal(P.forecast({ '2026-08-17': 70 }, 'bulk', 90, NOW), null);
    const short = { '2026-08-10': 70, '2026-08-13': 70.2, '2026-08-17': 70.3 };
    assert.equal(P.forecast(short, 'bulk', 90, NOW), null, '7 днів — ще не сигнал');
  });
});

describe('сила', () => {
  const wl = {
    'Жим': [
      { d: '2026-06-01', kg: 80 }, { d: '2026-07-01', kg: 85 },
      { d: '2026-07-15', kg: 76 },   // деолоад
      { d: '2026-08-10', kg: 90 }
    ],
    'Присід': [{ d: '2026-08-01', kg: 120 }]
  };

  it('liftStats: перша/остання/приріст/відсоток/рекорд', () => {
    const s = P.liftStats(wl, 'Жим');
    assert.equal(s.first, 80);
    assert.equal(s.last, 90);
    assert.equal(s.delta, 10);
    assert.equal(s.pct, 12.5);
    assert.equal(s.max, 90);
    assert.equal(s.isRecord, true);
  });

  it('єдиний запис — точка відліку, не рекорд', () => {
    const s = P.liftStats(wl, 'Присід');
    assert.equal(s.isRecord, false);
    assert.equal(s.delta, 0);
  });

  it('bestLift знаходить найбільший приріст за період', () => {
    const b = P.bestLift(wl, 60, NOW);   // з ~18 червня: база 80 (запис 01.06 до періоду)
    assert.equal(b.name, 'Жим');
    assert.equal(b.delta, 10);
  });
});

describe('тренування', () => {
  // NOW = понеділок 17.08.2026
  const work = { '2026-08-17': 1, '2026-08-14': 1, '2026-08-05': 1 };
  const sess = { '2026-08-12': { done: 5, total: 7 }, '2026-08-14': { done: 7, total: 7 } };

  it('обʼєднує workLog і sessionLog без подвійного рахунку', () => {
    const d = P.trainedDates(work, sess);
    assert.equal(d.length, 4);   // 05, 12, 14, 17
  });

  it('thisWeek рахує від понеділка', () => {
    const s = P.trainingStats(work, sess, 3, NOW);
    assert.equal(s.thisWeek, 1);   // лише 17.08 (понеділок)
    assert.equal(s.total, 4);
    assert.equal(s.adherence.planned, 18);
  });

  it('без плану adherence відсутній', () => {
    const s = P.trainingStats(work, sess, 0, NOW);
    assert.equal(s.adherence, null);
  });
});

describe('харчування', () => {
  const ml = {
    '2026-08-14': { kcal: 2900, p: 150, target: 2900 },   // рівно в ціль
    '2026-08-15': { kcal: 3300, p: 160, target: 2900 },   // +14% — повз
    '2026-08-16': { kcal: 2800, p: 140 }                  // без цілі
  };

  it('середні, ціль і частка «у межах» — лише серед днів із ціллю', () => {
    const s = P.foodStats(ml, 30, NOW);
    assert.equal(s.count, 3);
    assert.equal(s.avgKcal, 3000);
    assert.equal(s.avgP, 150);
    assert.equal(s.avgTarget, 2900);
    assert.equal(s.withTarget, 2);
    assert.equal(s.inTarget, 1);
  });

  it('порожній журнал — null', () => {
    assert.equal(P.foodStats({}, 30, NOW), null);
  });
});

/* =========================================================================
   Сесія без добитої вправи, але з підходами (етап відмітки по підходах).
   ========================================================================= */
describe('progress-core: сесія рахується за підходами', () => {
  it('sessionCounts: done=0, але doneSets>0 — тренування було', () => {
    assert.equal(P.sessionCounts({ done: 0, total: 14, doneSets: 4, totalSets: 34 }), true);
    assert.equal(P.sessionCounts({ done: 2, total: 14 }), true);          // стара форма
    assert.equal(P.sessionCounts({ done: 0, total: 14, doneSets: 0, totalSets: 34 }), false);
    assert.equal(P.sessionCounts(null), false);
    assert.equal(P.sessionCounts({}), false);
  });

  it('trainedDates бачить день, де закриті лише підходи', () => {
    const sess = { '2026-08-31': { done: 0, total: 14, doneSets: 4, totalSets: 34, end: 1 } };
    assert.deepEqual(P.trainedDates({}, sess), ['2026-08-31']);
  });

  it('явний 0 у workLog і далі перекриває таку сесію', () => {
    const sess = { '2026-08-31': { done: 0, total: 14, doneSets: 4, totalSets: 34 } };
    assert.deepEqual(P.trainedDates({ '2026-08-31': 0 }, sess), []);
  });
});
