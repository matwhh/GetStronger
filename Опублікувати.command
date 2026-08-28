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

# Знятий замок від перерваного git.
#
# .git/index.lock лишається, якщо попередній git убили посеред роботи або
# він працював із мережевої/зовнішньої файлової системи без права на
# видалення. Сам по собі він не зникає, і КОЖЕН наступний запуск падає на
# "index.lock: File exists" — тобто кнопка мертва до ручного втручання.
# Тому знімаємо його самі, але тільки якщо жоден git зараз не працює.
if [ -f .git/index.lock ]; then
  if pgrep -x git >/dev/null 2>&1; then
    fail "Зараз працює інший git. Закрий його й запусти ще раз."
  fi
  say "${Y}· прибираю замок від перерваного git${N}"
  rm -f .git/index.lock || fail "не вдалося прибрати .git/index.lock — видали цей файл вручну"
fi

git add -A || fail "git add не спрацював"

MSG="${1:-оновлення $(date '+%d.%m.%Y %H:%M')}"
if git diff --cached --quiet 2>/dev/null && git rev-parse HEAD >/dev/null 2>&1; then
  # Змін у файлах немає — але кнопку натиснули, отже хочуть перезбірку.
  # Порожній коміт дає Vercel привід зібрати сайт наново: без нового пуша
  # він просто нічого не робить.
  say "${Y}· змін у файлах немає — роблю порожній коміт для перезбірки${N}"
  git -c commit.gpgsign=false commit -q --allow-empty -m "перезбірка $(date '+%d.%m.%Y %H:%M')" \
    || fail "git commit не спрацював"
else
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
