# 安装/卸载「登录时自动拉起局域网服务」。
#
#   .\install-autostart.ps1              # 安装（写一个无窗口启动器到「启动」文件夹）
#   .\install-autostart.ps1 -Uninstall   # 卸载
#   .\install-autostart.ps1 -Now         # 安装完立刻跑一次（不等下次登录）
#
# 为什么需要你自己跑一次：agent 会话跑在文件沙箱里，写不进去工作区以外的任何位置
# （Startup 文件夹、注册表 Run 键都会被拒绝）。这个脚本在普通 PowerShell 里跑没有这个限制。
param(
  [switch]$Uninstall,
  [switch]$Now
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$shim = Join-Path $startup 'dsh-lan-autostart.vbs'
$target = Join-Path $root 'autostart-lan.ps1'

if ($Uninstall) {
  if (Test-Path $shim) { Remove-Item $shim -Force; Write-Host "已删除启动项：$shim" -ForegroundColor Yellow }
  else { Write-Host '启动项本来就不存在' }
  return
}

if (-not (Test-Path $target)) { throw "找不到 $target" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '找不到 node（PATH 里没有）' }

$body = @(
  "' DSH LAN autostart -- 登录时隐藏窗口拉起局域网服务",
  "' 真正的逻辑在 autostart-lan.ps1；本文件只是无窗口启动器",
  'Set sh = CreateObject("WScript.Shell")',
  'sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $target + '""", 0, False'
)
[System.IO.File]::WriteAllText($shim, ($body -join "`r`n") + "`r`n", (New-Object System.Text.ASCIIEncoding))

if (-not (Test-Path $shim)) { throw "写入失败：$shim" }
Write-Host "已安装启动项：$shim" -ForegroundColor Green
Write-Host "它会在你每次登录 Windows 时，无窗口地运行：$target"

if ($Now) {
  Write-Host '正在立刻启动一次...'
  & $target
}

Write-Host ''
Write-Host '验证：登录后执行   netstat -ano | findstr ":8443 :8090"' -ForegroundColor Cyan
Write-Host '撤销：.\install-autostart.ps1 -Uninstall' -ForegroundColor Cyan
