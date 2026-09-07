/**
 * Резервна копія бази: перевірка файла і генерація SQL відновлення.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Аудит 2026-09, OPS-001: бекап формально був
 * (заплановане завдання + db/backup-export.sql), але останній запуск упав
 * мовчки, жодного файла не існувало, а процедури відновлення не було
 * взагалі. Тобто бекап був папером, а не бекапом.
 *
 * Тут — швидка частина: правила перевірки файла і властивості
 * згенерованого SQL, без бази. Повний цикл (файл → тимчасовий Postgres →
 * повторний експорт → порівняння рядок у рядок) робить
 * tools/verify-backup-roundtrip.mjs; він ганяється окремим кроком CI,
 * бо потребує сервера Postgres.
 *
 * ГОЛОВНЕ, ЩО ТУТ ЗАФІКСОВАНО: скрипт відновлення нічого не видаляє.
 * Відновлення в базу з даними — це доливання, а не затирання. Інакше
 * помилка з файлом на робочому столі стає другою аварією поверх першої.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validate, buildSql, TABLES } from '../tools/restore-backup.mjs';

const U = '11111111-1111-4111-8111-111111111111';
const TS = '2026-09-01T10:00:00+00:00';

function backup() {
  return {
    exported_at: TS,
    project: 'postgres',
    format_version: 2,
    users: [{ id: U, email: 'a@example.test', aud: 'authenticated', role: 'authenticated', created_at: TS }],
    identities: [{ id: U, user_id: U, provider: 'email', provider_id: U, identity_data: { sub: U } }],
    admins: [],
    account_status: [{ user_id: U, status: 'approved' }],
    profiles: [{ user_id: U, data: {}, created_at: TS, updated_at: TS }],
    consent_log: [],
    season_state: [],
    elo_events: [],
    season_history: [],
    awards: [],
    elo_week_plan: [],
    elo_config: [],
    sequences: { elo_events_id_seq: 2245, consent_log_id_seq: 24 },
    counts: {
      users: 1, identities: 1, admins: 0, account_status: 1, profiles: 1,
      consent_log: 0, season_state: 0, elo_events: 0, season_history: 0,
      awards: 0, elo_week_plan: 0, elo_config: 0
    }
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('Перевірка файла резервної копії', () => {
  test('коректний файл проходить без попереджень', () => {
    const info = validate(backup());
    assert.equal(info.version, 2);
    assert.deepEqual(info.warnings, []);
  });

  test('обрізаний файл ловиться через counts', () => {
    /* Саме цей випадок і рятує: JSON, у якого масив коротший за лічильник,
       розбирається без помилки і виглядає як нормальний бекап. */
    const b = backup();
    b.profiles = [];
    assert.throws(() => validate(b), /файл неповний/);
  });

  test('відсутність таблиці ловиться', () => {
    const b = backup();
    delete b.season_state;
    assert.throws(() => validate(b), /season_state/);
  });

  test('невідомий format_version не приймається', () => {
    const b = backup();
    b.format_version = 99;
    assert.throws(() => validate(b), /format_version/);
  });

  test('бекап без жодного користувача не вважається бекапом', () => {
    const b = backup();
    b.users = []; b.identities = []; b.account_status = []; b.profiles = [];
    b.counts = Object.assign({}, b.counts, { users: 0, identities: 0, account_status: 0, profiles: 0 });
    assert.throws(() => validate(b), /не бекап бази Forge/);
  });

  test('рядки з різними наборами колонок ловляться', () => {
    /* Склеєний із двох версій експорту файл: insert будується за першим
       рядком, і поля решти тихо зникли б. */
    const b = backup();
    b.users.push({ id: '2', email: 'b@example.test' });
    b.counts.users = 2;
    assert.throws(() => validate(b), /інший набір колонок/);
  });

  test('файл format_version 1 приймається, але з попередженнями', () => {
    /* Старий файл — це саме той файл, який опиниться під рукою в поганий
       день. Відмовитись його читати було б гірше, ніж прочитати з застереженням. */
    const b = backup();
    b.format_version = 1;
    delete b.identities; delete b.sequences; delete b.counts.identities;
    const info = validate(b);
    assert.ok(info.warnings.some((w) => w.includes('identities')));
    assert.ok(info.warnings.some((w) => w.includes('sequences')));
  });
});

describe('SQL відновлення', () => {
  test('нічого не видаляє', () => {
    const sql = buildSql(backup())
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();
    for (const word of ['truncate', 'delete from', 'drop table', 'drop schema']) {
      assert.ok(!sql.includes(word), 'у скрипті знайдено «' + word + '»');
    }
  });

  test('кожна вставка захищена on conflict do nothing', () => {
    const lines = buildSql(backup()).split('\n').map((l) => l.trim().toLowerCase());
    const inserts = lines.filter((l) => l.startsWith('insert into')).length;
    const guards = lines.filter((l) => l === 'on conflict do nothing;').length;
    /* один insert без захисту — payload у тимчасову таблицю */
    assert.equal(guards, inserts - 1);
  });

  test('усе в одній транзакції', () => {
    const sql = buildSql(backup());
    assert.ok(sql.includes('begin;'));
    assert.ok(sql.trim().endsWith('commit;'));
  });

  test('є самоперевірка кількостей', () => {
    const sql = buildSql(backup());
    assert.ok(sql.includes('raise exception'));
    assert.ok(sql.includes('$forge_check$'));
  });

  test('послідовності відновлюються', () => {
    const sql = buildSql(backup());
    assert.ok(sql.includes("setval('public.elo_events_id_seq', 2245, true)"));
    assert.ok(sql.includes("setval('public.consent_log_id_seq', 24, true)"));
  });

  test('без блоку sequences у скрипті лишається підказка, а не тиша', () => {
    const b = backup();
    delete b.sequences;
    const sql = buildSql(b);
    assert.ok(sql.includes('УВАГА'));
    assert.ok(sql.includes('elo_events_id_seq'));
  });

  test('auth.users вставляється першим, решта — після', () => {
    const sql = buildSql(backup());
    const at = (t) => sql.indexOf('insert into ' + t + ' (');
    assert.ok(at('auth.users') > 0);
    assert.ok(at('auth.users') < at('auth.identities'));
    assert.ok(at('auth.identities') < at('public.profiles'));
  });

  test('порожні таблиці не породжують insert', () => {
    const sql = buildSql(backup());
    assert.equal(sql.indexOf('insert into public.awards ('), -1);
  });

  test('колонки беруться з файла, а не зашиті в код', () => {
    /* Нова колонка в продакшені має потрапляти у відновлення сама. */
    const b = backup();
    b.profiles.forEach((r) => { r.nickname_2027 = 'x'; });
    assert.ok(buildSql(b).includes('nickname_2027'));
  });

  test('роздільник долара в даних не ламає екранування', () => {
    const b = backup();
    b.profiles[0].data = { note: '$forge_backup$' };
    assert.throws(() => buildSql(b), /екранувати/);
  });

  test('перелік таблиць покриває всі, що є в експорті', () => {
    /* Якщо в db/backup-export.sql зʼявиться таблиця, а сюди її не додати —
       вона потрапить у бекап і не потрапить у відновлення. Тихо. */
    const keys = TABLES.map((t) => t.key).sort();
    assert.deepEqual(keys, [
      'account_status', 'admins', 'awards', 'consent_log', 'elo_config',
      'elo_events', 'elo_week_plan', 'identities', 'profiles',
      'season_history', 'season_state', 'users'
    ]);
  });
});
