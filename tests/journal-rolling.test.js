/**
 * Ковзна середня ваги: та сама відповідь, але за O(N).
 *
 * PRF-002 з аудиту 2026-09: rolling() для КОЖНОГО запису фільтрував увесь
 * масив і двічі створював Date всередині — O(N²) з розбором рядка дати на
 * кожній ітерації. Викликалось двічі на рендер: при відкритті журналу,
 * після кожного «Записати», при зміні періоду і з кожного Store.onChange.
 *
 * Переписано на вікно двома вказівниками. Оптимізація має право на життя
 * тільки якщо вона нічого не міняє у відповіді, тому тут поруч лежать
 * ОБИДВІ реалізації: наївна (як було) і швидка (як стало), і тест звіряє
 * їх на випадкових даних із пропусками. Якщо швидка колись розʼїдеться —
 * це буде видно тут, а не в кривій лінії на графіку.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/* Дві функції нижче — копії з js/journal.js. Правиш там — правиш тут. */
function dateOf(key) { return new Date(key + 'T00:00:00'); }

/** Як було: для кожної точки — фільтр по всьому масиву. */
function rollingNaive(entries) {
  return entries.map(function (e) {
    const end = dateOf(e.key).getTime();
    const start = end - 6 * 86400000;
    const win = entries.filter(function (x) {
      const t = dateOf(x.key).getTime();
      return t >= start && t <= end;
    });
    const avg = win.reduce(function (s, x) { return s + x.kg; }, 0) / win.length;
    return { key: e.key, kg: e.kg, avg: avg };
  });
}

/** Як стало: вікно двома вказівниками. */
function rollingFast(entries) {
  const ts = entries.map(function (e) { return dateOf(e.key).getTime(); });
  const out = [];
  let from = 0, sum = 0;
  for (let i = 0; i < entries.length; i++) {
    sum += entries[i].kg;
    const start = ts[i] - 6 * 86400000;
    while (ts[from] < start) { sum -= entries[from].kg; from++; }
    out.push({ key: entries[i].key, kg: entries[i].kg, avg: sum / (i - from + 1) });
  }
  return out;
}

function key(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** Журнал із пропусками: саме через них вікно і рахується за календарем. */
function series(days, gapEvery, seed) {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  const start = new Date(2024, 0, 1);
  for (let i = 0; i < days; i++) {
    if (gapEvery && i % gapEvery === 0) continue;
    const d = new Date(start.getTime() + i * 86400000);
    out.push({ key: key(d), kg: Math.round((70 + rnd() * 20) * 10) / 10 });
  }
  return out;
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

describe('Ковзна середня за 7 календарних днів', () => {
  test('порожній журнал', () => {
    assert.deepEqual(rollingFast([]), []);
  });

  test('один запис — середня дорівнює йому самому', () => {
    const r = rollingFast([{ key: '2024-03-01', kg: 80 }]);
    assert.equal(r.length, 1);
    assert.equal(r[0].avg, 80);
  });

  test('щоденні зважування: вікно рівно 7 днів, не 7 записів', () => {
    const e = [];
    for (let i = 1; i <= 10; i++) e.push({ key: '2024-03-0' + (i < 10 ? i : ''), kg: i });
    /* виправляємо ключ десятого дня */
    e[9] = { key: '2024-03-10', kg: 10 };
    const r = rollingFast(e);
    /* 10-й день: дні 4..10 → (4+5+6+7+8+9+10)/7 */
    assert.ok(close(r[9].avg, 49 / 7), String(r[9].avg));
  });

  test('пропуски: середня йде по наявних записах у вікні', () => {
    const e = [
      { key: '2024-03-01', kg: 80 },
      { key: '2024-03-05', kg: 82 },
      { key: '2024-03-20', kg: 90 }
    ];
    const r = rollingFast(e);
    assert.ok(close(r[1].avg, 81), 'у вікні два записи');
    assert.ok(close(r[2].avg, 90), 'попередні вийшли з вікна');
  });

  test('той самий результат, що й у наївної реалізації', () => {
    for (const [days, gap, seed] of [[400, 0, 7], [400, 3, 11], [900, 5, 23], [30, 2, 5]]) {
      const e = series(days, gap, seed);
      const a = rollingNaive(e);
      const b = rollingFast(e);
      assert.equal(a.length, b.length);
      for (let i = 0; i < a.length; i++) {
        assert.equal(a[i].key, b[i].key);
        assert.ok(close(a[i].avg, b[i].avg),
          'розбіжність на ' + a[i].key + ': ' + a[i].avg + ' проти ' + b[i].avg);
      }
    }
  });

  test('швидка реалізація справді швидша на довгому журналі', () => {
    /* Не бенчмарк, а запобіжник: якщо хтось поверне фільтр усередину
       циклу, різниця зникне і тест це помітить. */
    const e = series(3000, 0, 3);
    const t0 = process.hrtime.bigint(); rollingFast(e);
    const t1 = process.hrtime.bigint(); rollingNaive(e);
    const t2 = process.hrtime.bigint();
    assert.ok(t2 - t1 > (t1 - t0) * 3n,
      'наївна має бути помітно повільнішою: ' + (t1 - t0) + ' проти ' + (t2 - t1));
  });
});
