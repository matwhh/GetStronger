/**
 * ADVERSARIAL / CHAOS: інтерфейс має пережити тупі, надшвидкі, повторювані дії.
 *
 * Головне тут — регрес фризу тем. Корінь був не в CSS, а в накопиченні
 * обробників: renderAll (=Store.onChange) щоразу навішував новий click-слухач
 * на постійний #theme. Клік теми -> setTheme -> saveProfile -> onChange ->
 * renderAll -> +слухач; слухачі росли експоненційно й вішали сторінку після
 * 3-4 перемикань. Тест ловить саме це: кожен КЛІК має викликати setTheme
 * РІВНО ОДИН раз, скільки б їх не було.
 */
import { chromium } from 'playwright';
import { CHROME } from './pw.mjs';
const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
/* Сіємо ДО скриптів сторінки: локальний режим + повний профіль, щоб
   синхронний гейт у <head> пустив на акаунт, а не відвернув на welcome. */
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('ib.cloud', '0');
    if (!localStorage.getItem('ib.profile')) localStorage.setItem('ib.profile', JSON.stringify({
      version: 10, sex:'male', birthDate:'1995-06-15', age:31, weight:82, height:180,
      activity:1.55, trainingAge:'inter', activePlan:{programId:'ppl',days:6}, programId:'ppl',
      weights:{'Жим лежачи':100}, workLog:{'2026-08-20':true}
    }));
  } catch (_) {}
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);

const picks = await p.locator('#theme [data-theme-pick]').count();
ok('перемикач тем відрендерився', picks >= 3, 'кнопок: ' + picks);

/* Лічильник викликів setTheme: обгортаємо App.setTheme. Обробник читає
   window.App.setTheme у момент кліку, тож обгортка ловить кожен виклик. */
await p.evaluate(() => {
  window.__st = 0;
  const orig = window.App.setTheme;
  window.App.setTheme = function () { window.__st++; return orig.apply(this, arguments); };
});

/* 30 послідовних кліків по різних темах, кожен із паузою, щоб встиг
   відпрацювати onChange->renderAll (саме там раніше плодились слухачі). */
const ids = await p.$$eval('#theme [data-theme-pick]', els => els.map(e => e.dataset.themePick));
let clicks = 0;
for (let i = 0; i < 30; i++) {
  const id = ids[i % ids.length];
  await p.click('#theme [data-theme-pick="' + id + '"]');
  clicks++;
  await p.waitForTimeout(30);
}
const st1 = await p.evaluate(() => window.__st);
ok('кожен клік = рівно один setTheme (немає накопичення)', st1 === clicks, st1 + ' викликів на ' + clicks + ' кліків');

/* Швидкий шторм: 300 кліків майже без пауз. Має лишитись 1:1 і відпрацювати
   швидко, а не зависнути. */
await p.evaluate(() => { window.__st = 0; });
const t0 = Date.now();
for (let i = 0; i < 300; i++) {
  const id = ids[i % ids.length];
  await p.click('#theme [data-theme-pick="' + id + '"]', { timeout: 5000 });
}
const dt = Date.now() - t0;
const st2 = await p.evaluate(() => window.__st);
ok('шторм 300 кліків: setTheme рівно 300', st2 === 300, st2 + ' викликів');
ok('шторм 300 кліків не завис (< 20 с)', dt < 20000, dt + ' мс');

/* Детермінізм: остання обрана тема реально застосована в DOM. */
const lastId = ids[(300 - 1) % ids.length] || '';
const domTheme = await p.evaluate(() => document.documentElement.dataset.theme || '');
ok('остання тема застосована детерміновано', domTheme === lastId, 'dom=' + domTheme + ' очік=' + lastId);

/* Тема + схема разом, теж спамом. */
await p.evaluate(() => { window.__st = 0; });
for (let i = 0; i < 20; i++) {
  await p.locator('#p-scheme').click();
  await p.click('#theme [data-theme-pick="' + ids[i % ids.length] + '"]');
}
await p.waitForTimeout(100);
const st3 = await p.evaluate(() => window.__st);
ok('спам теми+схеми: setTheme 1:1 (20)', st3 === 20, st3 + ' викликів');

ok('без JS-помилок за весь шторм', errs.length === 0, errs.slice(0,3).join(' | '));

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' chaos-перевірок пройшло.');
process.exit(bad ? 1 : 0);
