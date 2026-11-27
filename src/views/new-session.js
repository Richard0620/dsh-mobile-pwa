import { render } from '../core/bus.js';
import { state, ui } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
import { openSheet, sheetIconSVG } from '../components/sheet.js';
import { heroBackHeader } from '../components/chrome.js';
import { createWorkspaceAt, openWorkspacePicker } from '../features/session-actions.js';
import { openSession, refreshAll } from '../features/sync.js';

function renderNewSession(wrap) {
  const back = el('button', { class:'ico', html:sheetIconSVG('chevronLeft'), title:'返回', 'aria-label':'返回',
    onclick: () => { state.view = 'list'; render(); } });
  wrap.append(heroBackHeader('新会话', '写完直接发第一条', back));

  const ta = el('textarea', { class:'newta', placeholder:'发消息或创建任务，/ 调用指令' });
  ta.value = state.newDraft || '';
  ta.addEventListener('input', () => { state.newDraft = ta.value; sendBtn.disabled = !ta.value.trim(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });

  const ws = (state.workspaces || []).find(w => w.workspaceId === state.newWs);
  const wsChip = el('button', { class:'chip2', title:'选择工作区', onclick: () => {
    const items = (state.workspaces || []).map(w => ({
      label: w.title || w.path,
      sub: w.path && w.title ? w.path : '',
      icon: '📁',
      checked: w.workspaceId === state.newWs,
      run: () => { state.newWs = w.workspaceId; render(); },
    }));
    items.push({ label:'默认工作区', icon:'＋', checked: !state.newWs,
      run: () => { state.newWs = null; render(); } });
    items.push({ label:'新建工作区…', icon:'＋', run: async () => {
      await openWorkspacePicker(state.sessionCwd || '', async (path) => {
        const created = await createWorkspaceAt(path);
        if (!created || !created.workspaceId) return false;
        state.newWs = created.workspaceId; render();
        return true;
      });
    } });
    openSheet(items, '工作区');
  }}, el('span', { class:'ci', html:sheetIconSVG('folder') }),
    el('b', { text: (ws && (ws.title || ws.path)) || '默认工作区' }));

  // 模式：共享目录 / 隔离工作树（宿主 session/new 支持 isolate，和桌面「工作树隔离」同一个开关）
  const isoChip = el('button', { class:'chip2' + (state.newIsolate ? ' on' : ''), title:'新会话是否用独立工作树',
    onclick: () => { state.newIsolate = !state.newIsolate; render(); }},
    el('span', { class:'ci', html:sheetIconSVG('git') }),
    el('b', { text: state.newIsolate ? '隔离工作树' : '共享工作区' }));

  const sendBtn = el('button', { class:'send', text:'↑', title:'创建会话并发送', disabled: true,
    onclick: () => submit() });

  async function submit() {
    const text = (ta.value || '').trim();
    if (!text) { toast('先写点什么'); return; }
    if (sendBtn.disabled) return;
    sendBtn.disabled = true;
    try {
      const body = {};
      if (state.newWs) body.workspaceId = state.newWs;
      if (state.newIsolate) body.isolate = true;
      const r = await api('/api/mobile/v1/session/new', { method:'POST', body });
      await refreshAll(true);
      const found = state.sessions.find(s => s.sessionId === r.sessionId);
      state.newDraft = '';
      openSession(found || { sessionId: r.sessionId, title: '新会话', running: false });
      // 等会话页渲染出输入框，再把第一条塞进去发（send 是 renderSession 里的闭包，走 ui.send）
      await new Promise(res => setTimeout(res, 80));
      if (ui.ta && ui.send) { ui.ta.textContent = text; ui.syncInputButtons?.(); await ui.send(); }
      else toast('已建会话，但没能自动发出第一条，请手动粘贴');
    } catch (e) {
      toast('新建失败：' + (e.message || e));
      sendBtn.disabled = false;
    }
  }

  wrap.append(el('div', { class:'newpage' },
    el('div', { class:'newbox' },
      ta,
      el('div', { class:'newchips' }, wsChip, isoChip, el('span', { style:'flex:1' }), sendBtn),
      el('div', { class:'newhint', text: state.newIsolate
        ? '会在独立工作树里开会话，改完再合并；适合实验性改动'
        : '直接在当前工作区里开会话；⌘/Ctrl + Enter 也能发' }))));
  setTimeout(() => { try { ta.focus(); } catch {} }, 60);
}

// 兼容旧调用点（列表页＋、抽屉＋）：一律进新会话页，不再弹「选工作区」sheet

export { renderNewSession };
