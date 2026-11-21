# 开机/登录后自动拉起局域网服务（由 Startup 文件夹里的 dsh-lan-autostart.vbs 调用）。
#
# 起两个实例，都是同一个 lan-server：
#   8443  https（有 certs\lan.pfx 时）—— 装好的 PWA 自动切换用的就是这个
#   8090  http —— 手机 Safari 直接打开用的备用入口
#
# 已经起着的端口会跳过，所以重复运行（比如手动再跑一次）不会起一堆进程。
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$log = Join-Path $root 'lan-autostart.log'

function Say([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  if (-not $Quiet) { Write-Host $line }
  try { $line | Out-File -LiteralPath $log -Append -Encoding utf8 } catch {}
}

function Test-Listening([int]$port) {
  # 不用 Get-NetTCPConnection（CIM 在某些受限环境里不可用），直接看 netstat
  $out = (netstat -ano | Select-String -Pattern ":$port\s+.*LISTENING")
  return [bool]$out
}

$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Say '找不到 node，无法启动'; exit 1 }
$nodePath = $node.Source
$server = Join-Path $root 'lan-server.mjs'
if (-not (Test-Path $server)) { Say "找不到 $server"; exit 1 }

$pfx = Join-Path $root 'certs\lan.pfx'
$pass = 'dsh-lan'

function Start-Lan([int]$port, [string[]]$extra) {
  if (Test-Listening $port) { Say "端口 $port 已在监听，跳过"; return }
  $cmdArgs = @($server, '--port', "$port") + $extra
  $outLog = Join-Path $root "lan-$port.log"
  $errLog = Join-Path $root "lan-$port.err.log"
  try {
    Start-Process -FilePath $nodePath -ArgumentList $cmdArgs -WorkingDirectory $root `
      -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    Start-Sleep -Milliseconds 1200
    if (Test-Listening $port) { Say "已启动 :$port（日志 lan-$port.log）" }
    else { Say "启动 :$port 失败，看 $errLog" }
  } catch {
    Say "启动 :$port 异常：$($_.Exception.Message)"
  }
}

if (Test-Path $pfx) {
  Start-Lan 8443 @('--pfx', $pfx, '--passphrase', $pass)
} else {
  Say '没有 certs\lan.pfx，跳过 https:8443（跑一次 lan-cert.ps1 就能补上）'
}
Start-Lan 8090 @()
