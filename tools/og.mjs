/**
 * Перемальовує og-image.png — картинку, яку показують месенджери й соцмережі.
 * Запуск: node tools/og.mjs
 *
 * ЧОМУ ШРИФТИ ЛЕЖАТЬ ПОРУЧ (tools/fonts). Перша версія малювалась через SVG
 * з font-family="Archivo Black": у headless-браузері такого шрифту немає,
 * тексту мовчки підставлявся системний гротеск — і в превʼю стояло «FORGE»
 * зовсім іншим шрифтом, ніж у шапці сайту. Помилка тиха: картинка
 * генерується без жодної помилки, просто не тим шрифтом. Тому файли
 * підшиті в сторінку через @font-face як data:-URI, а рендер падає,
 * якщо шрифт не завантажився.
 *
 * ГЕОМЕТРІЯ повторює шапку: знак ковадла у своєму сірому #8b8b93, слово
 * білим Archivo Black з тим самим трекінгом 0.10em.
 *
 * ПІСЛЯ ЗМІНИ КАРТИНКИ треба підняти ?v= у og:image на всіх сторінках:
 * Telegram і решта кешують малюнок за адресою, і при тій самій адресі
 * показуватимуть старий, скільки б файл не перезбирали.
 *
 * ПІДПИСУ ПІД СЛОВОМ НЕМАЄ. Він дублював og:description, який месенджер
 * і так друкує окремим рядком просто над картинкою, — та сама фраза
 * стояла двічі поспіль. Без нього знак і слово займають усю висоту.
 *
 * РОЗМІР обмежений не шириною 1200, а центральним квадратом 630×630:
 * дрібні превʼю на деяких платформах ріжуть картку до квадрата, і все,
 * що вилізло за нього, зникає. Тому слово при 128px із трекінгом
 * лишається близько 545px завширшки — із запасом.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const F = (n) => readFileSync(new URL('./fonts/' + n, import.meta.url)).toString('base64');
const AB = F('archivo-black.woff2'), IL = F('inter-lat.woff2'), IC = F('inter-cyr.woff2');

/* Той самий шлях, що в logo-mark.svg — знак не перемальовується. */
const MARK = `<svg viewBox="4 12 57 41" width="376" height="270" aria-hidden="true">
  <path fill="#8b8b93" d="M4 21 C10 15 15 12 20 12 L57 12 Q61 12 61 16 L61 22 Q61 26 57 26 L46 26
  C44 29 43.5 32 43.5 36 C43.5 39 46 40.5 50 41 L52 41 L54 53 L14 53 L16 41 L18 41
  C22 40.5 24.5 39 24.5 36 C24.5 32 24 29 22 26 L20 26 C15 26 8.5 24.5 4 21 Z"/>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family:"Archivo Black"; font-weight:400;
  src:url(data:font/woff2;base64,${AB}) format("woff2"); }
@font-face { font-family:"Inter"; font-weight:400;
  src:url(data:font/woff2;base64,${IL}) format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+2122; }
@font-face { font-family:"Inter"; font-weight:400;
  src:url(data:font/woff2;base64,${IC}) format("woff2");
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
html,body { margin:0; padding:0; width:1200px; height:630px; background:#000; }
body { display:flex; flex-direction:column; align-items:center; justify-content:center; }
svg { display:block; margin-bottom:40px; margin-top:24px; }
/* Відʼємне праве поле компенсує трекінг після останньої літери — інакше
   слово стоїть на пів-пробіла правіше за оптичний центр. */
.word { font-family:"Archivo Black",sans-serif; font-size:138px; line-height:1;
  letter-spacing:0.10em; margin-right:-0.10em; color:#ffffff; }
</style></head><body>
${MARK}
<div class="word">FORGE</div>
</body></html>`;

const tmp = '/tmp/forge-og.html';
writeFileSync(tmp, html);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto('file://' + tmp, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
const okFont = await p.evaluate(() => document.fonts.check('138px "Archivo Black"'));
if (!okFont) { await b.close(); throw new Error('Archivo Black не завантажився — картинку не перемальовано'); }
await p.screenshot({ path: new URL('../og-image.png', import.meta.url).pathname });
await b.close();
console.log('og-image.png перемальовано, шрифт на місці');
