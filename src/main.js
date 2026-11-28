import { registerHooks } from './core/bus.js';
import { CACHE_V2, LS } from './core/config.js';
import { state, ui } from './core/state.js';
import { el, root, showFatal } from './core/dom.js';
import { toast } from './core/toast.js';
import { idbInit, readListCache } from './core/cache.js';
import { applyNetMode } from './core/net.js';
import { syncBadge } from './core/badge.js';
import { installOfflineBar, installSwipeBack, installViewportSync } from './core/gestures.js';
import { paintConnPills, tabBar } from './components/chrome.js';
import { openDrawer, paintOpenDrawer } from './components/drawer.js';
import { openFileDrawer } from './components/file-drawer.js';
import { consumePendingOpen, consumePendingOpenSoon, consumePendingOpenWatch, pushHeartbeat, pushHeartbeatLoop } from './features/push.js';
import { downloadHostFile, openHostPath } from './features/media.js';
import { loadTermAgents, newTerminal, termAgents, termToken } from './features/terminal.js';
import { cancelVoiceInput, primeSpeech, stopSpeak } from './features/voice.js';
import { paintProg } from './features/steps.js';
import { loadStopSummary } from './features/stop-summary.js';
import { createWorkspaceAt, loadRoots, openNewSessionSheet, openStats, reloadApp } from './features/session-actions.js';
import { loadMessages, onFrame, openSession, refreshAll, subscribeDevice, subscribeSession } from './features/sync.js';
import { renderPair } from './views/pair.js';
import { renderList } from './views/list.js';
import { renderNewSession } from './views/new-session.js';
import { paint, paintSession, renderSession, repaintSessionKeepingScroll } from './views/session.js';
import { loadFiles, renderFiles } from './views/files.js';
import { renderSettings, renderSubPage } from './views/settings.js';
import { renderSubagentView } from './views/subagent-view.js';
import { renderSchedule, renderScheduleDetail, renderScheduleNew } from './views/schedule.js';
import { openGit, renderGit } from './views/git.js';

function render() {
  // 离开会话就收掉朗读/录音，别在列表页还有声音
  if (state.view !== 'session') { stopSpeak(); cancelVoiceInput(); }
  root.replaceChildren();
  if (!state.token) return renderPair();
  try {
    const wrap = el('div', { class:'app' });
    if (state.view === 'list') { ui.sessionId = null; renderList(wrap); }
    else if (state.view === 'files') renderFiles(wrap);
    else if (state.view === 'settings') renderSettings(wrap);
    else if (state.view === 'new') renderNewSession(wrap);
    else if (state.view === 'sub') renderSubPage(wrap);
    else if (state.view === 'subagent') renderSubagentView(wrap);
    else if (state.view === 'schedule') renderSchedule(wrap);
    else if (state.view === 'scheduleNew') renderScheduleNew(wrap);
    else if (state.view === 'scheduleDetail') renderScheduleDetail(wrap);
    else if (state.view === 'git') renderGit(wrap);
    else renderSession(wrap);
    if (state.view === 'list' || state.view === 'files' || state.view === 'settings') wrap.append(tabBar(state.view));
    root.append(wrap);
    paintOpenDrawer();
  } catch (e) {
    console.error('[render]', e);
    showFatal(e);
  }
}

// 抽屉开着时同步重绘里面的列表（搜索框、tab 都在抽屉内）。
// 置顶/重命名/归档等操作在会话页里发生时不会走 render()，refreshAll 里也要调一次，
// 否则抽屉里还是旧数据，得关掉重开才看到。



// 注册全部跨层回调，解除核心层与视图层的循环依赖

registerHooks({
  createWorkspaceAt,
  downloadHostFile,
  loadFiles,
  loadMessages,
  loadRoots,
  loadStopSummary,
  onFrame,
  openDrawer,
  openFileDrawer,
  openGit,
  openHostPath,
  openNewSessionSheet,
  openSession,
  openStats,
  paint,
  paintConnPills,
  paintProg,
  paintSession,
  refreshAll,
  reloadApp,
  render,
  renderList,
  repaintSessionKeepingScroll,
  subscribeDevice,
  toast,
});



if (CACHE_V2) idbInit();
// ---------------- 待查看提醒（图标角标） ----------------
// iOS 16.4+ 的主屏 Web App、以及 Chrome 安装的 PWA 都支持 Badging API：
//   navigator.setAppBadge(n) / clearAppBadge()
// 限制：只有 App 进程活着时才更新得掉；冷启动前无法主动点亮（那需要 Web Push）。
// 角标公式必须和宿主推送那一侧一致：未读会话数 + 待处理会话数。
// 宿主在 patches/push-notify.js 的 badgeNumber() 里按「read-receipts 的 lastTurn/readAt」
// 与「审批/提问桥的挂起表」算同一份数；这里就用 /sessions 下发的 lastTurn 与
// pendingInteraction（同一个来源）算，推送点亮数字、App 打开覆盖数字时就不会互相跳。

window.addEventListener('error', e => {
  root.append(el('div', { class:'card' }, el('div', { class:'ct', text:'页面出错' }),
    el('pre', { text: `${e.message}\n${(e.error && e.error.stack) || ''}`.slice(0, 700) })));
});

window.addEventListener('unhandledrejection', e => {
  root.append(el('div', { class:'card' }, el('div', { class:'ct', text:'异步出错' }),
    el('pre', { text: String((e.reason && e.reason.stack) || e.reason).slice(0, 700) })));
});

// 局域网 http 访问时浏览器不算「安全上下文」，crypto.randomUUID 不存在；但配对和发消息
// 都要用它，所以给一份等价兜底（https 下行为不变）。剪贴板兜底用下面文件里那份 copyText。

if (!window._agentsTokenListener) {
  window._agentsTokenListener = true;
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin) return;
    const d = ev.data || {};
    if (d.type === 'pwa-open-drawer') { openDrawer(); return; }
    if (d.type === 'pwa-open-files') { openFileDrawer(state.sessionCwd || ''); return; }
    if (d.type === 'pwa-new-terminal') {
      document.querySelectorAll('.termoverlay').forEach((n) => n.remove());
      newTerminal();
      return;
    }
    if (d.type === 'agents-pane-changed') {
      termAgents.at = 0;
      loadTermAgents();
      return;
    }
    if (d.type === 'agents-mode') {
      const ov = document.querySelector('.termoverlay');
      if (!ov) return;
      const ta = ov.querySelector('.tta');
      const sd = ov.querySelector('.tsend');
      const st = ov.querySelector('.tstop');
      const busyNow = !!(st && st.style.display === 'grid');
      if (ta && d.placeholder && !busyNow) ta.setAttribute('data-ph', String(d.placeholder));
      if (sd && !busyNow) sd.disabled = (d.mode === 'chat' && d.ready === false);
      return;
    }
    if (d.type === 'agents-busy') {
      const ov = document.querySelector('.termoverlay');
      if (!ov) return;
      const st = ov.querySelector('.tstop');
      const sd = ov.querySelector('.tsend');
      const ta = ov.querySelector('.tta');
      if (st) st.style.display = d.busy ? 'grid' : 'none';
      if (sd) {
        sd.style.display = d.busy ? 'none' : 'grid';
        if (!d.busy) sd.disabled = false;
      }
      if (ta) ta.setAttribute('data-ph', d.busy ? 'DSH 正在回答…' : (d.placeholder || '继续追问，Enter 发送'));
      return;
    }
    if (d.type !== 'agents-token-request') return;
    const t = termToken();
    if (t && ev.source) ev.source.postMessage({ type: 'agents-token', token: t }, location.origin);
  });
}
// 本地搜索：标题 / 最近一条 / **已缓存的消息正文**。
// 服务端 session/search 在这个部署里是关的（openAt "never"），所以正文只能搜本机
// dsh.cache.msgs 里那点（每个会话最近 120 条、最多留 10 个会话）。命中后给一段上下文剪辑。

document.addEventListener('pointerdown', primeSpeech, { once: true, capture: true });

// 按句切分：。！？!? 与换行都算边界，标点留在本段（不引 lookbehind，照顾旧 WebView）

if ('serviceWorker' in navigator) {
  try {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'open-session' && d.sessionId) {
        const s = state.sessions.find(x => x.sessionId === d.sessionId);
        openSession(s || { sessionId: d.sessionId, title: '(来自通知)' });
      }
    });
  } catch {}
}


(async () => {
  // 本地开发：只有在没有凭据、且确实在本机时才尝试 dev-token.json
  // （放线上会白等一个 404 往返，首屏被拖慢）
  const isLocalDev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!state.token && isLocalDev) {
    try {
      const r = await fetch('./dev-token.json', { cache:'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.token) { state.token = j.token; state.instanceId = j.instanceId || state.instanceId; localStorage.setItem(LS.token, j.token); }
      }
    } catch {}
  }
  // 缓存层 v2（默认开启，'0' 可回退）：启动时先把 IndexedDB 暖好（打开 / 迁移 / 索引 / 列表镜像）。
  // 打不开会自动回落 legacy，这里不用额外处理；回退开关为 '0' 时这一段不执行，启动路径与旧版一致。
  // 最多等 1.2 秒：JS 线程卡住时也不能让首屏一直白着，暖好后后续读写照常走 IDB。
  if (CACHE_V2) {
    try { await Promise.race([idbInit(), new Promise(r => setTimeout(r, 1200))]); } catch {}
  }
  // 有缓存就先画列表，网络回来再覆盖（秒开）
  if (state.token && !state.sessions.length) {
    const c = readListCache();
    if (c) state.sessions = c;
  }
  render();
  installSwipeBack();
  installViewportSync();
  installOfflineBar();
  if (state.token) {
    // ?lanbase=https://x:8443 强制走某条局域网入口（排障、换 SSID 时用）
    try {
      const lb = new URLSearchParams(location.search).get('lanbase');
      if (lb) { state.lanBase = lb.replace(/\/+$/, ''); state.mode = 'lan'; }
    } catch {}
    // 锁了「仅局域网」就先定通道再拉数据；自动档放到后台探，别拖慢首屏
    if (state.mode === 'lan') await applyNetMode({ silent: true });
    state.booted = true;
    consumePendingOpenSoon();                      // 冷启动点通知：多次重试读便条
    consumePendingOpenWatch();                     // 前台点通知也兜住（2 秒轮询便条）
    refreshAll().catch(() => {}).then(() => { consumePendingOpen(); });
    subscribeDevice();
    if (state.mode === 'auto') applyNetMode({ silent: true }).catch(() => {});
    pushHeartbeat();
    pushHeartbeatLoop();   // 前台每 20 秒续一次，避免"开着 App 却被判成离开了"
    // 从通知点进来会带 ?session=<id>（浏览器场景），等列表加载完再跳
    const wantSid = new URLSearchParams(location.search).get('session');
    if (wantSid) {
      setTimeout(() => {
        const s = state.sessions.find(x => x.sessionId === wantSid);
        openSession(s || { sessionId: wantSid, title: '(来自通知)' });
        try { history.replaceState(null, '', location.pathname); } catch {}
      }, 900);
    }
  }
})();


document.addEventListener('visibilitychange', () => {
  // F2：切后台/锁屏时停朗读、收掉录音（iOS 也会自己中断，这里保证状态一致）
  if (document.hidden) { stopSpeak(); cancelVoiceInput(); return; }
  if (state.token) {
    (async () => {
      // 回前台先确认通道：从公司网络回到家、或手机刚连上 Wi-Fi，都靠这一下切过去
      try { await applyNetMode(); } catch {}
      consumePendingOpenSoon();                      // 冷启动点通知：多次重试读便条
      refreshAll().catch(() => {}).then(() => { consumePendingOpen(); });
      syncBadge();
      pushHeartbeat();
      if (state.view === 'session') { loadMessages(); subscribeSession(); }
    })();
  }
});

// 自动档下每分钟探一次：局域网恢复了就切回来，断了就回中转

setInterval(() => {
  if (!state.token || state.mode !== 'auto') return;
  if (document.visibilityState !== 'visible') return;
  applyNetMode().catch(() => {});
}, 60000);

export { render };
