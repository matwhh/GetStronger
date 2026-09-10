/**
 * КІЛЬЦЕВА ДІАГРАМА СКЛАДУ — «скільки з чого».
 *
 * ЧОМУ ЦЕ НЕ СУПЕРЕЧИТЬ ПРАВИЛУ «ГРАФІК — ЦЕ ЛІНІЯ».
 *
 * Правило (docs/ENGINEERING.md §14) забороняє стовпчики на графіках, бо
 * стовпчик читається як частка від нуля, а жоден показник Forge не має
 * осмисленого нуля в масштабі свого графіка: вага тіла живе в 80–85 кг,
 * разовий максимум — у 95–110.
 *
 * Тут інша задача й інші числа. Це не зміна в часі, а СКЛАД: три частини
 * однієї суми. Нуль у них справжній (нуль грамів білка — це нуль
 * грамів), сума справжня (вона дорівнює калоріям), і питання до
 * діаграми теж інше — не «куди я рухаюсь», а «з чого складається день».
 * Для складу кільце — правильна форма, як і горизонтальна смуга
 * (.macrobar, .vol__bar), яка з тієї ж причини під заборону не підпадає.
 *
 * ЧОМУ КІЛЬЦЕ, А НЕ ПОВНИЙ КРУГ. Дучка посередині — не мода: у ній
 * стоїть САМА СУМА. У КБЖВ калорії — не четвертий нутрієнт, а те, у що
 * складаються три інші, тож їм місце в центрі, а не окремим сектором.
 * Повний круг такого місця не має, і калорії довелося б підписувати
 * збоку, ніби вони ще одна частка.
 *
 * ТРИ СЕКТОРИ, НЕ ЧОТИРИ. Клітковина сюди не входить навмисно: її
 * 2 ккал/г уже відняті з вуглеводів (js/nutrition-core.js), і окремим
 * сектором вона порахувалась би вдруге.
 *
 * ГЕОМЕТРІЯ. Сектор — це дуга кола, намальована штрихом: одне <circle>
 * зі stroke-dasharray = [довжина сектора, решта кола] і зсувом
 * stroke-dashoffset. Так дешевше й точніше за <path> з командою A: не
 * треба рахувати координати кінців дуги й не буває щілин через
 * заокруглення координат.
 */
(function () {
  'use strict';

  const VB = 100;                 // полотно
  const CX = 50, CY = 50;
  const R = 38;                   // радіус середньої лінії кільця
  const W = 15;                   // товщина кільця
  const C = 2 * Math.PI * R;      // довжина кола, ≈238.76
  /* Проміжок між секторами в одиницях довжини дуги. Без нього сусідні
     сектори зливаються в суцільне кільце, і межа між ними видно лише за
     кольором — а на чорно-білому друку не видно взагалі. */
  const GAP = 2.2;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

  /**
   * @param {object} o
   * @param {Array}  o.slices  [{label, value, cls, title}] — value у спільних
   *                           одиницях (у КБЖВ це кілокалорії нутрієнта)
   * @param {string} [o.center] великий напис у дучці
   * @param {string} [o.sub]    дрібний напис під ним
   * @param {string} [o.label]  aria-label усієї діаграми
   * @param {string} [o.empty]  що написати, коли сума нульова
   * @returns {string} HTML
   */
  function html(o) {
    const opt = o || {};
    const raw = (opt.slices || []).map(function (s) {
      return { label: String(s.label || ''), value: Math.max(0, num(s.value)),
               cls: String(s.cls || ''), title: s.title || '' };
    });
    const total = raw.reduce(function (a, s) { return a + s.value; }, 0);

    /*
     * ПОРОЖНІЙ ДЕНЬ — ЦЕ НЕ ДІАГРАМА З НУЛЯМИ.
     *
     * Кільце з трьох нульових секторів — просто порожнє коло, з якого не
     * випливає, чи даних немає, чи вони справді нульові. Тому малюємо
     * бліде кільце й кажемо словами.
     */
    if (total <= 0) {
      return '<div class="donut donut--empty">' +
        '<svg class="donut__svg" viewBox="0 0 ' + VB + ' ' + VB + '" role="img" aria-label="' +
          esc(opt.label || 'Склад') + ': ще без даних">' +
          '<circle class="donut__track" cx="' + CX + '" cy="' + CY + '" r="' + R +
            '" fill="none" stroke-width="' + W + '"/>' +
        '</svg>' +
        (opt.empty ? '<p class="donut__empty small muted">' + esc(opt.empty) + '</p>' : '') +
      '</div>';
    }

    /*
     * Проміжки віднімаються від САМИХ секторів, а не додаються між ними:
     * інакше сума дуг перевищила б коло й останній сектор наїхав би на
     * перший. Сектор, коротший за проміжок, лишається без нього — краще
     * тонка риска без зазору, ніж відʼємна довжина.
     */
    let offset = 0;
    const arcs = raw.map(function (s, i) {
      const frac = s.value / total;
      const len = frac * C;
      const draw = Math.max(0.4, len - (len > GAP * 2 ? GAP : 0));
      const el =
        '<circle class="donut__slice ' + esc(s.cls) + '"' +
          ' cx="' + CX + '" cy="' + CY + '" r="' + R + '"' +
          ' fill="none" stroke-width="' + W + '" stroke-linecap="butt"' +
          ' stroke-dasharray="' + draw.toFixed(2) + ' ' + (C - draw).toFixed(2) + '"' +
          ' stroke-dashoffset="' + (-offset).toFixed(2) + '"' +
          ' data-dash="' + draw.toFixed(2) + ' ' + (C - draw).toFixed(2) + '"' +
          ' style="--i:' + i + '">' +
          '<title>' + esc(s.title || (s.label + ' — ' + Math.round(frac * 100) + '%')) + '</title>' +
        '</circle>';
      offset += len;
      return el;
    }).join('');

    /* Поворот на −90°: без нього перший сектор починається о третій
       годині, а очікується о дванадцятій. Крутиться ГРУПА, а не кожне
       коло: інакше поворот довелося б повторювати в кожному <circle>, і
       наведення з transform на секторі конфліктувало б із ним. */
    return '<div class="donut">' +
      '<svg class="donut__svg" viewBox="0 0 ' + VB + ' ' + VB + '" role="img" aria-label="' +
        esc(opt.label || 'Склад') + '">' +
        '<circle class="donut__track" cx="' + CX + '" cy="' + CY + '" r="' + R +
          '" fill="none" stroke-width="' + W + '"/>' +
        '<g class="donut__ring" transform="rotate(-90 ' + CX + ' ' + CY + ')">' + arcs + '</g>' +
      '</svg>' +
      (opt.center
        ? '<div class="donut__mid" aria-hidden="true">' +
            '<b class="donut__val mono">' + esc(opt.center) + '</b>' +
            (opt.sub ? '<span class="donut__sub">' + esc(opt.sub) + '</span>' : '') +
          '</div>'
        : '') +
    '</div>';
  }

  /**
   * Розгортання секторів після вставки в документ.
   *
   * Розмітка вже містить КІНЦЕВІ значення — тобто без цього виклику
   * діаграма просто стоїть намальованою. Анімація робиться навпаки:
   * спершу схлопуємо всі сектори в нуль, віддаємо браузеру кадр на
   * перерахунок, потім повертаємо збережені в data-dash значення, і
   * transition у CSS розгортає кільце. Так статична розмітка лишається
   * правдивою сама по собі, а не залежить від того, чи піднявся скрипт.
   */
  function animate(root) {
    if (!root) return;
    const slices = root.querySelectorAll('.donut__slice[data-dash]');
    if (!slices.length) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    slices.forEach(function (s) { s.style.strokeDasharray = '0 ' + C.toFixed(2); });
    /* Два кадри, а не один: після першого стиль ще може не долетіти до
       обчисленого значення, і браузер склеїть обидві правки в одну — без
       переходу. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        slices.forEach(function (s) { s.style.strokeDasharray = s.getAttribute('data-dash'); });
      });
    });
  }

  window.Donut = { html: html, animate: animate, C: C, R: R, W: W };
})();
