/**
 * ПОМИЛКА МУСИТЬ КАЗАТИ, ЩО САМЕ НЕ ТАК І ДЕ.
 *
 * Форма входу відповідала одним рядком на всі випадки: «Заповніть пошту
 * й пароль (від 8 символів)». Людина з пробілом у кінці адреси, людина з
 * незакритою розкладкою, людина з порожнім полем і людина, яка просто не
 * дописала домен, бачили те саме — і жодна не знала, куди дивитись.
 * Найгірше — на екрані реєстрації з чотирьох полів: помилка висіла під
 * карткою й не показувала, котре з них винне.
 *
 * Тут перевіряється саме це: різні поламки дають РІЗНІ тексти, текст
 * стоїть біля свого поля, поле позначене aria-invalid і дістає фокус.
 * Розбір причин живе в js/auth-msg-core.js і має свої юніт-тести —
 * тут уже про те, чи доходить це до екрана.
 *
 * Запуск: node tools/verifyloginerrors.mjs
 */
import { chromium } from 'playwright';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

const server = { signIn: null };

const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
await ctx.route(/\/rest\/v1\/rpc\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await ctx.route(/\/rest\/v1\/profiles/, r => r.request().method() === 'GET'
  ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  : r.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"42501"}' }));
await ctx.route(/\/auth\/v1\/token/, r => r.fulfill({
  status: server.signIn ? server.signIn.status : 400,
  contentType: 'application/json',
  body: JSON.stringify(server.signIn ? server.signIn.body : { error_code: 'invalid_credentials' })
}));

const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));

const title = () => p.evaluate(() => ((document.querySelector('#gate-card h1') || {}).textContent || '').trim());
const cardText = () => p.locator('#gate-card').innerText();

/** Текст помилки, що стоїть безпосередньо під полем. */
const errUnder = (id) => p.evaluate((sel) => {
  const el = document.querySelector('#' + sel);
  if (!el) return null;
  const box = el.closest('.field');
  const msg = box && box.querySelector('.field__err');
  return msg ? msg.textContent.trim() : '';
}, id);

const invalid = (id) => p.evaluate((sel) => {
  const el = document.querySelector('#' + sel);
  return el ? el.getAttribute('aria-invalid') : null;
}, id);

const focused = () => p.evaluate(() => (document.activeElement || {}).id || '');

async function openLogin() {
  await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  await p.locator('[data-nav="login"]').first().click();
  await p.waitForTimeout(400);
}

async function tryLogin(mail, pass) {
  await p.locator('#au-email').fill(mail);
  await p.locator('#au-pass').fill(pass);
  await p.waitForTimeout(150);
  await p.locator('#au-login').click();
  await p.waitForTimeout(600);
}

/* ------------------------------------------------------------------ */
/* 1. Пошта: кожна поламка — свій текст під полем пошти                 */
/* ------------------------------------------------------------------ */
await openLogin();

const seen = [];
const cases = [
  ['', 'DobrePass1!', /Введіть пошту/, 'порожня пошта'],
  ['друг', 'DobrePass1!', /розкладку/, 'кирилиця'],
  ['friendexample.com', 'DobrePass1!', /знака @/, 'немає @'],
  ['friend@', 'DobrePass1!', /домену/, 'немає домену'],
  ['friend@example', 'DobrePass1!', /крапки/, 'домен без крапки']
];

for (let i = 0; i < cases.length; i++) {
  const [mail, pass, re, name] = cases[i];
  await tryLogin(mail, pass);
  const msg = await errUnder('au-email');
  seen.push(msg);
  ok((i + 1) + '. ' + name + ': текст стоїть під полем пошти і пояснює причину',
     Boolean(msg) && re.test(msg), msg);
}

ok('6. усі пʼять відповідей різні', new Set(seen).size === seen.length, seen.join(' | '));

ok('7. помилкове поле позначене для читалки', (await invalid('au-email')) === 'true');
ok('8. фокус пішов у помилкове поле', (await focused()) === 'au-email', await focused());
ok('9. сусіднє поле НЕ позначене', (await invalid('au-pass')) === null);

/* ------------------------------------------------------------------ */
/* 2. Пароль                                                            */
/* ------------------------------------------------------------------ */
await tryLogin('friend@example.com', '');
ok('10. порожній пароль: помилка під паролем, а не під поштою',
   /Введіть пароль/.test(await errUnder('au-pass')) && !(await errUnder('au-email')),
   await errUnder('au-pass'));

await tryLogin('friend@example.com', 'Ab1!');
{
  const m = await errUnder('au-pass');
  ok('11. закороткий пароль: названо і набране, і потрібне',
     /4/.test(m) && /8/.test(m), m);
}

/* Набране в пошті не має зникати через помилку в іншому полі. */
ok('12. пошта лишилась набраною', (await p.locator('#au-email').inputValue()) === 'friend@example.com');

/* ------------------------------------------------------------------ */
/* 3. Відмова сервера                                                   */
/* ------------------------------------------------------------------ */
server.signIn = { status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
await tryLogin('friend@example.com', 'DobrePass1!');
{
  const m = await errUnder('au-pass');
  ok('13. «не підходить» показано біля пароля', Boolean(m), m);
  ok('14. названо дві найчастіші причини', /Caps Lock/.test(m) && /розкладк/.test(m), m);
  ok('15. англійського тексту сервера на екрані немає',
     !/Invalid login credentials/.test(await cardText()));
}
{
  /* Людині, якій щойно не підійшов пароль, потрібне відновлення —
     і воно має бути помітним, а не сірим рядком унизу. */
  const cls = await p.evaluate(() => {
    const btn = document.querySelector('[data-nav="forgot"]');
    return btn ? btn.className : '';
  });
  ok('16. «Забули пароль?» стає головною кнопкою', /btn--primary/.test(cls), cls);
}

server.signIn = { status: 400, body: { error_code: 'email_not_confirmed', msg: 'Email not confirmed' } };
await tryLogin('friend@example.com', 'DobrePass1!');
ok('17. непідтверджена пошта веде на екран підтвердження, а не в пароль',
   /Підтвердіть пошту/.test(await title()), await title());
ok('18. там сказано, що робити', /лист/i.test(await cardText()));

/* ------------------------------------------------------------------ */
/* 4. Реєстрація: помилка знаходить своє поле з чотирьох                */
/* ------------------------------------------------------------------ */
await p.goto('file://' + ROOT + '/welcome.html', { waitUntil: 'load' });
await p.waitForTimeout(700);
await p.locator('[data-nav="reg"]').first().click();
await p.waitForTimeout(400);

await p.locator('#au-name').fill('Др');
await p.locator('#au-email').fill('friend@example.com');
await p.locator('#au-pass').fill('DobrePass1!');
await p.locator('#au-pass2').fill('DobrePass1!');
await p.locator('#au-reg').click();
await p.waitForTimeout(600);
ok('19. закороткий нік: помилка під ніком', /закороткий/.test(await errUnder('au-name')), await errUnder('au-name'));

await p.locator('#au-name').fill('Друг');
await p.locator('#au-email').fill('friend@example');
await p.locator('#au-reg').click();
await p.waitForTimeout(600);
ok('20. поламана пошта: помилка переїхала під пошту',
   Boolean(await errUnder('au-email')) && !(await errUnder('au-name')),
   await errUnder('au-email'));

await p.locator('#au-email').fill('friend@example.com');
await p.locator('#au-pass').fill('DobrePass1!');
await p.locator('#au-pass2').fill('Inshyj1!Pass');
await p.locator('#au-reg').click();
await p.waitForTimeout(600);
ok('21. різні паролі: помилка під ДРУГИМ полем, бо виправляти там',
   /не збігаються/.test(await errUnder('au-pass2')), await errUnder('au-pass2'));

/* Головне, заради чого все це: після помилки не треба набирати все заново. */
ok('22. перший пароль не стерся після помилки',
   (await p.locator('#au-pass').inputValue()) === 'DobrePass1!');
ok('23. нік і пошта теж на місці',
   (await p.locator('#au-name').inputValue()) === 'Друг' &&
   (await p.locator('#au-email').inputValue()) === 'friend@example.com');

ok('24. без JS-помилок', errs.length === 0, errs.join(' | '));

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок текстів помилок пройшло.');
process.exit(bad ? 1 : 0);
