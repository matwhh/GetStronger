/**
 * Get Stronger — гігієна репозиторію.
 *
 * Юніт-тести перевіряють логіку. Цей скрипт перевіряє те, чого вони не
 * бачать: що саме лежить у репозиторії і що з цього роздається сайтом.
 * Приводом став реальний випадок — файл backup-forge-2026-09-01.json з
 * поштою й історією тренувань лежав у корені й віддавався по HTTP з
 * кодом 200. Тести були зелені: ламати там нічого.
 *
 * Запуск:  node tools/ci-hygiene.mjs
 * Код 1 — знайдено проблему (CI падає).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const problems = [];
const fail = (msg) => problems.push(msg);

/** Файли під контролем git — саме вони їдуть на GitHub і на Vercel. */
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/* ---- 1. Персональні дані в репозиторії ------------------------------ */
//
// Експорт акаунта містить пошту, історію тренувань і рейтинг. Такому
// файлу не місце ні в git, ні тим паче в корені сайту.
// Префікс перед словом теж ловиться: дамп бази зветься backup-forge-РРРР-ММ-ДД.json,
// і під старим шаблоном (лише початок імені) він проходив у репозиторій непоміченим.
const BACKUPS = /(^|\/)[a-z0-9_.-]*?(backup|бекап|export)[-_.].*\.json$/i;
for (const f of tracked.filter((f) => BACKUPS.test(f))) {
  fail(`експорт даних користувача у репозиторії: ${f}`);
}

/* ---- 2. Сміття ------------------------------------------------------ */
const JUNK = [/(^|\/)\.DS_Store$/, /^_to_delete\//, /\.zip$/i, /(^|\/)Thumbs\.db$/i];
for (const f of tracked) {
  if (JUNK.some((re) => re.test(f))) fail(`сміття у репозиторії: ${f}`);
}

/* ---- 3. Що сайт не має роздавати ------------------------------------ */
//
// db/ — міграції та схема; tools/ і tests/ — розробницьке;
// docs/ — звіти аудиту з описом кожної діри. Усе це лежить у git
// (приватний репозиторій), але на бойовий сайт потрапити не повинно.
// Vercel відсіює їх за .vercelignore — якщо рядок звідти зникне,
// файли почнуть віддаватись публічно й ніхто цього не помітить.
const MUST_IGNORE = ['db/', 'tools/', 'tests/', 'docs/'];
if (!existsSync('.vercelignore')) {
  fail('немає .vercelignore — сайт роздаватиме db/, tools/, tests/ і docs/');
} else {
  const lines = readFileSync('.vercelignore', 'utf8')
    .split('\n')
    .map((l) => l.trim());
  for (const need of MUST_IGNORE) {
    if (!lines.includes(need)) fail(`.vercelignore більше не приховує ${need}`);
  }
}

/* ---- 4. Ключі Supabase у фронтенді ---------------------------------- */
//
// anon-ключ публічний за задумом: його боронить RLS. service_role-ключ
// обходить RLS повністю — якщо він колись потрапить у js/, це негайний
// повний доступ до бази для кожного, хто відкриє сайт. Тому ключі не
// шукаються за назвою (вона нічого не значить), а розбираються як JWT:
// у корисному навантаженні має бути role: anon.
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
const TEXT = /\.(js|mjs|html|json|md|sql|css|command|yml|yaml|webmanifest)$/i;

for (const f of tracked.filter((f) => TEXT.test(f))) {
  let body;
  try {
    body = readFileSync(f, 'utf8');
  } catch {
    continue; // не текст — пропускаємо
  }
  for (const m of body.matchAll(JWT)) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    } catch {
      continue; // не розібрався — не наша справа
    }
    if (payload.role && payload.role !== 'anon') {
      fail(`у ${f} лежить ключ з роллю "${payload.role}" — у фронтенді дозволено лише anon`);
    }
  }
}

/* ---- 5. DSN Sentry без секрета -------------------------------------- */
//
// Публічний DSN виглядає як https://<ключ>@<хост>/<проєкт>. Старий формат
// із секретом (https://<ключ>:<секрет>@...) дозволяє не лише слати події.
if (existsSync('js/config.js')) {
  const conf = readFileSync('js/config.js', 'utf8');
  const dsn = conf.match(/dsn:\s*'([^']*)'/);
  if (dsn && dsn[1] && /^https:\/\/[^@/]+:[^@/]+@/.test(dsn[1])) {
    fail('DSN Sentry у js/config.js містить секретну частину — потрібен публічний DSN');
  }
}

/* ---- 6. Картка для месенджерів ---------------------------------------
 *
 * og:image мусить бути АБСОЛЮТНОЮ адресою. Відносний шлях Telegram ще
 * розбирає, а Facebook, LinkedIn, X і Slack — ні: там посилання лишалось
 * без картинки, і це не видно нізвідки, крім самої картки.
 * Домен звіряється з siteUrl у js/config.js — щоб при переїзді на свій
 * домен картинка не показувала старий.
 */
{
  const cfg = existsSync('js/config.js') ? readFileSync('js/config.js', 'utf8') : '';
  const m = cfg.match(/siteUrl:\s*'([^']*)'/);
  const site = m ? m[1].replace(/\/+$/, '') : '';
  for (const f of tracked.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    const img = html.match(/<meta property="og:image" content="([^"]*)"/);
    if (!img) continue;
    if (!/^https:\/\//.test(img[1])) {
      fail(`${f}: og:image "${img[1]}" — потрібна абсолютна адреса, інакше картка без картинки`);
    } else if (site && !img[1].startsWith(site + '/')) {
      fail(`${f}: og:image веде на ${img[1]}, а siteUrl у config.js — ${site}`);
    }
    const title = html.match(/<meta property="og:title" content="([^"]*)"/);
    if (!title || !title[1].trim()) fail(`${f}: порожній або відсутній og:title`);

    /*
     * Telegram завжди друкує в картці два рядки: синій — og:site_name,
     * жирний — og:title. Без site_name у синьому рядку стоїть голий
     * домен, а якщо обидва однакові — слово стоїть двічі поспіль.
     */
    const site_ = html.match(/<meta property="og:site_name" content="([^"]*)"/);
    if (!site_ || !site_[1].trim()) {
      fail(`${f}: немає og:site_name — у картці месенджера буде голий домен`);
    } else if (title && site_[1].trim() === title[1].trim()) {
      fail(`${f}: og:site_name і og:title однакові ("${title[1]}") — у картці слово стоятиме двічі`);
    }
  }
}

/* ---- 7. Оболонка service worker покриває скрипти index.html ---------- */
//
// Офлайн одразу після встановлення показував шапку й заголовок без
// window.Store: у SHELL лежало шість файлів, а index.html підключає 21
// скрипт (PWA-013). Екран виглядав робочим і не працював — мовчки.
// Перелік легко розʼїжджається знову, тому його звіряє машина.
if (existsSync('sw.js') && existsSync('index.html')) {
  const sw = readFileSync('sw.js', 'utf8');
  const shell = new Set((sw.match(/const SHELL = \[([\s\S]*?)\];/) || [, ''])[1]
    .match(/'([^']+)'/g) || []);
  const have = new Set([...shell].map((x) => x.replace(/'/g, '').replace(/^\.\//, '')));
  const want = (readFileSync('index.html', 'utf8').match(/src="([^"]+)"/g) || [])
    .map((x) => x.slice(5, -1))
    .filter((x) => !/^https?:/.test(x));
  /* js/nosw.js навмисно поза кешем: аварійний вимикач має приїжджати з
     мережі, інакше він ділить долю зіпсованого worker-а (PWA-006). */
  const OFF_SHELL = new Set(['js/nosw.js']);
  for (const src of want) {
    if (OFF_SHELL.has(src)) {
      if (have.has(src)) fail(`sw.js: ${src} не має лежати в SHELL — це аварійний вимикач`);
      continue;
    }
    if (!have.has(src)) {
      fail(`sw.js: у SHELL немає ${src}, який підключає index.html — офлайн після встановлення буде неповним`);
    }
  }
}

/* ---- 8. Барʼєр NOT_APPROVED не зникає з db/*.sql --------------------- */
//
// INV-002 / DB-013: у бойовій базі elo_state, elo_activate_grace, elo_submit
// та інші RPC мають перевірку is_approved — вона приїхала міграціями
// elo_approved_guard. А у файлах db/ її не було. Тобто виконання файла «щоб
// оновити функції» ЗНІМАЛО перевірку з продакшену: непідтверджений акаунт
// отримував доступ до сезонних RPC. Помітити це можна було тільки запитом
// до бази — тепер помічає CI.
//
// Джерело правди — db/live-schema.sql (знімок бойової схеми). Якщо функція
// має барʼєр там, вона мусить мати його в кожному файлі db/, який її
// перевизначає.
//
// Барʼєрів тепер три, і два додано 16.09.2026, коли аудит показав те саме
// в іншому місці: у бойовому elo_set_name є перевірка унікальності ніка
// (USERNAME_TAKEN проти account_status і season_state), а в nick-length.sql
// і leaderboard-name.sql її немає ЗОВСІМ. Прогін будь-якого з них знімав би
// її з продакшену — дослівно сценарій INV-002, тільки з ніком замість
// підтвердження акаунта.
//
// ВИНЯТОК — файли з позначкою «ПЕРЕКРИТО» в шапці. Це історія, а не чинне
// джерело: у них тіла свідомо старіші за базу, і вимагати від них барʼєр
// означало б переписувати історію замість того, щоб її позначити. Що
// позначка на місці й осмислена — стереже перевірка 21.
const DB_GUARDS = ['NOT_APPROVED', 'USERNAME_TAKEN', 'SCREENING_TOO_LARGE'];
const supersededSql = new Set();
if (existsSync('db/live-schema.sql')) {
  const live = readFileSync('db/live-schema.sql', 'utf8');
  /* Межа тіла — початок НАСТУПНОЇ функції. Шукати роздільник $function$
     ненадійно: частина функцій у знімку однорядкові, і він стоїть у тому
     самому рядку, що й тіло. */
  const heads = [...live.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)];
  const guarded = new Map();          // функція → які барʼєри має в базі
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : live.length;
    const body = live.slice(m.index, end);
    const has = DB_GUARDS.filter((g) => body.includes(g));
    if (has.length) guarded.set(m[1], has);
  });
  for (const f of tracked.filter((x) => x.startsWith('db/') && x.endsWith('.sql') && x !== 'db/live-schema.sql')) {
    const src = readFileSync(f, 'utf8');
    if (/^--\s*ПЕРЕКРИТО:/m.test(src.slice(0, 600))) { supersededSql.add(f); continue; }
    const defs = [...src.matchAll(/create or replace function public\.(\w+)\s*\(/gi)];
    defs.forEach((g, i) => {
      const need = guarded.get(g[1]);
      if (!need) return;
      const end = i + 1 < defs.length ? defs[i + 1].index : src.length;
      const body = src.slice(g.index, end);
      for (const barrier of need) {
        if (!body.includes(barrier)) {
          fail(`${f}: public.${g[1]} без перевірки ${barrier}, хоча в базі вона є — `
             + 'виконання цього файла зніме барʼєр із продакшену. Якщо файл — '
             + 'історія, а не чинне джерело, позначте його в шапці рядком '
             + '«-- ПЕРЕКРИТО: <чим>».');
        }
      }
    });
  }
}

/* ---- 9. Жодного inline-JS у розмітці --------------------------------- */
//
// WEB-006: щоб працював inline-скрипт теми і onload="this.media='all'" на
// шрифтах, у CSP доводилось тримати script-src 'unsafe-inline'. А це рівно
// та директива, яка дозволяє <img src=x onerror=…> — робочу форму єдиного
// знайденого XSS-синка (WEB-002). Код винесено у js/theme-boot.js та
// сусідні файли, 'unsafe-inline' прибрано. Один необережно доданий
// onclick= поверне діру — і без цієї перевірки це помітить лише аудит.
{
  const INLINE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const HANDLER = /\son[a-z]+\s*=\s*"/g;
  for (const f of tracked.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    let m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(html))) {
      if (m[1].trim()) fail(`${f}: inline <script> — через нього CSP потребує 'unsafe-inline'`);
    }
    HANDLER.lastIndex = 0;
    while ((m = HANDLER.exec(html))) {
      fail(`${f}: обробник у розмітці (${m[0].trim()}…) — те саме 'unsafe-inline'`);
    }
  }
  if (existsSync('vercel.json')) {
    const csp = (readFileSync('vercel.json', 'utf8').match(/script-src[^;"]*/) || [''])[0];
    if (csp.includes('unsafe-inline')) fail("vercel.json: script-src знову дозволяє 'unsafe-inline'");
    if (csp.includes('unsafe-eval')) fail("vercel.json: script-src дозволяє 'unsafe-eval'");
  }
}

/* ---- 10. Баланс ELO не виходить за межі CHECK у базі ----------------- */
//
// DB-005: коментарі стверджують, що баланс міняється одним UPDATE
// elo_config. Але дві межі продубльовані в CHECK: season_state.elo <= 2500
// і grace_used <= 2. Підняти seasonMax до 3000 або graceWeeksPerSeason до 3
// «одним UPDATE» можна — помилки не буде одразу, вона вилізе пізніше як
// 23514 всередині elo_submit або elo_activate_grace, у людини під час
// звичайної дії. Тут це ловиться до публікації.
//
// Джерело правди про межі — db/live-schema.sql (знімок бойової схеми).
if (existsSync('db/elo-config.json') && existsSync('db/live-schema.sql')) {
  const cfg = JSON.parse(readFileSync('db/elo-config.json', 'utf8'));
  const live = readFileSync('db/live-schema.sql', 'utf8');
  const bound = (re) => {
    const m = live.match(re);
    return m ? Number(m[1]) : null;
  };
  const eloMax = bound(/season_state_elo_check CHECK \(\(\(elo >= 0\) AND \(elo <= (\d+)\)\)\)/);
  const graceMax = bound(/season_state_grace_used_check CHECK \(\(\(grace_used >= 0\) AND \(grace_used <= (\d+)\)\)\)/);
  if (eloMax !== null && Number(cfg.seasonMax) > eloMax) {
    fail(`db/elo-config.json: seasonMax ${cfg.seasonMax} більший за CHECK у базі (${eloMax}) — ` +
         'підняти можна лише міграцією, інакше 23514 вилізе в людини під час дії');
  }
  if (graceMax !== null && Number(cfg.graceWeeksPerSeason) > graceMax) {
    fail(`db/elo-config.json: graceWeeksPerSeason ${cfg.graceWeeksPerSeason} більший за CHECK у базі (${graceMax})`);
  }
}

/* ---- 11. Чужі секрети у файлах і в іменах ---------------------------- */
//
// Пункт 4 розбирає JWT Supabase — тобто рівно той ключ, який тут ЗАКОННО
// лежить. Але в проєкт заходять і чужі: токен GitHub для публікації, ключ
// поштового сервісу, пароль до бази при відновленні дампа. Жоден із них не
// має бути у файлі, і жоден не ловився попередніми пунктами.
//
// Формат кожного шаблону — це префікс постачальника плюс довжина, а не
// «щось схоже на ключ»: перевірка мусить мовчати на звичайному коді, інакше
// її вимкнуть через тиждень. Пароль і «секрет у лапках» свідомо НЕ
// шукаються: рядок `password: 'ваш-пароль'` у документації дав би хибну
// тривогу, а справжній пароль однаково їде або в .env (заборонений нижче й
// у .gitignore), або в дампі бази (пункт 1).
const SECRETS = [
  [/gh[pousr]_[A-Za-z0-9]{36}/,            'токен GitHub'],
  [/github_pat_[A-Za-z0-9_]{60,}/,         'токен GitHub (fine-grained)'],
  [/\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}/, 'ключ Resend'],
  [/\bsbp_[a-f0-9]{40}/,                   'персональний токен Supabase'],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{24,}/,     'ключ OpenAI / Anthropic'],
  [/\b[rs]k_live_[A-Za-z0-9]{20,}/,        'бойовий ключ Stripe'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,        'ключ AWS'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/,            'ключ Google API'],
  [/\bxox[baprs]-[A-Za-z0-9-]{12,}/,       'токен Slack'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/,           'токен GitLab'],
  [/\bnpm_[A-Za-z0-9]{36}\b/,              'токен npm'],
  [/\bdop_v1_[a-f0-9]{64}\b/,              'токен DigitalOcean'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'приватний ключ'],
  [/postgres(?:ql)?:\/\/[^\s'"]{0,40}:[^\s'"@]{3,}@/,        'рядок підключення до бази з паролем']
];
for (const f of tracked.filter((f) => TEXT.test(f))) {
  let body;
  try { body = readFileSync(f, 'utf8'); } catch { continue; }
  for (const [re, what] of SECRETS) {
    const m = body.match(re);
    if (m) {
      /* Самого значення в помилку НЕ пишемо: звіт CI публічніший за
         репозиторій, і надрукувати ключ тут означало б злити його вдруге. */
      const line = body.slice(0, m.index).split('\n').length;
      fail(`${f}:${line} — схоже на ${what}. Ключ треба відкликати в постачальника ` +
           'і прибрати з файла; переписати коміт замало, він уже в історії');
    }
  }
}

// Файли, яких у репозиторії статичного сайту не має бути в принципі.
// .env — окремо: змінних оточення проєкт не використовує (див. README,
// розділ Configuration), тож такий файл означає, що в нього поклали чужий
// ключ або пароль.
const FORBIDDEN = [
  [/(^|\/)\.env(\..+)?$/i, 'файл змінних оточення'],
  [/\.(pem|p12|pfx)$/i,    'сертифікат або приватний ключ'],
  [/(^|\/)id_(rsa|ed25519)(\.pub)?$/, 'ключ SSH'],
  [/(^|\/)\.npmrc$/,       '.npmrc (у ньому живе токен npm)'],
  [/(^|\/)\.netrc$/,       '.netrc (у ньому живуть логін і пароль)']
];
for (const f of tracked) {
  for (const [re, what] of FORBIDDEN) {
    if (re.test(f)) fail(`${f} — ${what}: такому файлу не місце в репозиторії`);
  }
}

/* ---- 12. Скрипти запуску лишаються виконуваними ---------------------- */
//
// Привід реальний: Опублікувати.command приїхав у репозиторій із правами
// 0644, і подвійний клік у Finder дав «у вас немає відповідних привілеїв
// доступу». Файл цілий, код правильний, публікація не відбувається —
// а причина не видно ні в тестах, ні в дифі, бо git показує зміну режиму
// тільки окремим рядком, який легко проґавити.
//
// Перевіряємо режим саме в ІНДЕКСІ git, а не на диску: на диску біт може
// стояти локально й не доїхати в коміт — тоді у всіх інших він знову
// зникне. 100755 — виконуваний, 100644 — ні.
const RUNNABLE = /\.(command|sh)$/i;
// -z обовʼязково: без нього git екранує кирилицю в \320\236… і назва
// файла в повідомленні стає нечитабельною саме там, де її треба прочитати.
const modes = execFileSync('git', ['ls-files', '-s', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((line) => {
    const m = /^(\d{6})\s+\S+\s+\d+\t([\s\S]*)$/.exec(line);
    return m ? { mode: m[1], file: m[2] } : null;
  })
  .filter(Boolean);
for (const { mode, file } of modes) {
  if (RUNNABLE.test(file) && mode !== '100755') {
    fail(`${file} — не виконуваний (${mode}): подвійний клік дасть відмову в доступі. `
       + `Лікується так: git update-index --chmod=+x «${file}»`);
  }
}

/* ---- 13. Адреса репозиторію написана скрізь однаково ----------------- */
//
// Привід реальний: у скрипті публікації стояло «…/Get-Stronger», а
// репозиторій зветься «GetStronger» — без дефіса. (Приклад навмисно без
// повної адреси: вона потрапила б під цю саму перевірку.) Один зайвий символ, і
// публікація падала з «Repository not found». Найгірше тут не помилка, а
// підказка: скрипт радив СТВОРИТИ репозиторій, бо для приватного GitHub
// навмисно віддає «не знайдено» замість «немає доступу». Тобто порада
// вела не туди, куди треба, — створити другий репозиторій замість
// виправлення літери.
//
// Джерело одне — REPO_URL у скрипті публікації. Решта файлів (README,
// AGENTS.md, скрипти в tools/) мусять називати те саме місце. Записи
// аудиту в docs/audit/ не чіпаємо: вони описують минулий стан, і
// підганяти їх під сьогодні означало б переписати історію.
const PUB = 'Опублікувати.command';
if (existsSync(PUB)) {
  const src = readFileSync(PUB, 'utf8');
  const m = /REPO_URL="https:\/\/github\.com\/([^/"]+)\/([^/".]+)/.exec(src);
  if (!m) {
    fail(`${PUB} — не видно REPO_URL: перевірка адреси репозиторію осліпла`);
  } else {
    const canon = `${m[1]}/${m[2]}`;
    const REF = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
    for (const f of tracked) {
      if (!TEXT.test(f) || f.startsWith('docs/audit/')) continue;
      let body = '';
      try { body = readFileSync(f, 'utf8'); } catch { continue; }
      for (const hit of body.matchAll(REF)) {
        const where = `${hit[1]}/${hit[2].replace(/\.git$/, '')}`;
        if (where.toLowerCase() === canon.toLowerCase() && where !== canon) {
          fail(`${f} — «${where}» замість «${canon}»: GitHub розрізняє регістр`);
        } else if (hit[1] === m[1] && where !== canon) {
          fail(`${f} — посилається на «${where}», а публікація йде в «${canon}»`);
        }
      }
    }
  }
}

/* ---- 14. Дата рахується ОДНИМ способом ------------------------------ */
//
// Привід — аудит 12.09.2026. Одні й ті самі чотири функції жили копіями в
// сімох файлах, і копії вже розійшлись: keyOf мав три реалізації, dateOf
// три, todayKey три, а mondayOf — ЧОТИРИ. Одна з них (journal.js) лишала
// час доби, тимчасом як решта нормалізували до півночі.
//
// Такі розходження не падають. На екрані дата правильна, неправильне лише
// «скільки днів тому» — і помічають це через місяці, коли зіпсовані вже
// стріки, тижні й рейтинг. Дата в Get Stronger лежить в основі всього
// цього, тож правило просте: реалізація одна, решта — делегати.
//
// Делегатом вважається функція, у тілі якої є window.DateCore. Тобто
// лишити імʼя заради сотні місць виклику можна; написати всередині свою
// арифметику — ні.
// Список росте тоді, коли знаходиться чергова копія. 16.09.2026 до нього
// додано diffDays і shiftKey: js/adherence-core.js рахував різницю днів
// САМ — будував два місцевих Date і ділив мілісекунди, тобто в добу
// переходу на літній час мав 23 години замість 24. Ім'я було інше, тому
// перевірка його не бачила: вона шукала daysBetween.
const DATE_FNS = ['keyOf', 'todayKey', 'dateOf', 'mondayOf', 'daysBetween',
                  'addDaysKey', 'diffDays', 'shiftKey'];
for (const f of tracked) {
  if (!/^js\/.+\.js$/.test(f) || f === 'js/date-core.js') continue;
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  for (const name of DATE_FNS) {
    const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
    let m;
    while ((m = re.exec(src))) {
      /* Тіло функції: від відкритої дужки до парної закритої. */
      let depth = 0, end = -1;
      for (let i = src.indexOf('{', m.index); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (!depth) { end = i; break; } }
      }
      const body = end > 0 ? src.slice(m.index, end + 1) : '';
      if (!/window\.DateCore/.test(body)) {
        fail(`${f} — власна реалізація ${name}(): дата має рахуватись лише в `
           + `js/date-core.js. Лишіть імʼя делегатом: `
           + `function ${name}(...) { return window.DateCore.${name}(...); }`);
      }
    }
  }
}

/* ---- 15. Сторінка мусить вантажити ядра, до яких ходять її модулі ---- */
//
// Модулі кличуть window.DateCore у момент ВИКЛИКУ, а не завантаження —
// тобто забутий рядок у <head> не ламає сторінку одразу. Вона падає
// пізніше й в іншому місці: «Cannot read properties of undefined».
//
// Спершу правило знало лише про дату. Другим у списку став RepsCore:
// js/workout-core.js делегує йому нормалізацію RIR підходу, і це
// НЕОБОВʼЯЗКОВА залежність рівно до того дня, коли хтось додасть
// сторінку з тренуванням і забуде рядок. Список не «на майбутнє» — у
// нього дописують ядро тоді, коли до нього зʼявився делегат.
const CORE_DEPS = [
  { global: 'DateCore', file: 'js/date-core.js', what: 'рахує дату' },
  { global: 'RepsCore', file: 'js/reps-core.js', what: 'ходить до RepsCore' }
];
for (const dep of CORE_DEPS) {
  const re = new RegExp('window\\.' + dep.global);
  const users = tracked.filter((f) => /^js\/.+\.js$/.test(f) && f !== dep.file)
    .filter((f) => { try { return re.test(readFileSync(f, 'utf8')); } catch { return false; } })
    .map((f) => f.replace(/^js\//, ''));
  for (const page of tracked.filter((f) => /^[^/]+\.html$/.test(f))) {
    let html = '';
    try { html = readFileSync(page, 'utf8'); } catch { continue; }
    const uses = users.filter((m) => html.includes('js/' + m));
    if (uses.length && !html.includes(dep.file)) {
      fail(`${page} — вантажить ${uses[0]}, який ${dep.what}, але не вантажить ${dep.file}`);
    }
  }
}

/* ---- 16. CSS не возить мертвих правил -------------------------------- */
//
// Привід — той самий аудит. У файлі, який їде на КОЖНУ сторінку, лежали
// правила для класів, чиї екрани прибрали кілька релізів тому: .tdy-entry
// (картка-вхід у тренування), .qi-check (сторінка вводу трекерів),
// .dash__h1 (стара головна), .wk__cell, .tr-custom-row. Разом близько
// сорока правил, які ніхто не малює.
//
// Мертвий CSS не просто важить. Він бреше: наступний, хто шукатиме «як
// виглядає картка входу», знайде готові стилі й вирішить, що вона є.
//
// ЩО САМЕ ЛОВИТЬСЯ. Тільки класи, від яких не лишилось НІЯКОГО сліду —
// навіть частини імені в лапках. Класи, що збираються в коді
// ('awd--t' + n, 'is-l' + lvl, 'twt--' + kind), під це не підпадають: у
// них є префікс у рядку, і перевірка їх пропускає. Тому вона не заважає
// писати динамічні класи — вона ловить лише забуте.
{
  const cssFile = 'css/style.css';
  if (existsSync(cssFile)) {
    const raw = readFileSync(cssFile, 'utf8');
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    /* Класи беремо лише там, де крапці передує початок рядка, пробіл або
       синтаксис селектора: інакше в улов потрапляє «woff2» із
       format("woff2") і решта розширень усередині url(). */
    const classes = new Set();
    for (const m of css.matchAll(/(^|[\s,{}>+~():[])\.([a-zA-Z][\w-]*)/gm)) classes.add(m[2]);

    const hay = tracked
      .filter((f) => /\.(html|js)$/.test(f) && !f.startsWith('tools/') && !f.startsWith('tests/'))
      .map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } })
      .join('\n');

    const dynamic = (c) => {
      /* Чи є в коді бодай початок цього імені в лапках — тобто чи може
         клас збиратись конкатенацією. Менше за чотири символи не
         рахуємо: такий «префікс» збігається з чим завгодно. */
      for (let i = c.length - 1; i >= 4; i--) {
        const pre = c.slice(0, i);
        if (hay.includes("'" + pre) || hay.includes('"' + pre)) return true;
      }
      return false;
    };

    const dead = [...classes].filter((c) => !hay.includes(c) && !dynamic(c)).sort();
    if (dead.length) {
      fail(`${cssFile} — правила для класів, яких немає ніде: `
         + dead.map((c) => '.' + c).join(', ')
         + '. Або клас загубився разом зі своїм екраном, або його забули застосувати.');
    }
  }
}

/* ---- 17. Назви місяців і днів тижня — теж в ОДНОМУ місці ------------ */
//
// Привід — аудит 13.09.2026. Список місяців у родовому відмінку жив
// ЧОТИРМА копіями: js/app.js, js/journal.js, js/statwindow-core.js і
// js/elo-view-core.js. Це та сама хвороба, що в пункті 14, лише тихіша:
// чотири однакові масиви не падають ніколи — вони просто починають
// розходитись написанням, і на одному екрані зʼявляється «13 Вересень»,
// а на сусідньому «13 вересня». Помічає це людина, і не одразу.
//
// Джерело одне — js/date-core.js (MONTHS_GEN, MONTHS_NOM, WEEKDAYS).
// Ловимо не слово взагалі (воно законно стоїть у текстах довідки), а
// саме СПИСОК: масив, у якому поруч стоять два сусідні місяці або два
// сусідні дні тижня.
{
  const PAIRS = [
    [/['"]січня['"]\s*,\s*['"]лютого['"]/, 'місяці в родовому відмінку'],
    [/['"]Січень['"]\s*,\s*['"]Лютий['"]/, 'місяці в називному'],
    [/['"]Неділя['"]\s*,\s*['"]Понеділок['"]/, 'дні тижня']
  ];
  for (const f of tracked) {
    if (!/^js\/.+\.js$/.test(f) || f === 'js/date-core.js') continue;
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    for (const [re, what] of PAIRS) {
      if (re.test(src)) {
        fail(`${f} — власний список: ${what}. Такі словники живуть у `
           + 'js/date-core.js (MONTHS_GEN, MONTHS_NOM, WEEKDAYS); тут має бути '
           + 'посилання на нього, інакше копії розійдуться написанням і ніхто '
           + 'цього не помітить.');
      }
    }
  }
}

/* ---- 18. Знімок схеми: жодної функції ПІСЛЯ загального revoke -------- */
//
// Привід — аудит 16.09.2026. db/live-schema.sql генерується запитом
// (db/dump-live-schema.sql) і має жорсткий порядок секцій: усі функції,
// потім один рядок
//
//     revoke execute on all functions in schema public from public;
//
// який знімає з них дефолтне право PUBLIC. Але файл двічі дописували
// руками — нові функції лягали в КІНЕЦЬ, тобто після цього рядка. У
// бойовій базі права були правильні, а от розгортання знімка на чистій
// базі (саме так відновлюють із резервної копії і саме так працюють усі
// SQL-перевірки) залишало elo_cfg_for і elo_cfg_apply — SECURITY DEFINER,
// що приймають uid ПАРАМЕТРОМ, — доступними для authenticated.
//
// Тобто копія схеми виходила дозвільнішою за бойову базу, і перевірка
// прав цього не бачила, бо перевіряла копію.
{
  const f = 'db/live-schema.sql';
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { src = ''; }
  if (src) {
    const cut = src.indexOf('revoke execute on all functions in schema public from public;');
    if (cut === -1) {
      fail(`${f} — немає рядка «revoke execute on all functions in schema public `
         + 'from public;». Без нього копія схеми дозвільніша за бойову базу.');
    } else {
      const after = src.slice(cut);
      const late = [...after.matchAll(/^CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/gmi)]
        .map(m => m[1]);
      if (late.length) {
        fail(`${f} — ${late.length} функц. дописано після загального revoke `
           + `(${late.slice(0, 4).join(', ')}${late.length > 4 ? ', …' : ''}). `
           + 'Знімок генерується db/dump-live-schema.sql і має порядок секцій: '
           + 'функції → revoke → RLS. Дописане руками в кінець лишається з '
           + 'правом PUBLIC на копії схеми.');
      }
    }
  }
}

/* ---- 19. Що можна вимкнути в рейтингу — один список ------------------ */
//
// Привід — аудит 16.09.2026. Списків було три й усі різні: js/season.js
// пропонував вимкнути саме «Харчування», js/import-core.js приймав при
// імпорті чотири назви, а сервер (elo_cfg_for) — будь-що.
//
// Тепер дозволене живе в db/elo-config.json (ключ "skippable"), звідки
// його бере і база (elo_config.data), і екран. Для імпорту список
// потрібен офлайн, тож там лишається копія — і саме її стереже ця
// перевірка: розійдеться з конфігом — імпорт або прийме заборонене, або
// відкине дозволене.
{
  let cfg = null;
  try { cfg = JSON.parse(readFileSync('db/elo-config.json', 'utf8')); } catch { cfg = null; }
  const want = Array.isArray(cfg && cfg.skippable) ? cfg.skippable.slice().sort() : null;
  if (!want || !want.length) {
    fail('db/elo-config.json — немає (або порожній) ключ "skippable". Це список '
       + 'категорій рейтингу, які взагалі можна вимкнути; сервер звіряється '
       + 'саме з ним, і порожній список означає «вимикати не можна нічого».');
  } else {
    let src = '';
    try { src = readFileSync('js/import-core.js', 'utf8'); } catch { src = ''; }
    const m = src.match(/const KNOWN = \[([^\]]*)\]/);
    const got = m ? [...m[1].matchAll(/'([a-z]+)'/g)].map(x => x[1]).sort() : null;
    if (!got) {
      fail('js/import-core.js — не знайдено списку KNOWN у гілці eloSkip. '
         + 'Перевірка 19 звіряє його з db/elo-config.json → skippable.');
    } else if (got.join(',') !== want.join(',')) {
      fail(`js/import-core.js — KNOWN = [${got.join(', ')}], а в `
         + `db/elo-config.json skippable = [${want.join(', ')}]. `
         + 'Імпорт приймав би не те, що визнає сервер.');
    }
  }
}

/* ---- 20. Числа проєкту живуть в ОДНОМУ місці й не брешуть ------------ */
//
// Привід — аудит 16.09.2026. Одні й ті самі числа стояли шістьма копіями
// в README.md, RELEASE.md, docs/MAP.md, docs/CONTINUE.md,
// docs/ENGINEERING.md і tools/README-verify.md, і жодні дві копії не
// збігались: «1107 юніт-тестів» проти «1004» проти «998», «46 браузерних
// наборів» проти справжніх 55, «33 ядра» проти 38.
//
// Копія числа не падає — вона просто старіє. Читач довіряє їй рівно доти,
// доки не перевірить руками, а перевіряти руками ніхто не буде.
//
// Тепер таблиця одна (AGENTS.md, §2.2, між мітками ЧИСЛА:ПОЧАТОК і
// ЧИСЛА:КІНЕЦЬ), і ось тут вона звіряється з репозиторієм.
{
  const want = {
    'сторінок `*.html`':              tracked.filter(f => /^[^/]+\.html$/.test(f)).length,
    'файлів у `js/`':                 tracked.filter(f => /^js\/[^/]+\.js$/.test(f)).length,
    'з них ядра `*-core.js` / `*-data.js`':
                                      tracked.filter(f => /^js\/.+-(core|data)\.js$/.test(f)).length,
    'файлів `tests/*.test.js`':       tracked.filter(f => /^tests\/.+\.test\.js$/.test(f)).length,
    'скриптів `tools/verify*.mjs`':   tracked.filter(f => /^tools\/verify.*\.mjs$/.test(f)).length
  };

  /* Набори браузерних перевірок читаються з самого ci-browser.sh: це
     теж «число», і теж мусить збігатися без ручного перерахунку. */
  let sh = '';
  try { sh = readFileSync('tools/ci-browser.sh', 'utf8'); } catch { sh = ''; }
  const listOf = (name) => {
    const m = new RegExp(name + '="([^"]*)"', 's').exec(sh);
    return m ? m[1].replace(/\\\n/g, ' ').trim().split(/\s+/).filter(Boolean) : [];
  };
  const core = listOf('CORE'), full = listOf('FULL');
  want['наборів у `ci-browser.sh core`'] = core.length;
  want['наборів у `ci-browser.sh full`'] = core.length + full.length;

  /* Скільки перевірок у цьому файлі — за заголовками розділів. */
  let self = '';
  try { self = readFileSync('tools/ci-hygiene.mjs', 'utf8'); } catch { self = ''; }
  want['перевірок гігієни'] = (self.match(/^\/\* ---- \d+\. /gm) || []).length;

  let agents = '';
  try { agents = readFileSync('AGENTS.md', 'utf8'); } catch { agents = ''; }
  const block = /ЧИСЛА:ПОЧАТОК[\s\S]*?ЧИСЛА:КІНЕЦЬ/.exec(agents);
  if (!block) {
    fail('AGENTS.md — немає блоку між «ЧИСЛА:ПОЧАТОК» і «ЧИСЛА:КІНЕЦЬ». '
       + 'Це єдине місце, де в проєкті стоять числа; решта документів має '
       + 'посилатись на нього, а не заводити свою копію.');
  } else {
    const got = {};
    for (const line of block[0].split('\n')) {
      const m = /^\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/.exec(line.trim());
      if (m) got[m[1]] = Number(m[2]);
    }
    for (const [what, n] of Object.entries(want)) {
      if (!(what in got)) {
        fail(`AGENTS.md §2.2 — у таблиці чисел немає рядка «${what}» (насправді ${n}).`);
      } else if (got[what] !== n) {
        fail(`AGENTS.md §2.2 — «${what}»: написано ${got[what]}, насправді ${n}.`);
      }
    }
    for (const what of Object.keys(got)) {
      if (!(what in want)) {
        fail(`AGENTS.md §2.2 — рядок «${what}» ніхто не рахує. Число, яке не `
           + 'звіряється, застаріє мовчки: або додайте лічильник у перевірку 20, '
           + 'або приберіть рядок.');
      }
    }
  }
}

/* ---- 21. «ПЕРЕКРИТО» мусить казати, ЧИМ саме ------------------------- */
//
// Привід — аудит 16.09.2026. У db/ дванадцять файлів, тіла функцій у яких
// старіші за базу: elo-engine.sql (8 із 11), elo-integrity.sql (7 із 8),
// elo-authoritative.sql (6 із 9) і далі. Кожен виглядає як «схема» — і
// саме такий прогін колись зняв із продакшену барʼєр NOT_APPROVED.
//
// Позначка в шапці рятує лише доти, доки вона осмислена. «ПЕРЕКРИТО:» без
// назви — це «не запускай, бо не треба»: наступна людина відкриє файл,
// не знайде чим саме, і піде дивитись у базу руками. Тому тут вимагається
// текст після двокрапки, і щоб названий файл справді існував.
{
  for (const f of supersededSql) {
    const src = readFileSync(f, 'utf8');
    const m = /^--\s*ПЕРЕКРИТО:\s*(.+)$/m.exec(src.slice(0, 600));
    const by = m ? m[1].replace(/\.\s*НЕ ЗАПУСКАТИ.*$/, '').trim() : '';
    if (!by) {
      fail(`${f} — позначка «ПЕРЕКРИТО:» без пояснення, чим саме. Напишіть `
         + 'назву файла-наступника або «пізнішими міграціями (чинне тіло — '
         + 'лише в live-schema.sql)».');
      continue;
    }
    for (const name of by.match(/[a-z0-9-]+\.sql/g) || []) {
      if (!tracked.includes('db/' + name)) {
        fail(`${f} — у позначці «ПЕРЕКРИТО» названо db/${name}, якого в `
           + 'репозиторії немає.');
      }
    }
  }
}

/* ---- підсумок -------------------------------------------------------- */
if (problems.length) {
  console.error('Гігієна репозиторію — знайдено проблеми:\n');
  for (const p of problems) console.error(`  ✕ ${p}`);
  console.error(`\n${problems.length} шт.`);
  process.exit(1);
}
console.log(`Гігієна репозиторію: чисто (${tracked.length} файлів перевірено).`);
