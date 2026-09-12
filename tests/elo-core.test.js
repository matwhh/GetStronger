/**
 * Сезонний ELO (js/elo-core.js): сезони, рівні, дії, бонуси, стелі.
 * Баланс (цілі по профілях користувачів) перевіряє tools/simelo.mjs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModules } from './helpers.js';

const E = loadModules(['js/date-core.js', 'js/elo-core.js']).EloCore;
const CFG = JSON.parse(readFileSync(new URL('../db/elo-config.json', import.meta.url), 'utf8'));

describe('ELO: сезони', () => {
  it('чотири сезони за місяцями', () => {
    assert.equal(E.seasonOf(new Date(2026, 2, 1)), 'SPRING-2026');
    assert.equal(E.seasonOf(new Date(2026, 4, 31)), 'SPRING-2026');
    assert.equal(E.seasonOf(new Date(2026, 5, 1)), 'SUMMER-2026');
    assert.equal(E.seasonOf(new Date(2026, 8, 15)), 'AUTUMN-2026');
    /* 1 грудня 2026 — вівторок, тобто ще осінь: зима починається в
       понеділок 7-го (див. «сезон закінчується в неділю» нижче). */
    assert.equal(E.seasonOf(new Date(2026, 11, 7)), 'WINTER-2026');
  });

  it('зима належить року свого грудня', () => {
    assert.equal(E.seasonOf(new Date(2027, 0, 20)), 'WINTER-2026');
    assert.equal(E.seasonOf(new Date(2027, 1, 28)), 'WINTER-2026');
  });

  it('межі сезону обіймають свої місяці, з поправкою на тиждень', () => {
    const [a, b] = E.seasonRange('WINTER-2026');
    assert.equal(a.getMonth(), 11); assert.equal(a.getFullYear(), 2026);
    assert.equal(b.getMonth(), 1); assert.equal(b.getFullYear(), 2027);
  });
});

/* =========================================================================
   МЕЖА СЕЗОНУ = МЕЖА ТИЖНЯ

   Сезон рахує ТИЖНЕВІ цілі, а календарний квартал у тижні не ділиться:
   1 вересня 2026 — вівторок, і перший тиждень сезону виходив обрубком, за
   який людина отримувала повний тижневий штраф. Тому кінець сезону —
   найближча неділя на або після останнього дня кварталу, а початок —
   наступний понеділок.

   Правило введене НЕ заднім числом: осінь-2026 уже йшла з 1 вересня, і за
   1–6 вересня вже нараховано ELO. Зсунути її початок означало б викинути
   ці дні з поточного сезону. Тому осінь лишається з 1 вересня, але
   закінчується в неділю 6 грудня — а з зими-2026 кожен сезон є цілим
   числом тижнів.
   ========================================================================= */
describe('ELO: сезон закінчується в неділю', () => {
  const f = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                   '-' + String(d.getDate()).padStart(2, '0');
  /* 0 = неділя в getDay() */
  const isSunday = (d) => d.getDay() === 0;
  const isMonday = (d) => d.getDay() === 1;

  it('перехідна осінь-2026: старт не зсувається, кінець — у неділю', () => {
    const [a, b] = E.seasonRange('AUTUMN-2026');
    assert.equal(f(a), '2026-09-01', 'старт мусить лишитись, інакше ELO за 1–6 вересня зникає');
    assert.equal(f(b), '2026-12-06');
    assert.ok(isSunday(b));
  });

  it('з зими-2026 кожен сезон — понеділок…неділя', () => {
    for (const code of ['WINTER-2026', 'SPRING-2027', 'SUMMER-2027', 'AUTUMN-2027', 'WINTER-2027']) {
      const [a, b] = E.seasonRange(code);
      assert.ok(isMonday(a), code + ' починається не в понеділок: ' + f(a));
      assert.ok(isSunday(b), code + ' закінчується не в неділю: ' + f(b));
      const days = Math.round((b - a) / 86400000) + 1;
      assert.equal(days % 7, 0, code + ' не ціле число тижнів: ' + days);
    }
  });

  it('сезони стикуються без дірок і без нахлесту', () => {
    const chain = ['AUTUMN-2026', 'WINTER-2026', 'SPRING-2027', 'SUMMER-2027', 'AUTUMN-2027'];
    for (let i = 1; i < chain.length; i++) {
      const prevEnd = E.seasonRange(chain[i - 1])[1];
      const start = E.seasonRange(chain[i])[0];
      assert.equal(Math.round((start - prevEnd) / 86400000), 1,
        chain[i - 1] + ' → ' + chain[i] + ': ' + f(prevEnd) + ' / ' + f(start));
    }
  });

  /*
   * Таблиця звірена з БОЙОВОЮ базою 2026-09-09: та сама десятка сезонів,
   * порахована серверною season_bounds після міграції
   * db/season-week-bounds.sql, збіглась із цими числами день у день.
   * Тут вона лежить як запобіжник від розходження: клієнт і сервер
   * рахують сезон незалежно, і розбіжність у межах не помітна на око —
   * обидва просто показують свій «день N із M», а закривається сезон за
   * серверним.
   */
  it('межі збігаються з тими, що рахує сервер', () => {
    const table = [
      ['WINTER-2026', '2026-12-07', '2027-02-28', 84],
      ['SPRING-2027', '2027-03-01', '2027-06-06', 98],
      ['SUMMER-2027', '2027-06-07', '2027-09-05', 91],
      ['AUTUMN-2027', '2027-09-06', '2027-12-05', 91],
      ['WINTER-2027', '2027-12-06', '2028-03-05', 91],
      ['SPRING-2028', '2028-03-06', '2028-06-04', 91],
      ['SUMMER-2028', '2028-06-05', '2028-09-03', 91],
      ['AUTUMN-2028', '2028-09-04', '2028-12-03', 91],
      ['WINTER-2028', '2028-12-04', '2029-03-04', 91],
      ['SPRING-2029', '2029-03-05', '2029-06-03', 91]
    ];
    for (const [code, a, b, days] of table) {
      const r = E.seasonRange(code);
      assert.equal(f(r[0]), a, code + ' початок');
      assert.equal(f(r[1]), b, code + ' кінець');
      assert.equal(Math.round((r[1] - r[0]) / 86400000) + 1, days, code + ' днів');
    }
  });

  it('старі сезони не зсунуті: правило діє лише з 2026-09-01', () => {
    assert.equal(f(E.seasonRange('SUMMER-2026')[1]), '2026-08-31');
    assert.equal(f(E.seasonRange('SPRING-2026')[1]), '2026-05-31');
  });

  it('seasonOf узгоджений із межами на самих стиках', () => {
    const cases = [
      ['2026-08-31', 'SUMMER-2026'], ['2026-09-01', 'AUTUMN-2026'],
      ['2026-11-30', 'AUTUMN-2026'], ['2026-12-06', 'AUTUMN-2026'],
      ['2026-12-07', 'WINTER-2026'], ['2027-02-28', 'WINTER-2026'],
      ['2027-03-01', 'SPRING-2027'], ['2027-06-06', 'SPRING-2027'],
      ['2027-06-07', 'SUMMER-2027']
    ];
    for (const [iso, code] of cases) {
      const p = iso.split('-').map(Number);
      assert.equal(E.seasonOf(new Date(p[0], p[1] - 1, p[2])), code, iso);
    }
  });

  it('кожен день року потрапляє рівно в той сезон, чиї межі його містять', () => {
    for (let i = 0; i < 900; i++) {
      const d = new Date(2026, 0, 1 + i);
      const code = E.seasonOf(d);
      const [a, b] = E.seasonRange(code);
      assert.ok(d >= a && d <= b, f(d) + ' → ' + code + ' (' + f(a) + '…' + f(b) + ')');
    }
  });
});

describe('ELO: рівні 0–2500', () => {
  it('рівні рівномірні по 200', () => {
    assert.equal(E.levelFor(0, CFG).level, 1);
    assert.equal(E.levelFor(199, CFG).level, 1);
    assert.equal(E.levelFor(200, CFG).level, 2);
    assert.equal(E.levelFor(999, CFG).level, 5);
    assert.equal(E.levelFor(1799, CFG).level, 9);
    assert.equal(E.levelFor(1800, CFG).level, 10);
  });

  it('2000+ — Level 10 ELITE, а не Level 11', () => {
    const a = E.levelFor(1942, CFG), b = E.levelFor(2247, CFG);
    assert.equal(a.level, 10); assert.equal(a.elite, false); assert.equal(a.name, 'Level 10');
    assert.equal(b.level, 10); assert.equal(b.elite, true); assert.equal(b.name, 'Level 10 — ELITE');
  });

  it('межа ELITE — РІВНО на eliteFloor, не на одиницю далі', () => {
    /*
     * TST-003: тести брали 1942 і 2247, тобто саму межу не чіпали. Мутант
     * «>= → >» виживав: людина з рівно 2000 ELO переставала бути ELITE, і
     * помітити це можна було тільки очима — levelFor читають season.js,
     * app.js, today.js і admin-elo.js.
     */
    assert.equal(E.levelFor(1999, CFG).elite, false);
    assert.equal(E.levelFor(2000, CFG).elite, true);
    assert.equal(E.levelFor(2000, CFG).floor, 2000);
    assert.equal(E.levelFor(2000, CFG).name, 'Level 10 — ELITE');
    /* Межа береться з конфігу, а не з числа 2000 у коді. */
    assert.equal(E.levelFor(CFG.eliteFloor, CFG).elite, true);
    assert.equal(E.levelFor(CFG.eliteFloor - 1, CFG).elite, false);
  });

  it('стеля 2500', () => {
    assert.equal(E.clampElo(2600, CFG), 2500);
    assert.equal(E.clampElo(-50, CFG), 0);
    assert.equal(E.levelFor(2500, CFG).pct, 100);
  });
});

describe('ELO: власний план — однакова ціна за однакове виконання', () => {
  it('4/тиж і 6/тиж на 100% дають однаковий тижневий ELO', () => {
    const w4 = E.actionDelta('workout', { done: 14, total: 14 }, CFG, { plannedDays: 4 }).delta * 4;
    const w6 = E.actionDelta('workout', { done: 14, total: 14 }, CFG, { plannedDays: 6 }).delta * 6;
    assert.ok(Math.abs(w4 - w6) <= 4, w4 + ' vs ' + w6); // похибка округлення
  });
});

describe('ELO: tolerance-зони', () => {
  it('тренування: повне > часткового > провального', () => {
    const ctx = { plannedDays: 4 };
    const full = E.actionDelta('workout', { done: 14, total: 14 }, CFG, ctx).delta;
    const most = E.actionDelta('workout', { done: 13, total: 14 }, CFG, ctx).delta;
    const half = E.actionDelta('workout', { done: 7, total: 14 }, CFG, ctx).delta;
    const none = E.actionDelta('workout', { done: 1, total: 14 }, CFG, ctx).delta;
    assert.ok(full > most && most > half && half > none && none >= 0,
      [full, most, half, none].join(' > '));
  });

  it('білок за прикладом ТЗ: 180→повна, 171→трохи менше, 150→часткова, 100→мала', () => {
    const meal = (p) => E.actionDelta('meal', { kcal: 2600, target: 2600, protein: p, proteinTarget: 180 }, CFG).delta;
    const a = meal(180), b = meal(171), c = meal(150), d = meal(100);
    assert.ok(a >= b && b > c && c > d && d >= 0, [a, b, c, d].join(' ≥ '));
  });

  it('калорії: невеликий перебір і недобір караються однаково мʼяко', () => {
    const meal = (k) => E.actionDelta('meal', { kcal: k, target: 2600, protein: 170, proteinTarget: 170 }, CFG).delta;
    assert.equal(meal(2600 * 1.04), meal(2600 * 0.96));
    assert.ok(meal(2600) > meal(2600 * 1.3));
  });

  it('сон проти власної цілі', () => {
    const s = (m) => E.actionDelta('sleep', { minutes: m, goal: 480 }, CFG).delta;
    assert.ok(s(480) > s(430) && s(430) > s(360) && s(360) >= s(200));
  });

  it('recovery: чесне «мені погано» все одно щось дає', () => {
    const bad = E.actionDelta('recovery', { value: 3 }, CFG).delta;
    const good = E.actionDelta('recovery', { value: 9 }, CFG).delta;
    const none = E.actionDelta('recovery', { value: null }, CFG).delta;
    assert.ok(good > bad && bad > 0 && none === 0);
  });
});

describe('ELO: grace week', () => {
  it('тренування без grace дає ELO, з grace — нуль (і нуль штрафів)', () => {
    const on = E.actionDelta('workout', { done: 14, total: 14 }, CFG, { plannedDays: 4, grace: true });
    assert.equal(on.delta, 0);
    assert.equal(E.weekPenalty(0, 4, 7, CFG), 0);
  });

  it('півтижня grace — штраф лише за неgrace-половину плану', () => {
    assert.equal(E.weekPenalty(0, 4, 4, CFG), Math.round(4 * (1 - 4 / 7)) * CFG.missedWorkoutPenalty);
  });

  it('без grace недобір карається за кожен пропуск', () => {
    assert.equal(E.weekPenalty(2, 4, 0, CFG), 2 * CFG.missedWorkoutPenalty);
    assert.ok(E.weekPenalty(2, 4, 0, CFG) < 0);
  });
});

describe('ELO: бонуси і стелі дня', () => {
  it('чистий день вимагає УСІ категорії вище порога', () => {
    const good = { training: 1, nutrition: 0.95, sleep: 1, recovery: 1, activity: 0.92 };
    assert.equal(E.cleanDay(good, true, CFG), true);
    assert.equal(E.cleanDay({ ...good, nutrition: 0.5 }, true, CFG), false);
  });

  it('день відпочинку не вимагає тренування', () => {
    assert.equal(E.cleanDay({ nutrition: 1, sleep: 1, recovery: 1, activity: 1 }, false, CFG), true);
  });

  it('втрати дня впираються в підлогу, здобутки — у стелю', () => {
    assert.equal(E.applyDayCaps([-10, -10, -10], CFG), CFG.dayLossFloor);
    assert.equal(E.applyDayCaps([30, 30, 30], CFG), CFG.dayGainCap);
    assert.equal(E.applyDayCaps([5, -3], CFG), 2);
  });
});

/* =========================================================================
   Пропорційне тренування (етап «завершення тренування»).
   Дзеркало серверної db/elo-proportional.sql: earned = base × done/total,
   БЕЗ драбини; частка по підходах, коли запис їх має.
   ========================================================================= */
describe('ELO: пропорційне тренування', () => {
  const base = (days) =>
    CFG.weeklyBudget * CFG.categoryShare * CFG.weights.training / days;

  it('лінійно за спекою: 0/1/5/15/29/30 із 30 (6 днів)', () => {
    const d = (done) =>
      E.actionDelta('workout', { done, total: 30 }, CFG, { plannedDays: 6 }).delta;
    for (const done of [0, 1, 5, 15, 29, 30]) {
      assert.equal(d(done), Math.round(base(6) * done / 30), 'done=' + done);
    }
  });

  it('quality — сира частка, без сходинок драбини', () => {
    const q = (done, total) =>
      E.actionDelta('workout', { done, total }, CFG, { plannedDays: 4 }).quality;
    assert.equal(q(7, 14), 0.5);
    assert.equal(q(0, 14), 0);
    assert.equal(q(14, 14), 1);
  });

  it('підходи точніші за вправи: частка береться з doneSets/totalSets', () => {
    const r = E.actionDelta('workout',
      { done: 3, total: 8, doneSets: 10, totalSets: 20 }, CFG, { plannedDays: 3 });
    assert.equal(r.quality, 0.5);
    assert.equal(r.delta, Math.round(base(3) * 0.5));
  });

  it('накрутка понад план клампиться: doneSets=99 із 20 — не більше повної', () => {
    const cheat = E.actionDelta('workout',
      { done: 8, total: 8, doneSets: 99, totalSets: 20 }, CFG, { plannedDays: 3 });
    const full = E.actionDelta('workout',
      { done: 8, total: 8, doneSets: 20, totalSets: 20 }, CFG, { plannedDays: 3 });
    assert.equal(cheat.delta, full.delta);
    assert.equal(cheat.quality, 1);
  });

  it('grace week: тренування коштує нуль, як і раніше', () => {
    const g = E.actionDelta('workout',
      { done: 20, total: 20, doneSets: 60, totalSets: 60 }, CFG,
      { plannedDays: 6, grace: true });
    assert.equal(g.delta, 0);
  });
});

/* =========================================================================
   День сезону: рахується по КАЛЕНДАРНИХ днях.
   Було Math.round((now - start)/доба)+1 — після полудня першого дня
   пів доби округлялось до цілої і показувалось «2/91» у перший же день.
   ========================================================================= */
describe('ELO: день сезону', () => {
  it('перший день сезону — 1, о будь-якій годині', () => {
    for (const h of [0, 9, 12, 13, 18, 23]) {
      const d = E.seasonDay('AUTUMN-2026', new Date(2026, 8, 1, h, 30));
      assert.equal(d.passed, 1, 'о ' + h + ':30 → ' + d.passed);
    }
  });

  /* 97, а не 91: перехідна осінь тягнеться до неділі 6 грудня. */
  it('осінь-2026 має 97 днів — до неділі 6 грудня', () => {
    assert.equal(E.seasonDay('AUTUMN-2026', new Date(2026, 8, 1)).total, 97);
  });

  it('другий день — рівно 2, останній — total', () => {
    assert.equal(E.seasonDay('AUTUMN-2026', new Date(2026, 8, 2, 23, 59)).passed, 2);
    assert.equal(E.seasonDay('AUTUMN-2026', new Date(2026, 11, 6, 1)).passed, 97);
  });

  it('поза межами сезону значення затиснуті, а не відʼємні', () => {
    assert.equal(E.seasonDay('AUTUMN-2026', new Date(2026, 7, 20)).passed, 1);
    assert.equal(E.seasonDay('AUTUMN-2026', new Date(2026, 11, 25)).passed, 97);
  });

  it('зима переходить через рік і рахується так само', () => {
    /* Зима-2026 починається 7 грудня: 1-й день — 7-е, 1 січня — 26-й. */
    assert.equal(E.seasonDay('WINTER-2026', new Date(2026, 11, 7, 15)).passed, 1);
    assert.equal(E.seasonDay('WINTER-2026', new Date(2027, 0, 1, 15)).passed, 26);
  });
});

/* ==========================================================================
   ПІДСУМОК ЗА ПЕРІОД — sumFrom
   ==========================================================================
   Панель рейтингу показувала приріст ЗА СЬОГОДНІ, і це число майже
   завжди нуль або трійка: більшість днів дає одну-дві дії, а день
   відпочинку — жодної. Людина дивилась на «+0 ELO» і робила з цього
   висновок про застій, хоч за тиждень набігало двадцять. Тиждень —
   природний крок цієї системи (бюджет ELO тижневий, план тренувань
   тижневий, штраф за пропуск теж рахується по тижню), тому й підсумок
   у шапці тепер тижневий.

   Стережеться найтихіше: межа ВКЛЮЧНА. Понеділок мусить потрапити в
   «цей тиждень», інакше число щопонеділка починається з нуля вже після
   ранкового тренування.
   ========================================================================== */
describe('sumFrom — приріст ELO з дня', () => {
  const EV = [
    { day: '2026-09-07', delta: 3,  reason: 'тренування' },
    { day: '2026-09-08', delta: 4,  reason: 'тренування' },
    { day: '2026-09-06', delta: 5,  reason: 'минулий тиждень' },
    { day: '2026-09-09', delta: -2, reason: 'штраф' }
  ];

  it('рахує з понеділка включно', () => {
    assert.equal(E.sumFrom(EV, '2026-09-07'), 5);
  });

  it('минулий тиждень не потрапляє', () => {
    assert.equal(E.sumFrom(EV, '2026-09-08'), 2);
  });

  it('відʼємні дельти віднімаються, а не ігноруються', () => {
    assert.equal(E.sumFrom([{ day: '2026-09-09', delta: -7 }], '2026-09-07'), -7);
  });

  it('порожнеча й сміття дають нуль, а не падіння', () => {
    assert.equal(E.sumFrom(null, '2026-09-07'), 0);
    assert.equal(E.sumFrom([], '2026-09-07'), 0);
    assert.equal(E.sumFrom(EV, 'позавчора'), 0);
  });

  /* Один зіпсований рядок історії не має обнуляти все число: показати
     «—» замість двадцяти очок гірше, ніж мовчки пропустити сміття. */
  it('зіпсовані рядки пропускаються мовчки', () => {
    const dirty = EV.concat([null, { delta: 5 }, { day: '2026-09-08', delta: 'ой' }]);
    assert.equal(E.sumFrom(dirty, '2026-09-07'), 5);
  });

  it('результат цілий', () => {
    assert.equal(E.sumFrom([{ day: '2026-09-08', delta: 1.4 },
                            { day: '2026-09-08', delta: 1.4 }], '2026-09-07'), 3);
  });
});
