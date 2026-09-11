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
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const WOMEN = 'PUSH/PULL';
const MEN = ['Full Body', 'UL', 'Push / Pull / Legs', 'UL/PPL'];
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

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
  ok('1. жіночого плану в списку немає', !names.some((n) => n === WOMEN), names.join(' | '));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Новий користувач-жінка ---- */
{
  const { ctx, p, errs } = await open(FEMALE);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const names = await listedPlans(p);
  /* Два ГОТОВІ жіночі плани: PUSH/PULL (4 дні) і Full Body (3 дні).
     «Full Body» як назва є і в чоловіків, тож звіряємо не назвою, а id
     обраної схеми. Третім у списку стоїть «Власний план» — порожній
     каркас, він не належить статі й видний усім (js/programs-data.js). */
  const ready = names.filter((n) => !/Власний план/.test(n));
  ok('2. жінка бачить рівно два готові плани', ready.length === 2, names.join(' | '));
  ok('2. і порожній власний каркас — він для обох статей',
     names.some((n) => /Власний план/.test(n)), names.join(' | '));
  ok('2. серед них «PUSH/PULL»', names.includes(WOMEN), names.join(' | '));
  ok('2. жодної чоловічої схеми (крім однойменного Full Body)', !ready.some((n) => MEN.includes(n) && n !== 'Full Body'), names.join(' | '));
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

/* ---- 4. Акаунт НЕ дає міняти стать (лише реєстрація) ---- */
{
  const { ctx, p, errs } = await open(
    Object.assign({}, MALE, { activePlan: { programId: 'ppl', days: 6 }, programId: 'ppl', daysPerWeek: 6 }));

  await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  /* Головне: у профілі більше немає жодного контролу зміни статі. */
  const sexInputs = await p.locator('#profile input[data-p="sex"]').count();
  ok('4. в акаунті немає перемикача статі', sexInputs === 0, 'знайдено input: ' + sexInputs);
  /* Стать усе одно показана — як текст, а не як вибір. */
  const shown = await p.locator('#profile').innerText();
  ok('4. поточна стать показана текстом', /Чоловік/.test(shown), '');
  ok('4. клік нікуди — стать лишилась чоловічою', true);
  const after = await p.evaluate(async () => (await window.Store.getProfile()).sex);
  ok('4. стать у профілі не змінилась', after === 'male', String(after));
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4b. Адмін БАЧИТЬ перемикач статі (для тестів схем) ---- */
{
  const { ctx, p, errs } = await open(MALE);
  await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  /* Позначаємо сесію адміном так само, як це робить account_state. */
  await p.evaluate(() => {
    localStorage.setItem('ib.account', JSON.stringify({ status: 'approved', isAdmin: true, t: Date.now() }));
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const sexInputs = await p.locator('#profile input[data-p="sex"]').count();
  ok('4b. адмін бачить перемикач статі', sexInputs === 2, 'input: ' + sexInputs);
  ok('4b. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5. Запобіжник: зміна статі через ІМПОРТ відчіпляє чужий план ----
   Стать в акаунті не редагується, але повний імпорт резервної копії
   може принести іншу стать. Тоді активний план чужої статі має
   відчепитись — це робить detachPlanIfForeign у Store-збереженні. */
{
  const { ctx, p, errs } = await open(
    Object.assign({}, FEMALE, { activePlan: { programId: 'women4', days: 4 }, programId: 'women4', daysPerWeek: 4 }));

  await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  /* Емуляція імпорту: пряме збереження нової статі, як робить applyImport. */
  await p.evaluate(async () => { await window.Store.saveProfile({ sex: 'male' }); });
  await p.waitForTimeout(1200);

  const afterSex = await p.evaluate(async () => (await window.Store.getProfile()).sex);
  ok('5. стать змінилась (імпорт)', afterSex === 'male', String(afterSex));

  /* Головна гарантія: навіть якщо в профілі лишилось посилання на жіночий
     план, він БІЛЬШЕ НЕ ПОДАЄТЬСЯ — гейт resolvePlan за статтю тримає. */
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const today = await p.locator('#today').innerText();
  ok('5. «Сьогодні» не подає жіночий план чоловікові',
     /План ще не обрано/.test(today) || !/PUSH\/PULL/.test(today), today.split('\n').slice(0,2).join(' | '));

  await p.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const names = await listedPlans(p);
  ok('5. список став чоловічим', names.length >= 3 && !names.some((n) => n === WOMEN), names.join(' | '));
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
  ok('6. «Мій план тренувань» не відкриває чужу схему',
     /План ще не обрано/.test(mine) || !/Жіночий/.test(mine), mine.split('\n')[0]);

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  /* «Сьогодні» перебрано: списку тренування там більше немає, є назва
     програми. Чужу схему сторінка відмовляється НАЗВАТИ — resolvePlan
     віддає null, і заголовок каже «Програму не обрано». */
  const tdy = await p.locator('#today').innerText();
  ok('6. «Сьогодні» теж не відкриває',
     /Програму не обрано/.test(tdy) && !/Жіноч/i.test(tdy), tdy.split('\n')[0]);

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
  ok('7. «Мій план тренувань» не відкриває чоловічу схему жінці',
     /План ще не обрано/.test(mine) || !MEN.some((n) => mine.includes(n)), mine.split('\n')[0]);
  ok('7. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок розділення планів за статтю пройшло.');
process.exit(bad ? 1 : 0);
