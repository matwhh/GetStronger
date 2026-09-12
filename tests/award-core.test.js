/**
 * КАРТКА НАГОРОДИ.
 *
 * Стережеться не малюнок, а три речі, які ламаються мовчки:
 *
 * 1. НЕВІДОМИЙ КОД НЕ ЛАМАЄ ЕКРАН. Нагороди видає сервер; він може
 *    видати код, про який ця версія сайту ще не знає (нову нагороду
 *    додали в базу раніше, ніж викотили сайт). Картка мусить показати
 *    підпис із самої нагороди, а не «undefined» і не порожнечу.
 *
 * 2. ТЕКСТ ЕКРАНУЄТЬСЯ. `label` приходить із бази, тобто ззовні. Один
 *    неекранований лапка-кут у ньому — і розмітка картки розʼїжджається,
 *    а в гіршому випадку в атрибут заїжджає чужий обробник.
 *
 * 3. ОБИДВА БОКИ ДОСТУПНІ ЧИТАЛЦІ. Зворотний бік видно тільки після
 *    перевороту, а читалка перевертати не вміє — тому весь текст мусить
 *    бути в aria-label.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { Award } = loadModules(['js/date-core.js', 'js/award-core.js']);

test('сервер віддає kind, а не code — картка мусить читати саме його', () => {
  /* elo_history: jsonb_build_object('season', …, 'kind', kind, 'label', …).
     Читання a.code давало undefined, і кожна нагорода малювалась як
     невідома — тихо, без жодної помилки в консолі. */
  const h = Award.html({ kind: 'beta', label: 'Бета' });
  assert.match(h, /BETA/);
  assert.match(h, /Учасник бета-версії/);
  assert.match(h, /awd--beta/);
});

test('code лишається запасним варіантом', () => {
  const h = Award.html({ code: 'beta', label: 'Бета' });
  assert.match(h, /BETA/);
  assert.match(h, /Учасник бета-версії/);
  assert.match(h, /awd--beta/);
});

test('невідомий код показує підпис із самої нагороди, а не undefined', () => {
  const h = Award.html({ code: 'zzz-майбутня', label: 'Щось нове' });
  assert.match(h, /Щось нове/);
  assert.doesNotMatch(h, /undefined/);
  assert.doesNotMatch(h, /null/);
});

test('нагорода зовсім без полів не валить рендер', () => {
  const h = Award.html({});
  assert.equal(typeof h, 'string');
  assert.ok(h.length > 0);
  assert.doesNotMatch(h, /undefined/);
});

test('текст із бази екранується', () => {
  const h = Award.html({ code: 'невідомий', label: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});

test('код нагороди теж екранується — з нього збирається клас', () => {
  const h = Award.html({ code: '"><script>', label: 'x' });
  assert.doesNotMatch(h, /<script>/);
});

test('те, чого не видно очима, лежить в aria-label', () => {
  /* Лице картки — чорна діра без жодного слова, зворот — знак і назва.
     Читалка перевертати не вміє, тож мусить отримати все одразу. */
  const h = Award.html({ code: 'beta' });
  const m = h.match(/aria-label="([^"]*)"/);
  assert.ok(m, 'aria-label є');
  assert.match(m[1], /BETA/);
  assert.match(m[1], /Учасник бета-версії/);
});

test('лице — чорна діра, зворот — знак і назва, більше нічого', () => {
  const h = Award.html({ code: 'beta' });
  assert.match(h, /awd__face--front/);
  assert.match(h, /awd__face--back/);
  assert.match(h, /awd__hole/, 'чорна діра на лиці');
  assert.equal((h.match(/awd__ring/g) || []).length, 10, 'десять кілець — стільки ж, скільки в першоджерела');
  assert.match(h, /awd__mark/, 'знак на звороті');
  /* Старі шари прибрані. Якщо котрийсь повернеться — картка перестане
     бути тим, про що домовлялись. */
  assert.doesNotMatch(h, /awd__eyebrow|awd__hint|awd__text|awd__ico|awd__glow/);
});

test('знак Get Stronger, а не типова шестерня з набору іконок', () => {
  const h = Award.html({ code: 'beta' });
  /* viewBox знака — 1022×1043; будь-яка «іконка налаштувань» із набору
     була б 24×24. */
  assert.match(h, /viewBox="0 0 1022 1043"/);
  assert.match(h, /currentColor/, 'колір із теми, а не зашитий чорний');
});

test('кліп-маски знака унікальні: інакше другий візьме маску першого', () => {
  const a = Award.html({ code: 'beta' });
  const b = Award.html({ code: 'first' });
  const ids = (a + b).match(/awd-gear-\d+/g) || [];
  assert.ok(ids.length >= 4, 'id є в кожній картці двічі: defs і посилання');
  assert.equal(new Set(ids).size, 2, 'по одному унікальному id на картку');
});

test('сезон підписується переданою функцією, а не сирим кодом', () => {
  const h = Award.html({ code: 'first', season: 'AUTUMN-2026' },
    { seasonLabel: (s) => 'Осінь 2026' });
  assert.match(h, /Осінь 2026/);
  /*
   * Сирий код сезону лишається В АТРИБУТІ — по ньому фільтрує сторінка
   * нагород, і розбирати заради цього людський підпис означало б
   * тримати «Осінь 2026» як другий, неписаний формат даних. Тому
   * перевіряємо те, що й перевірялось по суті: код не витікає в ТЕКСТ,
   * який людина читає.
   */
  const text = h.replace(/<[^>]*>/g, ' ');
  assert.doesNotMatch(text, /AUTUMN-2026/);
  assert.match(h, /data-season="AUTUMN-2026"/);
});

test('назва потрапляє на зворот', () => {
  assert.match(Award.html({ code: 'beta' }), /class="awd__name">BETA</);
});

test('порожній список нагород не малює порожньої сітки', () => {
  assert.equal(Award.grid([]), '');
  assert.equal(Award.grid(null), '');
});

test('сітка малює стільки карток, скільки нагород', () => {
  const h = Award.grid([{ code: 'beta' }, { code: 'first' }, { code: 'top3' }]);
  assert.equal((h.match(/class="awd /g) || []).length, 3);
});

test('картка навігується з клавіатури', () => {
  assert.match(Award.html({ code: 'beta' }), /tabindex="0"/);
});

/**
 * ВИДИ НАГОРОД І ВІТРИНА.
 *
 * Перелік видів мусить збігатися з сервером: видає їх
 * elo_close_season (db/elo-engine.sql), і білий список стоїть у
 * awards_kind_check. Розбіжність не ламає екран — картка візьме підпис
 * із самої нагороди, — але виглядатиме безіменною, і помітять це вже
 * після закриття сезону, коли нагороду вже видано.
 */
test('усі види, які видає сервер, тут відомі', () => {
  /* Точний перелік із db/elo-engine.sql (elo_close_season) + beta з
     db/award-beta.sql. Оновлюючи одне, оновлюй друге. */
  const FROM_SERVER = [
    'level5', 'level7', 'level8', 'level9', 'level10',
    'elite', 'first', 'top3', 'top10', 'top100', 'top1000',
    'top10pct', 'top5pct', 'top1pct', 'beta'
  ];
  FROM_SERVER.forEach((k) => {
    assert.ok(Award.CODES[k], 'немає опису для ' + k);
    assert.ok(Award.CODES[k].name, 'немає назви для ' + k);
    assert.ok(Award.CODES[k].face, 'немає групи (face) для ' + k);
  });
  assert.equal(Award.ORDER.length, FROM_SERVER.length, 'у вітрині показані всі види');
});

test('лице каже групу ще до перевороту', () => {
  /* Однакове лице на всіх зробило б сітку нерозрізнюваною: людина
     бачила б п'ятнадцять однакових квадратів і мусила перевертати
     кожен, щоб дізнатись, що це. */
  assert.match(Award.html({ kind: 'level10' }), /awd__lvl is-l10.*>10</s);
  assert.match(Award.html({ kind: 'first' }), /awd__rank[^>]*><b>1</);
  assert.match(Award.html({ kind: 'top100' }), /<i>TOP<\/i><b>100</);
  assert.match(Award.html({ kind: 'top1pct' }), /awd__pct[^>]*><b>1<\/b><i>%</);
  assert.match(Award.html({ kind: 'elite' }), /awd__elite[^>]*>ELITE</);
  /* Бета — єдина з чорною дірою: вона поза сезонами. */
  assert.match(Award.html({ kind: 'beta' }), /awd__hole/);
});

test('перше місце — просто «1», без слова TOP', () => {
  /* «TOP 1» звужує число й нічого не додає: місце №1 не потребує
     пояснень, а решта — потребують. */
  assert.doesNotMatch(Award.html({ kind: 'first' }), /TOP/);
  assert.match(Award.html({ kind: 'top3' }), /TOP/);
});

test('невідомий код падає в чорну діру, а не в порожній квадрат', () => {
  const h = Award.html({ kind: 'zzz-майбутня', label: 'Щось нове' });
  assert.match(h, /awd__hole/);
  assert.match(h, /awd__face--hole/);
  assert.match(h, /Щось нове/);
});

test('у превʼю картка веде на сторінку нагород, а не перевертається', () => {
  /* Тап не може означати одночасно «перевернути» і «перейти». */
  const h = Award.html({ kind: 'beta' }, { href: 'awards.html' });
  assert.match(h, /^<a class="awd[^"]*" href="awards\.html"/);
  assert.doesNotMatch(h, /tabindex/, 'посилання й так у фокусі — другий tabindex зайвий');
  assert.match(h, /<\/a>$/);
});

test('на сторінці нагород картка лишається карткою', () => {
  const h = Award.html({ kind: 'beta' });
  assert.match(h, /^<article/);
  assert.match(h, /tabindex="0"/);
});

test('вітрина показує всі види: отримані як є, решту силуетами', () => {
  const h = Award.showcase([{ kind: 'beta', label: 'Бета' }]);
  assert.equal((h.match(/class="awd /g) || []).length, Award.ORDER.length);
  assert.equal((h.match(/awd--locked/g) || []).length, Award.ORDER.length - 1);
  /* Отримана бета — без силуету. */
  assert.doesNotMatch(h, /class="awd awd--beta awd--locked/);
});

test('силует каже читалці, що нагороди ще немає', () => {
  const h = Award.showcase([]);
  const m = h.match(/aria-label="([^"]*)"/);
  assert.match(m[1], /Ще не отримано/);
});

test('одна нагорода за два сезони — це дві картки', () => {
  /* «Top 3» за весну і за літо — різні речі, і згортати їх в одну
     означало б забрати половину зібраного. */
  const h = Award.showcase([
    { kind: 'top3', season: 'S1' },
    { kind: 'top3', season: 'S2' }
  ], { seasonLabel: (s) => 'Сезон ' + s.slice(1) });
  /* Клас тепер несе ще й сходинку рідкості (awd--t6), тож шукаємо
     початок рядка класів, а не його цілком. */
  assert.equal((h.match(/class="awd awd--top3 /g) || []).length, 2);
  assert.match(h, /Сезон 1/);
  assert.match(h, /Сезон 2/);
  assert.equal((h.match(/class="awd /g) || []).length, Award.ORDER.length + 1);
});

test('порожня вітрина — не порожня сітка', () => {
  /* Порожня вітрина нічого не пояснює: людина бачить «нагород немає» і
     не дізнається ні що вони бувають, ні за що їх дають. */
  const h = Award.showcase([]);
  assert.match(h, /awd-grid/);
  assert.equal((h.match(/class="awd /g) || []).length, Award.ORDER.length);
});


/* ------------------------------------------------------------------ */
/* РІДКІСНІСТЬ                                                         */
/* ------------------------------------------------------------------ */
/*
 * Вісім сходинок — це не оздоба, а шкала, і ламається вона тихо: досить
 * забути tier в одному коді, і нагорода мовчки стане «звичайною». На
 * екрані це виглядатиме як задум, а не як помилка.
 */
describe('рідкісність нагород', () => {
  test('у КОЖНОЇ нагороди є сходинка — жодної без', () => {
    const без = Award.ORDER.filter((k) => !Award.CODES[k].tier);
    assert.equal(без.join(', '), '', 'без рідкості: ' + без.join(', '));
  });

  test('сходинок вісім, і вони пронумеровані підряд', () => {
    assert.equal(Award.TIERS.length, 8);
    assert.equal(Award.TIERS.map((t) => t.n).join(','), '1,2,3,4,5,6,7,8');
  });

  test('приглушені саме дві найнижчі', () => {
    const soft = Award.TIERS.filter((t) => t.soft).map((t) => t.n);
    assert.equal(soft.join(','), '1,2', 'приглушені: ' + soft.join(','));
  });

  test('усі вісім сходинок справді вживані — шкала без дірок', () => {
    const used = new Set(Award.ORDER.map((k) => Award.tierOf(k).n));
    assert.equal([...used].sort((a, b) => a - b).join(','), '1,2,3,4,5,6,7,8');
  });

  test('чорна сходинка одна, і вона не за сезон', () => {
    const black = Award.ORDER.filter((k) => Award.tierOf(k).n === 8);
    assert.equal(black.join(','), 'beta',
      'чорну роздано не тільки за бету: ' + black.join(','));
  });

  test('рівні розкладені по шкалі рівномірно, а не скупчені', () => {
    /* П’ять карток за рівень мусять зайняти п’ять РІЗНИХ сходинок і
       зростати разом із рівнем — інакше L5 і L10 коштують однаково. */
    const levels = ['level5', 'level7', 'level8', 'level9', 'level10'];
    const t = levels.map((k) => Award.tierOf(k).n);
    assert.equal(t.join(','), '1,2,3,4,5');
  });

  test('ELITE — золота', () => {
    assert.equal(Award.tierOf('elite').id, 'gold');
  });

  test('рідкість видно в розмітці: клас, атрибут і слово', () => {
    const h = Award.html({ kind: 'elite' });
    assert.match(h, /awd--t7/);
    assert.match(h, /data-tier="7"/);
    assert.match(h, /awd__rar">Золота</, 'слова рідкості немає — лишився самий колір');
  });

  test('приглушені позначені класом, решта — ні', () => {
    assert.match(Award.html({ kind: 'level5' }), /awd--soft/);
    assert.ok(!/awd--soft/.test(Award.html({ kind: 'elite' })));
  });

  test('сезон їде атрибутом — сторінка фільтрує по ньому', () => {
    assert.match(Award.html({ kind: 'top3', season: '2026-S1' }), /data-season="2026-S1"/);
    assert.ok(!/data-season/.test(Award.html({ kind: 'top3' })),
      'сезону немає — атрибута теж не має бути, інакше фільтр упіймає порожнечу');
  });

  test('невідомий код не вигадує рідкості', () => {
    assert.equal(Award.tierOf('чогось такого немає').n, 1);
    assert.match(Award.html({ kind: 'невідоме' }), /awd--t1/);
  });

  test('читалці рідкість теж дістається', () => {
    assert.match(Award.html({ kind: 'beta' }), /aria-label="[^"]*Легендарна/);
  });
});
