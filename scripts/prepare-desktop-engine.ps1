# Pinned official llama.cpp Vulkan build. No model download, execution or user path input.
$ErrorActionPreference = 'Stop'
$tag = 'b11829'
$name = 'llama-b11829-bin-win-vulkan-x64.zip'
$digest = '839ff55ce9cbee6a099b403b640ca6b694ee5d74b815e39f77fc5d2b20962f0d'
$downloadRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$zip = Join-Path $downloadRoot $name
Invoke-WebRequest "https://github.com/ggml-org/llama.cpp/releases/download/$tag/$name" -OutFile $zip -MaximumRetryCount 3 -RetryIntervalSec 3 -TimeoutSec 180
if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) { throw 'Official engine ZIP digest mismatch' }
$dest = 'src-tauri/resources/llama'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Expand-Archive $zip -DestinationPath $dest -Force
$server = Get-ChildItem $dest -Filter 'llama-server.exe' -Recurse | Select-Object -First 1
if (!$server) { throw 'Official archive has no llama-server.exe' }
# Normalize the archive's optional top-level folder for one fixed runtime path.
if ($server.Directory.FullName -ne (Resolve-Path $dest).Path) {
    Copy-Item (Join-Path $server.Directory.FullName '*') $dest -Recurse -Force
}
# Carry the upstream MIT license even when the binary archive omits it.
Invoke-WebRequest "https://github.com/ggml-org/llama.cpp/raw/refs/tags/$tag/LICENSE" -OutFile "$dest/LICENSE-llama.cpp.txt" -MaximumRetryCount 3 -RetryIntervalSec 3 -TimeoutSec 60
if (!(Get-Content "$dest/LICENSE-llama.cpp.txt" -Raw).Contains('MIT License')) { throw 'Upstream engine license content invalid' }
@{tag=$tag;archive=$name;sha256=$digest;modelWeightsIncluded=$false} | ConvertTo-Json | Set-Content "$dest/engine-source.json" -Encoding utf8
& "$dest/llama-server.exe" --version
if ($LASTEXITCODE -ne 0) { throw 'Bundled engine cannot start on this Windows runner' }
