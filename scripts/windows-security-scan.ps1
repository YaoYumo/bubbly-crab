param(
  [long]$ArtifactId = 12475121975,
  [string]$ExpectedSource = 'e9b4e00d2ea4054f6598586082ea77460452af36'
)
# Scan the EXACT already-published artifact. Do not rebuild, execute the binaries,
# disable protection, add exclusions, rename payloads or publish replacement files.
$ErrorActionPreference = 'Stop'
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
New-Item -ItemType Directory -Force '.shots/security-scan' | Out-Null
try {
  if (!$env:GITHUB_TOKEN -or !$env:GITHUB_REPOSITORY) { throw 'GitHub Actions environment is required' }
  $headers = @{ Authorization = "Bearer $env:GITHUB_TOKEN"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
  $api = "https://api.github.com/repos/$env:GITHUB_REPOSITORY/actions/artifacts/$ArtifactId"
  $report.phase = 'artifact metadata'
  $meta = Invoke-RestMethod -Uri $api -Headers $headers
  if ($meta.expired -or $meta.workflow_run.head_sha -ne $ExpectedSource) { throw 'Expired artifact or unexpected source commit' }
  if ($meta.name -ne 'previz-lab-windows-x64-unsigned' -or $meta.size_in_bytes -gt 32MB) { throw 'Unexpected artifact identity or size' }
  $report.artifact = @{ name = $meta.name; sourceCommit = $meta.workflow_run.head_sha; githubDigest = $meta.digest; bytes = $meta.size_in_bytes }
  $zip = Join-Path (Resolve-Path '.shots/security-scan') 'previz-lab-windows-x64-unsigned.zip'
  $report.phase = 'download original archive'
  Invoke-WebRequest -Uri "$api/zip" -Headers $headers -OutFile $zip
  $digest = 'sha256:' + (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
  if ($digest -ne $meta.digest) { throw 'Downloaded archive does not match the published GitHub digest' }
  $report.archiveDigestVerified = $true
  $report.archiveDigest = $digest

  $report.phase = 'validate archive entries'
  $dest = Join-Path (Resolve-Path '.shots/security-scan') 'original-contents'
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
  $status = Get-MpComputerStatus
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
  $status = Get-MpComputerStatus
  $report.defender.signatures = $status.AntivirusSignatureVersion
  $report.defender.signatureDate = [string]$status.AntivirusSignatureLastUpdated
  if (!$status.AntivirusSignatureLastUpdated -or $status.AntivirusSignatureLastUpdated -lt (Get-Date).AddDays(-7)) { throw 'Defender signatures are missing or too old' }
  $scanner = Get-ChildItem "$env:ProgramData/Microsoft/Windows Defender/Platform/*/MpCmdRun.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  $scannerPath = if ($scanner) { $scanner.FullName } else { "$env:ProgramFiles/Windows Defender/MpCmdRun.exe" }
  if (!(Test-Path -LiteralPath $scannerPath)) { throw 'Defender scan executable unavailable' }
  $report.phase = 'scan archive and extracted binaries without execution'
  # Default remediation remains enabled. If Defender quarantines a file, preserve
  # the detection report; never restore, exclude, or allow it automatically.
  & $scannerPath -Scan -ScanType 3 -File (Resolve-Path '.shots/security-scan').Path 2>&1 | Tee-Object -FilePath '.shots/security-scan-output.txt'
  $report.scanExitCode = $LASTEXITCODE
  $report.threats = @(Get-MpThreatDetection | Where-Object { ($_.Resources -join ' ') -match 'security-scan' } | Select-Object ThreatID, InitialDetectionTime, LastThreatStatusChangeTime, ActionSuccess, Resources)
  if ($report.scanExitCode -ne 0 -or $report.threats.Count -gt 0) {
    $report.status = 'DETECTION_OR_SCAN_ERROR'
    throw 'Threat detection or scan error; do not use or redistribute this package'
  }
  $report.status = 'NO_DETECTIONS_BY_THIS_ENGINE'
  $report.phase = 'completed'
  $exitCode = 0
} catch {
  if ($report.status -eq 'NOT_VALIDATED') { $report.status = 'CHECK_FAILED_OR_UNAVAILABLE' }
  # Do not print redirect URLs, signed artifact URLs or authorization headers.
  $report.error = $_.Exception.GetType().FullName
  Write-Host 'Security verification did not complete cleanly. No safety pass is claimed.'
} finally {
  $json = $report | ConvertTo-Json -Depth 12
  $json | Set-Content '.shots/windows-security-scan.json' -Encoding utf8
  $notice = $json.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Host "::notice title=Windows package security verification::$notice"
  $json | Write-Host
}
exit $exitCode
