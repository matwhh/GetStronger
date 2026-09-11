/**
 * ВЛАСНИЙ ПЛАН І ПРАВКИ САМОГО ДНЯ.
 *
 * Редактор умів усе всередині дня — і нічого з самим днем. «День A ·
 * Усе тіло» був незмінним написом; зайвий день не видалявся; почати
 * порожній план не було звідки — усі схеми в реєстрі заповнені, і
 * «свій» доводилось ліпити, вирізаючи чуже.
 *
 * Тут перевіряється: власний каркас є в обох статей; день можна
 * перейменувати, видалити (обовʼязково з питанням) і додати; смуга
 * тижня не показує дня, якого вже немає, і не ховає доданого; і все це
 * переживає перезавантаження, тобто справді лягло в профіль.
 *
 * Запуск: node tools/verifyownplan.mjs
 */
import { chromium } from 'playwright';
import { adultContext } from './adult.mjs';
import { CHROME } from './pw.mjs';

const ROOT = process.cwd();
const R = [];
const ok = (n, c, x) => { R.push([n, c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (x ? ' :: ' + x : '')); };

const b = await chromium.launch({ executablePath: CHROME });

async function seeded(page, sex) {
  await page.goto('file://' + ROOT + '/programs.html', { waitUntil: 'load' });
  await page.evaluate((s) => {
    const raw = JSON.parse(localStorage.getItem('ib.profile') || '{}');
    Object.assign(raw, {
      birthDate: '1990-06-15', weight: 74, height: 174, age: 36, sex: s, activity: 1.55,
      trainingAge: 'inter', daysPerWeek: 4,
      /* Онбординг має бути пройдений, інакше сторож відверне зі сторінки. */
      weights: { 'Ходьба у гору': 1 }
    });
    localStorage.setItem('ib.profile', JSON.stringify(raw));
  }, sex);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
}

const cardTitles = (p) => p.$$eval('#program-list .card__title', (n) => n.map((x) => x.textContent.trim()));

/* Акордеони днів, а не всі підряд: у #plan живуть іще розминка, заминка
   й довідка про програму, і вони теж .acc. Дні впізнаються по номерній
   фішці в заголовку. */
const DAY_ACC = '#plan .acc:has(.chip--acc)';
const dayTitles = (p) => p.$$eval(DAY_ACC + ' .acc__head h3', (n) => n.map((x) => x.textContent.trim()));
const weekTitles = (p) => p.$$eval('#plan .week__day', (n) => n.map((x) => x.textContent.trim()));

/** Розкрити день з номером n (0-based) і дочекатись анімації. */
async function openDay(p, n) {
  const head = p.locator(DAY_ACC + ' .acc__head').nth(n);
  const acc = p.locator(DAY_ACC).nth(n);
  if (!/is-open/.test(String(await acc.getAttribute('class')))) await head.click();
  await p.waitForTimeout(450);
}

/* ------------------------------------------------------------------ */
/* 1. Каркас видно обом статям                                          */
/* ------------------------------------------------------------------ */
for (const sex of ['male', 'female']) {
  const ctx = await adultContext(b, { viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  await seeded(p, sex);
  const titles = await cardTitles(p);
  ok('1. «Власний план» є серед схем (' + sex + ')',
     titles.some((t) => /Власний план/.test(t)), titles.join(' | '));
  await ctx.close();
}

/* ------------------------------------------------------------------ */
/* 2. Правки дня: назва, видалення, додавання                           */
/* ------------------------------------------------------------------ */
const ctx = await adultContext(b, { viewport: { width: 1100, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
/* Системний confirm не має спрацьовувати взагалі — якщо він раптом
   вилізе, приймемо його, і перевірка «питали своїм вікном» це покаже. */
p.on('dialog', d => d.accept());
await seeded(p, 'male');

await p.locator('#program-list [data-pick="own"]').click();
await p.waitForTimeout(900);

ok('2. порожній каркас відкрився на чотири дні', (await dayTitles(p)).length === 4,
   (await dayTitles(p)).join(' | '));
await openDay(p, 0);
ok('3. сказано, що день порожній, а не просто порожня таблиця',
   /Поки що порожньо/.test(await p.locator(DAY_ACC).first().innerText()),
   (await p.locator(DAY_ACC).first().innerText()).replace(/\n+/g, ' | ').slice(0, 120));

await p.locator('#toggle-edit').click();
await p.waitForTimeout(500);

/* Розкриваємо перший день — поля дня живуть усередині акордеона. */
await openDay(p, 0);

const titleField = p.locator('#plan [data-act="day-title"]').first();
ok('4. у режимі правки зʼявилось поле назви дня', (await titleField.count()) === 1);

await titleField.fill('Понеділок — груди');
await titleField.blur();
await p.waitForTimeout(800);
ok('5. день перейменовано', (await dayTitles(p))[0] === 'Понеділок — груди', (await dayTitles(p)).join(' | '));
ok('6. смуга тижня показує нову назву',
   (await weekTitles(p)).includes('Понеділок — груди'), (await weekTitles(p)).join(' | '));

const focusField = p.locator('#plan [data-act="day-focus"]').first();
await focusField.fill('груди, трицепс');
await focusField.blur();
await p.waitForTimeout(800);
ok('7. «про що день» теж змінилось',
   /груди, трицепс/.test(await p.locator(DAY_ACC + ' .acc__head').first().innerText()));

/* ---- Видалення дня: спершу питання ---- */
const before = (await dayTitles(p)).length;
await openDay(p, 1);
await p.locator('#plan [data-act="day-del"]').nth(1).click();
await p.waitForTimeout(500);

ok('8. перед видаленням дня зʼявилось вікно з питанням',
   (await p.locator('.modal [role="alertdialog"]').count()) === 1);
ok('9. у питанні сказано саме про видалення дня з плану',
   /видалити цей день з плану тренувань/i.test(await p.locator('.modal__box').innerText()),
   (await p.locator('.modal__box h3').innerText()));
ok('10. названо, який саме день зникне',
   /День 2/.test(await p.locator('.modal__box').innerText()));

/* «Залишити» нічого не чіпає — це головна перевірка вікна. */
await p.locator('.modal [data-cf="no"]').click();
await p.waitForTimeout(500);
ok('11. «Залишити» справді нічого не видалило', (await dayTitles(p)).length === before,
   (await dayTitles(p)).join(' | '));
ok('12. вікно закрилось', (await p.locator('.modal').count()) === 0);

await p.locator('#plan [data-act="day-del"]').nth(1).click();
await p.waitForTimeout(400);
await p.locator('.modal [data-cf="yes"]').click();
await p.waitForTimeout(900);
{
  const t = await dayTitles(p);
  ok('13. після підтвердження день зник', t.length === before - 1, t.join(' | '));
  ok('14. зник саме той день', !t.includes('День 2'), t.join(' | '));
  const w = await weekTitles(p);
  ok('15. смуга тижня не показує видаленого дня', !w.includes('День 2'), w.join(' | '));
  ok('16. смуга тижня показує рівно стільки днів, скільки лишилось',
     w.length === t.length, w.join(' | '));
}

/* ---- Додавання дня ---- */
await p.locator('#add-day').click();
await p.waitForTimeout(900);
{
  const t = await dayTitles(p);
  ok('17. день додано', t.length === before, t.join(' | '));
  const w = await weekTitles(p);
  ok('18. доданий день видно в смузі тижня — а не тільки в плані',
     w.length === t.length, w.join(' | '));
}

/* ---- Правки пережили перезавантаження ---- */
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1300);
await p.locator('#program-list [data-pick="own"]').click();
await p.waitForTimeout(900);
{
  const t = await dayTitles(p);
  ok('19. після перезавантаження назва дня на місці', t[0] === 'Понеділок — груди', t.join(' | '));
  ok('20. і кількість днів теж', t.length === before, t.join(' | '));
}

ok('21. без JS-помилок', errs.length === 0, errs.join(' | '));

/* ------------------------------------------------------------------ */
/* 3. Останній день видалити не можна                                   */
/* ------------------------------------------------------------------ */
await p.locator('#toggle-edit').click();
await p.waitForTimeout(400);
{
  /* Зносимо дні до останнього. */
  let guard = 0;
  while ((await dayTitles(p)).length > 1 && guard++ < 10) {
    await openDay(p, 0);
    await p.locator('#plan [data-act="day-del"]').first().click();
    await p.waitForTimeout(350);
    await p.locator('.modal [data-cf="yes"]').click();
    await p.waitForTimeout(700);
  }
  ok('22. лишився один день', (await dayTitles(p)).length === 1, String((await dayTitles(p)).length));
  await openDay(p, 0);
  ok('23. кнопка видалення останнього дня вимкнена',
     await p.locator('#plan [data-act="day-del"]').first().isDisabled());
}

await b.close();
const bad = R.filter(r => !r[1]).length;
console.log('\n' + (R.length - bad) + '/' + R.length + ' перевірок власного плану пройшло.');
process.exit(bad ? 1 : 0);
