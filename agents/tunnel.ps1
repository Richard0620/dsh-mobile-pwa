# Keep a reverse tunnel open: VPS 127.0.0.1:18888 -> host 127.0.0.1:18888
$key = if ($env:AGENTS_SSH_KEY) { $env:AGENTS_SSH_KEY } else { 'D:\Vibe\.ssh\keys\id_rsa_relay' }
$logDir = Join-Path $env:LOCALAPPDATA 'agents-bridge'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'tunnel.log'

while ($true) {
  Add-Content $log ("{0} connecting" -f (Get-Date -Format s))
  & ssh -i $key -N -R 18888:127.0.0.1:18888 `
      -o BatchMode=yes -o StrictHostKeyChecking=no `
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 `
      -o ExitOnForwardFailure=yes root@38.189.61.57 2>> $log
  Add-Content $log ("{0} ssh exited; retry in 5s" -f (Get-Date -Format s))
  Start-Sleep -Seconds 5
}
