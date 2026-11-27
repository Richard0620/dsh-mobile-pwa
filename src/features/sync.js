import { paint, paintSession, render } from '../core/bus.js';
import { state, ui } from '../core/state.js';
import { clearLocalCaches, readMsgCache, saveListCache, saveMsgCache } from '../core/cache.js';
import { api } from '../core/api.js';
import { openStream } from '../core/sse.js';
import { markOpened, markRead, markSessionSeen, syncBadge } from '../core/badge.js';
import { closeDrawer, paintOpenDrawer } from '../components/drawer.js';
import { autoReadLatest, cancelVoiceInput, stopSpeak } from './voice.js';
import { applyLiveSteps, beginTurn, endTurn, findTodoPhase, markBusy, paintProg, phaseFromMessages, refreshStepsSheet, resetSteps, samePhase, syncBusyTicker } from './steps.js';
import { turnFromFrame } from './stop-summary.js';
import { loadSubagents } from './subagents.js';
import { pushCard } from './queue-cards.js';
import { loadModel } from './session-actions.js';

async function refreshAll(force=false) {
  const tok = state.token;
  try {
    const [s, w] = await Promise.all([
      api('/api/mobile/v1/sessions' + (force ? '?fresh=1' : '')),
      api('/api/mobile/v1/workspaces').catch(() => ({ items: [] })),
    ]);
    if (state.token !== tok) return;   // 退登/换账号后回来的旧响应：别写进新账号的列表和缓存
    state.sessions = s.items || [];
    state.workspaces = w.items || [];
    saveListCache(state.sessions);
    // 设备流里记下的「别的会话待处理」：强制刷新拿到的最新列表说没有了就撤掉
    // （缓存响应可能滞后，所以只在 force 时清）
    if (force && state.foreign && state.foreign.size) {
      for (const [id, sid] of state.foreign) {
        const sess = state.sessions.find(x => x.sessionId === sid);
        if (!sess || !sess.pendingInteraction) state.foreign.delete(id);
      }
    }
    syncBadge();
    if (state.view === 'list') render();
    else if (force) paintOpenDrawer();
    // 会话页正停在底部看最新回复：摘要刷新后立刻把这轮标已读
    if (state.view === 'session' && document.visibilityState === 'visible'
      && ui && ui.sessionId === state.sessionId && ui.atBottom) markSessionSeen(state.sessionId);
  } catch (e) {
    if (['device-revoked','device-expired','unauthorized'].includes(e.code)) {
      state.token = ''; clearLocalCaches(); render();
    }
  }
}

// 运行态以服务端 sessions[].running 为准。列表有 30 秒缓存，所以必须 fresh=1 才拿得到实时值。

async function syncRunning() {
  try {
    const r = await api('/api/mobile/v1/sessions?fresh=1');
    const s = (r.items || []).find(x => x.sessionId === state.sessionId);
    if (!s) return;
    const running = !!s.running;
    if (running !== state.busy) {
      markBusy(running);
      if (state.view === 'session') { paintSession(); try { ui.loadStats?.(); } catch {} }
    }
  } catch {}
}

// 卡片去重 + 过期：重连/回放会把历史审批帧再推一遍，不去重就会叠出好几张一样的卡

function openSession(s) {
  closeDrawer();
  stopSpeak();
  cancelVoiceInput();
  state.autoReadPending = false;
  state.view = 'session';
  state.sessionId = s.sessionId;
  state.sessionTitle = s.title || '(无标题)';
  state.messages = []; state.cards = []; state.lastSeq = 0; state.busy = !!s.running; state.busySince = 0;
  resetSteps();   // 切会话必须清空过程进度，别把上一个会话的步骤串过来
  state.turn = null; state.turnStartedAt = 0; state.stopSummary = null;
  state.sessionRestore = null;
  state.model = null; state.pending = []; state.unseen = 0; state.msgLimit = 120;
  state.queue = [];
  state.permCurrent = '';
  state.modelGroups = []; state.modelMeta = null;
  state.sessionCwd = s.cwd || '';
  // F3：换会话时目录必须清空，别把上一条会话的子代理带过来
  state.subagents = []; state.subagentsFor = null; state.subagentsAt = 0;
  state.subagentsParentAvailable = true; state.subagentsLoading = false;
  state.subagent = null; state.subagentMessages = []; state.subagentError = '';
  clearInterval(state.subagentPoll); state.subagentPoll = null;
  // 本地已读水位：进来的这一刻就消点，不等宿主 readAt 落盘
  markOpened(s.sessionId, s.lastTurn && s.lastTurn.endedAt);
  render();
  // F3：目录元数据先拉一次，回来再补画入口条（不挡消息渲染）
  loadSubagents(s.sessionId, { force: true });
  // 先拿本地缓存把内容画出来（秒开 / 离线也能看），再用网络结果覆盖
  const cachedMsgs = readMsgCache(s.sessionId);
  if (cachedMsgs && Array.isArray(cachedMsgs.messages) && cachedMsgs.messages.length) {
    state.messages = cachedMsgs.messages;
    paintSession({ scroll:'bottom' });
  }
  // 先取完消息拿到正确的 lastSeq，再订阅流：否则 lastSeq=0 会把历史帧（含旧审批）整体回放一遍
  // force=true：打开会话（包括从通知点进来）一律落到最新一条，别停在历史位置
  loadMessages(true).then(() => {
    loadModel(); subscribeSession();
    // 图片/代码块加载后高度会变，再补两次贴底
    requestAnimationFrame(() => { if (ui.body && ui.body.isConnected) ui.body.scrollTop = ui.body.scrollHeight; });
    setTimeout(() => { if (ui.body && ui.body.isConnected) ui.body.scrollTop = ui.body.scrollHeight; }, 350);
    // 打开即视为已读（宿主侧有 readAt，图标角标也就跟着掉一个）
    markRead(state.sessionId).then(() => { refreshAll(true); syncBadge(); });
  });
  // 兜底轮询：SSE 走不通时这条就是主通道，1.5 秒一次，保证"发完马上能看到"。
  // SSE 通的时候它会先到，轮询只是补漏（1.5s 内没有新内容就不会重绘，开销很小）。
  clearInterval(state.poll);
  state.poll = setInterval(() => {
    if (state.view !== 'session') return;
    // 页面在后台就不轮询（省电）；空闲时 4 秒一次，运行中 1.5 秒
    if (document.hidden) return;
    const gap = state.busy ? 1500 : 4000;
    if (Date.now() - (state.lastMsgLoad || 0) >= gap) loadMessages();
    // F3 目录有 30 秒缓存：轮询顺手补一次，跑完/派完不用手动刷新
    if (Date.now() - (state.subagentsAt || 0) >= 30000) loadSubagents(state.sessionId);
    if (state.busy && Date.now() - (state.lastRunCheck || 0) > 3000) {
      state.lastRunCheck = Date.now();
      syncRunning();
      try { ui.loadStats?.(); } catch {}
    }
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.view === 'session') loadMessages(true);
  });
}


async function loadMessages(force=false, sidOverride=null) {
  const sid = sidOverride || state.sessionId;
  if (!sid) return;
  const tok = state.token;
  state.lastMsgLoad = Date.now();
  try {
    const r = await api(`/api/mobile/v1/session/messages?sessionId=${encodeURIComponent(sid)}`);
    if (state.token !== tok) return;   // 退登/换账号后回来的旧响应：连缓存都不能写
    const items = r.items || [], lastSeq = r.lastSeq || 0;
    saveMsgCache(sid, items, lastSeq);
    // 请求期间用户可能已切走：只写缓存，不能把 A 的消息灌进 B
    if (state.sessionId !== sid) return;
    state.messages = items;
    state.lastSeq = lastSeq;
    // F1：历史 phase 只在「当前轮还没有实时 phase」时回填：
    // 运行中只认同一 turn 的 todo_write；如果连当前 turn 都还不知道（刚进一个在跑的会话），
    // 一律不回填，避免上一轮的 index/total 被当成这一轮。
    const allowTurn = state.busy ? state.stepsTurn : null;
    if (!state.phase && !(state.busy && allowTurn == null)) {
      const found = phaseFromMessages(items, allowTurn);
      if (found) {
        state.phase = found;
        ui.progSig = '';
      }
    }
    if (state.view === 'session') paintSession(force ? { scroll:'bottom' } : {});
    // F2：这一轮结束且开了自动朗读 → 读最新一条回复。
    // 延到进度条「已完成 · N 步」收尾之后（2.5s 开始淡出、约 3.3s 清空）再开口：
    // 朗读条和完成行占的是同一个位置，立刻读会把完成行顶掉，用户看不到这一轮跑了几步。
    if (state.autoReadPending) {
      state.autoReadPending = false;
      const readSid = sid;
      setTimeout(() => {
        if (state.view !== 'session' || state.sessionId !== readSid) return;
        if (state.speaking || state.rec) return;
        autoReadLatest(items);
      }, 3300);
    }
    // 新回复已经渲染出来，且人就在底部：本地水位立即推进，回列表不再亮未读
    if (state.view === 'session' && state.sessionId === sid && ui && ui.atBottom) markSessionSeen(sid);
  } catch (e) { console.warn('messages', e); }
}


function subscribeSession() {
  state.live?.close();
  const sid = state.sessionId;
  state.live = openStream(`/api/mobile/v1/session/stream?sessionId=${encodeURIComponent(sid)}&lastSeq=${state.lastSeq}`, {
    onState: (st, err) => {
      state.stream = st;
      if (!ui.dot) return;
      ui.dot.className = st === 'open' ? 'dot run' : 'dot';
      ui.dot.title = st === 'open' ? '实时已连接' : `重连中…${err ? ' ' + (err.message || err) : ''}`;
      paintProg(true);
      syncBusyTicker();
    },
    onFrame: f => { if (state.sessionId === sid) onFrame(f); },
  });
}


function onFrame(frame) {
  const t = frame.type || '';
  if (t === 'session/heartbeat') return;
  if (frame.seq && frame.seq > state.lastSeq) state.lastSeq = frame.seq;

  if (t === 'approval/requested' || t === 'approval/asked') pushCard('approval', frame);
  else if (t === 'question/requested') pushCard('question', frame);
  else if (t === 'session/queue') {
    // 排队条：placement=queued 的才是"待发"，steering 只是回执
    state.queue = ((frame.items || []).filter(it => it && it.placement === 'queued'));
    if (state.view === 'session') paintSession();
    return;
  }
  else if (t === 'approval/resolved' || t === 'approval/decided') {
    const rid = frame.approvalId || (frame.data && frame.data.id);
    const before = state.cards.length;
    state.cards = state.cards.filter(c => c.id !== rid);
    if (state.cards.length !== before) syncBadge();
  }
  else if (t === 'question/resolved') {
    const rid = frame.questionId || frame.rpcId || (frame.data && frame.data.id);
    const before = state.cards.length;
    state.cards = state.cards.filter(c => c.id !== rid);
    if (state.cards.length !== before) syncBadge();
  }
  else if (t === 'turn/start') {
    beginTurn();
    if (state.view === 'session') paint();
    return;
  }
  else if (t === 'turn/end' || t === 'turn/ended') {
    endTurn();
    clearTimeout(onFrame._t);
    onFrame._t = setTimeout(loadMessages, 350);
    if (state.view === 'session') paint();
    return;
  }
  else if (t === 'session/live-steps') {
    // F1：full=true 整份快照 / full=false 增量；turn 变了按轮隔离
    if (frame.sessionId && frame.sessionId !== state.sessionId) return;
    applyLiveSteps(frame);
    paintProg(true);
    return;
  }
  else if (t === 'session/event') {
    const ev = frame.event || {};
    const inner = (ev.data && ev.data.type) || (frame.data && frame.data.type) || ev.type || '';
    if (inner === 'turn/start') {
      beginTurn();                                   // F1：清步骤/phase + markBusy + 进度条
      state.turn = turnFromFrame(frame, ev);          // F4：轮号可能挂在 event / event.data / frame.data
      state.turnStartedAt = Date.now();
      state.stopSummary = null;
    }
    if (inner === 'turn/end' || inner === 'turn/ended') {
      endTurn();                                      // F1：收进度条 + 自动朗读标记
      loadSubagents(state.sessionId, { force: true }); // F3：一轮结束顺手刷新子代理目录
    }
    const ph = findTodoPhase(frame);
    if (ph) {
      if (!samePhase(state.phase, ph)) {
        state.phase = ph;
        paintProg(true);
        refreshStepsSheet(true);
      }
    }
    clearTimeout(onFrame._t);
    onFrame._t = setTimeout(loadMessages, 350);
    return;
  }
  if (state.view === 'session') paint();
}

// 通知点击：SW 会 postMessage，带着要打开的会话

function subscribeDevice() {
  state.device?.close();
  state.device = openStream('/api/mobile/v1/events/stream', {
    onFrame: f => {
      const p = f.payload || f;
      if (p.type === 'device/list-changed' || f.type === 'session/summary') {
        // 设备流事件可能很密，节流一下，避免角标把列表刷爆
        if (Date.now() - (subscribeDevice._last || 0) > 3000) {
          subscribeDevice._last = Date.now();
          refreshAll();
        }
      }
      // 别的会话里挂起的审批/提问：记一笔，让图标亮红点
      const t = p.type || '';
      if (t === 'approval/requested' || t === 'approval/asked' || t === 'question/requested') {
        const sid = p.sessionId || (p.data && p.data.sessionId);
        const id = p.approvalId || p.questionId || (p.data && p.data.id);
        // 当前会话的卡由 state.cards 负责，这里只记别的会话的
        if (sid && id && sid !== state.sessionId) {
          state.foreign = state.foreign || new Map();
          state.foreign.set(id, sid);
          syncBadge();
        }
      } else if (t === 'approval/resolved' || t === 'approval/decided' || t === 'question/resolved') {
        const id = p.approvalId || p.questionId || (p.data && (p.data.id || p.data.approvalId));
        if (id && state.foreign && state.foreign.delete(id)) syncBadge();
      }
    },
  });
}

// ---------------------------------------------------------------- 启动

export { loadMessages, onFrame, openSession, refreshAll, subscribeDevice, subscribeSession };
