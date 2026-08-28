/**
 * Тренування як окремий екран.
 *
 * Стереже поділ: «Сьогодні» — короткий огляд і картка-вхід, workout.html —
 * повний екран залу. Плюс те, заради чого поділ і робився: жодного
 * дубля workout-інтерфейсу на головній і жодної другої системи настрою.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const SEED = {
  birthDate: '1990-06-15', sex: 'male', age: 31, height: 181, weight: 81.4, activity: 1.55, goal: 'cut', meals: 4,
  daysPerWeek: 3, activePlan: { programId: 'fullbody', days: 3 }, trainingAge: 'inter'
};

async function open(extra, vp) {
  const ctx = await adultContext(b, vp || { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async s => { await window.Store.saveProfile(s); }, Object.assign({}, SEED, extra || {}));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  return { ctx, p, errs };
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

  const card = p.locator('#tdy-training');
  ok('1. є картка-вхід', await card.count() === 1);
  const txt = await card.innerText();
  ok('1. картка називає програму й день', /Full Body/.test(txt) && /День/.test(txt), txt.replace(/\n+/g, ' | '));
  ok('1. картка називає обсяг', /14 вправ/.test(txt), txt.replace(/\n+/g, ' | '));
  ok('1. картка веде на сторінку тренування',
     (await card.getAttribute('href')) === 'workout.html');
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Перехід туди й назад ---- */
{
  const { ctx, p, errs } = await open();
  await tap(p.locator('#tdy-training'));
  await p.waitForTimeout(1300);
  ok('2. клік по картці відкриває окрему сторінку', p.url().endsWith('workout.html'), p.url().split('/').pop());
  ok('2. це не модалка — головної під нею немає', await p.locator('#today').count() === 0);
  ok('2. усе тренування тут', await p.locator('#workout .tdy-ex').count() === 14);
  ok('2. підходи й RIR на місці',
     /RIR/.test(await p.locator('#workout').innerText()));
  ok('2. поля робочої ваги на місці', await p.locator('#workout [data-wt]').count() === 14);
  ok('2. вибір дня плану на місці', await p.locator('#workout input[name="wk-day"]').count() === 3);
  ok('2. таймер відпочинку на місці', await p.locator('#workout [data-rest-sec]').count() === 14);

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

/* ---- 3. Уся стара логіка тренування працює ---- */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);

  const before = await p.locator('#wk-done').innerText();
  await tap(p.locator('#workout .tdy-ex__main').first());
  await p.waitForTimeout(2400);
  ok('3. галочка рахується', await p.locator('#wk-done').innerText() !== before,
     before + ' → ' + await p.locator('#wk-done').innerText());
  const sess = await p.evaluate(async () => (await window.Store.getProfile()).sessionLog);
  ok('3. сесія пішла в історію', Object.keys(sess || {}).length > 0, JSON.stringify(sess));

  const wt = p.locator('#workout [data-wt]').first();
  const nm = await wt.getAttribute('data-wt');
  await wt.fill('72,5'); await wt.blur();
  await p.waitForTimeout(900);
  const w = await p.evaluate(async n => (await window.Store.getProfile()).weights[n], nm);
  ok('3. робоча вага пише у спільну книгу ваг', w === 72.5, 'w=' + w);

  /* Перехід між полями не краде фокус — той самий сторож, що на «Сьогодні».
     Перевіряємо ДО таймера: його панель стоїть fixed у правому нижньому
     куті й у тесті перехоплювала б клік по полю. */
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
  ok('3. перемикання дня плану працює',
     await p.evaluate(() => document.querySelector('#workout input[name="wk-day"]:checked').value) === '1');
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Стан переживає перезавантаження й видно на «Сьогодні» ---- */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#workout .tdy-ex__main').first());
  await p.waitForTimeout(2400);
  const done = await p.locator('#wk-done').innerText();

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('4. галочка пережила перезавантаження', await p.locator('#wk-done').innerText() === done, done);

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const card = await p.locator('#tdy-training').innerText();
  ok('4. «Сьогодні» показує свіжий прогрес тренування', /Виконано 1 з 14/.test(card),
     card.replace(/\n+/g, ' | '));
  ok('4. і кличе продовжити, а не почати', /Продовжити/.test(card));
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5. Настрій: тільки коли трекер увімкнено ---- */
{
  const { ctx, p, errs } = await open();
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('5. вимкнений трекер — блоку немає взагалі', await p.locator('#wk-mood').count() === 0);

  /* Вмикаємо там, де його й вмикають — на «Відновленні» */
  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const row = p.locator('.tr-row', { hasText: 'Настрій до/після' }).first();
  ok('5. трекер є у списку «Трекери»', await row.count() === 1);
  await tap(row.locator('input[type=checkbox]').first().locator('xpath=..'));
  /* Чекаємо на ЗАПИСАНИЙ стан, а не на секундомір: збереження асинхронне,
     і фіксована пауза інколи закінчувалась раніше за нього. */
  const on = await p.waitForFunction(async () => {
    const pr = await window.Store.getProfile();
    return !!(pr.trackers && pr.trackers.workoutMood && pr.trackers.workoutMood.enabled);
  }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('5. трекер увімкнувся', on);

  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('5. блок настрою зʼявився на сторінці тренування', await p.locator('#wk-mood').count() === 1);
  const mood = await p.locator('#wk-mood').innerText();
  ok('5. обидві шкали названі', /перед тренуванням/.test(mood) && /після тренування/.test(mood),
     mood.replace(/\n+/g, ' | ').slice(0, 90));
  ok('5. блок не заважає почати — це не крок, а картка внизу',
     await p.evaluate(() => {
       const m = document.getElementById('wk-mood');
       const s = document.getElementById('wk-session');
       return m.getBoundingClientRect().top > s.getBoundingClientRect().top;
     }));
  ok('5. на «Сьогодні» блок настрою не зʼявився',
     await (await (async () => { await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' }); await p.waitForTimeout(1300); return p; })())
       .locator('#today [data-trk-pair="workoutMood"]').count() === 0);

  /* Запис прив'язаний до сесії тією ж датою, що й sessionLog */
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('#wk-mood [data-field="before"][data-val="7"]'));
  await p.waitForTimeout(1000);
  const saved = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const key = Object.keys(pr.trackerLog.workoutMood || {})[0];
    return { key: key, val: pr.trackerLog.workoutMood[key] };
  });
  const today = await p.evaluate(() => window.WorkoutCore.todayKey());
  ok('5. настрій ліг у наявний trackerLog.workoutMood', saved.val && saved.val.before === 7,
     JSON.stringify(saved.val));
  ok('5. дата запису = дата сесії', saved.key === today, saved.key + ' / ' + today);

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('5. вибір пережив перезавантаження',
     await p.locator('#wk-mood [data-field="before"][data-val="7"]').getAttribute('aria-pressed') === 'true');
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Мобільний екран ---- */
for (const w of [320, 390, 430]) {
  const { ctx, p, errs } = await open(null, { viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true });
  const home = await p.evaluate(() => document.documentElement.scrollHeight);
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  /* Пороги ті самі, що в tools/verifyresponsive.mjs: кнопки й посилання
     44px, поля вводу 32px. Тут не свій стандарт, а спільний. */
  const m = await p.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    smallBtn: [...document.querySelectorAll('#workout .tdy-ex__rest, .backlink, #workout .btn')]
      .filter(e => e.getBoundingClientRect().height < 44).length,
    smallInput: [...document.querySelectorAll('#workout [data-wt]')]
      .filter(e => e.getBoundingClientRect().height < 32).length
  }));
  ok(w + 'px: «Сьогодні» не список вправ', home < 4200, 'висота ' + home + 'px');
  ok(w + 'px: тренування без горизонтального переповнення', !m.overflow);
  ok(w + 'px: кнопки й повернення ≥ 44px', m.smallBtn === 0, m.smallBtn + ' дрібних');
  ok(w + 'px: поля ваги ≥ 32px', m.smallInput === 0, m.smallInput + ' дрібних');
  ok(w + 'px: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок тренування пройшло.');
process.exit(bad ? 1 : 0);
