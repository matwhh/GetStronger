/**
 * Модульна система трекерів (js/tracker-core.js).
 *
 * Дата «сьогодні» завжди передається аргументом — тести не залежать від
 * дня запуску.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const T = loadModules(['js/tracker-core.js']).TrackerCore;

const NOW = new Date(2026, 7, 17); // понеділок, 17 серпня 2026, локально

describe('реєстр: ensureBuiltins', () => {
  it('засіває всі убудовані типи з дефолтним увімкненням', () => {
    const trackers = T.ensureBuiltins({});
    assert.equal(Object.keys(trackers).length, T.BUILTIN_ORDER.length);
    assert.equal(trackers.water.enabled, true);
    assert.equal(trackers.sleep.enabled, true);
    assert.equal(trackers.mood.enabled, true);
    assert.equal(trackers.recovery.enabled, true);
    assert.equal(trackers.caffeine.enabled, false);
    assert.equal(trackers.steps.enabled, false);
    assert.equal(trackers.painFatigue.enabled, false);
    assert.equal(trackers.workoutMood.enabled, false);
  });

  it('не чіпає наявні записи (людина вимкнула воду — це лишається)', () => {
    const withOff = T.setEnabled(T.ensureBuiltins({}), 'water', false);
    const again = T.ensureBuiltins(withOff);
    assert.equal(again.water.enabled, false);
    assert.equal(again, withOff, 'нічого не змінилось — той самий обʼєкт');
  });

  it('джерело виставлене лише сну й крокам, ціль — де є дефолт', () => {
    const trackers = T.ensureBuiltins({});
    assert.equal(trackers.sleep.source, 'manual');
    assert.equal(trackers.steps.source, 'manual');
    assert.equal(trackers.mood.source, null);
    assert.equal(trackers.water.goal, 2.5);
    assert.equal(trackers.mood.goal, null);
  });
});

describe('користувацькі трекери: добавки й звички', () => {
  it('addCustom створює екземпляр із власним id, порожня назва — відмова', () => {
    const r = T.addCustom({}, 'supplement', '  Креатин  ');
    assert.ok(r);
    assert.equal(r.trackers[r.id].name, 'Креатин');
    assert.equal(r.trackers[r.id].type, 'supplement');
    assert.equal(r.trackers[r.id].enabled, true);
    assert.equal(T.addCustom({}, 'supplement', '   '), null);
    assert.equal(T.addCustom({}, 'water', 'Щось'), null, 'убудований тип так не створюють');
  });

  it('removeCustom прибирає лише supplement/habit, не вбудовані', () => {
    const r = T.addCustom({}, 'habit', 'Читати');
    const removed = T.removeCustom(r.trackers, r.id);
    assert.equal(removed[r.id], undefined);

    const builtins = T.ensureBuiltins({});
    const untouched = T.removeCustom(builtins, 'water');
    assert.equal(untouched.water.enabled, true, 'water не видаляється removeCustom');
  });
});

describe('увімкнення й ціль', () => {
  it('setEnabled/setGoal повертають новий обʼєкт, не мутують старий', () => {
    const before = T.ensureBuiltins({});
    const after = T.setEnabled(before, 'steps', true);
    assert.notEqual(after, before);
    assert.equal(before.steps.enabled, false, 'оригінал незмінний');
    assert.equal(after.steps.enabled, true);

    const withGoal = T.setGoal(after, 'steps', 10000);
    assert.equal(withGoal.steps.goal, 10000);
    assert.equal(T.setGoal(after, 'steps', -5).steps.goal, null, 'недійсна ціль стає null');
  });

  it('list сортує за order, active лишає лише увімкнені', () => {
    // join, а не deepEqual: масиви приходять із пісочниці vm і мають інший
    // прототип Array, тому strict deepEqual падає на «same structure but
    // not reference-equal» навіть за однакового вмісту.
    const trackers = T.ensureBuiltins({});
    const names = T.list(trackers).map((t) => t.id);
    assert.equal(names.join(','), T.BUILTIN_ORDER.join(','));
    const act = T.active(trackers).map((t) => t.id);
    assert.equal(act.join(','), 'water,sleep,mood,recovery');
  });
});

describe('запис значень: logValue', () => {
  const trackers = T.ensureBuiltins({});

  it('scale (настрій) клампиться до 1..10', () => {
    let log = T.logValue(trackers, {}, 'mood', 7, '2026-08-17');
    assert.equal(log.mood['2026-08-17'], 7);
    log = T.logValue(trackers, log, 'mood', 55, '2026-08-17');
    assert.equal(log.mood['2026-08-17'], 10, 'за межею — обрізається, а не відкидається');
  });

  it('duration (сон) округлюється й клампиться', () => {
    const log = T.logValue(trackers, {}, 'sleep', 462.6, '2026-08-17');
    // sleep — трекер із джерелом (hasSource), тому запис зберігається як
    // {value, source, date}, а не голе число (значення читається через entryValue()).
    assert.equal(T.entryValue(log.sleep['2026-08-17']), 463);
    assert.equal(T.entrySource(log.sleep['2026-08-17']), 'manual');
    assert.equal(log.sleep['2026-08-17'].date, '2026-08-17');
  });

  it('pair (біль/втома) зливає поля, друге поле не стирає перше', () => {
    // JSON.stringify замість deepEqual — той самий крос-реалмовий прототип.
    let log = T.logValue(trackers, {}, 'painFatigue', { pain: 3 }, '2026-08-17');
    assert.equal(JSON.stringify(log.painFatigue['2026-08-17']), JSON.stringify({ pain: 3 }));
    log = T.logValue(trackers, log, 'painFatigue', { fatigue: 6 }, '2026-08-17');
    assert.equal(JSON.stringify(log.painFatigue['2026-08-17']), JSON.stringify({ pain: 3, fatigue: 6 }));
  });

  it('булеві добавка/звичка: true пише позначку, false знімає', () => {
    const r = T.addCustom(trackers, 'supplement', 'Вітамін D');
    let log = T.logValue(r.trackers, {}, r.id, true, '2026-08-17');
    assert.equal(log[r.id]['2026-08-17'], true);
    log = T.logValue(r.trackers, log, r.id, false, '2026-08-17');
    assert.equal('2026-08-17' in log[r.id], false, 'запису немає — це і є «ні»');
  });

  it('невідомий трекер або сирі дані повертаються без змін', () => {
    const log = { a: 1 };
    assert.equal(T.logValue(trackers, log, 'nope', 5, '2026-08-17'), log);
  });
});

describe('накопичувальні трекери: addDelta', () => {
  const trackers = T.ensureBuiltins({});

  it('вода накопичується за день і клампиться зверху', () => {
    let log = T.addDelta(trackers, {}, 'water', 0.5, '2026-08-17');
    log = T.addDelta(trackers, log, 'water', 1, '2026-08-17');
    assert.equal(log.water['2026-08-17'], 1.5);
    log = T.addDelta(trackers, log, 'water', 100, '2026-08-17');
    assert.equal(log.water['2026-08-17'], 15, 'межа каталогу — 15 л');
  });

  it('некумулятивний трекер (настрій) addDelta ігнорує', () => {
    const log = { a: 1 };
    assert.equal(T.addDelta(trackers, log, 'mood', 1, '2026-08-17'), log);
  });
});

describe('історія: entriesFor / lastEntries', () => {
  it('сортує за датою, lastEntries — свіжі перші', () => {
    const log = { water: { '2026-08-01': 1, '2026-08-17': 2, '2026-08-10': 1.5 } };
    const s = T.entriesFor(log, 'water');
    assert.equal(s.map((e) => e.d).join(','), '2026-08-01,2026-08-10,2026-08-17');
    const last = T.lastEntries(log, 'water', 2);
    assert.equal(last.map((e) => e.d).join(','), '2026-08-17,2026-08-10');
  });
});

describe('streak', () => {
  it('рахує послідовні дні назад від сьогодні', () => {
    const log = { habit: { '2026-08-17': true, '2026-08-16': true, '2026-08-15': true, '2026-08-13': true } };
    assert.equal(T.streak(log, 'habit', NOW), 3, 'розрив 14 серпня зупиняє лічильник');
  });

  it('сьогодні ще не позначено — рахунок починається з учора, а не з нуля', () => {
    const log = { habit: { '2026-08-16': true, '2026-08-15': true } };
    assert.equal(T.streak(log, 'habit', NOW), 2);
  });

  it('порожній журнал — 0', () => {
    assert.equal(T.streak({}, 'habit', NOW), 0);
  });
});

describe('numericSummary і pairSummary', () => {
  it('середнє, останнє й тренд (друга половина проти першої)', () => {
    const log = { sleep: {
      '2026-08-10': 400, '2026-08-11': 410,
      '2026-08-14': 460, '2026-08-15': 470
    } };
    const s = T.numericSummary(log, 'sleep', 30, NOW);
    assert.equal(s.count, 4);
    assert.equal(s.avg, 435);
    assert.equal(s.latest, 470);
    assert.equal(s.trend, 'up');
  });

  it('менше 4 записів — тренд null, а не вигаданий', () => {
    const log = { sleep: { '2026-08-16': 400, '2026-08-17': 480 } };
    assert.equal(T.numericSummary(log, 'sleep', 30, NOW).trend, null);
  });

  it('period фільтрує; без записів у періоді — null', () => {
    const log = { mood: { '2026-01-01': 5 } };
    assert.equal(T.numericSummary(log, 'mood', 30, NOW), null);
  });

  it('pairSummary читає одне поле пари', () => {
    const log = { painFatigue: {
      '2026-08-16': { pain: 2, fatigue: 5 },
      '2026-08-17': { pain: 4, fatigue: 7 }
    } };
    const s = T.pairSummary(log, 'painFatigue', 'fatigue', 30, NOW);
    assert.equal(s.avg, 6);
    assert.equal(s.latest, 7);
  });
});

describe('goalAdherence', () => {
  it('середнє виконання цілі у %, переперевиконання обрізається до 100', () => {
    const log = { water: { '2026-08-16': 3.5, '2026-08-17': 1.25 } }; // ціль 2.5
    const s = T.goalAdherence(log, 'water', 2.5, 30, NOW);
    // день 1: min(3.5/2.5,1)=1; день 2: 1.25/2.5=0.5 → середнє 0.75
    assert.equal(s.pct, 75);
  });

  it('без цілі — null', () => {
    assert.equal(T.goalAdherence({}, 'water', 0, 30, NOW), null);
  });
});

describe('boolSummary (звички/добавки)', () => {
  it('total — календарні дні періоду, не кількість записів', () => {
    const log = { habit: { '2026-08-15': true, '2026-08-17': true } };
    /*
     * «За 7 днів» = РІВНО сім календарних днів, сьогодні включно:
     * 11…17 серпня. Раніше cutKey віднімав повні 7 діб, а фільтри
     * інклюзивні з обох боків — виходило 8 днів, і середні ділились
     * на неправильний знаменник. rating-core рахував вікно інакше,
     * тож два модулі розходились у тому, що таке «30 днів».
     */
    const s = T.boolSummary(log, 'habit', 7, null, NOW);
    assert.equal(s.total, 7);
    assert.equal(s.done, 2);
    assert.equal(s.streak, 1);
  });

  it('щойно створена звичка не карається за дні до створення', () => {
    const s = T.boolSummary({}, 'habit', 30, '2026-08-16', NOW);
    assert.equal(s.total, 2, 'лише 16 і 17 серпня — звичка не існувала раніше');
  });
});

describe('formatDuration', () => {
  it('хвилини у «Х год Y хв», рівна година — без хвилин', () => {
    assert.equal(T.formatDuration(462), '7 год 42 хв');
    assert.equal(T.formatDuration(480), '8 год');
    assert.equal(T.formatDuration(-5), '');
  });
});
