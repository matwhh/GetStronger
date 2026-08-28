/**
 * Бокс — рендер суботньої сесії й кнопка копіювання.
 *
 * Сторінка нічого не рахує й нічого не зберігає: усе, що вона робить —
 * показує дані з js/boxing-data.js у компонентах, які вже є в системі
 * (.card, .chip, .kpis, .ritual, .acc), і віддає ту саму сесію текстом
 * у буфер. Ні профілю, ні localStorage, ні таймера тут немає навмисно:
 * готового таймера в проєкті не існує, а робити ще один заради однієї
 * сторінки — це нова підсистема на порожньому місці.
 *
 * Мішок — головний блок і візуально: його раунди йдуть окремими
 * картками в сітці, решта секцій — компактними списками.
 */
(function () {
  'use strict';

  const { $, esc, toast } = window.App;
  const BOXING = window.BOXING;

  /* ------------------------------------------------------------------ */
  /* Дрібні шматки розмітки                                              */
  /* ------------------------------------------------------------------ */

  /** Список без нумерації — той самий, що в розминці силових програм */
  function list(items) {
    return '<ul class="ritual ritual--plain">' +
      (items || []).map(function (i) {
        return '<li><span class="ritual__name">' + esc(i) + '</span></li>';
      }).join('') +
    '</ul>';
  }

  /**
   * Підзаголовок + список; так показані розминка й техніка.
   *
   * Власні колонки замість .grid-2 з тієї ж причини, що й у раундів:
   * жорсткий мінімум 280px не влазить у картку з полями 32px на екрані
   * 320px, і сторінка їде вбік. Глобальний .grid-2 не чіпаю — на інших
   * сторінках він лежить прямо у .wrap, де полів менше, і там вистачає.
   */
  function groups(gs) {
    return '<div class="grid mt-2" style="gap:20px;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))">' +
      (gs || []).map(function (g) {
        return '<div>' +
          '<h4 style="margin:0 0 4px">' + esc(g.title) + '</h4>' +
          list(g.items) +
        '</div>';
      }).join('') +
    '</div>';
  }

  /** Шапка секції: номер, назва, час */
  function sectionHead(s) {
    return '<div class="row" style="justify-content:space-between;align-items:baseline;gap:12px">' +
      '<h2 style="margin:0">' + s.n + '. ' + esc(s.title) + '</h2>' +
      '<span class="chip">' + esc(s.time) + '</span>' +
    '</div>';
  }

  /**
   * Картка раунду.
   *
   * Один вигляд і для тіньового бою, і для мішка: раунд є раунд, і різні
   * картки для однакової сутності читались би як різні речі. Відрізняє їх
   * лише те, у якій сітці вони стоять.
   */
  function roundCard(r) {
    return '' +
      '<article class="card' + (r.optional ? ' card--optional' : '') + '">' +
        // flex-wrap:nowrap — інакше у вузькій картці чип «3:00» зривався
        // під заголовок, і в сусідніх раундах він стояв на різній висоті.
        // Час має бути там само в кожній картці: по ньому ведуть раунд.
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:nowrap">' +
          '<div>' +
            '<p class="card__meta" style="margin:0">Раунд ' + r.n +
              (r.optional ? ' · опціональний' : '') + '</p>' +
            '<h3 class="card__title" style="margin:2px 0 0">' + esc(r.name) + '</h3>' +
          '</div>' +
          '<span class="chip chip--acc mono" style="flex:0 0 auto">' + esc(r.time) + '</span>' +
        '</div>' +

        '<p class="small muted" style="margin:10px 0 0">Інтенсивність ' + esc(r.intensity) + '</p>' +
        (r.after ? '<p class="small" style="margin:6px 0 0">' + esc(r.after) + '</p>' : '') +

        list(r.items) +

        (r.example
          ? '<p class="small mono" style="margin:0 0 10px;color:var(--acc-ink)">' + esc(r.example) + '</p>'
          : '') +
        (r.goal ? '<p class="small muted mb-0"><b>Мета.</b> ' + esc(r.goal) + '</p>' : '') +
      '</article>';
  }

  /* ------------------------------------------------------------------ */
  /* Секції                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * Сітка раундів.
   *
   * Не .grid-2 (minmax 280px): на 1240px він давав ЧОТИРИ колонки, і
   * комбінації в картці ламались по два-три слова в рядок. 320px дає три
   * колонки на десктопі й одну на телефоні — а читати список ударів
   * посеред раунду важливіше, ніж умістити всі вісім карток в один екран.
   */
  /* min(320px, 100%), а не просто 320px: на екрані 320px колонка з жорстким
     мінімумом ширша за сам контейнер (у нього ще й поля по 22px), і сторінка
     їхала вбік на 45px. Решта сторінок сайту на такій ширині не скролиться
     горизонтально — ця теж не має. */
  const ROUNDS_GRID = 'grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))';

  function sectionBlock(s) {
    /* Мішок малюється окремо: він основна частина, і в загальний ряд
       компактних карток його класти не можна — саме тому й окрема гілка. */
    if (s.id === 'bag') return bagBlock(s);

    return '' +
      '<div class="card mt-3">' +
        sectionHead(s) +
        (s.intensity ? '<p class="small muted" style="margin:8px 0 0">Інтенсивність ' + esc(s.intensity) + '</p>' : '') +
        (s.note ? '<p class="small" style="margin:8px 0 0">' + esc(s.note) + '</p>' : '') +
        (s.groups ? groups(s.groups) : '') +
        (s.rounds
          ? '<div class="grid mt-2" style="' + ROUNDS_GRID + '">' + s.rounds.map(roundCard).join('') + '</div>'
          : '') +
        (s.items ? list(s.items) : '') +
      '</div>';
  }

  function bagBlock(s) {
    return '' +
      '<div class="mt-3" id="bag">' +
        '<div class="card">' +
          sectionHead(s) +
          '<p class="lead" style="margin:10px 0 0">' + esc(s.lead) + '</p>' +
          '<p class="small muted" style="margin:8px 0 0">' + esc(s.note) + '</p>' +
        '</div>' +
        '<div class="grid mt-2" style="' + ROUNDS_GRID + '">' + s.rounds.map(roundCard).join('') + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */

  function render() {
    const host = $('#session');
    if (!host || !BOXING) return;

    const s = BOXING.session;

    host.innerHTML =
      '<div class="card">' +
        '<div class="kpis">' +
          '<div class="kpi"><div class="kpi__val mono">' + esc(s.duration) + '</div><p class="kpi__lbl">тривалість</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">3 / 1</div><p class="kpi__lbl">хв робота / відпочинок</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">6–8</div><p class="kpi__lbl">раундів на мішку</p></div>' +
          '<div class="kpi"><div class="kpi__val mono">5</div><p class="kpi__lbl">частин сесії</p></div>' +
        '</div>' +
        '<div class="row mt-2" style="gap:10px">' +
          // Копіювання — допоміжна дія, тому кнопка другорядна.
          '<button class="btn btn--ghost btn--sm" type="button" id="copy-session">Скопіювати тренування</button>' +
        '</div>' +
      '</div>' +
      s.sections.map(sectionBlock).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Копіювання                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Копіюємо ЧИСТИЙ ТЕКСТ, а не розмітку.
   *
   * У плані тренувань копіюється таблиця, і там html доречний. Тут
   * структура лінійна, а Notes при вставці html тягне чужі кеглі й
   * кольори. Тому в обидва формати кладеться один і той самий текст:
   * App.copyRich уже має три рівні запасних шляхів (ClipboardItem →
   * виділення → textarea + execCommand), і дублювати їх тут немає сенсу.
   */
  function copy() {
    const text = BOXING.sessionText();
    const btn = $('#copy-session');

    window.App.copyRich('<pre>' + esc(text) + '</pre>', text).then(function (ok) {
      if (ok) { window.App.flashDone(btn, 'Скопійовано'); toast('Скопійовано', 'ok'); return; }

      // Буфер недоступний зовсім — показуємо текст, щоб виділити руками.
      const box = $('#copy-fallback');
      if (box) {
        box.hidden = false;
        const ta = box.querySelector('textarea');
        ta.value = text;
        ta.focus();
        ta.select();
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      toast('Буфер недоступний — текст нижче, скопіюй вручну', 'err');
    });
  }

  function init() {
    if (!$('#session')) return;

    render();
    // Картки малюються після старту app.js, тому спостерігач появи
    // треба навести на них окремо — інакше ті, що мають .reveal, лишились
    // би прихованими назавжди.
    window.App.initReveal(document);

    document.addEventListener('click', function (e) {
      if (e.target.closest('#copy-session')) copy();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
