#!/bin/bash
#
#  FORGE — стан автопублікації.
#
#  Показує: чи агент живий, що зараз незбережено, коли була остання
#  публікація, і — якщо щось пішло не так — чому саме.
#
cd "$(dirname "$0")" || exit 1
[ -d .git ] || cd .. || exit 1

G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; D=$'\033[2m'; N=$'\033[0m'
LABEL="com.forge.autopublish"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
S=".git/forge-auto"
UID_="$(id -u)"

printf "\n${B}FORGE — стан автопублікації${N}\n\n"

# --- Агент ----------------------------------------------------------------
if [ ! -f "$PLIST" ]; then
  printf "Агент:      ${Y}не встановлений${N}  (Автопублікація-увімкнути.command)\n"
elif launchctl print "gui/$UID_/$LABEL" >/dev/null 2>&1; then
  printf "Агент:      ${G}працює${N}, перевірка раз на хвилину\n"
else
  printf "Агент:      ${R}встановлений, але не запущений${N}  (запусти увімкнення ще раз)\n"
fi

# --- Перепони -------------------------------------------------------------
if [ -f "$S/blocked" ] || { [ -f "$S/launchd.err" ] && tail -n 20 "$S/launchd.err" | grep -q "Operation not permitted"; }; then
  printf "Доступ:     ${R}macOS не пускає агента до теки — він НЕ працює${N}\n"
  printf "            Системні параметри → Конфіденційність і безпека →\n"
  printf "            Повний доступ до диска → «+» → Cmd+Shift+G → /bin/bash\n"
fi
if [ -f "$S/failed" ]; then
  printf "Тести:      ${R}падають — публікація зупинена${N}\n"
else
  printf "Тести:      ${G}проходять${N}\n"
fi

# --- Файли ----------------------------------------------------------------
CH="$(git --no-optional-locks status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if [ "$CH" = "0" ]; then
  printf "Зміни:      немає — усе вже на GitHub\n"
else
  printf "Зміни:      ${Y}%s файл(ів) чекають${N}\n" "$CH"
  git --no-optional-locks status --porcelain 2>/dev/null | head -n 10 | sed 's/^/            /'
  [ "$CH" -gt 10 ] && printf "            ${D}…та ще %s${N}\n" "$((CH - 10))"
fi
[ -f .forge-publish ] && printf "Запит:      ${Y}є — публікація на найближчій хвилині${N}\n"

# --- Історія --------------------------------------------------------------
printf "\n${B}Останні коміти${N}\n"
git --no-optional-locks log --oneline -5 2>/dev/null | sed 's/^/  /'

if [ -s "$S/publish.log" ]; then
  printf "\n${B}Журнал автопублікації${N} ${D}(останнє)${N}\n"
  tail -n 12 "$S/publish.log" | sed 's/^/  /'
fi

if [ -f "$S/failed" ] && [ -s "$S/tests.log" ]; then
  printf "\n${B}Чому впали тести${N}\n"
  grep -E "^(not ok|# fail|✕|Error|FAIL)" "$S/tests.log" | head -n 15 | sed 's/^/  /'
  printf "  ${D}повний вивід: .git/forge-auto/tests.log${N}\n"
fi

if [ -s "$S/push.log" ] && grep -qi "error\|denied\|rejected\|fatal" "$S/push.log" 2>/dev/null; then
  printf "\n${B}Остання помилка відправки${N}\n"
  tail -n 6 "$S/push.log" | sed 's/^/  /'
fi

printf "\nСайт: https://forge-mold1.vercel.app\n"
printf "Тести на GitHub: https://github.com/matwhh/Forge/actions\n"
printf "\nНатисни Enter, щоб закрити."; read -r _
