/**
 * Service worker Forge.
 *
 * НАВІЩО. manifest.webmanifest оголошує display: standalone, тобто сайт
 * ставлять на домашній екран як застосунок. Без service worker він без
 * мережі не відкривався ВЗАГАЛІ: перевірено — офлайн дає
 * net::ERR_INTERNET_DISCONNECTED і порожній body. Застосунок, який
 * зберігає всі дані локально, не мав фізичної змоги стартувати в залі без
 * сигналу. Це головна причина, чому він тут.
 *
 * ДРУГА ПРИЧИНА — кількість запитів. Це багатосторінковий сайт: кожен тап
 * по вкладці — повна навігація з 21–27 підресурсами (519–649 КБ). Імена
 * файлів без хешів, тому «вічний» кеш ставити не можна: одна публікація
 * без зміни імені — і людина рік сидить на старому JS. Тому не immutable, а
 * stale-while-revalidate: віддаємо з кешу миттєво, у фоні перевіряємо
 * оновлення, наступне відкриття вже свіже. Дисципліни версіонування не
 * потрібно взагалі — саме тому обрано цей варіант, а не ?v= суфікси.
 *
 * HTML — network-first: свіжий деплой має бути видно ОДРАЗУ, а не після
 * другого заходу. Кеш HTML лишається як запасний варіант для офлайну.
 *
 * ЧОГО ТУТ НЕМАЄ. Не кешуються чужі походження (Supabase, Google Fonts):
 * відповіді API в кеші — це прострочені дані під виглядом свіжих. Не
 * кешуються POST і будь-що, крім GET.
 *
 * ЯК ПРИБРАТИ. Відкрити будь-яку сторінку з ?nosw=1 — реєстрація
 * знімається, кеші стираються (див. js/app.js).
 */
'use strict';

/* Версія кешу. Міняти, коли треба примусово скинути все закешоване;
   у звичайному житті цього не треба — див. stale-while-revalidate. */
const CACHE = 'forge-v1';

/* Мінімальна оболонка: те, без чого сторінка не покажеться взагалі. */
const SHELL = ['./index.html', './css/style.css', './js/app.js', './js/agegate.js',
               './logo-mark.svg', './favicon.svg'];

self.addEventListener('install', function (e) {
  /* Оболонка кладеться заздалегідь, решта — по факту звернення. Помилка
     передкешу не має валити встановлення: сторінка й далі працює з мережі. */
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL).catch(function () {}); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/** Чи це наш статичний файл, який має сенс тримати в кеші. */
function isAsset(url) {
  return /\.(css|js|svg|png|ico|webmanifest|json)$/.test(url.pathname);
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* Чуже походження — повз кеш. Supabase і шрифти сюди не потрапляють. */
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isHTML) {
    /* Мережа першою: свіжий деплой видно одразу. Кеш — запасний. */
    e.respondWith(
      fetch(req)
        .then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  if (!isAsset(url)) return;

  /* stale-while-revalidate: віддаємо кеш, у фоні оновлюємо. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      const net = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
