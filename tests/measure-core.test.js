/**
 * ЗАМІРИ ТІЛА: ядро і зведення для головної.
 *
 * Цей файл зʼявився пізно — measure-core.js жив без жодного юніта, хоча
 * саме він вирішує, що людина бачить про своє тіло. Приводом стала
 * картка на «Сьогодні»: вона показує останній замір і зміну від
 * попереднього, і помилка тут не падає з екрана, а тихо бреше числом.
 *
 * Стережеться три речі, на яких картка стає шкідливою:
 *   1. «скільки днів тому» рахується календарно, а не в добах — інакше
 *      перехід на літній час робить «учора» «сьогоднішнім»;
 *   2. показується лише те, що є в ОСТАННЬОМУ записі — параметр, який
 *      колись міряли й закинули, це археологія, а не стан;
 *   3. зміна береться від попереднього запису З ЦИМ ПАРАМЕТРОМ, а не від
 *      попередньої дати взагалі.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const w = loadModules(['js/date-core.js', 'js/measure-core.js']);
const MC = w.MeasureCore;

/* Два заміри: талія впала, груди й біцепс підросли. */
const LOG = {
  '2026-08-01': { t: '09:00', waist: 86, chest: 100, bicepsR: 38 },
  '2026-09-01': { t: '09:10', waist: 84.5, chest: 101, bicepsR: 38.6 }
};

describe('дні між замірами', () => {
  test('рахуються календарно', () => {
    assert.equal(MC.daysBetween('2026-09-01', '2026-09-12'), 11);
    assert.equal(MC.daysBetween('2026-09-12', '2026-09-12'), 0);
  });

  test('перехід на літній час не зʼїдає добу', () => {
    /* В Україні годинник переводять в останню неділю березня. Якби
       різниця рахувалась у локальних мілісекундах, тут вийшло б 0.96
       доби — тобто «сьогодні» замість «учора». */
    assert.equal(MC.daysBetween('2026-03-28', '2026-03-29'), 1);
    assert.equal(MC.daysBetween('2026-03-01', '2026-04-01'), 31);
  });

  test('сміття не вигадує числа', () => {
    assert.equal(MC.daysBetween('не дата', '2026-09-12'), null);
    assert.equal(MC.daysBetween(null, undefined), null);
  });
});

describe('зведення для головної', () => {
  test('без жодного заміру повертає null, а не порожню картку', () => {
    assert.equal(MC.homeSummary({}, '2026-09-12'), null);
    assert.equal(MC.homeSummary(null, '2026-09-12'), null);
  });

  test('бере САМИЙ останній замір, хоч би в якому порядку лежали дати', () => {
    const s = MC.homeSummary(LOG, '2026-09-12');
    assert.equal(s.last, '2026-09-01');
    assert.equal(s.daysAgo, 11);
    assert.equal(s.total, 2);
  });

  test('показує значення й зміну від попереднього заміру', () => {
    const s = MC.homeSummary(LOG, '2026-09-12');
    const waist = s.items.find((x) => x.key === 'waist');
    assert.equal(waist.current, 84.5);
    assert.equal(waist.delta, -1.5);
    assert.equal(waist.unit, 'см');
    assert.equal(waist.label, 'Талія');
  });

  test('перший замір у житті — зміни немає, і це не нуль', () => {
    const s = MC.homeSummary({ '2026-09-01': { waist: 86 } }, '2026-09-02');
    assert.equal(s.items[0].delta, null, 'нуль тут означав би «не змінилось»');
  });

  test('параметр, який міряли колись і закинули, на головну не лізе', () => {
    const log = {
      '2026-06-01': { waist: 90, calfR: 39 },
      '2026-09-01': { waist: 84 }
    };
    const keys = MC.homeSummary(log, '2026-09-05').items.map((x) => x.key);
    /* join, а не deepEqual: модулі живуть у власному node:vm-контексті, і
       масив звідти має ІНШИЙ Array.prototype — строга перевірка падає на
       прототипі, хоча вміст той самий. */
    assert.equal(keys.join(','), 'waist');
  });

  test('зміна береться від попереднього запису З ЦИМ параметром', () => {
    /* Груди міряли в червні й у вересні, талію — ще й у серпні. Якби
       зміна рахувалась «від попередньої дати», груди показали б null. */
    const log = {
      '2026-06-01': { waist: 90, chest: 98 },
      '2026-08-01': { waist: 86 },
      '2026-09-01': { waist: 84, chest: 101 }
    };
    const s = MC.homeSummary(log, '2026-09-02');
    assert.equal(s.items.find((x) => x.key === 'chest').delta, 3);
    assert.equal(s.items.find((x) => x.key === 'waist').delta, -2);
  });

  test('показується небагато — картка, а не таблиця', () => {
    const full = {};
    MC.FIELDS.forEach((f, i) => { full[f.k] = f.min + i; });
    const s = MC.homeSummary({ '2026-09-01': full }, '2026-09-02');
    assert.equal(s.items.length, 3);
    assert.equal(MC.homeSummary({ '2026-09-01': full }, '2026-09-02', { limit: 5 }).items.length, 5);
  });

  test('три тижні без заміру — це вже нагадування', () => {
    const at = (d) => MC.homeSummary({ '2026-09-01': { waist: 84 } }, d);
    assert.equal(at('2026-09-21').stale, false, 'за день до межі ще рано');
    assert.equal(at('2026-09-22').stale, true, 'рівно на межі вже час');
    assert.equal(MC.STALE_DAYS, 21);
  });
});
