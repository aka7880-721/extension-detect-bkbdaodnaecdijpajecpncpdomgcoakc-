# One-time portable Python setup for run.bat (no admin installer required).
param(
  [string]$TargetDir = (Join-Path $PSScriptRoot ".runtime\python")
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$version = "3.12.8"
$arch = if ($env:PROCESSOR_ARCHITECTURE -match "64") { "amd64" } else { "win32" }
$zipName = "python-$version-embed-$arch.zip"
$url = "https://www.python.org/ftp/python/$version/$zipName"
$zipPath = Join-Path $env:TEMP $zipName

Write-Host "Downloading portable Python $version ($arch)..."
Write-Host $url

if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
Expand-Archive -Path $zipPath -DestinationPath $TargetDir -Force
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

$pthFiles = Get-ChildItem -Path $TargetDir -Filter "python*._pth"
foreach ($pth in $pthFiles) {
  $text = Get-Content -Raw -Path $pth.FullName
  if ($text -notmatch "(?m)^import site") {
    $text = $text -replace "(?m)^#\s*import site", "import site"
    if ($text -notmatch "(?m)^import site") {
      $text = $text.TrimEnd() + "`r`nimport site`r`n"
    }
    Set-Content -Path $pth.FullName -Value $text -Encoding ASCII
  }
}

$pythonExe = Join-Path $TargetDir "python.exe"
if (-not (Test-Path $pythonExe)) {
  throw "Portable Python setup failed: python.exe not found in $TargetDir"
}

Write-Host "Portable Python ready: $pythonExe"
