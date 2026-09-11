#!/bin/bash
# run users in 3 parallel lanes; each user = separate process (own browser profile)
cd /root/work/forgesite
run_lane() { for u in "$@"; do node tools/sim90/run.mjs $u 1 90 > tools/sim90/out/run-u$u.log 2>&1; done; }
run_lane 1 4 7 10 &
run_lane 2 5 8 &
run_lane 3 6 9 &
wait
echo ALL-DONE > tools/sim90/out/ALL-DONE
