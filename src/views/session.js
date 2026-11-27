import { render } from '../core/bus.js';
import { resetUi, state, ui, uuid } from '../core/state.js';
import { copyText, decorateCodeCopies, el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { dayKeyOf, fmtDayLabel, fmtExactTime, fmtMsgTime, fmtTok, getDrafts, isVideoFile, isVideoName, saveDraft } from '../core/format.js';
import { mdToHtml } from '../core/markdown.js';
import { api } from '../core/api.js';
import { markSessionSeen } from '../core/badge.js';
import { openSheet, sheetIconSVG } from '../components/sheet.js';
import { NAV_ICONS, headerEl, openInfoBox } from '../components/chrome.js';
import { hydrateImages, openImageFull } from '../components/image-viewer.js';
import { openFileDrawer } from '../components/file-drawer.js';
import { hydrateAttachments, openFileCard, splitAttachmentNotes, uploadFile } from '../features/media.js';
import { cancelVoiceInput, speakBtnHtml, speakText, speechHoldOn, speechRecogCtor, stopSpeak, voiceState } from '../features/voice.js';
import { markBusy, paintProg, stopRun, syncBusyTicker } from '../features/steps.js';
import { renderStopCard, revealStopCard, stopSummaryItem } from '../features/stop-summary.js';
import { renderSubagentBar, subagentBarItem } from '../features/subagents.js';
import { cancelQueueEdit, pruneCards, queueOpen, queueState, renderCard, renderQueueItem, saveQueueEdit } from '../features/queue-cards.js';
import { ensureCommands, forkSessionAt, openModelPicker, openRecovery, reloadApp, workspaceOf } from '../features/session-actions.js';
import { loadMessages, refreshAll } from '../features/sync.js';

function repaintSessionKeepingScroll() {
  if (state.view !== 'session' || !ui || !ui.body) return;
  const keep = !ui.atBottom;
  const y = ui.body.scrollTop;
  paintSession(keep ? { scroll:'none' } : undefined);
  if (keep && ui.body) { try { ui.body.scrollTop = y; } catch {} }
}


function paintSession({ scroll = 'auto' } = {}) {
  if (!ui.body || !ui.body.isConnected) return;
  state.lastPaint = Date.now();
  const atBottom = (state.stopSummary && state.stopSummary.expanded)
    ? false
    : (ui.body.scrollHeight - ui.body.scrollTop - ui.body.clientHeight < 90);
  ui.atBottom = atBottom;
  // 长会话只渲染最近 N 条，避免几百条 DOM 一起卡（点"显示更早"再加）
  const limit = state.msgLimit || 120;
  const hidden = Math.max(0, state.messages.length - limit);
  const shown = hidden ? state.messages.slice(-limit) : state.messages;
  const feed = (() => {
    const keep = state.messages;
    state.messages = shown;
    const f = buildFeed();
    state.messages = keep;
    return f;
  })();
  // 不在底部时来了新消息 → 累计"未读数"，给悬浮按钮用
  if (ui.prevCount !== undefined && feed.length > ui.prevCount && !atBottom) {
    state.unseen = (state.unseen || 0) + (feed.length - ui.prevCount);
  }
  ui.prevCount = feed.length;
  if (ui.stopBtn) ui.stopBtn.style.display = state.busy ? 'grid' : 'none';
  if (ui.updateJump) ui.updateJump();
  // ---- 增量渲染：只改动变化的那几条，避免整列表重建导致抖动 / 图片重新取回 ----
  const items = [];
  let lastDay = '';
  for (const it of feed) {
    if (it.kind === 'tools') {
      const k = toolGroupKey(it.tools);
      items.push({ type:'tools', key:`T:${k}:${it.tools.length}:${openTools.has(k) ? 1 : 0}`, tools: it.tools });
      continue;
    }
    const ts = it.m && it.m.time;
    const day = ts ? dayKeyOf(ts) : '';
    if (day && day !== lastDay) {
      const label = fmtDayLabel(ts);
      // key 带上 label：App 跨过午夜还开着时，「今天」要能变成「昨天」
      items.push({ type:'sep', key:`S:${day}:${label}`, text: label, ts });
      lastDay = day;
    }
    const txt = (it.m && it.m.text) || '';
    const nb = (it.m && it.m.blocks && it.m.blocks.length) || 0;
    items.push({ type:'msg', key:`M:${it.m.id}:${txt.length}:${nb}`, m: it.m });
  }
  // F3：入口条接在「派发的那一轮」末尾（= 最后一条助手消息之后），同一轮派几个都只一条。
  // 只有目录数据变化时 key 才会变，paintSession 每帧跑也不会重建它。
  const subItem = subagentBarItem();
  if (subItem) {
    let at = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'msg' && items[i].m && items[i].m.role !== 'user') { at = i; break; }
    }
    if (at >= 0) items.splice(at + 1, 0, subItem); else items.push(subItem);
  }
  // F4：被停止那一轮的交代卡挂在本轮末尾；默认折叠成一行。
  const stopItem = stopSummaryItem();
  if (stopItem) items.push(stopItem);
  ui.keys = ui.keys || [];
  ui.nodes = ui.nodes || [];
  let keep = 0;
  while (keep < ui.keys.length && keep < items.length && ui.keys[keep] === items[keep].key) keep++;
  for (let i = ui.nodes.length - 1; i >= keep; i--) {
    const n = ui.nodes[i];
    if (n && n.remove) n.remove();
  }
  ui.keys.length = keep;
  ui.nodes.length = keep;
  for (let i = keep; i < items.length; i++) {
    const it = items[i];
    const node = it.type === 'sep' ? el('div', { class:'sep', text: it.text, title: it.ts ? fmtExactTime(it.ts) : '' })
      : it.type === 'tools' ? renderTools(it.tools)
      : it.type === 'subbar' ? renderSubagentBar(it)
      : it.type === 'stop' ? renderStopCard(it)
      : renderMessage(it.m);
    // 手机上没地方悬停：点一下分隔条把精确时间 toast 出来
    if (it.type === 'sep' && it.ts) node.addEventListener('click', () => toast(fmtExactTime(it.ts)));
    // 消息只进对话流；排队卡片固定在 dock（输入框上方），不再插进消息里
    ui.listWrap.append(node);
    ui.nodes.push(node);
    ui.keys.push(it.key);
  }
  // 「显示更早」按钮单独维护，不参与增量索引
  if (!ui.hiddenBtn) {
    ui.hiddenBtn = el('button', { class:'btn', style:'margin:6px 0 10px;font-size:13px',
      onclick: () => { state.msgLimit = (state.msgLimit || 120) + 120; paintSession(); } });
  }
  if (hidden) {
    ui.hiddenBtn.textContent = `↑ 显示更早（还有 ${hidden} 条）`;
    ui.hiddenBtn.style.display = '';
    if (ui.listWrap.firstChild !== ui.hiddenBtn) ui.listWrap.prepend(ui.hiddenBtn);
  } else {
    ui.hiddenBtn.style.display = 'none';
  }
  if (!items.length) {
    if (!ui.emptyNode) {
      ui.emptyNode = el('div', { class:'empty', text:'还没有消息' });
      ui.listWrap.append(ui.emptyNode);
    }
  } else if (ui.emptyNode) { ui.emptyNode.remove(); ui.emptyNode = null; }
  if (keep < items.length) {
    hydrateImages(ui.listWrap);
    hydrateAttachments(ui.listWrap);
  }
  pruneCards();
  // 卡片必须增量渲染：以前每次 paint 都 replaceChildren + 重建，
  // 流式期间每秒有几十次 paint，用户正在点的选项会被换掉 ——
  // 表现就是"多问题时选项失效、而且失效得很快"。这里按卡片缓存节点。
  const cardKey = state.cards.map(c => c.id).join('|');
  if (cardKey !== ui.cardsKey) {
    ui.cardsKey = cardKey;
    ui.cardsWrap.replaceChildren();
    for (const c of state.cards) {
      // 节点还在就复用（已选中的选项、展开状态都保留），否则重建一次
      if (!c._node || !c._node.isConnected) c._node = renderCard(c);
      ui.cardsWrap.append(c._node);
    }
  }
  // 排队中的消息：固定在输入框上方的 dock 里，默认折叠；不再插进消息流
  if (ui.qDock) {
    const q = state.queue || [];
    if (q.length) {
      ui.qDock.style.display = 'flex';
      ui.qDock.replaceChildren();
      for (const it of q) ui.qDock.append(renderQueueItem(it));
      for (const id of [...queueOpen]) if (!q.some(x => x.id === id)) queueOpen.delete(id);
    } else {
      ui.qDock.style.display = 'none';
      ui.qDock.replaceChildren();
    }
  }
  // 编辑排队消息时的提示条
  if (ui.editBar) {
    const editing = queueState.editing && (state.queue || []).some(x => x.id === queueState.editing.id);
    if (!editing) { if (queueState.editing) queueState.editing = null; ui.editBar.style.display = 'none'; ui.editBar.replaceChildren(); }
    else if (!ui.editBar.childElementCount) {
      ui.editBar.style.display = 'flex';
      ui.editBar.replaceChildren(
        el('span', { style:'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
          text:'正在编辑排队消息 · 附件会保留' }),
        el('button', { class:'qmini', text:'取消', onclick: cancelQueueEdit }),
        el('button', { class:'qmini', text:'保存', onclick: saveQueueEdit }));
    }
  }
  if (ui.syncSendState) ui.syncSendState();
  else if (ui.sendBtn) ui.sendBtn.disabled = !!state.sending || (state.pending || []).some(a => a.uploading) || !!queueState.editing;
  // 运行状态只保留 dock 里这一条（F1：步数 / 进度条 / 完成提示都在 paintProg 里）
  paintProg();
  syncBusyTicker();
  // scroll:'none' 给「返回父会话、要恢复原位置」用：别在这里自动贴底
  if (scroll === 'bottom' || (scroll !== 'none' && atBottom)) {
    ui.atBottom = true;
    requestAnimationFrame(() => {
      if (!ui.body || !ui.body.isConnected) return;
      ui.body.scrollTop = ui.body.scrollHeight;
    });
  }
  // 展开/收起交代卡后把卡片顶部带进视野（否则整卡比一屏高时只看到中段）
  if (state.stopScrollTop) {
    state.stopScrollTop = false;
    requestAnimationFrame(revealStopCard);
    setTimeout(revealStopCard, 90);
  }
}


function paint() {
  if (state.view === 'session' && ui.sessionId === state.sessionId && ui.body && ui.body.isConnected) paintSession();
  else render();
}


function renderSession(wrap) {
  if (state.rec) cancelVoiceInput();
  const back = el('button', { class:'ico', text:'‹', title:'返回会话列表', onclick: () => {
    try { state.live && state.live.close(); } catch {}
    clearInterval(state.poll);
    state.view = 'list'; ui.sessionId = null; render(); refreshAll();
  }});
  const dot = el('span', {
    class: state.stream === 'open' ? 'dot run' : 'dot',
    title: state.stream === 'open' ? '实时已连接' : '连接中…',
  });
  const more = el('button', { class:'ico', text:'⋯', onclick: () => openSheet([
    { label:'刷新消息', icon:'⟳', run: () => loadMessages(true) },
    { label:'文件', icon:'📁', run: () => openFileDrawer(state.sessionCwd || '') },
    { label:'重新加载', icon:'↻', run: reloadApp },
    { label:'恢复链接', icon:'🔗', run: openRecovery },
    { label:'回到列表', icon:'‹', run: () => { state.live?.close(); clearInterval(state.poll); state.view='list'; ui.sessionId=null; render(); refreshAll(); } },
  ]) });
  wrap.append(headerEl(el('span', { class:'httl' }, dot, el('span', { class:'httltext', text: state.sessionTitle })), back, more));
  const metabar = el('div', { class:'metabar' });

  // 标题下的会话用量（数据来自 /session/stats 的 sessionStats）
  function paintMeta() {
    if (!metabar) return;
    const s = state.sessStats;
    const c = state.ctxInfo || {};
    metabar.replaceChildren();
    if (!s) { metabar.append(el('span', { text:'用量加载中…' })); return; }
    const tps = s.decodeMs > 0 ? Math.round(s.decodeTokens / (s.decodeMs / 1000)) : 0;
    const ttft = (s.ttftSteps && s.ttftMs) ? (s.ttftMs / s.ttftSteps / 1000) : 0;
    const parts = [];
    if (c.used && c.window) {
      const pct = Math.round((c.used / c.window) * 100);
      const tone = pct >= 85 ? 'var(--bad)' : pct >= 65 ? 'var(--warn)' : 'var(--fg)';
      parts.push(el('span', { style:`font-weight:600;color:${tone}`,
        text:`上下文 ${pct}%` }));
      parts.push(el('span', { text:`${fmtTok(c.used)}/${fmtTok(c.window)}` }));
    }
    if (tps) parts.push(el('span', { text: `${tps} tok/s` }));
    if (ttft) parts.push(el('span', { text: `首字 ${ttft.toFixed(1)}s` }));
    parts.push(el('span', { text: `${s.turns || 0} 轮 · ${s.steps || 0} 步` }));
    for (const p of parts) metabar.append(p);
  }
  async function loadSessionStats() {
    try {
      const r = await api('/api/mobile/v1/session/stats?sessionId=' + encodeURIComponent(state.sessionId));
      const p = r.projections || {};
      state.sessStats = p.sessionStats || null;
      const cp = p.contextPressure || null;
      const ct = p.contextTimeline || null;
      const perm = p.permissions;
      state.permCurrent = perm && typeof perm.currentValue === 'string' ? perm.currentValue : '';
      paintPerm();
      // 首次进入/断线重连时，排队条也要从投影里补一次
      const inbox = p.inbox;
      if (inbox) {
        const rows = [].concat(inbox['next-turn'] || []);
        state.queue = rows.filter(r => r && r.id).map(r => ({ id: r.id, placement:'queued',
          message: { id: r.id, content: r.content } }));
        paintSession();
      }
      state.ctxInfo = {
        used: (cp && cp.pressureTokens) || null,
        window: (cp && cp.contextWindow) || (ct && ct.contextWindow) || null,
        maxOutput: (ct && ct.maxOutputTokens) || null,
        breakdown: (ct && ct.current) || null,
      };
    } catch { state.sessStats = null; state.ctxInfo = null; }
    paintMeta();
  }
  paintMeta();
  loadSessionStats();
  // 点用量条看上下文构成
  metabar.addEventListener('click', () => {
    const c = state.ctxInfo;
    if (!c || !c.breakdown) { toast('还没有上下文数据'); return; }
    const b = c.breakdown;
    const rows = [
      ['上下文占用', c.window ? `${Math.round((c.used / c.window) * 100)}%  (${fmtTok(c.used)} / ${fmtTok(c.window)})` : '-'],
      ['系统提示', fmtTok(b.system || 0)],
      ['工具定义', fmtTok(b.tools || 0)],
      ['用户消息', fmtTok(b.user || 0)],
      ['注入内容', fmtTok(b.inject || 0)],
      ['技能', fmtTok(b.skill || 0)],
      ['助手输出', fmtTok(b.assistant || 0)],
      ['其中思考', fmtTok(b.assistantReasoning || 0)],
      ['最大输出', c.maxOutput ? fmtTok(c.maxOutput) : '-'],
    ];
    openInfoBox('上下文构成', rows);
  });

  const body = el('main');
  const listWrap = el('div');
  const cardsWrap = el('div');
  body.append(listWrap, cardsWrap);
  // 会话页没有下拉刷新：滚到顶部时自动多渲染一批历史，不把页面拉回列表
  let expandingHistory = false;
  body.addEventListener('scroll', () => {
    if (expandingHistory || body.scrollTop > 24) return;
    const total = state.messages.length;
    const limit = state.msgLimit || 120;
    if (total <= limit) return;
    expandingHistory = true;
    const prevH = body.scrollHeight, prevTop = body.scrollTop;
    state.msgLimit = limit + 120;
    paintSession();
    body.scrollTop = body.scrollHeight - prevH + prevTop;
    expandingHistory = false;
  }, { passive: true });

  const strip = el('div', { class:'streamline prog' });
  const ta = el('div', { class:'ta', contenteditable:'true', role:'textbox', 'aria-multiline':'true',
    'data-ph':'发消息或创建任务，/ 调用指令，@ 文件或对话' });
  const getText = () => (ta.innerText || '').replace(/\u00a0/g, ' ').replace(/\n$/, '');
  const clearText = () => { ta.textContent = ''; ta.style.height = 'auto'; try { syncInputButtons(); } catch {} };
  const caretToEnd = () => {
    try {
      const r = document.createRange(); r.selectNodeContents(ta); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch {}
  };

  // 聚焦输入框：只在「本来就在底部」时继续贴底，并覆盖键盘弹起后的几次重排；
  // 正在翻历史时不要强行把人拉回底部。
  ta.addEventListener('focus', () => {
    const b = ui.body;
    if (!b) return;
    if (b.scrollHeight - b.scrollTop - b.clientHeight > 120) { ui.atBottom = false; return; }
    ui.atBottom = true;
    const pin = () => {
      if (!ui || !ui.body || !ui.atBottom) return;
      try { ui.body.scrollTop = ui.body.scrollHeight; } catch {}
    };
    [0, 120, 320, 700, 1000].forEach(ms => setTimeout(pin, ms));
  });
  // 输入 `/` 弹指令面板，输入 `@` 弹文件引用
  const slashBox = el('div', { class:'slash' });
  async function updateHints() {
    const t = getText();
    const show = (nodes) => {
      slashBox.replaceChildren();
      slashBox.style.display = nodes.length ? 'block' : 'none';
      for (const n of nodes) slashBox.append(n);
    };

    // /指令
    if (/^\/[^\s]*$/.test(t)) {
      const q = t.slice(1).toLowerCase();
      const list = await ensureCommands();
      const hits = list.filter(c => String(c.name || '').toLowerCase().includes(q)).slice(0, 8);
      if (!hits.length) {
        // 有前缀但没匹配：也要给一行反馈，否则面板"消失"像是坏了
        return show([el('div', { class:'sitem' },
          el('b', { text:'没有匹配的指令' }),
          el('span', { class:'sdesc', text:`试试 /help 或直接发送` }))]);
      }
      return show(hits.map(c => el('div', { class:'sitem', onclick: () => {
        ta.textContent = `/${c.name} `;
        slashBox.replaceChildren(); slashBox.style.display = 'none';
        syncInputButtons();
        ta.focus(); caretToEnd();
      }}, el('b', { text: `/${c.name}` }), c.description ? el('span', { class:'sdesc', text: c.description }) : null)));
    }

    // @文件引用：支持 `@子目录/` 逐层往下
    const at = /(^|\s)@([^\s]*)$/.exec(t);
    if (at) {
      const typed = at[2];
      const slash = typed.lastIndexOf('/');
      const dirPart = slash >= 0 ? typed.slice(0, slash) : '';
      const q = (slash >= 0 ? typed.slice(slash + 1) : typed).toLowerCase();
      const base = state.sessionCwd || '';
      if (!base) return show([]);
      const dir = dirPart ? base.replace(/[\\/]+$/, '') + '\\' + dirPart.replace(/\//g, '\\') : base;
      let entries = [];
      try {
        const r = await api('/api/mobile/v1/directory/listing?path=' + encodeURIComponent(dir));
        entries = (r.listing && r.listing.entries) || [];
      } catch { entries = []; }
      const hits = entries
        .filter(e => !e.hidden && String(e.name || '').toLowerCase().includes(q))
        .sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1))
        .slice(0, 10);
      if (!hits.length) {
        return show([el('div', { class:'sitem' },
          el('b', { text:'没有匹配的文件' }),
          el('span', { class:'sdesc', text: dir }))]);
      }
      return show(hits.map(e => el('div', { class:'sitem', onclick: () => {
        const token = /(^|\s)@([^\s]*)$/.exec(getText());
        const before = token ? getText().slice(0, token.index) : '';
        const prefix = before && !before.endsWith(' ') ? ' ' : '';
        if (e.kind === 'folder') {
          // 文件夹只补到 `@dir/`，继续往下选
          const nextDir = dirPart ? `${dirPart}/${e.name}` : e.name;
          ta.textContent = `${before}${prefix}@${nextDir}/`;
          ta.focus(); caretToEnd();
          syncInputButtons();
          updateHints();
          return;
        }
        const ref = /\s/.test(e.path) ? `"${e.path}"` : e.path;
        ta.textContent = `${before}${prefix}${ref} `;
        slashBox.replaceChildren(); slashBox.style.display = 'none';
        syncInputButtons();
        ta.focus(); caretToEnd();
      }},
        el('b', { text: (e.kind === 'folder' ? '📁 ' : '📄 ') + e.name }),
        el('span', { class:'sdesc', text: e.kind === 'folder' ? '继续往下' : e.path }))));
    }

    show([]);
  }
  ta.addEventListener('input', () => {
    updateHints();
    syncInputButtons();
    clearTimeout(ta._ht);
    ta._ht = setTimeout(updateHints, 260);   // 兜底：等异步列表回来后再刷一次
    clearTimeout(ta._dt);
    ta._dt = setTimeout(() => saveDraft(state.sessionId, getText()), 400);
  });
  ta.addEventListener('keyup', () => updateHints());
  // 恢复未发送的草稿
  const draft = getDrafts()[state.sessionId];
  if (draft) ta.textContent = draft;
  const sendBtn = el('button', { class:'send', text:'↑', onclick: () => send() });

  // ---- F2 按住说话 ----
  // 能力存在就常驻麦克风（不再按设置隐藏）；dsh.speech.hold 只决定「按住是否启动识别」。
  const speechCtor = speechRecogCtor();
  const voiceBar = el('div', { class:'voice' },
    el('div', { class:'wv' }, ...[10, 22, 34, 18, 30, 38, 24, 14, 28, 36, 20, 12].map(h => el('i', { style:`height:${h}px` }))),
    el('div', { class:'hint' }));
  const micBtn = speechCtor
    ? el('button', { class:'mic', type:'button', html: sheetIconSVG('mic'), title:'按住说话', 'aria-label':'按住说话' })
    : null;

  function setVoiceHint(cancel) {
    const hint = voiceBar.querySelector('.hint');
    if (!hint) return;
    hint.replaceChildren();
    if (cancel) hint.append(document.createTextNode('松开取消'));
    else hint.append(document.createTextNode('松开结束 · '), el('b', { text:'上滑取消' }));
  }
  setVoiceHint(false);

  // 🎙 和 ↑ 常驻：空输入时 ↑ 半透明不响应，有文字/附件时 ↑ 正常；麦克风一直可见，
  // 但输入非空或设置关掉「按住说话」时按住不启动识别（静默）。
  let composerHasText = false;
  function syncSendDisabled() {
    const blocked = !!state.sending || (state.pending || []).some(a => a.uploading) || !!queueState.editing;
    sendBtn.disabled = blocked || !composerHasText;
    sendBtn.classList.toggle('off', !composerHasText);
  }
  function syncInputButtons() {
    composerHasText = !!getText().trim() || !!(state.pending || []).length;
    if (micBtn) {
      const rec = !!(state.rec && state.rec.sid === state.sessionId);
      const holdOn = speechHoldOn();
      micBtn.title = !holdOn ? '按住说话已在设置里关闭'
        : rec ? '松开结束，上滑取消'
        : composerHasText ? '请先清空输入' : '按住说话';
      micBtn.setAttribute('aria-disabled', (!holdOn || (composerHasText && !rec)) ? 'true' : 'false');
    }
    syncSendDisabled();
    if (ui && ui.sessionId === state.sessionId) ui.hasText = composerHasText;
  }

  function applyVoiceText(rec) {
    if (!rec || !rec.transcript) return;
    const base = rec.base || '';
    const sep = base && !/\s$/.test(base) ? ' ' : '';
    ta.textContent = base + sep + rec.transcript;
    try { caretToEnd(); } catch {}
    syncInputButtons();
  }

  function finishVoice(doSend) {
    const rec = state.rec;
    if (!rec) return;
    state.rec = null;
    try { rec.recog.abort(); } catch {}
    if (micBtn) micBtn.classList.remove('on');
    setVoiceHint(false);
    if (rec.cancelled || !String(rec.transcript || '').trim()) {
      // 取消 / 没识别出字：把输入框还给用户原来的内容
      ta.textContent = rec.base || '';
      saveDraft(state.sessionId, getText());
    } else {
      applyVoiceText(rec);
      saveDraft(state.sessionId, getText());
      // 2026-11-25 用户决策：松手**不自动发送**——识别结果只落进输入框，留给用户改完再按 ↑。
      try { ta.focus(); caretToEnd(); } catch {}
    }
    syncInputButtons();
    paintProg(true);
  }

  if (micBtn) {
    micBtn.addEventListener('pointerdown', (e) => {
      if (state.rec) return;
      if (e.button != null && e.button !== 0) return;
      // 设置关掉、或输入框已有文字/附件：静默忽略，不启动识别也不报错
      if (!speechHoldOn()) return;
      if (getText().trim() || (state.pending || []).length) return;
      e.preventDefault();
      try { micBtn.setPointerCapture(e.pointerId); } catch {}
      const Ctor = speechRecogCtor();
      if (!Ctor) return;
      const recog = new Ctor();
      recog.lang = /^zh/i.test(navigator.language || '') ? navigator.language : 'zh-CN';
      recog.interimResults = true;
      recog.continuous = false;
      recog.maxAlternatives = 1;
      const rec = {
        recog, base: getText(), transcript: '', cancelled: false, released: false, ended: false,
        sid: state.sessionId, startY: e.clientY, pointerId: e.pointerId,
      };
      state.rec = rec;
      micBtn.classList.add('on');
      setVoiceHint(false);
      syncInputButtons();
      paintProg(true);
      recog.onresult = (ev) => {
        let out = '';
        for (let i = 0; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r && r[0]) out += r[0].transcript;
        }
        rec.transcript = out;
        applyVoiceText(rec);
      };
      recog.onerror = (ev) => {
        const code = String((ev && ev.error) || '');
        if (code === 'aborted') return;
        rec.cancelled = true;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          if (!voiceState.deniedShown) {
            voiceState.deniedShown = true;
            toast('没有麦克风权限，可在 设置 → Safari → 麦克风 打开', 6000);
          }
        } else if (code === 'no-speech') {
          toast('没有听清，再说一次');
        } else {
          toast('语音识别失败：' + (code || '未知错误'));
        }
        try { recog.abort(); } catch {}
      };
      recog.onend = () => {
        rec.ended = true;
        if (rec.cancelled) { finishVoice(false); return; }
        if (rec.released) finishVoice(true);
      };
      try { recog.start(); }
      catch (err) {
        state.rec = null;
        micBtn.classList.remove('on');
        setVoiceHint(false);
        syncInputButtons();
        paintProg(true);
        toast('语音识别启动失败');
      }
    });
    micBtn.addEventListener('pointermove', (e) => {
      const rec = state.rec;
      if (!rec || rec.pointerId !== e.pointerId) return;
      // 上滑 44px 进入取消态，滑回来可以恢复
      if (rec.startY - e.clientY > 44) {
        if (!rec.cancelled) { rec.cancelled = true; setVoiceHint(true); }
      } else if (rec.cancelled) {
        rec.cancelled = false; setVoiceHint(false);
      }
    });
    const endHold = (e) => {
      const rec = state.rec;
      if (!rec || (e && rec.pointerId !== e.pointerId)) return;
      try { micBtn.releasePointerCapture(e.pointerId); } catch {}
      if (rec.cancelled) { finishVoice(false); return; }
      rec.released = true;
      if (rec.ended) { finishVoice(true); return; }
      try { rec.recog.stop(); } catch { finishVoice(true); }
    };
    micBtn.addEventListener('pointerup', endHold);
    micBtn.addEventListener('pointercancel', () => { if (state.rec) finishVoice(false); });
    micBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    micBtn.addEventListener('dragstart', (e) => e.preventDefault());
  }
  syncInputButtons();

  // 待发送附件（缩略图）——选完先挂着，能和文字一起发
  const attach = el('div', { class:'attach' });
  function updateAttachProgress(item) {
    const idx = state.pending.indexOf(item);
    const node = attach.children[idx];
    if (!node) return;
    const pct = Math.round((item.progress || 0) * 100);
    const bar = node.querySelector('.attprog');
    const label = node.querySelector('.attpct');
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = pct + '%';
  }
  function renderAttach() {
    attach.replaceChildren();
    attach.style.display = state.pending.length ? 'flex' : 'none';
    for (const a of state.pending) {
      const chip = el('div', { class:'att', onclick: () => {
        if (a.previewUrl) openImageFull(a.previewUrl);
      }});
      if (a.previewUrl) chip.append(el('img', { src: a.previewUrl, alt: a.name || '' }));
      else {
        const vid = isVideoFile(a);
        chip.append(el('span', { class:'attdoc', text: vid ? '🎬' : '📎' }));
        chip.title = vid
          ? `${a.name || '视频'}：会作为文件路径发送，App 内不能播放`
          : (a.name || '');
      }
      if (a.uploading) {
        chip.append(el('div', { class:'attprog', style:`width:${Math.round((a.progress||0)*100)}%` }));
        chip.append(el('div', { class:'attpct', text:Math.round((a.progress||0)*100) + '%' }));
      } else {
        chip.append(el('button', { class:'attx', text:'×', onclick: (e) => {
          e.stopPropagation();
          state.pending = state.pending.filter(x => x !== a);
          if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
          renderAttach();
        }}));
      }
      attach.append(chip);
    }
    // 附件增减也会改变发送可用态（有附件时即使没文字也能发）
    try { syncInputButtons(); } catch {}
  }


  async function send() {
    const sid = state.sessionId;
    const sendTitle = state.sessionTitle;
    if (!sid) return;
    const sameSession = () => state.view === 'session' && state.sessionId === sid && ui.sessionId === sid;
    const text = getText().trim();
    const atts = state.pending.slice();
    if ((!text && !atts.length) || sendBtn.disabled) return;
    if (state.speaking) stopSpeak();   // 发新消息时自动停朗读，不叠两路声音
    state.autoReadPending = false;     // 用户又发了，上一轮回复不再自动读
    state.sending = true;
    sendBtn.disabled = true;

    // 先把还没上传的附件传掉（此时才产生 uploadId，不会过期）
    for (const a of atts) {
      if (a.uploadId || a.path || !a.file) continue;
      a.uploading = true;
      if (sameSession()) renderAttach();
      try {
        const up = await uploadFile(a.file, (i, n) => {
          if (state.sessionId !== sid) return;
          a.progress = i / n;
          try { updateAttachProgress(a); } catch {}
        });
        const isImg = (a.mediaType || '').startsWith('image/');
        a.uploadId = isImg ? up.uploadId : null;
        a.path = isImg ? null : up.path;
        a.file = null;
      } catch (e) {
        a.uploading = false; state.sending = false;
        if (sameSession()) { renderAttach(); toast('附件上传失败：' + (e.message || e)); }
        else { saveDraft(sid, text); toast('附件上传失败（原会话）：' + (e.message || e)); }
        return;   // 中止发送，内容与附件都还留在原地
      }
      a.uploading = false;
      if (sameSession()) renderAttach();
    }

    const blocks = [];
    const notes = [];
    for (const a of atts) {
      if (a.uploadId) blocks.push({ type:'image', mediaType: a.mediaType, uploadId: a.uploadId });
      else if (a.path) notes.push(`${isVideoFile(a) ? '🎬 已上传视频' : '📎 已上传文件'}：${a.path}`);
    }
    const fullText = [text, ...notes].filter(Boolean).join('\n');
    if (fullText) blocks.unshift({ type:'text', text: fullText });

    const tmp = { id:`tmp-${Date.now()}`, role:'user', text: fullText, blocks:[], pending:true };
    if (sameSession()) {
      state.messages.push(tmp);
      paintSession({ scroll:'bottom' });
      clearText();
      state.pending = [];
      renderAttach();
    }
    saveDraft(sid, '');

    try {
      await api('/api/mobile/v1/session/send', { method:'POST', body: {
        sessionId: sid, content: blocks, clientMessageId: uuid(),
      }});
      if (sameSession()) {
        markBusy(true);
        await loadMessages(false, sid);
        // 发完就收键盘：多数人是发完去读回复，不是连发
        try { ta.blur(); } catch {}
      } else {
        toast('已发送到「' + (sendTitle || '原会话') + '」');
      }
    } catch (e) {
      // 失败时只恢复原会话的界面；用户已切走就不要污染当前会话
      if (sameSession()) {
        state.messages = state.messages.filter(m => m.id !== tmp.id);
        // 发送失败要把内容和附件还回去：网络抖一下不该把用户打的东西吞掉
        if (text) { ta.textContent = text; saveDraft(sid, text); try { caretToEnd(); } catch {}; syncInputButtons(); }
        state.pending = atts;
        renderAttach();
        paintSession();
        toast('发送失败：' + String(e.message || e) + '（内容已保留）');
        try { ta.focus(); } catch {}
      } else {
        if (text) saveDraft(sid, text);
        toast('发送失败（原会话）：' + String(e.message || e));
      }
    } finally {
      state.sending = false;
      if (sameSession()) syncInputButtons();
    }
  }

  // contenteditable 没有 input 事件里的 value，粘贴要自己净化成纯文本
  ta.addEventListener('paste', e => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, t);
  });
  // 手机上没有 Shift 键，所以触屏设备让 Enter = 换行，发送只走按钮；桌面保持 Enter 发送
  const touchOnly = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (touchOnly) return;
    if (e.shiftKey) return;
    e.preventDefault();
    send();
  });

  // ---- 附件：选完只上传并挂起，点发送才和文字一起发出去 ----
  const fileInput = el('input', { type:'file', accept:'image/*,video/*', multiple:'multiple', style:'display:none' });
  // 选图只做本地预览，真正的上传推迟到点发送那一刻（避免 uploadId 过期）
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    for (const f of files) {
      const mediaType = f.type || 'image/jpeg';
      const isImg = /^image\//i.test(mediaType);
      state.pending.push({
        file: f, mediaType, name: f.name,
        // 视频（以及其它非图片）不建 objectURL：<img> 显示 video 的 URL 只会裂图
        previewUrl: isImg ? URL.createObjectURL(f) : null, progress: 0, uploading: false,
      });
      if (isVideoFile({ mediaType, name: f.name })) {
        const mb = Math.round((f.size || 0) / 1048576);
        toast(mb >= 50
          ? `视频会作为文件路径发送，App 内不能播放（${mb}MB，上传要等一会儿）`
          : '视频会作为文件路径发送，App 内不能播放');
      }
    }
    renderAttach();
  });

  // 三颗 chip：工作区 / 模型 / 推理等级（都是现成数据，不造指标）
  const wsSel = workspaceOf(state.sessionId);
  const wsName = (wsSel && (wsSel.title || wsSel.path)) ||
    (state.sessionCwd ? String(state.sessionCwd).split(/[\\/]/).filter(Boolean).pop() : '工作区');
  const modelShort = String(state.model || '模型').split(' · ')[0].replace(/^DeepSeek[- ]?/i, '');
  const effortNow = (state.modelMeta && state.modelMeta.reasoningEffort) || '推理';
  const modelRow = el('button', { class:'chip2', onclick: () => openModelPicker() },
    el('span', { class:'ci', html:NAV_ICONS.model }), el('b', { text: modelShort }));
  const effortRow = el('button', { class:'chip2', onclick: () => openModelPicker() },
    el('b', { text: effortNow }));


  // 中断运行：正在跑的时候才出现
  const stopBtn = el('button', { class:'stop', text:'■', title:'中断运行', onclick: () => stopRun() });
  const qDock = el('div', { class:'qdock' });
  // 编辑排队消息时的提示条：文本进输入框，附件留在队列里（走宿主的 edit 动作）
  const editBar = el('div', { class:'qeditbar' });

  // 会话权限：读 projections.permissions，切换走宿主 /permission 命令（不发给模型）
  const permMeta = (name) => {
    const map = {
      'workspace-write': { icon:'🛡', short:'写入', label:'工作区写入', desc:'可写工作区和临时目录；越权操作需要审批' },
      'danger-full-access': { icon:'🔓', short:'全权', label:'完全访问', desc:'不再逐次审批，可直接读写任意路径（危险）' },
      'auto': { icon:'🤖', short:'自动', label:'自动审查', desc:'由 Auto review 按每次工具调用决定' },
      'custom': { icon:'🛡', short:'自定义', label:'自定义', desc:'当前沙箱/审批组合不在预设表里' },
    };
    return map[name] || { icon:'🛡', short:name ? String(name).slice(0, 4) : '权限', label:name || '未知', desc:'' };
  };
  const permBtn = el('button', { type:'button', class:'chip2 permchip', title:'调整会话权限', onclick: () => openPermissionPicker() });
  function paintPerm() {
    const m = permMeta(state.permCurrent);
    const danger = state.permCurrent === 'danger-full-access';
    const icon = danger ? NAV_ICONS.unlock : NAV_ICONS.shield;
    permBtn.innerHTML = `<span class="ci">${icon}</span><b>${m.short}</b>`;
    permBtn.title = '会话权限：' + m.label;
    permBtn.classList.toggle('danger', danger);
  }
  const chips = el('div', { class:'chips' }, modelRow, effortRow, permBtn);
  paintPerm();
  async function choosePermission(name, label) {
    if (name === 'danger-full-access') {
      openInfoBox('开启完全访问？', [
        ['影响', '工具调用不再逐次审批，可以直接执行'],
        ['沙箱', 'danger-full-access：可读写任意路径'],
        ['建议', '只在需要时临时开启，用完切回工作区写入'],
      ], [
        { label:'开启完全访问', run: () => applyPermission(name, label) },
        { label:'取消', run: () => {} },
      ]);
      return;
    }
    await applyPermission(name, label);
  }
  async function applyPermission(name, label) {
    try {
      // 先确认宿主确实注册了 /permission：不认识时 /session/send 会把整行当普通消息发给模型
      const cmds = await api('/api/mobile/v1/commands?sessionId=' + encodeURIComponent(state.sessionId));
      if (!(cmds.items || []).some(c => c && c.name === 'permission')) {
        toast('当前宿主没有 /permission 命令，无法切换权限');
        return;
      }
      await api('/api/mobile/v1/session/send', { method:'POST', body: {
        sessionId: state.sessionId,
        content: [{ type:'text', text: `/permission ${name}` }],
        clientMessageId: crypto.randomUUID(),
      }});
      toast('已切换到：' + label);
      setTimeout(loadSessionStats, 400);
      setTimeout(loadSessionStats, 1400);
    } catch (e) {
      toast('切换权限失败：' + (e.message || e));
    }
  }
  function openPermissionPicker() {
    const cur = state.permCurrent || '';
    const opts = [
      { value:'workspace-write', icon:'🛡', label:'工作区写入', desc:'可写工作区和临时目录；越权操作需要审批' },
      { value:'danger-full-access', icon:'🔓', label:'完全访问', desc:'不再逐次审批，可直接读写任意路径（危险）' },
    ];
    const items = opts.map(o => ({
      label: (cur === o.value ? '✓ ' : '') + o.label,
      icon: o.icon,
      run: () => choosePermission(o.value, o.label),
    }));
    if (cur && cur !== 'workspace-write' && cur !== 'danger-full-access') {
      items.unshift({ label:'当前：' + permMeta(cur).label, icon:'🛡', run: () => {} });
    }
    openSheet(items, '会话权限 · ' + (permMeta(cur).label || '未知'));
  }

  const dock = el('div', { class:'dock' },
    slashBox,
    attach,
    qDock,
    editBar,
    voiceBar,
    strip,
    el('div', { class:'composer' }, ta,
      el('div', { class:'crow' },
        el('button', { class:'plus', text:'+', onclick: () => fileInput.click() }),
        chips,        el('div', { class:'sendgroup' }, stopBtn, micBtn, sendBtn))),
    fileInput,
    metabar,
  );

  // 回到底部 + 新消息提示
  const jump = el('button', { class:'jump', text:'↓ 回到底部', onclick: () => {
    ui.atBottom = true;
    body.scrollTop = body.scrollHeight; state.unseen = 0; updateJump();
  }});
  function updateJump() {
    const far = body.scrollHeight - body.scrollTop - body.clientHeight > 240;
    jump.classList.toggle('on', far);
    jump.textContent = state.unseen > 0 ? `↓ ${state.unseen} 条新消息` : '↓ 回到底部';
  }
  body.addEventListener('scroll', () => {
    const distance = body.scrollHeight - body.scrollTop - body.clientHeight;
    const far = distance > 240;
    if (!far) state.unseen = 0;
    // 记录「用户是不是在看最新消息」：键盘弹起、窗口缩放、贴底校正都靠它判断
    if (ui && ui.body === body) ui.atBottom = distance < 90;
    if (distance < 90) markSessionSeen(state.sessionId);
    updateJump();
  }, { passive: true });

  wrap.append(body, dock, jump);
  // 让"回到底部"永远贴在输入框上方，而不是压进输入框里
  const syncDockH = () => {
    try { wrap.style.setProperty('--dock-h', dock.offsetHeight + 'px'); } catch {}
  };
  syncDockH();
  requestAnimationFrame(syncDockH);
  if (window.ResizeObserver) {
    try { new ResizeObserver(syncDockH).observe(dock); } catch {}
  }

  resetUi({ sessionId: state.sessionId, body, listWrap, cardsWrap, ta, sendBtn, stopBtn, strip, dot, modelEl: modelRow, effortEl: effortRow,
    send, // 新会话页要借它把第一条发出去（闭合在 renderSession 里，外面拿不到）
    voiceBar, micBtn, syncInputButtons, syncSendState: syncSendDisabled, hasText: composerHasText,
    qDock, editBar, jump, updateJump, loadStats: loadSessionStats, keys: [], nodes: [], cardsKey: '', prevCount: undefined, atBottom: true, progSig: '' });

  // 首次绘制必须等 wrap 挂进 #root 之后：render() 在 renderSession 返回后才 append，
  // 而 paintSession 对未连接的 body 会直接 return。以前返回子代理只读页时这里画不出来，
  // 只能等 4 秒轮询 —— 现在延到下一帧补画，并按 state.sessionRestore 恢复父会话位置。
  const finishInitialPaint = () => {
    if (!ui || ui.sessionId !== state.sessionId || state.view !== 'session') return;
    if (!ui.body || !ui.body.isConnected) return;
    const restore = state.sessionRestore && state.sessionRestore.sessionId === state.sessionId
      ? state.sessionRestore : null;
    if (!restore) {
      // 新会话/没缓存时没有消息可画，交给 openSession 的 loadMessages，避免闪一下空态
      if (state.messages.length) paintSession({ scroll:'bottom' });
      return;
    }
    state.sessionRestore = null;
    if (restore.atBottom) {
      // 原本就在底部：继续贴底（新消息/轮次结束也不会被拉走）
      paintSession({ scroll:'bottom' });
      return;
    }
    // 原本在中间：禁止 paintSession 自己贴底，画完立刻把滚动位置放回去
    paintSession({ scroll:'none' });
    try { ui.body.scrollTop = restore.top; } catch {}
    ui.atBottom = false;
    try { ui.updateJump?.(); } catch {}
  };
  if (body.isConnected) finishInitialPaint();
  else requestAnimationFrame(finishInitialPaint);
}

// 把「纯工具调用」的连续消息合并成一行步骤，避免一屏都是 ⚙ chip

function buildFeed() {
  const out = [];
  let pending = [];
  const flush = () => { if (pending.length) { out.push({ kind:'tools', tools: pending }); pending = []; } };
  for (const m of state.messages) {
    const blocks = m.blocks || [];
    const hasBody = (m.text && m.text.trim()) || blocks.some(b => b.type === 'text' && b.text);
    const tools = blocks.filter(b => b.type === 'tool-call' || b.type === 'tool-result');
    if (m.role !== 'user' && !hasBody && tools.length) { pending.push(...tools); continue; }
    flush();
    out.push({ kind:'msg', m });
  }
  flush();
  return out;
}

// 一个回合里的命令/改动折成一行，点开才展开（抄 Ovis 的做法）

const openTools = new Set();

const toolGroupKey = (tools) => (tools[0] && (tools[0].callId || tools[0].name)) || 'k';


function renderTools(tools) {
  const names = [...new Set(tools.filter(t => t.type === 'tool-call').map(t => t.name || 'tool'))];
  const key = toolGroupKey(tools);
  const open = openTools.has(key);
  const summary = el('div', { class:'steps', onclick: () => {
    if (openTools.has(key)) openTools.delete(key); else openTools.add(key);
    paintSession();
  }},
    el('span', { class:'chev2', text: open ? '▾' : '▸' }),
    el('span', { text:`${tools.length} 步` }),
    el('span', { class:'dim', style:'margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
      text: names.slice(0, 3).join(' · ') + (names.length > 3 ? ` +${names.length - 3}` : '') }),
  );
  if (!open) return summary;
  const box = el('div', { class:'stepsbody' });
  for (const t of tools) {
    box.append(el('div', { class:'step' },
      el('span', { text: t.type === 'tool-call' ? `⚙ ${t.name || 'tool'}` : '↩ 结果' })));
  }
  return el('div', {}, summary, box);
}

// 长按消息：复制 / 引用

function openMsgMenu(text, ts) {
  if (!text) return;
  openSheet([
    { label:'复制', icon:'⧉', run: async () => {
      try { await navigator.clipboard.writeText(text); }
      catch {
        const t = document.createElement('textarea');
        t.value = text; document.body.append(t); t.select();
        document.execCommand('copy'); t.remove();
      }
      toast('已复制');
    } },
    { label:'引用到输入框', icon:'↩', run: () => quoteToComposer(text) },
  ], ts ? fmtMsgTime(ts) : '消息');
}


function quoteToComposer(text) {
  if (!ui.ta) return;
  const quoted = String(text).split('\n').slice(0, 3).map(l => `> ${l}`).join('\n');
  ui.ta.textContent = quoted + '\n\n';
  try { ui.syncInputButtons && ui.syncInputButtons(); } catch {}
  ui.ta.focus();
  try {
    const r = document.createRange();
    r.selectNodeContents(ui.ta); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  } catch {}
}


function attachMsgActions(node, text, ts) {
  if (!text) return node;
  let lp = null;
  const arm = () => { lp = setTimeout(() => openMsgMenu(text, ts), 480); };
  const disarm = () => { if (lp) { clearTimeout(lp); lp = null; } };
  node.addEventListener('touchstart', arm, { passive: true });
  node.addEventListener('touchend', disarm, { passive: true });
  node.addEventListener('touchmove', disarm, { passive: true });
  node.addEventListener('contextmenu', (e) => { e.preventDefault(); openMsgMenu(text, ts); });
  return node;
}

// 每条消息下方的操作：复制 / 从这里分叉
// ---------------- 排队中的消息（宿主侧 inbox，靠 session/queue 帧同步） ----------------

function cancelBlockCopy(mdNode) {
  if (!mdNode) return;
  mdNode.classList.remove('pickcopy');
  if (mdNode._copyHandler) mdNode.removeEventListener('click', mdNode._copyHandler, true);
  mdNode._copyHandler = null;
  if (mdNode._copyTimer) clearTimeout(mdNode._copyTimer);
  mdNode._copyTimer = null;
}

// 「分段复制」：给每个顶层块（段落/标题/列表/引用/代码/表格）点一下复制本段

function toggleBlockCopy(btn) {
  const holder = btn.closest('.mholder');
  const mdNode = holder && holder.querySelector('.md');
  if (!mdNode) { toast('这条消息没有可复制的文本'); return; }
  if (mdNode._copyHandler) { cancelBlockCopy(mdNode); toast('已退出分段复制'); return; }
  mdNode.classList.add('pickcopy');
  toast('点要复制的那一段');
  const handler = async (e) => {
    if (e.target.closest('.codecopy')) return;   // 代码块自己的复制按钮优先
    const block = e.target.closest('.md > *');
    if (!block) return;
    e.preventDefault(); e.stopPropagation();
    // 代码块外层有复制按钮，innerText 会把按钮文字带进去；只取 code 内容
    const code = block.querySelector && block.querySelector('pre.code code');
    const txt = code ? (code.textContent || '').trim() : (block.innerText || '').trim();
    if (!txt) return;
    if (await copyText(txt)) toast('已复制这一段');
    else toast('复制失败');
    cancelBlockCopy(mdNode);
  };
  mdNode._copyHandler = handler;
  mdNode.addEventListener('click', handler, true);
  mdNode._copyTimer = setTimeout(() => cancelBlockCopy(mdNode), 8000);
}


function msgActions(m, alignRight) {
  const text = (m && m.text) || '';
  const row = el('div', { class: 'mact' + (alignRight ? ' right' : '') });
  if (text) {
    row.append(el('button', { onclick: async (e) => {
      e.stopPropagation();
      if (await copyText(text)) toast('已复制这条消息');
      else toast('复制失败');
    }}, '⧉ 复制'));
    if (!alignRight) row.append(el('button', { onclick: (e) => {
      e.stopPropagation();
      toggleBlockCopy(e.currentTarget);
    }}, '¶ 分段'));
  }
  const seq = Number.isSafeInteger(m && m.seq) ? m.seq : null;
  if (!alignRight && text) {
    const mid = m && m.id != null ? String(m.id) : '';
    const on = !!(state.speaking && state.speakMsgId === mid);
    row.append(el('button', {
      'data-speak-mid': mid,
      onclick: (e) => {
        e.stopPropagation();
        if (state.speaking && state.speakMsgId === mid) stopSpeak();
        else speakText(text, mid);
      },
      html: speakBtnHtml(on),
    }));
  }
  if (seq !== null && seq > 0) {
    row.append(el('button', { onclick: (e) => { e.stopPropagation(); forkSessionAt(m, seq); } }, '⑂ 分支'));
  }
  return row;
}


function renderMessage(m) {
  const blocks = m.blocks || [];
  const textBlocks = blocks.filter(b => b.type === 'text' && b.text);
  const mediaBlocks = blocks.filter(b => b.type === 'image' && b.attachmentId);
  const toolBlocks = blocks.filter(b => b.type === 'tool-call' || b.type === 'tool-result');
  const body = (m.text && m.text.trim()) ? m.text : textBlocks.map(b => b.text).join('\n');

  const images = mediaBlocks.map(b => el('img', {
    class: 'mdimg', 'data-att': b.attachmentId, alt: b.name || '图片',
  }));
  const gallery = images.length ? el('div', { class:'imgrow' }, ...images) : null;

  if (m.role === 'user') {
    const bubble = el('div', { class:'bubble', style: m.pending ? 'opacity:.55' : '' });
    // 附件（视频/文件）在正文里只有一行路径：拆出来渲染成文件卡，别让它看起来像一段乱码
    const notes = splitAttachmentNotes(body);
    if (notes.text) bubble.append(document.createTextNode(notes.text));
    if (gallery) bubble.append(gallery);
    for (const p of notes.files) {
      const vid = isVideoName(p);
      bubble.append(el('div', { class:'filecard', onclick: () => openFileCard(p, vid) },
        el('span', { class:'fico2', text: vid ? '🎬' : '📎' }),
        el('div', { class:'fbody' },
          el('b', { text: String(p).split(/[\\/]/).pop() || p }),
          el('small', { text: vid ? '视频文件 · 点击播放' : '文件 · 点击保存到手机' }))));
    }
    if (!notes.text && !notes.files.length && !images.length) bubble.append(document.createTextNode('(空消息)'));
    return el('div', { class:'mholder' },
      attachMsgActions(el('div', { class:'msg user' }, bubble), body, m.time),
      msgActions(m, true));
  }
  const wrap = el('div', { class:'msg assistant' });
  if (body) {
    const mdNode = el('div', { class:'md', html: mdToHtml(body) });
    decorateCodeCopies(mdNode);
    wrap.append(mdNode);
  }
  if (gallery) wrap.append(gallery);
  if (toolBlocks.length) {
    wrap.append(el('div', { class:'tools' }, toolBlocks.map(b =>
      el('span', { class:'tool', text: b.type === 'tool-call' ? `⚙ ${b.name || 'tool'}` : '↩ 结果' }))));
  }
  return el('div', { class:'mholder' },
    attachMsgActions(wrap, body, m.time),
    msgActions(m, false));
}

// ---------------------------------------------------------------- 审批 / 提问卡
// 提交后先让卡片收起到 0 高度，再从 state 移除并重绘。
// 直接删会让 cardsWrap 高度瞬间少一截，对话流跟着跳；收起过程中若本来在底部就持续贴底。

export { paint, paintSession, renderSession, repaintSessionKeepingScroll };
