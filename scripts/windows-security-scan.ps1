param(
  [long]$ArtifactId = 12475121975,
  [string]$ExpectedSource = 'e9b4e00d2ea4054f6598586082ea77460452af36'
)
# Scan the EXACT already-published artifact. Do not rebuild, execute the binaries,
# disable protection, add exclusions, rename payloads or publish replacement files.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Defender's native module targets Windows PowerShell. Avoid PS7 compatibility
# remoting, and tolerate a bounded service restart during definition updates.
function Read-DefenderStatus {
  for ($attempt = 0; $attempt -lt 6; $attempt++) {
    try { return Get-MpComputerStatus -ErrorAction Stop }
    catch { if ($attempt -eq 5) { throw }; Start-Sleep -Seconds 5 }
  }
}
function Read-DefenderPreferences {
  for ($attempt = 0; $attempt -lt 6; $attempt++) {
    try { return Get-MpPreference -ErrorAction Stop }
    catch { if ($attempt -eq 5) { throw }; Start-Sleep -Seconds 5 }
  }
}
$report = [ordered]@{
  artifactId = $ArtifactId
  expectedSource = $ExpectedSource
  status = 'NOT_VALIDATED'
  phase = 'initialization'
  scanner = 'Microsoft Defender on GitHub Windows runner'
  archiveDigestVerified = $false
  binaryHashesVerified = $false
  defender = $null
  signatureUpdate = $null
  scanExitCode = $null
  threats = @()
  note = 'A no-detection result is not a browser reputation verdict or proof of safety. Do not override the browser block based on this report.'
}
$exitCode = 1
New-Item -ItemType Directory -Force '.shots' | Out-Null
# CI workspaces may be excluded by runner antivirus policy. Scan elsewhere and
# verify the selected location is NOT excluded; do not weaken that policy.
$scanRoot = Join-Path ($env:SystemDrive + '\') ('previz-security-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force $scanRoot | Out-Null
try {
  if (!$env:GITHUB_TOKEN -or !$env:GITHUB_REPOSITORY) { throw 'GitHub Actions environment is required' }
  $headers = @{ Authorization = "Bearer $env:GITHUB_TOKEN"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
  $api = "https://api.github.com/repos/$env:GITHUB_REPOSITORY/actions/artifacts/$ArtifactId"
  $report.phase = 'artifact metadata'
  $meta = Invoke-RestMethod -Uri $api -Headers $headers
  if ($meta.expired -or $meta.workflow_run.head_sha -ne $ExpectedSource) { throw 'Expired artifact or unexpected source commit' }
  if ($meta.name -ne 'previz-lab-windows-x64-unsigned' -or $meta.size_in_bytes -gt 32MB) { throw 'Unexpected artifact identity or size' }
  $report.artifact = @{ name = $meta.name; sourceCommit = $meta.workflow_run.head_sha; githubDigest = $meta.digest; bytes = $meta.size_in_bytes }
  $zip = Join-Path $scanRoot 'previz-lab-windows-x64-unsigned.zip'
  $report.phase = 'download original archive'
  Invoke-WebRequest -Uri "$api/zip" -Headers $headers -OutFile $zip -UseBasicParsing
  $digest = 'sha256:' + (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($digest -ne $meta.digest) { throw 'Downloaded archive does not match the published GitHub digest' }
  $report.archiveDigestVerified = $true
  $report.archiveDigest = $digest

  $report.phase = 'validate archive entries'
  $dest = Join-Path $scanRoot 'original-contents'
  $prefix = [System.IO.Path]::GetFullPath($dest) + [System.IO.Path]::DirectorySeparatorChar
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try {
    if ($archive.Entries.Count -gt 256) { throw 'Unexpected archive entry count' }
    [long]$total = 0
    foreach ($entry in $archive.Entries) {
      $total += $entry.Length
      if ($total -gt 128MB) { throw 'Archive exceeds uncompressed size limit' }
      $path = [System.IO.Path]::GetFullPath((Join-Path $dest $entry.FullName))
      if (!$path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path traversal rejected' }
    }
  } finally { $archive.Dispose() }
  Expand-Archive -LiteralPath $zip -DestinationPath $dest
  $report.phase = 'verify exact published binaries'
  $inventory = Get-Content 'docs/desktop-1.2.0-evidence/windows-artifacts.json' -Raw | ConvertFrom-Json
  if ($inventory.sourceCommit -ne $ExpectedSource) { throw 'Inventory source mismatch' }
  $report.binaries = @()
  foreach ($item in @($inventory.installers) + @($inventory.binaries)) {
    $file = Join-Path $dest $item.path
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $item.sha256 -or (Get-Item -LiteralPath $file).Length -ne $item.bytes) { throw 'Binary digest or size mismatch' }
    $report.binaries += @{ path = $item.path; sha256 = $hash; bytes = $item.bytes }
  }
  $report.binaryHashesVerified = $true

  $report.phase = 'Defender availability'
  $status = Read-DefenderStatus
  $report.defender = @{
    serviceEnabled = $status.AMServiceEnabled
    antivirusEnabled = $status.AntivirusEnabled
    engineVersion = $status.AMEngineVersion
    productVersion = $status.AMProductVersion
    signatures = $status.AntivirusSignatureVersion
    signatureDate = [string]$status.AntivirusSignatureLastUpdated
  }
  if (!$status.AMServiceEnabled -or !$status.AntivirusEnabled) {
    $report.status = 'SCANNER_UNAVAILABLE'
    throw 'Defender is not enabled on this runner; no scan pass can be claimed'
  }
  $report.phase = 'update Defender signatures'
  try { Update-MpSignature; $report.signatureUpdate = 'success' }
  catch { $report.signatureUpdate = 'failed; require fresh existing signatures' }
  $status = Read-DefenderStatus
  $report.defender.signatures = $status.AntivirusSignatureVersion
  $report.defender.signatureDate = [string]$status.AntivirusSignatureLastUpdated
  if (!$status.AntivirusSignatureLastUpdated -or $status.AntivirusSignatureLastUpdated -lt (Get-Date).AddDays(-7)) { throw 'Defender signatures are missing or too old' }
  $scanner = Get-ChildItem "$env:ProgramData/Microsoft/Windows Defender/Platform/*/MpCmdRun.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  $scannerPath = if ($scanner) { $scanner.FullName } else { "$env:ProgramFiles/Windows Defender/MpCmdRun.exe" }
  if (!(Test-Path -LiteralPath $scannerPath)) { throw 'Defender scan executable unavailable' }
  $report.phase = 'check scan location is not excluded'
  $prefs = Read-DefenderPreferences
  $report.originalRunnerPolicy = @{ paths = @($prefs.ExclusionPath); archiveScanningDisabled = $prefs.DisableArchiveScanning }
  # Hosted CI excludes entire drives and disables archive scanning by default.
  # Strengthen protection only in this disposable job; never copy these defaults
  # to a user machine or label an excluded scan as clean.
  $excludedPaths = @($prefs.ExclusionPath | Where-Object { $_ })
  if ($excludedPaths.Count -gt 0) { Remove-MpPreference -ExclusionPath $excludedPaths }
  Set-MpPreference -DisableArchiveScanning $false
  $prefs = Read-DefenderPreferences
  if ($prefs.DisableArchiveScanning) { throw 'Archive scanning could not be enabled; no scan pass claimed' }
  $report.runnerPolicyStrengthened = $true
  $report.exclusions = @{ paths = @($prefs.ExclusionPath); extensions = @($prefs.ExclusionExtension); processes = @($prefs.ExclusionProcess); archiveScanningDisabled = $prefs.DisableArchiveScanning }
  foreach ($excluded in @($prefs.ExclusionPath)) {
    if (!$excluded) { continue }
    $pattern = [Environment]::ExpandEnvironmentVariables($excluded).Replace('/', '\').TrimEnd('\')
    if ($scanRoot -like $pattern -or $scanRoot -like ($pattern + '\*')) { throw 'Scan folder is excluded by Defender policy; no scan pass claimed' }
  }
  foreach ($ext in @($prefs.ExclusionExtension)) {
    if (!$ext) { continue }
    if ($ext.TrimStart('.') -in @('*', 'exe', 'zip')) { throw 'Relevant file types are excluded by Defender policy; no scan pass claimed' }
  }
  $check = & $scannerPath -CheckExclusion -Path $scanRoot 2>&1
  $report.exclusionCheck = ($check | Out-String).Trim()
  if ($report.exclusionCheck -notmatch '(?i)not excluded') { throw 'Defender did not confirm that the scan path is unexcluded' }
  $report.scanLocationUnexcluded = $true
  $report.phase = 'scan archive and extracted binaries without execution'
  # Default remediation remains enabled. If Defender quarantines a file, preserve
  # the detection report; never restore, exclude, or allow it automatically.
  & $scannerPath -Scan -ScanType 3 -File $scanRoot 2>&1 | Tee-Object -FilePath '.shots/security-scan-output.txt'
  $report.scanExitCode = $LASTEXITCODE
  $report.threats = @(Get-MpThreatDetection | Where-Object { ($_.Resources -join ' ') -match 'previz-security-' } | Select-Object ThreatID, InitialDetectionTime, LastThreatStatusChangeTime, ActionSuccess, Resources)
  if ($report.scanExitCode -ne 0 -or $report.threats.Count -gt 0) {
    $report.status = 'DETECTION_OR_SCAN_ERROR'
    throw 'Threat detection or scan error; do not use or redistribute this package'
  }
  # Return code zero can also accompany successful remediation. Require that
  # both original files still exist and remain byte-identical after the scan.
  foreach ($item in @($inventory.installers) + @($inventory.binaries)) {
    $file = Join-Path $dest $item.path
    if (!(Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw 'A binary disappeared or changed during the scan' }
  }
  $report.postScanHashesVerified = $true
  $report.status = 'NO_DETECTIONS_BY_THIS_ENGINE'
  $report.phase = 'completed'
  $exitCode = 0
} catch {
  if ($report.status -eq 'NOT_VALIDATED') { $report.status = 'CHECK_FAILED_OR_UNAVAILABLE' }
  # Do not print redirect URLs, signed artifact URLs or authorization headers.
  $report.error = $_.Exception.GetType().FullName
  if ($report.phase -match 'Defender|scan location|scan archive') { $report.diagnostic = $_.Exception.Message }
  Write-Host 'Security verification did not complete cleanly. No safety pass is claimed.'
} finally {
  $json = $report | ConvertTo-Json -Depth 12
  $json | Set-Content '.shots/windows-security-scan.json' -Encoding utf8
  $notice = $json.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Host "::notice title=Windows package security verification::$notice"
  $json | Write-Host
}
exit $exitCode
