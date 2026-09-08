/**
 * Тренування як окремий екран + механіка завершення.
 *
 * Стереже поділ «Сьогодні»/workout.html і нову логіку залу:
 * підходи-кнопки замість галочок, «≈N хв залишилось», явна кнопка
 * «Завершити тренування», блокування завершеного дня до понеділка,
 * зняття блоку новим тижнем, чесний запис сесії в історію.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const SEED = {
  birthDate: '1990-06-15', sex: 'male', age: 31, height: 181, weight: 81.4, activity: 1.55, goal: 'cut', meals: 4,
  daysPerWeek: 3, activePlan: { programId: 'fullbody', days: 3 }, trainingAge: 'inter'
};

/* Локальні дати для сценаріїв тижня — та сама арифметика, що в ядрі */
function key(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
const NOW = new Date();
const TODAY = key(NOW);
const MONDAY = key(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - ((NOW.getDay() + 6) % 7)));
const LAST_WEEK = key(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - ((NOW.getDay() + 6) % 7) - 3));

async function open(extra, vp) {
  const ctx = await adultContext(b, vp || { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  const dialogs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async s => { await window.Store.saveProfile(s); }, Object.assign({}, SEED, extra || {}));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  return { ctx, p, errs, dialogs };
}
const tap = async (l) => { await l.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {}); return l.click({ timeout: 6000 }); };

/* ---- 1. «Сьогодні» більше не містить розгорнутого тренування ---- */
{
  const { ctx, p, errs } = await open();
  ok('1. на «Сьогодні» немає списку вправ', await p.locator('#today .tdy-ex').count() === 0);
  ok('1. немає полів робочої ваги', await p.locator('#today [data-wt]').count() === 0);
  ok('1. немає вибору дня плану', await p.locator('#today input[name="tdy-day"]').count() === 0);
  ok('1. немає кнопок таймера відпочинку', await p.locator('#today [data-rest-sec]').count() === 0);
  ok('1. немає блоку настрою', await p.locator('#today [data-trk-pair="workoutMood"]').count() === 0);

  /*
   * КАРТКИ-ВХОДУ БІЛЬШЕ НЕМАЄ.
   *
   * «Сьогодні» перебрано до назви програми й смуги тижня, тож перевірки
   * її вмісту (назва дня, обсяг, час, href) знято — вони перевіряли те,
   * чого на екрані немає. Суть цього блоку від початку була в іншому: на
   * «Сьогодні» НЕ МАЄ бути другого редактора тренування. Це й лишилось —
   * разом із тим, що назву програми екран усе-таки називає, і вона та
   * сама, що на сторінці тренування.
   */
  const txt = await p.locator('#today').innerText();
  ok('1. екран називає програму', /Full Body/.test(txt), txt.replace(/\n+/g, ' | ').slice(0, 60));
  ok('1. вхід у тренування — через навігацію',
     await p.locator('a[href="workout.html"]').count() >= 1);
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Перехід туди й назад ---- */
{
  const { ctx, p, errs } = await open();
  /* Раніше сюди заходили кліком по картці-входу на «Сьогодні». Картки
     немає, а пункт навігації на вузькому екрані лежить у згорнутому
     меню — тож переходимо адресою. Питання блоку від цього не міняється:
     тренування живе на ОКРЕМІЙ сторінці, а не модалкою поверх головної. */
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('2. перехід відкриває окрему сторінку', p.url().endsWith('workout.html'), p.url().split('/').pop());
  ok('2. це не модалка — головної під нею немає', await p.locator('#today').count() === 0);
  ok('2. усе тренування тут', await p.locator('#workout .tdy-ex').count() === 14);
  ok('2. підходи й RIR на місці',
     /RIR/.test(await p.locator('#workout').innerText()));
  ok('2. поля робочої ваги на місці', await p.locator('#workout [data-wt]').count() === 14);
  ok('2. вибір дня плану на місці', await p.locator('#workout input[name="wk-day"]').count() === 3);
  ok('2. таймер відпочинку на місці', await p.locator('#workout [data-rest-sec]').count() === 14);
  ok('2. кнопки підходів відрендерені', await p.locator('#workout [data-set-ex]').count() > 14);
  ok('2. є кнопка «Завершити тренування»', await p.locator('#wk-finish').count() === 1);
  ok('2. видно «≈N хв залишилось»', /≈\d+ хв залишилось/.test(await p.locator('#wk-eta').innerText()));

  const back = p.locator('.backlink');
  ok('2. є явне повернення на «Сьогодні»', await back.count() === 1 &&
     (await back.getAttribute('href')) === 'index.html');
  const bb = await back.boundingBox();
  ok('2. ціль повернення ≥ 44px', bb && bb.height >= 44, bb ? Math.round(bb.height) + 'px' : '—');
  ok('2. розділ «Тренування» підсвічений у панелі',
     await p.locator('#tabbar .tabbar__item.is-active').innerText() === 'Тренування',
     await p.locator('#tabbar .tabbar__item.is-active').innerText());

  await tap(back);
  await p.waitForTimeout(1200);
  ok('2. повернення працює', p.url().endsWith('index.html'), p.url().split('/').pop());
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Підходи, час, ваги, таймер, перемикання дня ---- */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);

  const etaBefore = parseInt((await p.locator('#wk-eta').innerText()).replace(/\D+/g, ''), 10);
  const before = await p.locator('#wk-done').innerText();

  /* Тап по другому підходу першої вправи закриває 1 і 2 */
  await tap(p.locator('#workout .tdy-ex').first().locator('[data-set-n="2"]'));
  await p.waitForTimeout(300);
  const after = await p.locator('#wk-done').innerText();
  ok('3. тап по n-му підходу закриває 1..n', after.startsWith('2/'), before + ' → ' + after);

  const etaAfter = parseInt((await p.locator('#wk-eta').innerText()).replace(/\D+/g, ''), 10);
  ok('3. час, що залишився, зменшився', etaAfter < etaBefore, etaBefore + ' → ' + etaAfter + ' хв');

  /* Повторний тап по останньому закритому — відкат на один */
  await tap(p.locator('#workout .tdy-ex').first().locator('[data-set-n="2"]'));
  await p.waitForTimeout(300);
  ok('3. повторний тап відкочує підхід', (await p.locator('#wk-done').innerText()).startsWith('1/'));

  await p.waitForTimeout(2200);
  const sess = await p.evaluate(async () => (await window.Store.getProfile()).sessionLog);
  const rec = sess && sess[Object.keys(sess)[0]];
  ok('3. сесія пішла в історію з підходами', rec && rec.doneSets === 1 && rec.totalSets > 10,
     JSON.stringify(rec).slice(0, 120));
  ok('3. сесія ще НЕ завершена (без end)', rec && !rec.end);

  const wt = p.locator('#workout [data-wt]').first();
  const nm = await wt.getAttribute('data-wt');
  await wt.fill('72,5'); await wt.blur();
  await p.waitForTimeout(900);
  const w = await p.evaluate(async n => (await window.Store.getProfile()).weights[n], nm);
  ok('3. робоча вага пише у спільну книгу ваг', w === 72.5, 'w=' + w);

  const ins = p.locator('#workout [data-wt]');
  await ins.nth(1).click(); await ins.nth(1).fill('40');
  await ins.nth(2).click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(900);
  ok('3. фокус не падає при переході між полями ваги',
     await p.evaluate(() => document.activeElement.tagName) === 'INPUT',
     await p.evaluate(() => document.activeElement.tagName));

  await tap(p.locator('#workout [data-rest-sec]').first());
  await p.waitForTimeout(500);
  ok('3. таймер відпочинку запускається', await p.locator('.rest-timer').isVisible());

  await tap(p.locator('#workout input[name="wk-day"]').nth(1).locator('xpath=..'));
  await p.waitForTimeout(900);
  ok('3. перемикання дня плану працює (з confirm при прогресі)',
     await p.evaluate(() => document.querySelector('#workout input[name="wk-day"]:checked').value) === '1');
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Стан переживає перезавантаження й видно на «Сьогодні» ---- */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#workout .tdy-ex').first().locator('[data-set-n="1"]'));
  await p.waitForTimeout(2400);
  const done = await p.locator('#wk-done').innerText();

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('4. підхід пережив перезавантаження', await p.locator('#wk-done').innerText() === done, done);

  /* Раніше свіжий прогрес звіряли з карткою на «Сьогодні». Картки немає
     (екран перебрано), тож те саме питання — «стан пережив ПЕРЕХІД, а не
     лише перезавантаження» — ставиться круговим маршрутом: пішли на
     головну, повернулись, лічильник на місці. */
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1000);
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  ok('4. прогрес пережив перехід на головну й назад',
     await p.locator('#wk-done').innerText() === done, done);
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5. «Завершити тренування»: частково → заблоковано до понеділка ---- */
{
  const { ctx, p, errs, dialogs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);

  /* Закриваємо всі підходи перших двох вправ + один третьої */
  for (const [row, n] of [[0, 3], [1, 3], [2, 1]]) {
    const pips = p.locator('#workout .tdy-ex').nth(row).locator('[data-set-ex]');
    const cnt = await pips.count();
    await tap(pips.nth(Math.min(n, cnt) - 1));
    await p.waitForTimeout(150);
  }
  const doneTxt = await p.locator('#wk-done').innerText();

  await tap(p.locator('#wk-finish'));
  await p.waitForTimeout(1200);
  ok('5. завершення питає підтвердження з фактами',
     dialogs.some(d => /Завершити тренування\?/.test(d) && /з понеділка/.test(d)),
     dialogs.join(' || ').slice(0, 140));
  ok('5. зʼявився статус завершення', await p.locator('#wk-ended').count() === 1,
     (await p.locator('#wk-ended').innerText().catch(() => '')).replace(/\n+/g, ' '));
  ok('5. кнопки завершення більше немає', await p.locator('#wk-finish').count() === 0);
  ok('5. підходи заблоковані', await p.locator('#workout [data-set-ex]:not([disabled])').count() === 0);

  const rec = await p.evaluate(async k => (await window.Store.getProfile()).sessionLog[k], TODAY);
  ok('5. сесія записана як завершена (end=1)', rec && rec.end === 1, JSON.stringify(rec).slice(0, 100));
  ok('5. підсумок по підходах чесний', rec && String(rec.doneSets) === doneTxt.split('/')[0],
     rec && rec.doneSets + ' / екран ' + doneTxt);
  ok('5. знімок вправ для аналітики на місці',
     rec && Array.isArray(rec.ex) && rec.ex.length === 14 && rec.ex[0].ps > 0,
     rec && rec.ex ? rec.ex.length + ' вправ' : '—');

  /* Перезавантаження: блокування живе в профілі, а не в памʼяті вкладки */
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('5. після reload день ЛИШАЄТЬСЯ завершеним', await p.locator('#wk-ended').count() === 1);
  ok('5. і підходи лишаються заблокованими',
     await p.locator('#workout [data-set-ex]:not([disabled])').count() === 0);

  /* Інший день того самого дня календаря — теж недоступний: одна сесія на день */
  await tap(p.locator('#workout input[name="wk-day"]').nth(2).locator('xpath=..'));
  await p.waitForTimeout(800);
  ok('5. другий день сьогодні не почати (одна сесія на день)',
     /вже завершене/.test(await p.locator('#workout').innerText()));

  /* Завершення теж більше не переказується на «Сьогодні». Питання
     лишається тим самим: після відходу зі сторінки й повернення день
     ЗАЛИШАЄТЬСЯ закритим, а не відкривається наново. */
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1000);
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const wk = await p.locator('#workout').innerText();
  ok('5. після повернення день і далі закритий',
     /завершен/i.test(wk), wk.replace(/\n+/g, ' | ').slice(0, 90));
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Нульове завершення: чесне попередження, день використано ---- */
{
  const { ctx, p, errs, dialogs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#wk-finish'));
  await p.waitForTimeout(1000);
  ok('6. 0 підходів — окреме попередження про пропуск',
     dialogs.some(d => /нульовим виконанням/.test(d) && /пропуск/.test(d)),
     dialogs.join(' || ').slice(0, 140));
  const rec = await p.evaluate(async k => (await window.Store.getProfile()).sessionLog[k], TODAY);
  ok('6. сесія 0/N записана завершеною', rec && rec.end === 1 && rec.doneSets === 0,
     JSON.stringify(rec).slice(0, 90));
  ok('6. день заблоковано', await p.locator('#wk-finish').count() === 0);
  ok('6. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 7. Тижневий цикл: завершене ЦЬОГО тижня блокує, МИНУЛОГО — ні ---- */
{
  /* День 0 завершено в понеділок цього тижня (не сьогодні, якщо сьогодні
     не понеділок). Очікування: день 0 заблокований, інші дні доступні. */
  const seeded = {
    sessionLog: {}
  };
  seeded.sessionLog[MONDAY] = {
    programId: 'fullbody', days: 3, dayIdx: 0, title: 'День 1',
    done: 14, total: 14, doneSets: 40, totalSets: 40, end: 1
  };
  const { ctx, p, errs } = await open(seeded);
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);

  /* Свіжий день пропонує перший НЕзавершений (день 2), а не замкнений */
  const picked = await p.evaluate(() => document.querySelector('#workout input[name="wk-day"]:checked').value);
  const mondayIsToday = MONDAY === TODAY;
  ok('7. пропонується перший доступний день', mondayIsToday || picked !== '0', 'обрано день ' + picked);

  /* Перемикаємось на завершений день 0 — він у режимі перегляду */
  await tap(p.locator('#workout input[name="wk-day"]').nth(0).locator('xpath=..'));
  await p.waitForTimeout(800);
  ok('7. завершений день показує статус і дату', /Завершено/.test(await p.locator('#workout').innerText()));
  ok('7. його підходи заблоковані',
     await p.locator('#workout [data-set-ex]:not([disabled])').count() === 0);
  ok('7. кнопки завершення немає', await p.locator('#wk-finish').count() === 0);

  /* А незавершений день (якщо сьогодні не той самий понеділок) — робочий */
  if (!mondayIsToday) {
    await tap(p.locator('#workout input[name="wk-day"]').nth(1).locator('xpath=..'));
    await p.waitForTimeout(800);
    ok('7. інший день тижня доступний', await p.locator('#wk-finish').count() === 1);
  } else {
    ok('7. (сьогодні понеділок — «інший день» перевіряє сценарій 8)', true);
  }
  ok('7. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 8. Новий тиждень знімає блокування сам ---- */
{
  const seeded = { sessionLog: {} };
  seeded.sessionLog[LAST_WEEK] = {
    programId: 'fullbody', days: 3, dayIdx: 0, title: 'День 1',
    done: 14, total: 14, doneSets: 40, totalSets: 40, end: 1
  };
  const { ctx, p, errs } = await open(seeded);
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#workout input[name="wk-day"]').nth(0).locator('xpath=..'));
  await p.waitForTimeout(800);
  ok('8. день, завершений минулого тижня, знову доступний',
     await p.locator('#wk-finish').count() === 1);
  ok('8. підходи знову активні',
     await p.locator('#workout [data-set-ex]:not([disabled])').count() > 0);
  ok('8. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 9. Настрій: тільки коли трекер увімкнено ---- */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('9. вимкнений трекер — блоку немає взагалі', await p.locator('#wk-mood').count() === 0);

  await p.goto('file://' + ROOT + '/trackers-settings.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const row = p.locator('.tr-row', { hasText: 'Настрій до/після' }).first();
  ok('9. трекер є у списку «Трекери»', await row.count() === 1);
  await tap(row.locator('input[type=checkbox]').first().locator('xpath=..'));
  const on = await p.waitForFunction(async () => {
    const pr = await window.Store.getProfile();
    return !!(pr.trackers && pr.trackers.workoutMood && pr.trackers.workoutMood.enabled);
  }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('9. трекер увімкнувся', on);

  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('9. блок настрою зʼявився на сторінці тренування', await p.locator('#wk-mood').count() === 1);
  await tap(p.locator('#wk-mood [data-field="before"][data-val="7"]'));
  await p.waitForTimeout(1000);
  const saved = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const key = Object.keys(pr.trackerLog.workoutMood || {})[0];
    return { key: key, val: pr.trackerLog.workoutMood[key] };
  });
  ok('9. настрій ліг у trackerLog.workoutMood за сьогодні',
     saved.val && saved.val.before === 7 && saved.key === TODAY, JSON.stringify(saved));
  ok('9. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 10. Мобільний екран ---- */
for (const w of [320, 390, 430]) {
  const { ctx, p, errs } = await open(null, { viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true });
  const home = await p.evaluate(() => document.documentElement.scrollHeight);
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const m = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    smallBtn: [...document.querySelectorAll('#workout .tdy-ex__rest, .backlink, #workout .btn, #workout .tdy-ex__set')]
      .filter(e => e.getBoundingClientRect().height < 44).length,
    smallInput: [...document.querySelectorAll('#workout [data-wt]')]
      .filter(e => e.getBoundingClientRect().height < 32).length
  }));
  ok(w + 'px: «Сьогодні» не список вправ', home < 4200, 'висота ' + home + 'px');
  ok(w + 'px: тренування без горизонтального переповнення', !m.overflow);
  ok(w + 'px: кнопки, підходи й повернення ≥ 44px', m.smallBtn === 0, m.smallBtn + ' дрібних');
  ok(w + 'px: поля ваги ≥ 32px', m.smallInput === 0, m.smallInput + ' дрібних');
  ok(w + 'px: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок тренування пройшло.');
process.exit(bad ? 1 : 0);
