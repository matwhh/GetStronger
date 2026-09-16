/**
 * Профіль залу — ввід інвентарю. Уся арифметика в js/gym-core.js, тут
 * лише поля й попередній перегляд.
 *
 * ЧОМУ МЛИНЦІ — ФІКСОВАНИЙ СПИСОК НОМІНАЛІВ, А НЕ «ДОДАТИ РЯДОК».
 * Номінали млинців у світі однакові: 25, 20, 15, 10, 5, 2,5, 1,25.
 * Список із кнопками «додати» й «прибрати» дав би ту саму сімку, але
 * коштував би вдвічі більше коду й додав би стан, який можна зламати.
 * Нуль пар означає «таких немає» — цього досить.
 *
 * ЧОМУ КАРТКА ЖИВЕ НА «МОЄМУ ПЛАНІ». Саме там правлять робочі ваги, і
 * саме там число «+2,5» перестає бути правдою, коли в залі немає
 * дрібних млинців. Окрема сторінка для семи полів означала б ще один
 * пункт меню, у який ніхто не зайде.
 */
(function () {
  'use strict';

  const { $, esc, toast } = window.App;
  const G = window.GymCore;

  /** Номінали млинців. Порядок — від важчих, як їх і вішають. */
  const DENOM = [25, 20, 15, 10, 5, 2.5, 1.25];

  /** Типовий набір комерційного залу: по дві пари кожного номіналу */
  const TYPICAL = { 25: 2, 20: 2, 15: 2, 10: 2, 5: 2, 2.5: 2, 1.25: 2 };

  const state = { gym: null, saving: false };

  /*
   * СВІЙ ФОРМАТ, А НЕ fmtNum.kg.
   *
   * Загальний форматувальник ваги округлює до десятої — і млинець 1,25
   * підписувався «1,3 кг». Такого млинця не буває, а людина шукає в
   * картці рівно те, що написано на чавуні. Тут потрібні два знаки,
   * і тільки тут: у вагах підходів десятої вистачає з головою.
   */
  const kg = function (v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return String(Math.round(n * 100) / 100).replace('.', ',');
  };

  function num(el) {
    const v = String((el && el.value) || '').replace(',', '.').trim();
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Те, що зараз у полях, у формі профілю залу */
  function fromFields(box) {
    const plates = DENOM.map(function (d) {
      return { kg: d, pairs: num(box.querySelector('[data-plate="' + d + '"]')) || 0 };
    }).filter(function (p) { return p.pairs > 0; });

    return G.normGym({
      bar: num(box.querySelector('#gym-bar')),
      plates: plates,
      dumbbells: {
        from: num(box.querySelector('#gym-db-from')),
        to: num(box.querySelector('#gym-db-to')),
        step: num(box.querySelector('#gym-db-step'))
      },
      machineStep: num(box.querySelector('#gym-ms'))
    });
  }

  /**
   * Попередній перегляд — головна частина картки, а не прикраса.
   *
   * Людина вводить млинці не заради списку млинців: вона хоче знати, які
   * ваги реально можна поставити. Показуємо саме це — перші кілька
   * сходинок і найменший крок, — бо з самого набору млинців крок в умі
   * рахує не кожен.
   */
  function previewText(gym) {
    const out = [];

    if (G.knows('barbell', gym)) {
      const l = G.ladder('barbell', gym) || [];
      const head = l.slice(0, 5).map(kg).join(' · ');
      const step = l.length > 1 ? Math.round((l[1] - l[0]) * 100) / 100 : null;
      out.push('Штанга: ' + head + (l.length > 5 ? ' …' : '') +
        (step ? ' (найменший крок ' + kg(step) + ' кг, стеля ' + kg(l[l.length - 1]) + ')' : ''));
    }
    if (G.knows('dumbbell', gym)) {
      out.push('Гантелі: від ' + kg(gym.dumbbells.from) + ' до ' + kg(gym.dumbbells.to) +
        ' через ' + kg(gym.dumbbells.step) + ' кг');
    }
    if (G.knows('machine', gym)) {
      out.push('Тренажери: кратне ' + kg(gym.machineStep) + ' кг');
    }

    if (!out.length) {
      return 'Порожньо — крок ваги лишається таким, яким був: 2,5 кг від двадцяти ' +
             'і вище, 1 кг нижче.';
    }
    return out.join('. ') + '.';
  }

  function plateField(d, pairs) {
    return '<div class="field" style="flex:0 0 76px">' +
      '<label class="field__label" for="gym-p' + String(d).replace('.', '-') + '">' +
        kg(d) + ' кг</label>' +
      '<input class="input input--sm num mono" id="gym-p' + String(d).replace('.', '-') + '" ' +
        'type="number" min="0" max="20" step="1" inputmode="numeric" autocomplete="off" ' +
        'data-plate="' + d + '" value="' + (pairs || '') + '" placeholder="0" ' +
        'aria-label="Пар млинців по ' + kg(d) + ' кг">' +
    '</div>';
  }

  function render() {
    const host = $('#gym-profile');
    if (!host || !G) return;

    const gym = state.gym || G.normGym(null);
    const pairs = {};
    (gym.plates || []).forEach(function (p) { pairs[p.kg] = p.pairs; });
    const db = gym.dumbbells || {};

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Профіль залу</h2>' +
          '<span class="small muted">необовʼязково</span>' +
        '</div>' +
        '<p class="small muted mt-1">' +
          'Крок ваги на сайті — 2,5 кг: це пара млинців по 1,25. Якщо їх у вашому ' +
          'залі немає, найменша добавка інша, і «+2,5» — вигадка. Скажіть, що ' +
          'реально є, і розминкові сходинки та підказки почнуть показувати ваги, ' +
          'які справді можна зібрати.' +
        '</p>' +

        '<div class="row mt-2" style="gap:12px;flex-wrap:wrap">' +
          '<div class="field" style="flex:0 0 120px">' +
            '<label class="field__label" for="gym-bar">Гриф, кг</label>' +
            '<input class="input input--sm num mono" id="gym-bar" type="text" ' +
              'inputmode="decimal" autocomplete="off" placeholder="20" value="' +
              (gym.bar === null ? '' : esc(kg(gym.bar))) + '">' +
          '</div>' +
          '<div class="field" style="flex:0 0 150px">' +
            '<label class="field__label" for="gym-ms">Крок стека, кг</label>' +
            '<input class="input input--sm num mono" id="gym-ms" type="text" ' +
              'inputmode="decimal" autocomplete="off" placeholder="—" value="' +
              (gym.machineStep === null ? '' : esc(kg(gym.machineStep))) + '">' +
          '</div>' +
        '</div>' +

        '<h3 class="card__title mt-2" style="margin-bottom:6px">Млинці — скільки пар</h3>' +
        '<p class="small muted" style="margin:0 0 8px">' +
          'Парами, бо на штангу вішають симетрично: «дві пари по 10» — це чотири млинці.' +
        '</p>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap">' +
          DENOM.map(function (d) { return plateField(d, pairs[d]); }).join('') +
        '</div>' +
        '<button class="btn btn--ghost btn--sm mt-2" type="button" id="gym-typical">' +
          'Типовий набір</button>' +

        '<h3 class="card__title mt-2" style="margin-bottom:6px">Гантельний ряд</h3>' +
        '<div class="row" style="gap:12px;flex-wrap:wrap">' +
          '<div class="field" style="flex:0 0 96px">' +
            '<label class="field__label" for="gym-db-from">Від, кг</label>' +
            '<input class="input input--sm num mono" id="gym-db-from" type="text" ' +
              'inputmode="decimal" autocomplete="off" placeholder="—" value="' +
              (db.from == null ? '' : esc(kg(db.from))) + '">' +
          '</div>' +
          '<div class="field" style="flex:0 0 96px">' +
            '<label class="field__label" for="gym-db-to">До, кг</label>' +
            '<input class="input input--sm num mono" id="gym-db-to" type="text" ' +
              'inputmode="decimal" autocomplete="off" placeholder="—" value="' +
              (db.to == null ? '' : esc(kg(db.to))) + '">' +
          '</div>' +
          '<div class="field" style="flex:0 0 96px">' +
            '<label class="field__label" for="gym-db-step">Крок, кг</label>' +
            '<input class="input input--sm num mono" id="gym-db-step" type="text" ' +
              'inputmode="decimal" autocomplete="off" placeholder="—" value="' +
              (db.step == null ? '' : esc(kg(db.step))) + '">' +
          '</div>' +
        '</div>' +

        '<p class="field__hint mt-2" data-gym-prev>' + esc(previewText(gym)) + '</p>' +

        '<div class="row mt-2" style="gap:10px;flex-wrap:wrap">' +
          '<button class="btn btn--primary btn--sm" type="button" id="gym-save">Зберегти</button>' +
          '<button class="btn btn--ghost btn--sm" type="button" id="gym-clear">Очистити</button>' +
        '</div>' +
      '</div>';
  }

  /* Перегляд оновлюємо ТЕКСТОМ, не перемальовуючи картку: перемальовка
     під час набору забирає фокус із поля, у якому зараз друкують. */
  function syncPreview(box) {
    const el = box.querySelector('[data-gym-prev]');
    if (el) el.textContent = previewText(fromFields(box));
  }

  async function save(box) {
    if (state.saving) return;
    state.saving = true;
    const gym = fromFields(box);
    /* Порожній профіль пишемо як null, а не як обʼєкт із порожніми
       полями: «не заповнювали» і «заповнили нічим» — це одне й те саме,
       і два способи записати одне розійдуться при першій же перевірці. */
    const empty = !G.knows('barbell', gym) && !G.knows('dumbbell', gym) && !G.knows('machine', gym);
    try {
      await window.Store.saveProfile({ gym: empty ? null : gym });
      state.gym = empty ? null : gym;
      toast(empty ? 'Профіль залу очищено' : 'Профіль залу збережено', 'ok');
    } catch (e) {
      toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err');
    } finally {
      state.saving = false;
    }
  }

  function wire() {
    const host = $('#gym-profile');
    if (!host) return;

    host.addEventListener('input', function () { syncPreview(host); });

    host.addEventListener('click', function (e) {
      if (e.target.closest('#gym-typical')) {
        DENOM.forEach(function (d) {
          const el = host.querySelector('[data-plate="' + d + '"]');
          if (el) el.value = TYPICAL[d];
        });
        const bar = host.querySelector('#gym-bar');
        if (bar && !bar.value) bar.value = '20';
        syncPreview(host);
        return;
      }
      if (e.target.closest('#gym-save')) { save(host); return; }
      if (e.target.closest('#gym-clear')) {
        host.querySelectorAll('input').forEach(function (el) { el.value = ''; });
        syncPreview(host);
        save(host);
      }
    });
  }

  async function init() {
    if (!$('#gym-profile') || !G || !window.Store) return;
    const pr = await window.Store.getProfile();
    const raw = pr && pr.gym;
    state.gym = raw ? G.normGym(raw) : null;
    render();
    wire();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
