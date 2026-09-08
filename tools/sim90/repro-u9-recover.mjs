/* SCENARIO: user 9 wiped local data on day 60 ("Стерти локальні дані й вийти") — does logging back in restore 23 sessions from the cloud? */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const ROOT = process.cwd();
const cloud = JSON.parse(readFileSync(ROOT + '/tools/sim90/out/cloud/u9.json'));
const ctx = await chromium.launchPersistentContext('/tmp/u9copy', { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, viewport: { width: 1280, height: 860 } });
await ctx.clock.setSystemTime(new Date('2026-11-30T10:00:00'));
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await ctx.route(/\/rest\/v1\/profiles/, r => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ data: cloud.row.data }]) }) : r.fulfill({ status: 204, body: '' }));
await ctx.route(/\/rest\/v1\/rpc\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: /account_state/.test(r.request().url()) ? JSON.stringify({ status: 'approved', username: 'Юля', isAdmin: false }) : '{}' }));
await ctx.route(/\/auth\/v1\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 't9', refresh_token: 'r9', expires_in: 3600, user: { id: '00000000-0000-4000-8000-000000000009', email: 'u9@sim.local' } }) }));
const p = await ctx.newPage(); p.on('dialog', d => d.accept()); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1200);
console.log('landed', p.url().split('/').pop(), 'h1', await p.locator('h1').first().textContent());
if (await p.locator('[data-nav="login"]').count()) { await p.click('[data-nav="login"]', { force: true }); await p.waitForTimeout(500); }
await p.fill('#au-email', 'u9@sim.local'); await p.fill('#au-pass', 'Passw0rd!Passw0rd'); await p.click('#au-login', { force: true }); await p.waitForTimeout(2500);
console.log('after login', p.url().split('/').pop(), 'h1', await p.locator('h1').first().textContent());
const st = await p.evaluate(async () => { const pr = await window.Store.getProfile(); return { sessions: Object.keys(pr.sessionLog || {}).length, bodyLog: Object.keys(pr.bodyLog || {}).length, mealLog: Object.keys(pr.mealLog || {}).length, plan: pr.activePlan, version: pr.version }; });
console.log('restored', JSON.stringify(st), 'errs', errs.length);
await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
console.log('journal', p.url().split('/').pop(), (await p.locator('#jr-training, #adh-training').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120));
await ctx.close();
