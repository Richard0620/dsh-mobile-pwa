import { paint, render, repaintSessionKeepingScroll } from '../core/bus.js';
import { state, ui } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { mdToHtml } from '../core/markdown.js';
import { api } from '../core/api.js';
import { fmtElapsed } from './steps.js';

const SUB_META = {
  running: { cls:'run', dot:'run', label:'跑中' },
  pending: { cls:'wait', dot:'pending', label:'待批' },
  completed: { cls:'done', dot:'done', label:'完成' },
  failed: { cls:'fail', dot:'failed', label:'失败' },
};


let subagentSheet = null;

let subagentSheetTimer = null;

/** 秒 / 毫秒 / ISO 字符串统一成毫秒时间戳；不认识就是 0。 */

function subagentMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * 状态映射：新宿主给 status（running / pending / approval / completed / failed / stopped），
 * 老宿主只给 activity（running / inactive）。activity=inactive 只能说明「不在跑」，
 * 但目录里没有失败证据时按完成画，避免把每个结束的子代理都标红。
 */

function subagentStatusOf(raw) {
  const s = String((raw && (raw.status || raw.state)) || '').toLowerCase();
  if (s === 'running' || s === 'in_progress' || s === 'working' || s === 'busy') return 'running';
  if (s === 'pending' || s === 'approval' || s === 'waiting' || s === 'awaiting_approval') return 'pending';
  if (s === 'completed' || s === 'done' || s === 'finished' || s === 'success') return 'completed';
  if (s === 'failed' || s === 'stopped' || s === 'error' || s === 'aborted') return 'failed';
  const activity = String((raw && raw.activity) || '').toLowerCase();
  if (activity === 'running') return 'running';
  if (raw && raw.pendingInteraction === true) return 'pending';
  return 'completed';
}

/** 一条目录条目 → 手机认的形状；没有 id 的坏条目丢掉。字段缺就少显示，不猜。 */

function normalizeSubagent(raw, parentSessionId) {
  if (!raw || typeof raw !== 'object') return null;
  const sessionId = String(raw.sessionId || raw.childSessionId || raw.id || '').trim();
  if (!sessionId) return null;
  const title = String(raw.title || raw.label || raw.name || raw.description || '').trim()
    || `子代理 ${sessionId.slice(-6)}`;
  const desc = String(raw.description || raw.summary || '').trim();
  return {
    sessionId,
    parentSessionId: String(raw.parentSessionId || raw.parentId || parentSessionId || '').trim(),
    title,
    desc: desc === title ? '' : desc,
    mode: String(raw.mode || 'unknown'),
    status: subagentStatusOf(raw),
    startedAt: subagentMs(raw.startedAt || raw.createdAt),
    lastActivityAt: subagentMs(raw.lastActivityAt || raw.updatedAt),
  };
}


function subagentCounts() {
  const out = { running:0, pending:0, completed:0, failed:0 };
  for (const entry of state.subagents) out[entry.status] = (out[entry.status] || 0) + 1;
  return out;
}

/** 入口条作为一个 feed item：key 带上 id + 状态，只有目录真的变了才重画。 */

function subagentBarItem() {
  if (state.view !== 'session' || !state.subagents.length) return null;
  const key = 'SUB:' + state.subagents.map(e => `${e.sessionId}:${e.status}`).join('|')
    + ':' + (state.subagentsParentAvailable ? 1 : 0);
  return { type:'subbar', key };
}


function renderSubagentBar() {
  const counts = subagentCounts();
  const allDone = counts.running === 0 && counts.pending === 0 && counts.failed === 0;
  const bar = el('button', { class:'subbar' + (allDone ? ' done' : ''), type:'button', onclick: () => openSubagentsSheet() },
    el('span', { class:'ar', text:'⤷' }),
    el('b', { text:`${state.subagents.length} 个子代理` }));
  if (allDone) bar.append(el('span', { class:'all', text:'全部完成' }));
  else {
    if (counts.running) bar.append(el('span', { class:'cnt run' }, el('i'), `${counts.running} 跑中`));
    if (counts.pending) bar.append(el('span', { class:'cnt wait' }, el('i'), `${counts.pending} 待批`));
    if (counts.failed) bar.append(el('span', { class:'cnt fail' }, el('i'), `${counts.failed} 失败`));
  }
  bar.append(el('span', { class:'cv', text:'›' }));
  return bar;
}

/**
 * 拉这个会话的子代理目录。
 *
 * 30 秒缓存由调用方共享（轮询、turn/end、设置面板都会来），跑中状态靠 force 覆盖。
 * 404 / 空目录都只当「没有子代理」：入口条不出现，不是一次错误。
 */

async function loadSubagents(sid, { force = false } = {}) {
  if (!sid || state.sessionId !== sid) return;
  if (!force && state.subagentsFor === sid && Date.now() - state.subagentsAt < 30000) return;
  if (state.subagentsLoading) return;
  state.subagentsLoading = true;
  try {
    const r = await api(`/api/mobile/v1/subagents?sessionId=${encodeURIComponent(sid)}`);
    if (state.sessionId !== sid) return;
    const list = (Array.isArray(r && r.entries) ? r.entries : [])
      .map(entry => normalizeSubagent(entry, sid)).filter(Boolean);
    const parentAvailable = !(r && r.parentAvailable === false);
    const sigOf = (items, parent) => JSON.stringify([parent, items.map(e => [e.sessionId, e.status, e.title, e.mode])]);
    const before = sigOf(state.subagents, state.subagentsParentAvailable);
    state.subagents = list;
    state.subagentsParentAvailable = parentAvailable;
    state.subagentsFor = sid;
    // 只读视图自己也在轮询目录：状态变了要跟着更新状态条，但不重建整页
    if (state.subagent) {
      const fresh = list.find(entry => entry.sessionId === state.subagent.sessionId);
      if (fresh && (fresh.status !== state.subagent.status || fresh.lastActivityAt !== state.subagent.lastActivityAt)) {
        state.subagent = fresh;
        if (state.view === 'subagent') paintSubagentView();
      }
    }
    if (sigOf(list, parentAvailable) !== before) {
      repaintSessionKeepingScroll();
      if (subagentSheet) subagentSheet.paint();
    }
  } catch {
    // 老宿主 404 / 目录读取失败：按「没有入口」处理，不打扰用户
    if (state.sessionId !== sid) return;
    state.subagents = [];
    state.subagentsParentAvailable = true;
    state.subagentsFor = sid;
    if (state.view === 'session') repaintSessionKeepingScroll();
    if (subagentSheet) subagentSheet.paint();
  } finally {
    state.subagentsLoading = false;
    if (state.subagentsFor === sid) state.subagentsAt = Date.now();
  }
}


function subagentDuration(entry) {
  if (!entry.startedAt) return '';
  const end = entry.status === 'running' || entry.status === 'pending'
    ? Date.now() : (entry.lastActivityAt || Date.now());
  return fmtElapsed(Math.max(0, end - entry.startedAt));
}


function subagentSubtitle(entry) {
  const parts = [];
  const idle = entry.lastActivityAt ? Date.now() - entry.lastActivityAt : 0;
  if (entry.status === 'running') {
    parts.push(entry.desc || '正在跑');
    if (idle >= 120000) parts.push(`${Math.floor(idle / 60000)} 分钟无输出`);
    else if (!entry.desc && idle > 0) parts.push(`最近活动 ${fmtElapsed(idle)} 前`);
  } else if (entry.status === 'pending') {
    parts.push(entry.desc || '等你批准');
  } else if (entry.status === 'completed') {
    parts.push(entry.desc || '已完成');
  } else {
    parts.push(entry.desc || '失败或已停止');
  }
  if (!entry.desc) {
    if (entry.mode === 'one-shot') parts.push('一次性');
    else if (entry.mode === 'continuable') parts.push('可继续');
  }
  return parts.join(' · ');
}


function renderSubagentRow(entry) {
  const meta = SUB_META[entry.status];
  const row = el('div', { class:'sli', role:'button', tabindex:'0',
    onclick: () => openSubagentView(entry) },
    el('span', { class:`dot ${meta.dot}` }),
    el('div', { class:'txt' },
      el('b', { text: entry.title }),
      el('span', { text: subagentSubtitle(entry) })));
  const right = el('div', { class:'right' },
    el('span', { class:`stt ${meta.cls}`, text: meta.label }));
  const tm = subagentDuration(entry);
  if (tm) right.append(el('span', { class:'tm', text: tm }));
  if (entry.status === 'running' || entry.status === 'pending') {
    right.append(el('button', { class:'ib', type:'button', title:'打断', 'aria-label':`打断 ${entry.title}`,
      text:'■', onclick: (ev) => { ev.stopPropagation(); interruptSubagent(entry); } }));
  }
  row.append(right);
  row.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openSubagentView(entry); }
  });
  return row;
}

/** 列表 sheet：只读目录 + 行内打断；点一行进只读视图（sheet 关掉，返回时再打开）。 */

function openSubagentsSheet() {
  if (!state.subagents.length) return;
  closeSubagentSheet();
  const mask = el('div', { class:'mask' });
  const sheet = el('div', { class:'sheet subsheet', role:'dialog', 'aria-modal':'true', tabindex:'-1' });
  sheet.append(el('div', { class:'grab' }));
  const head = el('div', { class:'shead2' });
  const listEl = el('div', { class:'sheetlist' });
  const foot = el('div', { class:'sfoot' });
  sheet.append(head, listEl, foot);
  function paint() {
    head.replaceChildren(
      el('h2', { text:'子代理' }),
      el('span', { class:'sm', text:`本次派发 · ${state.subagents.length} 个` }),
      el('button', { class:'x', type:'button', 'aria-label':'关闭', text:'✕', onclick: closeSubagentSheet }));
    listEl.replaceChildren(...state.subagents.map(renderSubagentRow));
    foot.replaceChildren(document.createTextNode('点一条看只读消息。跑中/待批可以直接打断（沿用现有 confirm()），审批要回主会话处理。'));
    if (!state.subagentsParentAvailable) {
      foot.append(el('div', { class:'childnote warn', style:'margin:8px 0 0',
        text:'主会话已删除：列表与打断还能用，消息可能读不全。' }));
    }
  }
  paint();
  mask.append(sheet);
  mask.addEventListener('click', (e) => { if (e.target === mask) closeSubagentSheet(); });
  document.body.append(mask);
  subagentSheet = { mask, paint };
  requestAnimationFrame(() => { try { sheet.focus({ preventScroll:true }); } catch {} });
  // 打开时强制刷一次，之后每 8 秒跟一次（关闭即停），状态不会停在打开那一刻
  loadSubagents(state.sessionId, { force:true });
  clearInterval(subagentSheetTimer);
  subagentSheetTimer = setInterval(() => {
    if (document.hidden || !subagentSheet) return;
    loadSubagents(state.sessionId, { force:true });
  }, 8000);
}


function closeSubagentSheet() {
  clearInterval(subagentSheetTimer);
  subagentSheetTimer = null;
  if (subagentSheet && subagentSheet.mask) subagentSheet.mask.remove();
  subagentSheet = null;
}

/** 打断：只有跑中/待批会走到这里；body 同时带新旧宿主认的两种字段名。 */

async function interruptSubagent(entry) {
  const ok = confirm(`打断「${entry.title}」？\n这一轮会停下，已完成的步骤不会回滚。`);
  if (!ok) return;
  try {
    await api('/api/mobile/v1/subagents/interrupt', { method:'POST', body: {
      sessionId: entry.sessionId,
      childSessionId: entry.sessionId,
      parentSessionId: entry.parentSessionId || state.sessionId,
    }});
    toast('已打断');
    await loadSubagents(state.sessionId, { force:true });
    if (state.subagent && state.subagent.sessionId === entry.sessionId) {
      const fresh = state.subagents.find(item => item.sessionId === entry.sessionId);
      if (fresh) state.subagent = fresh;
      if (state.view === 'subagent') paintSubagentView();
    }
  } catch (e) {
    toast('打断失败：' + String((e && e.message) || e));
  }
}

/** 只读视图：先切页（hero + 状态条 + 骨架立刻在），消息回来再填。 */

function openSubagentView(entry) {
  // 先快照父会话位置（在任何重画/关面板之前）：关 sheet、目录刷新都会触发重画，
  // 顺序一旦反了，这里记到的就是"已经被弹到底部"的位置。
  const body = ui && ui.body;
  state.sessionRestore = body && state.sessionId
    ? {
        sessionId: state.sessionId,
        top: body.scrollTop,
        atBottom: body.scrollHeight - body.scrollTop - body.clientHeight < 90,
      }
    : null;
  state.subagentSheetReturn = !!subagentSheet;
  if (subagentSheet) closeSubagentSheet();
  state.subagent = entry;
  state.subagentMessages = [];
  state.subagentMsgSig = '';
  state.subagentError = '';
  state.subagentLoading = true;
  state.view = 'subagent';
  render();
  loadSubagentMessages();
}


function goBackFromSubagent() {
  const wantSheet = !!state.subagentSheetReturn;
  state.subagentSheetReturn = false;
  clearInterval(state.subagentPoll);
  state.subagentPoll = null;
  state.subagent = null;
  state.subagentMessages = [];
  state.subagentError = '';
  state.view = 'session';
  // 滚动恢复交给 renderSession 挂载后的首次绘制（见 finishInitialPaint），
  // 这里只切页，不要另起 rAF 与首次绘制抢顺序。
  render();
  if (wantSheet) setTimeout(openSubagentsSheet, 0);
}

/** 只读视图的局部重绘：轮询来了新消息不把用户正在看的位置拉回顶部。 */

function paintSubagentView() {
  if (state.view !== 'subagent') return;
  const current = document.querySelector('.roview');
  const top = current ? current.scrollTop : 0;
  const atBottom = current ? current.scrollHeight - current.scrollTop - current.clientHeight < 60 : false;
  render();
  requestAnimationFrame(() => {
    const next = document.querySelector('.roview');
    if (!next) return;
    next.scrollTop = atBottom ? next.scrollHeight : top;
  });
}

/** 子会话消息：必须带 parentSessionId + mode 才是 durable address，缺一就读不到。 */

async function loadSubagentMessages({ silent = false } = {}) {
  const entry = state.subagent;
  if (!entry) return;
  const parent = entry.parentSessionId || state.sessionId;
  if (!silent && !state.subagentMessages.length) state.subagentLoading = true;
  try {
    if (!parent) throw new Error('宿主没返回父会话定位（parentSessionId）');
    if (entry.mode !== 'one-shot' && entry.mode !== 'continuable') {
      throw new Error('这个子代理没有可读的消息模式（mode）');
    }
    const r = await api(`/api/mobile/v1/session/messages?sessionId=${encodeURIComponent(entry.sessionId)}`
      + `&parentSessionId=${encodeURIComponent(parent)}&mode=${encodeURIComponent(entry.mode)}`);
    if (!state.subagent || state.subagent.sessionId !== entry.sessionId) return;
    const items = Array.isArray(r && r.items) ? r.items : [];
    const sig = items.map(m => String((m && m.id) || '')).join('|') + ':' + items.length;
    const changed = sig !== state.subagentMsgSig;
    state.subagentError = '';
    if (changed) {
      state.subagentMessages = items;
      state.subagentMsgSig = sig;
    }
    state.subagentLoading = false;
    if ((changed || !silent) && state.view === 'subagent') paintSubagentView();
  } catch (e) {
    if (!state.subagent || state.subagent.sessionId !== entry.sessionId) return;
    state.subagentLoading = false;
    const msg = String((e && e.message) || e);
    if (msg !== state.subagentError) {
      state.subagentError = msg;
      if (state.view === 'subagent') paintSubagentView();
    }
  } finally {
    state.subagentLoading = false;
    startSubagentPoll();
  }
}

/** 跑中/待批的只读页每 6 秒补一次消息与状态，停下就自动停表。 */

function startSubagentPoll() {
  clearInterval(state.subagentPoll);
  state.subagentPoll = null;
  const entry = state.subagent;
  if (!entry || (entry.status !== 'running' && entry.status !== 'pending')) return;
  state.subagentPoll = setInterval(() => {
    if (state.view !== 'subagent' || document.hidden) return;
    loadSubagents(state.sessionId, { force:true });
    loadSubagentMessages({ silent:true });
  }, 6000);
}


function renderChildMessage(m) {
  const blocks = (m && m.blocks) || [];
  const text = (m && m.text && m.text.trim())
    ? m.text
    : blocks.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
  const calls = blocks.filter(b => b.type === 'tool-call' || b.type === 'tool-result');
  const wrap = el('div');
  if (calls.length) {
    wrap.append(el('div', { class:'childtools' }, ...calls.map((t) => {
      const label = t.type === 'tool-result' ? '↩ 结果' : `⚙ ${t.name || '工具'}`;
      return el('div', { class:'childtool' },
        el('span', { class:'d' }),
        el('span', { class:'t', text: label }),
        t.summary ? el('span', { class:'tm2', text: String(t.summary).slice(0, 28) }) : null);
    })));
  }
  if (!text) return wrap;
  if (m.role === 'user') {
    wrap.append(el('div', { class:'msg user' }, el('div', { class:'bubble', text })));
    return wrap;
  }
  wrap.append(el('div', { class:'msg' }, el('div', { class:'md', html: mdToHtml(text) })));
  return wrap;
}


export { SUB_META, goBackFromSubagent, interruptSubagent, loadSubagentMessages, loadSubagents, renderChildMessage, renderSubagentBar, subagentBarItem, subagentDuration };
