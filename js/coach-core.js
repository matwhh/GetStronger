/**
 * Перехресне тренерство — зал і харчування читають журнали одне одного.
 *
 * ЩО ЦЕ ЛАГОДИТЬ. Досі це були два застосунки під одним дахом. Прогресія
 * вимагала «додай 2,5 кг», коли людина третій тиждень у дефіциті й
 * худне — а в дефіциті сила лінійно не росте, і така вимога є вимогою
 * провалити підхід. Графік жиму показував рівну лінію пʼять тижнів і
 * мовчав, хоча причина лежала в сусідньому журналі.
 *
 * ДВІ МЕЖІ, ЯКІ ТУТ НЕ МОЖНА ПОРУШУВАТИ.
 *
 * 1. Ніщо не карає того, хто не веде харчування. Тому головний сигнал —
 *    ВАГА ТІЛА, а не щоденник їжі: зважування веде майже кожен, і його
 *    достатньо, щоб зрозуміти, дефіцит зараз чи ні. Щоденник лише
 *    уточнює відповідь у калоріях.
 * 2. Тренер називає ФАКТИ, а не дає порад. «За ці пʼять тижнів ви їли в
 *    середньому 2380 при цілі 2900 і схудли 1,8 кг» — можна. «Їж
 *    більше» — ні. Виняток один і він не порада, а робота застосунку:
 *    програма може змінити режим прогресії, бо складати програму — це
 *    її задача.
 *
 * ПРАВИЛО ОДНІЄЇ ПРИЧИНИ. Причина називається одна й лише коли доказ
 * однозначний. Збіглося двоє — показуються факти, і жоден не названий
 * головним. Впевнено названа неправильна причина гірша за рівну лінію:
 * людина піде виправляти не те.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  /* ------------------------------------------------------------------ */
  /* 1. Режим: ростемо чи утримуємо                                      */
  /* ------------------------------------------------------------------ */
  /*
   * Поріг — у ВІДСОТКАХ маси тіла на тиждень, а не в кілограмах: 300 г
   * на тиждень для 55 кг і для 110 кг — це різні події. 0,25 % ≈ 200 г
   * для вісімдесятикілограмової людини: менше тоне у воді й солі.
   */
  const LOSS_PCT_WEEK = 0.25;

  /* Вікно спостереження. Два тижні — мінімум, за який вага тіла взагалі
     щось означає (та сама межа, що в js/tdee-core.js). */
  const WINDOW_DAYS = 28;
  const MIN_WINDOW = 14;

  function weightSeries(bodyLog, fromKey) {
    return Object.keys(bodyLog || {})
      .filter(function (k) {
        if (!DATE_KEY.test(k) || k < fromKey) return false;
        const v = Number(bodyLog[k]);
        return Number.isFinite(v) && v > 20 && v < 400;
      })
      .sort()
      .map(function (k) { return { d: k, kg: Number(bodyLog[k]) }; });
  }

  /**
   * Режим прогресії за енергетичним балансом.
   *
   * @returns {?{mode:'grow'|'hold', lossPctWeek:number, deltaKg:number,
   *             days:number, balance:?number, maintenance:?number}}
   *   null — зважувань замало, і тоді НІЧОГО не змінюється: відсутність
   *   даних не привід міняти людині програму.
   */
  function energyMode(profile, now) {
    const p = profile || {};
    const D = window.DateCore;
    if (!D) return null;

    const today = now instanceof Date ? now : new Date();
    const toKey = D.keyOf(today);
    const fromKey = D.shiftKey(toKey, -(WINDOW_DAYS - 1));
    const s = weightSeries(p.bodyLog, fromKey);
    if (s.length < 4) return null;

    const spanDays = (D.dateOf(s[s.length - 1].d) - D.dateOf(s[0].d)) / 86400000;
    if (spanDays < MIN_WINDOW - 1) return null;

    /* Краї — СЕРЕДНІ по третині ряду, а не поодинокі ранки: денна вага
       гуляє на кілограм від води й солі, і два випадкові зважування
       дали б режим, що стрибає через день. */
    const cut = Math.max(1, Math.round(s.length / 3));
    const avg = function (arr) {
      return arr.reduce(function (a, e) { return a + e.kg; }, 0) / arr.length;
    };
    const head = avg(s.slice(0, cut));
    const tail = avg(s.slice(-cut));
    const deltaKg = tail - head;
    const weeks = spanDays / 7;
    const lossPctWeek = weeks > 0 ? (-deltaKg / head * 100) / weeks : 0;

    /* Баланс у калоріях — лише коли є щоденник їжі. Без нього кажемо
       «худнете», а не «дефіцит 300 ккал»: другого ми не виміряли. */
    let balance = null, maintenance = null;
    const TC = window.TdeeCore;
    if (TC && typeof TC.measure === 'function') {
      const m = TC.measure(p.bodyLog, p.mealLog, WINDOW_DAYS, today)
             || TC.measure(p.bodyLog, p.mealLog, TC.MIN_DAYS, today);
      if (m) { maintenance = m.kcal; balance = m.intake - m.kcal; }
    }

    return {
      mode: lossPctWeek >= LOSS_PCT_WEEK ? 'hold' : 'grow',
      lossPctWeek: Math.round(lossPctWeek * 100) / 100,
      deltaKg: Math.round(deltaKg * 100) / 100,
      days: Math.round(spanDays) + 1,
      balance: balance === null ? null : Math.round(balance),
      maintenance: maintenance
    };
  }

  /* ------------------------------------------------------------------ */
  /* 2. Скільки коштує тренувальний тиждень                              */
  /* ------------------------------------------------------------------ */
  /*
   * ЦЕ ФАКТ, А НЕ ДОДАНОК ДО ЦІЛІ — і різниця принципова.
   *
   * Перша версія плану казала: рахувати базу від нижчої активності, а
   * зверху додавати оцінку з фактичного обсягу. Так робити не можна:
   * коефіцієнт активності у формулі ВЖЕ включає тренування, і додати
   * їх іще раз означало б порахувати двічі. А коли ввімкнено виміряні
   * витрати (js/tdee-core.js), тренування в них уже враховані за
   * визначенням — вимірювання не питає, звідки взялась витрата.
   *
   * Тому число існує як відповідь на питання «скільки коштує зайти в
   * зал іще раз на тиждень» — у симуляторі й поруч зі статистикою.
   *
   * MET 5 — помірна силова робота. Формула kcal/хв = MET × 3,5 × кг /
   * 200 стандартна; від валової витрати віднімаємо спокій ((MET−1)/MET),
   * бо спокій уже порахований у базовому обміні.
   */
  const MET_LIFTING = 5;

  /**
   * @param {object} sessionLog журнал сесій (потрібні t0/t1)
   * @param {number} weightKg   вага тіла
   * @param {number} days       вікно
   * @returns {?{perSession:number, perDay:number, sessions:number, minutes:number}}
   */
  function trainingKcal(sessionLog, weightKg, days, now) {
    const D = window.DateCore;
    const kg = Number(weightKg);
    if (!D || !Number.isFinite(kg) || kg <= 0) return null;

    const win = Math.max(1, Math.round(Number(days) || WINDOW_DAYS));
    const today = now instanceof Date ? now : new Date();
    const fromKey = D.shiftKey(D.keyOf(today), -(win - 1));

    let minutes = 0, sessions = 0;
    Object.keys(sessionLog || {}).forEach(function (k) {
      if (!DATE_KEY.test(k) || k < fromKey) return;
      const s = sessionLog[k] || {};
      const t0 = Number(s.t0), t1 = Number(s.t1);
      if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return;
      const m = (t1 - t0) / 60000;
      /* Сесія довша за чотири години — це забутий телефон у роздягальні,
         а не тренування. Ріжемо, а не викидаємо: сесія все одно була. */
      minutes += Math.min(m, 240);
      sessions += 1;
    });
    if (!sessions || minutes <= 0) return null;

    const perMin = MET_LIFTING * 3.5 * kg / 200;
    const net = perMin * (MET_LIFTING - 1) / MET_LIFTING;
    const total = net * minutes;

    return {
      perSession: Math.round(total / sessions),
      perDay: Math.round(total / win),
      sessions: sessions,
      minutes: Math.round(minutes)
    };
  }

  /* ------------------------------------------------------------------ */
  /* 3. Чому вага стоїть                                                 */
  /* ------------------------------------------------------------------ */
  /*
   * Кожна причина — це ФАКТ із журналу, а не ярлик. «Ви їли в середньому
   * 2300 при цілі 2600» людина може перевірити; «недоїдання» — ні.
   */

  /* Частка днів нижче цілі білка, від якої це вже не випадковість */
  const PROTEIN_MISS_SHARE = 0.6;
  /* Скільки разів вправу треба зробити за вікно, щоб плато було плато */
  const MIN_SESSIONS = 3;

  function fmtKg(v) { return String(Math.round(v * 10) / 10).replace('.', ','); }

  /**
   * Причини, що збіглися з вікном, у якому вага вправи не рухалась.
   *
   * @param {object} src {bodyLog, mealLog, sessionLog}
   * @param {string} name назва вправи
   * @param {number} days вікно
   * @returns {{name:string, causes:Array<{id:string, fact:string}>, one:?string}}
   */
  function causesFor(src, name, days, now) {
    const s = src || {};
    const D = window.DateCore;
    const out = { name: String(name || ''), causes: [], one: null };
    if (!D || !out.name) return out;

    const win = Math.max(MIN_WINDOW, Math.round(Number(days) || WINDOW_DAYS));
    const today = now instanceof Date ? now : new Date();
    const toKey = D.keyOf(today);
    const fromKey = D.shiftKey(toKey, -(win - 1));

    /* --- дефіцит --- */
    const e = energyMode({ bodyLog: s.bodyLog, mealLog: s.mealLog }, today);
    if (e && e.mode === 'hold') {
      out.causes.push({
        id: 'deficit',
        fact: 'за ' + e.days + ' днів вага тіла впала на ' + fmtKg(-e.deltaKg) + ' кг' +
              (e.balance !== null ? ' (їли на ' + Math.abs(e.balance) + ' ккал менше за підтримання)' : '') +
              ' — у дефіциті сила так не росте'
      });
    }

    /* --- білок --- */
    const mealKeys = Object.keys(s.mealLog || {}).filter(function (k) {
      return DATE_KEY.test(k) && k >= fromKey && k <= toKey;
    });
    const withTarget = mealKeys.filter(function (k) {
      return Number((s.mealLog[k] || {}).pTarget) > 0;
    });
    if (withTarget.length >= 7) {
      const below = withTarget.filter(function (k) {
        const rec = s.mealLog[k];
        return Number(rec.p) < Number(rec.pTarget) * 0.9;
      });
      if (below.length / withTarget.length >= PROTEIN_MISS_SHARE) {
        const avgP = Math.round(withTarget.reduce(function (a, k) {
          return a + (Number(s.mealLog[k].p) || 0);
        }, 0) / withTarget.length);
        const avgT = Math.round(withTarget.reduce(function (a, k) {
          return a + Number(s.mealLog[k].pTarget);
        }, 0) / withTarget.length);
        out.causes.push({
          id: 'protein',
          fact: 'білок нижче цілі в ' + below.length + ' днях із ' + withTarget.length +
                ' (у середньому ' + avgP + ' г при цілі ' + avgT + ')'
        });
      }
    }

    /* --- пропущені тренування цієї вправи --- */
    let didSessions = 0, anyTraining = 0;
    Object.keys(s.sessionLog || {}).forEach(function (k) {
      if (!DATE_KEY.test(k) || k < fromKey || k > toKey) return;
      const day = s.sessionLog[k];
      if (!day || !Array.isArray(day.ex)) return;
      anyTraining += 1;
      if (day.ex.some(function (r) { return r && r.n === out.name && Number(r.ds) > 0; })) {
        didSessions += 1;
      }
    });
    /* anyTraining — запобіжник від «причини» на порожньому місці. Якщо
       журналу тренувань немає ЗОВСІМ, ми не знаємо, що людина робила, а
       не знаємо, що вона пропускала. Відсутність даних — не доказ. */
    if (anyTraining > 0 && didSessions < MIN_SESSIONS) {
      out.causes.push({
        id: 'missed',
        fact: 'за ' + win + ' днів цю вправу зробили ' + didSessions + ' ' +
              (didSessions === 1 ? 'раз' : 'разів') + ' — це не плато, це пропуски'
      });
    }

    /* --- запас до відмови --- */
    const PC = window.ProgressCore;
    if (PC && typeof PC.rirStats === 'function') {
      const st = PC.rirStats(s.sessionLog, win, today);
      const row = (st.rows || []).filter(function (r) { return r.name === out.name; })[0];
      if (row && row.flag === 'hard') {
        out.causes.push({
          id: 'fatigue',
          fact: row.zero + ' підходів із ' + row.sets + ' доведено до відмови — ' +
                'втома накопичується швидше, ніж сила'
        });
      } else if (row && row.flag === 'light') {
        out.causes.push({
          id: 'light',
          fact: 'середній запас ' + String(row.avg).replace('.', ',') +
                ' — вага не стоїть, вона застара'
        });
      }
    }

    /* Одна причина — називаємо. Дві й більше — показуємо факти, і
       жоден не головний: див. правило однієї причини вгорі файлу. */
    out.one = out.causes.length === 1 ? out.causes[0].id : null;
    return out;
  }

  window.CoachCore = {
    LOSS_PCT_WEEK: LOSS_PCT_WEEK,
    WINDOW_DAYS: WINDOW_DAYS,
    MET_LIFTING: MET_LIFTING,
    energyMode: energyMode,
    trainingKcal: trainingKcal,
    causesFor: causesFor
  };
})();
