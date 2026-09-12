/**
 * Сторінка «Зважування» — календар і поле вводу, більше нічого.
 *
 * НАВІЩО ОКРЕМА СТОРІНКА. Той самий блок є в «Прогресі», і він там
 * лишається. Але в «Прогресі» він стоїть шостим зверху, під графіком
 * ваги, прогнозом і смугою дотримання — а з телефона це означає:
 * відкрити найважчу сторінку сайту, дочекатись, поки намалюються всі
 * графіки, доїхати пальцем до потрібного місця й аж тоді вписати число,
 * яке людина тримає в голові тридцять секунд після ваг. Тут — перший
 * екран, поле вже на місці.
 *
 * ЦЕ НЕ ДРУГИЙ ЖУРНАЛ. Дані ті самі (profile.bodyLog), правила запису ті
 * самі (js/daylog-core.js: межі, крок 0,1 кг, кома замість крапки, вибір
 * дня). Сторінка не знає про вагу нічого власного — вона лише малює.
 * Саме тому її поява не додала жодного правила, яке могло б розійтись із
 * «Прогресом».
 *
 * ГРАФІКА ТУТ НЕМАЄ НАВМИСНО. Тренд — це те, що читають, а не
 * заповнюють; він лишився там, де його читають, і копіювати його сюди
 * означало б тягти на сторінку вводу півтори тисячі рядків малювання
 * заради погляду, який роблять раз на тиждень. Знизу — посилання.
 */
(function () {
  'use strict';

  const { $, esc, toast, dateLabel, fmtNum } = window.App;
  const DL = window.DayLogCore;
  const DC = window.DateCore;
  const Store = window.Store;

  /* Вікно календаря — рівно сім календарних місяців, як у «Прогресі».
     Інше вікно тут означало б, що два календарі одного журналу показують
     різні відрізки життя. */
  const MONTHS = 7;

  const state = { bodyLog: {}, day: '', ready: false };

  /* Делегат: єдина реалізація — js/date-core.js. */
  function todayKey() { return window.DateCore.todayKey(); }
  function day() { return DL.pickDay(state.day, todayKey()); }

  /* ------------------------------------------------------------------ */
  /* Малювання                                                           */
  /* ------------------------------------------------------------------ */

  function calHtml() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1), 1);
    const sel = day();
    return window.DayCal.html({
      from: DC.keyOf(first),
      to: todayKey(),
      label: 'Календар зважувань за ' + MONTHS + ' місяців',
      cls: 'mt-2',
      cell: function (k, d, isFuture) {
        if (isFuture) return null;
        const kg = DL.weightAt(state.bodyLog, k);
        /* Шкала БІНАРНА (0 або 4), як і в «Прогресі»: у ваги немає
           часток. Фарбувати клітинку за самим числом означало б показати
           шкалу, у якої немає ні нуля, ні межі. */
        return {
          lvl: kg !== null ? 4 : 0,
          sel: k === sel,
          attrs: 'data-wday="' + k + '"',
          label: dateLabel(DC.dateOf(k)) +
            (kg !== null ? ': ' + fmtNum.kg(kg) + ' кг' : ': запису немає') +
            '. Натисніть, щоб вписати вагу за цей день'
        };
      }
    });
  }

  function entryHtml() {
    const k = day();
    const isToday = k === todayKey();
    const val = DL.weightAt(state.bodyLog, k);
    const mon = DC.keyOf(DC.mondayOf(new Date()));
    const week = DL.weekTally(function (x) { return DL.weighed(state.bodyLog, x); }, mon);

    return '<div class="card">' +
        '<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">' +
          '<h2 style="margin:0">' + (isToday ? 'Сьогодні' : esc(dateLabel(DC.dateOf(k)))) + '</h2>' +
          '<span class="chip mono" title="Скільки днів цього тижня зважено">' +
            week + '/7 цього тижня</span>' +
        '</div>' +

        '<div class="row mt-2" style="gap:10px;align-items:flex-end;flex-wrap:wrap">' +
          '<div class="field" style="margin:0">' +
            '<label class="field__label" for="wl-kg">Вага, кг</label>' +
            /* type=text + inputmode=decimal, а не type=number: число з
               комою на телефоні в number-полі браузер вважає порожнім
               значенням і мовчки віддає '' — людина бачить, що набрала
               «82,4», а запис не йде. Розбирає рядок DayLogCore.parseKg. */
            '<input class="input mono" type="text" inputmode="decimal" id="wl-kg" ' +
              'style="width:140px" autocomplete="off" ' +
              'value="' + (val !== null ? esc(fmtNum.n(val, 1)) : '') + '" placeholder="82.4">' +
          '</div>' +
          '<button class="btn btn--primary" type="button" id="wl-add">' +
            (val !== null ? 'Оновити' : 'Записати') +
          '</button>' +
          (isToday ? '' :
            '<button class="btn btn--ghost" type="button" id="wl-today">Сьогодні</button>') +
        '</div>' +

        '<p class="small muted mt-2 mb-0">' +
          (isToday
            ? 'Найкраще — щоранку після туалету, до їжі. Однакові умови важливіші за точність ваг.'
            : 'Запис піде в цей день. Календар нижче — щоб дописати пропущене.') +
        '</p>' +
      '</div>';
  }

  function listHtml() {
    const all = DL.weightEntries(state.bodyLog);
    if (!all.length) {
      return '<p class="small muted">Записів поки немає. Перше число зʼявиться тут одразу після «Записати».</p>';
    }
    const last = all.slice(-10).reverse();
    return '<h2>Останні записи</h2>' +
      '<div class="card">' +
        last.map(function (e, i) {
          /* Різниця з ПОПЕРЕДНІМ записом, а не з учора: між зважуваннями
             могло пройти п'ять днів, і підпис «+0,4» без цього читався б
             як добова зміна. */
          const prev = last[i + 1];
          const dlt = prev ? Math.round((e.kg - prev.kg) * 10) / 10 : null;
          return '<div class="wlog-row">' +
            '<span class="small">' + esc(dateLabel(DC.dateOf(e.key))) + '</span>' +
            '<b class="mono">' + fmtNum.n(e.kg, 1) + ' кг</b>' +
            (dlt !== null && dlt !== 0
              ? '<span class="small muted mono">' + (dlt > 0 ? '+' : '') + fmtNum.n(dlt, 1) + '</span>'
              : '') +
            '<button class="btn btn--ghost btn--sm" type="button" data-wl-del="' + esc(e.key) + '" ' +
              'aria-label="Видалити запис за ' + esc(e.key) + '">✕</button>' +
          '</div>';
        }).join('') +
      '</div>';
  }

  function render() {
    const host = $('#wl-main');
    if (!host) return;
    /* Фокус переживає перемальовку: людина набирає число, натискає день
       у календарі — і без цього мусила б тапнути по полю ще раз. */
    const had = document.activeElement && document.activeElement.id === 'wl-kg';
    host.innerHTML = entryHtml() + '<div class="mt-3">' + calHtml() + '</div>' +
                     '<div class="mt-3">' + listHtml() + '</div>';
    if (had) focusField();
  }

  function focusField() {
    const f = $('#wl-kg');
    if (!f) return;
    try { f.focus(); f.select(); } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* Запис                                                               */
  /* ------------------------------------------------------------------ */

  async function persist(patch) {
    try { await Store.saveProfile(patch); }
    catch (e) {
      /* .queued означає «мережі немає, лежить у черзі» — це не втрата
         даних, і лякати людину червоним тостом тут неправильно. */
      toast(e.queued ? e.message : 'Не збереглося: ' + e.message, e.queued ? 'ok' : 'err');
    }
  }

  function save() {
    const input = $('#wl-kg');
    const kg = DL.parseKg(input && input.value);
    if (kg === null) {
      toast('Вага має бути числом від ' + DL.W_MIN + ' до ' + DL.W_MAX + ' кг', 'err');
      focusField();
      return;
    }
    const k = day();
    state.bodyLog = DL.setWeight(state.bodyLog, k, kg);
    /* Патч — функція: дописуємо ОДИН день на актуальному профілі, а не
       надсилаємо весь журнал, зчитаний колись. Інакше сусідня вкладка
       втрачала б свої записи цілком. */
    persist(function (p) {
      return { bodyLog: DL.setWeight(p && p.bodyLog, k, kg) };
    });
    render();
    toast(k === todayKey() ? 'Записано' : 'Записано за ' + dateLabel(DC.dateOf(k)), 'ok');
  }

  function remove(k) {
    /* Журнал ваги append-only: видалене нізвідки не відновити, а ✕ стоїть
       у щільному рядку впритул до інших елементів. */
    if (!window.confirm('Видалити запис ваги за ' + k + '? Відновити його буде нічим.')) return;
    state.bodyLog = DL.removeWeight(state.bodyLog, k);
    persist(function (p) {
      return { bodyLog: DL.removeWeight(p && p.bodyLog, k) };
    });
    render();
    toast('Запис за ' + k + ' видалено', 'ok');
  }

  /* ------------------------------------------------------------------ */

  async function init() {
    if (!$('#wl-main')) return;

    let p = {};
    try { p = await Store.getProfile() || {}; } catch (_) {}
    state.bodyLog = (p.bodyLog && typeof p.bodyLog === 'object') ? p.bodyLog : {};
    state.ready = true;
    render();

    document.addEventListener('click', function (e) {
      if (e.target.closest('#wl-add')) { save(); return; }
      if (e.target.closest('#wl-today')) { state.day = todayKey(); render(); focusField(); return; }
      const cell = e.target.closest('[data-wday]');
      if (cell) {
        /* Клік по дню НІЧОГО не пише — він лише переводить поле на цей
           день. Мовчазна правка ваги за минулий четвер одним тапом була б
           надто легкою для даних, які потім рахують тренд. */
        state.day = cell.dataset.wday;
        render();
        focusField();
        return;
      }
      const del = e.target.closest('[data-wl-del]');
      if (del) remove(del.dataset.wlDel);
    });

    /* Enter у полі = «Записати». Форми тут немає навмисно (submit
       перезавантажив би сторінку на file://), тож клавішу ловимо самі. */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'wl-kg') {
        e.preventDefault();
        save();
      }
    });

    Store.onChange(function (profile) {
      if (!profile || !state.ready) return;
      if (profile.bodyLog && profile.bodyLog !== state.bodyLog) {
        state.bodyLog = profile.bodyLog;
        render();
      }
    });

    /* Перехід через північ: обраний день лишався вчорашнім, і перший
       ранковий запис пішов би не в той день. */
    if (window.App.onDayChange) window.App.onDayChange(function () { state.day = ''; render(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
