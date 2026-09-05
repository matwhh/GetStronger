#!/bin/bash
#
#  Відрізати CI від бойової хмари.
#
#  Браузерні перевірки ходять по file:// і не потребують ані Supabase,
#  ані Sentry. Але сторінка все одно спробує — і на раннері GitHub, де
#  інтернет справжній, це означало б тести, залежні від стану бойової
#  бази, або запити, що в ній щось лишають. Тому домени з js/config.js
#  вішаються на 127.0.0.1: спроба є, зʼєднання немає.
#
#  Хости не зашиті: беруться з конфігу, щоб при переїзді проєкту не
#  довелося памʼятати ще й про цей файл.
set -eu

cd "$(dirname "$0")/.."

HOSTS="$(node -e '
  const s = require("node:fs").readFileSync("js/config.js", "utf8");
  const out = new Set();
  /* (?:...@)? — Sentry DSN несе ключ перед хостом: https://<ключ>@o123.ingest.de.sentry.io */
  for (const m of s.matchAll(/https:\/\/(?:[^@\s"\x27\/]*@)?([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const h = m[1].toLowerCase();
    if (h.includes("supabase") || h.includes("sentry")) out.add(h);
  }
  console.log([...out].join(" "));
')"

if [ -z "$HOSTS" ]; then
  echo "ci-offline: у js/config.js не знайдено доменів хмари — нічого глушити" >&2
  exit 0
fi

for h in $HOSTS; do
  echo "127.0.0.1 $h" | sudo tee -a /etc/hosts > /dev/null
  echo "· заглушено $h"
done
