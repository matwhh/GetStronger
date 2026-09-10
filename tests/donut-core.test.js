/**
 * Кільцева діаграма складу: геометрія секторів.
 *
 * НАЙВАЖЛИВІШЕ ТУТ — що сектори не наїжджають один на одного. Кожен
 * сектор це дуга, намальована штрихом: stroke-dasharray = [довжина,
 * решта кола] плюс зсув stroke-dashoffset. Проміжки між секторами
 * ВІДНІМАЮТЬСЯ від самих дуг, а не додаються між ними — інакше сума дуг
 * перевищила б коло й останній сектор наїхав би на перший. Помилка
 * помітна лише на певних співвідношеннях часток, тому вона тут під
 * наглядом, а не «видно ж на очі».
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { Donut } = loadModules(['js/donut-core.js']);

/** Довжини намальованих дуг у порядку появи */
const dashes = (html) =>
  [...html.matchAll(/data-dash="([\d.]+) ([\d.]+)"/g)].map((m) => Number(m[1]));
/** Зсуви (від'ємні, як їх пише SVG) */
const offsets = (html) =>
  [...html.matchAll(/stroke-dashoffset="(-?[\d.]+)"/g)].map((m) => Number(m[1]));

const S = (...vals) => vals.map((v, i) => ({ label: 'S' + i, value: v, cls: 'c' + i }));

describe('Donut: пропорції', () => {
  it('рівні частки дають рівні дуги', () => {
    const d = dashes(Donut.html({ slices: S(1, 1, 1) }));
    assert.equal(d.length, 3);
    assert.ok(Math.abs(d[0] - d[1]) < 0.05 && Math.abs(d[1] - d[2]) < 0.05, JSON.stringify(d));
  });

  it('удвічі більше значення — удвічі довша дуга (з поправкою на проміжок)', () => {
    const d = dashes(Donut.html({ slices: S(1, 2) }));
    // кожна дуга вкорочена на однаковий проміжок, тому порівнюємо з ним
    const gap = (Donut.C - d[0] - d[1]) / 2;
    /* Допуск 0,05: у розмітку довжини йдуть із двома знаками після коми,
       тож точної рівності тут не буває за побудовою. */
    assert.ok(Math.abs((d[1] + gap) - 2 * (d[0] + gap)) < 0.05,
      JSON.stringify({ d, gap }));
  });

  it('сума дуг і проміжків дорівнює колу — сектори не наїжджають', () => {
    for (const set of [[1, 1, 1], [70, 20, 10], [1, 1, 98], [5, 90, 5]]) {
      const d = dashes(Donut.html({ slices: S(...set) }));
      const used = d.reduce((a, x) => a + x, 0);
      assert.ok(used < Donut.C, 'сума дуг ' + used + ' ≥ ' + Donut.C + ' для ' + set);
      assert.ok(used > Donut.C - 12, 'забагато порожнечі: ' + used + ' для ' + set);
    }
  });

  it('зсуви йдуть підряд, без нахлесту й розривів', () => {
    const html = Donut.html({ slices: S(30, 50, 20) });
    const off = offsets(html);
    assert.equal(off.length, 3);
    assert.equal(off[0], 0);
    // кожен наступний зсув = попередній мінус ПОВНА (не вкорочена) частка
    const full = [30, 50].map((v) => v / 100 * Donut.C);
    assert.ok(Math.abs(-off[1] - full[0]) < 0.02, JSON.stringify(off));
    assert.ok(Math.abs(-off[2] - (full[0] + full[1])) < 0.02, JSON.stringify(off));
  });
});

describe('Donut: крайні випадки', () => {
  it('нульова сума — не кільце з нулів, а порожній стан словами', () => {
    const html = Donut.html({ slices: S(0, 0, 0), empty: 'ще нічого' });
    assert.ok(html.includes('donut--empty'));
    assert.ok(html.includes('ще нічого'));
    assert.equal(dashes(html).length, 0);
  });

  it('один сектор займає все коло, крім одного проміжку', () => {
    const d = dashes(Donut.html({ slices: S(5) }));
    assert.equal(d.length, 1);
    assert.ok(d[0] > Donut.C - 3 && d[0] < Donut.C, String(d[0]));
  });

  it('мікроскопічна частка лишається видимою рискою, а не зникає', () => {
    const d = dashes(Donut.html({ slices: S(1000, 1) }));
    assert.ok(d[1] >= 0.4, String(d[1]));
  });

  it("від'ємні значення не ламають геометрію", () => {
    const d = dashes(Donut.html({ slices: S(10, -5, 10) }));
    const used = d.reduce((a, x) => a + x, 0);
    assert.ok(used < Donut.C);
  });
});

describe('Donut: розмітка', () => {
  it('центр і підпис під ним потрапляють у дучку', () => {
    const html = Donut.html({ slices: S(1, 1), center: '949', sub: 'ккал за день' });
    assert.ok(html.includes('>949<'));
    assert.ok(html.includes('ккал за день'));
  });

  it('кільце повернуте на −90°: перший сектор починається згори', () => {
    assert.ok(Donut.html({ slices: S(1) }).includes('rotate(-90 50 50)'));
  });

  it('підписи екрануються', () => {
    const html = Donut.html({ slices: [{ label: '<img src=x>', value: 1, cls: 'c' }] });
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  });

  /* WEB-015 — див. пояснення в daycal-core.test.js. Копія esc() у цьому
     модулі теж пропускала одинарну лапку. */
  it('одинарна лапка в підписі теж екранується', () => {
    const html = Donut.html({ slices: [{ label: "Ол'я", value: 1, cls: 'c' }] });
    assert.ok(html.includes('&#39;'), 'лапка не екранована');
    assert.ok(!html.includes("Ол'я"), 'сира лапка доїхала в розмітку');
  });

  it('кожен сектор має <title> для читалки екрана', () => {
    const html = Donut.html({ slices: S(1, 2, 3) });
    assert.equal((html.match(/<title>/g) || []).length, 3);
  });
});
