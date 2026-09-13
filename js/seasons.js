/**
 * СТОРІНКА СЕЗОНІВ — що було в кожному завершеному сезоні.
 *
 * ЧОМУ ОКРЕМА СТОРІНКА. У рейтингу історія сезонів була рядком
 * «Осінь 2026 · #3 із 40 · 1200 ELO · L7» — тобто підсумком підсумку.
 * Усе, що сервер порахував за сезон, у той рядок не вміщалось і просто
 * не показувалось ніде: категорії з якістю виконання, активні дні,
 * витрачені Grace Weeks, найкращий і найгірший день, сильна й слабка
 * категорія. Дані лежали в elo_history від першого дня — їх ніхто не
 * бачив.
 *
 * Друга причина — питання інше. Рейтинг відповідає на «скільки в мене
 * ЗАРАЗ»: ELO, тиждень, місце, що нарахували сьогодні. «Як я пройшов
 * минулі сезони» — питання, яке виникає раз на квартал, і місце в
 * щоденному екрані воно займало щодня.
 *
 * ЩО ТУТ Є:
 *   1. поточний сезон — скільком він уже пройдений і коли буде підсумок;
 *   2. підсумки за всі завершені сезони одним рядом чисел;
 *   3. драбина: по смузі на сезон, частка від стелі сезону;
 *   4. розбір кожного сезону окремо, з нагородами саме за нього.
 *
 * ДАНІ — ТІЛЬКИ З СЕРВЕРА. elo_history (db/elo-engine.sql) і elo_state.
 * Тут немає жодної власної формули: рівень, місце, відсоток, якість —
 * усе вже порахував сервер при закритті сезону. Клієнт, який умів би
 * порахувати підсумок сезону, умів би його й вигадати.
 *
 * ЧОМУ СМУГИ, А НЕ ГРАФІК. Правило проєкту — «графік це лінія, а
 * стовпчиків немає ніде» (docs/ENGINEERING.md). Драбина сезонів — не
 * графік: нуль тут справжній (кожен сезон стартує з 0 ELO), стеля
 * справжня (seasonMax однаковий для всіх сезонів), і питання «наскільки
 * я вибрав сезон» — про частку, а не про зміну в часі. Це та сама
 * форма, що .vol__bar у раціоні, і вона взята як є.
 */
(function () {
  'use strict';

  const App = window.App || {};
  const $ = App.$ || function (s) { return document.querySelector(s); };
  const esc = App.esc || function (x) { return String(x == null ? '' : x); };
  const EC = window.EloCore;
  const V = window.EloView;
  const Api = window.EloApi;

  function card(inner) { return '<div class="card">' + inner + '</div>'; }
  function signed(n) { return (n > 0 ? '+' : '') + n; }

  /* Число або null. Історія приходить із сервера, але через localStorage
     вона теж проходить (кеш стану), а туди могла покласти не лише наша ж
     відповідь: усе, що йде в innerHTML, мусить бути числом за побудовою,
     а не за вірою (та сама причина, що в js/season.js). */
  function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
  function ns(v, dflt) { const x = n(v); return x === null ? (dflt === undefined ? '—' : dflt) : String(x); }

  const lbl = function (code) { return EC ? EC.seasonLabel(code) : String(code); };

  /* ------------------------------------------------------------------ */
  /* Без акаунта                                                         */
  /* ------------------------------------------------------------------ */
  /*
   * Та сама відповідь, що в рейтингу, і тими самими словами: сезонний
   * рейтинг живе в акаунті, і локального сурогата тут не малюється.
   * Різні формулювання на двох сторінках про одне й те саме читаються як
   * два різні обмеження.
   */
  function renderLocked() {
    const cloudOff = !(window.Store && window.Store.isCloud);
    $('#szs-now').innerHTML = card(
      '<h2 style="margin:0 0 8px">Потрібен акаунт</h2>' +
      '<p class="small muted mb-0">' +
        (cloudOff
          ? 'Сайт працює в локальному режимі без сервера — сезони, рейтинг і ' +
            'нагороди вимкнені. Тренування й харчування працюють як звичайно.'
          : 'Підсумки сезонів рахує сервер, і вони привʼязані до акаунта. ' +
            '<a href="account.html">Увійдіть або зареєструйтесь</a> — перший ' +
            'сезон почнеться з 0 ELO, як у всіх.') +
      '</p>');
  }

  /* ------------------------------------------------------------------ */
  /* 1. Поточний сезон                                                   */
  /* ------------------------------------------------------------------ */
  /*
   * ПОЧАТОК СТОРІНКИ — ТЕ, ЩО ТРИВАЄ, а не те, що скінчилось. Сторінка
   * про минуле, але відкриває її людина з поточним сезоном у голові, і
   * першим питанням буде «а цей коли закінчиться».
   *
   * КОЛИ БУДЕ ПІДСУМОК — окремий рядок, і він потрібен. Сезон
   * закінчується в неділю, а підсумок сервер підбиває ще пізніше: він
   * чекає submitWindowDays днів на дії, надіслані офлайн
   * (elo_close_season не закриє сезон раніше). Без цього рядка людина
   * приходить у понеділок, не бачить свого сезону в історії й вважає це
   * поламаним.
   */
  function renderNow(st) {
    const host = $('#szs-now');
    if (!host || !st || !st.config) return;
    const cfg = st.config;
    const day = EC.seasonDay(st.season);
    const lv = EC.levelFor(st.elo, cfg);
    const range = EC.seasonRange(st.season);
    const DC = window.DateCore;
    const endK = DC.keyOf(range[1]);
    const wait = n(cfg.submitWindowDays) || 0;
    /* +1 день: сервер закриває сезон, коли межа вже ПОЗАДУ
       (current_date > end + submitWindowDays), а не в той самий день. */
    const reportK = DC.shiftKey(endK, wait + 1);
    const left = day.total - day.passed;
    const pct = Math.max(0, Math.min(100, Math.round(st.elo / (n(cfg.seasonMax) || 2500) * 1000) / 10));

    host.innerHTML = card(
      '<div class="row row--split" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<h2 style="margin:0">' + esc(lbl(st.season)) + '</h2>' +
        '<span class="small muted mono">день ' + day.passed + ' із ' + day.total + '</span>' +
      '</div>' +
      '<div class="rating-hero mt-2">' +
        '<span class="rating-hero__val mono">' + ns(st.elo, '0') + '<span class="tile__of"> ELO</span></span>' +
        '<span class="rating-hero__meta">' +
          '<span class="lvl-circle">' + App.levelIcon(lv.level, lv.name) + '</span>' +
          '<span class="small muted">' + esc(lv.name) + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="vol mt-2"><span class="vol__name">Від стелі сезону</span>' +
        '<span class="vol__bar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="vol__num mono">' + ns(st.elo, '0') +
          '<span class="vol__target">/' + ns(cfg.seasonMax) + '</span></span>' +
        '<span></span>' +
      '</div>' +
      '<div class="row mt-2" style="gap:16px;flex-wrap:wrap">' +
        (n(st.rank) ? '<span class="small">Місце: <b class="mono">#' + ns(st.rank) + '</b> із ' + ns(st.of) + '</span>' : '') +
        '<span class="small">Лишилось: <b class="mono">' + left + '</b> ' +
          esc(App.plural(left, 'день', 'дні', 'днів')) + '</span>' +
        '<span class="small">Grace: <b class="mono">' + ns(st.graceUsed, '0') + ' / ' +
          ns(cfg.graceWeeksPerSeason) + '</b></span>' +
      '</div>' +
      '<p class="small muted mt-2 mb-0">Сезон закінчується <b>' + esc(V.human(endK, true)) +
        '</b> — це завжди неділя. Підсумок зʼявиться нижче <b>' + esc(V.human(reportK, true)) +
        '</b>: після кінця сезону сервер чекає ще ' + wait + ' ' +
        esc(App.plural(wait, 'день', 'дні', 'днів')) + ' на дії, надіслані офлайн. ' +
        'Поточне ELO в підсумки ще не входить — сезон не результат, поки він триває. ' +
        '<a href="rating.html">Рейтинг →</a></p>');
  }

  /* ------------------------------------------------------------------ */
  /* 2. Підсумки за всі сезони                                           */
  /* ------------------------------------------------------------------ */
  /*
   * ШІСТЬ ЧИСЕЛ, А НЕ ДВАНАДЦЯТЬ. Спокуса показати все, що вміє
   * seasonStats, велика, але ряд із дванадцяти плиток не читається — він
   * перетворює підсумок на таблицю. Тут лише те, на що людина справді
   * дивиться: скільки сезонів, найкращий результат, найкраще місце,
   * скільки разів був ELITE, наскільки регулярно і скільки в середньому.
   *
   * ПРОЧЕРК, А НЕ НУЛЬ. Сезон без місця (учасників було менше за поріг,
   * сервер не рахував рангу) дає прочерк: «найкраще місце 0» виглядало б
   * як перше місце, і навіть краще за нього.
   */
  function kpi(val, label, sub) {
    return '<div class="kpi">' +
      '<div class="kpi__val mono">' + val + '</div>' +
      '<p class="kpi__lbl">' + esc(label) + '</p>' +
      (sub ? '<p class="kpi__trend small muted">' + esc(sub) + '</p>' : '') +
    '</div>';
  }

  function renderSummary(stats) {
    const host = $('#szs-sum');
    if (!host) return;
    if (!stats.seasons) { host.innerHTML = ''; return; }

    host.innerHTML = card(
      '<h2 style="margin:0 0 4px">За весь час</h2>' +
      '<p class="small muted" style="margin:0 0 14px">Тільки завершені сезони: поточний ' +
        'зайде сюди, коли сервер підібʼє його підсумок.</p>' +
      '<div class="kpis">' +
        kpi(stats.seasons, 'сезонів завершено') +
        kpi(stats.best ? stats.best.elo : '—', 'найкраще ELO',
            stats.best ? lbl(stats.best.season) : '') +
        kpi(stats.bestRank ? '#' + stats.bestRank.rank : '—', 'найкраще місце',
            stats.bestRank ? 'із ' + ns(stats.bestRank.of) + ' · ' + lbl(stats.bestRank.season) : 'рангу ще не було') +
        kpi(stats.eliteSeasons, 'сезонів у ELITE',
            stats.bestPercentile ? 'найкращий відсоток: Top ' + stats.bestPercentile.percentile + '%' : '') +
        kpi(stats.consistency === null ? '—' : stats.consistency + '%', 'активних днів',
            stats.daysTotal ? stats.daysActive + ' із ' + stats.daysTotal : '') +
        kpi(stats.avgElo === null ? '—' : stats.avgElo, 'середнє ELO за сезон',
            stats.delta === null ? '' : 'останній: ' + signed(stats.delta) + ' до попереднього') +
      '</div>');
  }

  /* ------------------------------------------------------------------ */
  /* 3. Драбина сезонів                                                  */
  /* ------------------------------------------------------------------ */
  /*
   * Поточний сезон стоїть у драбині останнім і позначений словом: без
   * нього драбина обривається на минулому й не відповідає на «а зараз
   * як». Але позначений він обовʼязково — інакше незакінчений сезон
   * читався б як результат, і слабка смуга посеред сезону виглядала б
   * як провал.
   */
  function renderLadder(hist, cfg, now) {
    const host = $('#szs-ladder');
    if (!host) return;
    const rows = V.seasonLadder(hist, cfg && cfg.seasonMax, now);
    /* Один сезон і той поточний — драбині нема що показувати: одна смуга
       не шкала, а те саме число, що вже стоїть вище. */
    if (rows.filter(function (r) { return !r.current; }).length === 0) { host.innerHTML = ''; return; }

    host.innerHTML = card(
      '<h2 style="margin:0 0 4px">Сезон за сезоном</h2>' +
      '<p class="small muted" style="margin:0 0 14px">Смуга — частка від стелі сезону ' +
        '(' + ns(cfg && cfg.seasonMax) + ' ELO). Стеля однакова для всіх сезонів, тому смуги ' +
        'можна порівнювати очима.</p>' +
      '<div class="vol-list">' + rows.map(function (r) {
        return '<div class="vol">' +
          '<span class="vol__name">' + esc(lbl(r.season)) +
            /* Крапка-роздільник обовʼязкова: без неї «Осінь 2026 зараз»
               читається як назва сезону, а не як позначка. */
            (r.current ? ' <span class="vol__target">· зараз</span>' : '') + '</span>' +
          '<span class="vol__bar"><i style="width:' + r.pct + '%"></i></span>' +
          '<span class="vol__num mono">' + r.elo + '</span>' +
          '<span class="small muted">' +
            (r.elite ? 'ELITE' : (r.level ? 'L' + r.level : '')) + '</span>' +
        '</div>';
      }).join('') + '</div>');
  }

  /* ------------------------------------------------------------------ */
  /* 4. Розбір кожного сезону                                            */
  /* ------------------------------------------------------------------ */
  /*
   * АКОРДЕОН, А НЕ ПРОСТИНЯ. Розбір одного сезону — це десять рядків
   * плюс категорії плюс нагороди. Чотири сезони поспіль розгорнутими
   * дадуть екран, у якому нічого не знайти. Тому розгорнутий лише
   * НАЙНОВІШИЙ: саме його й прийшли дивитись, а решта відкривається
   * одним дотиком.
   *
   * Механізм — той самий .acc + App.initAccordions, що згортає довгі
   * пояснення по всьому сайту.
   */
  const CHEVRON = '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 9l6 6 6-6"/></svg>';

  /* Пʼять категорій, які сервер зважує в stats (db/elo-engine.sql).
     Підписи — з одного місця на весь рейтинг (js/elo-view-core.js). */
  const CATS = ['training', 'nutrition', 'sleep', 'recovery', 'activity'];

  function catRows(stats) {
    const rows = CATS.filter(function (c) { return stats && stats[c]; }).map(function (c) {
      const s = stats[c];
      const elo = n(s.elo);
      const q = Math.round((Number(s.avgQuality) || 0) * 100);
      return '<div class="vol">' +
        '<span class="vol__name">' + esc(V.catLabel(c)) + '</span>' +
        /* Смуга тут — ЯКІСТЬ виконання (0..100%), а не ELO: у різних
           категоріях стелі різні, і порівнювати їх за очками означало б
           порівнювати вагу з довжиною. Якість порівнювана за побудовою. */
        '<span class="vol__bar"><i style="width:' + Math.max(0, Math.min(100, q)) + '%"></i></span>' +
        '<span class="vol__num mono">' + (elo === null ? '—' : (elo >= 0 ? '+' : '') + elo) + '</span>' +
        '<span class="small muted mono">' + q + '%</span>' +
      '</div>';
    }).join('');
    return rows
      ? '<p class="small muted" style="margin:14px 0 8px">Категорії: скільки ELO дала кожна ' +
        'і з якою середньою якістю виконання.</p><div class="vol-list">' + rows + '</div>'
      : '';
  }

  function factsRows(h) {
    const out = [];
    if (n(h.rank)) out.push(['Місце', '#' + ns(h.rank) + ' із ' + ns(h.of)]);
    if (n(h.percentile)) out.push(['Верхній відсоток', 'Top ' + ns(h.percentile) + '%']);
    if (n(h.daysActive) !== null && n(h.daysTotal)) {
      out.push(['Активних днів', ns(h.daysActive) + ' із ' + ns(h.daysTotal) +
        ' · ' + Math.round(n(h.daysActive) / n(h.daysTotal) * 100) + '%']);
    }
    if (n(h.graceUsed) !== null) out.push(['Grace Weeks', ns(h.graceUsed)]);
    const s = h.stats || {};
    if (n(s.biggestGain) !== null) out.push(['Найкращий день', '+' + ns(s.biggestGain)]);
    if (n(s.biggestLoss) !== null && n(s.biggestLoss) < 0) out.push(['Найгірший день', ns(s.biggestLoss)]);
    if (s.bestCategory) out.push(['Сильна категорія', V.catLabel(s.bestCategory)]);
    if (s.weakestCategory && s.weakestCategory !== s.bestCategory) {
      out.push(['Слабка категорія', V.catLabel(s.weakestCategory)]);
    }
    if (!out.length) return '';
    return '<div>' + out.map(function (p) {
      return '<div class="row row--split small" style="padding:6px 0;border-bottom:1px solid var(--line);gap:10px">' +
        '<span class="muted">' + esc(p[0]) + '</span>' +
        '<b class="mono">' + esc(p[1]) + '</b>' +
      '</div>';
    }).join('') + '</div>';
  }

  function seasonBlock(h, awards, open) {
    const mine = (awards || []).filter(function (a) { return a && a.season === h.season; });
    return '<div class="acc' + (open ? ' is-open' : '') + '">' +
      '<button class="acc__head" type="button">' +
        '<span>' +
          '<h3>' + esc(lbl(h.season)) + '</h3>' +
          '<span class="small muted">' + ns(h.elo) + ' ELO · Level ' + ns(h.level) +
            (h.elite === true ? ' · ELITE' : '') +
            (n(h.rank) ? ' · #' + ns(h.rank) + ' із ' + ns(h.of) : '') +
          '</span>' +
        '</span>' +
        CHEVRON +
      '</button>' +
      '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
        factsRows(h) +
        catRows(h.stats) +
        /*
         * НАГОРОДИ САМЕ ЗА ЦЕЙ СЕЗОН. На вітрині (awards.html) вони
         * лежать усі разом, і «за що саме» доводиться згадувати. Тут
         * відповідь стоїть поруч із сезоном, у якому їх дали.
         */
        (mine.length
          ? '<p class="small muted" style="margin:14px 0 8px">Нагороди сезону:</p>' +
            (window.Award
              ? window.Award.grid(mine, { seasonLabel: lbl, href: 'awards.html' })
              : '')
          : '<p class="small muted" style="margin:14px 0 0">Нагород за цей сезон немає. ' +
            'Їх дають із 5 рівня і за місце в таблиці — <a href="awards.html">що саме буває</a>.</p>') +
      '</div></div></div>' +
    '</div>';
  }

  function renderList(hist, awards) {
    const host = $('#szs-list');
    if (!host) return;
    /* Від найновішого до найстарішого: сторінку відкривають через
       останній сезон, а не через перший. */
    const rows = V.ordered(hist).reverse();
    if (!rows.length) {
      host.innerHTML = card(
        '<h2 style="margin:0 0 6px">Завершених сезонів ще немає</h2>' +
        '<p class="small muted mb-0">Перший підсумок зʼявиться тут після закриття ' +
        'поточного сезону. У ньому буде все, що сервер порахував за три місяці: ' +
        'фінальне ELO й рівень, місце в таблиці та верхній відсоток, активні дні, ' +
        'витрачені Grace Weeks, найкращий і найгірший день, розклад по категоріях ' +
        'із якістю виконання — і нагороди, які цей сезон приніс.</p>');
      return;
    }
    host.innerHTML =
      '<h2 style="margin:0 0 12px">Розбір сезонів</h2>' +
      rows.map(function (h, i) { return seasonBlock(h, awards, i === 0); }).join('');
    App.initAccordions(host);
  }

  /* ------------------------------------------------------------------ */
  /* Оркестрація                                                         */
  /* ------------------------------------------------------------------ */
  /*
   * ДВА ДЖЕРЕЛА, ОДИН ЗАПИТ НА КОЖНЕ. elo_state дає поточний сезон і
   * конфіг, elo_history — завершені сезони й нагороди. Історія тягнеться
   * РАЗ: її склад міняється лише із закриттям сезону, тобто чотири рази
   * на рік.
   *
   * Кешований стан малюється першим, щоб сторінка не була порожньою, поки
   * летить запит. Черговості рендерів, як у рейтингу, тут не потрібно:
   * свіжий стан приходить один раз і після кешованого — обидва рендери
   * синхронні, гонки між ними немає.
   */
  async function init() {
    if (!$('#szs-now') || !EC || !V) return;

    if (!Api || !Api.available()) { renderLocked(); return; }

    const cached = Api.cached();
    if (cached && cached.config) renderNow(cached);

    let st = (cached && cached.config) ? cached : null;
    try {
      const fresh = await Api.refresh();
      /* Відповідь без config — не стан, а порожня відповідь: рахувати
         від неї «день сезону» й «частку від стелі» нема чого. */
      if (fresh && fresh.config) { st = fresh; renderNow(st); }
    } catch (_) { /* лишається кеш, якщо він був */ }

    if (!st) {
      /*
       * Стан сезону не приїхав. Це НЕ привід лишити верх сторінки
       * порожнім: порожнеча читається як «тут нічого немає», хоч
       * підсумки завершених сезонів нижче від цього стану не залежать —
       * вони приходять іншим запитом.
       */
      $('#szs-now').innerHTML = card(
        '<p class="small muted mb-0">Поточний сезон показати нема з чого — сервер не ' +
        'відповів. Підсумки завершених сезонів нижче від цього не залежать: вони ' +
        'приходять окремим запитом. <a href="rating.html">Рейтинг →</a></p>');
    }

    let data = null;
    try { data = await Api.history(); } catch (_) {}
    if (!data) {
      /* Історії немає й вигадувати її з localStorage не будемо: нагорода
         чи сезон, які можна собі приписати в браузері, нічого не варті. */
      $('#szs-list').innerHTML = card(
        '<p class="small muted mb-0">Підсумки сезонів не завантажились — немає звʼязку ' +
        'з сервером. Спробуйте пізніше: вони зберігаються на сервері й не губляться.</p>');
      return;
    }

    const hist = (data && data.history) || [];
    const awards = (data && data.awards) || [];
    const cfg = st ? st.config : null;
    const lv = st ? EC.levelFor(st.elo, st.config) : null;
    const now = st
      ? { season: st.season, elo: st.elo, level: lv.level, elite: lv.elite }
      : null;

    renderSummary(V.seasonStats(hist));
    renderLadder(hist, cfg, now);
    renderList(hist, awards);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
