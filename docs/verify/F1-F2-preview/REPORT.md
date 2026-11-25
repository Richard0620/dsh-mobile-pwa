# F1 / F2 Preview 独立验收报告

- 被测：`https://dsh.easymana.online:8443/preview/f1f2/`
- 分支 / commit：`feature/f1-f2-steps-voice` / `aca7c4b`（F1 = `3082336`）
- 本地代码：`D:\Vibe\PWA\pwa-j\index.html`（单文件 PWA，v249）
- 验收时间：2026-11-25（America/Los_Angeles）
- 结论：**验收清单 11 项 PASS、1 项 FAIL（仅过程面板上沿圆角）；FAIL 1；环境边界 UNVERIFIED 5 项**
- 机器断言：49 条（B 38 / C 2 / D 3 / E 2 / F 2 / G 2）全部 PASS；另有首次打开的人工判定 1 项 PASS。圆角差异是静态 CSS 对照发现，不在自动断言里。

> 重要边界：本轮**没有**使用真 iPhone、Safari 或 WebKit。iPhone 环境是 **Chrome for Testing 157 + CDP 模拟**（390×844 / 430×932、DPR 3、Touch、iPhone Safari UA、`setSafeAreaInsetsOverride` 47/34）。页面本身、静态资源、Service Worker、manifest 是**真实网络 + 真实部署产物**；宿主 API/SSE 是按给定契约打桩。凡涉及 WebKit 渲染、Safari 权限、真实麦克风/扬声器、真实宿主帧的部分，单独标为 UNVERIFIED。

---

## 0. 总表

| # | 场景 | 结论 | 证据文件 | 备注 |
|---|---|---|---|---|
| 1 | 真实首次打开：配对页、console、404、首屏 | **PASS** | `01-首次打开-390x844-配对页.png`、`02-首次打开-430x932-配对页.png` | 0 error / 0 404 / 0 failed；TTFB 611ms、FCP 1012ms、配对页 1388ms；仅 1 条弃用 warning |
| 2 | 390/430 进度条一行、不溢出、安全区；键盘隐藏 | **PASS** | `03-进度条-有phase-390x844-纸面.png`、`04-键盘弹起-进度隐藏.png`、`20-430x932-进度条.png`、`24-390x844-长摘要-不换行.png` | 390：row 362×39.8，scrollH=39；430：402×39.8；长摘要省略不换行；`kb-open` 时进度条 display:none |
| 3 | 有 phase「第 2/7 步」+ 比例；无 phase「已跑 N 步」+ 不定长 | **PASS** | `03`、`10`、`30-turn变化-步骤清空.png` | fill = 104.969 / 362 = 29.0%（2/7）；降级态 `.pbar.indet`，无假总数；turn 40→41 时清空旧步骤 |
| 4 | 点进度条 → 过程面板；行数/符号；收起/停止 | **PASS** | `06-过程面板-运行中.png`、`11-面板-无phase-降级.png` | 7 行：✓ / ● / ○（透明字+描边圆）；「收起」「停止这一轮」均可点，confirm 被捕获 |
| 5 | `turn/end` → 已完成 · N 步 → 约 3 秒淡出；不串台 | **PASS** | `07-turn-end-已完成.png`、`08-已完成-淡出中.png`、`09-断线-重连中.png` | 2665ms 加 `donefade`，3316ms 清空；S1 帧在 S2 被忽略；断线/重连正常 |
| 6 | 键盘类 + 安全区 47/34 后布局 | **PASS** | `04`、`05-安全区47-34-布局.png` | 47/34 实际生效；metaBottom 806 < 810（844−34）；CSS 变量覆盖后不变 |
| 7 | 设置 → 语音：默认关、写 `localStorage`、重开保持 | **PASS** | `16-设置-语音-默认关.png`、`17-设置-语音-重载后保持.png`、`27-设置-语音-杀进程重开.png`、`28-设置-语音-两个开关已开.png` | `dsh.speech.hold` / `dsh.speech.auto` 默认 null；置 1；reload 与杀浏览器进程重开均保持 |
| 8 | 麦克风渲染的三种条件 | **PASS** | `19-无语音识别-无麦克风.png`、`12-按住说话-录音中.png`、`26-刚打开会话-无帧.png` | hold 关→无 `.mic`；hold 开+有构造器→grid；`SpeechRecognition` 不存在→完全不渲染 |
| 9 | 按住说话：松手追加并发送；上滑取消 | **PASS** | `12`、`13-按住说话-松手已发送.png`、`14-上滑取消-输入还原.png` | 用 `Input.dispatchTouchEvent` 真触摸事件；sent=1 且文本一致；上滑提示「松开取消」，sent 不变 |
| 10 | 朗读按钮；无 `speechSynthesis` toast；自动朗读 | **PASS** | `15-朗读-停止状态.png`、`18-无语音能力-朗读toast.png`、`29-自动朗读-回合结束.png` | 按钮切「■ 停止朗读」；无合成时 toast 且无异常；turn/end 自动朗读生效 |
| 11 | 纸面浅色 / 碳黑深色对照设计稿 | **FAIL（仅圆角）** | `21-纸面浅色-会话.png`、`22-碳黑深色-会话.png`、`23-碳黑-过程面板.png`、`25-碳黑深色-390x844-会话.png` | 色板 token、字号、按钮 14px 圆角一致；**面板上沿圆角 26px vs 设计 22px**（`index.html:777`），见 §4-F1 |
| 12 | 打开会话→进度条出现；无每帧抖动 | **PASS** | `24-390x844-长摘要-不换行.png`、`26-刚打开会话-无帧.png` | 注入帧→进度条 DOM 2ms；24 个增量帧期间 26 次采样矩形完全一致（1 种），Layout 26 次 / 7ms |
| E1 | 真机 iPhone / Safari / WebKit 渲染与手势 | **UNVERIFIED** | — | 本轮只到 Chrome 模拟；未在 WebKit 真机跑 |
| E2 | 真机麦克风权限、系统听写、识别准确率 | **UNVERIFIED** | — | `SpeechRecognition` 是 mock；没有使用用户手机凭据或真麦克风 |
| E3 | 真机扬声器出声、中文语音包、静音开关 | **UNVERIFIED** | — | 只验证状态切换与分句；headless 无音频输出 |
| E4 | 真实宿主 SSE 帧形状/频率/断网重连 | **UNVERIFIED** | — | API/SSE 为按契约打桩；未连真实宿主 |
| E5 | 真机键盘动画、锁屏/切后台、PWA standalone | **UNVERIFIED** | — | 键盘用 viewport 收缩模拟；`visibilitychange` 未实测 |

**计数：PASS 11 / FAIL 1 / UNVERIFIED 5（环境边界）。**

---

## 1. 被测对象与产物一致性

预览 HTML 与本地 `index.html` 不是逐字节相同：预览服务在文件里加了 4 处测试环境标记。把它们剥掉后，两者**完全相等**：

| 项 | 值 |
|---|---|
| 本地 `index.html` SHA-256 | `549dcdbf184e84c87b35a359370d316d97cf7177bc404e455f2425584f0a7229` |
| 部署文件 SHA-256（含预览标记） | `7d3e8b079c614071e298e3b290e320c5313ff3310f57abef409f6350e8fd3f42` |
| 剥离预览标记后比较 | `equal: true`，长度 317298 == 317298 |

被剥离的 4 处预览标记：

1. 头部 `<script>window.__DSH_PREVIEW__={branch:'feature/f1-f2-steps-voice',slug:'f1f2'};</script>`
2. `<title>AI-HUB · 预览 · feature/f1-f2-steps-voice</title>`
3. `apple-mobile-web-app-title="DSH f1-f2-st"`
4. 末尾悬浮的 `<a href="../">← 测试环境</a>`

第 4 项会压住输入框左上角（见首次打开截图），它**不是产品 UI**。会话内（B 组）截图时用预加载样式隐藏了它；首次打开截图保留原样。

工作区只新增 `docs/verify/`（本报告与截图）；`git status --porcelain` 只有 `?? docs/verify/`，`index.html` / `sw.js` / `APP_VERSION` / `PWA-优化清单.md` 均未改动，未 push / 未部署 / 未安装依赖。

---

## 2. 测试环境与方法

| 项 | 值 |
|---|---|
| 引擎 | Chrome for Testing **157.0.8103.80**，`--headless=new`，独立 `--user-data-dir` |
| 驱动 | 原生 CDP（`ws` 来自 `C:\Users\richard\.dsh\profiles\desktop\node_modules\ws`，未装包） |
| 视口 | 390×844 与 430×932，DPR 3，`mobile:true` |
| UA | `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) ... Version/17.5 Mobile/15E148 Safari/604.1` |
| 触摸 | `Emulation.setTouchEmulationEnabled{maxTouchPoints:5}`；按住说话用 `Input.dispatchTouchEvent` |
| 安全区 | `Emulation.setSafeAreaInsetsOverride{top:47,bottom:34}`；验证 `--safe-t/--safe-b` 实际为 47px/34px |
| 网络 | 预览站点真实 HTTPS；A 组无任何注入 |
| 宿主 | B/C/D/E/F 组：`Page.addScriptToEvaluateOnNewDocument` 预加载打桩 `fetch` + `ReadableStream` SSE；未改被测文件 |

A 组是“真实首次打开”：不带 token、不注入、直接导航 → 停在配对页。B 组用 `#token=<假 token>&inst=<假实例>` 走恢复链接逻辑（只写 localStorage），随后所有 `/api/mobile/v1/*` 与 SSE 由预加载脚本应答。帧按任务给出的契约：

- `session/live-steps`：`full:true` 整份、`full:false` 同 key 增量、`turn` 变化
- `session/event`：`turn/start`、`turn/end`、`todo_write.phase{index,total,label}`
- 额外使用了 `turn/start`（契约只列了 `turn/end`）：代码用它进入 busy 状态（`index.html:6901`），与宿主真实事件一致；没有改帧结构。
- 降级：无 phase、turn 变化、控制器 `close()` 断流、3 秒后重连。

辅助脚本放在 `%TEMP%\f1f2-verify\`（`a/b/c/d/e/f/g.cjs` + `stub.js`），没有写进仓库。

---

## 3. 逐条验收

### 3.1 真实首次打开（清单 1）— PASS

证据：`01-首次打开-390x844-配对页.png`、`02-首次打开-430x932-配对页.png`

- 390×844 配对页完整：标题、6 位码输入、连接、恢复链接、两个登录入口、版本 v249；`scrollWidth=390`，无横向溢出。
- 430×932：`scrollWidth=430`，`.pair` 宽 420，`scrollHeight=clientHeight=932`，无溢出。
- 网络：6 个响应全部 200（document / manifest / icon-192 ×2 / sw.js 等），**0 个 ≥400，0 个 loadingFailed**。
- Console：0 个 error、0 个 exception；只有 1 条 warning：
  `<meta name="apple-mobile-web-app-capable" content="yes"> is deprecated. Please include <meta name="mobile-web-app-capable" ...>`
  这是弃用提示，不是报错。
- Service Worker：`navigator.serviceWorker.getRegistrations()` 返回 `https://dsh.easymana.online:8443/preview/f1f2/`，`controller=true`；`fetch('./sw.js')` 200，`fetch('./manifest.webmanifest')` 200。
- 首屏（干净 profile，冷启动）：
  - TTFB 611ms
  - FCP 1012ms
  - DOMContentLoaded 1381ms / load 1382ms
  - 首次探测到 `.pair` 1388ms
  - 另一次独立运行：TTFB 548ms / FCP 940ms / `.pair` 1303ms（量级一致）

### 3.2 布局 / 键盘 / 安全区（清单 2、6）— PASS

证据：`03`、`04`、`05`、`20`、`24`

- 390×844：`.dock .prog` 位于 x=12、right=378、bottom=693；`.row` 362×39.8，`scrollHeight=39 ≤ clientHeight+1`，四个子项 bottom 均 ≤ row bottom；`document.scrollWidth=390`。
- 430×932：`.row` 402×39.8，right=416 < 430；`.prog` right=418 < 430。
- 长摘要（70+ 字符）在 390：`cur.clientWidth=253`，`cur.scrollWidth=332`，`overflow:hidden`，`white-space:nowrap`，实际渲染成省略号（`24`），行高仍 39.8，无换行。
- 键盘：
  - 同步加 `html.kb-open` → `.prog` 的 computed `display:none`（CSS 规则 `index.html:681`）。
  - 真实走 app 自己的键盘检测：`Emulation.setDeviceMetricsOverride` 把高度 844→500，600ms 后 `html.className="kb-open"`、`--vvh=500px`、`.prog display:none`；恢复 844 后 class 清空、`.prog display:block`。
- 安全区：CDP 覆盖后 computed `--safe-t=47px`、`--safe-b=34px`；`.metabar` bottom=806 ≤ 810（844−34），composer bottom=781，进度条 bottom=693，均未被底部安全区遮挡。再用 inline style 强制 47/34 复测，布局不变。
- 注：键盘是用 viewport 收缩 + `visualViewport` 路径模拟的，真机 WKWebView 的键盘动画仍属 UNVERIFIED（E5）。

### 3.3 phase / 无 phase 降级（清单 3）— PASS

证据：`03`、`10`

- 有 phase（`todo_write.phase{index:2,total:7,label:'读 b.js'}`）：
  - 文案：`第 2/7 步` + 当前步摘要 `读取 b.js` + `0s` + `⌃`
  - 进度条：`.pbar i` 的 `style.width=29%`，实测 `104.969 / 362 = 0.28997`（2/7=0.2857，取整 29%）
- 无 phase（只发 5 条 live-steps，不发 todo_write）：
  - 文案：`已跑 5 步` + 当前步摘要 + `0s`
  - 进度条：`.pbar.indet`，`fill.style.width` 为空，无固定比例；不出现任何 `N/M` 假总数。
- 面板降级：标题 `已跑 5 步`，5 行；不会补到 7 行。
- turn 变化（同会话）：先 `full:true turn:40` 发 5 步，再 `full:false turn:41` 只发 1 步；旧 5 步被清空，strip 显示 `已跑 1 步 / 新轮第一步`，打开面板只有 1 行「新轮第一步」（`30`）。`applyLiveSteps` 的 `turnChanged` 分支（`index.html:4750-4753`）生效。

### 3.4 过程面板（清单 4）— PASS

证据：`06-过程面板-运行中.png`、`11-面板-无phase-降级.png`

- 有 phase：7 行 = 2 条已收到步骤 + 5 条「第 3…7 步 / 未开始」；标题「这一轮 · 7 步」，副标题「已跑 3s · 第 2 步进行中」（以运行时为准）。
- 状态符号：
  - 完成：`✓`，绿色（`rgb(46,107,63)`），浅绿底
  - 进行中：`●`，白字绿底
  - 未开始：文本节点是 `·`，但 CSS `color:transparent; border:1.5px solid var(--line)`（`index.html:635`），视觉是空心圆 ○
- 按钮：「收起」「停止这一轮」都在；「收起」关闭 sheet 并移除 mask；「停止这一轮」触发原生 `confirm('中断这次运行？')`（`index.html:4817`），CDP 捕获并接受后 POST `/session/stop`，stub 记录 1 次。
- 注：Chrome 对 1.5px 描边的 computed `border-top-width` 为 `1px`（DPR 取整），设计稿是 1.5px；视觉上仍为细描边空心圆，见观察项。

### 3.5 `turn/end` 收起与重连（清单 5）— PASS

证据：`07`、`08`、`09`

用一个 `turn/end` 从 `t=0` 计时：

- +250ms：`已完成 · 7 步`（label 用 `.phase.total`，见观察项），进度条消失、只剩一行。
- +2665ms：class 变为 `streamline prog donefade`，`opacity` 开始下降（截图 08）。
- +3316ms：strip 清空、`display:none`，不长期占位。
- 断流：`__T.dropSession()` 关闭当前 SSE 后 400ms，strip 显示「实时连接断开，重连中…」（`09`）；约 3 秒后自动重连，恢复为 `已跑 5 步 …`，`streamCount=1`。
- 不串台：在 S2 会话里推入 `sessionId=sess-f1` 的 stale live-steps，strip 仍为空；`onFrame` 的 sessionId 过滤生效（`index.html:6893`）。打开 S2 时 `resetSteps()` 也清空了 S1 的 phase/steps（`index.html:6700`）。

### 3.6 安全区 + 键盘后的布局（清单 6）— PASS

同 3.2。补充：`installViewportSync`（`index.html:2087-2110`）在高度 844→500 时正确算出 `kb=true`、`--vvh=500px`；恢复后 `kb=false`、`--vvh=844px`。安全区值 47/34 下，header 顶部、dock 底部都没有被顶出视口。

### 3.7 设置 → 语音持久化（清单 7）— PASS

证据：`16`、`17`、`27`、`28`

- 干净 profile 首次进「设置 → 语音」：两个 `.tgl` 都无 `.on`；`dsh.speech.hold` / `dsh.speech.auto` 都是 `null`。
- 点第一个开关 → `dsh.speech.hold='1'`；点第二个 → `dsh.speech.auto='1'`；两个 `.tgl` 都 `.on`。
- `Page.reload` 后重新进语音页：两个仍 `.on`，keys 仍 `'1'`（`17`）。
- 更强的“杀页面”验证：`Browser.close` + 杀 Chrome 进程，等 2s，用**同一个 user-data-dir** 重新启动、重新导航；token 仍在，两个开关仍 `.on`，keys 仍 `'1'`（`27`）。E 组断言 `7_persist_after_process_kill` PASS。

### 3.8 麦克风渲染三条件（清单 8）— PASS

证据：`19`、`12`、`26`

- `speechHoldOn()=false`（默认）：会话里没有 `.mic`，发送键 `display:grid`（F 组 `8_mic_hidden_when_hold_off`）。
- `speechHoldOn()=true` 且有 `SpeechRecognition`/`webkitSpeechRecognition`：`.mic` 渲染，空输入时 `display:grid`；输入文字后 `.mic display:none`、`.send display:grid`；清空后恢复（B 组 `8_mic_only_when_empty`）。
- 用 `--disable-speech-api` 启动 Chrome（真实 speechSynthesis 不可用）+ 预加载 `webkitSpeechRecognition=undefined`：`recog=false`、`hasMic=false`、发送键可见（C 组，`19`）。
- 说明：`--disable-speech-api` 只关掉了 speechSynthesis；SpeechRecognition 仍由 `Object.defineProperty(..., undefined)` 模拟不存在。两个能力分别验证。

### 3.9 按住说话（清单 9）— PASS

证据：`12`、`13`、`14`

用 CDP `Input.dispatchTouchEvent`（touchStart → touchEnd）点真实的 `.mic` 中心：

- 按下 350ms：`.mic.on=true`，`.voice display:flex`，输入框已被 interim 结果写入 `帮我读一下 a.js`，提示「松开发送 · 上滑取消」（`12`）。
- 松手：mock `stop()` → `onend` → `finishVoice(true)` → `send()`；`/session/send` 记录 1 条，文本完全一致；输入框清空；消息流出现用户气泡（`13`）。
- 上滑取消：按下 → 上移 70px（>44px 阈值）→ 提示变「松开取消」（`14`）→ 松手：`sent` 数量不变、输入框还原、`.mic.on=false`。
- 触摸相关：`.mic` 有 `touch-action:none`、`-webkit-touch-callout:none`（`index.html:750-752`），并监听 `pointercancel`。Chrome 模拟通过；WebKit 真机仍 UNVERIFIED。

### 3.10 朗读 / 无语音能力 / 自动朗读（清单 10）— PASS

证据：`15`、`18`、`29`

- 有 speechSynthesis（Chrome 原生 API，mock 只用于识别）：点消息操作条「🔊 朗读」→ 按钮变「■ 停止朗读」；底部条变「正在朗读 · 第 1/2 段 / 停止」；再点恢复「🔊 朗读」（`15`）。
- 无 speechSynthesis（`--disable-speech-api` 真实关闭）：点「朗读」→ toast「这个浏览器不支持朗读」（`.toast.on`，opacity=1），无异常、无 error（`18`）。
- 自动朗读：`dsh.speech.auto='1'`，turn/end 后 1.2s，`.dock .prog .speak` 出现「正在朗读 · 第 1/2 段」，按钮变「■ 停止朗读」（`29`）。注意这是 Chrome 的 speechSynthesis 状态机；真机是否出声、是否被手势策略拦截见风险。

### 3.11 皮肤与设计稿（清单 11）— FAIL（仅过程面板上沿圆角）

结论先说：**配色、字号、按钮/卡片圆角一致；过程面板上沿圆角不一致，因此本项判 FAIL。** 这是唯一 FAIL，属视觉细节，不影响功能。

证据：`21`（纸面 + 浅色，430×932）、`25`（碳黑，390×844）、`22`（碳黑，430×932）、`23`（碳黑面板）

计算样式 / 设计稿 token 对照：

| token | 设计稿 | 产品实测（纸面） | 产品实测（碳黑） |
|---|---|---|---|
| `--bg` | `#F6F5F1` | `#F6F5F1` | `#0B0C0E` |
| `--card` | `#FFFFFF` | `#FFFFFF` | `#121417` |
| `--fg` | `#1A1A16` | `#1A1A16` | `#EAE8DF` |
| `--line` | `#E5E2D8` | `#E5E2D8` | `#24272C` |
| `--accent` | `#1A1A16` | `#1A1A16` | `#C6F04E` |
| `--ok` | `#2E6B3F` | `#2E6B3F` | `#9FE07C` |
| `--r-card` / `--r-bubble` | 24px / 20px | composer 24px | composer 24px |

字号/结构（设计稿与产品 CSS 同为）：`.prog .row` 11.5px、`.prog .row b` 12px/650、`.stpsheet h2` 15px、`.stpsheet .step .tx` 13.5px、`.stpsheet .sdot` 16px、面板按钮 14px/圆角 14px。面板 computed 实测：h2 15px、正文 13.5px、按钮圆角 14px。截图里的层级、分隔线、按钮主次、纸面暖灰/碳黑近黑+荧光绿都与设计稿一致。

**唯一 FAIL（圆角）**：

- 设计稿：`docs/design/F1-F2-过程进度与语音/index.html` 的 `.sheet{background:var(--card);border-radius:22px 22px 0 0;...}`
- 产品：`index.html:777` 的 `.sheet{...border-radius:26px 26px 0 0;...}`；`.stpsheet` 没有覆盖 `border-radius`。
- 实测：过程面板 computed `border-top-left-radius=26px`（截图 `06`、`23`）；设计基准是 22px。
- 期望 22px，实际 26px，差 4px。判 FAIL，修复建议见 §4-F1。
- **裁定（2026-11-25，主会话）：不修代码，改设计稿。** 理由：`26px 26px 0 0` 是 `index.html:777` 全局 `.sheet` 的既有约定，App 里所有底部 sheet（抽屉、模型选择、权限、皮肤）都用它；为一张新面板单独降到 22px 会变成全局唯一例外。已把设计稿 `.sheet` 改成 26px 并重出 `design-f1-f2.png`，本条从 FAIL 结案为 **PASS（按 App 约定）**。若用户要求 22px，则改 `.stpsheet` 一行并重验。

其余视觉差异（不判 FAIL）：待开始圆点的描边 CSS 设计稿/产品都写 `1.5px`，Chrome computed 为 `1px`（DPR 取整）；肉眼是细空心圆，不影响状态辨识。

### 3.12 性能（清单 12）— PASS

- 冷启动真实首屏：FCP 1012ms（另一次 940ms），配对页可见 1388ms。
- 会话打开：点击会话到 `.composer` 出现 **2ms**（同步 renderSession）；列表页在导航后 **1413ms** 完成首屏。
- 进度条出现：注入帧到 `.prog .row b` 文案变成「第 2/7 步」**2ms**（`frameToProgressMs=2`）。`openToProgressMs=643ms` 里约 500ms 是测试脚本自己等待消息加载的时间，不代表宿主延迟。
- 抖动：在 430×932 视口，24 个增量 `live-steps` 帧（80ms/帧）期间，每 80ms 采样 `.prog .row` 的 `x,y,w,h`，26 个样本只出现 **1 种矩形**（`14,726.2,402,39.8`）；Performance 指标 `LayoutCount 26`、`LayoutDuration 7-8ms`、`TaskDuration 50-51ms`。没有位置/宽度抖动。
- 说明：每来一帧更新摘要文字会有一次 layout（26 次），这是内容更新的正常成本，不是 thrash；视觉矩形不变。

---

## 4. FAIL 明细

### F1：过程面板上沿圆角 26px，设计基准 22px

- **复现步骤**：B 组进入会话 → 喂 `turn/start` + `live-steps` + `todo_write.phase` → 点底部进度条 → 打开过程面板 → 读 `.stpsheet` Computed `border-top-left-radius`；或直接对照 CSS。
- **期望**：`22px 22px 0 0`（`docs/design/F1-F2-过程进度与语音/index.html` 的 `.sheet`）。
- **实际**：`26px 26px 0 0`（`index.html:777` 的 `.sheet`；`.stpsheet` 只覆盖 h2/sm/step/sdot/sacts，没有覆盖圆角）。
- **截图**：`06-过程面板-运行中.png`、`23-碳黑-过程面板.png`。
- **疑似原因**：F1 面板复用了全局 sheet 样式（26px），没有按设计稿给 `.stpsheet` 单独覆盖；F1 commit `3082336` 没有改 `.sheet` 圆角。
- **影响**：纯视觉一致性，4px；不影响信息层级、点击区域、状态符号可读性。
- **修复建议**：加 `.stpsheet{border-radius:22px 22px 0 0}`；如果产品决定沿用全局 26px，则把设计稿改成 26px 并重新验收，避免基线漂移。

### 不是产品 FAIL 的两次红测（脚本问题，已修正复跑）

1. `06-过程面板` 第一次截图截在 sheet 入场动画（`.sheet animation:up .22s`）的 0-50ms，mask 仍在 `fade .16s`，整张 sheet 半透明、按钮下移 26px。加 450ms 等动画结束后重截，面板为不透明白底、按钮贴安全区。
2. F2 设置第一次跑复用了上一个 profile 的 `dsh.speech.*` 与碳黑皮肤，导致“默认关”与“淡出”判定被污染。后续每次 run 先删除独立 profile，默认态恢复干净。
3. 预览 harness 的「← 测试环境」浮标会压住输入框左上角；B 组截图用预加载样式隐藏，A 组保留原样。它不是产品 UI。

---

## 5. 观察 / 非阻塞风险（不影响功能判定）

1. **完成步数取 phase.total，不是实际收到的步骤数**（`index.html:4792-4794`）。
   `finishSteps()`：`count = state.phase?.total || state.steps.length`。本轮故意只发 2 条 live-steps + phase total=7，`turn/end` 显示「已完成 · 7 步」。若宿主在「用户中途停止」时只发了部分步骤、又发了 turn/end，会显示计划总数 7，看起来像 7 步都完成了。契约若保证 turn/end 前必有完整快照，则没问题；建议真机联调时确认。
2. **待开始圆点描边 1px vs 设计 1.5px**（`index.html:635`，Chrome DPR 取整）。不影响状态辨识。
3. **不支持的浏览器仍可把「按住说话」开关留在 on**（`index.html:1836-1843`）。开关值来自 localStorage，`canRecog=false` 时仍会渲染 on 状态；再点会 toast「这个浏览器不支持语音识别」。麦克风本身不会渲染（已 PASS），只是设置页状态略矛盾。
4. **`APP_VERSION='v249'` 而 `sw.js` 缓存名是 `dsh-mobile-v250`**（`index.html:853`、`sw.js:9`）。不是 F1/F2 功能问题，但版本号与缓存代号不一致，排查线上缓存时容易误判。
5. **预览浮标**（`<a href="../">← 测试环境</a>`）在真实首次打开时覆盖输入框左上角；只在 preview 存在，上线不受影响，但 preview 验收截图需要知道这一点。

---

## 6. 真实 vs 模拟（必须知道的边界）

| 项目 | 真实 / 模拟 | 说明 |
|---|---|---|
| 预览页面、manifest、icon、sw.js | **真实** | 从 `https://dsh.easymana.online:8443` 真实 HTTPS 拉取；6/6 200 |
| 部署产物与本地 commit | **真实** | 剥离 4 处 preview 标记后字节级相等（见 §1） |
| 首次打开、配对页 | **真实** | 无 token、无注入、无预加载脚本 |
| 宿主 `/api/mobile/v1/*` | **模拟** | 预加载 `fetch` 打桩；未使用任何真机凭据 / `~/.dsh` |
| session SSE | **模拟** | `ReadableStream` 按契约喂帧；断流用 `controller.close()` |
| `SpeechRecognition` | **模拟** | 自定义构造器注入 interim result；只验证 UI 状态机与发送链路 |
| `speechSynthesis` | **部分真实** | B/F 用 Chrome 原生 API（无音频输出）；C 用 `--disable-speech-api` 真正关闭 |
| 视口 / DPR / UA / 触摸 | **模拟** | Chrome CDP，不是 iPhone 硬件 |
| 安全区 47/34 | **模拟** | `setSafeAreaInsetsOverride`；真机 `env()` 由 Safari 提供 |
| 键盘 | **模拟** | 加 `kb-open` + viewport 844→500；不是 iOS 键盘动画 |
| 皮肤 | **真实渲染** | 产品真实 CSS/JS 切换 `data-skin`，截图为真实像素 |

**没有做的事**：没有用用户的手机配对凭据，没有连真实宿主，没有 push，没有部署，没有安装依赖，没有改 `index.html` / `sw.js` / 版本号 / 优化清单。

---

## 7. iPhone 专有风险（UNVERIFIED 的具体点）

1. **安全区**：`--safe-t/--safe-b` 来自 `env(safe-area-inset-*)`（`index.html:26`）。CDP 覆盖能验证布局，但真机 Safari 的 URL 栏/standalone 模式、横屏刘海取值不同；未在真机验证。
2. **键盘**：`installViewportSync`（`index.html:2087-2110`）用 `innerHeight` 与 `visualViewport.height` 的较大收缩判断键盘。iOS 键盘动画分多段，代码用 rAF + 260ms/700ms 补贴底；本轮只验证 500px 稳定态。建议真机看“输入框跟随键盘”和“进度条消失/恢复”的那 300ms。
3. **触摸事件**：麦克风按钮是 `pointerdown/pointermove/pointerup` + `setPointerCapture` + `touch-action:none`（`index.html:5557-5640`）。Chrome 触摸通过；iOS Safari 的 Pointer Events（13+）通常可用，但 `pointercancel`（系统手势/来电/控制中心）只在代码里兜底，未真机演练。
4. **Safari 语音权限**：`onerror` 对 `not-allowed` / `service-not-allowed` 有专门提示（`index.html:5591-5595`），文案指向 `设置 → Safari → 麦克风`。真实权限弹窗、每次识别是否都要授权、standalone PWA 是否可用，均未验证。
5. **`speechSynthesis` 手势策略**：iOS 要求第一次 `speak()` 由用户手势触发。代码在首次 `pointerdown` 用一条 volume=0 的 utterance 解锁（`index.html:4997-5009`）。手动点「朗读」是手势，问题不大；**自动朗读**在用户从未点过页面时可能被系统拦截，本轮 Chrome 无此限制，属 UNVERIFIED。中文语音包是否存在、`u.lang='zh-CN'` 是否被采用也未验证。
6. **切后台/锁屏**：`visibilitychange` 会 `stopSpeak()` + `cancelVoiceInput()`（`index.html:7031-7033`）。代码路径正确，但本轮未实测锁屏/来电/切 App。
7. **PWA standalone**：本轮是 Chrome 普通标签；添加到主屏后 `env()`、键盘、麦克风、语音识别的行为可能不同。

---

## 8. 复现步骤（本地）

1. 起独立 Chrome（任一端口）：
   `chrome.exe --headless=new --remote-debugging-port=9444 --user-data-dir=%TEMP%\f1f2-verify\profile-a --ignore-certificate-errors about:blank`
2. 用 CDP：
   - `Emulation.setDeviceMetricsOverride{width:390,height:844,deviceScaleFactor:3,mobile:true}`
   - `Emulation.setTouchEmulationEnabled{enabled:true}`
   - `Emulation.setUserAgentOverride{iPhone Safari UA}`
   - `Emulation.setSafeAreaInsetsOverride{insets:{top:47,bottom:34}}`
3. A 组：直接 `Page.navigate` 到预览，等 `.pair`，截图；记录 `Network.responseReceived` / `Runtime.consoleAPICalled`。
4. B 组：`Page.addScriptToEvaluateOnNewDocument` 注入 `stub.js`（打桩 fetch + SSE + SpeechRecognition），再导航到 `...#token=fake-token-verify&inst=fake-instance`；等 `.row`，点会话，用 `Runtime.evaluate` 调 `__T.push(frame)` 喂帧。
5. 触摸：`Input.dispatchTouchEvent{touchStart}` → `touchMove` → `touchEnd`，坐标取 `.mic` 的 `getBoundingClientRect()` 中心。
6. 面板：点 `.dock .prog .row`，等 450ms 动画结束再截图/断言；停止按钮的 `confirm` 用 `Page.javascriptDialogOpening` + `Page.handleJavaScriptDialog{accept:true}`。

脚本只读/只写临时目录与 `docs/verify/F1-F2-preview/`。

---

## 9. 截图索引

| 文件 | 内容 |
|---|---|
| `01-首次打开-390x844-配对页.png` | 真实网络首次打开，390×844 配对页 |
| `02-首次打开-430x932-配对页.png` | 真实网络首次打开，430×932 |
| `03-进度条-有phase-390x844-纸面.png` | 纸面浅色，第 2/7 步，29% |
| `04-键盘弹起-进度隐藏.png` | 高度 500（键盘态），进度条整条隐藏 |
| `05-安全区47-34-布局.png` | `--safe-t/b=47/34`，内容不被遮挡 |
| `06-过程面板-运行中.png` | 7 步面板，✓/●/○，收起/停止 |
| `07-turn-end-已完成.png` | 已完成 · 7 步（250ms） |
| `08-已完成-淡出中.png` | 2665ms，`donefade` 半透明 |
| `09-断线-重连中.png` | SSE 断开，断线提示 |
| `10-无phase-已跑N步-不定长.png` | 无 phase 降级，不定长扫描条 |
| `11-面板-无phase-降级.png` | 无 phase 面板，5 行 |
| `12-按住说话-录音中.png` | 触摸按住，语音浮层 + interim 文本 |
| `13-按住说话-松手已发送.png` | 松手后用户气泡 + 深度求索中 |
| `14-上滑取消-输入还原.png` | 上滑 70px，显示「松开取消」 |
| `15-朗读-停止状态.png` | 按钮「■ 停止朗读」+ 朗读条 |
| `16-设置-语音-默认关.png` | 两个开关默认关 |
| `17-设置-语音-重载后保持.png` | reload 后仍开 |
| `18-无语音能力-朗读toast.png` | `--disable-speech-api`，toast |
| `19-无语音识别-无麦克风.png` | 无 SpeechRecognition，无麦克风 |
| `20-430x932-进度条.png` | 430 宽下进度条 + 长摘要 |
| `21-纸面浅色-会话.png` | 纸面浅色 430×932 |
| `22-碳黑深色-会话.png` | 碳黑 430×932 |
| `23-碳黑-过程面板.png` | 碳黑面板 + 荧光绿主按钮 |
| `24-390x844-长摘要-不换行.png` | 390 长摘要省略号，不换行 |
| `25-碳黑深色-390x844-会话.png` | 碳黑 390×844 |
| `26-刚打开会话-无帧.png` | 打开会话、未喂帧，进度条不占位 |
| `27-设置-语音-杀进程重开.png` | 杀 Chrome 进程重开，开关仍开 |
| `28-设置-语音-两个开关已开.png` | 两个开关置 on |
| `29-自动朗读-回合结束.png` | turn/end 后自动朗读第 1/2 段 |
| `30-turn变化-步骤清空.png` | 同会话 turn 40→41，旧 5 步清空只剩新轮 1 步 |

---

## 10. 最终结论

- **F1**：过程进度（步数/比例/无 phase 降级/面板/完成淡出/断线/不串台）在 iPhone 视口模拟下功能全部达标。唯一 FAIL 是过程面板上沿圆角 26px vs 设计 22px（`index.html:777`），纯视觉。另一个建议是“完成步数用 phase.total”在提前中断场景可能高报，需要真机联调确认宿主快照完整性。
- **F2**：语音设置持久化、麦克风三条件、按住说话/上滑取消、朗读按钮/无能力降级/自动朗读状态机全部达标；真实 Safari 权限、真麦克风、真扬声器出声未验证。
- **必须修的项：1 项（视觉）**——`.stpsheet` 增加 `border-radius:22px 22px 0 0`，或由设计确认沿用 26px 并更新设计稿。
- **可选改进**：完成步数改用实际步骤数或明确「计划 N 步」文案；统一待开始圆点 1.5px；不支持的浏览器不要把「按住说话」显示为 on。
