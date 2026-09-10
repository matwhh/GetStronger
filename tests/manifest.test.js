/**
 * МАНІФЕСТ PWA.
 *
 * Стережеться одна річ, яку не видно ні в браузері, ні в тестах екранів:
 * ТОТОЖНІСТЬ ВСТАНОВЛЕНОГО ЗАСТОСУНКУ.
 *
 * Без поля `id` браузер бере за тотожність `start_url` (PWA-012). Тобто
 * будь-яка зміна стартової адреси — навіть косметична, «./» замість
 * «./index.html» — читається як ІНШИЙ застосунок: у того, хто вже
 * встановив FORGE, на екрані з'являється друга іконка, а стара лишається
 * з мертвим кешем і нікуди не оновлюється. Назад це не відкотиш: видалити
 * чужу іконку з чужого телефона неможливо.
 *
 * Тому `id` зафіксовано на "/index.html" — саме тій адресі, яка була
 * неявною тотожністю до цього коміту. Так уже встановлені застосунки
 * лишаються собою, а start_url надалі можна міняти вільно.
 *
 * ЗМІНЮВАТИ `id` НЕ МОЖНА НІКОЛИ. Якщо тест став червоним — це не привід
 * оновити очікуване значення, а привід повернути старе.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));

test('id зафіксований і дорівнює тій адресі, що була тотожністю до нього', () => {
  assert.equal(M.id, '/index.html');
});

test('start_url можна міняти, але він мусить лишатись у scope', () => {
  const scope = new URL(M.scope, 'https://example.test/');
  const start = new URL(M.start_url, 'https://example.test/');
  assert.ok(start.pathname.startsWith(scope.pathname),
    'start_url поза scope — застосунок відкриється у звичайній вкладці');
});

test('кожна іконка з маніфесту існує на диску', () => {
  assert.ok(M.icons.length > 0, 'маніфест без іконок');
  for (const i of M.icons) {
    assert.ok(fs.existsSync(path.join(ROOT, i.src)), 'немає файла ' + i.src);
  }
});

test('є maskable-іконка: без неї Android обріже логотип у кружечок', () => {
  assert.ok(M.icons.some((i) => String(i.purpose || '').split(/\s+/).includes('maskable')));
});
