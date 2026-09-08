/**
 * ADVERSARIAL / CHAOS: інтерфейс має пережити тупі, надшвидкі, повторювані дії.
 *
 * ЩО ТУТ СТЕРЕЖЕТЬСЯ І ЧОМУ САМЕ ТАК.
 *
 * Корінь колишнього фризу був не в CSS, а в накопиченні обробників:
 * renderAll (= Store.onChange) щоразу навішував НОВИЙ слухач на постійний
 * вузол сторінки. Кожна дія користувача -> saveProfile -> onChange ->
 * renderAll -> +слухач; слухачі росли, і сторінка вішалась після кількох
 * перемикань. Ловили це через перемикач тем: він був найзручнішою кнопкою,
 * що пише в профіль на кожен клік.
 *
 * Перемикача тем більше немає (оформлення одне — див. js/app.js). Але
 * ПОМИЛКА нікуди не поділась як клас: guard `wired` у wireProfileForm —
 * єдине, що стоїть між сайтом і тим самим фризом. Тому перевірка більше не
 * клікає по темах, а б'є в саму петлю: сотні saveProfile підряд і рахунок
 * слухачів на постійному #profile до й після. Якщо guard приберуть —
 * впаде тут, а не в людини на телефоні.
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

/* Лічильник addEventListener на ПОСТІЙНИХ цілях. Саме там жив фриз: вузли,
   які renderAll не замінює, а лише переписує їм innerHTML. Слухачі на
   свіжостворених вузлах помирають разом із ними й нікого не цікавлять. */
await ctx.addInitScript(() => {
  window.__adds = 0;
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (this === document || this === window ||
        (this && this.nodeType === 1 && this.id === 'profile')) window.__adds++;
    return orig.call(this, t, f, o);
  };
});

const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);

ok('форма профілю відрендерилась', await p.locator('#profile [data-p]').count() >= 3,
   'полів: ' + await p.locator('#profile [data-p]').count());

/* Фокус має бути ПОЗА #profile: renderAll свідомо не перемальовує форму,
   поки в ній редагують поле, і з фокусом усередині петля просто не
   почалась би — тест був би зеленим ні про що. */
await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });

/* ------------------------------------------------------------------ */
/* 1. 300 записів у профіль підряд                                      */
/* ------------------------------------------------------------------ */
const adds0 = await p.evaluate(() => window.__adds);
const t0 = Date.now();
await p.evaluate(async () => {
  for (let i = 0; i < 300; i++) {
    await window.Store.saveProfile({ weight: 70 + (i % 30) });
  }
});
await p.waitForTimeout(400);
const dt = Date.now() - t0;
const adds1 = await p.evaluate(() => window.__adds);

ok('300 записів: 0 нових слухачів на постійних вузлах', (adds1 - adds0) === 0,
   'нових слухачів = ' + (adds1 - adds0));
ok('300 записів не зависли (< 20 с)', dt < 20000, dt + ' мс');

/* ------------------------------------------------------------------ */
/* 2. Форма лишилась живою й показує останнє значення                   */
/* ------------------------------------------------------------------ */
await p.waitForTimeout(300);
const shown = await p.evaluate(() => {
  const el = document.querySelector('#profile [data-p="weight"]');
  return el ? String(el.value) : null;
});
const saved = await p.evaluate(async () => (await window.Store.getProfile()).weight);
ok('поле ваги перемалювалось під збережене значення', Number(shown) === Number(saved),
   'у полі ' + shown + ', у профілі ' + saved);

/* ------------------------------------------------------------------ */
/* 3. Шторм кліків по перемикачах форми                                 */
/* ------------------------------------------------------------------ */
{
  const segs = await p.$$eval('#profile .seg__item input[type="radio"]',
    els => els.map(e => e.name + '::' + e.value));
  ok('у формі є перемикачі-сегменти', segs.length >= 2, segs.length + ' штук');

  const adds2 = await p.evaluate(() => window.__adds);
  const t1 = Date.now();
  for (let i = 0; i < 120 && segs.length; i++) {
    const [name, value] = segs[i % segs.length].split('::');
    await p.evaluate(([n, v]) => {
      const el = document.querySelector('#profile input[name="' + n + '"][value="' + v + '"]');
      if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }, [name, value]);
  }
  await p.waitForTimeout(500);
  const adds3 = await p.evaluate(() => window.__adds);
  ok('шторм 120 перемикань: 0 нових слухачів', (adds3 - adds2) === 0,
     'нових слухачів = ' + (adds3 - adds2));
  ok('шторм 120 перемикань не завис (< 20 с)', Date.now() - t1 < 20000, (Date.now() - t1) + ' мс');
}

ok('без JS-помилок за весь шторм', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' chaos-перевірок пройшло.');
process.exit(bad ? 1 : 0);
