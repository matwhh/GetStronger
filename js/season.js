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

  async function renderHeader(st) {
    const host = $('#sz-header');
    if (!host) return;

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

    host.innerHTML = card(
      '<div class="row row--split" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<h2 style="margin:0;text-transform:uppercase">' + esc(name || 'Атлет') + '</h2>' +
        '<span class="small muted">' + esc(EC.seasonLabel(st.season)) + ' · день ' + passed + ' із ' + total + '</span>' +
      '</div>' +
      '<div class="rating-hero mt-2">' +
        '<span class="rating-hero__val mono">' + st.elo + '<span class="tile__of"> ELO</span></span>' +
        '<span class="rating-hero__meta">' +
          '<span class="lvl-circle">' + window.App.levelIcon(lvl.level, lvl.name) + '</span>' +
          '<span class="small muted">' + esc(lvl.name) + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="vol" style="margin-top:8px"><span class="vol__bar"><i style="width:' + lvl.pct + '%"></i></span></div>' +
      '<div class="row mt-2" style="gap:16px;flex-wrap:wrap">' +
        '<span class="small">Сьогодні: <b class="mono">' + signed(st.today || 0) + ' ELO</b></span>' +
        (lvl.elite
          ? '<span class="small"><b>ELITE</b> — до стелі ' + (st.config.seasonMax - st.elo) + ' ELO</span>'
          /* На десятому рівні наступного рівня немає — далі тільки ELITE.
             Раніше тут писалось «До Level 11», рівня, якого не існує. */
          : '<span class="small">До ' +
            (lvl.level >= st.config.levelCount ? 'ELITE' : 'Level ' + (lvl.level + 1)) +
            ': <b class="mono">' + (lvl.ceil + 1 - st.elo) + ' ELO</b></span>') +
        (st.rank ? '<span class="small">Місце: <b class="mono">#' + st.rank + '</b> із ' + st.of + '</span>' : '') +
      '</div>' +

      '<div class="kpis mt-2">' +
        '<div class="kpi"><div class="kpi__val mono">' + ident.awards + '</div><p class="kpi__lbl">нагород</p></div>' +
        '<div class="kpi"><div class="kpi__val mono">' + ident.seasons + '</div><p class="kpi__lbl">сезонів завершено</p></div>' +
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

  async function renderEvents() {
    try {
      const events = await window.Store.rpc('elo_recent', { p_limit: 14 });
      if (!Array.isArray(events) || !events.length) {
        $('#sz-events').innerHTML = card(
          '<h3 class="card__title">Події ELO</h3>' +
          '<p class="small muted mb-0">Ще порожньо. Закрийте тренування, день харчування ' +
          'чи відміть сон — і перші очки прийдуть одразу.</p>');
        return;
      }
      $('#sz-events').innerHTML = card(
        '<h3 class="card__title">Останні події</h3>' +
        '<div class="mt-1">' + events.map(function (e) {
          return '<div class="row row--split small" style="padding:7px 0;border-bottom:1px solid var(--line);gap:10px">' +
            '<span>' + esc(e.reason) + ' <span class="muted">· ' + esc(e.day) + '</span></span>' +
            '<b class="mono" style="color:var(' + (e.delta >= 0 ? '--ok' : '--acc-ink') + ')">' +
              signed(e.delta) + '</b>' +
          '</div>';
        }).join('') + '</div>');
    } catch (_) { $('#sz-events').innerHTML = ''; }
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

  async function renderHistory() {
    try {
      const data = await Api.history();
      const hist = (data && data.history) || [];
      const awards = (data && data.awards) || [];
      if (!hist.length && !awards.length) { $('#sz-history').innerHTML = ''; return; }
      $('#sz-history').innerHTML = card(
        '<h3 class="card__title">Історія сезонів</h3>' +
        (hist.length
          ? '<div class="mt-1">' + hist.map(function (h) {
              return '<div class="row row--split small" style="padding:7px 0;border-bottom:1px solid var(--line);gap:10px">' +
                '<span>' + esc(EC.seasonLabel(h.season)) +
                  (h.rank ? ' <span class="muted">· #' + h.rank + ' із ' + h.of + '</span>' : '') +
                  (h.percentile ? ' <span class="muted">· Top ' + h.percentile + '%</span>' : '') +
                '</span>' +
                '<b class="mono">' + h.elo + ' ELO · L' + h.level + (h.elite ? ' ELITE' : '') + '</b>' +
              '</div>';
            }).join('') + '</div>'
          : '<p class="small muted">Перший сезон ще триває — історія зʼявиться після його завершення.</p>') +
        /*
         * Нагороди — КАРТКИ, а не чипи. Чип виглядав як мітка на речі, а
         * не як сама річ: рядок однакових сірих капсул неможливо
         * прочитати як «я це заслужив». Компонент — js/award-core.js.
         */
        /*
         * Тут ПРЕВʼЮ, а розмова про нагороди — на awards.html. Тому
         * картка веде туди, а не перевертається: тап не може означати
         * одночасно «перевернути» і «перейти», і з двох значень корисніше
         * друге — на сторінці нагород видно ще й те, чого в тебе немає.
         */
        (awards.length
          ? '<div class="row row--split mt-2" style="align-items:baseline;gap:10px">' +
              '<h3 class="card__title" style="margin:0">Нагороди</h3>' +
              '<a class="small" href="awards.html">Усі нагороди</a>' +
            '</div>' +
            (window.Award
              ? window.Award.grid(awards, { seasonLabel: EC.seasonLabel, href: 'awards.html' })
              /* Модуль не завантажився — краще сірі капсули, ніж порожньо. */
              : '<div class="row mt-1" style="gap:8px;flex-wrap:wrap">' + awards.map(function (a) {
                  return '<span class="chip">' + esc(a.label) + ' · ' + esc(EC.seasonLabel(a.season)) + '</span>';
                }).join('') + '</div>')
          : ''));
    } catch (_) { $('#sz-history').innerHTML = ''; }
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

  var CAT_UA = {
    training: 'Тренування', nutrition: 'Харчування', sleep: 'Сон',
    recovery: 'Відновлення', activity: 'Активність'
  };

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
  const HUMAN_MON = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
                     'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

  function human(k, withYear) {
    const p = String(k).split('-').map(Number);
    return p[2] + ' ' + HUMAN_MON[p[1] - 1] + (withYear ? ' ' + p[0] : '');
  }

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
    renderHeader(st);
    renderGrace(st);
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
    if (cachedSt && cachedSt.config) { renderHeader(cachedSt); renderGrace(cachedSt); }
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
