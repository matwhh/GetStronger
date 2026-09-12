#!/bin/bash
#
#  Get Stronger — публікація одним кліком.
#
#  Двічі клацнути в Finder → усі зміни їдуть на GitHub, а Vercel сам
#  збирає й викладає сайт. Нічого вводити не треба.
#
#  Репозиторій, куди все їде. Якщо колись переїде — міняти тільки цей рядок.
#  Назва тут ОДНА: нижче вона не переписується руками, а виймається з
#  адреси. Саме розбіжність між ними й зламала публікацію — в адресі
#  стояло Get-Stronger, а на GitHub репозиторій зветься GetStronger.
REPO_URL="https://github.com/matwhh/GetStronger.git"
BRANCH="main"
REPO_NAME="${REPO_URL##*/}"; REPO_NAME="${REPO_NAME%.git}"
REPO_OWNER="${REPO_URL%/*}"; REPO_OWNER="${REPO_OWNER##*/}"

cd "$(dirname "$0")" || exit 1

# Кольори лише для читабельності: жодної логіки на них не зав'язано.
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'

say()  { printf "%s\n" "$1"; }
fail() { printf "\n${R}✕ %s${N}\n" "$1"; printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1; }

printf "\n${B}Get Stronger → GitHub → Vercel${N}\n\n"

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

# --- 1b. Підпис коміта ----------------------------------------------------
#
# Vercel БЛОКУЄ збірку, якщо пошта автора коміта не належить акаунту GitHub.
# Коли user.email у git не налаштована, git підставляє вигадану на кшталт
# matthew@MacBook-Air-Matvij.local — і кожен пуш блокується.
#
# Ставимо адресу-невидимку GitHub: вона назавжди привʼязана до акаунта
# matwhh, не розкриває справжню пошту й гарантовано проходить перевірку.
# Налаштування ЛОКАЛЬНЕ (лише цей репозиторій) — глобальний git не чіпаємо.
git config user.name  "matwhh"
git config user.email "152515220+matwhh@users.noreply.github.com"

# --- 2. Віддалений сервер -------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  say "· підключаю GitHub…"
  git remote add origin "$REPO_URL" || fail "не вдалося додати origin"
fi

# --- 2.5. Ворота: тести ---------------------------------------------------
#
# Публікація без тестів — це публікація наосліп. Раніше ворота стояли в
# автопублікації (tools/auto-publish.sh); її вирізали, і разом з нею
# зникла єдина перевірка перед пушем. Тепер вони тут.
#
# Червоні тести або гігієна = НІЧОГО не відправлено. Це навмисно: краще
# кнопка, яка відмовила з поясненням, ніж зламаний сайт у продакшені.
#
# ~12 секунд на 721 тест. Це дешевше за один відкат.
if ! command -v node >/dev/null 2>&1; then
  fail "node не знайдено — без тестів не публікуємо. Постав: brew install node"
fi

say "· тести…"
if ! node --test tests/*.test.js > /tmp/forge-tests.log 2>&1; then
  echo
  tail -n 25 /tmp/forge-tests.log
  echo
  fail "ТЕСТИ ЧЕРВОНІ — нічого не відправлено. Повний вивід: /tmp/forge-tests.log"
fi
grep -E '^# (tests|pass|fail)' /tmp/forge-tests.log | sed 's/^/  /'

say "· гігієна…"
if ! node tools/ci-hygiene.mjs > /tmp/forge-hygiene.log 2>&1; then
  echo
  tail -n 20 /tmp/forge-hygiene.log
  echo
  fail "ГІГІЄНА ЧЕРВОНА — нічого не відправлено."
fi
tail -n 1 /tmp/forge-hygiene.log | sed 's/^/  /'

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

# Скільки комітів іще не на GitHub. Якщо origin/main ще немає (найперший
# пуш) — рахуємо всі.
# RANGE рахуємо ОКРЕМО від pending(): pending викликається через $(...),
# тобто в підоболонці, і присвоєння змінної звідти назовні не доїжджає —
# RANGE лишався порожнім, а список комітів показувався не той.
if git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null 2>&1; then
  RANGE="origin/$BRANCH..HEAD"
else
  RANGE="HEAD"
fi
pending() { git rev-list --count "$RANGE" 2>/dev/null || echo 0; }

# 1 коміт, 2 коміти, 5 комітів — інакше кнопка говорить як робот.
komit() {
  case "$1" in
    1)         printf 'коміт' ;;
    2|3|4)     printf 'коміти' ;;
    *)         printf 'комітів' ;;
  esac
}

MSG="${1:-оновлення $(date '+%d.%m.%Y %H:%M')}"
if ! git diff --cached --quiet 2>/dev/null; then
  say "· зберігаю зміни: $MSG"
  git -c commit.gpgsign=false commit -q -m "$MSG" || fail "git commit не спрацював"
elif [ "$(pending)" -gt 0 ]; then
  #
  # ЧОМУ ЦЕ ТУТ. Раніше скрипт дивився лише на робочу теку: немає правок —
  # ліпить порожній коміт «перезбірка …». Але коміти часто вже зроблені й
  # просто не відправлені, і тоді порожній не потрібен — він лише засмічує
  # історію записами ні про що. Тепер питання ставиться правильно: не «чи
  # є незбережені правки», а «чи є що відправляти».
  #
  say "· нових правок немає — відправляю те, що вже готове"
else
  say "${Y}· публікувати нічого — роблю порожній коміт, щоб Vercel перезібрав${N}"
  git -c commit.gpgsign=false commit -q --allow-empty -m "перезбірка $(date '+%d.%m.%Y %H:%M')" \
    || fail "git commit не спрацював"
fi

# --- 4. Відправка ---------------------------------------------------------
#
# Якщо верхівка підписана старою (невалідною) поштою — переписуємо автора,
# інакше Vercel блокуватиме її знову й знову. Force-push тут безпечний:
# репозиторій односібний, і йдеться про той самий, щойно зроблений коміт.
FORCE=""
LAST_MAIL="$(git log -1 --format='%ae' 2>/dev/null)"
case "$LAST_MAIL" in
  *".local"|"") ;;
  *) LAST_MAIL="" ;;
esac
if [ -n "$LAST_MAIL" ]; then
  say "${Y}· переписую підпис старого коміта ($LAST_MAIL)${N}"
  git -c commit.gpgsign=false commit -q --amend --reset-author --no-edit || fail "не вдалося переписати коміт"
  FORCE="--force-with-lease"
fi

# Показати, що саме поїде: інакше кнопка просить довіри наосліп.
CNT="$(pending)"
if [ "$CNT" -gt 0 ]; then
  printf "\n${B}Поїде %s %s:${N}\n" "$CNT" "$(komit "$CNT")"
  git log --format='  · %s' "$RANGE" | head -n 8
  [ "$CNT" -gt 8 ] && printf "  … і ще %s\n" "$((CNT - 8))"
  printf "\n"
fi

say "· відправляю на GitHub…"
if ! git push -u $FORCE origin "$BRANCH" 2>/tmp/forge-push.log; then
  ERR="$(cat /tmp/forge-push.log)"
  printf "\n${R}Не вдалося відправити.${N}\n%s\n" "$ERR"
  case "$ERR" in
    # Мережу перевіряємо ПЕРШОЮ. Інакше «немає інтернету» ловилось нижче
    # як «потрібен вхід», і людина йшла перевипускати цілком живий токен.
    *"Could not resolve host"*|*"Failed to connect"*|*"Operation timed out"*|\
    *"proxy"*|*"Network is unreachable"*|*"Connection refused"*)
      printf "\n${Y}Схоже, немає звʼязку з GitHub.${N}\n"
      printf "Перевір інтернет і запусти ще раз. Токен тут ні до чого:\n"
      printf "твої коміти нікуди не зникли, вони чекають на диску.\n"
      ;;
    *"Repository not found"*|*"not found"*)
      # Для ПРИВАТНОГО репозиторію GitHub навмисно віддає «not found» і
      # тоді, коли він існує, але доступ протух: щоб не підказувати
      # стороннім, що такий репозиторій є. Тому причин рівно дві, і
      # вгадувати за нас не треба — обидві названо.
      printf "\n${Y}GitHub каже, що за цією адресою нічого немає:${N}\n"
      printf "  %s\n\n" "${REPO_URL%.git}"
      printf "Причин дві, і обидві просто перевірити.\n\n"
      printf "  ${B}1. Назва не збігається.${N} Відкрий список своїх репозиторіїв і\n"
      printf "     звір назву ЛІТЕРА В ЛІТЕРУ — дефіс і регістр мають значення.\n"
      printf "     Якщо там інша — виправ рядок REPO_URL на початку цього файла.\n\n"
      printf "  ${B}2. Доступ протух.${N} Токен GitHub має строк придатності; коли він\n"
      printf "     минає, приватний репозиторій починає виглядати як неіснуючий.\n"
      printf "     Лікується так: запусти «Токен GitHub.command».\n\n"
      printf "  3. І лише якщо репозиторію справді немає — створи його з назвою\n"
      printf "     ${B}%s${N}, тип Private, без README і без .gitignore.\n" "$REPO_NAME"
      open "https://github.com/${REPO_OWNER}?tab=repositories" 2>/dev/null
      ;;
    *"could not read Username"*|*"Authentication"*|*"denied"*|*"403"*)
      printf "\n${Y}GitHub не пустив: потрібен вхід.${N}\n"
      printf "Запусти ${B}«Токен GitHub.command»${N} — він усе зробить сам.\n"
      ;;
  esac
  printf "\nНатисни Enter, щоб закрити вікно."; read -r _; exit 1
fi

printf "\n${G}✓ Готово.${N} %s %s на GitHub — Vercel уже збирає сайт.\n" "$CNT" "$(komit "$CNT")"
printf "  Репозиторій: %s\n" "${REPO_URL%.git}"
printf "  Сайт:        https://get-stronger.vercel.app\n"
printf "\nЗбірка триває ~30 секунд. Можеш закривати це вікно.\n"
printf "\nНатисни Enter, щоб закрити."; read -r _
