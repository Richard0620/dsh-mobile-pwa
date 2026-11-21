#!/usr/bin/env pwsh
# 部署 index.html + sw.js 到 VPS，并写 /srv/dsh-mobile/VERSION 版本戳
# 用法：在 pwa/ 目录执行 ./deploy.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$dirty = git status --porcelain
if ($dirty) {
  Write-Error "工作区不干净，拒绝部署（避免把别的会话未提交的改动带上线）：`n$dirty"
  exit 1
}

# 部署前静态预检：语法、版本/CACHE 一致性、冲突标记、补丁语法
node (Join-Path $root 'scripts\preflight.mjs')
if ($LASTEXITCODE -ne 0) { Write-Error 'preflight 未通过，拒绝部署'; exit 1 }

$appv = (Select-String -Path (Join-Path $root 'index.html') -Pattern "const APP_VERSION = '(v\d+)'").Matches[0].Groups[1].Value
$swv = (Select-String -Path (Join-Path $root 'sw.js') -Pattern "dsh-mobile-v(\d+)").Matches[0].Value
$commit = (git rev-parse --short HEAD)
Write-Host "部署 APP $appv / $swv / commit $commit"

$key = 'D:\Vibe\CRM\.tools\id_rsa_relay'
$opt = @('-i', $key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=NUL')

scp @opt (Join-Path $root 'index.html') root@38.189.61.57:/srv/dsh-mobile/ | Out-Null
scp @opt (Join-Path $root 'sw.js') root@38.189.61.57:/srv/dsh-mobile/ | Out-Null

# 上传后按 md5 校验，防止 scp 半截/被并行会话覆盖而不自知
foreach ($f in @('index.html', 'sw.js')) {
  $local = (Get-FileHash (Join-Path $root $f) -Algorithm MD5).Hash.ToLower()
  $remote = ((ssh @opt root@38.189.61.57 "md5sum /srv/dsh-mobile/$f") -split '\s+')[0].ToLower()
  if ($local -ne $remote) { Write-Error "$f 上传后 md5 不一致（本地 $local / 线上 $remote）"; exit 1 }
  Write-Host "$f md5 一致"
}

$stamp = "app=$appv`nsw=$swv`ncommit=$commit`ndeployed_at=$(Get-Date -Format o)"
$stamp | ssh @opt root@38.189.61.57 "cat > /srv/dsh-mobile/VERSION"
ssh @opt root@38.189.61.57 "cat /srv/dsh-mobile/VERSION"
