/**
 * Віковий гейт: 17+ як умова доступу, а не як екран.
 *
 * Межа саме 17, а не 18: AgeCore.MIN_AGE = 17, те саме число в
 * register_request (сервер) і в legal.html. У шапці цього файла колись
 * стояло «18+» — INV-010.
 *
 * Найважливіше тут — не те, що екран малюється, а те, що його не можна
 * обійти: прямим URL, історією, перезавантаженням, підробленим
 * localStorage чи імпортом профілю з дитячою датою.
 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { adultProfile, localMode } from './adult.mjs';
import { fillBirth } from './dob.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const page = (u) => String(u).split('/').pop().split('#')[0];

const b = await chromium.launch({ executablePath: CHROME });

const PAGES = ['index.html', 'workout.html', 'plan.html', 'programs.html', 'nutrition.html',
               'meals.html', 'journal.html', 'trackers.html', 'trackers-settings.html', 'rating.html', 'periodization.html',
               'boxing.html', 'cardio.html', 'calculator.html', 'supplements.html',
               'research.html', 'account.html', 'today.html'];

/*
 * ЧОМУ ВЕСЬ ЦЕЙ ФАЙЛ ЙДЕ В ЛОКАЛЬНОМУ РЕЖИМІ.
 *
 * Тут перевіряється саме СКРИНІНГ: екран дати народження, його межі й те,
 * що його не обійти підробкою localStorage. У хмарному режимі цей екран
 * більше не перший — перед ним стоять реєстрація та схвалення заявки, а
 * сама дата ще й перевіряється на сервері (RPC, db/account-approval.sql).
 * Тобто хмарний шлях СУВОРІШИЙ і перевіряється окремо; якби ці сценарії
 * лишились у ньому, вони міряли б екран входу й мовчки нічого не стерегли.
 *
 * localMode() гасить ключі Supabase до завантаження скриптів — сайт бачить
 * себе форком без сервера, де ib.profile і є єдиним джерелом правди.
 */
async function fresh(profile) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await localMode(ctx);
  await ctx.route(/^https?:\/\//, r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  if (profile) {
    await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
    await p.evaluate(pr => localStorage.setItem('ib.profile', JSON.stringify(pr)), profile);
  }
  return { ctx, p, errs };
}

/**
 * Довести браузер до екрана дати народження.
 *
 * Перший екран welcome тепер стартовий («Увійти» / «Зареєструватися») — і
 * в хмарному режимі, і в локальному. Скринінг стоїть за кнопкою
 * «Зареєструватися»: у локальному режимі вона веде просто на крок 'age'.
 * Один клік замість припущення, що дата — перший екран; якщо профіль уже
 * містить дату, крок 'age' відкривається сам і кнопки немає.
 */
async function toAge(p) {
  await p.waitForTimeout(700);
  const reg = p.locator('#gate-card [data-nav="age"]');
  if (await reg.count()) { await reg.click(); await p.waitForTimeout(400); }
}

/* ---- 1. Чистий браузер: будь-яка сторінка веде на гейт ---- */
{
  const { ctx, p, errs } = await fresh(null);
  let bad = [];
  for (const f of PAGES) {
    /* Запобіжник циклів у js/agegate.js навмисно замовкає після 4 редиректів
       за 10 секунд — інакше розбіжність сторожа й welcome.js вішала б сайт
       намертво. Людина стільки закритих сторінок поспіль не відкриває, а цей
       цикл відкриває 17, тож лічильник треба скидати перед кожною: інакше з
       пʼятої перевірка міряла б запобіжник, а не сторожа. */
    await p.evaluate(() => { try { sessionStorage.removeItem('ib.gateloop'); } catch (_) {} });
    await p.goto('file://' + ROOT + '/' + f, { waitUntil: 'load' });
    await p.waitForTimeout(160);
    /*
     * account.html — свідомий виняток у ЧИСТОМУ браузері (LOC-005): це
     * єдиний інтерфейс імпорту резервної копії, і без нього відновитися з
     * власного експорту неможливо саме тоді, коли це й потрібно. Профіль
     * із дитячою датою вона так само не пускає — це перевірка 3 нижче.
     */
    if (f === 'account.html') continue;
    if (page(p.url()) !== 'welcome.html') bad.push(f + '→' + page(p.url()));
  }
  ok('1. усі ' + (PAGES.length - 1) + ' сторінок ведуть на гейт (прямий URL)', bad.length === 0, bad.join(', '));

  /* Зворотний бік того самого правила: імпорт має бути досяжним. */
  await p.evaluate(() => { try { sessionStorage.removeItem('ib.gateloop'); } catch (_) {} });
  await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await p.waitForTimeout(160);
  ok('1. account.html досяжний у чистому браузері — там імпорт копії',
     page(p.url()) === 'account.html', page(p.url()));

  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  await toAge(p);
  ok('1. заголовок екрана точний',
     (await p.locator('#gate-card h1').innerText()).trim() === 'Вкажіть вашу дату народження');
  /* Календаря бути НЕ повинно: дата народження вводиться цифрами. */
  ok('1. без рідного календаря', (await p.locator('#gate-card input[type="date"]').count()) === 0);
  ok('1. три числові поля ДД/ММ/РРРР',
     (await p.locator('#gate-card [data-dob]').count()) === 3,
     String(await p.locator('#gate-card [data-dob]').count()));
  ok('1. клавіатура цифрова',
     (await p.locator('#dob-d').getAttribute('inputmode')) === 'numeric');
  ok('1. кнопка «Продовжити» вимкнена до вводу', await p.locator('#gate-go').isDisabled());

  /* На першому екрані ТІЛЬКИ дата */
  const fields = await p.evaluate(() =>
    [...document.querySelectorAll('#gate-card input, #gate-card select, #gate-card textarea')]
      .map(e => e.id || e.name || e.type));
  ok('1. на екрані лише поля дати', fields.join(',') === 'dob-d,dob-m,dob-y', fields.join(', '));

  const txt = await p.locator('#gate-card').innerText();
  const forbidden = ['Стать', 'Вага', 'Зріст', 'Ціль', 'Програма', 'Активн', 'жиру', 'досвід'];
  ok('1. нічого зайвого не питає', !forbidden.some(w => txt.includes(w)),
     forbidden.filter(w => txt.includes(w)).join(', '));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Неповнолітній ---- */
{
  const { ctx, p, errs } = await fresh(null);
  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  await toAge(p);

  await fillBirth(p, '2012-05-05');
  await p.waitForTimeout(400);
  ok('2. кнопка лишається вимкненою', await p.locator('#gate-go').isDisabled());

  /* Межу беремо з застосунку (AgeCore.MIN_AGE), а не зашиваємо числом:
     вона одна для клієнта, сервера (register_request) і legal.html, і саме
     їхню узгодженість тут і треба стерегти. Раніше тут стояло «18», межу
     змінили на 17 — і перевірка почала падати на правильній поведінці. */
  const MIN = await p.evaluate(() => window.AgeCore.MIN_AGE);
  const msg = await p.locator('#gate-card').innerText();
  ok('2. повідомлення точне за текстом',
     msg.includes('Get Stronger доступний лише користувачам віком від ' + MIN + ' років.'), String(MIN));
  ok('2. пояснення на місці',
     msg.includes('розроблені для користувачів віком ' + MIN + ' років і старше.'));

  /* Профіль не створюється */
  const stored = await p.evaluate(() => localStorage.getItem('ib.profile'));
  ok('2. профіль не створено', !stored || !JSON.parse(stored).birthDate, String(stored).slice(0, 60));

  /* Кнопку не обійти зняттям disabled */
  await p.evaluate(() => { const el = document.getElementById('gate-go'); el.disabled = false; el.click(); });
  await p.waitForTimeout(900);
  ok('2. зняття disabled нічого не дає', page(p.url()) === 'welcome.html', page(p.url()));
  const after = await p.evaluate(() => localStorage.getItem('ib.profile'));
  ok('2. і профіль так і не створено', !after || !JSON.parse(after).birthDate);
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Дитяча дата вже в профілі ---- */
{
  const { ctx, p, errs } = await fresh({ version: 6, birthDate: '2011-01-01', age: 15, weight: 60 });
  let bad = [];
  for (const f of ['index.html', 'workout.html', 'programs.html', 'account.html']) {
    await p.goto('file://' + ROOT + '/' + f, { waitUntil: 'load' });
    await p.waitForTimeout(160);
    if (page(p.url()) !== 'welcome.html') bad.push(f);
  }
  ok('3. профіль із дитячою датою не пускає в застосунок', bad.length === 0, bad.join(', '));

  await p.waitForTimeout(800);
  ok('3. гейт одразу показує заборону',
     (await p.locator('#gate-card').innerText()).includes(
       'лише користувачам віком від ' + await p.evaluate(() => window.AgeCore.MIN_AGE)));
  ok('3. кнопка вимкнена', await p.locator('#gate-go').isDisabled());
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Підробка localStorage ---- */
{
  const attempts = [
    ['вигаданий прапорець «пройдено»', { version: 6, ageGatePassed: true, adult: true, age: 30 }],
    ['лише числовий вік без дати', { version: 6, age: 30 }],
    ['дата у майбутньому', { version: 6, birthDate: '2030-01-01' }],
    ['неіснуючий день', { version: 6, birthDate: '2001-02-31' }],
    ['сміття замість дати', { version: 6, birthDate: 'дорослий' }],
    ['дата не рядком', { version: 6, birthDate: 19950310 }],
    ['неправдоподібно давня', { version: 6, birthDate: '1850-01-01' }],
    ['за день до 18-річчя', { version: 6, birthDate: (() => {
      const d = new Date(); d.setFullYear(d.getFullYear() - 18); d.setDate(d.getDate() + 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })() }]
  ];
  for (const [name, prof] of attempts) {
    const { ctx, p } = await fresh(prof);
    await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(200);
    ok('4. ' + name + ' — не пускає', page(p.url()) === 'welcome.html', page(p.url()));
    await ctx.close();
  }

  /* Рівно 18 сьогодні — пускає */
  const today18 = (() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 18);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();
  const { ctx, p } = await fresh({ version: 6, birthDate: today18 });
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  /* Вік пройдено — далі онбординг веде на крок «тіло», не назад до дати. */
  ok('4. рівно 18 років сьогодні — вік пройдено', page(p.url()) === 'welcome.html' &&
     await p.locator('#b-weight').count() === 1, page(p.url()));
  await ctx.close();
}

/* ---- 5. Дорослий: дата зберігається, повний профіль дає доступ ---- */
{
  const { ctx, p, errs } = await fresh(null);
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await toAge(p);
  await fillBirth(p, '1995-03-10');
  await p.waitForTimeout(400);
  ok('5. після дорослої дати кнопка активна', !(await p.locator('#gate-go').isDisabled()));
  await p.locator('#gate-go').click();
  await p.waitForTimeout(1200);
  /* Вік — перший крок онбордингу: далі екран «тіло», не застосунок. */
  ok('5. вік пройдено — далі крок «тіло»', page(p.url()) === 'welcome.html' &&
     await p.locator('#b-weight').count() === 1, page(p.url()));

  const prof = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return { birthDate: pr.birthDate, age: pr.age };
  });
  ok('5. дата лягла в профіль', prof.birthDate === '1995-03-10', JSON.stringify(prof));
  ok('5. age порахувався з дати', typeof prof.age === 'number' && prof.age >= 30, String(prof.age));

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(900);
  /* Перезавантаження не повертає до дати: крок виводиться з даних. */
  ok('5. перезавантаження тримає крок «тіло»',
     await p.locator('#b-weight').count() === 1, page(p.url()));
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5б. Повний профіль: доступ, перезавантаження, історія ---- */
{
  const { ctx, p, errs } = await fresh(adultProfile());
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  ok('5б. повний профіль пускає у застосунок', page(p.url()) === 'index.html', page(p.url()));

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(700);
  ok('5б. перезавантаження не викидає', page(p.url()) === 'index.html', page(p.url()));

  /* «Назад» не має повертати на гейт: replace прибрав його з історії */
  await p.goBack({ waitUntil: 'load' }).catch(() => {});
  await p.waitForTimeout(600);
  ok('5б. «назад» не замикає в циклі', page(p.url()) !== 'welcome.html', page(p.url()));

  /* Пряме відкриття гейта — веде в застосунок */
  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  ok('5б. на гейті з повним профілем робити нічого', page(p.url()) === 'index.html', page(p.url()));

  let bad = [];
  for (const f of PAGES) {
    await p.goto('file://' + ROOT + '/' + f, { waitUntil: 'load' });
    await p.waitForTimeout(140);
    const cur = page(p.url());
    if (cur === 'welcome.html') bad.push(f);
  }
  ok('5б. усі сторінки доступні', bad.length === 0, bad.join(', '));
  ok('5б. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Імпорт профілю не є обходом ---- */
{
  const { ctx, p, errs } = await fresh(null);
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await toAge(p);
  await fillBirth(p, '1990-06-15');
  await p.waitForTimeout(300);
  await p.locator('#gate-go').click();
  await p.waitForTimeout(1400);

  await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await p.waitForTimeout(1000);

  for (const [name, birth, expect] of [
    ['дитяча дата', '2012-03-03', null],
    ['биті дані', 'не-дата', null],
    ['доросла дата', '1988-02-20', '1988-02-20']
  ]) {
    const f = path.join(os.tmpdir(), 'gate-' + Buffer.from(name).toString('hex') + '.json');
    fs.writeFileSync(f, JSON.stringify({ version: 6, weight: 80, birthDate: birth }));
    await p.setInputFiles('#p-import-file', f);
    await p.waitForTimeout(1200);
    const got = await p.evaluate(async () => (await window.Store.getProfile()).birthDate);
    if (expect === null) {
      ok('6. імпорт «' + name + '» відкинуто', got === '1990-06-15', String(got));
    } else {
      ok('6. імпорт «' + name + '» прийнято', got === expect, String(got));
    }
    ok('6. решта профілю ціла після «' + name + '»',
       await p.evaluate(async () => (await window.Store.getProfile()).weight) === 80);
  }
  ok('6. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 7. Мобільний екран ---- */
for (const w of [320, 390, 430]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true });
  await localMode(ctx);
  await ctx.route(/^https?:\/\//, r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  await toAge(p);
  const m = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    date: Math.round(document.getElementById('dob-d').getBoundingClientRect().height),
    btn: Math.round(document.getElementById('gate-go').getBoundingClientRect().height),
    fits: document.documentElement.scrollHeight <= window.innerHeight + 2
  }));
  ok(w + 'px: без горизонтального переповнення', !m.overflow);
  ok(w + 'px: поле дати ≥ 44px', m.date >= 44, m.date + 'px');
  ok(w + 'px: кнопка ≥ 44px', m.btn >= 44, m.btn + 'px');
  ok(w + 'px: екран вміщається без скролу', m.fits);
  ok(w + 'px: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 8. Токен з листа й запобіжник циклів ---- */
{
  /*
   * WEB-009. Фрагмент #access_token=… споживає лише welcome.js. Коли
   * сторож нікуди не редиректить (профіль повний), він лишався в адресному
   * рядку й у записі історії назавжди — у скріншоті, у «поділитися», у
   * синхронізації вкладок.
   */
  const { ctx, p } = await fresh(adultProfile());
  /* Сторож редиректить із <head>, тому 'load' може не настати ніколи:
     чекаємо лише на початок навігації і даємо йому відпрацювати. */
  await p.goto('file://' + ROOT + '/index.html#access_token=STOLEN&refresh_token=r&type=signup',
               { waitUntil: 'commit' }).catch(() => {});
  await p.waitForTimeout(600);
  const u = await p.evaluate(() => location.href);
  ok('токен з листа не лишається в адресному рядку відкритої сторінки',
     page(u) === 'index.html' && u.indexOf('access_token=') === -1, u.slice(-60));
  await ctx.close();
}
{
  const { ctx, p } = await fresh(adultProfile());
  await p.evaluate(() => localStorage.setItem('ib.session', JSON.stringify({
    access_token: 'own', refresh_token: 'r', expires_at: Date.now() + 3600e3,
    user: { id: '00000000-0000-4000-8000-00000000000B', email: 'victim@example.com' } })));
  /* Сторож редиректить із <head>, тому 'load' може не настати ніколи:
     чекаємо лише на початок навігації і даємо йому відпрацювати. */
  await p.goto('file://' + ROOT + '/index.html#access_token=STOLEN&refresh_token=r&type=signup',
               { waitUntil: 'commit' }).catch(() => {});
  await p.waitForTimeout(600);
  const u = await p.evaluate(() => location.href);
  ok('із чинною сесією чужий токен теж стирається і нікуди не їде',
     page(u) === 'index.html' && u.indexOf('access_token=') === -1, u.slice(-60));
  await ctx.close();
}
{
  /*
   * UX-007. Лічильник анти-циклу рахував УСІ редиректи за 10 секунд і
   * обнулявся лише за часом. Пʼять переходів на закриті сторінки поспіль
   * (людина тицяє в меню, поки заповнює онбординг) вичерпували ліміт — і
   * шоста сторінка відкривалась із порожнім профілем, повз сторожа.
   */
  const { ctx, p } = await fresh(null);
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'commit' }).catch(() => {});
    /* Довше за 1500 мс: рівно стільки сторож чекає, перш ніж визнати
       показ справжнім і розірвати ланцюг. Людина, яка тицяє в меню,
       затримується на екрані щонайменше на стільки. */
    await p.waitForTimeout(1700);
    seen.push(page(await p.evaluate(() => location.href)));
  }
  ok('шість переходів поспіль на закриту сторінку — усі шість на гейті',
     seen.every(x => x === 'welcome.html'), seen.join(','));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок вікового гейта пройшло.');
process.exit(bad ? 1 : 0);
