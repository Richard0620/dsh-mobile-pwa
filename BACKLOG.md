# PWA 需求表 & 与 AI-HUB 的差距梳理

更新时间：2026-11-20 · 当前版本 v21

---

## 一、已上线（v1 → v21）

| 版本 | 内容 |
|---|---|
| v1–v6 | 配对、会话列表、会话详情、SSE 流式、发消息、审批/提问卡、PWA 安装、Caddy + 自建中转 |
| v7–v10 | 恢复链接（免配对码）、下拉刷新、重新加载、图片查看、附件分片上传 |
| v11–v13 | 键盘适配（visualViewport）、安全区、`kb-open` |
| v14–v16 | 运行状态移入对话流、选图缩略图 + 进度、新建会话、版本号显示 |
| v17–v18 | 回合折叠（点开明细）、审批第三按钮写明类别、输入框换行 |
| v19–v21 | contenteditable 输入框、图片缩略图、审批卡去重 + 过期、运行态以 `running` 为准 |

---

## 二、已知问题／待确认（不是功能，是"现在不对"）

| # | 问题 | 状态 | 备注 |
|---|---|---|---|
| B1 | **审批模式不可修改** | 🟡 待确认 | 需求：确认是 UI 未暴露，还是这一版策略锁死。当前会话的审批是**自动批准**，导致审批卡形同虚设 |
| B2 | 输入框上方 `^ ∨ ✓` 工具栏 | 🔴 无解 | iOS 系统 UI，Web 层无 API；只有原生壳（Capacitor/WKWebView）能关 |
| B3 | 锁屏收不到提醒 | 🔴 硬伤 | PWA 后台断流；要推送得上原生壳 + APNs |
| B4 | 极端长会话性能 | 🟡 未测 | 目前全量渲染，几百条后可能掉帧；需要虚拟列表 |
| B5 | 消息里 `dsh-local-image` 之外的图片形态 | 🟡 未覆盖 | 目前只处理了 `attachment` 块和本地图 id |

---

## 三、与 AI-HUB 的功能差距（按"每天用不用得上"排）

### 直接对照表

| 能力 | AI-HUB | 我们 | 优先级 |
|---|---|---|---|
| 发消息 / 流式 / 附件 | ✅ | ✅ | — |
| 审批 / 提问卡 | ✅ | ✅（但 B1 让它自动过） | — |
| **中断运行（Stop）** | ✅ | ❌ **没有按钮** | **P0** |
| **停止后回到最新（回到底部）** | ✅ | ❌ 滚动后无"回到底部"按钮 | **P0** |
| 图片缩略图 + 点击放大 | ✅ | ✅ | — |
| **代码块高亮** | ✅ | ⚠️ 只有等宽字体 | **P1** |
| **消息操作：复制 / 引用 / 重试 / 分支** | ✅ | ❌ | **P1** |
| **会话搜索** | ✅ | ❌（有 `session/search` 接口） | **P1** |
| **会话重命名 / 置顶 / 归档** | ✅ | ❌（接口都有） | **P1** |
| **工作区分组 + 折叠** | ✅ | ✅ | — |
| 工作区新建 / 改名 / 删除 | ✅ | ❌ | P2 |
| **模型选择 + 推理等级（半屏 sheet）** | ✅ | ⚠️ 只显示名字，不能改 | **P1** |
| 排队插话（queue / steer） | ✅ | ❌（接口有 `session/queue/update`） | P2 |
| 文件浏览 / 上传 | ✅ | ⚠️ 只有上传 | P2 |
| Git（状态 / diff / 提交） | ✅ | ❌ | P2 |
| 插件市场 | ✅ | ❌ | P3 |
| 日程 / 子代理 | ✅ | ❌ | P3 |
| 统计（热力图 / 柱状图） | ✅ | ❌ | P3 |
| 连接详情（局域网/中转/延迟） | ✅ | ⚠️ 只有外部 healthz | P2 |
| 通知设置 | ✅ | ❌ | P3（依赖 B3） |
| 语音输入 | ✅ | ❌ | P3 |
| `/` 指令、`@` 引用 | ✅ | ❌ | P2 |
| 多设备 / 多宿主切换 | ✅ | ⚠️ 单宿主 | P3 |

---

## 四、优先级建议

### P0 — 今天/今晚做（合计约 1.5 小时）

| 项 | 工作量 | 为什么先做 |
|---|---|---|
| **1. 中断运行按钮** | 30 min | 现在只能等它跑完；`POST /session/stop` 早就支持。**这是最影响日常的缺失** |
| **2. "回到底部"悬浮按钮 + 新消息提示** | 30 min | 往上翻看历史时，新消息来了完全不知道 |
| **3. 会话重命名 / 置顶** | 30 min | 长按会话项弹出菜单；接口 `session/rename`、`workspace/pin-session` |

### P1 — 这两天（合计约 3 小时）

| 项 | 工作量 |
|---|---|
| 4. 会话搜索（`session/search`） | 40 min |
| 5. 代码块高亮（轻量、不引 CDN） | 30 min |
| 6. 消息操作：复制 / 引用到输入框 | 40 min |
| 7. 模型选择器（半屏 sheet，`session/models` + `select-model`） | 60 min |

### P2 — 有空再说

工作区增删改、Git、文件浏览、`/` `@`、排队插话、连接详情页。

### P3 — 基本不做

插件市场、日程、子代理、统计页、语音、通知设置。

---

## 五、前置依赖提醒

- **P0-1 依赖确认**：`/session/stop` 实测过一次没？没实测就先打一条验证，避免按钮是假的。
- **B1 审批模式**：不解决的话，审批卡永远"点不到"（自动放行）。这会让 P1 里的"审批 UX 优化"没有意义，建议优先查。
- **B4 长会话**：消息超过 ~300 条要上虚拟列表，否则滚动会卡；这件事不在上面任何优先级里，但要盯着。

---

## 七、夜间推进进度（自动迭代）

| 版本 | 内容 |
|---|---|
| v22 | 中断运行按钮（■）、回到底部 + 未读数、会话长按重命名/置顶 |
| v23 | 本地会话搜索（标题/预览）、模型 + 推理等级选择器、代码块高亮、消息长按复制/引用 |
| v24 | 工作区：新建 / 重命名 / 删除；会话归档；长按分组头出菜单；☰ 里的「连接信息」（中转健康 + 延迟 ms） |
| v25 | 文件浏览页（面包屑 + 目录/文件列表 + 隐藏文件开关 + 文本预览，`file/read` 是纯文本响应） |
| v26 | 输入 `/` 弹指令面板（`commands?sessionId`）；☰ → 关于（版本 / 宿主 / 设备数 / 清除缓存重载） |
| v27 | Git 概览页（分支 / 远端 / 变更分组 / 最近提交）+ 统计面板（`stats/overview` 的 kpi） |
| v28 | 长会话分窗渲染：默认只渲染最近 120 条，顶部「显示更早」按需加载（防几百条 DOM 卡顿） |
| v29 | `@` 文件引用：输入 `@` 列出当前会话目录下的条目，点选插入绝对路径（含空格的自动加引号） |
| v30 | 草稿保存（切走再回来不丢，按会话存 localStorage）；轻提示 toast 取代阻断式 alert |
| v31 | 指令面板加静态兜底列表（接口 400/离线时也能用） |
| v32 | 输入提示加 `keyup` 与 260ms 兜底重刷（防异步竞态导致面板不出现） |
| v33 | `/` 与 `@` 面板的空状态行（"没有匹配的指令/文件"），避免面板消失像坏了 |
| v34 | 凭据失效（401 / `device-revoked`）自动回配对页并显示原因，不再停在"还没有会话" |
| v35 | 自适应轮询：空闲 4s / 运行中 1.5s，页面在后台完全不轮询（省电） |
| v36 | 离线横幅：断网时顶部出现"网络已断开，正在等恢复…"，恢复后自动刷新 |
| v37 | 图片查看器加 ✕ 与提示文案；聚焦输入框自动滚到底部 |
| v38 | **修复吞消息**：发送失败时把正文与附件还回输入框（原来先清空再报错，内容直接丢） |
| v39 | 本地缓存秒开：会话列表与最近 120 条消息存 localStorage，打开先出内容再拉新（离线也能看） |
| v40 | 消息时间分隔（间隔 >10 分钟或跨天时插一条）；长按消息菜单标题显示该条时间；缓存改为内容变化才写 |
| v41 | 统计面板加近 7 天输出 tokens 柱状图（纯 div，不引图表库） |
| v42 | 自检清理：删掉生产环境的调试日志、剩余 alert 统一改 toast、切换会话时重置模型列表缓存 |
| v43 | 「已归档」tab（`/sessions?archived=1`），长按可打开或取消归档 |
| v44 | **审批卡去重与字段摊平**：同一审批会推三种帧（`approval/requested` ×2 文案不同 + `approval/asked` 字段在 data 里），现在按同一 id 归并，`approval/asked` 不再渲染成空白卡 |
| v45 | 回到底部按钮改到输入框**外部右上角**（按 `--dock-h` 动态定位）；中断按钮与发送键放进 `.sendgroup` 对齐；会话行加常显「⋯」入口；**置顶真正生效**（列表按 `pinned` 优先排序 + 📌 标记 + 取消置顶）；宽屏（≥900px）改为**左侧会话栏 + 右侧聊天**两栏 |
| v46 | 宽屏下刷新只重建左侧栏，不动右侧聊天（避免打断输入/跳滚动）；跨断点自动重排 |
| v47 | **手机端左侧滑出抽屉**：会话页左上 ☰ 打开抽屉（会话列表 + 搜索 + 已归档 tab + 新建），底部快捷入口（设置/统计/文件/重载）；选中会话自动收起；抽屉开着时列表随搜索实时更新 |
| v48 | App 图标换成 **DeepSeek 鲸鱼 logo**（`icon-192/512`、`icon-maskable-512`、`apple-touch-icon` 全部重做，白底 10% 内边距）；配对页新增「**或粘贴恢复链接**」输入框（解决 iOS 主屏 Web App 与 Safari 标签页存储隔离导致的重装必配对问题） |
| v49 | 抽屉定位修正（不再复用 `.mask` 的 flex-end/center，改为独立全屏遮罩）；去掉「已归档」tab（该部署忽略 `archived=1`，会显示全部会话）；标题下方新增**会话用量条**（`/session/stats` → `decodeTokens/decodeMs` 算 tok/s、平均首字、轮次/步数）；**连接状态点移到标题左侧**；统计面板加「计费 tokens」与费用状态行 |
| v57 | **图标角标提醒**：`navigator.setAppBadge(n)`（iOS 16.4+ 主屏 Web App / Chrome 安装的 PWA）+ 标题 `(n) DSH` + ☰ 小红点 + 会话行未读点；未读判定用宿主 `lastTurn.endedAt > readAt`；打开会话自动 `POST /session/read` 清零；其他会话挂起的审批通过 `events/stream` 计入角标（3 秒节流） |
| v50 | 用量条加**上下文占比**（`contextPressure.pressureTokens / contextWindow`，≥65% 变黄、≥85% 变红），点一下看 `contextTimeline.current` 的构成明细；**渲染改增量**（只替换变化的那几条，不再整列表重建 → 修掉读回复时的抖动与图片重取）；**左缘右滑打开抽屉**、抽屉内左滑关闭 |
| v51 | 每条消息下方加 **⧉ 复制 / ⑂ 分支**（`POST /session/fork {sessionId, atSeq}`，用消息的 `seq`）；**恢复「已归档」tab**，用差集实现（`archived=1` 返回全量 − 默认列表只含未归档 = 归档集合），行尾 ↩ 可取消归档 |
| v52 | **文件面板改右侧滑出**（对齐 AI-HUB）：本层筛选、面包屑、`N 个文件夹 · M 个文件`、文件夹/文件分区、⟳刷新；⋯ 菜单含**上传到此目录**（`/file/create`，仅 UTF-8 文本）、**新建文件夹**、显示隐藏；**全屏文件查看器**（行号 + 语法着色 + 折行/查找/复制全文）；`@` 引用支持 `@子目录/` 逐层往下选 |
| v53 | 修 `ReferenceError: loadSessionStats`（在 `openSession` 作用域里直接调了 `renderSession` 内的函数）；用量条居中、去掉「运行中」；标题行图标统一 17px/行高 1；复制/分支改成胶囊按钮；**附件改为发送时才上传**（修 `uploadId` 过期导致发送失败）；待发缩略图可点看大图；右侧文件面板与左侧抽屉统一尺寸/阴影/行样式，并加底部「上传 / 新建文件夹 / 隐藏文件」栏 |
| v54 | 聊天流里的图片改成**64×64 缩略图 + 横向排列**（与待发附件同尺寸），多条图片自动换行成网格，点击仍可看大图 |
| v55 | 修 `ReferenceError: Cannot access 'fileInput' before initialization`（新的 change 监听写在了 `const fileInput` 之前，TDZ） |
| v56 | 渲染兜底：`render()` 整体 try/catch，崩溃时显示「页面出错」+ 错误详情 + 重新加载/回到列表，不再白屏 |
| v57 | 首屏白屏是**加载慢**（文件涨到 141KB + SW 重装），不是崩溃 |
| v58 | `<body>` 内置首屏占位「DSH · 正在连接…」（render 时被替换），白屏变成可见的加载态；`dev-token.json` 仅在本机开发时请求（线上少一个 404 往返） |
| v59 | 修**右侧文件面板样式全丢**：CSS 里混进一行 `//` 注释（CSS 不支持），导致紧随其后的 `.rpanel` 整条规则被丢弃。全文件已扫过，CSS 内再无 `//` 注释 |
| v60 | **排队消息可见**：`session/queue` 帧（`placement:'queued'`）+ `/session/stats` 的 `projections.inbox['next-turn']` 双路同步，渲染成虚线卡片，支持 **编辑 / 立刻发送 / 删除**。实测动作语义：`{kind:'edit', content:[…]}`、`{kind:'remove'}`、`{kind:'steer'}`（插话=立刻发送），其余 kind 都会 400 |
| v61 | 手势补齐：**右缘左滑打开文件面板**、面板内右滑关闭；左缘右滑开会话抽屉（不冲突，抽屉打开时不再触发） |
| v62 | 键盘弹起后若原本在看最新消息，**把列表重新贴到底部**（原来只是容器变矮，最新回复被键盘挡住）；`.mask` 层级 50 → **1200**，修「抽屉里点 ⋯ 弹窗被抽屉盖住点不到」 |
| v63 | **队列编辑改成"先撤回、再编辑"**：原地 `prompt` 编辑有竞态（宿主不等你，跑完就把队列取走发出），现在先原子 `remove` 再放回输入框；remove 失败说明已发出，直接提示，不再静默丢改动 |
| v64 | 去掉文件面板头部的 `⋯`（上传/新建/隐藏已全在底部操作栏，功能重复）；`.mask` 层级 1200 → **2000**，压过抽屉/面板/查看器，弹窗不再被任何面板遮挡 |

### 层级约定（改样式时别破坏）
| z-index | 谁 |
|---|---|
| 999 | 左侧抽屉、toast |
| 1000 | 右侧文件面板 |
| 1100 | 全屏文件查看器 |
| **2000** | 底部弹窗 `.mask`（必须在所有面板之上） |

### 最终交付自检（2026-11-20 夜，对线上实际产物）

| 检查 | 结果 |
|---|---|
| 线上 `index.html` | 107,145 bytes，`APP_VERSION = 'v44'` |
| 线上文件中 `<script type="module">` 抽取后 `node --check` | **OK**（不是本地副本，是 scp 回来的服务器文件） |
| `sw.js` | `CACHE = 'dsh-mobile-v45'` |
| relay 本地 healthz | 200 |
| Caddy 带 SNI 访问 `/healthz` | 200 `ok` |
| TLS 证书 | 有效期至 **2027-02-18** |
| 手机实测连通 | Caddy 日志显示 iPhone（221.237.163.215）17:37 仍在 `session/stream`，`lastSeq=5411` |

> 注意：直接 `curl https://127.0.0.1:8443/healthz` 会返回 000，因为站点按域名（SNI）绑定，必须带 `--resolve dsh.easymana.online:8443:127.0.0.1`。这不是故障。

### 桌面图标 / 快捷方式（v45 附带产物）

DSH 自带 logo 已被提取并生成图标资源：

| 文件 | 用途 |
|---|---|
| `pwa/icon-src.png` | 源图（复制自 `D:\Deepseek\resources\icon.png`，1024×1024） |
| `pwa/icon-dsh.ico` | Windows 多尺寸图标（16/24/32/48/64/128/256） |
| `pwa/icon-dsh-180.png` `-192` `-512` | 备用 PNG |
| `pwa/DSH Mobile.lnk` + 桌面同名快捷方式 | Chrome `--app=https://dsh.easymana.online:8443/ --window-size=430,932`，图标用 `icon-dsh.ico` |

> **没有动 manifest 里的 `icon-192/512`**：iOS 更换主屏图标需要删掉重装，而删除会丢 localStorage 凭据（要重新配对）。要不要换成 DSH logo 由你决定。

### 待验证（桌面环境无法确认，需手机上验）
- 输入 `/` 与 `@` 时面板是否弹出（v32 加了兜底、v33 加了空状态行）
- ~~审批卡是否真的停住等手机作答~~ → **已用 SSE 直接取证：帧确实推到了 `/session/stream`**

### 审批链路取证结果（2026-11-20 夜，无需人工参与）
挂了一个 SSE 观察者（探针设备凭据）盯 `session/stream`，然后触发一条需要 `danger-full-access` 的命令，抓到：

```
frame session/turn-facts … assistant/chunk … assistant/message
HIT approval/requested  {"approvalId":"9ff752d7-…","toolName":"pwsh","reason":"escalate sandbox to danger-full-access: …"}
HIT approval/requested  {"approvalId":"9ff752d7-…","reason":"允许本次操作使用 danger-full-access 权限：…"}
HIT approval/asked      {"data":{"id":"9ff752d7-…","toolName":"pwsh","reason":"escalate sandbox …"}}
```

结论：
1. **桥是通的**，审批帧确实下发到手机侧那条流；
2. 同一条审批会推 **3 帧、2 种形状**（`approval/requested` 两次、文案不同；`approval/asked` 把字段包在 `data` 里）——这正是之前"叠三张卡、第三张空白"的原因，v44 已修；
3. 之前"没等我就放行"是 **桌面端 answerer 先答**，不是策略锁死。

### 排查记录：为什么本地浏览器里 `/` 面板不出现
桌面那个标签页的设备凭据早前被吊销了 → `/commands?sessionId=` 一直 401 → v26 的 `ensureCommands` 把 `[]` 缓存住 → 面板永远空白。
**不是面板逻辑的问题**，是凭据失效被静默吞掉。v31 的静态兜底 + v34 的 401 回配对页分别补上了这两层。

### 验收单
见 `pwa/VERIFY-20261120.md`（明早照着点一遍即可）。

### 交接文档
见 `pwa/HANDOVER-20261120.md`：架构图、部署流程、**实测出来的全部 API 契约**、关键决策与原因、踩坑清单、排障手册、后续优先级。

### 本轮实测发现的接口事实

| 接口 | 实测结果 |
|---|---|
| `GET /session/models?sessionId=` | `{current:{provider,model,reasoningEffort}, groups:[{id,name,models:[{id,name,reasoning:{efforts:[…]}}]}]}` —— 可按"模型 → 推理等级"两级选择 |
| `POST /session/select-model` | `{sessionId, provider, model, reasoningEffort?}` |
| `GET /session/search?query=` | ❌ **该部署关闭了检索**：`session search is disabled … openAt "never"`。所以改成**本地过滤**（标题 + 最近一条） |
| `GET /commands` | 需要 `?sessionId=` |

### 待办（继续）
- [x] 工作区：新建 / 重命名 / 删除
- [x] 会话归档（`workspace/archive-session`）
- [x] 连接信息（中转健康 + 延迟）
- [x] 文件浏览（`directory/listing`、`file/read`）
- [x] 指令面板（`/`，`GET /commands?sessionId=`）
- [x] 设置/关于（版本 / 宿主 / 设备数 / 清除缓存）
- [x] Git 概览（`git/overview?workspaceId` → `{remote, githubRepo, languages[]}`；`git/status?workspaceId` → `{staged,unstaged,untracked,conflicted}`；`git/log?workspaceId` → `{commits[]}`）
- [x] 统计页（`stats/overview` → `{overview:{kpi:{sessions,turns,steps,outputTokens,cacheReadTokens,activeMs,llmMs,toolMs},days[]}}`）
- [x] 长会话性能（分窗 120 条 + 显示更早）
- [x] `@` 文件引用（复用 `/directory/listing`，按会话 cwd 列出）
- [ ] 审批链路实测（需要手机停在会话页；已确认 `approval/rules` 为空，之前自动通过是桌面 answerer 抢答）

### 部署自检（v29）
- `/srv/dsh-mobile/index.html` → `APP_VERSION = 'v29'`
- `sw.js` → `CACHE = 'dsh-mobile-v30'`
- 公网 `https://dsh.easymana.online:8443/healthz` → `200 ok`

## 八、技术债

| 债 | 影响 | 何时还 |
|---|---|---|
| 单文件 `index.html`（64KB） | 改一处要整文件替换，多人协作会冲突 | 超过 100KB 或加第二人时拆 |
| 无构建、无测试 | 每次靠人肉验证，回归风险高 | 加第二条页面后 |
| Service Worker 版本号手工 bump | 忘 bump 就等于没更新 | 可以改成构建时生成本文哈希 |
| 轮询 1.5s 兜底 | 一直有请求，耗电 | SSE 稳定后可退到 5s |
