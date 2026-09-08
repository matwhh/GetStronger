#!/bin/bash
cd /root/work/forgesite
lane() { for spec in "$@"; do u=${spec%%:*}; f=${spec##*:}; node tools/sim90/run.mjs $u $f 90 >> tools/sim90/out/run-u$u.log 2>&1; done; }
lane 1:90 4:1 7:1 10:1 &
lane 2:73 5:1 8:1 &
lane 3:46 6:7 9:1 &
wait
echo ALL-DONE > tools/sim90/out/ALL-DONE
