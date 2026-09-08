/* TEMPORARY AUDIT HARNESS — read-only discovery; touches no app code. */
import { chromium } from 'playwright';
import { adultContext } from '../adult.mjs';
import { readdirSync, writeFileSync } from 'node:fs';
const ROOT = process.cwd();
const PAGES = readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await adultContext(b, { viewport: { width: 1200, height: 900 } });
const out = {};
for (const pg of PAGES) {
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + ROOT + '/' + pg, { waitUntil: 'load' }).catch(e => errs.push('nav:' + e.message));
  await p.waitForTimeout(1200);
  const info = await p.evaluate(() => {
    const q = s => [...document.querySelectorAll(s)];
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const lab = e => (e.getAttribute('aria-label') || e.textContent || e.placeholder || e.id || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return {
      title: document.title,
      url: location.pathname.split('/').pop(),
      h1: q('h1').map(e => e.textContent.trim()),
      h2: q('main h2').map(e => e.textContent.trim()).slice(0, 40),
      links: [...new Set(q('main a[href]').map(a => a.getAttribute('href')).filter(h => /\.html/.test(h)))],
      navLinks: [...new Set(q('header a[href], nav a[href], footer a[href]').map(a => a.getAttribute('href')))],
      buttons: q('main button').filter(vis).map(e => ({ t: lab(e), id: e.id, data: Object.keys(e.dataset).join(',') })).slice(0, 80),
      inputs: q('main input, main select, main textarea').map(e => ({ tag: e.tagName, type: e.type, id: e.id, name: e.name, data: Object.keys(e.dataset).join(','), im: e.inputMode })).slice(0, 80),
      dialogs: q('dialog, [role=dialog], .modal').length,
      forms: q('form').length,
      dataAttrs: [...new Set(q('main [data-act], main [data-set-n], main [data-wt], main [data-trk-add], main [data-hm-day], main [data-day]').map(e => Object.keys(e.dataset)[0]))],
      scripts: q('script[src]').map(s => s.getAttribute('src')),
      domNodes: document.querySelectorAll('*').length
    };
  });
  info.errors = errs;
  out[pg] = info;
  await p.close();
}
await b.close();
writeFileSync('tools/sim90/discovery.json', JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(24), 'h1=' + v.h1.join('|').slice(0, 30).padEnd(32), 'btn=' + String(v.buttons.length).padStart(3), 'inp=' + String(v.inputs.length).padStart(3), 'forms=' + v.forms, 'links=' + v.links.length, v.errors.length ? 'ERR:' + v.errors.join('|') : '');
