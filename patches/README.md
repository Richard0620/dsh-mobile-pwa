# dsh-mobile-plugin 本地补丁

我们在这个第三方插件上加了一个**额外出口**：把自己的提醒同时镜像到自建的 Web Push 服务，
好让 PWA 也能收到系统通知（原来的 APNs 通路只服务原生 App）。

## 改了哪里

`lib/mobile/push-notify.js`，三处：

1. 在 `function sendFrame(` 之前插入 `webPushTarget()` / `mirrorToWebPush(payload)` 两个函数
2. `sendFrame` 开头镜像审批 / 提问帧（完成 / 失败帧由 `notifyTurnEnded` 单独镜像，避免一帧发两次）
3. 镜像帧带 `badge`：`badgeNumber()` 按与 App 相同的公式算
   「未读会话数 + 待处理会话数」——
   未读取自 `~/.dsh/read-receipts.json` 的 `lastTurn` / `readAt`（与 `/sessions` 同一份事实），
   待处理取 `approvals.js` / `questions.js` 的挂起表；已归档会话（`~/.dsh/storages/workspace.json`
   的 `global.archivedSessionIds`）不计入。读不到就**不带** `badge`，让 SW 保留旧数字，
   绝不发一个 App 打开后会被覆盖掉的假数字。

三类提醒都会镜像：审批 / 提问走 `sendFrame`，完成 / 失败在 `notifyTurnEnded` 里发，两处都带 `badge`。

## 生效条件

补丁装进 `$DSH_PROFILE_DIR/node_modules/dsh-mobile-plugin/lib/mobile/` 后**必须重启 DSH**，
插件模块才会重新加载。改完在 `journalctl -u dsh-push -f` 里看到 `[notify]` 行才算通。

## 配置

读 `~/.dsh/webpush.json`：

```json
{ "url": "https://dsh.easymana.online:8443/push/notify", "secret": "<PUSH_SECRET>" }
```

没有这个文件就完全不生效（保持上游行为）。

## 插件升级后

1. 把本目录的 `push-notify.js` 与新版对比，重新插入上面几处
2. 或者直接 `cp patches/push-notify.js "$DSH_PROFILE_DIR/node_modules/dsh-mobile-plugin/lib/mobile/"`
3. 重启 DSH 生效

## 状态：自动更新已关闭（2026-11-21，用户操作）

用户在 DSH UI 里关闭了 `dsh-mobile-plugin` 的自动更新。此前它一天内升了三次
（0.5.88 → 0.5.91 → 0.5.93），每次都把本目录的补丁冲掉，导致"改了却看不到效果"。

**若补丁再次消失**（`mirrorToWebPush` 数量为 0），按以下顺序查：

1. 插件版本是否变了 → `(Get-Content "$env:DSH_PROFILE_DIR\node_modules\dsh-mobile-plugin\package.json" -Raw | ConvertFrom-Json).version`
2. 变了解释：有人重新开了自动更新，或手动升级了插件 → 按本目录 README 重新贴补丁
3. 没变还消失 → 检查是不是别的会话覆盖过这个文件（`git log` 里搜 push-notify）

重贴后**必须重启 DSH** 才生效（Node 模块加载后不热更新）。
## 第二个补丁：`mirror/pusher.cjs` 的完成推送兜底（2026-11-22）

**症状**：审批推送一直正常，「已完成」推送一条都不发。

**根因**：完成推送唯一的触发点是宿主事件流 `ctx.apiProxy.events.mux()` 里的 `turn/end` 帧。
实测该接口在本机 DSH 版本里一帧都不产出（埋点只有 init，没有任何 frame/event 行），
所以 `notifyTurnEnded` 永远不被调用。

**修法**：不依赖事件流，在 `processBgQueue`（每 500ms 后台 tick）里扫会话清单，
发现某会话 `lastTurn.status` 是 completed/failed 且这一轮没补推过，就调一次 `notifyTurnEnded`。

- 首次扫描只登记不推送（避免重启后把历史会话全推一遍）
- 用 `sessionId:turn:status` 去重，最多保留 800 条
- 代码位置：`sweepTurnEnds()` 定义 + `processBgQueue` 内调用

**升级风险**：同样会被插件升级覆盖。重贴步骤：覆盖 `mirror/pusher.cjs` → `node --check` → 重启 DSH。

**验证**：任意会话跑完一轮后，`journalctl -u dsh-push -n 5` 应出现
`[notify] completed "DSH · 已完成 · <会话名>"`。