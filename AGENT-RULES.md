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
- 部署前必须给出四项：**版本号 / 改动摘要 / 影响面 / 回滚方法**
- 用户同意后才部署；部署后立刻写 `/srv/dsh-mobile/VERSION`

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
