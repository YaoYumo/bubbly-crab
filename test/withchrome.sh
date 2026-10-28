#!/bin/bash
# 无头浏览器环境修复：快照还原会清掉 puppeteer 的 Chrome 缓存（storage.googleapis.com 又不在出网白名单）。
# 这里改用 npm registry 直装的 @sparticuz/chromium（Chromium 131，与 puppeteer 23.x 匹配）：
#   1) 解包二进制到 /tmp/chromium（npm 包内 brotli 压缩）
#   2) 解包 al2023 依赖库（补 libnss3/libnssutil3/libnspr4）
#   3) 以 PUPPETEER_EXECUTABLE_PATH + LD_LIBRARY_PATH 执行后续命令
# 用法：bash test/withchrome.sh test/boot.mjs
#       bash test/withchrome.sh bash test/runsuite.sh
set -e
cd "$(dirname "$0")/.."

if [ ! -x /tmp/chromium ]; then
  [ -d node_modules/@sparticuz/chromium ] || npm install --no-save --no-audit --no-fund @sparticuz/chromium@131.0.1
  node -e "import('@sparticuz/chromium').then(m => m.default.executablePath()).then(p => console.log('chrome =', p))"
fi

if [ ! -f /tmp/al2023x/lib/libnss3.so ]; then
  node -e "const fs=require('fs'),zlib=require('zlib');fs.writeFileSync('/tmp/al2023.tar',zlib.brotliDecompressSync(fs.readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')))"
  mkdir -p /tmp/al2023x
  tar -xf /tmp/al2023.tar -C /tmp/al2023x
fi

export PUPPETEER_EXECUTABLE_PATH="/tmp/chromium"
export LD_LIBRARY_PATH="/tmp/al2023x/lib:/tmp${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$@"
