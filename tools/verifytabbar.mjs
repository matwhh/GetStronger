/**
 * НИЖНЯ ПАНЕЛЬ РОЗДІЛІВ: скло, плашка, лінза — і головне, ПОСИЛАННЯ.
 *
 * Панель перероблена в плаваючу капсулу в стилі таб-бару iOS: скло,
 * плашка активного розділу, лінза, що їде за пальцем. Уся ця машинерія
 * накладена ПОВЕРХ звичайних <a href>, і найлегше зламати саме їх —
 * жест перехоплює вказівник, і посилання мовчки перестає вести куди
 * треба, лишаючись на вигляд справним.
 *
 * Саме це й сталось на першій збірці: setPointerCapture на панелі
 * перенаправляв pointerup у <nav>, тож клік браузер давав по <nav>, а не
 * по <a> — короткий дотик не переходив нікуди. Другим було рідне
 * перетягування посилання мишею: воно забирало жест і слало
 * pointercancel на першому ж русі, тож лінза гасла, а протяг не
 * завершувався. Обидві помилки безшумні, тому вони тут під наглядом.
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: CHROME });
const file = (n) => 'file://' + ROOT + '/' + n;
const page = (p) => p.url().split('/').pop().split('#')[0];

/* ---- 1. Структура й розміри на трьох ширинах ------------------------- */
for (const w of [320, 390, 430]) {
  const ctx = await adultContext(b, {
    viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(file('journal.html'), { waitUntil: 'load' });
  await p.waitForTimeout(2000);

  const m = await p.evaluate(() => {
    const zone = document.getElementById('tabbar');
    const bar = zone && zone.querySelector('.tabbar__bar');
    const items = [...(zone ? zone.querySelectorAll('.tabbar__item') : [])];
    const r = bar ? bar.getBoundingClientRect() : null;
    return {
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      items: items.length,
      links: items.filter((a) => a.tagName === 'A' && a.getAttribute('href')).length,
      minH: Math.min.apply(null, items.map((a) => a.getBoundingClientRect().height)),
      bottomGap: r ? Math.round(window.innerHeight - r.bottom) : null,
      sideGap: r ? Math.round(r.left) : null,
      /* Лінза мусить бути СУСІДОМ панелі: у панелі власний
         backdrop-filter, тобто вона backdrop root, і всередині лінзі не
         було б чого заломлювати. */
      lensIsSibling: !!zone.querySelector(':scope > .tabbar__lens'),
      lensInsideBar: !!bar.querySelector('.tabbar__lens'),
      pill: !!bar.querySelector('.tabbar__pill'),
      /* До першого дотику шарів скла НЕМАЄ навмисно: два з них несуть
         власний backdrop-filter, і висіти на кожній сторінці з першої
         секунди їм нема за що. Будуються вони на pointerdown. */
      layers: zone.querySelectorAll('.tabbar__lens > .lg-l').length,
      filters: document.querySelectorAll('svg filter[id^="lg-"]').length,
      /* Підпис не має обрізатись навіть на 320 px */
      clipped: items.filter((a) => {
        const l = a.querySelector('.tabbar__lbl');
        return l && l.scrollWidth > l.clientWidth + 1;
      }).length,
      draggable: items.filter((a) => a.getAttribute('draggable') === 'false').length
    };
  });

  ok(w + 'px: чотири розділи, і всі — посилання', m.items === 4 && m.links === 4,
     m.items + '/' + m.links);
  ok(w + 'px: ціль дотику ≥ 44px', m.minH >= 44, String(Math.round(m.minH)));
  ok(w + 'px: капсула пливе, а не приклеєна до краю',
     m.bottomGap >= 8 && m.bottomGap <= 40 && m.sideGap >= 10, 
     'низ ' + m.bottomGap + ', бік ' + m.sideGap);
  ok(w + 'px: сторінка не їде вбік', !m.overflow);
  ok(w + 'px: підписи вміщаються', m.clipped === 0, m.clipped + ' обрізаних');
  ok(w + 'px: плашка активного є', m.pill);
  ok(w + 'px: лінза — сусід панелі, не її дитина',
     m.lensIsSibling && !m.lensInsideBar, JSON.stringify([m.lensIsSibling, m.lensInsideBar]));
  ok(w + 'px: до дотику скла лінзи ще немає — воно не коштує нічого',
     m.layers === 0 && m.filters === 0, JSON.stringify([m.layers, m.filters]));
  ok(w + 'px: рідне перетягування посилань вимкнене', m.draggable === 4, String(m.draggable));
  ok(w + 'px: без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Жест: дотик веде по посиланню, протяг — у найближчий -------- */
{
  const ctx = await adultContext(b, {
    viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));

  /* 2а. Короткий дотик — це просто клік по <a>. Саме він ламався
     захопленням вказівника: pointerup прилітав у <nav>, і клік ішов
     туди ж. */
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  await p.locator('#tabbar a[href="meals.html"]').click();
  await p.waitForTimeout(1300);
  ok('2. короткий дотик відкриває розділ', page(p) === 'meals.html', page(p));

  /* 2б. Протяг: лінза їде за пальцем і на відпусканні веде в найближчий
     розділ. Саме тут pointercancel від рідного перетягування <a> гасив
     лінзу на першому ж русі. */
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  const from = await p.locator('#tabbar a[href="index.html"]').boundingBox();
  const to = await p.locator('#tabbar a[href="journal.html"]').boundingBox();
  const y = from.y + from.height / 2;
  await p.mouse.move(from.x + from.width / 2, y);
  await p.mouse.down();
  await p.waitForTimeout(60);
  const opened = await p.evaluate(() =>
    document.querySelector('.tabbar__lens').classList.contains('is-open'));
  ok('2. натискання відкриває лінзу', opened);

  for (let i = 1; i <= 10; i++) {
    await p.mouse.move(from.x + from.width / 2 + (to.x - from.x) * i / 10, y);
    await p.waitForTimeout(25);
  }
  const mid = await p.evaluate(() => {
    const l = document.querySelector('.tabbar__lens');
    return {
      open: l.classList.contains('is-open'),
      moved: /translate3d\(([\d.]+)px/.test(l.style.transform) &&
             parseFloat(l.style.transform.match(/translate3d\(([-\d.]+)px/)[1]) > 100,
      lit: [...document.querySelectorAll('.tabbar__item.is-lit')]
             .map((a) => a.querySelector('.tabbar__lbl').textContent).join(',')
    };
  });
  ok('2. лінза їде за пальцем і не гасне', mid.open && mid.moved, JSON.stringify(mid));
  ok('2. пункт під лінзою підсвічується', mid.lit === 'Прогрес', mid.lit);

  await p.mouse.up();
  await p.waitForTimeout(1400);
  ok('2. протяг веде в найближчий розділ', page(p) === 'journal.html', page(p));
  ok('2. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2б. ПАЛЬЦЕМ, а не мишею ------------------------------------------
 * Миша й дотик ідуть різними шляхами, і саме дотиковий ламався
 * невидимо для всіх попередніх перевірок.
 *
 * У дотику браузер дає НЕЯВНЕ захоплення вказівника: усі події пальця
 * йдуть у той елемент, на якому сталось торкання, тобто в <a>. Коли жест
 * визнається протягом і ми беремо захоплення собі, <a> своє втрачає —
 * і lostpointercapture СПЛИВАЄ на панель, де обробник глушив рівно той
 * жест, який щойно почався. Лінза стрибала на один крок і поверталась,
 * протяг не працював. На миші неявного захоплення немає, тому там усе
 * виглядало справним.
 *
 * Друге, що тут міряється, — що лінза йде за пальцем 1:1, а не
 * наздоганяє його CSS-переходом. Перехід під час протягу означає, що
 * скло їде позаду пальця; на телефоні це читається як гальмо.
 */
{
  const ctx = await adultContext(b, {
    viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1800);

  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type: type, touchPoints: type === 'touchEnd' ? [] : [{ x: x, y: y, id: 1 }]
  });

  const from = await p.locator('#tabbar a[href="index.html"]').boundingBox();
  const to = await p.locator('#tabbar a[href="meals.html"]').boundingBox();
  const y = from.y + from.height / 2;

  await touch('touchStart', from.x + from.width / 2, y);
  await p.waitForTimeout(60);
  const lensX = () => p.evaluate(() => {
    const l = document.querySelector('.tabbar__lens');
    const m = /translate3d\((-?[\d.]+)px/.exec(l.style.transform);
    return { x: m ? Math.round(+m[1]) : null, open: l.classList.contains('is-open'),
             tr: l.style.transition };
  });
  ok('2б. дотик відкриває лінзу', (await lensX()).open);
  /* І САМЕ ДОТИК будує скло: до нього шарів немає, після — шість. */
  const built = await p.evaluate(() => ({
    layers: document.querySelectorAll('.tabbar__lens > .lg-l').length,
    filters: document.querySelectorAll('svg filter[id^="lg-"]').length
  }));
  ok('2б. дотик будує шість шарів матеріалу й фільтр',
     built.layers === 6 && built.filters === 1, JSON.stringify(built));

  const track = [];
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', from.x + from.width / 2 + (to.x - from.x) * i / 10, y);
    await p.waitForTimeout(28);
    track.push((await lensX()).x);
  }
  /* Слід має РОСТИ монотонно. Якщо жест глушиться, лінза повертається на
     початкову позицію й далі стоїть — саме це й було. */
  const grows = track.every((v, i) => i === 0 || v >= track[i - 1]);
  ok('2б. лінза їде за пальцем, а не зривається на першому русі',
     grows && track[track.length - 1] - track[0] > 100, JSON.stringify(track));
  ok('2б. під пальцем переходу немає — рух 1:1',
     (await lensX()).tr === 'none', (await lensX()).tr);

  await touch('touchEnd', 0, 0);
  await p.waitForTimeout(1400);
  ok('2б. пальцем протяг доводить до розділу', page(p) === 'meals.html', page(p));
  ok('2б. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Панель працює і без скла ------------------------------------ */
/*
 * Оптика вантажиться окремими файлами вже після рендера. Якщо вони не
 * доїхали (офлайн у першу мить, помилка мережі), панель мусить лишитись
 * НАВІГАЦІЄЮ: капсула, підписи, активний розділ, робочі посилання.
 * Зникнути має тільки лінза.
 */
{
  const ctx = await adultContext(b, {
    viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true
  });
  await ctx.route(/liquid-glass\.js|tabbar-glass\.js/, (r) => r.abort());
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1600);
  const m = await p.evaluate(() => {
    const zone = document.getElementById('tabbar');
    const bar = zone.querySelector('.tabbar__bar');
    return {
      items: zone.querySelectorAll('.tabbar__item').length,
      active: !!zone.querySelector('.tabbar__item.is-active'),
      lens: !!zone.querySelector('.tabbar__lens'),
      radius: getComputedStyle(bar).borderTopLeftRadius,
      visible: bar.getBoundingClientRect().height > 40
    };
  });
  ok('3. без скла панель лишається навігацією',
     m.items === 4 && m.active && m.visible && parseFloat(m.radius) > 20, JSON.stringify(m));
  ok('3. без скла лінзи просто немає', !m.lens);
  await p.locator('#tabbar a[href="workout.html"]').click();
  await p.waitForTimeout(1300);
  ok('3. і посилання все одно працюють', page(p) === 'workout.html', page(p));
  ok('3. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. На десктопі панелі немає -------------------------------------- */
{
  const ctx = await adultContext(b, { viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(file('index.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const m = await p.evaluate(() => {
    const zone = document.getElementById('tabbar');
    return {
      display: zone ? getComputedStyle(zone).display : 'немає',
      /* Оптика не мусить навіть вантажитись там, де панелі не видно. */
      glass: !!window.LiquidGlass,
      scripts: [...document.querySelectorAll('script[src*="glass"]')].length
    };
  });
  ok('4. на десктопі панель схована', m.display === 'none', m.display);
  ok('4. і скло навіть не вантажиться', !m.glass && m.scripts === 0, JSON.stringify(m));
  await ctx.close();
}

/* ---- 5. Скло справді розмиває фон ------------------------------------ */
/*
 * Не «властивість присутня в CSS», а «фон під панеллю справді став
 * розмитим». Різниця принципова: backdrop-filter легко зробити мертвим,
 * не змінивши жодного оголошення — досить, щоб предок став backdrop root
 * (filter, opacity, isolation, contain на будь-якому з батьків). Панель
 * при цьому лишається на вигляд такою самою, просто скло перестає бути
 * склом, і побачити це можна тільки очима.
 *
 * Знімок читається назад через canvas у самій сторінці: PNG декодує
 * браузер, тож жодних залежностей для цього не треба.
 *
 * ОКРЕМО ПРО РАДІУС. Виміряно, що в програмному растеризаторі Chromium
 * блюр більший за ~10px тихо деградує: нормована різкість фону 0,25 при
 * 6px, 0,43 при 10px і 0,70 при 20px — тобто «сильніший» блюр дає МЕНШЕ
 * розмиття. Тому в CSS стоїть виміряне з референсу значення 6px, а ця
 * перевірка не дасть підняти його «щоб було мутніше», не помітивши, що
 * стало чіткіше.
 */
{
  const ctx = await adultContext(b, {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true
  });
  const p = await ctx.newPage();
  await p.goto(file('journal.html'), { waitUntil: 'load' });
  await p.waitForTimeout(1800);
  await p.evaluate(() => window.scrollTo(0, 320));
  /* Ховаємо власний вміст панелі: різкі підписи й іконки перебивали б
     вимір самого фону. */
  await p.evaluate(() => {
    document.querySelectorAll('.tabbar__item, .tabbar__pill, .tabbar__lens')
      .forEach((e) => { e.style.visibility = 'hidden'; });
  });
  await p.waitForTimeout(400);

  const box = await p.evaluate(() => {
    const r = document.querySelector('.tabbar__bar').getBoundingClientRect();
    return { x: Math.round(r.x) + 6, y: Math.round(r.y) + 6,
             width: Math.round(r.width) - 12, height: Math.round(r.height) - 12 };
  });

  /* Нормована різкість: середній модуль градієнта, поділений на розкид
     яскравості. Ділення обовʼязкове — панель ще й притемнює фон, а без
     нормування падіння контрасту читалося б як розмиття. */
  const sharpness = async () => {
    const png = (await p.screenshot({ clip: box })).toString('base64');
    return await p.evaluate(function (data) {
      return new Promise(function (res) {
        const img = new Image();
        img.onload = function () {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          const lum = new Float64Array(c.width * c.height);
          for (let i = 0; i < lum.length; i++) {
            lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
          }
          let sum = 0, sq = 0, n = 0;
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width - 1; x++) {
              const dx = lum[y * c.width + x + 1] - lum[y * c.width + x];
              sq += dx * dx; n++;
            }
          }
          for (let i = 0; i < lum.length; i++) sum += lum[i];
          const mean = sum / lum.length;
          let varr = 0;
          for (let i = 0; i < lum.length; i++) varr += (lum[i] - mean) * (lum[i] - mean);
          const sd = Math.sqrt(varr / lum.length) || 1e-6;
          res(Math.sqrt(sq / n) / sd);
        };
        img.src = 'data:image/png;base64,' + data;
      });
    }, png);
  };

  const withGlass = await sharpness();
  await p.evaluate(() => {
    const bar = document.querySelector('.tabbar__bar');
    bar.style.backdropFilter = 'none';
    bar.style.webkitBackdropFilter = 'none';
  });
  await p.waitForTimeout(350);
  const without = await sharpness();

  ok('5. фон під панеллю справді розмитий',
     withGlass < without * 0.6,
     'зі склом ' + withGlass.toFixed(3) + ' проти ' + without.toFixed(3) + ' без нього');

  const blur = await p.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById('tabbar')).getPropertyValue('--tb-blur')));
  ok('5. радіус блюру в перевіреному діапазоні', blur > 0 && blur <= 10, blur + 'px');
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок панелі розділів пройшло.');
process.exit(bad ? 1 : 0);
