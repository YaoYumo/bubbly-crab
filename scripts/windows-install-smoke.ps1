param([string]$BaselineInstaller = '', [switch]$VisualProbe)
# Real Windows runner: silent current-user install + basic native-window liveness.
# This is NOT proof that WebGL, dialogs, saves, or video work on the user's GPU.
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
  platform = 'Windows GitHub runner x64'
  installed = $false
  installExitCode = $null
  processStayedAlive = $false
  nativeWindowCreated = $false
  windowTitle = $null
  fullyFunctionalUIValidated = $false
  nativeDiskSaveValidated = $false
  note = 'Silent install and startup smoke only. User-machine acceptance still required.'
}
$target = Join-Path $env:LOCALAPPDATA 'PrevizLab-InstallerSmoke'
$app = $null
try {
  $installer = if ($BaselineInstaller) { Get-Item $BaselineInstaller } else { Get-ChildItem 'src-tauri/target/release/bundle/nsis/*.exe' | Select-Object -First 1 }
  if (!$installer) { throw 'NSIS installer missing' }
  if ($VisualProbe) {
  $port = if ($BaselineInstaller) { 9223 } else { 9222 }
  $env:PREVIZ_UI_DEBUG_PORT = [string]$port
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:TEMP ('previz-ui-' + [guid]::NewGuid().ToString())
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --use-angle=swiftshader --enable-unsafe-swiftshader"
  }
  # NSIS /D must be the final argument, unquoted, even if its value has spaces.
  $install = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$target" -PassThru
  if (!$install.WaitForExit(180000)) { $install.Kill(); throw 'Installer did not finish within 180 seconds' }
  $report.installExitCode = $install.ExitCode
  if ($install.ExitCode -ne 0) { throw "Installer returned $($install.ExitCode)" }
  $exe = Join-Path $target 'previz-lab.exe'
  if (!(Test-Path $exe)) { throw "Installed executable missing: $exe" }
  $engine = Join-Path $target 'runtime/llama/llama-server.exe'
  if (!(Test-Path $engine)) { throw 'Installed local inference engine missing from fixed resource path' }
  if (!(Test-Path (Join-Path $target 'runtime/llama/LICENSE-llama.cpp.txt'))) { throw 'Installed engine license missing' }
  if (!(Test-Path (Join-Path $target 'models/README.txt'))) { throw 'Installed model folder instructions missing' }
  & $engine --version
  if ($LASTEXITCODE -ne 0) { throw 'Installed engine cannot execute' }
  $helper = Join-Path $target 'runtime/loopback/previz-loopback.exe'
  if (!(Test-Path $helper)) { throw 'Installed isolated loopback helper missing' }
  & $helper --version
  if ($LASTEXITCODE -ne 0) { throw 'Installed loopback helper cannot execute' }
  node test/loopback-installed.mjs $helper
  if ($LASTEXITCODE -ne 0) { throw 'Installed loopback transport fixture failed' }
  $report.installedLoopbackHelperValidated = $true
  $report.installedEngineValidated = $true
  $report.realGGUFInferenceValidated = $false
  # User-owned files in models must survive a silent reinstall/upgrade.
  $sentinel = Join-Path $target 'models/user-preservation.fixture'
  [System.IO.File]::WriteAllText($sentinel,'User-owned model folder sentinel, not a model weight.')
  $sentinelHash = (Get-FileHash $sentinel -Algorithm SHA256).Hash
  $reinstall = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$target" -PassThru
  if (!$reinstall.WaitForExit(180000)) { $reinstall.Kill(); throw 'Reinstall timed out' }
  if ($reinstall.ExitCode -ne 0 -or !(Test-Path $sentinel)) { throw 'Reinstall did not preserve user model folder content' }
  if ((Get-FileHash $sentinel -Algorithm SHA256).Hash -ne $sentinelHash) { throw 'Reinstall changed user model folder content' }
  Remove-Item $sentinel
  $report.userModelFolderPreservedOnReinstall = $true
  $report.installed = $true
  Start-Sleep -Seconds 2
  $app = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds 15
  $app.Refresh()
  if ($app.HasExited) { throw 'Application exited during startup' }
  $report.processStayedAlive = $true
  $report.windowTitle = $app.MainWindowTitle
  $report.nativeWindowCreated = $app.MainWindowHandle -ne [IntPtr]::Zero
  if (!$report.nativeWindowCreated -or $app.MainWindowTitle -notlike '*PREVIZ LAB*') {
    throw 'Native PREVIZ LAB window not observed; runner may lack an interactive desktop'
  }
  $report.visualChecksValidated = $false
  $report.status = 'PASS_INSTALL_AND_WINDOW_LIVENESS_ONLY'
  if ($VisualProbe) {
    if ($BaselineInstaller) { node test/windows-desktop-ui.mjs --baseline } else { node test/windows-desktop-ui.mjs }
    if ($LASTEXITCODE -ne 0) { throw 'Installed WebView2 visual probe unavailable or failed; no visual pass claimed' }
    $report.visualChecksValidated = $true
    $report.status = 'PASS_INSTALL_WINDOW_AND_VISUAL_CHECKS'
  }
} catch {
  $report.status = 'FAILED_OR_RUNNER_UNSUPPORTED'
  $report.error = $_.Exception.Message
  throw
} finally {
  if ($app -and !$app.HasExited) {
    $null = $app.CloseMainWindow()
    if (!$app.WaitForExit(10000)) { $app.Kill() }
  }
  New-Item -ItemType Directory -Path '.shots' -Force | Out-Null
  $report | ConvertTo-Json -Depth 5 | Set-Content $(if ($BaselineInstaller) { '.shots/windows-baseline-install-smoke.json' } else { '.shots/windows-install-smoke.json' }) -Encoding utf8
  $report | ConvertTo-Json -Depth 5 | Write-Host
  $notice = ($report | ConvertTo-Json -Depth 5 -Compress).Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Host "::notice title=Windows install smoke::$notice"
}
