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
/*
 * Шлях до браузера — звідти ж, звідки й решта перевірок (аудит 13.09.2026).
 * Цей файл був єдиним, хто кликав chromium.launch() без executablePath —
 * тобто рівно з тією проблемою, заради якої tools/pw.mjs і зроблено: на
 * машині без завантаженого Playwright-браузера набір падав до першого
 * рядка, і перевірка офлайн-оболонки не запускалась ніде, крім CI.
 */
import { CHROME } from './pw.mjs';

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon',
  '.json':'application/json', '.webmanifest':'application/manifest+json' };

const ROOT = process.cwd();

/*
 * МІТКА ПУБЛІКАЦІЇ (PWA-014).
 *
 * Сервер підмішує в початок js/app.js рядок window.__SWVER. Міняючи
 * цю змінну, ми імітуємо публікацію, яка НЕ чіпає розмітку — рівно той
 * випадок, у якому worker раніше віддавав людині попередню версію коду.
 * Розмітка при цьому лишається байт у байт тією самою, тому захист «HTML
 * змінився — знести кеш» не спрацьовує, і перевіряється саме поведінка
 * для css/js.
 */
let swver = 'A';
const srv = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, p === '/' ? 'index.html' : p);
  try {
    let body = await readFile(file);
    if (p === '/js/app.js') body = Buffer.from("window.__SWVER='" + swver + "';\n" + body.toString('utf8'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('no'); }
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port + '/';

const R = [];
const ok = (n, c, x) => { R.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });
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
 * ПУБЛІКАЦІЯ БЕЗ ЗМІНИ РОЗМІТКИ ДОЇЖДЖАЄ З ПЕРШОГО ВІДКРИТТЯ (PWA-014).
 *
 * Найчастіша публікація в цьому проєкті чіпає лише css/js. Поки код
 * віддавався за stale-while-revalidate, перше відкриття після неї
 * виконувало ПОПЕРЕДНЮ версію, а свіжа тихо лягала в кеш «на потім» —
 * тобто людина завжди була на одну публікацію позаду, а після двох
 * підряд на дві. Захист «розмітка змінилась — знести кеш» тут не
 * рятував: розмітка не змінювалась.
 *
 * Замір бере window.__SWVER, тобто те, що сторінка СПРАВДІ виконала.
 * Читати файл через fetch не можна: фонове оновлення встигає покласти
 * свіжий файл у кеш, і замір показав би свіжу версію при старій
 * виконаній — рівно та помилка, через яку баг довго був невидимим.
 */
/*
 * ЧОТИРИ ВІДКРИТТЯ ПЕРЕД «ПУБЛІКАЦІЄЮ», І ЦЕ ВИМІРЯНЕ ЧИСЛО.
 *
 * Перші відкриття worker ще встановлюється й переустановлюється, і
 * частина запитів іде повз нього — на старому коді баг там просто не
 * відтворювався (перевірено: при двох і трьох відкриттях старий worker
 * теж віддавав свіжий файл, при чотирьох — уже застарілий). Менша
 * кількість дала б перевірку, яка проходить завжди й не ловить нічого.
 */
for (let i = 0; i < 4; i++) {
  await p.goto(base + 'index.html', { waitUntil: 'load' });
  await p.waitForTimeout(900);
}
const before = await p.evaluate(() => window.__SWVER || '(немає)');
const cachedVer = await p.evaluate(async () => {
  const c = await caches.open('forge-v1');
  const hit = await c.match(location.origin + '/js/app.js');
  return hit ? (await hit.text()).slice(0, 22) : '(порожньо)';
});
ok('до публікації сторінка виконує версію A', before === 'A', before + ' / кеш: ' + cachedVer);

swver = 'B';   /* «публікація»: змінився лише js, розмітка та сама */
await p.goto(base + 'index.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);
const after = await p.evaluate(() => window.__SWVER || '(немає)');
ok('перше відкриття після публікації дає нову версію', after === 'B', after);

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
