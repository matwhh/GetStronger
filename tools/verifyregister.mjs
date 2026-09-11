/* Повний шлях реєстрації проти двійника, що відповідає ТАК САМО, як реальний
   Supabase: підтвердження пошти увімкнене, RLS не пускає profiles до
   схвалення, account_state віддає 'none' до заявки. */
import { chromium } from 'playwright';
import { CHROME } from './pw.mjs';
const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const server = {
  confirmed: false,          // пошту ще не підтверджено
  status: 'none',            // заявки ще немає
  registerCalls: [],
  profileWrites: 0
};

const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());

await ctx.route(/\/rest\/v1\/rpc\//, r =>
  r.fulfill({ status:200, contentType:'application/json', body:'{}' }));

await ctx.route(/\/auth\/v1\/signup/, r => {
  // Supabase з увімкненим підтвердженням: 200, АЛЕ без access_token
  r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ id:'u-friend', email:'friend@example.com', confirmation_sent_at:new Date().toISOString() }) });
});
await ctx.route(/\/auth\/v1\/token/, r => {
  if (!server.confirmed) {
    return r.fulfill({ status:400, contentType:'application/json',
      body: JSON.stringify({ error_code:'email_not_confirmed', msg:'Email not confirmed' }) });
  }
  r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({
    access_token:'tok', refresh_token:'ref', expires_in:3600,
    user:{ id:'u-friend', email:'friend@example.com' } }) });
});
await ctx.route(/\/rest\/v1\/rpc\/account_state/, r =>
  r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ status: server.status }) }));
await ctx.route(/\/rest\/v1\/rpc\/username_free/, r =>
  r.fulfill({ status:200, contentType:'application/json', body:'true' }));
await ctx.route(/\/rest\/v1\/rpc\/register_request/, r => {
  const body = JSON.parse(r.request().postData() || '{}');
  server.registerCalls.push(body);
  server.status = 'pending';
  r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ status:'pending' }) });
});
await ctx.route(/\/rest\/v1\/profiles/, r => {
  if (r.request().method() === 'GET')
    return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
  // RLS: до схвалення запис у profiles заборонено — саме так поводиться прод
  server.profileWrites++;
  r.fulfill({ status:403, contentType:'application/json',
    body: JSON.stringify({ code:'42501', message:'new row violates row-level security policy for table "profiles"' }) });
});

const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
p.on('dialog', d => d.accept());

const step = () => p.evaluate(() => {
  const h = document.querySelector('#gate-card');
  return h ? (h.querySelector('h1') || {}).textContent : null;
});

await p.goto('file://' + ROOT + '/welcome.html', { waitUntil:'load' });
await p.waitForTimeout(800);
ok('1. стартовий екран', /Get Stronger/.test(await step()), await step());

await p.locator('[data-nav="reg"]').click();
await p.waitForTimeout(400);
ok('2. екран реєстрації', /Реєстрація|Створити/i.test(await step() || ''), await step());

const ids = await p.evaluate(() => [...document.querySelectorAll('#gate-card input')].map(e => e.id));
console.log('     поля:', ids.join(', '));
await p.locator('#au-name').fill('Друг');
await p.locator('#au-email').fill('friend@example.com');
await p.locator('#au-pass').fill('DobrePass1!');
if (ids.includes('au-pass2')) await p.locator('#au-pass2').fill('DobrePass1!');
await p.waitForTimeout(400);
const regDisabled = await p.locator('#au-reg').isDisabled();
ok('3. кнопка «Продовжити» активна', !regDisabled);

await p.locator('#au-reg').click();
await p.waitForTimeout(1200);
ok('4. після реєстрації — екран підтвердження пошти', /Підтвердіть пошту/.test(await step() || ''), await step());

// Людина тисне «Я підтвердив» ДО того, як реально підтвердила
await p.locator('#au-confirmed').click();
await p.waitForTimeout(1000);
const errText = await p.locator('#gate-card').innerText();
ok('5. до підтвердження — зрозуміле пояснення, а не тупик',
   /не підтверджен/i.test(errText), errText.split('\n').filter(Boolean).slice(-1)[0]);

// Тепер справді підтвердив
server.confirmed = true;
await p.locator('#au-confirmed').click();
await p.waitForTimeout(1500);
ok('6. після підтвердження веде далі (нік/вік), а не лишає на місці',
   !/Підтвердіть пошту/.test(await step() || ''), await step());

// Проходимо решту
for (let i = 0; i < 8; i++) {
  const t = await step() || '';
  if (/Оберіть нік/.test(t)) {
    await p.locator('#au-name').fill('Друг' + Date.now() % 1000);
    await p.locator('#au-name-go').click(); await p.waitForTimeout(900); continue;
  }
  if (/дату народження/.test(t)) {
    await p.locator('#dob-d').fill('15'); await p.locator('#dob-m').fill('06'); await p.locator('#dob-y').fill('1995');
    await p.waitForTimeout(500);
    ok('7. кнопка на екрані дати активна', !(await p.locator('#gate-go').isDisabled()));
    await p.locator('#gate-go').click(); await p.waitForTimeout(900); continue;
  }
  if (/Розкажіть про себе/.test(t)) {
    await p.locator('.seg__item:has(input[value="male"]) span').click();
    await p.locator('#b-height').fill('180');
    await p.locator('#b-weight').fill('78');
    await p.locator('#b-activity').selectOption('1.55');
    await p.locator('#b-trainage').selectOption('inter');
    await p.waitForTimeout(400);
    const cons = await p.locator('#b-consents input[type=checkbox]').count();
    console.log('     згод на екрані:', cons);
    for (let k = 0; k < cons; k++) await p.locator('#b-consents input[type=checkbox]').nth(k).check();
    await p.waitForTimeout(400);
    ok('8. кнопка «Далі» на екрані тіла активна', !(await p.locator('#body-go').isDisabled()));
    await p.locator('#body-go').click(); await p.waitForTimeout(700);
    const bmi = p.locator('#bmi-w-ok'); if (await bmi.count()) { await bmi.click(); await p.waitForTimeout(500); }
    await p.waitForTimeout(1200); continue;
  }
  break;
}

ok('9. register_request викликано', server.registerCalls.length === 1,
   'викликів: ' + server.registerCalls.length);
if (server.registerCalls.length) {
  const c = server.registerCalls[0];
  ok('10. у заявці є нік', !!(c.p_username || '').trim(), JSON.stringify(c.p_username));
  ok('11. у заявці є дата народження', !!c.p_birth, JSON.stringify(c.p_birth));
  ok('12. у заявці три згоди', Array.isArray(c.p_consents) && c.p_consents.length === 3,
     JSON.stringify((c.p_consents||[]).map(x=>x.document)));
  ok('13. у заявці є скринінг', c.p_screening && c.p_screening.weight === 78, JSON.stringify(c.p_screening));
}
ok('14. фінальний екран — «заявку отримано»', /надіслано|отримано|очікує/i.test(await p.locator('#gate-card').innerText()),
   (await step()));
ok('15. без JS-помилок', errs.length === 0, errs.join(' | '));

console.log('\nзаписів у profiles відхилено RLS:', server.profileWrites);
await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' кроків реєстрації пройшло.');
process.exit(bad ? 1 : 0);
