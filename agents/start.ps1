# Start the agents bridge + reverse tunnel (idempotent). Used at logon.
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $env:LOCALAPPDATA 'agents-bridge'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'start.log'
function L([string]$m) { Add-Content $log ("{0} {1}" -f (Get-Date -Format s), $m) }

if (-not $env:BRIDGE_TOKEN) {
  $tf = Join-Path $logDir 'token.txt'
  if (Test-Path $tf) { $env:BRIDGE_TOKEN = (Get-Content $tf -Raw).Trim() }
}
if (-not $env:BRIDGE_TOKEN) { L 'no BRIDGE_TOKEN; abort'; exit 1 }

$node = 'C:\Program Files\nodejs\node.exe'
$bridge = Join-Path $here 'bridge.mjs'
$tunnel = Join-Path $here 'tunnel.ps1'

$listen = Get-NetTCPConnection -LocalPort 18888 -State Listen -ErrorAction SilentlyContinue
if (-not $listen) {
  Start-Process -FilePath $node -ArgumentList $bridge -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'bridge.out.log') `
    -RedirectStandardError  (Join-Path $logDir 'bridge.err.log')
  L 'bridge started'
} else {
  L 'bridge already listening'
}

$running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*tunnel.ps1*' }
if (-not $running) {
  Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tunnel -WindowStyle Hidden
  L 'tunnel loop started'
} else {
  L 'tunnel loop already running'
}
