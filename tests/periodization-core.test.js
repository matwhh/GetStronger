/**
 * Ядро циклу періодизації.
 *
 * Найцінніше тут — тести на межі циклу (перший і останній тиждень) і на
 * скидання ваг: саме навколо знімка «до скидання» в аудиті знайшлось
 * два способи мовчки втратити зароблені кілограми.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadPeriodization } from './helpers.js';

const P = loadPeriodization();

describe('межі налаштувань', () => {
  it('normalize утримує значення в дозволених діапазонах', () => {
    const c = P.normalize({ weeks: 100, startPct: 5, endPct: 200, cadence: 9 });
    assert.ok(c.weeks >= P.LIMITS.weeks[0] && c.weeks <= P.LIMITS.weeks[1]);
    assert.ok(c.startPct >= P.LIMITS.startPct[0] && c.startPct <= P.LIMITS.startPct[1]);
    assert.ok(c.endPct >= P.LIMITS.endPct[0] && c.endPct <= P.LIMITS.endPct[1]);
    assert.ok(c.cadence >= P.LIMITS.cadence[0] && c.cadence <= P.LIMITS.cadence[1]);
  });

  it('сміття на вході не дає NaN', () => {
    for (const bad of [null, undefined, NaN, Infinity, 'abc', {}, -1]) {
      const c = P.normalize({ weeks: bad, startPct: bad, endPct: bad, cadence: bad });
      for (const v of [c.weeks, c.startPct, c.endPct, c.cadence]) {
        assert.equal(Number.isFinite(v), true);
      }
    }
  });
});

describe('відсоток інтенсивності за тижнями', () => {
  it('перший тиждень дорівнює startPct, останній — endPct', () => {
    for (const weeks of [8, 9, 12, 13, 16]) {
      for (const cadence of [1, 2]) {
        const cfg = P.normalize({ weeks, cadence, startPct: 60, endPct: 90 });
        const first = P.pctForWeek(cfg, 1);
        const last = P.pctForWeek(cfg, weeks);
        assert.ok(Math.abs(first - 60) < 0.01, `тиждень 1 при weeks=${weeks}, cadence=${cadence}: ${first}`);
        assert.ok(Math.abs(last - 90) < 0.01, `тиждень ${weeks} при cadence=${cadence}: ${last}`);
      }
    }
  });

  it('відсоток ніколи не перевищує endPct і не падає нижче startPct', () => {
    for (const weeks of [8, 10, 12, 16]) {
      for (const cadence of [1, 2]) {
        const cfg = P.normalize({ weeks, cadence, startPct: 55, endPct: 92 });
        for (let w = 1; w <= weeks; w++) {
          const p = P.pctForWeek(cfg, w);
          assert.ok(p >= 55 - 0.01, `тиждень ${w}: ${p} < 55`);
          assert.ok(p <= 92 + 0.01, `тиждень ${w}: ${p} > 92`);
        }
      }
    }
  });

  it('не спадає від тижня до тижня', () => {
    const cfg = P.normalize({ weeks: 12, cadence: 2, startPct: 60, endPct: 90 });
    let prev = -1;
    for (let w = 1; w <= 12; w++) {
      const p = P.pctForWeek(cfg, w);
      assert.ok(p >= prev, `тиждень ${w} нижчий за попередній`);
      prev = p;
    }
  });
});

describe('поточний тиждень рахується календарними днями', () => {
  const iso = (d) => d.toISOString();

  it('регресія: цикл, запущений увечері, не перемикає тиждень усередині доби', () => {
    // Було: різниця бралась у мілісекундах від позначки ЧАСУ запуску,
    // тому цикл, стартований о 23:00, переходив у тиждень 2 о 23:00
    // сьомого дня — посеред тренування, а не вранці.
    const start = new Date(2026, 0, 1, 23, 0, 0);
    const cfg = P.normalize({ weeks: 12, startedAt: iso(start) });

    const day7morning = new Date(2026, 0, 7, 8, 0, 0);   // 7-й день, ранок
    const day8morning = new Date(2026, 0, 8, 8, 0, 0);   // 8-й день, ранок

    assert.equal(P.currentWeek(cfg, iso(day7morning)), 1);
    assert.equal(P.currentWeek(cfg, iso(day8morning)), 2);
  });

  it('день старту — це тиждень 1', () => {
    const start = new Date(2026, 2, 10, 6, 0, 0);
    const cfg = P.normalize({ weeks: 12, startedAt: iso(start) });
    assert.equal(P.currentWeek(cfg, iso(new Date(2026, 2, 10, 23, 59, 0))), 1);
  });

  it('після закінчення циклу — null', () => {
    const start = new Date(2026, 0, 1);
    const cfg = P.normalize({ weeks: 8, startedAt: iso(start) });
    assert.equal(P.currentWeek(cfg, iso(new Date(2026, 3, 1))), null);
  });

  it('без startedAt — null', () => {
    assert.equal(P.currentWeek(P.normalize({ weeks: 12 }), iso(new Date())), null);
  });
});

describe('крок округлення ваги', () => {
  it('ізоляція округлюється дрібніше за багатосуглобові', () => {
    // На махах з 10 кг крок у 2,5 кг був би чвертю ваги — саме тому
    // ROUND_STEP розділений за типом вправи. Прогноз на «Моєму плані»
    // раніше про це правило не знав і округляв усе до 2,5.
    assert.equal(P.ROUND_STEP.compound, 2.5);
    assert.equal(P.ROUND_STEP.isolation, 1);
  });
});

describe('скидання ваг', () => {
  it('скидає на заданий відсоток і округлює доречним кроком', () => {
    const before = { 'Жим штанги лежачи': 100, 'Махи з гантелями стоячи': 10 };
    const after = P.applyDeload(before, 10);
    assert.equal(after['Жим штанги лежачи'], 90);
    assert.equal(after['Махи з гантелями стоячи'], 9);
  });

  it('не чіпає порожні й некоректні значення', () => {
    const after = P.applyDeload({ a: null, b: 0, c: 'abc', d: 100 }, 10);
    assert.equal(after.d, 90);
    for (const k of ['a', 'b', 'c']) {
      assert.ok(after[k] === undefined || !Number.isFinite(after[k]) || after[k] === 0 || after[k] === null);
    }
  });
});
