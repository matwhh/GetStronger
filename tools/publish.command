#!/bin/bash
#
#  FORGE — ОПУБЛІКУВАТИ. Кнопка.
#
#  Подвійний клік: проганяє тести, комітить усе, що змінилось, і
#  відправляє на GitHub. Vercel далі збирає сайт сам.
#
#  ЧОМУ КНОПКА, А НЕ АВТОМАТ. Тут була автопублікація: launchd раз на
#  хвилину запускав tools/auto-publish.sh. Вона тихо померла — macOS
#  перестав давати /bin/bash читати теку на Робочому столі
#  («Operation not permitted»), і дві доби зміни нікуди не їхали, а
#  ніхто цього не бачив. Автомат, який мовчки не працює, гірший за
#  ручну кнопку: кнопка або спрацювала на очах, або ні.
#
#  ЧОМУ ПУШ РОБИТЬ ЦЕЙ MAC. Ключ до GitHub лежить у Звʼязці ключів
#  цього компʼютера. Хмара до нього доступу не має і мати не повинна.
#
#  Якщо тести червоні — НІЧОГО не відправляється. Це навмисно.
#
set -u

# Подвійний клік дає порожній PATH: усе, що не /usr/bin, треба вказати.
# Homebrew на Apple Silicon — /opt/homebrew, на Intel — /usr/local.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

BRANCH="main"

# Скрипт живе в tools/, репозиторій — на рівень вище.
cd "$(dirname "$0")/.." 2>/dev/null || { echo "Не знайшов теку репозиторію"; exit 1; }
REPO="$(pwd -P)"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
bad()  { printf '\n\033[1;31m%s\033[0m\n' "$*"; }
good() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }

echo "FORGE — публікація"
echo "Тека: $REPO"

# ------------------------------------------------------------------ #
# 1. Чи є що публікувати                                              #
# ------------------------------------------------------------------ #
CHANGED="$(git status --porcelain | wc -l | tr -d ' ')"
AHEAD="$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)"

if [ "$CHANGED" = "0" ] && [ "$AHEAD" = "0" ]; then
  good "Публікувати нічого: змін немає, усе вже на GitHub."
  exit 0
fi

[ "$CHANGED" != "0" ] && { say "Змінені файли ($CHANGED):"; git status --short | head -30; }
[ "$AHEAD" != "0" ] && say "Готових комітів, які ще не відправлені: $AHEAD"

# ------------------------------------------------------------------ #
# 2. Тести — ворота                                                   #
# ------------------------------------------------------------------ #
if ! command -v node >/dev/null 2>&1; then
  bad "node не знайдено. Публікацію спинено — без тестів не відправляємо."
  echo "Постав Node (brew install node) і натисни кнопку ще раз."
  exit 1
fi

say "Юніт-тести…"
if ! node --test tests/*.test.js > /tmp/forge-tests.log 2>&1; then
  bad "ТЕСТИ ЧЕРВОНІ — нічого не відправлено."
  tail -n 30 /tmp/forge-tests.log
  echo
  echo "Повний вивід: /tmp/forge-tests.log"
  exit 1
fi
grep -E '^# (tests|pass|fail)' /tmp/forge-tests.log

say "Гігієна репозиторію…"
if ! node tools/ci-hygiene.mjs; then
  bad "ГІГІЄНА ЧЕРВОНА — нічого не відправлено."
  exit 1
fi

# ------------------------------------------------------------------ #
# 3. Коміт                                                            #
# ------------------------------------------------------------------ #
if [ "$CHANGED" != "0" ]; then
  DEFAULT="оновлення $(date '+%d.%m.%Y %H:%M')"
  say "Текст коміта (Enter = «$DEFAULT»):"
  IFS= read -r MSG
  [ -z "$MSG" ] && MSG="$DEFAULT"

  git add -A || { bad "git add не вдався"; exit 1; }

  # Пошта форсується на noreply GitHub: з приватною адресою Vercel
  # блокує збірку.
  if ! git -c user.name="Matthew" \
           -c user.email="152515220+matwhh@users.noreply.github.com" \
           commit -q -m "$MSG"; then
    bad "Коміт не вдався"
    exit 1
  fi
  echo "Закомічено: $(git log --oneline -1)"
fi

# ------------------------------------------------------------------ #
# 4. Пуш                                                              #
# ------------------------------------------------------------------ #
say "Відправляю на GitHub…"
if ! git push origin "$BRANCH"; then
  bad "ПУШ НЕ ВДАВСЯ."
  echo "Найчастіша причина — протух токен GitHub."
  echo "Тоді: tools/github-token.command (зітре старий), далі кнопка ще раз."
  exit 1
fi

good "Опубліковано. Vercel збере сайт за хвилину-дві."
echo "Перевірити: https://github.com/matwhh/Forge/commits/main"
