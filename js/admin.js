/**
 * Адмін-панель заявок на акаунт.
 *
 * Це ЛИШЕ ІНТЕРФЕЙС. Хто адмін — вирішує таблиця public.admins у базі;
 * кожен RPC (admin_requests / admin_decide) сам перевіряє is_admin()
 * на сервері. Тут немає ні захардкоджених пошт, ні паролів, ні
 * фронтендових прапорців доступу: не-адмін побачить відмову сервера,
 * що б він не зробив із цією сторінкою.
 *
 * Дії: Approve / Reject / Block. Статус пише SECURITY DEFINER RPC,
 * а доступ до даних Get Stronger контролює RLS через is_approved().
 */
(function () {
  'use strict';

  const { $, esc, toast } = window.App;
  const Store = window.Store;

  const state = { rows: null, filter: 'pending', busy: false, denied: '' };

  const STATUS_UA = {
    pending:  { label: 'очікує',      cls: 'chip--warn' },
    approved: { label: 'підтверджено', cls: 'chip--ok' },
    rejected: { label: 'відхилено',   cls: '' },
    blocked:  { label: 'заблоковано', cls: '' }
  };

  const SEX_UA = { male: 'чоловік', female: 'жінка' };
  const TA_UA = { novice: 'до 1 року', inter: '1–2 роки', adv: '3–5 років', elite: 'понад 5 років' };

  function ageOf(birth) {
    const AC = window.AgeCore;
    if (!AC || !birth) return null;
    try { return AC.ageOn(birth); } catch (_) { return null; }
  }

  function dt(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return String(d.getDate()).padStart(2, '0') + '.' +
      String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear() + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function screeningHtml(r) {
    const s = r.screening || {};
    const items = [];
    if (r.birthDate) {
      const a = ageOf(r.birthDate);
      items.push('Дата народження: <b class="mono">' + esc(r.birthDate) + '</b>' + (a !== null ? ' (' + a + ' р.)' : ''));
    }
    if (s.sex) items.push('Стать: <b>' + esc(SEX_UA[s.sex] || s.sex) + '</b>');
    if (s.weight) items.push('Вага: <b class="mono">' + esc(String(s.weight)) + ' кг</b>');
    if (s.height) items.push('Зріст: <b class="mono">' + esc(String(s.height)) + ' см</b>');
    if (s.activity) items.push('Активність: <b class="mono">' + esc(String(s.activity)) + '</b>');
    if (s.trainingAge) items.push('Стаж: <b>' + esc(TA_UA[s.trainingAge] || s.trainingAge) + '</b>');
    if (s.hrRest) items.push('Пульс спокою: <b class="mono">' + esc(String(s.hrRest)) + '</b>');
    if (s.hrMax) items.push('Пульс макс.: <b class="mono">' + esc(String(s.hrMax)) + '</b>');
    if (!items.length) return '<p class="small muted mt-1 mb-0">Скринінг порожній (старий акаунт).</p>';
    return '<div class="row mt-1" style="gap:14px;flex-wrap:wrap">' +
      items.map(function (x) { return '<span class="small">' + x + '</span>'; }).join('') + '</div>';
  }

  function rowCard(r) {
    const st = STATUS_UA[r.status] || { label: r.status, cls: '' };
    const acts = [];
    if (r.status !== 'approved') acts.push('<button class="btn btn--primary btn--sm" type="button" data-adm="approve" data-uid="' + esc(r.userId) + '">Підтвердити</button>');
    if (r.status === 'pending') acts.push('<button class="btn btn--ghost btn--sm" type="button" data-adm="reject" data-uid="' + esc(r.userId) + '">Відхилити</button>');
    if (r.status !== 'blocked') acts.push('<button class="btn btn--ghost btn--sm" type="button" data-adm="block" data-uid="' + esc(r.userId) + '">Заблокувати</button>');

    return '<div class="card">' +
      '<div class="row row--split" style="align-items:baseline;gap:10px;flex-wrap:wrap">' +
        '<h3 style="margin:0">' + esc(r.username || '(без ніка)') + '</h3>' +
        '<span class="chip chip--sm ' + st.cls + '">' + esc(st.label) + '</span>' +
      '</div>' +
      '<div class="row mt-1" style="gap:14px;flex-wrap:wrap">' +
        '<span class="small muted">' + esc(r.email || '') + '</span>' +
        '<span class="small muted">заявка: ' + esc(dt(r.requestedAt)) + '</span>' +
        (r.decidedAt ? '<span class="small muted">рішення: ' + esc(dt(r.decidedAt)) + '</span>' : '') +
      '</div>' +
      screeningHtml(r) +
      (Array.isArray(r.consents) && r.consents.length
        ? '<p class="small muted mt-1" style="margin-bottom:0">Згоди: ' +
          r.consents.map(function (c) {
            const NAMES = { privacy_policy: 'конфіденційність', terms_of_use: 'умови', medical_disclaimer: 'мед. застереження' };
            return esc(NAMES[c.document] || c.document) + ' v' + esc(c.version);
          }).join(' · ') + '</p>'
        : '') +
      '<div class="row mt-2" style="gap:10px;flex-wrap:wrap">' + acts.join('') + '</div>' +
    '</div>';
  }

  function render() {
    const host = $('#adm');
    if (!host) return;

    if (state.denied) {
      host.innerHTML = '<div class="card"><p class="small mb-0">' + esc(state.denied) + '</p></div>';
      return;
    }
    if (!state.rows) {
      host.innerHTML = '<div class="card"><p class="small muted mb-0">Завантаження…</p></div>';
      return;
    }

    const pendingN = state.rows.filter(function (r) { return r.status === 'pending'; }).length;
    const shown = state.filter === 'pending'
      ? state.rows.filter(function (r) { return r.status === 'pending'; })
      : state.rows;

    host.innerHTML =
      '<div class="row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<div class="seg" role="radiogroup" aria-label="Фільтр заявок">' +
          '<label class="seg__item"><input type="radio" name="adm-f" value="pending"' + (state.filter === 'pending' ? ' checked' : '') + '><span>Очікують (' + pendingN + ')</span></label>' +
          '<label class="seg__item"><input type="radio" name="adm-f" value="all"' + (state.filter === 'all' ? ' checked' : '') + '><span>Усі (' + state.rows.length + ')</span></label>' +
        '</div>' +
        '<button class="btn btn--ghost btn--sm" type="button" id="adm-reload">Оновити</button>' +
      '</div>' +
      (shown.length
        ? '<div class="mt-2" style="display:grid;gap:14px">' + shown.map(rowCard).join('') + '</div>'
        : '<div class="card mt-2"><p class="small muted mb-0">' +
          (state.filter === 'pending' ? 'Нових заявок немає.' : 'Поки порожньо.') + '</p></div>');
  }

  async function load() {
    if (!Store.isCloud) { state.denied = 'Сайт у локальному режимі — адмін-панель недоступна.'; render(); return; }
    if (!Store.user()) {
      state.denied = 'Потрібен вхід в акаунт адміністратора.';
      render(); return;
    }
    try {
      /* Ліміт передаємо явно: RPC має значення за замовчуванням, але
         покладатись на них означає, що одного дня сторінка спробує
         витягти всіх користувачів одним запитом. Фільтр статусу
         лишається клієнтським — сторінка тримає одну сторінку заявок. */
      const rows = await Store.rpc('admin_requests', { p_limit: 200, p_offset: 0 });
      state.rows = Array.isArray(rows) ? rows : [];
      state.denied = '';
    } catch (e) {
      const msg = String((e && e.message) || '');
      state.denied = msg.indexOf('FORBIDDEN') !== -1
        ? 'Доступ лише для адміністратора. Це рішення сервера, не сторінки.'
        : 'Не вдалося завантажити заявки: ' + msg;
    }
    render();
  }

  const CONFIRM = {
    approve: 'Підтвердити цей акаунт? Людина отримає повний доступ до Forge.',
    reject: 'Відхилити заявку? Людина зможе подати нову.',
    block: 'Заблокувати акаунт? Доступ до даних Get Stronger буде закрито одразу.'
  };

  async function decide(uid, action) {
    if (state.busy) return;
    if (!window.confirm(CONFIRM[action])) return;
    state.busy = true;
    try {
      await Store.rpc('admin_decide', { p_user: uid, p_action: action });
      toast('Готово', 'ok');
      await load();
    } catch (e) {
      toast('Не вдалося: ' + ((e && e.message) || ''), 'err');
    }
    state.busy = false;
  }

  function init() {
    const host = $('#adm');
    if (!host) return;

    host.addEventListener('click', function (e) {
      const b = e.target.closest('[data-adm]');
      if (b) { decide(b.dataset.uid, b.dataset.adm); return; }
      if (e.target.closest('#adm-reload')) load();
    });
    host.addEventListener('change', function (e) {
      const f = e.target.closest('input[name="adm-f"]');
      if (f) { state.filter = f.value; render(); }
    });

    render();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
