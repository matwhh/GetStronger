/**
 * «Трекери» — це НАЛАШТУВАННЯ. Ввід живе на «Сьогодні».
 *
 * Сторінок було дві: trackers.html (ввести значення) і
 * trackers.html (що ввімкнено, цілі, добавки). Ввід переїхав на
 * «Сьогодні» кубиками ще раніше — і сторінка вводу лишилась дублем: два
 * місця для одного числа, жодне з яких не очевидне. Тепер адреса одна.
 *
 * Стереже:
 *   • на «Сьогодні» кубиків немає, поки їх туди не закріпили;
 *   • закріплений кубик зʼявляється і пише прямо звідти;
 *   • trackers.html — це налаштування: перемикачі є, полів вводу немає;
 *   • стара адреса trackers.html веде на нову, а не в 404;
 *   • заміри тіла прибираються з головної тією самою шпилькою.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: CHROME });

async function open(page) {
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.route('**://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('**://fonts.gstatic.com/**', r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  return { ctx, p, errs };
}
const tap = async (l) => { await l.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {}); return l.click({ timeout: 6000, force: true }); };

/* ---- 1. «Сьогодні» БЕЗ ЗАКРІПЛЕНИХ трекерів ---- */
/*
 * ЩО ТУТ ЗМІНИЛОСЬ І ЧОМУ ЦЕ ВСЕ ЩЕ ВАЖЛИВО.
 *
 * Раніше цей блок перевіряв, що трекерів на «Сьогодні» НЕМАЄ ВЗАГАЛІ, — і
 * це було правильно доти, доки їх не було де взяти. Тепер їх можна
 * закріпити, тож правило звучить інакше й перевіряється так само строго:
 * поки людина нічого не закріпила, екран дня мусить лишатись рівно тим,
 * чим був. Уся суть тієї, першої, вимоги — «головна не перетворюється на
 * анкету сама собою» — тримається саме на цьому.
 *
 * Заразом стережеться стара розмітка: рядків .tdy-trk__row і шкал
 * .qi-scale (це сторінка «Трекери») на головній не має бути НІКОЛИ —
 * кубик має власну. Якщо вони тут зʼявляться, значить хтось повернув на
 * головну сторінку трекерів цілком.
 */
{
  const { ctx, p, errs } = await open('index.html');
  /* Реєстр трекерів засівається при першому відкритті сторінки трекерів,
     а не сам собою: у свіжому профілі його ще немає, і підказці нема про
     що підказувати. Засіваємо явно — інакше перевірка нижче ловила б не
     «немає закріплених», а «немає трекерів узагалі». */
  await p.evaluate(async () => {
    try { await window.Store.saveProfile({ trackers: window.TrackerCore.ensureBuiltins({}) }); }
    catch (e) { if (!e.queued) throw e; }
  });
  await p.waitForTimeout(700);
  /* Картка замірів носить ті самі класи .twt (вона живе в тій же сітці),
     тому рахуємо саме КУБИКИ — те, що просить щоденного числа. */
  ok('1. типово на «Сьогодні» кубиків трекерів немає',
    await p.locator('#today .twt:not(.twt--measure)').count() === 0,
    String(await p.locator('#today .twt:not(.twt--measure)').count()));
  ok('1. на «Сьогодні» немає рядків зі сторінки трекерів', await p.locator('#today .tdy-trk__row').count() === 0);
  ok('1. на «Сьогодні» немає шкал зі сторінки трекерів', await p.locator('#today .qi-scale').count() === 0);
  ok('1. плиток стану на «Сьогодні» немає', await p.locator('#today .tile').count() === 0);
  /* Підказка є, бо увімкнені трекери в людини за замовчуванням є. Вона
     веде туди, де закріплення й вмикається, — і це єдиний натяк на
     можливість, який екран собі дозволяє. */
  const hint = p.locator('#today .twt-hint');
  ok('1. підказка веде в трекери',
    await hint.count() === 1 && /trackers\.html$/.test(await hint.getAttribute('href')),
    await hint.count() ? String(await hint.getAttribute('href')) : 'підказки немає');
  ok('1. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 1b. Закріплений трекер: зʼявився, пише, переживає перезавантаження ---- */
/*
 * ГОЛОВНЕ ТУТ — ЩО ЗАПИС ІДЕ ПРЯМО З КУБИКА.
 *
 * Кубик, який лише показує число, місця на головній не вартий: щоб
 * відмітити склянку води, довелося б зробити три дотики замість одного.
 * Тому перевіряється не поява розмітки, а те, що дотик по «+0,25»
 * доходить до профілю й лишається там після перезавантаження.
 *
 * Окремо перевіряється сон: два поля, одна величина. Перехід між ними
 * зʼїдав хвилини — change на годинах перемальовував кубик разом із полем,
 * у яке людина саме набирала. Помилка тиха: на екрані все виглядало
 * записаним, у профілі лишалось рівно 7:00.
 */
{
  const { ctx, p, errs } = await open('index.html');
  await p.evaluate(async () => {
    const T = window.TrackerCore;
    let tr = T.ensureBuiltins({});
    tr = T.setPinned(tr, 'water', true);
    tr = T.setPinned(tr, 'sleep', true);
    try { await window.Store.saveProfile({ trackers: tr }); } catch (e) { if (!e.queued) throw e; }
  });
  await p.waitForTimeout(900);

  ok('1b. закріплені трекери зʼявились кубиками',
    await p.locator('#today .twt:not(.twt--measure)').count() === 2,
    String(await p.locator('#today .twt:not(.twt--measure)').count()));
  ok('1b. підказки більше немає', await p.locator('#today .twt-hint').count() === 0);

  /*
   * ЧОМУ ТУТ НЕ tap(), А ЗВИЧАЙНИЙ КЛІК.
   *
   * tap() тисне з force: true, тобто по КООРДИНАТАХ центру елемента, не
   * перевіряючи, чи його ніщо не перекриває. На вузькому екрані нижні
   * кубики стоять під фіксованим табаром — і такий клік дістається
   * табару, після чого перевірка йде вже на іншій сторінці. Звичайний
   * click цього не дозволить: він сам прокрутить сторінку й дочекається,
   * доки кнопка справді буде доступна для дотику.
   */
  const water = p.locator('#today [data-trk-add="water"][data-amount="0.25"]');
  await water.scrollIntoViewIfNeeded();
  await water.click();
  await p.waitForTimeout(400);

  await p.locator('#today [data-trk-durh="sleep"]').fill('7');
  await p.locator('#today [data-trk-durm="sleep"]').fill('20');
  await p.locator('#today [data-trk-durm="sleep"]').blur();
  await p.waitForTimeout(500);

  const saved = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const k = window.TrackerCore.todayKey();
    return {
      water: (pr.trackerLog.water || {})[k],
      sleep: window.TrackerCore.entryValue((pr.trackerLog.sleep || {})[k])
    };
  });
  ok('1b. вода записалась із кубика', saved.water === 0.25, JSON.stringify(saved));
  ok('1b. сон записався з ХВИЛИНАМИ, а не округлений до годин',
    saved.sleep === 440, String(saved.sleep));

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const shown = await p.locator('#today [data-trk-tile="sleep"] .twt__now').innerText();
  ok('1b. після перезавантаження кубик показує те саме', /^7:20$/.test(shown.trim()), shown);
  ok('1b. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. trackers.html — це НАЛАШТУВАННЯ, а не ввід ---- */
{
  const { ctx, p, errs } = await open('trackers.html');
  ok('2. заголовок «Трекери»', /^Трекери$/.test((await p.locator('h1').first().innerText()).trim()),
    (await p.locator('h1').first().innerText()).trim());
  ok('2. перемикачі увімкнення на місці', await p.locator('#tr-builtins [data-toggle]').count() >= 5,
    String(await p.locator('#tr-builtins [data-toggle]').count()));
  ok('2. шпильки «винести на Сьогодні» на місці', await p.locator('#tr-builtins .tr-pin').count() >= 1);
  /*
   * ГОЛОВНЕ ТУТ. Сторінки вводу більше немає — і її розмітки тут бути не
   * повинно. Якщо .tdy-trk__row колись повернеться на цю адресу, значить
   * дубль відновили, і людина знову матиме два місця для одного числа.
   */
  ok('2. рядків щоденного вводу тут немає', await p.locator('.tdy-trk__row').count() === 0);
  ok('2. і кубиків теж немає', await p.locator('.twt').count() === 0);
  ok('2. і картки замірів теж — це налаштування, а не екран дня',
    await p.locator('.twt--measure').count() === 0);
  ok('2. окремого посилання «Налаштування» вже не треба',
    await p.locator('main a[href="trackers.html"]').count() === 0);
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Стара адреса веде на нову ---- */
{
  const { ctx, p, errs } = await open('trackers.html');
  ok('3. trackers.html перенаправляє на trackers.html',
    /trackers\.html$/.test(p.url()), p.url().split('/').pop());
  ok('3. і це справді сторінка налаштувань',
    await p.locator('#tr-builtins [data-toggle]').count() >= 5);
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Вимкнув у налаштуваннях — кубик зник із «Сьогодні» ---- */
{
  const { ctx, p, errs } = await open('trackers.html');
  await p.evaluate(async () => {
    const T = window.TrackerCore;
    const tr = T.setPinned(T.ensureBuiltins({}), 'water', true);
    try { await window.Store.saveProfile({ trackers: tr }); } catch (e) { if (!e.queued) throw e; }
  });
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('4. закріплена вода на «Сьогодні» є', await p.locator('#today [data-trk-tile="water"]').count() === 1);

  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const row = p.locator('.tr-row', { hasText: 'Вода' }).first();
  await tap(row.locator('input[type=checkbox]').first().locator('xpath=..'));
  await p.waitForTimeout(700);

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('4. вимкнена вода зникла з «Сьогодні»', await p.locator('#today [data-trk-tile="water"]').count() === 0);
  ok('4. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5. Заміри тіла: та сама шпилька ---- */
{
  const { ctx, p, errs } = await open('trackers.html');
  const row = p.locator('.tr-row', { hasText: 'Заміри тіла' }).first();
  ok('5. заміри стоять у списку трекерів', await row.count() === 1);
  ok('5. рядок веде на сторінку замірів',
    await row.locator('a[href="measure.html"]').count() === 1);
  /* У картки немає ні цілі, ні джерела, ні швидкого вводу — розгортати
     нічого, тож кнопки-гармошки тут бути не повинно. */
  ok('5. рядок не розгортається — розгортати нічого',
    await row.locator('[data-expand]').count() === 0);
  ok('5. типово закріплені', await row.locator('.tr-pin.is-on').count() === 1);

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('5. картка замірів на «Сьогодні» є', await p.locator('#today .twt--measure').count() === 1);

  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('.tr-row', { hasText: 'Заміри тіла' }).first().locator('.tr-pin'));
  await p.waitForTimeout(700);

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('5. знята шпилька прибрала картку з головної', await p.locator('#today .twt--measure').count() === 0);

  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap(p.locator('.tr-row', { hasText: 'Заміри тіла' }).first().locator('.tr-pin'));
  await p.waitForTimeout(700);
  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  ok('5. і повернула назад', await p.locator('#today .twt--measure').count() === 1);
  ok('5. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Тижнева ціль звички x/7 (F3) ---- */
/*
 * Головне, що тут стережеться: у звички з тижневою ціллю денний стрік не
 * показується НІДЕ. Два різні «поспіль» на одному екрані — не більше
 * інформації, а питання «то який із них справжній», і саме через це
 * показник переставав щось означати.
 */
{
  const { ctx, p, errs } = await open('trackers.html');

  await p.evaluate(async () => {
    const T = window.TrackerCore;
    const added = T.addCustom(T.ensureBuiltins({}), 'habit', 'Розтяжка');
    const id = added.id;
    let tr = T.setEnabled(added.trackers, id, true);
    tr = T.setPinned(tr, id, true);
    /* Три позначки з пропусками цього тижня: рівно той випадок, який
       денний стрік рахував як «серія 1», а людина — як «зробив тричі». */
    const start = T.weekStartKey(new Date());
    const D = window.DateCore;
    const log = { [id]: {
      [start]: true,
      [D.shiftKey(start, 2)]: true,
      [D.shiftKey(start, 4)]: true
    } };
    try { await window.Store.saveProfile({ trackers: tr, trackerLog: log }); }
    catch (e) { if (!e.queued) throw e; }
  });

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const row = () => p.locator('.tr-row', { hasText: 'Розтяжка' }).first();
  ok('6. у звички є поле «днів на тиждень»', await row().locator('[data-week-set]').count() === 1);

  await row().locator('[data-week-set]').fill('3');
  await row().locator('[data-week-set]').press('Tab');
  await p.waitForTimeout(900);

  const saved = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const id = Object.keys(pr.trackers).find(k => pr.trackers[k].name === 'Розтяжка');
    return pr.trackers[id].weekGoal;
  });
  ok('6. ціль 3/тиж зберігається в профілі', saved === 3, 'weekGoal=' + saved);

  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  const meta = await row().locator('.tr-row__meta').innerText();
  ok('6. у налаштуваннях видно тижневий лічильник', /3 з 3 цього тижня/.test(meta), meta);
  /* ТІЛЬКИ тижневий: ні «за 30 днів», ні «N днів поспіль» поруч бути не
     має — це були б два різні відповіді на одне питання. */
  ok('6. 30-денного підсумку поруч немає', !/за 30 днів/.test(meta), meta);
  /* Пробіл на початку обовʼязковий: «тиждень» містить у собі «день», і
     без нього ця перевірка падала саме на правильному тексті. */
  ok('6. денного стріку поруч немає', !/ (день|дні|днів) поспіль/.test(meta), meta);

  await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const tileTxt = await p.locator('#today .twt', { hasText: 'Розтяжка' }).first().innerText();
  ok('6. на «Сьогодні» кубик показує 3/3 цього тижня', /3\/3 цього тижня/.test(tileTxt), tileTxt);
  ok('6. на кубику немає «серія N днів»', !/серія \d+ (день|дні|днів)/.test(tileTxt), tileTxt);

  /* Понад 7 — не помилка, а «щодня»: обрізається */
  await p.goto('file://' + ROOT + '/trackers.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await row().locator('[data-week-set]').fill('10');
  await row().locator('[data-week-set]').press('Tab');
  await p.waitForTimeout(900);
  const capped = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const id = Object.keys(pr.trackers).find(k => pr.trackers[k].name === 'Розтяжка');
    return pr.trackers[id].weekGoal;
  });
  ok('6. «10 днів на тиждень» стає 7, а не помилкою', capped === 7, 'weekGoal=' + capped);

  /* Порожнє поле знімає ціль і повертає денний стрік */
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await row().locator('[data-week-set]').fill('');
  await row().locator('[data-week-set]').press('Tab');
  await p.waitForTimeout(900);
  const cleared = await p.evaluate(async () => {
    const pr = await window.Store.getProfile();
    const id = Object.keys(pr.trackers).find(k => pr.trackers[k].name === 'Розтяжка');
    return pr.trackers[id].weekGoal;
  });
  ok('6. порожнє поле знімає тижневу ціль', cleared === null, 'weekGoal=' + cleared);
  ok('6. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок сторінки трекерів пройшло.');
process.exit(bad ? 1 : 0);
