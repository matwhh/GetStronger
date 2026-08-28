/**
 * Онбординг як стан даних (js/onboarding-core.js).
 *
 * «Сьогодні» передається аргументом, щоб тести не залежали від дня
 * запуску. Профілі будуються по шматку: кожен тест показує, якого САМЕ
 * поля бракує, щоб крок не зарахувався.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const OC = loadModules(['js/age-core.js', 'js/onboarding-core.js']).OnboardingCore;

const NOW = new Date(2026, 7, 26); // 26 серпня 2026
const step = (p) => OC.stepFor(p, NOW);

/* Складання профілю по кроках. */
const AGE  = { version: 6, birthDate: '1990-06-15' };
const BODY = { sex: 'male', weight: 82, height: 180, activity: 1.55, trainingAge: 'inter' };
const PROG = { activePlan: { programId: 'ppl', days: 6 }, weights: { 'Жим штанги лежачи': 80 } };

const full = () => Object.assign({}, AGE, BODY, PROG);

describe('Онбординг: порядок кроків', () => {
  it('порожній профіль → вік', () => {
    assert.equal(step(null), 'age');
    assert.equal(step(undefined), 'age');
    assert.equal(step({}), 'age');
  });

  it('дорослий без тіла → тіло', () => {
    assert.equal(step({ ...AGE }), 'body');
  });

  it('дорослий з тілом без програми → програма', () => {
    assert.equal(step({ ...AGE, ...BODY }), 'program');
  });

  it('повний профіль → done', () => {
    assert.equal(step(full()), 'done');
  });

  it('неповнолітній — завжди вік, хай там що заповнено', () => {
    assert.equal(step({ ...full(), birthDate: '2015-01-01' }), 'age');
  });

  it('зіпсована дата → вік', () => {
    ['', 'вчора', '2015-13-40', 123, null].forEach((b) => {
      assert.equal(step({ ...full(), birthDate: b }), 'age', String(b));
    });
  });
});

describe('Онбординг: крок «тіло» — кожного поля бракує окремо', () => {
  it('без статі', () => {
    assert.equal(step({ ...AGE, ...BODY, sex: null }), 'body');
    assert.equal(step({ ...AGE, ...BODY, sex: 'm' }), 'body');
  });

  it('без ваги / вага поза межами', () => {
    assert.equal(step({ ...AGE, ...BODY, weight: null }), 'body');
    assert.equal(step({ ...AGE, ...BODY, weight: 10 }), 'body');
    assert.equal(step({ ...AGE, ...BODY, weight: 500 }), 'body');
    assert.equal(step({ ...AGE, ...BODY, weight: 'багато' }), 'body');
  });

  it('без зросту / зріст поза межами', () => {
    assert.equal(step({ ...AGE, ...BODY, height: null }), 'body');
    assert.equal(step({ ...AGE, ...BODY, height: 90 }), 'body');
    assert.equal(step({ ...AGE, ...BODY, height: 300 }), 'body');
  });

  it('без активності / чужий множник', () => {
    assert.equal(step({ ...AGE, ...BODY, activity: null }), 'body');
    assert.equal(step({ ...AGE, ...BODY, activity: 2.5 }), 'body');
  });

  it('активність і числом, і рядком — обидві форми легальні', () => {
    assert.equal(step({ ...AGE, ...BODY, ...PROG, activity: 1.375 }), 'done');
    assert.equal(step({ ...AGE, ...BODY, ...PROG, activity: '1.375' }), 'done');
  });

  it('без стажу тренувань / чужий стаж', () => {
    assert.equal(step({ ...AGE, ...BODY, trainingAge: null }), 'body');
    assert.equal(step({ ...AGE, ...BODY, trainingAge: 'pro' }), 'body');
  });

  it('усі чотири стажі легальні', () => {
    ['novice', 'inter', 'adv', 'elite'].forEach((t) => {
      assert.equal(step({ ...AGE, ...BODY, ...PROG, trainingAge: t }), 'done', t);
    });
  });

  it('обидва пульси — опційні: їх відсутність кроку не тримає', () => {
    const p = { ...AGE, ...BODY, ...PROG, hrRest: null, hrMax: null };
    assert.equal(step(p), 'done');
  });
});

describe('Онбординг: крок «програма»', () => {
  it('без activePlan', () => {
    assert.equal(step({ ...AGE, ...BODY, weights: { 'Жим': 80 } }), 'program');
  });

  it('activePlan без programId — не зараховується', () => {
    assert.equal(step({ ...AGE, ...BODY, ...PROG, activePlan: { days: 3 } }), 'program');
  });

  it('план без жодної ваги', () => {
    assert.equal(step({ ...AGE, ...BODY, ...PROG, weights: {} }), 'program');
  });

  it('вага-сміття не рахується', () => {
    assert.equal(step({ ...AGE, ...BODY, ...PROG, weights: { 'Жим': 0 } }), 'program');
    assert.equal(step({ ...AGE, ...BODY, ...PROG, weights: { 'Жим': 'важко' } }), 'program');
    assert.equal(step({ ...AGE, ...BODY, ...PROG, weights: { 'Жим': -5 } }), 'program');
  });

  it('однієї справжньої ваги досить', () => {
    assert.equal(step({ ...AGE, ...BODY, ...PROG, weights: { 'Присід': 100 } }), 'done');
  });
});

describe('Онбординг: наявні користувачі (історія = доказ)', () => {
  it('журнал ваги тіла зараховує онбординг без тіла й програми', () => {
    assert.equal(step({ ...AGE, bodyLog: { '2026-01-01': 82 } }), 'done');
  });

  it('будь-який журнал спрацьовує', () => {
    const logs = ['workLog', 'sessionLog', 'mealLog', 'weightLog', 'trackerLog'];
    logs.forEach((k) => {
      assert.equal(step({ ...AGE, [k]: { x: 1 } }), 'done', k);
    });
  });

  it('порожні журнали НЕ зараховують', () => {
    const p = { ...AGE, bodyLog: {}, workLog: {}, sessionLog: {}, mealLog: {}, weightLog: {}, trackerLog: {} };
    assert.equal(step(p), 'body');
  });

  it('історія не скасовує вік: неповнолітній з журналом — на гейт', () => {
    assert.equal(step({ birthDate: '2015-01-01', bodyLog: { d: 1 } }), 'age');
  });

  it('імпорт повної копії = онбординг пройдено', () => {
    // Те, що лежить у файлі експорту наявного користувача.
    const imported = { ...full(), bodyLog: { '2026-05-01': 81.5 } };
    assert.equal(step(imported), 'done');
  });
});

describe('Онбординг: маршрути', () => {
  it('кожен крок знає свою сторінку', () => {
    assert.equal(OC.pageFor('age'), 'welcome.html');
    assert.equal(OC.pageFor('body'), 'welcome.html');
    assert.equal(OC.pageFor('program'), 'programs.html');
    assert.equal(OC.pageFor('done'), 'index.html');
    assert.equal(OC.pageFor('казна-що'), 'welcome.html');
  });

  it('вік: лише welcome', () => {
    assert.equal(OC.isAllowed('age', 'welcome.html'), true);
    assert.equal(OC.isAllowed('age', 'account.html'), false);
    assert.equal(OC.isAllowed('age', 'index.html'), false);
  });

  it('тіло: welcome + account (шлях для імпорту резервної копії)', () => {
    assert.equal(OC.isAllowed('body', 'welcome.html'), true);
    assert.equal(OC.isAllowed('body', 'account.html'), true);
    assert.equal(OC.isAllowed('body', 'index.html'), false);
  });

  it('програма: programs + plan + account', () => {
    assert.equal(OC.isAllowed('program', 'programs.html'), true);
    assert.equal(OC.isAllowed('program', 'plan.html'), true);
    assert.equal(OC.isAllowed('program', 'account.html'), true);
    assert.equal(OC.isAllowed('program', 'welcome.html'), false);
    assert.equal(OC.isAllowed('program', 'index.html'), false);
  });

  it('done: усе, крім welcome', () => {
    assert.equal(OC.isAllowed('done', 'index.html'), true);
    assert.equal(OC.isAllowed('done', 'workout.html'), true);
    assert.equal(OC.isAllowed('done', 'welcome.html'), false);
  });
});
