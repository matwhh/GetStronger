/**
 * Ядро замірів тіла — чисті функції, без DOM і без сховища.
 *
 * Дані живуть у профілі: profile.measureLog = {
 *   'YYYY-MM-DD': { t: 'ГГ:ХХ', neck: 36.5, chest: 102, ... }
 * }
 * Один запис на день (повторний замір того самого дня редагує його).
 * ВАГИ тут немає навмисно: вага тіла давно живе в profile.bodyLog —
 * друге джерело правди розійшлося б із першим. Форма замірів пише вагу
 * саме в bodyLog, а читає звідти ж. Зріст — поле профілю, не заміру:
 * у дорослого він не міняється щотижня.
 *
 * Сховище й доступ — ті самі, що в усього профілю (Supabase profiles,
 * RLS: лише власник із підтвердженим акаунтом). Окремої таблиці немає
 * навмисно: measureLog — ще один журнал поруч із bodyLog / weightLog /
 * mealLog, а не паралельна система.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  /* Поля заміру. Групи — для секцій на формі (мобільний UX).
     Межі широкі, але фізіологічні: захист від одруку, не від людини. */
  const FIELDS = [
    { k: 'neck',     label: 'Шия',            group: 'upper', min: 20, max: 80 },
    { k: 'shoulders',label: 'Плечі (обхват)', group: 'upper', min: 70, max: 200 },
    { k: 'chest',    label: 'Груди',          group: 'upper', min: 50, max: 200 },
    { k: 'waist',    label: 'Талія',          group: 'torso', min: 40, max: 200 },
    { k: 'belly',    label: 'Живіт',          group: 'torso', min: 40, max: 220 },
    { k: 'hips',     label: 'Стегна (обхват)',group: 'torso', min: 50, max: 220 },
    { k: 'glutes',   label: 'Сідниці',        group: 'torso', min: 50, max: 220 },
    { k: 'bicepsL',  label: 'Біцепс L',       group: 'arms',  min: 15, max: 70 },
    { k: 'bicepsR',  label: 'Біцепс R',       group: 'arms',  min: 15, max: 70 },
    { k: 'forearmL', label: 'Передпліччя L',  group: 'arms',  min: 12, max: 55 },
    { k: 'forearmR', label: 'Передпліччя R',  group: 'arms',  min: 12, max: 55 },
    { k: 'thighL',   label: 'Стегно L',       group: 'legs',  min: 30, max: 110 },
    { k: 'thighR',   label: 'Стегно R',       group: 'legs',  min: 30, max: 110 },
    { k: 'calfL',    label: 'Литка L',        group: 'legs',  min: 20, max: 70 },
    { k: 'calfR',    label: 'Литка R',        group: 'legs',  min: 20, max: 70 },
    { k: 'bodyfat',  label: 'Жир, %',         group: 'general', min: 3, max: 60, unit: '%' }
  ];

  const GROUPS = [
    { id: 'upper',   label: 'Верх тіла' },
    { id: 'torso',   label: 'Корпус' },
    { id: 'arms',    label: 'Руки' },
    { id: 'legs',    label: 'Ноги' },
    { id: 'general', label: 'Загальні показники' }
  ];

  const BY_KEY = {};
  FIELDS.forEach(function (f) { BY_KEY[f.k] = f; });

  function fieldsOf(group) {
    return FIELDS.filter(function (f) { return f.group === group; });
  }

  /** Значення валідне для поля? null/'' — теж ок (поле необовʼязкове). */
  function validValue(key, v) {
    if (v === null || v === undefined || v === '') return true;
    const f = BY_KEY[key];
    const n = Number(String(v).replace(',', '.'));
    return Boolean(f) && Number.isFinite(n) && n >= f.min && n <= f.max;
  }

  /**
   * Зібрати запис з сирих значень форми: невалідне й порожнє — геть,
   * числа — з комою чи крапкою, округлення до 0,1.
   * Повертає null, якщо ЖОДНОГО виміру немає (порожній запис — не запис).
   */
  function buildEntry(raw, time) {
    const out = {};
    let any = false;
    FIELDS.forEach(function (f) {
      const v = raw ? raw[f.k] : null;
      if (v === null || v === undefined || v === '') return;
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < f.min || n > f.max) return;
      out[f.k] = Math.round(n * 10) / 10;
      any = true;
    });
    if (!any) return null;
    if (/^\d{2}:\d{2}$/.test(String(time || ''))) out.t = time;
    return out;
  }

  /** Відсортовані дати замірів: нові → старі */
  function dates(log) {
    if (!log || typeof log !== 'object') return [];
    return Object.keys(log).filter(function (k) {
      return DATE_KEY.test(k) && log[k] && typeof log[k] === 'object';
    }).sort().reverse();
  }

  /** Серія одного параметра: [{d, v}] старі → нові */
  function series(log, key) {
    return dates(log).slice().reverse().map(function (d) {
      const v = Number(log[d][key]);
      return Number.isFinite(v) ? { d: d, v: v } : null;
    }).filter(Boolean);
  }

  /**
   * Зведення параметра: поточне, попереднє, зміна і зміна від першого
   * виміру (у см і %). Знак НЕ трактується як «добре/погано» — для талії
   * і біцепса він означає протилежне, і вирішує людина, не код.
   */
  function stats(log, key) {
    const s = series(log, key);
    if (!s.length) return null;
    const cur = s[s.length - 1];
    const prev = s.length > 1 ? s[s.length - 2] : null;
    const first = s[0];
    const r1 = function (n) { return Math.round(n * 10) / 10; };
    return {
      key: key,
      label: (BY_KEY[key] || {}).label || key,
      unit: (BY_KEY[key] || {}).unit || 'см',
      current: cur.v, currentDate: cur.d,
      prev: prev ? prev.v : null,
      delta: prev ? r1(cur.v - prev.v) : null,
      fromFirst: s.length > 1 ? r1(cur.v - first.v) : null,
      fromFirstPct: s.length > 1 && first.v > 0
        ? Math.round((cur.v - first.v) / first.v * 1000) / 10 : null,
      count: s.length,
      series: s
    };
  }

  /** Параметри, що мають хоч один запис, у порядку FIELDS */
  function measuredKeys(log) {
    return FIELDS.map(function (f) { return f.k; }).filter(function (k) {
      return series(log, k).length > 0;
    });
  }

  window.MeasureCore = {
    FIELDS: FIELDS,
    GROUPS: GROUPS,
    BY_KEY: BY_KEY,
    fieldsOf: fieldsOf,
    validValue: validValue,
    buildEntry: buildEntry,
    dates: dates,
    series: series,
    stats: stats,
    measuredKeys: measuredKeys
  };
})();
