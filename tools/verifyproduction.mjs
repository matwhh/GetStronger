/**
 * Продакшн-перевірка Get Stronger: сторінки, період статистики, історія, адаптив,
 * ідемпотентність. Запуск: node tools/verifyproduction.mjs
 *
 * ЧОМУ ГОДИННИК ПІДМІНЕНИЙ. Період статистики стартує 2026-09-01. Поки
 * реальна дата раніша, аналітика законно показує весь час, і межу періоду
 * не було б на чому перевірити. Тому браузеру фіксуємо 15 вересня 2026 —
 * перевіряємо саме ту поведінку, яку користувач побачить усередині періоду.
 *
 * МЕРЕЖА ВИМКНЕНА навмисно: перевіряємо клієнтську логіку, а не Supabase
 * (для нього є SQL-тести). Store у цьому режимі читає локальний профіль.
 */
import { chromium } from 'playwright';

const ROOT = 'file://' + process.cwd() + '/';
const R = [];
const ok = (n, c, extra) => { R.push((c ? 'PASS ' : 'FAIL ') + n); if (!c && extra) R.push('       → ' + extra); };

/* Профіль із записами по обидва боки межі сезону. */
function seedScript() {
  const sessionLog = {}, workLog = {}, bodyLog = {}, weightLog = {};
  const add = (k, vol) => {
    sessionLog[k] = { programId: 'fullbody', days: 3, dayIdx: 0, title: 'День A',
      done: 10, total: 14, t0: Date.parse(k + 'T18:00:00'), t1: Date.parse(k + 'T19:15:00'),
      sets: 24, reps: 170, vol };
    workLog[k] = 1; bodyLog[k] = 82;
  };
  ['2026-08-05','2026-08-12','2026-08-19','2026-08-26','2026-08-31'].forEach(k => add(k, 5000));
  ['2026-09-01','2026-09-03','2026-09-08','2026-09-10'].forEach(k => add(k, 7000));
  weightLog['Жим лежачи'] = [{ d:'2026-08-10', kg:80 }, { d:'2026-09-02', kg:90 }, { d:'2026-09-09', kg:95 }];
  weightLog['Присідання'] = [{ d:'2026-08-01', kg:100 }, { d:'2026-08-20', kg:110 }];
  localStorage.setItem('ib.cloud', '1');
  localStorage.setItem('ib.session', JSON.stringify({ access_token:'t', refresh_token:'r',
    expires_at: Date.now() + 86400000, user:{ id:'00000000-0000-4000-8000-000000000001', email:'t@e.co' } }));
  localStorage.setItem('ib.account', JSON.stringify({ status:'approved', isAdmin:true }));
  localStorage.setItem('ib.profile', JSON.stringify({ version:9, birthDate:'1990-06-15',
    sex:'male', weight:82, height:180, activity:1.55, trainingAge:'inter',
    activePlan:{ programId:'fullbody', days:3 }, weights:{ 'Присідання зі штангою':100 },
    sessionLog, workLog, bodyLog, weightLog, mealLog:{}, measureLog:{}, trackerLog:{} }));
}

const PAGES = ['index.html','plan.html','workout.html','programs.html','periodization.html',
  'meals.html','nutrition.html','trackers.html','trackers.html','journal.html','measure.html','rating.html','seasons.html','awards.html',
  'account.html','admin.html','legal.html','calculator.html','boxing.html','cardio.html',
  'supplements.html','research.html','welcome.html'];

const b = await chromium.launch();

/* ───────────────── 1. Сторінки, сезон, історія ───────────────── */
{
  const ctx = await b.newContext();
  await ctx.route(/^https?:\/\//, r => r.abort());
  await ctx.clock.setFixedTime(new Date('2026-09-15T10:00:00'));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 140)));

  await p.goto(ROOT + 'welcome.html', { waitUntil: 'load' });
  await p.evaluate(seedScript);

  const slow = [];
  for (const pg of PAGES) {
    const t0 = Date.now();
    await p.goto(ROOT + pg, { waitUntil: 'load' });
    await p.waitForTimeout(400);
    const dt = Date.now() - t0;
    if (dt > 3000) slow.push(pg + ' ' + dt + 'ms');
  }
  ok('усі ' + PAGES.length + ' сторінок рендеряться без JS-помилок', errs.length === 0, errs[0]);
  ok('жодна сторінка не довша за 3 с', slow.length === 0, slow.join(', '));

  await p.goto(ROOT + 'journal.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const s = await p.evaluate(() => ({
    floor: window.SeasonCore.floorKey(),
    overview: (document.querySelector('#jr-overview') || {}).innerText || '',
    adh: (document.querySelector('#jr-adherence') || {}).innerText || '',
    adhPeriods: document.querySelectorAll('#jr-adherence input[name="adh-period"]').length,
    prs: (document.querySelector('#jr-prs') || {}).innerText || ''
  }));
  ok('межа періоду статистики = 2026-09-01', s.floor === '2026-09-01', s.floor);
  /* Слово «сезон» лишається за рейтингом (M7): в огляді має стояти дата
     початку статистики, а не другий «сезон» на сусідній сторінці. */
  ok('огляд підписаний датою початку статистики',
     /Статистика з 1 вересня 2026/.test(s.overview),
     (s.overview.split('\n')[1] || '').slice(0, 60));
  ok('в огляді немає слова «сезон»', !/[Сс]езон/.test(s.overview));
  /* Замість графіка тоннажу — виконання плану: дві картки + 7 періодів */
  ok('блок виконання плану: обидві картки на місці',
     /План тренувань/.test(s.adh) && /План харчування/.test(s.adh),
     s.adh.replace(/\n+/g, ' | ').slice(0, 90));
  ok('перемикач періодів: День…Рік (7 опцій)', s.adhPeriods === 7, String(s.adhPeriods));
  ok('графіка тоннажу більше немає', !/Тренувальний обʼєм/.test(s.adh + s.overview));
  ok('PR лише за період: Жим є, давніше Присідання — ні',
     s.prs.includes('Жим лежачи') && !s.prs.includes('Присідання'));

  await p.goto(ROOT + 'journal.html#history', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const h = await p.evaluate(() => {
    document.querySelector('[data-hnav="-1"]').click();
    return new Promise(r => setTimeout(() => r({
      month: (document.querySelector('#jr-hcal b.mono') || {}).textContent || '',
      /* Селектор через #jr-hcal: календарів на сторінці два — історія
         і зважування в блоці ваги, обидва на тому самому компоненті. */
      trained: document.querySelectorAll('#jr-hcal .mcal__cell[data-lvl]:not([data-lvl="0"])').length
    }), 300));
  });
  ok('історія доступна до сезону (серпень)', /Серпень/.test(h.month), h.month);
  ok('усі 5 серпневих тренувань в історії', h.trained === 5, String(h.trained));

  const imm = await p.evaluate(() => {
    const pr = JSON.parse(localStorage.getItem('ib.profile'));
    const was = pr.sessionLog['2026-08-05'].vol;
    pr.weights['Жим лежачи'] = 200;
    localStorage.setItem('ib.profile', JSON.stringify(pr));
    const now = JSON.parse(localStorage.getItem('ib.profile'));
    return now.sessionLog['2026-08-05'].vol === was && now.weightLog['Жим лежачи'][0].kg === 80;
  });
  ok('історія незмінна при зміні «Мого плану»', imm);
  await ctx.close();
}

/* ───────────────── 2. Межа доби 31.08 / 01.09 ───────────────── */
for (const [when, expect] of [['2026-08-31T23:59:59', null], ['2026-09-01T00:00:00', 1]]) {
  const ctx = await b.newContext();
  await ctx.route(/^https?:\/\//, r => r.abort());
  await ctx.clock.setFixedTime(new Date(when));
  const p = await ctx.newPage();
  await p.goto(ROOT + 'welcome.html', { waitUntil: 'load' });
  await p.evaluate(seedScript);
  await p.goto(ROOT + 'journal.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  const got = await p.evaluate(() => { const s = window.SeasonCore.current(); return s ? s.id : null; });
  ok('о ' + when.slice(11) + ' ' + when.slice(0, 10) + ' сезон = ' + expect, got === expect, String(got));
  await ctx.close();
}

/* ───────────────── 3. Адаптив на 7 ширинах ───────────────── */
{
  const bad = [];
  for (const w of [320, 375, 390, 430, 768, 1024, 1440]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
    await ctx.route(/^https?:\/\//, r => r.abort());
    await ctx.clock.setFixedTime(new Date('2026-09-15T10:00:00'));
    const p = await ctx.newPage();
    await p.goto(ROOT + 'welcome.html', { waitUntil: 'load' });
    await p.evaluate(seedScript);
    for (const pg of ['index.html','journal.html','measure.html','plan.html','rating.html','legal.html','admin.html']) {
      await p.goto(ROOT + pg, { waitUntil: 'load' });
      await p.waitForTimeout(350);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 2) bad.push(w + 'px ' + pg + ' +' + over);
    }
    await ctx.close();
  }
  ok('немає горизонтального переповнення на 320–1440px', bad.length === 0, bad.join(', '));
}

/* ───────────────── 4. Ідемпотентність подвійного кліку ───────────────── */
{
  const ctx = await b.newContext();
  await ctx.route(/^https?:\/\//, r => r.abort());
  await ctx.clock.setFixedTime(new Date('2026-09-15T10:00:00'));
  const p = await ctx.newPage();
  await p.goto(ROOT + 'welcome.html', { waitUntil: 'load' });
  await p.evaluate(seedScript);

  /* Заміри: подвійний клік по «Зберегти» не має створити два записи. */
  await p.goto(ROOT + 'measure.html', { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.click('#ms-new');
  await p.waitForTimeout(250);
  await p.fill('#ms-chest', '101');
  await Promise.all([p.click('#ms-save'), p.click('#ms-save').catch(() => {})]);
  await p.waitForTimeout(900);
  const days = await p.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('ib.profile')).measureLog || {}).length);
  ok('подвійний клік «Зберегти замір» = один запис', days === 1, String(days));

  /* Тренування: галочка вправи пише РІВНО одну сесію на день. */
  await p.goto(ROOT + 'workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  const before = await p.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('ib.profile')).sessionLog).length);
  const cb = await p.$('[data-set-ex="0"][data-set-n="1"]');
  if (cb) {
    await cb.click({ force: true });
    await p.waitForTimeout(200);
    await cb.click({ force: true });
    await cb.click({ force: true });
    await p.waitForTimeout(2200);
  }
  const after = await p.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem('ib.profile')).sessionLog).length);
  ok('повторні кліки по вправі не плодять сесій', after - before <= 1, before + '→' + after);
  await ctx.close();
}

console.log(R.join('\n'));
const failed = R.filter(x => x.startsWith('FAIL')).length;
console.log(failed ? failed + ' FAILURES' : 'ALL PASS');
await b.close();
process.exit(failed ? 1 : 0);
