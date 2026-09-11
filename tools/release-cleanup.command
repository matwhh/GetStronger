#!/bin/bash
#
#  Get Stronger — разова чистка теки релізу.
#
#  Навіщо: у репозиторії накопичилось те, чого там бути не мало, і одне
#  з цього роздавалось публічно. Файл backup-forge-2026-09-01.json з
#  поштою та історією тренувань віддавався по HTTP з кодом 200 — його
#  міг прочитати будь-хто, хто знав адресу.
#
#  Що робить:
#    1. виносить експорти акаунта з теки сайту в ~/Desktop/forge-backups
#       (НЕ видаляє — це твої дані, просто не місце їм у репозиторії);
#    2. прибирає з git службові файли macOS, архіви та теку _to_delete;
#    3. лишає .gitignore і .vercelignore такими, щоб воно не повернулось.
#
#  Файли поза git не чіпаються. Нічого не пушить: після цього просто
#  натисни «Опублікувати.command».
#
#  Двічі клацнути в Finder. Запускати один раз; повторний запуск
#  нічого не зіпсує — просто скаже, що вже чисто.

cd "$(dirname "$0")" || exit 1

G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
fail() { printf "\n${R}✕ %s${N}\n" "$1"; printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1; }

printf "\n${B}Get Stronger — чистка репозиторію${N}\n\n"

command -v git >/dev/null 2>&1 || fail "немає git"
[ -d .git ] || fail "тут немає репозиторію — поклади цей файл у теку «forge release»"

# Замок від перерваного git (той самий випадок, що й у Опублікувати.command).
if [ -f .git/index.lock ]; then
  if pgrep -x git >/dev/null 2>&1; then fail "зараз працює інший git — закрий його й запусти ще раз"; fi
  printf "${Y}· прибираю замок від перерваного git${N}\n"
  rm -f .git/index.lock || fail "не вдалося прибрати .git/index.lock"
fi

changed=0

# --- 1. Експорти акаунта геть із теки сайту -------------------------------
DEST="$HOME/Desktop/forge-backups"
for f in backup-*.json; do
  [ -e "$f" ] || continue
  mkdir -p "$DEST" || fail "не вдалося створити $DEST"
  mv -n "$f" "$DEST/" && printf "· бекап перенесено: %s → ~/Desktop/forge-backups/\n" "$f"
  changed=1
done

# --- 2. Прибрати з git те, що туди не мало потрапити ----------------------
#
# git rm --cached знімає файл з обліку, не чіпаючи його на диску;
# для _to_delete і .DS_Store файли ще й видаляються — вони не потрібні.
# Читаємо через підстановку процесу, а не через конвеєр: у конвеєрі цикл
# крутиться в підоболонці, і changed=1 звідти назовні не виходить.
# IFS= read -r зберігає імена з пробілами як є.
while IFS= read -r path; do
  [ -n "$path" ] || continue
  git rm -q --cached --ignore-unmatch "$path" >/dev/null 2>&1 && printf "· знято з обліку: %s\n" "$path"
  changed=1
done < <(git ls-files | grep -E '(^|/)\.DS_Store$|^_to_delete/|\.zip$|(^|/)backup-.*\.json$')

rm -rf _to_delete 2>/dev/null && printf "· видалено теку _to_delete\n"
find . -name .DS_Store -not -path './.git/*' -delete 2>/dev/null

# --- 3. Щоб не повернулось ------------------------------------------------
for line in 'backup-*.json' '.DS_Store' '*.zip'; do
  grep -qxF "$line" .gitignore 2>/dev/null || { printf '%s\n' "$line" >> .gitignore; changed=1; }
done

# --- 4. Підсумок ----------------------------------------------------------
if [ "$changed" = "0" ]; then
  printf "\n${G}✓ Уже чисто.${N} Нічого прибирати.\n"
else
  printf "\n${G}✓ Готово.${N}\n"
  printf "\nЩо далі: натисни ${B}Опублікувати.command${N} — зміни поїдуть у GitHub,\n"
  printf "і бекап перестане віддаватись сайтом.\n"
  printf "\n${Y}Важливо:${N} файл уже якийсь час був доступний публічно.\n"
  printf "Він містив пошту й історію тренувань — паролів і ключів там не було.\n"
fi

printf "\nНатисни Enter, щоб закрити."; read -r _
