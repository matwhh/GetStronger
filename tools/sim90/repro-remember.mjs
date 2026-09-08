/* BUG REPRO: «Запамʼятати мене» вимкнено → сторож (agegate) не бачить сесії → welcome на кожному переході */
import { chromium } from 'playwright';
import { adultContext } from '../adult.mjs';
const ROOT = process.cwd();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await adultContext(b, { viewport: { width: 1200, height: 900 } });
const p = await ctx.newPage(); p.on('dialog', d => d.accept());
await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(800);
console.log('before: index →', p.url().split('/').pop());
await p.evaluate(() => window.Store.remember(false));   // what the checkbox does on login
const where = await p.evaluate(() => ({ ls: !!localStorage.getItem('ib.session'), ss: !!sessionStorage.getItem('ib.session'), user: !!window.Store.user() }));
console.log('after remember(false):', JSON.stringify(where));
const seen = [];
for (const pg of ['workout.html', 'index.html', 'journal.html']) { await p.goto('file://' + ROOT + '/' + pg, { waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(1500); seen.push(pg + '→' + p.url().split('/').pop()); }
console.log(seen.join('  '));
console.log('welcome shows:', (await p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 120));
await b.close();
