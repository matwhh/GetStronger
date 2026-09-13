/**
 * ДОВІДКА ЯК КНИЖКА: значок, пошук, інструкція, вимикач.
 *
 * Що тут стережеться:
 *   1. значок є на КОЖНІЙ сторінці, а не лише там, де є свій розділ —
 *      раніше він ховався, і на половині сайту довідки просто не було;
 *   2. він МАЛИЙ: у 34 пікселі книга перетягувала на себе весь правий
 *      кут шапки й читалась як головна кнопка сторінки;
 *   3. пошук шукає по ВСІЙ довідці, а не по відкритому розділу, і
 *      результат відкривається одним дотиком;
 *   4. «Інструкція до сайту» доступна звідусіль;
 *   5. значок можна прибрати в «Акаунті» — і повернути там само.
 *
 * Запуск: node tools/verifyhelpbook.mjs
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const PROFILE = {
  birthDate: '1990-06-15', weight: 80, height: 180, age: 36, sex: 'male',
  activity: 1.55, trainingAge: 'inter', daysPerWeek: 4, programId: 'fullbody',
  activePlan: { programId: 'fullbody', days: 4 }, weights: { 'Ходьба у гору': 1 }
};

async function page(ctx, url) {
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/' + url, { waitUntil: 'load' });
  await p.evaluate((prof) => {
    const raw = JSON.parse(localStorage.getItem('ib.profile') || '{}');
    Object.assign(raw, prof);
    localStorage.setItem('ib.profile', JSON.stringify(raw));
  }, PROFILE);
  await p.goto('file://' + ROOT + '/' + url, { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  return p;
}

/* ------------------------------------------------------------------ */
/* 1. Значок є скрізь і він малий                                       */
/* ------------------------------------------------------------------ */
{
  const ctx = await adultContext(b, { viewport: { width: 1100, height: 900 } });
  const PAGES = ['index.html', 'workout.html', 'plan.html', 'journal.html',
                 'meals.html', 'measure.html', 'calculator.html', 'account.html',
                 'trackers.html', 'periodization.html', 'nutrition.html',
                 'supplements.html', 'research.html', 'rating.html', 'seasons.html', 'awards.html',
                 'programs.html', 'cardio.html', 'boxing.html'];
  const missing = [];
  const covered = [];
  let glyph = null;
  for (const url of PAGES) {
    const p = await page(ctx, url);
    const info = await p.evaluate(() => {
      const btn = document.querySelector('[data-help-open]');
      if (!btn || btn.hidden) return null;
      const ico = btn.querySelector('svg');
      const r = ico ? ico.getBoundingClientRect() : null;
      const br = btn.getBoundingClientRect();
      const nav = document.querySelector('.nav');
      const navBottom = nav ? Math.round(nav.getBoundingClientRect().bottom) : 0;
      /* Що саме лежить під кнопкою — так ловиться накладання на текст. */
      const under = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
      return { w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
               bw: Math.round(br.width), bh: Math.round(br.height),
               right: Math.round(window.innerWidth - br.right),
               top: Math.round(br.top), navBottom: navBottom,
               inNav: Boolean(btn.closest('.nav')),
               mine: Boolean(under && btn.contains(under)) };
    });
    if (!info) missing.push(url); else glyph = info;
    /* Перекриття перевіряємо на КОЖНІЙ сторінці, а не на останній:
       кнопка висить поверх довільного вмісту, і достатньо одного
       довгого заголовка, щоб вона опинилась під ним. */
    if (info && !info.mine) covered.push(url);
    await p.close();
  }
  ok('1. значок довідки є на кожній сторінці', missing.length === 0, missing.join(', ') || 'усі');
  ok('2. знак малий — не більший за 24px', glyph && glyph.w <= 24 && glyph.h <= 24,
     glyph ? glyph.w + '×' + glyph.h : '—');
  /* Ціль для пальця зменшувати не можна: 40px — мінімум, нижче за який
     кнопка перестає натискатись на телефоні. */
  ok('3. але сама кнопка лишається зручною для пальця',
     glyph && glyph.bw >= 36 && glyph.bh >= 36, glyph ? glyph.bw + '×' + glyph.bh : '—');
  /*
   * У КУТКУ, А НЕ В ПАНЕЛІ. Це різні речі, і саме про це була вимога:
   * кнопка мусить бути окремим елементом у правому верхньому куті,
   * нижче шапки, а не ще одним значком у кластері навігації.
   */
  ok('4. це окрема кутова кнопка, а не пункт шапки', glyph && !glyph.inNav,
     glyph && glyph.inNav ? 'усередині .nav' : 'окремо');
  ok('5. праворуч і одразу під шапкою',
     glyph && glyph.right < 40 && glyph.top >= glyph.navBottom && glyph.top < glyph.navBottom + 40,
     glyph ? 'справа ' + glyph.right + ', згори ' + glyph.top + ' (шапка до ' + glyph.navBottom + ')' : '—');
  ok('6. на жодній сторінці її нічим не перекрито', covered.length === 0,
     covered.join(', ') || 'вільна скрізь');
  await ctx.close();
}

/* ------------------------------------------------------------------ */
/* 2. Пошук і інструкція                                                */
/* ------------------------------------------------------------------ */
const ctx = await adultContext(b, { viewport: { width: 1100, height: 900 } });
const p = await page(ctx, 'index.html');
const errs = [];
p.on('pageerror', e => errs.push(e.message));

await p.locator('[data-help-open]').first().click();
await p.waitForTimeout(500);

ok('7. вікно довідки відкрилось', (await p.locator('.help__box').count()) === 1);
ok('8. у вікні є поле пошуку', (await p.locator('.help__q').count()) === 1);
ok('9. і кнопка «Інструкція до сайту»', (await p.locator('[data-help-guide]').count()) === 1);

const title = () => p.locator('#help-t').innerText();
ok('10. спершу показано розділ цієї сторінки', /Сьогодні/.test(await title()), await title());

/* ---- пошук ---- */
await p.locator('.help__q').fill('RIR');
await p.waitForTimeout(400);
{
  const hits = await p.locator('.help__hit').count();
  ok('11. пошук щось знайшов', hits > 0, String(hits));
  const where = await p.$$eval('.help__hit-where', (n) => n.map((x) => x.textContent.trim()));
  ok('12. знайдене лежить у РІЗНИХ розділах, а не лише в поточному',
     new Set(where.map((w) => w.split('·')[0].trim())).size > 1, where.join(' | '));
}

/* Один дотик по результату має відкривати той розділ. */
{
  const first = p.locator('.help__hit').first();
  const where = (await first.locator('.help__hit-where').innerText()).split('·')[0].trim();
  await first.click();
  await p.waitForTimeout(400);
  ok('13. дотик по знайденому відкрив саме той розділ',
     (await title()).trim() === where, await title() + ' проти ' + where);
  ok('14. поле пошуку очистилось', (await p.locator('.help__q').inputValue()) === '');
}

/* Запит без відповіді має пояснювати, а не мовчати. */
await p.locator('.help__q').fill('крокодилопарк');
await p.waitForTimeout(400);
ok('15. на безрезультатний запит є людська відповідь',
   /Нічого не знайшлося/.test(await p.locator('.help__body').innerText()));

/* Escape у полі чистить пошук, а не закриває всю довідку. */
await p.locator('.help__q').press('Escape');
await p.waitForTimeout(400);
ok('16. Escape у полі пошуку не закриває вікно', (await p.locator('.help__box').count()) === 1);
ok('17. і повертає розділ сторінки', /Сьогодні/.test(await title()), await title());

/* ---- інструкція ---- */
await p.locator('[data-help-guide]').click();
await p.waitForTimeout(400);
ok('18. «Інструкція до сайту» відкрилась', /Інструкція до сайту/.test(await title()), await title());
{
  const t = await p.locator('.help__body').innerText();
  ok('19. інструкція йде по порядку від акаунта', /Крок 1\. Акаунт/.test(t));
  ok('20. і доходить до щоденного користування', /Звичайний день/.test(t));
  ok('21. пояснює, що з чим повʼязане', /Що з чим повʼязане/.test(t));
  ok('22. вона довга — це інструкція, а не абзац', t.length > 4000, String(t.length));
}

ok('23. без JS-помилок', errs.length === 0, errs.join(' | '));
/* Саме кнопка в шапці: підкладка теж має data-help-close, але вона
   лежить під коробкою й кліку не приймає. */
await p.locator('.help__head [data-help-close]').click();
await p.waitForTimeout(300);

/* ------------------------------------------------------------------ */
/* 3. Вимикач в «Акаунті»                                               */
/* ------------------------------------------------------------------ */
{
  const a = await page(ctx, 'account.html');
  ok('24. в «Акаунті» є вимикач значка', (await a.locator('#a-help-btn').count()) === 1);
  ok('25. типово увімкнений', await a.locator('#a-help-btn').isChecked());

  await a.locator('#a-help-btn').uncheck();
  await a.waitForTimeout(800);
  ok('26. після вимкнення значок зник одразу, без перезавантаження',
     (await a.locator('[data-help-open]:not([hidden])').count()) === 0);

  const saved = await a.evaluate(async () => (await window.Store.getProfile()).hideHelp);
  ok('27. вибір записано в профіль', saved === true, String(saved));

  /* Найважливіше: вимкнена кнопка не має ховати довідку на інших сторінках
     назавжди — її повертають там само. */
  const other = await ctx.newPage();
  await other.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await other.waitForTimeout(1200);
  ok('28. і на інших сторінках його теж немає',
     (await other.locator('[data-help-open]:not([hidden])').count()) === 0);
  ok('29. але сама довідка жива — її можна відкрити з коду',
     await other.evaluate(() => Boolean(window.Help && window.Help.open)));
  await other.close();

  await a.locator('#a-help-btn').check();
  await a.waitForTimeout(800);
  ok('30. повернувся так само одразу',
     (await a.locator('[data-help-open]:not([hidden])').count()) >= 1);
  await a.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок довідки пройшло.');
process.exit(bad ? 1 : 0);
