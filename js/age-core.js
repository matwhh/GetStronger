/**
 * Вік за датою народження — чисті функції, без DOM і без сховища.
 *
 * Forge доступний лише повнолітнім, і рішення «пускати чи ні» ухвалює
 * саме цей модуль. Він навмисно не знає ні про сторінки, ні про профіль:
 * на вхід — рядок дати, на вихід — число років і вердикт. Тому його можна
 * прогнати тестами на високосних роках і на самому дні народження, а не
 * перевіряти клікáнням.
 *
 * ЧОМУ ДАТА, А НЕ ВІК ЧИСЛОМ. У профілі вже було поле age — число, яке
 * людина вписує руками. Воно протухає: рік по тому там те саме число.
 * Для перевірки повноліття це не годиться, тому джерелом стала дата
 * народження, а age рахується з неї (див. js/agegate.js).
 */
(function () {
  'use strict';

  const MIN_AGE = 17;
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  /** Найстарша дата, яку приймаємо: 120 років — межа правдоподібності */
  const MAX_YEARS = 120;

  /**
   * Розібрати 'YYYY-MM-DD' у локальну дату.
   *
   * new Date('2000-01-31') читається як UTC-північ, і в поясах на захід
   * від Гринвіча це вже 30 січня за місцевим часом — тобто вік іноді
   * зсувався на добу. Тому збираємо дату покомпонентно.
   */
  function parse(str) {
    const m = DATE_RE.exec(String(str || ''));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    // Перевірка на неіснуючу дату: 31 лютого стає 3 березня, і компоненти
    // після нормалізації не збігаються з тим, що вводили.
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  }

  /**
   * Повних років на дату now.
   *
   * Рахуємо різницю років і віднімаємо один, якщо день народження цього
   * року ще не настав. Ділити дні на 365.25 не можна: у високосний рік
   * така арифметика дає повноліття на добу раніше.
   *
   * @returns {number|null} null — дата непридатна (не розібралась,
   *   у майбутньому або старша за MAX_YEARS)
   */
  function ageOn(birth, now) {
    const b = parse(birth);
    if (!b) return null;
    const t = now instanceof Date ? now : new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    if (b > today) return null;                       // дата з майбутнього

    let years = today.getFullYear() - b.getFullYear();
    const had = (today.getMonth() > b.getMonth()) ||
      (today.getMonth() === b.getMonth() && today.getDate() >= b.getDate());
    if (!had) years -= 1;

    if (years > MAX_YEARS) return null;
    return years;
  }

  /** Чи придатна дата як дата народження взагалі */
  function isValidBirthDate(birth, now) {
    return ageOn(birth, now) !== null;
  }

  /** Головне питання: пускати чи ні. Невідома дата — НЕ пускати. */
  function isAdult(birth, now) {
    const a = ageOn(birth, now);
    return a !== null && a >= MIN_AGE;
  }

  /**
   * Стан для екрана: що показувати й чи можна далі.
   *   'empty'   — дати ще немає
   *   'invalid' — дата непридатна (майбутнє, неіснуючий день, > 120 років)
   *   'minor'   — вік менший за 17
   *   'adult'   — можна продовжувати
   */
  function gateState(birth, now) {
    if (!String(birth || '').trim()) return { state: 'empty', age: null };
    const a = ageOn(birth, now);
    if (a === null) return { state: 'invalid', age: null };
    return { state: a >= MIN_AGE ? 'adult' : 'minor', age: a };
  }

  /** Найпізніша дата народження, за якої вже є 17 — для max у полі вводу */
  function latestAdultBirthDate(now) {
    const t = now instanceof Date ? now : new Date();
    const d = new Date(t.getFullYear() - MIN_AGE, t.getMonth(), t.getDate());
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  window.AgeCore = {
    MIN_AGE: MIN_AGE,
    MAX_YEARS: MAX_YEARS,
    parse: parse,
    ageOn: ageOn,
    isValidBirthDate: isValidBirthDate,
    isAdult: isAdult,
    gateState: gateState,
    latestAdultBirthDate: latestAdultBirthDate
  };
})();
