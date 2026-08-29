/**
 * ============================================================================
 *  КАРКАС ПРОГРАМ ТРЕНУВАНЬ — ЦЕ ЄДИНИЙ ФАЙЛ, ЯКИЙ ТРЕБА РЕДАГУВАТИ
 * ============================================================================
 *
 * Структура спліту, підходи, повторення, RIR і відпочинок уже проставлені.
 * Порожні поля `name` — це слоти під конкретні вправи: впиши свої назви,
 * і сайт одразу почне показувати повноцінну програму.
 *
 * Формат вправи:
 *   {
 *     pattern: 'Присідальний рух',   // рухова модель — підказка, що сюди ставити
 *     name:    'Присідання зі штангою', // ← ТВОЯ вправа. Порожньо = слот не заповнений
 *     muscles: ['quads'],            // групи, на які зараховуються підходи (див. MUSCLES)
 *     sets:    3,                    // кількість робочих підходів
 *     reps:    '10',                 // повторення або діапазон
 *     rir:     '2',                  // запас повторень до відмови (Reps In Reserve)
 *     rest:    '3 хв',               // відпочинок між підходами
 *     note:    ''                    // необовʼязкова примітка
 *   }
 *
 * Поле `muscles` можна не вказувати — тоді групи візьмуться з PATTERN_MUSCLES
 * за назвою рухової моделі. Але якщо вправа нетипова, краще задати явно:
 * саме з цього поля рахується таблиця «Підходів на тиждень».
 *
 * Формат програми:
 *   id, name, family, days: { <кількість днів>: [ {title, focus, exercises[]} ] }
 *   daysSupported — які варіанти по днях є у цієї програми (мінімум 3)
 *   goals         — 'muscle' | 'strength' | 'recomp' | 'fatloss' (довідково, у підборі не бере участі)
 *   schedule      — розклад тижня на 7 днів: числа = індекси в days[N],
 *                   рядок 'rest' = день відпочинку. Розклад належить
 *                   ПРОГРАМІ, а не дню: той самий день Lower стоїть і в
 *                   «UL», і в «UL/PPL», але відпочинок після нього
 *                   у цих схемах різний.
 *   frequency     — скільки разів на тиждень тренується група мʼязів,
 *                   окремо для кожного варіанта по днях: { min, max, note }.
 *                   Це задано явно, а не рахується формулою, бо в несиметричних
 *                   splitʼах (наприклад PPL на 5 днів) різні групи мають
 *                   різну частоту, і будь-яка формула тут збрехала б.
 *
 * Цифри підходів/повторень/відпочинку спираються на джерела зі сторінки
 * «Дослідження» (обʼєм, частота, близькість до відмови, відпочинок).
 *
 * Групи мʼязів і бібліотека вправ винесені в js/exercises.js — цей файл
 * описує тільки СТРУКТУРУ програм, а не довідники.
 */

/** Спільні примітки, щоб не дублювати текст у кожній програмі */
const COMMON_NOTES = [
  'Підводні підходи в першій базовій вправі (2–3) не рахуються як робочі й не входять у тижневий обʼєм.',
  'RIR (Reps In Reserve) — скільки повторень ви могли б зробити понад виконані. RIR 2 = зупинились за 2 повторення до відмови.',
  'Відмова не обовʼязкова: приріст маси при роботі до відмови проти роботи близько до відмови відрізняється мінімально (ES 0,19, PMID 36334240), а втома і ризик травми — суттєво.',
  'Повторення задані за розміром групи: великі мʼязи (груди, спина, квадрицепс, біцепс стегна, сідниці) — 6–8 за підхід, малі — 8–10.',
  'Робочі ваги не задані навмисно: їх ставите під себе в редакторі плану. Орієнтир — вага, з якою верхня межа повторень дається на RIR 2.',
  'Записуйте вагу й повторення щотренування. Якщо 2–3 тижні поспіль немає руху ні у вазі, ні в повтореннях — знизьте робочу вагу на 10% і зайдіть наново.'
];

/*
 * Подвійна прогресія. Ваги не додаються щотренування — це працює лише
 * в перші місяці новачка. Спершу росте кількість повторень у межах діапазону,
 * і лише коли верхня межа взята в УСІХ підходах, росте вага. На вправу це
 * зазвичай виходить раз на 2–3 тижні.
 *
 * Крок ваги — величина ВІДНОСНА. +2,5 кг до жиму на 60 кг це 4%, а до
 * присідання на 140 кг — 1,8%, тобто менше за коливання самопочуття між днями.
 * Тому на низ тіла крок більший. Плюс суто механічне: +2,5 кг на штангу
 * вимагає млинців по 1,25 кг, яких у багатьох залах просто немає.
 *
 * Це практична конвенція, а не висновок дослідження: робіт, які порівнювали б
 * саме РОЗМІР кроку ваги, у PubMed немає. Крок можна міняти під себе.
 */
const PROGRESSION_DOUBLE =
  'Подвійна прогресія. Вага стоїть на місці, доки не зробите верхню межу повторень у ВСІХ робочих підходах ' +
  'на RIR 2. Тільки тоді додаєте вагу й повертаєтесь до нижньої межі діапазону. ' +
  'На одну вправу це виходить приблизно раз на 2–3 тижні — додавати вагу щотренування нереально ' +
  'ні для кого, крім новачка в перші місяці. ' +
  'Крок: близько 2–5% робочої ваги, округлені до наявних млинців. На практиці це +2,5 кг на верх тіла ' +
  'і +5 кг на низ — не тому що ноги «сильніші», а тому що там більші абсолютні ваги: ' +
  '+2,5 кг до жиму 60 кг це 4%, а до присідання 140 кг — лише 1,8%. ' +
  'Крок ваги — практична конвенція, не висновок дослідження: робіт, які порівнювали б саме розмір кроку, немає.';



/* ============================================================================
   РОЗМИНКА Й ЗАМИНКА — СПІЛЬНІ ДЛЯ ВСІХ ПЛАНІВ
   ============================================================================
   Задані один раз і показуються в кожній програмі: до розкладу тижня
   і після нього.

   ВАЖЛИВО: ці вправи НЕ мають полів `sets` і `muscles`, тому не потрапляють
   у таблицю тижневого обʼєму. Розминка — це підготовка, а не робочий обʼєм;
   якби вона рахувалась, цифри по групах були б завищені.
   ========================================================================= */

/*
 * БЕЗ ЦИФР — свідомо.
 *
 * Раніше тут стояли повторення й хвилини («8 повторень», «1 хв»), список
 * був нумерованим, а в заголовку висів лічильник вправ. Разом виходило
 * три різні набори чисел там, де вони нічого не вирішують: розминка робиться
 * до відчуття, а не до заданого числа, і рахувати її підходи немає сенсу —
 * у тижневий обʼєм вона все одно не входить.
 *
 * Якісні уточнення лишились: вони кажуть ЯК робити, а не СКІЛЬКИ.
 */
const WARMUP = [
  { name: 'Махи з гантелями',                     detail: 'легкі, вперед і назад' },
  { name: 'Розминка плечей з резинкою',           detail: 'на кожне плече' },
  { name: 'Махи з резинкою в руках',              detail: '' },
  { name: 'Розтягування резинки на груди',        detail: '' },
  { name: 'Місток на ролі',                       detail: 'рол під лопатки, лягти й полежати' },
  { name: '«Нитка в голку»',                      detail: 'на кожну сторону' },
  { name: 'Лопатки вгору-вниз стоячи',            detail: 'у положенні планки, стоячи — не на колінах' },
  { name: 'Запригування на степ',                 detail: 'на кожну ногу' },
  { name: 'Тяга верхнього блоку зворотним хватом', detail: 'легка вага' }
];

const COOLDOWN = [
  { name: 'Розтяжка',            detail: 'на вибір' },
  { name: 'Вис на турніку',      detail: '' },
  { name: 'Полежати на ролику',  detail: '' },
  { name: 'Розкататися на ролику', detail: '' }
];

window.WARMUP = WARMUP;
window.COOLDOWN = COOLDOWN;


/* ============================================================================
   UL/PPL — реальна програма на 5 днів
   ============================================================================
   Порядок тижня: Upper / Lower / відпочинок / Push / Pull / Legs.

   Дні Push, Pull і Legs повністю збігаються з програмою PPL, тому беруться
   тими самими обʼєктами — дублювати списки не можна, інакше при правці
   довелося б синхронізувати дві копії руками.

   Поле `circuit` позначає кругову частину: вправи з однаковим номером
   виконуються підряд без відпочинку, потрібна кількість кіл = кількості
   підходів. Для обʼєму це звичайні робочі підходи.
   ========================================================================= */

const UL_UPPER = {
  title: 'Upper', focus: 'Верх тіла повністю',
  exercises: [
    { pattern: 'Горизонтальний жим', name: 'Жим у тренажері',                 muscles: ['chest'],      sets: 2, reps: '6–8',  weight: null,   rir: '2', rest: '2–3 хв', note: 'Підводні: 1–2 підходи × 6' },
    { pattern: 'Вертикальна тяга',   name: 'Підтягування з вагою',            muscles: ['back'],       sets: 2, reps: '6–8',  weight: null,   rir: '2', rest: '2–3 хв', note: 'З додатковою вагою на поясі' },
    { pattern: 'Горизонтальний жим', name: 'Жим штанги під нахилом у Сміті',  muscles: ['chest'],      sets: 3, reps: '6–8',  weight: null,   rir: '2', rest: '2–3 хв', note: 'Підводні: 1–2 підходи × 6' },
    { pattern: 'Вертикальна тяга',   name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
    { pattern: 'Вертикальний жим',   name: 'Жим на плечі у Сміті',            muscles: ['frontDelts'], sets: 3, reps: '8–10',  weight: null,   rir: '2', rest: '2–3 хв', note: '' },
    { pattern: 'Горизонтальна тяга', name: 'Тяга з упором',                   muscles: ['back'],       sets: 2, reps: '6–8',  weight: null, rir: '2', rest: '2 хв',   note: '' },
    { pattern: 'Бічна дельта',       name: 'Відведення рук у кросовері',      muscles: ['sideDelts'],  sets: 2, reps: '8–10',  weight: null,   rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Трапеції / шраги',   name: 'Шраги у Сміті',                   muscles: ['traps'],      sets: 4, reps: '8–10',  weight: null,   rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Бічна дельта',       name: 'Махи з гантелями сидячи',         muscles: ['sideDelts'],  sets: 2, reps: '8–10',  weight: null,   rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Задня дельта',       name: 'Задні дельти у тренажері',        muscles: ['rearDelts'],  sets: 4, reps: '8–10',  weight: null,   rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Трицепс',            name: 'Французький жим у кросовері',     muscles: ['triceps'],    sets: 2, reps: '8–10',  weight: null,   rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Біцепс',             name: 'Біцепс у кросовері',              muscles: ['biceps'],     sets: 2, reps: '8–10', weight: null,   rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Трицепс',            name: 'Французький жим у Сміті',         muscles: ['triceps'],    sets: 2, reps: '8–10',  weight: null,   rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Біцепс',             name: 'Біцепс у тренажері',              muscles: ['biceps'],     sets: 2, reps: '8–10',  weight: null,   rir: '1', rest: '90 с',   note: '' },

    /* Кругова частина: 3 кола підряд */
    { circuit: 1, pattern: 'Литки',              name: 'Підйом на ікри у Сміті стоячи',  muscles: ['calves'],   sets: 3, reps: '8–10', weight: null, rir: '1', rest: '—', note: '' },
    { circuit: 1, pattern: 'Шия',                name: 'Розгинання на шию',              muscles: ['neck'],     sets: 3, reps: '8–10', weight: null,  rir: '2', rest: '—', note: '' },
    { circuit: 1, pattern: 'Шия',                name: 'Згинання на шию',                muscles: ['neck'],     sets: 3, reps: '8–10', weight: null,  rir: '2', rest: '—', note: '' },
    { circuit: 1, pattern: 'Згинання запʼястя', name: 'Згинання запʼястя у кросовері',  muscles: ['wristFlex'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '—', note: '' },
    { circuit: 1, pattern: 'Розгинання запʼястя', name: 'Розгинання запʼястя з гантеллю', muscles: ['wristExt'], sets: 3, reps: '8–10', weight: null,  rir: '1', rest: '—', note: '' },
    { circuit: 1, pattern: 'Кор',                name: 'Прес у кросовері',               muscles: ['abs'],      sets: 3, reps: '8–10', weight: null, rir: '1', rest: '—', note: '' }
  ]
};

const UL_LOWER = {
  title: 'Lower', focus: 'Низ тіла повністю',
  exercises: [
    { pattern: 'Присідальний рух',      name: 'Присідання зі штангою',               muscles: ['quads'],                   sets: 3, reps: '6–8', weight: null, rir: '2', rest: '3 хв',   note: 'Підводні: 1–2 підходи × 6' },
    { pattern: 'Тазостегновий шарнір',  name: 'Румунська тяга',                      muscles: ['hamstrings', 'glutes'],    sets: 3, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: 'Підводні: 1–2 підходи × 6' },
    { pattern: 'Односторонній рух ніг', name: 'Випади у Сміті на сідниці',           muscles: ['glutes'],                  sets: 3, reps: '6–8', weight: null, rir: '2', rest: '2 хв',   note: '' },
    { pattern: 'Розгинання гомілки',    name: 'Розгинання ніг',                      muscles: ['quads'],                   sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Згинання гомілки',      name: 'Згинання ніг сидячи',                        muscles: ['hamstrings'],              sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Литки',                 name: 'Підйом на ікри у Сміті стоячи',       muscles: ['calves'],                  sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Привідні / відвідні',   name: 'Зведення / розведення ніг у тренажері', muscles: ['adductors', 'abductors'], sets: 4, reps: '8–10', weight: null, rir: '1', rest: '60 с',   note: '4 підходи на зведення + 4 на розведення' },
    { pattern: 'Брахіорадіаліс',    name: 'Зворотний підйом у кросовері на передпліччя', muscles: ['brachiorad'],        sets: 4, reps: '8–10',  weight: null, rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Кор',                   name: 'Прес у кросовері',                    muscles: ['abs'],                     sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с',   note: '' }
  ]
};

/* ============================================================================
   PPL — реальна програма
   ============================================================================
   Дні описані один раз і в шестиденному варіанті просто повторюються:
   Push / Pull / Legs / Push / Pull / Legs. Дублювати списки вправ не можна —
   інакше при правці довелося б синхронізувати дві копії руками.
   ========================================================================= */

const PPL_PUSH = {
  title: 'Push', focus: 'Груди, дельти, трицепс',
  exercises: [
    { pattern: 'Горизонтальний жим',   name: 'Жим у тренажері',                    muscles: ['chest'],      sets: 2, reps: '6–8',  rir: '2', rest: '2–3 хв', note: '' },
    { pattern: 'Горизонтальний жим',   name: 'Жим штанги під нахилом у Сміті',     muscles: ['chest'],      sets: 3, reps: '6–8',  rir: '2', rest: '2–3 хв', note: '' },
    { pattern: 'Вертикальний жим',     name: 'Жим на плечі у Сміті',               muscles: ['frontDelts'], sets: 3, reps: '8–10',  rir: '2', rest: '2–3 хв', note: '' },
    { pattern: 'Бічна дельта',         name: 'Відведення рук у кросовері',         muscles: ['sideDelts'],  sets: 2, reps: '8–10',  rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Бічна дельта',         name: 'Махи з гантелями сидячи',            muscles: ['sideDelts'],  sets: 2, reps: '8–10',  rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Трицепс',              name: 'Французький жим у кросовері',        muscles: ['triceps'],    sets: 2, reps: '8–10',  rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Трицепс',              name: 'Французький жим у Сміті',            muscles: ['triceps'],    sets: 2, reps: '8–10',  rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Згинання запʼястя',   name: 'Згинання запʼястя у кросовері',      muscles: ['wristFlex'],   sets: 3, reps: '8–10', rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Розгинання запʼястя',   name: 'Розгинання запʼястя з гантеллю',     muscles: ['wristExt'],   sets: 3, reps: '8–10', rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Кор',                  name: 'Прес у кросовері',                   muscles: ['abs'],        sets: 2, reps: '8–10', rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Литки',                name: 'Підйом на ікри у Сміті стоячи',      muscles: ['calves'],     sets: 2, reps: '8–10', rir: '1', rest: '60 с',   note: '' }
  ]
};

const PPL_PULL = {
  title: 'Pull', focus: 'Спина, задні дельти, біцепс, шия',
  exercises: [
    { pattern: 'Вертикальна тяга',     name: 'Підтягування з вагою',               muscles: ['back'],       sets: 2, reps: '6–8',  rir: '2', rest: '2–3 хв', note: '' },
    { pattern: 'Вертикальна тяга',     name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'],      sets: 2, reps: '6–8',  rir: '2', rest: '2 хв',   note: '' },
    { pattern: 'Горизонтальна тяга',   name: 'Тяга з упором',                      muscles: ['back'],       sets: 2, reps: '6–8',  rir: '2', rest: '2 хв',   note: '' },
    { pattern: 'Біцепс',               name: 'Біцепс у кросовері',                 muscles: ['biceps'],     sets: 2, reps: '8–10', rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Біцепс',               name: 'Біцепс у тренажері',                 muscles: ['biceps'],     sets: 2, reps: '8–10',  rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Трапеції / шраги',     name: 'Шраги у Сміті',                      muscles: ['traps'],      sets: 4, reps: '8–10',  rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Задня дельта',         name: 'Задні дельти у тренажері',           muscles: ['rearDelts'],  sets: 4, reps: '8–10',  rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Шия',                  name: 'Розгинання на шию',                  muscles: ['neck'],       sets: 3, reps: '8–10', rir: '2', rest: '60 с',   note: '' },
    { pattern: 'Шия',                  name: 'Згинання на шию',                    muscles: ['neck'],       sets: 3, reps: '8–10', rir: '2', rest: '60 с',   note: '' },
    { pattern: 'Згинання запʼястя',   name: 'Згинання запʼястя у кросовері',      muscles: ['wristFlex'],   sets: 2, reps: '8–10', rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Розгинання запʼястя',   name: 'Розгинання запʼястя з гантеллю',     muscles: ['wristExt'],   sets: 2, reps: '8–10', rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Кор',                  name: 'Прес у кросовері',                   muscles: ['abs'],        sets: 2, reps: '8–10', rir: '1', rest: '60 с',   note: '' }
  ]
};

const PPL_LEGS = {
  title: 'Legs', focus: 'Ноги повністю, передпліччя, прес',
  exercises: [
    { pattern: 'Присідальний рух',     name: 'Присідання зі штангою',              muscles: ['quads'],                   sets: 3, reps: '6–8', rir: '2', rest: '3 хв',   note: '' },
    { pattern: 'Тазостегновий шарнір', name: 'Румунська тяга',                     muscles: ['hamstrings', 'glutes'],    sets: 3, reps: '6–8', rir: '2', rest: '2–3 хв', note: 'Підходи зараховуються і біцепсу стегна, і сідницям' },
    { pattern: 'Односторонній рух ніг', name: 'Випади у Сміті на сідниці',         muscles: ['glutes'],                  sets: 3, reps: '6–8', rir: '2', rest: '2 хв',   note: '' },
    { pattern: 'Розгинання гомілки',   name: 'Розгинання ніг',                     muscles: ['quads'],                   sets: 3, reps: '6–8', rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Згинання гомілки',     name: 'Згинання ніг сидячи',                       muscles: ['hamstrings'],              sets: 3, reps: '6–8', rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Литки',                name: 'Підйом на ікри у Сміті стоячи',      muscles: ['calves'],                  sets: 4, reps: '8–10', rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Привідні / відвідні',  name: 'Зведення / розведення ніг у тренажері', muscles: ['adductors', 'abductors'], sets: 4, reps: '8–10', rir: '1', rest: '60 с',  note: '4 підходи на зведення + 4 на розведення' },
    { pattern: 'Брахіорадіаліс',   name: 'Зворотний підйом у кросовері на передпліччя', muscles: ['brachiorad'],       sets: 4, reps: '8–10',  rir: '1', rest: '60 с',   note: '' },
    { pattern: 'Кор',                  name: 'Прес у кросовері',                   muscles: ['abs'],                     sets: 2, reps: '8–10', rir: '1', rest: '60 с',   note: '' }
  ]
};

/* ============================================================================
   ЖІНОЧИЙ ПЛАН — 4 дні, Push / Pull двічі за тиждень
   ============================================================================
   Порядок тижня: Push / Pull / відпочинок / Push / Pull / два дні відпочинку —
   той самий каркас, що в Upper/Lower.

   Дні описані ОДИН раз і використовуються двічі (див. days нижче): це та
   сама економія, що в UL — правка в одному місці змінює обидва входження,
   і копії не розходяться.

   Акценти проти чоловічих схем: більше роботи на сідниці й біцепс стегна,
   уся база — у тренажерах і Сміті. Обʼєм рахується тим самим правилом, що
   й скрізь (підходи йдуть у ПЕРШУ групу в muscles, js/exercises.js).
   ========================================================================= */

const W_PUSH = {
  title: 'Push', focus: 'Квадрицепс, сідниці, груди, плечі, трицепс',
  exercises: [
    { pattern: 'Розгинання гомілки',    name: 'Розгинання ніг',                     muscles: ['quads'],      sets: 3, reps: '10–12', weight: null, rir: '2', rest: '90 с',   note: '' },
    { pattern: 'Присідальний рух',      name: 'Жим ногами',                         muscles: ['quads'],      sets: 3, reps: '10–12', weight: null, rir: '2', rest: '2–3 хв', note: '' },
    { pattern: 'Односторонній рух ніг', name: 'Випади у Сміті на сідниці',          muscles: ['glutes'],     sets: 3, reps: '10–12', weight: null, rir: '2', rest: '2 хв',   note: '' },
    { pattern: 'Горизонтальний жим',    name: 'Жим у тренажері',                    muscles: ['chest'],      sets: 3, reps: '10–12', weight: null, rir: '2', rest: '2 хв',   note: '' },
    { pattern: 'Вертикальний жим',      name: 'Жим на плечі в тренажері',           muscles: ['frontDelts'], sets: 3, reps: '10–12', weight: null, rir: '2', rest: '2 хв',   note: '' },
    { pattern: 'Бічна дельта',          name: 'Відведення рук у кросовері',         muscles: ['sideDelts'],  sets: 3, reps: '10–12', weight: null, rir: '1', rest: '90 с',   note: 'По одній руці' },
    { pattern: 'Трицепс',               name: 'Розгинання в кросовері',             muscles: ['triceps'],    sets: 3, reps: '10–12', weight: null, rir: '1', rest: '90 с',   note: '' },
    { pattern: 'Литки',                 name: 'Підйом на ікри в тренажері стоячи',  muscles: ['calves'],     sets: 2, reps: '10–12', weight: null, rir: '1', rest: '60 с',   note: '' }
  ]
};

const W_PULL = {
  title: 'Pull', focus: 'Сідниці, біцепс стегна, спина, задня дельта, біцепс',
  exercises: [
    { pattern: 'Тазостегновий шарнір', name: 'Гіперекстензія на сідниці',          muscles: ['glutes', 'hamstrings'], sets: 1, reps: '10–12', weight: null, rir: '2', rest: '90 с', note: 'Розминочний підхід перед мостом' },
    { pattern: 'Тазостегновий шарнір', name: 'Ягодичний міст у тренажері',         muscles: ['glutes'],               sets: 3, reps: '10–12', weight: null, rir: '2', rest: '2 хв', note: '' },
    { pattern: 'Тазостегновий шарнір', name: 'Румунська тяга',                     muscles: ['hamstrings', 'glutes'], sets: 3, reps: '10–12', weight: null, rir: '2', rest: '2–3 хв', note: '' },
    { pattern: 'Вертикальна тяга',     name: 'Тяга верхнього блоку звичайним хватом', muscles: ['back'],              sets: 3, reps: '10–12', weight: null, rir: '2', rest: '2 хв', note: '' },
    { pattern: 'Горизонтальна тяга',   name: 'Горизонтальна тяга в тренажері',     muscles: ['back'],                 sets: 3, reps: '10–12', weight: null, rir: '2', rest: '2 хв', note: '' },
    { pattern: 'Трапеції / шраги',     name: 'Шраги з гантелями',                  muscles: ['traps'],                sets: 2, reps: '10–12', weight: null, rir: '1', rest: '90 с', note: '' },
    { pattern: 'Задня дельта',         name: 'Задні дельти у тренажері',           muscles: ['rearDelts'],            sets: 2, reps: '10–12', weight: null, rir: '1', rest: '60 с', note: '' },
    { pattern: 'Згинання гомілки',     name: 'Згинання ніг сидячи',                muscles: ['hamstrings'],           sets: 3, reps: '10–12', weight: null, rir: '1', rest: '90 с', note: '' },
    { pattern: 'Біцепс',               name: 'Біцепс у тренажері',                 muscles: ['biceps'],               sets: 3, reps: '10–12', weight: null, rir: '1', rest: '90 с', note: '' },
    { pattern: 'Литки',                name: 'Підйом на ікри в тренажері стоячи',  muscles: ['calves'],               sets: 2, reps: '10–12', weight: null, rir: '1', rest: '60 с', note: '' }
  ]
};

/* ========================================================================== */

window.PROGRAMS = [

  /* ------------------------------------------------------------------ */
  /* 1. FULL BODY — реальна програма на 3–6 днів                         */
  /* ------------------------------------------------------------------ */
  /*
     УВАГА: триденний варіант має ІНШИЙ тижневий обʼєм, ніж решта.

       3 дні  → 102 підходи (34 за сесію)
       4–5 днів → 120 підходів

     Це свідомо: на трьох днях 120 підходів давали б 40 за сесію,
     а це близько 100 хвилин у залі. Триденний варіант лишено полегшеним.

     Обʼєм по групах на 4–5 днях:
       Груди 10 · Спина 12 · Квадрицепси 12 · Біцепси стегна 12
       Передня дельта 6 · Середня дельта 8 · Задні дельти 12 · Трапеція 12
       Біцепс 8 · Трицепс 8 · Прес 12 · Ікри 8          = 120 підходів

     На трьох днях менші: середня дельта 6, задні дельти 9, трапеція 9,
     груди 9, біцепс 6, трицепс 6, прес 9, ікри 6.

     ЧОМУ 120 ДЛЯ 4–5 ДНІВ. Щоб обʼєм ділився націло і на 4, і на 5 днів,
     він має бути кратним НСК(4,5) = 20. За 120 виходить рівно
     30 і 24 підходи на день — усі дні однакові за навантаженням.

     Рівна сума ПО ДНЮ досяжна, а рівна кількість підходів на кожну групу
     щодня — ні: груди 10 підходів на 4 дні дали б 2,5 за день.

     Груди мають дві вправи, тому на 4–5 днях їх 10 підходів поділені 7 + 3.
  */
  {
    id: 'fullbody',
    sex: 'male',
    family: 'Full Body',
    name: 'Full Body',
    daysSupported: [3, 4, 5],
    goals: ['muscle', 'strength', 'recomp', 'fatloss'],
    schedule: {
      3: [0, 'rest', 1, 'rest', 2, 'rest', 'rest'],
      4: [0, 1, 'rest', 2, 3, 'rest', 'rest'],
      5: [0, 1, 2, 3, 4, 'rest', 'rest']
    },
    frequency: {
      3: { min: 3, max: 3, note: 'усі групи 3×' },
      4: { min: 4, max: 4, note: 'усі групи 4×' },
      5: { min: 5, max: 5, note: 'усі групи 5×' }
    },
    progression: PROGRESSION_DOUBLE,
    notes: COMMON_NOTES.concat([
      'Тижневий обʼєм: 102 підходи на трьох днях, 120 на чотирьох і пʼяти.',
      'У межах варіанта всі дні мають однакову кількість підходів: 34 / 30 / 24.',
      'Якщо вправа в якийсь день відсутня — її підходи цього тижня вже стоять в інших днях.',
      'Розклад тижня: 3 дні — через день, 4 дні — два підряд і відпочинок, 5 днів — пʼять підряд.'
    ]),

    days: {
      3: [
        {
          title: 'День A', focus: 'Усе тіло · 34 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 4, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 4, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 2, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День B', focus: 'Усе тіло · 34 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 4, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 4, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 2, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День C', focus: 'Усе тіло · 34 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 4, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 4, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 2, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        }
      ],
      4: [
        {
          title: 'День A', focus: 'Усе тіло · 30 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 1, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День B', focus: 'Усе тіло · 30 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 1, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День C', focus: 'Усе тіло · 30 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 2, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День D', focus: 'Усе тіло · 30 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 2, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        }
      ],
      5: [
        {
          title: 'День A', focus: 'Усе тіло · 24 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 2, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 1, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 1, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 1, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 1, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День B', focus: 'Усе тіло · 24 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 2, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 2, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 2, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 2, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 1, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 1, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 1, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День C', focus: 'Усе тіло · 24 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 2, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 1, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 1, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День D', focus: 'Усе тіло · 24 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 2, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 1, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 3, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 1, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        },
        {
          title: 'День E', focus: 'Усе тіло · 24 підходів',
          exercises: [
            { pattern: 'Горизонтальний жим', name: 'Жим у тренажері', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Горизонтальний жим (варіація)', name: 'Жим штанги під нахилом', muscles: ['chest'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2–3 хв', note: '' },
            { pattern: 'Вертикальна тяга', name: 'Тяга верхнього блоку вузьким паралельним хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Вертикальна тяга (варіація)', name: 'Тяга верхнього блоку широким хватом', muscles: ['back'], sets: 1, reps: '6–8', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Розгинання гомілки', name: 'Розгинання ніг', muscles: ['quads'], sets: 2, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Згинання гомілки', name: 'Згинання ніг сидячи', muscles: ['hamstrings'], sets: 3, reps: '6–8', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Вертикальний жим', name: 'Жим гантелей сидячи', muscles: ['frontDelts'], sets: 1, reps: '8–10', weight: null, rir: '2', rest: '2 хв', note: '' },
            { pattern: 'Бічна дельта', name: 'Відведення рук у кросовері', muscles: ['sideDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Задня дельта', name: 'Задні дельти у тренажері', muscles: ['rearDelts'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трапеції / шраги', name: 'Шраги у Сміті', muscles: ['traps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '90 с', note: '' },
            { pattern: 'Біцепс', name: 'Біцепс у кросовері', muscles: ['biceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Трицепс', name: 'Розгинання в кросовері', muscles: ['triceps'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Кор', name: 'Прес у кросовері', muscles: ['abs'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' },
            { pattern: 'Литки', name: 'Підйом на ікри у Сміті стоячи', muscles: ['calves'], sets: 2, reps: '8–10', weight: null, rir: '1', rest: '60 с', note: '' }
          ]
        }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  /* 2. UPPER / LOWER — реальна програма на 4 дні                        */
  /* ------------------------------------------------------------------ */
  {
    id: 'upperlower',
    sex: 'male',
    family: 'Upper / Lower',
    name: 'UL',
    daysSupported: [4],
    goals: ['muscle', 'strength', 'recomp'],
    schedule: {
      4: [0, 1, 'rest', 2, 3, 'rest', 'rest']
    },
    frequency: {
      // Обидва дні йдуть двічі за тиждень, тому кожна група працює 2×
      4: { min: 2, max: 2, note: 'усі групи 2×' }
    },
    progression: PROGRESSION_DOUBLE,
    notes: COMMON_NOTES.concat([
      'Порядок тижня: Upper / Lower / відпочинок / Upper / Lower / два дні відпочинку.',
      'Останні шість вправ у день Upper виконуються по колу: три кола підряд, відпочинок тільки між колами.',
      'Дні описані один раз і використовуються двічі — правка в одному місці змінює обидва входження.'
    ]),

    days: {
      4: [UL_UPPER, UL_LOWER, UL_UPPER, UL_LOWER]
    }
  },

  /* ------------------------------------------------------------------ */
  /* 3. PUSH / PULL / LEGS — реальна програма                            */
  /* ------------------------------------------------------------------ */
  {
    id: 'ppl',
    sex: 'male',
    family: 'PPL',
    name: 'Push / Pull / Legs',
    daysSupported: [6],
    goals: ['muscle', 'recomp'],
    schedule: {
      6: [0, 1, 2, 3, 4, 5, 'rest']
    },
    frequency: {
      // Основні групи — двічі за тиждень; це і задає структуру спліту.
      // Прес трапляється в кожному дні (6×), ікри й передпліччя — 4×:
      // вони додані як дрібна робота, а не як окремі цільові дні.
      // У схеми ulppl таке застереження стояло, у ppl його бракувало.
      6: { min: 2, max: 6, note: 'основні групи 2×, прес до 6×' }
    },
    progression: PROGRESSION_DOUBLE,
    notes: COMMON_NOTES.concat([
      'Порядок тижня: Push / Pull / Legs / Push / Pull / Legs / відпочинок.'
    ]),

    days: {
      6: [PPL_PUSH, PPL_PULL, PPL_LEGS, PPL_PUSH, PPL_PULL, PPL_LEGS]
    }
  },

  /* ------------------------------------------------------------------ */
  /* 4. UL/PPL — реальна програма на 5 днів                              */
  /* ------------------------------------------------------------------ */
  {
    id: 'ulppl',
    sex: 'male',
    family: 'UL/PPL',
    name: 'UL/PPL',
    daysSupported: [5],
    goals: ['muscle', 'recomp'],
    schedule: {
      5: [0, 1, 'rest', 2, 3, 4, 'rest']
    },
    frequency: {
      // Частота спліту: кожна група мʼязів працює двічі за тиждень.
      // Прес, передпліччя й ікри технічно трапляються частіше, бо їх
      // додано як дрібну роботу в кілька днів, але структуру схеми
      // задають саме 2× — це і показуємо.
      5: { min: 2, max: 2, note: 'усі групи 2×' }
    },
    progression: PROGRESSION_DOUBLE,
    notes: COMMON_NOTES.concat([
      'Порядок тижня: Upper / Lower / відпочинок / Push / Pull / Legs / відпочинок.',
      'Останні шість вправ у день Upper виконуються по колу: три кола підряд, відпочинок тільки між колами.',
      'Ваги в днях Upper і Lower — фактичні робочі. У Push / Pull / Legs їх поки не задано.'
    ]),

    days: {
      5: [UL_UPPER, UL_LOWER, PPL_PUSH, PPL_PULL, PPL_LEGS]
    }
  },

  /* ------------------------------------------------------------------ */
  /* 5. ЖІНОЧИЙ ПЛАН — 4 дні                                             */
  /* ------------------------------------------------------------------ */
  /*
     Тижневий обʼєм (підходи йдуть у ПЕРШУ групу в muscles — те саме
     правило, що для решти схем; стелі з VOLUME_CAP у js/exercises.js):

       сідниці      14 / 14      квадрицепс    12 / 14
       спина        12 / 14      біцепс стегна 12 / 14
       ікри          8 / 12      груди          6 / 14
       передні д.    6 / 12      середні д.     6 / 12
       трицепс       6 / 12      біцепс         6 / 12
       трапеції      4 / 12      задні д.       4 / 12

     Разом 96 підходів за тиждень: 23 у кожному Push і 25 у кожному Pull.
     Дні навмисно нерівні — Pull несе румунську тягу, найважчу вправу
     плану, і саме він тягне біцепс стегна до 12 підходів.
     Сідниці стоять рівно на стелі — це навмисно, вони тут головна ціль.
  */
  {
    id: 'women4',
    sex: 'female',
    family: 'Жіночий',
    name: 'Жіночий план',
    daysSupported: [4],
    goals: ['muscle', 'recomp', 'fatloss'],
    schedule: {
      4: [0, 1, 'rest', 2, 3, 'rest', 'rest']
    },
    frequency: {
      // Обидва дні йдуть двічі за тиждень, тому кожна група працює 2×.
      4: { min: 2, max: 2, note: 'усі групи 2×' }
    },
    progression: PROGRESSION_DOUBLE,
    notes: COMMON_NOTES.concat([
      'Порядок тижня: Push / Pull / відпочинок / Push / Pull / два дні відпочинку.',
      'Акцент на сідниці й біцепс стегна: 14 і 12 підходів за тиждень.',
      'База — у тренажерах і Сміті; єдина вправа зі штангою — румунська тяга.',
      'Дні описані один раз і використовуються двічі — правка в одному місці змінює обидва входження.'
    ]),

    days: {
      4: [W_PUSH, W_PULL, W_PUSH, W_PULL]
    }
  }

];

/* ============================================================================
   ДОСТУП ДО СХЕМ ЗА СТАТТЮ — ЄДИНЕ ДЖЕРЕЛО ПРАВДИ
   ============================================================================
   Кожна схема має поле `sex`: 'male' або 'female'. Правило одне — людина
   бачить і може обрати ТІЛЬКИ схеми своєї статі.

   ЧОМУ ФУНКЦІЯ, А НЕ ФІЛЬТР У КОЖНОМУ МІСЦІ. Список схем збирається в
   кількох незалежних точках: сторінка «Плани тренувань» (js/programs.js —
   і сітка, і крок онбордингу), «Мій план», «Сьогодні» й «Тренування»
   (resolvePlan у js/workout-core.js), цикл періодизації. Якби фільтр
   стояв лише в розмітці, план чужої статі лишався б доступним прямим
   переходом, збереженим activePlan або старим станом у профілі. Тому
   перевірка тут одна, і всі точки питають саме її.

   СТАТЬ НЕВІДОМА (старий профіль до онбордингу, порожнє поле) — показуємо
   чоловічі схеми: це те, що ці профілі бачили досі, і мовчки забирати в
   них план не можна. Щойно стать зʼявиться, список відповідатиме їй.
   ========================================================================= */

/** Схема доступна цій статі? */
window.programAllowedFor = function (program, sex) {
  if (!program) return false;
  const want = (sex === 'female') ? 'female' : 'male';
  return (program.sex || 'male') === want;
};

/** Схеми, доступні цій статі. */
window.programsForSex = function (sex, list) {
  const all = Array.isArray(list) ? list : (window.PROGRAMS || []);
  return all.filter(function (p) { return window.programAllowedFor(p, sex); });
};
