import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};
const SEED={birthDate: '1990-06-15', sex:'male',age:30,height:180,weight:82,activity:1.55,goal:'cut',meals:4,daysPerWeek:3,
  activePlan:{programId:'fullbody',days:3}};

// A. Модалка раціону: focus trap, Escape, повернення фокуса, aria
{
 const ctx=await adultContext(b, {viewport:{width:1100,height:900}}); const p=await ctx.newPage();
 await p.goto('file:///root/work/forgesite/meals.html');
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
 await p.reload(); await p.waitForTimeout(900);
 await p.locator('[data-add-to="0"]').first().click(); await p.waitForTimeout(200);
 await p.locator('#d-quick').fill('курка'); await p.waitForTimeout(400);
 await p.locator('.quick-list__item').first().click(); await p.waitForTimeout(400);
 const box=p.locator('.modal__box');
 ok('модалка: role=dialog + aria-modal', await box.getAttribute('role')==='dialog' && await box.getAttribute('aria-modal')==='true');
 ok('модалка: має доступну назву', !!(await box.getAttribute('aria-labelledby')));
 // Tab по колу — фокус не має вийти за межі
 let outside=false;
 for(let i=0;i<25;i++){ await p.keyboard.press('Tab');
   if(!(await p.evaluate(()=>!!document.activeElement.closest('.modal__box')))) {outside=true;break;} }
 ok('модалка: фокус не виходить за межі (25 Tab)', !outside);
 await p.keyboard.press('Escape'); await p.waitForTimeout(300);
 ok('модалка: Escape закриває', await p.locator('#modal').isHidden());
 ok('модалка: фокус повернувся у сторінку', await p.evaluate(()=>document.activeElement!==document.body));
 await ctx.close();
}

// B. Мобільне меню
{
 const ctx=await adultContext(b, {viewport:{width:390,height:844}}); const p=await ctx.newPage();
 await p.goto('file:///root/work/forgesite/index.html'); await p.waitForTimeout(700);
 await p.locator('.nav__burger').click(); await p.waitForTimeout(300);
 ok('меню: aria-expanded=true після відкриття', await p.locator('.nav__burger').getAttribute('aria-expanded')==='true');
 await p.keyboard.press('Escape'); await p.waitForTimeout(300);
 ok('меню: Escape закриває', await p.locator('.nav__burger').getAttribute('aria-expanded')==='false');
 ok('меню: фокус повернувся на бургер', await p.evaluate(()=>document.activeElement.classList.contains('nav__burger')));
 await ctx.close();
}

// C. Доступні назви інтерактивних елементів + aria-pressed на шкалах
{
 const ctx=await adultContext(b, {viewport:{width:1100,height:900}}); const p=await ctx.newPage();
 await p.goto('file:///root/work/forgesite/index.html');
 await p.waitForTimeout(500);
 await p.evaluate(async s=>{await window.Store.saveProfile(Object.assign({},s,{trackers:{
   mood:{id:'mood',type:'mood',name:'Настрій',enabled:true,settings:{},goal:null,source:null,order:2,createdAt:null}}}));},SEED);
 /* Шкали 1..10 тепер живуть на сторінці «Трекери», а не на «Сьогодні» */
 await p.goto('file:///root/work/forgesite/trackers.html'); await p.waitForTimeout(1100);
 const noName=await p.evaluate(()=>{
   const out=[];
   document.querySelectorAll('button, input, select, a[href]').forEach(el=>{
     const t=(el.textContent||'').trim();
     const name=el.getAttribute('aria-label')||el.getAttribute('title')||t||
       (el.labels&&el.labels.length?el.labels[0].textContent.trim():'')||
       (el.getAttribute('aria-labelledby')?'byid':'');
     if(!name) out.push(el.tagName+'.'+(el.className||'').toString().slice(0,40));
   });
   return out;
 });
 ok('усі кнопки/поля/посилання мають доступну назву', noName.length===0, noName.join(' | '));
 const scale=await p.locator('.qi-scale__btn').first();
 ok('кнопки шкали 1..10 мають aria-pressed', (await scale.getAttribute('aria-pressed'))!==null);
 const grp=await p.locator('.qi-scale').first();
 ok('шкала має role=group з назвою', await grp.getAttribute('role')==='group' && !!(await grp.getAttribute('aria-label')));
 // фокус видимий
 const fv=await p.evaluate(()=>{const s=getComputedStyle(document.documentElement);return true;});
 await ctx.close();
}

// D. Тости оголошуються
{
 const ctx=await adultContext(b); const p=await ctx.newPage();
 await p.goto('file:///root/work/forgesite/index.html'); await p.waitForTimeout(700);
 await p.evaluate(()=>window.App.toast('тест','ok')); await p.waitForTimeout(200);
 const t=p.locator('.toasts');
 ok('контейнер тостів має role=status + aria-live', await t.getAttribute('role')==='status' && await t.getAttribute('aria-live')==='polite');
 await ctx.close();
}

/* E. Закрите мобільне меню має бути НЕВИДИМИМ і для дотику, і для Tab.
   Ховалось лише прозорістю, а .nav__drop ще й повертав pointer-events:auto —
   невидима накладка на 770 із 844 пікселів ловила дотики по сторінці:
   тап по кнопці внизу «Раціону» відкривав калькулятор 1ПМ. */
{
 const ctx=await adultContext(b, {viewport:{width:390,height:844}}); const p=await ctx.newPage();
 await p.goto('file:///root/work/forgesite/meals.html'); await p.waitForTimeout(900);
 const before=p.url();
 await p.mouse.click(195, 780);
 await p.waitForTimeout(600);
 ok('закрите меню не перехоплює дотик по сторінці', p.url()===before, p.url().split('/').pop());

 await p.goto('file:///root/work/forgesite/meals.html'); await p.waitForTimeout(800);
 let inMenu=0;
 for(let i=0;i<8;i++){ await p.keyboard.press('Tab');
   if(await p.evaluate(()=>{const a=document.activeElement;return !!(a.closest&&a.closest('.nav__links'));})) inMenu++; }
 ok('Tab не ходить крізь закрите меню', inMenu===0, 'потрапив у меню '+inMenu+' разів');

 await p.locator('.nav__burger').click(); await p.waitForTimeout(500);
 ok('відкрите меню видиме', await p.locator('.nav__links').evaluate(e=>getComputedStyle(e).visibility)==='visible');
 await p.locator('.nav__links a[href="boxing.html"]').scrollIntoViewIfNeeded();
 await p.locator('.nav__links a[href="boxing.html"]').click({timeout:5000});
 await p.waitForTimeout(700);
 ok('пункт із випадної групи працює в мобільному меню', p.url().includes('boxing'), p.url().split('/').pop());
 await ctx.close();
}
{
 const ctx=await adultContext(b, {viewport:{width:1280,height:900}}); const p=await ctx.newPage();
 await p.goto('file:///root/work/forgesite/index.html'); await p.waitForTimeout(800);
 /* Групу знаходимо за вмістом, а не за позицією: «Бокс» переїхав із
    групи-кнопки «Інше» під «Тренування», у якої є власна сторінка, тому
    перемикачем там служить стрілка, а не сам заголовок. */
 const grp = p.locator('.nav__item', { has: p.locator('a[href="boxing.html"]') }).first();
 const toggle = grp.locator('.nav__caret, .nav__link--parent').first();
 await toggle.click({timeout:5000}); await p.waitForTimeout(400);
 await grp.locator('.nav__drop a[href="boxing.html"]').click({timeout:5000});
 await p.waitForTimeout(700);
 ok('десктоп: пункт із випадної групи працює', p.url().includes('boxing'), p.url().split('/').pop());
 await ctx.close();
}

await b.close();
const bad=R.filter(r=>!r[1]);
console.log('\n'+(R.length-bad.length)+'/'+R.length+' перевірок доступності пройшло.');
process.exit(bad.length?1:0);
