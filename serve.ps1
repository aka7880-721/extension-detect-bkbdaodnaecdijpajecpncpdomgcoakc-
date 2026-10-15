param(
  [int]$Port = 3000,
  [string]$Root = $PSScriptRoot,
  [int]$MaxPort = 3010,
  [string]$HostAddress = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

function Start-ServerOnPort($tryPort) {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://${HostAddress}:$tryPort/")
  $listener.Start()
  return $listener
}

$listener = $null
$boundPort = $null

for ($p = $Port; $p -le $MaxPort; $p++) {
  try {
    $listener = Start-ServerOnPort $p
    $boundPort = $p
    break
  } catch {
    Write-Host "Port $p unavailable: $($_.Exception.Message)"
  }
}

if (-not $listener) {
  Write-Host "ERROR: Could not bind any port from $Port to $MaxPort."
  exit 1
}

Write-Host "Serving $Root on http://${HostAddress}:$boundPort/"
Write-Host "Press Ctrl+C to stop."

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $path = $context.Request.Url.LocalPath
  if ($path -eq "/") { $path = "/index.html" }
  $relative = $path.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
  $file = Join-Path $Root $relative

  try {
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
      $type = switch ($ext) {
        ".html" { "text/html; charset=utf-8" }
        ".js" { "text/javascript; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".bat" { "text/plain; charset=utf-8" }
        ".md" { "text/plain; charset=utf-8" }
        default { "application/octet-stream" }
      }
      $context.Response.StatusCode = 200
      $context.Response.ContentType = $type
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $context.Response.StatusCode = 404
      $body = [Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $context.Response.OutputStream.Write($body, 0, $body.Length)
    }
  } finally {
    $context.Response.OutputStream.Close()
  }
}
