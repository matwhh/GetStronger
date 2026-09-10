/**
 * Скляні картки вибору плану: нахил, блик, фокус.
 *
 * ЩО ТУТ СТЕРЕЖЕТЬСЯ І ЧОМУ ЦЬОГО НЕ ВИДНО ІНАКШЕ.
 *
 * Ефект живе на стику JS і CSS: js/app.js кладе чотири числа у змінні,
 * CSS складає з них transform. Розійтись вони можуть тихо — наприклад,
 * якщо якесь інше правило перебʼє transform (так уже було: базове
 * .card--hover:hover має ту саму вагу й піднімало картку на 5px замість
 * нахилу — змінні при цьому виставлялись правильно, а на екрані нахилу
 * не було). Тому перевіряється не «змінна виставилась», а ОБЧИСЛЕНИЙ
 * браузером transform.
 *
 * І окремо — читабельність. Напівпрозора поверхня означає, що контраст
 * тексту залежить від того, що під нею. verifythemes міряє звичайну
 * картку на калькуляторі й цих карток не бачить, тож контраст скла
 * рахується тут, з урахуванням підкладки.
 */
import { chromium } from 'playwright';
import { adultContext, adultProfile } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

/* П'ять днів — єдина кількість, де доступні РІВНО дві схеми: є що
   підсвітити й є що приглушити. */
const PROFILE = { activePlan: { programId: 'fullbody', days: 5 }, programId: 'fullbody', daysPerWeek: 5 };

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

await p.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
await p.evaluate(async (s) => {
  try { await window.Store.saveProfile(s); } catch (e) { if (!e.queued) throw e; }
}, adultProfile(PROFILE));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(2200);

const LIVE = '#program-list .card--glass:not(.card--off)';
const hoverAt = async (fx, fy) => {
  const box = await p.locator(LIVE).first().boundingBox();
  await p.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  await p.waitForTimeout(260);
};
const vars = () => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  const s = el.style;
  return {
    x: parseFloat(s.getPropertyValue('--tilt-x')),
    y: parseFloat(s.getPropertyValue('--tilt-y')),
    sx: parseFloat(s.getPropertyValue('--spot-x')),
    sy: parseFloat(s.getPropertyValue('--spot-y')),
    tr: getComputedStyle(el).transform
  };
}, LIVE);

/* ------------------------------------------------------------------ */
/* 1. Нахил справді застосований, а не лише порахований                 */
/* ------------------------------------------------------------------ */
{
  /*
   * У спокої картка НЕ має бути повернута — але transform у неї є завжди:
   * perspective(900px) сам по собі дає matrix3d. Тому дивимось не на
   * наявність матриці, а на позадіагональні члени: саме вони й є поворот.
   */
  ok('до наведення поворот нульовий',
     await p.evaluate((sel) => {
       const t = getComputedStyle(document.querySelector(sel)).transform;
       if (t === 'none') return true;
       /* Числа беремо ТІЛЬКИ з дужок: інакше «3d» у слові matrix3d теж
          потрапляє в набір і зсуває всі індекси на одиницю. */
       const inside = (t.match(/\(([^)]*)\)/) || [, ''])[1];
       const n = inside.split(',').map(v => Number(v.trim()));
       if (n.length < 16) return n.length === 6 && n[1] === 0 && n[2] === 0;
       /* matrix3d: 1,4 і 4,1 — поворот навколо осей X та Y */
       return Math.abs(n[1]) < 1e-4 && Math.abs(n[2]) < 1e-4 &&
              Math.abs(n[4]) < 1e-4 && Math.abs(n[6]) < 1e-4;
     }, LIVE));

  await hoverAt(0.8, 0.2);
  const a = await vars();
  ok('на наведенні браузер рахує 3D-трансформ', /matrix3d/.test(a.tr), a.tr.slice(0, 40));
  ok('кути ненульові', Math.abs(a.x) > 0.5 && Math.abs(a.y) > 0.5, a.x + ' / ' + a.y);

  await hoverAt(0.2, 0.8);
  const c = await vars();
  ok('кути йдуть за курсором (знак міняється)',
     Math.sign(a.x) !== Math.sign(c.x) && Math.sign(a.y) !== Math.sign(c.y),
     JSON.stringify({ верх: a.x + '/' + a.y, низ: c.x + '/' + c.y }));

  /* Стеля кута — не примха: на картці ~290px більше десяти градусів уже
     читається як перекошений текст, а не як об'єм. */
  const all = [a, c];
  ok('нахил не перевищує 7°',
     all.every(v => Math.abs(v.x) <= 7.01 && Math.abs(v.y) <= 7.01),
     all.map(v => v.x + '/' + v.y).join(' ; '));

  ok('блик їде за курсором',
     Math.abs(a.sx - c.sx) > 20 && Math.abs(a.sy - c.sy) > 20,
     a.sx + '/' + a.sy + ' → ' + c.sx + '/' + c.sy);
}

/* ------------------------------------------------------------------ */
/* 2. Фокус: одна картка яскрава, решта приглушені                      */
/* ------------------------------------------------------------------ */
{
  await hoverAt(0.5, 0.5);
  const st = await p.evaluate(() => {
    const cs = [...document.querySelectorAll('#program-list .card--glass')];
    return {
      hot: cs.filter(c => c.classList.contains('is-hot')).length,
      cold: cs.filter(c => c.classList.contains('is-cold')).length,
      coldOpacity: cs.filter(c => c.classList.contains('is-cold'))
        .map(c => Number(getComputedStyle(c).opacity)),
      /* Недоступні картки в грі не беруть участі: нахиляти те, чого не
         можна обрати, означає обіцяти дію, якої немає. */
      offTouched: cs.filter(c => c.classList.contains('card--off') &&
        (c.classList.contains('is-hot') || c.classList.contains('is-cold'))).length
    };
  });
  ok('під курсором рівно одна картка', st.hot === 1, String(st.hot));
  ok('сусідні доступні картки приглушені', st.cold >= 1, String(st.cold));
  ok('приглушені справді тьмяніші', st.coldOpacity.every(o => o < 0.7), JSON.stringify(st.coldOpacity));
  ok('недоступні картки в ефекті не беруть участі', st.offTouched === 0, String(st.offTouched));

  await p.mouse.move(5, 5);
  await p.waitForTimeout(320);
  const back = await p.evaluate(() => {
    const cs = [...document.querySelectorAll('#program-list .card--glass')];
    return cs.filter(c => c.classList.contains('is-hot') || c.classList.contains('is-cold')).length;
  });
  ok('після відведення все повертається', back === 0, String(back));
}

/* ------------------------------------------------------------------ */
/* 3. Скло лишається читабельним                                        */
/* ------------------------------------------------------------------ */
{
  const m = await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    const cs = getComputedStyle(el);
    /* Поверхня напівпрозора, тож справжній фон тексту — це вона,
       накладена на те, що під нею. Рахуємо саме накладений колір. */
    const parse = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
    const over = (fg, bg) => {
      const a = fg[3] === undefined ? 1 : fg[3];
      return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
    };
    const page = parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
    const surf = over(parse(cs.backgroundColor), page.length === 3 ? page : [11, 11, 11]);
    const toRgb = (h) => {
      const d = document.createElement('i'); d.style.color = h;
      document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove();
      return parse(c);
    };
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = (v) => 0.2126 * lin(v[0]) + 0.7152 * lin(v[1]) + 0.0722 * lin(v[2]);
    const cr = (f, b) => {
      const l1 = L(f), l2 = L(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    return {
      surface: surf.map(Math.round),
      text: cr(toRgb(cs.getPropertyValue('--text').trim()), surf),
      muted: cr(toRgb(cs.getPropertyValue('--muted').trim()), surf)
    };
  }, LIVE);
  ok('основний текст на склі ≥ 4,5', m.text >= 4.5, m.text.toFixed(2) + ' на rgb(' + m.surface.join(',') + ')');
  ok('приглушений текст на склі ≥ 4,5', m.muted >= 4.5, m.muted.toFixed(2));
}

/* ------------------------------------------------------------------ */
/* 4. Дотик: ефекту немає                                               */
/* ------------------------------------------------------------------ */
{
  const m = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const q = await m.newPage();
  const e2 = []; q.on('pageerror', (e) => e2.push(e.message));
  await q.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
  await q.waitForTimeout(2000);
  const st = await q.evaluate(() => {
    const el = document.querySelector('#program-list .card--glass');
    const cs = getComputedStyle(el);
    return { tr: cs.transform, bf: cs.backdropFilter || cs.webkitBackdropFilter };
  });
  /*
   * НА ДОТИКУ ВИМИКАЄТЬСЯ НАХИЛ, А НЕ СКЛО.
   *
   * Раніше тут стояло «розмиття вимкнене» — і ця перевірка закріплювала
   * помилку: разом із нахилом гасились backdrop-filter і світло під
   * сіткою, тобто на телефоні від скла лишалась напівпрозора плашка на
   * чорному. Але скло не потребує курсора, воно потребує світла позаду.
   * Курсора потребують рівно дві речі — нахил і блик, що за ним їде.
   */
  ok('375px: нахилу немає', st.tr === 'none' || !/matrix3d/.test(st.tr), st.tr.slice(0, 30));
  ok('375px: розмиття лишається (скло не потребує курсора)',
     /blur\(/.test(String(st.bf)), String(st.bf));
  /* Перевірка «світло під сіткою лишається» знята: світла більше немає
     ніде — власник прибрав бліки з-під карток. */
  ok('375px: сторінка не поїхала вбік',
     await q.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok('375px: без JS-помилок', e2.length === 0, e2.slice(0, 2).join(' | '));
  await m.close();
}

/* ------------------------------------------------------------------ */
/* 5. Плитки — така сама скляна поверхня, а не мертвий прямокутник      */
/* ------------------------------------------------------------------ */
/*
 * ЧОМУ ЦЕ ОКРЕМИЙ БЛОК. Плитки з числами (.kpi) і плитки-посилання
 * (.tile) отримали скляну поверхню разом із картками, але нахил і блик
 * тоді лишились тільки на картках — тобто половина скла на сайті була
 * жива, а половина ні. Візуально різницю видно лише під курсором, тому
 * без цієї перевірки вона повертається тихо: досить комусь звузити
 * селектор у CSS або в js/app.js — і плитки знову застигнуть.
 *
 * ОКРЕМО СТЕРЕЖЕТЬСЯ МЕЖА ПРИГЛУШЕННЯ. Сусіди беруться в спільного
 * батька, а не по всій сторінці: інакше наведення на одну плитку гасило
 * б пів екрана. Перевіряється саме це — сусід по сітці приглушений,
 * елемент з іншої сітки — ні.
 */
{
  const q = await ctx.newPage();
  const e3 = []; q.on('pageerror', (e) => e3.push(e.message));
  await q.goto('file://' + ROOT + '/journal.html', { waitUntil: 'load' });
  await q.waitForTimeout(2200);

  const n = await q.locator('.kpi').count();
  ok('у журналі є плитки, є що перевіряти', n >= 2, 'знайдено ' + n);

  if (n >= 2) {
    const box = await q.locator('.kpi').first().boundingBox();
    await q.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await q.waitForTimeout(260);

    const st = await q.evaluate(() => {
      const all = [].slice.call(document.querySelectorAll('.kpi'));
      const hot = all[0];
      const cs = getComputedStyle(hot);
      return {
        tr: cs.transform,
        hot: hot.classList.contains('is-hot'),
        glow: getComputedStyle(hot, '::after').opacity,
        tx: hot.style.getPropertyValue('--tilt-x'),
        cold: all.filter((e) => e !== hot && e.parentElement === hot.parentElement)
                 .every((e) => e.classList.contains('is-cold')),
        outside: [].slice.call(document.querySelectorAll('.card--glass, .kpi, .tile'))
                   .filter((e) => e.parentElement !== hot.parentElement)
                   .some((e) => e.classList.contains('is-cold'))
      };
    });

    ok('плитка нахиляється під курсором', /matrix3d/.test(st.tr), st.tr.slice(0, 34));
    ok('кут справді порахований, а не нульовий', parseFloat(st.tx) !== 0, st.tx);
    ok('плитка позначена гарячою', st.hot === true);
    ok('блик під курсором увімкнений', Number(st.glow) > 0.5, st.glow);
    ok('сусіди по сітці приглушені', st.cold === true);
    ok('скло за межами сітки НЕ приглушене', st.outside === false);

    await q.mouse.move(5, 5);
    await q.waitForTimeout(260);
    const off = await q.evaluate(() => {
      const hot = document.querySelector('.kpi');
      return { hot: hot.classList.contains('is-hot'), tx: hot.style.getPropertyValue('--tilt-x') };
    });
    ok('курсор пішов — плитка відпустилась', off.hot === false && off.tx === '', JSON.stringify(off));
  }
  ok('журнал: без JS-помилок', e3.length === 0, e3.slice(0, 2).join(' | '));
  await q.close();
}

ok('без JS-помилок', errs.length === 0, errs.slice(0, 3).join(' | '));

await b.close();
const bad = R.filter(([, c]) => !c).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок скляних карток пройшло.');
process.exit(bad ? 1 : 0);
