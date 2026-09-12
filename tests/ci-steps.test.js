/**
 * КРОКИ CI: чи можуть вони взагалі пройти на раннері.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. З 7 вересня 2026 збірка була червона на КОЖНОМУ
 * пуші, і причина була не в коді: крок «Відновлення з резервної копії»
 * завершувався кодом 3 завжди. Скрипт вважав пропуском те, що справжня
 * резервна копія не передана аргументом, — а на раннері GitHub її не
 * буває за визначенням: вона лежить на диску власника й у репозиторій не
 * потрапляє ніколи, бо в ній дані людей. Тобто крок був приречений
 * падати, і виправити його кодом було неможливо.
 *
 * Найдорожче тут не сама помилка, а те, скільки вона прожила: червоний
 * CI, який червоний завжди, перестають читати за два дні. Після цього
 * він не ловить уже нічого — саме тоді, коли потрібен найбільше.
 *
 * Тому стережемо межу: ПРОПУЩЕНО (тут можна було перевірити, середовище
 * не дало — валимо збірку) проти НЕ ЗАСТОСОВНО (обʼєкта перевірки в
 * цьому середовищі не існує — не валимо).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* FORGE_PG_BIN=none вимикає пошук Postgres. Без цього гілку блокуючого
   пропуску можна перевірити лише на машині без Postgres, тобто ніколи й
   ніде однаково — а разом із нею й весь сенс перевірки. */
function run(env) {
  const r = spawnSync(process.execPath, ['tools/verify-backup-roundtrip.mjs'], {
    cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, env)
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

describe('крок CI «Відновлення з резервної копії»', () => {
  const noPg = run({ FORGE_PG_BIN: 'none' });

  /* РЕГРЕСІЯ: саме цей рядок тримав збірку червоною. Відсутній файл
     власника — не пропуск, а «нема чого перевіряти». */
  test('відсутня справжня копія — НЕ ЗАСТОСОВНО, а не ПРОПУЩЕНО', () => {
    assert.match(noPg.out, /НЕ ЗАСТОСОВНО: цикл на справжньому бекапі/);
    assert.doesNotMatch(noPg.out, /ПРОПУЩЕНО: цикл на справжньому бекапі/);
  });

  test('і підказує, як прогнати цикл руками', () => {
    assert.match(noPg.out, /verify-backup-roundtrip\.mjs .*backups/);
  });

  /* Зворотний бік тієї самої межі: відсутність Postgres мусить лишатись
     провалом. Тихе «все добре» без відновлення — це і був OPS-001. */
  test('відсутній Postgres і далі валить збірку кодом 3', () => {
    assert.equal(noPg.code, 3, noPg.out.slice(-400));
    assert.match(noPg.out, /ПРОПУЩЕНО: усі перевірки з базою/);
  });

  test('підсумок розрізняє пропущене й незастосовне', () => {
    assert.match(noPg.out, /пройдено, \d+ впало, \d+ пропущено, \d+ не застосовно/);
  });
});

describe('кроки ci.yml посилаються на наявні скрипти', () => {
  const yml = join(ROOT, '.github/workflows/ci.yml');

  /* Перейменований або прибраний скрипт інакше виявляється на раннері —
     тобто після пушу, а не до нього. */
  test('усі node tools/*.mjs із воркфлоу існують', { skip: !existsSync(yml) }, () => {
    const src = readFileSync(yml, 'utf8');
    const missing = [];
    for (const m of src.matchAll(/node (tools\/[\w.-]+\.mjs)/g)) {
      if (!existsSync(join(ROOT, m[1]))) missing.push(m[1]);
    }
    assert.equal(missing.join(', '), '');
  });

  test('усі bash tools/*.sh із воркфлоу існують', { skip: !existsSync(yml) }, () => {
    const src = readFileSync(yml, 'utf8');
    const missing = [];
    for (const m of src.matchAll(/bash (tools\/[\w.-]+\.sh)/g)) {
      if (!existsSync(join(ROOT, m[1]))) missing.push(m[1]);
    }
    assert.equal(missing.join(', '), '');
  });
});
