import { loadMessages, paintConnPills, refreshAll, subscribeDevice } from './bus.js';
import { LS } from './config.js';
import { state } from './state.js';
import { toast } from './toast.js';
import { api } from './api.js';

async function probeHealth(base, timeout = 1500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const t0 = performance.now();
  try {
    const r = await fetch(base.replace(/\/+$/, '') + '/api/mobile/v1/health', { cache:'no-store', signal: ctl.signal });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const j = await r.json().catch(() => null);
    if (!j || j.ok !== true) return { ok: false, error: '不是插件健康响应' };
    return { ok: true, ms: Math.round(performance.now() - t0), instanceId: j.instanceId || '' };
  } catch (e) {
    const m = String((e && e.message) || e);
    return { ok: false, error: /abort/i.test(m) ? '超时' : (/failed to fetch|networkerror/i.test(m) ? '连不上（证书未信任或不在同一网段）' : m) };
  } finally {
    clearTimeout(timer);
  }
}

// 局域网候选从宿主嘴里拿：/connection-info 返回的 lanCandidates 就是它此刻的网卡地址。
// 端口换成 lan-server 自己监听的（默认 8443），因为插件报的是它自己的 18787。

async function lanCandidates() {
  const list = [];
  const push = (u) => {
    try {
      const x = new URL(u);
      if (x.protocol !== 'https:' && x.protocol !== 'http:') return;
      const origin = x.origin;
      if (!list.includes(origin)) list.push(origin);
    } catch {}
  };
  const port = String(state.lanPort || '8443');
  if (state.lanBase) push(state.lanBase);                              // 手填的排第一个
  // 稳定名字（<机器名>.local）：换 Wi-Fi 也不用改，所以有就优先试
  if (state.lanName) push(`https://${state.lanName.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`);
  try {
    const info = await api('/api/mobile/v1/connection-info');
    for (const c of (info.lanCandidates || info.lanUrls || [])) {
      const raw = typeof c === 'string' ? c : (c && c.url);
      try {
        const host = new URL(raw).hostname;
        push(`https://${host.includes(':') ? '[' + host + ']' : host}:${port}`);
      } catch {}
    }
    // 宿主名字像主机名时才拼 .local（换网后 IP 候选必然失效，这条还活着）
    const nm = String(info.name || '').trim().toLowerCase();
    if (!state.lanName && /^[a-z0-9][a-z0-9-]{1,62}$/.test(nm)) push(`https://${nm}.local:${port}`);
  } catch {}
  return list;
}


async function resolveNetMode() {
  if (state.mode === 'relay') return { base:'', channel:'relay' };
  if (state.mode === 'lan') {
    if (!state.lanBase) return { base:'', channel:'relay', error:'还没填局域网地址' };
    const p = await probeHealth(state.lanBase);
    return p.ok
      ? { base: state.lanBase, channel:'lan', ms:p.ms, instanceId:p.instanceId }
      : { base:'', channel:'relay', error:p.error };
  }
  const list = await lanCandidates();
  let lastError = '';
  for (const b of list) {
    const p = await probeHealth(b);
    if (p.ok) return { base: b, channel:'lan', ms:p.ms, instanceId:p.instanceId };
    lastError = p.error;
  }
  return { base:'', channel:'relay', error: list.length ? (lastError || '局域网不可达') : '没有局域网候选' };
}

// 换道：关掉旧的长连接 → 用新基址重连并刷新数据。启动阶段由启动流程自己拉，不在这里重来。

async function applyNetMode({ silent = false } = {}) {
  if (!state.token) return;
  const before = state.apiBase;
  const r = await resolveNetMode();
  state.apiBase = r.base;
  // 中转没有探测延迟；用当前线路对 /health 做一次轻量测速，列表/设置才能显示真实 ms
  if (!r.ms && r.channel === 'relay') {
    const t0 = performance.now();
    try { await api('/api/mobile/v1/health'); r.ms = Math.round(performance.now() - t0); } catch {}
  }
  state.netInfo = { ...r, at: Date.now() };
  paintConnPills();
  if (r.base === before) return r;
  if (!state.booted) return r;
  if (!silent) toast(r.base ? `已切到局域网直连${r.ms ? ' · ' + r.ms + 'ms' : ''}` : '已切回中转');
  try { state.live?.close(); } catch {}
  try { state.device?.close(); } catch {}
  subscribeDevice();
  refreshAll(true);
  if (state.view === 'session') loadMessages();
  return r;
}


function setNetMode(mode, lanBase) {
  state.mode = mode;
  try { localStorage.setItem(LS.mode, mode); } catch {}
  if (lanBase !== undefined) {
    state.lanBase = String(lanBase || '').trim().replace(/\/+$/, '');
    try { localStorage.setItem(LS.lanBase, state.lanBase); } catch {}
  }
  applyNetMode().catch(() => {});
}

// ---------------------------------------------------------------- API

export { applyNetMode, setNetMode };
