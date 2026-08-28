/**
 * Export → Clear → Import → Verify + стійкість валідатора.
 * Не частина npm test — потребує браузера. Див. tools/README-verify.md.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import fs from 'node:fs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const R=[]; const ok=(n,c,x)=>{R.push([n,c]);console.log((c?'OK   ':'FAIL ')+n+(x?' :: '+x:''));};
const SEED={
  sex:'female', age:29, height:168, weight:61.4, bodyfat:22, activity:1.375, goal:'cut', meals:4,
  daysPerWeek:3, trainingAge:'inter', hrRest:56, hrMax:191, theme:'violet',
  activePlan:{programId:'fullbody',days:3},
  customPlans:{'fullbody:3':[{name:'День A',title:'День A',focus:'Усе тіло',exercises:[
    {name:'Присідання зі штангою',sets:3,reps:'6–8',rir:'2',rest:'3 хв',note:'',lift:'compound',circuit:1,muscles:['quads']}]}]},
  weights:{'Присідання зі штангою':92.5},
  weightLog:{'Присідання зі штангою':[{d:'2026-08-10',kg:90},{d:'2026-08-17',kg:92.5}]},
  bodyLog:{'2026-08-16':61.8,'2026-08-17':61.4}, workLog:{'2026-08-17':1},
  sessionLog:{'2026-08-17':{programId:'fullbody',days:3,dayIdx:0,title:'День A',done:5,total:7}},
  mealLog:{'2026-08-17':{kcal:2100,p:150,f:60,c:220,fiber:30,target:2150}},
  recipes:[{id:'r1',name:'Курка з рисом',url:'https://example.com/recipe',author:'Автор',containers:5,prepMin:15,cookMin:25,
    items:[{foodId:'chicken-breast',grams:900,cooked:true}]}],
  day:{meals:[{name:'Сніданок',items:[{kind:'food',foodId:'rice-white',grams:200,cooked:true}]},
              {name:'Обід',items:[{kind:'recipe',recipeId:'r1',portions:2}]},
              {name:'Полуденок',items:[]},{name:'Вечеря',items:[]}]},
  periodization:{weeks:8,cadence:1,mode:'linear',startPct:70,endPct:85,stepPct:2.5,startedAt:'2026-07-01T00:00:00.000Z',oneRM:{'Присідання зі штангою':120}},
  deload:{percent:15,at:'2026-08-01T00:00:00.000Z',before:{'Присідання зі штангою':100}},
  ratingLog:{'2026-08-17':{rating:1500,delta:22,quality:0.7,reasons:[{key:'train',label:'Тренування',pts:12}]}},
  ratingSeen:{'train:2026-08-17':'2026-08-17'}, ratingAlgorithmVersion:1,
  weightsHarvested:true, weightLogSeeded:true,
  trackers:{sleep:{id:'sleep',type:'sleep',name:'Сон',enabled:true,settings:{},goal:480,source:'manual',order:0,createdAt:null}},
  trackerLog:{sleep:{'2026-08-17':{value:430,source:'apple_health',date:'2026-08-17'}}}
};

const ctx=await adultContext(b); const p=await ctx.newPage(); p.on('dialog',d=>d.accept());
await p.goto('file:///root/work/forgesite/account.html'); await p.waitForTimeout(800);
await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
const dump=await p.evaluate(async()=>JSON.stringify(await window.Store.getProfile()));
const tmp='/tmp/rt.json'; fs.writeFileSync(tmp,dump);

const ctx2=await adultContext(b); const p2=await ctx2.newPage(); p2.on('dialog',d=>d.accept());
const errs=[]; p2.on('pageerror',e=>errs.push(e.message));
await p2.goto('file:///root/work/forgesite/account.html'); await p2.waitForTimeout(800);
await p2.setInputFiles('#p-import-file',tmp); await p2.waitForTimeout(1100);
const B=await p2.evaluate(async()=>await window.Store.getProfile());

ok('стать (female, не відкинута)', B.sex==='female', B.sex);
ok('тема', B.theme==='violet', B.theme);
ok('позначка «готове» у дні', B.day.meals[0].items[0].cooked===true);
ok('позначка «готове» в рецепті', B.recipes[0].items[0].cooked===true);
ok('посилання рецепта', B.recipes[0].url==='https://example.com/recipe');
ok('назва й фокус дня плану', B.customPlans['fullbody:3'][0].title==='День A' && B.customPlans['fullbody:3'][0].focus==='Усе тіло');
ok('lift і circuit вправи', B.customPlans['fullbody:3'][0].exercises[0].lift==='compound' && B.customPlans['fullbody:3'][0].exercises[0].circuit===1);
ok('історія ваг', B.weightLog['Присідання зі штангою']?.length===2);
ok('журнал тіла / сесії / їжа', B.bodyLog['2026-08-17']===61.4 && B.sessionLog['2026-08-17']?.done===5 && B.mealLog['2026-08-17']?.kcal===2100);
ok('періодизація: oneRM і stepPct', B.periodization?.oneRM?.['Присідання зі штангою']===120 && B.periodization?.stepPct===2.5);
ok('делоуд: percent', B.deload?.percent===15);
ok('Forge Rating', B.ratingLog['2026-08-17']?.rating===1500 && B.ratingSeen['train:2026-08-17']==='2026-08-17');
ok('трекер із джерелом', B.trackerLog.sleep['2026-08-17'].source==='apple_health');
ok('латки міграцій', B.weightsHarvested===true && B.weightLogSeeded===true);

async function imp(name, obj){ const f='/tmp/'+name; fs.writeFileSync(f,typeof obj==='string'?obj:JSON.stringify(obj));
  await p2.setInputFiles('#p-import-file',f); await p2.waitForTimeout(900);
  return p2.evaluate(async()=>await window.Store.getProfile()); }

const C=await imp('null.json',{weightLog:null,bodyLog:null,weight:70});
ok('null не обнуляє журнали', C.weightLog?.['Присідання зі штангою']?.length===2 && C.bodyLog?.['2026-08-17']===61.4);

const D=await imp('bad.json',{weightLog:{'Жим':[{d:'2026-08-01',kg:80},{d:'ПОГАНА',kg:9999},{d:'2026-08-10',kg:82.5}]}});
ok('битий рядок пропущено, решта збережена', D.weightLog['Жим']?.length===2, JSON.stringify(D.weightLog['Жим']));

const E=await imp('xss.json',{trackers:{'h" onfocus="alert(1)" autofocus x="':{type:'habit',name:'x',enabled:true}}});
ok('небезпечний ключ трекера відкинуто', !Object.keys(E.trackers||{}).some(k=>k.includes('"')), JSON.stringify(Object.keys(E.trackers||{})));

await imp('broken.txt','НЕ JSON {{{');
ok('битий JSON не ламає сторінку', errs.length===0, errs.join('|'));
const G=await imp('empty.json',{});
ok('порожній обʼєкт нічого не псує', G.weight!==undefined);
const H=await imp('extra.json',{weight:66, вигаданеПоле:{a:1}, __proto__:{polluted:true}});
ok('невідомі поля відкинуто, відоме взято', H.weight===66 && H['вигаданеПоле']===undefined);
ok('прототип не забруднено', ({}).polluted===undefined);

await b.close();
const bad=R.filter(r=>!r[1]);
console.log('\n'+(R.length-bad.length)+'/'+R.length+' перевірок імпорту пройшло.');
if(bad.length) console.log('ПРОВАЛЕНО: '+bad.map(x=>x[0]).join('; '));
process.exit(bad.length?1:0);
