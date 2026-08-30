/**
 * Реєстрація, ПЕРЕРВАНА перезавантаженням сторінки.
 *
 * Живий випадок, на якому застрягла реальна людина: акаунт створено,
 * лист чекає, людина йде в пошту — і повертається на сторінку, яка вже
 * нічого про неї не памʼятає. Плюс другий тупик того ж дня: анкета
 * заповнена, кнопка «Далі» не працює й НЕ КАЖЕ ЧОМУ (бракувало трьох
 * згод під формою).
 *
 * Тому тут перевіряються рівно дві речі, яких не бачить verifyregister:
 *   1. що набране переживає F5 — і що пароль при цьому НЕ лягає на диск;
 *   2. що вимкнена кнопка завжди має підпис із причиною.
 */
import { chromium } from 'playwright';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const server = { confirmed: false, status: 'none', registerCalls: [] };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await ctx.route(/\/rest\/v1\/rpc\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await ctx.route(/\/auth\/v1\/signup/, r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: 'u1', email: 'f@e.com', confirmation_sent_at: new Date().toISOString() }) }));
await ctx.route(/\/auth\/v1\/token/, r => server.confirmed
  ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', email: 'f@e.com' } }) })
  : r.fulfill({ status: 400, contentType: 'application/json',
      body: JSON.stringify({ error_code: 'email_not_confirmed', msg: 'Email not confirmed' }) }));
await ctx.route(/\/auth\/v1\/user/, r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ id: 'u1', email: 'f@e.com' }) }));
await ctx.route(/\/rest\/v1\/rpc\/account_state/, r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ status: server.status }) }));
await ctx.route(/\/rest\/v1\/rpc\/username_free/, r => r.fulfill({ status: 200, contentType: 'application/json', body: 'true' }));
await ctx.route(/\/rest\/v1\/rpc\/register_request/, r => {
  server.registerCalls.push(JSON.parse(r.request().postData() || '{}'));
  server.status = 'pending';
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending' }) });
});
await ctx.route(/\/rest\/v1\/profiles/, r => r.request().method() === 'GET'
  ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  : r.fulfill({ status: 403, contentType: 'application/json',
      body: JSON.stringify({ code: '42501', message: 'row-level security' }) }));

const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('dialog', d => d.accept());

const title = () => p.evaluate(() => ((document.querySelector('#gate-card h1') || {}).textContent || '').trim());
const noteOf = async (id) => ((await p.locator(id).textContent()) || '').trim();

const PASS = 'DobrePass1!';

/* ---- Реєстрація до екрана «Підтвердіть пошту» ---- */
await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
await p.waitForTimeout(700);
await p.locator('[data-nav="reg"]').click();
await p.waitForTimeout(300);
await p.locator('#au-name').fill('Друг');
await p.locator('#au-email').fill('f@e.com');
await p.locator('#au-pass').fill(PASS);
await p.locator('#au-pass2').fill(PASS);
await p.waitForTimeout(300);
await p.locator('#au-reg').click();
await p.waitForTimeout(900);
ok('1. після реєстрації — екран підтвердження пошти', /Підтвердіть пошту/.test(await title()), await title());

/* ---- F5, поки людина ходила в пошту ---- */
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1000);
ok('2. F5 не викидає на стартовий екран', /Підтвердіть пошту/.test(await title()), await title());
ok('2. пошта на екрані збереглася',
   /f@e\.com/.test(await p.locator('#gate-card').innerText()));

/* ПАРОЛЬ НЕ МАЄ ЛЕЖАТИ НА ДИСКУ. Чернетка потрібна для зручності, але
   зручність не купується збереженим паролем — перевіряємо все сховище. */
const leaked = await p.evaluate((pw) => {
  const hits = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (String(localStorage.getItem(k)).indexOf(pw) !== -1) hits.push(k);
  }
  return hits;
}, PASS);
ok('3. пароля немає в localStorage', leaked.length === 0, leaked.join(', ') || 'чисто');

/* ---- «Я підтвердив(ла)» без пароля в памʼяті веде на вхід, а не в глухий кут ---- */
server.confirmed = true;
await p.locator('#au-confirmed').click();
await p.waitForTimeout(700);
ok('4. без пароля в памʼяті веде на вхід із поясненням',
   /Вхід/.test(await title()) && /увійдіть/i.test(await p.locator('#gate-card').innerText()), await title());
ok('4. пошта на вході підставлена',
   (await p.locator('#au-email').inputValue()) === 'f@e.com');

await p.locator('#au-pass').fill(PASS);
await p.locator('#au-login').click();
await p.waitForTimeout(1200);
ok('5. вхід веде в скринінг', /дату народження|Оберіть нік/.test(await title()), await title());

if (await p.locator('#au-name-go').count()) {
  await p.locator('#au-name').fill('Друг');
  await p.locator('#au-name-go').click();
  await p.waitForTimeout(800);
}
await p.locator('#dob-d').fill('15');
await p.locator('#dob-m').fill('06');
await p.locator('#dob-y').fill('1995');
await p.waitForTimeout(400);
await p.locator('#gate-go').click();
await p.waitForTimeout(900);
ok('6. екран тіла', /Розкажіть про себе/.test(await title()), await title());

/* ---- Вимкнена кнопка ЗАВЖДИ пояснює причину ---- */
ok('7. порожня анкета: кнопка вимкнена й каже, чого бракує',
   await p.locator('#body-go').isDisabled() && (await noteOf('#body-note')).length > 10,
   await noteOf('#body-note'));

await p.locator('.seg__item:has(input[value="male"]) span').first().click();
await p.locator('#b-height').fill('180');
await p.locator('#b-weight').fill('78');
await p.selectOption('#b-activity', '1.55');
await p.selectOption('#b-trainage', 'inter');
await p.waitForTimeout(400);
const noteNoConsent = await noteOf('#body-note');
ok('8. анкета повна, згоди ні: кнопка вимкнена саме через згоди',
   await p.locator('#body-go').isDisabled() && /згод/i.test(noteNoConsent), noteNoConsent);

/* ---- F5 на екрані тіла: набране не має зникати ---- */
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1200);
const kept = await p.evaluate(() => ({
  sex: (document.querySelector('input[name=b-sex]:checked') || {}).value || null,
  height: (document.querySelector('#b-height') || {}).value,
  weight: (document.querySelector('#b-weight') || {}).value,
  activity: (document.querySelector('#b-activity') || {}).value,
  trainingAge: (document.querySelector('#b-trainage') || {}).value
}));
ok('9. F5 на екрані тіла не стирає анкету',
   kept.sex === 'male' && kept.height === '180' && kept.weight === '78' &&
   kept.activity === '1.55' && kept.trainingAge === 'inter', JSON.stringify(kept));

/* ---- Згоди → заявка ---- */
const boxes = await p.locator('#b-consents input').count();
ok('10. три згоди на екрані', boxes === 3, String(boxes));
for (let i = 0; i < boxes; i++) await p.locator('#b-consents input').nth(i).check();
await p.waitForTimeout(400);
ok('11. з усіма згодами кнопка активна', !(await p.locator('#body-go').isDisabled()), await noteOf('#body-note'));

await p.locator('#body-go').click();
await p.waitForTimeout(900);
if (await p.locator('#bmi-w-ok').count()) { await p.locator('#bmi-w-ok').click(); await p.waitForTimeout(900); }
await p.waitForTimeout(600);
ok('12. заявку подано', server.registerCalls.length === 1, 'викликів: ' + server.registerCalls.length);
ok('12. у заявці ті самі дані, що набрані',
   server.registerCalls.length === 1 &&
   server.registerCalls[0].p_birth === '1995-06-15' &&
   server.registerCalls[0].p_screening.weight === 78,
   JSON.stringify(server.registerCalls[0] || {}));
ok('13. фінальний екран — «заявку отримано»', /Заявку/.test(await title()), await title());
ok('14. чернетку прибрано після заявки',
   await p.evaluate(() => localStorage.getItem('ib.regdraft') === null));
ok('15. без JS-помилок', errs.length === 0, errs.join(' | '));

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок перерваної реєстрації пройшло.');
process.exit(bad ? 1 : 0);
