/**
 * Вік за датою народження (js/age-core.js).
 *
 * «Сьогодні» всюди передається аргументом — тести не залежать від дня
 * запуску, а межу повноліття можна перевірити на самому дні народження.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const A = loadModules(['js/date-core.js', 'js/age-core.js']).AgeCore;

const at = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

describe('Вік: розбір дати', () => {
  it('приймає коректну дату', () => {
    assert.equal(A.ageOn('2000-01-15', at('2026-08-25')), 26);
  });

  it('відкидає неіснуючий день', () => {
    assert.equal(A.ageOn('2001-02-31', at('2026-08-25')), null);
    assert.equal(A.ageOn('2001-13-01', at('2026-08-25')), null);
    assert.equal(A.ageOn('2001-00-10', at('2026-08-25')), null);
  });

  it('відкидає сміття й порожнє', () => {
    ['', null, undefined, 'вчора', '15.01.2000', '2000-1-5', '20000115']
      .forEach((v) => assert.equal(A.ageOn(v, at('2026-08-25')), null, String(v)));
  });

  it('відкидає дату з майбутнього', () => {
    assert.equal(A.ageOn('2027-01-01', at('2026-08-25')), null);
  });

  it('відкидає неправдоподібно давню дату', () => {
    assert.equal(A.ageOn('1850-01-01', at('2026-08-25')), null);
  });

  /*
   * Локальна дата, не UTC. new Date('2000-01-31') — це UTC-північ, і на
   * захід від Гринвіча вона стає 30 січня за місцевим часом: вік зсувався
   * на добу рівно там, де це найважливіше — на межі повноліття.
   */
  it('не зсувається через часовий пояс', () => {
    assert.equal(A.ageOn('2008-08-25', at('2026-08-25')), 18);
  });
});

/* Межа доступу — 17 років (js/age-core.js MIN_AGE). Тести звіряються
   саме з нею: людина, народжена 2009-08-25, має 17 років 25.08.2026. */
describe('Вік: межа доступу (17+)', () => {
  it('за день до 17-річчя — ще ні', () => {
    assert.equal(A.ageOn('2009-08-26', at('2026-08-25')), 16);
    assert.equal(A.isAdult('2009-08-26', at('2026-08-25')), false);
  });

  it('у день 17-річчя — уже так', () => {
    assert.equal(A.ageOn('2009-08-25', at('2026-08-25')), 17);
    assert.equal(A.isAdult('2009-08-25', at('2026-08-25')), true);
  });

  it('наступного дня після 17-річчя — так', () => {
    assert.equal(A.isAdult('2009-08-24', at('2026-08-25')), true);
  });

  it('18-річний теж проходить', () => {
    assert.equal(A.isAdult('2008-08-25', at('2026-08-25')), true);
  });

  /* 29 лютого: людина, народжена у високосний день, стає повнолітньою
     1 березня невисокосного року — саме так рахує календар. */
  it('високосний день народження', () => {
    assert.equal(A.ageOn('2008-02-29', at('2026-02-28')), 17);
    assert.equal(A.ageOn('2008-02-29', at('2026-03-01')), 18);
    assert.equal(A.ageOn('2008-02-29', at('2028-02-29')), 20);
  });

  it('високосний рік не дає доступу на добу раніше', () => {
    // 2024 високосний: наївне ділення на 365 дало б 17 уже 24 серпня
    assert.equal(A.ageOn('2009-08-25', at('2026-08-24')), 16);
    assert.equal(A.isAdult('2009-08-25', at('2026-08-24')), false);
  });

  it('невідома дата не пускає', () => {
    assert.equal(A.isAdult('', at('2026-08-25')), false);
    assert.equal(A.isAdult(null, at('2026-08-25')), false);
    assert.equal(A.isAdult('щось', at('2026-08-25')), false);
  });
});

describe('Вік: стан екрана', () => {
  const now = at('2026-08-25');
  it('порожньо', () => assert.equal(A.gateState('', now).state, 'empty'));
  it('непридатна дата', () => assert.equal(A.gateState('2001-02-31', now).state, 'invalid'));
  it('майбутнє — теж непридатна', () => assert.equal(A.gateState('2030-01-01', now).state, 'invalid'));
  it('неповнолітній', () => {
    const r = A.gateState('2010-05-05', now);
    assert.equal(r.state, 'minor');
    assert.equal(r.age, 16);
  });
  it('повнолітній', () => {
    const r = A.gateState('1995-03-10', now);
    assert.equal(r.state, 'adult');
    assert.equal(r.age, 31);
  });
});

describe('Вік: межа для поля вводу', () => {
  it('максимальна дата — рівно 17 років тому', () => {
    const max = A.latestAdultBirthDate(at('2026-08-25'));
    assert.equal(max, '2009-08-25');
    assert.equal(A.isAdult(max, at('2026-08-25')), true);
  });

  it('день після максимуму вже не проходить', () => {
    assert.equal(A.isAdult('2009-08-26', at('2026-08-25')), false);
  });
});
