/*
 * Відновлення пароля й перехід із листа.
 *
 * ГОЛОВНЕ, ЩО ТУТ СТЕРЕЖЕТЬСЯ, — що з листа є ВИХІД у будь-якому разі.
 * Лист приходить, посилання робоче, а людина все одно не міняє пароля —
 * саме так виглядав живий випадок «відновити пароль неможливо». Причина
 * була не в пошті й не в Supabase: посилання з листа відкривається у
 * вбудованому браузері застосунку пошти, тобто НЕ в тому браузері, з
 * якого його замовляли, — а на цей випадок сайт ставив системний
 * window.confirm і при відмові лишав порожній екран із одним рядком
 * тексту. Токен уже витрачено, кнопок немає, іти нікуди.
 */
import { chromium } from 'playwright';
import { CHROME } from './pw.mjs';
const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };
const b = await chromium.launch({ executablePath: CHROME });

async function ctxWith(wire) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await ctx.route(/\/rest\/v1\/rpc\//, r => r.fulfill({ status:200, contentType:'application/json', body:'{}' }));
  await ctx.route(/\/rest\/v1\/profiles/, r => r.request().method()==='GET'
    ? r.fulfill({ status:200, contentType:'application/json', body:'[]' })
    : r.fulfill({ status:403, contentType:'application/json', body:'{"code":"42501"}' }));
  await wire(ctx);
  return ctx;
}
const title = p => p.locator('#gate-card h1').innerText().then(t => t.trim());

/* ---- 1. Забули пароль → лист ---- */
{
  let recoverBody = null;
  const ctx = await ctxWith(async c => {
    await c.route(/\/auth\/v1\/recover/, r => {
      recoverBody = JSON.parse(r.request().postData() || '{}');
      r.fulfill({ status:200, contentType:'application/json', body:'{}' });
    });
  });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/welcome.html', { waitUntil:'load' }); await p.waitForTimeout(700);
  await p.locator('[data-nav="login"]').first().click(); await p.waitForTimeout(400);
  ok('1. на екрані входу є «Забули пароль?»', await p.locator('[data-nav="forgot"]').count() === 1);
  await p.locator('[data-nav="forgot"]').click(); await p.waitForTimeout(400);
  ok('2. відкрився екран відновлення', /Відновлення пароля/.test(await title(p)), await title(p));
  await p.locator('#au-email').fill('friend@example.com');
  await p.locator('#au-forgot-go').click(); await p.waitForTimeout(900);
  ok('3. лист замовлено на вказану пошту', recoverBody && recoverBody.email === 'friend@example.com',
     JSON.stringify(recoverBody));
  ok('4. відповідь не викриває, чи є така пошта',
     /Якщо акаунт/.test(await p.locator('#gate-card').innerText()));
  ok('5. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2. Перехід із листа відновлення ---- */
{
  let putBody = null;
  const ctx = await ctxWith(async c => {
    await c.route(/\/auth\/v1\/user/, r => {
      if (r.request().method() === 'PUT') {
        putBody = JSON.parse(r.request().postData() || '{}');
        return r.fulfill({ status:200, contentType:'application/json',
          body: JSON.stringify({ id:'u-1', email:'friend@example.com' }) });
      }
      r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify({ id:'u-1', email:'friend@example.com' }) });
    });
  });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/welcome.html#access_token=AT&refresh_token=RT&expires_in=3600&type=recovery',
    { waitUntil:'load' });
  await p.waitForTimeout(1400);

  /* Лист відкрито в іншому браузері (позначки «ми замовляли» тут немає) —
     питаємо СВОЇМ екраном, а не системним діалогом, і показуємо пошту. */
  ok('6а. питання про чуже посилання — екраном сайту', /Це ваше посилання/.test(await title(p)), await title(p));
  ok('6б. видно, у чий акаунт іде вхід',
     /friend@example\.com/.test(await p.locator('#gate-card').innerText()));
  await p.locator('#au-link-yes').click();
  await p.waitForTimeout(900);
  ok('6. з листа відновлення — екран нового пароля', /Новий пароль/.test(await title(p)), await title(p));
  ok('7. токен прибрано з адреси', !/access_token/.test(p.url()), p.url().split('/').pop());
  await p.locator('#au-pass').fill('Nadijnyj1!');
  await p.locator('#au-pass2').fill('Nadijnyj1!');
  await p.waitForTimeout(300);
  await p.locator('#au-newpass-go').click(); await p.waitForTimeout(1400);
  ok('8. новий пароль надіслано на сервер', putBody && putBody.password === 'Nadijnyj1!', JSON.stringify(putBody));
  ok('9. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2б. «Ні, не входити» — і це не глухий кут ---- */
{
  const ctx = await ctxWith(async c => {
    await c.route(/\/auth\/v1\/user/, r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'u-1', email:'stranger@example.com' }) }));
  });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/welcome.html#access_token=AT&refresh_token=RT&expires_in=3600&type=recovery',
    { waitUntil:'load' });
  await p.waitForTimeout(1400);
  await p.locator('#au-link-no').click();
  await p.waitForTimeout(700);
  const txt = () => p.locator('#gate-card').innerText();
  ok('9а. відмова веде на екран із виходом, а не в порожнечу',
     /Посилання не спрацювало/.test(await title(p)), await title(p));
  ok('9б. є кнопка замовити новий лист',
     (await p.locator('[data-nav="forgot"]').count()) >= 1, await txt());
  await p.locator('[data-nav="forgot"]').first().click();
  await p.waitForTimeout(600);
  ok('9в. кнопка справді відкриває відновлення', /Відновлення пароля/.test(await title(p)), await title(p));
  ok('9г. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 2в. Той самий браузер: жодних питань ---- */
{
  const ctx = await ctxWith(async c => {
    await c.route(/\/auth\/v1\/user/, r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'u-1', email:'friend@example.com' }) }));
  });
  /* Позначку кладемо ДО завантаження сторінки: якщо спершу відкрити
     welcome.html без фрагмента, а потім із ним, Chromium вважає це
     переходом усередині тієї самої сторінки — код просто не виконається
     вдруге, і перевірка міряла б порожнечу. */
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ib.auth.await',
        JSON.stringify({ email: 'friend@example.com', at: Date.now() }));
    } catch (_) {}
  });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/welcome.html#access_token=AT&refresh_token=RT&expires_in=3600&type=recovery',
    { waitUntil:'load' });
  await p.waitForTimeout(1400);
  ok('9д. свій браузер — одразу новий пароль, без зайвого питання',
     /Новий пароль/.test(await title(p)), await title(p));
  ok('9е. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 3. Перехід із листа підтвердження: людина вже ввійдена ---- */
{
  const ctx = await ctxWith(async c => {
    await c.route(/\/auth\/v1\/user/, r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'u-2', email:'friend@example.com' }) }));
  });
  /* Лист замовляли з цього ж браузера — зайвих питань бути не має. */
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ib.auth.await',
        JSON.stringify({ email: 'friend@example.com', at: Date.now() }));
    } catch (_) {}
  });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/welcome.html#access_token=AT&refresh_token=RT&expires_in=3600&type=signup',
    { waitUntil:'load' });
  await p.waitForTimeout(1500);
  const t = await title(p);
  ok('10. після листа підтвердження НЕ просить пароль знову',
     !/Підтвердіть пошту|Вхід/.test(t), t);
  ok('11. одразу веде далі по реєстрації', /нік|дату народження|Розкажіть/i.test(t), t);
  ok('12. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 4. Протухле посилання ---- */
{
  const ctx = await ctxWith(async c => {
    await c.route(/\/auth\/v1\/user/, r => r.fulfill({ status:401, contentType:'application/json',
      body: JSON.stringify({ error_code:'bad_jwt', msg:'invalid claim' }) }));
  });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/welcome.html#access_token=OLD&type=recovery', { waitUntil:'load' });
  await p.waitForTimeout(1400);
  ok('13. протухле посилання не вішає сторінку', (await p.locator('#gate-card').count()) === 1);
  ok('14. сказано, що посилання застаріле',
     /вже використане або застаріле/.test(await p.locator('#gate-card').innerText()),
     (await p.locator('#gate-card').innerText()).split('\n').filter(Boolean).slice(-2).join(' / '));
  ok('14б. і тут є кнопка замовити новий лист',
     (await p.locator('[data-nav="forgot"]').count()) >= 1, await title(p));
  ok('15. токен усе одно прибрано з адреси', !/access_token/.test(p.url()));
  ok('16. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 5. Лист привів не на ту сторінку: фрагмент має доїхати ----
   Site URL у проєкті може вказувати на корінь сайту, а токени приймає
   лише welcome.js. Сторож (js/agegate.js) відсилає таку людину на
   welcome.html — і до цієї правки губив фрагмент разом із токеном:
   підтвердження витрачалось, а людина приходила не ввійденою. */
{
  const ctx = await ctxWith(async c => {
    await c.route(/\/auth\/v1\/user/, r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ id:'u-1', email:'friend@example.com' }) }));
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ib.auth.await',
        JSON.stringify({ email: 'friend@example.com', at: Date.now() }));
    } catch (_) {}
  });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file://'+ROOT+'/today.html#access_token=AT&refresh_token=RT&expires_in=3600&type=recovery',
               { waitUntil:'load' });
  await p.waitForTimeout(1400);
  ok('17. сторож привів на welcome.html', /welcome\.html/.test(p.url()), p.url());
  ok('18. фрагмент доїхав: показано зміну пароля',
     /Новий пароль/.test(await p.locator('#gate-card').innerText()),
     (await p.locator('#gate-card').innerText()).split('\n').filter(Boolean)[0]);
  ok('19. токен не лишився в адресі', !/access_token/.test(p.url()), p.url());
  ok('20. без JS-помилок', errs.length===0, errs.join(' | '));
  await ctx.close();
}

/* ---- 6. Звичайний якір сторож не тягне за собою ---- */
{
  const ctx = await ctxWith(async () => {});
  const p = await ctx.newPage();
  await p.goto('file://'+ROOT+'/today.html#nutrition', { waitUntil:'load' });
  await p.waitForTimeout(900);
  ok('21. чужий фрагмент не переноситься', !/#nutrition/.test(p.url()), p.url());
  await ctx.close();
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок відновлення пройшло.');
process.exit(bad ? 1 : 0);
