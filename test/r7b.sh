#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
mkdir -p test/out
: > test/out/R7b.txt
timeout 900 node test/rock.mjs > test/out/log-rock.txt 2>&1; echo "rock EXIT=$?" >> test/out/R7b.txt
timeout 900 node test/detail.mjs > test/out/log-detail.txt 2>&1; echo "detail EXIT=$?" >> test/out/R7b.txt
ONLY=攒尖亭,楼阁式佛塔,白色尖顶教堂,红谷仓,南方庄园宅邸,月亮门,城门楼,石拱桥,四合院单元,拱窗,双开门,卷帘门,双坡屋顶,巨石,山峰 node test/fix7.mjs > test/out/log-fix7.txt 2>&1; echo "fix7 EXIT=$?" >> test/out/R7b.txt
echo "R7b DONE" >> test/out/R7b.txt
