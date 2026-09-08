/*
 * Знімки сторінок у обох схемах — щоб дивитися на результат очима, а не
 * лише на числа контрасту. Мережа блокується: шрифти й Supabase тут не
 * потрібні, а чекання на них перетворює прогін на таймаут. Профіль
 * засівається той самий, що у verifyproduction.mjs, інакше сторож
 * заверне кожну сторінку на welcome.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const ROOT = 'file://' + process.cwd() + '/';
const PAGES = process.argv.slice(2);
const OUT = '/tmp/shots2';
mkdirSync(OUT, { recursive: true });

function seedScript() {
  const sessionLog = {}, workLog = {}, bodyLog = {}, weightLog = {};
  const add = (k, vol) => {
    sessionLog[k] = { programId: 'fullbody', days: 3, dayIdx: 0, title: 'День A',
      done: 10, total: 14, t0: Date.parse(k + 'T18:00:00'), t1: Date.parse(k + 'T19:15:00'),
      sets: 24, reps: 170, vol };
    workLog[k] = 1; bodyLog[k] = 82;
  };
  ['2026-08-05','2026-08-12','2026-08-19','2026-08-26','2026-08-31'].forEach(k => add(k, 5000));
  ['2026-09-01','2026-09-03','2026-09-08','2026-09-10'].forEach(k => add(k, 7000));
  weightLog['Жим лежачи'] = [{ d:'2026-08-10', kg:80 }, { d:'2026-09-02', kg:90 }, { d:'2026-09-09', kg:95 }];
  weightLog['Присідання'] = [{ d:'2026-08-01', kg:100 }, { d:'2026-08-20', kg:110 }];
  localStorage.setItem('ib.cloud', '1');
  localStorage.setItem('ib.session', JSON.stringify({ access_token:'t', refresh_token:'r',
    expires_at: Date.now() + 86400000, user:{ id:'00000000-0000-4000-8000-000000000001', email:'t@e.co' } }));
  localStorage.setItem('ib.account', JSON.stringify({ status:'approved', isAdmin:true }));
  localStorage.setItem('ib.profile', JSON.stringify({ version:9, birthDate:'1990-06-15',
    sex:'male', weight:82, height:180, activity:1.55, trainingAge:'inter',
    activePlan:{ programId:'fullbody', days:3 }, weights:{ 'Присідання зі штангою':100 },
    sessionLog, workLog, bodyLog, weightLog, mealLog:{}, measureLog:{}, trackerLog:{} }));
}

/* Схема одна: світлої більше немає, і FORGE_THEME теж — оформлення в
   проєкті рівно одне (див. js/app.js). Префікс dark_ в іменах лишений
   навмисно: на нього посилаються старі звіти аудиту в docs/. */
const browser = await chromium.launch();
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.route(/^https?:\/\//, r => r.abort());
  const boot = await ctx.newPage();
  await boot.goto(ROOT + 'welcome.html', { waitUntil: 'load' });
  await boot.evaluate(seedScript);
  await boot.close();
  for (const p of PAGES) {
    const page = await ctx.newPage();
    await page.goto(ROOT + p, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const name = p.replace(/[^a-z0-9]+/gi, '_');
    await page.screenshot({ path: `${OUT}/dark_${name}.png` });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log('готово:', OUT);
