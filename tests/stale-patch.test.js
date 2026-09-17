/**
 * ОФЛАЙНОВА РОБОТА НЕ МАЄ ЗНИКАТИ МОВЧКИ (js/store.js, mergeStalePatch).
 *
 * Сценарій, який її губив. Вівторок, зал без мережі: телефон записує
 * тренування, патч лягає в чергу. Середа: з ноутбука людина міняє щось в
 * «Акаунті» — хмарний рядок стає новішим. Увечері телефон відкриває сайт:
 * хмара новіша, локальна копія затирається нею, а патч вівторка —
 * старіший за базу — не відправляють і ОДНАКОВО знімають із черги.
 * Тренування зникає з усіх пристроїв.
 *
 * Просто накласти патч теж не можна: патч — це повне значення ключа, і
 * старий sessionLog поверне журнал до вівторкового стану, стерши все, що
 * додали в середу (PRF-001).
 *
 * Тому старий патч тепер лише ДОПИСУЄ в журнали, і лише дні, НЕ СТАРІШІ
 * за сам патч. Правило вузьке навмисно: патч, зроблений у вівторок, не
 * може відродити понеділковий запис, який у середу свідомо прибрали.
 */
import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore } from './helpers.js';

const S = loadStore({ local: true }).Store;
const merge = S.mergeStalePatch;

/* Порівнюємо РЯДКАМИ, а не deepEqual: обʼєкти приходять із пісочниці vm
   з іншим прототипом, і глибоке порівняння падає навіть на однакових
   даних. Та сама пастка вже описана в tests/per-set-weight.test.js. */
const keys = (o) => Object.keys(o || {}).sort().join(',');
const list = (a) => (a || []).slice().sort().join(',');

describe('старий патч дописує, а не перетирає', () => {
  it('день, якого в базі немає, повертається', () => {
    const base = { sessionLog: { '2026-09-16': { done: 3 } } };
    const patch = { sessionLog: { '2026-09-15': { done: 4 } } };
    const r = merge(base, patch, '2026-09-15');
    assert.equal(keys(r.merged.sessionLog), '2026-09-15,2026-09-16');
    assert.equal(r.merged.sessionLog['2026-09-15'].done, 4);
    assert.equal(list(r.added), 'sessionLog');
  });

  it('день, який у базі Є, лишається базовим', () => {
    const base = { sessionLog: { '2026-09-15': { done: 9 } } };
    const patch = { sessionLog: { '2026-09-15': { done: 4 } } };
    const r = merge(base, patch, '2026-09-15');
    assert.equal(r.merged.sessionLog['2026-09-15'].done, 9, 'новіше значення не перетирається');
    assert.equal(list(r.added), '');
  });

  it('дні, СТАРІШІ за сам патч, не відроджуються', () => {
    /* Понеділок прибрали в середу; патч вівторка не має його повертати. */
    const base = { workLog: { '2026-09-16': 1 } };
    const patch = { workLog: { '2026-09-14': 1, '2026-09-15': 1 } };
    const r = merge(base, patch, '2026-09-15');
    assert.equal(keys(r.merged.workLog), '2026-09-15,2026-09-16');
  });

  it('усі поденні журнали, а не тільки тренування', () => {
    const base = {};
    const patch = {
      bodyLog: { '2026-09-15': 80 }, mealLog: { '2026-09-15': { kcal: 2000 } },
      measureLog: { '2026-09-15': { waist: 80 } }, trackerLog: { '2026-09-15': { water: 2 } },
      days: { '2026-09-15': [1] }, sessions: { '2026-09-15': 1 }, workLog: { '2026-09-15': 1 }
    };
    const r = merge(base, patch, '2026-09-15');
    assert.equal(r.added.length, 7, JSON.stringify(r.added));
    assert.equal(r.dropped.length, 0, JSON.stringify(r.dropped));
  });

  it('книга ваг: запис вправи дописується за датою й не дублюється', () => {
    const base = { weightLog: { 'Жим': [{ d: '2026-09-10', kg: 60 }, { d: '2026-09-16', kg: 70 }] } };
    const patch = { weightLog: { 'Жим': [{ d: '2026-09-15', kg: 65 }],
                                 'Тяга': [{ d: '2026-09-15', kg: 100 }] } };
    const r = merge(base, patch, '2026-09-15');
    assert.equal(r.merged.weightLog['Жим'].map(function (e) { return e.d; }).join(','),
      '2026-09-10,2026-09-15,2026-09-16', 'відсортовано за датою');
    assert.equal(r.merged.weightLog['Тяга'].length, 1, 'нова вправа теж приїхала');

    /* Та сама дата вже є — базова перемагає. */
    const r2 = merge(r.merged, { weightLog: { 'Жим': [{ d: '2026-09-16', kg: 999 }] } }, '2026-09-16');
    assert.equal(r2.merged.weightLog['Жим'].filter(function (e) { return e.d === '2026-09-16'; }).length, 1);
    assert.equal(r2.merged.weightLog['Жим'].find(function (e) { return e.d === '2026-09-16'; }).kg, 70);
  });

  it('незбагненні ключі не накладаються — і про це кажуть', () => {
    const base = { weight: 82, goal: 'cut' };
    const patch = { weight: 80, customPlans: { a: 1 } };
    const r = merge(base, patch, '2026-09-15');
    assert.equal(r.merged.weight, 82, 'скалярне поле з новішого профілю не чіпаємо');
    assert.equal(list(r.dropped), 'customPlans,weight');
  });

  it('сміття не кидає винятків', () => {
    assert.equal(merge(null, null, '2026-09-15').dropped.length, 0);
    assert.equal(merge({}, { sessionLog: 'ні' }, '2026-09-15').dropped[0], 'sessionLog');
    assert.equal(merge({}, { weightLog: { 'Жим': 'ні' } }, '2026-09-15').added.length, 0);
    /* Без дати патча не можна вирішити, що старе, а що ні — не чіпаємо нічого. */
    assert.equal(merge({}, { sessionLog: { '2026-09-15': {} } }, '').added.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/*
 * Той самий сценарій, але через справжній шлях: черга, хмара, flush.
 * Перевірка вище стереже правило, ця — те, що правило справді
 * застосовується там, де дані губились.
 */
import { loadStore as loadStore2, makeStorage, makeNet } from './helpers.js';

const UID = 'aaaaaaaa-0000-4000-8000-000000000001';

function cloud(row) {
  const state = { row: row === undefined ? null : row, patched: [] };
  const f = makeNet();
  f.route((u) => u.includes('/auth/v1/token'), () => ({
    status: 200,
    body: { access_token: 'tok', refresh_token: 'ref', expires_in: 3600,
            user: { id: UID, email: 'a@test' } }
  }));
  f.route((u) => u.includes('rpc/account_state'), () => ({
    status: 200, body: { status: 'approved', isAdmin: false }
  }));
  f.route((u) => u.includes('/rest/v1/profiles') && u.includes('select=data'), () => ({
    status: 200, body: state.row === null ? [] : [{ data: state.row }]
  }));
  /* Запис профілю йде UPSERT-ом у /rest/v1/profiles, а не через
     rpc/profile_patch: перший — повний рядок, другий — точкова латка. */
  f.route((u) => u.includes('/rest/v1/profiles?on_conflict'), (u, opt) => {
    state.row = opt.body[0].data;
    state.patched.push(state.row);
    return { status: 200, body: null };
  });
  f.state = state;
  return f;
}

describe('офлайнове тренування переживає новіший профіль з іншого пристрою', () => {
  it('день із черги доїжджає в хмару, а середа лишається цілою', async () => {
    const ls = makeStorage();
    /* Хмара: середа, у журналі вже є середній день. */
    const f = cloud({
      version: 12, updatedAt: '2026-09-16T10:00:00.000Z',
      weight: 80, sessionLog: { '2026-09-16': { done: 5 } }
    });
    const s = loadStore2({ fetch: f, storage: ls });
    await s.Store.signIn('a@test', 'password');

    /* Черга: вівторкове тренування, зроблене офлайн — на добу раніше. */
    const tue = new Date('2026-09-15T19:00:00.000Z').getTime();
    ls.setItem('ib.pending', JSON.stringify([{
      id: 'p-tue', at: tue, uid: UID,
      patch: { weight: 79, sessionLog: { '2026-09-15': { done: 3 } } }
    }]));

    await s.Store.flushPending();
    const prof = await s.Store.getProfile();

    assert.equal(!!prof.sessionLog['2026-09-15'], true, 'вівторок не зник');
    assert.equal(prof.sessionLog['2026-09-15'].done, 3);
    assert.equal(prof.sessionLog['2026-09-16'].done, 5, 'середа ціла');
    assert.equal(prof.weight, 80, 'скалярне поле лишилось за новішим профілем');
    assert.equal(!!f.state.row.sessionLog['2026-09-15'], true, 'і в хмарі теж');

    const stale = JSON.parse(ls.getItem('ib.profile.backup.stale') || 'null');
    assert.equal(!!stale, true, 'те, що не наклалось, збережено, а не викинуто');
    assert.equal(stale.items[0].dropped.join(','), 'weight');
  });

  it('черга чиститься саме від відправленого', async () => {
    const ls = makeStorage();
    const f = cloud({ version: 12, updatedAt: '2026-09-16T10:00:00.000Z' });
    const s = loadStore2({ fetch: f, storage: ls });
    await s.Store.signIn('a@test', 'password');
    ls.setItem('ib.pending', JSON.stringify([
      { id: 'p1', at: Date.now(), uid: UID, patch: { height: 180 } }
    ]));
    await s.Store.flushPending();
    assert.equal(ls.getItem('ib.pending'), null, 'відправлене знято');
  });
});
