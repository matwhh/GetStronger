/**
 * Ядро харчування.
 *
 * Головна властивість, яку тут стережуть тести: сума макронутрієнтів
 * ДОРІВНЮЄ цільовій калорійності. Саме її порушення давало найсерйознішу
 * помилку — сторінка показувала одне число зверху й інше в смузі, і сама
 * про це не знала.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadNutrition } from './helpers.js';

const N = loadNutrition();

const sumKcal = (m) =>
  m.protein * N.KCAL.protein + m.fat * N.KCAL.fat + m.carb * N.KCAL.carb + m.fiber * N.KCAL_FIBER;

describe('BMR — звірка з канонічними формулами', () => {
  it('Mifflin-St Jeor, чоловік 80/180/30 = 1780', () => {
    assert.ok(Math.abs((N.bmrMifflin('male', 80, 180, 30)) - (1780)) < 1e-6, `N.bmrMifflin('male', 80, 180, 30) ≈ 1780`);
  });
  it('Mifflin-St Jeor, жінка 60/165/30 = 1320,25', () => {
    assert.ok(Math.abs((N.bmrMifflin('female', 60, 165, 30)) - (1320.25)) < 1e-6, `N.bmrMifflin('female', 60, 165, 30) ≈ 1320.25`);
  });
  it('Katch-McArdle: 370 + 21,6 × суха маса', () => {
    assert.ok(Math.abs((N.bmrKatch(80, 20)) - (370 + 21.6 * 64)) < 1e-6, `N.bmrKatch(80, 20) ≈ 370 + 21.6 * 64`);
  });
});

describe('macros — енергетичний баланс', () => {
  it('регресія: сума макросів дорівнює цілі, а не перевищує її', () => {
    // Аудит: чол. 300 кг / 150 см / 40 р. / жир 60% / агресивне схуднення
    // давав ціль 2666 ккал і макроси на 3270 ккал — тихий дрейф +604.
    const m = N.macros(2666, 300);
    assert.ok((Math.abs(sumKcal(m) - 2666)) < (1), `Math.abs(sumKcal(m) - 2666) має бути < 1`);
  });

  it('баланс тримається на всьому просторі реальних профілів', () => {
    let checked = 0;
    for (const sex of ['male', 'female']) {
      for (let w = 35; w <= 300; w += 5) {
        for (let h = 120; h <= 230; h += 10) {
          for (let a = 14; a <= 90; a += 8) {
            for (const goal of ['cutfast', 'cut', 'maintain', 'bulk', 'bulkfast']) {
              const t = N.targetFor({ sex, weight: w, height: h, age: a, activity: 1.2, goal });
              if (!t) continue;
              checked++;
              assert.ok((Math.abs(sumKcal(t) - t.kcal)) < (1), `Math.abs(sumKcal(t) - t.kcal) має бути < 1`);
            }
          }
        }
      }
    }
    assert.ok((checked) > (10000), `checked має бути > 10000`);
  });

  it('жоден макронутрієнт не буває відʼємним', () => {
    for (let kcal = 200; kcal <= 6000; kcal += 100) {
      for (let w = 35; w <= 300; w += 15) {
        const m = N.macros(kcal, w);
        assert.ok((m.protein) >= (0), `m.protein має бути >= 0`);
        assert.ok((m.fat) >= (0), `m.fat має бути >= 0`);
        assert.ok((m.carb) >= (0), `m.carb має бути >= 0`);
        assert.ok((m.fiber) >= (0), `m.fiber має бути >= 0`);
      }
    }
  });

  it('сміття на вході не дає NaN', () => {
    for (const bad of [0, -1, NaN, Infinity, 1e308, null, undefined, 'abc']) {
      for (const m of [N.macros(bad, 80), N.macros(2000, bad)]) {
        for (const v of [m.protein, m.fat, m.carb, m.fiber]) assert.equal(Number.isFinite(v), true);
      }
    }
  });
});

describe('білок — 1,6…2,2 г на кг маси тіла', () => {
  it('межі діапазону збігаються з Morton 2018 (1,62; 95% ДІ 1,03–2,20)', () => {
    assert.equal(N.PROTEIN_MIN_PER_KG, 1.6);
    assert.equal(N.PROTEIN_MAX_PER_KG, 2.2);
  });

  it('для 70 кг норма 112–154 г', () => {
    const t = N.targetFor({ sex: 'male', weight: 70, height: 178, age: 28, activity: 1.55, goal: 'maintain' });
    assert.equal(Math.round(t.proteinRange[0]), 112);
    assert.equal(Math.round(t.proteinRange[1]), 154);
    assert.equal(Math.round(t.protein), 154);
  });

  it('діапазон завжди min < max і пропорційний вазі', () => {
    for (let w = 40; w <= 200; w += 10) {
      const t = N.targetFor({ sex: 'male', weight: w, height: 178, age: 28, activity: 1.55, goal: 'maintain' });
      if (!t) continue;
      assert.ok(t.proteinRange[0] < t.proteinRange[1], 'нижня межа має бути меншою за верхню');
      assert.ok(Math.abs(t.proteinRange[0] - w * N.PROTEIN_MIN_PER_KG) < 1e-9);
      assert.ok(Math.abs(t.proteinRange[1] - w * N.PROTEIN_MAX_PER_KG) < 1e-9);
    }
  });

  it('стеля білка — саме 35 %, а не «скільки в константі»', () => {
    /*
     * TST-008: тест нижче порівнював частку з N.PROTEIN_MAX_SHARE, тобто з
     * тією самою константою, яку й мав стерегти. Мутант, що міняє 0.35 на
     * 0.50, проходив його не помітивши — а 0.50 це вже пів раціону з
     * білка. Число має бути в тесті ЛІТЕРАЛОМ.
     */
    assert.equal(N.PROTEIN_MAX_SHARE, 0.35);
  });

  it('найгірший профіль аудиту не пробиває 35 %', () => {
    /* Саме на цьому профілі виходило 63,7 % енергії з білка — зона
       білкової інтоксикації. Тримаємо його окремим кейсом, бо в загальному
       переборі нижче він губиться серед тисяч інших. */
    const t = N.targetFor({ sex: 'male', weight: 120, height: 120, age: 90, activity: 1.2, goal: 'cutfast' });
    assert.ok(t, 'профіль має рахуватись');
    const share = t.protein * N.KCAL.protein / t.kcal;
    assert.ok(share <= 0.351, 'частка білка ' + (share * 100).toFixed(1) + ' % > 35 %');
  });

  it('регресія: білок ніколи не перевищує 35% калорійності', () => {
    // Аудит: профіль 120 кг / 120 см / 90 р. на дефіциті давав 63,7%
    // енергії з білка — це вже зона білкової інтоксикації.
    for (const sex of ['male', 'female']) {
      for (let w = 35; w <= 300; w += 5) {
        for (let h = 120; h <= 230; h += 20) {
          for (const goal of ['cutfast', 'cut', 'maintain', 'bulk']) {
            const t = N.targetFor({ sex, weight: w, height: h, age: 30, activity: 1.2, goal });
            if (!t) continue;
            const share = t.protein * N.KCAL.protein / t.kcal;
            /* Літерал, а не константа: інакше тест звіряє константу з нею ж. */
            assert.ok(share <= 0.351,
              `частка білка ${(share * 100).toFixed(1)} % при ${sex} ${w}кг ${h}см ${goal}`);
          }
        }
      }
    }
  });

  it('поки стеля не заважає, білок дорівнює верху діапазону — 2,2 г/кг', () => {
    const t = N.targetFor({ sex: 'male', weight: 80, height: 180, age: 30, activity: 1.55, goal: 'maintain' });
    assert.ok(Math.abs((t.protein) - (176)) < 1e-6, `t.protein ≈ 176`);
  });

  it('коли спрацювала стеля 35%, білок не падає нижче 1,6 г/кг без прапорця', () => {
    // Якщо ціль урізана до частки калорійності, targetFor мусить це
    // ПОЗНАЧИТИ. Мовчазне падіння нижче нижньої межі діапазону — це
    // сторінка, яка показує «1,6–2,2», а рахує 1,1.
    for (let w = 35; w <= 300; w += 5) {
      for (const goal of ['cutfast', 'cut', 'maintain', 'bulk']) {
        const t = N.targetFor({ sex: 'male', weight: w, height: 175, age: 30, activity: 1.2, goal });
        if (!t) continue;
        if (t.protein < w * N.PROTEIN_MIN_PER_KG - 1e-6) {
          assert.equal(t.proteinCapped, true,
            `${w} кг / ${goal}: білок ${t.protein.toFixed(1)} г нижче підлоги, а прапорця немає`);
        }
      }
    }
  });
});

describe('підлога калорійності', () => {
  it('регресія: ціль ніколи не падає нижче базового обміну', () => {
    // Аудит: жінка 50 кг / 160 см / сидяча / агресивне схуднення
    // отримувала ~1025 ккал без жодного попередження.
    for (const sex of ['male', 'female']) {
      for (let w = 35; w <= 300; w += 5) {
        for (let h = 120; h <= 230; h += 10) {
          for (let a = 14; a <= 90; a += 8) {
            const t = N.targetFor({ sex, weight: w, height: h, age: a, activity: 1.0, goal: 'cutfast' });
            if (!t) continue;
            assert.ok((t.kcal) >= (t.bmr - 0.001), `t.kcal має бути >= t.bmr - 0.001`);
            assert.ok((t.kcal) >= (sex === 'female' ? 1200 : 1500), `t.kcal має бути >= sex === 'female' ? 1200 : 1500`);
          }
        }
      }
    }
  });

  it('спрацювання підлоги видно у прапорці, а не мовчки', () => {
    const t = N.targetFor({ sex: 'female', weight: 50, height: 160, age: 40, activity: 1.2, goal: 'cutfast' });
    assert.equal(t.floored, true);
    assert.ok((t.rawKcal) < (t.kcal), `t.rawKcal має бути < t.kcal`);
  });

  it('на звичайному профілі підлога не втручається', () => {
    const t = N.targetFor({ sex: 'male', weight: 80, height: 180, age: 30, activity: 1.55, goal: 'maintain' });
    assert.equal(t.floored, false);
    assert.equal(Math.round(t.kcal), 2759);
  });
});

describe('межі вводу', () => {
  it('поза LIMITS повертається null, а не «результат»', () => {
    assert.equal(N.targetFor({ weight: 20, height: 100, age: 5 }), null);
    assert.equal(N.targetFor({ weight: 80, height: 180, age: 120 }), null);
    assert.equal(N.targetFor({}), null);
    assert.equal(N.targetFor({ weight: 1e308, height: 180, age: 30 }), null);
  });
});

describe('прогноз маси', () => {
  it('регресія: 80 кг на схудненні не перетворюються на 47 кг за рік', () => {
    // Аудит: лінійна екстраполяція без адаптації TDEE давала −32,7 кг
    // і кінцевий ІМТ 14,6 для цілком звичайного профілю.
    const f = N.massForecast(
      { sex: 'male', weight: 80, height: 180, age: 30, activity: 1.55, goal: 'cutfast', trainingAge: 'inter' }, 12);
    assert.ok((f.weightEnd) > (65), `f.weightEnd має бути > 65`);
    assert.ok((f.totalKg) > (-12), `f.totalKg має бути > -12`);
  });

  it('кінцева вага завжди додатна й не нижча за ІМТ 18,5', () => {
    for (const sex of ['male', 'female']) {
      for (let w = 35; w <= 300; w += 5) {
        for (let h = 120; h <= 230; h += 10) {
          for (const goal of ['cutfast', 'cut', 'maintain', 'bulk', 'bulkfast', 'recomp']) {
            const p = { sex, weight: w, height: h, age: 30, activity: 1.55, goal, trainingAge: 'inter' };
            const f = N.massForecast(p, 12);
            if (!f) continue;
            assert.ok((f.weightEnd) > (0), `f.weightEnd має бути > 0`);
            const bmi = f.weightEnd / Math.pow(h / 100, 2);
            const startBmi = w / Math.pow(h / 100, 2);
            // Нижче норми модель опускається тільки якщо там і починали
            if (startBmi >= 18.5) assert.ok((bmi) >= (18.4), `bmi має бути >= 18.4`);
          }
        }
      }
    }
  });

  it('регресія: дефіцит не робить худу людину ще худішою', () => {
    // Було: підліток 35 кг при 210 см на дефіциті отримував прогноз +35 кг,
    // бо вагу підтягувало вгору до порога ІМТ.
    const f = N.massForecast(
      { sex: 'male', weight: 35, height: 210, age: 14, activity: 1.9, goal: 'cutfast', trainingAge: 'inter' }, 12);
    assert.equal(f.belowNorm, true);
    assert.equal(f.totalKg, 0);
  });

  it('агресивне схуднення завершується після заявлених 3 місяців', () => {
    const p = { sex: 'male', weight: 90, height: 180, age: 30, activity: 1.55, goal: 'cutfast', trainingAge: 'inter' };
    const at3 = N.massForecast(p, 3).totalKg;
    const at12 = N.massForecast(p, 12).totalKg;
    assert.ok(Math.abs((at12) - (at3)) < 1e-6, `at12 ≈ at3`);
    assert.equal(N.massForecast(p, 12).phaseEnded, true);
  });

  it('регресія: рекомпозиція не спалює жиру, якого немає', () => {
    // Аудит: чоловік 60 кг із 8% жиру (4,8 кг жирової маси) отримував
    // прогноз −4,32 кг жиру, тобто залишок 0,8% маси тіла.
    const f = N.massForecast(
      { sex: 'male', weight: 60, height: 175, age: 25, activity: 1.725, bodyfat: 8, goal: 'recomp', trainingAge: 'novice' }, 12);
    const fatMass = 60 * 0.08;
    const essential = 60 * 0.05;
    assert.ok((f.lean) <= (fatMass - essential + 0.001), `f.lean має бути <= fatMass - essential + 0.001`);
  });
});

describe('заявлені темпи відповідають розрахунку', () => {
  it('кожна ціль дає темп у межах, які сама й обіцяє', () => {
    const RANGES = { bulk: [0.25, 0.5], bulkfast: [0.5, 0.8], cut: [0.4, 1.0], cutfast: [0.6, 1.0] };
    for (const [goal, [lo, hi]] of Object.entries(RANGES)) {
      for (const w of [60, 80, 110]) {
        const t = N.targetFor({ sex: 'male', weight: w, height: 178, age: 28, activity: 1.55, goal });
        const weeklyPct = Math.abs((t.kcal - t.tdee) * 7 / 7700) / w * 100;
        assert.ok((weeklyPct) >= (lo - 0.05), `weeklyPct має бути >= lo - 0.05`);
        assert.ok((weeklyPct) <= (hi + 0.05), `weeklyPct має бути <= hi + 0.05`);
      }
    }
  });
});

describe('ІМТ', () => {
  it('межі категорій', () => {
    assert.equal(N.bmiInfo(60, 180).label, 'Норма');
    assert.equal(N.bmiInfo(50, 180).label, 'Недостатня вага');
    assert.equal(N.bmiInfo(85, 180).label, 'Надлишкова вага');
    assert.equal(N.bmiInfo(100, 180).label, 'Ожиріння');
  });
});
