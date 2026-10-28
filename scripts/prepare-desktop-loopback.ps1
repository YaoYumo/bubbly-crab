# Build the application's own std-only helper, not an arbitrary executable from models.
$ErrorActionPreference = 'Stop'
$dest = 'src-tauri/resources/loopback'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
rustfmt --edition 2021 src-tauri/helper/local_http.rs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
rustc --edition 2021 -C opt-level=s -C panic=abort src-tauri/helper/local_http.rs -o "$dest/previz-loopback.exe"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$dest/previz-loopback.exe" --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
New-Item -ItemType Directory -Path '.shots' -Force | Out-Null
rustc --edition 2021 --test src-tauri/helper/local_http.rs -o .shots/local-http-tests.exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& .shots/local-http-tests.exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
