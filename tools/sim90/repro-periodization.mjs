/* BUG REPRO: periodization.html — DOM error when moving focus between the two % fields */
import { chromium } from 'playwright';
import { adultContext } from '../adult.mjs';
const ROOT = process.cwd();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const round of [1, 2, 3]) {
  const ctx = await adultContext(b, { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + ROOT + '/periodization.html', { waitUntil: 'load' }); await p.waitForTimeout(1000);
  const st = p.locator('#pd-start'); await st.click(); await st.press('Control+a'); await p.keyboard.type('72');
  await p.locator('#pd-end').click();           // focus moves → change fires on pd-start → render() replaces the DOM mid-blur
  const en = p.locator('#pd-end'); await en.press('Control+a'); await p.keyboard.type('88'); await p.locator('#pd-weeks').click();
  await p.waitForTimeout(500);
  const v = await p.evaluate(() => ({ start: document.getElementById('pd-start')?.value, end: document.getElementById('pd-end')?.value, cfg: JSON.parse(localStorage.getItem('ib.profile') || '{}').periodization }));
  console.log('round', round, 'pageerrors=' + errs.length, errs[0] ? errs[0].slice(0, 110) : '', 'fields=', JSON.stringify(v).slice(0, 200));
  await ctx.close();
}
await b.close();
