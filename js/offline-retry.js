/*
 * offline.html: кнопка «Спробувати ще раз».
 *
 * Окремий файл, а не onclick у розмітці: CSP більше не дозволяє
 * script-src 'unsafe-inline' (WEB-006).
 */
document.addEventListener('DOMContentLoaded', function () {
  var b = document.getElementById('off-retry');
  if (b) b.addEventListener('click', function () { location.reload(); });
});
