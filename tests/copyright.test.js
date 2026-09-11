/**
 * ПРАВОВЛАСНИК НАЗВАНИЙ ОДНАКОВО СКРІЗЬ.
 *
 * Імʼя автора лежить у чотирьох місцях: LICENSE, js/config.js (звідки
 * його бере підвал сайту), розділ «Авторське право» в legal.html і
 * метатеги кожної сторінки. Це рівно та сама вада, від якої лікує решта
 * правил цього проєкту: одна річ, записана в чотирьох файлах, розходиться
 * на першій же правці — а розходження саме тут коштує найдорожче.
 * Напис «© 2026 Хтось Інший» на одній сторінці з двадцяти двох
 * знецінює весь інший підпис.
 *
 * Тому джерело одне — js/config.js — а тест стереже, щоб решта його не
 * пережила.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Автор із config.js — те саме джерело, з якого його бере сайт. */
const AUTHOR = (/author:\s*'([^']+)'/.exec(read('js/config.js')) || [])[1];

const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

describe('підпис автора', () => {
  test('автор заданий у config.js', () => {
    assert.ok(AUTHOR && AUTHOR.length > 2, 'author = ' + AUTHOR);
  });

  test('LICENSE існує й називає того самого автора', () => {
    const lic = read('LICENSE');
    assert.ok(lic.includes(AUTHOR), 'у LICENSE немає «' + AUTHOR + '»');
    /* Це не відкритий код — і так має бути написано прямо, інакше
       відсутність слова «не» читається як дозвіл. */
    assert.match(lic, /НЕ ВІДКРИТЕ|NOT OPEN SOURCE/);
  });

  test('у legal.html є розділ про авторське право з тим самим імʼям', () => {
    const legal = read('legal.html');
    assert.match(legal, /id="copyright"/);
    assert.ok(legal.includes(AUTHOR), 'у legal.html немає «' + AUTHOR + '»');
  });

  test('на розділ можна перейти зі списку документів', () => {
    assert.match(read('legal.html'), /href="#copyright"/);
  });

  test('підвал сайту бере імʼя з config, а не з коду', () => {
    const app = read('js/app.js');
    assert.match(app, /CFG\.author/);
    /* Рік — із годинника: зашите число стає неправдою 1 січня. */
    assert.match(app, /getFullYear\(\)/);
  });

  test('кожна сторінка підписана метатегами', () => {
    const bad = PAGES.filter((f) => {
      const s = read(f);
      return !s.includes('name="author"') || !s.includes('name="copyright"');
    });
    assert.equal(bad.join(', '), '', 'без підпису: ' + bad.join(', '));
  });

  test('у метатегах саме той автор', () => {
    const bad = PAGES.filter((f) => !read(f).includes('content="' + AUTHOR + '"'));
    assert.equal(bad.join(', '), '', 'інший автор у: ' + bad.join(', '));
  });

  test('знак у logo-mark.svg теж підписаний', () => {
    const svg = read('logo-mark.svg');
    assert.match(svg, /<metadata>/);
    assert.ok(svg.includes(AUTHOR), 'у logo-mark.svg немає «' + AUTHOR + '»');
  });

  test('підпис доїжджає у фавікон, зібраний із того самого знака', () => {
    /* favicon.svg збирає tools/icons.mjs, копіюючи вміст logo-mark.svg.
       Якщо колись копіювання почне викидати metadata — тест це покаже. */
    assert.ok(read('favicon.svg').includes(AUTHOR));
  });
});
