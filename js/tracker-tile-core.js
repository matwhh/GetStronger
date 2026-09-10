/**
 * КУБИК ТРЕКЕРА НА ЕКРАНІ «СЬОГОДНІ».
 *
 * ЩО ЦЕ Й НАВІЩО ОКРЕМИЙ ФАЙЛ. Тут — тільки геометрія й текст: модуль
 * будує рядок HTML і не знає ні про DOM, ні про події, ні про сховище.
 * Так само влаштовані DayCal, Donut і Award. Події й запис вішає той,
 * хто вставив кубик у сторінку (js/today.js).
 *
 * ЧОМУ КОЖЕН ВИД — СВІЙ КУБИК, А НЕ ОДИН НА ВСІХ.
 *
 * Спокуса зробити «однакову плитку з полем вводу» велика, і вона
 * помилкова. Трекери відрізняються не оформленням, а ЖЕСТОМ:
 *
 *   вода       — багато дотиків за день, по одному на склянку;
 *   настрій    — рівно один дотик, і найкраще одразу в потрібне число;
 *   сон        — одне число зранку, але точне (6:47, а не «близько 7»);
 *   звичка     — так/ні, і кубик має бути суцільною кнопкою;
 *   біль/втома — дві відповіді за раз, інакше друга забувається.
 *
 * Однакова плитка обслуговує всі п'ять погано: воду перетворює на
 * набирання числа, настрій — на два дотики замість одного, звичку — на
 * пошук галочки в кутку. Тому спільна тут лише ОБГОРТКА (назва, поточне
 * значення, підпис із тижневим контекстом), а тіло в кожного своє.
 *
 * ЧОМУ ЦЕ ТІ САМІ data-атрибути, ЩО НА СТОРІНЦІ «ТРЕКЕРИ».
 * data-trk-add, data-trk-scale, data-trk-mark і решта — той самий набір,
 * що в js/trackers-day.js. Два різні набори означали б дві реалізації
 * запису, які розійдуться на першому ж виправленні; один означає, що
 * обробник, написаний для одного екрана, читається й на другому.
 *
 * ШИРИНА КУБИКА — ЦЕ ТЕЖ ПРО ЖЕСТ, А НЕ ПРО КРАСУ. Шкала 1..10, дві
 * шкали пари, чотири кнопки води й два поля сну просто не існують у
 * колонці 150 пікселів: кнопка 30×30 на телефоні — це промах через раз.
 * Такі кубики беруть дві колонки (клас .twt--wide), решта — одну.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Десяткова кома — як у решті інтерфейсу. Хвости нулів не показуємо:
     «2» замість «2.00», але «1,75» лишається «1,75». */
  function num(v) {
    if (v == null || !isFinite(v)) return '—';
    const r = Math.round(Number(v) * 100) / 100;
    return String(r).replace('.', ',');
  }

  /**
   * Скільки колонок займає кубик цього виду.
   *
   * ТРИВАЛІСТЬ ЗВІДСИ ПРИБРАНА. Спершу сон стояв на всю ширину — разом із
   * підписами «год» і «хв» біля кожного поля. Але шапка кубика вже каже
   * «7 год 20 хв» словами, тобто підписи дублювали те, що написано на
   * два рядки вище. Без них лишаються два коротких поля з двокрапкою —
   * форма, яку читають без жодного пояснення, і вона поміщається в
   * половину рядка. Звільнене місце дістається сусідньому вузькому
   * кубику (сітка з grid-auto-flow: dense підтягує його сама).
   */
  function isWide(kind) {
    return kind === 'scale' || kind === 'pair' || kind === 'cumulative';
  }

  /* ------------------------------------------------------------------ */
  /* Підпис під кубиком: тиждень одним рядком                            */
  /* ------------------------------------------------------------------ */
  /*
   * ЧОМУ ТУТ ВЗАГАЛІ Є ПІДПИС. Саме по собі сьогоднішнє число нічого не
   * означає: «6» настрою — це добре чи погано? Відповідь дає тільки
   * порівняння з собою ж, тому в кожному кубику стоїть той самий рядок
   * за сім днів. Сім, а не тридцять: кубик відповідає на питання «як я
   * зараз», а не «який я загалом» — на друге відповідає журнал.
   */
  function footFor(t, def, log, now) {
    const TC = window.TrackerCore;
    if (!TC) return '';

    if (def.kind === 'boolean' || def.kind === 'dose') {
      const s = TC.boolSummary(log, t.id, 7, t.createdAt, now);
      if (s.streak > 0) return 'серія ' + s.streak + ' ' + plural(s.streak, 'день', 'дні', 'днів');
      return s.done + ' із ' + s.total + ' за тиждень';
    }

    /* numericSummary і pairSummary повертають NULL, коли записів немає, —
       не порожнє зведення з нулями. Нуль тут був би брехнею: «сер. 0»
       читається як «спав нуль годин», а не «нічого не записано». */
    if (def.kind === 'pair') {
      const a = TC.pairSummary(log, t.id, def.fields[0], 7, now);
      const b = TC.pairSummary(log, t.id, def.fields[1], 7, now);
      if (!a && !b) return 'за тиждень записів немає';
      return 'тиждень: ' + (a ? num(a.avg) : '—') + ' / ' + (b ? num(b.avg) : '—');
    }

    const s = TC.numericSummary(log, t.id, 7, now);
    if (!s) return 'за тиждень записів немає';
    if (def.kind === 'duration') return 'тиждень: ' + TC.formatDuration(Math.round(s.avg));
    return 'тиждень: ' + num(s.avg) + (def.unit ? ' ' + def.unit : '');
  }

  /* Українська множина потрібна рівно в одному місці — серії днів. */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* ------------------------------------------------------------------ */
  /* Тіла кубиків                                                        */
  /* ------------------------------------------------------------------ */

  /*
   * ВОДА, КОФЕЇН — накопичення.
   *
   * Головне тут — кнопки, а не число: за день їх тиснуть 6–10 разів.
   * Тому вони великі й стоять у ряд, а число живе над ними.
   *
   * ОКРЕМА КНОПКА «−». Промах по «+1» замість «+0,25» коштує дня
   * записів, а виправити його інакше можна тільки на сторінці трекерів.
   * Крок відкату — найменший із пресетів: помиляються здебільшого на
   * ньому, а великий відкат зробити двома дотиками не шкода.
   */
  function cumulativeBody(t, def, today) {
    const cur = Number(today) || 0;
    const goal = Number(t.goal) || 0;
    const pct = goal > 0 ? Math.min(100, Math.round((cur / goal) * 100)) : 0;
    const step = def.presets && def.presets.length ? def.presets[0] : 1;

    return (goal > 0
      ? '<div class="twt__bar" role="img" aria-label="' + pct + ' відсотків денної цілі">' +
          '<i style="width:' + pct + '%"></i></div>'
      : '') +
      '<div class="twt__btns">' +
        '<button class="twt__btn twt__btn--minus" type="button"' +
          ' data-trk-add="' + esc(t.id) + '" data-amount="' + (-step) + '"' +
          ' aria-label="Відняти ' + num(step) + ' ' + esc(def.unit) + '">−</button>' +
        def.presets.map(function (p) {
          return '<button class="twt__btn" type="button"' +
            ' data-trk-add="' + esc(t.id) + '" data-amount="' + p + '"' +
            ' aria-label="Додати ' + num(p) + ' ' + esc(def.unit) + '">+' + num(p) + '</button>';
        }).join('') +
      '</div>';
  }

  /*
   * НАСТРІЙ, RECOVERY — шкала.
   *
   * Один дотик просто в потрібне число. Ніяких «−/+» навколо поточного
   * значення: щоб дійти від 3 до 8, довелось би тиснути п'ять разів, і
   * кожен із них — окремий запис у журнал.
   */
  function scaleBody(t, def, today, label) {
    const from = def.min, to = def.max;
    let out = '<div class="twt__scale" role="group" aria-label="' + esc(label || t.name) +
      ', від ' + from + ' до ' + to + '">';
    for (let n = from; n <= to; n++) {
      out += '<button class="twt__dot' + (today === n ? ' is-on' : '') + '" type="button"' +
        ' aria-pressed="' + (today === n) + '"' +
        ' data-trk-scale="' + esc(t.id) + '" data-val="' + n + '">' + n + '</button>';
    }
    return out + '</div>';
  }

  /* БІЛЬ / ВТОМА — дві шкали. Обидві на екрані одночасно: питання парне,
     і відповідь на половину пари — це відсутня відповідь. */
  const PAIR_LABELS = { pain: 'Біль', fatigue: 'Втома', before: 'До', after: 'Після' };

  function pairBody(t, def, today) {
    const cur = today || {};
    return def.fields.map(function (f) {
      const lbl = PAIR_LABELS[f] || f;
      let out = '<div class="twt__pair">' +
        '<span class="twt__pairname">' + esc(lbl) + '</span>' +
        '<div class="twt__scale" role="group" aria-label="' + esc(t.name) + ', ' + esc(lbl) +
        ', від ' + def.min + ' до ' + def.max + '">';
      for (let n = def.min; n <= def.max; n++) {
        out += '<button class="twt__dot' + (cur[f] === n ? ' is-on' : '') + '" type="button"' +
          ' aria-pressed="' + (cur[f] === n) + '"' +
          ' data-trk-pair="' + esc(t.id) + '" data-field="' + esc(f) + '" data-val="' + n + '">' + n + '</button>';
      }
      return out + '</div></div>';
    }).join('');
  }

  /*
   * СОН — години й хвилини.
   *
   * Два поля, а не кнопки з готовими значеннями: сон буває 6:47, і
   * округлення до найближчої кнопки псує саме те число, заради якого
   * трекер вмикають. Порожні поля стирають запис — це єдиний спосіб
   * прибрати помилково введену ніч, не йдучи в налаштування.
   */
  function durationBody(t, def, today) {
    const TC = window.TrackerCore;
    const sp = TC ? TC.splitDuration(today) : { h: null, m: null };
    /*
     * Двокрапка замість слів «год» і «хв».
     *
     * Слова тут нічого не додавали: те саме значення стоїть у шапці
     * кубика повним текстом («7 год 20 хв»), а форма «7 : 20» читається
     * як час без жодного підпису. Для читалки підписи лишились там, де
     * вони й потрібні, — в aria-label кожного поля.
     */
    return '<div class="twt__dur">' +
      '<input class="twt__num" type="text" inputmode="numeric" placeholder="—"' +
        ' data-trk-durh="' + esc(t.id) + '" value="' + (sp.h == null ? '' : sp.h) + '"' +
        ' aria-label="' + esc(t.name) + ', годин">' +
      '<span class="twt__sep" aria-hidden="true">:</span>' +
      '<input class="twt__num" type="text" inputmode="numeric" placeholder="—"' +
        ' data-trk-durm="' + esc(t.id) + '" value="' + (sp.m == null ? '' : sp.m) + '"' +
        ' aria-label="' + esc(t.name) + ', хвилин">' +
    '</div>';
  }

  /* КРОКИ — одне число. Пресетів немає навмисно: «value» замінює
     значення, а не додає, і кнопка «+1000» тут означала б інше, ніж на
     воді. Однакова кнопка з різним змістом — найдорожча дрібниця. */
  function valueBody(t, def, today) {
    return '<input class="twt__field" type="text" inputmode="decimal" placeholder="0"' +
      ' data-trk-value="' + esc(t.id) + '" value="' + (today != null ? esc(today) : '') + '"' +
      ' aria-label="' + esc(t.name) + (def.unit ? ', ' + esc(def.unit) : '') + '">';
  }

  /*
   * ЗВИЧКА, ДОБАВКА — кубик і є кнопка.
   *
   * Мішень — уся площа, а не галочка 20×20 у кутку: це найчастіший дотик
   * на екрані й найлегший для промаху. У добавки з дозою поруч поле
   * грамів, але воно НЕ обов'язкове: галочка сама пише типову дозу.
   */
  function checkBody(t, def, raw) {
    const TC = window.TrackerCore;
    const done = TC ? TC.taken(raw) : raw === true;
    const dosed = def.kind === 'dose';
    const grams = dosed && TC ? TC.gramsOf(raw) : null;
    return '<label class="twt__check">' +
        '<input type="checkbox" data-trk-mark="' + esc(t.id) + '"' + (done ? ' checked' : '') + '>' +
        '<span class="twt__box" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"' +
          ' stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
        '</span>' +
      '</label>' +
      (dosed
        ? '<span class="twt__dose">' +
            '<input class="twt__num" type="text" inputmode="decimal"' +
              ' data-trk-dose="' + esc(t.id) + '"' +
              ' placeholder="' + esc(String(TC ? TC.doseOf(t) : '')) + '"' +
              ' value="' + esc(grams == null ? '' : String(grams)) + '"' +
              ' aria-label="' + esc(t.name) + ', грамів">' +
            '<span class="twt__u">г</span>' +
          '</span>'
        : '');
  }

  /* ------------------------------------------------------------------ */
  /* Складання кубика                                                    */
  /* ------------------------------------------------------------------ */

  /** Поточне значення великими цифрами в шапці кубика. */
  function nowText(def, today, t) {
    const TC = window.TrackerCore;
    if (def.kind === 'boolean' || def.kind === 'dose') return '';
    if (def.kind === 'duration') {
      /*
       * «7:20», а не «7 год 20 хв».
       *
       * Кубик тепер стоїть у половину рядка, і повний запис забирав усю
       * шапку — назву «Сон» обрізало до «С…». Двокрапкова форма коротша
       * втричі й читається так само однозначно, бо це загальноприйняте
       * позначення часу; та сама форма стоїть і в полях під нею.
       *
       * Хвилини з провідним нулем: «7:5» читається як помилка, «7:05» —
       * як пʼять хвилин.
       */
      if (today == null || !TC) return '—';
      var sp = TC.splitDuration(today);
      if (sp.h == null && sp.m == null) return '—';
      return (sp.h || 0) + ':' + String(sp.m || 0).padStart(2, '0');
    }
    if (def.kind === 'pair') {
      const cur = today || {};
      return def.fields.map(function (f) { return cur[f] != null ? cur[f] : '—'; }).join(' / ');
    }
    if (def.kind === 'cumulative') {
      const goal = Number(t.goal) || 0;
      return num(Number(today) || 0) + (goal > 0 ? ' / ' + num(goal) : '') +
        (def.unit ? ' ' + def.unit : '');
    }
    if (def.kind === 'scale') return today != null ? today + ' / ' + def.max : '—';
    /* Одиниця тут навмисно не дублюється. У «кроків» вона довша за саме
       число, і разом із назвою в шапку не влазить — назва обрізається на
       «КР…». А відповідь на питання «кроків чого» вже стоїть у назві
       кубика; в накопичувальних (л, мг) одиниця коротка й лишається. */
    return today != null ? num(today) : '—';
  }

  /**
   * Один кубик.
   *
   * @param {object} t   трекер із profile.trackers
   * @param {object} o   { log, todayKey, now }
   * @returns {string} HTML або '' для трекера без відомого виду
   */
  function html(t, o) {
    const TC = window.TrackerCore;
    if (!t || !TC) return '';
    const def = TC.defFor(t);
    if (!def) return '';

    o = o || {};
    const log = o.log || {};
    const key = o.todayKey || TC.todayKey();
    const now = o.now || new Date();
    const raw = (log[t.id] || {})[key];

    /* duration і value можуть прийти як {value, source, date} — це форма
       для даних із зовнішнього джерела. entryValue розпаковує обидві. */
    const today = (def.kind === 'duration' || def.kind === 'value')
      ? TC.entryValue(raw)
      : raw;

    let body;
    if (def.kind === 'cumulative') body = cumulativeBody(t, def, today);
    else if (def.kind === 'scale') body = scaleBody(t, def, today);
    else if (def.kind === 'pair') body = pairBody(t, def, today);
    else if (def.kind === 'duration') body = durationBody(t, def, today);
    else if (def.kind === 'value') body = valueBody(t, def, today);
    else body = checkBody(t, def, raw);

    const check = def.kind === 'boolean' || def.kind === 'dose';
    const on = check && TC.taken(raw);
    const nowTxt = nowText(def, today, t);

    return '<article class="twt twt--' + esc(def.kind) +
        (isWide(def.kind) ? ' twt--wide' : '') + (on ? ' is-on' : '') + '"' +
        ' data-trk-tile="' + esc(t.id) + '">' +
        '<div class="twt__head">' +
          '<span class="twt__name">' + esc(t.name) + '</span>' +
          (nowTxt ? '<span class="twt__now">' + esc(nowTxt) + '</span>' : '') +
        '</div>' +
        '<div class="twt__body">' + body + '</div>' +
        '<p class="twt__foot">' + esc(footFor(t, def, log, now)) + '</p>' +
      '</article>';
  }

  /**
   * Сітка кубиків для всіх закріплених трекерів.
   *
   * Порожній список дає порожній рядок, а не порожню сітку: «Сьогодні»
   * без закріплених трекерів мусить виглядати рівно так, як виглядав до
   * появи цієї можливості.
   */
  function grid(trackers, o) {
    const TC = window.TrackerCore;
    if (!TC) return '';
    const items = TC.pinnedList(trackers);
    if (!items.length) return '';
    return '<div class="twt-grid">' +
      items.map(function (t) { return html(t, o); }).join('') +
    '</div>';
  }

  window.TrackerTile = { html: html, grid: grid, isWide: isWide };
})();
