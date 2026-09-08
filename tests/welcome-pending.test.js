/**
 * Екран очікування схвалення.
 *
 * ЧОМУ ЦЕ ВЗАГАЛІ ПІД ТЕСТОМ. Це єдиний екран, який людина бачить після
 * реєстрації — і єдиний, який неможливо перевірити браузерними
 * інструментами проєкту: щоб на нього потрапити, потрібен акаунт зі
 * статусом pending у БОЙОВІЙ базі. Створювати акаунти в продакшені
 * заборонено, тож перевіряється не поведінка, а ТЕКСТ І РОЗМІТКА — саме
 * те, що тут тихо гниє.
 *
 * ГОЛОВНЕ ТВЕРДЖЕННЯ: екран не має обіцяти того, чого система не робить.
 * Листа про схвалення не надсилає ніхто (ні js/admin.js, ні жоден
 * db/*.sql), а стояло «зазвичай недовго» — обіцянка строку, якого ніхто
 * не контролює. Людина, яка чекає листа, чекатиме його вічно.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Тіло renderPending — від оголошення до наступної функції. */
function pendingBody() {
  const src = read('js/welcome.js');
  const a = src.indexOf('function renderPending(host) {');
  assert.ok(a > 0, 'renderPending зник — екран очікування нічим не малюється');
  const b = src.indexOf('\n  function ', a + 10);
  return src.slice(a, b > 0 ? b : src.length);
}

describe('Очікування схвалення: розмітка', () => {
  const body = pendingBody();

  it('на екрані є кільця очікування', () => {
    assert.match(body, /class="loader"/, 'зник індикатор очікування');
    assert.match(body, /loader__ring--in/, 'лишилось одне кільце з двох');
  });

  it('кільця оголошені станом, а не картинкою', () => {
    /* Для читалки екрана обертання — це не декор, а повідомлення «зараз
       відбувається ось що». Без role="status" вона промовчить. */
    assert.match(body, /role="status"/);
    assert.match(body, /aria-live="polite"/);
    assert.match(body, /aria-label="[^"]+"/);
    /* Самі кільця — порожні <i>: читати їх нема чого. */
    assert.match(body, /loader__ring"[^>]*aria-hidden="true"/);
  });

  it('кнопка перевірки статусу лишилась', () => {
    /* Вона єдина: сторінка НЕ опитує сервер сама, і поки це так —
       прибрати кнопку означає замкнути людину на екрані назавжди. */
    assert.match(body, /id="au-recheck"/);
  });
});

describe('Очікування схвалення: текст не обіцяє зайвого', () => {
  const body = pendingBody();

  it('сказано, що листа не буде', () => {
    /*
     * Пошту на схвалення не надсилає ніхто. Якщо колись почне —
     * цей тест впаде, і це правильно: тоді треба переписати екран, а
     * не мовчки лишити його брехати в інший бік.
     */
    assert.match(body, /[Лл]иста про схвалення не буде/,
      'екран мовчить про те, що сповіщення не надійде');
  });

  it('немає обіцянки строку', () => {
    const BANNED = [/зазвичай недовго/i, /за кілька хвилин/i, /протягом години/i,
                    /швидко розглянемо/i, /найближчим часом/i];
    const hit = BANNED.filter((re) => re.test(body));
    assert.equal(hit.length, 0,
      'екран обіцяє строк розгляду, якого ніхто не контролює: ' + hit.join(', '));
  });

  it('сказано, що сторінку можна закрити', () => {
    /* Друге, чого людина не знає: заявка не прив'язана до відкритої
       вкладки. Без цього рядка екран читається як «не закривай». */
    assert.match(body, /[Сс]торінку можна закрити/);
  });
});

describe('Очікування схвалення: кільця описані в стилях', () => {
  const css = read('css/style.css');

  it('класи з розмітки існують у CSS', () => {
    ['.loader {', '.loader__ring {', '.loader__ring--in {', '.gate__wait {']
      .forEach((sel) => assert.ok(css.includes(sel), 'немає правила ' + sel));
  });

  it('кільця монохромні', () => {
    /* Тема без кольору: «градієнтні кільця» тут — градієнт ПРОЗОРОСТІ
       того самого білого. Будь-який hex або rgb() у цьому блоці означав
       би, що колір повернувся через чорний хід. */
    const a = css.indexOf('.loader__ring {');
    const block = css.slice(a, css.indexOf('}', css.indexOf('animation: ldr-spin', a)));
    const colors = block.match(/#[0-9a-f]{3,8}\b|rgba?\(\s*\d+\s*,/gi) || [];
    /* #0000 і #000 у масці — це прозорий і непрозорий, не колір. */
    const real = colors.filter((c) => !/^#0{3,4}$|^#0{6,8}$/i.test(c));
    assert.equal(real.length, 0, 'у кільцях зʼявився колір: ' + real.join(', '));
  });

  it('є зупинка руху для тих, хто його не переносить', () => {
    assert.match(css, /prefers-reduced-motion[\s\S]{0,400}\.loader__ring/,
      'кільця крутяться навіть у режимі спокійного руху');
  });
});
