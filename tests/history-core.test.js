/**
 * Ядро історії (js/history-core.js).
 *
 * Головні властивості під охороною:
 *   1. append-only: старі записи ваг НІКОЛИ не змінюються і не зникають;
 *   2. той самий день — заміна, різні дні — накопичення;
 *   3. незмінність входу: функції повертають копії, не мутуючи журнал;
 *   4. історія в mealLog памʼятає ціль ТОГО дня, а не поточну.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const H = loadModules(['js/date-core.js', 'js/history-core.js']).HistoryCore;

describe('weightLog: append-only', () => {
  it('нові дні накопичуються, не затираючи старі', () => {
    let log = {};
    log = H.appendWeight(log, 'Жим', 100, '2026-08-01');
    log = H.appendWeight(log, 'Жим', 102.5, '2026-08-08');
    log = H.appendWeight(log, 'Жим', 105, '2026-08-15');
    assert.equal(log['Жим'].length, 3);
    assert.equal(log['Жим'][0].kg, 100);
    assert.equal(log['Жим'][0].d, '2026-08-01');
    assert.equal(log['Жим'][2].kg, 105);
  });

  it('повторна зміна того самого дня замінює запис, а не додає', () => {
    let log = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    log = H.appendWeight(log, 'Жим', 101, '2026-08-01');
    log = H.appendWeight(log, 'Жим', 102, '2026-08-01');
    assert.equal(log['Жим'].length, 1);
    assert.equal(log['Жим'][0].kg, 102);
  });

  it('та сама вага повторно — не подія', () => {
    let log = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    const same = H.appendWeight(log, 'Жим', 100, '2026-08-08');
    assert.equal(same['Жим'].length, 1);
  });

  it('вхідний журнал НЕ мутується', () => {
    const src = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    const snapshot = JSON.stringify(src);
    H.appendWeight(src, 'Жим', 120, '2026-08-08');
    H.appendWeight(src, 'Присід', 140, '2026-08-08');
    assert.equal(JSON.stringify(src), snapshot);
  });

  it('сміття не ламає журнал', () => {
    const log = H.appendWeight({}, 'Жим', 100, '2026-08-01');
    assert.equal(H.appendWeight(log, 'Жим', NaN), log);
    assert.equal(H.appendWeight(log, '', 50), log);
    assert.equal(H.appendWeight(log, 'Жим', -5), log);
    assert.equal(H.appendWeight(null, 'Жим', NaN)['Жим'], undefined);
  });

  it('дельта рахується від першого до останнього', () => {
    let log = {};
    log = H.appendWeight(log, 'Жим', 100, '2026-06-01');
    log = H.appendWeight(log, 'Жим', 95, '2026-07-01');   // деолоад теж історія
    log = H.appendWeight(log, 'Жим', 107.5, '2026-08-01');
    const d = H.weightDelta(log, 'Жим');
    assert.equal(d.first, 100);
    assert.equal(d.last, 107.5);
    assert.equal(d.delta, 7.5);
    assert.equal(d.count, 3);
  });

  it('weightNames сортує за свіжістю останньої зміни', () => {
    let log = {};
    log = H.appendWeight(log, 'Старе', 50, '2026-01-01');
    log = H.appendWeight(log, 'Свіже', 60, '2026-08-01');
    assert.equal(H.weightNames(log).join(','), 'Свіже,Старе');
  });
});

describe('спарклайн', () => {
  it('порожня чи одноточкова серія — порожній шлях', () => {
    assert.equal(H.sparklinePath([], 100, 30), '');
    assert.equal(H.sparklinePath([{ d: '2026-08-01', kg: 100 }], 100, 30), '');
  });

  it('дві точки — шлях M…L… у межах полотна', () => {
    const p = H.sparklinePath(
      [{ d: '2026-08-01', kg: 100 }, { d: '2026-08-15', kg: 110 }], 100, 30, 2);
    assert.match(p, /^M2\.0 28\.0L98\.0 2\.0$/);
  });

  it('плоска серія малюється по центру, без ділення на нуль', () => {
    const p = H.sparklinePath(
      [{ d: '2026-08-01', kg: 100 }, { d: '2026-08-15', kg: 100 }], 100, 30);
    assert.ok(p.includes(' 15.0'));
  });
});

describe('sessionLog', () => {
  it('один запис на день; повтор оновлює, а не дублює', () => {
    let log = H.upsertSession({}, '2026-08-17', { programId: 'ppl', days: 6, dayIdx: 2, title: 'Ноги', done: 3, total: 8 });
    log = H.upsertSession(log, '2026-08-17', { programId: 'ppl', days: 6, dayIdx: 2, title: 'Ноги', done: 8, total: 8 });
    assert.equal(Object.keys(log).length, 1);
    assert.equal(log['2026-08-17'].done, 8);
    assert.equal(log['2026-08-17'].title, 'Ноги');
  });

  it('різні дні накопичуються', () => {
    let log = H.upsertSession({}, '2026-08-15', { programId: 'p', dayIdx: 0, title: 'A', done: 5, total: 5 });
    log = H.upsertSession(log, '2026-08-17', { programId: 'p', dayIdx: 1, title: 'B', done: 2, total: 6 });
    assert.equal(Object.keys(log).length, 2);
  });
});

describe('mealLog: закриття дня', () => {
  it('запис памʼятає ціль свого дня', () => {
    let log = H.closeDay({}, '2026-08-16', { kcal: 2500.4, p: 150.6, f: 70, c: 300, fiber: 30 }, 2938);
    // …профіль змінився, ціль тепер інша — старий запис не рухається
    log = H.closeDay(log, '2026-08-17', { kcal: 2100, p: 140, f: 60, c: 250, fiber: 25 }, 2600);
    assert.equal(log['2026-08-16'].target, 2938);
    assert.equal(log['2026-08-17'].target, 2600);
    assert.equal(log['2026-08-16'].kcal, 2500);
    assert.equal(log['2026-08-16'].p, 151);
  });

  it('день без норми закривається без target', () => {
    const log = H.closeDay({}, '2026-08-17', { kcal: 1800 }, null);
    assert.equal(log['2026-08-17'].kcal, 1800);
    assert.equal('target' in log['2026-08-17'], false);
  });

  it('lastEntries віддає нові першими і фільтрує сміттєві ключі', () => {
    const log = { '2026-08-15': { kcal: 1 }, '2026-08-17': { kcal: 3 }, 'мусор': { kcal: 9 }, '2026-08-16': { kcal: 2 } };
    const out = H.lastEntries(log, 2);
    assert.equal(out.length, 2);
    assert.equal(out[0].d, '2026-08-17');
    assert.equal(out[1].d, '2026-08-16');
  });
});

/* =========================================================================
   Етап «завершення тренування»: нові поля запису сесії.
   ========================================================================= */
describe('history-core: сесія з підходами і завершенням', () => {
  it('doneSets/totalSets/end/ex проходять і санітизуються', () => {
    const log = H.upsertSession({}, '2026-09-01', {
      programId: 'ppl', days: 6, dayIdx: 2, title: 'Pull', done: 3, total: 5,
      doneSets: 9, totalSets: 15, end: 1,
      ex: [
        { n: 'Тяга', ds: 4, ps: 4, kg: 90, r: 7 },
        { n: 'Підйом', ds: 99, ps: 3, kg: 9999, r: -2 },     // сміття → кламп/відкидання
        { n: '', ds: 2, ps: 2 },                              // без назви — геть
        { n: 'Планка', ds: 1, ps: 2 }                         // без ваги — ок
      ]
    });
    const s = log['2026-09-01'];
    assert.equal(s.doneSets, 9);
    assert.equal(s.totalSets, 15);
    assert.equal(s.end, 1);
    assert.equal(s.ex.length, 3);                 // порожня назва відкинута
    assert.equal(s.ex[0].kg, 90);
    assert.equal(s.ex[1].ds, 10);                 // кламп 0..10
    assert.equal(s.ex[1].kg, undefined);          // 9999 не вага
    assert.equal(s.ex[1].r, undefined);           // відʼємні повтори — геть
    assert.equal(s.ex[2].kg, undefined);
  });

  it('end не знімається пізнішим дописом без end', () => {
    let log = H.upsertSession({}, '2026-09-01',
      { programId: 'p', days: 3, dayIdx: 0, done: 2, total: 4, end: 1 });
    log = H.upsertSession(log, '2026-09-01',
      { programId: 'p', days: 3, dayIdx: 0, done: 3, total: 4 });
    assert.equal(log['2026-09-01'].end, 1);
  });

  it('старі записи без нових полів лишаються валідними', () => {
    const log = H.upsertSession({}, '2026-09-02',
      { programId: 'p', days: 3, dayIdx: 1, done: 4, total: 4 });
    const s = log['2026-09-02'];
    assert.equal(s.done, 4);
    assert.equal(s.end, undefined);
    assert.equal(s.ex, undefined);
    assert.equal(s.doneSets, undefined);
  });
});

/* ==========================================================================
   Час сесії: t0 — початок, t1 — остання дія
   ==========================================================================
   Реальний баг. js/workout.js кладе t0 = Date.now() у КОЖЕН запис сесії, а
   їх за тренування десятки — по одному на галочку. Умова
   `Number(session.t0) || Number(prev.t0)` виглядала як «новий, інакше
   старий», але перший операнд ніколи не був порожній: prev.t0 не читався
   жодного разу, і початок сесії щоразу переписувався поточним часом.

   Наслідок був не косметичний. t0 завжди дорівнював t1, тому
   ProgressCore.sessionMinutes (він вимагає t1 > t0) повертав null для всіх
   сесій — уся статистика тривалості тренувань показувала «замало даних»
   назавжди, а в журналі стояло «Час: 17:27 → 17:27».

   Тестів на t0/t1 у цьому файлі не було жодного — тому баг і дожив до
   продакшену.
   ========================================================================== */
describe('Сесія: час початку й кінця', () => {
  const D = '2026-09-05';
  const T = Date.UTC(2026, 8, 5, 15, 0, 0);
  const rec = (t, done) => ({
    programId: 'fullbody', days: 3, dayIdx: 0, title: 'Lower',
    done: done, total: 6, doneSets: done * 3, totalSets: 18,
    t0: t, t1: t, sets: done * 3, reps: done * 30, vol: done * 800
  });

  it('початок сесії не перетирається наступними галочками', () => {
    let log = {};
    log = H.upsertSession(log, D, rec(T, 1));
    log = H.upsertSession(log, D, rec(T + 15 * 60000, 3));
    log = H.upsertSession(log, D, rec(T + 60 * 60000, 6));
    assert.equal(log[D].t0, T, 't0 має лишитись часом ПЕРШОГО запису');
    assert.equal(log[D].t1, T + 60 * 60000, 't1 має бути часом ОСТАННЬОГО');
    assert.equal((log[D].t1 - log[D].t0) / 60000, 60, 'тривалість — 60 хв');
  });

  it('запис, що прийшов не по порядку, не зсуває початок уперед', () => {
    // Черга збережень може доставити ранній запис пізніше за пізній.
    let log = H.upsertSession({}, D, rec(T + 30 * 60000, 4));
    log = H.upsertSession(log, D, rec(T, 1));
    assert.equal(log[D].t0, T, 'беремо найраніший, а не «prev виграє»');
    assert.equal(log[D].t1, T + 30 * 60000, 't1 не відкочується назад');
  });

  it('t1 ніколи не менший за t0', () => {
    const log = H.upsertSession({}, D, Object.assign(rec(T, 2), { t1: T - 99999 }));
    assert.ok(log[D].t1 >= log[D].t0, 'кінець не може бути раніше за початок');
  });

  it('перша сесія без попередньої пише свій час як є', () => {
    const log = H.upsertSession({}, D, rec(T, 1));
    assert.equal(log[D].t0, T);
    assert.equal(log[D].t1, T);
  });

  it('старий запис без часу не отримує вигаданого', () => {
    const bare = { programId: 'fullbody', days: 3, dayIdx: 0, title: 'Lower', done: 2, total: 6 };
    const log = H.upsertSession({}, D, bare);
    assert.equal('t0' in log[D], false, 'поля часу немає — і не вигадуємо');
    assert.equal('t1' in log[D], false);
  });

  it('дописування до старого запису без часу заводить час із нового', () => {
    let log = H.upsertSession({}, D, { programId: 'f', days: 3, dayIdx: 0, title: 'Lower', done: 1, total: 6 });
    log = H.upsertSession(log, D, rec(T, 2));
    assert.equal(log[D].t0, T);
  });
});

/*
 * Санітизація підходів у знімку сесії (ex[].s).
 *
 * TST-005: рядки 239–249 history-core.js не виконував жоден тест — мутанти
 * «зняти верхню межу ваги» і «зняти верхню межу повторень» виживали. Це
 * ЄДИНА санітизація на шляху «імпорт або зіпсований localStorage →
 * sessionLog», а з sessionLog exercise-core бере топ-сет, обʼєм, e1RM і
 * рекорди. Сміття, що просочилось сюди, стає особистим рекордом назавжди.
 */
describe('sessionLog: підходи в знімку сесії', () => {
  const session = (ex) => ({ programId: 'p', days: 3, dayIdx: 0, title: 'День', done: 1, total: 1, ex: ex });

  it('нереальна вага, нуль повторень і 500 повторень відкидаються', () => {
    const log = H.upsertSession({}, '2026-08-01', session([
      { n: 'Жим', ps: 3, ds: 3, s: [{ w: 9999, r: 8 }, { w: 82.4, r: 0 }, { w: 100, r: 500 }] }
    ]));
    const s = log['2026-08-01'].ex[0].s;
    assert.equal(s.length, 3);
    assert.equal(s[0].w, undefined, 'вага 9999 кг — не вага');
    assert.equal(s[0].r, 8);
    assert.equal(s[1].w, 82.5, 'вага округлюється до 0,5 кг');
    assert.equal(s[1].r, undefined, 'нуль повторень — це не підхід');
    assert.equal(s[2].r, undefined, '500 повторень — не повторення');
  });

  it('підходів не більше, ніж заплановано', () => {
    /* ds — скільки підходів у плані. Більше, ніж закрито, у знімку бути
       не може: інакше імпорт малює обʼєм, якого не було. */
    const log = H.upsertSession({}, '2026-08-02', session([
      { n: 'Жим', ps: 2, ds: 2, s: [{ w: 100, r: 5 }, { w: 100, r: 5 }, { w: 100, r: 5 }, { w: 100, r: 5 }] }
    ]));
    assert.equal(log['2026-08-02'].ex[0].s.length, 2);
  });

  it('відʼємна вага відкидається, нульова лишається', () => {
    /* Нуль — це вага власного тіла (підтягування), і вона законна. */
    const log = H.upsertSession({}, '2026-08-03', session([
      { n: 'Підтягування', ps: 1, ds: 2, s: [{ w: -5, r: 10 }, { w: 0, r: 10 }] }
    ]));
    const s = log['2026-08-03'].ex[0].s;
    assert.equal(s[0].w, undefined);
    assert.equal(s[1].w, 0);
  });

  it('сміття замість масиву підходів не ламає запис', () => {
    for (const junk of ['ой', 42, { w: 1 }, null]) {
      const log = H.upsertSession({}, '2026-08-04', session([{ n: 'Жим', ps: 1, ds: 3, s: junk }]));
      assert.equal(log['2026-08-04'].ex[0].s, undefined, String(junk));
    }
  });
});

/*
 * Знімок позицій дня (F1).
 *
 * mealLog тримав лише підсумки, і «скопіювати день» не мало з чого
 * робитись. Тепер запис може нести ще й позиції — але саме тому мусить
 * їх ВІДПУСКАТИ: підсумок дня важить сорок байтів, позиції — кілобайт,
 * і профіль, який тільки росте, одного дня не збережеться.
 */
describe('mealLog: знімок позицій', () => {
  const snap = (kcal) => [{ name: 'Сніданок', items: [
    { kind: 'snap', name: 'Щось', unit: 'g', qty: 100, per: { kcal: kcal / 100 } }
  ] }];
  const T = { kcal: 2000, p: 150, f: 60, c: 200, fiber: 25 };

  it('знімок лягає в запис, а без нього запис лишається підсумком', () => {
    const withSnap = H.closeDay({}, '2026-09-01', T, 2200, 150, snap(500));
    assert.ok(Array.isArray(withSnap['2026-09-01'].meals));
    const без = H.closeDay({}, '2026-09-01', T, 2200, 150);
    assert.equal(без['2026-09-01'].meals, undefined);
    assert.equal(без['2026-09-01'].kcal, 2000, 'підсумок мусить лишитись на місці');
  });

  it('порожній масив знімком не вважається', () => {
    const log = H.closeDay({}, '2026-09-01', T, 2200, 150, []);
    assert.equal(log['2026-09-01'].meals, undefined);
  });

  it('знімки старших за SNAPSHOT_DAYS днів зникають, підсумки лишаються', () => {
    let log = {};
    /* SNAPSHOT_DAYS + 3 закриті дні підряд */
    for (let i = 1; i <= H.SNAPSHOT_DAYS + 3; i++) {
      const d = '2026-09-' + String(i).padStart(2, '0');
      log = H.closeDay(log, d, T, 2200, 150, snap(400));
    }
    const dates = Object.keys(log).sort();
    assert.equal(dates.length, H.SNAPSHOT_DAYS + 3);
    const withMeals = dates.filter((d) => log[d].meals);
    assert.equal(withMeals.length, H.SNAPSHOT_DAYS);
    /* Зникнути мусять НАЙСТАРШІ, а не випадкові */
    assert.equal(withMeals[0], dates[3]);
    /* Підсумок найстаршого дня на місці — історія не коротшає */
    assert.equal(log[dates[0]].kcal, 2000);
    assert.equal(log[dates[0]].target, 2200);
  });

  it('closeDay не мутує вхідний журнал', () => {
    const before = H.closeDay({}, '2026-09-01', T, 2200, 150, snap(400));
    const frozen = JSON.stringify(before);
    H.closeDay(before, '2026-09-02', T, 2200, 150, snap(400));
    assert.equal(JSON.stringify(before), frozen);
  });

  it('copySources віддає лише дні зі знімком, новіші першими', () => {
    let log = { '2026-08-01': { kcal: 1800, p: 120, f: 50, c: 180, fiber: 20 } };
    log = H.closeDay(log, '2026-09-01', T, 2200, 150, snap(400));
    log = H.closeDay(log, '2026-09-03', T, 2200, 150, snap(400));
    const src = H.copySources(log);
    assert.equal(src.length, 2, 'день без знімка потрапив у джерела');
    assert.equal(src[0].d, '2026-09-03');
    assert.equal(src[1].d, '2026-09-01');
  });

  it('copySources не пропонує день, у знімку якого нема жодної позиції', () => {
    const log = { '2026-09-01': { kcal: 100, p: 1, f: 1, c: 1, fiber: 0,
                                  meals: [{ name: 'A', items: [] }] } };
    assert.equal(H.copySources(log).length, 0);
  });

  it('copySources не падає на смітті замість журналу', () => {
    for (const bad of [null, undefined, 'ні', 42, []]) {
      assert.equal(H.copySources(bad).length, 0);
    }
  });
});

/*
 * Швидкий запис дня (F2).
 *
 * Порожній день для аналітики означає «не їв», що неправда: без цього
 * режиму кожен ресторан занижував би середнє спожите, а отже завищував
 * розрахункові витрати. Головне, що тут під охороною, — різниця між
 * «нуль» і «невідомо».
 */
describe('mealLog: швидкий запис', () => {
  it('пише ккал, білок і прапорець, жир з вуглеводами лишає нулями', () => {
    const log = H.quickDay({}, '2026-09-10', 2150, 140, 2200, 150);
    const e = log['2026-09-10'];
    assert.equal(e.kcal, 2150);
    assert.equal(e.p, 140);
    assert.equal(e.f, 0);
    assert.equal(e.c, 0);
    assert.equal(e.partial, true);
    assert.equal(e.target, 2200);
    assert.equal(e.pTarget, 150);
  });

  it('білок необовʼязковий: без нього запис усе одно є', () => {
    const log = H.quickDay({}, '2026-09-10', 2150, null, 2200, 150);
    assert.equal(log['2026-09-10'].kcal, 2150);
    assert.equal(log['2026-09-10'].p, 0);
    assert.equal(log['2026-09-10'].partial, true);
  });

  it('нуль або сміття замість калорій не створює дня', () => {
    for (const bad of [0, -100, NaN, null, undefined, 'багато']) {
      const log = H.quickDay({}, '2026-09-10', bad, 100, 2200, 150);
      assert.equal(log['2026-09-10'], undefined, String(bad));
    }
  });

  it('швидкий поверх розібраного дня не лишає по собі ні БЖВ, ні знімка', () => {
    const full = H.closeDay({}, '2026-09-10',
      { kcal: 2000, p: 150, f: 70, c: 200, fiber: 30 }, 2200, 150,
      [{ name: 'Обід', items: [{ kind: 'snap', name: 'X', unit: 'g', qty: 10, per: { kcal: 1 } }] }]);
    assert.equal(full['2026-09-10'].f, 70);
    assert.ok(full['2026-09-10'].meals);

    const quick = H.quickDay(full, '2026-09-10', 1800, null, 2200, 150);
    const e = quick['2026-09-10'];
    assert.equal(e.kcal, 1800);
    assert.equal(e.f, 0, 'жир із розібраного дня лишився — запис бреше точністю');
    assert.equal(e.meals, undefined, 'знімок позицій лишився під приблизним записом');
    assert.equal(e.partial, true);
  });

  it('перехід приблизний → повний знімає прапорець, а не дублює день', () => {
    let log = H.quickDay({}, '2026-09-10', 1800, null, 2200, 150);
    log = H.closeDay(log, '2026-09-10',
      { kcal: 2000, p: 150, f: 70, c: 200, fiber: 30 }, 2200, 150);
    assert.equal(Object.keys(log).length, 1, 'зʼявився другий запис за той самий день');
    assert.equal(log['2026-09-10'].partial, undefined);
    assert.equal(log['2026-09-10'].f, 70);
  });

  it('quickDay не мутує вхідний журнал', () => {
    const before = H.quickDay({}, '2026-09-10', 1800, null, 2200, 150);
    const frozen = JSON.stringify(before);
    H.quickDay(before, '2026-09-11', 1900, 120, 2200, 150);
    assert.equal(JSON.stringify(before), frozen);
  });

  it('countsProtein: «невідомо» — це не «нуль»', () => {
    assert.equal(H.countsProtein({ kcal: 2000, p: 0 }), true, 'повний день з нулем білка — виміряний нуль');
    assert.equal(H.countsProtein({ kcal: 2000, p: 0, partial: true }), false);
    assert.equal(H.countsProtein({ kcal: 2000, p: 140, partial: true }), true);
    assert.equal(H.countsProtein(null), false);
  });
});
