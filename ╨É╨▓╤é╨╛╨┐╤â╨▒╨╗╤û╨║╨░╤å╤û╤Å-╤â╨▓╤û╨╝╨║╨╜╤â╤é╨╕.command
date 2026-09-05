#!/bin/bash
#
#  FORGE — увімкнути автопублікацію.
#
#  Двічі клацнути в Finder ОДИН раз. Далі кнопку «Опублікувати» тиснути
#  не треба: раз на хвилину macOS сама перевіряє теку, і якщо є зміни —
#  проганяє тести, робить коміт і відправляє на GitHub.
#
#  Вимкнути: Автопублікація-вимкнути.command
#  Подивитись, що відбувається: Автопублікація-стан.command
#
cd "$(dirname "$0")" || exit 1
[ -d .git ] || cd .. || exit 1

G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
fail() { printf "\n${R}✕ %s${N}\n" "$1"; printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1; }

printf "\n${B}FORGE — автопублікація${N}\n\n"

[ -d .git ]                 || fail "тут немає репозиторію — поклади цей файл у теку «forge release»"
[ -f tools/auto-publish.sh ] || fail "немає tools/auto-publish.sh — без нього вмикати нічого"

REPO="$(pwd -P)"
LABEL="com.forge.autopublish"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_="$(id -u)"

chmod +x tools/auto-publish.sh 2>/dev/null

# --- 1. Файл-запису розкладу ---------------------------------------------
#
# XML не терпить голих & < >; у шляху їх бути не має, але екрануємо
# чесно — тека колись може переїхати в теку з амперсандом у назві.
esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
X_REPO="$(esc "$REPO")"

mkdir -p "$HOME/Library/LaunchAgents" || fail "не вдалося створити ~/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$X_REPO/tools/auto-publish.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$X_REPO</string>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$X_REPO/.git/forge-auto/launchd.out</string>
  <key>StandardErrorPath</key><string>$X_REPO/.git/forge-auto/launchd.err</string>
</dict>
</plist>
PLIST_EOF

mkdir -p .git/forge-auto
printf "· розклад записано: %s\n" "${PLIST/#$HOME/~}"

# --- 2. Запуск ------------------------------------------------------------
#
# bootstrap — сучасний спосіб; load -w лишили для старих macOS.
launchctl bootout "gui/$UID_/$LABEL" >/dev/null 2>&1
if ! launchctl bootstrap "gui/$UID_" "$PLIST" >/dev/null 2>&1; then
  launchctl load -w "$PLIST" >/dev/null 2>&1 || fail "launchctl не прийняв розклад"
fi
launchctl enable "gui/$UID_/$LABEL" >/dev/null 2>&1
printf "· агент запущено\n"

# --- 3. Перевірка, що воно справді може працювати -------------------------
#
# Головний ризик — не launchd, а macOS: тека лежить на Робочому столі,
# а доступ туди фоновим процесам система питає окремо. Тому одразу
# проганяємо робочий скрипт і дивимось, чи він дістав до файлів.
printf "· перевіряю доступ і тести…\n\n"
bash tools/auto-publish.sh
RC=$?

echo
if [ -f .git/forge-auto/blocked ]; then
  printf "${R}macOS не дає доступу до теки.${N}\n"
  printf "Це захист Робочого столу. Полагодити так:\n"
  printf "  Системні параметри → Конфіденційність і безпека → Повний доступ до диска\n"
  printf "  → «+» → Cmd+Shift+G → ${B}/bin/bash${N} → Відкрити → увімкнути перемикач\n"
  printf "Потім запусти цей файл ще раз.\n"
elif [ $RC -eq 1 ] && [ -f .git/forge-auto/failed ]; then
  printf "${Y}Агент працює, але тести зараз падають — тому нічого не відправлено.${N}\n"
  printf "Подробиці: Автопублікація-стан.command\n"
else
  printf "${G}✓ Готово. Кнопку тиснути більше не треба.${N}\n\n"
  printf "  Раз на хвилину перевіряються зміни в теці.\n"
  printf "  Знайшлись → проганяються тести → коміт → GitHub → Vercel.\n"
  printf "  Тести впали → нічого не відправляється, приходить сповіщення.\n\n"
  printf "  Стан і журнал: ${B}Автопублікація-стан.command${N}\n"
  printf "  Вимкнути:      ${B}Автопублікація-вимкнути.command${N}\n"
  printf "  Кнопка «Опублікувати» лишається — нею можна штовхнути вручну.\n"
fi

printf "\nНатисни Enter, щоб закрити."; read -r _
