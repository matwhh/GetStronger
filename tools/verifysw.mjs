/**
 * Перевірка service worker: чи справді сайт відкривається без мережі.
 * Запуск: node tools/verifysw.mjs
 *
 * Потрібен HTTP: по file:// service worker не реєструється взагалі.
 * Піднімаємо локальний сервер із теки проєкту.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon',
  '.json':'application/json', '.webmanifest':'application/manifest+json' };

const ROOT = process.cwd();
const srv = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, p === '/' ? 'index.html' : p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('no'); }
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port + '/';

const R = [];
const ok = (n, c, x) => { R.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch();
const ctx = await b.newContext();
/* Зовнішні походження блокуємо: шрифти й Supabase до перевірки не належать. */
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
const p = await ctx.newPage();

await p.goto(base + 'index.html', { waitUntil: 'load' });
await p.waitForTimeout(1500);
const reg = await p.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return !!(r && (r.active || r.installing || r.waiting));
});
ok('service worker зареєструвався', reg);

await p.evaluate(() => navigator.serviceWorker.ready);
await p.goto(base + 'journal.html', { waitUntil: 'load' });
await p.waitForTimeout(800);

/* Тепер вимикаємо мережу зовсім і пробуємо відкритись. */
await ctx.setOffline(true);
let offlineOk = false, text = '';
try {
  await p.goto(base + 'index.html', { waitUntil: 'domcontentloaded' });
  text = await p.evaluate(() => document.body ? document.body.innerText.length : 0);
  offlineOk = Number(text) > 0;
} catch (e) { text = e.message.slice(0, 60); }
ok('сторінка відкривається без мережі', offlineOk, String(text));

const cached = await p.evaluate(async () => {
  const ks = await caches.keys();
  if (!ks.length) return 0;
  const c = await caches.open(ks[0]);
  return (await c.keys()).length;
});
ok('у кеші є файли', cached > 0, String(cached));

await ctx.setOffline(false);
await b.close();
srv.close();
const bad = R.filter(x => !x).length;
console.log(bad ? bad + ' FAILURES' : 'ALL PASS');
process.exit(bad ? 1 : 0);
