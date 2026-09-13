/**
 * ВІТРИНА НАГОРОД: рідкість, фільтри, чесність.
 *
 * Досі всі нагороди виглядали однаково чорними, і «Тисяча сезону»
 * коштувала на око стільки ж, скільки «Перше місце». Тепер у кожної є
 * сходинка рідкості — колір лиця, а назва словом на звороті, — а вітрину
 * можна звузити до сезону чи до рідкості.
 *
 * Стереже те, на чому така шкала зазвичай і ламається:
 *   • рідкість видно НА ЛИЦІ кольором, і саме кольором — слова там нема;
 *   • колір не єдиний носій сенсу — слово є на звороті (дальтонік, читалка);
 *   • назви сходинок англійські (Common…Legendary) — шкала, яку не треба
 *     порівнювати між собою, щоб зрозуміти порядок;
 *   • чорна сходинка одна й дається не за сезон;
 *   • фільтр за сезоном ховає силуети (їх у тому сезоні не отримано),
 *     а фільтр за рідкістю — лишає (питання «що тут буває золотого»
 *     має сенс і для того, хто золотого ще не бачив);
 *   • порожній добір пояснюється словами, а не порожнечею.
 *
 * Запуск: node tools/verifyawards.mjs
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const EARNED = [
  { kind: 'beta',     season: null,      label: 'BETA' },
  { kind: 'elite',    season: '2026-S1' },
  { kind: 'top3',     season: '2026-S1' },
  { kind: 'level9',   season: '2026-S2' },
  { kind: 'top10pct', season: '2026-S2' }
];

/*
 * Сервер тут не потрібен: підміняємо EloApi ДО скриптів сторінки.
 * Через геттер із мовчазним сеттером, а не значенням, — elo-api.js
 * присвоює window.EloApi у строгому режимі, і незаписуваний власний
 * запис кинув би там TypeError, поламавши сторінку замість підміни.
 */
async function page(earned) {
  const ctx = await adultContext(b, { viewport: { width: 1000, height: 1000 } });
  await ctx.addInitScript((list) => {
    /* Заглушка мусить мати ВЕСЬ публічний обрис EloApi, а не лише
       history: сторінку супроводжують сусідні модулі (бейдж рейтингу,
       гачки сезону), і кожен відсутній метод — це помилка в консолі,
       через яку перевірка «без JS-помилок» червона не по суті. */
    const nop = function () {};
    let v = {
      history: async () => ({ awards: list }),
      available: () => true,
      cached: () => null,
      refresh: async () => null,
      onChange: nop,
      leaderboard: async () => [],
      submit: async () => null,
      setName: async () => null,
      activateGrace: async () => null,
      closeSeasonIfDue: async () => null,
      evaluateWeeks: async () => null
    };
    Object.defineProperty(window, 'EloApi', {
      get: function () { return v; },
      set: function () { /* навмисно мовчки */ },
      configurable: true
    });
  }, earned);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + ROOT + '/awards.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  return { ctx, p, errs };
}

/* ---- 1. Рідкість видно ---- */
{
  const { ctx, p, errs } = await page(EARNED);
  ok('1. вітрина намальована', await p.locator('.awd').count() >= 15,
    String(await p.locator('.awd').count()));
  ok('2. у кожної картки є сходинка рідкості',
    await p.locator('.awd:not([data-tier])').count() === 0);
  /*
   * Слово рідкості живе на ЗВОРОТІ. На лиці його немає навмисно: колір
   * лиця вже відповідає на «наскільки рідкісна», а підпис поверх нього
   * казав те саме двічі. Перевіряємо обидві половини одразу — інакше
   * «прибрали з лиця» тихо перетворилось би на «прибрали зовсім», і
   * колір лишився б єдиним носієм сенсу.
   */
  ok('3. на лиці рідкості немає — лице тримається на кольорі',
    await p.locator('.awd .awd__face--front .awd__rar').count() === 0,
    String(await p.locator('.awd .awd__face--front .awd__rar').count()));
  ok('4. але слово є на звороті — колір не єдиний носій сенсу',
    await p.locator('.awd .awd__face--back .awd__rar').count() === await p.locator('.awd').count());
  /* Назви сходинок англійські: шкала Common→Legendary упорядкована в
     очах будь-кого, хто бачив колекційну гру. Кирилиця тут — регрес. */
  {
    const words = await p.$$eval('.awd .awd__face--back .awd__rar', (n) => n.map((x) => x.textContent.trim()));
    const bad = words.filter((w) => /[а-яіїєґ]/i.test(w));
    ok('5. назви рідкості англійські', bad.length === 0, bad.join(', ') || [...new Set(words)].join(', '));
  }

  const tiers = await p.$$eval('.awd[data-tier]', (n) => n.map((x) => Number(x.dataset.tier)));
  ok('6. використано всі вісім сходинок', new Set(tiers).size === 8,
    [...new Set(tiers)].sort((a, c) => a - c).join(','));

  /* Чорна — не за сезон, і вона одна. */
  const black = await p.$$eval('.awd[data-tier="8"]', (n) => n.map((x) => x.className));
  ok('7. чорна сходинка одна', black.length === 1, String(black.length));
  ok('8. і це BETA — те, чого не повторити', /awd--beta/.test(black[0] || ''), black[0] || '—');

  /* Дві найнижчі приглушені, решта — ні. Це і є шкала. */
  const soft = await p.$$eval('.awd--soft', (n) => n.map((x) => Number(x.dataset.tier)));
  ok('9. приглушені саме перші дві сходинки',
    soft.length > 0 && soft.every((t) => t <= 2), [...new Set(soft)].join(','));
  const loud = await p.$$eval('.awd[data-tier]:not(.awd--soft)', (n) => n.map((x) => Number(x.dataset.tier)));
  ok('10. решта світиться повним кольором', loud.every((t) => t >= 3), [...new Set(loud)].join(','));

  /* Колір справді різний — інакше вся ця шкала існує лише в коді. */
  const inks = await p.$$eval('.awd[data-tier] .awd__face--front',
    (n) => n.map((x) => getComputedStyle(x).color));
  ok('11. кольори лиць справді різні', new Set(inks).size >= 7, String(new Set(inks).size));
  ok('12. золота — жовта', /255,\s*204,\s*92/.test(
    await p.locator('.awd--elite .awd__face--front').first().evaluate((e) => getComputedStyle(e).color)),
    await p.locator('.awd--elite .awd__face--front').first().evaluate((e) => getComputedStyle(e).color));

  ok('13. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Фільтри ---- */
{
  const { ctx, p, errs } = await page(EARNED);
  ok('14. є ряд чипів рідкості', await p.locator('.awd-chip[data-f="tier"]').count() === 9,
    String(await p.locator('.awd-chip[data-f="tier"]').count()));
  ok('15. є ряд сезонів — бо сезонів більше одного',
    await p.locator('.awd-chip[data-f="season"]').count() === 3,
    String(await p.locator('.awd-chip[data-f="season"]').count()));

  const visible = () => p.locator('.awd:not([hidden])').count();
  const all = await visible();

  await p.locator('.awd-chip[data-f="tier"][data-v="7"]').click();
  await p.waitForTimeout(250);
  const gold = await p.$$eval('.awd:not([hidden])', (n) => n.map((x) => x.dataset.tier));
  ok('16. фільтр рідкості лишає лише свою сходинку',
    gold.length > 0 && gold.every((t) => t === '7'), gold.join(','));
  ok('17. силует у фільтрі рідкості лишається — видно, що буває',
    await p.locator('.awd--locked:not([hidden])').count() > 0);

  await p.locator('.awd-chip[data-f="tier"][data-v=""]').click();
  await p.waitForTimeout(250);
  ok('18. «будь-яка рідкість» повертає все', await visible() === all);

  await p.locator('.awd-chip[data-f="season"][data-v="2026-S1"]').click();
  await p.waitForTimeout(250);
  const s1 = await p.$$eval('.awd:not([hidden])', (n) => n.map((x) => x.dataset.season || ''));
  ok('19. фільтр сезону лишає лише його нагороди',
    s1.length === 2 && s1.every((x) => x === '2026-S1'), s1.join(','));
  ok('20. і ховає силуети — у тому сезоні їх не отримано',
    await p.locator('.awd--locked:not([hidden])').count() === 0);

  /* Порожній добір мусить пояснитись, а не зникнути. */
  await p.locator('.awd-chip[data-f="tier"][data-v="1"]').click();
  await p.waitForTimeout(250);
  ok('21. порожній добір пояснюється словами',
    await p.locator('.awd-grid__empty:not([hidden])').count() === 1);

  await p.locator('.awd-chip[data-f="season"][data-v=""]').click();
  await p.locator('.awd-chip[data-f="tier"][data-v=""]').click();
  await p.waitForTimeout(250);
  ok('22. скидання обох повертає повну вітрину', await visible() === all);
  ok('23. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Новачок ---- */
{
  const { ctx, p, errs } = await page([]);
  ok('24. без нагород вітрина все одно є', await p.locator('.awd').count() >= 15);
  ok('25. усі картки — силуети', await p.locator('.awd--locked').count() === await p.locator('.awd').count());
  ok('26. ряду сезонів немає — фільтрувати нічого',
    await p.locator('.awd-chip[data-f="season"]').count() === 0);
  ok('27. але шкала рідкості показана — видно, що буває',
    await p.locator('.awd-chip[data-f="tier"]').count() === 9);
  ok('28. без JS-помилок', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Телефон ---- */
{
  const ctx = await adultContext(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript((list) => {
    /* Заглушка мусить мати ВЕСЬ публічний обрис EloApi, а не лише
       history: сторінку супроводжують сусідні модулі (бейдж рейтингу,
       гачки сезону), і кожен відсутній метод — це помилка в консолі,
       через яку перевірка «без JS-помилок» червона не по суті. */
    const nop = function () {};
    let v = {
      history: async () => ({ awards: list }),
      available: () => true,
      cached: () => null,
      refresh: async () => null,
      onChange: nop,
      leaderboard: async () => [],
      submit: async () => null,
      setName: async () => null,
      activateGrace: async () => null,
      closeSeasonIfDue: async () => null,
      evaluateWeeks: async () => null
    };
    Object.defineProperty(window, 'EloApi', {
      get: function () { return v; }, set: function () {}, configurable: true
    });
  }, EARNED);
  const p = await ctx.newPage();
  await p.goto('file://' + ROOT + '/awards.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok('29. на телефоні сторінка не їде вбік', over === false);
  const chip = await p.locator('.awd-chip').first().boundingBox();
  /* 32px — нижня межа цілі для пальця в цьому проєкті (її ж стереже
     verifyresponsive). У 27px чип читався як текст, а не як кнопка. */
  ok('30. чипи натискабельні пальцем', chip && chip.height >= 34,
    chip ? Math.round(chip.height) + 'px' : '—');
  /* Крапка на чипі мусить бути кольору СВОЄЇ сходинки: інакше ряд із
     восьми слів доводиться читати цілком, щоб знайти потрібне. */
  const dots = await p.$$eval('.awd-chip[class*="awd-chip--t"]',
    (n) => n.map((x) => getComputedStyle(x, '::before').backgroundColor));
  ok('31. кожен чип рідкості має свій колір', new Set(dots).size === 8,
    String(new Set(dots).size));
  await ctx.close();
}

await b.close();
const bad = R.filter((r) => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок вітрини нагород пройшло.');
process.exit(bad ? 1 : 0);
