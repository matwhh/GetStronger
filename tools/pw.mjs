/**
 * Спільні налаштування браузерних перевірок.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Кожна перевірка носила в собі два абсолютні
 * шляхи: корінь сайту (/root/work/forgesite) і бінарник Chromium
 * (/opt/pw-browsers/...). Обидва існують лише в контейнері, де писався
 * код, — тому перевірки не запускались більше НІДЕ: ні на Mac, ні в
 * GitHub Actions. Тобто найдорожчі тести проєкту ганялись тільки вручну
 * й тільки коли хтось про них згадував. Саме так у продакшен доїхав
 * баг з часом сесії: юніти його не бачили, а браузерних перевірок
 * історії просто не існувало.
 *
 * Тепер шляхи рахуються самі:
 *   ROOT   — тека, з якої запустили (як і в adult.mjs), або FORGE_ROOT.
 *   CHROME — бінарник контейнера, якщо він є; інакше undefined, і
 *            Playwright бере свій завантажений браузер. Саме undefined,
 *            а не порожній рядок: playwright читає executablePath як
 *            «не задано» тільки для undefined.
 */
import fs from 'node:fs';

/** Корінь сайту. Запускати перевірки треба з кореня репозиторію. */
export const ROOT = process.env.FORGE_ROOT || process.cwd();

/** file://-адреса сторінки сайту. */
export const U = (f) => 'file://' + ROOT + '/' + f;

const BUNDLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** Шлях до Chromium або undefined, якщо треба брати браузер Playwright. */
export const CHROME = fs.existsSync(BUNDLED) ? BUNDLED : undefined;

/** Готові аргументи для chromium.launch(). */
export const LAUNCH = CHROME ? { executablePath: CHROME } : {};
