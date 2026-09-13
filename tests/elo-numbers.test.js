/**
 * ЧИСЛА ШКАЛИ ELO НЕ ПИШУТЬСЯ СЛОВАМИ.
 *
 * ПРИВІД РЕАЛЬНИЙ, І ВІН БУВ ЗЕЛЕНИМ. У вересні 2026 баланс перебалансували
 * (elo_pace_level_curve): стеля сезону 2500 → 3000, поріг ELITE 2000 → 2400,
 * розмір рівня 200 → 240. Конфіг змінився, сервер змінився, шкала на екрані
 * змінилась — а текст на rating.html і далі казав «стеля 2500», «Понад
 * 2000 — ELITE», «по 200 до Level 10 = 1800–1999». Місяць поспіль сторінка
 * показувала людині шкалу до 3000 і поруч пояснювала, що стеля 2500.
 *
 * Жоден тест цього не бачив: tests/help.test.js стереже ПОТОЧНІ числа
 * конфігу в довідці (щоб їх не вписали руками), але застаріле число вже не
 * дорівнює конфігу — і тому крізь ту перевірку проходить. Тобто рівно той
 * стан, який треба ловити, був невидимий за побудовою.
 *
 * ПРАВИЛО ТУТ ІНШЕ Й ПРОСТІШЕ: у текстах, які пояснюють шкалу, число не
 * може стояти ПОРУЧ зі словом про шкалу. Немає числа — нема чому застаріти.
 * Точні межі показує сама сторінка (шкала рівня рахується з конфігу) і
 * довідка, де вони збираються блоками { t: 'dyn' }.
 *
 * Що НЕ забороняється: числа, які до шкали не стосуються — «тисне 140 кг»,
 * «Top 1000» (це назва нагороди, а не межа балансу), «12–14 тижнів».
 * Забороняється саме сусідство: число поряд зі словом ELO, Level, ELITE,
 * «рівень» або «стеля».
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/*
 * Вікно сусідства — 14 символів. Більше почало б ловити сусідні речення
 * («…за місце в таблиці. 140 кг…»), менше пропустило б «ELITE-зона після
 * 2000». Крапка у вікно не входить навмисно: за межею речення це вже
 * інша думка.
 */
const NEAR = new RegExp(
  '(?:ELO|Level|ELITE|рівн|стел)[^.!?]{0,14}?\\d{3,}' +
  '|\\d{3,}[^.!?]{0,14}?(?:ELO|Level|ELITE|рівн|стел)', 'gi');

function hits(text) {
  return [...new Set((String(text).match(NEAR) || []).map((x) => x.replace(/\s+/g, ' ').trim()))];
}

/** Видимий текст сторінки: розмітка й коментарі не рахуються. */
function pageText(file) {
  const html = read(file);
  const body = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  return body.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
}

function metaDescription(file) {
  const m = read(file).match(/<meta name="description" content="([^"]*)"/);
  return m ? m[1] : '';
}

/** Довідка в пісочниці — той самий прийом, що в tests/help.test.js. */
function helpSections() {
  const sandbox = {
    console, Math, Date, JSON, Number, String, Array, Object, Boolean, Error, setTimeout,
    location: { pathname: '/index.html' },
    document: { readyState: 'complete', addEventListener: () => {}, querySelectorAll: () => [] },
    window: {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('js/elo-core.js'), sandbox, { filename: 'js/elo-core.js' });
  vm.runInContext(read('js/help-content.js'), sandbox, { filename: 'js/help-content.js' });
  return sandbox.window.HELP_CONTENT.sections;
}

function allText(node, out) {
  out = out || [];
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => allText(n, out)); return out; }
  if (node && typeof node === 'object') Object.keys(node).forEach((k) => allText(node[k], out));
  return out;
}

const PAGES = ['rating.html', 'seasons.html', 'awards.html', 'index.html'];

describe('Шкала ELO: чисел у поясненнях немає', () => {
  PAGES.forEach((file) => {
    test('розмітка ' + file + ' не називає меж шкали числом', () => {
      const bad = hits(pageText(file));
      assert.equal(bad.join(' | '), '',
        file + ': число поруч зі словом про шкалу — ' + bad.join(' | ') +
        '. Межі шкали рахуються з db/elo-config.json; у тексті їм не місце, ' +
        'бо при перебалансі текст лишиться старим і ніхто цього не побачить.');
    });

    test('опис ' + file + ' для пошуку теж без чисел шкали', () => {
      const bad = hits(metaDescription(file));
      assert.equal(bad.join(' | '), '', file + ' (meta description): ' + bad.join(' | '));
    });
  });

  test('довідка про рейтинг, сезони й нагороди — теж без чисел шкали', () => {
    const S = helpSections();
    const bad = [];
    ['rating.html', 'seasons.html', 'awards.html'].forEach((k) => {
      hits(allText(S[k]).join(' ')).forEach((h) => bad.push(k + ': ' + h));
    });
    assert.equal(bad.join(' | '), '',
      'у довідці стоять межі шкали числом — ' + bad.join(' | ') +
      '. Для чисел є блоки { t: "dyn" }, які беруть їх із конфігу.');
  });
});

describe('Перевірка сусідства справді ловить те, для чого написана', () => {
  /*
   * Без цього тесту попередні шість — просто шість зелених галочок:
   * помилку в регулярці ніхто б не помітив, а вона ж і є вся перевірка.
   * Зліва — рядки, які реально стояли на rating.html до вересня 2026.
   */
  test('старий текст сторінки був би червоним', () => {
    [
      'Сезонний рейтинг Get Stronger: три місяці, старт із 0 ELO, стеля 2500.',
      'Рівні рівномірні: Level 1 = 0–199, і так по 200 до Level 10 = 1800–1999.',
      'Понад 2000 — ELITE: рівень уже не росте.',
      'Сезон, у якому ви перетнули 2000 ELO.',
      '0–2500 ELO за три місяці, 10 рівнів, ELITE-зона після 2000'
    ].forEach((s) => {
      assert.ok(hits(s).length > 0, 'не впіймано: ' + s);
    });
  });

  test('а звичайні числа поруч лишаються дозволеними', () => {
    [
      'чоловік, який тисне 60 кг за планом, і той, хто тисне 140 абияк',
      'Top 1000 — тисяча сезону',
      'Через це сезон триває 12–14 тижнів, а не рівно квартал.',
      'Активних днів: 120 із 184'
    ].forEach((s) => {
      assert.equal(hits(s).join(' | '), '', 'хибна тривога: ' + s);
    });
  });
});
