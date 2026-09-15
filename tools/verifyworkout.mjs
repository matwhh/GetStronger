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
  /* Робоча вага тепер ТІЛЬКИ показується — міняють її в плані. Раніше
     тут стояла перевірка «поля на місці», і саме вона першою почервоніла
     на правці; замінена на перевірку того, що число видно для кожної
     вправи, а поля вводу немає ніде. */
  ok('2. робоча вага видна для кожної вправи',
     await p.locator('#workout .tdy-ex__wt-val').count() === 14);
  ok('2. і жодного поля вводу робочої ваги', await p.locator('#workout [data-wt]').count() === 0);
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

  /*
   * Тут стояли дві перевірки поля «Робоча вага» — воно писало в книгу
   * ваг просто з тренування. Поля більше немає навмисно (див. розділ 10
   * і коментар у js/workout.js): одна сторінка не має робити «сьогодні я
   * взяв 50» і «віднині моя робоча вага 50» одним жестом.
   *
   * Замість них стережемо протилежне: що вагу звідси НЕ змінити, але
   * видно, і що вага ПІДХОДУ лишилась редагованою — це різні речі, і
   * перша не мусить забрати другу з собою.
   */
  ok('3. робочу вагу з тренування не змінити', await p.locator('#workout [data-wt]').count() === 0);
  ok('3. але вона видна', await p.locator('#workout .tdy-ex__wt-val').count() > 0);

  const row1 = p.locator('#workout .tdy-ex').first();
  await tap(row1.locator('[data-log-tgl]'));
  await p.waitForTimeout(400);
  const setW = row1.locator('[data-setw]').first();
  await setW.fill('72,5'); await setW.press('Enter');
  await p.waitForTimeout(900);
  ok('3. вага підходу редагується й лишається в полі',
     (await setW.inputValue()).replace('.', ',') === '72,5', await setW.inputValue());
  ok('3. і в книгу ваг вона НЕ пішла',
     await p.evaluate(async () => {
       const pr = await window.Store.getProfile();
       return !Object.values(pr.weights || {}).includes(72.5);
     }));

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
  await p.waitForTimeout(600);
  /*
   * Підтвердження більше не системний confirm(), а вікно сайту: воно
   * показує факти, наслідок і цитату, і дає ДВА виходи. Тому перевіряємо
   * розмітку, а не dialogs — і заразом те, що системного вікна тут уже
   * немає (інакше було б два підтвердження поспіль).
   */
  const box = p.locator('.modal__box:has(#wk-fin-end)');
  ok('5. завершення питає вікном сайту, а не системним confirm',
     await box.count() === 1 && dialogs.length === 0,
     'вікон ' + await box.count() + ', системних ' + dialogs.length);
  const txt5 = await box.innerText().catch(() => '');
  ok('5. у вікні є факти виконання', /Виконано\s+\d+\s+з\s+\d+/.test(txt5), txt5.slice(0, 90));
  ok('5. у вікні є наслідок — день не перепройти', /з понеділка/.test(txt5), txt5.slice(0, 140));
  ok('5. у вікні є цитата', await p.evaluate(() =>
     window.FinishCore.QUOTES.some(q => document.querySelector('.modal__box').innerText.includes(q.s))));
  ok('5. дві таблетки — червона і синя',
     await p.locator('#wk-fin-go.pill--red').count() === 1 &&
     await p.locator('#wk-fin-end.pill--blue').count() === 1);
  /* Фокус на «Продовжити»: випадковий Enter має лишати в тренуванні. */
  ok('5. фокус стоїть на «Продовжити»',
     await p.evaluate(() => document.activeElement && document.activeElement.id) === 'wk-fin-go');

  /* Червона таблетка НЕ завершує: вікно зникає, кнопка лишається. */
  await p.locator('#wk-fin-go').click();
  await p.waitForTimeout(400);
  ok('5. «Продовжити» закриває вікно й лишає тренування',
     await box.count() === 0 && await p.locator('#wk-finish').count() === 1);

  /* Escape — теж «продовжити»: завершення незворотне до понеділка. */
  await tap(p.locator('#wk-finish'));
  await p.waitForTimeout(400);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok('5. Escape означає «продовжити», а не «завершити»',
     await box.count() === 0 && await p.locator('#wk-finish').count() === 1);

  /* І аж тепер — синя. */
  await tap(p.locator('#wk-finish'));
  await p.waitForTimeout(400);
  await p.locator('#wk-fin-end').click();
  await p.waitForTimeout(1200);
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

/* ---- 5б. Повністю закритий день завершується без запитань ------------ */
/*
 * Це друга половина правила, і саме заради неї вікно й обмежили.
 * Питати того, хто щойно закрив усі підходи, нема про що: людина, яку
 * питають про очевидне, за тиждень навчається тиснути «так» не читаючи,
 * і попередження перестає працювати там, де воно справді потрібне.
 */
{
  const { ctx, p, errs, dialogs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);

  /* Останній кружечок у рядку закриває всі підходи вправи. */
  const rows = p.locator('#workout .tdy-ex');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const pips = rows.nth(i).locator('[data-set-ex]');
    const c = await pips.count();
    if (c) { await tap(pips.nth(c - 1)); await p.waitForTimeout(120); }
  }
  const done = await p.locator('#wk-done').innerText().catch(() => '');
  const [d, t] = done.split('/').map((x) => parseInt(x, 10));
  ok('5б. усі підходи справді закриті', d === t && d > 0, done);

  await tap(p.locator('#wk-finish'));
  await p.waitForTimeout(900);
  ok('5б. повний день не питає нічого — ні вікна, ні confirm',
     await p.locator('.modal__box:has(#wk-fin-end)').count() === 0 && dialogs.length === 0,
     'вікон ' + await p.locator('.modal__box:has(#wk-fin-end)').count() + ', системних ' + dialogs.length);
  ok('5б. і день одразу завершено', await p.locator('#wk-ended').count() === 1);

  const rec = await p.evaluate(async k => (await window.Store.getProfile()).sessionLog[k], TODAY);
  ok('5б. сесія записана завершеною', rec && rec.end === 1, JSON.stringify(rec).slice(0, 90));
  ok('5б. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Нульове завершення: чесне попередження, день використано ---- */
{
  const { ctx, p, errs, dialogs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#wk-finish'));
  await p.waitForTimeout(600);
  const box6 = p.locator('.modal__box:has(#wk-fin-end)');
  const txt6 = await box6.innerText().catch(() => '');
  ok('6. 0 підходів — окреме попередження про пропуск',
     /Жодного підходу не закрито/.test(txt6) && /як пропуск/.test(txt6),
     txt6.replace(/\n+/g, ' ').slice(0, 160));
  ok('6. і це вікно сайту, а не системне', dialogs.length === 0, String(dialogs.length));
  await p.locator('#wk-fin-end').click();
  await p.waitForTimeout(1000);
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

  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
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

/* ==================================================================== */
/* День із «Сьогодні» відкривається саме той, на який тицьнули            */
/* ==================================================================== */
/*
 * ЩО ЛАМАЛОСЬ. Віджет на головній каже «сьогодні Пуш», а сторінка
 * тренування обирала день сама — «наступний після того, що робили
 * востаннє». Людина тицяла на слово «Пуш» і потрапляла на Пул. Помилка
 * не падає й нічого не псує; вона просто щоразу відкриває не те, і це
 * списують на «так задумано».
 *
 * ЩО ТУТ СТЕРЕЖЕТЬСЯ, крім самого переходу:
 *   • підказка не стирає роботу — день із закритими підходами лишається;
 *   • параметр не залипає в адресі, інакше F5 повертав би людину туди,
 *     звідки вона прийшла годину тому.
 */
{
  const ctx = await adultContext(b, { viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  await p.evaluate(async (seed) => {
    try { await window.Store.saveProfile(seed); } catch (e) { if (!e.queued) throw e; }
  }, Object.assign({}, SEED, { daysPerWeek: 5, activePlan: { programId: 'fullbody', days: 5 } }));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1700);

  /*
   * ДЕНЬ ОБИРАЄМО ЯВНО, А НЕ ЧЕКАЄМО ВІД КАЛЕНДАРЯ.
   *
   * Перевірка питала href у картки «Сьогодні». У плані на 5 днів два дні
   * з семи — відпочинок, і в такий день картка свідомо не посилання, а
   * <div>: відкривати нема чого. Тобто перевірка падала двічі на тиждень
   * і проходила пʼять разів — найгірший вид червоного, бо його списують
   * на випадковість. Тепер тицяємо в смузі тижня перший НЕ вихідний день
   * і питаємо вже про нього.
   */
  const workDay = p.locator('#today .tdy-day:not(.is-rest)').first();
  await workDay.click();
  await p.waitForTimeout(600);
  const href = await p.locator('.tdy-card').getAttribute('href').catch(() => null);
  ok('віджет дня веде на конкретний день', /^workout\.html\?day=\d+$/.test(String(href)), String(href));
  /* І навпаки: у вихідний картка не має бути посиланням — відкривати
     нічого, а мертве посилання гірше за його відсутність. */
  const restDay = p.locator('#today .tdy-day.is-rest').first();
  if (await restDay.count()) {
    await restDay.click();
    await p.waitForTimeout(600);
    ok('у день відпочинку картка не посилання',
      await p.locator('.tdy-card.is-rest').count() === 1 &&
      await p.locator('a.tdy-card').count() === 0);
  }

  /* Номер у посиланні мусить відповідати ТОМУ дню, який показує віджет, —
     а не сьогоднішньому: у смузі тижня можна обрати інший день, і
     відкритись має саме він. */
  const slots = await p.locator('[data-slot]').count();
  let checked = 0;
  for (let i = 0; i < slots; i++) {
    await p.locator('[data-slot]').nth(i).click({ force: true });
    await p.waitForTimeout(120);
    const h = await p.locator('.tdy-card').getAttribute('href').catch(() => null);
    if (!h) continue;                 /* день відпочинку — посилання немає */
    const title = (await p.locator('.tdy-card__title').innerText()).trim();
    const n = Number(String(h).split('=')[1]);
    const real = await p.evaluate((k) => {
      const r = window.WorkoutCore.resolvePlan(window.Store.localProfile());
      return r && r.plan[k] ? (r.plan[k].title || '') : '';
    }, n);
    if (title === real.trim()) checked++;
  }
  ok('номер у посиланні збігається з днем на віджеті', checked >= 3, checked + ' днів звірено');

  /* Перехід за посиланням відкриває саме цей день. */
  await p.goto('file://' + ROOT + '/workout.html?day=2', { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  const picked = await p.evaluate(() => {
    const el = document.querySelector('input[name="wk-day"]:checked');
    return el ? el.value : null;
  });
  ok('?day=2 відкриває третій день плану', picked === '2', String(picked));
  ok('параметр прибрано з адреси', await p.evaluate(() => !/day=/.test(location.search)));

  /* Ручне перемикання переживає перезавантаження: підказка не воскресає. */
  await p.evaluate(() => {
    const r = document.querySelector('input[name="wk-day"][value="4"]');
    r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(500);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1700);
  ok('після F5 лишається день, обраний руками', await p.evaluate(() => {
    const el = document.querySelector('input[name="wk-day"]:checked');
    return el && el.value === '4';
  }));

  /* Найважливіше: почату роботу підказка не чіпає. */
  await p.locator('[data-set-ex]').first().click({ force: true });
  await p.waitForTimeout(500);
  await p.goto('file://' + ROOT + '/workout.html?day=0', { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  ok('день із закритими підходами підказка НЕ перемикає', await p.evaluate(() => {
    const el = document.querySelector('input[name="wk-day"]:checked');
    return el && el.value === '4';
  }), await p.evaluate(() => {
    const el = document.querySelector('input[name="wk-day"]:checked');
    return el ? el.value : 'немає';
  }));

  ok('перехід із «Сьогодні»: без JS-помилок', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ---- 10. Робочу вагу міняють ВІКНОМ, і вага підходу має стелю -------- */
/*
 * Поле «Робоча вага» колись стояло просто на сторінці тренування й писало
 * в книгу ваг на виході з фокуса. Одна сторінка робила дві протилежні
 * речі одним жестом: «сьогодні я взяв 50» і «віднині моя робоча вага 50».
 * Зменшив через втому — план мовчки поїхав униз назавжди, історія ваг
 * отримала подію, якої не було, а прогресія побачила зміну ваги й
 * обнулила лічильник тренувань на ній. Поле прибрали, і «змінити» вело
 * на сторінку плану — тобто виганяло зі сторінки посеред тренування.
 *
 * Тепер правка лишилась тут, але перестала бути випадковою: окреме
 * вікно, окрема кнопка «Зберегти». Стережемо саме це — що МОВЧАЗНОГО
 * запису немає (поля в рядку немає), а свідомий є і доїжджає в книгу ваг.
 *
 * Друге: стеля вводу була спільна, 0–500 на будь-що. Для присідання це
 * майже чесно, для махів гантелями — ні: 300 кг у бічній дельті
 * проходили мовчки й доїжджали до графіків.
 */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);

  ok('10. поля робочої ваги в рядку вправи немає',
     await p.locator('[data-wt]').count() === 0);
  ok('10. але саме число видно', await p.locator('.tdy-ex__wt-val').count() > 0);
  ok('10. і є кнопка, що відкриває вікно правки',
     await p.locator('.tdy-ex__wt-edit[data-wt-edit]').count() > 0);

  /* Вікно: Escape — це «нічого не сталось». */
  await tap(p.locator('[data-wt-edit]').first());
  await p.waitForTimeout(400);
  ok('10. вікно відкрилось із полем ваги й полем повторень',
     await p.locator('.modal #wk-sh-w').count() === 1 &&
     await p.locator('.modal #wk-sh-r').count() === 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('10. Escape закриває вікно', await p.locator('.modal').count() === 0);

  const exName = await p.locator('#workout .tdy-ex__name').first().innerText();
  const wasKg = await p.evaluate(async (n) => {
    const pr = await window.Store.getProfile();
    return Number((pr.weights || {})[n]) || null;
  }, exName);

  await tap(p.locator('[data-wt-edit]').first());
  await p.waitForTimeout(400);
  await p.locator('.modal #wk-sh-w').fill('47,5');
  await p.locator('.modal #wk-sh-r').fill('7');
  await tap(p.locator('.modal [data-sh="yes"]'));
  await p.waitForTimeout(900);

  ok('10. після збереження вікно закрилось', await p.locator('.modal').count() === 0);
  const saved = await p.evaluate(async (n) => {
    const pr = await window.Store.getProfile();
    const log = (pr.weightLog || {})[n] || [];
    return { kg: Number((pr.weights || {})[n]), last: log.length ? Number(log[log.length - 1].kg) : null };
  }, exName);
  ok('10. нова робоча вага в книзі ваг', saved.kg === 47.5, String(saved.kg) + ' (було ' + wasKg + ')');
  ok('10. і подія в історії ваг саме ця', saved.last === 47.5, String(saved.last));
  ok('10. число видно в рядку одразу',
     (await p.locator('#workout .tdy-ex__wt-val').first().innerText()).replace('.', ',') === '47,5',
     await p.locator('#workout .tdy-ex__wt-val').first().innerText());
  ok('10. власне число повторень доїхало в схему',
     /×\s*7(\s|$|\s*·)/.test(await p.locator('#workout .tdy-ex__scheme').first().innerText()),
     await p.locator('#workout .tdy-ex__scheme').first().innerText());

  /* ---- Розминка: одне число замість двох текстових рядків ---- */
  const block = await p.locator('#workout .tdy-ex').first().innerText();
  ok('10. рядка «Підводні» в блоці вправи немає', !/Підводн/i.test(block), block.replace(/\n+/g, ' | ').slice(0, 90));
  ok('10. драбини відсотками в блоці теж немає', !/40\/60\/80/.test(block));
  ok('10. натомість один короткий рядок розминки',
     /Розминка/.test(block) && await p.locator('[data-wu-val]').count() > 0);

  /*
   * РОЗМИНКА ПРАВИТЬСЯ В ТОМУ Ж ВІКНІ, ЩО Й ВАГА.
   *
   * Окрема кнопка біля рядка розминки зникала разом із самим рядком —
   * тобто саме тоді, коли розминку треба ВВІМКНУТИ. Тепер поле стоїть у
   * вікні вправи, а воно є завжди.
   */
  await tap(p.locator('[data-wt-edit]').first());
  await p.waitForTimeout(400);
  ok('10. у вікні вправи є поле розминки',
     await p.locator('.modal #wk-sh-n').count() === 1);
  await p.locator('.modal #wk-sh-n').fill('1');
  await p.waitForTimeout(250);
  ok('10. і воно одразу показує, що дасть',
     /кг/.test(await p.locator('.modal [data-wu-prev]').innerText()),
     await p.locator('.modal [data-wu-prev]').innerText());
  await tap(p.locator('.modal [data-sh="yes"]'));
  await p.waitForTimeout(900);
  ok('10. вибір збережено в профілі',
     await p.evaluate(async (n) => {
       const pr = await window.Store.getProfile();
       return Number((pr.warmups || {})[n]);
     }, exName) === 1);
  ok('10. і рядок каже «1 підхід»',
     /^1 підхід$/.test(await p.locator('[data-wu-val]').first().innerText()),
     await p.locator('[data-wu-val]').first().innerText());

  /* Нуль прибирає рядок зовсім — це й просили: порожнього рядка немає. */
  await tap(p.locator('[data-wt-edit]').first());
  await p.waitForTimeout(400);
  await p.locator('.modal #wk-sh-n').fill('0');
  await tap(p.locator('.modal [data-sh="yes"]'));
  await p.waitForTimeout(900);
  const firstRow = await p.locator('#workout .tdy-ex').first().innerText();
  ok('10. без розминки рядка «Розминка» немає взагалі',
     !/Розминка/.test(firstRow), firstRow.replace(/\n+/g, ' | ').slice(0, 80));
  ok('10. а вікно вправи все одно відкривається',
     await p.locator('[data-wt-edit]').first().count() === 1);

  /*
   * ІЗОЛЯЦІЯ РОЗМИНКИ НЕ ПРОСИТЬ.
   *
   * Сходинки 40/60/80 % мають сенс у присіданнях і жимах, а в біцепсі чи
   * ікрах «розминковий підхід» — це той самий підхід, тільки легший.
   * Рядок про нього стояв у кожній такій вправі без діла. Типова
   * кількість тепер іде від типу вправи (compound/isolation), і саме це
   * тут і стережеться — на живому плані, а не на вигаданій вправі.
   */
  const wuRows = await p.evaluate(() => Array.from(document.querySelectorAll('#workout .tdy-ex')).map((li) => ({
    name: li.querySelector('.tdy-ex__name').textContent.trim(),
    warm: (li.querySelector('[data-wu-val]') || {}).textContent
  })));
  /* «Розминка є» тепер означає ВЕЛИКА група + багатосуглобовий рух:
     трицепс у жимі вузьким хватом — теж compound, але вага там мала. */
  const kinds = await p.evaluate((names) => names.map((n) => {
    const e = (window.EXERCISES || []).find((x) => x.name === n);
    if (!e || e.lift !== 'compound') return 'isolation';
    return window.RepsCore.sizeOf(e) === 'large' ? 'compound' : 'isolation';
  }), wuRows.map((r) => r.name));

  const isoWarmed = wuRows.filter((r, i) => kinds[i] === 'isolation' && r.warm != null);
  ok('10. в ізоляції рядка розминки немає жодного',
     isoWarmed.length === 0,
     isoWarmed.map((r) => r.name + ': ' + r.warm).slice(0, 3).join(' | '));

  /* Вага ПІДХОДУ лишається редагованою — це факт одного дня. */
  const first = p.locator('#workout .tdy-ex').first();
  await tap(first.locator('[data-set-ex]').first());
  await p.waitForTimeout(300);
  await tap(first.locator('[data-log-tgl]'));
  await p.waitForTimeout(300);

  const name = await first.locator('.tdy-ex__name').innerText();
  const cap = await p.evaluate((n) => window.WeightLimits.maxFor(n), name);
  ok('10. стеля своя, а не спільні 500', cap > 0 && cap !== 500, name + ' → ' + cap);

  const w = first.locator('[data-setw]').first();
  await w.fill(String(cap + 100));
  await w.press('Enter');
  await p.waitForTimeout(600);
  const after = await w.inputValue();
  ok('10. нереальна вага не приймається', after !== String(cap + 100), 'у полі: ' + after);
  ok('10. і сказано, яка межа',
     /до \s*' + cap + '\s*кг/.test(await p.locator('.toast').first().innerText().catch(() => '')) ||
     (await p.locator('.toast').first().innerText().catch(() => '')).includes(String(cap)),
     await p.locator('.toast').first().innerText().catch(() => '—'));

  await w.fill(String(Math.round(cap / 2)));
  await w.press('Enter');
  await p.waitForTimeout(600);
  ok('10. нормальна вага приймається', await w.inputValue() === String(Math.round(cap / 2)),
     await w.inputValue());
  ok('10. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок тренування пройшло.');
process.exit(bad ? 1 : 0);
