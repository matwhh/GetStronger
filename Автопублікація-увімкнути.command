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

# --- 2. Перша публікація просто зараз ---------------------------------------
#
# Спершу прогін у цьому вікні, і лише потім агент. Порядок не випадковий:
# тут видно і тести, і помилки git, і — головне — цей запуск має права
# Терміналу, тому він точно дістане до файлів. Якщо щось не так, ти
# бачиш це одразу, а не через хвилину в журналі.
printf "· перевіряю доступ і проганяю тести…\n\n"
bash tools/auto-publish.sh
RC=$?
echo

if [ -f .git/forge-auto/failed ]; then
  printf "${Y}Тести зараз падають — тому нічого не відправлено.${N}\n"
  printf "Агент усе одно поставлю: полагодиш — опублікує сам.\n"
  printf "Що саме впало: ${B}Автопублікація-стан.command${N}\n\n"
elif [ $RC -ne 0 ]; then
  printf "${Y}Публікація не пройшла.${N} Подробиці: Автопублікація-стан.command\n\n"
fi

# --- 3. Агент ---------------------------------------------------------------
#
# bootstrap — сучасний спосіб; load -w лишили для старих macOS.
launchctl bootout "gui/$UID_/$LABEL" >/dev/null 2>&1
if ! launchctl bootstrap "gui/$UID_" "$PLIST" >/dev/null 2>&1; then
  launchctl load -w "$PLIST" >/dev/null 2>&1 || fail "launchctl не прийняв розклад"
fi
launchctl enable "gui/$UID_/$LABEL" >/dev/null 2>&1
printf "· агент запущено\n"

# --- 4. Чи справді агент дістає до теки -------------------------------------
#
# Головний ризик — не launchd, а macOS: тека лежить на Робочому столі,
# і фоновим процесам доступ туди система дає окремо від Терміналу. Тому
# мітку про відмову лишає сам робочий скрипт, а тут ми просто чекаємо
# його першого прогону й дивимось.
rm -f .git/forge-auto/blocked
: > .git/forge-auto/launchd.err
launchctl kickstart -k "gui/$UID_/$LABEL" >/dev/null 2>&1
printf "· чекаю першого прогону агента"
for _ in 1 2 3 4 5 6 7 8 9 10; do printf "."; sleep 1; done
echo; echo

# Два незалежні сліди відмови. Мітку blocked ставить сам скрипт, коли
# дійшов до git. Але macOS може не дати launchd навіть ВІДКРИТИ скрипт —
# тоді слід лишається лише в launchd.err («Operation not permitted»), а
# мітки нема. Перша версія перевіряла тільки мітку і казала «Готово» на
# агента, який не запустився жодного разу. Тому дивимось на обидва.
TCC=""
[ -f .git/forge-auto/blocked ] && TCC=1
grep -q "Operation not permitted" .git/forge-auto/launchd.err 2>/dev/null && TCC=1

if [ -n "$TCC" ]; then
  printf "${R}Агент поставлено, але macOS не дає йому читати теку.${N}\n\n"
  printf "Це захист Робочого столу: Терміналу доступ уже дано, фоновим — ні.\n"
  printf "Полагодити так:\n"
  printf "  Системні параметри → Конфіденційність і безпека → Повний доступ до диска\n"
  printf "  → «+» → Cmd+Shift+G → ${B}/bin/bash${N} → Відкрити → увімкнути перемикач\n\n"
  printf "Потім запусти цей файл ще раз.\n\n"
  printf "Інший шлях без цього дозволу — перенести теку релізу з Робочого столу\n"
  printf "(наприклад, у ~/my-project): туди macOS фонових процесів не обмежує.\n"
  printf "Доки не полагоджено — публікуй кнопкою «Опублікувати».\n"
else
  printf "${G}✓ Готово. Кнопку тиснути більше не треба.${N}\n\n"
  printf "  Раз на хвилину перевіряються зміни в теці.\n"
  printf "  Знайшлись → тести → коміт → GitHub → Vercel.\n"
  printf "  Тести впали → не відправляється нічого, приходить сповіщення.\n\n"
  printf "  Стан і журнал: ${B}Автопублікація-стан.command${N}\n"
  printf "  Вимкнути:      ${B}Автопублікація-вимкнути.command${N}\n"
  printf "  Кнопка «Опублікувати» лишається — нею можна штовхнути вручну.\n"
fi

printf "\nНатисни Enter, щоб закрити."; read -r _
