/* TEMPORARY AUDIT HARNESS — aggregate sim90 logs into tables. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
const OUT = process.cwd() + '/tools/sim90/out';
const FEAT = { onboard: 'F01 Реєстрація/онбординг', today: 'F02 Сьогодні', workout: 'F03 Тренування', weight: 'F04 Вага тіла (Прогрес)', heatmapMark: 'F05 Календар тренувань', trackers: 'F06 Трекери дня', meals: 'F07 Раціон', measure: 'F08 Заміри тіла', nutrition: 'F09 План харчування', planTweak: 'F10 Мій план (правки)', switchPlan: 'F11 Вибір програми', dropPlan: 'F12 Зняти план', periodization: 'F13 Періодизація', calculator: 'F14 1ПМ', cardio: 'F15 Кардіо', trackerSettings: 'F16 Налаштування трекерів', account: 'F17 Акаунт/тема', logoutLogin: 'F18 Вихід/вхід', rapidNav: 'S1 Швидка навігація', backForward: 'S2 Back/Forward', progressBrowse: 'F19 Прогрес (перегляд)', viewPage: 'F20 Довідкові сторінки', wipeLocal: 'F21 Стерти локальні дані' };
const users = {}; const feat = {}; const anomalies = []; const cps = {};
for (const f of readdirSync(OUT + '/log')) {
  const uid = Number(f.match(/u(\d+)/)[1]);
  const U = users[uid] = { uid, days: 0, active: 0, sessions: 0, actions: 0, failed: 0, feats: new Set(), pageErr: 0, consoleErr: 0, netErr: 0, reloads: 0, logins: 0, dialogs: 0, ms: 0, invariants: [] };
  for (const line of readFileSync(OUT + '/log/' + f, 'utf8').trim().split('\n')) {
    const r = JSON.parse(line);
    if (r.plan) { U.days++; U.active++; U.sessions += 1; continue; }
    if (r.active === false) { U.days++; continue; }
    if (r.checkpoint) { cps[uid] = cps[uid] || {}; cps[uid][r.day] = r; if (r.invariants.length) { U.invariants.push({ day: r.day, inv: r.invariants }); } continue; }
    if (!r.act) continue;
    U.actions++; U.ms += r.ms || 0; U.feats.add(r.act);
    const F = feat[r.act] = feat[r.act] || { n: 0, fail: 0, users: new Set(), pageErr: 0, consoleErr: 0 };
    F.n++; F.users.add(uid);
    if (!r.ok) { U.failed++; F.fail++; }
    if (r.pageErr.length) { U.pageErr += r.pageErr.length; F.pageErr++; }
    if (r.consoleErr.length) { U.consoleErr += r.consoleErr.length; F.consoleErr++; }
    if (r.netErr.length) U.netErr += r.netErr.length;
    if (r.dialogs.length) U.dialogs += r.dialogs.length;
    if (/reload/.test(r.note)) U.reloads++;
    if (r.act === 'logoutLogin') U.logins++;
    const flags = [];
    if (r.pageErr.length) flags.push('PAGEERR');
    if (r.consoleErr.length) flags.push('CONSOLE');
    if (!r.ok) flags.push('FAIL');
    if (/NOT-ended|modal-still-open|no-modal|no-exercises|not-signed-in|no-login-form/.test(r.note)) flags.push('UI');
    if (flags.length) anomalies.push({ uid, day: r.day, act: r.act, flags, err: r.err, note: (r.note || '').slice(0, 160), pageErr: r.pageErr.slice(0, 2), consoleErr: r.consoleErr.slice(0, 2), netErr: r.netErr.slice(0, 2) });
  }
}
console.log('=== USERS ===');
console.log('u | days active | sessions | actions | failed | pageErr | consoleErr | netErr | reloads | logins | dialogs | feats | inv');
for (const U of Object.values(users)) console.log([U.uid, U.days + '/' + U.active, U.sessions, U.actions, U.failed, U.pageErr, U.consoleErr, U.netErr, U.reloads, U.logins, U.dialogs, U.feats.size, U.invariants.length].join(' | '));
console.log('\n=== FEATURES ===');
for (const [k, F] of Object.entries(feat).sort((a, b) => b[1].n - a[1].n)) console.log((FEAT[k] || k).padEnd(34), 'n=' + String(F.n).padStart(4), 'users=' + F.users.size, 'fail=' + F.fail, 'pageErr=' + F.pageErr, 'console=' + F.consoleErr);
console.log('\n=== CHECKPOINTS ===');
for (const uid of Object.keys(cps)) for (const d of Object.keys(cps[uid])) { const c = cps[uid][d]; console.log('u' + uid, 'd' + d, JSON.stringify(c.counts), 'bytes=' + c.profileBytes, 'ls=' + c.ls, 'pending=' + c.pending, JSON.stringify(c.pages), c.invariants.length ? 'INV=' + JSON.stringify(c.invariants).slice(0, 300) : ''); }
console.log('\n=== ANOMALIES (' + anomalies.length + ') ===');
const byKey = {};
for (const a of anomalies) { const k = a.flags.join('+') + ' ' + a.act + ' :: ' + (a.pageErr[0] || a.consoleErr[0] || a.err || a.note.match(/NOT-ended|modal-still-open|no-modal|no-exercises|not-signed-in|no-login-form/)?.[0] || '').slice(0, 120); byKey[k] = byKey[k] || { n: 0, users: new Set(), first: a }; byKey[k].n++; byKey[k].users.add(a.uid); }
for (const [k, v] of Object.entries(byKey).sort((a, b) => b[1].n - a[1].n)) console.log(String(v.n).padStart(4), 'users=' + [...v.users].join(','), 'first=u' + v.first.uid + 'd' + v.first.day, '::', k);
