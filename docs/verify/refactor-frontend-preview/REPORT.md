# refactor/frontend 独立验收报告（初验 `707d4d4` → 复验 `50a6a0e`）

- 复验预览地址：`https://dsh.easymana.online:8443/preview/refactor-v2/`（初验：`refactor-v1`）
- 分支 / commit：`refactor/frontend` / `50a6a0e`（初验：`707d4d4`）
- 本地代码：`D:\Vibe\PWA\pwa-p\index.html`（由 `src/` 模块构建）
- 验收时间：2026-11-27（America/Los_Angeles）
- 最终验收结论：**13/13 主项全部 PASS，0 FAIL，真机专属 3 项 UNVERIFIED**（初验发现的 P0 阻断缺陷 BUG-01 已在 `50a6a0e` 修复并在 `refactor-v2` 复验通过，**具备交付用户真机验收条件**）。

> [!NOTE]
> **复验变更摘要（`50a6a0e` / `refactor-v2`）**：初验 `707d4d4` 检出的 P0 阻断缺陷（`src/core/state.js:15` `_lsGet` 递归调用自身）已修复为 `localStorage.getItem(k)`，新增 `tests/state.test.mjs`（单测 21/21 PASS），并部署至全新 slug `refactor-v2`（`dsh-preview-refactor-v2-v251`）。复验确认真实预览产物含修复代码、`#token=` 链接登录及冷启刷新持久化全部 PASS。

> 边界说明：**未在真机 iPhone / Safari / WebKit 上运行**。移动端环境由 Chrome Headless（`--headless=new`）+ CDP 模拟（390×844 与 430×932、DPR=3、Touch、iPhone Safari UA、安全区 `--safe-t:47px; --safe-b:34px`、`html.kb-open` 键盘态、`paper` + `carbon` 双皮肤）。预览静态资源 / SW / manifest 走真实 HTTPS；业务接口 `/api/mobile/v1/*`、`/push/*` 及 SSE 帧由本地 Node Mock 服务器模拟。本次未修改任何业务代码，未 push、未部署、未安装依赖、未使用用户手机凭据。

---

## 0. 总表

| # | 验收项 | 环境 | 结论 | 证据截图 | 备注 |
|---|---|---|---|---|---|
| 1 | 真实预览加载（HTTPS 200 / manifest / SW / 双尺寸双皮肤配对页） | **真实** | **PASS** | `01`–`04`、`31`–`32` | `refactor-v2` 复验：0 console error / 0 pageerror / 0 failed；SW `activated`；`APP_VERSION=v251`；`CACHE=dsh-preview-refactor-v2-v251`；确认线上含修复版 `_lsGet` |
| 2 | 本地单测（`node --test tests/*.test.mjs`） | **真实** | **PASS** | — | 21/21 PASS（含新增 `tests/state.test.mjs`） |
| 3 | **启动恢复登录态 / `#token=` 链接登录 / 刷新持久化** | **真实+模拟** | **PASS（复验修复）** | `33`–`34` | 初验 `707d4d4` FAIL（BUG-01）→ `50a6a0e` 修复后复验 PASS：`#token=` 剥离 hash 直进列表；刷新后 `token`/`inst`/`mode='relay'`/`collapsed` 全部保留 |
| 4 | 列表页（paper+carbon、390+430、分组/置顶/未读/5条截断/状态点/搜索/归档/左抽屉/底栏） | **模拟** | **PASS** | `05`–`08` | 4 种尺寸×皮肤均无横向溢出；「显示更多」展开/收起正常；搜索高亮与空态清除正常 |
| 5 | 会话页（paper+carbon、正常+`kb-open`、Markdown/复制/分段复制/卡片/排队编辑/chips/回底） | **模拟** | **PASS** | `09`–`11` | 代码块复制、分段复制 toggle、审批/提问卡、排队行内编辑、模型/权限 chip、回底、`kb-open` 均正常 |
| 6 | F1 过程进度与步骤面板（live-steps / todo_write phase / steps sheet / Esc 关闭 / turn/end） | **模拟** | **PASS** | `12` | `第 2/4 步` 进度条、4 行步骤面板、Esc 关闭、`已完成 · 4 步` 全部正常 |
| 7 | F2 语音与朗读（麦克风按钮 / 朗读按钮 / 朗读条 / 停止 / 设置页开关） | **模拟** | **PASS** | `09`、`27` | 按钮、朗读条状态与停止逻辑正常；设置页开关写入 `localStorage` 正常（无真实发声，见 D3） |
| 8 | F3 子代理（入口条 / 列表 sheet / 只读视图 / 返回父会话保持滚动位置） | **模拟** | **PASS** | `13`–`14` | 父会话 `scrollTop=1000` 打开 sheet 不跳（1000）、进只读页返回后精确恢复 `1000`（偏差 0px） |
| 9 | F4 停止交代（中断确认 / 折叠行 / 展开四段 / 收起） | **模拟** | **PASS** | `15` | `.stopline` → 展开 `.card.stopc`（做了什么/看到了什么/没做完/对外发出）→ 收起全部正常 |
| 10 | F5 定时任务（列表 / 新建表单 / 详情与历史 / 改时间编辑表单） | **模拟** | **PASS** | `21`–`23` | 活跃/暂停任务、新建提交、详情历史记录、编辑复用表单全部正常 |
| 11 | 文件与浮层（文件 Tab / 右侧文件抽屉 / 全屏查看器双皮肤跟随） | **模拟** | **PASS** | `16`–`19` | `.rpanel` 抽屉、`.viewer` Markdown 预览在 `paper` (`rgb(246,245,241)`) 与 `carbon` (`rgb(11,12,14)`) 正确切换 |
| 12 | 设置首页与 5 个子页（`conn` / `stats` 30 天热力图 / `about` / `voice` / `pushdiag`） | **模拟** | **PASS** | `20`、`24`–`28` | 5 个子页全部渲染完整，30 天热力图 34 格（含图例），0 报错 |
| 13 | 新会话大输入页 & Git 概览页 | **模拟** | **PASS** | `29`–`30` | 新会话大输入页、工作区/隔离工作树 chip、发送可用态联动、Git 分支/暂存/未暂存/提交记录均正常 |
| D1 | iOS Safari 真机 IndexedDB 低存储 / 隐私模式 | **未验证** | **UNVERIFIED** | — | 需真机 Safari |
| D2 | iOS 真机切后台 10 分钟后 WebContent 回收恢复 | **未验证** | **UNVERIFIED** | — | 需真机验证 |
| D3 | iOS 真机语音识别权限、系统听写与语音合成实际出声 | **未验证** | **UNVERIFIED** | — | Headless Chrome 无系统 TTS 输出设备与 Safari 语音策略 |

**统计汇总（复验 `50a6a0e` / `refactor-v2` 最终结果）**：
- **PASS：13**（真实 2 + 真实+模拟 1 + 模拟 10）
- **FAIL：0**（初验 BUG-01 已修复闭环）
- **UNVERIFIED：3**（真机 iOS Safari 专属项）

---

## 1. 阻断缺陷详情（FAIL）

### BUG-01（P0 / 阻断）：`_lsGet` 递归调用自身导致启动无法恢复 `localStorage` 状态

- **位置**：
  - 源码：[src/core/state.js](file:///D:/Vibe/PWA/pwa-p/src/core/state.js#L15-L23)
  - 构建产物：[index.html](file:///D:/Vibe/PWA/pwa-p/index.html#L1178-L1186)
  - 线上预览：`https://dsh.easymana.online:8443/preview/refactor-v1/` 已确认包含同一缺陷（`hasLsGetBugInRemote: true`）。
- **缺陷代码**：
  ```js
  const _lsGet = (k) => { try { return typeof localStorage !== 'undefined' ? _lsGet(k) : null; } catch { return null; } };
  ```
- **根因**：函数体内误写成调用 `_lsGet(k)` 而非 `localStorage.getItem(k)`，触发 `RangeError: Maximum call stack size exceeded` 后被 `catch` 捕获并返回 `null`。
- **影响面**：
  1. **每次刷新 / 冷启 PWA 必掉登录**：`state.token` 恒为 `''`，即使 `localStorage['dsh.token']` 已有有效凭据，页面仍渲染配对页（`.pair`）。
  2. **URL `#token=...&inst=...` 恢复链接失效**：`state.js:3-12` 将 token 写入 `localStorage` 并清掉 hash 后，第 17 行 `_lsGet(LS.token)` 立即返回 `null`，导致停留在配对页。
  3. **其余 6 个启动持久化字段全部失效**：`instanceId`、`mode`（恒回退 `'auto'`）、`lanBase`、`lanPort`（恒回退 `'8443'`）、`lanName`、`collapsed`（文件夹折叠状态刷新丢失）。
- **复现步骤**：
  1. 在浏览器打开 `https://dsh.easymana.online:8443/preview/refactor-v1/`（或本地 `http://127.0.0.1:<port>/#token=mock-tok-123&inst=inst-mock-01`）。
  2. 观察 `localStorage.getItem('dsh.token')` 为 `"mock-tok-123"`，但页面依然停留在 `.pair` 配对页而非会话列表。
  3. 即使通过配对码登录进入会话列表，刷新页面后立即退回配对页。
- **建议修复**：
  ```js
  const _lsGet = (k) => { try { return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null; } catch { return null; } };
  ```
  并补充一条单元测试覆盖 `localStorage` 存在时 `_lsGet` 的真实读取行为，随后重新构建 `index.html`、重发 preview（建议换新 slug 清 SW 缓存）并复验。

---

## 2. 真实预览环境验证（PASS）

- 目标 URL：`https://dsh.easymana.online:8443/preview/refactor-v1/`
- 静态资源响应：

| 资源 | HTTP 状态 | 大小 (bytes) | 耗时 (ms) | Content-Type |
|---|---:|---:|---:|---|
| `index.html` | 200 | 488,237 | 1223 | `text/html; charset=utf-8` |
| `manifest.webmanifest` | 200 | 1,029 | 800 | — |
| `sw.js` | 200 | 5,469 | 150 | `text/javascript; charset=utf-8` |
| `icon-192.png` | 200 | 15,231 | 191 | `image/png` |
| `icon-512.png` | 200 | 59,440 | 158 | `image/png` |

- 版本与 SW：`APP_VERSION = v251`，`sw.js CACHE = dsh-preview-refactor-v1-v251`，SW 注册成功且处于 `activated` 状态（scope: `https://dsh.easymana.online:8443/preview/refactor-v1/`）。
- 4 组视口×皮肤（`390×844` / `430×932` × `paper` / `carbon`）：
  - `paper` 背景 `rgb(246, 245, 241)`，`carbon` 背景 `rgb(11, 12, 14)`；
  - `scrollWidth === clientWidth`（0 横向溢出）；
  - 0 `console.error`、0 `pageerror`、0 failed requests。

---

## 3. 本地全量功能与 UI 回归（模拟环境）

说明：因 BUG-01 导致 `#token=` 启动无法恢复 `state.token`，全量回归脚本在记录该 FAIL 后，通过配对页 UI 输入 6 位配对码走 mock `/api/mobile/v1/pair` 建立内存登录态，从而完成全部登录态页面的完整回归。

- **控制台与异常**：
  - `pageErrors`: **0**
  - `failedRequests`: **0**
  - `consoleErrors`: 仅 1 条 localhost 预期日志（`GET /dev-token.json` 返回 404，系 `src/main.js:169` 在 `127.0.0.1` 且 `!state.token` 时自动探测本地开发 token 所致；所有业务交互全程 0 JS 报错）。
- **重点回归结果**：
  - **列表页**：`未读`、`置顶`、`DSH Mobile PWA`（7 条，默认 5 条 + `显示更多（还有 2 条）` → 展开为 `收起`）、`Nalì Spa CRM` 分组齐全；状态点（运行中/待批/未读/空闲）渲染正常；搜索 `模块化` 命中 1 条并 `<mark>` 高亮，无结果态显示 `没有匹配「...」的会话` 与 `清除搜索`；已归档 Tab、左抽屉（`.drawer-mask.on`）、底栏（会话/文件/设置）均正常；390×844 与 430×932 双皮肤无横向溢出。
  - **会话页**：Markdown（标题/列表/引用/代码块）渲染正常；代码块 `.codecopy` 复制按钮、`¶ 分段` 切换 `.md.pickcopy`、审批卡+提问卡 SSE 下发与操作、排队消息 `.qdock` 展开与 `.qeditbar` 行内编辑保存、模型/权限 chip 面板、上滚出现 `.jump.on` 点击回底、`html.kb-open` (`--vvh: 480px`, `dockBottom=480`) 均正常。
  - **F1 过程进度**：`turn/start` + `session/live-steps` + `todo_write` phase → 进度条显示 `第 2/4 步 / 运行 node --test` → 打开 `.stpsheet` 显示 4 行步骤 → 按 `Escape` 正常关闭 → `turn/end` 后显示 `已完成 · 4 步`。
  - **F2 语音/朗读**：麦克风按钮与消息朗读按钮渲染正常；点击朗读出现 `.speak`（`正在朗读 · 第 1/1 段`）且按钮切为 `停止朗读`，点停止立即收起；设置 → 语音子页两个开关交互正常。
  - **F3 子代理**：入口条 `.subbar` 显示 `2 个子代理 · 1 跑中`；父会话滚至 `scrollTop=1000` 打开 `.subsheet` 后父会话保持 `1000` 不跳动；进入只读视图 `.roview` 正常渲染工具调用与回复；返回父会话后精确恢复 `scrollTop=1000`。
  - **F4 停止交代**：`turn/start` (`turn: 7`) → 点击中断按钮并确认 → `.stopline` 渲染 → 展开 `.card.stopc` 四段齐全（做了什么/看到了什么/没做完/对外发出）→ 点击 `收起` 还原。
  - **F5 定时任务**：列表（活跃+暂停）→ 新建表单提交 → 详情页（含历史记录 `.hrow`）→ `改时间` 编辑表单均正常。
  - **文件与浮层**：文件 Tab（盘符/面包屑/目录与文件列表）、会话内右侧文件抽屉 `.rpanel`、全屏查看器 `.viewer`（Markdown 预览且背景色随 `paper`/`carbon` 切换）均正常。
  - **设置与 5 子页**：设置首页 + `conn`、`stats`（7 天 KPI + 趋势柱图 + 30 天热力图 34 格）、`about`（v251 / 2 台设备）、`voice`、`pushdiag` 全部正常。
  - **新会话与 Git**：新会话大输入页（`.newta`、工作区/隔离工作树 chip、输入后发送按钮解锁）、Git 概览页（`Git · refactor/frontend`、已暂存/未暂存/未跟踪/最近提交 `707d4d4`）均正常。

---

## 4. 真实 vs 模拟边界表

| 项目 | 真实 / 模拟 / 未验证 | 说明 |
|---|---|---|
| 预览站点 HTTPS / `index.html` / `manifest.webmanifest` / `sw.js` / icons | **真实** | 直接访问 `https://dsh.easymana.online:8443/preview/refactor-v1/` |
| `node --test tests/*.test.mjs` | **真实** | 本地仓库直接运行，20/20 通过 |
| `_lsGet` 启动状态丢失缺陷 | **真实 + 模拟** | 真实预览产物代码确认含该缺陷；本地 HTTP 实测 `#token=` 复现 FAIL |
| `/api/mobile/v1/*`、`/push/*`、SSE 帧 | **模拟** | 本地 Node HTTP Mock 服务器 |
| 视口 / DPR / Touch / UA / 安全区 / `kb-open` | **模拟** | Chrome Headless + CDP |
| iOS Safari 真机（存储配额、切后台回收、真实语音/听写） | **未验证** | 需真机 Safari 复核 |

---

## 5. 截图索引（`shots/`）

| 文件 | 内容 |
|---|---|
| `01-real-preview-390-paper.png` | 真实预览 390×844 纸面配对页 |
| `02-real-preview-390-carbon.png` | 真实预览 390×844 碳黑配对页 |
| `03-real-preview-430-paper.png` | 真实预览 430×932 纸面配对页 |
| `04-real-preview-430-carbon.png` | 真实预览 430×932 碳黑配对页 |
| `05-list-390-paper.png` | 列表页 390×844 纸面 |
| `06-list-390-carbon.png` | 列表页 390×844 碳黑 |
| `07-list-430-carbon.png` | 列表页 430×932 碳黑 |
| `08-list-left-drawer.png` | 左侧会话抽屉 |
| `09-session-390-paper.png` | 会话页 390×844 纸面（Markdown/代码复制/子代理条/进度条） |
| `10-session-cards-queue.png` | 审批/提问卡 + 排队消息 dock |
| `11-session-390-carbon-kb-open.png` | 会话页 390×844 碳黑 + `html.kb-open` 键盘态 |
| `12-f1-steps-sheet.png` | F1 过程步骤面板 |
| `13-f3-subagents-sheet.png` | F3 子代理列表面板 |
| `14-f3-subagent-readonly.png` | F3 子代理只读视图 |
| `15-f4-stop-summary-expanded.png` | F4 停止交代卡展开四段 |
| `16-right-file-drawer.png` | 右侧文件抽屉 `.rpanel` |
| `17-viewer-paper.png` | 全屏文件查看器（纸面） |
| `18-viewer-carbon.png` | 全屏文件查看器（碳黑） |
| `19-files-tab.png` | 文件 Tab |
| `20-settings-home.png` | 设置首页 |
| `21-f5-schedule-list.png` | F5 定时任务列表 |
| `22-f5-schedule-new.png` | F5 新建定时任务表单 |
| `23-f5-schedule-detail.png` | F5 定时任务详情与历史 |
| `24-settings-conn.png` | 设置子页：连接 |
| `25-settings-stats-30d.png` | 设置子页：统计（7 天 KPI + 30 天热力图） |
| `26-settings-about.png` | 设置子页：关于 |
| `27-settings-voice.png` | 设置子页：语音 |
| `28-settings-pushdiag.png` | 设置子页：推送诊断 |
| `29-new-session.png` | 新会话大输入页 |
| `30-git-overview.png` | Git 概览页 |
| `31-reverify-v2-real-390-paper.png` | 复验 `refactor-v2` 真实预览 390×844 纸面配对页 |
| `32-reverify-v2-real-390-carbon.png` | 复验 `refactor-v2` 真实预览 390×844 碳黑配对页 |
| `33-reverify-v2-hash-login-list.png` | 复验 `50a6a0e`：`#token=` 链接冷启直进已认证列表 |
| `34-reverify-v2-reload-persisted.png` | 复验 `50a6a0e`：刷新重载保持登录态与分组折叠状态 |

---

## 6. 复验记录（`refactor-v2` / `50a6a0e`，全部 PASS）

1. **真实预览 `https://dsh.easymana.online:8443/preview/refactor-v2/`（真实 · PASS）**：
   - `index.html`（488,251 B）、`manifest.webmanifest`、`sw.js`、`icon-192.png`、`icon-512.png` 全部 HTTP 200；
   - `APP_VERSION = v251`，`sw.js CACHE = dsh-preview-refactor-v2-v251`，SW 状态 `activated`；
   - 线上产物代码核验：`hasFixedLsGet: true`（包含 `localStorage.getItem(k)`），`hasOldRecursiveBug: false`；
   - 390×844 与 430×932 双皮肤渲染正常，0 `console.error`、0 `pageerror`、0 `failedRequests`、0 横向溢出。
2. **本地单测（真实 · PASS）**：
   - `node --test tests/*.test.mjs`：**21/21 PASS**（新增 `tests/state.test.mjs` 覆盖 `localStorage` 冷启恢复）。
3. **冷启持久化与 `#token=` 恢复链接（模拟 · PASS）**：
   - **场景 A（空存储 + `#token=test-hash-tok&inst=test-inst`）**：加载后 `location.hash === ''`（hash 已清理），`localStorage['dsh.token'] === 'test-hash-tok'`、`localStorage['dsh.inst'] === 'test-inst'`，页面直接进入已认证列表（`.hero` 可见，非 `.pair`），0 `pageerror`（注：`mode='auto'` 在本地 `127.0.0.1` 背景探测局域网端口会记录一条预期的网络探测断连日志，非 JS 异常）。
   - **场景 B（预置 `dsh.token`/`dsh.inst`/`dsh.mode='relay'`/`dsh.collapsed='["w:ws-main"]'` 后整页 reload）**：直接进入已认证列表，`DSH Mobile PWA` 保持折叠（`.closed`）、`Nalì Spa CRM` 保持展开；进入「设置 → 连接」确认 `仅中转` 勾选 `✓` 且实例 ID 恢复；0 `console.error`、0 `pageerror`。
