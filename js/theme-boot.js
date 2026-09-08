/*
 * ЗАВАНТАЖУВАЧ ОФОРМЛЕННЯ. Виконується в <head> ДО розмітки.
 *
 * Раніше цей код лежав inline на кожній із 22 сторінок, а посилання на
 * шрифти несли onload="this.media='all'". Через них у CSP доводилось
 * тримати script-src 'unsafe-inline' — тобто політика дозволяла рівно ту
 * форму payload-а (<img src=x onerror=…>), якою підпалювався єдиний
 * знайдений XSS-синк застосунку (WEB-006 + WEB-002). Винесення в окремий
 * файл нічого не міняє для людини й прибирає 'unsafe-inline' зі script-src.
 *
 * ЧОМУ САМЕ ТУТ І БЕЗ defer. Позначка js на <html> вмикає CSS-анімацію
 * появи (без неї сторінка без JS лишилась би порожньою), а тема й схема
 * мають стояти ДО першого малювання — інакше при кожному переході блимає
 * типова графітова темна перед обраною.
 */
'use strict';
document.documentElement.className='js';
try{var _r=document.documentElement,
_m={pink:'graphite-pink',wood:'graphite',violet:'graphite-violet',crimson:'graphite-crimson',
moss:'graphite-moss',emerald:'graphite-emerald',ocean:'graphite-ocean'},
_t=localStorage.getItem('forge.theme');
_t=_m[_t]||_t;if(_t==='graphite-amber')_t='';
if(_t&&_t.indexOf('graphite')===0)_r.setAttribute('data-theme',_t);
if(localStorage.getItem('forge.scheme')==='light'){_r.setAttribute('data-scheme','light');
var _c=document.querySelector('meta[name=theme-color]');if(_c)_c.setAttribute('content','#e7e7e7');}
}catch(e){}

/*
 * Шрифти: асинхронне підвантаження без inline-обробника.
 *
 * Прийом той самий (media="print" → "all" після завантаження), але
 * перемикає його цей файл, а не атрибут onload у розмітці. Якщо стиль уже
 * встиг завантажитись до цього рядка, l.sheet уже не порожній — тоді
 * перемикаємо одразу, не чекаючи події, якої вже не буде.
 */
try {
  var _ls = document.querySelectorAll('link[rel="stylesheet"][media="print"][data-async]');
  for (var _i = 0; _i < _ls.length; _i++) {
    (function (l) {
      function on() { l.media = 'all'; }
      if (l.sheet) { on(); return; }
      l.addEventListener('load', on);
      /* Останній запобіжник: подія могла не прийти (кеш, помилка мережі). */
      window.addEventListener('load', on);
    })(_ls[_i]);
  }
} catch (e) {}
