import { paint, paintSession, refreshAll } from '../core/bus.js';
import { state, ui } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { saveDraft } from '../core/format.js';
import { api } from '../core/api.js';
import { syncBadge } from '../core/badge.js';

function queueText(it) {
  const c = (it && it.message && it.message.content) || (it && it.content) || [];
  return c.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
}


async function queueAct(it, action, okMsg) {
  try {
    await api('/api/mobile/v1/session/queue/update', { method:'POST', body: {
      sessionId: state.sessionId, itemId: it.id, action,
    }});
    if (okMsg) toast(okMsg);
    if (action.kind === 'steer' || action.kind === 'remove') {
      state.queue = (state.queue || []).filter(x => x.id !== it.id);
    }
    paintSession();
    try { ui.loadStats?.(); } catch {}
  } catch (e) { toast('操作失败：' + (e.message || e)); }
}

/**
 * 编辑排队消息（原地改，不撤出队列）。
 *
 * 之前是「先从队列删掉 → 把原文放回输入框 → 让用户重发」：那条路会把这条消息里的
 * 图片/附件一起留在队列之外，等于丢附件（编辑完只回来文字）。宿主其实支持
 * `{kind:'edit', content:[{text}]}` —— 只换正文，附件块保持不动。
 * 所以现在把正文放回输入框，点「保存」走 edit；条目一直在队列里，
 * 万一这中间被取走发出了，保存会报错，不会静默丢。
 */

const queueState = { editing: null };

function startQueueEdit(it) {
  const ta = ui && ui.ta;
  if (!ta) return;
  queueState.editing = { id: it.id };
  ta.textContent = queueText(it);
  try { ui.syncInputButtons && ui.syncInputButtons(); } catch {}
  ta.focus();
  try {
    const r = document.createRange(); r.selectNodeContents(ta); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  } catch {}
  paintSession();
}


function cancelQueueEdit() {
  queueState.editing = null;
  const ta = ui && ui.ta;
  if (ta) { ta.textContent = ''; try { saveDraft(state.sessionId, ''); } catch {}; try { ui.syncInputButtons && ui.syncInputButtons(); } catch {} }
  paintSession();
}


async function saveQueueEdit() {
  const ta = ui && ui.ta;
  if (!ta || !queueState.editing) return;
  const text = (ta.innerText || '').replace(/\u00a0/g, ' ').trim();
  if (!text) { toast('内容不能为空'); return; }
  const id = queueState.editing.id;
  try {
    await api('/api/mobile/v1/session/queue/update', { method:'POST', body: {
      sessionId: state.sessionId, itemId: id, action: { kind:'edit', content: [{ type:'text', text }] },
    }});
    const it = (state.queue || []).find(x => x.id === id);
    if (it) it.content = [{ type:'text', text }];
    toast('已保存排队消息');
  } catch (e) {
    toast('这条可能已经发出去了：' + (e.message || e));
  }
  queueState.editing = null;
  ta.textContent = '';
  try { saveDraft(state.sessionId, ''); } catch {}
  try { ui.syncInputButtons && ui.syncInputButtons(); } catch {}
  paintSession();
}


const queueOpen = new Set();

function toggleQueueItem(id) {
  if (queueOpen.has(id)) queueOpen.delete(id);
  else queueOpen.add(id);
  paintSession();
}


function renderQueueItem(it) {
  const text = queueText(it);
  const open = queueOpen.has(it.id);
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 60) || '(空消息)';
  const item = el('div', { class:'qitem' + (open ? ' open' : '') });
  item.append(el('div', { class:'qhead', onclick: (e) => {
    if (e.target.closest('button')) return;
    toggleQueueItem(it.id);
  }},
    el('span', { class:'qtag', text:'排队中' }),
    el('span', { class:'qprev', text:preview }),
    el('span', { class:'qchev', text:open ? '▾' : '▸' }),
  ));
  if (open) {
    item.append(el('div', { class:'qacts' },
      el('button', { class:'qmini', text:'删除', onclick: () => queueAct(it, { kind:'remove' }, '已删除') }),
      el('button', { class:'qmini', text:'编辑', onclick: () => startQueueEdit(it) }),
      el('button', { class:'qmini primary', text:'立刻发送', onclick: () => queueAct(it, { kind:'steer' }, '已插话，马上处理') }),
    ));
    item.append(el('div', { class:'qtext', text }));
  }
  return item;
}


function dismissCard(c) {
  return new Promise((resolve) => {
    const node = c && c._node;
    if (!node || !node.isConnected) { resolve(); return; }
    const b = ui.body;
    if (b && b.scrollHeight - b.scrollTop - b.clientHeight < 120) ui.atBottom = true;
    const pin = () => { if (ui.body && ui.body.isConnected && ui.atBottom) ui.body.scrollTop = ui.body.scrollHeight; };
    const h = node.getBoundingClientRect().height;
    node.classList.add('closing');
    node.style.height = h + 'px';
    void node.offsetHeight;
    requestAnimationFrame(() => {
      node.style.height = '0px';
      node.style.opacity = '0';
      node.style.marginTop = '0px';
      node.style.marginBottom = '0px';
      node.style.paddingTop = '0px';
      node.style.paddingBottom = '0px';
      node.style.borderWidth = '0px';
    });
    pin();
    const timer = setInterval(pin, 30);
    setTimeout(() => { clearInterval(timer); resolve(); }, 200);
  });
}


function renderCard(c) {
  // 帧有两种形状：顶层字段（approval/requested）与全部包在 data 里（approval/asked），统一摊平
  const d = (c.data && c.data.data) ? { ...c.data, ...c.data.data } : (c.data || {});
  const card = el('div', { class:'card' });
  if (c.kind === 'approval') {
    card.append(el('div', { class:'ct', text:'工具请求确认' }));
    if (d.toolName) card.append(el('div', { class:'cmeta', text:`工具：${d.toolName}${d.classLabel ? ' · ' + d.classLabel : ''}` }));
    const line = d.reason || d.fact;
    if (line) card.append(el('div', { class:'cfact', text: line }));
    if (!d.toolName && !line && !d.command) {
      card.append(el('div', { class:'cmeta', text:'（这条审批没有附带说明，通常是历史记录的残留）' }));
    }
    if (d.command) card.append(el('pre', { text: d.command }));
    const acts = el('div', { class:'acts' },
      el('button', { class:'btn primary', onclick: () => respondApproval(d, 'allowed-once', c) }, '允许一次'));
    if (d.rememberable) {
      // 第三颗按钮上直接写清"对什么不再问"（Ovis 的做法），别让人猜"这一类"是哪一类
      acts.append(el('button', { class:'btn', style:'font-size:13px;line-height:1.25;padding:8px',
        onclick: () => respondApproval(d, 'allowed-class', c) },
        el('div', { text:'以后都允许' }),
        d.classLabel ? el('div', { style:'font-size:10.5px;color:var(--dim);font-weight:400;margin-top:2px;'
          + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: d.classLabel }) : null));
    }
    acts.append(el('button', { class:'btn no', onclick: () => respondApproval(d, 'rejected', c) }, '拒绝'));
    card.append(acts);
    return card;
  }
  card.append(el('div', { class:'ct', text:'需要你回答' }));
  const qs = d.questions || [];
  // 选中状态挂在卡片对象上，而不是渲染闭包里：即便节点被重建，勾选也不会丢
  const picks = c._picks || (c._picks = new Map(qs.map(q => [q.id, new Set()])));
  for (const q of qs) {
    const block = el('div', { class:'qblock' });
    if (q.header) block.append(el('div', { class:'cmeta', text: q.header }));
    block.append(el('div', { class:'cfact', style:'font-weight:600', text: q.question || q.id }));
    if (q.detail) block.append(el('div', { class:'cmeta', text: q.detail }));
    const labelOf = o => typeof o === 'string' ? o : (o.label ?? o.value ?? '');
    const set = picks.get(q.id) || new Set();
    picks.set(q.id, set);
    const btns = [];
    for (const o of (q.options || [])) {
      const l = labelOf(o);
      const btn = el('button', { class:'opt' + (set.has(l) ? ' sel' : '') },
        el('div', { text: l }),
        (o && o.description) ? el('small', { text: o.description }) : null);
      btn.addEventListener('click', () => {
        if (q.multiSelect) { set.has(l) ? set.delete(l) : set.add(l); }
        else { set.clear(); set.add(l); }
        for (const b of btns) b.classList.toggle('sel', set.has(b.__label));
      });
      btn.__label = l;
      btns.push(btn);
      block.append(btn);
    }
    card.append(block);
  }
  card.append(el('div', { class:'acts' }, el('button', { class:'btn primary', onclick: async () => {
    // 宿主侧「每题恰好一条答案」，空 selected 会被当成"没选"直接跳过；
    // 这里先挡一道，避免一次误提交把整组问题都 skip 掉
    const missing = qs.filter(q => !(picks.get(q.id) && picks.get(q.id).size));
    if (missing.length) { toast(`还有 ${missing.length} 个问题没选`); return; }
    try {
      await api('/api/mobile/v1/question/respond', { method:'POST', body: {
        rpcId: d.rpcId, sessionId: d.sessionId || state.sessionId,
        answer: { answers: [...picks].map(([id, set]) => ({ id, selected: [...set] })) },
      }});
      await dismissCard(c);
      state.cards = state.cards.filter(x => x !== c); paint();
      // 角标把「挂着的卡」算进待处理数：答完要立刻重算，并拉一次 fresh 列表
      // 让 pendingInteraction 同步掉（/sessions 有 30 秒缓存）
      syncBadge();
      void refreshAll(true);
    } catch (e) { toast('提交失败：' + String(e.message || e)); }
  }}, '提交')));
  return card;
}


async function respondApproval(d, outcome, c) {
  try {
    await api('/api/mobile/v1/approval/respond', { method:'POST', body: {
      rpcId: d.rpcId || (c && c.data && c.data.rpcId),
      sessionId: d.sessionId || state.sessionId,
      approvalId: d.approvalId || d.id || (c && c.data && (c.data.approvalId || (c.data.data && c.data.data.id))),
      outcome,
    }});
    await dismissCard(c);
    state.cards = state.cards.filter(x => x !== c); paint();
    // 同提问卡：答完立刻重算角标，并 fresh 一次让 pendingInteraction 跟上
    syncBadge();
    void refreshAll(true);
  } catch (e) { toast(String(e.message || e)); }
}

// 恢复链接：把当前凭据打包成一条 URL，存到备忘录里，以后重装点一下就登录

function pushCard(kind, frame) {
  const f = frame || {};
  const inner = f.data || {};
  // 同一条审批会有 approval/requested（两次文案）+ approval/asked（字段在 data 里）三种帧，
  // 必须认到同一个 id，否则会叠出好几张一样的卡
  const id = f.approvalId || f.questionId || inner.id || inner.approvalId
    || f.rpcId || JSON.stringify(f).slice(0, 80);
  if (state.cards.some(c => c.id === id)) return;
  state.cards.push({ kind, data: frame, id, at: Date.now() });
  if (state.cards.length > 8) state.cards = state.cards.slice(-8);
}

function pruneCards() {
  const now = Date.now();
  const before = state.cards.length;
  state.cards = state.cards.filter(c => !c.at || now - c.at < 5 * 60 * 1000);
  // 过期的卡不再算「待处理」，角标跟着掉
  if (state.cards.length !== before) syncBadge();
}


export { cancelQueueEdit, pruneCards, pushCard, queueOpen, queueState, renderCard, renderQueueItem, saveQueueEdit };
