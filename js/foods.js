/**
 * Довідник продуктів.
 *
 * ======================= ГОЛОВНЕ ПРО СИРЕ Й ГОТОВЕ =======================
 *
 * У 100 г ГОТОВОГО курячого філе білка більше, ніж у 100 г сирого.
 * Це не помилка ваг і не магія: при готуванні мʼясо втрачає воду.
 * Білок нікуди не дівається — він просто концентрується в меншій масі.
 *
 *   100 г сирого філе   → 22,5 г білка, 120 ккал
 *   лишається ~73 г готового, білок той самий 22,5 г
 *   отже на 100 г готового: 22,5 / 0,73 ≈ 30,8 г білка, ≈164 ккал
 *
 * Довідник USDA для смаженого/запеченого філе дає 31 г білка і 165 ккал —
 * тобто перерахунок через коефіцієнт виходу відтворює довідкові значення.
 *
 * З крупами й макаронами все дзеркально: вони воду НАБИРАЮТЬ, тому
 * на 100 г готових калорій менше, ніж на 100 г сухих, приблизно в 2–3 рази.
 *
 * Тому кожен продукт тут має:
 *   state  — у якому стані наведені числа: 'raw' (сире), 'dry' (сухе), 'ready'
 *   yield  — маса після приготування / маса до нього
 *            мʼясо  < 1 (втрачає воду), крупи > 1 (набирають), готове = 1
 *
 * Найточніше — зважувати В ОДНОМУ Й ТОМУ САМОМУ СТАНІ завжди. Зазвичай
 * зручніше сире/сухе: вихід залежить від того, як довго й на чому готуєш,
 * а суха вага не залежить ні від чого.
 *
 * ========================= ДОМОВЛЕНІСТЬ ПРО ВУГЛЕВОДИ =========================
 *
 * `c` — вуглеводи БЕЗ клітковини, `fiber` — окремо. Це європейська система
 * маркування: на пачці Barilla «вуглеводи 71 г, з них клітковина» рахуються
 * саме так. USDA рахує інакше — там клітковина ВХОДИТЬ у вуглеводи, тому
 * значення звідти тут перераховані: c = усі вуглеводи − клітковина.
 *
 * Навіщо ця морока: клітковина дає ~2 ккал/г, а не 4. Якщо не відняти її,
 * калорійність овочів і горіхів завищується на 20–25%.
 *
 * Перевірка: kcal ≈ p×4 + f×9 + c×4 + fiber×2
 *
 * ============================== ДЖЕРЕЛА ==============================
 *
 * УВАГА: на відміну від решти сайту, тут джерела НЕ з PubMed — і не можуть
 * ними бути. Склад продуктів беруть не з клінічних досліджень, а з таблиць
 * складу харчових продуктів і з етикеток виробника:
 *
 *   • USDA FoodData Central — мʼясо, риба, крупи, овочі, молочка
 *   • Етикетки виробника — Barilla (звірено з Open Food Facts)
 *
 * Точність тут принципово нижча за лабораторну. Етикетка в ЄС має законний
 * допуск (для білків і вуглеводів — до ±20% від заявленого), а реальний
 * шматок мʼяса відрізняється від середнього по базі через породу, годівлю
 * й жирність партії. Тому це орієнтир для планування, а не аптечні ваги.
 * ======================================================================
 */
(function () {
  'use strict';

  /** Групи для фільтра */
  const FOOD_GROUPS = [
    { id: 'protein', name: 'Білкове' },
    { id: 'carb',    name: 'Крупи й макарони' },
    { id: 'dairy',   name: 'Молочне' },
    { id: 'fat',     name: 'Жири й горіхи' },
    { id: 'veg',     name: 'Овочі' },
    { id: 'fruit',   name: 'Фрукти' },
    { id: 'drink',   name: 'Напої' },
    { id: 'sweet',   name: 'Солодке' },
    { id: 'other',   name: 'Інше' }
  ];

  /**
   * per100 — на 100 г продукту В СТАНІ `state`.
   * yield  — у скільки разів змінюється маса при приготуванні.
   * unit   — зручна побутова міра, якщо вона є.
   */
  const FOODS = [

    /* ---------------- Білкове ---------------- */
    { id:'chicken-breast', group:'protein', name:'Куряче філе (грудка)', alias:'курка кура куряча грудка', state:'raw', yield:0.73,
      per100:{ kcal:120, p:22.5, f:2.6, c:0 },
      note:'Класика мілпрепу. Готове важить ~73% від сирого — звідси «31 г білка» в довідниках.' },
    { id:'chicken-thigh', group:'protein', name:'Куряче стегно без шкіри', alias:'курка кура куряча', state:'raw', yield:0.73,
      per100:{ kcal:120, p:19.0, f:4.5, c:0 },
      note:'Смачніше й соковитіше за грудку, білка менше, жиру вдвічі більше.' },
    { id:'turkey-fillet', group:'protein', name:'Індиче філе', alias:'індичка індиче', state:'raw', yield:0.73,
      per100:{ kcal:114, p:24.0, f:1.7, c:0 } },
    { id:'beef-lean', group:'protein', name:'Яловичина, пісна частина', state:'raw', yield:0.75,
      per100:{ kcal:150, p:21.0, f:7.0, c:0 } },
    { id:'pork-tenderloin', group:'protein', name:'Свиняча вирізка', alias:'свинина свиняча', state:'raw', yield:0.75,
      per100:{ kcal:143, p:21.0, f:6.0, c:0 } },
    { id:'salmon', group:'protein', name:'Лосось', alias:'риба червона риба', state:'raw', yield:0.82,
      per100:{ kcal:208, p:20.0, f:13.0, c:0 },
      note:'Джерело омега-3. Жирність сильно залежить від того, дикий чи фермерський.' },
    { id:'hake', group:'protein', name:'Хек / мінтай', state:'raw', yield:0.80,
      per100:{ kcal:82, p:17.5, f:1.0, c:0 } },
    { id:'tuna-can', group:'protein', name:'Тунець консервований у власному соку', alias:'риба', state:'ready', yield:1,
      per100:{ kcal:116, p:26.0, f:1.0, c:0 },
      note:'Вага без рідини. В олії — додайте жир з етикетки.' },
    { id:'egg', group:'protein', name:'Яйце куряче, ціле', alias:'яйця яєць яєчня', state:'raw', yield:1,
      per100:{ kcal:143, p:12.6, f:9.5, c:0.7 },
      unit:{ label:'шт (С1, без шкаралупи)', grams:55 } },
    { id:'egg-white', group:'protein', name:'Яєчний білок', state:'raw', yield:1,
      per100:{ kcal:52, p:11.0, f:0.2, c:0.7 },
      unit:{ label:'білок з 1 яйця', grams:33 } },
    { id:'whey', group:'protein', name:'Сироватковий протеїн (концентрат)', state:'ready', yield:1,
      per100:{ kcal:380, p:75.0, f:6.0, c:8.0 },
      unit:{ label:'мірна ложка', grams:30 },
      note:'Числа сильно різняться між брендами — звір з етикеткою своєї банки.' },

    /* ---------------- Крупи й макарони ---------------- */
    { id:'barilla-classic', group:'carb', name:'Макарони Barilla, класичні (будь-який номер)', state:'dry', yield:2.3,
      per100:{ kcal:359, p:13.0, f:2.0, c:71.0, fiber:3.0 },
      note:'Усі класичні номери мають ОДНАКОВІ КБЖВ: це те саме тісто з твердої пшениці. Номер міняє форму й час варіння, не склад.' },
    { id:'barilla-integrale', group:'carb', name:'Макарони Barilla Integrale (цільнозернові)', state:'dry', yield:2.3,
      per100:{ kcal:347, p:13.0, f:2.5, c:64.0, fiber:8.0 },
      note:'Вуглеводів менше, клітковини втричі більше за класичні.' },
    { id:'rice-basmati', group:'carb', name:'Рис басматі', state:'dry', yield:2.9,
      per100:{ kcal:350, p:8.5, f:0.9, c:78.0, fiber:1.3 },
      note:'Набирає ~2,9× маси. 100 г сухого → близько 290 г готового.' },
    { id:'rice-white', group:'carb', name:'Рис довгозернистий білий', state:'dry', yield:2.9,
      per100:{ kcal:355, p:7.0, f:0.7, c:79.0, fiber:1.0 } },
    { id:'buckwheat', group:'carb', name:'Гречка, ядриця', state:'dry', yield:2.7,
      per100:{ kcal:343, p:13.0, f:3.4, c:62.0, fiber:10.0 } },
    { id:'oats', group:'carb', name:'Вівсяні пластівці', alias:'вівсянка овес геркулес каша', state:'dry', yield:2.8,
      per100:{ kcal:370, p:13.0, f:7.0, c:56.0, fiber:10.0 } },
    { id:'potato', group:'carb', name:'Картопля', state:'raw', yield:0.95,
      per100:{ kcal:77, p:2.0, f:0.1, c:14.8, fiber:2.2 } },
    { id:'bread-wholegrain', group:'carb', name:'Хліб цільнозерновий', state:'ready', yield:1,
      per100:{ kcal:250, p:9.0, f:3.0, c:39.0, fiber:6.0 },
      unit:{ label:'скибка', grams:35 } },
    { id:'pasta-lentil', group:'carb', name:'Паста з червоної сочевиці', state:'dry', yield:2.4,
      per100:{ kcal:335, p:26.0, f:1.7, c:50.0, fiber:7.6 },
      note:'Удвічі більше білка за пшеничну й утричі більше клітковини. Бренди різняться сильно: буває від 20 до 45 г білка на 100 г — звір із власною пачкою.' },
    { id:'panko', group:'carb', name:'Сухарі панірувальні панко', state:'dry', yield:1,
      per100:{ kcal:362, p:15.0, f:1.7, c:70.0, fiber:0.8 },
      note:'Жиру самі по собі майже не мають — його додає спосіб готування. В аерогрилі це кілька грамів спрею на всю партію.' },

    /* ---------------- Молочне ---------------- */
    { id:'cottage-5', group:'dairy', name:'Сир кисломолочний 5%', alias:'творог сирок кисломолочний', state:'ready', yield:1,
      per100:{ kcal:121, p:17.0, f:5.0, c:3.0 } },
    { id:'cottage-0', group:'dairy', name:'Сир кисломолочний знежирений', alias:'творог сирок кисломолочний', state:'ready', yield:1,
      per100:{ kcal:85, p:18.0, f:1.0, c:2.0 } },
    { id:'greek-yogurt', group:'dairy', name:'Грецький йогурт 2%', state:'ready', yield:1,
      per100:{ kcal:73, p:9.0, f:2.0, c:4.0 } },
    { id:'milk-25', group:'dairy', name:'Молоко 2,5%', state:'ready', yield:1,
      per100:{ kcal:52, p:2.9, f:2.5, c:4.7 },
      unit:{ label:'склянка 250 мл', grams:255 } },
    { id:'cheese-hard', group:'dairy', name:'Сир твердий', state:'ready', yield:1,
      per100:{ kcal:356, p:25.0, f:27.0, c:2.0 } },
    { id:'milk-0', group:'dairy', name:'Молоко знежирене (0,1%)', state:'ready', yield:1,
      per100:{ kcal:32, p:3.1, f:0.0, c:5.0 },
      unit:{ label:'склянка 250 мл', grams:255 } },
    { id:'cheddar', group:'dairy', name:'Чеддер', state:'ready', yield:1,
      per100:{ kcal:417, p:25.4, f:34.9, c:0.1 },
      note:'Жирніший за звичайний твердий сир: 35 г жиру на 100 г. У рецептах його беруть за смак, а не за білок.' },
    { id:'mozzarella', group:'dairy', name:'Моцарела', state:'ready', yield:1,
      per100:{ kcal:247, p:18.0, f:19.0, c:1.5 },
      note:'Дані для звичайної, не полегшеної. Нежирна версія дає приблизно на третину менше калорій — якщо берете саме її, поставте свої цифри.' },
    { id:'cheese-processed', group:'dairy', name:'Плавлений сир у скибочках', state:'ready', yield:1,
      per100:{ kcal:270, p:9.0, f:21.0, c:8.0 },
      unit:{ label:'скибка', grams:15 },
      note:'Білка вдвічі менше, ніж у твердому сирі, вуглеводів більше. Дані для звичайного; «легкі» версії помітно нижчі.' },

    /* ---------------- Жири й горіхи ---------------- */
    { id:'olive-oil', group:'fat', name:'Олія оливкова', state:'ready', yield:1,
      per100:{ kcal:884, p:0, f:100, c:0 },
      unit:{ label:'ст. ложка', grams:14 },
      note:'Найлегше недорахувати саме тут: ложка олії на сковорідку — це ~125 ккал.' },
    { id:'sunflower-oil', group:'fat', name:'Олія соняшникова', state:'ready', yield:1,
      per100:{ kcal:884, p:0, f:100, c:0 },
      unit:{ label:'ст. ложка', grams:14 } },
    { id:'peanut-butter', group:'fat', name:'Арахісова паста', state:'ready', yield:1,
      per100:{ kcal:588, p:25.0, f:50.0, c:14.0, fiber:6.0 },
      unit:{ label:'ст. ложка', grams:16 } },
    { id:'almonds', group:'fat', name:'Мигдаль', state:'ready', yield:1,
      per100:{ kcal:579, p:21.0, f:50.0, c:9.5, fiber:12.5 } },
    { id:'walnuts', group:'fat', name:'Волоські горіхи', state:'ready', yield:1,
      per100:{ kcal:654, p:15.0, f:65.0, c:7.3, fiber:6.7 } },
    { id:'avocado', group:'fat', name:'Авокадо', state:'ready', yield:1,
      per100:{ kcal:160, p:2.0, f:15.0, c:2.0, fiber:7.0 } },

    /* ---------------- Овочі ---------------- */
    { id:'broccoli', group:'veg', name:'Броколі', state:'raw', yield:1,
      per100:{ kcal:34, p:2.8, f:0.4, c:4.4, fiber:2.6 } },
    { id:'tomato', group:'veg', name:'Помідор', state:'raw', yield:1,
      per100:{ kcal:18, p:0.9, f:0.2, c:2.7, fiber:1.2 } },
    { id:'cucumber', group:'veg', name:'Огірок', state:'raw', yield:1,
      per100:{ kcal:15, p:0.7, f:0.1, c:3.1, fiber:0.5 } },
    { id:'onion', group:'veg', name:'Цибуля ріпчаста', state:'raw', yield:1,
      per100:{ kcal:40, p:1.1, f:0.1, c:7.3, fiber:1.7 } },
    { id:'carrot', group:'veg', name:'Морква', state:'raw', yield:1,
      per100:{ kcal:41, p:0.9, f:0.2, c:7.2, fiber:2.8 } },
    { id:'bell-pepper', group:'veg', name:'Перець солодкий', state:'raw', yield:1,
      per100:{ kcal:26, p:1.0, f:0.3, c:3.9, fiber:2.1 } },
    // Група fruit, а не veg: свіжий ананас лежить у фруктах, і через
    // розбіжність фільтр «Овочі» видавав ананас, а «Фрукти» його не знаходив.
    { id:'pineapple', group:'fruit', name:'Ананас консервований', state:'ready', yield:1,
      per100:{ kcal:60, p:0.4, f:0.1, c:14.2, fiber:0.8 },
      note:'Вага без сиропу. Часто йде в кисло-солодкі соуси.' },

    { id:'spinach', group:'veg', name:'Шпинат', state:'raw', yield:1,
      per100:{ kcal:23, p:2.9, f:0.4, c:1.4, fiber:2.2 } },
    { id:'cabbage', group:'veg', name:'Капуста білоголова', state:'raw', yield:1,
      per100:{ kcal:25, p:1.3, f:0.1, c:3.3, fiber:2.5 } },
    { id:'cauliflower', group:'veg', name:'Цвітна капуста', state:'raw', yield:1,
      per100:{ kcal:25, p:1.9, f:0.3, c:3.0, fiber:2.0 } },
    { id:'zucchini', group:'veg', name:'Кабачок', state:'raw', yield:1,
      per100:{ kcal:17, p:1.2, f:0.3, c:2.1, fiber:1.0 } },
    { id:'eggplant', group:'veg', name:'Баклажан', state:'raw', yield:1,
      per100:{ kcal:25, p:1.0, f:0.2, c:2.9, fiber:3.0 } },
    { id:'beetroot', group:'veg', name:'Буряк', state:'raw', yield:1,
      per100:{ kcal:43, p:1.6, f:0.2, c:6.8, fiber:2.8 } },
    { id:'pumpkin', group:'veg', name:'Гарбуз', state:'raw', yield:1,
      per100:{ kcal:26, p:1.0, f:0.1, c:6.0, fiber:0.5 } },
    { id:'lettuce', group:'veg', name:'Салат листовий', state:'raw', yield:1,
      per100:{ kcal:15, p:1.4, f:0.2, c:1.0, fiber:1.3 } },
    { id:'mushrooms', group:'veg', name:'Печериці', state:'raw', yield:1,
      per100:{ kcal:22, p:3.1, f:0.3, c:2.3, fiber:1.0 } },
    { id:'greenbeans', group:'veg', name:'Квасоля стручкова', state:'raw', yield:1,
      per100:{ kcal:31, p:1.8, f:0.1, c:4.3, fiber:2.7 } },
    { id:'peas', group:'veg', name:'Горошок зелений', state:'raw', yield:1,
      per100:{ kcal:81, p:5.4, f:0.4, c:9.2, fiber:5.7 } },
    // c було 13,0 при kcal 81 — число не сходилось із власною калорійністю.
    // USDA (canned whole kernel, drained): 19,4 в − 2,0 клітковини = 17,4 нетто.
    { id:'corn-can', group:'veg', name:'Кукурудза консервована', state:'ready', yield:1,
      per100:{ kcal:81, p:2.7, f:0.5, c:17.4, fiber:2.0 },
      note:'Вага без рідини.' },

    /* ---------------- Фрукти ---------------- */
    { id:'banana', group:'fruit', name:'Банан', state:'ready', yield:1,
      per100:{ kcal:89, p:1.1, f:0.3, c:20.4, fiber:2.6 },
      unit:{ label:'середній, без шкірки', grams:120 } },
    { id:'apple', group:'fruit', name:'Яблуко', state:'ready', yield:1,
      per100:{ kcal:52, p:0.3, f:0.2, c:11.6, fiber:2.4 },
      unit:{ label:'середнє', grams:180 } },
    { id:'berries', group:'fruit', name:'Ягоди заморожені', state:'ready', yield:1,
      per100:{ kcal:50, p:0.8, f:0.4, c:8.0, fiber:3.0 } },

    { id:'kiwi', group:'fruit', name:'Ківі', state:'ready', yield:1,
      per100:{ kcal:61, p:1.1, f:0.5, c:11.7, fiber:3.0 },
      unit:{ label:'шт', grams:75 } },
    { id:'pineapple-fresh', group:'fruit', name:'Ананас свіжий', state:'ready', yield:1,
      per100:{ kcal:50, p:0.5, f:0.1, c:11.6, fiber:1.4 } },
    { id:'orange', group:'fruit', name:'Апельсин', state:'ready', yield:1,
      per100:{ kcal:47, p:0.9, f:0.1, c:9.4, fiber:2.4 },
      unit:{ label:'шт без шкірки', grams:130 } },
    { id:'mandarin', group:'fruit', name:'Мандарин', state:'ready', yield:1,
      per100:{ kcal:53, p:0.8, f:0.3, c:11.5, fiber:1.8 } },
    { id:'grapefruit', group:'fruit', name:'Грейпфрут', state:'ready', yield:1,
      per100:{ kcal:42, p:0.8, f:0.1, c:9.1, fiber:1.6 } },
    { id:'pear', group:'fruit', name:'Груша', state:'ready', yield:1,
      per100:{ kcal:57, p:0.4, f:0.1, c:12.1, fiber:3.1 },
      unit:{ label:'шт', grams:180 } },
    { id:'grapes', group:'fruit', name:'Виноград', state:'ready', yield:1,
      per100:{ kcal:69, p:0.7, f:0.2, c:17.2, fiber:0.9 } },
    { id:'strawberry', group:'fruit', name:'Полуниця', state:'ready', yield:1,
      per100:{ kcal:32, p:0.7, f:0.3, c:5.7, fiber:2.0 } },
    { id:'raspberry', group:'fruit', name:'Малина', state:'ready', yield:1,
      per100:{ kcal:52, p:1.2, f:0.7, c:5.4, fiber:6.5 } },
    { id:'blueberry', group:'fruit', name:'Чорниця', state:'ready', yield:1,
      per100:{ kcal:57, p:0.7, f:0.3, c:12.1, fiber:2.4 } },
    { id:'watermelon', group:'fruit', name:'Кавун', state:'ready', yield:1,
      per100:{ kcal:30, p:0.6, f:0.2, c:7.2, fiber:0.4 } },
    { id:'melon', group:'fruit', name:'Диня', state:'ready', yield:1,
      per100:{ kcal:34, p:0.8, f:0.2, c:7.4, fiber:0.9 } },
    { id:'peach', group:'fruit', name:'Персик', state:'ready', yield:1,
      per100:{ kcal:39, p:0.9, f:0.3, c:7.7, fiber:1.5 } },
    { id:'plum', group:'fruit', name:'Слива', state:'ready', yield:1,
      per100:{ kcal:46, p:0.7, f:0.3, c:10.0, fiber:1.4 } },
    { id:'mango', group:'fruit', name:'Манго', state:'ready', yield:1,
      per100:{ kcal:60, p:0.8, f:0.4, c:13.4, fiber:1.6 } },
    { id:'pomegranate', group:'fruit', name:'Гранат, зерна', state:'ready', yield:1,
      per100:{ kcal:83, p:1.7, f:1.2, c:14.7, fiber:4.0 } },
    { id:'persimmon', group:'fruit', name:'Хурма', state:'ready', yield:1,
      per100:{ kcal:70, p:0.6, f:0.2, c:15.3, fiber:3.6 } },

    /* ---------------- Напої ----------------
       Числа з етикеток, звірені з Open Food Facts. Наливні напої
       рахуються НА 100 мл, і в базі це те саме поле, що й на 100 г:
       густина цих напоїв близька до води, похибка менша за допуск етикетки.

       Кофеїн винесений у примітку, бо це єдине, що тут справді варто
       рахувати окремо. Для орієнтиру: EFSA вважає разову дозу до 200 мг
       і добову до 400 мг безпечними для здорового дорослого. Одна банка
       енергетика на 500 мл — це вже близько 160 мг. */
    { id:'water', group:'drink', name:'Вода', state:'ready', yield:1,
      per100:{ kcal:0, p:0, f:0, c:0 },
      unit:{ label:'склянка 250 мл', grams:250 } },
    { id:'coffee-black', group:'drink', name:'Кава чорна без цукру', state:'ready', yield:1,
      per100:{ kcal:2, p:0.1, f:0, c:0 },
      unit:{ label:'чашка 200 мл', grams:200 },
      note:'Кофеїн ~40 мг на 100 мл для еспресо-бази, у фільтр-кави менше.' },
    { id:'tea-green', group:'drink', name:'Чай зелений без цукру', state:'ready', yield:1,
      per100:{ kcal:1, p:0, f:0, c:0.2 },
      unit:{ label:'чашка 250 мл', grams:250 } },
    { id:'cola', group:'drink', name:'Coca-Cola класична', state:'ready', yield:1,
      per100:{ kcal:42, p:0, f:0, c:10.6 },
      unit:{ label:'банка 330 мл', grams:330 },
      note:'Уся вуглеводна частина — цукор. Смакові версії Cherry й Vanilla ' +
           'за етикеткою збігаються з класичною в межах округлення. Кофеїн ~10 мг/100 мл.' },
    { id:'cola-zero', group:'drink', name:'Coca-Cola Zero', state:'ready', yield:1,
      per100:{ kcal:0.3, p:0, f:0, c:0 },
      unit:{ label:'банка 330 мл', grams:330 },
      note:'Практично нуль калорій. Те саме стосується Zero-версій зі смаками.' },
    { id:'fuzetea-peach', group:'drink', name:'Fuze Tea, персик', state:'ready', yield:1,
      per100:{ kcal:19, p:0, f:0, c:4.3 },
      unit:{ label:'пляшка 500 мл', grams:500 },
      note:'Інші смаки лінійки (лимон, лісові ягоди, манго-ромашка) за етикеткою ' +
           'коливаються приблизно 17–21 ккал на 100 мл — звір із пляшкою.' },
    { id:'redbull', group:'drink', name:'Red Bull', state:'ready', yield:1,
      per100:{ kcal:46, p:0, f:0, c:11.0 },
      unit:{ label:'банка 250 мл', grams:250 },
      note:'Кофеїн 32 мг/100 мл — банка 250 мл дає 80 мг, як чашка кави.' },
    { id:'redbull-zero', group:'drink', name:'Red Bull без цукру', state:'ready', yield:1,
      per100:{ kcal:3, p:0, f:0, c:0.2 },
      unit:{ label:'банка 250 мл', grams:250 },
      note:'Кофеїну стільки ж, скільки у звичайному.' },
    { id:'monster', group:'drink', name:'Monster Energy', state:'ready', yield:1,
      per100:{ kcal:48, p:0, f:0, c:12.3 },
      unit:{ label:'банка 500 мл', grams:500 },
      note:'Кофеїн ~32 мг/100 мл: банка 500 мл — це вже ~160 мг, майже разова межа EFSA. ' +
           'Плюс 60 г цукру на банку.' },
    { id:'monster-zero', group:'drink', name:'Monster Ultra / Zero Sugar', state:'ready', yield:1,
      per100:{ kcal:2, p:0, f:0, c:0.9 },
      unit:{ label:'банка 500 мл', grams:500 },
      note:'Без цукру, але кофеїну стільки ж, скільки у звичайному.' },
    { id:'juice-orange', group:'drink', name:'Сік апельсиновий', state:'ready', yield:1,
      per100:{ kcal:45, p:0.7, f:0.2, c:10.4, fiber:0.2 },
      unit:{ label:'склянка 250 мл', grams:250 } },

    /* ---------------- Солодке ----------------
       Значення з етикеток через Open Food Facts. Вуглеводи за європейським
       маркуванням — без клітковини, вона окремо. */
    { id:'milka', group:'sweet', name:'Milka молочний шоколад', state:'ready', yield:1,
      per100:{ kcal:539, p:6.5, f:31.0, c:57.0, fiber:2.3 },
      unit:{ label:'плитка 100 г', grams:100 },
      note:'Із них 55 г цукру. Один ряд плитки — приблизно 15 г.' },
    { id:'milka-nut', group:'sweet', name:'Milka з цілим горіхом', state:'ready', yield:1,
      per100:{ kcal:555, p:8.1, f:36.0, c:49.0 },
      unit:{ label:'плитка 100 г', grams:100 } },
    { id:'snickers', group:'sweet', name:'Snickers', state:'ready', yield:1,
      per100:{ kcal:481, p:8.6, f:22.5, c:60.5, fiber:4.3 },
      unit:{ label:'батончик 50 г', grams:50 },
      note:'Батончик 50 г — це 240 ккал і 26 г цукру.' },
    { id:'protein-bar', group:'sweet', name:'Протеїновий батончик', state:'ready', yield:1,
      per100:{ kcal:350, p:30.0, f:10.0, c:30.0, fiber:8.0 },
      unit:{ label:'батончик 60 г', grams:60 },
      note:'УСЕРЕДНЕНЕ значення: між брендами розкид величезний, від 20 до 40 г білка. ' +
           'Обовʼязково звір із конкретною обгорткою.' },

    /* ---------------- Інше ---------------- */
    { id:'soy-sauce', group:'other', name:'Соєвий соус', state:'ready', yield:1,
      per100:{ kcal:53, p:8.0, f:0.1, c:5.0 },
      unit:{ label:'ст. ложка', grams:16 } },
    { id:'tomato-paste', group:'other', name:'Томатна паста', state:'ready', yield:1,
      per100:{ kcal:82, p:4.3, f:0.5, c:14.9, fiber:4.1 },
      unit:{ label:'ст. ложка', grams:16 } },
    { id:'mustard-dijon', group:'other', name:'Гірчиця діжонська', state:'ready', yield:1,
      per100:{ kcal:144, p:7.6, f:10.0, c:2.6, fiber:3.8 },
      unit:{ label:'ч. ложка', grams:5 },
      note:'Калорії дає гірчичне насіння — воно олійне. У соусах її кладуть грамами, тож на підсумок майже не впливає.' },
    // Було 140/2,5/0,5/31,6 — це дані СОЛОДКОГО чилі-соусу, а не шрірачі,
    // при тому що назва каже саме про шрірачу. USDA «Sauce, hot chile,
    // sriracha»: 93 ккал, 1,93 б, 0,93 ж, 19,16 в, з них 2,2 клітковини.
    { id:'chili-sauce', group:'other', name:'Соус чилі (шрірача)', state:'ready', yield:1,
      per100:{ kcal:93, p:1.9, f:0.9, c:17.0, fiber:2.2 },
      unit:{ label:'ч. ложка', grams:6 },
      note:'Майже всі калорії — цукор. Солодкий чилі-соус утричі калорійніший; ' +
           'гострі соуси без цукру (табаско) мають близько нуля.' },
    { id:'honey', group:'other', name:'Мед', state:'ready', yield:1,
      per100:{ kcal:304, p:0.3, f:0, c:82.0 },
      unit:{ label:'ст. ложка', grams:21 } },
    { id:'sugar', group:'other', name:'Цукор', state:'ready', yield:1,
      per100:{ kcal:387, p:0, f:0, c:100 },
      unit:{ label:'ст. ложка', grams:12 } },
    { id:'starch', group:'other', name:'Крохмаль кукурудзяний', state:'ready', yield:1,
      per100:{ kcal:381, p:0.3, f:0.1, c:91.0 },
      unit:{ label:'ст. ложка', grams:8 } },
    { id:'vinegar-rice', group:'other', name:'Оцет рисовий', state:'ready', yield:1,
      per100:{ kcal:18, p:0, f:0, c:0.6 },
      unit:{ label:'ст. ложка', grams:15 },
      note:'Калорії тут не з макросів, а з оцтової кислоти — тому сума БЖВ не сходиться з ккал. Заправлений оцет із цукром має більше вуглеводів.' },
    { id:'garlic', group:'other', name:'Часник', state:'raw', yield:1,
      per100:{ kcal:149, p:6.4, f:0.5, c:31.0, fiber:2.1 },
      unit:{ label:'зубчик', grams:3 } },
    { id:'ginger', group:'other', name:'Імбир свіжий', state:'raw', yield:1,
      per100:{ kcal:80, p:1.8, f:0.8, c:16.0, fiber:2.0 } }
  ];

  /* ------------------------------------------------------------------ */
  /* Перерахунок між станами                                             */
  /* ------------------------------------------------------------------ */

  const STATE_LABEL = {
    raw:   { short: 'сире',  long: 'у сирому вигляді' },
    dry:   { short: 'сухе',  long: 'у сухому вигляді' },
    ready: { short: 'готове', long: 'як є' }
  };

  /** Чи має сенс перемикати цей продукт між станами */
  function convertible(food) {
    return food.state !== 'ready' && Number(food.yield) !== 1;
  }

  /**
   * КБЖВ на 100 г продукту в потрібному стані.
   * @param {object} food
   * @param {boolean} cooked true — на 100 г ГОТОВОГО
   */
  function per100(food, cooked) {
    const base = food.per100;
    if (!cooked || !convertible(food)) return Object.assign({}, base);

    // Маса змінилась у `yield` разів, поживні речовини — ні.
    // Отже на 100 г нового продукту їх у 1/yield разів більше (мʼясо)
    // або менше (крупи).
    const k = 1 / food.yield;
    const out = {};
    Object.keys(base).forEach(function (key) { out[key] = base[key] * k; });
    return out;
  }

  /**
   * КБЖВ для довільної маси.
   * @param {object} food
   * @param {number} grams маса в стані `cooked ? готове : базовий стан`
   */
  function amount(food, grams, cooked) {
    const p = per100(food, cooked);
    // Нескінченність і NaN сюди долітають із збереженого дня або з поля вводу;
    // без цієї межі в підсумку зʼявляється «Infinity ккал»
    const g = Number(grams);
    const k = (Number.isFinite(g) ? Math.max(0, Math.min(g, MAX_GRAMS)) : 0) / 100;
    return {
      kcal: (p.kcal || 0) * k,
      p:    (p.p || 0) * k,
      f:    (p.f || 0) * k,
      c:    (p.c || 0) * k,
      fiber:(p.fiber || 0) * k
    };
  }

  /** Скільки сирого треба взяти, щоб на виході отримати `grams` готового */
  function rawFor(food, grams) {
    const g = Number(grams);
    if (!Number.isFinite(g)) return 0;
    const safe = Math.max(0, Math.min(g, MAX_GRAMS));
    return convertible(food) ? safe / food.yield : safe;
  }

  /** Скільки готового вийде з `grams` сирого */
  const MAX_GRAMS = 100000;   // 100 кг однієї позиції — свідомо недосяжна стеля

  function cookedFrom(food, grams) {
    const g = Number(grams);
    if (!Number.isFinite(g)) return 0;
    const safe = Math.max(0, Math.min(g, MAX_GRAMS));
    return convertible(food) ? safe * food.yield : safe;
  }

  function byId(id) {
    return FOODS.find(function (f) { return f.id === id; }) || null;
  }

  /** Пошук за назвою, без урахування регістру */
  /**
   * Пошук за назвою І за побутовими синонімами.
   *
   * Назви в базі — каталожні: «Куряче філе (грудка)», «Вівсяні пластівці»,
   * «Сир кисломолочний». Шукають же звичайними словами: «курка»,
   * «вівсянка», «творог» — і всі три давали НУЛЬ результатів. Підказка в
   * полі пошуку при цьому пропонувала саме «курка».
   *
   * alias — це та сама їжа під іншим ім'ям, а НЕ схожий продукт. Тому там
   * немає ні «масла» (вершкове масло — не олія, інші КБЖВ), ні «кефіру»
   * (його в базі просто немає). Показати замість шуканого щось інше гірше,
   * ніж чесно не знайти нічого.
   */
  function search(query, group) {
    const q = String(query || '').trim().toLowerCase();
    return FOODS.filter(function (f) {
      if (group && group !== 'all' && f.group !== group) return false;
      if (!q) return true;
      if (f.name.toLowerCase().indexOf(q) !== -1) return true;
      return Boolean(f.alias) && f.alias.indexOf(q) !== -1;
    });
  }

  window.FOOD_GROUPS = FOOD_GROUPS;
  window.FOODS = FOODS;
  window.Foods = {
    STATE_LABEL: STATE_LABEL,
    convertible: convertible,
    per100: per100,
    amount: amount,
    rawFor: rawFor,
    cookedFrom: cookedFrom,
    byId: byId,
    search: search
  };
})();
