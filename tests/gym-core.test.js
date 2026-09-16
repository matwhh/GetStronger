/**
 * Профіль залу (js/gym-core.js): крок ваги береться з того, що в залі
 * реально є, а не з припущення «завжди 2,5 кг».
 *
 * Привід простий. Крок 2,5 кг — це пара млинців по 1,25. Якщо таких
 * млинців у залі немає, найменша добавка до штанги — 5 кг (пара
 * двійок із половиною) або навіть 10 (пара пʼятірок), і вся прогресія,
 * яку показує сайт, — вигадка. На гантельному ряду з кроком 2 кг
 * «+2,5» не існує в принципі, а на тренажері зі стеком по 5 — тим паче.
 *
 * Під вартою:
 *   • штанга збирається ЛИШЕ з наявних пар млинців;
 *   • гантельний ряд і стек тренажера мають свої кроки;
 *   • порожній профіль поводиться рівно так, як поводився сайт досі;
 *   • сміття в інвентарі не ламає підрахунку і не вигадує ваг.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules(['js/onerm-core.js', 'js/gym-core.js']);
const G = ctx.GymCore;

/* Типовий зал: олімпійський гриф і повний набір млинців */
const FULL = {
  bar: 20,
  plates: [{ kg: 20, pairs: 2 }, { kg: 10, pairs: 2 }, { kg: 5, pairs: 2 },
           { kg: 2.5, pairs: 2 }, { kg: 1.25, pairs: 2 }],
  dumbbells: { from: 2, to: 30, step: 2 },
  machineStep: 5
};

/* Підвал: гриф і три пари великих млинців, дрібних немає */
const POOR = { bar: 20, plates: [{ kg: 20, pairs: 2 }, { kg: 10, pairs: 2 }, { kg: 5, pairs: 2 }] };

describe('gym-core: штанга збирається з наявних млинців', () => {
  it('порожня штанга — це вага грифа', () => {
    assert.equal(G.achievable(0, 'barbell', FULL), 20);
    assert.equal(G.achievable(15, 'barbell', FULL), 20, 'легше за гриф не буває');
  });

  it('найменший крок — пара найлегших млинців', () => {
    assert.equal(G.nextUp(20, 'barbell', FULL), 22.5);
    assert.equal(G.nextUp(20, 'barbell', POOR), 30, 'без дрібних млинців наступна вага — +10');
  });

  it('вага, якої не зібрати, підтягується до найближчої збірної', () => {
    assert.equal(G.achievable(23, 'barbell', FULL), 22.5);
    assert.equal(G.achievable(24, 'barbell', FULL), 25);
    assert.equal(G.achievable(27, 'barbell', POOR), 30);
  });

  it('вище за все, що є в залі, — стеля, а не вигадка', () => {
    /* pairs — це ПАРИ, а не штуки: «2» означає чотири млинці й дві
       пари на штангу. Стеля = 20 + 4 × (20 + 10 + 5 + 2,5 + 1,25) = 175. */
    assert.equal(G.achievable(500, 'barbell', FULL), 175);
    assert.equal(G.nextUp(175, 'barbell', FULL), null, 'додати нічого');
  });

  it('крок біля ваги — різниця до наступної збірної', () => {
    assert.equal(G.stepFor(60, 'barbell', FULL), 2.5);
    assert.equal(G.stepFor(60, 'barbell', POOR), 10);
  });
});

describe('gym-core: гантелі й тренажери', () => {
  it('гантельний ряд має свій крок і свої межі', () => {
    assert.equal(G.achievable(7, 'dumbbell', FULL), 6, 'на рівній відстані — легша');
    assert.equal(G.achievable(9, 'dumbbell', FULL), 8);
    assert.equal(G.nextUp(8, 'dumbbell', FULL), 10);
    assert.equal(G.achievable(100, 'dumbbell', FULL), 30, 'важчих у ряду немає');
    assert.equal(G.achievable(1, 'dumbbell', FULL), 2);
  });

  it('стек тренажера — кратне кроку', () => {
    assert.equal(G.achievable(12, 'machine', FULL), 10);
    assert.equal(G.achievable(13, 'machine', FULL), 15);
    assert.equal(G.nextUp(10, 'machine', FULL), 15);
    assert.equal(G.stepFor(40, 'machine', FULL), 5);
  });
});

describe('gym-core: без профілю все як було', () => {
  const EMPTY = G.normGym(null);

  it('важке округлюється до 2,5, легке — до 1', () => {
    assert.equal(G.stepFor(60, 'barbell', EMPTY), 2.5);
    assert.equal(G.stepFor(10, 'dumbbell', EMPTY), 1);
    assert.equal(G.achievable(82.3, 'barbell', EMPTY), 82.5);
    assert.equal(G.achievable(10.4, 'dumbbell', EMPTY), 10);
  });

  it('стелі немає: порожній профіль нічого не обмежує', () => {
    assert.equal(G.achievable(300, 'barbell', EMPTY), 300);
    assert.equal(G.nextUp(300, 'barbell', EMPTY), 302.5);
  });

  it('профіль без млинців — теж порожній профіль', () => {
    const noPlates = G.normGym({ bar: 20, plates: [] });
    assert.equal(G.achievable(82.3, 'barbell', noPlates), 82.5);
  });
});

describe('gym-core: вид снаряда за назвою вправи', () => {
  it('назва називає снаряд', () => {
    assert.equal(G.kindOf('Жим штанги лежачи'), 'barbell');
    assert.equal(G.kindOf('Жим штанги під нахилом у Сміті'), 'barbell');
    assert.equal(G.kindOf('Махи з гантелями сидячи'), 'dumbbell');
    assert.equal(G.kindOf('Тяга верхнього блоку'), 'machine');
    assert.equal(G.kindOf('Біцепс у кросовері'), 'machine');
    assert.equal(G.kindOf('Жим у тренажері'), 'machine');
  });

  it('коли назва мовчить — «інше», і працює старе правило', () => {
    assert.equal(G.kindOf('Підтягування з вагою'), 'other');
    assert.equal(G.kindOf(''), 'other');
    assert.equal(G.kindOf(null), 'other');
    assert.equal(G.achievable(82.3, 'other', FULL), 82.5, 'інше — крок за вагою');
  });
});

describe('gym-core: сміття не ламає й не вигадує', () => {
  it('нормалізація викидає неможливе', () => {
    const g = G.normGym({
      bar: '20', plates: [{ kg: 20, pairs: 2 }, { kg: -5, pairs: 2 }, { kg: 10, pairs: 0 },
                          { kg: 'шість', pairs: 1 }, null, { kg: 900, pairs: 1 }],
      dumbbells: { from: 30, to: 2, step: 0 }, machineStep: -3
    });
    assert.equal(g.bar, 20);
    assert.equal(g.plates.length, 1, JSON.stringify(g.plates));
    assert.equal(g.plates[0].kg, 20);
    assert.equal(g.dumbbells, null, 'ряд «від 30 до 2» не існує');
    assert.equal(g.machineStep, null);
  });

  it('величезний набір млинців не підвішує підрахунок', () => {
    const many = G.normGym({
      bar: 20,
      plates: [{ kg: 20, pairs: 10 }, { kg: 15, pairs: 10 }, { kg: 10, pairs: 10 },
               { kg: 5, pairs: 10 }, { kg: 2.5, pairs: 10 }, { kg: 1.25, pairs: 10 }]
    });
    const t0 = Date.now();
    /* 101,25 не зібрати НІКОЛИ: пара найлегших млинців додає 2,5, отже
       всі збірні ваги кратні 2,5 від грифа. Найближча — 102,5. */
    assert.equal(G.achievable(101.3, 'barbell', many), 102.5);
    assert.equal(Date.now() - t0 < 500, true, 'рахується миттєво');
  });

  it('вага-сміття не дає числа', () => {
    [null, undefined, NaN, 'важко', -5].forEach(function (v) {
      assert.equal(G.achievable(v, 'barbell', FULL), null, String(v));
    });
  });
});
