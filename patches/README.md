# dsh-mobile-plugin 本地补丁

我们在这个第三方插件上加了一个**额外出口**：把自己的提醒同时镜像到自建的 Web Push 服务，
好让 PWA 也能收到系统通知（原来的 APNs 通路只服务原生 App）。

## 改了哪里

`lib/mobile/push-notify.js`，两处：

1. 在 `function sendFrame(` 之前插入 `webPushTarget()` / `mirrorToWebPush(payload)` 两个函数
2. `sendFrame` 开头加一句 `try { mirrorToWebPush(payload); } catch {}`

所有提醒（审批 / 提问 / 完成）都会经过 `sendFrame`，所以这一处覆盖三类事件。

## 配置

读 `~/.dsh/webpush.json`：

```json
{ "url": "https://dsh.easymana.online:8443/push/notify", "secret": "<PUSH_SECRET>" }
```

没有这个文件就完全不生效（保持上游行为）。

## 插件升级后

1. 把本目录的 `push-notify.js` 与新版对比，重新插入上面两处
2. 或者直接 `cp patches/push-notify.js "$DSH_PROFILE_DIR/node_modules/dsh-mobile-plugin/lib/mobile/"`
3. 重启 DSH 生效
