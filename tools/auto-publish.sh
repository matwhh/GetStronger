#!/bin/bash
#
#  FORGE — автопублікація. Кнопку тиснути не треба.
#
#  ЩО ЦЕ. launchd запускає цей файл раз на хвилину. Якщо в теці релізу
#  є зміни — скрипт проганяє тести, робить коміт і відправляє на GitHub.
#  Vercel далі збирає сайт сам. Помилка в тестах = нічого не відправлено.
#
#  ЧОМУ САМЕ ТУТ, А НЕ В ХМАРІ. Ключ до GitHub лежить у звʼязці ключів
#  цього Mac. Хмарний контейнер, у якому пишеться код, до нього доступу
#  не має і мати не повинен. Тому пуш робить машина, на якій ключ уже є.
#
#  ДВА ПРИВОДИ ОПУБЛІКУВАТИ:
#    1. Файл-запит .forge-publish у корені. Його кладуть, коли зміни
#       доставлені повністю; перший рядок файла стає текстом коміта.
#       Це основний шлях: він виключає пуш посеред доставки.
#    2. Тиша. Якщо у файлах щось змінилось і вже QUIET_SECONDS нічого
#       не рухається — публікуємо самі. Це для правок руками.
#
#  СТАН лежить у .git/forge-auto/ — тобто ніколи не потрапляє в коміт.
#
#  Журнал:      .git/forge-auto/publish.log
#  Вивід тестів .git/forge-auto/tests.log
#
set -u

# launchd дає порожній PATH: усе, що не /usr/bin, треба вказати самому.
# Homebrew на Apple Silicon — /opt/homebrew, на Intel — /usr/local.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

BRANCH="main"
QUIET_SECONDS=300          # скільки секунд тиші = «зміни дороблені»
REQUEST=".forge-publish"   # файл-запит; лежить у .gitignore

# Скрипт живе в tools/, репозиторій — на рівень вище.
cd "$(dirname "$0")/.." 2>/dev/null || exit 1
REPO="$(pwd -P)"

STATE=".git/forge-auto"
LOG="$STATE/publish.log"

[ -d .git ] || { printf 'forge: %s — не репозиторій\n' "$REPO" >&2; exit 1; }
mkdir -p "$STATE" 2>/dev/null || exit 1

log() { printf '%s  %s\n' "$(date '+%d.%m %H:%M:%S')" "$1" >> "$LOG"; }

# Відбиток стану. На macOS це shasum; запасний sha1sum потрібен, щоб цей
# самий скрипт можна було проганяти на Linux під час перевірок.
sha1() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 1; else sha1sum; fi | cut -c1-40
}

# Сповіщення macOS. Текст передається аргументами, а не вклеюється в
# код AppleScript: інакше лапки чи \ у назві файла ламали б виклик.
notify() {
  /usr/bin/osascript - "$1" "$2" >/dev/null 2>&1 <<'APPLESCRIPT'
on run argv
  display notification (item 2 of argv) with title "FORGE" subtitle (item 1 of argv)
end run
APPLESCRIPT
}

# Журнал не має рости вічно.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" | tr -d ' ')" -gt 200000 ]; then
  tail -n 300 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# --- Замок ----------------------------------------------------------------
#
# mkdir атомарний — на відміну від «перевірити файл, потім створити».
# Тести можуть іти довше за хвилину, а launchd запустить наступний прогін
# за розкладом; без замка два git-и билися б за індекс.
if ! mkdir "$STATE/lock" 2>/dev/null; then
  if [ -n "$(find "$STATE/lock" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    rm -rf "$STATE/lock"
    mkdir "$STATE/lock" 2>/dev/null || exit 0
    log "прибрано застряглий замок"
  else
    exit 0
  fi
fi
trap 'rm -rf "$STATE/lock"' EXIT

# --- Доступ до теки -------------------------------------------------------
#
# Тека лежить на Робочому столі, а macOS закриває його від фонових
# процесів (TCC). cd при цьому може пройти, а читання — ні. Тому явна
# перевірка з окремим повідомленням: інакше причина виглядала б як
# «git зламався».
if ! git --no-optional-locks status --porcelain >/dev/null 2>&1; then
  log "немає доступу до теки або git не працює — див. Автопублікація-стан"
  echo "no-access" > "$STATE/blocked"
  exit 1
fi
rm -f "$STATE/blocked"

# --- Знятий замок від перерваного git -------------------------------------
if [ -f .git/index.lock ]; then
  if pgrep -x git >/dev/null 2>&1; then
    exit 0
  fi
  if [ -n "$(find .git/index.lock -maxdepth 0 -mmin +5 2>/dev/null)" ]; then
    rm -f .git/index.lock && log "прибрано .git/index.lock від перерваного git"
  else
    exit 0
  fi
fi

# --- Чи є привід публікувати ----------------------------------------------
ST="$(git --no-optional-locks status --porcelain 2>/dev/null)"
REQ=""
[ -f "$REQUEST" ] && REQ="$(cat "$REQUEST" 2>/dev/null)"

# Відбиток охоплює і зміни, і запит: один відбиток — один стан світу.
FP="$(printf '%s\n--\n%s' "$ST" "$REQ" | sha1)"

if [ -n "$REQ" ]; then
  REASON="запит"
elif [ -z "$ST" ]; then
  rm -f "$STATE/fp" "$STATE/fp-since" "$STATE/failed"
  exit 0
else
  PREV="$(cat "$STATE/fp" 2>/dev/null || true)"
  NOW="$(date +%s)"
  if [ "$FP" != "$PREV" ]; then
    printf '%s' "$FP"  > "$STATE/fp"
    printf '%s' "$NOW" > "$STATE/fp-since"
    exit 0
  fi
  SINCE="$(cat "$STATE/fp-since" 2>/dev/null || echo "$NOW")"
  [ $((NOW - SINCE)) -ge $QUIET_SECONDS ] || exit 0
  REASON="тиша"
fi

# Цей самий стан уже падав на тестах — не мучимо машину щохвилини.
[ "$(cat "$STATE/failed" 2>/dev/null || true)" = "$FP" ] && exit 0

# --- Тести ----------------------------------------------------------------
#
# node може бути не встановлений — тоді локальних тестів немає, але пуш
# не блокуємо: ті самі тести проганяє GitHub Actions на кожному пуші.
run_tests() {
  : > "$STATE/tests.log"
  if ! command -v node >/dev/null 2>&1; then
    echo "node не знайдено — локальні тести пропущено" >> "$STATE/tests.log"
    log "node не знайдено — локальні тести пропущено (їх прожене GitHub Actions)"
    return 0
  fi
  MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${MAJOR:-0}" -lt 20 ] 2>/dev/null; then
    echo "node $MAJOR застарий для --test — тести пропущено" >> "$STATE/tests.log"
    log "node застарий ($MAJOR) — локальні тести пропущено"
    return 0
  fi
  node --test tests/*.test.js >> "$STATE/tests.log" 2>&1 || return 1
  node tools/ci-hygiene.mjs   >> "$STATE/tests.log" 2>&1 || return 2
  return 0
}

run_tests
RC=$?
if [ $RC -ne 0 ]; then
  printf '%s' "$FP" > "$STATE/failed"
  case $RC in
    1) WHAT="юніт-тести не пройшли" ;;
    2) WHAT="гігієна репозиторію не пройшла" ;;
    *) WHAT="перевірки не пройшли" ;;
  esac
  log "ЗУПИНЕНО: $WHAT — нічого не відправлено"
  notify "Публікацію зупинено" "$WHAT. Подробиці — Автопублікація-стан.command"
  exit 1
fi
rm -f "$STATE/failed"

# --- Коміт ----------------------------------------------------------------
#
# Пошта-невидимка GitHub: Vercel блокує збірку, якщо автор коміта не
# належить акаунту. Налаштування локальне — глобальний git не чіпаємо.
git config user.name  "matwhh"
git config user.email "152515220+matwhh@users.noreply.github.com"

MSG=""
[ -n "$REQ" ] && MSG="$(printf '%s' "$REQ" | head -n 1 | cut -c1-200)"
rm -f "$REQUEST"

if ! git add -A 2>>"$LOG"; then
  log "git add не спрацював"
  notify "Публікація не вдалася" "git add не спрацював"
  exit 1
fi

if [ -z "$MSG" ]; then
  FILES="$(git diff --cached --name-only | head -n 3 | tr '\n' ' ')"
  N="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  if [ "$N" -gt 3 ]; then
    MSG="оновлення: ${FILES}та ще $((N - 3))"
  else
    MSG="оновлення: ${FILES% }"
  fi
  [ "$N" = "0" ] && MSG="перезбірка $(date '+%d.%m.%Y %H:%M')"
fi

if git diff --cached --quiet 2>/dev/null && git rev-parse HEAD >/dev/null 2>&1; then
  git -c commit.gpgsign=false commit -q --allow-empty -m "$MSG" 2>>"$LOG" || {
    log "git commit (порожній) не спрацював"; exit 1; }
else
  git -c commit.gpgsign=false commit -q -m "$MSG" 2>>"$LOG" || {
    log "git commit не спрацював"; exit 1; }
fi

# --- Відправка ------------------------------------------------------------
if ! git push -u origin "$BRANCH" > "$STATE/push.log" 2>&1; then
  ERR="$(tail -n 5 "$STATE/push.log" | tr '\n' ' ')"
  log "PUSH НЕ ВДАВСЯ ($REASON): $ERR"
  case "$ERR" in
    *"could not read Username"*|*Authentication*|*denied*|*403*)
      notify "GitHub не пустив" "Схоже, протермінувався токен. Запусти Новий-токен-GitHub.command" ;;
    *"not fast-forward"*|*rejected*|*"fetch first"*)
      notify "На GitHub є новіший коміт" "Потрібно git pull --rebase — див. Автопублікація-стан" ;;
    *)
      notify "Публікація не вдалася" "Подробиці — Автопублікація-стан.command" ;;
  esac
  exit 1
fi

rm -f "$STATE/fp" "$STATE/fp-since"
log "опубліковано ($REASON): $MSG"
notify "Опубліковано" "$MSG"
exit 0
