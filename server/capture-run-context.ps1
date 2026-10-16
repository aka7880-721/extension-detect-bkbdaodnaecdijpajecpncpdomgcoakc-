# Capture stable Chrome profile + new run id before the server starts (user clicked profile first).
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$varDir = Join-Path $projectRoot "var"
$runProfileFile = Join-Path $varDir "run-profile.txt"
$runIdPath = Join-Path $varDir "run-id.txt"
$localState = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data\Local State"

if (-not (Test-Path -LiteralPath $varDir)) {
  New-Item -ItemType Directory -Path $varDir -Force | Out-Null
}

function Read-LastUsedProfileName {
  if (-not (Test-Path -LiteralPath $localState)) { return $null }
  try {
    $raw = [System.IO.File]::ReadAllText($localState)
    $ls = $raw | ConvertFrom-Json
    if ($ls.profile.last_used) {
      return [string]$ls.profile.last_used.Trim()
    }
  } catch { }
  return $null
}

# Let Chrome flush last_used after the user focused a profile window.
Start-Sleep -Milliseconds 450

$stable = $null
$sameCount = 0
$chosen = $null

for ($i = 0; $i -lt 20; $i++) {
  $name = Read-LastUsedProfileName
  if ($name) {
    if ($name -eq $stable) {
      $sameCount++
    } else {
      $stable = $name
      $sameCount = 1
    }
    if ($sameCount -ge 3) {
      $chosen = $stable
      break
    }
  }
  Start-Sleep -Milliseconds 120
}

if (-not $chosen) {
  $chosen = Read-LastUsedProfileName
}

if (-not $chosen) {
  Write-Error "Could not read Chrome profile from Local State. Open Chrome, click the profile to test, then run run.bat again."
  exit 1
}

$runId = [guid]::NewGuid().ToString("n")
[System.IO.File]::WriteAllText($runIdPath, $runId, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($runProfileFile, $chosen, [System.Text.UTF8Encoding]::new($false))

Write-Host "Run $runId profile ""$chosen"""
