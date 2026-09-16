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
