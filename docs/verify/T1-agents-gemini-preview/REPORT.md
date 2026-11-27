# T1 终端新建对话与 Gemini (agy) 预览验收报告

- **预览地址**：`https://dsh.easymana.online:8443/preview/agents-gemini/`
- **分支 / Commit**：`feature/agents-gemini` / `4d99050`
- **本地 Worktree**：`D:\Vibe\PWA\pwa-n`
- **设计稿对照**：`D:\Vibe\PWA\pwa-n\docs\design\T1-终端新建对话与Gemini\index.html`
- **验收时间**：2026-11-27（America/Los_Angeles）
- **验收环境**：无头 Chrome `157.0.8103.80` + CDP（iPhone 模拟：`390×844` / `430×932`、`DPR=3`、`mobile=true`、iPhone Safari UA、Touch、`--safe-t:47px; --safe-b:34px`、`html.kb-open`、纸面 Paper + 碳黑 Carbon 双皮肤）；未改动任何业务文件、未 push/部署/装依赖、未触碰生产端口 `18888`、未使用真实设备凭据。
- **总体结论**：功能主项 **13 项 PASS / 0 项硬性 FAIL**；发现 **2 个 P2 体验缺陷**（均位于 `agents/ui.html`，建议修后再交给用户真机验收）；真机与宿主机实跑项 **4 项 UNVERIFIED**。

> 边界声明：**未使用真 iPhone / Safari / WebKit，也未在宿主机生产 bridge（18888）真启动 `herdr --kind agy`**。下表每项均明确标注「真实 / 模拟 / 未验证」，绝不把打桩结果混同真机验证。

---

## 0. 验收总表

| 编号 | 验收项 | 性质 | 结论 | 截图 / 证据 | 实测观测 |
|---|---|---|---|---|---|
| A1 | 真实 HTTPS 首屏加载、SW 缓存名与产物一致性 | **真实** | **PASS** | `00-真实部署产物-390x844-配对页.png` | HTTP 200（`index.html`/`manifest`/`icon`/`sw.js`）、0 console/page error、SW 缓存 `dsh-preview-agents-gemini-v251`、剥离 4 处预览标记后与本地 `index.html` 逐字节一致（`equalAfterStrip: true`） |
| A2 | 终端 Tab 分组展示（`gemini-1` / `claude-2`，双尺寸双皮肤） | **模拟** | **PASS** | `01-终端Tab-390-纸面.png`、`02-终端Tab-430-碳黑.png` | 分组头 `GEMINI-1 1` / `CLAUDE-2 1`，行项 `PWA 运行中` / `CRM 等你确认`；双皮肤可读、0 横向溢出（`390/390`、`430/430`） |
| A3 | 新建终端 → 选目录 → `openTerminalStartSheet` 4 项启动方式 | **模拟** | **PASS** | `03-新建终端启动方式sheet-390-纸面.png`、`04-新建终端启动方式sheet-430-碳黑.png` | 标题「在 pwa 中新建终端对话」，4 项文案精确匹配：`DSH（自然语言）` / `Gemini（agy）` / `Claude Code` / `仅打开纯终端`；仅 preview 浮标遮挡第 4 项图标（非正式产物问题） |
| A4 | 选择 `Gemini（agy）` 发 `POST /agents/tab/create` 并打开 `.termoverlay` | **模拟** | **PASS** | `verify-results.json`（Part A） | 请求体精确为 `{"cwd":"D:\\Vibe\\PWA\\pwa","startKind":"agy"}`；`.termoverlay` 打开且 iframe `src=/agents/?embed=1&pcomposer=1&pane=w1%3Ap9&v=v251` |
| A5 | `postMessage` `agents-mode` 同步外层输入占位与发送按钮态 | **模拟** | **PASS** | `verify-results.json`（Part A） | `ready:false` → `.tsend.disabled=true`、`data-ph="先选择启动方式"`；`ready:true` → `.tsend.disabled=false`、`data-ph="发消息给 Gemini，Enter 发送"` |
| A6 | `.termoverlay` 在 `html.kb-open` + 键盘收窄视口（520px）布局 | **模拟** | **PASS**（附注） | `verify-results.json`（Part A） | 视口缩至 520px 时 `bar:0..100`、`frame:100..422`、`composer:422..520`，无重叠、无越界、无横向溢出；注：仅加 `html.kb-open` 类而未缩 `visualViewport` 时，`fitOverlay()` 的内联 `height:100%` 会覆盖 CSS 规则 |
| A7 | `postMessage` `pwa-new-terminal` 关闭浮层并唤起目录选择器 | **模拟** | **PASS** | `verify-results.json`（Part A） | `.termoverlay` 数量归 `0`，右侧目录面板 `.rpanel`「选择工作区目录」正常弹出 |
| B1 | 隔离端口 `18892` 跑 `agents/bridge.mjs` + `agents/smoke.ps1` | **真实**（本地隔离） | **PASS** | 命令行输出 | `health: agent-bridge`、`dsh/state: exists=True`、`ui version: v22`、`SMOKE OK`（exit 0）；测完进程干净退出（`BRIDGE_EXITED=True`），未碰 `18888` |
| B2 | 空终端启动页（3 卡片、双皮肤）+ 启动中锁定态 + 启动失败错误卡 | **模拟** | **PASS**（含 **P2 缺陷 #1**） | `05-空终端启动页-390-纸面.png`、`06-空终端启动页-430-碳黑.png`、`07-启动中态-390-纸面.png`、`08-启动失败卡-390-纸面.png` | 3 卡片/锁定态/耗时/失败卡/重试与切终端按钮均正确、碳黑主按钮荧光绿对比度清晰；但**首次进入默认 `chat` 视图有 ~2.08s 白屏**（见 §3 缺陷 #1） |
| B3 | Gemini 活跃态（`agent:'agy', name:'gemini-1'`）+ 审批卡 | **模拟** | **PASS**（含 **P2 缺陷 #2**） | `09-Gemini对话与审批卡-390-纸面.png` | 顶栏标题为 `Gemini`（非 `Claude`）、`.who` 为 `GEMINI`（见 `12` 背景）、审批卡含 `工具请求确认` / `gemini-1 在等你的输入`；但**同时渲染了 `#blockedBar` 导致审批区双重重复**（见 §3 缺陷 #2） |
| B4 | Gemini 降级态（`fallback:'pane'`）与发消息回显 | **模拟** | **PASS** | `10-Gemini降级终端摘要-390-纸面.png` | 顶部提示条「未匹配到 Gemini 对话日志，已显示终端摘要」+「看终端 ›」；发送走 `POST /agents/prompt`（`target:'gemini-1'`），展示用户气泡 + `GEMINI · 终端摘要` 卡片 |
| B5 | 顶栏 `＋` 全模式可见 +「新建对话」sheet 及全部动作 | **模拟** | **PASS** | `11-顶栏新建对话sheet-390-纸面.png`、`12-顶栏新建对话sheet-430-碳黑.png` | 空终端 / DSH / Gemini / Claude 四模式 `#resetBtn` 均可见；sheet 5 项齐全，Esc 与遮罩点击关闭生效；同目录新开 Gemini 调 `POST /tab/create {startKind:'agy'}`；红字项 Gemini 发 `/send {text:'/exit',enter:true}`、DSH 发 `/dsh/close` |
| B6 | 全场景控制台错误、横向溢出与双皮肤对比度 | **模拟** | **PASS** | 全部 `00`–`12` 截图 | Part A & B 全程 `consoleErrors: 0`、`pageErrors: 0`、所有界面 `scrollWidth === clientWidth`（0 横向溢出）；纸面与碳黑双皮肤文字、边框、危险红、主按钮对比度良好 |
| C1 | 真机 iPhone Safari 触摸、软键盘弹起与真实安全区 | **未验证** | **UNVERIFIED** | — | 无头 Chrome CDP 无法替代真机 iOS WebKit 软键盘与手势 |
| C2 | 生产端口 `18888` 真机实跑 `herdr --kind agy` 拉起 Gemini | **未验证** | **UNVERIFIED** | — | 严禁触碰生产 bridge `18888` 及真机凭据 |
| C3 | 宿主机真实 `~/.gemini/antigravity/brain` 或 `~/.gemini/tmp` 日志文件解析 | **未验证** | **UNVERIFIED** | — | Part B `/chat` 为 mock 响应，未用真实落盘 transcript 实测 |
| C4 | 真机通过 Caddy `/preview/agents-gemini/` + `/agents/` 跨域/同源 iframe 联调 | **未验证** | **UNVERIFIED** | — | Part A 中 `/agents/*` 为 CDP Fetch 拦截打桩，未走真实线上反代链路 |

---

## 1. 部署产物与版本核对（Part A.1 · 真实）

| 项 | 实测值 |
|---|---|
| 预览 URL | `https://dsh.easymana.online:8443/preview/agents-gemini/`（HTTP 200，`text/html; charset=utf-8`） |
| 预览 `sw.js` | HTTP 200，`const CACHE = 'dsh-preview-agents-gemini-v251'` |
| 浏览器注册 SW | Scope `https://dsh.easymana.online:8443/preview/agents-gemini/`，Cache Storage `["dsh-preview-agents-gemini-v251"]` |
| `APP_VERSION` | 本地 `v251` / 线上预览 `v251` |
| 本地 `index.html` 原始 SHA-256 | `3acff0eac26c208989d7f62a6384c04fe1c3b26e5ae3921fe3445bb88d1e0d54`（425,081 B） |
| 线上预览 `index.html` 原始 SHA-256 | `3cf276f073cb8dab4cddfd71cda63633bd5b700719720984f79b28a1ab5d886b`（425,470 B） |
| 剥离 4 处预览注入标记后比对 | **`equalAfterStrip: true`**（LF 规范化后 415,815 B，SHA-256 `6aa54fd270b17e4e272b423590a760441eedd3bd1e06f5c2ad83e3a4e67f4b05`，0 行差异） |

被剥离的 4 处预览标记均为 `deploy-preview.ps1` 注入：
1. `<script>window.__DSH_PREVIEW__={branch:'feature/agents-gemini',slug:'agents-gemini'};</script>`
2. `<meta name="apple-mobile-web-app-title" content="DSH agents-g">`
3. `<title>AI-HUB · 预览 · feature/agents-gemini</title>`
4. `<a href="../" ...>← 测试环境</a>`

---

## 2. 详细验证记录

### Part A — 真实 HTTPS 预览页面（`index.html`）

1. **真实首屏加载（真实）** — `00-真实部署产物-390x844-配对页.png`
   - 干净配置访问预览 URL，正常进入 AI-HUB 配对页，底部显示 `版本 v251` 与左下角预览徽标 `← 测试环境`，0 控制台报错、0 页面异常、0 横向溢出（`390×844`）。
2. **终端 Tab 与启动方式 Sheet（模拟 `/api/mobile/v1/*` 与 `/agents/*`）** — `01`、`02`、`03`、`04`
   - 写入测试用假 token（`dsh.token = 'qa-fake-device-token'`、`bridge_token = 'qa-fake-bridge-token'`）后切到「终端」Tab：
     - 正确按 agent 分组显示 `GEMINI-1 (1)`（`PWA · 运行中 · D:\Vibe\PWA\pwa`）与 `CLAUDE-2 (1)`（`CRM · 等你确认 · D:\Vibe\CRM`）。
     - 390×844 纸面（`rgb(246,245,241)` 底）与 430×932 碳黑（`rgb(11,12,14)` 底）均排版清晰、无溢出。
   - 点击「新建终端」→ 目录抽屉加载 `D:\Vibe\PWA\pwa` → 点「用这个文件夹」→ 弹出底部 sheet「在 pwa 中新建终端对话」：
     - 4 个选项按顺序呈现：`D DSH（自然语言）`、`G Gemini（agy）`、`C Claude Code`、`>_ 仅打开纯终端`，含副标题与底部「取消」。
3. **点击 `Gemini（agy）`、`postMessage` 联动与 `kb-open`（模拟）**
   - 点击 `Gemini（agy）` 后发出 `POST /agents/tab/create`，请求体 `{"cwd":"D:\\Vibe\\PWA\\pwa","startKind":"agy"}`，并打开 `.termoverlay`（iframe `src="/agents/?embed=1&pcomposer=1&pane=w1%3Ap9&v=v251"`）。
   - 向父窗发送 `agents-mode`：
     - `{ mode: 'chat', placeholder: '先选择启动方式', ready: false }` → `.tsend.disabled === true`，`.tta[data-ph] === '先选择启动方式'`。
     - `{ mode: 'chat', placeholder: '发消息给 Gemini，Enter 发送', ready: true }` → `.tsend.disabled === false`，`.tta[data-ph] === '发消息给 Gemini，Enter 发送'`。
   - 模拟键盘弹起（`html.kb-open` + 视口高度缩至 `520px`）：`.termbar` `0..100`、`.termframe` `100..422`、`.termcomposer` `422..520`，三区紧贴无重叠、无越出视口、无横向溢出。
   - 向父窗发送 `{ type: 'pwa-new-terminal' }`：`.termoverlay` 被移除（`0` 个），并自动呼出 `.rpanel`「选择工作区目录」。

### Part B — 分支 `agents/ui.html` 与隔离 `agents/bridge.mjs`

1. **隔离端口 `18892` 冒烟（真实本地隔离进程）**
   - 以 `PORT=18892`、`BRIDGE_TOKEN=qa-test-token-18892` 启动 `D:\Vibe\PWA\pwa-n\agents\bridge.mjs`，执行 `D:\Vibe\PWA\pwa-n\agents\smoke.ps1 -Base http://127.0.0.1:18892 -Token qa-test-token-18892`：
     ```text
     health: agent-bridge
     dsh/state: exists=True
     ui version: v22
     SMOKE OK
     SMOKE_EXIT=0
     BRIDGE_EXITED=True
     ```
2. **`agents/ui.html` 全状态交互（模拟本地 mock bridge `127.0.0.1:18893`，`?embed=1&pane=w1:p6`）**
   - **空终端启动页**（`05-空终端启动页-390-纸面.png`、`06-空终端启动页-430-碳黑.png`）：展示 DSH / Gemini / Claude 三张卡片，底部输入框占位「先选择启动方式」且发送键禁用；碳黑皮肤主卡片为荧光绿 `rgb(198,240,78)` 配深色文字 `rgb(11,12,14)`，对比度充足。
   - **启动中锁定态**（`07-启动中态-390-纸面.png`）：点击「启动 Gemini」后 3 张卡片全部 `disabled=true`，Gemini 卡片高亮 `.starting` 显示「启动 Gemini… / 等待命令行就绪（已耗时 0s）」，下方提示条「若首次启动停在登录/信任目录提示 · 切到终端 ›」，输入框占位同步变为「正在启动 Gemini…」。
   - **启动失败卡**（`08-启动失败卡-390-纸面.png`）：mock `/agent/start` 返回 HTTP 500 `command not found: agy` 后，顶部呈现红框错误卡「未能启动 Gemini」「宿主机返回：command not found: agy。可切到终端查看详细输出，或重试启动。」+「切到终端查看 / 重试启动」，3 张启动卡片恢复可点。
   - **Gemini 对话与审批卡**（`09-Gemini对话与审批卡-390-纸面.png`）：顶栏标题为 `Gemini`、`已连接 · gemini-1`，气泡 `.who` 为 `GEMINI`，含 `read_file` / `run_shell_command` 工具标签，审批卡显示「工具请求确认 / gemini-1 在等你的输入」与 1/2/3/允许(y)/拒绝(n)/Enter/Esc 按钮，输入框占位「发消息给 Gemini，Enter 发送」且可发送。
   - **Gemini 降级终端摘要**（`10-Gemini降级终端摘要-390-纸面.png`）：`/chat` 返回 `fallback: 'pane'` 时顶部显示降级横幅与「看终端 ›」；在输入框发送「列出当前仓库最近 5 条提交」后校验命中 `POST /agents/prompt { target: 'gemini-1', text: '列出当前仓库最近 5 条提交' }`，页面同时展示用户消息气泡与 `GEMINI · 终端摘要` 卡片（含提交日志）。
   - **顶栏 `＋` 全模式与「新建对话」Sheet**（`11-顶栏新建对话sheet-390-纸面.png`、`12-顶栏新建对话sheet-430-碳黑.png`）：
     - 空终端（标题 `终端`）、DSH（标题 `DSH`）、Gemini（标题 `Gemini`）、Claude（标题 `Claude`，`.who=CLAUDE`）四个模式下 `#resetBtn` 均可见。
     - 点 `＋` 弹出 `.agsheet`「新建对话」，副标题 `当前：gemini-1 · D:\Vibe\PWA\pwa`，5 个选项齐全；按 `Escape` 与点击遮罩均可正常关闭。
     - 点「新开 Gemini 对话（同目录）」→ `POST /agents/tab/create` 请求体 `{"cwd":"D:\\Vibe\\PWA\\pwa","startKind":"agy"}`。
     - 点红字「结束当前对话并重选」：Gemini 模式下发 `POST /agents/send` `{"pane":"w1:p6","text":"/exit","enter":true}`；DSH 模式下发 `POST /agents/dsh/close` `{"pane":"w1:p6"}`。

---

## 3. 发现的缺陷与观察（建议先修 P2 再交付用户）

### 缺陷 #1（P2 · 建议修复）：`agents/ui.html` 默认 `chat` 视图首次打开白屏 ~2 秒

- **复现步骤**：打开 `/agents/?embed=1&pane=w1:p6`（`localStorage['agents.view']` 为空或 `'chat'`，且已有有效 `bridge_token`）。
- **实测观测**：刷新后 `#chat` 持续约 **2.08 秒**完全空白、顶栏停在红点 `connecting…`（实测 `launcher390.firstPaintMs = 2085ms`，`geminiChatAndSheet390.firstPaintMs = 2089ms`），直到 2 秒轮询定时器首次触发才渲染出启动页或对话流。
- **代码定位**：`agents/ui.html:1268-1274` 中 `boot()` 在 `pane === null` 时先同步调用 `renderView()` → `chatTick()` 因 `!pane` 直接返回；随后异步 `load()`（`agents/ui.html:534-556`）解析到 `pane` 后，仅在 `viewMode === 'term'` 分支调用了 `renderView()`，当 `viewMode === 'chat'` 时**遗漏了立即调用 `chatTick()`**。
- **建议修复**：在 `load()` 首次确定 `pane` 后（或 `boot()` 的 `load().then(...)` 中），当 `viewMode === 'chat'` 时立即调用 `chatTick()`（非 `chat` 时调用 `tick()`），可把首绘耗时从 ~2085ms 降到 <100ms。

### 缺陷 #2（P2 · 建议修复）：`agents/ui.html` 在 `chat` 视图的阻塞审批态同时渲染两套审批控件

- **复现步骤**：Gemini/Claude 处于 `agent_status: 'blocked'` 且处于「对话」视图（见 `09-Gemini对话与审批卡-390-纸面.png`）。
- **实测观测**：对话流内已由 `appendApprovalCard()` 渲染了「工具请求确认」卡片，同时底部 `#blockedBar.on`（「● agent 在等你」含另一套 `1 2 3 y n Enter Esc`）也一起常驻展开，两份重复审批 UI 占据约 75% 视口高度，把上方 Gemini 的回复正文与 `GEMINI` 标签挤出首屏（对照设计稿 ③，对话视图只应展示单一审批卡）。
- **代码定位**：`agents/ui.html:608-613` 的 `renderBlocked()` 未判断 `viewMode === 'chat'`，无论对话还是终端视图都会给 `#blockedBar` 挂上 `.on`。
- **建议修复**：`const blocked = viewMode !== 'chat' && a && a.agent_status === 'blocked';`（或在 `renderView()` 切换视图时同步 `renderBlocked()`），让 `#blockedBar` 仅在「终端」视图显示、「对话」视图只保留聊天流内的审批卡。

### 其他非阻塞观察（Informational）

1. **Preview 浮标遮挡（仅预览环境）**：`03`、`04` 截图中左下角 `← 测试环境`（`z-index: 9999`）遮住了底部 sheet 第 4 项「仅打开纯终端」左侧的 `>_` 图标；该浮标仅由 `deploy-preview.ps1` 注入，正式产物不含。
2. **`html.kb-open` 内联样式优先级**：`index.html:4452` `fitOverlay()` 给 `.termoverlay` 写了内联 `height: 100%`，会压过 `index.html:1011` 的 `html.kb-open .termoverlay{height:var(--vvh)}`；实际视口随键盘收窄时 `fitOverlay()` 会按 `visualViewport.height` 重算各子元素高度且无重叠（520px 已测过），不影响真机，但若依赖纯 CSS 类测试需知悉此行为。

---

## 4. 证据清单（均位于本目录，已逐张人工目视核查）

- `00-真实部署产物-390x844-配对页.png`（123,619 B）
- `01-终端Tab-390-纸面.png`（104,671 B）
- `02-终端Tab-430-碳黑.png`（109,041 B）
- `03-新建终端启动方式sheet-390-纸面.png`（253,329 B）
- `04-新建终端启动方式sheet-430-碳黑.png`（276,265 B）
- `05-空终端启动页-390-纸面.png`（180,518 B）
- `06-空终端启动页-430-碳黑.png`（182,978 B）
- `07-启动中态-390-纸面.png`（148,722 B）
- `08-启动失败卡-390-纸面.png`（238,005 B）
- `09-Gemini对话与审批卡-390-纸面.png`（203,423 B）
- `10-Gemini降级终端摘要-390-纸面.png`（164,633 B）
- `11-顶栏新建对话sheet-390-纸面.png`（248,809 B）
- `12-顶栏新建对话sheet-430-碳黑.png`（291,078 B）

---

## 5. 复验（`2b6921a`）

针对上述 2 个 P2 缺陷（`agents/ui.html` commit `2b6921a`，未改动任何业务文件、未触碰生产端口 `18888`，本地隔离 mock bridge `127.0.0.1:18894`，390×844 / DPR=3 / Paper）：

| 编号 | 复验项 | 性质 | 结论 | 证据 | 实测观测 |
|---|---|---|---|---|---|
| R1 | 默认 `chat` 视图首屏绘制耗时（空启动页 / Gemini 对话） | **模拟** | **PASS** | `reverify-2b6921a.json` | 空终端启动页首绘 **84 ms**（原 2085 ms），Gemini 阻塞对话首绘 **44 ms**（原 2089 ms），无 2 秒白屏等待 |
| R2 | Gemini `blocked` 态 `chat` 视图单一审批卡（无重复 `#blockedBar`） | **模拟** | **PASS** | `09b-Gemini对话与审批卡-修复后-390-纸面.png`（199,796 B） | 仅 1 张 `#chat .card`（`工具请求确认` / `gemini-1 在等你的输入`），`#blockedBar` 无 `.on`（`display:none`）；用户气泡、`GEMINI` 标签、回复正文与审批卡同屏清晰可见 |
| R3 | 同一 `blocked` 态切到 `term` 视图展示 `#blockedBar.on`，切回 `chat` 自动隐藏 | **模拟** | **PASS** | `09c-Gemini终端态blockedBar-390-纸面.png`（139,949 B） | 切「终端」后 `#blockedBar.on` 正常显示（`gemini-1 · w1:p6` + 7 个快捷按键），终端输出区与快捷键条排版整齐；再切回「对话」后 `#blockedBar` 立刻隐藏，全程 0 console/page error、0 横向溢出 |

**复验结论**：2 个 P2 缺陷全部闭环（**3/3 PASS，0 FAIL**）。
