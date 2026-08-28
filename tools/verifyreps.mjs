/**
 * Діапазони повторень: стаж + розмір групи → діапазон, у ЖИВОМУ інтерфейсі.
 * Логіка під юніт-тестами (tests/reps-core.test.js); тут — що всі чотири
 * програми на сторінках плану й тренування реально показують ці числа.
 */
import { chromium } from 'playwright';
import { adultContext, adultProfile } from './adult.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const PROGRAMS = [
  { id: 'fullbody',   days: 3, name: 'Full Body' },
  { id: 'upperlower', days: 4, name: 'Upper/Lower' },
  { id: 'ppl',        days: 6, name: 'PPL' },
  { id: 'ulppl',      days: 5, name: 'UL/PPL' }
];
const TIERS = [
  ['novice', ['8–10', '10–12']],
  ['inter',  ['8–10', '10–12']],
  ['adv',    ['6–8', '8–10']],
  ['elite',  ['6–8', '8–10']]
];

for (const [tier, allowed] of TIERS) {
  const ctx = await adultContext(b, { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));

  for (const prog of PROGRAMS) {
    await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
    await p.evaluate(async (seed) => { await window.Store.saveProfile(seed); },
      adultProfile({ trainingAge: tier, activePlan: { programId: prog.id, days: prog.days }, programId: prog.id, daysPerWeek: prog.days }));
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(900);

    const reps = await p.evaluate(() =>
      [...document.querySelectorAll('#plan .tbl--plan tbody td[data-l="Повтори"]')]
        .map(td => td.textContent.trim()).filter(Boolean));
    const bad = reps.filter(r => !allowed.includes(r));
    ok(tier + ' / ' + prog.name + ': усі reps із таблиці (' + reps.length + ' вправ)',
       reps.length > 0 && bad.length === 0, bad.slice(0, 4).join(','));
  }

  /* Сторінка тренування — той самий діапазон, що в плані */
  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
  const wk = await p.evaluate(() =>
    [...document.querySelectorAll('.tdy-ex')].map(li => (li.textContent.match(/\d+[–-]\d+/) || [''])[0]).filter(Boolean));
  const wkBad = wk.filter(r => !allowed.includes(r.replace('-', '–')));
  ok(tier + ' / тренування: reps узгоджені з планом', wk.length > 0 && wkBad.length === 0, wkBad.slice(0, 4).join(','));

  ok(tier + ': без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* Великі проти малих: конкретна пара в одному плані */
{
  const ctx = await adultContext(b, { viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
  await p.evaluate(async (seed) => { await window.Store.saveProfile(seed); },
    adultProfile({ trainingAge: 'novice', activePlan: { programId: 'fullbody', days: 3 } }));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(900);
  const pair = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#plan .tbl--plan tbody tr')];
    const find = (re) => {
      const r = rows.find(tr => re.test(tr.textContent));
      const td = r && r.querySelector('td[data-l="Повтори"]');
      return td ? td.textContent.trim() : null;
    };
    /* Точні назви з Full Body: «Біцепс стегна» у підписах груп ловився б
       регулярним виразом на «біцепс» і підсовував велику групу як малу. */
    return { big: find(/Жим у тренажері/), small: find(/Біцепс у кросовері/) };
  });
  ok('новачок: велика група 8–10, мала 10–12', pair.big === '8–10' && pair.small === '10–12', JSON.stringify(pair));
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок діапазонів повторень пройшло.');
process.exit(bad ? 1 : 0);
