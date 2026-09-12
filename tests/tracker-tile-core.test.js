/**
 * КУБИКИ ТРЕКЕРІВ (js/tracker-tile-core.js).
 *
 * Стережеться не оформлення, а чотири речі, які ламаються мовчки:
 *
 * 1. КОЖЕН ВИД — СВІЙ КУБИК. Уся суть цієї частини в тому, що вода,
 *    настрій, сон і звичка вводяться різними жестами. Варто комусь
 *    «спростити» це до одного поля вводу — і фіча зникне, лишивши
 *    розмітку на місці. Тому перевіряється наявність саме тих
 *    контролів, які цей вид вимагає.
 *
 * 2. ТІ САМІ data-АТРИБУТИ, ЩО НА СТОРІНЦІ «ТРЕКЕРИ». Обробники запису
 *    написані під них. Перейменування атрибута нічого не зламає на
 *    вигляд — кубик намалюється, кнопки натиснуться, і жоден дотик не
 *    дійде до профілю.
 *
 * 3. ТЕКСТ ІЗ БАЗИ ЕКРАНУЄТЬСЯ. Назву трекера вводить людина, і вона
 *    їде в атрибути (aria-label, data-trk-*).
 *
 * 4. ПОРОЖНЄ — ЦЕ ПОРОЖНЄ, А НЕ НУЛЬ. «Сер. 0» читається як «спав нуль
 *    годин», а не «нічого не записано».
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './helpers.js';

const mod = loadModules(['js/date-core.js', 'js/tracker-core.js', 'js/tracker-tile-core.js']);
const T = mod.TrackerCore;
const Tile = mod.TrackerTile;

const NOW = new Date(2026, 7, 17);
const KEY = '2026-08-17';
const trackers = T.ensureBuiltins({});
const at = (id, o) => Tile.html(trackers[id], Object.assign({ todayKey: KEY, now: NOW }, o || {}));

describe('кубик трекера: кожен вид має свій ввід', () => {
  it('вода — кнопки додавання, а не поле', () => {
    const h = at('water');
    assert.match(h, /data-trk-add="water"/);
    assert.equal((h.match(/data-trk-add/g) || []).length, 4, 'три пресети + відкат');
    assert.match(h, /data-amount="-0\.25"/, 'відкат найменшим кроком');
    assert.doesNotMatch(h, /data-trk-value/, 'воду не набирають числом');
  });

  it('настрій — шкала з десяти кнопок, по одному дотику на відповідь', () => {
    const h = at('mood');
    assert.equal((h.match(/data-trk-scale="mood"/g) || []).length, 10);
    assert.match(h, /data-val="10"/);
    assert.doesNotMatch(h, /data-trk-value/);
  });

  it('сон — два поля, год і хв (число 6:47 не округлюють до кнопки)', () => {
    const h = at('sleep');
    assert.match(h, /data-trk-durh="sleep"/);
    assert.match(h, /data-trk-durm="sleep"/);
    assert.doesNotMatch(h, /data-trk-scale/);
    /* Підписи «год» і «хв» зняті з полів — вони дублювали шапку. Для
       читалки вони лишились там, де потрібні. */
    assert.match(h, /class="twt__sep"/);
    assert.match(h, /aria-label="Сон, годин"/);
    assert.match(h, /aria-label="Сон, хвилин"/);
  });

  it('кроки — одне поле; кнопок «+1000» немає навмисно', () => {
    const t = T.setEnabled(trackers, 'steps', true);
    const h = Tile.html(t.steps, { todayKey: KEY, now: NOW });
    assert.match(h, /data-trk-value="steps"/);
    /* value ЗАМІНЮЄ значення, а не додає. Кнопка «+1000» тут означала б
       не те саме, що «+1» у води, — а виглядала б однаково. */
    assert.doesNotMatch(h, /data-trk-add/);
  });

  it('біль/втома — дві шкали, обидві на екрані', () => {
    const t = T.setEnabled(trackers, 'painFatigue', true);
    const h = Tile.html(t.painFatigue, { todayKey: KEY, now: NOW });
    assert.equal((h.match(/data-field="pain"/g) || []).length, 10);
    assert.equal((h.match(/data-field="fatigue"/g) || []).length, 10);
    assert.match(h, /Біль/);
    assert.match(h, /Втома/);
  });

  it('звичка — галочка на весь кубик, без полів', () => {
    const made = T.addCustom(trackers, 'habit', 'Розтяжка');
    const h = Tile.html(made.trackers[made.id], { todayKey: KEY, now: NOW });
    assert.match(h, /data-trk-mark=/);
    assert.doesNotMatch(h, /data-trk-value|data-trk-scale|data-trk-add/);
  });

  it('добавка з дозою — галочка ПЛЮС поле грамів', () => {
    const h = at('creatine');
    assert.match(h, /data-trk-mark="creatine"/);
    assert.match(h, /data-trk-dose="creatine"/);
  });
});

describe('кубик трекера: значення й підпис', () => {
  it('поточне значення показується в шапці', () => {
    const log = { water: { [KEY]: 1.5 } };
    assert.match(at('water', { log }), /1,5 \/ 2,5 л/);
  });

  it('сон приходить обгорнутим {value, source} — і все одно читається', () => {
    const log = { sleep: { [KEY]: { value: 440, source: 'manual', date: KEY } } };
    const h = at('sleep', { log });
    /* У шапці — коротка форма часу: повний запис забирав усю шапку й
       обрізав назву кубика до «С…». */
    assert.match(h, /class="twt__now">7:20</);
    assert.match(h, /value="7"/, 'години в полі');
    assert.match(h, /value="20"/, 'хвилини в полі');
  });

  it('кроки не дублюють одиницю — інакше назва кубика обрізається', () => {
    const t = T.setEnabled(trackers, 'steps', true);
    const h = Tile.html(t.steps, { log: { steps: { [KEY]: 7400 } }, todayKey: KEY, now: NOW });
    /* Заборона стосується ШАПКИ: там назва й значення ділять один рядок,
       і «7400 кроків» видавлює «Кроки» до «КР…». У підписі під кубиком
       рядок свій, місця вистачає — там одиниця доречна. */
    assert.match(h, /class="twt__now">7400</);
    assert.doesNotMatch(h, /class="twt__now">7400 кроків</);
  });

  it('без записів підпис каже про це прямо, а не показує нуль', () => {
    const h = at('water');
    assert.match(h, /за тиждень записів немає/);
    assert.doesNotMatch(h, /тиждень: 0/);
  });

  it('із записами підпис дає середнє за тиждень', () => {
    const log = { water: { '2026-08-15': 2, '2026-08-16': 3, [KEY]: 1 } };
    assert.match(at('water', { log }), /тиждень: 2 л/);
  });

  it('позначена звичка робить кубик увімкненим', () => {
    const made = T.addCustom(trackers, 'habit', 'Розтяжка');
    const log = { [made.id]: { [KEY]: true } };
    const h = Tile.html(made.trackers[made.id], { log: log, todayKey: KEY, now: NOW });
    assert.match(h, /class="twt [^"]*is-on/);
    assert.match(h, /checked/);
  });

  it('обране число шкали позначене й для читалки', () => {
    const h = at('mood', { log: { mood: { [KEY]: 7 } } });
    assert.match(h, /aria-pressed="true" data-trk-scale="mood" data-val="7"/);
    assert.equal((h.match(/aria-pressed="true"/g) || []).length, 1);
  });
});

describe('кубик трекера: ширина, стійкість, сітка', () => {
  it('широкими стають ті види, яким мало половини рядка', () => {
    assert.equal(Tile.isWide('scale'), true);
    assert.equal(Tile.isWide('pair'), true);
    assert.equal(Tile.isWide('cumulative'), true);
    /* Галочка й одне поле поміщаються в половину — інакше два кубики
       звичок займали б два рядки замість одного. */
    assert.equal(Tile.isWide('boolean'), false);
    assert.equal(Tile.isWide('value'), false);
    /* Тривалість теж поміщається: у шапці вже написано «7 год 20 хв»
       словами, тож у тілі досить двох полів із двокрапкою. */
    assert.equal(Tile.isWide('duration'), false);
  });

  it('назва трекера екранується — вона їде в атрибути', () => {
    const made = T.addCustom(trackers, 'habit', '<img src=x onerror=alert(1)>');
    const h = Tile.html(made.trackers[made.id], { todayKey: KEY, now: NOW });
    assert.doesNotMatch(h, /<img/);
    assert.match(h, /&lt;img/);
  });

  it('трекер без відомого виду не малює нічого', () => {
    assert.equal(Tile.html({ id: 'x', type: 'невідомий', name: 'Що це' }), '');
    assert.equal(Tile.html(null), '');
  });

  it('сітка малює лише закріплені', () => {
    let t = T.setPinned(trackers, 'water', true);
    t = T.setPinned(t, 'mood', true);
    const h = Tile.grid(t, { todayKey: KEY, now: NOW });
    assert.equal((h.match(/class="twt /g) || []).length, 2);
    assert.match(h, /twt-grid/);
  });

  it('нічого не закріплено — порожній рядок, а не порожня сітка', () => {
    assert.equal(Tile.grid(trackers, { todayKey: KEY, now: NOW }), '');
    assert.equal(Tile.grid({}), '');
  });
});
