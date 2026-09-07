/**
 * Захист від змішування акаунтів у спільному браузері.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Аудит 2026-09 знайшов дві CRITICAL, і обидві —
 * про одне: дані одного користувача потрапляли в акаунт іншого на тому
 * самому компʼютері.
 *
 *   SYN-003 — enforceOwner правильно розпізнавав чужий профіль і
 *   повертав merge='foreign', але handleMerge такої гілки не мав:
 *   код провалювався в діалог «в цьому браузері теж є дані», і людина
 *   власноруч заливала чужі журнали у свій акаунт.
 *
 *   SYN-010 — signOut стирав чергу ib.pending, але запит, який був у
 *   польоті, падав ПІСЛЯ виходу і клав патч назад — у порожню чергу без
 *   ознаки власника. flushPending спрацьовував сам і накладав чужий
 *   патч на профіль наступного користувача. Без жодної дії людини.
 *
 * Тут перевіряються самі правила, без браузера: підпис черги власником,
 * фільтр чужого при відправці й барʼєр у adoptLocalProfile. Браузерний
 * бік (діалоги, реальні POST) — tools/verifyaccountmix.mjs.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const A = '00000000-0000-4000-8000-00000000000A';
const B = '00000000-0000-4000-8000-00000000000B';

/* Правила, вийняті з js/store.js один в один. Якщо змінюється store.js —
   має змінитись і це, інакше тест перестане описувати продакшен. */
const rules = {
  /** pendingPush: чий підпис ставиться і коли запис заборонено. */
  push(queue, patch, uid, blocked) {
    if (blocked || !uid) return { queue, written: false };
    const mine = queue.filter((it) => it && it.uid === uid);
    return { queue: mine.concat([{ at: 1, uid, patch }]).slice(-200), written: true };
  },
  /** doFlushPending: що піде в хмару, а що просто зникне з черги. */
  flush(queue, uid) {
    const mine = queue.filter((it) => it && it.uid === uid);
    return { send: mine, keep: mine };
  },
  /** adoptLocalProfile: барʼєр і чистка службових полів. */
  adopt(slot, uid) {
    if (slot.owner && uid && slot.owner !== uid) throw new Error('чужий акаунт');
    const clean = { ...slot };
    delete clean.owner; delete clean.savedAt;
    return clean;
  },
};

describe('Черга офлайн-патчів підписана власником (SYN-010)', () => {
  test('патч отримує uid того, хто зараз у сесії', () => {
    const r = rules.push([], { weight: 80 }, A, false);
    assert.equal(r.written, true);
    assert.equal(r.queue[0].uid, A);
  });

  test('після signOut у чергу не кладеться нічого', () => {
    const r = rules.push([], { weight: 80 }, A, true);
    assert.equal(r.written, false);
    assert.deepEqual(r.queue, []);
  });

  test('без сесії у чергу не кладеться нічого', () => {
    assert.equal(rules.push([], { weight: 80 }, null, false).written, false);
  });

  test('запис новим користувачем викидає чужі патчі з черги', () => {
    const r = rules.push([{ uid: A, patch: { weight: 95 } }], { weight: 70 }, B, false);
    assert.equal(r.queue.length, 1);
    assert.equal(r.queue[0].uid, B);
  });

  test('відправляються лише свої патчі', () => {
    const q = [{ uid: A, patch: { weight: 95 } }, { uid: B, patch: { weight: 70 } }];
    assert.deepEqual(rules.flush(q, B).send, [{ uid: B, patch: { weight: 70 } }]);
  });

  test('патч без підпису (стара версія) не відправляється нікому', () => {
    const q = [{ patch: { weight: 95 } }];
    assert.equal(rules.flush(q, B).send.length, 0);
    assert.equal(rules.flush(q, A).send.length, 0);
  });

  test('чужі патчі зникають із черги, а не накопичуються', () => {
    const q = [{ uid: A, patch: { x: 1 } }, { uid: A, patch: { x: 2 } }];
    assert.deepEqual(rules.flush(q, B).keep, []);
  });
});

describe('Барʼєр у adoptLocalProfile (SYN-003)', () => {
  test('слот із чужим owner не приймається', () => {
    assert.throws(() => rules.adopt({ owner: A, weight: 95 }, B), /чужий акаунт/);
  });

  test('власний слот приймається', () => {
    assert.equal(rules.adopt({ owner: A, weight: 95 }, A).weight, 95);
  });

  test('слот без owner (звичайний конфлікт входу) приймається', () => {
    assert.equal(rules.adopt({ weight: 82 }, B).weight, 82);
  });

  test('службові поля owner і savedAt не їдуть у профіль', () => {
    const out = rules.adopt({ owner: A, savedAt: '2026-09-01', weight: 95 }, A);
    assert.equal('owner' in out, false);
    assert.equal('savedAt' in out, false);
  });
});
