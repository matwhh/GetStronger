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
   теплокарті (0 — без тренування, 1–4 — частка закритих підходів). */
const onCells = await p.locator('#jr-hcal .mcal__cell[data-lvl]:not([data-lvl="0"])').count();
ok('3. дні з тренуванням зафарбовані', onCells === 3, onCells + ' з 3');
const lvls = await p.locator('#jr-hcal .mcal__cell[data-lvl]:not([data-lvl="0"])')
  .evaluateAll(els => els.map(e => e.dataset.lvl).join(','));
ok('3. рівень заливки той самий, що в теплокарті', /^[1-4](,[1-4])*$/.test(lvls), lvls);

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

  for (const [href, id, name] of [
    ['journal.html#jr-train',  'jr-train',  'Тренування'],
    ['journal.html#jr-weight', 'jr-weight', 'Зважування']
  ]) {
    await q.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
    await q.waitForTimeout(1300);
    const tile = q.locator('a[href="' + href + '"]');
    ok('22. плитка «' + name + '» є на «Сьогодні»', await tile.count() === 1);
    await tile.click();
    await q.waitForTimeout(2200);
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
  ok('22. переходи з плиток без JS-помилок', e4.length === 0, e4.join(' | '));
  await ctx2.close();
}

/* ---- 23. Календар зважувань: вибір дня й запис у нього --------------
   Той самий компонент, що в історії, але з іншою роллю: клік не пише
   нічого сам, він переводить поле вводу на обраний день. Стережемо саме
   це — щоб «Записати» не почало мовчки писати в сьогодні. */
{
  const ctx3 = await adultContext(b, { viewport: { width: 1300, height: 1000 } });
  const q = await ctx3.newPage();
  const e5 = []; q.on('pageerror', (e) => e5.push(e.message));
  await q.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await q.waitForTimeout(1500);

  ok('23. у блоці ваги є календар', await q.locator('#jr-weight .mcal').count() === 1);
  ok('23. поле пише в сьогодні за замовчуванням',
     /Сьогодні/.test(await q.locator('#jr-weight label[for="w-kg"]').innerText()));

  /* Беремо позавчора: він точно в минулому й точно в вікні календаря. */
  const back = await q.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() - 2);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  });
  await q.locator('#jr-weight [data-wday="' + back + '"]').click();
  await q.waitForTimeout(600);
  ok('23. клік по дню переводить поле на цей день',
     !/Сьогодні/.test(await q.locator('#jr-weight label[for="w-kg"]').innerText()),
     await q.locator('#jr-weight label[for="w-kg"]').innerText());
  ok('23. зʼявилась кнопка повернення в сьогодні', await q.locator('#w-today').count() === 1);

  await q.fill('#w-kg', '77,7');
  await q.click('#w-add');
  await q.waitForTimeout(900);
  const saved = await q.evaluate(async (k) => {
    const pr = await window.Store.getProfile();
    return { at: (pr.bodyLog || {})[k], today: (pr.bodyLog || {})[
      new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') +
      '-' + String(new Date().getDate()).padStart(2, '0')] };
  }, back);
  ok('23. запис пішов у ОБРАНИЙ день, а не в сьогодні',
     saved.at === 77.7 && saved.today === undefined, JSON.stringify(saved));
  ok('23. клітинка того дня стала заповненою',
     (await q.locator('#jr-weight [data-wday="' + back + '"]').getAttribute('data-lvl')) === '4');

  await q.locator('#w-today').click();
  await q.waitForTimeout(600);
  ok('23. «Сьогодні» повертає поле назад',
     /Сьогодні/.test(await q.locator('#jr-weight label[for="w-kg"]').innerText()));
  ok('23. без JS-помилок', e5.length === 0, e5.join(' | '));
  await ctx3.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок історії пройшло.');
process.exit(bad ? 1 : 0);
