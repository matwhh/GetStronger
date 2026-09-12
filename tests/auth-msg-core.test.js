/**
 * ПОМИЛКА МУСИТЬ НАЗИВАТИ ПРИЧИНУ.
 *
 * Стережеться не формулювання, а те, що РІЗНІ поламки дають РІЗНІ
 * відповіді. Одна фраза на всі випадки («перевірте пошту й пароль») —
 * саме та вада, від якої цей модуль і зʼявився: людина бачить, що щось
 * не так, і не знає, куди дивитись.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { AuthMsg } = loadModules(['js/date-core.js', 'js/auth-msg-core.js']);

describe('пошта: кожна поламка має свою відповідь', () => {
  test('правильна адреса проходить мовчки', () => {
    assert.equal(AuthMsg.emailProblem('matthew@gmail.com'), '');
    assert.equal(AuthMsg.emailProblem('  matthew@gmail.com  '), '', 'пробіли по краях зрізаються');
    assert.equal(AuthMsg.emailProblem('a.b+c@sub.domain.co.uk'), '');
  });

  test('порожньо — просимо ввести', () => {
    assert.match(AuthMsg.emailProblem(''), /Введіть пошту/);
    assert.match(AuthMsg.emailProblem(null), /Введіть пошту/);
  });

  test('немає @ — кажемо саме про @', () => {
    assert.match(AuthMsg.emailProblem('matthewgmail.com'), /немає знака @/);
  });

  test('немає домену після @', () => {
    assert.match(AuthMsg.emailProblem('matthew@'), /Після @ немає домену/);
  });

  test('домен без крапки', () => {
    assert.match(AuthMsg.emailProblem('matthew@gmail'), /немає крапки/);
  });

  test('пробіл усередині — кажемо про пробіл, а не про «формат»', () => {
    assert.match(AuthMsg.emailProblem('mat thew@gmail.com'), /пробіл/);
  });

  test('кирилиця — кажемо про розкладку', () => {
    assert.match(AuthMsg.emailProblem('матвій@gmail.com'), /розкладку/);
  });

  test('два @ — кажемо про два', () => {
    assert.match(AuthMsg.emailProblem('a@b@gmail.com'), /два знаки @/);
  });

  test('обірваний домен після останньої крапки', () => {
    assert.match(AuthMsg.emailProblem('matthew@gmail.c'), /обірваний|крапк/i);
  });

  test('усі відповіді різні — жодна не повторюється', () => {
    const bad = ['', 'matthewgmail.com', 'matthew@', 'matthew@gmail',
                 'mat thew@gmail.com', 'матвій@gmail.com', 'a@b@gmail.com'];
    const texts = bad.map((b) => AuthMsg.emailProblem(b));
    assert.equal(new Set(texts).size, texts.length, texts.join(' | '));
  });
});

describe('пароль на вході', () => {
  test('порожній — просимо ввести', () => {
    assert.match(AuthMsg.loginPassProblem(''), /Введіть пароль/);
  });

  test('закороткий — називає скільки набрано і скільки треба', () => {
    const t = AuthMsg.loginPassProblem('Ab1!');
    assert.match(t, /4/);
    assert.match(t, new RegExp(String(AuthMsg.MIN_LEN)));
  });

  test('число символів відмінюється', () => {
    assert.match(AuthMsg.loginPassProblem('a'), /1 символ[^иі]/);
    assert.match(AuthMsg.loginPassProblem('ab'), /2 символи/);
    assert.match(AuthMsg.loginPassProblem('abcde'), /5 символів/);
  });

  test('кирилиця — кажемо про розкладку', () => {
    assert.match(AuthMsg.loginPassProblem('Пароль123!'), /розкладку/);
  });

  test('чужий слабкий пароль пропускаємо — надійність тут не судять', () => {
    assert.equal(AuthMsg.loginPassProblem('password'), '');
    assert.equal(AuthMsg.loginPassProblem('12345678'), '');
  });
});

describe('відмова сервера веде до поля й до наступного кроку', () => {
  test('не той пароль — підсвічує пароль і пропонує відновлення', () => {
    const r = AuthMsg.signInProblem({ code: 'invalid_credentials', message: 'x' });
    assert.equal(r.field, 'au-pass');
    assert.equal(r.action, 'forgot');
    assert.match(r.text, /Caps Lock|розкладк/);
  });

  test('непідтверджена пошта веде на екран підтвердження, а не в пароль', () => {
    const r = AuthMsg.signInProblem({ code: 'email_not_confirmed', message: 'x' });
    assert.equal(r.action, 'confirm');
    assert.equal(r.field, '');
  });

  test('офлайн не звинувачує людину', () => {
    const r = AuthMsg.signInProblem({ offline: true, message: 'Немає звʼязку з сервером' });
    assert.equal(r.field, '');
    assert.match(r.text, /звʼязку/);
  });

  test('429 упізнається і без коду', () => {
    const r = AuthMsg.signInProblem({ status: 429, message: '' });
    assert.match(r.text, /Забагато/);
  });

  test('невідома відмова не губить текст сервера', () => {
    const r = AuthMsg.signInProblem({ code: 'weird', message: 'Щось дивне' });
    assert.equal(r.text, 'Щось дивне');
  });
});
