/**
 * Адаптивні витрати (js/tdee-core.js): підтримання, ВИМІРЯНЕ по факту,
 * а не пораховане формулою.
 *
 * Формула Міффліна бере зріст, вагу, вік і коефіцієнт активності,
 * обраний один раз на онбордингу. Вона нічого не знає про те, що людина
 * перейшла з трьох тренувань на пʼять, мерзне, багато ходить або має
 * повільніший обмін, ніж середній. Арифметика ж чесна:
 *
 *     підтримання = середнє спожите − (зміна ваги × 7700 / дні)
 *
 * Тести будують ряди, де правильна відповідь відома наперед: беремо
 * підтримання 2800, годуємо на 2500 і малюємо саме те падіння ваги,
 * яке дає дефіцит 300 ккал на добу. Функція мусить повернути 2800.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/date-core.js', 'js/tdee-core.js']);
const T = ctx.TdeeCore;
const D = ctx.DateCore;

const NOW = new Date(2026, 8, 28);         // 28 вересня 2026
const KCAL_PER_KG = 7700;

/**
 * Ряд на `days` днів, що закінчується сьогодні.
 * @param opts.intake     скільки їли щодня
 * @param opts.maintenance справжнє підтримання
 * @param opts.start      вага в перший день
 * @param opts.skipMeals  кожен n-й день харчування пропущено
 */
function build(days, opts, base) {
  const o = opts || {};
  const end = base instanceof Date ? base : NOW;
  const intake = o.intake === undefined ? 2500 : o.intake;
  const maint = o.maintenance === undefined ? 2800 : o.maintenance;
  const perDay = (intake - maint) / KCAL_PER_KG;   // кг на добу, зі знаком
  const bodyLog = {}, mealLog = {};
  const first = D.shiftKey(D.keyOf(end), -(days - 1));
  for (let i = 0; i < days; i++) {
    const k = D.shiftKey(first, i);
    bodyLog[k] = Math.round(((o.start === undefined ? 80 : o.start) + perDay * i) * 1000) / 1000;
    if (!o.skipMeals || i % o.skipMeals !== 0) {
      mealLog[k] = { kcal: intake, p: 150, target: 2500 };
    }
  }
  return { bodyLog: bodyLog, mealLog: mealLog };
}

describe('tdee-core: вимірювання підтримання', () => {
  it('знаходить підтримання, яке заклали в ряд', () => {
    const { bodyLog, mealLog } = build(28, { intake: 2500, maintenance: 2800 });
    const m = T.measure(bodyLog, mealLog, 28, NOW);
    assert.equal(Math.abs(m.kcal - 2800) <= 5, true, 'вийшло ' + m.kcal);
  });

  it('працює і на профіциті', () => {
    const { bodyLog, mealLog } = build(28, { intake: 3200, maintenance: 2800 });
    const m = T.measure(bodyLog, mealLog, 28, NOW);
    assert.equal(Math.abs(m.kcal - 2800) <= 5, true, 'вийшло ' + m.kcal);
  });

  it('вага стоїть — підтримання дорівнює спожитому', () => {
    const { bodyLog, mealLog } = build(28, { intake: 2700, maintenance: 2700 });
    const m = T.measure(bodyLog, mealLog, 28, NOW);
    assert.equal(m.kcal, 2700);
    assert.equal(m.deltaKg, 0);
  });

  it('пропущені дні харчування не ламають середнього', () => {
    const { bodyLog, mealLog } = build(28, { intake: 2500, maintenance: 2800, skipMeals: 4 });
    const m = T.measure(bodyLog, mealLog, 28, NOW);
    assert.equal(Math.abs(m.kcal - 2800) <= 15, true, 'вийшло ' + m.kcal);
    assert.equal(m.mealDays, 21);
  });
});

describe('tdee-core: коли відповіді немає', () => {
  it('замало закритих днів харчування — не результат зі зіркою, а нічого', () => {
    const { bodyLog, mealLog } = build(28, { skipMeals: 2 });   // половина днів
    assert.equal(T.measure(bodyLog, mealLog, 28, NOW), null);
  });

  it('вікно коротше за два тижні не рахується взагалі', () => {
    const { bodyLog, mealLog } = build(28, {});
    assert.equal(T.measure(bodyLog, mealLog, 10, NOW), null);
  });

  it('без зважувань на початку або в кінці — нічого', () => {
    const { bodyLog, mealLog } = build(28, {});
    const noHead = Object.assign({}, bodyLog);
    Object.keys(noHead).sort().slice(0, 7).forEach(function (k) { delete noHead[k]; });
    assert.equal(T.measure(noHead, mealLog, 28, NOW), null);

    const noTail = Object.assign({}, bodyLog);
    Object.keys(noTail).sort().slice(-7).forEach(function (k) { delete noTail[k]; });
    assert.equal(T.measure(noTail, mealLog, 28, NOW), null);
  });

  it('порожнє й сміття не кидають винятків', () => {
    assert.equal(T.measure(null, null, 28, NOW), null);
    assert.equal(T.measure({ 'вчора': 80 }, { 'вчора': { kcal: 2000 } }, 28, NOW), null);
  });
});

describe('tdee-core: чесність числа', () => {
  it('смуга є завжди, і на коротшому вікні вона ширша', () => {
    const long = build(28, {});
    const short = build(14, {});
    const a = T.measure(long.bodyLog, long.mealLog, 28, NOW);
    const b = T.measure(short.bodyLog, short.mealLog, 14, NOW);
    assert.equal(a.hi > a.kcal && a.lo < a.kcal, true, JSON.stringify(a));
    assert.equal((b.hi - b.lo) > (a.hi - a.lo), true,
      'два тижні: ' + (b.hi - b.lo) + ', чотири: ' + (a.hi - a.lo));
  });

  it('довше вікно з повними даними дає вищу впевненість', () => {
    const long = build(28, {});
    const short = build(14, {});
    const a = T.measure(long.bodyLog, long.mealLog, 28, NOW);
    const b = T.measure(short.bodyLog, short.mealLog, 14, NOW);
    assert.equal(a.confidence, 'high');
    assert.equal(b.confidence, 'mid');
  });

  it('віддає сировину, з якої вийшло число', () => {
    const { bodyLog, mealLog } = build(28, { intake: 2500, maintenance: 2800 });
    const m = T.measure(bodyLog, mealLog, 28, NOW);
    assert.equal(m.intake, 2500);
    assert.equal(m.mealDays, 28);
    assert.equal(m.deltaKg < 0, true, 'худнення — відʼємна дельта');
    assert.equal(m.days, 28);
    /* Вага, ПРИ ЯКІЙ це виміряли: без неї виміряне підтримання не можна
       перенести на іншу вагу, а прогноз маси саме це й робить. */
    assert.equal(Math.abs(m.refKg - 79) < 1, true, 'refKg = ' + m.refKg);
  });
});

describe('tdee-core: порівняння з формулою', () => {
  it('каже, наскільки формула схибила', () => {
    const { bodyLog, mealLog } = build(28, { intake: 2500, maintenance: 2800 });
    const m = T.measure(bodyLog, mealLog, 28, NOW);
    const cmp = T.compare(m, 3100);
    assert.equal(cmp.diff < 0, true, 'формула завищувала');
    assert.equal(Math.abs(Math.abs(cmp.diff) - 300) <= 5, true, JSON.stringify(cmp));
    assert.equal(cmp.matters, true, 'різниця в 300 ккал — це не шум');
    assert.equal(T.compare(m, 2810).matters, false, 'десять ккал — шум');
    assert.equal(T.compare(null, 2800), null);
  });
});

/* ------------------------------------------------------------------ */
/*
 * ЦІЛЬ ВІД ВИМІРЯНОГО. Перемикач у профілі (tdeeMode) міняє те, від
 * чого рахується денна ціль: від формули Міффліна чи від того, що
 * виміряли по факту. Без перемикача — усе як було, до останнього знака.
 */
describe('nutrition-core: ціль від виміряних витрат', () => {
  const nctx = loadModules(['js/date-core.js', 'js/tdee-core.js', 'js/nutrition-core.js']);
  const NC = nctx.NutritionCalc;

  /* Формульний TDEE цього профілю — близько 2900; вимірювання дасть
     помітно менше, і саме ця різниця має доїхати до цілі. */
  const base = { sex: 'male', age: 31, height: 181, weight: 80, activity: 1.55, goal: 'maintain' };
  /* Ряд будується від СПРАВЖНЬОГО сьогодні: targetFor не приймає дати —
     у бою «сьогодні» завжди справжнє, і підставляти туди вигадану
     означало б перевіряти не ту функцію, що працює в застосунку. */
  const logs = build(28, { intake: 2300, maintenance: 2500 }, new Date());

  it('без перемикача нічого не змінилось', () => {
    const plain = NC.targetFor(base);
    const withLogs = NC.targetFor(Object.assign({}, base, logs));
    assert.equal(withLogs.kcal, plain.kcal, 'журнали самі по собі нічого не міняють');
    assert.equal(withLogs.measured, null);
  });

  it('із перемикачем ціль рахується від виміряного підтримання', () => {
    const p = Object.assign({}, base, logs, { tdeeMode: 'measured' });
    const t = NC.targetFor(p);
    assert.equal(Math.abs(t.tdee - 2500) <= 10, true, 'tdee = ' + t.tdee);
    assert.equal(t.measured !== null, true, 'ціль має сказати, що вона з вимірювання');
    assert.equal(t.measured.confidence, 'high');
  });

  it('якщо виміряти нічим — тихо лишається формула', () => {
    const p = Object.assign({}, base, { tdeeMode: 'measured' });
    const t = NC.targetFor(p);
    assert.equal(t.measured, null);
    assert.equal(t.kcal, NC.targetFor(base).kcal);
  });

  it('прогноз маси не тягне сьогоднішнє підтримання на іншу вагу', () => {
    const p = Object.assign({}, base, logs, { tdeeMode: 'measured', goal: 'cut', trainingAge: 'inter' });
    const now = NC.targetFor(p);
    const lighter = NC.targetFor(Object.assign({}, p, { weight: 70 }));
    assert.equal(lighter.tdee < now.tdee, true,
      'на 70 кг витрати мають бути меншими: ' + lighter.tdee + ' проти ' + now.tdee);
  });
});
