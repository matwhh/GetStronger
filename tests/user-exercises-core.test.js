/**
 * Свої вправи (js/user-exercises-core.js).
 *
 * Бібліотека вправ — файл у репозиторії, і додати туди щось можна лише
 * правкою коду. Свої вправи живуть у профілі й доклеюються до бібліотеки
 * на льоту. Тому ядро відповідає за дві речі: що взагалі вважається
 * вправою і як власний список зливається з бібліотекою, не ламаючи її.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const W = loadModules(['js/date-core.js', 'js/exercises.js', 'js/user-exercises-core.js']);
const UE = W.UserExercises;
const IDS = W.MUSCLES.map((m) => m.id);

describe('Своя вправа: що приймається', () => {
  it('назва обрізається, зайві пробіли схлопуються', () => {
    const one = UE.normOne({ name: '  Жим   у   хаммері ', muscles: ['chest'] }, IDS);
    assert.equal(one.name, 'Жим у хаммері');
  });

  it('без назви або без групи вправи немає', () => {
    assert.equal(UE.normOne({ name: '', muscles: ['chest'] }, IDS), null);
    assert.equal(UE.normOne({ name: '   ', muscles: ['chest'] }, IDS), null);
    assert.equal(UE.normOne({ name: 'Щось', muscles: [] }, IDS), null);
    assert.equal(UE.normOne({ name: 'Щось', muscles: ['вигадана'] }, IDS), null);
    assert.equal(UE.normOne(null, IDS), null);
  });

  it('задовга назва не приймається, а не обрізається мовчки', () => {
    /* Обрізана назва — це вже інша вправа: у плані, у книзі ваг і в
       історії вона стоятиме під іменем, якого людина не писала. */
    assert.equal(UE.normOne({ name: 'я'.repeat(200), muscles: ['chest'] }, IDS), null);
  });

  it('невідомі групи відкидаються, порядок відомих зберігається', () => {
    const one = UE.normOne({ name: 'Тяга', muscles: ['hamstrings', 'вигадана', 'glutes'] }, IDS);
    /* join, а не deepEqual: масиви з пісочниці loadModules мають інший
       прототип Array, і строге порівняння падає на однакових даних. */
    assert.equal(one.muscles.join(','), 'hamstrings,glutes');
  });

  it('дублікати груп схлопуються — головна лишається першою', () => {
    const one = UE.normOne({ name: 'Тяга', muscles: ['glutes', 'glutes', 'hamstrings'] }, IDS);
    assert.equal(one.muscles.join(','), 'glutes,hamstrings');
  });

  it('замовчування типу — ізоляція, як і в бібліотеці', () => {
    assert.equal(UE.normOne({ name: 'Махи', muscles: ['sideDelts'] }, IDS).lift, 'isolation');
    assert.equal(UE.normOne({ name: 'Жим', muscles: ['chest'], lift: 'compound' }, IDS).lift, 'compound');
    assert.equal(UE.normOne({ name: 'Жим', muscles: ['chest'], lift: 'хтозна' }, IDS).lift, 'isolation');
  });

  it('позначка user стоїть завжди — бібліотечну від своєї має бути видно', () => {
    assert.equal(UE.normOne({ name: 'Моє', muscles: ['abs'] }, IDS).user, true);
  });
});

describe('Своя вправа: список у профілі', () => {
  it('сміття з профілю не доїжджає до бібліотеки', () => {
    const got = UE.list({ customExercises: [
      { name: 'Добра', muscles: ['chest'] },
      { name: '', muscles: ['chest'] },
      null,
      'рядок'
    ] }, IDS);
    assert.equal(got.length, 1);
    assert.equal(got[0].name, 'Добра');
  });

  it('порожній або відсутній список — просто порожньо', () => {
    assert.equal(UE.list(null, IDS).length, 0);
    assert.equal(UE.list({}, IDS).length, 0);
    assert.equal(UE.list({ customExercises: 'ні' }, IDS).length, 0);
  });

  it('додавання повертає НОВИЙ список, старий не чіпається', () => {
    const was = [];
    const r = UE.add(was, { name: 'Моя', muscles: ['chest'] }, [], IDS);
    assert.equal(r.ok, true);
    assert.equal(r.list.length, 1);
    assert.equal(was.length, 0);
  });

  it('назва, що вже є в бібліотеці, не приймається', () => {
    const r = UE.add([], { name: 'Жим лежачи', muscles: ['chest'] }, ['Жим лежачи'], IDS);
    assert.equal(r.ok, false);
    assert.equal(r.why, 'dup');
  });

  it('збіг назви не залежить від регістру й пробілів', () => {
    const r = UE.add([], { name: '  жим   ЛЕЖАЧИ ', muscles: ['chest'] }, ['Жим лежачи'], IDS);
    assert.equal(r.ok, false, 'інакше в плані буде дві вправи з однією вагою');
    assert.equal(r.why, 'dup');
  });

  it('свою назву двічі теж не додати', () => {
    const first = UE.add([], { name: 'Моя', muscles: ['chest'] }, [], IDS);
    const second = UE.add(first.list, { name: 'Моя', muscles: ['abs'] }, [], IDS);
    assert.equal(second.ok, false);
    assert.equal(second.why, 'dup');
  });

  it('причина відмови називається, а не ховається в false', () => {
    assert.equal(UE.add([], { name: '', muscles: ['chest'] }, [], IDS).why, 'name');
    assert.equal(UE.add([], { name: 'Моя', muscles: [] }, [], IDS).why, 'muscles');
  });

  it('видалення прибирає рівно одну і не чіпає решту', () => {
    const a = UE.add([], { name: 'Перша', muscles: ['chest'] }, [], IDS).list;
    const b = UE.add(a, { name: 'Друга', muscles: ['abs'] }, [], IDS).list;
    const c = UE.remove(b, 'Перша');
    assert.equal(c.map((e) => e.name).join(','), 'Друга');
    assert.equal(b.length, 2, 'вихідний список лишився цілим');
  });
});

describe('Злиття з бібліотекою', () => {
  const own = [{ name: 'Моя вправа', muscles: ['chest'], lift: 'isolation', user: true }];

  it('бібліотека не мутується — повертається новий масив', () => {
    const lib = [{ name: 'Жим лежачи', muscles: ['chest'] }];
    const out = UE.applyTo(lib, own);
    assert.equal(lib.length, 1);
    assert.equal(out.length, 2);
  });

  it('своя вправа знаходиться пошуком по групі', () => {
    const out = UE.applyTo([{ name: 'Жим лежачи', muscles: ['chest'] }], own);
    assert.ok(out.some((e) => e.name === 'Моя вправа' && e.muscles[0] === 'chest'));
  });

  it('бібліотечна назва сильніша за свою — підміни вправи не буває', () => {
    const lib = [{ name: 'Жим лежачи', muscles: ['chest'], lift: 'compound' }];
    const out = UE.applyTo(lib, [{ name: 'Жим лежачи', muscles: ['abs'], lift: 'isolation', user: true }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].muscles[0], 'chest');
  });
});
