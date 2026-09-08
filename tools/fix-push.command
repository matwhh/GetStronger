#!/bin/bash
#
#  FORGE — разовий ремонт відправки на GitHub.
#
#  Що сталося 03.09.2026: «Опублікувати.command» зробив коміт, але GitHub
#  його не прийняв, і разом із ним не поїхало виправлення витоку даних.
#  Дві незалежні причини:
#
#  1. Репозиторій перейменували: forge → Forge. Пуш ще проходить за старою
#     адресою через переадресацію, тому це не блокер — але виправити варто,
#     і саме тут, бо «Опублікувати.command» щоразу переписує адресу назад
#     зі свого рядка REPO_URL.
#
#  2. Блокер: у коміті є .github/workflows/ci.yml, а токен, яким ти пушиш,
#     не має права «workflow». Це захист самого GitHub: файл робочого
#     процесу виконує код на їхніх серверах, тож на нього потрібне окреме
#     дозволення. Обійти з боку git неможливо — або дозвіл у токені, або
#     файл не їде.
#
#  Цей файл прибирає ci.yml з коміта (з диска НЕ видаляє) і відправляє все
#  інше — насамперед виправлення витоку. Як увімкнути CI — написано в кінці,
#  коли скрипт відпрацює.
#
#  Двічі клацнути в Finder. Запускати один раз.

cd "$(dirname "$0")" || exit 1

NEW_URL="https://github.com/matwhh/Forge.git"
BRANCH="main"

G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
fail() { printf "\n${R}✕ %s${N}\n" "$1"; printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1; }

printf "\n${B}FORGE — ремонт відправки${N}\n\n"

command -v git >/dev/null 2>&1 || fail "немає git"
[ -d .git ] || fail "тут немає репозиторію — поклади цей файл у теку «forge release»"

if [ -f .git/index.lock ]; then
  pgrep -x git >/dev/null 2>&1 && fail "зараз працює інший git — закрий його й запусти ще раз"
  printf "${Y}· прибираю замок від перерваного git${N}\n"
  rm -f .git/index.lock || fail "не вдалося прибрати .git/index.lock"
fi

git config user.name  "matwhh"
git config user.email "152515220+matwhh@users.noreply.github.com"

# --- 1. Нова адреса — і в git, і в скрипті публікації ---------------------
printf "· адреса репозиторію → %s\n" "$NEW_URL"
git remote set-url origin "$NEW_URL" || fail "не вдалося змінити адресу origin"
if [ -f "Опублікувати.command" ]; then
  # Без sed -i: його синтаксис різний у macOS і GNU, а перезапис умісту
  # через тимчасовий файл ще й зберігає права на виконання.
  tmp="$(mktemp)"
  if sed "s|^REPO_URL=.*|REPO_URL=\"$NEW_URL\"|" "Опублікувати.command" > "$tmp" \
     && [ -s "$tmp" ] && cat "$tmp" > "Опублікувати.command"; then
    printf "· адресу в Опублікувати.command теж оновлено\n"
  fi
  rm -f "$tmp"
fi

# --- 2. Забрати ci.yml з коміта ------------------------------------------
#
# Коміт ще не відправлений, тому переписуємо його на місці (--amend):
# так у гілці не лишиться коміта, який створює workflow, і GitHub не має
# до чого чіплятись. Force-push для цього не потрібен — на сервері цього
# коміта ще немає.
git fetch -q origin "$BRANCH" 2>/dev/null

if git ls-files --error-unmatch .github/workflows/ci.yml >/dev/null 2>&1; then
  printf "· знімаю .github/ з обліку (файл лишається на диску)\n"
  git rm -r -q --cached .github || fail "не вдалося зняти .github з обліку"

  # Щоб git add -A у скрипті публікації не повернув його назад.
  if ! grep -qxF '.github/' .gitignore 2>/dev/null; then
    {
      printf '\n# Тимчасово: токен для пуша не має права workflow, і GitHub\n'
      printf '# відхиляє коміти з .github/workflows/. Файл лежить на диску й\n'
      printf '# чекає. Щоб увімкнути CI — прибери цей рядок і опублікуй.\n'
      printf '.github/\n'
    } >> .gitignore
  fi
  git add .gitignore
  git commit -q --amend --no-edit || fail "не вдалося переписати коміт"
fi

# Остаточна перевірка: жоден невідправлений коміт не чіпає workflow.
if git rev-parse --verify -q "origin/$BRANCH" >/dev/null 2>&1; then
  if git log --name-only --format="" "origin/$BRANCH..HEAD" | grep -q '^\.github/workflows/'; then
    fail "у невідправлених комітах усе ще є .github/workflows — тут потрібне право workflow у токені"
  fi
fi

# --- 3. Відправка ---------------------------------------------------------
printf "· відправляю на GitHub…\n"
if ! git push -u origin "$BRANCH" 2>/tmp/forge-fix-push.log; then
  printf "\n${R}Не вдалося відправити.${N}\n%s\n" "$(cat /tmp/forge-fix-push.log)"
  printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1
fi

printf "\n${G}✓ Готово.${N} Виправлення поїхало, Vercel збирає сайт.\n"
printf "  Бекап перестане віддаватись сайтом за ~30 секунд.\n"
printf "\n${B}Щоб увімкнути CI (необовʼязково):${N}\n"
printf "  1. github.com → Settings → Developer settings → Personal access tokens\n"
printf "  2. відкрий той токен, яким пушиш, і додай право ${B}workflow${N}\n"
printf "     (значення токена не змінюється — у звʼязці ключів нічого правити не треба)\n"
printf "  3. прибери рядок .github/ з .gitignore у цій теці\n"
printf "  4. натисни Опублікувати.command\n"
printf "\nНатисни Enter, щоб закрити."; read -r _
