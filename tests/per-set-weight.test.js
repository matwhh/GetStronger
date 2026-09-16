/**
 * Вага НАЛЕЖИТЬ ПІДХОДУ, а не вправі (js/workout-core.js, js/exercise-core.js).
 *
 * Живий баг, який це лагодить: знімок сесії збирався з ПОТОЧНОЇ книги ваг
 * на кожен дотик. Перший підхід на 100, потім людина міняє робочу вагу на
 * 90 — і в історію лягало «усі підходи по 90», хоч перший був 100.
 *
 * Під вартою:
 *   • тап фіксує вагу й повтори станом на ту мить;
 *   • пізніша зміна робочої ваги не переписує вже закриті підходи;
 *   • відкат ріже хвіст, а не весь запис;
 *   • сміття у полях (NaN, Infinity, відʼємне, поза межами) не проходить;
 *   • легасі-форми (число, true) читаються без втрат;
 *   • аналітика бере ТОП-сет і суму «вага × повтори», а не «одна вага».
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

/* reps-core тут не для повторень: workout-core делегує йому нормалізацію
   RIR підходу, і без нього performedSets падає з «Cannot read properties
   of undefined». На всіх чотирьох сторінках сайту він підключений перед
   workout-core, і за цим стежить перевірка 15 гігієни. */
const ctx = loadModules(['js/date-core.js', 'js/exercises.js', 'js/reps-core.js', 'js/workout-core.js']);
const W = ctx.WorkoutCore;

const ectx = loadModules(['js/date-core.js', 'js/onerm-core.js', 'js/exercise-core.js']);
const E = ectx.ExerciseCore;

/** Компактний вигляд списку підходів: '100x8,90x8' — масиви з vm не рівні */
function sig(list) {
  return list.map(function (x) {
    return (x.w == null ? '-' : x.w) + 'x' + (x.r == null ? '-' : x.r);
  }).join(',');
}

/* ------------------------------------------------------------------ */
describe('workout-core: нормалізація підходу', () => {
  it('вага: крок 0,5 кг у межах 0..500', () => {
    assert.equal(W.normWeight(100), 100);
    assert.equal(W.normWeight('82.4'), 82.5);
    assert.equal(W.normWeight(0), 0);           // вправа без ваги — не помилка
    assert.equal(W.normWeight(500), 500);
  });

  it('вага: сміття не проходить', () => {
    [NaN, Infinity, -Infinity, -1, 500.1, 'abc', null, undefined, {}, []]
      .forEach(function (v) { assert.equal(W.normWeight(v), null, String(v)); });
  });

  it('повтори: ціле 1..200', () => {
    assert.equal(W.normReps(8), 8);
    assert.equal(W.normReps('7.4'), 7);
    assert.equal(W.normReps(0), null);          // нуль повторень — не підхід
    assert.equal(W.normReps(201), null);
    [NaN, Infinity, -5, 'x', null].forEach(function (v) {
      assert.equal(W.normReps(v), null, String(v));
    });
  });
});

/* ------------------------------------------------------------------ */
describe('workout-core: закриття підходів', () => {
  it('тап фіксує поточну робочу вагу', () => {
    const a = W.setDoneSets(undefined, 1, 4, 100, 8);
    assert.equal(sig(a), '100x8');
  });

  it('ЗМІНА РОБОЧОЇ ВАГИ НЕ ПЕРЕПИСУЄ вже закриті підходи', () => {
    let done = W.setDoneSets(undefined, 1, 4, 100, 8);   // перший на 100
    done = W.setDoneSets(done, 2, 4, 90, 8);             // вагу впустили до 90
    done = W.setDoneSets(done, 3, 4, 90, 8);
    assert.equal(sig(done), '100x8,90x8,90x8');
  });

  it('відкат ріже хвіст і зберігає решту', () => {
    let done = W.setDoneSets(undefined, 3, 4, 100, 8);
    done = W.setDoneSets(done, 2, 4, 60, 8);   // тап по третьому — відкат
    assert.equal(sig(done), '100x8,100x8');
  });

  it('стеля — план; більше підходів, ніж заплановано, не буває', () => {
    assert.equal(W.setDoneSets(undefined, 9, 3, 50, 10).length, 3);
    assert.equal(W.setDoneSets(undefined, -4, 3, 50, 10).length, 0);
  });

  it('вправа без ваги в книзі: підходи є, ваги немає', () => {
    assert.equal(sig(W.setDoneSets(undefined, 2, 3, null, 12)), '-x12,-x12');
  });
});

/* ------------------------------------------------------------------ */
describe('workout-core: легасі-форми денного стану', () => {
  it('число розгортається у стільки ж підходів', () => {
    assert.equal(sig(W.performedSets(2, 4, 80, 10)), '80x10,80x10');
  });

  it('true = усі заплановані', () => {
    assert.equal(W.performedSets(true, 4, 80, 10).length, 4);
  });

  it('дотик до легасі-дня не втрачає вже зроблене', () => {
    const done = W.setDoneSets(2, 3, 4, 80, 10);
    assert.equal(sig(done), '80x10,80x10,80x10');
  });

  it('порожнє/сміття = нуль підходів', () => {
    [undefined, null, 0, false, 'x', NaN].forEach(function (v) {
      assert.equal(W.performedSets(v, 4, 80, 10).length, 0, String(v));
    });
  });
});

/* ------------------------------------------------------------------ */
describe('workout-core: правка окремого підходу', () => {
  const base = W.setDoneSets(undefined, 3, 4, 100, 8);

  it('міняє тільки свій підхід', () => {
    const out = W.editSet(base, 1, { w: 90 }, 4, 100, 8);
    assert.equal(sig(out), '100x8,90x8,100x8');
    assert.equal(sig(base), '100x8,100x8,100x8');   // вхід не мутовано
  });

  it('повтори теж правляться окремо', () => {
    assert.equal(sig(W.editSet(base, 2, { r: 5 }, 4, 100, 8)), '100x8,100x8,100x5');
  });

  it('порожнє поле = «успадкувати робочу вагу», а не нуль', () => {
    const out = W.editSet(base, 0, { w: '' }, 4, 100, 8);
    assert.equal(out[0].w, 100);
  });

  it('нуль — це саме нуль (вправа з власною вагою)', () => {
    assert.equal(W.editSet(base, 0, { w: 0 }, 4, 100, 8)[0].w, 0);
  });

  it('поза межами — запис не псується', () => {
    [700, -20, Infinity, NaN, 'abc'].forEach(function (v) {
      const out = W.editSet(base, 0, { w: v }, 4, 100, 8);
      assert.equal(out[0].w, 100, String(v));
    });
  });

  it('індекс поза списком нічого не змінює', () => {
    assert.equal(sig(W.editSet(base, 7, { w: 1 }, 4, 100, 8)), sig(base));
    assert.equal(sig(W.editSet(base, -1, { w: 1 }, 4, 100, 8)), sig(base));
  });
});

/* ------------------------------------------------------------------ */
/* Аналітика                                                           */
/* ------------------------------------------------------------------ */
const DROP = {
  n: 'Жим лежачи', ds: 3, ps: 3, kg: 100, r: 8,
  s: [{ w: 100, r: 8 }, { w: 90, r: 8 }, { w: 80, r: 10 }]
};
const LOG = {
  '2026-08-24': { ex: [{ n: 'Жим лежачи', ds: 3, ps: 3, kg: 95, r: 8 }] },  // легасі
  '2026-08-31': { ex: [DROP] }
};

describe('exercise-core: точка з фактичних підходів', () => {
  it('вага точки — НАЙВАЖЧИЙ підхід, а не останній', () => {
    assert.equal(E.pointOf('2026-08-31', DROP).kg, 100);
  });

  it('обʼєм — сума «вага × повтори» по кожному підходу', () => {
    // 100×8 + 90×8 + 80×10 = 800 + 720 + 800 = 2320
    assert.equal(E.pointOf('2026-08-31', DROP).vol, 2320);
  });

  it('повтори — сума фактичних, а не підходи × середина діапазону', () => {
    assert.equal(E.pointOf('2026-08-31', DROP).reps, 26);
  });

  it('перемикач «Підхід N» бере рівно один підхід', () => {
    const p2 = E.pointOf('2026-08-31', DROP, 2);
    assert.equal(p2.kg, 90);
    assert.equal(p2.sets, 1);
    assert.equal(p2.vol, 720);
  });

  it('немає такого підходу — немає точки', () => {
    assert.equal(E.pointOf('2026-08-31', DROP, 4), null);
  });

  it('легасі-знімок по підходах не розкладається', () => {
    const row = { n: 'Жим лежачи', ds: 3, ps: 3, kg: 95, r: 8 };
    assert.equal(E.pointOf('2026-08-24', row, 2), null);
    assert.equal(E.pointOf('2026-08-24', row).vol, 3 * 8 * 95);
  });

  it('стеля перемикача = найдовший знімок у вікні', () => {
    assert.equal(E.maxSetNo(LOG, 'Жим лежачи'), 3);
    assert.equal(E.maxSetNo(LOG, 'Жим лежачи', '2026-08-01', '2026-08-24'), 0);
  });

  it('серія по підходу 1 пропускає легасі-дні', () => {
    assert.equal(E.series(LOG, 'Жим лежачи', '', '', 1).length, 1);
    assert.equal(E.series(LOG, 'Жим лежачи').length, 2);
  });
});

describe('exercise-core: рекорди з фактично виконаного', () => {
  it('рекорд — найважчий ПІДНЯТИЙ підхід', () => {
    const pr = E.prFromSessions(LOG, 14, '2026-09-01');
    assert.equal(pr.length, 1);
    assert.equal(pr[0].name, 'Жим лежачи');
    assert.equal(pr[0].kg, 100);
    assert.equal(pr[0].date, '2026-08-31');
    assert.equal(pr[0].reps, 8);
    assert.equal(pr[0].isNew, true);
  });

  it('старий рекорд не позначається новим', () => {
    const pr = E.prFromSessions(LOG, 14, '2026-12-01');
    assert.equal(pr[0].isNew, false);
  });

  it('незакрита вправа рекордом не стає', () => {
    const log = { '2026-08-31': { ex: [{ n: 'Тяга', ds: 0, ps: 3, kg: 200, r: 5, s: [] }] } };
    assert.equal(E.prFromSessions(log, 14, '2026-09-01').length, 0);
  });

  it('порожній / кривий журнал не валить', () => {
    [null, undefined, 0, 'x', {}, { bad: 1 }].forEach(function (v) {
      assert.equal(E.prFromSessions(v, 14, '2026-09-01').length, 0);
    });
  });
});
