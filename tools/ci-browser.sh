#!/bin/bash
#
#  Прогін браузерних перевірок у CI.
#
#  Два набори:
#    core — те, що ламається найчастіше і коштує хвилини. На кожен пуш.
#    full — усе інше, включно з повільним verifyhardening. Раз на добу.
#
#  ЧОГО ТУТ НЕМАЄ І ЧОМУ. verifyregister, verifyregfail, verifyregresume,
#  verifyrecover і verifyproduction ходять у справжній Supabase: перші
#  чотири створюють користувачів, останній стукає в бойовий домен. У CI
#  їм робити нічого — вони лишаються ручними.
#
#  verifyauthz.mjs — теж ручний і з тієї самої причини: він бере anon-ключ
#  і б'є ним у БОЙОВИЙ Supabase, доводячи, що незалогінений не бачить
#  нічого. Читання, нічого не створює — але це все одно бойовий бекенд, а
#  CI тут свідомо відрізаний від хмари (tools/ci-offline.sh). Запускати
#  руками після змін у RLS (INV-006, TST-012).
#
#  verifyerrors.mjs натомість ПОВНІСТЮ офлайн: піднімає власний сервер на
#  вигаданому домені forge.test і перехоплює конверти Sentry, перевіряючи,
#  що в них немає ні пошти, ні токенів. Він у FULL.
#
#  Перевірки НЕ спиняються на першій невдачі: краще один звіт про всі
#  проблеми, ніж п'ять прогонів по одній.
set -u

cd "$(dirname "$0")/.."

CORE="verifyhistory verifyworkout verifydata verifyroundtrip verifyloop verify7 verifyaccountmix verifylink verifysw verifyhelp"
FULL="verifya11y verifyflows verifyimport verifythemes verifyonboard \
      verifyonboarding verifyagegate verifyresponsive verifyperf verifyreps \
      verifypersetweight verifyplanfields verifysexplans verifysleepremember \
      verifytrackerspage verifywomen3 verifycreatine verifyexercise \
      verifychaos verifychaos2 verifyfix90 verifyhardening verifyerrors \
      verifyheatmap verifyseg verifytilt verifydaycal verifytabbar verifydonut \
      verifylevelicon verifyaward verifyprogression"

case "${1:-core}" in
  core) LIST="$CORE" ;;
  full) LIST="$CORE $FULL" ;;
  *)    echo "вживання: $0 core|full" >&2; exit 2 ;;
esac

OUT=".ci-browser"
mkdir -p "$OUT"
FAILED=""
PASSED=0

for s in $LIST; do
  [ -f "tools/$s.mjs" ] || { echo "?  $s — файла немає, пропущено"; continue; }
  START=$(date +%s)
  if timeout 600 node "tools/$s.mjs" > "$OUT/$s.log" 2>&1; then
    printf '✓  %-24s %3sс\n' "$s" "$(( $(date +%s) - START ))"
    PASSED=$((PASSED + 1))
    rm -f "$OUT/$s.log"
  else
    printf '✕  %-24s %3sс\n' "$s" "$(( $(date +%s) - START ))"
    FAILED="$FAILED $s"
    tail -n 25 "$OUT/$s.log" | sed 's/^/   │ /'
  fi
done

echo
if [ -n "$FAILED" ]; then
  echo "ПРОВАЛЕНО:$FAILED"
  echo "Повний вивід — в артефакті збірки."
  exit 1
fi
echo "усі $PASSED наборів пройшли"
