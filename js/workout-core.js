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
  function todayKey(d) {
    const x = d instanceof Date ? d : new Date();
    return x.getFullYear() + '-' +
      String(x.getMonth() + 1).padStart(2, '0') + '-' +
      String(x.getDate()).padStart(2, '0');
  }

  /** Ключ 'programId:days' — той самий, що в programs.js */
  function planKey(programId, days) { return String(programId) + ':' + String(days); }

  function activeKey(profile) {
    const a = (profile && profile.activePlan) || {};
    return planKey(a.programId || '', Number(a.days) || 0);
  }

  /**
   * План на сьогодні: власна копія з профілю, інакше базовий план програми.
   *
   * Джерело одне (profile.customPlans + PROGRAMS), тому «Мій план»,
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
     * Через resolvePlan проходять «Сьогодні», «Тренування» і «Мій план»,
     * тож це вузьке місце для всіх трьох. Без перевірки саме тут план
     * чужої статі лишався б робочим у збереженому activePlan: людина
     * змінила стать у налаштуваннях — а тренування далі відкривається
     * старе. Правило одне для всіх (js/programs-data.js).
     */
    const allowed = window.programAllowedFor;
    if (typeof allowed === 'function' && !allowed(program, profile && profile.sex)) return null;
    const days = String(Number(a.days) || 3);
    const custom = (profile.customPlans || {})[planKey(a.programId, days)];
    const plan = custom || (program.days && program.days[days]);
    if (!Array.isArray(plan) || !plan.length) return null;
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
        done: Array.isArray(raw.done) ? raw.done.map(Boolean) : [],
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

  function writeDay(profile, key, dayIdx, done) {
    try {
      localStorage.setItem(LS_TODAY, JSON.stringify({
        date: key,
        plan: activeKey(profile),
        dayIdx: dayIdx,
        done: done
      }));
    } catch (_) { /* показ важливіший за памʼять */ }
  }

  /** Скільки вправ закрито — з масиву галочок */
  function doneCount(done) {
    return (Array.isArray(done) ? done : []).filter(Boolean).length;
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
    doneCount: doneCount
  };
})();
