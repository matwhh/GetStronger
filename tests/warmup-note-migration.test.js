/**
 * Легасі-примітка «Підводні» має зникнути з уже збережених планів.
 *
 * customPlans — заморожена копія плану з редактора, і вона СИЛЬНІША за
 * js/programs-data.js. Тому прибрати рядок «Підводні: 1–2 підходи × 6» з
 * файла даних було замало: у того, хто вже правив план, копія лишилась
 * зі старою приміткою, і напис висів на екрані тренування далі.
 *
 * Поняття «підводні» більше немає — є розминкові підходи, і їх рахує
 * драбина від робочої ваги. Примітка, що каже інше число («1–2 × 6»),
 * тепер прямо суперечить тому, що показує сторінка.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStore, makeStorage } from './helpers.js';

const SCHEMA_VERSION = Number(
  /const SCHEMA_VERSION = (\d+);/.exec(
    fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'store.js'), 'utf8')
  )[1]);

const load = (raw) => loadStore({
  storage: makeStorage({ 'ib.profile': JSON.stringify(raw) }), local: true
}).Store.localProfile();

const stored = () => ({
  version: 11,
  customPlans: {
    'fullbody:3': [
      { title: 'A', exercises: [
        { name: 'Присідання зі штангою', sets: 3, note: 'Підводні: 1–2 підходи × 6' },
        { name: 'Румунська тяга', sets: 3, note: 'Підводні: 1–2 підходи × 6' },
        { name: 'Сідничний міст зі штангою', sets: 3, note: 'Розминочний підхід перед мостом' }
      ] }
    ],
    'ppl:6': [
      { title: 'Push', exercises: [{ name: 'Жим гантелей лежачи', sets: 3, note: 'По одній руці' }] }
    ]
  }
});

const notesIn = (p, key) => p.customPlans[key][0].exercises.map((e) => e.note || '').join('|');

describe('«Підводні» зникають зі збережених планів', () => {
  test('примітка прибирається з кожного дня і кожної програми', () => {
    const p = load(stored());
    assert.equal(notesIn(p, 'fullbody:3'), '||Розминочний підхід перед мостом');
  });

  test('чужі примітки лишаються недоторканими', () => {
    assert.equal(notesIn(load(stored()), 'ppl:6'), 'По одній руці');
  });

  test('решта вправи не чіпається — ані назва, ані підходи', () => {
    const ex = load(stored()).customPlans['fullbody:3'][0].exercises[0];
    assert.equal(ex.name, 'Присідання зі штангою');
    assert.equal(ex.sets, 3);
  });

  test('профіль доходить до поточної версії', () => {
    assert.equal(load(stored()).version, SCHEMA_VERSION);
  });

  test('профіль без планів міграцію переживає', () => {
    assert.equal(load({ version: 11 }).version, SCHEMA_VERSION);
    assert.equal(load({ version: 11, customPlans: 'сміття' }).version, SCHEMA_VERSION);
  });
});
