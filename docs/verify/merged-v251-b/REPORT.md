# merged2 定向复验（release/v251 d9a66b2）

- 预览：`https://dsh.easymana.online:8443/preview/merged2/`
- 分支 / commit：`release/v251 / d9a66b2322fbfcf528d3cb1f9cc520f076ba9059`
- 代码：`D:\Vibe\PWA\pwa\index.html`
- 验收时间：2026-11-25（America/Los_Angeles）
- 结论：**a–f 六项全部 PASS；0 FAIL；真机专属 3 项 UNVERIFIED**
- 关键：上次 FAIL 的子代理返回滚动恢复已修；自动朗读延后到完成行走完；其它三条冲突无回归

> 边界：**没有用真 iPhone/Safari/WebKit**。iPhone 环境是 Chrome for Testing 157 + CDP 模拟（390×844 / 430×932、DPR 3、Touch、iPhone UA、安全区 47/34）。页面/静态资源/SW 走真实 HTTPS；宿主 API/SSE 打桩；未改业务代码，未 push/部署。

---

## 0. 总表

| # | 项 | 结论 | 证据 | 备注 |
|---|---|---|---|---|
| a | 原 FAIL：父会话 2395 → 子代理 → 返回 2395 | **PASS** | `12` | 打开 sheet 前后 2395→2395；返回 20/60/120/300/600ms 全部 2395，不是 0/4791 |
| b | 原本在底部：打开/返回仍贴底 | **PASS** | `16` | 4791→4791；返回 4791 |
| c | 打开 sheet 父会话完全不跳 | **PASS** | `12` | 打开前后差值 **0px**；强制目录从 2→3 个触发重画路径 |
| d | 自动朗读不抢完成行；切会话不读 | **PASS** | `17`、`18` | 0.12s 已完成、2.62s donefade、3.07s 清空、3.74s 朗读条；450ms 切走则 4.2s 后无朗读 |
| e | 其它三条冲突回归 | **PASS** | `01`–`04`、`07`、`08`、`15` | 中断按钮成功/取消/失败 8 条；turn/start 重置 1 条；turn/end done/fade/子代理 4 条；二次停止 turn 3 条 |
| f | 版本戳 | **PASS** | 静态 + preview SW | `APP_VERSION=v251`、`sw.js CACHE=dsh-mobile-v252`、preview `dsh-preview-merged2-v251` |
| 0 | 真实部署产物加载 | **PASS** | `00` | 真实 HTTPS；0 error/0 404；TTFB 656ms、FCP 1140ms、配对页 1633ms |
| D1 | iOS Safari 低存储/隐私模式 | **UNVERIFIED** | — | 未真机 |
| D2 | 切后台 10 分钟 | **UNVERIFIED** | — | 只模拟 reload/延迟 |
| D3 | 大库/真实语音权限 | **UNVERIFIED** | — | 见 §6 |

**主项 a–f：PASS 6 / FAIL 0。真机专属：UNVERIFIED 3。**

---

## 1. 产物与版本

| 项 | 值 |
|---|---|
| 本地 `index.html` SHA-256（原始） | `1BE1521E196F8C5394CAA4F3C6E091D5D3BB4E8D1DA7B0363C32C95C3875A2A2` |
| 部署文件 SHA-256（含预览标记） | `4F01F82D57E9834B34BC39B993D6228123C7D400495D2D45D0BF18DB5308C860` |
| 剥离 4 处预览标记后 | `equal: true`，长度 413386；规范化 SHA-256 `640b7d4256abd9829a1e9bd23f3cc78df82fa08c84835eb87e7f7e696c614b45` |
| HEAD | `d9a66b2322fbfcf528d3cb1f9cc520f076ba9059` |
| `APP_VERSION` | **v251** |
| 本地 `sw.js CACHE` | **dsh-mobile-v252** |
| preview `/merged2/sw.js` CACHE | **dsh-preview-merged2-v251** |

工作区：本次只新增 `docs/verify/merged-v251-b/`；另有既有未跟踪的 `lan-*.vbs`/`lan-*.ps1`（非本次产物）。业务文件未改。

---

## 2. 修复点对照

| 修复点 | 代码 | 验证 |
|---|---|---|
| `repaintSessionKeepingScroll()`：目录刷新不弹底 | `index.html:5803-5809`；成功/失败路径 `7499-7509` | a/b/c：打开 sheet 差值 0；返回保持 2395 / 底部 |
| `openSubagentView()` 先把父会话位置存进 `sessionRestore` | `index.html:7636-7646` | a：快照发生在关 sheet/重画之前 |
| 自动朗读从立即改为 3300ms 定时 + 守卫 | `index.html:9000-9008`（`setTimeout 3300`） | d：完成行先走完，朗读后出现；切会话放弃 |
| `finishInitialPaint` 消费 restore | `index.html:6690-6715`（原有 F3） | a：恢复 2395；b：底部仍贴底 |

---

## 3. a / b / c：滚动修复

证据：`12-首绘-返回后滚动恢复2395.png`、`16-底部返回仍贴底.png`

### a. 原 FAIL 场景

1. 60 条消息，会话打开并稳定 700ms 后设 `main.scrollTop=2395`（`max=4791`）。
2. 强制子代理目录从 2 个变 3 个（把 A 改待批、加 C 跑中），确保打开 sheet 时 `loadSubagents(force)` 真的触发 `repaintSessionKeepingScroll()`。
3. 打开 `.subbar`，等 500ms：`preOpenTop = 2395`，**没有跳**。
4. 进只读页 → 返回。
5. 采样 20/60/120/300/600ms：全部 `top=2395`、`max=4791`，不是 0，也不是 4791。

结论：**父会话阅读位置不再丢失，F3 的滚动恢复在合并产物里恢复。**

### b. 原本在底部

- `scrollTop=4791`（max 4791）→ 打开 sheet：`4791` → 进只读页 → 返回：`4791`。
- 没有从底部被拉到中间，也没有回 0。

### c. 打开 sheet 完全不跳

- 打开前 `2395`，打开后 500ms `2395`，再 100ms `2395`；差值 **0px**。
- 这条是在**目录签名变化**（2→3 个）时测的，不是“没有 repaint 所以没跳”的空过。

### 残留边界（非本次修复失败）

如果在新会话打开后的 **350ms 内**就把 `scrollTop` 设到 2395，再打开 sheet，仍会看到 4791。原因是 `openSession` 自身在 `index.html:8878-8879` 安排了 rAF + 350ms 的“贴底”校正；用户真正开始阅读时该定时器已经结束。该现象与本次子代理重画修复是两条独立路径，未计入 FAIL，但建议后续把“开页 350ms 内用户已上滚”也纳入保护。

---

## 4. d：自动朗读延后 — PASS

证据：`17-auto-read-延后到完成行走完.png`、`18-auto-read-切会话不朗读.png`

时间线（`turn/end` 为 0）：

| 时刻 | 观测 |
|---|---|
| 0.12s | `.prog`「已完成 · 3 步 · 0s」，无 `.speak` |
| 2.62s | `class=streamline prog donefade`，完成行仍在，无朗读 |
| 3.07s | 完成行清空（`row=false`），仍无朗读 |
| 3.74s | `.prog .speak`「正在朗读 · 第 1/1 段」，操作条「停止朗读」 |

说明：3300ms 定时从 `loadMessages` 起算；`loadMessages` 由 `turn/end` 后 350ms 触发，所以实际开口约 3.7s，完成行在 3.0s 清空之后。

### 切会话守卫

- 第 6 轮 `turn/end` 后 450ms 返回列表并打开「切走的目标会话」。
- 4.2s 后：无 `.speak`、操作条仍是「朗读」、标题是目标会话；**没有朗读**。
- 守卫条件（`state.view==='session'`、`state.sessionId===readSid`、`!speaking && !rec`）生效。

---

## 5. e：其它三条冲突回归 — PASS

### 中断按钮（`01`–`04`）

- 成功：POST stop 1 次、summary turn=7、`.stopline` 出现、进度 row 清空、展开四段齐全。
- 取消：stopRequests 不增加、无卡、进度保留、无 toast。
- 失败 500：只 toast「取消失败：mock stop failure」、无卡、进度保留。
- 8 条断言全 PASS。

### turn/start（`07`）

- 旧 phase 2/7 → 新 `turn/start` 后 80ms「已跑 0 步」，旧 phase 不显示，stopBtn 仍 `grid`。
- 二次停止：summary turn 7→8，旧卡被清，新卡是当前轮（`15`）。

### turn/end（`08`）

- 3 步 →「已完成 · 3 步」；2.7s donefade；再 0.7s 清空。
- 子代理目录 1→2，`subagentCalls` 1→2。
- 无自动朗读时不会被 speak 条打断。
- 5 条断言全 PASS。

---

## 6. f / 真实加载 / 真机

### f. 版本

- `APP_VERSION=v251`（页面真实首开也显示「版本 v251」）。
- 本地 `sw.js` `CACHE=dsh-mobile-v252`。
- preview `/merged2/sw.js` `CACHE=dsh-preview-merged2-v251`，只清 `dsh-preview-*`。

### 真实加载（`00`）

- 真实 HTTPS，390×844，无 token/注入。
- 0 console error/0 failed；TTFB 656ms、FCP 1140ms、配对页 1633ms。

### 真机才能验（UNVERIFIED）

1. iOS Safari IndexedDB 低存储/隐私模式：配额、QuotaExceededError、系统逐出。
2. 切后台 10 分钟回来：真实 WebContent 回收后缓存补画/滚动恢复。
3. 真实语音权限/出声/自动朗读手势策略：Chrome speechSynthesis 通过，不代表 Safari 系统听写/语音包/手势解锁。

另：30×400 条大库首次 getAll/structured clone 的低端机耗时未测。

---

## 7. 真实 vs 模拟

| 项目 | 真实/模拟 | 说明 |
|---|---|---|
| 预览页面、manifest、icon、sw.js | **真实** | 真实 HTTPS；0 404/0 failed |
| 部署产物 vs 本地 commit | **真实** | 剥离 4 处预览标记后字节级相等 |
| 首次打开（00） | **真实** | 无 token、无注入 |
| `/api/mobile/v1/*` | **模拟** | fetch 打桩（sessions/messages/stop/stop-summary/subagents） |
| SSE | **模拟** | ReadableStream + 心跳 + 测试帧 |
| IndexedDB/localStorage | **真实浏览器 API** | 真写/真读，但 Chrome 不是 Safari |
| 视口/DPR/UA/触摸/安全区 | **模拟** | CDP，不是 iPhone 硬件 |
| 子代理 / 停止交代 / 自动朗读 | **模拟/浏览器 API** | mock 数据；speechSynthesis 是 Chrome 实现 |

---

## 8. 复现

1. 独立 Chrome：`--headless=new --remote-debugging-port=9520 --user-data-dir=%TEMP%\merged2-verify\ppaint --ignore-certificate-errors`。
2. CDP：390×844、DPR 3、Touch、iPhone UA、安全区 47/34。
3. 预加载 `stub.js`（fetch/SSE/IDB/stop/subagents），导航 `https://dsh.easymana.online:8443/preview/merged2/#token=fake&inst=fake`。
4. a/b/c：60 条消息 → 等 700ms → `main.scrollTop=2395` → `__F8.setSubagents` 2→3 → 打开 `.subbar` 等 500ms → 进 `.sli` → 返回 → 采样。
5. d：`localStorage['dsh.speech.auto']='1'` → `turn/start`/steps/phase → `turn/end` → 0.12/2.62/3.07/3.74s 采样；第二轮 450ms 切到目标会话，4.2s 后检查无 speak。
6. e：c1（stop）、c4（二次停止）、e（turn/start + turn/end + 子代理刷新）。
7. f：静态读 `APP_VERSION`/`sw.js`；preview 拉 `/merged2/sw.js`。

脚本在 `%TEMP%\merged2-verify\`（`c1.cjs`、`c2.cjs`、`c4.cjs`、`d.cjs`、`e.cjs`、`t0.cjs`、`stub.js`、`common.cjs`）。

---

## 9. 截图索引

| 文件 | 内容 |
|---|---|
| `00-真实部署产物-390x844-配对页.png` | 真实加载 |
| `01-停止成功-进度收尾与交代卡.png` | 中断成功 |
| `02-停止交代卡-展开.png` | 四段展开 |
| `03-停止确认取消-什么都不发生.png` | 取消 |
| `04-停止失败-只toast不画卡.png` | stop 500 |
| `05-首绘-进会话立即有内容.png` | 首绘内容 |
| `06-首绘-返回会话进度条.png` | 运行进度 |
| `07-turn-start-新轮已跑0步.png` | turn/start |
| `08-turn-end-已完成与子代理刷新.png` | turn/end |
| `12-首绘-返回后滚动恢复2395.png` | a/c 修复 |
| `15-二次停止-本轮交代.png` | 二次停止 |
| `16-底部返回仍贴底.png` | b |
| `17-auto-read-延后到完成行走完.png` | d：朗读在完成行之后 |
| `18-auto-read-切会话不朗读.png` | d：守卫 |

---

## 10. 最终结论

- **a PASS**：2395 → 打开 sheet → 进只读页 → 返回，20–600ms 全部 2395；强制目录变化也保持 0px 漂移。
- **b PASS**：原本在底部，打开/返回仍贴底。
- **c PASS**：打开 sheet 前后差值 0px。
- **d PASS**：完成行 0–3.0s 可见并 fade，3.74s 后朗读；450ms 切会话则不朗读。
- **e PASS**：中断按钮成功/取消/失败、turn/start、turn/end、二次停止 turn 号全部无回归。
- **f PASS**：v251 / dsh-mobile-v252 / dsh-preview-merged2-v251。
- **残留问题**：仅“开页 350ms 内立刻上滚”会被 `openSession` 自己的贴底定时器拉回；这是独立于子代理重画的边界，不影响本次修复场景，建议后续补保护。
- **真机专属 3 项 UNVERIFIED**。
