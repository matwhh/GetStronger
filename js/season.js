/**
 * Сторінка сезону: ELO, рівень, grace week, події, лідери, історія.
 *
 * Уся математика — на сервері (db/elo-engine.sql); тут лише показ через
 * EloApi. Без акаунта сторінка чесно пояснює, що сезонний рейтинг живе
 * в акаунті, і не малює локального сурогата.
 */
(function () {
  'use strict';

  const { $, esc, fmtNum } = window.App;
  const EC = window.EloCore;
  const Api = window.EloApi;

  function signed(n) { return (n > 0 ? '+' : '') + n; }

  function card(inner) { return '<div class="card">' + inner + '</div>'; }

  /* ---------------- Заглушки без акаунта ---------------- */

  function renderLocked() {
    const cloudOff = !(window.Store && window.Store.isCloud);
    $('#sz-header').innerHTML = card(
      '<h2 style="margin:0 0 8px">Потрібен акаунт</h2>' +
      '<p class="small muted mb-0">' +
        (cloudOff
          ? 'Сайт працює в локальному режимі без сервера — сезонний рейтинг, ' +
            'таблиця лідерів і нагороди вимкнені. Дані тренувань і харчування ' +
            'при цьому працюють як звичайно.'
          : 'Сезонний ELO рахує сервер і він привʼязаний до акаунта. ' +
            '<a href="account.html">Увійдіть або зареєструйтесь</a> — і сезон ' +
            'почнеться з 0 ELO, як у всіх.') +
      '</p>');
  }

  /* ---------------- Блоки ---------------- */

  /*
   * Верхня картка — competitive identity, перенесена з «Акаунта»: нік,
   * ELO з рівнем, нагороди й завершені сезони, маскот-заглушка, посилання
   * на огляд прогресу та історію. Це відповідь на «хто я в цьому сезоні»,
   * і жити вона має там, де сам рейтинг, а не в налаштуваннях акаунта.
   */

  /* Нагороди/сезони вантажаться раз на відкриття: історія міняється лише
     із закриттям сезону, смикати її на кожен refresh нема чого. */
  const ident = { awards: 0, seasons: 0, loaded: false };

  /*
   * Події сезону тягнуться ОДИН раз на оновлення й ділять їх двоє:
   * підсумок тижня в шапці й список «останні події». Доти список ходив
   * у базу власним запитом, і додати тижневе число означало б третій
   * виклик elo_recent на кожне відкриття сторінки.
   */
  const recent = { events: null };

  async function loadRecent() {
    try {
      const rows = await window.Store.rpc('elo_recent', { p_limit: 60 });
      recent.events = Array.isArray(rows) ? rows : [];
    } catch (_) {
      /* Немає звʼязку — не привід ховати всю шапку. Тижневе число просто
         не показується, решта панелі працює з кешованого стану. */
      recent.events = null;
    }
  }

  /** Понеділок поточного тижня — та сама межа, що й скрізь у проєкті. */
  function mondayKey() {
    return window.DateCore.keyOf(window.DateCore.mondayOf(new Date()));
  }

  /*
   * ПАМʼЯТЬ ПРО РІВЕНЬ — щоб підвищення було ПОДІЄЮ, а не новим числом.
   *
   * Рівень росте тихо: людина закриває тренування, число збільшується на
   * три, і межа рівня перетинається між двома поглядами на екран. Тому
   * запамʼятовуємо останній побачений рівень і, якщо він виріс, вмикаємо
   * анімацію один раз — при наступному відкритті вона вже не спрацює.
   *
   * Сезон у ключі обовʼязковий: на старті нового сезону ELO обнуляється,
   * рівень падає з десятого на перший, і без сезону кожен новий сезон
   * починався б «підвищенням» при поверненні на десятий.
   */
  const SEEN_KEY = 'ib.elo.lvlseen';

  function levelJump(season, level) {
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch (_) {}
    const up = !!(prev && prev.season === season && Number(prev.level) < level);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify({ season: season, level: level })); }
    catch (_) {}
    return up;
  }

  /**
   * ШКАЛА РІВНЯ: поточний жетон ліворуч, наступний праворуч, між ними —
   * скільки пройдено.
   *
   * Була просто смуга на всю ширину картки. Смуга відповідала на «яка
   * частка рівня пройдена» і мовчала про все інше: який це рівень, який
   * наступний, скільки до нього. Числа стояли окремим рядком нижче, і
   * зв'язати їх зі смугою очима доводилось самому.
   *
   * Тепер шкала має два кінці, і обидва — жетони рівнів. Лівий
   * повнокольоровий (це ти зараз), правий приглушений (це ще не ти).
   * Дві опорні точки роблять зі смуги відрізок ШЛЯХУ, а не відсоток.
   *
   * На десятому рівні наступного жетона немає — далі тільки ELITE, і
   * правий кінець стає позначкою стелі. Раніше тут писалось «До Level
   * 11», рівня, якого не існує.
   */
  function ladderHtml(st, lvl, up) {
    const cfg = st.config;
    const top = lvl.level >= cfg.levelCount;
    /* Верхня межа відрізка. Для ELITE це стеля сезону, для решти —
       перше число наступного рівня. */
    const goal = lvl.elite ? cfg.seasonMax : lvl.ceil + 1;
    const left = Math.max(0, goal - st.elo);
    const pct = Math.max(0, Math.min(100, Number(lvl.pct) || 0));

    const right = (top || lvl.elite)
      ? '<span class="lvlbar__end lvlbar__end--top mono" aria-label="Стеля сезону">MAX</span>'
      : '<span class="lvlbar__end lvl-circle">' +
          window.App.levelIcon(lvl.level + 1, 'Level ' + (lvl.level + 1)) + '</span>';

    const goalName = lvl.elite ? 'стелі сезону' : (top ? 'ELITE' : 'Level ' + (lvl.level + 1));

    return '<div class="lvlbar mt-2' + (up ? ' is-levelup' : '') + '" role="group" ' +
        'aria-label="Прогрес до наступного рівня">' +
        '<span class="lvlbar__end lvl-circle">' +
          window.App.levelIcon(lvl.level, lvl.name) + '</span>' +
        '<span class="lvlbar__track">' +
          /* Ширина приїжджає змінною, а не в style="width": заливка
             росте від нуля анімацією, і фіксована ширина відразу
             зупинила б її на місці. */
          '<i class="lvlbar__fill" style="--to:' + pct + '%"></i>' +
        '</span>' +
        right +
      '</div>' +
      '<div class="row row--split small mt-1" style="gap:10px;flex-wrap:wrap">' +
        '<span class="muted"><b class="mono">' + st.elo + '</b> / ' + goal + ' ELO</span>' +
        '<span class="muted">ще <b class="mono">' + left + '</b> до ' + esc(goalName) + '</span>' +
      '</div>';
  }

  /*
   * ЧЕРГОВІСТЬ РЕНДЕРІВ ШАПКИ.
   *
   * Шапка малюється двічі поспіль: спершу з КЕШОВАНОГО стану (щоб не
   * показувати порожнечу, поки йде запит), потім зі свіжого. Обидва
   * рендери асинхронні — усередині await на history() і getProfile(), —
   * і порядок їх завершення нічим не гарантований. Якщо кешований
   * дорендерився ДРУГИМ, він затирав свіжі дані старими: людина бачила
   * вчорашнє ELO при живому звʼязку, і виглядало це як «сервер не
   * оновлює». Тому кожен рендер бере номер і мовчки виходить, якщо поки
   * він чекав, почався новіший.
   */
  let headSeq = 0;

  async function renderHeader(st, up) {
    const host = $('#sz-header');
    if (!host) return;
    const my = ++headSeq;

    // Нік саме редагують — не зносимо картку під пальцями. Дебаунс
    // збереження сам домалює свіже значення наступним refresh-ом.
    const act = document.activeElement;
    if (act && act.id === 'sz-nick') return;

    if (!ident.loaded) {
      try {
        const h = await Api.history();
        ident.awards = ((h && h.awards) || []).length;
        ident.seasons = ((h && h.history) || []).length;
        ident.loaded = true;
      } catch (_) {}
    }

    let p = {};
    try { p = await window.Store.getProfile() || {}; } catch (_) {}

    /*
     * Ім'я на дошці — ЗАТВЕРДЖЕНИЙ нік із заявки (account_status.username).
     * Він унікальний у базі, його бачить адмін при підтвердженні, і саме
     * його тепер віддає elo_leaderboard (db/leaderboard-name.sql).
     *
     * Тому поле редагування показуємо лише тим, у кого ніка немає — це
     * акаунти, створені до появи анкети. Лишити поле всім означало б
     * малювати редактор, який більше нічого не змінює: людина вписала б
     * нове ім'я, побачила б його в себе — і не побачила б на дошці.
     */
    let approved = '';
    try {
      const acc = window.Store.accountCached && window.Store.accountCached();
      approved = ((acc && acc.username) || '').trim();
    } catch (_) {}
    const name = approved || (p.displayName || '').trim();

    const lvl = EC.levelFor(st.elo, st.config);
    /* День сезону рахує ядро: по календарних днях, а не по мілісекундах
       (див. EloCore.seasonDay — інакше після полудня 1-го числа виходило «2»). */
    const sd = EC.seasonDay(st.season);
    const total = sd.total;
    const passed = sd.passed;

    /* Тиждень — головна метрика панелі. «Сьогодні» майже завжди нуль або
       трійка: більшість днів дає одну-дві дії, а день відпочинку —
       жодної. Людина дивилась на «+0 ELO» і робила висновок про застій,
       хоч за тиждень набігало двадцять. Бюджет ELO теж тижневий. */
    const week = recent.events ? EC.sumFrom(recent.events, mondayKey()) : null;
    /* Підвищення рівня вирішує ВИКЛИКАЧ, і тільки на свіжому стані:
       кешований рендер не має права ні показати свято, ні зʼїсти його. */
    const levelUp = !!up;

    if (my !== headSeq) return;

    host.innerHTML = card(
      '<div class="row row--split" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<h2 style="margin:0;text-transform:uppercase">' + esc(name || 'Атлет') + '</h2>' +
        '<span class="small muted">' + esc(EC.seasonLabel(st.season)) + ' · день ' + passed + ' із ' + total + '</span>' +
      '</div>' +
      '<div class="rating-hero mt-2">' +
        '<span class="rating-hero__val mono">' + st.elo + '<span class="tile__of"> ELO</span></span>' +
        '<span class="rating-hero__meta">' +
          (week === null ? ''
            : '<span class="chip chip--acc mono" title="Приріст ELO з понеділка">' +
              signed(week) + ' ELO за тиждень</span>') +
        '</span>' +
      '</div>' +

      ladderHtml(st, lvl, levelUp) +

      '<div class="row mt-2" style="gap:16px;flex-wrap:wrap">' +
        '<span class="small">Сьогодні: <b class="mono">' + signed(st.today || 0) + ' ELO</b></span>' +
        (st.rank ? '<span class="small">Місце: <b class="mono">#' + st.rank + '</b> із ' + st.of + '</span>' : '') +
      '</div>' +

      /*
       * ДВІ ПЛИТКИ — ЦЕ ВХОДИ, А НЕ ПІДСУМКИ.
       *
       * «7 нагород» і «2 сезони завершено» — числа, після яких одразу
       * виникає «а які саме». Доти відповіді не було: плитка була
       * мертвим числом, а до нагород доводилось шукати посилання в
       * іншій картці нижче. Тепер кожна веде туди, де відповідь:
       * нагороди — на свою вітрину, сезони — на розбір по сезонах.
       *
       * Стрілку в підписі додає CSS (.kpi--link), а не цей рядок: вона
       * оздоба посилання, а не частина слова.
       */
      '<div class="kpis mt-2">' +
        '<a class="kpi kpi--link" href="awards.html">' +
          '<div class="kpi__val mono">' + ident.awards + '</div><p class="kpi__lbl">нагород</p></a>' +
        '<a class="kpi kpi--link" href="seasons.html">' +
          '<div class="kpi__val mono">' + ident.seasons + '</div><p class="kpi__lbl">сезонів завершено</p></a>' +
      '</div>' +

      '<div class="field mt-2" style="max-width:340px">' +
        (approved
          ? '<span class="field__label">Нік у таблиці лідерів</span>' +
            '<p class="mono" style="margin:4px 0 0">' + esc(approved) + '</p>' +
            '<span class="field__hint">Закріплений за акаунтом.</span>'
          : '<label class="field__label" for="sz-nick">Нік у таблиці лідерів</label>' +
            '<input class="input" id="sz-nick" maxlength="13" placeholder="Атлет" value="' + esc(name) + '">') +
      '</div>' +


      '<div class="row mt-2" style="gap:14px;flex-wrap:wrap">' +
        '<a class="small" href="journal.html">Огляд прогресу →</a>' +
        '<a class="small" href="journal.html#history">Історія →</a>' +
      '</div>');
  }

  /* Нік: делегування на контейнері — картка перемальовується, а слухач
     живе на хості. Той самий дебаунс, що був в акаунті. */
  let nickTimer = null;
  document.addEventListener('input', function (e) {
    if (!e.target || e.target.id !== 'sz-nick') return;
    clearTimeout(nickTimer);
    const v = e.target.value.trim();
    nickTimer = setTimeout(function () {
      window.Store.saveProfile({ displayName: v || null }).catch(function () {});
      Api.setName(v).catch(function () {});
    }, 600);
  });

  /* ---------------- Категорії рейтингу ---------------- */
  /*
   * ВИМКНУТИ КАТЕГОРІЮ — НЕ ВІДМОВИТИСЬ ВІД ОЧОК.
   *
   * Тижнева стеля рейтингу спільна: вона не залежить від того, скільки
   * категорій людина веде. Ваги лише ділять цю стелю — і доти 30 % її
   * були закріплені за їжею, тобто недосяжні для того, хто щоденник не
   * веде. Це читалось як штраф за чесність: «не ведеш їжу — сезон нижче,
   * хоч як тренуйся».
   *
   * Вимикач прибирає вагу категорії й віддає її решті. Сума лишається
   * тією самою, стеля теж — міняється тільки те, куди можна дотягтись.
   * Тому й вигоди перемикати посеред сезону немає: більше за тижневу
   * стелю все одно не взяти.
   *
   * Рахує це СЕРВЕР (elo_cfg_for): elo_state віддає вже персональний
   * конфіг, тож числа на екрані й у базі не можуть розійтись.
   */
  const SKIPPABLE = [
    { id: 'nutrition', name: 'Харчування', note: 'щоденник їжі: калорії й білок' }
  ];

  function renderCats(st) {
    const host = $('#sz-cats');
    if (!host) return;
    const w = (st.config && st.config.weights) || {};
    host.innerHTML = card(
      '<h3 class="card__title" style="margin-bottom:4px">Що рахувати в рейтингу</h3>' +
      '<p class="small muted" style="margin:0 0 10px">Вимкнена категорія віддає свою частку ' +
        'решті: тижнева стеля рейтингу лишається тією самою, і сезон можна пройти ' +
        'на той самий результат без неї.</p>' +
      SKIPPABLE.map(function (c) {
        const on = Object.prototype.hasOwnProperty.call(w, c.id);
        return '<label class="check" style="width:100%;box-sizing:border-box">' +
          '<input type="checkbox" data-cat="' + esc(c.id) + '"' + (on ? ' checked' : '') + '>' +
          '<span>' + esc(c.name) + ' <span class="muted">— ' + esc(c.note) + '</span></span>' +
        '</label>';
      }).join('') +
      '<p class="small muted" style="margin:10px 0 0">Перемикач перераховує ПОТОЧНИЙ сезон: ' +
        'він переграється так, ніби ви від початку грали з цим набором категорій. ' +
        'Записи в журналі при цьому не переписуються — різниця заходить окремою подією. ' +
        'Перерахунок доступний двічі за сезон.</p>');
  }

  /* Делегування на документі: картка перемальовується цілком, а слухач
     живе поза нею — той самий прийом, що з ніком вище. */
  document.addEventListener('change', async function (e) {
    const box = e.target && e.target.closest && e.target.closest('[data-cat]');
    if (!box) return;
    const id = box.dataset.cat;
    try {
      const p = await window.Store.getProfile();
      const was = Array.isArray(p && p.eloSkip) ? p.eloSkip : [];
      const next = box.checked
        ? was.filter(function (x) { return x !== id; })
        : (was.indexOf(id) === -1 ? was.concat([id]) : was);
      await window.Store.saveProfile({ eloSkip: next });

      /*
       * ПЕРЕРАХУНОК, А НЕ «З ПОНЕДІЛКА БУДЕ ЧЕСНО».
       *
       * Без нього вимикач лишав людину з половиною сезону, порахованою
       * за старими вагами: недосяжна частка бюджету за перші півсезону
       * нікуди б не ділась. Сервер переграє поточний сезон за новим
       * набором категорій і заводить різницю однією подією — старі
       * записи в журналі не переписуються (див. db/elo-recount-category.sql).
       */
      let done = null;
      try { done = await Api.recountCategories(); } catch (_) {}
      await refresh();

      const base = box.checked ? 'Харчування рахується в рейтингу'
                               : 'Харчування більше не впливає на рейтинг';
      if (done && done.ok && done.changed) {
        window.App.toast(base + ': сезон перераховано, ' +
          (done.diff > 0 ? '+' + done.diff : String(done.diff)) + ' ELO', 'ok');
      } else if (done && done.error === 'limit') {
        window.App.toast(base + '. Сезон перерахувати вже не можна — двічі за сезон ' +
          'і не більше; далі вимикач діє лише вперед.', 'ok');
      } else if (done && done.error === 'cap') {
        window.App.toast(base + '. Сезон не перераховано: у ньому є день, який ' +
          'упирався в стелю, і чесно переграти його неможливо.', 'ok');
      } else {
        window.App.toast(base, 'ok');
      }
    } catch (err) {
      box.checked = !box.checked;
      window.App.toast('Не збереглося: ' + (err && err.message), 'err');
    }
  });

  function renderGrace(st) {
    const cfgMax = st.config.graceWeeksPerSeason;
    const left = cfgMax - (st.graceUsed || 0);
    const active = Boolean(st.graceUntil);

    $('#sz-grace').innerHTML = card(
      '<div class="row row--split" style="align-items:center;gap:12px;flex-wrap:wrap">' +
        '<div>' +
          '<h3 class="card__title" style="margin-bottom:4px">Grace Week</h3>' +
          '<p class="small muted" style="margin:0">' +
            (active
              ? 'Активний до <b class="mono">' + esc(st.graceUntil) + '</b>: вимоги і штрафи ' +
                'за тренування вимкнені, решта категорій працює.'
              : left > 0
                ? 'Хвороба, травма чи відпустка — 7 днів без вимог і штрафів за тренування. ' +
                  'Лишилось: <b class="mono">' + left + ' / ' + cfgMax + '</b> на сезон.'
                : 'На цей сезон обидва Grace Weeks використано.') +
          '</p>' +
        '</div>' +
        (!active && left > 0
          ? '<button class="btn btn--ghost btn--sm" type="button" id="sz-grace-go">Активувати Grace Week</button>'
          : '') +
      '</div>');

    const btn = $('#sz-grace-go');
    if (btn) {
      btn.addEventListener('click', async function () {
        if (!window.confirm('Активувати Grace Week? 7 днів без вимог до тренувань. Скасувати не можна.')) return;
        try {
          const res = await Api.activateGrace();
          if (res && res.ok) {
            window.App.toast('Grace Week активовано до ' + res.until, 'ok');
            refresh();
          } else {
            window.App.toast(res && res.error === 'exhausted'
              ? 'Grace Weeks на сезон вичерпано' : 'Не вдалося активувати', 'err');
          }
        } catch (e) { window.App.toast('Не вдалося: ' + (e && e.message), 'err'); }
      });
    }
  }

  /* ---------------- Останні події ---------------- */
  /*
   * ЧОМУ СТРІЧКА ЗГОРТАЄТЬСЯ.
   *
   * Це єдине місце, де можна дізнатись, ЗА ЩО прийшло число. Але потрібне
   * воно рідко — раз на тиждень, коли щось здалось дивним, — а місця
   * займало найбільше на сторінці: чотирнадцять рядків між шапкою й
   * таблицею лідерів. Хто відкривав рейтинг, щоб глянути своє ELO, щодня
   * гортав повз відповідь на питання, якого не ставив.
   *
   * Тому стрічка стала акордеоном — тим самим (.acc + initAccordions),
   * що згортає довгі пояснення внизу сторінки: нового компонента тут не
   * зʼявляється. І стан ЗАПАМʼЯТОВУЄТЬСЯ: той, хто раз відкрив стрічку,
   * читає її й наступного разу, а хто закрив — більше не бачить.
   *
   * ГОЛОВА КАЖЕ ГОЛОВНЕ НАВІТЬ ЗАКРИТОЮ. Заголовок із самим словом
   * «Останні події» над згорнутим тілом не повідомляє нічого — його
   * доводилось відкривати, щоб дізнатись, чи є там узагалі щось. Тому в
   * голові стоїть підсумок: скільком подіям і на скільки ELO за тиждень.
   *
   * ЩО ЗМІНИЛОСЬ У САМИХ РЯДКАХ. Було: причина, дата й дельта одним
   * рядком. Три проблеми, усі однакові — рядок не відповідав на
   * очевидне питання:
   *   • дата стояла в кожному рядку («2026-09-13» тринадцять разів),
   *     хоч питання «котрого дня» стосується дня, а не події. Тепер
   *     події згорнуті в ДНІ (js/elo-view-core.js), у дня — своя сума;
   *   • не було видно КАТЕГОРІЇ: «Чистий день» і «Сон 7.5 год» стояли
   *     поруч без ознаки, що одне — бонус, а друге — сон;
   *   • не було видно РАХУНКУ: дельта є, а «скільки стало» — ні, хоч
   *     сервер віддає elo_after у тій самій відповіді.
   */
  const EVENTS_KEY = 'ib.elo.events.open';
  /* Чотири дні — приблизно стільки, скільки видно на екрані телефона без
     гортання. Решта за кнопкою: обрізати історію зовсім не можна, бо
     питання «а що було в понеділок» законне. */
  const EVENTS_DAYS = 4;
  let eventsAll = false;

  function eventsOpen() {
    try { return localStorage.getItem(EVENTS_KEY) !== '0'; } catch (_) { return true; }
  }
  function eventsRemember(open) {
    try { localStorage.setItem(EVENTS_KEY, open ? '1' : '0'); } catch (_) {}
  }

  /* Той самий знак, що ставить initLongform: акордеони сайту мусять
     виглядати однаково, інакше «це згортається» перестає читатись. */
  const CHEVRON = '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 9l6 6 6-6"/></svg>';

  function toneVar(n) { return n >= 0 ? '--ok' : '--acc-ink'; }

  function eventRow(e) {
    const V = window.EloView;
    const d = Math.round(Number(e.delta) || 0);
    const after = Number(e.eloAfter);
    return '<div class="szev">' +
      '<span class="szev__l">' +
        '<span class="szev__cat">' + esc(V.catLabel(e.category)) + '</span>' +
        '<span class="szev__what">' + esc(e.reason || '—') + '</span>' +
      '</span>' +
      '<span class="szev__r">' +
        '<b class="szev__d mono" style="color:var(' + toneVar(d) + ')">' + signed(d) + '</b>' +
        /* Рахунок після події показуємо лише коли він справжній: тижнева
           оцінка приходить із elo_after = 0 (це підсумок тижня, а не стан
           рахунку), і надрукувати той нуль означало б сказати людині, що
           вона обнулилась. */
        (Number.isFinite(after) && after > 0
          ? '<span class="szev__elo mono">' + after + '</span>' : '') +
      '</span>' +
    '</div>';
  }

  function eventDayHtml(g, todayKey) {
    const V = window.EloView;
    return '<div class="szday">' +
      '<div class="szday__h">' +
        '<span class="szday__when">' + esc(V.dayLabel(g.day, todayKey)) + '</span>' +
        '<span class="szday__r">' +
          '<b class="mono" style="color:var(' + toneVar(g.sum) + ')">' + signed(g.sum) + '</b>' +
          (g.eloAfter ? '<span class="szday__elo mono">' + g.eloAfter + ' ELO</span>' : '') +
        '</span>' +
      '</div>' +
      g.events.map(eventRow).join('') +
    '</div>';
  }

  function renderEvents() {
    const host = $('#sz-events');
    if (!host) return;
    const V = window.EloView;
    const all = recent.events || [];

    /*
     * ПОРОЖНЬО — ЦЕ НЕ ЗГОРНУТО. Акордеон, у якому нічого немає, лише
     * пропонує відкрити порожнечу. Тому тут звичайна картка з поясненням,
     * що зробити, щоб перші очки прийшли.
     */
    if (!all.length || !V) {
      /*
       * «Порожньо» і «не приїхало» — різні речі, і сказати треба різне.
       * recent.events === null означає, що запит не вдався (loadRecent
       * ковтає помилку навмисно: без звʼязку решта панелі працює з кешу).
       * Написати такій людині «закрийте тренування» означало б порадити
       * зробити те, що вона, можливо, уже зробила.
       */
      host.innerHTML = card(
        '<h3 class="card__title">Останні події</h3>' +
        (recent.events === null
          ? '<p class="small muted mb-0">Стрічку не вдалося завантажити — немає звʼязку ' +
            'з сервером. Нарахування від цього не губляться: події лежать на сервері, ' +
            'а зроблене офлайн дошлеться саме.</p>'
          : '<p class="small muted mb-0">Ще порожньо. Закрийте тренування, день харчування ' +
            'чи відмітьте сон — і перші очки прийдуть одразу. Тут буде видно кожне ' +
            'нарахування окремо: день, категорія, причина й дельта.</p>'));
      return;
    }

    const todayKey = window.DateCore.keyOf(new Date());
    const groups = V.groupByDay(all);
    const shown = eventsAll ? groups : groups.slice(0, EVENTS_DAYS);
    const hiddenDays = groups.length - shown.length;
    const sum = V.eventsSummary(all, mondayKey());
    const open = eventsOpen();

    host.innerHTML =
      '<div class="acc' + (open ? ' is-open' : '') + '">' +
        '<button class="acc__head" type="button">' +
          '<span>' +
            '<h3>Останні події</h3>' +
            '<span class="small muted">' +
              signed(sum.sum) + ' ELO за тиждень · ' +
              sum.count + ' ' + window.App.plural(sum.count, 'подія', 'події', 'подій') +
              ' за ' + sum.days + ' ' + window.App.plural(sum.days, 'день', 'дні', 'днів') +
            '</span>' +
          '</span>' +
          CHEVRON +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          shown.map(function (g) { return eventDayHtml(g, todayKey); }).join('') +
          (hiddenDays > 0
            ? '<button class="btn btn--ghost btn--sm mt-2" type="button" id="sz-ev-more">' +
                'Показати ще ' + hiddenDays + ' ' +
                window.App.plural(hiddenDays, 'день', 'дні', 'днів') + '</button>'
            : (eventsAll && groups.length > EVENTS_DAYS
                ? '<button class="btn btn--ghost btn--sm mt-2" type="button" id="sz-ev-less">' +
                    'Показати менше</button>'
                : '')) +
          '<p class="small muted mt-2 mb-0">Сервер нараховує за день, тому й підсумок ' +
            'тут денний. Праворуч від дельти — рахунок після події.</p>' +
        '</div></div></div>' +
      '</div>';

    window.App.initAccordions(host);

    /* Стан памʼятаємо ПІСЛЯ initAccordions: він сам нічого не зберігає,
       і це правильно — більшість акордеонів сайту й не мусить. */
    const head = host.querySelector('.acc__head');
    const box = host.querySelector('.acc');
    if (head && box) {
      head.addEventListener('click', function () {
        eventsRemember(box.classList.contains('is-open'));
      });
    }

    const more = $('#sz-ev-more');
    if (more) more.addEventListener('click', function () { eventsAll = true; renderEvents(); });
    const less = $('#sz-ev-less');
    if (less) less.addEventListener('click', function () { eventsAll = false; renderEvents(); });
  }

  async function renderBoard(st) {
    try {
      const rows = await Api.leaderboard(50);
      if (!Array.isArray(rows) || !rows.length) { $('#sz-board').innerHTML = ''; return; }
      const enough = st.of >= (st.config.minUsersForPercentile || 20);
      $('#sz-board').innerHTML = card(
        '<div class="row row--split" style="align-items:baseline">' +
          '<h3 class="card__title">Таблиця лідерів — ' + esc(EC.seasonLabel(st.season)) + '</h3>' +
          '<span class="small muted">' + st.of + ' учасн.</span>' +
        '</div>' +
        (!enough
          ? '<p class="small muted" style="margin:4px 0 8px">Відсотки (Top 10% і далі) зʼявляться, ' +
            'коли в сезоні буде ' + (st.config.minUsersForPercentile || 20) + '+ учасників.</p>'
          : '') +
        '<div class="mt-1">' + rows.map(function (r) {
          return '<div class="row row--split small" style="padding:7px 0;border-bottom:1px solid var(--line);gap:10px' +
              (r.me ? ';font-weight:700' : '') + '">' +
            '<span><span class="mono">#' + r.rank + '</span> ' + esc(r.name) + (r.me ? ' (ви)' : '') + '</span>' +
            '<b class="mono">' + r.elo + ' ELO</b>' +
          '</div>';
        }).join('') + '</div>');
    } catch (_) { $('#sz-board').innerHTML = ''; }
  }

  /*
   * ІСТОРІЯ Й НАГОРОДИ РОЗʼЇХАЛИСЬ ПО ДВОХ БЛОКАХ — І ЦЕ НАВМИСНО.
   *
   * Досі це була одна картка: список сезонів, а під ним сітка нагород.
   * Дві різні розмови в одній рамці, і жодна не на своєму місці.
   * Нагороди — найкраще, що в людини є; стояти вони мусять там, де на них
   * дивляться, а не в хвості службового списку. Тому:
   *
   *   • історія сезонів лишається тут, стислим списком, і веде на
   *     seasons.html — там той самий список із розбором кожного сезону;
   *   • нагороди переїхали в САМИЙ НИЗ сторінки (#sz-awards), окремою
   *     вітриною на всю ширину.
   *
   * Чому саме в низ, а не в шапку: рейтинг читають зверху вниз — «скільки
   * в мене зараз», «як іде тиждень», «де я в таблиці». Нагороди не
   * відповідають ні на що з цього, вони нагорода за вже пройдене, і
   * правильне місце для неї — кінець, а не початок.
   */
  async function renderHistory() {
    try {
      const data = await Api.history();
      const hist = (data && data.history) || [];
      const awards = (data && data.awards) || [];
      renderAwards(awards);
      if (!hist.length) {
        /* Перший сезон ще триває: сказати про це один раз варто — інакше
           людина шукає історію, якої за задумом поки немає. */
        $('#sz-history').innerHTML = card(
          '<h3 class="card__title">Історія сезонів</h3>' +
          '<p class="small muted mb-0">Перший сезон ще триває — підсумок зʼявиться ' +
          'після його завершення. Що саме в ньому буде, видно на ' +
          '<a href="seasons.html">сторінці сезонів</a>.</p>');
        return;
      }
      /* У рейтингу — три останні сезони. Це не обрізана історія, а
         превʼю: повний розбір із підсумками, графіком і категоріями
         живе на seasons.html, і вести туди один раз честніше, ніж
         тримати тут список, який із роками не має кінця. */
      const top = hist.slice(0, 3);
      $('#sz-history').innerHTML = card(
        '<div class="row row--split" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
          '<h3 class="card__title" style="margin:0">Історія сезонів</h3>' +
          '<a class="small" href="seasons.html">Усі сезони →</a>' +
        '</div>' +
        '<div class="mt-1">' + top.map(function (h) {
          return '<div class="row row--split small" style="padding:7px 0;border-bottom:1px solid var(--line);gap:10px">' +
            '<span>' + esc(EC.seasonLabel(h.season)) +
              (h.rank ? ' <span class="muted">· #' + h.rank + ' із ' + h.of + '</span>' : '') +
              (h.percentile ? ' <span class="muted">· Top ' + h.percentile + '%</span>' : '') +
            '</span>' +
            '<b class="mono">' + h.elo + ' ELO · L' + h.level + (h.elite ? ' ELITE' : '') + '</b>' +
          '</div>';
        }).join('') + '</div>' +
        (hist.length > top.length
          ? '<p class="small muted mt-1 mb-0">Показано ' + top.length + ' із ' + hist.length +
            ' — решта на <a href="seasons.html">сторінці сезонів</a>.</p>'
          : ''));
    } catch (_) { $('#sz-history').innerHTML = ''; }
  }

  /*
   * НАГОРОДИ — ВІТРИНА В САМОМУ НИЗУ.
   *
   * Тут ПРЕВʼЮ, а розмова про нагороди — на awards.html: тому картка веде
   * туди, а не перевертається. Тап не може означати одночасно
   * «перевернути» і «перейти», і з двох значень корисніше друге — на
   * сторінці нагород видно ще й те, чого в тебе немає.
   *
   * Нагороди — КАРТКИ, а не чипи. Чип виглядав як мітка на речі, а не як
   * сама річ: рядок однакових сірих капсул неможливо прочитати як «я це
   * заслужив». Компонент — js/award-core.js.
   */
  function renderAwards(awards) {
    const host = $('#sz-awards');
    if (!host) return;
    if (!awards.length) { host.innerHTML = ''; return; }
    host.innerHTML = card(
      '<div class="row row--split" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<h2 style="margin:0">Нагороди</h2>' +
        '<a class="small" href="awards.html">Усі нагороди →</a>' +
      '</div>' +
      '<p class="small muted mt-1">Видає сервер за підсумком сезону. Колір лиця — ' +
        'рідкість; назва й сезон — на звороті.</p>' +
      (window.Award
        ? window.Award.grid(awards, { seasonLabel: EC.seasonLabel, href: 'awards.html' })
        /* Модуль не завантажився — краще сірі капсули, ніж порожньо. */
        : '<div class="row mt-1" style="gap:8px;flex-wrap:wrap">' + awards.map(function (a) {
            return '<span class="chip">' + esc(a.label) + ' · ' + esc(EC.seasonLabel(a.season)) + '</span>';
          }).join('') + '</div>'));
  }

  /*
   * ПЕРЕВОРОТ НА ДОТИКУ ЗВІДСИ ПРИБРАНО.
   *
   * Картки нагород тут стали посиланнями на awards.html, і перевертати їх
   * більше нема потреби: тап веде на сторінку нагород, де видно ще й те,
   * чого в тебе поки немає. Сам механізм перевороту живе тепер там
   * (js/awards.js, wireFlip) — в одному екземплярі, а не в двох, які
   * розійшлися б на першому ж виправленні.
   */

  /* Категорії підсумку сезону — ті самі пʼять, що рахує сервер у stats
     (db/elo-engine.sql). Підписи беруться з одного місця
     (js/elo-view-core.js): два списки тих самих пʼяти слів розійшлися б
     на першій же правці, і в стрічці подій та в підсумку сезону одна
     категорія називалась би по-різному. */
  var CAT_UA = {};
  ['training', 'nutrition', 'sleep', 'recovery', 'activity'].forEach(function (c) {
    /* Запасний варіант — сам код: якщо модуль не доїхав, у підсумку
       сезону стоятиме «training» замість «Тренування», і це негарно, але
       сторінка малюється. Кинути виняток тут означало б не намалювати
       взагалі нічого, включно з ELO. */
    CAT_UA[c] = window.EloView ? window.EloView.catLabel(c) : c;
  });

  /** Деталі підсумку сезону (§19): категорії, дні, grace, екстремуми. */
  /* Число або порожньо. Звіт приходить із localStorage, а туди його могла
     покласти не лише наша ж відповідь сервера (WEB-002): усе, що йде в
     innerHTML нижче, мусить бути числом за побудовою, а не за вірою. */
  function n(v) { var x = Number(v); return Number.isFinite(x) ? x : null; }
  function ns(v, dflt) { var x = n(v); return x === null ? (dflt === undefined ? '' : dflt) : String(x); }

  function reportStats(rep) {
    var st = rep.stats || {};
    var rows = Object.keys(CAT_UA).filter(function (c) { return st[c]; }).map(function (c) {
      var s = st[c];
      return '<div class="row row--split small" style="padding:4px 0">' +
        '<span class="muted">' + CAT_UA[c] + '</span>' +
        '<span class="mono">' + (n(s.elo) >= 0 ? '+' : '') + ns(s.elo, '0') + ' ELO · якість ' +
          Math.round((Number(s.avgQuality) || 0) * 100) + '%</span></div>';
    }).join('');
    var extra = [];
    if (n(rep.daysActive) !== null) extra.push('Активних днів: <b class="mono">' + ns(rep.daysActive) + '/' + ns(rep.daysTotal, '92') + '</b>');
    if (n(rep.graceUsed) !== null) extra.push('Grace Weeks: <b class="mono">' + ns(rep.graceUsed) + '/2</b>');
    if (n(st.biggestGain) !== null) extra.push('Найкращий день: <b class="mono">+' + ns(st.biggestGain) + '</b>');
    if (n(st.biggestLoss) !== null && n(st.biggestLoss) < 0) extra.push('Найгірший день: <b class="mono">' + ns(st.biggestLoss) + '</b>');
    if (st.bestCategory) extra.push('Сильна категорія: <b>' + (CAT_UA[st.bestCategory] || esc(st.bestCategory || '')) + '</b>');
    if (st.weakestCategory && st.weakestCategory !== st.bestCategory) {
      extra.push('Слабка категорія: <b>' + (CAT_UA[st.weakestCategory] || esc(st.weakestCategory || '')) + '</b>');
    }
    if (!rows && !extra.length) return '';
    return (rows ? '<div style="margin-bottom:8px">' + rows + '</div>' : '') +
      (extra.length ? '<p class="small muted" style="margin:0 0 10px">' + extra.join(' · ') + '</p>' : '');
  }

  function renderReport() {
    let rep = null;
    try { rep = JSON.parse(localStorage.getItem('ib.eloReport')); } catch (_) {}
    if (!rep || !rep.ok) { $('#sz-report').innerHTML = ''; return; }
    $('#sz-report').innerHTML = card(
      '<h2 style="margin:0 0 6px">Сезон завершено</h2>' +
      '<div class="rating-hero">' +
        '<span class="rating-hero__val mono">' + ns(rep.elo, '0') + '<span class="tile__of"> ELO</span></span>' +
        '<span class="rating-hero__meta">' +
          '<span class="lvl-circle">' + window.App.levelIcon(n(rep.level), 'Level ' + ns(rep.level)) + '</span>' +
          '<span class="small muted">Level ' + ns(rep.level) + (rep.elite === true ? ' — ELITE' : '') + '</span>' +
        '</span>' +
      '</div>' +
      '<p class="small mt-1" style="margin-bottom:8px">' +
        (n(rep.rank) ? 'Місце: <b class="mono">#' + ns(rep.rank) + '</b> із ' + ns(rep.of) : '') +
        (n(rep.percentile) ? ' · Top ' + ns(rep.percentile) + '%' : '') +
      '</p>' +
      reportStats(rep) +
      '<button class="btn btn--ghost btn--sm" type="button" id="sz-report-hide">Сховати звіт</button>');
    const hide = $('#sz-report-hide');
    if (hide) hide.addEventListener('click', function () {
      try { localStorage.removeItem('ib.eloReport'); } catch (_) {}
      $('#sz-report').innerHTML = '';
    });
  }

  /* ---------------- Календар сезону ---------------- */
  /*
   * ВІДПОВІДАЄ НА ТРИ ПИТАННЯ ОДНИМ ПОГЛЯДОМ: коли сезон почався, коли
   * закінчиться, скільки з нього лишилось. Рядок «день 9 із 91» у шапці
   * дає те саме числом, але число не показує, що попереду ще два повні
   * місяці — сітка показує.
   *
   * Сітка — стандартна (js/daycal-core.js), та сама, що в історії
   * тренувань і в календарі зважувань.
   *
   * ЧОМУ МИНУЛІ ДНІ НЕ ЗАЛИТІ.
   *
   * Спокуса залити їх найяскравішим рівнем велика: одразу видно, скільки
   * пройдено. Але в календарях журналу залита клітинка означає «цього дня
   * я тренувався», і найяскравіший рівень — «закрив усі підходи». Якщо
   * тут тим самим кольором позначити «день просто минув», одна й та сама
   * плитка означатиме на сусідніх сторінках різні речі — рівно та
   * помилка, заради усунення якої клітинку колись і звели в один клас.
   *
   * Тому кольору тут рівно два дні: перший і останній день сезону. Це і є
   * те, що просили побачити. Минулі дні — звичайні клітинки, майбутні —
   * бліді, сьогодні — кільце. Календар сезону нічого не стверджує про
   * тренування, і не мусить: для цього є «Історія».
   *
   * Не залежить від акаунта: межі сезону — чиста арифметика календаря
   * (EloCore.seasonRange), тому картка малюється і без входу. Людині без
   * акаунта питання «а коли той сезон закінчується» цікаве не менше.
   */
  /* Делегат: назви місяців і «13 вересня» живуть в одному місці
     (js/elo-view-core.js). Тут була третя копія списку місяців у проєкті,
     і саме так копії дати одного разу вже розійшлись по семи файлах. */
  function human(k, withYear) { return window.EloView.human(k, withYear); }

  function renderSeasonCal() {
    const host = $('#sz-cal');
    const DC = window.DayCal;
    if (!host || !DC || !EC) return;

    const now = new Date();
    const code = EC.seasonOf(now);
    const range = EC.seasonRange(code);
    const startK = DC.keyOf(range[0]);
    const endK = DC.keyOf(range[1]);
    const todayK = DC.keyOf(now);
    /* Затискаємо «сьогодні» в межі сезону: у перший день нового сезону
       сторінка могла відкритись із кешованим станом попереднього. */
    const activeK = todayK < startK ? startK : (todayK > endK ? endK : todayK);
    const day = EC.seasonDay(code, now);

    const cal = DC.html({
      from: startK,
      to: activeK,
      until: endK,
      cls: 'mt-2',
      label: 'Календар сезону ' + EC.seasonLabel(code),
      cell: function (k, d, isFuture) {
        if (k === startK) {
          return { lvl: 4, label: 'Початок сезону: ' + human(k, true) };
        }
        if (k === endK) {
          return { lvl: 4, label: 'Кінець сезону: ' + human(k, true) };
        }
        if (isFuture) return null;
        return {
          lvl: 0,
          sel: k === todayK,
          label: human(k, true) + (k === todayK ? ' — сьогодні' : '')
        };
      }
    });

    host.innerHTML = card(
      '<div class="row row--split" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<h2 style="margin:0">Сезон ' + esc(EC.seasonLabel(code)) + '</h2>' +
        '<span class="small muted mono">день ' + day.passed + ' із ' + day.total + '</span>' +
      '</div>' +
      '<div class="row mt-1" style="gap:16px;flex-wrap:wrap">' +
        '<span class="small">Початок: <b>' + esc(human(startK, true)) + '</b></span>' +
        /* Кінець завжди неділя — це не випадковість, а правило, і воно
           варте одного слова: людина планує тиждень, а не квартал. */
        '<span class="small">Кінець: <b>' + esc(human(endK, true)) + '</b>' +
          '<span class="muted"> — неділя</span></span>' +
        '<span class="small">Лишилось: <b class="mono">' + (day.total - day.passed) + '</b> ' +
          esc(window.App.plural(day.total - day.passed, 'день', 'дні', 'днів')) + '</span>' +
      '</div>' +
      cal +
      '<p class="small muted mt-1 mb-0">Дві залиті клітинки — перший і останній день ' +
        'сезону. Кільце — сьогодні, бліді дні — попереду. Цей календар ' +
        '<b>не</b> показує тренування: заливка тут означає межу сезону, а не ' +
        'закритий день. Тренування — у <a href="journal.html#history">історії</a>.</p>');
  }

  /* ---------------- Оркестрація ---------------- */

  async function refresh() {
    const st = await Api.refresh();
    if (!st || !st.config) return;
    /* Події — ПЕРЕД шапкою: з них рахується тижневий підсумок, і без них
       шапка намалювалась би без нього, а потім смикнулась. */
    await loadRecent();
    /* Рівень звіряється тут, на серверному стані: кешований рендер нижче
       його не чіпає, інакше свято зʼїдалось би ще до показу. */
    renderHeader(st, levelJump(st.season, EC.levelFor(st.elo, st.config).level));
    renderGrace(st);
    renderCats(st);
    renderEvents();
    renderBoard(st);
    renderHistory();
  }

  async function init() {
    if (!$('#sz-header') || !EC) return;
    if (!Api) { renderSeasonCal(); return; }

    /* Календар сезону малюється ПЕРШИМ і незалежно від акаунта: його
       межі — арифметика календаря, а не серверний стан. */
    renderSeasonCal();

    if (!Api.available()) { renderLocked(); return; }

    /* Підпис у season_state підтягуємо один раз за завантаження. Сервер
       усе одно підставить затверджений нік, якщо він є (elo_set_name);
       аргумент важить лише для акаунтів без ніка. */
    try {
      const p = await window.Store.getProfile();
      if (p && p.displayName) Api.setName(p.displayName).catch(function () {});
    } catch (_) {}

    renderReport();
    const cachedSt = Api.cached();
    if (cachedSt && cachedSt.config) { renderHeader(cachedSt); renderGrace(cachedSt); renderCats(cachedSt); }
    refresh().catch(function () {
      if (!cachedSt) {
        $('#sz-header').innerHTML = card(
          '<p class="small muted mb-0">Немає звʼязку з сервером — показати нема чого. ' +
          'Дії, зроблені офлайн, дошлються самі.</p>');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
