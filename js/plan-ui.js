/*
 * plan.html: перемикання порожнього / заповненого стану і зняття вибору.
 *
 * Логіка потрібна лише цій сторінці. Раніше жила inline у розмітці —
 * винесено заради CSP без script-src 'unsafe-inline' (WEB-006), бо саме
 * ця директива дозволяла inline-обробники, тобто робочу форму XSS.
 */
/* Перемикання порожнього / заповненого стану і зняття вибору.
   Логіка крихітна й потрібна лише цій сторінці — тримати заради неї
   окремий файл сенсу немає. */
(function () {
  'use strict';
  var root = document.getElementById('my-plan');

  // Запобіжник: якщо скрипти плану чомусь не відпрацювали, сторінка не має
  // лишитись порожньою назавжди — через 3 с показуємо порожній стан.
  setTimeout(function () {
    if (root.dataset.state === 'loading') root.dataset.state = 'empty';
  }, 3000);

  document.addEventListener('plan:change', function () {
    var cur = window.PlanEngine && window.PlanEngine.current();
    root.dataset.state = (cur && cur.plan) ? 'ready' : 'empty';
  });

  var drop = document.getElementById('drop-plan');
  if (drop) {
    drop.addEventListener('click', function () {
      if (!confirm('Зняти вибір плану? Самі правки вправ і ваг залишаться збереженими.')) return;
      window.Store.saveProfile({ activePlan: null }).then(function () {
        location.reload();
      }, function (e) {
        /* Обробника відмови не було зовсім, і офлайн (чи прострочена сесія)
           давали найгірше поєднання: у localStorage план уже знято, сторінка
           показує старий, кнопка на вигляд не спрацювала, а в консолі —
           необроблена відмова. .queued означає «лежить у черзі», тобто
           локально все записано і перезавантаження чесне. */
        if (e && e.queued) { location.reload(); return; }
        window.App.toast('Не збереглося: ' + (e && e.message), 'err');
      });
    });
  }
})();
