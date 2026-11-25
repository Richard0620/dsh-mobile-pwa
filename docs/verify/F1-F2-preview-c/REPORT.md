# F1 / F2 修订版（C 轮）独立验收报告

- 被测：`https://dsh.easymana.online:8443/preview/f1f2c/`
- 分支 / commit：`feature/f1-f2-steps-voice` / `9fd848d`（`fix(session): 语音/朗读改线性图标 + 松手不自动发送（留输入框待编辑）`）
- 部署戳：`dsh-preview-f1f2c-v249`（预览 SW 缓存名，浏览器 `caches.keys()` 实测一致）
- 本地代码：`D:\Vibe\PWA\pwa-j\index.html`（v249）
- 验收时间：2026-11-25（America/Los_Angeles）
- 结论：**12 个验收项 11 PASS / 1 FAIL；31 条机器断言 30 PASS / 1 FAIL；必须修的项 1 个（朗读按钮空闲态点击宽度比旧版小 1.95px）。**
- 截图：14 张，见 §9。

> 边界：没有使用真 iPhone / Safari / WebKit。环境是 **Chrome for Testing 157.0.8103.80 + CDP 模拟**（390×844 / 430×932、DPR 3、Touch、iPhone UA、安全区 47/34、纸面 + 碳黑）。页面、SW、manifest、图标是真实部署产物；宿主 API / SSE / `SpeechRecognition` 是打桩。iOS 键盘、原生语音权限、真实扬声器见 §8。

---

## 0. 总表

| # | 验收项 | 结论 | 证据 | 备注 |
|---|---|---|---|---|
| A | 真实首次打开 / 部署产物 | **PASS** | `01`、`02` | 4/4 响应 200，0 error、0 warning；FCP 1132ms、配对页 1526ms；SW 缓存名即部署戳 |
| 1 | 麦克风按钮真实渲染为 SVG，不是 emoji | **PASS** | `03` | `.mic` 内是 `<svg>`（rect+2 path），`innerText=''`、`textContent=''`；无 `🎙` |
| 2 | 麦克风 SVG 颜色跟随 `currentColor`（纸面/碳黑/录音反色） | **PASS** | `03`、`04`、`11`、`12` | 纸面字色/描边 `rgb(26,26,22)`；碳黑 `rgb(234,232,223)`；录音中纸面 `rgb(255,255,255)`、碳黑 `rgb(11,12,14)`，背景分别黑/荧光绿 |
| 3 | 朗读按钮改线性 speaker 图标 + 文字；朗读中方形 + 停止朗读；无 emoji | **PASS** | `08`、`09`、`13` | `speakBtnHtml(on)` 输出 `<span class="ic"><svg>…</svg></span><span class="lb">朗读/停止朗读</span>`；无 `🔊/■/🎙` |
| 4 | 朗读按钮点击区域不小于旧版 | **FAIL** | `08` | 旧版（f1f2b 07e0bbd，同视口）`57.95×22.64`；新版 `56×23`，宽度 −1.95px、面积约 −1.8%（详见 §5） |
| 5 | 松手不自动发送：消息数不变、文字留在输入框 | **PASS** | `05` | 按住 380ms 松手 900ms：`sent=0`、`.msg` 2→2、输入框仍「帮我读一下 a.js」 |
| 6 | 松手后焦点在输入框、光标在末尾 | **PASS** | `05` | `activeElement===.ta`；selection 容器是 `.ta`、offset=childNodes.length=1；`execCommand('insertText','X')` 追加到末尾（`...a.jsX`） |
| 7 | 文字可直接编辑，改一个字后按 ↑ 能发出 | **PASS** | `06` | 追加「改」→ send `disabled=false`/opacity 1 → 触摸 ↑ → `/session/send` 文本 `帮我读一下 a.js改`，输入框清空，`.msg` 2→3 |
| 8 | 上滑取消不发送、输入框还原 | **PASS** | `07` | 上移 70px 提示「松开取消」；松手 sent 1→1、input 空、`.mic.on=false` |
| 9 | 文案：浮层「松开结束 · 上滑取消」、title「松开结束，上滑取消」 | **PASS** | `04` | 两处实测完全一致；不动时 title 仍是「按住说话」 |
| 10 | 回归：空输入 ↑ 半透明不可点、有文字 ↑ 可点 | **PASS** | `03`、`05`、`06` | 空态 disabled、opacity .35、pointer-events none、`send off`；有文字/编辑后恢复 |
| 11 | 回归：hold 关闭时按住静默；朗读开始/停止 | **PASS** | `10`、`09` | hold=0：SVG 仍在、title 关闭、recog 0、无浮层/toast；朗读按钮状态切换正确 |
| 12 | 两套皮肤 / 430×932 | **PASS** | `11`、`12`、`13`、`14` | 碳黑 mic/speaker 颜色正确；430 下 mic 仍 34×34、SVG 正常 |

**计数：PASS 11 / FAIL 1。**

---

## 1. 被测对象与产物一致性

预览 HTML 与本地 `index.html` 字符级比较（剥离 4 处 preview 标记 + 2 个注入 LF）：

| 项 | 值 |
|---|---|
| 本地 `index.html` SHA-256 | `a8a1b867377a5c985314fb3a74aad681ff223844a1469a94335c66ed8a6281ec` |
| 部署文件原始 SHA-256（含标记） | `36ff3a16b32e06e18a3415d7614b64d5ca175318aa9b0cd2acb03d7f5900b6cb` |
| 部署 / 本地大小 | 326249 / 325860 字符（+389） |
| 剥离后比较 | `equal: true`，长度 325860 == 325860，SHA 相同 |
| 部署响应 | `HTTP 200`，`Content-Length: 358583` |
| 部署戳 | 预览 `sw.js` 第 10 行 `CACHE = 'dsh-preview-f1f2c-v249'`；页面 `caches.keys() = ['dsh-preview-f1f2c-v249']` |

被剥离的 4 处：

1. `<script>window.__DSH_PREVIEW__={branch:'feature/f1-f2-steps-voice',slug:'f1f2c'};</script>`
2. `<title>AI-HUB · 预览 · feature/f1-f2-steps-voice</title>`
3. `<meta name="apple-mobile-web-app-title" content="DSH f1-f2-st">`
4. 末尾悬浮的 `<a href="../">← 测试环境</a>`（不是产品 UI；截图用预加载样式隐藏）

工作区：`git status --porcelain` 只有 `?? docs/verify/`；`index.html` / `sw.js` / 版本号 / 台账均未改动。未 push、未部署、未安装依赖。

---

## 2. 测试环境

| 项 | 值 |
|---|---|
| 引擎 | Chrome for Testing **157.0.8103.80**，`--headless=new`，独立 `--user-data-dir` |
| 视口 | 390×844、430×932，DPR 3，`mobile:true` |
| UA | iPhone 17.5 Safari UA |
| 触摸 | `Input.dispatchTouchEvent`；真实触摸按住/滑动手势 |
| 安全区 | `setSafeAreaInsetsOverride{top:47,bottom:34}`，实测 47/34 |
| 网络 | A 组真实 HTTPS、无注入；B 组真实页面 + 预加载打桩宿主 |
| 隔离 | 独立 Chrome profile + 独立调试端口（9672/9673/9674/9675），不与其它验证进程共享页面 |
| 打桩 | 宿主 sessions/messages/SSE/send；`SpeechRecognition` mock 带构造计数；`speechSynthesis` 用 Chrome 原生（无音频输出） |

B 组用 `#token=fake-token-f1f2c&inst=fake-instance-f1f2c` 进入（只写 localStorage，不用手机凭据）。

---

## 3. 麦克风 SVG

证据：`03-纸面-空输入-麦克风SVG.png`、`04-纸面-录音中-反色SVG.png`、`11-碳黑-空输入-麦克风SVG.png`、`12-碳黑-录音中-反色SVG.png`

- `.mic` 的 DOM：
  `<svg viewBox="0 0 24 24"><rect x="9" y="3.2" width="6" height="9.6" rx="3"></rect><path d="M5.5 11.2a6.5 6.5 0 0 0 13 0"></path><path d="M12 17.7v2.6"></path></svg>`
  3 个图形（rect + 2 path），`innerText` 与 `textContent` 都是空；没有 `🎙`。
- 尺寸：34×34 按钮，SVG 17×17；`fill:none`、`stroke:currentColor`、`stroke-width:1.8`。
- 纸面：`.mic color=rgb(26,26,22)`，SVG stroke 相同；背景 `rgb(236,234,226)`。
- 碳黑：`.mic color=rgb(234,232,223)`，SVG stroke 相同。
- 录音中 `.mic.on`：
  - 纸面：color/stroke `rgb(255,255,255)`，背景 `rgb(26,26,22)`；
  - 碳黑：color/stroke `rgb(11,12,14)`，背景 `rgb(198,240,78)`。
  - 即图标跟着 `--accent-fg` 反色，符合「on 态反色」。
- 430×932 下仍是 34×34、SVG 17×17。

---

## 4. 朗读按钮图标

证据：`08-纸面-朗读按钮SVG.png`、`09-纸面-朗读中-方形图标.png`、`13-碳黑-朗读中.png`

- 空闲：
  `<button data-speak-mid><span class="ic"><svg viewBox="0 0 24 24"> speaker 3 条 path </svg></span><span class="lb">朗读</span></button>`
  `innerText='朗读'`、`textContent='朗读'`；无 `🔊` / `■` / `🎙`。
- 朗读中：`<span class="ic"><svg><rect x="8" y="8" width="8" height="8" rx="1.6"></rect></svg></span><span class="lb">停止朗读</span>`；底部条「正在朗读 · 第 1/2 段 / 停止」。
- 停止后：回到 speaker 图标 + 「朗读」。
- 内联按钮的 SVG 是 13×13、`stroke:currentColor`、`fill:none`；纸面颜色 `rgb(140,138,127)`，碳黑 `rgb(110,114,108)`，与按钮文字同色。
- 状态切换只重写 `innerHTML`（`syncSpeakButtons`），没有残留旧 emoji。

---

## 5. FAIL 明细：朗读按钮空闲态点击区域比旧版小

**结论：FAIL（仅空闲态「朗读」按钮）。**

**对比方法：** 旧版仍在线：`https://dsh.easymana.online:8443/preview/f1f2b/`（commit `07e0bbd`）。用同一 Chrome 157、390×844、DPR 3、iPhone UA、同一套 stub 打开同一个会话，测量 `[data-speak-mid]` 的 `getBoundingClientRect()`：

| 版本 | 文案 | 宽 | 高 | 面积 |
|---|---|---|---|---|
| 旧版 f1f2b `07e0bbd` | `🔊 朗读` | **57.95px** | 22.64px | 1312.2px² |
| 新版 f1f2c `9fd848d` | `<svg speaker> 朗读` | **56.00px** | 23.00px | 1288.0px² |
| 差 | — | **−1.95px（−3.4%）** | +0.36px | **−24.2px²（约 −1.8%）** |

点击区域（按钮盒）宽度变小，不满足「点击区域不小于原来」。

**相关代码：**

| 位置 | 事实 |
|---|---|
| `index.html:5073-5075` | `speakBtnHtml(on)` 生成 `<span class="ic">svg</span><span class="lb">文字</span>` |
| `index.html:284` | `.mact button{padding:5px 8px; gap:4px}`（与旧版相同） |
| `index.html:761-762` | `.mact button .ic svg{width:13px;height:13px}` |

旧版是 emoji `🔊`（约 14px + 空格）直接作文本；新版换成 13px SVG + 4px gap，视觉更整齐，但空闲态按钮净宽少了约 2px。朗读中「停止朗读」是 79×23，比旧版还宽，只有空闲态受影响。

**复现：**

1. 打开 `f1f2b` 和 `f1f2c` 的同一会话（各用独立 profile）。
2. 等助手消息出现，取 `.mact [data-speak-mid]` 的 bounding rect。
3. 旧 `57.95×22.64`，新 `56×23`。

**修复建议：** 给 `[data-speak-mid]` 加 `min-width:58px`（或把 `.mact button` 横向 padding 从 8px 调到 9px，只对朗读按钮生效），再复测 390/430 和纸面/碳黑；「停止朗读」不应被压窄。

**影响：** 约 2px，属于可点性/规范问题，不影响图标与文字正确性；但这是任务明确写的验收标准，因此判 FAIL，不降级。

---

## 6. 松手不自动发送（本轮重点）

证据：`05-松手-留在输入框.png`、`06-编辑后发送.png`、`07-上滑取消.png`

用真实触摸：按下 `.mic` 中心 → 等 380ms（识别 mock 在 120ms 回 interim）→ `touchEnd`，再等 900ms：

| 检查 | 实测 |
|---|---|
| 语音浮层 | `.voice display:flex`、`.mic.on=true`、识别器构造 1 次 |
| interim 文本 | 输入框「帮我读一下 a.js」 |
| 松手后 `/session/send` | **0**（`__T.sent.length=0`） |
| 松手后消息数 | **2 → 2**（没有新增用户气泡） |
| 松手后输入框 | 仍是「帮我读一下 a.js」 |
| 焦点 | `document.activeElement === .ta` |
| 光标 | selection 容器是 `.ta`，offset=1，`childNodes.length=1`（一个文本节点，offset=1 即末尾）；再用 `execCommand('insertText','X')` 验证，文本变成「帮我读一下 a.jsX」 |

由此确认：

- `finishVoice()` 去掉了自动 `send()`；即使参数还叫 `doSend`，函数体内没有发送调用。
- 文本留在输入框，`ta.focus()` + `caretToEnd()` 在松手后执行。
- Chrome 模拟里 focus 成立；真实 iOS 键盘是否弹出见 §8。

### 6.1 编辑后发送

- 在「帮我读一下 a.js」末尾追加「改」，派发 `input` 事件：send 从 `.35` 恢复 `opacity=1`、`disabled=false`。
- 触摸点击 ↑：`/session/send` 记录 1 条，文本 `帮我读一下 a.js改`，输入框清空，消息数 2→3。
- 说明「文字可以直接编辑，改一个字再按 ↑ 能正常发出去」。

### 6.2 上滑取消

- 清空输入 → 按住 → 上移 70px：浮层提示「松开取消」，输入框是 interim 文本。
- 松手：`sent` 仍为 1（发送前那条），输入框还原为空，`.mic.on=false`。
- 取消路径不发送、不残留。

### 6.3 文案

- 录音中浮层：`松开结束 · 上滑取消`（不是「松开发送」）。
- 录音中 mic title：`松开结束，上滑取消`（逗号，不是「松开发送」）。
- 空闲 title 仍是 `按住说话`；hold 关闭时是「按住说话已在设置里关闭」。

---

## 7. 回归

| 回归点 | 结果 | 数据 |
|---|---|---|
| 空输入 ↑ 半透明不可点 | PASS | disabled、opacity .35、pointer-events none、class `send off`、34×34 |
| 有文字 ↑ 可点 | PASS | 编辑后 disabled=false、opacity 1；发送成功 |
| hold 关闭按住静默 | PASS | 重载后 mic SVG 仍在、title 关闭；按住 450ms：recog 0、无 `.mic.on`、无浮层、无 toast |
| 朗读开始/停止 | PASS | 「朗读」↔「停止朗读」、speaker↔square、bar 第 1/2 段；无 emoji |
| 纸面 / 碳黑 | PASS | mic currentColor、on 反色、speaker 颜色均正确 |
| 430×932 | PASS | mic 34×34、SVG 17×17、位置正常 |

流程内 **0 console error、0 network failed、0 stub exception**。

---

## 8. 真实 vs 模拟 / 真机才能验

| 项目 | 真实 / 模拟 | 说明 |
|---|---|---|
| 预览页面、manifest、icon、sw.js | **真实** | 真实 HTTPS；4/4 200 |
| 部署产物与本地 commit | **真实** | 剥离标记后 SHA 相同；SW 缓存名即部署戳 |
| 宿主 API / SSE / send | **模拟** | 预加载 fetch + ReadableStream；未用真实凭据 |
| `SpeechRecognition` | **模拟** | 构造计数 + interim 文本；只验证 UI/发送链路 |
| `speechSynthesis` | **部分真实** | Chrome 原生 API，无音频输出 |
| 视口/DPR/UA/触摸/安全区 | **模拟** | CDP |
| 纸面/碳黑 | **真实渲染** | 产品 CSS/data-skin + 真实像素 |

**真机才能验的三条：**

1. **iOS 键盘与焦点**：松手后 `ta.focus()` 在 Chrome 里 activeElement 成立，但 iOS 是否真的弹起键盘、键盘动画/安全区、中文输入法 composition 与光标位置，只能在真机验证；本轮只证明了程序化 focus + 文本节点末尾。
2. **SVG 的 Safari 渲染与点击手感**：`currentColor`、17px/13px SVG 的像素对齐、碳黑下对比度，以及 2px 点击宽差在 iPhone 上是否可感知；emoji 与 SVG 的基线差异（本轮 FAIL 的 1.95px 就是字体度量差异）需要真机复核。
3. **真实语音权限与出声**：Safari 首次麦克风授权、系统听写、真实识别结果；speaker 是否真的出声、中文语音包、自动朗读的手势解锁；`SpeechRecognition` mock 不代表真机。

---

## 9. 截图索引（14 张）

| 文件 | 内容 |
|---|---|
| `01-真实首次打开-390x844-配对页.png` | 真实网络首次打开，390×844 |
| `02-真实首次打开-430x932-配对页.png` | 真实网络首次打开，430×932 |
| `03-纸面-空输入-麦克风SVG.png` | 纸面空态 mic 线性图标、↑ 半透明 |
| `04-纸面-录音中-反色SVG.png` | 录音中 mic 白图标黑底、浮层「松开结束」 |
| `05-松手-留在输入框.png` | 松手后输入框保留识别文字 |
| `06-编辑后发送.png` | 追加「改」后发送成功的用户气泡 |
| `07-上滑取消.png` | 上滑提示「松开取消」 |
| `08-纸面-朗读按钮SVG.png` | speaker 图标 + 朗读 |
| `09-纸面-朗读中-方形图标.png` | 方形图标 + 停止朗读 + 朗读条 |
| `10-设置关闭-麦克风SVG仍在-按住静默.png` | hold=0 时 SVG 仍在、按住静默 |
| `11-碳黑-空输入-麦克风SVG.png` | 碳黑 mic currentColor |
| `12-碳黑-录音中-反色SVG.png` | 碳黑 on 态反色（深图标 + 荧光绿底） |
| `13-碳黑-朗读中.png` | 碳黑朗读中 |
| `14-430x932-纸面-麦克风SVG.png` | 430×932 mic SVG |

---

## 10. 最终结论

- 改动 1（mic 线性 SVG）正确：真实 `<svg>`、无 emoji、`currentColor` 在纸面/碳黑/录音反色下都正确。
- **残留 emoji 检查（仅麦克风 / 朗读按钮）：0**。`.mic` 与 `[data-speak-mid]` 的 `innerHTML` 都只有 `<svg>` + 文本，未出现 `🎙` / `🔊` / `■`；朗读中方形图标也是 SVG。页面其它位置的 emoji（工具图标、审批等）不在本次改动范围。
- 改动 2（朗读按钮线性图标）功能和样式正确，但**空闲态点击宽度从 57.95px 降到 56px**，违反「点击区域不小于原来」，**FAIL**；建议加 `min-width:58px` 或加横向 padding。
- 改动 3（松手不自动发送）正确：0 发送、2→2 消息、文本留在输入框、focus 成立、光标在末尾；编辑后 ↑ 能发；上滑取消正常；文案已改成「松开结束」。
- 回归全部通过：空/有文字发送态、hold 关闭静默、朗读开始/停止、纸面/碳黑、430×932。
- **必须修的项：1 个** —— 朗读按钮空闲态点击区域 ≥ 旧版。
