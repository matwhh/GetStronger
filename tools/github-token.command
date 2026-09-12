#!/bin/bash
#
#  Новий токен GitHub — і одразу публікація.
#
#  ЩО ЦЕ РОБИТЬ. Питає токен, кладе його в Звʼязку ключів macOS, перевіряє
#  доступ до репозиторію і, якщо все добре, сам запускає публікацію. Від
#  людини потрібна одна дія: вставити токен.
#
#  ЧОМУ ВЗАГАЛІ ПОТРІБЕН ОКРЕМИЙ СКРИПТ. Токен лежить не у файлі, а в
#  Звʼязці ключів. Коли старий спливає, git НЕ питає новий — він мовчки
#  бере з Звʼязки протухлий і отримує відмову. Виглядає як «GitHub
#  зламався», а насправді треба спершу СТЕРТИ старий запис. Саме цей крок
#  люди й не знаходять.
#
#  ТОКЕН НІКУДИ НЕ ЗАПИСУЄТЬСЯ. Ні у файл, ні в історію команд, ні на
#  екран: read -s не показує введене, а далі значення йде просто в git.
#
set -u
cd "$(dirname "$0")/.."

G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
OWNER="matwhh"
REPO_URL="https://github.com/matwhh/GetStronger.git"
END() { printf '\nНатисни Enter, щоб закрити вікно.'; read -r _; exit "${1:-0}"; }

printf "\n${B}Новий токен GitHub${N}\n\n"

command -v git >/dev/null 2>&1 || { printf "${R}Немає git.${N} Постав Xcode Command Line Tools: xcode-select --install\n"; END 1; }

# --- 1. Де взяти токен ----------------------------------------------------
printf "Якщо токен ще не створений — ось готове посилання, там уже\n"
printf "проставлені і назва, і права:\n\n"
printf "  ${B}github.com/settings/tokens/new?scopes=repo,workflow&description=Get+Stronger+publish${N}\n\n"
printf "Прокрути донизу → ${B}Generate token${N} → скопіюй його (показують ОДИН раз).\n\n"
open "https://github.com/settings/tokens/new?scopes=repo,workflow&description=Get+Stronger+publish" 2>/dev/null

# --- 2. Взяти токен -------------------------------------------------------
printf "Тепер встав токен сюди (${B}Cmd+V${N}) і натисни Enter.\n"
printf "На екрані нічого не зʼявиться — так і має бути, це пароль.\n\n"
printf "Токен: "
read -rs TOKEN
printf "\n\n"

# Пробіли з країв зрізаємо: копіювання з браузера часто тягне за собою
# кінець рядка, і git отримує токен, якого «не існує».
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"

if [ -z "$TOKEN" ]; then
  printf "${R}Нічого не вставлено.${N} Запусти файл ще раз.\n"; END 1
fi
case "$TOKEN" in
  ghp_*|github_pat_*) : ;;
  *) printf "${Y}Це не схоже на токен GitHub.${N}\n"
     printf "Токени починаються з ${B}ghp_${N} або ${B}github_pat_${N}.\n"
     printf "Схоже, скопійовано щось інше — пароль від GitHub не підійде.\n"; END 1 ;;
esac

# --- 3. Покласти в Звʼязку ключів ----------------------------------------
# Без помічника git нікуди токен не збереже й питатиме його щоразу.
[ -n "$(git config --global --get credential.helper || true)" ] || \
  git config --global credential.helper osxkeychain

printf "· стираю старий запис github.com…\n"
printf 'protocol=https\nhost=github.com\n\n' | git credential-osxkeychain erase 2>/dev/null
printf 'protocol=https\nhost=github.com\nusername=%s\n\n' "$OWNER" | git credential-osxkeychain erase 2>/dev/null

printf "· зберігаю новий…\n"
printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' "$OWNER" "$TOKEN" \
  | git credential approve
unset TOKEN

# --- 4. Перевірити --------------------------------------------------------
# GIT_TERMINAL_PROMPT=0: якщо токен не підійшов, git має ВПАСТИ, а не
# питати логін ще раз — інакше людина сидить перед німим запитом.
printf "· перевіряю доступ…\n"
if GIT_TERMINAL_PROMPT=0 git ls-remote "$REPO_URL" HEAD >/dev/null 2>&1; then
  printf "\n${G}✓ Токен працює.${N}\n"
else
  printf "\n${R}Не пустило.${N} Найчастіші причини:\n"
  printf "  · у токена не дано ${B}repo${N} (Contents: Read and write)\n"
  printf "  · токен видано не на цей репозиторій\n"
  printf "  · скопійовано не весь рядок\n\n"
  printf "Створи токен заново за посиланням вище й запусти цей файл ще раз.\n"
  END 1
fi

# --- 5. Одразу публікація -------------------------------------------------
PUB="Опублікувати.command"
if [ -x "$PUB" ]; then
  printf "\n${B}Публікую…${N}\n"
  exec "./$PUB"
fi
printf "\nТепер запусти «Опублікувати.command».\n"
END 0
