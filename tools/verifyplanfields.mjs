/**
 * Поля робочої ваги в плані: перехід між полями НЕ згортає день.
 *
 * Баг, який це стереже: change летить на blur, а фокус на нове поле
 * встає вже після мікрозадач. Store.onChange питав document.activeElement
 * саме в цю щілину, бачив <body>, вважав що ніхто не набирає, і робив
 * повний refresh() — розмітка плану перебудовувалась, усі дні згорталися
 * (шаблон завжди віддає день закритим), а поле, куди людина щойно
 * тицьнула, зникало разом із ним.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

async function seeded(page, url) {
  await page.goto('file://' + ROOT + '/' + url, { waitUntil: 'load' });
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('ib.profile') || '{}');
    Object.assign(raw, { birthDate:'1990-06-15', weight: 81, height: 181, age: 31, sex: 'male', activity: 1.55,
      daysPerWeek: 6, programId: 'ppl', activePlan: { programId: 'ppl', days: 6 },
      /* Хоч одна вага мусить лишитись: без неї онбординг ще не пройдено
         і сторож відвернув би зі сторінки. Імʼя — поза планом ppl, щоб
         жодне поле не приходило передзаповненим. */
      weights: { 'Ходьба у гору': 1 } });
    localStorage.setItem('ib.profile', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1100);
}

const openCount = (page) => page.evaluate(() =>
  document.querySelectorAll('#plan .acc.is-open').length);

/* ---- 1. «Мій план»: клік із поля в поле ---- */
for (const url of ['plan.html', 'programs.html']) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await seeded(p, url);

  if (url === 'programs.html') {
    // на сторінці програм план треба спершу показати
    const pick = p.locator('#program-list [data-pick], #program-list button').first();
    if (await pick.count()) { await pick.click(); await p.waitForTimeout(800); }
  }

  const accs = p.locator('#plan .acc');
  const total = await accs.count();
  if (!total) { ok(url + ': план відрисувався', false, 'жодного дня'); await ctx.close(); continue; }

  // відкриваємо перший день, у якому є поля ваги
  let dayIdx = -1;
  for (let i = 0; i < total; i++) {
    if (await accs.nth(i).locator('input[data-act=weight]').count() > 1) { dayIdx = i; break; }
  }
  ok(url + ': знайдено день із полями ваги', dayIdx >= 0, 'день #' + dayIdx);
  if (dayIdx < 0) { await ctx.close(); continue; }

  await accs.nth(dayIdx).locator('.acc__head').click();
  await p.waitForTimeout(400);
  ok(url + ': день відкрився', await openCount(p) === 1);

  const ins = p.locator('#plan .acc.is-open input[data-act=weight]');
  await ins.nth(0).click();
  await ins.nth(0).fill('100');
  await p.waitForTimeout(150);

  // КЛЮЧОВИЙ КРОК: без Enter тиснемо в сусіднє поле
  await ins.nth(1).click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(900);

  ok(url + ': день лишився відкритим після переходу в сусіднє поле',
     await openCount(p) === 1, 'відкрито ' + await openCount(p));

  const focused = await p.evaluate(() => {
    const a = document.activeElement;
    return a && a.dataset ? (a.tagName + ' i=' + a.dataset.i) : String(a && a.tagName);
  });
  ok(url + ': фокус став у поле, по якому клацнули', /INPUT i=1/.test(focused), focused);

  // ланцюжок: заповнюємо ще два поля поспіль
  await ins.nth(1).fill('60');
  await ins.nth(2).click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);
  await ins.nth(2).fill('42.5');
  await ins.nth(0).click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(900);
  ok(url + ': день відкритий і після трьох полів поспіль', await openCount(p) === 1);

  const saved = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return pr.weights || {};
  });
  const vals = Object.values(saved).map(Number).sort((a, z) => a - z);
  ok(url + ': усі три ваги збережені', vals.length >= 3 && vals.includes(100) && vals.includes(60) && vals.includes(42.5),
     JSON.stringify(saved));

  ok(url + ': без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Клавіатура: Tab між полями теж не згортає ---- */
{
  const ctx = await adultContext(b, { viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await seeded(p, 'plan.html');
  const accs = p.locator('#plan .acc');
  let dayIdx = -1;
  const total = await accs.count();
  for (let i = 0; i < total; i++) {
    if (await accs.nth(i).locator('input[data-act=weight]').count() > 1) { dayIdx = i; break; }
  }
  await accs.nth(dayIdx).locator('.acc__head').click();
  await p.waitForTimeout(400);
  const ins = p.locator('#plan .acc.is-open input[data-act=weight]');
  await ins.nth(0).click();
  await p.keyboard.type('105');
  await p.keyboard.press('Tab');
  await p.waitForTimeout(900);
  ok('Tab із поля ваги не згортає день', await openCount(p) === 1, 'відкрито ' + await openCount(p));
  ok('Tab: значення збережено', await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return Object.values(pr.weights || {}).map(Number).includes(105);
  }));

  /* Enter — старий шлях, має працювати як раніше */
  await ins.nth(0).click();
  await ins.nth(0).fill('110');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  ok('Enter не згортає день', await openCount(p) === 1);
  ok('Enter: значення збережено', await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return Object.values(pr.weights || {}).map(Number).includes(110);
  }));
  ok('клавіатура: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Зміна ззовні (інша вкладка) все одно перемальовує ---- */
{
  const ctx = await adultContext(b, { viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await seeded(p, 'plan.html');
  const accs = p.locator('#plan .acc');
  let dayIdx = -1;
  const total = await accs.count();
  for (let i = 0; i < total; i++) {
    if (await accs.nth(i).locator('input[data-act=weight]').count() > 1) { dayIdx = i; break; }
  }
  await accs.nth(dayIdx).locator('.acc__head').click();
  await p.waitForTimeout(400);
  // чужий запис: минуло більше за вікно власного запису
  await p.waitForTimeout(1400);
  const applied = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const w = Object.assign({}, pr.weights || {});
    const name = document.querySelector('#plan .acc.is-open input[data-act=weight]').dataset.name;
    w[name] = 123;
    await window.Store.saveProfile({ weights: w });
    await new Promise(r => setTimeout(r, 700));
    const el = [...document.querySelectorAll('#plan input[data-act=weight]')]
      .find(x => x.dataset.name === name);
    return { shown: el ? el.value : null, open: document.querySelectorAll('#plan .acc.is-open').length };
  });
  ok('зовнішня зміна доїхала в поле', String(applied.shown) === '123', String(applied.shown));
  ok('зовнішня зміна не згорнула відкритий день', applied.open === 1, 'відкрито ' + applied.open);
  await ctx.close();
}

/* ---- 3б. Режим правки не розгортає весь тиждень ---- */
{
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await seeded(p, 'plan.html');

  const openIdx = () => p.evaluate(() => [...document.querySelectorAll('#plan .acc')]
    .map((a, i) => a.classList.contains('is-open') ? i : null).filter(x => x !== null));

  ok('правка: старт — усе згорнуто', (await openIdx()).length === 0);

  // над згорнутим планом правка відкриває РІВНО один день
  await p.click('#toggle-edit'); await p.waitForTimeout(600);
  let now = await openIdx();
  ok('правка над згорнутим планом відкриває рівно один день', now.length === 1, JSON.stringify(now));
  await p.click('#toggle-edit'); await p.waitForTimeout(500);

  // відкритий день лишається єдиним відкритим на всіх етапах
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1100);
  const accs = p.locator('#plan .acc');
  let dayIdx = -1;
  const total = await accs.count();
  for (let i = total - 1; i >= 0; i--) {
    if (await accs.nth(i).locator('input[data-act=weight]').count() > 1) dayIdx = i;
  }
  // беремо НЕ перший день із вправами — так видно, що відкривається саме обраний
  for (let i = 0; i < total; i++) {
    if (await accs.nth(i).locator('input[data-act=weight]').count() > 1 && i > dayIdx) { dayIdx = i; break; }
  }
  const target = 3 < total ? 3 : dayIdx;
  await accs.nth(target).locator('.acc__head').click(); await p.waitForTimeout(400);
  ok('правка: відкрив один день', JSON.stringify(await openIdx()) === JSON.stringify([target]),
     JSON.stringify(await openIdx()));

  await p.click('#toggle-edit'); await p.waitForTimeout(700);
  ok('УВІМКНЕННЯ правки не розгортає решту днів',
     JSON.stringify(await openIdx()) === JSON.stringify([target]), JSON.stringify(await openIdx()));

  const day = accs.nth(target);
  const step = async (sel, label) => {
    const el = day.locator(sel).first();
    if (!await el.count()) return;
    if (sel.indexOf('select') === 0 || sel.indexOf('[data-act="sets"]') === 0) {
      await el.selectOption({ index: 1 }).catch(() => {});
    } else {
      await el.click().catch(() => {});
    }
    await p.waitForTimeout(800);
    ok(label + ' не розгортає інші дні',
       JSON.stringify(await openIdx()) === JSON.stringify([target]), JSON.stringify(await openIdx()));
  };
  await step('[data-act="swap"]', 'заміна вправи');
  await step('[data-act="sets"]', 'зміна підходів');
  await step('[data-act="add-muscle"]', 'додавання вправи');
  await step('[data-act="down"]', 'перестановка вправи');
  await step('[data-act="del"]', 'видалення вправи');

  await p.click('#toggle-edit'); await p.waitForTimeout(700);
  ok('ВИМКНЕННЯ правки лишає відкритим той самий день',
     JSON.stringify(await openIdx()) === JSON.stringify([target]), JSON.stringify(await openIdx()));

  ok('правка: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Тренування: та сама щілина між blur і focus ---- */
{
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  /* Поля робочої ваги переїхали на власний екран тренування разом із
     самим тренуванням — сторож фокуса перевіряємо там, де вони тепер. */
  await seeded(p, 'workout.html');
  const ins = p.locator('#workout input[inputmode=decimal]');
  const n = await ins.count();
  ok('«Тренування»: є поля робочої ваги', n >= 2, String(n));
  if (n >= 2) {
    await ins.nth(0).click();
    await ins.nth(0).fill('100');
    await p.waitForTimeout(150);
    await ins.nth(1).click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(900);
    const r = await p.evaluate(async () => {
      const a = document.activeElement;
      const pr = await window.Store.getProfile();
      return { tag: a.tagName,
        first: document.querySelectorAll('#workout input[inputmode=decimal]')[0].value,
        saved: Object.values(pr.weights || {}).map(Number).includes(100) };
    });
    ok('«Тренування»: фокус лишився в полі, а не впав на body', r.tag === 'INPUT', r.tag);
    ok('«Тренування»: перше поле утримало набране', r.first === '100', r.first);
    ok('«Тренування»: вага збережена', r.saved);
  }
  ok('«Тренування»: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок полів вводу пройшло.');
process.exit(bad ? 1 : 0);
