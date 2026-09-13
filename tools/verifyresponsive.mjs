/** Overflow, обрізаний текст і замалі цілі на 7 ширинах × 16 сторінок. */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { readdirSync } from 'node:fs';
import { CHROME, ROOT } from './pw.mjs';
const PAGES=readdirSync(ROOT).filter(f=>f.endsWith('.html')).sort();
const VP=[{w:320,h:568,n:'320 (iPhone SE1)'},{w:375,h:667,n:'375'},{w:430,h:932,n:'430'},
          {w:768,h:1024,n:'768 планшет'},{w:1024,h:768,n:'1024 планшет ланд.'},
          {w:1280,h:800,n:'1280'},{w:1920,h:1080,n:'1920'}];
/*
 * Дати рекордів — відносні, не прибиті до місяця.
 *
 * «Особисті рекорди» рахуються за поточний сезон (StatWindow.clipSeries),
 * тож фіксована серпнева дата вилітала б із зрізу щоразу після 1 вересня —
 * блок ставав порожнім, і перевірка UX-010 мовчки нічого не перевіряла.
 */
function dayKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const SEED={birthDate: '1990-06-15', sex:'male',age:30,height:180,weight:82.4,bodyfat:18,activity:1.55,goal:'cut',meals:4,
  daysPerWeek:3,activePlan:{programId:'fullbody',days:3},trainingAge:'inter',hrRest:58,hrMax:190,
  weights:{'Жим у тренажері':60,'Присідання зі штангою':100},records:{squat:140},
  bodyLog:{'2026-08-14':83.1,'2026-08-16':82.7,'2026-08-17':82.4},workLog:{'2026-08-17':1},
  /* Назва одним словом без пробілів і дефісів, 60 символів (UX-010). Гнучкий рядок
     .wlog-row за замовчуванням не звужується менше за вміст, тож така
     назва розпирала «Особисті рекорди» і давала горизонтальну прокрутку
     ВСІЄЇ journal.html на 375px. Заголовки від цього захищені
     (overflow-wrap: break-word), а цей рядок не був. */
  weightLog:{'ЖимлежачивузькимхватомусмітінапохилійлавіпідкутомпятнадцятьГ':[
    {d:dayKey(-3),kg:60},{d:dayKey(0),kg:65}]},
  ratingLog:{'2026-08-18':{rating:3120,delta:25,quality:0.7,reasons:[]}},ratingAlgorithmVersion:1};
const b=await chromium.launch({executablePath:CHROME});
let fails=0, checks=0;
for(const vp of VP){
  const ctx=await adultContext(b, {viewport:{width:vp.w,height:vp.h}});
  const p=await ctx.newPage();
  await p.goto('file://'+ROOT+'/index.html');
  await p.evaluate(async s=>{await window.Store.saveProfile(s);},SEED);
  const bad=[];
  for(const f of PAGES){
    await p.goto('file://'+ROOT+'/'+f); await p.waitForTimeout(420);
    checks++;
    await p.evaluate(t=>{window.__touch=t;}, vp.w<=430);
    const r=await p.evaluate(()=>{
      const de=document.documentElement, vw=de.clientWidth;
      const out={overflow:de.scrollWidth>vw+2 ? de.scrollWidth : 0, escapes:[], tiny:[], clipped:[]};
      document.querySelectorAll('body *').forEach(el=>{
        const cs=getComputedStyle(el);
        if(cs.display==='none'||cs.visibility==='hidden'||!el.offsetParent&&cs.position!=='fixed') return;
        const b=el.getBoundingClientRect();
        if(b.width<1||b.height<1) return;
        // елемент вилазить за екран, і жоден предок не має overflow:auto/scroll
        if(b.right>vw+2){
          let sc=false, par=el.parentElement;
          while(par){const o=getComputedStyle(par).overflowX; if(o==='auto'||o==='scroll'||o==='hidden'){sc=true;break;} par=par.parentElement;}
          if(!sc) out.escapes.push(el.tagName+'.'+String(el.className||'').slice(0,32)+' →'+Math.round(b.right));
        }
        // обрізаний текст: контент ширший за бокс, без переносу і без скролу
        // .sr-only навмисно 1×1 з overflow:hidden — це не обрізаний текст, а текст для читачів екрана
        if(el.children.length===0 && el.scrollWidth>el.clientWidth+2 && cs.overflowX==='hidden' && !el.classList.contains('sr-only'))
          out.clipped.push(el.tagName+'.'+String(el.className||'').slice(0,28));
        /* Цілі дотику — лише на сенсорних ширинах і лише для СПРАВЖНІХ
           цілей. Не рахуємо: приховані чекбокси (їх ціль — label),
           текстові посилання всередині абзацу (виняток WCAG 2.5.8) і
           елементи з розширеною зоною через ::after (.icon-btn). */
        const tag=el.tagName;
        const inlineLink = tag==='A' && el.parentElement &&
          /^(P|LI|SPAN|TD|DIV)$/.test(el.parentElement.tagName) &&
          (el.parentElement.textContent||'').trim().length > (el.textContent||'').trim().length + 8;
        const hiddenInput = tag==='INPUT' && (b.width<=2||b.height<=2);
        /* Чекбокс/радіо всередині <label>: клік по всьому підпису перемикає
           його, тож справжня ціль — бокс label, а не сам квадратик. */
        const lb = tag==='INPUT' ? el.closest('label') : null;
        const labelTarget = !!lb && (function(){const lr=lb.getBoundingClientRect();return lr.height>=32&&lr.width>=32;})();
        const extended = el.classList.contains('icon-btn');
        if(window.__touch && !inlineLink && !hiddenInput && !labelTarget && !extended
           && (tag==='BUTTON'||(tag==='A'&&el.getAttribute('href'))||tag==='INPUT'||tag==='SELECT')
           && cs.pointerEvents!=='none' && (b.height<32||b.width<32))
          out.tiny.push(tag+'.'+String(el.className||'').slice(0,26)+' '+Math.round(b.width)+'×'+Math.round(b.height));
      });
      return out;
    });
    const msgs=[];
    if(r.overflow) msgs.push('OVERFLOW '+r.overflow+'>'+vp.w);
    if(r.escapes.length) msgs.push('вилазять: '+r.escapes.slice(0,3).join(', '));
    if(r.clipped.length) msgs.push('обрізано: '+r.clipped.slice(0,3).join(', '));
    if(r.tiny.length) msgs.push('дрібні цілі: '+[...new Set(r.tiny)].slice(0,3).join(', '));
    if(msgs.length){ bad.push('  '+f+' :: '+msgs.join(' | ')); fails++; }
  }
  console.log('['+vp.n+'] '+(bad.length?'ПРОБЛЕМИ:':'чисто'));
  bad.forEach(x=>console.log(x));
  await ctx.close();
}
await b.close();
console.log('\nперевірок: '+checks+', зі знахідками: '+fails);
process.exit(fails?1:0);
