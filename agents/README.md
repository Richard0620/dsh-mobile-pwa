# Agents bridge（本地实验版）

把手机/PWA 的"终端"能力接到宿主机上跑着的 **herdr** 会话：一个只监听 loopback 的小 HTTP 服务，外加一个同源的单文件页面。

> 状态：**Phase 2 本地版**。只在宿主机 `127.0.0.1:18888` 可用，手机还连不上（隧道未做）；鉴权是共享 token，不是 PWA 设备凭据。

## 结构

```
agents/
  bridge.mjs   Node 服务：把 herdr CLI 包成 HTTP
  ui.html      单文件 UI（同源，无 CORS）
```

## 跑起来

```powershell
$env:BRIDGE_TOKEN = 'dev-8f3a'          # 必填；空字符串等于不鉴权
node agents/bridge.mjs                   # 默认 127.0.0.1:18888
# 浏览器打开：
# http://127.0.0.1:18888/?token=dev-8f3a
```

依赖：

- `herdr` 已安装并在 PATH（或设置 `HERDR_BIN`）；
- herdr server 已启动（`herdr server`，或者 herdr 的会话在跑）；
- Node ≥ 18。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `BRIDGE_TOKEN` | 空（=不鉴权） | Bearer token |
| `PORT` | `18888` | 监听端口 |
| `HERDR_BIN` | `%LOCALAPPDATA%\Programs\herdr\herdr.exe` | herdr 可执行文件 |
| `UI_FILE` | 同目录 `ui.html` | 页面文件 |

## HTTP 接口

| 方法/路径 | 作用 |
|---|---|
| `GET /` | 内置 UI |
| `GET /health` | 存活检查（不需要 token） |
| `GET /snapshot` | herdr 全量状态（workspace/tab/pane/agent） |
| `GET /panes`、`GET /agents` | 列表 |
| `GET /pane?id=&lines=` | 读某个 pane 的终端文本 |
| `POST /send` | `{pane,text,enter}` → 输入并回车 |
| `POST /keys` | `{pane,keys:[...]}` → Enter/Esc/Tab/↑/↓/Ctrl-C |
| `POST /prompt` | `{target,text}` → 发给 agent |

除 `/` 与 `/health` 外都要求 `Authorization: Bearer <token>`（也接受 `?token=`，方便页面首次打开）。

## 为什么这么设计

- **不碰 SSH、不碰 herdr 私有协议**：只用 herdr 官方 CLI（`pane read/send-text/send-keys`、`agent ...`），升级时行为可预期；
- **同源**：页面由 bridge 自己发，省掉 CORS；
- **loopback**：`127.0.0.1` 绑定，手机上连不到，先做交互验证。

## 现在的外网入口（2026-11-20）

已打通：手机**不需要同一个 WiFi**，走现有的美国 VPS。

```
手机 https://dsh.easymana.online:8443/agents/
   → Caddy（handle_path /agents/*，剥前缀）
      → VPS 127.0.0.1:18888（ssh -R 反向隧道）
         → 宿主机 agent-bridge → herdr → pane
```

- 地址：`https://dsh.easymana.online:8443/agents/`
- 首次打开把 Bearer token 粘进输入框（存在 localStorage，之后不用再输）
- 隧道脚本：`D:\Vibe\CRM\tmp\tunnel-agents.ps1`（死循环 + ServerAlive，掉线 5 秒重连）
- Caddy 配置备份在 VPS：`/etc/caddy/Caddyfile.bak.<时间戳>`

**安全**：这个地址是公网可达的（HTTPS + 128 位 token）。token 不要外发；要换就直接改 `BRIDGE_TOKEN` 重启 bridge，旧 token 立即失效。正式化前不要再往上加"无鉴权"的能力。

## 还没做（Phase 3）

1. 鉴权换成 PWA 设备凭据（现在是共享 token）；
2. agent 视图：`herdr agent start claude`、状态、审批 y/n；
3. 流式（现在是 1.5s 轮询，每次轮询会起一个 herdr 进程）；
4. 进程守护（bridge / 隧道登录自启 + 崩溃重启）；
5. 安全：E2EE、限权、审计。

## 已验证

- 浏览器里列出 pane、读终端、输入 `echo UI-OK` → pane 回显、页面同步刷新；
- 公网入口 `https://dsh.easymana.online:8443/agents/` 打开正常，发 `echo PUBLIC-OK` 回显（browser → Caddy → ssh -R → bridge → herdr）；
- 无 token / 错 token → 401；
- 关掉启动它的 PowerShell 窗口后，后台服务仍在（用 `Start-Process ... -WindowStyle Hidden` 启动时）。
