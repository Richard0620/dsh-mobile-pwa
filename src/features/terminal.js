import { loadRoots, render } from '../core/bus.js';
import { APP_VERSION } from '../core/version.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { openSheet } from '../components/sheet.js';
import { openDrawer } from '../components/drawer.js';
import { openFileDrawer } from '../components/file-drawer.js';

const termAgents = { items: [], at: 0, loading: false, authErr: false };

function termToken() { return localStorage.getItem('bridge_token') || ''; }

function parseTermSnapshot(j) {
  const snap = j && j.result && j.result.snapshot;
  if (!snap) throw new Error('bad snapshot');
  const panes = snap.panes || [];
  const tabs = snap.tabs || [];
  const agents = snap.agents || [];
  return tabs.map((t) => {
    const p = panes.find((x) => x.tab_id === t.tab_id) || {};
    const a = agents.find((x) => x.pane_id === p.pane_id);
    return {
      tabId: t.tab_id,
      label: t.label || (p.cwd ? String(p.cwd).split(/[\\/]/).pop() : 'tab'),
      paneId: p.pane_id || '',
      cwd: p.cwd || '',
      status: (a && a.agent_status) || p.agent_status || 'unknown',
      agent: a ? (a.name || a.agent || '') : '',
    };
  });
}

function loadTermAgents() {
  const tk = termToken();
  if (!tk || termAgents.loading) return;
  termAgents.loading = true;
  fetch('/agents/snapshot', { headers: { Authorization: 'Bearer ' + tk } })
    .then((r) => {
      if (r.status === 401) { const e = new Error('HTTP 401'); e.status = 401; throw e; }
      return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    })
    .then((j) => {
      termAgents.items = parseTermSnapshot(j);
      termAgents.authErr = false;
      termAgents.loading = false;
      termAgents.at = Date.now();
      if (state.view === 'list') render();
    })
    .catch((e) => {
      if (e && e.status === 401) { termAgents.authErr = true; termAgents.items = []; }
      termAgents.loading = false;
      termAgents.at = Date.now();
      if (e && e.status === 401 && state.view === 'list' && state.tab === 'terminal') render();
    });
}

async function createTerminalTab(cwd, startKind = '') {
  try {
    const tk = termToken();
    const labelMap = { dsh: 'DSH', agy: 'Gemini', gemini: 'Gemini', claude: 'Claude' };
    if (startKind) toast('\u6B63\u5728\u521B\u5EFA\u5E76\u542F\u52A8 ' + (labelMap[startKind] || startKind) + '\u2026');
    const r = await fetch('/agents/tab/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ cwd, startKind }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    if (j.startErr) toast('\u7EC8\u7AEF\u5DF2\u521B\u5EFA\uFF0C\u4F46\u542F\u52A8\u5931\u8D25\uFF1A' + j.startErr);
    else if (startKind && j.started !== true) toast('\u7EC8\u7AEF\u5DF2\u521B\u5EFA\uFF0C\u4F46 bridge \u672A\u81EA\u52A8\u542F\u52A8\uFF08\u8BF7\u91CD\u542F bridge \u6216\u624B\u52A8\u542F\u52A8\uFF09');
    else toast(startKind ? ('\u5DF2\u542F\u52A8 ' + (labelMap[startKind] || startKind)) : '\u5DF2\u521B\u5EFA\u7EC8\u7AEF');
    termAgents.at = 0;
    loadTermAgents();
    document.querySelectorAll('.termoverlay').forEach((n) => n.remove());
    if (j.paneId) openTerminal(j.paneId);
  } catch (e) { toast('\u521B\u5EFA\u5931\u8D25\uFF1A' + (e.message || e)); }
}

function openTerminalStartSheet(cwd) {
  const dirName = String(cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd || '\u7EC8\u7AEF';
  openSheet([
    { label: 'DSH\uFF08\u81EA\u7136\u8BED\u8A00\uFF09', sub: '\u72EC\u7ACB headless \u4F1A\u8BDD \u00B7 \u6D41\u5F0F\u5DE5\u5177\u8FDB\u5EA6', icon: 'D', run: () => createTerminalTab(cwd, 'dsh') },
    { label: 'Gemini\uFF08agy\uFF09', sub: '\u901A\u8FC7 herdr \u542F\u52A8 --kind agy \u00B7 \u53CC\u89C6\u56FE\u4E92\u901A', icon: 'G', run: () => createTerminalTab(cwd, 'agy') },
    { label: 'Claude Code', sub: '\u901A\u8FC7 herdr \u542F\u52A8 --kind claude \u00B7 \u53CC\u89C6\u56FE\u4E92\u901A', icon: 'C', run: () => createTerminalTab(cwd, 'claude') },
    { label: '\u4EC5\u6253\u5F00\u7EAF\u7EC8\u7AEF', sub: '\u53EA\u5EFA shell\uFF0C\u8FDB\u5165\u540E\u518D\u9009\u62E9\u542F\u52A8\u65B9\u5F0F', icon: '>_', run: () => createTerminalTab(cwd, '') },
  ], '\u5728 ' + dirName + ' \u4E2D\u65B0\u5EFA\u7EC8\u7AEF\u5BF9\u8BDD');
}

async function newTerminal() {
  let roots = [];
  try { roots = await loadRoots(); } catch (e) {}
  await openFileDrawer(state.sessionCwd || '', { pick: true, roots, onPick: async (p) => {
    setTimeout(() => openTerminalStartSheet(p), 30);
    return true;
  }});
}

function appendTermGroup(main) {
  if (!termToken()) return;
  const closed = localStorage.getItem('term.collapsed') === '1';
  const items = termAgents.items || [];
  const head = el('div', { class: 'ghead' + (closed ? ' closed' : ''), onclick: () => {
    localStorage.setItem('term.collapsed', closed ? '0' : '1');
    render();
  }},
    el('span', { class: 'chev', text: '\u25BC' }),
    el('span', { text: '\u2318' }),
    el('span', { class: 'gname', text: '\u7EC8\u7AEF' }),
    el('span', { class: 'count', style: 'margin-left:auto', text: String(items.length) }),
    el('button', { class: 'ico', text: '\uFF0B', title: '\u65B0\u5EFA\u7EC8\u7AEF', onclick: (ev) => { ev.stopPropagation(); newTerminal(); } }),
  );
  const box = el('div', { class: 'group' }, head);
  if (!closed) {
    if (!items.length) box.append(el('div', { class: 'empty', text: '\u6CA1\u6709\u7EC8\u7AEF' }));
    for (const it of items) {
      box.append(el('div', { class: 'row', onclick: () => openTerminal(it.paneId) },
        el('span', { class: 'dot' + (it.status === 'working' ? ' run' : '') }),
        el('div', { class: 'body' },
          el('div', { class: 't' },
            el('span', { class: 'title', text: it.label }),
            it.status === 'blocked' ? el('span', { class: 'unread', title: '\u7B49\u4F60' }) : null,
            el('span', { class: 'time', text: it.status }))),
        el('button', { class: 'rowmore', text: '\u00D7', title: '\u5173\u95ED\u7EC8\u7AEF', onclick: (ev) => { ev.stopPropagation(); askCloseTerminal(it); } })));
    }
  }
  main.append(box);
}

function renderTerminalSetupCard(main, isAuthErr) {
  const card = el('div', { class:'termsetup' });
  card.append(
    el('h3', { text: isAuthErr ? '终端连接凭据已失效' : '连接远程终端' }),
    el('p', { text: isAuthErr
      ? '当前保存的 Bearer token 未通过校验（401），请粘贴最新的本机 bridge token 重新连接。'
      : '首次在当前浏览器或预览环境使用终端，需粘贴一次本机 bridge 的 Bearer token（存在本机，后续不再重复输入）。' }),
  );
  const inp = el('input', { type:'password', placeholder:'粘贴 Bearer token', autocomplete:'off', 'aria-label':'Bearer token' });
  const errEl = el('div', { class:'tserr' });
  errEl.style.display = 'none';
  const showErr = (m) => { errEl.textContent = m || ''; errEl.style.display = m ? '' : 'none'; };
  const pasteBtn = el('button', { class:'tspaste', type:'button', text:'粘贴', onclick: async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const txt = (await navigator.clipboard.readText()).trim();
        if (txt) { inp.value = txt; showErr(''); toast('已粘贴'); return; }
      }
      toast('请长按输入框粘贴');
    } catch { toast('请长按输入框粘贴'); }
  } });
  card.append(el('div', { class:'tsrow' }, inp, pasteBtn), errEl);
  const goBtn = el('button', { class:'tsbtn primary', type:'button', text:'保存并连接' });
  const doConnect = async () => {
    const val = inp.value.trim();
    if (!val) { showErr('请先粘贴 Bearer token'); return; }
    showErr('');
    goBtn.disabled = true;
    goBtn.textContent = '验证中…';
    try {
      const r = await fetch('/agents/snapshot', { headers: { Authorization: 'Bearer ' + val } });
      if (r.status === 401) throw new Error('token 无效，请核对本机 token.txt');
      if (!r.ok) throw new Error('连接失败（HTTP ' + r.status + '）');
      const j = await r.json();
      localStorage.setItem('bridge_token', val);
      termAgents.items = parseTermSnapshot(j);
      termAgents.authErr = false;
      termAgents.at = Date.now();
      toast('已连接远程终端');
      render();
    } catch (e) {
      showErr(e.message || String(e));
      goBtn.disabled = false;
      goBtn.textContent = '保存并连接';
    }
  };
  goBtn.onclick = doConnect;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doConnect(); } });
  const openRaw = el('button', { class:'tsbtn', type:'button', text:'打开 /agents/', onclick: () => { location.href = '/agents/'; } });
  card.append(el('div', { class:'tsacts' }, goBtn, openRaw));
  main.append(card);
}

function renderTerminalTab(main) {
  if (!termToken() || termAgents.authErr) {
    renderTerminalSetupCard(main, !!termAgents.authErr);
    return;
  }
  const items = termAgents.items || [];
  main.append(el('div', { class:'tbar' },
    el('b', { text:'终端' }),
    el('span', { text:String(items.length) }),
    el('button', { text:'新建终端', onclick: () => newTerminal() })));
  if (!items.length) {
    main.append(el('div', { class:'empty', text:'还没有终端会话' }));
    return;
  }
  // 按 agent（claude / codex / dsh …）分组，一眼能看出这个终端在跑什么
  const groups = new Map();
  for (const it of items) {
    const k = (it.agent || '未标注').trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  for (const [name, list] of groups) {
    main.append(el('div', { class:'fsect' }, el('b', { text:name }), el('span', { text:String(list.length) })));
    for (const it of list) {
      const stTxt = it.status === 'working' ? '运行中' : it.status === 'blocked' ? '等你确认' : '空闲';
      const dotCls = 'dot' + (it.status === 'working' ? ' run' : it.status === 'blocked' ? ' pending' : '');
      main.append(el('div', { class:'row', onclick: () => openTerminal(it.paneId) },
        el('span', { class: dotCls }),
        el('div', { class:'body' },
          el('div', { class:'t' },
            el('span', { class:'title', text: it.label || 'tab' }),
            el('span', { class:'time', text: stTxt })),
          it.cwd ? el('div', { class:'p', text: it.cwd }) : null),
        el('button', { class:'rowmore', text:'×', title:'关闭终端', onclick: (ev) => { ev.stopPropagation(); askCloseTerminal(it); } })));
    }
  }
}

function askCloseTerminal(it) {
  openSheet([
    { label: '\u5173\u95ED\u7EC8\u7AEF\uFF08' + it.label + '\uFF09', icon: '\u00D7', run: () => closeTerminal(it) },
    { label: '\u53D6\u6D88', icon: '\u21A9', run: () => {} },
  ], '\u5173\u95ED\u7EC8\u7AEF');
}

async function closeTerminal(it) {
  try {
    const tk = termToken();
    const r = await fetch('/agents/tab/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ tabId: it.tabId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    toast('\u7EC8\u7AEF\u5DF2\u5173\u95ED');
    termAgents.at = 0;
    loadTermAgents();
  } catch (e) { toast('\u5173\u95ED\u5931\u8D25\uFF1A' + (e.message || e)); }
}function openTerminal(paneId) {
  const mask = el('div', { class: 'termoverlay' });
  const bar = el('div', { class: 'termbar' },
    el('button', { class: 'ico', text: '\u2039', onclick: () => mask.remove() }),
    el('b', { text: '\u7EC8\u7AEF' }),
    el('button', { class: 'ico', text: '\u2630', title: '\u4F1A\u8BDD\u5217\u8868', onclick: () => { mask.remove(); openDrawer(); } }),
    el('button', { class: 'ico', text: '\uD83D\uDCC1', title: '\u6587\u4EF6', onclick: () => { mask.remove(); openFileDrawer(state.sessionCwd || ''); } }),
    el('span', { style: 'flex:1' }),
    el('button', { class: 'ico', text: '\u2715', onclick: () => mask.remove() }));
  const frame = el('iframe', { class: 'termframe', src: '/agents/?embed=1&pcomposer=1&pane=' + encodeURIComponent(paneId || '') + '&v=' + encodeURIComponent(APP_VERSION) });
  const tta = el('div', { class: 'tta', contenteditable: 'true' });
  tta.setAttribute('data-ph', '\u7EE7\u7EED\u8FFD\u95EE\uFF0CEnter \u53D1\u9001');
  const post = (m) => { try { frame.contentWindow.postMessage(m, location.origin); } catch {} };
  const tstop = el('button', { class: 'tstop', text: '\u25A0', title: '\u505C\u6B62', onclick: () => post({ type: 'agents-stop' }) });
  const sendTerm = () => {
    const text = (tta.innerText || '').replace(/\u00a0/g, ' ').trim();
    if (!text) return;
    post({ type: 'agents-send', text });
    tta.textContent = '';
    tta.style.height = '';
    setTimeout(fitOverlay, 0);
  };
  const tsend = el('button', { class: 'tsend', text: '\u2191', title: '\u53D1\u9001', onclick: sendTerm });
  tta.addEventListener('keydown', (e) => { if (e.isComposing) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTerm(); } });
  tta.addEventListener('input', () => { tta.style.height = 'auto'; tta.style.height = Math.min(120, Math.max(44, tta.scrollHeight)) + 'px'; setTimeout(fitOverlay, 0); });
  const tcomp = el('div', { class: 'termcomposer' }, tta, tstop, tsend);
  mask.append(bar, frame, tcomp);
  document.body.append(mask);
  // Keep the overlay full-screen (opaque) and lift only the composer to the
  // visual viewport edge: the keyboard's translucent accessory bar must never
  // reveal the PWA session list underneath.
  const fitOverlay = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const vh = Math.round(vv.height);
    const kb = vh < window.innerHeight - 100;
    mask.style.height = '100%';
    mask.style.bottom = '0';
    tcomp.style.position = 'absolute';
    tcomp.style.left = '0';
    tcomp.style.right = '0';
    tcomp.style.paddingBottom = kb ? '8px' : 'calc(10px + env(safe-area-inset-bottom))';
    const compH = tcomp.offsetHeight;
    const barH = bar.offsetHeight;
    tcomp.style.top = Math.max(0, vh - compH) + 'px';
    frame.style.flex = '0 0 auto';
    frame.style.height = Math.max(120, vh - barH - compH) + 'px';
    frame.style.marginBottom = '0';
    try { window.scrollTo(0, 0); } catch {}
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitOverlay);
    window.visualViewport.addEventListener('scroll', fitOverlay);
  }
  tta.addEventListener('focus', () => { setTimeout(fitOverlay, 120); setTimeout(fitOverlay, 380); });
  setTimeout(fitOverlay, 0);
  setTimeout(fitOverlay, 120);
  frame.addEventListener('load', () => {
    try { frame.contentWindow.postMessage({ type: 'agents-token', token: termToken() }, location.origin); } catch {}
  });
}

// 子 iframe（/agents/）没有 token 时向父页面要；父页面用 postMessage 回传，避免 token 进 URL 和访问日志。

export { loadTermAgents, newTerminal, renderTerminalTab, termAgents, termToken };
