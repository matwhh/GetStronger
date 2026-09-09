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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { Award } = loadModules(['js/award-core.js']);

test('сервер віддає kind, а не code — картка мусить читати саме його', () => {
  /* elo_history: jsonb_build_object('season', …, 'kind', kind, 'label', …).
     Читання a.code давало undefined, і кожна нагорода малювалась як
     невідома — тихо, без жодної помилки в консолі. */
  const h = Award.html({ kind: 'beta', label: 'Бета' });
  assert.match(h, /БЕТА/);
  assert.match(h, /Учасник бета-версії/);
  assert.match(h, /awd--beta/);
});

test('code лишається запасним варіантом', () => {
  const h = Award.html({ code: 'beta', label: 'Бета' });
  assert.match(h, /БЕТА/);
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

test('обидва боки лежать в aria-label: читалка не вміє перевертати', () => {
  const h = Award.html({ code: 'beta' });
  const m = h.match(/aria-label="([^"]*)"/);
  assert.ok(m, 'aria-label є');
  assert.match(m[1], /БЕТА/);
  assert.match(m[1], /Учасник бета-версії/);
  assert.match(m[1], /Forge ще збирався/);
});

test('картка має обидві сторони й кутову іконку', () => {
  const h = Award.html({ code: 'beta' });
  assert.match(h, /awd__face--front/);
  assert.match(h, /awd__face--back/);
  assert.equal((h.match(/awd__ico/g) || []).length, 2, 'іконка на кожному боці');
});

test('у бети саме шестерня, у решти — зірка', () => {
  assert.ok(Award.html({ code: 'beta' }).includes('<circle cx="12" cy="12" r="3"/>'));
  assert.ok(!Award.html({ code: 'first' }).includes('<circle cx="12" cy="12" r="3"/>'));
});

test('сезон підписується переданою функцією, а не сирим кодом', () => {
  const h = Award.html({ code: 'first', season: 'AUTUMN-2026' },
    { seasonLabel: (s) => 'Осінь 2026' });
  assert.match(h, /Осінь 2026/);
  assert.doesNotMatch(h, /AUTUMN-2026/);
});

test('без сезону надпис не порожній', () => {
  const h = Award.html({ code: 'beta' });
  assert.match(h, /Нагорода/);
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
