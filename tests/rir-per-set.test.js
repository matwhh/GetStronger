/**
 * RIR НАЛЕЖИТЬ ПІДХОДУ (js/workout-core.js, js/history-core.js).
 *
 * До цього RIR існував лише в плані вправи — одне число на всі підходи,
 * і нічого не знало, що сталось насправді. Останній підхід, доведений до
 * відмови, і перший, зроблений із запасом у чотири повторення, лягали в
 * історію однаково.
 *
 * Головне правило, яке стереже цей файл: **q не вигадується**. Вагу й
 * повтори підхід успадковує від плану, коли їх не правили, — і це чесно,
 * бо вага справді та, що стоїть на штанзі. А RIR, підставлений із плану,
 * був би вигадкою: план каже «зупинись за два», а людина могла зробити
 * до відмови. Тому підхід без явно введеного числа РІР не має — і
 * аналітика рахує тільки ті підходи, де він є.
 *
 * Під вартою:
 *   • q зберігається в підході й переживає читання;
 *   • q не підставляється ні з плану, ні з сусіднього підходу;
 *   • нуль — це відповідь («до відмови»), а порожнє поле — прибрати;
 *   • сміття й значення поза межами не доходять до сховища.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/date-core.js', 'js/exercises.js', 'js/reps-core.js', 'js/workout-core.js']);
const W = ctx.WorkoutCore;

const hctx = loadModules(['js/date-core.js', 'js/history-core.js']);
const H = hctx.HistoryCore;

const ectx = loadModules(['js/date-core.js', 'js/onerm-core.js', 'js/exercise-core.js']);
const E = ectx.ExerciseCore;
const OR = ectx.OneRM;

const pctx = loadModules(['js/date-core.js', 'js/history-core.js', 'js/progress-core.js']);
const P = pctx.ProgressCore;

/** Компактний вигляд списку: '100x8@2,100x8@-' — масиви з vm не рівні */
function sig(list) {
  return list.map(function (x) {
    return (x.w == null ? '-' : x.w) + 'x' + (x.r == null ? '-' : x.r) +
           '@' + ('q' in x ? x.q : '-');
  }).join(',');
}

/* ------------------------------------------------------------------ */
describe('workout-core: RIR у виконаному підході', () => {
  it('число з запису доживає до читання', () => {
    const out = W.performedSets([{ w: 100, r: 8, q: 2 }], 3, 100, 8);
    assert.equal(out[0].q, 2);
  });

  it('нуль — це відповідь, а не порожнеча', () => {
    const out = W.performedSets([{ w: 100, r: 8, q: 0 }], 3, 100, 8);
    assert.equal(out[0].q, 0);
  });

  it('підхід без числа лишається без числа: q не успадковується', () => {
    const out = W.performedSets([{ w: 100, r: 8, q: 2 }, { w: 100, r: 8 }], 3, 100, 8);
    assert.equal(out[0].q, 2);
    assert.equal('q' in out[1], false, 'сусідній підхід не віддає свій RIR');
  });

  it('легасі-форми не отримують вигаданого RIR', () => {
    W.performedSets(3, 3, 100, 8).forEach(function (s, i) {
      assert.equal('q' in s, false, 'підхід ' + i);
    });
    W.performedSets(true, 2, 100, 8).forEach(function (s, i) {
      assert.equal('q' in s, false, 'підхід ' + i);
    });
  });

  it('сміття не проходить, а завелике число стає стелею', () => {
    assert.equal('q' in W.performedSets([{ w: 100, r: 8, q: 'abc' }], 1, 100, 8)[0], false);
    assert.equal('q' in W.performedSets([{ w: 100, r: 8, q: null }], 1, 100, 8)[0], false);
    assert.equal(W.performedSets([{ w: 100, r: 8, q: 9 }], 1, 100, 8)[0].q, 5);
    assert.equal(W.performedSets([{ w: 100, r: 8, q: -3 }], 1, 100, 8)[0].q, 0);
  });
});

/* ------------------------------------------------------------------ */
describe('workout-core: правка RIR окремого підходу', () => {
  const base = W.performedSets(3, 3, 100, 8);

  it('ставиться в один підхід і не тече в сусідні', () => {
    const out = W.editSet(base, 1, { q: 2 }, 3, 100, 8);
    assert.equal(sig(out), '100x8@-,100x8@2,100x8@-');
  });

  it('порожнє поле прибирає число, а не підставляє план', () => {
    const one = W.editSet(base, 0, { q: 3 }, 3, 100, 8);
    assert.equal(one[0].q, 3);
    const out = W.editSet(one, 0, { q: '' }, 3, 100, 8);
    assert.equal('q' in out[0], false);
  });

  it('нуль зберігається, а не читається як порожнє', () => {
    assert.equal(W.editSet(base, 0, { q: 0 }, 3, 100, 8)[0].q, 0);
  });

  it('правка RIR не чіпає вагу й повтори', () => {
    const one = W.editSet(base, 0, { w: 90, r: 5 }, 3, 100, 8);
    const out = W.editSet(one, 0, { q: 1 }, 3, 100, 8);
    assert.equal(sig(out.slice(0, 1)), '90x5@1');
  });

  it('дописані підходи не отримують RIR попередніх', () => {
    const one = W.editSet(base, 0, { q: 2 }, 3, 100, 8);
    const grown = W.setDoneSets(one, 3, 4, 100, 8);
    assert.equal(sig(grown), '100x8@2,100x8@-,100x8@-');
  });
});

/* ------------------------------------------------------------------ */
describe('history-core: RIR у знімку сесії', () => {
  const day = '2026-09-16';
  const session = {
    programId: 'p', days: 3, dayIdx: 0, title: 'День 1', done: 1, total: 1,
    ex: [{ n: 'Жим', ds: 3, ps: 3, s: [{ w: 100, r: 8, q: 2 }, { w: 100, r: 7, q: 0 }, { w: 100, r: 6 }] }]
  };

  it('число доїжджає до журналу', () => {
    const log = H.upsertSession({}, day, session);
    const s = log[day].ex[0].s;
    assert.equal(s[0].q, 2);
    assert.equal(s[1].q, 0, 'нуль не губиться');
    assert.equal('q' in s[2], false, 'чого не ввели, того не пишемо');
  });

  it('сміття й значення поза межами до сховища не доходять', () => {
    const bad = Object.assign({}, session, {
      ex: [{ n: 'Жим', ds: 4, ps: 4, s: [{ w: 100, r: 8, q: 9 }, { w: 100, r: 8, q: -1 },
                                         { w: 100, r: 8, q: 'два' }, { w: 100, r: 8, q: 2.4 }] }]
    });
    const s = H.upsertSession({}, day, bad)[day].ex[0].s;
    assert.equal('q' in s[0], false, '9 — поза межами');
    assert.equal('q' in s[1], false, 'відʼємне — поза межами');
    assert.equal('q' in s[2], false, 'не число');
    assert.equal(s[3].q, 2, 'дріб округлюється, як вага й повтори');
  });

  it('старий запис без q читається без втрат', () => {
    const old = Object.assign({}, session, {
      ex: [{ n: 'Жим', ds: 2, ps: 2, s: [{ w: 100, r: 8 }, { w: 100, r: 8 }] }]
    });
    const s = H.upsertSession({}, day, old)[day].ex[0].s;
    assert.equal(s.length, 2);
    assert.equal(s[0].w, 100);
    assert.equal('q' in s[0], false);
  });
});

/* ------------------------------------------------------------------ */
/*
 * ЩО RIR ОЗНАЧАЄ. Записане число має міняти висновки, інакше це поле
 * заради поля. Воно міняє два: оцінку разового максимуму (підхід із
 * запасом у два — це не межа людини) і відповідь на питання «чому вага
 * стоїть» (три тижні на RIR 4 — це не плато, це занадто легко).
 */
describe('exercise-core: RIR робить оцінку 1ПМ чесною', () => {
  it('підхід із запасом оцінюється як важчий, ніж він виглядає', () => {
    const plain = E.e1rmOf(100, 8);
    const rested = E.e1rmOf(100, 8, 2);
    assert.equal(rested > plain, true, plain + ' проти ' + rested);
    /* Вісім повторень із запасом у два — це десять до відмови, і
       формула має дати рівно стільки ж, скільки для десяти. */
    assert.equal(rested, E.e1rmOf(100, 10));
  });

  it('RIR 0 нічого не міняє — це і є відмова', () => {
    assert.equal(E.e1rmOf(100, 8, 0), E.e1rmOf(100, 8));
  });

  it('невідомий RIR не вигадується', () => {
    [null, undefined, '', 'два', NaN].forEach(function (q) {
      assert.equal(E.e1rmOf(100, 8, q), E.e1rmOf(100, 8), String(q));
    });
  });

  it('точка серії несе середній RIR або null', () => {
    const withQ = E.pointOf('2026-09-16',
      { n: 'Жим', ds: 3, ps: 3, s: [{ w: 100, r: 8, q: 2 }, { w: 100, r: 8, q: 1 }, { w: 100, r: 8 }] }, 0);
    assert.equal(withQ.rir, 1.5, 'середнє з тих підходів, де число є');
    assert.equal(withQ.rirSets, 2);

    const noQ = E.pointOf('2026-09-16',
      { n: 'Жим', ds: 2, ps: 2, s: [{ w: 100, r: 8 }, { w: 100, r: 8 }] }, 0);
    assert.equal(noQ.rir, null);
    assert.equal(noQ.rirSets, 0);
  });

  it('1ПМ точки рахується з урахуванням запасу підходу', () => {
    const p = E.pointOf('2026-09-16',
      { n: 'Жим', ds: 1, ps: 1, s: [{ w: 100, r: 8, q: 2 }] }, 0);
    assert.equal(p.e1rm, E.e1rmOf(100, 10));
  });

  it('легасі-знімок без підходів RIR не має', () => {
    const p = E.pointOf('2026-09-16', { n: 'Жим', ds: 3, ps: 3, kg: 100, r: 8 }, 0);
    assert.equal(p.rir, null);
    assert.equal(p.e1rm, E.e1rmOf(100, 8), 'оцінка та сама, що й була');
  });
});

/* ------------------------------------------------------------------ */
describe('progress-core: статистика запасу до відмови', () => {
  /* Три тренування жиму з великим запасом і одне присідання на нулі. */
  const log = {
    '2026-09-01': { done: 2, total: 2, ex: [
      { n: 'Жим', ds: 3, ps: 3, s: [{ w: 60, r: 8, q: 4 }, { w: 60, r: 8, q: 4 }, { w: 60, r: 8, q: 5 }] },
      { n: 'Присідання', ds: 2, ps: 2, s: [{ w: 100, r: 5, q: 0 }, { w: 100, r: 5, q: 0 }] }
    ] },
    '2026-09-08': { done: 2, total: 2, ex: [
      { n: 'Жим', ds: 3, ps: 3, s: [{ w: 60, r: 8, q: 4 }, { w: 60, r: 8, q: 3 }, { w: 60, r: 8, q: 4 }] },
      { n: 'Присідання', ds: 2, ps: 2, s: [{ w: 100, r: 5, q: 0 }, { w: 100, r: 5, q: 1 }] }
    ] },
    '2026-09-15': { done: 1, total: 2, ex: [
      { n: 'Жим', ds: 3, ps: 3, s: [{ w: 60, r: 8, q: 4 }, { w: 60, r: 8 }, { w: 60, r: 8, q: 4 }] }
    ] }
  };
  const NOW = new Date(2026, 8, 16);   // 16 вересня 2026

  it('рахує лише ті підходи, де число є', () => {
    const st = P.rirStats(log, 30, NOW);
    const jim = st.rows.filter(function (r) { return r.name === 'Жим'; })[0];
    assert.equal(jim.sets, 8, 'дев\'ятий підхід без числа не рахується');
    assert.equal(jim.total, 9);
  });

  it('великий середній запас позначається як «вага застара»', () => {
    const jim = P.rirStats(log, 30, NOW).rows.filter(function (r) { return r.name === 'Жим'; })[0];
    assert.equal(jim.avg, 4);
    assert.equal(jim.flag, 'light');
  });

  it('підходи до відмови позначаються окремо', () => {
    const sq = P.rirStats(log, 30, NOW).rows.filter(function (r) { return r.name === 'Присідання'; })[0];
    assert.equal(sq.zero, 3);
    assert.equal(sq.flag, 'hard');
  });

  it('мало підходів — не висновок, а випадковість', () => {
    const thin = { '2026-09-15': { ex: [{ n: 'Тяга', ds: 2, ps: 2, s: [{ w: 80, r: 8, q: 5 }, { w: 80, r: 8, q: 5 }] }] } };
    const row = P.rirStats(thin, 30, NOW).rows[0];
    assert.equal(row.avg, 5);
    assert.equal(row.flag, null, 'двох підходів замало для висновку');
  });

  it('журнал без жодного RIR не вигадує рядків', () => {
    const blank = { '2026-09-15': { ex: [{ n: 'Тяга', ds: 2, ps: 2, s: [{ w: 80, r: 8 }] }] } };
    const st = P.rirStats(blank, 30, NOW);
    assert.equal(st.rows.length, 0);
    assert.equal(st.sets, 0);
  });

  it('період відрізає старе', () => {
    const st = P.rirStats(log, 7, NOW);
    const jim = st.rows.filter(function (r) { return r.name === 'Жим'; })[0];
    assert.equal(jim.sets, 2, 'лише тренування 15 вересня');
    assert.equal(st.rows.length, 1, 'присідань у вікні немає');
  });

  it('сміття в журналі не ламає підрахунку', () => {
    const junk = { 'вчора': { ex: 'ні' }, '2026-09-15': { ex: [{ n: '', ds: 2, ps: 2, s: [{ q: 2 }] }] } };
    const st = P.rirStats(junk, 30, NOW);
    assert.equal(st.rows.length, 0);
  });
});

