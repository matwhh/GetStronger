/**
 * Вага належить ПІДХОДУ — реальний браузер, реальні тапи.
 *
 * Головний сценарій (живий баг до цього релізу): перший підхід на 100,
 * далі людина міняє робочу вагу на 90 і добиває — у знімок сесії лягало
 * «усі підходи по 90». Тепер має лягти 100/90/90.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const SEED = {
  birthDate: '1990-06-15', sex: 'male', age: 31, height: 181, weight: 81.4,
  activity: 1.55, goal: 'cut', meals: 4, daysPerWeek: 3,
  activePlan: { programId: 'fullbody', days: 3 }, trainingAge: 'inter'
};

async function open(extra) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('**://fonts.gstatic.com/**', r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async s => { await window.Store.saveProfile(s); }, Object.assign({}, SEED, extra || {}));
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  return { ctx, p, errs };
}

const tap = async (l) => {
  await l.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {});
  return l.click({ timeout: 6000 });
};
/* Індекс першої вправи з потрібною кількістю запланованих підходів:
   у Full Body перша вправа буває на 2 підходи, а сценаріям треба 3+. */
async function pickRow(p, min) {
  const idx = await p.evaluate((m) => {
    const rows = [...document.querySelectorAll('#workout .tdy-ex')];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].querySelectorAll('[data-set-n]').length >= m) return i;
    }
    return -1;
  }, min);
  return idx;
}

/* Робоча вага вправи i */
const setWorkWeight = async (p, kg, i) => {
  const f = p.locator('#workout [data-wt]').nth(i || 0);
  await f.fill(String(kg));
  await f.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
  await p.waitForTimeout(120);
};
const dayState = (p) => p.evaluate(() => {
  try { return JSON.parse(localStorage.getItem(window.WorkoutCore.LS_TODAY)); } catch (_) { return null; }
});
const snapshot = (p) => p.evaluate(async () => {
  const log = ((await window.Store.getProfile()) || {}).sessionLog || {};
  const k = window.WorkoutCore.todayKey();
  return log[k] || null;
});

/* ---- 1. Дроп-сет: тап фіксує вагу тієї миті ---- */
{
  const { ctx, p, errs } = await open();
  const I = await pickRow(p, 3);
  const pips = p.locator('#workout .tdy-ex').nth(I).locator('[data-set-n]');
  const n = await pips.count();
  ok('1. підходи є кнопками', I >= 0 && n >= 3, n + ' кнопок, рядок ' + I);

  await setWorkWeight(p, 100, I);
  await tap(pips.nth(0));                 // підхід 1 на 100
  await setWorkWeight(p, 90, I);          // вагу впустили
  await tap(pips.nth(1));                 // підхід 2 на 90
  await tap(pips.nth(2));                 // підхід 3 на 90
  await p.waitForTimeout(200);

  const st = await dayState(p);
  const list = (st && st.done && st.done[I]) || [];
  const sig = Array.isArray(list) ? list.map(x => x.w).join(',') : String(list);
  ok('1. денний стан памʼятає 100,90,90', sig === '100,90,90', sig);

  await p.waitForTimeout(1800);           // дебаунс запису сесії
  const rec = await snapshot(p);
  const s0 = rec && Array.isArray(rec.ex) && rec.ex[I] && rec.ex[I].s;
  ok('1. знімок сесії має підходи поіменно', Array.isArray(s0) && s0.length === 3,
    JSON.stringify(s0));
  ok('1. знімок НЕ переписаний останньою вагою',
    Array.isArray(s0) && s0.map(x => x.w).join(',') === '100,90,90',
    Array.isArray(s0) ? s0.map(x => x.w).join(',') : '—');
  ok('1. kg рядка = найважчий фактичний підхід', rec && rec.ex[I].kg === 100, rec && rec.ex[I].kg);
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Розкривний журнал підходів і правка окремого ---- */
{
  const { ctx, p, errs } = await open();
  const I = await pickRow(p, 3);
  const row = p.locator('#workout .tdy-ex').nth(I);
  const tgl = row.locator('[data-log-tgl]');
  ok('2. кнопка журналу вимкнена, поки нема підходів', await tgl.isDisabled());

  await setWorkWeight(p, 80, I);
  await tap(row.locator('[data-set-n]').nth(1));   // закрили 1 і 2
  await p.waitForTimeout(150);
  ok('2. кнопка журналу ввімкнулась', !(await tgl.isDisabled()));

  const box = row.locator('[data-set-log]');
  ok('2. журнал згорнутий за замовчуванням', await box.isHidden());
  await tap(tgl);
  ok('2. журнал розгортається', await box.isVisible());
  ok('2. рядків рівно за кількістю закритих', await box.locator('.tdy-set').count() === 2,
    String(await box.locator('.tdy-set').count()));

  // правимо ДРУГИЙ підхід
  const w2 = box.locator('[data-setr]').nth(1);
  await w2.fill('5');
  await w2.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
  await p.waitForTimeout(200);
  let st = await dayState(p);
  ok('2. правка зачепила лише свій підхід',
    st.done[I][1].r === 5 && st.done[I][0].r !== 5,
    JSON.stringify(st.done[I]));

  // сміття у вазі — відкочується у полі
  const kg1 = box.locator('[data-setw]').nth(0);
  await kg1.fill('900');
  await kg1.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
  await p.waitForTimeout(200);
  st = await dayState(p);
  ok('2. вага поза межами не записується', st.done[I][0].w === 80, JSON.stringify(st.done[I][0]));
  ok('2. поле показує те, що записано', (await kg1.inputValue()).replace(',', '.') === '80',
    await kg1.inputValue());

  // третій тап дописує підхід, не чіпаючи журнал
  await tap(row.locator('[data-set-n]').nth(2));
  await p.waitForTimeout(150);
  ok('2. новий підхід дописано в журнал', await box.locator('.tdy-set').count() === 3,
    String(await box.locator('.tdy-set').count()));
  ok('2. журнал лишився розгорнутим', await box.isVisible());
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Перезавантаження зберігає підходи ---- */
{
  const { ctx, p, errs } = await open();
  const I = await pickRow(p, 3);
  const row = p.locator('#workout .tdy-ex').nth(I);
  await setWorkWeight(p, 60, I);
  await tap(row.locator('[data-set-n]').nth(0));
  await setWorkWeight(p, 70, I);
  await tap(row.locator('[data-set-n]').nth(1));
  await p.waitForTimeout(200);

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const row2 = p.locator('#workout .tdy-ex').nth(I);
  await tap(row2.locator('[data-log-tgl]'));
  const vals = await row2.locator('[data-setw]').evaluateAll(
    es => es.map(e => e.value.replace(',', '.')));
  ok('3. після reload підходи ті самі', vals.join(',') === '60,70', vals.join(','));
  ok('3. поле робочої ваги показує останню (70)',
    (await p.locator('#workout [data-wt]').nth(I).inputValue()).replace(',', '.') === '70');
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Відкат тапом ріже хвіст ---- */
{
  const { ctx, p, errs } = await open();
  const I = await pickRow(p, 3);
  const row = p.locator('#workout .tdy-ex').nth(I);
  await setWorkWeight(p, 50, I);
  await tap(row.locator('[data-set-n]').nth(2));   // 3 підходи
  await setWorkWeight(p, 55, I);
  await tap(row.locator('[data-set-n]').nth(2));   // відкат третього
  await p.waitForTimeout(200);
  const st = await dayState(p);
  ok('4. лишилось два підходи', st.done[I].length === 2, JSON.stringify(st.done[I]));
  ok('4. вага перших двох не змінилась', st.done[I].map(x => x.w).join(',') === '50,50',
    st.done[I].map(x => x.w).join(','));
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5. Легасі-день (число замість масиву) не ламається ---- */
{
  const { ctx, p, errs } = await open();
  const I = await pickRow(p, 3);
  await p.evaluate(async (i) => {
    const WC = window.WorkoutCore;
    const done = [];
    done[i] = 2;                          // стара форма: «два підходи»
    WC.writeDay(await window.Store.getProfile(), WC.todayKey(), 0, done);
  }, I);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const row = p.locator('#workout .tdy-ex').nth(I);
  const on = await row.locator('[data-set-n].is-on').count();
  ok('5. легасі-день читається як 2 закриті підходи', on === 2, String(on));
  await tap(row.locator('[data-set-n]').nth(2));
  await p.waitForTimeout(200);
  const st = await dayState(p);
  ok('5. дотик переводить у нову форму без втрат',
    Array.isArray(st.done[I]) && st.done[I].length === 3, JSON.stringify(st.done[I]));
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Швидкі тапи поспіль ---- */
{
  const { ctx, p, errs } = await open();
  const I = await pickRow(p, 3);
  const row = p.locator('#workout .tdy-ex').nth(I);
  await setWorkWeight(p, 40, I);
  const pips = row.locator('[data-set-n]');
  const n = await pips.count();
  for (let i = 0; i < n; i++) await pips.nth(i).click({ timeout: 6000, force: true });
  await p.waitForTimeout(300);
  const st = await dayState(p);
  ok('6. усі підходи закриті рівно один раз', st.done[I].length === n,
    st.done[I].length + ' з ' + n);
  ok('6. рядок позначено виконаним', await row.evaluate(e => e.classList.contains('is-done')));
  ok('6. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 7. Прогрес: перемикач підходів і рекорд з фактичного ---- */
{
  const { ctx, p, errs } = await open();
  const I = await pickRow(p, 3);
  const row = p.locator('#workout .tdy-ex').nth(I);
  const name = await row.locator('.tdy-ex__name').innerText();
  await setWorkWeight(p, 100, I);
  await tap(row.locator('[data-set-n]').nth(0));
  await setWorkWeight(p, 90, I);
  await tap(row.locator('[data-set-n]').nth(1));
  await tap(row.locator('[data-set-n]').nth(2));
  await p.waitForTimeout(2000);

  await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await p.waitForTimeout(1600);

  await p.selectOption('#ex-pick', name).catch(() => {});
  await p.waitForTimeout(400);
  const tabs = await p.locator('input[name="ex-set"]').count();
  ok('7. зʼявився перемикач підходів', tabs >= 4, tabs + ' варіантів');

  const prTxt = await p.locator('#jr-prs').innerText();
  ok('7. рекорд = найважчий фактичний підхід (100)', /100\s*кг/.test(prTxt),
    prTxt.replace(/\n+/g, ' | ').slice(0, 200));

  await p.locator('input[name="ex-set"][value="2"]')
    .evaluate(e => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(400);
  const exTxt = await p.locator('#jr-exercise').innerText();
  ok('7. підхід 2 показує 90 кг', /90/.test(exTxt) && /Показано лише підхід 2/.test(exTxt),
    exTxt.replace(/\n+/g, ' | ').slice(0, 260));
  ok('7. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок ваги підходів пройшло.');
process.exit(bad ? 1 : 0);
