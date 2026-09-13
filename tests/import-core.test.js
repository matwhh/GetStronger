/**
 * ПЕРЕВІРКА ІМПОРТОВАНОГО ПРОФІЛЮ.
 *
 * Досі цей код узагалі не мав юнітів — і не міг їх мати: він жив
 * усередині обробника подій у wireProfileForm(), функції на 1036 рядків.
 * Перевірити його можна було лише через браузер, тобто повільно й лише
 * тими файлами, які хтось не полінувався підготувати.
 *
 * А це найнедовірливіший код у проєкті: він розбирає ФАЙЛ, який людина
 * могла відредагувати руками, склеїти з чужого експорту або просто
 * підсунути навмання. Помилка тут не падає — вона тихо кладе в профіль
 * те, чого там бути не повинно, і живе там роками.
 *
 * Тому перевіряється не «функція щось повертає», а три речі:
 *   1. чуже не проходить (ключі, типи, межі, вкладене сміття);
 *   2. своє не втрачається — зокрема null як чинне «не задано»;
 *   3. відповідь чесна: що взято, що відкинуто.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const w = loadModules(['js/date-core.js', 'js/age-core.js', 'js/measure-core.js', 'js/import-core.js']);
const I = w.ImportCore;

/* safeUrl живе в App і тут не перевіряється — підставляємо чесну
   заглушку, яка нічого не змінює, щоб побачити саме роботу валідатора. */
w.App = w.App || {};
w.App.safeUrl = function (u) { return /^https?:\/\//.test(String(u)) ? String(u) : ''; };

const V = (o) => I.validate(o);

describe('білий список ключів', () => {
  test('невідомі ключі не проходять — і МОВЧКИ', () => {
    /* Дві різні речі, які легко переплутати:
         невідомий ключ  → просто не береться, у «відкинутих» його немає;
         відомий, але зіпсований → саме він потрапляє в rejected.
       Інакше людині показали б список із сорока «відкинутих» полів
       чужого JSON — і вона вирішила б, що імпорт зламався. */
    const r = V({ weight: 80, чужий: 'ключ', script: '<img>' });
    assert.equal(r.patch.weight, 80);
    assert.ok(!('чужий' in r.patch));
    assert.ok(!r.rejected.includes('чужий'), 'невідоме не має потрапляти в звіт');
  });

  test('а відомий, але зіпсований ключ — потрапляє у звіт', () => {
    const r = V({ weight: 'вісімдесят' });
    assert.ok(!('weight' in r.patch));
    assert.ok(r.rejected.includes('weight'));
  });

  test('version і updatedAt свідомо НЕ переносяться', () => {
    /* Імпорт — це патч на вже версійований профіль. Прийняти чужу
       version означало б відкотити профіль до стану файла й не дати
       міграціям спрацювати. */
    const r = V({ version: 2, updatedAt: '2020-01-01', weight: 80 });
    assert.ok(!('version' in r.patch));
    assert.ok(!('updatedAt' in r.patch));
  });

  test('НЕ обʼєкт на вході не валить перевірку', () => {
    /* Досі це падало з «Cannot use \'in\' operator»: сторож стояв у того,
       хто кличе, а не тут. Поки виклик був один — працювало. */
    for (const bad of [{}, null, undefined, [], 'рядок', 42, true]) {
      const r = V(bad);
      assert.ok(r && typeof r === 'object', String(bad));
      assert.ok(Array.isArray(r.taken) && Array.isArray(r.rejected), String(bad));
      assert.equal(Object.keys(r.patch).length, 0, String(bad));
    }
  });

  test('відповідь чесна: узяте перелічене', () => {
    const r = V({ sex: 'male', weight: 80, height: 'ні' });
    assert.ok(r.taken.includes('weight'));
    assert.ok(r.taken.includes('sex'));
    assert.ok(r.rejected.includes('height'));
  });
});

describe('числа й межі', () => {
  test('вага й зріст приймаються, сміття — ні', () => {
    assert.equal(V({ weight: 82.5 }).patch.weight, 82.5);
    assert.ok(!('weight' in V({ weight: 'вісімдесят' }).patch));
    assert.ok(!('weight' in V({ weight: NaN }).patch));
  });

  test('фізіологічно неможливе відкидається', () => {
    /* Захист не від зловмисника, а від зіпсованого файла: 900 кг у
       профілі зробить безглуздими і калорії, і рейтинг. */
    assert.ok(!('weight' in V({ weight: 900 }).patch));
    assert.ok(!('weight' in V({ weight: -5 }).patch));
    assert.ok(!('height' in V({ height: 400 }).patch));
  });

  test('стать приймає лише відоме', () => {
    assert.equal(V({ sex: 'male' }).patch.sex, 'male');
    assert.equal(V({ sex: 'female' }).patch.sex, 'female');
    assert.ok(!('sex' in V({ sex: 'хтозна' }).patch));
  });
});

describe('null як чинне «не задано»', () => {
  test('для ЖУРНАЛІВ null — навпаки, втрата даних', () => {
    /* Журнали й реєстри мають порожню форму {} або [], і підміна їх на
       null стерла б історію замість «не задано». Такий ключ чесно
       потрапляє у звіт відкинутих. */
    const r = V({ weightLog: null, sessionLog: null, trackers: null });
    assert.ok(!('weightLog' in r.patch));
    assert.ok(r.rejected.includes('weightLog'));
    assert.ok(r.rejected.includes('sessionLog'));
  });

  test('скаляри профілю теж бувають «не задані»', () => {
    /* weight, height, sex і решта анкети в blankProfile() — саме null:
       профіль, який ще не заповнили. Відкидати тут null означало б, що
       імпорт чистого профілю лишає в ньому старі числа. */
    assert.equal(V({ weight: null }).patch.weight, null);
    assert.equal(V({ sex: null }).patch.sex, null);
  });
});

describe('вкладені структури', () => {
  test('журнал дат приймає лише ключі-дати з числами', () => {
    const r = V({ bodyLog: { '2026-09-12': 82, 'не дата': 80, '2026-09-13': 'важко' } });
    const log = r.patch.bodyLog || {};
    assert.equal(log['2026-09-12'], 82);
    assert.ok(!('не дата' in log));
    assert.ok(!('2026-09-13' in log));
  });

  test('журнал не тягне за собою мільйон ключів', () => {
    const huge = {};
    for (let i = 0; i < 20000; i++) huge['2026-01-' + String((i % 28) + 1).padStart(2, '0') + i] = 80;
    const r = V({ bodyLog: huge });
    const n = Object.keys(r.patch.bodyLog || {}).length;
    assert.ok(n < 20000, 'узято ключів: ' + n);
  });

  test('масив замість обʼєкта не проходить', () => {
    assert.ok(!('bodyLog' in V({ bodyLog: [1, 2, 3] }).patch));
    assert.ok(!('weights' in V({ weights: 'ні' }).patch));
  });

  test('робочі ваги — плаский словник «вправа → число»', () => {
    const r = V({ weights: { 'Жим лежачи': 100, 'Присід': 'багато', 'Тяга': 140 } });
    const wgt = r.patch.weights || {};
    assert.equal(wgt['Жим лежачи'], 100);
    assert.equal(wgt['Тяга'], 140);
    assert.ok(!('Присід' in wgt));
  });
});

describe('чуже посилання не проїде', () => {
  test('URL рецепта проходить через safeUrl', () => {
    const r = V({ recipes: [{ name: 'Каша', url: 'javascript:alert(1)', items: [] }] });
    const list = r.patch.recipes || [];
    if (list.length) assert.equal(list[0].url, '', 'javascript: не має лишитись');
  });
});

describe('не мутує вхідний файл', () => {
  test('обʼєкт, який дали, лишається як був', () => {
    const src = { weight: 80, bodyLog: { '2026-09-12': 82 }, чуже: 1 };
    const copy = JSON.parse(JSON.stringify(src));
    V(src);
    assert.deepEqual(JSON.parse(JSON.stringify(src)), copy);
  });
});

/*
 * Заморожені позиції (F1) на імпорті.
 *
 * Валідатор — білий список: усе, чого він не знає, ЗНИКАЄ мовчки. Тому
 * поява нового поля в профілі — це завжди ще й правка тут, інакше
 * відновлення з резервної копії тихо забирає в людини те, що вона
 * бачила на екрані до експорту.
 */
describe('копія дня: заморожені позиції', () => {
  const snapItem = {
    kind: 'snap', name: 'Курка (знімок)', unit: 'g', qty: 200,
    per: { kcal: 1.65, p: 0.31, f: 0.036, c: 0, fiber: 0 },
    foodId: 'chicken-breast', cooked: true
  };

  test('snap у поточному дні проходить і не втрачає КБЖВ', () => {
    const r = V({ day: { meals: [{ name: 'Обід', items: [snapItem] }], date: '2026-09-10' } });
    const it = r.patch.day.meals[0].items[0];
    assert.equal(it.kind, 'snap');
    assert.equal(it.qty, 200);
    assert.equal(it.unit, 'g');
    assert.equal(it.per.kcal, 1.65);
    assert.equal(it.per.p, 0.31);
    /* id джерела — підказка для копії: без нього скопійований рис
       перестав би перераховуватись у готовий */
    assert.equal(it.foodId, 'chicken-breast');
    assert.equal(it.cooked, true);
  });

  test('snap без per і без qty валить день, а не тихо кладе нуль', () => {
    const r = V({ day: { meals: [{ name: 'Обід', items: [{ kind: 'snap', name: 'X' }] }] } });
    assert.ok(r.rejected.includes('day'), 'битий snap мусить відкинути день цілком');
  });

  test('знімок прийомів у mealLog доживає до профілю', () => {
    const r = V({ mealLog: { '2026-09-10': {
      kcal: 2100, p: 150, f: 60, c: 210, fiber: 25, target: 2200, pTarget: 150,
      meals: [{ name: 'Сніданок', items: [snapItem] }]
    } } });
    const e = r.patch.mealLog['2026-09-10'];
    assert.equal(e.kcal, 2100);
    assert.ok(Array.isArray(e.meals), 'знімок позицій зник на імпорті');
    assert.equal(e.meals[0].items[0].qty, 200);
    assert.equal(e.meals[0].name, 'Сніданок');
  });

  test('битий знімок не тягне за собою підсумок дня', () => {
    const r = V({ mealLog: { '2026-09-10': {
      kcal: 2100, p: 150, f: 60, c: 210, fiber: 25,
      meals: [{ name: 'Сніданок', items: [{ kind: 'food', foodId: 'x', grams: 10 }] }]
    } } });
    const e = r.patch.mealLog['2026-09-10'];
    assert.equal(e.kcal, 2100, 'підсумок дня мусить лишитись');
    assert.equal(e.meals, undefined, 'знімок із чужими позиціями не приймається');
  });

  test('знімок без жодної позиції не зберігається', () => {
    const r = V({ mealLog: { '2026-09-10': {
      kcal: 2100, p: 150, f: 60, c: 210, fiber: 25,
      meals: [{ name: 'Сніданок', items: [] }]
    } } });
    assert.equal(r.patch.mealLog['2026-09-10'].meals, undefined);
  });

  test('qty і per за межами — позиція не проходить', () => {
    const huge = Object.assign({}, snapItem, { qty: 999999 });
    const r = V({ day: { meals: [{ name: 'Обід', items: [huge] }] } });
    assert.ok(r.rejected.includes('day'));
  });
});
