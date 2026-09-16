/**
 * Профіль залу — які снаряди реально є під рукою.
 *
 * ЩО ЦЕ ЛАГОДИТЬ. Досі весь застосунок вважав, що крок ваги — 2,5 кг:
 * прогресія, розминкові сходинки, прогноз, скидання ваг. 2,5 — це пара
 * млинців по 1,25. Якщо їх у залі немає, найменша добавка до штанги —
 * 5 кг, а то й 10; на гантельному ряду з кроком 2 кг «+2,5» не існує в
 * принципі; у тренажера зі стеком по 5 — тим паче. Тобто число, яке
 * сайт радив поставити, не завжди можна було поставити.
 *
 * ЩО ЦЕ НЕ ЛАГОДИТЬ. Профіль порожній за замовчуванням і лишається
 * необовʼязковим назавжди. Порожній профіль = стара поведінка до
 * останнього знака: 2,5 кг від двадцяти й вище, 1 кг нижче. Це не
 * ввічливість, а вимога: людина, яка не вводила інвентар, не має
 * отримати інші числа, ніж отримувала вчора.
 *
 * ФОРМА В ПРОФІЛІ (profile.gym), усе необовʼязкове:
 *
 *   { bar: 20,                                   гриф, кг
 *     plates: [{ kg: 20, pairs: 2 }, …],         млинці ПАРАМИ
 *     dumbbells: { from: 2, to: 30, step: 2 },   гантельний ряд
 *     machineStep: 5 }                           крок стека тренажера
 *
 * Млинці рахуються парами навмисно: на штангу вішають симетрично, і
 * «три млинці по 10» — це завжди або два, або чотири.
 */
(function () {
  'use strict';

  /* Види снарядів. 'other' — усе, чого не впізнали: там працює старе
     правило кроку за вагою, і це чесніше, ніж вигадана класифікація. */
  const KINDS = ['barbell', 'dumbbell', 'machine', 'other'];

  /* Старе правило: те саме число, що в periodization-core.stepFor і в
     projection.stepForWeight. Воно лишається запасним варіантом для
     порожнього профілю, тож живе тут як єдина копія, а не як четверта. */
  const HEAVY_FROM = 20;
  const STEP_LIGHT = 1;
  function plateStep() {
    return (window.OneRM && window.OneRM.PLATE_STEP) || 2.5;
  }

  /** Стеля ваги — та сама, що в решті проєкту (книга ваг, підходи). */
  const MAX_KG = 500;

  function num(v) {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Вага в межах 0…500 з кроком 0,25 (найдрібніший млинець, що буває) */
  function normKg(v, min) {
    const n = num(v);
    if (n === null) return null;
    const r = Math.round(n * 4) / 4;
    return (r >= (min == null ? 0 : min) && r <= MAX_KG) ? r : null;
  }

  /**
   * Санітизація профілю залу. Повертає ЗАВЖДИ повний обʼєкт із
   * порожніми полями там, де даних немає: перевіряти «а чи є ключ»
   * у пʼятьох місцях — це п'ять способів забути.
   */
  function normGym(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};

    const bar = normKg(src.bar, 1);

    const seen = {};
    const plates = (Array.isArray(src.plates) ? src.plates : [])
      .map(function (p) {
        if (!p || typeof p !== 'object') return null;
        const kg = normKg(p.kg, 0.25);
        const pairs = num(p.pairs);
        if (kg === null || kg > 100) return null;          // млинців важчих не буває
        if (pairs === null || pairs < 1) return null;
        return { kg: kg, pairs: Math.min(20, Math.round(pairs)) };
      })
      .filter(function (p) {
        if (!p || seen[p.kg]) return false;                 // дублі злипаються
        seen[p.kg] = 1;
        return true;
      })
      .sort(function (a, b) { return b.kg - a.kg; });

    let dumbbells = null;
    const d = src.dumbbells;
    if (d && typeof d === 'object') {
      const from = normKg(d.from, 0.5);
      const to = normKg(d.to, 0.5);
      const step = normKg(d.step, 0.25);
      if (from !== null && to !== null && step !== null && step > 0 && to >= from) {
        dumbbells = { from: from, to: to, step: step };
      }
    }

    const ms = normKg(src.machineStep, 0.5);

    return {
      bar: bar,
      plates: plates,
      dumbbells: dumbbells,
      machineStep: (ms !== null && ms > 0) ? ms : null
    };
  }

  /** Чи знає профіль хоч щось про цей вид снаряда */
  function knows(kind, gym) {
    const g = gym || {};
    if (kind === 'barbell') return !!(g.bar !== null && g.bar !== undefined && (g.plates || []).length);
    if (kind === 'dumbbell') return !!g.dumbbells;
    if (kind === 'machine') return !!g.machineStep;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Драбини збірних ваг                                                 */
  /* ------------------------------------------------------------------ */
  /*
   * Штанга рахується динамічним програмуванням по множині досяжних сум,
   * а не перебором комбінацій. Перебір — це добуток (пар + 1) по всіх
   * номіналах: шість номіналів по десять пар дають 1,7 мільйона
   * варіантів і підвішений браузер. Множина сум обмежена стелею 500 кг
   * і кроком 0,25, тобто щонайбільше двома тисячами станів, скільки б
   * млинців у залі не лежало.
   */
  function barbellLadder(gym) {
    const g = gym || {};
    const bar = g.bar;
    let sums = { 0: 1 };
    (g.plates || []).forEach(function (p) {
      const add = p.kg * 2;                                  // пара, не штука
      const next = Object.assign({}, sums);
      Object.keys(sums).forEach(function (k) {
        const base = Number(k);
        for (let i = 1; i <= p.pairs; i++) {
          const v = Math.round((base + add * i) * 100) / 100;
          if (bar + v > MAX_KG) break;
          next[v] = 1;
        }
      });
      sums = next;
    });
    return Object.keys(sums)
      .map(function (k) { return Math.round((bar + Number(k)) * 100) / 100; })
      .sort(function (a, b) { return a - b; });
  }

  function dumbbellLadder(gym) {
    const d = (gym || {}).dumbbells;
    const out = [];
    for (let w = d.from; w <= d.to + 1e-9; w += d.step) {
      out.push(Math.round(w * 100) / 100);
      if (out.length > 400) break;                           // запобіжник
    }
    return out;
  }

  /**
   * Усі ваги, які реально можна поставити, від найлегшої до найважчої.
   * null — профіль про цей снаряд нічого не знає.
   */
  function ladder(kind, gym) {
    if (!knows(kind, gym)) return null;
    if (kind === 'barbell') return barbellLadder(gym);
    if (kind === 'dumbbell') return dumbbellLadder(gym);
    /* Тренажер — нескінченна драбина кратних кроку; масивом її не
       повертаємо, бо стеки бувають різні, а вигадати стелю означало б
       заборонити вагу, яка в залі є. */
    return null;
  }

  /** Крок старого правила: за самою вагою, бо снаряд невідомий */
  function fallbackStep(kg) {
    const w = num(kg);
    return (w !== null && w >= HEAVY_FROM) ? plateStep() : STEP_LIGHT;
  }

  /**
   * Найближча вага, яку реально зібрати.
   *
   * На рівній відстані береться ЛЕГША: помилка в бік легшого коштує
   * одного зайвого повторення, у бік важчого — провалений підхід.
   *
   * @returns {?number} null, якщо вага — не число
   */
  function achievable(kg, kind, gym) {
    const w = num(kg);
    if (w === null || w < 0) return null;

    const list = ladder(kind, gym);
    if (list && list.length) {
      let best = list[0];
      for (let i = 1; i < list.length; i++) {
        /* Строго «менше»: рівність лишає попередній, тобто легший. */
        if (Math.abs(list[i] - w) < Math.abs(best - w)) best = list[i];
      }
      return best;
    }

    const step = (kind === 'machine' && (gym || {}).machineStep)
      ? gym.machineStep : fallbackStep(w);
    return Math.max(0, Math.round(w / step) * step);
  }

  /** Наступна збірна вага вгору; null — важчої немає */
  function nextUp(kg, kind, gym) {
    const w = num(kg);
    if (w === null) return null;
    const list = ladder(kind, gym);
    if (list && list.length) {
      for (let i = 0; i < list.length; i++) {
        if (list[i] > w + 1e-9) return list[i];
      }
      return null;
    }
    const step = (kind === 'machine' && (gym || {}).machineStep)
      ? gym.machineStep : fallbackStep(w);
    const up = Math.floor(w / step) * step + step;
    return up > MAX_KG ? null : Math.round(up * 100) / 100;
  }

  /** Попередня збірна вага вниз; null — легшої немає */
  function nextDown(kg, kind, gym) {
    const w = num(kg);
    if (w === null) return null;
    const list = ladder(kind, gym);
    if (list && list.length) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] < w - 1e-9) return list[i];
      }
      return null;
    }
    const step = (kind === 'machine' && (gym || {}).machineStep)
      ? gym.machineStep : fallbackStep(w);
    const down = Math.ceil(w / step) * step - step;
    return down < 0 ? null : Math.round(down * 100) / 100;
  }

  /**
   * Крок біля цієї ваги — різниця до наступної збірної.
   * Саме це число має показувати інтерфейс замість вічних 2,5.
   */
  function stepFor(kg, kind, gym) {
    const up = nextUp(kg, kind, gym);
    const w = num(kg);
    if (up !== null && w !== null) return Math.round((up - w) * 100) / 100;
    const down = nextDown(kg, kind, gym);
    if (down !== null && w !== null) return Math.round((w - down) * 100) / 100;
    return fallbackStep(kg);
  }

  /* ------------------------------------------------------------------ */
  /* Вид снаряда за назвою вправи                                        */
  /* ------------------------------------------------------------------ */
  /*
   * Назви вправ у цьому застосунку описові й українські — «Жим штанги
   * під нахилом у Сміті», «Махи з гантелями сидячи», «Тяга верхнього
   * блоку». Снаряд у них здебільшого названий прямо, і це найдешевший
   * спосіб дізнатись його, не змушуючи людину розмічати сорок вправ.
   *
   * Коли назва мовчить — 'other', і працює старе правило. Вигадати
   * снаряд гірше, ніж не знати його: вигадка тихо змінить числа, а
   * «не знаю» лишить їх такими, якими вони були.
   */
  const RE_DUMBBELL = /гантел|гир[іяю]/i;
  const RE_BARBELL = /штанг|гриф|сміт|smith/i;
  /* Без \b навмисно: у JS межа слова — ASCII, і після кириличної літери
     вона не спрацьовує. Саме на цьому вже горіла міграція, яка чистила
     «Підводні» з планів. Тут достатньо кореня: «блок» у назвах вправ
     означає рівно одне. */
  const RE_MACHINE = /тренажер|кросовер|блок|хаммер|машин/i;

  function kindOf(name) {
    const s = typeof name === 'string' ? name : '';
    if (!s) return 'other';
    if (RE_DUMBBELL.test(s)) return 'dumbbell';
    if (RE_BARBELL.test(s)) return 'barbell';
    if (RE_MACHINE.test(s)) return 'machine';
    return 'other';
  }

  window.GymCore = {
    KINDS: KINDS,
    MAX_KG: MAX_KG,
    normGym: normGym,
    knows: knows,
    ladder: ladder,
    achievable: achievable,
    nextUp: nextUp,
    nextDown: nextDown,
    stepFor: stepFor,
    kindOf: kindOf
  };
})();
