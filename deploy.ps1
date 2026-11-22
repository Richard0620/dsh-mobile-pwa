# Deploy DSH Mobile PWA from GitHub (the server pulls; no local scp).
#
#   ./deploy.ps1                # static PWA from origin/main
#   ./deploy.ps1 -Push          # static PWA + Web Push service (restarts dsh-push ~1s)
#   ./deploy.ps1 -Ref v123      # deploy a tag
#   ./deploy.ps1 -Ref <sha>     # deploy a commit
#   ./deploy.ps1 -Force         # allow when local HEAD != origin/main
param(
  [string]$Ref = 'origin/main',
  [switch]$Force,
  [switch]$Push
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
  Write-Warning 'local HEAD differs from origin/main. Push and merge first, or pass -Force.'
  exit 1
}

ssh @opt $hostName "bash /opt/dsh-mobile-deploy.sh $Ref"

if ($Push) {
  Write-Host '--- push service ---'
  ssh @opt $hostName "bash /opt/dsh-push-deploy.sh $Ref"
}

ssh @opt $hostName "cat /srv/dsh-mobile/VERSION"
