param(
  [string]$ExtensionId = "bkbdaodnaecdijpajecpncpdomgcoakc",
  [string]$ProfileDirectory = "",
  [string]$RunId = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$varDir = Join-Path $projectRoot "var"
$runProfileFile = Join-Path $varDir "run-profile.txt"
$resultPath = Join-Path $varDir "result.json"
$runIdPath = Join-Path $varDir "run-id.txt"
$userData = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
$localState = Join-Path $userData "Local State"

if (-not (Test-Path -LiteralPath $varDir)) {
  New-Item -ItemType Directory -Path $varDir -Force | Out-Null
}

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Depth 5 -Compress:$false
  [System.IO.File]::WriteAllText($resultPath, $json, [System.Text.UTF8Encoding]::new($false))
}

function Read-JsonFileFast($path) {
  for ($i = 0; $i -lt 5; $i++) {
    try {
      if (-not (Test-Path -LiteralPath $path)) { return $null }
      $raw = [System.IO.File]::ReadAllText($path)
      if ($raw.Trim().Length -lt 2) { throw "empty" }
      return $raw | ConvertFrom-Json
    } catch {
      if ($i -lt 4) { Start-Sleep -Milliseconds 60 }
      else { throw }
    }
  }
  return $null
}

function Read-ActiveChromeProfile {
  if (-not (Test-Path -LiteralPath $localState)) { return $null }
  $lastName = $null
  for ($i = 0; $i -lt 6; $i++) {
    try {
      $ls = ([System.IO.File]::ReadAllText($localState) | ConvertFrom-Json)
      if ($ls.profile.last_used) {
        $lastName = $ls.profile.last_used.Trim()
      }
    } catch { }
    if ($i -lt 5) { Start-Sleep -Milliseconds 120 }
  }
  return $lastName
}

function Get-ExtensionEntry($profileDir) {
  $securePath = Join-Path (Join-Path $userData $profileDir) "Secure Preferences"
  if (-not (Test-Path -LiteralPath $securePath)) { return $null }
  $sp = Read-JsonFileFast -path $securePath
  if (-not $sp.extensions.settings) { return $null }
  $prop = $sp.extensions.settings.PSObject.Properties[$ExtensionId]
  if ($prop) { return @{ entry = $prop.Value; source = "secure-preferences" } }
  return $null
}

function Test-ExtensionInstalled($entry) {
  if (-not $entry) { return $false }
  if ($null -ne $entry.state -and [int]$entry.state -eq 0) { return $false }
  if ($entry.disable_reasons -and @($entry.disable_reasons).Count -gt 0) { return $false }
  if ($entry.manifest -and [string]$entry.manifest.name -notlike "*eID*") { return $false }
  return $true
}

function Resolve-Installed($profileDir) {
  $extFolder = Join-Path (Join-Path $userData $profileDir) "Extensions\$ExtensionId"
  $onDisk = Test-Path -LiteralPath $extFolder
  $found = $null
  $last = $null
  $stable = 0

  for ($i = 0; $i -lt 24; $i++) {
    $found = Get-ExtensionEntry -profileDir $profileDir
    $now = Test-ExtensionInstalled -entry $(if ($found) { $found.entry } else { $null })

    if ($now) {
      return @{ installed = $true; found = $found; onDisk = $onDisk }
    }

    if (-not $onDisk) {
      if ($null -ne $last -and $now -eq $last) {
        $stable++
        if ($stable -ge 2) {
          return @{ installed = $false; found = $found; onDisk = $onDisk }
        }
      } else {
        $stable = 0
      }
      $last = $now
    }

    Start-Sleep -Milliseconds 100
  }

  if ($onDisk) {
    return @{ installed = $true; found = $found; onDisk = $onDisk; slow = $true }
  }
  return @{ installed = $false; found = $found; onDisk = $onDisk }
}

$started = Get-Date

try {
  if (Test-Path -LiteralPath $resultPath) {
    Remove-Item -LiteralPath $resultPath -Force
  }

  $expectedRunId = $null
  if (Test-Path -LiteralPath $runIdPath) {
    $expectedRunId = (Get-Content -LiteralPath $runIdPath -Raw).Trim()
  }
  if ($RunId -and $expectedRunId -and $RunId -ne $expectedRunId) {
    Write-Result @{
      status = "INCONCLUSIVE"; confidence = 0
      note = "Run id mismatch. Close old tabs and run run.bat again."
      primaryProbe = "run-profile"; extensionId = $ExtensionId
      runId = $RunId; elapsedMs = 0
    }
    exit 1
  }
  $runId = if ($RunId) { $RunId } else { $expectedRunId }

  if (-not (Test-Path -LiteralPath $userData)) {
    Write-Result @{
      status = "INCONCLUSIVE"; confidence = 0
      note = "Google Chrome user data not found."
      primaryProbe = "run-profile"; extensionId = $ExtensionId; runId = $runId; elapsedMs = 0
    }
    exit 1
  }

  $profileDir = $ProfileDirectory
  if (-not $profileDir) {
    $profileDir = Read-ActiveChromeProfile
  }
  if (-not $profileDir) {
    Write-Result @{
      status = "INCONCLUSIVE"; confidence = 0
      note = "Could not read active Chrome profile."
      primaryProbe = "run-profile"; extensionId = $ExtensionId; runId = $runId
      elapsedMs = [int](((Get-Date) - $started).TotalMilliseconds)
    }
    exit 1
  }

  Set-Content -LiteralPath $runProfileFile -Value $profileDir -Encoding ASCII -NoNewline

  $resolved = Resolve-Installed -profileDir $profileDir
  $installed = $resolved.installed
  $found = $resolved.found
  $onDisk = $resolved.onDisk

  $status = if ($installed) { "INSTALLED" } else { "NOT_INSTALLED" }
  $note = if ($installed) {
    "Profile ""$profileDir"": eID extension installed and enabled."
  } else {
    "Profile ""$profileDir"": eID not installed or disabled."
  }
  if ($resolved.slow) {
    $note = "Profile ""$profileDir"": eID installed (extension on disk; prefs read delayed)."
  }

  $prefsSource = $null
  if ($found) { $prefsSource = $found.source }

  Write-Result @{
    status          = $status
    confidence      = if ($installed) { 97 } else { 96 }
    note            = $note
    primaryProbe    = "run-profile"
    extensionId     = $ExtensionId
    chromeProfile   = $profileDir
    extensionOnDisk = $onDisk
    prefsSource     = $prefsSource
    runId           = $runId
    elapsedMs       = [int](((Get-Date) - $started).TotalMilliseconds)
  }
  exit 0
} catch {
  Write-Result @{
    status = "INCONCLUSIVE"; confidence = 0
    note = "Check failed: $($_.Exception.Message)"
    primaryProbe = "run-profile"; extensionId = $ExtensionId
    runId = $RunId; elapsedMs = [int](((Get-Date) - $started).TotalMilliseconds)
  }
  exit 1
}
