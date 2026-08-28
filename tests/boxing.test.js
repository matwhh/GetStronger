/**
 * Бокс — дані сесії й текст для буфера обміну.
 *
 * Головне, що тут стережуть тести: сторінка й скопійований текст беруть
 * одні й ті самі дані. Якщо в раунд додати комбінацію, а в генератор
 * тексту забути — у нотатках лишиться вчорашнє тренування, і помітити це
 * можна буде вже в залі. Тому кожен рядок даних перевіряється на
 * присутність у тексті.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const B = loadModules(['js/boxing-data.js']).BOXING;
const S = B.session;
const TEXT = B.sessionText();

const bag = S.sections.find((s) => s.id === 'bag');
const shadow = S.sections.find((s) => s.id === 'shadow');

describe('структура сесії', () => {
  it('пʼять секцій у заданому порядку', () => {
    // join, а не deepEqual: масиви приходять із пісочниці vm і мають інший
    // прототип Array, тому strict deepEqual падає на «same structure but
    // not reference-equal». Та сама пастка вже ловила тести ядра.
    assert.equal(
      S.sections.map((s) => s.id).join(','),
      'warmup,technique,shadow,bag,cooldown'
    );
  });

  it('номери секцій ідуть підряд від 1', () => {
    S.sections.forEach((s, i) => assert.equal(s.n, i + 1));
  });

  it('у кожної секції є назва, час і непорожній вміст', () => {
    for (const s of S.sections) {
      assert.ok(s.title, 'немає назви');
      assert.ok(s.time, `${s.id}: немає часу`);
      const size = (s.groups || []).length + (s.rounds || []).length + (s.items || []).length;
      assert.ok(size > 0, `${s.id}: порожня секція`);
    }
  });

  it('жоден список у сесії не порожній', () => {
    for (const s of S.sections) {
      (s.groups || []).forEach((g) => {
        assert.ok(g.title, `${s.id}: група без назви`);
        assert.ok(g.items.length > 0, `${s.id}/${g.title}: порожній список`);
      });
      (s.rounds || []).forEach((r) => {
        assert.ok(r.items.length > 0, `${s.id}/раунд ${r.n}: порожній список`);
      });
    }
  });
});

describe('мішок — основна частина', () => {
  it('вісім раундів із наскрізною нумерацією', () => {
    assert.equal(bag.rounds.length, 8);
    bag.rounds.forEach((r, i) => assert.equal(r.n, i + 1));
  });

  it('опціональні саме 7 і 8', () => {
    const opt = bag.rounds.filter((r) => r.optional).map((r) => r.n);
    assert.equal(opt.join(','), '7,8');
  });

  it('у кожного раунду є назва, час, інтенсивність і комбінації', () => {
    for (const r of bag.rounds) {
      assert.ok(r.name, `раунд ${r.n}: немає назви`);
      assert.equal(r.time, '3:00', `раунд ${r.n}: не 3:00`);
      assert.match(r.intensity, /^\d+–\d+%$/, `раунд ${r.n}: інтенсивність «${r.intensity}»`);
      assert.ok(r.items.length >= 5, `раунд ${r.n}: замало пунктів`);
    }
  });

  it('у кожного раунду є мета або принцип роботи', () => {
    // Раунд без мети — це просто список ударів. Саме мета відрізняє
    // «шостий раунд» від «ще три хвилини побити мішок».
    for (const r of bag.rounds) {
      assert.ok(r.goal || r.after, `раунд ${r.n}: ні мети, ні принципу`);
    }
  });

  it('інтенсивність не падає від раунду до раунду', () => {
    // Сесія побудована на зростанні: технічні раунди спочатку,
    // кондиційні в кінці. Раунд 8 — фристайл, там нижня межа знову
    // опускається навмисно, тому перевіряємо перші сім.
    const low = (r) => Number(r.intensity.split('–')[0]);
    for (let i = 1; i < 7; i++) {
      assert.ok(low(bag.rounds[i]) >= low(bag.rounds[i - 1]),
        `раунд ${i + 1} легший за попередній`);
    }
  });

  it('тіньовий бій — два раунди по 3:00', () => {
    assert.equal(shadow.rounds.length, 2);
    shadow.rounds.forEach((r) => assert.equal(r.time, '3:00'));
  });
});

describe('текст для буфера обміну', () => {
  it('починається з шапки, яку чекає Apple Notes', () => {
    const lines = TEXT.split('\n');
    assert.equal(lines[0], 'БОКС — СУБОТНЄ ТРЕНУВАННЯ');
    assert.equal(lines[1], 'Тривалість: 60–70 хв');
    assert.equal(lines[2], 'Формат: 3 хв робота / 1 хв відпочинок');
  });

  it('містить усі пʼять секцій заголовками', () => {
    for (const s of S.sections) {
      const head = `${s.n}. ${s.title.toUpperCase()} — ${s.time.toUpperCase()}`;
      assert.ok(TEXT.includes(head), `немає заголовка «${head}»`);
    }
  });

  it('містить усі вісім раундів мішка', () => {
    for (const r of bag.rounds) {
      assert.ok(TEXT.includes(`РАУНД ${r.n} — ${r.name.toUpperCase()}`),
        `немає раунду ${r.n}`);
    }
  });

  it('ЖОДЕН пункт даних не загубився в тексті', () => {
    // Саме цей тест ловить розходження сторінки й нотатки.
    const all = [];
    for (const s of S.sections) {
      (s.groups || []).forEach((g) => all.push(...g.items));
      (s.rounds || []).forEach((r) => all.push(...r.items));
      (s.items || []).forEach((i) => all.push(i));
    }
    assert.ok(all.length > 60, 'підозріло мало пунктів — дані зникли?');
    for (const item of all) {
      assert.ok(TEXT.includes('- ' + item), `у тексті немає пункту «${item}»`);
    }
  });

  it('опціональні раунди позначені й у тексті', () => {
    assert.ok(TEXT.includes('РАУНД 7 — КОНДИЦІЙНИЙ · 3:00 · опціональний'));
    assert.ok(TEXT.includes('РАУНД 8 — ФРИСТАЙЛ / БІЙ · 3:00 · опціональний'));
    // А неопціональні — НЕ позначені
    assert.ok(!TEXT.includes('РАУНД 6 — БОЙОВИЙ РАУНД · 3:00 · опціональний'));
  });

  it('мета й приклади потрапляють у текст', () => {
    assert.ok(TEXT.includes('Мета: Відчути дистанцію і не стояти перед мішком.'));
    assert.ok(TEXT.includes('Приклад: 1–2 → ухил → 3–2 → вихід → 1–2 → крок убік → 2–3'));
  });

  it('без порожніх рядків підряд і без пробілів у кінці', () => {
    // Notes показує подвійні порожні рядки як діри в структурі.
    const lines = TEXT.split('\n');
    for (let i = 1; i < lines.length; i++) {
      assert.ok(!(lines[i] === '' && lines[i - 1] === ''), `подвійний порожній рядок у ${i}`);
    }
    for (const l of lines) assert.equal(l, l.replace(/\s+$/, ''), `пробіли в кінці: «${l}»`);
    assert.notEqual(TEXT[TEXT.length - 1], '\n');
  });

  it('функція чиста: два виклики дають однаковий результат', () => {
    assert.equal(B.sessionText(), TEXT);
  });
});
