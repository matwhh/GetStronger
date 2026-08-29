/**
 * Ядро сайту: навігація, футер, розкриття при скролі, тости, дрібні утиліти.
 * Підключається на кожній сторінці ПЕРШИМ (після config.js).
 */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};

  /* ------------------------------------------------------------------ */
  /* Утиліти                                                             */
  /* ------------------------------------------------------------------ */

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Безпечне екранування для вставки в HTML */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Безпечне посилання.
   *
   * esc() рятує від зламаної розмітки, але НЕ робить URL безпечним:
   * у рядку `javascript:alert(1)` немає жодного символу, який вона екранує,
   * тож він потрапляв у href як є, і клік виконував код. Те саме з `data:`
   * і `vbscript:`.
   *
   * Тому дозволяємо лише http, https, mailto і відносні шляхи.
   * Усе інше перетворюється на порожнє посилання.
   */
  function safeUrl(url) {
    const raw = String(url == null ? '' : url).trim();
    if (!raw) return '';
    // Схема — усе до першої двокрапки, якщо вона стоїть раніше за / ? #
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
    if (!m) return raw;                       // відносний шлях
    const scheme = m[1].toLowerCase();
    return ['http', 'https', 'mailto'].indexOf(scheme) === -1 ? '' : raw;
  }

  /** Округлення до n знаків без плаваючої похибки на типових значеннях */
  function round(value, digits) {
    const f = Math.pow(10, digits || 0);
    return Math.round((Number(value) + Number.EPSILON) * f) / f;
  }

  /**
   * Число для ПОКАЗУ: кома як десятковий роздільник.
   *
   * Ввід уже всюди приймає і кому, і крапку (див. num() нижче), а вивід
   * досі був різний: панель показувала «82,5 кг», а журнал за один клік
   * звідти — «82.5 кг». Це те саме число в тих самих одиницях, і два
   * написання читаються як два різні джерела.
   */
  function fmt(v) {
    return String(v == null ? '' : v).replace('.', ',');
  }

  /* ------------------------------------------------------------------ */
  /* ЧИСЛА: одне правило на весь Forge                                   */
  /* ------------------------------------------------------------------ */
  /*
   * Раніше кожна сторінка форматувала числа сама: десь String(n) із
   * крапкою, десь .replace('.', ','), десь toFixed(1), а десь узагалі
   * сире значення з журналу — і в списку ваги зʼявлялось
   * «82.10000000000001 кг». Одне й те саме число виглядало по-різному в
   * сусідніх картках.
   *
   * Правило просте: СПОЧАТКУ округлити, ПОТІМ поставити кому. Нижче —
   * одна функція на кожен тип даних, який Forge показує. Нових одиниць
   * тут не зʼявляється: це рівно ті, що вже були в інтерфейсі.
   */

  /** Скільки знаків після коми має тип даних */
  const NUM_DIGITS = {
    kg: 1,        // вага тіла й робоча вага: 82,4
    kcal: 0,      // калорії завжди цілі
    gram: 0,      // білок/жири/вуглеводи в грамах
    volume: 0,    // тоннаж
    steps: 0,
    pct: 0,
    elo: 0,
    hours: 1
  };

  /**
   * Показати число з фіксованою кількістю знаків.
   * Нечислове — прочерк, а не «NaN» і не порожнеча: у Forge прочерк
   * скрізь означає «даних немає», і це має лишатись одним символом.
   */
  function n(value, digits) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '—';
    const d = Number.isFinite(digits) ? digits : 0;
    // toFixed, а не round: 82.4 має лишитись «82,4», а 82.0 стати «82»
    let out = v.toFixed(d);
    if (d > 0) out = out.replace(/\.?0+$/, '');   // хвостові нулі не інформація
    return out.replace('.', ',');
  }

  /** Число зі знаком: для дельт, де «+» несе сенс нарівні з «−» */
  function signed(value, digits) {
    const v = Number(value);
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return n(0, digits);
    return (v > 0 ? '+' : '−') + n(Math.abs(v), digits);
  }

  /**
   * Типізовані обгортки. Другий аргумент {unit:true} дописує одиницю —
   * там, де вона не стоїть окремим елементом розмітки.
   */
  function unitFn(key, unit) {
    return function (value, opt) {
      const out = n(value, NUM_DIGITS[key]);
      return (opt && opt.unit && out !== '—') ? out + ' ' + unit : out;
    };
  }

  const numFmt = {
    n: n,
    signed: signed,
    kg:     unitFn('kg', 'кг'),
    kcal:   unitFn('kcal', 'ккал'),
    gram:   unitFn('gram', 'г'),
    volume: unitFn('volume', 'кг'),
    steps:  unitFn('steps', 'кроків'),
    elo:    unitFn('elo', 'Elo'),
    hours:  unitFn('hours', 'год'),
    pct: function (value, opt) {
      const out = n(value, NUM_DIGITS.pct);
      return (opt && opt.unit && out !== '—') ? out + '%' : out;
    },
    /** Хвилини → «7 год 25 хв». Той самий вигляд, що вже дає TrackerCore. */
    dur: function (minutes) {
      const m = Math.round(Number(minutes));
      if (!Number.isFinite(m)) return '—';
      const h = Math.floor(m / 60), r = m % 60;
      return h ? (h + ' год' + (r ? ' ' + r + ' хв' : '')) : (r + ' хв');
    }
  };

  /**
   * Короткий підтверджувальний стан на самій кнопці.
   *
   * Тост зʼявляється внизу екрана, а очі в цю мить — на кнопці, яку щойно
   * натиснули. Тому підтвердження має бути там само: кнопка на півтори
   * секунди каже, що сталось, і повертає свій підпис.
   */
  function flashDone(btn, text) {
    if (!btn || btn.dataset.flashing) return;
    const was = btn.textContent;
    btn.dataset.flashing = '1';
    btn.textContent = text || 'Готово';
    btn.classList.add('is-done');
    setTimeout(function () {
      btn.textContent = was;
      btn.classList.remove('is-done');
      delete btn.dataset.flashing;
    }, 1600);
  }

  /**
   * Кнопка на час асинхронної дії.
   *
   * У хмарному режимі збереження — це запит, і кнопка лишалась активною й
   * незмінною: не було видно ні що щось відбувається, ні що повторний клік
   * зайвий. Повертає функцію, яка знімає стан.
   */
  function busy(btn, text) {
    if (!btn) return function () {};
    const wasText = btn.textContent;
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    if (text) btn.textContent = text;
    btn.classList.add('is-busy');
    return function () {
      btn.disabled = wasDisabled;
      btn.textContent = wasText;
      btn.classList.remove('is-busy');
    };
  }

  /**
   * Історична заглушка. Старий довічний Forge Rating замінено сезонним
   * ELO (js/elo-core.js + сервер): факти більше не «штампуються» у
   * профіль, а події подає js/elo-hooks.js. Сигнатура збережена, бо
   * виклики лишились у пʼятьох модулях і їхні патчі мають проходити далі
   * без змін.
   */
  function stampRating(profileAfter, patch) { return patch; }

  /** Обмежити число діапазоном */
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /** Число з поля вводу; повертає null, якщо не число */
  function num(el) {
    if (!el) return null;
    const v = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  }

  /* ------------------------------------------------------------------ */
  /* Навігація                                                           */
  /* ------------------------------------------------------------------ */

  /*
   * Шапка, футер — плоский список NAV_ITEMS.
   *
   * Основні сторінки стоять у шапці ПООДИНЦІ, без випадних меню. Раніше
   * «Мій план» і «Періодизація» ховались під «Програмами», а «Журнал» і
   * «Раціон» — під «Харчуванням»: щоб потрапити на сторінку, якою
   * користуєшся щодня, треба було спершу навести на іншу. Тепер до них
   * один клік, і видно, що вони взагалі існують.
   *
   * Випадне меню лишилось одне — «Інше». Там довідкові сторінки, які
   * відкривають зрідка, і власної сторінки в групи немає, тому батько —
   * кнопка-перемикач, а не посилання. Стрілка потрібна не для краси: на
   * тач-екрані «наведення» немає.
   *
   * «Головної» немає навмисно: на головну веде сам логотип.
   */
  /*
   * «Сьогодні» стоїть першим: це щоденний сценарій, і перше місце в шапці
   * має відповідати першому питанню дня — «що мені робити зараз».
   *
   * «Бокс» переїхав в «Інше»: це одна суботня сесія, а не щоденний розділ.
   * У суботу «Сьогодні» саме підніме її нагору — тож верхній рівень
   * шапки боксу не потрібен.
   */
  /*
   * «Прогрес» став групою, а сама сторінка лишилась посиланням-батьком:
   * «Мої трекери» і «Forge Rating» відповідають на те саме питання «як у
   * мене справи» і раніше лежали в «Іншому» поруч із довідниками. Це
   * скоротило звалище з восьми пунктів до шести й нікому не додало
   * кліків: щоденні сторінки як були на верхньому рівні, так і лишились.
   *
   * «Бокс» лишається в «Іншому» — це одна суботня сесія, а не щоденний
   * розділ. Очевидний шлях до неї дає головна: у суботу вона стає
   * головною дією дня, а поза суботою — постійним посиланням у переліку
   * розділів. Плюс футер. Тобто «сторінка є, а входу немає» тут немає.
   */
  /*
   * ІЄРАРХІЯ.
   *
   * CORE — чотири розділи щоденного циклу, по одному на кожне питання:
   * що робити зараз (Сьогодні), чим тренуватись (Тренування), що їсти
   * (Харчування), куди це веде (Прогрес). Рівно ці чотири стоять у
   * мобільній панелі знизу. «Трекери» живуть в «Іншому»: відмітки дня
   * доступні прямо на «Сьогодні», окремий пункт у щоденному ряду лише
   * дублював їх.
   *
   * SECONDARY — усе інше: інструменти, довідники, налаштування. Вони
   * нікуди не поділись і відкриваються з тих самих груп, але більше не
   * стоять на одному рівні зі щоденним циклом. Пʼятнадцять рівноправних
   * пунктів меню — це не навігація, а перелік файлів.
   *
   * Сторінки, які раніше були верхнім рівнем, тепер лежать усередині
   * свого розділу: «Плани тренувань» і «Періодизація» — під
   * «Тренуванням», «План харчування» — під «Харчуванням». Один клік до
   * них лишився.
   */
  const NAV_GROUPS = [
    { href: 'index.html',   label: 'Сьогодні', core: true, icon: 'today' },

    /* Розділ веде на СЬОГОДНІШНЄ тренування, а не в налаштування плану:
       щоденна дія — «зробити», а не «переналаштувати». «Мій план»
       лишається першим пунктом усередині. */
    { href: 'workout.html', label: 'Тренування', core: true, icon: 'train', children: [
      { href: 'workout.html',       label: 'Тренування' },
      { href: 'plan.html',          label: 'Мій план' },
      { href: 'programs.html',      label: 'Плани тренувань' },
      { href: 'periodization.html', label: 'Періодизація' },
      { href: 'boxing.html',        label: 'Бокс' },
      { href: 'cardio.html',        label: 'Кардіо' }
    ] },

    { href: 'meals.html',   label: 'Харчування', core: true, icon: 'food', children: [
      { href: 'meals.html',       label: 'Раціон' },
      { href: 'nutrition.html',   label: 'План харчування' },
      { href: 'supplements.html', label: 'Добавки' }
    ] },

    { href: 'journal.html', label: 'Прогрес', core: true, icon: 'progress', children: [
      { href: 'journal.html',          label: 'Огляд прогресу' },
      { href: 'rating.html',           label: 'Рейтинг' },
      { href: 'journal.html#history',  label: 'Історія' },
      { href: 'measure.html',          label: 'Заміри тіла' }
    ] },

    /* «Акаунта» тут немає: він має власний пункт біля правого краю
       (NAV_EDGE) — другий шлях до тієї самої сторінки лише плутав. */
    { label: 'Інше', children: [
      { href: 'trackers.html',    label: 'Трекери' },
      { href: 'calculator.html',  label: 'Калькулятор 1ПМ' },
      { href: 'research.html',    label: 'Дослідження' }
    ] }
  ];

  const NAV_EDGE = { href: 'account.html', label: 'Акаунт' };

  /* Футер — той самий плоский список і в тому ж порядку, що й шапка:
     розходження в порядку між ними читається як інша навігація. */
  /* Футер — той самий набір, згрупований так само, як шапка: спершу
     щоденний цикл, потім решта. Плоский алфавітний список у підвалі
     нічого не пояснював про структуру продукту. */
  const NAV_ITEMS = [
    { href: 'index.html',      label: 'Сьогодні' },
    { href: 'workout.html',    label: 'Тренування' },
    { href: 'plan.html',       label: 'Мій план' },
    { href: 'programs.html',   label: 'Плани тренувань' },
    { href: 'periodization.html', label: 'Періодизація' },
    { href: 'meals.html',      label: 'Раціон' },
    { href: 'nutrition.html',  label: 'План харчування' },
    { href: 'trackers.html',   label: 'Трекери' },
    { href: 'journal.html',    label: 'Прогрес' },
    { href: 'measure.html',    label: 'Заміри тіла' },
    { href: 'rating.html',     label: 'Рейтинг' },
    { href: 'boxing.html',     label: 'Бокс' },
    { href: 'cardio.html',     label: 'Кардіо' },
    { href: 'calculator.html', label: 'Калькулятор 1ПМ' },
    { href: 'supplements.html', label: 'Добавки' },
    { href: 'research.html',   label: 'Дослідження' },
    { href: 'account.html',    label: 'Акаунт' }
  ];
  /**
   * canonical і og:url можна проставити тільки маючи домен: відносний
   * canonical формально дозволений, але половина інструментів його
   * ігнорує, а неправильний абсолютний — гірше за відсутній.
   * Тому теги додаються лише коли в config.js заповнено siteUrl.
   */
  function injectCanonical() {
    const base = String((window.APP_CONFIG || {}).siteUrl || '').replace(/\/+$/, '');
    if (!base) return;

    const url = base + '/' + currentPage();

    if (!document.querySelector('link[rel="canonical"]')) {
      const link = document.createElement('link');
      link.rel = 'canonical';
      link.href = url;
      document.head.appendChild(link);
    }
    if (!document.querySelector('meta[property="og:url"]')) {
      const meta = document.createElement('meta');
      meta.setAttribute('property', 'og:url');
      meta.content = url;
      document.head.appendChild(meta);
    }
  }

  /**
   * Структуровані дані (JSON-LD).
   *
   * Їх не було ніде. Googlebot JS виконує, тому вставляти звідси прийнятно —
   * на відміну від og:image і canonical, які потрібні краулерам месенджерів
   * (Telegram, Slack, WhatsApp), а ті JS НЕ виконують. Саме тому og:image
   * лежить статично в розмітці кожної сторінки, а це — тут.
   */
  function injectJsonLd() {
    if (document.querySelector('script[type="application/ld+json"]')) return;
    const base = String((window.APP_CONFIG || {}).siteUrl || '').replace(/\/+$/, '');

    const site = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: CFG.siteName || 'FORGE',
      inLanguage: 'uk'
    };
    if (base) site.url = base + '/';

    const page = currentPage();
    const CALC = { 'calculator.html': 'Калькулятор 1ПМ', 'nutrition.html': 'Калькулятор калорій і макронутрієнтів', 'cardio.html': 'Калькулятор пульсових зон' };

    const graph = [site];
    if (CALC[page]) {
      graph.push({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: CALC[page],
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Any',
        inLanguage: 'uk',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
      });
    }

    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.textContent = JSON.stringify(graph.length === 1 ? graph[0] : graph);
    document.head.appendChild(el);
  }

  /* ------------------------------------------------------------------ */
  /* Довгі пояснення — під розкриття                                     */
  /* ------------------------------------------------------------------ */
  /*
   * Forge пояснює свої числа, і це його сильна сторона — але пояснення
   * не має стояти між людиною і дією. На «Схемах» текст «Як читати
   * таблицю» займав 42% висоти сторінки, на «Кардіо» — 66%: щодня
   * гортаєш повз те, що прочитав один раз.
   *
   * Тому текст нікуди не дівається — він згортається. Береться той самий
   * акордеон, що вже є в дизайн-системі (.acc + initAccordions): нових
   * компонентів, стилів і станів не зʼявляється, а розмітка сторінок
   * лишається читабельною — там просто стоїть data-longform.
   *
   * Заголовок блока стає головою акордеона. Усе, що було під ним, — тілом.
   */
  function initLongform(root) {
    $$('[data-longform]', root || document).forEach(function (box) {
      if (box.dataset.lfDone) return;
      box.dataset.lfDone = '1';

      const head = box.querySelector('h2, h3');
      if (!head) return;
      const title = (head.textContent || '').trim();
      const note = box.dataset.longform;   // необовʼязковий підпис під заголовком

      // Усе, крім заголовка, їде в тіло
      const body = document.createElement('div');
      body.className = 'acc__pad';
      let n = head.nextSibling;
      while (n) { const next = n.nextSibling; body.appendChild(n); n = next; }
      head.remove();

      box.classList.add('acc', 'acc--longform');
      box.innerHTML =
        '<button class="acc__head" type="button" aria-expanded="false">' +
          '<span>' +
            '<h3>' + esc(title) + '</h3>' +
            (note ? '<span class="small muted">' + esc(note) + '</span>' : '') +
          '</span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"></div></div>';
      box.querySelector('.acc__inner').appendChild(body);
    });

    initAccordions(root || document);
  }

  /* ------------------------------------------------------------------ */
  /* Мобільна панель розділів                                            */
  /* ------------------------------------------------------------------ */
  /*
   * Пʼять розділів щоденного циклу внизу екрана — там, де до них дістає
   * великий палець. До цього єдиним входом у навігацію на телефоні був
   * бургер у верхньому правому куті: два дотики й повноекранна накладка
   * заради переходу, який у застосунку коштує один дотик у зоні
   * досяжності.
   *
   * Панель НЕ дублює бургер, а знімає з нього щоденне: у бургері
   * лишається все інше — інструменти, довідники, акаунт.
   *
   * Тільки для сенсорних ширин (@media max-width: 900px у CSS). На
   * десктопі розділи стоять у шапці, і другий ряд тих самих посилань
   * унизу вікна був би просто дублем.
   */
  const TAB_ICONS = {
    today:    '<path d="M4 5h16v15H4z"/><path d="M4 10h16"/><path d="M8 3v4M16 3v4"/>',
    train:    '<path d="M3 12h2M19 12h2"/><path d="M6 8v8M18 8v8"/><path d="M9 6v12M15 6v12"/><path d="M9 12h6"/>',
    food:     '<path d="M6 3v8a3 3 0 0 0 6 0V3"/><path d="M9 11v10"/><path d="M17 3c-1.5 2-2 4-2 6v3h3V3z"/><path d="M18 12v9"/>',
    recovery: '<path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.6-7 9-7 9z"/>',
    progress: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>'
  };

  function tabIcon(name) {
    return '<svg class="tabbar__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (TAB_ICONS[name] || '') + '</svg>';
  }

  /** Чи належить сторінка розділу — сам розділ або будь-яка його дитина */
  function sectionOwns(group, page) {
    if (group.href === page) return true;
    return (group.children || []).some(function (c) { return c.href === page; });
  }

  function buildTabBar(page) {
    const core = NAV_GROUPS.filter(function (g) { return g.core; });
    if (!core.length) return;

    let bar = document.getElementById('tabbar');
    if (!bar) {
      bar = document.createElement('nav');
      bar.id = 'tabbar';
      bar.className = 'tabbar';
      bar.setAttribute('aria-label', 'Основні розділи');
      document.body.appendChild(bar);
    }

    bar.innerHTML = core.map(function (g) {
      const active = sectionOwns(g, page);
      return '<a class="tabbar__item' + (active ? ' is-active' : '') + '" href="' + g.href + '"' +
             (active ? ' aria-current="page"' : '') + '>' +
               tabIcon(g.icon) +
               '<span class="tabbar__lbl">' + esc(g.label) + '</span>' +
             '</a>';
    }).join('');

    /* Панель перекриває низ сторінки, тому вміст отримує відступ рівно на
       її висоту. Клас на <body>, а не padding у CSS сторінки: висота
       залежить від безпечної зони iOS і живе в одній змінній. */
    document.body.classList.add('has-tabbar');
  }

  function currentPage() {
    const file = location.pathname.split('/').pop();
    return file === '' ? 'index.html' : file;
  }

  /* ------------------------------------------------------------------ */
  /* Бейдж сезонного ELO у шапці                                         */
  /* ------------------------------------------------------------------ */
  /*
   * ЛИШЕ відображення: число приходить із сервера (EloApi.refresh) і
   * кешується локально (EloApi.cached) — між сторінками бейдж малюється
   * з кешу миттєво, а свіже значення доїжджає слідом. Без акаунта
   * (локальний режим або не виконано вхід) бейджа немає взагалі:
   * сезонний рейтинг існує тільки на сервері.
   */

  function whenReady(check, cb, triesLeft) {
    if (check()) { cb(); return; }
    if (triesLeft <= 0) return;
    setTimeout(function () { whenReady(check, cb, triesLeft - 1); }, 30);
  }

  function renderRatingBadge(el, page) {
    if (!el) return;
    el.classList.toggle('is-active', page === 'rating.html');

    function paint() {
      const Api = window.EloApi, EC = window.EloCore;
      if (!Api || !EC || !Api.available()) { el.hidden = true; return; }
      const st = Api.cached();
      if (!st || !st.config) { el.hidden = true; return; }
      const lvl = EC.levelFor(st.elo, st.config);
      el.hidden = false;
      el.textContent = String(lvl.level);
      el.classList.toggle('is-elite', lvl.elite);
      el.setAttribute('aria-label',
        'Рейтинг: ' + st.elo + ' ELO, ' + lvl.name +
        (st.today ? ', сьогодні ' + (st.today > 0 ? '+' : '') + st.today : '') + ' — детальніше');
      el.title = st.elo + ' ELO' + (st.today ? ' · ' + (st.today > 0 ? '+' : '') + st.today + ' сьогодні' : '');
    }

    whenReady(function () { return !!(window.EloApi && window.EloCore); }, function () {
      paint();
      [300, 1200, 2500].forEach(function (d) { setTimeout(paint, d); });
      window.EloApi.onChange(paint);
    }, 60);
  }

  /* ------------------------------------------------------------------ */
  /* Стан синхронізації в шапці                                          */
  /* ------------------------------------------------------------------ */
  /*
   * Ненавʼязливо і постійно — замість спливайок.
   *
   * Тости про «збережеться, коли зʼявиться мережа» показуються один раз і
   * зникають; після цього не було жодної ознаки, що частина змін досі
   * лежить у черзі. Тут — маленька позначка, яка просто є, поки черга
   * непорожня, і зникає сама, щойно все доїхало. Жодного модального
   * вікна й жодного повторного нагадування.
   *
   * Власної логіки синхронізації тут немає: черга, досилання й подія
   * onChange цілком належать js/store.js.
   */
  function renderSyncBadge(el) {
    if (!el) return;

    function paint() {
      const S = window.Store;
      if (!S || typeof S.pendingCount !== 'function') { el.hidden = true; return; }
      const n = S.pendingCount();
      const offline = navigator.onLine === false;

      // Офлайн без черги — не проблема: локальний режим і так пише в
      // localStorage, і лякати позначкою нема чого.
      if (!n) { el.hidden = true; return; }

      el.hidden = false;
      el.classList.toggle('is-offline', offline);
      const txt = offline ? 'Офлайн · ' + n : 'Не синхронізовано · ' + n;
      el.querySelector('.nav__sync-txt').textContent = txt;
      el.setAttribute('aria-label', offline
        ? 'Немає звʼязку. Незбережених змін: ' + n + '. Відкрити акаунт'
        : 'Незбережених змін: ' + n + '. Відкрити акаунт');
    }

    whenReady(function () { return !!(window.Store && window.Store.onChange); }, function () {
      paint();
      window.Store.onChange(paint);
      // Черга міняється і без onChange (наприклад, досилання за таймером),
      // тому доповнюємо подіями мережі та рідким опитуванням.
      window.addEventListener('online', function () { setTimeout(paint, 400); });
      window.addEventListener('offline', paint);
      setInterval(paint, 15000);
    }, 40);
  }

  /**
   * Онбординг ще триває? Читаємо профіль синхронно, як сторож
   * (js/agegate.js): buildNav працює до першого асинхронного читання
   * Store, а меню не має блимнути повним і сховатись.
   */
  function onboardingActive() {
    const OC = window.OnboardingCore;
    if (!OC) return false;
    try {
      const p = JSON.parse(localStorage.getItem('ib.profile'));
      return OC.stepFor(p && typeof p === 'object' ? p : null) !== 'done';
    } catch (_) { return false; }
  }

  function buildNav() {
    const host = $('#site-nav');
    if (!host) return;

    const page = currentPage();

    /*
     * Під час онбордингу повного меню немає: сторож усе одно відверне з
     * будь-якої іншої сторінки, а меню, кожен пункт якого повертає тебе
     * назад, — це не навігація, а знущання. Лишаються знак і бейдж
     * синхронізації (account.html доступний — імпорт резервної копії).
     */
    if (onboardingActive()) {
      host.className = 'nav';
      host.innerHTML =
        '<div class="nav__inner">' +
          '<span class="logo" aria-label="' + esc(CFG.siteName || 'FORGE') + '">' +
            '<img class="logo__mark" src="logo-mark.svg" alt="" width="57" height="41">' +
            '<span>' + esc(CFG.siteName || 'FORGE') + '</span>' +
          '</span>' +
          '<div class="nav__actions">' +
            '<a class="nav__sync" href="account.html" hidden>' +
              '<span class="nav__sync-dot" aria-hidden="true"></span>' +
              '<span class="nav__sync-txt">Не синхронізовано</span>' +
            '</a>' +
            schemeButtonHtml() +
          '</div>' +
        '</div>';
      renderSyncBadge($('.nav__sync', host));
      paintSchemeButton($('[data-scheme-toggle]', host));
      /* Довгі тексти сторінки згортаються незалежно від меню. */
      initLongform(document);
      const onScroll = function () { host.classList.toggle('is-stuck', window.scrollY > 8); };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      return;
    }
    const chevron = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M6 9l6 6 6-6"/></svg>';

    const links = NAV_GROUPS.map(function (g) {
      const children = Array.isArray(g.children) ? g.children : [];

      // Звичайний пункт без вкладень — просто посилання
      if (!children.length) {
        return '<a class="nav__link' + (g.href === page ? ' is-active' : '') +
               '" href="' + g.href + '">' + esc(g.label) + '</a>';
      }

      const childActive = children.some(function (c) { return c.href === page; });
      // Батько підсвічується й тоді, коли відкрита дочірня сторінка:
      // інакше на «Кардіо» шапка виглядала б так, ніби ти ніде
      const activeCls = (g.href === page || childActive) ? ' is-active' : '';

      const drop =
        '<div class="nav__drop"><div class="nav__drop-in">' +
          children.map(function (c) {
            return '<a class="nav__link' + (c.href === page ? ' is-active' : '') + '" href="' + c.href + '">' +
                   esc(c.label) + '</a>';
          }).join('') +
        '</div></div>';

      if (g.href) {
        return '<div class="nav__item">' +
                 '<a class="nav__link' + activeCls + '" href="' + g.href + '">' + esc(g.label) + '</a>' +
                 '<button class="nav__caret" type="button" aria-expanded="false" ' +
                         'aria-label="Розгорнути розділ ' + esc(g.label) + '">' + chevron + '</button>' +
                 drop +
               '</div>';
      }
      // Група без сторінки: батько сам є перемикачем
      return '<div class="nav__item nav__item--btn">' +
               '<button class="nav__link nav__link--parent' + activeCls + '" type="button" ' +
                       'aria-expanded="false">' + esc(g.label) + chevron + '</button>' +
               drop +
             '</div>';
    }).join('') +
      '<a class="nav__link nav__link--edge' + (NAV_EDGE.href === page ? ' is-active' : '') +
        '" href="' + NAV_EDGE.href + '">' + esc(NAV_EDGE.label) + '</a>';

    host.className = 'nav';
    host.innerHTML =
      '<div class="nav__inner">' +
        '<a class="logo" href="index.html" aria-label="' + esc(CFG.siteName || 'FORGE') + ' — на головну">' +
          // Знак підключений картинкою, а не вклеєний у розмітку: так шлях
          // до нього один — logo-mark.svg. Вклеєний inline SVG довелося б
          // тримати другою копією тут, і два малюнки з часом розійшлися б.
          // alt порожній навмисно: поруч уже стоїть слово FORGE, і читалка
          // інакше вимовляла б назву двічі.
          '<img class="logo__mark" src="logo-mark.svg" alt="" width="57" height="41">' +
          '<span>' + esc(CFG.siteName || 'FORGE') + '</span>' +
        '</a>' +
        '<nav class="nav__links">' + links + '</nav>' +
        // Бургер і бейдж Forge Rating згруповані в один блок: на десктопі
        // він просто стоїть після nav__links (тобто правіше «Акаунта»), а
        // на мобільному, де nav__links стає fixed-накладкою й випадає з
        // потоку, ці двоє лишаються єдиною видимою парою праворуч від
        // логотипа — без цього при space-between бейдж «відлітав» би
        // в середину шапки, відірваний від бургера.
        '<div class="nav__actions">' +
          // Стан синхронізації. За звичайних умов його НЕМАЄ взагалі —
          // зʼявляється лише коли є що досилати (див. renderSyncBadge).
          '<a class="nav__sync" href="account.html" hidden>' +
            '<span class="nav__sync-dot" aria-hidden="true"></span>' +
            '<span class="nav__sync-txt">Не синхронізовано</span>' +
          '</a>' +
          // hidden за замовчуванням: показується, лише коли рейтинг реально
          // порахований (див. renderRatingBadge). Інакше на першому відкритті
          // в шапці блимало б «1» без жодних даних за ним.
          '<a class="nav__rating" href="rating.html" aria-label="Forge Rating" hidden></a>' +
          schemeButtonHtml() +
          '<button class="nav__burger" type="button" aria-label="Меню" aria-expanded="false">' +
            '<span></span><span></span><span></span>' +
          '</button>' +
        '</div>' +
      '</div>';

    buildTabBar(page);
    initLongform(document);

    const burger = $('.nav__burger', host);
    const menu   = $('.nav__links', host);
    renderRatingBadge($('.nav__rating', host), page);
    renderSyncBadge($('.nav__sync', host));
    paintSchemeButton($('[data-scheme-toggle]', host));

    burger.addEventListener('click', function () {
      const open = menu.classList.toggle('is-open');
      burger.classList.toggle('is-open', open);
      burger.setAttribute('aria-expanded', String(open));
    });

    // Закривати мобільне меню при кліку на посилання
    menu.addEventListener('click', function (e) {
      if (e.target.closest('.nav__link')) {
        menu.classList.remove('is-open');
        burger.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });

    /* Розкриття груп.
       Наведення обробляє CSS (:hover / :focus-within); клік по стрілці або
       по кнопці «Інше» — для тач-екранів. Одночасно відкрита щонайбільше
       одна група: інакше меню наповзали б одне на одного. */
    function closeDrops(except) {
      $$('.nav__item.is-open', host).forEach(function (it) {
        if (it === except) return;
        it.classList.remove('is-open');
        const t = it.querySelector('[aria-expanded]');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    }

    host.addEventListener('click', function (e) {
      const toggle = e.target.closest('.nav__caret, .nav__link--parent');
      if (!toggle) return;
      const item = toggle.closest('.nav__item');
      const open = item.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      closeDrops(item);
    });

    // Клік повз шапку і Escape закривають відкрите меню
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.nav')) closeDrops(null);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      closeDrops(null);
      /* Бургер-меню — накладка на весь екран, і Escape його не закривав:
         closeDrops() чіпає лише випадні групи всередині. Людина з
         клавіатури лишалась замкненою в меню без жодного способу вийти,
         крім Tab до кінця списку. Фокус повертаємо на кнопку, з якої
         меню відкрили, — інакше він осів би на body. */
      if (menu.classList.contains('is-open')) {
        menu.classList.remove('is-open');
        burger.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
        burger.focus();
      }
    });

    // Тінь/фон навбару при скролі
    const onScroll = function () { host.classList.toggle('is-stuck', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ------------------------------------------------------------------ */
  /* Футер                                                               */
  /* ------------------------------------------------------------------ */

  function buildFooter() {
    const host = $('#site-footer');
    if (!host) return;

    host.className = 'footer';
    host.innerHTML =
      '<div class="wrap">' +
        '<div class="footer__grid">' +
          '<div>' +
            // Той самий лок-ап, що й у шапці: знак і слово ходять парою,
            // інакше внизу сторінки бренд виглядав би іншим.
            '<a class="logo" href="index.html">' +
              '<img class="logo__mark" src="logo-mark.svg" alt="" width="57" height="41">' +
              '<span>' + esc(CFG.siteName || 'FORGE') + '</span>' +
            '</a>' +
          '</div>' +
          '<div class="footer__links">' +
            NAV_ITEMS.map(function (i) {
              return '<a href="' + i.href + '">' + esc(i.label) + '</a>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<p class="footer__note">' +
          'Розрахунки калорій, макронутрієнтів і 1ПМ — оцінки за популяційними формулами, ' +
          'індивідуальна похибка до ±10–15%. Не є медичною порадою. ' +
          'За наявності захворювань зміни в тренуваннях і харчуванні варто узгодити з лікарем.' +
        '</p>' +
        '<p class="footer__note" style="margin-top:6px">' +
          '<a href="legal.html#privacy">Політика конфіденційності</a> · ' +
          '<a href="legal.html#terms">Умови використання</a> · ' +
          '<a href="legal.html#medical">Медичне застереження</a> · ' +
          '<a href="legal.html#fitness">Тренування й харчування</a>' +
        '</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Розкриття при скролі                                                */
  /* ------------------------------------------------------------------ */

  function initReveal(root) {
    const items = $$('.reveal:not(.is-in)', root);
    if (!items.length) return;

    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------------------ */
  /* Підсвітка курсором на картках                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Світлова пляма + нахил картки за курсором.
   *
   * Пляма (--mx/--my) і кути (--rx/--ry) пишуться НЕ в обробнику руху,
   * а раз на кадр через requestAnimationFrame: pointermove стріляє до
   * кількох сотень разів на секунду, і стільки ж записів стилю дало б
   * марну роботу — кадрів однаково не більше 60. Обробник лише запамʼятовує
   * останню позицію, кадр забирає її і скидає прапорець.
   *
   * getBoundingClientRect викликається теж раз на кадр і ПЕРЕД записом
   * стилів, тому читання й запис не чергуються — без layout thrashing.
   *
   * Нахил вимкнено там, де він недоречний:
   *   - тач-екрани (hover: hover / pointer: fine не збігаються) — пальцем
   *     «наводитись» неможливо, лишається тільки :active із CSS;
   *   - prefers-reduced-motion — людина попросила без анімацій.
   * Світлова пляма при цьому працює: вона не рухає елемент.
   */
  function initCardGlow() {
    /*
     * Тут стояв докладний коментар про батчинг через requestAnimationFrame
     * і вимкнення на тач-екранах — а в коді не було ні того, ні того:
     * на КОЖЕН pointermove (сотні на секунду) робився getBoundingClientRect
     * (примусовий синхронний layout) і одразу два setProperty на тому ж
     * елементі. Класичний цикл читання/запису.
     *
     * Тепер обіцяне справді виконується:
     *   • пальцем «наводитись» неможливо — на тач-екранах ефект вимкнено;
     *   • людина попросила без анімацій — теж вимкнено;
     *   • запис іде рівно раз на кадр.
     */
    const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || calm) return;

    let pending = null;
    let frame = 0;

    const flush = function () {
      frame = 0;
      if (!pending) return;
      const card = pending.card, x = pending.x, y = pending.y;
      pending = null;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((x - r.left) / r.width * 100) + '%');
      card.style.setProperty('--my', ((y - r.top) / r.height * 100) + '%');
    };

    document.addEventListener('pointermove', function (e) {
      const card = e.target.closest ? e.target.closest('.card--hover') : null;
      if (!card) return;
      pending = { card: card, x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(flush);
    }, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /* Акордеони                                                           */
  /* ------------------------------------------------------------------ */

  let accSeq = 0;

  /**
   * Акордеони.
   *
   * Крім самого відкривання тут робиться те, чого раніше не робив ніхто:
   *   • aria-controls звʼязує кнопку з тілом (у проєкті не було ЖОДНОГО);
   *   • inert прибирає згорнутий вміст із таб-порядку й дерева доступності.
   *     Без нього табуляція заходила у невидимі посилання, а читалка
   *     озвучувала закритий текст — CSS стискав висоту до нуля, але
   *     display:none не ставив. Запасний шлях для старих браузерів —
   *     visibility:hidden у css/style.css.
   */
  function initAccordions(root) {
    $$('.acc__head', root).forEach(function (head) {
      if (head.dataset.bound) return;
      head.dataset.bound = '1';

      const acc = head.closest('.acc');
      const body = acc && acc.querySelector('.acc__body');

      if (body) {
        if (!body.id) body.id = 'acc-body-' + (++accSeq);
        head.setAttribute('aria-controls', body.id);
      }

      const sync = function (open) {
        head.setAttribute('aria-expanded', String(open));
        const inner = acc && acc.querySelector('.acc__inner');
        if (!inner) return;
        if (open) inner.removeAttribute('inert');
        else inner.setAttribute('inert', '');
      };

      sync(Boolean(acc && acc.classList.contains('is-open')));

      head.addEventListener('click', function () {
        sync(acc.classList.toggle('is-open'));
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Тости                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Контейнер тостів створюється ЗАЗДАЛЕГІДЬ і порожнім.
   *
   * Раніше він додавався в DOM у тій самій задачі, що й перше повідомлення.
   * Частина читалок такого не озвучує: щоб live-region спрацював, він має
   * існувати до того, як у ньому щось зʼявиться.
   */
  function toastHost() {
    let host = $('.toasts');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toasts';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'false');
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, kind) {
    const host = toastHost();
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = message;
    host.appendChild(el);

    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 320);
    }, 3200);
  }

  /* ------------------------------------------------------------------ */
  /* Таймер відпочинку                                                   */
  /* ------------------------------------------------------------------ */
  /*
   * Плаваючий віджет унизу праворуч: під час відпочинку сторінку зазвичай
   * гортають, і відлік має лишатися на оці.
   *
   * Кінець рахується від міток часу (Date.now), а не від кількості тіків:
   * браузери сповільнюють інтервали у фонових вкладках, і таймер на тіках
   * брехав би на десятки секунд — рівно тоді, коли на нього не дивляться.
   */
  const rt = { end: 0, tick: null, host: null };

  function rtHost() {
    if (rt.host) return rt.host;
    const el = document.createElement('div');
    el.className = 'rest-timer';
    el.hidden = true;
    el.innerHTML =
      '<div>' +
        '<div class="rest-timer__time mono" aria-live="off">0:00</div>' +
        '<div class="rest-timer__name"></div>' +
      '</div>' +
      '<button class="btn btn--ghost btn--sm" type="button" data-rt-stop>Стоп</button>';
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-rt-stop]')) rtStop();
    });
    document.body.appendChild(el);
    rt.host = el;
    return el;
  }

  function rtStop() {
    clearInterval(rt.tick);
    rt.tick = null;
    if (rt.host) { rt.host.hidden = true; rt.host.classList.remove('is-done'); }
    // Тости повертаються в нижній кут: місце звільнилось (див. --rest-h у CSS)
    document.body.classList.remove('has-rest-timer');
  }

  /*
   * Аудіо для таймера.
   *
   * На iOS звук працює тільки якщо AudioContext створено (і розбуджено)
   * у відповідь на ДОТИК користувача. Було так: контекст створювався
   * всередині rtBeep(), тобто в тіку setInterval — далеко від будь-якого
   * жесту. Safari віддавав його у стані 'suspended', resume() ніхто не
   * викликав, і таймер на iPhone відлічував беззвучно. Вібрації там теж
   * немає (navigator.vibrate на iOS не існує), тож зворотного звʼязку не
   * лишалось узагалі.
   *
   * Плюс контекст створювався НАНОВО на кожен сигнал і ніколи не
   * закривався; WebKit обмежує кількість живих контекстів, і після
   * кількох підходів new Ctx() починав кидати — мовчки, бо в try.
   *
   * Тепер контекст один на сторінку, створюється в rtStart() (це клік по
   * кнопці відпочинку, тобто справжній жест) і будиться перед сигналом.
   */
  let audioCtx = null;

  function rtAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
      return audioCtx;
    } catch (_) { return null; }
  }

  /** Два короткі гудки без аудіофайлів — генеруються осцилятором */
  function rtBeep() {
    try {
      const ctx = rtAudio();
      if (!ctx) return;
      [0, 0.3].forEach(function (at) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.25);
      });
    } catch (_) { /* без звуку — не привід падати */ }
  }

  /**
   * Позначити сьогодні в журналі тренувань — але лише раз на день.
   * Таймер дзвонить десятки разів за сесію; журнал фіксує факт «був у залі»,
   * а не кількість підходів.
   */
  async function rtMarkToday() {
    try {
      const p = await window.Store.getProfile() || {};
      const log = (p.workLog && typeof p.workLog === 'object' && !Array.isArray(p.workLog))
        ? p.workLog : {};
      const d = new Date();
      const key = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      if (log[key]) return;
      log[key] = 1;
      await window.Store.saveProfile({ workLog: log });
      toast('День позначено в журналі', 'ok');
    } catch (_) { /* журнал — не критичний шлях таймера */ }
  }

  function rtStart(sec, name) {
    const el = rtHost();
    // Створюємо/будимо аудіо ТУТ: rtStart викликається з обробника кліку по
    // кнопці відпочинку, а це єдиний момент, коли iOS дозволяє це зробити.
    rtAudio();
    rt.end = Date.now() + sec * 1000;
    el.hidden = false;
    // Поки йде відлік — тости піднімаються над віджетом, а не поверх нього
    document.body.classList.add('has-rest-timer');
    el.classList.remove('is-done');
    el.querySelector('.rest-timer__name').textContent = name || '';

    const timeEl = el.querySelector('.rest-timer__time');
    const draw = function () {
      const left = Math.max(0, Math.round((rt.end - Date.now()) / 1000));
      timeEl.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (left <= 0) {
        clearInterval(rt.tick);
        rt.tick = null;
        el.classList.add('is-done');
        rtBeep();
        // Вібрації на iOS немає взагалі, тому вона тут не заміна звуку, а
        // додаток до нього. Видимий стан (.is-done) лишається єдиним
        // гарантованим сигналом на будь-якій платформі.
        if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
        rtMarkToday();
        // Віджет ховається сам: наступний підхід уже почався
        setTimeout(function () { if (!rt.tick) rtStop(); }, 4000);
      }
    };
    clearInterval(rt.tick);
    draw();
    rt.tick = setInterval(draw, 250);
  }

  /* ------------------------------------------------------------------ */
  /* Публічний API                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Копіювання в буфер.
   * navigator.clipboard працює не всюди: на file:// і в старих браузерах
   * його може не бути зовсім. Тому є запасний шлях через прихований
   * textarea, а якщо не спрацював і він — показуємо текст, щоб виділити руками.
   */
  async function copyRich(html, text) {
    // 1. Сучасний шлях: кладемо в буфер ОБИДВА формати одразу.
    //    Нотатки й редактори візьмуть html і зберуть таблицю, а поле
    //    для звичайного тексту — text.
    try {
      if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            'text/html':  new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' })
          })
        ]);
        return 'rich';
      }
    } catch (_) { /* далі запасні шляхи */ }

    // 2. Запасний шлях для розмітки: виділяємо готовий фрагмент і копіюємо
    //    його виділенням. Працює там, де ClipboardItem недоступний —
    //    зокрема на file://, де немає secure context.
    try {
      const box = document.createElement('div');
      box.innerHTML = html;
      box.setAttribute('contenteditable', 'true');
      box.style.position = 'fixed';
      box.style.left = '-10000px';
      box.style.top = '0';
      document.body.appendChild(box);

      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      const ok = document.execCommand('copy');
      sel.removeAllRanges();
      document.body.removeChild(box);
      if (ok) return 'rich';
    } catch (_) { /* лишається текст */ }

    // 3. Хоч текстом
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok ? 'text' : false;
    } catch (_) {
      return false;
    }
  }

  /**
   * Форма слова за числом: 1 вага, 2 ваги, 5 ваг.
   *
   * Українська має три форми, і жодне «(шт.)» їх не замінює — текст
   * «знижено 2 ваг» видно одразу. Числа 11–14 окремий випадок: вони
   * беруть форму множини попри останню цифру.
   */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /**
   * Дата у форматі «11 серпня».
   *
   * Не toLocaleDateString: він дає «11 серп.» або «11.08.2026» залежно
   * від системної локалі, і в тому самому інтерфейсі дата виглядала б
   * по-різному на різних машинах.
   */
  function dateLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const months = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
                    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
    return d.getDate() + ' ' + months[d.getMonth()];
  }

  /**
   * Акценти. Поверхні спільні для всіх — різниця лише в хроматиці.
   *
   * Кольорові сімʼї (де тон заходив і в поверхні: рожевий фон, деревʼяний,
   * фіолетовий) прибрані з дизайну. Їхні id лишились у профілях людей, тому
   * тут є таблиця переїзду: старий id → найближчий графітовий акцент. Без неї
   * збережена «pink» перестала б знаходитись у списку й мовчки скидалась на
   * типову — людина побачила б чужий колір і не зрозуміла чому.
   */
  const THEMES = [
    'graphite', 'graphite-navy', 'graphite-pink', 'graphite-violet',
    'graphite-crimson', 'graphite-amber', 'graphite-moss',
    'graphite-emerald', 'graphite-ocean'
  ];

  const THEME_MIGRATE = {
    pink: 'graphite-pink', wood: 'graphite', violet: 'graphite-violet',
    crimson: 'graphite-crimson', amber: 'graphite-amber', moss: 'graphite-moss',
    emerald: 'graphite-emerald', ocean: 'graphite-ocean'
  };

  /** Старий id → чинний; невідоме → null (типовий Navy). */
  function normTheme(id) {
    if (!id) return null;
    if (THEMES.indexOf(id) !== -1) return id;
    return THEME_MIGRATE[id] || null;
  }

  /**
   * Застосувати акцент і запамʼятати вибір.
   *
   * Порядок сховищ важливий: localStorage читається інлайн-скриптом у head
   * ДО завантаження CSS — це прибирає блимання типової теми при переході
   * між сторінками. Профіль — щоб вибір переїхав у хмару, якщо вона є.
   * null означає типовий Navy: атрибут знімається, змінні повертаються з :root.
   */
  function setTheme(id, opts) {
    const t = normTheme(id);
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    try {
      if (t) localStorage.setItem('forge.theme', t);
      else localStorage.removeItem('forge.theme');
    } catch (_) {}

    /*
     * { save: false } — застосувати, не записуючи в профіль.
     *
     * Потрібне там, де тема ПРИЙШЛА з профілю (вхід на новому пристрої,
     * імпорт JSON): без цього прапорця виходив цикл «прочитали -> застосували
     * -> зберегли -> onChange -> прочитали», який на кожному завантаженні
     * марно ганяв запис у хмару.
     */
    if (opts && opts.save === false) return;

    if (window.Store) {
      window.Store.saveProfile({ theme: t }).catch(function (e) {
        // Мовчазний catch тут ховав відмову RLS і 500 від сервера: тема
        // мінялась на екрані, у хмару не доїжджала, і людина дізнавалась
        // про це лише на іншому пристрої.
        if (e && e.queued) return;   // офлайн — уже в черзі, це не помилка
        toast('Тему не збережено: ' + e.message, 'err');
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Схема: світло / темрява                                             */
  /* ------------------------------------------------------------------ */
  /*
   * Друга вісь оформлення, незалежна від акценту. Темрява — типова: сайт
   * задуманий як графітовий, і саме її людина бачить першою.
   *
   * Схема НЕ вгадується з системних налаштувань. Спокуса поставити
   * prefers-color-scheme була, але вона зробила б типовий вигляд сайту
   * лотереєю: у половини людей світло стоїть у системі цілодобово, і вони
   * побачили б папір там, де задумано графіт. Системна тема лишається
   * підказкою для браузера (color-scheme у CSS), а не рішенням за людину.
   */
  const SCHEMES = ['dark', 'light'];

  function currentScheme() {
    return document.documentElement.getAttribute('data-scheme') === 'light' ? 'light' : 'dark';
  }

  /**
   * Застосувати схему й запамʼятати вибір.
   *
   * Дзеркало setTheme: той самий порядок сховищ (localStorage читає
   * інлайн-скрипт у head, профіль везе вибір у хмару) і той самий
   * { save: false } для випадку «схема прийшла з профілю».
   */
  function setScheme(id, opts) {
    const v = SCHEMES.indexOf(id) !== -1 ? id : 'dark';
    if (v === 'light') document.documentElement.dataset.scheme = 'light';
    else delete document.documentElement.dataset.scheme;

    /*
     * Колір системної смуги браузера. Він живе в <meta>, а не в CSS, тому
     * єдиний спосіб тримати його в парі зі схемою — переписати руками.
     * Без цього на телефоні шапка Safari лишалась би графітовою над білою
     * сторінкою.
     */
    try {
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', v === 'light' ? '#e7e7e7' : '#0b0b0b');
    } catch (_) {}

    try {
      if (v === 'light') localStorage.setItem('forge.scheme', 'light');
      else localStorage.removeItem('forge.scheme');
    } catch (_) {}

    document.dispatchEvent(new CustomEvent('forge:scheme', { detail: { scheme: v } }));

    if (opts && opts.save === false) return;

    if (window.Store) {
      window.Store.saveProfile({ scheme: v }).catch(function (e) {
        if (e && e.queued) return;
        toast('Схему не збережено: ' + e.message, 'err');
      });
    }
  }

  function toggleScheme() {
    setScheme(currentScheme() === 'light' ? 'dark' : 'light');
  }

  /* ------------------------------------------------------------------ */
  /* Кнопка схеми в шапці                                                */
  /* ------------------------------------------------------------------ */
  /*
   * Перемикач стоїть у шапці, а не лише в акаунті: схему міняють не «раз і
   * назавжди», а посеред дня — коли зайшов у зал з вікнами або, навпаки,
   * ліг з телефоном. Дорога «Акаунт → прокрутити → Тема» для такого руху
   * задовга, і людина просто лишається в незручній схемі.
   *
   * Іконка показує, що БУДЕ після натискання (сонце в темряві, місяць у
   * світлі) — так само, як це роблять системні перемикачі.
   */
  const ICON_SUN =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="4.2"/>' +
    '<path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2' +
    'M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/></svg>';

  const ICON_MOON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/></svg>';

  function schemeButtonHtml() {
    return '<button class="nav__scheme" type="button" data-scheme-toggle></button>';
  }

  function paintSchemeButton(btn) {
    if (!btn) return;
    const light = currentScheme() === 'light';
    /* Підпис описує ДІЮ, а не поточний стан: читалка вимовляє «Увімкнути
       темну тему», а не «Світла тема», і людина знає, що станеться. */
    const label = light ? 'Увімкнути темну тему' : 'Увімкнути світлу тему';
    btn.innerHTML = light ? ICON_MOON : ICON_SUN;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }

  /** Один делегований обробник на документ: кнопок може бути кілька. */
  function wireSchemeToggle() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('[data-scheme-toggle]');
      if (!btn) return;
      toggleScheme();
    });
    document.addEventListener('forge:scheme', function () {
      $$('[data-scheme-toggle]').forEach(paintSchemeButton);
    });
  }

  window.App = {
    $: $, $$: $$,
    esc: esc, round: round, clamp: clamp, num: num,
    toast: toast,
    initReveal: initReveal,
    safeUrl: safeUrl,
    initAccordions: initAccordions,
    initLongform: initLongform,
    copyRich: copyRich,
    restTimer: { start: rtStart, stop: rtStop },
    plural: plural,
    fmt: fmt,
    fmtNum: numFmt,
    stampRating: stampRating,
    flashDone: flashDone,
    busy: busy,
    dateLabel: dateLabel,
    setTheme: setTheme,
    normTheme: normTheme,
    themes: THEMES,
    setScheme: setScheme,
    currentScheme: currentScheme,
    toggleScheme: toggleScheme,
    whenReady: whenReady
  };

  /* ------------------------------------------------------------------ */

  /**
   * Підтягнути тему з профілю.
   *
   * setTheme писав тему і в localStorage, і в профіль — але з профілю її
   * ніхто ніколи не читав. Через це вибір не переїжджав між пристроями:
   * обрав фіолетову на ноутбуці, зайшов з телефона під тим самим акаунтом —
   * базова navy. Локальний вибір має пріоритет (він уже застосований
   * інлайн-скриптом у head і належить саме цьому браузеру); профіль
   * використовується лише тоді, коли локально нічого не обрано.
   */
  function adoptProfileTheme() {
    if (!window.Store) return;

    /* Схема має власний ключ і власну перевірку: людина могла обрати світло
       на цьому пристрої, не чіпаючи акцент, — тоді акцент їде з профілю, а
       схема лишається локальною (і навпаки). */
    let localScheme = null;
    try { localScheme = localStorage.getItem('forge.scheme'); } catch (_) {}
    if (!localScheme) {
      window.Store.getProfile().then(function (p) {
        if (p && p.scheme) setScheme(p.scheme, { save: false });
      }, function () {});
    }

    let local = null;
    try { local = localStorage.getItem('forge.theme'); } catch (_) {}
    if (local) return;

    window.Store.getProfile().then(function (p) {
      if (p && p.theme) setTheme(p.theme, { save: false });
    }, function () {});
  }

  /**
   * Показати вміст, що б не сталося.
   *
   * Клас .js ставиться інлайн-скриптом у head беззастережно, а правило
   * .js .reveal { opacity: 0 } ховає весь текст до того, як initReveal його
   * розкриє. Захист покривав випадок «JS вимкнено», але не «JS зламався»:
   * будь-яка помилка до кінця boot() давала БІЛУ СТОРІНКУ без шапки й футера,
   * і людина не бачила навіть тексту, який у розмітці вже лежить.
   *
   * Тому знімаємо .js двома незалежними шляхами: одразу при першій помилці
   * і через таймер, якщо boot() чомусь не дійшов до кінця.
   */
  let booted = false;

  function rescue(why) {
    if (booted) return;
    document.documentElement.classList.remove('js');
    document.body && document.body.classList.add('is-ready');
    console.warn('[app] аварійний показ вмісту:', why);
  }

  window.addEventListener('error', function (e) {
    rescue((e && e.message) || 'помилка виконання');
  });

  function boot() {
    /*
     * Кожен крок окремо. Падіння одного не має забирати з собою решту:
     * зламана навігація — прикро, зламана навігація ПЛЮС порожня сторінка —
     * зовсім інша річ.
     */
    [buildNav, buildFooter, function () { initReveal(document); }, injectCanonical,
     function () { initAccordions(document); }, initCardGlow, injectJsonLd,
     wireSchemeToggle, adoptProfileTheme]
      .forEach(function (step) {
        try { step(); } catch (e) { console.error('[app] крок ініціалізації впав:', e); }
      });

    booted = true;
    document.body.classList.add('is-ready');
  }

  // Страховка на випадок, якщо boot() не запуститься взагалі
  setTimeout(function () { rescue('boot не відпрацював за 3 с'); }, 3000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
