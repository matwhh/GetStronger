/**
 * Щоденний цикл: відкрив → побачив стан → зробив → стан оновився.
 *
 * Стереже головне: після будь-якої дії стан оновлюється САМ, без ручного
 * оновлення сторінки — бо джерело в екранів одне.
 *
 * ЩО ЗМІНИЛОСЬ. Раніше кожен потік закінчувався поверненням на «Сьогодні»
 * й звіркою числа там: головна переказувала стан усіх розділів. Екран
 * перебрано — на ньому лишились назва програми, сезон і смуга тижня, —
 * тож звірка переїхала туди, де стан тепер живе: тренування на
 * workout.html, їжа на meals.html, трекери на trackers.html. Питання те
 * саме, місце інше.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

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

  const home = await p.locator('#today').innerText();
  ok('1. головна називає програму й сезон', /Full Body/.test(home) && /Сезон/.test(home),
     home.replace(/\n+/g, ' | ').slice(0, 60));
  ok('1. головна показує тиждень', /Тиждень/.test(home));
  ok('1. головна не редагує тренування', await p.locator('#today .tdy-ex').count() === 0);

  /* Дія живе на своєму екрані, і стан там оновлюється сам. */
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const before = await p.locator('#wk-done').innerText();
  await tap(p.locator('#workout .tdy-ex [data-set-n="1"]').first());
  await p.waitForTimeout(2400);
  const after = await p.locator('#wk-done').innerText();
  ok('1. галочка змінила лічильник підходів', before !== after, before + ' → ' + after);
  ok('1. рухалась смуга тренування',
     await p.evaluate(() => {
       const w = document.getElementById('wk-bar').style.width;
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
  /* Картку сезону з головної прибрано разом з рештою екрана; пояснення
     локального режиму лишилось там, де воно й потрібне — на сторінці
     сезону, і саме її перевіряємо нижче. */
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
  /* Харчування з головної прибране — дивимось на самому «Раціоні»:
     скільки набрано до їжі й скільки після. */
  await p.goto('file://' + ROOT + '/meals.html', { waitUntil: 'load' });
  await p.waitForTimeout(1100);
  const kcalCard = () => p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return JSON.stringify((pr.day && pr.day.meals || []).flatMap(m => m.items || []).length);
  });
  const before = await kcalCard();
  ok('3. до їжі в дні порожньо', before === '0', before);
  await p.locator('#d-quick').fill('рис');
  await p.waitForTimeout(700);
  await tap(p.locator('.quick-list__item').first());
  await p.waitForTimeout(500);
  await tap(p.locator('#m-add'));
  await p.waitForTimeout(900);

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const after = await kcalCard();
  ok('3. зʼїдене лишилось у дні без жодного налаштування', after !== before && after !== '0', after);
  ok('3. «Раціон» показує його числом', /\d/.test(await p.locator('main').innerText()));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- Flow 4: відновлення (трекер) → головна ---- */
{
  const { ctx, p, errs } = await open();
  /* Плиток трекерів на головній більше немає — відмічаємо й звіряємо на
     сторінці трекерів, тобто там, де це тепер і робиться. */
  const logged = () => p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const k = window.TrackerCore.todayKey();
    return String((pr.trackerLog && pr.trackerLog.water || {})[k]);
  });
  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const before = await logged();
  await tap(p.locator('#trk-day [data-trk-add]').first());
  await p.waitForTimeout(900);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const after = await logged();
  ok('4. відмічений трекер пережив перезавантаження', after !== before && after !== 'undefined',
     before + ' → ' + after);
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- Flow 5: перезавантаження не втрачає стан ---- */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#workout .tdy-ex [data-set-n="1"]').first());
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
      barBottom: bar ? Math.round(bar.querySelector('.tabbar__bar').getBoundingClientRect().bottom) : null,
      vh: window.innerHeight,
      footerPad: parseInt(getComputedStyle(document.getElementById('site-footer')).paddingBottom, 10) || 0
    };
  });
  ok(w + 'px: без горизонтального переповнення', !m.overflow);
  /* Панель більше не приклеєна до низу: вона пливе капсулою з відступом,
     як таб-бар iOS. Тому не «низ = висота вікна», а «низ у зоні пальця»:
     від краю не далі 40 px і не впритул. */
  ok(w + 'px: панель розділів на місці й у зоні пальця',
     m.tabs === 4 && m.vh - m.barBottom >= 8 && m.vh - m.barBottom <= 40,
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
