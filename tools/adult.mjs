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
 * Вимкнути хмару для цього контексту: сайт бачитиме порожні ключі Supabase.
 *
 * «Локальний режим» — це не прапорець у сховищі, а порожні поля в
 * js/config.js: store.js читає їх ОДИН раз при завантаженні. Відколи в
 * репозиторії лежить справжній проєкт, жодна перевірка не могла більше
 * побачити локальний режим — а він лишається підтримуваним станом сайту
 * (форк без сервера) зі своєю поведінкою: сезон вимкнено, бейдж рівня
 * прихований, акаунтів немає, скринінг — перший екран.
 *
 * Ключі гасяться в момент присвоєння window.APP_CONFIG, тобто до того, як
 * defer-скрипти його прочитають. Підміняти сам файл не можна: перевірки
 * ходять по file:// і мають бачити той самий config.js, що й люди.
 *
 * @param {import('playwright').BrowserContext} ctx
 */
export async function localMode(ctx) {
  await ctx.addInitScript(() => {
    let v;
    Object.defineProperty(window, 'APP_CONFIG', {
      configurable: true,
      get: function () { return v; },
      set: function (nv) {
        v = nv;
        if (v && v.supabase) v.supabase = { url: '', anonKey: '' };
      }
    });
  });
}

/**
 * Контекст із уже посіяним пройденим профілем.
 * @param {import('playwright').Browser} browser
 * @param {object} [opts] звичайні опції newContext
 */
export async function adultContext(browser, opts, extra) {
  const ctx = await browser.newContext(opts);
  const local = !!(extra && extra.local);

  /*
   * ЛОКАЛЬНИЙ РЕЖИМ на замовлення.
   *
   * «Локальний» — це не прапорець у сховищі, а порожні ключі Supabase у
   * js/config.js: store.js читає їх один раз при завантаженні. Відколи в
   * репозиторії лежить справжній проєкт, жодна перевірка не могла більше
   * побачити локальний режим — а він лишається підтримуваним станом
   * сайту (форк без сервера) і має свою поведінку: сезон вимкнено,
   * бейдж рівня прихований, вхід недоступний.
   *
   * Тому ключі гасяться в момент присвоєння window.APP_CONFIG — до того,
   * як defer-скрипти прочитають його. Підміняти сам файл не можна:
   * перевірки ходять по file:// і мають бачити той самий config.js, що
   * й люди.
   */
  if (local) await localMode(ctx);

  /*
   * ЗОВНІШНЬОЇ МЕРЕЖІ НЕМАЄ — і це не «вимкнули заради швидкості».
   *
   * Перевірки стосуються клієнтської логіки, а не Google Fonts і не
   * Supabase. Раніше 16 із 18 інструментів не завершувались узагалі там,
   * де мережа нестабільна — тобто в CI.
   *
   * Просто обірвати всі запити не можна: харнес сідає підроблену сесію
   * (нижче), тому Store вважає себе в хмарному режимі, і кожен
   * saveProfile падав би з «Немає звʼязку» — тобто інструменти міряли б
   * поведінку офлайну замість того, що перевіряють. Тому Supabase не
   * блокується, а ПІДМІНЮЄТЬСЯ мінімальним двійником: профілю в хмарі
   * немає (локальний виграє), записи приймаються, RPC повертають {}.
   */
  /* Решта зовнішнього світу (шрифти, аналітика) — обривається. Цей
     маршрут реєструється ПЕРШИМ навмисно: Playwright перевіряє маршрути у
     зворотному порядку, тож конкретні підміни нижче мають пріоритет. */
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());

  await ctx.route(/\/rest\/v1\/profiles/, function (route) {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await ctx.route(/\/rest\/v1\/rpc\//, function (route) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route(/\/auth\/v1\//, function (route) {
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ access_token: 'test', refresh_token: 'test', expires_in: 3600,
        user: { id: '00000000-0000-4000-8000-000000000001', email: 'test@local' } })
    });
  });

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
  await p.evaluate((arg) => {
    const seed = arg.seed;
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem('ib.profile') || '{}') || {}; } catch (_) {}
    localStorage.setItem('ib.profile', JSON.stringify(Object.assign({}, seed, raw)));
    /*
     * Хмарний сторож (agegate) без сесії пускає лише на welcome. Для
     * file://-перевірок садимо фейкову сесію і статус approved: далі
     * мережеві виклики впадуть і Store чесно читає локальний профіль.
     */
    if (arg.local) return;                    // у локальному режимі сесії немає
    localStorage.setItem('ib.cloud', '1');
    localStorage.setItem('ib.session', JSON.stringify({
      access_token: 'test-token', refresh_token: 'test-refresh',
      expires_at: Date.now() + 86400000,
      user: { id: '00000000-0000-4000-8000-000000000001', email: 'test@example.com' }
    }));
    localStorage.setItem('ib.account', JSON.stringify({ status: 'approved', username: 'Тест', isAdmin: false, t: Date.now() }));
  }, { seed: ONBOARDED, local: local });
  await p.close();

  return ctx;
}
