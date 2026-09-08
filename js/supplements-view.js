/**
 * Рендер сторінки добавок. Дані — у js/supplements.js.
 *
 * Поділ той самий, що й у харчуванні: цифри й факти окремо, показ окремо.
 */
(function () {
  'use strict';

  const { $, $$, esc, round } = window.App;
  const EVIDENCE = window.EVIDENCE || {};
  const SUPPLEMENTS = window.SUPPLEMENTS || [];
  const CLAIMS = window.SUPP_CLAIMS || [];

  const state = { filter: 'all' };

  /* ------------------------------------------------------------------ */

  /**
   * Тексти висновків пишу я, а не користувач, але екранувати їх усе одно
   * правильніше: інакше одна вставлена цитата з «<» зламає розмітку.
   * Тому екрануємо все, а потім повертаємо рівно <b> — єдиний тег,
   * яким виділені ключові цифри.
   */
  function richText(str) {
    return esc(str)
      .replace(/&lt;b&gt;/g, '<b>')
      .replace(/&lt;\/b&gt;/g, '</b>');
  }

  function costPerDay(p) {
    if (!p || !p.usd || !p.servings) return null;
    return p.usd / p.servings;
  }

  function evidenceChip(level) {
    const e = EVIDENCE[level];
    if (!e) return '';
    // Рівень позначається яскравістю, не кольором: правило палітри діє й тут
    return '<span class="ev ev--' + level + '" title="' + esc(e.note) + '">' +
             '<i></i><i></i><i></i>' +
             '<span>' + esc(e.label) + '</span>' +
           '</span>';
  }

  function sourceList(sources) {
    return (sources || []).map(function (s) {
      return '' +
        '<div class="src">' +
          '<a class="src__id mono" href="https://pubmed.ncbi.nlm.nih.gov/' + esc(s.pmid) + '/" ' +
             'target="_blank" rel="noopener">PMID ' + esc(s.pmid) + ' ↗</a>' +
          '<div>' +
            '<p class="small muted mb-0"><i>' + esc(s.title) + '</i></p>' +
            '<p class="small mb-0">' + richText(s.finding) + '</p>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function card(s) {
    const cpd = costPerDay(s.price);

    return '' +
      '<article class="card mt-2" data-ev="' + esc(s.evidence) + '">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:14px">' +
          '<div>' +
            '<h3 class="card__title" style="margin:0">' + esc(s.name) + '</h3>' +
            '<p class="card__meta">' + esc(s.brand) + '</p>' +
          '</div>' +
          evidenceChip(s.evidence) +
        '</div>' +

        '<p class="small mt-1">' + esc(s.what) + '</p>' +

        '<div class="table-wrap mt-2">' +
          '<table class="tbl">' +
            '<tbody>' +
              '<tr><td class="muted small" style="width:150px">Скільки</td><td class="small">' + esc(s.dose) + '</td></tr>' +
              '<tr><td class="muted small">Коли</td><td class="small">' + esc(s.timing) + '</td></tr>' +
              '<tr><td class="muted small">Курс</td><td class="small">' + esc(s.cycling) + '</td></tr>' +
              (cpd
                ? '<tr><td class="muted small">Вартість дози</td><td class="small mono">' +
                    '$' + round(cpd, 2) + ' / добу' +
                    '<span class="muted"> — ' + esc(s.price.amount) + ' за $' + s.price.usd +
                    ', вистачає на ' + s.price.servings + ' днів</span>' +
                  '</td></tr>'
                : '') +
              (s.priceAlt
                ? '<tr><td class="muted small">Альтернатива</td><td class="small mono">' +
                    '$' + round(s.priceAlt.usd / s.priceAlt.servings, 2) + ' / добу' +
                    '<span class="muted"> — ' + esc(s.priceAlt.amount) + ' за $' + s.priceAlt.usd + '</span>' +
                  '</td></tr>'
                : '') +
            '</tbody>' +
          '</table>' +
        '</div>' +

        '<div class="notice mt-2">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
          '<div class="small">' + esc(s.safety) + '</div>' +
        '</div>' +

        (s.howMade && s.howMade.length
          ? '<div class="acc mt-2">' +
              '<button class="acc__head" type="button" aria-expanded="false">' +
                '<span class="chip chip--acc">Виробництво</span>' +
                '<span><h3>Як це роблять</h3></span>' +
                '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
              '</button>' +
              '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
                s.howMade.map(function (h) {
                  return '<div class="src">' +
                           '<b class="small">' + esc(h.step) + '</b>' +
                           '<p class="small mb-0">' + richText(h.text) + '</p>' +
                         '</div>';
                }).join('') +
              '</div></div></div>' +
            '</div>'
          : '') +

        '<div class="acc mt-2">' +
          '<button class="acc__head" type="button" aria-expanded="false">' +
            '<span class="chip chip--acc">Джерела</span>' +
            '<span><h3>Що саме показали дослідження</h3></span>' +
            '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
            sourceList(s.sources) +
          '</div></div></div>' +
        '</div>' +
      '</article>';
  }

  const VERDICT = {
    no:     { chip: 'chip--warn', label: 'Не підтверджено' },
    partly: { chip: 'chip--warn', label: 'Частково' },
    ok:     { chip: 'chip--acc',  label: 'Підтверджено' }
  };

  function claimCard(c) {
    const v = VERDICT[c.verdict] || VERDICT.partly;
    return '' +
      '<div class="acc">' +
        '<button class="acc__head" type="button" aria-expanded="false">' +
          '<span class="chip ' + v.chip + '">' + esc(v.label) + '</span>' +
          '<span><h3>«' + esc(c.claim) + '»</h3></span>' +
          '<svg class="acc__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="acc__body"><div class="acc__inner"><div class="acc__pad">' +
          '<p class="small">' + esc(c.text) + '</p>' +
          '<p class="small muted mb-0">' +
            (c.pmids || []).map(function (p) {
              return '<a href="https://pubmed.ncbi.nlm.nih.gov/' + esc(p) + '/" target="_blank" rel="noopener">PMID ' + esc(p) + '</a>';
            }).join(' &nbsp;·&nbsp; ') +
          '</p>' +
        '</div></div></div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */

  function render() {
    const host = $('#supps');
    if (!host) return;

    const list = state.filter === 'all'
      ? SUPPLEMENTS
      : SUPPLEMENTS.filter(function (s) { return s.evidence === state.filter; });

    const totalPerDay = SUPPLEMENTS.reduce(function (sum, s) {
      return sum + (costPerDay(s.price) || 0);
    }, 0);

    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">Що з цього працює</h2>' +
          /* TXT-004: тут було зашите «позицій», і на двох добавках чип казав
             «2 позицій». Число і слово беруться з одного джерела. */
          '<span class="chip chip--acc">' + SUPPLEMENTS.length + ' ' +
            window.App.plural(SUPPLEMENTS.length, 'позиція', 'позиції', 'позицій') + '</span>' +
        '</div>' +
        '<p class="small muted mt-1">' +
          'Рівень доказовості — це не оцінка «добре / погано», а відповідь на питання, ' +
          'наскільки надійно ефект відтворюється в дослідженнях. У списку лишились ' +
          'тільки позиції, де він відтворюється: те, про що можна сказати хіба ' +
          '«не показано, що працює саме для цього», зі сторінки прибрано.' +
        '</p>' +

        '<div class="field mt-2">' +
          '<label class="field__label">Показати</label>' +
          '<div class="seg">' +
            '<label class="seg__item"><input type="radio" name="ev" value="all"' +
              (state.filter === 'all' ? ' checked' : '') + '><span>Усі</span></label>' +
            Object.keys(EVIDENCE).map(function (k) {
              return '<label class="seg__item"><input type="radio" name="ev" value="' + k + '"' +
                (state.filter === k ? ' checked' : '') + '><span>' + esc(EVIDENCE[k].label) + '</span></label>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="kpis mt-3">' +
          Object.keys(EVIDENCE).map(function (k) {
            const n = SUPPLEMENTS.filter(function (s) { return s.evidence === k; }).length;
            return '<div class="kpi"><div class="kpi__val mono">' + n + '</div>' +
                   '<p class="kpi__lbl">' + esc(EVIDENCE[k].label.toLowerCase()) + '</p></div>';
          }).join('') +
          '<div class="kpi"><div class="kpi__val mono">$' + round(totalPerDay, 2) + '</div>' +
          '<p class="kpi__lbl">усе разом, на добу</p></div>' +
        '</div>' +
      '</div>' +

      list.map(card).join('');

    window.App.initAccordions(host);
  }

  function renderClaims() {
    const host = $('#claims');
    if (!host) return;
    host.innerHTML =
      '<h2 class="mt-3">Поширені твердження</h2>' +
      '<p class="lead">Те, що найчастіше кажуть про ці добавки — і що з цього витримує перевірку.</p>' +
      CLAIMS.map(claimCard).join('');
    window.App.initAccordions(host);
  }

  function init() {
    if (!$('#supps')) return;
    render();
    renderClaims();

    $('#supps').addEventListener('change', function (e) {
      if (e.target.name !== 'ev') return;
      state.filter = e.target.value;
      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
