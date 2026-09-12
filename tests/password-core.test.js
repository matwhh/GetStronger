/**
 * Надійність пароля. Правила: 8+, тільки латиниця, усі чотири класи
 * символів, без словникових слів (у т.ч. під маскуванням) і візерунків.
 *
 * Перевіряємо і те, що ПРОХОДИТЬ, — інакше легко зробити правило, яке
 * не пропускає нічого.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const { PasswordCore: P } = loadModules(['js/date-core.js', 'js/password-core.js']);
const bad = (pw, ctx) => { const r = P.check(pw, ctx); assert.equal(r.ok, false, 'мав відхилити: ' + pw); return r; };
const good = (pw, ctx) => { const r = P.check(pw, ctx); assert.equal(r.ok, true, 'мав прийняти: ' + pw + ' → ' + r.problem); return r; };

describe('Пароль: довжина', () => {
  it('мінімум — 8', () => {
    assert.equal(P.MIN_LEN, 8);
    bad('Ab1!xy');            // 6
    good('Ab1!xyzq');         // 8
  });

  it('задовгий (понад ліміт bcrypt) — ні', () => {
    bad('Ab1!' + 'x'.repeat(80));
  });

  it('пробіли по краях — ні', () => {
    bad(' Kyiv#Gym24');
    bad('Kyiv#Gym24 ');
  });
});

describe('Пароль: тільки латиниця', () => {
  it('кирилиця дає зрозуміле повідомлення про розкладку', () => {
    const r = bad('Корова-Міст-2026');
    assert.match(r.problem, /англійською|розкладку/);
  });

  it('одна кирилична літера теж ловиться', () => {
    bad('Кyiv#Gym24');        // перша літера — кирилична «К»
  });

  it('емодзі та інші не-ASCII — ні', () => {
    bad('Kyiv#Gym24💪');
  });
});

describe('Пароль: усі чотири класи символів', () => {
  it('без малої літери', () => assert.match(bad('KYIV#GYM24').problem, /малу літеру/));
  it('без великої літери', () => assert.match(bad('kyiv#gym24').problem, /велику літеру/));
  it('без цифри', () => assert.match(bad('Kyiv#GymPro').problem, /цифру/));
  it('без символу', () => assert.match(bad('KyivGym2024').problem, /символ/));
});

describe('Пароль: словникові й візерункові', () => {
  /* Головний випадок: рівно те, від чого це все й робилось. */
  it('«12345678» не проходить', () => {
    bad('12345678');
    bad('123456789');
  });

  it('відоме слово під маскуванням — ні', () => {
    bad('Password1!');
    bad('P@ssw0rd1');
    bad('Qwerty123!');
    bad('Passw0rd$');
  });

  it('послідовності, навіть із хвостом для галочки', () => {
    bad('Abcdefg1!');
    bad('Qwertyui1!');
  });

  it('повтори одного шматка', () => {
    bad('Ab1!Ab1!');
    bad('aaaaaaaaA1!');   // однакові літери + хвіст заради вимог
  });
});

describe('Пароль: власні дані', () => {
  it('містить пошту — ні', () => {
    bad('Matthew#2026', { email: 'matthew@gmail.com' });
  });

  it('містить нік — ні', () => {
    bad('Ironathlete!9', { username: 'IronAthlete' });
  });

  it('короткий нік не блокує пів словника', () => {
    good('Kyiv#Gym24', { username: 'Ars' });
  });
});

describe('Пароль: що МАЄ проходити', () => {
  it('звичайні надійні паролі', () => {
    good('Kyiv#Gym24');
    good('Sn0w-Bridge-77');
    good('Tr0mb0ne$Rain');
    good('Zx7$mopLar');
  });

  it('довший пароль отримує вищу оцінку', () => {
    const short = P.check('Ab1!xyzq');        // 8
    const long = P.check('Sn0w-Bridge-2026'); // 16
    assert.ok(long.score > short.score, short.score + ' → ' + long.score);
    assert.equal(long.score, 3);
  });

  it('оцінка не робить пароль недійсним', () => {
    const r = P.check('Ab1!xyzq');
    assert.equal(r.ok, true);
    assert.equal(r.problem, '');
  });
});

describe('Пароль: без падінь на дивному вводі', () => {
  it('null, undefined, число', () => {
    assert.equal(P.check(null).ok, false);
    assert.equal(P.check(undefined).ok, false);
    assert.equal(P.check(12345678).ok, false);
  });

  it('контекст без полів не ламає', () => {
    good('Kyiv#Gym24', {});
    good('Kyiv#Gym24');
  });
});
