/**
 * Теплокарта тренувань: рівні, підказка, легенда, перемикач.
 *
 * ЩО САМЕ ТУТ СТЕРЕЖЕТЬСЯ. Клітинка перестала бути бінарною — тепер вона
 * несе рівень 0…4, похідний від частки закритих підходів. Це означає, що
 * теплокарта почала ГОВОРИТИ ПРО ДАНІ, а не лише про факт «був у залі», і
 * будь-яке розходження між заливкою та журналом — це вже неправда на
 * екрані, а не косметика.
 *
 * Тому перевіряється саме відповідність: підсунуті сесії з відомою
 * часткою підходів мусять дати рівно ті рівні, які обіцяє легенда. Решта
 * (підказка, підсвічування, перемикач) — те, чого в юнітах не побачиш.
 */
import { chromium } from 'playwright';
import { adultContext, adultProfile } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

/* Журнал із заздалегідь відомими рівнями. Дні беремо близькі до сьогодні,
   щоб вони гарантовано були у вікні сітки (сім місяців). */
function seed() {
  const iso = (back) => {
    const d = new Date();
    d.setDate(d.getDate() - back);
    return d.toISOString().slice(0, 10);
  };
  const sess = (doneSets, totalSets) => ({
    dayIdx: 0, title: 'Push', done: 3, total: 6,
    doneSets: doneSets, totalSets: totalSets, t0: 0, t1: 0
  });
  return {
    /* 2 дні тому: усе закрито → 4;  3: більшість → 3;  4: менше половини → 2 */
    sessionLog: { [iso(2)]: sess(20, 20), [iso(3)]: sess(13, 20), [iso(4)]: sess(6, 20) },
    /* 5 днів тому: відмічено руками, сесії немає → 1 */
    workLog: { [iso(5)]: 1 },
    keys: { l4: iso(2), l3: iso(3), l2: iso(4), l1: iso(5), l0: iso(6) }
  };
}

const S = seed();
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 1280, height: 950 } });
await ctx.route(/^https?:\/\//, r => r.abort());
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
await p.evaluate(async (prof) => {
  try { await window.Store.saveProfile(prof); } catch (e) { if (!e.queued) throw e; }
}, adultProfile({
  activePlan: { programId: 'ppl', days: 6 }, programId: 'ppl', daysPerWeek: 6,
  sessionLog: S.sessionLog, workLog: S.workLog
}));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1600);

/* ------------------------------------------------------------------ */
/* 1. Рівень дорівнює тому, що лежить у журналі                         */
/* ------------------------------------------------------------------ */
const lvlOf = (k) => p.getAttribute('[data-hm="' + k + '"]', 'data-lvl');

for (const [want, key, why] of [
  ['4', S.keys.l4, '20/20 підходів'],
  ['3', S.keys.l3, '13/20 підходів'],
  ['2', S.keys.l2, '6/20 підходів'],
  ['1', S.keys.l1, 'відмічено руками, сесії немає'],
  ['0', S.keys.l0, 'нічого не записано']
]) {
  const got = await lvlOf(key);
  ok('рівень ' + want + ' — ' + why, got === want, 'у розмітці ' + got);
}

/* Чотири рівні мусять справді відрізнятись на екрані, а не лише в
   атрибуті: однакова заливка зробила б шкалу декорацією. */
{
  const bg = await p.evaluate((keys) => {
    const out = {};
    ['l2', 'l3', 'l4'].forEach((n) => {
      const el = document.querySelector('[data-hm="' + keys[n] + '"]');
      out[n] = el ? getComputedStyle(el).backgroundColor : null;
    });
    return out;
  }, S.keys);
  ok('сходинки заливки різні', new Set(Object.values(bg)).size === 3, JSON.stringify(bg));
}

/* Рівень 1 — контур без заливки: підходів не записано, і заливка
   збрехала б про обсяг. */
{
  const m = await p.evaluate((k) => {
    const el = document.querySelector('[data-hm="' + k + '"]');
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, sh: cs.boxShadow };
  }, S.keys.l1);
  ok('ручний день — контур, а не заливка',
     /rgba\(0, 0, 0, 0\)|transparent/.test(m.bg) && m.sh && m.sh !== 'none', JSON.stringify(m));
}

/* ------------------------------------------------------------------ */
/* 2. Підказка                                                          */
/* ------------------------------------------------------------------ */
{
  ok('системного title на клітинках немає',
     (await p.locator('.heatmap [data-hm][title]').count()) === 0);

  await p.locator('[data-hm="' + S.keys.l4 + '"]').hover();
  await p.waitForTimeout(220);
  const tip = p.locator('.heatmap__tip');
  ok('підказка зʼявилась', (await tip.count()) === 1 && !(await tip.isHidden()));
  const txt = (await tip.textContent()) || '';
  ok('у підказці є дріб підходів', /20\/20/.test(txt), txt);

  /* Головне, заради чого підказка винесена з .heatmap: сітка
     прокручується, тобто обрізає все, що з неї виступає. */
  const fits = await p.evaluate(() => {
    const t = document.querySelector('.heatmap__tip').getBoundingClientRect();
    const c = document.querySelector('#jr-train .card').getBoundingClientRect();
    return t.top >= c.top - 1 && t.left >= c.left - 1 && t.right <= c.right + 1;
  });
  ok('підказка не обрізана карткою', fits);

  /* Крайня клітинка: підказка мусить зсунутись, а не вилізти. */
  const last = p.locator('.heatmap [data-hm]').last();
  await last.hover();
  await p.waitForTimeout(220);
  ok('у крайньої клітинки підказка теж у межах картки',
     await p.evaluate(() => {
       const t = document.querySelector('.heatmap__tip').getBoundingClientRect();
       const c = document.querySelector('#jr-train .card').getBoundingClientRect();
       return t.left >= c.left - 1 && t.right <= c.right + 1;
     }));

  await p.mouse.move(5, 5);
  await p.waitForTimeout(220);
  ok('підказка ховається', await p.locator('.heatmap__tip').isHidden());
}

/* ------------------------------------------------------------------ */
/* 3. Легенда підсвічує саме свій рівень                                */
/* ------------------------------------------------------------------ */
{
  await p.locator('.heatmap__key[data-key-lvl="4"]').hover();
  await p.waitForTimeout(260);
  const o = await p.evaluate((keys) => ({
    l4: Number(getComputedStyle(document.querySelector('[data-hm="' + keys.l4 + '"]')).opacity),
    l2: Number(getComputedStyle(document.querySelector('[data-hm="' + keys.l2 + '"]')).opacity)
  }), S.keys);
  ok('наведення на крок легенди лишає свій рівень і гасить решту',
     o.l4 > 0.9 && o.l2 < 0.4, JSON.stringify(o));

  await p.mouse.move(5, 5);
  await p.waitForTimeout(260);
  ok('після відведення підсвітка знімається',
     (await p.locator('.heatmap[data-only]').count()) === 0);
}

/* ------------------------------------------------------------------ */
/* 4. Клік лишився перемикачем дня                                      */
/* ------------------------------------------------------------------ */
{
  const before = await p.getAttribute('[data-hm="' + S.keys.l0 + '"]', 'aria-pressed');
  await p.click('[data-hm="' + S.keys.l0 + '"]');
  await p.waitForTimeout(700);
  const after = await p.getAttribute('[data-hm="' + S.keys.l0 + '"]', 'aria-pressed');
  ok('клік по порожньому дню ставить позначку', before === 'false' && after === 'true',
     before + ' → ' + after);
  ok('позначка доїхала в профіль',
     await p.evaluate(async (k) => Number((await window.Store.getProfile()).workLog[k]) > 0, S.keys.l0));

  /* Анімація появи — рівно один раз. Інакше кожен клік перезапускав би
     хвилю на двохстах клітинках: саме те миготіння, від якого анімація
     мала б рятувати. */
  ok('після перемальовки хвиля появи не перезапускається',
     (await p.locator('.heatmap.is-in').count()) === 0);

  await p.click('[data-hm="' + S.keys.l0 + '"]');
  await p.waitForTimeout(700);
  ok('повторний клік знімає позначку',
     (await p.getAttribute('[data-hm="' + S.keys.l0 + '"]', 'aria-pressed')) === 'false');
}

/* ------------------------------------------------------------------ */
/* 5. Клавіатура                                                        */
/* ------------------------------------------------------------------ */
{
  await p.evaluate((k) => document.querySelector('[data-hm="' + k + '"]').focus(), S.keys.l3);
  await p.waitForTimeout(240);
  ok('фокус із клавіатури теж показує підказку',
     !(await p.locator('.heatmap__tip').isHidden()));
  const t = (await p.locator('.heatmap__tip').textContent()) || '';
  ok('підказка під фокусом — про той самий день', /13\/20/.test(t), t);
}

/* ------------------------------------------------------------------ */
/* 6. Телефон                                                           */
/* ------------------------------------------------------------------ */
{
  const m = await adultContext(b, { viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true });
  const q = await m.newPage();
  const e2 = []; q.on('pageerror', (e) => e2.push(e.message));
  await q.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await q.evaluate(async (prof) => {
    try { await window.Store.saveProfile(prof); } catch (e) { if (!e.queued) throw e; }
  }, adultProfile({
    activePlan: { programId: 'ppl', days: 6 }, programId: 'ppl', daysPerWeek: 6,
    sessionLog: S.sessionLog, workLog: S.workLog
  }));
  await q.reload({ waitUntil: 'load' });
  await q.waitForTimeout(1600);

  ok('375px: сторінка не поїхала вбік',
     await q.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
     await q.evaluate(() => document.documentElement.scrollWidth + ' проти ' + document.documentElement.clientWidth));

  /*
   * Сітка ширша за екран, і вимога тут не «scrollLeft дорівнює максимуму»,
   * а те, заради чого прокрутка й робиться: СЬОГОДНІШНЯ КЛІТИНКА має бути
   * видно без пошуку пальцем усередині сторінки, що й сама скролиться.
   *
   * Перевірка на точний scrollLeft була б крихкою: підвантаження шрифту
   * після присвоєння дописує кілька пікселів у ряд місяців, і максимум
   * зсувається. Шість пікселів недоїзду нікого не обходять — а от
   * клітинка за краєм обходить.
   */
  ok('375px: сьогоднішній день видно без прокрутки',
     await q.evaluate(() => {
       const h = document.querySelector('.heatmap');
       const cells = h.querySelectorAll('[data-hm]');
       const last = cells[cells.length - 1];
       if (!last) return false;
       const c = last.getBoundingClientRect(), g = h.getBoundingClientRect();
       return c.left >= g.left - 1 && c.right <= g.right + 1;
     }));

  /*
   * Підписи днів мусять лишитись на місці ПІСЛЯ прокрутки.
   *
   * Сітка відкривається прокрученою в кінець, і стовпець Пн…Нд лежить
   * усередині того самого контейнера. Без position: sticky (і без
   * width: max-content на сітці, без якого sticky не має де триматись)
   * людина бачить сім рядів квадратиків і жодної підказки, який із них
   * понеділок.
   */
  ok('375px: підписи Пн…Нд видно після прокрутки',
     await q.evaluate(() => {
       const h = document.querySelector('.heatmap');
       const d = h.querySelector('.heatmap__days').getBoundingClientRect();
       const g = h.getBoundingClientRect();
       return h.scrollLeft > 50 && d.left >= g.left - 1 && d.right <= g.right;
     }),
     await q.evaluate(() => {
       const h = document.querySelector('.heatmap');
       return 'scrollLeft=' + Math.round(h.scrollLeft) +
              ' підписи на ' + Math.round(h.querySelector('.heatmap__days').getBoundingClientRect().left) +
              ', сітка на ' + Math.round(h.getBoundingClientRect().left);
     }));

  /* Тап по кроку легенди — той самий перемикач, бо наведення на дотику
     не існує. */
  await q.locator('.heatmap__key[data-key-lvl="4"]').tap();
  await q.waitForTimeout(260);
  ok('375px: тап по легенді вмикає підсвітку',
     (await q.locator('.heatmap[data-only="4"]').count()) === 1);
  await q.locator('.heatmap__key[data-key-lvl="4"]').tap();
  await q.waitForTimeout(260);
  ok('375px: другий тап знімає підсвітку',
     (await q.locator('.heatmap[data-only]').count()) === 0);

  ok('375px: без JS-помилок', e2.length === 0, e2.slice(0, 2).join(' | '));
  await m.close();
}

ok('без JS-помилок', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
const bad = R.filter(([, c]) => !c).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок теплокарти пройшло.');
process.exit(bad ? 1 : 0);
