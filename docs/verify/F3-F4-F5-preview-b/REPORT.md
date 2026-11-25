# F3 修复复验报告（f345b）

- 被测：`https://dsh.easymana.online:8443/preview/f345b/`
- 分支 / commit：`feature/f3-f4-f5` / `c7da5e5`（`fix(f3): 从子代理只读页返回父会话立即重绘并恢复滚动位置`）
- 部署戳：`dsh-preview-f345b-v249`（预览 SW 缓存名，浏览器 `caches.keys()` 实测一致）
- 本地代码：`D:\Vibe\PWA\pwa-k\index.html`
- 验收时间：2026-11-25（America/Los_Angeles）
- 结论：**必验 a–f 全部 PASS；回归 6 项全部 PASS；0 FAIL。** 上次的「返回父会话空白约 4 秒 + 滚动位置丢失」已修复。
- 环境：390×844 / 430×932、DPR 3、iPhone UA、触摸、安全区 47/34、纸面 + 碳黑。
- 证据：15 张截图，见 §8。

---

## 0. 总表

| # | 验收项 | 结论 | 证据 | 备注 |
|---|---|---|---|---|
| A | 真实首次打开 / 部署产物 | **PASS** | `01`、`02` | 4/4 响应 200，0 error、0 warning；FCP 1020ms；SW 缓存名即部署戳 |
| a | 返回立即有内容：**2 帧内** `.msg` 等于总数 66，不是 0、不等 4 秒 | **PASS** | `07` | 两次 rAF 后 `.msg=66`、`h=10133>588`；300ms 后仍 66 |
| b | 滚动位置恢复：返回后 `scrollTop` 与进入前差值 ≤24px | **PASS** | `07` | 进入前 1845 → 返回 1845，差 **0px**；300ms 后仍 1845 |
| c | 原本在底部：返回后仍贴底、回到底部按钮隐藏 | **PASS** | `08` | `scrollHeight−scrollTop−clientHeight=0`；`.jump` 无 `.on`、`display:none` |
| d | 返回后立刻来新消息：`scrollTop` 不被强制拉到底 | **PASS** | `09` | 67 条消息时 `top=1845` 不变，底部距离 7779；jump 显示但未跳 |
| e | 首次打开会话（不经过只读页）仍贴底 | **PASS** | `03` | 66 条、`top=9545`、`bottom=0`、jump 隐藏 |
| f1 | 入口条文案 / 四色 | **PASS** | `03`、`04`、`12` | `4 个子代理 · 1 跑中 · 1 待批 · 1 失败`；跑中绿、待批黄、失败红；失败 dot 红 |
| f2 | sheet 四行四色 + 跑中/待批 ■ | **PASS** | `05`、`13` | `dot run / pending / done / failed`；只有跑中/待批有 ■ |
| f3 | 打断 confirm + 计数刷新 | **PASS** | — | 打断补迁移测试后「1 跑中」消失；再打断待批后只剩「1 失败」 |
| f4 | 只读页无输入框；返回后 sheet 仍在 | **PASS** | `06`、`06b`、`07` | 骨架 3 个 → 3 条消息；composer 始终不存在；返回后 `.subsheet` 存在 |
| f5 | `parentAvailable:false` 黄条 + 打断可用 | **PASS** | `11` | 黄条文案正确；2 个 ■ 仍在 |
| f6 | 全部完成灰字 / 碳黑 / 430 | **PASS** | `10`、`12`、`14` | `subbar done`、`全部完成`、b 色 `rgb(140,138,127)`；430 无横向溢出 |

**计数：PASS 12 / FAIL 0。**

---

## 1. 产物一致性

| 项 | 值 |
|---|---|
| 本地 `index.html` SHA-256 | `382dd527842678fd40ff2d52828db8063bd963a78afebcdd4b6efadd12d2ba86` |
| 部署文件原始 SHA-256（含 4 处标记） | `633de9d9bc2727770926f54a6cd5062a73e93dd2c07fc966a76a044c6a867a0b` |
| 部署 / 本地大小 | 370975 / 370604 字符（+371） |
| 剥离后比较 | `equal: true`，长度 370604 == 370604，SHA 相同 |
| 部署响应 | `HTTP 200`，`Content-Length: 406703` |
| 部署戳 | 预览 `sw.js` 第 10 行 `CACHE = 'dsh-preview-f345b-v249'`；页面 `caches.keys() = ['dsh-preview-f345b-v249']` |

被剥离的 4 处：`__DSH_PREVIEW__` script、预览 title、`apple-mobile-web-app-title="DSH f3-f4-f5"`、末尾「← 测试环境」链接。工作区 `git status` 只有 `?? docs/verify/`；未改 `index.html` / `sw.js` / 版本号 / 台账。

---

## 2. 本次改动核对（代码）

| 位置 | 事实 |
|---|---|
| `index.html:5506-5529` | `finishInitialPaint()`：`if (body.isConnected) finishInitialPaint(); else requestAnimationFrame(finishInitialPaint);`，只负责一次首次绘制 |
| `index.html:5517-5526` | `restore.atBottom` → `paintSession({scroll:'bottom'})`；否则 `paintSession({scroll:'none'})` + `ui.body.scrollTop=restore.top` + `ui.atBottom=false` + `updateJump()`，并 `state.sessionRestore=null` 消费一次 |
| `index.html:1558` | 新增 `state.sessionRestore: null` |
| `index.html:6436-6445` | `openSubagentView` 进只读页前记录 `{sessionId, top, atBottom}`；`atBottom` 用几何现算 |
| `index.html:6465-6468` | `goBackFromSubagent` 只切页 + `render()`；不再自己 `requestAnimationFrame` 抢滚动 |
| `index.html:4934` | `paintSession` 末尾：`if (scroll === 'bottom' || (scroll !== 'none' && atBottom))`，显式 `none` 跳过自动贴底 |

---

## 3. 关键指标（66 条消息长会话）

会话：66 条消息，`main.scrollHeight=10133`、`clientHeight=588`。

### a. 返回立即有内容

点返回后，用 `requestAnimationFrame` 连等两帧再读：

| 指标 | 值 |
|---|---|
| `.msg` 数量 | **66**（总数 66，不是 0） |
| `scrollHeight` | 10133（不是 588 空壳） |
| 2 帧内？ | 是（两次 rAF 后） |
| 300ms 后 | 仍 66 条、位置 1845 |

对比上一轮（f345）：500ms 仍 `.msg=0`、`scrollHeight=588`、要等约 4 秒轮询。**已修复。**

### b. 滚动恢复

| 项 | 值 |
|---|---|
| 进入只读页前 | `scrollTop=1845`、`bottom=7700`、jump 显示 |
| 返回 2 帧后 | `scrollTop=1845`、`bottom=7700`、jump 显示 |
| 差值 | **0px**（阈值 ≤24） |
| 300ms 后 | 1845 |
| 是否跳到底部 | 否（bottom 7700，非 0） |

### c. 原本在底部

| 项 | 值 |
|---|---|
| 进入前 | `scrollTop=9545`、`scrollHeight−scrollTop−clientHeight=0` |
| 返回 2 帧后 | 同样 9545、bottom=0 |
| `回到底部` 按钮 | `.jump` 无 `.on`，computed `display:none` |

### d. 返回后立刻来新消息

- 返回中部（1845）后，向 stub 追加第 67 条消息，并推一个 `session/event` 触发 350ms 后的 `loadMessages`。
- 结果：`.msg=67`、`scrollTop` 仍 **1845**、`bottom=7779`、jump 显示；**没有**被新消息拉到 9545/底部。
- 说明修复只消费一次 restore，后续正常 `paintSession` 在 `atBottom=false` 时不会自动贴底。

### e. 首次打开

- 从会话列表打开 66 条会话：`.msg=66`、`scrollTop=9545`、`bottom=0`、`.jump` 隐藏。
- `finishInitialPaint` 在无 `sessionRestore` 时仍按原行为贴底，没有把「首次打开」改坏。

---

## 4. F3 其余回归

### 4.1 入口条四色

证据：`04-入口条-四色.png`、`12-碳黑-入口条-390x844.png`

- 文案：`⤷ 4 个子代理 ●1 跑中 ●1 待批 ●1 失败 ›`；`.cnt` 三个，颜色：
  - 跑中 `rgb(46,107,63)`
  - 待批 `rgb(138,90,18)`
  - 失败 `rgb(163,59,49)`
- 碳黑：跑中 `rgb(159,224,124)`、待批 `rgb(227,186,92)`、失败 `rgb(240,124,108)`。
- 全部完成时：`subbar done`、`4 个子代理 全部完成`、无 `.cnt`、b 色 `rgb(140,138,127)`（`10`）。

### 4.2 sheet

证据：`05-sheet-四色四行.png`、`13-碳黑-sheet.png`

- 4 行，dot 分别为 `dot run / dot pending / dot done / dot failed`；状态词「跑中 / 待批 / 完成 / 失败」。
- 只有跑中、待批有 `.ib`（■）；完成、失败没有。
- 点 ■：原生 `confirm("打断「补迁移测试」？...")` 接受；POST
  `{"sessionId":"sub-a","childSessionId":"sub-a","parentSessionId":"sess-f1"}`；计数从「1 跑中 1 待批 1 失败」→「1 待批 1 失败」→「1 失败」。
- 返回后 `.subsheet` 仍在（4 行）。

### 4.3 只读页与降级

- 只读页：先 3 个 `.skel`，700ms 后 3 条 `.roview .msg`；`.composer` 始终不存在；底部「只读视图 · 发消息请回主会话 / ■ 打断」（`06`、`06b`）。
- `parentAvailable:false`：sheet 底部黄条「主会话已删除：列表与打断还能用，消息可能读不全。」；跑中/待批两个 ■ 仍可用（`11`）。

### 4.4 430 / 碳黑

- 430×932：入口条文案完整、`scrollWidth=430`（`14`）。
- 碳黑：入口条/sheet 颜色正确（`12`、`13`）。

---

## 5. 残留问题

**本轮没有发现产品残留 FAIL。** 上次的 F3.3 空白 + 滚动丢失已消除；a–f 全部通过。

非阻塞观察：

1. 只读页消息是 700ms 后才填入（骨架先出现），这是设计行为；返回父会话不再等它。
2. 返回后 sheet 会重新打开（设计如此），遮住父会话下半屏；本轮截图能看到父会话已经恢复在 1845。
3. 66 条消息的 `paintSession` 首次绘制在本机 Chrome 约两帧内完成；真机 WebKit 的耗时与滚动精度见 §7。

---

## 6. 真实 vs 模拟

| 项目 | 真实 / 模拟 | 说明 |
|---|---|---|
| 预览页面、manifest、icon、sw.js | **真实** | 真实 HTTPS；4/4 200 |
| 部署产物 vs 本地 commit | **真实** | 剥离 4 处标记后 SHA 相同；SW 缓存名即部署戳 |
| 首次打开、配对页 | **真实** | 无 token、无注入 |
| 宿主 API / SSE | **模拟** | 预加载 fetch + ReadableStream；66 条消息与子代理目录为合成 |
| 子会话消息 / interrupt | **模拟** | 子消息延迟 700ms 用于骨架；打断只更新 stub 状态 |
| 视口 / DPR / UA / 触摸 / 安全区 | **模拟** | Chrome CDP |
| `scrollTop` / rAF / 布局 | **真实浏览器行为** | 真实 Chromium 滚动与渲染，但不是 WebKit |
| 纸面 / 碳黑 | **真实渲染** | 产品 CSS/JS 切 skin |

未做的：没有用手机凭据、没有连真实宿主、没有 push/部署、没有改业务代码。

---

## 7. 真机才能验

1. **WebKit 的滚动恢复与重绘时机**：iOS Safari 的惯性滚动、rubber-band、`scrollTop` 小数精度、`requestAnimationFrame` 在滚动中/键盘弹起时的节流，都可能影响「2 帧内」和「≤24px」；Chrome 的 0px 差异不能直接外推。
2. **真实宿主与长会话**：真实子代理消息流、`parentAvailable`、打断延迟；66 条只是本机合成，真机上百条消息/图片/代码块时首次 `paintSession` 的耗时和滚动稳定性要复测。
3. **iOS 键盘 / 安全区 / sheet 动画**：返回时如果键盘正要弹起、或安全区变化，滚动恢复与 sheet 入场动画的组合需要真机看；本轮只覆盖 390/430 固定安全区。

---

## 8. 截图索引（15 张）

| 文件 | 内容 |
|---|---|
| `01-真实首次打开-390x844-配对页.png` | 真实网络首次打开，390×844 |
| `02-真实首次打开-430x932-配对页.png` | 真实网络首次打开，430×932 |
| `03-66条消息-首次打开贴底.png` | 66 条消息首次打开，底部、入口条四色 |
| `04-入口条-四色.png` | 同上状态的入口条四色 |
| `05-sheet-四色四行.png` | 四行四色 + 跑中/待批 ■ |
| `06-只读页-无输入框.png` | 只读页骨架、无 composer |
| `06b-只读页-消息-无输入框.png` | 消息填入后仍无 composer |
| `07-返回2帧内-中部恢复.png` | 返回 2 帧内父会话 66 条、scrollTop 1845 |
| `08-原本底部-返回贴底.png` | 原本底部，返回仍 bottom=0、jump 隐藏 |
| `09-返回后新消息-不跳底.png` | 新增第 67 条后仍停在 1845 |
| `10-全部完成-灰字.png` | 全部完成灰字 |
| `11-父会话已删-黄条-打断可用.png` | parentAvailable=false 黄条 |
| `12-碳黑-入口条-390x844.png` | 碳黑入口条四色 |
| `13-碳黑-sheet.png` | 碳黑 sheet |
| `14-碳黑-430x932-入口条.png` | 碳黑 430×932 |

---

## 9. 最终结论

- **a–f 全部 PASS**：返回 2 帧内 66 条消息、scrollTop 差 0px、原本底部仍贴底、新消息不拉底、首次打开仍贴底。
- **F3 其余回归全部 PASS**：入口条四色/全部完成灰字、sheet 四行/打断/计数刷新、只读页无输入框/返回 sheet 仍在、parentAvailable 黄条、碳黑/430。
- **必须修的项：0。**
- 可选：真机上补测 WebKit 惯性滚动下的 scrollTop 精度与 sheet 入场时的滚动恢复。
