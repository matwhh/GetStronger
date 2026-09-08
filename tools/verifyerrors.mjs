/**
 * Перевірка js/errors.js — репорту помилок у Sentry.
 * Запуск: node tools/verifyerrors.mjs
 *
 * Головне, що тут перевіряється, — не «чи долетіло», а ЩО САМЕ летить:
 * у звіті не має бути ні пошти, ні токенів із хеша адреси, ні даних
 * профілю. Тому запити на ingest перехоплюються, а їхнє тіло читається.
 *
 * Сайт віддається під вигаданим доменом forge.test, а не 127.0.0.1:
 * на локальних адресах модуль свідомо мовчить, і на localhost перевірити
 * бойову поведінку неможливо.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { CHROME } from './pw.mjs';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json'
};
const ROOT = process.cwd();

const R = [];
const ok = (n, c, x) => { R.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

/* Той самий Chromium, що й у решті перевірок (tools/pw.mjs): у CI
   завантаженого браузера за замовчуванням може не бути. */
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext();

/* Порядок реєстрації важливий: у Playwright пізніший маршрут головніший.
   Спершу глушимо все зовнішнє, далі — винятки з цього правила. */
await ctx.route(/^https?:\/\//, (r) => r.abort());

/* Сайт із диска під доменом forge.test. */
await ctx.route('https://forge.test/**', async (route) => {
  const url = new URL(route.request().url());
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, rel === '/' ? 'index.html' : rel));
    await route.fulfill({ status: 200, contentType: TYPES[extname(rel)] || 'application/octet-stream', body });
  } catch { await route.fulfill({ status: 404, body: 'no' }); }
});

/* Перехоплюємо ingest: назовні нічого не йде, тіло лишається в тесті.
   Саме regex, а не glob: у DSN хост має вигляд o123.ingest.de.sentry.io,
   і шаблон '**​/ingest.de.sentry.io/**' його не ловить — перед піддоменом
   стоїть крапка, а не коса. */
const envelopes = [];
await ctx.route(/ingest\.[a-z]+\.sentry\.io/, async (route) => {
  envelopes.push({ url: route.request().url(), body: route.request().postData() || '' });
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"test"}' });
});

const p = await ctx.newPage();

/* ---- 1. Бойовий домен: модуль увімкнений ---------------------------- */
//
// У хеші — те, що приносить Supabase після листа відновлення пароля.
// Саме воно не має опинитись у звіті.
await p.goto('https://forge.test/index.html#access_token=SEKRET-TOKEN-123&type=recovery', { waitUntil: 'load' });
await p.waitForTimeout(400);

ok('модуль увімкнений на бойовому домені', await p.evaluate(() => window.ForgeErrors?.enabled === true));

await p.evaluate(() => { setTimeout(() => { throw new TypeError('форджева тестова помилка'); }, 0); });
await p.waitForTimeout(600);

ok('необроблений виняток відправлено', envelopes.length === 1, 'конвертів: ' + envelopes.length);

const parts = (envelopes[0]?.body || '').split('\n');
let head = {}, item = {}, ev = {};
try { head = JSON.parse(parts[0]); item = JSON.parse(parts[1]); ev = JSON.parse(parts[2]); } catch { /* нижче впаде */ }

ok('конверт із трьох рядків', parts.length === 3, 'рядків: ' + parts.length);
ok('event_id збігається в заголовку й події', Boolean(head.event_id) && head.event_id === ev.event_id);
ok('тип елемента — event', item.type === 'event');
ok('ключ у query, а не в тілі', (envelopes[0]?.url || '').includes('sentry_key='));

const val = ev.exception?.values?.[0] || {};
ok('тип помилки збережено', val.type === 'TypeError', val.type);
ok('текст помилки збережено', String(val.value).includes('форджева тестова помилка'), val.value);
ok('стек розібрано на кадри', Array.isArray(val.stacktrace?.frames) && val.stacktrace.frames.length > 0,
   'кадрів: ' + (val.stacktrace?.frames?.length ?? 0));

/* ---- 2. Найважливіше: чого у звіті бути НЕ МАЄ --------------------- */
const raw = envelopes[0]?.body || '';
ok('токена з хеша адреси немає у звіті', !raw.includes('SEKRET-TOKEN-123'));
ok('хеша немає в url звіту', !String(ev.request?.url || '').includes('#'));
ok('query немає в url звіту', !String(ev.request?.url || '').includes('?'));
ok('немає ідентифікатора користувача', ev.user === undefined);
ok('немає пошти в тілі', !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(raw.replace(/"[^"]*ingest[^"]*"/g, '')));

/* ---- 3. Стеля й дедуплікація ---------------------------------------- */
envelopes.length = 0;
await p.evaluate(() => {
  for (let i = 0; i < 30; i++) setTimeout(() => { throw new Error('та сама помилка'); }, 0);
});
await p.waitForTimeout(700);
ok('однакові помилки не дублюються', envelopes.length === 1, 'конвертів: ' + envelopes.length);

/* Перезавантаження скидає лічильник — інакше стелю зʼїли попередні кроки
   і перевірка міряла б не те. */
await p.goto('https://forge.test/index.html', { waitUntil: 'load' });
await p.waitForTimeout(300);
envelopes.length = 0;
await p.evaluate(() => {
  for (let i = 0; i < 30; i++) setTimeout(() => { throw new Error('унікальна ' + i); }, 0);
});
await p.waitForTimeout(900);
ok('стеля подій на сторінку тримається', envelopes.length === 8, 'конвертів: ' + envelopes.length);

/* ---- 4. Шум не летить ------------------------------------------------ */
envelopes.length = 0;
await p.evaluate(() => { setTimeout(() => { throw new Error('ResizeObserver loop limit exceeded'); }, 0); });
await p.waitForTimeout(500);
ok('шум ResizeObserver відсіяно', envelopes.length === 0, 'конвертів: ' + envelopes.length);

/* ---- 5. Відхилені проміси ------------------------------------------- */
await p.goto('https://forge.test/index.html', { waitUntil: 'load' });
await p.waitForTimeout(300);
envelopes.length = 0;
await p.evaluate(() => { Promise.reject(new RangeError('обіцянка не збулась')); });
await p.waitForTimeout(500);
const rej = envelopes[0] ? JSON.parse(envelopes[0].body.split('\n')[2]) : {};
ok('відхилений проміс відправлено', envelopes.length === 1, 'конвертів: ' + envelopes.length);
ok('тип відхилення збережено', rej.exception?.values?.[0]?.type === 'RangeError',
   rej.exception?.values?.[0]?.type);

/* ---- 6. Локальна розробка мовчить ------------------------------------ */
const p2 = await ctx.newPage();
await p2.route('http://localhost/**', async (route) => {
  const rel = normalize(decodeURIComponent(new URL(route.request().url()).pathname));
  try {
    const body = await readFile(join(ROOT, rel === '/' ? 'index.html' : rel));
    await route.fulfill({ status: 200, contentType: TYPES[extname(rel)] || 'application/octet-stream', body });
  } catch { await route.fulfill({ status: 404, body: 'no' }); }
});
envelopes.length = 0;
await p2.goto('http://localhost/index.html', { waitUntil: 'load' });
await p2.waitForTimeout(300);
ok('на localhost модуль вимкнений', await p2.evaluate(() => window.ForgeErrors?.enabled === false));
await p2.evaluate(() => { setTimeout(() => { throw new Error('локальна помилка'); }, 0); });
await p2.waitForTimeout(500);
ok('з localhost назовні нічого не летить', envelopes.length === 0, 'конвертів: ' + envelopes.length);

await b.close();

const pass = R.filter(Boolean).length;
console.log(`\n${pass}/${R.length}`);
process.exit(pass === R.length ? 0 : 1);
