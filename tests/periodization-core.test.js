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

  it('некоректні значення викидає, а не «якось» обробляє', () => {
    /*
     * TST-013: тут стояло `after[k] === undefined || !Number.isFinite(...) ||
     * after[k] === 0 || after[k] === null` — тобто приймалось майже будь-що,
     * включно з мовчазним нулем замість ваги. Точний вихід: непридатні
     * значення з мапи ЗНИКАЮТЬ (їх не можна ні показати, ні порахувати),
     * придатні — зменшуються з кроком 2,5 кг.
     */
    /* Порівнюємо через join: обʼєкти з пісочниці vm мають інший прототип,
       і deepStrictEqual падає навіть на однакових даних. */
    const after = P.applyDeload({ a: null, b: 0, c: 'abc', d: 100 }, 10);
    assert.equal(Object.keys(after).sort().join(','), 'd', 'мали лишитись лише придатні ваги');
    assert.equal(after.d, 90);

    const edge = P.applyDeload({ x: -5, y: NaN, z: '80' }, 10);
    assert.equal(Object.keys(edge).sort().join(','), 'z', 'відʼємне і NaN мали зникнути');
    assert.equal(edge.z, 70, 'рядок «80» читається як число і ріжеться до кроку 2,5');

    assert.equal(Object.keys(P.applyDeload({}, 10)).length, 0);
  });
});

/*
 * Побудова циклу, оцінка 1ПМ і підвищення (TST-007).
 *
 * Покриття було 58 %, і виживали три мутанти: знята стеля інтенсивності за
 * типом вправи (ізоляція йшла б до 90 % від 1ПМ замість 75 — це вже травма,
 * а не тренування), проігнорований заморожений 1ПМ (цикл «пливе» посеред
 * себе, щойно змінилась робоча вага) і RIR без стелі 5 (оцінка 1ПМ
 * задирається як завгодно високо).
 */
describe('buildCycle: стеля інтенсивності', () => {
  const ISO = { name: 'Махи гантелями в сторони', reps: '12–15', rir: 2, lift: 'isolation' };
  const COMP = { name: 'Присідання зі штангою', reps: '5', rir: 2, lift: 'compound' };
  const w = (name) => (name === COMP.name ? 100 : 10);

  it('ізоляція не піднімається вище 75 % від 1ПМ', () => {
    const c = P.buildCycle({ weeks: 6 }, [ISO], w, {});
    const row = c.rows[0];
    assert.equal(row.kind, 'isolation');
    assert.equal(row.ceiling, 75);
    row.cells.forEach(function (cell, i) {
      assert.ok(cell.pct <= 75, 'тиждень ' + (i + 1) + ': ' + cell.pct + ' %');
    });
    assert.ok(row.cells.some(function (cell) { return cell.capped; }),
      'на важких тижнях стеля має спрацьовувати, інакше тест нічого не стереже');
  });

  it('база доходить до 95 %, але не вище', () => {
    const c = P.buildCycle({ weeks: 6 }, [COMP], w, {});
    const row = c.rows[0];
    assert.equal(row.kind, 'compound');
    assert.equal(row.ceiling, 95);
    row.cells.forEach(function (cell) { assert.ok(cell.pct <= 95, String(cell.pct)); });
  });

  it('заморожений 1ПМ важливіший за книгу ваг', () => {
    /* Інакше цикл «попливе» посеред себе: змінилась робоча вага або
       спрацював деслоуд — і всі тижні перерахувались. */
    const c = P.buildCycle({ weeks: 4, oneRM: { [COMP.name]: 200 } }, [COMP], w, {});
    assert.equal(c.rows[0].oneRM, 200);
    assert.equal(c.rows[0].source, 'frozen');
  });

  it('вправа без ваги й без рекорду пропускається, а не рахується з нуля', () => {
    const c = P.buildCycle({ weeks: 4 }, [COMP], function () { return null; }, {});
    /* Масиви з пісочниці vm мають інший Array.prototype — порівнюємо вміст. */
    assert.equal(c.rows.length, 0);
    assert.equal(c.skipped.join(','), COMP.name);
  });
});

describe('estimateOneRM і planReps', () => {
  it('нижня межа діапазону, а не середина', () => {
    /* Правило живе в js/reps-core.js; тут лише делегат. Середина («6–8»
       → 7) давала число, якого немає в плані, і воно їхало в 1ПМ. */
    assert.equal(P.planReps('6–8'), 6);
    assert.equal(P.planReps('8'), 8);
    assert.equal(P.planReps('10-12'), 10);
    assert.equal(P.planReps('12–10'), 10, 'неохайний план не завищує обʼєм');
    assert.equal(P.planReps('30 с'), 30, 'число є — беремо його');
    assert.equal(P.planReps('—'), null);
    assert.equal(P.planReps(null), null);
  });

  it('оцінка 1ПМ бере з плану те саме число, що й екран тренування', () => {
    /* Друга копія розбору розійшлася б на першій правці — саме тому тут
       звіряється не конкретне число, а збіг із джерелом правила. */
    const ex = { name: 'Вправа без рекорду', reps: '6–8', rir: 0 };
    const low = P.estimateOneRM(ex, 100, {});
    const eight = P.estimateOneRM({ name: ex.name, reps: '6', rir: 0 }, 100, {});
    assert.equal(low.value, eight.value, '«6–8» має рахуватись як 6');
  });

  it('виміряний рекорд важливіший за оцінку', () => {
    const ex = { name: 'Присідання зі штангою', reps: '5', rir: 2 };
    const est = P.estimateOneRM(ex, 100, { squat: 180 });
    assert.equal(est.value, 180);
    assert.equal(est.source, 'record');
  });

  it('RIR має стелю 5: недосяжний запас не задирає 1ПМ як завгодно', () => {
    const ex = (rir) => ({ name: 'Вправа без рекорду', reps: '5', rir: rir });
    const a = P.estimateOneRM(ex(5), 100, {});
    const b = P.estimateOneRM(ex(20), 100, {});
    assert.equal(a.value, b.value, 'RIR 20 має рахуватись як 5');
    const c = P.estimateOneRM(ex(0), 100, {});
    assert.ok(c.value < a.value, 'без запасу оцінка 1ПМ нижча');
  });

  it('без ваги й без рекорду — нічого', () => {
    assert.equal(P.estimateOneRM({ name: 'X', reps: '5' }, null, {}), null);
    assert.equal(P.estimateOneRM({ name: 'X', reps: '5' }, 0, {}), null);
    assert.equal(P.estimateOneRM(null, 100, {}), null);
  });
});

describe('applyRaise — дзеркало applyDeload', () => {
  it('підвищення й скидання симетричні за формою', () => {
    const base = { 'Жим': 100, 'Присідання': 140 };
    const up = P.applyRaise(base, 10);
    const down = P.applyDeload(base, 10);
    assert.ok(up['Жим'] > base['Жим'], 'підвищення піднімає');
    assert.ok(down['Жим'] < base['Жим'], 'скидання опускає');
    /* Обидва округлюють ВНИЗ до кроку млинців: обіцяно «плюс 10 %», а не
       «плюс 10 % і трохи зверху». */
    assert.ok(up['Жим'] <= base['Жим'] * 1.1 + 1e-9, 'не більше за обіцяне');
    assert.ok(down['Жим'] <= base['Жим'] * 0.9 + 1e-9);
  });

  it('нуль відсотків нічого не міняє', () => {
    const base = { 'Жим': 100 };
    assert.equal(P.applyRaise(base, 0)['Жим'], 100);
  });

  it('чужі значення не псують книгу ваг', () => {
    const out = P.applyRaise({ 'Жим': 100, 'Сміття': 'ой' }, 10);
    assert.ok(Number.isFinite(out['Жим']));
  });
});
