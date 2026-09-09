/*!
 * liquid-glass.js — «рідке скло» iOS: заломлення й збільшення фону
 * будь-якою формою. Використовується нижньою панеллю розділів на
 * телефоні (js/tabbar-glass.js), більше ніде.
 *
 * ЗВІДКИ ЦЕ. Файл прийшов готовим пакетом від власника проєкту
 * (liquid-glass/src/liquid-glass.js) і вставлений майже без змін —
 * навмисно. Це не бізнес-логіка Forge, а оптика: у ній є формула карти
 * зміщення, підібраний профіль фаски й точний scale фільтра. Переписати
 * її «під свій стиль» означало б переписати математику, у якій кожне
 * число вивірене; правки звелися б до косметики й ризику.
 *
 * ЯК ЦЕ ПРАЦЮЄ, КОРОТКО. На <canvas> малюється карта зміщення: у канал R
 * пишеться зсув по X, у G — по Y, 128 = нуль. Карта віддається в
 * feDisplacementMap через feImage (data-URL), а весь фільтр вішається на
 * елемент як backdrop-filter: url(#id). У карті складені два доданки —
 * радіальне збільшення (лінза) і зсув по нормалі на фасці (заломлення
 * краю). Повний розбір математики — у README пакета, розділ 4.
 *
 * ЩО ВАЖЛИВО ЗНАТИ ПЕРЕД ВИКОРИСТАННЯМ.
 *
 * 1. BACKDROP ROOT. backdrop-filter бачить лише те, що намальовано в
 *    межах свого backdrop root, а створює його будь-який предок із
 *    filter, opacity < 1, mask, mix-blend-mode, isolation або
 *    contain: paint. Тому скляний елемент НЕ МОЖНА класти всередину
 *    іншого скляного — він заломлюватиме порожнечу. Лінза панелі лежить
 *    СУСІДОМ до самої панелі саме тому.
 *
 * 2. ПРОЗОРІСТЬ АНІМУЄТЬСЯ НА ШАРАХ, а не на склі: opacity < 1 на
 *    самому елементі робить його backdrop root посеред анімації, і
 *    заломлення блимає. transform безпечний — його немає в переліку.
 *
 * 3. SAFARI Й FIREFOX не підтримують SVG-фільтр усередині
 *    backdrop-filter. Шар заломлення там просто не малюється, лишається
 *    матова капсула з кантом. Це прийнятний фолбек, і саме тому шар
 *    винесено окремим div.
 *
 * ЩО ЗМІНЕНО ПРОТИ ПАКЕТА: нічого, крім цього коментаря. Файл лишається
 * копією, яку можна оновити з пакета одним перезаписом.
 *
 * CSP. Модуль дописує <style> у head і data-URL у feImage. Політика
 * Forge (vercel.json) це дозволяє: style-src має 'unsafe-inline',
 * img-src має data:. Скриптів модуль не створює.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LiquidGlass = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var XLINK = "http://www.w3.org/1999/xlink";

  /* ================================================================
   * 0. Чи вміє браузер SVG-фільтр усередині backdrop-filter
   * ================================================================
   * Chromium — так. Safari і Firefox — ні: там шар заломлення просто
   * не намалюється, лишиться матова форма з кантом. Це прийнятний
   * фолбек, спеціально нічого робити не треба.
   */
  var canRefract = (function () {
    try {
      return CSS.supports("backdrop-filter", "url(#a)") ||
             CSS.supports("-webkit-backdrop-filter", "url(#a)");
    } catch (e) { return false; }
  })();

  /* ================================================================
   * 1. SDF форми
   * ================================================================
   * Signed distance field заокругленого прямокутника: відʼємне значення
   * всередині, нуль на контурі, додатне зовні. Капсула — це окремий
   * випадок, де radius = min(w,h)/2. Коло — де w === h і radius = w/2.
   *
   * Замініть цю функцію — і скло набуде будь-якої іншої форми
   * (див. README, розділ «Довільна форма»).
   */
  function sdRoundRect(x, y, w, h, r) {
    var qx = Math.abs(x - w / 2) - (w / 2 - r);
    var qy = Math.abs(y - h / 2) - (h / 2 - r);
    var ax = Math.max(qx, 0), ay = Math.max(qy, 0);
    return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ax * ax + ay * ay) - r;
  }

  /* ================================================================
   * 2. Карта зміщення
   * ================================================================
   * feDisplacementMap читає R як зсув по X, G як зсув по Y, 128 = нуль.
   * У карту закодовано ДВА доданки одразу:
   *
   *   а) збільшення  — радіальний зсув до центру, пропорційний відстані.
   *      Множник (1/zoom − 1) відʼємний, тож піксель бере колір ближче
   *      до центру, і зображення розтягується назовні. Це і є лінза.
   *
   *   б) заломлення  — зсув по зовнішній нормалі на фасці, з профілем
   *      s / sqrt(1 − k·s²), де s = 1 на канті й 0 на глибині bevel.
   *      Профіль імітує чвертькруглий край скла: біля самого канта
   *      нахил поверхні прямує до вертикалі й промінь відхиляється різко.
   *
   * Зсуви зберігаються в АБСОЛЮТНИХ пікселях, нормовані на maxOff.
   * scale фільтра підбирається так, щоб вони повернулися один в один.
   */
  var PROFILE_K = 0.92;                       // різкість фаски, 0…0.99
  var PROFILE_NORM = 1 / Math.sqrt(1 - PROFILE_K);
  var mapCache = Object.create(null);

  function buildMap(w, h, radius, bevel, refraction, zoom, sdf) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    var r = Math.min(radius, w / 2, h / 2);
    var bev = Math.max(2, Math.min(bevel, Math.min(w, h) / 2 - 1));
    var sd = sdf || sdRoundRect;

    var key = [w, h, r.toFixed(2), bev.toFixed(2), refraction.toFixed(2),
               zoom.toFixed(4), sd === sdRoundRect ? "rr" : "custom"].join(":");
    if (mapCache[key]) return mapCache[key];

    var zf = 1 / zoom - 1;                                  // відʼємний → збільшує
    var maxOff = refraction + Math.max(w, h) / 2 * Math.abs(zf) + 1;

    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    var img = ctx.createImageData(w, h);
    var d = img.data;
    var cx = w / 2, cy = h / 2;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var px = x + 0.5, py = y + 0.5, i = (y * w + x) * 4;
        d[i + 2] = 128; d[i + 3] = 255;                     // B і A не використовуються

        var dist = sd(px, py, w, h, r);
        if (dist > 0) { d[i] = 128; d[i + 1] = 128; continue; }   // зовні — нейтраль

        // зовнішня нормаль через скінченні різниці по SDF
        var nx = sd(px + 1, py, w, h, r) - sd(px - 1, py, w, h, r);
        var ny = sd(px, py + 1, w, h, r) - sd(px, py - 1, w, h, r);
        var len = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= len; ny /= len;

        var s = 1 - Math.min(1, -dist / bev);               // 1 на канті → 0 углиб
        var edge = (s / Math.sqrt(1 - PROFILE_K * s * s)) / PROFILE_NORM * refraction;

        var ox = nx * edge + (px - cx) * zf;
        var oy = ny * edge + (py - cy) * zf;

        d[i]     = 128 + Math.max(-127, Math.min(127, Math.round(ox / maxOff * 127)));
        d[i + 1] = 128 + Math.max(-127, Math.min(127, Math.round(oy / maxOff * 127)));
      }
    }
    ctx.putImageData(img, 0, 0);

    /* Зсув, який дає фільтр: scale · (C − 0.5), де C = (128 + v)/255.
       Отже scale · v/255. Хочемо отримати назад ox = maxOff · v/127,
       тому scale = maxOff · 255/127. */
    var out = { url: cv.toDataURL(), scale: maxOff * 255 / 127 };
    mapCache[key] = out;
    return out;
  }

  /* ================================================================
   * 3. SVG-фільтр
   * ================================================================
   * feImage підвантажує карту як data-URL, три feDisplacementMap
   * зі злегка різним scale дають дисперсію (кольорову облямівку),
   * feColorMatrix лишає по одному каналу, два feBlend screen збирають
   * назад. При dispersion = 0 усі три однакові й screen-змішування
   * чистих R+G+B відновлює оригінал точно.
   */
  var host = null;
  function filterHost() {
    if (!host) {
      host = document.createElementNS(SVGNS, "svg");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText =
        "position:fixed;width:0;height:0;overflow:hidden;pointer-events:none";
      document.body.appendChild(host);
    }
    return host;
  }

  var CH = {
    R: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
    G: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
    B: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
  };

  function svg(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  var uid = 0;
  function makeFilter() {
    var id = "lg-" + (++uid) + "-" + Math.random().toString(36).slice(2, 7);
    var f = svg("filter", {
      id: id,
      filterUnits: "userSpaceOnUse",
      primitiveUnits: "userSpaceOnUse",
      "color-interpolation-filters": "sRGB",
      x: 0, y: 0, width: 10, height: 10
    });
    var image = svg("feImage", {
      result: "map", preserveAspectRatio: "none", x: 0, y: 0, width: 10, height: 10
    });
    f.appendChild(image);

    var disp = {};
    ["R", "G", "B"].forEach(function (c) {
      disp[c] = svg("feDisplacementMap", {
        in: "SourceGraphic", in2: "map", scale: 0,
        xChannelSelector: "R", yChannelSelector: "G", result: "d" + c
      });
      f.appendChild(disp[c]);
      f.appendChild(svg("feColorMatrix", {
        in: "d" + c, type: "matrix", values: CH[c], result: "c" + c
      }));
    });
    f.appendChild(svg("feBlend", { in: "cR", in2: "cG", mode: "screen", result: "cRG" }));
    f.appendChild(svg("feBlend", { in: "cRG", in2: "cB", mode: "screen" }));

    filterHost().appendChild(f);
    return { id: id, node: f, image: image, disp: disp };
  }

  /* ================================================================
   * 4. Шість шарів матеріалу
   * ================================================================ */
  var STYLE_ID = "liquid-glass-style";
  var CSS_TEXT = [
    ".lg-l{position:absolute;inset:0;border-radius:inherit;pointer-events:none}",
    ".lg-blur{-webkit-backdrop-filter:var(--lg-bd);backdrop-filter:var(--lg-bd)}",
    ".lg-tint{background:",
      "linear-gradient(var(--lg-light),rgba(255,255,255,var(--lg-tint-hi)) 0%,rgba(255,255,255,0) 44%),",
      "rgba(255,255,255,var(--lg-tint))}",
    ".lg-body{box-shadow:",
      "inset 0 0 var(--lg-wall) calc(var(--lg-wall) * -0.34) rgba(0,0,0,.55),",
      "inset 0 1.2px .4px rgba(255,255,255,calc(var(--lg-spec) * .5)),",
      "inset 0 -1.6px 1.2px rgba(255,255,255,calc(var(--lg-spec) * .26))}",
    ".lg-gloss{background:radial-gradient(115% 85% at 30% -26%,",
      "rgba(255,255,255,calc(var(--lg-spec) * .22)) 0%,rgba(255,255,255,0) 56%)}",
    ".lg-edge{padding:var(--lg-edge-w);background:linear-gradient(var(--lg-light),",
      "rgba(255,255,255,calc(var(--lg-spec) * 1)) 0%,",
      "rgba(255,255,255,calc(var(--lg-spec) * .30)) 24%,",
      "rgba(255,255,255,calc(var(--lg-spec) * .14)) 48%,",
      "rgba(255,255,255,calc(var(--lg-spec) * .46)) 72%,",
      "rgba(255,255,255,calc(var(--lg-spec) * .92)) 100%);",
      "-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);",
      "mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);",
      "-webkit-mask-composite:xor;mask-composite:exclude}",
    ".lg-content{position:relative;z-index:10}"
  ].join("");

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = CSS_TEXT;
    document.head.appendChild(st);
  }

  /* ================================================================
   * 5. Публічний API
   * ================================================================ */
  var DEFAULTS = {
    radius: null,       // null → капсула: min(w,h)/2
    bevel: 20,          // px, глибина скла по краю
    refraction: 30,     // px, максимальний зсув фону на канті
    zoom: 1.07,         // оптична сила лінзи
    blur: 0.4,          // px, розсіювання
    saturate: 1.12,     // множник насиченості бекдропу
    brightness: 1.16,   // множник яскравості бекдропу
    tint: 0.04,         // 0…1, білого підмішано в скло
    specular: 0.92,     // 0…1, яскравість канта й полиску
    dispersion: 0,      // 0…0.03, розбіг scale між каналами
    edgeWidth: 1.2,     // px, товщина канта
    lightAngle: 168,    // deg, звідки світло — один кут на весь інтерфейс
    sdf: null,          // власна функція форми (x,y,w,h,r) → signed distance
    wrapContent: true   // перенести наявних дітей у .lg-content (z-index вище шарів)
  };

  function attach(el, options) {
    ensureStyle();
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    for (var k2 in (options || {})) o[k2] = options[k2];

    var content = null;
    if (o.wrapContent && el.childNodes.length) {
      content = document.createElement("div");
      content.className = "lg-content";
      while (el.firstChild) content.appendChild(el.firstChild);
      el.appendChild(content);
    }

    el.classList.add("lg-root");
    /* Шари абсолютні, тож елемент має бути позиційованим. Але НЕ через CSS:
       правило .lg-root{position:relative} перебило б авторський
       position:absolute, бо стиль модуля додається в head пізніше.
       Тому дивимось обчислений стиль і чіпаємо лише static. */
    if (getComputedStyle(el).position === "static") el.style.position = "relative";

    /* Порядок у DOM критичний і саме такий:
       blur → refract → tint → body → gloss → edge → content.
       refract читає бекдроп ПІСЛЯ blur, тобто заломлює вже розмите —
       так менше артефактів на краю. Контент іде останнім, щоб не
       потрапити під власне заломлення. */
    var names = ["blur", "refract", "tint", "body", "gloss", "edge"];
    var layers = {};
    names.forEach(function (n) {
      var div = document.createElement("div");
      div.className = "lg-l lg-" + n;
      if (content) el.insertBefore(div, content);
      else el.appendChild(div);
      layers[n] = div;
    });

    var f = makeFilter();
    var w = 0, h = 0, mapUrl = "";

    function render() {
      var box = el.getBoundingClientRect();
      var nw = Math.round(box.width), nh = Math.round(box.height);
      if (!nw || !nh) return;

      if (nw !== w || nh !== h) {
        w = nw; h = nh;
        f.node.setAttribute("width", w);
        f.node.setAttribute("height", h);
        f.image.setAttribute("width", w);
        f.image.setAttribute("height", h);
      }

      var r = o.radius == null ? Math.min(w, h) / 2 : o.radius;
      var m = buildMap(w, h, r, o.bevel, o.refraction, o.zoom, o.sdf);
      if (m.url !== mapUrl) {
        mapUrl = m.url;
        f.image.setAttributeNS(XLINK, "xlink:href", m.url);
        f.image.setAttribute("href", m.url);
      }
      f.disp.R.setAttribute("scale", m.scale * (1 + o.dispersion));
      f.disp.G.setAttribute("scale", m.scale);
      f.disp.B.setAttribute("scale", m.scale * (1 - o.dispersion));

      var s = el.style;
      s.setProperty("--lg-bd", "blur(" + o.blur + "px) saturate(" +
        (o.saturate * 100) + "%) brightness(" + o.brightness + ")");
      s.setProperty("--lg-tint", o.tint);
      s.setProperty("--lg-tint-hi", o.tint * 1.9);
      s.setProperty("--lg-spec", o.specular);
      s.setProperty("--lg-wall", Math.max(5, o.bevel * 0.55) + "px");
      s.setProperty("--lg-edge-w", o.edgeWidth + "px");
      s.setProperty("--lg-light", o.lightAngle + "deg");

      if (canRefract) {
        layers.refract.style.backdropFilter = "url(#" + f.id + ")";
        layers.refract.style.webkitBackdropFilter = "url(#" + f.id + ")";
      }
    }

    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(render);
      ro.observe(el);
    }
    render();

    return {
      el: el,
      filterId: f.id,
      get options() { return o; },
      update: function (patch) {
        for (var k3 in (patch || {})) o[k3] = patch[k3];
        render();
        return this;
      },
      /** Поточна карта як data-URL — зручно для налагодження. */
      debugMap: function () {
        var r = o.radius == null ? Math.min(w, h) / 2 : o.radius;
        return buildMap(w, h, r, o.bevel, o.refraction, o.zoom, o.sdf).url;
      },
      destroy: function () {
        if (ro) ro.disconnect();
        names.forEach(function (n) { layers[n].remove(); });
        f.node.remove();
        el.classList.remove("lg-root");
      }
    };
  }

  return {
    attach: attach,
    buildMap: buildMap,
    sdRoundRect: sdRoundRect,
    canRefract: canRefract,
    DEFAULTS: DEFAULTS
  };
});
