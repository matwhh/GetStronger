/**
 * Симуляція балансу сезонного ELO (§23 ТЗ).
 *
 * Пʼять профілів користувачів проживають повний 92-денний сезон через ТЕ
 * САМЕ ядро (js/elo-core.js) і ТОЙ САМИЙ конфіг (db/elo-config.json), що
 * й продакшн.
 *
 * ЦІЛЬОВА ТАБЛИЦЯ ПІСЛЯ ПЕРЕБАЛАНСУ (вересень 2026, шкала 0–3000):
 *   Бездоганний            → 2900+, і 5-й рівень не пізніше дня 21
 *   Perfect (97–100%)      → 2800+ (ELITE)
 *   Excellent (90–95%)     → 2200–2700, ELITE як нагорода за сезон
 *   Average (70–80%)       → 1200–1900 (L6–8), без ELITE
 *   Poor (<60%)            → до 800 (L1–3)
 *   Inconsistent           → 800–2400, без ELITE
 *
 * ЧОМУ ЦІ ЧИСЛА, А НЕ ПОПЕРЕДНІ. Старий баланс був плаский: 200 ELO на
 * тиждень і на першому рівні, і на девʼятому. Старт нудний (два тижні
 * бездоганної роботи давали Level 2), а верхня третина шкали не належала
 * нікому, крім бездоганного: сильний гравець із 90–95% закінчував сезон
 * на ~1800 із 2500. Тепер темп спадає з рівнем (levelPace у конфігу):
 * перші рівні беруться швидко, далі кожні наступні очки дорожчають.
 *
 * ГОЛОВНА ПЕРЕВІРКА ТУТ — НЕ КІНЦЕВЕ ЧИСЛО, А ДЕНЬ 5-ГО РІВНЯ. Кінцеве
 * число легко підігнати стелею; темп старту — ні, і саме він вирішує, чи
 * кине людина застосунок на другому тижні.
 *
 * Запуск детермінований: PRNG із фіксованим зерном, без Math.random.
 */
import vm from 'node:vm';
import fs from 'node:fs';

const sb = { window: {}, console, Math, Date, JSON, Number, String, Array, Object };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(new URL('../js/elo-core.js', import.meta.url), 'utf8'), sb);
const E = sb.window.EloCore;
/* FORGE_ELO_CFG — інший конфіг для підбору балансу. Без нього — бойовий.
   Потрібне саме тут: крива темпу підбирається прогонами, і правити заради
   кожної спроби db/elo-config.json означало б ганяти продакшн-конфіг
   десятками недороблених станів. */
const CFG = JSON.parse(fs.readFileSync(
  process.env.FORGE_ELO_CFG || new URL('../db/elo-config.json', import.meta.url), 'utf8'));
/* Бойовий конфіг — умовчання для simulate(); окремим імʼям, бо один із
   прогонів іде з конфігом БЕЗ харчування (див. блок «Без харчування»). */
const BASE_CFG = CFG;

/* Мінімальний детермінований PRNG (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Профіль поведінки: exec — базова частка виконання будь-якої дії,
 * show — імовірність, що дія взагалі станеться того дня,
 * wave — синусоїда настрою (для inconsistent).
 */
const USERS = {
  Perfect:      { exec: 0.99, show: 0.995, jitter: 0.015, wave: 0 },
  Excellent:    { exec: 0.93, show: 0.96,  jitter: 0.04,  wave: 0 },
  Average:      { exec: 0.78, show: 0.85,  jitter: 0.08,  wave: 0 },
  Poor:         { exec: 0.55, show: 0.6,   jitter: 0.10,  wave: 0 },
  Inconsistent: { exec: 0.85, show: 0.9,   jitter: 0.05,  wave: 0.35 }
};

const PLANNED = 4;           // тренувань на тиждень
const DAYS = 92;             // сезон
const SLEEP_GOAL = 480, STEP_GOAL = 10000, KCAL = 2600, PROT = 170;

/**
 * @param {{cfg?:object}} [opts] свій конфіг — наприклад, без харчування.
 *   Коли в конфігу немає ваги nutrition, їжа не ведеться зовсім: ні подій,
 *   ні штрафу за незакритий день. Саме так виглядає людина, яка вимкнула
 *   категорію в рейтингу.
 */
function simulate(name, u, seed, opts) {
  const CFG = (opts && opts.cfg) || BASE_CFG;
  const eats = Boolean(CFG.weights.nutrition);
  const rand = rng(seed);
  let elo = 0;
  const series = [];
  let week = { workouts: 0, meals: 0, penalized: false };

  for (let d = 0; d < DAYS; d++) {
    const dayOfWeek = d % 7;
    if (dayOfWeek === 0) week = { workouts: 0, meals: 0 };

    /* Хвиля для inconsistent: ±wave до базового виконання, період ~3 тижні */
    const mood = u.exec + u.wave * Math.sin(d / 10) + (rand() - 0.5) * 2 * u.jitter;
    const exec = Math.max(0.2, Math.min(1, mood));
    const shows = (p) => rand() < p * u.show + (u.wave ? u.wave * Math.sin(d / 10) * 0.3 : 0);

    const isTrainingDay = [1, 3, 5, 0].slice(0, PLANNED).includes(dayOfWeek);
    const deltas = [];
    const mults = {};

    if (isTrainingDay && shows(1)) {
      const total = 14;
      const done = Math.round(total * Math.min(1, exec + rand() * 0.05));
      const r = E.actionDelta('workout', { done, total }, CFG, { plannedDays: PLANNED, elo: elo });
      deltas.push(r.delta); mults.training = r.mult;
      if (done / total >= 0.5) week.workouts++;
    }
    if (eats) {
      if (shows(0.98)) {
        const kcal = KCAL * (1 + (1 - exec) * (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5));
        const prot = PROT * Math.min(1.1, exec + rand() * 0.08);
        const r = E.actionDelta('meal', { kcal, target: KCAL, protein: prot, proteinTarget: PROT }, CFG, { elo: elo });
        deltas.push(r.delta); mults.nutrition = r.mult;
        week.meals++;
      } else {
        deltas.push(CFG.openMealPenalty);
      }
    }
    if (shows(0.97)) {
      const r = E.actionDelta('sleep', { minutes: SLEEP_GOAL * Math.min(1.05, exec + rand() * 0.1), goal: SLEEP_GOAL }, CFG, { elo: elo });
      deltas.push(r.delta); mults.sleep = r.mult;
    }
    if (shows(0.95)) {
      const r = E.actionDelta('recovery', { value: exec > 0.7 ? 8 : 5 }, CFG, { elo: elo });
      deltas.push(r.delta); mults.recovery = r.mult;
    }
    if (shows(0.95)) {
      const r = E.actionDelta('activity', { steps: STEP_GOAL * Math.min(1.2, exec + rand() * 0.15), goal: STEP_GOAL }, CFG, { elo: elo });
      deltas.push(r.delta); mults.activity = r.mult;
    }

    if (E.cleanDay(mults, isTrainingDay, CFG)) deltas.push(CFG.cleanDayBonus);

    /* Кінець тижня: штраф за недобір і бонус чистого тижня */
    if (dayOfWeek === 6) {
      deltas.push(E.weekPenalty(week.workouts, PLANNED, 0, CFG));
      deltas.push(E.cleanWeek(week.workouts, PLANNED, week.meals, CFG));
    }

    elo = E.clampElo(elo + E.applyDayCaps(deltas, CFG, elo), CFG);
    series.push(elo);
  }

  const lvl = E.levelFor(elo, CFG);
  const mid = series[Math.floor(DAYS / 2)];
  /* День, коли вперше взято 5-й рівень: цільовий темп старту задано саме
     ним («до 5 рівня за 3 тижні»), і без цього числа криву не підібрати. */
  const l5 = series.findIndex(function (v) { return E.levelFor(v, CFG).level >= 5; });
  return { name, elo, level: lvl.level, elite: lvl.elite, mid, series,
           day5: l5 === -1 ? null : l5 + 1 };
}

const targets = {
  Perfect:      (r) => r.elo >= 2800,
  Excellent:    (r) => r.elo >= 2200 && r.elo < 2700,
  Average:      (r) => r.elo >= 1200 && r.elo <= 1900 && !r.elite,
  Poor:         (r) => r.elo <= 800,
  /* Хаотичний може набрати багато, але ELITE — це про стабільність. */
  Inconsistent: (r) => r.elo > 800 && !r.elite
};

/*
 * ВІДОМІ ВІДХИЛЕННЯ (TST-011).
 *
 * Профіль Excellent (90–95 % виконання) виходить у Level 10 у найкращих
 * прогонах: 1841 і 1849 при межі 1800. Причина ймовірно в тому, що
 * тренування рахуються лінійною пропорцією (elo-proportional) без драбини
 * толерантності, як у решти категорій.
 *
 * Це питання БАЛАНСУ, а не помилка коду: полагодити його означає змінити
 * нарахування всім, хто вже грає сезон. Тому воно не «виправляється» тут
 * мовчки, а лежить із датою і причиною — і жодне ІНШЕ відхилення повз цей
 * список не пройде. Порожній список = всі цілі влучено.
 *
 * Прибрати запис можна двома способами, обидва свідомі: підкрутити
 * db/elo-config.json або переписати ціль у шапці цього файла.
 */
/*
 * ВІДОМІ ВІДХИЛЕННЯ (TST-011).
 *
 * Порожньо. Попереднє — «Excellent виходить у Level 10, 1841 при межі
 * 1800» — закрите перебалансом: сильний гравець тепер і МАЄ доходити до
 * верху шкали, це була не помилка розрахунку, а застаріла ціль.
 */
const KNOWN = {};

let pass = 0, total = 0;
const unexpected = [];
for (const [name, u] of Object.entries(USERS)) {
  /* Кілька зерен: баланс має триматись не на одному щасливому прогоні */
  const runs = [1, 2, 3, 4, 5].map((s) => simulate(name, u, s * 1000 + 7));
  const avg = Math.round(runs.reduce((a, r) => a + r.elo, 0) / runs.length);
  const ok = runs.every(targets[name]);
  total++; if (ok) pass++;
  if (!ok && !KNOWN[name]) unexpected.push(name);
  console.log(
    (ok ? 'OK   ' : (KNOWN[name] ? 'ВІДОМЕ ' : 'FAIL ')) + name.padEnd(13) +
    'середнє ' + String(avg).padStart(4) + ' ELO  ' +
    'прогони: ' + runs.map((r) => r.elo + ' (L' + r.level + (r.elite ? 'E' : '') + ')').join(', ') +
    '  L5 на день: ' + runs.map((r) => r.day5 === null ? '—' : r.day5).join('/')
  );
}

/* Стеля — лише бездоганному, і темп старту перевіряється саме на ньому:
   «до 5-го рівня за три тижні» задано для гравця без жодної втрати. */
{
  const god = simulate('Flawless', { exec: 1, show: 1, jitter: 0, wave: 0 }, 42);
  const ok = god.elo >= 2900 && god.day5 !== null && god.day5 <= 22;
  total++; if (ok) pass++;
  console.log((ok ? 'OK   ' : 'FAIL ') + 'Flawless      ' + god.elo +
    ' ELO (бездоганний сезон → стеля)  L5 на день: ' + (god.day5 === null ? '—' : god.day5) +
    '  [ціль: 2900+ і L5 не пізніше 22-го]');
}

/*
 * БЕЗ ХАРЧУВАННЯ — НЕ ГІРШЕ.
 *
 * Тижнева стеля спільна (weeklyBudget × темп), ваги лише ділять її між
 * категоріями. Доти 30 % цієї стелі були закріплені за їжею: людина, яка
 * її не веде, мала недосяжний кусок власного бюджету й не могла дійти
 * туди, куди доходив той самий гравець зі щоденником.
 *
 * Тут той самий бездоганний профіль проживає сезон двічі: зі щоденником
 * і без нього, з конфігом, де вага nutrition перерозподілена. Числа
 * мусять зійтись — інакше вимикач у рейтингу був би прихованим штрафом.
 */
{
  const noFood = E.cfgFor(CFG, ['nutrition']);
  const u = { exec: 1, show: 1, jitter: 0, wave: 0 };
  const withFood = simulate('Flawless', u, 42).elo;
  const without = simulate('NoFood', u, 42, { cfg: noFood }).elo;
  const gap = Math.abs(withFood - without);
  const ok = without >= 2900 && gap <= 60;
  total++; if (ok) pass++;
  console.log((ok ? 'OK   ' : 'FAIL ') + 'Без харчування ' + without +
    ' ELO проти ' + withFood + ' зі щоденником (різниця ' + gap +
    ')  [ціль: 2900+ і різниця ≤ 60]');
}

console.log('\n' + pass + '/' + total + ' цілей балансу влучено.');
for (const [name, why] of Object.entries(KNOWN)) {
  console.log('ВІДОМЕ ВІДХИЛЕННЯ · ' + name + ': ' + why);
}
if (unexpected.length) {
  console.log('НОВІ відхилення (не в списку відомих): ' + unexpected.join(', '));
}
if (process.argv.indexOf('--seasons') === -1) {
  /*
   * Код 0, поки нових відхилень немає. Відомі надруковані вище й видимі
   * в кожному прогоні CI — це не «мовчазний пропуск», а зафіксований борг.
   */
  process.exit(unexpected.length ? 1 : 0);
}

/* ================= Повний режим: --seasons N =================
 * 1000+ незалежних сезонів на профіль. Варіюються: план (3–6/тиж),
 * цілі сну/ккал/білка/кроків, використання Grace Weeks. Друкує
 * розподіли (p05/p50/p95/p99/max), гістограму рівнів, частки Elite,
 * 2400+ і 2500. Перевіряє цільові смуги ТЗ і виходить 0/1.
 */
const argN = process.argv.indexOf('--seasons');
if (argN !== -1) {
  const N = Math.max(100, Number(process.argv[argN + 1]) || 1000);

  function simulateFull(u, seed, opts) {
    const rand = rng(seed);
    const PLAN = opts.plan, SG = opts.sleepGoal, STG = opts.stepGoal, K = opts.kcal, P = opts.prot;
    /* Grace-блоки: до двох, кожен 7 днів. Старт блоку — випадковий тиждень. */
    const graceStarts = [];
    if (rand() < u.graceProb) graceStarts.push(7 * (1 + Math.floor(rand() * 5)));
    if (rand() < u.graceProb * 0.6) {
      const s2 = 7 * (7 + Math.floor(rand() * 5));
      if (!graceStarts.length || Math.abs(s2 - graceStarts[0]) >= 7) graceStarts.push(s2);
    }
    const inGrace = (d) => graceStarts.some((g) => d >= g && d < g + 7);

    let elo = 0, best = 0;
    let week = { workouts: 0, meals: 0, graceDays: 0 };
    for (let d = 0; d < DAYS; d++) {
      const dow = d % 7;
      if (dow === 0) week = { workouts: 0, meals: 0, graceDays: 0 };
      const grace = inGrace(d);
      if (grace) week.graceDays++;

      const mood = u.exec + u.wave * Math.sin(d / 10) + (rand() - 0.5) * 2 * u.jitter;
      const exec = Math.max(0.2, Math.min(1, mood));
      const shows = (p) => rand() < p * u.show + (u.wave ? u.wave * Math.sin(d / 10) * 0.3 : 0);

      const isTrainingDay = [1, 3, 5, 0, 2, 4].slice(0, PLAN).includes(dow);
      const deltas = [];
      const mults = {};

      if (isTrainingDay && !grace && shows(1)) {
        const total = 14;
        const done = Math.round(total * Math.min(1, exec + rand() * 0.05));
        const r = E.actionDelta('workout', { done, total }, CFG, { plannedDays: PLAN, grace, elo: elo });
        deltas.push(r.delta); mults.training = r.mult;
        if (done / total >= 0.5) week.workouts++;
      }
      if (shows(0.98)) {
        const kcal = K * (1 + (1 - exec) * (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5));
        const prot = P * Math.min(1.1, exec + rand() * 0.08);
        const r = E.actionDelta('meal', { kcal, target: K, protein: prot, proteinTarget: P }, CFG, { elo: elo });
        deltas.push(r.delta); mults.nutrition = r.mult;
        week.meals++;
      } else {
        deltas.push(CFG.openMealPenalty);
      }
      if (shows(0.97)) {
        const r = E.actionDelta('sleep', { minutes: SG * Math.min(1.05, exec + rand() * 0.1), goal: SG }, CFG, { elo: elo });
        deltas.push(r.delta); mults.sleep = r.mult;
      }
      if (shows(0.95)) {
        const r = E.actionDelta('recovery', { value: exec > 0.7 ? 8 : 5 }, CFG, { elo: elo });
        deltas.push(r.delta); mults.recovery = r.mult;
      }
      if (shows(0.95)) {
        const r = E.actionDelta('activity', { steps: STG * Math.min(1.2, exec + rand() * 0.15), goal: STG }, CFG, { elo: elo });
        deltas.push(r.delta); mults.activity = r.mult;
      }

      if (E.cleanDay(mults, isTrainingDay && !grace, CFG)) deltas.push(CFG.cleanDayBonus);

      if (dow === 6) {
        deltas.push(E.weekPenalty(week.workouts, PLAN, week.graceDays, CFG));
        deltas.push(E.cleanWeek(week.workouts, PLAN, week.meals, CFG));
      }

      elo = E.clampElo(elo + E.applyDayCaps(deltas, CFG, elo), CFG);
      if (elo > best) best = elo;
    }
    return elo;
  }

  const GRACE_PROB = { Perfect: 0.05, Excellent: 0.3, Average: 0.5, Poor: 0.6, Inconsistent: 0.7 };
  /* Смуги виконання з ТЗ: когортні, семплиться на прогін (не константа) */
  const EXEC_BAND = {
    Perfect:      [0.97, 1.00],
    Excellent:    [0.90, 0.95],
    Average:      [0.70, 0.80],
    Poor:         [0.35, 0.60],
    Inconsistent: [0.78, 0.90]
  };
  const PLANS = [3, 4, 5, 6];
  const SLEEPS = [420, 480, 540];
  const STEPS = [8000, 10000, 12000];

  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const bands = {
    /* Цільові смуги після перебалансу (шкала 0–3000, ELITE від 2400):
       Perfect → ELITE майже завжди; Excellent → верх шкали, ELITE як
       нагорода приблизно половині; Average → L6–8 без ELITE; Poor → низ;
       Inconsistent → високо, але без ELITE: він про стабільність. */
    Perfect:      (S) => S.p50 >= 2700 && S.p05 >= 2200 && S.shareElite >= 0.5,
    Excellent:    (S) => S.p50 >= 2100 && S.p50 <= 2700 && S.shareElite <= 0.75,
    Average:      (S) => S.p50 >= 1100 && S.p50 <= 2000 && S.shareElite <= 0.02,
    Poor:         (S) => S.p50 <= 1000 && S.shareElite === 0,
    Inconsistent: (S) => S.shareElite <= 0.05 && S.p50 < 2400
  };

  let ok = 0, tot = 0;
  const summaries = {};
  for (const [name, base] of Object.entries(USERS)) {
    const band = EXEC_BAND[name];
    const res = [];
    for (let i = 0; i < N; i++) {
      const frac = (i * 0.6180339887) % 1; /* рівномірне покриття смуги */
      const u = Object.assign({}, base, {
        graceProb: GRACE_PROB[name],
        exec: band[0] + (band[1] - band[0]) * frac
      });
      const opts = {
        plan: PLANS[i % PLANS.length],
        sleepGoal: SLEEPS[i % SLEEPS.length],
        stepGoal: STEPS[i % STEPS.length],
        kcal: 2200 + (i % 9) * 100,
        prot: 140 + (i % 7) * 10
      };
      res.push(simulateFull(u, i * 2654435761 % 4294967291 + 17, opts));
    }
    res.sort((a, b) => a - b);
    const S = {
      mean: Math.round(res.reduce((a, b) => a + b, 0) / N),
      p05: pct(res, 0.05), p50: pct(res, 0.5), p95: pct(res, 0.95), p99: pct(res, 0.99),
      min: res[0], max: res[res.length - 1],
      /* Межі беруться з КОНФІГУ, а не зашиті числами. Зашиті вони вже
         протухли: після перебалансу шкали 2000 перестало означати ELITE,
         і звіт бадьоро писав «Elite 100%» там, де за новою межею його
         мали 1,3% прогонів. Показник, що бреше, гірший за відсутній. */
      shareElite: res.filter((e) => e >= CFG.eliteFloor).length / N,
      shareL10: res.filter((e) => e >= CFG.levelSize * (CFG.levelCount - 1)).length / N,
      shareMax: res.filter((e) => e >= CFG.seasonMax).length / N
    };
    const hist = new Array(10).fill(0);
    for (const e of res) hist[E.levelFor(e, CFG).level - 1]++;
    S.hist = hist.map((c) => Math.round(c / N * 100));
    summaries[name] = S;
    const passB = bands[name](S);
    tot++; if (passB) ok++;
    console.log((passB ? 'OK   ' : 'FAIL ') + name.padEnd(13) +
      `p05 ${String(S.p05).padStart(4)}  p50 ${String(S.p50).padStart(4)}  p95 ${String(S.p95).padStart(4)}  p99 ${String(S.p99).padStart(4)}  max ${String(S.max).padStart(4)}  ` +
      `Elite ${(S.shareElite * 100).toFixed(1)}%  L10 ${(S.shareL10 * 100).toFixed(1)}%  стеля ${(S.shareMax * 100).toFixed(2)}%`);
    console.log('      рівні L1..L10 (%): ' + S.hist.join(' '));
  }

  /* Ідеальний сезон без grace — стеля має бути досяжною, але тільки так */
  const god = simulateFull({ exec: 1, show: 1, jitter: 0, wave: 0, graceProb: 0 }, 42, { plan: 4, sleepGoal: 480, stepGoal: 10000, kcal: 2600, prot: 170 });
  const godOk = god >= 2400;
  tot++; if (godOk) ok++;
  console.log((godOk ? 'OK   ' : 'FAIL ') + 'Flawless      ' + god + ' ELO');

  console.log('\n' + ok + '/' + tot + ' цілей повного режиму (' + N + ' сезонів/профіль).');
  process.exit(ok === tot ? 0 : 1);
}
