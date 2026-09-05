/* Три збої, які видно в логах реального проєкту:
   A. 429 email rate limit — вбудована пошта Supabase вичерпана;
   B. повторна реєстрація на вже зайняту пошту (200 з порожнім identities);
   C. «Я підтвердив» із НЕ тим паролем → invalid_credentials. */
import { chromium } from 'playwright';
import { CHROME } from './pw.mjs';
const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

async function scenario(name, wire) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await ctx.route(/\/rest\/v1\/rpc\//, r => r.fulfill({ status:200, contentType:'application/json', body:'{}' }));
  await ctx.route(/\/rest\/v1\/profiles/, r => r.request().method() === 'GET'
    ? r.fulfill({ status:200, contentType:'application/json', body:'[]' })
    : r.fulfill({ status:403, contentType:'application/json', body:'{"code":"42501","message":"RLS"}' }));
  await wire(ctx);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil:'load' });
  await p.waitForTimeout(700);
  await p.locator('[data-nav="reg"]').click(); await p.waitForTimeout(400);
  await p.locator('#au-name').fill('Друг');
  await p.locator('#au-email').fill('friend@example.com');
  await p.locator('#au-pass').fill('DobrePass1!');
  if (await p.locator('#au-pass2').count()) await p.locator('#au-pass2').fill('DobrePass1!');
  await p.waitForTimeout(300);
  await p.locator('#au-reg').click();
  await p.waitForTimeout(1200);
  return { p, ctx, errs, title: async () => (await p.locator('#gate-card h1').innerText()).trim(),
           text: async () => (await p.locator('#gate-card').innerText()) };
}

/* ---- A. Ліміт листів ---- */
{
  const s = await scenario('A', async ctx => {
    await ctx.route(/\/auth\/v1\/signup/, r => r.fulfill({ status:429, contentType:'application/json',
      body: JSON.stringify({ error_code:'over_email_send_rate_limit', msg:'email rate limit exceeded' }) }));
  });
  const t = await s.text();
  ok('A1. ліміт листів пояснено українською, без англійського коду',
     /Забагато листів/.test(t) && !/rate limit/i.test(t),
     t.split('\n').filter(x => /Забагато|rate/.test(x)).join(' / '));
  ok('A2. підказано, що робити далі', /за годину|увійдіть/i.test(t));
  ok('A3. без JS-помилок', s.errs.length === 0, s.errs.join(' | '));
  await s.ctx.close();
}

/* ---- B. Пошта вже зареєстрована ---- */
{
  const s = await scenario('B', async ctx => {
    await ctx.route(/\/auth\/v1\/signup/, r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'u-x', email:'friend@example.com', identities: [] }) }));
  });
  const title = await s.title();
  ok('B1. НЕ тягне на «Підтвердіть пошту» (тупик)', !/Підтвердіть пошту/.test(title), title);
  ok('B2. веде на екран входу', /Вхід/.test(title), title);
  ok('B3. каже, що пошта вже зареєстрована', /вже зареєстрована/.test(await s.text()));
  ok('B4. без JS-помилок', s.errs.length === 0, s.errs.join(' | '));
  await s.ctx.close();
}

/* ---- C. «Я підтвердив» з іншим паролем ---- */
{
  const s = await scenario('C', async ctx => {
    await ctx.route(/\/auth\/v1\/signup/, r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'u-y', email:'friend@example.com', identities:[{ id:'i1' }] }) }));
    await ctx.route(/\/auth\/v1\/token/, r => r.fulfill({ status:400, contentType:'application/json',
      body: JSON.stringify({ error_code:'invalid_credentials', msg:'Invalid login credentials' }) }));
  });
  ok('C0. спершу екран підтвердження', /Підтвердіть пошту/.test(await s.title()), await s.title());
  ok('C1. на екрані є кнопка повторного листа', await s.p.locator('#au-resend').count() === 1);
  ok('C2. є вихід «уже маю акаунт»', await s.p.locator('[data-nav="login"]').count() >= 1);
  await s.p.locator('#au-confirmed').click();
  await s.p.waitForTimeout(1200);
  const t = await s.text();
  ok('C3. пояснено, що пароль інший, і виведено на вхід',
     /з іншим паролем/.test(t) && /Вхід/.test(await s.title()), await s.title());
  ok('C4. без JS-помилок', s.errs.length === 0, s.errs.join(' | '));
  await s.ctx.close();
}

/* ---- D. Пошта не підтверджена — лишаємось на місці з підказкою ---- */
{
  const s = await scenario('D', async ctx => {
    await ctx.route(/\/auth\/v1\/signup/, r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'u-z', email:'friend@example.com', identities:[{ id:'i1' }] }) }));
    await ctx.route(/\/auth\/v1\/token/, r => r.fulfill({ status:400, contentType:'application/json',
      body: JSON.stringify({ error_code:'email_not_confirmed', msg:'Email not confirmed' }) }));
  });
  await s.p.locator('#au-confirmed').click();
  await s.p.waitForTimeout(1000);
  ok('D1. лишились на екрані підтвердження', /Підтвердіть пошту/.test(await s.title()), await s.title());
  ok('D2. сказано, що саме зробити', /натисніть посилання/i.test(await s.text()));
  await s.ctx.close();
}

/* ---- E. Повторний лист: успіх і ліміт ---- */
{
  let hits = 0;
  const s = await scenario('E', async ctx => {
    await ctx.route(/\/auth\/v1\/signup/, r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'u-w', email:'friend@example.com', identities:[{ id:'i1' }] }) }));
    await ctx.route(/\/auth\/v1\/resend/, r => {
      hits++;
      if (hits === 1) return r.fulfill({ status:200, contentType:'application/json', body:'{}' });
      r.fulfill({ status:429, contentType:'application/json',
        body: JSON.stringify({ error_code:'over_email_send_rate_limit', msg:'email rate limit exceeded' }) });
    });
  });
  await s.p.locator('#au-resend').click();
  await s.p.waitForTimeout(900);
  ok('E1. повторний лист відправлено', hits === 1 && /Лист надіслано/.test(await s.p.locator('body').innerText()));
  await s.p.locator('#au-resend').click();
  await s.p.waitForTimeout(900);
  ok('E2. другий раз — ліміт пояснено українською', /Забагато листів/.test(await s.text()));
  ok('E3. без JS-помилок', s.errs.length === 0, s.errs.join(' | '));
  await s.ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок збоїв реєстрації пройшло.');
process.exit(bad ? 1 : 0);
