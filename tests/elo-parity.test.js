/**
 * Паритет ELO: JS-ядро проти зафіксованих чисел.
 *
 * TST-004: дельти існують у ДВОХ реалізаціях — js/elo-core.js (показ,
 * оптимістичне нарахування, adherence) і public.elo_action_delta (те, що
 * реально записується в базу). Жоден тест їх не звіряв. Розбіжність тут не
 * падає й не логується: людина бачить на екрані одне число, а в акаунті —
 * інше, і зрозуміти, яке з них правда, неможливо.
 *
 * Тут — половина захисту: ядро JS має і далі давати ті самі числа.
 * Друга половина — tools/verify-elo-week.mjs: він проганяє ТІ САМІ входи
 * крізь SQL у тимчасовому Postgres і звіряє з тими самими числами.
 *
 * Фікстури згенеровані tools/gen-elo-parity.mjs. Якщо правила ELO
 * змінюються свідомо — перегенеруй і поклади зміну в той самий коміт, щоб
 * у git diff було видно, як саме змінились нарахування.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModules } from './helpers.js';

const EC = loadModules(['js/date-core.js', 'js/elo-core.js']).EloCore;
const CFG = JSON.parse(readFileSync(new URL('../db/elo-config.json', import.meta.url), 'utf8'));
const FX = JSON.parse(readFileSync(new URL('./elo-parity.fixtures.json', import.meta.url), 'utf8'));

describe('ELO: ядро дає ті самі числа, що зафіксовані', () => {
  it('фікстури не порожні й покривають усі види дій', () => {
    assert.ok(FX.cases.length >= 15, 'фікстур замало: ' + FX.cases.length);
    const kinds = new Set(FX.cases.map((c) => c.kind));
    for (const k of ['workout', 'meal', 'sleep', 'recovery', 'activity']) {
      assert.ok(kinds.has(k), 'немає жодного випадку для ' + k);
    }
  });

  for (const c of FX.cases) {
    const label = c.kind + ' ' + JSON.stringify(c.payload) +
      ' planned=' + c.plannedDays + (c.grace ? ' grace' : '');
    it(label, () => {
      const r = EC.actionDelta(c.kind, c.payload, CFG,
        { plannedDays: c.plannedDays, grace: c.grace });
      assert.equal(Math.round(Number(r.delta)), c.delta, 'delta');
      assert.equal(Math.round(Number(r.quality) * 1000) / 1000, c.quality, 'quality');
    });
  }
});
