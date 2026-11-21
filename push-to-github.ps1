# 把整个仓库（主线 + 所有 feature 分支）推到 GitHub。
#
#   .\push-to-github.ps1 -Repo dsh-mobile-pwa [-Private]
#
# token 从 D:\Vibe\PWA\_token.txt 读（经典 PAT，scope: repo，加 workflow 更稳），
# 用完记得撤销。脚本不会把 token 写进 .git/config。
param(
  [string]$Repo = 'dsh-mobile-pwa',
  [switch]$Private = $true,
  [string]$TokenFile = 'D:\Vibe\PWA\_token.txt',
  [string]$Owner = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

if (-not (Test-Path $TokenFile)) { throw "找不到 token 文件：$TokenFile" }
$token = (Get-Content $TokenFile -Raw).Trim()
if ($token.Length -lt 20) { throw 'token 看起来不对（太短）' }

$headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'dsh-push'; Accept = 'application/vnd.github+json' }

# 1) 确认身份
$me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers
if (-not $Owner) { $Owner = $me.login }
Write-Host "GitHub 身份：$Owner"

# 2) 建库（已存在就跳过）
$body = @{ name = $Repo; private = [bool]$Private; auto_init = $false } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Method Post -Headers $headers -Body $body -ContentType 'application/json' | Out-Null
  Write-Host "已创建仓库 $Owner/$Repo（private=$Private）"
} catch {
  $msg = $_.Exception.Message
  if ($msg -match '422|already exists') { Write-Host "仓库已存在，继续推送：$Owner/$Repo" }
  else { throw }
}

# 3) 配远程（token 只在内存里用，不落盘）
$url = "https://github.com/$Owner/$Repo.git"
$existing = git remote
if ($existing -contains 'origin') { git remote set-url origin $url } else { git remote add origin $url }

# 用一次性的 http 额外头把凭据带过去，避免写进 .git/config
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$token"))
$gitAuth = @('-c', "http.extraheader=Authorization: Basic $basic")

# 4) 主线：本地 master 推到远端 main（GitHub 默认分支）
Write-Host '推送 master -> main ...'
& git @gitAuth push origin master:main
if ($LASTEXITCODE -ne 0) { throw '推 main 失败' }

# 5) 所有 feature 分支
$branches = git for-each-ref --format='%(refname:short)' refs/heads | Where-Object { $_ -ne 'master' }
foreach ($b in $branches) {
  Write-Host "推送 $b ..."
  & git @gitAuth push origin "${b}:${b}"
  if ($LASTEXITCODE -ne 0) { Write-Warning "分支 $b 推送失败（继续）" }
}

# 6) 默认分支设为 main
$dflt = @{ default_branch = 'main' } | ConvertTo-Json
try { Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo" -Method Patch -Headers $headers -Body $dflt -ContentType 'application/json' | Out-Null } catch { Write-Warning "设置默认分支失败：$($_.Exception.Message)" }

# 7) 本地 master 跟踪 origin/main
git config "branch.master.remote" origin
git config "branch.master.merge" "refs/heads/main"

# 8) 校验：master 与 origin/main 必须同一个提交
git fetch origin --quiet
$local = git rev-parse master
$remote = git rev-parse origin/main
Write-Host "master   = $local"
Write-Host "origin/main = $remote"
if ($local -eq $remote) { Write-Host '✅ master 与 origin/main 一致' -ForegroundColor Green }
else { Write-Warning 'master 与 origin/main 不一致，检查是否有人并行推送' }

Write-Host ''
Write-Host "仓库地址：https://github.com/$Owner/$Repo"
Write-Host "提醒：用完请撤销 token，并删除 $TokenFile"
