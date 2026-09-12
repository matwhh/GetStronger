#!/usr/bin/env node
/*
 * ФІКСТУРИ ПАРИТЕТУ JS ↔ SQL: генератор.
 *
 * TST-004: дельти ELO існують у ДВОХ реалізаціях — js/elo-core.js (показ,
 * оптимістичне нарахування, adherence) і public.elo_action_delta (те, що
 * реально записується). Жоден тест їх не звіряв, а розбіжність тут — це
 * число на екрані, яке не збігається з числом в акаунті.
 *
 * Цей скрипт рахує дельти ЯДРОМ JS і кладе їх у
 * tests/elo-parity.fixtures.json. Далі:
 *   · npm test звіряє, що ядро й досі дає ті самі числа (регресія JS);
 *   · tools/verify-elo-week.mjs проганяє ті самі входи крізь SQL у
 *     тимчасовому Postgres і звіряє з тими самими числами (паритет).
 *
 * Перегенеровувати руками — лише коли правила ELO змінюються свідомо:
 *   node tools/gen-elo-parity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {}, console, Math, Date, JSON, Number, String, Array, Object };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/elo-core.js'), 'utf8'), sandbox);
const EC = sandbox.window.EloCore;
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/elo-config.json'), 'utf8'));

/* Входи підібрані так, щоб зачепити межі: нуль, повний обсяг, перебір,
   середина смуги толерантності, grace. */
const CASES = [
  { kind: 'workout', payload: { done: 0, total: 5, doneSets: 0, totalSets: 20 }, planned: 4, grace: false },
  { kind: 'workout', payload: { done: 5, total: 5, doneSets: 20, totalSets: 20 }, planned: 4, grace: false },
  { kind: 'workout', payload: { done: 3, total: 5, doneSets: 11, totalSets: 20 }, planned: 4, grace: false },
  { kind: 'workout', payload: { done: 5, total: 5, doneSets: 20, totalSets: 20 }, planned: 7, grace: false },
  { kind: 'workout', payload: { done: 5, total: 5, doneSets: 20, totalSets: 20 }, planned: 4, grace: true },
  { kind: 'workout', payload: { done: 5, total: 5, doneSets: 0, totalSets: 0 }, planned: 4, grace: false },

  { kind: 'meal', payload: { kcal: 2000, target: 2000, protein: 150, proteinTarget: 150 }, planned: 4, grace: false },
  { kind: 'meal', payload: { kcal: 2200, target: 2000, protein: 150, proteinTarget: 150 }, planned: 4, grace: false },
  { kind: 'meal', payload: { kcal: 1200, target: 2000, protein: 60, proteinTarget: 150 }, planned: 4, grace: false },
  { kind: 'meal', payload: { kcal: 2000, target: 2000, protein: 0, proteinTarget: 0 }, planned: 4, grace: false },
  { kind: 'meal', payload: { kcal: 0, target: 0, protein: 0, proteinTarget: 0 }, planned: 4, grace: false },

  { kind: 'sleep', payload: { minutes: 480, goal: 480 }, planned: 4, grace: false },
  { kind: 'sleep', payload: { minutes: 300, goal: 480 }, planned: 4, grace: false },
  { kind: 'sleep', payload: { minutes: 960, goal: 480 }, planned: 4, grace: false },

  { kind: 'recovery', payload: { value: 10 }, planned: 4, grace: false },
  { kind: 'recovery', payload: { value: 5 }, planned: 4, grace: false },
  { kind: 'recovery', payload: { value: 1 }, planned: 4, grace: false },

  { kind: 'activity', payload: { steps: 8000, goal: 8000 }, planned: 4, grace: false },
  { kind: 'activity', payload: { steps: 2000, goal: 8000 }, planned: 4, grace: false },
  { kind: 'activity', payload: { steps: 100000, goal: 8000 }, planned: 4, grace: false }
];

/*
 * ТРИ ТОЧКИ ШКАЛИ НА КОЖЕН ВИПАДОК.
 *
 * Відколи вартість дії залежить від рівня (levelPace), одного входу мало:
 * розбіжність JS і SQL могла б жити лише на високих рівнях і не показатись
 * на нулі. Беремо початок (перший рівень), середину й ELITE.
 */
const ELOS = [0, 1000, 2600];

const out = [];
CASES.forEach(function (c) {
  ELOS.forEach(function (elo) {
    const r = EC.actionDelta(c.kind, c.payload, CFG,
      { plannedDays: c.planned, grace: c.grace, elo: elo });
    out.push({
      kind: c.kind, payload: c.payload, plannedDays: c.planned, grace: c.grace, elo: elo,
      quality: Math.round(Number(r.quality) * 1000) / 1000,
      delta: Math.round(Number(r.delta))
    });
  });
});

const file = path.join(ROOT, 'tests/elo-parity.fixtures.json');
fs.writeFileSync(file, JSON.stringify({
  note: 'Згенеровано tools/gen-elo-parity.mjs. Правити руками не треба — ' +
        'перегенеруй після свідомої зміни правил ELO.',
  config: 'db/elo-config.json',
  cases: out
}, null, 2) + '\n');
console.log('фікстур: ' + out.length + ' → ' + path.relative(ROOT, file));
