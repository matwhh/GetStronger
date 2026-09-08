/**
 * Контекстна довідка: МЕХАНІЗМ.
 *
 * Одна кнопка в шапці на весь сайт; вміст залежить від поточної сторінки
 * (js/help-content.js). Другої системи довідки не заводиться: якщо десь
 * потрібне пояснення — воно дописується в той самий файл вмісту.
 *
 * ЧОМУ ЧИСЛА ТУТ ОБЧИСЛЮЮТЬСЯ, А НЕ ПИШУТЬСЯ. Таблиця «дія → скільки
 * ELO» виглядає як текст, але текстом бути не може: скільки коштує
 * тренування, залежить від ПЛАНУ конкретної людини. Тижневий бюджет
 * категорії ділиться на кількість запланованих днів, тож при плані 3 і
 * при плані 5 те саме тренування коштує по-різному. Написане в HTML
 * число було б правдою для одного користувача й брехнею для решти — тому
 * рядки таблиці рахує те саме ядро (js/elo-core.js), що й показує дельту
 * в тості, на тому самому конфігу, що приїхав із сервера.
 *
 * Якщо конфіг ще не завантажений (локальний режим, немає мережі), таблиця
 * чесно каже, що точних чисел зараз немає, і показує саму формулу. Копії
 * конфігу в браузері не тримається: друга копія розійшлася б із базою, і
 * довідка почала б брехати рівно тоді, коли баланс змінять.
 *
 * ДОСТУПНІСТЬ. Вікно справді модальне: фокус переводиться всередину,
 * Tab із нього не виходить, Escape закриває, клік по підкладці закриває,
 * фон не прокручується, а після закриття фокус повертається на кнопку.
 */
(function () {
  'use strict';

  const A = window.App || {};
  const esc = A.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  function currentPage() {
    const f = location.pathname.split('/').pop();
    return f === '' ? 'index.html' : f;
  }

  /* ------------------------------------------------------------------ */
  /* Джерело чисел                                                       */
  /* ------------------------------------------------------------------ */

  /** Конфіг ELO з серверного стану або null. Локальної копії немає навмисно. */
  function eloConfig() {
    try {
      const st = window.EloApi && window.EloApi.cached();
      return (st && st.config) || null;
    } catch (_) { return null; }
  }

  /** Скільки тренувань на тиждень бере сервер для цієї людини. */
  function plannedDays() {
    try {
      const st = window.EloApi && window.EloApi.cached();
      const n = st && Number(st.plannedWeek);
      if (n >= 1) return n;
    } catch (_) {}
    try {
      const p = JSON.parse(localStorage.getItem('ib.profile')) || {};
      const raw = Number(p.activePlan && p.activePlan.days) || Number(p.daysPerWeek) || 3;
      return Math.max(3, Math.min(7, Math.floor(raw)));
    } catch (_) { return 3; }
  }

  const sign = (n) => (n > 0 ? '+' + n : String(n));

  /** Дельта дії через те саме ядро, яким рахує застосунок. */
  function delta(kind, payload, cfg, ctx) {
    try {
      const r = window.EloCore.actionDelta(kind, payload, cfg, ctx || {});
      return Math.round(Number(r && r.delta) || 0);
    } catch (_) { return null; }
  }

  /** Чи взагалі є де взяти конфіг: у локальному режимі рейтингу немає. */
  function eloAvailable() {
    try { return Boolean(window.EloApi && window.EloApi.available()); }
    catch (_) { return false; }
  }

  /*
   * Що казати, коли чисел немає. Два різні випадки, і плутати їх не можна:
   * у локальному режимі рейтингу НЕМАЄ взагалі, а в хмарному стан просто
   * ще не приїхав — і тоді ми його дотягуємо (див. open()).
   */
  function noCfgBlock() {
    return eloAvailable()
      ? { t: 'note', text:
          'Числа зараз тягнуться з сервера — зачекайте секунду й відкрийте ' +
          'довідку ще раз. Копії балансу в браузері свідомо немає: вона б ' +
          'розійшлася з базою при першій же зміні правил.' }
      : { t: 'note', text:
          'Рейтинг працює лише в акаунті: він рахується на сервері, і без ' +
          'входу рахувати нема кому. У локальному режимі решта Forge працює ' +
          'повністю, просто без сезону й балів.' };
  }

  /* ------------------------------------------------------------------ */
  /* Динамічні блоки                                                     */
  /* ------------------------------------------------------------------ */

  const BUILDERS = {

    /* Таблиця «дія → скільки ELO → за яких умов». */
    eloActions: function () {
      const cfg = eloConfig();
      if (!cfg) return [noCfgBlock(), { t: 'p', text:
        'Формула одна для всіх категорій: тижневий бюджет × частка категорії, ' +
        'поділені на кількість днів (для тренувань — на ваш план, для решти — ' +
        'на сім). Далі результат множиться на якість виконання від 0 до 1.' }];

      const plan = plannedDays();
      const goalSleep = 480, goalSteps = 10000, kcal = 2500, prot = 180;

      const full = {
        workout: delta('workout', { totalSets: 10, doneSets: 10 }, cfg, { plannedDays: plan }),
        meal: delta('meal', { kcal: kcal, target: kcal, protein: prot, proteinTarget: prot }, cfg),
        sleep: delta('sleep', { minutes: goalSleep, goal: goalSleep }, cfg),
        recovery: delta('recovery', { value: cfg.recoveryGoodValue }, cfg),
        activity: delta('activity', { steps: goalSteps, goal: goalSteps }, cfg)
      };
      const half = delta('workout', { totalSets: 10, doneSets: 5 }, cfg, { plannedDays: plan });
      const recFilled = delta('recovery', { value: 1 }, cfg);

      return [
        { t: 'table',
          head: ['Дія', 'Зміна ELO', 'Умова'],
          rows: [
            ['Тренування закрито повністю', sign(full.workout),
             'Усі підходи дня відмічені. Ваш план — ' + plan + ' тренувань на тиждень, ' +
             'і тижневий бюджет тренувань ділиться саме на це число.'],
            ['Тренування закрито наполовину', sign(half),
             'Нараховується ЧАСТКА: половина підходів — половина вартості дня. Драбини тут немає.'],
            ['День харчування закрито', sign(full.meal),
             'Калорії в межах цілі й білок набраний. Чим далі від цілі — тим менше, аж до майже нуля.'],
            ['Сон записано', sign(full.sleep),
             'Досягнута ваша ціль сну з «Налаштувань трекерів». Недобір зменшує суму за драбиною.'],
            ['Самопочуття відмічено', sign(recFilled),
             'Сам факт заповнення. За чесне «мені погано» бали не знімаються.'],
            ['Самопочуття ≥ ' + cfg.recoveryGoodValue, sign(full.recovery),
             'Заповнення плюс гарний стан.'],
            ['Кроки записано', sign(full.activity),
             'Досягнута ваша ціль кроків. Недобір зменшує суму за драбиною.']
          ] },
        { t: 'note', text:
          'Числа в таблиці — для ідеального виконання і для ВАШОГО плану (' + plan + '). ' +
          'Вони пораховані тим самим ядром, що нараховує бали, а не вписані в текст.' }
      ];
    },

    /* Бонуси, штрафи, стелі. */
    eloBonuses: function () {
      const cfg = eloConfig();
      if (!cfg) return [noCfgBlock()];
      const pct = Math.round(cfg.cleanThreshold * 100);
      return [
        { t: 'table',
          head: ['Що', 'Зміна ELO', 'Коли'],
          rows: [
            ['Чистий день', sign(cfg.cleanDayBonus),
             'Усі категорії дня виконані щонайменше на ' + pct + '%. У тренувальний день сюди входить і тренування.'],
            ['Чистий тиждень', sign(cfg.cleanWeekBonus),
             'План тренувань закритий повністю і закриті всі сім днів харчування.'],
            ['Пропущене тренування', String(cfg.missedWorkoutPenalty),
             'За кожне тренування, якого не вистачило до плану. Рахується в понеділок за минулий тиждень.'],
            ['Стеля дня', 'не більше ' + cfg.dayGainCap,
             'Скільки б дій ви не закрили за добу, більше за це не нарахується.'],
            ['Тижневий бюджет', 'не більше ' + cfg.weeklyBudget,
             'Стеля на весь тиждень, спільна для всіх категорій.'],
            ['Підлога сезону', 'не нижче 0',
             'Штрафи не заганяють рейтинг у мінус.'],
            ['Стеля сезону', 'не вище ' + cfg.seasonMax,
             'Максимум, якого можна досягти за сезон.']
          ] },
        { t: 'p', text:
          'Бюджет тижня розподілений між категоріями так: ' +
          Object.keys(cfg.weights).map(function (k) {
            const label = { training: 'тренування', nutrition: 'харчування', sleep: 'сон',
                            recovery: 'відновлення', activity: 'активність' }[k] || k;
            return label + ' — ' + Math.round(cfg.weights[k] * 100) + '%';
          }).join(', ') + '. Саме тому пропущене тренування коштує дорожче за пропущений день кроків.' }
      ];
    },

    /* Рівні сезону. */
    eloLevels: function () {
      const cfg = eloConfig();
      if (!cfg) return [noCfgBlock()];
      const rows = [];
      for (let i = 1; i <= cfg.levelCount; i++) {
        rows.push(['Рівень ' + i, (i - 1) * cfg.levelSize + '–' + (i * cfg.levelSize - 1) + ' ELO', '']);
      }
      rows.push(['ELITE', cfg.eliteFloor + '–' + cfg.seasonMax + ' ELO',
                 'Зона, у якій рейтинг росте найповільніше.']);
      return [
        { t: 'p', text:
          'Сезон триває три місяці й починається з нуля. ' + cfg.levelCount +
          ' рівнів по ' + cfg.levelSize + ' ELO, далі зона ELITE.' },
        { t: 'table', head: ['Рівень', 'Діапазон', ''], rows: rows }
      ];
    },

    /* Тиждень і Grace. */
    eloWeek: function () {
      const cfg = eloConfig();
      if (!cfg) return [noCfgBlock()];
      return [
        { t: 'p', text:
          'Тиждень оцінюється в понеділок за попередній — але не одразу: ' +
          'спершу минає вікно подання (' + cfg.submitWindowDays + ' дні), щоб недільне ' +
          'тренування, записане в понеділок уранці, встигло зарахуватись.' },
        { t: 'list', items: [
          'Оцінка порівнює кількість зроблених тренувань із вашим планом на той тиждень. План фіксується знімком на початку тижня — змінити його заднім числом не вийде.',
          'Тиждень, у якому ви приєднались, питає не за весь тиждень: очікувана кількість зменшується пропорційно доступним дням.',
          'Grace Week — ' + cfg.graceWeeksPerSeason + ' на сезон, по ' + cfg.graceDays + ' днів. ' +
            'Увімкнена пауза знімає штраф за пропуски, але й нарахування за тренування в ці дні теж не буде.'
        ] },
        { t: 'note', text:
          'Дельта в журналі — це те, на скільки рейтинг СПРАВДІ змінився. ' +
          'Якщо у вас 0 ELO, штраф −' + Math.abs(cfg.missedWorkoutPenalty) +
          ' записується як 0: віднімати нема від чого, і журнал не має розходитись зі станом.' }
      ];
    }
  };

  /* ------------------------------------------------------------------ */
  /* Малювання                                                           */
  /* ------------------------------------------------------------------ */

  function blockHtml(b) {
    if (!b || typeof b !== 'object') return '';
    switch (b.t) {
      case 'h':
        return '<h3 class="help__h">' + esc(b.text) + '</h3>';
      case 'p':
        return '<p class="small">' + esc(b.text) + '</p>';
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        return '<' + tag + ' class="small list-note">' +
          (b.items || []).map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') +
          '</' + tag + '>';
      }
      case 'dl':
        return '<dl class="help__dl">' +
          (b.items || []).map(function (pair) {
            return '<dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1]) + '</dd>';
          }).join('') + '</dl>';
      case 'note':
        return '<div class="notice notice--acc"><div class="small">' + esc(b.text) + '</div></div>';
      case 'warn':
        return '<div class="notice"><div class="small">' + esc(b.text) + '</div></div>';
      case 'table':
        /* Таблиця в окремому контейнері зі своїм скролом: на телефоні
           три колонки не вміщаються, а горизонтальна прокрутка ВСЬОГО
           вікна ламала б жест закриття. */
        return '<div class="help__tablewrap"><table class="help__table">' +
          '<thead><tr>' + (b.head || []).map(function (h) {
            return '<th>' + esc(h) + '</th>';
          }).join('') + '</tr></thead><tbody>' +
          (b.rows || []).map(function (r) {
            return '<tr>' + r.map(function (c, i) {
              return '<td' + (i === 1 ? ' class="num mono"' : '') + '>' + esc(c) + '</td>';
            }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>';
      case 'dyn': {
        const fn = BUILDERS[b.build];
        if (!fn) return '';
        let out = [];
        try { out = fn() || []; } catch (_) { out = []; }
        return out.map(blockHtml).join('');
      }
      default:
        return '';
    }
  }

  function sectionHtml(sec) {
    return '<p class="help__lead">' + esc(sec.lead) + '</p>' +
           (sec.blocks || []).map(blockHtml).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Вікно                                                               */
  /* ------------------------------------------------------------------ */

  let openEl = null;
  let prevFocus = null;

  function close() {
    if (!openEl) return;
    const el = openEl;
    openEl = null;
    document.removeEventListener('keydown', onKey, true);
    el.classList.add('is-out');
    /* Прибираємо ПІСЛЯ анімації, але не покладаємось на подію: якщо
       анімації немає (prefers-reduced-motion, старий рушій), transitionend
       не прийде взагалі, і вікно лишилось би на екрані назавжди. */
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 180);
    try { if (A.lockScroll) A.lockScroll(false); } catch (_) {}
    try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (_) {}
    prevFocus = null;
  }

  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  function onKey(e) {
    if (!openEl) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const box = openEl.querySelector('.help__box');
    const list = focusables(box);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(page) {
    if (openEl) return;
    const C = window.HELP_CONTENT;
    const sec = C && C.sections[page || currentPage()];
    if (!sec) return;

    prevFocus = document.activeElement;

    const wrap = document.createElement('div');
    wrap.className = 'modal help';
    wrap.innerHTML =
      '<div class="modal__backdrop" data-help-close></div>' +
      '<div class="help__box modal__box" role="dialog" aria-modal="true" aria-labelledby="help-t">' +
        '<div class="help__head">' +
          '<h2 id="help-t" class="help__title">' + esc(sec.title) + '</h2>' +
          '<button class="icon-btn" type="button" data-help-close aria-label="Закрити довідку">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                 'stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="help__body">' +
          sectionHtml(sec) +
          /* «Про Forge» — згорнутий хвіст, а не окремий екран: він
             потрібен рідко, але шукати його в іншому місці ще гірше. */
          '<details class="help__about">' +
            '<summary>' + esc(C.about.title) + '</summary>' +
            '<div class="help__about-in">' + sectionHtml(C.about) + '</div>' +
          '</details>' +
        '</div>' +
      '</div>';

    document.body.appendChild(wrap);
    openEl = wrap;
    try { if (A.lockScroll) A.lockScroll(true); } catch (_) {}

    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-help-close]')) { e.preventDefault(); close(); }
    });
    document.addEventListener('keydown', onKey, true);

    const box = wrap.querySelector('.help__box');
    try { (box.querySelector('[data-help-close]') || box).focus(); } catch (_) {}
    /* Вікно прокручується з початку, навіть якщо сторінка під ним була
       прокручена: інакше довідка відкривалася б із середини тексту. */
    try { wrap.querySelector('.help__body').scrollTop = 0; } catch (_) {}

    /*
     * СТАН СЕЗОНУ МІГ ЩЕ НЕ ПРИЇХАТИ.
     *
     * Таблиця ELO рахується з конфігу, який приходить із сервера разом зі
     * станом. Якщо на момент відкриття його немає, а акаунт є — тягнемо і
     * перемальовуємо тіло. Один запит на відкриття довідки, і тільки там,
     * де без нього буде порожня таблиця.
     */
    if (sec.blocks && sec.blocks.some(function (b) { return b && b.t === 'dyn'; }) &&
        !eloConfig() && eloAvailable()) {
      window.EloApi.refresh().then(function () {
        if (openEl !== wrap || !eloConfig()) return;
        const body = wrap.querySelector('.help__body');
        const about = body.querySelector('.help__about');
        body.innerHTML = sectionHtml(sec);
        if (about) body.appendChild(about);
      }).catch(function () {});
    }
  }

  /* ------------------------------------------------------------------ */
  /* Кнопка                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * Кнопку малює js/app.js разом із шапкою — і одразу прихованою.
   * Показуємо її лише там, де розділ довідки справді є: кнопка, яка
   * відкриває порожнє вікно, гірша за її відсутність. Шапка будується
   * асинхронно, тому перевіряємо і зараз, і після завантаження.
   */
  function wire() {
    const has = Boolean(window.HELP_CONTENT && window.HELP_CONTENT.sections[currentPage()]);
    const found = document.querySelectorAll('[data-help-open]');
    Array.prototype.forEach.call(found, function (b) { b.hidden = !has; });

    /*
     * СТОРІНКА БЕЗ ШАПКИ ТЕЖ ПОТРЕБУЄ ДОВІДКИ.
     *
     * welcome.html — екран входу й онбордингу — навігації не має навмисно:
     * меню, кожен пункт якого повертає тебе назад, це не навігація. Але
     * саме тут людина вперше й питає «що це взагалі таке і що в мене зараз
     * попросять». Тому там, де кнопки в шапці немає, ставимо власну —
     * окрему, кутову, того самого вигляду.
     *
     * Це не друга система довідки: вікно, вміст і механізм ті самі, інша
     * лише точка входу.
     */
    if (has && !found.length && document.body) {
      const fab = document.createElement('button');
      fab.className = 'help__fab';
      fab.type = 'button';
      fab.setAttribute('data-help-open', '');
      fab.setAttribute('aria-label', 'Довідка про цей розділ');
      fab.setAttribute('title', 'Довідка');
      fab.innerHTML = '<svg viewBox="0 0 256 256" fill="none" stroke="currentColor" ' +
        'stroke-width="24" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M128 52 L32 90 L32 178 L128 216 Z"/>' +
        '<path d="M128 52 L224 90 L224 178 L128 216 Z"/></svg>';
      document.body.appendChild(fab);
    }
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-help-open]');
    if (!btn) return;
    e.preventDefault();
    open();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
  /* Шапка може зʼявитись пізніше за цей скрипт. */
  setTimeout(wire, 0);
  setTimeout(wire, 400);

  window.Help = {
    open: open,
    close: close,
    has: function (page) {
      return Boolean(window.HELP_CONTENT && window.HELP_CONTENT.sections[page || currentPage()]);
    },
    /*
     * Зібрати динамічний блок окремо від вікна.
     *
     * Потрібно тестам: інакше перевірити, що в таблиці ELO стоять ті самі
     * числа, які нараховує ядро, можна було б лише через браузер — тобто
     * повільно й опосередковано. Заразом це чесний публічний вхід, якщо
     * колись знадобиться вбудувати таблицю просто в сторінку.
     */
    block: function (name) {
      const fn = BUILDERS[name];
      return fn ? fn() : null;
    }
  };
})();
