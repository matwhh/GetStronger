/**
 * Надійність пароля — чисті функції, без DOM.
 *
 * ПРАВИЛА (мають збігатися з Supabase Auth → Providers → Email):
 *   1. довжина від MIN_LEN;
 *   2. ТІЛЬКИ латиниця, цифри й символи — кирилиця не приймається;
 *   3. велика літера, мала літера, цифра і символ — усі чотири;
 *   4. пароля немає у списку найпоширеніших;
 *   5. це не тривіальний візерунок (12345678, aaaaaaaa, qwertyui);
 *   6. він не складається з власної пошти чи ніка.
 *
 * ЧОМУ ТІЛЬКИ ЛАТИНИЦЯ. Supabase перевіряє склад пароля за латинськими
 * наборами (a-z, A-Z, 0-9, розділові) — кирилиця не рахується там ЖОДНИМ
 * класом. Тобто «Корова-Міст-2026» сервер відхилив би, а форма пропустила:
 * людина побачила б зелену смужку й англійську помилку від сервера.
 * Заборона кирилиці прибирає це розходження: правила клієнта і сервера
 * тепер описують один і той самий набір паролів.
 *
 * ПРО РОЗКЛАДКУ. Перемкнути клавіатуру з коду неможливо — такого API в
 * браузері немає. Тому кирилиця не мовчки ріжеться, а одразу дає
 * зрозуміле повідомлення: «перемкни розкладку на англійську».
 *
 * ДЕ МЕЖА ЦІЄЇ ПЕРЕВІРКИ. Вона клієнтська і її можна обійти, звернувшись
 * до API напряму. Це свідомо: слабкий пароль шкодить ВЛАСНИКОВІ акаунта,
 * а не чужим даним — тобто це питання UX, а не авторизації (на відміну
 * від approval і RLS, які мусять жити на сервері). Серверна підстраховка
 * все одно є: мінімальна довжина й вимоги до складу в Supabase Auth.
 */
(function () {
  'use strict';

  /* Має збігатися з Authentication → Providers → Email →
     Minimum password length у Supabase. Розходження означає, що форма
     пропустить пароль, який сервер відхилить незрозумілою помилкою. */
  const MIN_LEN = 8;
  const MAX_LEN = 72;   // ліміт bcrypt: довше просто обрізається

  /*
   * Найпоширеніші паролі й локальні звички. Список свідомо короткий:
   * повний перелік на десятки тисяч рядків важив би більше за весь сайт,
   * а візерункові правила нижче ловлять ту саму родину випадків
   * (послідовності, повтори, клавіатурні ряди) без жодного словника.
   */
  const COMMON = new Set([
    'password', 'passw0rd', 'password1', 'password123', 'parol', 'parol123',
    'qwerty', 'qwerty123', 'qwertyuiop', 'qwerty12345', 'asdfghjkl', 'zxcvbnm',
    '12345678', '123456789', '1234567890', '11111111', '00000000', '123123123',
    'iloveyou', 'admin123', 'welcome1', 'letmein', 'monkey123', 'dragon123',
    'football', 'baseball', 'superman', 'batman123', 'sunshine', 'princess',
    'trustno1', 'starwars', 'whatever', 'freedom1', 'computer', 'internet',
    'samsung1', 'liverpool', 'ferrari1', 'pokemon1', 'nintendo',
    'ukraine', 'ukraine1', 'slavaukraini', 'kyiv2022', 'privet123',
    'yaroslav', 'volodymyr', 'oleksandr', 'katerina',
    'forge123', 'forgeforge', 'trening123', 'sportsport',
    'abcd1234', 'abcdefgh', 'a1b2c3d4', 'test1234', 'temp1234', 'changeme'
  ]);

  /** Розкладка: латиниця під кирилицею — «пароль» набраний англійською. */
  const KEYBOARD_ROWS = [
    'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
    'йцукенгшщзхї', 'фівапролджє', 'ячсмитьбю',
    '1234567890'
  ];

  function norm(s) { return String(s || '').toLowerCase(); }

  /*
   * Пароль зі «звичного маскування»: P@ssw0rd1 → password.
   *
   * Це головна дірка вимог до складу символів: людина бере знайоме слово,
   * міняє a→@, o→0, s→$ — і формально має всі чотири класи, а фактично
   * пароль лишається у кожному словнику для підбору. Перекладаємо назад
   * і звіряємось із тим самим списком COMMON.
   */
  const LEET = { '@': 'a', '4': 'a', '0': 'o', '1': 'l', '!': 'i', '3': 'e',
                 '$': 's', '5': 's', '7': 't', '+': 't', '8': 'b' };

  function deLeet(s) {
    return norm(s).replace(/[@401!3$57+8]/g, function (ch) { return LEET[ch] || ch; });
  }

  /** Лишити самі літери: «Qwerty123!» → «qwerty» */
  function lettersOnly(s) { return norm(s).replace(/[^a-z]/g, ''); }

  /**
   * Чи ховається за паролем відоме слово зі списку.
   *
   * Пробуємо кілька способів «роздягнути» пароль до основи: прибрати
   * хвіст із символів і цифр («Qwerty123!» → «Qwerty»), перекласти
   * маскування («P@ssw0rd» → «password»), лишити самі літери. Якщо
   * ХОЧ ОДИН варіант знайшовся у COMMON — пароль слабкий, хоч би скільки
   * класів символів він формально містив.
   */
  function hidesCommonWord(p) {
    const bare = String(p).replace(/[^a-zA-Z0-9]+$/, '').replace(/[0-9]+$/, '');
    const tries = [
      norm(p), lettersOnly(p), deLeet(p), lettersOnly(deLeet(p)),
      norm(bare), lettersOnly(bare), deLeet(bare), lettersOnly(deLeet(bare))
    ];
    return tries.some(function (v) { return v.length >= 4 && COMMON.has(v); });
  }

  /** Цей шматок лежить підряд у якомусь ряду клавіатури? */
  function inRow(t) {
    for (const row of KEYBOARD_ROWS) {
      const rev = row.split('').reverse().join('');
      if (row.includes(t) || rev.includes(t)) return true;
    }
    return false;
  }

  /**
   * Пароль — це ряд клавіатури? (qwertyuiop, asdfghjkl1)
   * Короткий цифровий хвіст не рятує: «ряд + 1» лишається рядом, і
   * підбирається так само швидко. Вичерпним цей набір правил не буде —
   * він і не мусить: словник COMMON закриває решту відомих випадків.
   */
  function isKeyboardRun(s) {
    const t = norm(s);
    if (t.length < 4) return false;
    if (inRow(t)) return true;
    const m = /^(.+?)([0-9]{1,4})$/.exec(t);
    return Boolean(m && m[1].length >= 6 && inRow(m[1]));
  }

  /**
   * Пароль — це повтори короткого шматка? (abcabcabc, abcabcabca)
   * Хвіст може бути обірваний на півслові, тому порівнюємо з повтором,
   * підрізаним до довжини пароля: рівного ділення не вимагаємо.
   */
  function isRepeatedChunk(s) {
    const t = norm(s);
    for (let n = 1; n <= Math.floor(t.length / 2); n++) {
      const chunk = t.slice(0, n);
      const grown = chunk.repeat(Math.ceil(t.length / n)).slice(0, t.length);
      if (grown === t) return true;
    }
    return false;
  }

  /** Арифметична послідовність символів: 123456, abcdef, 987654 */
  function isSequential(s) {
    const t = norm(s);
    if (t.length < 4) return false;
    let up = true, down = true;
    for (let i = 1; i < t.length; i++) {
      const d = t.charCodeAt(i) - t.charCodeAt(i - 1);
      if (d !== 1) up = false;
      if (d !== -1) down = false;
    }
    return up || down;
  }

  /* Класи символів. Ті самі чотири, що їх перевіряє Supabase. */
  const HAS_LOWER  = /[a-z]/;
  const HAS_UPPER  = /[A-Z]/;
  const HAS_DIGIT  = /[0-9]/;
  const HAS_SYMBOL = /[^a-zA-Z0-9]/;
  /* Дозволені символи: друковані ASCII. Усе інше (кирилиця, емодзі,
     нерозривний пробіл) — не пароль, а майбутня проблема зі входом. */
  const LATIN_ONLY = /^[\x21-\x7E]+$/;

  /**
   * Перевірка пароля.
   * @param {string} pass
   * @param {{email?: string, username?: string}} [ctx] — щоб пароль не
   *        був власною поштою чи ніком: такий «пароль» вгадується першим.
   * @returns {{ok: boolean, score: 0|1|2|3, label: string, problem: string}}
   *          problem — порожній рядок, коли пароль прийнятний.
   */
  function check(pass, ctx) {
    const p = String(pass == null ? '' : pass);
    const t = norm(p);
    const c = ctx || {};

    if (!p) return fail(0, 'Введіть пароль.');
    if (p.length < MIN_LEN) {
      return fail(0, 'Пароль має бути щонайменше ' + MIN_LEN + ' символів — зараз ' + p.length + '.');
    }
    if (p.length > MAX_LEN) {
      return fail(0, 'Пароль задовгий: максимум ' + MAX_LEN + ' символів.');
    }
    if (/^\s|\s$/.test(p)) {
      return fail(0, 'Пробіл на початку чи в кінці легко загубити — приберіть його.');
    }

    /* Кирилиця — найчастіша причина «не можу увійти»: пароль набрано в
       іншій розкладці. Кажемо це прямо, а не «недопустимий символ». */
    if (/[Ѐ-ӿ]/.test(p)) {
      return fail(0, 'Пароль має бути англійською. Перемкніть розкладку клавіатури.');
    }
    if (!LATIN_ONLY.test(p)) {
      return fail(0, 'Дозволені лише латинські літери, цифри та символи — без пробілів.');
    }

    if (!HAS_LOWER.test(p))  return fail(0, 'Додайте малу літеру (a–z).');
    if (!HAS_UPPER.test(p))  return fail(0, 'Додайте велику літеру (A–Z).');
    if (!HAS_DIGIT.test(p))  return fail(0, 'Додайте цифру (0–9).');
    if (!HAS_SYMBOL.test(p)) return fail(0, 'Додайте символ: ! ? @ # $ % & * - _');

    /* «Password1!», «Qwerty123!», «P@ssw0rd1» — відоме слово під
       маскуванням. Саме сюди вимоги до складу символів і женуть людей. */
    if (hidesCommonWord(p)) {
      return fail(0, 'Це один із найпоширеніших паролів у світі. Його підбирають першим.');
    }
    /* Візерунки шукаємо і в «основі» пароля — самих літерах. «Abcdefg1!»
       чи «aaaaaaaaA1!» — це той самий алфавіт підряд і той самий повтор,
       лише з причепленим хвостом заради вимог до складу символів. */
    const core = lettersOnly(p);
    if (isRepeatedChunk(p) || (core.length >= 6 && isRepeatedChunk(core))) {
      return fail(0, 'Пароль складається з повторів одного шматка — такий підбирається миттєво.');
    }
    if (isSequential(p) || (core.length >= 5 && isSequential(core))) {
      return fail(0, 'Це проста послідовність символів. Підбирається миттєво.');
    }
    if (isKeyboardRun(p) || (core.length >= 6 && isKeyboardRun(core))) {
      return fail(0, 'Це підряд узятий ряд клавіатури. Підбирається миттєво.');
    }

    /* Пошта і нік у паролі: перше, що пробує той, хто знає адресу. */
    const local = norm(c.email).split('@')[0];
    if (local && local.length >= 4 && t.includes(local)) {
      return fail(0, 'Пароль містить вашу пошту — це перше, що пробують.');
    }
    const uname = norm(c.username);
    if (uname && uname.length >= 4 && t.includes(uname)) {
      return fail(0, 'Пароль містить ваш нік — це перше, що пробують.');
    }

    /*
     * Пароль прийнятний. Оцінка (1–3) — підказка, а не бар'єр.
     * Усі чотири класи символів тут уже є (вимога вище), тож
     * відрізняє паролі саме ДОВЖИНА — вона й вирішує оцінку.
     */
    let score = 1;
    if (p.length >= 12) score = 2;
    if (p.length >= 16) score = 3;

    return {
      ok: true,
      score: score,
      label: ['', 'Прийнятний', 'Надійний', 'Дуже надійний'][score],
      problem: ''
    };
  }

  function fail(score, problem) {
    return { ok: false, score: score, label: 'Слабкий', problem: problem };
  }

  window.PasswordCore = {
    MIN_LEN: MIN_LEN,
    MAX_LEN: MAX_LEN,
    check: check
  };
})();
