/*
 * TEMPORARY AUDIT HARNESS — sim90.
 * 10 synthetic users × 90 simulated days against the REAL UI in Chromium.
 * Touches no application code. Supabase is replaced by a per-user mock
 * cloud (in-memory + JSON file) so that cloud read/merge/push paths run,
 * but server-side RPC (ELO, approval, leaderboard) return {} — UNTESTED.
 *
 * usage: node tools/sim90/run.mjs <userId|all> [fromDay] [toDay]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { USERS, SEASON_SEED, DAY1 } from './personas.mjs';

const ROOT = process.cwd();
const OUT = process.env.SIM_OUT || (ROOT + '/tools/sim90/out');
mkdirSync(OUT + '/log', { recursive: true }); mkdirSync(OUT + '/cloud', { recursive: true });
mkdirSync(OUT + '/profiles', { recursive: true }); mkdirSync(OUT + '/cp', { recursive: true });
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const UID = (u) => '00000000-0000-4000-8000-0000000000' + String(u.id).padStart(2, '0');

/* ---------- deterministic randomness ---------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mkRng(u, day) { const seed = (SEASON_SEED ^ Math.imul(u.id, 2654435761) ^ Math.imul(day, 40503)) >>> 0; const f = mulberry32(seed); f.seed = seed; f.n = 0; return () => { f.n++; return f(); }; }
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const chance = (rng, p) => rng() < p;
const rnd = (rng, a, b) => a + rng() * (b - a);

/* ---------- dates ---------- */
function dayDate(day) { const d = new Date(DAY1 + 'T00:00:00'); d.setDate(d.getDate() + day - 1); return d; }
function key(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* ---------- mock cloud (per user, persisted) ---------- */
function cloudFile(u) { return OUT + '/cloud/u' + u.id + '.json'; }
function loadCloud(u) { try { return JSON.parse(readFileSync(cloudFile(u), 'utf8')); } catch (_) { return { row: null, writes: 0, reads: 0, rpc: {}, failed: 0 }; } }
function saveCloud(u, c) { writeFileSync(cloudFile(u), JSON.stringify(c)); }

/* ---------- logging ---------- */
function logLine(u, obj) { appendFileSync(OUT + '/log/u' + u.id + '.jsonl', JSON.stringify(obj) + '\n'); }

/* ---------- garbage inputs for error-prone behaviour ---------- */
const GARBAGE = ['', ' ', '0', '-5', '1e9', '99999', 'abc', '7,5', '7.5.5', '∞', 'NaN', '１００', '100kg', 'x'.repeat(300), '💪💪', '-0', '0.0001', '1000000000000', '  12  ', 'null'];

/* ============================================================ */
/* Browser session per user                                      */
/* ============================================================ */
async function openUser(u, state) {
  const dir = OUT + '/profiles/u' + u.id;
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: CHROME, headless: true,
    viewport: { width: u.vp.width, height: u.vp.height }, isMobile: u.vp.mobile, hasTouch: u.vp.mobile,
    deviceScaleFactor: u.vp.mobile ? 2 : 1
  });
  const cloud = loadCloud(u);
  state.cloud = cloud;
  state.net = { failed: 0, aborted: 0 };

  await ctx.addInitScript(() => {
    /* instrumentation only: count persistent listeners on document/window */
    window.__lsn = 0;
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (t, l, o) {
      if (this === document || this === window) window.__lsn++;
      return orig.call(this, t, l, o);
    };
  });

  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await ctx.route(/\/rest\/v1\/profiles/, async (route) => {
    const req = route.request();
    if (state.flaky && state.rng && state.rng() < state.flakyP) { state.net.aborted++; cloud.failed++; return route.abort('failed'); }
    if (req.method() === 'GET') {
      cloud.reads++;
      const body = cloud.row ? JSON.stringify([{ data: cloud.row.data }]) : '[]';
      return route.fulfill({ status: 200, contentType: 'application/json', body });
    }
    try {
      const b = JSON.parse(req.postData() || '[]');
      const row = Array.isArray(b) ? b[0] : b;
      if (row && row.data) { cloud.row = { data: row.data, user_id: row.user_id, updated_at: new Date().toISOString() }; cloud.writes++; }
    } catch (e) { cloud.badWrite = (cloud.badWrite || 0) + 1; }
    return route.fulfill({ status: 204, body: '' });
  });
  await ctx.route(/\/rest\/v1\/rpc\/([a-z_]+)/, (route) => {
    const name = route.request().url().match(/rpc\/([a-z_]+)/)[1];
    cloud.rpc[name] = (cloud.rpc[name] || 0) + 1;
    /* The only server answer emulated: the account is (instantly) approved.
       Real approval is a manual admin step on Supabase — NOT simulated. */
    if (name === 'account_state') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'approved', username: u.name, isAdmin: false }) });
    if (name === 'register_request') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route(/\/auth\/v1\//, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: 'tok-' + u.id + '-' + Date.now(), refresh_token: 'ref-' + u.id, expires_in: 3600, user: { id: UID(u), email: 'u' + u.id + '@sim.local' } })
  }));
  return ctx;
}

async function seedAuth(p, u) {
  /* Registration/e-mail confirmation/admin approval are server-side and
     NOT simulated: user starts as an approved account with a live session. */
  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  await p.evaluate((a) => {
    localStorage.setItem('ib.cloud', '1');
    localStorage.setItem('ib.session', JSON.stringify({ access_token: 'tok0', refresh_token: 'ref0', expires_at: Date.now() + 86400000 * 400, user: { id: a.id, email: a.email } }));
  }, { id: UID(u), email: 'u' + u.id + '@sim.local', name: u.name });
}

/* ============================================================ */
/* Page helpers                                                  */
/* ============================================================ */
const ms = () => Date.now();
async function go(p, page, wait) { await p.goto('file://' + ROOT + '/' + page, { waitUntil: 'load' }); await p.waitForTimeout(wait == null ? 900 : wait); return p.url().split('/').pop(); }
async function tap(p, sel, opts) {
  const l = typeof sel === 'string' ? p.locator(sel).first() : sel;
  await l.evaluate(e => e.scrollIntoView({ block: 'center' })).catch(() => {});
  try { return await l.click(Object.assign({ timeout: 4000, force: true }, opts || {})); }
  catch (e) {
    /* Playwright refuses off-viewport clicks even with force; a person would
       have scrolled. Fall back to a DOM click so the audit continues. */
    if (/outside of the viewport|not visible/.test(String(e.message))) return l.evaluate(el => el.click());
    throw e;
  }
}
/* Radios/checkboxes in Forge are visually hidden behind styled labels:
   click the label (what a person taps), fall back to a DOM click. */
async function tapRadio(p, loc) {
  /* The label often wraps a link (consents) — a centre click would open
     legal.html. A DOM click on the input itself is what the label would
     have forwarded anyway (click + change events). */
  await loc.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
  return loc.evaluate(el => el.click());
}
async function typeIn(p, sel, v, u, rng) {
  const l = typeof sel === 'string' ? p.locator(sel).first() : sel;
  const fast = u.patience < 0.3;
  if (fast || String(v).length > 12) await l.fill(String(v));
  else { await l.fill(''); await l.pressSequentially(String(v), { delay: Math.round(rnd(rng, 20, 90)) }); }
  await l.evaluate(e => e.dispatchEvent(new Event('change', { bubbles: true })));
}
function maybeGarbage(u, rng, good) { return chance(rng, u.err) ? pick(rng, GARBAGE) : good; }
const fmtKg = (n) => String(Math.round(n * 2) / 2).replace('.', ',');

async function localProfile(p) { return p.evaluate(() => { try { return JSON.parse(localStorage.getItem('ib.profile')) || {}; } catch (_) { return null; } }); }
async function lsBytes(p) { return p.evaluate(() => { let t = 0; const per = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const v = localStorage.getItem(k) || ''; per[k] = v.length; t += v.length + k.length; } return { total: t, per }; }); }

/* ============================================================ */
/* Actions (all through the real UI)                             */
/* ============================================================ */
const A = {};

A.onboard = async (p, u, rng, S) => {
  await seedAuth(p, u);
  const landed = await go(p, 'index.html', 1000);
  S.note('landed:' + landed);
  if (await p.locator('#au-name').count()) { await typeIn(p, '#au-name', u.name, u, rng); await tap(p, '#au-name-go'); await p.waitForTimeout(900); }
  if (await p.locator('#dob-d').count()) {
    const [y, m, d] = u.birth.split('-');
    if (chance(rng, u.err)) { await p.fill('#dob-d', '31'); await p.fill('#dob-m', '02'); await p.fill('#dob-y', y); await p.waitForTimeout(300); S.note('dob-invalid-first:' + (await p.locator('#gate-go').isDisabled())); }
    await p.fill('#dob-d', d); await p.fill('#dob-m', m); await p.fill('#dob-y', y); await p.waitForTimeout(300);
    await tap(p, '#gate-go'); await p.waitForTimeout(1200);
  }
  if (await p.locator('#b-height').count()) {
    await tapRadio(p, p.locator('input[name="b-sex"][value="' + u.sex + '"]').first());
    await typeIn(p, '#b-height', String(u.h), u, rng);
    /* body weight: Ukrainian users type a comma; the field is type=number.
       Try the comma first (as a person would) and record what happened. */
    await typeIn(p, '#b-weight', String(u.w).replace('.', ','), u, rng);
    const wv = await p.locator('#b-weight').inputValue();
    S.note('weight-typed=' + String(u.w).replace('.', ',') + ' field=' + JSON.stringify(wv));
    if (wv === '' || Number(wv) !== u.w) await typeIn(p, '#b-weight', String(u.w), u, rng);
    await p.selectOption('#b-activity', u.act).catch(() => {});
    const ta = p.locator('#b-trainage'); if (await ta.count()) await ta.selectOption(u.ta).catch(() => {});
    const hr = p.locator('#b-hrrest'); if (await hr.count() && chance(rng, 0.5)) await typeIn(p, hr, String(Math.round(rnd(rng, 52, 72))), u, rng);
    /* three mandatory consents (terms, privacy, medical) — a person ticks them */
    const cons = p.locator('#b-consents input[type=checkbox]'); const cc = await cons.count();
    for (let i = 0; i < cc; i++) { if (!(await cons.nth(i).isChecked())) await tapRadio(p, cons.nth(i)); }
    await p.waitForTimeout(300);
    S.note('body-go-disabled=' + (await p.locator('#body-go').isDisabled()) + ' consents=' + cc + ' note=' + (await p.locator('#body-note').textContent().catch(() => '')).trim().slice(0, 60));
    await tap(p, '#body-go'); await p.waitForTimeout(900);
    /* BMI warning modal (outside 18.5–25 etc.) — a person reads and taps OK */
    if (await p.locator('#bmi-w-ok').count()) { S.note('bmi-warn'); await tap(p, '#bmi-w-ok'); await p.waitForTimeout(1500); }
  }
  let now = p.url().split('/').pop();
  S.note('after-body:' + now + ' h1=' + (await p.locator('h1').first().textContent().catch(() => '')).trim().slice(0, 30));
  /* pending screen: the mock server answers "approved" on recheck */
  for (let i = 0; i < 3 && await p.locator('#au-recheck').count(); i++) { await tap(p, '#au-recheck'); await p.waitForTimeout(1200); }
  if (await p.locator('#au-recheck').count() === 0 && p.url().split('/').pop() === 'welcome.html') { await go(p, 'index.html', 1200); }
  now = p.url().split('/').pop();
  S.note('after-pending:' + now);
  if (now === 'programs.html' || await p.locator('input[name="days"]').count()) {
    await tapRadio(p, p.locator('input[name="days"][value="' + u.days + '"]').first()); await p.waitForTimeout(600);
    let picks = p.locator('#program-list [data-pick]');
    let n = await picks.count(); S.note('programs:' + n);
    /* a person who sees «Доступна при 4 дн.» tries other day counts */
    for (const d of ['4', '3', '5', '6']) { if (n) break; await tapRadio(p, p.locator('input[name="days"][value="' + d + '"]').first()); await p.waitForTimeout(500); picks = p.locator('#program-list [data-pick]'); n = await picks.count(); S.note('forced-days=' + d + ' programs=' + n); }
    const idx = Math.min(n - 1, Math.floor(rng() * n));
    await tap(p, picks.nth(idx)); await p.waitForTimeout(800);
    const choose = p.locator('button', { hasText: 'Обрати цей план' }).first();
    if (await choose.count()) { await tap(p, choose); await p.waitForTimeout(1200); }
    S.note('after-choose:' + p.url().split('/').pop());
  }
  /* working weights are entered on plan.html or workout.html — first gym visit */
  await go(p, 'plan.html', 1200);
  /* days are collapsed accordions — open the first one, like a person would */
  const heads = p.locator('#plan .acc__head'); const hc = await heads.count();
  for (let i = 0; i < hc; i++) { const h = heads.nth(i); if ((await h.getAttribute('aria-expanded')) !== 'true') { await tap(p, h); await p.waitForTimeout(250); } }
  let wts = p.locator('#plan input[data-act="weight"]:visible');
  let cnt = await wts.count(); S.note('plan-weight-fields:' + cnt + ' heads=' + hc);
  if (!cnt) { await go(p, 'workout.html', 1200); wts = p.locator('#workout [data-wt]:visible'); cnt = await wts.count(); S.note('workout-weight-fields:' + cnt); }
  for (let i = 0; i < Math.min(cnt, 5); i++) { await typeIn(p, wts.nth(i), fmtKg(rnd(rng, u.weightRange[0], u.weightRange[1])), u, rng); await p.waitForTimeout(200); }
  await p.waitForTimeout(800);
  const final = await go(p, 'index.html', 1200);
  S.note('final:' + final + ' h1=' + (await p.locator('h1').first().textContent().catch(() => '')).trim().slice(0, 30));
  if (final !== 'index.html') throw new Error('onboarding did not reach app: ' + final);
};

A.today = async (p, u, rng, S) => { await go(p, 'index.html'); S.note((await p.locator('#today').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120)); };

A.workout = async (p, u, rng, S) => {
  await go(p, 'workout.html', 1100);
  if (await p.locator('#wk-ended').count()) { S.note('already-ended'); return; }
  const dayRadios = p.locator('input[name="wk-day"]');
  if (await dayRadios.count() && chance(rng, 0.3)) { await tapRadio(p, dayRadios.nth(Math.floor(rng() * await dayRadios.count()))); await p.waitForTimeout(500); }
  const rows = p.locator('#workout .tdy-ex');
  const n = await rows.count(); if (!n) { S.note('no-exercises'); return; }
  const fraction = chance(rng, 0.15) ? rnd(rng, 0.2, 0.6) : (chance(rng, 0.7) ? 1 : rnd(rng, 0.6, 0.95));
  const doEx = Math.max(1, Math.round(n * fraction));
  let sets = 0;
  for (let i = 0; i < doEx; i++) {
    const row = rows.nth(i);
    const wt = row.locator('[data-wt]');
    if (await wt.count() && (await wt.inputValue()) === '' || chance(rng, 0.12)) {
      await typeIn(p, wt, maybeGarbage(u, rng, fmtKg(rnd(rng, u.weightRange[0], u.weightRange[1]))), u, rng);
    }
    const pips = row.locator('[data-set-n]');
    const pn = await pips.count();
    const done = chance(rng, 0.8) ? pn : Math.max(1, Math.floor(rng() * pn));
    if (u.patience < 0.3 && chance(rng, 0.5)) { await tap(p, pips.nth(done - 1)); sets += done; }
    else for (let k = 0; k < done; k++) { await tap(p, pips.nth(k)); sets++; if (chance(rng, u.dup)) await tap(p, pips.nth(k)).then(() => tap(p, pips.nth(k))); await p.waitForTimeout(u.patience < 0.3 ? 30 : 80); }
    if (chance(rng, 0.2)) { const tg = row.locator('[data-log-tgl]'); if (await tg.count() && !(await tg.isDisabled())) { await tap(p, tg); const sw = row.locator('[data-setw]'); if (await sw.count()) await typeIn(p, sw.first(), maybeGarbage(u, rng, fmtKg(rnd(rng, u.weightRange[0], u.weightRange[1]))), u, rng); } }
    if (chance(rng, u.reload * 0.5)) { S.note('reload-mid-workout'); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900); }
  }
  const st = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem(window.WorkoutCore.LS_TODAY)); } catch (_) { return null; } });
  S.note('sets-tapped=' + sets + ' state-done=' + (st && Array.isArray(st.done) ? st.done.map(x => Array.isArray(x) ? x.length : x).join('/') : 'none'));
  if (chance(rng, 0.85)) {
    S.dialog = 'accept';
    const fin = p.locator('#wk-finish');
    if (await fin.count()) {
      await tap(p, fin);
      if (chance(rng, u.dup)) { await tap(p, fin).catch(() => {}); S.note('dup-finish'); }
      await p.waitForTimeout(1400);
      S.note('finish:' + (await p.locator('#wk-ended').count() ? 'ended' : 'NOT-ended'));
    } else S.note('no-finish-btn');
  } else S.note('left-unfinished');
};

A.weight = async (p, u, rng, S) => {
  await go(p, 'journal.html', 1200);
  const w = (u.w + rnd(rng, -1.5, 1.5)).toFixed(1).replace('.', ',');
  await typeIn(p, '#w-kg', maybeGarbage(u, rng, w), u, rng);
  await tap(p, '#w-add');
  if (chance(rng, u.dup)) { await tap(p, '#w-add').catch(() => {}); S.note('dup-add'); }
  await p.waitForTimeout(700);
  const pr = await localProfile(p);
  const bl = pr && pr.bodyLog ? Object.keys(pr.bodyLog).length : (pr && Array.isArray(pr.weightHist) ? pr.weightHist.length : null);
  S.note('input=' + w + ' bodyLogKeys=' + bl + ' shown=' + (await p.locator('#jr-weight').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 60));
};

A.heatmapMark = async (p, u, rng, S) => { await go(p, 'journal.html', 1200); const b = p.locator('#t-mark'); if (await b.count() && !(await b.isDisabled())) { await tap(p, b); await p.waitForTimeout(500); S.note('marked'); } else S.note('already/none'); if (chance(rng, 0.3)) { const cells = p.locator('[data-hm]'); const c = await cells.count(); if (c) { await tap(p, cells.nth(Math.floor(rng() * c))); S.note('toggled-random-day'); } } };

A.trackers = async (p, u, rng, S) => {
  await go(p, 'trackers.html', 1100);
  const acts = [];
  if (chance(rng, 0.8)) { const w = p.locator('[data-trk-add]'); const c = await w.count(); if (c) { const k = Math.floor(rng() * c); await tap(p, w.nth(k)); if (chance(rng, u.dup)) await tap(p, w.nth(k)); acts.push('water'); } }
  if (chance(rng, 0.6)) { const h = p.locator('[data-trk-durh]'); if (await h.count()) { await typeIn(p, h, maybeGarbage(u, rng, String(Math.floor(rnd(rng, 5, 9)))), u, rng); await p.waitForTimeout(150); await typeIn(p, '[data-trk-durm]', maybeGarbage(u, rng, String(Math.floor(rnd(rng, 0, 59)))), u, rng); acts.push('sleep'); } }
  if (chance(rng, 0.6)) { const sc = p.locator('[data-trk-scale]'); const c = await sc.count(); if (c) { await tap(p, sc.nth(Math.floor(rng() * c))); acts.push('scale'); } }
  if (chance(rng, 0.5)) { const m = p.locator('[data-trk-mark]'); const c = await m.count(); if (c) { await tap(p, m.nth(Math.floor(rng() * c)).locator('xpath=..')); acts.push('mark'); if (chance(rng, 0.4)) { const d = p.locator('[data-trk-dose]'); if (await d.count()) { await typeIn(p, d.first(), maybeGarbage(u, rng, pick(rng, ['5', '3', '7,5', '10'])), u, rng); acts.push('dose'); } } } }
  if (chance(rng, 0.2)) { const v = p.locator('[data-trk-value]'); if (await v.count()) { await typeIn(p, v.first(), maybeGarbage(u, rng, String(Math.floor(rnd(rng, 2000, 14000)))), u, rng); acts.push('steps'); } }
  if (chance(rng, 0.2)) { const pr = p.locator('[data-trk-pair]'); const c = await pr.count(); if (c) { await tap(p, pr.nth(Math.floor(rng() * c))); acts.push('pair'); } }
  await p.waitForTimeout(600);
  const pr = await localProfile(p);
  const tk = pr && pr.trackerLog ? Object.keys(pr.trackerLog).map(k => k + ':' + Object.keys(pr.trackerLog[k] || {}).length).join(',') : 'none';
  S.note(acts.join('+') + ' | log=' + tk.slice(0, 120));
};

A.meals = async (p, u, rng, S) => {
  await go(p, 'meals.html', 1200);
  const q = p.locator('#d-quick'); if (!(await q.count())) { S.note('no-quick'); return; }
  const items = Math.floor(rnd(rng, 1, 4)); let added = 0;
  for (let i = 0; i < items; i++) {
    await q.fill(''); await q.pressSequentially(pick(rng, ['кур', 'вівс', 'яйц', 'рис', 'сир', 'банан', 'греч', 'молок', 'лосос', 'хліб']), { delay: 40 }); await p.waitForTimeout(400);
    const opt = p.locator('[data-quick-kind]'); const c = await opt.count(); if (!c) { S.note('no-match'); continue; }
    await tap(p, opt.nth(Math.floor(rng() * c))); await p.waitForTimeout(500);
    const g = p.locator('#m-grams'); if (!(await g.count())) { S.note('no-modal'); continue; }
    await typeIn(p, g, maybeGarbage(u, rng, String(Math.floor(rnd(rng, 40, 350)))), u, rng);
    if (chance(rng, 0.3)) { const sel = p.locator('#m-meal'); if (await sel.count()) { const opts = await sel.locator('option').count(); await sel.selectOption({ index: Math.floor(rng() * opts) }).catch(() => {}); } }
    if (chance(rng, u.reload * 0.3)) { S.note('reload-in-modal'); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900); continue; }
    await tap(p, '#m-add'); if (chance(rng, u.dup)) await tap(p, '#m-add').catch(() => {}); await p.waitForTimeout(500); added++;
    if (await p.locator('#m-grams').count()) { S.note('modal-still-open'); const c2 = p.locator('#m-cancel, [data-m-close], .modal__close'); if (await c2.count()) await tap(p, c2.first()).catch(() => {}); else await p.keyboard.press('Escape'); }
  }
  if (chance(rng, 0.55)) { S.dialog = 'accept'; const cl = p.locator('#d-close'); if (await cl.count()) { await tap(p, cl); if (chance(rng, u.dup)) await tap(p, cl).catch(() => {}); await p.waitForTimeout(800); S.note('closed-day'); } }
  const pr = await localProfile(p);
  S.note('added=' + added + ' dayItems=' + (pr && pr.day ? JSON.stringify(pr.day).length : 0) + ' mealLog=' + (pr && pr.mealLog ? Object.keys(pr.mealLog).length : 0));
};

A.measure = async (p, u, rng, S) => {
  await go(p, 'measure.html', 1000);
  await tap(p, '#ms-new'); await p.waitForTimeout(500);
  const w = (u.w + rnd(rng, -2, 2)).toFixed(1).replace('.', ',');
  await typeIn(p, '#ms-weight', maybeGarbage(u, rng, w), u, rng);
  const extra = p.locator('#ms-waist, #ms-chest, #ms-hips'); const c = await extra.count();
  if (c && chance(rng, 0.5)) await typeIn(p, extra.first(), maybeGarbage(u, rng, String(Math.floor(rnd(rng, 70, 100)))), u, rng);
  if (chance(rng, u.err * 0.5)) { await typeIn(p, '#ms-date', pick(rng, ['2026-13-40', '', '2020-01-01', '2030-01-01']), u, rng); S.note('bad-date'); }
  if (chance(rng, 0.1)) { await tap(p, '#ms-cancel'); S.note('cancelled'); return; }
  await tap(p, '#ms-save'); if (chance(rng, u.dup)) await tap(p, '#ms-save').catch(() => {});
  await p.waitForTimeout(700);
  const pr = await localProfile(p);
  S.note('w=' + w + ' bodyLog=' + (pr && pr.bodyLog ? Object.keys(pr.bodyLog).length : 0));
};

A.nutrition = async (p, u, rng, S) => {
  await go(p, 'nutrition.html', 1000);
  await typeIn(p, '#n-weight', maybeGarbage(u, rng, (u.w + rnd(rng, -1, 1)).toFixed(1).replace('.', ',')), u, rng);
  if (chance(rng, 0.4)) await tapRadio(p, p.locator('input[name="goal"]').nth(Math.floor(rng() * 3))).catch(() => {});
  const save = p.locator('button', { hasText: 'Зберегти мої дані' }).first(); if (await save.count()) { await tap(p, save); if (chance(rng, u.dup)) await tap(p, save).catch(() => {}); }
  await p.waitForTimeout(600); S.note('saved');
};

A.planTweak = async (p, u, rng, S) => {
  await go(p, 'plan.html', 1200);
  const which = pick(rng, ['+2,5 кг', '−2,5 кг', 'Знизити ваги', 'Редагувати', 'Скопіювати план', 'deload']);
  if (which === 'deload') { const s = p.locator('#deload-pct'); if (await s.count()) { const o = await s.locator('option').count(); await s.selectOption({ index: Math.floor(rng() * o) }).catch(() => {}); } }
  else { const b = p.locator('button', { hasText: which }).first(); if (await b.count()) { S.dialog = chance(rng, 0.7) ? 'accept' : 'dismiss'; await tap(p, b); if (chance(rng, u.dup)) await tap(p, b).catch(() => {}); } }
  await p.waitForTimeout(600);
  if (which === 'Редагувати' && chance(rng, 0.6)) { const inp = p.locator('#plan input[type="text"]'); const c = await inp.count(); if (c) await typeIn(p, inp.nth(Math.floor(rng() * c)), maybeGarbage(u, rng, String(Math.floor(rnd(rng, 2, 5)))), u, rng); await p.waitForTimeout(400); }
  const pr = await localProfile(p);
  S.note(which + ' weights=' + (pr && pr.weights ? Object.keys(pr.weights).length : 0) + ' weightLog=' + (pr && pr.weightLog ? Object.keys(pr.weightLog).length : 0));
};

A.switchPlan = async (p, u, rng, S) => {
  await go(p, 'programs.html', 1100);
  const days = pick(rng, ['3', '4', '5', '6']);
  await tapRadio(p, p.locator('input[name="days"][value="' + days + '"]').first()); await p.waitForTimeout(500);
  const picks = p.locator('#program-list [data-pick]'); const n = await picks.count(); if (!n) { S.note('no-programs'); return; }
  await tap(p, picks.nth(Math.floor(rng() * n))); await p.waitForTimeout(700);
  const ch = p.locator('button', { hasText: 'Обрати цей план' }).first();
  if (await ch.count()) { S.dialog = 'accept'; await tap(p, ch); await p.waitForTimeout(1000); S.note('switched days=' + days + ' now=' + p.url().split('/').pop()); } else S.note('same-plan');
};

A.dropPlan = async (p, u, rng, S) => { await go(p, 'plan.html', 1100); S.dialog = 'accept'; const b = p.locator('#drop-plan'); if (await b.count()) { await tap(p, b); await p.waitForTimeout(1500); S.note('dropped now=' + p.url().split('/').pop()); } };

A.periodization = async (p, u, rng, S) => {
  await go(p, 'periodization.html', 1000);
  const st = p.locator('#pd-start'); if (await st.count()) await typeIn(p, st, maybeGarbage(u, rng, String(Math.floor(rnd(rng, 60, 80)))), u, rng);
  const en = p.locator('#pd-end'); if (await en.count()) await typeIn(p, en, maybeGarbage(u, rng, String(Math.floor(rnd(rng, 80, 95)))), u, rng);
  const b = p.locator('button', { hasText: 'Запустити цикл' }).first(); if (await b.count()) { S.dialog = 'accept'; await tap(p, b); await p.waitForTimeout(700); }
  S.note((await p.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 80));
};

A.calculator = async (p, u, rng, S) => {
  await go(p, 'calculator.html', 900);
  await typeIn(p, '#orm-weight', maybeGarbage(u, rng, fmtKg(rnd(rng, u.weightRange[0], u.weightRange[1]))), u, rng);
  await typeIn(p, '#orm-reps', maybeGarbage(u, rng, String(Math.floor(rnd(rng, 1, 12)))), u, rng);
  const b = p.locator('button', { hasText: 'Зберегти як рекорд' }).first(); if (await b.count()) { await tap(p, b); if (chance(rng, u.dup)) await tap(p, b).catch(() => {}); }
  await p.waitForTimeout(500); S.note((await p.locator('#orm-result, main').first().innerText()).replace(/\s+/g, ' ').slice(0, 80));
};

A.cardio = async (p, u, rng, S) => { await go(p, 'cardio.html', 900); await typeIn(p, '#c-rest', maybeGarbage(u, rng, String(Math.floor(rnd(rng, 50, 75)))), u, rng); const b = p.locator('button', { hasText: 'Зберегти мої дані' }).first(); if (await b.count()) await tap(p, b); await p.waitForTimeout(400); S.note('ok'); };

A.trackerSettings = async (p, u, rng, S) => {
  await go(p, 'trackers.html', 1000);
  const what = pick(rng, ['toggle', 'habit', 'supplement', 'dose', 'delete']);
  if (what === 'toggle') { const t = p.locator('#tr-builtins [data-toggle]'); const c = await t.count(); if (c) await tap(p, t.nth(Math.floor(rng() * c)).locator('xpath=..')); }
  if (what === 'habit') { const nm = chance(rng, u.err) ? pick(rng, ['', ' ', 'x'.repeat(200), '<b>звичка</b>', '💤 сон до 23', '"quote"', 'Лягати до 23:00']) : pick(rng, ['Лягати до 23:00', 'Розтяжка', '10к кроків', 'Без цукру', 'Читати']); await p.fill('#add-habit', nm); await tap(p, '[data-add-custom="habit"]'); if (chance(rng, u.dup)) await tap(p, '[data-add-custom="habit"]').catch(() => {}); S.note('habit:' + nm.slice(0, 20)); }
  if (what === 'supplement') { await p.fill('#add-supplement', pick(rng, ['Омега-3', 'Вітамін D', 'Магній', 'Протеїн'])); await p.fill('#add-supplement-dose', maybeGarbage(u, rng, pick(rng, ['2', '', '25', '1,5']))); await tap(p, '[data-add-custom="supplement"]'); }
  if (what === 'dose') { const d = p.locator('[data-dose-set]'); if (await d.count()) await typeIn(p, d.first(), maybeGarbage(u, rng, pick(rng, ['5', '3', '10'])), u, rng); }
  if (what === 'delete') { S.dialog = 'accept'; const d = p.locator('[data-custom-del]'); const c = await d.count(); if (c) await tap(p, d.nth(Math.floor(rng() * c))); }
  await p.waitForTimeout(600);
  const pr = await localProfile(p);
  S.note(what + ' trackers=' + (pr && pr.trackers ? Object.keys(pr.trackers).length : 0));
};

A.account = async (p, u, rng, S) => {
  await go(p, 'account.html', 1000);
  const what = pick(rng, ['theme', 'scheme', 'profile', 'export', 'theme']);
  if (what === 'theme') { const b = p.locator('main button', { hasText: pick(rng, ['Монохром', 'Дерево', 'Мох', 'Океан', 'Рожевий']) }).first(); if (await b.count()) await tap(p, b); }
  if (what === 'scheme') { const s = p.locator('#p-scheme'); if (await s.count()) await tap(p, s.locator('xpath=..')); }
  if (what === 'profile') { await typeIn(p, '#p-weight', maybeGarbage(u, rng, (u.w + rnd(rng, -1, 1)).toFixed(1)), u, rng); }
  if (what === 'export') { const b = p.locator('main button', { hasText: 'Експортувати JSON' }).first(); if (await b.count()) await tap(p, b); }
  await p.waitForTimeout(500); S.note(what);
};

A.logoutLogin = async (p, u, rng, S) => {
  await go(p, 'account.html', 1000);
  const so = p.locator('#a-signout'); if (!(await so.count())) { S.note('not-signed-in?'); }
  else { await tap(p, so); await p.waitForTimeout(800); }
  const before = await localProfile(p);
  const em = p.locator('#a-email'); if (!(await em.count())) { S.note('no-login-form url=' + p.url().split('/').pop()); return; }
  await typeIn(p, em, 'u' + u.id + '@sim.local', u, rng); await typeIn(p, '#a-pass', 'Passw0rd!Passw0rd', u, rng);
  const rem = p.locator('#a-remember'); if (await rem.count() && chance(rng, 0.2)) { await rem.evaluate(e => { e.checked = false; }); S.note('remember=off'); }
  S.dialog = chance(rng, 0.7) ? 'accept' : 'dismiss';
  await tap(p, '#a-form button[type=submit]'); await p.waitForTimeout(1500);
  const after = await localProfile(p);
  S.note('merge-dialog=' + S.dialog + ' beforeKeys=' + (before ? Object.keys(before).length : 0) + ' afterKeys=' + (after ? Object.keys(after).length : 0) + ' sessions:' + (before && before.sessionLog ? Object.keys(before.sessionLog).length : 0) + '->' + (after && after.sessionLog ? Object.keys(after.sessionLog).length : 0) + ' url=' + p.url().split('/').pop());
};

A.rapidNav = async (p, u, rng, S) => {
  const pages = ['index.html', 'workout.html', 'journal.html', 'trackers.html', 'meals.html', 'plan.html', 'rating.html', 'measure.html'];
  const n = Math.floor(rnd(rng, 4, 9));
  for (let i = 0; i < n; i++) { p.goto('file://' + ROOT + '/' + pick(rng, pages)).catch(() => {}); await p.waitForTimeout(Math.floor(rnd(rng, 40, 220))); }
  await p.waitForTimeout(1200); S.note('n=' + n + ' end=' + p.url().split('/').pop());
};

A.backForward = async (p, u, rng, S) => {
  await go(p, 'index.html', 600); await go(p, 'workout.html', 600); await go(p, 'journal.html', 600);
  await p.goBack({ waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(500);
  await p.goBack({ waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(500);
  await p.goForward({ waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(700);
  S.note('end=' + p.url().split('/').pop());
};

A.progressBrowse = async (p, u, rng, S) => {
  await go(p, 'journal.html', 1200);
  const per = p.locator('input[name="adh-period"]'); const c = await per.count(); if (c) await tapRadio(p, per.nth(Math.floor(rng() * c)));
  const ex = p.locator('#ex-pick'); if (await ex.count()) { const o = await ex.locator('option').count(); if (o) await ex.selectOption({ index: Math.floor(rng() * o) }).catch(() => {}); }
  const met = p.locator('input[name="ex-metric"]'); const mc = await met.count(); if (mc) await tapRadio(p, met.nth(Math.floor(rng() * mc)));
  const set = p.locator('input[name="ex-set"]'); const sc = await set.count(); if (sc) await tapRadio(p, set.nth(Math.floor(rng() * sc)));
  const view = p.locator('input[name="jr-view"]'); const vc = await view.count(); if (vc) await tapRadio(p, view.nth(Math.floor(rng() * vc)));
  const nav = p.locator('[data-hnav]'); if (await nav.count() && chance(rng, 0.5)) await tap(p, nav.first());
  await p.waitForTimeout(600);
  S.note((await p.locator('#jr-exercise, #adh-training').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 100));
};

A.viewPage = async (p, u, rng, S) => { const pg = pick(rng, ['rating.html', 'research.html', 'supplements.html', 'boxing.html', 'legal.html', 'cardio.html', 'periodization.html']); await go(p, pg, 800); S.note(pg + ' nodes=' + (await p.evaluate(() => document.querySelectorAll('*').length))); };

A.wipeLocal = async (p, u, rng, S) => { await go(p, 'account.html', 1000); S.dialog = 'accept'; const b = p.locator('main button', { hasText: 'Стерти локальні дані' }).first(); if (!(await b.count())) { S.note('no-btn'); return; } const before = await localProfile(p); await tap(p, b); await p.waitForTimeout(1500); await go(p, 'index.html', 1500); const after = await localProfile(p); S.note('sessions ' + (before && before.sessionLog ? Object.keys(before.sessionLog).length : 0) + ' -> ' + (after && after.sessionLog ? Object.keys(after.sessionLog).length : 0) + ' url=' + p.url().split('/').pop()); };

/* ============================================================ */
/* Day planner                                                   */
/* ============================================================ */
function planDay(u, rng, day, date) {
  const dow = date.getDay();
  const gym = u.gym.indexOf(dow) !== -1;
  const acts = [];
  const sessions = Math.max(1, Math.round(u.sessions * rnd(rng, 0.5, 1.4)));
  acts.push('today');
  if (gym && chance(rng, 0.85)) acts.push('workout');
  if (chance(rng, 0.55)) acts.push('trackers');
  if (chance(rng, u.id === 6 ? 0.8 : 0.35)) acts.push('meals');
  if (dow === 1 && chance(rng, 0.7) || chance(rng, 0.12)) acts.push('weight');
  if (chance(rng, u.id === 6 ? 0.25 : 0.06)) acts.push('measure');
  if (chance(rng, 0.25)) acts.push('progressBrowse');
  if (!gym && chance(rng, 0.15)) acts.push('heatmapMark');
  if (chance(rng, u.explore * 0.25)) acts.push(pick(rng, ['planTweak', 'trackerSettings', 'account', 'calculator', 'cardio', 'nutrition', 'periodization', 'viewPage']));
  if (chance(rng, u.explore * 0.06) && day > 10) acts.push('switchPlan');
  if (u.reload > 0.25 && chance(rng, 0.3)) acts.push('rapidNav');
  if (chance(rng, u.reload * 0.3)) acts.push('backForward');
  if (chance(rng, u.forgetful ? 0.08 : 0.03)) acts.push('logoutLogin');
  if (u.id === 9 && day === 60) acts.push('wipeLocal');
  if (u.id === 9 && day === 75) acts.push('dropPlan');
  if (u.id === 3 && day % 14 === 0) acts.push('planTweak');
  if (u.id === 2 && day === 40) acts.push('dropPlan');
  return { acts: acts.slice(0, 3 + sessions * 3), sessions, gym };
}

/* ============================================================ */
/* Invariants over the persisted profile                        */
/* ============================================================ */
function checkInvariants(pr, todayK, cloudRow) {
  const v = [];
  const D = /^\d{4}-\d{2}-\d{2}$/;
  const scan = (o, path) => { if (typeof o === 'number' && !Number.isFinite(o)) v.push('non-finite@' + path); else if (o && typeof o === 'object') Object.keys(o).forEach(k => scan(o[k], path + '.' + k)); };
  if (!pr) { v.push('profile-missing'); return v; }
  scan(pr, 'profile');
  if (pr.version !== 10) v.push('version=' + pr.version);
  const sl = pr.sessionLog || {};
  Object.keys(sl).forEach(d => {
    if (!D.test(d)) v.push('sessionLog-badkey:' + d); else if (d > todayK) v.push('sessionLog-future:' + d);
    const s = sl[d] || {};
    if (Number(s.doneSets) > Number(s.totalSets)) v.push('doneSets>totalSets@' + d);
    if (Number(s.done) > Number(s.total)) v.push('done>total@' + d);
    (s.ex || []).forEach((e, i) => { if (e.ds > e.ps) v.push('ds>ps@' + d + '#' + i); if (Array.isArray(e.s) && e.s.length > e.ds) v.push('s>ds@' + d + '#' + i); (e.s || []).forEach(x => { if (x.w != null && (x.w < 0 || x.w > 500)) v.push('set-w-range@' + d); }); });
  });
  const wl = pr.weightLog || {};
  Object.keys(wl).forEach(n => (wl[n] || []).forEach(e => { if (!D.test(e.d)) v.push('weightLog-baddate:' + n); if (!(e.kg >= 0 && e.kg <= 500)) v.push('weightLog-range:' + n + '=' + e.kg); }));
  const bl = pr.bodyLog || {};
  Object.keys(bl).forEach(d => { if (!D.test(d)) v.push('bodyLog-badkey:' + d); const w = Number(bl[d] && (bl[d].weight != null ? bl[d].weight : bl[d])); if (Number.isFinite(w) && (w < 30 || w > 300)) v.push('bodyLog-range@' + d + '=' + w); if (d > todayK) v.push('bodyLog-future:' + d); });
  const tl = pr.trackerLog || {};
  const lim = { water: [0, 15], sleep: [0, 960], mood: [1, 10], recovery: [1, 10], steps: [0, 100000], caffeine: [0, 2000], creatine: [0.1, 500] };
  Object.keys(tl).forEach(id => Object.keys(tl[id] || {}).forEach(d => { if (!D.test(d)) v.push('trackerLog-badkey:' + id + '/' + d); if (d > todayK) v.push('trackerLog-future:' + id + '/' + d); let x = tl[id][d]; if (x && typeof x === 'object' && 'value' in x) x = x.value; if (typeof x === 'number' && lim[id] && (x < lim[id][0] || x > lim[id][1])) v.push('trackerLog-range:' + id + '@' + d + '=' + x); }));
  const wb = pr.weights || {};
  Object.keys(wb).forEach(n => { const k = Number(wb[n]); if (!(Number.isFinite(k) && k >= 0 && k <= 500)) v.push('weights-range:' + n + '=' + wb[n]); });
  const ml = pr.mealLog || {};
  Object.keys(ml).forEach(d => { if (!D.test(d)) v.push('mealLog-badkey'); const r = ml[d] || {}; if (!(Number(r.kcal) >= 0 && Number(r.kcal) < 20000)) v.push('mealLog-kcal@' + d + '=' + r.kcal); if (d > todayK) v.push('mealLog-future:' + d); });
  if (pr.activePlan && !pr.activePlan.programId) v.push('activePlan-no-programId');
  if (cloudRow && cloudRow.data) {
    const a = JSON.stringify(Object.assign({}, pr, { updatedAt: 0 })); const b = JSON.stringify(Object.assign({}, cloudRow.data, { updatedAt: 0 }));
    if (a !== b) v.push('DRIFT:local!=cloud (local ' + a.length + 'B, cloud ' + b.length + 'B, sessions ' + Object.keys(sl).length + ' vs ' + Object.keys(cloudRow.data.sessionLog || {}).length + ')');
  }
  return v;
}

async function checkpoint(p, u, day, todayK, state) {
  const cp = { u: u.id, day, date: todayK };
  const t0 = ms();
  cp.pages = {};
  for (const pg of ['index.html', 'workout.html', 'journal.html', 'trackers.html', 'meals.html']) {
    const a = ms();
    try {
      await p.goto('file://' + ROOT + '/' + pg, { waitUntil: 'load' }); await p.waitForTimeout(1300);
      cp.pages[pg] = await p.evaluate(() => { const nav = performance.getEntriesByType('navigation')[0]; return { nodes: document.querySelectorAll('*').length, lsn: window.__lsn, domComplete: nav ? Math.round(nav.domComplete) : null, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null, landed: location.pathname.split('/').pop() }; });
    } catch (e) { cp.pages[pg] = { error: String(e.message).slice(0, 120), landed: p.url().split('/').pop() }; }
    cp.pages[pg].wall = ms() - a;
  }
  try { await p.goto('file://' + ROOT + '/legal.html', { waitUntil: 'load' }); await p.evaluate(async () => { try { await window.Store.flushPending(); } catch (_) {} }); } catch (_) {}
  await p.waitForTimeout(600);
  const pr = await localProfile(p).catch(() => null);
  cp.ls = await lsBytes(p).catch(() => ({ total: -1, per: {} }));
  cp.profileBytes = pr ? JSON.stringify(pr).length : 0;
  cp.counts = pr ? { sessionLog: Object.keys(pr.sessionLog || {}).length, bodyLog: Object.keys(pr.bodyLog || {}).length, mealLog: Object.keys(pr.mealLog || {}).length, weightLog: Object.keys(pr.weightLog || {}).length, trackerLog: Object.keys(pr.trackerLog || {}).reduce((a, k) => a + Object.keys(pr.trackerLog[k] || {}).length, 0), workLog: Object.keys(pr.workLog || {}).length, recipes: (pr.recipes || []).length, trackers: Object.keys(pr.trackers || {}).length } : null;
  cp.pending = await p.evaluate(() => { try { return window.Store.pendingCount(); } catch (_) { return null; } }).catch(() => null);
  cp.invariants = checkInvariants(pr, todayK, state.cloud.row);
  cp.cloud = { writes: state.cloud.writes, reads: state.cloud.reads, failed: state.cloud.failed, rpc: state.cloud.rpc };
  cp.ms = ms() - t0;
  writeFileSync(OUT + '/cp/u' + u.id + '-d' + String(day).padStart(2, '0') + '.json', JSON.stringify(cp, null, 1));
  if (pr) writeFileSync(OUT + '/profiles/u' + u.id + '-d' + String(day).padStart(2, '0') + '.json', JSON.stringify(pr));
  return cp;
}

/* ============================================================ */
/* Main loop                                                     */
/* ============================================================ */
async function runUser(u, from, to) {
  const state = { cloud: null, flaky: u.netFlaky > 0, flakyP: u.netFlaky, rng: null };
  let ctx = await openUser(u, state);
  let p = await ctx.newPage(); p.setDefaultTimeout(6000);
  const errBag = { page: [], console: [], net: [], dialogs: [] };
  const wire = (pg) => {
    pg.on('pageerror', e => errBag.page.push(e.message.slice(0, 200)));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errBag.console.push(m.text().slice(0, 200)); });
    pg.on('requestfailed', r => { if (!/fonts|google|gstatic/.test(r.url())) errBag.net.push(r.url().replace(/^.*\/(rest|auth)/, '$1').slice(0, 80) + ' ' + (r.failure() || {}).errorText); });
    pg.on('dialog', async d => { errBag.dialogs.push(d.type() + ':' + d.message().slice(0, 60)); const mode = state.dialog || 'accept'; try { if (mode === 'dismiss') await d.dismiss(); else await d.accept(); } catch (_) {} });
  };
  wire(p);
  const CPS = new Set([1, 7, 14, 30, 45, 60, 75, 90]);
  let skipStreak = 0;
  for (let day = from; day <= to; day++) {
    const date = dayDate(day); const todayK = key(date);
    const rng = mkRng(u, day); state.rng = rng;
    const hour = Math.floor(rnd(rng, 7, 22));
    await ctx.clock.setSystemTime(new Date(todayK + 'T' + String(hour).padStart(2, '0') + ':' + String(Math.floor(rnd(rng, 0, 59))).padStart(2, '0') + ':00'));
    /* attendance */
    let active = chance(rng, u.active);
    if (u.forgetful && skipStreak === 0 && chance(rng, 0.08)) { skipStreak = Math.floor(rnd(rng, 3, 10)); }
    if (skipStreak > 0) { skipStreak--; active = false; }
    if (day === 1) active = true;
    if (!active) {
      logLine(u, { u: u.id, day, date: todayK, seed: rng.seed, active: false });
      /* forensic checkpoint days are measured even when the person stays away */
      if (CPS.has(day)) { const cp = await checkpoint(p, u, day, todayK, state); logLine(u, { u: u.id, day, date: todayK, checkpoint: true, idle: true, counts: cp.counts, profileBytes: cp.profileBytes, ls: cp.ls.total, invariants: cp.invariants, pending: cp.pending, pages: Object.fromEntries(Object.entries(cp.pages).map(([k, v]) => [k, v.wall + 'ms/' + v.nodes + 'n/' + v.lsn + 'l'])) }); saveCloud(u, state.cloud); }
      continue;
    }

    /* forgetful users close the browser between days */
    if (u.forgetful && day > 1 && chance(rng, 0.5)) { await ctx.close(); ctx = await openUser(u, state); p = await ctx.newPage(); p.setDefaultTimeout(6000); wire(p); await ctx.clock.setSystemTime(new Date(todayK + 'T' + String(hour).padStart(2, '0') + ':00:00')); }

    const plan = day === 1 ? { acts: ['onboard', 'today', 'workout', 'trackers'], sessions: 1, gym: true } : planDay(u, rng, day, date);
    logLine(u, { u: u.id, day, date: todayK, seed: rng.seed, active: true, plan: plan.acts, gym: plan.gym });
    for (const name of plan.acts) {
      const S = { notes: [], note(s) { this.notes.push(String(s)); }, dialog: null };
      state.dialog = null;
      errBag.page.length = 0; errBag.console.length = 0; errBag.net.length = 0; errBag.dialogs.length = 0;
      const t0 = ms(); let ok = true, err = null;
      try { await A[name](p, u, rng, S); } catch (e) { ok = false; err = String(e.message || e).split('\n').filter(l => /^[A-Za-z]|waiting for|locator\(/.test(l)).slice(0, 3).join(' | ').slice(0, 300); }
      state.dialog = S.dialog || null;
      const rec = { u: u.id, day, date: todayK, act: name, ok, ms: ms() - t0, note: S.notes.join(' | '), err, pageErr: errBag.page.slice(), consoleErr: errBag.console.slice(), netErr: errBag.net.slice(), dialogs: errBag.dialogs.slice(), rngN: rng.n || null };
      logLine(u, rec);
      if (!ok && /Target closed|crashed|browser has been closed/.test(err)) { ctx = await openUser(u, state); p = await ctx.newPage(); p.setDefaultTimeout(6000); wire(p); await ctx.clock.setSystemTime(new Date(todayK + 'T12:00:00')); }
    }
    /* end of day: let debounced saves settle */
    await p.waitForTimeout(1800);
    if (CPS.has(day)) {
      const cp = await checkpoint(p, u, day, todayK, state);
      logLine(u, { u: u.id, day, date: todayK, checkpoint: true, counts: cp.counts, profileBytes: cp.profileBytes, ls: cp.ls.total, invariants: cp.invariants, pending: cp.pending, pages: Object.fromEntries(Object.entries(cp.pages).map(([k, v]) => [k, v.wall + 'ms/' + v.nodes + 'n/' + v.lsn + 'l'])) });
    }
    saveCloud(u, state.cloud);
    process.stdout.write('u' + u.id + ' d' + day + ' ' + plan.acts.length + 'a\n');
  }
  await ctx.close();
}

const arg = process.argv[2] || 'all';
const from = Number(process.argv[3] || 1), to = Number(process.argv[4] || 90);
const list = arg === 'all' ? USERS : USERS.filter(u => String(u.id) === arg);
for (const u of list) { await runUser(u, from, to); }
console.log('done');
