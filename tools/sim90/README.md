# sim90 — тимчасовий audit-harness (не код застосунку)

90-денна симуляція 10 синтетичних користувачів проти реального UI Forge у headless Chromium.
Нічого в `js/`, `css/`, `*.html`, `db/` не змінює. Supabase підмінено мок-хмарою на користувача.

- `personas.mjs` — 10 персон, `SEASON_SEED=20260902`
- `run.mjs <user|all> [fromDay] [toDay]` — прогін; стан браузера в `out/profiles/uN`, логи `out/log/uN.jsonl`
- `analyze.mjs` — таблиці по логах
- `ownership.mjs`, `repro-*.mjs` — окремі відтворення знахідок
- `REPORT.md` — фінальний звіт
