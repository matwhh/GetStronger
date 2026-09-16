/**
 * Профіль залу в живому браузері: ввід, збереження і — головне — вплив
 * на числа, які людина бачить у залі.
 *
 * Сценарій, заради якого все: у залі немає млинців по 1,25 і 2,5.
 * Найменша добавка до штанги — пара пʼятірок, тобто 10 кг. Сайт мусить
 * перестати показувати розминкові сходинки, яких не зібрати, і сказати
 * чесний крок у вікні робочої ваги.
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

async function open(page, extra) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('**://fonts.gstatic.com/**', r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async s => { await window.Store.saveProfile(s); }, Object.assign({}, SEED, extra || {}));
  await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  return { ctx, p, errs };
}

/* ---- 1. Картка є, типовий набір заповнює й показує драбину ---- */
{
  const { ctx, p, errs } = await open('plan.html');
  const card = p.locator('#gym-profile');
  ok('1. картка профілю залу намалювалась', await card.locator('.card').count() === 1,
    String(await card.locator('.card').count()));

  /* Млинець 1,25 мусить підписуватись саме так. Загальний формат ваги
     округлює до десятої й писав «1,3 кг» — млинця з таким числом на
     чавуні не існує, і в наборі його не впізнати. */
  const labels = await card.locator('.field__label').evaluateAll(es => es.map(e => e.textContent.trim()));
  ok('1. номінал 1,25 підписаний повністю', labels.indexOf('1,25 кг') >= 0, JSON.stringify(labels));

  const pre0 = await card.locator('[data-gym-prev]').innerText();
  ok('1. порожній профіль чесно каже, що нічого не змінює',
    /2,5 кг/.test(pre0) && /1 кг/.test(pre0), pre0.slice(0, 160));

  await card.locator('#gym-typical').click();
  await p.waitForTimeout(200);
  const pre1 = await card.locator('[data-gym-prev]').innerText();
  ok('1. типовий набір дає крок 2,5 і драбину від грифа',
    /Штанга: 20/.test(pre1) && /найменший крок 2,5/.test(pre1), pre1.slice(0, 200));

  await card.locator('#gym-save').click();
  await p.waitForTimeout(600);
  const saved = await p.evaluate(async () => (await window.Store.getProfile()).gym);
  ok('1. профіль зберігся в профіль користувача',
    saved && saved.bar === 20 && saved.plates.length === 7, JSON.stringify(saved));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Бідний зал: крок 10 кг, і сайт це визнає ---- */
{
  const POOR = { gym: { bar: 20, plates: [{ kg: 20, pairs: 2 }, { kg: 10, pairs: 2 }, { kg: 5, pairs: 2 }] } };
  const { ctx, p, errs } = await open('plan.html', POOR);
  const pre = await p.locator('#gym-profile [data-gym-prev]').innerText();
  ok('2. збережений профіль повернувся в поля', /найменший крок 10/.test(pre), pre.slice(0, 200));

  /* Ті самі дані — але тепер на сторінці тренування. */
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const I = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#workout .tdy-ex')];
    for (let i = 0; i < rows.length; i++) {
      const n = rows[i].querySelector('.tdy-ex__name');
      if (n && /штанг/i.test(n.textContent)) return i;
    }
    return -1;
  });
  ok('2. у плані знайшлась вправа зі штангою', I >= 0, 'рядок ' + I);

  await p.evaluate(async (i) => {
    const row = document.querySelectorAll('#workout .tdy-ex')[i];
    const name = row.querySelector('.tdy-ex__name').textContent.trim();
    const pr = await window.Store.getProfile();
    const w = Object.assign({}, pr.weights || {});
    w[name] = 100;
    await window.Store.saveProfile(Object.assign({}, pr, { weights: w }));
  }, I);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1400);

  const row = p.locator('#workout .tdy-ex').nth(I);
  const warm = await row.locator('.tdy-ex__meta, .tdy-meta, .tdy-ex').innerText();
  const nums = (warm.match(/(\d+(?:,\d+)?)×/g) || []);
  ok('2. рядок розминки є', nums.length > 0, warm.replace(/\n+/g, ' | ').slice(0, 200));

  /* Ядро — найнадійніше місце перевірити саму арифметику драбини. */
  const ladder = await p.evaluate(() => {
    const G = window.GymCore;
    const gym = G.normGym({ bar: 20, plates: [{ kg: 20, pairs: 2 }, { kg: 10, pairs: 2 }, { kg: 5, pairs: 2 }] });
    return window.WorkoutCore.warmupSets(100, function (kg) {
      return G.achievable(kg, 'barbell', gym);
    }, 3).map(x => x.kg);
  });
  ok('2. усі сходинки — ваги, які реально зібрати',
    ladder.every(v => Math.round((v - 20) * 100) % 1000 === 0), JSON.stringify(ladder));
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Порожній профіль нічого не міняє ---- */
{
  const { ctx, p, errs } = await open('workout.html');
  const same = await p.evaluate(() => {
    const WC = window.WorkoutCore;
    const old = WC.warmupSets(100, window.OneRM.PLATE_STEP, 3).map(x => x.kg).join(',');
    const G = window.GymCore;
    const gym = G.normGym(null);
    const now = WC.warmupSets(100, function (kg) { return G.achievable(kg, 'barbell', gym); }, 3)
      .map(x => x.kg).join(',');
    return { old: old, now: now };
  });
  ok('3. без профілю сходинки ті самі, що були', same.old === same.now, JSON.stringify(same));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок профілю залу пройшло.');
process.exit(bad ? 1 : 0);
