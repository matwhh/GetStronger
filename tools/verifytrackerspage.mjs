/**
 * Трекери — окрема сторінка, налаштування — окрема.
 *
 * Стереже:
 *   • на «Сьогодні» блоку трекерів більше немає;
 *   • плитка «Трекери» веде на trackers.html (ввід), а не в налаштування;
 *   • на trackers.html праворуч угорі є «Налаштування» → trackers-settings.html;
 *   • ввід на новій сторінці зберігається й видно на плитці «Сьогодні»;
 *   • перемикач у налаштуваннях одразу міняє склад сторінки трекерів.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: CHROME });

async function open(page) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('**://fonts.gstatic.com/**', r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  return { ctx, p, errs };
}
const tap = async (l) => { await l.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {}); return l.click({ timeout: 6000, force: true }); };

/* ---- 1. «Сьогодні» без трекерів, плитка веде на ввід ---- */
{
  const { ctx, p, errs } = await open('index.html');
  ok('1. на «Сьогодні» немає рядків трекерів', await p.locator('#today .tdy-trk__row').count() === 0);
  ok('1. на «Сьогодні» немає шкал 1..10', await p.locator('#today .qi-scale').count() === 0);
  /* Плитки з «Сьогодні» прибрані разом з рештою екрана: сторінку перебрано
     до назви програми й смуги тижня. Вхід у трекери лишився один — пункт
     навігації, і його перевіряє verifylink. Тут лишається головне для
     ЦЬОГО набору: ввід трекерів на «Сьогодні» не живе. */
  ok('1. плиток стану на «Сьогодні» немає', await p.locator('#today .tile').count() === 0);
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Сторінка трекерів: ввід + «Налаштування» ---- */
{
  const { ctx, p, errs } = await open('trackers.html');
  ok('2. заголовок «Трекери»', /^Трекери$/.test((await p.locator('h1').first().innerText()).trim()));
  const st = p.locator('main a[href="trackers-settings.html"]').first();
  ok('2. є посилання «Налаштування» праворуч угорі', await st.count() === 1 && /Налаштування/.test(await st.innerText()));
  ok('2. рядки трекерів на місці', await p.locator('#trk-day .tdy-trk__row').count() >= 3,
    String(await p.locator('#trk-day .tdy-trk__row').count()));
  ok('2. тут немає перемикачів увімкнення (це не налаштування)',
    await p.locator('#trk-day [data-toggle]').count() === 0);

  await tap(p.locator('#trk-day [data-trk-add]').first());          // +0.25 води
  await tap(p.locator('#trk-day [data-trk-scale="mood"][data-val="7"]'));
  await p.waitForTimeout(600);
  const saved = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const k = window.TrackerCore.todayKey();
    return { water: (pr.trackerLog.water || {})[k], mood: (pr.trackerLog.mood || {})[k] };
  });
  ok('2. вода й настрій записались', saved.water === 0.25 && saved.mood === 7, JSON.stringify(saved));

  /* Раніше тут перевірялось, що плитка на «Сьогодні» показує «2 / N».
     Плиток більше немає (екран перебрано), тож питання переїхало туди, де
     воно тепер і має ставитись: чи бачить САМА сторінка трекерів свої
     дві позначки після перезавантаження. Це та сама суть — запис не
     загубився, — але на живому екрані, а не на прибраному. */
  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const again = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const k = window.TrackerCore.todayKey();
    return { water: (pr.trackerLog.water || {})[k], mood: (pr.trackerLog.mood || {})[k] };
  });
  ok('2. позначки живі після перезавантаження', again.water === 0.25 && again.mood === 7, JSON.stringify(again));
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Налаштування: вимкнув — зник зі сторінки трекерів ---- */
{
  const { ctx, p, errs } = await open('trackers-settings.html');
  ok('3. заголовок про налаштування', /Налаштування/.test(await p.locator('h1').first().innerText()));
  ok('3. є шлях назад до трекерів', await p.locator('main a[href="trackers.html"]').count() >= 1);
  const row = p.locator('.tr-row', { hasText: 'Настрій' }).first();
  await tap(row.locator('input[type=checkbox]').first().locator('xpath=..'));
  await p.waitForTimeout(700);
  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('3. вимкнений «Настрій» зник зі сторінки трекерів',
    await p.locator('#trk-day .tdy-trk__row', { hasText: 'Настрій' }).count() === 0);
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Порожній стан ---- */
{
  const { ctx, p, errs } = await open('trackers-settings.html');
  for (const name of ['Вода', 'Сон', 'Настрій', 'Recovery']) {
    const row = p.locator('.tr-row', { hasText: name }).first();
    if (await row.count()) { await tap(row.locator('input[type=checkbox]').first().locator('xpath=..')); await p.waitForTimeout(250); }
  }
  /* Креатин з коробки вимикається перемикачем у списку добавок */
  const cr = p.locator('#tr-supplements [data-toggle="creatine"]').first();
  if (await cr.count()) { await cr.evaluate(e => { e.checked = false; e.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(400); }
  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('4. порожній стан веде в налаштування',
    await p.locator('#trk-day a[href="trackers-settings.html"]').count() === 1);
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок сторінки трекерів пройшло.');
process.exit(bad ? 1 : 0);
