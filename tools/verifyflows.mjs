import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';
const b=await chromium.launch({executablePath:CHROME});
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};
const SEED={birthDate: '1990-06-15', sex:'male',age:30,height:180,weight:82.4,activity:1.55,goal:'cut',meals:4,
  daysPerWeek:3,activePlan:{programId:'fullbody',days:3},trainingAge:'inter'};

async function page(vp){ const ctx=await adultContext(b, {viewport:vp||{width:390,height:844}});
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept());
  return {ctx,p,errs}; }

// 1. Головна = «Сьогодні»: живий стан і дія на одному екрані
{
 const {ctx,p,errs}=await page();
 await p.goto(`file://${ROOT}/index.html`);
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
 await p.reload(); await p.waitForTimeout(1200);

 const rating=await p.locator('#today .card--rating').innerText();
 ok('головна: картка сезону на місці', /Сезон/.test(rating), rating.split('\n')[0]);

 const tiles=await p.locator('#today .tile').count();
 ok('головна: плитки стану є (2–3)', tiles>=2 && tiles<=3, 'tiles='+tiles);

 const train=await p.locator('#tdy-training').count();
 ok('головна: картка тренування одразу тут, без переходу', train===1);

 const entry=p.locator('#tdy-training');
 ok('головна: картка-вхід у тренування, а не список вправ',
    await entry.count()===1 && await p.locator('#today .tdy-ex').count()===0);
 ok('головна: картка веде на окрему сторінку',
    (await entry.getAttribute('href'))==='workout.html');

 ok('головна: підсумок тижня внизу', /Тиждень/.test(await p.locator('#today').innerText()));
 ok('головна: без JS-помилок', errs.length===0, errs.join('|'));
 await ctx.close();
}

// 1б. today.html перенаправляє на головну — старі посилання не ламаються
{
 const {ctx,p}=await page();
 await p.goto(`file://${ROOT}/today.html`);
 await p.waitForTimeout(900);
 ok('today.html веде на головну', p.url().endsWith('index.html'), p.url().split('/').pop());
 await ctx.close();
}

// 2. Тренування (окрема сторінка): галочка + вага + таймер
{
 const {ctx,p,errs}=await page();
 await p.goto(`file://${ROOT}/index.html`);
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
 await p.waitForTimeout(400);
 await p.goto(`file://${ROOT}/workout.html`); await p.waitForTimeout(1100);
 await p.locator('.tdy-ex [data-set-n="1"]').first().click(); await p.waitForTimeout(2200);
 const sl=await p.evaluate(async()=>{const pr=await window.Store.getProfile();return pr.sessionLog;});
 ok('Тренування: галочка пише сесію в історію', Object.keys(sl||{}).length>0, JSON.stringify(sl));
 const inp=p.locator('[data-wt]').first(); const nm=await inp.getAttribute('data-wt');
 await inp.fill('77.5'); await inp.blur(); await p.waitForTimeout(700);
 const w=await p.evaluate(async n=>{const pr=await window.Store.getProfile();return pr.weights[n];},nm);
 ok('Тренування: робоча вага зберігається в спільну книгу', w===77.5, 'w='+w);
 await p.locator('[data-rest-sec]').first().click(); await p.waitForTimeout(400);
 ok('Тренування: таймер відпочинку запускається', await p.locator('.rest-timer').isVisible());
 ok('Тренування: тости піднялись над таймером', await p.evaluate(()=>document.body.classList.contains('has-rest-timer')));
 ok('Тренування: без JS-помилок', errs.length===0, errs.join('|'));
 await ctx.close();
}

// 3. Та сама вага видима на «Моєму плані» — одна книга, не дві системи
{
 const {ctx,p}=await page();
 await p.goto(`file://${ROOT}/plan.html`);
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(Object.assign({},s,{weights:{'Жим у тренажері':77.5}}));},SEED);
 await p.reload(); await p.waitForTimeout(900);
 await p.locator('.acc:has(.tbl--plan) .acc__head').first().click(); await p.waitForTimeout(500);
 const v=await p.locator('[data-act="weight"]').first().inputValue();
 /* Кома, а не крапка: числа Forge показує однаково скрізь, і поле
    робочої ваги — не виняток (App.fmtNum). Зчитує значення onEdit(),
    яка приймає обидва знаки. */
 ok('план: бачить вагу, введену на «Сьогодні»', v==='77,5', 'value='+v);
 await ctx.close();
}

// 4. Раціон: додавання в конкретний прийом + закриття дня
{
 const {ctx,p,errs}=await page();
 await p.goto(`file://${ROOT}/meals.html`);
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
 await p.reload(); await p.waitForTimeout(900);
 const order=await p.locator('#main .wrap > div').evaluateAll(ds=>ds.map(d=>d.id).filter(Boolean));
 ok('раціон: «День» іде першим', order[0]==='day', order.join(','));
 await p.locator('[data-add-to="1"]').first().click(); await p.waitForTimeout(250);
 await p.locator('#d-quick').fill('рис'); await p.waitForTimeout(400);
 await p.locator('.quick-list__item').first().click(); await p.waitForTimeout(350);
 await p.locator('#m-add').click(); await p.waitForTimeout(600);
 const counts=await p.evaluate(async()=>{const pr=await window.Store.getProfile();return pr.day.meals.map(m=>m.items.length);});
 ok('раціон: продукт ліг саме в обраний прийом', counts[1]===1 && counts[0]===0, JSON.stringify(counts));
 ok('раціон: без JS-помилок', errs.length===0, errs.join('|'));
 await ctx.close();
}

// 5. Друк: інтерфейс прихований, вміст розгорнутий
{
 const {ctx,p}=await page({width:1100,height:900});
 await p.goto(`file://${ROOT}/plan.html`);
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
 await p.reload(); await p.waitForTimeout(900);
 await p.emulateMedia({media:'print'}); await p.waitForTimeout(300);
 const r=await p.evaluate(()=>{
   // Перевіряємо ФАКТИЧНИЙ розмір, а не computed display: у нащадка
   // прихованого предка display лишається своїм, хоч він і не малюється.
   const vis=s=>{const e=document.querySelector(s); if(!e)return false; const r=e.getBoundingClientRect(); return r.height>0&&r.width>0;};
   const body=getComputedStyle(document.body);
   const accInner=document.querySelector('.acc__inner');
   return {nav:vis('#site-nav'), footer:vis('.footer'), btn:vis('.btn'),
     bg:body.backgroundColor, color:body.color,
     accVisible:accInner?getComputedStyle(accInner).visibility:'нема',
     rows:document.querySelectorAll('.tbl--plan tbody tr').length};
 });
 ok('друк: навігація прихована', !r.nav);
 ok('друк: футер прихований', !r.footer);
 ok('друк: кнопки приховані', !r.btn);
 ok('друк: білий фон і чорний текст', r.bg.includes('255, 255, 255') && r.color.includes('0, 0, 0'), r.bg+' / '+r.color);
 ok('друк: згорнуті дні розгорнуті', r.accVisible==='visible', r.accVisible);
 ok('друк: вправи є на аркуші', r.rows>10, 'rows='+r.rows);
 await ctx.close();
}

await b.close();
const bad=R.filter(r=>!r[1]);
console.log('\n'+(R.length-bad.length)+'/'+R.length+' перевірок сценаріїв пройшло.');
process.exit(bad.length?1:0);
