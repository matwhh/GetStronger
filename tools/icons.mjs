/**
 * Перемальовує ВСІ іконки застосунку з одного джерела — logo-mark.svg.
 * Запуск: node tools/icons.mjs
 *
 * НАВІЩО ОКРЕМИЙ ІНСТРУМЕНТ. Іконок шість, і раніше кожна жила своїм
 * життям: контур знака лежав окремою копією у favicon.svg, ще однією в
 * tools/og.mjs, а PNG-и хтось колись експортував руками й більше не
 * чіпав. Будь-яка зміна знака означала шість ручних операцій, тож на
 * практиці не робилась жодна, і набір розходився.
 *
 * ЩО РОБИТЬСЯ. Знак читається з logo-mark.svg, кладеться на чорне
 * скруглене тло й знімається у потрібних розмірах.
 *
 * ПРО MASKABLE. Android обрізає іконку під форму, яку обере виробник —
 * коло, крапля, скруглений квадрат. Гарантовано видно тільки центральні
 * 80% ширини (safe zone). Тому в maskable знак дрібніший і тло суцільне
 * до самого краю: інакше в кружечку від торса лишаться самі плечі.
 *
 * ПРО ФАВІКОН. favicon.svg збирається тут же, з того самого файла, і
 * більше не тримає власної копії контуру.
 *
 * ЧОГО ТУТ НЕМАЄ. favicon.ico — його формат браузер вимагає лише для
 * старих версій і закладок, і зібрати його headless-браузером не можна.
 * Він робиться з icons/icon-512.png окремо (Pillow: Image.save у форматі
 * ICO з розмірами 16/32/48/64) і в звичайному циклі правок не потрібен —
 * досить, коли змінюється сам знак.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { CHROME } from './pw.mjs';

const root = new URL('../', import.meta.url);
const mark = readFileSync(new URL('logo-mark.svg', root), 'utf8');

/* Розмір знака в частках сторони і радіус тла в частках сторони. */
const SET = [
  { out: 'icons/icon-32.png',            size: 32,  fill: 0.78, r: 0.18 },
  { out: 'icons/icon-192.png',           size: 192, fill: 0.72, r: 0.22 },
  { out: 'icons/icon-512.png',           size: 512, fill: 0.72, r: 0.22 },
  { out: 'icons/apple-touch-icon.png',   size: 180, fill: 0.72, r: 0 },
  /* iOS сам скруглює apple-touch-icon, тому радіус 0: інакше кути
     обрізаються двічі й по краю лишається чорна облямівка. */
  { out: 'icons/icon-maskable-512.png',  size: 512, fill: 0.52, r: 0 }
];

const page = (size, fill, r) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent}
  .bg{width:${size}px;height:${size}px;background:#000;border-radius:${Math.round(size * r)}px;
      display:flex;align-items:center;justify-content:center}
  .bg svg{width:${Math.round(size * fill)}px;height:${Math.round(size * fill)}px;display:block}
</style>
<div class="bg">${mark}</div>`;

const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ deviceScaleFactor: 1 });
for (const s of SET) {
  await p.setViewportSize({ width: s.size, height: s.size });
  await p.setContent(page(s.size, s.fill, s.r), { waitUntil: 'load' });
  await p.screenshot({ path: new URL(s.out, root).pathname, omitBackground: true });
  console.log('  ' + s.out + '  ' + s.size + '×' + s.size);
}
await b.close();

/* Фавікон — той самий знак, без другої копії контуру. */
const inner = mark
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();
const vb = /viewBox="([^"]+)"/.exec(mark);
if (!vb) throw new Error('у logo-mark.svg немає viewBox — фавікон не зібрати');
const [, , vw, vh] = vb[1].split(/\s+/).map(Number);
const side = Math.max(vw, vh);
const k = 64 * 0.72 / side;
const off = (64 - side * k) / 2;

writeFileSync(new URL('favicon.svg', root),
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- ЗБИРАЄТЬСЯ tools/icons.mjs із logo-mark.svg. Руками не правити:
       наступний прогін перезапише. Знак тут той самий, що в шапці, на
       іконці застосунку й у превʼю посилання — однією копією на всіх. -->
  <rect width="64" height="64" rx="14" fill="#000000"/>
  <g transform="translate(${off.toFixed(3)} ${off.toFixed(3)}) scale(${k.toFixed(5)})">
${inner}
  </g>
</svg>
`);
console.log('  favicon.svg');
console.log('Іконки перемальовано з logo-mark.svg');
