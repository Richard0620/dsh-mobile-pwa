# Deploy DSH Mobile PWA from GitHub (the remote host pulls; no local scp).
#
#   ./deploy.ps1                # deploy origin/main
#   ./deploy.ps1 -Ref v123      # deploy a tag
#   ./deploy.ps1 -Ref <sha>     # deploy a commit
#
# Requires: local HEAD == origin/main (unless -Force), so what is live is traceable.
param(
  [string]$Ref = 'origin/main',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$key = 'D:\Vibe\.ssh\keys\id_rsa_relay'
$opt = @('-i', $key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=NUL')
$hostName = 'root@38.189.61.57'

Set-Location $PSScriptRoot
git fetch origin --quiet 2>$null
$head = (git rev-parse --short HEAD)
$main = (git rev-parse --short origin/main)
Write-Host "local HEAD=$head  origin/main=$main"
if (-not $Force -and $head -ne $main) {
  Write-Warning "local HEAD differs from origin/main. Push/merge first, or pass -Force."
  exit 1
}

ssh @opt $hostName "bash /opt/dsh-mobile-deploy.sh $Ref"
ssh @opt $hostName "cat /srv/dsh-mobile/VERSION"