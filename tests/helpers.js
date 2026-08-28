/**
 * Завантаження модулів сайту в тест.
 *
 * Файли проєкту — не ES-модулі: вони кладуть свій API у window.*, бо сайт
 * має відкриватись подвійним кліком, без збірки. Ламати це заради тестів
 * неправильно, тому тести підлаштовуються під код, а не навпаки: виконуємо
 * файл у пісочниці з підробленим window і забираємо, що він туди поклав.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string[]} files шляхи від кореня проєкту, у порядку залежностей
 * @returns {object} вміст window після виконання
 */
export function loadModules(files) {
  const sandbox = { window: {}, console, Math, Date, JSON, Number, String, Array, Object };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.window;
}

export const loadOneRM     = () => loadModules(['js/onerm-core.js']).OneRM;
export const loadNutrition = () => loadModules(['js/nutrition-core.js']).NutritionCalc;
export const loadExercises = () => loadModules(['js/exercises.js']);
export const loadFoods     = () => loadModules(['js/foods.js']);
export function loadPeriodization() {
  const w = loadModules(['js/onerm-core.js', 'js/exercises.js', 'js/periodization-core.js']);
  return w.Periodization;
}
