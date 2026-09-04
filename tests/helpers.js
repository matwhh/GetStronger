/**
 * Завантаження модулів сайту в тест.
 *
 * Файли проєкту — не ES-модулі: вони кладуть свій API у window.*, бо сайт
 * має відкриватись подвійним кліком, без збірки. Ламати це заради тестів
 * неправильно, тому тести підлаштовуються під код, а не навпаки: виконуємо
 * файл у пісочниці з підробленим window і забираємо, що він туди поклав.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string[]} files шляхи від кореня проєкту, у порядку залежностей
 * @returns {object} вміст window після виконання
 */
export function loadModules(files) {
  const sandbox = { window: {}, console, Math, Date, JSON, Number, String, Array, Object };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.window;
}

export const loadOneRM     = () => loadModules(['js/onerm-core.js']).OneRM;
export const loadNutrition = () => loadModules(['js/nutrition-core.js']).NutritionCalc;
export const loadExercises = () => loadModules(['js/exercises.js']);
export const loadFoods     = () => loadModules(['js/foods.js']);
export function loadPeriodization() {
  const w = loadModules(['js/onerm-core.js', 'js/exercises.js', 'js/periodization-core.js']);
  return w.Periodization;
}

/* ==========================================================================
   Пісочниця для js/store.js
   ==========================================================================
   Store — найризикованіший файл проєкту (злиття локального й хмарного
   профілю, черга, гонки) і до цього моменту не мав жодного тесту. Він не
   чиста функція: читає localStorage, ходить у мережу, слухає події. Тому
   тут — мінімальні підробки саме цих трьох речей, без jsdom.
   ========================================================================== */

/** localStorage з керованою квотою: setQuota(n) робить сховище «повним». */
export function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  let quota = Infinity;
  const api = {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      const size = [...map.entries()].reduce((a, [kk, vv]) => a + kk.length + String(vv).length, 0);
      if (size + k.length + String(v).length > quota) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    get length() { return map.size; },
    key(i) { return [...map.keys()][i]; }
  };
  api.setQuota = (n) => { quota = n; };
  api.dump = () => Object.fromEntries(map);
  api.has = (k) => map.has(k);
  return api;
}

/**
 * Керована мережа. routes — масив { test(url, opts), reply() }.
 * reply() повертає { status, body } або кидає (мережевий збій).
 */
export function makeNet() {
  const calls = [];
  const routes = [];
  /* store.js серіалізує тіло сам, тож у fetch воно приходить рядком. */
  const parseBody = (opts) => {
    if (!opts || opts.body === undefined) return undefined;
    if (typeof opts.body !== 'string') return opts.body;
    try { return JSON.parse(opts.body); } catch (_) { return opts.body; }
  };
  const fetchImpl = async function (url, opts) {
    calls.push({ url, opts });
    for (const r of routes) {
      if (r.test(url, opts || {})) {
        const o2 = Object.assign({}, opts || {}, { body: parseBody(opts) });
        const out = await r.reply(url, o2);
        if (out && out.networkError) throw new Error('network down');
        const status = (out && out.status) || 200;
        const body = out && out.body !== undefined ? out.body : null;
        return {
          ok: status >= 200 && status < 300,
          status,
          text: async () => (body === null ? '' : JSON.stringify(body))
        };
      }
    }
    throw new Error('маршрут не описано: ' + url);
  };
  fetchImpl.route = (test, reply) => { routes.unshift({ test, reply }); return fetchImpl; };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** Завантажити Store у пісочниці. Повертає { Store, window, ls, fetch }. */
export function loadStore(opts) {
  const o = opts || {};
  const ls = o.storage || makeStorage(o.initial);
  const net = o.fetch || makeNet();
  const listeners = {};
  const win = {
    APP_CONFIG: o.local ? {} : { supabase: { url: 'https://db.test', anonKey: 'anon-key' } },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    dispatchEvent(e) { (listeners[e.type] || []).forEach((f) => f(e)); }
  };
  const doc = {
    addEventListener(t, f) { (listeners['doc:' + t] = listeners['doc:' + t] || []).push(f); },
    dispatchEvent(e) { (listeners['doc:' + e.type] || []).forEach((f) => f(e)); },
    hidden: false,
    readyState: 'complete'
  };
  const sandbox = {
    window: win, document: doc, localStorage: ls, sessionStorage: makeStorage(),
    fetch: net, console, Math, Date, JSON, Number, String, Array, Object,
    Boolean, Error, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    CustomEvent: class { constructor(t, i) { this.type = t; Object.assign(this, i || {}); } },
    Blob: class { constructor(parts) { this.size = parts.join('').length; } },
    navigator: { onLine: true },
    /* Store складає redirect_to для листів з location — без нього
       пісочниця мовчки давала б інший результат, ніж браузер. */
    location: Object.assign({
      origin: 'https://forge.test', protocol: 'https:',
      pathname: '/welcome.html', search: '', hash: ''
    }, o.location || {}),
    URLSearchParams,
    history: { replaceState() {} }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(ROOT, 'js/store.js'), 'utf8'), sandbox, { filename: 'js/store.js' });
  return { Store: win.Store, window: win, document: doc, ls, fetch: net, fire: (t, e) => {
    (listeners[t] || []).forEach((f) => f(e || {}));
  } };
}
