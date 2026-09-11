/**
 * НИЖНЯ ПАНЕЛЬ РОЗДІЛІВ: скло, плашка активного, лінза під пальцем.
 *
 * Візуал і виміри — з готового пакета власника (liquid-glass/tabbar),
 * знятого піксельно зі скріншота iOS. Оптику дає js/liquid-glass.js.
 * Тут — поведінка, і вона в Get Stronger ІНША, ніж у пакеті.
 *
 * ГОЛОВНА ВІДМІННІСТЬ: ПУНКТИ — ЦЕ ПОСИЛАННЯ, А НЕ ВКЛАДКИ.
 *
 * У пакеті пункти — <button>, і вибір міняє стан усередині однієї
 * сторінки. У Get Stronger кожен розділ — окрема сторінка, тож пункт мусить
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
 * лінзи двома шарами-двійниками з взаємодоповняльними клопами. У Get Stronger
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
    var closeTimer = null, sx = 1, sy = 1;
    /* dir: −1 ліворуч, +1 праворуч, 0 стоїть. curS: поточне розтягнення.
       pendingX: остання позиція пальця, ще не намальована. */
    var dir = 0, curS = 0, pendingX = null, raf = 0;

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
      return true;
    }

    /*
     * СКЛО БУДУЄТЬСЯ НА ПЕРШИЙ ДОТИК, А НЕ НА ЗАВАНТАЖЕННІ.
     *
     * Ціна побудови — canvas на кілька тисяч пікселів, toDataURL і
     * SVG-фільтр у документі. Але дорожче інше: шість шарів лінзи, з яких
     * два несуть власний backdrop-filter (один із них — SVG-фільтр
     * зміщення, найдорожчий вид backdrop-filter узагалі). Вони висіли на
     * КОЖНІЙ сторінці з першої секунди, хоч лінзу видно лише поки палець
     * на панелі.
     *
     * Тепер до першого дотику панель — звичайна скляна капсула, і на
     * прокрутці телефон малює один backdrop-filter замість трьох.
     * Побудова на pointerdown встигає до першого руху пальця: карта
     * розміром 116×75 будується за одиниці мілісекунд і далі кешується
     * (див. mapCache у js/liquid-glass.js).
     */
    function ensureGlass() {
      if (glass || !window.LiquidGlass) return;
      var h = lens.getBoundingClientRect().height;
      if (!h) return;
      var o = { radius: h / 2 };
      for (var k in LENS) o[k] = LENS[k];
      glass = window.LiquidGlass.attach(lens, o);
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

    /*
     * ПІД ПАЛЬЦЕМ ЛІНЗА ЙДЕ БЕЗ ПЕРЕХОДУ — і це головне в цьому файлі.
     *
     * Перша збірка малювала кожен рух із CSS-переходом 0,42 с. Виглядало
     * це так, ніби лінза не їде за пальцем, а НАЗДОГАНЯЄ його: палець уже
     * над сусіднім розділом, а скло десь позаду. На екрані 120 Гц це ще
     * можна прийняти за «плавність», на звичайному телефоні це просто
     * гальмує, і рухати лінзу довільно вліво-вправо неможливо.
     *
     * Тому перехід лишається тільки там, де він і має бути: доїзд до
     * найближчого пункту після відпускання й згасання. Живий рух —
     * завжди 1:1 із пальцем.
     */
    function paintLens(animate) {
      lens.style.transition = animate ? '' : 'none';
      var open = lensX != null;
      var x = (open ? lensX : centerOf(selected)) - lensW / 2;
      var s = open ? 1 : 0.86;
      /*
       * ТОЧКА ОПОРИ — НА ПЕРЕДНЬОМУ КРАЇ, тобто розтягнення виходить
       * НАЗАД, за рухом.
       *
       * Спершу тут стояло symmetric scale від центру. Формально це теж
       * «розтягнення», але воно однакове в обидва боки — і рух ліворуч
       * виглядав точно так само, як рух праворуч. Око читає таку
       * деформацію як пульсацію на місці, а не як інерцію: краплю, яку
       * тягнуть, розтягує ПОЗАДУ, бо задній край відстає.
       *
       * transform-origin впливає лише на scale, не на translate, тож
       * центр лінзи як стояв під пальцем, так і стоїть — назад виїжджає
       * тільки надлишок довжини.
       */
      lens.style.transformOrigin =
        dir > 0 ? '100% 50%' : (dir < 0 ? '0% 50%' : '50% 50%');
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

    /*
     * ФОРМА ЛІНЗИ ЗАЛЕЖИТЬ ВІД ШВИДКОСТІ Й НАПРЯМКУ, А НЕ ВІД ПЕРЕТИНУ МЕЖІ.
     *
     * Було: на кожному перетині межі пункту вмикалось фіксоване
     * розтягнення на 170 мс. Це «анімація події», і вона однакова
     * незалежно від того, куди й як швидко їде палець, — тому рух
     * праворуч і рух ліворуч виглядали ідентично, а повільний протяг
     * смикався так само, як різкий.
     *
     * Стало: розтягнення пропорційне тому, наскільки лінза встигла
     * проїхати за КАДР, і виходить назад за рухом. Повільно ведеш —
     * форма майже не міняється; смикнув — крапля витягується й сама
     * стягується назад, коли палець зупинився. Ніяких таймерів: усе
     * зникає само, бо швидкість падає до нуля.
     *
     * MAX_S = 0.10 — стеля розтягнення. Вище скло починає ловити на собі
     * власний фільтр і виглядає гумовим, а не рідким.
     */
    var MAX_S = 0.10;

    function shape(dxPerFrame) {
      var was = dir;
      if (Math.abs(dxPerFrame) > 0.4) dir = dxPerFrame > 0 ? 1 : -1;
      /* Зміна напрямку скидає накопичену форму: інакше крапля, витягнута
         вправо, стрибком перевертається опорою вліво, і це видно як ривок. */
      if (was && dir && was !== dir) curS = 0;
      var target = Math.min(MAX_S, Math.abs(dxPerFrame) / 90);
      /* Наростає швидко, спадає повільніше — так поводиться інерція. */
      curS += (target - curS) * (target > curS ? 0.5 : 0.16);
      if (curS < 0.002) curS = 0;
      sx = 1 + curS;
      sy = 1 - curS * 0.7;
    }

    function moveTo(x, animate) {
      /* Центр лінзи ходить лише між центрами крайніх пунктів. Сама лінза
         ширша за пункт, тож над крайнім вона законно вилазить за край
         панелі — так і в оригіналі. */
      var next = Math.max(centerOf(0), Math.min(centerOf(items.length - 1), x));
      if (animate === true) { dir = 0; curS = 0; sx = 1; sy = 1; }
      else shape(lensX == null ? 0 : next - lensX);
      lensX = next;
      /* animate: під пальцем false (рух 1:1), на фокусі з клавіатури true
         (там стрибок без переходу виглядав би як миготіння). */
      paintLens(animate === true); paintPill(); mark();
    }

    /*
     * МАЛЮЄМО РАЗ НА КАДР, А НЕ РАЗ НА ПОДІЮ.
     *
     * pointermove на сучасному екрані шле до 120 подій за секунду, а
     * малює браузер 60. Без цього циклу половина обчислень і записів у
     * стиль викидалась би, а головне — «швидкість за подію» залежала б
     * від частоти опитування сенсора, тобто форма лінзи на різних
     * телефонах виходила б різною.
     *
     * ЦИКЛ ЖИВЕ, ДОКИ ТРИВАЄ ПРОТЯГ, а не доки надходять події — і це не
     * дрібниця. Коли палець зупинився й стоїть, подій немає, але форма
     * мусить стягнутись назад. Перша версія планувала наступний кадр
     * лише після обробки нової позиції, тож на зупинці цикл помирав, і
     * лінза лишалась витягнутою доти, доки палець не рушить знову.
     */
    function pump() {
      if (!dragging) { raf = 0; return; }
      if (pendingX != null) {
        var x = pendingX;
        pendingX = null;
        moveTo(x, false);
      } else if (curS > 0) {
        /* Подій немає — швидкість нульова: форма розпрямляється сама. */
        shape(0);
        paintLens(false);
      }
      raf = requestAnimationFrame(pump);
    }

    function startPump() { if (!raf) raf = requestAnimationFrame(pump); }

    function stopPump() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; pendingX = null;
    }

    function queue(x) { pendingX = x; startPump(); }

    var localX = function (ev) { return ev.clientX - bar.getBoundingClientRect().left; };

    bar.addEventListener('pointerdown', function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      clearTimeout(closeTimer);
      ensureGlass();
      dragging = true; moved = false; startX = ev.clientX;
      dir = 0; curS = 0;
      moveTo(localX(ev), false);
      startPump();
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
      queue(localX(ev));
    });

    function release(ev) {
      if (!dragging) return;
      dragging = false;
      stopPump();
      /* Форма розпрямляється разом із доїздом: лишити витягнуту краплю
         на місці, куди вона щойно приїхала, було б видно як застиглий
         ривок. */
      dir = 0; curS = 0; sx = 1; sy = 1;
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
      dragging = false; moved = false; stopPump();
      dir = 0; curS = 0; sx = 1; sy = 1;
      close();
    });
    /*
     * Втрата захоплення = кінець жесту. Без цього після системного
     * перехоплення лишався б dragging: true, і наступний дотик по
     * сусідньому розділу читався б як продовження протягу.
     *
     * ПЕРЕВІРКА target ОБОВʼЯЗКОВА — без неї жест ламався на ПЕРШОМУ Ж
     * русі пальця, і саме так воно й було в першій збірці.
     *
     * У дотику браузер дає НЕЯВНЕ захоплення: усі події цього пальця
     * йдуть у той елемент, на якому сталось torkання, тобто в <a>. Коли
     * ми на восьмому пікселі беремо захоплення собі (на панель), <a> своє
     * втрачає — і браузер шле lostpointercapture. Ця подія СПЛИВАЄ, тож
     * приходить на панель, і обробник глушив рівно той жест, який щойно
     * почався. На миші цього не видно взагалі: там неявного захоплення
     * немає, і подія не виникає.
     */
    bar.addEventListener('lostpointercapture', function (ev) {
      if (ev.target !== bar) return;
      if (dragging) {
        dragging = false; moved = false; stopPump();
        dir = 0; curS = 0; sx = 1; sy = 1;
        close();
      }
    });

    /* Клавіатура: лінза йде за фокусом, перехід робить сам <a> по Enter. */
    items.forEach(function (a, i) {
      a.addEventListener('focus', function () {
        clearTimeout(closeTimer); ensureGlass(); moveTo(centerOf(i), true);
      });
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
