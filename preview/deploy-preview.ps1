#!/usr/bin/env pwsh
# 部署一个分支到 VPS 的 /srv/dsh-mobile/preview/<slug>/，供手机作为独立 PWA 测试。
# 用法：
#   .\preview\deploy-preview.ps1 -Branch feature/session-perms
#   .\preview\deploy-preview.ps1 -Hub          # 只更新 /preview/ 的选择页
# 说明：
#   - 不碰 /srv/dsh-mobile/index.html 和 sw.js，线上 main 完全不受影响
#   - 每个分支独立目录、独立 manifest、独立 SW scope、独立缓存前缀 dsh-preview-
#   - SW 的 activate 只清 dsh-preview-*，不会删主站缓存
param(
  [string]$Branch = '',
  [string]$Slug = '',
  [switch]$Hub,
  [switch]$Prune,
  [string]$Repo = 'D:\Vibe\PWA\pwa',
  [string]$Key = 'D:\Vibe\.ssh\keys\id_rsa_relay',
  [string]$Remote = 'root@38.189.61.57',
  [string]$Root = '/srv/dsh-preview'
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$opt = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=NUL')

function Invoke-Remote([string]$cmd) { & ssh @opt $Remote $cmd }
function Invoke-Copy([string]$src, [string]$dst) { & scp @opt $src $dst | Out-Null }

# 清理已经合入 origin/main 的分支预览（合并后分支不再需要占着 /preview/）
function Prune-Merged {
  $raw = ''
  try { $raw = (Invoke-Remote "cat $Root/branches.json 2>/dev/null") -join "`n" } catch { $raw = '' }
  if (-not $raw.Trim()) { Write-Host '没有 preview/branches.json'; return }
  $parsed = $raw | ConvertFrom-Json
  $items = @($parsed | ForEach-Object { $_ })
  $keep = @()
  foreach ($it in $items) {
    $b = [string]$it.branch
    $slug = [string]$it.slug
    if (-not $b -or $slug -notmatch '^[a-z0-9][a-z0-9._-]{0,60}$') { $keep += $it; continue }
    $exists = & git -C $Repo rev-parse --verify --quiet $b 2>$null
    if (-not $exists) { Write-Warning "分支不存在，保留预览：$b"; $keep += $it; continue }
    & git -C $Repo merge-base --is-ancestor $b origin/main 2>$null
    if ($LASTEXITCODE -eq 0) {
      Invoke-Remote "rm -rf $Root/$slug"
      Write-Host "removed merged preview: $b ($slug)"
    } else {
      $keep += $it
    }
  }
  $json = "[`n" + (($keep | ForEach-Object { $_ | ConvertTo-Json -Depth 5 -Compress }) -join ",`n") + "`n]"
  $tmp = Join-Path $env:TEMP 'dsh-preview-pruned.json'
  [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
  Invoke-Copy $tmp "$Remote`:$Root/branches.json"
  Write-Host "pruned; remaining=$($keep.Count)"
}

function Update-Branches([object]$entry, [switch]$Remove) {
  $raw = ''
  try { $raw = (Invoke-Remote "cat $Root/branches.json 2>/dev/null") -join "`n" } catch { $raw = '' }
  $items = @()
  if ($raw.Trim()) {
    try {
      $parsed = $raw | ConvertFrom-Json
      $items = @($parsed | ForEach-Object { $_ })
    } catch { $items = @() }
  }
  $items = @($items | Where-Object { $_ -and $_.slug -ne $entry.slug })
  if (-not $Remove -and $entry) { $items += $entry }
  $json = $items | ConvertTo-Json -Depth 5
  if (-not $json) { $json = '[]' }
  if ($json.TrimStart().StartsWith('{')) { $json = "[`n$json`n]" }
  $tmp = Join-Path $env:TEMP 'dsh-preview-branches.json'
  [IO.File]::WriteAllText($tmp, "[`n" + (($items | ForEach-Object { $_ | ConvertTo-Json -Depth 5 -Compress }) -join ",`n") + "`n]", (New-Object Text.UTF8Encoding($false)))
  Invoke-Copy $tmp "$Remote`:$Root/branches.json"
}

function Deploy-Hub {
  Invoke-Remote "mkdir -p $Root"
  Invoke-Copy (Join-Path $here 'index.html') "$Remote`:$Root/index.html"
  $raw = ''
  try { $raw = (Invoke-Remote "cat $Root/branches.json 2>/dev/null") -join "`n" } catch { $raw = '' }
  if (-not $raw.Trim()) {
    $tmp = Join-Path $env:TEMP 'dsh-preview-empty.json'
    [IO.File]::WriteAllText($tmp, "[]`n", (New-Object Text.UTF8Encoding($false)))
    Invoke-Copy $tmp "$Remote`:$Root/branches.json"
  }
  Write-Host "Hub: https://dsh.easymana.online:8443/preview/"
}

if ($Prune) { Prune-Merged; exit 0 }
if ($Hub) { Deploy-Hub; exit 0 }
if (-not $Branch) { throw '需要 -Branch，或使用 -Hub 只更新选择页' }

$commit = (& git -C $Repo rev-parse --short $Branch 2>$null)
if (-not $commit) { throw "分支不存在：$Branch" }
if (-not $Slug) {
  $Slug = $Branch.ToLower() -replace '[^a-z0-9._-]+', '-'
  $Slug = $Slug.Trim('-')
}
if ($Slug -notmatch '^[a-z0-9][a-z0-9._-]{0,60}$') { throw "Slug 不合法：$Slug" }

$tmp = Join-Path $env:TEMP ("dsh-preview-" + [guid]::NewGuid().ToString('N'))
$build = Join-Path $tmp 'build'
New-Item -ItemType Directory -Force -Path $build | Out-Null
$zip = Join-Path $tmp 'src.zip'
try {
  & git -C $Repo archive --format=zip -o $zip $Branch -- index.html sw.js manifest.webmanifest icon-192.png icon-512.png apple-touch-icon.png
  if ($LASTEXITCODE -ne 0) { throw "git archive 失败：$Branch" }
  Expand-Archive -Path $zip -DestinationPath $build -Force

  $idxPath = Join-Path $build 'index.html'
  $swPath = Join-Path $build 'sw.js'
  $mfPath = Join-Path $build 'manifest.webmanifest'
  foreach ($p in @($idxPath, $swPath, $mfPath)) { if (-not (Test-Path $p)) { throw "分支里缺少 $([IO.Path]::GetFileName($p))" } }

  $idx = [IO.File]::ReadAllText($idxPath)
  $sw = [IO.File]::ReadAllText($swPath)
  $app = ([regex]::Match($idx, "const APP_VERSION = '(v\d+)'")).Groups[1].Value
  $swv = ([regex]::Match($sw, "const CACHE = '([^']+)'")).Groups[1].Value
  if (-not $app) { throw 'index.html 里找不到 APP_VERSION' }
  $short = 'DSH ' + (($Branch -replace '^feature/', '') -replace '[^A-Za-z0-9._-]', '-')
  if ($short.Length -gt 12) { $short = $short.Substring(0, 12) }

  $branchEsc = $Branch.Replace('\', '\\').Replace("'", "\'")
  $idx = $idx.Replace('<title>AI-HUB</title>', "<title>AI-HUB · 预览 · $branchEsc</title>")
  $idx = $idx.Replace('<meta name="apple-mobile-web-app-title" content="AI-HUB">', "<meta name=`"apple-mobile-web-app-title`" content=`"$short`">")
  if ($idx -notmatch 'AI-HUB · 预览') { Write-Warning '标题未替换（可能页面结构变了）' }
  $marker = "<script>window.__DSH_PREVIEW__={branch:'$branchEsc',slug:'$Slug'};</script>"
  $idx = $idx -replace '(<head[^>]*>)', "`$1`n$marker"
  $switch = '<a href="../" style="position:fixed;left:8px;bottom:calc(env(safe-area-inset-bottom) + 92px);z-index:9999;font:11px -apple-system,sans-serif;padding:4px 8px;border-radius:999px;background:rgba(0,0,0,.55);color:#fff;text-decoration:none;opacity:.8">← 测试环境</a>'
  $idx = $idx.Replace('</body>', "$switch`n</body>")
  [IO.File]::WriteAllText($idxPath, $idx, (New-Object Text.UTF8Encoding($false)))

  $newCache = "dsh-preview-$Slug-$app"
  $sw2 = [regex]::Replace($sw, "const CACHE = '[^']+';", "const CACHE = '$newCache';", 1)
  if ($sw2 -notmatch [regex]::Escape("const CACHE = '$newCache';")) { throw 'sw.js 的 CACHE 替换失败' }
  $sw3 = [regex]::Replace($sw2, "keys\.filter\(k => k !== CACHE && k !== OPEN_CACHE\)\.map\(k => caches\.delete\(k\)\)", "keys.filter(k => k.startsWith('dsh-preview-') && k !== CACHE).map(k => caches.delete(k))")
  if ($sw3 -eq $sw2 -and $sw2 -match 'k !== CACHE && k !== OPEN_CACHE') { throw 'sw.js 的 activate 清理替换失败' }
  $sw3 = "/* preview build: $Branch -> $Slug; 只清 dsh-preview-* 缓存，不碰主站 */`n" + $sw3
  [IO.File]::WriteAllText($swPath, $sw3, (New-Object Text.UTF8Encoding($false)))

  $mf = Get-Content $mfPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $mf.name = "DSH · $Branch · $app"
  $mf.short_name = $short
  $mf.start_url = './'
  $mf.scope = './'
  $mf | Add-Member -NotePropertyName id -NotePropertyValue './' -Force
  $mf | Add-Member -NotePropertyName description -NotePropertyValue "预览分支 $Branch（$commit）" -Force
  [IO.File]::WriteAllText($mfPath, ($mf | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))

  $deployedAt = (Get-Date).ToString('o')
  $meta = [ordered]@{ branch=$Branch; slug=$Slug; app=$app; sw=$newCache; commit=$commit; deployedAt=$deployedAt; url="/preview/$Slug/" }
  [IO.File]::WriteAllText((Join-Path $build 'preview.json'), ($meta | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  $ver = "app=$app`nsw=$newCache`ncommit=$commit`nref=preview/$Slug`ndeployed_at=$deployedAt`nsource=preview`n"
  [IO.File]::WriteAllText((Join-Path $build 'VERSION'), $ver, (New-Object Text.UTF8Encoding($false)))

  Invoke-Remote "rm -rf $Root/$Slug && mkdir -p $Root/$Slug"
  $files = @(Get-ChildItem -Path $build -File | ForEach-Object { $_.FullName })
  & scp @opt @files "$Remote`:$Root/$Slug/" | Out-Null
  Update-Branches ([pscustomobject]$meta)
  Write-Host "Preview: https://dsh.easymana.online:8443/preview/$Slug/"
  Write-Host "Version: $app / $newCache / $commit"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
