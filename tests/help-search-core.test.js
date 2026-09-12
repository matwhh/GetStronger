/**
 * ПОШУК ПО ДОВІДЦІ.
 *
 * Стережеться не «щось знаходиться», а три речі, на яких пошук стає
 * непотрібним:
 *   1. знаходить у ВСІХ розділах, а не лише в поточному;
 *   2. усі слова запиту мусять бути в одному куснi — інакше «сон трекер»
 *      віддає і абзац про сон, і абзац про трекери, й жоден не відповідає;
 *   3. апостроф не ділить українську мову навпіл.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const w = loadModules(['js/date-core.js', 'js/help-content.js', 'js/help-search-core.js']);
const HS = w.HelpSearchCore;
const CONTENT = w.HELP_CONTENT;
const IDX = HS.buildIndex(CONTENT);

describe('покажчик', () => {
  test('будується з реального вмісту й не порожній', () => {
    assert.ok(IDX.length > 100, 'кусників: ' + IDX.length);
  });

  test('покриває кожен розділ довідки', () => {
    const pages = new Set(IDX.map((r) => r.page));
    for (const page of Object.keys(CONTENT.sections)) {
      assert.ok(pages.has(page), 'немає ' + page);
    }
  });

  test('у кожного кусня є сторінка, назва й непорожній текст', () => {
    for (const r of IDX) {
      assert.ok(r.page, 'кусень без сторінки');
      assert.ok(r.title, r.page + ': кусень без назви розділу');
      assert.ok(r.text.trim().length > 0, r.page + ': порожній текст');
    }
  });

  test('порожній або кривий вміст не валить збірку', () => {
    assert.equal(HS.buildIndex(null).length, 0);
    assert.equal(HS.buildIndex({}).length, 0);
    assert.equal(HS.buildIndex({ sections: {} }).length, 0);
  });

  test('блок будь-якого типу перетворюється на текст', () => {
    assert.equal(HS.blockText({ t: 'p', text: 'абзац' }), 'абзац');
    assert.match(HS.blockText({ t: 'list', items: ['a', 'b'] }), /a.*b/);
    assert.match(HS.blockText({ t: 'dl', items: [['термін', 'опис']] }), /термін.*опис/);
    assert.match(HS.blockText({ t: 'table', head: ['к1'], rows: [['з1']] }), /к1.*з1/);
    assert.equal(HS.blockText(null), '');
    assert.equal(HS.blockText({ t: 'невідомий' }), '');
  });
});

describe('нормалізація', () => {
  test('регістр не має значення', () => {
    assert.equal(HS.norm('РІЗНИЦЯ'), HS.norm('різниця'));
  });

  test('усі апострофи — один', () => {
    const forms = ["зʼїсти", "з’їсти", "з'їсти", "з`їсти"];
    const first = HS.norm(forms[0]);
    for (const f of forms) assert.equal(HS.norm(f), first, f);
  });

  test('тире різного роду теж зводяться', () => {
    assert.equal(HS.norm('8–10'), HS.norm('8-10'));
    assert.equal(HS.norm('8—10'), HS.norm('8-10'));
  });

  test('зайві пробіли прибираються', () => {
    assert.equal(HS.norm('  два   слова \n'), 'два слова');
  });
});

describe('пошук', () => {
  const find = (q) => HS.search(IDX, q);

  test('закороткий запит нічого не повертає — інакше «а» віддає всю довідку', () => {
    assert.equal(find('').length, 0);
    assert.equal(find('а').length, 0);
    assert.equal(find(' ').length, 0);
  });

  test('знаходить по слову з тексту, а не лише з назви розділу', () => {
    const r = find('RIR');
    assert.ok(r.length > 0, 'нічого не знайдено');
  });

  test('шукає по ВСІХ сторінках, а не по одній', () => {
    const r = find('вага');
    const pages = new Set(r.map((x) => x.page));
    assert.ok(pages.size > 1, 'сторінок у видачі: ' + pages.size);
  });

  test('усі слова запиту мають бути в одному куснi', () => {
    const r = HS.search([
      { page: 'a', title: 'A', heading: '', text: 'тільки про сон',
        nText: 'тільки про сон', nTitle: 'a', nHeading: '' },
      { page: 'b', title: 'B', heading: '', text: 'тільки про трекери',
        nText: 'тільки про трекери', nTitle: 'b', nHeading: '' },
      { page: 'c', title: 'C', heading: '', text: 'сон вводиться в трекери',
        nText: 'сон вводиться в трекери', nTitle: 'c', nHeading: '' }
    ], 'сон трекери');
    assert.equal(r.length, 1);
    assert.equal(r[0].page, 'c');
  });

  test('збіг у назві розділу важить більше за збіг у чужому абзаці', () => {
    const r = HS.search([
      { page: 'other', title: 'Щось інше', heading: '', text: 'тут згадана періодизація мимохідь',
        nText: 'тут згадана періодизація мимохідь', nTitle: 'щось інше', nHeading: '' },
      { page: 'per', title: 'Періодизація', heading: '', text: 'цикл навантаження',
        nText: 'цикл навантаження', nTitle: 'періодизація', nHeading: '' }
    ], 'періодизація');
    assert.equal(r[0].page, 'per');
  });

  test('апостроф у запиті не ламає збіг', () => {
    const idx = [{ page: 'x', title: 'X', heading: '', text: "обʼєм за тиждень",
                   nText: HS.norm("обʼєм за тиждень"), nTitle: 'x', nHeading: '' }];
    for (const q of ["обʼєм", "об’єм", "об'єм"]) {
      assert.equal(HS.search(idx, q).length, 1, q);
    }
  });

  test('довгий абзац скорочується до кусня навколо збігу', () => {
    const long = 'початок '.repeat(40) + 'ГОЛКА ' + 'кінець '.repeat(40);
    const idx = [{ page: 'x', title: 'X', heading: '', text: long,
                   nText: HS.norm(long), nTitle: 'x', nHeading: '' }];
    const r = HS.search(idx, 'голка');
    assert.ok(r[0].text.length < 220, 'довжина кусня: ' + r[0].text.length);
    assert.match(r[0].text, /ГОЛКА/i);
  });

  test('видача обмежена limit', () => {
    const r = HS.search(IDX, 'а тренування', { limit: 3 });
    assert.ok(r.length <= 3, 'результатів: ' + r.length);
  });

  test('чого немає — того не знаходить', () => {
    assert.equal(find('крокодилопарк').length, 0);
  });

  test('інструкція до сайту теж шукається', () => {
    assert.ok(CONTENT.guide, 'у довідці немає загальної інструкції');
    const pages = new Set(HS.buildIndex(CONTENT).map((r) => r.page));
    assert.ok(pages.has('guide'));
  });
});
