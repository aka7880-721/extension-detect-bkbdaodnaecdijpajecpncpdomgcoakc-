param(
  [string]$TargetDir = (Join-Path (Split-Path -Parent $PSScriptRoot) ".runtime\python")
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$version = "3.12.8"
$arch = if ($env:PROCESSOR_ARCHITECTURE -match "64") { "amd64" } else { "win32" }
$zipName = "python-$version-embed-$arch.zip"
$url = "https://www.python.org/ftp/python/$version/$zipName"
$zipPath = Join-Path $env:TEMP $zipName

Write-Host "Downloading portable Python $version ($arch)..."

if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
Expand-Archive -Path $zipPath -DestinationPath $TargetDir -Force
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

foreach ($pth in Get-ChildItem -Path $TargetDir -Filter "python*._pth") {
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
  throw "Portable Python setup failed: $pythonExe"
}

Write-Host "Ready: $pythonExe"
