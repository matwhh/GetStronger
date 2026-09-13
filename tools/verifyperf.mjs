/**
 * Вага сторінок, час до інтерактивності, кількість вузлів — З ПОРОГАМИ.
 *
 * TST-012: раніше цей скрипт лише друкував таблицю і завжди виходив з
 * кодом 0 — жодного ok(), жодного process.exit. При цьому він стояв у
 * наборі full і ci-browser.sh рахував його ПРОЙДЕНИМ. Тобто в CI був
 * зелений рядок, за яким не стояло жодного твердження: сторінка могла
 * вирости вдвічі, і ніхто б не дізнався.
 *
 * Пороги взяті з фактичних значень на день фіксу (найважча plan.html
 * 862 КБ, найповільніша 248 мс, найбільше вузлів programs.html 1118) з
 * запасом. Це не ідеал, до якого треба тягнутись, а стеля, за яку не можна
 * заповзти непомітно. Ростуть навмисно — піднімай числа тут і поясни чому.
 */
const LIMIT = {
  /* КБ рахуються слухачем 'response' і залежать від того, скільки тіл
     встигло дочитатись до кінця навігації, — між прогонами розкид
     помітний (862…1054 на тій самій збірці). Тому стеля з подвійним
     запасом: вона ловить подвоєння сторінки, а не шум. */
  kb: 1500,
  loadMs: 900,   // найповільніша, мс — file://, тож із великим запасом на CI
  nodes: 1600    // найбільше вузлів DOM (факт 2026-09-07: 1118)
};
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { CHROME, ROOT } from './pw.mjs';
const PAGES=readdirSync(ROOT).filter(f=>f.endsWith('.html')).sort();

/* СТОРІНКИ-ПЕРЕНАПРАВЛЕННЯ МІРЯЮТЬСЯ, АЛЕ НЕ СУДЯТЬСЯ.
   today.html і trackers-settings.html — це <meta http-equiv="refresh"> на
   інші сторінки (старі закладки, ярлик «На екран Home»). Браузер вантажить
   спершу їх, потім ціль, і слухач 'response' складає ОБИДВА документи в
   одне число. Тобто today.html «важить» index.html плюс себе — і саме він
   першим упирається в стелю, хоч людина цих байтів не платить: вона платить
   за ціль, яку вже зважено окремим рядком.
   Саме це й сталось 13.09: today.html 1606 КБ при стелі 1500, тоді як
   index.html — 1246. Ознака береться з розмітки, а не зі списку імен:
   зʼявиться ще одне перенаправлення — воно теж не зіпсує суд. */
const isRedirect=(f)=>/http-equiv=["']?refresh/i.test(readFileSync(ROOT+'/'+f,'utf8'));
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
  rows.push({page:f, kb:Math.round(bytes/1024), reqs, loadMs, dcl:m.dcl, nodes:m.nodes, scripts:m.scripts,
             redirect:isRedirect(f)});
  await ctx.close();
}
await b.close();
rows.sort((a,b)=>b.kb-a.kb);
console.log('сторінка'.padEnd(22), 'КБ'.padStart(6), 'запитів'.padStart(8), 'load мс'.padStart(8), 'DCL мс'.padStart(7), 'вузлів'.padStart(7), 'скриптів'.padStart(9));
for(const r of rows) console.log((r.redirect?'→ ':'  ')+r.page.padEnd(20), String(r.kb).padStart(6), String(r.reqs).padStart(8), String(r.loadMs).padStart(8), String(r.dcl).padStart(7), String(r.nodes).padStart(7), String(r.scripts).padStart(9));
const judged=rows.filter(r=>!r.redirect);
if(judged.length!==rows.length) console.log('\n→ — перенаправлення: їхнє число містить і сторінку-ціль, тож у стелі не судяться');
const worst=judged[0], slowest=judged.slice().sort((a,b)=>b.loadMs-a.loadMs)[0], most=judged.slice().sort((a,b)=>b.nodes-a.nodes)[0];
console.log('\nнайважча:', worst.page, worst.kb+' КБ | найповільніша:', slowest.page, slowest.loadMs+' мс | найбільше вузлів:', most.page, most.nodes);

const bad=[];
if(worst.kb    > LIMIT.kb)     bad.push(worst.page+' важить '+worst.kb+' КБ (стеля '+LIMIT.kb+')');
if(slowest.loadMs > LIMIT.loadMs) bad.push(slowest.page+' вантажиться '+slowest.loadMs+' мс (стеля '+LIMIT.loadMs+')');
if(most.nodes  > LIMIT.nodes)  bad.push(most.page+' має '+most.nodes+' вузлів (стеля '+LIMIT.nodes+')');
if(bad.length){ console.log('\nПЕРЕВИЩЕНО:'); bad.forEach(x=>console.log('  ✗ '+x)); }
else console.log('\nусі три стелі витримано');
process.exit(bad.length?1:0);
