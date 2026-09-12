/**
 * ШКАЛА РІВНЯ НА СТОРІНЦІ РЕЙТИНГУ — реальний браузер.
 *
 * Була просто смуга з відсотком і рядок чисел під нею. Стало: жетон
 * поточного рівня ліворуч, наступного — праворуч, між ними заливка, під
 * нею «стільки з стількох» і «ще стільки до Level N», а в шапці —
 * приріст ЗА ТИЖДЕНЬ замість «сьогодні».
 *
 * Юніти стережуть арифметику (EloCore.levelFor, EloCore.sumFrom). Тут —
 * те, чого вони не бачать:
 *   • обидва кінці шкали справді намальовані й показують РІЗНІ рівні;
 *   • заливка відповідає відсотку рівня, а не ELO і не випадковому числу;
 *   • на десятому рівні праворуч стоїть стеля, а не неіснуючий Level 11;
 *   • тижневе число рахується з понеділка включно.
 *
 * СЕРВЕР ПІДРОБЛЕНИЙ. Сторінка рейтингу без акаунта показує замок, тож
 * window.Store перехоплюється в момент присвоєння (той самий прийом, що
 * в tools/adult.mjs для APP_CONFIG) і віддає заздалегідь відомий стан.
 * Підміняти сам файл не можна: перевірка ходить по file:// і має бачити
 * той самий код, що й люди.
 *
 * Запуск: node tools/verifylvlbar.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const CFG = JSON.parse(readFileSync(ROOT + '/db/elo-config.json', 'utf8'));
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

/** Ключ дня зі зсувом — той самий вигляд, що в застосунку. */
const key = (shift) => {
  const d = new Date();
  d.setDate(d.getDate() - shift);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
};

/** Понеділок цього тижня й скільки днів від нього минуло. */
const sinceMonday = (() => {
  const d = new Date();
  return (d.getDay() + 6) % 7;      /* 0 = понеділок */
})();

async function page(elo, events) {
  const ctx = await adultContext(b, { viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript((fake) => {
    let s;
    Object.defineProperty(window, 'Store', {
      configurable: true,
      get: function () { return s; },
      set: function (nv) {
        s = nv;
        if (!s || s.__faked) return;
        s.__faked = true;
        s.isCloud = true;
        s.user = function () { return { id: 'verify', email: 'v@example.test' }; };
        s.accountCached = function () { return { username: 'VERIFY', status: 'approved' }; };
        s.rpc = async function (name) {
          if (name === 'elo_state') {
            /* ELO можна підмінити з тесту через localStorage — саме тому
               через нього, а не через змінну: переживає reload, а
               підвищення рівня перевіряється рівно на другому заході. */
            var over = Number(localStorage.getItem('__fakeElo'));
            return Object.assign({}, fake.state,
              Number.isFinite(over) && over > 0 ? { elo: over } : {});
          }
          if (name === 'elo_recent') return fake.events;
          if (name === 'elo_history') return { awards: [], history: [] };
          if (name === 'elo_leaderboard') return [];
          return null;
        };
      }
    });
  }, {
    state: {
      season: 'AUTUMN-2026', elo: elo, today: 3,
      graceUsed: 0, graceUntil: null, rank: 1, of: 1, config: CFG
    },
    events: events
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
  await p.waitForSelector('#sz-header .lvlbar', { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1400);
  return { p, ctx, errs };
}

/* ---- 1. Перший рівень: два кінці, заливка, числа ---- */
{
  /* 24 ELO — рівень 1 (розмір рівня 200), пройдено 12%. Дві події цього
     тижня дають +7, одна минулого — не рахується. */
  const events = [
    { day: key(0), delta: 4, reason: 'тренування' },
    { day: key(sinceMonday), delta: 3, reason: 'сон' },
    { day: key(sinceMonday + 1), delta: 9, reason: 'минулий тиждень' }
  ];
  const { p, ctx, errs } = await page(24, events);

  ok('1. шкала намальована', await p.locator('#sz-header .lvlbar').count() === 1);
  ok('2. у неї два кінці', await p.locator('#sz-header .lvlbar .lvlbar__end').count() === 2);

  const nums = await p.locator('#sz-header .lvlbar .lvl-ico__n')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));
  ok('3. ліворуч поточний рівень, праворуч наступний',
     nums.join(',') === '1,2', nums.join(','));

  /* Заливка приїжджає змінною --to, а не width: вона росте анімацією. */
  const to = await p.locator('#sz-header .lvlbar__fill')
    .evaluate((e) => e.style.getPropertyValue('--to').trim());
  ok('4. заливка = відсоток рівня, а не саме ELO', to === '12%', to);

  /* А після анімації ширина справді така. */
  const w = await p.locator('#sz-header .lvlbar__fill').evaluate((e) => {
    const track = e.parentElement.getBoundingClientRect().width;
    return Math.round(e.getBoundingClientRect().width / track * 100);
  });
  ok('5. і смуга справді заповнена на стільки ж', Math.abs(w - 12) <= 2, String(w));

  const cap = await p.locator('#sz-header .lvlbar + .row').innerText();
  ok('6. видно, скільки ELO зараз і скільки всього', /24\s*\/\s*200 ELO/.test(cap), cap.replace(/\n/g, ' '));
  ok('7. видно, скільки лишилось до наступного рівня',
     /ще\s*176\s*до Level 2/.test(cap.replace(/\n/g, ' ')), cap.replace(/\n/g, ' '));

  /* ГОЛОВНА ЗМІНА: метрика тижнева, а не денна. «Сьогодні» майже завжди
     нуль або трійка, і дивитись на неї означало робити висновок про
     застій там, де за тиждень набігло двадцять. */
  const hero = await p.locator('#sz-header .rating-hero').innerText();
  ok('8. у шапці стоїть приріст ЗА ТИЖДЕНЬ', /за тиждень/i.test(hero), hero.replace(/\n/g, ' '));
  ok('9. і рахується він з понеділка включно, без минулого тижня',
     /\+7 ELO за тиждень/.test(hero.replace(/\n/g, ' ')), hero.replace(/\n/g, ' '));

  ok('10. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Десятий рівень: праворуч стеля, а не Level 11 ---- */
{
  /* 1900 ELO — десятий рівень, до ELITE (2000) лишилось 100. */
  const { p, ctx, errs } = await page(1900, []);

  const nums = await p.locator('#sz-header .lvlbar .lvl-ico__n')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));
  ok('11. жетон рівно один — одинадцятого рівня не існує',
     nums.join(',') === '10', nums.join(','));
  ok('12. праворуч позначка стелі', await p.locator('#sz-header .lvlbar__end--top').count() === 1);

  const cap = await p.locator('#sz-header .lvlbar + .row').innerText().then((t) => t.replace(/\n/g, ' '));
  /* Регресія: доти тут писалось «До Level 11». */
  ok('13. і жодного Level 11 у підписі', !/Level 11/.test(cap), cap);
  ok('14. підпис веде до ELITE', /до ELITE/.test(cap), cap);

  ok('15. без тижневого числа сторінка не ламається',
     await p.locator('#sz-header .lvlbar').count() === 1);
  ok('16. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. ELITE: шкала веде до стелі сезону ---- */
{
  const { p, ctx, errs } = await page(2200, []);
  const cap = await p.locator('#sz-header .lvlbar + .row').innerText().then((t) => t.replace(/\n/g, ' '));
  ok('17. на ELITE шкала міряє до стелі сезону',
     /2200\s*\/\s*2500 ELO/.test(cap) && /до стелі сезону/.test(cap), cap);
  ok('18. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Підвищення рівня показується один раз ---- */
{
  /* Перший захід на рівні 1 лише запамʼятовує рівень: показувати свято
     людині, яка просто відкрила сторінку, — брехня. */
  const one = await page(24, []);
  ok('19. перший захід — без анімації підвищення',
     await one.p.locator('#sz-header .lvlbar.is-levelup').count() === 0);
  /* Той самий контекст, те саме сховище — але рівень виріс до другого. */
  await one.p.evaluate(() => localStorage.setItem('__fakeElo', '260'));
  await one.p.reload({ waitUntil: 'load' });
  await one.p.waitForSelector('#sz-header .lvlbar', { timeout: 8000 }).catch(() => {});
  await one.p.waitForTimeout(1400);
  ok('19б. ріст рівня вмикає анімацію підвищення',
     await one.p.locator('#sz-header .lvlbar.is-levelup').count() === 1);
  ok('19в. і промінь по доріжці справді анімується',
     await one.p.locator('#sz-header .lvlbar__track').evaluate(
       (e) => getComputedStyle(e, '::after').animationName) === 'lvlbar-sweep');

  /* А при наступному відкритті свята вже немає: те, що триває вічно,
     перестає бути святом. */
  await one.p.reload({ waitUntil: 'load' });
  await one.p.waitForSelector('#sz-header .lvlbar', { timeout: 8000 }).catch(() => {});
  await one.p.waitForTimeout(1200);
  ok('19г. при наступному заході анімації вже немає',
     await one.p.locator('#sz-header .lvlbar.is-levelup').count() === 0);
  await one.ctx.close();

  /* Другий контекст із чистим сховищем, але вже другим рівнем: свята
     теж немає — нам нема з чим порівнювати. Це та сама перевірка з
     іншого боку: анімація зʼявляється лише на РОСТІ, а не на факті
     «рівень другий». */
  const two = await page(260, []);
  ok('20. чисте сховище на другому рівні — теж без анімації',
     await two.p.locator('#sz-header .lvlbar.is-levelup').count() === 0);
  const seen = await two.p.evaluate(() => localStorage.getItem('ib.elo.lvlseen'));
  ok('21. але рівень запамʼятався', /"level":2/.test(String(seen)), String(seen));
  await two.ctx.close();
}

/* ---- 5. Телефон: шкала не тягне сторінку вбік ---- */
{
  const ctx = await adultContext(b, { viewport: { width: 360, height: 780 } });
  await ctx.addInitScript((fake) => {
    let s;
    Object.defineProperty(window, 'Store', {
      configurable: true,
      get: function () { return s; },
      set: function (nv) {
        s = nv;
        if (!s || s.__faked) return;
        s.__faked = true;
        s.isCloud = true;
        s.user = function () { return { id: 'verify' }; };
        s.rpc = async function (name) {
          if (name === 'elo_state') return fake.state;
          if (name === 'elo_recent') return [];
          if (name === 'elo_history') return { awards: [], history: [] };
          if (name === 'elo_leaderboard') return [];
          return null;
        };
      }
    });
  }, { state: { season: 'AUTUMN-2026', elo: 24, today: 0, rank: 1, of: 1, config: CFG } });
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/rating.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('22. на 360px сторінка не їде вбік', over === false);
  const ends = await p.locator('#sz-header .lvlbar__end').evaluateAll(
    (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  ok('23. жетони не схлопнулись', ends.length === 2 && ends.every((x) => x >= 28), String(ends));
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок шкали рівня пройшло.');
process.exit(bad ? 1 : 0);
