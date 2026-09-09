/**
 * НИЖНЯ ПАНЕЛЬ РОЗДІЛІВ: скло, плашка активного, лінза під пальцем.
 *
 * Візуал і виміри — з готового пакета власника (liquid-glass/tabbar),
 * знятого піксельно зі скріншота iOS. Оптику дає js/liquid-glass.js.
 * Тут — поведінка, і вона в Forge ІНША, ніж у пакеті.
 *
 * ГОЛОВНА ВІДМІННІСТЬ: ПУНКТИ — ЦЕ ПОСИЛАННЯ, А НЕ ВКЛАДКИ.
 *
 * У пакеті пункти — <button>, і вибір міняє стан усередині однієї
 * сторінки. У Forge кожен розділ — окрема сторінка, тож пункт мусить
 * лишитись <a href>: інакше зникає все, що дає посилання — відкрити в
 * новій вкладці, скопіювати адресу, побачити її в рядку стану, дійти
 * туди з клавіатури, знайти пошуковиком. Підміняти це обробником кліку
 * заради анімації — поганий обмін.
 *
 * Тому жест накладений ПОВЕРХ посилань, а не замість них:
 *
 *   короткий дотик  → нічого не перехоплюємо, спрацьовує сам <a>;
 *   протяг          → лінза їде за пальцем, на відпусканні переходимо
 *                     в найближчий розділ і гасимо клік, що йшов слідом.
 *
 * Поріг протягу — 8 px: менший приймав би за жест звичайне тремтіння
 * пальця на дотику, і людина потрапляла б не туди, куди цілилась.
 *
 * ЛІНЗА — СУСІД ПАНЕЛІ, а не її дитина. Панель має власний
 * backdrop-filter, тобто вона backdrop root для своїх дітей, і лінза
 * всередині заломлювала б порожнечу (див. коментар у js/liquid-glass.js).
 *
 * ЧОМУ БЕЗ АКЦЕНТНОГО ШАРУ ПАКЕТА. Там колір обрізається по контуру
 * лінзи двома шарами-двійниками з взаємодоповняльними клопами. У Forge
 * діє правило «колір позначає дані й стан, а не хром»: панель
 * навігації лишається монохромною, активний розділ підсвічується тим
 * самим --acc-ink, що й решта активних станів сайту. Без кольору
 * двійники не потрібні взагалі — пункти малюють себе самі, і зникає
 * цілий клас помилок із подвоєним антиаліасингом гліфів.
 */
(function () {
  'use strict';

  /* Параметри скла лінзи з пакета: підібрані під висоту 75 px. Якщо
     міняється --tb-h або --tb-lens-oy, bevel і refraction треба
     масштабувати пропорційно. zoom вище 1.1 мазав би підпис у 10.5px:
     фільтр ресемплить уже растеризовані пікселі, а не малює гліфи наново. */
  var LENS = {
    bevel: 20, refraction: 30, zoom: 1.07,
    blur: 0.4, tint: 0.04, specular: 0.92,
    dispersion: 0, edgeWidth: 1.2,
    wrapContent: false
  };

  var DRAG_PX = 8;

  function px(el, name) {
    return parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;
  }

  function init(zone) {
    var bar = zone.querySelector('.tabbar__bar');
    if (!bar || zone.dataset.glass === '1') return null;
    var items = Array.prototype.slice.call(bar.querySelectorAll('.tabbar__item'));
    if (!items.length) return null;
    zone.dataset.glass = '1';
    zone.style.setProperty('--tb-n', items.length);

    var selected = Math.max(0, items.indexOf(
      items.filter(function (a) { return a.classList.contains('is-active'); })[0]));

    /* Плашка й лінза створюються тут, а не в розмітці: це декорації, і
       в HTML вони були б двома порожніми div без сенсу. */
    var pill = document.createElement('div');
    pill.className = 'tabbar__pill';
    pill.setAttribute('aria-hidden', 'true');
    bar.insertBefore(pill, bar.firstChild);

    var lens = document.createElement('div');
    lens.className = 'tabbar__lens';
    lens.setAttribute('aria-hidden', 'true');
    zone.appendChild(lens);

    var glass = null, pad = 0, itemW = 0, lensW = 0, K = 0;
    var lensX = null, dragging = false, moved = false, startX = 0;
    var closeTimer = null, stretchTimer = null, sx = 1, sy = 1;

    function measure() {
      var w = bar.getBoundingClientRect().width;
      if (!w) return false;
      pad = px(zone, '--tb-pad');
      K = px(zone, '--tb-pill-k');
      itemW = (w - pad * 2) / items.length;
      lensW = itemW + px(zone, '--tb-lens-ox') * 2;
      /* Плашка концентрична капсулі панелі: її радіус — половина висоти,
         тож зменшена на 2K капсула є рівно контуром панелі, зміщеним
         усередину на K. Зазор виходить однаковий і на прямих, і на дугах.
         Панель уже має власний падінг, тому віднімається (K − pad). */
      pill.style.width = (itemW - (K - pad) * 2) + 'px';
      lens.style.width = lensW + 'px';

      if (!glass && window.LiquidGlass) {
        var h = lens.getBoundingClientRect().height;
        if (h) {
          var o = { radius: h / 2 };
          for (var k in LENS) o[k] = LENS[k];
          glass = window.LiquidGlass.attach(lens, o);
        }
      }
      return true;
    }

    function centerOf(i) { return pad + itemW * (i + 0.5); }

    function nearest(x) {
      var best = 0, bd = Infinity;
      for (var i = 0; i < items.length; i++) {
        var d = Math.abs(centerOf(i) - x);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    function paintLens(animate) {
      lens.style.transition = animate === false ? 'none' : '';
      var open = lensX != null;
      var x = (open ? lensX : centerOf(selected)) - lensW / 2;
      var s = open ? 1 : 0.86;
      lens.style.transform =
        'translate3d(' + x + 'px,0,0) scale(' + (s * sx) + ',' + (s * sy) + ')';
      lens.classList.toggle('is-open', open);
    }

    function paintPill() {
      pill.style.transform = 'translateX(' + (K + itemW * selected) + 'px)';
      pill.style.opacity = lensX == null ? '1' : '0';
    }

    function mark() {
      var lit = lensX == null ? selected : nearest(lensX);
      items.forEach(function (a, i) {
        a.classList.toggle('is-lit', i === lit && lensX != null);
      });
    }

    /* Коротке розтягнення на переїзді — те, від чого рух читається як
       рідкий, а не як переставляння плитки. 170 мс: довше вже помітно
       як окрема анімація. */
    function stretch() {
      clearTimeout(stretchTimer);
      sx = 1.05; sy = 0.95; paintLens(true);
      stretchTimer = setTimeout(function () { sx = 1; sy = 1; paintLens(true); }, 170);
    }

    function moveTo(x) {
      var before = lensX == null ? -1 : nearest(lensX);
      /* Центр лінзи ходить лише між центрами крайніх пунктів. Сама лінза
         ширша за пункт, тож над крайнім вона законно вилазить за край
         панелі — так і в оригіналі. */
      lensX = Math.max(centerOf(0), Math.min(centerOf(items.length - 1), x));
      var after = nearest(lensX);
      paintLens(true); paintPill(); mark();
      if (before !== -1 && before !== after) stretch();
    }

    function close() { lensX = null; paintLens(true); paintPill(); mark(); }

    var localX = function (ev) { return ev.clientX - bar.getBoundingClientRect().left; };

    bar.addEventListener('pointerdown', function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      clearTimeout(closeTimer);
      dragging = true; moved = false; startX = ev.clientX;
      moveTo(localX(ev));
      /*
       * НІ preventDefault, НІ setPointerCapture на цьому етапі — і те, й
       * те ламає звичайний дотик по посиланню.
       *
       * setPointerCapture перенаправляє наступні події вказівника на
       * елемент, що захопив: pointerup прилітає вже в <nav>, і клік
       * браузер дає теж по <nav>, а не по <a>. Посилання при цьому
       * виглядає справним і мовчки нікуди не веде — рівно те, що й
       * сталось на першій же перевірці. Тому захоплення вмикається
       * ЛІНИВО, у pointermove, коли протяг уже визнано протягом.
       */
    });

    bar.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      if (!moved && Math.abs(ev.clientX - startX) > DRAG_PX) {
        moved = true;
        /* Тепер захоплення доречне: палець уже поїхав, кліку не буде, а
           вести лінзу треба й за межами панелі. */
        if (bar.setPointerCapture) { try { bar.setPointerCapture(ev.pointerId); } catch (e) {} }
      }
      moveTo(localX(ev));
    });

    function release(ev) {
      if (!dragging) return;
      dragging = false;
      var i = nearest(lensX == null ? centerOf(selected) : lensX);
      lensX = centerOf(i);
      paintLens(true); mark();
      closeTimer = setTimeout(close, 180);

      if (!moved) return;                 // звичайний дотик — хай працює <a>
      /* Протяг закінчився: ведемо самі й гасимо клік, який браузер
         зараз надішле по пункту, де палець відпущено. Без цього вийшов
         би подвійний перехід — у пункт під пальцем і в найближчий. */
      suppressClick();
      if (i !== selected) {
        selected = i;
        paintPill();
        var href = items[i].getAttribute('href');
        if (href) window.location.href = href;
      }
      if (ev) ev.preventDefault();
    }

    function suppressClick() {
      var kill = function (e) { e.preventDefault(); e.stopPropagation(); };
      bar.addEventListener('click', kill, true);
      setTimeout(function () { bar.removeEventListener('click', kill, true); }, 350);
    }

    bar.addEventListener('pointerup', release);
    /*
     * pointercancel прилітає, коли жест забирає браузер (прокрутка,
     * системний свайп). Лінзу гасимо, але НЕ переходимо нікуди: людина
     * жест не завершувала.
     */
    bar.addEventListener('pointercancel', function () {
      dragging = false; moved = false; close();
    });
    /* Втрата захоплення = кінець жесту. Без цього після системного
       перехоплення лишався б dragging: true, і наступний дотик по
       сусідньому розділу читався б як продовження протягу. */
    bar.addEventListener('lostpointercapture', function () {
      if (dragging) { dragging = false; moved = false; close(); }
    });

    /* Клавіатура: лінза йде за фокусом, перехід робить сам <a> по Enter. */
    items.forEach(function (a, i) {
      a.addEventListener('focus', function () { clearTimeout(closeTimer); moveTo(centerOf(i)); });
      a.addEventListener('blur', function () { if (!dragging) close(); });
    });

    function layout() {
      if (!measure()) return;
      paintLens(false); paintPill(); mark();
    }

    layout();
    if (window.ResizeObserver) new ResizeObserver(layout).observe(bar);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

    return { zone: zone, bar: bar, lens: lens, items: items, layout: layout };
  }

  window.TabBarGlass = { init: init, LENS: LENS };
})();
