/**
 * Service worker Get Stronger.
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
 * без зміни імені — і людина рік сидить на старому JS.
 *
 * ТРИ РЕЖИМИ, А НЕ ОДИН.
 *
 *   HTML  — мережа перша. Свіжий деплой має бути видно одразу, кеш
 *           лишається запасним варіантом для офлайну.
 *   CSS і JS — мережа перша з коротким тайм-аутом (ASSET_TIMEOUT), кеш
 *           запасним. Це КОД: стара його версія — не «трохи застарілий
 *           вигляд», а інший застосунок під свіжою розміткою.
 *   Решта (svg, png, ico, json, webmanifest) — stale-while-revalidate:
 *           віддаємо з кешу миттєво, у фоні оновлюємо. Ці файли майже не
 *           змінюються, і саме вони складають більшість байтів.
 *
 * ЧОМУ CSS І JS ПЕРЕВЕЛИ З SWR (PWA-014). SWR за визначенням віддає
 * ПОПЕРЕДНЮ версію й підвозить свіжу «на потім». Нижче був захист: коли
 * розмітка сторінки змінилась, кеш зноситься цілком, тож скрипти
 * приїжджають із тієї самої публікації. Але спрацьовує він лише на ЗМІНУ
 * HTML — а публікація, що чіпає тільки css/js (найчастіший випадок:
 * правка стилю, правка графіка), жодного HTML не змінює. Наслідок,
 * відтворений у tools/verifysw.mjs: людина відкриває сторінку після
 * публікації і бачить СТАРИЙ код, а свіжий тихо лягає в кеш до
 * наступного разу. Два оновлення поспіль — і вона на дві версії позаду.
 *
 * Ціна нового режиму невелика: fetch із worker'а йде крізь звичайний
 * HTTP-кеш, тож повторне відкриття зазвичай коштує 304, а не
 * перезавантаження файла. А без мережі все так само віддається з кешу —
 * просто через ASSET_TIMEOUT, а не миттєво.
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
 * відкриття — і бачить шапку, навігацію й заголовок «Get Stronger — сьогодні»
 * без window.Store і без панелі дня. Тобто екран, який виглядає робочим і
 * не працює, ще й мовчки (PWA-013).
 *
 * Перелік — рівно скрипти index.html у порядку підключення. Якщо в
 * розмітці зʼявиться новий, його треба додати сюди: tools/ci-hygiene.mjs
 * за цим стежить і валить збірку при розбіжності.
 */
const SHELL = ['./index.html', './offline.html', './css/style.css',
               /* Назва сайту набрана Archivo Black; без нього офлайн вона
                  падає на системний гротеск — знак перестає бути знаком. */
               './fonts/archivo-black.woff2',
               './logo-mark.svg', './favicon.svg',
               './js/theme-boot.js', './js/agegate.js', './js/config.js', './js/errors.js', './js/age-core.js',
               './js/onboarding-core.js', './js/app.js', './js/store.js',
               './js/elo-core.js', './js/elo-api.js', './js/elo-hooks.js',
               './js/history-core.js', './js/daylog-core.js', './js/exercises.js', './js/reps-core.js',
               './js/user-exercises-core.js',
               './js/programs-data.js', './js/foods.js', './js/recipes-data.js',
               './js/day-core.js', './js/nutrition-core.js', './js/tracker-core.js',
               './js/tracker-tile-core.js',
               './js/workout-core.js', './js/gym-core.js', './js/onerm-core.js',
               './js/statwindow-core.js', './js/daycal-core.js',
               './js/date-core.js',
               './js/import-core.js',
               './js/progression-core.js', './js/weight-limits-core.js',
               './js/measure-core.js',
               './js/auth-msg-core.js',
               './js/liquid-glass.js', './js/tabbar-glass.js', './js/donut-core.js',
               './js/today.js',
               './js/help-content.js', './js/help-search-core.js', './js/help.js'];

/* Скільки чекати на мережу, перш ніж віддати кеш (PWA-002). */
const NET_TIMEOUT = 4000;

/*
 * Те саме для css/js, але вдвічі коротше. Навігація без HTML — це порожній
 * екран, тому там не шкода почекати 4 секунди. Код же має запасний варіант
 * у кеші, який майже завжди робочий, тож довге чекання тут купує менше, а
 * коштує видимої затримки на кожному відкритті при поганому сигналі.
 */
const ASSET_TIMEOUT = 2000;

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

  /* Код — мережа перша, решта статики — stale-while-revalidate.
     Чому саме так, докладно в шапці файла (PWA-014). */
  e.respondWith(isCode(url) ? codeFirst(req) : swr(req));
});

/** Чи це виконуваний файл — стилі або скрипти. */
function isCode(url) {
  return /\.(css|js)$/.test(url.pathname);
}

/** Покласти відповідь у кеш, якщо вона того варта. Повертає саму відповідь. */
function keep(key, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE)
      .then(function (c) { return c.put(key, copy); })
      .catch(function (err) { swWarn('запис у кеш ' + key, err); });
  }
  return res;
}

/** stale-while-revalidate: кеш миттєво, оновлення у фоні. */
function swr(req) {
  const key = cacheKey(req);
  return caches.match(key).then(function (hit) {
    const net = fetch(req)
      .then(function (res) { return keep(key, res); })
      .catch(function () { return hit; });
    return hit || net;
  });
}

/**
 * Мережа перша з тайм-аутом; кеш — запасний варіант.
 *
 * Гонка влаштована так само, як у htmlFirst: запит у мережу НЕ
 * скасовується після тайм-ауту — коли відповідь дійде, вона все одно
 * оновить кеш, і наступне відкриття буде свіжим навіть при поганому
 * зв'язку. Таймер знімаємо явно, щоб не тримати worker живим даремно.
 */
function codeFirst(req) {
  const key = cacheKey(req);
  let timer = null;
  const net = fetch(req).then(function (res) { return keep(key, res); });

  const raced = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve(null); }, ASSET_TIMEOUT);
  });

  return Promise.race([net.catch(function () { return null; }), raced])
    .then(function (res) {
      clearTimeout(timer);
      if (res) return res;
      return caches.match(key).then(function (hit) {
        /* Нічого в кеші й мережа мовчить — лишається чекати на мережу.
           Це той самий стан, що й узагалі без worker'а. */
        return hit || net;
      });
    });
}

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
