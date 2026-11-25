# F8 缓存 v2 Preview 独立验收报告

- 被测：`https://dsh.easymana.online:8443/preview/f8/`
- 分支 / commit：`feature/f8-indexeddb` / `fbfa700`（HEAD 与 `fbfa700a377cac88dc5d9aaf08aee92a4b7d61b4` 一致）
- 本地代码：`D:\Vibe\PWA\pwa-g\index.html`（v249，单文件）
- 说明文档：`D:\Vibe\PWA\pwa-g\docs\cache-v2.md`
- 验收时间：2026-11-25（America/Los_Angeles）
- 结论：**必验 8 项全部 PASS（8/8，0 FAIL）；附加检查发现 2 个 FAIL（退登后同页重登缓存不恢复、文档/注释默认态自相矛盾）；真机专属 3 项 UNVERIFIED**
- 机器断言：**36 条**（T1 4 / T2 4 / T3 3 / T4 4 / T5 6 / T6 6 / T7 5 / T8 4）全部按预期 True；另 T0 真实部署加载 PASS

> 重要边界：**没有用真 iPhone / Safari / WebKit**。iPhone 环境是 **Chrome for Testing 157 + CDP 模拟**（390×844、430×932、DPR 3、Touch、iPhone Safari UA、安全区 47/34）。页面、manifest、icon、sw.js 走**真实 HTTPS**；宿主 API/SSE 用预加载脚本打桩；**未使用任何用户手机凭据 / `~/.dsh`**。未改 `index.html` / `sw.js` / `APP_VERSION` / `PWA-优化清单.md`，未 push、未部署、未安装依赖。

---

## 0. 总表

| # | 场景 | 结论 | 证据 | 备注 |
|---|---|---|---|---|
| 0 | 真实部署产物加载（无注入） | **PASS** | `00-真实部署产物-390x844-配对页.png` | 真实 HTTPS；0 console error、0 404、0 failed；FCP 988ms、TTFB 591ms、配对页 1577ms；仅 1 条弃用 warning |
| 1 | 默认开启：IDB `dsh-mobile` + `migrated.v2=1` | **PASS** | `01-默认开启-390x844-列表.png`、`02-默认开启-430x932-列表.png` | `dsh.cache.v2` 为 null（默认开）；`list.sessions=2`；0 error、0 `[cache-v2]` warn |
| 2 | 首次迁移只做一次，旧数据不被覆盖 | **PASS** | `03-首次迁移-IDB已写入.png`、`04-重载后-IDB未被旧localStorage覆盖.png` | seed 2 会话/2+3 消息全部进 IDB；改 localStorage 为 `SHOULD_NOT_WIN_*` 后重载，IDB 仍是原值，`at` 不变 |
| 3 | 读走 IDB：删掉 localStorage 列表仍秒出 | **PASS** | `05-删掉localStorage后-列表仍从IDB秒出.png`、`06-IDB秒出-430x932.png` | 删两个 legacy key 后重载：`localList/localMsgs=null`，2 行列表仍出，`firstRowAt≈200ms` |
| 4 | 限额：300 条 / 30 会话 / legacy 影子写 | **PASS** | `07-长会话300条-只渲染最近120条.png`、`08-31个会话后-IDB稳定30条.png` | IDB `msg:long300=300`，legacy `=120`；开 31 个会话后 `msg:*=30`、`idx.msgAt=30`、legacy 会话=10 |
| 5 | 降级：`open()` 抛错仍可用、只 warn 一次、不弹 toast | **PASS** | `09-IDB不可用-回落localStorage-无toast.png`、`10-IDB不可用-消息仍从legacy读写.png` | `openCalls=1`、`txCalls=0`；warn 恰好 1 条 `[cache-v2]`；toast=null；列表/消息从 legacy 正常 |
| 6 | 回退开关 `dsh.cache.v2='0'`：不 open/不事务；删键恢复 v2 | **PASS** | `11-回退开关-只走localStorage-无IDB.png`、`12-删掉回退开关-恢复v2.png` | v2 off：open=0、tx=0、`databases()` 无 `dsh-mobile`；删除键重载后 open=3、库在、`migrated=1`、list=2 |
| 7 | 网络延迟 3 秒，回放 1 秒内从缓存出内容 | **PASS** | `13-网络延迟3秒-会话1秒内从缓存出内容.png`、`14-网络3秒后返回-仍是同一会话.png` | 列表 226ms 出；点会话后 **182ms 已有 120 条 `.msg`**（`firstMsgAt` 517ms）；3 秒后网络返回仍 120 条 |
| 8 | 退登清理 IDB + localStorage | **PASS** | `15-退出登录-清空IDB与localStorage.png` | 退登前 IDB 5 条/legacy 有；退登后 `localStorage.length=0`、IDB `kv` 0 条、回到配对页 |
| A1 | 附加：退登后同页恢复链接登录，缓存是否恢复 | **FAIL** | `16-退登后同页重登-缓存未回写.png` | 消息 2 条来自网络，但 `localStorage['dsh.cache.msgs']={}`、IDB `msg:*=[]`；见 §4-A1 |
| A2 | 附加：文档/注释的默认态是否与代码一致 | **FAIL** | — | `docs/cache-v2.md:18-19` 仍写“removeItem=回滚”，代码注释仍写默认关；见 §4-A2 |
| R1 | 真机 iOS Safari：IndexedDB 在低存储/隐私模式 | **UNVERIFIED** | — | 只在桌面 Chrome 模拟；Safari 配额/逐出/隐私模式未验证 |
| R2 | 真机：切后台 10 分钟后回来是否真的不白屏 | **UNVERIFIED** | — | 只模拟“重载 + 网络延迟”；iOS 可能杀 WebContent、清内存镜像 |
| R3 | 真机：大库首次打开耗时 | **UNVERIFIED** | — | 本轮最大 300 条/32 会话；30×400 条、数百 MB 未在真机测 |

**必验 8 项：PASS 8 / FAIL 0 / UNVERIFIED 0。附加：PASS 0 / FAIL 2。真机专属：UNVERIFIED 3。**

---

## 1. 被测产物一致性

预览服务在部署文件里加了 4 处测试环境标记；剥离后与本地 `index.html` **完全相等**：

| 项 | 值 |
|---|---|
| 本地 `index.html` SHA-256（原始字节） | `56C406CDF0B2645D0D73F016BB92AE3126AD3ACC233819C9787FC9DDB258BE1A` |
| 部署文件 SHA-256（含预览标记） | `98579BAE4849F15A882A06B2317A5A58E61E10DD8FBE86EC5779C8B028F1DD0B` |
| 剥离标记后比较 | `equal: true`，长度 299141 == 299141 |
| HEAD | `fbfa700a377cac88dc5d9aaf08aee92a4b7d61b4` |
| 工作区 | 仅 `?? docs/verify/`；业务文件未改动 |

被剥离的 4 处：`window.__DSH_PREVIEW__` 脚本、`<title>AI-HUB · 预览 · feature/f8-indexeddb</title>`、`apple-mobile-web-app-title="DSH f8-index"`、末尾悬浮的 `← 测试环境` 链接。第 4 项会盖住输入框左上角；B 组截图用预加载样式隐藏，A 组（`00`）保留原样。它不是产品 UI。

---

## 2. 环境与方法

| 项 | 值 |
|---|---|
| 引擎 | Chrome for Testing **157.0.8103.80**，`--headless=new`，独立 `--user-data-dir` |
| 驱动 | 原生 CDP（`ws` 来自 `C:\Users\richard\.dsh\profiles\desktop\node_modules\ws`，未装包） |
| 视口 | 390×844 与 430×932，DPR 3，`mobile:true` |
| UA | `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) ... Version/17.5 Mobile/15E148 Safari/604.1` |
| 触摸 | `Emulation.setTouchEmulationEnabled{maxTouchPoints:5}` |
| 安全区 | `Emulation.setSafeAreaInsetsOverride{top:47,bottom:34}`；实测 `--safe-t=47px`、`--safe-b=34px` |
| 网络 | 页面/静态资源真实 HTTPS；API/SSE 打桩 |
| 打桩 | `Page.addScriptToEvaluateOnNewDocument` 预加载：`fetch` JSON、`ReadableStream` SSE/心跳、可选 3s 延迟、`IDBFactory.prototype.open` 计数/抛错 |
| 种子 | 预加载里在 app 脚本前写 `dsh.cache.list` / `dsh.cache.msgs` / `dsh.cache.schema=1`；用 `__f8_seeded` 保证**只种一次**，reload 不会把删掉/改掉的 legacy 又种回来 |
| 数据读取 | 页面内 `__F8.idbAll()/idbGet()/idbKeys()` 直接读 `dsh-mobile/kv`；`indexedDB.databases()` 看库是否存在 |

辅助脚本在 `%TEMP%\f8-verify\`（`t0..t9.cjs` + `stub.js` + `common.cjs`），没有写进仓库。

---

## 3. 逐项验收

### 3.1 默认开启（必验 1）— PASS

证据：`01-默认开启-390x844-列表.png`、`02-默认开启-430x932-列表.png`

- 干净 profile，`localStorage['dsh.cache.v2']` 为 **null**（没有手动开）。
- `await indexedDB.databases()` → `[{name:'dsh-mobile'}]`。
- `localStorage['dsh.cache.migrated.v2'] === '1'`。
- IDB `list.sessions.length=2`，标题为 mock 的 A/B；`list.at` 有值。
- Console：0 个 error / exception，0 条 `[cache-v2]` warning。
- 430×932：`scrollWidth=430`、`row` 宽 402，无横向溢出；截图 `02`。

### 3.2 首次迁移只做一次（必验 2）— PASS

证据：`03-首次迁移-IDB已写入.png`、`04-重载后-IDB未被旧localStorage覆盖.png`

- 启动前 seed：`dsh.cache.schema=1`、`dsh.cache.list`（2 会话）、`dsh.cache.msgs`（`seed-s1` 2 条、`seed-s2` 3 条）。
- 启动后 IDB：
  - `list.sessions.length=2`，标题「迁移会话一/二」
  - `msg:seed-s1.messages.length=2`、`msg:seed-s2=3`
  - `migrated=1`
- 迁移后把 legacy 改成 `SHOULD_NOT_WIN_LIST` / `SHOULD_NOT_WIN_MSG` 并 reload：
  - `after.localTitle=SHOULD_NOT_WIN_LIST`、`after.localMsg=SHOULD_NOT_WIN_MSG`（证明改的是 legacy）
  - IDB `title=迁移会话一`、`msg=迁移前一`、`listAt/msgAt` 与迁移时完全一致（证明没有被旧 legacy 覆盖、迁移没有重跑）
- Console：0 error、0 `[cache-v2]` warn。

### 3.3 读走 IDB（必验 3）— PASS

证据：`05-删掉localStorage后-列表仍从IDB秒出.png`、`06-IDB秒出-430x932.png`

- 先 seed + 迁移，确认 IDB 有 2 会话；然后删掉 `dsh.cache.list` 与 `dsh.cache.msgs`，reload。
- 510ms 时：`localList=null`、`localMsgs=null`，但列表已画出 2 行「只靠 IDB 的会话一/二」。
- `window.__F8.firstRowAt≈200ms`（page performance；导航后）。
- 430×932 下同样 2 行、`scrollWidth=430`。

### 3.4 限额（必验 4）— PASS

证据：`07-长会话300条-只渲染最近120条.png`、`08-31个会话后-IDB稳定30条.png`

- mock 会话 `long300` 返回 **300 条**消息；打开后：
  - IDB `msg:long300.messages.length=300`（>120、≤400）
  - legacy `dsh.cache.msgs.long300.messages.length=**120**`（影子写，旧规则）
  - 页面 `.msg` 数量 **120**（渲染上限，符合旧行为）
- 再依次打开 31 个批量会话（`bulk-00…bulk-30`，每个 2 条）后：
  - IDB `msg:*` keys = **30**，`idx.msgAt` keys = **30**（`bulk-01…bulk-30`；`long300` 与 `bulk-00` 被淘汰）
  - legacy `dsh.cache.msgs` 会话数 = **10**（旧上限）
  - `legacyMax=2`（每会话条数未超限）
- 无 error、无 `[cache-v2]` warn。

### 3.5 降级（必验 5）— PASS

证据：`09-IDB不可用-回落localStorage-无toast.png`、`10-IDB不可用-消息仍从legacy读写.png`

- 预加载把 `IDBFactory.prototype.open` 替换为直接 `throw new Error('IDB open blocked by test')`。
- 启动：列表 2 行从 legacy seed 出；`openCalls=1`、`txCalls=0`；`migrated=null`。
- Console：`[cache-v2] IndexedDB 不可用，自动回落 localStorage（不弹提示）...` **恰好 1 条**；无其他 warning/error。
- `document.querySelector('.toast')` 为 **null**（不弹 toast）。
- 打开会话：消息 2 条从 legacy 读出并渲染；`dsh.cache.msgs['seed-s1'].messages.length=2`（写也回落 legacy）。

### 3.6 回退开关（必验 6）— PASS

证据：`11-回退开关-只走localStorage-无IDB.png`、`12-删掉回退开关-恢复v2.png`

- 启动前 `dsh.cache.v2='0'`，seed 2 会话（legacy）。
- 启动后：`openCalls=0`、`txCalls=0`、`indexedDB.databases()` 为 `[]`（没有建库）；列表 2 行从 legacy 出；`migrated=null`。
- 删除 `dsh.cache.v2`（回到默认 on）后 reload：`openCalls=3`、`databases()` 含 `dsh-mobile`、`migrated=1`、IDB `list.sessions.length=2`；列表仍 2 行，0 cache warn。

### 3.7 回来不白屏（必验 7，重点）— PASS

证据：`13-网络延迟3秒-会话1秒内从缓存出内容.png`、`14-网络3秒后返回-仍是同一会话.png`

流程：

1. 正常网络打开 300 条会话，等 `msg:blank300.messages.length=300`。
2. 删掉 `dsh.cache.list/msgs`，把 stub 的 `/sessions` 与 `/session/messages` 延迟设为 **3000ms**，reload。
3. 列表：`firstRowAt=226.2ms`，两行都在，`localStorage` 两个 key 仍为 null（证明来自 IDB）。
4. 点会话：
   - 点击后 **161–182ms**：`.msg` = **120** 条（已从 IDB 内存镜像画出）；
   - 500ms / 1010ms / 1515ms 采样均为 120；
   - `firstMsgAt=517ms`（page performance，点击时刻 512.5ms）；
   - 1 秒内没有白屏/骨架屏。
5. 3 秒后 `/session/messages` 返回（`msgReqs=2`），仍是 120 条，内容不跳空。

> 观察：这 1 秒内底部 strip 显示「实时连接断开，重连中…」。原因不是 F8：`state.stream` 初始为 `'idle'`（`index.html:1641`），而 `subscribeSession()` 要等 `loadMessages()` 完成才调用（`index.html:6313-6314`）；网络被延迟时它还没连上。内容已经出来，3 秒后正常。见 §5。

### 3.8 退登清理（必验 8）— PASS

证据：`15-退出登录-清空IDB与localStorage.png`

- 退登前：打开会话 → IDB `msg:logout-s1` 5 条；legacy 有 `logout-s1`；`localStorage.length=8`。
- 设置 → 「退出登录」点击后：
  - 回到配对页（`.pair`）
  - `localStorage.length=0`，`dsh.cache.list/msgs` 均为 null
  - IDB `kv` store 0 条（库 `dsh-mobile` 仍在，允许）
  - 0 console error
- 说明：清理路径是 `clearLocalCaches()`（`index.html:1066-1076`），先 `localStorage.clear()`，再对 IDB store `clear()`。

---

## 4. FAIL 明细

### A1. 退登后同页恢复链接登录：缓存不恢复（附加 FAIL）

- **复现步骤**：
  1. 正常登录（mock）→ 打开一个 2 条消息的会话，确认 IDB `msg:<sid>` 已写入；
  2. 设置 → 退出登录（`clearLocalCaches()`）；
  3. 在同一个配对页「粘贴恢复链接」→「用链接登录」（**不刷新页面**）；
  4. 打开同一个会话，等消息从网络渲染出来；
  5. 读 `localStorage['dsh.cache.msgs']` 与 IDB `msg:*`。
- **期望**：重新登录后缓存层继续工作：legacy 至少写回，IDB 在下次打开时应重新可用。
- **实际**：消息 2 条能从网络显示，但 `localStorage['dsh.cache.msgs'] = {}`（keys 空），IDB `msg:* = []`；即本轮登录后的首屏没有写回任何缓存。
- **截图**：`16-退登后同页重登-缓存未回写.png`
- **疑似原因**（两处叠加）：
  1. `clearLocalCaches()` 把 `idbState.ready=false`、`idbState.failed=true`，但**没有重置** `idbState.initP` / `failed` / `db`（`index.html:1066-1076`）；`idbInit()` 见 `idbState.initP` 已 settled 就直接返回（`index.html:990-1024`），所以 `idbUsable()` 永远 false，v2 在本页内被关掉，直到整页刷新。
  2. `msgCacheSig` 是模块级变量，退登时没有清（`index.html:1174-1181`）；重新登录后同一会话的 `sid:条数:lastSeq:最后一条id` 与退登前相同，`saveMsgCache()` 直接 `return`，连 legacy 都不写。
- **影响**：安全上没问题（旧数据确实清空了）；但用户退登再登录后，F8 的缓存在当前页面内静默失效，直到下次冷启动；这会让“换账号后依然秒开”的预期落空。
- **修复建议**：`clearLocalCaches()` 里重置 `msgCacheSig=''`，并重置/关闭 IDB 状态（`idbState.failed=false; idbState.initP=null; idbState.db=null`，或 `location.reload()` 后再进入）；重新登录成功后也可主动 `idbInit()` 一次。

### A2. 文档/注释仍写“默认关 / remove 即回滚”（附加 FAIL）

- **复现步骤**：读 `docs/cache-v2.md` §1 与代码注释。
- **期望**：默认开启；只有 `localStorage['dsh.cache.v2']='0'` 才回退；删除键 = 恢复默认开启。
- **实际**：
  - `docs/cache-v2.md:18-19`：
    `localStorage.setItem('dsh.cache.v2','1'); // 打开`
    `localStorage.removeItem('dsh.cache.v2'); // 回滚（等价于关）`
    这与同文档第 5 行、代码 `index.html:832` 的默认开启相矛盾。
  - `index.html:818-820` 注释仍写「默认（`!== '1'`）只有 legacy」；`index.html:6538` 写「缓存层 v2（默认关）」。
- **影响**：测试/运维按文档 `removeItem` 以为回退了，实际仍默认开启；容易误判线上行为。
- **修复建议**：把 §1 代码块改成「`'1'` 显式打开 / 删除键 = 默认开 / `'0'` 回退」，并改两处代码注释。

---

## 5. 观察 / 非阻塞风险

1. **延迟 3 秒时 strip 显示“实时连接断开”**：不是 F8 的缓存问题，是会话 UI 的既有行为——`state.stream` 初始 `'idle'`（`index.html:1641`）被当作 truthy，`index.html:5017-5019` 会显示断开文案；`subscribeSession` 又要等 `loadMessages`（`6313-6314`）。内容已从缓存显示，3 秒后消失。若要优化，可把 `idle` 显示成“连接中…”或提前订阅。
2. **IDB 400 条无体积兜底**：`docs/cache-v2.md` 自己承认，单条大消息/30 会话可能到几百 MB，Safari 配额下会写失败并 warn；此时仍靠 legacy。属已知设计取舍，未改。
3. **启动等 IDB 最多 1.2 秒**：`index.html:6541-6543` 用 `Promise.race` 等 `idbInit`；open 卡死时首屏最多被拖 1.2 秒（不会永久白）。本轮 open 抛错是立即返回，未测满 1.2 秒场景。
4. **注释“默认关”与代码默认开不一致**：见 §4-A2；不是逻辑 bug，但会误导后续维护。
5. **预览浮标**：`← 测试环境` 会压住输入框左上角；B 组截图已隐藏，A 组保留；只在 preview 存在。

---

## 6. 真机才能验的三条（UNVERIFIED）

1. **iOS Safari 的 IndexedDB 在低存储 / 隐私模式下的行为**  
   本轮用 Chrome 的 IDB；Safari 的配额、`QuotaExceededError`、隐私模式是否允许 IDB、系统在低存储时是否逐出 `dsh-mobile`，均未验证。代码有 `open` 超时 3 秒与写失败 warn 一次的保护（`index.html:852-880`、`923-928`），但真机配额路径没跑过。
2. **切后台 10 分钟后回来是否真的不白屏**  
   本轮是“reload + 网络延迟 3 秒”，不是 iOS 杀 WebContent/清内存。真机上 `memMsgs` 镜像可能被回收，`readMsgCache()` 会 miss 并触发 `idbPrefetchMsg()`，但本次打开是否还来得及在 1 秒内画出内容，需要在真机切后台 10 分钟验证。
3. **大库首次打开耗时**  
   本轮最大 300 条/32 会话；`30 会话 × 400 条`、单条长文（整段代码）造成的几百 MB 库，首次 `idbGetAll()` 预热/结构化克隆耗时未测。`idbHydrateMsgs()` 是后台任务，但真机低端 CPU 上可能超过用户等待窗口。

---

## 7. 真实 vs 模拟

| 项目 | 真实 / 模拟 | 说明 |
|---|---|---|
| 预览页面、manifest、icon、sw.js | **真实** | 真实 HTTPS 拉取；0 404 / 0 failed |
| 部署产物与本地 commit | **真实** | 剥离 4 处预览标记后字节级相等（§1） |
| 首次打开（T0） | **真实** | 无 token、无预加载、无注入 |
| `/api/mobile/v1/*` | **模拟** | 预加载 fetch 打桩；未用真机凭据/真实宿主 |
| session/device SSE | **模拟** | `ReadableStream` + 心跳；断流/延迟可控 |
| IndexedDB | **真实浏览器 API** | 但运行在 Chrome，不是 Safari；数据是真写/真读 |
| `localStorage` | **真实浏览器 API** | 同上 |
| 视口/DPR/UA/触摸/安全区 | **模拟** | Chrome CDP；不是 iPhone 硬件 |
| 网络延迟 3 秒 | **模拟** | 打桩 sleep，不是真实弱网/丢包 |
| `indexedDB.open` 失败 | **模拟** | `IDBFactory.prototype.open` 抛错 |

**没有做的事**：没有使用用户的手机配对凭据，没有连真实宿主，没有 push/部署/装依赖，没有改业务代码。

---

## 8. 复现

1. 启动独立 Chrome：
   `chrome.exe --headless=new --remote-debugging-port=9460 --user-data-dir=%TEMP%\f8-verify\p1 --ignore-certificate-errors about:blank`
2. CDP 设置：`Emulation.setDeviceMetricsOverride{390,844,3,mobile}`、`setTouchEmulationEnabled`、`setUserAgentOverride{iPhone UA}`、`setSafeAreaInsetsOverride{47/34}`。
3. 预加载 `stub.js`（`Page.addScriptToEvaluateOnNewDocument`），导航到 `https://dsh.easymana.online:8443/preview/f8/#token=fake&inst=fake`。
4. 按各 `tN.cjs` 的 seed/delay/throw 配置复现；IDB 数据用页面内 `__F8.idbAll()` 读取。
5. 退登后重登：设置 → 退出登录 → 配对页输入恢复链接 → 用链接登录（不刷新）→ 打开同一会话，读 `dsh.cache.msgs` 与 IDB。

脚本只写临时目录和 `docs/verify/F8-preview/`。

---

## 9. 截图索引

| 文件 | 内容 |
|---|---|
| `00-真实部署产物-390x844-配对页.png` | 无注入真实加载，配对页 |
| `01-默认开启-390x844-列表.png` | 默认 v2 开，IDB 已建，列表（390） |
| `02-默认开启-430x932-列表.png` | 默认 v2 开（430） |
| `03-首次迁移-IDB已写入.png` | seed 迁移后的列表 |
| `04-重载后-IDB未被旧localStorage覆盖.png` | 改 legacy 后 reload，列表仍原值 |
| `05-删掉localStorage后-列表仍从IDB秒出.png` | legacy 删除，IDB 列表秒出（390） |
| `06-IDB秒出-430x932.png` | 同上（430） |
| `07-长会话300条-只渲染最近120条.png` | 300 条缓存，页面渲染 120 |
| `08-31个会话后-IDB稳定30条.png` | 30 会话上限后的列表 |
| `09-IDB不可用-回落localStorage-无toast.png` | open 抛错，legacy 列表，无 toast |
| `10-IDB不可用-消息仍从legacy读写.png` | 同场景会话消息 |
| `11-回退开关-只走localStorage-无IDB.png` | `dsh.cache.v2='0'`，无库 |
| `12-删掉回退开关-恢复v2.png` | 删除键后恢复 IDB |
| `13-网络延迟3秒-会话1秒内从缓存出内容.png` | 3 秒网络延迟，1 秒内 120 条消息 |
| `14-网络3秒后返回-仍是同一会话.png` | 网络返回后的同一会话 |
| `15-退出登录-清空IDB与localStorage.png` | 退登后配对页，IDB/legacy 清空 |
| `16-退登后同页重登-缓存未回写.png` | 附加 FAIL：重登消息显示但缓存未写回 |

---

## 10. 最终结论

- **必验 8 项：8 PASS / 0 FAIL。** 默认开启、首次迁移只做一次、读走 IDB、300 条/30 会话限额、legacy 影子写、open 抛错降级、回退开关、3 秒延迟下 1 秒内从缓存出内容、退登清空，全部达到预期。
- **附加 FAIL 2 项**：
  1. 退登后**同页**恢复链接登录，缓存不恢复（`idbState.failed`/`initP` 未重置 + `msgCacheSig` 未清），需整页刷新才恢复；不影响安全，但 F8 收益在当前页面内静默消失。
  2. `docs/cache-v2.md` §1 与代码注释仍写“默认关 / remove=回滚”，与默认开启的实现矛盾。
- **必须修的项**：A1（重置退登后的 IDB 状态与 `msgCacheSig`，或登录后强制 reload）；A2（改文档/注释）。
- **真机风险**：iOS Safari 低存储/隐私模式、切后台 10 分钟、大库首次打开耗时，均 UNVERIFIED，需真机再跑。
