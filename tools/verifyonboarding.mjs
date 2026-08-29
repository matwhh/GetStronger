/**
 * Онбординг як ворота: вік → тіло → програма з вагою → Forge.
 *
 * Найважливіше — не екрани, а те, що їх не можна обійти: прямим URL на
 * кожну сторінку з кожного кроку, історією, перезавантаженням,
 * підробленим localStorage чи прапорцем «пройдено». І навпаки: імпорт
 * повної резервної копії має відчиняти все сам, бо стан виводиться з
 * даних. Щасливий шлях по екранах живе у verifyonboard.mjs.
 */
import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { adultProfile, ADULT_BIRTH, localMode } from './adult.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const page = (u) => String(u).split('/').pop().split('#')[0];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const PAGES = ['index.html', 'workout.html', 'plan.html', 'programs.html', 'nutrition.html',
               'meals.html', 'journal.html', 'trackers.html', 'rating.html', 'periodization.html',
               'boxing.html', 'cardio.html', 'calculator.html', 'supplements.html',
               'research.html', 'account.html', 'today.html'];

/* Профілі-зрізи кожного кроку. */
const AGE_ONLY  = { version: 6, birthDate: ADULT_BIRTH, age: 36 };
const WITH_BODY = Object.assign({}, AGE_ONLY, { sex: 'male', weight: 82, height: 180, activity: 1.55, trainingAge: 'inter', hrRest: 60 });
const WITH_PLAN = Object.assign({}, WITH_BODY, { activePlan: { programId: 'fullbody', days: 3 }, weights: {} });

/*
 * ЛОКАЛЬНИЙ РЕЖИМ навмисно: тут перевіряється державна машина онбордингу,
 * де крок виводиться СУТО з ib.profile. У хмарному режимі перед нею стоїть
 * автентифікація, і кожен із цих зрізів упирався б у екран входу — тобто
 * перевірка мовчки міряла б не те. Хмарний шлях суворіший і має власні
 * перевірки; тут стережемо, що профіль-зріз відчиняє рівно свої сторінки.
 */
async function fresh(profile) {
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
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

async function landing(p, f) {
  /* Запобіжник циклів у js/agegate.js замовкає після 4 редиректів за 10
     секунд — інакше розбіжність сторожа й welcome.js вішала б сайт. Ці
     матриці відкривають 17 закритих сторінок поспіль, чого жива людина не
     робить, тож лічильник скидаємо: інакше з пʼятої міряли б запобіжник. */
  await p.evaluate(() => { try { sessionStorage.removeItem('ib.gateloop'); } catch (_) {} });
  await p.goto('file://' + ROOT + '/' + f, { waitUntil: 'load' });
  await p.waitForTimeout(160);
  return page(p.url());
}

/* ---- 1. Матриця: кожен крок × кожна сторінка ---- */
{
  /* Вік не пройдено: усе веде на welcome. */
  const { ctx, p } = await fresh(null);
  let bad = [];
  for (const f of PAGES) {
    const got = await landing(p, f);
    if (got !== 'welcome.html') bad.push(f + '→' + got);
  }
  ok('1. без віку всі ' + PAGES.length + ' сторінок ведуть на welcome', bad.length === 0, bad.join(', '));
  await ctx.close();
}
{
  /* Вік є, тіла немає: welcome (крок «тіло») + account (імпорт). */
  const { ctx, p } = await fresh(AGE_ONLY);
  let bad = [];
  for (const f of PAGES) {
    const got = await landing(p, f);
    const want = f === 'account.html' ? 'account.html' : 'welcome.html';
    if (got !== want) bad.push(f + '→' + got);
  }
  ok('1. крок «тіло»: пускає лише welcome і account', bad.length === 0, bad.join(', '));
  /* І welcome показує саме крок «тіло», а не дату знову. */
  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  ok('1. welcome на цьому кроці — форма тіла', await p.locator('#b-weight').count() === 1);
  await ctx.close();
}
{
  /* Тіло є, програми немає: programs + plan + account. */
  const { ctx, p } = await fresh(WITH_BODY);
  let bad = [];
  for (const f of PAGES) {
    const got = await landing(p, f);
    const stay = ['programs.html', 'plan.html', 'account.html'];
    const want = stay.includes(f) ? f : 'programs.html';
    if (got !== want) bad.push(f + '→' + got);
  }
  ok('1. крок «програма»: пускає лише programs/plan/account', bad.length === 0, bad.join(', '));
  await ctx.close();
}
{
  /* План обрано, ваги ще немає — це ще НЕ кінець. */
  const { ctx, p } = await fresh(WITH_PLAN);
  ok('1. план без жодної ваги не відчиняє Forge', await landing(p, 'index.html') === 'programs.html');
  await ctx.close();
}
{
  /* Повний профіль: усе відчинено, welcome більше не показується. */
  const { ctx, p } = await fresh(adultProfile());
  let bad = [];
  for (const f of PAGES) {
    const got = await landing(p, f);
    const want = f === 'today.html' ? 'index.html' : f; // today — редирект-заглушка
    if (got !== want) bad.push(f + '→' + got);
  }
  ok('1. повний профіль: усі сторінки доступні', bad.length === 0, bad.join(', '));
  ok('1. welcome пройденому веде в застосунок', await landing(p, 'welcome.html') === 'index.html');
  await ctx.close();
}

/* ---- 2. Історія і перезавантаження не пробивають ворота ---- */
{
  const { ctx, p } = await fresh(AGE_ONLY);
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(400);
  ok('2. з головної відвертає на крок', page(p.url()) === 'welcome.html');

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(400);
  ok('2. перезавантаження тримає крок', page(p.url()) === 'welcome.html');

  await p.goBack({ waitUntil: 'load' }).catch(() => {});
  await p.waitForTimeout(400);
  ok('2. «назад» не веде в застосунок', page(p.url()) === 'welcome.html', page(p.url()));

  await p.goForward({ waitUntil: 'load' }).catch(() => {});
  await p.waitForTimeout(400);
  ok('2. «вперед» теж ні', page(p.url()) === 'welcome.html', page(p.url()));
  await ctx.close();
}

/* ---- 3. Підробка localStorage ---- */
{
  const attempts = [
    ['прапорець «пройдено»', Object.assign({}, AGE_ONLY, { onboardingComplete: true, onboarded: true, done: true })],
    ['стать поза словником', Object.assign({}, WITH_PLAN, { sex: 'x', weights: { 'Жим': 60 } })],
    ['вага-нісенітниця', Object.assign({}, WITH_PLAN, { weight: 5000, weights: { 'Жим': 60 } })],
    ['активність не зі списку', Object.assign({}, WITH_PLAN, { activity: 3.7, weights: { 'Жим': 60 } })],
    ['без стажу тренувань', Object.assign({}, WITH_PLAN, { trainingAge: null, weights: { 'Жим': 60 } })],
    ['activePlan без programId', Object.assign({}, WITH_BODY, { activePlan: { days: 3 }, weights: { 'Жим': 60 } })],
    ['ваги з самим сміттям', Object.assign({}, WITH_PLAN, { weights: { 'Жим': 0, 'Тяга': 'важко', 'Присід': -10 } })]
  ];
  for (const [name, prof] of attempts) {
    const { ctx, p } = await fresh(prof);
    const got = await landing(p, 'index.html');
    ok('3. ' + name + ' — не пускає', got !== 'index.html', got);
    await ctx.close();
  }
  /* А чесний мінімум — пускає. */
  const { ctx, p } = await fresh(Object.assign({}, WITH_PLAN, { weights: { 'Присідання зі штангою': 60 } }));
  ok('3. чесний мінімум даних — пускає', await landing(p, 'index.html') === 'index.html');
  await ctx.close();
}

/* ---- 4. Історія користування зараховує онбординг (наявні профілі) ---- */
{
  const legacy = Object.assign({}, AGE_ONLY, { bodyLog: { '2026-01-05': 82.1 } });
  const { ctx, p } = await fresh(legacy);
  ok('4. профіль з журналом ваги не жене по кроках', await landing(p, 'index.html') === 'index.html');
  await ctx.close();
}
{
  /* Але вік історія не скасовує. */
  const minorWithLogs = { version: 6, birthDate: '2012-01-01', bodyLog: { '2026-01-05': 60 } };
  const { ctx, p } = await fresh(minorWithLogs);
  ok('4. журнал не скасовує вік: неповнолітній — на гейт', await landing(p, 'index.html') === 'welcome.html');
  await ctx.close();
}

/* ---- 5. Імпорт резервної копії посеред онбордингу відчиняє все ---- */
{
  const { ctx, p, errs } = await fresh(AGE_ONLY);
  await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await p.waitForTimeout(1000);
  ok('5. account доступний на кроці «тіло»', page(p.url()) === 'account.html');
  ok('5. меню під час онбордингу згорнуте до знака', await p.locator('.nav__links').count() === 0);

  const backup = adultProfile({ bodyLog: { '2026-08-01': 83 }, workLog: { '2026-08-01': 1 } });
  const f = path.join(os.tmpdir(), 'onb-backup.json');
  fs.writeFileSync(f, JSON.stringify(backup));
  await p.setInputFiles('#p-import-file', f);
  await p.waitForTimeout(1400);

  const got = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return { sex: pr.sex, plan: pr.activePlan && pr.activePlan.programId };
  });
  ok('5. копія лягла в профіль', got.sex === 'male' && got.plan === 'fullbody', JSON.stringify(got));

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  ok('5. після імпорту Forge відчинений — онбординг зарахувався сам',
     page(p.url()) === 'index.html', page(p.url()));
  ok('5. і повне меню повернулось', await p.locator('.nav__links').count() === 1);
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Кнопку «Далі» кроку «тіло» не обійти зняттям disabled ---- */
{
  const { ctx, p } = await fresh(AGE_ONLY);
  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  await p.evaluate(() => { const el = document.getElementById('body-go'); el.disabled = false; el.click(); });
  await p.waitForTimeout(700);
  ok('6. зняття disabled без даних нікуди не веде', page(p.url()) === 'welcome.html', page(p.url()));
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('ib.profile') || '{}'));
  ok('6. і сміття у профіль не лягло', !st.sex && !st.weight && !st.height, JSON.stringify({ sex: st.sex, w: st.weight }));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок воріт онбордингу пройшло.');
process.exit(bad ? 1 : 0);
