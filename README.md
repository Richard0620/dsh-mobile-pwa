# DSH Mobile PWA

把笔记本上的 **DeepSeek Harness（DSH）** 搬进手机浏览器的单文件 PWA：手机上能看会话列表、读流式回复、审批工具调用、接收推送提醒。

线上地址：`https://dsh.easymana.online`

## 关键约束（架构成立的前提）

手机与笔记本上的 DSH 插件**不能直连**——插件只监听 `127.0.0.1`，API 也没有 CORS。所有请求必须经由**同源反代**（Caddy）转发。任何"让手机直接打插件端口"的方案都不成立。

## 目录结构

```
index.html           单文件应用（约 3000 行，HTML+CSS+JS 全在里面）
sw.js                Service Worker，CACHE 名 = dsh-mobile-v(APP_VERSION+1)
manifest.webmanifest PWA 清单
dev-proxy.mjs        本地开发代理（同源模拟线上，默认 8080）
deploy.ps1           主会话部署脚本（scp index.html / sw.js 到 VPS + 写 VERSION 版本戳）
deploy-us.sh         VPS 侧一次性初始化
Caddyfile            国内/通用反代配置
Caddyfile.us         美西 VPS 反代配置
push/                Web Push 服务（18789，VAPID 私钥走环境变量）
agents/              herdr 桥接实验（18888，仅 loopback）
docs/                设计文档：契约、架构方案、修复记录
AGENT-RULES.md       多会话（多 worktree）协作规则 —— 动手前必读
DEPLOY.md            部署细节
HANDOVER-*.md        交接说明
BACKLOG.md           待办与已知问题
VERIFY-*.md          验证记录
```

## 分线开发（重要）

`index.html` 是单文件，两个会话同时改会互相覆盖。隔离靠 **worktree**，不是靠分支切换：

| 目录 | 分支 | 用途 |
|---|---|---|
| `pwa` | `feature/agents-terminal` | 主会话（最终合并与部署） |
| `pwa-b` | `feature/parallel` | 并行会话 |
| `pwa-c` | `feature/lan` | 局域网/证书方向 |

三个目录共享同一份 `.git` 对象库。**新克隆后需要手动重建 worktree**：

```powershell
git clone <repo> pwa
cd pwa
git worktree add ..\pwa-b feature/parallel
git worktree add ..\pwa-c feature/lan
```

## 版本号规则

`APP_VERSION`（index.html）与 `sw.js` 的 `CACHE` 名是两条线共用的唯一标识，冲突高发区：

- 主会话走奇数尾号段，并行会话走偶数尾号段；
- 合并时以较大者为准，并把 `sw.js` 的 CACHE 名同步改成 `dsh-mobile-v(APP_VERSION+1)`；
- 部署后由主会话写 `/srv/dsh-mobile/VERSION` 版本戳，确认线上状态：`ssh root@<vps> "cat /srv/dsh-mobile/VERSION"`。

## 提交约定

```
feat(push): 通知入口改为固定菜单项（v68）
fix: 审批/提问卡增量渲染（v68）
chore: 合并后统一版本到 v69（sw v70）
docs: 交接文档路径同步
```

一个功能一个提交，提交信息带版本戳。只有主会话部署线上；其他会话用 `node dev-proxy.mjs 8080` 本地验证。

## 本地开发

```powershell
node dev-proxy.mjs 8080     # 打开 http://127.0.0.1:8080
node push/server.mjs        # 推送服务（需 VAPID_PUBLIC / VAPID_PRIVATE）
```

详细步骤见 [DEPLOY.md](DEPLOY.md)，协作规则见 [AGENT-RULES.md](AGENT-RULES.md)。
