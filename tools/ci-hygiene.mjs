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
if (existsSync('db/live-schema.sql')) {
  const live = readFileSync('db/live-schema.sql', 'utf8');
  /* Межа тіла — початок НАСТУПНОЇ функції. Шукати роздільник $function$
     ненадійно: частина функцій у знімку однорядкові, і він стоїть у тому
     самому рядку, що й тіло. */
  const heads = [...live.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)];
  const guarded = new Set();
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : live.length;
    if (live.slice(m.index, end).includes('NOT_APPROVED')) guarded.add(m[1]);
  });
  for (const f of tracked.filter((x) => x.startsWith('db/') && x.endsWith('.sql') && x !== 'db/live-schema.sql')) {
    const src = readFileSync(f, 'utf8');
    const defs = [...src.matchAll(/create or replace function public\.(\w+)\s*\(/gi)];
    defs.forEach((g, i) => {
      if (!guarded.has(g[1])) return;
      const end = i + 1 < defs.length ? defs[i + 1].index : src.length;
      const body = src.slice(g.index, end);
      if (!body.includes('NOT_APPROVED')) {
        fail(`${f}: public.${g[1]} без перевірки is_approved, хоча в базі вона є — ` +
             'виконання цього файла зніме барʼєр із продакшену');
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

/* ---- підсумок -------------------------------------------------------- */
if (problems.length) {
  console.error('Гігієна репозиторію — знайдено проблеми:\n');
  for (const p of problems) console.error(`  ✕ ${p}`);
  console.error(`\n${problems.length} шт.`);
  process.exit(1);
}
console.log(`Гігієна репозиторію: чисто (${tracked.length} файлів перевірено).`);
