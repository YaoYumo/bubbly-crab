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
  $installer = Get-ChildItem 'src-tauri/target/release/bundle/nsis/*.exe' | Select-Object -First 1
  if (!$installer) { throw 'NSIS installer missing' }
  # NSIS /D must be the final argument, unquoted, even if its value has spaces.
  $install = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$target" -PassThru
  if (!$install.WaitForExit(180000)) { $install.Kill(); throw 'Installer did not finish within 180 seconds' }
  $report.installExitCode = $install.ExitCode
  if ($install.ExitCode -ne 0) { throw "Installer returned $($install.ExitCode)" }
  $exe = Join-Path $target 'previz-lab.exe'
  if (!(Test-Path $exe)) { throw "Installed executable missing: $exe" }
  $report.installed = $true
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
  $report.status = 'PASS_INSTALL_AND_WINDOW_LIVENESS_ONLY'
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
  $report | ConvertTo-Json -Depth 5 | Set-Content '.shots/windows-install-smoke.json' -Encoding utf8
  $report | ConvertTo-Json -Depth 5 | Write-Host
  $notice = ($report | ConvertTo-Json -Depth 5 -Compress).Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Host "::notice title=Windows install smoke::$notice"
}
