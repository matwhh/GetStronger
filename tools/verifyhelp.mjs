/**
 * Контекстна довідка в браузері.
 *
 * Юніти (tests/help.test.js) стережуть ВМІСТ: що для кожної сторінки є
 * свій розділ і що числа ELO не вписані руками. Тут перевіряється те, чого
 * в пісочниці не побачиш: що кнопка справді є на кожній сторінці, що
 * вікно справді модальне (фокус, Tab, Escape, підкладка, скрол фону) і що
 * вміст на різних сторінках РІЗНИЙ — інакше «контекстна довідка» була б
 * однією інструкцією з двадцятьма назвами.
 *
 * Мережі не потрібно: усе на file://.
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

/* Сторінки з шапкою — рівно ті, де має бути кнопка довідки. */
const PAGES = readdirSync(ROOT)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => readFileSync(ROOT + '/' + f, 'utf8').indexOf('js/app.js') !== -1)
  .sort();

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

const openHelp = async () => {
  await p.locator('[data-help-open]').first().click();
  await p.waitForTimeout(260);
};

/* ------------------------------------------------------------------ */
/* 1. Кнопка є скрізь, і вміст різний                                   */
/* ------------------------------------------------------------------ */
const titles = {};
const missing = [];
for (const f of PAGES) {
  await p.goto('file://' + ROOT + '/' + f, { waitUntil: 'load' });
  await p.waitForTimeout(500);
  const shown = await p.locator('[data-help-open]:not([hidden])').count();
  if (!shown) { missing.push(f); continue; }
  await openHelp();
  titles[f] = (await p.locator('.help__title').textContent()) || '';
  const words = (await p.locator('.help__body').innerText()).split(/\s+/).length;
  /* Поріг низький навмисно: короткі розділи — це рішення, а не недогляд
     («Бокс» пояснює три речення, і більше там пояснювати нічого). Тут
     ловиться порожнє вікно, а не стислість. */
  if (words < 30) missing.push(f + ' (порожньо: ' + words + ' слів)');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(220);
}
ok('кнопка довідки є на всіх ' + PAGES.length + ' сторінках із шапкою',
   missing.length === 0, missing.join(', '));

const uniqTitles = new Set(Object.values(titles));
ok('заголовок довідки різний на різних сторінках',
   uniqTitles.size === Object.keys(titles).length,
   uniqTitles.size + ' унікальних із ' + Object.keys(titles).length);

/* Найголовніше твердження всієї затії: одна кнопка — різний вміст. */
{
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(500); await openHelp();
  const a = await p.locator('.help__body').innerText();
  await p.keyboard.press('Escape'); await p.waitForTimeout(220);

  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(500); await openHelp();
  const c = await p.locator('.help__body').innerText();
  await p.keyboard.press('Escape'); await p.waitForTimeout(220);

  ok('вміст «Сьогодні» і «Тренування» не збігається', a !== c,
     a.length + ' проти ' + c.length + ' символів');
}

/* ------------------------------------------------------------------ */
/* 2. Вікно справді модальне                                            */
/* ------------------------------------------------------------------ */
{
  await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await p.waitForTimeout(600);

  await openHelp();
  ok('фокус переведений усередину вікна',
     await p.evaluate(() => !!document.activeElement.closest('.help__box')));
  ok('фон не прокручується',
     await p.evaluate(() => document.body.style.position === 'fixed'));
  ok('вікно оголошене діалогом',
     await p.evaluate(() => {
       const d = document.querySelector('.help__box');
       return d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true';
     }));

  /* Пастка фокуса: після двадцяти Tab фокус усе ще всередині. */
  for (let i = 0; i < 20; i++) await p.keyboard.press('Tab');
  ok('Tab не виводить фокус із вікна',
     await p.evaluate(() => !!document.activeElement.closest('.help__box')));

  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('Escape закриває', (await p.locator('.help__box').count()) === 0);
  ok('після закриття скрол вільний',
     await p.evaluate(() => document.body.style.position !== 'fixed'));
  ok('фокус повернувся на кнопку',
     await p.evaluate(() => !!document.activeElement.closest('[data-help-open]')));

  /* Клік по підкладці — другий спосіб закрити. */
  await openHelp();
  await p.locator('.modal__backdrop').click({ position: { x: 5, y: 5 } });
  await p.waitForTimeout(300);
  ok('клік по підкладці закриває', (await p.locator('.help__box').count()) === 0);
}

/* ------------------------------------------------------------------ */
/* 3. Рейтинг: без стану сезону — чесне пояснення, а не порожня таблиця  */
/* ------------------------------------------------------------------ */
{
  await p.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  await openHelp();
  const txt = await p.locator('.help__body').innerText();
  ok('у рейтингу немає порожньої таблиці без чисел',
     (await p.locator('.help__table').count()) === 0 ? /рейтинг|сервер/i.test(txt) : true,
     (await p.locator('.help__table').count()) + ' таблиць');
  ok('пояснення про ELO є в будь-якому разі', /ELO/.test(txt));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(220);
}

/* ------------------------------------------------------------------ */
/* 4. Мобільний екран                                                   */
/* ------------------------------------------------------------------ */
{
  const m = await adultContext(b, { viewport: { width: 375, height: 700 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
  await mp.waitForTimeout(600);
  await mp.locator('[data-help-open]').first().click();
  await mp.waitForTimeout(320);

  ok('375px: вікно відкрилось', (await mp.locator('.help__box').count()) === 1);
  ok('375px: сторінка не поїхала вбік',
     await mp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
     await mp.evaluate(() => document.documentElement.scrollWidth + ' проти ' + document.documentElement.clientWidth));
  ok('375px: вікно вміщається у висоту',
     await mp.evaluate(() => {
       const r = document.querySelector('.help__box').getBoundingClientRect();
       return r.height <= window.innerHeight + 1;
     }));
  ok('375px: кнопка закриття ≥ 30px',
     await mp.evaluate(() => {
       const r = document.querySelector('.help__head [data-help-close]').getBoundingClientRect();
       return r.width >= 30 && r.height >= 30;
     }));
  await m.close();
}

ok('без JS-помилок на жодній сторінці', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
const bad = R.filter(([, c]) => !c).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок довідки пройшло.');
process.exit(bad ? 1 : 0);
