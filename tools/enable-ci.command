#!/bin/bash
#
#  Get Stronger — увімкнути CI.
#
#  Запускати ПІСЛЯ того, як у токені зʼявилось право «workflow».
#  До того GitHub відхилить пуш, і скрипт сам відкотить усе назад.
#
#  Що робить: прибирає тимчасовий рядок .github/ з .gitignore, повертає
#  .github/workflows/ci.yml під облік git і відправляє. Далі GitHub сам
#  почне ганяти тести на кожному пуші.
#
#  Двічі клацнути в Finder.

cd "$(dirname "$0")" || exit 1

BRANCH="main"
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
fail() { printf "\n${R}✕ %s${N}\n" "$1"; printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1; }

printf "\n${B}Get Stronger — увімкнення CI${N}\n\n"

[ -d .git ] || fail "тут немає репозиторію — поклади цей файл у теку «forge release»"
[ -f .github/workflows/ci.yml ] || fail "немає .github/workflows/ci.yml — нема чого вмикати"

if [ -f .git/index.lock ]; then
  pgrep -x git >/dev/null 2>&1 && fail "зараз працює інший git — закрий його й запусти ще раз"
  rm -f .git/index.lock || fail "не вдалося прибрати .git/index.lock"
fi

git config user.name  "matwhh"
git config user.email "152515220+matwhh@users.noreply.github.com"

# Точка повернення: якщо GitHub відмовить, вертаємо все як було.
BEFORE="$(git rev-parse HEAD)"
BACKUP="$(mktemp)"; cp .gitignore "$BACKUP"

# --- 1. Прибрати тимчасовий блок із .gitignore ---------------------------
#
# Рядки видаляються за точним збігом, а не за шаблоном: так неможливо
# випадково зачепити інші правила.
TMP="$(mktemp)"
grep -v -x -F \
  -e '.github/' \
  -e '# Тимчасово: токен для пуша не має права workflow, і GitHub' \
  -e '# відхиляє коміти з .github/workflows/. Файл лежить на диску й' \
  -e '# чекає. Щоб увімкнути CI — прибери цей рядок і опублікуй.' \
  .gitignore > "$TMP" && cat "$TMP" > .gitignore
rm -f "$TMP"

if grep -qxF '.github/' .gitignore; then fail "не вдалося прибрати .github/ з .gitignore"; fi
printf "· .gitignore очищено\n"

# --- 2. Коміт і відправка -------------------------------------------------
git add -A || fail "git add не спрацював"

if git diff --cached --quiet; then
  printf "${Y}· змін немає — схоже, CI уже увімкнений${N}\n"
  rm -f "$BACKUP"
  printf "\nНатисни Enter, щоб закрити."; read -r _; exit 0
fi

git -c commit.gpgsign=false commit -q -m "ci: увімкнено перевірки на кожен пуш" \
  || fail "git commit не спрацював"

printf "· відправляю на GitHub…\n"
if git push -u origin "$BRANCH" 2>/tmp/forge-ci-push.log; then
  rm -f "$BACKUP"
  printf "\n${G}✓ Готово.${N} CI увімкнено.\n"
  printf "  Перевірити: https://github.com/matwhh/Forge/actions\n"
  printf "  Перший прогін почнеться за кілька секунд і триватиме ~30 с.\n"
  printf "\nНатисни Enter, щоб закрити."; read -r _; exit 0
fi

# --- 3. Не вийшло — вертаємо як було -------------------------------------
#
# reset --soft, а не --hard: жорсткий скинув би .github з диска, бо в
# попередньому коміті цього файла немає. Тут же гілка просто вертається
# назад, а файли лишаються недоторканими.
ERR="$(cat /tmp/forge-ci-push.log)"
git reset -q --soft "$BEFORE"
git restore --staged .github 2>/dev/null || git rm -r -q --cached --ignore-unmatch .github
cat "$BACKUP" > .gitignore; rm -f "$BACKUP"
git add .gitignore >/dev/null 2>&1

printf "\n${R}Не вдалося відправити — усе повернуто як було.${N}\n%s\n" "$ERR"
case "$ERR" in
  *workflow*)
    printf "\n${Y}Токен усе ще без права «workflow».${N}\n"
    printf "  1. відкрий https://github.com/settings/tokens\n"
    printf "  2. знайди токен, яким пушиш (підказка — колонка «Last used»)\n"
    printf "  3. класичний: постав галочку ${B}workflow${N} → Update token\n"
    printf "     дрібнозернистий: Repository permissions → Workflows → Read and write → Save\n"
    printf "  4. запусти цей файл ще раз\n"
    ;;
  *"not fast-forward"*|*"fetch first"*|*rejected*)
    printf "\n${Y}На GitHub є коміт, якого немає тут.${N} Спершу: git pull --rebase\n"
    ;;
esac
printf "\nНатисни Enter, щоб закрити."; read -r _; exit 1
