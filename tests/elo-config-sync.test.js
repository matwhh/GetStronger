/**
 * Конфіг ELO існує у трьох місцях, і всі три мають бути одним і тим самим:
 *
 *   db/elo-config.json   — джерело правди в репозиторії;
 *   db/elo-engine.sql    — засів у порожню базу;
 *   elo_config.data      — бойова база (звіряється в tools/verify-elo-week.mjs,
 *                          який заливає json у локальну копію схеми).
 *
 * INV-003: у SQL-засіві бракувало блоку floors, а стояло `on conflict do
 * update` — тобто повторний прогін файла ЗАТЕР би бойовий конфіг застарілим
 * рядком, і elo_facts тихо перейшла б на дефолти з коду. Розбіжність такого
 * роду не падає й не логується: рейтинг просто починає рахуватись інакше.
 *
 * INV-007: частина ключів конфігу не читається жодною SQL-функцією. Це не
 * помилка сама по собі, але мовчазний мертвий ключ — це майбутнє «змінив і
 * нічого не сталось». Тому перелік мертвих ключів зафіксований тут: новий
 * невикористаний ключ валить збірку, поки його не поясниш.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/elo-config.json'), 'utf8'));
const ENGINE = fs.readFileSync(path.join(ROOT, 'db/elo-engine.sql'), 'utf8');

describe('Конфіг ELO: json ↔ SQL-засів (INV-003)', () => {
  test('засів у db/elo-engine.sql збігається з db/elo-config.json', () => {
    const m = /insert into public\.elo_config \(id, data\) values \(1, '([\s\S]*?)'::jsonb\)/.exec(ENGINE);
    assert.ok(m, 'у db/elo-engine.sql немає засіву elo_config');
    const seeded = JSON.parse(m[1]);
    assert.deepEqual(seeded, CFG, 'засів і db/elo-config.json розійшлись');
  });

  test('засів не перезаписує наявний конфіг', () => {
    /* on conflict do update означав: прогін файла по бойовій базі відкочує
       конфіг. Саме так зникали зміни, зроблені міграціями. */
    assert.match(ENGINE, /on conflict \(id\) do nothing;/,
      'засів elo_config мусить бути do nothing, а не do update');
    assert.doesNotMatch(ENGINE, /elo_config[\s\S]{0,400}?on conflict \(id\) do update/,
      'у файлі лишився do update для elo_config');
  });

  test('floors присутні і мають усі пʼять порогів', () => {
    /* Саме їх бракувало в засіві: без них elo_facts бере дефолти з коду. */
    assert.ok(CFG.floors, 'у конфігу немає floors');
    for (const k of ['sleepGoalMin', 'sleepMax', 'stepsGoalMin', 'stepsMax', 'workoutTotalMin']) {
      assert.equal(typeof CFG.floors[k], 'number', 'floors.' + k + ' не число');
    }
  });
});

describe('Конфіг ELO: мертві ключі під наглядом (INV-007)', () => {
  /*
   * Ключі, які СЬОГОДНІ не читає жодна серверна функція. Кожен — із
   * причиною; перелік навмисно точний, щоб новий мертвий ключ було видно.
   */
  const KNOWN_DEAD = {
    leaderboardTops: 'elo_close_season вшиває 10/5/1 % літералами (інші одиниці: відсотки проти часток)',
    leaderboardRanks: 'elo_close_season вшиває 1/3/10/100/1000 літералами',
    dayLossFloor: 'існує лише в клієнтському applyDayCaps і в симуляції tools/simelo.mjs',
    openMealPenalty: 'використовує лише tools/simelo.mjs'
  };

  const SQL = fs.readdirSync(path.join(ROOT, 'db'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(ROOT, 'db', f), 'utf8') }));

  /** Чи згадується ключ у db/*.sql ПОЗА рядком засіву конфігу. */
  function usedInSql(key) {
    return SQL.some(({ text }) => text
      .split('\n')
      .filter((l) => l.indexOf("insert into public.elo_config") === -1)
      .some((l) => l.indexOf("'" + key + "'") !== -1 || l.indexOf('>>' + "'" + key + "'") !== -1));
  }

  test('живі ключі конфігу справді читаються з SQL', () => {
    const missing = [];
    for (const key of Object.keys(CFG)) {
      if (key === 'version' || key === 'floors' || key === 'tolerance' ||
          key === 'weights' || key === 'nutritionSplit') continue;   // читаються вкладено
      if (KNOWN_DEAD[key]) continue;
      if (!usedInSql(key)) missing.push(key);
    }
    assert.deepEqual(missing, [],
      'ці ключі конфігу не читає жодна SQL-функція — або вжити, або внести в KNOWN_DEAD із причиною');
  });

  test('перелік мертвих ключів не протух', () => {
    const revived = Object.keys(KNOWN_DEAD).filter(usedInSql);
    assert.deepEqual(revived, [],
      'ці ключі вже читаються з SQL — прибрати їх із KNOWN_DEAD');
    const gone = Object.keys(KNOWN_DEAD).filter((k) => !(k in CFG));
    assert.deepEqual(gone, [], 'у KNOWN_DEAD є ключі, яких у конфігу вже немає');
  });
});
