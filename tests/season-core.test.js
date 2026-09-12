/**
 * Періоди статистики: межа 2026-09-01 і обрізання журналів.
 *
 * Найважливіший тест тут — межа доби. Записи підписані ЛОКАЛЬНИМИ датами,
 * тож 31 серпня має лишитись поза періодом, а 1 вересня — увійти, у будь-якому
 * поясі. Саме тут UTC-перетворення дало б зсув на добу.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { SeasonCore: S } = loadModules(['js/date-core.js', 'js/season-core.js']);

/* Локальний полудень: дата не «переїде» в сусідню добу через пояс. */
const at = (iso) => new Date(iso + 'T12:00:00');

describe('Період статистики: визначення меж', () => {
  it('перший період стартує 2026-09-01 і не має кінця', () => {
    const s = S.SEASONS[0];
    assert.equal(s.id, 1);
    assert.equal(s.start, '2026-09-01');
    assert.equal(s.end, null);
  });

  it('до старту періоду немає — рахується весь час', () => {
    assert.equal(S.current(at('2026-08-31')), null);
    assert.equal(S.floorKey(at('2026-08-31')), null);
    assert.equal(S.label(at('2026-08-31')), 'За весь час');
  });

  it('у день старту період уже активний', () => {
    const s = S.current(at('2026-09-01'));
    assert.ok(s);
    assert.equal(s.id, 1);
    assert.equal(S.floorKey(at('2026-09-01')), '2026-09-01');
  });

  it('пізніше період той самий (кінця немає)', () => {
    assert.equal(S.current(at('2030-01-15')).id, 1);
  });
});

describe('Період статистики: межа доби', () => {
  const season = S.SEASONS[0];

  it('31 серпня 2026 — поза періодом', () => {
    assert.equal(S.contains(season, '2026-08-31'), false);
  });

  it('1 вересня 2026 — у періоді', () => {
    assert.equal(S.contains(season, '2026-09-01'), true);
  });

  /* Опівніч по обидва боки: журнал підписує день локальною датою, тому
     23:59:59 31 серпня — це ключ '2026-08-31', а 00:00:00 1 вересня —
     '2026-09-01'. Перевіряємо саме ці два ключі. */
  it('23:59:59 31.08 і 00:00:00 01.09 лягають у різні періоди', () => {
    const before = new Date(2026, 7, 31, 23, 59, 59);   // місяці з 0
    const after = new Date(2026, 8, 1, 0, 0, 0);
    assert.equal(S.current(before), null);
    assert.equal(S.current(after).id, 1);
  });
});

describe('Період статистики: обрізання журналів', () => {
  const LOG = {
    '2026-08-30': { done: 1 },
    '2026-08-31': { done: 2 },
    '2026-09-01': { done: 3 },
    '2026-09-05': { done: 4 }
  };

  it('лишає тільки записи від старту періоду', () => {
    const out = S.clip(LOG, at('2026-09-10'));
    assert.deepEqual(Object.keys(out).sort(), ['2026-09-01', '2026-09-05']);
  });

  it('НЕ мутує вхідний журнал — історія незмінна', () => {
    const copy = JSON.parse(JSON.stringify(LOG));
    S.clip(LOG, at('2026-09-10'));
    assert.deepEqual(LOG, copy);
    assert.equal(Object.keys(LOG).length, 4);
  });

  it('до старту періоду віддає весь журнал', () => {
    const out = S.clip(LOG, at('2026-08-15'));
    assert.equal(Object.keys(out).length, 4);
  });

  it('серії ваг обрізаються по датах записів', () => {
    const W = {
      'Жим': [{ d: '2026-08-20', kg: 80 }, { d: '2026-09-02', kg: 85 }],
      'Присід': [{ d: '2026-08-10', kg: 100 }]
    };
    const out = S.clipSeries(W, at('2026-09-10'));
    assert.deepEqual(Object.keys(out), ['Жим']);
    assert.equal(out['Жим'].length, 1);
    assert.equal(out['Жим'][0].kg, 85);
    // оригінал недоторканий
    assert.equal(W['Жим'].length, 2);
    assert.equal(W['Присід'].length, 1);
  });

  it('сміттєві ключі не проходять', () => {
    const out = S.clip({ 'не-дата': 1, '2026-09-03': { done: 1 } }, at('2026-09-10'));
    assert.deepEqual(Object.keys(out), ['2026-09-03']);
  });
});
