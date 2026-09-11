/**
 * Конфігурація сайту.
 *
 * ЯК УВІМКНУТИ ЛОГІН І СПІЛЬНУ БАЗУ:
 *   1. Створи безкоштовний проєкт на https://supabase.com
 *   2. Settings → API → скопіюй "Project URL" і ключ "anon / public"
 *      (anon-ключ ПУБЛІЧНИЙ, його безпечно тримати у фронтенді —
 *       доступ обмежується політиками RLS з db/schema.sql)
 *   3. SQL Editor → встав уміст db/schema.sql → Run
 *   4. Впиши значення нижче.
 *
 * Поки поля порожні, сайт працює в ЛОКАЛЬНОМУ режимі:
 * усі дані зберігаються в localStorage браузера. Нічого не ламається.
 */
window.APP_CONFIG = {
  siteName: 'Get Stronger',

  /* Правовласник. Псевдонім — і це навмисно: авторське право під
     псевдонімом діє так само, як під справжнім імʼям. Стоїть у підвалі
     сайту, у метатегах сторінок і в LICENSE — одне джерело на всі три. */
  author: 'Matthew Grace',

  supabase: {
    url: 'https://sojbyoxcxyiollefupss.supabase.co',
    /* anon-ключ ПУБЛІЧНИЙ за задумом: він є в кожному браузері, що відкриє
       сайт. Дані боронить не таємність ключа, а RLS — без свого логіна
       з ним не видно нічого, крім таблиці лідерів. */
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvamJ5b3hjeHlpb2xsZWZ1cHNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3OTc4NTQsImV4cCI6MjEwMzM3Mzg1NH0.0xqdQq98IUAhYYc3bmopo2XjUPT6L55wn27lnvenw_s'
  },

  /**
   * Репорт помилок JavaScript (js/errors.js).
   *
   * DSN ПУБЛІЧНИЙ за задумом — так само, як anon-ключ Supabase: він є в
   * кожному браузері, що відкриє сайт. Ним можна лише надсилати події в
   * проєкт, читати з нього чи щось міняти — ні.
   *
   * Порожньо — і модуль мовчить: жодного запиту назовні.
   * На localhost не шле нічого в будь-якому разі.
   */
  sentry: {
    dsn: 'https://69a0ea64608363403d2022a30c8daf52@o4511925239676928.ingest.de.sentry.io/4512019646054480'
  },

  /**
   * Домен, на якому стоїть сайт, БЕЗ косої в кінці.
   * Порожньо — і сайт працює як є, просто без canonical і og:url.
   * Заповниш після деплою — і те, і те зʼявиться саме собою на всіх сторінках.
   * Напр.: 'https://forge.example.com'
   */
  siteUrl: 'https://forge-mold1.vercel.app'
};
