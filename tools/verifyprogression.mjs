/**
 * «ЧАС ДОДАТИ ВАГУ»: ВІДЖЕТ І ВІК РОБОЧОЇ ВАГИ.
 *
 * Юніти стережуть правило (tests/progression-core.test.js). Тут — те,
 * чого ядро не бачить: що віджет стоїть ДРУГИМ блоком, що кнопка справді
 * міняє вагу в профілі й дописує історію, і що відкладення переживає
 * перезавантаження сторінки.
 *
 * ЧОМУ ПОЗИЦІЯ ПІД НАГЛЯДОМ. Підказка, яку треба піти пошукати, не
 * працює — її не шукають. Віджет має сенс рівно доти, доки стоїть одразу
 * під карткою дня; зсунеться на дно сторінки — і сама фіча зникне, хоча
 * жоден юніт не почервоніє.
 */
import { chromium } from 'playwright';
import { adultContext, ONBOARDED } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const file = (n) => 'file://' + ROOT + '/' + n;

/* Понеділок цього тижня; prev(n) — n-й день ПОПЕРЕДНЬОГО тижня. */
const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
const key = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') +
                   '-' + String(x.getDate()).padStart(2, '0');
const prev = (n) => { const x = new Date(mon); x.setDate(x.getDate() - 7 + n); return key(x); };

const EX = (n, sets, r, kg) => ({ n, ps: sets, ds: sets, kg,
  s: Array.from({ length: sets }, () => ({ r, w: kg })) });
const sess = (exs) => ({ end: 1, ex: exs, done: exs.length, total: exs.length,
  programId: 'fullbody', days: 3, dayIdx: 0, title: 'День A',
  doneSets: exs.reduce((a, e) => a + e.ds, 0), totalSets: exs.reduce((a, e) => a + e.ps, 0) });

/*
 * Діапазон повторень береться НЕ з даних програми, а з стажу: resolvePlan
 * проганяє план через reps-core, і для 'inter' виходить 8–10. Саме на
 * цьому перша версія перевірки й попалась — сіяла по 8 повторень,
 * вважала їх верхньою межею, і віджет чесно не зʼявлявся.
 */
const TOP = 10;

/** Профіль: тиждень закрито, «Розгинання ніг» тричі на межі. */
function seed(extra) {
  return Object.assign({}, ONBOARDED, {
    weights: { 'Розгинання ніг': 40, 'Жим у тренажері': 60, 'Шраги у Сміті': 35 },
    weightLog: {
      'Розгинання ніг': [{ d: prev(-20), kg: 40 }],
      'Жим у тренажері': [{ d: prev(-20), kg: 60 }],
      /* Вагу піднято всередині тижня: тренувань на ній менше двох. */
      'Шраги у Сміті': [{ d: prev(3), kg: 35 }]
    },
    sessionLog: {
      [prev(0)]: sess([EX('Розгинання ніг', 4, TOP, 40), EX('Жим у тренажері', 2, TOP, 60),
                       EX('Шраги у Сміті', 3, TOP, 35)]),
      /* Жим недотягнув один раз — його в списку бути не має. */
      [prev(2)]: sess([EX('Розгинання ніг', 4, TOP, 40), EX('Жим у тренажері', 2, TOP - 1, 60)]),
      [prev(4)]: sess([EX('Розгинання ніг', 4, TOP, 40), EX('Шраги у Сміті', 3, TOP, 35)])
    }
  }, extra || {});
}

const b = await chromium.launch({ executablePath: CHROME });

async function open(profile) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 900 },
                                      isMobile: true, hasTouch: true });
  const s = await ctx.newPage();
  await s.goto(file('welcome.html'), { waitUntil: 'load' });
  await s.evaluate((v) => localStorage.setItem('ib.profile', JSON.stringify(v)), profile);
  await s.close();
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  return { ctx, p, errs };
}

/* ---- 1. Коли всі умови збіглися ------------------------------------- */
{
  const { ctx, p, errs } = await open(seed());
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1800);

  const m = await p.evaluate(() => ({
    order: [...document.querySelector('#today').children].map((e) => e.className.split(' ')[0]),
    names: [...document.querySelectorAll('.prg__name')].map((e) => e.innerText.trim()),
    up: [...document.querySelectorAll('[data-prg-up]')].map((e) => e.innerText.trim()),
    ask: (document.querySelector('.prg__why') || {}).innerText || ''
  }));

  /* Віджет стоїть ОДРАЗУ після картки дня — і це головне в ньому. */
  const iWidget = m.order.indexOf('tdy-widget');
  ok('1. віджет — наступний блок після картки дня',
     iWidget >= 0 && m.order[iWidget + 1] === 'card', m.order.join(' → '));

  ok('1. у списку лише дозріла вправа', m.names.join('|') === 'Розгинання ніг', m.names.join('|'));
  ok('1. вправа, що недотягнула повтори, не потрапила', !m.names.includes('Жим у тренажері'));
  ok('1. вправа з щойно піднятою вагою не потрапила', !m.names.includes('Шраги у Сміті'));
  ok('1. ноги беруть крок 5 кг', m.up[0] === 'Так — 45 кг', m.up.join('|'));
  ok('1. віджет питає про запас, бо RIR ніде не записується',
     /2 повтори/.test(m.ask), m.ask.slice(0, 80));
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. «Так» піднімає вагу й лишає слід в історії -------------------- */
{
  const { ctx, p, errs } = await open(seed());
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  await p.locator('[data-prg-up]').first().click();
  await p.waitForTimeout(900);

  const after = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const log = (pr.weightLog || {})['Розгинання ніг'] || [];
    return { kg: (pr.weights || {})['Розгинання ніг'],
             last: log[log.length - 1], card: !!document.querySelector('.prg') };
  });
  ok('2. вага піднялась на крок', after.kg === 45, String(after.kg));
  /* Без запису в історію «вік ваги» не побачив би цього підвищення. */
  ok('2. підвищення лягло в історію ваг', after.last && after.last.kg === 45,
     JSON.stringify(after.last));
  ok('2. віджет зник — питати більше нема про що', after.card === false);
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. «Відкласти» переживає перезавантаження ------------------------ */
{
  const { ctx, p, errs } = await open(seed());
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  await p.locator('[data-prg-snooze]').first().click();
  await p.waitForTimeout(900);
  ok('3. після «відкласти» віджет зник', await p.locator('.prg').count() === 0);

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1800);
  const st = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    return { snooze: ((pr.progression || {})['Розгинання ніг'] || {}).snoozeUntil,
             card: !!document.querySelector('.prg') };
  });
  ok('3. і не повернувся після F5 — рішення збережене',
     st.card === false && !!st.snooze, JSON.stringify(st));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Незакритий тиждень нічого не пропонує ------------------------- */
{
  const p4 = seed();
  delete p4.sessionLog[prev(4)];                 // два дні з трьох
  const { ctx, p, errs } = await open(p4);
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  ok('4. тиждень із пропуском — пропозиції немає', await p.locator('.prg').count() === 0);
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5. Вік ваги на «Прогресі» ---------------------------------------- */
{
  const { ctx, p, errs } = await open(seed());
  await p.goto(file('journal.html'), { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  const t = await p.evaluate(() => ({
    head: (document.querySelector('#jr-stale h2') || {}).innerText || '',
    rows: [...document.querySelectorAll('#jr-stale tbody tr')]
      .map((tr) => [...tr.children].map((td) => td.innerText.trim()))
  }));
  ok('5. картка є', /стоїть вага/i.test(t.head), t.head);
  const leg = t.rows.find((r) => r[0] === 'Розгинання ніг');
  ok('5. рядок містить вагу, дні й тренування', leg && leg.length === 4, JSON.stringify(leg));
  /* Три сесії з цією вправою після зміни ваги — саме стільки й засіяно. */
  ok('5. тренування рахуються від зміни ваги, а не всі підряд',
     leg && leg[3] === '3', leg && leg[3]);
  ok('5. найзастояліша зверху', t.rows[0] && t.rows[0][0] === 'Розгинання ніг',
     t.rows.map((r) => r[0]).join(' | '));
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок прогресії пройшло.');
process.exit(bad ? 1 : 0);
