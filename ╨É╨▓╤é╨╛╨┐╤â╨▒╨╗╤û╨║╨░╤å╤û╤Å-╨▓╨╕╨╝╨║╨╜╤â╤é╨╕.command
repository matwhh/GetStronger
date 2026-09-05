#!/bin/bash
#
#  FORGE — вимкнути автопублікацію.
#
#  Зміни в теці лишаються на місці: вимикається лише те, що само
#  комітить і відправляє. Публікувати далі можна кнопкою «Опублікувати».
#
cd "$(dirname "$0")" || exit 1
[ -d .git ] || cd .. || exit 1

G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
LABEL="com.forge.autopublish"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_="$(id -u)"

printf "\n${B}FORGE — вимкнення автопублікації${N}\n\n"

launchctl bootout "gui/$UID_/$LABEL" >/dev/null 2>&1 || launchctl unload -w "$PLIST" >/dev/null 2>&1
rm -f "$PLIST"

if launchctl print "gui/$UID_/$LABEL" >/dev/null 2>&1; then
  printf "${Y}Агент усе ще в системі. Спробуй ще раз або перезайди в акаунт.${N}\n"
else
  printf "${G}✓ Вимкнено.${N} Само нічого більше не відправлятиметься.\n"
  printf "  Публікувати вручну: ${B}Опублікувати.command${N}\n"
  printf "  Увімкнути назад:    ${B}Автопублікація-увімкнути.command${N}\n"
fi

printf "\nНатисни Enter, щоб закрити."; read -r _
