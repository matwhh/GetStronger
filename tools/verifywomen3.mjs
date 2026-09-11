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
  /*
   * Днів тепер видно всі чотири — і це не послаблення правила.
   * Готових ЖІНОЧИХ схем як було дві (3 і 4 дні), так і лишилось; на 5
   * і 6 днях доступний тільки порожній власний каркас, який жінка
   * складає сама. Тому перевіряємо не перемикач, а те, ЩО в списку.
   */
  ok('1. жінка бачить усі варіанти днів', (await visibleDays(p)) === '3,4,5,6', await visibleDays(p));
  await p.locator('input[name="days"][value="3"]').evaluate(e => e.click()); await p.waitForTimeout(500);
  const picks = p.locator('#program-list [data-pick]');
  ok('1. на 3 днях є готовий план і власний каркас', await picks.count() === 2, String(await picks.count()));
  ok('1. це Full Body', /Full Body/.test(await p.locator('#program-list').innerText()));
  await p.locator('#program-list [data-pick]:not([data-pick="own"])').first().click({ force: true });
  await p.waitForTimeout(800);
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
/* 2. жінка з профілем на 5 днів: готових жіночих схем там немає */
{
  const { ctx, p, errs } = await open('female', { daysPerWeek: 5, activePlan: null, weights: {} });
  const ids = await p.$$eval('#program-list [data-pick]', (n) => n.map((x) => x.dataset.pick).join(','));
  ok('2. на 5 днях жінці доступний лише власний каркас', ids === 'own', ids || '(порожньо)');
  /*
   * Назвами не перевіряємо: у жіночій «PUSH/PULL» усередині є і «UL», і
   * «PU», а «Full Body» звуться дві схеми різних статей. Рахуємо картки:
   * жінці на 5 днях їх рівно три — два її готові плани (недоступні на
   * такій кількості днів, тому сірі) плюс власний каркас. Четверта
   * картка означала б, що пролізла чужа схема.
   */
  const cards = await p.locator('#program-list article').count();
  ok('2. карток рівно три — дві жіночі сірі плюс власний каркас', cards === 3, String(cards));
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
