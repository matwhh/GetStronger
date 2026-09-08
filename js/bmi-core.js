/**
 * BMI — чиста арифметика і правила попереджень.
 *
 * BMI = вага(кг) / зріст(м)². Це скринінговий показник, не діагноз:
 * він не бачить мʼязову масу й розподіл жиру, тому кожен показ на сайті
 * супроводжується застереженням, а тексти нижче сформульовані як
 * «зверніть увагу», а не як вирок.
 *
 * АНТИСПАМ. Попередження показується один раз на КАТЕГОРІЮ: людина
 * підтвердила «Я зрозумів» — і бачить його знову лише коли BMI перейшов
 * в іншу категорію (наприклад, з нормального в нижчий за норму).
 * Підтвердження живе в профілі (bmiAck), тому переживає перезаходи
 * і синхронізується між пристроями.
 */
(function () {
  'use strict';

  /** null, якщо порахувати нема з чого */
  function bmi(weightKg, heightCm) {
    const w = Number(weightKg), h = Number(heightCm);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 20 || h < 100) return null;
    const m = h / 100;
    return Math.round(w / (m * m) * 10) / 10;
  }

  /* Загальноприйняті категорії ВООЗ для дорослих */
  function category(b) {
    if (b === null || !Number.isFinite(b)) return null;
    if (b < 18.5) return 'under';
    if (b < 25)   return 'normal';
    if (b < 30)   return 'over';
    return 'obese';
  }

  const CAT_LABEL = {
    under:  'нижче стандартного діапазону',
    normal: 'у стандартному діапазоні (18,5–24,9)',
    over:   'вище стандартного діапазону',
    obese:  'суттєво вище стандартного діапазону'
  };

  /* Тексти попереджень. Знак BMI ≠ стан здоровʼя — і це сказано прямо. */
  const WARN = {
    under: {
      title: 'Зверніть увагу',
      body: 'Ваш ІМТ (індекс маси тіла) нижчий за стандартний діапазон для дорослих. ' +
        'ІМТ — лише орієнтовний скринінговий показник: він не може самостійно ' +
        'визначити стан здоровʼя чи склад тіла. Перед початком інтенсивних ' +
        'тренувань, зміною харчування або використанням рекомендацій Forge ' +
        'радимо проконсультуватися з лікарем або іншим відповідним медичним ' +
        'спеціалістом. Forge не є медичним сервісом і не замінює професійну ' +
        'медичну консультацію.'
    },
    over: {
      title: 'Зверніть увагу',
      body: 'Ваш ІМТ (індекс маси тіла) вищий за стандартний діапазон для дорослих. ' +
        'ІМТ — лише скринінговий показник: він не враховує мʼязову масу, ' +
        'розподіл жирової тканини та інші індивідуальні фактори — у людей із ' +
        'великою мʼязовою масою він завищений за побудовою. Якщо є сумніви ' +
        'щодо здоровʼя, харчування чи безпеки навантажень — проконсультуйся ' +
        'з кваліфікованим спеціалістом. Forge не є медичним сервісом і не ' +
        'замінює професійну медичну консультацію.'
    }
  };
  WARN.obese = WARN.over;

  /** Чи треба показати попередження для цього BMI з огляду на ack */
  function shouldWarn(b, ack) {
    const cat = category(b);
    if (!cat || cat === 'normal') return false;
    if (!ack || typeof ack !== 'object') return true;
    return ack.category !== cat;   // та сама категорія вже підтверджена
  }

  /** Обʼєкт підтвердження для профілю */
  function ackFor(b) {
    return { category: category(b), bmi: b, at: new Date().toISOString() };
  }

  /**
   * Показати модалку попередження (спільна для скринінгу й акаунта).
   * Сам факт «показувати чи ні» вирішує shouldWarn — цей хелпер лише
   * малює. onAck викликається після «Я зрозумів».
   */
  function showWarnModal(b, onAck) {
    const w = WARN[category(b)];
    if (!w) { if (onAck) onAck(); return; }
    const esc = function (t) {
      return String(t).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    };
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML =
      '<div class="modal__backdrop"></div>' +
      '<div class="modal__box" role="alertdialog" aria-modal="true" aria-labelledby="bmi-w-t">' +
        '<h3 id="bmi-w-t" style="margin:0">' + esc(w.title) + '</h3>' +
        '<p class="small mt-1">Ваш ІМТ: <b class="mono">' + String(b).replace('.', ',') + '</b>.</p>' +
        '<p class="small mt-1">' + esc(w.body) + '</p>' +
        '<button class="btn btn--primary btn--wide mt-2" type="button" id="bmi-w-ok">Я зрозумів</button>' +
      '</div>';
    document.body.appendChild(wrap);

    /*
     * МОДАЛКА МАЄ БУТИ МОДАЛКОЮ (UX-009).
     *
     * Розмітка оголошувала role="alertdialog" aria-modal="true", а
     * поводилась як звичайний прямокутник поверх сторінки: фокус лишався
     * на тому, що під нею, Tab вільно ходив по схованих кнопках, Escape і
     * клік по підкладці не закривали, фон прокручувався. Для екранного
     * читача це пряма брехня: він оголошував «діалог» і лишав користувача
     * поза ним.
     *
     * Пастка фокуса тут проста навмисно: у діалозі рівно одна кнопка,
     * тож достатньо не випускати Tab за межі box.
     */
    const okBtn = wrap.querySelector('#bmi-w-ok');
    const prevFocus = document.activeElement;
    let closed = false;

    try { window.App.lockScroll(true); } catch (_) {}

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      try { window.App.lockScroll(false); } catch (_) {}
      /* Фокус повертається туди, звідки його забрали: інакше після
         закриття він опинявся на document.body, і клавіатурна навігація
         починалась зі шапки сторінки. */
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (_) {}
      if (onAck) onAck();
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      /* У діалозі рівно один фокусований елемент, тож будь-який Tab
         (і Shift+Tab) веде назад у нього — за межі box фокус не йде. */
      e.preventDefault();
      okBtn.focus();
    }

    document.addEventListener('keydown', onKey, true);
    okBtn.addEventListener('click', close);
    /*
     * Клік по підкладці закриває — але це саме підтвердження, а не
     * скасування: попередження прочитане й повторювати його щоразу
     * означало б навчити людину клацати «Я зрозумів» не читаючи.
     */
    const backdrop = wrap.querySelector('.modal__backdrop');
    if (backdrop) backdrop.addEventListener('click', close);

    try { okBtn.focus(); } catch (_) {}
  }

  window.BmiCore = {
    showWarnModal: showWarnModal,
    bmi: bmi,
    category: category,
    CAT_LABEL: CAT_LABEL,
    WARN: WARN,
    shouldWarn: shouldWarn,
    ackFor: ackFor
  };
})();
