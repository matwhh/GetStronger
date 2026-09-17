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
  const state = { row: cloudRow === undefined ? null : cloudRow, pushed: [], patched: [] };
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
  f.route((u) => u.includes('rpc/profile_patch'), (u, opt) => {
    if (o.writeNetworkError) return { networkError: true };
    if (o.writeStatus && o.writeStatus >= 400) return { status: o.writeStatus, body: { message: 'no' } };
    state.patched.push(opt.body.p_patch);
    state.row = Object.assign({}, state.row || {}, opt.body.p_patch);   // data || p_patch
    return { status: 200, body: null };
  });
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
    assert.equal(fb.state.row, null, 'у хмару B нічого не пішло');
    /*
     * А ОСЬ КОПІЇ БІЛЬШЕ НЕМАЄ — і це свідома зміна (аудит 17.09.2026).
     *
     * Профіль A встиг доїхати в хмару, тож копія в ЦЬОМУ браузері не дає
     * йому нічого: він побачить свої дані, увійшовши з будь-якого
     * пристрою. Зате B бачив би в DevTools чужу анкету — вагу, відсоток
     * жиру, заміри тіла, журнали. Копія лишається лише тоді, коли вона
     * ЄДИНА (наступний тест).
     */
    assert.equal(ls.getItem('ib.profile.backup.login'), null,
      'дані A вже в хмарі — чужа копія в браузері не лишається');
  });

  test('…але якщо в попереднього власника лишалась незіслана робота — копія є', async () => {
    const ls = makeStorage();
    const fa = net(null, { uid: UID_A, writeNetworkError: true });
    const a = loadStore({ fetch: fa, storage: ls });
    await a.Store.signIn('a@test', 'password');
    /* Мережі немає: патч лягає в чергу, у хмару не доїхав. */
    await a.Store.saveProfile({ weight: 70 }).catch(() => {});
    assert.ok(JSON.parse(ls.getItem('ib.pending') || '[]').length, 'патч у черзі');
    ls.removeItem('ib.session');

    const fb = net(null, { uid: UID_B });
    const b = loadStore({ fetch: fb, storage: ls });
    await b.Store.signIn('b@test', 'password');
    const slot = JSON.parse(ls.getItem('ib.profile.backup.login') || 'null');
    assert.ok(slot, 'копія збережена: іншої копії цих даних немає ніде');
    assert.equal(slot.owner, UID_A);
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

    // У черзі лежить патч, і одночасно йде звичайне збереження.
    // uid обовʼязковий: відколи чергу підписано власником (SYN-010),
    // патч без підпису не належить нікому і не відправляється.
    ls.setItem('ib.pending', JSON.stringify([{ patch: { height: 180 }, t: Date.now(), uid: UID_A }]));
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

/*
 * Чому непідписаний патч можна викидати без вагань.
 *
 * doSave пише ПОВНИЙ профіль у ib.profile ще до того, як покласти патч у
 * чергу, а pushToCloud відправляє профіль цілком. Тобто черга — це не
 * єдина копія змін, а лише спроба доштовхнути їх у хмару раніше. Якщо
 * патч викинуто, дані лишаються в локальному профілі й поїдуть у хмару
 * з наступним успішним збереженням.
 *
 * Саме тому правило «немає підпису — не відправляємо» безпечне: воно
 * закриває шлях, яким чужий патч потрапляв у чужий акаунт, і при цьому
 * нічого не втрачає у власника.
 */
describe('Черга без підпису (SYN-010)', () => {
  test('непідписаний патч не їде в хмару', async () => {
    const ls = makeStorage();
    const f = net(null);
    const s = loadStore({ fetch: f, storage: ls });
    await s.Store.signIn('a@test', 'password');
    await s.Store.saveProfile({ weight: 70 });

    ls.setItem('ib.pending', JSON.stringify([{ patch: { height: 180 }, t: Date.now() }]));
    await s.Store.flushPending();

    assert.notEqual(f.state.row.height, 180, 'чужого/безхазяйного патча в хмарі бути не має');
    assert.deepEqual(JSON.parse(ls.getItem('ib.pending') || '[]'), [], 'і в черзі він не лишається');
  });

  test('патч із чужим uid не їде в хмару', async () => {
    const ls = makeStorage();
    const f = net(null);
    const s = loadStore({ fetch: f, storage: ls });
    await s.Store.signIn('a@test', 'password');
    await s.Store.saveProfile({ weight: 70 });

    ls.setItem('ib.pending', JSON.stringify([
      { patch: { height: 180 }, t: Date.now(), uid: 'bbbbbbbb-0000-4000-8000-000000000002' }
    ]));
    await s.Store.flushPending();

    assert.notEqual(f.state.row.height, 180);
    assert.equal(f.state.row.weight, 70, 'власні дані не зачеплені');
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

  /*
   * ПЕРЕЛІК ПРОТИ ПОВЕДІНКИ.
   *
   * Попередня перевірка називає ключі поіменно — і саме тому нічого не
   * ловить: новий ключ у неї теж треба дописати руками, а забувають
   * рівно це. За історію файла так дожили три витоки: ib.regdraft
   * (WEB-003), ib.cloud/ib.remember (LOC-011) і ib.auth.await із поштою,
   * знайдений аудитом 17.09.2026 — вона переживала і вихід, і кнопку
   * «стерти дані», при тому що обидві обіцяють прибрати все.
   *
   * Тому тут перевіряється ПОВЕДІНКА: після кнопки в сховищі не
   * лишається НІ ОДНОГО ключа сайту. Новий ключ ламає цей тест сам, без
   * жодних правок у ньому.
   */
  test('після кнопки не лишається жодного ключа сайту', async () => {
    const ls = makeStorage({
      'ib.eloState': '{}', 'ib.profile.backup.login': '{}', 'ib.profile.owner': UID_A,
      'ib.auth.await': JSON.stringify({ email: 'a@test', at: Date.now() }),
      'ib.regdraft': '{}', 'ib.cloud': '1', 'ib.remember': '1',
      'ib.profile.backup.stale': '{}',
      'forge.today': '{}', 'forge.theme': 'dark'
    });
    const s = loadStore({ fetch: net(null), storage: ls });
    await s.Store.saveProfile({ weight: 80 }).catch(() => {});
    s.Store.clearLocal();
    const left = Object.keys(ls.dump ? ls.dump() : {})
      .filter((k) => /^(ib\.|forge\.)/.test(k));
    assert.equal(left.join(','), '', 'лишилось: ' + left.join(','));
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

/*
 * Вибір людини при першому вході (TST-010).
 *
 * signIn повертає merge='conflict', коли непорожні і локальні, і хмарні
 * дані. Далі рішення за людиною — і саме ці два шляхи не виконував жоден
 * тест. Виживали мутанти: «взяти мої дані» заливає копію ПЕРЕД імпортом
 * замість поточної; «лишити хмарні» не скидає кеш і повертає локальні.
 * Обидва тихі: людина натискає кнопку, бачить підтвердження і втрачає
 * рівно ті дані, які просила зберегти.
 */
describe('Конфлікт першого входу: що обрала людина, те й сталось', () => {
  function conflicted() {
    const ls = makeStorage({
      'ib.profile': JSON.stringify({ weight: 88, version: 9, bodyLog: { '2026-05-05': 88 } }),
      'ib.profile.backup': JSON.stringify({ weight: 1, version: 9 })
    });
    const f = net({ weight: 70, version: 9, bodyLog: { '2026-01-01': 70 } });
    return { ls: ls, f: f, s: loadStore({ fetch: f, storage: ls }) };
  }

  test('«взяти дані з цього браузера» — у хмару їде саме локальний профіль', async () => {
    const c = conflicted();
    const res = await c.s.Store.signIn('a@test', 'password');
    assert.equal(res.merge, 'conflict');

    await c.s.Store.adoptLocalProfile();
    const prof = await c.s.Store.getProfile();
    assert.equal(prof.weight, 88, 'локальні дані стали профілем');
    assert.equal(prof.bodyLog['2026-05-05'], 88, 'журнал ваги переїхав, а не зник');
  });

  test('копія перед імпортом при цьому не використовується', async () => {
    /* ib.profile.backup — це знімок ПЕРЕД імпортом, а не «мої дані».
       Переплутати їх означає залити в акаунт стан місячної давнини. */
    const c = conflicted();
    await c.s.Store.signIn('a@test', 'password');
    await c.s.Store.adoptLocalProfile();
    const prof = await c.s.Store.getProfile();
    assert.notEqual(prof.weight, 1, 'взято не доімпортну копію');
  });

  test('службові поля слота не переїжджають у профіль', async () => {
    const ls = makeStorage({
      /* owner тут — ВЛАСНИЙ (інакше спрацює барʼєр SYN-003 і переносити
         буде нічого). Перевіряємо саме те, що службові поля слота не
         стають полями профілю. */
      'ib.profile': JSON.stringify({ weight: 88, version: 9, owner: UID_A, savedAt: 'колись' })
    });
    const s = loadStore({ fetch: net({ weight: 70, version: 9 }), storage: ls });
    await s.Store.signIn('a@test', 'password');
    await s.Store.adoptLocalProfile();
    const prof = await s.Store.getProfile();
    assert.equal(prof.owner, undefined);
    assert.equal(prof.savedAt, undefined);
  });

  test('«лишити дані акаунта» — повертається хмарний профіль, а не локальний', async () => {
    const c = conflicted();
    await c.s.Store.signIn('a@test', 'password');
    /* Саме тут ламалось: cache = null не чіпав ні чергу, ні dirty, ні
       ib.profile, тож наступний getProfile віддавав локальні дані. */
    c.s.ls.setItem('ib.pending', JSON.stringify([{ at: Date.now(), uid: UID_A, patch: { weight: 88 } }]));
    c.s.ls.setItem('ib.profile.dirty', String(Date.now()));

    c.s.Store.discardLocalProfile();
    assert.equal(c.s.ls.getItem('ib.pending'), null, 'черга прибрана');
    assert.equal(c.s.ls.getItem('ib.profile.dirty'), null, 'позначка знята');

    const prof = await c.s.Store.getProfile();
    assert.equal(prof.weight, 70, 'узято хмарний профіль');
  });

  test('після «лишити дані акаунта» локальні патчі не їдуть у хмару', async () => {
    const c = conflicted();
    await c.s.Store.signIn('a@test', 'password');
    c.s.ls.setItem('ib.pending', JSON.stringify([{ at: Date.now(), uid: UID_A, patch: { weight: 88 } }]));
    const before = c.f.state.pushed.length;

    c.s.Store.discardLocalProfile();
    await c.s.Store.flushPending();
    assert.equal(c.f.state.pushed.length, before,
      'нічого не відправлено: черги вже немає');
  });
});

/*
 * Пошкоджений локальний профіль (LOC-001).
 *
 * Нечитабельний ib.profile виглядав як «профілю немає»: перше ж
 * автозбереження перезаписувало сирі байти порожнім бланком — без копії й
 * без жодного слова людині.
 */
describe('Нечитабельний ib.profile', () => {
  test('сирий вміст відкладається, а не зникає', async () => {
    const ls = makeStorage({ 'ib.profile': '{обірваний json' });
    const s = loadStore({ fetch: net(null), storage: ls });
    await s.Store.getProfile();

    const keys = Object.keys(ls.dump ? ls.dump() : {}).length
      ? Object.keys(ls.dump()) : null;
    const corrupt = (keys || []).filter((k) => k.indexOf('ib.profile.corrupt.') === 0);
    assert.equal(corrupt.length, 1, 'рівно одна відкладена копія');
    assert.equal(ls.getItem(corrupt[0]), '{обірваний json');
    assert.equal(s.Store.corruptProfile().found, true, 'інтерфейс дізнається про це');
  });

  test('масив замість обʼєкта — теж пошкодження', async () => {
    const ls = makeStorage({ 'ib.profile': '[1,2,3]' });
    const s = loadStore({ fetch: net(null), storage: ls });
    await s.Store.getProfile();
    assert.equal(s.Store.corruptProfile().found, true);
  });

  test('справний профіль нічого не відкладає', async () => {
    const ls = makeStorage({ 'ib.profile': JSON.stringify({ weight: 80, version: 9 }) });
    const s = loadStore({ fetch: net(null), storage: ls });
    await s.Store.getProfile();
    assert.equal(s.Store.corruptProfile().found, false);
  });
});

/*
 * Тихі шляхи, на яких зміна не доїжджала й ніхто цього не бачив.
 *
 * SYN-002 — beacon слав запит явно простроченим токеном;
 * SYN-011 — дві вкладки затирали журнали одна одної цілком;
 * SYN-015 — запис при не-approved статусі звітував про успіх без сліду;
 * SYN-019 — позначка синхронізації бачила лише чергу, не позначку dirty.
 */
describe('Незіслане має лишати слід', () => {
  test('beacon із простроченим токеном не шле запит, а кладе патч у чергу', () => {
    /* SYN-002: це єдиний запис, який не проходить ensureFresh — сторінка
       вже закривається. Слати завідомо мертвим токеном немає сенсу:
       відповідь 401 обробляти буде нікому. */
    const ls = makeStorage({
      'ib.account': JSON.stringify({ status: 'approved' }),
      'ib.session': JSON.stringify({ access_token: 't', refresh_token: 'r',
        expires_at: Date.now() - 1000, user: { id: UID_A, email: 'a@test' } }),
      'ib.profile.owner': UID_A
    });
    const f = net({ weight: 70, version: 9 });
    const s = loadStore({ fetch: f, storage: ls });
    s.Store.saveProfileBeacon({ weight: 71 });
    assert.equal(f.state.pushed.length, 0, 'жодного запиту простроченим токеном');
    assert.equal(JSON.parse(ls.getItem('ib.pending') || '[]').length, 1, 'патч у черзі');
  });

  test('запис до підтвердження заявки лишає позначку', async () => {
    /* SYN-015: до approved RLS однаково відмовить, тож у хмару не ходимо.
       Але без позначки перший же getProfile після підтвердження взяв би
       хмарний бланк і затер усе, що людина встигла зробити. */
    const ls = makeStorage({
      'ib.account': JSON.stringify({ status: 'pending' }),
      'ib.session': JSON.stringify({ access_token: 't', refresh_token: 'r',
        expires_at: Date.now() + 86400000, user: { id: UID_A, email: 'a@test' } }),
      'ib.profile.owner': UID_A
    });
    const f = net(null);
    const s = loadStore({ fetch: f, storage: ls });
    await s.Store.saveProfile({ weight: 77 });
    assert.equal(f.state.pushed.length, 0, 'у хмару не ходили');
    assert.ok(ls.getItem('ib.profile.dirty'), 'але слід лишили');
  });

  test('позначка синхронізації бачить і чергу, і dirty', () => {
    /* SYN-019 */
    const ls = makeStorage({ 'ib.profile.dirty': String(Date.now()) });
    const s = loadStore({ fetch: net(null), storage: ls });
    assert.equal(s.Store.pendingCount(), 0);
    assert.equal(s.Store.unsyncedCount(), 1, 'dirty без черги — теж «не синхронізовано»');
    ls.setItem('ib.pending', JSON.stringify([
      { at: 1, uid: UID_A, patch: { a: 1 } }, { at: 2, uid: UID_A, patch: { b: 2 } }]));
    assert.equal(s.Store.unsyncedCount(), 2, 'черга важливіша за прапорець');
  });
});

describe('Дві вкладки й журнали (SYN-011)', () => {
  test('патч-функція будується на актуальному профілі, а не на прочитаному колись', async () => {
    /*
     * Відтворення: вкладка А зберігає свій запис, вкладка Б будує патч зі
     * СТАРОЇ бази. З обʼєктом-патчем запис А зникав; з функцією — ні.
     */
    const ls = makeStorage({
      'ib.account': JSON.stringify({ status: 'approved' }),
      'ib.session': JSON.stringify({ access_token: 't', refresh_token: 'r',
        expires_at: Date.now() + 86400000, user: { id: UID_A, email: 'a@test' } }),
      'ib.profile.owner': UID_A
    });
    const f = net({ version: 9, bodyLog: {} });
    const s = loadStore({ fetch: f, storage: ls });

    /* Вкладка А: записала вагу за 1 серпня. */
    await s.Store.saveProfile({ bodyLog: { '2026-08-01': 80 } });

    /* Вкладка Б: у неї в памʼяті журнал ще порожній. */
    const staleLog = {};
    await s.Store.saveProfile(function (p) {
      const out = Object.assign({}, p.bodyLog, staleLog);
      out['2026-08-02'] = 81;
      return { bodyLog: out };
    });

    const prof = await s.Store.getProfile();
    assert.equal(prof.bodyLog['2026-08-01'], 80, 'запис першої вкладки лишився');
    assert.equal(prof.bodyLog['2026-08-02'], 81, 'запис другої вкладки додався');
  });

  test('обʼєкт-патч і далі замінює поле цілком', async () => {
    /* Свідомо: видалення запису журналу робиться саме так, і ламати цю
       семантику заради SYN-011 не можна. */
    const ls = makeStorage({
      'ib.account': JSON.stringify({ status: 'approved' }),
      'ib.session': JSON.stringify({ access_token: 't', refresh_token: 'r',
        expires_at: Date.now() + 86400000, user: { id: UID_A, email: 'a@test' } }),
      'ib.profile.owner': UID_A
    });
    const s = loadStore({ fetch: net({ version: 9, bodyLog: {} }), storage: ls });
    await s.Store.saveProfile({ bodyLog: { '2026-08-01': 80 } });
    await s.Store.saveProfile({ bodyLog: {} });
    const prof = await s.Store.getProfile();
    assert.deepEqual(Object.keys(prof.bodyLog), []);
  });
});

/*
 * PRF-006. Профіль росте, keepalive — ні.
 *
 * Тілом upsert-а є ВЕСЬ профіль, а ліміт keepalive — 64 КБ байтів. Після
 * 40–60 записаних сесій (місяць-два) гілка keepalive ставала недосяжною
 * НАЗАВЖДИ: кожен запис при закритті вкладки лягав у чергу й доїжджав
 * лише при наступному відкритті сайту. Це не втрата даних, але
 * «зберігається одразу» переставало бути правдою рівно для тих, хто
 * користується довше за всіх.
 */
describe('Великий профіль і збереження при закритті вкладки (PRF-006)', () => {
  const bigProfile = () => {
    const sessionLog = {};
    for (let i = 0; i < 600; i++) {
      sessionLog['2026-01-' + i] = { title: 'Тренування довгою назвою для обʼєму', done: 5, total: 8,
        sets: 20, reps: 120, vol: 8400, t0: 1, t1: 2, end: 1, ex: [] };
    }
    return { version: 9, weight: 80, sessionLog: sessionLog };
  };
  const liveSession = () => ({
    'ib.account': JSON.stringify({ status: 'approved' }),
    'ib.session': JSON.stringify({ access_token: 't', refresh_token: 'r',
      expires_at: Date.now() + 86400000, user: { id: UID_A, email: 'a@test' } }),
    'ib.profile.owner': UID_A
  });

  test('дрібна правка доїжджає патчем, а не всім профілем', () => {
    const prof = bigProfile();
    assert.ok(JSON.stringify(prof).length > 60000, 'профіль для тесту має бути завеликим');
    const ls = makeStorage(Object.assign(liveSession(), { 'ib.profile': JSON.stringify(prof) }));
    const f = net(prof);
    const s = loadStore({ fetch: f, storage: ls });

    s.Store.saveProfileBeacon({ weight: 81 });

    assert.equal(f.state.pushed.length, 0, 'весь профіль не шлемо — він не влізе');
    assert.equal(f.state.patched.length, 1, 'патч мав піти окремим запитом');
    assert.equal(f.state.patched[0].weight, 81);
    assert.ok(f.state.patched[0].updatedAt, 'без updatedAt патч не переможе старіший рядок');
    assert.equal(Object.keys(f.state.patched[0]).length, 2, 'у тілі лише те, що змінилось');
    assert.equal(JSON.parse(ls.getItem('ib.pending') || '[]').length, 0, 'у чергу нічого не лягло');
  });

  test('патч, який сам завеликий, чесно лягає в чергу', () => {
    /* Журнал сесій — це те саме поле, що розпирає профіль. Фізику ліміту
       не обійти: такий патч і далі їде чергою при наступному відкритті. */
    const prof = bigProfile();
    const ls = makeStorage(Object.assign(liveSession(), { 'ib.profile': JSON.stringify(prof) }));
    const f = net(prof);
    const s = loadStore({ fetch: f, storage: ls });

    s.Store.saveProfileBeacon({ sessionLog: prof.sessionLog });

    assert.equal(f.state.patched.length, 0, 'завеликий патч у мережу не йде');
    assert.equal(f.state.pushed.length, 0);
    assert.equal(JSON.parse(ls.getItem('ib.pending') || '[]').length, 1, 'патч у черзі');
  });

  test('малий профіль і далі йде звичайним upsert-ом', () => {
    /* Робочий шлях не мав змінитись: перевіряємо, що нова гілка вмикається
       саме за розміром, а не завжди. */
    const ls = makeStorage(Object.assign(liveSession(),
      { 'ib.profile': JSON.stringify({ version: 9, weight: 80 }) }));
    const f = net({ version: 9, weight: 80 });
    const s = loadStore({ fetch: f, storage: ls });

    s.Store.saveProfileBeacon({ weight: 81 });

    assert.equal(f.state.patched.length, 0, 'RPC для малого профілю не потрібен');
    assert.equal(f.state.pushed.length, 1, 'звичайний upsert');
    assert.equal(f.state.pushed[0].weight, 81);
  });
});

/*
 * Імпорт часткового файла НЕ мусить бути заміною профілю.
 *
 * Store.migrateImported прогоняє файл через міграції, а для цього накладає
 * його на blankProfile() — інакше кроки міграції не мають на чому
 * працювати. Але в результат потрапляли ВСІ поля бланка, тобто порожні
 * журнали для полів, яких у файлі не було. Далі імпорт записував ці
 * порожні значення поверх наявних: часткова копія стирала історію ваг,
 * тіла й харчування, а в хмарному режимі — одразу на всіх пристроях.
 *
 * Окремо — null: крок 1→2 перетворював "weightLog": null на порожній {},
 * і перевірка імпорту («null означає не задано лише для скалярів») до
 * цього вже не доходила.
 */
describe('Імпорт часткового файла нічого не затирає', () => {
  const load = (init) => loadStore({ storage: makeStorage(init), local: true });

  test('поля, яких у файлі немає, у результат не потрапляють', () => {
    const s = load({});
    const out = s.Store.migrateImported({ weight: 70, version: 11 });
    const keys = Object.keys(out).sort().join(',');
    assert.equal(keys, 'version,weight',
      'у мігрованому файлі мали лишитись лише його власні поля, а не бланк: ' + keys);
  });

  test('null лишається null і не стає порожнім журналом', () => {
    const s = load({});
    const out = s.Store.migrateImported({ weightLog: null, bodyLog: null, weight: 70 });
    assert.equal(out.weightLog, null, 'weightLog мав лишитись null');
    assert.equal(out.bodyLog, null, 'bodyLog мав лишитись null');
  });

  test('те, що міграція справді заповнила, зберігається', () => {
    /* Крок 1→2 засіває weightLog із weights: цього поля у файлі немає, але
       воно вже не порожнє — тож має доїхати. */
    const s = load({});
    const out = s.Store.migrateImported({ version: 1, weights: { 'Присідання зі штангою': 100 } });
    assert.ok(out.weightLog, 'weightLog, засіяний міграцією, мав лишитись');
    assert.ok(out.weightLog['Присідання зі штангою'], 'у засіяному журналі має бути вправа');
  });

  test('повний профіль проходить незмінно за складом полів', () => {
    const s = load({});
    const full = { version: 9, weight: 80, height: 180, weights: { X: 50 },
                   bodyLog: { '2026-08-01': 80 }, sessionLog: {}, mealLog: {} };
    const out = s.Store.migrateImported(full);
    for (const k of Object.keys(full)) {
      if (k === 'version') continue;
      assert.ok(k in out, 'поле ' + k + ' зникло з імпорту');
    }
  });
});
