/* BUG PROBE: does a transient network failure bounce an onboarded user to welcome.html? */
import { chromium } from 'playwright';
import { adultContext } from '../adult.mjs';
const ROOT = process.cwd();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const mode of ['profiles-abort', 'rpc-abort', 'auth-abort', 'all-abort']) {
  const ctx = await adultContext(b, { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  // seed a session that EXPIRES SOON so ensureFresh must refresh (as after a real login a day earlier)
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('ib.session')); s.expires_at = Date.now() + 10000; localStorage.setItem('ib.session', JSON.stringify(s)); });
  if (mode === 'profiles-abort' || mode === 'all-abort') await ctx.route(/\/rest\/v1\/profiles/, r => r.abort('failed'));
  if (mode === 'rpc-abort' || mode === 'all-abort') await ctx.route(/\/rest\/v1\/rpc\//, r => r.abort('failed'));
  if (mode === 'auth-abort' || mode === 'all-abort') await ctx.route(/\/auth\/v1\//, r => r.abort('failed'));
  const seen = [];
  for (const pg of ['workout.html', 'journal.html', 'index.html', 'trackers.html']) { await p.goto('file://' + ROOT + '/' + pg, { waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(1300); seen.push(pg + '→' + p.url().split('/').pop()); }
  const st = await p.evaluate(() => ({ session: !!localStorage.getItem('ib.session'), account: localStorage.getItem('ib.account'), pending: window.Store && window.Store.pendingCount && window.Store.pendingCount() }));
  console.log(mode.padEnd(16), seen.join(' '), JSON.stringify(st));
  await ctx.close();
}
await b.close();
