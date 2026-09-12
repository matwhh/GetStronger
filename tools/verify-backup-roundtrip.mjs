#!/usr/bin/env node
/*
 * ПЕРЕВІРКА РЕЗЕРВНОЇ КОПІЇ: файл → база → файл
 * =============================================================================
 * OPS-001 з аудиту 2026-09 звучав так: бекап є, але доказу, що з нього можна
 * відновитись, немає. Цей скрипт і є доказом — він щоразу проганяє повний цикл:
 *
 *   фікстура (або справжній бекап)
 *      → tools/restore-backup.mjs → SQL
 *      → тимчасовий локальний Postgres із db/restore-skeleton.sql
 *      → db/backup-export.sql
 *      → порівняння з тим, з чого почали, рядок у рядок.
 *
 * Без мережі й без доступу до продакшену. Тимчасовий кластер створюється в
 * каталозі tmp і зноситься в кінці.
 *
 *   node tools/verify-backup-roundtrip.mjs                  # на синтетичній фікстурі
 *   node tools/verify-backup-roundtrip.mjs backup.json      # і на справжньому файлі
 *
 * Якщо в системі немає сервера Postgres, перевірки з базою не мовчать, а
 * друкуються як ПРОПУЩЕНО і скрипт завершується кодом 3 — «перевірено не все».
 * Тихого «все добре» без відновлення тут не буває: саме воно й було причиною
 * OPS-001.
 *
 * ПРОПУЩЕНО І НЕ ЗАСТОСОВНО — РІЗНІ РЕЧІ, і плутанина між ними тримала CI
 * червоним на кожному пуші з 7 вересня.
 *
 * «Пропущено» — це «тут МОЖНА було перевірити, але середовище не дало»:
 * немає Postgres. Таке мусить валити збірку, інакше перевірка тихо зникає, а
 * саме так і зʼявився OPS-001.
 *
 * «Не застосовно» — це «того, що перевіряти, у цьому середовищі немає й бути
 * не може»: справжня резервна копія лежить на диску власника і в репозиторій
 * не потрапляє НІКОЛИ — у ній дані людей. На раннері GitHub цього файла не
 * буває за визначенням, тож рахувати його відсутність провалом означало
 * приректи крок падати завжди. Він і падав: 19 перевірок проходили, файла не
 * було, скрипт віддавав 3, і збірка червоніла з причини, яку не можна
 * виправити кодом.
 *
 * Тому відсутній файл більше не рахується пропуском. Він лишається помітним
 * рядком у виводі й підказкою, як прогнати повний цикл руками — але коду
 * виходу не міняє.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate, buildSql, TABLES } from './restore-backup.mjs';

const ROOT = process.env.FORGE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0, skip = 0, na = 0;
function ok(name)        { pass++; console.log('  ✓ ' + name); }
function bad(name, why)  { fail++; console.log('  ✗ ' + name + '\n      ' + String(why).split('\n')[0]); }
function skipped(name, why) { skip++; console.log('  – ПРОПУЩЕНО: ' + name + ' (' + why + ')'); }
/* Не застосовно ≠ пропущено: перевіряти нічого, бо обʼєкта перевірки в цьому
   середовищі не існує. Коду виходу не міняє — пояснення в шапці файла. */
function notApplicable(name, why) { na++; console.log('  · НЕ ЗАСТОСОВНО: ' + name + ' (' + why + ')'); }

function check(name, fn) {
  try { fn(); ok(name); } catch (e) { bad(name, e && e.message ? e.message : e); }
}
/** Перевірка, яка МАЄ впасти. Тест, що ловить лише щасливий шлях, нічого не ловить. */
function checkThrows(name, fn, expect) {
  try {
    fn();
    bad(name, 'очікувалась помилка, але виклик пройшов');
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (expect && !msg.includes(expect)) bad(name, 'інша помилка: ' + msg);
    else ok(name);
  }
}

/* ------------------------------------------------------------- фікстура -- */
/*
 * Синтетична, без жодних справжніх персональних даних: скрипт має ганятись у
 * CI, а бекап продакшену в репозиторії не місце. Форма — рівно та, яку віддає
 * db/backup-export.sql, включно з форматом дат Postgres.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const TS = '2026-09-01T10:00:00+00:00';

function fixture() {
  const users = [U1, U2].map(function (id, i) {
    return {
      instance_id: '00000000-0000-0000-0000-000000000000',
      id: id, aud: 'authenticated', role: 'authenticated',
      email: 'user' + (i + 1) + '@example.test',
      email_confirmed_at: TS, invited_at: null, confirmation_sent_at: TS,
      recovery_sent_at: null, email_change: '', email_change_sent_at: null,
      email_change_confirm_status: 0, last_sign_in_at: TS,
      raw_app_meta_data: { provider: 'email', providers: ['email'] },
      raw_user_meta_data: { email_verified: true },
      is_super_admin: null, created_at: TS, updated_at: TS,
      phone: null, phone_confirmed_at: null, phone_change_sent_at: null,
      banned_until: null, reauthentication_sent_at: null,
      is_sso_user: false, deleted_at: null, is_anonymous: false
    };
  });
  const identities = [U1, U2].map(function (id, i) {
    return {
      id: '3333333' + (i + 1) + '-3333-4333-8333-333333333333',
      user_id: id, provider_id: id, provider: 'email',
      identity_data: { sub: id, email: 'user' + (i + 1) + '@example.test', email_verified: true },
      last_sign_in_at: TS, created_at: TS, updated_at: TS
    };
  });
  const b = {
    exported_at: TS,
    project: 'postgres',
    format_version: 2,
    users: users,
    identities: identities,
    admins: [{ user_id: U1, added_at: TS }],
    account_status: [
      { user_id: U1, status: 'approved', username: 'one', birth_date: '1990-01-01', screening: {}, requested_at: TS, decided_at: TS, decided_by: U1, note: null },
      { user_id: U2, status: 'pending',  username: 'two', birth_date: '1995-05-05', screening: { q1: true }, requested_at: TS, decided_at: null, decided_by: null, note: null }
    ],
    profiles: [
      { user_id: U1, data: { weight: 80, plan: 'a' }, created_at: TS, updated_at: TS },
      { user_id: U2, data: {}, created_at: TS, updated_at: TS }
    ],
    consent_log: [
      { id: 23, user_id: U1, document: 'terms', version: '1', accepted_at: TS },
      { id: 24, user_id: U2, document: 'terms', version: '1', accepted_at: TS }
    ],
    season_state: [
      { user_id: U1, season: '2026-Q3', elo: 1200, today_delta: 5, today_date: '2026-09-01', grace_used: 0, grace_until: null, display_name: 'one', updated_at: TS }
    ],
    elo_events: [
      { id: 2244, user_id: U1, season: '2026-Q3', day: '2026-09-01', category: 'gym', action_key: 'k1', quality: 1, delta: 5, elo_after: 1200, reason: 'test', created_at: TS, event_type: 'day' },
      { id: 2245, user_id: U2, season: '2026-Q3', day: '2026-09-01', category: 'gym', action_key: 'k2', quality: 0, delta: 0, elo_after: 1000, reason: 'test', created_at: TS, event_type: 'day' }
    ],
    season_history: [],
    awards: [],
    elo_week_plan: [{ user_id: U1, week_start: '2026-08-31', planned: 3, created_at: TS }],
    elo_config: [{ id: 1, data: { k: 32 }, updated_at: TS }],
    sequences: { elo_events_id_seq: 2245, consent_log_id_seq: 24 },
    counts: {
      users: 2, identities: 2, account_status: 2, profiles: 2, elo_events: 2,
      season_state: 1, season_history: 0, awards: 0, consent_log: 2,
      elo_week_plan: 1, elo_config: 1, admins: 1
    }
  };
  return b;
}
const clone = function (o) { return JSON.parse(JSON.stringify(o)); };

/* --------------------------------------------------- нормалізація/діфи -- */

const ISO = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?)?([+-]\d{2}:?\d{2}|Z)?$/;

/* Postgres віддає дати як рядки в кількох еквівалентних формах
 * ('...+00:00' vs '...Z'), а числа numeric — то як 0, то як 0.0.
 * Порівнювати треба значення, а не запис. */
function norm(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach(function (k) { out[k] = norm(v[k]); });
    return out;
  }
  if (typeof v === 'string' && ISO.test(v)) {
    const t = Date.parse(v.length === 10 ? v + 'T00:00:00Z' : v);
    if (!Number.isNaN(t)) return 'ts:' + t;
  }
  return v;
}
function rowKey(r) { return JSON.stringify(norm(r)); }

function diffTable(key, before, after) {
  const a = before.map(rowKey).sort();
  const b = after.map(rowKey).sort();
  if (a.length !== b.length) throw new Error(key + ': було ' + a.length + ' рядків, повернулось ' + b.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(key + ': рядок не збігся після циклу\n  було:  ' + a[i] + '\n  стало: ' + b[i]);
    }
  }
}

/* --------------------------------------------------- локальний Postgres -- */

const PG_BIN = (function () {
  /* 'none' — примусове «сервера немає». Потрібне тестам: інакше гілку
     блокуючого пропуску можна перевірити лише на машині без Postgres, тобто
     ніколи й ніде однаково. */
  if (process.env.FORGE_PG_BIN === 'none') return null;
  const cands = [];
  if (process.env.FORGE_PG_BIN) cands.push(process.env.FORGE_PG_BIN);
  try {
    for (const v of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) cands.push('/usr/lib/postgresql/' + v + '/bin');
  } catch (_) {}
  cands.push('/usr/local/bin', '/usr/bin', '/opt/homebrew/bin');
  for (const c of cands) {
    try { if (fs.existsSync(path.join(c, 'initdb')) && fs.existsSync(path.join(c, 'pg_ctl'))) return c; } catch (_) {}
  }
  return null;
})();

/* Сервер Postgres відмовляється працювати від root. У контейнері ми root,
 * у CI — ні; підтримуємо обидва випадки, а не один зручний. */
const RUN_AS = (typeof process.getuid === 'function' && process.getuid() === 0) ? 'postgres' : null;

function sh(cmd, opts) {
  const full = RUN_AS ? ['su', RUN_AS, '-c', cmd] : ['bash', '-c', cmd];
  return execFileSync(full[0], full.slice(1), Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));
}

class Cluster {
  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-restore-'));
    this.data = path.join(this.dir, 'data');
    this.sock = path.join(this.dir, 'sock');
    this.port = 5432 + Math.floor(Math.random() * 500) + 100;
    this.started = false;
  }
  start() {
    fs.mkdirSync(this.data); fs.mkdirSync(this.sock);
    fs.chmodSync(this.dir, 0o711);
    if (RUN_AS) execFileSync('chown', ['-R', RUN_AS, this.dir]);
    sh(q(PG_BIN + '/initdb') + ' -D ' + q(this.data) + ' -U postgres -A trust -E UTF8 --locale=C');
    sh(q(PG_BIN + '/pg_ctl') + ' -D ' + q(this.data) +
       ' -o "-k ' + this.sock + " -h '' -p " + this.port + '" -l ' + q(path.join(this.dir, 'pg.log')) + ' -w start');
    this.started = true;
  }
  psql(args) {
    return sh(q(PG_BIN + '/psql') + ' -h ' + q(this.sock) + ' -p ' + this.port +
              ' -U postgres -d postgres -v ON_ERROR_STOP=1 ' + args);
  }
  file(p)  { return this.psql('-f ' + q(p)); }
  value(sql) { return this.psql('-tAc ' + q(sql)).trim(); }
  reset() {
    this.psql('-c ' + q('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;'));
  }
  stop() {
    if (this.started) { try { sh(q(PG_BIN + '/pg_ctl') + ' -D ' + q(this.data) + ' -m immediate -w stop'); } catch (_) {} }
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (_) {}
  }
}
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

/* Тимчасові файли — поруч із кластером, у tmp, а не в репозиторії. */
function tmpWrite(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  if (RUN_AS) { try { execFileSync('chmod', ['644', p]); } catch (_) {} }
  return p;
}

/* ------------------------------------------------------------- перевірки -- */

console.log('\nПеревірка резервної копії (OPS-001)\n');
console.log('А. Файл без бази');

const fx = fixture();

check('фікстура проходить validate', function () {
  const info = validate(fx);
  if (info.version !== 2) throw new Error('версія ' + info.version);
  if (info.warnings.length) throw new Error('несподівані попередження: ' + info.warnings.join('; '));
});

checkThrows('обрізаний масив ловиться через counts', function () {
  const b = clone(fx); b.elo_events.pop();
  validate(b);
}, 'файл неповний');

checkThrows('відсутній масив ловиться', function () {
  const b = clone(fx); delete b.profiles;
  validate(b);
}, 'profiles');

checkThrows('невідомий format_version ловиться', function () {
  const b = clone(fx); b.format_version = 3;
  validate(b);
}, 'format_version');

checkThrows('бекап без користувачів ловиться', function () {
  const b = clone(fx); b.users = []; b.identities = []; b.counts.users = 0; b.counts.identities = 0;
  b.admins = []; b.counts.admins = 0; b.account_status = []; b.counts.account_status = 0;
  b.profiles = []; b.counts.profiles = 0; b.consent_log = []; b.counts.consent_log = 0;
  b.season_state = []; b.counts.season_state = 0; b.elo_events = []; b.counts.elo_events = 0;
  b.elo_week_plan = []; b.counts.elo_week_plan = 0;
  validate(b);
}, 'не бекап бази Get Stronger');

checkThrows('різні набори колонок у рядках ловляться', function () {
  const b = clone(fx); delete b.profiles[1].updated_at;
  validate(b);
}, 'інший набір колонок');

check('файл format_version 1 приймається з попередженнями', function () {
  const b = clone(fx);
  b.format_version = 1; delete b.identities; delete b.sequences;
  delete b.counts.identities;
  const info = validate(b);
  if (!info.warnings.some(function (w) { return w.includes('identities'); })) throw new Error('немає попередження про identities');
  const sql = buildSql(b);
  if (!sql.includes('setval')) throw new Error('немає підказки про setval');
});

check('SQL відновлення нічого не видаляє', function () {
  const lines = buildSql(fx).split('\n')
    .filter(function (l) { return !l.trim().startsWith('--'); })
    .map(function (l) { return l.trim().toLowerCase(); });
  const sql = lines.join('\n');
  for (const word of ['truncate', 'drop table', 'drop schema', 'delete from']) {
    if (sql.includes(word)) throw new Error('у скрипті є «' + word + '»');
  }
  const inserts = lines.filter(function (l) { return l.startsWith('insert into'); }).length;
  const guards  = lines.filter(function (l) { return l === 'on conflict do nothing;'; }).length;
  /* один insert — у тимчасову таблицю з payload, він без on conflict */
  if (guards !== inserts - 1) throw new Error('insert-ів ' + inserts + ', захищених ' + guards);
});

check('послідовності відновлюються обидві', function () {
  const sql = buildSql(fx);
  for (const s of ['elo_events_id_seq', 'consent_log_id_seq']) {
    if (!sql.includes("setval('public." + s + "'")) throw new Error('немає setval для ' + s);
  }
});

check('порядок таблиць збігається з порядком зовнішніх ключів', function () {
  const order = TABLES.map(function (t) { return t.key; });
  if (order[0] !== 'users') throw new Error('users має бути першим');
  if (order.indexOf('identities') > order.indexOf('profiles')) throw new Error('identities після profiles');
  const sql = buildSql(fx);
  let prev = -1;
  for (const t of TABLES) {
    const at = sql.indexOf('insert into ' + t.target + ' (');
    if (at < 0) continue;
    if (at < prev) throw new Error(t.target + ' стоїть раніше, ніж таблиця, на яку посилається');
    prev = at;
  }
});

/* ------------------------------------------------------------ Б. з базою -- */

console.log('\nБ. Повний цикл через справжній Postgres');

const real = process.argv[2] ? path.resolve(process.argv[2]) : null;
let realBackup = null;
if (real) {
  try { realBackup = JSON.parse(fs.readFileSync(real, 'utf8')); }
  catch (e) { bad('справжній бекап читається', e.message); }
} else {
  /* Повідомляємо тут, а не всередині гілки з Postgres: наявність файла з
     сервером не звʼязана ніяк, а так рядок видно завжди — і коли бази немає
     теж. Інакше про неперевірений бекап дізнаєшся лише на машині з Postgres. */
  notApplicable('цикл на справжньому бекапі',
    'файла не передано; щоб прогнати: node tools/verify-backup-roundtrip.mjs ../backups/останній.json');
}

if (!PG_BIN) {
  skipped('усі перевірки з базою', 'у системі немає initdb/pg_ctl');
} else {
  const cl = new Cluster();
  try {
    cl.start();
    /* Файли репозиторію користувачеві postgres не видно (домашній каталог
     * root), тож копіюємо їх у каталог кластера. */
    const skeleton  = tmpWrite(cl.dir, 'skeleton.sql', fs.readFileSync(path.join(ROOT, 'db', 'restore-skeleton.sql'), 'utf8'));
    const exportSql = tmpWrite(cl.dir, 'export.sql',   fs.readFileSync(path.join(ROOT, 'db', 'backup-export.sql'), 'utf8'));

    const roundtrip = function (label, backup) {
      cl.reset();
      cl.file(skeleton);

      check(label + ': restore проходить', function () {
        cl.file(tmpWrite(cl.dir, 'restore.sql', buildSql(backup)));
      });

      check(label + ': кількості в базі збігаються з counts файла', function () {
        for (const t of TABLES) {
          const n = backup.counts[t.key];
          if (typeof n !== 'number') continue;
          const got = Number(cl.value('select count(*) from ' + t.target));
          if (got !== n) throw new Error(t.target + ': у базі ' + got + ', у файлі ' + n);
        }
      });

      check(label + ': повторний restore нічого не дублює', function () {
        cl.file(path.join(cl.dir, 'restore.sql'));
        const got = Number(cl.value('select count(*) from public.elo_events'));
        if (got !== backup.counts.elo_events) throw new Error('elo_events став ' + got);
      });

      check(label + ': жодного сироти після відновлення', function () {
        const orphans = Number(cl.value(
          "select (select count(*) from public.profiles p left join auth.users u on u.id = p.user_id where u.id is null)" +
          " + (select count(*) from public.elo_events e left join auth.users u on u.id = e.user_id where u.id is null)"));
        if (orphans !== 0) throw new Error(orphans + ' сиріт');
      });

      check(label + ': послідовності продовжуються, а не конфліктують', function () {
        const seqs = backup.sequences || {};
        if (!Object.keys(seqs).length) throw new Error('у файлі немає sequences');
        const next = Number(cl.value("select nextval('public.elo_events_id_seq')"));
        const max = Number(cl.value('select coalesce(max(id), 0) from public.elo_events'));
        if (!(next > max)) throw new Error('nextval = ' + next + ', а max(id) = ' + max);
      });

      check(label + ': повторний експорт віддає ті самі дані', function () {
        const again = JSON.parse(cl.psql('-tA -f ' + q(exportSql)).trim());
        if (again.format_version !== 2) throw new Error('експорт віддав версію ' + again.format_version);
        for (const t of TABLES) {
          if (!Array.isArray(backup[t.key])) continue;
          diffTable(t.key, backup[t.key], again[t.key] || []);
        }
        for (const [k, v] of Object.entries(backup.sequences || {})) {
          /* nextval вище зсунув elo_events_id_seq на одиницю — це очікувано */
          const got = Number(again.sequences[k]);
          if (!(got === Number(v) || got === Number(v) + 1)) throw new Error('sequences.' + k + ': ' + got + ' замість ' + v);
        }
      });
    };

    roundtrip('фікстура', fx);

    /* Негативні: перевіряємо, що restore ЛАМАЄТЬСЯ там, де має. */
    cl.reset(); cl.file(skeleton);
    check('сирота у файлі валить restore, а не створює битий рядок', function () {
      const b = clone(fx);
      b.profiles[0].user_id = '99999999-9999-4999-8999-999999999999';
      let threw = false;
      try { cl.file(tmpWrite(cl.dir, 'orphan.sql', buildSql(b))); } catch (_) { threw = true; }
      if (!threw) throw new Error('restore пройшов із сиротою');
      const n = Number(cl.value('select count(*) from public.profiles'));
      if (n !== 0) throw new Error('після відкату лишилось ' + n + ' рядків — транзакція не відкотилась');
    });

    cl.reset(); cl.file(skeleton);
    check('невідома колонка дає чесну помилку, а не тиху втрату', function () {
      const b = clone(fx);
      b.profiles.forEach(function (r) { r.nickname_2027 = 'x'; });
      let msg = '';
      try { cl.file(tmpWrite(cl.dir, 'newcol.sql', buildSql(b))); } catch (e) { msg = String(e.stderr || e.message); }
      if (!/nickname_2027/.test(msg)) throw new Error('помилка не назвала колонку: ' + msg.slice(0, 200));
    });

    cl.reset(); cl.file(skeleton);
    check('restore в базу з даними не чіпає наявні рядки', function () {
      cl.file(tmpWrite(cl.dir, 'restore.sql', buildSql(fx)));
      cl.psql('-c ' + q("update public.profiles set data = '{\"weight\":999}'::jsonb where user_id = '" + U1 + "'"));
      cl.file(path.join(cl.dir, 'restore.sql'));
      const w = cl.value("select data->>'weight' from public.profiles where user_id = '" + U1 + "'");
      if (w !== '999') throw new Error('живий рядок перезаписано бекапом (weight = ' + w + ')');
    });

    if (realBackup) {
      check('справжній бекап проходить validate', function () {
        const info = validate(realBackup);
        info.warnings.forEach(function (x) { console.log('      УВАГА: ' + x); });
      });
      check('справжній бекап не старіший за 48 годин', function () {
        const age = (Date.now() - Date.parse(realBackup.exported_at)) / 3600000;
        if (!(age < 48)) throw new Error('копії ' + age.toFixed(1) + ' год');
      });
      roundtrip('справжній бекап', realBackup);
    }
  } catch (e) {
    bad('локальний Postgres', (e && (e.stderr || e.message)) || e);
  } finally {
    cl.stop();
  }
}

console.log('\n' + pass + ' пройдено, ' + fail + ' впало, ' + skip + ' пропущено' +
            (na ? ', ' + na + ' не застосовно' : '') + '\n');
/* Код 3 — рівно про ПРОПУЩЕНЕ. «Не застосовно» сюди не входить: див. шапку. */
process.exit(fail ? 1 : (skip ? 3 : 0));
