/**
 * Перехресне тренерство (js/coach-core.js): зал і харчування нарешті
 * читають журнали одне одного.
 *
 * Досі це були два застосунки під одним дахом. Прогресія вимагала
 * «додай 2,5 кг», коли людина третій тиждень у дефіциті й худне — а в
 * дефіциті сила так не росте, і вимога додати вагу є вимогою провалити
 * підхід. Графік жиму показував рівну лінію пʼять тижнів і мовчав, хоча
 * причина лежала в сусідньому журналі.
 *
 * ГОЛОВНЕ ПРАВИЛО, яке тут стережуть тести: причина називається ОДНА і
 * лише коли доказ однозначний. Збіглося двоє — показуються факти, і
 * жоден не названий головним. Впевнено названа неправильна причина
 * гірша за рівну лінію: людина піде виправляти не те.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const ctx = loadModules([
  'js/date-core.js', 'js/history-core.js', 'js/progress-core.js',
  'js/tdee-core.js', 'js/coach-core.js'
]);
const C = ctx.CoachCore;
const D = ctx.DateCore;

const TODAY = new Date();
const key = (back) => D.shiftKey(D.keyOf(TODAY), -back);

/** Журнал ваги тіла: `days` днів, зміна `deltaKg` рівномірно */
function body(days, startKg, deltaKg) {
  const log = {};
  for (let i = 0; i < days; i++) {
    log[key(days - 1 - i)] = Math.round((startKg + deltaKg * i / (days - 1)) * 1000) / 1000;
  }
  return log;
}

/** Журнал їжі: `days` днів по kcal/protein із цілями */
function meals(days, kcal, p, pTarget) {
  const log = {};
  for (let i = 0; i < days; i++) {
    log[key(days - 1 - i)] = { kcal: kcal, p: p, target: 2600, pTarget: pTarget || 160 };
  }
  return log;
}

/** Сесії: вправа `name` із вагою kg кожні `every` днів протягом `days` */
function sessions(days, name, kg, every, q) {
  const log = {};
  for (let i = 0; i < days; i += (every || 3)) {
    const s = [{ w: kg, r: 8 }, { w: kg, r: 8 }, { w: kg, r: 8 }];
    if (q !== undefined) s.forEach(function (x) { x.q = q; });
    log[key(days - 1 - i)] = { done: 1, total: 1, sets: 3, ex: [{ n: name, ds: 3, ps: 3, kg: kg, r: 8, s: s }] };
  }
  return log;
}

/* ------------------------------------------------------------------ */
describe('coach-core: режим прогресії за енергетичним балансом', () => {
  it('людина худне — режим «утримання»', () => {
    const e = C.energyMode({ bodyLog: body(28, 82, -1.2) }, TODAY);
    assert.equal(e.mode, 'hold');
    assert.equal(e.lossPctWeek > 0, true, JSON.stringify(e));
  });

  it('вага стоїть — режим «ростемо»', () => {
    const e = C.energyMode({ bodyLog: body(28, 82, 0) }, TODAY);
    assert.equal(e.mode, 'grow');
  });

  it('людина набирає — теж «ростемо»', () => {
    assert.equal(C.energyMode({ bodyLog: body(28, 80, +1.0) }, TODAY).mode, 'grow');
  });

  it('коливання в межах шуму режиму не міняють', () => {
    /* 200 г за чотири тижні — це вода, а не дефіцит. */
    assert.equal(C.energyMode({ bodyLog: body(28, 82, -0.2) }, TODAY).mode, 'grow');
  });

  it('без зважувань режиму немає — і нічого не змінюється', () => {
    assert.equal(C.energyMode({ bodyLog: {} }, TODAY), null);
    assert.equal(C.energyMode({}, TODAY), null);
    assert.equal(C.energyMode(null, TODAY), null);
  });

  it('щоденник їжі не обовʼязковий: вага тіла каже достатньо', () => {
    const e = C.energyMode({ bodyLog: body(28, 82, -1.2) }, TODAY);
    assert.equal(e.mode, 'hold');
    assert.equal(e.balance, null, 'без їжі балансу в ккал немає, і його не вигадують');
  });

  it('із двома журналами баланс називається в калоріях', () => {
    const e = C.energyMode({
      bodyLog: body(28, 82, -1.2),
      mealLog: meals(28, 2300, 170)
    }, TODAY);
    assert.equal(e.mode, 'hold');
    assert.equal(e.balance < 0, true, JSON.stringify(e));
  });
});

/* ------------------------------------------------------------------ */
describe('coach-core: чому вага стоїть', () => {
  const NAME = 'Жим штанги лежачи';

  it('дефіцит — і це названо однією причиною', () => {
    const r = C.causesFor({
      bodyLog: body(28, 82, -1.5),
      mealLog: meals(28, 2300, 180),
      sessionLog: sessions(28, NAME, 100, 3)
    }, NAME, 28, TODAY);
    assert.equal(r.one, 'deficit', JSON.stringify(r));
  });

  it('замало білка — інша причина', () => {
    const r = C.causesFor({
      bodyLog: body(28, 82, 0),
      mealLog: meals(28, 2600, 80),
      sessionLog: sessions(28, NAME, 100, 3)
    }, NAME, 28, TODAY);
    assert.equal(r.one, 'protein', JSON.stringify(r));
  });

  it('вправу майже не робили — це не плато', () => {
    const r = C.causesFor({
      bodyLog: body(28, 82, 0),
      mealLog: meals(28, 2600, 180),
      sessionLog: sessions(28, NAME, 100, 20)
    }, NAME, 28, TODAY);
    assert.equal(r.one, 'missed', JSON.stringify(r));
  });

  it('усі підходи на нулі — втома', () => {
    const r = C.causesFor({
      bodyLog: body(28, 82, 0),
      mealLog: meals(28, 2600, 180),
      sessionLog: sessions(28, NAME, 100, 3, 0)
    }, NAME, 28, TODAY);
    assert.equal(r.one, 'fatigue', JSON.stringify(r));
  });

  it('великий запас — вага просто застара', () => {
    const r = C.causesFor({
      bodyLog: body(28, 82, 0),
      mealLog: meals(28, 2600, 180),
      sessionLog: sessions(28, NAME, 100, 3, 4)
    }, NAME, 28, TODAY);
    assert.equal(r.one, 'light', JSON.stringify(r));
  });

  it('збіглося дві причини — жодна не названа головною', () => {
    const r = C.causesFor({
      bodyLog: body(28, 82, -1.5),
      mealLog: meals(28, 2300, 80),
      sessionLog: sessions(28, NAME, 100, 3)
    }, NAME, 28, TODAY);
    assert.equal(r.causes.length >= 2, true, JSON.stringify(r));
    assert.equal(r.one, null, 'дві причини — це «причин може бути кілька»');
  });

  it('нічого не збіглося — причини немає, і це теж відповідь', () => {
    const r = C.causesFor({
      bodyLog: body(28, 82, 0),
      mealLog: meals(28, 2600, 180),
      sessionLog: sessions(28, NAME, 100, 3)
    }, NAME, 28, TODAY);
    assert.equal(r.causes.length, 0, JSON.stringify(r));
    assert.equal(r.one, null);
  });

  it('кожна причина несе ФАКТ, а не ярлик', () => {
    const r = C.causesFor({
      bodyLog: body(28, 82, -1.5),
      mealLog: meals(28, 2300, 180),
      sessionLog: sessions(28, NAME, 100, 3)
    }, NAME, 28, TODAY);
    assert.equal(typeof r.causes[0].fact, 'string');
    assert.equal(r.causes[0].fact.length > 10, true, r.causes[0].fact);
  });

  it('порожні журнали не кидають винятків', () => {
    const r = C.causesFor({}, NAME, 28, TODAY);
    assert.equal(r.causes.length, 0);
    assert.equal(r.one, null);
  });
});

/* ------------------------------------------------------------------ */
describe('coach-core: скільки коштує тренувальний тиждень', () => {
  it('рахує з фактичних сесій, а не з коефіцієнта активності', () => {
    const log = {};
    for (let i = 0; i < 28; i += 2) {
      const k = key(27 - i);
      log[k] = { done: 3, total: 3, sets: 12, t0: 1, t1: 1 + 60 * 60000 };
    }
    const t = C.trainingKcal(log, 80, 28, TODAY);
    assert.equal(t.sessions, 14);
    assert.equal(t.perDay > 0, true, JSON.stringify(t));
    assert.equal(t.perSession > 100 && t.perSession < 600, true, JSON.stringify(t));
  });

  it('без тривалості сесій рахувати нічого', () => {
    const log = { [key(1)]: { done: 3, total: 3, sets: 12 } };
    assert.equal(C.trainingKcal(log, 80, 28, TODAY), null);
  });

  it('без ваги тіла — теж нічого', () => {
    const log = { [key(1)]: { t0: 1, t1: 1 + 3600000 } };
    assert.equal(C.trainingKcal(log, null, 28, TODAY), null);
  });
});
