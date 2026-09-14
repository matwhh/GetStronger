/**
 * Аналітика прогресу (js/progress-core.js).
 *
 * Функції детерміновані, тому дата «сьогодні» передається аргументом —
 * тести не залежать від дня запуску.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/date-core.js', 'js/history-core.js', 'js/progress-core.js']);
const P = ctx.ProgressCore;

const NOW = new Date(2026, 7, 17); // 17 серпня 2026, локально

describe('вага тіла', () => {
  const log = {
    '2026-06-01': 72.0, '2026-07-01': 71.0,
    '2026-08-03': 70.0, '2026-08-10': 69.6, '2026-08-17': 69.2,
    'сміття': 70, '2026-08-16': 500   // невалідні — ігноруються
  };

  it('період фільтрує записи, дельта й темп рахуються по періоду', () => {
    const s = P.bodyStats(log, 30, NOW);
    assert.equal(s.first, 70.0);
    assert.equal(s.current, 69.2);
    assert.equal(s.delta, -0.8);
    // 14 днів між 03.08 і 17.08 → −0,8 кг за 2 тижні → −0,4/тиж
    assert.equal(s.perWeek, -0.4);
    assert.equal(s.count, 3);
  });

  it('без періоду — вся історія', () => {
    const s = P.bodyStats(log, null, NOW);
    assert.equal(s.first, 72.0);
    assert.equal(s.delta, -2.8);
  });

  it('порожній журнал — null, а не NaN', () => {
    assert.equal(P.bodyStats({}, 30, NOW), null);
    assert.equal(P.bodyStats(null, 30, NOW), null);
  });
});

describe('прогноз проти факту', () => {
  // 4 тижні, старт 70 кг
  const log = {
    '2026-07-20': 70.0, '2026-07-27': 70.3,
    '2026-08-03': 70.8, '2026-08-10': 71.1, '2026-08-17': 71.4
  };

  it('набір: коридор і вердикт рахуються від якоря періоду', () => {
    const f = P.forecast(log, 'bulk', 90, NOW);
    assert.ok(f, 'прогноз має існувати');
    assert.equal(f.anchor.kg, 70.0);
    assert.equal(f.actual, 1.4);
    // 28 днів = 4 тижні: +0,25%/тиж ≈ +0,70 кг; +0,5%/тиж ≈ +1,41 кг
    assert.ok(f.expectLo >= 0.6 && f.expectLo <= 0.8, 'низ коридору ~0,7: ' + f.expectLo);
    assert.ok(f.expectHi >= 1.3 && f.expectHi <= 1.5, 'верх коридору ~1,4: ' + f.expectHi);
    assert.equal(f.verdict, 'within');
  });

  it('схуднення з тією самою динамікою — вердикт above', () => {
    const f = P.forecast(log, 'cut', 90, NOW);
    assert.equal(f.verdict, 'above');   // вага росла, а мала падати
    assert.ok(f.expectHi < 0, 'верх коридору cut відʼємний');
  });

  it('maintain — абсолютний коридор ±0,5 кг', () => {
    const f = P.forecast(log, 'maintain', 90, NOW);
    assert.equal(f.expectLo, -0.5);
    assert.equal(f.expectHi, 0.5);
    assert.equal(f.verdict, 'above');   // +1,4 кг — поза «стабільно»
  });

  it('чесні відмови: без цілі, мало точок, короткий період', () => {
    assert.equal(P.forecast(log, null, 90, NOW), null);
    assert.equal(P.forecast({ '2026-08-17': 70 }, 'bulk', 90, NOW), null);
    const short = { '2026-08-10': 70, '2026-08-13': 70.2, '2026-08-17': 70.3 };
    assert.equal(P.forecast(short, 'bulk', 90, NOW), null, '7 днів — ще не сигнал');
  });
});

describe('сила', () => {
  const wl = {
    'Жим': [
      { d: '2026-06-01', kg: 80 }, { d: '2026-07-01', kg: 85 },
      { d: '2026-07-15', kg: 76 },   // деолоад
      { d: '2026-08-10', kg: 90 }
    ],
    'Присід': [{ d: '2026-08-01', kg: 120 }]
  };

  it('liftStats: перша/остання/приріст/відсоток/рекорд', () => {
    const s = P.liftStats(wl, 'Жим');
    assert.equal(s.first, 80);
    assert.equal(s.last, 90);
    assert.equal(s.delta, 10);
    assert.equal(s.pct, 12.5);
    assert.equal(s.max, 90);
    assert.equal(s.isRecord, true);
  });

  it('єдиний запис — точка відліку, не рекорд', () => {
    const s = P.liftStats(wl, 'Присід');
    assert.equal(s.isRecord, false);
    assert.equal(s.delta, 0);
  });

  it('bestLift знаходить найбільший приріст за період', () => {
    const b = P.bestLift(wl, 60, NOW);   // з ~18 червня: база 80 (запис 01.06 до періоду)
    assert.equal(b.name, 'Жим');
    assert.equal(b.delta, 10);
  });
});

describe('тренування', () => {
  // NOW = понеділок 17.08.2026
  const work = { '2026-08-17': 1, '2026-08-14': 1, '2026-08-05': 1 };
  const sess = { '2026-08-12': { done: 5, total: 7 }, '2026-08-14': { done: 7, total: 7 } };

  it('обʼєднує workLog і sessionLog без подвійного рахунку', () => {
    const d = P.trainedDates(work, sess);
    assert.equal(d.length, 4);   // 05, 12, 14, 17
  });

  it('thisWeek рахує від понеділка', () => {
    const s = P.trainingStats(work, sess, 3, NOW);
    assert.equal(s.thisWeek, 1);   // лише 17.08 (понеділок)
    assert.equal(s.total, 4);
    assert.equal(s.adherence.planned, 18);
  });

  it('без плану adherence відсутній', () => {
    const s = P.trainingStats(work, sess, 0, NOW);
    assert.equal(s.adherence, null);
  });
});

describe('харчування', () => {
  const ml = {
    '2026-08-14': { kcal: 2900, p: 150, target: 2900 },   // рівно в ціль
    '2026-08-15': { kcal: 3300, p: 160, target: 2900 },   // +14% — повз
    '2026-08-16': { kcal: 2800, p: 140 }                  // без цілі
  };

  it('середні, ціль і частка «у межах» — лише серед днів із ціллю', () => {
    const s = P.foodStats(ml, 30, NOW);
    assert.equal(s.count, 3);
    assert.equal(s.avgKcal, 3000);
    assert.equal(s.avgP, 150);
    assert.equal(s.avgTarget, 2900);
    assert.equal(s.withTarget, 2);
    assert.equal(s.inTarget, 1);
  });

  it('порожній журнал — null', () => {
    assert.equal(P.foodStats({}, 30, NOW), null);
  });

  /*
   * Швидкі записи (F2). Тут дві протилежні вимоги, і саме тому вони в
   * тестах: приблизний день МУСИТЬ тягнути середнє спожите (інакше
   * ресторани занижують його, а розрахункові витрати їдуть угору) і
   * МУСИТЬ бути поза середнім білком, коли білок не вказано (інакше
   * «невідомо» рахується як «нуль» і тихо ріже білкову частку).
   */
  it('приблизний день входить у середнє спожите', () => {
    const s = P.foodStats({
      '2026-08-15': { kcal: 2000, p: 150, target: 2000 },
      '2026-08-16': { kcal: 3000, partial: true, p: 0, target: 2000 }
    }, 30, NOW);
    assert.equal(s.count, 2);
    assert.equal(s.avgKcal, 2500, 'приблизний день випав із середнього спожитого');
    assert.equal(s.partialDays, 1);
  });

  it('приблизний день без білка не рахується білковим днем', () => {
    const s = P.foodStats({
      '2026-08-15': { kcal: 2000, p: 150, target: 2000 },
      '2026-08-16': { kcal: 3000, partial: true, p: 0, target: 2000 }
    }, 30, NOW);
    assert.equal(s.proteinDays, 1);
    assert.equal(s.avgP, 150, 'нуль із приблизного дня потрапив у середній білок');
  });

  it('приблизний день З білком рахується як звичайний', () => {
    const s = P.foodStats({
      '2026-08-15': { kcal: 2000, p: 100, target: 2000 },
      '2026-08-16': { kcal: 2000, p: 200, partial: true, target: 2000 }
    }, 30, NOW);
    assert.equal(s.proteinDays, 2);
    assert.equal(s.avgP, 150);
  });

  it('повний день із нулем білка — це виміряний нуль, він рахується', () => {
    const s = P.foodStats({ '2026-08-16': { kcal: 2000, p: 0, target: 2000 } }, 30, NOW);
    assert.equal(s.proteinDays, 1);
    assert.equal(s.avgP, 0);
  });

  it('усі дні періоду приблизні без білка — середній білок невідомий, не нуль', () => {
    const s = P.foodStats({
      '2026-08-15': { kcal: 2000, partial: true, p: 0, target: 2000 },
      '2026-08-16': { kcal: 2400, partial: true, p: 0, target: 2000 }
    }, 30, NOW);
    assert.equal(s.avgP, null);
    assert.equal(s.avgKcal, 2200);
    assert.equal(s.partialDays, 2);
  });
});

/* =========================================================================
   Сесія без добитої вправи, але з підходами (етап відмітки по підходах).
   ========================================================================= */
describe('progress-core: сесія рахується за підходами', () => {
  it('sessionCounts: done=0, але doneSets>0 — тренування було', () => {
    assert.equal(P.sessionCounts({ done: 0, total: 14, doneSets: 4, totalSets: 34 }), true);
    assert.equal(P.sessionCounts({ done: 2, total: 14 }), true);          // стара форма
    assert.equal(P.sessionCounts({ done: 0, total: 14, doneSets: 0, totalSets: 34 }), false);
    assert.equal(P.sessionCounts(null), false);
    assert.equal(P.sessionCounts({}), false);
  });

  it('trainedDates бачить день, де закриті лише підходи', () => {
    const sess = { '2026-08-31': { done: 0, total: 14, doneSets: 4, totalSets: 34, end: 1 } };
    assert.deepEqual(P.trainedDates({}, sess), ['2026-08-31']);
  });

  it('явний 0 у workLog і далі перекриває таку сесію', () => {
    const sess = { '2026-08-31': { done: 0, total: 14, doneSets: 4, totalSets: 34 } };
    assert.deepEqual(P.trainedDates({ '2026-08-31': 0 }, sess), []);
  });
});

/*
 * Час сесій і рекорди (TST-006).
 *
 * Чотири функції не виконувались жодним тестом, і виживали мутанти:
 * нульові сесії в статистиці, знята стеля 6 годин, вікно 31 день замість
 * 30 (це вже був баг, описаний у коментарі коду), ±10 % замість ±5 %,
 * «перший запис — рекорд». Найдорожчий тут — legacy: у бойовій базі є
 * сесії з t0 === t1, і поведінку на них треба закріпити, а не покладатись
 * на те, що вона правильна сьогодні.
 */
describe('Тривалість сесії', () => {
  const s = (t0, t1) => ({ done: 1, total: 1, doneSets: 1, totalSets: 1, t0: t0, t1: t1 });
  const T = Date.UTC(2026, 7, 17, 10, 0, 0);

  it('legacy без часу: t0 === t1 не дає нуля, а дає «немає даних»', () => {
    assert.equal(P.sessionMinutes(s(T, T)), null);
  });

  it('півхвилини — не тренування', () => {
    assert.equal(P.sessionMinutes(s(T, T + 30 * 1000)), null);
  });

  it('понад 6 годин — забута вкладка', () => {
    assert.equal(P.sessionMinutes(s(T, T + 361 * 60000)), null);
    assert.equal(P.sessionMinutes(s(T, T + 360 * 60000)), 360, 'рівно 6 годин ще рахуються');
  });

  it('нормальна сесія рахується як є', () => {
    assert.equal(P.sessionMinutes(s(T, T + 45 * 60000)), 45);
  });

  it('відсутній або зіпсований знімок часу', () => {
    for (const bad of [undefined, null, {}, { t0: 'ой', t1: 'ай' }, s(T, T - 1000)]) {
      assert.equal(P.sessionMinutes(bad), null, JSON.stringify(bad));
    }
  });

  it('timeStats рахує лише сесії з часом, legacy не псує середню', () => {
    const log = {
      '2026-08-10': s(T, T + 40 * 60000),
      '2026-08-12': s(T, T),                    // legacy: часу немає
      '2026-08-14': s(T, T + 60 * 60000),
      '2026-08-16': { done: 1, total: 1, doneSets: 1, totalSets: 1 }  // зовсім без t0/t1
    };
    const st = P.timeStats(log, 30, NOW);
    assert.equal(st.count, 2, 'у статистику йдуть лише дві сесії з часом');
    assert.equal(st.avgMin, 50);
    assert.equal(st.totalMin, 100);
  });

  it('немає жодної сесії з часом — null, а не нулі', () => {
    assert.equal(P.timeStats({ '2026-08-10': s(T, T) }, 30, NOW), null);
  });
});

describe('Вікно періоду і рекорди', () => {
  it('30 днів — це 30 днів, включно з сьогоднішнім', () => {
    /* Мутант «31 день» виживав, а розбіжність із rating-core вже одного
       разу давала різні знаменники в двох модулях. */
    const log = {
      '2026-07-19': { done: 1, total: 1, doneSets: 1, totalSets: 1, t0: 1, t1: 1 + 30 * 60000 },
      '2026-07-18': { done: 1, total: 1, doneSets: 1, totalSets: 1, t0: 1, t1: 1 + 30 * 60000 }
    };
    const st = P.timeStats(log, 30, NOW);
    assert.equal(st.count, 1, '18 липня вже поза вікном 30 днів від 17 серпня');
  });

  it('перший запис вправи рекордом не вважається', () => {
    const H = ctx.HistoryCore;
    let log = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    assert.deepEqual(P.prList(log, 30, NOW), [], 'одна точка — це відлік, а не рекорд');

    log = H.appendWeight(log, 'Жим', 105, '2026-08-10');
    const prs = P.prList(log, 30, NOW);
    assert.equal(prs.length, 1);
    assert.equal(prs[0].kg, 105);
    assert.equal(prs[0].isNew, true, '10 серпня — у вікні 30 днів від 17 серпня');
  });

  it('зниження ваги рекордом не робить', () => {
    const H = ctx.HistoryCore;
    let log = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    log = H.appendWeight(log, 'Жим', 90, '2026-08-10');
    assert.deepEqual(P.prList(log, 30, NOW), []);
  });
});

/*
 * ПІДХОДИ ЯК МЕТРИКА ОБʼЄМУ (D8)
 *
 * У знімку сесії лежать три числа про обʼєм, і вони РІЗНІ за
 * походженням:
 *
 *   sets — закриті підходи. Це ВИМІР: людина тапнула кружечок.
 *   reps — підходи × середина запланованого діапазону. Оцінка.
 *   vol  — підходи × ту саму оцінку × вагу. Оцінка на оцінці.
 *
 * Показувався досі лише тоннаж, тобто найменш надійне з трьох. Графік
 * тоннажу за тиждень свого часу вирізали свідомо («сирі кілограми нічого
 * не кажуть про дисципліну») — і на його місці не лишилось нічого
 * виміряного. setsStats повертає саме виміряне.
 *
 * ВІКНО РАХУЄТЬСЯ В ТРЕНУВАННЯХ, А НЕ В ДНЯХ. Тиждень із трьох сесій і
 * тиждень із пʼяти дають різні числа навіть за однакової роботи в
 * кожній; вікно, індексоване сесіями, порівнює подібне з подібним.
 */
describe('Підходи як метрика обʼєму', () => {
  const w = (sets) => ({ done: 5, total: 5, doneSets: sets, totalSets: sets, sets: sets });

  it('бере саме останні N тренувань, а не останні N днів', () => {
    const log = {
      '2026-08-01': w(10), '2026-08-03': w(10),   // поза вікном
      '2026-08-10': w(20), '2026-08-12': w(22), '2026-08-14': w(24)
    };
    const st = P.setsStats(log, 3, NOW);
    assert.equal(st.count, 3);
    assert.equal(st.total, 66);
    assert.equal(st.perSession, 22);
  });

  it('попереднє вікно віддається поруч — із нього й видно зростання', () => {
    const log = {
      '2026-08-01': w(10), '2026-08-03': w(10),
      '2026-08-10': w(20), '2026-08-12': w(20)
    };
    const st = P.setsStats(log, 2, NOW);
    assert.equal(st.perSession, 20);
    assert.equal(st.prev.perSession, 10);
    assert.equal(st.deltaPct, 100, 'обʼєм подвоївся, а зростання не видно');
  });

  it('старі записи без підходів не псують середню й не рахуються', () => {
    const log = {
      '2026-08-10': { done: 5, total: 5 },        // legacy: sets немає
      '2026-08-12': w(20), '2026-08-14': w(20)
    };
    const st = P.setsStats(log, 7, NOW);
    assert.equal(st.count, 2, 'legacy-сесія потрапила у вікно');
    assert.equal(st.perSession, 20);
  });

  it('замало даних — null, а не нулі', () => {
    assert.equal(P.setsStats({}, 7, NOW), null);
    assert.equal(P.setsStats({ '2026-08-10': { done: 1, total: 1 } }, 7, NOW), null);
  });

  it('попереднього вікна ще немає — prev null, а не вигадане зростання', () => {
    const st = P.setsStats({ '2026-08-10': w(20), '2026-08-12': w(20) }, 2, NOW);
    assert.equal(st.prev, null);
    assert.equal(st.deltaPct, null);
  });

  it('майбутні дати у вікно не беруться', () => {
    const log = { '2026-08-10': w(10), '2026-08-12': w(10), '2026-12-01': w(99) };
    assert.equal(P.setsStats(log, 3, NOW).total, 20);
  });
});
