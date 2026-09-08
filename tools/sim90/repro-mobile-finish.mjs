/* PROBE: mobile viewport — pips + «Завершити тренування» */
import { chromium } from 'playwright';
import { adultContext } from '../adult.mjs';
const ROOT = process.cwd();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const round of [1, 2, 3]) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const dialogs = []; p.on('dialog', d => { dialogs.push(d.message().slice(0, 40)); d.accept(); });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' }); await p.waitForTimeout(1100);
  const rows = p.locator('#workout .tdy-ex'); const n = await rows.count();
  let fails = [];
  for (let i = 0; i < n; i++) {
    const pips = rows.nth(i).locator('[data-set-n]'); const pn = await pips.count();
    for (let k = 0; k < pn; k++) { const el = pips.nth(k); await el.evaluate(e => e.scrollIntoView({ block: 'center' })); try { await el.click({ timeout: 2000 }); } catch (e) { const bb = await el.boundingBox(); fails.push('ex' + i + 'set' + k + ':' + String(e.message).split('\n')[0].slice(0, 40) + ' box=' + JSON.stringify(bb) + ' url=' + p.url().split('/').pop()); } }
  }
  console.log('url', p.url().split('/').pop(), 'finish count', await p.locator('#wk-finish').count(), 'ended', await p.locator('#wk-ended').count(), 'text', (await p.locator('#workout').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,160));
  const box = await p.locator('#wk-finish').boundingBox({ timeout: 2000 }).catch(() => null);
  const tb = await p.locator('#tabbar').boundingBox().catch(() => null);
  let finErr = null;
  try { await p.locator('#wk-finish').evaluate(e => e.scrollIntoView({ block: 'center' })); await p.locator('#wk-finish').click({ timeout: 3000 }); } catch (e) { finErr = String(e.message).split('\n')[0].slice(0, 80); }
  await p.waitForTimeout(1200);
  console.log('round', round, 'rows', n, 'pipFails', fails.length, fails.slice(0, 2), 'finishBox', JSON.stringify(box), 'tabbar', JSON.stringify(tb), 'finErr', finErr, 'dialogs', dialogs, 'ended', await p.locator('#wk-ended').count(), 'errs', errs.length);
  await ctx.close();
}
await b.close();
