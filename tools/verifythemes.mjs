/**
 * Оформлення: воно ОДНЕ, і воно тримає контраст.
 *
 * Донедавна тут міряли 9 акцентів × 2 схеми = 18 комбінацій. Ні акцентів,
 * ні світлої схеми більше немає — лишилась одна монохромна темна основа
 * (:root у css/style.css). Тому перевірка змінила предмет, але не суть:
 *
 *   1. єдина палітра проходить ті самі пороги контрасту, і міряються не
 *      значення з файла, а те, що браузер реально порахував;
 *   2. кольори НЕ МОЖНА повернути випадково: якщо на <html> поставити
 *      старий data-theme або data-scheme, не мусить змінитись НІЧОГО —
 *      саме на цьому тримається тихий перехід для чужих профілів;
 *   3. прибраного API (App.setTheme, setScheme, themes, toggleScheme…)
 *      справді немає, а сторінка акаунта без нього не падає;
 *   4. профіль зі старим значенням theme/scheme імпортується, зберігається
 *      й нічого не фарбує.
 *
 * Пороги ті самі, що заявлені в коментарі до палітри в css/style.css:
 *   • основний текст на поверхні         ≥ 4,5:1
 *   • акцентний текст (--acc-ink, лінки) ≥ 4,5:1
 *   • текст на заливці кнопки (--on-acc) ≥ 4,5:1
 *   • смуги даних і межі                 ≥ 3:1
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

/* Значення, які могли лишитись у чужих профілях і в localStorage. Жодне з
   них не має нічого міняти на екрані. */
const LEGACY = ['graphite', 'graphite-navy', 'graphite-pink', 'graphite-violet',
                'graphite-crimson', 'graphite-moss', 'graphite-emerald',
                'graphite-ocean', 'graphite-amber', 'pink', 'wood', 'violet',
                'crimson', 'moss', 'emerald', 'ocean'];

/* ------------------------------------------------------------------ */
/* 0. У самому CSS правил під теми не лишилось                          */
/* ------------------------------------------------------------------ */
{
  const css = readFileSync(ROOT + '/css/style.css', 'utf8');
  /* Коментарі не рахуються: у них ці слова стоять як пояснення, чому
     правил немає. Ловимо саме селектори. */
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hits = (bare.match(/\[data-(theme|scheme)/g) || []);
  ok('у css/style.css немає жодного селектора з data-theme / data-scheme',
     hits.length === 0, hits.join(', '));
}

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await adultContext(b, { viewport: { width: 1280, height: 900 } });
/* Мережа не потрібна: перевіряємо обчислені стилі, а не дані. Без цього
   кожна сторінка чекає на шрифти й Supabase, і прогін не встигає. */
await ctx.route(/^https?:\/\//, r => r.abort());
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('file://' + ROOT + '/calculator.html', { waitUntil: 'load' });
await p.waitForTimeout(800);

await p.addScriptTag({ content: `
  window.__cr = function (a, b) {
    const rgb = s => { const m = String(s).match(/\\d+(\\.\\d+)?/g) || [0,0,0]; return m.slice(0,3).map(Number); };
    const lin = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
    const L = s => { const [r,g,bb] = rgb(s); return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(bb); };
    const l1 = L(a), l2 = L(b);
    return (Math.max(l1,l2)+0.05) / (Math.min(l1,l2)+0.05);
  };
  window.__probe = function () {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    const card = document.querySelector('.card');
    const cardBg = getComputedStyle(card).backgroundColor;
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const fieldEl = document.querySelector('.input') || card;
    const fieldBg = getComputedStyle(fieldEl).backgroundColor;
    const toRgb = h => {
      const d = document.createElement('i'); d.style.color = h; document.body.appendChild(d);
      const c = getComputedStyle(d).color; d.remove(); return c;
    };
    const onAcc = v('--on-acc') || '#ffffff';
    return {
      cardBg, bodyBg, fieldBg,
      transparent: /rgba\\(0, 0, 0, 0\\)|transparent/.test(cardBg) || /rgba\\(0, 0, 0, 0\\)|transparent/.test(bodyBg),
      text:    __cr(toRgb(v('--text')),    cardBg),
      muted:   __cr(toRgb(v('--muted')),   cardBg),
      ink:     __cr(toRgb(v('--acc-ink')), cardBg),
      inkSurf: __cr(toRgb(v('--acc-ink')), fieldBg),
      onFill:  __cr(toRgb(onAcc),          toRgb(v('--acc'))),
      fill:    __cr(toRgb(v('--acc')),     cardBg),
      bar:     __cr(toRgb(v('--acc-bar')), cardBg),
      line:    __cr(toRgb(v('--acc-line')),cardBg),
      link:    __cr(toRgb(v('--link')),    cardBg)
    };
  };
`});

/* ------------------------------------------------------------------ */
/* 1. Єдина палітра тримає пороги                                       */
/* ------------------------------------------------------------------ */
const base = await p.evaluate(() => window.__probe());
ok('поверхні непрозорі', !base.transparent, base.cardBg + ' / ' + base.bodyBg);
ok('основний текст ≥ 4,5', base.text >= 4.5, base.text.toFixed(2));
ok('приглушений текст ≥ 4,5', base.muted >= 4.5, base.muted.toFixed(2));
ok('акцентний текст ≥ 4,5', base.ink >= 4.5, base.ink.toFixed(2));
ok('акцентний текст у полі ≥ 4,5', base.inkSurf >= 4.5, base.inkSurf.toFixed(2));
ok('посилання ≥ 4,5', base.link >= 4.5, base.link.toFixed(2));
ok('текст на заливці кнопки ≥ 4,5', base.onFill >= 4.5, base.onFill.toFixed(2));
ok('заливка видима на картці ≥ 3', base.fill >= 3, base.fill.toFixed(2));
ok('смуги даних ≥ 3', base.bar >= 3, base.bar.toFixed(2));
ok('межі акценту ≥ 3', base.line >= 3, base.line.toFixed(2));

/* Монохром — це не «сірувато», а рівно один тон: у кожного акцентного
   токена R = G = B. Саме це й ламається першим, якщо колір повернеться
   через окремий селектор, а не через тему. */
{
  const grey = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const toRgb = h => { const d = document.createElement('i'); d.style.color = h;
      document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const bad = [];
    ['--text', '--muted', '--acc', '--acc-ink', '--acc-bar', '--acc-line', '--link', '--on-acc']
      .forEach(function (n) {
        const [r, g, bl] = toRgb(cs.getPropertyValue(n).trim()).match(/\d+/g).slice(0, 3).map(Number);
        if (Math.max(r, g, bl) - Math.min(r, g, bl) > 6) bad.push(n + ' = ' + [r, g, bl].join(','));
      });
    return bad;
  });
  ok('палітра справді монохромна (R=G=B у кожного токена)', grey.length === 0, grey.join(' | '));
}

/* ------------------------------------------------------------------ */
/* 2. Старі атрибути не міняють нічого                                  */
/* ------------------------------------------------------------------ */
{
  const changed = [];
  for (const t of LEGACY) {
    const m = await p.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      const cs = getComputedStyle(document.documentElement);
      const out = ['--acc', '--acc-ink', '--acc-bar', '--link']
        .map(n => cs.getPropertyValue(n).trim()).join('|');
      document.documentElement.removeAttribute('data-theme');
      return out;
    }, t);
    const ref = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return ['--acc', '--acc-ink', '--acc-bar', '--link']
        .map(n => cs.getPropertyValue(n).trim()).join('|');
    });
    if (m !== ref) changed.push(t + ': ' + m);
  }
  ok('жодне збережене значення data-theme не фарбує сторінку',
     changed.length === 0, changed.join(' ; '));

  const lightRef = await p.evaluate(() => {
    const before = getComputedStyle(document.querySelector('.card')).backgroundColor;
    document.documentElement.setAttribute('data-scheme', 'light');
    const after = getComputedStyle(document.querySelector('.card')).backgroundColor;
    document.documentElement.removeAttribute('data-scheme');
    return [before, after];
  });
  ok('data-scheme="light" не вмикає світлу схему', lightRef[0] === lightRef[1],
     lightRef.join(' → '));
}

/* ------------------------------------------------------------------ */
/* 3. Прибране API справді прибране                                     */
/* ------------------------------------------------------------------ */
{
  const left = await p.evaluate(() =>
    ['setTheme', 'setScheme', 'toggleScheme', 'currentScheme', 'normTheme', 'themes']
      .filter(k => k in window.App));
  ok('App більше не має API оформлення', left.length === 0, left.join(', '));

  const meta = await p.evaluate(() => {
    const m = document.querySelector('meta[name="theme-color"]');
    return m ? m.content.toLowerCase() : '(немає)';
  });
  ok('колір системної смуги — темний і незмінний', meta === '#0b0b0b', meta);
}

/* ------------------------------------------------------------------ */
/* 4. Сторінка акаунта: вибору немає, сторінка жива                     */
/* ------------------------------------------------------------------ */
{
  const c2 = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const q = await c2.newPage();
  const e2 = []; q.on('pageerror', e => e2.push(e.message));
  q.on('dialog', d => d.accept());
  await q.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await q.waitForTimeout(1000);

  ok('плашок вибору акценту немає', await q.locator('.theme-btn').count() === 0);
  ok('перемикача світлої теми немає', await q.locator('#p-scheme').count() === 0);
  ok('контейнера #theme немає', await q.locator('#theme').count() === 0);
  /* Сторінка мусить лишитись робочою: блоки, які стояли поруч із вибором
     оформлення, нікуди не поділись. */
  ok('решта акаунта на місці', await q.locator('#profile').count() === 1 &&
                               await q.locator('#mode').count() === 1);
  ok('сторінка акаунта без JS-помилок', e2.length === 0, e2.join(' | '));
  await c2.close();
}

/* ------------------------------------------------------------------ */
/* 5. Імпорт профілю зі старим оформленням                              */
/* ------------------------------------------------------------------ */
{
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const c3 = await adultContext(b, { viewport: { width: 1280, height: 900 } });
  const q = await c3.newPage();
  const e3 = []; q.on('pageerror', e => e3.push(e.message));
  q.on('dialog', d => d.accept());
  await q.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await q.waitForTimeout(700);

  for (const theme of ['graphite-moss', 'ocean', 'вигадана']) {
    const f = path.join(os.tmpdir(), 'theme-' + Buffer.from(theme).toString('hex') + '.json');
    fs.writeFileSync(f, JSON.stringify({ version: 5, birthDate: '1990-06-15', weight: 80,
                                         theme: theme, scheme: 'light' }));
    await q.evaluate((birth) => {
      try {
        localStorage.clear();
        localStorage.setItem('ib.profile', JSON.stringify({ version: 6, birthDate: birth }));
      } catch (_) {}
    }, '1990-06-15');
    await q.reload({ waitUntil: 'load' }); await q.waitForTimeout(700);
    await q.setInputFiles('#p-import-file', f);
    await q.waitForTimeout(1200);
    const got = await q.evaluate(async () => {
      const pr = await window.Store.getProfile();
      return { weight: pr.weight,
               attrT: document.documentElement.getAttribute('data-theme'),
               attrS: document.documentElement.getAttribute('data-scheme') };
    });
    ok('імпорт профілю з темою «' + theme + '»: решта полів ціла', got.weight === 80, String(got.weight));
    ok('імпорт профілю з темою «' + theme + '»: нічого не перефарбувалось',
       got.attrT === null && got.attrS === null, JSON.stringify(got));
  }

  ok('імпорт без JS-помилок', e3.length === 0, e3.join(' | '));
  await c3.close();
}

ok('без JS-помилок', errs.length === 0, errs.join(' | '));

await b.close();
const bad = R.filter(r => !r[1]);
console.log('\n' + (R.length - bad.length) + '/' + R.length + ' перевірок оформлення пройшло.');
if (bad.length) { console.log('ПРОВАЛЕНО:\n' + bad.map(r => '  · ' + r[0]).join('\n')); process.exit(1); }
