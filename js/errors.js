/**
 * Get Stronger — репорт помилок JavaScript у Sentry.
 *
 * Навіщо: сайт статичний і виконується в браузерах, яких ми не бачимо.
 * Без цього про зламану сторінку дізнаєшся тільки тоді, коли хтось
 * розкаже — а частіше не розкаже, просто перестане заходити. Модуль ловить
 * необроблені винятки й відхилені проміси і шле їх у Sentry.
 *
 * ЩО СВІДОМО НЕ ВІДПРАВЛЯЄТЬСЯ:
 *   · жодного ідентифікатора користувача — ні пошти, ні uid, ні ніка;
 *   · query-рядок і #хеш з адреси обрізаються: у хеші Supabase приносить
 *     токени відновлення пароля, і вони не мають опинитись у Sentry;
 *   · нічого з даних — ні профілю, ні тренувань, ні localStorage.
 * Лишається: тип і текст помилки, стек, шлях сторінки, User-Agent.
 *
 * ЩО ВСЕ ОДНО ПОТРАПЛЯЄ В SENTRY І ЧОГО КЛІЄНТ НЕ КОНТРОЛЮЄ (WEB-005):
 * IP-адресу бере сам Sentry з мережевого запиту й виводить із неї країну
 * та місто. Це не «ми відправляємо» — це властивість будь-якого HTTP-
 * запиту, і твердження вище стосується лише того, що кладе в подію код.
 * Вимкнути це можна лише в панелі Sentry (Security & Privacy → Prevent
 * Storing of IP Addresses) — рішення власника проєкту, а не рядок коду.
 * Доки воно не вимкнене, legal.html має казати про це прямо.
 *
 * Якщо dsn у js/config.js порожній — модуль мовчить і нічого не шле
 * (той самий принцип, що й із Supabase: без ключів сайт просто працює).
 * На localhost теж не шле: помилки розробки пишуться в консоль.
 *
 * Ручний виклик для місць, де виняток уже спійманий, але означає баг:
 *   ForgeErrors.report(err, { where: 'elo-api.submit' });
 */
(function () {
  'use strict';

  /* Стеля на сеанс сторінки. Один цикл помилок у requestAnimationFrame
     здатний згенерувати тисячі подій за секунду й спалити місячну квоту
     Sentry — тому і стеля, і дедуплікація нижче. */
  var MAX_PER_PAGE = 8;

  /* Відомий шум, який не є багом Forge. */
  var IGNORE = [
    /ResizeObserver loop/i,          // діагностика рушія, не помилка
    /^Script error\.?$/i,            // крос-доменна помилка без деталей
    /Load failed/i,                  // обрив мережі в Safari
    /NetworkError when attempting/i, // те саме у Firefox
    /operation was aborted/i,        // користувач пішов зі сторінки
    /extension:\/\//i,               // помилки розширень браузера
    /^AbortError/i
  ];

  var sent = 0;
  var seen = Object.create(null);
  var endpoint = null;

  /* ---- допоміжне -------------------------------------------------- */

  /** Адреса без query і хеша: там бувають токени. */
  function scrub(url) {
    return String(url == null ? '' : url).split('?')[0].split('#')[0];
  }

  function eventId() {
    var hex = '';
    if (window.crypto && typeof crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      for (var i = 0; i < 16; i++) hex += (bytes[i] + 0x100).toString(16).slice(1);
      return hex;
    }
    while (hex.length < 32) hex += Math.floor(Math.random() * 16).toString(16);
    return hex.slice(0, 32);
  }

  /**
   * DSN → адреса конверта і публічний ключ.
   * DSN публічний за задумом: він є в кожному браузері, що відкриє сайт.
   */
  function parseDsn(raw) {
    if (typeof raw !== 'string' || raw.slice(0, 4) !== 'http') return null;
    try {
      var u = new URL(raw);
      var projectId = u.pathname.replace(/^\/+/, '');
      if (!u.username || !projectId) return null;
      return {
        url: u.protocol + '//' + u.host + '/api/' + projectId + '/envelope/'
             + '?sentry_key=' + encodeURIComponent(u.username) + '&sentry_version=7'
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Стек рядком → кадри Sentry.
   *
   * Формат різний у кожному рушії, а всередині eval стає ще й вкладеним:
   *   Chrome  "    at fn (https://site/js/a.js:10:5)"
   *   Firefox "fn@https://site/js/a.js:10:5"
   *   eval    "    at eval (eval at go (:9:3), <anonymous>:1:44)"
   * Тому не намагаємось описати рядок цілком: беремо ОСТАННЄ входження
   * «місце:рядок:колонка» (у вкладених випадках воно і є справжнім), а
   * імʼя функції — окремо, якщо його видно. Кадр, який не розібрався,
   * пропускаємо: неповний стек кращий за жодного.
   */
  function parseFrames(stack) {
    if (typeof stack !== 'string') return [];
    var lines = stack.split('\n').slice(0, 30);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      var loc = null, m;
      var place = /([^\s()[\],]+):(\d+):(\d+)/g;
      while ((m = place.exec(line)) !== null) loc = m;
      if (!loc) continue;

      var name = line.match(/^\s*at\s+(?:async\s+)?([^\s(]+)\s*\(/)
              || line.match(/^\s*([^\s@]+)@/);

      out.push({
        'function': name ? name[1] : '?',
        filename: scrub(loc[1]),
        lineno: Number(loc[2]),
        colno: Number(loc[3]),
        in_app: loc[1].indexOf(location.origin) === 0
      });
    }
    /* Sentry чекає кадри від найдавнішого до місця падіння. */
    return out.reverse();
  }

  function ignored(text) {
    for (var i = 0; i < IGNORE.length; i++) if (IGNORE[i].test(text)) return true;
    return false;
  }

  /* ---- відправка --------------------------------------------------- */

  function send(body) {
    /* Конверт іде як text/plain навмисне: так браузер вважає запит
       «простим» і не робить preflight, який під час вивантаження
       сторінки часто не встигає. Sentry розбирає тіло за форматом,
       а не за заголовком. keepalive дозволяє запиту пережити перехід
       на іншу сторінку. */
    try {
      fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: body
      }).catch(function () { /* не змогли — і не треба, це не критично */ });
    } catch (e) { /* fetch недоступний — мовчки пропускаємо */ }
  }

  function capture(type, value, stack, extra) {
    if (!endpoint || sent >= MAX_PER_PAGE) return;

    var text = String(type) + ': ' + String(value);
    if (ignored(text)) return;

    /* Дедуплікація: та сама помилка в циклі шлеться один раз. */
    var key = type + '|' + value;
    if (seen[key]) return;
    seen[key] = true;
    sent++;

    var id = eventId();
    var event = {
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      logger: 'forge',
      environment: 'production',
      transaction: scrub(location.pathname),
      exception: {
        values: [{
          type: String(type).slice(0, 128),
          value: String(value).slice(0, 1024),
          stacktrace: { frames: parseFrames(stack) }
        }]
      },
      request: {
        url: scrub(location.origin + location.pathname),
        headers: { 'User-Agent': navigator.userAgent }
      },
      tags: { page: scrub(location.pathname) }
    };
    if (extra && typeof extra === 'object') event.extra = extra;

    send(
      JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }) + '\n' +
      JSON.stringify({ type: 'event', content_type: 'application/json' }) + '\n' +
      JSON.stringify(event)
    );
  }

  /** Будь-що кинуте → {type, value, stack}. Кидають не лише Error. */
  function normalize(thrown) {
    if (thrown instanceof Error) {
      return { type: thrown.name || 'Error', value: thrown.message, stack: thrown.stack };
    }
    if (thrown && typeof thrown === 'object') {
      var text;
      try { text = JSON.stringify(thrown); } catch (e) { text = Object.prototype.toString.call(thrown); }
      return { type: 'UnhandledObject', value: String(text).slice(0, 512), stack: '' };
    }
    return { type: 'UnhandledValue', value: String(thrown), stack: '' };
  }

  /* ---- увімкнення -------------------------------------------------- */

  var host = location.hostname;
  var isLocal = !host || host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:';
  var conf = (window.APP_CONFIG && window.APP_CONFIG.sentry) || {};
  endpoint = isLocal ? null : parseDsn(conf.dsn);
  endpoint = endpoint && endpoint.url;

  window.addEventListener('error', function (e) {
    /* Той самий тип події прилітає і на збиті <img>/<script>. Там немає
       error і є target — це не виняток JS, а 404 на ресурсі. */
    if (!e.error && e.target && e.target !== window) return;
    var n = e.error ? normalize(e.error)
                    : { type: 'Error', value: e.message, stack: '' };
    if (!e.error && e.filename) {
      n.stack = 'at ' + e.filename + ':' + (e.lineno || 0) + ':' + (e.colno || 0);
    }
    capture(n.type, n.value, n.stack);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var n = normalize(e && e.reason);
    capture(n.type === 'Error' ? 'UnhandledRejection' : n.type, n.value, n.stack);
  });

  window.ForgeErrors = {
    /** Ручний репорт: виняток спійманий, але означає баг. */
    report: function (err, extra) {
      var n = normalize(err);
      if (!endpoint) { if (window.console) console.warn('[forge]', n.type, n.value, extra || ''); return; }
      capture(n.type, n.value, n.stack, extra);
    },
    /** Для тестів і діагностики: чи модуль реально щось відправляє. */
    get enabled() { return Boolean(endpoint); }
  };
})();
