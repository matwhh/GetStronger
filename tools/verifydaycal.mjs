/**
 * СТАНДАРТНА СІТКА ДНІВ — одна на весь сайт.
 *
 * Ця сітка була написана двічі майже однаково (історія тренувань і
 * календар зважувань), і копії вже встигли розійтись у сенсі заливки:
 * одна показувала, СКІЛЬКИ підходів закрито, а друга — лише «було/не
 * було», і найяскравіший колір означав у них різні речі. Тепер сітку
 * малює один модуль (js/daycal-core.js), і цей інструмент стереже саме
 * єдність: усі календарі сайту мають однакову СТРУКТУРУ.
 *
 * Окремо перевіряється календар сезону в рейтингу: заради нього все й
 * зводилось у модуль, і в нього своя, третя семантика клітинки —
 * заливка означає МЕЖУ сезону, а не тренування. Якщо колись хтось
 * заллє тут минулі дні «щоб було видно прогрес», перевірка впаде: це
 * рівно та помилка, від якої клітинку колись і звели в один клас.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: CHROME });

/** Структурний відбиток сітки: теги й набори класів на кожному рівні. */
const SHAPE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const kids = [...el.children].map((c) => c.tagName + '.' + c.className);
  const grid = el.querySelector('.mcal__grid');
  return {
    root: el.className.split(' ').filter((c) => c === 'mcal').join(''),
    kids: kids.join(' | '),
    days: grid ? [...grid.querySelector('.mcal__days').children].map((s) => s.textContent).join('') : '',
    col7: grid ? [...grid.querySelectorAll('.mcal__col')]
      .every((c) => c.children.length === 7) : false,
    hasMonths: !!el.querySelector('.mcal__months-pad')
  };
};

/* ---- 1. Календар сезону на «Рейтингу» -------------------------------- */
{
  const ctx = await adultContext(b, { viewport: { width: 1300, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  ok('1. календар сезону є', await p.locator('#sz-cal .mcal').count() === 1);

  const txt = await p.locator('#sz-cal .card').innerText().catch(() => '');
  ok('1. підписані обидві межі сезону',
     /Початок:/.test(txt) && /Кінець:/.test(txt) && /день \d+ із \d+/.test(txt),
     txt.split('\n').slice(0, 3).join(' | '));

  const m = await p.evaluate(() => {
    const root = document.querySelector('#sz-cal .mcal');
    const cells = [...root.querySelectorAll('.mcal__cell')];
    const filled = cells.filter((c) => c.getAttribute('data-lvl') === '4');
    return {
      cells: cells.filter((c) => !c.classList.contains('mcal__cell--pad')).length,
      filled: filled.length,
      titles: filled.map((c) => c.getAttribute('title') || ''),
      sel: root.querySelectorAll('.mcal__cell--sel').length,
      future: root.querySelectorAll('.mcal__cell--future').length,
      buttons: root.querySelectorAll('button').length,
      /* Скільки днів у сезоні за самим ядром — з ним і звіряємо сітку. */
      spanDays: (function () {
        const EC = window.EloCore;
        const r = EC.seasonRange(EC.seasonOf(new Date()));
        return Math.round((r[1] - r[0]) / 86400000) + 1;
      })()
    };
  });
  /*
   * Сезон більше не дорівнює кварталу: він закінчується в неділю, тож
   * довжина плаває від 84 до 98 днів (12–14 тижнів). Перехідна осінь-2026
   * — 97 днів. Головне не число, а те, що сітка показує РІВНО стільки
   * днів, скільки їх у межах сезону.
   */
  ok('1. у сітці рівно стільки днів, скільки в сезоні',
     m.cells === m.spanDays, m.cells + ' клітинок проти ' + m.spanDays + ' днів у межах');
  ok('1. залито РІВНО дві клітинки — початок і кінець', m.filled === 2, JSON.stringify(m.titles));
  ok('1. і обидві підписані як межі сезону',
     /Початок сезону/.test(m.titles[0] || '') && /Кінець сезону/.test(m.titles[1] || ''),
     JSON.stringify(m.titles));
  ok('1. сьогодні позначене кільцем', m.sel === 1, String(m.sel));
  ok('1. попереду є бліді дні', m.future > 0, String(m.future));
  /*
   * Календар сезону НЕ клікається навмисно: клікнути в ньому нема по
   * чому. Кнопка без дії — обіцянка, якої інтерфейс не виконує, і на
   * телефоні вона ще й перехоплює прокрутку.
   */
  ok('1. клітинки не вдають із себе кнопки', m.buttons === 0, String(m.buttons));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));

  const shapeSeason = await p.evaluate(SHAPE, '#sz-cal .mcal');
  ok('1. сітка сезону має стандартну структуру',
     shapeSeason && shapeSeason.root === 'mcal' && shapeSeason.col7 && shapeSeason.hasMonths &&
     shapeSeason.days === 'ПнВтСрЧтПтСбНд', JSON.stringify(shapeSeason));

  /* ---- 2. Календарі журналів — та сама структура ---------------------- */
  /* Історія тренувань лишилась у «Прогресі», а календар зважувань живе на
     власній сторінці: блок ваги в «Прогресі» — це тепер сам графік. */
  await p.goto('file://' + ROOT + '/journal.html#history', { waitUntil: 'load' });
  await p.waitForTimeout(1800);

  ok('2. календар історії намальований',
     await p.locator('#jr-hcal .mcal').count() === 1);
  const shapeHist = await p.evaluate(SHAPE, '#jr-hcal .mcal');
  ok('2. історія тренувань = структура сезону',
     shapeHist && shapeHist.kids === shapeSeason.kids && shapeHist.days === shapeSeason.days &&
     shapeHist.col7, JSON.stringify(shapeHist));
  ok('2. у журналі дні клікабельні',
     await p.locator('#jr-hcal button.mcal__cell').count() > 0);

  await p.goto('file://' + ROOT + '/weight-log.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  ok('2. календар зважувань намальований',
     await p.locator('#wl-main .mcal').count() === 1);
  const shapeWeight = await p.evaluate(SHAPE, '#wl-main .mcal');
  ok('2. зважування = структура сезону',
     shapeWeight && shapeWeight.kids === shapeSeason.kids && shapeWeight.days === shapeSeason.days &&
     shapeWeight.col7, JSON.stringify(shapeWeight));
  ok('2. дні зважувань клікабельні',
     await p.locator('#wl-main button.mcal__cell').count() > 0);

  await p.goto('file://' + ROOT + '/train-log.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  ok('2. календар тренувань намальований',
     await p.locator('#tl-main .mcal').count() === 1);
  const shapeTrain = await p.evaluate(SHAPE, '#tl-main .mcal');
  ok('2. дні тренувань = структура сезону',
     shapeTrain && shapeTrain.kids === shapeSeason.kids && shapeTrain.days === shapeSeason.days &&
     shapeTrain.col7, JSON.stringify(shapeTrain));

  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Телефон: сітка не рве сторінку -------------------------------- */
for (const page of ['rating.html', 'journal.html#history']) {
  const ctx = await adultContext(b, {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' });
  await p.waitForTimeout(1700);
  const m = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    cals: document.querySelectorAll('.mcal').length,
    /* Сітка ширша за екран — це нормально: вона прокручується
       ВСЕРЕДИНІ себе. Ненормально, коли прокручується вся сторінка. */
    scrollable: [...document.querySelectorAll('.mcal')]
      .every((c) => getComputedStyle(c).overflowX !== 'visible')
  }));
  ok('3. ' + page + ': сторінка не їде вбік', !m.overflow);
  ok('3. ' + page + ': календарі на місці', m.cals >= 1, String(m.cals));
  ok('3. ' + page + ': сітка прокручується всередині себе', m.scrollable);
  ok('3. ' + page + ': без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок стандартного календаря пройшло.');
process.exit(bad ? 1 : 0);
