/**
 * Діапазони повторень (js/reps-core.js): стаж + розмір групи → діапазон.
 * Класифікація груп не вигадується — береться з MUSCLES (exercises.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const W = loadModules(['js/exercises.js', 'js/reps-core.js']);
const RC = W.RepsCore;

const ex = (m) => ({ name: 'x', muscles: Array.isArray(m) ? m : [m], sets: 3 });

describe('Повторення: таблиця стажів', () => {
  it('до 1 року і 1–2 роки — один ярус: 8–10 / 10–12', () => {
    ['novice', 'inter'].forEach((t) => {
      assert.equal(RC.repRangeFor(t, ex('chest')), '8–10', t);
      assert.equal(RC.repRangeFor(t, ex('biceps')), '10–12', t);
    });
  });

  it('3–5 і понад 5 років — другий ярус: 6–8 / 8–10', () => {
    ['adv', 'elite'].forEach((t) => {
      assert.equal(RC.repRangeFor(t, ex('back')), '6–8', t);
      assert.equal(RC.repRangeFor(t, ex('triceps')), '8–10', t);
    });
  });

  it('невідомий стаж — безпечний ярус новачка', () => {
    [null, undefined, '', 'pro'].forEach((t) => {
      assert.equal(RC.repRangeFor(t, ex('quads')), '8–10', String(t));
      assert.equal(RC.repRangeFor(t, ex('calves')), '10–12', String(t));
    });
  });
});

describe('Повторення: великі й малі групи — з MUSCLES, не заново', () => {
  it('усі великі групи таблиці', () => {
    ['chest', 'back', 'quads', 'hamstrings', 'glutes'].forEach((m) => {
      assert.equal(RC.sizeOf(ex(m)), 'large', m);
    });
  });

  it('малі групи таблиці', () => {
    ['biceps', 'triceps', 'frontDelts', 'sideDelts', 'calves', 'abs'].forEach((m) => {
      assert.equal(RC.sizeOf(ex(m)), 'small', m);
    });
  });

  it('цільова група — ПЕРША у списку (як усюди в Forge)', () => {
    // Румунська тяга: hamstrings перша, glutes друга → велика
    assert.equal(RC.sizeOf(ex(['hamstrings', 'glutes'])), 'large');
    // Ізоляція на біцепс із передпліччям другим — мала
    assert.equal(RC.sizeOf(ex(['biceps', 'brachiorad'])), 'small');
  });

  it('невідома група — мала (обережніший діапазон вищих повторень)', () => {
    assert.equal(RC.sizeOf(ex('казна-що')), 'small');
    assert.equal(RC.sizeOf({ name: 'без груп' }), 'small');
  });
});

describe('Повторення: застосування до плану', () => {
  const plan = [
    { title: 'День A', exercises: [ex('chest'), ex('biceps')] },
    { title: 'День B', exercises: [ex('quads'), ex('calves')] }
  ];

  it('переписує reps за стажем у всіх днях', () => {
    const out = RC.applyPlan(plan, 'adv');
    assert.equal(out[0].exercises[0].reps, '6–8');
    assert.equal(out[0].exercises[1].reps, '8–10');
    assert.equal(out[1].exercises[0].reps, '6–8');
    assert.equal(out[1].exercises[1].reps, '8–10');
  });

  it('НЕ мутує вхідний план (resolvePlan віддає посилання на PROGRAMS)', () => {
    const before = JSON.stringify(plan);
    RC.applyPlan(plan, 'elite');
    assert.equal(JSON.stringify(plan), before);
  });

  it('зберігає решту полів вправи', () => {
    const src = [{ title: 'A', exercises: [{ name: 'Жим', muscles: ['chest'], sets: 4, rir: '2', rest: '2 хв' }] }];
    const out = RC.applyPlan(src, 'novice');
    assert.equal(out[0].exercises[0].sets, 4);
    assert.equal(out[0].exercises[0].rir, '2');
    assert.equal(out[0].exercises[0].reps, '8–10');
  });

  it('без плану — повертає як є', () => {
    assert.equal(RC.applyPlan(null, 'adv'), null);
  });
});

describe('Повторення: усі 4 програми проходять через одну логіку', () => {
  const P = loadModules(['js/exercises.js', 'js/programs-data.js', 'js/reps-core.js']);
  /* Увесь набір діапазонів, які взагалі бувають у таблиці. Новачок і еліта
     беруть із нього різні підмножини; ALLOWED стереже, щоб у таблиці не
     зʼявився третій, ніде не описаний варіант (TST-013: константа була
     оголошена й не вжита, тобто нічого не стерегла). */
  const ALLOWED = ['6–8', '8–10', '10–12'];
  const NOVICE = ['8–10', '10–12'];
  const ELITE = ['6–8', '8–10'];

  it('кожна вправа кожної програми отримує діапазон із таблиці', () => {
    const seen = new Set();
    P.PROGRAMS.forEach((prog) => {
      Object.keys(prog.days).forEach((d) => {
        const out = P.RepsCore.applyPlan(prog.days[d], 'novice');
        out.forEach((day) => day.exercises.forEach((e) => {
          seen.add(e.reps);
          assert.ok(NOVICE.includes(e.reps), prog.id + ' ' + e.name + ' ' + e.reps);
        }));
        const out2 = P.RepsCore.applyPlan(prog.days[d], 'elite');
        out2.forEach((day) => day.exercises.forEach((e) => {
          seen.add(e.reps);
          assert.ok(ELITE.includes(e.reps), prog.id + ' ' + e.name + ' ' + e.reps);
        }));
      });
    });
    const stray = [...seen].filter((r) => !ALLOWED.includes(r));
    assert.equal(stray.length, 0, 'діапазони поза таблицею: ' + stray.join(', '));
    assert.ok(seen.size >= 3, 'усі три діапазони мають зустрітись, а зустрілось ' + seen.size);
  });
});

describe('Повторення: власне число людини (userReps)', () => {
  /*
   * Діапазон — орієнтир, і його можна замінити точним числом у «Моєму
   * плані». Сенс саме в тому, що це число доїжджає до тренування як є:
   * до появи userReps екран тренування підставляв у підхід СЕРЕДИНУ
   * діапазону («8–10» → 9) — число, якого людина ніде не бачила й ніде
   * не задавала.
   */
  it('стеля залежить від розміру групи, а не від стажу', () => {
    assert.equal(RC.maxRepsFor(ex('chest')), 12);
    assert.equal(RC.maxRepsFor(ex('quads')), 12);
    assert.equal(RC.maxRepsFor(ex('biceps')), 15);
    assert.equal(RC.maxRepsFor(ex('abs')), 15);
    /* Невідома група вважається малою — отже, і стеля її. */
    assert.equal(RC.maxRepsFor(ex('казна-що')), 15);
  });

  it('стеля не звужує таблицю діапазонів', () => {
    /* Найвище число, яке взагалі буває в таблиці, — 12. Якби стеля
       великих груп стала меншою, діапазон 10–12 перестав би вміщатись
       у власне поле, і людина не змогла б вписати те, що їй і так
       пропонує програма. */
    const all = Object.keys(RC.RANGES).reduce((acc, tier) => {
      Object.keys(RC.RANGES[tier]).forEach((size) => {
        String(RC.RANGES[tier][size]).match(/\d+/g).forEach((n) => acc.push(Number(n)));
      });
      return acc;
    }, []);
    assert.ok(Math.max(...all) <= Math.min(RC.MAX.large, RC.MAX.small),
      'у таблиці є число вище за стелю: ' + Math.max(...all));
  });

  it('порожнє поле і сміття — це «числа немає»', () => {
    ['', null, undefined, '   ', 'десять', '0', '-3', 'NaN'].forEach((v) => {
      assert.equal(RC.normUserReps(v, ex('chest')), null, JSON.stringify(v));
    });
  });

  it('число в межах беремо як є, дробове округлюємо', () => {
    assert.equal(RC.normUserReps(8, ex('chest')), 8);
    assert.equal(RC.normUserReps('8', ex('chest')), 8);
    assert.equal(RC.normUserReps(' 12 ', ex('chest')), 12);
    assert.equal(RC.normUserReps('10.6', ex('chest')), 11);
  });

  it('завелике підтягується до стелі, а не відкидається', () => {
    /* Відкинути означало б мовчки лишити старе значення — людина
       побачила б, що поле «не працює». Підтягнуте видно одразу. */
    assert.equal(RC.normUserReps(99, ex('chest')), 12);
    assert.equal(RC.normUserReps(13, ex('back')), 12);
    assert.equal(RC.normUserReps(99, ex('biceps')), 15);
    assert.equal(RC.normUserReps(16, ex('calves')), 15);
  });

  it('applyPlan ставить власне число замість діапазону', () => {
    const plan = [{ title: 'A', exercises: [
      Object.assign(ex('chest'), { userReps: 10 }),
      ex('biceps')
    ] }];
    const out = RC.applyPlan(plan, 'novice');
    assert.equal(out[0].exercises[0].reps, '10');
    assert.equal(out[0].exercises[0].userReps, 10);
    /* Сусідня вправа без свого числа лишається на таблиці. */
    assert.equal(out[0].exercises[1].reps, '10–12');
    assert.ok(!('userReps' in out[0].exercises[1]));
  });

  it('власне число переживає зміну стажу, а діапазон — ні', () => {
    /* Саме тому userReps зберігається в customPlans, а reps — ні:
       перше факт (людина обрала), друге похідне. */
    const plan = [{ title: 'A', exercises: [
      Object.assign(ex('chest'), { userReps: 9 }),
      ex('back')
    ] }];
    ['novice', 'inter', 'adv', 'elite'].forEach((t) => {
      assert.equal(RC.applyPlan(plan, t)[0].exercises[0].reps, '9', t);
    });
    assert.equal(RC.applyPlan(plan, 'novice')[0].exercises[1].reps, '8–10');
    assert.equal(RC.applyPlan(plan, 'elite')[0].exercises[1].reps, '6–8');
  });

  it('стеля діє й на ЧИТАННІ, а не лише в редакторі', () => {
    /* Значення могло приїхати з іншого пристрою або з експортованого
       JSON, відредагованого руками. Редактор його не бачив — отже,
       перевірка мусить стояти тут. */
    const plan = [{ title: 'A', exercises: [
      Object.assign(ex('chest'), { userReps: 40 }),
      Object.assign(ex('biceps'), { userReps: 40 })
    ] }];
    const out = RC.applyPlan(plan, 'novice');
    assert.equal(out[0].exercises[0].reps, '12');
    assert.equal(out[0].exercises[0].userReps, 12);
    assert.equal(out[0].exercises[1].reps, '15');
    assert.equal(out[0].exercises[1].userReps, 15);
  });

  it('сміття в userReps знімає його й повертає діапазон', () => {
    const plan = [{ title: 'A', exercises: [
      Object.assign(ex('chest'), { userReps: 'десять' }),
      Object.assign(ex('back'), { userReps: 0 })
    ] }];
    const out = RC.applyPlan(plan, 'novice');
    assert.equal(out[0].exercises[0].reps, '8–10');
    assert.ok(!('userReps' in out[0].exercises[0]));
    assert.equal(out[0].exercises[1].reps, '8–10');
    assert.ok(!('userReps' in out[0].exercises[1]));
  });

  it('applyPlan із власним числом теж НЕ мутує вхідний план', () => {
    const plan = [{ title: 'A', exercises: [Object.assign(ex('chest'), { userReps: 40 })] }];
    const before = JSON.stringify(plan);
    RC.applyPlan(plan, 'adv');
    assert.equal(JSON.stringify(plan), before);
  });
});
