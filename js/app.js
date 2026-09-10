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
   * «Мій план тренувань» і «Періодизація» ховались під «Програмами», а «Журнал» і
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
   * «Бокс» переїхав в «Інше»: це одне окреме тренування, а не щоденний
   * розділ. Воно ні з чим не звʼязане — ні з планом, ні зі статистикою,
   * ні з рейтингом — і живе в переліку розділів, як довідник.
   */
  /*
   * «Прогрес» став групою, а сама сторінка лишилась посиланням-батьком:
   * «Мої трекери» і «Forge Rating» відповідають на те саме питання «як у
   * мене справи» і раніше лежали в «Іншому» поруч із довідниками. Це
   * скоротило звалище з восьми пунктів до шести й нікому не додало
   * кліків: щоденні сторінки як були на верхньому рівні, так і лишились.
   *
   * «Бокс» лишається в «Іншому» — це одне окреме тренування, а не
   * щоденний розділ. Вхід до нього — постійне посилання в переліку
   * розділів і футер: «сторінка є, а входу немає» тут немає.
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
       щоденна дія — «зробити», а не «переналаштувати». «Мій план тренувань»
       лишається першим пунктом усередині. */
    { href: 'workout.html', label: 'Тренування', core: true, icon: 'train', children: [
      { href: 'workout.html',       label: 'Тренування' },
      { href: 'plan.html',          label: 'Мій план тренувань' },
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
    { href: 'plan.html',       label: 'Мій план тренувань' },
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

    /*
     * НАБІР ОБʼЄКТІВ — ЦЕ @graph, А НЕ МАСИВ.
     *
     * Голий масив не має @context на верхньому рівні й не є валідним
     * JSON-LD. Він зʼявлявся рівно на трьох сторінках (calculator,
     * nutrition, cardio) — і саме звідти в Sentry три однакові
     * TypeError: undefined is not an object (evaluating
     * 'r["@context"].toLowerCase') (WEB-007). Змінна навіть зветься graph,
     * але @graph не писався.
     *
     * Усередині @graph власний @context кожного обʼєкта зайвий: він один
     * на весь документ.
     */
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.textContent = JSON.stringify(graph.length === 1 ? graph[0] : {
      '@context': 'https://schema.org',
      '@graph': graph.map(function (o) {
        const copy = Object.assign({}, o);
        delete copy['@context'];
        return copy;
      })
    });
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
  /*
   * Кожна іконка несе власний viewBox: малюнки прийшли з різних полотен,
   * і зводити їх до спільної сітки перерахунком координат — зайвий шанс
   * помилитись. Квадрат обчислено по межах фігури з однаковим оптичним
   * полем, тому в панелі всі виглядають однакового розміру.
   *
   * today/train/food суцільні: заливка бере currentColor, тож активний
   * розділ підсвічується так само, як і раніше. progress лишився
   * обведенням (він так намальований), але з важчою лінією — поруч із
   * суцільними тонкий контур читався б блідим.
   */
  /* Контур половини книги (js/app.js — єдине місце, де він живе). */
  const BOOK = 'M3079 9106 c-2 -2 -101 -11 -219 -20 -767 -59 -1557 -260 -2170 -554 -129 -62 -243 -216 -276 -372 -30 -147 -15 -7160 16 -7240 91 -232 286 -375 530 -387 121 -7 181 12 429 137 441 220 786 345 1171 424 332 67 599 96 895 96 800 0 1581 -210 2226 -601 244 -148 383 -189 638 -189 141 0 141 0 141 3866 0 3678 -1 3866 -17 3859 -121 -52 -129 -49 -345 94 -685 455 -1670 802 -2428 856 -47 4 -152 13 -234 21 -138 13 -347 19 -357 10z m517 -776 c783 -80 1368 -280 2024 -690 244 -152 310 -209 328 -282 16 -61 17 -5184 2 -5239 -30 -106 -85 -107 -302 -4 -1350 640 -2917 664 -4212 63 -159 -74 -215 -75 -253 -5 -27 48 -28 5664 -1 5712 43 78 103 109 401 209 640 214 1379 300 2013 236z';

  const TAB_ICONS = {
    today: { vb: '-20.24 -5.24 284.48 284.48',
      d: '<path fill="currentColor" fill-rule="evenodd" d="M122 10 L234 122 L234 264 L157 264 L157 172 L87 172 L87 264 L10 264 L10 122 Z"/>' },
    train: { vb: '165 169.32 923.82 923.82',
      d: '<g fill="currentColor"><path d="M 289.536 218.809 H 345.969 A 13.027 13.027 0 0 1 358.996 231.836 V 411.787 A 13.027 13.027 0 0 1 345.969 424.814 H 289.536 A 13.027 13.027 0 0 1 276.509 411.787 V 231.836 A 13.027 13.027 0 0 1 289.536 218.809 Z"/><path d="M 907.851 218.809 H 964.284 A 13.027 13.027 0 0 1 977.311 231.836 V 411.787 A 13.027 13.027 0 0 1 964.284 424.814 H 907.851 A 13.027 13.027 0 0 1 894.824 411.787 V 231.836 A 13.027 13.027 0 0 1 907.851 218.809 Z"/><path d="M 227.335 258.925 H 236.930 A 9.533 9.533 0 0 1 246.463 268.458 V 376.031 A 9.533 9.533 0 0 1 236.930 385.564 H 227.335 A 9.533 9.533 0 0 1 217.802 376.031 V 268.458 A 9.533 9.533 0 0 1 227.335 258.925 Z"/><path d="M 1016.890 258.925 H 1026.485 A 9.533 9.533 0 0 1 1036.018 268.458 V 376.031 A 9.533 9.533 0 0 1 1026.485 385.564 H 1016.890 A 9.533 9.533 0 0 1 1007.357 376.031 V 268.458 A 9.533 9.533 0 0 1 1016.890 258.925 Z"/><rect x="296.509" y="303.464" width="660.802" height="31.162"/><ellipse cx="626.910" cy="471.784" rx="72.371" ry="74.302"/><path d="M 626.910 575.410 L 568.741 575.410 L 456.638 364.625 A 29.056 29.056 0 0 0 405.059 391.388 L 518.939 616.803 C 530.134 638.943 539.245 689.836 547.988 751.006 L 459.071 835.085 A 33.269 33.269 0 0 0 448.660 859.258 L 448.660 1009.500 A 34.145 34.145 0 0 0 516.950 1009.500 L 516.950 893.461 A 30.000 30.000 0 0 1 527.305 870.788 L 571.567 832.437 A 30.000 30.000 0 0 1 591.212 825.110 L 626.910 825.110 L 662.608 825.110 A 30.000 30.000 0 0 1 682.253 832.437 L 726.515 870.788 A 30.000 30.000 0 0 1 736.870 893.461 L 736.870 1009.500 A 34.145 34.145 0 0 0 805.160 1009.500 L 805.160 859.258 A 33.269 33.269 0 0 0 794.749 835.085 L 705.832 751.006 C 714.575 689.836 723.686 638.943 734.881 616.803 L 848.761 391.388 A 29.056 29.056 0 0 0 797.182 364.625 L 685.079 575.410 L 626.910 575.410 Z"/></g>' },
    food: { vb: '1.66 1.36 21.28 21.28',
      d: '<path d="M5 2.5h1.6v6h1.1v-6h1.6v6h1.1v-6H12V10a2.6 2.6 0 0 1-2.4 2.59V21.5H7.4V12.59A2.6 2.6 0 0 1 5 10Z"/><path d="M19.6 2.5v19h-1.8v-9.3h-1.6c0-5 1.2-8.5 3.4-9.7z"/>' },
    /* «Акаунт» знака в нижній панелі не має — там лише чотири щоденні
       розділи. Але малюнок живе в тій самій таблиці: інакше довелося б
       заводити другу, і два джерела знаків розійшлися б. */
    account: { vb: '-20.86 -5.36 286.72 286.72',
      d: '<path fill="currentColor" fill-rule="evenodd" d="M122.5 10 L235 122.5 L235 266 L10 266 L10 122.5 Z M122.5 79 A35.5 35.5 0 1 0 122.5 150 A35.5 35.5 0 1 0 122.5 79 Z M108.5 164 H136.5 A42 42 0 0 1 178.5 206 V232 A8 8 0 0 1 170.5 240 H74.5 A8 8 0 0 1 66.5 232 V206 A42 42 0 0 1 108.5 164 Z"/>' },
    /*
     * Розгорнута книжка — знак довідки в шапці.
     *
     * Малюнок свій, а не з чужого набору: решта знаків тут — важка
     * геометрія без заокруглень (силует ковадла, будинок, стійка), і
     * тонкий контурний значок із icon-паку читався б як чужий елемент.
     * Дві сторінки з проміжком посередині: проміжок і є корінцем, тому
     * окремої лінії для нього не треба.
     */
    /*
     * Довідка — відкрита книга з набору проєкту (іконки SVG/06-guide.svg).
     * Полотно й контур узяті з файлу без змін; прибрано лише чорний
     * прямокутник фону й білу заливку — колір дає currentColor, як у
     * решти знаків. Права половина не окремий контур, а дзеркало лівої:
     * саме так вона намальована в оригіналі (симетрія 0,9996 по IoU),
     * і зберігати її другим набором координат означало б дати їм
     * розійтися при першому ж правленні.
     *
     * viewBox тісний (0 0 1268 952), без добивання до квадрата: полотно
     * книги ширше за висоту, і квадратна рамка з'їдала б чверть висоти
     * знака — у шапці він виходив помітно дрібнішим за сусідні іконки при
     * тому самому CSS-розмірі. Тому в css/style.css у нього своя пара
     * ширина/висота, а не спільні 19×19.
     */
    help: { vb: '0 0 1268 952',
      d: '<g transform="translate(0 952) scale(.1 -.1)"><path d="' + BOOK + '"/></g>' +
         '<g transform="translate(1268 0) scale(-1 1)">' + '<g transform="translate(0 952) scale(.1 -.1)"><path d="' + BOOK + '"/></g>' + '</g>' },
    progress: { vb: '-5.05 -6.8 308 308',
      d: '<g fill="none" stroke="currentColor" stroke-width="22.0" stroke-linecap="round" stroke-linejoin="round"><path d="M24.01 166.98 A126.5 126.5 0 1 1 46.94 222.00 L90.7 165.6 L144.9 202.2 L201.4 111.5"/><path d="M152 122.1 L201.4 111.5 L216 157.8"/></g>' }
  };

  function tabIcon(name) { return navIcon(name, 'tabbar__ico'); }

  /**
   * Той самий малюнок для шапки. Таблиця одна: якби знак у шапці й знак у
   * нижній панелі жили окремими копіями, вони б із часом розійшлися —
   * а це рівно ті два місця, де людина порівнює їх поглядом.
   */
  function navIcon(name, cls) {
    const ico = TAB_ICONS[name];
    if (!ico) return '';
    return '<svg class="' + cls + '" viewBox="' + ico.vb +
      '" fill="currentColor" aria-hidden="true">' + ico.d + '</svg>';
  }

  /** Чи належить сторінка розділу — сам розділ або будь-яка його дитина */
  function sectionOwns(group, page) {
    if (group.href === page) return true;
    return (group.children || []).some(function (c) { return c.href === page; });
  }

  /*
   * РОЗМІТКА ПАНЕЛІ: ЗОНА → КАПСУЛА → ПУНКТИ.
   *
   * Зайвий div навколо <nav> не декоративний. Панель має власний
   * backdrop-filter, тобто вона backdrop root для своїх дітей — і лінза
   * всередині неї заломлювала б порожнечу. Лінза мусить бути СУСІДОМ
   * панелі, а сусідам потрібен спільний позиційований батько. Ним і є
   * зона (див. js/liquid-glass.js, розділ про backdrop root).
   *
   * Підписи знову видимі. Раніше вони були sr-only, бо панель тягнулась
   * на всю ширину й іконки стояли поодинці; у капсулі з плашкою активного
   * підпис — частина форми: без нього плашка охоплює саму лише іконку й
   * виглядає випадковою плямою.
   */
  function buildTabBar(page) {
    const core = NAV_GROUPS.filter(function (g) { return g.core; });
    if (!core.length) return;

    let zone = document.getElementById('tabbar');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'tabbar';
      zone.className = 'tabbar';
      document.body.appendChild(zone);
    }

    const items = core.map(function (g) {
      const active = sectionOwns(g, page);
      /*
       * draggable="false" — не косметика. Протяг по посиланню мишею
       * запускає рідне перетягування <a>, браузер забирає жест собі й
       * шле pointercancel — лінза гасне на першому ж русі, а перехід не
       * відбувається. На тачскріні того самого ефекту не буде, але
       * панель має працювати й під мишею (сенсорні ноутбуки, DevTools).
       */
      return '<a class="tabbar__item' + (active ? ' is-active' : '') + '" href="' + g.href +
             '" draggable="false"' +
             (active ? ' aria-current="page"' : '') + '>' +
               tabIcon(g.icon) +
               '<span class="tabbar__lbl">' + esc(g.label) + '</span>' +
             '</a>';
    }).join('');

    zone.innerHTML = '<nav class="tabbar__bar" aria-label="Основні розділи">' + items + '</nav>';
    zone.style.setProperty('--tb-n', core.length);

    /* Панель перекриває низ сторінки, тому вміст отримує відступ рівно на
       її висоту. Клас на <body>, а не padding у CSS сторінки: висота
       залежить від безпечної зони iOS і живе в одній змінній. */
    document.body.classList.add('has-tabbar');

    enhanceTabBar(zone);
  }

  /*
   * СКЛО ВАНТАЖИТЬСЯ ЛИШЕ ТАМ, ДЕ ПАНЕЛЬ СПРАВДІ Є.
   *
   * Два файли оптики важать близько 25 КБ, і на десктопі вони не потрібні
   * взагалі: там розділи стоять у шапці, а панелі немає (@media
   * max-width: 900px). Тому вони не в <head> кожної з двадцяти трьох
   * сторінок, а підвантажуються звідси — після того, як зʼясувалось, що
   * панель видима. Тег <script src> із власного домену політика
   * script-src 'self' дозволяє; inline-скриптів тут немає.
   *
   * Без цих файлів панель лишається робочою: капсула, плашка активного й
   * підписи — звичайний CSS. Зникає тільки лінза. Тому помилка
   * завантаження нічого не ламає й нічого не повідомляє.
   */
  let glassLoading = false;

  function enhanceTabBar(zone) {
    if (window.TabBarGlass) { window.TabBarGlass.init(zone); return; }
    if (glassLoading) return;
    /* getComputedStyle, а не matchMedia з тим самим числом: точка
       перемикання живе в CSS, і другий її запис у JS розійшовся б із
       першим при найближчій правці. */
    if (getComputedStyle(zone).display === 'none') return;
    glassLoading = true;

    const add = function (src, next) {
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.onload = next || null;
      s.onerror = function () { glassLoading = false; };
      document.head.appendChild(s);
    };
    add('js/liquid-glass.js', function () {
      add('js/tabbar-glass.js', function () {
        if (window.TabBarGlass) window.TabBarGlass.init(zone);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Значок рівня                                                        */
  /* ------------------------------------------------------------------ */
  /*
   * ЖЕТОН РІВНЯ: скляна кулька, дуга-шкала й число всередині.
   *
   * Влаштований просто, і саме тому малюється кодом, а не лежить десятьма
   * файлами (як було: icons/levels/lvl-1..10.svg). Десять майже однакових
   * малюнків розходяться при першій же правці — досить поміняти товщину
   * дуги в дев’яти з них.
   *
   * ГЕОМЕТРІЯ. Коло, всередині нього дуга, що повторює коло, з розривом
   * УНИЗУ приблизно на пʼяту частину (72°). Дуга заповнюється й міняє
   * колір із рівнем; у центрі — число рівня.
   *
   * Дуга — це штрих кола зі stroke-dasharray, а не <path> з командою A:
   * так довжину видно числом (частка від 288°), і не треба рахувати
   * координати кінців. Поворот на 126° ставить початок дуги на лівий
   * край розриву, тож заповнення йде за годинниковою від низу вліво —
   * як у спідометра.
   *
   * ЯК ЗРОБЛЕНЕ СКЛО. Тут — саме ТІЛО: один ледь помітний градієнт, який
   * дає товщу. Полиску тут НЕМАЄ: він був радіальною плямою у верхньому
   * лівому куті й читався як засвіт по всій кульці, а не як відблиск на
   * склі. Чисте скельце не світиться зсередини — воно має тільки край.
   * Край (фаску й тінь) малює CSS багатошаровим inset box-shadow — див.
   * .lvl-ico в style.css. Кант, намальований дугою в SVG, теж прибрано:
   * коло, задане border-radius:50%, рівне завжди, а дуга-кант залежала
   * від градієнта й читалася як крива.
   *
   * ЧОМУ ТІЛО НА ВЕСЬ viewBox (r = 50). Стовп розмиття обрізається
   * border-radius: 50% по межі елемента. Менший радіус лишав би по краю
   * кільце розмиття без скла над ним.
   *
   * ІНЛАЙН, А НЕ <img>. Малюнок залежить від змінних теми (--lvl-tone,
   * --tint-rgb), а <img> у власному документі до них не дістає. Ціна —
   * розмітка в кожному місці показу; місць три.
   *
   * КОЛІР — У CSS, НЕ В АТРИБУТАХ. У розмітці лишилася сама геометрія;
   * усі відтінки — на класах у style.css. Причина не в охайності: var()
   * у презентаційних атрибутах SVG (stop-color="rgba(var(--x),.1)")
   * працює не в кожному рушії, тоді як stop-color у таблиці стилів —
   * звичайна CSS-властивість і працює скрізь.
   */
  const LEVEL_MIN = 1, LEVEL_MAX = 10;
  /* Розрив унизу — пʼята частина кола. Дуга, отже, 288°. */
  const LVL_ARC = 288;
  const LVL_R = 38;
  const LVL_C = 2 * Math.PI * LVL_R;
  /* Лічильник, а не Math.random(): ідентифікатори градієнтів мають бути
     різні в межах документа (інакше другий жетон візьме градієнти
     першого) і водночас передбачувані — інакше їх не перевірити тестом. */
  let lvlSeq = 0;

  function levelIcon(level, label) {
    const n = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(Number(level) || LEVEL_MIN)));
    const track = LVL_C * LVL_ARC / 360;
    /* Рівень 1 — це вже пройдений перший крок зі свого діапазону, а не
       нуль: порожня шкала на першому рівні читалась би як «нічого немає»,
       хоч акаунт уже в сезоні. */
    const done = track * (n / LEVEL_MAX);
    const dash = function (len) {
      return ' stroke-dasharray="' + len.toFixed(2) + ' ' + (LVL_C - len).toFixed(2) + '"';
    };
    const id = 'lvl' + (++lvlSeq);

    return '<svg class="lvl-ico is-l' + n + (n > 9 ? ' is-wide' : '') + '" viewBox="0 0 100 100" '
         +      'role="img" aria-label="' + esc(label || ('Level ' + n)) + '">'
         +   '<defs>'
              /* Тіло скла: згори світліше, донизу темніше. */
         +     '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="0" y2="1">'
         +       '<stop class="lvl-ico__b0" offset="0"/>'
         +       '<stop class="lvl-ico__b1" offset="1"/>'
         +     '</linearGradient>'
         +   '</defs>'
         +   '<circle class="lvl-ico__body" cx="50" cy="50" r="50" fill="url(#' + id + 'b)"/>'
              /* Поворот на 126° ставить нуль шкали на лівий край розриву. */
         +   '<g transform="rotate(126 50 50)">'
         +     '<circle class="lvl-ico__track" cx="50" cy="50" r="' + LVL_R + '" fill="none"'
         +       dash(track) + '/>'
         +     '<circle class="lvl-ico__fill" cx="50" cy="50" r="' + LVL_R + '" fill="none"'
         +       dash(done) + '/>'
         +   '</g>'
         +   '<text class="lvl-ico__n" x="50" y="50" text-anchor="middle" '
         +     'dominant-baseline="central">' + n + '</text>'
         + '</svg>';
  }

  /* ------------------------------------------------------------------ */
  /* Перехід через північ                                                */
  /* ------------------------------------------------------------------ */
  /*
   * Сторінки рахують ключ дня один раз при завантаженні (state.todayKey) і
   * далі використовують його в кожному записі. Вкладка, відкрита ввечері й
   * не перезавантажена, після півночі писала галочки тренування і трекери
   * у ВЧОРАШНЮ дату — тобто перетирала вчорашню сесію й лишала дірку в
   * сьогоднішній.
   *
   * Тут один спільний сторож: перевірка щохвилини й при поверненні на
   * вкладку (телефон уночі спить, таймери не спрацьовують). Сторінка сама
   * вирішує, що робити — зазвичай перечитати ключ і перемалюватись.
   */
  function localDayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }

  function onDayChange(cb) {
    if (typeof cb !== 'function') return;
    let seen = localDayKey();
    const check = function () {
      const now = localDayKey();
      if (now === seen) return;
      seen = now;
      try { cb(now); } catch (e) { console.warn('[app] onDayChange:', e && e.message); }
    };
    setInterval(check, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) check();
    });
    window.addEventListener('focus', check);
  }

  /* ------------------------------------------------------------------ */
  /* Блокування прокрутки фону під модалкою                              */
  /* ------------------------------------------------------------------ */
  /*
   * body { overflow: hidden } на iOS Safari блокує фон ненадійно: сторінка
   * під вікном усе одно «протягується», а після закриття людина
   * опиняється не там, де була. Тому позиція фіксується явно, а прокрутка
   * повертається на те саме місце.
   *
   * Лічильник, а не булеве значення: якщо колись відкриються два шари
   * (вікно поверх вікна), закриття верхнього не має розблоковувати фон.
   */
  let scrollLocks = 0;
  let lockedAt = 0;

  function lockScroll(on) {
    const b = document.body;
    if (on) {
      scrollLocks++;
      if (scrollLocks > 1) return;
      lockedAt = window.scrollY || window.pageYOffset || 0;
      b.style.position = 'fixed';
      b.style.top = (-lockedAt) + 'px';
      b.style.left = '0';
      b.style.right = '0';
      b.style.width = '100%';
      b.style.overflow = 'hidden';
      return;
    }
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks > 0) return;
    b.style.position = '';
    b.style.top = '';
    b.style.left = '';
    b.style.right = '';
    b.style.width = '';
    b.style.overflow = '';
    window.scrollTo(0, lockedAt);
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

  /*
   * Значок рівня має два законні місця, і це не примха верстки:
   *
   *   ≥ 1061px — між «Іншим» і «Акаунтом» усередині .nav__links;
   *   ≤ 1060px — .nav__links стає fixed-накладкою й ховається в бургер,
   *              тож значок переїжджає в .nav__actions, інакше зникав би
   *              із шапки разом із меню.
   *
   * Один елемент, який переставляється, а не два копії: дві копії
   * розійшлися б станами (is-active, aria-label) при першій же правці.
   */
  const NAV_WIDE = window.matchMedia ? window.matchMedia('(min-width: 1061px)') : null;

  function placeRatingBadge(el) {
    const badge = el || document.querySelector('.nav__rating');
    if (!badge) return;
    const links = document.querySelector('.nav__links');
    const acts  = document.querySelector('.nav__actions');
    const edge  = document.querySelector('.nav__link--edge');
    const wide  = !NAV_WIDE || NAV_WIDE.matches;
    if (wide) {
      /* Строго перед «Акаунтом»: саме цей порядок дає центрування в
         проміжку (авто-поля значка проти margin-left:0 у краю). */
      if (links && edge && badge.nextElementSibling !== edge) links.insertBefore(badge, edge);
    } else if (acts) {
      const burger = acts.querySelector('.nav__burger');
      if (badge.nextElementSibling !== burger) acts.insertBefore(badge, burger);
    }
  }

  if (NAV_WIDE) {
    const onWidth = function () { placeRatingBadge(); };
    if (NAV_WIDE.addEventListener) NAV_WIDE.addEventListener('change', onWidth);
    else if (NAV_WIDE.addListener) NAV_WIDE.addListener(onWidth);
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
      el.innerHTML = levelIcon(lvl.level, lvl.name);
      el.classList.toggle('is-elite', lvl.elite);
      placeRatingBadge(el);
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
      /*
       * «Є незіслані зміни» має ДВА джерела: чергу і позначку
       * ib.profile.dirty. Позначка читала лише чергу (SYN-019) — а всі
       * HTTP-помилки запису (400, 401, 403, 409, 429, 500) лишають чергу
       * порожньою і ставлять саме dirty. Тобто рівно тоді, коли попередити
       * треба найбільше, значок мовчав.
       */
      const n = (typeof S.unsyncedCount === 'function') ? S.unsyncedCount() : S.pendingCount();
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
            /*
             * Кнопка довідки. Одна на весь сайт — вміст залежить від
             * поточної сторінки (js/help-content.js). Стоїть у шапці
             * ліворуч від решти дій: до неї тягнуться, коли не розуміють
             * екран, тобто раніше, ніж до синхронізації чи меню.
             *
             * hidden доти, доки js/help.js не переконався, що для цієї
             * сторінки розділ довідки взагалі є: кнопка, яка відкриває
             * порожнє вікно, гірша за її відсутність.
             */
            '<button class="nav__help" type="button" data-help-open hidden ' +
                    'aria-label="Довідка про цей розділ" title="Довідка">' +
              navIcon('help', 'nav__ico') +
            '</button>' +
            '<a class="nav__sync" href="account.html" hidden>' +
              '<span class="nav__sync-dot" aria-hidden="true"></span>' +
              '<span class="nav__sync-txt">Не синхронізовано</span>' +
            '</a>' +
          '</div>' +
        '</div>';
      renderSyncBadge($('.nav__sync', host));
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

      /*
       * Звичайний пункт без вкладень — просто посилання. Виняток —
       * «Сьогодні»: у шапці це знак будинку без підпису.
       *
       * Підпис НЕ видаляється, а ховається класом на вузькі екрани: у
       * бургері меню вертикальне, там знак замість слова читався б гірше
       * за слово. І доступна назва лишається в aria-label, тож на
       * десктопі посилання не перетворюється на «посилання index.html».
       */
      if (!children.length) {
        const act = (g.href === page ? ' is-active' : '');
        if (g.icon) {
          return '<a class="nav__link nav__link--icon' + act + '" href="' + g.href +
                 '" aria-label="' + esc(g.label) + '">' +
                   navIcon(g.icon, 'nav__ico') +
                   '<span class="nav__lbl">' + esc(g.label) + '</span>' +
                 '</a>';
        }
        return '<a class="nav__link' + act + '" href="' + g.href + '">' + esc(g.label) + '</a>';
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
      /* Значок рівня стоїть МІЖ «Іншим» і «Акаунтом» і центрується в
         проміжку між ними (див. .nav__rating у CSS). hidden доти, доки
         рейтинг реально не порахований. */
      '<a class="nav__rating" href="rating.html" aria-label="Forge Rating" hidden></a>' +
      '<a class="nav__link nav__link--icon nav__link--edge' +
        (NAV_EDGE.href === page ? ' is-active' : '') + '" href="' + NAV_EDGE.href +
        '" aria-label="' + esc(NAV_EDGE.label) + '">' +
          navIcon('account', 'nav__ico') +
          '<span class="nav__lbl">' + esc(NAV_EDGE.label) + '</span>' +
        '</a>';

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
        // Праворуч: стан синхронізації, перемикач схеми, бургер. Значок
        // рівня живе в nav__links (між «Іншим» і «Акаунтом»), але на
        // мобільному цей список стає fixed-накладкою й випадає з потоку —
        // тоді placeRatingBadge() переносить значок сюди, щоб він не
        // зникав із шапки разом із меню.
        '<div class="nav__actions">' +
          '<button class="nav__help" type="button" data-help-open hidden ' +
                  'aria-label="Довідка про цей розділ" title="Довідка">' +
            navIcon('help', 'nav__ico') +
          '</button>' +
          // Стан синхронізації. За звичайних умов його НЕМАЄ взагалі —
          // зʼявляється лише коли є що досилати (див. renderSyncBadge).
          '<a class="nav__sync" href="account.html" hidden>' +
            '<span class="nav__sync-dot" aria-hidden="true"></span>' +
            '<span class="nav__sync-txt">Не синхронізовано</span>' +
          '</a>' +
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
  /* Світло на жетоні рівня                                              */
  /* ------------------------------------------------------------------ */
  /*
   * НАХИЛ ЖЕТОНА ПІД КУРСОРОМ.
   *
   * Скло, однакове під будь-яким кутом, — не скло, а малюнок скла.
   * Раніше тут був блик, що їхав за вказівником; його прибрано —
   * світла пляма на кульці 39px читалась як засвіт, а не як відблиск.
   * Лишився нахил: кулька повертається до курсора, і разом з нею
   * повертається край, тобто те єдине, чим це скло взагалі світить.
   *
   * ПЕРСПЕКТИВА МАЛА (140px проти 900px у картки) саме тому, що жетон
   * малий: на великій перспективі ті самі градуси дають зміщення в
   * пів пікселя й ефекту не видно взагалі.
   *
   * Механіка та сама, що в initCardGlow: один делегований слухач,
   * getBoundingClientRect рівно раз на кадр, повне вимкнення там, де
   * наводити нічим (дотик) або де просили спокою.
   */
  const BADGE_SEL = '.nav__rating, .lvl-circle';

  function initBadgeGlass() {
    const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || calm) return;

    let hot = null;
    let pending = null;
    let frame = 0;

    /* Більше — і цифра на дальшому краю починає «пливти». */
    const TILT = 14;

    const flush = function () {
      frame = 0;
      if (!pending || !hot) { pending = null; return; }
      const x = pending.x, y = pending.y;
      pending = null;
      const r = hot.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const nx = (x - r.left) / r.width, ny = (y - r.top) / r.height;
      hot.style.setProperty('--lvl-rx', ((0.5 - ny) * 2 * TILT).toFixed(2) + 'deg');
      hot.style.setProperty('--lvl-ry', ((nx - 0.5) * 2 * TILT).toFixed(2) + 'deg');
      /* Перехід вимикається ПІСЛЯ першого кадру: на вхід нахил має
         зʼявитись плавно, а далі йти за курсором без відставання. */
      hot.classList.add('is-tilting');
    };

    const cool = function () {
      if (!hot) return;
      hot.classList.remove('is-hot', 'is-tilting');
      hot.style.removeProperty('--lvl-rx');
      hot.style.removeProperty('--lvl-ry');
      hot = null;
    };

    document.addEventListener('pointermove', function (e) {
      const el = e.target.closest ? e.target.closest(BADGE_SEL) : null;
      if (!el) { cool(); return; }
      if (el !== hot) { cool(); hot = el; el.classList.add('is-hot'); }
      pending = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(flush);
    }, { passive: true });

    /* Вказівник може піти зі сторінки, не пройшовши по ній: тоді
       pointermove більше не прилетить, і жетон лишився б підсвіченим. */
    document.addEventListener('pointerleave', cool, { passive: true });
    window.addEventListener('blur', cool, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /* Акордеони                                                           */
  /* ------------------------------------------------------------------ */

  let accSeq = 0;

  /* ------------------------------------------------------------------ */
  /* Нахил і блик на скляних поверхнях                                    */
  /* ------------------------------------------------------------------ */
  /*
   * ЩО РОБИТЬ. Стежить за вказівником і кладе в поверхню під ним чотири
   * числа: два кути нахилу й позицію блику. Усе інше — CSS: і сам нахил,
   * і блик, і приглушення сусідів. Тут немає жодного стилю, тільки
   * координати.
   *
   * ЧОМУ ОДИН СЛУХАЧ НА ДОКУМЕНТ. pointermove — найчастіша подія в
   * браузері. Слухач на кожній поверхні означав би десятки підписок, які
   * треба знімати при кожній перемальовці (а сторінки перемальовуються
   * на кожну зміну профілю). Делегування живе, доки живе сторінка.
   *
   * ЧОМУ rAF. Вказівник шле до 120 подій на секунду, екран малює 60. Без
   * дроселя ми рахували б getBoundingClientRect удвічі частіше, ніж це
   * можна побачити — і робили б це в обробнику події, тобто в
   * найгіршому місці для читання розкладки.
   *
   * ЧОМУ ГЕОМЕТРІЯ КЕШУЄТЬСЯ. getBoundingClientRect змушує браузер
   * перерахувати розкладку. Робити це на кожен рух миші по чотирьох
   * картках — найпростіший спосіб перетворити красиву дрібницю на
   * гальмування. Розміри читаються раз на вхід у картку й скидаються на
   * прокрутці та зміні розміру вікна.
   */
  const TILT_MAX = 7;   /* градусів; більше — і текст на дальньому краї «пливе» */

  /*
   * ЩО ВВАЖАЄТЬСЯ СКЛЯНОЮ ПОВЕРХНЕЮ. Той самий перелік, що й у CSS у
   * правилі «ПОВЕРХНЯ СКЛА»: картки вибору, плитки з числами,
   * плитки-посилання. Тримати його в одному рядку тут — єдиний спосіб не
   * розійтися з CSS: розійдуться — і частина поверхонь мовчки перестане
   * нахилятись, лишившись при цьому склом на вигляд.
   *
   * .card--off не бере участі: нахиляти те, що не можна обрати, означає
   * обіцяти дію, якої немає.
   */
  const GLASS = '.card--glass:not(.card--off), .kpi, .tile';

  /*
   * ОДИН СЛУХАЧ НА ВЕСЬ ДОКУМЕНТ, А НЕ НА КОЖЕН КОНТЕЙНЕР.
   *
   * Було: слухач вішався на кожен вузол із [data-tilt], і нахил мали
   * тільки ті сітки, куди хтось не забув поставити атрибут. Плитки його
   * не мали ніде — тому й лишались мертвими.
   *
   * Стало: підписка одна, поставлена раз. Плитки перемальовуються часто
   * (кожна зміна профілю), і підписка, привʼязана до вузла, після
   * перемальовки вказувала б у нікуди. Делегування на документі цього
   * не помічає взагалі.
   *
   * initTilt(root) лишається як вхідна точка: його викликають з boot і
   * зі сторінок після перемальовки. Аргумент більше не потрібен, але
   * виклики зі старим аргументом мусять і далі працювати.
   */
  let tiltWired = false;
  function initTilt() {
    if (tiltWired) return;
    tiltWired = true;
    wireTilt(document);
  }

  function wireTilt(host) {
    /* Ефект — для курсора. На дотику нахиляти нічим, а pointermove там
       сперечається з прокруткою. */
    try {
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch (_) { return; }

    let cards = [];      /* сусіди гарячої поверхні — тільки її сітка */
    let hot = null;      /* картка під курсором */
    let rect = null;     /* її геометрія, поки курсор усередині */
    let frame = 0;
    let pending = null;

    /*
     * СУСІДИ — ЦЕ СПІЛЬНИЙ БАТЬКО, А НЕ ВСЯ СТОРІНКА.
     *
     * Приглушення сусідів (.is-cold) має показати, яку саме річ ти зараз
     * розглядаєш. Поки слухач висів на сітці з чотирьох карток, «усі
     * інші» й означало «три сусідні». На документі це означало б УСЕ
     * скло сторінки: наведення на одну плитку гасило б на половину і
     * картку тренування, і решту плиток, і КПІ вгорі — тобто не
     * підсвічувало б одну річ, а блимало б цілим екраном.
     */
    const list = function (card) {
      const box = (card && card.parentElement) || host;
      cards = [].slice.call(box.querySelectorAll(GLASS));
      return cards;
    };

    const cool = function () {
      cards.forEach(function (c) {
        c.classList.remove('is-hot', 'is-cold', 'is-tilting');
        c.style.removeProperty('--tilt-x');
        c.style.removeProperty('--tilt-y');
      });
      cards = [];
      hot = null; rect = null;
    };

    const apply = function () {
      frame = 0;
      if (!hot || !rect || !pending) return;
      const nx = (pending.x - rect.left) / rect.width;
      const ny = (pending.y - rect.top) / rect.height;
      /* Верх картки нахиляється ДО глядача, низ — від нього: інакше рух
         читається навпаки, як провал під курсором. */
      hot.style.setProperty('--tilt-x', ((0.5 - ny) * 2 * TILT_MAX).toFixed(2) + 'deg');
      hot.style.setProperty('--tilt-y', ((nx - 0.5) * 2 * TILT_MAX).toFixed(2) + 'deg');
      hot.style.setProperty('--spot-x', (nx * 100).toFixed(1) + '%');
      hot.style.setProperty('--spot-y', (ny * 100).toFixed(1) + '%');
    };

    host.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const card = e.target.closest && e.target.closest(GLASS);
      if (!card) { if (hot) cool(); return; }

      if (card !== hot) {
        cool();
        hot = card;
        rect = card.getBoundingClientRect();
        list(card).forEach(function (c) {
          c.classList.toggle('is-hot', c === card);
          c.classList.toggle('is-cold', c !== card);
        });
        /* Клас переходу вмикаємо НАСТУПНИМ кадром: інакше вхід у картку
           теж утратив би плавність і вона б смикалась із нуля. */
        requestAnimationFrame(function () { if (hot === card) card.classList.add('is-tilting'); });
      }
      pending = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
    });

    host.addEventListener('pointerleave', cool);
    /* Геометрія застаріває від прокрутки й зміни розміру — простіше
       відпустити картку, ніж міряти на кожному кадрі прокрутки. */
    window.addEventListener('scroll', function () { if (hot) cool(); }, { passive: true });
    window.addEventListener('resize', function () { if (hot) cool(); });
  }

  /* ------------------------------------------------------------------ */
  /* Сегментований перемикач: виділення, що їздить                        */
  /* ------------------------------------------------------------------ */
  /*
   * ЩО ЦЕ РОБИТЬ. Міряє обраний крок .seg і кладе його позицію й розмір у
   * CSS-змінні доріжки. Малює виділення сам CSS (.seg::before), тут лише
   * числа — тому анімацію тримає браузер, а не JS.
   *
   * ЧОМУ ЦЕ ТУТ, А НЕ В КОЖНІЙ СТОРІНЦІ. .seg будують вісім місць у
   * пʼятьох файлах (журнал, акаунт, адмінка, плани…), і половина з них
   * перемальовує розмітку цілком при кожній зміні профілю. Механізм на
   * кожній сторінці означав би вісім копій, які розійдуться.
   *
   * ЧОМУ MutationObserver, А НЕ ВИКЛИК ПІСЛЯ КОЖНОГО РЕНДЕРУ. Той самий
   * розрахунок: вісім місць — вісім місць, де про виклик забудуть. Тут
   * спостерігач один, він дивиться лише на появу вузлів, робота
   * відкладена в rAF, а самих .seg на сторінці найбільше чотири.
   */

  /** Перерахувати виділення однієї доріжки. */
  function measureSeg(seg) {
    const on = seg.querySelector('input:checked');
    const span = on && on.nextElementSibling;
    if (!span) { seg.style.setProperty('--seg-on', '0'); return; }

    const r = span.getBoundingClientRect();
    const b = seg.getBoundingClientRect();
    /* Нульова ширина = елемент іще не в розкладці (прихована вкладка,
       display:none). Ставити 0 у змінні не можна: виділення схлопнеться
       й потім поїде з кута, щойно вкладку відкриють. */
    if (!r.width || !r.height) return;

    /* Абсолютний нащадок рахується від ПОЛЯ ВІДСТУПІВ, тобто без рамки —
       звідси clientLeft/clientTop (це і є її товщина). */
    seg.style.setProperty('--seg-w', r.width + 'px');
    seg.style.setProperty('--seg-h', r.height + 'px');
    /* + scrollLeft: доріжка тепер прокручується вбік, а getBoundingClientRect
       дає координати ВИДИМОЇ частини. Без доданку виділення лишалось би
       стояти на місці, поки ряд під ним їде, — тобто підсвічувало б не той
       крок. */
    seg.style.setProperty('--seg-x', (r.left - b.left - seg.clientLeft + seg.scrollLeft) + 'px');
    seg.style.setProperty('--seg-y', (r.top - b.top - seg.clientTop) + 'px');
    seg.style.setProperty('--seg-on', '1');

    /*
     * Обраний крок мусить бути ВИДИМИМ. У прокручуваному ряду він легко
     * опиняється за краєм — наприклад, «Рік» серед семи періодів на
     * вузькому екрані. Підводимо ряд самі, а не через scrollIntoView:
     * той тягне за собою й сторінку, і замість підсвітки кроку людина
     * отримує стрибок усього екрана.
     */
    const pad = 12;
    const left = r.left - b.left + seg.scrollLeft;
    if (left < seg.scrollLeft + pad) {
      seg.scrollLeft = Math.max(0, left - pad);
    } else if (left + r.width > seg.scrollLeft + seg.clientWidth - pad) {
      seg.scrollLeft = left + r.width - seg.clientWidth + pad;
    }

    /* is-ready вмикає переходи — але тільки з НАСТУПНОГО кадру, інакше
       перший замір сам стане анімацією з лівого кута. */
    if (!seg.classList.contains('is-ready')) {
      requestAnimationFrame(function () { seg.classList.add('is-ready'); });
    }
  }

  /* Спостерігач за шириною: текст кроку не міняється, а от ширина
     доріжки — так (поворот екрана, підвантаження шрифту, перенесення
     ряду). Один на всі доріжки. */
  const segRO = typeof ResizeObserver === 'function'
    ? new ResizeObserver(function (list) {
        list.forEach(function (e) { measureSeg(e.target); });
      })
    : null;

  function initSegs(root) {
    const box = root || document;
    (box.querySelectorAll ? box.querySelectorAll('.seg') : []).forEach(function (seg) {
      measureSeg(seg);
      if (segRO && !seg.dataset.segRo) { seg.dataset.segRo = '1'; segRO.observe(seg); }
    });
  }

  let segFrame = 0;
  function scheduleSegs() {
    if (segFrame) return;
    segFrame = requestAnimationFrame(function () { segFrame = 0; initSegs(document); });
  }

  function initSegWatch() {
    initSegs(document);

    /* Зміна вибору — єдине, після чого виділення мусить поїхати. Слухач
       делегований на document: доріжки зникають і зʼявляються разом із
       перемальовками, а document лишається. */
    document.addEventListener('change', function (e) {
      const seg = e.target.closest && e.target.closest('.seg');
      if (seg) measureSeg(seg);
    });

    /* Нові доріжки після перемальовки сторінки. */
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function (recs) {
        for (let i = 0; i < recs.length; i++) {
          const added = recs[i].addedNodes;
          for (let j = 0; j < added.length; j++) {
            const n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.classList.contains('seg') || n.querySelector('.seg')) { scheduleSegs(); }
            /* Нахил тут більше не чіпається: слухач один на документ і
               ставиться в boot, тому нові вузли він бачить сам. */
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }

    /* Шрифт приїжджає після першого малювання й міняє ширину кроків. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { initSegs(document); }, function () {});
    }
    window.addEventListener('resize', scheduleSegs);

    /*
     * ВИБІР, ПОСТАВЛЕНИЙ КОДОМ, НЕ ШЛЕ ПОДІЙ.
     *
     * Це головна пастка всього механізму. Сторінка читає профіль
     * асинхронно й потім ставить radio.checked = true — а це ВЛАСТИВІСТЬ,
     * не атрибут: ні change, ні мутації DOM не відбувається. Перший замір
     * на той момент уже минув, тож виділення лишалось на першому кроці,
     * хоча обраний був четвертий. На екрані це виглядало як «перемикач
     * бреше», і побачити це можна лише з реальним профілем — на порожній
     * сторінці обидва збігаються.
     *
     * Ловимо саме ту подію, після якої сторінки й переставляють свої
     * контроли: приїзд профілю. rAF потрібен, бо наш обробник може
     * виконатись РАНІШЕ за сторінковий — тоді ми поміряли б ще старий
     * стан.
     */
    if (window.Store && typeof window.Store.onChange === 'function') {
      try { window.Store.onChange(scheduleSegs); } catch (_) {}
    }

    /*
     * Наздоганяння перших двох секунд.
     *
     * onChange покриває зміну профілю, але ПЕРШЕ читання його не завжди
     * породжує: сторінка може прочитати профіль напряму й одразу
     * поставити radio.checked, без жодної події. Ловити цей момент
     * загальним механізмом нічим — тому кілька замірів за фіксований
     * проміжок, після чого все затихає назавжди.
     *
     * Це не опитування в циклі: чотири заміри по кілька доріжок за два
     * перші секунди життя сторінки, далі — тиша.
     */
    [120, 400, 900, 1800].forEach(function (ms) { setTimeout(scheduleSegs, ms); });

    /* Останній запобіжник — перед самою взаємодією. Якщо щось усе-таки
       переставило вибір мовчки, людина побачить правильне положення до
       того, як натисне. */
    document.addEventListener('pointerdown', function (e) {
      const seg = e.target.closest && e.target.closest('.seg');
      if (seg) measureSeg(seg);
    }, true);
  }

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

  /* ------------------------------------------------------------------ */
  /* Оформлення                                                          */
  /* ------------------------------------------------------------------ */
  /*
   * ВИБОРУ ОФОРМЛЕННЯ БІЛЬШЕ НЕМАЄ. Одна монохромна темна основа, і все.
   *
   * Було вісім хроматичних акцентів (graphite, -navy, -pink, -violet,
   * -crimson, -moss, -emerald, -ocean) і друга вісь «світло / темрява».
   * Разом — шістнадцять комбінацій, кожну з яких доводилось тримати в
   * межах контрасту (4,5:1 для тексту, 3:1 для елементів) і перевіряти
   * машиною. Прибрано на вимогу власника: колір тут ніколи не ніс сенсу
   * — стан елемента показує ЯСКРАВІСТЬ, а не тон, — тож шістнадцять
   * палітр коштували підтримки й не давали нічого, крім вибору заради
   * вибору.
   *
   * ЩО СТАЛОСЬ ІЗ ЧУЖИМИ ПРОФІЛЯМИ. Ключі theme і scheme лишились у
   * профілі й у localStorage, і в цьому вся хитрість тихого переходу:
   * жодного правила html[data-theme=…] у CSS більше немає, атрибути ніхто
   * не ставить, отже збережена 'graphite-ocean' просто не знаходить собі
   * правила й бере монохром із :root. Ніякої міграції даних, ніякого
   * скидання — сторонні значення стають безпечно неактивними.
   *
   * App.setTheme / setScheme / normTheme / themes / currentScheme /
   * toggleScheme прибрані з публічного API. Якщо десь лишиться виклик,
   * він упаде помітно (TypeError у консолі), а не тихо перефарбує пів
   * сайту — саме тому тут немає заглушок-пустушок.
   */

  /* ------------------------------------------------------------------ */
  /* Service worker                                                      */
  /* ------------------------------------------------------------------ */
  /*
   * Реєструється лише по http(s): при відкритті файлу подвійним кліком
   * (file://) service worker недоступний, і спроба дала б помилку в
   * консолі на кожному завантаженні.
   *
   * ?nosw=1 — аварійний вимикач: знімає реєстрацію й чистить кеші. Потрібен
   * саме тому, що зіпсований worker інакше неможливо прибрати з чужого
   * пристрою.
   */
  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    /* Сам вимикач переїхав у js/nosw.js: він має працювати й тоді, коли
       зіпсовано саме цей файл або сам worker (PWA-006). Тут лишається
       рівно одне — не реєструвати worker назад у тому ж завантаженні. */
    if (window.__forgeNoSW || location.search.indexOf('nosw=1') !== -1) return;

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('[app] service worker не зареєструвався:', e && e.message);
      });
    });
  }

  initServiceWorker();

  window.App = {
    $: $, $$: $$,
    esc: esc, round: round, clamp: clamp, num: num,
    toast: toast,
    initReveal: initReveal,
    safeUrl: safeUrl,
    initAccordions: initAccordions,
    initSegs: initSegs,
    initTilt: initTilt,
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
    levelIcon: levelIcon,
    lockScroll: lockScroll,
    onDayChange: onDayChange,
    whenReady: whenReady
  };

  /* ------------------------------------------------------------------ */

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

  /*
   * Локальний профіль не прочитався — сказати про це вголос.
   *
   * Раніше нечитабельний ib.profile мовчки замінювався порожнім бланком, і
   * перше ж автозбереження затирало сирі байти. Людина бачила застосунок
   * без жодного свого тренування і без пояснень (LOC-001). Тепер Store
   * відкладає вміст під ib.profile.corrupt.<час>, а тут — єдине місце, де
   * це видно людині.
   */
  function warnCorruptProfile() {
    if (!window.Store || typeof Store.corruptProfile !== 'function') return;
    const c = Store.corruptProfile();
    if (!c.found) return;
    /* Один раз на вкладку: банер на кожній навігації — це вже не
       попередження, а шум. */
    try {
      if (sessionStorage.getItem('ib.corrupt.seen') === '1') return;
      sessionStorage.setItem('ib.corrupt.seen', '1');
    } catch (_) {}
    toast('Дані в цьому браузері не прочитались — застосунок відкрито з порожнім профілем. ' +
          'Пошкоджену копію збережено; якщо у вас є хмарний акаунт, увійдіть — дані приїдуть звідти.', 'err');
  }

  function boot() {
    /*
     * Кожен крок окремо. Падіння одного не має забирати з собою решту:
     * зламана навігація — прикро, зламана навігація ПЛЮС порожня сторінка —
     * зовсім інша річ.
     */
    [buildNav, buildFooter, function () { initReveal(document); }, injectCanonical,
     function () { initAccordions(document); }, initSegWatch,
     function () { initTilt(document); }, initCardGlow, initBadgeGlass, injectJsonLd,
     warnCorruptProfile]
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
