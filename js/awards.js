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

  /* Поточний вибір фільтрів. Порожній рядок означає «будь-який» — це
     не «нічого», а «без обмеження», і саме тому не null. */
  var pick = { season: '', tier: '' };

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /*
   * ФІЛЬТРИ ЗʼЯВЛЯЮТЬСЯ, КОЛИ Є ЩО ФІЛЬТРУВАТИ.
   *
   * Смуга з двох рядів чипів над вітриною новачка, у якого жодної
   * нагороди немає, — це елемент керування нічим. Тому ряд сезонів
   * будується з тих сезонів, які В ЛЮДИНИ Є, і зникає, якщо сезон
   * один або жодного. Ряд рідкості стоїть завжди: він пояснює шкалу
   * навіть тому, хто ще нічого не зібрав, — видно, що буває.
   */
  function toolbar(earned) {
    var EC = window.EloCore;
    var lbl = EC && EC.seasonLabel ? EC.seasonLabel : function (x) { return String(x); };
    var seasons = [];
    (earned || []).forEach(function (a) {
      if (a && a.season && seasons.indexOf(a.season) === -1) seasons.push(a.season);
    });
    seasons.sort().reverse();

    var rows = '';
    if (seasons.length > 1) {
      rows += '<div class="awd-filter__row" role="group" aria-label="Фільтр за сезоном">' +
        chip('season', '', 'Усі сезони') +
        seasons.map(function (x) { return chip('season', x, lbl(x)); }).join('') +
      '</div>';
    }
    rows += '<div class="awd-filter__row" role="group" aria-label="Фільтр за рідкістю">' +
      chip('tier', '', 'Будь-яка рідкість') +
      (window.Award.TIERS || []).map(function (t) {
        return chip('tier', String(t.n), t.name, ' awd-chip--t' + t.n);
      }).join('') +
    '</div>';
    return '<div class="awd-filter">' + rows + '</div>';
  }

  function chip(kind, value, text, extra) {
    var on = pick[kind] === value;
    return '<button class="awd-chip' + (extra || '') + (on ? ' is-on' : '') + '" type="button"' +
      ' data-f="' + kind + '" data-v="' + esc(value) + '"' +
      ' aria-pressed="' + on + '">' + esc(text) + '</button>';
  }

  /*
   * Фільтруємо ВЖЕ НАМАЛЬОВАНІ картки, а не перебудовуємо вітрину.
   *
   * Перемальовка скидала б перевернуту картку й ламала б анімацію
   * посеред жесту. До того ж склад вітрини від фільтра не залежить —
   * залежить лише те, що з неї зараз видно.
   *
   * Силует (ще не отримана) сезону не має взагалі — і правильно: при
   * виборі конкретного сезону він ховається, бо в тому сезоні його не
   * отримано. За рідкістю силует лишається: питання «що тут буває
   * золотого» має сенс і для того, хто золотого ще не бачив.
   */
  function applyFilter(box) {
    Array.prototype.forEach.call(box.querySelectorAll('.awd'), function (card) {
      var okSeason = !pick.season || card.dataset.season === pick.season;
      var okTier = !pick.tier || card.dataset.tier === pick.tier;
      card.hidden = !(okSeason && okTier);
    });
    var shown = box.querySelectorAll('.awd:not([hidden])').length;
    var empty = box.querySelector('.awd-grid__empty');
    if (empty) empty.hidden = shown > 0;
  }

  function draw(earned) {
    var box = host();
    if (!box || !window.Award) return;
    var EC = window.EloCore;
    box.innerHTML = toolbar(earned) +
      window.Award.showcase(earned, {
        seasonLabel: EC && EC.seasonLabel ? EC.seasonLabel : null
      }) +
      '<p class="awd-grid__empty small muted" hidden>За цим добором нічого немає. ' +
        'Спробуйте інший сезон або іншу рідкість.</p>';
    wireFlip(box);
    applyFilter(box);

    if (box.dataset.awdFilter === '1') return;
    box.dataset.awdFilter = '1';
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.awd-chip') : null;
      if (!b) return;
      pick[b.dataset.f] = b.dataset.v;
      Array.prototype.forEach.call(
        box.querySelectorAll('.awd-chip[data-f="' + b.dataset.f + '"]'),
        function (c) {
          var on = c === b;
          c.classList.toggle('is-on', on);
          c.setAttribute('aria-pressed', String(on));
        });
      applyFilter(box);
    });
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
