# DSH Mobile PWA · 部署手册

目标：手机通过 https 打开自己搭的 PWA，直连你电脑上的 `dsh-mobile-plugin`。
不经过第三方中转，不需要开发者账号，不需要上架。

---

## 0. 上线前必须做的两件事

```bash
# 1) 删掉本地调试用的凭据引导（里面是明文 token，绝对不能部署）
rm /srv/dsh-mobile/dev-token.json

# 2) 删掉演示截图，别把目录结构泄出去（可选）
rm -rf /srv/dsh-mobile/shots
```

要部署的只有 5 个文件：

```
index.html
manifest.webmanifest
sw.js
icon-192.png  icon-512.png  icon-maskable-512.png
```

`dev-proxy.mjs` 和 `Caddyfile` 是**不**放进 web 根的（放外面）。

---

## 1. 形态 A：Caddy 跑在宿主机上（推荐先做这个）

### 1.1 网络

| 选法 | 做法 | 适合 |
|---|---|---|
| **Tailscale**（最省事） | 手机和电脑装同一 tailnet；用 `tailscale cert <machinename>.ts.net` 拿合法证书 | 只给自己用 |
| **Tailscale Funnel** | `tailscale funnel 443 on`，公网可访问但只有你 | 想在外面用、不想开端口 |
| **自有域名** | DNS A 记录指向公网 IP，Caddy 自动签 Let's Encrypt | 有域名、有固定 IP |
| **自签** | `tls internal` | 只在局域网，且要手动信任证书 |

> PWA **必须** https（`localhost` 除外）。局域网 `http://192.168.x.x` 装不上主屏幕。

### 1.2 装 Caddy 并起服务

```bash
# Debian/Ubuntu
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo apt update && sudo apt install -y caddy

# 配置
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Windows 上直接用 `caddy.exe run --config Caddyfile`，或注册成服务（`caddy start`）。

### 1.3 验收（按顺序做，每步都要过）

```bash
# ① 插件本身活着
curl http://127.0.0.1:18787/api/mobile/v1/health
# → {"ok":true,"service":"dsh-mobile-plugin",...}

# ② 反代活着（经过 Caddy）
curl https://dsh.example.com/api/mobile/v1/health
# → 同上

# ③ SSE 没有憋住：应该立刻看到 ": connected" 和后续帧，不是等 30 秒一次性吐出来
curl -N -H "Authorization: Bearer <凭据>" \
     "https://dsh.example.com/api/mobile/v1/events/stream"
# 正常：立刻出现 ": connected"，之后每 15s 一帧
# 异常：卡住不动 → flush_interval 没生效 / 中间还有一层缓冲代理

# ④ 静态页
curl -I https://dsh.example.com/
# → 200，content-type: text/html
```

### 1.4 手机安装

- **iOS**：Safari 打开 → 分享 → 「添加到主屏幕」。必须用 Safari，Chrome 不行。
  装好后从主屏幕启动才是全屏（`display: standalone`）。
- **Android**：Chrome 打开 → 菜单 → 「安装应用」/ 地址栏右侧的安装图标。
  有 `sw.js` 才会生成 WebAPK（独立窗口），否则只是个快捷方式。

### 1.5 首次配对

在**局域网或 Tailscale 内**完成一次：

1. 电脑端：设置 → 移动端 → 拿到 6 位配对码；
2. 手机端：打开 PWA → 输入配对码 → 连接。

凭据有效期约 1 年，之后换网络也不用重配。
（所以 `/__lan_pair` 不需要暴露到公网，见 Caddyfile 里的注释。）

---

## 2. 形态 B：静态在云、回源走隧道

宿主机：

```bash
# 反向隧道，把云上的 18787 接到本机插件
ssh -N -R 18787:127.0.0.1:18787 user@korea-cloud
# 想常驻：autossh -M 0 -N -R 18787:127.0.0.1:18787 user@korea-cloud
```

云上 Caddy：用 Caddyfile 里「形态 B」那段，或直接把 `reverse_proxy 127.0.0.1:18787`
指向隧道端口。静态文件放云上 `/srv/dsh-mobile`。

云上这层**只做通道**：不要加缓存、不要记会话内容、不要解 E2EE。

---

## 3. 不在同一网络时怎么连（四条路）

（原先这里写的是"插件自带的中转不开源"——**那是错的**。服务端在
[`WNLUO/dsh-mobile-server`](https://github.com/WNLUO/dsh-mobile-server)，Rust / MIT，
有预编译 musl 二进制和安装脚本。所以自建中转从"不划算"变成了**首选**。）

### 3.1 自建官方中转（**跨网络首选**）

```
手机 PWA ──https──► 中转 VPS ──┬─ /        静态 PWA
                              └─ /api/*   relay:18788 ──WSS 隧道──► 宿主机插件
```

宿主插件从内网**主动出站**建一条 WSS 隧道，手机的所有请求（HTTP / SSE / WebSocket，
帧级透传）都由中转转过去。宿主机不需要公网 IP，不用在路由器开端口。

协议要点（`server/relay-core/PROTOCOL.md`，v2）：

- 宿主 `register {instanceId, version, secret?}` 登记隧道；手机请求按
  **`X-Dsh-Instance` 头**分发；
- 不带这个头时，**仅在恰好一台宿主在线**才转发 —— 单机部署时 PWA 不带头也能用；
- `/healthz`、`/status`、`/api/mobile/v1/health`、`push-token`、`blob/*` 由中转自答；
- 设 `TUNNEL_REGISTER_SECRET` 防止别人拿你的 instanceId 顶掉隧道（**公网/多人共用务必设**）；
- 宿主换中转时留 30 天迁移记录，手机收到 503 + `x-dsh-migrated-to` 自动切过去。

VPS 上装：

```sh
curl -fsSLO https://raw.githubusercontent.com/WNLUO/dsh-mobile-server/main/server/relay/rust/deploy/install-binary.sh
sudo sh install-binary.sh     # 校验 sha256 → 试跑 → 装成 systemd → 开自动更新
# 默认只监听 127.0.0.1:18788，前面配 HTTPS/WSS 反代
```

Caddy（和静态同源，顺带把 CORS 彻底绕开）：

```caddyfile
dsh.example.com {
	handle /api/* {
		reverse_proxy 127.0.0.1:18788 {
			flush_interval -1
			transport http { read_timeout 24h
			                 write_timeout 24h }
		}
	}
	handle {
		root * /srv/dsh-mobile
		try_files {path} /index.html
		file_server
	}
}
```

宿主机：插件设置 → 移动端 → 中转地址填 `https://dsh.example.com`（无头部署用
`DSH_RELAY_REGISTER_SECRET` 那套环境变量）。之后手机在任何网络下都能连。

> PWA 侧只需两处配合，**已经写进代码**：请求带 `X-Dsh-Instance`（配对回包里拿到），
> 配对时先试 `/__lan_pair`、失败再试 `/api/mobile/v1/pair`。
> 配对走中转时不需要实例头（单机）；多宿主时要在配对前指定实例。

### 3.2 手机装 Tailscale（最快，延迟最低）

宿主机 + 手机登同一 tailnet。手机在 4G/5G 时：

- 能打洞 → **点对点直连**，延迟和局域网几乎一样；
- 打不通 → 自动降级走 **DERP 中继**（Tailscale 的加密中继）。

这本身就是"中转"，只是中继是 Tailscale 的不是他们的。PWA 不需要任何改动——
它看到的就是一个 `100.x` 的地址。

```bash
# 宿主机
winget install Tailscale.Tailscale
tailscale up
tailscale cert <机器名>.xxxx.ts.net     # 拿合法证书，PWA 才能装主屏幕
```

### 3.3 手机不想装 Tailscale → Tailscale Funnel

只有宿主机需要装 Tailscale，手机就是个普通浏览器。

```bash
tailscale funnel --bg 443 on          # 或：tailscale funnel 8080
tailscale funnel status               # 确认公网地址
```

得到 `https://<机器名>.xxxx.ts.net/` 这样的公网 https，手机直接开、直接装主屏幕。
出口走 Tailscale 边缘，你不用在路由器上开端口。

> 唯一限制：Funnel 只允许 443/8443/10000 这几个端口，且要求 tailnet 开了 Funnel。

### 3.4 完全不用 Tailscale → 云上反代 + 隧道（形态 B）
见第 2 节。代价是多一跳 + 要保活隧道。**美国云优先**（和宿主机同区），韩国云只在
人真的在亚洲时才有优势。

### 3.5 四条路怎么选

| 场景 | 选哪条 | 理由 |
|---|---|---|
| **人和电脑在同一 Wi-Fi** | 局域网直连（`http://<内网IP>:18787` 或 `.ts.net`） | 零中继、延迟最低 |
| **经常在外面用** | **3.1 自建中转** | 不用装 Tailscale、不用公网 IP、有镜像缓存兜底 |
| 临时用一次、不想动 VPS | 3.3 Funnel | 宿主机一条命令 |
| 只有一两台设备、能装 App | 3.2 Tailscale | 点对点，免费 |

### 3.6 自建中转之后，还剩哪些差距

自建**官方**中转（3.1）之后，绝大多数能力是对齐的——因为就是同一份服务端：

| 能力 | 自建中转 | 备注 |
|---|---|---|
| HTTP / SSE / WebSocket 透传 | ✅ | 帧级，`httpChunk` 直接透 |
| 镜像快照兜底 | ✅ | `MIRROR_CACHE` 默认开，隧道抖动时不白屏 |
| 配对走中转 | ✅ | 走 `/api/mobile/v1/pair`，不用开端口 |
| 迁移/换中转 | ✅ | 30 天记录 + `x-dsh-migrated-to` |
| 历史 blob（离线历史） | ✅ | `BLOB_STORE=1`，只存密文、不持钥 |
| **iOS 离线推送** | ⚠️ | 中转支持 APNs，但**推送能力绑 App 的 bundle id**：推官方 App 必须用他们团队的 `.p8`；给 PWA 推则没有意义（浏览器 PWA 在 iOS 上要 16.4+ 且已装主屏幕）。**这是我们唯一没补的** |
| 加密 | 可选 | 走公网中转时建议上 v2 信封；我们自己控 TLS 终点则不必 |

> 换句话说：**除了 iOS 锁屏推送，自建中转能拿到和他们一样的能力**。

---

## 4. 排错表

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面能开，列表一直空 | 401（凭据失效/被吊销） | 重新配对；看 console 里 `device-revoked` |
| 消息能加载，但不实时 | SSE 被缓冲 | `flush_interval -1`；确认中间只有一层反代 |
| 隔 35 秒断一次 | 心跳没到达 | 反代 `read_timeout` 太短，或中间代理砍空闲连接 |
| Android 没有"安装"按钮 | 缺 SW 或非 https | 确认 `sw.js` 200 且作用域 `/`；必须 https |
| iOS 装完还是带地址栏 | 从 Chrome 装的 | 用 Safari 重装 |
| `pair` 返回 401 | 走了 `/api/mobile/v1/pair` | 局域网要用 `/__lan_pair` |
| 点审批报 403 | 该设备权限档位不够 | 电脑端「移动端」里提升该设备权限 |

---

## 5. 安全清单

- [ ] `dev-token.json` 已删；
- [ ] `/__lan_pair` 没有暴露公网（或加了 IP 白名单）；
- [ ] 宿主机 18787 只监听 `127.0.0.1`（插件默认如此，别改成 `0.0.0.0` 直接裸奔）；
- [ ] 桌面端「设置 → 移动端」里，`pwa-probe` 之类的调试设备已删除；
- [ ] 手机上不再需要的设备凭据已吊销（`/api/mobile/v1/paired-devices/revoke`）。

## git 部署（2026-11-21 起）

线上不再由本地 scp，而是**服务器自己从 GitHub 拉**：

```
/srv/dsh-mobile-src      git clone（服务端，跟踪 origin/main）
/opt/dsh-mobile-deploy.sh  部署脚本：checkout ref -> 暂存 -> rsync 到 /srv/dsh-mobile
/srv/dsh-mobile          运行时目录（精确等于某个提交的 8 个文件 + VERSION）
```

本机用法：

```powershell
./deploy.ps1              # 部署 origin/main（要求本地 HEAD == origin/main）
./deploy.ps1 -Ref v123    # 回滚/发布到指定 tag
./deploy.ps1 -Ref abc1234 # 指定提交
```

线上查版本：

```
ssh root@38.189.61.57 cat /srv/dsh-mobile/VERSION
```

VERSION 里现在有 `ref` 与 `source=github`，能对应到具体提交。
## 服务与密钥清单（2026-11-21）

**代码全部在 git 里；密钥一律不在 git 里。**

| 服务 | 代码位置（仓库） | 部署目标 | 密钥/配置 |
|---|---|---|---|
| 静态 PWA | `index.html` `sw.js` `manifest.webmanifest` 图标 | `/srv/dsh-mobile` | 无 |
| Web Push | `push/server.mjs` `push/package.json` | `/opt/dsh-push` | `/etc/dsh-push.env`（VAPID 公/私钥、`PUSH_SECRET`）**不入库** |
| systemd 单元 | `deploy/systemd/dsh-push.service` | `/etc/systemd/system/` | 无（只引用 env 文件） |
| Caddy | `Caddyfile.us` | `/etc/caddy/Caddyfile` | 证书由 Caddy 自动管理 |
| 宿主插件补丁 | `patches/push-notify.js` | `~/.dsh/profiles/desktop/node_modules/...` | `~/.dsh/webpush.json`（push 地址+secret）**不入库** |

### 部署命令

```powershell
./deploy.ps1            # 只发静态 PWA
./deploy.ps1 -Push      # 静态 PWA + 推送服务（会重启 dsh-push，约 1 秒中断）
./deploy.ps1 -Ref v123  # 回滚到某个 tag
```

### 敏感信息处理原则

1. **仓库里只有变量名**：`push/setup-vps.sh` 会生成 `/etc/dsh-push.env`，写的是 `$PRIV` 这种变量，不是值。
2. **`.env` 永不入库**：`.gitignore` 已含 `*.env`、`push/node_modules/`。
3. **GitHub 凭据**走 Windows 凭据管理器，不落盘到仓库。
4. 新增服务时：密钥放服务器 `/etc/<svc>.env`，代码里只读环境变量。