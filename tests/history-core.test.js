/**
 * Ядро історії (js/history-core.js).
 *
 * Головні властивості під охороною:
 *   1. append-only: старі записи ваг НІКОЛИ не змінюються і не зникають;
 *   2. той самий день — заміна, різні дні — накопичення;
 *   3. незмінність входу: функції повертають копії, не мутуючи журнал;
 *   4. історія в mealLog памʼятає ціль ТОГО дня, а не поточну.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const H = loadModules(['js/history-core.js']).HistoryCore;

describe('weightLog: append-only', () => {
  it('нові дні накопичуються, не затираючи старі', () => {
    let log = {};
    log = H.appendWeight(log, 'Жим', 100, '2026-08-01');
    log = H.appendWeight(log, 'Жим', 102.5, '2026-08-08');
    log = H.appendWeight(log, 'Жим', 105, '2026-08-15');
    assert.equal(log['Жим'].length, 3);
    assert.equal(log['Жим'][0].kg, 100);
    assert.equal(log['Жим'][0].d, '2026-08-01');
    assert.equal(log['Жим'][2].kg, 105);
  });

  it('повторна зміна того самого дня замінює запис, а не додає', () => {
    let log = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    log = H.appendWeight(log, 'Жим', 101, '2026-08-01');
    log = H.appendWeight(log, 'Жим', 102, '2026-08-01');
    assert.equal(log['Жим'].length, 1);
    assert.equal(log['Жим'][0].kg, 102);
  });

  it('та сама вага повторно — не подія', () => {
    let log = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    const same = H.appendWeight(log, 'Жим', 100, '2026-08-08');
    assert.equal(same['Жим'].length, 1);
  });

  it('вхідний журнал НЕ мутується', () => {
    const src = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    const snapshot = JSON.stringify(src);
    H.appendWeight(src, 'Жим', 120, '2026-08-08');
    H.appendWeight(src, 'Присід', 140, '2026-08-08');
    assert.equal(JSON.stringify(src), snapshot);
  });

  it('сміття не ламає журнал', () => {
    const log = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    assert.equal(H.appendWeight(log, 'Жим', NaN), log);
    assert.equal(H.appendWeight(log, '', 50), log);
    assert.equal(H.appendWeight(log, 'Жим', -5), log);
    assert.equal(H.appendWeight(null, 'Жим', NaN)['Жим'], undefined);
  });

  it('дельта рахується від першого до останнього', () => {
    let log = {};
    log = H.appendWeight(log, 'Жим', 100, '2026-06-01');
    log = H.appendWeight(log, 'Жим', 95, '2026-07-01');   // деолоад теж історія
    log = H.appendWeight(log, 'Жим', 107.5, '2026-08-01');
    const d = H.weightDelta(log, 'Жим');
    assert.equal(d.first, 100);
    assert.equal(d.last, 107.5);
    assert.equal(d.delta, 7.5);
    assert.equal(d.count, 3);
  });

  it('weightNames сортує за свіжістю останньої зміни', () => {
    let log = {};
    log = H.appendWeight(log, 'Старе', 50, '2026-01-01');
    log = H.appendWeight(log, 'Свіже', 60, '2026-08-01');
    assert.equal(H.weightNames(log).join(','), 'Свіже,Старе');
  });
});

describe('спарклайн', () => {
  it('порожня чи одноточкова серія — порожній шлях', () => {
    assert.equal(H.sparklinePath([], 100, 30), '');
    assert.equal(H.sparklinePath([{ d: '2026-08-01', kg: 100 }], 100, 30), '');
  });

  it('дві точки — шлях M…L… у межах полотна', () => {
    const p = H.sparklinePath(
      [{ d: '2026-08-01', kg: 100 }, { d: '2026-08-15', kg: 110 }], 100, 30, 2);
    assert.match(p, /^M2\.0 28\.0L98\.0 2\.0$/);
  });

  it('плоска серія малюється по центру, без ділення на нуль', () => {
    const p = H.sparklinePath(
      [{ d: '2026-08-01', kg: 100 }, { d: '2026-08-15', kg: 100 }], 100, 30);
    assert.ok(p.includes(' 15.0'));
  });
});

describe('sessionLog', () => {
  it('один запис на день; повтор оновлює, а не дублює', () => {
    let log = H.upsertSession({}, '2026-08-17', { programId: 'ppl', days: 6, dayIdx: 2, title: 'Ноги', done: 3, total: 8 });
    log = H.upsertSession(log, '2026-08-17', { programId: 'ppl', days: 6, dayIdx: 2, title: 'Ноги', done: 8, total: 8 });
    assert.equal(Object.keys(log).length, 1);
    assert.equal(log['2026-08-17'].done, 8);
    assert.equal(log['2026-08-17'].title, 'Ноги');
  });

  it('різні дні накопичуються', () => {
    let log = H.upsertSession({}, '2026-08-15', { programId: 'p', dayIdx: 0, title: 'A', done: 5, total: 5 });
    log = H.upsertSession(log, '2026-08-17', { programId: 'p', dayIdx: 1, title: 'B', done: 2, total: 6 });
    assert.equal(Object.keys(log).length, 2);
  });
});

describe('mealLog: закриття дня', () => {
  it('запис памʼятає ціль свого дня', () => {
    let log = H.closeDay({}, '2026-08-16', { kcal: 2500.4, p: 150.6, f: 70, c: 300, fiber: 30 }, 2938);
    // …профіль змінився, ціль тепер інша — старий запис не рухається
    log = H.closeDay(log, '2026-08-17', { kcal: 2100, p: 140, f: 60, c: 250, fiber: 25 }, 2600);
    assert.equal(log['2026-08-16'].target, 2938);
    assert.equal(log['2026-08-17'].target, 2600);
    assert.equal(log['2026-08-16'].kcal, 2500);
    assert.equal(log['2026-08-16'].p, 151);
  });

  it('день без норми закривається без target', () => {
    const log = H.closeDay({}, '2026-08-17', { kcal: 1800 }, null);
    assert.equal(log['2026-08-17'].kcal, 1800);
    assert.equal('target' in log['2026-08-17'], false);
  });

  it('lastEntries віддає нові першими і фільтрує сміттєві ключі', () => {
    const log = { '2026-08-15': { kcal: 1 }, '2026-08-17': { kcal: 3 }, 'мусор': { kcal: 9 }, '2026-08-16': { kcal: 2 } };
    const out = H.lastEntries(log, 2);
    assert.equal(out.length, 2);
    assert.equal(out[0].d, '2026-08-17');
    assert.equal(out[1].d, '2026-08-16');
  });
});
