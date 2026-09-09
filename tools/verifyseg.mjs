/**
 * Сегментований перемикач: доріжка по вмісту й виділення, що їздить.
 *
 * ЩО ТУТ СТЕРЕЖЕТЬСЯ І ЧОМУ САМЕ ЦЕ.
 *
 * Виділення .seg::before не має власної логіки — позицію й розмір йому
 * дає js/app.js. Тобто перемикач може ПОКАЗУВАТИ не той крок, який
 * насправді обрано, і жоден юніт цього не побачить: у пісочниці немає
 * розкладки, а на порожній сторінці обраний крок і перший збігаються.
 *
 * Саме так і сталось при першій збірці: сторінка читає профіль
 * асинхронно й ставить radio.checked = true — а це ВЛАСТИВІСТЬ, не
 * атрибут: ні change, ні мутації DOM. Виділення лишалось на «3 дні»,
 * тоді як обрано було «6 днів». Перевірка нижче ловить рівно це.
 */
import { chromium } from 'playwright';
import { adultContext, adultProfile } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 1280, height: 950 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

await p.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
await p.evaluate(async (s) => {
  try { await window.Store.saveProfile(s); } catch (e) { if (!e.queued) throw e; }
}, adultProfile({ activePlan: { programId: 'ppl', days: 6 }, programId: 'ppl', daysPerWeek: 6 }));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(2200);

/* ------------------------------------------------------------------ */
/* 1. Доріжка по вмісту, а не на весь екран                             */
/* ------------------------------------------------------------------ */
{
  const m = await p.evaluate(() => {
    const seg = document.querySelector('.seg');
    const card = seg.closest('.card');
    const s = seg.getBoundingClientRect(), c = card.getBoundingClientRect();
    let items = 0;
    seg.querySelectorAll('.seg__item').forEach((i) => { items += i.getBoundingClientRect().width; });
    return { seg: Math.round(s.width), card: Math.round(c.width), items: Math.round(items) };
  });
  /* Обводка мусить обіймати кроки, а не тягтись через картку: раніше
     рамка йшла на всю ширину, а кнопки тулились у лівому куті. */
  ok('доріжка завширшки зі свої кроки, а не з картку',
     m.seg < m.card * 0.6 && m.seg >= m.items, JSON.stringify(m));
}

/* ------------------------------------------------------------------ */
/* 2. Виділення стоїть на ОБРАНОМУ кроці вже при завантаженні           */
/* ------------------------------------------------------------------ */
{
  const m = await p.evaluate(() => {
    const seg = document.querySelector('.seg');
    const on = seg.querySelector('input:checked');
    const span = on.nextElementSibling;
    const cs = getComputedStyle(seg);
    const sr = span.getBoundingClientRect(), gr = seg.getBoundingClientRect();
    return {
      label: span.textContent.trim(),
      wantX: sr.left - gr.left - seg.clientLeft,
      gotX: parseFloat(cs.getPropertyValue('--seg-x')),
      wantW: sr.width,
      gotW: parseFloat(cs.getPropertyValue('--seg-w')),
      on: cs.getPropertyValue('--seg-on').trim()
    };
  });
  ok('виділення видиме', m.on === '1', m.on);
  ok('виділення на обраному кроці («' + m.label + '»)',
     Math.abs(m.gotX - m.wantX) < 2, 'x=' + Math.round(m.gotX) + ', треба ' + Math.round(m.wantX));
  ok('ширина виділення дорівнює ширині кроку',
     Math.abs(m.gotW - m.wantW) < 2, 'w=' + Math.round(m.gotW) + ', треба ' + Math.round(m.wantW));
}

/* ------------------------------------------------------------------ */
/* 3. Виділення ЇЗДИТЬ, а не перескакує                                 */
/* ------------------------------------------------------------------ */
{
  const path = await p.evaluate(async () => {
    const seg = document.querySelector('.seg');
    const x = () => {
      const m = getComputedStyle(seg, '::before').transform.match(/matrix\(([^)]+)\)/);
      return m ? Math.round(parseFloat(m[1].split(',')[4])) : null;
    };
    const step = [...seg.querySelectorAll('.seg__item span')].find(s => s.textContent.includes('3 дні'));
    const out = [x()];
    step.click();
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 4; i++) { await wait(70); out.push(x()); }
    return out;
  });
  const first = path[0], last = path[path.length - 1];
  ok('виділення переїхало', first !== last, path.join(' → '));
  /* Проміжні значення — і є доказ переїзду. Якби виділення перескакувало,
     усі заміри після кліку дорівнювали б кінцевому. */
  const mid = path.slice(1, -1).some(v => v !== first && v !== last);
  ok('переїзд плавний, а не стрибком', mid, path.join(' → '));
}

/* ------------------------------------------------------------------ */
/* 4. Доріжка, яку сторінка перемальовує цілком                         */
/* ------------------------------------------------------------------ */
{
  await p.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  const segs = await p.locator('.seg').count();
  ok('у журналі є перемальовані доріжки', segs > 0, String(segs));
  const bad = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('.seg').forEach((seg, i) => {
      const on = seg.querySelector('input:checked');
      if (!on) return;
      const sr = on.nextElementSibling.getBoundingClientRect(), gr = seg.getBoundingClientRect();
      const want = sr.left - gr.left - seg.clientLeft;
      const got = parseFloat(getComputedStyle(seg).getPropertyValue('--seg-x'));
      if (!(Math.abs(got - want) < 2)) out.push(i + ': ' + Math.round(got) + ' проти ' + Math.round(want));
    });
    return out;
  });
  ok('після перемальовки виділення на своєму місці в кожній доріжці',
     bad.length === 0, bad.join(', '));
}

/* ------------------------------------------------------------------ */
/* 5. Телефон                                                           */
/* ------------------------------------------------------------------ */
{
  const m = await adultContext(b, { viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true });
  const q = await m.newPage();
  const e2 = []; q.on('pageerror', (e) => e2.push(e.message));
  await q.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
  await q.waitForTimeout(2000);
  ok('375px: сторінка не поїхала вбік',
     await q.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok('375px: доріжка вміщається в картку',
     await q.evaluate(() => {
       const seg = document.querySelector('.seg');
       const c = seg.closest('.card');
       return seg.getBoundingClientRect().right <= c.getBoundingClientRect().right + 1;
     }));
  /* Тап по кроку — і виділення переїхало. */
  await q.locator('.seg__item span', { hasText: '4 дні' }).first().tap();
  await q.waitForTimeout(500);
  ok('375px: тап переставляє виділення',
     await q.evaluate(() => {
       const seg = document.querySelector('.seg');
       const on = seg.querySelector('input:checked');
       if (!on.nextElementSibling.textContent.includes('4 дні')) return false;
       const sr = on.nextElementSibling.getBoundingClientRect(), gr = seg.getBoundingClientRect();
       const want = sr.left - gr.left - seg.clientLeft;
       return Math.abs(parseFloat(getComputedStyle(seg).getPropertyValue('--seg-x')) - want) < 2;
     }));
  ok('375px: без JS-помилок', e2.length === 0, e2.slice(0, 2).join(' | '));
  await m.close();
}

ok('без JS-помилок', errs.length === 0, errs.slice(0, 3).join(' | '));

/* ---- Один ряд завжди ---------------------------------------------------
 * Доріжка перемикача — це «одна смуга, всередині якої їздить виділення».
 * Щойно вона ламається на два рядки, метафора зникає: власник побачив на
 * телефоні чотири дні в ряд і п'ятий сам під ними, і прочитав це як
 * помилку розкладки. Нею воно й було.
 *
 * Тепер ряд не переноситься ніколи, а коли не вміщається по-справжньому
 * (сім періодів «День…Рік» на 320px) — прокручується вбік. Перевіряється
 * і те, й те: жодного другого рядка, і виділення стоїть на обраному
 * кроці навіть у прокрученому ряду.
 */
{
  const PAGES = ['workout.html', 'journal.html', 'plan.html', 'meals.html', 'nutrition.html'];
  for (const w of [320, 390, 430]) {
    const ctx = await adultContext(b, {
      viewport: { width: w, height: 850 }, isMobile: true, hasTouch: true
    });
    const q = await ctx.newPage();
    const e3 = []; q.on('pageerror', (e) => e3.push(e.message));

    /* Програма на 5 днів: саме на ній ряд і ламався. */
    await q.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
    await q.evaluate(() => {
      const pr = JSON.parse(localStorage.getItem('ib.profile') || '{}');
      pr.programId = 'ulppl'; pr.daysPerWeek = 5;
      pr.activePlan = { programId: 'ulppl', days: 5 };
      localStorage.setItem('ib.profile', JSON.stringify(pr));
    });

    const bad = [];
    for (const page of PAGES) {
      await q.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' });
      await q.waitForTimeout(1500);
      const rows = await q.evaluate(() => {
        const out = [];
        document.querySelectorAll('.seg').forEach((seg) => {
          const items = [...seg.querySelectorAll('.seg__item')];
          if (!items.length) return;
          const tops = new Set(items.map((i) => Math.round(i.getBoundingClientRect().top)));
          if (tops.size > 1) {
            out.push(items.map((i) => i.textContent.trim()).join('|').slice(0, 40));
          }
        });
        return out;
      });
      rows.forEach((r) => bad.push(page + ': ' + r));
    }
    ok(w + 'px: жоден перемикач не переноситься на другий рядок',
       bad.length === 0, bad.join(' ; '));
    ok(w + 'px: без JS-помилок у прогоні сторінок', e3.length === 0, e3.slice(0, 2).join(' | '));
    await ctx.close();
  }
}

/* ---- Виділення не відстає від прокрутки ------------------------------ */
{
  const ctx = await adultContext(b, {
    viewport: { width: 320, height: 850 }, isMobile: true, hasTouch: true
  });
  const q = await ctx.newPage();
  await q.goto('file://' + ROOT + '/journal.html#jr-adherence', { waitUntil: 'load' });
  await q.waitForTimeout(1800);
  const m2 = await q.evaluate(async () => {
    /* Беремо ряд із НАЙБІЛЬШИМ надлишком: перемикач, що вилазить на два
       пікселі, для цієї перевірки нічого не доводить. */
    const segs = [...document.querySelectorAll('.seg')]
      .filter((s) => s.querySelectorAll('.seg__item').length >= 5)
      .sort((a, c) => (c.scrollWidth - c.clientWidth) - (a.scrollWidth - a.clientWidth));
    const seg = segs[0];
    if (!seg || seg.scrollWidth - seg.clientWidth < 40) return { skip: true };
    const items = [...seg.querySelectorAll('.seg__item input')];
    const last = items[items.length - 1];
    /* Чи був останній крок за краєм ДО вибору — інакше «підвести ряд»
       нема куди, і вимагати прокрутки було б неправильно. */
    const wasHidden =
      last.nextElementSibling.getBoundingClientRect().right >
      seg.getBoundingClientRect().right + 1;
    /* Позначка, за якою знайдемо ряд ЗАНОВО: блок журналу
       перемальовується на зміну періоду, і стара вершина стає
       від'єднаною — вимірювати по ній означало б міряти ніщо. */
    const mark = [...seg.querySelectorAll('.seg__item')]
      .map((i) => i.textContent.trim()).join('|');
    last.checked = true;
    last.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));

    const seg2 = [...document.querySelectorAll('.seg')].find((s) =>
      [...s.querySelectorAll('.seg__item')].map((i) => i.textContent.trim()).join('|') === mark);
    if (!seg2) return { skip: true, why: 'ряд зник після перемальовки' };
    const on = seg2.querySelector('input:checked');
    if (!on) return { skip: true, why: 'після перемальовки нічого не обрано' };
    const span = on.nextElementSibling;
    const sr = span.getBoundingClientRect(), br = seg2.getBoundingClientRect();
    return {
      wasHidden: wasHidden,
      lastChosen: on === [...seg2.querySelectorAll('.seg__item input')].pop(),
      scrolled: seg2.scrollLeft > 0,
      /* Виділення стоїть там само, де обраний крок, у координатах вмісту. */
      hlOk: Math.abs((sr.left - br.left + seg2.scrollLeft) -
                     parseFloat(getComputedStyle(seg2).getPropertyValue('--seg-x'))) < 2,
      /* І сам крок видно, а не за краєм. */
      visible: sr.left >= br.left - 1 && sr.right <= br.right + 1
    };
  });
  if (m2.skip) {
    ok('320px: є прокручуваний перемикач для перевірки', false, 'не знайдено');
  } else {
    ok('320px: вибір кроку за краєм підводить ряд до нього',
       !m2.wasHidden || m2.scrolled, JSON.stringify(m2));
    ok('320px: виділення стоїть на обраному кроці, а не відстає', m2.hlOk, JSON.stringify(m2));
    ok('320px: обраний крок видно повністю', m2.visible);
  }
  await ctx.close();
}

await b.close();
const bad = R.filter(([, c]) => !c).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок перемикача пройшло.');
process.exit(bad ? 1 : 0);
