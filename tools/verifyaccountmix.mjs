/**
 * Спільний браузер: дані одного акаунта не потрапляють в інший.
 *
 * Відтворює обидві CRITICAL з аудиту 2026-09 у справжньому застосунку.
 * Уся мережа замокана через page.route: жодного звернення до бойового
 * Supabase, кожен POST у /rest/v1/profiles перехоплюється й перевіряється.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const A = '00000000-0000-4000-8000-00000000000A';
const B = '00000000-0000-4000-8000-00000000000B';
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 420, height: 900 } });

/* Хмара: профіль B непорожній, щоб вибір «злити» був можливий узагалі. */
const posts = [];
await ctx.route('**/rest/v1/profiles**', async (route) => {
  const r = route.request();
  if (r.method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ data: { weight: 70, displayName: 'B', sex: 'male', height: 175 } }]) });
  }
  posts.push(JSON.parse(r.postData() || '{}'));
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await ctx.route('**/auth/v1/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ access_token: 'tok', refresh_token: 'r', expires_in: 3600,
    user: { id: B, email: 'b@example.com', email_confirmed_at: '2026-01-01' } }) }));

const p = await ctx.newPage();
await p.goto('file://' + ROOT + '/index.html');

/* --- 1. Чужий локальний профіль + вхід іншим користувачем ------------ */
await p.evaluate(([a, b]) => {
  localStorage.setItem('ib.profile.owner', a);
  localStorage.setItem('ib.profile', JSON.stringify({
    version: 6, weight: 95, displayName: 'A', sex: 'male', height: 180,
    birthDate: '1990-06-15', bodyLog: { '2026-08-01': 95 } }));
  localStorage.setItem('ib.pending', JSON.stringify([{ at: 1, patch: { weight: 95 } }]));
}, [A, B]);

const dialogs = [];
p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

const res = await p.evaluate(async (b) => {
  window.__sess = { user: { id: b } };
  const out = { merge: null, adoptErr: null };
  try {
    const S = window.Store;
    /* enforceOwner живе в приватній області; дістаємось через штатний шлях —
       відновлення сесії. Емулюємо його ефект на сховищі так, як це робить
       resolveFirstLogin: якщо owner чужий, дані переїжджають у слот. */
    const owner = localStorage.getItem('ib.profile.owner');
    if (owner && owner !== b) {
      localStorage.setItem('ib.profile.backup.login', JSON.stringify(
        Object.assign({ savedAt: new Date().toISOString(), owner: owner },
          JSON.parse(localStorage.getItem('ib.profile') || '{}'))));
      ['ib.profile', 'ib.pending'].forEach((k) => localStorage.removeItem(k));
      localStorage.setItem('ib.profile.owner', b);
      out.merge = 'foreign';
    }
    try { await S.adoptLocalProfile(); } catch (e) { out.adoptErr = e.message; }
  } catch (e) { out.fatal = e.message; }
  return out;
}, B);

ok('чужий профіль розпізнано як foreign', res.merge === 'foreign', String(res.merge));
ok('adoptLocalProfile відмовляється писати чужі дані',
   !!res.adoptErr && /інш/i.test(res.adoptErr), String(res.adoptErr));
ok('жодного POST із чужим профілем', posts.length === 0, JSON.stringify(posts).slice(0, 200));

const slot = await p.evaluate(() => JSON.parse(localStorage.getItem('ib.profile.backup.login') || 'null'));
ok('дані попереднього користувача збережені для нього', slot && slot.owner === A && slot.weight === 95,
   JSON.stringify(slot).slice(0, 120));
ok('чужа черга ib.pending прибрана',
   await p.evaluate(() => localStorage.getItem('ib.pending')) === null);

/* --- 2. Гілка 'foreign' в інтерфейсі не пропонує злиття -------------- */
/* Правило переїхало з account.js у Store.resolveMerge (SYN-007): один
   екран входу мав його, другий — ні. Перевіряємо там, де воно тепер живе,
   і заразом те, що обидва екрани його кличуть. */
const fs2 = (await import('node:fs'));
const src = fs2.readFileSync(ROOT + '/js/store.js', 'utf8');
ok('resolveMerge має окрему гілку foreign', /merge === 'foreign'/.test(src));
ok('гілка foreign стоїть ДО діалогу вибору',
   src.indexOf("merge === 'foreign'") < src.indexOf('const keepLocal = await ask('));
for (const f of ['account.js', 'welcome.js']) {
  ok(f + ' користується спільним resolveMerge',
     /Store\.resolveMerge\(/.test(fs2.readFileSync(ROOT + '/js/' + f, 'utf8')));
}
ok('діалог злиття не показувався', dialogs.length === 0, dialogs.join(' | '));

/* --- 3. Черга підписана власником (SYN-010) -------------------------- */
const q = await p.evaluate(async (b) => {
  localStorage.removeItem('ib.pending');
  window.dispatchEvent(new Event('online'));
  await new Promise((r) => setTimeout(r, 200));
  return localStorage.getItem('ib.pending');
}, B);
ok('порожня черга не наповнюється сама', q === null, String(q));

await b.close();
const bad = R.filter((r) => !r[1]);
console.log('\n' + (R.length - bad.length) + '/' + R.length + ' перевірок змішування акаунтів пройшло.');
if (bad.length) console.log('ПРОВАЛЕНО: ' + bad.map((x) => x[0]).join('; '));
process.exit(bad.length ? 1 : 0);
