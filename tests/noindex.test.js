/**
 * САЙТ ПОЗА ПОШУКОМ — І НЕ ВОЗИТЬ АПАРАТУ ДЛЯ НЬОГО.
 *
 * РІШЕННЯ. Get Stronger — приватний застосунок для вузького кола, і в
 * пошукову видачу він не йде. Виконує це `X-Robots-Tag: noindex, nofollow`
 * у `vercel.json`, і стоїть він на КОЖНІЙ адресі.
 *
 * ЧОМУ ЦЕ ПОТРЕБУЄ ТЕСТУ. До 13.09.2026 рішення й апарат суперечили одне
 * одному: заголовок закривав сайт від пошуку, а в репозиторії жили
 * `sitemap.xml` із priority і changefreq, `<link rel="canonical">` на
 * пʼятнадцяти сторінках, JSON-LD, що дописувався на кожному завантаженні,
 * і `tools/build-meta.js` із коментарем «Сторінки, які має бачити пошук».
 * Половина апарату обслуговувала те, що вимкнене заголовком, — і жодна
 * перевірка цього не бачила, бо кожна половина окремо була правильною.
 *
 * Повернути будь-яку з них легко й непомітно: canonical і sitemap —
 * звичні речі, які додають «щоб було як у людей». Тому тут перевіряється
 * ЦІЛІСНІСТЬ рішення, а не окремі файли: або сайт закритий і апарату
 * немає, або хтось свідомо міняє і те, і те разом.
 *
 * ЩО НЕ ВХОДИТЬ У ЦЕ РІШЕННЯ: теги `og:*`. Превʼю в месенджері — не
 * пошук; краулер Telegram чи Slack `X-Robots-Tag` не читає, він просто
 * тягне сторінку заради картки. Тому og:image, og:title і og:url
 * лишаються, і лишаються СТАТИЧНО в розмітці: ті краулери не виконують JS.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const has = (f) => fs.existsSync(path.join(ROOT, f));
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();

describe('Рішення: сайт закритий від пошуку', () => {
  test('заголовок noindex стоїть на КОЖНІЙ адресі, а не на окремих сторінках', () => {
    const cfg = JSON.parse(read('vercel.json'));
    const all = (cfg.headers || []).find((h) => h.source === '/(.*)');
    assert.ok(all, 'у vercel.json немає блоку заголовків для /(.*)');
    const robots = (all.headers || []).find((h) => h.key === 'X-Robots-Tag');
    assert.ok(robots, 'на /(.*) немає X-Robots-Tag — сайт відкритий для індексації');
    assert.match(robots.value, /noindex/);
    assert.match(robots.value, /nofollow/);
  });

  test('robots.txt не забороняє заходити — інакше бот не прочитає заголовка', () => {
    /* Disallow тут був би гіршим за відкритий шлях: бот, якого не пустили,
       не бачить X-Robots-Tag, і адреса може потрапити у видачу самим лише
       URL, без вмісту. */
    const txt = read('robots.txt');
    assert.doesNotMatch(txt, /^\s*Disallow:\s*\//mi, 'Disallow ховає від бота сам заголовок noindex');
    assert.match(txt, /^\s*Allow:\s*\//mi);
  });
});

describe('Апарату індексації в репозиторії немає', () => {
  test('карти сайту немає — вона існує лише щоб пошук знайшов сторінки', () => {
    assert.equal(has('sitemap.xml'), false,
      'зʼявився sitemap.xml: або приберіть його, або скасуйте рішення про noindex — разом');
  });

  test('robots.txt не вказує на карту сайту', () => {
    assert.doesNotMatch(read('robots.txt'), /^\s*Sitemap:/mi);
  });

  test('жодна сторінка не носить canonical', () => {
    const bad = PAGES.filter((f) => /<link[^>]+rel=["']canonical/i.test(read(f)));
    assert.equal(bad.join(', '), '', 'canonical повернувся на: ' + bad.join(', '));
  });

  test('js/app.js не додає ні canonical, ні JSON-LD', () => {
    const src = read('js/app.js');
    assert.doesNotMatch(src, /rel\s*=\s*['"]canonical/i);
    assert.doesNotMatch(src, /application\/ld\+json/i,
      'JSON-LD описує сайт пошуковому роботові, якого ми не пускаємо');
  });

  test('build-meta проставляє og:url і більше нічого', () => {
    /* Коментарі зрізаємо: у шапці файла пояснено, ЧОМУ canonical і
       sitemap звідти прибрані, і перевірка не має спотикатись об
       власне пояснення. */
    const src = read('tools/build-meta.js')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    assert.match(src, /og:url/);
    assert.doesNotMatch(src, /canonical/i, 'build-meta знову вписує canonical');
    assert.doesNotMatch(src, /sitemap/i, 'build-meta знову збирає карту сайту');
  });
});

describe('Картки для месенджерів від цього не постраждали', () => {
  /*
   * Єдиний бік, з якого рішення могло б щось зламати: якби разом із
   * апаратом пошуку прибрали й og:*, посилання на сайт відкривалось би в
   * чаті голим рядком.
   *
   * Умова саме така: сторінка з карткою мусить мати картку ПОВНУ. Не
   * «кожна сторінка мусить мати og:*» — службові (admin, offline) і
   * журнали (train-log, weight-log, measure, legal) їх ніколи не мали, і
   * вимагати картку там означало б вимагати нової роботи, а не стерегти
   * наявну.
   */
  test('де є картка — там є і og:title, і og:url', () => {
    const missing = [];
    PAGES.forEach((f) => {
      const html = read(f);
      if (!html.includes('property="og:image"')) return;
      ['og:title', 'og:url', 'og:site_name'].forEach((tag) => {
        if (!html.includes('property="' + tag + '"')) missing.push(f + ' → ' + tag);
      });
    });
    assert.equal(missing.join(', '), '', 'неповна картка: ' + missing.join(', '));
  });

  test('og:url стоїть у розмітці, а не додається з JS', () => {
    /* Краулери превʼю (Telegram, Slack, WhatsApp) JS не виконують: тег,
       доданий js/app.js, для них не існує. Саме тому є build-meta. */
    const withCard = PAGES.filter((f) => read(f).includes('property="og:image"'));
    assert.ok(withCard.length >= 15, 'сторінок із карткою стало підозріло мало');
    const bad = withCard.filter((f) => !/<meta property="og:url" content="https?:\/\//.test(read(f)));
    assert.equal(bad.join(', '), '', 'og:url не статичний на: ' + bad.join(', '));
  });
});
