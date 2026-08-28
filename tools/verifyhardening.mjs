/**
 * Ворожий прохід: пошкоджені дані, швидкі кліки, offline, гонки.
 * Не частина npm test — потребує браузера. Див. tools/README-verify.md.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const CHROME='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const U=f=>'file:///root/work/forgesite/'+f;
const b=await chromium.launch({executablePath:CHROME});
const T=2500;   // максимум очікування локатора — щоб зависання було видно як FAIL, а не як тиша

/* Клік із попереднім доведенням елемента до середини вікна.
   Липка шапка перекриває верх сторінки, а scrollIntoViewIfNeeded у
   Playwright не зважає на scroll-padding-top — елемент опиняється під
   шапкою й клік влучає в неї. Для людини цієї проблеми немає: вона
   гортає сама й тисне те, що бачить. */
async function tap(loc, opts) {
  await loc.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
  return loc.click(Object.assign({ timeout: T }, opts || {}));
}
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};

async function page(vp){
  const ctx=await adultContext(b, {viewport:vp||{width:390,height:844}});
  const p=await ctx.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  p.on('console',m=>{const t=m.text(); if(m.type()==='error'&&!t.includes('ERR_TUNNEL')&&!t.includes('Failed to load resource'))errs.push('CONSOLE '+t);});
  return {ctx,p,errs};
}
const PAGES=fs.readdirSync('/root/work/forgesite').filter(f=>f.endsWith('.html')).sort();

/* ---- 1. Пошкоджений localStorage: жодна сторінка не має падати ---- */
const CORRUPT = [
  ['неправильні типи всюди', {version:5,weights:[],bodyLog:'x',day:{meals:null},sessionLog:[],trackers:null,recipes:{},customPlans:'x',weightLog:0,ratingLog:[],mealLog:'',workLog:7}],
  ['битий JSON', 'НЕ JSON {{{'],
  ['порожній рядок', ''],
  ['масив замість обʼєкта', []],
  ['версія з майбутнього', {version:999,weight:80,futureField:{a:1}}],
  ['день без items', {version:5,day:{meals:[{name:'Сніданок'}]}}],
  ['план на неіснуючу програму', {version:5,activePlan:{programId:'НЕМАЄ',days:3}}],
  ['вправа поза каталогом', {version:5,activePlan:{programId:'fullbody',days:3},customPlans:{'fullbody:3':[{name:'Д',exercises:[{name:'Вигадана вправа',sets:3,reps:'8'}]}]}}],
  ['рецепт-привид у дні', {version:5,day:{meals:[{name:'Обід',items:[{kind:'recipe',recipeId:'НЕМАЄ',portions:2}]}]}}],
  ['від\'ємні та величезні числа', {version:5,birthDate:'1990-06-15', weight:-5,age:1e9,height:0,weights:{'Жим':-100},bodyLog:{'2026-08-17':-40}}],
];
for (const [label, payload] of CORRUPT) {
  const {ctx,p,errs}=await page();
  await p.goto(U('index.html'));
  await p.evaluate(v=>{localStorage.setItem('ib.profile', typeof v==='string'?v:JSON.stringify(v));}, payload);
  const broken=[];
  for (const f of PAGES) {
    errs.length=0;
    await p.goto(U(f)); await p.waitForTimeout(500);
    if (errs.length) broken.push(f+': '+errs[0].slice(0,90));
  }
  ok('пошкоджене сховище — '+label, broken.length===0, broken.join(' | '));
  await ctx.close();
}

/* ---- 2. Швидкі повторні кліки не дублюють даних ---- */
{
  const {ctx,p,errs}=await page();
  p.on('dialog',d=>d.accept());
  await p.goto(U('meals.html'));
  await p.evaluate(async()=>{await window.Store.saveProfile({birthDate: '1990-06-15', sex:'male',age:30,height:180,weight:82,activity:1.55,goal:'cut',meals:3});});
  await p.reload(); await p.waitForTimeout(900);
  await tap(p.locator('[data-add-to="0"]').first()); await p.waitForTimeout(250);
  await p.locator('#d-quick').fill('рис'); await p.waitForTimeout(400);
  await tap(p.locator('.quick-list__item').first()); await p.waitForTimeout(350);
  // п'ять швидких кліків по «Додати»
  for (let i=0;i<5;i++) await tap(p.locator('#m-add'),{force:true}).catch(()=>{});
  await p.waitForTimeout(900);
  const n=await p.evaluate(async()=>{const pr=await window.Store.getProfile();return pr.day.meals.reduce((s,m)=>s+m.items.length,0);});
  ok('5 швидких кліків «Додати» → рівно 1 позиція', n===1, 'позицій='+n);
  ok('без JS-помилок', errs.length===0, errs.join('|'));
  await ctx.close();
}

/* ---- 3. Швидкі кліки по трекеру: значення не подвоюється понад межу ---- */
{
  const {ctx,p,errs}=await page();
  await p.goto(U('trackers.html')); await p.waitForTimeout(900);
  const row=p.locator('.tr-row', {hasText:'Вода'}).first();
  await tap(row.locator('[data-expand]')).catch(()=>{}); await p.waitForTimeout(300);
  const add=row.locator('[data-add]').first();
  for (let i=0;i<12;i++) await tap(add,{force:true}).catch(()=>{});
  await p.waitForTimeout(800);
  const v=await p.evaluate(async()=>{const pr=await window.Store.getProfile();const k=Object.keys(pr.trackerLog?.water||{})[0];return pr.trackerLog.water[k];});
  ok('вода клампиться межею каталогу (≤15)', typeof v==='number' && v<=15, 'value='+v);
  ok('без JS-помилок', errs.length===0, errs.join('|'));
  await ctx.close();
}

/* ---- 4. offline → зміна → reload → reconnect ---- */
{
  const {ctx,p,errs}=await page();
  await p.goto(U('journal.html')); await p.waitForTimeout(800);
  await ctx.setOffline(true);
  await p.evaluate(async()=>{await window.Store.saveProfile({bodyLog:{'2026-08-18':79.9}});});
  await p.waitForTimeout(400);
  await p.reload(); await p.waitForTimeout(800);
  const afterReload=await p.evaluate(async()=>(await window.Store.getProfile()).bodyLog['2026-08-18']);
  ok('offline: зміна пережила reload', afterReload===79.9, String(afterReload));
  await ctx.setOffline(false);
  await p.waitForTimeout(600);
  await p.reload(); await p.waitForTimeout(800);
  const afterOnline=await p.evaluate(async()=>(await window.Store.getProfile()).bodyLog['2026-08-18']);
  ok('reconnect: дані на місці, без дублювання', afterOnline===79.9, String(afterOnline));
  ok('offline без JS-помилок', errs.length===0, errs.join('|'));
  await ctx.close();
}

/* ---- 5. Перехід на іншу сторінку одразу після вводу ---- */
{
  const {ctx,p,errs}=await page();
  await p.goto(U('account.html')); await p.waitForTimeout(1200);
  await p.locator('#p-weight').fill('77.7');
  await p.goto(U('journal.html'));            // не чекаємо на дебаунс
  await p.waitForTimeout(1000);
  const w=await p.evaluate(async()=>(await window.Store.getProfile()).weight);
  ok('перехід одразу після вводу не губить значення', w===77.7, String(w));
  ok('без JS-помилок', errs.length===0, errs.join('|'));
  await ctx.close();
}

/* ---- 6. Порожній профіль: усі сторінки живі ---- */
{
  const {ctx,p,errs}=await page();
  await p.goto(U('index.html'));
  await p.evaluate(()=>{localStorage.clear();});
  const broken=[];
  for (const f of PAGES){ errs.length=0; await p.goto(U(f)); await p.waitForTimeout(450); if(errs.length) broken.push(f+': '+errs[0].slice(0,80)); }
  ok('порожній профіль — жодна сторінка не падає', broken.length===0, broken.join(' | '));
  await ctx.close();
}

/* ---- 7. Крайні числові значення у формах ---- */
{
  const {ctx,p,errs}=await page({width:1100,height:900});
  await p.goto(U('nutrition.html')); await p.waitForTimeout(800);
  await p.locator('#n-age').fill('30'); await p.locator('#n-height').fill('180');
  await p.locator('#n-weight').fill('1000');
  await tap(p.locator('#n-save')); await p.waitForTimeout(700);
  const saved=await p.evaluate(async()=>(await window.Store.getProfile()).weight);
  ok('вага 1000 не потрапляє в профіль', saved !== 1000, 'weight='+saved);
  await p.locator('#n-weight').fill('82');
  await tap(p.locator('#n-save')); await p.waitForTimeout(700);
  const ok2=await p.evaluate(async()=>{const pr=await window.Store.getProfile();return {w:pr.weight,t:!!window.NutritionCalc.targetFor(pr)};});
  ok('коректне значення зберігається й норма рахується', ok2.w===82 && ok2.t, JSON.stringify(ok2));
  ok('без JS-помилок', errs.length===0, errs.join('|'));
  await ctx.close();
}

await b.close();
const bad=R.filter(r=>!r[1]);
console.log('\n'+(R.length-bad.length)+'/'+R.length+' перевірок стійкості пройшло.');
if(bad.length) console.log('ПРОВАЛЕНО: '+bad.map(x=>x[0]).join('; '));
process.exit(bad.length?1:0);
