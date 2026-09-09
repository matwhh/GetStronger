/**
 * СТАНДАРТНИЙ КАЛЕНДАР ДНІВ FORGE — одна сітка на весь сайт.
 *
 * Розкладка одна й та сама скрізь: підписи днів тижня колонкою зліва,
 * тижні — колонками вправо, підписи місяців над ними, тонкий роздільник
 * у проміжку між місяцями. Клітинка — спільна (.mcal__cell, розділ
 * «СТАНДАРТНА КЛІТИНКА ДНЯ» у css/style.css) із чотирма сходинками
 * заповненості.
 *
 * НАВІЩО ЦЕЙ ФАЙЛ. Ця сітка була написана двічі майже однаково: в
 * історії тренувань і в календарі зважувань. Копії розходяться тихо —
 * досить поправити арифметику місяця в одному місці, і два календарі
 * одного журналу починають малювати роздільники по-різному. Третій
 * екран (календар сезону в рейтингу) став би третьою копією, ще й в
 * іншому файлі, тож сітка переїхала сюди.
 *
 * Модуль НІЧОГО не знає про дані. Він рахує лише геометрію тижнів і
 * місяців, а що показує кожна клітинка — вирішує колбек cell(). Тому
 * ним однаково користуються календар тренувань (рівень = частка
 * закритих підходів), зважувань (є запис / немає) і сезону (день минув
 * / попереду).
 *
 * ЗАЛЕЖНОСТЕЙ НЕМАЄ навмисно: файл вантажать і журнал, і рейтинг, а вони
 * не мають спільного ядра, окрім App. Свої три рядки хелперів дешевші за
 * ще одну обовʼязкову залежність у порядку завантаження.
 *
 * ДАТИ ЛОКАЛЬНІ. Ключ 'YYYY-MM-DD' збирається з getFullYear/getMonth/
 * getDate, а не з toISOString: у Києві після третьої ночі UTC-дата вже
 * інша, і сітка малювала б завтрашній день сьогоднішнім.
 */
(function () {
  'use strict';

  const MON = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер',
               'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const KEY = /^\d{4}-\d{2}-\d{2}$/;
  const DAY = 86400000;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Локальна дата → 'YYYY-MM-DD' */
  function keyOf(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** 'YYYY-MM-DD' → локальний Date опівночі */
  function dateOf(k) {
    const p = String(k).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  /** Понеділок того тижня, у який потрапляє дата. */
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    /* getDay(): неділя = 0. Зсув (day + 6) % 7 робить понеділок нулем —
       тиждень у Forge починається з понеділка скрізь. */
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  /**
   * Сітка днів.
   *
   * @param {object} o
   * @param {string} o.from   перший день вікна ('YYYY-MM-DD')
   * @param {string} o.to     останній ДІЯЛЬНИЙ день: далі клітинки майбутні
   * @param {string} [o.until] останній день СІТКИ; за замовчуванням = to.
   *                           Календар сезону малює місяці вперед, тож у
   *                           нього until = кінець сезону, а to = сьогодні.
   * @param {function} o.cell  (key, date, isFuture) → дескриптор або null.
   *                           Дескриптор: {lvl, sel, label, attrs, cls, future}.
   *                           attrs порожні → клітинка не інтерактивна (<i>).
   *                           null → стандартний вигляд: бліда клітинка для
   *                           майбутнього дня, нейтральна для минулого.
   *                           Колбек викликається і на майбутні дні теж —
   *                           календар сезону підсвічує ними останній день.
   * @param {string} [o.label] aria-label усієї сітки
   * @param {string} [o.cls]   додаткові класи на .mcal
   * @returns {string} HTML або '' на некоректному вікні
   */
  function html(o) {
    const opt = o || {};
    if (!KEY.test(String(opt.from)) || !KEY.test(String(opt.to))) return '';
    const firstK = String(opt.from);
    const activeK = String(opt.to);
    const lastK = KEY.test(String(opt.until)) && String(opt.until) > activeK
      ? String(opt.until) : activeK;
    if (lastK < firstK) return '';

    const start = mondayOf(dateOf(firstK));
    const weeks = Math.floor((mondayOf(dateOf(lastK)) - start) / (7 * DAY)) + 1;
    /* Понад пів року колонок — це вже не сітка, а смуга в кілька екранів
       завширшки. Обмеження щедре (два роки), воно ловить лише зіпсовані
       межі, а не реальні вікна. */
    if (weeks < 1 || weeks > 110) return '';

    /*
     * МІСЯЦЬ КОЛОНКИ — ЗА ЇЇ ЧЕТВЕРГОМ.
     *
     * Тиждень майже завжди лежить у двох місяцях, і питання «якому
     * місяцю належить ця колонка» не має очевидної відповіді. За першим
     * днем колонки виходить, що останній тиждень серпня, з якого в
     * серпні лише понеділок, підписаний серпнем — і роздільник місяців
     * стоїть на тиждень пізніше, ніж людина його чекає. Четвер — це
     * середина, тобто той місяць, якому належить БІЛЬШІСТЬ днів колонки.
     * Той самий принцип, що в ISO-8601 для номера тижня.
     *
     * Затискання в межі вікна потрібне для крайніх колонок: у першої
     * четвер може бути ще до firstK, у останньої — вже після lastK.
     */
    const colMonth = [], colFirst = [];
    let prev = -1;
    for (let w = 0; w < weeks; w++) {
      const thu = new Date(start);
      thu.setDate(start.getDate() + w * 7 + 3);
      let k = keyOf(thu);
      if (k > lastK) k = lastK;
      if (k < firstK) k = firstK;
      const mm = Number(k.slice(5, 7)) - 1;
      colMonth[w] = mm;
      colFirst[w] = (w === 0 || mm !== prev);
      prev = mm;
    }

    let cols = '';
    for (let w = 0; w < weeks; w++) {
      let cells = '';
      for (let r = 0; r < 7; r++) {
        const day = new Date(start);
        day.setDate(start.getDate() + w * 7 + r);
        const k = keyOf(day);

        if (k < firstK || k > lastK) {
          cells += '<i class="mcal__cell mcal__cell--pad" aria-hidden="true"></i>';
          continue;
        }
        const isFuture = k > activeK;
        const c = typeof opt.cell === 'function' ? opt.cell(k, day, isFuture) : null;
        if (!c) {
          cells += isFuture
            ? '<i class="mcal__cell mcal__cell--future">' + day.getDate() + '</i>'
            : '<i class="mcal__cell" data-lvl="0">' + day.getDate() + '</i>';
          continue;
        }

        const cls = 'mcal__cell' + (c.future ? ' mcal__cell--future' : '') +
                    (c.sel ? ' mcal__cell--sel' : '') +
                    (c.cls ? ' ' + c.cls : '');
        const lvl = ' data-lvl="' + (Number(c.lvl) || 0) + '"';
        if (c.attrs) {
          cells += '<button type="button" class="' + cls + '"' + lvl + ' ' + c.attrs +
                   ' aria-pressed="' + (c.sel ? 'true' : 'false') + '"' +
                   ' aria-label="' + esc(c.label || k) + '">' +
                   '<span>' + day.getDate() + '</span></button>';
        } else {
          cells += '<i class="' + cls + '"' + lvl +
                   (c.label ? ' title="' + esc(c.label) + '"' : '') + '>' +
                   day.getDate() + '</i>';
        }
      }
      cols += '<div class="mcal__col' + (colFirst[w] && w > 0 ? ' is-month' : '') + '">' +
              cells + '</div>';
    }

    /* Порожня комірка над колонкою підписів днів тижня: без неї підписи
       місяців зсунуті на її ширину вліво відносно своїх колонок. */
    let months = '<span class="mcal__months-pad" aria-hidden="true"></span>';
    for (let w = 0; w < weeks; w++) {
      months += '<span class="mcal__month">' + (colFirst[w] ? MON[colMonth[w]] : '') + '</span>';
    }

    const dow = DOW.map(function (n) { return '<span>' + n + '</span>'; }).join('');

    return '<div class="mcal' + (opt.cls ? ' ' + opt.cls : '') + '" role="group"' +
             (opt.label ? ' aria-label="' + esc(opt.label) + '"' : '') + '>' +
             '<div class="mcal__months" aria-hidden="true">' + months + '</div>' +
             '<div class="mcal__grid">' +
               '<div class="mcal__days" aria-hidden="true">' + dow + '</div>' +
               cols +
             '</div>' +
           '</div>';
  }

  window.DayCal = {
    MON: MON,
    DOW: DOW,
    keyOf: keyOf,
    dateOf: dateOf,
    mondayOf: mondayOf,
    html: html
  };
})();
