# 多会话协作规则（多个 agent 同时开发时必读）

## 背景

这个 PWA 是**单文件**（`index.html` 里约 3000 行），两个 agent 会话同时改它时，
双方都是「读整个文件 → 改 → 写回」，会互相覆盖。

**已经发生过**：一边推 v49，另一边在文件里已经是 v56；版本号和功能都出现过覆盖。

git 只解决"事后能找回"，不解决"同时写"。真正的隔离靠 **worktree**（两个目录，一份对象库）。

## 待办与进度（唯一台账）

所有优化点、优先级、完成状态统一记在仓库根的 **`PWA-优化清单.md`**：

- 开工前先读，确认哪些已完成、哪些在谁手里
- 完成一项 / 发版后立刻更新对应条目的状态和版本，并更新第 1 节「进度快照」
- 不要把进度只写在聊天里，也不要另建清单；多会话 + 子代理都认这一页

## 目录约定

| 目录 | 分支 | 谁用 |
|---|---|---|
| `D:\Vibe\PWA\pwa` | `master` | **主 agent 会话**（负责最终合并与部署） |
| `D:\Vibe\PWA\pwa-b` | `feature/parallel` | **另一个会话**（在此目录工作） |
| `D:\Vibe\PWA\pwa-c` | `feature/lan` | 局域网直连 / 证书方向（服务脚本 + `LAN.md`，见 `pwa-c\LAN.md`） |
| `D:\Vibe\PWA\pwa-d` | 临时功能分支 | 按需 `git switch -C <branch> master`，用完可回收 |

任何会话开工前先 `cd` 到自己的工作区，不要再去改 `pwa/` 下的文件（主会话除外）。
子代理也遵守同一条：在分配的 worktree 里改，完成回主会话合并。

## 每轮改动的标准动作

```powershell
cd D:\Vibe\PWA\pwa            # 或 pwa-b
git pull --rebase origin master   # 当前无远程，跳过
# 改文件
node --check 提取出的脚本          # 语法检查（见 DEPLOY.md）
git add -A
git commit -m "feat: xxx（vNN）"
```

**小步提交**：一个功能一个 commit，不要攒一整天。

## 合并

主会话负责：

```powershell
cd D:\Vibe\PWA\pwa
git merge feature/parallel
```

冲突**只会出现在 `index.html`**（其余文件基本不交叉）。冲突时不要盲目取一边，
按"两边功能都保留"的原则手工合并，然后必须重新跑 `node --check`。

## 版本号规则（防撞车）

`APP_VERSION` 和 `sw.js` 的 `CACHE` 名是**两条线共用的唯一标识**，冲突高发区：

- 主会话用奇数尾号段：v51、v53、v55…
- 并行会话用偶数尾号段：v52、v54、v56…
- **合并时以较大者为准**，并把 `sw.js` 的 CACHE 名同步改成 `dsh-mobile-v(APP_VERSION+1)`

（这条是软约定，冲突时以实际代码为准，别为了号码好看回退功能。）

## 部署规则（关键）

**只有主会话部署线上**。并行会话验证用本地 `dev-proxy.mjs`（`node dev-proxy.mjs 8080`）。

主会话部署后必须写版本戳，方便任何一方确认线上是什么：

```powershell
ssh root@38.189.61.57 "cd /srv/dsh-mobile && printf 'app=%s\nsw=%s\ncommit=%s\ndeployed_at=%s\n' \
  \"$(grep -o \"const APP_VERSION = '[^']*'\" index.html | head -1)\" \
  \"$(grep -o \"dsh-mobile-v[0-9]*\" sw.js | head -1)\" \
  \"$(git rev-parse --short HEAD)\" \
  \"$(date -Is)\" > VERSION"
```

任何人怀疑线上状态时：

```powershell
ssh root@38.189.61.57 "cat /srv/dsh-mobile/VERSION"
```

## 不要做的事

- 不要 `git checkout -- .` / `git reset --hard`（会抹掉对方未提交的改动）
- 不要两边同时 `scp` 到 `/srv/dsh-mobile`
- 不要在 `pwa-b` 里再 `git init`（它是同一个仓库的 worktree）
- 不要把 `node_modules`、`icon-src.png` 提交进去（已在 `.gitignore`）

## 事故复盘：整文件覆盖 sw.js（2026-11-20 深夜）

主会话为了加"通知点击跳转"，用新内容**整文件重写**了 `sw.js`，把并行会话刚加的
`/agents/` 路由豁免覆盖掉了；同时版本号按记忆写成 v72（真实是 v87），线上版本戳因此是错的。

**为什么 git 没拦住**：两边都在 `master` 上直接改同一个文件，提交时不会冲突——
后提交的版本直接包含"被覆盖后的内容"，看起来是一次正常提交。

### 新增硬规则

1. **改版本号必须读当前值再 +1**：
   ```powershell
   $cur = [regex]::Match((Get-Content index.html -Raw -Encoding UTF8), "const APP_VERSION = '(v\d+)'").Groups[1].Value
   ```
   禁止按记忆写数字。
2. **禁止整文件重写** `sw.js` / `index.html`。要改就做定点替换，改完 `git diff` 看一遍。
3. **部署前先 `git log -1`**：如果最新提交不是你自己的，说明对方刚动过，先看清楚再动。
4. **动 `sw.js` 时特别小心**：它里面的路由豁免列表（`/api/` `/push/` `/agents/` `/__lan_pair`）
   是两边各自加过的，覆盖会让某些请求开始被 SW 拦截缓存。
5. 冲突检测靠人：提交前 `git diff --stat` 只应该出现你打算改的文件。
## 版本号单双号约定（2026-11-21 起生效）

两个人同时往同一个 `/srv/dsh-mobile` 部署会互相覆盖，用单双号把"谁发的"区分开：

| 会话 | 分支 | 用号 |
|---|---|---|
| 主会话 | `master` | **奇数** v101 / v103 / v105 … |
| 并行会话 | `feature/parallel` | **偶数** v102 / v104 / v106 … |

**取号方法**（不要按记忆写数字）：

```powershell
$cur = [regex]::Match((Get-Content index.html -Raw -Encoding UTF8), "const APP_VERSION = '(v\d+)'").Groups[1].Value
$n = [int]($cur.TrimStart('v')) + 1
# 主会话：偶数就再 +1
if ($n % 2 -eq 0) { $n++ }
# 并行会话：奇数就再 +1
# if ($n % 2 -eq 1) { $n++ }
```

`sw.js` 的 `CACHE` 跟随为 `dsh-mobile-v{APP_VERSION+1}`；部署后立刻写 `/srv/dsh-mobile/VERSION`。

**看到线上版本号是偶数 = 并行会话刚发的，奇数 = 主会话发的。**
## 禁止 `git add -A`（2026-11-21 补充）

多个会话共用 `pwa/` 这个工作树时，`git add -A` 会把**别人正在改的文件**一起卷进你的提交。

已经发生过：主会话提交"版本号约定"时，顺手把并行会话未提交的 `agents/bridge.mjs`（80 行）带进了自己的 commit。

**规则**：

```powershell
git add index.html sw.js AGENT-RULES.md     # 只写你改过的文件
```

提交前 `git status --porcelain`，确认列出来的都是你打算改的。
## 合并 / 部署 / 版本记录（硬规则，2026-11-21 起）

### 1. 各在各的分支改

| 会话 | 目录 | 分支 |
|---|---|---|
| 主会话 | `D:\Vibe\PWA\pwa` | `master` |
| 并行会话 | `D:\Vibe\PWA\pwa-b` / `pwa-c` / `pwa-d` | 各自 feature 分支 |

禁止修改别人 worktree 里的文件。功能做完提交到**自己的分支**，不要直接提交 master。

### 2. 合并到 master 必须经用户同意

- 并行会话完成后：先向用户报告「准备合并 X，涉及文件 Y，验证方式 Z」
- **用户明确同意后才可 `git merge`**
- 主会话看到并行分支有新东西，也要先问用户要不要合，不能自己合

### 3. 部署必须经用户同意

- **任何人不得自行 `scp` 到 `/srv/dsh-mobile`**
- **只允许部署 `origin/main`**：`deploy.ps1` 会拒绝 `-Ref` 非 main 和 `-Force`；VPS 上的 `deploy-remote.sh` 也会拒绝非 `origin/main` 的 ref
- feature 分支/未合并改动只能用 `/preview/` 测试环境，绝不能进线上
- 部署前必须给出四项：**版本号 / 改动摘要 / 影响面 / 回滚方法**
- 用户同意后才部署；部署后立刻写 `/srv/dsh-mobile/VERSION`
- 部署后 `VERSION` 必须满足 **`ref=origin/main` 且 `commit` = `origin/main` 的短哈希**；不满足就是异常部署，要立刻查

### 4. 版本记录与更新日志

- 版本号单双号：**master 奇数、并行 偶数**；从文件读当前值，取下一个本侧号码
- 每次部署**必须**在 `CHANGELOG.md` 追加一行：`版本 | 日期 | 会话 | 摘要 | 影响面 | 验证`
- 禁止补写未实际发生的版本；归属不确定写「未知」

### 5. 提交

- 只 `git add <具体文件>`，**禁止 `git add -A`**
- 提交信息格式：`type(scope): 摘要（vNN）`

### 6. 远端（GitHub）：`main` 是唯一主线，本地叫 `master`

- GitHub 上的默认分支叫 **`main`**；本地主线仍叫 `master`，两者**必须始终指向同一个提交**
- **`main` 已加保护（2026-11-21）**：必须走 PR、禁止 force-push、禁止删除，管理员同样受限
  - 直接 `git push origin master:main` 会被服务端拒绝：`GH006: Changes must be made through a pull request`
  - **发布流程**：推 feature 分支 → 开 PR（base = `main`）→ 合并 → 本地 `master` 快进
  ```powershell
  git push origin feature/xxx            # 推自己的分支（不需要 PR）
  # 开 PR + 合并：网页点，或用 GitHub API（python + 系统代理 127.0.0.1:7897）
  git fetch origin --quiet
  git merge --ff-only origin/main        # 合并后本地 master 快进对齐
  git rev-parse master origin/main       # 两个哈希必须相同
  ```

- **其他会话（含并行、子会话）一律不准动 `master` / `main`**：只在自己的 feature 分支提交，
  由主会话合并。要发布就报告，不要自己 push 到 main
- 部署前若 `master` 与 `origin/main` 不一致，**先对齐再部署**，避免线上版本和仓库对不上
- 远端分支策略：feature 分支可以推（备份/协作），但**只有 `main` 能对应线上**

### 7. 本机推送 GitHub 的注意事项（2026-11-21 实测）

远端是 `origin` = `https://github.com/Richard0620/dsh-mobile-pwa.git`，默认分支 `main`。

本机有系统代理 `127.0.0.1:7897`，而且**沙箱里的 curl / Invoke-RestMethod / git 的 schannel 都走不通**
（Schannel 报 `SEC_E_NO_CREDENTIALS`，git 的 cygwin-ssh 报 signal pipe 错误）。能用的组合是：

```powershell
# 1) 从系统凭据管理器临时取 token（不落盘、不写进 .git/config）
$out = "protocol=https`nhost=github.com`n`n" | & 'C:\Program Files\Git\mingw64\bin\git-credential-manager.exe' get
$tok = (($out | Where-Object { $_ -like 'password=*' }) -replace '^password=','')
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$tok"))

# 2) 用 openssl 后端 + 显式代理 + 一次性的 Authorization 头
git -c credential.helper= -c http.sslBackend=openssl -c http.proxy=http://127.0.0.1:7897 `
    -c "http.extraheader=Authorization: Basic $basic" push origin master:main
```

要调 GitHub API（建库、改默认分支）用 **python**（走 OpenSSL），不要用 Invoke-RestMethod。

### 8. 编辑 `.ps1` 的编码坑

带中文的 PowerShell 脚本**必须存成 UTF-8 with BOM**：Windows PowerShell 5.1 把无 BOM 的
UTF-8 当 ANSI 读，中文字节会把下一行语法一起带坏（实测 11 个 parse error）。用工具改完
时编码常被写成无 BOM，改完请确认：

```powershell
$b=[System.IO.File]::ReadAllBytes('lan-cert.ps1'); $b[0] -eq 239   # 必须是 True
$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path .\lan-cert.ps1),[ref]$null,[ref]$e); $e.Count  # 必须是 0
```

## 发布流程（2026-11-22 用户确认，优先级最高）

功能开发完不再直接合并、直接部署，按下面 5 步走，**每一步都不能跳过**：

1. **功能分支开发**
   在自己的 worktree（如 `pwa-f`）和 feature 分支上改，小步提交。

2. **先上 preview 验收**

   预览工具在分支 `feature/preview-env` 的 `preview/deploy-preview.ps1`，**根目录已是 `/srv/dsh-preview`**
   （2026-11-22 从 `/srv/dsh-mobile/preview` 迁走，Caddy `/preview/*` 跟着改）。取一份临时脚本再跑：

   ```powershell
   cd D:\Vibe\PWA\pwa
   git show feature/preview-env:preview/deploy-preview.ps1 > D:\Vibe\PWA\design\_deploy-preview.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File D:\Vibe\PWA\design\_deploy-preview.ps1 `
     -Branch <branch> -Repo <worktree目录> [-Slug <slug>]
   # → https://dsh.easymana.online:8443/preview/<slug>/
   ```

   - 预览只写 `/srv/dsh-preview/<slug>/`，有自己的 manifest / SW scope / `dsh-preview-*` 缓存，
     **不碰主站的 index.html 和 sw.js**。
   - **换 slug 是清缓存的土办法**：同名 slug 复用同一个 SW 缓存，重新部署后旧缓存可能顶住新代码；
     要给别人"立刻看到新的"，就换个 slug 重发。
   - 真机看完，用户明确说"可以合并"才进第 3 步。

3. **合并到本地 master**
   用户同意后：`git switch master; git merge <branch>`，冲突按"功能都保留"手工解，跑 `node --check`。

4. **本地 master → GitHub main**
   **2026-11-22 已确认采用 A 方案：保留 `main` 保护，一律走 PR，不关闭保护。**
   `main` 有保护（必须 PR、禁 force-push）：推 feature 分支 → 开 PR（base=main）→ 合并 →
   本地 `git fetch origin && git merge --ff-only origin/main`，确认 `master` 与 `origin/main` 同一提交。
   **不要为了省事去改仓库保护设置**，除非用户在当次明确同意。

5. **部署（只认 GitHub main）**
   ```powershell
   .\deploy.ps1          # 服务器从 origin/main 拉取；必要时 -Push
   .\deploy.ps1 -Force   # 仅本地 HEAD 与 origin/main 不一致时使用，先问用户
   ```
   部署脚本会先校验本地 HEAD == origin/main，之后写 `/srv/dsh-mobile/VERSION`。

硬约束：

- 没经过 preview 验收的功能，不得合并到 master。
- 没合进 GitHub main 的代码，不得部署到线上。
- 预览环境可以随时覆盖重发；线上部署每次都要用户点头。

## 页面改造：先出设计图，确认后才开发（2026-11-25 用户确认，硬规则）

**所有涉及页面改造的需求**——新页面、新卡片、布局调整、交互重构——必须按三步走：

1. **出设计稿**：`docs/design/<编号-名称>/index.html`，同目录放截图 PNG。
   - 用 `index.html` 里的**真实 token**（纸面/碳黑两套），按 390×780（≈430×932）画手机框，不要自己发明配色和圆角。
   - **同屏画完所有状态**：空态、进行中、失败/降级、两套皮肤对照，外加一张「状态与边界」表（什么情况显示什么）和一张「开发面」表（改哪些函数、多少行）。
   - 一份设计稿只覆盖一组相关需求；不相关的一次画一张，别混。
2. **用户确认**：把截图发给用户，等"OK / 改这里"。**没确认不得改 `index.html`**。
3. **确认后才进开发**，之后仍走 preview → 用户验收 → 合并 → 部署。

**例外（不需要设计稿）**：纯不可见改动——缓存层、传输层、宿主路由、定时任务、构建脚本。这类仍必须在 commit message 里写清"改了什么、怎么验证、怎么回滚"。

> 为什么写死：用户 2026-11-25 明确要求"以后所有涉及页面改造的需求都这样，出图后我觉得 ok 再进开发"。省下的不是画图时间，是返工。

## 预览验收：先过独立子代理，再交给用户（2026-11-25 用户确认，硬规则）

部署到 preview 之后，**不得直接把"做好了，你验一下"丢给用户**。固定顺序：

1. 实现方（子代理或主会话）完成代码 → 上 preview（`preview/deploy-preview.ps1`）。
2. **另起一个独立子代理**做验证：它不改业务代码，只跑场景、留证据、写报告到 `docs/verify/<项>-preview/`。
3. 验证必须**模拟真实 iPhone 场景**：390×844 与 430×932、deviceScaleFactor=3、移动 UA、触摸事件、安全区（`--safe-t:47px / --safe-b:34px`）、键盘弹起态（`html.kb-open`）、纸面 + 碳黑两套皮肤。
4. 报告必须区分「真实 / 模拟 / 未验证」，逐项给 PASS / FAIL / UNVERIFIED + 截图 + 复现步骤；**不许把打桩说成真机**。
5. **FAIL 或关键项 UNVERIFIED 时不给用户看**：先修，再重上 preview、重验。全过（或只剩与本次无关的 UNVERIFIED 且已说明）才交给用户真机点一遍。
6. 验证方禁止：使用用户手机的设备凭据（会抢掉手机正在用的流）、改 `index.html`/`sw.js`/版本号/台账、push、部署、装依赖。

> 为什么加这一层：用户 2026-11-25 明确"上 preview 以后再让一个独立的子代理去验证，验证通过后再给我"。实现方自己测自己，漏的永远是它默认不会碰的那条路径（小屏、深色、无 API、权限拒绝）。

## 并行开发：worktree / 分支 / 版本号（2026-11-25 补充）

| 目录 | 分支 | 用途 |
|---|---|---|
| `pwa` | `main` | 主会话：合并 + 部署（只有这里能合并/部署） |
| `pwa-e` | `feature/f13-preview-probe` | F13 端口预览可行性验证（只写报告，不改代码） |
| `pwa-g` | `feature/f8-indexeddb` | F8 缓存迁 IndexedDB（不可见改动） |
| `pwa-h` | `feature/f3-f5-designs` | F3/F4/F5 设计稿（只放 `docs/design/`） |
| `pwa-j` | `feature/f1-f2-steps-voice` | F1 过程进度 + F2 语音/朗读（设计稿已确认，同分支顺序做） |

> `pwa-e` 这个名字在 v15 时代是 agents 线的工作目录（见下方技术债 D8/D11 的历史记录），那条线已合入；2026-11-25 起该目录改用于 F13 验证。旧的 `agents-bridge.lnk` 若还指向它，先确认再改动。

**并行时的三条附加规则**（这几条是单文件 + 多分支带来的，必须遵守）：

1. **分支里不要改 `APP_VERSION` / `sw.js` 的 `CACHE`**。N 条分支各取一号必然撞车；统一由主会话在合并到 `main` 时取号。只有一个分支在跑时，仍按单双号约定。
2. **台账 `PWA-优化清单.md` 只有主会话能改**。子会话/子代理在回报里写状态，由主会话落账——否则三条分支各改一次同一份文档，合并必冲突。
3. **同一文件不要并行**。`index.html` 是单文件，两个需求同时改它，合并时只能手工挑；能串就串（例如 F1+F2 同属 dock 区，放同一条分支按顺序做）。
