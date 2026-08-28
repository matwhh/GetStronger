/**
 * Статистичні сезони Forge — одне джерело правди про періоди.
 *
 * НАВІЩО. Forge накопичує історію з першого дня, але «статистика сезону»
 * має рахуватись від фіксованої дати старту. Без централізованого місця
 * ця дата розповзлась би по десятку файлів, і додати Сезон 2 означало б
 * правити аналітику скрізь. Тут вона одна.
 *
 * ЩО ЦЕ НЕ Є. Це НЕ сезонний рейтинг ELO (db/elo-engine.sql, js/season.js):
 * той живе на сервері, триває три місяці й починається з 0 ELO щокварталу.
 * Тут — інше: період, за який рахується ТРЕНУВАЛЬНА статистика (обʼєм,
 * PR, консистентність). Дві системи навмисно окремі: рейтинг — гейміфікація,
 * статистика — факти.
 *
 * ІСТОРІЯ НЕ ЧІПАЄТЬСЯ. Записи до старту сезону лишаються в журналах і
 * доступні як lifetime-історія (календар, підсумок дня, графіки ваги).
 * Сезон лише ОБМЕЖУЄ вікно аналітики — нічого не видаляє й не переписує.
 *
 * ДАТИ ЛОКАЛЬНІ. Межа '2026-09-01' означає опівніч за місцевим часом
 * користувача: журнали підписані локальними датами (keyOf), тож порівняння
 * рядків 'YYYY-MM-DD' і є порівнянням у правильному поясі. UTC тут дав би
 * зсув на добу для половини світу.
 *
 * ДОДАТИ СЕЗОН 2: один запис у SEASONS із start наступного дня. Аналітика
 * не змінюється — вона питає current() і бере його межі.
 */
(function () {
  'use strict';

  /* Порядок від найстарішого до найновішого. end: null — сезон триває. */
  const SEASONS = [
    { id: 1, name: 'Сезон 1', start: '2026-09-01', end: null }
  ];

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  /** Локальна дата 'YYYY-MM-DD' */
  function keyOf(d) {
    const x = d instanceof Date ? d : new Date();
    return x.getFullYear() + '-' +
      String(x.getMonth() + 1).padStart(2, '0') + '-' +
      String(x.getDate()).padStart(2, '0');
  }

  /**
   * Сезон, активний на дату (за замовчуванням — сьогодні).
   * null, якщо дата раніша за старт першого сезону: до 1 вересня 2026
   * сезонів не існує, і аналітика чесно показує lifetime.
   */
  function at(date) {
    const k = DATE_KEY.test(String(date || '')) ? String(date) : keyOf(date);
    for (let i = SEASONS.length - 1; i >= 0; i--) {
      const s = SEASONS[i];
      if (k >= s.start && (s.end === null || k <= s.end)) return s;
    }
    return null;
  }

  /** Поточний сезон або null. */
  function current(now) { return at(now ? keyOf(now) : keyOf(new Date())); }

  /** Чи належить дата сезону. Межі включні з обох боків. */
  function contains(season, dateKey) {
    if (!season || !DATE_KEY.test(String(dateKey))) return false;
    return dateKey >= season.start && (season.end === null || dateKey <= season.end);
  }

  /**
   * Нижня межа вікна аналітики: перша дата, яку враховувати.
   * Поки сезон не почався — null (рахуємо всю історію).
   */
  function floorKey(now) {
    const s = current(now);
    return s ? s.start : null;
  }

  /**
   * Обрізати журнал { 'YYYY-MM-DD': ... } до меж сезону.
   * Повертає НОВИЙ обʼєкт — вхідний журнал недоторканий (історія
   * незмінна за побудовою). Без сезону повертає вхідний як є.
   */
  function clip(log, now) {
    const from = floorKey(now);
    if (!from || !log || typeof log !== 'object') return log || {};
    const out = {};
    Object.keys(log).forEach(function (k) {
      if (DATE_KEY.test(k) && k >= from) out[k] = log[k];
    });
    return out;
  }

  /**
   * Те саме для weightLog: { 'Вправа': [{d, kg}] } — інша форма журналу.
   * Вправи, у яких після обрізання не лишилось записів, зникають зі списку.
   */
  function clipSeries(log, now) {
    const from = floorKey(now);
    if (!from || !log || typeof log !== 'object') return log || {};
    const out = {};
    Object.keys(log).forEach(function (name) {
      const arr = Array.isArray(log[name]) ? log[name] : [];
      const kept = arr.filter(function (e) { return e && DATE_KEY.test(e.d) && e.d >= from; });
      if (kept.length) out[name] = kept;
    });
    return out;
  }

  /** Підпис для UI: «Сезон 1 · з 1 вересня 2026» або lifetime. */
  function label(now) {
    const s = current(now);
    if (!s) return 'За весь час';
    const MONTHS = ['січня','лютого','березня','квітня','травня','червня',
                    'липня','серпня','вересня','жовтня','листопада','грудня'];
    const p = s.start.split('-').map(Number);
    return s.name + ' · з ' + p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0];
  }

  window.SeasonCore = {
    SEASONS: SEASONS,
    at: at,
    current: current,
    contains: contains,
    floorKey: floorKey,
    clip: clip,
    clipSeries: clipSeries,
    label: label
  };
})();
