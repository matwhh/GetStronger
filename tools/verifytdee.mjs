/**
 * Адаптивні витрати в живому браузері.
 *
 * Сценарій: людина місяць веде їжу й зважування. Формула каже, що її
 * підтримання ~2900, а по факту вона їла 2300 і майже не худла — отже
 * справжнє підтримання близьке до 2400. Сайт мусить це побачити,
 * сказати вголос і — якщо людина ввімкне перемикач — рахувати денну
 * ціль від виміряного числа, причому ОДНАКОВО на всіх сторінках.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

/* Профіль, для якого формула дає близько 2900 ккал підтримання. */
const SEED = {
  birthDate: '1990-06-15', sex: 'male', age: 36, height: 181, weight: 80,
  activity: 1.55, goal: 'maintain', meals: 4, daysPerWeek: 3, trainingAge: 'inter'
};

const MAINT = 2400;     // справжнє підтримання, яке заклали в ряд
const INTAKE = 2300;    // скільки «їли»

async function open(page, extra) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('**://fonts.gstatic.com/**', r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async (a) => {
    const D = window.DateCore;
    const today = D.todayKey();
    const bodyLog = {}, mealLog = {};
    const perDay = (a.intake - a.maint) / 7700;
    for (let i = 0; i < 28; i++) {
      const k = D.shiftKey(today, -(27 - i));
      bodyLog[k] = Math.round((80 + perDay * i) * 1000) / 1000;
      mealLog[k] = { kcal: a.intake, p: 150, f: 70, c: 250, target: 2500 };
    }
    await window.Store.saveProfile(Object.assign({}, a.seed, a.extra, {
      bodyLog: bodyLog, mealLog: mealLog
    }));
  }, { seed: SEED, extra: extra || {}, intake: INTAKE, maint: MAINT });
  await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  return { ctx, p, errs };
}

/* ---- 1. Картка бачить те, що сталось насправді ---- */
{
  const { ctx, p, errs } = await open('nutrition.html');
  const card = p.locator('#nutri-tdee');
  ok('1. картка виміряних витрат зʼявилась', await card.locator('.card').count() === 1,
    String(await card.locator('.card').count()));

  const txt = await card.innerText();
  const measured = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return window.TdeeCore.measure(pr.bodyLog, pr.mealLog, 28);
  });
  ok('1. виміряне підтримання близьке до закладеного',
    Math.abs(measured.kcal - 2400) <= 40, JSON.stringify(measured));
  ok('1. картка показує це число', txt.replace(/\s/g, '').includes(String(measured.kcal)),
    txt.replace(/\n+/g, ' | ').slice(0, 220));
  ok('1. картка показує смугу, а не одне число',
    /смуга/i.test(txt), txt.replace(/\n+/g, ' | ').slice(0, 220));
  ok('1. картка називає різницю з формулою', /Формула на цих даних дає/.test(txt),
    txt.replace(/\n+/g, ' | ').slice(0, 260));
  /* Знак мінуса — типографський «−», а не дефіс із клавіатури: у
     проєкті один спосіб писати знак числа (App.fmtNum.signed). */
  ok('1. відʼємні числа з правильним мінусом',
    /−/.test(txt) && !/\s-\d/.test(txt), txt.replace(/\n+/g, ' | ').slice(0, 260));
  ok('1. перемикач вимкнений за замовчуванням',
    !(await card.locator('[data-tdee-mode]').isChecked()));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Перемикач міняє ціль — і на інших сторінках теж ---- */
{
  const { ctx, p, errs } = await open('nutrition.html');
  const before = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return Math.round(window.NutritionCalc.targetFor(pr).kcal);
  });

  await p.locator('#nutri-tdee [data-tdee-mode]').click();
  await p.waitForTimeout(900);

  const saved = await p.evaluate(async () => (await window.Store.getProfile()).tdeeMode);
  ok('2. режим зберігся в профіль', saved === 'measured', String(saved));

  const after = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return Math.round(window.NutritionCalc.targetFor(pr).kcal);
  });
  ok('2. ціль поїхала за виміряним числом', Math.abs(after - before) > 300,
    'було ' + before + ', стало ' + after);
  ok('2. нова ціль близька до виміряного підтримання (ціль — «підтримання»)',
    Math.abs(after - 2400) <= 60, String(after));

  /* Та сама ціль мусить бути й там, де людина її реально бачить щодня. */
  await p.goto('file://' + ROOT + '/meals.html', { waitUntil: 'load' });
  await p.waitForTimeout(1600);
  const onMeals = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return Math.round(window.NutritionCalc.targetFor(pr).kcal);
  });
  ok('2. «Харчування» показує ту саму ціль', onMeals === after,
    onMeals + ' проти ' + after);
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Без даних режим тихо падає на формулу ---- */
{
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('**://fonts.gstatic.com/**', r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async (s) => {
    await window.Store.saveProfile(Object.assign({}, s, { tdeeMode: 'measured' }));
  }, SEED);
  await p.goto('file://' + ROOT + '/nutrition.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  const both = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const withMode = window.NutritionCalc.targetFor(pr);
    const plain = window.NutritionCalc.targetFor(Object.assign({}, pr, { tdeeMode: null }));
    return { a: Math.round(withMode.kcal), b: Math.round(plain.kcal), measured: withMode.measured };
  });
  ok('3. без журналів ціль та сама, що за формулою', both.a === both.b, JSON.stringify(both));
  ok('3. і ніщо не вдає, що вимірювання було', both.measured === null, JSON.stringify(both.measured));
  ok('3. картки з числами немає', await p.locator('#nutri-tdee .kpi').count() === 0,
    String(await p.locator('#nutri-tdee .kpi').count()));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Симулятор «що якщо» ---- */
{
  const { ctx, p, errs } = await open('nutrition.html');
  const card = p.locator('#nutri-sim');
  ok('4. картка симулятора намалювалась', await card.locator('.card').count() === 1,
    String(await card.locator('.card').count()));

  const first = await card.locator('tbody tr').first().innerText();
  ok('4. у таблиці є горизонти', /місяц/.test(first), first.replace(/\n+/g, ' | '));

  /* Менше їжі — більше втрати ваги за той самий строк. Це найдешевша
     перевірка того, що важіль справді керує моделлю, а не малює. */
  /* Читаємо КОМІРКУ ваги останнього рядка, а не весь його текст: у
     тексті першим числом стоїть кількість місяців, і порівняння
     мовчки порівнювало б «12» з «12». */
  const readLast = async () => {
    const cells = card.locator('tbody tr').last().locator('td');
    return (await cells.nth(1).innerText()).trim();
  };
  await card.locator('[data-sim-kcal]').first().click();     // −500 від підтримання
  await p.waitForTimeout(400);
  const low = await readLast();
  await card.locator('[data-sim-kcal]').last().click();      // +500
  await p.waitForTimeout(400);
  const high = await readLast();
  const kgOf = (t) => {
    const m = t.replace(/−/g, '-').match(/-?\d+[.,]?\d*/);
    return m ? Number(m[0].replace(',', '.')) : NaN;
  };
  ok('4. менше їжі — менша вага через рік', kgOf(low) < kgOf(high),
    'на −500: ' + low.replace(/\n+/g, ' ') + ' | на +500: ' + high.replace(/\n+/g, ' '));

  /* Зайві тренування мусять зсунути витрати сценарію вгору. */
  const line = () => card.locator('p').filter({ hasText: 'Витрати за сценарієм' }).first().innerText();
  const before = await line();
  await card.locator('input[name="sim-ses"][value="2"]')
    .evaluate(e => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(400);
  const after = await line();
  ok('4. «+2 тренування» піднімають витрати сценарію', before !== after,
    before.replace(/\n+/g, ' ') + '  →  ' + after.replace(/\n+/g, ' '));
  ok('4. і картка каже, скільки коштує тренування',
    /ккал понад спокій/.test(await card.innerText()),
    (await card.innerText()).replace(/\n+/g, ' | ').slice(0, 240));
  /* Крапка в дробовому числі — чужа: на сайті всюди кома
     (App.fmtNum). Найлегше пропустити саме тут, бо round() віддає
     число, і воно друкується як є. */
  const simTxt = await card.innerText();
  ok('4. дробові числа з комою, а не з крапкою', !/\d+\.\d/.test(simTxt),
    (simTxt.match(/\S*\d+\.\d\S*/g) || []).join(' '));
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок адаптивних витрат пройшло.');
process.exit(bad ? 1 : 0);
