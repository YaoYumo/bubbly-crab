#!/bin/bash
# 一次跑完回归：按「先快后慢」排，日志与汇总都落在 test/out/
# 用法：bash test/runsuite.sh        （需要 vite 已在 5174 上跑：npx vite --host 0.0.0.0 --port 5174）
cd "$(dirname "$0")/.." || exit 1
mkdir -p test/out
: > test/out/SUITE.txt
for t in camera-edit.test camera-edit-regression timeline-usability-regression reference.test reference-workflow-regression reference-ui-export-regression parts house detail uilook panel _audit cn scenes editops crowd terrain terrain-generation-regression terrain-import-river.test terrain-workflow-regression terrain-erosion.test terrain-erosion-regression performance-regression pick-spatial-index.test pick-spatial-index-regression model-instancing-regression road-performance-regression road-diagnostics.test road-diagnostics-regression window-lights.test window-lights-regression render-effects.test cold-work.test selective-bloom.test render-effects-regression selective-bloom-regression lighting-regression lighting-offline terrain-roads-regression terrain-ui-regression assets jsoncheck boot entry smoke single motion shots junction-surface.test junction-regression t-junction-regression road-endcap-regression road-parcels.test road-planning-regression road-planning-offline junction-material.test junction-material-regression road-properties-regression road-properties-offline project-resources-regression import-formats-regression vegetation-brush-regression vegetation-offline; do
  timeout 1500 node "test/$t.mjs" > "test/out/log-$t.txt" 2>&1
  echo "$t EXIT=$?" >> test/out/SUITE.txt
done
# 视觉回归（抖动 / 对焦 / 遮挡 / 闪屏）必须单独跑、放最后：它会全程占着 CPU
timeout 1500 node test/aim.mjs > test/out/log-aim.txt 2>&1
echo "aim EXIT=$?" >> test/out/SUITE.txt
echo "SUITE DONE" >> test/out/SUITE.txt
tail -3 test/out/*.json 2>/dev/null | head -0
echo "全部完成，见 test/out/SUITE.txt"
