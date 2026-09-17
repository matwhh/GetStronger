/**
 * Налаштування трекерів (trackers-settings.html): що ввімкнено, цілі,
 * добавки й звички, історія. Сьогоднішні значення вводять на trackers.html
 * (js/trackers-day.js) — ця сторінка про те, ЩО відстежувати, а не про день.
 *
 * Дані й правила клампу — в js/tracker-core.js (чисті функції). Цей файл
 * лише читає профіль, малює список і передає натискання назад у ядро.
 * Жодна логіка трекера тут не унікальна: новий тип у TRACKER_DEFS
 * зʼявиться в списку сам, без правок цього файлу — крім, за потреби,
 * власного вигляду швидкого вводу (trackerWidget нижче).
 */
(function () {
  'use strict';

  const { $, esc, toast, dateLabel, plural, fmtNum } = window.App;
  const Store = window.Store;
  const T = window.TrackerCore;

  const state = {
    trackers: {},
    log: {},
    /* Журнал замірів лежить окремо від trackerLog (див. tracker-core.js,
       kind 'card'): тримаємо його тут лише щоб показати «востаннє
       міряли», а не щоб редагувати. */
    measureLog: {},
    openId: null,
    wired: false
  };

  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 11 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function todayKey(d) { return window.DateCore.todayKey(d); }
  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 2 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function dateOf(k) { return window.DateCore.dateOf(k); }

  /* ------------------------------------------------------------------ */
  /* Формат значень                                                       */
  /* ------------------------------------------------------------------ */

  /* Власного форматера тут більше немає: числа Get Stronger показує однаково
     скрізь, і правило живе в App.fmtNum (js/app.js). Локальна копія
     давала «7.5 год» там, де сусідня картка показувала «7,5». */
  function fmtValue(def, v) {
    if (v === true) return '✓';
    if (def.kind === 'duration') return T.formatDuration(v);
    if (def.kind === 'dose') return fmtNum.n(v, 1) + ' г';
    if (def.kind === 'cumulative' || def.kind === 'value' || def.kind === 'scale') {
      return fmtNum.n(v, 1) + (def.unit ? ' ' + def.unit : '');
    }
    return String(v);
  }

  function fmtPair(def, v) {
    if (!v || typeof v !== 'object') return '—';
    return def.fields.map(function (f) {
      const label = f === 'pain' ? 'біль' : f === 'fatigue' ? 'втома'
        : f === 'before' ? 'до' : f === 'after' ? 'після' : f;
      return label + ' ' + (v[f] != null ? v[f] : '—');
    }).join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* Рядок одного трекера: заголовок + деталі за бажанням                 */
  /* ------------------------------------------------------------------ */

  function metaLine(t, def) {
    /*
     * КАРТКА-РОЗДІЛ. Її дані лежать не в trackerLog, а у власному журналі
     * (def.external), тож «сьогоднішнє значення» тут не існує в принципі.
     * Показуємо те, що людина справді хоче знати, вирішуючи, лишати її на
     * головній чи ні: коли востаннє щось записано.
     */
    if (def.kind === 'card') return cardMeta(def);

    const todayRaw = (state.log[t.id] || {})[todayKey()];
    // duration/value можуть зберігатися як {value, source, date} (джерело —
    // ручний ввід або, у майбутньому, Apple Health) — entryValue() читає
    // обидві форми прозоро; інші види kind і далі пишуться голими значеннями.
    const today = (def.kind === 'duration' || def.kind === 'value') ? T.entryValue(todayRaw) : todayRaw;

    /* Тижнева ціль (F3) заміняє денний стрік, а не додається до нього:
       два різні «поспіль» на одному екрані читаються як помилка. */
    const ws = T.weekStats(t, state.log);
    if (ws) {
      const wk = T.weekStreak(t, state.log);
      return ws.done + ' з ' + ws.goal + ' цього тижня' +
        (wk > 0 ? ' · ' + wk + ' ' + plural(wk, 'тиждень', 'тижні', 'тижнів') + ' поспіль' : '');
    }

    if (def.kind === 'boolean') {
      const st = T.boolSummary(state.log, t.id, 30, t.createdAt);
      const streakTxt = st.streak > 0 ? st.streak + ' ' + plural(st.streak, 'день', 'дні', 'днів') + ' поспіль' : 'ще без позначок';
      return today === true ? 'Сьогодні: зроблено · ' + streakTxt : streakTxt;
    }

    if (def.kind === 'pair') {
      if (today) return 'Сьогодні: ' + fmtPair(def, today);
      const s1 = T.pairSummary(state.log, t.id, def.fields[0], 30);
      return s1 ? 'Середнє за 30д: ' + fmtNum.n(s1.avg, 1) : 'ще без записів';
    }

    if (today != null) {
      const goalTxt = t.goal ? ' / ' + fmtNum.n(t.goal, 1) + (def.kind === 'duration' ? '' : ' ' + def.unit) : '';
      return def.kind === 'duration'
        ? 'Сьогодні: ' + T.formatDuration(today) + (t.goal ? ' (ціль ' + T.formatDuration(t.goal) + ')' : '')
        : 'Сьогодні: ' + fmtValue(def, today) + goalTxt;
    }
    const s = T.numericSummary(state.log, t.id, 30);
    if (!s) return 'ще без записів';
    const arrow = s.trend === 'up' ? '↑' : s.trend === 'down' ? '↓' : s.trend === 'flat' ? '→' : '';
    return 'Середнє за 30д: ' + fmtValue(def, s.avg) + (arrow ? ' ' + arrow : '');
  }

  /** Швидкий ввід усередині розгорнутого рядка — по kind трекера. */
  function widget(t, def) {
    const todayRaw = (state.log[t.id] || {})[todayKey()];
    const today = (def.kind === 'duration' || def.kind === 'value') ? T.entryValue(todayRaw) : todayRaw;

    if (def.kind === 'cumulative') {
      const pct = t.goal ? Math.min(100, Math.round((Number(today) || 0) / t.goal * 100)) : null;
      return '' +
        (t.goal
          ? '<div class="qi-bar">' +
              '<span class="qi-bar__track"><i style="width:' + pct + '%"></i></span>' +
              '<span class="qi-bar__num mono small">' + fmtNum.n(today || 0, 1) + ' / ' + fmtNum.n(t.goal, 1) + ' ' + esc(def.unit) + '</span>' +
            '</div>'
          : '') +
        '<div class="qi-row">' +
          def.presets.map(function (p) {
            return '<button class="btn btn--ghost btn--sm" type="button" data-add="' + esc(t.id) + '" data-amount="' + p + '">+' + fmtNum.n(p, 1) + ' ' + esc(def.unit) + '</button>';
          }).join('') +
          '<button class="btn btn--ghost btn--sm" type="button" data-add="' + esc(t.id) + '" data-amount="' + (-def.presets[0]) + '">−' + fmtNum.n(def.presets[0], 1) + '</button>' +
        '</div>';
    }

    if (def.kind === 'duration') {
      /* Довільний час двома полями. Готова сітка «6 год / 6 год 30 хв /…»
         прибрана свідомо: вона мовчки округляла реальні 6:47 до кнопки,
         і трекер показував не те, що було. */
      const sp = T.splitDuration(today);
      return '<div class="qi-dur">' +
        '<input class="input input--sm num mono" type="text" inputmode="numeric" ' +
          'data-durh="' + esc(t.id) + '" placeholder="—" ' +
          'value="' + (sp.h == null ? '' : sp.h) + '" ' +
          'aria-label="' + esc(def.name) + ', годин">' +
        '<span class="qi-dur__u">год</span>' +
        '<input class="input input--sm num mono" type="text" inputmode="numeric" ' +
          'data-durm="' + esc(t.id) + '" placeholder="—" ' +
          'value="' + (sp.m == null ? '' : sp.m) + '" ' +
          'aria-label="' + esc(def.name) + ', хвилин">' +
        '<span class="qi-dur__u">хв</span>' +
      '</div>';
    }

    if (def.kind === 'value') {
      return '<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">' +
        '<input class="input mono" type="text" inputmode="decimal" id="val-' + esc(t.id) + '" style="width:120px" ' +
          'value="' + (today != null ? esc(today) : '') + '" placeholder="0">' +
        '<button class="btn btn--primary btn--sm" type="button" data-save-value="' + esc(t.id) + '">Зберегти</button>' +
      '</div>';
    }

    if (def.kind === 'scale') {
      return '<div class="qi-scale" role="group" aria-label="Оцінка від 1 до 10">' +
        Array.from({ length: def.max - def.min + 1 }, function (_, i) { return def.min + i; }).map(function (n) {
          return '<button class="qi-scale__btn' + (today === n ? ' is-on' : '') + '" type="button" ' +
            'aria-pressed="' + (today === n) + '" ' +
            'data-scale="' + esc(t.id) + '" data-val="' + n + '">' + n + '</button>';
        }).join('') +
      '</div>';
    }

    if (def.kind === 'pair') {
      return def.fields.map(function (f) {
        const label = f === 'pain' ? 'Біль' : f === 'fatigue' ? 'Втома' : f === 'before' ? 'Перед тренуванням' : 'Після тренування';
        const v = today && today[f];
        return '<p class="small mt-1" style="margin-bottom:4px">' + esc(label) + '</p>' +
          '<div class="qi-scale" role="group" aria-label="' + esc(label) + ', від 1 до 10">' +
            Array.from({ length: def.max - def.min + 1 }, function (_, i) { return def.min + i; }).map(function (n) {
              return '<button class="qi-scale__btn' + (v === n ? ' is-on' : '') + '" type="button" ' +
                'aria-pressed="' + (v === n) + '" ' +
                'data-pair="' + esc(t.id) + '" data-field="' + f + '" data-val="' + n + '">' + n + '</button>';
            }).join('') +
          '</div>';
      }).join('');
    }

    return '';
  }

  function historyBlock(t, def) {
    const entries = T.lastEntries(state.log, t.id, 7);
    if (!entries.length) return '<p class="small muted mt-2 mb-0">Історія почнеться з першого запису.</p>';
    return '<div class="mt-2">' +
      entries.map(function (e) {
        // duration/value з hasSource можуть прийти як {value, source, date} —
        // entryValue()/entrySource() розпаковують обидві форми (стару й нову).
        const v = (def.kind === 'duration' || def.kind === 'value') ? T.entryValue(e.v) : e.v;
        const txt = def.kind === 'pair' ? fmtPair(def, v)
          : def.kind === 'boolean' ? '✓'
          : def.kind === 'duration' ? T.formatDuration(v)
          : fmtValue(def, v);
        // Позначку джерела показуємо лише тут, в історії — щоб не перевантажувати
        // компактний рядок на today.html — і лише коли запис прийшов не вручну.
        const src = def.hasSource ? T.entrySource(e.v) : 'manual';
        const srcTag = src && src !== 'manual' ? ' <span class="muted small">· ' + esc(srcLabel(src)) + '</span>' : '';
        return '<div class="wlog-row">' +
          '<span class="muted small">' + esc(dateLabel(dateOf(e.d))) + '</span>' +
          '<span class="mono">' + esc(txt) + srcTag + '</span>' +
          '<button class="icon-btn icon-btn--danger" type="button" data-entry-del="' + esc(t.id) + ':' + e.d + '" ' +
                  'aria-label="Видалити запис за ' + esc(dateLabel(dateOf(e.d))) + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function srcLabel(src) {
    if (src === 'apple_health') return 'Apple Health';
    return src;
  }

  function sourceRow(t, def) {
    if (!def.hasSource) return '';
    return '<div class="row mt-2" style="gap:8px;align-items:center;flex-wrap:wrap">' +
      '<span class="small muted">Джерело:</span>' +
      '<span class="seg">' +
        '<label class="seg__item"><input type="radio" name="src-' + esc(t.id) + '" checked><span>Вручну</span></label>' +
        '<label class="seg__item" title="Зʼявиться в мобільному застосунку — веб не має доступу до Apple Health">' +
          '<input type="radio" name="src-' + esc(t.id) + '" disabled><span>Apple Health</span></label>' +
      '</span>' +
    '</div>';
  }

  function goalRow(t, def) {
    if (def.defaultGoal == null) return '';
    return '<div class="row mt-2" style="gap:8px;align-items:center;flex-wrap:wrap">' +
      '<label class="small muted" for="goal-' + esc(t.id) + '">Денна ціль</label>' +
      '<input class="input input--sm mono" type="text" inputmode="decimal" id="goal-' + esc(t.id) + '" style="width:100px" ' +
        'min="0" step="' + (def.kind === 'duration' ? '15' : def.unit === 'л' ? '0.1' : '1') + '" ' +
        'value="' + (t.goal != null ? esc(def.kind === 'duration' ? Math.round(t.goal / 60 * 10) / 10 : t.goal) : '') + '">' +
      (def.kind === 'duration' ? '<span class="small muted">год</span>' : '') +
      '<button class="btn btn--ghost btn--sm" type="button" data-goal-save="' + esc(t.id) + '">Зберегти</button>' +
    '</div>';
  }


  /*
   * ШПИЛЬКА «НА СЬОГОДНІ».
   *
   * ЧОМУ НЕ ДРУГИЙ ПОВЗУНОК. Повзунок у цьому рядку вже є, і він
   * відповідає на інше питання — «чи веду я цей трекер узагалі». Два
   * однакові повзунки поруч читаються як одна настройка з двома
   * станами, і людина клацає не той. Шпилька — інший жест і інший знак:
   * не «ввімкнути», а «прикріпити перед очима».
   *
   * ЧОМУ ЇЇ НЕМАЄ У ВИМКНЕНИХ. Закріпити вимкнений трекер не можна
   * (TrackerCore.setPinned це й не дозволить): кубик на головній не мав
   * би куди писати. Показувати кнопку, яка нічого не робить, гірше, ніж
   * не показувати її зовсім.
   */
  function pinBtn(t) {
    if (!t.enabled) return '';
    const on = t.pinned === true;
    return '<button class="tr-pin' + (on ? ' is-on' : '') + '" type="button"' +
      ' data-pin="' + esc(t.id) + '" aria-pressed="' + on + '"' +
      ' title="' + (on ? 'Прибрати з екрана «Сьогодні»' : 'Показувати на екрані «Сьогодні»') + '"' +
      ' aria-label="' + (on ? 'Прибрати з екрана Сьогодні: ' : 'Показувати на екрані Сьогодні: ') + esc(t.name) + '">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M9 4h6l-1 5 3.5 3.5H6.5L10 9z"/><path d="M12 12.5V20"/></svg>' +
    '</button>';
  }

  /* Підпис під назвою картки-розділу: коли там востаннє щось записали. */
  function cardMeta(def) {
    if (def.external === 'measureLog' && window.MeasureCore) {
      const sum = window.MeasureCore.homeSummary(state.measureLog, todayKey(), { limit: 1 });
      if (!sum) return 'ще без записів';
      if (!Number.isFinite(sum.daysAgo)) return sum.total + ' ' + plural(sum.total, 'запис', 'записи', 'записів');
      if (sum.daysAgo === 0) return 'востаннє: сьогодні';
      if (sum.daysAgo === 1) return 'востаннє: учора';
      return 'востаннє: ' + sum.daysAgo + ' ' + plural(sum.daysAgo, 'день', 'дні', 'днів') + ' тому';
    }
    return '';
  }

  function builtinRow(t) {
    const def = T.defFor(t);
    if (!def) return '';

    /*
     * Рядок картки-розділу НЕ розгортається: розгортати нічого — ні цілі,
     * ні джерела, ні швидкого вводу в неї немає. Замість кнопки-гармошки
     * тут посилання в сам розділ, бо саме туди людина й хоче потрапити,
     * тицьнувши в назву.
     */
    if (def.kind === 'card') {
      return '<li class="tr-row' + (t.enabled ? '' : ' tr-row--off') + '">' +
        '<div class="tr-row__top">' +
          /* aria-label СТОЇТЬ НА ПОЛІ, а не на <label>.
             Напис на обгортці читалка не переносить на input: у дерева
             доступності там лишався голий «прапорець» без назви — тобто
             незрячий чув «увімкнено», не знаючи, що саме. */
          '<label class="switch">' +
            '<input type="checkbox" data-toggle="' + esc(t.id) + '"' + (t.enabled ? ' checked' : '') +
              ' aria-label="Увімкнути: ' + esc(t.name) + '">' +
            '<span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>' +
          '</label>' +
          '<a class="tr-row__btn" href="' + esc(def.page || '#') + '">' +
            '<span class="tr-row__name">' + esc(t.name) + '</span>' +
            '<span class="tr-row__meta small muted">' + esc(metaLine(t, def)) + '</span>' +
          '</a>' +
          pinBtn(t) +
        '</div>' +
      '</li>';
    }

    const open = state.openId === t.id;

    return '<li class="tr-row' + (t.enabled ? '' : ' tr-row--off') + '">' +
      '<div class="tr-row__top">' +
        '<label class="switch">' +
          '<input type="checkbox" data-toggle="' + esc(t.id) + '"' + (t.enabled ? ' checked' : '') +
            ' aria-label="Увімкнути: ' + esc(t.name) + '">' +
          '<span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>' +
        '</label>' +
        '<button class="tr-row__btn" type="button" data-expand="' + esc(t.id) + '" aria-expanded="' + open + '">' +
          '<span class="tr-row__name">' + esc(t.name) + '</span>' +
          '<span class="tr-row__meta small muted">' + esc(metaLine(t, def)) + '</span>' +
        '</button>' +
        pinBtn(t) +
      '</div>' +
      (open && t.enabled
        ? '<div class="tr-row__detail">' +
            goalRow(t, def) +
            sourceRow(t, def) +
            '<div class="mt-2">' + widget(t, def) + '</div>' +
            historyBlock(t, def) +
          '</div>'
        : '') +
    '</li>';
  }

  function renderBuiltins() {
    const host = $('#tr-builtins');
    if (!host) return;

    const rows = T.list(state.trackers).filter(function (t) { return T.TRACKER_DEFS[t.type]; });
    host.innerHTML =
      '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:baseline;gap:10px">' +
          '<h2 style="margin:0">Мої трекери</h2>' +
          '<span class="small muted">' + rows.filter(function (t) { return t.enabled; }).length + ' із ' + rows.length + ' увімкнено</span>' +
        '</div>' +
        '<ul class="tr-list mt-2">' + rows.map(builtinRow).join('') + '</ul>' +
        '<p class="small muted mb-0" style="margin-top:12px">Шпилька виносить трекер на «Сьогодні» — заповнювати будете там. Вимкнені лишаються в цьому списку: історія нікуди не зникає.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Добавки та звички: власні позиції користувача                       */
  /* ------------------------------------------------------------------ */

  /*
   * Рядок добавки/звички в НАЛАШТУВАННЯХ: перемикач, назва, доза (для
   * добавок), підсумок за 30 днів, видалення. Щоденної галочки тут
   * НЕМАЄ навмисно — відмічають на сторінці «Трекери», а тут лише
   * редагують. Вигляд той самий, що в убудованих трекерів вище.
   */
  function customRow(t, kind) {
    const st = T.boolSummary(state.log, t.id, 30, t.createdAt);
    const ws = T.weekStats(t, state.log);
    /*
     * З тижневою ціллю (F3) денний стрік НЕ показується взагалі. Пропуск
     * одного дня у звички «тричі на тиждень» — не помилка, а один із
     * вільних днів; денний стрік казав би протилежне тому, що людина сама
     * собі призначила.
     */
    const wk = ws ? T.weekStreak(t, state.log) : 0;
    /*
     * З тижневою ціллю показник ОДИН: x із y цього тижня. «0 із 1 за 30
     * днів» поруч із «3 з 3 цього тижня» — це два різні відповіді на одне
     * питання, і перший із них ще й виглядає як провал.
     */
    const metaTxt = ws
      ? ws.done + ' з ' + ws.goal + ' цього тижня' +
        (wk > 0 ? ' · ' + wk + ' ' + plural(wk, 'тиждень', 'тижні', 'тижнів') + ' поспіль' : '')
      : st.done + ' із ' + st.total + ' за 30 днів' +
        (kind === 'habit' && st.streak > 0
          ? ' · ' + st.streak + ' ' + plural(st.streak, 'день', 'дні', 'днів') + ' поспіль'
          : '');
    /* Поле тижневої цілі — лише у звичок: саме вони бувають «тричі на
       тиждень». У добавок на цьому місці доза, і другий ввід у той самий
       рядок не вліз би; ядро тижневу ціль підтримує для будь-якого
       трекера, тож якщо вона знадобиться добавкам — це правка розмітки,
       а не логіки. */
    const weekField = kind === 'habit'
      ? '<span class="qi-dose">' +
          '<input class="input input--sm num mono" type="text" inputmode="numeric" ' +
            'data-week-set="' + esc(t.id) + '" placeholder="—" ' +
            'value="' + esc(ws ? String(ws.goal) : '') + '" ' +
            'aria-label="Скільки днів на тиждень: ' + esc(t.name) + '">' +
          '<span class="qi-dose__u">/тиж</span>' +
        '</span>'
      : '';
    const doseField = kind === 'supplement'
      ? '<span class="qi-dose">' +
          '<input class="input input--sm num mono" type="text" inputmode="decimal" ' +
            'data-dose-set="' + esc(t.id) + '" placeholder="—" ' +
            'value="' + esc(T.isDosed(t) ? String(T.doseOf(t)) : '') + '" ' +
            'aria-label="Типова доза, г: ' + esc(t.name) + '">' +
          '<span class="qi-dose__u">г</span>' +
        '</span>'
      : '';
    const del = T.isDefaultSupplement(t.id)
      ? ''
      : '<button class="icon-btn icon-btn--danger" type="button" data-custom-del="' + esc(t.id) + '" aria-label="Видалити: ' + esc(t.name) + '">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>';

    return '<li class="tr-row' + (t.enabled ? '' : ' tr-row--off') + '">' +
      '<div class="tr-row__top">' +
        '<label class="switch">' +
          '<input type="checkbox" data-toggle="' + esc(t.id) + '"' + (t.enabled ? ' checked' : '') +
            ' aria-label="Увімкнути: ' + esc(t.name) + '">' +
          '<span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>' +
        '</label>' +
        '<div class="tr-row__btn" style="cursor:default">' +
          '<span class="tr-row__name">' + esc(t.name) + '</span>' +
          '<span class="tr-row__meta small muted">' + esc(metaTxt) + '</span>' +
        '</div>' +
        doseField +
        weekField +
        pinBtn(t) +
        del +
      '</div>' +
    '</li>';
  }

  function customGroup(hostId, type, title, hint, addLabel, placeholder) {
    const host = $(hostId);
    if (!host) return;

    const items = T.byType(state.trackers, type);
    host.innerHTML =
      '<div class="card">' +
        '<h2 style="margin:0">' + esc(title) + '</h2>' +
        '<p class="small mt-1">' + esc(hint) + '</p>' +
        (items.length
          ? '<ul class="tr-list mt-2">' + items.map(function (t) { return customRow(t, type); }).join('') + '</ul>'
          : '<p class="small muted mt-2 mb-0">Список порожній. Додайте першу позицію нижче — ' +
            'вона зʼявиться на сторінці «Трекери» щоденною позначкою.</p>') +
        '<div class="row mt-2" style="gap:8px;flex-wrap:wrap">' +
          /* aria-label, а не лише placeholder: підказка зникає з першою
             літерою, і читалка називала поле безіменним. */
          '<input class="input" type="text" id="add-' + type + '" style="max-width:220px" ' +
            'aria-label="' + esc(placeholder) + '" placeholder="' + esc(placeholder) + '" maxlength="60">' +
          (type === 'supplement'
            ? '<span class="qi-dose">' +
                '<input class="input num mono" type="text" inputmode="decimal" id="add-supplement-dose" ' +
                  'style="width:80px" placeholder="г" aria-label="Типова доза, г (необовʼязково)">' +
                '<span class="qi-dose__u">г</span>' +
              '</span>'
            : '') +
          '<button class="btn btn--ghost btn--sm" type="button" data-add-custom="' + type + '">' + esc(addLabel) + '</button>' +
        '</div>' +
      '</div>';
  }

  function renderSupplements() {
    customGroup('#tr-supplements', 'supplement', 'Добавки',
      'Відмічають на сторінці «Трекери». Тут — типова доза в грамах: галочка там ' +
      'пише саме її, а поле поруч дає вписати, скільки випив насправді.',
      '+ Додати добавку', 'Наприклад, омега-3');
  }

  function renderHabits() {
    customGroup('#tr-habits', 'habit', 'Звички',
      'Своя звичка. Поле «/тиж» задає тижневу ціль: скільки днів на тиждень ' +
      'достатньо. З нею пропущений день нічого не обнуляє, а замість серії днів ' +
      'показується x із y цього тижня.',
      '+ Додати звичку', 'Наприклад, лягати до 23:00');
  }

  /* ------------------------------------------------------------------ */
  /* Збереження й обробники                                              */
  /* ------------------------------------------------------------------ */

  async function persist(patch) {
    try { await Store.saveProfile(patch); }
    catch (e) { toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err'); }
  }

  function saveTrackers(next) {
    state.trackers = next;
    persist({ trackers: next });
  }

  /**
   * Записати зміну журналу трекерів.
   *
   * Приймає ФУНКЦІЮ перетворення, а не готовий журнал (SYN-011). Патч —
   * це повне значення поля, тож `trackerLog`, зчитаний при відкритті
   * сторінки, стирав усе, що записали тим часом з телефона: вода, сон і
   * звички за день відкочувались до знімка на момент відкриття. Те саме
   * перетворення застосовується двічі — до стану екрана й до свіжого
   * профілю всередині збереження.
   */
  function saveLog(mk) {
    state.log = mk(state.log || {});
    persist(function (pr) {
      return { trackerLog: mk((pr && pr.trackerLog) || {}) };
    });
  }

  function renderAll() {
    renderBuiltins();
    renderSupplements();
    renderHabits();
  }

  function wire() {
    if (state.wired) return;
    state.wired = true;

    /* Закріплення — click, а не change: це кнопка, а не поле. */
    document.addEventListener('click', function (e) {
      const pin = e.target.closest && e.target.closest('[data-pin]');
      if (!pin) return;
      const id = pin.dataset.pin;
      const now = state.trackers[id] && state.trackers[id].pinned === true;
      saveTrackers(T.setPinned(state.trackers, id, !now));
      renderBuiltins();
      renderSupplements();
      renderHabits();
    });

    document.addEventListener('change', function (e) {
      const tog = e.target.closest('[data-toggle]');
      if (tog) {
        saveTrackers(T.setEnabled(state.trackers, tog.dataset.toggle, tog.checked));
        if (!tog.checked && state.openId === tog.dataset.toggle) state.openId = null;
        renderBuiltins();
        renderSupplements();
        renderHabits();
        return;
      }
      /* Тривалість: два поля, одна величина — читаємо обидва, щоб зміна
         годин не скидала хвилини. */
      const dh = e.target.closest('[data-durh]');
      const dm = e.target.closest('[data-durm]');
      if (dh || dm) {
        const el = dh || dm;
        const id = el.dataset.durh || el.dataset.durm;
        const box = el.closest('.qi-dur');
        const hEl = box && box.querySelector('[data-durh]');
        const mEl = box && box.querySelector('[data-durm]');
        const hv = hEl && hEl.value;
        const mv = mEl && mEl.value;
        /*
         * УСЕ — після поточної події. change у текстовому полі приходить
         * усередині зміни фокуса, а збереження тягне за собою перемальовку
         * списку: заміна innerHTML прямо тут валила DOM-помилкою «node to
         * be removed is no longer a child». Значення знімаємо синхронно,
         * діємо — наступним тактом.
         */
        setTimeout(function () {
          const trk = T.list(state.trackers).find(function (x) { return x.id === id; });
          const def = trk ? T.defFor(trk) : null;
          const mins = T.joinDuration(hv, mv, def || { min: 0, max: 1440 });
          if (mins === false) {
            window.App.toast('Не схоже на час: перевірте години й хвилини', 'err');
            renderBuiltins();
            return;
          }
          const kToday = todayKey();
          saveLog(function (log) {
            return mins === null
              ? T.removeEntry(log, id, kToday)
              : T.logValue(state.trackers, log, id, mins, kToday);
          });
          renderBuiltins();
        }, 0);
        return;
      }

      /*
       * Тижнева ціль (F3). Порожнє поле — це «немає тижневої цілі», і
       * трекер повертається до денного стріку; 0 і сміття так само
       * знімають ціль, а більше за 7 обрізається до 7, бо «10 днів на
       * тиждень» означало «щодня», а не помилку.
       */
      const wg = e.target.closest('[data-week-set]');
      if (wg) {
        const raw = String(wg.value || '').trim();
        const n = raw === '' ? null : Number(raw.replace(',', '.'));
        if (raw !== '' && (!Number.isFinite(n) || n < 1)) {
          window.App.toast('Днів на тиждень: від 1 до ' + T.WEEK_GOAL_MAX, 'err');
          setTimeout(renderHabits, 0);
          return;
        }
        saveTrackers(T.setWeekGoal(state.trackers, wg.dataset.weekSet, n));
        setTimeout(renderHabits, 0);
        return;
      }

      const ds = e.target.closest('[data-dose-set]');
      if (ds) {
        const raw = String(ds.value || '').trim();
        if (raw !== '' && T.normDose(raw) === null) {
          window.App.toast('Доза: від 0,1 до 500 г', 'err');
          setTimeout(renderSupplements, 0);
          return;
        }
        saveTrackers(T.setDose(state.trackers, ds.dataset.doseSet, raw === '' ? null : raw));
        setTimeout(renderSupplements, 0);
        return;
      }

    });

    document.addEventListener('click', function (e) {
      const exp = e.target.closest('[data-expand]');
      if (exp) {
        state.openId = state.openId === exp.dataset.expand ? null : exp.dataset.expand;
        renderBuiltins();
        return;
      }

      const add = e.target.closest('[data-add]');
      if (add) {
        const addId = add.dataset.add, addN = Number(add.dataset.amount), addK = todayKey();
        saveLog(function (log) { return T.addDelta(state.trackers, log, addId, addN, addK); });
        renderBuiltins();
        return;
      }

      const sc = e.target.closest('[data-scale]');
      if (sc) {
        const scId = sc.dataset.scale, scV = Number(sc.dataset.val), scK = todayKey();
        saveLog(function (log) { return T.logValue(state.trackers, log, scId, scV, scK); });
        renderBuiltins();
        return;
      }

      const pr = e.target.closest('[data-pair]');
      if (pr) {
        const patch = {}; patch[pr.dataset.field] = Number(pr.dataset.val);
        const prId = pr.dataset.pair, prK = todayKey();
        saveLog(function (log) { return T.logValue(state.trackers, log, prId, patch, prK); });
        renderBuiltins();
        return;
      }

      const sv = e.target.closest('[data-save-value]');
      if (sv) {
        const id = sv.dataset.saveValue;
        const input = $('#val-' + id);
        const raw = String((input && input.value) || '').trim();
        /*
         * Порожнє поле = «прибрати запис», а не нуль.
         *
         * Було Number('') === 0, і воно проходило Number.isFinite: тобто
         * очистити поле означало ЗАПИСАТИ нуль. Фантомний день із нулем
         * тягнув униз середні, рахувався як «відмічено сьогодні» на
         * головній, і прибрати його можна було лише через ✕ в історії.
         */
        if (!raw) {
          const rmK = todayKey();
          saveLog(function (log) { return T.removeEntry(log, id, rmK); });
          renderBuiltins();
          toast('Запис за сьогодні прибрано', 'ok');
          return;
        }
        const v = Number(raw.replace(',', '.'));
        if (!Number.isFinite(v)) { toast('Введіть число', 'err'); return; }
        const lvK = todayKey();
        saveLog(function (log) { return T.logValue(state.trackers, log, id, v, lvK); });
        renderBuiltins();
        toast('Записано', 'ok');
        return;
      }

      const gs = e.target.closest('[data-goal-save]');
      if (gs) {
        const id = gs.dataset.goalSave;
        const input = $('#goal-' + id);
        const def = T.defFor(state.trackers[id]);
        let v = Number(input && String(input.value).replace(',', '.'));
        if (Number.isFinite(v) && def && def.kind === 'duration') v = v * 60;
        saveTrackers(T.setGoal(state.trackers, id, v));
        renderBuiltins();
        toast('Ціль збережена', 'ok');
        return;
      }

      const del = e.target.closest('[data-entry-del]');
      if (del) {
        const parts = del.dataset.entryDel.split(':');
        const id = parts[0], d = parts.slice(1).join(':');
        // Журнал append-only: видалений запис нізвідки не відновити, а ✕
        // стоїть у щільному рядку поруч з іншими елементами.
        if (!window.confirm('Видалити запис за ' + d + '? Відновити його буде нічим.')) return;
        saveLog(function (log) { return T.removeEntry(log, id, d); });
        renderBuiltins();
        toast('Запис видалено', 'ok');
        return;
      }

      const ac = e.target.closest('[data-add-custom]');
      if (ac) {
        const type = ac.dataset.addCustom;
        const input = $('#add-' + type);
        const doseEl = type === 'supplement' ? $('#add-supplement-dose') : null;
        const doseRaw = doseEl ? String(doseEl.value || '').trim() : '';
        if (doseRaw && T.normDose(doseRaw) === null) { toast('Доза: від 0,1 до 500 г', 'err'); return; }
        const r = T.addCustom(state.trackers, type, input && input.value, doseRaw || null);
        if (!r) { toast('Введіть назву', 'err'); return; }
        state.trackers = r.trackers;
        persist({ trackers: r.trackers });
        renderSupplements();
        renderHabits();
        toast('Додано', 'ok');
        return;
      }

      const cd = e.target.closest('[data-custom-del]');
      if (cd) {
        const id = cd.dataset.customDel;
        const name = state.trackers[id] ? state.trackers[id].name : '';
        if (!window.confirm('Видалити «' + name + '» разом з історією позначок?')) return;
        state.trackers = T.removeCustom(state.trackers, id);
        state.log = Object.assign({}, state.log);
        delete state.log[id];
        /* Реєстр трекерів — точкове поле, а журнал — функцією (SYN-011):
           видалення однієї звички не має відкочувати весь журнал. */
        persist(function (pr) {
          const log = Object.assign({}, (pr && pr.trackerLog) || {});
          delete log[id];
          return { trackers: state.trackers, trackerLog: log };
        });
        renderSupplements();
        renderHabits();
        return;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('#add-supplement, #add-habit, #add-supplement-dose');
      if (!input) return;
      e.preventDefault();
      const btn = input.closest('.row').querySelector('[data-add-custom]');
      if (btn) btn.click();
    });
  }

  async function init() {
    if (!$('#tr-builtins')) return;

    let p = {};
    try { p = await Store.getProfile() || {}; } catch (_) {}
    state.trackers = T.ensureBuiltins(p.trackers);
    state.log = (p.trackerLog && typeof p.trackerLog === 'object') ? p.trackerLog : {};
    state.measureLog = (p.measureLog && typeof p.measureLog === 'object') ? p.measureLog : {};

    // Реєстр міг бути порожнім/старим — записуємо догодований варіант
    // одразу, щоб наступне читання (напр. на «Трекерах») не вигадувало
    // дефолти заново з різними id.
    if (JSON.stringify(state.trackers) !== JSON.stringify(p.trackers || {})) {
      persist({ trackers: state.trackers });
    }

    wire();
    renderAll();

    Store.onChange(function (profile) {
      if (!profile) return;
      if (profile.trackers) { state.trackers = T.ensureBuiltins(profile.trackers); renderBuiltins(); renderSupplements(); renderHabits(); }
      if (profile.trackerLog) { state.log = profile.trackerLog; renderAll(); }
      if (profile.measureLog) { state.measureLog = profile.measureLog; renderBuiltins(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
