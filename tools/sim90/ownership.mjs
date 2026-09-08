/* TEMPORARY AUDIT HARNESS — shared-device ownership scenario (client side only).
   Server RLS is NOT exercised here (mock cloud). */
import { chromium } from 'playwright';
const ROOT = process.cwd();
const R = []; const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
const cloud = {}; let who = 'A';
const ID = { A: '00000000-0000-4000-8000-00000000000a', B: '00000000-0000-4000-8000-00000000000b' };
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await ctx.route(/\/rest\/v1\/profiles/, async (route) => {
  const req = route.request(); const m = req.url().match(/user_id=eq\.([0-9a-f-]+)/);
  if (req.method() === 'GET') { const id = m ? m[1] : null; return route.fulfill({ status: 200, contentType: 'application/json', body: cloud[id] ? JSON.stringify([{ data: cloud[id] }]) : '[]' }); }
  try { const row = JSON.parse(req.postData())[0]; cloud[row.user_id] = row.data; } catch (_) {}
  return route.fulfill({ status: 204, body: '' });
});
await ctx.route(/\/rest\/v1\/rpc\/([a-z_]+)/, r => { const n = r.request().url().match(/rpc\/([a-z_]+)/)[1]; return r.fulfill({ status: 200, contentType: 'application/json', body: n === 'account_state' ? JSON.stringify({ status: 'approved', username: who, isAdmin: false }) : '{}' }); });
await ctx.route(/\/auth\/v1\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'tok-' + who, refresh_token: 'ref-' + who, expires_in: 3600, user: { id: ID[who], email: who + '@sim.local' } }) }));
const p = await ctx.newPage(); p.on('dialog', d => d.accept());
const errs = []; p.on('pageerror', e => errs.push(e.message));
const seed = async (w) => { await p.goto('file://' + ROOT + '/welcome.html'); await p.evaluate((a) => { localStorage.setItem('ib.cloud', '1'); localStorage.setItem('ib.session', JSON.stringify({ access_token: 'tok-' + a.w, refresh_token: 'r', expires_at: Date.now() + 86400000, user: { id: a.id, email: a.w + '@sim.local' } })); localStorage.setItem('ib.account', JSON.stringify({ status: 'approved', username: a.w, isAdmin: false, t: Date.now() })); localStorage.setItem('ib.profile', JSON.stringify({ version: 10, birthDate: '1990-01-01', sex: 'male', weight: 80, height: 180, activity: 1.55, trainingAge: 'inter', activePlan: { programId: 'fullbody', days: 3 }, weights: { 'Присідання зі штангою': 100 }, bodyLog: { '2026-09-01': { weight: 80 } } })); }, { w, id: ID[w] }); };
/* A works and syncs */
await seed('A'); await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' }); await p.waitForTimeout(1200);
await p.fill('#w-kg', '81,5'); await p.click('#w-add', { force: true }); await p.waitForTimeout(1200);
await p.evaluate(async () => { await window.Store.flushPending(); });
const aProfile = await p.evaluate(() => JSON.parse(localStorage.getItem('ib.profile')));
ok('A записав вагу', JSON.stringify(aProfile).includes('81.5'));
ok('A у хмарі', !!cloud[ID.A] && JSON.stringify(cloud[ID.A]).includes('81.5'));
/* A logs out; B logs in on the same browser */
await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' }); await p.waitForTimeout(1000);
await p.click('#a-signout', { force: true }); await p.waitForTimeout(800);
const afterOut = await p.evaluate(() => ({ profile: localStorage.getItem('ib.profile'), session: localStorage.getItem('ib.session') }));
ok('після виходу профіль A стерто з localStorage', !afterOut.profile, String(afterOut.profile).slice(0, 60));
ok('після виходу сесії немає', !afterOut.session);
who = 'B';
await p.fill('#a-email', 'b@sim.local'); await p.fill('#a-pass', 'Passw0rd!Passw0rd'); await p.click('#a-form button[type=submit]', { force: true }); await p.waitForTimeout(1500);
const bView = await p.evaluate(async () => { const pr = await window.Store.getProfile(); return { user: window.Store.user(), bodyLog: pr.bodyLog, weights: pr.weights, owner: localStorage.getItem('ib.profile.owner') }; });
ok('B увійшов як B', bView.user && bView.user.id === ID.B, JSON.stringify(bView.user));
ok('B НЕ бачить вагу A', !JSON.stringify(bView.bodyLog || {}).includes('81.5'), JSON.stringify(bView.bodyLog));
ok('B НЕ бачить робочі ваги A', !JSON.stringify(bView.weights || {}).includes('100'), JSON.stringify(bView.weights));
ok('власник localStorage = B', bView.owner === JSON.stringify(ID.B), String(bView.owner));
/* B saves something; A returns */
await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(1200);
const bUrl = p.url().split('/').pop(); ok('B (без онбордингу) відправлений на онбординг, а не в чужі дані', bUrl === 'welcome.html', bUrl);
who = 'A';
await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' }); await p.waitForTimeout(900);
/* B is mid-onboarding, so the gate keeps him on welcome — the exit there is «Вийти» (#au-out).
   Count the control BEFORE using it: after sign-out the start screen has none by design. */
const canOut = await p.locator('#au-out, #a-signout').count();
if (await p.locator('#au-out').count()) { await p.click('#au-out', { force: true }); await p.waitForTimeout(900); }
if (await p.locator('#a-signout').count()) { await p.click('#a-signout', { force: true }); await p.waitForTimeout(700); }
if (!(await p.locator('#a-email').count())) { await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' }); await p.waitForTimeout(900); }
ok('на екрані онбордингу B є кнопка «Вийти» (щоб A міг увійти на тому ж пристрої)', canOut > 0, 'url=' + p.url().split('/').pop() + ' h1=' + (await p.locator('h1').first().textContent()));
if (!canOut) { /* DIAGNOSTIC ONLY: no UI path exists — emulate B clearing site data */ await p.evaluate(() => { localStorage.removeItem('ib.session'); localStorage.removeItem('ib.account'); }); await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' }); await p.waitForTimeout(1200); }
console.log('login screen:', p.url().split('/').pop(), await p.locator('h1').first().textContent(), await p.locator('main input').evaluateAll(es => es.map(e => '#' + e.id).join(' ')));
if (await p.locator('[data-nav="login"]').count()) { await p.click('[data-nav="login"]', { force: true }); await p.waitForTimeout(600); }
if (await p.locator('#au-email').count()) { await p.fill('#au-email', 'a@sim.local'); await p.fill('#au-pass', 'Passw0rd!Passw0rd'); await p.click('#au-login', { force: true }); await p.waitForTimeout(1800); }
else if (await p.locator('#a-email').count()) { await p.fill('#a-email', 'a@sim.local'); await p.fill('#a-pass', 'Passw0rd!Passw0rd'); await p.click('#a-form button[type=submit]', { force: true }); await p.waitForTimeout(1500); }
const aBack = await p.evaluate(async () => { const pr = await window.Store.getProfile(); return { user: window.Store.user(), has: JSON.stringify(pr).includes('81.5'), url: location.pathname.split('/').pop() }; });
ok('A повернувся і бачить СВОЇ дані (з хмари)', aBack.user && aBack.user.id === ID.A && aBack.has, JSON.stringify(aBack));
ok('без JS-помилок', errs.length === 0, errs.join(' | '));
await b.close();
console.log((R.length - R.filter(r => !r[1]).length) + '/' + R.length);
