/**
 * Розділення планів за статтю — у живому браузері.
 *
 * Юніт-тести (tests/programs-sex.test.js) стережуть саме правило. Тут
 * перевіряється те, чого вони не бачать: що правило справді дійшло до
 * КОЖНОЇ точки інтерфейсу — сітки вибору, «Мого плану», «Сьогодні»,
 * сторінки тренування — і що зміна статі в акаунті перемикає список без
 * перезавантаження застосунку.
 *
 * Найважливіший сценарій — останній: план чужої статі, збережений у
 * профілі, не має відкриватись прямим переходом на plan.html. Саме так
 * виглядає дірка, коли фільтр стоїть лише в розмітці списку.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

/** Контекст із профілем заданої статі (і, за потреби, з обраним планом). */
async function open(profile) {
  const ctx = await adultContext(b, { viewport: { width: 1100, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
  await p.evaluate(async (pr) => { await window.Store.saveProfile(pr); }, profile);
  return { ctx, p, errs };
}

const listedPlans = (p) => p.evaluate(() =>
  [...document.querySelectorAll('#program-list .card')]
    .map((c) => (c.querySelector('.card__title') || {}).textContent || '')
    .map((s) => s.trim()).filter(Boolean));

/* activePlan: null — adultContext садить пройдений профіль із чоловічим
   fullbody, а для «нового користувача» план має бути не обраний. */
const MALE = { sex: 'male', trainingAge: 'inter', weight: 82, height: 180,
               activity: 1.55, birthDate: '1990-06-15',
               activePlan: null, programId: null };
const FEMALE = Object.assign({}, MALE, { sex: 'female', weight: 60, height: 168 });

/* ---- 1. Новий користувач-чоловік ---- */
{
  const { ctx, p, errs } = await open(MALE);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const names = await listedPlans(p);
  ok('1. чоловік бачить чоловічі схеми', names.length >= 3, names.join(' | '));
  ok('1. жіночого плану в списку немає', !names.some((n) => /Жіночий/.test(n)), names.join(' | '));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Новий користувач-жінка ---- */
{
  const { ctx, p, errs } = await open(FEMALE);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const names = await listedPlans(p);
  ok('2. жінка бачить рівно один план', names.length === 1, names.join(' | '));
  ok('2. і це «Жіночий план»', names[0] === 'Жіночий план', String(names[0]));
  ok('2. жодної чоловічої схеми', !/Full Body|UL|PPL/.test(names.join(' ')), names.join(' | '));
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Жінка обирає план і він працює наскрізно ---- */
{
  const { ctx, p, errs } = await open(FEMALE);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  /* Перемикач днів має стояти на 4 — єдиному, що підтримує схема. */
  const daysBtn = p.locator('.seg__item:has(input[value="4"]) span').first();
  if (await daysBtn.count()) { await daysBtn.click(); await p.waitForTimeout(600); }
  const show = p.locator('#program-list [data-pick]').first();
  ok('3. у списку є кнопка «Показати план»', await show.count() > 0);
  if (await show.count()) { await show.click(); await p.waitForTimeout(900); }
  const adopt = p.locator('#adopt-plan');
  ok('3. кнопка «Обрати цей план» доступна', await adopt.count() > 0);
  if (await adopt.count()) { await adopt.click(); await p.waitForTimeout(1400); }

  const saved = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return pr.activePlan || null;
  });
  ok('3. план записався в профіль', saved && saved.programId === 'women4', JSON.stringify(saved));

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const today = await p.locator('#today').innerText();
  ok('3. «Сьогодні» показує тренування, а не порожній стан',
     !/План ще не обрано/.test(today), today.split('\n').slice(0, 2).join(' | '));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Чоловік міняє стать на жіночу в акаунті ---- */
{
  const { ctx, p, errs } = await open(
    Object.assign({}, MALE, { activePlan: { programId: 'ppl', days: 6 }, programId: 'ppl', daysPerWeek: 6 }));

  await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  await p.locator('.seg__item:has(input[data-p="sex"][value="female"]) span').first().click();
  await p.waitForTimeout(1200);

  const after = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return { sex: pr.sex, active: pr.activePlan };
  });
  ok('4. стать змінилась', after.sex === 'female', after.sex);
  ok('4. чоловічий план відчепився від профілю', !after.active, JSON.stringify(after.active));

  await p.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const names = await listedPlans(p);
  ok('4. список став жіночим', names.length === 1 && names[0] === 'Жіночий план', names.join(' | '));
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5. Жінка міняє стать на чоловічу ---- */
{
  const { ctx, p, errs } = await open(
    Object.assign({}, FEMALE, { activePlan: { programId: 'women4', days: 4 }, programId: 'women4', daysPerWeek: 4 }));

  await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  await p.locator('.seg__item:has(input[data-p="sex"][value="male"]) span').first().click();
  await p.waitForTimeout(1200);

  const after = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return { sex: pr.sex, active: pr.activePlan };
  });
  ok('5. стать змінилась', after.sex === 'male', after.sex);
  ok('5. жіночий план відчепився', !after.active, JSON.stringify(after.active));

  await p.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const names = await listedPlans(p);
  ok('5. список став чоловічим', names.length >= 3 && !names.some((n) => /Жіночий/.test(n)), names.join(' | '));
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Прямий перехід зі збереженим чужим планом ---- */
{
  /* Профіль ЗБЕРЕЖЕНО повз інтерфейс — саме так виглядає підроблений або
     застарілий стан. Жодна сторінка не має його відкрити. */
  const { ctx, p, errs } = await open(
    Object.assign({}, MALE, { activePlan: { programId: 'women4', days: 4 }, programId: 'women4', daysPerWeek: 4 }));

  await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const mine = await p.locator('#my-plan').innerText();
  ok('6. «Мій план» не відкриває чужу схему',
     /План ще не обрано/.test(mine) || !/Жіночий/.test(mine), mine.split('\n')[0]);

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  ok('6. «Сьогодні» теж не відкриває',
     /План ще не обрано/.test(await p.locator('#today').innerText()));

  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const wk = await p.locator('main').innerText();
  ok('6. сторінка тренування не показує вправ чужої схеми',
     !/Ягодичний міст|Гіперекстензія на сідниці/.test(wk));
  ok('6. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 7. Дзеркальний випадок: жінка зі збереженим чоловічим планом ---- */
{
  const { ctx, p, errs } = await open(
    Object.assign({}, FEMALE, { activePlan: { programId: 'ppl', days: 6 }, programId: 'ppl', daysPerWeek: 6 }));

  await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const mine = await p.locator('#my-plan').innerText();
  ok('7. «Мій план» не відкриває чоловічу схему жінці',
     /План ще не обрано/.test(mine) || !/Push|Pull|Legs/.test(mine), mine.split('\n')[0]);
  ok('7. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок розділення планів за статтю пройшло.');
process.exit(bad ? 1 : 0);
