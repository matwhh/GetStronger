#!/usr/bin/env node
/**
 * Проставити canonical, og:url і sitemap.xml у СТАТИЧНУ розмітку.
 *
 * НАВІЩО ЦЕ ПОТРІБНО
 * ------------------
 * js/app.js уміє додавати canonical і og:url з config.siteUrl, але робить це
 * після виконання JavaScript. Для Google це прийнятно, а для краулерів
 * превʼю в месенджерах — ні: Telegram, Slack, WhatsApp, Signal JS не
 * виконують узагалі. Тому посилання на сайт відкривалось у чаті без картки,
 * і жодне заповнення config.siteUrl цього не міняло.
 *
 * Цей скрипт запускається РУКАМИ один раз перед викладенням і вписує теги
 * прямо в HTML. Сайт лишається статичним і далі відкривається подвійним
 * кліком по index.html — жодної збірки в робочому процесі не зʼявляється.
 *
 * ЯК КОРИСТУВАТИСЬ
 * ----------------
 *   1. Впиши домен у js/config.js -> siteUrl
 *   2. node tools/build-meta.js
 *   3. Виклади сайт
 *
 * Скрипт ідемпотентний: повторний запуск оновлює вже проставлені теги,
 * а не додає другі. Запуск без siteUrl — навпаки, ПРИБИРАЄ теги, щоб у
 * розмітці не лишалось посилань на старий домен.
 */
/* package.json має "type": "module", тож файл виконується як ES-модуль:
   require і __dirname тут відсутні за визначенням. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/* Читаємо siteUrl із config.js, не виконуючи його: тягнути сюди JSDOM
   заради одного рядка — марно, а регулярка тут однозначна. */
function readSiteUrl() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
  const m = /siteUrl\s*:\s*'([^']*)'/.exec(src) || /siteUrl\s*:\s*"([^"]*)"/.exec(src);
  return m ? m[1].replace(/\/+$/, '') : '';
}

/* Сторінки, які має бачити пошук. account.html навмисно поза списком:
   він під noindex, бо це особистий кабінет, а не публічна сторінка. */
const PAGES = [
  /* index.html і є «Сьогодні». today.html лишився перенаправленням для
     старих посилань — під noindex, тому в мапі його немає. */
  { file: 'index.html',          priority: '1.0', changefreq: 'daily' },
  { file: 'workout.html',        priority: '0.9', changefreq: 'monthly' },
  { file: 'programs.html',       priority: '0.9', changefreq: 'monthly' },
  { file: 'plan.html',           priority: '0.8', changefreq: 'monthly' },
  { file: 'periodization.html',  priority: '0.8', changefreq: 'monthly' },
  { file: 'boxing.html',         priority: '0.7', changefreq: 'monthly' },
  { file: 'journal.html',        priority: '0.7', changefreq: 'monthly' },
  { file: 'trackers.html',       priority: '0.7', changefreq: 'monthly' },

  { file: 'rating.html',         priority: '0.6', changefreq: 'monthly' },
  { file: 'nutrition.html',      priority: '0.9', changefreq: 'monthly' },
  { file: 'meals.html',          priority: '0.8', changefreq: 'monthly' },
  { file: 'supplements.html',    priority: '0.8', changefreq: 'monthly' },
  { file: 'cardio.html',         priority: '0.7', changefreq: 'monthly' },
  { file: 'calculator.html',     priority: '0.8', changefreq: 'monthly' },
  { file: 'research.html',       priority: '0.6', changefreq: 'yearly' }
];

const MARK_OPEN  = '<!-- build-meta:start -->';
const MARK_CLOSE = '<!-- build-meta:end -->';

function stripBlock(html) {
  const re = new RegExp('\\n?[ \\t]*' + MARK_OPEN + '[\\s\\S]*?' + MARK_CLOSE, 'g');
  return html.replace(re, '');
}

function inject(html, url) {
  const cleaned = stripBlock(html);
  const block =
    '\n' + MARK_OPEN +
    '\n<link rel="canonical" href="' + url + '">' +
    '\n<meta property="og:url" content="' + url + '">' +
    '\n' + MARK_CLOSE;
  // Перед </head>: canonical має стояти в head, а точне місце значення не має.
  return cleaned.replace(/\n?<\/head>/, block + '\n</head>');
}

function main() {
  const base = readSiteUrl();
  const all = fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html'); });

  if (!base) {
    let cleaned = 0;
    all.forEach(function (f) {
      const p = path.join(ROOT, f);
      const src = fs.readFileSync(p, 'utf8');
      const out = stripBlock(src);
      if (out !== src) { fs.writeFileSync(p, out); cleaned++; }
    });
    const sm = path.join(ROOT, 'sitemap.xml');
    if (fs.existsSync(sm)) fs.unlinkSync(sm);
    /* Рядок Sitemap теж прибираємо: інакше після зміни домену в robots.txt
       лишається адреса старого сайту, вже без самого sitemap.xml. */
    const robotsPath = path.join(ROOT, 'robots.txt');
    const robotsSrc = fs.readFileSync(robotsPath, 'utf8');
    const robotsOut = robotsSrc.replace(/^\s*Sitemap:.*$\n?/mi, '');
    if (robotsOut !== robotsSrc) fs.writeFileSync(robotsPath, robotsOut);
    console.log('siteUrl порожній у js/config.js.');
    console.log('Прибрано теги зі сторінок: ' + cleaned + '; sitemap.xml видалено; рядок Sitemap у robots.txt прибрано.');
    console.log('Впиши домен у config.js і запусти знову.');
    return;
  }

  let touched = 0;
  all.forEach(function (f) {
    const p = path.join(ROOT, f);
    fs.writeFileSync(p, inject(fs.readFileSync(p, 'utf8'), base + '/' + f));
    touched++;
  });

  // Дата збірки — сьогоднішня: lastmod без реальної дати змісту все одно
  // приблизний, і це чесніше за вигадану точність до файлу.
  const today = new Date().toISOString().slice(0, 10);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    PAGES.map(function (p) {
      return '  <url>\n' +
             '    <loc>' + base + '/' + p.file + '</loc>\n' +
             '    <lastmod>' + today + '</lastmod>\n' +
             '    <changefreq>' + p.changefreq + '</changefreq>\n' +
             '    <priority>' + p.priority + '</priority>\n' +
             '  </url>';
    }).join('\n') +
    '\n</urlset>\n';
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);

  // robots.txt має вказувати на sitemap реальним доменом, а не плейсхолдером
  const robotsPath = path.join(ROOT, 'robots.txt');
  let robots = fs.readFileSync(robotsPath, 'utf8');
  robots = robots.replace(/^\s*#?\s*Sitemap:.*$/mi, 'Sitemap: ' + base + '/sitemap.xml');
  if (!/^Sitemap:/mi.test(robots)) robots = robots.trimEnd() + '\nSitemap: ' + base + '/sitemap.xml\n';
  fs.writeFileSync(robotsPath, robots);

  console.log('Домен: ' + base);
  console.log('Сторінок оброблено: ' + touched);
  console.log('sitemap.xml: ' + PAGES.length + ' адрес');
  console.log('robots.txt: рядок Sitemap оновлено');
}

main();
