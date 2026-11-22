# 分支预览环境（/preview/）

线上入口：`https://dsh.easymana.online:8443/preview/`

## 它做什么

- 把任意本地 Git 分支的 `index.html` / `sw.js` / 图标部署到 VPS 的 `/srv/dsh-mobile/preview/<slug>/`
- 每个分支是独立的 PWA：独立 manifest（`start_url`/`scope`/`id` 都在子目录）、独立 SW scope、独立缓存前缀 `dsh-preview-`
- 不改 `/srv/dsh-mobile/index.html` 和 `sw.js`，线上 main 完全不受影响
- 手机 Safari 打开分支 → 分享 → 添加到主屏幕，就是该分支的独立图标

## 部署

在仓库根目录（默认 `D:\Vibe\PWA\pwa`）：

```powershell
# 只更新 /preview/ 选择页
powershell -ExecutionPolicy Bypass -File .\preview\deploy-preview.ps1 -Hub

# 部署某个分支
powershell -ExecutionPolicy Bypass -File .\preview\deploy-preview.ps1 -Branch feature/session-perms

# 自定义 slug（默认 feature/session-perms -> feature-session-perms）
powershell -ExecutionPolicy Bypass -File .\preview\deploy-preview.ps1 -Branch master -Slug main
```

脚本会更新 `/srv/dsh-mobile/preview/branches.json`，选择页自动出现新分支。

## 注意

- **登录态**：预览和主 PWA 同源，正常情况下共享 token；如果 Safari 里没有登录态，去主 PWA「设置 → 恢复链接」，把链接粘贴到预览的「用链接登录」
- **不要开通知提醒**：预览 SW 和主 PWA 同源，开推送可能抢同一个订阅；预览只测界面/会话/权限
- **SW 隔离**：预览 SW 的 activate 只删 `dsh-preview-*` 缓存，不碰主站缓存；主站以后升级 SW 时如果清缓存，预览离线缓存可能会被一起清掉，不影响在线使用
- **Caddy**：`/etc/caddy/Caddyfile` 需要 `/preview/*` 的目录索引处理（仓库 `Caddyfile.us` 已同步）
