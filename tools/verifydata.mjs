import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};

// 1. Старий профіль з «Обраним» не ламає завантаження, поле знімається
{
 const ctx=await adultContext(b); const p=await ctx.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push(e.message));
 await p.goto('file:///root/work/forgesite/account.html');
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
 await p.goto('file:///root/work/forgesite/account.html'); await p.waitForTimeout(800);
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
 await p.goto('file:///root/work/forgesite/account.html');
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
 await p2.goto('file:///root/work/forgesite/account.html'); await p2.waitForTimeout(800);
 await p2.setInputFiles('#p-import-file',tmp); await p2.waitForTimeout(900);
 const back=await p2.evaluate(async()=>await window.Store.getProfile());
 ok('round-trip: ваги', back.weights['Жим лежачи']===92.5);
 ok('round-trip: історія ваг', back.weightLog['Жим лежачи']?.[0]?.kg===92.5);
 ok('round-trip: журнал тіла', back.bodyLog['2026-08-17']===82.4);
 ok('round-trip: трекер із джерелом apple_health', back.trackerLog.sleep['2026-08-17'].source==='apple_health');
 ok('round-trip: Forge Rating', back.ratingLog?.['2026-08-17']?.rating===900 && back.ratingSeen?.['train:2026-08-17']==='2026-08-17', 'ratingLog='+JSON.stringify(back.ratingLog)+' seen='+JSON.stringify(back.ratingSeen));
 ok('round-trip: активний план', back.activePlan.programId==='fullbody');
 fs.unlinkSync(tmp); await ctx.close(); await ctx2.close();
}

// 4. Offline: запис іде в чергу, індикатор зʼявляється, після reload дані на місці
{
 const ctx=await adultContext(b); const p=await ctx.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push(e.message));
 await p.goto('file:///root/work/forgesite/index.html'); await p.waitForTimeout(700);
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
 await p.goto('file:///root/work/forgesite/account.html');
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

await b.close();
const bad=R.filter(r=>!r[1]);
console.log('\n'+(R.length-bad.length)+'/'+R.length+' перевірок даних пройшло.');
process.exit(bad.length?1:0);
