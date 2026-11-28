import { openSession, reloadApp } from '../core/bus.js';
import { ALWAYS_DONE_KEY, PUSH_DEVICE_KEY } from '../core/config.js';
import { state, uuid } from '../core/state.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { openSheet } from '../components/sheet.js';
import { openInfoBox } from '../components/chrome.js';

async function consumePendingOpen() {
  try {
    if (!('caches' in window)) return false;
    const c = await caches.open('dsh-open');
    const res = await c.match(new Request('./__pending-open'));
    if (!res) { window.__lastPending = 'no-record'; return false; }
    const j = await res.json().catch(() => null);
    window.__lastPending = j;
    if (!j || !j.sessionId) { await c.delete(new Request('./__pending-open')); return false; }
    if (Date.now() - (j.at || 0) > 10 * 60 * 1000) { await c.delete(new Request('./__pending-open')); return false; }
    if (state.view === 'session' && state.sessionId === j.sessionId) {
      await c.delete(new Request('./__pending-open'));
      return false;
    }
    const s = state.sessions.find(x => x.sessionId === j.sessionId)
      || { sessionId: j.sessionId, title: '(来自通知)' };
    openSession(s);
    // push 跳转发生在布局/视口还没稳定时，补量两次高度，避免输入框停在屏幕中间
    setTimeout(() => { try { window.__syncViewport && window.__syncViewport(); } catch {} }, 80);
    setTimeout(() => { try { window.__syncViewport && window.__syncViewport(); } catch {} }, 500);
    // 跳成功才删；失败留着，下次启动还能再试一次
    await c.delete(new Request('./__pending-open'));
    window.__lastPending = { ...j, consumed: true };
    return true;
  } catch (e) { window.__lastPending = 'err:' + (e && e.message); return false; }
}

// 冷启动点通知：SW 的 notificationclick 可能比页面 boot 稍晚写便条，
// 单次读取会正好错过（真机表现为"点了通知还是停在列表"）。多次重试兜住这个时序。

function consumePendingOpenSoon() {
  for (const ms of [0, 250, 600, 1200, 2400, 4000]) {
    setTimeout(() => { consumePendingOpen().catch(() => {}); }, ms);
  }
}

// 前台点通知：SW 的 postMessage 可能丢（页面未受控），所以可见时定周期读一次便条。
// 便条只在「点了通知」时才写（SW 的 notificationclick），不会误跳。

let pendingWatchStarted = false;

function consumePendingOpenWatch() {
  if (pendingWatchStarted) return;
  pendingWatchStarted = true;
  setInterval(() => {
    if (document.visibilityState === 'visible' && state.token) consumePendingOpen().catch(() => {});
  }, 2000);
  try { window.addEventListener('focus', () => { consumePendingOpen().catch(() => {}); }); } catch {}
}
// 推送诊断：把 SW/权限/缓存里那张"便条"都摊开，冷启动点通知后看一眼就知道卡在哪

async function openPushDiag() {
  const rows = [];
  try {
    const st = await pushStatus();
    rows.push(['通知状态', st]);
  } catch { rows.push(['通知状态', 'err']); }
  rows.push(['权限', (typeof Notification !== 'undefined' ? Notification.permission : '-')]);
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    rows.push(['SW 作用域', reg ? (reg.scope || '-') : '未注册']);
    rows.push(['SW 状态', reg ? (reg.active ? 'active' : (reg.installing ? 'installing' : 'waiting')) : '-']);
  } catch { rows.push(['SW', 'err']); }
  try {
    const c = await caches.open('dsh-open');
    const keys = await c.keys();
    rows.push(['dsh-open 条目', String(keys.length)]);
    const last = await c.match(new Request('./__last-push'));
    rows.push(['最近推送会话', last ? ((await last.json()).sessionId || '-').slice(0, 18) : '无']);
    const pend = await c.match(new Request('./__pending-open'));
    rows.push(['待打开便条', pend ? JSON.stringify(await pend.json()).slice(0, 60) : '无']);
  } catch (e) { rows.push(['caches', 'err:' + (e && e.message)]); }
  rows.push(['本次消费记录', typeof window.__lastPending === 'string' ? window.__lastPending : JSON.stringify(window.__lastPending || null).slice(0, 60)]);
  openInfoBox('推送诊断', rows);
}


function pushDeviceId() {
  let id = localStorage.getItem(PUSH_DEVICE_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(PUSH_DEVICE_KEY, id);
  }
  return id;
}

// VAPID 公钥是 base64url，订阅时要 Uint8Array

function b64urlToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}


const withTimeout = (p, ms, fallback) =>
  Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);

// 之前页面根本没注册 SW —— sw.js 一直在，但没人 register，
// 于是 serviceWorker.ready 永远不 resolve，推送和离线兜底都形同虚设。

let swRegPromise = null;

function ensureSW() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!swRegPromise) {
    swRegPromise = navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch(() => navigator.serviceWorker.getRegistration().catch(() => null));
  }
  return swRegPromise;
}
ensureSW();   // 脚本一加载就注册，别等用户点

// 拿到一个可用的 registration（同样限时，避免 ready 永不 resolve 把界面卡死）

async function getReg() {
  await ensureSW();
  const reg = await withTimeout(navigator.serviceWorker.ready, 5000, null)
    || await navigator.serviceWorker.getRegistration().catch(() => null);
  return reg;
}


async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  try {
    await ensureSW();
    let reg = await withTimeout(navigator.serviceWorker.ready, 5000, null);
    if (!reg) reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    if (!reg) return 'nosw';
    // 有可能只是还在安装
    if (!reg.active && (reg.installing || reg.waiting)) return 'installing';
    const sub = await withTimeout(reg.pushManager.getSubscription(), 3000, null);
    if (sub) return 'on';
    return (typeof Notification !== 'undefined' && Notification.permission === 'denied') ? 'denied' : 'off';
  } catch { return 'off'; }
}

// 单独的「通知提醒」面板：不依赖任何可能挂起的 await

async function openPushSettings() {
  const st = await pushStatus();
  const label = {
    on: '已开启（这台设备会收到推送）',
    off: '未开启',
    denied: '系统里被拒绝，请去 设置 → 通知 里打开',
    unsupported: '这个浏览器不支持 Web Push（需要 iOS 16.4+ 且已添加到主屏）',
    nosw: 'Service Worker 没注册上',
    installing: 'Service Worker 正在激活，等 5 秒再点一次',
  }[st] || st;

  const items = [];
  if (st === 'off') items.push({ label:'开启通知提醒', icon:'🔔', run: enablePush });
  if (st === 'on') items.push({ label:'关闭通知提醒', icon:'🔕', run: disablePush });
  items.push({ label: (alwaysDone() ? '完成时总是推送：已开' : '完成时总是推送：已关'), icon: '📣',
    run: () => { setAlwaysDone(!alwaysDone()); pushHeartbeat(); openPushSettings(); } });
  items.push({ label:'重新检测', icon:'🔄', run: openPushSettings });
  items.push({ label:'重新加载', icon:'↻', run: reloadApp });

  openSheet(items, `通知提醒 · ${label}`);
}


async function enablePush() {
  if (!('Notification' in window)) { toast('这个浏览器不支持通知'); return; }
  toast('正在申请通知权限…');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('通知权限被拒绝，去 设置 → Safari → 通知 里打开'); return; }
  try {
    const reg = await getReg();
    const vapid = await api('/push/vapid', { auth: false });
    if (!vapid || !vapid.publicKey) throw new Error('取不到 VAPID 公钥');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToU8(vapid.publicKey),
    });
    await api('/push/subscribe', {
      method: 'POST',
      body: { deviceId: pushDeviceId(), subscription: sub.toJSON(), ua: navigator.userAgent.slice(0, 120) },
    });
    toast('通知已开启');
  } catch (e) {
    toast('开启失败：' + (e.message || e));
  }
}


async function disablePush() {
  try {
    const reg = await getReg();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { method:'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    toast('通知已关闭');
  } catch (e) { toast('关闭失败：' + (e.message || e)); }
}

// 告诉服务端"我正在看"，宿主据此决定要不要推

function alwaysDone() { try { return localStorage.getItem(ALWAYS_DONE_KEY) === '1'; } catch { return false; } }

function setAlwaysDone(v) { try { localStorage.setItem(ALWAYS_DONE_KEY, v ? '1' : '0'); } catch {} }


let pushHeartbeatTimer = null;

function pushHeartbeatLoop() {
  if (pushHeartbeatTimer) return;
  pushHeartbeatTimer = setInterval(() => {
    if (document.visibilityState === 'visible') pushHeartbeat();
  }, 20000);
}


function pushHeartbeat() {
  try {
    api('/push/active', { method:'POST', auth:false, body: { deviceId: pushDeviceId(), alwaysDone: alwaysDone() } }).catch(() => {});
  } catch {}
}


export { alwaysDone, consumePendingOpen, consumePendingOpenSoon, consumePendingOpenWatch, disablePush, enablePush, openPushDiag, openPushSettings, pushHeartbeat, pushHeartbeatLoop, pushStatus, setAlwaysDone };
