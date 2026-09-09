/**
 * КІЛЬЦЕ КБЖВ у дні на «Харчуванні».
 *
 * Стереже не малюнок, а ЗГОДУ ЧИСЕЛ. Кільце стоїть за два сантиметри від
 * плиток із тими самими величинами, і найлегша тут помилка — показати
 * два різні числа про одне й те саме. Саме це й сталося на першій
 * збірці: у центрі стояла сума трьох секторів (932), а плитка «ккал за
 * день» показувала 949. Різниця — калорійність клітковини, і пояснити її
 * читачеві було нічим.
 *
 * Тому перевіряється: центр = плитка калорій, грами в підписах = грами в
 * плитках, частки складаються в 100%, і сектор жиру НЕ дорівнює сектору
 * вуглеводів при однаковій вазі (кільце міряє енергію, а не грами — грам
 * жиру несе 9 ккал, грам вуглеводів 4).
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: CHROME });

/** Посіяти день у профіль і перезавантажити сторінку */
const seed = async (p, items) => {
  await p.evaluate(async (list) => {
    const pr = (await window.Store.getProfile()) || {};
    const d = new Date();
    pr.day = {
      date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
            '-' + String(d.getDate()).padStart(2, '0'),
      meals: [{ name: 'Сніданок', items: list }]
    };
    await window.Store.saveProfile(pr);
  }, items);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1500);
};

const read = (p) => p.evaluate(() => {
  const ring = document.querySelector('#day .macro-ring');
  if (!ring) return null;
  const sl = [...ring.querySelectorAll('.donut__slice[data-dash]')];
  const kpi = [...document.querySelectorAll('#day .kpi')].map((k) => ({
    val: k.querySelector('.kpi__val').textContent.trim(),
    lbl: k.querySelector('.kpi__lbl').textContent.trim()
  }));
  return {
    slices: sl.length,
    dash: sl.map((s) => Number(s.getAttribute('data-dash').split(' ')[0])),
    titles: sl.map((s) => s.querySelector('title').textContent),
    center: (ring.querySelector('.donut__val') || {}).textContent,
    legend: [...ring.querySelectorAll('.macro-ring__legend li')].map((li) => ({
      name: li.querySelector('.macro-ring__name').textContent,
      pct: Number(li.querySelector('b').textContent.replace('%', '')),
      grams: Number(li.querySelector('.muted').textContent.replace(/\D/g, ''))
    })),
    kpi: kpi,
    empty: !!ring.querySelector('.donut--empty')
  };
});

{
  const ctx = await adultContext(b, { viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + ROOT + '/meals.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);

  /* ---- 1. Порожній день ---- */
  const e0 = await read(p);
  ok('1. на порожньому дні — бліде кільце й пояснення, а не нулі',
     e0 && e0.empty && e0.slices === 0, JSON.stringify(e0 && { empty: e0.empty, slices: e0.slices }));

  /* ---- 2. Три сектори, і числа сходяться з плитками ---- */
  await seed(p, [
    { kind: 'food', foodId: 'chicken-breast', grams: 200 },
    { kind: 'food', foodId: 'rice-white', grams: 150 },
    { kind: 'food', foodId: 'olive-oil', grams: 20 }
  ]);
  const m = await read(p);
  ok('2. три сектори — Б, Ж, В, без клітковини',
     m.slices === 3 && m.legend.map((l) => l.name).join(',') === 'Білок,Жири,Вуглеводи',
     JSON.stringify(m.legend.map((l) => l.name)));

  const kcalKpi = (m.kpi.find((k) => /ккал за день/i.test(k.lbl)) || {}).val;
  ok('2. число в дучці = плитка «ккал за день»',
     m.center === kcalKpi, 'дучка ' + m.center + ', плитка ' + kcalKpi);

  const gramKpi = (re) => (m.kpi.find((k) => re.test(k.lbl)) || {}).val;
  ok('2. грами в підписах = грами в плитках',
     String(m.legend[0].grams) === gramKpi(/білок/i) &&
     String(m.legend[1].grams) === gramKpi(/жир/i) &&
     String(m.legend[2].grams) === gramKpi(/вуглеводи/i),
     JSON.stringify([m.legend.map((l) => l.grams), [gramKpi(/білок/i), gramKpi(/жир/i), gramKpi(/вуглеводи/i)]]));

  const sumPct = m.legend.reduce((a, l) => a + l.pct, 0);
  ok('2. частки складаються в 100%', Math.abs(sumPct - 100) <= 1, String(sumPct));

  /* Довжини дуг мають бути в тому ж порядку, що й частки. */
  const byDash = m.dash.map((d, i) => [d, m.legend[i].pct]);
  ok('2. довжина дуги йде за часткою',
     byDash.every(([d, pct], i) => i === 0 || ((d > byDash[i - 1][0]) === (pct > byDash[i - 1][1])) || d === byDash[i - 1][0]),
     JSON.stringify(byDash));

  ok('2. клітковина названа в підказці вуглеводів, а не окремим сектором',
     /клітковин/i.test(m.titles[2]) && !m.titles.some((t) => /^Клітковина/.test(t)),
     m.titles[2]);

  /* ---- 3. Кільце міряє ЕНЕРГІЮ, а не вагу ---- */
  /*
   * 40 г оливкової олії й 40 г цукру важать однаково, але олія несе
   * удвічі більше калорій. Якби сектори рахувались за грамами, вони
   * вийшли б однаковими — і діаграма брехала б про раціон.
   */
  await seed(p, [
    { kind: 'food', foodId: 'olive-oil', grams: 40 },
    { kind: 'food', foodId: 'rice-white', grams: 40 }
  ]);
  const e = await read(p);
  if (e && e.slices >= 2) {
    const fat = e.legend.find((l) => l.name === 'Жири');
    const carb = e.legend.find((l) => l.name === 'Вуглеводи');
    ok('3. однакова вага ≠ однакова частка: жир важчий за енергією',
       fat && carb && fat.pct > carb.pct + 15,
       JSON.stringify([fat, carb]));
  } else {
    ok('3. однакова вага ≠ однакова частка: жир важчий за енергією', false,
       'не вдалося посіяти: ' + JSON.stringify(e && e.legend));
  }
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Телефон: нічого не рве сторінку ------------------------------ */
for (const w of [320, 390]) {
  const ctx = await adultContext(b, {
    viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + ROOT + '/meals.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  await seed(p, [{ kind: 'food', foodId: 'chicken-breast', grams: 200 },
                 { kind: 'food', foodId: 'rice-white', grams: 150 }]);
  const m = await p.evaluate(() => {
    const ring = document.querySelector('#day .macro-ring');
    const svg = ring && ring.querySelector('.donut__svg');
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      slices: ring ? ring.querySelectorAll('.donut__slice[data-dash]').length : 0,
      /* Кільце має лишатись круглим: ширина й висота полотна рівні. */
      round: svg ? Math.abs(svg.getBoundingClientRect().width -
                            svg.getBoundingClientRect().height) < 2 : false,
      fits: svg ? svg.getBoundingClientRect().width <= window.innerWidth - 40 : false
    };
  });
  ok('4. ' + w + 'px: сторінка не їде вбік', !m.overflow);
  ok('4. ' + w + 'px: кільце намальоване й лишилось круглим', m.slices === 3 && m.round,
     JSON.stringify(m));
  ok('4. ' + w + 'px: вміщається в екран', m.fits);
  ok('4. ' + w + 'px: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок кільця КБЖВ пройшло.');
process.exit(bad ? 1 : 0);
