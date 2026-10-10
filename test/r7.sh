#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
mkdir -p test/out
: > test/out/R7.txt
timeout 1500 node test/fix7.mjs > test/out/log-fix7.txt 2>&1; echo "fix7 EXIT=$?" >> test/out/R7.txt
for t in rock cn parts detail; do
  timeout 900 node "test/$t.mjs" > "test/out/log-$t.txt" 2>&1
  echo "$t EXIT=$?" >> test/out/R7.txt
done
echo "R7 PART DONE" >> test/out/R7.txt
