/**
 * СТРІЧКА ПОДІЙ, ПЛИТКИ-ВХОДИ Й СТОРІНКА СЕЗОНІВ — реальний браузер.
 *
 * Три зміни, які юніти не бачать, бо всі три — про екран:
 *
 *   1. «Останні події» ЗГОРТАЮТЬСЯ, і вибір запамʼятовується. Це єдине
 *      місце, де видно, за що прийшло число, але потрібне воно раз на
 *      тиждень, а місця займало найбільше на сторінці. Стережемо і
 *      згортання, і памʼять про нього — без другого зміна марна: людина
 *      закриває стрічку й наступного дня бачить її знову відкритою.
 *
 *   2. Плитки «нагород» і «сезонів завершено» ВЕДУТЬ КУДИСЬ. Доти це
 *      були мертві числа. А вітрина нагород переїхала в САМИЙ НИЗ
 *      сторінки: рейтинг читають зверху вниз, і нагороди не відповідають
 *      ні на що з питань, із якими його відкривають.
 *
 *   3. seasons.html — окрема сторінка з підсумком кожного завершеного
 *      сезону. Дані для неї сервер віддавав від першого дня (elo_history
 *      несе категорії, активні дні, grace, екстремуми), і не показувалось
 *      із них НІЧОГО.
 *
 * Стережемо те, на чому такі екрани ламаються тихо:
 *   • сума дня = сума дельт його подій, а не «скільком подіям»;
 *   • нуль від тижневої оцінки (elo_after = 0) не друкується як рахунок —
 *     інакше людина читає, що обнулилась;
 *   • категорія підписана СЛОВОМ, включно зі штрафом і бонусом: саме їх
 *     без підпису й не зрозуміти;
 *   • ширина смуги сезону пропорційна ELO і міряється від стелі сезону;
 *   • «найкраще місце» — найменше число, а порожнє місце дає прочерк, не
 *     нуль (нуль виглядав би як перше місце);
 *   • нагороди в розборі сезону — саме того сезону.
 *
 * СЕРВЕР ПІДРОБЛЕНИЙ. window.Store перехоплюється в момент присвоєння —
 * той самий прийом, що в tools/verifylvlbar.mjs: сторінка ходить по
 * file:// і мусить бачити той самий код, що й люди.
 *
 * Запуск: node tools/verifyseasons.mjs
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

/** Ключ дня зі зсувом назад — той самий вигляд, що в застосунку. */
const key = (shift) => {
  const d = new Date();
  d.setDate(d.getDate() - shift);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
};
/** Понеділок цього тижня. */
const mondayKey = (() => {
  const d = new Date();
  return key((d.getDay() + 6) % 7);
})();

/*
 * ФІКСТУРА ПОДІЙ. Найновіше першим — рівно так віддає elo_recent
 * (order by id desc), і саме на цей порядок спирається групування.
 *
 * Шість різних днів навмисно: стрічка показує чотири, решта за кнопкою.
 * Серед подій є штраф із elo_after = 0 — тижнева оцінка; він тут не для
 * повноти, а тому що це єдиний рядок, на якому видно, чи не друкується
 * той нуль як «стало нуль ELO».
 */
const EVENTS = [
  { day: key(0), category: 'training',  delta: 5,   reason: 'Тренування закрито', eloAfter: 412 },
  { day: key(0), category: 'sleep',     delta: 2,   reason: 'Сон 7.5 год',        eloAfter: 407 },
  { day: key(1), category: 'penalty',   delta: -12, reason: 'Недобір тижня',      eloAfter: 0 },
  { day: key(1), category: 'nutrition', delta: 4,   reason: 'День харчування',    eloAfter: 405 },
  { day: key(3), category: 'bonus',     delta: 6,   reason: 'Чистий день',        eloAfter: 401 },
  { day: key(6), category: 'activity',  delta: 3,   reason: 'Кроки за день',      eloAfter: 395 },
  { day: key(9), category: 'recovery',  delta: 2,   reason: 'Відновлення',        eloAfter: 392 }
];
/* Скільком ELO дорівнює тиждень — рахуємо тут, а не пишемо числом: інакше
   перевірка стереже день тижня, у який її написали. */
const WEEK_SUM = EVENTS.filter((e) => e.day >= mondayKey).reduce((s, e) => s + e.delta, 0);
const DAYS = [...new Set(EVENTS.map((e) => e.day))];

const STATS = {
  training:  { events: 40, elo: 700, avgQuality: 0.82 },
  nutrition: { events: 60, elo: 500, avgQuality: 0.71 },
  sleep:     { events: 50, elo: 300, avgQuality: 0.64 },
  recovery:  { events: 20, elo: 120, avgQuality: 0.55 },
  activity:  { events: 30, elo: 180, avgQuality: 0.48 },
  biggestGain: 24, biggestLoss: -18,
  bestCategory: 'training', weakestCategory: 'activity'
};

const HISTORY = [
  { season: 'SUMMER-2026', elo: 2100, level: 10, elite: true, rank: 1, of: 50, percentile: 2,
    daysActive: 80, daysTotal: 92, graceUsed: 0, stats: STATS },
  { season: 'SPRING-2026', elo: 900, level: 5, elite: false, rank: 5, of: 30, percentile: 16.7,
    daysActive: 40, daysTotal: 92, graceUsed: 1, stats: STATS }
];
const AWARDS = [
  { season: 'SUMMER-2026', kind: 'first',  label: '#1 сезону' },
  { season: 'SUMMER-2026', kind: 'elite',  label: 'ELITE 2000+' },
  { season: 'SPRING-2026', kind: 'level5',  label: 'Season Badge' }
];

const STATE = {
  season: 'AUTUMN-2026', elo: 412, today: 7,
  graceUsed: 1, graceUntil: null, rank: 3, of: 40, config: CFG
};

/**
 * Контекст із підробленим сервером. Один на кілька сторінок — стан
 * стрічки живе в localStorage, і перевірка памʼяті вимагає, щоб той
 * localStorage між заходами НЕ чистився.
 */
async function context(fake, opts) {
  const ctx = await adultContext(b, Object.assign({ viewport: { width: 1100, height: 1000 } }, opts || {}));
  await ctx.addInitScript((f) => {
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
          if (name === 'elo_state') return f.state;
          /* Стрічка, яка НЕ приїхала, — окремий стан: loadRecent ковтає
             помилку навмисно (без звʼязку решта панелі працює з кешу), і
             саме тому екран мусить сказати про це словами. */
          if (name === 'elo_recent') {
            if (f.recentFails) throw new Error('offline');
            return f.events;
          }
          if (name === 'elo_history') return { history: f.history, awards: f.awards };
          if (name === 'elo_leaderboard') return [];
          return null;
        };
      }
    });
  }, fake);
  return ctx;
}

async function open(ctx, url, sel) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + ROOT + '/' + url, { waitUntil: 'load' });
  if (sel) await p.waitForSelector(sel, { timeout: 9000 }).catch(() => {});
  await p.waitForTimeout(900);
  return { p, errs };
}

const FAKE = { state: STATE, events: EVENTS, history: HISTORY, awards: AWARDS };

/* ================================================================== */
/* 1. Стрічка подій: згортання й памʼять                               */
/* ================================================================== */
{
  const ctx = await context(FAKE);
  let { p, errs } = await open(ctx, 'rating.html', '#sz-events .acc');

  ok('1. стрічка подій — акордеон, а не глухий список',
    await p.locator('#sz-events .acc__head').count() === 1);
  ok('2. за замовчуванням відкрита — її ще не закривали',
    await p.locator('#sz-events .acc.is-open').count() === 1);

  const head = await p.locator('#sz-events .acc__head').innerText();
  ok('3. голова каже підсумок тижня, а не лише назву',
    /ELO за тиждень/.test(head) && head.includes(String(WEEK_SUM > 0 ? '+' + WEEK_SUM : WEEK_SUM)),
    head.replace(/\n/g, ' · '));

  /* Дні, а не плоский список: EVENTS_DAYS у js/season.js = 4. */
  ok('4. події згорнуті в дні, показано перші чотири',
    await p.locator('#sz-events .szday').count() === 4,
    String(await p.locator('#sz-events .szday').count()));

  const first = await p.locator('#sz-events .szday').first().innerText();
  ok('5. найсвіжіший день підписаний словом «Сьогодні»', /Сьогодні/.test(first),
    first.replace(/\n/g, ' · '));
  ok('6. сума дня — сума дельт його подій', /\+7/.test(first), first.replace(/\n/g, ' · '));

  const cats = await p.$$eval('#sz-events .szev__cat', (n) => n.map((x) => x.textContent.trim()));
  ok('7. категорія підписана словом', cats.includes('Тренування') && cats.includes('Сон'),
    cats.join(', '));
  ok('8. штраф і бонус теж мають підпис — саме їх і не зрозуміти без нього',
    cats.includes('Штраф') && cats.includes('Бонус'), cats.join(', '));

  const elos = await p.$$eval('#sz-events .szev__elo', (n) => n.map((x) => x.textContent.trim()));
  ok('9. рахунок після події показано', elos.includes('412') && elos.includes('405'), elos.join(', '));
  ok('10. нуль від тижневої оцінки не друкується як рахунок',
    !elos.includes('0'), elos.join(', '));

  /* Кнопка «показати ще» — решта днів за нею, а не обрізана назавжди. */
  ok('11. решта днів доступна кнопкою', await p.locator('#sz-ev-more').count() === 1);
  await p.locator('#sz-ev-more').click();
  await p.waitForTimeout(400);
  ok('12. після кнопки видно всі дні', await p.locator('#sz-events .szday').count() === DAYS.length,
    String(await p.locator('#sz-events .szday').count()));

  /* Згортання: вміст мусить зникнути і з таб-порядку теж. */
  await p.locator('#sz-events .acc__head').click();
  await p.waitForTimeout(500);
  ok('13. клік по голові згортає стрічку',
    await p.locator('#sz-events .acc.is-open').count() === 0);
  ok('14. згорнутий вміст недосяжний для клавіатури й читалки',
    await p.locator('#sz-events .acc__inner[inert]').count() === 1);
  const headClosed = await p.locator('#sz-events .acc__head').innerText();
  ok('15. згорнута голова все одно каже підсумок', /ELO за тиждень/.test(headClosed),
    headClosed.replace(/\n/g, ' · '));
  ok('16. без JS-помилок', errs.length === 0, errs.join(' | '));
  await p.close();

  /* Той самий контекст — тобто той самий localStorage. */
  const again = await open(ctx, 'rating.html', '#sz-events .acc');
  ok('17. після перезавантаження стрічка лишилась згорнутою — вибір запамʼятався',
    await again.p.locator('#sz-events .acc.is-open').count() === 0);
  await again.p.locator('#sz-events .acc__head').click();
  await again.p.waitForTimeout(400);
  await again.p.close();

  const third = await open(ctx, 'rating.html', '#sz-events .acc');
  ok('18. і відкриття запамʼяталось так само',
    await third.p.locator('#sz-events .acc.is-open').count() === 1);
  ok('19. без JS-помилок', third.errs.length === 0, third.errs.join(' | '));
  await third.p.close();
  await ctx.close();
}

/* ================================================================== */
/* 2. Плитки-входи й місце нагород                                     */
/* ================================================================== */
{
  const ctx = await context(FAKE);
  const { p, errs } = await open(ctx, 'rating.html', '#sz-awards .awd');

  const links = await p.$$eval('#sz-header .kpi--link',
    (n) => n.map((x) => ({ href: (x.getAttribute('href') || ''), text: x.innerText.replace(/\n/g, ' ') })));
  ok('20. плитка нагород веде на вітрину нагород',
    links.some((l) => l.href === 'awards.html' && /нагород/i.test(l.text)),
    JSON.stringify(links));
  ok('21. плитка сезонів веде на сторінку сезонів',
    links.some((l) => l.href === 'seasons.html' && /сезон/i.test(l.text)),
    JSON.stringify(links));
  ok('22. обидві плитки — саме посилання, а не мертві числа',
    await p.locator('#sz-header a.kpi--link').count() === 2,
    String(await p.locator('#sz-header a.kpi--link').count()));

  /*
   * Нагороди — ОСТАННІЙ блок сторінки. Перевіряємо не «десь нижче», а
   * саме останній нащадок: «нижче за щось одне» пройшло б і тоді, коли
   * блок повернеться в середину.
   */
  const last = await p.evaluate(() => {
    const w = document.querySelector('main .wrap');
    return w && w.lastElementChild ? w.lastElementChild.id : null;
  });
  ok('23. вітрина нагород — останній блок сторінки', last === 'sz-awards', String(last));

  const order = await p.evaluate(() => {
    const a = document.querySelector('#sz-awards');
    const rules = document.querySelector('.acc--longform');
    if (!a || !rules) return null;
    return a.getBoundingClientRect().top - rules.getBoundingClientRect().top;
  });
  ok('24. і стоїть нижче за правила сезону', order !== null && order > 0, String(order));

  ok('25. нагороди намальовані картками', await p.locator('#sz-awards .awd').count() === AWARDS.length,
    String(await p.locator('#sz-awards .awd').count()));
  ok('26. картка нагороди веде на вітрину',
    await p.locator('#sz-awards a.awd[href="awards.html"]').count() === AWARDS.length);
  /* Блок у самому низу носить .reveal — тобто до появи в полі зору він
     прозорий. Дорендерений пізніше вміст мусить усе одно ставати
     видимим: інакше «перенесли вниз» тихо означало б «сховали». */
  await p.locator('#sz-awards').scrollIntoViewIfNeeded();
  await p.waitForTimeout(700);
  const shown = await p.evaluate(() => {
    const c = document.querySelector('#sz-awards .awd');
    if (!c) return null;
    const cs = getComputedStyle(c);
    const r = c.getBoundingClientRect();
    return { op: Number(cs.opacity), vis: cs.visibility, w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok('27. і вітрина справді видима, а не прозора після переїзду вниз',
    shown && shown.op > 0.9 && shown.vis === 'visible' && shown.w > 40 && shown.h > 40,
    JSON.stringify(shown));

  const hist = await p.locator('#sz-history').innerText();
  ok('28. превʼю історії веде на сторінку сезонів', /Усі сезони/.test(hist),
    hist.split('\n')[0]);
  ok('29. в історії лишилось превʼю, а не вся історія',
    await p.locator('#sz-history .awd').count() === 0,
    'нагороди досі в картці історії');
  ok('30. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ================================================================== */
/* 3. Сторінка сезонів із історією                                     */
/* ================================================================== */
{
  const ctx = await context(FAKE);
  const { p, errs } = await open(ctx, 'seasons.html', '#szs-list .acc');

  const now = await p.locator('#szs-now').innerText();
  ok('31. поточний сезон названий і показує свій день', /Осінь 2026/.test(now) && /день \d+ із \d+/.test(now),
    now.split('\n').slice(0, 3).join(' · '));
  ok('32. сказано, коли зʼявиться підсумок сезону', /Підсумок зʼявиться/.test(now));
  ok('33. видно, що поточне ELO в підсумки ще не входить',
    /не входить/.test(now) || /не результат/.test(now));

  const sum = await p.locator('#szs-sum').innerText();
  ok('34. підсумки за весь час намальовані', await p.locator('#szs-sum .kpi').count() === 6,
    String(await p.locator('#szs-sum .kpi').count()));
  ok('35. сезонів завершено — рівно стільки, скільки в історії',
    new RegExp('\\b' + HISTORY.length + '\\b').test(sum));
  ok('36. найкраще місце — найменше число, а не найбільше', /#1/.test(sum), sum.replace(/\n/g, ' · '));
  ok('37. найкраще ELO — максимум по сезонах', /2100/.test(sum));

  /* Драбина: смуга на сезон, поточний позначений, ширина пропорційна. */
  const rows = await p.$$eval('#szs-ladder .vol', (n) => n.map((x) => ({
    name: x.querySelector('.vol__name').innerText.replace(/\n/g, ' '),
    num: x.querySelector('.vol__num').textContent.trim(),
    w: x.querySelector('.vol__bar i').getBoundingClientRect().width,
    track: x.querySelector('.vol__bar').getBoundingClientRect().width
  })));
  ok('38. у драбині рядок на кожен сезон плюс поточний',
    rows.length === HISTORY.length + 1, String(rows.length));
  ok('39. поточний сезон позначений словом — він ще не результат',
    /зараз/.test(rows[rows.length - 1].name), rows.map((r) => r.name).join(' | '));

  /* Ширина мусить відповідати ELO від стелі сезону — з допуском на
     округлення пікселів. Саме тут «смуга просто є» відрізняється від
     «смуга щось означає». */
  const bad = rows.filter((r) => {
    const elo = Number(r.num.replace(/\D+/g, ''));
    const want = r.track * elo / CFG.seasonMax;
    return Math.abs(r.w - want) > 3;
  });
  ok('40. ширина смуги пропорційна ELO від стелі сезону', bad.length === 0,
    bad.map((r) => r.name + ': ' + Math.round(r.w) + 'px при ' + r.num).join('; '));

  /* Розбір сезонів. */
  ok('41. розбір — акордеон на кожен завершений сезон',
    await p.locator('#szs-list .acc').count() === HISTORY.length,
    String(await p.locator('#szs-list .acc').count()));
  ok('42. найновіший сезон розгорнутий, решта — ні',
    await p.locator('#szs-list .acc.is-open').count() === 1);
  const firstHead = await p.locator('#szs-list .acc').first().locator('.acc__head').innerText();
  ok('43. і найновіший — справді перший', /Літо 2026/.test(firstHead), firstHead.replace(/\n/g, ' · '));

  const open1 = await p.locator('#szs-list .acc.is-open').innerText();
  ok('44. у розборі є місце, відсоток, дні й grace',
    /Місце/.test(open1) && /Top 2/.test(open1) && /Активних днів/.test(open1) && /Grace/.test(open1),
    open1.replace(/\n/g, ' · ').slice(0, 160));
  ok('45. є розклад по категоріях із якістю виконання',
    await p.locator('#szs-list .acc.is-open .vol-list .vol').count() === 5,
    String(await p.locator('#szs-list .acc.is-open .vol-list .vol').count()));
  ok('46. є екстремуми сезону — найкращий і найгірший день',
    /Найкращий день/.test(open1) && /Найгірший день/.test(open1));

  /* Нагороди в розборі — саме цього сезону, а не всі підряд. */
  const seasons = await p.$$eval('#szs-list .acc.is-open .awd',
    (n) => n.map((x) => x.dataset.season || ''));
  ok('47. нагороди в розборі — саме цього сезону',
    seasons.length === 2 && seasons.every((s) => s === 'SUMMER-2026'),
    seasons.join(', '));

  /* Другий сезон відкривається й показує свою нагороду. */
  await p.locator('#szs-list .acc').nth(1).locator('.acc__head').click();
  await p.waitForTimeout(500);
  const seasons2 = await p.$$eval('#szs-list .acc:nth-of-type(2) .awd',
    (n) => n.map((x) => x.dataset.season || ''));
  ok('48. у сусіднього сезону — його власні нагороди',
    seasons2.length === 1 && seasons2[0] === 'SPRING-2026', seasons2.join(', '));
  ok('49. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ================================================================== */
/* 4. Сторінка сезонів без жодного завершеного                         */
/* ================================================================== */
{
  const ctx = await context({ state: STATE, events: EVENTS, history: [], awards: [] });
  const { p, errs } = await open(ctx, 'seasons.html', '#szs-list');

  const txt = await p.locator('#szs-list').innerText();
  ok('50. порожня історія пояснена словами', /Завершених сезонів ще немає/.test(txt),
    txt.split('\n')[0]);
  ok('51. і сказано, ЩО саме буде в підсумку',
    /Grace/.test(txt) && /категор/.test(txt), txt.replace(/\n/g, ' ').slice(0, 140));
  ok('52. підсумків «за весь час» немає — рахувати нічого',
    (await p.locator('#szs-sum').innerText()).trim() === '');
  /* Одна смуга — не шкала: це те саме число, що вже стоїть вище. */
  ok('53. драбини з одного поточного сезону немає',
    (await p.locator('#szs-ladder').innerText()).trim() === '');
  ok('54. поточний сезон при цьому показаний',
    /Осінь 2026/.test(await p.locator('#szs-now').innerText()));
  ok('55. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ================================================================== */
/* 5. Без акаунта й без сервера                                        */
/* ================================================================== */
/*
 * Дві різні відмови, і сторінка мусить відповідати на них по-різному.
 *
 * ЛОКАЛЬНИЙ РЕЖИМ (порожні ключі Supabase) — сервера немає взагалі:
 * сезонів не існує, і сказати про це треба один раз, без спроб щось
 * завантажити.
 *
 * СЕРВЕР Є, АЛЕ МОВЧИТЬ — стан сезону не приїхав. Тут спокуса лишити
 * верх сторінки порожнім, і саме цього робити не можна: порожнеча
 * читається як «нічого немає», хоч підсумки завершених сезонів приходять
 * ІНШИМ запитом і від цього стану не залежать.
 */
{
  const ctx = await adultContext(b, { viewport: { width: 1100, height: 900 } }, { local: true });
  const { p, errs } = await open(ctx, 'seasons.html', '#szs-now');
  const txt = await p.locator('#szs-now').innerText();
  ok('56. у локальному режимі сторінка чесно пояснює, а не порожня', /Потрібен акаунт/.test(txt),
    txt.replace(/\n/g, ' ').slice(0, 120));
  ok('57. і сказано, що сервера немає, а не що «щось зламалось»',
    /локальному режимі/.test(txt), txt.replace(/\n/g, ' ').slice(0, 160));
  ok('58. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

{
  /* Сервер відповідає, але порожнім обʼєктом — саме так поводиться
     підроблений Supabase у tools/adult.mjs, і саме так виглядає
     несподівана відповідь у житті. */
  const ctx = await adultContext(b, { viewport: { width: 1100, height: 900 } });
  const { p, errs } = await open(ctx, 'seasons.html', '#szs-now');
  const txt = await p.locator('#szs-now').innerText();
  ok('59. відповідь без стану сезону не лишає верх сторінки порожнім',
    txt.trim().length > 0, JSON.stringify(txt.slice(0, 80)));
  ok('60. і пояснює, що підсумки нижче від цього не залежать',
    /не залежать/.test(txt), txt.replace(/\n/g, ' ').slice(0, 160));
  ok('61. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ================================================================== */
/* 6. Телефон                                                          */
/* ================================================================== */
{
  const ctx = await context(FAKE, { viewport: { width: 390, height: 844 } });
  const { p, errs } = await open(ctx, 'rating.html', '#sz-events .acc');
  ok('62. рейтинг на телефоні не їде вбік',
    await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    String(await p.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth)));

  /* Дельта праворуч не може вилізти за край картки: саме на цьому
     ламаються рядки з довгою причиною. */
  const overflow = await p.evaluate(() => {
    const card = document.querySelector('#sz-events .acc');
    if (!card) return null;
    const right = card.getBoundingClientRect().right;
    return [...document.querySelectorAll('#sz-events .szev__r')]
      .filter((x) => x.getBoundingClientRect().right > right).length;
  });
  ok('63. дельта події не вилізає за край картки', overflow === 0, String(overflow));
  await p.close();

  const s = await open(ctx, 'seasons.html', '#szs-list .acc');
  ok('64. сторінка сезонів на телефоні не їде вбік',
    await s.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    String(await s.p.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth)));
  ok('65. смуги сезонів на телефоні лишаються видимими',
    await s.p.locator('#szs-ladder .vol__bar').count() === HISTORY.length + 1);
  ok('66. без JS-помилок', errs.length === 0 && s.errs.length === 0,
    errs.concat(s.errs).join(' | '));
  await ctx.close();
}

/* ================================================================== */
/* 7. Стрічка не приїхала — це не «порожньо»                           */
/* ================================================================== */
{
  const ctx = await context({ state: STATE, events: [], history: HISTORY, awards: AWARDS, recentFails: true });
  const { p, errs } = await open(ctx, 'rating.html', '#sz-events');
  const txt = await p.locator('#sz-events').innerText();
  ok('67. невдале завантаження стрічки не називається «порожньо»',
    !/Ще порожньо/.test(txt), txt.replace(/\n/g, ' ').slice(0, 140));
  ok('68. і пояснює, що нарахування не загубились', /не губляться/.test(txt),
    txt.replace(/\n/g, ' ').slice(0, 160));
  ok('69. решта панелі при цьому працює — ELO на місці',
    /412/.test(await p.locator('#sz-header').innerText()));
  ok('70. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок сезонів і стрічки подій пройшло.');
process.exit(bad ? 1 : 0);
