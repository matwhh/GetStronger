/**
 * Перейменування вправи в реєстрі має доходити до людини.
 *
 * customPlans — заморожена копія плану, зроблена в редакторі, і вона
 * СИЛЬНІША за js/programs-data.js (див. js/workout-core.js: спершу
 * customPlans, потім реєстр). Тому сама лише правка назви у файлі даних
 * до власника такої копії не доходить: на екрані лишається стара назва,
 * а робоча вага, ключована назвою, висить під старим ключем.
 *
 * Ці тести стережуть міграцію 9 -> 10, яка переносить назву. Головне тут —
 * що ІСТОРІЯ ваг при переносі не зникає: вона ключована тією ж назвою.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, makeStorage } from './helpers.js';

/** Профіль версії 9 з правкою плану під старою назвою. */
function stored(extra) {
  return Object.assign({
    version: 9,
    customPlans: {
      'ulppl:5': [
        { title: 'Legs', exercises: [
          { name: 'Згинання ніг', sets: 3 },
          { name: 'Розгинання ніг', sets: 3 }
        ] }
      ],
      'women4:4': [
        { title: 'Pull', exercises: [{ name: 'Згинання ніг лежачи', sets: 4 }] }
      ]
    }
  }, extra || {});
}

const load = (raw) => loadStore({
  storage: makeStorage({ 'ib.profile': JSON.stringify(raw) }), local: true
}).Store.localProfile();

const namesIn = (p, key) => p.customPlans[key][0].exercises.map((e) => e.name).join(', ');

describe('перейменування вправи доїжджає до збережених правок', () => {
  test('стара назва в customPlans замінюється на нову', () => {
    const p = load(stored());
    assert.equal(namesIn(p, 'ulppl:5'), 'Згинання ніг сидячи, Розгинання ніг');
  });

  test('лежачий варіант теж стає сидячим', () => {
    assert.equal(namesIn(load(stored()), 'women4:4'), 'Згинання ніг сидячи');
  });

  test('схожа назва не зачеплена — заміна точна, не за підрядком', () => {
    /* «Розгинання ніг» містить «гинання ніг»: заміна за підрядком зіпсувала
       б зовсім іншу вправу. */
    const p = load(stored());
    assert.ok(namesIn(p, 'ulppl:5').includes('Розгинання ніг'));
  });

  test('версію піднято — міграція не крутиться щоразу', () => {
    assert.equal(load(stored()).version, 10);
  });

  test('решта плану недоторкана', () => {
    const p = load(stored());
    assert.equal(p.customPlans['ulppl:5'][0].title, 'Legs');
    assert.equal(p.customPlans['ulppl:5'][0].exercises[0].sets, 3);
  });
});

describe('робочі ваги переїжджають разом із назвою', () => {
  test('вага під старою назвою стає вагою під новою', () => {
    const p = load(stored({ weights: { 'Згинання ніг': 45 } }));
    assert.equal(p.weights['Згинання ніг сидячи'], 45);
    assert.equal(p.weights['Згинання ніг'], undefined);
  });

  test('якщо нова назва вже має вагу — виграє вона, а не стара', () => {
    const p = load(stored({ weights: { 'Згинання ніг': 45, 'Згинання ніг сидячи': 50 } }));
    assert.equal(p.weights['Згинання ніг сидячи'], 50);
    assert.equal(p.weights['Згинання ніг'], undefined);
  });

  test('ІСТОРІЯ ваг не втрачається — записи зливаються за датою', () => {
    const p = load(stored({
      weightLog: {
        'Згинання ніг': [{ d: '2026-01-01', kg: 40 }, { d: '2026-02-01', kg: 45 }],
        'Згинання ніг сидячи': [{ d: '2026-03-01', kg: 50 }]
      }
    }));
    const log = p.weightLog['Згинання ніг сидячи'];
    assert.equal(log.map((r) => r.d).join(', '), '2026-01-01, 2026-02-01, 2026-03-01');
    assert.equal(p.weightLog['Згинання ніг'], undefined);
  });

  test('при збігу дати виграє запис під НОВОЮ назвою', () => {
    const p = load(stored({
      weightLog: {
        'Згинання ніг': [{ d: '2026-03-01', kg: 40 }],
        'Згинання ніг лежачи': [{ d: '2026-03-01', kg: 42 }],
        'Згинання ніг сидячи': [{ d: '2026-03-01', kg: 50 }]
      }
    }));
    const log = p.weightLog['Згинання ніг сидячи'];
    assert.equal(log.length, 1);
    assert.equal(log[0].kg, 50);
  });

  test('історія тренувань не переписується', () => {
    /* sessionLog зберігає день і кількість вправ, а не назви — міграції
       там нічого робити, і вона нічого не має чіпати. */
    const raw = stored({ sessionLog: { '2026-08-28': { title: 'Upper', dayIdx: 0, total: 20, done: 1 } } });
    const p = load(raw);
    assert.deepEqual(Object.keys(p.sessionLog), ['2026-08-28']);
    assert.equal(p.sessionLog['2026-08-28'].total, 20);
  });
});

describe('міграція безпечна для сміття у сховищі', () => {
  test('порожній профіль не падає', () => {
    assert.equal(load({ version: 9 }).version, 10);
  });

  test('customPlans неправильної форми не валять читання', () => {
    for (const bad of [null, 42, 'рядок', [], { 'ppl:6': 'не масив' }, { 'ppl:6': [null, 7] }]) {
      const p = load({ version: 9, customPlans: bad });
      assert.equal(p.version, 10);
    }
  });

  test('профіль версії 10 повторно не мігрує', () => {
    const p = load(Object.assign(stored(), { version: 10 }));
    assert.equal(namesIn(p, 'ulppl:5'), 'Згинання ніг, Розгинання ніг');
  });
});
