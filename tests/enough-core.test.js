/**
 * Одне правило «скільки даних стоїть за числом» (js/enough-core.js).
 *
 * Найцінніше тут — стан 'thin'. Саме його зазвичай і немає в коді: або
 * дані є, або їх «немає», а середнє по трьох днях виглядає так само
 * переконливо, як середнє по тридцяти. Тести нижче стережуть межу.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/enough-core.js']);
const E = ctx.Enough;

describe('три стани замість двох', () => {
  it('нічого — це не те саме, що замало', () => {
    assert.equal(E.of(0, 14).level, 'none');
    assert.equal(E.of(1, 14).level, 'thin');
    assert.equal(E.of(4, 14).level, 'thin', '4 із 14 — це 29%, а треба 70%');
  });

  it('досить — це частка вікна, а не будь-яке число', () => {
    /* 70% від 14 — це 10 (ceil), тобто девʼять днів ще замало. */
    assert.equal(E.of(9, 14).level, 'thin');
    assert.equal(E.of(10, 14).level, 'ok');
    assert.equal(E.of(14, 14).ok, true);
  });

  it('want каже, скільки саме треба', () => {
    assert.equal(E.of(0, 14).want, 10);
    assert.equal(E.of(0, 30).want, 21);
  });
});

describe('мінімум діє завжди', () => {
  it('на короткому вікні частка не опускає поріг нижче трьох', () => {
    /* 70% від 2 — це 2, але двох точок мало для будь-якого тренду. */
    assert.equal(E.of(2, 2).level, 'thin');
    assert.equal(E.of(3, 2).level, 'ok');
  });

  it('вікна може не бути зовсім — лишається мінімум', () => {
    assert.equal(E.of(2, 0).level, 'thin');
    assert.equal(E.of(3, 0).level, 'ok');
  });

  it('свій мінімум перекриває типовий', () => {
    assert.equal(E.of(5, 10, { min: 8 }).level, 'thin');
    assert.equal(E.of(8, 10, { min: 8 }).level, 'ok');
  });

  it('своя частка — там, де потрібна більша щільність', () => {
    assert.equal(E.of(10, 14, { share: 0.9 }).level, 'thin');
    assert.equal(E.of(13, 14, { share: 0.9 }).level, 'ok');
  });
});

describe('сміття на вході не вдає, ніби даних досить', () => {
  it('не число — це нуль, а не NaN', () => {
    for (const bad of [null, undefined, NaN, Infinity, 'три', {}, []]) {
      const v = E.of(bad, bad);
      assert.equal(v.level, 'none', String(bad));
      assert.equal(Number.isFinite(v.want), true);
    }
  });

  it("відʼємне «є» — це нуль", () => {
    assert.equal(E.of(-5, 14).have, 0);
    assert.equal(E.of(-5, 14).level, 'none');
  });
});

describe('підпис каже правду й нічого зайвого', () => {
  it('порожньо, коли вікно закрите повністю', () => {
    assert.equal(E.label(E.of(14, 14)), '');
  });

  it('повне вікно не приховується, коли записів менше', () => {
    assert.equal(E.label(E.of(12, 14)), 'по 12 із 14 днів');
  });

  it('замало — видно, СКІЛЬКИ треба, а не лише що мало', () => {
    assert.equal(E.label(E.of(4, 14)), 'поки 4 із 10 днів');
  });

  it('нічого — окреме повідомлення', () => {
    assert.equal(E.label(E.of(0, 14)), 'записів ще немає');
  });

  it('одиницю можна замінити', () => {
    assert.equal(E.label(E.of(0, 8, {}), ['тиждень', 'тижні', 'тижнів']),
      'записів ще немає');
    assert.equal(E.label(E.of(2, 8), ['тиждень', 'тижні', 'тижнів']),
      'поки 2 із 6 тижнів');
  });
});

describe('gate: число або нічого', () => {
  it('замало — null, а не нуль', () => {
    assert.equal(E.gate(E.of(2, 14), 2400), null);
    assert.equal(E.gate(E.of(0, 14), 2400), null);
  });

  it('досить — те саме значення', () => {
    assert.equal(E.gate(E.of(10, 14), 2400), 2400);
  });

  it('без вердикту — теж null, а не тихий пропуск', () => {
    assert.equal(E.gate(null, 2400), null);
  });
});
