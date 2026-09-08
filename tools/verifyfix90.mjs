/**
 * Регресійні перевірки після 90-денної симуляції (tools/sim90/REPORT.md).
 *
 * B1  «Запамʼятати мене» вимкнено → сторож бачить сесію в sessionStorage
 * B2  Каталог програм: обидві статі × 3–6 днів
 * B3  Грами: строга матриця значень, стан у сховищі
 * B4  День раціону, що «переїхав» через опівніч — видимий чип/нотатка
 * B5  Кома як десятковий роздільник: welcome, account, грами
 * B6  «Вийти» на кроках віку/тіла в хмарному режимі
 * B7  Адхеренс: сесій більше за план — текст без «5 із 3»
 * B8  elo_close_season — не на кожне завантаження
 *
 * Запуск: node tools/verifyfix90.mjs   (file://, підмінений Supabase)
 *         MOBILE=1 node tools/verifyfix90.mjs   (390×844)
 */
import { chromium } from 'playwright';
import { adultContext, ONBOARDED } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const EXE = CHROME;
const url = (p) => 'file://' + ROOT + '/' + p;
const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok, info });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  — ' + info : ''));
}
const last = (p) => p.url().split('/').pop().split('?')[0].split('#')[0];

/*
 * Посів у localStorage ОДРАЗУ ПІСЛЯ goto — це гонка.
 *
 * welcome.js і сторож віку вміють редиректити з <head>, тобто контекст
 * сторінки може бути знищений навігацією рівно в момент evaluate. У CI це
 * давало не провал перевірки, а падіння всього скрипта з «Execution
 * context was destroyed» — і решта 20 перевірок не виконувалась узагалі.
 * Даємо сторінці осісти й повторюємо один раз.
 */
async function seed(p, fn, arg) {
  for (let i = 0; i < 3; i++) {
    try { return await p.evaluate(fn, arg); }
    catch (e) {
      if (!/Execution context was destroyed|Target closed/.test(String(e && e.message))) throw e;
      await p.waitForTimeout(250);
    }
  }
  return undefined;
}

/** Профіль у сховищі (як його бачить Store, синхронно). */
const localProfile = (p) => p.evaluate(() => window.Store.localProfile() || {});
async function setProfile(p, patch) {
  await p.evaluate((patch) => {
    const raw = JSON.parse(localStorage.getItem('ib.profile') || '{}') || {};
    localStorage.setItem('ib.profile', JSON.stringify(Object.assign(raw, patch)));
  }, patch);
}
/** Підміна account_state → approved (adult.mjs віддає {} на всі RPC). */
async function approvedRpc(ctx, counter) {
  await ctx.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (route) => {
    const name = route.request().url().match(/rpc\/([a-z_]+)/)[1];
    if (counter) counter[name] = (counter[name] || 0) + 1;
    if (name === 'account_state') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'approved', username: 'Тест', isAdmin: false }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}
/** Блок «Продукти» типово згорнутий — розгорнути перед кліком. */
async function openFoods(p) {
  if (await p.locator('[data-add-food]').count() === 0) { await p.click('[data-fold="foods"]'); await p.waitForTimeout(200); }
}
function today(offset) {
  const d = new Date(); d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const VP = process.env.MOBILE ? { width: 390, height: 844 } : { width: 1200, height: 900 };
const browser = await chromium.launch({ executablePath: EXE });

/* ------------------------------------------------------------------ B1 */
{
  const ctx = await adultContext(browser, { viewport: VP });
  await approvedRpc(ctx);
  /* Вихід стирає локальний профіль (clearIdentityData) — як і в житті,
     після входу профіль приїздить із хмари. Двійник віддає пройдений. */
  await ctx.route(/\/rest\/v1\/profiles/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{ user_id: '00000000-0000-4000-8000-000000000001', data: ONBOARDED }]) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  await p.goto(url('account.html'), { waitUntil: 'load' }); await p.waitForTimeout(600);
  await p.click('#a-signout'); await p.waitForTimeout(800);
  check('B1 після виходу — форма входу', await p.locator('#a-form').count() === 1, last(p));
  await p.fill('#a-email', 'u@test.local'); await p.fill('#a-pass', 'password123');
  await p.uncheck('#a-remember');
  await p.click('button[data-act="in"]'); await p.waitForTimeout(1500);
  const st = await p.evaluate(() => ({
    ls: !!localStorage.getItem('ib.session'), ss: !!sessionStorage.getItem('ib.session'),
    rem: localStorage.getItem('ib.remember'), user: !!window.Store.user()
  }));
  check('B1 вхід без галочки → сесія лише в sessionStorage', !st.ls && st.ss && st.user && st.rem === '0', JSON.stringify(st));
  const seen = [];
  for (const pg of ['index.html', 'workout.html', 'journal.html', 'meals.html']) {
    await p.goto(url(pg), { waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(700);
    seen.push(pg + '→' + last(p));
  }
  check('B1 переходи без галочки не викидають на welcome', seen.every(s => { const [a, b] = s.split('→'); return a === b; }), seen.join(' '));
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(700);
  check('B1 reload у тій самій вкладці лишає сторінку', last(p) === 'meals.html', last(p));
  const p2 = await ctx.newPage();
  await p2.goto(url('workout.html'), { waitUntil: 'load' }).catch(() => {}); await p2.waitForTimeout(900);
  check('B1 нова вкладка без галочки → welcome (сесія не на диску)', last(p2) === 'welcome.html', last(p2));
  await p2.close();
  await p.goto(url('account.html'), { waitUntil: 'load' }); await p.waitForTimeout(600);
  await p.click('#a-signout'); await p.waitForTimeout(600);
  await p.fill('#a-email', 'u@test.local'); await p.fill('#a-pass', 'password123');
  await p.check('#a-remember'); await p.click('button[data-act="in"]'); await p.waitForTimeout(1500);
  const st2 = await p.evaluate(() => ({ ls: !!localStorage.getItem('ib.session'), ss: !!sessionStorage.getItem('ib.session'), rem: localStorage.getItem('ib.remember') }));
  check('B1 вихід → вхід із галочкою → сесія в localStorage', st2.ls && st2.rem !== '0', JSON.stringify(st2));
  await p.goto(url('workout.html'), { waitUntil: 'load' }); await p.waitForTimeout(600);
  check('B1 після повторного входу сторінки відкриваються', last(p) === 'workout.html', last(p));
  await ctx.close();
}

/* ------------------------------------------------------------------ B2 */
{
  const ctx = await adultContext(browser, { viewport: VP });
  const p = await ctx.newPage();
  await p.goto(url('programs.html'), { waitUntil: 'load' });
  const matrix = await p.evaluate(() => {
    const out = [];
    for (const sex of ['male', 'female']) {
      for (const d of [3, 4, 5, 6]) {
        const list = window.programsForSex(sex).filter(pr => pr.days && Array.isArray(pr.days[d]) && pr.days[d].length === d);
        out.push({ sex, d, n: list.length, ids: list.map(x => x.id).join(',') });
      }
    }
    return out;
  });
  for (const m of matrix) {
    const expectSome = m.sex === 'male' || m.d <= 4;
    check('B2 каталог ' + m.sex + ' × ' + m.d + ' дн', expectSome ? m.n > 0 : m.n === 0, m.ids || '—');
  }
  for (const sex of ['male', 'female']) {
    await setProfile(p, { sex });
    await p.goto(url('programs.html'), { waitUntil: 'load' }); await p.waitForTimeout(500);
    const vis = await p.evaluate(() => Array.from(document.querySelectorAll('input[name="days"]')).map(r => {
      const lab = r.closest('label') || r.parentElement;
      const cs = getComputedStyle(lab);
      return r.value + ':' + (cs.display !== 'none' && cs.visibility !== 'hidden' && lab.offsetParent !== null ? 'on' : 'off');
    }).join(' '));
    const ok = sex === 'female' ? /5:off/.test(vis) && /6:off/.test(vis) && /3:on/.test(vis) && /4:on/.test(vis)
                                : /3:on/.test(vis) && /4:on/.test(vis) && /5:on/.test(vis) && /6:on/.test(vis);
    check('B2 перемикач днів для ' + sex, ok, vis);
  }
  await ctx.close();
}

/* ------------------------------------------------------------------ B3 */
{
  const ctx = await adultContext(browser, { viewport: VP });
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  const cases = [
    ['5000', 5000], ['5000.1', null], ['9999', null], ['99999', null], ['-1', null],
    ['0', 0], ['0.5', 0.5], ['58,5', 58.5], ['58.5', 58.5], ['1e3', null], ['abc', null], ['', null]
  ];
  await p.goto(url('meals.html'), { waitUntil: 'load' });
  for (const [raw, expect] of cases) {
    await setProfile(p, { day: null });
    await p.goto(url('meals.html'), { waitUntil: 'load' }); await p.waitForTimeout(500);
    const before = ((await localProfile(p)).day || { meals: [] });
    const nBefore = (before.meals || []).reduce((s, m) => s + (m.items || []).length, 0);
    await openFoods(p); await p.locator('[data-add-food]').first().click(); await p.waitForTimeout(300);
    await p.fill('#m-grams', raw);
    await p.click('#m-add'); await p.waitForTimeout(500);
    const after = ((await localProfile(p)).day || { meals: [] });
    const items = (after.meals || []).flatMap(m => m.items || []);
    const modalOpen = await p.locator('#m-grams').count() > 0;
    if (expect === null) {
      check('B3 «' + raw + '» відхилено, стан не змінено', items.length === nBefore && modalOpen, 'items=' + items.length + ' modal=' + modalOpen);
    } else {
      const it = items[items.length - 1];
      check('B3 «' + raw + '» → ' + expect + ' г у сховищі', items.length === nBefore + 1 && it && it.grams === expect && !modalOpen,
        'grams=' + (it && it.grams) + ' modal=' + modalOpen);
    }
  }
  /* Редагування в таблиці дня: 99999 не проходить, значення лишається. */
  await setProfile(p, { day: null });
  await p.goto(url('meals.html'), { waitUntil: 'load' }); await p.waitForTimeout(400);
  await openFoods(p); await p.locator('[data-add-food]').first().click(); await p.waitForTimeout(200);
  await p.fill('#m-grams', '120'); await p.click('#m-add'); await p.waitForTimeout(400);
  const cell = p.locator('[data-df="amount"]').first();
  await cell.fill('99999'); await cell.dispatchEvent('change'); await p.waitForTimeout(400);
  const g = (await localProfile(p)).day.meals.flatMap(m => m.items || [])[0].grams;
  check('B3 правка в таблиці дня 99999 → відхилено, лишилось 120', g === 120, 'grams=' + g);
  await cell.fill('58,5'); await cell.dispatchEvent('change'); await p.waitForTimeout(400);
  const g2 = (await localProfile(p)).day.meals.flatMap(m => m.items || [])[0].grams;
  check('B3 правка в таблиці дня «58,5» → 58.5', g2 === 58.5, 'grams=' + g2);
  await ctx.close();
}

/* ------------------------------------------------------------------ B4 */
{
  const ctx = await adultContext(browser, { viewport: VP });
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  const Y = today(-1);
  await p.goto(url('meals.html'), { waitUntil: 'load' });
  await setProfile(p, { age: 36 });   // картка «Харчування» на index потребує віку
  await p.goto(url('meals.html'), { waitUntil: 'load' }); await p.waitForTimeout(400);
  await openFoods(p); await p.locator('[data-add-food]').first().click(); await p.waitForTimeout(200);
  await p.fill('#m-grams', '100'); await p.click('#m-add'); await p.waitForTimeout(400);
  const d0 = (await localProfile(p)).day;
  check('B4 відкритий день має дату', d0 && d0.date === today(0), String(d0 && d0.date));
  /* «Опівніч минула»: день лишився відкритим із вчорашньою датою. */
  await setProfile(p, { day: Object.assign({}, d0, { date: Y }) });
  await p.goto(url('meals.html'), { waitUntil: 'load' }); await p.waitForTimeout(500);
  check('B4 чип «за ' + Y + '» видимий', await p.locator('#d-stale').isVisible() && (await p.locator('#d-stale').innerText()).includes(Y));
  check('B4 нотатка про незакритий день видима', await p.locator('#d-stale-note').isVisible());
  await openFoods(p); await p.locator('[data-add-food]').first().click(); await p.waitForTimeout(200);
  await p.fill('#m-grams', '50'); await p.click('#m-add'); await p.waitForTimeout(400);
  const d1 = (await localProfile(p)).day;
  check('B4 додане сьогодні пішло в день ' + Y + ' (задокументована поведінка)', d1.date === Y && d1.meals.flatMap(m => m.items || []).length === 2);
  await p.goto(url('index.html'), { waitUntil: 'load' }); await p.waitForTimeout(500);
  const idx = (await p.locator('main').innerText()).replace(/\s+/g, ' ');
  check('B4 «Сьогодні» попереджає про незакритий день', idx.includes('Це день за ' + Y), idx.slice(0, 80));
  await p.goto(url('meals.html'), { waitUntil: 'load' }); await p.waitForTimeout(400);
  await p.click('#d-close'); await p.waitForTimeout(700);
  const prof = await localProfile(p);
  const logged = (prof.mealLog || {})[Y];
  check('B4 «Закрити день» записав підсумок у ' + Y, !!logged, JSON.stringify(logged || null).slice(0, 80));
  check('B4 після закриття чипа немає', (await p.locator('#d-stale').count()) === 0);
  await ctx.close();
}

/* ------------------------------------------------------------------ B5 */
{
  /* account.html — вага, дробові через кому. */
  const ctx = await adultContext(browser, { viewport: VP });
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  for (const [raw, expect] of [['58,5', 58.5], ['58.5', 58.5], ['72,25', 72.25], ['72.25', 72.25], ['abc', 72.25], ['1,5', 72.25]]) {
    await p.goto(url('account.html'), { waitUntil: 'load' }); await p.waitForTimeout(500);
    const type = await p.getAttribute('#p-weight', 'type');
    await p.fill('#p-weight', raw); await p.dispatchEvent('#p-weight', 'change'); await p.waitForTimeout(600);
    const w = (await localProfile(p)).weight;
    check('B5 account вага «' + raw + '» → ' + expect, w === expect && type === 'text', 'weight=' + w + ' type=' + type);
  }
  await ctx.close();

  /* welcome.html — крок тіла в локальному режимі (без хмари). */
  const ctx2 = await adultContext(browser, { viewport: VP }, { local: true });
  const p2 = await ctx2.newPage(); p2.on('dialog', d => d.accept());
  for (const [w, h, expW, expH] of [['58,5', '170', 58.5, 170], ['58.5', '170,0', 58.5, 170], ['72,25', '181', 72.25, 181]]) {
    await p2.goto(url('welcome.html'), { waitUntil: 'load' });
    await p2.evaluate((seed) => { localStorage.setItem('ib.profile', JSON.stringify({ version: seed.version, birthDate: seed.birthDate })); }, ONBOARDED);
    await p2.goto(url('welcome.html'), { waitUntil: 'load' }); await p2.waitForTimeout(500);
    if (await p2.locator('#gate-go').count()) {
      await p2.fill('[data-dob="d"]', '15'); await p2.fill('[data-dob="m"]', '06'); await p2.fill('[data-dob="y"]', '1990');
      await p2.click('#gate-go'); await p2.waitForTimeout(500);
    }
    check('B5 welcome крок тіла відкрито', await p2.locator('#body-go').count() === 1, last(p2));
    const t = await p2.getAttribute('#b-weight', 'type');
    await p2.evaluate(() => { const r = document.querySelector('input[name="b-sex"][value="male"]'); if (r) r.click(); });
    await p2.selectOption('#b-activity', '1.55'); await p2.selectOption('#b-trainage', 'inter');
    await p2.fill('#b-height', h); await p2.fill('#b-weight', w); await p2.waitForTimeout(300);
    await p2.click('#body-go'); await p2.waitForTimeout(600);
    if (await p2.locator('#bmi-w-ok').count()) { await p2.click('#bmi-w-ok'); await p2.waitForTimeout(600); }
    const prof = await p2.evaluate(() => JSON.parse(localStorage.getItem('ib.profile') || '{}'));
    check('B5 welcome вага «' + w + '», зріст «' + h + '» → ' + expW + '/' + expH,
      prof.weight === expW && prof.height === expH && t === 'text', 'w=' + prof.weight + ' h=' + prof.height + ' type=' + t);
  }
  await ctx2.close();
}

/* ------------------------------------------------------------------ B6 */
{
  const ctx = await adultContext(browser, { viewport: VP });
  await approvedRpc(ctx);
  const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  await p.goto(url('welcome.html'), { waitUntil: 'load' });
  await seed(p, () => { localStorage.setItem('ib.profile', JSON.stringify({ version: 6 })); });
  await p.goto(url('welcome.html'), { waitUntil: 'load' }); await p.waitForTimeout(800);
  check('B6 крок віку показано залогіненому', await p.locator('#gate-go').count() === 1, last(p));
  check('B6 «Вийти» є на кроці віку', await p.locator('#au-out').count() === 1);
  await seed(p, () => { localStorage.setItem('ib.profile', JSON.stringify({ version: 6, birthDate: '1990-06-15' })); });
  await p.goto(url('welcome.html'), { waitUntil: 'load' }); await p.waitForTimeout(800);
  check('B6 крок тіла показано залогіненому', await p.locator('#body-go').count() === 1, last(p));
  check('B6 «Вийти» є на кроці тіла', await p.locator('#au-out').count() === 1);
  await p.click('#au-out'); await p.waitForTimeout(800);
  const st = await p.evaluate(() => ({ user: !!window.Store.user(), ls: !!localStorage.getItem('ib.session'), ss: !!sessionStorage.getItem('ib.session') }));
  check('B6 «Вийти» на кроці тіла чистить сесію', !st.user && !st.ls && !st.ss, JSON.stringify(st));
  check('B6 після виходу — стартовий екран без «Вийти»', (await p.locator('#au-out').count()) === 0 && (await p.locator('#body-go').count()) === 0);
  await ctx.close();
  /* Локальний режим: кнопки бути не повинно. */
  const ctx2 = await adultContext(browser, { viewport: VP }, { local: true });
  const p2 = await ctx2.newPage();
  await p2.goto(url('welcome.html'), { waitUntil: 'load' });
  await p2.evaluate(() => { localStorage.setItem('ib.profile', JSON.stringify({ version: 6, birthDate: '1990-06-15' })); });
  await p2.goto(url('welcome.html'), { waitUntil: 'load' }); await p2.waitForTimeout(600);
  check('B6 локальний режим: «Вийти» відсутня', (await p2.locator('#au-out').count()) === 0, last(p2));
  await ctx2.close();
}

/* ------------------------------------------------------------------ B7 */
{
  const ctx = await adultContext(browser, { viewport: VP });
  const p = await ctx.newPage();
  await p.goto(url('journal.html'), { waitUntil: 'load' });
  const log = {};   // sessionLog: { 'YYYY-MM-DD': { doneSets, totalSets, ... } }
  for (let i = 1; i <= 5; i++) log[today(-i)] = { day: 1, doneSets: 2, totalSets: 2 };
  await setProfile(p, { sessionLog: log, activePlan: { programId: 'fullbody', days: 3 }, daysPerWeek: 3 });
  await p.goto(url('journal.html'), { waitUntil: 'load' }); await p.waitForTimeout(700);
  const txt = ((await p.locator('#adh-training').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  check('B7 текст адхеренсу без «N із M запланованих» при перевиконанні',
    txt.length > 0 && !/із \d+ запланованих/.test(txt) && /за планом на період/.test(txt), txt.slice(0, 140));
  await ctx.close();
}

/* ------------------------------------------------------------------ B8 */
{
  const ctx = await adultContext(browser, { viewport: VP });
  const rpc = {};
  await approvedRpc(ctx, rpc);
  const p = await ctx.newPage();
  for (const pg of ['index.html', 'workout.html', 'journal.html', 'meals.html', 'index.html']) {
    await p.goto(url(pg), { waitUntil: 'load' }); await p.waitForTimeout(600);
  }
  check('B8 elo_close_season ≤ 1 за 5 завантажень (неостаточна відповідь)', (rpc.elo_close_season || 0) <= 1, JSON.stringify(rpc));
  check('B8 elo_state усе ще на кожне завантаження (бейдж)', (rpc.elo_state || 0) >= 5, 'elo_state=' + rpc.elo_state);
  await ctx.close();
}

await browser.close();
const fails = results.filter(r => !r.ok);
console.log('\n' + (results.length - fails.length) + '/' + results.length + ' PASS');
process.exit(fails.length ? 1 : 0);
