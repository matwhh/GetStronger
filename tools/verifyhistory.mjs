/**
 * Історія тренувань: календар, підсумок дня, час сесії.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Журнал показував «Час: 17:27 → 17:27» на кожній
 * сесії: history-core перетирав t0 поточним часом при кожній галочці, бо
 * умова `session.t0 || prev.t0` ніколи не доходила до prev. Юніт-тестів на
 * t0/t1 не було, браузерних перевірок історії — теж, тому баг дожив до
 * продакшену й убив усю статистику тривалості (sessionMinutes вимагає
 * t1 > t0 і повертав null для КОЖНОЇ сесії).
 *
 * Тут перевіряється те, що юніт не бачить: що журнал справді малює
 * календар, що клік по дню відкриває підсумок, і що в підсумку стоять
 * саме ті числа, які лежать у профілі.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

/*
 * Дати рахуємо від «сьогодні», щоб перевірка не протухла через місяць.
 *
 * ДВІ ПАСТКИ, ЧЕРЕЗ ЯКІ ЦЯ ПЕРЕВІРКА ДЕТЕРМІНОВАНО ПАДАЛА 1–4 ЧИСЛА
 * КОЖНОГО МІСЯЦЯ (TIM-008):
 *
 * 1. Ключ рахувався через toISOString() — тобто в UTC. У Києві після
 *    третьої ночі це вже інша дата, ніж локальна, і сесія сіялась не в
 *    той день, який шукає календар.
 * 2. Дні бралися як «−2, −3, −4 від сьогодні» без огляду на межу місяця.
 *    Першого числа всі три опинялись у попередньому місяці, якого календар
 *    не показує: перевірки не знаходили клітинку, а наступний .click() по
 *    відсутньому елементу валив увесь скрипт.
 *
 * Тому ключ локальний, а якір — не «сьогодні», а такий день місяця, від
 * якого −2/−3/−4 гарантовано лишаються в тому самому місяці.
 */
const key = (d) => {
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
};
const at = (d, h, m) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.getTime(); };

const today = new Date();
const now = new Date(today);
if (now.getDate() <= 4) now.setDate(5);   /* якір усередині місяця */

const dGood = new Date(now); dGood.setDate(dGood.getDate() - 2);   // нормальна сесія
const dLegacy = new Date(now); dLegacy.setDate(dLegacy.getDate() - 3); // стара, t0 === t1
const dOld = new Date(now); dOld.setDate(dOld.getDate() - 4);      // зовсім стара, без часу

const K_GOOD = key(dGood), K_LEG = key(dLegacy), K_OLD = key(dOld);

const SEED = {
  birthDate: '1990-06-15', sex: 'male', age: 36, height: 180, weight: 82,
  activity: 1.55, trainingAge: 'inter', hrRest: 58,
  programId: 'fullbody', daysPerWeek: 3,
  activePlan: { programId: 'fullbody', days: 3 },
  weights: { 'Присідання зі штангою': 100 },
  sessionLog: {
    [K_GOOD]: { programId: 'fullbody', days: 3, dayIdx: 0, title: 'Lower',
      done: 6, total: 6, doneSets: 18, totalSets: 18, end: 1,
      t0: at(dGood, 17, 27), t1: at(dGood, 18, 39),
      sets: 18, reps: 180, vol: 7305 },
    [K_LEG]: { programId: 'fullbody', days: 3, dayIdx: 1, title: 'Upper',
      done: 5, total: 6, doneSets: 15, totalSets: 18,
      t0: at(dLegacy, 17, 27), t1: at(dLegacy, 17, 27),
      sets: 15, reps: 150, vol: 5200 },
    [K_OLD]: { programId: 'fullbody', days: 3, dayIdx: 2, title: 'Full',
      done: 4, total: 6 }
  }
};

const ctx = await adultContext(b, { viewport: { width: 420, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));

await p.goto('file://' + ROOT + '/index.html');
await p.evaluate(async (s) => { await window.Store.saveProfile(s); }, SEED);

await p.goto('file://' + ROOT + '/journal.html#history');
await p.waitForTimeout(1200);

/* Календарів на сторінці тепер ДВА: історія і зважування у блоці ваги.
   Обидва — той самий компонент .mcal, тож рахуємо всередині свого
   контейнера, а не по всій сторінці. */
ok('1. історія відкрилась одразу з #history', (await p.locator('#jr-hcal .mcal').count()) === 1);
ok('2. календар намальовано', (await p.locator('#jr-hcal .mcal__cell').count()) > 27,
   String(await p.locator('#jr-hcal .mcal__cell').count()) + ' клітинок');

/* Клас --on прибрано: клітинка тепер несе data-lvl, той самий, що й у
   на «Днях тренувань» (0 — без тренування, 1–4 — частка закритих підходів). */
const onCells = await p.locator('#jr-hcal .mcal__cell[data-lvl]:not([data-lvl="0"])').count();
ok('3. дні з тренуванням зафарбовані', onCells === 3, onCells + ' з 3');
const lvls = await p.locator('#jr-hcal .mcal__cell[data-lvl]:not([data-lvl="0"])')
  .evaluateAll(els => els.map(e => e.dataset.lvl).join(','));
ok('3. рівень заливки той самий, що на «Днях тренувань»', /^[1-4](,[1-4])*$/.test(lvls), lvls);

for (const [k, name] of [[K_GOOD, 'нормальна сесія'], [K_LEG, 'стара з t0=t1'], [K_OLD, 'без часу']]) {
  ok('4. день ' + k + ' клікабельний (' + name + ')',
     (await p.locator('[data-hday="' + k + '"]').count()) === 1);
}

/* ---- нормальна сесія: час, тривалість, факти ---- */
await p.locator('[data-hday="' + K_GOOD + '"]').click();
await p.waitForTimeout(500);
let txt = (await p.locator('main').innerText()).replace(/\s+/g, ' ');
ok('5. показано назву дня', /Lower/.test(txt));
ok('6. час зі стрілкою', /17:27\s*→\s*18:39/.test(txt), txt.match(/Час:[^·]*/)?.[0] || '—');
ok('7. тривалість порахована', /1 год 12 хв/.test(txt),
   txt.match(/1 год[^ ]* ?\d* ?х?в?/)?.[0] || 'НЕМАЄ');
ok('8. підходи й повторення', /18 підходів/.test(txt) && /180 повторень/.test(txt));
ok('9. тоннаж', /7\s?305/.test(txt), txt.match(/≈[^к]*кг/)?.[0] || '—');
ok('10. чіп «18 з 18 підходів»', /18 з 18 підходів/.test(txt));

/* ---- стара сесія t0 === t1: стрілки в саму себе бути не має ---- */
await p.locator('[data-hday="' + K_LEG + '"]').click();
await p.waitForTimeout(500);
txt = (await p.locator('main').innerText()).replace(/\s+/g, ' ');
ok('11. стара сесія: без стрілки в саму себе', !/17:27\s*→\s*17:27/.test(txt),
   txt.match(/Час:[^·]*/)?.[0] || 'рядка «Час» немає');
ok('12. стара сесія: одна позначка часу', /Записано о 17:27/.test(txt),
   txt.match(/Записано о \d\d:\d\d/)?.[0] || 'НЕМАЄ');
ok('13. стара сесія: факти на місці', /15 підходів/.test(txt) && /5\s?200/.test(txt));

/* ---- зовсім стара, без знімка часу ---- */
await p.locator('[data-hday="' + K_OLD + '"]').click();
await p.waitForTimeout(500);
txt = (await p.locator('main').innerText()).replace(/\s+/g, ' ');
ok('14. без часу: сесія показана, а не «нічого не записано»',
   /Full/.test(txt) && !/тренування не записано/.test(txt));
ok('15. без часу: чесно сказано, чому немає цифр',
   /Стара сесія — без знімка часу/.test(txt),
   txt.match(/Стара сесія[^.]*\./)?.[0] || 'фрази немає');
ok('16. без часу: показано «4 з 6 вправ»', /4 з 6 вправ/.test(txt));

/* ---- перемикання місяців ---- */
const monthBefore = await p.locator('#jr-hcal .mcal').locator('xpath=../..').locator('b.mono').first().innerText();
await p.locator('[data-hnav="-1"]').click();
await p.waitForTimeout(400);
const monthAfter = await p.locator('#jr-hcal .mcal').locator('xpath=../..').locator('b.mono').first().innerText();
ok('17. попередній місяць перемикається', monthBefore !== monthAfter, monthBefore + ' → ' + monthAfter);
await p.locator('[data-hnav="1"]').click();
await p.waitForTimeout(400);
ok('18. кнопка «наступний» вимкнена на поточному місяці',
   await p.locator('[data-hnav="1"]').isDisabled());

/* ---- статистика тривалості на сторінці прогресу ---- */
await p.goto('file://' + ROOT + '/journal.html');
await p.waitForTimeout(1000);
const st = await p.evaluate(() => {
  const log = (window.Store.localProfile() || {}).sessionLog || {};
  return {
    minutes: window.ProgressCore.sessionMinutes(log[Object.keys(log).sort().pop()]),
    stats: window.ProgressCore.timeStats(log, 30, Date.now())
  };
});
ok('19. sessionMinutes рахує, а не віддає null', st.minutes !== null, String(st.minutes));
ok('20. timeStats більше не «замало даних»', st.stats !== null, JSON.stringify(st.stats));

ok('21. без JS-помилок', errs.length === 0, errs.join(' | '));

/* ---- 22. Плитки «Сьогодні» влучають у блок вводу ---------------------
   Блоки журналу — порожні <div> у розмітці, вміст малює js/journal.js
   після читання профілю. Браузер стрибає по якорю ДО того, як вміст
   зʼявився, тож без власної доводки (focusHash) посилання з плитки
   лишало людину на початку сторінки. Міряємо те саме, що видно оком:
   де опинився блок відносно прилиплої шапки. */
{
  const ctx2 = await adultContext(b, { viewport: { width: 1200, height: 900 } });
  const q = await ctx2.newPage();
  const e4 = []; q.on('pageerror', (e) => e4.push(e.message));

  /*
   * ЩО ТУТ ЗМІНИЛОСЬ У ВЕРЕСНІ 2026. Плитки «Сьогодні» більше не ведуть
   * у якір журналу — у них зʼявились власні сторінки вводу
   * (train-log.html і weight-log.html, їх стереже verifydaylogs). Але
   * сам якір лишився живим і потрібним: саме ним ці сторінки
   * посилаються назад, у «Прогрес», за статистикою. Тому перевіряємо
   * тепер ПРИХІД за якорем, а не клік по плитці: ламається тут не
   * посилання, а прокрутка — блоки журналу порожні на завантаженні, і
   * браузер стрибає по якорю ще до того, як вони отримають висоту.
   *
   * Якір лишився один: блок тренувань із «Прогресу» прибраний, його
   * сторінка — train-log.html, і назад вона веде на #jr-overview.
   */
  for (const [href, id, name] of [
    ['journal.html#jr-weight', 'jr-weight', 'Зважування']
  ]) {
    /* Порожня сторінка між ітераціями НЕ для чистоти — вона обовʼязкова.
       Два підряд goto на journal.html, що різняться лише якорем, браузер
       вважає переходом усередині документа: сторінка не перезавантажується,
       код доводки якоря не виконується, і другий блок «не влучає». */
    await q.goto('about:blank');
    await q.goto('file://' + ROOT + '/' + href, { waitUntil: 'load' });
    /* Спершу — доки блок узагалі отримає висоту. Блоки журналу порожні
       на завантаженні, і без цього очікування «прокрутка зупинилась»
       справджується миттєво на нулі: сторінка ще нічого не намалювала,
       рухатись їй нікуди, і перевірка міряє порожнечу. */
    await q.waitForFunction((blockId) => {
      const el = document.getElementById(blockId);
      return !!el && el.getBoundingClientRect().height > 100;
    }, id, { timeout: 10000 }).catch(() => {});
    await q.waitForTimeout(400);
    /* Далі чекаємо, доки плавна прокрутка САМА зупиниться, а не фіксовану
       паузу: на завантаженій машині 2,2 с інколи не вистачало, і
       перевірка падала на 8 пікселях недоїханої анімації. Флак у тесті
       гірший за відсутній тест — він вчить не вірити червоному. */
    await q.waitForFunction(() => {
      const y = window.scrollY;
      if (window.__lastY === y) { return (window.__same = (window.__same || 0) + 1) >= 3; }
      window.__lastY = y; window.__same = 0; return false;
    }, null, { timeout: 8000, polling: 120 }).catch(() => {});
    await q.waitForTimeout(200);
    const m = await q.evaluate((blockId) => {
      const el = document.getElementById(blockId);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const nav = document.querySelector('#site-nav');
      const navH = nav ? nav.getBoundingClientRect().height : 0;
      return { top: Math.round(r.top), navH: Math.round(navH), h: Math.round(r.height) };
    }, id);
    /* Верх блоку має бути ПІД шапкою й у межах першого екрана: інакше
       людина дивиться або на шапку, або на сусідній блок. */
    ok('22. плитка «' + name + '» влучає в блок вводу',
       !!m && m.h > 0 && m.top >= m.navH && m.top < m.navH + 60,
       m ? 'top=' + m.top + ' шапка=' + m.navH : 'блока немає');
  }

  /* А плитки на «Сьогодні» тепер ведуть на власні сторінки. Тут це лише
     страховка від тихого відкату: повний набір — у verifydaylogs. */
  await q.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await q.waitForTimeout(1300);
  ok('22. плитка «Тренування» веде на власну сторінку',
     await q.locator('#today a[href="train-log.html"]').count() === 1);
  ok('22. плитка «Зважування» веде на власну сторінку',
     await q.locator('#today a[href="weight-log.html"]').count() === 1);

  ok('22. переходи за якорями без JS-помилок', e4.length === 0, e4.join(' | '));
  await ctx2.close();
}

/* ---- 23. Графік ваги: той самий складений графік, що й у вправі -----
   Раніше це була гола лінія з трьома позначками, без сітки, підказки й
   стовпчиків — інший компонент для тієї самої задачі. Тепер обидва
   графіки сторінки — один візуальний словник, і головне його правило
   стережеться тут: стовпчик і крапка показують ОДНЕ число на ОДНІЙ
   шкалі, тож вершина стовпчика лежить рівно в крапці. */
{
  const ctx4 = await adultContext(b, { viewport: { width: 1300, height: 1000 } });
  const q = await ctx4.newPage();
  const e6 = []; q.on('pageerror', (e) => e6.push(e.message));

  /* Сіємо зважування прямо в сховище: adultContext досипає лише те, чого
     бракує, тож наявний bodyLog переживе його посів. */
  await q.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  const seeded = await q.evaluate(() => {
    const pr = JSON.parse(localStorage.getItem('ib.profile') || '{}');
    const log = {};
    for (let i = 20; i >= 0; i -= 2) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                '-' + String(d.getDate()).padStart(2, '0');
      log[k] = Math.round((82 - (20 - i) * 0.09) * 10) / 10;
    }
    pr.bodyLog = log;
    localStorage.setItem('ib.profile', JSON.stringify(pr));
    return Object.keys(log).length;
  });
  await q.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await q.waitForTimeout(1500);

  ok('23. графік ваги намальовано', await q.locator('#jr-weight svg.exc').count() === 1);
  const g = await q.$eval('#jr-weight svg.exc', (svg) => {
    /* Рядки шкали мають іти РІВНИМ кроком: нерівна шкала (76·80·84·86)
       бреше про відстані сильніше, ніж зайва лінія сітки. */
    const ys = [...svg.querySelectorAll('.exc__ylab')].map((t) => +t.textContent.replace(',', '.').replace(/\s/g, ''));
    let even = ys.length > 2;
    for (let i = 2; i < ys.length; i++) {
      if (Math.abs((ys[i] - ys[i - 1]) - (ys[1] - ys[0])) > 1e-6) even = false;
    }
    /* Крапки не повинні виїжджати за полотно: крайні стоять рівно на
       межах шкали часу, тому поле має інсет. */
    const vbW = +svg.getAttribute('viewBox').split(' ')[2];
    let outside = 0;
    svg.querySelectorAll('.exc__dot').forEach((d) => {
      const cx = +d.getAttribute('cx'), r = +d.getAttribute('r');
      if (cx - r < 0 || cx + r > vbW) outside++;
    });
    return { bars: svg.querySelectorAll('.exc__bar').length,
             rects: svg.querySelectorAll('rect:not(.exc__hit)').length,
             dots: svg.querySelectorAll('.exc__dot').length,
             line: svg.querySelectorAll('.exc__line').length,
             area: svg.querySelectorAll('.wc__area').length,
             grid: svg.querySelectorAll('.exc__grid').length,
             ys: ys, even: even, outside: outside };
  });
  ok('23. стовпчиків немає жодного (стандарт: графік — це лінія)',
     g.bars === 0 && g.rects === 0, JSON.stringify(g));
  ok('23. лінія, заливка й крапка на кожне зважування',
     g.line === 1 && g.area === 1 && g.dots === seeded, JSON.stringify(g));
  ok('23. жодна крапка не зрізана рамкою', g.outside === 0, String(g.outside));
  ok('23. є сітка й підписи шкали', g.grid >= 3 && g.ys.length >= 3, JSON.stringify(g.ys));
  ok('23. крок шкали рівний', g.even, JSON.stringify(g.ys));

  /*
   * КРАПКИ МУСЯТЬ ЛЕЖАТИ НА ЛІНІЇ.
   *
   * Довго графік малював крапки по фактичних зважуваннях, а єдину лінію —
   * по ковзній середній за 7 днів. На папері правильно: вагу читають по
   * середній. На екрані — зламано: крапка на 68,5, лінія над нею на 69,3,
   * і між ними нічого. Ніхто не читає це як «дві різні величини», всі
   * читають як помилку побудови.
   *
   * Тепер ліній дві, і перевіряється саме те, чого бракувало: у графіка
   * є лінія, яка проходить ЧЕРЕЗ його ж крапки. Порівнюються координати,
   * а не наявність елемента: лінія на місці була й раніше.
   */
  const fit = await q.$eval('#jr-weight svg.exc', (svg) => {
    const parse = (el) => (el ? el.getAttribute('d') : '')
      .replace('M', '').split('L')
      .map((s) => s.trim().split(/\s+/).map(Number))
      .filter((a) => a.length === 2 && a.every(Number.isFinite));
    const fact = svg.querySelector('.wc__fact');
    const main = svg.querySelector('.exc__line');
    /* Крапки лежать на лінії ФАКТУ, коли вона є; коли середньої не
       показуємо, факт і є головна лінія. */
    const pts = parse(fact || main);
    const dots = [...svg.querySelectorAll('.exc__dot')]
      .map((d) => [+d.getAttribute('cx'), +d.getAttribute('cy')]);
    let worst = 0;
    dots.forEach((d, i) => {
      if (!pts[i]) { worst = 999; return; }
      worst = Math.max(worst, Math.abs(pts[i][0] - d[0]), Math.abs(pts[i][1] - d[1]));
    });
    return { worst: worst, pts: pts.length, dots: dots.length, hasFact: Boolean(fact) };
  });
  ok('23. лінія проходить рівно через крапки',
     fit.worst <= 0.11 && fit.pts === fit.dots, JSON.stringify(fit));
  ok('23. на довгій історії середня — окрема лінія', fit.hasFact === true, JSON.stringify(fit));

  /*
   * МАЛО ЗАПИСІВ — СЕРЕДНЬОЇ НЕМАЄ ВЗАГАЛІ.
   *
   * Ковзна за 7 днів на двох записах за пʼять днів не згладжує нічого:
   * вона ділить два числа навпіл і малює лінію, якої в даних немає. І
   * саме там розрив із крапками найбільший.
   */
  await q.evaluate(() => {
    const pr = JSON.parse(localStorage.getItem('ib.profile') || '{}');
    const k = (i) => {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
             '-' + String(d.getDate()).padStart(2, '0');
    };
    pr.bodyLog = { [k(4)]: 70, [k(0)]: 68.5 };
    localStorage.setItem('ib.profile', JSON.stringify(pr));
  });
  await q.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await q.waitForTimeout(1500);
  const few = await q.$eval('#jr-weight svg.exc', (svg) => {
    const parse = (el) => (el ? el.getAttribute('d') : '')
      .replace('M', '').split('L')
      .map((s) => s.trim().split(/\s+/).map(Number))
      .filter((a) => a.length === 2 && a.every(Number.isFinite));
    const pts = parse(svg.querySelector('.exc__line'));
    const dots = [...svg.querySelectorAll('.exc__dot')]
      .map((d) => [+d.getAttribute('cx'), +d.getAttribute('cy')]);
    let worst = 0;
    dots.forEach((d, i) => {
      if (!pts[i]) { worst = 999; return; }
      worst = Math.max(worst, Math.abs(pts[i][0] - d[0]), Math.abs(pts[i][1] - d[1]));
    });
    return { fact: svg.querySelectorAll('.wc__fact').length, worst: worst, dots: dots.length };
  });
  ok('23. на двох записах середньої немає', few.fact === 0 && few.dots === 2, JSON.stringify(few));
  ok('23. і єдина лінія йде рівно по крапках', few.worst <= 0.11, JSON.stringify(few));

  /* Повертаємо довгу історію: наступні перевірки блоку писались під неї. */
  await q.evaluate((n) => {
    const pr = JSON.parse(localStorage.getItem('ib.profile') || '{}');
    const log = {};
    for (let i = 20; i >= 0; i -= 2) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - i);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
                '-' + String(d.getDate()).padStart(2, '0');
      log[k] = Math.round((82 - (20 - i) * 0.09) * 10) / 10;
    }
    pr.bodyLog = log;
    localStorage.setItem('ib.profile', JSON.stringify(pr));
    return n;
  }, seeded);
  await q.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await q.waitForTimeout(1500);

  const tip0 = await q.$eval('#w-tip', (el) => {
    const r = el.getBoundingClientRect();
    return { hidden: el.hasAttribute('hidden'), w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok('23. схована підказка справді схована', tip0.hidden && tip0.w === 0 && tip0.h === 0, JSON.stringify(tip0));

  await q.locator('#jr-weight .exc__hit').first().hover();
  await q.waitForTimeout(200);
  const tip1 = await q.$eval('#w-tip', (el) => ({ hidden: el.hasAttribute('hidden'), t: el.innerText }));
  ok('23. наведення дає день, вагу й середню',
     !tip1.hidden && /кг/.test(tip1.t) && /середня/.test(tip1.t), JSON.stringify(tip1));
  ok('23. без JS-помилок', e6.length === 0, e6.join(' | '));
  await ctx4.close();
}

/* ---- 24. Якір не губиться, коли сторінка домальовується ------------
 * Прокрутка до блоку рахується від висоти того, що ВЖЕ намальовано. Але
 * сторінка домальовується й далі: шрифт замінює запасний і переносить
 * рядки, картинки отримують розмір, графік перемальовується під ширину.
 * Кожна така подія зсуває цільовий блок, і людина опиняється не там,
 * куди цілилась.
 *
 * У житті це гонка: та сама сторінка то влучає, то ні. Тут вона зроблена
 * ДЕТЕРМІНОВАНОЮ — після рендера журналу в початок сторінки вставляється
 * блок на 600px, тобто рівно те, що робить шрифт, який доїхав пізніше.
 * Без доводки (див. settle у js/journal.js) блок промахується на ці 600px
 * у КОЖНОМУ прогоні.
 */
{
  const ctx5 = await adultContext(b, { viewport: { width: 1200, height: 900 } });
  await ctx5.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        const top = document.querySelector('#jr-overview');
        if (!top) return;
        const pad = document.createElement('div');
        pad.style.height = '600px';
        pad.id = 'late-content';
        top.parentNode.insertBefore(pad, top);
      }, 600);
    });
  });
  const q = await ctx5.newPage();
  const e7 = []; q.on('pageerror', (e) => e7.push(e.message));
  await q.goto('file://' + ROOT + '/journal.html#jr-weight', { waitUntil: 'load' });
  await q.waitForTimeout(3000);
  const m2 = await q.evaluate(() => {
    const el = document.getElementById('jr-weight');
    const nav = document.querySelector('#site-nav');
    return {
      top: Math.round(el.getBoundingClientRect().top),
      navH: Math.round(nav ? nav.getBoundingClientRect().height : 0),
      late: !!document.getElementById('late-content')
    };
  });
  ok('24. пізній контент справді вставився', m2.late);
  ok('24. якір доводиться після зсуву сторінки',
     m2.top >= m2.navH && m2.top < m2.navH + 60,
     'top=' + m2.top + ' шапка=' + m2.navH);

  /* Доводка мусить негайно здаватись, щойно людина торкнулась прокрутки:
     інтерфейс, який відбирає прокрутку назад, гірший за той, що просто
     промахнувся. */
  await q.evaluate(() => {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    window.scrollTo(0, 0);
  });
  await q.waitForTimeout(900);
  const back = await q.evaluate(() => Math.round(window.scrollY));
  ok('24. після дотику до прокрутки доводка мовчить', back < 30, 'scrollY=' + back);
  ok('24. без JS-помилок', e7.length === 0, e7.join(' | '));
  await ctx5.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок історії пройшло.');
process.exit(bad ? 1 : 0);
