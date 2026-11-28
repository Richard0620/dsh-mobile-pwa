param(
  [string]$Base = "http://127.0.0.1:18888",
  [string]$Token = $env:BRIDGE_TOKEN
)
$ErrorActionPreference = 'Stop'
if (-not $Token) {
  $f = Join-Path $env:LOCALAPPDATA 'agents-bridge\token.txt'
  if (Test-Path $f) { $Token = (Get-Content $f -Raw).Trim() }
}
if (-not $Token) { Write-Host 'FAIL: BRIDGE_TOKEN not set'; exit 1 }
$h = @{ Authorization = "Bearer $Token" }
$ok = $true

try {
  $health = Invoke-RestMethod -Uri ($Base + '/health') -Headers $h -TimeoutSec 10
  Write-Host ("health: " + $health.service)
} catch {
  Write-Host ("FAIL health: " + $_.Exception.Message); $ok = $false
}

try {
  $state = Invoke-RestMethod -Uri ($Base + '/dsh/state?pane=w1:p5') -Headers $h -TimeoutSec 10
  Write-Host ("dsh/state: exists=" + $state.exists)
} catch {
  Write-Host ("FAIL dsh/state (bridge missing /dsh endpoints?): " + $_.Exception.Message); $ok = $false
}

try {
  $html = (Invoke-WebRequest -UseBasicParsing -Uri ($Base + '/') -Headers $h -TimeoutSec 10).Content
  if ($html -match 'ver">v(\d+)') { Write-Host ("ui version: v" + $Matches[1]) } else { Write-Host 'FAIL ui version'; $ok = $false }
  if ($html -notmatch 'dsh/start') { Write-Host 'FAIL ui missing dsh/start'; $ok = $false }
  if ($html -notmatch 'renderLauncher') { Write-Host 'FAIL ui missing launcher'; $ok = $false }
  if ($html -notmatch "startAgent\('agy'\)") { Write-Host 'FAIL ui missing Gemini (agy) launcher'; $ok = $false }
  if ($html -notmatch 'openNewChatSheet') { Write-Host 'FAIL ui missing new chat sheet'; $ok = $false }
} catch {
  Write-Host ("FAIL ui: " + $_.Exception.Message); $ok = $false
}

if (-not $ok) { Write-Host 'SMOKE FAILED'; exit 1 }
Write-Host 'SMOKE OK'
