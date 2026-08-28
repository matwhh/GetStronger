/**
 * §14 фінальна безпека даних: Export → Clear → Import → Verify.
 *
 * Не «імпорт не падає», а «жодне поле не загубилось»: сідаємо ПОВНИМ
 * профілем (профіль, план, тренування, харчування, історія, трекери,
 * Forge Rating, налаштування), тиснемо справжні кнопки на account.html і
 * звіряємо результат полем за полем.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
/* Порівнюємо ЗМІСТ, а не порядок ключів: імпорт перезбирає обʼєкти своїм
   порядком полів, і звичайний JSON.stringify лаявся б на це як на втрату. */
const stable = (v) => JSON.stringify(v, (k, val) =>
  (val && typeof val === 'object' && !Array.isArray(val))
    ? Object.keys(val).sort().reduce((o, kk) => { o[kk] = val[kk]; return o; }, {})
    : val);
const same = (a, b) => stable(a) === stable(b);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await adultContext(b, { acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('dialog', d => d.accept());

await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });

/* 1. Сідаємо повний профіль через Store — тим самим шляхом, що й застосунок */
await p.evaluate(async () => {
  const key = n => { const d = new Date(); d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const weightLog = { 'Присідання': [], 'Жим лежачи': [] };
  const workLog = {}, bodyLog = {}, mealLog = {}, sessionLog = {};
  const sleep = {}, steps = {}, water = {};
  for (let i = 0; i < 60; i++) {
    const k = key(i);
    if (i % 2 === 0) workLog[k] = 1;
    if (i % 2 === 1) mealLog[k] = { kcal: 2400, p: 160, f: 70, c: 250, fiber: 30, target: 2500 };
    if (i % 3 === 0) sessionLog[k] = { programId: 'ppl', days: 3, dayIdx: i % 3, title: 'Push', done: 5, total: 6 };
    if (i % 7 === 0) bodyLog[k] = 82.4 - i * 0.02;
    if (i % 5 === 0) {
      weightLog['Присідання'].unshift({ d: k, kg: 100 + (60 - i) / 10 });
      weightLog['Жим лежачи'].unshift({ d: k, kg: 70 + (60 - i) / 20 });
    }
    sleep[k] = { value: 450, source: 'manual', date: k };   // hasSource: обʼєктна форма
    steps[k] = { value: 9200, source: 'manual', date: k };
    water[k] = 2400;                                        // cumulative: просте число
  }
  /* Форма — рівно та, що в blankProfile(): реєстр trackers + дані
     trackerLog, activePlan замість вигаданого plan, daysPerWeek. */
  await window.Store.saveProfile({
    birthDate: '1990-06-15',
    weight: 82.4, height: 181, age: 31, sex: 'male', activity: 1.55, goal: 'cut',
    bodyfat: 18, meals: 4, daysPerWeek: 4, theme: 'graphite-navy',
    programId: 'ppl', activePlan: { programId: 'ppl', days: 3 },
    trainingAge: 'inter',
    customPlans: { 'ppl:3': [{
      name: 'День A', title: 'Push', focus: 'груди/плечі',
      exercises: [{ name: 'Жим лежачи', sets: 4, reps: '6', rir: '2', rest: '3 хв',
                    note: '', lift: 'compound', muscles: ['груди'] }]
    }] },
    records: { squat: 140, bench: 95 },
    recipes: [{ id: 'r1', name: 'Вівсянка з ягодами', containers: 3, prepMin: 5, cookMin: 10,
                url: 'https://example.com/oats', author: 'Я',
                items: [{ foodId: 'oats', grams: 300, cooked: false },
                        { foodId: 'milk', grams: 600, cooked: false }] }],
    hrRest: 54, hrMax: 189,
    weights: { 'Присідання': 106, 'Жим лежачи': 73 },
    workLog, sessionLog, mealLog, bodyLog, weightLog,
    trackers: {
      sleep: { id: 'sleep', type: 'sleep', name: 'Сон', enabled: true, goal: 480, order: 1 },
      steps: { id: 'steps', type: 'steps', name: 'Кроки', enabled: true, goal: 10000, order: 2 },
      water: { id: 'water', type: 'water', name: 'Вода', enabled: true, goal: 2500, order: 3 }
    },
    trackerLog: { sleep: sleep, steps: steps, water: water },
    periodization: { weeks: 8, startedAt: '2026-06-01', startPct: 70, endPct: 92,
                     cadence: 1, stepPct: 2.5, mode: 'linear',
                     oneRM: { 'Присідання': 140, 'Жим лежачи': 95 } },
    deload: { percent: 10, at: '2026-08-01T10:00:00.000Z',
              before: { 'Присідання': 118, 'Жим лежачи': 81 } }
  });
});
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(600);

/* 2. Rating рахуємо на його власній сторінці — саме там він і живе */
await p.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
await p.waitForTimeout(900);
const before = await p.evaluate(async () => {
  const pr = await window.Store.getProfile();
  const days = Object.keys(pr.ratingLog || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
  return { profile: pr, ratingDays: days.length,
    rating: days.length ? pr.ratingLog[days.sort()[days.length - 1]].rating : 0 };
});
ok('Rating порахувався на сідованій історії', before.ratingDays > 30 && before.rating > 0,
   before.ratingDays + ' днів, ' + before.rating + ' Elo');

/* 3. Експорт справжньою кнопкою */
await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
await p.waitForTimeout(600);
const dl = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#p-export')]).then(r => r[0]);
const file = path.join(os.tmpdir(), 'forge-roundtrip.json');
await dl.saveAs(file);
const raw = fs.readFileSync(file, 'utf8');
ok('експорт віддав файл', dl.suggestedFilename() === 'forge-profile.json', dl.suggestedFilename());
let exported = null;
try { exported = JSON.parse(raw); } catch (_) {}
ok('експорт — валідний JSON', !!exported, Math.round(raw.length / 1024) + ' КБ');

/* 4. Стирання локальних даних справжньою кнопкою */
await p.click('#p-clear');
await p.waitForTimeout(800);
const cleared = await p.evaluate(() => {
  const pr = JSON.parse(localStorage.getItem('ib.profile') || 'null');
  return { hasProfile: !!(pr && (pr.weight || pr.plan)), keys: Object.keys(localStorage).filter(k => /^(ib\.|forge\.)/.test(k)) };
});
ok('після стирання профілю в localStorage немає', !cleared.hasProfile, cleared.keys.join(',') || 'порожньо');

/* 5. Імпорт справжнім file input */
await p.setInputFiles('#p-import-file', file);
await p.waitForTimeout(1500);
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(800);
const after = await p.evaluate(async () => await window.Store.getProfile());

/* 6. Звірка поле за полем */
const B = before.profile;
const num = (n, a, b2) => ok(n, a === b2, a + ' → ' + b2);
num('профіль: вага', B.weight, after.weight);
num('профіль: зріст', B.height, after.height);
num('профіль: вік', B.age, after.age);
num('профіль: дата народження', B.birthDate, after.birthDate);
num('профіль: стать', B.sex, after.sex);
num('профіль: активність', B.activity, after.activity);
num('профіль: ціль', B.goal, after.goal);
num('профіль: % жиру', B.bodyfat, after.bodyfat);
num('профіль: стаж', B.trainingAge, after.trainingAge);
num('налаштування: прийомів їжі', B.meals, after.meals);
num('налаштування: днів на тиждень', B.daysPerWeek, after.daysPerWeek);
num('налаштування: тема', B.theme, after.theme);
num('кардіо: пульс спокою', B.hrRest, after.hrRest);
num('кардіо: максимальний пульс', B.hrMax, after.hrMax);
num('план: програма', B.programId, after.programId);
ok('план: активний план', same(B.activePlan, after.activePlan), JSON.stringify(after.activePlan));
ok('план: власні правки днів', same(B.customPlans, after.customPlans));
ok('рекорди 1ПМ', same(B.records, after.records), JSON.stringify(after.records));
ok('власні рецепти', same(B.recipes, after.recipes));
ok('робочі ваги збережено', same(B.weights, after.weights));
const cnt = (o) => Object.keys(o || {}).length;
num('тренування: днів у workLog', cnt(B.workLog), cnt(after.workLog));
num('тренування: сесій у sessionLog', cnt(B.sessionLog), cnt(after.sessionLog));
ok('тренування: вміст сесії цілий',
   same(B.sessionLog, after.sessionLog));
num('харчування: закритих днів', cnt(B.mealLog), cnt(after.mealLog));
ok('харчування: підсумки днів цілі', same(B.mealLog, after.mealLog));
num('історія ваги тіла: записів', cnt(B.bodyLog), cnt(after.bodyLog));
ok('історія робочих ваг збережена цілком',
   same(B.weightLog, after.weightLog),
   Object.keys(after.weightLog || {}).join(', '));
num('трекери: реєстр', cnt(B.trackers), cnt(after.trackers));
const st = (after.trackers && after.trackers.sleep) || {};
ok('трекери: назва, ціль і стан збереглись',
   st.name === B.trackers.sleep.name && st.goal === B.trackers.sleep.goal &&
   st.enabled === true && st.type === 'sleep',
   JSON.stringify(st));
num('трекери: днів сну', cnt(B.trackerLog && B.trackerLog.sleep), cnt(after.trackerLog && after.trackerLog.sleep));
num('трекери: днів кроків', cnt(B.trackerLog && B.trackerLog.steps), cnt(after.trackerLog && after.trackerLog.steps));
num('трекери: днів води', cnt(B.trackerLog && B.trackerLog.water), cnt(after.trackerLog && after.trackerLog.water));
ok('трекери: обʼєктна форма запису (value/source) вціліла',
   same(B.trackerLog.sleep, after.trackerLog && after.trackerLog.sleep));
ok('періодизація збережена', same(B.periodization, after.periodization),
   JSON.stringify(after.periodization));
ok('делоад збережено', same(B.deload, after.deload), JSON.stringify(after.deload));

/* 7. Rating: не переносимо кеш, а перевіряємо, що він відновлюється до тих самих чисел */
await p.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);
const ratingAfter = await p.evaluate(async () => {
  const pr = await window.Store.getProfile();
  const days = Object.keys(pr.ratingLog || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  return { days: days.length, rating: days.length ? pr.ratingLog[days[days.length - 1]].rating : 0 };
});
ok('Forge Rating після імпорту той самий', ratingAfter.rating === before.rating,
   before.rating + ' → ' + ratingAfter.rating + ' Elo');
ok('днів у ratingLog стільки ж', ratingAfter.days === before.ratingDays,
   before.ratingDays + ' → ' + ratingAfter.days);

/* 8. Відкат імпорту доступний */
await p.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
await p.waitForTimeout(600);
ok('кнопка «Відкотити імпорт» зʼявилась', await p.locator('#p-restore').count() > 0);

ok('увесь сценарій без JS-помилок', errs.length === 0, errs.join(' | '));

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок Export → Clear → Import пройшло.');
process.exit(bad ? 1 : 0);
