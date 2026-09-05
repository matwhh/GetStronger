/** Жіночий Full Body на 3 дні + видимі лише підтримувані кількості днів */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';
const ROOT = process.cwd();
const R = []; const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: CHROME });

async function open(sex, extra) {
  const ctx = await adultContext(b, { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async (a) => { await window.Store.saveProfile(a); }, Object.assign({ sex }, extra || {}));
  await p.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  return { ctx, p, errs };
}
const visibleDays = (p) => p.locator('input[name="days"]').evaluateAll(es => es.filter(e => !(e.closest('label') || e).hidden).map(e => e.value).join(','));

/* 1. жінка: лише 3 і 4 дні; на 3 днях є Full Body */
{
  const { ctx, p, errs } = await open('female', { activePlan: null, weights: {} });
  ok('1. жінка бачить лише 3 і 4 дні', (await visibleDays(p)) === '3,4', await visibleDays(p));
  await p.locator('input[name="days"][value="3"]').evaluate(e => e.click()); await p.waitForTimeout(500);
  const picks = p.locator('#program-list [data-pick]');
  ok('1. на 3 днях є план для вибору', await picks.count() === 1, String(await picks.count()));
  ok('1. це Full Body', /Full Body/.test(await p.locator('#program-list').innerText()));
  await picks.first().click({ force: true }); await p.waitForTimeout(800);
  const txt = (await p.locator('#plan').innerText()).replace(/\s+/g, ' ');
  ok('1. три дні по 12 вправ · 28 підходи', (txt.match(/12 вправ/g) || []).length === 3 && (txt.match(/28 підход/g) || []).length === 3, txt.slice(0, 200));
  ok('1. чоловічих планів немає', !/PPL|Upper/.test(await p.locator('#program-list').innerText()));
  const choose = p.locator('button', { hasText: 'Обрати цей план' }).first();
  if (await choose.count()) { await choose.click({ force: true }); await p.waitForTimeout(1200); }
  const ap = await p.evaluate(async () => (await window.Store.getProfile()).activePlan);
  ok('1. план обрано: women3 × 3 дні', ap && ap.programId === 'women3' && ap.days === 3, JSON.stringify(ap));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
/* 2. жінка з профілем на 5 днів: перемикач сам стає на дозволений */
{
  const { ctx, p, errs } = await open('female', { daysPerWeek: 5, activePlan: null, weights: {} });
  ok('2. 5 днів приховано, обрано дозволене', (await visibleDays(p)) === '3,4' && ['3', '4'].includes(await p.locator('input[name="days"]:checked').inputValue()));
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
/* 3. чоловік бачить усе, як і раніше */
{
  const { ctx, p, errs } = await open('male');
  ok('3. чоловік бачить 3,4,5,6', (await visibleDays(p)) === '3,4,5,6', await visibleDays(p));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
/* 4. тренування: жінка на women3 бачить 9 вправ у залі */
{
  const { ctx, p, errs } = await open('female', { activePlan: { programId: 'women3', days: 3 }, weights: { 'Жим у тренажері': 80 } });
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' }); await p.waitForTimeout(1200);
  ok('4. на тренуванні 12 вправ', await p.locator('#workout .tdy-ex').count() === 12, String(await p.locator('#workout .tdy-ex').count()));
  ok('4. 28 кружечків підходів', await p.locator('#workout [data-set-n]').count() === 28, String(await p.locator('#workout [data-set-n]').count()));
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}
await b.close();
const bad = R.filter(r => !r[1]).length; console.log('\n' + (R.length - bad) + '/' + R.length); process.exit(bad ? 1 : 0);
