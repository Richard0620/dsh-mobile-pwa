# F8 缓存 v2 复验报告（preview f8c）

- 被测：`https://dsh.easymana.online:8443/preview/f8c/`
- 分支 / commit：`feature/f8-indexeddb` / `e7b4d7e4e2c7ad55e5605ed87aee1b108af302af`
- 修复 commit：`e7b4d7e`（慢 open 时退登→换账号的跨账号缓存竞态）
- 本地代码：`D:\Vibe\PWA\pwa-g\index.html`（v249）
- 文档：`D:\Vibe\PWA\pwa-g\docs\cache-v2.md`
- 验收时间：2026-11-25（America/Los_Angeles）
- 结论：**定向 a/b/c/d/e 全部 PASS；回归 8 项全部 PASS；真机专属 3 项 UNVERIFIED；本轮未发现需要修的 FAIL**
- 机器断言：定向 a/b/c/d/e 的断言全部 PASS；回归 36 条全部 PASS

> 边界：**没有用真 iPhone/Safari/WebKit**。iPhone 环境是 Chrome for Testing 157 + CDP 模拟（390×844 / 430×932、DPR 3、Touch、iPhone Safari UA、安全区 47/34）。页面/静态资源/SW 走真实 HTTPS；宿主 API/SSE 打桩；未使用用户手机凭据，未改业务代码，未 push/部署。

---

## 0. 总表

| # | 场景 | 结论 | 证据 | 备注 |
|---|---|---|---|---|
| 0 | 真实部署产物加载（无注入） | **PASS** | `00-真实部署产物-390x844-配对页.png` | 真实 HTTPS；0 error/0 404；TTFB 612ms、FCP 1004ms、配对页 1467ms；仅 1 条弃用 warning |
| a | **核心竞态**：慢 open 时退登→立刻换账号 | **PASS** | `21-核心竞态-新账号登录后无旧内容.png` | 退登后界面无旧标题/消息；旧 open resolve 前后 `kv` 只有 `idx`，无旧 `msg/list`；新账号消息能写入并读出 |
| b | 退登没清成库就刷新页面（wipe 标记） | **PASS** | `22-待清标记-刷新后先清库再读.png` | 刷新后先清库再读；界面无旧内容；`dsh.cache.wipe.v2` 自动移除 |
| c | 正常时序（等 open 完成再退登→重登） | **PASS** | `17-同页重登-IDB与影子写恢复.png` | 30 条重新写入 IDB+legacy；删 legacy/延迟网络仍从 IDB 秒出；wipe 被消化 |
| d | b-fast：重登同 tick 开会话 | **PASS** | `23-b-fast-重登同tick开会话-IDB不miss.png` | 给 `idbInit` 150ms 延迟；开会话时 `openResolved=0`，800ms 后 IDB 仍写入 30 条 |
| e | 旧 abort 不打新 init | **PASS** | `21` | 旧 open 2s 后 resolve，新账号 DB 仍是 `idx`；之后新消息仍能写入 IDB（ready 等价观测） |
| f1 | 默认开启建库 | **PASS** | `01`、`02` | `dsh-mobile` 存在，`migrated.v2=1`，0 error/0 cache warn |
| f2 | 首次迁移只一次 | **PASS** | `03`、`04` | 改 legacy 为 `SHOULD_NOT_WIN_*` 后 reload，IDB 仍原值 |
| f3 | 读走 IDB | **PASS** | `05`、`06` | 删 legacy 后列表仍出，`firstRowAt≈202ms` |
| f4 | 限额 400/30 与 legacy 120/10 | **PASS** | `07`、`08` | IDB 300 条 / legacy 120；31 会话后 `msg:*=30`、legacy=10 |
| f5 | IDB 不可用：只 warn 一次、不弹 toast | **PASS** | `09`、`10` | open 抛错：`open=1/tx=0`，warn 1 条，toast=null |
| f6 | `dsh.cache.v2='0'` 回退，删除恢复 | **PASS** | `11`、`12` | v2 off：open=0/tx=0、无库；删除后恢复 |
| f7 | 网络延迟 3 秒，1 秒内从缓存出内容 | **PASS** | `13`、`14` | 列表 417ms；点会话后 **163ms 已有 120 条 `.msg`** |
| f8 | 退登清理 | **PASS** | `15` | 凭据/缓存键全清，IDB 0 条；仅剩设计要求的 wipe marker（见 §4） |
| D1 | iOS Safari IndexedDB 低存储/隐私模式 | **UNVERIFIED** | — | 未真机 |
| D2 | 切后台 10 分钟回来是否白屏 | **UNVERIFIED** | — | 只模拟 reload + 3s 延迟 |
| D3 | 大库首次打开耗时 | **UNVERIFIED** | — | 最大 300 条/32 会话，30×400 未真机测 |

**定向 5 项 + 回归 8 项：PASS 13 / FAIL 0；真机专属 UNVERIFIED 3。**

---

## 1. 产物一致性

| 项 | 值 |
|---|---|
| 本地 `index.html` SHA-256（原始字节） | `E06282331937074BDD57A59822413F7762109C176D22B80B63B9AF22207EA453` |
| 部署文件 SHA-256（含预览标记） | `47D52BDDF2CF3D589BB1618945D98A26D032535C91A77047A53A162ACC0918E7` |
| 剥离 4 处预览标记后 | `equal: true`，长度 305326 == 305326；规范化 SHA-256 为 `95aa56e997069e97b7c5dc02a0394d4332605517e840b6d3de5fbb3113314d9c` |
| HEAD | `e7b4d7e4e2c7ad55e5605ed87aee1b108af302af` |
| 工作区 | 仅 `?? docs/verify/F8-preview-b/`、`?? docs/verify/F8-preview-c/`；业务文件未改动 |

4 处预览标记：`window.__DSH_PREVIEW__={branch:'feature/f8-indexeddb',slug:'f8c'}`、`<title>AI-HUB · 预览 · feature/f8-indexeddb</title>`、`apple-mobile-web-app-title="DSH f8-index"`、末尾 `← 测试环境` 浮标（截图时隐藏）。

---

## 2. 修复点对照

| 修复点 | 代码位置 | 本轮验证 |
|---|---|---|
| 退登记 `clearPending` + 持久 wipe 标记 + 清 UI 状态 | `clearLocalCaches` `index.html:1188-1212`；`resetClientCachesForLogout` `1168-1181` | a/b：退登后 UI 无旧内容，wipe=1；刷新后先清再读 |
| 先清后读（clear-before-read） | `idbInit` 读 wipe 标记 `1038`，clear store `1058-1074` | a：旧 open 前后 `kv` 只有 `idx`，无旧 `msg/list`；b：wipe 自动移除 |
| 旧 abort token 语义 | `idbAbortAndClear` `1016-1032` | e：旧 open 2s resolve 后新层仍可写新账号缓存 |
| hydrate/prefetch gen 守卫 | `idbHydrateMsgs` `983-999`；`idbPrefetchMsg` `1155-1163` | a：旧数据未进内存镜像；界面无旧消息 |
| `refreshAll/loadArchived/loadMessages` token 快照 | `6371-6378`、`3945-3952`、`6553-6560` | a：旧账号晚到响应不写入新账号 |
| b-fast 未 ready 时挂到 initP 补写 | `idbQueueUntilReady` `1109-1118`；`idbSaveList/Msg` `1119-1131` | d：150ms 延迟下同 tick 开会话，IDB 仍写入 30 条 |

---

## 3. 定向逐条

### a. 核心竞态（慢 open → 退登 → 立刻换账号）— PASS

测试方法（同一套 2s 慢 open）：

1. 旧账号打开 30 条会话，确认 IDB `msg:<sid>=30`；
2. `indexedDB.open` 延迟 **2000ms** 后 reload；
3. 启动 `await` 上限 1.2s 后首个可交互帧（`atRows=1572.8ms`、`openDelay=2000`、`openCalls=1`、`openResolved=0`）退登（`logoutAt=1588ms`）；
4. **不刷新页面**，立刻用另一账号恢复链接登录；
5. 旧的 2s open 在后台 resolve。

结果：

- **退登瞬间**：页面已是配对页，body 无「旧账号」字样；`localStorage.length=1`（只剩 `dsh.cache.wipe.v2=1`），`localMsgs=null`。
- **重登后、旧 open resolve 前**（150ms 采样）：
  - `rows=[]`，body 无旧账号内容；
  - `kv` keys 只有 `['idx']`，**没有旧 `msg:*`，没有旧 `list`**；
  - `wipe` 已变 null（说明 clear-before-read 已执行并成功）。
- **旧 open resolve 后**（`openResolved=1`）：
  - 仍 `kv=['idx']`，无旧数据；body 无旧账号；
  - 没有因为旧 abort 把新层打回 false（此时新 init 已 ready）。
- **网络返回后**：
  - 列表出现新账号标题（「新账号主会话/副会话」）；
  - 打开新账号会话 → 消息「新账号的新消息」；
  - IDB `msg:<sid>` 写入 **1 条**，legacy `=1`，`wipe=null`；
  - 之后旧 abort 已发生（`openResolved=1`），新消息仍能写入 IDB（ready 的等价观测）。
- **新账号缓存可读出**：删掉 legacy `dsh.cache.msgs`、把 `/session/messages` 延迟 3 秒后重开新账号会话，1 条「新账号的新消息」仍从缓存显示（`legacy=null`，`a7`）。

本轮的旧账号 30 条在新账号下**没有出现**，上一轮 c-2 的跨账号串读已修复。证据 `21`。

### b. wipe 标记：退登没清成库就刷新页面 — PASS

1. 旧账号 30 条 → `open` 延迟 2s → reload → 首个可交互帧退登（此时 `db=null`，无法当场清库）；
2. 退登后：`wipe=1`、`localLen=1`（仅 marker）、配对页、body 无旧内容；
3. 不重登，直接 reload，`__F8.setDelay(3000)` 阻止网络回填；
4. 刷新后：
   - 仍是配对页，body 无旧内容；
   - `kv` keys 只有 `['idx']`，**无旧 `msg:*` / `list`**；
   - `wipe=null`（标记已自动移除）；
   - `localLen=2`：`dsh.cache.schema` 与 `dsh.cache.migrated.v2` 两个内部标记，不是旧账号内容。
5. 无 console error / cache warn。

证据 `22`。

### c. 正常时序：等 open 完成再退登 → 重登 — PASS

- 旧账号 30 条；正常等 open 完成后退登：
  - `localLen=1`（wipe）、`localMsgs=null`、IDB `kv=[]`、配对页。
- 同页恢复链接重登（不刷新），100ms 后打开同一内容会话：
  - IDB `msg:<sid>=30`、legacy `=30`；
  - `wipe=null`（已消化）；
  - 删掉 legacy `dsh.cache.msgs`、`/session/messages` 延迟 3 秒后重开同一会话：30 条仍立刻出现（`elapsed≈516ms`），说明 `readMsgCache` 走 IDB/内存镜像。
- 0 error / 0 warn。证据 `17`。

### d. b-fast：重登同一 tick 开会话 — PASS

- 退登后，给新的 `idbInit` 加 **150ms** open 延迟；
- 恢复链接登录后**立刻**点开会话（`clickAt=1708.7ms`）：
  - 开会话瞬间 `openResolved=0`、`openDelay=150`、`wipe=1`（库还没 ready）；
  - 800ms 后：IDB `msg:<sid>=30`、`wipe=null`、`openResolved=1`。
- 说明 `idbQueueUntilReady` 的补写生效，首次 IDB 写入不再 miss。
- 证据 `23`。

### e. 旧 abort 不打新 init — PASS

- a 的慢 open 场景里，旧 init 在 2s 后 resolve；新账号的 init 已于 1.7s 左右完成并 ready。
- 旧 abort 后：
  - `kv` 仍有新 init 写的 `idx`，无旧数据；
  - 新账号消息随后成功写入 IDB（a4/e2）；
  - 没有出现 `ready` 被打回 false 后无法写缓存的现象。
- 代码对应：`idbAbortAndClear(conn, gen, token)` 先判断 `initToken` 是否已被新 init 接手；只有没有接手时才 `gen++`、清内存镜像（`index.html:1016-1032`）。

---

## 4. 回归 8 项（全部 PASS）

| 项 | 结果 | 关键数据 |
|---|---|---|
| 默认开启 | PASS | `databases()` 含 `dsh-mobile`；`migrated.v2=1`；0 error/0 cache warn；390/430 均正常 |
| 迁移只一次 | PASS | 2 会话 / 2+3 消息进 IDB；legacy 改 `SHOULD_NOT_WIN_*` 后 reload，IDB 原值不变 |
| 读走 IDB | PASS | 删 legacy 后 2 行仍出；`firstRowAt≈202ms`；`localList/localMsgs=null` |
| 限额 | PASS | IDB 300 / legacy 120；31 会话后 `msg:*=30`、`idx=30`、legacy=10 |
| 降级 | PASS | open 抛错：`open=1/tx=0`，warn 恰好 1 条，toast=null，列表/消息走 legacy |
| 回退开关 | PASS | `'0'`：open=0/tx=0、无 `dsh-mobile`；删键重载：open=3、库在、`migrated=1`、list=2 |
| 3 秒延迟 | PASS | 列表 417ms；点会话后 **163ms 有 120 条 `.msg`**（`firstMsgAt=511ms`）；3s 后仍 120 |
| 退登清理 | PASS | IDB 0 条、凭据/缓存键清空、配对页；**只保留设计要求的 wipe marker**（见 §4） |

回归 36 条断言全部 True。

---

## 5. 观察 / 非阻塞风险

1. **退登后 `localStorage.length` 不是 0，而是 1**：保留 `dsh.cache.wipe.v2='1'`。这是本次修复**故意**的持久待清标记；敏感数据（token/inst/list/msgs）已清空。若验收脚本按字面 `length===0` 会误判，建议文档写清「仅允许 wipe marker」。本报告把 a/f8 记为 PASS 并在此说明。
2. **b-fast 的 150ms 延迟**是人为放大窗口；`idbQueueUntilReady` 已能把未 ready 的写入挂到 `initP` 后补一次，测试通过。未测 0ms + 2s open 的极端组合（属于同一队列机制）。
3. **延迟 3 秒时 strip 显示“实时连接断开”**：与 F8 无关的既有会话 UI 行为（`state.stream='idle'` truthy，`index.html:5017-5019`；`subscribeSession` 要等 `loadMessages`）。缓存内容已经显示，网络回来自动恢复。
4. **IDB 400 条无体积兜底**：文档自述；极端长文/30 会话可能接近配额，写失败会 warn 一次并回落 legacy。
5. **启动等待**：默认开启时启动 `await Promise.race([idbInit, 1200ms])`；正常 20–50ms，未测满 1.2s 卡顿。
6. **文档/注释默认态仍对齐**：本地扫描 index.html 无「默认关」/removeItem=回滚；docs/cache-v2.md 只有第 298 行 §10 历史记录里的「初期默认关闭…改为默认开启」一条。

---

## 6. 真机才能验的三条（UNVERIFIED）

1. **iOS Safari IndexedDB 在低存储 / 隐私模式**：配额、`QuotaExceededError`、系统逐出 `dsh-mobile`、隐私模式是否允许 IDB；代码有 3s open 超时和写失败 warn 一次，但真机配额路径未跑。
2. **切后台 10 分钟后回来**：本轮是 reload + 3s 延迟，不是 iOS 杀 WebContent/清内存。真机上 `memMsgs` 被回收后 `readMsgCache` 会 miss 并触发 `idbPrefetchMsg`，能否 1 秒内补画未验证。
3. **大库首次打开耗时**：本轮最大 300 条/32 会话；30×400 条、单条长文导致的数百 MB 库，`getAll`/structured clone 在低端 iPhone 上的耗时未测。

---

## 7. 真实 vs 模拟

| 项目 | 真实/模拟 | 说明 |
|---|---|---|
| 预览页面、manifest、icon、sw.js | **真实** | 真实 HTTPS；0 404/0 failed |
| 部署产物 vs 本地 commit | **真实** | 剥离 4 处预览标记后字节级相等 |
| 首次打开（00） | **真实** | 无 token、无注入 |
| `/api/mobile/v1/*` | **模拟** | 预加载 fetch 打桩 |
| SSE | **模拟** | `ReadableStream` + 心跳 |
| IndexedDB/localStorage | **真实浏览器 API** | 真写/真读，但运行在 Chrome，不是 Safari |
| 视口/DPR/UA/触摸/安全区 | **模拟** | CDP，不是 iPhone 硬件 |
| 3s 网络延迟 / 2s open 延迟 | **模拟** | stub sleep / delayed-open 请求 |
| 新账号数据 | **模拟** | mock 替换，未用第二台真机/真实账号 |

未做：使用用户手机凭据、连真实宿主、push/部署/装依赖、改业务文件。

---

## 8. 复现

1. 独立 Chrome：`--headless=new --remote-debugging-port=9492 --user-data-dir=%TEMP%\f8c-verify\p1 --ignore-certificate-errors`。
2. CDP：390×844 / 430×932、DPR 3、Touch、iPhone UA、安全区 47/34。
3. 预加载 `stub.js`（fetch/SSE/IDB 计数/`openDelay`/账号切换），导航 `https://dsh.easymana.online:8443/preview/f8c/#token=fake&inst=fake`。
4. a：旧账号 30 条 → `__F8.setOpenDelay(2000)` → reload → 首个可交互帧退登 → 同页恢复链接登录新账号 → 采样 body/IDB/scroll。
5. b：退登后不登录，直接 reload；读 `dsh.cache.wipe.v2`、IDB keys、DOM。
6. c：正常等 open 完成再退登 → 重登 → 读写 IDB。
7. d：重登前 `setOpenDelay(150)`，登录后同 tick 开会话，800ms 后读 IDB。
8. e：a 场景中旧 open 2s resolve 后检查新账号 `kv` 与新写入。

脚本在 `%TEMP%\f8c-verify\`（`t0..t8.cjs`、`acore.cjs`、`bwipe.cjs`、`ab.cjs`、`bfast.cjs`、`d.cjs`、`stub.js`）。只写临时目录与报告目录。

---

## 9. 截图索引

| 文件 | 内容 |
|---|---|
| `00-真实部署产物-390x844-配对页.png` | 真实加载配对页 |
| `01-默认开启-390x844-列表.png` | 默认 v2 开 |
| `02-默认开启-430x932-列表.png` | 430 视口 |
| `03-首次迁移-IDB已写入.png` | 迁移后列表 |
| `04-重载后-IDB未被旧localStorage覆盖.png` | 旧 legacy 不覆盖 IDB |
| `05-删掉localStorage后-列表仍从IDB秒出.png` | 只靠 IDB（390） |
| `06-IDB秒出-430x932.png` | 只靠 IDB（430） |
| `07-长会话300条-只渲染最近120条.png` | 300 条缓存 |
| `08-31个会话后-IDB稳定30条.png` | 30 会话上限 |
| `09-IDB不可用-回落localStorage-无toast.png` | open 抛错降级 |
| `10-IDB不可用-消息仍从legacy读写.png` | 降级会话消息 |
| `11-回退开关-只走localStorage-无IDB.png` | v2 off |
| `12-删掉回退开关-恢复v2.png` | 恢复 v2 |
| `13-网络延迟3秒-会话1秒内从缓存出内容.png` | 1 秒内 120 条 |
| `14-网络3秒后返回-仍是同一会话.png` | 网络返回 |
| `15-退出登录-清空IDB与localStorage.png` | 退登清理 |
| `17-同页重登-IDB与影子写恢复.png` | c：重登后 30 条恢复 |
| `21-核心竞态-新账号登录后无旧内容.png` | a：新账号下无旧内容 |
| `22-待清标记-刷新后先清库再读.png` | b：wipe 标记刷新后消费 |
| `23-b-fast-重登同tick开会话-IDB不miss.png` | d：b-fast 补写成功 |

---

## 10. 最终结论

- **a 核心竞态已修复**：同样 2s 慢 open + 首个可交互帧退登 + 立刻换账号，退登瞬间/旧 open resolve 前后/新账号登录后都没有旧标题或旧消息；旧 `kv` 无 `msg/list`，新账号消息能重新写入并读出。
- **b/c/d/e 全部 PASS**：wipe 标记跨刷新生效并自动移除；正常重登缓存恢复；b-fast 补写不漏；旧 abort 不打掉新 init。
- **回归 8 项 PASS，无退化。**
- **必须修的项：无。**
- **需要留意（非阻塞）**：退登后 `localStorage` 保留一个 `dsh.cache.wipe.v2` 标记（设计如此）；3 秒弱网下会话 UI 会短暂显示“实时连接断开”（既有行为，不影响缓存）；IDB 400 条无体积兜底。
- **真机专属 3 项 UNVERIFIED**：Safari 低存储/隐私模式、后台 10 分钟、大库首次打开耗时。
