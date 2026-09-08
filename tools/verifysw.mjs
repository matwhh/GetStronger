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

const cached = await p.evaluate(async () => {
  const ks = await caches.keys();
  if (!ks.length) return 0;
  const c = await caches.open(ks[0]);
  return (await c.keys()).length;
});
ok('у кеші є файли', cached > 0, String(cached));

/*
 * ОФЛАЙН ГЛУШИМО СЕРВЕРОМ, А НЕ setOffline (PWA-004).
 *
 * BrowserContext.setOffline() у Playwright не вимикає мережу для service
 * worker: він ходить у мережу зі свого контексту. Тому попередня версія
 * цієї перевірки насправді відкривала сторінку З МЕРЕЖІ — і worker, який
 * фізично не здатний працювати офлайн, проходив усі три перевірки.
 *
 * Зупинений сервер не бреше нікому: ні сторінці, ні worker-у.
 */
await new Promise((r) => { srv.closeAllConnections(); srv.close(r); });

let offlineOk = false, why = '';
try {
  await p.goto(base + 'index.html', { waitUntil: 'domcontentloaded' });
  const st = await p.evaluate(() => ({
    len: document.body ? document.body.innerText.length : 0,
    store: typeof window.Store !== 'undefined',
    title: document.title
  }));
  /* Довжина тексту сама по собі нічого не доводить: сторінка помилки теж
     непорожня. Потрібен саме застосунок — тобто window.Store. */
  offlineOk = st.len > 0 && st.store;
  why = JSON.stringify(st);
} catch (e) { why = e.message.slice(0, 80); }
ok('сторінка відкривається без мережі й Store на місці', offlineOk, why);

/* Незакешована адреса має давати чесну сторінку «немає звʼязку», а не
   мовчазну підміну на index.html під запитаною адресою (PWA-005). */
let offPage = '';
try {
  await p.goto(base + 'no-such-page.html', { waitUntil: 'domcontentloaded' });
  offPage = await p.evaluate(() => document.title + '|' + (document.body ? document.body.innerText.slice(0, 40) : ''));
} catch (e) { offPage = 'ERR ' + e.message.slice(0, 60); }
ok('незакешована адреса дає сторінку «немає звʼязку»', /звʼязку/i.test(offPage), offPage);

await b.close();
srv.close();
const bad = R.filter(x => !x).length;
console.log(bad ? bad + ' FAILURES' : 'ALL PASS');
process.exit(bad ? 1 : 0);
