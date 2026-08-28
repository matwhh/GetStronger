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
  const ALLOWED = ['6–8', '8–10', '10–12'];

  it('кожна вправа кожної програми отримує діапазон із таблиці', () => {
    P.PROGRAMS.forEach((prog) => {
      Object.keys(prog.days).forEach((d) => {
        const out = P.RepsCore.applyPlan(prog.days[d], 'novice');
        out.forEach((day) => day.exercises.forEach((e) => {
          assert.ok(['8–10', '10–12'].includes(e.reps), prog.id + ' ' + e.name + ' ' + e.reps);
        }));
        const out2 = P.RepsCore.applyPlan(prog.days[d], 'elite');
        out2.forEach((day) => day.exercises.forEach((e) => {
          assert.ok(['6–8', '8–10'].includes(e.reps), prog.id + ' ' + e.name + ' ' + e.reps);
        }));
      });
    });
  });
});
