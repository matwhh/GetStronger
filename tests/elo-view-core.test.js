/**
 * ПОКАЗ РЕЙТИНГУ: групування подій і підсумки сезонів.
 *
 * Це читальна частина рейтингу — те, що людина бачить на rating.html і
 * seasons.html. Ламається вона тихо: числа лишаються на екрані, просто
 * стають неправдою. Тому найважливіші перевірки тут не «чи є результат»,
 * а рівно три:
 *
 *   • день складається з ПОДІЙ ЦЬОГО дня, і сума дня — сума їхніх дельт;
 *   • ELO на кінець дня беремо з події, у якої воно справжнє: тижнева
 *     оцінка пише elo_after = 0, і показати той нуль означало б написати
 *     людині, що вона обнулилась;
 *   • ширина смуги сезону пропорційна ELO і міряється від стелі сезону,
 *     а не від власного максимуму — інакше 300 і 320 виглядають як
 *     прірва, а 2400 і 2500 як однакові.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { EloView: V } = loadModules(['js/date-core.js', 'js/elo-view-core.js']);

const ev = (day, delta, extra) => Object.assign({ day, delta, category: 'training', reason: 'дія' }, extra || {});

/* ------------------------------------------------------------------ */
describe('дати людською', () => {
  test('число й місяць у родовому — «13 вересня»', () => {
    assert.equal(V.human('2026-09-13'), '13 вересня');
    assert.equal(V.human('2026-01-01', true), '1 січня 2026');
  });

  test('сміття не стає датою', () => {
    assert.equal(V.human('не дата'), '');
    assert.equal(V.human(''), '');
    assert.equal(V.human('2026-13-01'), '', '13-го місяця не буває');
  });

  test('сьогодні й вчора — словами, далі — дата', () => {
    assert.equal(V.dayLabel('2026-09-13', '2026-09-13'), 'Сьогодні');
    assert.equal(V.dayLabel('2026-09-12', '2026-09-13'), 'Вчора');
    assert.equal(V.dayLabel('2026-09-11', '2026-09-13'), '11 вересня');
  });

  test('межа місяця не ламає «вчора»', () => {
    assert.equal(V.dayLabel('2026-08-31', '2026-09-01'), 'Вчора');
    assert.equal(V.dayLabel('2025-12-31', '2026-01-01'), 'Вчора');
  });

  test('без сьогоднішнього дня лишається дата, а не порожнеча', () => {
    assert.equal(V.dayLabel('2026-09-13', ''), '13 вересня');
  });
});

/* ------------------------------------------------------------------ */
describe('категорії подій', () => {
  /*
   * Перелік мусить збігатись із CHECK у базі. Досі клієнт знав лише
   * пʼять категорій із восьми, і тижневий бонус, штраф та адмінська
   * правка показувались зовсім без підпису — тобто саме ті події, яких
   * людина не розуміє без пояснення.
   */
  test('усі вісім категорій бази мають підпис', () => {
    const db = ['training', 'nutrition', 'sleep', 'recovery', 'activity',
                'penalty', 'bonus', 'admin'];
    const без = db.filter((c) => !V.CATEGORIES[c]);
    assert.equal(без.join(', '), '', 'без підпису: ' + без.join(', '));
  });

  test('штраф позначений як такий, а не як нарахування', () => {
    assert.equal(V.CATEGORIES.penalty.tone, 'minus');
    assert.equal(V.CATEGORIES.bonus.tone, 'plus');
    assert.equal(V.CATEGORIES.admin.tone, 'flat');
  });

  test('невідома категорія показує свій код, а не порожнечу', () => {
    assert.equal(V.catLabel('чогось-такого-немає'), 'чогось-такого-немає');
    assert.equal(V.catLabel(null), '—');
  });
});

/* ------------------------------------------------------------------ */
describe('події → дні', () => {
  test('події одного дня стають одним днем, сума — їхня сума', () => {
    const g = V.groupByDay([ev('2026-09-13', 5), ev('2026-09-13', 2), ev('2026-09-12', -3)]);
    assert.equal(g.length, 2);
    assert.equal(g[0].day, '2026-09-13');
    assert.equal(g[0].sum, 7);
    assert.equal(g[0].count, 2);
    assert.equal(g[1].sum, -3);
  });

  test('порядок входу зберігається — сервер уже відсортував', () => {
    const g = V.groupByDay([ev('2026-09-10', 1), ev('2026-09-13', 1), ev('2026-09-11', 1)]);
    assert.equal(g.map((x) => x.day).join(','), '2026-09-10,2026-09-13,2026-09-11');
  });

  test('день той самий, навіть якщо його події не поспіль', () => {
    const g = V.groupByDay([ev('2026-09-13', 1), ev('2026-09-12', 1), ev('2026-09-13', 1)]);
    assert.equal(g.length, 2, 'день розпався на два');
    assert.equal(g[0].count, 2);
  });

  test('ELO на кінець дня — з останньої за часом події дня', () => {
    /* Вхід іде від найновішого, тож перша подія дня і є останньою за часом. */
    const g = V.groupByDay([ev('2026-09-13', 2, { eloAfter: 412 }), ev('2026-09-13', 5, { eloAfter: 410 })]);
    assert.equal(g[0].eloAfter, 412);
  });

  test('нуль від тижневої оцінки не стає станом рахунку', () => {
    /* elo_eval_week пише elo_after = 0: там підсумок тижня, а не рахунок.
       Показати той нуль означало б написати людині, що вона обнулилась. */
    const g = V.groupByDay([
      ev('2026-09-13', -12, { category: 'penalty', eloAfter: 0 }),
      ev('2026-09-13', 3, { eloAfter: 398 })
    ]);
    assert.equal(g[0].eloAfter, 398);
  });

  test('день зовсім без ELO — null, а не нуль', () => {
    const g = V.groupByDay([ev('2026-09-13', -12, { category: 'penalty', eloAfter: 0 })]);
    assert.equal(g[0].eloAfter, null);
  });

  test('сміття пропускається мовчки, решта дня лишається', () => {
    const g = V.groupByDay([
      null, 'рядок', { day: 'не дата', delta: 5 }, { day: '2026-09-13', delta: 'багато' },
      ev('2026-09-13', 4)
    ]);
    assert.equal(g.length, 1);
    assert.equal(g[0].sum, 4);
  });

  test('порожній вхід — порожній вихід, без винятку', () => {
    /* Порівнюємо довжину, а не deepEqual із []: модуль виконується в
       окремій пісочниці (tests/helpers.js), і його Array — інший клас. */
    assert.equal(V.groupByDay(null).length, 0);
    assert.equal(V.groupByDay([]).length, 0);
  });
});

/* ------------------------------------------------------------------ */
describe('підсумок стрічки', () => {
  const list = [ev('2026-09-13', 5), ev('2026-09-12', 2), ev('2026-09-07', -3)];

  test('без межі рахує все', () => {
    const s = V.eventsSummary(list);
    assert.equal(s.count, 3);
    assert.equal(s.sum, 4);
    assert.equal(s.days, 3);
    assert.equal(s.latest, '2026-09-13');
  });

  test('із межею сума лише з неї, а кількість подій — уся', () => {
    const s = V.eventsSummary(list, '2026-09-08');
    assert.equal(s.sum, 7, 'у суму тижня заліз день до понеділка');
    assert.equal(s.countWithin, 2);
    assert.equal(s.count, 3);
  });

  test('межа включна — понеділок належить тижню', () => {
    assert.equal(V.eventsSummary([ev('2026-09-07', 9)], '2026-09-07').sum, 9);
  });
});

/* ------------------------------------------------------------------ */
describe('підсумки завершених сезонів', () => {
  const H = [
    { season: '2026-S2', elo: 2100, level: 10, elite: true,  rank: 1, of: 50, percentile: 2,   daysActive: 80, daysTotal: 91, graceUsed: 0 },
    { season: '2026-S1', elo: 1200, level: 7,  elite: false, rank: 3, of: 40, percentile: 7.5, daysActive: 60, daysTotal: 92, graceUsed: 1 }
  ];

  test('порожня історія не вигадує підсумків', () => {
    const s = V.seasonStats([]);
    assert.equal(s.seasons, 0);
    assert.equal(s.best, null);
    assert.equal(s.bestRank, null);
    assert.equal(s.avgElo, null);
    assert.equal(s.consistency, null);
    assert.equal(s.delta, null);
  });

  test('найкращий сезон — за ELO, з назвою сезону', () => {
    const s = V.seasonStats(H);
    assert.equal(s.seasons, 2);
    assert.equal(s.best.elo, 2100);
    assert.equal(s.best.season, '2026-S2');
    assert.equal(s.best.elite, true);
  });

  test('найкраще місце — найМЕНШЕ число, а не найбільше', () => {
    const s = V.seasonStats(H);
    assert.equal(s.bestRank.rank, 1);
    assert.equal(s.bestPercentile.percentile, 2);
  });

  test('сезон без місця не дає «місце 0»', () => {
    /* Нуль тут виглядав би як перше місце, і навіть краще за нього. */
    const s = V.seasonStats([{ season: '2026-S1', elo: 300, level: 2, rank: null, percentile: null }]);
    assert.equal(s.bestRank, null);
    assert.equal(s.bestPercentile, null);
  });

  test('дні, grace і ELITE додаються за всі сезони', () => {
    const s = V.seasonStats(H);
    assert.equal(s.daysActive, 140);
    assert.equal(s.daysTotal, 183);
    assert.equal(s.consistency, 77);
    assert.equal(s.graceUsed, 1);
    assert.equal(s.eliteSeasons, 1);
    assert.equal(s.avgElo, 1650);
  });

  test('порядок входу не важить — сезони впорядковуються самі', () => {
    const a = V.seasonStats(H);
    const b = V.seasonStats(H.slice().reverse());
    assert.equal(a.last.season, b.last.season, 'останній сезон залежить від порядку входу');
    assert.equal(a.last.season, '2026-S2');
    assert.equal(a.first.season, '2026-S1');
  });

  test('остання зміна — останній сезон проти попереднього', () => {
    assert.equal(V.seasonStats(H).delta, 900);
    assert.equal(V.seasonStats([H[0]]).delta, null, 'одного сезону замало для зміни');
  });
});

/* ------------------------------------------------------------------ */
describe('драбина сезонів — смуга на сезон', () => {
  const H = [
    { season: '2026-S1', elo: 1250, level: 7 },
    { season: '2026-S2', elo: 2500, level: 10, elite: true }
  ];

  test('ширина пропорційна ELO і міряється від стелі сезону', () => {
    const b = V.seasonLadder(H, 2500);
    assert.equal(b[0].pct, 50, 'половина стелі — половина смуги');
    assert.equal(b[1].pct, 100);
  });

  test('стеля та сама для всіх — слабкі сезони не розтягуються на всю ширину', () => {
    const b = V.seasonLadder([{ season: '2026-S1', elo: 300 }, { season: '2026-S2', elo: 320 }], 2500);
    assert.ok(b[0].pct < 15 && b[1].pct < 15, 'два слабкі сезони зайняли всю ширину: ' +
      b.map((x) => x.pct).join(', '));
  });

  test('сезони йдуть від найстарішого до найновішого', () => {
    const b = V.seasonLadder(H.slice().reverse(), 2500);
    assert.equal(b.map((x) => x.season).join(','), '2026-S1,2026-S2');
  });

  test('поточний сезон домальовується останнім і позначений', () => {
    const b = V.seasonLadder(H, 2500, { season: '2026-S3', elo: 500, level: 3 });
    assert.equal(b.length, 3);
    assert.equal(b[2].season, '2026-S3');
    assert.equal(b[2].current, true);
    assert.equal(b[2].pct, 20);
    assert.equal(b[0].current, false);
  });

  test('нуль лишається нулем — смуги немає', () => {
    const b = V.seasonLadder([{ season: '2026-S1', elo: 0 }], 2500);
    assert.equal(b[0].pct, 0);
  });

  test('без стелі шкала береться з даних, а не ділиться на нуль', () => {
    const b = V.seasonLadder(H, 0);
    assert.equal(b[1].pct, 100);
    assert.ok(Number.isFinite(b[0].pct));
    assert.equal(V.seasonLadder([], 0).length, 0);
  });
});
