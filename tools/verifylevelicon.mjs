/**
 * ЖЕТОН РІВНЯ (levelIcon() у js/app.js + блок «ЖЕТОН РІВНЯ» у style.css).
 *
 * Жетон стоїть у шапці на кожній сторінці, тобто це найчастіше видимий
 * малюнок сайту. Раніше він лежав десятьма файлами icons/levels/lvl-N.svg
 * і не мав перевірок узагалі — саме тому десять майже однакових малюнків
 * встигли розійтися між собою.
 *
 * ЩО ТУТ СТЕРЕЖЕТЬСЯ І ЧОМУ САМЕ ЦЕ:
 *
 * 1. СКЛО СПРАВЖНЄ. Жетон мусить розмивати те, що під ним, а не
 *    вдавати розмиття градієнтом. Стовп розмиття обрізається
 *    border-radius: 50%, тому він мусить точно збігатися з тілом,
 *    намальованим у SVG (r = 50): менший радіус лишав би по краю кільце
 *    розмиття без скла над ним.
 *
 * 2. РІВНІСТЬ. Найдорожча помилка цього жетона: скло було зібране
 *    всередині SVG градієнтами, кант і внутрішній обід світилися на
 *    різних половинах кола — і диск виглядав кривим, хоча жодне число в
 *    розмітці не було помилковим. Тому тут не читання атрибутів, а
 *    ВИМІР: elementFromPoint іде горизонталлю через центр і питає в
 *    браузера, що саме намальоване в кожній точці.
 *
 * 3. ГЕОМЕТРІЯ ШКАЛИ. Розрив унизу приблизно на пʼяту частину кола;
 *    заповнення пропорційне рівню; десятий рівень заповнює шкалу цілком.
 *
 * 4. ІДЕНТИФІКАТОРИ ГРАДІЄНТІВ РІЗНІ. Два жетони на одній сторінці —
 *    звичайна річ. Однакові id означали б, що другий бере градієнти
 *    першого.
 *
 * 5. ПОВЕДІНКА. Під КУРСОРОМ кулька нахиляється до нього й трохи росте.
 *    На дотику жетон статичний — так просив власник, і так правильно:
 *    :hover на дотику залипає після тапу.
 *
 * 6. МЕЖІ РІВНЯ. 0, 11, «сміття» не мають малювати порожню або
 *    переповнену шкалу.
 */
import { chromium } from 'playwright';
import { CHROME, ROOT } from './pw.mjs';

const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 640, height: 480 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto('file://' + ROOT + '/index.html');
await p.waitForTimeout(500);

const hasApi = await p.evaluate(() => !!(window.App && window.App.levelIcon));
ok('0. App.levelIcon доступний', hasApi);
if (!hasApi) { await b.close(); process.exit(1); }

/* Стенд: десять жетонів у своїх справжніх оправах (.lvl-circle) плюс одна
   скляна картка поруч — саме з нею звіряється матеріал. */
await p.evaluate(() => {
  const cells = [];
  for (let i = 1; i <= 10; i++) {
    cells.push('<span class="lvl-circle" data-lvl="' + i + '" style="width:200px;height:200px">'
      + window.App.levelIcon(i, 'Level ' + i) + '</span>');
  }
  document.body.innerHTML = '<div id="stand">' + cells.join('') + '</div>';
  document.body.style.background = '#0b0b0b';
  document.querySelectorAll('#stand .lvl-ico')
    .forEach((s) => { s.style.width = '100%'; s.style.height = '100%'; s.style.display = 'block'; });
});
await p.waitForTimeout(300);

/* ------------------------------------------------------------------ */
/* 1. Скло справжнє                                                    */
/* ------------------------------------------------------------------ */
const glass = await p.evaluate(() => {
  const c = document.querySelector('#stand .lvl-circle');
  const s = c.querySelector('.lvl-ico');
  const cs = getComputedStyle(s);
  return {
    bd: cs.backdropFilter || cs.webkitBackdropFilter,
    radius: cs.borderRadius,
    bodyR: c.querySelector('.lvl-ico__body').getAttribute('r')
  };
});
ok('1. жетон розмиває те, що під ним', /blur\(/.test(glass.bd || ''), glass.bd);
ok('1. розмиття обрізане колом', /50%/.test(glass.radius), glass.radius);
ok('1. намальоване тіло збігається зі стовпом розмиття (r=50)',
   glass.bodyR === '50', JSON.stringify(glass));

/* Відтінки живуть у CSS, а не в презентаційних атрибутах: var() там
   підтримується не скрізь і падає мовчки — прозорим. */
const stops = await p.evaluate(() => {
  const c = document.querySelector('#stand .lvl-circle');
  const get = (k) => getComputedStyle(c.querySelector('.lvl-ico__' + k)).stopColor;
  return { b0: get('b0'), b1: get('b1') };
});
const alpha = (v) => { const m = String(v).match(/[\d.]+/g) || []; return m.length > 3 ? Number(m[3]) : 1; };
ok('1. зупинки градієнтів обчислюються з CSS (var() спрацював)',
   Object.values(stops).every((v) => alpha(v) > 0), JSON.stringify(stops));
ok('1. тіло світліше згори, ніж унизу', alpha(stops.b0) > alpha(stops.b1),
   stops.b0 + ' / ' + stops.b1);
/* Полиску немає навмисно: радіальна пляма на кульці 39px читалась як
   засвіт по всьому склу, а не як відблиск. Чисте скельце має край. */
ok('1. полиску всередині немає',
   await p.evaluate(() => !document.querySelector('#stand .lvl-ico__gloss')));
ok('1. тіло майже прозоре — це скло, а не сіра пляма',
   alpha(stops.b0) <= 0.12, stops.b0);

/* ------------------------------------------------------------------ */
/* 2. Геометрія шкали                                                  */
/* ------------------------------------------------------------------ */
const geo = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('#stand .lvl-circle').forEach((cell) => {
    const g = cell.querySelector('g[transform]');
    const tr = cell.querySelector('.lvl-ico__track');
    const fl = cell.querySelector('.lvl-ico__fill');
    const num = (el) => el.getAttribute('stroke-dasharray').split(' ').map(Number);
    const cs = (el) => getComputedStyle(el);
    out.push({
      lvl: Number(cell.dataset.lvl),
      rot: g.getAttribute('transform'),
      r: Number(tr.getAttribute('r')),
      track: num(tr)[0],
      fill: num(fl)[0],
      total: num(tr)[0] + num(tr)[1],
      wTrack: parseFloat(cs(tr).strokeWidth),
      wFill: parseFloat(cs(fl).strokeWidth),
      capTrack: cs(tr).strokeLinecap,
      capFill: cs(fl).strokeLinecap,
      text: cell.querySelector('.lvl-ico__n').textContent,
      fs: parseFloat(cs(cell.querySelector('.lvl-ico__n')).fontSize),
      tone: cs(fl).stroke,
      inkTone: cs(cell.querySelector('.lvl-ico__n')).fill,
      arcs: cell.querySelectorAll('circle[stroke-dasharray]').length,
      rings: [...cell.querySelectorAll('circle:not([stroke-dasharray])')]
        .filter((c) => getComputedStyle(c).stroke !== 'none').length
    });
  });
  return out;
});

const C = 2 * Math.PI * geo[0].r;
ok('2. коло замкнене (сума штрих+пробіл = довжина кола)',
   geo.every((g) => Math.abs(g.total - C) < 0.05), geo[0].total.toFixed(2) + ' проти ' + C.toFixed(2));
const arcDeg = geo[0].track / C * 360;
ok('2. розрив унизу ≈ пʼята частина кола', Math.abs(arcDeg - 288) < 0.5, arcDeg.toFixed(1) + '°');
ok('2. шкала повернута на 126° (нуль на лівому краю розриву)',
   geo.every((g) => g.rot === 'rotate(126 50 50)'), geo[0].rot);
ok('2. заповнення пропорційне рівню',
   geo.every((g) => Math.abs(g.fill / g.track - g.lvl / 10) < 0.005),
   geo.map((g) => (g.fill / g.track).toFixed(2)).join(' '));
ok('2. десятий рівень заповнює шкалу цілком',
   Math.abs(geo[9].fill - geo[9].track) < 0.05, geo[9].fill.toFixed(2) + ' / ' + geo[9].track.toFixed(2));
ok('2. перший рівень уже має видимий сегмент (не нуль)',
   geo[0].fill > C * 0.02, geo[0].fill.toFixed(2));
/* Дуг рівно дві: шкала й заповнення. Третя — це ореол під пройденою
   частиною, через який видима смуга зліва ставала товща за смугу
   справа. */
ok('2. дуг у малюнку рівно дві', geo.every((g) => g.arcs === 2), String(geo[0].arcs));
/* Канта в МАЛЮНКУ немає взагалі — його малює CSS багатошаровим inset
   box-shadow по border-radius:50%. Дуга-кант залежала від градієнта й
   світилася на різних половинах кола по-різному; коло, задане
   радіусом, рівне завжди. */
ok('2. канта в малюнку немає — його малює CSS', geo.every((g) => g.rings === 0), String(geo[0].rings));
ok('2. край скла зібраний із багатьох шарів, а не з однієї лінії',
   await p.evaluate(() => {
     const sh = getComputedStyle(document.querySelector('#stand .lvl-ico')).boxShadow;
     return (sh.match(/inset/g) || []).length >= 5;
   }));
/*
 * БОКОВА ГРАНЬ — це зсуви БЕЗ РОЗМИТТЯ. Різниця не косметична: розмитий
 * шар читається як тінь на поверхні, чіткий — як торець самого предмета.
 * Досить комусь додати сюди blur «щоб мʼякше», і грань зникне, а жоден
 * інший тест цього не помітить.
 */
const facet = await p.evaluate(() => {
  const sh = getComputedStyle(document.querySelector('#stand .lvl-ico')).boxShadow;
  /* Кожен шар: "<колір> <x> <y> <blur> <spread>", inset — окремим словом.
     Ділимо по комах ПОЗА дужками: усередині rgba() коми теж є. */
  const layers = [];
  let depth = 0, buf = '';
  for (const ch of sh) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { layers.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) layers.push(buf.trim());
  /*
   * Грань — зовнішній шар зі зсувом УНИЗ і НУЛЬОВИМ розмиттям.
   *
   * Колір знімається перед розбором навмисно: у rgba() свої числа, і
   * регулярка по сирому рядку ловила «0px 0px 8px» як зсув по x —
   * шар-ореол зараховувався в грань, і перевірка показувала 6 замість 4.
   */
  const nums = (l) => (l.replace(/rgba?\([^)]*\)/g, '')
    .match(/-?[\d.]+px/g) || []).map(parseFloat);
  const hard = layers.filter((l) => {
    if (/inset/.test(l)) return false;
    const n = nums(l);                 // [x, y, blur, spread]
    return n.length >= 3 && n[1] > 0 && n[2] === 0;
  });
  return { total: layers.length, hard: hard.length, sample: hard[0] || '' };
});
ok('2. бокова грань є і вона НЕ розмита', facet.hard >= 3, JSON.stringify(facet));
ok('2. шкала не торкається канта',
   geo[0].r + geo[0].wTrack / 2 <= 46, String(geo[0].r + geo[0].wTrack / 2));

/* ------------------------------------------------------------------ */
/* 3. Рівність — вимір, а не довіра до атрибутів                       */
/* ------------------------------------------------------------------ */
ok('3. пройдена й непройдена частини однакової товщини',
   geo.every((g) => Math.abs(g.wTrack - g.wFill) < 0.01),
   geo[0].wTrack + ' проти ' + geo[0].wFill);
ok('3. обидві частини на однаковому радіусі',
   await p.evaluate(() => [...document.querySelectorAll('#stand .lvl-circle')].every((c) =>
     c.querySelector('.lvl-ico__track').getAttribute('r') ===
     c.querySelector('.lvl-ico__fill').getAttribute('r'))));
ok('3. кінці круглі в обох', geo.every((g) => g.capTrack === 'round' && g.capFill === 'round'),
   geo[0].capTrack + '/' + geo[0].capFill);

const band = await p.evaluate(() => {
  /* Окремий стенд з ОДНИМ жетоном угорі сторінки: elementFromPoint
     працює в координатах вікна й за його межами повертає самі null —
     на стосі з десяти жетонів перевірка мовчки міряла б порожнечу. */
  const probe = document.createElement('span');
  probe.className = 'lvl-circle';
  probe.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:200px;z-index:9';
  probe.innerHTML = window.App.levelIcon(5, 'x');
  const svg = probe.firstChild;
  svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block';
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  /*
   * Міряємо ВСЕ, що намальоване дугою (будь-яке коло зі stroke-dasharray),
   * а не конкретний клас. Саме в цьому був сенс скарги: під пройденою
   * частиною лежав ширший напівпрозорий ореол, тому видима смуга зліва
   * була товща за смугу справа. Перевірка на клас .lvl-ico__fill цього
   * НЕ бачила — у самої дуги ширина була та сама.
   */
  const scan = (sign) => {
    let inner = null, outer = null, cls = '';
    for (let d = 0; d <= r.width / 2; d += 0.25) {
      const el = document.elementFromPoint(cx + sign * d, cy);
      if (!el || el.tagName !== 'circle' || !el.hasAttribute('stroke-dasharray')) continue;
      if (inner === null) inner = d;
      outer = d;
      if (cls.indexOf(el.getAttribute('class')) < 0) cls += el.getAttribute('class') + ' ';
    }
    return { inner, outer, cls: cls.trim() };
  };
  /* Рівень 5 — заповнення вкриває 144° від 126°, тобто проходить через
     180° (ліва горизонталь); непройдена частина проходить через 0°. */
  const out = { left: scan(-1), right: scan(1), w: r.width };
  probe.remove();
  return out;
});
const okBand = band.left.inner !== null && band.right.inner !== null;
ok('3. обидві половини шкали намальовані', okBand, JSON.stringify(band));
ok('3. зліва саме заповнення, справа саме шкала',
   okBand && band.left.cls === 'lvl-ico__fill' && band.right.cls === 'lvl-ico__track',
   okBand ? band.left.cls + ' | ' + band.right.cls : '—');
ok('3. ЗОВНІШНЯ межа шкали однакова зліва й справа',
   okBand && Math.abs(band.left.outer - band.right.outer) <= 1,
   okBand ? band.left.outer + 'px проти ' + band.right.outer + 'px' : '—');
ok('3. ВНУТРІШНЯ межа шкали однакова зліва й справа',
   okBand && Math.abs(band.left.inner - band.right.inner) <= 1,
   okBand ? band.left.inner + 'px проти ' + band.right.inner + 'px' : '—');

/* ------------------------------------------------------------------ */
/* 4. Колір                                                            */
/* ------------------------------------------------------------------ */
const rgba = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
const opaque = (s) => { const v = rgba(s); return v.length >= 3 && (v.length < 4 || v[3] > 0.5); };

ok('4. тон шкали заданий і непрозорий', geo.every((g) => opaque(g.tone)), geo[0].tone);
/*
 * ЦИФРА БІЛА НА БУДЬ-ЯКОМУ РІВНІ, І ЦЕ ВИМІР, А НЕ СМАК.
 *
 * Тіло скла світле — інакше жетон читається як чорна дірка, а не як
 * мутне скло. Але на світлішому диску кольори рівнів дають від 2,9:1
 * (червоний) до 5,3:1 (бурштин): цифра то читалась би, то ні, залежно
 * від рівня. Тому колір лишається на ДУЗІ (графіка, поріг 3:1), а
 * цифра — біла (9:1 на будь-якому рівні). Тут рахується справжній
 * контраст на справжньому кольорі диска, а не звіряються назви змінних.
 */
const contrast = await p.evaluate(() => {
  const lum = (c) => {
    const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const num = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
  /* Колір диска в його СЕРЕДИНІ: саме там лежить цифра. */
  const stop = (k) => num(getComputedStyle(document.querySelector('.lvl-ico__' + k)).stopColor);
  const b0 = stop('b0'), b1 = stop('b1');
  const mid = ((b0[3] || 1) + (b1[3] || 1)) / 2;
  const out = [];
  document.querySelectorAll('#stand .lvl-circle').forEach((cell) => {
    const page = num(getComputedStyle(document.body).backgroundColor).slice(0, 3);
    const disc = [0, 1, 2].map((i) => mid * 255 + (1 - mid) * page[i]);
    const ink = num(getComputedStyle(cell.querySelector('.lvl-ico__n')).fill).slice(0, 3);
    const arc = num(getComputedStyle(cell.querySelector('.lvl-ico__fill')).stroke).slice(0, 3);
    const r = (a, b) => { const l1 = Math.max(lum(a), lum(b)), l2 = Math.min(lum(a), lum(b)); return (l1 + 0.05) / (l2 + 0.05); };
    out.push({ lvl: Number(cell.dataset.lvl), ink: r(ink, disc), arc: r(arc, disc) });
  });
  return out;
});
ok('4. цифра читається на КОЖНОМУ рівні (≥ 4.5:1)',
   contrast.every((c) => c.ink >= 4.5),
   contrast.map((c) => c.lvl + ':' + c.ink.toFixed(1)).join(' '));
ok('4. дуга видима на КОЖНОМУ рівні (≥ 3:1, поріг для графіки)',
   contrast.every((c) => c.arc >= 3),
   contrast.map((c) => c.lvl + ':' + c.arc.toFixed(1)).join(' '));
ok('4. цифра однакова на всіх рівнях — колір несе дуга',
   new Set(geo.map((g) => g.inkTone)).size === 1, geo[0].inkTone);

/* Пʼять сходинок: 1 | 2–3 | 4–7 | 8–9 | 10. */
const tones = geo.map((g) => g.tone);
const steps = tones.filter((t, i) => i === 0 || t !== tones[i - 1]).length;
ok('4. рівно пʼять сходинок кольору на десять рівнів', steps === 5, String(steps));
ok('4. колір міняється саме на 2, 4, 8 і 10',
   tones[0] !== tones[1] && tones[1] === tones[2] && tones[2] !== tones[3] &&
   tones[3] === tones[6] && tones[6] !== tones[7] && tones[7] === tones[8] && tones[8] !== tones[9],
   tones.join(' | '));

/* ------------------------------------------------------------------ */
/* 5. Ідентифікатори градієнтів                                        */
/* ------------------------------------------------------------------ */
const ids = await p.evaluate(() => [...document.querySelectorAll('#stand [id]')].map((n) => n.id));
ok('5. усі ідентифікатори градієнтів різні',
   new Set(ids).size === ids.length, ids.length + ' штук, унікальних ' + new Set(ids).size);
ok('5. кожне посилання url(#…) знаходить свій вузол',
   await p.evaluate(() => [...document.querySelectorAll('#stand [fill^="url("], #stand [stroke^="url("]')]
     .every((n) => {
       const a = (n.getAttribute('fill') || '') + (n.getAttribute('stroke') || '');
       const id = (a.match(/url\(#([^)]+)\)/) || [])[1];
       return id && document.getElementById(id);
     })));

/* ------------------------------------------------------------------ */
/* 6. Поведінка: світло під вказівником                                */
/* ------------------------------------------------------------------ */
const hot = await p.evaluate(async () => {
  const cell = document.querySelector('#stand .lvl-circle');
  cell.scrollIntoView({ block: 'center' });
  const r = cell.getBoundingClientRect();
  const fire = (x, y) => document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: x, clientY: y, bubbles: true, composed: true
  }));
  /* Подія має «влучити» в жетон: слухач шукає ціль через closest(). */
  const target = document.elementFromPoint(r.left + r.width * 0.25, r.top + r.height * 0.25);
  if (!target) return { skip: 'поза екраном' };
  target.dispatchEvent(new PointerEvent('pointermove', {
    clientX: r.left + r.width * 0.25, clientY: r.top + r.height * 0.25,
    bubbles: true, composed: true
  }));
  /* Перехід масштабу — 0.28s. Два кадри ловлять його на самому початку
     (1.007), і поріг «виріс» падав через раз. Чекаємо, доки скінчиться. */
  await new Promise((res) => setTimeout(res, 400));
  const on = cell.classList.contains('is-hot');
  const rx = cell.style.getPropertyValue('--lvl-rx');
  const ry = cell.style.getPropertyValue('--lvl-ry');
  const tr = getComputedStyle(cell.querySelector('.lvl-ico')).transform;
  const m = (tr.match(/matrix3?d?\(([\d.]+)/) || [])[1];
  /* Курсор іде геть — усе мусить повернутись. */
  fire(0, 0);
  await new Promise((res) => requestAnimationFrame(res));
  return { on, rx, ry, tr, grew: Number(m) > 1.01, off: !cell.classList.contains('is-hot') };
});
ok('6. під курсором жетон оживає', hot.on === true, JSON.stringify(hot));
/* Курсор у лівій верхній чверті: кулька мусить нахилитись ВЕРХОМ ДО
   нього — rotateX додатний, rotateY відʼємний. Знак важливіший за
   величину: переплутані осі дають нахил у протилежний бік, і на око це
   помітно не одразу. */
ok('6. нахил спрямований на курсор',
   parseFloat(hot.rx) > 1 && parseFloat(hot.ry) < -1, hot.rx + ' / ' + hot.ry);
ok('6. під курсором кулька росте', hot.grew === true, hot.tr);
ok('6. поза жетоном усе повертається', hot.off === true, String(hot.off));

/*
 * НА ДОТИКУ ЖЕТОН СТАТИЧНИЙ — так просив власник, і так правильно:
 * :hover на дотику залипає після тапу, тобто жетон лишався б
 * підсвіченим доти, доки не торкнешся іншого місця. Скло при цьому
 * НЕ вимикається: воно не потребує курсора, воно потребує світла позаду
 * (та сама помилка колись стояла в перевірці скляних карток).
 */
{
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const q = await m.newPage();
  await q.goto('file://' + ROOT + '/index.html');
  await q.waitForTimeout(600);
  const st = await q.evaluate(() => {
    const cell = document.createElement('span');
    cell.className = 'lvl-circle';
    cell.style.cssText = 'width:120px;height:120px';
    cell.innerHTML = window.App.levelIcon(7, 'x');
    document.body.appendChild(cell);
    cell.classList.add('is-hot');          /* навіть якщо клас якось поставлять */
    const ico = getComputedStyle(cell.querySelector('.lvl-ico'));
    return {
      hoverMedia: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
      tr: ico.transform,
      bd: ico.backdropFilter || ico.webkitBackdropFilter
    };
  });
  ok('6. контекст справді без курсора', st.hoverMedia === false, String(st.hoverMedia));
  ok('6. на дотику кулька не рухається', st.tr === 'none', st.tr);
  ok('6. на дотику скло лишається', /blur\(/.test(String(st.bd)), String(st.bd));
  await m.close();
}

/* ------------------------------------------------------------------ */
/* 7. Число                                                            */
/* ------------------------------------------------------------------ */
ok('7. у центрі стоїть номер рівня',
   geo.every((g) => g.text === String(g.lvl)), geo.map((g) => g.text).join(','));
ok('7. двозначний рівень має менший кегль', geo[9].fs < geo[8].fs, geo[9].fs + ' проти ' + geo[8].fs);
const inner = 2 * (geo[0].r - geo[0].wTrack / 2);
const fits = await p.evaluate(() => {
  const t = document.querySelector('#stand .lvl-circle[data-lvl="10"] .lvl-ico__n');
  const bb = t.getBBox();
  return { w: bb.width, h: bb.height };
});
ok('7. «10» вміщується у внутрішній діаметр шкали',
   fits.w < inner && fits.h < inner, JSON.stringify(fits) + ' при діаметрі ' + inner);

/* ------------------------------------------------------------------ */
/* 8. Межі рівня                                                       */
/* ------------------------------------------------------------------ */
const edge = await p.evaluate(() => {
  const read = (v) => {
    const d = document.createElement('div');
    d.innerHTML = window.App.levelIcon(v, 'x');
    const s = d.firstChild;
    const f = s.querySelector('.lvl-ico__fill').getAttribute('stroke-dasharray').split(' ')[0];
    return { cls: s.getAttribute('class'), n: s.querySelector('.lvl-ico__n').textContent, fill: Number(f) };
  };
  return { zero: read(0), neg: read(-3), over: read(11), junk: read('ой'), half: read(4.5) };
});
ok('8. рівень 0 стає першим', edge.zero.n === '1' && /is-l1\b/.test(edge.zero.cls), JSON.stringify(edge.zero));
ok('8. відʼємний рівень стає першим', edge.neg.n === '1', edge.neg.n);
ok('8. рівень 11 стає десятим', edge.over.n === '10' && /is-l10\b/.test(edge.over.cls), JSON.stringify(edge.over));
ok('8. не-число стає першим', edge.junk.n === '1', edge.junk.n);
ok('8. дробовий рівень округлюється', edge.half.n === '5' || edge.half.n === '4', edge.half.n);
ok('8. двозначний рівень позначений is-wide', /is-wide/.test(edge.over.cls), edge.over.cls);
ok('8. однозначний — без is-wide', !/is-wide/.test(edge.zero.cls), edge.zero.cls);

/* ------------------------------------------------------------------ */
/* 9. Дрібниці, які легко втратити                                     */
/* ------------------------------------------------------------------ */
ok('9. жетон малюється розміткою, а не <img>',
   await p.evaluate(() => !document.querySelector('#stand img')));
ok('9. доступність: жетон має роль і підпис',
   await p.evaluate(() => {
     const s = document.querySelector('#stand .lvl-ico');
     return s.getAttribute('role') === 'img' && !!s.getAttribute('aria-label');
   }));
ok('9. без JS-помилок', errs.length === 0, errs.join(' | '));

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок жетона рівня пройшло.');
process.exit(bad ? 1 : 0);
