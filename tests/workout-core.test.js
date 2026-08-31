/**
 * Ядро тренувального дня (js/workout-core.js): підходи, тривалість,
 * тиждень і блокування завершених сесій.
 *
 * Це той модуль, від якого залежать одразу три речі з реальними грошима
 * довіри: «скільки хвилин залишилось», «чи можна почати цей день» і
 * «скільки підходів поїде в ELO». Тому тут перевіряється не рендер, а
 * арифметика на чистих даних — включно з легасі-формою денного стану
 * (булеві галочки замість чисел підходів).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

/* exercises.js дає liftKind/primaryMuscle/MUSCLES для restSecFor */
const ctx = loadModules(['js/exercises.js', 'js/workout-core.js']);
const WC = ctx.WorkoutCore;

/* Синтетичний день: складна велика (3 хв), ізоляція (2 хв), кругова («—»).
   lift задано явно ('compound'/'isolation' — значення бібліотеки): пошук
   за вигаданою назвою в EXERCISES дав би isolation для всього. */
const DAY = { title: 'Тест', exercises: [
  { name: 'Жим тест', muscles: ['chest'], lift: 'compound', sets: 4, reps: '6–8', rest: '3 хв' },
  { name: 'Розгинання тест', muscles: ['triceps'], lift: 'isolation', sets: 3, reps: '10–12', rest: '2 хв' },
  { name: 'Планка тест', muscles: ['core'], lift: 'isolation', sets: 2, reps: '30 с', rest: '—' }
] };

describe('workout-core: підходи', () => {
  it('plannedSets: ціле 0..10, сміття — нуль', () => {
    assert.equal(WC.plannedSets({ sets: 4 }), 4);
    assert.equal(WC.plannedSets({ sets: '3' }), 3);
    assert.equal(WC.plannedSets({ sets: 99 }), 10);
    assert.equal(WC.plannedSets({ sets: -2 }), 0);
    assert.equal(WC.plannedSets({ sets: 'abc' }), 0);
    assert.equal(WC.plannedSets({}), 0);
  });

  it('doneSetsFor: число клампиться до плану, легасі true = всі', () => {
    assert.equal(WC.doneSetsFor(2, 4), 2);
    assert.equal(WC.doneSetsFor(9, 4), 4);
    assert.equal(WC.doneSetsFor(-1, 4), 0);
    assert.equal(WC.doneSetsFor(true, 4), 4);   // стара галочка
    assert.equal(WC.doneSetsFor(false, 4), 0);
    assert.equal(WC.doneSetsFor(undefined, 4), 0);
    assert.equal(WC.doneSetsFor('сміття', 4), 0);
  });

  it('dayStats: вправа закрита лише ПОВНИМ набором підходів', () => {
    const st = WC.dayStats(DAY, [4, 1, 0]);
    assert.equal(st.totalSets, 9);
    assert.equal(st.doneSets, 5);
    assert.equal(st.totalEx, 3);
    assert.equal(st.doneEx, 1);   // лише жим: 4/4
  });

  it('dayStats на легасі-булевих: true рахується як повна вправа', () => {
    const st = WC.dayStats(DAY, [true, false, true]);
    assert.equal(st.doneSets, 6);   // 4 + 0 + 2
    assert.equal(st.doneEx, 2);
  });

  it('dayStats порожнього дня — нулі, не NaN', () => {
    /* Полями, не deepEqual: обʼєкт із vm-пісочниці має інший прототип */
    const st = WC.dayStats({ exercises: [] }, []);
    assert.equal(st.doneSets, 0);
    assert.equal(st.totalSets, 0);
    assert.equal(st.doneEx, 0);
    assert.equal(st.totalEx, 0);
  });
});

describe('workout-core: тривалість', () => {
  /* Та сама арифметика, що в js/programs.js → dayMinutes:
     Σ sets×(40 + rest) − останній rest, /60, + 10 хв розминки. */
  const FULL = Math.round((4 * (40 + 180) + 3 * (40 + 120) + 2 * (40 + 20) - 20) / 60) + 10;

  it('повний день — за формулою «Мого плану»', () => {
    assert.equal(WC.dayMinutes(DAY), FULL);
    assert.equal(WC.dayMinutes(DAY, []), FULL);
  });

  it('залишок меншає з кожним підходом і доходить до нуля', () => {
    let prev = WC.dayMinutes(DAY, []);
    const seq = [[1, 0, 0], [4, 0, 0], [4, 3, 0], [4, 3, 1], [4, 3, 2]];
    for (const done of seq) {
      const left = WC.dayMinutes(DAY, done);
      assert.ok(left < prev, done.join(',') + ': ' + left + ' < ' + prev);
      prev = left;
    }
    assert.equal(WC.dayMinutes(DAY, [4, 3, 2]), 0);
  });

  it('розминка входить лише поки не зроблено жодного підходу', () => {
    const untouched = WC.dayMinutes(DAY, [0, 0, 0]);
    const oneSet = WC.dayMinutes(DAY, [1, 0, 0]);
    // −10 хв розминки −(40+180) c підходу ≈ −14 хв
    assert.ok(untouched - oneSet >= 13, untouched + ' → ' + oneSet);
  });

  it('порожній день — нуль хвилин, а не сама розминка', () => {
    assert.equal(WC.dayMinutes({ exercises: [] }), 0);
  });
});

describe('workout-core: тиждень', () => {
  it('weekStartKey — понеділок локального ISO-тижня', () => {
    assert.equal(WC.weekStartKey('2026-08-31'), '2026-08-31');   // пн
    assert.equal(WC.weekStartKey('2026-09-01'), '2026-08-31');   // вт
    assert.equal(WC.weekStartKey('2026-09-06'), '2026-08-31');   // нд
    assert.equal(WC.weekStartKey('2026-09-07'), '2026-09-07');   // новий пн
  });

  it('weekStartKey через межу року', () => {
    assert.equal(WC.weekStartKey('2027-01-01'), '2026-12-28');   // пт → пн у грудні
  });

  it('addDaysKey рахує в локальному календарі', () => {
    assert.equal(WC.addDaysKey('2026-08-31', 6), '2026-09-06');
    assert.equal(WC.addDaysKey('2026-12-31', 1), '2027-01-01');
  });
});

describe('workout-core: блокування завершених сесій', () => {
  const profile = {
    activePlan: { programId: 'ppl', days: 6 },
    sessionLog: {
      // завершений понеділок цього тижня, день 0 активного плану
      '2026-08-31': { programId: 'ppl', days: 6, dayIdx: 0, done: 5, total: 5,
                      doneSets: 15, totalSets: 15, end: 1 },
      // незавершена сесія (без end) — НЕ блокує
      '2026-09-01': { programId: 'ppl', days: 6, dayIdx: 1, done: 2, total: 5 },
      // завершена, але МИНУЛОГО тижня — не блокує цей
      '2026-08-26': { programId: 'ppl', days: 6, dayIdx: 2, done: 5, total: 5, end: 1 },
      // завершена цього тижня, але ЧУЖОГО плану — не блокує активний
      '2026-09-02': { programId: 'fullbody', days: 3, dayIdx: 0, done: 4, total: 4, end: 1 }
    }
  };

  it('completedThisWeek: лише end + цей тиждень + активний план', () => {
    const week = WC.completedThisWeek(profile, '2026-09-03');
    assert.equal(Object.keys(week).length, 1);
    assert.equal(week[0], '2026-08-31');
  });

  it('наступного понеділка блокування знімається саме собою', () => {
    const week = WC.completedThisWeek(profile, '2026-09-07');
    assert.equal(Object.keys(week).length, 0);
  });

  it('completedToday: бачить end лише за сьогоднішньою датою', () => {
    assert.ok(WC.completedToday(profile, '2026-08-31'));
    assert.equal(WC.completedToday(profile, '2026-09-01'), null);  // без end
    assert.equal(WC.completedToday(profile, '2026-09-04'), null);
  });

  it('порожній профіль — нічого не заблоковано і нічого не падає', () => {
    assert.equal(Object.keys(WC.completedThisWeek({}, '2026-09-03')).length, 0);
    assert.equal(WC.completedToday(null, '2026-09-03'), null);
  });
});
