/**
 * ДОСТРОКОВЕ ЗАВЕРШЕННЯ: кого питати і чим не гнати.
 *
 * Стережуться дві речі, які ламаються мовчки.
 *
 * 1. ПИТАТИ ТІЛЬКИ ПРО НЕДОРОБЛЕНЕ. Якщо вікно почне зʼявлятись і після
 *    повністю закритого дня, людина за тиждень навчиться клацати
 *    «Завершити» не читаючи — і попередження перестане працювати саме
 *    тоді, коли справді знадобиться. Це не косметика, це те, заради
 *    чого вікно існує.
 *
 * 2. НЕ ГНАТИ ТЕРПІТИ ТОГО, КОМУ БОЛИТЬ. Людина ставить у трекер чесне
 *    число, а застосунок у відповідь показує заклик стерпіти — це
 *    підштовхування тренуватись через травму. У застосунку є медичне
 *    застереження і вік 17+; таке має бути під тестом, а не під чиєюсь
 *    памʼяттю.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { FinishCore: F } = loadModules(['js/finish-core.js']);

/** Джерело «випадковості», що завжди вибирає елемент за номером. */
const at = (i, len) => () => i / len;

describe('коли питати', () => {
  test('недороблений день — питаємо', () => {
    assert.equal(F.shouldAsk({ doneSets: 9, totalSets: 29 }), true);
  });

  test('усе закрито — не питаємо, бо нема про що', () => {
    assert.equal(F.shouldAsk({ doneSets: 29, totalSets: 29 }), false);
  });

  test('зроблено більше запланованого — теж не питаємо', () => {
    assert.equal(F.shouldAsk({ doneSets: 31, totalSets: 29 }), false);
  });

  test('нуль підходів — питаємо: це найдорожчий випадок', () => {
    assert.equal(F.shouldAsk({ doneSets: 0, totalSets: 29 }), true);
  });

  test('порожній або зіпсований план не валить кнопку', () => {
    assert.equal(F.shouldAsk({ doneSets: 0, totalSets: 0 }), false);
    assert.equal(F.shouldAsk(null), false);
    assert.equal(F.shouldAsk({}), false);
  });
});

describe('біль у трекері', () => {
  const day = '2026-09-10';

  test('пара {pain, fatigue}: береться біль, а не втома', () => {
    const log = { painFatigue: { [day]: { pain: 3, fatigue: 10 } } };
    assert.equal(F.painToday(log, day), 3);
  });

  test('старий запис числом теж читається', () => {
    assert.equal(F.painToday({ painFatigue: { [day]: 8 } }, day), 8);
  });

  test('нічого не відмічено — нуль, а не виняток', () => {
    assert.equal(F.painToday({}, day), 0);
    assert.equal(F.painToday(null, day), 0);
    assert.equal(F.painToday({ painFatigue: {} }, day), 0);
    assert.equal(F.painToday({ painFatigue: { [day]: null } }, day), 0);
  });
});

describe('добірка цитат', () => {
  const day = '2026-09-10';
  const painful = { painFatigue: { [day]: { pain: F.PAIN_CUT, fatigue: 4 } } };

  test('у списку взагалі є теми про терпіння — інакше тест нижче порожній', () => {
    assert.ok(F.QUOTES.some((q) => q.t === 'pain'));
  });

  test('болить — жодної цитати про терпіння, хоч скільки тягни', () => {
    /* Перебираємо ВЕСЬ пул, а не одну спробу: одна випадкова витягла б
       «правильну» цитату і при зламаному фільтрі. */
    for (let i = 0; i < F.QUOTES.length; i++) {
      const q = F.pickQuote({ trackerLog: painful, day, rand: at(i, F.QUOTES.length) });
      assert.notEqual(q.t, 'pain', 'на спробі ' + i + ': ' + q.s);
    }
  });

  test('не болить — тема про терпіння доступна', () => {
    const seen = new Set();
    for (let i = 0; i < F.QUOTES.length; i++) {
      seen.add(F.pickQuote({ trackerLog: {}, day, rand: at(i, F.QUOTES.length) }).t);
    }
    assert.ok(seen.has('pain'));
  });

  test('біль нижче порога добірку не звужує', () => {
    const mild = { painFatigue: { [day]: { pain: F.PAIN_CUT - 1 } } };
    const seen = new Set();
    for (let i = 0; i < F.QUOTES.length; i++) {
      seen.add(F.pickQuote({ trackerLog: mild, day, rand: at(i, F.QUOTES.length) }).t);
    }
    assert.ok(seen.has('pain'));
  });

  test('завжди повертає цитату з текстом — навіть на межах rand', () => {
    for (const r of [() => 0, () => 0.999999, () => 1, () => -1, () => NaN]) {
      const q = F.pickQuote({ trackerLog: {}, day, rand: r });
      assert.ok(q && typeof q.s === 'string' && q.s.length > 0, JSON.stringify(q));
    }
  });

  test('кожна цитата має відому тему й непорожній текст', () => {
    const themes = new Set(['pain', 'grit', 'strength', 'resume', 'self']);
    for (const q of F.QUOTES) {
      assert.ok(themes.has(q.t), 'невідома тема: ' + q.t);
      assert.ok(q.s && q.s.trim().length > 10, 'порожня цитата: ' + JSON.stringify(q));
    }
  });
});
