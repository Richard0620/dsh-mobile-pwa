# DSH Mobile PWA —— 剩余优化清单

> 写给接手的会话：这是一份**待办清单**，不是设计文档。
> 每条都标了「问题 / 建议 / 涉及位置 / 怎么算做完」。
> 当前线上版本以 `ssh root@38.189.61.57 cat /srv/dsh-mobile/VERSION` 为准。

生成时间：2026-11-20 晚 · 对应代码 `D:\Vibe\PWA\pwa`（master）

---

## 0. 先读这几条约定（避免又把文件搞乱）

| 事项 | 规则 |
|---|---|
| 仓库 | `D:\Vibe\PWA\pwa` = `master`（主会话，负责合并与部署）<br>`D:\Vibe\PWA\pwa-b` = `feature/parallel`（另一个会话） |
| 冲突面 | 单文件应用，冲突只会出现在 `index.html`；改完必须 `git commit` |
| 版本号 | `index.html` 的 `APP_VERSION`、`sw.js` 的 `CACHE` 名**必须同时 +1**，否则手机看到的是旧缓存 |
| 部署 | 只有主会话部署；`deploy.ps1` 会写 `/srv/dsh-mobile/VERSION` 版本戳 |
| 语法检查 | 每次改完必须 `node --check` 抽取出的 `<script type="module">` 内容 |

---

## 1. P0 —— 影响日常使用，建议优先

### 1.1 推送角标与客户端角标"打架"

**问题**：推送 payload 里的 `badge` 是发送方拍的数字；App 一打开，`syncBadge()` 会用真实未读数（`lastTurn.endedAt > readAt`）覆盖它。两边数字不一致时用户会看到"跳变"。

**建议**：让推送 payload 的 `badge` 也由**宿主**按同一公式算：
`未读会话数 + 待处理审批数`。宿主要在发推送前查一次 sessions（或者推送服务自己查）。

**涉及**：`push/server.mjs`（发送前算）、`~/.dsh/.../push-notify.js` 的 `mirrorToWebPush`
**验收**：手机图标数字在"关着 App 收到推送"和"打开 App"前后不再跳变。

### 1.2 未读蓝点依赖宿主 `readAt`，有延迟风险

**问题**：v71 已做乐观更新（`markRead` 成功后本地把 `lastTurn.readAt` 置为当前时间）+ `refreshAll(true)` 绕过 30 秒缓存。但如果宿主对 `readAt` 的写入本身有延迟/失败，蓝点还是会回来。

**建议**：再加一层**纯本地水位**：`localStorage` 里记 `{sessionId: lastOpenAt}`，未读判定改成
`lastTurn.endedAt > max(host.readAt, localLastOpenAt)`。
这样即使宿主不更新，本地也能消点。

**涉及**：`isUnread()`、`openSession()`
**验收**：点进会话再返回，蓝点立刻消失，且重新打开 App 后仍然没有。

### 1.3 桌面两栏布局是否保留

**问题**：`≥900px` 时会切成"左侧会话栏 + 右侧聊天"。用户明确说过**主要用手机**，这个桌面形态可能没人用。

**建议**：二选一
- 保留但把断点提到 `≥1200px`（平板横屏也不触发）
- 直接删掉 `renderWide()` / `.app.wide` 相关代码，减少维护面

**涉及**：`render()`、`renderWide()`、CSS `.app.wide`
**验收**：手机/平板横屏都是单栏，桌面宽屏行为符合选择。

---

## 2. P1 —— 体验打磨

### 2.1 消息时间分隔的时间来源
现在用 `message.time`，间隔 >10 分钟或跨天插一条。可考虑改成"按天分隔 + 悬停显示精确时间"，手机上现在略密。

### 2.2 图片查看器没有缩放
现在 `object-fit: contain` + 点击关闭，长截图要看清细节只能截屏放大。
**建议**：加双指缩放（CSS `touch-action: pinch-zoom` + `transform: scale` 至少要做到不被浏览器手势抢走）。

### 2.3 代码块高亮过于简陋
`hl()` 是单趟正则，只分字符串/注释/数字/关键字。常见问题：JSX、YAML、多行字符串会串色。
**建议**：要么接入一个 <10KB 的轻量高亮（Prism 的核心子集），要么限制只对 `js/ts/sh/json/py` 高亮，其他语言保持纯文本。

### 2.4 长会话渲染
现在是分窗 120 条 + 「显示更早」。几百条滚动仍可能掉帧。
**建议**：真虚拟列表（只渲染视口附近），或至少把已渲染节点做成 `content-visibility: auto`。

### 2.5 附件：视频只能变成路径文本
`session/send` 只接受 `text` / `image` 块，视频走"上传 + 把路径拼进正文"。
**建议**：至少在气泡里识别自己是视频路径，渲染成一个可点播放的缩略（需要能拿到文件流），否则维持现状但**在 UI 上说明**这是文件不是图片。

### 2.6 搜索只有本地
服务端 `session/search` 在该部署被关（`openAt "never"`），现在只过滤标题 + 最近一条。
**建议**：把本地搜索扩展到**已缓存的消息正文**（`dsh.cache.msgs` 里已有最近 120 条/会话），命中后显示片段。

### 2.7 已归档视图的实现需要复核
另一个会话用「`archived=1` 全量 - 默认列表」做差集（宿主忽略 `archived` 参数）。
**建议**：验证边界——空归档时是否显示"没有归档"、差集运算是否会因分页/缓存漏项。参考 `state.tab === 'archived'` 分支。

---

## 3. P2 —— 功能补齐（AI-HUB 有，我们没有）

| 功能 | 说明 | 依赖 |
|---|---|---|
| 多设备/多宿主切换 | 现在固定一个 instanceId | 需要凭据切换 UI + localStorage 多份 |
| 语音输入 | AI-HUB 有麦克风 | 浏览器 `MediaRecorder` + 宿主侧无 STT 接口，可能做不了 |
| `/` 指令的真实执行 | 面板已有，选中只是插入文本 | 需确认 `/compact` 等是否走 `session/send` 的文本 |
| `@` 引用的目录跳转 | 现在只列当前 cwd 一层 | 加"进入子目录"交互 |
| 统计：按模型/按天明细 | 现在只有 7 天总量 + 柱状图 | `stats/overview` 已给 `models[]`、`days[]` |
| 主题手动切换 | 只跟随系统 | 加 `data-theme` + 开关 |
| 国际化 | 文案中英混杂、部分中文硬编码在 JS 里 | 抽 `i18n` 表 |

---

## 4. 明确"不要做"或"做不了"的

| 项 | 原因 |
|---|---|
| 去掉键盘上方 `^ ∨ ✓` 工具栏 | iOS 系统 UI，Web 层无 API，只有原生壳（WKWebView `inputAccessoryView=nil`）能关 |
| 锁屏推送（不装 Web Push） | PWA 被挂起/杀掉后没有进程，必须靠 Web Push |
| 服务端内容检索 | 部署侧 `session-query` 的 `openAt` 是 `never`，接口直接 400 |
| 改 `dsh-mobile-plugin` 上游 | 已有本地补丁（`patches/`），升级后要重新套用，不要 fork 整个包 |

---

## 5. 推送系统现状（重要背景）

```
DSH 插件 sendFrame() ──► ~/.dsh/webpush.json ──► https://dsh.easymana.online:8443/push/notify
                                                     │
                                    38.189.61.57 上 dsh-push.service (VAPID)
                                                     ▼
                                             Apple 推送 → iPhone
```

- **已通**：VPS 服务、VAPID、订阅（`subs=1`）、SW 的 `push`/`notificationclick`、角标
- **未生效**：插件里的镜像出口**需要 DSH 重启才加载**（当前进程从早上 8:30 一直没重启）
- **完成类推送**只在"你不在看"时发（60 秒心跳窗口）；审批/提问无条件发
- 补丁位置：`patches/push-notify.js` + `patches/README.md`

**接手后第一件事**：让用户重启 DSH，然后看 `journalctl -u dsh-push -f` 里有没有 `[notify]` 行。

---

## 6. 验收方式（每次改动）

```powershell
cd D:\Vibe\PWA\pwa
# 1. 语法
$m = [regex]::Match((Get-Content index.html -Raw -Encoding UTF8), '(?s)<script type="module">(.*?)</script>')
$m.Groups[1].Value | Set-Content $env:TEMP\app.mjs -Encoding UTF8
node --check $env:TEMP\app.mjs
# 2. 版本号 +1（APP_VERSION 与 sw.js CACHE）
# 3. 部署（只有主会话）
./deploy.ps1
# 4. 手机上：杀进程重开 → ☰ 看版本号
```
