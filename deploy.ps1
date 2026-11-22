# Deploy DSH Mobile PWA from GitHub (the server pulls; no local scp).
#
#   ./deploy.ps1                # static PWA from origin/main
#   ./deploy.ps1 -Push          # static PWA + Web Push service (restarts dsh-push ~1s)
#
# 只允许部署 origin/main。feature 分支预览请用 /preview/ 环境，不要走这里。
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

if ($Ref -ne 'origin/main') {
  Write-Error "只允许部署 origin/main（收到 $Ref）。feature 分支请用 /preview/ 测试环境，合并到 main 后再部署。"
  exit 1
}
if ($Force) {
  Write-Error '-Force 已禁用。部署前先把本地 master 快进到 origin/main。'
  exit 1
}

git fetch origin --quiet 2>$null
$head = (git rev-parse --short HEAD)
$main = (git rev-parse --short origin/main)
Write-Host "local HEAD=$head  origin/main=$main"

if ($head -ne $main) {
  Write-Error 'local HEAD 与 origin/main 不一致：先推 feature 分支、开 PR、合并，再 git merge --ff-only origin/main。'
  exit 1
}

ssh @opt $hostName "bash /opt/dsh-mobile-deploy.sh $Ref"

if ($Push) {
  Write-Host '--- push service ---'
  ssh @opt $hostName "bash /opt/dsh-push-deploy.sh $Ref"
}

$ver = (ssh @opt $hostName "cat /srv/dsh-mobile/VERSION") -join "`n"
$ver
if ($ver -notmatch 'ref=origin/main' -or $ver -notmatch "commit=$main") {
  Write-Error "部署后 VERSION 与 origin/main 不一致：`n$ver"
  exit 1
}
