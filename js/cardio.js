/**
 * Кардіо: розрахунок пульсових зон і план бігу.
 *
 * Ланцюг розрахунку:
 *   HRmax — 208 − 0,7 × вік (Tanaka, PMID 11153730). Формула точніша за
 *           «220 − вік», яка систематично занижує максимум у людей за 40.
 *           Якщо максимум виміряний у полі — беремо його, він завжди точніший.
 *   Зони  — за резервом пульсу (Karvonen): HR = пульс спокою + %×(HRmax − спокій).
 *           Резерв враховує тренованість серця, а голий відсоток від HRmax — ні.
 *           Без пульсу спокою відкочуємось на простий відсоток від HRmax.
 *
 * Два режими рахують РІЗНІ речі:
 *   fat   — інтенсивність із найвищою ШВИДКІСТЮ окислення жиру (~63% VO2max)
 *   vo2   — інтервали 4×4 хв на 90–95% HRmax для приросту VO2max
 */
(function () {
  'use strict';

  const { $, $$, esc, round, clamp, num, toast } = window.App;

  /* ------------------------------------------------------------------ */
  /* Довідники                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Зони за відсотком резерву пульсу.
   * Межі — робоча конвенція для опису інтенсивності, а не результат
   * окремого дослідження. Прив'язані до фізіології лише орієнтовно.
   */
  const ZONES = [
    { id: 1, name: 'Відновлення',   lo: 0.50, hi: 0.60, use: 'Легкий біг або ходьба між важкими днями' },
    { id: 2, name: 'Аеробна база',  lo: 0.60, hi: 0.70, use: 'Основний обсяг: розмова дається легко' },
    { id: 3, name: 'Темп',          lo: 0.70, hi: 0.80, use: 'Рівний темп, говорити вже незручно' },
    { id: 4, name: 'Поріг',         lo: 0.80, hi: 0.90, use: 'Довгі інтервали, 8–20 хв' },
    { id: 5, name: 'VO2max',        lo: 0.90, hi: 1.00, use: 'Короткі інтервали, 3–5 хв' }
  ];

  const GOALS = {
    fat: {
      label: 'Окислення жиру',
      /* Achten & Jeukendrup: пік окислення жиру ≈ 63% VO2max.
         %VO2max і %резерву пульсу співвідносяться приблизно один до одного,
         тому беремо 55–68% резерву — вузький коридор навколо піку. */
      lo: 0.55, hi: 0.68,
      pmid: '14598198',
      title: 'Пік окислення жиру',
      how: [
        'Рівний безперервний біг 40–60 хвилин.',
        'Темп такий, що можна говорити цілими реченнями.',
        'Це зона з найвищою ШВИДКІСТЮ спалювання жиру за хвилину — але не з найбільшою витратою калорій.'
      ]
    },
    vo2: {
      label: 'Приріст VO2max',
      /* Helgerud: 4 × 4 хв на 90–95% HRmax дали +7,2% VO2max за 8 тижнів —
         більше, ніж рівний біг на 70% HRmax за тієї самої загальної роботи. */
      lo: 0.90, hi: 0.95,
      byMax: true,          // тут відсотки саме від HRmax, як у протоколі
      pmid: '17414804',
      title: 'Інтервали 4 × 4 хв',
      how: [
        'Розминка 10 хв легкого бігу.',
        '4 хвилини на цільовому пульсі → 3 хвилини легкого бігу. Повторити 4 рази.',
        'Заминка 5–10 хв. Уся сесія — близько 40 хвилин.',
        'Пульс виходить на цільовий не одразу: перші 1–1,5 хв інтервалу він тільки піднімається.'
      ]
    }
  };

  /* ------------------------------------------------------------------ */
  /* Розрахунки                                                          */
  /* ------------------------------------------------------------------ */

  /* Фізіологічні межі, за якими формули перестають означати хоч щось */
  const AGE_MIN = 10, AGE_MAX = 100;
  const HRMAX_MIN = 120, HRMAX_MAX = 230;
  const HRREST_MIN = 30, HRREST_MAX = 110;

  /** HRmax за віком. Tanaka 2001, PMID 11153730 */
  function hrMaxByAge(age) {
    return 208 - 0.7 * age;
  }

  /**
   * Пульс для заданої частки інтенсивності.
   * @param {number} pct   частка (0…1)
   * @param {number} hrMax
   * @param {number|null} hrRest пульс спокою; якщо є — рахуємо за резервом
   * @param {boolean} ofMax якщо true — відсоток береться від HRmax, а не від резерву
   */
  function hrAt(pct, hrMax, hrRest, ofMax) {
    if (ofMax || !hrRest) return hrMax * pct;
    return hrRest + pct * (hrMax - hrRest);   // Karvonen
  }

  /* ------------------------------------------------------------------ */
  /* Рендер                                                              */
  /* ------------------------------------------------------------------ */

  function render(input) {
    const out = $('#cardio-out');
    if (!out) return;

    const { age, hrRest, hrMaxManual, goalKey } = input;

    /*
     * Клампимо ТУТ, а не лише при збереженні.
     *
     * Єдиною перевіркою було age > 0, а App.num читає поле через parseFloat
     * без огляду на атрибут max. Ввід «300» давав hrMax = 208 − 210 = −2,
     * і вся таблиця зон малювалась відʼємними числами: «максимум, за віком:
     * −2», цільова зона «−1 – −1 уд/хв».
     */
    if (!(age >= AGE_MIN && age <= AGE_MAX)) {
      out.innerHTML = '<div class="notice notice--acc">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5m0-3h.01"/></svg>' +
        '<div>Впишіть вік від ' + AGE_MIN + ' до ' + AGE_MAX + ' — решта порахується одразу.</div></div>';
      return;
    }

    // Виміряний HRmax теж має межі: ввід 999 раніше приймався як є.
    const measured = Number.isFinite(hrMaxManual) &&
                     hrMaxManual >= HRMAX_MIN && hrMaxManual <= HRMAX_MAX;
    const hrMax = measured ? hrMaxManual : hrMaxByAge(age);
    const rest = Number.isFinite(hrRest) && hrRest > HRREST_MIN && hrRest < HRREST_MAX
                 ? hrRest : null;

    /*
     * Резерв пульсу нульовий або відʼємний — Karvonen не працює.
     * hrMax = 105 при hrRest = 105 давало всі пʼять зон однаковими «105–105»,
     * і це виглядало як робоча таблиця, а не як помилка вводу.
     */
    if (rest !== null && hrMax - rest < 20) {
      out.innerHTML = '<div class="notice">Пульс спокою (' + Math.round(rest) + ') надто близький ' +
        'до максимального (' + Math.round(hrMax) + '). Резерв пульсу виходить майже нульовим, ' +
        'і зони втрачають сенс — перевірте обидва числа.</div>';
      return;
    }
    const goal = GOALS[goalKey] || GOALS.fat;

    const lo = Math.round(hrAt(goal.lo, hrMax, rest, goal.byMax));
    const hi = Math.round(hrAt(goal.hi, hrMax, rest, goal.byMax));

    // Резерв пульсу: чим він більший, тим більше «місця» між спокоєм і максимумом
    const reserve = rest ? Math.round(hrMax - rest) : null;

    out.innerHTML = '' +
      '<div class="card">' +
        '<span class="eyebrow"><span class="eyebrow__dot"></span>' + esc(goal.label) + '</span>' +

        '<div style="font-size:clamp(2.6rem,7vw,4rem);font-weight:800;letter-spacing:-0.04em;line-height:1.05;margin-top:12px" class="gradient-text mono">' +
          lo + '–' + hi + '<span style="font-size:0.4em;letter-spacing:0"> уд/хв</span>' +
        '</div>' +
        '<p class="small muted" style="margin:6px 0 0">' +
          esc(goal.title) + ' · ' +
          (goal.byMax
            ? round(goal.lo * 100, 0) + '–' + round(goal.hi * 100, 0) + '% від максимуму'
            : round(goal.lo * 100, 0) + '–' + round(goal.hi * 100, 0) + '% резерву пульсу') +
        '</p>' +

        '<div class="kpis mt-3">' +
          '<div class="kpi"><div class="kpi__val mono">' + Math.round(hrMax) + '</div>' +
            '<p class="kpi__lbl">' + (measured ? 'максимум, виміряний' : 'максимум, за віком') + '</p></div>' +
          (rest
            ? '<div class="kpi"><div class="kpi__val mono">' + rest + '</div><p class="kpi__lbl">спокій, уд/хв</p></div>' +
              '<div class="kpi"><div class="kpi__val mono">' + reserve + '</div><p class="kpi__lbl">резерв пульсу</p></div>'
            : '<div class="kpi" style="grid-column:span 2"><div class="kpi__val mono">—</div>' +
              '<p class="kpi__lbl">пульс спокою не задано</p></div>') +
        '</div>' +

        (!rest
          ? '<div class="notice mt-2">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
              '<div>Без пульсу спокою зони рахуються простим відсотком від максимуму — ' +
              'це грубіше. Виміряйте пульс уранці, не встаючи з ліжка, три дні поспіль ' +
              'і візьміть середнє: розрахунок стане помітно точнішим.</div>' +
            '</div>'
          : '') +

        '<hr class="divider">' +
        '<h3>Як це виконувати</h3>' +
        '<ol class="ritual">' +
          goal.how.map(function (x) {
            return '<li><span class="ritual__name">' + esc(x) + '</span></li>';
          }).join('') +
        '</ol>' +
        '<p class="small muted mt-1 mb-0">' +
          '<a href="https://pubmed.ncbi.nlm.nih.gov/' + goal.pmid + '/" target="_blank" rel="noopener">PMID ' + goal.pmid + '</a>' +
        '</p>' +

        '<hr class="divider">' +
        '<h3 style="margin-bottom:4px">Усі зони</h3>' +
        '<p class="small muted" style="margin-bottom:16px">' +
          (rest
            ? 'Рахуються за резервом пульсу: спокій + відсоток × (максимум − спокій).'
            : 'Рахуються як відсоток від максимуму — задайте пульс спокою для точнішого результату.') +
        '</p>' +
        '<div class="table-wrap">' +
          '<table class="tbl">' +
            '<thead><tr>' +
              '<th style="width:50px">Зона</th><th>Назва</th>' +
              '<th style="width:130px">Пульс, уд/хв</th><th>Для чого</th>' +
            '</tr></thead>' +
            '<tbody>' +
              ZONES.map(function (z) {
                const a = Math.round(hrAt(z.lo, hrMax, rest, false));
                const b = Math.round(hrAt(z.hi, hrMax, rest, false));
                const active = !goal.byMax && z.lo < goal.hi && z.hi > goal.lo;
                return '<tr' + (active ? ' class="is-target"' : '') + '>' +
                  '<td class="mono">Z' + z.id + '</td>' +
                  '<td><b>' + esc(z.name) + '</b></td>' +
                  '<td class="num mono">' + a + '–' + b + '</td>' +
                  '<td class="small muted">' + esc(z.use) + '</td>' +
                '</tr>';
              }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */

  function readInput() {
    const goalEl = $$('input[name="cardio-goal"]').find(function (r) { return r.checked; });
    return {
      age: num($('#c-age')),
      hrRest: num($('#c-rest')),
      hrMaxManual: num($('#c-max')),
      goalKey: goalEl ? goalEl.value : 'fat'
    };
  }

  async function init() {
    if (!$('#cardio-out')) return;

    // Вік уже може бути в профілі зі сторінки харчування
    try {
      const p = await window.Store.getProfile();
      if (p.age) $('#c-age').value = p.age;
      if (p.hrRest) $('#c-rest').value = p.hrRest;
      if (p.hrMax) $('#c-max').value = p.hrMax;
    } catch (_) { /* профіль необовʼязковий */ }

    const update = function () { render(readInput()); };

    $$('#cardio-form input').forEach(function (el) {
      el.addEventListener('input', update);
      el.addEventListener('change', update);
    });

    const save = $('#c-save');
    if (save) {
      save.addEventListener('click', async function () {
        const i = readInput();
        const done = window.App.busy(this, 'Зберігаю…');
        try {
          await window.Store.saveProfile({
            // age теж клампимо: він іде в спільний профіль і його читає
            // калькулятор калорій, де вік поза 10..100 знеструмлює весь
            // розрахунок. Сусідні два поля клампились, а це — ні.
            age: Number.isFinite(i.age) ? clamp(i.age, 10, 100) : null,
            hrRest: Number.isFinite(i.hrRest) ? clamp(i.hrRest, 30, 110) : null,
            hrMax: Number.isFinite(i.hrMaxManual) ? clamp(i.hrMaxManual, 120, 230) : null
          });
          toast('Дані збережено' + (window.Store.user() ? '' : ' локально'), 'ok');
        } catch (e) {
          toast('Не збереглося: ' + e.message, 'err');
        } finally { done(); }
      });
    }

    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
