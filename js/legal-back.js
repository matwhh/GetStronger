/*
 * legal.html: кнопка «Назад».
 *
 * Був атрибут onclick="history.back()" у розмітці. Через нього (і через
 * inline-скрипт теми) у CSP доводилось тримати script-src 'unsafe-inline',
 * а це рівно та директива, що дозволяє <img src=x onerror=…> — робочу
 * форму XSS (WEB-006).
 *
 * Сторінка навмисно не підключає app.js: правові документи мають
 * відкриватись і тоді, коли решта застосунку зламана.
 */
document.addEventListener('DOMContentLoaded', function () {
  var b = document.getElementById('lg-back');
  if (b) b.addEventListener('click', function () { history.back(); });
});
