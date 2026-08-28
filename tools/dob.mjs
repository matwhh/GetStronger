/**
 * Вписати дату народження в три числові поля.
 *
 * Раніше тут стояв .fill() по одному <input type="date">. Поле замінене на
 * ДД / ММ / РРРР (календар для дати народження — це гортання десятиліть
 * назад), тому перевірки заповнюють частини так само, як людина: цифрами.
 */
export async function fillBirth(page, iso) {
  const [y, m, d] = String(iso).split('-');
  await page.locator('#dob-d').fill(d);
  await page.locator('#dob-m').fill(m);
  await page.locator('#dob-y').fill(y);
  await page.waitForTimeout(250);
}
