/**
 * ФІНАЛЬНИЙ ADVERSARIAL BROWSER TEST — реально виконується в headless-браузері.
 *
 * Це НЕ рев'ю коду. Кожна перевірка нижче справді відкриває сторінку Get Stronger,
 * жме реальні кнопки/поля сотні-тисячі разів і читає РЕЗУЛЬТАТ із DOM та зі
 * збереженого профілю (window.Store.localProfile / window.PlanEngine.current).
 *
 * Що перевіряється (усе ACTUALLY EXECUTED):
 *   A. SETS INPUT CHAOS — сміття в поле «підходи», DOM+persist у межах 1..10.
 *   B. ADD-MUSCLE SPAM ×100 — тижнева стеля не пробивається (.vol--over === 0).
 *   C. DEL SPAM — швидке видалення вправ не валить сторінку, план лишається валідним.
 *   D. SWAP CHAOS — заміна вправ спамом: без дублів, без перевищення стелі.
 *   E. WEIGHT INPUT CHAOS — сміття в поле ваги, persist ∈ {null} ∪ [0..500].
 *   F. TOGGLE-EDIT SPAM ×200 — вхід/вихід із режиму правки без росту вузлів/слухачів.
 *   G. PROFILE SAVE ×1000 — регрес фризу: без росту вузлів і слухачів (guard `wired`).
 *   H. NAVIGATION ×300 — реальні переходи між сторінками, 0 pageerror.
 *   I. IMPORT CHAOS — биті/величезні/сміттєві JSON у #p-import-file, сайт живий.
 *   J. DATA INTEGRITY — після всього хаосу профіль читається й структурно цілий.
 *
 * Свідомо НЕ виконується тут (позначено як CODE REVIEW ONLY у фінальному звіті):
 *   — Cloud save-spam проти реального Supabase (Add/Save/Delete/Complete ×1000
 *     із автентифікацією): потребує живих креденшелів і бомбардував би
 *     продакшн. Логіку черги/дедуплікації збережень перевірено рев'ю коду.
 */
import { chromium } from 'playwright';
import { CHROME } from './pw.mjs';
const ROOT = process.cwd();

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const section = (t) => console.log('\n=== ' + t + ' ===');

const PROFILE = {
  version: 10, sex: 'male', birthDate: '1995-06-15', age: 31, weight: 82, height: 180,
  activity: 1.55, trainingAge: 'inter', activePlan: { programId: 'ppl', days: 6 },
  programId: 'ppl', daysPerWeek: 6, weights: { 'Жим лежачи': 100 }, workLog: { '2026-08-20': true }
};

const b = await chromium.launch({ executablePath: CHROME });

/* Свіжий контекст із засіяним локальним профілем ДО скриптів сторінки. */
async function freshCtx(vp = { width: 1100, height: 950 }) {
  const ctx = await b.newContext({ viewport: vp });
  await ctx.addInitScript((prof) => {
    try {
      localStorage.setItem('ib.cloud', '0');
      localStorage.setItem('ib.profile', JSON.stringify(prof));
    } catch (_) {}
  }, PROFILE);
  /* Зовнішні шрифти/аналітика не стосуються JS застосунку і лише сповільнюють
     тисячі перезавантажень — глушимо, щоб тест був швидким і детермінованим. */
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (/fonts\.googleapis|fonts\.gstatic|google\.com|gstatic\.com|googletagmanager|google-analytics/.test(u)) {
      return route.abort();
    }
    return route.continue();
  });
  return ctx;
}

/* Інструментація протікання слухачів: рахуємо addEventListener ЛИШЕ на
   ПОСТІЙНИХ цілях (document / window / #profile / #plan). Саме там жив фриз —
   на вузлах, які НЕ замінюються ререндером. Слухачі на тимчасових вузлах
   (кнопки в перемальованій таблиці) — норма: вони гинуть разом із вузлом. */
const PERSIST_PROBE = () => {
  window.__persistAdds = 0;
  const proto = EventTarget.prototype;
  const orig = proto.addEventListener;
  proto.addEventListener = function () {
    try {
      if (this === document || this === window ||
          (this && this.nodeType === 1 && (this.id === 'profile' || this.id === 'plan'))) {
        window.__persistAdds++;
      }
    } catch (_) {}
    return orig.apply(this, arguments);
  };
};

/** Прочитати живий план + збережений профіль і звести до валідаційних чисел. */
async function planStats(p) {
  return await p.evaluate(() => {
    const out = { liveSets: [], persistSets: [], weights: [], over: 0, dupInDay: 0, error: null };
    try {
      out.over = document.querySelectorAll('.vol--over').length;
      const live = (window.PlanEngine && window.PlanEngine.current().plan) || [];
      live.forEach(function (day) {
        const seen = {};
        day.exercises.forEach(function (ex) {
          out.liveSets.push(Number(ex.sets));
          if (seen[ex.name]) out.dupInDay++;
          seen[ex.name] = 1;
        });
      });
      const prof = window.Store.localProfile ? window.Store.localProfile() : {};
      const cp = (prof && prof.customPlans) || {};
      Object.keys(cp).forEach(function (k) {
        (cp[k] || []).forEach(function (day) {
          (day.exercises || []).forEach(function (ex) { out.persistSets.push(Number(ex.sets)); });
        });
      });
      const w = (prof && prof.weights) || {};
      Object.keys(w).forEach(function (k) { out.weights.push(w[k]); });
    } catch (e) { out.error = e.message; }
    return out;
  });
}

const allSetsValid = (arr) => arr.length > 0 && arr.every(function (s) { return Number.isInteger(s) && s >= 1 && s <= 10; });
const allWeightsValid = (arr) => arr.every(function (w) { return w === null || (Number.isFinite(w) && w >= 0 && w <= 500); });

/* ------------------------------------------------------------------ */
/* Відкриваємо план у режимі правки                                    */
/* ------------------------------------------------------------------ */
let ctx = await freshCtx();
let p = await ctx.newPage();
const errsPlan = []; p.on('pageerror', e => errsPlan.push(e.message));
await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
await p.waitForTimeout(900);
await p.click('#toggle-edit');
await p.waitForTimeout(500);

const base = await planStats(p);
section('Стартовий стан плану');
ok('план прочитано (PlanEngine + Store.localProfile)', base.error === null, base.error || '');
ok('стартом підходи валідні (1..10)', allSetsValid(base.liveSets), base.liveSets.length + ' вправ');
ok('стартом немає перевищення стелі (.vol--over === 0)', base.over === 0, 'over=' + base.over);

/* ------------------------------------------------------------------ */
/* A. SETS INPUT CHAOS                                                  */
/* ------------------------------------------------------------------ */
section('A. SETS INPUT CHAOS — сміття в поле «підходи»');
const SETS_GARBAGE = ['NaN', 'Infinity', '-Infinity', '1e999', '-999999', '999999999', '0', '7.5', '', 'abc', '-5', '100', '11'];
let setsChaosErr = 0;
{
  const cnt = await p.locator('[data-act="sets"]').count();
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < cnt; i++) {
      const g = SETS_GARBAGE[(i + round) % SETS_GARBAGE.length];
      /* Реальний шлях: ставимо значення в поле й кидаємо 'change' — саме
         так поле поводиться, коли людина ввела число й пішла з поля. */
      const set = await p.evaluate(function (args) {
        const els = document.querySelectorAll('[data-act="sets"]');
        const el = els[args.i];
        if (!el) return false;
        el.value = args.g;                       // number-input сам санітизує нечислове
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, { i, g });
      if (!set) setsChaosErr++;
    }
    await p.waitForTimeout(60);
  }
}
const afterSets = await planStats(p);
ok('після sets-хаосу: усі живі підходи ∈ [1..10]', allSetsValid(afterSets.liveSets), 'мін=' + Math.min(...afterSets.liveSets) + ' макс=' + Math.max(...afterSets.liveSets));
ok('після sets-хаосу: збережені підходи ∈ [1..10]', allSetsValid(afterSets.persistSets), afterSets.persistSets.length + ' збережених');
ok('після sets-хаосу: стеля не пробита (.vol--over === 0)', afterSets.over === 0, 'over=' + afterSets.over);
ok('після sets-хаосу: без JS-помилок', errsPlan.length === 0, errsPlan.slice(0, 3).join(' | '));

/* ------------------------------------------------------------------ */
/* B. ADD-MUSCLE SPAM ×100                                              */
/* ------------------------------------------------------------------ */
section('B. ADD-MUSCLE SPAM ×100 — стеля тижневого обʼєму');
{
  const opts = await p.evaluate(() => {
    const sel = document.querySelector('[data-act="add-muscle"]');
    return sel ? Array.from(sel.options).map(o => o.value).filter(Boolean) : [];
  });
  ok('є опції add-muscle', opts.length > 0, opts.length + ' груп');
  for (let n = 0; n < 100; n++) {
    const val = opts[n % opts.length];
    await p.evaluate(function (v) {
      const sels = document.querySelectorAll('[data-act="add-muscle"]');
      const sel = sels[Math.floor(Math.random() * sels.length)] || sels[0];
      if (!sel) return;
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, val);
    if (n % 20 === 0) await p.waitForTimeout(20);
  }
  await p.waitForTimeout(150);
}
const afterAdd = await planStats(p);
ok('add-spam: жодна група не пробила стелю (.vol--over === 0)', afterAdd.over === 0, 'over=' + afterAdd.over);
ok('add-spam: усі підходи лишились ∈ [1..10]', allSetsValid(afterAdd.liveSets), 'вправ=' + afterAdd.liveSets.length);
ok('add-spam: без дублів вправ у межах дня', afterAdd.dupInDay === 0, 'дублів=' + afterAdd.dupInDay);
ok('add-spam: без JS-помилок', errsPlan.length === 0, errsPlan.slice(0, 3).join(' | '));

/* ------------------------------------------------------------------ */
/* C. DEL SPAM                                                          */
/* ------------------------------------------------------------------ */
section('C. DEL SPAM — швидке видалення вправ');
{
  /* Автоприймання можливих confirm (їх тут не має бути, але страхуємось). */
  p.on('dialog', d => d.accept().catch(() => {}));
  let guard = 0;
  while (guard++ < 300) {
    const n = await p.locator('[data-act="del"]:not([disabled])').count();
    if (n === 0) break;
    /* Завжди перший кошик: після видалення індекси зсуваються — топовий
       ризик подвійного кліку по застарілому data-i саме тут. */
    await p.evaluate(() => {
      const el = document.querySelector('[data-act="del"]:not([disabled])');
      if (el) el.click();
    });
    if (guard % 10 === 0) await p.waitForTimeout(15);
  }
  await p.waitForTimeout(150);
}
const afterDel = await planStats(p);
ok('del-spam: сторінка не впала, план читається', afterDel.error === null, afterDel.error || '');
ok('del-spam: залишкові підходи валідні (або план порожній)', afterDel.liveSets.every(s => Number.isInteger(s) && s >= 1 && s <= 10), 'залишок=' + afterDel.liveSets.length);
ok('del-spam: без перевищення стелі', afterDel.over === 0, 'over=' + afterDel.over);
ok('del-spam: без JS-помилок', errsPlan.length === 0, errsPlan.slice(0, 3).join(' | '));

await p.close(); await ctx.close();

/* ------------------------------------------------------------------ */
/* D. SWAP CHAOS + E. WEIGHT INPUT CHAOS (свіжа сторінка)               */
/* ------------------------------------------------------------------ */
ctx = await freshCtx();
p = await ctx.newPage();
const errsPlan2 = []; p.on('pageerror', e => errsPlan2.push(e.message));
p.on('dialog', d => d.accept().catch(() => {}));
await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
await p.waitForTimeout(900);
await p.click('#toggle-edit');
await p.waitForTimeout(500);

section('D. SWAP CHAOS — заміна вправ спамом');
{
  const swapOpts = await p.evaluate(() => {
    const sel = document.querySelector('[data-act="swap"]');
    return sel ? Array.from(sel.options).map(o => o.value).filter(Boolean) : [];
  });
  const swapCnt = await p.locator('[data-act="swap"]').count();
  for (let n = 0; n < 120 && swapOpts.length; n++) {
    const val = swapOpts[n % swapOpts.length];
    await p.evaluate(function (args) {
      const sels = document.querySelectorAll('[data-act="swap"]');
      const sel = sels[args.i % sels.length];
      if (!sel) return;
      sel.value = args.v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, { i: n, v: val });
    if (n % 20 === 0) await p.waitForTimeout(20);
  }
  await p.waitForTimeout(150);
}
const afterSwap = await planStats(p);
ok('swap-spam: без дублів вправ у межах дня', afterSwap.dupInDay === 0, 'дублів=' + afterSwap.dupInDay);
ok('swap-spam: без перевищення стелі (.vol--over === 0)', afterSwap.over === 0, 'over=' + afterSwap.over);
ok('swap-spam: підходи валідні ∈ [1..10]', allSetsValid(afterSwap.liveSets), 'вправ=' + afterSwap.liveSets.length);

section('E. WEIGHT INPUT CHAOS — сміття в поле ваги (type=text)');
const WEIGHT_GARBAGE = ['abc', 'NaN', 'Infinity', '-Infinity', '1e999', '-999999', '999999999', '99999', '0', '-5', '7.55', '250,5', '', 'null', '<script>', '   ', '1.2.3'];
{
  const cnt = await p.locator('[data-act="weight"]').count();
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < cnt; i++) {
      const g = WEIGHT_GARBAGE[(i + round) % WEIGHT_GARBAGE.length];
      await p.evaluate(function (args) {
        const els = document.querySelectorAll('[data-act="weight"]');
        const el = els[args.i];
        if (!el) return;
        el.value = args.g;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { i, g });
    }
    await p.waitForTimeout(60);
  }
}
await p.waitForTimeout(150);
const afterW = await planStats(p);
ok('weight-хаос: усі збережені ваги ∈ {null} ∪ [0..500]', allWeightsValid(afterW.weights), 'ваг=' + afterW.weights.length + ' зразок=' + JSON.stringify(afterW.weights.slice(0, 6)));
ok('weight-хаос: без JS-помилок', errsPlan2.length === 0, errsPlan2.slice(0, 3).join(' | '));

/* ------------------------------------------------------------------ */
/* F. TOGGLE-EDIT SPAM ×200 — витік вузлів/слухачів                     */
/* ------------------------------------------------------------------ */
section('F. TOGGLE-EDIT SPAM ×200');
{
  await p.evaluate(PERSIST_PROBE);
  /*
   * ТОСТИ НЕ РАХУЮТЬСЯ.
   *
   * Попередній розділ навмисно шле десятки НЕПРИЙНЯТНИХ ваг, і кожна
   * тепер чесно відповідає тостом (UX-005). Тости живуть 3,5 секунди й
   * зникають самі — тобто між першим і другим виміром DOM встигав
   * СХУДНУТИ на цілий десяток вузлів, і перевірка на витік падала на
   * власному прибиранні. Рахуємо все, крім контейнера тостів.
   */
  const countNodes = () => p.evaluate(() =>
    document.querySelectorAll('*').length -
    document.querySelectorAll('.toasts, .toasts *').length);
  const nodes0 = await countNodes();
  const adds0 = await p.evaluate(() => window.__persistAdds);
  for (let n = 0; n < 200; n++) {
    await p.evaluate(() => { const b = document.querySelector('#toggle-edit'); if (b) b.click(); });
    if (n % 25 === 0) await p.waitForTimeout(10);
  }
  await p.waitForTimeout(200);
  const nodes1 = await countNodes();
  const adds1 = await p.evaluate(() => window.__persistAdds);
  /* Вузли після парної кількості перемикань мають повернутись до вихідного
     порядку; допускаємо невеликий дельта на тост/банер. */
  ok('toggle-spam: без розростання DOM (Δ вузлів < 60)', Math.abs(nodes1 - nodes0) < 60, 'Δ=' + (nodes1 - nodes0) + ' (' + nodes0 + '→' + nodes1 + ')');
  /* Справжній сигнал фризу: слухачі на ПОСТІЙНИХ вузлах (#plan/document).
     Мають лишитись 0 — усе дротування зроблено раз в init до цього циклу. */
  ok('toggle-spam: 0 нових слухачів на постійних вузлах (#plan/document)', (adds1 - adds0) === 0, 'нових persist-слухачів=' + (adds1 - adds0) + ' на 200 перемикань');
  ok('toggle-spam: без JS-помилок', errsPlan2.length === 0, errsPlan2.slice(0, 3).join(' | '));
}

await p.close(); await ctx.close();

/* ------------------------------------------------------------------ */
/* G. PROFILE SAVE ×1000 — регрес фризу (guard `wired`)                 */
/* ------------------------------------------------------------------ */
/*
 * Тут колись клікали по перемикачу тем: він писав у профіль на кожен клік
 * і був найзручнішим способом розкрутити петлю
 * saveProfile -> onChange -> renderAll -> +слухач.
 *
 * Перемикача більше немає (оформлення одне), а петля лишилась — і guard
 * `wired` у wireProfileForm лишився єдиним, що її тримає. Тож б'ємо в саму
 * петлю, без посередника-кнопки: тисяча записів у профіль підряд.
 */
section('G. PROFILE SAVE ×1000 — регрес фризу (wireProfileForm)');
ctx = await freshCtx({ width: 480, height: 950 });
p = await ctx.newPage();
const errsAcc = []; p.on('pageerror', e => errsAcc.push(e.message));
await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
await p.waitForTimeout(1000);
{
  ok('форма профілю присутня', await p.locator('#profile [data-p]').count() >= 3,
     'полів=' + await p.locator('#profile [data-p]').count());
  /* Фокус поза формою: renderAll свідомо не чіпає її, поки в ній друкують,
     і з фокусом усередині петля просто не почалась би. */
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await p.evaluate(PERSIST_PROBE);
  const nodes0 = await p.evaluate(() => document.querySelectorAll('*').length);
  const adds0 = await p.evaluate(() => window.__persistAdds);
  const t0 = Date.now();
  await p.evaluate(async () => {
    for (let n = 0; n < 1000; n++) await window.Store.saveProfile({ weight: 60 + (n % 40) });
  });
  const dt = Date.now() - t0;
  await p.waitForTimeout(200);
  const nodes1 = await p.evaluate(() => document.querySelectorAll('*').length);
  const adds1 = await p.evaluate(() => window.__persistAdds);
  const shown = await p.evaluate(() => {
    const el = document.querySelector('#profile [data-p="weight"]');
    return el ? Number(el.value) : null;
  });
  const saved = await p.evaluate(async () => (await window.Store.getProfile()).weight);
  ok('save×1000: не зависло (< 40 с)', dt < 40000, dt + ' мс (' + (dt / 1000).toFixed(1) + ' с)');
  ok('save×1000: без розростання DOM (Δ вузлів < 40)', Math.abs(nodes1 - nodes0) < 40, 'Δ=' + (nodes1 - nodes0));
  /* Ядро регресу фризу: 0 нових слухачів на #profile/document за 1000 записів. */
  ok('save×1000: 0 нових слухачів на постійних вузлах (#profile/document)', (adds1 - adds0) === 0, 'нових persist-слухачів=' + (adds1 - adds0));
  ok('save×1000: форма показує останнє збережене', shown === Number(saved), 'у полі ' + shown + ', у профілі ' + saved);
  ok('save×1000: без JS-помилок', errsAcc.length === 0, errsAcc.slice(0, 3).join(' | '));
}

/* ------------------------------------------------------------------ */
/* I. IMPORT CHAOS (та сама account-сторінка)                          */
/* ------------------------------------------------------------------ */
section('I. IMPORT CHAOS — биті/сміттєві JSON у #p-import-file');
{
  let dialogs = 0;
  const onDlg = d => { dialogs++; d.accept().catch(() => {}); };
  p.on('dialog', onDlg);
  const bad = [
    { name: 'broken.json', body: '{ this is not json ' },
    { name: 'array.json', body: '[1,2,3]' },
    { name: 'number.json', body: '42' },
    { name: 'null.json', body: 'null' },
    { name: 'empty.json', body: '' },
    { name: 'nofields.json', body: '{"totally":"unknown","x":1}' },
    { name: 'evil.json', body: '{"weight":"Infinity","height":"NaN","age":-9999,"sex":"<script>","weights":{"Жим":1e999}}' },
    { name: 'huge.json', body: JSON.stringify({ weights: Object.fromEntries(Array.from({ length: 60000 }, (_, i) => ['ex' + i, i % 500])) }) },
    { name: 'deep.json', body: '{"weights":{"a":' + '['.repeat(500) + '1' + ']'.repeat(500) + '}}' }
  ];
  for (const f of bad) {
    try {
      await p.setInputFiles('#p-import-file', { name: f.name, mimeType: 'application/json', buffer: Buffer.from(f.body) });
      await p.waitForTimeout(120);
    } catch (e) { /* setInputFiles на прихованому input дозволено Playwright */ }
  }
  await p.waitForTimeout(200);
  const alive = await p.evaluate(() => {
    try {
      const prof = window.Store.localProfile ? window.Store.localProfile() : null;
      return {
        ok: !!prof && typeof prof === 'object',
        ver: prof && prof.version,
        weightsOk: prof && prof.weights ? Object.values(prof.weights).every(v => v === null || (Number.isFinite(v) && v >= 0 && v <= 500)) : true,
        ageOk: prof && (prof.age === undefined || (Number.isFinite(prof.age) && prof.age >= 0 && prof.age < 120)),
        domAlive: !!document.querySelector('#profile')
      };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  p.off('dialog', onDlg);
  ok('import-хаос: профіль читається після серії битих файлів', alive.ok, 'ver=' + alive.ver);
  ok('import-хаос: ваги не забруднились нескінченностями/сміттям', alive.weightsOk === true, '');
  ok('import-хаос: вік лишився в межах або не встановлений', alive.ageOk === true, '');
  ok('import-хаос: DOM живий (форма профілю на місці)', alive.domAlive === true, '');
  ok('import-хаос: без JS-помилок', errsAcc.length === 0, errsAcc.slice(0, 3).join(' | '));
}

await p.close(); await ctx.close();

/* ------------------------------------------------------------------ */
/* L. TODAY «COMPLETE» SPAM — щоденні дії трекерів спамом               */
/* ------------------------------------------------------------------ */
section('L. TODAY «COMPLETE» SPAM — трекери дня');
ctx = await freshCtx({ width: 480, height: 950 });
p = await ctx.newPage();
const errsToday = []; p.on('pageerror', e => errsToday.push(e.message));
p.on('dialog', d => d.accept().catch(() => {}));
/* Контроли трекерів дня ЖИВУТЬ КУБИКАМИ НА «СЬОГОДНІ»: окрема сторінка
   вводу прибрана, «Трекери» стали налаштуваннями. Кубики треба спершу
   закріпити — типово на головній не стоїть жоден. */
/*
 * Реєстр дописується ІНІЦІАЛІЗАЦІЙНИМ СКРИПТОМ, а не через Store після
 * завантаження: контекст цього набору засіває ib.profile власним
 * addInitScript на КОЖНІЙ навігації, тож усе, збережене зі сторінки,
 * затирається наступним же переходом. Саме на цьому перевірка й показала
 * нуль контролів там, де їх мало бути чотири.
 */
await p.addInitScript(() => {
  try {
    const raw = JSON.parse(localStorage.getItem('ib.profile') || '{}');
    const mk = (id, type, name, order, goal) => ({
      id: id, type: type, name: name, enabled: true, pinned: true,
      settings: {}, goal: goal == null ? null : goal, source: null, order: order, createdAt: null
    });
    raw.trackers = {
      water: mk('water', 'water', 'Вода', 0, 2.5),
      sleep: mk('sleep', 'sleep', 'Сон', 1, 480),
      mood: mk('mood', 'mood', 'Настрій', 2, null),
      recovery: mk('recovery', 'recovery', 'Recovery', 5, null)
    };
    localStorage.setItem('ib.profile', JSON.stringify(raw));
  } catch (_) {}
});
await p.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
await p.waitForTimeout(1300);
{
  const controls = await p.evaluate(() => ({
    add: document.querySelectorAll('[data-trk-add]').length,
    scale: document.querySelectorAll('[data-trk-scale]').length,
    dur: document.querySelectorAll('[data-trk-durh]').length
  }));
  ok('є контроли трекерів дня', (controls.add + controls.scale + controls.dur) > 0, JSON.stringify(controls));
  /* 800 кліків упереміш по всіх контролях «виконано»: +дельта, шкала, тривалість. */
  for (let n = 0; n < 800; n++) {
    await p.evaluate((k) => {
      const sels = ['[data-trk-add]', '[data-trk-scale]', '[data-trk-duration]'];
      const sel = sels[k % sels.length];
      const els = document.querySelectorAll(sel);
      if (!els.length) return;
      els[k % els.length].click();
    }, n);
    if (n % 100 === 0) await p.waitForTimeout(10);
  }
  await p.waitForTimeout(200);
  const integ = await p.evaluate(() => {
    const out = { ok: true, bad: null, roundtrips: false };
    try {
      const prof = window.Store.localProfile();
      const log = prof.trackerLog || {};
      const scan = function (v) {
        if (typeof v === 'number') { if (!(Number.isFinite(v) && Math.abs(v) < 1e7)) { out.ok = false; out.bad = v; } }
        else if (v && typeof v === 'object') { Object.values(v).forEach(scan); }
      };
      Object.values(log).forEach(function (day) { if (day && typeof day === 'object') Object.values(day).forEach(scan); });
      out.roundtrips = JSON.stringify(log).indexOf('Infinity') === -1 && JSON.stringify(log).indexOf('NaN') === -1;
    } catch (e) { out.ok = false; out.bad = e.message; }
    return out;
  });
  ok('today-spam: усі значення трекерів скінченні й у розумних межах', integ.ok, 'погане=' + JSON.stringify(integ.bad));
  ok('today-spam: журнал серіалізується без Infinity/NaN', integ.roundtrips, '');
  ok('today-spam: сторінка не впала (без JS-помилок)', errsToday.length === 0, errsToday.slice(0, 3).join(' | '));
}
await p.close(); await ctx.close();

/* ------------------------------------------------------------------ */
/* H. NAVIGATION ×300 — реальні переходи, 0 pageerror                   */
/* ------------------------------------------------------------------ */
section('H. NAVIGATION ×300 — реальні переходи між сторінками');
ctx = await freshCtx();
p = await ctx.newPage();
const navErrs = [];
let navCur = '';
p.on('pageerror', e => navErrs.push(navCur + ': ' + e.message));
{
  const PAGES = ['index.html', 'plan.html', 'account.html', 'journal.html', 'rating.html', 'programs.html', 'nutrition.html'];
  let navs = 0;
  const t0 = Date.now();
  for (let n = 0; n < 300; n++) {
    const page = PAGES[n % PAGES.length];
    navCur = page;
    try {
      await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'domcontentloaded', timeout: 8000 });
      navs++;
    } catch (e) { navErrs.push(page + ' NAV-FAIL: ' + e.message); }
  }
  const dt = Date.now() - t0;
  ok('navigation×300: усі переходи відбулись', navs === 300, navs + '/300 за ' + dt + ' мс');
  ok('navigation×300: 0 pageerror на завантаженнях', navErrs.length === 0, navErrs.slice(0, 4).join(' | '));
}

/* ------------------------------------------------------------------ */
/* J. DATA INTEGRITY — фінальна перевірка цілісності                    */
/* ------------------------------------------------------------------ */
section('J. DATA INTEGRITY — профіль після всього хаосу');
await p.goto('file://' + ROOT + '/plan.html', { waitUntil: 'load' });
await p.waitForTimeout(800);
{
  const integ = await p.evaluate(() => {
    const out = { parses: false, ver: null, setsOk: true, weightsOk: true, planShape: true, err: null };
    try {
      const prof = window.Store.localProfile();
      out.parses = !!prof && typeof prof === 'object';
      out.ver = prof.version;
      const cp = prof.customPlans || {};
      Object.keys(cp).forEach(function (k) {
        if (!Array.isArray(cp[k])) { out.planShape = false; return; }
        cp[k].forEach(function (day) {
          if (!day || !Array.isArray(day.exercises)) { out.planShape = false; return; }
          day.exercises.forEach(function (ex) {
            const s = Number(ex.sets);
            if (!(Number.isInteger(s) && s >= 1 && s <= 10)) out.setsOk = false;
            if (!ex.name || typeof ex.name !== 'string') out.planShape = false;
          });
        });
      });
      Object.values(prof.weights || {}).forEach(function (w) {
        if (!(w === null || (Number.isFinite(w) && w >= 0 && w <= 500))) out.weightsOk = false;
      });
    } catch (e) { out.err = e.message; }
    return out;
  });
  ok('integrity: профіль парситься', integ.parses, integ.err || '');
  ok('integrity: schema version присутній', integ.ver != null, 'version=' + integ.ver);
  ok('integrity: усі підходи у збережених планах ∈ [1..10]', integ.setsOk, '');
  ok('integrity: усі ваги ∈ {null} ∪ [0..500]', integ.weightsOk, '');
  ok('integrity: структура планів ціла (дні/вправи/назви)', integ.planShape, '');
}

await p.close(); await ctx.close();
await b.close();

/* ------------------------------------------------------------------ */
const bad = R.filter(r => !r[1]).length;
console.log('\n────────────────────────────────────────');
console.log((R.length - bad) + '/' + R.length + ' adversarial-перевірок пройшло (ACTUALLY EXECUTED у браузері).');
console.log('CODE REVIEW ONLY (не виконувалось тут): cloud save-spam проти живого Supabase з автентифікацією.');
console.log('────────────────────────────────────────');
process.exit(bad ? 1 : 0);
