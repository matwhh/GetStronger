/**
 * «Що працює саме на тобі» на живій сторінці «Прогрес».
 *
 * ЩО ТУТ СТЕРЕЖЕТЬСЯ І ЧОМУ САМЕ ЦЕ.
 *
 * Ядро (js/insight-core.js) під юнітами: воно вміє і знайти різницю, і
 * промовчати. Але між ядром і людиною лежить показ, і саме там знахідка
 * може перетворитись на брехню: картка, яка малює числа при рівні 'thin',
 * видасть середнє по трьох тижнях за відповідь — рівно те, від чого весь
 * цей блок і робився.
 *
 * Тому перевірка ганяє два стани на справжній сторінці:
 *   • тижнів мало — у картці немає ЖОДНОГО числа-результату, лише
 *     скільки тижнів бракує;
 *   • тижнів досить і різниця є — картка називає обидві половини.
 *
 * Дати рахуються від СЬОГОДНІ, а не зашиті: фікстура з датами вже одного
 * разу зробила нічний прогін червоним просто тому, що настав інший
 * тиждень.
 */
import { chromium } from 'playwright';
import { adultContext, adultProfile } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

/** Профіль із N завершеними тижнями: сон і закриті підходи ростуть разом. */
function weeksProfile(n, linked) {
  const sessionLog = {}, trackerLog = { sleep: {} };
  const today = new Date();
  const dow = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - dow);

  const key = (d) => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');

  for (let w = 1; w <= n; w++) {
    const wk = new Date(monday);
    wk.setDate(monday.getDate() - w * 7);          // тільки завершені тижні
    const high = w % 2 === 0;
    const sleep = high ? 480 : 360;
    /* linked=false — підходи не залежать від сну: різниця має вийти
       меншою за розкид, і картка мусить сказати «різниці не видно». */
    const sets = linked ? (high ? 20 : 10) : (w % 3 === 0 ? 20 : 10);
    for (let i = 0; i < 5; i++) {
      const d = new Date(wk); d.setDate(wk.getDate() + i);
      trackerLog.sleep[key(d)] = sleep;
    }
    const tr = new Date(wk); tr.setDate(wk.getDate() + 1);
    sessionLog[key(tr)] = { done: 5, total: 5, doneSets: sets, totalSets: 20 };
  }
  return adultProfile({ sessionLog: sessionLog, trackerLog: trackerLog });
}

async function textOf(p, profile) {
  await p.evaluate(async (s) => {
    try { await window.Store.saveProfile(s); } catch (e) { if (!e.queued) throw e; }
  }, profile);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1800);
  return (await p.textContent('#jr-insight')) || '';
}

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 1280, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });

/* ------------------------------------------------------------------ */
/* 1. Блок узагалі є і називає всі чотири питання                       */
/* ------------------------------------------------------------------ */
{
  const t = await textOf(p, weeksProfile(3, true));
  ok('блок «Що працює саме на тобі» на сторінці', /Що працює саме на тобі/.test(t),
     t.slice(0, 60));
  const qs = (t.match(/Чи /g) || []).length;
  ok('усі чотири питання показані, зокрема без відповіді', qs === 4, 'питань: ' + qs);
}

/* ------------------------------------------------------------------ */
/* 2. Тижнів мало — жодного числа-результату                            */
/* ------------------------------------------------------------------ */
{
  const t = await textOf(p, weeksProfile(3, true));
  const said = /поки \d+ із \d+ тижн/.test(t) || /записів ще немає/.test(t);
  ok('замало тижнів — сказано, скільки саме бракує', said);
  ok('замало тижнів — жодного «проти» з числами', !/проти <?\d/.test(t) && !/% проти/.test(t),
     (t.match(/.{0,30}проти.{0,20}/) || [''])[0]);
}

/* ------------------------------------------------------------------ */
/* 3. Тижнів досить і звʼязок є — обидві половини названі               */
/* ------------------------------------------------------------------ */
{
  const t = await textOf(p, weeksProfile(10, true));
  ok('знайдений звʼязок названо словом «Так»', /Так — коли більше сну/.test(t),
     (t.match(/Так — коли[^.]{0,60}/) || [''])[0]);
  ok('показані обидві половини у відсотках', /100% проти 50%|100 % проти 50 %/.test(t) ||
     /\d+% проти \d+%/.test(t), (t.match(/\d+% проти \d+%/) || [''])[0]);
  /* \w у JS не бачить кирилиці — «тижнів» через нього не матчиться. */
  ok('видно, скільки тижнів по кожен бік', /\d+ тижн\S* проти \d+/.test(t),
     (t.match(/\d+ тижн\S* проти \d+/) || [''])[0]);
  ok('у шапці порахована кількість знахідок', /знайдено: \d+ із 4/.test(t),
     (t.match(/знайдено: \d+ із 4/) || [''])[0]);
}

/* ------------------------------------------------------------------ */
/* 4. Тижнів досить, звʼязку немає — так і сказано                      */
/* ------------------------------------------------------------------ */
{
  const t = await textOf(p, weeksProfile(10, false));
  ok('без звʼязку картка каже «різниці не видно»', /Різниці не видно/.test(t),
     (t.match(/Різниці не видно[^.]{0,50}/) || [''])[0]);
  ok('і це НЕ видається за знахідку', !/Так — коли більше сну/.test(t));
}

ok('жодної помилки на сторінці', errs.length === 0, errs.slice(0, 2).join(' | '));

await b.close();
const bad = R.filter(([, c]) => !c).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок порівняння тижнів пройшло.');
process.exit(bad ? 1 : 0);
