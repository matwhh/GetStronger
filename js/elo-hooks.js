/**
 * Гачки сезонного ELO: журнали профілю → події сервера.
 *
 * НЕІНВАЗИВНО: жоден існуючий модуль не знає про ELO. Цей файл слухає
 * Store.onChange і читає ті самі журнали, які сторінки вже пишуть:
 *
 *   training  ← sessionLog[дата]           ({done, total} — якість дня)
 *   nutrition ← mealLog[дата]              ({kcal, p, target})
 *   sleep     ← trackerLog.sleep[дата]     (хвилини проти цілі трекера)
 *   recovery  ← trackerLog.recovery[дата]  (шкала 1–10)
 *   activity  ← trackerLog.steps[дата]     (кроки проти цілі трекера)
 *
 * Момент нарахування:
 *   • тренування — одразу, щойно день закрито повністю (done == total);
 *     частково виконане подається наступного дня з фактичною якістю
 *     (вікно submitWindowDays на сервері це дозволяє);
 *   • решта — одразу при записі факту. Перше подане значення фіксує
 *     якість дії (ідемпотентність за action_key) — виправлення заднім
 *     числом рейтинг не перерахує, і це навмисно.
 *
 * Кожна успішна відповідь сервера з delta ≠ 0 — короткий тост
 * «+16 ELO — Тренування виконано». Оптимістичні (офлайн) — теж, з
 * позначкою, що досилається.
 */
(function () {
  'use strict';

  const SENT_KEY = 'ib.eloSent';

  function lsGet(k, fb) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? fb : v; }
    catch (_) { return fb; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  /*
   * Позначки «надіслано» старші за два тижні прибираємо.
   *
   * Ключ має вигляд 'meal:2026-08-29', тобто дата в ньому вже є. Сховище
   * росло приблизно на пʼять ключів на день і не чистилось ніколи, а
   * парситься воно на кожен Store.onChange. Вікно подання — 2 дні, тож
   * старші за 14 днів позначки не впливають ні на що.
   */
  function pruneSent(sent) {
    const cut = (function () {
      const d = new Date();
      d.setDate(d.getDate() - 14);
      return dayKey(d);
    })();
    const out = {};
    Object.keys(sent).forEach(function (k) {
      const m = /(\d{4}-\d{2}-\d{2})$/.exec(k);
      if (!m || m[1] >= cut) out[k] = sent[k];
    });
    return out;
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function lastDays(n) {
    const out = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      out.push(dayKey(d));
    }
    return out;
  }

  /** Кандидати-події з журналів профілю за останні дні. */
  function collect(profile) {
    const events = [];
    const today = dayKey(new Date());
    const days = lastDays(3);
    const NC = window.NutritionCalc;
    const target = NC ? NC.targetFor(profile) : null;

    days.forEach(function (d) {
      /*
       * Тренування. Подається, щойно сесію ЗАВЕРШЕНО кнопкою (s.end) —
       * незалежно від повноти: сервер нарахує пропорційно. Старі правила
       * лишаються для сесій без end (легасі або незакритий день):
       * сьогодні — лише повне, минулі дні — як є.
       */
      const s = (profile.sessionLog || {})[d];
      if (s && Number(s.total) > 0) {
        const full = Number(s.done) >= Number(s.total);
        if (s.end || d !== today || full) {
          events.push({ kind: 'workout', key: 'workout:' + d, day: d,
            payload: { done: Number(s.done) || 0, total: Number(s.total) || 0,
                       doneSets: Number(s.doneSets) || 0, totalSets: Number(s.totalSets) || 0 },
            reason: 'Тренування' });
        }
      }

      /* Харчування: закритий день */
      const m = (profile.mealLog || {})[d];
      if (m && Number(m.target) > 0) {
        events.push({ kind: 'meal', key: 'meal:' + d, day: d,
          payload: { kcal: Number(m.kcal) || 0, target: Number(m.target) || 0,
                     protein: Number(m.p) || 0,
                     proteinTarget: target ? Math.round(target.protein) : 0 },
          reason: 'Харчування' });
      }

      /* Трекери */
      const tl = profile.trackerLog || {};
      const tr = profile.trackers || {};
      const val = function (id) {
        const e = (tl[id] || {})[d];
        if (e === null || e === undefined) return null;
        return typeof e === 'object' ? e.value : e;
      };
      const goal = function (id, fb) {
        return Number(tr[id] && tr[id].goal) || fb;
      };

      const sleep = val('sleep');
      if (sleep !== null && Number(sleep) > 0) {
        events.push({ kind: 'sleep', key: 'sleep:' + d, day: d,
          payload: { minutes: Number(sleep), goal: goal('sleep', 480) }, reason: 'Сон' });
      }
      const rec = val('recovery');
      if (rec !== null) {
        events.push({ kind: 'recovery', key: 'recovery:' + d, day: d,
          payload: { value: Number(rec) }, reason: 'Recovery' });
      }
      const steps = val('steps');
      if (steps !== null && Number(steps) > 0) {
        events.push({ kind: 'activity', key: 'activity:' + d, day: d,
          payload: { steps: Number(steps), goal: goal('steps', 8000) }, reason: 'Кроки' });
      }
    });

    return events;
  }

  let busy = false;

  async function sync(profile) {
    const Api = window.EloApi;
    if (busy || !Api || !Api.available() || !profile) return;
    busy = true;
    try {
      const sent = pruneSent(lsGet(SENT_KEY, {}));
      const events = collect(profile).filter(function (e) { return !sent[e.key]; });
      for (const e of events) {
        const res = await Api.submit(e.kind, e.key, e.day, e.payload);
        if (!res) continue;
        /*
         * retry === true — сервер не знайшов дії у профілі, і це нормально:
         * черга профілю (Store) і черга подій (EloApi) незалежні, тож подія
         * може випередити збереження. Позначити її надісланою означало б
         * втратити нарахування назавжди.
         *
         * retry === false — відмова остаточна: або запис дня є, але не
         * дотягує до порога floors.workoutTotalMin (день з однією вправою
         * цілком легальний), або це 4xx. Раніше сервер в обох випадках
         * казав retry:true, і та сама подія йшла на сервер при КОЖНОМУ
         * Store.onChange протягом трьох діб (INV-004).
         */
        if (res.ok === false && res.retry) continue;
        sent[e.key] = true;
        lsSet(SENT_KEY, sent);
        if (res.delta && !res.duplicate && window.App && window.App.toast) {
          /*
           * ОФЛАЙН — БЕЗ ЦИФРИ (ELO-008).
           *
           * Оптимістична дельта рахується тим самим ядром, але на інших
           * вхідних: план береться з профілю, а не зі знімка тижня, і
           * ціль по білку — з поточного розрахунку, а не з того, що
           * записано в день. Тобто число майже завжди інше, ніж нарахує
           * сервер, — і людина бачила, як «+51» перетворюється на «+17».
           * Поки відповіді сервера немає, чесніше сказати, що подія
           * зарахується, і не називати суму.
           */
          if (res.optimistic) {
            window.App.toast(e.reason + ' — зарахується, коли зʼявиться мережа', 'ok');
          } else {
            const sign = res.delta > 0 ? '+' : '';
            window.App.toast(sign + res.delta + ' ELO — ' + e.reason,
                             res.delta >= 0 ? 'ok' : 'err');
          }
        }
      }
    } finally { busy = false; }
  }

  /*
   * ЗВІТ ПРО СЕЗОН — ЄДИНЕ, ЩО ЙДЕ З СЕРВЕРА ПРЯМО В innerHTML.
   *
   * js/season.js вставляє поля цього обʼєкта в розмітку без екранування
   * (WEB-002) — це був єдиний робочий XSS-синк у застосунку. Екранування
   * там додано, але фільтр потрібен і тут: у localStorage звіт може
   * покласти і не сервер (інше розширення, сусідня вкладка, ручна правка),
   * а season.js читає його як довірений.
   *
   * Тому лишаємо рівно очікувані поля й рівно очікуваних типів. Усе інше —
   * зайве за визначенням: якщо колись сервер почне віддавати нове поле,
   * його треба свідомо додати сюди, а не отримати в розмітку мовчки.
   */
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  function sanitizeReport(r) {
    if (!r || typeof r !== 'object') return null;
    const st = (r.stats && typeof r.stats === 'object') ? r.stats : {};
    const cats = {};
    ['training', 'nutrition', 'sleep', 'recovery', 'activity'].forEach(function (c) {
      const s = st[c];
      if (s && typeof s === 'object' && num(s.elo) !== null) {
        cats[c] = { elo: num(s.elo), avgQuality: num(s.avgQuality) };
      }
    });
    return {
      ok: r.ok === true,
      season: typeof r.season === 'string' ? r.season.slice(0, 32) : null,
      elo: num(r.elo), level: num(r.level), elite: r.elite === true,
      rank: num(r.rank), of: num(r.of), percentile: num(r.percentile),
      daysActive: num(r.daysActive), daysTotal: num(r.daysTotal),
      graceUsed: num(r.graceUsed),
      stats: Object.assign(cats, {
        biggestGain: num(st.biggestGain), biggestLoss: num(st.biggestLoss),
        bestCategory: typeof st.bestCategory === 'string' ? st.bestCategory.slice(0, 32) : null,
        weakestCategory: typeof st.weakestCategory === 'string' ? st.weakestCategory.slice(0, 32) : null
      })
    };
  }

  function init() {
    if (!window.Store || !window.EloApi) return;
    if (!window.EloApi.available()) return;

    /* Разово на завантаження: свіжий стан, борги минулих тижнів, сезон */
    window.EloApi.refresh().catch(function () {});
    window.EloApi.evaluateWeeks();
    window.EloApi.closeSeasonIfDue().then(function (report) {
      if (report) lsSet('ib.eloReport', sanitizeReport(report));
    });
    window.Store.getProfile().then(sync).catch(function () {});

    /* Кожне збереження профілю — шанс на нову подію */
    window.Store.onChange(function (profile) { if (profile) sync(profile); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
