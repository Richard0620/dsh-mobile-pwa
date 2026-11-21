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
| `D:\Vibe\PWA\pwa-c` | `feature/lan` | 局域网/证书方向 |
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