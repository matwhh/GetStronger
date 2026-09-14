/**
 * ПОДВІЙНА ПРОГРЕСІЯ: КОЛИ ПРОПОНУВАТИ ВАГУ.
 *
 * Стережеться не підказка, а ЧОТИРИ УМОВИ, кожна з яких поодинці
 * здається зайвою — і кожна прибирає свій спосіб зіпсувати людині
 * тренування:
 *
 *   · тиждень мусить бути закритий — інакше вага росте після тижня, де
 *     половина днів пропущена, і недоробка закріплюється вагою;
 *   · межа мусить бути в УСІХ підходах — один вдалий підхід із трьох це
 *     не прогресія, це вдалий підхід;
 *   · вага мусить простояти два тренування — інакше той, хто закрив
 *     межу з першого разу після підвищення, отримає пропозицію підняти
 *     ще, і так щотижня до зриву;
 *   · відкладене мусить мовчати рівно тиждень, а відхилене — до
 *     наступного трігера, а не назавжди.
 *
 * Кожна з цих умов тут має тест, який ЧЕРВОНІЄ, якщо умову прибрати.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { ProgressionCore: P } = loadModules(['js/date-core.js', 'js/progression-core.js']);

/* Понеділок 2026-09-07 … неділя 2026-09-13. Сьогодні — понеділок 14-го,
   тобто попередній тиждень щойно закрився. */
const TODAY = '2026-09-14';
const MON = '2026-09-07';

/** Запис вправи в сесії: усі підходи по `r` повторень. */
const ex = (n, sets, r, extra) => Object.assign(
  { n, ps: sets, ds: sets, s: Array.from({ length: sets }, () => ({ r, w: 50 })) },
  extra || {});

/** Профіль із трьома завершеними днями тижня. */
function profile(opts = {}) {
  const reps = opts.reps ?? 10;
  const sets = opts.sets ?? 3;
  return {
    daysPerWeek: 3,
    weights: { 'Жим у тренажері': 60, 'Присідання зі штангою': 100 },
    weightLog: {
      'Жим у тренажері': [{ d: opts.since ?? '2026-08-01', kg: 60 }],
      'Присідання зі штангою': [{ d: '2026-08-01', kg: 100 }]
    },
    sessionLog: {
      '2026-09-07': { end: 1, ex: [ex('Жим у тренажері', sets, reps)] },
      '2026-09-09': { end: 1, ex: [ex('Жим у тренажері', sets, reps)] },
      '2026-09-11': { end: 1, ex: [ex('Присідання зі штангою', sets, 10)] },
      ...(opts.sessionLog || {})
    },
    ...(opts.profile || {})
  };
}

const PLAN = [{ exercises: [
  { name: 'Жим у тренажері', reps: '8–10' },
  { name: 'Присідання зі штангою', reps: '8–10' }
] }];

const isLeg = (n) => n === 'Присідання зі штангою';
const call = (p, o = {}) => P.due({ profile: p, plan: PLAN, today: TODAY, isLeg, ...o });

describe('верхня межа діапазону', () => {
  test('діапазон із тире en-dash і звичайним дефісом', () => {
    assert.equal(P.topOfRange('8–10'), 10);
    assert.equal(P.topOfRange('8-10'), 10);
    assert.equal(P.topOfRange(' 6 – 8 '), 8);
  });

  test('одне число теж має межу — інакше власні повтори вимикали б прогресію', () => {
    assert.equal(P.topOfRange('8'), 8);
    assert.equal(P.topOfRange(8), 8);
  });

  test('сміття не валить розрахунок', () => {
    for (const v of [null, undefined, '', '—', 'багато', 0, -5]) {
      assert.equal(P.topOfRange(v), null, JSON.stringify(v));
    }
  });
});

describe('межа в усіх підходах', () => {
  test('усі три підходи по 10 із 8–10 — зараховано', () => {
    assert.equal(P.hitTop(ex('X', 3, 10), 10), true);
  });

  test('один підхід із дев\'ятьма — не зараховано', () => {
    const e = ex('X', 3, 10);
    e.s[1] = { r: 9, w: 50 };
    assert.equal(P.hitTop(e, 10), false);
  });

  test('підходів закрито менше, ніж заплановано — не зараховано', () => {
    assert.equal(P.hitTop({ n: 'X', ps: 3, ds: 2, s: [{ r: 10 }, { r: 10 }] }, 10), false);
  });

  test('повторів більше за межу — теж зараховано', () => {
    assert.equal(P.hitTop(ex('X', 3, 12), 10), true);
  });

  test('порожнє й покалічене не кидає винятків', () => {
    for (const v of [null, {}, { ps: 3 }, { ps: 3, ds: 3, s: null }]) {
      assert.equal(P.hitTop(v, 10), false, JSON.stringify(v));
    }
  });
});

describe('закритий тиждень', () => {
  test('три завершені дні з трьох — закритий', () => {
    assert.equal(P.weekComplete(profile().sessionLog, MON, 3), true);
  });

  test('незавершена сесія не рахується', () => {
    const p = profile();
    delete p.sessionLog['2026-09-09'].end;
    assert.equal(P.weekComplete(p.sessionLog, MON, 3), false);
  });

  /*
   * E6. ДОТИ ТУТ СТОЯЛО «пропущений день — пропозиції немає», і це було
   * правдою для ВСІХ вправ одразу: пропущений день ніг глушив і жим,
   * зроблений двічі на межі. Умова була правильна за змістом («не
   * закріплювати недоробку вагою»), але стояла не на тому рівні —
   * глобально на тиждень замість кожної вправи окремо.
   *
   * Пропущена сесія карається рейтингом (missedWorkoutPenalty), а не
   * чужою вправою.
   */
  test('пропущений день ніг не глушить жим, зроблений як заплановано', () => {
    const p = profile();
    delete p.sessionLog['2026-09-11'];          // день присідань
    const names = call(p).map((r) => r.name);
    assert.ok(names.includes('Жим у тренажері'),
      'жим зроблено двічі на межі, а пропозиції немає');
    assert.ok(!names.includes('Присідання зі штангою'),
      'присідань того тижня не було — пропонувати нема за що');
  });

  test('вправа зроблена рідше, ніж її планує тиждень — пропозиції немає', () => {
    /* Та сама думка, що була в «закритому тижні», тільки на рівні
       вправи: план ставить жим двічі, зроблено раз. */
    const PLAN2 = [
      { exercises: [{ name: 'Жим у тренажері', reps: '8–10' }] },
      { exercises: [{ name: 'Жим у тренажері', reps: '8–10' }] }
    ];
    const p = profile();
    delete p.sessionLog['2026-09-09'];          // лишився один жим із двох
    assert.equal(call(p, { plan: PLAN2 }).length, 0);
  });

  test('вправа зроблена стільки разів, скільки планує тиждень — пропозиція є', () => {
    const PLAN2 = [
      { exercises: [{ name: 'Жим у тренажері', reps: '8–10' }] },
      { exercises: [{ name: 'Жим у тренажері', reps: '8–10' }] }
    ];
    assert.equal(call(profile(), { plan: PLAN2 })[0].name, 'Жим у тренажері');
  });
});

describe('вік робочої ваги', () => {
  test('рахує дні від останньої зміни і тренування з вправою', () => {
    const a = P.weightAge(profile(), 'Жим у тренажері', TODAY);
    assert.equal(a.since, '2026-08-01');
    assert.equal(a.days, 44);
    assert.equal(a.sessions, 2);
  });

  test('тренування ДО зміни ваги не рахуються', () => {
    const p = profile({ since: '2026-09-10' });
    const a = P.weightAge(p, 'Жим у тренажері', TODAY);
    assert.equal(a.sessions, 0, 'обидва дні жиму раніші за зміну ваги');
  });

  test('вправи без історії ваги не ламають розрахунок', () => {
    assert.equal(P.weightAge(profile(), 'Невідома вправа', TODAY), null);
  });
});

describe('пропозиція підняти вагу', () => {
  test('усе збіглося — жим у списку, крок 2,5', () => {
    const d = call(profile());
    const press = d.find((x) => x.name === 'Жим у тренажері');
    assert.ok(press, JSON.stringify(d));
    assert.equal(press.step, 2.5);
    assert.equal(press.next, 62.5);
  });

  test('ноги беруть крок 5', () => {
    const p = profile();
    p.sessionLog['2026-09-11'] = { end: 1, ex: [ex('Присідання зі штангою', 3, 10)] };
    p.sessionLog['2026-09-12'] = { end: 1, ex: [ex('Присідання зі штангою', 3, 10)] };
    p.daysPerWeek = 4;
    const squat = call(p).find((x) => x.name === 'Присідання зі штангою');
    assert.ok(squat);
    assert.equal(squat.step, 5);
    assert.equal(squat.next, 105);
  });

  test('не дотягнув до межі — пропозиції немає', () => {
    assert.equal(call(profile({ reps: 9 })).length, 0);
  });

  test('вага стоїть менше двох тренувань — пропозиції немає', () => {
    /* Вагу піднято в понеділок: до сьогодні лише одне тренування жиму
       після зміни, хоча межу закрито двічі. */
    const p = profile({ since: '2026-09-09' });
    assert.equal(call(p).filter((x) => x.name === 'Жим у тренажері').length, 0);
  });

  test('вправа без ваги в книзі не потрапляє в список', () => {
    const p = profile();
    delete p.weights['Жим у тренажері'];
    assert.equal(call(p).filter((x) => x.name === 'Жим у тренажері').length, 0);
  });

  test('поточний тиждень не рахується — лише попередній, повний', () => {
    /* Сьогодні вівторок ТОГО САМОГО тижня, у якому зроблено два дні. */
    const d = P.due({ profile: profile(), plan: PLAN, today: '2026-09-08', isLeg });
    assert.equal(d.length, 0);
  });
});

describe('кнопки віджета', () => {
  test('«відкласти» мовчить рівно тиждень', () => {
    const p = profile();
    const until = P.snoozeUntil(TODAY);
    assert.equal(until, '2026-09-21');
    p.progression = { 'Жим у тренажері': { snoozeUntil: until } };
    assert.equal(call(p).filter((x) => x.name === 'Жим у тренажері').length, 0);

    /* У день зняття заглушка вже не діє. */
    const later = P.due({ profile: p, plan: PLAN, today: until, isLeg });
    assert.equal(P.muted(p, 'Жим у тренажері', MON, until), false);
    assert.ok(Array.isArray(later));
  });

  test('«залишити як є» закриває цей трігер, а не всі майбутні', () => {
    const p = profile();
    p.progression = { 'Жим у тренажері': { ackWeek: MON } };
    assert.equal(P.muted(p, 'Жим у тренажері', MON, TODAY), true, 'цей тиждень — мовчить');
    assert.equal(P.muted(p, 'Жим у тренажері', '2026-09-14', TODAY), false,
      'наступний ідеально закритий тиждень мусить запитати знову');
  });

  test('чужа вправа не глушиться', () => {
    const p = profile();
    p.progression = { 'Присідання зі штангою': { ackWeek: MON } };
    assert.equal(P.muted(p, 'Жим у тренажері', MON, TODAY), false);
  });
});

describe('картка віку ваг', () => {
  test('найзастояліші зверху', () => {
    const p = profile();
    p.weightLog['Присідання зі штангою'] = [{ d: '2026-09-01', kg: 100 }];
    const rows = P.ages({ profile: p, today: TODAY });
    assert.equal(rows[0].name, 'Жим у тренажері');
    assert.equal(rows[0].days, 44);
    assert.equal(rows[1].days, 13);
  });

  /* Джерело — книга ваг, а не план: «Прогрес» плану не завантажує, і
     застояла вага цікава й тоді, коли вправа з плану тимчасово випала —
     саме її потім і забувають. */
  test('вправа поза активним планом теж у списку', () => {
    const p = profile();
    p.weightLog['Стара вправа'] = [{ d: '2026-07-01', kg: 30 }];
    const rows = P.ages({ profile: p, today: TODAY });
    assert.ok(rows.some((r) => r.name === 'Стара вправа'));
    assert.equal(rows[0].name, 'Стара вправа', 'найдавніша — зверху');
  });

  test('береться остання вага з історії, а не перша', () => {
    const p = profile();
    p.weightLog['Жим у тренажері'] = [{ d: '2026-08-01', kg: 60 }, { d: '2026-09-01', kg: 65 }];
    const row = P.ages({ profile: p, today: TODAY }).find((r) => r.name === 'Жим у тренажері');
    assert.equal(row.kg, 65);
    assert.equal(row.days, 13);
  });
});
