# 局域网直连（同一 Wi-Fi）

## 0. 为什么之前只有中转

不是插件只监听本机 —— 实测它一直在 `0.0.0.0:18787`，同一 Wi-Fi 下用内网 IP 打
`/api/mobile/v1/health` 就是 200。真正缺的是"谁能把 PWA 页面和同源 API 一起送到手机"：

| 层 | 中转（现状） | 局域网（缺的） |
|---|---|---|
| 页面 | VPS Caddy 上的 `/srv/dsh-mobile` | 没有人服务 |
| `/api/*` | VPS relay `:18788` → WSS 隧道 → 本机 | 直连本机 `:18787` |
| 同源 | Caddy 把两者放一个域名 | —— |

该 API **不返回 CORS 头**，跨域一律失败，所以页面和 API 必须同源，这正是
`lan-server.mjs` 存在的理由（和线上 Caddy 的规则一一对应）。

插件自带的局域网代理（`lib/relay/lan-proxy.js`）只服务**原生 App**：未认证请求一律
JSON 401，不给任何网页，所以它替代不了这一层。

## 1. 一分钟跑起来（http）

```powershell
cd D:\Vibe\PWA\pwa-c
node lan-server.mjs                 # 默认 0.0.0.0:8080
```

启动会自己打印要填进手机的地址：

```
  手机上打开  http://192.168.72.22:8080/
  ✓ 上游插件在线（/api/mobile/v1/health 200） · instance caaa4ec1
```

手机上（Safari）打开这个地址 → 输入 6 位配对码（DSH 桌面端 设置 → 移动端）→ 连接。

> **必须重新配对一次。** 凭据存在 `localStorage` 里，按 origin 隔离：线上是
> `https://dsh.easymana.online:8443`，局域网是 `http://192.168.x.x:8080`，两个站点互不相通。
> 配对后可以在菜单「恢复链接」里存一份，换设备/清缓存时直接粘。

## 2. 它做了哪些事

| 路径 | 去哪里 |
|---|---|
| `/`、`/sw.js`、图标、`manifest.webmanifest` | 本目录静态文件（`no-store`，改完刷新即生效） |
| `/api/**` | `http://127.0.0.1:18787`（插件） |
| `/__lan_pair` | 同上，局域网配对入口 |
| `/healthz`、`/push/**`、`/blob/**`、`/tunnel` | 同上 |
| WebSocket 升级 | 帧级透传（现在 PWA 只用 SSE，留着给将来的 HMR） |

SSE 单独照顾：显式带 `no-cache, no-transform` + `x-accel-buffering: no`，上游断开时
一起收连接，手机切后台留的半开连接不会吊死上游。

常用参数：

```powershell
node lan-server.mjs 9000                       # 换端口
node lan-server.mjs --host 127.0.0.1           # 只给本机（调样式用）
node lan-server.mjs --upstream 127.0.0.1:64197 # 直接打 DSH web 端口，绕过插件那层
```

## 3. http 能做到哪一步

浏览器只在**安全上下文**（https 或 localhost）里开放这些能力，局域网 IP 走 http 时：

| 能力 | http | https（第 4 节） |
|---|---|---|
| 收发消息、SSE 流式、文件、Git、审批 | ✅ | ✅ |
| 配对 | ✅（已加 `crypto.randomUUID` 兜底） | ✅ |
| 复制 | ✅（已加 `document.execCommand` 兜底） | ✅ |
| Service Worker / 离线缓存 | ❌ | ✅ |
| 主屏安装（独立窗口） | ❌ | ✅ |
| 通知 / Web Push | ❌ | ✅ |

也就是说 **http 是"能用"，https 才是"完整 PWA"**。为了这点差别，v69 已经把两处
只有安全上下文才有的 API 补上了等价兜底，所以 http 下配对和发消息不会报错。

## 4. 要完整能力：自签 https

一条命令签证书（本机 CA + 只对当前内网 IP 有效的服务端证书）：

```powershell
.\lan-cert.ps1                        # 自动取内网 IP
.\lan-cert.ps1 -Ip 192.168.72.22      # 或指定
```

产出在 `.\certs\`（已 `.gitignore`，私钥不进库）：

| 文件 | 用途 |
|---|---|
| `lan.pfx` | 给服务，口令 `dsh-lan` |
| `lan-ca.cer` | 要装到手机上的根证书 |
| `lan-cert.cer` | 服务端证书，排障时核对 SAN |

```powershell
node lan-server.mjs --port 8443 --pfx .\certs\lan.pfx --passphrase dsh-lan
```

手机（iPhone，一次性）：

1. 把 `lan-ca.cer` 传到手机（隔空投送 / 微信 / 邮件都行），点开 → 允许下载描述文件；
2. 设置 → 通用 → VPN 与设备管理 → 安装该描述文件；
3. 设置 → 通用 → 关于本机 → **证书信任设置** → 打开对该 CA 的完全信任；
4. Safari 打开 `https://192.168.72.22:8443/`（注意 https）。

安卓：设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书。

期限：服务端证书 2 年、根 CA 10 年。**换 Wi-Fi 换了内网 IP 就要重跑一次**
（证书 SAN 里写的是 IP，IP 变了浏览器一定报证书错误）。

> 生成脚本会尝试把根 CA 装进本机「受信任的根证书」，Windows 会弹一次确认框；
> 拒绝也不影响手机那条路。要撤销：`certutil -user -delstore Root "DSH Mobile LAN CA"`。

## 5. 手机连不上？先看防火墙

这是"同一 Wi-Fi 也连不上"最常见的真正原因。本机 `node.exe` 的入站规则实测**只对
Public 配置文件放行**；Wi-Fi 被识别成「专用/私有」网络时，入站会被静默丢掉。

以管理员身份跑一次（只对专用网络放开 8080/8443）：

```powershell
New-NetFirewallRule -DisplayName "DSH LAN (http)"  -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 8080 -Profile Private
New-NetFirewallRule -DisplayName "DSH LAN (https)" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 8443 -Profile Private
```

查现状：

```powershell
Get-NetConnectionProfile                                    # 当前网络是 Private 还是 Public
Get-NetFirewallRule -DisplayName "DSH LAN*" | Format-Table
```

## 6. 排障表

| 症状 | 查什么 |
|---|---|
| 手机打不开页面 | 电脑上 `curl http://127.0.0.1:8080/` 通不通？通就是防火墙/不同网段 |
| 页面出来了，卡在配对 | 配对码是不是过期（一次性，成功后轮换）；`/__lan_pair` 走不通才回落 `/api/mobile/v1/pair`（那条会 401） |
| 能进列表，发消息转圈 | 看 `lan-server` 控制台有没有 502；上游 18787 是不是被关了 |
| 消息不流式、要手动刷新 | 中间还有别的代理在攒 SSE；`lan-server` 直连插件时不会有这问题 |
| https 页面被拦 | 证书 SAN 里有没有这个 IP；手机有没有在「证书信任设置」里完全信任 |
| 换了网络就连不上 | 内网 IP 变了，重跑 `lan-cert.ps1` 并换手机上的地址 |

## 7. 和线上中转的关系

两条线**可以同时开**，互不影响：

- 手机在**家里**：用局域网地址，零中继、延迟最低；
- 手机在**外面**：用 `https://dsh.easymana.online:8443`，走 VPS 中转；
- 两个 origin 各有各的凭据，**都不要删主屏图标**（删了等于清掉那个 origin 的 localStorage）。

⚠️ 只有主会话部署线上；这个分支只改了本地服务与前端兜底，线上要等合并后再发。

## 8. 自动 / 手动切换（v71）

前面几节是「打开另一个网址」。真正实用的是**同一个页面里换 API 基址** —— 页面还是从
`https://dsh.easymana.online:8443` 加载（SW、离线缓存、推送、凭据都不动），只是每条请求
换一个前缀发出去。

### 8.1 怎么用

☰ → **连接方式**：

| 档位 | 行为 |
|---|---|
| **自动**（默认） | 打开时、回到前台时、以及每分钟各探一次局域网入口；通了就走内网，不通就走中转 |
| **仅中转** | 永远走公网中转（在外面、或本机没开 lan-server 时用） |
| **仅局域网** | 只走局域网，连不上就报错，不会悄悄退回中转 |

同一个面板里可以手填局域网入口（留空 = 自动发现）和端口。底部那行写的是「请求发往」——
它会实时显示当前打到哪儿。菜单标题也会显示 `v71 · 局域网 12ms · 宿主 xxxx` 或 `v71 · 中转 · …`。

### 8.2 它是怎么找到内网地址的

不用手填 IP：`/api/mobile/v1/connection-info`（中转链路上也能问）会返回宿主此刻的网卡候选
`lanCandidates[].url`。PWA 取其中的 IP，拼成 `https://<ip>:<lanPort>`（`lanPort` 就是
lan-server 监听的端口，默认 8443 —— 插件报的 18787 是它自己的口，不是我们的），再逐个探
`/api/mobile/v1/health`，第一个通的就切过去。

### 8.3 前提（这里必须说清楚）

自动切换只有在**局域网入口是 https 且手机信任了那张证书**时才成立：

- 页面是 https，浏览器不允许它 fetch `http://` 的地址（混合内容，直接拦掉）；
- 自签证书没被信任时，探测会失败（表现为 `连不上（证书未信任或不在同一网段）`），于是老实留在中转。

也就是说：**装了证书才有自动切换**；不装证书时，局域网那条仍可用「第 1/4 节的两个入口」
手动打开，只是那不叫切换。lan-server 也必须用 `--pfx`/`--cert` 跑在 https 上。

跨源能成立还靠 lan-server 里的 CORS：只回显内网/本机来源和中转域名，外加
`access-control-allow-private-network`（Chrome 的私有网络预检要这个头）。陌生站点拿不到
CORS 头，浏览器会拦；这层不替代鉴权，每条 API 仍旧要 Bearer 凭据。

### 8.4 排障

| 症状 | 原因 |
|---|---|
| 面板显示「连不上（证书未信任或不在同一网段）」 | 手机没装/没信任那张 CA，或换了 Wi-Fi IP 变了（重跑 `lan-cert.ps1`） |
| 显示「没有局域网候选」 | 插件里「局域网」关着，或 `lanEnabled=false` |
| 选「仅局域网」后一直报错 | 正常：这档不回落。切回「自动」即可 |
| 想临时锁死某条入口 | 网址后加 `?lanbase=https://192.168.72.22:8443`，只对这次有效 |

