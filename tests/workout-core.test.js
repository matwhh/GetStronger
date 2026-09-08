/**
 * Ядро тренувального дня (js/workout-core.js): підходи, тривалість,
 * тиждень і блокування завершених сесій.
 *
 * Це той модуль, від якого залежать одразу три речі з реальними грошима
 * довіри: «скільки хвилин залишилось», «чи можна почати цей день» і
 * «скільки підходів поїде в ELO». Тому тут перевіряється не рендер, а
 * арифметика на чистих даних — включно з легасі-формою денного стану
 * (булеві галочки замість чисел підходів).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

/* exercises.js дає liftKind/primaryMuscle/MUSCLES для restSecFor */
const ctx = loadModules(['js/exercises.js', 'js/workout-core.js']);
const WC = ctx.WorkoutCore;

/* Синтетичний день: складна велика (3 хв), ізоляція (2 хв), кругова («—»).
   lift задано явно ('compound'/'isolation' — значення бібліотеки): пошук
   за вигаданою назвою в EXERCISES дав би isolation для всього. */
const DAY = { title: 'Тест', exercises: [
  { name: 'Жим тест', muscles: ['chest'], lift: 'compound', sets: 4, reps: '6–8', rest: '3 хв' },
  { name: 'Розгинання тест', muscles: ['triceps'], lift: 'isolation', sets: 3, reps: '10–12', rest: '2 хв' },
  { name: 'Планка тест', muscles: ['core'], lift: 'isolation', sets: 2, reps: '30 с', rest: '—' }
] };

describe('workout-core: підходи', () => {
  it('plannedSets: ціле 0..10, сміття — нуль', () => {
    assert.equal(WC.plannedSets({ sets: 4 }), 4);
    assert.equal(WC.plannedSets({ sets: '3' }), 3);
    assert.equal(WC.plannedSets({ sets: 99 }), 10);
    assert.equal(WC.plannedSets({ sets: -2 }), 0);
    assert.equal(WC.plannedSets({ sets: 'abc' }), 0);
    assert.equal(WC.plannedSets({}), 0);
  });

  it('doneSetsFor: число клампиться до плану, легасі true = всі', () => {
    assert.equal(WC.doneSetsFor(2, 4), 2);
    assert.equal(WC.doneSetsFor(9, 4), 4);
    assert.equal(WC.doneSetsFor(-1, 4), 0);
    assert.equal(WC.doneSetsFor(true, 4), 4);   // стара галочка
    assert.equal(WC.doneSetsFor(false, 4), 0);
    assert.equal(WC.doneSetsFor(undefined, 4), 0);
    assert.equal(WC.doneSetsFor('сміття', 4), 0);
  });

  it('dayStats: вправа закрита лише ПОВНИМ набором підходів', () => {
    const st = WC.dayStats(DAY, [4, 1, 0]);
    assert.equal(st.totalSets, 9);
    assert.equal(st.doneSets, 5);
    assert.equal(st.totalEx, 3);
    assert.equal(st.doneEx, 1);   // лише жим: 4/4
  });

  it('dayStats на легасі-булевих: true рахується як повна вправа', () => {
    const st = WC.dayStats(DAY, [true, false, true]);
    assert.equal(st.doneSets, 6);   // 4 + 0 + 2
    assert.equal(st.doneEx, 2);
  });

  it('dayStats порожнього дня — нулі, не NaN', () => {
    /* Полями, не deepEqual: обʼєкт із vm-пісочниці має інший прототип */
    const st = WC.dayStats({ exercises: [] }, []);
    assert.equal(st.doneSets, 0);
    assert.equal(st.totalSets, 0);
    assert.equal(st.doneEx, 0);
    assert.equal(st.totalEx, 0);
  });
});

describe('workout-core: тривалість', () => {
  /* Та сама арифметика, що в js/programs.js → dayMinutes:
     Σ sets×(40 + rest) − останній rest, /60, + 10 хв розминки. */
  const FULL = Math.round((4 * (40 + 180) + 3 * (40 + 120) + 2 * (40 + 20) - 20) / 60) + 10;

  it('повний день — за формулою «Мого плану»', () => {
    assert.equal(WC.dayMinutes(DAY), FULL);
    assert.equal(WC.dayMinutes(DAY, []), FULL);
  });

  it('залишок меншає з кожним підходом і доходить до нуля', () => {
    let prev = WC.dayMinutes(DAY, []);
    const seq = [[1, 0, 0], [4, 0, 0], [4, 3, 0], [4, 3, 1], [4, 3, 2]];
    for (const done of seq) {
      const left = WC.dayMinutes(DAY, done);
      assert.ok(left < prev, done.join(',') + ': ' + left + ' < ' + prev);
      prev = left;
    }
    assert.equal(WC.dayMinutes(DAY, [4, 3, 2]), 0);
  });

  it('розминка входить лише поки не зроблено жодного підходу', () => {
    const untouched = WC.dayMinutes(DAY, [0, 0, 0]);
    const oneSet = WC.dayMinutes(DAY, [1, 0, 0]);
    // −10 хв розминки −(40+180) c підходу ≈ −14 хв
    assert.ok(untouched - oneSet >= 13, untouched + ' → ' + oneSet);
  });

  it('порожній день — нуль хвилин, а не сама розминка', () => {
    assert.equal(WC.dayMinutes({ exercises: [] }), 0);
  });
});

describe('workout-core: тиждень', () => {
  it('weekStartKey — понеділок локального ISO-тижня', () => {
    assert.equal(WC.weekStartKey('2026-08-31'), '2026-08-31');   // пн
    assert.equal(WC.weekStartKey('2026-09-01'), '2026-08-31');   // вт
    assert.equal(WC.weekStartKey('2026-09-06'), '2026-08-31');   // нд
    assert.equal(WC.weekStartKey('2026-09-07'), '2026-09-07');   // новий пн
  });

  it('weekStartKey через межу року', () => {
    assert.equal(WC.weekStartKey('2027-01-01'), '2026-12-28');   // пт → пн у грудні
  });

  it('addDaysKey рахує в локальному календарі', () => {
    assert.equal(WC.addDaysKey('2026-08-31', 6), '2026-09-06');
    assert.equal(WC.addDaysKey('2026-12-31', 1), '2027-01-01');
  });
});

describe('workout-core: блокування завершених сесій', () => {
  const profile = {
    activePlan: { programId: 'ppl', days: 6 },
    sessionLog: {
      // завершений понеділок цього тижня, день 0 активного плану
      '2026-08-31': { programId: 'ppl', days: 6, dayIdx: 0, done: 5, total: 5,
                      doneSets: 15, totalSets: 15, end: 1 },
      // незавершена сесія (без end) — НЕ блокує
      '2026-09-01': { programId: 'ppl', days: 6, dayIdx: 1, done: 2, total: 5 },
      // завершена, але МИНУЛОГО тижня — не блокує цей
      '2026-08-26': { programId: 'ppl', days: 6, dayIdx: 2, done: 5, total: 5, end: 1 },
      // завершена цього тижня, але ЧУЖОГО плану — не блокує активний
      '2026-09-02': { programId: 'fullbody', days: 3, dayIdx: 0, done: 4, total: 4, end: 1 }
    }
  };

  it('completedThisWeek: лише end + цей тиждень + активний план', () => {
    const week = WC.completedThisWeek(profile, '2026-09-03');
    assert.equal(Object.keys(week).length, 1);
    assert.equal(week[0], '2026-08-31');
  });

  it('наступного понеділка блокування знімається саме собою', () => {
    const week = WC.completedThisWeek(profile, '2026-09-07');
    assert.equal(Object.keys(week).length, 0);
  });

  it('completedToday: бачить end лише за сьогоднішньою датою', () => {
    assert.ok(WC.completedToday(profile, '2026-08-31'));
    assert.equal(WC.completedToday(profile, '2026-09-01'), null);  // без end
    assert.equal(WC.completedToday(profile, '2026-09-04'), null);
  });

  it('порожній профіль — нічого не заблоковано і нічого не падає', () => {
    assert.equal(Object.keys(WC.completedThisWeek({}, '2026-09-03')).length, 0);
    assert.equal(WC.completedToday(null, '2026-09-03'), null);
  });
});

/*
 * Денний стан: readDay / writeDay / clampDay.
 *
 * TST-010: жоден тест не виконував ці функції — виживав мутант, у якому
 * readDay віддає стан ІНШОЇ дати. Наслідок був би тихий і дорогий:
 * учорашні закриті підходи показувались би як сьогоднішні й поїхали б у
 * сьогоднішній ELO-сабміт. Тому тут перевіряється саме межа дня і межа
 * плану, а не рендер.
 */
describe('workout-core: денний стан', () => {
  const P = { activePlan: { programId: 'fullbody', days: 3 } };

  /* Масиви з пісочниці vm мають ІНШИЙ Array.prototype, ніж масиви тесту,
     тому deepStrictEqual на них падає навіть при однаковому вмісті.
     Порівнюємо вміст, а не походження обʼєкта. */
  const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

  function fresh() {
    const store = new Map();
    const ls = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
    const c = loadModules(['js/exercises.js', 'js/workout-core.js'], { localStorage: ls });
    return { W: c.WorkoutCore, ls: ls };
  }

  it('той самий план і та сама дата — стан повертається як є', () => {
    const { W } = fresh();
    W.writeDay(P, '2026-08-01', 1, [3, 2, 0]);
    const d = W.readDay(P, '2026-08-01', 3);
    assert.equal(d.fresh, false);
    assert.equal(d.dayIdx, 1);
    same(d.done, [3, 2, 0]);
  });

  it('інша дата — стан НЕ переноситься, а день пропонується наступний', () => {
    /* Саме тут і жив мутант: віддати вчорашні галочки сьогодні. */
    const { W } = fresh();
    W.writeDay(P, '2026-08-01', 1, [3, 2, 0]);
    const d = W.readDay(P, '2026-08-02', 3);
    assert.equal(d.fresh, true, 'новий день має бути свіжим');
    same(d.done, [], 'жодної галочки з учора');
    assert.equal(d.dayIdx, 2, 'підказка — наступний день плану');
  });

  it('після останнього дня плану підказка йде по колу', () => {
    const { W } = fresh();
    W.writeDay(P, '2026-08-01', 2, [1]);
    assert.equal(W.readDay(P, '2026-08-02', 3).dayIdx, 0);
  });

  it('інший план — стан чужий, починаємо з першого дня', () => {
    const { W } = fresh();
    W.writeDay(P, '2026-08-01', 2, [3, 3, 3]);
    const other = { activePlan: { programId: 'upperlower', days: 4 } };
    const d = W.readDay(other, '2026-08-01', 4);
    assert.equal(d.fresh, true);
    same(d.done, []);
    assert.equal(d.dayIdx, 0, 'чужий стан не дає підказки');
  });

  it('зіпсований запис не валить читання', () => {
    const { W, ls } = fresh();
    ls.setItem(W.LS_TODAY, 'не json');
    const d = W.readDay(P, '2026-08-01', 3);
    assert.equal(d.fresh, true);
    same(d.done, []);
  });

  it('індекс дня завжди в межах плану', () => {
    const { W } = fresh();
    assert.equal(W.clampDay(99, 3), 2);
    assert.equal(W.clampDay(-5, 3), 0);
    assert.equal(W.clampDay(1, 0), 0, 'плану немає — нема чого обмежувати');
    assert.equal(W.clampDay('ой', 3), 0);
  });

  it('переповнене сховище не валить запис дня', () => {
    const { W } = fresh();
    const c = loadModules(['js/exercises.js', 'js/workout-core.js'], {
      localStorage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } }
    });
    assert.doesNotThrow(() => c.WorkoutCore.writeDay(P, '2026-08-01', 0, [1]));
  });
});

describe('resolvePlan: битий день не валить сторінку (WEB-012)', () => {
  const PROGRAMS = [{
    id: 'test', name: 'Тест',
    days: { '3': [{ title: 'A', exercises: [{ name: 'Жим', sets: 3, reps: '8' }] }] }
  }];
  const base = { activePlan: { programId: 'test', days: 3 }, sex: 'male', trainingAge: 'inter' };

  it('день без exercises стає днем із порожнім списком', () => {
    /*
     * customPlans редагується імпортом і живе в localStorage. День, у
     * якого масив вправ лежить під іншим іменем поля, давав TypeError і
     * лишав три сторінки порожніми — вони не лікували себе самі, бо биті
     * дані вже в профілі.
     */
    const p = Object.assign({}, base, {
      customPlans: { 'test:3': [{ title: 'A' }, { title: 'B', exercises: null }, 'зовсім не день'] }
    });
    const r = WC.resolvePlan(p, PROGRAMS);
    assert.ok(r, 'план має відкритись');
    assert.equal(r.plan.length, 3);
    r.plan.forEach(function (d, i) {
      assert.ok(Array.isArray(d.exercises), 'день ' + i + ' без масиву вправ');
      assert.equal(d.exercises.length, 0);
    });
  });

  it('справжній план не змінюється', () => {
    const r = WC.resolvePlan(base, PROGRAMS);
    assert.equal(r.plan.length, 1);
    assert.equal(r.plan[0].exercises.length, 1);
    assert.equal(r.plan[0].title, 'A');
  });
});

describe('resolvePlan: власне число повторень доїжджає до тренування', () => {
  /*
   * Це і є весь сенс userReps. «Тренування» бере схему саме звідси, а
   * поле повторень підходу заповнює з ex.reps: доки там стояв діапазон,
   * у підхід підставлялась його СЕРЕДИНА («8–10» → 9) — число, якого
   * людина ніде не задавала й ніде не бачила.
   *
   * reps-core потрібен окремо: resolvePlan викликає RepsCore.applyPlan,
   * і без нього ця гілка мовчки віддала б план як є.
   */
  const R = loadModules(['js/exercises.js', 'js/reps-core.js', 'js/workout-core.js']);
  const RWC = R.WorkoutCore;

  const PROGRAMS = [{
    id: 'test', name: 'Тест',
    days: { '3': [{ title: 'A', exercises: [
      { name: 'Жим лежачи', muscles: ['chest'], sets: 3, reps: '8–10' },
      { name: 'Підйом на біцепс', muscles: ['biceps'], sets: 3, reps: '10–12' }
    ] }] }
  }];
  const base = { activePlan: { programId: 'test', days: 3 }, sex: 'male', trainingAge: 'inter' };

  const withCustom = (exs) => Object.assign({}, base, {
    customPlans: { 'test:3': [{ title: 'A', exercises: exs }] }
  });

  it('без власного числа лишається діапазон за стажем', () => {
    const r = RWC.resolvePlan(base, PROGRAMS);
    assert.equal(r.plan[0].exercises[0].reps, '8–10');
    assert.equal(r.plan[0].exercises[1].reps, '10–12');
  });

  it('власне число з «Мого плану» приходить у тренування точним', () => {
    const r = RWC.resolvePlan(withCustom([
      { name: 'Жим лежачи', muscles: ['chest'], sets: 3, reps: '8–10', userReps: 7 }
    ]), PROGRAMS);
    assert.equal(r.plan[0].exercises[0].reps, '7');
  });

  it('стеля тримається й тут: 12 на велику групу, 15 на малу', () => {
    /* Профіль міг приїхати з іншого пристрою або з правленого руками
       JSON — редактор такого значення не бачив. */
    const r = RWC.resolvePlan(withCustom([
      { name: 'Жим лежачи', muscles: ['chest'], sets: 3, reps: '8–10', userReps: 30 },
      { name: 'Підйом на біцепс', muscles: ['biceps'], sets: 3, reps: '10–12', userReps: 30 }
    ]), PROGRAMS);
    assert.equal(r.plan[0].exercises[0].reps, '12');
    assert.equal(r.plan[0].exercises[1].reps, '15');
  });

  it('reps у збережених правках ігнорується, як і раніше', () => {
    /* customPlans зберігає й reps, але воно похідне: стаж міг змінитись
       після того, як план заморозили. Джерело правди — таблиця або
       userReps, не збережений рядок. */
    const r = RWC.resolvePlan(withCustom([
      { name: 'Жим лежачи', muscles: ['chest'], sets: 3, reps: '3–5' }
    ]), PROGRAMS);
    assert.equal(r.plan[0].exercises[0].reps, '8–10');
  });
});
