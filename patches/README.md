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
