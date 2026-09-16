/**
 * Перехресне тренерство в живому браузері.
 *
 * Два сценарії, заради яких усе й робилось:
 *
 *   1. Людина третій тиждень худне. Картка «Час додати вагу» мусить
 *      перетворитись на «Вага: тримати», сказати ЧОМУ (вага тіла за
 *      місяць) і поставити під палець кнопку «лишити», а не «+2,5».
 *   2. Вага в журналі стоїть місяць. Таблиця «Скільки стоїть вага»
 *      мусить назвати причину з СУСІДНЬОГО журналу — і назвати одну
 *      лише тоді, коли доказ однозначний.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const SEED = {
  birthDate: '1990-06-15', sex: 'male', age: 31, height: 181, weight: 82,
  activity: 1.55, goal: 'cut', meals: 4, daysPerWeek: 3,
  activePlan: { programId: 'fullbody', days: 3 }, trainingAge: 'inter'
};

/**
 * Готовий профіль: план закрито як належить, вага тіла падає (або ні).
 * Вага вправи стоїть весь час — це й є плато, яке треба пояснити.
 */
async function seed(p, opts) {
  await p.evaluate(async (a) => {
    const D = window.DateCore;
    const today = D.todayKey();
    const bodyLog = {}, mealLog = {}, sessionLog = {}, weightLog = {};

    /* Вага тіла за 28 днів */
    for (let i = 0; i < 28; i++) {
      const k = D.shiftKey(today, -(27 - i));
      bodyLog[k] = Math.round((82 + a.bodyDelta * i / 27) * 1000) / 1000;
      mealLog[k] = { kcal: 2400, p: a.protein, target: 2600, pTarget: 170 };
    }

    /* Закриваємо вправу на ВЕРХНІЙ межі повторень через день: саме це
       й означає «час додати вагу» для js/progression-core.js. */
    const name = a.name;
    weightLog[name] = [{ d: D.shiftKey(today, -60), kg: 60 }];

    for (let back = 27; back >= 0; back--) {
      if (back % 2 !== 1) continue;                 // через день
      const k = D.shiftKey(today, -back);
      const s = [];
      for (let j = 0; j < 3; j++) {
        const rec = { w: 60, r: a.reps };
        if (a.rir !== null && a.rir !== undefined) rec.q = a.rir;
        s.push(rec);
      }
      sessionLog[k] = {
        programId: 'fullbody', days: 3, dayIdx: 0, title: 'День 1',
        done: 1, total: 1, sets: 3, reps: a.reps * 3, vol: 60 * a.reps * 3,
        end: 1, t0: 1, t1: 1 + 60 * 60000,
        ex: [{ n: name, ds: 3, ps: 3, kg: 60, r: a.reps, s: s }]
      };
    }

    const pr = await window.Store.getProfile();
    await window.Store.saveProfile(Object.assign({}, pr, a.seed, {
      bodyLog: bodyLog, mealLog: mealLog, sessionLog: sessionLog,
      weightLog: weightLog, weights: Object.assign({}, pr.weights, { [name]: 60 })
    }));
  }, opts);
}

/*
 * Вправу й верхню межу повторень беремо З ЖИВОГО ПЛАНУ, а не з рядка в
 * коді. Назви й діапазони в програмах міняються (і вже мінялись), а
 * прогресія вимагає закритої ВЕРХНЬОЇ межі — тест, який ставить своє
 * число, перевіряв би не те й мовчки зеленів би на зламаному.
 */
async function planPick(p) {
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  return p.evaluate(() => {
    const rows = [...document.querySelectorAll('#workout .tdy-ex')];
    for (const row of rows) {
      const name = row.querySelector('.tdy-ex__name');
      const scheme = row.querySelector('.tdy-ex__scheme');
      if (!name || !scheme) continue;
      const nums = (scheme.textContent.match(/\d+/g) || []).map(Number);
      if (nums.length < 3) continue;
      return { name: name.textContent.trim(), top: Math.max(nums[1], nums[2]) };
    }
    return null;
  });
}

async function open(page, opts) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  await ctx.route('**://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('**://fonts.gstatic.com/**', r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.evaluate(async s => { await window.Store.saveProfile(s); }, SEED);
  const pick = await planPick(p);
  if (!pick) throw new Error('у плані не знайшлось вправи зі схемою повторень');
  await seed(p, Object.assign({}, opts, { name: pick.name, reps: pick.top }));
  await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' });
  await p.waitForTimeout(1600);
  return { ctx, p, errs, pick: pick };
}

/* ---- 1. Ядро бачить дефіцит, і лише справжній ---- */
{
  const ctx = await adultContext(b);
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  const modes = await p.evaluate(() => {
    const D = window.DateCore, CC = window.CoachCore, t = D.todayKey();
    const mk = (delta) => {
      const log = {};
      for (let i = 0; i < 28; i++) {
        log[D.shiftKey(t, -(27 - i))] = Math.round((82 + delta * i / 27) * 1000) / 1000;
      }
      return log;
    };
    return {
      losing: CC.energyMode({ bodyLog: mk(-1.5) }).mode,
      flat: CC.energyMode({ bodyLog: mk(0) }).mode,
      noise: CC.energyMode({ bodyLog: mk(-0.2) }).mode,
      none: CC.energyMode({ bodyLog: {} })
    };
  });
  ok('1. худне — режим утримання', modes.losing === 'hold', JSON.stringify(modes));
  ok('1. вага стоїть — режим росту', modes.flat === 'grow', JSON.stringify(modes));
  ok('1. коливання в межах шуму нічого не міняє', modes.noise === 'grow', JSON.stringify(modes));
  ok('1. без зважувань режиму немає', modes.none === null, JSON.stringify(modes));
  await ctx.close();
}

/* ---- 2. «Сьогодні»: картка міняє зміст, а не зникає ---- */
{
  const grow = await open('index.html',
    { seed: SEED, bodyDelta: 0, protein: 180, rir: null });
  await grow.p.waitForTimeout(400);
  const growTxt = await grow.p.locator('.prg').innerText().catch(() => '');
  ok('2. коли вага тіла стоїть — звична картка «Час додати вагу»',
    /Час додати вагу/.test(growTxt), growTxt.replace(/\n+/g, ' | ').slice(0, 200));
  await grow.ctx.close();

  const hold = await open('index.html',
    { seed: SEED, bodyDelta: -1.6, protein: 180, rir: null });
  await hold.p.waitForTimeout(400);
  const holdTxt = await hold.p.locator('.prg').innerText().catch(() => '');
  ok('2. коли людина худне — картка каже «тримати»',
    /Вага: тримати/.test(holdTxt), holdTxt.replace(/\n+/g, ' | ').slice(0, 240));
  ok('2. і називає факт, а не ярлик',
    /вага тіла впала на/.test(holdTxt), holdTxt.replace(/\n+/g, ' | ').slice(0, 300));
  const first = await hold.p.locator('.prg__acts .btn--primary').first().innerText();
  ok('2. під пальцем — «лишити», а не «+2,5»', /Лишити/.test(first), first);
  ok('2. додати вагу все одно можна',
    await hold.p.locator('.prg__acts [data-prg-up]').count() > 0);
  ok('2. без JS-помилок', hold.errs.length === 0, hold.errs.join(' | '));
  await hold.ctx.close();
}

/* ---- 3. Журнал: причина плато з сусіднього журналу ---- */
{
  const one = await open('journal.html',
    { seed: SEED, bodyDelta: -1.6, protein: 180, rir: null });
  const txt = await one.p.locator('#jr-stale').innerText();
  ok('3. причина названа однією', /дефіцит/.test(txt), txt.replace(/\n+/g, ' | ').slice(0, 240));
  ok('3. і поруч стоїть факт', /вага тіла впала на/.test(txt),
    txt.replace(/\n+/g, ' | ').slice(0, 320));
  await one.ctx.close();

  const two = await open('journal.html',
    { seed: SEED, bodyDelta: -1.6, protein: 60, rir: null });
  const txt2 = await two.p.locator('#jr-stale').innerText();
  ok('3. дві причини — жодна не названа головною',
    /причин може бути кілька/.test(txt2), txt2.replace(/\n+/g, ' | ').slice(0, 320));
  ok('3. і обидва факти показані',
    /вага тіла впала/.test(txt2) && /білок нижче цілі/.test(txt2),
    txt2.replace(/\n+/g, ' | ').slice(0, 400));
  ok('3. без JS-помилок', two.errs.length === 0, two.errs.join(' | '));
  await two.ctx.close();

  const none = await open('journal.html',
    { seed: SEED, bodyDelta: 0, protein: 180, rir: null });
  const txt3 = await none.p.locator('#jr-stale').innerText();
  ok('3. коли причин немає — жодних ярликів',
    !/дефіцит|мало білка|втома|вага застара/.test(txt3),
    txt3.replace(/\n+/g, ' | ').slice(0, 240));
  await none.ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок перехресного тренерства пройшло.');
process.exit(bad ? 1 : 0);
