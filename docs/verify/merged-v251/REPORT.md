# release/v251 合并产物冒烟验证

- 预览：`https://dsh.easymana.online:8443/preview/merged/`
- 分支 / merge commit：`release/v251 / 1b3df0f1346e11d67b56fbf6abb6342ad24a681d`
- 合并顺序：F8（缓存）→ F1/F2（过程进度 + 语音）→ F3/F4/F5（子代理 + 停止交代 + 定时任务）
- 代码：`D:\Vibe\PWA\pwa\index.html`（工作树即发布分支）
- 验收时间：2026-11-25（America/Los_Angeles）
- 结论：**7 个主项 6 PASS / 1 FAIL；无版本/全局链路问题；真机专属 3 项 UNVERIFIED**
- **语义损失判断：有 1 个确定的语义损失（冲突 2 的子代理返回滚动恢复）；另有 1 个展示层重叠（自动朗读会顶掉「已完成」条的 3 秒淡出），功能本身都触发**

> 边界：**没有用真 iPhone/Safari/WebKit**。iPhone 环境是 Chrome for Testing 157 + CDP 模拟（390×844 / 430×932、DPR 3、Touch、iPhone UA、安全区 47/34）。页面/静态资源/SW 走真实 HTTPS；宿主 API/SSE 打桩；未使用用户手机凭据，未改业务代码，未 push/部署。

---

## 0. 总表

| # | 项 | 结论 | 证据 | 备注 |
|---|---|---|---|---|
| 1 | **冲突 1：中断按钮**（confirm → stop → 进度收尾 + 交代卡） | **PASS** | `01`、`02`、`03`、`04` | 成功：卡片出现、进度条清空、summary turn=7；取消：无 POST/无卡/进度保留；失败：只 toast、无卡、进度保留 |
| 2 | **冲突 2：会话首次绘制**（进入/子代理返回/别的页返回） | **FAIL（滚动恢复）** | `05`、`06`、`12` | 三条路径都立即有内容，进度条也正常；但**从子代理返回后父会话跳到最底部**，不是进入前位置 |
| 3 | **冲突 3：turn/start 合并体** | **PASS** | `07`、`15` | 新轮立即变「已跑 0 步」；连续停止请求的 turn 从 7→8，卡片是这一轮 |
| 4 | **冲突 4：turn/end 合并体** | **PASS（含展示层重叠）** | `08`、`14` | 已完成 3 步 + fade/clear、子代理 1→2、auto-read 触发；auto-read 时「已完成」条被朗读条顶掉 |
| 5 | **F8 缓存 × F1/F2/F3** | **PASS** | `13` | 删 legacy + 3s 延迟，40 条仍从 IDB 出；无旧子代理/进度；退登重登无旧内容 |
| 6 | **版本戳** | **PASS** | 静态 + preview SW | `APP_VERSION=v251`、`sw.js CACHE=dsh-mobile-v252`、preview SW=`dsh-preview-merged-v251` |
| 7 | **全局链路**（390 纸面 / 430 碳黑） | **PASS** | 390 纸面 3 张 + 430 碳黑 3 张（见 §6） | 发消息→进度→停止→交代卡→子代理→返回，两套尺寸/皮肤，0 console error / 0 network failed |
| 0 | 真实部署产物加载 | **PASS** | `00` | 真实 HTTPS；0 error/0 404；TTFB 599ms、FCP 1048ms、配对页 1465ms |
| D1 | iOS Safari 低存储/隐私模式 | **UNVERIFIED** | — | 未真机 |
| D2 | 切后台 10 分钟回来 | **UNVERIFIED** | — | 只模拟延迟/reload |
| D3 | 大库/真实语音权限 | **UNVERIFIED** | — | 见 §7 |

**主项：PASS 6 / FAIL 1。真机专属：UNVERIFIED 3。**

---

## 1. 产物与版本

| 项 | 值 |
|---|---|
| 本地 `index.html` SHA-256（原始） | `34EA00512E6E20D8B4C4F923CB05163AF60C170029BC0162F79865454BA20909` |
| 部署文件 SHA-256（含预览标记） | `B7DF0903CB239239FF80B55273D5D772A6710487296961C691099754B26972E1` |
| 剥离 4 处预览标记后 | `equal: true`，长度 412775；规范化 SHA-256 `b7328c26663767e013b1622538a9142e07032d725784b25afde41ac3ec7fd7ea` |
| HEAD | `1b3df0f1346e11d67b56fbf6abb6342ad24a681d` |
| `APP_VERSION` | **v251**（`index.html:1024`） |
| 本地 `sw.js` CACHE | **dsh-mobile-v252**（`sw.js:9`） |
| preview `/merged/sw.js` CACHE | **dsh-preview-merged-v251**（preview 构建单独替换，只清 `dsh-preview-*`） |

工作区：本次只新增 `docs/verify/merged-v251/`；另有既有未跟踪的 `lan-*.vbs`/`lan-*.ps1`（非本次产物）。业务文件未改。

---

## 2. 冲突 1：中断按钮 — PASS

证据：`01-停止成功-进度收尾与交代卡.png`、`02-停止交代卡-展开.png`、`03-停止确认取消-什么都不发生.png`、`04-停止失败-只toast不画卡.png`

### 成功

- `turn/start turn=7` + 2 步 + phase 2/7，进度条「第 2/7 步 步骤 2 0s」。
- 点 `.stop`，confirm 接受：
  - POST `/session/stop` **1 次**；
  - `paintProg` 把进度 row 清空（`progText=''`、`progRow=false`）——停止不是完成，不显示「已完成」，由 F4 卡承载结果；
  - `/session/stop-summary?turn=7` **1 次**；
  - `.stopline` 出现「这一轮被停止 · 0s · 做了什么 2 · 没做完 2」；
  - 展开 `.stopc` 四段齐全：做了什么 2 / 看到了什么 1 / 没做完 2 / 对外发出 2；按钮「照这个继续」「收起」。
- F1 进度收尾与 F4 卡**同时正确**：进度不再显示运行中，卡出现。

### 取消

- 确认框拒绝：`stopRequests` 不增加（1→1），无 `.stopline`，进度条仍是「第 2/4 步 步骤 2」，无 toast。

### 失败

- `/session/stop` 返回 500：toast「取消失败：mock stop failure」，**没有** `.stopline`，运行进度仍在（`progRow=true`）；`stopRequests` 增加但无卡。
- 结论：confirm → POST → markBusy/paint → summary 的顺序与失败分支都正确。

> 备注：失败文案是「取消失败」而不是「停止失败」，语义略歧义，但不是功能错误。

---

## 3. 冲突 2：会话首次绘制 — FAIL（仅滚动恢复）

证据：`05-首绘-进会话立即有内容.png`、`06-首绘-返回会话进度条.png`、`12-首绘-返回后滚动位置丢失.png`

### PASS 的部分

- 进入 60 条会话：80ms 时 `.msg=60`，立即有内容，不是空白骨架。
- 从子代理只读页返回：100ms 内 `.msg=60`（`backAt=2323.9ms`，100ms 采样已有 60 条）；内容立即恢复。
- 从设置/列表再进同一会话：120ms 内 `.msg=60`。
- 运行中进度条正常：「第 2/7 步 读取 b 0s」。
- 无 console error。

### FAIL：滚动位置没有恢复

复现：

1. 60 条消息，父会话 `main.scrollTop=2395`（`max=4791`，不是底部）。
2. 点 `.subbar` 打开子代理 sheet；等待 500ms 让 sheet 目录刷新完成。
3. **在点进子代理之前**，父会话 `scrollTop` 已经变成 **4791（最底部）**（`preOpenTop={top:4791,max:4791}`）——说明打开 sheet/目录刷新把父会话滚到底了。
4. 点一行子代理 → 只读页 → 点「返回会话」。
5. 返回后采样：20ms `top=0`（空壳），60ms 起 `top=4791`（底部）；600ms 仍 4791。期望是 2395（容差 ≤24px）。

**期望**：返回父会话后 `scrollTop` 保持 2395±24；**实际**：2395 → 打开 sheet 后 4791 → 返回仍 4791，偏移 2396px。

**疑似原因**：

- `openSubagentsSheet()`（`index.html:7559`）打开时强制 `loadSubagents(force)`（`7588`）。
- `loadSubagents()` 拿到结果后，如果目录签名变了就调 `paintSession()`（`7490`）。`paintSession` 默认滚动模式会重建 feed；其末尾 `if (scroll === 'bottom' || (scroll !== 'none' && atBottom))`（`5952-5957`）在空壳/重排瞬间可能把 `ui.body.scrollTop` 拉到底。
- `openSubagentView()` 在**这之后**才读 `ui.body.scrollTop` 存 `state.sessionRestore`（`7631-7637`），所以存进去的已经是 4791，不是用户原来的 2395；`finishInitialPaint`（`6680-6703`）只是忠实恢复了错误值。
- 另一种时序（不等 500ms）下，先恢复 2395，随后 late `paintSession` 又把它拉到底；结果相同。

**影响**：用户从子代理返回父会话，阅读位置丢失，直接落到最新消息；与 F3「返回恢复滚动」的设计目标相反。这是本轮唯一的确定性语义损失。

**修复建议**：

- 打开 subagent sheet 前就快照父会话 `scrollTop/atBottom`，并且 `loadSubagents` 在 sheet 打开期间重画父会话时使用 `paintSession({scroll:'none'})` 并显式恢复 `scrollTop`。
- 或让 `paintSession` 在 `state.view==='session' && subagentSheet` 时保留当前 `scrollTop`，不要按 `atBottom` 自动贴底。
- 回归用例按本报告步骤（60 条、top 2395、等待 sheet 刷新、返回）验证 0px 漂移。

---

## 4. 冲突 3：turn/start 合并体 — PASS

证据：`07-turn-start-新轮已跑0步.png`、`15-二次停止-本轮交代.png`

- 上一轮 phase 2/7、进度「第 2/7 步」。
- push `turn/start turn=8` 后 80ms：标签立即变 **「已跑 0 步」**，文案「深度求索中…」，旧 phase 不再显示；`stopBtn` 仍为 `grid`。
- 连续两次停止：第一次 summary `turn=7`，第二次（新轮 8）summary `turn=8`；打开新轮时旧 `.stopline` 被清掉（`count=0`），新停止后只有一张卡且内容是当前轮，不是上一轮。
- 说明 `beginTurn()` 清 steps/phase → 再写 `state.turn/turnStartedAt/stopSummary=null` 的顺序正确。

---

## 5. 冲突 4：turn/end 合并体 — PASS（含展示层重叠）

证据：`08-turn-end-已完成与子代理刷新.png`、`14-auto-read-turn-end.png`

### 自动朗读关闭

- 3 步 + phase total 3：
  - 进度收成「已完成 · 3 步 · 0s」；
  - 2700ms 时 `class=streamline prog donefade`；
  - 再 1s 后清空、`.row=false`；
  - 子代理入口条从「1 个子代理」刷新为「2 个子代理」（`subagentCalls` 1→2），对应 `endTurn()` 后的 `loadSubagents(force)`。

### 自动朗读开启

- 新起一轮 9，`localStorage['dsh.speech.auto']='1'`，`turn/end` 后 1 秒内：
  - `.dock .prog .speak` 出现，文案「正在朗读 · 第 1/1 段」；
  - 消息操作条变「停止朗读」；
  - 说明 auto-read 标记在 `endTurn()` 里正常设置、`loadMessages` 后触发。

**展示层重叠（语义损失之一）**：auto-read 一启动，`paintProg` 的 mode 优先选择 `speak`，把「已完成 · N 步」条替换成朗读条；因此 auto-read 开启时，F1 的完成条 3 秒淡出不可见（`14` 截图里的 strip 是朗读条，不是已完成条）。两个功能都触发，但“同时看到”做不到。是否算 FAIL 取决于验收是否要求两种状态同屏；本报告按功能 PASS、展示层重叠记录。

---

## 6. 跨功能交叉

### F8 缓存 × F1/F2/F3 — PASS

证据：`13-缓存交叉-重登无旧内容.png`

- 40 条消息缓存；删掉 legacy `dsh.cache.list/msgs`，把 `/sessions`、`/messages`、`/subagents` 延迟 3 秒，reload：
  - 250ms 内 `.msg=40`，legacy 两键均为 null，说明来自 IDB；
  - `.subbar` 不存在（没有上一会话的子代理残留）；
  - 进度条最初显示「实时连接断开，重连中…」（F1 既有的 idle→断线文案，不是缓存串台），没有旧步骤/旧总数。
- 网络/流恢复后再 `turn/start`：进度「第 2/7 步 缓存轮步骤」，子代理条为当前会话的 2 个子代理。
- 退登 → 同页恢复链接登录新账号：body 无「旧账号」，列表全部新账号标题；打开新会话显示「新账号的新消息」。旧缓存内容没有残留。

### 版本戳 — PASS

- `APP_VERSION='v251'`（`index.html:1024`）。
- 本地 `sw.js CACHE='dsh-mobile-v252'`（`sw.js:9`）。
- preview `/merged/sw.js` `CACHE='dsh-preview-merged-v251'`，且注释说明只清 `dsh-preview-*`。
- 真实首开页面显示「版本 v251」。

### 全局链路 — PASS（390 纸面 / 430 碳黑）

证据：`10-全链路-390-纸面-进度.png`、`10-全链路-390-纸面-交代卡.png`、`10-全链路-390-纸面-子代理.png`、`11-全链路-430-碳黑-进度.png`、`11-全链路-430-碳黑-交代卡.png`、`11-全链路-430-碳黑-子代理.png`。

两条链路都完成「发消息 → 看进度 → 停止 → 看交代卡 → 进子代理 → 返回」：

- 390 纸面：`innerWidth=390`，`body bg=rgb(246,245,241)`；进度「第 2/7 步」；停止卡四段；子代理只读页有消息；返回父会话 `.msg>0`。
- 430 碳黑：`innerWidth=430`，`body bg=rgb(11,12,14)`；同样链路全通；子代理页深色正确。
- 两条链路 `errors(ctx.logs)=0`：0 console error、0 HTTP≥400、0 network failed。
- 发消息后 `.send` 正常、用户气泡出现、stopBtn 出现。

---

## 7. 真机才能验的清单（UNVERIFIED）

1. **iOS Safari IndexedDB 低存储/隐私模式**：配额、QuotaExceededError、系统逐出 `dsh-mobile`；本轮 Chrome 正常。
2. **切后台 10 分钟回来**：只模拟 reload + 3s 延迟；真实 iOS 杀 WebContent/清内存后 `memMsgs` 失效、`idbPrefetchMsg` 补画是否来得及未验证。
3. **真实语音权限/出声与自动朗读手势策略**：Chrome 的 `speechSynthesis` 状态切换通过；Safari 首次语音授权、系统听写、中文语音包、自动朗读是否被手势策略拦截未验证。

另：大库（30×400 条 / 数百 MB）首次 `getAll`/structured clone 的低端机耗时未测。

---

## 8. 真实 vs 模拟

| 项目 | 真实/模拟 | 说明 |
|---|---|---|
| 预览页面、manifest、icon、sw.js | **真实** | 真实 HTTPS；0 404/0 failed |
| 部署产物 vs 本地 commit | **真实** | 剥离 4 处预览标记后字节级相等 |
| 首次打开（00） | **真实** | 无 token、无注入 |
| `/api/mobile/v1/*` | **模拟** | 预加载 fetch 打桩（含 stop/stop-summary/subagents） |
| SSE | **模拟** | `ReadableStream` + 心跳 + 测试帧 |
| IndexedDB/localStorage | **真实浏览器 API** | 真写/真读，但运行在 Chrome，不是 Safari |
| 视口/DPR/UA/触摸/安全区 | **模拟** | CDP，不是 iPhone 硬件 |
| 3s 网络延迟 / stop 失败 | **模拟** | stub sleep / 500 |
| 子代理 / 停止交代 | **模拟** | mock 数据，未连真实宿主子代理 |

未做：使用用户手机凭据、连真实宿主、push/部署、装依赖、改业务文件。

---

## 9. 复现

1. 独立 Chrome：`--headless=new --remote-debugging-port=9510 --user-data-dir=%TEMP%\merged-verify\pstop --ignore-certificate-errors`。
2. CDP：390×844 / 430×932、DPR 3、Touch、iPhone UA、安全区 47/34。
3. 预加载 `stub.js`（fetch/SSE/IDB/stop/subagents），导航 `https://dsh.easymana.online:8443/preview/merged/#token=fake&inst=fake`。
4. 冲突 1：`turn/start turn=7` + steps/phase → 点 `.stop`，`Page.javascriptDialogOpening` 控制 accept true/false；再设 `__F8.setStopFail(true)` 重测 500。
5. 冲突 2：60 条会话 → `main.scrollTop=2395` → 打开 `.subbar` 等 500ms → 读 `preOpenTop` → 点 `.sli` → 返回 `.roview` → 点「返回会话」→ 采样 `scrollTop`。
6. 冲突 3/4：`turn/start` 重置、steps/phase、`turn/end`；`localStorage['dsh.speech.auto']='1'` 测自动朗读；`__F8.setSubagents` 改目录测 1→2。
7. 交叉：删 legacy + `__F8.setDelay(3000)` reload，读缓存；退登→同页重登新账号。
8. 全局：发消息 → 进度 → 停止/卡片 → 子代理 → 返回；390 paper、430 carbon 各一遍。

脚本在 `%TEMP%\merged-verify\`（`c1..c4.cjs`、`cross.cjs`、`global.cjs`、`stub.js`、`common.cjs`）。

---

## 10. 截图索引

| 文件 | 内容 |
|---|---|
| `00-真实部署产物-390x844-配对页.png` | 真实加载配对页 |
| `01-停止成功-进度收尾与交代卡.png` | 冲突 1：停止后面板与卡 |
| `02-停止交代卡-展开.png` | 四段展开 |
| `03-停止确认取消-什么都不发生.png` | 取消确认 |
| `04-停止失败-只toast不画卡.png` | stop 500 |
| `05-首绘-进会话立即有内容.png` | 冲突 2：进会话 |
| `06-首绘-返回会话进度条.png` | 冲突 2：运行进度 |
| `07-turn-start-新轮已跑0步.png` | 冲突 3：新轮重置 |
| `08-turn-end-已完成与子代理刷新.png` | 冲突 4：done + 2 子代理 |
| `10-全链路-390-纸面-进度.png` | 390 纸面进度 |
| `10-全链路-390-纸面-交代卡.png` | 390 纸面卡 |
| `10-全链路-390-纸面-子代理.png` | 390 纸面子代理 |
| `11-全链路-430-碳黑-进度.png` | 430 碳黑进度 |
| `11-全链路-430-碳黑-交代卡.png` | 430 碳黑卡 |
| `11-全链路-430-碳黑-子代理.png` | 430 碳黑子代理 |
| `12-首绘-返回后滚动位置丢失.png` | 冲突 2 FAIL 证据 |
| `13-缓存交叉-重登无旧内容.png` | F8 交叉 |
| `14-auto-read-turn-end.png` | 自动朗读顶掉已完成条 |
| `15-二次停止-本轮交代.png` | 冲突 3：本轮 turn 8 |

---

## 11. 最终结论

- **冲突 1 PASS**：停止成功/取消/失败三条分支行为正确；进度收尾 + F4 卡同时出现。
- **冲突 2 FAIL（仅滚动恢复）**：三种路径内容都立即有；但打开子代理 sheet 时父会话已跳到最底部（2395→4791），返回后仍是底部，F3 的滚动恢复在合并产物里失效。**必须修**。
- **冲突 3 PASS**：新轮「已跑 0 步」，连续停止的 turn/卡片是当前轮。
- **冲突 4 PASS（展示层重叠）**：done/fade、子代理刷新、auto-read 都触发；auto-read 开启时朗读条顶掉 done 条，3 秒淡出不可见。
- **跨功能 PASS**：F8 缓存、退登重登、版本戳、390/430 全链路均无错误；0 console error / 0 network failed。
- **语义损失判断**：确定的语义损失是本轮冲突 2 的滚动丢失；auto-read 顶掉 done 条是展示层二选一，若要求“同屏看到”则算第二处语义损失。其余冲突解法没有发现功能语义损失。
- **真机专属 3 项 UNVERIFIED**。
