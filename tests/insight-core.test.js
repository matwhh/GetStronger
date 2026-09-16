/**
 * «Що працює саме на тобі» (js/insight-core.js).
 *
 * Найцінніше тут — НЕ те, що модуль знаходить різницю, а те, коли він
 * відмовляється її називати: замало тижнів, усі тижні по один бік
 * медіани, різниця менша за розкид. Знахідка тут дорога — людина міняє
 * через неї поведінку, — тому й тести написані навколо мовчання.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules([
  'js/date-core.js', 'js/enough-core.js', 'js/history-core.js',
  'js/tracker-core.js', 'js/progress-core.js', 'js/insight-core.js'
]);
const I = ctx.InsightCore;

/* Понеділки поспіль. «Сьогодні» — у тижні після останнього, щоб усі
   перелічені тижні вважались завершеними. */
const MON = [
  '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22',
  '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20',
  '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17'
];
const TODAY = '2026-08-26';

const D = ctx.DateCore;
const day = (wk, i) => D.shiftKey(wk, i);

/** Профіль із трекером сну й книгою ваг по тижнях. */
function build(perWeek) {
  const p = {
    sessionLog: {}, workLog: {}, mealLog: {}, bodyLog: {},
    trackerLog: { sleep: {}, steps: {} }, weightLog: {}
  };
  const series = [];
  perWeek.forEach(function (w, wi) {
    const wk = MON[wi];
    if (w.sleep != null) {
      for (let i = 0; i < 5; i++) p.trackerLog.sleep[day(wk, i)] = w.sleep;
    }
    if (w.steps != null) {
      for (let i = 0; i < 5; i++) p.trackerLog.steps[day(wk, i)] = w.steps;
    }
    if (w.sets != null) {
      p.sessionLog[day(wk, 1)] = { done: 5, total: 5, doneSets: w.sets, totalSets: 20 };
    }
    if (w.protein != null) {
      for (let i = 0; i < 4; i++) {
        p.mealLog[day(wk, i)] = { kcal: 2400, p: w.protein ? 180 : 100, pTarget: 160 };
      }
    }
    if (w.body != null) {
      p.bodyLog[day(wk, 0)] = w.body;
      p.bodyLog[day(wk, 4)] = w.body;
    }
    for (let k = 0; k < (w.ups || 0); k++) {
      series.push({ wk, kg: k });
    }
  });
  /* Книга ваг: одна вправа, крок угору стільки разів, скільки треба. */
  let kg = 100;
  p.weightLog['Жим'] = [{ d: day(MON[0], 0), kg: kg }];
  perWeek.forEach(function (w, wi) {
    for (let k = 0; k < (w.ups || 0); k++) {
      kg += 2.5;
      p.weightLog['Жим'].push({ d: day(MON[wi], 2 + k), kg: kg });
    }
  });
  return p;
}

describe('тижні', () => {
  it('поточний тиждень не рахується — він ще триває', () => {
    const p = build([{ sets: 10 }, { sets: 10 }]);
    /* «Сьогодні» — у другому тижні: завершеним лишається лише перший. */
    const rows = I.weeks(p, day(MON[1], 3));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].week, MON[0]);
  });

  it('вага тіла береться як різниця СУСІДНІХ тижневих середніх', () => {
    const p = build([{ body: 80 }, { body: 79.5 }, { body: 79 }]);
    const rows = I.weeks(p, TODAY);
    assert.equal(rows[0].bodyDelta, null, 'першому тижню немає з чим порівняти');
    assert.ok(Math.abs(rows[1].bodyDelta + 0.5) < 1e-9);
    assert.ok(Math.abs(rows[2].bodyDelta + 0.5) < 1e-9);
  });

  it('розрив у журналі не стає «тижнем»', () => {
    const p = build([{ body: 80 }]);
    p.bodyLog[day(MON[5], 0)] = 78;
    p.bodyLog[day(MON[5], 4)] = 78;
    const rows = I.weeks(p, TODAY);
    const last = rows[rows.length - 1];
    assert.equal(last.week, MON[5]);
    assert.equal(last.bodyDelta, null, 'між тижнями місяць порожнечі');
  });

  it('нуль підйомів — це виміряний нуль, але лише з початку книги ваг', () => {
    const p = build([{ ups: 0 }, { ups: 1 }]);
    const rows = I.weeks(p, TODAY);
    assert.equal(rows[0].lifts, 0, 'книга почалась цього тижня');
    assert.equal(rows[1].lifts, 1);
  });

  it('швидкий запис без білка не рахується білковим днем', () => {
    const p = build([{}]);
    p.mealLog[day(MON[0], 0)] = { kcal: 2000, p: 0, pTarget: 160, partial: true };
    p.mealLog[day(MON[0], 1)] = { kcal: 2400, p: 180, pTarget: 160 };
    const rows = I.weeks(p, TODAY);
    assert.equal(rows[0].proteinHit, 1, 'приблизний день мав би дати 0,5');
  });
});

describe('мовчання, коли даних не досить', () => {
  const eight = (f) => Array.from({ length: 8 }, (_, i) => f(i));

  it('менше восьми тижнів — рівень thin, жодних чисел', () => {
    const p = build(eight(() => ({ sleep: 400, sets: 10 })).slice(0, 5));
    const r = I.compare(I.weeks(p, TODAY), 'sleep', 'setsPct');
    assert.equal(r.level, 'thin');
    assert.equal(r.high, undefined);
    assert.equal(r.weeks, 5);
  });

  it('жодного тижня — none, а не thin', () => {
    const r = I.compare([], 'sleep', 'setsPct');
    assert.equal(r.level, 'none');
  });

  it('усі тижні з однаковою причиною — ділити нічого', () => {
    const p = build(eight(() => ({ sleep: 420, sets: 10 })));
    const r = I.compare(I.weeks(p, TODAY), 'sleep', 'setsPct');
    assert.equal(r.level, 'thin');
    assert.equal(r.split, true, 'медіана злиплась — усі в один бік');
  });

  it('різниця менша за розкид — flat, а не знахідка', () => {
    /* Сон росте, підходи стрибають незалежно від нього. */
    const sets = [20, 8, 19, 9, 20, 8, 19, 9];
    const p = build(eight((i) => ({ sleep: 380 + i * 10, sets: sets[i] })));
    const r = I.compare(I.weeks(p, TODAY), 'sleep', 'setsPct');
    assert.equal(r.level, 'flat', 'шум видали за вплив');
    assert.ok(r.effect < I.MIN_EFFECT);
  });
});

describe('знахідка, коли вона справжня', () => {
  it('більше сну — більше закритих підходів', () => {
    const p = build([
      { sleep: 360, sets: 10 }, { sleep: 370, sets: 11 }, { sleep: 365, sets: 10 },
      { sleep: 375, sets: 12 },
      { sleep: 470, sets: 19 }, { sleep: 480, sets: 20 }, { sleep: 475, sets: 19 },
      { sleep: 485, sets: 20 }
    ]);
    const r = I.compare(I.weeks(p, TODAY), 'sleep', 'setsPct');
    assert.equal(r.level, 'ok');
    assert.equal(r.weeks, 8);
    assert.equal(r.high.n, 4);
    assert.equal(r.low.n, 4);
    assert.ok(r.delta > 0, 'напрямок: більше сну — більше підходів');
    assert.ok(r.high.avg > r.low.avg);
    assert.ok(r.high.driver > r.low.driver);
  });

  it('напрямок «менше — краще» теж видно: кроки й вага тіла', () => {
    /* Девʼять тижнів, а не вісім: у першого немає попереднього, тож
       зміни ваги в нього нема — і в порівняння він не потрапляє. */
    const p = build([
      { steps: 4000, body: 79.6 }, { steps: 4100, body: 80.0 }, { steps: 4200, body: 80.4 },
      { steps: 3900, body: 80.8 }, { steps: 4100, body: 81.2 },
      { steps: 12000, body: 80.9 }, { steps: 12500, body: 80.5 }, { steps: 11800, body: 80.1 },
      { steps: 12200, body: 79.7 }
    ]);
    const r = I.compare(I.weeks(p, TODAY), 'steps', 'bodyDelta');
    assert.equal(r.level, 'ok');
    assert.equal(r.weeks, 8, 'перший тиждень без попереднього не рахується');
    assert.ok(r.delta < 0, 'у тижні з більшими кроками вага падала');
  });

  it('наслідок, який не рухався жодного тижня, — це не «різниці немає»', () => {
    /* Книга ваг є, але за всі вісім тижнів жодна вправа не поважчала.
       Сказати «сон не впливає» тут означало б відповісти на питання,
       якого дані не чули. */
    const p = build(Array.from({ length: 8 }, (_, i) => ({ sleep: 360 + i * 20, ups: 0 })));
    const r = I.compare(I.weeks(p, TODAY), 'sleep', 'lifts');
    assert.equal(r.level, 'flat');
    assert.equal(r.still, true);
    assert.equal(r.value, 0);
    assert.equal(r.high, undefined, 'половин немає — порівнювати нічого');
  });

  it('невідоме не вдає виміряний нуль', () => {
    /* Number(null) — це 0. Тиждень без записаного білка не має
       потрапляти в порівняння як тиждень із нулем. */
    const p = build(Array.from({ length: 10 }, (_, i) => ({ sleep: 360 + i * 20, sets: 10 })));
    const r = I.compare(I.weeks(p, TODAY), 'proteinHit', 'setsPct');
    assert.equal(r.level, 'none', 'білка не вели жодного дня');
    assert.equal(r.weeks, 0);
  });

  it('findings повертає всі чотири пари, кожну зі своїм станом', () => {
    const p = build([{ sleep: 400, sets: 10 }]);
    const out = I.findings(p, TODAY);
    assert.equal(out.length, I.PAIRS.length);
    assert.deepEqual(out.map((x) => x.id).join(','),
      I.PAIRS.map((x) => x.id).join(','));
    out.forEach((x) => {
      assert.ok(['none', 'thin', 'flat', 'ok'].indexOf(x.level) !== -1, x.id + ': ' + x.level);
    });
  });
});
