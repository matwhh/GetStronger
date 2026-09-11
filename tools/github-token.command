#!/bin/bash
# Готує macOS до нового токена GitHub.
#
# ПРОБЛЕМА, ЯКУ ЦЕ ВИРІШУЄ. Токен лежить не у файлі, а в Зв'язці ключів
# macOS. Коли старий токен спливає, git НЕ питає новий — він мовчки бере
# з Зв'язки протухлий і отримує 403. Виглядає як «GitHub зламався».
# Тому старий запис треба спершу стерти: тоді при наступному push git
# спитає логін і пароль, і в поле пароля вставляється новий токен.
#
# Скрипт нічого не надсилає й нічого не зберігає. Він лише забуває старе.
set -u
cd "$(dirname "$0")"

printf '\n=== Новий токен GitHub ===\n\n'
printf 'Спершу створи токен у браузері (якщо ще не створив):\n'
printf '  1. github.com/settings/personal-access-tokens → Generate new token → Fine-grained\n'
printf '  2. Repository access → Only select repositories → matwhh/Get-Stronger\n'
printf '  3. Repository permissions: Contents = Read and write, Workflows = Read and write\n'
printf '  4. Термін 1 рік. Скопіюй токен — його показують ОДИН раз.\n\n'
printf 'Токен нікуди не вставляй у цей скрипт. Його спитає сам git.\n\n'
read -r -p 'Токен уже скопійовано? Enter — далі, Ctrl+C — вийти. ' _

printf '\nСтираю старий запис github.com зі Зв'"'"'язки ключів...\n'
printf 'protocol=https\nhost=github.com\n\n' | git credential-osxkeychain erase 2>/dev/null
printf 'protocol=https\nhost=github.com\nusername=matwhh\n\n' | git credential-osxkeychain erase 2>/dev/null
printf 'Готово.\n\n'

printf 'Перевіряю доступ. Git зараз спитає:\n'
printf '  Username — matwhh\n'
printf '  Password — ВСТАВ НОВИЙ ТОКЕН (не пароль від GitHub)\n\n'

if git ls-remote https://github.com/matwhh/Get-Stronger.git HEAD >/dev/null 2>&1; then
  printf '\nOK: доступ до репозиторію є. Тепер публікація працюватиме.\n'
else
  printf '\nНЕ ВИЙШЛО. Найчастіші причини:\n'
  printf '  · у поле Password вставлено пароль від GitHub, а не токен\n'
  printf '  · у токена не дано Contents = Read and write\n'
  printf '  · токен видано не на репозиторій matwhh/Get-Stronger\n'
  printf 'Запусти цей файл ще раз після виправлення.\n'
fi

printf '\nВікно можна закрити.\n'
read -r -p '' _
