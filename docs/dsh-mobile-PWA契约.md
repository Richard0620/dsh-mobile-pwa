# dsh-mobile 移动 API · 客户端最小契约（实测版）

> 全部来自本机实跑，不是文档推测。宿主：`http://127.0.0.1:18787`，插件 `dsh-mobile-plugin@0.5.82`。
> 抓取时间：2026-11-20。样本原文件在 `tmp/samples/`。

---

## 1. 配对

**入口只有局域网这条能用**（`/api/mobile/v1/pair` 那条是给中转路径的，直连会 401）：

```
POST http://<host>:18787/__lan_pair
Content-Type: application/json

{ "code": "<6位配对码>",
  "device": { "deviceId": "<uuid>", "name": "pwa", "platform": "web",
              "osVersion": "win", "appVersion": "0.0.1" } }
```

实测回包：

```json
{
  "ok": true,
  "proto": 1,                      // 1 = 明文；2 = 逐请求加密（需要 deviceKey）
  "instanceId": "caaa4ec1…（32 hex）",
  "token": "87 字符",               // Bearer
  "cookie": "95 字符",              // dsh_lan=... 直接种给浏览器
  "deviceCredential": "87 字符",     // 与 token 同值
  "serverTime": 1795187118347,      // 用它校准客户端时钟
  "lanUrls": [ … ],
  "deviceId": "<uuid>",
  "permissions": [ … ],
  "credentialExpiresAt": 1826723118326,  // 约 1 年
  "hostPlatform": "win32"
}
```

要点：

- **`proto: 1` 意味着后面所有请求都是明文 JSON**，不需要信封。选这条路的前提是
  我们自己的反代 + TLS（不经过他们的中转）。要上 E2EE 才需要 `sealed` 配对。
- 凭据有效期约 1 年，**剩余不足一半时服务端自动滑动续期**，客户端不用管。
- 同一个 6 位码可以重复配（每次签发一条新记录）。

## 2. 鉴权

```
Authorization: Bearer <deviceCredential 或 token>
```

也接受 `X-Dsh-Device-Credential: <...>`（原生客户端走这个），以及 `dsh_lan` cookie。
**cookie 这条路对 PWA 很关键**：`EventSource` 不能带自定义头，但会带同源 cookie。

错误语义（都是明文，客户端要能区分）：

| code | HTTP | 含义 |
|---|---|---|
| `unauthorized` | 401 | 没带或无效 |
| `device-revoked` | 401 | 被解除绑定，**停止轮询**，重新扫码 |
| `device-expired` | 401 | 授权过期，同上 |
| `permission-denied` | 403 | 登录了但缺这一位 |
| `e2ee-required` | 400 | 该凭据是 v2 的，必须带信封 |

## 3. 会话列表 `GET /api/mobile/v1/sessions`

```json
{ "ok": true,
  "items": [ {
    "sessionId": "session-f610cc72-…",
    "title": "自研dsh mobile",
    "running": true,
    "completed": false,
    "lastTurn": { "turn": 5, "endedAt": 1795186176896, "status": "completed", "readAt": 1795186452618 },
    "blank": false,
    "cwd": "D:\\Vibe\\CRM",
    "updatedAt": 1795187056885,
    "lastMessage": { "role": "user", "text": "…", "at": 1795187056885 }
  } ],
  "hasMore": false, "generatedAt": …, "revision": "…", "emptyConfirmed": … }
```

`revision` 是列表版本——设备级流推送 `device/list-changed` 时带同一个 revision，
客户端据此判断"要不要重新拉列表"。

## 4. 工作区 `GET /api/mobile/v1/workspaces`

同一个信封：`{ ok, items[], hasMore, generatedAt, revision, emptyConfirmed }`。

## 5. 会话消息 `GET /api/mobile/v1/session/messages?sessionId=<id>`

```json
{ "ok": true,
  "items": [ {
    "id": "664d8bf6-…",
    "role": "assistant",
    "text": "",
    "blocks": [ { "type": "tool-call", "callId": "call_00_…", "name": "pwsh" } ],
    "seq": 458,
    "time": 1795187135795,
    "turn": 6,
    "modelTrail": [], "producedFiles": [], "fileChanges": [],
    "turnLifecycle": { "turn": 6, "seq": 358, "startSeq": 358, "state": "running", "startedAt": 1795187056833 }
  } ],
  "hasMore": true, "lastSeq": 460, "oldestSeq": 125, "toolResults": { … } }
```

`items` 是**增量分页**：用 `oldestSeq` / `hasMore` 往前翻，用 `lastSeq` 作为流式续传的起点。

## 6. 两条 SSE 流

```
GET /api/mobile/v1/session/stream?sessionId=<id>&lastSeq=<seq>   ← 单会话正文
GET /api/mobile/v1/events/stream                                 ← 设备级（列表/审批红点）
```

实测帧：

```
: connected
retry: 3000
id: session-f610cc72-…:session/live-steps:553db1fafc82db47…
data: {"type":"session/live-steps","sessionId":"…","full":true,"turn":6,"steps":[…]}
: 
retry: 3000
id: session-f610cc72-…:session/jobs:eca3f1869be77b9f…
data: {"type":"session/jobs","sessionId":"…","jobs":[…]}
```

设备级那条：

```
data: {"type":"device/event","version":1,"payload":{"type":"device/list-changed","revision":"0a30de5a…","at":1795187133177}}
```

### ⚠️ 续传的坑（实测发现的）

帧里的 `id:` 形如 `session-xxx:session/live-steps:553db…`，而服务端解析
`Last-Event-ID` 的正则是 `^[^:]*:[0-9]+$` —— **这个 id 解析不出来**。
所以：

- **不要依赖 `Last-Event-ID` 自动续传**；
- 自己跟踪 `data` 里事件携带的 `seq`，重连时用 `?lastSeq=<seq>` 显式续传。

### 其它实测/已知约束

- 帧类型见过：`session/live-steps`、`session/jobs`、`session/projection`、`session/queue`、
  `device/event`；审批/提问是 `approval/requested|asked|decided|resolved`、`question/requested|resolved`。
- 心跳 `session/heartbeat`，**不带 seq**（绝不能拿它推进 lastSeq）；35s 无帧就判死重连。
- 服务端在流里塞 padding 字节防代理缓冲，**客户端解析要容忍空行与注释行**（`: …`）。
- 草稿增量帧可被丢弃（背压），**审批帧和心跳永不丢**。

## 7. 写入类端点（已从源码补齐）

### `POST /session/send` — 发消息

```json
{ "sessionId": "session-…",
  "content": [ { "type": "text", "text": "你好" } ],
  "mode": "queue",              // 可选：'queue' | 'steer'，缺省按普通发送
  "clientMessageId": "<uuid>",  // 可选，幂等用
  "attachmentIds": []           // 可选，配合 /upload/*
}
```

- 也接受简写 `{ sessionId, text }`（服务端报错文案就是 `需要 { sessionId, content | text }`）。
- `content` 是块数组，`text` 块必须非空；图片块两种形状：
  老的 `{type:'image', data:'<base64>'}`（内联，4MB 照片会超时）或新的
  `{type:'image', uploadId:'…'}`（先分片上传再由宿主读盘）。

### `POST /session/stop` — 停止

```json
{ "sessionId": "session-…" }
```

### `POST /approval/respond` — 审批

```json
{ "rpcId": "…", "sessionId": "session-…", "approvalId": "…", "outcome": "allowed-once" }
```

`outcome` 只有三个值（源码 `ANSWER_OUTCOMES`）：

| 值 | 含义 |
|---|---|
| `allowed-once` | 只允许这一次 |
| `allowed-class` | 这一类以后都允许 |
| `rejected` | 拒绝 |

### `POST /question/respond` — 回答提问

```json
{ "rpcId": "…", "sessionId": "session-…",
  "answer": { "answers": [
      { "id": "<题 id>", "selected": ["选项文案"], "custom": "可选自定义" }
  ] } }
```

⚠️ 注意是 `answer.answers`（**再包一层对象**），不是裸数组 —— 这是从
`handleQuestionRespond` 的入参校验里读出来的，写错了会直接 400。

- 每道题**恰好一条**，`id` 不能重复；`selected` 是选项**文案**数组（不是 index）。
- `custom` 可选，自定义回答。
- 这条提问不在挂起表里（插件重载/宿主重启过）会回 **409 `not-pending`**，
  提示"回桌面端作答"。

### 帧的真实字段（从 `cardFrame()` 抄的，不是猜的）

**审批卡** `approval/requested`：

```js
{ type, sessionId, rpcId, approvalId,
  toolName?,        // 工具名
  reason?,          // 请求原因；为空时客户端可兜底成「工具 X 请求越权执行」
  fact?,            // 电脑算出的一句人话（原始参数的概括）
  factHighlight?,   // 这一行要不要高亮
  rememberable?,    // 有了才显示「这一类都允许」这颗按钮
  classLabel?,      // 类别的中文名（第三颗按钮旁边要显示）
  command? }        // 危险命令原文
```

结算帧 `approval/resolved`：`{ type, sessionId, approvalId, outcome, reason? }`

**提问卡** `question/requested`：

```js
{ type, sessionId, rpcId,
  questions: [ { id, question,      // 注意字段名是 question，不是 title
                 header?, detail?, options?, multiSelect?, intent? } ] }
```

结算帧 `question/resolved`：`{ type, sessionId, questionRpcId }`
—— 收卡要按 **`questionRpcId`** 比对，不是 `questionId`。

---

## 8. 安全现状（本次实测副产品）

- 本次配对生成了一条 `pwa-probe` 设备记录，**默认全权**，约 1 年有效。
  凭据在 `tmp/pwa-probe.cred`（工作区本地）。撤销：
  `POST /api/mobile/v1/paired-devices/revoke`，或在桌面端「设置 → 移动端」里删。
- 你自己那台 iOS 设备的第二条记录是**受限权限集**
  （`view, files.read, input, dispatch, approve, operate, …`），不是全权——
  说明权限档位确实在按设备生效。
- 明文协议（`proto: 1`）**只在"链路是可信的"前提下成立**：必须自己控 TLS 终点。
  一旦走第三方中转，就必须上 v2 信封，否则等于裸奔。
