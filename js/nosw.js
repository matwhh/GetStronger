/*
 * АВАРІЙНИЙ ВИМИКАЧ SERVICE WORKER: відкрити будь-яку сторінку з ?nosw=1.
 *
 * ЧОМУ ОКРЕМИЙ ФАЙЛ. Вимикач існує рівно для випадку «зіпсований worker
 * на чужому пристрої, дістатись до нього нема як». Досі він лежав у
 * js/app.js — тобто у файлі, який роздає САМЕ ЦЕЙ worker зі свого кешу.
 * Якщо ламався worker або закешована копія app.js, вимикач не виконувався
 * (PWA-006): єдиний засіб порятунку працював тільки тоді, коли рятувати
 * не було від чого.
 *
 * Тепер він у власному файлі, який sw.js НІКОЛИ не перехоплює й не кладе
 * в кеш (див. isKillSwitch у sw.js) — тобто завжди приїжджає з мережі.
 *
 * Підключається першим на кожній сторінці, без defer: якщо людина прийшла
 * саме рятувати сторінку, це має статись до решти скриптів.
 */
'use strict';
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.search.indexOf('nosw=1') === -1) return;

  navigator.serviceWorker.getRegistrations().then(function (rs) {
    rs.forEach(function (r) { r.unregister(); });
  }).catch(function () {});

  if (window.caches && caches.keys) {
    caches.keys().then(function (ks) {
      ks.forEach(function (k) { caches.delete(k); });
    }).catch(function () {});
  }

  /* Позначка для js/app.js: реєструвати worker назад цього разу не треба. */
  window.__forgeNoSW = true;
})();
