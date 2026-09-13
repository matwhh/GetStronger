#!/usr/bin/env node
/**
 * Проставити `og:url` у СТАТИЧНУ розмітку сторінок.
 *
 * НАВІЩО ЦЕ ПОТРІБНО
 * ------------------
 * js/app.js уміє додати og:url із config.siteUrl, але робить це після
 * виконання JavaScript. Для браузера це прийнятно, а для краулерів превʼю
 * в месенджерах — ні: Telegram, Slack, WhatsApp, Signal JS не виконують
 * узагалі. Без og:url посилання на сайт відкривалось у чаті без картки, і
 * жодне заповнення config.siteUrl цього не міняло.
 *
 * ЧОГО ТУТ БІЛЬШЕ НЕМАЄ І ЧОМУ (13.09.2026)
 * -----------------------------------------
 * Скрипт раніше вписував ще й `<link rel="canonical">`, збирав `sitemap.xml`
 * і дописував рядок `Sitemap:` у robots.txt. Усе троє — інструменти ПОШУКУ,
 * а Get Stronger у пошук не йде: vercel.json віддає
 * `X-Robots-Tag: noindex, nofollow` на кожну адресу.
 *
 * Тобто половина цього файла обслуговувала те, що вимкнене заголовком, —
 * і, що гірше, брехала наступному читачеві: у переліку сторінок стояв
 * коментар «Сторінки, які має бачити пошук». Рішення ухвалене свідомо:
 * сайт приватний, для вузького кола, і індексації не хоче. Тому апарат
 * прибрано, а не полагоджено.
 *
 * og:* лишається, і це не суперечність: превʼю в месенджері — не пошук.
 * `X-Robots-Tag` краулери превʼю не читають, вони просто тягнуть сторінку
 * заради картки. Саме тому og:image лежить статично, а не додається з JS.
 *
 * ЯК КОРИСТУВАТИСЬ
 * ----------------
 *   1. Впиши домен у js/config.js -> siteUrl
 *   2. node tools/build-meta.js
 *   3. Виклади сайт
 *
 * Скрипт ідемпотентний: повторний запуск оновлює вже проставлений тег,
 * а не додає другий. Запуск без siteUrl — навпаки, ПРИБИРАЄ теги, щоб у
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
    '\n<meta property="og:url" content="' + url + '">' +
    '\n' + MARK_CLOSE;
  // Перед </head>: точне місце значення не має, головне — всередині head.
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
    console.log('siteUrl порожній у js/config.js.');
    console.log('Прибрано теги зі сторінок: ' + cleaned + '.');
    console.log('Впиши домен у config.js і запусти знову.');
    return;
  }

  let touched = 0;
  all.forEach(function (f) {
    const p = path.join(ROOT, f);
    fs.writeFileSync(p, inject(fs.readFileSync(p, 'utf8'), base + '/' + f));
    touched++;
  });

  console.log('Домен: ' + base);
  console.log('Сторінок оброблено: ' + touched);
}

main();
