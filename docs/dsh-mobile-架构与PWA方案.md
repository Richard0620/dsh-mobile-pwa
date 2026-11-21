# dsh-mobile 插件架构拆解 & 我们做 PWA 前端的可行方案

> 依据：本机实际安装的 `dsh-mobile-plugin@0.5.82`（MIT，repo `WNLUO/dsh-mobile-plugin`），
> 路径 `~/.dsh/profiles/desktop/node_modules/dsh-mobile-plugin`。
> 本文只描述代码事实；标 **[未读]** 的是没读到实现、只从注释/命名推断的部分。

---

## 0. 一句话

它不是一个"网页壳"，而是把 **DSH 宿主能力**翻译成一个**窄口子的移动 API（190 个端点）+ 一套自己造的传输层**，
App 只是这个 API 的客户端。三层彼此解耦，所以"只换前端"在架构上是成立的。

```
┌──────────────────────────────────────────────┐
│ 客户端：AI-HUB（Android / iOS，闭源）          │  ← 我们要替换的就是这一层
└───────────────▲──────────────────────────────┘
                │ HTTP + SSE（Bearer / Cookie + 可选 E2EE 信封）
┌───────────────┴──────────────────────────────┐
│ 移动 API  /api/mobile/v1/*   （190 个 exact 路由）│
│ 守卫：鉴权 → 权限位 → 解密信封 → 业务 → 封响应    │
└───────────────▲──────────────────────────────┘
                │ 直接调 ctx（sessions / approvals / fs …）
┌───────────────┴──────────────────────────────┐
│ 传输层（三选一，都在本机）                       │
│  ① 局域网直连 127.0.0.1:18787（lanSecret 签发） │
│  ② relay v2 WS 隧道（dsh.yfyidc.cn，可换）      │
│  ③ P2P / FRP / tailcat（sidecar 子进程）        │
└──────────────────────────────────────────────┘
```

---

## 1. 装载层：外壳 + 代（这是它能自更新的原因）

`cordis.patch.yml` 只有一行，把包插进 profile 的层栈：

```yaml
- insert:
    - id: dsh-mobile
      name: 'dsh-mobile-plugin'
```

`lib/index.js` 只做三件事：`inject: ['webServer']`、装**稳定外壳**、把"查/装/换代码"暴露成服务。

- **外壳 + 代**：`index.js` 是不变的锚点，实现全部在 `lib/impl.js`（"代"）。换代码时只换 import 目标，
  **不需要重启 DSH**——避免掐掉用户正在跑的对话。
- **蓝绿分发**：外壳把 `server.register` / `registerUpgrade` 包一层，代注册的路由进"分发表"，
  换代时原子切换，**不产生路由空窗、不会撞 duplicate route**。
- **自更新**：npm 自动更新（默认开）+ OTA 完整包（Ed25519 签名，`shell/ota-public-key.js`）。
- 桌面与无头是**两套宿主**：`cordis.mobile-host.yml` 只在 `host.js` 起的无头宿主里加载
  （不开浏览器、把目录选择器钉成 browse）。

> 对我们的意义：**这层我们完全不需要碰，也不用理解透。**

---

## 2. HTTP 层：两道守卫，处理顺序是安全边界

所有业务路由都是 `route(path, handler)` → `registerRoute({kind:'exact', path, handler: guarded(handler)})`。
`route()` 是 identity，真正的差异在两道守卫（`lib/http/routing.js`）：

| 守卫 | 用在 | 判据 |
|---|---|---|
| `localOnly` | 控制面 `/api/relay/*`（改中转、吊销、面板页） | 拒绝 `x-dsh-via` 转发来的、拒绝 `x-dsh-instance`、拒绝 `dsh_pair/dsh_lan` cookie、拒绝跨站（`sec-fetch-site: cross-site` 或 Origin≠Host），且**钉死方法** |
| `createGuarded` | 移动 API `/api/mobile/v1/*` | 只校验 token；按**设备权限位**逐路由判；可选解 E2EE 信封 |

`createGuarded` 的顺序是定死的（改顺序等于开洞）：

```
鉴权(token) → 权限位(fail-closed) → 解密信封 → 业务 handler → 封响应
```

几个值得注意的细节：

- **401 分三种**：`device-revoked` / `device-expired` / `unauthorized`，且都是**明文**——
  客户端要在解不开信封时也能读懂"我被踢了"。
- **权限位 fail-closed**：`permissions.js` 把每条路径分类成权限位；没分类的路径返回
  `permission-unclassified` 而不是放行。
- **被动降级会被发现**：凭据里有 `deviceKey`（说明是按 v2 配的）但请求没带 `X-Dsh-Proto: 2`，
  直接 `e2ee-required` 400 —— 防止"中转删了头，悄悄退回明文"。
- **封响应是劫 `res.end`**（不是 `res.json`），因为宿主一律 `sendJson`；封完不再 gzip
  （头已经发出去了，再压就是"线上 gzip、头说 identity"）。

---

## 3. 身份层：token 全是本地签的（这是"不连他服务器也能用"的根本原因）

`lib/mobile/auth.js` + `lib/relay/core.js`：

| 材料 | 来源 | 说明 |
|---|---|---|
| `instanceId` | 16 字节随机 → 32 位 hex | 也是总控地址目录里的设备标识，不可猜很重要 |
| `pairingCode` | 6 位数字 | 面板二维码旁边那个 |
| `pairingTicket` | 32 字节随机 → base64url(43) | **密钥材料**，手机拿它派生配对密钥，绝不经过中转 |
| `lanSecret` | 32 字节随机 → hex(64) | 签 token 用；就在 `relay.json` 里 |
| `historyKey` | 32 字节随机 | 加密离线历史 blob，只在配对封包里下发 |

凭据有两种：

1. **新：每设备凭据** `<instanceId>.<exp>.<random>`，同时是 Bearer / `dsh_lan` cookie /
   `X-Dsh-Device-Credential`。服务端按整串 sha256 查凭据库，**查到就以记录为准**
   （吊销/过期立即生效），剩余寿命不足一半时**自动滑动续期**。
2. **旧：无状态 HMAC** `<instanceId>.<exp>.<hmac(lanSecret)>`，30 天，只为升级前的老 App 保留。

鉴权顺序 `凭据头 → Bearer → 旧 HMAC` 是刻意的：允许"吊销后回退验 HMAC"等于吊销永不生效。

配对有两个入口，签的是**同一种 HMAC**：面板票据那条，和局域网 `/__lan_pair` 那条。
源码注释原话：「经中转配对拿到的 token 也能用于局域网请求」。

> **结论：`lanSecret` 在你电脑上，配对不需要任何第三方服务器参与。**

---

## 4. 数据面：190 个端点，两条流

`lib/routes/mobile-api.js` 共 554 行，全是 `route(...)` 声明式挂载；handler 在 `lib/mobile/*`（40+ 模块）。

按能力分组（括号内是代表端点）：

- **会话**：`sessions`、`session/new|send|stop|rename|fork|archive|messages|head|search|stats`
- **审批/提问**：`approval/respond`、`approval/rules`、`question/respond`
- **文件**：`file/read|stat|create|delete|rename`、`upload/begin|chunk|finish|abort`、`directory/*`
- **Git**：`git/status|diff|stage|commit|push|branches|checkout`、`git/pr/*`
- **插件**：`plugin/market/install|update|remove|progress`、`plugin/update/*`（自更新也走 API）
- **配置**：`relay/*`（在控制面）、`channels/*`、`llm/models`、`host-settings/*`
- **其它**：`schedule/*`、`subagents/*`、`skill/*`、`workspace/*`、`stats/overview`

### 两条 SSE 流（客户端体验的核心）

| 流 | 用途 | 过滤 |
|---|---|---|
| `GET /session/stream?sessionId=&lastSeq=` | **单个会话的实时正文** | 只转发该会话的 `session/event` 帧 |
| `GET /events/stream` | **设备级**（会话列表/审批红点） | 只放行 `session/summary`、`session/queue`、`session/subscribed`、审批/提问帧、`host/*`，以及 4 种轻量 `session/event`（`turn/start`、`turn/end`、`session/title`、`session/disposed`） |

工程细节（这些都直接影响客户端怎么写）：

- **续传**：`Last-Event-ID: <sessionId>:<seq>` 或 `?lastSeq=<seq>`；断线重连从 seq 回放。
- **心跳**：每 15s 一帧；`session/heartbeat` **不带 seq，绝不能推进 lastSeq**。客户端 35s 收不到就判死重连。
- **背压策略**：草稿增量可丢（`shed`），**审批帧和心跳永不丢**；丢了审批卡就再也补不回来（回放不覆盖这段）。
- **SSE 刷窗口 padding**：故意往流里塞填充字节，防止中间代理/浏览器缓冲导致"字出了但界面不动"。
- **v2 加密下逐帧封装**，AAD 绑「路径 + 请求 ts/nonce + 帧序号」，帧序号从 1 起。客户端收到明文帧就当畸形，
  连 10 帧判死、退回 15 秒轮询。

---

## 5. 传输层：三种连法，一套 sidecar

- **局域网直连**：宿主在 `lanPort`（默认 18787）监听，手机同网直连，用 `lanSecret` 签的 token。
- **relay v2**：宿主主动向外出 WS，手机顺隧道回来；地址是一**组**（`relayUrls`）。
  中转会缓存**会话列表/工作区快照**做读隔离，但 v2 加密会话内容不走近路、仍以密文过。
- **P2P / FRP / tailcat**：`p2p/rendezvous.cjs`、`relay` 的 frpc、`tailcat/`——用于打洞或自建转发。
- **sidecar**：传输跑在独立子进程（`sidecar-lifecycle` / `sidecar-facade-worker`），
  所以换代不掐隧道，Windows 上装包前还要先让隧道助手松开 exe 文件锁。

> **更正（2026-11-20）**：中转服务端**是开源的** ——
> [`WNLUO/dsh-mobile-server`](https://github.com/WNLUO/dsh-mobile-server)，Rust / MIT，
> 有预编译 musl 二进制 + `install-binary.sh`，systemd + 自动更新。默认只听 `127.0.0.1:18788`，
> 前面配 HTTPS/WSS 反代即可。协议见仓库 `server/relay-core/PROTOCOL.md`（隧道 v2）：
> 宿主出站 WSS 连 `/tunnel` 登记 `instanceId`，手机请求按 **`X-Dsh-Instance`** 头分发，
> HTTP / SSE / WebSocket **帧级透传**。
>
> 所以"自建中转"从"不划算"变成**跨网络的首选**：手机不用装 Tailscale，宿主机不用公网 IP。

---

## 6. 我们做 PWA：架构上怎么落

### 6.1 结论

**只换前端是成立的**：PWA 只要说 `/api/mobile/v1/*` 这一层协议（HTTP + SSE），
插件、宿主、账本一个字都不用改。而且插件里**没有任何授权/试用/配额判断**（全文搜
`trial|license|entitle|quota`，命中的全是"测试用"注释）。

### 6.2 部署形态（同源反代，规避 CORS）

```
浏览器 / 主屏幕 App
      │ https
┌─────▼────────────── Caddy（任意一台：韩国云 / 美国云 / 宿主机都可以）
│  /                 → 静态 PWA（index.html + manifest + sw.js）
│  /api/mobile/v1/*  → reverse_proxy 127.0.0.1:18787
└─────┬──────────────
      │ http loopback
   dsh-mobile-plugin（不变）
```

同源之后：CORS 预检彻底消失（这个 API 是给原生写的，没考虑浏览器跨域）、
cookie（`dsh_lan`）自动带上、https 满足 PWA 安装条件。

### 6.3 客户端要实现的（最小闭环）

| # | 能力 | 端点 | 备注 |
|---|---|---|---|
| 1 | 配对 | `POST /pair`（或局域网 `/__lan_pair`） | 6 位码 + device 描述 → 拿凭据 |
| 2 | 会话列表 | `GET /sessions`、`/workspaces` | 首屏 |
| 3 | 会话正文 | `GET /session/messages` + `GET /session/stream` | 流式 |
| 4 | 发消息 / 停止 | `POST /session/send`、`/session/stop` | |
| 5 | 审批 / 提问 | `POST /approval/respond`、`/question/respond` | 手机端的核心价值 |

其余（git / 插件市场 / 日程 / 子代理 / 文件）**先不做**，接口留着慢慢加。

### 6.4 三个必须提前处理的坑

1. **`EventSource` 不能带自定义头**。`Authorization` / `X-Dsh-Device-Credential` 都塞不进去。
   两条出路：**(a) 用 cookie**（`/pair` 会种 `dsh_lan`，同源天然携带，`EventSource` 直接能用）；
   **(b) 用 `fetch` + `ReadableStream` 自己解析 SSE**（能带任意头，但要自己实现重连/续传）。
   建议先 (a)，需要 E2EE 时再切 (b)。**[待验证：`/pair` 是否在响应里种 cookie]**
2. **后台断流**：PWA 一切后台/锁屏就被挂起，SSE 断开，"实时"只在**前台**成立。
   要真推送得自己接 APNs / FCM（或 Web Push，iOS 要求已装到主屏幕且 16.4+）。
3. **v2 加密**：建议**先用明文局域网档**跑通界面与交互，再补 `deviceKey` 派生的逐请求加密。
   不要一上来就啃 `shared/e2ee*.js`。

### 6.5 其它风险

- **版本漂移**：插件 0.5.x 迭代很快，内部 API 可能变。客户端要能容忍字段缺失，别硬崩。
- **别默认用他的中转** `dsh.yfyidc.cn`：那是他家基础设施。走局域网 + Tailscale，或自建反代。
- **推送/列表缓存**：relay 那边的快照缓存是"读隔离"优化；自建中转时可以开
  `MIRROR_CACHE`（默认开），不开就少一层缓冲。

---

## 7. 还没读的部分（明确留白）

- `relay/core.js` 后半（379 行只读了 110 行）：隧道帧格式、注册、迁移。
- `sidecar-lifecycle` / `sidecar-facade-worker`（共 80KB+）：传输子进程协议。
- `shared/e2ee*.js`：v2 密钥派生与信封字段。要接 v2 加密时必须精读。
- `lib/client.js`（143KB）：插件在 **DSH 桌面 Web** 里的那半边（设置面板、移动端页签）。
- `lib/panel/index.html`（1.5MB）：电脑端配置面板（React 打包产物）。

---

## 8. 建议的下一步

1. **抓一份真实往返**：用 6 位配对码 pair 一个 `pwa-probe` 设备，把
   `/sessions`、`/session/messages`、`/session/stream` 的真实 JSON 和 SSE 帧记下来
   （现在只知道端点名，不知道字段）。→ 这是写客户端的前提。
2. 出**最小 API 契约**（约 8 个端点，含字段与流帧类型）。
3. Caddyfile + PWA 骨架（配对页 / 列表 / 详情），真机装到主屏幕验收。
4. 再决定：补推送、补 E2EE、还是套 Capacitor 出 APK。

---

## 9. 三种部署形态（韩国云 / 美国云 / 宿主机都能放，但要注意谁是"源"）

关键前提：**PWA 的静态文件可以放任何地方，但 `/api/mobile/v1` 必须落到跑着 DSH 的那台机器上**。
所以区别只在于"反代在哪一段、隧道怎么走"。

### A. 全在宿主机（最简单）

```
手机 ──https──► 宿主机 Caddy ──┬─ /         静态 PWA
                              └─ /api/...   127.0.0.1:18787
```
- 优点：零隧道、同源、cookie 天然可用、延迟最低。
- 难点：宿主机要有可访问的 https 域名（Tailscale cert / Funnel / 自签）。
- 适合：只给自己用，外出时靠 Tailscale。

### B. 静态放云，反代在云（推荐做长期形态）

```
手机 ──https──► 云 Caddy ──┬─ /          静态 PWA（云上，可 CDN）
                           └─ /api/...   隧道 ──► 宿主机 127.0.0.1:18787
```
- 优点：域名/证书/前端更新都在云上，宿主机换机器不影响手机端；仍**同源**，无 CORS。
- 需要一条宿主机 → 云的常驻隧道（Tailscale、`ssh -R`、FRP、Cloudflare Tunnel 都行）。
- 注意：云上反代**只是通道**，不解密 E2EE、不缓存会话（别把 relay 那套缓存照搬）。

### C. 前后端分开两个域名

不推荐：立刻撞上 CORS（这个 API 是给原生写的），还要处理 `SameSite`/预检/凭证。
真要做，代价是给每条路由加 `Access-Control-Allow-*` 和 `OPTIONS`，不值得。

### SSE 过反代的硬要求

- **必须关缓冲**：Caddy 用 `reverse_proxy ... { flush_interval -1 }`，nginx 用
  `proxy_buffering off; proxy_read_timeout 3600s;`。否则流式字会"憋住"，看起来像卡死。
- **必须放宽读超时**：SSE 是长连接，默认 60s 会被掐；插件靠 15s 心跳保活，但反代也得撑住。
- 插件的 `padding` 和"心跳不可丢"就是为这种代理环境设计的，反代配置对不上就会踩它的坑。
- `/events/stream` 与 `/session/stream` 是**两条独立长连接**，手机端并发上限要留够（iOS 同域 6 条）。
