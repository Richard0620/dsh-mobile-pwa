# 一键起局域网服务。
#
#   .\start-lan.ps1                 # 默认 http:8090 —— 验链路用这个，不需要证书
#   .\start-lan.ps1 -Https          # 用 certs\lan.pfx 走 https:8443（手机要先信任证书）
#   .\start-lan.ps1 -Port 9000
#
# 起完看它打印的地址，手机直接打开；配对码在 DSH 桌面端「设置 → 移动端」。
param(
  [int]$Port = 0,
  [switch]$Https
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pfx = Join-Path $root 'certs\lan.pfx'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '找不到 node，先确认 Node.js 装好并在 PATH 里'
}

if ($Https) {
  if (-not (Test-Path $pfx)) { throw "要用 -Https 得先生成证书：.\lan-cert.ps1（当前缺少 $pfx）" }
  $p = if ($Port) { $Port } else { 8443 }
  Write-Host "以 https 启动（证书：$pfx）—— 手机必须已安装并信任 certs\lan-ca.cer，否则页面会被拦" -ForegroundColor Cyan
  & node (Join-Path $root 'lan-server.mjs') --port $p --pfx $pfx --passphrase 'dsh-lan'
} else {
  $p = if ($Port) { $Port } else { 8090 }
  Write-Host '以 http 启动（没有离线缓存/主屏安装/通知，但足够验链路和体感）' -ForegroundColor Yellow
  & node (Join-Path $root 'lan-server.mjs') --port $p
}
