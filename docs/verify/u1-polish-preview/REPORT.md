# U1 视觉基座精修与原生 App 动效手感（`design/u1-native-polish`）独立验收报告

- **预览地址**：`https://dsh.easymana.online:8443/preview/u1-polish/`
- **分支 / Commit**：`design/u1-native-polish` / `16c723f`
- **本地验收产物**：`D:\Vibe\PWA\pwa-p\index.html`（由 `src/` 构建）
- **验收时间**：2026-11-27（America/Los_Angeles）
- **验收结论**：**12/12 主项全部 PASS，0 FAIL，真机专属 3 项 UNVERIFIED**（具备交付用户真机验收条件）。

> **环境与边界说明**：未在真机 iPhone / Safari / WebKit 上运行。移动端视口由 Chrome Headless（`--headless=new`）+ CDP 模拟（`390×844` 与 `430×932`、DPR=3、Touch、iPhone Safari UA、安全区 `--safe-t:47px; --safe-b:34px`、`html.kb-open` 键盘态、`paper` + `carbon` 双皮肤，另含 `320×672` 矮屏弹层滚动验证）。预览静态资源 / SW / manifest 走真实 HTTPS；业务接口 `/api/mobile/v1/*`、`/push/*` 及 SSE 帧由本地 Node Mock 服务器模拟；无头 Chrome 无聚焦系统剪贴板，原地复制交互测试中对 `navigator.clipboard.writeText` 做了记录桩（验证实际 DOM 变身与复制文本）。本次未修改任何业务代码，未 push、未部署、未安装依赖、未使用用户手机设备凭据。

---

## 0. 验收总表

| # | 验收项 | 环境 | 结论 | 证据截图 | 关键观测数据 |
|---|---|---|---|---|---|
| 1 | 真实预览加载（HTTPS 200 / manifest / SW / 4 组视口×皮肤） | **真实** | **PASS** | `01`–`04` | 5 项静态资源均 HTTP 200；`APP_VERSION=v253`；SW `dsh-preview-u1-polish-v253` `activated`；0 console error / 0 pageerror / 0 failed / 0 横向溢出 |
| 2 | 本地单元测试（`node --test tests/*.test.mjs`） | **真实** | **PASS** | — | 21/21 PASS（含 `buildHtml()` 确定性与 `index.html` 一致性校验） |
| 3 | 列表页 U1 视觉精修（390×844 & 430×932 × paper / carbon） | **模拟** | **PASS** | `05`–`08` | `.hero h1` 色值精确匹配 `var(--fg)`（paper `rgb(22, 22, 19)` / carbon `rgb(242, 240, 232)`）；`.searchrow .sico svg` 存在且 `padding-left: 36px`（≥34px）；`.row` 具阴影/高光层次且 0 溢出；`.dot.run` 具 `dotpulse` 脉冲动画 |
| 4 | 会话页毛玻璃顶栏、原地复制与悬浮底栏（paper / carbon） | **模拟** | **PASS** | `09`–`10` | `header` `backdropFilter: blur(20px)`；`.codecopy` 点击原地变身 `✓ 已复制` + `.copied`；`.mact button` 线性 SVG 共 8 枚（≥3），复制变身 `已复制` + `.copied`；`.prog` + `.composer` 悬浮投影正常 |
| 5 | 会话页键盘弹起态（`html.kb-open`） | **模拟** | **PASS** | `11` | `html.kb-open` 下 `.prog` `display: none`、`dockBottom=480`、与对话流无重叠 |
| 6 | 弹簧底抽屉（Spring Bottom Sheet）A11y 与退场动画 | **模拟** | **PASS** | `12` | 打开后 `.sheet` 可见（9 项）、焦点落在 `.sheet` 容器而非首行（首行 `:focus-visible=false`、`outlineStyle=none`）；按 `Escape` 触发 `.mask.closing=true`，300ms 内 `.mask` 归零 |
| 7 | 矮屏（`320×672`）底部弹层滚动检查 | **模拟** | **PASS** | `13` | `.sheet` `clientHeight=651`、`scrollHeight=787`（`scrollHeight > clientHeight`）、`overflowY=auto` 可正常滚动 |
| 8 | 设置页（paper + carbon）：可点行箭头 / 只读行无箭头 / 开关绿 | **模拟** | **PASS** | `18`–`20` | 11 个可点 `button.srow` 均含 `.schev svg`；只读行（`已配对设备`）无 `.schev`；`.tgl.on`（语音子页验证）精确使用 `var(--ok)`（paper `rgb(39, 103, 59)` / carbon `rgb(142, 224, 115)`） |
| 9 | 冒烟：子代理（入口条 / 列表弹层 / 只读视图） | **模拟** | **PASS** | `14` | `.subbar` 可见、弹层 2 项、点击进入只读视图正常，0 报错 |
| 10 | 冒烟：文件 Tab / 右侧文件抽屉 / 全屏查看器双皮肤 | **模拟** | **PASS** | `15`–`17`、`21` | 文件 Tab（2 根路径、4 条目）；右侧 `.rpanel` 抽屉（4 条目）；`.viewer` 全屏查看器跟随皮肤（paper `rgb(245, 244, 239)` / carbon `rgb(10, 11, 13)`） |
| 11 | 冒烟：新会话大输入页 | **模拟** | **PASS** | `22` | `.newta` 与 2 个工作区/模式 chip 渲染正常，0 溢出、0 报错 |
| 12 | 冒烟：定时任务 & Git 概览页 | **模拟** | **PASS** | `23`–`24` | 定时任务列表与 Git 分支（`design/u1-native-polish`）均正常渲染，全程 0 console error / 0 pageerror / 0 failed request |
| D1 | iOS 真机 Safari `backdrop-filter` 合成帧率与物理侧滑跟手回弹手感 | **未验证** | **UNVERIFIED** | — | 需真机 iOS Safari 触控实测 |
| D2 | iOS 真机剪贴板权限与真实 `navigator.clipboard.writeText` 写入 | **未验证** | **UNVERIFIED** | — | 无头 Chrome 无聚焦系统剪贴板，测试中使用 stub 验证 DOM 变身 |
| D3 | iOS 真机「减弱动态效果（Reduce Motion）」系统开关与真机键盘顶起 | **未验证** | **UNVERIFIED** | — | 需真机 iOS 系统辅助功能与软键盘实测 |

**统计汇总**：
- **PASS：12**（真实 2 + 模拟 10）
- **FAIL：0**
- **UNVERIFIED：3**（真机 iOS Safari 专属项）

---

## 1. 真实预览环境验证（PASS）

- 目标 URL：`https://dsh.easymana.online:8443/preview/u1-polish/`
- 静态资源响应：

| 资源 | HTTP 状态 | 大小 (bytes) | 耗时 (ms) | Content-Type | 关键内容校验 |
|---|---:|---:|---:|---|---|
| `index.html` | 200 | 497,925 | 1556 | `text/html; charset=utf-8` | `APP_VERSION='v253'`，包含 `--ease-spring` / `--shadow-card` 等 U1 token |
| `manifest.webmanifest` | 200 | 1,041 | 484 | — | 正常返回 |
| `sw.js` | 200 | 5,471 | 163 | `text/javascript; charset=utf-8` | `CACHE='dsh-preview-u1-polish-v253'` |
| `icon-192.png` | 200 | 15,231 | 201 | `image/png` | 正常返回 |
| `icon-512.png` | 200 | 59,440 | 167 | `image/png` | 正常返回 |

- Service Worker 注册与激活：
  - `scope`: `https://dsh.easymana.online:8443/preview/u1-polish/`
  - `state`: `activated`
  - `caches`: `["dsh-preview-u1-polish-v253"]`
- 4 组视口×皮肤（`390×844` / `430×932` × `paper` / `carbon`）：
  - `paper` 背景：`rgb(245, 244, 239)`（`#F5F4EF`）
  - `carbon` 背景：`rgb(10, 11, 13)`（`#0A0B0D`）
  - `scrollWidth === clientWidth`（0 横向溢出）
  - `consoleErrors: 0`、`pageErrors: 0`、`failedRequests: 0`

---

## 2. 本地 U1 视觉与原生动效验收详情（模拟环境，PASS）

### 2.1 列表页（390×844 & 430×932 × Paper / Carbon）
- `.hero h1` 计算颜色：
  - Paper：`rgb(22, 22, 19)` === `var(--fg)` (`#161613`)
  - Carbon：`rgb(242, 240, 232)` === `var(--fg)` (`#F2F0E8`)
- 搜索栏：`.searchrow .sico svg` 正常渲染，`input` `padding-left = 36px`（≥ 34px，placeholder 与放大镜图标无重叠）。
- 会话卡片 `.row`：
  - Paper：`box-shadow: rgba(26, 26, 22, 0.04) 0px 1px 2px 0px, rgba(26, 26, 22, 0.03) 0px 4px 12px 0px`
  - Carbon：`box-shadow: rgba(255, 255, 255, 0.043) 0px 1px 0px 0px inset, rgba(0, 0, 0, 0.35) 0px 2px 10px 0px`
  - 4 种视口×皮肤组合均为 0 横向溢出。
- 运行状态灯 `.dot.run`：`animation-name: dotpulse`。

### 2.2 会话页（Paper + Carbon + `html.kb-open`）
- 顶栏毛玻璃：`header` `backdrop-filter: blur(20px)`（双皮肤均生效）。
- 代码块原地复制：`.codecopy` 初始文案 `复制`，点击后原地变为 `✓ 已复制` 并附加 `.copied` class。
- 消息操作栏：`.mact button svg` 共 8 枚线性 SVG（≥ 3）；点击消息复制按钮原地变为 `已复制` 并附加 `.copied` class。
- 悬浮底栏：`.prog` 与 `.composer`（`box-shadow: rgba(26, 26, 22, 0.08) 0px 6px 24px 0px, ...`）层次清晰。
- 键盘弹起态（`html.kb-open` + `--vvh: 480px`）：`.prog` `display: none`，`dockBottom = 480`，与对话主区域无重叠。

### 2.3 弹簧底部弹层与矮屏 A11y
- 打开模型选择弹层（9 项）：
  - `.sheet` 可见，`document.activeElement` 落在 `.sheet` 容器；
  - 首项 `.sheet .item` `:focus-visible = false`、`outline-style = none`（无误触发黑框）。
- 按 `Escape` 键：
  - 立即触发 `.mask.closing`（`true`）；
  - 300ms 内 `.mask` 数量变为 `0`。
- `320×672` 矮屏验证：`.sheet` `clientHeight = 651`、`scrollHeight = 787`、`overflow-y = auto`，支持顺滑滚动。

### 2.4 设置页（Paper + Carbon）
- 11 个可点设置项（`button.srow`）全部包含 `.schev svg` 右箭头。
- 只读信息行（`已配对设备`）无 `.schev`。
- 开关开启态 `.tgl.on`（在设置 → 语音子页双皮肤实测）：
  - Paper：`rgb(39, 103, 59)` === `var(--ok)`
  - Carbon：`rgb(142, 224, 115)` === `var(--ok)`

### 2.5 其他页面冒烟（0 控制台/页面/网络报错）
- **子代理**：`.subbar` 显示 2 个子代理，点击打开 `.subsheet`（2 项）→ 点击进入只读视图正常。
- **文件 Tab / 右侧文件抽屉 / 全屏查看器**：文件 Tab（2 根路径、4 条目）、会话内右侧 `.rpanel` 抽屉（4 条目）、全屏查看器 `.viewer` 双皮肤背景跟随（Paper `rgb(245, 244, 239)` / Carbon `rgb(10, 11, 13)`）。
- **新会话大输入页 / 定时任务 / Git 概览页**：全部正常渲染、0 横向溢出、0 报错。

---

## 3. 截图清单（`docs/verify/u1-polish-preview/shots/`）

- `01-preview-390-paper.png` ~ `04-preview-430-carbon.png`：真实预览站 4 组视口×皮肤配对页
- `05-list-390-paper.png` ~ `08-list-430-carbon.png`：列表页 4 组视口×皮肤
- `09-session-390-paper-copied.png`、`10-session-430-carbon.png`、`11-session-390-paper-kbopen.png`：会话页双皮肤、原地复制变身与键盘弹起态
- `12-sheet-390-paper.png`、`13-sheet-320x672-short.png`：弹簧弹层 A11y 与 320×672 矮屏滚动
- `14-subagent-readonly.png`、`15-right-file-drawer.png`、`16-viewer-paper.png`、`17-viewer-carbon.png`：子代理、右侧文件抽屉与双皮肤全屏查看器
- `18-settings-390-paper.png`、`19-settings-390-carbon.png`、`20-settings-voice-toggle.png`：设置页双皮肤与开关绿
- `21-files-tab.png`、`22-new-session.png`、`23-schedule.png`、`24-git.png`：文件 Tab、新会话、定时任务与 Git 概览页
