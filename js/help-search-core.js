/**
 * Пошук по довідці — чисті функції, без DOM.
 *
 * ЧОМУ ВІН ЗНАДОБИВСЯ. Довідка контекстна: вікно показує розділ саме тієї
 * сторінки, на якій стоїш. Це добре рівно доти, доки питання стосується
 * цієї сторінки. Але питання людини звучить «де мені ввести сон?» або «що
 * таке RIR» — і воно не знає, на якій сторінці лежить відповідь. Досі
 * єдиним способом було відкрити довідку на кожній з двадцяти сторінок
 * підряд.
 *
 * ЩО ТУТ Є. Покажчик будується з того самого HELP_CONTENT
 * (js/help-content.js) — другого джерела тексту не заводиться. Пошук
 * повертає не «сторінки», а КУСНІ: розділ плюс підзаголовок, під яким
 * лежить відповідь, плюс сам рядок. Людині потрібне речення, а не
 * посилання на двадцять екранів тексту.
 *
 * ПРО ЛІТЕРИ. Апостроф в українській набирають чотирма різними знаками
 * ('ʼ', 'ʼ', '’', "'"), і «зʼїсти» з одним із них не знаходило «зʼїсти» з
 * іншим. Тому перед порівнянням усі вони зводяться до одного, разом із
 * тире, ё→е і подвійними пробілами. Регістр не має значення.
 */
(function () {
  'use strict';

  /** Звести рядок до вигляду, у якому його можна чесно порівнювати. */
  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[ʼ’‘'`´]/g, "'")   // усі апострофи — в один
      .replace(/[‐-―−]/g, '-')      // усі тире — в дефіс
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Текст одного блоку довідки одним рядком. */
  function blockText(b) {
    if (!b || typeof b !== 'object') return '';
    if (b.t === 'p' || b.t === 'note' || b.t === 'warn' || b.t === 'h') return String(b.text || '');
    if (b.t === 'list') return (b.items || []).join(' · ');
    if (b.t === 'dl') {
      return (b.items || []).map(function (pair) {
        return Array.isArray(pair) ? pair.join(' — ') : String(pair);
      }).join(' · ');
    }
    if (b.t === 'table') {
      const head = (b.head || []).join(' · ');
      const rows = (b.rows || []).map(function (r) { return (r || []).join(' · '); }).join(' · ');
      return head + (head && rows ? ' · ' : '') + rows;
    }
    /* t: 'dyn' — вміст рахує js/help.js із конфігу сервера. Тексту, який
       можна покласти в покажчик, у ньому немає, і вигадувати його тут
       означало б завести другу правду про числа. Лишається сама назва. */
    if (b.t === 'dyn') return String(b.build || '');
    return '';
  }

  /**
   * Покажчик по всьому вмісту довідки.
   *
   * @param {{sections: Object, about?: Object, guide?: Object}} content
   * @returns {Array<{page:string,title:string,heading:string,text:string,
   *                  nText:string,nTitle:string,nHeading:string}>}
   */
  function buildIndex(content) {
    const out = [];
    if (!content || !content.sections) return out;

    const pages = Object.keys(content.sections).map(function (page) {
      return { page: page, sec: content.sections[page] };
    });
    /* Довідник і загальна інструкція шукаються нарівні з розділами
       сторінок: людина не мусить знати, що «як почати» лежить окремо. */
    if (content.guide) pages.push({ page: 'guide', sec: content.guide });
    if (content.about) pages.push({ page: 'about', sec: content.about });

    pages.forEach(function (item) {
      const sec = item.sec;
      if (!sec) return;
      const title = String(sec.title || '');

      const push = function (heading, text) {
        const t = String(text || '').trim();
        if (!t) return;
        out.push({
          page: item.page, title: title, heading: heading, text: t,
          nText: norm(t), nTitle: norm(title), nHeading: norm(heading)
        });
      };

      push('', sec.lead || '');

      let heading = '';
      (sec.blocks || []).forEach(function (b) {
        if (b && b.t === 'h') { heading = String(b.text || ''); return; }
        push(heading, blockText(b));
      });
    });

    return out;
  }

  /**
   * Кусень тексту навколо першого збігу.
   *
   * Показувати рядок цілком не можна: у довідці є абзаци на чотири
   * речення, і десять таких результатів — це екран суцільного тексту, у
   * якому знову треба шукати очима.
   */
  function snippet(text, nText, token, width) {
    const w = width || 150;
    if (text.length <= w) return text;
    const at = token ? nText.indexOf(token) : -1;
    if (at < 0) return text.slice(0, w).trim() + '…';
    let from = Math.max(0, at - Math.floor(w / 3));
    /* Не рвемо слово навпіл: відступаємо до найближчого пробілу. */
    if (from > 0) {
      const sp = text.indexOf(' ', from);
      if (sp > 0 && sp - from < 20) from = sp + 1;
    }
    const cut = text.slice(from, from + w).trim();
    return (from > 0 ? '…' : '') + cut + (from + w < text.length ? '…' : '');
  }

  /**
   * Знайти.
   *
   * Усі слова запиту мають зустрітись у ОДНОМУ куснi — інакше «сон
   * трекер» знаходило б і абзац про сон, і абзац про трекери, жоден із
   * яких не відповідає на питання.
   *
   * @param {Array} index покажчик із buildIndex
   * @param {string} query
   * @param {{limit?: number}} [opts]
   * @returns {Array<{page,title,heading,text,score}>}
   */
  function search(index, query, opts) {
    const limit = (opts && opts.limit) || 24;
    const q = norm(query);
    if (q.length < 2) return [];
    const words = q.split(' ').filter(function (w) { return w.length >= 2; });
    if (!words.length) return [];

    const hits = [];
    (index || []).forEach(function (row) {
      const hay = row.nTitle + ' ~ ' + row.nHeading + ' ~ ' + row.nText;
      for (let i = 0; i < words.length; i++) {
        if (hay.indexOf(words[i]) === -1) return;
      }

      /*
       * Вага результату. Збіг у назві розділу важить більше за збіг
       * усередині абзацу: шукаючи «періодизація», людина найімовірніше
       * хоче сам розділ, а не згадку про нього в чужому тексті.
       */
      let score = 1;
      words.forEach(function (wd) {
        if (row.nTitle.indexOf(wd) !== -1) score += 6;
        if (row.nHeading.indexOf(wd) !== -1) score += 3;
        if (row.nText.indexOf(wd) !== -1) score += 1;
      });
      /* Ціла фраза підряд — сильніший сигнал, ніж ті самі слова врозсип. */
      if (words.length > 1 && hay.indexOf(q) !== -1) score += 5;
      /* Коротший кусень точніший: у ньому збіг важить більше. */
      score += Math.max(0, 3 - Math.floor(row.text.length / 200));

      hits.push({
        page: row.page, title: row.title, heading: row.heading,
        text: snippet(row.text, row.nText, words[0]), score: score
      });
    });

    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title, 'uk');
    });
    return hits.slice(0, limit);
  }

  window.HelpSearchCore = {
    norm: norm,
    blockText: blockText,
    buildIndex: buildIndex,
    search: search
  };
}());
