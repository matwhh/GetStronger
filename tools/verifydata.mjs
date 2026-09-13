import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { CHROME, ROOT } from './pw.mjs';
const b=await chromium.launch({executablePath:CHROME});
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};

// 1. Старий профіль з «Обраним» не ламає завантаження, поле знімається
{
 const ctx=await adultContext(b); const p=await ctx.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`file://${ROOT}/account.html`);
 await p.waitForTimeout(500);
 await p.evaluate(()=>{localStorage.setItem('ib.profile',JSON.stringify({
   version:5, birthDate:'1990-06-15', weight:80, favorites:{exercise:['Присідання'],page:['today.html']},
   weights:{'Жим лежачи':70}, bodyLog:{'2026-08-01':81}}));});
 await p.reload(); await p.waitForTimeout(900);
 const pr=await p.evaluate(async()=>await window.Store.getProfile());
 ok('старий профіль з favorites завантажується', pr.weight===80 && pr.weights['Жим лежачи']===70);
 ok('legacy-поле favorites знято при нормалізації', !('favorites' in pr), JSON.stringify(Object.keys(pr).filter(k=>k==='favorites')));
 ok('решта даних не постраждала', pr.bodyLog['2026-08-01']===81);
 ok('без JS-помилок', errs.length===0, errs.join('|'));
 await ctx.close();
}

// 2. Імпорт старого експорту з favorites — поле мовчки відкидається
{
 const ctx=await adultContext(b); const p=await ctx.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept());
 const tmp=path.join(os.tmpdir(),'legacy.json');
 fs.writeFileSync(tmp,JSON.stringify({version:5,birthDate:'1990-06-15', weight:77,age:31,
   favorites:{program:['ppl'],exercise:['Тяга']},
   trackerLog:{sleep:{'2026-08-17':{value:420,source:'manual',date:'2026-08-17'}}}}));
 await p.goto(`file://${ROOT}/account.html`); await p.waitForTimeout(800);
 await p.setInputFiles('#p-import-file',tmp); await p.waitForTimeout(900);
 const pr=await p.evaluate(async()=>await window.Store.getProfile());
 ok('імпорт старого файлу не впав', pr.weight===77 && pr.age===31);
 ok('favorites не потрапило в профіль', !('favorites' in pr));
 ok('trackerLog {value,source,date} пережив імпорт', pr.trackerLog?.sleep?.['2026-08-17']?.value===420);
 ok('імпорт без JS-помилок', errs.length===0, errs.join('|'));
 fs.unlinkSync(tmp); await ctx.close();
}

// 3. Експорт → імпорт (round-trip) усіх ключових полів
{
 const ctx=await adultContext(b); const p=await ctx.newPage();
 p.on('dialog',d=>d.accept());
 await p.goto(`file://${ROOT}/account.html`);
 const SEED={birthDate: '1990-06-15', sex:'male',age:30,height:180,weight:82.4,activity:1.55,goal:'cut',meals:4,
  daysPerWeek:3,activePlan:{programId:'fullbody',days:3},weights:{'Жим лежачи':92.5},
  weightLog:{'Жим лежачи':[{d:'2026-08-17',kg:92.5}]},bodyLog:{'2026-08-17':82.4},
  workLog:{'2026-08-17':1},trackers:{sleep:{id:'sleep',type:'sleep',name:'Сон',enabled:true,settings:{},goal:480,source:'manual',order:0,createdAt:null}},
  trackerLog:{sleep:{'2026-08-17':{value:430,source:'apple_health',date:'2026-08-17'}}},
  ratingLog:{'2026-08-17':{rating:900,delta:20,quality:0.8,reasons:[{key:'train',label:'Тренування',pts:20}]}},ratingSeen:{'train:2026-08-17':'2026-08-17'},ratingAlgorithmVersion:1};
 await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
 const dump=await p.evaluate(async()=>JSON.stringify(await window.Store.getProfile()));
 const tmp=path.join(os.tmpdir(),'rt.json'); fs.writeFileSync(tmp,dump);
 // чистий контекст → імпорт
 const ctx2=await adultContext(b); const p2=await ctx2.newPage(); p2.on('dialog',d=>d.accept());
 await p2.goto(`file://${ROOT}/account.html`); await p2.waitForTimeout(800);
 await p2.setInputFiles('#p-import-file',tmp); await p2.waitForTimeout(900);
 const back=await p2.evaluate(async()=>await window.Store.getProfile());
 ok('round-trip: ваги', back.weights['Жим лежачи']===92.5);
 ok('round-trip: історія ваг', back.weightLog['Жим лежачи']?.[0]?.kg===92.5);
 ok('round-trip: журнал тіла', back.bodyLog['2026-08-17']===82.4);
 ok('round-trip: трекер із джерелом apple_health', back.trackerLog.sleep['2026-08-17'].source==='apple_health');
 ok('round-trip: Get Stronger Rating', back.ratingLog?.['2026-08-17']?.rating===900 && back.ratingSeen?.['train:2026-08-17']==='2026-08-17', 'ratingLog='+JSON.stringify(back.ratingLog)+' seen='+JSON.stringify(back.ratingSeen));
 ok('round-trip: активний план', back.activePlan.programId==='fullbody');
 fs.unlinkSync(tmp); await ctx.close(); await ctx2.close();
}

// 4. Offline: запис іде в чергу, індикатор зʼявляється, після reload дані на місці
{
 const ctx=await adultContext(b); const p=await ctx.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`file://${ROOT}/index.html`); await p.waitForTimeout(700);
 await ctx.setOffline(true);
 await p.evaluate(async()=>{await window.Store.saveProfile({weight:79.9});});
 await p.waitForTimeout(400);
 const w=await p.evaluate(async()=>(await window.Store.getProfile()).weight);
 ok('offline: збереження працює (локальний режим)', w===79.9);
 await p.reload(); await p.waitForTimeout(700);
 const w2=await p.evaluate(async()=>(await window.Store.getProfile()).weight);
 ok('offline: переживає reload', w2===79.9);
 ok('offline: без JS-помилок', errs.length===0, errs.join('|'));
 await ctx.close();
}

// 5. Міграція старої (v3) схеми
{
 const ctx=await adultContext(b); const p=await ctx.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`file://${ROOT}/account.html`);
 await p.waitForTimeout(500);
 /* Поточну версію схеми беремо з самого застосунку, а не числом у тесті:
    захардкоджена 6 протрималась до SCHEMA_VERSION=9 і почала брехати. */
 const CUR=await p.evaluate(async()=>(await window.Store.getProfile()).version);
 await p.evaluate(()=>{localStorage.setItem('ib.profile',JSON.stringify({version:3,weight:75,weights:{'Присід':100}}));});
 await p.reload(); await p.waitForTimeout(900);
 const pr=await p.evaluate(async()=>await window.Store.getProfile());
 ok('міграція v3 → поточна версія', pr.version===CUR, 'version='+pr.version+' очікувалось '+CUR);
 ok('міграція: дані збережені', pr.weight===75 && pr.weights['Присід']===100);
 ok('міграція: створено ratingLog/ratingSeen', !!pr.ratingLog && !!pr.ratingSeen);
 ok('міграція без JS-помилок', errs.length===0, errs.join('|'));
 await ctx.close();
}

// 6. Копія дня харчування (F1): знімок із історії → у поточний день
//
// Перевіряється саме те, що ламається тихо: позиція, чийого продукту вже
// немає в довіднику, мусить принести з собою калорії, а не нуль, і мусить
// пережити перезавантаження — інакше копія дня живе до першого reload.
{
 const ctx=await adultContext(b); const p=await ctx.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept());
 await p.goto(`file://${ROOT}/meals.html`); await p.waitForTimeout(900);

 await p.evaluate(async()=>{
   await window.Store.saveProfile({
     mealLog:{'2026-09-01':{kcal:530,p:70,f:14,c:30,fiber:1,target:2200,pTarget:150,
       meals:[{name:'Сніданок',items:[
         {kind:'snap',name:'Куряча грудка',unit:'g',qty:200,
          per:{kcal:1.65,p:0.31,f:0.036,c:0,fiber:0},foodId:'chicken-breast',cooked:false},
         {kind:'snap',name:'Зниклий продукт',unit:'g',qty:100,
          per:{kcal:2,p:0.1,f:0.05,c:0.3,fiber:0.01}}
       ]}]}},
     day:{meals:[],date:null}});
 });
 await p.reload(); await p.waitForTimeout(900);

 const hasBtn=await p.locator('#d-copy').count();
 ok('кнопка «Скопіювати день» є на сторінці', hasBtn===1);

 await p.click('#d-copy'); await p.waitForTimeout(250);
 const rows=await p.locator('#d-copy-list [data-copy-add]').count();
 ok('список джерел показує закритий день зі знімком', rows===1, 'рядків='+rows);

 await p.click('[data-copy-add="2026-09-01"]'); await p.waitForTimeout(600);
 const after=await p.evaluate(async()=>{
   const pr=await window.Store.getProfile();
   const items=(pr.day.meals||[]).reduce((a,m)=>a.concat(m.items||[]),[]);
   return {items:items,
           kcal:window.DayCore.dayTotals(pr.day, pr.recipes||[]).kcal,
           /* Очікуване рахуємо ТУТ, із самого довідника: 200 г курки за
              її власним КБЖВ плюс 100 × 2 ккал замороженої позиції. Зашите
              число в тесті означало б, що тест ловить правку довідника
              замість правки копії. */
           want:window.Foods.amount(window.Foods.byId('chicken-breast'),200,false).kcal+200};
 });
 ok('скопійовано дві позиції', after.items.length===2, JSON.stringify(after.items));
 ok('живий продукт лягає посиланням', after.items[0]?.kind==='food' && after.items[0]?.foodId==='chicken-breast', JSON.stringify(after.items[0]));
 ok('зниклий продукт лягає замороженим', after.items[1]?.kind==='snap' && after.items[1]?.qty===100, JSON.stringify(after.items[1]));
 /* Заморожена позиція мусить принести свої 200 ккал. Якби вона
    рахувалась як нуль — саме та тиха помилка, проти якої все це є, —
    підсумок дорівнював би лише курці, і цей рядок це побачить. */
 ok('копія рахує і живу, і заморожену позицію', Math.abs(after.kcal-after.want)<0.5, 'kcal='+after.kcal+' очікувалось '+after.want);
 ok('заморожена позиція додала свої калорії', after.kcal-200>1 && after.kcal>200, 'kcal='+after.kcal);

 await p.reload(); await p.waitForTimeout(900);
 /* Читаємо РОЗМІТКУ, а не localStorage: у сховищі позиція лежить хоч би
    що, а от sanitizeDay могла її викинути при читанні профілю — і тоді
    людина бачить на екрані менше, ніж зберегла, поки наступний persist
    не зробить цю втрату остаточною. Перевірка через Store.getProfile
    цього не бачила: вона проходила і без гілки snap у sanitizeDay. */
 const kept=await p.locator('#day tbody tr').count();
 const snapShown=await p.locator('#day tbody tr', {hasText:'Зниклий продукт'}).count();
 ok('заморожена позиція переживає перезавантаження', kept===2 && snapShown===1, 'рядків='+kept+' заморожених='+snapShown);
 ok('копія дня без JS-помилок', errs.length===0, errs.join('|'));
 await ctx.close();
}

// 7. Швидкий запис дня (F2): ккал без розбору по грамах
//
// Головне, що тут ловиться: приблизний день мусить лягти в історію
// ПОЗНАЧЕНИМ. Без прапорця його нульовий жир і нульовий білок стають
// «виміряними» — і брешуть уже назавжди, бо історія append-only.
{
 const ctx=await adultContext(b); const p=await ctx.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept());
 await p.goto(`file://${ROOT}/meals.html`); await p.waitForTimeout(900);

 ok('перемикач режиму є на сторінці', await p.locator('input[name="d-mode"]').count()===2);

 await p.click('.seg__item:has-text("Швидко") span'); await p.waitForTimeout(300);
 ok('швидкий режим показує поле калорій', await p.locator('#q-kcal').count()===1);
 ok('швидкий режим прибирає картки прийомів', await p.locator('#day .card__title').count()===0);
 ok('ціль дня лишається на екрані', /Ціль дня|Ціль дня не порахована/.test(await p.locator('#d-quick-form').innerText()));

 await p.fill('#q-kcal','2400');
 await p.click('#q-save'); await p.waitForTimeout(700);
 const q1=await p.evaluate(async()=>{
   const pr=await window.Store.getProfile();
   const k=Object.keys(pr.mealLog||{}).sort().pop();
   return {k:k, e:(pr.mealLog||{})[k], dayItems:(pr.day.meals||[]).reduce((a,m)=>a.concat(m.items||[]),[]).length};
 });
 ok('день ліг в історію', q1.e && q1.e.kcal===2400, JSON.stringify(q1.e));
 ok('день позначено приблизним', q1.e && q1.e.partial===true, JSON.stringify(q1.e));
 ok('жир і вуглеводи не вигадані', q1.e && q1.e.f===0 && q1.e.c===0);
 ok('поточний день очищено', q1.dayItems===0, 'позицій='+q1.dayItems);

 /* Межі: 50 ккал — це не день, а описка; запис не мусить зʼявитись */
 const before=await p.evaluate(async()=>Object.keys((await window.Store.getProfile()).mealLog||{}).length);
 await p.fill('#q-kcal','50'); await p.click('#q-save'); await p.waitForTimeout(400);
 const afterN=await p.evaluate(async()=>Object.keys((await window.Store.getProfile()).mealLog||{}).length);
 ok('50 ккал за день не приймається', afterN===before, before+' → '+afterN);

 await p.reload(); await p.waitForTimeout(900);
 ok('вибраний режим памʼятається', await p.locator('#q-kcal').count()===1);

 /* Журнал мусить сказати «приблизно» — тихо, без червоного */
 await p.goto(`file://${ROOT}/journal.html`); await p.waitForTimeout(1200);
 const jr=await p.locator('#jr-food').innerText();
 ok('журнал підписує приблизний день', /приблизно/.test(jr), jr.slice(0,200));
 ok('приблизний день не підсвічено як помилку',
    await p.locator('#jr-food .chip--err').count()===0);
 ok('швидкий запис без JS-помилок', errs.length===0, errs.join('|'));
 await ctx.close();
}

await b.close();
const bad=R.filter(r=>!r[1]);
console.log('\n'+(R.length-bad.length)+'/'+R.length+' перевірок даних пройшло.');
process.exit(bad.length?1:0);
