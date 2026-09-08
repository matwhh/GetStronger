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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore, makeStorage } from './helpers.js';

/* Поточна версія форми даних — із самого store.js, а не переписана сюди:
   інакше тест сперечався б із кодом при кожній новій міграції. */
const SCHEMA_VERSION = Number(
  /const SCHEMA_VERSION = (\d+);/.exec(
    fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'store.js'), 'utf8')
  )[1]);

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
    /* Число тут навмисно не 10: профіль доходить до ПОТОЧНОЇ версії, і
       кожна наступна міграція має його підхопити. Прибите 10 змусило б
       правити тест при кожному кроці схеми — і саме так тест перетворюється
       на перешкоду замість сторожа. */
    assert.equal(load(stored()).version, SCHEMA_VERSION);
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

describe('10 -> 11: русизм у назві вправи (TXT-001)', () => {
  /* «Ягодичний міст» — калька з російської. Назва вправи є КЛЮЧЕМ книги
     ваг і історії, тож правка рядка в js/exercises.js без міграції лишила
     б вагу під старим ключем: на екрані нова назва з порожнім полем. */
  function stored10() {
    return {
      version: 10,
      customPlans: { 'women4:4': [{ title: 'Legs', exercises: [
        { name: 'Ягодичний міст у тренажері', sets: 3 },
        { name: 'Румунська тяга', sets: 3 }
      ] }] },
      weights: { 'Ягодичний міст у тренажері': 60, 'Румунська тяга': 50 },
      weightLog: { 'Ягодичний міст у тренажері': [{ d: '2026-08-01', kg: 55 },
                                                  { d: '2026-08-20', kg: 60 }] }
    };
  }

  test('назва в збереженому плані переїхала', () => {
    const p = load(stored10());
    const names = p.customPlans['women4:4'][0].exercises.map((e) => e.name);
    assert.ok(names.includes('Сідничний міст у тренажері'), names.join(', '));
    assert.ok(!names.includes('Ягодичний міст у тренажері'));
  });

  test('поточна вага переїхала разом із назвою', () => {
    const p = load(stored10());
    assert.equal(p.weights['Сідничний міст у тренажері'], 60);
    assert.equal(p.weights['Ягодичний міст у тренажері'], undefined);
    assert.equal(p.weights['Румунська тяга'], 50, 'сусідню вправу не зачепило');
  });

  test('історія ваг не втрачена', () => {
    const p = load(stored10());
    const log = p.weightLog['Сідничний міст у тренажері'];
    assert.equal(log.length, 2, 'обидва записи мали переїхати');
    assert.equal(log[1].kg, 60);
    assert.equal(p.weightLog['Ягодичний міст у тренажері'], undefined);
  });

  test('версія піднялась до поточної', () => {
    assert.equal(load(stored10()).version, SCHEMA_VERSION);
  });
});

describe('міграція безпечна для сміття у сховищі', () => {
  test('порожній профіль не падає', () => {
    assert.equal(load({ version: 9 }).version, SCHEMA_VERSION);
  });

  test('customPlans неправильної форми не валять читання', () => {
    for (const bad of [null, 42, 'рядок', [], { 'ppl:6': 'не масив' }, { 'ppl:6': [null, 7] }]) {
      const p = load({ version: 9, customPlans: bad });
      assert.equal(p.version, SCHEMA_VERSION);
    }
  });

  test('профіль версії 10 повторно не мігрує', () => {
    const p = load(Object.assign(stored(), { version: 10 }));
    assert.equal(namesIn(p, 'ulppl:5'), 'Згинання ніг, Розгинання ніг');
  });
});
