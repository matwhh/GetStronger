/**
 * ДАТА — ОДНА НА ВЕСЬ ПРОЄКТ.
 *
 * Цей файл зʼявився разом із js/date-core.js, і привід був не в красі:
 * аудит показав чотири РІЗНІ реалізації mondayOf у чотирьох файлах, три
 * різні keyOf і три різні dateOf. Копії розходяться тихо — на екрані
 * дата правильна, неправильне лише «скільки днів тому».
 *
 * Тому перевіряється не «функція щось повертає», а рівно ті три місця,
 * де дата й ламається:
 *   1. перехід на літній час (доба в 23 години);
 *   2. межі місяця й року;
 *   3. понеділок як початок тижня, нормалізований до півночі.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const D = loadModules(['js/date-core.js']).DateCore;

const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);

describe('ключ дня', () => {
  test('місцева дата, а не UTC', () => {
    /* 23:30 місцевого часу — це ще СЬОГОДНІ. У UTC це вже завтра для
       доброї половини Європи, і журнал підписався б чужим днем. */
    assert.equal(D.keyOf(at(2026, 9, 12, 23, 30)), '2026-09-12');
    assert.equal(D.keyOf(at(2026, 9, 12, 0, 5)), '2026-09-12');
  });

  test('однозначні місяць і день доповнюються нулем', () => {
    assert.equal(D.keyOf(at(2026, 1, 3)), '2026-01-03');
  });

  test('сміття на вході — сьогоднішній день, а не «undefined-NaN-NaN»', () => {
    assert.match(D.keyOf(null), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(D.keyOf('вчора'), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(D.keyOf(new Date('дурня')), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('todayKey — той самий keyOf, а не друга реалізація', () => {
    const d = at(2026, 5, 7);
    assert.equal(D.todayKey(d), D.keyOf(d));
  });
});

describe('ключ → дата', () => {
  test('повертає місцеву північ', () => {
    const d = D.dateOf('2026-09-12');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 8);
    assert.equal(d.getDate(), 12);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });

  test('туди й назад без втрат', () => {
    for (const k of ['2026-01-01', '2026-02-28', '2026-03-29', '2026-12-31']) {
      assert.equal(D.keyOf(D.dateOf(k)), k, k);
    }
  });

  test('сміття дає Invalid Date, а НЕ null', () => {
    /* Тридцять вісім місць у проєкті пишуть dateOf(k).getTime() одразу.
       null там означав би падіння замість NaN — тобто білий екран
       замість кривого числа. */
    assert.ok(D.dateOf('') instanceof Date);
    assert.ok(Number.isNaN(D.dateOf('').getTime()));
    assert.ok(Number.isNaN(D.dateOf('не дата').getTime()));
    assert.ok(Number.isNaN(D.dateOf(null).getTime()));
  });

  test('isValid відрізняє придатну дату', () => {
    assert.equal(D.isValid(D.dateOf('2026-09-12')), true);
    assert.equal(D.isValid(D.dateOf('дурня')), false);
    assert.equal(D.isValid('2026-09-12'), false, 'рядок — не дата');
    assert.equal(D.isValid(null), false);
  });

  test('isKey перевіряє форму ключа', () => {
    assert.equal(D.isKey('2026-09-12'), true);
    assert.equal(D.isKey('2026-9-12'), false);
    assert.equal(D.isKey('12.09.2026'), false);
    assert.equal(D.isKey(''), false);
  });
});

describe('понеділок', () => {
  test('тиждень починається з понеділка', () => {
    /* 12.09.2026 — субота. Понеділок того тижня — 7-ме. */
    assert.equal(D.keyOf(D.mondayOf(at(2026, 9, 12))), '2026-09-07');
  });

  test('неділя належить ТОМУ Ж тижню, а не наступному', () => {
    /* Головна пастка getDay(): неділя там нуль, і наївний зсув відносить
       її на тиждень уперед. */
    assert.equal(D.keyOf(D.mondayOf(at(2026, 9, 13))), '2026-09-07');
    assert.equal(D.keyOf(D.mondayOf(at(2026, 9, 14))), '2026-09-14', 'сам понеділок — це він і є');
  });

  test('час доби зрізається', () => {
    /* САМЕ ТУТ розходились копії: journal.js лишав час, решта — ні.
       Різниця двох понеділків ділиться на 7 діб, і лишений час доби
       вносить у ділення похибку. */
    const m = D.mondayOf(at(2026, 9, 12, 23, 59));
    assert.equal(m.getHours(), 0);
    assert.equal(m.getMinutes(), 0);
    assert.equal(m.getSeconds(), 0);
  });

  test('два понеділки діляться на 7 діб рівно', () => {
    const a = D.mondayOf(at(2026, 9, 12, 23, 59));
    const b = D.mondayOf(at(2026, 10, 3, 0, 1));
    assert.equal(Math.round((b - a) / (7 * D.DAY_MS)), 3);
  });

  test('перехід через межу місяця', () => {
    assert.equal(D.keyOf(D.mondayOf(at(2026, 10, 1))), '2026-09-28');
  });
});

describe('різниця в днях', () => {
  test('рахує календарно', () => {
    assert.equal(D.daysBetween('2026-09-01', '2026-09-12'), 11);
    assert.equal(D.daysBetween('2026-09-12', '2026-09-12'), 0);
    assert.equal(D.daysBetween('2026-09-12', '2026-09-01'), -11, 'назад — відʼємно');
  });

  test('ПЕРЕХІД НА ЛІТНІЙ ЧАС не зʼїдає добу', () => {
    /* Остання неділя березня: доба триває 23 години. У місцевих
       мілісекундах це 0,96 доби — і «вчора» стає «сьогодні». */
    assert.equal(D.daysBetween('2026-03-28', '2026-03-29'), 1);
    assert.equal(D.daysBetween('2026-03-29', '2026-03-30'), 1);
    /* І назад, в останню неділю жовтня: там доба 25 годин. */
    assert.equal(D.daysBetween('2026-10-24', '2026-10-25'), 1);
    assert.equal(D.daysBetween('2026-10-25', '2026-10-26'), 1);
  });

  test('межі місяця й року', () => {
    assert.equal(D.daysBetween('2026-02-28', '2026-03-01'), 1, '2026 — не високосний');
    assert.equal(D.daysBetween('2024-02-28', '2024-03-01'), 2, '2024 — високосний');
    assert.equal(D.daysBetween('2025-12-31', '2026-01-01'), 1);
    assert.equal(D.daysBetween('2026-01-01', '2026-12-31'), 364);
  });

  test('сміття не вигадує числа', () => {
    assert.equal(D.daysBetween('не дата', '2026-09-12'), null);
    assert.equal(D.daysBetween(null, undefined), null);
    assert.equal(D.daysBetween('2026-9-1', '2026-09-12'), null, 'форма ключа строга');
  });
});

describe('зсув дати', () => {
  test('addDays тримає місцеву північ', () => {
    const d = D.addDays(at(2026, 9, 12, 18, 40), 3);
    assert.equal(D.keyOf(d), '2026-09-15');
    assert.equal(d.getHours(), 0);
  });

  test('addDays назад і через межу року', () => {
    assert.equal(D.keyOf(D.addDays(at(2026, 1, 1), -1)), '2025-12-31');
  });

  test('shiftKey працює з ключами напряму', () => {
    assert.equal(D.shiftKey('2026-02-28', 1), '2026-03-01');
    assert.equal(D.shiftKey('2024-02-28', 1), '2024-02-29');
    assert.equal(D.shiftKey('2026-03-28', 1), '2026-03-29', 'через перехід на літній час');
    assert.equal(D.shiftKey('дурня', 1), '', 'сміття не стає датою');
  });

  test('lastKeys — від старого до сьогоднішнього включно', () => {
    assert.equal(D.lastKeys(3, at(2026, 9, 12)).join(','), '2026-09-10,2026-09-11,2026-09-12');
    assert.equal(D.lastKeys(1, at(2026, 9, 12)).join(','), '2026-09-12');
    assert.equal(D.lastKeys(0).length, 0);
    assert.equal(D.lastKeys(-5).length, 0, 'відʼємна довжина — порожньо, а не падіння');
  });

  test('lastKeys не спотикається на переході часу', () => {
    const k = D.lastKeys(4, at(2026, 3, 30));
    assert.equal(k.join(','), '2026-03-27,2026-03-28,2026-03-29,2026-03-30');
  });
});
