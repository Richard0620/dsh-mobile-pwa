# 缓存 v2：消息/会话列表迁到 IndexedDB（F8 · 一期）

分支：`feature/f8-indexeddb`（不改版号，合并时由主会话统一取）
改动文件：`index.html`（单文件），本说明。
不改界面、不改接口、不改 `APP_VERSION` / `sw.js` / `PWA-优化清单.md`。

**一期只做「影子写 + 可开关读取」；2026-11-25 用户决策改为默认开启（`localStorage['dsh.cache.v2'] = '0'` 可回退，回退后与 v249 逐字节一致）。**
打开开关后：读走 IndexedDB，写是双写（localStorage 照老规则写一份当影子/回滚保险，IndexedDB 再写一份）。
唯一的限额差异：**IndexedDB 单会话保留 400 条、最多 30 个会话**；localStorage（legacy）仍是 120 条 / 10 个会话。

---

## 1. 开关

| 项 | 值 |
| --- | --- |
| 开关 key | `localStorage['dsh.cache.v2']` |
| 打开 | 值为字符串 `'1'` |
| `'0'`（回退） | 一切走 legacy，与改动前完全一致 |
| 生效时机 | **模块加载时读取一次**，必须完全杀掉 App 重开（或 `location.reload()`） |

```js
localStorage.setItem('dsh.cache.v2', '1');   // 打开
localStorage.removeItem('dsh.cache.v2');     // 回滚（等价于关）
```

源码里的对应常量：`CACHE_V2`（`index.html` 缓存存储层一节），只在启动时求值一次。
开关关闭时：不会 `indexedDB.open()`、不会注册任何异步任务，四个缓存函数的写入内容、裁剪策略、JSON 字节都与改动前相同。

## 2. 存储布局

```
IndexedDB: dsh-mobile (version 1)
  store: kv   // 没有 keyPath，key 外置
    'list'      -> { key:'list', at, sessions:[...] }        // 会话列表，仍裁到 80 条
    'msg:<sid>' -> { key:'msg:<sid>', at, lastSeq, messages:[...] }  // 单会话 ≤400 条
    'idx'       -> { key:'idx', schema, msgAt:{ <sid>: at } } // 只给「30 个会话」裁剪排序用
```

`idx` 是唯一在建议结构之外加的一条小记录（约 1KB）：超 30 个会话时要按最近写入时间淘汰最旧的，
没有它就得把 30 条消息正文全读出来才知道谁旧，那会把每次写放大成几十 MB 的结构化克隆。

`CACHE_SCHEMA` 现在也写进 `idx.schema`：结构升级时 IndexedDB 整库清空（和 localStorage 那边
`schema` 不匹配只清列表/消息缓存是同一条规则）。

## 3. 四个函数的读写路径

对外签名不变，内部按开关分派：

| 函数 | 开关关闭（legacy） | 开关打开（idb） |
| --- | --- | --- |
| `saveListCache(sessions)` | 原逻辑，80 条 | 原逻辑照写 + 同一份 slim 写 IDB |
| `readListCache()` | 读 `dsh.cache.list` | 读内存镜像（由 IDB 预热） |
| `saveMsgCache(sid, msgs, lastSeq)` | 原逻辑，120 条 / 300KB 兜底 / 10 会话 | 原逻辑照写 + 写 IDB（400 条 / 30 会话，**一会话一事务**） |
| `readMsgCache(sid)` | 读 `dsh.cache.msgs` | 读内存镜像；miss 时后台补一次，本次返回 `null`（和「没有缓存」等价） |

**为什么是内存镜像**：`readListCache` / `readMsgCache` 的调用点都在同步渲染路径上（启动首屏、
`openSession`、本地搜索），不能改成 async。所以启动后把 IDB 内容灌进内存镜像：

- `memList`：列表，启动时同步预热（很小）。
- `memMsgs`：各会话消息正文，启动后**后台**灌（不挡首屏）；灌之前读到 miss 会触发一次单条 `prefetch`。
- 写的时候内存镜像先更新、再落库，所以同一会话第二次打开必命中。

**写入判重**：沿用 `msgCacheSig`（`sid:条数:lastSeq:最后一条 id`），内容没变不写；一个会话一次
`readwrite` 事务里完成「put 正文 + put idx + 删超限会话」。

**防脏写**：两个读函数都返回数组副本（`.slice()`）。`state.messages` 会被 push 优化消息
（`index.html` 发送路径），legacy 每次 JSON.parse 天然隔离，内存镜像必须手动隔离。

## 4. 首次迁移

开关打开后的第一次运行：

1. 读 `dsh.cache.list` / `dsh.cache.msgs`（legacy 结构）；
2. 逐条写进 IDB，**只补不覆盖**：IDB 里已有 `at` 更新（或相同）的记录就跳过；
3. 写 `localStorage['dsh.cache.migrated.v2'] = '1'`（搬完才写，失败下次启动重试）。

之后不再重复搬。因此：**先关后开的来回切，IDB 可能比 legacy 旧**（关掉那段时间 IDB 没人写）。
需要重新对齐时，清掉 `dsh.cache.migrated.v2` 再重启，迁移会按 `at` 把更新的记录补进去。

## 5. 降级（不弹 toast）

以下情况自动回落 legacy，只在 console 打 **一条** `[cache-v2] ...` warn，功能不受影响：

- `indexedDB` 不存在（老 WebView / 被禁用）；
- `open()` 报错、被隐私模式拒绝、3 秒内没返回（超时保护，不卡启动）；
- `onversionchange`（别的标签页/代码要升级库，本连接被要求关闭）；
- 单次写失败（配额等）：warn 一次后继续用 legacy，不重试、不打断发消息。

开关打开但库还没暖好（启动前 1.2 秒内）或已降级时，四个函数自动读/写 legacy。

## 6. 限额差异（本期唯一的行为差异）

| | legacy（localStorage） | idb（IndexedDB） |
| --- | --- | --- |
| 单会话消息 | 最近 120 条，>300KB 继续裁到约 40 条 | 最近 **400 条**（无体积裁剪） |
| 保留会话 | 10 个（按 `at`） | **30 个**（按 `at`，一事务内删除） |
| 列表 | 80 条 | 80 条（不变） |

注意：IDB 单会话 400 条没有 300KB 体积兜底。如果某个会话单条消息特别大（整段代码/长文），
一条记录本身就可能上 MB；30 个会话极端情况下会到几百 MB，接近 Safari 的配额时会写失败并 warn，
此时仍能靠 legacy 那份继续用。真出现再补体积兜底，一期先不改。

## 7. 回滚

| 想做什么 | 做法 | 结果 |
| --- | --- | --- |
| 立即回滚行为 | `localStorage.removeItem('dsh.cache.v2')` 后彻底重开 App | 读写都回 legacy；IDB 里残留数据不读不写，不影响功能 |
| 回滚并清干净 | 上面一步 + 删除 IndexedDB 库 `dsh-mobile`（DevTools Application/Storage 面板 Delete database） | 没有版本/开关缓存残留 |
| 让 idb 追上 legacy 再开 | 删 `dsh.cache.migrated.v2` 后重开一次 | 迁移按 `at` 只补更新 |
| 退登清凭据 | 已有的「退出登录」已改成 `clearLocalCaches()`：`localStorage.clear()` **加** 清空 IDB store | 换账号不会读到上个账号的消息 |

回滚不需要回退代码：开关是纯运行时数据。代码回退只需要 revert 这一个 commit（除 `clearLocalCaches`
外没有外部依赖，`clearLocalCaches` 只是多了清 IDB 的动作）。

## 8. 手机验证步骤

> 本机没有浏览器环境，以下必须在真机上过一遍。**没有桌面调试环境时**：让主会话在 preview 里
> 临时把 `CACHE_V2` 初值改成 `true`（一行）再发一版，验证完还原；否则用下面的调试器步骤。

### 8.1 准备

- Android：USB 调试 + 桌面 Chrome `chrome://inspect`。
- iOS：iPhone 设置 → Safari → 高级 → 网页检查器 打开；Mac Safari → 开发 → 设备。PWA 独立窗口也能被检查。
- 先在**旧版**（还没打开开关）里正常用一会儿：进出几个会话（最好有一个 >120 条消息的长会话）、
  让列表攒到 10 个以上会话，保证 `dsh.cache.list` / `dsh.cache.msgs` 有内容。

### 8.2 回退开关（`dsh.cache.v2='0'`，安全网，先过这条）

1. 冷启动 App，不设任何开关。
2. console 跑 `await indexedDB.databases()`（不支持就跳过）：**不应出现 `dsh-mobile`**。
3. console **不应**出现任何 `[cache-v2]` warn。
4. 正常用：首屏秒开、切会话、发消息、本地搜索命中缓存消息、退出登录清凭据 —— 与线上现在一致。
5. 在 console 断开点看 `dsh.cache.list` 的 `at` 会随刷新变大（说明 legacy 照写）。

**失败判定**：出现 `dsh-mobile` 库、出现 `[cache-v2]` warn、或任何界面/操作手感与线上不同。

### 8.3 打开开关 + 首次迁移

1. console（或重启前注入）执行 `localStorage.setItem('dsh.cache.v2','1')`，然后**彻底杀掉 App 重开**
   （不是切后台；模块加载时才读开关）。
2. 列表仍能秒出（和开关前一样），console 无报错。
3. 检查迁移结果（Application/Storage → IndexedDB 或 console）：

```js
new Promise((res, rej) => {
  const r = indexedDB.open('dsh-mobile', 1);
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const db = r.result, st = db.transaction('kv').objectStore('kv');
    const q = st.getAll();
    q.onsuccess = () => res(q.result.map(x => ({ key: x.key, at: x.at, n: x.sessions ? x.sessions.length : (x.messages ? x.messages.length : (x.msgAt ? Object.keys(x.msgAt).length : 0)) })));
    q.onerror = () => rej(q.error);
  };
});
```

预期：`list` + 若干 `msg:<sid>` + `idx`；`list.n` ≤ 80 且与 legacy 里会话数一致；
msg 条数与 legacy 里同会话一致（legacy 那 120 条以内）；`localStorage['dsh.cache.migrated.v2'] === '1'`。
`idx.msgAt` 的 key 数 = msg 记录数。

4. 再彻底重开一次：迁移不重复覆盖（记录 `at` 不会被更早的 legacy 值盖掉）。

**失败判定**：kv 里没有 `list`；`migrated.v2` 没写；消息条数与 legacy 对不上（丢数据）；
出现 toast；首屏比开关前明显慢（>1.2 秒）。

### 8.4 读的是 IDB，不是 localStorage

1. 开关打开状态下，DevTools 里删掉 `localStorage['dsh.cache.list']` 和 `localStorage['dsh.cache.msgs']`。
2. 彻底杀掉重开：列表仍能秒显示（说明来自 IDB）；之后 `refreshAll` 会把 legacy 两份重新写回来。

**失败判定**：首屏空白/骨架直到网络回来才出列表。

### 8.5 核心痛点：长会话从后台回来

1. 进入一个 >120 条消息的长会话，等最后一条加载完（保证写进 IDB）。
2. 切后台 10 分钟以上（或锁屏），回前台，进入**同一个**会话。
3. 预期：消息内容立即出现（先缓存后网络），不出现空白骨架；随后新消息正常追加。
4. 换一个从没打开过的会话：允许首次空白（等网络），之后再打开应秒开。

**失败判定**：开关打开后长会话的秒开效果比开关关闭时更差（例如第一条消息都不显示、或要等网络）。

### 8.6 400 条 / 30 会话

- 400 条：对上面那个长会话，在 console 读 `msg:<sid>` 的 `messages.length`，应可能 >120（最多 400）；
  同时 `dsh.cache.msgs` 里该会话仍是 ≤120（影子写按老限额）。
- 30 会话：依次打开 31 个不同会话各刷新一次，`kv` 里 `msg:*` 记录数应稳定在 30；
  `idx.msgAt` 的 key 数同步 ≤30；最旧的那个会话重新打开时会走网络（缓存已淘汰，属预期）。

### 8.7 降级（不弹 toast）

任选一种制造失败：

- 隐私浏览/无痕窗口（iOS 无痕、或系统「阻止所有 Cookie」）里打开同一页面并打开开关；
- 或者 App 正常跑着时，在 console 执行 `indexedDB.open('dsh-mobile', 99)` 强制升级：
  App 的 `onversionchange` 会关闭连接并降级（这条也顺带验证了版本冲突路径）。

预期：console 只有一条 `[cache-v2] ...回落 localStorage` warn；**不弹 toast**；列表、会话、发消息全部照常。

**收尾**：版本冲突测试后，Application 面板 Delete database `dsh-mobile`（否则之后 `version 1` 会开不起来，
一直处于降级状态 —— 这本身也算一次降级验证，但别留在正式验收机上）。

### 8.8 回滚

1. `localStorage.removeItem('dsh.cache.v2')`，彻底重开。
2. `await indexedDB.databases()` 里 `dsh-mobile` 还在（数据残留）但不应再被写：
   发一条消息后看 `msg:<sid>.at` 是否停在旧值、`dsh.cache.msgs` 是否更新。
3. 行为回到 8.2 全部预期。

## 9. 风险点（留给合并/验收时判断）

1. **内存镜像成本**：IDB 最多 30 会话 × 400 条全在 JS 内存里。老机型/超大会话下常驻内存可能几十 MB；
   一期按「长会话要能秒开」优先，真出问题再改成按会话懒加载 + 打开会话时异步补画。
2. **启动等待**：开关打开时启动会 `await` 暖库，最长 1.2 秒（`Promise.race` 兜底）；正常 20–50ms。
   开关关闭时零影响。
3. **首次打开只有一次空白**：库刚暖好、正文镜像还没灌完时打开会话说 miss → 返回 `null`，等下一次打开才命中。
   已在 miss 时后台 `prefetch`，但不会补画，避免动渲染路径。
4. **读写都在主线程**：400 条 structured clone 在低端机可能有 10–30ms 抖动，但被 `msgCacheSig` 限流到「内容真变才写」。
5. **先关后开的数据陈旧**：见第 4 节，需要清 `dsh.cache.migrated.v2` 才会再对齐。
6. **IDB 无体积兜底**：见第 6 节尾部。
7. **没有自动化测试**：语法检查 + 真机手工验收是本期唯一验证手段；默认关闭是安全网。
