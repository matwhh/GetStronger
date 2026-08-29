/**
 * Щоденний цикл: відкрив → побачив стан → зробив → стан оновився.
 *
 * Стереже головне, заради чого Home і «Сьогодні» звели в один екран:
 * після будь-якої дії число на головній має змінитись САМЕ, без переходів
 * і без ручного оновлення — бо джерело в них одне.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const SEED = {
  birthDate: '1990-06-15', sex: 'male', age: 30, height: 180, weight: 82.4, activity: 1.55, goal: 'cut', meals: 4,
  daysPerWeek: 3, activePlan: { programId: 'fullbody', days: 3 }, trainingAge: 'inter'
};

async function open(vp, extra) {
  const ctx = await adultContext(b, vp || { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, extra);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async s => { await window.Store.saveProfile(s); }, SEED);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  return { ctx, p, errs };
}

const cardText = (p, sel) => p.locator(sel).innerText();
const tap = async (l) => { await l.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {}); return l.click({ timeout: 6000 }); };

/* ---- Flow 1: відкрив → стан → пріоритети → дія → стан оновився ---- */
{
  const { ctx, p, errs } = await open();

  ok('1. на головній є картка сезону',
     /Сезон/.test(await cardText(p, '#today .card--rating')));
  ok('1. головна відповідає «що робити» — картка-вхід у тренування',
     await p.locator('#tdy-training').count() === 1 &&
     await p.locator('#today .tdy-ex').count() === 0);
  ok('1. головна відповідає «куди веде» — підсумок тижня',
     /Тиждень/.test(await p.locator('#today').innerText()));

  /* Дія живе на своєму екрані; головна має показати її результат одразу
     після повернення — це і є замикання циклу. */
  const before = await p.locator('#tdy-training').innerText();
  await tap(p.locator('#tdy-training'));
  await p.waitForTimeout(1300);
  await tap(p.locator('#workout .tdy-ex__main').first());
  await p.waitForTimeout(2400);
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const after = await p.locator('#tdy-training').innerText();
  ok('1. галочка змінила стан на головній', before !== after,
     after.replace(/\n+/g, ' | '));
  ok('1. рухалась смуга тренування, а не рейтингу',
     await p.evaluate(() => {
       const w = document.getElementById('tdy-bar').style.width;
       return w && w !== '0%';
     }));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- Flow 2: сезонний ELO у локальному режимі чесно вимкнений ---- */
{
  /* Саме локальний контекст: у репозиторії лежать справжні ключі Supabase,
     тож без окремого гасіння цей потік міряв би хмарний режим і мовчки
     перевіряв не те. adultContext({local:true}) гасить ключі до того, як
     їх прочитає store.js. */
  const { ctx, p, errs } = await open(null, { local: true });
  /* Без ключів Supabase сезонний рейтинг не існує: картка пояснює це,
     бейдж у шапці не зʼявляється, локального сурогата немає. */
  ok('2. картка сезону чесно каже про локальний режим',
     /локальному режимі/.test(await cardText(p, '#today .card--rating')));
  ok('2. бейдж рівня прихований — рахувати нема кому',
     await p.locator('.nav__rating').isHidden());

  await p.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  ok('2. сторінка сезону пояснює локальний режим',
     /локальному режимі/.test(await p.locator('#sz-header').innerText()));
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- Flow 3: харчування → збереження → головна ---- */
{
  const { ctx, p, errs } = await open();
  /* Плитки харчування на головній більше немає — над ними стоїть повна
     картка «Харчування» з тими самими числами (js/today.js, tilesStrip).
     Дивимось саме на неї: у смужці плиток тепер вага й трекери, і вона
     після додавання їжі закономірно не змінюється. */
  const kcalCard = () => p.evaluate(() => {
    const c = [...document.querySelectorAll('#today .card')]
      .find(x => /набрано, ккал/i.test(x.innerText));   // innerText приходить у CAPS через text-transform
    return c ? c.innerText : '';
  });
  const before = await kcalCard();
  ok('3. до їжі картка харчування показує 0 набраних', /\b0\b/.test(before),
     before.replace(/\n+/g, ' | ').slice(0, 60));

  await p.goto('file://' + ROOT + '/meals.html', { waitUntil: 'load' });
  await p.waitForTimeout(1100);
  await p.locator('#d-quick').fill('рис');
  await p.waitForTimeout(700);
  await tap(p.locator('.quick-list__item').first());
  await p.waitForTimeout(500);
  await tap(p.locator('#m-add'));
  await p.waitForTimeout(900);

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const after = await kcalCard();
  ok('3. головна показує зʼїдене без жодного налаштування', after !== before && after !== '',
     after.replace(/\n+/g, ' | ').slice(0, 70));
  ok('3. і картка «Харчування» на головній теж',
     /\d/.test(await p.locator('#today').innerText()));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- Flow 4: відновлення (трекер) → головна ---- */
{
  const { ctx, p, errs } = await open();
  const before = await cardText(p, '#today .tiles');

  const water = p.locator('#today [data-trk-add]').first();
  if (await water.count()) {
    await tap(water);
  } else {
    await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
    await p.waitForTimeout(1100);
    const row = p.locator('.tr-row', { hasText: 'Вода' }).first();
    await tap(row.locator('[data-expand]').first());
    await p.waitForTimeout(400);
    await tap(row.locator('[data-add]').first());
  }
  await p.waitForTimeout(900);
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const after = await cardText(p, '#today .tiles');
  ok('4. відмічений трекер видно на головній', after !== before,
     after.replace(/\n+/g, ' | ').slice(0, 70));
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- Flow 5: перезавантаження не втрачає стан ---- */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#workout .tdy-ex__main').first());
  await p.waitForTimeout(2400);
  const wt = p.locator('[data-wt]').first();
  const nm = await wt.getAttribute('data-wt');
  await wt.fill('73,5'); await wt.blur();
  await p.waitForTimeout(900);
  const doneBefore = await p.locator('#wk-done').innerText();

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1400);
  ok('5. галочка пережила перезавантаження',
     await p.locator('#wk-done').innerText() === doneBefore, doneBefore);
  const w = await p.evaluate(async n => (await window.Store.getProfile()).weights[n], nm);
  ok('5. робоча вага пережила перезавантаження', w === 73.5, 'w=' + w);
  /* Значення полів у innerText не потрапляють — читаємо саме поле. */
  ok('5. вага показана з комою, а не крапкою',
     (await p.locator('[data-wt]').first().inputValue()) === '73,5',
     await p.locator('[data-wt]').first().inputValue());
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- Flow 6: мобільний екран придатний до вжитку ---- */
for (const w of [320, 390, 430]) {
  const { ctx, p, errs } = await open({ viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true });
  const m = await p.evaluate(() => {
    const bar = document.getElementById('tabbar');
    const items = [...(bar ? bar.querySelectorAll('.tabbar__item') : [])];
    const small = items.filter(a => { const r = a.getBoundingClientRect(); return r.height < 44; });
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      tabs: items.length,
      small: small.length,
      barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : null,
      vh: window.innerHeight,
      footerPad: parseInt(getComputedStyle(document.getElementById('site-footer')).paddingBottom, 10) || 0
    };
  });
  ok(w + 'px: без горизонтального переповнення', !m.overflow);
  ok(w + 'px: панель розділів на місці й у зоні пальця', m.tabs === 4 && m.barBottom === m.vh,
     m.tabs + ' пунктів, низ ' + m.barBottom + '/' + m.vh);
  ok(w + 'px: цілі дотику ≥ 44px', m.small === 0, m.small + ' дрібних');
  ok(w + 'px: футер не ховається під панеллю', m.footerPad >= 44, 'padding=' + m.footerPad);
  ok(w + 'px: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок щоденного циклу пройшло.');
process.exit(bad ? 1 : 0);
