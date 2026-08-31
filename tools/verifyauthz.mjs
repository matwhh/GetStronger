/**
 * SECURITY: межа доступу на СЕРВЕРІ, а не в інтерфейсі.
 *
 * Б'є по живому Supabase публічним anon-ключем (він і так у js/config.js —
 * секрету тут немає) і перевіряє, що анонім НЕ дістає нічого захищеного:
 * ні читанням таблиць, ні викликом RPC, ні через view. Тест ПАДАЄ, якщо
 * колись хтось послабить grant чи політику й відкриє анонові доступ.
 *
 * Клас «authenticated, але НЕ approved» перевіряється на рівні БД
 * (імперсонація ролі authenticated + JWT-claim у SQL — див. звіт аудиту);
 * зробити те саме по HTTP означало б тримати живий підтверджений акаунт
 * без заявки, тож тут — саме анонімний зріз, який ловить регресію грантів.
 *
 * Запуск: node tools/verifyauthz.mjs
 */
import { readFileSync } from 'node:fs';

const cfg = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const BASE = (cfg.match(/url:\s*'([^']+)'/) || [])[1];
const ANON = (cfg.match(/anonKey:\s*'([^']+)'/) || [])[1];
if (!BASE || !ANON) { console.error('Не знайшов url/anonKey у js/config.js'); process.exit(2); }

const REST = BASE + '/rest/v1';
const H = { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' };

const R = [];
const ok = (name, pass, detail) => {
  R.push([name, pass]);
  console.log((pass ? 'OK   ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
};

/** Захищений шлях: очікуємо відмову (401/403) або порожній/помилковий JSON. */
async function denied(name, url, opts) {
  try {
    const res = await fetch(url, opts);
    const body = await res.text();
    let json = null; try { json = JSON.parse(body); } catch (_) {}
    const httpBlocked = res.status === 401 || res.status === 403;
    // PostgREST інколи віддає 200 з []; для захищеної таблиці анон має або
    // отримати permission denied, або порожньо — але НІКОЛИ рядок з даними.
    const leaked = Array.isArray(json) && json.length > 0;
    const rpcErr = json && json.code === '42501';
    const pass = (httpBlocked || rpcErr) && !leaked;
    ok(name, pass, 'HTTP ' + res.status + (leaked ? ' — ВИТІК ДАНИХ' : ''));
  } catch (e) {
    ok(name, false, 'мережева помилка: ' + e.message);
  }
}

const OTHER_UID = '3ed0794f-2482-491d-bb0c-1a907be33150'; // існуючий адмін-акаунт

/* ---- анон читає захищені таблиці ---- */
for (const t of ['profiles', 'account_status', 'season_state', 'elo_events',
                 'awards', 'consent_log', 'admins', 'season_history', 'elo_config']) {
  await denied('anon SELECT ' + t, REST + '/' + t + '?select=*', { headers: H });
}
await denied('anon SELECT leaderboard (view)', REST + '/leaderboard?select=*', { headers: H });

/* ---- анон викликає захищені RPC ---- */
const rpc = (n, b) => denied('anon RPC ' + n, REST + '/rpc/' + n,
  { method: 'POST', headers: H, body: JSON.stringify(b || {}) });
await rpc('account_state');
await rpc('register_request', { p_username: 'x', p_birth: '1990-01-01', p_screening: {}, p_consents: [] });
await rpc('elo_state');
await rpc('elo_submit', { p_kind: 'training', p_action_key: 'k', p_day: '2026-08-31', p_payload: {} });
await rpc('elo_leaderboard', { p_limit: 50 });
await rpc('admin_requests', { p_status: null, p_limit: 200, p_offset: 0 });
await rpc('admin_decide', { p_user: OTHER_UID, p_action: 'approve' }); // спроба self/other-approve
await rpc('admin_elo_set', { p_user: OTHER_UID, p_elo: 2500, p_reason: 'x' });

/* ---- анон пише напряму (self-approve / self-admin / чужий профіль) ---- */
await denied('anon INSERT profiles (чужий uid)', REST + '/profiles',
  { method: 'POST', headers: H, body: JSON.stringify({ user_id: OTHER_UID, data: {} }) });
await denied('anon INSERT account_status (self-approve)', REST + '/account_status',
  { method: 'POST', headers: H, body: JSON.stringify({ user_id: OTHER_UID, status: 'approved' }) });
await denied('anon INSERT admins (self-admin)', REST + '/admins',
  { method: 'POST', headers: H, body: JSON.stringify({ user_id: OTHER_UID }) });

const bad = R.filter((x) => !x[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок межі доступу пройшло.');
if (bad) console.log('УВАГА: знайдено обхід авторизації — див. FAIL вище.');
process.exit(bad ? 1 : 0);
