import { READ_LS } from './config.js';
import { state } from './state.js';
import { api } from './api.js';

function unreadCount() {
  let n = 0;
  const pending = new Set();
  for (const s of state.sessions) {
    const lt = (s && s.lastTurn) || {};
    if (lt.endedAt && lt.endedAt > readFloor(s)) n++;
    // pendingInteraction 是宿主给的「这条会话有卡挂着」（approval / question / plan-review）
    if (s && s.pendingInteraction) pending.add(s.sessionId);
  }
  // 列表有 30 秒缓存：刚到达的卡先用本地状态兜底，按会话去重（与宿主同口径）
  for (const c of state.cards) {
    const d = (c.data && c.data.data) || c.data || {};
    const sid = d.sessionId || state.sessionId;
    pending.add(sid || ('card:' + c.id));
  }
  // 别的会话的审批/提问（设备流推来、还没进列表）也算一个待处理会话
  for (const [, sid] of (state.foreign || new Map())) pending.add(sid || 'foreign');
  n += pending.size;
  return n;
}

// 本地已读水位：宿主 readAt 有写入延迟/失败时，开机后蓝点会重新亮回来。
// 本机记下「这条会话读到哪一刻」，判未读时取 host.readAt 与本地水位的较大值。
// 水位取打开那一刻的 lastTurn.endedAt（而不是 Date.now()），这样不受手机与电脑时钟偏差影响。

let readMarks = (() => {
  try { const j = JSON.parse(localStorage.getItem(READ_LS) || '{}'); return j && typeof j === 'object' ? j : {}; }
  catch { return {}; }
})();

function readFloor(s) {
  const lt = (s && s.lastTurn) || {};
  const local = Number(readMarks[s && s.sessionId]) || 0;
  return Math.max(Number(lt.readAt) || 0, local);
}

function markOpened(sessionId, at) {
  if (!sessionId) return;
  const mark = Number(at) || (state.sessions.find(x => x.sessionId === sessionId)?.lastTurn?.endedAt) || Date.now();
  if ((Number(readMarks[sessionId]) || 0) >= mark) return;
  readMarks[sessionId] = mark;
  const keys = Object.keys(readMarks);
  if (keys.length > 60) {
    keys.sort((a, b) => (readMarks[a] || 0) - (readMarks[b] || 0));
    for (const k of keys.slice(0, keys.length - 60)) delete readMarks[k];
  }
  try { localStorage.setItem(READ_LS, JSON.stringify(readMarks)); } catch {}
}


const isUnread = (s) => {
  const lt = (s && s.lastTurn) || {};
  return !!(lt.endedAt && lt.endedAt > readFloor(s));
};

// 一条会话当前对外展示的状态（颜色优先级：待处理 > 处理中 > 失败未读 > 完成未读 > 空闲）

const DOT_CLASS = { pending:'pending', running:'run', failed:'failed', done:'done', idle:'' };

const STATE_LABEL = {
  pending:'待你审批 / 回答', running:'处理中', failed:'上一轮失败，未读',
  done:'已完成，未读', idle:'空闲',
};

function sessionState(s) {
  if (!s) return 'idle';
  if (s.pendingInteraction) return 'pending';
  if (s.running) return 'running';
  if (!isUnread(s)) return 'idle';
  return ((s.lastTurn && s.lastTurn.status) === 'failed') ? 'failed' : 'done';
}
// 顶部 ☰ 角标用：按「最需要处理」的那类选颜色，数字是该类会话数

function attentionStats() {
  const pending = new Set();
  for (const s of state.sessions) if (s && s.pendingInteraction) pending.add(s.sessionId);
  // 列表有 30 秒缓存：刚到达的卡、别的会话推来的卡先按本地状态兜底
  for (const c of state.cards) {
    const d = (c.data && c.data.data) || c.data || {};
    pending.add(d.sessionId || state.sessionId || ('card:' + c.id));
  }
  for (const [, sid] of (state.foreign || new Map())) pending.add(sid || 'foreign');
  let running = 0, done = 0, failed = 0;
  for (const s of state.sessions) {
    if (s.pendingInteraction) continue;
    if (s.running) { running++; continue; }
    if (!isUnread(s)) continue;
    if ((s.lastTurn && s.lastTurn.status) === 'failed') failed++; else done++;
  }
  return { pending: pending.size, running, done, failed };
}


let badgeTimer = null;

function syncBadge() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(async () => {
    const n = unreadCount();
    const stats = attentionStats();
    state.attn = n;
    try {
      if (n > 0 && navigator.setAppBadge) await navigator.setAppBadge(n);
      else if (n === 0 && navigator.clearAppBadge) await navigator.clearAppBadge();
    } catch {}
    const title = n > 0 ? `(${n}) DSH` : 'DSH';
    if (document.title !== title) document.title = title;
    // 黄 = 有待审批/提问；红 = 有失败未读；蓝 = 有完成未读；绿 = 有任务在跑；都没有就不亮
    const top = stats.pending ? ['pending', stats.pending]
      : stats.failed ? ['failed', stats.failed]
      : stats.done ? ['done', stats.done]
      : stats.running ? ['running', stats.running] : null;
    const hint = `待处理 ${stats.pending} · 未读完成 ${stats.done} · 失败未读 ${stats.failed} · 进行中 ${stats.running}`;
    for (const node of document.querySelectorAll('[data-bell]')) {
      node.classList.remove('attn-pending', 'attn-failed', 'attn-done', 'attn-running');
      node.classList.toggle('has-attn', !!top);
      if (top) {
        node.classList.add('attn-' + top[0]);
        node.dataset.attnN = String(top[1]);
        node.title = hint;
      } else {
        delete node.dataset.attnN;
        node.removeAttribute('title');
      }
    }
  }, 120);
}

// 消费 SW 留下的「待打开会话」便条。
// 为什么要这个：iOS 上点通知只会用 start_url 把 App 拉起来，??session= 传不进来，
// notification.data 也不保证保留 —— 所以 SW 把 sessionId 写进 Cache Storage，这里取走。

async function markRead(sessionId) {
  try { await api('/api/mobile/v1/session/read', { method:'POST', body: { sessionId } }); } catch {}
  // 本地先把这一条标成已读：/sessions 有 30 秒缓存，不这样要等半分钟蓝点才消
  const s = state.sessions.find(x => x.sessionId === sessionId);
  if (s) { s.lastTurn = s.lastTurn || {}; s.lastTurn.readAt = Date.now(); }
  // 本地水位是第二层保险：宿主 readAt 写入失败/延迟时，重开 App 也不会把点又点亮
  markOpened(sessionId);
  syncBadge();
}

// 停留在会话页、且人已经在底部看最新消息时，自动把这一轮推进已读。
// 只靠打开会话时那一次 markRead 不够：后续新回复会让 lastTurn.endedAt 继续变大。

function markSessionSeen(sessionId) {
  if (!sessionId) return;
  if (document.visibilityState && document.visibilityState !== 'visible') return;
  const s = state.sessions.find(x => x.sessionId === sessionId);
  // 还在跑的这一轮先不消点，等 turn/end 后的摘要/消息落地
  if (state.busy) return;
  const summaryAt = Number(s && s.lastTurn && s.lastTurn.endedAt) || 0;
  const lastMsg = state.sessionId === sessionId && state.messages.length
    ? state.messages[state.messages.length - 1] : null;
  const lastMsgAt = Number(lastMsg && lastMsg.time) || 0;
  const endedAt = Math.max(summaryAt, lastMsgAt);
  if (!endedAt) return;
  if (endedAt <= (Number(readMarks[sessionId]) || 0)) return;
  markOpened(sessionId, endedAt);
  if (s) { s.lastTurn = s.lastTurn || {}; s.lastTurn.readAt = Date.now(); }
  syncBadge();
  api('/api/mobile/v1/session/read', { method:'POST', body: { sessionId } }).catch(() => {});
}


export { DOT_CLASS, STATE_LABEL, isUnread, markOpened, markRead, markSessionSeen, sessionState, syncBadge };
