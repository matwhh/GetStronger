/**
 * Цілісність довідників.
 *
 * Тут не формули, а дані — і саме в них помилка найтихіша: неправильні
 * калорії продукту чи вправа без групи нічого не ламають, вони просто
 * дають неправильну відповідь. Ці тести ловлять розсинхрон між даними
 * і правилами, які на них спираються.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadExercises, loadFoods, loadModules } from './helpers.js';

const W = loadExercises();
const { MUSCLES, EXERCISES, VOLUME_CAP, musclesOfExercise, primaryMuscle, liftKind } = W;

describe('групи мʼязів', () => {
  it('усі id унікальні', () => {
    const ids = MUSCLES.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('у кожної групи є назва й розмір', () => {
    for (const m of MUSCLES) {
      assert.ok(m.name, `група ${m.id} без назви`);
      assert.ok(m.size === 'large' || m.size === 'small', `група ${m.id}: size = ${m.size}`);
    }
  });

  it('стеля обʼєму відповідає розміру групи', () => {
    /*
     * TST-013: тут стояло assert.equal(m.cap ?? VOLUME_CAP[m.size], expected),
     * де expected — той самий вираз. Тавтологія: тест проходив за будь-яких
     * чисел, у тому числі за розсинхронізованих. Тепер числа названі явно —
     * зміна VOLUME_CAP має бути свідомою і видимою в diff.
     */
    assert.equal(VOLUME_CAP.large, 14, 'стеля великої групи');
    assert.equal(VOLUME_CAP.small, 12, 'стеля малої групи');
    for (const m of MUSCLES) {
      assert.equal(typeof m.cap, 'number', `група ${m.id}: cap не число`);
      assert.ok(m.cap <= VOLUME_CAP[m.size],
        `група ${m.id}: cap ${m.cap} більший за стелю розміру ${VOLUME_CAP[m.size]}`);
      assert.ok(m.cap > 0, `група ${m.id}: cap ${m.cap}`);
    }
    /* Явний cap — виняток для окремої групи. Поки винятків немає, кожна
       група має рівно стелю свого розміру; поява винятку має бути помітною. */
    /* Порівнюємо довжину, а не масиви: MUSCLES приходить із пісочниці vm,
       і в його похідних масивів інший прототип — deepStrictEqual падає
       навіть на двох порожніх. */
    const custom = MUSCLES.filter((m) => m.cap !== VOLUME_CAP[m.size]).map((m) => m.id);
    assert.equal(custom.length, 0,
      'зʼявились групи з власною стелею (' + custom.join(', ') + ') — це свідоме рішення?');
  });
});

describe('бібліотека вправ', () => {
  it('назви унікальні', () => {
    const names = EXERCISES.map((e) => e.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual([...new Set(dupes)], [], 'дублікати назв: ' + [...new Set(dupes)].join(', '));
  });

  it('кожна вправа посилається лише на наявні групи', () => {
    const ids = new Set(MUSCLES.map((m) => m.id));
    for (const e of EXERCISES) {
      assert.ok(Array.isArray(e.muscles) && e.muscles.length, `${e.name}: немає muscles`);
      for (const m of e.muscles) assert.ok(ids.has(m), `${e.name}: невідома група «${m}»`);
    }
  });

  it('lift заповнений і має одне з двох значень', () => {
    for (const e of EXERCISES) {
      assert.ok(e.lift === 'compound' || e.lift === 'isolation', `${e.name}: lift = ${e.lift}`);
    }
  });

  it('liftKind за замовчуванням вважає вправу ізоляцією', () => {
    // Помилитись у цей бік безпечно: людина побачить нижчу стелю відсотків.
    // Помилка в інший бік — це 92% від 1ПМ у розведеннях.
    assert.equal(liftKind({ name: 'Вправа, якої немає в бібліотеці' }), 'isolation');
    assert.equal(liftKind(null), 'isolation');
  });

  it('кожна група має хоча б одну вправу, де вона ГОЛОВНА', () => {
    // Без цього кнопка «додати вправу на групу» не змогла б нічого
    // запропонувати: вона свідомо шукає вправу саме з такою головною групою,
    // інакше підходи пішли б не туди, куди просили.
    const primary = new Set(EXERCISES.map((e) => primaryMuscle(e)));
    for (const m of MUSCLES) {
      assert.ok(primary.has(m.id), `для групи «${m.name}» немає вправи, де вона головна`);
    }
  });
});

describe('правило зарахування підходів', () => {
  it('primaryMuscle повертає ПЕРШУ групу, а не всі', () => {
    // Ключове правило проєкту: підходи йдуть у головну групу. Раніше код
    // додавав їх кожній, і «Румунська тяга» роздувала обидві — смуга
    // «Сідниці» показувала 12/14 замість 6/14.
    assert.equal(primaryMuscle({ muscles: ['hamstrings', 'glutes'] }), 'hamstrings');
    assert.equal(primaryMuscle({ muscles: ['chest'] }), 'chest');
    assert.equal(primaryMuscle({ muscles: [] }), null);
    assert.equal(primaryMuscle({}), null);
  });

  it('musclesOfExercise повертає всі групи — він для пошуку, не для обʼєму', () => {
    assert.equal(musclesOfExercise({ muscles: ['hamstrings', 'glutes'] }).length, 2);
  });
});

describe('базові схеми не перевищують стель обʼєму', () => {
  it('жодна програма × кількість днів не виходить за межу', () => {
    const w = loadModules(['js/exercises.js', 'js/programs-data.js']);
    const cap = (id) => {
      const m = w.MUSCLES.find((x) => x.id === id);
      return m ? (m.cap ?? w.VOLUME_CAP[m.size]) : Infinity;
    };

    for (const program of w.PROGRAMS) {
      for (const days of Object.keys(program.days)) {
        const totals = Object.create(null);
        for (const day of program.days[days]) {
          for (const ex of day.exercises) {
            const main = w.primaryMuscle(ex);
            if (!main) continue;
            totals[main] = (totals[main] || 0) + (Number(ex.sets) || 0);
          }
        }
        for (const [id, sets] of Object.entries(totals)) {
          assert.ok(sets <= cap(id),
            `${program.id}/${days} днів: група «${id}» = ${sets} підходів при стелі ${cap(id)}`);
        }
      }
    }
  });
});

describe('довідник продуктів', () => {
  const FOODS = loadFoods().FOODS;

  it('id унікальні', () => {
    const ids = FOODS.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('у кожного продукту є назва, група й КБЖВ', () => {
    for (const f of FOODS) {
      assert.ok(f.name, `${f.id}: немає назви`);
      assert.ok(f.group, `${f.id}: немає групи`);
      assert.ok(f.per100, `${f.id}: немає per100`);
      for (const k of ['kcal', 'p', 'f', 'c']) {
        assert.equal(Number.isFinite(f.per100[k]), true, `${f.id}: ${k} = ${f.per100[k]}`);
        assert.ok(f.per100[k] >= 0, `${f.id}: ${k} відʼємне`);
      }
    }
  });

  it('коефіцієнт виходу після готування додатний', () => {
    for (const f of FOODS) {
      assert.ok(Number.isFinite(f.yield) && f.yield > 0, `${f.id}: yield = ${f.yield}`);
    }
  });

  it('жоден продукт не перевищує 900 ккал/100 г', () => {
    // Чиста олія — 884. Усе, що вище, означає помилку в даних.
    for (const f of FOODS) {
      assert.ok(f.per100.kcal <= 900, `${f.id}: ${f.per100.kcal} ккал/100 г`);
    }
  });

  it('сума макросів не перевищує 100 г на 100 г продукту', () => {
    for (const f of FOODS) {
      const p = f.per100;
      const total = p.p + p.f + p.c + (p.fiber || 0);
      assert.ok(total <= 101, `${f.id}: макроси дають ${total.toFixed(1)} г на 100 г`);
    }
  });

  it('калорійність узгоджена з макросами (допуск 20% — див. нижче)', () => {
    /*
     * Допуск саме 20%, а не 10%, і це свідомо.
     *
     * README подавав формулу kcal ≈ p·4 + f·9 + c·4 + fiber·2 як «контроль»,
     * але для овочів, ягід і грибів USDA застосовує СПЕЦИФІЧНІ коефіцієнти
     * Атвотера, а не загальні 4/9/4. Через це перевірка падала на 13 зі 100
     * позицій, дані в яких насправді правильні (звірені з USDA).
     *
     * Тому тест ловить те, що ловити варто — грубу помилку в числі, —
     * і не бʼє тривогу на кожен огірок.
     */
    for (const f of FOODS) {
      const p = f.per100;
      if (p.kcal <= 20) continue;   // напої й зелень: відносна похибка тут безглузда
      const calc = p.p * 4 + p.f * 9 + p.c * 4 + (p.fiber || 0) * 2;
      const drift = Math.abs(calc - p.kcal) / p.kcal;
      assert.ok(drift <= 0.20,
        `${f.id}: заявлено ${p.kcal} ккал, макроси дають ${calc.toFixed(0)} (${(drift * 100).toFixed(0)}%)`);
    }
  });

  it('регресія: шрірача має дані шрірачі, а не солодкого чилі-соусу', () => {
    const s = FOODS.find((f) => f.id === 'chili-sauce');
    assert.ok(s.per100.kcal < 110, `шрірача: ${s.per100.kcal} ккал (USDA — 93)`);
  });

  it('регресія: консервований ананас лежить у фруктах', () => {
    assert.equal(FOODS.find((f) => f.id === 'pineapple').group, 'fruit');
  });
});

describe('пошук продуктів', () => {
  const ctx = loadFoods();
  const F = ctx.Foods;
  const LIST = ctx.FOODS;

  it('побутові слова знаходять каталожні назви', () => {
    // Кожне з цих слів давало НУЛЬ результатів, а «курка» ще й стояла
    // підказкою в самому полі пошуку.
    const cases = {
      'курка': 'Куряче філе (грудка)',
      'яйця': 'Яйце куряче, ціле',
      'творог': 'Сир кисломолочний 5%',
      'вівсянка': 'Вівсяні пластівці',
      'овес': 'Вівсяні пластівці',
      'індичка': 'Індиче філе',
      'свинина': 'Свиняча вирізка',
      'риба': 'Лосось'
    };
    for (const [query, expected] of Object.entries(cases)) {
      const found = F.search(query, 'all').map((f) => f.name);
      assert.ok(found.includes(expected), `«${query}» не знаходить «${expected}»`);
    }
  });

  it('пошук за назвою працює як раніше', () => {
    for (const q of ['рис', 'barilla', 'лосось', 'молоко']) {
      assert.ok(F.search(q, 'all').length > 0, `«${q}» нічого не знайшло`);
    }
  });

  it('синонім не підміняє продукт іншим', () => {
    // Вершкового масла й кефіру в базі немає. Показати замість них олію
    // чи йогурт було б гірше, ніж чесно не знайти нічого: у них інші КБЖВ.
    for (const q of ['масло', 'кефір']) {
      assert.equal(F.search(q, 'all').length, 0, `«${q}» знайшло щось, чого в базі немає`);
    }
  });

  it('фільтр за групою й далі звужує пошук', () => {
    const all = F.search('курка', 'all').length;
    const dairy = F.search('курка', 'dairy').length;
    assert.ok(all > 0);
    assert.equal(dairy, 0, 'курка не може бути молочним продуктом');
  });

  it('alias лише в нижньому регістрі — інакше пошук його не побачить', () => {
    // search() опускає запит у нижній регістр, але alias порівнює як є.
    for (const f of LIST) {
      if (!f.alias) continue;
      assert.equal(f.alias, f.alias.toLowerCase(), `${f.id}: alias не в нижньому регістрі`);
    }
  });
});
