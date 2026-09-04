/**
 * Тести шару даних (js/store.js).
 *
 * Файл, у якому аудит знайшов найбільше проблем із цілісністю, до цього
 * моменту не мав жодного тесту: 288 наявних покривали чисті обчислювальні
 * ядра, тобто рівно ту частину, де помилок і не було. Тут — сценарії, які
 * реально губили або підміняли дані.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadStore, makeStorage, makeNet } from './helpers.js';

const UID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const UID_B = 'bbbbbbbb-0000-4000-8000-000000000002';

/** Мережа, яка вміє все, що треба для входу й читання-запису профілю. */
function net(cloudRow, opts) {
  const o = opts || {};
  const state = { row: cloudRow === undefined ? null : cloudRow, pushed: [] };
  const f = makeNet();
  f.route((u) => u.includes('/auth/v1/token'), () => ({
    status: o.loginStatus || 200,
    body: o.loginStatus && o.loginStatus >= 400 ? { msg: 'bad' } : {
      access_token: 'tok', refresh_token: 'ref', expires_in: 3600,
      user: { id: o.uid || UID_A, email: 'a@test' }
    }
  }));
  f.route((u) => u.includes('/auth/v1/logout'), () => ({ status: 204, body: null }));
  f.route((u) => u.includes('rpc/account_state'), () => ({
    status: 200, body: { status: o.accountStatus || 'approved', isAdmin: false }
  }));
  f.route((u) => u.includes('/rest/v1/profiles') && u.includes('select=data'), () => ({
    status: o.readStatus || 200,
    body: state.row === null ? [] : [{ data: state.row }]
  }));
  f.route((u) => u.includes('/rest/v1/profiles?on_conflict'), (u, opt) => {
    if (o.writeNetworkError) return { networkError: true };
    if (o.writeStatus && o.writeStatus >= 400) return { status: o.writeStatus, body: { message: 'no' } };
    state.pushed.push(opt.body[0].data);
    state.row = opt.body[0].data;
    return { status: 200, body: null };
  });
  f.state = state;
  return f;
}

describe('isMeaningful — порожній профіль мусить читатись як порожній', () => {
  test('чистий браузер + наявний акаунт: конфлікту НЕ виникає', async () => {
    const f = net({ weight: 82, bodyLog: { '2026-01-01': 80 } });
    const s = loadStore({ fetch: f });
    const res = await s.Store.signIn('a@test', 'password');
    // Було 'conflict': isMeaningful() повертав true для бланка через
    // ratingAlgorithmVersion: 0 і weightLogSeeded: true.
    assert.equal(res.merge, null);
  });

  test('справжні локальні дані все ще вважаються даними', async () => {
    const ls = makeStorage({ 'ib.profile': JSON.stringify({ weight: 77, bodyLog: { '2026-02-02': 77 } }) });
    const f = net({ weight: 82 });
    const s = loadStore({ fetch: f, storage: ls });
    const res = await s.Store.signIn('a@test', 'password');
    assert.equal(res.merge, 'conflict');
  });

  test('порожній хмарний рядок + справжні локальні дані → adopted', async () => {
    const ls = makeStorage({ 'ib.profile': JSON.stringify({ weight: 77 }) });
    const f = net(null);
    const s = loadStore({ fetch: f, storage: ls });
    const res = await s.Store.signIn('a@test', 'password');
    assert.equal(res.merge, 'adopted');
    assert.equal(f.state.row.weight, 77);
  });
});

describe('Власник локальних даних', () => {
  test('вхід A → вихід → вхід B: B НЕ отримує даних A', async () => {
    const ls = makeStorage();
    const fa = net(null, { uid: UID_A });
    const a = loadStore({ fetch: fa, storage: ls });
    await a.Store.signIn('a@test', 'password');
    await a.Store.saveProfile({ weight: 70, bodyLog: { '2026-03-03': 70 } });
    assert.equal(fa.state.row.weight, 70, 'дані A доїхали в хмару A');
    await a.Store.signOut();

    const fb = net(null, { uid: UID_B });
    const b = loadStore({ fetch: fb, storage: ls });
    const res = await b.Store.signIn('b@test', 'password');
    assert.notEqual(res.merge, 'adopted', 'профіль A не заливається в акаунт B');
    const prof = await b.Store.getProfile();
    assert.equal(prof.weight, null, 'у B порожній профіль, а не вага A');
    assert.equal(fb.state.row, null, 'у хмару B нічого чужого не записано');
  });

  test('обірвана сесія (без signOut) + інший користувач: дані відкладаються', async () => {
    const ls = makeStorage();
    const fa = net(null, { uid: UID_A });
    const a = loadStore({ fetch: fa, storage: ls });
    await a.Store.signIn('a@test', 'password');
    await a.Store.saveProfile({ weight: 70 });
    // Імітуємо відкликану сесію: 401 стирає сесію, але ЛИШАЄ ib.profile
    ls.removeItem('ib.session');

    const fb = net(null, { uid: UID_B });
    const b = loadStore({ fetch: fb, storage: ls });
    const res = await b.Store.signIn('b@test', 'password');
    assert.equal(res.merge, 'foreign');
    assert.equal(ls.getItem('ib.profile'), null, 'чужий профіль прибрано з робочого ключа');
    assert.ok(ls.getItem('ib.profile.backup.login'), 'і збережено в окремому слоті');
    assert.equal(fb.state.row, null, 'у хмару B нічого не пішло');
  });

  test('вихід прибирає весь стан ELO', async () => {
    const ls = makeStorage({
      'ib.eloState': '{"elo":900}', 'ib.eloPending': '[{"key":"x"}]',
      'ib.eloSent': '{"meal:2026-01-01":true}', 'ib.eloWeeks': '{}',
      'ib.eloClosed': '{}', 'ib.eloReport': '{"ok":true}'
    });
    const s = loadStore({ fetch: net(null), storage: ls });
    await s.Store.signIn('a@test', 'password');
    await s.Store.signOut();
    ['ib.eloState', 'ib.eloPending', 'ib.eloSent', 'ib.eloWeeks', 'ib.eloClosed', 'ib.eloReport']
      .forEach((k) => assert.equal(ls.getItem(k), null, k + ' мусить зникнути'));
  });
});

describe('Резервні копії — два незалежні слоти', () => {
  test('вхід не затирає копію, зроблену перед імпортом', async () => {
    const ls = makeStorage({
      'ib.profile': JSON.stringify({ weight: 99 }),
      'ib.profile.backup': JSON.stringify({ savedAt: 'x', weight: 55, note: 'доімпортний' })
    });
    const s = loadStore({ fetch: net({ weight: 82 }), storage: ls });
    await s.Store.signIn('a@test', 'password');
    const imp = JSON.parse(ls.getItem('ib.profile.backup'));
    assert.equal(imp.weight, 55, 'копія перед імпортом недоторкана');
    const login = JSON.parse(ls.getItem('ib.profile.backup.login'));
    assert.equal(login.weight, 99, 'копія входу — окремий слот');
  });
});

describe('401 і 403 — різні речі', () => {
  test('403 (не approved) НЕ знищує сесію', async () => {
    const f = net(null, { readStatus: 403 });
    const s = loadStore({ fetch: f });
    await s.Store.signIn('a@test', 'password');
    assert.ok(s.Store.user(), 'сесія жива після входу');
    try { await s.Store.getProfile(); } catch (_) {}
    assert.ok(s.Store.user(), '403 не має розлогінювати — це питання статусу, не токена');
  });

  test('401 знищує сесію', async () => {
    const f = net(null, { readStatus: 401 });
    const s = loadStore({ fetch: f });
    await s.Store.signIn('a@test', 'password');
    try { await s.Store.getProfile(); } catch (_) {}
    assert.equal(s.Store.user(), null);
  });
});

describe('Хмарний доступ за замовчуванням закритий', () => {
  test('невідомий статус акаунта → у хмару не пишемо', async () => {
    const f = net(null);
    f.route((u) => u.includes('rpc/account_state'), () => ({ status: 500, body: { message: 'oops' } }));
    const s = loadStore({ fetch: f });
    await s.Store.signIn('a@test', 'password');
    await s.Store.saveProfile({ weight: 61 });
    assert.equal(f.state.pushed.length, 0, 'fail-closed: без статусу запис у хмару не йде');
    assert.equal(JSON.parse(s.ls.getItem('ib.profile')).weight, 61, 'локально збережено');
  });

  test('pending статус → у хмару не пишемо', async () => {
    const f = net(null, { accountStatus: 'pending' });
    const s = loadStore({ fetch: f });
    await s.Store.signIn('a@test', 'password');
    await s.Store.saveProfile({ weight: 62 });
    assert.equal(f.state.pushed.length, 0);
  });
});

describe('Переповнене сховище', () => {
  test('видима помилка навіть коли хмара прийняла запис', async () => {
    const f = net(null);
    const s = loadStore({ fetch: f });
    await s.Store.signIn('a@test', 'password');
    s.ls.setQuota(1);   // будь-який запис тепер падає
    await assert.rejects(
      () => s.Store.saveProfile({ weight: 63 }),
      /переповнене/i,
      'мовчазний провал локального запису — це втрачений офлайн-резерв'
    );
  });
});

describe('Незіслані зміни не затираються хмарою', () => {
  test('перерваний запит: локальна копія переживає читання з хмари', async () => {
    const ls = makeStorage();
    const f = net(null);
    const s = loadStore({ fetch: f, storage: ls });
    await s.Store.signIn('a@test', 'password');

    // Запис у хмару обривається так, як це робить вивантаження сторінки:
    // позначка dirty вже стоїть, черга ще порожня.
    f.route((u) => u.includes('/rest/v1/profiles?on_conflict'), () => ({ networkError: true }));
    await s.Store.saveProfile({ weight: 64, updatedAt: '2026-06-01T10:00:00.000Z' }).catch(() => {});
    ls.removeItem('ib.pending');            // патч «загубився» при вивантаженні
    assert.ok(ls.getItem('ib.profile.dirty'), 'позначка незісланих змін лишилась');

    // Нове відкриття сайту: у хмарі СТАРІШИЙ рядок
    const f2 = net({ weight: 10, updatedAt: '2026-01-01T00:00:00.000Z' });
    const s2 = loadStore({ fetch: f2, storage: ls });
    const prof = await s2.Store.getProfile();
    assert.equal(prof.weight, 64, 'локальна копія перемогла старіший хмарний рядок');
  });

  test('успішний запис знімає позначку', async () => {
    const s = loadStore({ fetch: net(null) });
    await s.Store.signIn('a@test', 'password');
    await s.Store.saveProfile({ weight: 65 });
    assert.equal(s.ls.getItem('ib.profile.dirty'), null);
  });
});

describe('Рядка в хмарі ще немає', () => {
  test('порожня відповідь не затирає локальний профіль', async () => {
    const ls = makeStorage({
      'ib.profile': JSON.stringify({ weight: 88, bodyLog: { '2026-05-05': 88 }, version: 9 }),
      'ib.account': JSON.stringify({ status: 'approved' }),
      'ib.session': JSON.stringify({ access_token: 't', refresh_token: 'r',
        expires_at: Date.now() + 86400000, user: { id: UID_A, email: 'a@test' } }),
      'ib.profile.owner': UID_A
    });
    // Хмара відповідає порожнім масивом: рядка для цього користувача немає.
    const f = net(null);
    const s = loadStore({ fetch: f, storage: ls });
    const prof = await s.Store.getProfile();
    assert.equal(prof.weight, 88, 'локальні дані мусять пережити відсутність рядка');
    assert.equal(JSON.parse(ls.getItem('ib.profile')).weight, 88, 'і не бути затертими бланком');
  });

  test('наявний хмарний рядок і далі виграє', async () => {
    const ls = makeStorage({
      'ib.profile': JSON.stringify({ weight: 88, version: 9 }),
      'ib.account': JSON.stringify({ status: 'approved' }),
      'ib.session': JSON.stringify({ access_token: 't', refresh_token: 'r',
        expires_at: Date.now() + 86400000, user: { id: UID_A, email: 'a@test' } }),
      'ib.profile.owner': UID_A
    });
    const s = loadStore({ fetch: net({ weight: 91, version: 9 }), storage: ls });
    const prof = await s.Store.getProfile();
    assert.equal(prof.weight, 91);
  });
});

describe('Одночасні записи', () => {
  test('saveProfile і flushPending не відкочують одне одного', async () => {
    const ls = makeStorage();
    const f = net(null);
    const s = loadStore({ fetch: f, storage: ls });
    await s.Store.signIn('a@test', 'password');
    await s.Store.saveProfile({ weight: 70 });

    // У черзі лежить патч, і одночасно йде звичайне збереження
    ls.setItem('ib.pending', JSON.stringify([{ patch: { height: 180 }, t: Date.now() }]));
    await Promise.all([
      s.Store.saveProfile({ weight: 71 }),
      s.Store.flushPending()
    ]);
    const prof = await s.Store.getProfile();
    assert.equal(prof.weight, 71, 'нове значення не відкочене чергою');
    assert.equal(prof.height, 180, 'патч із черги накладено');
    assert.equal(f.state.row.weight, 71, 'у хмарі теж свіже значення');
  });
});

describe('clearLocal', () => {
  test('прибирає й стан ELO, і власника, і обидві копії', async () => {
    const ls = makeStorage({
      'ib.eloState': '{}', 'ib.eloPending': '[]', 'ib.profile.backup': '{}',
      'ib.profile.backup.login': '{}', 'ib.profile.owner': UID_A, 'ib.account': '{}'
    });
    const s = loadStore({ fetch: net(null), storage: ls });
    s.Store.clearLocal();
    ['ib.eloState', 'ib.eloPending', 'ib.profile.backup', 'ib.profile.backup.login',
     'ib.profile.owner', 'ib.account'].forEach((k) =>
      assert.equal(ls.getItem(k), null, k + ' мусить зникнути'));
  });
});

/* ==========================================================================
   Куди повертає лист із пошти
   ==========================================================================
   Реальний збій: Site URL у проєкті лишався http://localhost:3000, тож
   посилання підтвердження вело сторонню людину на мертву сторінку. Сервер
   пошту підтверджував, а людина бачила «не вдається відкрити сторінку» й
   вважала, що реєстрація не пройшла. Тепер клієнт називає адресу сам.
   ========================================================================== */
describe('Auth: redirect_to у листах', () => {
  /** Мережа, яка приймає будь-який auth-запит і запамʼятовує адресу. */
  function authNet() {
    const f = makeNet();
    f.route((u) => u.includes('/auth/v1/'), () => ({ status: 200, body: { user: { id: UID_A, identities: [{}] } } }));
    return f;
  }
  const urlOf = (fetchImpl, part) =>
    (fetchImpl.calls.find((c) => c.url.includes(part)) || {}).url || '';

  test('signup несе redirect_to на welcome.html', async () => {
    const f = authNet();
    const { Store } = loadStore({ fetch: f });
    await Store.signUp('a@test.com', 'Ab1!xyzq');
    const u = urlOf(f, '/auth/v1/signup');
    assert.match(u, /redirect_to=https%3A%2F%2Fforge\.test%2Fwelcome\.html/);
  });

  test('recover і resend несуть ту саму адресу', async () => {
    const f = authNet();
    const { Store } = loadStore({ fetch: f });
    await Store.requestPasswordReset('a@test.com');
    await Store.resendConfirmation('a@test.com');
    for (const p of ['/auth/v1/recover', '/auth/v1/resend']) {
      assert.match(urlOf(f, p), /redirect_to=https%3A%2F%2Fforge\.test%2Fwelcome\.html/, p);
    }
  });

  test('file:// — redirect_to не додається (GoTrue відкине origin "null")', async () => {
    const f = authNet();
    const { Store } = loadStore({
      fetch: f,
      location: { origin: 'null', protocol: 'file:', pathname: '/welcome.html' }
    });
    await Store.signUp('a@test.com', 'Ab1!xyzq');
    assert.equal(urlOf(f, '/auth/v1/signup').includes('redirect_to'), false);
  });

  test('фрагмент з помилкою пояснюється, а не ігнорується', async () => {
    const f = authNet();
    const { Store } = loadStore({
      fetch: f,
      location: {
        origin: 'https://forge.test', protocol: 'https:', pathname: '/welcome.html',
        search: '', hash: '#error=access_denied&error_code=otp_expired'
      }
    });
    await assert.rejects(() => Store.adoptUrlSession(), /застаріло/);
  });

  test('чистий фрагмент — не помилка, а «нічого не сталось»', async () => {
    const f = authNet();
    const { Store } = loadStore({ fetch: f, location: { hash: '#anchor' } });
    assert.equal(await Store.adoptUrlSession(), null);
  });
});
