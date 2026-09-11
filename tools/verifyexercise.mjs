/**
 * Прогрес окремої вправи на «Прогресі» (js/exercise-core.js + блок журналу).
 *
 * Стереже те, заради чого блок і робився: кожна точка — реальне
 * тренування, метрики рахуються з ЗАКРИТИХ підходів, вправа без ваги не
 * отримує вигаданий тоннаж, а порожнеча підписана поясненням, а не нулем.
 */
import { chromium } from 'playwright';
import { CHROME } from './pw.mjs';
const ROOT = process.cwd();
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};
const b = await chromium.launch({ executablePath: CHROME });
const sess = (ex) => ({ programId:'ppl', days:3, dayIdx:0, done:2, total:3, doneSets:8, totalSets:12, end:1, ex });
const B = (kg, ds, r) => ({ n:'Жим лежачи', ds, ps:4, kg, r });
const PROFILE = {
  version:10, sex:'male', birthDate:'1995-06-15', age:31, weight:82, height:180,
  activity:1.55, trainingAge:'inter', activePlan:{programId:'ppl',days:3}, programId:'ppl',
  weights:{'Жим лежачи':105},
  sessionLog: {
    '2026-07-06': sess([B(95,4,8), {n:'Планка',ds:3,ps:3,r:1}]),
    '2026-07-20': sess([B(100,4,8)]),
    '2026-08-03': sess([B(102.5,4,8), {n:'Тяга',ds:3,ps:3,kg:80,r:10}]),
    '2026-08-17': sess([B(105,4,8)]),
    '2026-08-31': sess([B(105,2,8)])
  }
};
async function open(profile, vp) {
  const ctx = await b.newContext({ viewport: vp || {width:1200,height:1000} });
  await ctx.addInitScript((p)=>{ localStorage.setItem('ib.cloud','0'); localStorage.setItem('ib.profile', JSON.stringify(p)); }, profile);
  await ctx.route('**/*', r=>/fonts\.|google/.test(r.request().url())?r.abort():r.continue());
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/journal.html',{waitUntil:'load'});
  await p.waitForTimeout(1200);
  return { ctx, p, errs };
}
const pick = async (p, sel, val) => { await p.selectOption(sel, val); await p.waitForTimeout(400); };
const seg = async (p, name, val) => { await p.locator(`input[name="${name}"][value="${val}"]`).locator('xpath=..').click(); await p.waitForTimeout(400); };

{
  const { ctx, p, errs } = await open(PROFILE);
  ok('1. блок є', await p.locator('#jr-exercise .card').count()===1);
  const opts = await p.$$eval('#ex-pick option', es=>es.map(e=>e.value));
  ok('1. список вправ за свіжістю', opts.join(',')==='Жим лежачи,Тяга,Планка', opts.join(','));
  ok('1. 4 метрики', await p.locator('input[name="ex-metric"]').count()===4);
  ok('1. 5 періодів', await p.locator('input[name="ex-period"]').count()===5);
  ok('1. графік намальовано', await p.locator('#jr-exercise svg circle').count()===5,
     String(await p.locator('#jr-exercise svg circle').count()));

  const kpi = await p.locator('#jr-exercise .kpis').innerText();
  ok('1. Вага: поточна 105, попередня 105, PR 105', /105/.test(kpi), kpi.replace(/\n+/g,' | ').slice(0,120));

  // Обʼєм: остання сесія 2 підходи → падіння вдвічі
  await seg(p, 'ex-metric', 'vol');
  const kv = await p.locator('#jr-exercise .kpis').innerText();
  ok('2. Обʼєм: поточний 1 680, попередній 3 360, −50%',
     /1 680/.test(kv) && /3 360/.test(kv) && /-50|−50/.test(kv), kv.replace(/\n+/g,' | ').slice(0,140));

  await seg(p, 'ex-metric', 'e1rm');
  const ke = await p.locator('#jr-exercise .kpis').innerText();
  ok('3. 1ПМ рахується і більший за робочу вагу', /1[23]\d/.test(ke), ke.replace(/\n+/g,' | ').slice(0,90));

  await seg(p, 'ex-metric', 'reps');
  const kr = await p.locator('#jr-exercise .kpis').innerText();
  ok('4. Повтори: 16 проти 32', /16/.test(kr) && /32/.test(kr), kr.replace(/\n+/g,' | ').slice(0,90));

  // Планка: ваги немає → «Вага» незастосовна, «Повтори» працюють
  await pick(p, '#ex-pick', 'Планка');
  await seg(p, 'ex-metric', 'kg');
  const pl = await p.locator('#jr-exercise').innerText();
  ok('5. вправа без ваги: чесне пояснення, а не 0', /не рахується/.test(pl) && /не задано робочої ваги/.test(pl),
     pl.replace(/\n+/g,' | ').slice(80,220));
  await seg(p, 'ex-metric', 'reps');
  ok('5. для неї «Повтори» показуються', await p.locator('#jr-exercise .kpis').count()===1);

  // Період: 30д → у вікні лише одна сесія жиму (31.08)
  await pick(p, '#ex-pick', 'Жим лежачи');
  await seg(p, 'ex-metric', 'kg');
  await seg(p, 'ex-period', '30');
  const c30 = await p.locator('#jr-exercise svg circle').count();
  ok('6. період 30д звужує серію', c30 < 5 && c30 >= 1, c30 + ' точок');
  await seg(p, 'ex-period', '0');
  ok('6. «все» повертає всі 5', await p.locator('#jr-exercise svg circle').count()===5);

  // Таблиця історії
  const rows = await p.locator('#jr-exercise tbody tr').count();
  ok('7. таблиця історії: 5 рядків', rows===5, String(rows));
  const first = await p.locator('#jr-exercise tbody tr').first().innerText();
  ok('7. свіже — зверху, з вагою й обʼємом', /31/.test(first) && /105/.test(first) && /1 680/.test(first),
     first.replace(/\t+/g,' | '));

  ok('8. тренд порахований', /Тренд за період/.test(await p.locator('#jr-exercise').innerText()));
  ok('9. без JS-помилок', errs.length===0, errs.slice(0,3).join(' | '));
  await ctx.close();
}
{ // Порожній стан
  const { ctx, p, errs } = await open(Object.assign({}, PROFILE, { sessionLog:{} }));
  const t = await p.locator('#jr-exercise').innerText();
  ok('10. нуль даних: пояснення, не порожній графік', /Ще немає даних/.test(t), t.replace(/\n+/g,' | ').slice(0,110));
  ok('10. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}
{ // Мобільний
  const { ctx, p, errs } = await open(PROFILE, {width:390,height:844,isMobile:true,hasTouch:true});
  const m = await p.evaluate(()=>({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    small: [...document.querySelectorAll('#jr-exercise .seg__item, #jr-exercise select')]
      .filter(e=>e.getBoundingClientRect().height < 32).length
  }));
  ok('11. мобільний: без горизонтального переповнення', !m.overflow);
  ok('11. контроли не дрібні', m.small===0, m.small+' дрібних');
  ok('11. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}
{ /* 12. Графік — ЛІНІЯ, а не стовпчики (стандарт графіків Get Stronger).
     Стовпчики тут уже стояли: спершу обʼємом на власній правій шкалі,
     потім метрикою від дна поля. Обидва рази вони брехали про пропорції,
     бо жоден показник Get Stronger не має осмисленого нуля в масштабі свого
     графіка. Правило зафіксоване біля chartScale() у js/journal.js, а ця
     перевірка не дає йому тихо зникнути. */
  const { ctx, p, errs } = await open(PROFILE);
  for (const metric of ['kg','vol','reps','e1rm']) {
    await seg(p, 'ex-metric', metric);
    const g = await p.$eval('#jr-exercise svg.exc', svg => ({
      rects: svg.querySelectorAll('rect:not(.exc__hit)').length,
      bars:  svg.querySelectorAll('.exc__bar').length,
      dots:  svg.querySelectorAll('.exc__dot').length,
      line:  svg.querySelectorAll('.exc__line').length,
      area:  svg.querySelectorAll('.exc__area').length,
      grid:  svg.querySelectorAll('.exc__grid').length,
      right: svg.querySelectorAll('.exc__ylab--r').length
    }));
    ok('12. ['+metric+'] стовпчиків немає жодного', g.bars===0 && g.rects===0, JSON.stringify(g));
    ok('12. ['+metric+'] є лінія, заливка й сітка', g.line===1 && g.area===1 && g.grid>=3, JSON.stringify(g));
    ok('12. ['+metric+'] крапка на кожне тренування', g.dots===5, JSON.stringify(g));
    ok('12. ['+metric+'] другої шкали немає', g.right===0, String(g.right));
  }
  /* .chart-tip має display:flex, а він перебиває вбудоване
     [hidden]{display:none} — схована підказка лишалась порожньою
     бульбашкою в кутку графіка. */
  const tip = await p.$eval('#ex-tip', el => {
    const r = el.getBoundingClientRect();
    return { hidden: el.hasAttribute('hidden'), w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok('12. схована підказка справді схована', tip.hidden && tip.w===0 && tip.h===0, JSON.stringify(tip));

  await p.locator('#jr-exercise .exc__hit').first().hover();
  await p.waitForTimeout(200);
  const shown = await p.$eval('#ex-tip', el => ({ hidden: el.hasAttribute('hidden'), t: el.innerText }));
  ok('12. наведення показує число й обʼєм', !shown.hidden && /95/.test(shown.t) && /обʼєм/.test(shown.t),
     JSON.stringify(shown));
  ok('12. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}
await b.close();
const bad=R.filter(r=>!r[1]).length;
console.log('\n'+(R.length-bad)+'/'+R.length+' перевірок прогресу вправи.');
process.exit(bad?1:0);
