/**
 * Обчислення попереднього сезону для elo_close_season.
 *
 * Було: prev.setMonth(prev.getMonth() - 3). У травні (29–31 числа) це дає
 * «31 лютого» → 3 березня → ВЕСНА, тобто ПОТОЧНИЙ сезон. Сервер відповідав
 * season_running, клієнт усе одно позначав сезон закритим — і той не
 * закривався ніколи: ні історії, ні нагород, ні звіту.
 *
 * Стало: день перед початком поточного сезону. Цей тест ганяє ВСІ 365 днів
 * року через обидві реалізації й показує, де стара ламалась.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';
import { readFileSync } from 'node:fs';

const EC = loadModules(['js/elo-core.js']).EloCore;

/*
 * ПЕРЕВІРЯЄМО ПРОДАКШЕН-ФУНКЦІЮ, А НЕ ЇЇ ДВІЙНИКА.
 *
 * Тут лежала копія реалізації, і 366 днів ганялись через неї; сам
 * js/elo-api.js не завантажував жоден тест (TST-001). Копія розходиться з
 * оригіналом тихо — а ціна розбіжності тут висока: сезон, що не
 * закривається, це ні історії, ні нагород, ні звіту.
 *
 * Арифметику винесено в EloCore.previousSeasonCode; elo-api.js кличе саме
 * її.
 */
const prevSeason = EC.previousSeasonCode;

/** Стара реалізація — лишена як доказ, що баг був справжній (див. нижче). */
function prevSeasonOld(now) {
  const p = new Date(now);
  p.setMonth(p.getMonth() - 3);
  return EC.seasonOf(p);
}

describe('Попередній сезон', () => {
  test('жодного дня в році не повертає ПОТОЧНИЙ сезон', () => {
    const bad = [];
    for (let i = 0; i < 366; i++) {
      const d = new Date(2026, 0, 1 + i);
      if (d.getFullYear() !== 2026) break;
      if (prevSeason(d) === EC.seasonOf(d)) bad.push(d.toISOString().slice(0, 10));
    }
    assert.deepEqual(bad, [], 'ці дні дали поточний сезон замість попереднього');
  });

  test('стара реалізація справді ламалась (регресійний доказ)', () => {
    const bad = [];
    for (let i = 0; i < 366; i++) {
      const d = new Date(2026, 0, 1 + i);
      if (d.getFullYear() !== 2026) break;
      if (prevSeasonOld(d) === EC.seasonOf(d)) bad.push(d.toISOString().slice(0, 10));
    }
    assert.ok(bad.length > 0, 'якщо тут порожньо — тест втратив сенс');
    assert.ok(bad.some((k) => k.startsWith('2026-05-3')), 'кінець травня — саме те вікно');
  });

  test('межі всіх чотирьох сезонів', () => {
    const cases = [
      ['2026-03-01', 'WINTER-2025'],
      ['2026-05-31', 'WINTER-2025'],
      ['2026-06-01', 'SPRING-2026'],
      ['2026-08-31', 'SPRING-2026'],
      ['2026-09-01', 'SUMMER-2026'],
      ['2026-11-30', 'SUMMER-2026'],
      ['2026-12-01', 'AUTUMN-2026'],
      ['2027-01-31', 'AUTUMN-2026'],
      ['2027-02-28', 'AUTUMN-2026']
    ];
    cases.forEach(function (c) {
      const p = c[0].split('-').map(Number);
      assert.equal(prevSeason(new Date(p[0], p[1] - 1, p[2])), c[1], c[0]);
    });
  });

  test('28, 29, 30 і 31 числа кожного місяця — без винятків', () => {
    for (let m = 0; m < 12; m++) {
      for (const day of [28, 29, 30, 31]) {
        const d = new Date(2026, m, day);
        if (d.getMonth() !== m) continue;          // 31 лютого не існує
        const prev = prevSeason(d);
        assert.notEqual(prev, EC.seasonOf(d),
          'місяць ' + (m + 1) + ', день ' + day + ' дав поточний сезон');
        assert.match(prev, /^(WINTER|SPRING|SUMMER|AUTUMN)-\d{4}$/);
      }
    }
  });
});

describe('Продакшен-код справді кличе ядро', () => {
  test('js/elo-api.js не має власної копії арифметики сезону', () => {
    /* Копія в елo-api.js була б непомітною для цього файла — саме через
       це TST-001 і виникла. Перевіряємо текстом: інакше наступна копія
       знову проживе рік. */
    const src = readFileSync(new URL('../js/elo-api.js', import.meta.url), 'utf8');
    assert.ok(src.includes('previousSeasonCode('), 'elo-api.js має кликати ядро');
    assert.ok(!/setMonth\(\s*\w+\.getMonth\(\)\s*-\s*3/.test(src),
      'у elo-api.js знову зʼявилась наївна арифметика «мінус три місяці»');
  });
});
