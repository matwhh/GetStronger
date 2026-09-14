/**
 * Свої вправи й власний RIR у редакторі плану.
 *
 * ЩО ЦЕ СТЕРЕЖЕ. Бібліотека вправ — файл у репозиторії: додати туди
 * тренажер, який стоїть у твоєму клубі, можна було лише правкою коду.
 * Людина обирала «щось схоже», і тижневий обʼєм рахувався не про те, що
 * вона робила. RIR так само стояв у даних програми намертво — при тому
 * що запас до відмови найособистіше число в усій схемі.
 *
 * Обидві правки чіпають те саме місце — збережений план, — тому й
 * перевіряються разом: своя вправа мусить доїхати до випадайки заміни,
 * а RIR — до схеми на екрані тренування.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const SEED = {
  birthDate: '1990-06-15', sex: 'male', age: 31, height: 181, weight: 81.4,
  activity: 1.55, goal: 'cut', meals: 4, daysPerWeek: 3, trainingAge: 'inter',
  activePlan: { programId: 'fullbody', days: 3 }, programId: 'fullbody',
  weights: { 'Ходьба у гору': 1 }
};

async function open() {
  const ctx = await adultContext(b, { viewport: { width: 430, height: 900 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async s => { await window.Store.saveProfile(s); }, SEED);
  return { ctx, p, errs };
}

const tap = async (l) => {
  await l.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {});
  return l.click({ timeout: 8000 });
};

/** Відкрити план у режимі правки з розгорнутим першим днем. */
async function editPlan(p) {
  await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await tap(p.locator('#toggle-edit'));
  await p.waitForTimeout(600);
  const head = p.locator('#plan .acc__head').first();
  if (await head.count()) {
    const open = await head.getAttribute('aria-expanded');
    if (open !== 'true') { await tap(head); await p.waitForTimeout(500); }
  }
}

const profile = (p) => p.evaluate(async () => await window.Store.getProfile());

/* ---- 1. RIR правиться й доїжджає до плану ---- */
{
  const { ctx, p, errs } = await open();
  await editPlan(p);

  const rir = p.locator('#plan input[data-act="rir"]').first();
  ok('1. поле RIR зʼявилось у правці', await rir.count() === 1, 'полів: ' + await p.locator('#plan input[data-act="rir"]').count());
  ok('1. у ньому стоїть число з програми', ['1', '2'].includes(await rir.inputValue()), await rir.inputValue());

  await rir.fill('4');
  await rir.press('Enter');
  await p.waitForTimeout(900);

  const saved = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const plan = (pr.customPlans || {})['fullbody:3'];
    return plan ? plan[0].exercises[0].rir : null;
  });
  ok('1. нове значення в збереженому плані', saved === '4', String(saved));

  /* Стеля не декоративна: періодизація однаково обріже RIR до 5. */
  await p.locator('#plan input[data-act="rir"]').first().fill('9');
  await p.locator('#plan input[data-act="rir"]').first().press('Enter');
  await p.waitForTimeout(900);
  const capped = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return (pr.customPlans || {})['fullbody:3'][0].exercises[0].rir;
  });
  ok('1. понад стелю підтягується до 5', capped === '5', String(capped));

  /* Порожнє поле прибирає RIR зовсім — це осмислена дія, а не помилка. */
  await p.locator('#plan input[data-act="rir"]').first().fill('');
  await p.locator('#plan input[data-act="rir"]').first().press('Enter');
  await p.waitForTimeout(900);
  const gone = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return 'rir' in (pr.customPlans || {})['fullbody:3'][0].exercises[0];
  });
  ok('1. порожнє поле прибирає RIR, а не повертає авторський', gone === false);
  ok('1. без JS-помилок', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ---- 2. RIR доїжджає до екрана тренування ---- */
{
  const { ctx, p, errs } = await open();
  await editPlan(p);
  await p.locator('#plan input[data-act="rir"]').first().fill('3');
  await p.locator('#plan input[data-act="rir"]').first().press('Enter');
  await p.waitForTimeout(900);
  const name = await p.locator('#plan .acc.is-open select[data-act="swap"]').first().inputValue();

  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const row = p.locator('#workout .tdy-ex').filter({ hasText: name }).first();
  ok('2. вправа знайшлась на тренуванні', await row.count() > 0, name);
  ok('2. схема показує саме поставлений RIR',
     /RIR\s*3/.test(await row.locator('.tdy-ex__scheme').innerText()),
     await row.locator('.tdy-ex__scheme').innerText());
  ok('2. без JS-помилок', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ---- 3. Своя вправа: створення ---- */
{
  const { ctx, p, errs } = await open();
  await editPlan(p);

  await tap(p.locator('#plan [data-own-new]').first());
  await p.waitForTimeout(500);
  ok('3. вікно створення відкрилось',
     await p.locator('.modal #own-name').count() === 1 &&
     await p.locator('.modal #own-muscle').count() === 1);

  await p.locator('.modal #own-name').fill('Жим у хаммері');
  await p.locator('.modal #own-muscle').selectOption('chest');
  await p.locator('.modal #own-compound').check();
  await tap(p.locator('.modal [data-sh="yes"]'));
  await p.waitForTimeout(1200);

  ok('3. вікно закрилось', await p.locator('.modal').count() === 0);

  const pr = await profile(p);
  const own = pr.customExercises || [];
  ok('3. вправа лежить у профілі', own.length === 1 && own[0].name === 'Жим у хаммері',
     JSON.stringify(own));
  ok('3. головна група збережена', own[0] && own[0].muscles[0] === 'chest', JSON.stringify(own[0]));
  ok('3. тип збережено', own[0] && own[0].lift === 'compound', String(own[0] && own[0].lift));

  ok('3. і вона одразу стоїть у плані',
     await p.evaluate(async () => {
       const p2 = await window.Store.getProfile();
       return ((p2.customPlans || {})['fullbody:3'] || [])
         .some(d => (d.exercises || []).some(e => e.name === 'Жим у хаммері'));
     }));

  /* Головне: далі вона нічим не відрізняється від бібліотечної. */
  ok('3. бібліотека знає її після перезавантаження сторінки',
     await p.evaluate(() => (window.EXERCISES || []).some(e => e.name === 'Жим у хаммері')));

  /* Після F5 правка вимикається, тож режим вмикаємо наново — випадайки
     заміни існують тільки в ньому. */
  await editPlan(p);
  ok('3. і після F5 теж',
     await p.evaluate(() => (window.EXERCISES || []).some(e => e.name === 'Жим у хаммері')));
  ok('3. її видно у випадайці заміни на ту саму групу',
     await p.evaluate(() => Array.from(document.querySelectorAll('#plan select[data-act="swap"] option'))
       .some(o => o.textContent.trim() === 'Жим у хаммері')));
  ok('3. без JS-помилок', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ---- 4. Дублікат назви не приймається ---- */
{
  const { ctx, p, errs } = await open();
  await editPlan(p);
  await tap(p.locator('#plan [data-own-new]').first());
  await p.waitForTimeout(500);
  /* Назва з бібліотеки, набрана іншим регістром: у книзі ваг ключ той
     самий, тож дві такі вправи ділили б одну вагу. */
  await p.locator('.modal #own-name').fill('жим  ГАНТЕЛЕЙ лежачи');
  await p.locator('.modal #own-muscle').selectOption('chest');
  await tap(p.locator('.modal [data-sh="yes"]'));
  await p.waitForTimeout(700);
  ok('4. вікно лишилось відкритим', await p.locator('.modal').count() === 1);
  ok('4. і сказано чому',
     /вже є/.test(await p.locator('.toast').first().innerText().catch(() => '')),
     await p.locator('.toast').first().innerText().catch(() => '—'));
  ok('4. у профіль нічого не лягло',
     ((await profile(p)).customExercises || []).length === 0);

  /* Порожня назва — теж відмова, і теж із причиною. */
  await p.locator('.modal #own-name').fill('   ');
  await tap(p.locator('.modal [data-sh="yes"]'));
  await p.waitForTimeout(600);
  ok('4. порожня назва не проходить', await p.locator('.modal').count() === 1);
  ok('4. без JS-помилок', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ---- 5. Прибирання своєї вправи не чіпає план ---- */
{
  const { ctx, p, errs } = await open();
  await editPlan(p);
  await tap(p.locator('#plan [data-own-new]').first());
  await p.waitForTimeout(500);
  await p.locator('.modal #own-name').fill('Тяга саней');
  await p.locator('.modal #own-muscle').selectOption('quads');
  await tap(p.locator('.modal [data-sh="yes"]'));
  await p.waitForTimeout(1200);

  ok('5. список «Мої вправи» зʼявився', await p.locator('#plan .own-ex__row').count() === 1);

  await tap(p.locator('#plan [data-own-del]').first());
  await p.waitForTimeout(1000);

  ok('5. з профілю прибралась', ((await profile(p)).customExercises || []).length === 0);
  ok('5. і з бібліотеки теж',
     await p.evaluate(() => !(window.EXERCISES || []).some(e => e.name === 'Тяга саней')));
  /*
   * А ось із плану — НІ. Рядок плану носить свої muscles і вагу; тихо
   * зносити його разом із записом у бібліотеці означало б втратити
   * тренування, яке людина вже налаштувала.
   */
  ok('5. але з плану не зникла',
     await p.evaluate(async () => {
       const pr = await window.Store.getProfile();
       return ((pr.customPlans || {})['fullbody:3'] || [])
         .some(d => (d.exercises || []).some(e => e.name === 'Тяга саней'));
     }));
  ok('5. без JS-помилок', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок своїх вправ і RIR пройшло.');
process.exit(bad ? 1 : 0);
