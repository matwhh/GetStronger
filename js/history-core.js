/**
 * Ядро історії — чисті функції, без DOM і без сховища.
 *
 * Етап «памʼяті» додає профілю три журнали, і всі три пишуться та
 * читаються ЧЕРЕЗ ЦЕЙ МОДУЛЬ, щоб форма записів не розповзлась по
 * сторінках:
 *
 *   weightLog:  { 'Назва вправи': [ { d:'YYYY-MM-DD', kg:100 }, … ] }
 *               Історія робочих ваг. Append-only: нові записи додаються
 *               в кінець, старі не правляться. Виняток один — повторна
 *               зміна В ТОЙ САМИЙ ДЕНЬ замінює сьогоднішній запис:
 *               десять правок ваги за вечір — це одна зміна, а не десять.
 *
 *   sessionLog: { 'YYYY-MM-DD': { programId, days, dayIdx, title, done, total } }
 *               Виконання плану по днях: який день програми робили і
 *               скільки вправ закрито. Один запис на день.
 *
 *   mealLog:    { 'YYYY-MM-DD': { kcal, p, f, c, fiber, target, meals?, partial? } }
 *               Закриті дні харчування: підсумок дня і ціль, яка діяла
 *               того дня. Ціль зберігається В ЗАПИСІ навмисно: профіль
 *               зміниться, а історія має памʼятати, проти чого їли.
 *               `partial` — швидкий запис: ккал і, може, білок, без
 *               розбору по грамах. Старі записи без прапорця читаються
 *               як повні.
 *               `meals` — знімок позицій (DayCore.freezeMeals), з якого
 *               робиться копія дня. Живе SNAPSHOT_DAYS днів і зникає зі
 *               старих записів: підсумок дня важить сорок байтів, а
 *               позиції — кілограм на рік, і читати їх далі, ніж дотягує
 *               копія, однаково нікому.
 *
 * Це доповнення до вже наявних журналів bodyLog/workLog (journal.js) —
 * форма та сама: ключ — локальна дата, значення — факт.
 */
(function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  /** Локальна дата 'YYYY-MM-DD'. Локальна, не UTC: запис о 23:40
      має лягти в сьогодні, а toISOString поклав би його у завтра. */
  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 3 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function todayKey(d) { return window.DateCore.todayKey(d); }

  /* ------------------------------------------------------------------ */
  /* Робочі ваги                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Додати запис ваги. НЕ мутує вхідний журнал — повертає новий обʼєкт
   * (звичка з решти кодової бази: патчі профілю збираються з копій).
   *
   * @param {object} log     поточний weightLog (може бути null)
   * @param {string} name    назва вправи
   * @param {number} kg      нова вага; null/NaN — запис не додається
   * @param {string} [date]  'YYYY-MM-DD'; за замовчуванням сьогодні
   */
  function appendWeight(log, name, kg, date) {
    const d = DATE_KEY.test(date) ? date : todayKey();
    const n = Number(kg);
    const src = (log && typeof log === 'object') ? log : {};
    if (!name || !Number.isFinite(n) || n < 0) return src;

    const prev = Array.isArray(src[name]) ? src[name] : [];
    const last = prev[prev.length - 1];

    // Та сама вага, що й в останньому записі — не подія, а дотик.
    if (last && Number(last.kg) === n) return src;

    const entry = { d: d, kg: n };
    const next = (last && last.d === d)
      ? prev.slice(0, -1).concat([entry])   // сьогоднішня правка сьогоднішнього
      : prev.concat([entry]);

    const out = Object.assign({}, src);
    out[name] = next;
    return out;
  }

  /** Скинути вагу вправи (видалили з плану). Історія ЛИШАЄТЬСЯ:
      видалення вправи з плану не стирає того, що було піднято. */
  function weightSeries(log, name) {
    const arr = log && Array.isArray(log[name]) ? log[name] : [];
    return arr.filter(function (e) {
      return e && DATE_KEY.test(e.d) && Number.isFinite(Number(e.kg));
    });
  }

  /** Дельта по вправі: перший запис, останній, різниця */
  function weightDelta(log, name) {
    const s = weightSeries(log, name);
    if (s.length < 1) return null;
    const first = s[0], last = s[s.length - 1];
    return {
      first: Number(first.kg), firstDate: first.d,
      last: Number(last.kg), lastDate: last.d,
      delta: Math.round((Number(last.kg) - Number(first.kg)) * 10) / 10,
      count: s.length
    };
  }

  /**
   * Вправи журналу, посортовані за давністю останньої зміни (свіже — вище).
   * Саме цей порядок потрібен сторінці прогресу: «що рухалось нещодавно».
   */
  function weightNames(log) {
    if (!log || typeof log !== 'object') return [];
    return Object.keys(log)
      .filter(function (n) { return weightSeries(log, n).length > 0; })
      .sort(function (a, b) {
        const la = weightSeries(log, a), lb = weightSeries(log, b);
        return lb[lb.length - 1].d < la[la.length - 1].d ? -1 : 1;
      });
  }

  /**
   * SVG-шлях спарклайна по серії записів. Чиста геометрія: жодного DOM,
   * тому тестується як звичайна функція.
   * Повертає '' для порожніх/одноточкових серій — крапку малює сторінка.
   */
  function sparklinePath(series, width, height, pad) {
    const s = Array.isArray(series) ? series : [];
    if (s.length < 2) return '';
    const p = Number.isFinite(pad) ? pad : 2;
    const xs = s.map(function (e) { return new Date(e.d + 'T00:00:00').getTime(); });
    const ys = s.map(function (e) { return Number(e.kg); });
    const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const spanX = (x1 - x0) || 1;
    const spanY = (y1 - y0) || 1;

    return s.map(function (e, i) {
      const x = p + (xs[i] - x0) / spanX * (width - p * 2);
      // y інвертований: більша вага — вище
      const y = y1 === y0
        ? height / 2
        : p + (1 - (ys[i] - y0) / spanY) * (height - p * 2);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Сесії тренувань                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Записати/оновити сесію дня. Один запис на дату: друге тренування
   * того самого дня оновлює прогрес, а не плодить дублікати.
   */
  function upsertSession(log, date, session) {
    const src = (log && typeof log === 'object') ? log : {};
    const d = DATE_KEY.test(date) ? date : todayKey();
    if (!session || typeof session !== 'object') return src;

    const out = Object.assign({}, src);
    const prev = (src[d] && typeof src[d] === 'object') ? src[d] : {};
    out[d] = {
      programId: String(session.programId || ''),
      days: Number(session.days) || 0,
      dayIdx: Number(session.dayIdx) || 0,
      title: String(session.title || '').slice(0, 60),
      done: Math.max(0, Math.round(Number(session.done) || 0)),
      total: Math.max(0, Math.round(Number(session.total) || 0))
    };

    /*
     * Факти сесії, зняті В МОМЕНТ тренування — історія як незмінний
     * знімок: пізніші правки плану чи ваг цих чисел не переписують.
     *
     *   t0/t1 — час першої та останньої дії (epoch ms): з них сторінка
     *           прогресу рахує тривалість тренування;
     *   sets/reps — підходи й повторення закритих вправ за схемою дня;
     *   vol  — оцінка тоннажу: підходи × середина діапазону повторень ×
     *          робоча вага, що діяла в день сесії.
     *
     * t0 пише перший запис і далі НЕ перетирається: початок тренування
     * один. Решта оновлюється з кожною галочкою. Старі записи цих полів
     * не мають — аналітика чесно каже «замало даних», а не вигадує.
     *
     * БУЛО: `Number(session.t0) || Number(prev.t0)`. Виглядає як «візьми
     * новий, інакше старий», але js/workout.js кладе t0 = Date.now() у
     * КОЖЕН запис — а їх за тренування десятки, по одному на галочку.
     * Тобто перший операнд ніколи не порожній, prev.t0 не читався жодного
     * разу, і початок сесії щоразу переписувався поточним часом. У підсумку
     * t0 завжди дорівнював t1: у журналі стояло «Час: 17:27 → 17:27», а
     * ProgressCore.sessionMinutes повертав null (він вимагає t1 > t0) —
     * тобто вся статистика тривалості тренувань була мертва й показувала
     * «замало даних» назавжди.
     *
     * Тепер беремо НАЙРАНІШИЙ із двох, а не «перший непорожній». Мінімум,
     * а не «prev виграє»: черга збережень може доставити запис із меншим
     * часом пізніше, та й імпорт резервної копії не має зсувати початок
     * уперед.
     */
    const tNew = Number(session.t0) || 0;
    const tOld = Number(prev.t0) || 0;
    const t0 = (tNew > 0 && tOld > 0) ? Math.min(tNew, tOld) : (tOld || tNew);
    /*
     * t1 симетрично: кінець сесії рухається тільки ВПЕРЕД. Тут теж
     * prev не читався зовсім — `Number(session.t1) || 0`, — тож запис,
     * доставлений чергою збережень не по порядку, відкочував кінець
     * назад. Тест «запис, що прийшов не по порядку» ловить саме це.
     */
    const t1 = Math.max(Number(session.t1) || 0, Number(prev.t1) || 0);
    if (t0 > 0) out[d].t0 = t0;
    if (t1 > 0) out[d].t1 = Math.max(t1, t0);
    ['sets', 'reps', 'vol', 'doneSets', 'totalSets'].forEach(function (k) {
      const v = Number(session[k]);
      if (Number.isFinite(v) && v >= 0) out[d][k] = Math.round(v);
      else if (Number.isFinite(Number(prev[k]))) out[d][k] = Number(prev[k]);
    });

    /*
     * Етап «завершення тренування» додає записові дві речі:
     *
     *   end — сесію закрито кнопкою. Ставиться раз і не знімається:
     *         завершене тренування не «розвершується» пізнішим дописом.
     *   ex  — знімок вправ у момент тренування: назва, закриті/планові
     *         підходи, вага й повтори кожного підходу (s), а також
     *         зведені kg/r для сумісності зі старими читачами.
     *         Це сировина аналітики прогресу; пишеться санітизованою,
     *         бо історію читатимуть графіки, а не тільки люди.
     */
    if (session.end || prev.end) out[d].end = 1;
    const exSrc = Array.isArray(session.ex) ? session.ex
                : Array.isArray(prev.ex) ? prev.ex : null;
    if (exSrc) {
      out[d].ex = exSrc.slice(0, 30).map(function (e) {
        const row = {
          n: String((e && e.n) || '').slice(0, 60),
          ds: Math.min(10, Math.max(0, Math.round(Number(e && e.ds) || 0))),
          ps: Math.min(10, Math.max(0, Math.round(Number(e && e.ps) || 0)))
        };
        const kg = Number(e && e.kg);
        if (Number.isFinite(kg) && kg >= 0 && kg <= 500) row.kg = kg;
        const r = Number(e && e.r);
        if (Number.isFinite(r) && r > 0 && r <= 50) row.r = r;

        /* s — вага й повтори КОЖНОГО виконаного підходу. kg/r лишаються
           поруч навмисне: графіки за періоди до цього релізу знають лише
           «одна вага на вправу», і викидати їх означало б обірвати
           історію на даті релізу. Довжина обрізається планом (ds), бо
           більше підходів, ніж закрито, у знімку бути не може. */
        if (Array.isArray(e && e.s) && row.ds > 0) {
          const sets = e.s.slice(0, row.ds).map(function (x) {
            const o = {};
            const w = Number(x && x.w);
            if (Number.isFinite(w) && w >= 0 && w <= 500) o.w = Math.round(w * 2) / 2;
            const rr = Number(x && x.r);
            if (Number.isFinite(rr) && rr >= 1 && rr <= 200) o.r = Math.round(rr);
            return o;
          });
          if (sets.length) row.s = sets;
        }
        return row;
      }).filter(function (e) { return e.n && e.ps > 0; });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Закриті дні харчування                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Підсумок дня для mealLog. Округлення тут, а не в рендері: історія
   * зберігає те, що показувалось людині, а не сирі дроби.
   * target може бути null — день без порахованої норми теж день.
   */
  function summarizeDay(totals, targetKcal, targetProtein) {
    const t = totals || {};
    const out = {
      kcal: Math.round(Number(t.kcal) || 0),
      p: Math.round(Number(t.p) || 0),
      f: Math.round(Number(t.f) || 0),
      c: Math.round(Number(t.c) || 0),
      fiber: Math.round(Number(t.fiber) || 0)
    };
    const tk = Math.round(Number(targetKcal));
    if (Number.isFinite(tk) && tk > 0) out.target = tk;
    /*
     * Цільовий білок дня — записується разом із калорійною ціллю.
     *
     * Раніше його не було ніде, і сервер ELO отримував proteinTarget із
     * запиту. Клієнт брав його з NutritionCalc, який підключений лише на
     * пʼятьох сторінках із сімнадцяти: той самий день коштував 7 або 4 ELO
     * залежно від того, з якої сторінки прийшов сабміт. Тепер ціль стоїть
     * у самому записі — один день, одне число, незалежно від сторінки.
     */
    const tp = Math.round(Number(targetProtein));
    if (Number.isFinite(tp) && tp > 0) out.pTarget = tp;
    return out;
  }

  /*
   * Скільки останніх закритих днів тримають знімок позицій.
   *
   * Те саме число, що й глибина списку джерел у копії дня: тримати знімок
   * довше, ніж до нього можна дотягнутись, — це платити памʼяттю профілю
   * за те, чого ніхто не побачить. Чотирнадцять днів — це два тижні, тобто
   * «той самий день минулого тижня» дістається завжди.
   */
  const SNAPSHOT_DAYS = 14;

  /**
   * Закрити день: повертає НОВИЙ mealLog із записом за дату.
   *
   * @param {object} log поточний mealLog
   * @param {string} date локальна дата дня
   * @param {object} totals підсумок дня
   * @param {number|null} targetKcal ціль калорій ТОГО дня
   * @param {number|null} targetProtein ціль білка ТОГО дня
   * @param {Array} [frozenMeals] знімок позицій (DayCore.freezeMeals)
   */
  function closeDay(log, date, totals, targetKcal, targetProtein, frozenMeals) {
    const src = (log && typeof log === 'object') ? log : {};
    const d = DATE_KEY.test(date) ? date : todayKey();
    const out = Object.assign({}, src);
    out[d] = summarizeDay(totals, targetKcal, targetProtein);
    if (Array.isArray(frozenMeals) && frozenMeals.length) out[d].meals = frozenMeals;
    return pruneSnapshots(out);
  }

  /**
   * Швидкий запис дня: тільки калорії і, якщо людина знає, білок.
   *
   * Навіщо це взагалі. Раніше день був або розібраний по грамах, або
   * порожній. Ресторан, гості, чужа кухня — і день лишався порожнім, а
   * порожній день для будь-якої аналітики означає «не їв», що просто
   * неправда: середнє спожите просідало, і витрати виходили завищеними.
   * Приблизне число — не «менш точні дані», а єдині правдиві.
   *
   * Жир і вуглеводи НЕ питаються і не вгадуються: записати сюди нуль
   * означало б сказати, що людина не їла жиру, а вгадати — вигадати
   * число, яке потім рахується як факт. Тому в записі вони нулі, а сам
   * запис позначений partial, і кожен, хто його читає, це бачить.
   *
   * @param {object} log поточний mealLog
   * @param {string} date локальна дата дня
   * @param {number} kcal калорії за день
   * @param {number|null} protein білок, якщо відомий
   * @param {number|null} targetKcal ціль калорій ТОГО дня
   * @param {number|null} targetProtein ціль білка ТОГО дня
   */
  function quickDay(log, date, kcal, protein, targetKcal, targetProtein) {
    const src = (log && typeof log === 'object') ? log : {};
    const k = Math.round(Number(kcal));
    /* Нуль калорій — це не швидкий запис, а порожнє поле. Писати його
       означало б створити день «зʼїв нуль», який потім тягне середнє. */
    if (!Number.isFinite(k) || k <= 0) return src;

    const d = DATE_KEY.test(date) ? date : todayKey();
    const p = Math.round(Number(protein));
    const out = Object.assign({}, src);
    /* Запис створюється З НУЛЯ, а не доливається в наявний: інакше
       швидкий запис поверх розібраного дня лишив би по собі його жири,
       вуглеводи і знімок позицій — тобто збрехав би точністю. */
    const entry = summarizeDay(
      { kcal: k, p: (Number.isFinite(p) && p > 0) ? p : 0 }, targetKcal, targetProtein);
    entry.partial = true;
    out[d] = entry;
    return pruneSnapshots(out);
  }

  /**
   * Чи цей день дає білковий день для якості харчування.
   *
   * Правило живе ТУТ, бо про форму запису знає цей модуль. Швидкий запис
   * без білка — це не «нуль білка», це «невідомо»; рахувати його як нуль
   * означало б занижувати білкову частку рейтингу за кожен ресторан.
   * Повний запис рахується завжди, навіть із нулем: там нуль — виміряний.
   */
  function countsProtein(entry) {
    if (!entry || typeof entry !== 'object') return false;
    return entry.partial !== true || Number(entry.p) > 0;
  }

  /**
   * Прибрати знімки позицій зі старих записів, лишивши підсумки.
   *
   * Викликається на кожному закритті, а не «колись потім»: прибирання, що
   * запускається окремою кнопкою, не запускається ніколи.
   */
  function pruneSnapshots(log) {
    if (!log || typeof log !== 'object') return log;
    const withMeals = Object.keys(log)
      .filter(function (k) { return DATE_KEY.test(k) && log[k] && log[k].meals; })
      .sort();
    if (withMeals.length <= SNAPSHOT_DAYS) return log;

    const out = Object.assign({}, log);
    withMeals.slice(0, withMeals.length - SNAPSHOT_DAYS).forEach(function (k) {
      const copy = Object.assign({}, out[k]);
      delete copy.meals;
      out[k] = copy;
    });
    return out;
  }

  /**
   * Дні, з яких можна скопіювати раціон: новіші — першими.
   *
   * Тільки ті, де знімок позицій справді є. Показувати в списку джерел
   * день, із якого скопіюється порожньо, — це обіцянка, яку копія не
   * виконає: до знімків історія тримала лише підсумки, тож такі дні в
   * mealLog є і будуть.
   */
  function copySources(log, limit) {
    if (!log || typeof log !== 'object') return [];
    const n = Math.max(1, limit || SNAPSHOT_DAYS);
    return Object.keys(log)
      .filter(function (k) {
        const e = log[k];
        return DATE_KEY.test(k) && e && Array.isArray(e.meals) &&
          e.meals.some(function (m) { return m && Array.isArray(m.items) && m.items.length; });
      })
      .sort()
      .reverse()
      .slice(0, n)
      .map(function (k) { return { d: k, v: log[k] }; });
  }

  /** Останні N датованих записів будь-якого журналу-мапи, нові — першими */
  function lastEntries(log, n) {
    if (!log || typeof log !== 'object') return [];
    return Object.keys(log)
      .filter(function (k) { return DATE_KEY.test(k); })
      .sort()
      .slice(-Math.max(1, n || 7))
      .reverse()
      .map(function (k) { return { d: k, v: log[k] }; });
  }

  window.HistoryCore = {
    todayKey: todayKey,
    appendWeight: appendWeight,
    weightSeries: weightSeries,
    weightDelta: weightDelta,
    weightNames: weightNames,
    sparklinePath: sparklinePath,
    upsertSession: upsertSession,
    closeDay: closeDay,
    quickDay: quickDay,
    countsProtein: countsProtein,
    SNAPSHOT_DAYS: SNAPSHOT_DAYS,
    pruneSnapshots: pruneSnapshots,
    copySources: copySources,
    lastEntries: lastEntries
  };
})();
