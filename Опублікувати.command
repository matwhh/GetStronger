#!/bin/bash
#
#  FORGE — публікація одним кліком.
#
#  Двічі клацнути в Finder → усі зміни їдуть на GitHub, а Vercel сам
#  збирає й викладає сайт. Нічого вводити не треба.
#
#  Репозиторій, куди все їде. Якщо колись переїде — міняти тільки цей рядок.
REPO_URL="https://github.com/matwhh/forge.git"
BRANCH="main"

cd "$(dirname "$0")" || exit 1

# Кольори лише для читабельності: жодної логіки на них не зав'язано.
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'

say()  { printf "%s\n" "$1"; }
fail() { printf "\n${R}✕ %s${N}\n" "$1"; printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1; }

printf "\n${B}FORGE → GitHub → Vercel${N}\n\n"

command -v git >/dev/null 2>&1 || fail "На цьому компʼютері немає git. Постав Xcode Command Line Tools: xcode-select --install"

# --- 1. Репозиторій -------------------------------------------------------
if [ ! -d .git ]; then
  say "· створюю локальний репозиторій…"
  git init -q -b "$BRANCH" || fail "git init не вдався"
fi

# Гілка може називатись як завгодно після git init на старих версіях git.
git symbolic-ref -q HEAD >/dev/null 2>&1 || git checkout -q -b "$BRANCH" 2>/dev/null
CUR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[ "$CUR" = "$BRANCH" ] || git branch -M "$BRANCH" 2>/dev/null

# --- 2. Віддалений сервер -------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  say "· підключаю GitHub…"
  git remote add origin "$REPO_URL" || fail "не вдалося додати origin"
fi

# --- 3. Що саме відправляємо ---------------------------------------------
[ -f .gitignore ] || cat > .gitignore <<'IGN'
node_modules/
.DS_Store
*.log
.vercel
IGN

git add -A || fail "git add не спрацював"

if git diff --cached --quiet 2>/dev/null && git rev-parse HEAD >/dev/null 2>&1; then
  say "${Y}· змін немає — відправляти нічого${N}"
else
  MSG="${1:-оновлення $(date '+%d.%m.%Y %H:%M')}"
  say "· зберігаю зміни: $MSG"
  git -c commit.gpgsign=false commit -q -m "$MSG" || fail "git commit не спрацював"
fi

# --- 4. Відправка ---------------------------------------------------------
say "· відправляю на GitHub…"
if ! git push -u origin "$BRANCH" 2>/tmp/forge-push.log; then
  ERR="$(cat /tmp/forge-push.log)"
  printf "\n${R}Не вдалося відправити.${N}\n%s\n" "$ERR"
  case "$ERR" in
    *"Repository not found"*|*"not found"*)
      printf "\n${Y}Схоже, репозиторію ще немає.${N}\n"
      printf "Зараз відкрию сторінку створення — назви його ${B}forge${N}, тип Private,\n"
      printf "НІЧОГО не додавай (без README, без .gitignore) і натисни Create.\n"
      printf "Потім просто запусти цей файл ще раз.\n"
      open "https://github.com/new?name=forge&visibility=private" 2>/dev/null
      ;;
    *"could not read Username"*|*"Authentication"*|*"denied"*|*"403"*)
      printf "\n${Y}GitHub не пустив: потрібен вхід.${N}\n"
      printf "Найпростіше — постав GitHub CLI і залогінься один раз:\n"
      printf "  brew install gh && gh auth login\n"
      ;;
  esac
  printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1
fi

printf "\n${G}✓ Готово.${N} Усе на GitHub — Vercel уже збирає сайт.\n"
printf "  Репозиторій: %s\n" "${REPO_URL%.git}"
printf "  Сайт:        https://forge-mold1.vercel.app\n"
printf "\nЗбірка триває ~30 секунд. Можеш закривати це вікно.\n"
printf "\nНатисни Enter, щоб закрити."; read -r _
