/**
 * Вхід за посиланням із листа і збереження без звʼязку.
 *
 * Закриває HIGH з аудиту 2026-09:
 *   WEB-001 — чуже посилання #access_token=… садило людину в чужий акаунт;
 *   SYN-001 — beacon вважав 500 успіхом і губив зміну без сліду;
 *   SYN-008 — «лишити дані АКАУНТА» лишало саме локальні й затирало хмарні;
 *   SYN-006 — ib.profile.backup переживав вихід і діставався наступному;
 *   SYN-014 — після відкликання токена збереження звітувало про успіх.
 *
 * Уся мережа замокана: жодного звернення до бойового Supabase.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const A = '00000000-0000-4000-8000-00000000000A';
const B = '00000000-0000-4000-8000-00000000000B';
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

/* ------------------------------------------------------------------ */
/* 1. WEB-001: посилання з чужим токеном                               */
/* ------------------------------------------------------------------ */
async function linkCase({ seedAwait, seedSession, answer }) {
  const ctx = await adultContext(b, { viewport: { width: 420, height: 900 } });
  /* УВАГА: Playwright перевіряє маршрути у зворотному порядку реєстрації —
     останній зареєстрований виграє. Тому загальні йдуть першими. */
  await ctx.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: A, email: 'attacker@example.com' }) }));
  await ctx.route('**/auth/v1/user**', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: A, email: 'attacker@example.com' }) }));

  const p = await ctx.newPage();
  p.on('dialog', (d) => (answer ? d.accept() : d.dismiss()));
  await p.goto('file://' + ROOT + '/welcome.html');
  await p.evaluate(([sess, aw, uid]) => {
    localStorage.setItem('ib.cloud', '1');
    localStorage.removeItem('ib.session');
    sessionStorage.removeItem('ib.session');
    if (aw) localStorage.setItem('ib.auth.await', JSON.stringify({ email: aw, at: Date.now() }));
    if (sess) localStorage.setItem('ib.session', JSON.stringify({
      access_token: 'own', refresh_token: 'r', expires_at: Date.now() + 3600e3,
      user: { id: uid, email: 'victim@example.com' } }));
  }, [seedSession, seedAwait, B]);
  /* Store читає сесію ОДИН раз при завантаженні — перезавантажуємо, щоб
     посів справді був станом сторінки, а не написом у сховищі. */
  await p.reload();

  const out = await p.evaluate(async () => {
    location.hash = '#access_token=STOLEN&refresh_token=r2&expires_in=3600&type=signup';
    let err = '';
    try { await window.Store.adoptUrlSession({ confirm: () => window.confirm('увійти?') }); }
    catch (e) { err = (e && e.code) || e.message; }
    const s = localStorage.getItem('ib.session') || sessionStorage.getItem('ib.session') || '';
    return { err: err, session: s };
  });
  await ctx.close();
  return out;
}

let c = await linkCase({ seedAwait: null, seedSession: false, answer: false });
ok('чуже посилання без підтвердження не створює сесію',
   c.err === 'link_unverified' && c.session.indexOf('STOLEN') === -1, c.err + ' / ' + c.session.slice(0, 40));

c = await linkCase({ seedAwait: null, seedSession: false, answer: true });
ok('після явного підтвердження сесія приймається',
   !c.err && c.session.indexOf('STOLEN') !== -1, c.err + ' / ' + c.session.slice(0, 40));

c = await linkCase({ seedAwait: 'attacker@example.com', seedSession: false, answer: false });
ok('власний лист на очікувану пошту входить без питань',
   !c.err && c.session.indexOf('STOLEN') !== -1, c.err);

c = await linkCase({ seedAwait: 'attacker@example.com', seedSession: true, answer: false });
ok('вхід поверх іншого акаунта питає навіть із позначкою',
   c.err === 'link_unverified' && c.session.indexOf('STOLEN') === -1, c.err);

/* Сторож не тягне чужий токен на welcome, коли сесія вже є. */
{
  const src = (await import('node:fs')).readFileSync(ROOT + '/js/agegate.js', 'utf8');
  ok('agegate переносить токен лише без сесії',
     /hasSession\(\)/.test(src) && src.indexOf("carry.indexOf('access_token=')") > 0);
}

/* ------------------------------------------------------------------ */
/* 2. SYN-001 / SYN-008 / SYN-006 / SYN-014 у справжньому Store        */
/* ------------------------------------------------------------------ */
const ctx = await adultContext(b, { viewport: { width: 420, height: 900 } });
const posts = [];
let profileStatus = 200;
let tokenStatus = 200;
let tokenTtl = 3600;
/* Спершу загальні маршрути, потім конкретні: Playwright бере останній зареєстрований. */
await ctx.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: B, email: 'b@example.com' }) }));
let tokenCalls = 0;
await ctx.route('**/auth/v1/token**', (r) => (tokenStatus === 200 || ++tokenCalls === 1
  ? r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ access_token: 'fresh', refresh_token: 'r2', expires_in: tokenTtl,
        user: { id: B, email: 'b@example.com' } }) })
  : r.fulfill({ status: 400, contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Already Used' }) })));
await ctx.route('**/rest/v1/profiles**', async (route) => {
  const r = route.request();
  if (r.method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ data: { weight: 70, displayName: 'B', sex: 'male', height: 175 } }]) });
  }
  posts.push(JSON.parse(r.postData() || '{}'));
  return route.fulfill({ status: profileStatus, contentType: 'application/json', body: '[]' });
});

const p = await ctx.newPage();
await p.goto('file://' + ROOT + '/index.html');
const seed = async (expired) => { await p.evaluate(([b, exp]) => {
  localStorage.clear();
  localStorage.setItem('ib.cloud', '1');
  localStorage.setItem('ib.profile.owner', b);
  localStorage.setItem('ib.account', JSON.stringify({ status: 'approved', t: Date.now() }));
  localStorage.setItem('ib.session', JSON.stringify({
    access_token: 't', refresh_token: 'r',
    expires_at: exp ? Date.now() - 1000 : Date.now() + 3600e3,
    user: { id: b, email: 'b@example.com' } }));
  }, [B, Boolean(expired)]);
  await p.reload();
};

/* SYN-008 */
await seed();
const discard = await p.evaluate(() => {
  localStorage.setItem('ib.profile', JSON.stringify({ version: 6, weight: 95 }));
  localStorage.setItem('ib.pending', JSON.stringify([{ at: 1, uid: '00000000-0000-4000-8000-00000000000B', patch: { weight: 95 } }]));
  localStorage.setItem('ib.profile.dirty', '1');
  window.Store.discardLocalProfile();
  return {
    pending: localStorage.getItem('ib.pending'),
    dirty: localStorage.getItem('ib.profile.dirty'),
    profile: localStorage.getItem('ib.profile')
  };
});
ok('«лишити дані акаунта» прибирає чергу, dirty і локальний профіль',
   !discard.pending && !discard.dirty && !discard.profile, JSON.stringify(discard));

/* SYN-006 */
await seed();
const afterOut = await p.evaluate(async () => {
  localStorage.setItem('ib.profile', JSON.stringify({ version: 6, weight: 95 }));
  localStorage.setItem('ib.profile.backup', JSON.stringify({ version: 6, weight: 95 }));
  localStorage.setItem('forge.today', '{"x":1}');
  localStorage.setItem('ib.meals.fold', '{"y":1}');
  try { await window.Store.signOut(); } catch (_) {}
  return Object.keys(localStorage).sort();
});
ok('після виходу не лишається ні backup, ні forge.today, ні meals.fold',
   !afterOut.includes('ib.profile.backup') && !afterOut.includes('forge.today') &&
   !afterOut.includes('ib.meals.fold'), afterOut.join(','));

/* SYN-001 */
await seed();
profileStatus = 500;
const beacon = await p.evaluate(async () => {
  window.Store.saveProfileBeacon({ weight: 81 });
  await new Promise((r) => setTimeout(r, 300));
  return {
    dirty: localStorage.getItem('ib.profile.dirty'),
    pending: JSON.parse(localStorage.getItem('ib.pending') || '[]').length
  };
});
ok('beacon при 500 лишає слід (dirty або чергу)',
   beacon.dirty === '1' || beacon.pending > 0, JSON.stringify(beacon));
profileStatus = 200;

/* SYN-014 */
/*
 * Відтворюємо саме те, що ламалось: на вході в doSave сесія ще є (тому
 * гілка «пишемо в хмару» вибрана), а ensureFresh усередині її забирає —
 * Supabase відповідає 400 invalid_grant на повторно використаний
 * ротований refresh-токен, і doRefresh кличе clearSession().
 *
 * Тому при завантаженні даємо короткий токен (30 с — усередині 60-секундного
 * запасу ensureFresh), а перед самим збереженням перемикаємо сервер на 400.
 */
/* Перший виклик /token віддаємо успішним (короткий токен), решту — 400.
   Лічильник, а не прапорець: оновлення при завантаженні асинхронне, і
   перемикання «після seed» перегони виграє не завжди. */
tokenStatus = 400; tokenTtl = 30; tokenCalls = 0;
await seed(true);
await p.waitForTimeout(300);
const revoked = await p.evaluate(async () => {
  const out = { queued: null, err: '' };
  try { await window.Store.saveProfile({ weight: 82 }); out.queued = false; }
  catch (e) { out.queued = Boolean(e && e.queued); out.err = e.message; }
  return out;
});
ok('відкликана сесія не звітує про успіх', revoked.queued === true, JSON.stringify(revoked));
tokenStatus = 200;

await ctx.close();
await b.close();

const bad = R.filter(([, c]) => !c).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок входу за посиланням пройшло.');
process.exit(bad ? 1 : 0);
