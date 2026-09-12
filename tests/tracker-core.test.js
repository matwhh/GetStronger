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
    // + креатин — добавка «з коробки»
    assert.equal(Object.keys(trackers).length, T.BUILTIN_ORDER.length + 1);
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
    assert.equal(names.join(','), T.BUILTIN_ORDER.join(',') + ',creatine');
    const act = T.active(trackers).map((t) => t.id);
    /* measure — «Заміри тіла»: увімкнений з коробки, бо це не кубик із
       щоденним числом, а представництво розділу в реєстрі (kind 'card').
       Він тут саме для того, щоб картку на «Сьогодні» можна було прибрати
       тією самою шпилькою, що й решту. */
    assert.equal(act.join(','), 'water,sleep,mood,recovery,measure,creatine');
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

/* ------------------------------------------------------------------ */
/* Тривалість довільним числом (замість готових кнопок)                */
/* ------------------------------------------------------------------ */
describe('tracker-core: години й хвилини', () => {
  const DEF = { min: 0, max: 960 };

  it('розкладає хвилини на два поля', () => {
    assert.equal(T.splitDuration(407).h, 6);
    assert.equal(T.splitDuration(407).m, 47);
    assert.equal(T.splitDuration(480).m, 0);
    assert.equal(T.splitDuration(null).h, null);
    assert.equal(T.splitDuration(-5).h, null);
  });

  it('складає назад', () => {
    assert.equal(T.joinDuration('6', '47', DEF), 407);
    assert.equal(T.joinDuration('7', '', DEF), 420);
    assert.equal(T.joinDuration('', '45', DEF), 45);
  });

  it('хвилини понад 59 переносяться в години, а не відкидаються', () => {
    assert.equal(T.joinDuration('', '90', DEF), 90);
    assert.equal(T.joinDuration('6', '90', DEF), 450);
  });

  it('порожні поля й нульовий підсумок = стерти запис, а не нуль годин сну', () => {
    assert.equal(T.joinDuration('', '', DEF), null);
    assert.equal(T.joinDuration(null, null, DEF), null);
    assert.equal(T.joinDuration('0', '', DEF), null);
    assert.equal(T.joinDuration('0', '0', DEF), null);
  });

  it('сміття не проходить', () => {
    ['abc', '-3', '1e5', '7:30', '--'].forEach(function (v) {
      assert.equal(T.joinDuration(v, '', DEF), false, v);
    });
  });

  it('поза межами трекера — відмова, а не мовчазне обрізання', () => {
    assert.equal(T.joinDuration('20', '', DEF), false);   // 1200 хв > 960
    assert.equal(T.joinDuration('16', '', DEF), 960);     // рівно межа
  });

  it('кома як роздільник приймається', () => {
    assert.equal(T.joinDuration('7,5', '', DEF), 450);
  });

  it('у сна більше немає готових кнопок', () => {
    assert.equal(T.TRACKER_DEFS.sleep.presets, undefined);
  });
});

describe('tracker-core: накопичення без брехні в округленні', () => {
  it('+0.25 записує 0.25, а не 0.3', () => {
    const trackers = T.ensureBuiltins({});
    let log = T.addDelta(trackers, {}, 'water', 0.25, '2026-09-01');
    assert.equal(log.water['2026-09-01'], 0.25);
    log = T.addDelta(trackers, log, 'water', 0.25, '2026-09-01');
    assert.equal(log.water['2026-09-01'], 0.5);
  });
});


/* ------------------------------------------------------------------ */
/* Добавки з дозою (грами)                                             */
/* ------------------------------------------------------------------ */
describe('tracker-core: креатин і дози', () => {
  const trackers = T.ensureBuiltins({});

  it('креатин моногідрат є з коробки: увімкнений, 5 г', () => {
    const c = trackers.creatine;
    assert.equal(c.type, 'supplement');
    assert.equal(c.enabled, true);
    assert.equal(T.isDosed(c), true);
    assert.equal(T.doseOf(c), 5);
    assert.equal(T.defFor(c).kind, 'dose');
  });

  it('галочка пише типову дозу, число — стільки грамів', () => {
    let log = T.logValue(trackers, {}, 'creatine', true, '2026-09-01');
    assert.equal(log.creatine['2026-09-01'], 5);
    log = T.logValue(trackers, log, 'creatine', '7,5', '2026-09-01');
    assert.equal(log.creatine['2026-09-01'], 7.5);
    assert.equal(T.gramsOf(log.creatine['2026-09-01']), 7.5);
  });

  it('нуль, сміття і false знімають позначку', () => {
    const base = T.logValue(trackers, {}, 'creatine', true, '2026-09-01');
    [0, false, null, '', 'abc', -3, 900, Infinity].forEach(function (v) {
      const log = T.logValue(trackers, base, 'creatine', v, '2026-09-01');
      assert.equal(log.creatine && log.creatine['2026-09-01'], undefined, String(v));
    });
  });

  it('старі булеві записи рахуються як «прийнято»', () => {
    const log = { creatine: { '2026-08-30': true, '2026-08-31': 5, '2026-09-01': 3 } };
    const st = T.boolSummary(log, 'creatine', 30, null, new Date(2026, 8, 1));
    assert.equal(st.done, 3);
    assert.equal(T.taken(true), true);
    assert.equal(T.taken(5), true);
    assert.equal(T.taken(0), false);
    assert.equal(T.taken(undefined), false);
  });

  it('серія днів поспіль бачить і грами, і галочки', () => {
    const log = { creatine: { '2026-08-30': true, '2026-08-31': 5, '2026-09-01': 3 } };
    assert.equal(T.boolSummary(log, 'creatine', 30, null, new Date(2026, 8, 1)).streak, 3);
  });

  it('дозу можна змінити чи прибрати', () => {
    let t = T.setDose(trackers, 'creatine', 3);
    assert.equal(T.doseOf(t.creatine), 3);
    t = T.setDose(t, 'creatine', '');
    assert.equal(T.isDosed(t.creatine), false);
    assert.equal(T.defFor(t.creatine).kind, 'boolean');
    // звичка дози не має
    assert.equal(T.setDose(trackers, 'water', 3), trackers);
  });

  it('власна добавка з дозою і без', () => {
    const a = T.addCustom(trackers, 'supplement', 'Омега-3', 2);
    assert.equal(T.doseOf(a.trackers[a.id]), 2);
    const b = T.addCustom(trackers, 'supplement', 'Вітамін D');
    assert.equal(T.isDosed(b.trackers[b.id]), false);
    const h = T.addCustom(trackers, 'habit', 'Читати', 5);   // звичка ігнорує дозу
    assert.equal(T.isDosed(h.trackers[h.id]), false);
  });

  it('уже наявний креатин людини не переписується', () => {
    const mine = { creatine: { id: 'creatine', type: 'supplement', name: 'Креатин',
      enabled: false, settings: { dose: 3, unit: 'г' }, goal: null, source: null, order: 7, createdAt: null } };
    const out = T.ensureBuiltins(mine);
    assert.equal(out.creatine.enabled, false);
    assert.equal(T.doseOf(out.creatine), 3);
  });
});

describe('tracker-core: креатин з коробки не воскресає', () => {
  it('«видалити» для дефолтної добавки = вимкнути, і ensureBuiltins її не повертає', () => {
    let t = T.ensureBuiltins({});
    t = T.removeCustom(t, 'creatine');
    assert.equal(t.creatine.enabled, false);
    const again = T.ensureBuiltins(t);
    assert.equal(again.creatine.enabled, false);
    assert.equal(T.active(again).some((x) => x.id === 'creatine'), false);
  });
  it('власна добавка видаляється по-справжньому', () => {
    const a = T.addCustom(T.ensureBuiltins({}), 'supplement', 'Омега-3', 2);
    assert.equal(T.removeCustom(a.trackers, a.id)[a.id], undefined);
  });
});

/*
 * Форма журналу трекерів — trackerLog[id][РРРР-ММ-ДД].
 *
 * Сторінка «Трекери» будувала патч як next[дата], тобто шукала ДАТУ на
 * верхньому рівні. Вона там ніколи не лежить, тож патч завжди виходив
 * порожнім, а гілка «запису немає» видаляла ключ, якого не існувало. На
 * екрані значення виглядало записаним (сторінка малює зі свого стану), у
 * профілі — нічого, після перезавантаження зникало. Ці тести фіксують
 * саму форму, щоб наступний, хто писатиме патч, побачив її з тесту.
 */
describe('Журнал трекерів: ключ — трекер, потім дата', () => {
  const TC = T;   // модуль уже завантажений на початку файла
  const TRK = TC.ensureBuiltins({});   // справжній каталог, а не саморобний
  /* Запис — обʼєкт {value, source, date}; число з нього дістає entryValue. */
  const v = (log, id, d) => TC.entryValue((log[id] || {})[d]);

  it('logValue кладе значення під id, а не під дату', () => {
    const log = TC.logValue(TRK, {}, 'sleep', 407, '2026-09-07');
    assert.equal(typeof log.sleep, 'object', 'верхній рівень — id трекера');
    assert.equal(v(log, 'sleep', '2026-09-07'), 407);
    assert.equal(log['2026-09-07'], undefined, 'дати на верхньому рівні бути не має');
  });

  it('removeEntry прибирає день, а не трекер', () => {
    const log = TC.logValue(TRK, {}, 'sleep', 407, '2026-09-07');
    const out = TC.removeEntry(log, 'sleep', '2026-09-07');
    assert.equal(typeof out.sleep, 'object');
    assert.equal(out.sleep['2026-09-07'], undefined);
  });

  it('два трекери одного дня лежать окремо', () => {
    let log = TC.logValue(TRK, {}, 'sleep', 407, '2026-09-07');
    log = TC.logValue(TRK, log, 'water', 5, '2026-09-07');
    assert.equal(v(log, 'sleep', '2026-09-07'), 407);
    assert.equal(v(log, 'water', '2026-09-07'), 5);
    assert.equal(Object.keys(log).sort().join(','), 'sleep,water');
  });

  it('запис іншого дня не чіпає вчорашній', () => {
    let log = TC.logValue(TRK, {}, 'sleep', 400, '2026-09-06');
    log = TC.logValue(TRK, log, 'sleep', 407, '2026-09-07');
    assert.equal(v(log, 'sleep', '2026-09-06'), 400);
    assert.equal(v(log, 'sleep', '2026-09-07'), 407);
  });
});

/**
 * ЗАКРІПЛЕННЯ НА «СЬОГОДНІ».
 *
 * Стережеться не сам прапорець, а три правила, без яких на головній
 * зʼявляються кубики-привиди:
 *
 * 1. Закріпити можна лише те, що ведеться. Кубик вимкненого трекера не
 *    має куди писати — сторінка трекерів його вже не показує.
 * 2. Вимкнення знімає закріплення. Інакше трекер, увімкнений через пів
 *    року, без попередження виринає на головній.
 * 3. workoutMood не потрапляє на головну ніколи: питання «як ти
 *    почувався до і після» має сенс лише поруч із тренуванням.
 */
describe('tracker-core: закріплення на «Сьогодні»', () => {
  it('типово не закріплено нічого — головна лишається такою, як була', () => {
    const t = T.ensureBuiltins({});
    assert.deepEqual(T.pinnedList(t), []);
  });

  it('закріплює увімкнений трекер і не мутує вхід', () => {
    const t = T.ensureBuiltins({});
    const next = T.setPinned(t, 'water', true);
    assert.equal(next.water.pinned, true);
    /* false, а не undefined: ensureBuiltins тепер проставляє pinned явно —
       інакше «закріплено» довелося б вгадувати з відсутності поля, а
       відсутність поля означає й «старий профіль», і «зняли шпильку». */
    assert.equal(t.water.pinned, false, 'вхідний реєстр не змінився');
    assert.deepEqual(T.pinnedList(next).map((x) => x.id), ['water']);
  });

  it('ВИМКНЕНИЙ трекер закріпити не можна', () => {
    const t = T.ensureBuiltins({});          // caffeine вимкнений
    const next = T.setPinned(t, 'caffeine', true);
    assert.equal(next.caffeine.pinned, false);
    assert.deepEqual(T.pinnedList(next), []);
  });

  it('вимкнення трекера знімає закріплення', () => {
    let t = T.setPinned(T.ensureBuiltins({}), 'water', true);
    assert.equal(t.water.pinned, true);
    t = T.setEnabled(t, 'water', false);
    assert.equal(t.water.pinned, false, 'привид не лишився');
    /* І назад: увімкнення саме по собі НЕ повертає кубик на головну. */
    t = T.setEnabled(t, 'water', true);
    assert.equal(t.water.pinned, false);
    assert.deepEqual(T.pinnedList(t), []);
  });

  it('настрій до/після тренування на головну не виноситься', () => {
    let t = T.setEnabled(T.ensureBuiltins({}), 'workoutMood', true);
    t = T.setPinned(t, 'workoutMood', true);
    assert.equal(t.workoutMood.pinned, true, 'прапорець ставиться…');
    assert.deepEqual(T.pinnedList(t), [], '…але на «Сьогодні» його немає');
  });

  it('звички й добавки закріплюються так само, як убудовані', () => {
    const made = T.addCustom(T.ensureBuiltins({}), 'habit', 'Розтяжка');
    const t = T.setPinned(made.trackers, made.id, true);
    assert.deepEqual(T.pinnedList(t).map((x) => x.name), ['Розтяжка']);
  });

  it('порядок кубиків — той самий, що в списку трекерів', () => {
    let t = T.ensureBuiltins({});
    t = T.setPinned(t, 'mood', true);
    t = T.setPinned(t, 'water', true);
    /* Закріплювали настрій першим, але водa стоїть раніше за order —
       кубики не мають переставлятись залежно від того, що людина
       натиснула раніше. */
    assert.deepEqual(T.pinnedList(t).map((x) => x.id), ['water', 'mood']);
  });

  it('невідомий id нічого не ламає', () => {
    const t = T.ensureBuiltins({});
    assert.equal(T.setPinned(t, 'нема-такого', true), t);
    assert.deepEqual(T.pinnedList(null), []);
  });
});

describe('tracker-core: заміри як картка-розділ', () => {
  const t = T.ensureBuiltins({});

  it('заміри зареєстровані й типово увімкнені та закріплені', () => {
    assert.equal(t.measure.enabled, true);
    assert.equal(t.measure.pinned, true);
    assert.equal(T.isPinned(t, 'measure'), true);
  });

  it('це картка, а не кубик', () => {
    assert.equal(T.isCard(t.measure), true);
    assert.equal(T.isCard(t.water), false);
    assert.equal(T.defFor(t.measure).kind, 'card');
  });

  it('у сітку кубиків не потрапляє НІКОЛИ', () => {
    /* Сітка малює поле вводу за значенням дня. У замірів такого значення
       немає — їхній журнал окремий, — тож кубик показав би порожнечу й
       писав би в trackerLog число, якого там бути не повинно. */
    const pinned = T.setPinned(t, 'measure', true);
    assert.equal(T.pinnedList(pinned).map((x) => x.id).join(','), '');
    assert.equal(T.pinnedCards(pinned).map((x) => x.id).join(','), 'measure');
  });

  it('картка прибирається й повертається тією самою шпилькою', () => {
    const off = T.setPinned(t, 'measure', false);
    assert.equal(T.isPinned(off, 'measure'), false);
    assert.equal(T.pinnedCards(off).length, 0);
    const on = T.setPinned(off, 'measure', true);
    assert.equal(T.isPinned(on, 'measure'), true);
  });

  it('вимкнений трекер замірів не лишає картку на головній', () => {
    const off = T.setEnabled(t, 'measure', false);
    assert.equal(T.isPinned(off, 'measure'), false, 'вимкнене не може бути закріпленим');
    assert.equal(T.pinnedCards(off).length, 0);
  });

  it('старий профіль отримує заміри сам, нічого не втрачаючи', () => {
    /* Реєстр, створений до появи замірів: людина вимкнула воду й
       закріпила сон. ensureBuiltins має додати measure й НЕ зачепити
       чужих рішень. */
    const oldReg = {
      water: { id: 'water', type: 'water', name: 'Вода', enabled: false, settings: {}, goal: 2, order: 0 },
      sleep: { id: 'sleep', type: 'sleep', name: 'Сон', enabled: true, pinned: true, settings: {}, goal: 480, order: 1 }
    };
    const next = T.ensureBuiltins(oldReg);
    assert.equal(next.measure.enabled, true);
    assert.equal(next.water.enabled, false, 'чуже рішення переписано');
    assert.equal(next.sleep.pinned, true, 'закріплення збите');
    assert.equal(next.sleep.goal, 480);
  });
});
