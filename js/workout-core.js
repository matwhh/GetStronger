/**
 * Ядро тренувального дня — спільне для «Сьогодні» й сторінки тренування.
 *
 * НАВІЩО ОКРЕМИЙ МОДУЛЬ. Тренування переїхало з головної на власну
 * сторінку, але головній однаково треба знати, ЩО заплановано й скільки
 * закрито — інакше картка-вхід не могла б показати «3 з 8». Без спільного
 * ядра ці кілька функцій довелося б тримати у двох файлах, а вони
 * визначають, який саме день вважається сьогоднішнім: розійшлись би —
 * і два екрани показували б різні тренування.
 *
 * ЩО ТУТ Є. Розвʼязання плану (яка програма, які вправи), денний стан
 * (який день обрано, які галочки стоять) і час відпочинку за типом вправи.
 * DOM тут немає взагалі.
 *
 * ПРО localStorage. Денний стан лежить у 'forge.today', і цей модуль —
 * його ЄДИНИЙ власник: і читання, і запис. Це не порушення правила «ядра
 * без побічних ефектів», а його зворотний бік — ключ має рівно одне
 * місце, яке знає його формат. Профіль (історія сесій, ваги) сюди не
 * пишеться: він іде через Store зі сторінок.
 */
(function () {
  'use strict';

  const LS_TODAY = 'forge.today';

  /** Локальна дата 'YYYY-MM-DD'. Локальна, не UTC: запис о 23:40 має
      лягти в сьогодні, а toISOString поклав би його у завтра. */
  /* Делегат: єдина реалізація — js/date-core.js. Тут лишається лише
     імʼя, щоб не переписувати 1 місць виклику. Чому одна: копії
     цієї функції встигли розійтись у сімох файлах (див.
     docs/audit/2026-09-12/AUDIT.md). */
  function todayKey(d) { return window.DateCore.todayKey(d); }

  /** Ключ 'programId:days' — той самий, що в programs.js */
  function planKey(programId, days) { return String(programId) + ':' + String(days); }

  function activeKey(profile) {
    const a = (profile && profile.activePlan) || {};
    return planKey(a.programId || '', Number(a.days) || 0);
  }

  /**
   * План на сьогодні: власна копія з профілю, інакше базовий план програми.
   *
   * Джерело одне (profile.customPlans + PROGRAMS), тому «Мій план тренувань»,
   * «Сьогодні» й сторінка тренування завжди показують однакові вправи.
   * Дня тижня тут немає й не буде: який день робити — вирішує людина,
   * а підказку дає nextDayIdx() нижче.
   */
  function resolvePlan(profile, programs) {
    const a = profile && profile.activePlan;
    if (!a || !a.programId) return null;
    const list = programs || window.PROGRAMS || [];
    const program = list.find(function (p) { return p.id === a.programId; });
    if (!program) return null;
    /*
     * СТАТЬ — тут, а не лише в розмітці сторінки вибору.
     *
     * Через resolvePlan проходять «Сьогодні», «Тренування» і «Мій план тренувань»,
     * тож це вузьке місце для всіх трьох. Без перевірки саме тут план
     * чужої статі лишався б робочим у збереженому activePlan: людина
     * змінила стать у налаштуваннях — а тренування далі відкривається
     * старе. Правило одне для всіх (js/programs-data.js).
     */
    const allowed = window.programAllowedFor;
    if (typeof allowed === 'function' && !allowed(program, profile && profile.sex)) return null;
    const days = String(Number(a.days) || 3);
    const custom = (profile.customPlans || {})[planKey(a.programId, days)];
    const raw = custom || (program.days && program.days[days]);
    if (!Array.isArray(raw) || !raw.length) return null;

    /*
     * ДЕНЬ БЕЗ exercises — ЦЕ ДЕНЬ БЕЗ ВПРАВ, А НЕ ПАДІННЯ (WEB-012).
     *
     * customPlans редагується імпортом і живе в localStorage; день, у
     * якого масив вправ лежить під іншим іменем поля або відсутній,
     * давав TypeError «Cannot read properties of undefined (reading
     * map)» — і три сторінки (plan, programs, workout) лишались
     * порожніми, самі себе не лікуючи. Нормалізуємо ОДИН раз тут: через
     * resolvePlan проходять усі три.
     */
    const plan = raw.map(function (day) {
      const d = (day && typeof day === 'object') ? day : {};
      return Object.assign({}, d, {
        exercises: Array.isArray(d.exercises) ? d.exercises : []
      });
    });
    /* Діапазони повторень — похідне від стажу (js/reps-core.js), а не
       поле даних: перераховуються на кожному завантаженні плану. */
    const RC = window.RepsCore;
    return { program: program, plan: RC ? RC.applyPlan(plan, profile.trainingAge) : plan };
  }

  function clampDay(i, planLen) {
    const n = Number(planLen) || 0;
    if (!n) return 0;
    return Math.min(n - 1, Math.max(0, Number(i) || 0));
  }

  /** Час відпочинку за типом вправи — те саме правило, що на «Моєму плані» */
  function restSecFor(ex) {
    if (String((ex && ex.rest) || '').trim() === '—') return 20;
    if (window.liftKind && window.liftKind(ex) !== 'compound') return 120;
    const main = window.primaryMuscle ? window.primaryMuscle(ex) : null;
    const m = (window.MUSCLES || []).find(function (x) { return x.id === main; });
    return (m && m.size === 'large') ? 180 : 120;
  }

  /* ------------------------------------------------------------------ */
  /* Підходи і тривалість                                                */
  /* ------------------------------------------------------------------ */
  /*
   * З етапу «завершення тренування» done[i] — ЧИСЛО закритих підходів
   * вправи i, а не булева галочка. Стара форма (true/false) читається як
   * «всі підходи»/«жодного»: 'forge.today' живе один день, тож легасі
   * зникає саме собою, а перехідний день не втрачає прогресу.
   */

  /* Ті самі числа, що в оцінці тривалості на «Моєму плані» (js/programs.js):
     два джерела з різними константами показували б людині два різні часи. */
  const SET_WORK_SEC = 40;
  const WARMUP_MIN = 10;

  /** Скільки підходів заплановано у вправі: ціле 0..10 */
  function plannedSets(ex) {
    const n = Math.round(Number(ex && ex.sets) || 0);
    return Math.min(10, Math.max(0, n));
  }

  /** Закриті підходи з запису денного стану, обрізані до плану */
  function doneSetsFor(entry, planned) {
    if (Array.isArray(entry)) return Math.min(planned, entry.length);
    if (entry === true) return planned;
    const n = Math.round(Number(entry) || 0);
    return Math.min(planned, Math.max(0, n));
  }

  /* ------------------------------------------------------------------ */
  /* Фактично виконані підходи                                           */
  /* ------------------------------------------------------------------ */
  /*
   * ПЛАНОВА ВАГА ≠ ФАКТИЧНА. Робоча вага у книзі (profile.weights) — це
   * те, що людина СОБІ ЗАПЛАНУВАЛА, і вона одна на вправу. Реальний
   * підхід має власну вагу: перший на 100, третій на 80 — це нормальне
   * тренування, а не помилка вводу.
   *
   * Тому денний стан тримає МАСИВ виконаних підходів, а не лічильник:
   *
   *   done[i] = [ {w:100, r:8}, {w:90, r:8} ]   ← нова форма
   *   done[i] = 2                                ← легасі: два підходи
   *   done[i] = true                             ← ще старіше: всі підходи
   *
   * Кожен запис створюється В МОМЕНТ тапу і фіксує вагу та повтори станом
   * на цю мить. Пізніша зміна робочої ваги його НЕ переписує — саме через
   * це раніше дроп-сет («перший на 100, далі на 90») лягав в історію як
   * «усі на 90»: знімок збирався з поточної книги ваг на кожен дотик.
   */

  /**
   * Вага підходу: скінченна, 0..500. Ті самі межі, що в книзі ваг.
   *
   * null, '' і порожній масив — це «ваги немає» (планка, прес), а НЕ
   * нуль: Number(null) дає 0, і без цієї перевірки вправа без ваги
   * діставала б чесний на вигляд 0 кг у кожному підході.
   */
  function normWeight(v) {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 500) return null;
    return Math.round(n * 2) / 2;   // крок 0,5 кг, як усюди
  }

  /** Повтори підходу: ціле 1..200; поза межами — «не задано». */
  function normReps(v) {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 200) return null;
    return Math.round(n);
  }

  /* Делегат: єдина реалізація — js/reps-core.js. Стеля RIR вирішується
     там (RIR_MAX = 5, і причина описана поруч із нею), і другої копії
     цього правила бути не може. reps-core підключений перед цим файлом
     на всіх чотирьох сторінках, які беруть workout-core. */
  function normRir(v) { return window.RepsCore.normRir(v); }

  /**
   * Виконані підходи вправи як масив {w, r}.
   * Легасі-форми (число, true) розгортаються у стільки ж підходів із
   * підставленими значеннями — історія від зміни формату не втрачається.
   *
   * @param entry    done[i] у будь-якій формі
   * @param planned  скільки підходів заплановано (стеля)
   * @param fbW      вага для підстановки (робоча вага вправи)
   * @param fbR      повтори для підстановки (середина діапазону плану)
   */
  function performedSets(entry, planned, fbW, fbR) {
    const cap = Math.max(0, Math.round(Number(planned) || 0));
    const w0 = normWeight(fbW);
    const r0 = normReps(fbR);
    const fill = function () {
      const o = {};
      if (w0 !== null) o.w = w0;
      if (r0 !== null) o.r = r0;
      return o;
    };

    if (Array.isArray(entry)) {
      return entry.slice(0, cap).map(function (e) {
        if (!e || typeof e !== 'object') return fill();
        const o = {};
        const w = normWeight(e.w);
        const r = normReps(e.r);
        /* null означає «успадковано»: у підході, який не редагували,
           лишається значення, підставлене в момент тапу. */
        if (w !== null) o.w = w; else if (w0 !== null) o.w = w0;
        if (r !== null) o.r = r; else if (r0 !== null) o.r = r0;
        /* А ось RIR НЕ успадковується — ні з плану, ні з сусіда. Вага,
           підставлена з книги, чесна: вона справді стоїть на штанзі.
           Запас до відмови, підставлений із плану, був би вигадкою —
           план каже «зупинись за два», а людина могла піти до нуля.
           Тому підхід, де числа не ввели, лишається без нього, і
           аналітика рахує тільки введені. */
        const q = normRir(e.q);
        if (q !== null) o.q = q;
        return o;
      });
    }

    const n = (entry === true) ? cap
      : Math.min(cap, Math.max(0, Math.round(Number(entry) || 0)));
    const out = [];
    for (let k = 0; k < n; k++) out.push(fill());
    return out;
  }

  /**
   * Виставити КІЛЬКІСТЬ закритих підходів, зберігши вже зафіксовані.
   *
   * Це єдина точка, через яку тап по кружечку міняє денний стан. Ріст —
   * дописує нові записи з поточною робочою вагою й повторами плану;
   * відкат — відрізає хвіст. Уже наявні записи НЕ переписуються: у цьому
   * весь сенс — вага підходу належить підходу, а не вправі.
   *
   * @returns масив {w, r} довжини n (нова форма done[i])
   */
  function setDoneSets(entry, n, planned, fbW, fbR) {
    const cap = Math.max(0, Math.round(Number(planned) || 0));
    const want = Math.min(cap, Math.max(0, Math.round(Number(n) || 0)));
    const cur = performedSets(entry, cap, fbW, fbR);
    if (want <= cur.length) return cur.slice(0, want);

    const w0 = normWeight(fbW);
    const r0 = normReps(fbR);
    const out = cur.slice();
    while (out.length < want) {
      const o = {};
      if (w0 !== null) o.w = w0;
      if (r0 !== null) o.r = r0;
      out.push(o);
    }
    return out;
  }

  /**
   * Правка одного підходу: вага і/або повтори. Порожній рядок ('' чи
   * null) означає «прибрати значення», а не «нуль», інакше очищене поле
   * ваги перетворювало б підхід на 0 кг у тоннажі.
   *
   * @returns новий масив done[i]; поза межами — повертає вхід без змін
   */
  function editSet(entry, idx, patch, planned, fbW, fbR) {
    const cur = performedSets(entry, planned, fbW, fbR);
    const k = Math.round(Number(idx) || 0);
    if (!(k >= 0 && k < cur.length)) return cur;
    const rec = Object.assign({}, cur[k]);
    /* Порожнє чи неприйнятне значення повертає підхід до робочої ваги,
       а не лишає дірку: дірку все одно заповнив би performedSets при
       наступному читанні, і поле показувало б не те, що записано. */
    if (patch && 'w' in patch) {
      const w = normWeight(patch.w);
      const fb = normWeight(fbW);
      if (w !== null) rec.w = w;
      else if (fb !== null) rec.w = fb;
      else delete rec.w;
    }
    if (patch && 'r' in patch) {
      const r = normReps(patch.r);
      const fb = normReps(fbR);
      if (r !== null) rec.r = r;
      else if (fb !== null) rec.r = fb;
      else delete rec.r;
    }
    /* RIR без підстановки: порожнє поле означає «числа немає», а не
       «візьми з плану» (див. коментар у performedSets). Нуль сюди
       доходить нулем — normRir віддає null лише на порожнє й сміття. */
    if (patch && 'q' in patch) {
      const q = normRir(patch.q);
      if (q !== null) rec.q = q; else delete rec.q;
    }
    const out = cur.slice();
    out[k] = rec;
    return out;
  }

  /**
   * Підсумок дня: закриті/усі підходи і закриті/усі вправи.
   * Вправа «закрита», коли закриті ВСІ її підходи.
   */
  function dayStats(day, done) {
    const d = Array.isArray(done) ? done : [];
    const out = { doneSets: 0, totalSets: 0, doneEx: 0, totalEx: 0 };
    ((day && day.exercises) || []).forEach(function (ex, i) {
      const ps = plannedSets(ex);
      if (!ps) return;
      const ds = doneSetsFor(d[i], ps);
      out.totalSets += ps;
      out.doneSets += ds;
      out.totalEx += 1;
      if (ds >= ps) out.doneEx += 1;
    });
    return out;
  }

  /**
   * Оцінка тривалості дня, хвилин. Без done — повний день, і формула
   * ДЗЕРКАЛИТЬ js/programs.js → dayMinutes(): підхід + відпочинок за
   * кожен підхід, мінус відпочинок після найостаннішого (після нього
   * йдуть додому), плюс розминка. З done — залишок: та сама арифметика
   * по НЕзакритих підходах; розминка рахується, лише поки не зроблено
   * жодного підходу — хто вже працює, той уже розім'явся.
   */
  function dayMinutes(day, done) {
    const d = Array.isArray(done) ? done : [];
    let sec = 0, lastRest = 0, anyDone = false, anyLeft = false;
    ((day && day.exercises) || []).forEach(function (ex, i) {
      const ps = plannedSets(ex);
      if (!ps) return;
      const ds = doneSetsFor(d[i], ps);
      if (ds > 0) anyDone = true;
      const rem = ps - ds;
      if (rem <= 0) return;
      const rest = restSecFor(ex);
      sec += rem * (SET_WORK_SEC + rest);
      lastRest = rest;
      anyLeft = true;
    });
    if (!anyLeft) return 0;
    return Math.round(Math.max(0, sec - lastRest) / 60) + (anyDone ? 0 : WARMUP_MIN);
  }

  /* ------------------------------------------------------------------ */
  /* Тиждень і завершені сесії                                           */
  /* ------------------------------------------------------------------ */

  /** 'YYYY-MM-DD' + n днів, у локальному календарі */
  /* Делегат: єдина реалізація — js/date-core.js. */
  function addDaysKey(key, n) {
    return window.DateCore.shiftKey(key, n) || key;
  }

  /**
   * Понеділок тижня, якому належить дата. Локальний календар — той самий,
   * яким підписані всі журнали профілю, і те саме визначення тижня
   * (ISO, пн–нд), яким сервер ELO оцінює недобори: два різні «тижні»
   * означали б, що блокування і штрафи розходяться.
   */
  function weekStartKey(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return key;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return addDaysKey(key, -((d.getDay() + 6) % 7));
  }

  /** Запис сесії за дату, або null */
  function sessionFor(profile, key) {
    const s = profile && profile.sessionLog && profile.sessionLog[key];
    return (s && typeof s === 'object') ? s : null;
  }

  /** Сьогоднішня ЗАВЕРШЕНА сесія (кнопкою), або null */
  function completedToday(profile, key) {
    const s = sessionFor(profile, key);
    return (s && s.end) ? s : null;
  }

  /**
   * Завершені цього тижня дні АКТИВНОГО плану: {dayIdx: 'YYYY-MM-DD'}.
   * Джерело — sessionLog у профілі, тому блокування переживає refresh,
   * повторний вхід і зміну пристрою, а нового тижня чекає саме собою:
   * у понеділок вікно пошуку зсувається — і все знову доступне.
   */
  function completedThisWeek(profile, key) {
    const out = {};
    const log = profile && profile.sessionLog;
    if (!log || typeof log !== 'object') return out;
    const mine = activeKey(profile);
    const ws = weekStartKey(key);
    const we = addDaysKey(ws, 6);
    Object.keys(log).forEach(function (d) {
      if (d < ws || d > we) return;
      const s = log[d];
      if (!s || typeof s !== 'object' || !s.end) return;
      if (planKey(s.programId, s.days) !== mine) return;
      out[Number(s.dayIdx) || 0] = d;
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Денний стан                                                         */
  /* ------------------------------------------------------------------ */

  function rawDay() {
    try { return JSON.parse(localStorage.getItem(LS_TODAY)); }
    catch (_) { return null; }
  }

  /**
   * Стан сьогоднішнього дня: {dayIdx, done, fresh}.
   *
   * fresh=true означає, що записаного стану на сьогодні немає й dayIdx —
   * це ПІДКАЗКА (наступний день після минулого), а не вибір людини.
   * Головна показує її так само, як сторінка тренування, тож обидві
   * пропонують один і той самий день.
   */
  function readDay(profile, key, planLen) {
    const raw = rawDay();
    const mine = raw && raw.plan === activeKey(profile);

    if (mine && raw.date === key) {
      return {
        dayIdx: clampDay(raw.dayIdx, planLen),
        /* Значення лишаються як є: числа підходів (нова форма) або булеві
           (легасі-день) — їх нормалізує doneSetsFor у момент читання. */
        done: Array.isArray(raw.done) ? raw.done.slice() : [],
        fresh: false
      };
    }

    /*
     * Новий день: пропонуємо НАСТУПНИЙ день плану після того, що робили
     * востаннє. Це не історія й не календар — лише підказка, з якої
     * картки почати; перемкнути можна одним дотиком.
     */
    const lastIdx = mine ? Number(raw.dayIdx) : -1;
    return {
      dayIdx: Number.isInteger(lastIdx) && lastIdx >= 0
        ? clampDay((lastIdx + 1) % planLen, planLen) : 0,
      done: [],
      fresh: true
    };
  }

  /**
   * Записати денний стан. Повертає false, якщо не вдалося.
   *
   * Раніше виняток ковтався мовчки (LOC-002): при переповненому сховищі
   * запис не відбувався, а сторінка далі показувала галочки, яких у
   * сховищі немає. У ту саму мить Store.saveProfile чесно кидав помилку —
   * тобто половина стану тренування скаржилась, а половина мовчала.
   * Ковтати виняток тут і далі правильно (показ важливіший за памʼять),
   * а от мовчати про це — ні: рішення за тим, хто викликає.
   *
   * @returns {boolean} true, якщо стан справді записано
   */
  function writeDay(profile, key, dayIdx, done) {
    try {
      localStorage.setItem(LS_TODAY, JSON.stringify({
        date: key,
        plan: activeKey(profile),
        dayIdx: dayIdx,
        done: done
      }));
      return true;
    } catch (_) { return false; }
  }

  /* ------------------------------------------------------------------ */
  /* РОЗМИНКА                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Сходинки розминки у відсотках від робочої ваги.
   *
   * Один перелік на весь сайт. Три сходинки, а не пʼять: розминка має
   * підготувати, а не втомити, і кожен зайвий підхід у ній — це підхід,
   * знятий із робочих.
   */
  var WARMUP_PCT = [45, 65, 85];

  /*
   * ДРАБИНА — ТАБЛИЦЯ, А НЕ ФОРМУЛА.
   *
   * Розтягнути ті самі 40–80 % на будь-яку кількість сходинок можна
   * одним рядком арифметики, але на двох підходах це дало б 40 і 80 %:
   * стрибок удвічі саме там, де сходинок найменше й кожна має бути
   * пологішою. Тому кожній кількості — свій ряд, підібраний під те, як
   * входять у робочу вагу, а не під рівність проміжків.
   *
   * П'ять — стеля: далі розминка починає забирати сили в самої вправи.
   * Нуль — теж відповідь: ізоляцію в кінці тренування розминають уже
   * зробленими перед нею вправами.
   */
  var WARMUP_LADDER = {
    0: [],
    1: [60],
    2: [50, 70],
    3: WARMUP_PCT,
    4: [40, 55, 70, 85],
    5: [35, 50, 65, 80, 90]
  };

  /*
   * ВІДСОТКИ Й ПОВТОРИ — З ОПУБЛІКОВАНОГО ПРОТОКОЛУ.
   *
   * Перша версія цієї таблиці була складена «на око», і на трьох
   * сходинках давала 40/60/80. Тепер 1 → 60; 2 → 50/70; 3 → 45/65/85 —
   * як у Warm Up Protocol Джеффа Ніппарда, на чий канал сайт і посилає
   * по техніку виконання. Своє число проти чужого опублікованого —
   * програє за визначенням.
   *
   * Повторів тут раніше не було СВІДОМО: вигадане число поруч із
   * порахованою вагою видавало б здогад за розрахунок. Тепер джерело те
   * саме, що й для відсотків: чим важча сходинка, тим менше повторень —
   * розминка має підготувати, а не втомити.
   *
   * Чотири й пʼять сходинок протокол не описує: там продовжено ту саму
   * логіку спадання. Тому це таблиця, а не формула — домальоване видно
   * окремо від узятого з джерела.
   */
  var WARMUP_REPS = {
    0: [],
    1: ['6–10'],
    2: ['6–10', '4–6'],
    3: ['6–10', '4–6', '3–4'],
    4: ['8–10', '6–8', '4–6', '3–4'],
    5: ['8–10', '6–8', '4–6', '3–4', '2–3']
  };

  /* Стеля свого числа повторень у розминці: вище — це вже не розминка,
     а робочий підхід у високому діапазоні. */
  var WARMUP_REPS_MAX = 30;

  var WARMUP_DEFAULT = 3;
  var WARMUP_MAX = 5;

  /**
   * Скільки розминкових підходів поставила людина: ціле 0…5 або null.
   *
   * null — саме «числа немає» (порожньо, сміття), і тільки воно вмикає
   * типове значення. Нуль означає вибір «без розминки» і типовим НЕ
   * підміняється: інакше поле виглядало б зламаним — поставив 0, а
   * повернулось 3.
   *
   * Завелике не відкидається, а підтягується до стелі — так само, як
   * власне число повторень (js/reps-core.js): мовчазне «нічого не
   * сталось» гірше за видиму поправку.
   */
  function normWarmupCount(value) {
    if (value == null || value === '') return null;
    var n = Math.floor(Number(String(value).trim()));
    if (!Number.isFinite(n)) return null;
    return Math.min(Math.max(n, 0), WARMUP_MAX);
  }

  /*
   * Вправа з групами мʼязів.
   *
   * Старі збережені плани (і саме поле «назва» у фікстурах) можуть не
   * носити muscles — тоді розмір групи не визначити, і вправа мовчки
   * вважалася б малою. Тому те саме, що робить liftKind: не знаємо з
   * самого обʼєкта — питаємо бібліотеку за назвою.
   */
  function withMuscles(ex) {
    if (Array.isArray(ex.muscles) && ex.muscles.length) return ex;
    var lib = window.EXERCISES;
    if (!Array.isArray(lib)) return ex;
    var known = null;
    for (var i = 0; i < lib.length; i++) {
      if (lib[i] && lib[i].name === ex.name) { known = lib[i]; break; }
    }
    return known || ex;
  }

  /** Своє число повторень однієї сходинки: ціле 1…30, або null. */
  function normWarmupReps(value) {
    if (value == null || value === '') return null;
    var txt = String(value).trim();
    if (txt === '') return null;
    var n = Math.round(Number(txt));
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.min(n, WARMUP_REPS_MAX);
  }

  /**
   * Запис книги розминки, приведений до однієї форми: {n, reps} або null.
   *
   * У книзі лежить або САМЕ ЧИСЛО (так писала перша версія), або обʼєкт
   * із повторами. Стара форма читається як є й не мігрується: вибір
   * «дві сходинки», зроблений учора, мусить пережити сьогоднішню правку.
   *
   * null означає «вибору немає» — і тільки він вмикає типове значення.
   */
  function normWarmup(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
      var n = normWarmupCount(value.n);
      if (n === null) return null;
      var src = Array.isArray(value.reps) ? value.reps : [];
      var reps = [];
      for (var i = 0; i < n; i++) reps.push(normWarmupReps(src[i]));
      return { n: n, reps: reps };
    }
    var plain = normWarmupCount(value);
    if (plain === null) return null;
    var empty = [];
    for (var k = 0; k < plain; k++) empty.push(null);
    return { n: plain, reps: empty };
  }

  /*
   * ТИПОВА КІЛЬКІСТЬ ЗАЛЕЖИТЬ ВІД ТИПУ ВПРАВИ.
   *
   * Сходинки до робочої ваги мають сенс там, де вага велика й техніка
   * коштує дорого: присідання, жими, тяги. У біцепсі, трицепсі, ікрах,
   * передпліччі чи шиї «розминковий підхід» — це той самий підхід, тільки
   * легший; рядок про нього стояв у кожній такій вправі без діла.
   *
   * Класифікація НЕ вигадується тут заново: це той самий поділ
   * compound/isolation із js/exercises.js, яким уже живуть час відпочинку
   * й стеля відсотків у періодизації. Свою копію правила довелося б
   * тримати в синхроні вручну — і вона розійшлася б на першій правці.
   *
   * @param {{name:string, lift?:string}|string} ex вправа (або сама назва)
   */
  function warmupCountFor(profile, ex) {
    var one = (ex && typeof ex === 'object') ? ex : { name: String(ex == null ? '' : ex) };
    var book = profile && profile.warmups;
    var own = book && typeof book === 'object' ? normWarmup(book[one.name]) : null;
    if (own !== null) return own.n;

    /* liftKind сам дивиться спершу в поле lift, потім у бібліотеку за
       назвою, і лише тоді здається — старі збережені плани поля не
       носять, але назву мають. Без бібліотеки лишається саме поле. */
    var kind = (typeof window.liftKind === 'function')
      ? window.liftKind(one)
      : (one.lift === 'compound' ? 'compound' : 'isolation');
    if (kind !== 'compound') return 0;

    /*
     * Самої багатосуглобовості замало: жим вузьким хватом чи французький
     * жим — це трицепс, тобто мала група й невелика вага, і сходинки
     * 40/60/80 % там означають три зайві підходи. Розминка лишається
     * там, де вага справді велика: велика група плюс складний рух.
     *
     * Розмір групи беремо з RepsCore.sizeOf — тим самим, яким рахується
     * діапазон повторень; він дивиться в MUSCLES. Своя копія цієї
     * класифікації розійшлася б із нею на першій правці.
     */
    var RC = window.RepsCore;
    if (RC && typeof RC.sizeOf === 'function' && RC.sizeOf(withMuscles(one)) !== 'large') return 0;
    return WARMUP_DEFAULT;
  }

  /** Повтори кожної сходинки: своє число або діапазон із протоколу. */
  function warmupRepsFor(profile, ex) {
    var one = (ex && typeof ex === 'object') ? ex : { name: String(ex == null ? '' : ex) };
    var n = warmupCountFor(profile, one);
    var book = profile && profile.warmups;
    var own = (book && typeof book === 'object') ? normWarmup(book[one.name]) : null;
    var base = WARMUP_REPS[n] || [];
    var out = [];
    for (var i = 0; i < n; i++) {
      var mine = (own && own.n === n) ? own.reps[i] : null;
      out.push(mine === null || mine === undefined ? (base[i] || '') : String(mine));
    }
    return out;
  }

  /**
   * Розминкові підходи під робочу вагу.
   *
   * ОКРУГЛЕННЯ БЕРЕТЬСЯ З OneRM.toPlates, а не пишеться тут удруге: крок
   * млинця — одне число на весь сайт, і друга його копія розійшлася б із
   * першою на першій же правці. Те саме міркування, що в js/onerm.js, де
   * теж свідомо не заведено власного Math.round(x / 2.5) * 2.5.
   *
   * Однакові після округлення сходинки схлопуються: на малій вазі 40, 60
   * і 80 % сходяться в одне число, і показати «10 · 10 · 10» означало б
   * удавати три підходи там, де є один.
   *
   * ПОВТОРІВ ТУТ НЕМАЄ НАВМИСНО. Скільки разів робити розминковий підхід —
   * питання, на яке в проєкті немає ані виміру, ані джерела; вигадати
   * число й поставити його поруч із порахованою вагою означало б видати
   * здогад за розрахунок.
   *
   * ДРУГИЙ АРГУМЕНТ приймає і число, і ФУНКЦІЮ. Число — старий крок
   * млинців. Функція — власне округлення того, хто кличе: сторінка
   * тренування передає сюди профіль залу (js/gym-core.js), який знає,
   * що саме можна зібрати з наявних млинців або поставити на
   * гантельному ряду. Ядро при цьому лишається без залежності на
   * GymCore: воно просто округлює тим, що дали.
   *
   * @param {number} workKg робоча вага вправи, кг
   * @param {number|function} step крок млинців (2,5 або 5) або округлювач
   * @param {number} [count] скільки сходинок; без нього — типові три
   * @param {Array<number|null>} [reps] свої повтори посходинково
   * @returns {Array<{pct:number, kg:number, reps:string}>}
   */
  function warmupSets(workKg, step, count, reps) {
    var kg = Number(workKg);
    if (!Number.isFinite(kg) || kg <= 0) return [];
    var snap = null;
    if (typeof step === 'function') {
      snap = function (v) { return step(v); };
    } else if (window.OneRM && typeof window.OneRM.toPlates === 'function') {
      snap = function (v) { return window.OneRM.toPlates(v, step); };
    }
    /* Без округлення розминки не буває: 37,4 кг у залі не зібрати. */
    if (!snap) return [];

    /* undefined — «кількість не питали», тобто типові три. Явний нуль
       проходить через normWarmupCount і чесно дає порожню розминку. */
    var n = count === undefined ? WARMUP_DEFAULT : normWarmupCount(count);
    if (n === null) n = WARMUP_DEFAULT;
    var pcts = WARMUP_LADDER[n] || [];

    var base = WARMUP_REPS[n] || [];
    var own = Array.isArray(reps) ? reps : [];

    var out = [], seen = Object.create(null);
    pcts.forEach(function (pct, idx) {
      var w = Number(snap(kg * pct / 100));
      if (!Number.isFinite(w)) return;
      /*
       * Нуль означає «легше за найменший млинець» — це вже не вага.
       *
       * А w >= kg ловить випадок, якого не видно з формули: на дуже малій
       * робочій вазі округлення тягне сходинку ВГОРУ й вона переростає
       * саму робочу вагу. При 2 кг і кроці 2,5 «80 %» давали 2,5 — тобто
       * розминку, важчу за підхід. Знайдено тестом, а не в залі.
       */
      if (!(w > 0) || w >= kg || seen[w]) return;
      seen[w] = true;
      /* Повтори беруться за ІНДЕКСОМ сходинки, а не за місцем у
         результаті: коли сусідні відсотки схлопнулись, той, що лишився,
         мусить нести свої повтори, а не чужі, що просто були першими. */
      var mine = normWarmupReps(own[idx]);
      out.push({ pct: pct, kg: w, reps: mine === null ? (base[idx] || '') : String(mine) });
    });
    return out;
  }

  window.WorkoutCore = {
    LS_TODAY: LS_TODAY,
    todayKey: todayKey,
    planKey: planKey,
    activeKey: activeKey,
    resolvePlan: resolvePlan,
    clampDay: clampDay,
    restSecFor: restSecFor,
    readDay: readDay,
    writeDay: writeDay,
    plannedSets: plannedSets,
    doneSetsFor: doneSetsFor,
    normWeight: normWeight,
    normReps: normReps,
    normRir: normRir,
    performedSets: performedSets,
    setDoneSets: setDoneSets,
    editSet: editSet,
    dayStats: dayStats,
    dayMinutes: dayMinutes,
    addDaysKey: addDaysKey,
    weekStartKey: weekStartKey,
    sessionFor: sessionFor,
    completedToday: completedToday,
    completedThisWeek: completedThisWeek,
    WARMUP_PCT: WARMUP_PCT,
    WARMUP_LADDER: WARMUP_LADDER,
    WARMUP_REPS: WARMUP_REPS,
    WARMUP_REPS_MAX: WARMUP_REPS_MAX,
    normWarmup: normWarmup,
    normWarmupReps: normWarmupReps,
    warmupRepsFor: warmupRepsFor,
    WARMUP_DEFAULT: WARMUP_DEFAULT,
    WARMUP_MAX: WARMUP_MAX,
    normWarmupCount: normWarmupCount,
    warmupCountFor: warmupCountFor,
    warmupSets: warmupSets
  };
})();
