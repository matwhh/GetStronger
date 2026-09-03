/**
 * Розділення схем тренувань за статтю.
 *
 * Перевіряється не розмітка, а саме ПРАВИЛО ДОСТУПУ: людина не повинна
 * діставати схему чужої статі ні через список, ні через збережений
 * activePlan, ні через прямий перехід на сторінку плану. Тому тут поруч
 * стоять три рівні:
 *
 *   1. programsForSex / programAllowedFor — саме правило;
 *   2. resolvePlan (js/workout-core.js) — вузьке місце «Сьогодні»,
 *      «Тренування» і «Мого плану»: через нього план береться щоразу;
 *   3. дані жіночої схеми — обʼєм рахується тим самим правилом, що для
 *      решти (підходи йдуть у ПЕРШУ групу в muscles).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const w = loadModules([
  'js/exercises.js',
  'js/programs-data.js',
  'js/reps-core.js',
  'js/workout-core.js'
]);

/* Через кому, а не масивом: модулі виконуються у vm-контексті, і масив
   звідти має ІНШИЙ Array.prototype — deepStrictEqual падає на прототипі,
   а не на вмісті. Рядок порівнюється чесно. */
const idsOf = (list) => list.map((p) => p.id).sort().join(', ');

describe('доступ до схем за статтю', () => {
  it('у кожної схеми реєстру проставлена стать', () => {
    for (const p of w.PROGRAMS) {
      assert.ok(p.sex === 'male' || p.sex === 'female', `${p.id}: sex = ${p.sex}`);
    }
  });

  it('жінка бачить рівно два жіночі плани', () => {
    assert.equal(idsOf(w.programsForSex('female')), 'women3, women4');
  });

  it('чоловік бачить усі наявні чоловічі схеми й жодної жіночої', () => {
    const male = idsOf(w.programsForSex('male'));
    assert.equal(male, 'fullbody, ppl, ulppl, upperlower');
    assert.ok(!male.includes('women4'));
  });

  it('списки не перетинаються — жодна схема не видна обом', () => {
    const male = new Set(idsOf(w.programsForSex('male')).split(', '));
    for (const id of idsOf(w.programsForSex('female')).split(', ')) {
      assert.ok(!male.has(id), `${id} видно обом статям`);
    }
  });

  it('разом дві статі покривають увесь реєстр — схем-сиріт немає', () => {
    const both = idsOf(w.programsForSex('male')).split(', ')
      .concat(idsOf(w.programsForSex('female')).split(', '));
    assert.equal(both.length, w.PROGRAMS.length);
  });

  it('невідома стать бачить чоловічі схеми — старий профіль не втрачає план', () => {
    for (const sex of [undefined, null, '', 'інше']) {
      assert.equal(idsOf(w.programsForSex(sex)), 'fullbody, ppl, ulppl, upperlower');
    }
  });

  it('programAllowedFor: пряма перевірка однієї схеми', () => {
    const women = w.PROGRAMS.find((p) => p.id === 'women4');
    const ppl = w.PROGRAMS.find((p) => p.id === 'ppl');
    assert.equal(w.programAllowedFor(women, 'female'), true);
    assert.equal(w.programAllowedFor(women, 'male'), false);
    assert.equal(w.programAllowedFor(ppl, 'male'), true);
    assert.equal(w.programAllowedFor(ppl, 'female'), false);
    assert.equal(w.programAllowedFor(null, 'female'), false);
  });
});

describe('збережений план чужої статі не відкривається', () => {
  /* Саме той стан, який лишається після зміни статі в налаштуваннях,
     якщо профіль десь не почистили: activePlan указує на чужу схему. */
  const withPlan = (sex, programId, days) => ({
    sex, trainingAge: 'inter', activePlan: { programId, days }
  });

  it('жінка зі збереженим чоловічим планом не дістає його', () => {
    assert.equal(w.WorkoutCore.resolvePlan(withPlan('female', 'ppl', 6)), null);
    assert.equal(w.WorkoutCore.resolvePlan(withPlan('female', 'fullbody', 3)), null);
    assert.ok(w.WorkoutCore.resolvePlan(withPlan('female', 'women3', 3)), 'жіночий Full Body на 3 дні є');
  });

  it('чоловік зі збереженим жіночим планом не дістає його', () => {
    assert.equal(w.WorkoutCore.resolvePlan(withPlan('male', 'women4', 4)), null);
  });

  it('свою схему кожна стать відкриває нормально', () => {
    const f = w.WorkoutCore.resolvePlan(withPlan('female', 'women4', 4));
    assert.ok(f && f.program.id === 'women4');
    assert.equal(f.plan.length, 4);

    const m = w.WorkoutCore.resolvePlan(withPlan('male', 'ppl', 6));
    assert.ok(m && m.program.id === 'ppl');
  });

  it('профіль без статі відкриває чоловічу схему й не відкриває жіночу', () => {
    const noSex = { trainingAge: 'inter', activePlan: { programId: 'fullbody', days: 3 } };
    assert.ok(w.WorkoutCore.resolvePlan(noSex));
    const noSexW = { trainingAge: 'inter', activePlan: { programId: 'women4', days: 4 } };
    assert.equal(w.WorkoutCore.resolvePlan(noSexW), null);
  });

  it('власна правка плану (customPlans) чужу схему теж не відмикає', () => {
    /* Дірка, яку легко лишити: custom-план береться з профілю, і якщо
       перевірка стоїть після нього — вона вже нічого не стереже. */
    const p = {
      sex: 'male', trainingAge: 'inter',
      activePlan: { programId: 'women4', days: 4 },
      customPlans: { 'women4:4': [{ title: 'Push', exercises: [{ name: 'Жим ногами', sets: 3 }] }] }
    };
    assert.equal(w.WorkoutCore.resolvePlan(p), null);
  });
});

describe('згинання ніг — сидячи в усіх схемах', () => {
  /* Домовленість продукту: варіант сидячи, а не лежачи й не «просто
     згинання». Тест ловить схему, у якій лишили стару назву. */
  it('жодна схема не містить лежачого чи безіменного варіанта', () => {
    for (const program of w.PROGRAMS) {
      for (const days of Object.keys(program.days)) {
        for (const day of program.days[days]) {
          for (const ex of day.exercises) {
            assert.notEqual(ex.name, 'Згинання ніг лежачи', `${program.id}/${days}`);
            assert.notEqual(ex.name, 'Згинання ніг', `${program.id}/${days}`);
          }
        }
      }
    }
  });

  it('там, де згинання є, це «Згинання ніг сидячи»', () => {
    let found = 0;
    for (const program of w.PROGRAMS) {
      for (const days of Object.keys(program.days)) {
        for (const day of program.days[days]) {
          for (const ex of day.exercises) {
            if (ex.pattern === 'Згинання гомілки') {
              assert.equal(ex.name, 'Згинання ніг сидячи', `${program.id}/${days}`);
              found++;
            }
          }
        }
      }
    }
    assert.ok(found > 0, 'згинання гомілки не знайдено взагалі');
  });
});

describe('жіночий план: дані', () => {
  const women = () => w.PROGRAMS.find((p) => p.id === 'women4');

  it('чотири дні в залі, підтримується тільки 4', () => {
    const p = women();
    assert.equal(p.daysSupported.join(','), '4');
    assert.equal(p.days['4'].length, 4);
    assert.equal(p.name, 'PUSH/PULL');
  });

  it('Push і Pull повторюються двічі тими самими обʼєктами', () => {
    const d = women().days['4'];
    assert.equal(d[0], d[2], 'дні Push мають бути одним обʼєктом');
    assert.equal(d[1], d[3], 'дні Pull мають бути одним обʼєктом');
  });

  it('усі вправи є в довіднику — редактор зможе запропонувати заміну', () => {
    for (const day of women().days['4']) {
      for (const ex of day.exercises) {
        const known = w.EXERCISES.find((e) => e.name === ex.name);
        assert.ok(known, `вправи «${ex.name}» немає в EXERCISES`);
      }
    }
  });

  it('у кожної вправи є головна група, підходи й патерн', () => {
    for (const day of women().days['4']) {
      for (const ex of day.exercises) {
        assert.ok(w.primaryMuscle(ex), `${ex.name}: не визначилась головна група`);
        assert.ok(Number(ex.sets) > 0, `${ex.name}: підходи = ${ex.sets}`);
        assert.ok(ex.pattern, `${ex.name}: немає патерну руху`);
      }
    }
  });

  it('тижневий обʼєм рахується правилом Forge і не виходить за стелі', () => {
    const cap = (id) => {
      const m = w.MUSCLES.find((x) => x.id === id);
      return m ? (m.cap ?? w.VOLUME_CAP[m.size]) : Infinity;
    };
    const totals = Object.create(null);
    for (const day of women().days['4']) {
      for (const ex of day.exercises) {
        const main = w.primaryMuscle(ex);
        totals[main] = (totals[main] || 0) + Number(ex.sets);
      }
    }
    /* Числа з опису програми — якщо схему поправлять, тест покаже, що
       коментар із обʼємом розійшовся з даними. */
    assert.equal(totals.glutes, 14);
    assert.equal(totals.quads, 12);
    assert.equal(totals.back, 12);
    assert.equal(totals.hamstrings, 12);
    assert.equal(totals.calves, 8);
    assert.equal(totals.chest, 6);
    for (const [id, sets] of Object.entries(totals)) {
      assert.ok(sets <= cap(id), `${id}: ${sets} підходів при стелі ${cap(id)}`);
    }
    const all = Object.values(totals).reduce((a, b) => a + b, 0);
    assert.equal(all, 96, 'разом підходів за тиждень');
  });

  it('Push 23 підходи, Pull 25 — різниця навмисна', () => {
    /* Pull важчий: у ньому румунська тяга. Числа зафіксовані, щоб правка
       схеми не роз'їхалася з описом обʼєму в самому файлі даних. */
    const sets = (d) => d.exercises.reduce((a, ex) => a + Number(ex.sets), 0);
    const d = women().days['4'];
    assert.equal(sets(d[0]), 23, 'Push');
    assert.equal(sets(d[1]), 25, 'Pull');
  });

  it('у Pull є румунська тяга на 3 підходи, і вона йде в біцепс стегна', () => {
    const pull = women().days['4'][1];
    const rdl = pull.exercises.find((e) => e.name === 'Румунська тяга');
    assert.ok(rdl, 'румунської тяги немає в дні Pull');
    assert.equal(rdl.sets, 3);
    assert.equal(w.primaryMuscle(rdl), 'hamstrings');
  });

  it('діапазони повторень підставляє RepsCore, а не дані плану', () => {
    /* Те саме правило, що для чоловічих схем: reps — похідне від стажу. */
    const novice = w.WorkoutCore.resolvePlan({
      sex: 'female', trainingAge: 'novice', activePlan: { programId: 'women4', days: 4 }
    });
    const adv = w.WorkoutCore.resolvePlan({
      sex: 'female', trainingAge: 'elite', activePlan: { programId: 'women4', days: 4 }
    });
    const first = (r) => r.plan[0].exercises.find((e) => w.primaryMuscle(e) === 'quads');
    assert.equal(first(novice).reps, '8–10');
    assert.equal(first(adv).reps, '6–8');
  });
});


describe('women3: Full Body для жінок на 3 дні', () => {
  const p = w.PROGRAMS.find((x) => x.id === 'women3');
  it('є, жіноча, лише 3 дні', () => {
    assert.ok(p); assert.equal(p.sex, 'female'); assert.equal(p.daysSupported.join(','), '3');
  });
  it('три ідентичні дні по 12 вправ і 28 підходів; 84 за тиждень', () => {
    const days = p.days[3];
    assert.equal(days.length, 3);
    const sets = (d) => d.exercises.reduce((a, e) => a + e.sets, 0);
    assert.equal(days[0].exercises.length, 12);
    assert.equal(sets(days[0]), 28);
    assert.equal(days.reduce((a, d) => a + sets(d), 0), 84);
    assert.equal(JSON.stringify(days[0]), JSON.stringify(days[2]));
  });
  it('тижневий обʼєм по групах: ноги 12/12, спина 12, сідниці 9, ікри 9, решта 6', () => {
    const vol = {};
    p.days[3].forEach((d) => d.exercises.forEach((e) => e.muscles.forEach((m) => { vol[m] = (vol[m] || 0) + e.sets; })));
    assert.deepEqual(JSON.parse(JSON.stringify(vol)), { quads: 12, hamstrings: 12, glutes: 9, chest: 6, back: 12, frontDelts: 6, sideDelts: 6, biceps: 6, triceps: 6, calves: 9 });
  });
  it('усі вправи є в каталозі', () => {
    const names = new Set(w.EXERCISES.map((e) => e.name));
    p.days[3][0].exercises.forEach((e) => assert.ok(names.has(e.name), e.name));
  });
  it('чоловік цей план не бачить', () => {
    assert.equal(w.programAllowedFor(p, 'male'), false);
    assert.equal(w.WorkoutCore.resolvePlan({ sex: 'male', activePlan: { programId: 'women3', days: 3 } }), null);
  });
});
