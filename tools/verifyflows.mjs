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

 /* Головну перебрано: картки сезону, плиток стану й картки-входу в
    тренування там більше немає. Лишились назва програми, номер ТИЖНЯ і
    смуга тижня — їх і перевіряємо. Слово «Сезон» із підпису прибрано
    навмисно: у шапці на телефоні воно з’їдало рядок, а номер сезону
    людина й так бачить у «Рейтингу». Те, що на головній НЕ МАЄ бути
    редактора тренування, лишається як було. */
 const home=await p.locator('#today').innerText();
 ok('головна: назва програми й тиждень', /Full Body/.test(home) && /Тиждень/.test(home), home.split('\n')[0]);
 ok('головна: смуга тижня', /Тиждень/.test(home) && await p.locator('.tdy-day').count()===7);
 ok('головна: видно поточний день', await p.locator('.tdy-day.is-now').count()===1);
 ok('головна: не список вправ', await p.locator('#today .tdy-ex').count()===0);
 ok('головна: плиток стану немає', await p.locator('#today .tile').count()===0);
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
 /* РОБОЧУ ВАГУ ТУТ БІЛЬШЕ НЕ ПРАВЛЯТЬ — її міняють у плані. Тут лишилась
    вага конкретного підходу: вона пише в історію тренування, а книги ваг
    не чіпає. Одне число не може означати дві різні речі. */
 ok('Тренування: поля робочої ваги немає', await p.locator('[data-wt]').count()===0);
 await p.locator('[data-log-tgl]').first().click(); await p.waitForTimeout(400);
 const sw=p.locator('.tdy-set__w').first();
 await sw.fill('77.5'); await sw.blur(); await p.waitForTimeout(700);
 const rec=await p.evaluate(async()=>{
   const pr=await window.Store.getProfile();
   const day=Object.values(pr.sessionLog||{})[0]||{};
   return JSON.stringify(day).indexOf('77.5')!==-1;
 });
 ok('Тренування: вага підходу лягла в історію тренування', rec);
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
 /* Кома, а не крапка: числа Get Stronger показує однаково скрізь, і поле
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
