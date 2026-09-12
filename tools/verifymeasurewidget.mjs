/**
 * ЗАМІРИ ТІЛА НА ГОЛОВНІЙ — реальний браузер.
 *
 * Юніти стережуть числа, а тут — те, чого вони не бачать: що картка
 * взагалі дійшла до екрана, веде куди треба й не ламає верстку на
 * телефоні. Приводом був цілком робочий модуль, який не був підключений
 * у index.html: тести зелені, на екрані нічого.
 *
 * Запуск: node tools/verifymeasurewidget.mjs
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const BASE = {
  birthDate: '1990-06-15', sex: 'male', age: 36, height: 180, weight: 82,
  activity: 1.55, trainingAge: 'inter', daysPerWeek: 3,
  activePlan: { programId: 'fullbody', days: 3 }, programId: 'fullbody'
};

/* Ключ дня в тому ж вигляді, що й у застосунку. */
const key = (shiftDays) => {
  const d = new Date();
  d.setDate(d.getDate() - shiftDays);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
};

async function home(ctx, measureLog) {
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async (prof) => { await window.Store.saveProfile(prof); },
    Object.assign({}, BASE, { measureLog: measureLog }));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  return p;
}

const ctx = await adultContext(b, { viewport: { width: 1100, height: 900 } });
const errs = [];

/* ---- 1. Є заміри: картка показує стан ---- */
{
  const p = await home(ctx, {
    [key(40)]: { waist: 86, chest: 100, bicepsR: 38 },
    [key(9)]:  { waist: 84.5, chest: 101, bicepsR: 38.6 }
  });
  p.on('pageerror', (e) => errs.push(e.message));

  ok('1. картка замірів є на головній', (await p.locator('#today .mez').count()) === 1);
  const t = await p.locator('#today .mez').innerText();
  ok('2. названа людською мовою', /Заміри тіла/.test(t), t.split('\n')[0]);
  ok('3. каже, коли міряли востаннє', /9 днів тому/.test(t), t.replace(/\n/g, ' | ').slice(0, 90));
  ok('4. показує саме останнє значення, а не перше', /84,5/.test(t) && !/\b86\b/.test(t), t.replace(/\n/g, ' '));
  ok('5. показує зміну від попереднього заміру', /−1,5/.test(t));
  ok('6. і зростання теж, зі знаком плюс', /\+1\b/.test(t) || /\+0,6/.test(t), t.replace(/\n/g, ' '));
  /* Десяткова кома, як і скрізь у проєкті. */
  ok('7. числа з комою, а не з крапкою', !/\d\.\d/.test(t), t.replace(/\n/g, ' '));
  ok('8. веде на сторінку замірів',
     (await p.locator('#today .mez').getAttribute('href')) === 'measure.html');
  /* Головна показує стан, а не редагує: полів введення тут бути не може. */
  ok('9. картка нічого не вводить', (await p.locator('#today .mez input').count()) === 0);
  ok('10. поки не час — нагадування немає',
     (await p.locator('#today .mez.is-stale').count()) === 0);
  await p.close();
}

/* ---- 2. Давно не міряли ---- */
{
  const p = await home(ctx, { [key(30)]: { waist: 84 } });
  const t = await p.locator('#today .mez').innerText();
  ok('11. через три тижні картка нагадує', (await p.locator('#today .mez.is-stale').count()) === 1);
  ok('12. і каже це словами, а не кольором', /час зміряти/.test(t), t.replace(/\n/g, ' | '));
  await p.close();
}

/* ---- 3. Жодного заміру ---- */
{
  const p = await home(ctx, {});
  ok('13. новачкові картка теж показана', (await p.locator('#today .mez').count()) === 1);
  const t = await p.locator('#today .mez').innerText();
  ok('14. пояснює, навіщо це', /ще не робили/.test(t) && /зміну форми/.test(t),
     t.replace(/\n/g, ' | '));
  ok('15. і кличе зробити перший', /перший замір/.test(t));
  ok('16. без вигаданих чисел', (await p.locator('#today .mez .mez__num').count()) === 0);
  await p.close();
}

/* ---- 4. Телефон ---- */
{
  const m = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await home(m, { [key(3)]: { waist: 84.5, chest: 101, bicepsR: 38.6 } });
  const box = await p.locator('#today .mez').boundingBox();
  ok('17. картка вміщається в екран', box && box.width <= 390, box ? Math.round(box.width) + 'px' : '—');
  const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('18. і не тягне сторінку вбік', over === false);
  ok('19. усі три параметри лишились видимі',
     (await p.locator('#today .mez .mez__item').count()) === 3);
  await p.close();
  await m.close();
}

ok('20. без JS-помилок', errs.length === 0, errs.join(' | '));

await ctx.close();
await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок замірів на головній пройшло.');
process.exit(bad ? 1 : 0);
