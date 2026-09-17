/**
 * ОКРЕМІ СТОРІНКИ «ДНІ ТРЕНУВАНЬ» І «ЗВАЖУВАННЯ» — реальний браузер.
 *
 * Юніти стережуть правила (js/daylog-core.js), а тут — те, чого вони не
 * бачать:
 *   • плитки на «Сьогодні» ведуть саме сюди, а не в якір журналу;
 *   • сторінки взагалі дійшли до екрана — модуль, не підключений у
 *     розмітці, дає зелені тести й порожню сторінку;
 *   • ЗАПИС СПРАВДІ ЙДЕ В ТОЙ САМИЙ ПРОФІЛЬ, що читає «Прогрес». Це
 *     головне: сторінки задумані як другий вхід в один журнал, і якби
 *     вони писали власний ключ, розбіжність виявилась би не тут, а через
 *     місяць — порожнім графіком ваги при повному календарі.
 *
 * Запуск: node tools/verifydaylogs.mjs
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const BASE = {
  birthDate: '1990-06-15', sex: 'male', age: 36, height: 180, weight: 82,
  activity: 1.55, trainingAge: 'inter', daysPerWeek: 3,
  activePlan: { programId: 'fullbody', days: 3 }, programId: 'fullbody'
};

const key = (shift) => {
  const d = new Date();
  d.setDate(d.getDate() - shift);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
};

const ctx = await adultContext(b, { viewport: { width: 420, height: 900 } });
const errs = [];

async function open(page, profile) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(page + ': ' + e.message));
  await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' });
  if (profile) {
    await p.evaluate(async (prof) => { await window.Store.saveProfile(prof); }, profile);
    await p.reload({ waitUntil: 'load' });
  }
  await p.waitForTimeout(900);
  return p;
}

/* ---- 1. Плитки «Сьогодні» ведуть на окремі сторінки ---- */
{
  const p = await open('index.html', Object.assign({}, BASE));
  const hrefs = await p.locator('#today .hbt').evaluateAll(
    (els) => els.map((e) => e.getAttribute('href')));
  ok('1. плитка тренувань веде на train-log.html',
     hrefs[0] === 'train-log.html', String(hrefs));
  ok('2. плитка зважування веде на weight-log.html',
     hrefs[1] === 'weight-log.html', String(hrefs));
  /* Регресія: доти це були якорі journal.html#jr-train / #jr-weight, і з
     телефона вони відкривали найважчу сторінку сайту заради одного поля. */
  ok('3. жодна з плиток більше не веде в якір журналу',
     hrefs.every((h) => !/journal\.html#/.test(String(h))), String(hrefs));
  await p.close();
}

/* ---- 2. «Дні тренувань»: календар, позначка, спільний журнал ---- */
{
  const p = await open('train-log.html', Object.assign({}, BASE, {
    workLog: { [key(3)]: 1 },
    sessionLog: {
      [key(5)]: { doneSets: 8, totalSets: 8 },
      /* Дві середні сходинки: без них шкала вироджується в «було / не
         було», а саме заради часток вона й чотириступенева. */
      [key(6)]: { doneSets: 3, totalSets: 10 },
      [key(7)]: { doneSets: 8, totalSets: 10 }
    }
  }));

  ok('4. сторінка намалювалась', (await p.locator('#tl-main .card').count()) >= 1);
  ok('5. календар на місці', (await p.locator('#tl-main .mcal').count()) === 1);
  ok('6. клітинки днів — кнопки, а не картинки',
     (await p.locator('#tl-main [data-hm]').count()) > 100);

  const lvl = (k) => p.locator('#tl-main [data-hm="' + k + '"]').getAttribute('data-lvl');
  ok('7. ручна позначка дає рівень 1', (await lvl(key(3))) === '1');
  ok('8. повністю закрита сесія дає рівень 4', (await lvl(key(5))) === '4');
  ok('9. порожній день — рівень 0', (await lvl(key(4))) === '0');
  /* Середні сходинки: 3 з 10 — менше половини, 8 з 10 — більша частина.
     Доти їх ганяла лише теплокарта на «Прогресі», якої більше немає. */
  ok('9a. менше половини підходів — рівень 2', (await lvl(key(6))) === '2');
  ok('9b. більша частина підходів — рівень 3', (await lvl(key(7))) === '3');

  const week = await p.locator('#tl-main .chip').first().innerText();
  ok('10. тиждень показаний із ціллю плану', /\/3 цього тижня/.test(week), week);

  /* Тап по вчорашньому дню — і те саме число має лежати в профілі. */
  await p.locator('#tl-main [data-hm="' + key(1) + '"]').click();
  await p.waitForTimeout(500);
  const saved = await p.evaluate(async (k) => {
    const prof = await window.Store.getProfile();
    return (prof.workLog || {})[k];
  }, key(1));
  ok('11. тап пише позначку в profile.workLog', Number(saved) === 1, String(saved));
  ok('12. і клітинка одразу засвітилась', (await lvl(key(1))) === '1');

  /* Зняття дня, зарахованого СЕСІЄЮ, мусить писати явний нуль: простого
     видалення ключа тут замало — сесія однаково засвітила б клітинку. */
  await p.locator('#tl-main [data-hm="' + key(5) + '"]').click();
  await p.waitForTimeout(500);
  const zero = await p.evaluate(async (k) => {
    const prof = await window.Store.getProfile();
    return (prof.workLog || {})[k];
  }, key(5));
  ok('13. зняття дня із сесією пише явний 0', Number(zero) === 0, String(zero));
  ok('14. і клітинка згасла', (await lvl(key(5))) === '0');

  ok('15. легенда пояснює шкалу словами',
     /відмічено вручну/.test(await p.locator('#tl-main').innerText()));
  const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('16. не тягне сторінку вбік на телефоні', over === false);
  await p.close();
}

/* ---- 3. «Зважування»: поле, календар, спільний журнал ---- */
{
  const p = await open('weight-log.html', Object.assign({}, BASE, {
    bodyLog: { [key(2)]: 82.6, [key(9)]: 83.1 }
  }));

  ok('17. сторінка намалювалась', (await p.locator('#wl-main .card').count()) >= 1);
  ok('18. поле вводу на ПЕРШОМУ екрані',
     (await p.locator('#wl-kg').boundingBox()).y < 700);
  ok('19. календар на місці', (await p.locator('#wl-main .mcal').count()) === 1);

  /* type=number на телефоні мовчки віддає '' для «82,4» — саме тому поле
     текстове з inputmode. */
  ok('20. поле текстове з числовою клавіатурою',
     (await p.locator('#wl-kg').getAttribute('type')) === 'text' &&
     (await p.locator('#wl-kg').getAttribute('inputmode')) === 'decimal');

  ok('21. зважений день зафарбований',
     (await p.locator('#wl-main [data-wday="' + key(2) + '"]').getAttribute('data-lvl')) === '4');
  ok('22. незважений — ні',
     (await p.locator('#wl-main [data-wday="' + key(3) + '"]').getAttribute('data-lvl')) === '0');

  const week = await p.locator('#wl-main .chip').first().innerText();
  ok('23. тиждень рахується зі знаменником 7', /\/7 цього тижня/.test(week), week);

  /* Кома — робочий ввід. */
  await p.locator('#wl-kg').fill('81,4');
  await p.locator('#wl-add').click();
  await p.waitForTimeout(600);
  const today = await p.evaluate(async (k) => {
    const prof = await window.Store.getProfile();
    return (prof.bodyLog || {})[k];
  }, key(0));
  ok('24. кома приймається і йде в profile.bodyLog', Number(today) === 81.4, String(today));

  /* Вибір дня в календарі НЕ пише нічого сам — лише переводить поле. */
  await p.locator('#wl-main [data-wday="' + key(4) + '"]').click();
  await p.waitForTimeout(500);
  const untouched = await p.evaluate(async (k) => {
    const prof = await window.Store.getProfile();
    return (prof.bodyLog || {})[k];
  }, key(4));
  ok('25. тап по дню сам нічого не записує', untouched === undefined, String(untouched));
  ok('26. але поле переїхало на цей день',
     /Сьогодні/.test(await p.locator('#wl-main h2').first().innerText()) === false);

  await p.locator('#wl-kg').fill('80.2');
  await p.locator('#wl-add').click();
  await p.waitForTimeout(600);
  const back = await p.evaluate(async (k) => {
    const prof = await window.Store.getProfile();
    return (prof.bodyLog || {})[k];
  }, key(4));
  ok('27. запис іде в ОБРАНИЙ день, а не в сьогодні', Number(back) === 80.2, String(back));

  /* Межі: 12 кг — це описка на порядок, а не людина. */
  await p.locator('#wl-kg').fill('12');
  await p.locator('#wl-add').click();
  await p.waitForTimeout(500);
  const junk = await p.evaluate(async (k) => {
    const prof = await window.Store.getProfile();
    return (prof.bodyLog || {})[k];
  }, key(4));
  ok('28. число поза межами не затирає попереднє', Number(junk) === 80.2, String(junk));

  const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('29. не тягне сторінку вбік на телефоні', over === false);
  await p.close();
}

/* ---- 4. «Прогрес» бачить те саме ---- */
{
  const p = await open('journal.html', null);
  await p.waitForTimeout(1200);
  /* Той самий журнал: число, вписане на окремій сторінці, мусить бути
     видним у «Прогресі» без жодного перенесення. Дивимось у ТОЧКИ
     графіка, а не в текст: ввід і список записів звідти прибрані, на
     «Прогресі» лишився сам графік. */
  const pts = await p.locator('#jr-weight svg.exc [data-v]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-v')).join(' '));
  ok('30. вага з окремої сторінки видна в «Прогресі»', /81,4|80,2/.test(pts),
     String(pts).slice(0, 120));
  /* І навпаки: писати її звідти більше нічим — поле переїхало на
     «Дні зважувань» цілком. */
  /* Радіокнопки періоду графіка лишились — а от поля, у яке пишуть вагу,
     більше немає: воно цілком переїхало на «Дні зважувань». */
  ok('30a. на «Прогресі» немає поля вводу ваги',
     (await p.locator('#jr-weight input:not([type="radio"])').count()) === 0 &&
     (await p.locator('#jr-weight #w-add').count()) === 0);
  ok('30b. і немає блоку тренувань — у нього окрема сторінка',
     (await p.locator('#jr-train').count()) === 0);
  await p.close();
}

ok('31. без JS-помилок', errs.length === 0, errs.join(' | '));

await ctx.close();
await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок окремих сторінок журналів пройшло.');
process.exit(bad ? 1 : 0);
