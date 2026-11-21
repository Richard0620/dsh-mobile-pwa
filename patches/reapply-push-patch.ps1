# 自愈：dsh-mobile-plugin 升级会覆盖我们的 Web Push 补丁。
# 本脚本检查补丁标记；缺失就重新贴回，贴之前先做语法校验，校验不过则保持原样。
$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'push-notify.js'          # 打好补丁的版本（与本脚本同目录）
$dst = Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-mobile-plugin\lib\mobile\push-notify.js'
$log = Join-Path $env:USERPROFILE '.dsh\push-patch.log'

function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $line -Encoding UTF8
}

try {
  if (-not (Test-Path $src)) { Write-Log '源补丁不存在，跳过'; exit 0 }
  if (-not (Test-Path $dst)) { Write-Log '插件文件不存在（可能未安装），跳过'; exit 0 }

  $cur = Get-Content $dst -Raw -Encoding UTF8
  if ($cur -match 'mirrorToWebPush') { exit 0 }          # 已打过，静默退出

  $tmp = Join-Path $env:TEMP 'push-notify.candidate.js'
  Copy-Item $src $tmp -Force
  & node --check $tmp 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Log '候选补丁语法校验失败，放弃'; exit 1 }

  Copy-Item $dst "$dst.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
  Copy-Item $src $dst -Force
  Write-Log '补丁已自动重贴'
} catch {
  Write-Log "出错: $($_.Exception.Message)"
}
