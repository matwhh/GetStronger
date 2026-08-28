import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
const ROOT='/root/work/forgesite';
const url=f=>'file://'+join(ROOT,f);
const PAGES=readdirSync(ROOT).filter(f=>f.endsWith('.html')).sort();
const SEED={birthDate: '1990-06-15', sex:'male',age:30,height:180,weight:82.4,bodyfat:18,activity:1.55,goal:'cut',meals:4,
  daysPerWeek:3,activePlan:{programId:'fullbody',days:3},trainingAge:'inter',
  weights:{'Жим у тренажері':60,'Присідання зі штангою':100},
  bodyLog:{'2026-08-14':83.1,'2026-08-16':82.7,'2026-08-17':82.4},
  workLog:{'2026-08-17':1},hrRest:58,hrMax:190,
  records:{squat:140},
  ratingLog:{'2026-08-18':{rating:3120,delta:25,quality:'ok',reasons:[]}},ratingAlgorithmVersion:1};
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let fails=0;
for(const vp of [{w:390,h:844,n:'mobile'},{w:1280,h:900,n:'desktop'}]){
  const ctx=await adultContext(b, {viewport:{width:vp.w,height:vp.h}});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  page.on('console',m=>{const t=m.text(); if(m.type()==='error'&&!t.includes('ERR_TUNNEL')&&!t.includes('Failed to load resource'))errs.push('CONSOLE '+t);});
  await page.goto(url('index.html'));
  await page.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
  for(const p of PAGES){
    errs.length=0;
    await page.goto(url(p));
    await page.waitForTimeout(750);
    const ov=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
    const overflow=ov.sw>ov.cw+2;
    // сліди «Обраного»
    const fav=await page.evaluate(()=>{
      const html=document.documentElement.innerHTML;
      return {dom:/fav-btn|data-fav-|favorites\.html|FavoritesCore/.test(html),
              txt:/Обране|В обраному|Додати в обране/.test(document.body.innerText)};
    });
    const bad=[];
    if(overflow)bad.push('OVERFLOW '+ov.sw+'>'+ov.cw);
    if(errs.length)bad.push(errs.join(' ; '));
    if(fav.dom)bad.push('FAV DOM');
    if(fav.txt)bad.push('FAV TEXT');
    if(bad.length){fails++;console.log('FAIL ['+vp.n+'] '+p+' :: '+bad.join(' | '));}
  }
  console.log('['+vp.n+'] пройдено '+PAGES.length+' сторінок');
  await ctx.close();
}
await b.close();
console.log(fails? '\n*** ПРОБЛЕМ: '+fails+' ***' : '\nусі сторінки чисті: без overflow, без JS-помилок, без слідів «Обраного»');
process.exit(fails?1:0);
