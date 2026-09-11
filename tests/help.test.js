/**
 * Контекстна довідка.
 *
 * ГОЛОВНЕ, ЩО ТУТ СТЕРЕЖЕТЬСЯ, — не «текст красивий», а «текст не бреше».
 *
 * Аудит 2026-09 знайшов у проєкті десяток пояснень, які колись були
 * правдою: README про 226 тестів при 483, RELEASE.md про відсутній
 * service worker при наявному sw.js, journal.html про 12 тижнів при семи
 * місяцях у коді. Довідка на двадцять розділів — найзручніше місце
 * завести ще двадцять таких. Тому:
 *
 *   1. кожна сторінка з шапкою має свій розділ (інакше кнопка відкриває
 *      порожнє вікно або ховається без причини);
 *   2. у текстах немає чисел економіки ELO, вписаних руками;
 *   3. таблиця ELO дає рівно ті числа, які нараховує js/elo-core.js на
 *      тому самому конфігу.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CFG = JSON.parse(read('db/elo-config.json'));

/**
 * Довідка в пісочниці.
 *
 * js/help.js на верхньому рівні чіпає document — тому підробка мусить
 * мати рівно ті методи, які він кличе при завантаженні. DOM-частина
 * (вікно, фокус, Escape) перевіряється в браузері: tools/verifyhelp.mjs.
 */
function loadHelp(eloState) {
  const listeners = {};
  const sandbox = {
    console, Math, Date, JSON, Number, String, Array, Object, Boolean, Error, setTimeout,
    location: { pathname: '/index.html' },
    document: {
      readyState: 'complete',
      addEventListener: (t, f) => { listeners[t] = f; },
      querySelectorAll: () => []
    },
    window: {}
  };
  sandbox.globalThis = sandbox;
  sandbox.window.EloApi = {
    cached: () => eloState || null,
    available: () => Boolean(eloState),
    refresh: () => Promise.resolve(eloState)
  };
  vm.createContext(sandbox);
  vm.runInContext(read('js/elo-core.js'), sandbox, { filename: 'js/elo-core.js' });
  vm.runInContext(read('js/help-content.js'), sandbox, { filename: 'js/help-content.js' });
  vm.runInContext(read('js/help.js'), sandbox, { filename: 'js/help.js' });
  return sandbox.window;
}

/** Усі рядки вмісту одним масивом — щоб шукати в них числа. */
function allText(node, out) {
  out = out || [];
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => allText(n, out)); return out; }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((k) => allText(node[k], out));
  }
  return out;
}

describe('Довідка: покриття сторінок', () => {
  /* Сторінки з шапкою — саме там є кнопка довідки. */
  const PAGES = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html'))
    .filter((f) => read(f).indexOf('js/app.js') !== -1)
    .sort();

  const W = loadHelp(null);

  test('кожна сторінка з шапкою має свій розділ', () => {
    const missing = PAGES.filter((f) => !W.HELP_CONTENT.sections[f]);
    assert.equal(missing.length, 0,
      'без довідки лишились: ' + missing.join(', ') +
      ' — або допишіть розділ, або приберіть js/help.js зі сторінки');
  });

  test('немає розділів для сторінок, яких не існує', () => {
    const stray = Object.keys(W.HELP_CONTENT.sections).filter((k) => PAGES.indexOf(k) === -1);
    assert.equal(stray.length, 0, 'зайві розділи: ' + stray.join(', '));
  });

  test('у кожного розділу є заголовок, вступ і блоки', () => {
    const bad = [];
    Object.keys(W.HELP_CONTENT.sections).forEach((k) => {
      const s = W.HELP_CONTENT.sections[k];
      if (!s.title || !s.lead || !Array.isArray(s.blocks) || !s.blocks.length) bad.push(k);
    });
    assert.equal(bad.length, 0, 'неповні розділи: ' + bad.join(', '));
  });

  test('розділи не однакові між собою', () => {
    /* Сенс контекстної довідки в тому, що вона різна. Однаковий вступ на
       двох сторінках означає, що хтось скопіював блок і забув переписати. */
    const leads = Object.keys(W.HELP_CONTENT.sections).map((k) => W.HELP_CONTENT.sections[k].lead);
    assert.equal(new Set(leads).size, leads.length, 'знайшлись однакові вступи');
  });

  test('«Про Get Stronger» є і не підміняє контекстну довідку', () => {
    assert.ok(W.HELP_CONTENT.about.title);
    assert.ok(W.HELP_CONTENT.about.blocks.length >= 4);
    /* Він мусить називати межі системи — інакше це реклама, а не довідка. */
    const txt = allText(W.HELP_CONTENT.about).join(' ');
    assert.match(txt, /не може/i, 'у «Про Get Stronger» немає розділу про обмеження');
  });
});

describe('Довідка: чисел економіки ELO в тексті немає', () => {
  const W = loadHelp(null);

  test('значення з elo-config не вписані руками в розділ рейтингу', () => {
    /*
     * Перевіряється саме розділ рейтингу: там і тільки там ці числа щось
     * означають. Ширша перевірка ловила б «схема на 3 дні» й «100–200
     * ккал» на інших сторінках — тобто числа, які до балансу стосунку не
     * мають, і тест перетворився б на перешкоду.
     *
     * Якщо баланс змінять, а число стоятиме тут словами, довідка почне
     * брехати мовчки — і помітить це користувач, а не збірка.
     */
    const WATCH = {
      weeklyBudget: CFG.weeklyBudget,
      cleanDayBonus: CFG.cleanDayBonus,
      cleanWeekBonus: CFG.cleanWeekBonus,
      missedWorkoutPenalty: Math.abs(CFG.missedWorkoutPenalty),
      dayGainCap: CFG.dayGainCap,
      seasonMax: CFG.seasonMax,
      levelSize: CFG.levelSize,
      levelCount: CFG.levelCount,
      eliteFloor: CFG.eliteFloor,
      graceDays: CFG.graceDays,
      submitWindowDays: CFG.submitWindowDays
    };
    const text = allText(W.HELP_CONTENT.sections['rating.html']).join(' ');
    const found = [];
    Object.keys(WATCH).forEach((k) => {
      const n = String(WATCH[k]);
      /* Число як окреме слово: «200» ловимо, «2000-х» — ні. */
      if (new RegExp('(^|[^\\d])' + n + '([^\\d]|$)').test(text)) found.push(k + ' (' + n + ')');
    });
    assert.equal(found.length, 0,
      'у тексті розділу «Рейтинг» стоять числа з конфігу: ' + found.join(', ') +
      ' — їх треба брати з конфігу блоком { t: "dyn" }, а не писати словами');
  });

  test('розділ рейтингу спирається на обчислювані блоки', () => {
    const rating = W.HELP_CONTENT.sections['rating.html'];
    const dyn = rating.blocks.filter((b) => b.t === 'dyn').map((b) => b.build);
    assert.ok(dyn.length >= 4, 'у рейтингу мало обчислюваних блоків: ' + dyn.join(', '));
    dyn.forEach((name) => {
      assert.ok(W.Help.block(name), 'немає збирача для блоку ' + name);
    });
  });
});

describe('Довідка: таблиця ELO дорівнює тому, що нараховує ядро', () => {
  const state = { config: CFG, plannedWeek: 3 };
  const W = loadHelp(state);
  const core = W.EloCore;

  /** Знайти рядок таблиці за початком першої клітинки. */
  function row(blocks, startsWith) {
    const table = blocks.find((b) => b.t === 'table');
    assert.ok(table, 'у блоці немає таблиці');
    const r = table.rows.find((x) => x[0].indexOf(startsWith) === 0);
    assert.ok(r, 'немає рядка «' + startsWith + '»');
    return r;
  }

  test('тренування: число з таблиці дорівнює дельті ядра', () => {
    const blocks = W.Help.block('eloActions');
    const expected = core.actionDelta('workout', { totalSets: 10, doneSets: 10 }, CFG,
                                      { plannedDays: 3 }).delta;
    assert.equal(row(blocks, 'Тренування закрито повністю')[1], '+' + expected);
  });

  test('половина підходів — половина вартості', () => {
    const blocks = W.Help.block('eloActions');
    const full = core.actionDelta('workout', { totalSets: 10, doneSets: 10 }, CFG, { plannedDays: 3 }).delta;
    const half = core.actionDelta('workout', { totalSets: 10, doneSets: 5 }, CFG, { plannedDays: 3 }).delta;
    assert.equal(row(blocks, 'Тренування закрито наполовину')[1], '+' + half);
    assert.ok(half < full, 'половина має коштувати менше за ціле');
  });

  test('число тренування залежить від плану, а не прибите', () => {
    /* Саме тому таблиця й обчислюється: при плані 6 те саме тренування
       коштує менше, і текст «+17» був би брехнею для цієї людини. */
    const w3 = loadHelp({ config: CFG, plannedWeek: 3 }).Help.block('eloActions');
    const w6 = loadHelp({ config: CFG, plannedWeek: 6 }).Help.block('eloActions');
    const a = row(w3, 'Тренування закрито повністю')[1];
    const b = row(w6, 'Тренування закрито повністю')[1];
    assert.notEqual(a, b, 'таблиця не помічає плану — значить, число зашите');
  });

  test('сон, кроки й самопочуття теж із ядра', () => {
    const blocks = W.Help.block('eloActions');
    assert.equal(row(blocks, 'Сон записано')[1],
      '+' + core.actionDelta('sleep', { minutes: 480, goal: 480 }, CFG).delta);
    assert.equal(row(blocks, 'Кроки записано')[1],
      '+' + core.actionDelta('activity', { steps: 10000, goal: 10000 }, CFG).delta);
    assert.equal(row(blocks, 'Самопочуття відмічено')[1],
      '+' + core.actionDelta('recovery', { value: 1 }, CFG).delta);
  });

  test('бонуси й штрафи — з конфігу', () => {
    const blocks = W.Help.block('eloBonuses');
    assert.equal(row(blocks, 'Чистий день')[1], '+' + CFG.cleanDayBonus);
    assert.equal(row(blocks, 'Чистий тиждень')[1], '+' + CFG.cleanWeekBonus);
    assert.equal(row(blocks, 'Пропущене тренування')[1], String(CFG.missedWorkoutPenalty));
    assert.match(row(blocks, 'Стеля дня')[1], new RegExp(String(CFG.dayGainCap)));
  });

  test('рівнів рівно стільки, скільки в конфігу, плюс ELITE', () => {
    const blocks = W.Help.block('eloLevels');
    const table = blocks.find((b) => b.t === 'table');
    assert.equal(table.rows.length, CFG.levelCount + 1);
    assert.equal(table.rows[CFG.levelCount][0], 'ELITE');
  });

  test('без конфігу таблиць немає, а є чесне пояснення', () => {
    const blocks = loadHelp(null).Help.block('eloActions');
    assert.equal(blocks.filter((b) => b.t === 'table').length, 0);
    assert.ok(blocks.some((b) => b.t === 'note'), 'мусить лишитись пояснення, чому чисел немає');
  });
});
