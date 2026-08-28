/**
 * Спільний посів для браузерних перевірок: профіль, що ПРОЙШОВ онбординг.
 *
 * Відколи Forge відкривається лише повному профілю (вік → тіло →
 * програма з робочою вагою; js/onboarding-core.js), сторінка без цих
 * полів чесно відвертає на відповідний крок — і будь-яка перевірка, що
 * йде «з чистого браузера», падає не через баг, а через правильну
 * поведінку. Тому кожна перевірка, якій потрібен доступ у застосунок,
 * створює контекст через adultContext(): він кладе в сховище мінімальний
 * пройдений профіль ще до першої перевірочної навігації.
 *
 * Перевірки самих воріт (verifyagegate.mjs, verifyonboarding.mjs) цим
 * не користуються навмисно: їм потрібен саме чистий браузер.
 */

export const ADULT_BIRTH = '1990-06-15';

/** Мінімальний профіль, який onboarding-core вважає пройденим. */
export const ONBOARDED = {
  version: 6,
  birthDate: ADULT_BIRTH,
  sex: 'male', weight: 82, height: 180, activity: 1.55,
  trainingAge: 'inter', hrRest: 60,
  programId: 'fullbody', daysPerWeek: 3,
  activePlan: { programId: 'fullbody', days: 3 },
  weights: { 'Присідання зі штангою': 100 }
};

/** Профіль-мінімум, який проходить усі ворота. */
export function adultProfile(extra) {
  return Object.assign({}, ONBOARDED, extra || {});
}

/**
 * Контекст із уже посіяним пройденим профілем.
 * @param {import('playwright').Browser} browser
 * @param {object} [opts] звичайні опції newContext
 */
export async function adultContext(browser, opts) {
  const ctx = await browser.newContext(opts);

  /*
   * Садимо профіль ОДИН раз, до першої перевірочної навігації — і більше
   * в сховище не лізе ніхто.
   *
   * Спершу тут стояв addInitScript, який дописував поля на КОЖНОМУ
   * переході. Це виявилось руйнівним: інколи читання профілю на старті
   * нового документа поверталось порожнім (запис попередньої сторінки ще
   * не встиг лягти), скрипт вважав, що профілю немає, і писав свій
   * мінімальний обʼєкт — затираючи activePlan разом з усім іншим. Тест
   * після цього падав «випадково», раз на кілька прогонів.
   *
   * Тепер це звичайний посів: як у живої людини, профіль просто лежить у
   * сховищі з першого відкриття. Наявні поля сховища мають пріоритет —
   * посів лише ДОСИПАЄ те, чого бракує до пройденого онбордингу.
   */
  const p = await ctx.newPage();
  await p.goto('file://' + process.cwd() + '/welcome.html', { waitUntil: 'load' });
  await p.evaluate((seed) => {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem('ib.profile') || '{}') || {}; } catch (_) {}
    localStorage.setItem('ib.profile', JSON.stringify(Object.assign({}, seed, raw)));
  }, ONBOARDED);
  await p.close();

  return ctx;
}
