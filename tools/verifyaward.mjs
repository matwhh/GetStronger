/**
 * КАРТКА НАГОРОДИ: переворот і те, що крізь нього просвічувало.
 *
 * ЩО ТУТ СТЕРЕЖЕТЬСЯ І ЧОМУ ЮНІТ ЦЬОГО НЕ БАЧИТЬ.
 *
 * tests/award-core.test.js перевіряє РОЗМІТКУ: скільки кілець, що на
 * звороті, як екранується текст. Розмітка була правильна весь час —
 * ламався малюнок.
 *
 * Лице картки — десять кілець із нескінченною анімацією. Браузер виносить
 * кожне таке кільце на власний шар композиції, а backface-visibility
 * грані на ЧУЖИЙ шар не поширюється: після перевороту кільця далі
 * малювались поверх звороту й блимали там у такт власної анімації —
 * поверх знака Forge і слова BETA.
 *
 * Найгірше в цьому те, що без GPU баг не відтворюється взагалі: у
 * headless-браузері растеризує процесор, сортування виходить правильним,
 * і знімок екрана чистий. Тому перевіряється не картинка, а ПРИЧИНА, яку
 * видно й без GPU: чи вимкнено малювання лиця, поки картка повернута
 * спиною, і чи перемикається воно рівно на середині обертання — у той
 * кадр, де картка стоїть до глядача ребром і має нульову ширину.
 *
 * Числа взяті з CSS: перехід 0.62s, затримка 0.31s.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 1000, height: 800 }, reducedMotion: 'no-preference' });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

/* Сторінка потрібна жива, а не setContent: картка бере кольори з теми, а
   тему ставить js/theme-boot.js на реальному документі. */
await p.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
await p.waitForTimeout(1500);

ok('window.Award є на сторінці рейтингу', await p.evaluate(() => typeof window.Award === 'object'));

await p.evaluate(() => {
  const host = document.createElement('div');
  host.id = 'awd-probe';
  host.style.cssText = 'position:fixed;left:24px;top:24px;width:240px;z-index:99999';
  host.innerHTML = window.Award.grid([{ kind: 'beta', label: 'Бета' }]);
  document.body.appendChild(host);
});

const vis = () => p.evaluate(() => getComputedStyle(document.querySelector('#awd-probe .awd__hole')).visibility);
const flip = (on) => p.evaluate((o) => document.querySelector('#awd-probe .awd').classList.toggle('is-flip', o), on);

/* --------------------------------------------------------------------
   1. Лице живе, поки картка лицем до глядача
   -------------------------------------------------------------------- */
ok('у спокої лице видно', (await vis()) === 'visible');

const rings = await p.locator('#awd-probe .awd__ring').count();
ok('кілець рівно десять', rings === 10, String(rings));

const anim = await p.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('#awd-probe .awd__ring'));
  return { name: cs.animationName, dur: cs.animationDuration, count: cs.animationIterationCount };
});
ok('кільця анімовані нескінченно', anim.name === 'awd-scale' && anim.count === 'infinite',
   anim.name + ' / ' + anim.dur + ' / ' + anim.count);

/* --------------------------------------------------------------------
   2. Переворот: лице гасне не одразу, а на середині
   -------------------------------------------------------------------- */
await flip(true);
await p.waitForTimeout(120);
ok('0.12s: лице ще видно — картка ще не повернулась ребром', (await vis()) === 'visible');

await p.waitForTimeout(320);
ok('0.44s: лице вимкнене — кільцям нічого малювати поверх звороту',
   (await vis()) === 'hidden');

/* --------------------------------------------------------------------
   3. Назад — так само на середині, а не миттєво
   -------------------------------------------------------------------- */
/*
 * Симетрія тут не косметична. Якби затримка стояла тільки в
 * перевернутому стані, лице поверталось би в ту саму мить, коли курсор
 * пішов, — тобто кільця знову з'явились би поверх ще видимого звороту.
 * Той самий баг, лише в інший бік.
 */
await flip(false);
await p.waitForTimeout(120);
ok('назад, 0.12s: лице ще НЕ повернулось', (await vis()) === 'hidden');

await p.waitForTimeout(320);
ok('назад, 0.44s: лице повернулось', (await vis()) === 'visible');

/* --------------------------------------------------------------------
   4. Спокій: без переходу ховати з затримкою нема від чого
   -------------------------------------------------------------------- */
{
  const c2 = await adultContext(b, { viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' });
  const q = await c2.newPage();
  await q.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
  await q.waitForTimeout(1200);
  await q.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'awd-probe';
    host.style.cssText = 'position:fixed;left:24px;top:24px;width:240px;z-index:99999';
    host.innerHTML = window.Award.grid([{ kind: 'beta' }]);
    document.body.appendChild(host);
    document.querySelector('#awd-probe .awd').classList.add('is-flip');
  });
  await q.waitForTimeout(80);
  const v = await q.evaluate(() => getComputedStyle(document.querySelector('#awd-probe .awd__hole')).visibility);
  ok('спокій: лице гасне одразу, без затримки', v === 'hidden', v);
  await c2.close();
}

ok('без JS-помилок', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
const bad = R.filter(([, c]) => !c).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок картки нагороди пройшло.');
process.exit(bad ? 1 : 0);
