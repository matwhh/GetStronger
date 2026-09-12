/**
 * Креатин моногідрат з коробки + дози в грамах.
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
const tap = async (l) => { await l.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {}); return l.click({ timeout: 6000 }); };
const fill = async (el, v) => { await el.fill(String(v)); await el.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true }))); };
const creat = (p) => p.evaluate(async () => {
  const pr = await window.Store.getProfile();
  return ((pr.trackerLog || {}).creatine || {})[window.TrackerCore.todayKey()];
});

/* ---- 1. Кубик креатину на «Сьогодні»: галочка = 5 г, поле = скільки випив ---- */
/*
 * ПЕРЕЇХАЛО. Раніше це була окрема сторінка вводу (#trk-day). Її більше
 * немає: ввід — кубик на «Сьогодні», «Трекери» стали налаштуваннями.
 * Питання ті самі, місце інше.
 */
{
  const { ctx, p, errs } = await open('index.html');
  await p.evaluate(async () => {
    const T = window.TrackerCore;
    const tr = T.setPinned(T.ensureBuiltins({}), 'creatine', true);
    try { await window.Store.saveProfile({ trackers: tr }); } catch (e) { if (!e.queued) throw e; }
  });
  await p.waitForTimeout(900);
  const row = p.locator('#today [data-trk-tile="creatine"]').first();
  ok('1. креатин моногідрат є в добавках з коробки', await row.count() === 1);
  const dose = row.locator('[data-trk-dose]');
  ok('1. є поле грамів', await dose.count() === 1);
  ok('1. підказка в полі — типова доза 5', (await dose.getAttribute('placeholder')) === '5');

  await tap(row.locator('input[type=checkbox]').locator('xpath=..'));
  await p.waitForTimeout(500);
  ok('1. галочка пише типову дозу 5 г', (await creat(p)) === 5, String(await creat(p)));

  await fill(p.locator('#today [data-trk-dose="creatine"]'), '7,5');
  await p.waitForTimeout(600);
  ok('1. вписані 7,5 г записались', (await creat(p)) === 7.5, String(await creat(p)));
  ok('1. галочка стоїть', await p.locator('#today [data-trk-mark="creatine"]').isChecked());

  await fill(p.locator('#today [data-trk-dose="creatine"]'), '');
  await p.waitForTimeout(600);
  ok('1. порожнє поле = не приймав', (await creat(p)) === undefined, String(await creat(p)));
  ok('1. галочка знята', !(await p.locator('#today [data-trk-mark="creatine"]').isChecked()));

  await fill(p.locator('#today [data-trk-dose="creatine"]'), '900');
  await p.waitForTimeout(600);
  ok('1. 900 г не проходить', (await creat(p)) === undefined, String(await creat(p)));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Налаштування: доза змінюється, нова добавка з дозою ---- */
{
  const { ctx, p, errs } = await open('trackers.html');
  const row = p.locator('#tr-supplements .tr-row', { hasText: 'Креатин' }).first();
  ok('2. креатин у налаштуваннях з дозою 5', (await row.locator('[data-dose-set]').inputValue()) === '5');
  await fill(row.locator('[data-dose-set]'), '3');
  await p.waitForTimeout(600);
  const d = await p.evaluate(async () => (await window.Store.getProfile()).trackers.creatine.settings.dose);
  ok('2. типова доза змінена на 3', d === 3, String(d));

  await p.locator('#add-supplement').fill('Омега-3');
  await p.locator('#add-supplement-dose').fill('2');
  await tap(p.locator('[data-add-custom="supplement"]'));
  await p.waitForTimeout(600);
  const om = await p.evaluate(async () => {
    const t = (await window.Store.getProfile()).trackers;
    const x = Object.values(t).find(v => v.name === 'Омега-3');
    return x && x.settings && x.settings.dose;
  });
  ok('2. власна добавка з дозою 2 г', om === 2, String(om));

  /* Відмічають тепер на «Сьогодні», кубиком. Закріплюємо його явно —
     типово нічого не закріплено, і кубика на екрані просто не було б. */
  await p.evaluate(async () => {
    const T = window.TrackerCore;
    const pr = await window.Store.getProfile();
    const tr = T.setPinned(T.ensureBuiltins(pr.trackers), 'creatine', true);
    try { await window.Store.saveProfile({ trackers: tr }); } catch (e) { if (!e.queued) throw e; }
  });
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#today [data-trk-mark="creatine"]').locator('xpath=..'));
  await p.waitForTimeout(500);
  ok('2. галочка тепер пише 3 г', (await creat(p)) === 3, String(await creat(p)));
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Легасі: старий запис true лічиться як прийнято ---- */
{
  const { ctx, p, errs } = await open('index.html');
  await p.evaluate(async () => {
    const T = window.TrackerCore;
    const k = T.todayKey();
    const log = { creatine: {} }; log.creatine[k] = true;
    const tr = T.setPinned(T.ensureBuiltins({}), 'creatine', true);
    await window.Store.saveProfile({ trackerLog: log, trackers: tr });
  });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1300);
  ok('3. true показує галочку', await p.locator('#today [data-trk-mark="creatine"]').isChecked());
  await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const txt = await p.locator('#jr-trackers').innerText().catch(() => '');
  ok('3. прогрес рахує креатин у відсотках', /креатин/i.test(txt) && /%/.test(txt), txt.replace(/\n+/g, ' | ').slice(0, 160));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок креатину пройшло.');
process.exit(bad ? 1 : 0);
