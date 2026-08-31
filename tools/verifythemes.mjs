/**
 * Оформлення: дві осі, обидві малюються, обидві проходять пороги контрасту.
 *
 *   СХЕМА   темна (типова) / світла   — html[data-scheme]
 *   АКЦЕНТ  девʼять графітових        — html[data-theme]
 *
 * Тобто 9 × 2 = 18 комбінацій, і кожна міряється окремо. Міряємо НЕ значення
 * з генератора, а те, що браузер реально порахував: getComputedStyle на живих
 * елементах. Пороги ті самі, що заявлені в коментарі до палітри в
 * css/style.css:
 *   • основний текст на поверхні         ≥ 4,5:1
 *   • акцентний текст (--acc-ink, лінки) ≥ 4,5:1
 *   • текст на заливці кнопки (--on-acc) ≥ 4,5:1
 *   • смуги даних і межі                 ≥ 3:1
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

/* null = монохром: атрибута немає, значення беруться з :root.
   Далі всі чинні кольорові акценти — контраст кожного міряється окремо
   в обох схемах. 'graphite-amber' у списку навмисно: він прибраний, і
   перевірка мусить показати, що він дає монохромні токени з :root, а не
   «поламану» тему без кольорів. */
const ACCENTS = [null, 'graphite-navy', 'graphite', 'graphite-pink',
                 'graphite-violet', 'graphite-crimson', 'graphite-moss',
                 'graphite-emerald', 'graphite-ocean', 'graphite-amber'];
const SCHEMES = ['dark', 'light'];

/* Прибрані кольорові теми: id лишились у старих профілях і мусять
   переноситись на найближчий графітовий акцент, а не зникати. */
const LEGACY = { pink: 'graphite-pink', wood: 'graphite', violet: 'graphite-violet',
                 crimson: 'graphite-crimson', moss: 'graphite-moss',
                 emerald: 'graphite-emerald', ocean: 'graphite-ocean' };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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

const rows = [];
for (const scheme of SCHEMES) {
  for (const t of ACCENTS) {
    await p.evaluate(([t, scheme]) => {
      if (t) document.documentElement.setAttribute('data-theme', t);
      else document.documentElement.removeAttribute('data-theme');
      if (scheme === 'light') document.documentElement.setAttribute('data-scheme', 'light');
      else document.documentElement.removeAttribute('data-scheme');
    }, [t, scheme]);
    await p.waitForTimeout(120);
    const m = await p.evaluate(() => window.__probe());
    const name = (scheme === 'light' ? 'світла/' : 'темна/') + (t || 'монохром');
    rows.push([name, scheme, t, m]);

    ok(name + ': поверхні непрозорі', !m.transparent, m.cardBg + ' / ' + m.bodyBg);
    ok(name + ': основний текст ≥ 4,5', m.text >= 4.5, m.text.toFixed(2));
    ok(name + ': приглушений текст ≥ 4,5', m.muted >= 4.5, m.muted.toFixed(2));
    ok(name + ': акцентний текст ≥ 4,5', m.ink >= 4.5, m.ink.toFixed(2));
    ok(name + ': акцентний текст у полі ≥ 4,5', m.inkSurf >= 4.5, m.inkSurf.toFixed(2));
    ok(name + ': посилання ≥ 4,5', m.link >= 4.5, m.link.toFixed(2));
    ok(name + ': текст на заливці кнопки ≥ 4,5', m.onFill >= 4.5, m.onFill.toFixed(2));
    ok(name + ': заливка видима на картці ≥ 3', m.fill >= 3, m.fill.toFixed(2));
    ok(name + ': смуги даних ≥ 3', m.bar >= 3, m.bar.toFixed(2));
    ok(name + ': межі акценту ≥ 3', m.line >= 3, m.line.toFixed(2));
  }
}

/* Поверхні спільні для ВСІХ акцентів усередині схеми — у цьому весь сенс
   однієї графітової основи. Кольорових сімей, де тон заходив у поверхні,
   більше немає, і цей тест стереже, щоб вони не повернулись. */
for (const scheme of SCHEMES) {
  const cards = rows.filter(r => r[1] === scheme).map(r => r[3].cardBg);
  ok('схема ' + scheme + ': усі акценти ділять одну поверхню',
     new Set(cards).size === 1, [...new Set(cards)].join(' | '));
}

/* Схеми мусять справді відрізнятись, і саме в потрібний бік */
{
  const dark = rows.find(r => r[1] === 'dark' && r[2] === null)[3];
  const light = rows.find(r => r[1] === 'light' && r[2] === null)[3];
  const lum = s => { const [r, g, bl] = String(s).match(/\d+/g).slice(0, 3).map(Number);
                     return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  ok('світла схема справді світліша за темну',
     lum(light.cardBg) > lum(dark.cardBg) + 100,
     Math.round(lum(dark.cardBg)) + ' → ' + Math.round(lum(light.cardBg)));
}

/* ---- API: акцент ---- */
await p.evaluate(() => { document.documentElement.removeAttribute('data-theme'); });
for (const t of ['graphite-ocean']) {
  const applied = await p.evaluate(t => {
    window.App.setTheme(t, { save: false });
    return { attr: document.documentElement.getAttribute('data-theme'),
             ls: localStorage.getItem('forge.theme') };
  }, t);
  ok('App.setTheme("' + t + '") застосовує й запамʼятовує', applied.attr === t && applied.ls === t,
     JSON.stringify(applied));
}
const bogus = await p.evaluate(() => {
  window.App.setTheme('не-існує', { save: false });
  return document.documentElement.getAttribute('data-theme');
});
ok('невідомий акцент скидається на типовий', bogus === null, String(bogus));

for (const [oldId, newId] of Object.entries(LEGACY)) {
  const got = await p.evaluate(o => {
    window.App.setTheme(o, { save: false });
    return document.documentElement.getAttribute('data-theme');
  }, oldId);
  ok('прибрана тема «' + oldId + '» переїхала на ' + newId, got === newId, String(got));
}

/* ---- API: схема ---- */
{
  const dark = await p.evaluate(() => {
    window.App.setScheme('dark', { save: false });
    return { attr: document.documentElement.getAttribute('data-scheme'),
             ls: localStorage.getItem('forge.scheme'),
             meta: document.querySelector('meta[name="theme-color"]').content };
  });
  ok('темна схема — без атрибута й без запису', dark.attr === null && dark.ls === null,
     JSON.stringify(dark));

  const light = await p.evaluate(() => {
    window.App.setScheme('light', { save: false });
    return { attr: document.documentElement.getAttribute('data-scheme'),
             ls: localStorage.getItem('forge.scheme'),
             meta: document.querySelector('meta[name="theme-color"]').content };
  });
  ok('світла схема ставить атрибут і памʼятає', light.attr === 'light' && light.ls === 'light',
     JSON.stringify(light));
  ok('колір системної смуги йде за схемою',
     light.meta.toLowerCase() === '#e7e7e7' && dark.meta.toLowerCase() === '#0b0b0b',
     dark.meta + ' → ' + light.meta);

  const toggled = await p.evaluate(() => {
    window.App.toggleScheme();
    const a = document.documentElement.getAttribute('data-scheme');
    window.App.toggleScheme();
    return [a, document.documentElement.getAttribute('data-scheme')];
  });
  ok('toggleScheme перемикає туди й назад', toggled[0] === null && toggled[1] === 'light',
     JSON.stringify(toggled));

  const bad = await p.evaluate(() => {
    window.App.setScheme('сепія', { save: false });
    return document.documentElement.getAttribute('data-scheme');
  });
  ok('невідома схема скидається на темну', bad === null, String(bad));
  await p.evaluate(() => window.App.setScheme('dark', { save: false }));
}

/* ---- Кнопка схеми в шапці ---- */
{
  const c4 = await adultContext(b, { viewport: { width: 1280, height: 900 } });
  const q = await c4.newPage();
  const e4 = []; q.on('pageerror', e => e4.push(e.message));
  await q.goto('file://' + ROOT + '/index.html', { waitUntil: 'load' });
  await q.waitForTimeout(900);

  /* Перемикача в шапці більше немає — вибір схеми живе тільки в акаунті.
     Перевіряємо саме відсутність: якщо кнопка колись повернеться сюди
     випадково, це має впасти, а не «просто зʼявитись». */
  ok('кнопки схеми в шапці немає', await q.locator('.nav__scheme').count() === 0,
     String(await q.locator('.nav__scheme').count()));
  ok('у шапці немає жодного перемикача схеми',
     await q.locator('[data-scheme-toggle]').count() === 0);

  /* Схема все одно мусить застосовуватись і переживати перезавантаження —
     тепер через API, яким користується сторінка акаунта. */
  await q.evaluate(() => window.App.setScheme('light')); await q.waitForTimeout(400);
  ok('setScheme вмикає світлу схему',
     await q.evaluate(() => document.documentElement.getAttribute('data-scheme')) === 'light');

  await q.reload({ waitUntil: 'load' }); await q.waitForTimeout(800);
  ok('схема пережила перезавантаження',
     await q.evaluate(() => document.documentElement.getAttribute('data-scheme')) === 'light');
  ok('схема записалась у профіль',
     (await q.evaluate(async () => (await window.Store.getProfile()).scheme)) === 'light');

  await q.evaluate(() => window.App.setScheme('dark')); await q.waitForTimeout(400);
  ok('setScheme повертає темну схему',
     await q.evaluate(() => document.documentElement.getAttribute('data-scheme')) === null);

  ok('головна без JS-помилок', e4.length === 0, e4.join(' | '));
  await c4.close();
}

/* ---- Вибір оформлення на сторінці акаунта ---- */
{
  const c2 = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const q = await c2.newPage();
  const e2 = []; q.on('pageerror', e => e2.push(e.message));
  q.on('dialog', d => d.accept());
  await q.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await q.waitForTimeout(1000);

  const btns = await q.locator('.theme-btn').count();
  /* Монохром + сім кольорових акцентів + «Ліс» (власні поверхні).
     «Бурштин» прибраний — якщо він повернеться в список без CSS-блоку,
     плашок стане одинадцять і це впаде. */
  ok('у виборі акцентів десять плашок', btns === 10, String(btns));

  /* Справжній інваріант за лічильником: кожна плашка мусить мати СВІЙ
     CSS-блок. Тема без блоку виглядала б у списку, але нічого не міняла —
     саме це й ловилось магічним числом, тільки непрямо. */
  const dead = await q.evaluate(() => {
    const root = document.documentElement;
    const was = root.dataset.theme || '';
    const read = () => {
      const cs = getComputedStyle(root);
      return cs.getPropertyValue('--acc').trim() + '|' + cs.getPropertyValue('--bg').trim();
    };
    delete root.dataset.theme;
    const base = read();
    const bad = [];
    [...document.querySelectorAll('[data-theme-pick]')].forEach(btn => {
      const id = btn.dataset.themePick;
      if (!id) return;                       // монохром — це і є база
      root.dataset.theme = id;
      if (read() === base) bad.push(id);
      delete root.dataset.theme;
    });
    if (was) root.dataset.theme = was;
    return bad;
  });
  ok('кожна плашка має свій CSS-блок', dead.length === 0, dead.join(', ') || 'усі мають');

  const names0 = await q.evaluate(() =>
    [...document.querySelectorAll('.themes .theme-btn span')].map(s => s.textContent.trim()));
  ok('монохром перший у списку', names0[0] === 'Монохром', names0[0]);
  ok('«Бурштин» прибраний зі списку', !names0.includes('Бурштин'), names0.join(', '));
  ok('«Ліс» є у списку', names0.includes('Ліс'), names0.join(', '));

  const names = await q.evaluate(() =>
    [...document.querySelectorAll('.themes .theme-btn span')].map(s => s.textContent.trim()));
  ok('назви акцентів не повторюються', new Set(names).size === names.length, names.join(', '));

  const swatches = await q.evaluate(() => [...document.querySelectorAll('.theme-btn')]
    .map(x => [...x.querySelectorAll('i')].map(i => i.style.background).join('/')));
  ok('у кожної плашки два кружки кольору', swatches.every(s => s.split('/').length === 2));
  ok('кружки не повторюються між акцентами', new Set(swatches).size === swatches.length,
     swatches.length - new Set(swatches).size + ' дублів');

  /* Тиснемо кольорову плашку як людина — «Океан» лежить останнім. */
  const pick = q.locator('.themes .theme-btn', { hasText: 'Океан' });
  ok('плашка «Океан» на місці', await pick.count() === 1);
  await pick.scrollIntoViewIfNeeded(); await pick.click(); await q.waitForTimeout(700);
  const after = await q.evaluate(async () => ({
    attr: document.documentElement.getAttribute('data-theme'),
    pressed: document.querySelector('.themes .theme-btn[data-theme-pick="graphite-ocean"]')
      .getAttribute('aria-pressed'),
    saved: (await window.Store.getProfile()).theme
  }));
  ok('клік по плашці застосував акцент', after.attr === 'graphite-ocean', String(after.attr));
  ok('плашка позначена активною', after.pressed === 'true', after.pressed);
  ok('акцент записаний у профіль', after.saved === 'graphite-ocean', String(after.saved));

  /* Повертаємось на монохром: він базовий :root, тож атрибут знімається. */
  const mono = q.locator('.themes .theme-btn', { hasText: 'Монохром' });
  await mono.scrollIntoViewIfNeeded(); await mono.click(); await q.waitForTimeout(700);
  ok('монохром знімає data-theme',
     await q.evaluate(() => document.documentElement.getAttribute('data-theme')) === null);

  /* перемикач схеми на самій сторінці */
  const sw = q.locator('#p-scheme');
  ok('перемикач світлої теми на місці', await sw.count() === 1);
  await sw.scrollIntoViewIfNeeded();
  await sw.check({ force: true }); await q.waitForTimeout(600);
  ok('перемикач вмикає світлу схему',
     await q.evaluate(() => document.documentElement.getAttribute('data-scheme')) === 'light');
  const relit = await q.evaluate(() =>
    [...document.querySelectorAll('.theme-btn i')].map(i => i.style.background)[0]);
  ok('свотчі перемалювались під світлу схему', /26|246/.test(relit), relit);

  await q.reload({ waitUntil: 'load' }); await q.waitForTimeout(800);
  ok('палітра і схема пережили перезавантаження',
     await q.evaluate(() => document.documentElement.getAttribute('data-theme')) === null &&
     await q.evaluate(() => document.documentElement.getAttribute('data-scheme')) === 'light');

  ok('сторінка акаунта без JS-помилок', e2.length === 0, e2.join(' | '));
  await c2.close();
}

/* ---- Імпорт профілю з оформленням ---- */
{
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const c3 = await adultContext(b, { viewport: { width: 1280, height: 900 } });
  const q = await c3.newPage();
  const e3 = []; q.on('pageerror', e => e3.push(e.message));
  q.on('dialog', d => d.accept());
  await q.goto('file://' + ROOT + '/account.html', { waitUntil: 'load' });
  await q.waitForTimeout(700);

  /* Кожен файл — у своєму чистому контексті: імпорт ЗЛИВАЄ поля з наявним
     профілем, тож після відкинутої теми лишається попередня, і перевірка
     «стало null» була б неправдою про поведінку, а не про баг. */
  for (const [theme, expect] of [['graphite-moss', 'graphite-moss'],
                                 ['ocean', 'ocean'],          /* старий id зберігається як є… */
                                 ['вигадана', null],
                                 ['<script>', null]]) {
    const f = path.join(os.tmpdir(), 'theme-' + Buffer.from(theme).toString('hex') + '.json');
    fs.writeFileSync(f, JSON.stringify({ version: 5, birthDate:'1990-06-15', weight: 80, theme: theme }));
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
      return { theme: pr.theme, weight: pr.weight,
               attr: document.documentElement.getAttribute('data-theme') };
    });
    ok('імпорт теми «' + theme + '» → ' + (expect === null ? 'відкинуто' : expect),
       (got.theme || null) === expect, String(got.theme));
    /* …але НА ЕКРАНІ старий id мусить показатись чинним акцентом */
    if (expect && LEGACY[expect]) {
      ok('імпорт «' + theme + '»: на екрані вже ' + LEGACY[expect],
         got.attr === LEGACY[expect], String(got.attr));
    }
    ok('імпорт «' + theme + '»: решта профілю не постраждала', got.weight === 80, String(got.weight));
  }

  /* схема так само їде через імпорт */
  {
    const f = path.join(os.tmpdir(), 'scheme-light.json');
    fs.writeFileSync(f, JSON.stringify({ version: 7, birthDate: '1990-06-15', weight: 80, scheme: 'light' }));
    await q.evaluate((birth) => {
      try {
        localStorage.clear();
        localStorage.setItem('ib.profile', JSON.stringify({ version: 6, birthDate: birth }));
      } catch (_) {}
    }, '1990-06-15');
    await q.reload({ waitUntil: 'load' }); await q.waitForTimeout(700);
    await q.setInputFiles('#p-import-file', f);
    await q.waitForTimeout(1200);
    const got = await q.evaluate(async () => ({
      scheme: (await window.Store.getProfile()).scheme,
      attr: document.documentElement.getAttribute('data-scheme')
    }));
    ok('імпорт світлої схеми застосувався', got.scheme === 'light' && got.attr === 'light',
       JSON.stringify(got));
  }

  ok('імпорт без JS-помилок', e3.length === 0, e3.join(' | '));
  await c3.close();
}

ok('без JS-помилок', errs.length === 0, errs.join(' | '));

await b.close();
const bad = R.filter(r => !r[1]);
console.log('\n' + (R.length - bad.length) + '/' + R.length + ' перевірок оформлення пройшло.');
if (bad.length) { console.log('ПРОВАЛЕНО:\n' + bad.map(r => '  · ' + r[0]).join('\n')); process.exit(1); }
