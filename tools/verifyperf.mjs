/** Вага сторінок, час до інтерактивності, повільна мережа. */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { readdirSync, statSync } from 'node:fs';
const CHROME='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT='/root/work/forgesite';
const PAGES=readdirSync(ROOT).filter(f=>f.endsWith('.html')).sort();
const b=await chromium.launch({executablePath:CHROME});
const rows=[];
for(const f of PAGES){
  const ctx=await adultContext(b, {viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  let bytes=0, reqs=0;
  p.on('response', async r=>{ reqs++; try{const buf=await r.body(); bytes+=buf.length;}catch(_){} });
  const t0=Date.now();
  await p.goto('file://'+ROOT+'/'+f);
  await p.waitForLoadState('load');
  const loadMs=Date.now()-t0;
  await p.waitForTimeout(700);
  const m=await p.evaluate(()=>{
    const nav=performance.getEntriesByType('navigation')[0]||{};
    return {dcl:Math.round(nav.domContentLoadedEventEnd||0), nodes:document.querySelectorAll('*').length,
            scripts:document.querySelectorAll('script[src]').length};
  });
  rows.push({page:f, kb:Math.round(bytes/1024), reqs, loadMs, dcl:m.dcl, nodes:m.nodes, scripts:m.scripts});
  await ctx.close();
}
await b.close();
rows.sort((a,b)=>b.kb-a.kb);
console.log('сторінка'.padEnd(22), 'КБ'.padStart(6), 'запитів'.padStart(8), 'load мс'.padStart(8), 'DCL мс'.padStart(7), 'вузлів'.padStart(7), 'скриптів'.padStart(9));
for(const r of rows) console.log(r.page.padEnd(22), String(r.kb).padStart(6), String(r.reqs).padStart(8), String(r.loadMs).padStart(8), String(r.dcl).padStart(7), String(r.nodes).padStart(7), String(r.scripts).padStart(9));
const worst=rows[0], slowest=rows.slice().sort((a,b)=>b.loadMs-a.loadMs)[0], most=rows.slice().sort((a,b)=>b.nodes-a.nodes)[0];
console.log('\nнайважча:', worst.page, worst.kb+' КБ | найповільніша:', slowest.page, slowest.loadMs+' мс | найбільше вузлів:', most.page, most.nodes);
