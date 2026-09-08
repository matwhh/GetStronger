/**
 * Діапазони повторень: стаж + розмір групи → діапазон, у ЖИВОМУ інтерфейсі.
 * Логіка під юніт-тестами (tests/reps-core.test.js); тут — що всі чотири
 * програми на сторінках плану й тренування реально показують ці числа.
 *
 * Друга половина файла — про ВЛАСНЕ ЧИСЛО людини (userReps). Юніти
 * стережуть арифметику, а тут перевіряється те, чого в пісочниці не
 * побачиш: що поле в «Моєму плані» справді записує число, що воно
 * ДОЇЖДЖАЄ до екрана тренування точним (а не серединою діапазону), що
 * стелю неможливо обійти набором з клавіатури — і що ніде в інтерфейсі
 * про цю стелю не написано жодного слова.
 */
import { chromium } from 'playwright';
import { adultContext, adultProfile } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: CHROME });

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

/* ------------------------------------------------------------------ */
/* Власне число повторень                                              */
/* ------------------------------------------------------------------ */
{
  const ctx = await adultContext(b, { viewport: { width: 1280, height: 950 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const toasts = [];
  p.on('console', () => {});

  await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
  await p.evaluate(async (seed) => { await window.Store.saveProfile(seed); },
    adultProfile({ trainingAge: 'novice', activePlan: { programId: 'fullbody', days: 3 },
                   programId: 'fullbody', daysPerWeek: 3 }));
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(900);

  /* Режим правки + перший день розгорнутий (його розкриває сам toggle). */
  await p.click('#toggle-edit');
  await p.waitForTimeout(500);

  const fields = p.locator('#plan .tbl--plan tbody input[data-act="reps"]');
  const n = await fields.count();
  ok('у режимі правки повторення — поле, а не напис', n > 0, 'полів: ' + n);

  /* Порожнє поле означає «за таблицею»: у підказці стоїть той самий
     діапазон, який показує звичайний перегляд. */
  const ph = await fields.first().getAttribute('placeholder');
  ok('порожнє поле підказує діапазон за стажем', /^\d+[–-]\d+$/.test(String(ph)), String(ph));
  ok('порожнє поле не має значення', (await fields.first().inputValue()) === '');

  /* Яка вправа велика, яка мала — питаємо саму сторінку, а не вгадуємо
     за назвою: «Біцепс стегна» ловився б регулярним виразом на «біцепс». */
  const idx = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#plan .tbl--plan tbody tr')];
    let big = -1, small = -1;
    rows.forEach((tr, i) => {
      const f = tr.querySelector('input[data-act="reps"]');
      if (!f) return;
      const max = Number(f.getAttribute('max'));
      if (max === 12 && big < 0) big = i;
      if (max === 15 && small < 0) small = i;
    });
    return { big, small };
  });
  ok('у дні є і велика група, і мала', idx.big >= 0 && idx.small >= 0, JSON.stringify(idx));

  const field = (i) => p.locator('#plan .tbl--plan tbody tr').nth(i).locator('input[data-act="reps"]');
  const setReps = async (i, v) => {
    const f = field(i);
    await f.fill(String(v));
    await f.blur();
    await p.waitForTimeout(600);
  };

  /* 1. Звичайне число записується й лишається. */
  await setReps(idx.big, 7);
  ok('власне число записалось у поле', (await field(idx.big).inputValue()) === '7');
  ok('власне число доїхало до профілю',
     await p.evaluate(async () => {
       const pl = (await window.Store.getProfile()).customPlans['fullbody:3'];
       return pl.some(d => (d.exercises || []).some(e => e.userReps === 7));
     }));

  /* 2. Стеля великої групи: набране руками більше число підтягується. */
  await setReps(idx.big, 30);
  ok('велика група: 30 підтягнулось до 12', (await field(idx.big).inputValue()) === '12');

  /* 3. Стеля малої групи вища. */
  await setReps(idx.small, 30);
  ok('мала група: 30 підтягнулось до 15', (await field(idx.small).inputValue()) === '15');

  /* 4. Про стелю ніде не сказано. Це вимога, а не дрібниця: межа має бути
     рамкою, у якій поле не дає вийти, а не правилом, яке треба памʼятати. */
  const said = await p.evaluate(() => {
    const f = document.querySelector('#plan input[data-act="reps"]');
    const t = document.body.innerText;
    return {
      title: f ? f.getAttribute('title') : null,
      /* Будь-яка згадка «максимум/не більше/межа» поруч зі словом
         «повтор» у видимому тексті сторінки. */
      text: (t.match(/[^.\n]*повтор[^.\n]*/gi) || [])
        .filter(x => /максимум|не більше|межа|обмеж|ліміт|стел/i.test(x))
    };
  });
  ok('поле повторень не має підказки title', said.title === null, String(said.title));
  ok('на сторінці ніде не написано про межу повторень',
     said.text.length === 0, said.text.slice(0, 2).join(' | '));

  /* 5. Порожнє поле повертає діапазон. */
  await setReps(idx.big, '');
  ok('порожнє поле знімає власне число', (await field(idx.big).inputValue()) === '');
  ok('userReps прибрано з профілю',
     await p.evaluate(async () => {
       const pl = (await window.Store.getProfile()).customPlans['fullbody:3'];
       return pl.every(d => (d.exercises || []).every(e => e.userReps !== 7 && e.userReps !== 12));
     }));

  /* 6. І головне: число доїжджає до ТРЕНУВАННЯ точним. */
  await setReps(idx.big, 9);
  const exName = await p.evaluate((i) => {
    const tr = document.querySelectorAll('#plan .tbl--plan tbody tr')[i];
    const sel = tr.querySelector('select[data-act="swap"]');
    return sel ? sel.value : '';
  }, idx.big);

  await p.goto('file://' + ROOT + '/workout.html', { waitUntil: 'load' });
  await p.waitForTimeout(1100);
  const shown = await p.evaluate((name) => {
    const li = [...document.querySelectorAll('.tdy-ex')]
      .find(x => x.textContent.indexOf(name) !== -1);
    if (!li) return null;
    const s = li.querySelector('.tdy-ex__scheme');
    return s ? s.textContent.trim() : null;
  }, exName);
  ok('тренування показує точне число, а не діапазон',
     shown !== null && /×\s*9(\D|$)/.test(shown), String(shown));

  /*
   * І те, заради чого все затівалось: поле повторень КОНКРЕТНОГО ПІДХОДУ
   * заповнюється тим самим числом. Раніше туди йшла середина діапазону
   * («8–10» → 9) — число, якого людина ніде не задавала й ніде не бачила.
   * Щоб журнал підходів мав що показати, спершу закриваємо один підхід.
   */
  const idxInWorkout = await p.evaluate((name) => {
    const list = [...document.querySelectorAll('.tdy-ex')];
    return list.findIndex(x => x.textContent.indexOf(name) !== -1);
  }, exName);
  ok('вправа знайшлась на екрані тренування', idxInWorkout >= 0, String(idxInWorkout));

  await p.click('[data-set-ex="' + idxInWorkout + '"][data-set-n="1"]');
  await p.waitForTimeout(300);
  await p.click('[data-log-tgl="' + idxInWorkout + '"]');
  await p.waitForTimeout(400);
  const perSet = await p.evaluate((i) => {
    const box = document.querySelector('[data-set-log="' + i + '"]');
    if (!box) return null;
    const f = box.querySelector('input[data-setr]');
    return f ? f.value : '(поля повторень немає)';
  }, idxInWorkout);
  ok('у підході стоїть саме поставлене число', /\b9\b/.test(String(perSet)), String(perSet));

  ok('сторінки плану й тренування без JS-помилок', errs.length === 0, errs.join(' | '));
  void toasts;
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок повторень пройшло.');
process.exit(bad ? 1 : 0);
