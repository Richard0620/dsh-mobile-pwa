# F1 / F2 修订版（B 轮）独立验收报告

- 被测：`https://dsh.easymana.online:8443/preview/f1f2b/`
- 分支 / commit：`feature/f1-f2-steps-voice` / `07e0bbd`（`fix(session): 麦克风双按钮常驻 + turn/start 清 phase`）
- 部署戳：`dsh-preview-f1f2b-v249`（预览 SW 缓存名，浏览器 `caches.keys()` 实测一致）
- 本地代码：`D:\Vibe\PWA\pwa-j\index.html`（单文件，v249）
- 验收时间：2026-11-25（America/Los_Angeles）
- 结论：**清单 10 项 PASS、0 项 FAIL**；49 条机器断言全部 PASS（A 组 9 / B 组 40）；27 张截图。**必须修的项：0。**

> 边界先说清楚：本轮**没有使用真 iPhone / Safari / WebKit**。环境是 **Chrome for Testing 157.0.8103.80 + CDP 模拟**（390×844 / 430×932、DPR 3、Touch、iPhone Safari UA、`setSafeAreaInsetsOverride` 47/34）。页面本身、SW、manifest、图标是**真实 HTTPS 部署产物**；宿主 API / SSE / `SpeechRecognition` 是打桩。凡涉及 WebKit 渲染、Safari 权限、真麦克风/扬声器、真实宿主时序的部分，单列为「真机才能验」。

---

## 0. 总表

| # | 验收项 | 结论 | 证据 | 备注 |
|---|---|---|---|---|
| 1 | 真实首次打开：配对页、无 console error、无 404 | **PASS** | `01`、`02` | 4/4 响应 200，0 失败，0 error，0 warning；FCP 980ms、配对页 1361ms；SW 缓存名即部署戳 |
| 2 | 390×844 三钮布局：[🎙][↑] 常驻；运行中 [■][🎙][↑] 不换行、不挤 chips、不压圆角 | **PASS** | `03`、`09` | 空态 2 钮；运行 3 钮均 34×34、同一行、间隔 8；chips 仍有 172px、3 个；右下角内缩 6.2px |
| 3 | 空输入可点性：点 ↑ 无反应；按住 🎙 能识别 | **PASS** | `03`、`04` | `pointer-events:none` 生效；`elementFromPoint` 不是 send；按住后 `SpeechRecognition` 构造 1 次、浮层出现 |
| 4 | 有文字态：↑ 恢复；🎙 仍在但按住静默（构造 0 次） | **PASS** | `11` | send `disabled=false`、opacity 1；mic title「请先清空输入」；按住 420ms 构造 0、无 toast |
| 5 | 附件态：无文字挂附件 ↑ 可点；删除回禁用 | **PASS** | `12`、`13` | 附件 1 个时 send 可用；删除后 count=0、`opacity:.35`、disabled |
| 6 | 设置关掉「按住说话」：🎙 仍在、按住静默、无 toast、无报错 | **PASS** | `22` | title「按住说话已在设置里关闭」、`aria-disabled=true`；按住 500ms 构造 0、无浮层、无 toast |
| 7 | `turn/start` 清 phase：1 秒内「已跑 0 步」+ 不定长条，旧 6/7 不出现 | **PASS** | `05`、`06` | 150/500/950ms 三次采样全部「已跑 0 步」+ `pbar indet`；无任何 `N/M` |
| 8 | 历史 phase 过滤：旧 turn 不回填；同 turn 可回填「第 2/5 步」 | **PASS** | `07`、`08`、`10` | 旧 turn 41 的 6/7 被过滤，仍是「已跑 2 步」；同 turn 42 的 2/5 回填成功、bar 40% |
| 9 | 回归：进度出现/3 秒收起/键盘隐藏/切会话/按住说话发送/上滑取消/朗读/设置持久化 | **PASS** | `14`–`23` | 逐项见 §3.9；杀 Chrome 进程重开仍保持 `hold=0 / auto=1` |
| 10 | 两套皮肤截图，对照双按钮/三按钮形态 | **PASS** | `03`、`24`、`25`、`26`、`27` | 纸面/碳黑 token 精确一致；两皮肤均 [🎙][↑]，运行中 [■][🎙][↑]，34px、gap 8 |

**计数：PASS 10 / FAIL 0。**

---

## 1. 被测对象与产物一致性

### 1.1 部署产物 = 本地 commit

预览 HTML 与本地 `index.html` 不是逐字节相同：预览服务注入了 4 处测试环境标记，并在两个注入点各多带了一个 `LF`。把这 4 处剥掉后，两者**字符级完全相等**：

| 项 | 值 |
|---|---|
| 本地 `index.html` SHA-256 | `00de2b9366401f47a2897dd7de1ddb9557facbb4ed08f0ab8c21e9aef8f989ff` |
| 部署文件原始 SHA-256（含预览标记） | `37cb07b0f4313c7da48bdd5a01565576152b5e528ce5ea4945b98a99864d6caa` |
| 部署文件大小 / 本地大小 | 325366 / 324977 字符（+389 = 标记文本 387 + 2 个注入点各多 1 个 LF） |
| 剥离后比较 | `equal: true`，长度 324977 == 324977，SHA 相同 |
| 部署响应 | `HTTP 200`，`Content-Length: 357618`，`Last-Modified: Wed, 25 Nov 2026 15:14:06 GMT`（本地改动 07:12:37 PST 之后） |

被剥离的 4 处：

1. `<head>` 后注入的 `<script>window.__DSH_PREVIEW__={branch:'feature/f1-f2-steps-voice',slug:'f1f2b'};</script>`
2. `<title>AI-HUB · 预览 · feature/f1-f2-steps-voice</title>`（产品：`<title>AI-HUB</title>`）
3. `<meta name="apple-mobile-web-app-title" content="DSH f1-f2-st">`（产品：`content="AI-HUB"`）
4. 末尾悬浮的 `<a href="../">← 测试环境</a>`（不是产品 UI；B 组截图用预加载样式隐藏）

### 1.2 部署戳

预览 `sw.js` 的缓存名是 `dsh-preview-f1f2b-v249`（第 10 行），页面注册的 SW scope 为 `https://dsh.easymana.online:8443/preview/f1f2b/`。浏览器里 `caches.keys()` 返回 **`["dsh-preview-f1f2b-v249"]`**，与部署戳一致。

### 1.3 工作区

`git status --porcelain` 只有 `?? docs/verify/F1-F2-preview-b/`；`index.html` / `sw.js` / `APP_VERSION` / `PWA-优化清单.md` 均未改动。未 push、未部署、未安装依赖。

---

## 2. 测试环境与方法

| 项 | 值 |
|---|---|
| 引擎 | Chrome for Testing **157.0.8103.80**，`--headless=new`，每次独立 `--user-data-dir` |
| 驱动 | 原生 CDP（`ws` 来自 `C:\Users\richard\.dsh\profiles\desktop\node_modules\ws`，未装包） |
| 视口 | 390×844 与 430×932，DPR 3，`mobile:true` |
| UA | `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) ... Version/17.5 Mobile/15E148 Safari/604.1` |
| 触摸 | `Emulation.setTouchEmulationEnabled{maxTouchPoints:5}`；实际用 `Input.dispatchTouchEvent` |
| 安全区 | `Emulation.setSafeAreaInsetsOverride{top:47,bottom:34}`；实测 CSS `--safe-t/--safe-b = 47px/34px` |
| 网络 | A 组：真实 HTTPS、无注入、无 token；B 组：真实 HTML/SW/manifest，宿主接口与 SSE 由预加载脚本应答 |
| 浏览器隔离 | **没有使用共享的 agent-browser 页面**；每个脚本各起独立 Chrome（独立 profile + 独立调试端口 9551/9552/9553/9571/9572/9561/9562），不与另一验证进程抢页面 |
| 打桩 | `Page.addScriptToEvaluateOnNewDocument` 注入 `stub-b.js`，只改内存里的 `window.fetch` / `SpeechRecognition`，不动被测文件 |

B 组进入方式：`#token=fake-token-verify-b&inst=fake-instance-b`（只写 localStorage，不使用任何手机凭据）。帧按任务给的契约：

- `session/live-steps`：`full:true` 整份、`full:false` 增量、`turn` 变化
- `session/event`：`turn/start`、`turn/end`、`todo_write.phase{index,total,label}`
- 额外用 `session/event` 的未知内层类型（`agent/status`）触发 `loadMessages`，用来单独验证「历史 phase 回填」路径，不让实时 phase 分支掩盖它
- `SpeechRecognition` mock 在构造函数里计数，用来证明「按住 🎙 静默」时**没有构造**识别器

辅助脚本在 `%TEMP%\f1f2b-verify\`（`a.cjs` / `b.cjs` / `skins.cjs` / `fix04.cjs` / `stub-b.js`），没有写进仓库。

---

## 3. 逐条验收

### 3.1 真实首次打开（清单 1）— PASS

证据：`01-真实首次打开-390x844-配对页.png`、`02-真实首次打开-430x932-配对页.png`

- 390×844 配对页完整：标题、6 位码输入、连接、恢复链接、两个登录入口、`版本 v249`；`scrollWidth=390`，无横向溢出。
- 430×932：`scrollWidth=430`，`.pair` 420 宽，`scrollHeight=clientHeight=932`，无溢出。
- 网络：4 个响应（document / manifest / icon-192 ×2）全部 `200`，**0 个 ≥400**，**0 个 loadingFailed**。
- Console / Log：**0 error、0 exception、0 warning**（比上一轮还干净）。
- Service Worker：1 个注册、scope 正确、`controller=true`；`caches.keys() = ['dsh-preview-f1f2b-v249']`。
- 首屏（干净 profile，冷启动）：TTFB 591ms、FCP 980ms、DOMContentLoaded 1330ms、load 1332ms、`.pair` 首次可见 **1361ms**。
- 安全区：CDP 覆盖后 `--safe-t=47px`、`--safe-b=34px`。

### 3.2 三钮布局（清单 2）— PASS

证据：`03-空输入-两钮-发送半透明-390x844.png`、`09-运行中-三钮-390x844.png`

390×844、纸面：

| 状态 | `.sendgroup` | 可见按钮 | 关键几何 |
|---|---|---|---|
| 空输入 | 76×34，gap 8 | `[🎙][↑]`（`stop` 为 `display:none`） | mic 289–323，send 331–365，均 34×34；send `opacity .35`、`disabled`、`pointer-events:none` |
| 运行中（空输入） | 118×34，gap 8 | `[■][🎙][↑]` | x=247/289/331，右缘 281/323/365；三个 y 都是 737，同一行 |

- composer 为 12–378 × 693–781（366×88），圆角 24px；按钮右缘距 composer 右边 **13px**、下缘距底 **10px**；用「按钮右下角到圆角圆心的距离」计算，`cornerClear = 24 − 17.8 = 6.2px > 0`，不压圆角。
- chips 在运行中仍是 **172×30**、3 个 chip（模型/推理/权限），右缘 239 < sendgroup 左缘 247，没有被挤掉；`.row` 仍是 340×34、无换行。
- 390 视口 `document.scrollWidth=390`；430×932 下 sendgroup 287–405，composer 右缘 418，同样 13px 内缩。

### 3.3 空输入可点性（清单 3）— PASS

证据：`03`、`04-空输入-按住麦克风-识别中.png`

- 空输入时 `elementFromPoint` 命中 `.sendgroup`，不是 `.send`；用真实触摸点 send 中心：`sent=0 → 0`、用户气泡数不变、输入框仍空、`recogCount=0`、无 toast。
- 按住 🎙 350–420ms：`.mic.on=true`、`.voice display:flex`、输入框被 interim 文本写入「帮我读一下 a.js」、提示「松开发送 · 上滑取消」，`SpeechRecognition` 构造 **1** 次（`04` 为按住 420ms 时截）。
- 上滑 70px 后松手：识别取消、`sent` 仍为 0、输入框还原、`.mic.on=false`。

### 3.4 有文字态（清单 4）— PASS

证据：`11-有文字-发送可用-麦克风尚在.png`

- 输入「测试文字」后：`.send` 无 `off`、`opacity=1`、`disabled=false`、`pointer-events:auto`；`.mic` 仍 `display:grid`，title=`请先清空输入`，`aria-disabled=true`。
- 清空 `recogCount` 后按住 🎙 420ms：**构造 0 次**、`.mic.on=false`、`.voice display:none`、无 toast。按住期间 `pointerdown` 在 `index.html:5602` 提前 return，没有 `preventDefault`/没有起识别。
- 说明「不弹权限」：权限弹窗只会由识别器启动触发；构造 0 次即没有启动路径。真机权限弹窗本身见 §8。

### 3.5 附件态（清单 5）— PASS

证据：`12-附件态-无文字-发送可用.png`、`13-附件删除-回到空态禁用.png`

- 用 `DOM.setFileInputFiles` 挂一个真实 PNG（无文字）：`.attach .att` 1 个、`display:flex`；send 恢复 `opacity=1`、`disabled=false`、无 `off`（`count` 也计入 `composerHasText`，`index.html:5553`）。
- 点附件右上角 ×：附件 count=0、`display:none`；send 回到 `opacity .35`、`disabled=true`、`pointer-events:none`。

### 3.6 设置关掉「按住说话」（清单 6）— PASS

证据：`22-设置关闭按住说话-麦克风仍在-按住静默.png`

- 在设置里把「按住说话」关掉（写 `dsh.speech.hold='0'`）后回到会话：`.mic` 仍 `display:grid`，title=`按住说话已在设置里关闭`，`aria-disabled=true`。
- 按住 500ms：`recogCount=0`、`.mic.on=false`、`.voice display:none`、无 toast；该时段 console 0 error、0 exception。
- 进一步：杀 Chrome 进程、用同一 profile 重开，仍是关（见 §3.9）。

### 3.7 `turn/start` 清 phase（清单 7）— PASS

证据：`05-上一轮-第6of7步-运行中.png`、`06-新一轮-turn-start-已跑0步-不定长.png`

1. 先在 turn 41 推 `live-steps` + `todo_write.phase{index:6,total:7}`：strip 显示 **`第 6/7 步` + `读取 b.js`**，`.pbar i` 宽 311.312 / 362 = **86%**（`05`）。
2. 推 `turn/start`（新一轮）后，在 **150ms / 500ms / 950ms** 三个采样点：
   - label 都是 **`已跑 0 步`**
   - `barClass = "pbar indet"`、`barPct = ""`（不定长条，没有假比例）
   - 文本里没有任何 `N/M`，`6/7` 不再出现（`06`）
3. 即使随后触发一次 `loadMessages`（此时 `stepsTurn` 还是 null），也仍然「已跑 0 步」——`index.html:6866` 的 `!(state.busy && allowTurn == null)` 守卫生效，没有把历史里的 6/7 回填进来。

### 3.8 历史 phase 过滤（清单 8）— PASS

证据：`07-历史旧turn-phase-不回填-已跑2步.png`、`08-同turn-phase-回填-第2of5步.png`、`10-过程面板-第2of5步.png`

构造：历史里有一条 **turn 41** 的 assistant 消息，blocks 带 `todo_write.phase{6/7}`；当前实时步骤帧是 **turn 42**。

- 强制走一次 `loadMessages`：strip 仍是 **`已跑 2 步` + `pbar indet`**，没有回填 6/7（`07`）。`phaseFromMessages(items, 42)` 按 `m.turn` 过滤掉了旧轮（`index.html:4736-4740`）。
- 再往历史里加一条 **turn 42** 的 `todo_write.phase{index:2,total:5,label:'读 b.js'}`，再走一次 `loadMessages`：strip 变为 **`第 2/5 步` + `读取 b.js`**，`.pbar i` 宽 144.797 / 362 = **40%**（`08`）。
- 点开过程面板：标题「这一轮 · 5 步」、副标题「已跑 5s · 第 2 步进行中」、5 行（2 条真实 + 3 条「未开始」）、`✓ / ● / ○`、「收起 / 停止这一轮」都在（`10`）。
- 面板上沿圆角仍是 26px；按上一轮主会话裁定（全局 `.sheet` 约定，设计稿已改为 26px），本轮不判 FAIL。

### 3.9 回归（清单 9）— PASS

| 回归点 | 结果 | 证据/数据 |
|---|---|---|
| 进度条出现 | `turn/start` 后 150ms 采样已出现「已跑 0 步」 | `06`；150/500/950ms 三次采样 |
| 结束 3 秒收起 | `turn/end` 后 300ms「已完成 · 5 步 · 12s」；2700ms 带 `donefade`；设计值 3000ms 清空，3500ms 采样已为空 | `17-回合结束-已完成.png`；`donefade`/清空断言 |
| 键盘态隐藏 | 加 `html.kb-open` → `display:none`；真实高度 844→500 → class 加上、`--vvh=500px`、`display:none`；恢复 844 后 `display:block`、`--vvh=844px` | `19-键盘弹起-进度隐藏.png` |
| 切会话不串台 | S2 打开后推 S1 的迟到 `live-steps`，strip 仍为空 | `cross0.text=""`、`cross1.text=""` |
| 按住说话发送 | 按住 380ms 松手：`/session/send` 1 条、文本完全一致、输入框清空、出现用户气泡 | `14`、`15` |
| 上滑取消 | 上移 70px → 提示「松开取消」；松手 `sent` 不变、输入还原、`.mic.on=false` | `16-上滑取消-松开取消.png` |
| 朗读开始/停止 | 按钮「🔊 朗读」→「■ 停止朗读」；底部「正在朗读 · 第 1/2 段 / 停止」；再点恢复 | `18-朗读-停止状态.png` |
| 设置两个开关持久化 | 干净 profile：hold=**on**（默认新行为）、auto=off、keys 均为 null；改为 hold=0 / auto=1 → 杀 Chrome 进程重开 → 仍 hold=0 / auto=1 | `20`、`21`、`23`；杀进程为 `Browser.close` + `proc.kill()` 后同 profile 重启 |
| 流程内 console | 杀进程前 0 error、0 exception、0 network failed；重开后仍 0 | `errorsBeforeKill=[]`、`netFailsBeforeKill=[]` |

补充：`turn/end` 的完成步数仍取 `state.phase.total`（本轮 2 条真实步骤 + total 5 → 显示「已完成 · 5 步」），这是上一轮已记录的行为，不是本轮改动引入。

### 3.10 两套皮肤与设计稿（清单 10）— PASS

证据：`03`（纸面空态双钮）、`24`（纸面三钮）、`25`（碳黑三钮）、`26`（碳黑 430）、`27`（碳黑空态双钮）

| token | 设计稿 | 纸面实测 | 碳黑实测 |
|---|---|---|---|
| `--bg` | `#F6F5F1` | `#F6F5F1` | `#0B0C0E` |
| `--card` | `#FFFFFF` | `#FFFFFF` | `#121417` |
| `--fg` | `#1A1A16` | `#1A1A16` | `#EAE8DF` |
| `--line` | `#E5E2D8` | `#E5E2D8` | `#24272C` |
| `--accent` | `#1A1A16` | `#1A1A16` | `#C6F04E` |
| `--ok` | `#2E6B3F` | `#2E6B3F` | `#9FE07C` |
| composer 圆角 | 24px | 24px | 24px |
| 按钮 | 34×34、gap 8 | 34×34、gap 8 | 34×34、gap 8 |

- `mic-and-f3-entry.png` 的「备选：两个按钮都常驻」就是本轮默认形态：mic 在左、↑ 在右、空输入时 ↑ 半透明不可点；产品 `03`/`27` 与之同形。设计稿 `design-f1-f2.png` 的「两套皮肤下的同一组件」是 `[■][🎙][↑]` 三钮，产品运行态 `24`/`25` 同序同尺寸。
- 390 和 430 两种宽度下按钮都在 composer 内、不换行、不压圆角；两皮肤都同时显示 mic 和 send。
- 风格差异（不判 FAIL）：产品麦标是 emoji `🎙`，设计稿是描边 SVG 图标；emoji 在两套皮肤下都可见（碳黑下是彩色金属麦克风），但不是 `currentColor` 风格。

---

## 4. 改动点逐行核对

只核对本轮声称改的三处；行号均为本地 `index.html`（`07e0bbd`）。

### 4.1 三钮常驻

| 位置 | 代码事实 |
|---|---|
| `index.html:743` | `.sendgroup{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}` |
| `index.html:747-751` | `.send` 34px 圆；`.send.off{opacity:.35;pointer-events:none;...}`；`.send:disabled{opacity:.4}` |
| `index.html:752-756` | `.mic` 34px 圆、`touch-action:none`、`-webkit-touch-callout:none` |
| `index.html:757-758` | `.stop` 34px 圆、默认 `display:none` |
| `index.html:5960-5963` | `.composer > .crow > (.plus, .chips, .sendgroup(stopBtn, micBtn, sendBtn))`，顺序 = [■][🎙][↑] |
| `index.html:5547-5551` | `syncSendDisabled`：`disabled = blocked || !composerHasText`，并切 `.off` |
| `index.html:5552-5563` | `syncInputButtons`：`composerHasText = 有文字 || pending.length`；mic 的 title 在「设置关闭 / 录音中 / 有内容 / 空闲」间切换；`aria-disabled` 同步 |
| `index.html:5531-5533` | 有识别能力才创建 `.mic`；设置不再决定是否渲染 |
| `index.html:5598-5604` | `pointerdown`：`!speechHoldOn()` 或 `getText().trim() || pending.length` → **静默 return** |

### 4.2 `turn/start` 清 phase + 历史回填

| 位置 | 代码事实 |
|---|---|
| `index.html:4821-4832` | `beginTurn()`：`state.steps=[]; state.stepsTurn=null; state.phase=null; state.stepsDone=null`，再 `markBusy(true)` + `paintProg(true)` |
| `index.html:6862-6872` | `loadMessages`：`const allowTurn = state.busy ? state.stepsTurn : null;`，且 `if (!state.phase && !(state.busy && allowTurn == null))` 才回填 |
| `index.html:4733-4747` | `phaseFromMessages(msgs, turn)`：`turn != null` 时 `Number(m.turn) !== Number(turn)` 直接跳过 |
| `index.html:4751-4761` | `applyLiveSteps` 的 `turnChanged` 分支按轮清空步骤 |

### 4.3 `dsh.speech.hold` 默认开

`index.html:5006-5011`：

```js
function speechHoldOn() {
  const v = localStorage.getItem(SPEECH_HOLD_KEY);
  return v == null ? true : v === '1';   // 默认开；只有明确写 '0' 才算关
}
```

实测：干净 profile 设置页「按住说话」默认 ON、`dsh.speech.hold` 为 `null`；显式写 `'0'` 后杀进程重开仍为关。

---

## 5. FAIL 明细

**本轮没有产品 FAIL。** 有三处验证脚本自己先红了，查清后属于夹具/断言问题，记录在此避免误读：

1. **圆角触控探测误判**：最初用 `elementFromPoint(send.right-1, send.bottom-1)` 判断「是否压圆角」。空输入时 send 有 `pointer-events:none`，该点命中的是父级 `.sendgroup`，于是误判。改成几何判定：按钮右/下缘距 composer 边 13/10px，且按钮右下角到 composer 圆角圆心的距离 < 半径，`cornerClear=6.2px`。
2. **假 LAN 主机的 push 心跳网络错**：打桩的 `connection-info` 返回 `name:'mock-host'`，App 会拼出 `https://mock-host.local:8443` 并选中它；`/push/active` 不在 `/api/mobile/v1/` 前缀下，原来的 stub 没接，真实网络报 `ERR_CONNECTION_CLOSED`。给 stub 补上 `/push/active` 后，全流程 0 network failed、0 console error。**这不是产品问题**：真机上是真实宿主的 `/push/active`。
3. **`04` 截图时机**：第一次在松手取消之后截图，画面已经回到空态；已改为按住期间截（`04` 现在有语音浮层和 interim 文本）。

---

## 6. 观察 / 非阻塞风险

1. **320px 宽未覆盖**：本轮按要求只测 390/430。iPhone SE（第 1 代）320 宽下，三钮 118px + plus 34px + 两个 8px 间距会明显压缩 chips；按现在的 `flex-wrap` 应该会换行而不是溢出，但没有实测。
2. **麦克风图标是 emoji**：`🎙` 不跟 `currentColor`，与设计稿的描边 SVG 风格不同；纸面/碳黑都可见，属于风格差异。
3. **完成步数仍取 `phase.total`**（`index.html:4797-4799`）：本轮 2 条真实步骤 + total 5 显示「已完成 · 5 步」。若宿主在用户中途停止时只发部分步骤又发 `turn/end`，会显示计划总数；需真机联调确认宿主快照完整性。这是上一轮留下的观察，不是新改动。
4. **历史回填依赖 `message.turn`**：如果宿主消息不带 `turn`，`phaseFromMessages(items, allowTurn)` 会全部过滤掉，表现为「已跑 N 步」而不是编造比例。这是安全降级，但会让「同一 turn 从历史回填」在真实宿主上失效；建议联调时确认 `turn` 字段确实下发。
5. **录音中 send 会因 interim 文字变为可用**：按住时输入框实时写入识别文本，`composerHasText` 为真，↑ 从半透明恢复。手指正按在麦克风上，实际点不到；不影响本轮清单，但若以后支持「录音时另一只手点发送」，需要显式禁用。
6. **`aria-disabled` 只在 mic 上**，send 用原生 `disabled`；语义可接受，不是问题。

---

## 7. 真实 vs 模拟

| 项目 | 真实 / 模拟 | 说明 |
|---|---|---|
| 预览页面、manifest、icon、sw.js | **真实** | 真实 HTTPS 拉取；A 组 4/4 200 |
| 部署产物与本地 commit | **真实** | 剥离 4 处 preview 标记后字符级相等，SHA 相同；SW 缓存名即部署戳 |
| 首次打开、配对页 | **真实** | 无 token、无注入、无预加载脚本 |
| 宿主 `/api/mobile/v1/*` | **模拟** | 预加载 `fetch` 打桩；未使用任何真机凭据 / `~/.dsh` |
| session SSE / 设备 SSE | **模拟** | `ReadableStream` 按契约喂帧；含 `turn/start`、`turn/end`、`todo_write` |
| `SpeechRecognition` | **模拟** | 自定义构造器 + 构造计数；只验证 UI 状态机与发送链路 |
| `speechSynthesis` | **部分真实** | 用 Chrome 原生 API（无音频输出）；只验证按钮/朗读条状态 |
| 视口 / DPR / UA / 触摸 | **模拟** | Chrome CDP，不是 iPhone 硬件 |
| 安全区 47/34 | **模拟** | `setSafeAreaInsetsOverride`；真机 `env()` 由 Safari 提供 |
| 键盘 | **模拟** | 加 `kb-open` + viewport 844→500；不是 iOS 键盘动画 |
| 附件 | **模拟** | `DOM.setFileInputFiles` 挂本地 `icon-192.png`，走真实 `File`/`URL.createObjectURL` 路径 |
| 杀进程重开 | **真实** | `Browser.close` + `proc.kill()`，同一 user-data-dir 重新启动 Chrome |
| 皮肤 | **真实渲染** | 产品真实 CSS/JS 切 `data-skin`，截图为真实像素 |

**没有做的事**：没有用用户的手机配对凭据，没有连真实宿主，没有 push，没有部署，没有安装依赖，没有改 `index.html` / `sw.js` / 版本号 / 台账。

---

## 8. 真机才能验的三条

1. **WebKit 的触摸手势仲裁**：`pointerdown/move/up` + `setPointerCapture` + `touch-action:none` + `pointercancel` 在真实 iPhone 上要经过 Safari 的手势识别（长按选择、系统边缘手势、来电/控制中心/通知下拉）。Chrome 的 `Input.dispatchTouchEvent` 能验证代码路径，但不能证明 iOS 不会把长按判成选择/3D Touch，也不能证明 `pointercancel` 真的会在系统打断时到达。
2. **真实麦克风权限与系统听写**：`SpeechRecognition` 是 mock。Safari 的首次授权弹窗、每次识别是否重复授权、`not-allowed/service-not-allowed` 的真实错误码、standalone PWA 下是否可用、识别延迟/准确率/中文断句，都只能在真机验证。
3. **真实键盘、安全区与语音出口**：iOS 键盘是多段动画并通过 `visualViewport` 变化（不是本轮 844→500 的一次性收缩）；standalone/横屏的 `env(safe-area-inset-*)` 取值不同；扬声器是否真的出声、中文语音包是否存在、自动朗读在「用户从未点过页面」时是否被手势策略拦截，均未验证。

---

## 9. 复现步骤

1. 起独立 Chrome（示例）：
   `chrome.exe --headless=new --remote-debugging-port=9552 --user-data-dir=%TEMP%\f1f2b-verify\profile-b --ignore-certificate-errors about:blank`
2. 用 CDP 设置：
   - `Emulation.setDeviceMetricsOverride{width:390,height:844,deviceScaleFactor:3,mobile:true}`
   - `Emulation.setTouchEmulationEnabled{enabled:true,maxTouchPoints:5}`
   - `Emulation.setUserAgentOverride{iPhone Safari UA}`
   - `Emulation.setSafeAreaInsetsOverride{insets:{top:47,bottom:34}}`
3. A 组：直接 `Page.navigate` 到预览，等 `.pair`，截图；记录 `Network.responseReceived` / `Runtime.consoleAPICalled` / `Log.entryAdded`。
4. B 组：`Page.addScriptToEvaluateOnNewDocument` 注入 `stub-b.js`（打桩 fetch + SSE + `SpeechRecognition` 构造计数），导航到 `...#token=fake-token-verify-b&inst=fake-instance-b`；点会话，用 `Runtime.evaluate` 调 `__T.push(frame)` 喂帧。
5. 触摸：`Input.dispatchTouchEvent{touchStart}` → `touchMove` → `touchEnd`，坐标取 `.mic` / `.send` 的 `getBoundingClientRect()` 中心。
6. 附件：`DOM.setFileInputFiles` 给 `input[type=file][multiple]`，等 `.att img.complete` 再截图/删除。
7. 面板：点 `.dock .prog .row`，等 450ms 入场动画结束再截图；停止按钮的 `confirm` 用 `Page.javascriptDialogOpening` + `Page.handleJavaScriptDialog{accept:true}`。
8. 持久化：改成 hold=0 / auto=1 → `Browser.close` + `proc.kill()` → 同一 `--user-data-dir` 重启 → 重新导航 → 读设置页与 localStorage。

脚本只写临时目录与 `docs/verify/F1-F2-preview-b/`。

---

## 10. 截图索引（27 张）

| 文件 | 内容 |
|---|---|
| `01-真实首次打开-390x844-配对页.png` | 真实网络首次打开，390×844 配对页，v249 |
| `02-真实首次打开-430x932-配对页.png` | 真实网络首次打开，430×932 |
| `03-空输入-两钮-发送半透明-390x844.png` | 纸面空态 [🎙][↑]，↑ 半透明 |
| `04-空输入-按住麦克风-识别中.png` | 空输入按住 🎙，语音浮层 + interim 文本 |
| `05-上一轮-第6of7步-运行中.png` | turn 41：第 6/7 步、86% 条 |
| `06-新一轮-turn-start-已跑0步-不定长.png` | 同一会话 turn/start 后：已跑 0 步 + 不定长条 |
| `07-历史旧turn-phase-不回填-已跑2步.png` | 历史旧 turn 的 6/7 被过滤，仍是已跑 2 步 |
| `08-同turn-phase-回填-第2of5步.png` | 同 turn 的 2/5 回填，40% 条 |
| `09-运行中-三钮-390x844.png` | 运行中 [■][🎙][↑] 三钮 |
| `10-过程面板-第2of5步.png` | 面板：这一轮 · 5 步，✓/●/○ |
| `11-有文字-发送可用-麦克风尚在.png` | 有文字：↑ 恢复、🎙 仍在（title 请先清空输入） |
| `12-附件态-无文字-发送可用.png` | 无文字挂附件，↑ 可用 |
| `13-附件删除-回到空态禁用.png` | 删除附件，↑ 回到半透明禁用 |
| `14-按住说话-录音中.png` | 按住 🎙，松开发送 · 上滑取消 |
| `15-松手已发送.png` | 松手后用户气泡 + 输入框清空 |
| `16-上滑取消-松开取消.png` | 上滑 70px，提示「松开取消」 |
| `17-回合结束-已完成.png` | `turn/end`：已完成 · 5 步 · 12s |
| `18-朗读-停止状态.png` | 「■ 停止朗读」+ 正在朗读第 1/2 段 |
| `19-键盘弹起-进度隐藏.png` | 高度 500，进度条隐藏 |
| `20-设置-语音-按住说话默认开.png` | 干净 profile：按住说话默认 ON、自动朗读 OFF |
| `21-设置-自动朗读开-按住说话关.png` | 两个开关写入 hold=0 / auto=1 |
| `22-设置关闭按住说话-麦克风仍在-按住静默.png` | 关掉后 🎙 仍在，按住静默 |
| `23-杀进程重开-设置仍保持.png` | 杀进程重开：hold=0 / auto=1 仍保持 |
| `24-纸面浅色-三钮-390x844.png` | 纸面，运行中三钮 |
| `25-碳黑-三钮-390x844.png` | 碳黑，运行中三钮 |
| `26-碳黑-430x932-三钮.png` | 碳黑 430×932，三钮 |
| `27-碳黑-空输入-双钮-390x844.png` | 碳黑空态双钮 [🎙][↑] |

---

## 11. 最终结论

- **改动 1（麦克风双按钮常驻）正确**：空态 2 钮、运行态 3 钮，34px/8px 几何与设计一致；↑ 在空态 `opacity .35 + disabled + pointer-events:none`，点/摸无反应；有文字/附件时恢复；🎙 任何状态都渲染，按住只在「有识别能力 + hold 开 + 输入为空」时启动，其余静默且不构造识别器。
- **改动 2（`turn/start` 清 phase）正确**：新一轮 150ms 内显示「已跑 0 步」+ 不定长条，旧 6/7 不残留；历史 phase 只在「当前轮无 phase」且消息 `turn` 与当前 turn 一致时回填，旧 turn 不会串。
- **改动 3（hold 默认开）正确**：干净 profile 默认 ON；显式 `'0'` 的设备保持关，杀进程重开仍关。
- **回归全部守住**：进度出现/3 秒收起/键盘隐藏/切会话不串台、按住说话发送与上滑取消、朗读开始与停止、两个开关杀进程持久化；流程内 **0 console error、0 network failed**。
- **必须修的项：0。** 可选改进见 §6（320 宽补测、麦标统一为 SVG、完成步数语义、确认宿主 `turn` 字段）。
