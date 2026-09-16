/**
 * Адмінка: три вкладки, і завжди рівно одна панель на екрані.
 *
 * ЩО ТУТ СТЕРЕЖЕТЬСЯ. Видимість панелей доти крутила js/admin-elo.js, і
 * знала вона рівно дві: «ELO» показати, «заявки» сховати. Третя вкладка
 * («Розклад») у такій схемі відкривалась БІЛЯ заявок — обидві панелі
 * одночасно, бо про неї той обробник не знав нічого.
 *
 * Жоден юніт цього не побачить: панелі ховаються атрибутом hidden у
 * живому DOM, і без сторінки перевіряти нічого. Тому перевірка
 * браузерна — і ганяє саме те, що бачить людина.
 *
 * Мережі не потребує: адмінські RPC із file:// однаково недосяжні, а
 * перемикання вкладок від сервера не залежить.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 1280, height: 950 } });
const p = await ctx.newPage();

await p.goto('file://' + ROOT + '/admin.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);

/* Скільки вкладок і скільки панелей — має бути порівну. */
{
  const m = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll('#adm-tabs input[name="adm-tab"]')].map(i => i.value),
    panes: [...document.querySelectorAll('[data-tab]')].map(d => d.dataset.tab)
  }));
  ok('кожна вкладка має свою панель',
     m.tabs.length === 3 && m.tabs.every(t => m.panes.includes(t)),
     JSON.stringify(m));
}

/* Головне: на кожній вкладці видно РІВНО ОДНУ панель. */
for (const tab of ['requests', 'elo', 'cron', 'requests']) {
  const m = await p.evaluate((t) => {
    const inp = document.querySelector('#adm-tabs input[value="' + t + '"]');
    inp.checked = true;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    const shown = [...document.querySelectorAll('[data-tab]')]
      .filter(d => !d.hidden).map(d => d.dataset.tab);
    return { shown };
  }, tab);
  ok('вкладка «' + tab + '»: видно рівно одну панель',
     m.shown.length === 1 && m.shown[0] === tab, JSON.stringify(m));
}

/* Панель розкладу має сказати щось людське навіть без сервера: на
   file:// хмара вимкнена, і мовчазна порожнеча читалась би як поламка. */
{
  await p.evaluate(() => {
    const inp = document.querySelector('#adm-tabs input[value="cron"]');
    inp.checked = true;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(900);
  const txt = (await p.textContent('#adm-cron')) || '';
  ok('панель розкладу не лишається порожньою', txt.trim().length > 0,
     txt.trim().slice(0, 60));
}

await b.close();
const bad = R.filter(([, c]) => !c).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок вкладок адмінки пройшло.');
process.exit(bad ? 1 : 0);
