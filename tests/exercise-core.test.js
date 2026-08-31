/**
 * Прогрес окремої вправи (js/exercise-core.js).
 *
 * Під вартою:
 *   • точка = реальне тренування, а не зміна ваги в плані;
 *   • вправа без ваги не отримує вигаданий тоннаж і 1ПМ;
 *   • «поточне / попереднє / зміна / PR» рахуються по ОБРАНІЙ метриці;
 *   • тренд — по третинах серії, а не по двох сусідніх точках.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/onerm-core.js', 'js/exercise-core.js']);
const E = ctx.ExerciseCore;

/** Сесія зі знімком вправ */
function s(ex) { return { programId: 'p', days: 3, dayIdx: 0, done: 1, total: 3, end: 1, ex: ex }; }
const BENCH = (kg, ds, r) => ({ n: 'Жим лежачи', ds: ds, ps: 4, kg: kg, r: r });

const LOG = {
  '2026-08-10': s([BENCH(100, 4, 8), { n: 'Планка', ds: 3, ps: 3, r: 1 }]),
  '2026-08-17': s([BENCH(102.5, 4, 8)]),
  '2026-08-24': s([BENCH(105, 4, 8), { n: 'Тяга', ds: 3, ps: 3, kg: 80, r: 10 }]),
  '2026-08-31': s([BENCH(105, 2, 8)])          // недороблена сесія: 2 підходи
};

describe('exercise-core: серія', () => {
  it('точка на кожне тренування, у хронології', () => {
    const ser = E.series(LOG, 'Жим лежачи');
    assert.equal(ser.length, 4);
    /* join, не deepEqual: масиви з vm-пісочниці мають інший прототип */
    assert.equal(ser.map(p => p.d).join(','),
      '2026-08-10,2026-08-17,2026-08-24,2026-08-31');
  });

  it('метрики рахуються з ЗАКРИТИХ підходів, не з планових', () => {
    const last = E.series(LOG, 'Жим лежачи').pop();
    assert.equal(last.sets, 2);          // ds=2, хоч ps=4
    assert.equal(last.reps, 16);         // 2 × 8
    assert.equal(last.vol, 1680);        // 2 × 8 × 105
    assert.equal(last.kg, 105);
  });

  it('вправа без ваги: підходи й повтори є, тоннаж і 1ПМ — null/0', () => {
    const pl = E.series(LOG, 'Планка')[0];
    assert.equal(pl.sets, 3);
    assert.equal(pl.kg, null);
    assert.equal(pl.vol, 0);
    assert.equal(pl.e1rm, null);
  });

  it('пропущена вправа (ds=0) не дає точки', () => {
    const log = { '2026-09-01': s([{ n: 'Жим лежачи', ds: 0, ps: 4, kg: 100, r: 8 }]) };
    assert.equal(E.series(log, 'Жим лежачи').length, 0);
  });

  it('вікно періоду обрізає серію', () => {
    const ser = E.series(LOG, 'Жим лежачи', '2026-08-17', '2026-08-24');
    assert.equal(ser.map(p => p.d).join(','), '2026-08-17,2026-08-24');
  });

  it('назви — за свіжістю останнього тренування', () => {
    assert.equal(E.exerciseNames(LOG).join(','), 'Жим лежачи,Тяга,Планка');
  });

  it('порожній/битий журнал — порожньо, без падінь', () => {
    assert.equal(E.exerciseNames(null).length, 0);
    assert.equal(E.series({}, 'Жим лежачи').length, 0);
    assert.equal(E.series({ 'смітт': s([BENCH(100, 4, 8)]) }, 'Жим лежачи').length, 0);
  });

  it('e1RM росте разом із вагою при тих самих повтореннях', () => {
    const ser = E.series(LOG, 'Жим лежачи');
    assert.ok(ser[0].e1rm > 100, String(ser[0].e1rm));
    assert.ok(ser[2].e1rm > ser[0].e1rm, ser[0].e1rm + ' → ' + ser[2].e1rm);
  });
});

describe('exercise-core: підсумок', () => {
  const ser = E.series(LOG, 'Жим лежачи');

  it('вага: поточна, попередня, зміна, PR', () => {
    const st = E.stats(ser, 'kg');
    assert.equal(st.current, 105);
    assert.equal(st.previous, 105);
    assert.equal(st.delta, 0);
    assert.equal(st.pr, 105);
    assert.equal(st.count, 4);
  });

  it('обʼєм: остання сесія недороблена — падіння проти попередньої', () => {
    const st = E.stats(ser, 'vol');
    assert.equal(st.current, 1680);      // 2 × 8 × 105
    assert.equal(st.previous, 3360);     // 4 × 8 × 105
    assert.equal(st.delta, -1680);
    assert.equal(st.pct, -50);
    assert.equal(st.pr, 3360);
    assert.equal(st.prDate, '2026-08-24');
    assert.equal(st.isPr, false);
  });

  it('PR саме сьогодні позначається окремо', () => {
    const growing = E.series({
      '2026-08-10': s([BENCH(100, 4, 8)]),
      '2026-08-17': s([BENCH(110, 4, 8)])
    }, 'Жим лежачи');
    const st = E.stats(growing, 'kg');
    assert.equal(st.isPr, true);
    assert.equal(st.pct, 10);
  });

  it('метрика, якої немає в жодній точці, дає null (а не нуль)', () => {
    assert.equal(E.stats(E.series(LOG, 'Планка'), 'kg'), null);
    assert.equal(E.stats(E.series(LOG, 'Планка'), 'e1rm'), null);
    assert.ok(E.stats(E.series(LOG, 'Планка'), 'reps'));
  });

  it('одна точка: попереднього немає, зміна невідома', () => {
    const one = E.series({ '2026-08-10': s([BENCH(100, 4, 8)]) }, 'Жим лежачи');
    const st = E.stats(one, 'kg');
    assert.equal(st.previous, null);
    assert.equal(st.delta, null);
    assert.equal(st.pct, null);
    assert.equal(st.isPr, false);   // перший запис — не «рекорд»
  });

  it('порожня серія — null', () => {
    assert.equal(E.stats([], 'kg'), null);
    assert.equal(E.stats(null, 'kg'), null);
  });
});

describe('exercise-core: тренд', () => {
  const mk = (kgs) => {
    const log = {};
    kgs.forEach((kg, i) => { log['2026-07-' + String(i + 1).padStart(2, '0')] = s([BENCH(kg, 4, 8)]); });
    return E.series(log, 'Жим лежачи');
  };

  it('стабільне зростання — up', () => {
    assert.equal(E.trend(mk([100, 102, 105, 107, 110, 112]), 'kg'), 'up');
  });
  it('стабільне падіння — down', () => {
    assert.equal(E.trend(mk([110, 108, 105, 102, 100, 98]), 'kg'), 'down');
  });
  it('плато — flat', () => {
    assert.equal(E.trend(mk([100, 100, 101, 100, 100, 101]), 'kg'), 'flat');
  });
  it('один провал не робить тренд', () => {
    assert.equal(E.trend(mk([100, 102, 104, 90, 106, 108]), 'kg'), 'up');
  });
  it('менше трьох точок — тренду немає', () => {
    assert.equal(E.trend(mk([100, 110]), 'kg'), null);
  });
});
