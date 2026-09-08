/**
 * Service worker: правила кешування.
 *
 * ЧОМУ НЕ БРАУЗЕРНА ПЕРЕВІРКА. Усі перевірки в tools/ ходять по file://, а
 * service worker на file:// не реєструється взагалі. Тому sw.js виконується
 * тут у підробленому глобальному оточенні: свій caches, свій fetch, свої
 * події. Перевіряються саме правила, а не браузер.
 *
 * Закриває HIGH з аудиту 2026-09:
 *   PWA-001 — у кеш клалась будь-яка відповідь, і 500 підміняла справну
 *             сторінку, ставши офлайн-запасним варіантом;
 *   PWA-002 — навігація чекала мережу без обмеження часу: при «lie-fi»
 *             сторінки не було взагалі, хоча в кеші лежала робоча копія;
 *   PWA-003 — HTML брався з мережі, а скрипти з кешу, тож перше відкриття
 *             після кожної публікації виконувало нову розмітку старим JS;
 *   PWA-013 — в оболонці лежало 6 файлів із 25, і офлайн одразу після
 *             встановлення давав екран без window.Store.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

/* --- мінімальні підробки браузерних API ------------------------------- */

class FakeResponse {
  constructor(body, init) {
    this.body = body;
    this.status = (init && init.status) || 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.used = false;
  }
  clone() { return new FakeResponse(this.body, { status: this.status }); }
  async text() { return this.body; }
}

class FakeCache {
  constructor() { this.map = new Map(); }
  async match(req) { return this.map.get(key(req)) || undefined; }
  async put(req, res) { this.map.set(key(req), res); }
  async add(u) {
    const res = await this.ctx.fetch(u);
    if (!res || !res.ok) throw new Error('add failed ' + u);
    this.map.set(key(u), res);
  }
}
/*
 * Ключ такий самий, як у справжнього Cache API: відносна адреса
 * розвʼязується відносно кореня, повна лишається як є. Без цього
 * './index.html' з оболонки й 'https://forge.test/index.html' із
 * навігації були б РІЗНИМИ записами тільки в підробці — і перевірка
 * нормалізації ключа (PWA-008) нічого б не доводила.
 */
const key = (r) => new URL(typeof r === 'string' ? r : r.url, 'https://forge.test/').toString();

function makeEnv(fetchImpl) {
  const caches = {
    store: new Map(),
    async open(name) {
      if (!this.store.has(name)) { const c = new FakeCache(); c.ctx = env; this.store.set(name, c); }
      return this.store.get(name);
    },
    async keys() { return [...this.store.keys()]; },
    async delete(name) { return this.store.delete(name); },
    async match(req) {
      for (const c of this.store.values()) {
        const hit = await c.match(req);
        if (hit) return hit;
      }
      return undefined;
    }
  };
  const handlers = {};
  const warnings = [];
  const env = {
    caches,
    fetch: fetchImpl,
    URL, setTimeout, clearTimeout, Promise,
    /* Перехоплений console: PWA-011 перевіряє, що помилки кеша не
       ковтаються мовчки, а лишають слід. */
    console: { warn: function () { warnings.push([].slice.call(arguments).join(' ')); },
               log: function () {}, error: function () {} },
    self: {
      location: { origin: 'https://forge.test' },
      addEventListener: (t, fn) => { handlers[t] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    },
    handlers,
    warnings
  };
  env.self.caches = caches;
  vm.createContext(env);
  vm.runInContext(SRC, env);
  return env;
}

/** Прогнати обробник fetch і дочекатись відповіді. */
async function navigate(env, url) {
  let out;
  const e = {
    request: { url: url, method: 'GET', mode: 'navigate', headers: { get: () => 'text/html' } },
    respondWith: (p) => { out = p; },
    waitUntil: () => {}
  };
  env.handlers.fetch(e);
  return out;
}
async function asset(env, url) {
  let out;
  const e = {
    request: { url: url, method: 'GET', mode: 'no-cors', headers: { get: () => '' } },
    respondWith: (p) => { out = p; },
    waitUntil: () => {}
  };
  env.handlers.fetch(e);
  return out;
}
async function install(env) {
  let p;
  env.handlers.install({ waitUntil: (x) => { p = x; } });
  await p;
}

const HTML = 'https://forge.test/index.html';

describe('Service worker: HTML', () => {
  test('помилка сервера не потрапляє в кеш і не підміняє справну сторінку', async () => {
    /* PWA-001: раніше в кеш клалась будь-яка відповідь, і після одного
       500 офлайн віддавав саме її. */
    let mode = 'ok';
    const env = makeEnv(async () => (mode === 'ok'
      ? new FakeResponse('<html>справжня</html>')
      : new FakeResponse('Internal Server Error', { status: 500 })));

    await navigate(env, HTML);
    mode = 'boom';
    const bad = await navigate(env, HTML);
    assert.equal(bad.status, 500, 'помилку віддаємо як є');

    const cached = await env.caches.match(HTML);
    assert.equal(await cached.text(), '<html>справжня</html>');
  });

  test('мережа мовчить — сторінка приходить із кешу, а не зависає', async () => {
    /* PWA-002: fetch не відхиляється, обіцянка не виконується ніколи. */
    let hang = false;
    const env = makeEnv(() => (hang
      ? new Promise(() => {})
      : Promise.resolve(new FakeResponse('<html>кеш</html>'))));

    await navigate(env, HTML);
    hang = true;
    const t0 = Date.now();
    const res = await navigate(env, HTML);
    assert.equal(await res.text(), '<html>кеш</html>');
    assert.ok(Date.now() - t0 < 10000, 'віддано за розумний час');
  });

  test('нова розмітка скидає кеш, щоб скрипти приїхали з тієї ж публікації', async () => {
    /* PWA-003: HTML свіжий, JS старий — перше відкриття після кожного
       деплою виконувало нову розмітку старими скриптами. */
    let html = '<html>v1</html>';
    const env = makeEnv(async (r) => new FakeResponse(
      key(r).endsWith('.js') ? 'js v1' : html));

    await navigate(env, HTML);
    await asset(env, 'https://forge.test/js/store.js');
    assert.ok(await env.caches.match('https://forge.test/js/store.js'), 'скрипт закешовано');

    html = '<html>v2</html>';
    await navigate(env, HTML);
    assert.equal(await env.caches.match('https://forge.test/js/store.js'), undefined,
      'старий скрипт прибрано разом зі зміною розмітки');
    assert.equal(await (await env.caches.match(HTML)).text(), '<html>v2</html>');
  });

  test('незмінна розмітка кеш не скидає', async () => {
    const env = makeEnv(async (r) => new FakeResponse(
      key(r).endsWith('.js') ? 'js' : '<html>same</html>'));
    await navigate(env, HTML);
    await asset(env, 'https://forge.test/js/store.js');
    await navigate(env, HTML);
    assert.ok(await env.caches.match('https://forge.test/js/store.js'),
      'скрипт лишився — публікація та сама');
  });
});

describe('Service worker: оболонка', () => {
  test('один недоступний файл не лишає кеш порожнім', async () => {
    /* addAll — усе або нічого: 404 в одному файлі вимикав офлайн цілком. */
    const env = makeEnv(async (u) => (String(u).indexOf('favicon') !== -1
      ? new FakeResponse('nope', { status: 404 })
      : new FakeResponse('ok')));
    await install(env);
    const c = await env.caches.open('forge-v1');
    assert.ok(c.map.size > 20, 'оболонка закешована попри один 404: ' + c.map.size);
  });

  test('оболонка містить Store і ядро «Сьогодні»', async () => {
    /* PWA-013: без цих файлів офлайн одразу після встановлення давав
       шапку й заголовок без застосунку під ними. */
    for (const need of ['./js/store.js', './js/today.js', './js/config.js',
                        './js/workout-core.js', './js/day-core.js']) {
      assert.ok(SRC.includes("'" + need + "'"), 'у SHELL немає ' + need);
    }
  });
});

describe('Service worker: аварійний вимикач і офлайн-сторінка', () => {
  test('js/nosw.js ніколи не перехоплюється', () => {
    /* PWA-006: вимикач лежав у js/app.js — тобто у файлі, який роздає
       той самий worker зі свого кешу. Ламався worker або кешована копія
       app.js — і єдиний засіб порятунку не виконувався. */
    assert.ok(SRC.includes('nosw'), 'sw.js має знати про вимикач');
    assert.ok(SRC.indexOf('nosw.js') > 0, 'у sw.js немає винятку для js/nosw.js');
    assert.ok(SRC.indexOf("'./js/nosw.js'") < 0, 'вимикач не має лежати в SHELL');
  });

  test('offline.html — частина оболонки', () => {
    /* PWA-005: без неї запасним варіантом лишався index.html під чужою
       адресою — екран «Сьогодні» замість запитаної сторінки. */
    assert.ok(SRC.includes("'./offline.html'"), 'offline.html немає в SHELL');
    assert.ok(SRC.includes("caches.match('./offline.html')"), 'offline.html не віддається');
  });
});

describe('Service worker: межі кеша й видимість помилок', () => {
  test('вісім переходів із різними ?utm_source дають ОДИН запис у кеші', async () => {
    /*
     * PWA-008. Ключем Cache API є повний URL, тож кожна мітка кампанії
     * створювала окремий вічний запис. Стелі немає: ні за кількістю, ні
     * за розміром, ні за віком; activate зносить лише кеші з іншим
     * імʼям, а імʼя не змінюється. Достатньо було розсилки з utm — і кеш
     * ріс, аж поки браузер не викидав його разом з офлайн-роботою.
     */
    const env = makeEnv(async () => new FakeResponse('<html>сторінка</html>'));
    for (let i = 0; i < 8; i++) await navigate(env, HTML + '?utm_source=' + i);
    const c = await env.caches.open('forge-v1');
    const docs = [...c.map.keys()].filter((k) => k.indexOf('index.html') !== -1);
    assert.deepEqual(docs, ['https://forge.test/index.html'],
      'у кеші має бути один документ без query, а не ' + docs.length);
  });

  test('запит із query віддається з кеша, покладеного без query', async () => {
    /* Нормалізація має працювати в обидва боки: інакше офлайн-перехід за
       посиланням з міткою кампанії лишався б без відповіді. */
    let online = true;
    const env = makeEnv(async () => {
      if (!online) throw new Error('offline');
      return new FakeResponse('<html>сторінка</html>');
    });
    await navigate(env, HTML);
    online = false;
    const res = await navigate(env, HTML + '?fbclid=zzz');
    assert.equal(await res.text(), '<html>сторінка</html>');
  });

  test('нова публікація прибирає з кеша розмітку ІНШИХ сторінок', async () => {
    /*
     * PWA-009, дзеркальний до PWA-003. Скрипти оновлюються самі
     * (stale-while-revalidate) під час будь-якого онлайн-відвідування, а
     * HTML інших сторінок лишався б у кеші з попередньої публікації —
     * і офлайн людина діставала стару розмітку з новими скриптами.
     * Розбіжність розмітки означає нову публікацію, тому кеш зноситься
     * цілком: лишається рівно один узгоджений стан.
     */
    let html = '<html>стара</html>';
    const env = makeEnv(async (u) => new FakeResponse(
      String((u && u.url) || u).indexOf('.html') !== -1 ? html : 'asset'));

    await navigate(env, 'https://forge.test/rating.html');
    await navigate(env, HTML);
    await asset(env, 'https://forge.test/js/app.js');
    let c = await env.caches.open('forge-v1');
    assert.ok(c.map.has('https://forge.test/rating.html'), 'rating.html мала лягти в кеш');

    html = '<html>нова</html>';                    // публікація
    await navigate(env, HTML);

    c = await env.caches.open('forge-v1');
    assert.ok(!c.map.has('https://forge.test/rating.html'),
      'стара розмітка rating.html лишилась у кеші після публікації');
    assert.equal(await (await c.match(HTML)).text(), '<html>нова</html>');
  });

  test('провал передкешу лишає слід у консолі, а не тишу', async () => {
    /* PWA-011: усі catch у sw.js були порожні, тож жодна помилка кеша не
       бачилась ніде — ні в консолі, ні в Sentry (у worker немає
       window.onerror, на який підписаний js/errors.js). */
    const env = makeEnv(async (u) => (String(u).indexOf('favicon') !== -1
      ? new FakeResponse('nope', { status: 404 })
      : new FakeResponse('ok')));
    await install(env);
    assert.ok(env.warnings.some((w) => w.indexOf('передкеш') !== -1 && w.indexOf('favicon') !== -1),
      'провал передкешу не потрапив у console.warn: ' + JSON.stringify(env.warnings));
  });
});
