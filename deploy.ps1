#!/usr/bin/env pwsh
# 部署 index.html + sw.js 到 VPS，并写 /srv/dsh-mobile/VERSION 版本戳
# 用法：在 pwa/ 目录执行 ./deploy.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$dirty = git status --porcelain
if ($dirty) { Write-Warning "工作区有未提交改动：`n$dirty" }

$appv = (Select-String -Path (Join-Path $root 'index.html') -Pattern "const APP_VERSION = '(v\d+)'").Matches[0].Groups[1].Value
$swv = (Select-String -Path (Join-Path $root 'sw.js') -Pattern "dsh-mobile-v(\d+)").Matches[0].Value
$commit = (git rev-parse --short HEAD)
Write-Host "部署 APP $appv / $swv / commit $commit"

$key = 'D:\Vibe\CRM\.tools\id_rsa_relay'
$opt = @('-i', $key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=NUL')

scp @opt (Join-Path $root 'index.html') root@38.189.61.57:/srv/dsh-mobile/ | Out-Null
scp @opt (Join-Path $root 'sw.js') root@38.189.61.57:/srv/dsh-mobile/ | Out-Null

$stamp = "app=$appv`nsw=$swv`ncommit=$commit`ndeployed_at=$(Get-Date -Format o)"
$stamp | ssh @opt root@38.189.61.57 "cat > /srv/dsh-mobile/VERSION"
ssh @opt root@38.189.61.57 "cat /srv/dsh-mobile/VERSION"
