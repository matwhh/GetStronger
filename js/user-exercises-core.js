/**
 * СВОЇ ВПРАВИ — бібліотека, яку можна поповнити без правки коду.
 *
 * js/exercises.js — файл у репозиторії: щоб додати туди вправу, треба
 * редагувати код і викладати сайт наново. У залі це не працює. Тренажер
 * називається інакше, вправа зроблена під свій хват, у клубі стоїть
 * машина, якої немає в жодному списку — і людина мусить обрати «щось
 * схоже», після чого обʼєм по групах рахується не про те, що вона робила.
 *
 * Тому свої вправи живуть у профілі (profile.customExercises) і
 * доклеюються до бібліотеки на льоту — тим самим форматом, що й
 * бібліотечні: name, muscles, lift. Далі їх не відрізнити: заміна вправи,
 * пошук по групі, тижневий обʼєм, стеля відсотків у періодизації
 * працюють однаково, бо працюють із полями, а не з походженням.
 *
 * ПРАВИЛА ТУТ ТІ САМІ, ЩО В ШАПЦІ js/exercises.js, і це навмисно:
 *   - muscles[0] — ГОЛОВНА група, саме їй ідуть підходи в обʼєм;
 *   - lift за замовчуванням 'isolation' — безпечніший бік помилки, бо
 *     інакше людина отримає 92% від разового максимуму в махах.
 * Друга копія цих правил була б першим місцем, де вони розійдуться, тож
 * тут не додано ЖОДНОГО власного — лише перевірка вводу.
 *
 * ЧОМУ БІБЛІОТЕЧНА НАЗВА СИЛЬНІША. Своя вправа не може перекрити
 * однойменну бібліотечну: назва — це ключ, за яким живуть робоча вага
 * (profile.weights), стеля ваги (js/weight-limits-core.js) та історія.
 * Дозволити підміну означало б тихо змінити групу мʼязів під уже
 * записаними вагами.
 */
(function () {
  'use strict';

  /*
   * Стеля назви. Довше не влазить ні в рядок вправи на телефоні, ні в
   * випадайку заміни — а обрізати мовчки не можна: у книзі ваг і в
   * історії вправа стоятиме під іменем, якого людина не писала.
   */
  var NAME_MAX = 48;

  /** Назва без крайніх і подвійних пробілів, або null. */
  function normName(v) {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    var s = String(v).replace(/\s+/g, ' ').trim();
    if (!s || s.length > NAME_MAX) return null;
    return s;
  }

  /*
   * Ключ порівняння НАЗВ.
   *
   * Не keyOf — це імʼя в проєкті зайняте датами (js/date-core.js), і
   * гігієна стежить, щоб воно не почало означати дві різні речі.
   *
   * Регістр і зайві пробіли вправи не міняють: у книзі ваг, у стелі ваги
   * й в історії ключем стоїть сама назва, тож «Жим лежачи» і «жим
   * ЛЕЖАЧИ» ділили б одне число, хоч у списку виглядали б як дві вправи.
   */
  function nameKey(name) {
    var s = normName(name);
    return s === null ? null : s.toLowerCase();
  }

  /** Відомі групи в поданому порядку, без повторів; порожньо — null. */
  function normMuscles(ids, known) {
    if (!Array.isArray(ids)) return null;
    var ok = Array.isArray(known) ? known : [];
    var out = [], seen = Object.create(null);
    ids.forEach(function (id) {
      var s = typeof id === 'string' ? id.trim() : '';
      if (!s || seen[s] || ok.indexOf(s) === -1) return;
      seen[s] = true;
      out.push(s);
    });
    return out.length ? out : null;
  }

  /** 'compound' лише якщо так і сказано; усе інше — ізоляція. */
  function normLift(v) {
    return v === 'compound' ? 'compound' : 'isolation';
  }

  /**
   * Одна вправа з довільного вводу, або null.
   * @param {{name?:string, muscles?:string[], lift?:string}} raw
   * @param {string[]} known список дозволених id груп (MUSCLES)
   */
  function normOne(raw, known) {
    if (!raw || typeof raw !== 'object') return null;
    var name = normName(raw.name);
    var muscles = normMuscles(raw.muscles, known);
    if (name === null || muscles === null) return null;
    return { name: name, muscles: muscles, lift: normLift(raw.lift), user: true };
  }

  /** Свої вправи з профілю — уже перевірені. */
  function list(profile, known) {
    var src = profile && Array.isArray(profile.customExercises) ? profile.customExercises : [];
    var out = [];
    src.forEach(function (raw) {
      var one = normOne(raw, known);
      if (one) out.push(one);
    });
    return out;
  }

  /**
   * Додати свою вправу.
   *
   * Повертає {ok:true, list} або {ok:false, why} з причиною — 'name',
   * 'muscles' чи 'dup'. Причина потрібна саме тут: сторінка мусить
   * сказати, ЩО не так, а не просто нічого не зробити.
   *
   * @param {Array} current     нинішній власний список
   * @param {Object} raw        те, що ввели
   * @param {string[]} taken    назви, які вже зайняті бібліотекою
   * @param {string[]} known    дозволені id груп
   */
  function add(current, raw, taken, known) {
    var src = Array.isArray(current) ? current : [];
    var name = normName(raw && raw.name);
    if (name === null) return { ok: false, why: 'name' };
    if (normMuscles(raw && raw.muscles, known) === null) return { ok: false, why: 'muscles' };

    var key = nameKey(name);
    var busy = (Array.isArray(taken) ? taken : []).some(function (n) { return nameKey(n) === key; }) ||
               src.some(function (e) { return nameKey(e && e.name) === key; });
    if (busy) return { ok: false, why: 'dup' };

    var one = normOne(raw, known);
    if (!one) return { ok: false, why: 'name' };
    return { ok: true, list: src.concat([one]) };
  }

  /** Прибрати свою вправу за назвою. Повертає НОВИЙ список. */
  function remove(current, name) {
    var key = nameKey(name);
    return (Array.isArray(current) ? current : [])
      .filter(function (e) { return nameKey(e && e.name) !== key; });
  }

  /**
   * Бібліотека плюс свої вправи. Новий масив — вихідний не мутується:
   * window.EXERCISES читають одразу кілька сторінок, і дописування в
   * нього на місці робило б порядок залежним від того, хто завантажився
   * першим.
   */
  function applyTo(library, own) {
    var lib = Array.isArray(library) ? library : [];
    var busy = Object.create(null);
    lib.forEach(function (e) {
      var k = nameKey(e && e.name);
      if (k !== null) busy[k] = true;
    });
    var extra = (Array.isArray(own) ? own : []).filter(function (e) {
      var k = nameKey(e && e.name);
      if (k === null || busy[k]) return false;
      busy[k] = true;
      return true;
    });
    return lib.concat(extra);
  }

  window.UserExercises = {
    NAME_MAX: NAME_MAX,
    normName: normName,
    normMuscles: normMuscles,
    normLift: normLift,
    normOne: normOne,
    list: list,
    add: add,
    remove: remove,
    applyTo: applyTo
  };
})();
