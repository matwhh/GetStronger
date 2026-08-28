# Браузерні перевірки

Не частина `npm test`: вони піднімають справжній Chromium і ходять по
сторінках через `file://`. Тримаються окремо, щоб `npm test` лишався
швидким і не вимагав браузера.

Потрібен Playwright:

```bash
npm i playwright
node tools/verify7.mjs           # 16 сторінок × 2 ширини: overflow, JS-помилки
node tools/verifydata.mjs        # міграції, legacy-поле, offline, reload
node tools/verifyimport.mjs      # export → clear → import → verify + биті файли
node tools/verifya11y.mjs        # focus trap, Escape, aria, мобільне меню
node tools/verifyflows.mjs       # наскрізні сценарії + друк
node tools/verifyhardening.mjs   # пошкоджене сховище, швидкі кліки, offline, крайні числа
node tools/verifyonboard.mjs     # шлях нового користувача: онбординг → тиждень
node tools/verifyonboarding.mjs  # ворота онбордингу: кроки, обходи, імпорт копії
node tools/verifyresponsive.mjs  # 320/375/430/768/1024/1280/1920: overflow, дрібні цілі
node tools/verifyroundtrip.mjs   # §14: Export → Clear → Import, звірка поле за полем
node tools/verifyplanfields.mjs  # перехід між полями ваги не згортає день і не краде фокус
node tools/verifythemes.mjs      # 18 тем: контраст, поверхні, вибір, імпорт
node tools/verifyloop.mjs        # щоденний цикл: дія → стан оновився; мобільна панель
node tools/verifyworkout.mjs     # тренування як окремий екран + опційний настрій сесії
node tools/verifyagegate.mjs     # 18+: гейт, обхід URL/історією/localStorage/імпортом
node tools/verifyreps.mjs        # діапазони повторень: 4 стажі × 4 програми × великі/малі групи
node tools/verifyperf.mjs        # вага сторінок, час завантаження, кількість вузлів
```

Усі, крім `verifyperf.mjs`, повертають ненульовий код при провалі — їх
можна ставити в CI як є.

Усі перевірки, крім `verifyagegate.mjs`, `verifyonboarding.mjs` і `verifyonboard.mjs`, створюють
контекст через `tools/adult.mjs` — він садить `profile.birthDate` ще до
першого переходу. Без цього віковий сторож чесно відвертав би їх на
`welcome.html`, і падали б вони не через баг, а через правильну поведінку.
Ті двоє починають із чистого браузера навмисно: одна перевіряє сам гейт,
друга — шлях новачка від першого екрана.

Шлях до браузера зашитий як `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` —
поміняй на свій, якщо Playwright ставив браузери в інше місце.

`npm test` варто ганяти щонайменше у двох часових поясах: частина логіки
рахує календарні дні, і помилки переходу на зимовий час видно лише там.

```bash
TZ=UTC npm test && TZ=Europe/Kyiv npm test
```

## ELO (етап 6)

- `simelo.mjs` — детермінована симуляція сезону (92 дні, mulberry32):
  5 профілів × 5 сідів + Flawless; перевіряє 6 цілей балансу з
  `db/elo-config.json`. Якщо міняєш баланс — цей скрипт мусить лишатись 6/6.
- Юніт-тести ELO: `tests/elo-core.test.js` (сезони, рівні, дельти,
  толеранс-драбини, Grace, кепи) — ганяються звичайним `npm test`.
- Паритет JS↔SQL перевірявся разово при деплої рушія (11/11); якщо правиш
  формулу — міняй ОБИДВА: `js/elo-core.js`, і `db/elo-engine.sql`.
