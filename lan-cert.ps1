# 编码注意：本文件必须保存为 UTF-8 with BOM。Windows PowerShell 5.1 读无 BOM 的 UTF-8 会当 ANSI，
# 中文注释里的字符会把下一行语法一起带坏（实测 11 个 parse error）。改完用编辑器确认编码。
# 给局域网直连签一张证书：本机自建 CA + 只对「当前内网 IP」有效的服务端证书。
#
#   .\lan-cert.ps1                     # 用自动探测到的内网 IP
#   .\lan-cert.ps1 -Ip 192.168.1.23    # 指定 IP
#
# 产出（默认 .\certs\）：
#   lan.pfx            服务端证书 + 私钥（node lan-server.mjs --pfx 用）
#   lan-ca.cer         根证书，装到手机上并信任（一次性）
#   lan-cert.cer       服务端证书明文，排障时用它核对 SAN
#
# 为什么不能直接用 http：浏览器只在「安全上下文」里开放 Service Worker、离线缓存、
# 主屏安装和通知 —— https 或 localhost 才算。局域网 IP 永远是 http，所以必须自己签。
param(
  [string]$Ip = '',
  # 换 Wi-Fi 前先把常去的地址一起签进去（家里/公司/热点），之后不用重签
  [string[]]$AlsoIps = @(),
  # 稳定名字（mDNS）：IP 会随网络变，这个名字不变，所以证书签它就等于一劳永逸
  [string]$DnsName = '',
  [string]$Out = (Join-Path $PSScriptRoot 'certs'),
  [string]$Passphrase = 'dsh-lan'
)

$ErrorActionPreference = 'Stop'

if (-not $DnsName) {
  $DnsName = ([System.Net.Dns]::GetHostName().ToLower() -split '\.')[0] + '.local'
}

# 默认把本机当前所有内网 IPv4 都签进去：多网卡（网线 + Wi-Fi）、多网段一次覆盖
$ips = @()
if ($Ip) { $ips += $Ip }
else {
  $ips += (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.|198\.1[89]\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)' } |
    Sort-Object -Property SkipAsSource, InterfaceMetric |
    ForEach-Object { $_.IPAddress })
}
foreach ($extra in $AlsoIps) { $ips += ($extra -split '[,，\s]+') }
$ips = $ips | Where-Object { $_ } | ForEach-Object { $_.Trim() } | Select-Object -Unique

if (-not $ips -or $ips.Count -eq 0) { throw '找不到内网 IP，用 -Ip 指定一个' }
foreach ($one in $ips) {
  if ($one -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$') { throw "IP 要 IPv4 地址，收到：$one" }
}
$Ip = $ips[0]   # 第一个留给下面打印用

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$caName = 'DSH Mobile LAN CA'
$leafName = "DSH Mobile LAN ($($ips -join ', '))"

# 1) 根 CA：只有它在手机上需要「完全信任」
$ca = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq "CN=$caName" } | Select-Object -First 1
if (-not $ca) {
  $ca = New-SelfSignedCertificate `
    -Subject "CN=$caName" `
    -KeyAlgorithm RSA -KeyLength 3072 `
    -KeyExportPolicy Exportable `
    -KeyUsage CertSign, CRLSign, DigitalSignature `
    -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=1') `
    -CertStoreLocation Cert:\CurrentUser\My `
    -NotAfter (Get-Date).AddYears(10)
  Write-Host "已新建根 CA：$caName（有效期 10 年）"
} else {
  Write-Host "复用已有根 CA：$caName（指纹 $($ca.Thumbprint.Substring(0,16))…）"
}

# 2) 服务端证书：SAN 里放 IP，iOS 只认 SAN，不看 CN
$dnsNames = @($DnsName, 'localhost') | Where-Object { $_ } | Select-Object -Unique
$sanParts = @($ips | ForEach-Object { "IPAddress=$_" }) + @($dnsNames | ForEach-Object { "DNS=$_" })
$san = "2.5.29.17={text}" + ($sanParts -join '&')
$leaf = New-SelfSignedCertificate `
  -Subject "CN=$Ip" `
  -Signer $ca `
  -KeyAlgorithm RSA -KeyLength 2048 `
  -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature, KeyEncipherment `
  -TextExtension @($san, '2.5.29.37={text}1.3.6.1.5.5.7.3.1') `
  -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddYears(2)

# 3) 导出：PFX 给 node，CER 给手机
$pfxPath = Join-Path $Out 'lan.pfx'
$pfxSecret = ConvertTo-SecureString -String $Passphrase -Force -AsPlainText
Export-PfxCertificate -Cert $leaf -FilePath $pfxPath -Password $pfxSecret | Out-Null
Export-Certificate -Cert $ca -FilePath (Join-Path $Out 'lan-ca.cer') -Type CERT | Out-Null
Export-Certificate -Cert $leaf -FilePath (Join-Path $Out 'lan-cert.cer') -Type CERT | Out-Null

# 4) 自检：SAN 里必须真的有每一个 IP，否则手机一定报证书错误
$x509 = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($leaf.RawData)
$sanText = ($x509.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' }).Format($false)
foreach ($one in $ips) {
  if ($sanText -notmatch [regex]::Escape("IP Address=$one")) {
    throw "证书 SAN 里没有 $one（实际：$sanText）"
  }
}
foreach ($dn in $dnsNames) {
  if ($sanText -notmatch [regex]::Escape("DNS Name=$dn")) {
    throw "证书 SAN 里没有 $dn（实际：$sanText）"
  }
}

# 本机自己也要信任这张 CA，否则电脑上 curl/Chrome 也会拦。
# 装根证书时 Windows 会弹一次确认框；被拒绝也不影响手机那条路，所以只提示不失败。
if ($env:DSH_LAN_NO_TRUST -ne '1') {
  $trusted = Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $ca.Thumbprint }
  if (-not $trusted) {
    try {
      Import-Certificate -FilePath (Join-Path $Out 'lan-ca.cer') -CertStoreLocation Cert:\CurrentUser\Root -ErrorAction Stop | Out-Null
      Write-Host '已把根 CA 装进「当前用户 → 受信任的根证书」'
    } catch {
      Write-Host '（根 CA 没装进本机受信任列表 —— 弹窗被拒或取消。手机那条路不受影响；'
      Write-Host "   之后想装：certutil -user -addstore Root `"$(Join-Path $Out 'lan-ca.cer')`"）"
    }
  }
}

Write-Host ''
Write-Host "内网 IP      $($ips -join ', ')"
Write-Host "稳定名字     $DnsName"
Write-Host "服务端证书   $pfxPath   口令 $Passphrase"
Write-Host "手机要装的   $(Join-Path $Out 'lan-ca.cer')（只需装一次，换网络不用重装）"
Write-Host ''
Write-Host '下一步：'
Write-Host "  node lan-server.mjs --port 8443 --pfx `"$pfxPath`" --passphrase $Passphrase --name $DnsName"
Write-Host ''
Write-Host "手机上的稳定地址（换 Wi-Fi 不变）：  https://${DnsName}:8443/"
Write-Host ''
Write-Host '手机（iPhone，一次性）：'
Write-Host '  1. 把 lan-ca.cer 用隔空投送/微信/邮件发到手机，点开 → 允许下载描述文件'
Write-Host '  2. 设置 → 通用 → VPN 与设备管理 → 安装该描述文件'
Write-Host '  3. 设置 → 通用 → 关于本机 → 证书信任设置 → 打开对该 CA 的完全信任'
Write-Host '  4. Safari 打开 https://' + $Ip + ':8443/ （注意是 https）'
Write-Host '安卓：设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书'
