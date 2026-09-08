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

/*
 * Оболонка: те, без чого «Сьогодні» не працює, а не те, без чого сторінка
 * не намалюється.
 *
 * Раніше тут було шість файлів, тоді як index.html підключає 21 скрипт.
 * Наслідок: людина ставить застосунок, втрачає мережу до другого
 * відкриття — і бачить шапку, навігацію й заголовок «FORGE — сьогодні»
 * без window.Store і без панелі дня. Тобто екран, який виглядає робочим і
 * не працює, ще й мовчки (PWA-013).
 *
 * Перелік — рівно скрипти index.html у порядку підключення. Якщо в
 * розмітці зʼявиться новий, його треба додати сюди: tools/ci-hygiene.mjs
 * за цим стежить і валить збірку при розбіжності.
 */
const SHELL = ['./index.html', './offline.html', './css/style.css', './logo-mark.svg', './favicon.svg',
               './js/theme-boot.js', './js/agegate.js', './js/config.js', './js/errors.js', './js/age-core.js',
               './js/onboarding-core.js', './js/app.js', './js/store.js',
               './js/elo-core.js', './js/elo-api.js', './js/elo-hooks.js',
               './js/history-core.js', './js/exercises.js', './js/reps-core.js',
               './js/programs-data.js', './js/foods.js', './js/recipes-data.js',
               './js/day-core.js', './js/nutrition-core.js', './js/tracker-core.js',
               './js/workout-core.js', './js/today.js'];

/* Скільки чекати на мережу, перш ніж віддати кеш (PWA-002). */
const NET_TIMEOUT = 4000;

/*
 * КЛЮЧ КЕША — БЕЗ QUERY-РЯДКА (PWA-008).
 *
 * Ключем Cache API є повний URL. Тобто /index.html?utm_source=a і
 * /index.html?utm_source=b — два різні вічні записи, а посилань із
 * мітками кампаній, ?fbclid і рештою сміття буває скільки завгодно.
 * Обмеження за кількістю, розміром чи віком у Cache API немає; activate
 * зносить лише кеші з ІНШИМ іменем, а ім'я не змінюється. Тобто кеш ріс
 * би без стелі, поки браузер не викине його цілком (і разом із ним —
 * офлайн-роботу).
 *
 * Тому і кладемо, і шукаємо за origin+pathname. Кількість записів
 * дорівнює кількості файлів у проєкті, і це стеля.
 *
 * Чому це безпечно: у проєкті немає ані ?v=-суфіксів, ані будь-якої
 * іншої версії в query (див. коментар на початку файла — саме тому
 * обрано stale-while-revalidate). Якщо колись з'являться, це місце
 * доведеться переглянути.
 */
function cacheKey(req) {
  const u = new URL(req.url);
  return u.origin + u.pathname;
}

/** Помилка кеша — не привід мовчати (PWA-011). */
function swWarn(where, err) {
  try { console.warn('[sw] ' + where, err); } catch (_) {}
}

self.addEventListener('install', function (e) {
  /* Оболонка кладеться заздалегідь, решта — по факту звернення. Помилка
     передкешу не має валити встановлення: сторінка й далі працює з мережі. */
  /*
   * addAll — усе або нічого: один 404 лишав кеш ПОРОЖНІМ, і офлайн не
   * працював зовсім. Кладемо поштучно, кожен зі своїм catch: відсутній
   * файл коштує одного файла, а не всієї офлайн-роботи.
   */
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        return Promise.all(SHELL.map(function (u) {
          return c.add(u).catch(function (e) { swWarn('передкеш ' + u, e); });
        }));
      })
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

  /*
   * АВАРІЙНИЙ ВИМИКАЧ — ПОВЗ КЕШ І ПОВЗ НАС (PWA-006).
   *
   * js/nosw.js існує рівно для того, щоб зняти зіпсований worker. Якщо
   * віддавати його з кешу, він ділить долю того, що має рятувати. Тому
   * жодного перехоплення: браузер піде в мережу сам.
   */
  if (/\/js\/nosw\.js$/.test(url.pathname) || /(^|[?&])nosw=1(&|$)/.test(url.search)) return;

  const isHTML = req.mode === 'navigate' ||
                 (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isHTML) {
    e.respondWith(htmlFirst(req));
    return;
  }

  if (!isAsset(url)) return;

  /* stale-while-revalidate: віддаємо кеш, у фоні оновлюємо. */
  const key = cacheKey(req);
  e.respondWith(
    caches.match(key).then(function (hit) {
      const net = fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE)
            .then(function (c) { return c.put(key, copy); })
            .catch(function (err) { swWarn('запис у кеш ' + key, err); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

/**
 * Навігація: мережа першою, але з обмеженням часу — і з інвалідацією
 * кешу, коли розмітка змінилась.
 *
 * ТРИ РЕЧІ, ЯКИХ ТУТ БРАКУВАЛО:
 *
 * 1. Тайм-аут (PWA-002). fetch переходить у .catch лише при помилці
 *    зʼєднання. При «lie-fi» (сигнал є, відповіді немає) TCP встановлено,
 *    обіцянка не виконується ніколи — і сторінки немає взагалі, хоча в
 *    кеші лежить робоча копія. Тепер мережа має NET_TIMEOUT мілісекунд,
 *    далі віддаємо кеш; відповідь, коли прийде, все одно оновить кеш.
 *
 * 2. Перевірка статусу (PWA-001). Раніше в кеш клалась БУДЬ-ЯКА
 *    відповідь: 404, 429 і 500 підміняли справну закешовану сторінку і
 *    ставали офлайн-запасним варіантом. Отруєння ./index.html вимикало
 *    офлайн для всіх адрес одразу.
 *
 * 3. Узгодженість HTML і скриптів (PWA-003). HTML брався з мережі, а
 *    JS/CSS — з кешу, тому ПЕРШЕ відкриття після кожної публікації
 *    виконувало нову розмітку старими скриптами: будь-яка узгоджена
 *    зміна (новий id, новий data-атрибут) один раз мовчки не працювала.
 *    Тепер свіжу розмітку звіряємо із закешованою, і при розбіжності
 *    кеш скидається ДО того, як браузер піде по підресурси — тобто
 *    сторінка тягне свої скрипти з тієї самої публікації. Ціна — одне
 *    повільніше відкриття після кожного деплою, рівно тоді, коли це й
 *    потрібно.
 */
function htmlFirst(req) {
  let timer = null;
  const key = cacheKey(req);
  const net = fetch(req).then(function (res) {
    if (res && res.ok) return cacheHtml(key, res);
    return res;
  });

  const raced = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve(null); }, NET_TIMEOUT);
  });

  return Promise.race([net.catch(function () { return null; }), raced])
    .then(function (res) {
      clearTimeout(timer);
      if (res) return res;
      /* Мережа мовчить або відмовила — віддаємо кеш. Запит у мережу не
         скасовуємо: коли він дійде, кеш оновиться сам. */
      return caches.match(key).then(function (hit) {
        if (hit) return hit;
        /*
         * НЕЗАКЕШОВАНА СТОРІНКА — ЦЕ НЕ «СЬОГОДНІ» (PWA-005).
         *
         * Раніше запасним варіантом був ./index.html без жодної ознаки
         * підміни: людина відкривала /rating.html і бачила екран
         * «Сьогодні» під запитаною адресою. Перезавантаження, закладка й
         * «назад» вели туди ж, і зрозуміти, що сталось, було нізвідки.
         * Тепер — окрема сторінка, яка чесно каже, що мережі немає.
         */
        return caches.match('./offline.html').then(function (off) {
          return off || caches.match('./index.html').then(function (root) {
            return root || net;   /* нічого в кеші — лишається лише чекати */
          });
        });
      });
    });
}

/**
 * Покласти свіжу розмітку в кеш; при зміні — скинути кеш цілком.
 *
 * ЧОМУ СКИДАЄТЬСЯ ВЕСЬ КЕШ, А НЕ ОДИН ДОКУМЕНТ (PWA-003 і PWA-009).
 * Розбіжність розмітки означає нову публікацію. Разом із HTML змінились і
 * скрипти, і стилі, і розмітка ІНШИХ сторінок, які лежать у кеші з
 * попереднього деплою. Якби ми оновили лише поточний документ, людина,
 * відкривши потім офлайн іншу сторінку, дістала б з кеша її стару
 * розмітку — а скрипти до неї SWR уже підмінив на нові (PWA-009). Знос
 * кеша цілком лишає рівно один узгоджений стан: щойно завантажену
 * сторінку; решта доїде з мережі й ляже вже з цієї ж публікації.
 *
 * @param {string} key  нормалізований ключ (див. cacheKey)
 */
function cacheHtml(key, res) {
  const fresh = res.clone();
  return caches.open(CACHE).then(function (c) {
    return c.match(key).then(function (old) {
      if (!old) return c.put(key, fresh).then(function () { return res; });
      return Promise.all([old.text(), fresh.clone().text()]).then(function (t) {
        if (t[0] === t[1]) return res;
        /* Розмітка змінилась — публікація нова. Прибираємо все, щоб
           скрипти й стилі приїхали з тієї самої публікації. */
        return caches.delete(CACHE)
          .then(function () { return caches.open(CACHE); })
          .then(function (c2) { return c2.put(key, fresh); })
          .then(function () { return res; });
      });
    });
  }).catch(function (err) { swWarn('запис розмітки ' + key, err); return res; });
}
