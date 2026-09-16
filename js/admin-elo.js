/**
 * Адмінська вкладка ELO: ручне виставлення рейтингу для тестів.
 *
 * Це ЛИШЕ ІНТЕРФЕЙС — так само, як js/admin.js. Хто адмін, вирішує таблиця
 * public.admins; обидва RPC (admin_elo_list / admin_elo_set) самі питають
 * is_admin() на сервері. Сховати цю вкладку від не-адміна — питання
 * охайності, а не безпеки: навіть викликана вручну, вона дістане FORBIDDEN.
 *
 * НАВІЩО ВОНО ІСНУЄ. Рівні, ELITE-зона, таблиця лідерів і закриття
 * сезону — це стани, до яких «чесно» треба йти місяцями. Без можливості
 * поставити число їх неможливо ні побачити, ні перевірити.
 *
 * ЩО ЦЕ НЕ ЛАМАЄ. Сервер не переписує історію: кожне виставлення — окрема
 * подія в elo_events із категорією 'admin', дельтою й причиною. Денна
 * стеля такі події ігнорує, тож накрутка не з'їдає бюджет чесного дня
 * (див. db/admin-elo.sql).
 */
(function () {
  'use strict';

  const { $, esc, toast } = window.App;
  const Store = window.Store;

  const state = { rows: null, season: '', denied: '', busy: false, q: '', anomalies: {} };

  /** Рівень рахуємо тим самим ядром, що й решта сайту — не своєю копією. */
  function levelOf(elo) {
    const EC = window.EloCore, Api = window.EloApi;
    const st = Api && Api.cached();
    const cfg = st && st.config;
    if (!EC || !cfg) return null;
    try { return EC.levelFor(elo, cfg); } catch (_) { return null; }
  }

  /* Сигнали self-report (RPC admin_elo_anomalies). Рейтинг — за
     самозвітом, тож сервер не доводить, що тренування було; ці прапорці
     лише кажуть адміну, на кого подивитись. */
  const FLAG_UA = {
    perfect_streak: 'ідеальна серія ≥ 14 днів',
    all_perfect:    '≥ 90 % днів ідеальні',
    cap_weeks:      'бюджет тижня впритул ≥ 3 рази',
    backdated:      'половина подій заднім числом'
  };

  /* Межі шкали — з бойового конфігу, а не з памʼяті. Якщо конфіг ще не
     приїхав, беремо консервативні значення: краще недодати прав, ніж
     дозволити виставити число поза сезонною стелею. */
  function cfgNum(key, dflt) {
    try {
      const st = window.EloApi && window.EloApi.cached();
      const v = Number(st && st.config && st.config[key]);
      return Number.isFinite(v) && v > 0 ? v : dflt;
    } catch (_) { return dflt; }
  }
  function seasonMax()  { return cfgNum('seasonMax', 3000); }
  function eliteFloor() { return cfgNum('eliteFloor', 2400); }

  function quick(uid, v, tail) {
    return '<button class="btn btn--ghost btn--sm" type="button" data-ae="quick" data-uid="' +
      esc(uid) + '" data-v="' + v + '">' + v + esc(tail || '') + '</button>';
  }

  function anomalyHtml(uid) {
    const a = state.anomalies && state.anomalies[uid];
    if (!a) return '';
    const chips = (a.flags || []).map(function (f) {
      return '<span class="chip chip--sm chip--warn">' + esc(FLAG_UA[f] || f) + '</span>';
    }).join(' ');
    return '<p class="small muted mt-1 mb-0">' +
      'Активних днів: <b class="mono">' + a.activeDays + '</b> · ідеальних: <b class="mono">' + a.perfectDays +
      '</b> (серія ' + a.perfectStreak + ') · тижнів у стелі: <b class="mono">' + a.capWeeks +
      '</b> · заднім числом: <b class="mono">' + a.backdated + '/' + a.events + '</b>' +
      (chips ? '<br>' + chips : '') + '</p>';
  }

  function rowCard(r) {
    const lvl = levelOf(r.elo);
    const who = r.username || r.email || '(без ніка)';
    return '<div class="card">' +
      '<div class="row row--split" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<h3 style="margin:0">' + esc(who) +
          (r.me ? ' <span class="chip chip--sm chip--ok">це ви</span>' : '') + '</h3>' +
        '<span class="mono"><b>' + r.elo + '</b> ELO' +
          (lvl ? ' · ' + esc(lvl.name) : '') + '</span>' +
      '</div>' +
      (r.username && r.email
        ? '<p class="small muted mt-1 mb-0">' + esc(r.email) + '</p>' : '') +
      anomalyHtml(r.userId) +
      '<div class="row mt-2" style="gap:8px;flex-wrap:wrap;align-items:center">' +
        '<label class="sr-only" for="ae-v-' + esc(r.userId) + '">Нове значення ELO</label>' +
        '<input class="input" type="number" inputmode="numeric" min="0" max="' + seasonMax() + '" step="1" ' +
          'style="max-width:120px" id="ae-v-' + esc(r.userId) + '" ' +
          'value="' + r.elo + '" aria-label="Нове значення ELO для ' + esc(who) + '">' +
        '<button class="btn btn--primary btn--sm" type="button" ' +
          'data-ae="set" data-uid="' + esc(r.userId) + '">Поставити</button>' +
        /* Швидкі значення — межі, які й треба перевіряти: початок,
           середина, поріг ELITE, стеля сезону. Числа рахуються з конфігу:
           зашиті 2000 і 2500 стали неправдою тієї миті, коли перебаланс
           розтягнув шкалу до 3000 (ELITE від 2400). */
        quick(r.userId, 0, '0') +
        quick(r.userId, Math.round(eliteFloor() / 3), '') +
        quick(r.userId, Math.round(eliteFloor() / 3 * 2), '') +
        quick(r.userId, eliteFloor(), ' (ELITE)') +
        quick(r.userId, seasonMax(), '') +
      '</div>' +
    '</div>';
  }

  function render() {
    const host = $('#adm-elo');
    if (!host) return;

    if (state.denied) {
      host.innerHTML = '<div class="card"><p class="small mb-0">' + esc(state.denied) + '</p></div>';
      return;
    }
    if (!state.rows) {
      host.innerHTML = '<div class="card"><p class="small muted mb-0">Завантаження…</p></div>';
      return;
    }

    const q = state.q.trim().toLowerCase();
    const shown = q
      ? state.rows.filter(function (r) {
          return String(r.username || '').toLowerCase().indexOf(q) !== -1 ||
                 String(r.email || '').toLowerCase().indexOf(q) !== -1;
        })
      : state.rows;

    host.innerHTML =
      '<div class="card">' +
        '<h2 class="card__title">Рейтинг вручну</h2>' +
        '<p class="small muted" style="margin:6px 0 0">' +
          'Сезон <b class="mono">' + esc(state.season) + '</b>. Значення затискається в 0–' + seasonMax() + '. ' +
          'Кожна зміна лягає в історію окремою подією з причиною — вона видна ' +
          'і вам, і власнику акаунта. Денний бюджет чесних дій це не витрачає.' +
        '</p>' +
        '<div class="row mt-2" style="gap:10px;flex-wrap:wrap;align-items:center">' +
          '<label class="sr-only" for="ae-q">Пошук за ніком або поштою</label>' +
          '<input class="input" id="ae-q" type="search" placeholder="нік або пошта" ' +
            'style="max-width:240px" value="' + esc(state.q) + '">' +
          '<button class="btn btn--ghost btn--sm" type="button" id="ae-reload">Оновити</button>' +
        '</div>' +
      '</div>' +
      (shown.length
        ? '<div class="mt-2" style="display:grid;gap:14px">' + shown.map(rowCard).join('') + '</div>'
        : '<div class="card mt-2"><p class="small muted mb-0">Нікого не знайдено.</p></div>');
  }

  async function load() {
    if (!Store.isCloud) { state.denied = 'Сайт у локальному режимі — рейтингу немає.'; render(); return; }
    if (!Store.user()) { state.denied = 'Потрібен вхід в акаунт адміністратора.'; render(); return; }
    try {
      const res = await Store.rpc('admin_elo_list', { p_limit: 200 });
      state.rows = (res && Array.isArray(res.rows)) ? res.rows : [];
      state.season = (res && res.season) || '';
      state.denied = '';
      state.anomalies = {};
      try {
        const an = await Store.rpc('admin_elo_anomalies', { p_season: null });
        ((an && an.rows) || []).forEach(function (a) { state.anomalies[a.userId] = a; });
      } catch (_) { /* сигнали — додаток до списку, без них список усе одно показуємо */ }
    } catch (e) {
      const msg = String((e && e.message) || '');
      state.denied = msg.indexOf('FORBIDDEN') !== -1
        ? 'Доступ лише для адміністратора. Це рішення сервера, не сторінки.'
        : 'Не вдалося завантажити список: ' + msg;
    }
    render();
  }

  async function setElo(uid, value) {
    if (state.busy) return;
    const row = (state.rows || []).filter(function (r) { return r.userId === uid; })[0];
    const who = row ? (row.username || row.email || uid) : uid;
    const v = Math.round(Number(value));
    if (!Number.isFinite(v)) { toast('Введіть число', 'err'); return; }
    if (!window.confirm('Поставити ' + v + ' ELO для «' + who + '»?\n\n' +
                        'Зміна запишеться в історію рейтингу як дія адміністратора.')) return;

    state.busy = true;
    try {
      const reason = row && row.me ? 'Тест (власний акаунт)' : 'Ручне виставлення (адмін)';
      const res = await Store.rpc('admin_elo_set', { p_user: uid, p_elo: v, p_reason: reason });
      if (res && res.noop) {
        toast('Уже ' + v + ' — нічого не змінено', 'ok');
      } else {
        const d = res ? Number(res.delta) : 0;
        toast('Готово: ' + (res ? res.elo : v) + ' ELO (' + (d > 0 ? '+' : '') + d + ')', 'ok');
      }
      /* Свій рейтинг ще й у шапці: без скидання кешу бейдж показував би
         старе число до наступного оновлення сторінки. */
      if (row && row.me && window.EloApi && window.EloApi.refresh) {
        window.EloApi.refresh().catch(function () {});
      }
      await load();
    } catch (e) {
      const msg = String((e && e.message) || '');
      toast(msg.indexOf('FORBIDDEN') !== -1 ? 'Сервер відмовив: не адміністратор' : 'Не вдалося: ' + msg, 'err');
    }
    state.busy = false;
  }

  function init() {
    const host = $('#adm-elo');
    if (!host) return;

    /* Видимість панелей крутить js/admin.js (initTabs) — тут лишається
       рівно одне: підвантажити список, коли вкладку відкрили вперше.
       Повторний клік по вкладці нічого не запитує: дані вже є. */
    document.addEventListener('adm:tab', function (e) {
      if (e.detail === 'elo' && !state.rows && !state.denied) load();
    });

    host.addEventListener('click', function (e) {
      const b = e.target.closest('[data-ae]');
      if (b) {
        if (b.dataset.ae === 'quick') { setElo(b.dataset.uid, b.dataset.v); return; }
        const inp = $('#ae-v-' + b.dataset.uid);
        setElo(b.dataset.uid, inp ? inp.value : NaN);
        return;
      }
      if (e.target.closest('#ae-reload')) load();
    });

    host.addEventListener('input', function (e) {
      if (e.target.id === 'ae-q') {
        state.q = e.target.value;
        /* Перемальовуємо лише список, а поле пошуку лишаємо як є: повний
           render() знищив би інпут під пальцями разом із фокусом. */
        const cards = host.querySelectorAll('.card');
        const grid = cards.length ? cards[0].nextElementSibling : null;
        const q = state.q.trim().toLowerCase();
        const shown = q
          ? state.rows.filter(function (r) {
              return String(r.username || '').toLowerCase().indexOf(q) !== -1 ||
                     String(r.email || '').toLowerCase().indexOf(q) !== -1;
            })
          : (state.rows || []);
        if (grid) {
          grid.innerHTML = shown.length
            ? shown.map(rowCard).join('')
            : '<div class="card"><p class="small muted mb-0">Нікого не знайдено.</p></div>';
        }
      }
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
