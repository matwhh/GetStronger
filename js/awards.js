/**
 * СТОРІНКА НАГОРОД — вітрина всього, що можна зібрати.
 *
 * ЧОМУ ОКРЕМА СТОРІНКА, А НЕ БЛОК У РЕЙТИНГУ. У рейтингу нагороди були
 * хвостом «Історії сезонів» — тобто відповіддю на питання, якого там
 * ніхто не ставить. Питання «що я вже маю і що ще можна взяти» — окреме,
 * і воно виникає не тоді, коли дивишся на своє ELO. Тому в рейтингу
 * лишається превʼю, яке веде сюди, а розмову ведуть тут.
 *
 * ЧОМУ ПОКАЗУЄМО Й НЕОТРИМАНІ. Порожня вітрина не пояснює нічого: людина
 * бачить «нагород немає» і не дізнається ні що вони бувають, ні за що їх
 * дають. Силует показує і те, і те без жодного рядка тексту. Дізнатись,
 * що саме за нагорода, можна тим самим жестом, що й у отриманої, —
 * перевернувши картку.
 *
 * ДАНІ — З СЕРВЕРА, І ТІЛЬКИ З НЬОГО. Нагороди видає elo_close_season
 * (db/elo-engine.sql), клієнт їх не рахує й не домальовує: нагорода, яку
 * можна собі приписати в localStorage, не нагорода. Без мережі показуємо
 * вітрину силуетами — це чесно, а не порожньо.
 */
(function () {
  'use strict';

  var App = window.App || {};
  var $ = App.$ || function (s) { return document.querySelector(s); };

  function host() { return $('#awd-page'); }

  /*
   * ПЕРЕВОРОТ НА ДОТИКУ.
   *
   * На курсорі картку перевертає :hover, з клавіатури — :focus-visible;
   * і те, і те живе в CSS. На телефоні :hover ЗАЛИПАЄ після тапу — картка
   * лишалась би перевернутою, доки не торкнешся іншого місця, і закрити
   * її було б нічим. Тому там свій клас і свій тап.
   */
  function wireFlip(box) {
    if (!box || box.dataset.awdOn === '1') return;
    try {
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    } catch (_) { /* немає matchMedia — вважаємо, що дотик */ }
    box.dataset.awdOn = '1';
    box.addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.awd') : null;
      if (!card) return;
      var was = card.classList.contains('is-flip');
      /* Одночасно перевернута щонайбільше одна: дві відкриті картки поруч
         читаються як збій, а не як вибір. */
      Array.prototype.forEach.call(box.querySelectorAll('.awd.is-flip'), function (c) {
        c.classList.remove('is-flip');
      });
      if (!was) card.classList.add('is-flip');
    });
  }

  function draw(earned) {
    var box = host();
    if (!box || !window.Award) return;
    var EC = window.EloCore;
    box.innerHTML = window.Award.showcase(earned, {
      seasonLabel: EC && EC.seasonLabel ? EC.seasonLabel : null
    });
    wireFlip(box);
  }

  async function init() {
    if (!host()) return;

    /*
     * Спершу малюємо вітрину силуетами, і лише потім просимо сервер.
     * Порядок навмисний: сторінка мусить бути осмисленою до відповіді
     * мережі, а не після. Якщо відповідь не прийде — те, що вже на
     * екрані, лишається правдою: жодної нагороди не приписано.
     */
    draw([]);

    var Api = window.EloApi;
    if (!Api || !Api.history) return;
    try {
      var data = await Api.history();
      draw((data && data.awards) || []);
    } catch (_) {
      /* Мережі немає або людина не ввійшла — вітрина силуетами вже
         намальована, дописувати до неї помилку нема потреби. */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
