import { render } from '../core/bus.js';
import { LS } from '../core/config.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { fmtTime, plain } from '../core/format.js';
import { clearLocalCaches } from '../core/cache.js';
import { DOT_CLASS, STATE_LABEL, isUnread, sessionState } from '../core/badge.js';
import { installPullToRefresh } from '../core/gestures.js';
import { openSheet, sheetIconSVG } from '../components/sheet.js';
import { NAV_ICONS, connPill } from '../components/chrome.js';
import { openFileDrawer } from '../components/file-drawer.js';
import { openPushDiag, openPushSettings } from '../features/push.js';
import { buildSearchResults, hlText } from '../features/search.js';
import { loadTermAgents, renderTerminalTab, termAgents, termToken } from '../features/terminal.js';
import { loadArchived, newWorkspace, openAbout, openConnInfo, openNewSessionSheet, openRecovery, openSessionMenu, openStats, openWorkspaceMenu, reloadApp, unarchiveSession, workspaceOf } from '../features/session-actions.js';
import { openSession, refreshAll } from '../features/sync.js';

function renderList(wrap, opts = {}) {
  if (Date.now() - termAgents.at > 15000) loadTermAgents();
  const menu = el('button', { class:'ico', text:'☰', 'data-bell':'', onclick: () => openSheet([
    { label:'刷新', icon:'⟳', run: () => refreshAll(true) },
    { label:'新建工作区…', icon:'📁', run: newWorkspace },
    { label:'文件', icon:'📂', run: () => openFileDrawer(state.sessionCwd || '') },
    { label:'连接信息', icon:'⏱', run: openConnInfo },
    { label:'统计', icon:'📊', run: openStats },
    { label:'终端', icon:'⌘', run: () => { location.href = '/agents/'; } },
    { label:'关于', icon:'ⓘ', run: openAbout },
    { label:'通知提醒', icon:'🔔', run: openPushSettings },
    { label:'推送诊断', icon:'🩺', run: openPushDiag },
    { label:'重新加载', icon:'↻', run: reloadApp },
    { label:'恢复链接', icon:'🔗', run: openRecovery },
    { label:'退出登录', icon:'⏏', run: () => { clearLocalCaches(); state.token=''; state.view='list'; render(); } },
  ]) });
  const plus = el('button', { class:'ico', text:'＋', onclick: openNewSessionSheet });
  if (!opts.noHeader) {
    const sub = el('div', { class:'subrow' },
      el('div', { class:'sub', text: state.sessions.length + ' 个会话 · ' + state.workspaces.length + ' 个工作区' }));
    const stack = el('div', { class:'hero-stack' },
      el('div', { class:'hrow' }, el('h1', { text:'会话' }),
        el('div', { class:'acts' }, connPill(), plus, menu)),
      sub);
    wrap.append(el('div', { class:'hero' }, stack));
  }

  const main = el('main');
  // 「已归档」页的数据来自 archived=1；当前宿主只返回归档子集，
  // 老宿主返回全量，loadArchived() 会按「是否出现默认列表里的会话」判断并做差集兜底。
  const tabs = el('div', { class:'tabs' },
    el('b', { class: state.tab === 'all' ? 'on' : '', text:'全部会话', onclick: () => { state.tab = 'all'; if (state.searchQ) state.searchItems = buildSearchResults(state.searchQ.trim().toLowerCase()); render(); } }),
    el('b', { class: state.tab === 'archived' ? 'on' : '', text:'已归档', onclick: () => {
      state.tab = 'archived'; state.archived = null; state.searchItems = null; render(); loadArchived();
    } }),
    el('b', { class: state.tab === 'terminal' ? 'on' : '', text:'终端', onclick: () => {
      state.tab = 'terminal'; state.searchItems = null; render(); loadTermAgents();
    } }),
  );

  // 搜索：服务端内容检索在这个部署里是关闭的（openAt "never"），
  // 所以本地过滤标题 / 最近一条，并把范围扩到已缓存的消息正文（见 buildSearchResults）
  const searchInput = el('input', { type:'search', placeholder:'搜索标题或最近一条' });
  searchInput.value = state.searchQ || '';
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    state.searchQ = searchInput.value;
    state.searchItems = (q && state.tab === 'all') ? buildSearchResults(q) : null;
    render();
    const again = document.querySelector('.searchrow input');
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
  // 归档页不显示搜索框：本地搜索的数据源是 state.sessions（不含归档），
  // 摆在那里输入也搜不到东西（以前就是个死控件）
  const searchIco = el('span', { class:'sico', 'aria-hidden':'true',
    html:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' });
  main.append(el('div', { class:'searchrow' }, searchIco, searchInput));
  main.append(tabs);

  if (state.tab === 'terminal') {
    renderTerminalTab(main);
    wrap.append(main);
    return;
  }

  if (state.tab === 'archived') {
    const q = (state.searchQ || '').trim().toLowerCase();
    const raw = state.archived;
    const items = raw === null ? null : (q ? raw.filter(x => (x.title || '').toLowerCase().includes(q)) : raw);
    if (items === null) {
      main.append(el('div', { class:'empty', text:'加载中…' }));
    } else if (!items.length) {
      main.append(el('div', { class:'empty', text: state.archivedError || '没有归档的会话' }));
    } else {
      for (const s of items) {
        const row = el('div', { class:'row', onclick: () => openSession(s) },
          el('div', { class:'body' },
            el('div', { class:'t' },
              el('span', { class:'title', text: s.title || '(无标题)' }),
              el('span', { class:'time', text: fmtTime(s.updatedAt) }))),
          el('button', { class:'rowmore act', html: sheetIconSVG('back'), title:'取消归档', 'aria-label':'取消归档', onclick: (e) => {
            e.stopPropagation(); unarchiveSession(s);
          }}));
        main.append(row);
      }
    }
    wrap.append(main);
    return;
  }

  if (state.searchItems) {
    const q = (state.searchQ || '').trim();
    if (!state.searchItems.length) {
      main.append(el('div', { class:'empty' },
        el('div', { text: q ? `没有匹配「${q}」的会话` : '没有匹配的会话' }),
        el('button', { class:'btn', style:'margin-top:12px', text:'清除搜索', onclick: () => {
          state.searchQ = ''; state.searchItems = null; render();
        } })));
    }
    for (const r of state.searchItems) {
      main.append(el('div', { class:'sres', onclick: () => openSession(r.s) },
        el('div', { class:'st' }, hlText(r.s.title || '(无标题)', q)),
        r.snippet ? el('div', { class:'ss' }, hlText(r.snippet, q)) : null,
        el('div', { class:'smeta', text: r.meta })));
    }
    wrap.append(main);
    return;
  }

  if (!state.sessions.length) {
    main.append(el('div', { class:'empty', html:'还没有会话<br>下拉或点右上角刷新' }));
  }

  // 单行会话：列表分组与全局置顶共用（长按 / 桌面右键出会话菜单）
  // opts.hidePin：顶部「置顶」分组里不再重复画 📌（看分组头就知道）
  function sessionRow(s, opts = {}) {
    const more = el('button', { class:'rowmore', text:'⋯', onclick: (e) => {
      e.stopPropagation();
      openSessionMenu(s);
    }});
    const st = sessionState(s);
    const dotCls = DOT_CLASS[st] ? 'dot ' + DOT_CLASS[st] : 'dot';
    const row = el('div', { class: (st === 'pending' || isUnread(s)) ? 'row hot' : 'row', onclick: () => { if (row.__lp) { row.__lp = false; return; } openSession(s); } },
      el('span', { class: dotCls, title: STATE_LABEL[st] || '' }),
      el('div', { class:'body' },
        el('div', { class:'t' },
          s.pinned && !opts.hidePin ? el('span', { class:'pinmark', text:'📌' }) : null,
          el('div', { class:'tmain' },
            el('span', { class:'title', text: s.title || '(无标题)' }),
            opts.showWs ? el('span', { class:'wsmark', text: (workspaceOf(s.sessionId) || {}).title || '' }) : null),
          el('span', { class:'time', text: fmtTime(s.updatedAt) })),
        s.lastMessage && s.lastMessage.text ? el('div', { class:'p', text: plain(String(s.lastMessage.text)).replace(/\s+/g, ' ').trim() }) : null,
      ),
      more);
    // 长按（或桌面右键）出菜单：重命名 / 置顶
    let lp = null;
    const arm = () => { lp = setTimeout(() => { row.__lp = true; openSessionMenu(s); }, 480); };
    const disarm = () => { if (lp) { clearTimeout(lp); lp = null; } };
    row.addEventListener('touchstart', arm, { passive: true });
    row.addEventListener('touchend', disarm, { passive: true });
    row.addEventListener('touchmove', disarm, { passive: true });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); openSessionMenu(s); });
    return row;
  }

  // 全局置顶：跨工作区聚合到最上方；置顶会话不再在各自文件夹里重复出现
  // 顶部未读区：跨工作区把所有未读聚合一份，省得挨个文件夹翻
  const unreadItems = state.sessions.filter(isUnread)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (unreadItems.length) {
    const ubKey = 'unread:top';
    const ubClosed = state.collapsed.has(ubKey);
    const ubHead = el('div', { class: `ghead${ubClosed ? ' closed' : ''}`, onclick: () => {
      if (state.collapsed.has(ubKey)) state.collapsed.delete(ubKey); else state.collapsed.add(ubKey);
      localStorage.setItem(LS.collapsed, JSON.stringify([...state.collapsed]));
      render();
    }},
      el('span', { class:'chev', text:'▼' }),
      el('span', { class:'ubdot' }),
      el('span', { class:'gname', text:'未读' }),
      el('span', { class:'count', style:'margin-left:auto', text:String(unreadItems.length) }),
    );
    const ubBox = el('div', { class:'group' }, ubHead);
    if (!ubClosed) for (const s of unreadItems) ubBox.append(sessionRow(s, { hidePin:true, showWs:true }));
    main.append(ubBox);
  }
  const pinnedItems = state.sessions.filter(s => s.pinned)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (pinnedItems.length) {
    const pinKey = 'pin:global';
    const pinClosed = state.collapsed.has(pinKey);
    const pinHead = el('div', { class: `ghead${pinClosed ? ' closed' : ''}`, onclick: () => {
      if (state.collapsed.has(pinKey)) state.collapsed.delete(pinKey); else state.collapsed.add(pinKey);
      localStorage.setItem(LS.collapsed, JSON.stringify([...state.collapsed]));
      render();
    }},
      el('span', { class:'chev', text:'▼' }),
      el('span', { class:'fico', html:NAV_ICONS.pin }),
      el('span', { class:'gname', text:'置顶' }),
      el('span', { class:'count', style:'margin-left:auto', text: String(pinnedItems.length) }),
    );
    const pinBox = el('div', { class:'group' }, pinHead);
    if (!pinClosed) for (const s of pinnedItems) pinBox.append(sessionRow(s, { hidePin: true }));
    main.append(pinBox);
  }

  // 按工作区分组；不属于任何工作区的按 cwd 兜底。置顶会话在顶部聚合一份，
  // 同时仍保留在所属文件夹里——文件夹是找会话的主路径，不能因为置顶就消失。
  // 工作区先全部建组：即使一个会话都没有，文件夹也不会凭空消失。
  const groups = new Map();
  for (const w of state.workspaces) {
    groups.set(`w:${w.workspaceId}`, { key: `w:${w.workspaceId}`, name: w.title || w.path, path: w.path, git: w.git, items: [] });
  }
  for (const s of state.sessions) {
    const w = workspaceOf(s.sessionId);
    const key = w ? `w:${w.workspaceId}` : `c:${s.cwd || '(未登记)'}`;
    if (!groups.has(key)) {
      const name = w ? (w.title || w.path) : (s.cwd ? s.cwd.split(/[\\/]/).pop() : '(未登记目录)');
      groups.set(key, { key, name, path: w ? w.path : s.cwd, git: w && w.git, items: [] });
    }
    groups.get(key).items.push(s);
  }
  const order = [...state.workspaces.map(w => `w:${w.workspaceId}`), ...groups.keys()];
  const keys = [...new Set(order)].filter(k => groups.has(k));
  // 每个文件夹默认只露 5 条，其余点「显示更多」展开
  const PREVIEW_COUNT = 5;

  for (const k of keys) {
    const g = groups.get(k);
    const closed = state.collapsed.has(k);
    const head = el('div', { class: `ghead${closed ? ' closed' : ''}`, onclick: () => {
      if (state.collapsed.has(k)) state.collapsed.delete(k); else state.collapsed.add(k);
      localStorage.setItem(LS.collapsed, JSON.stringify([...state.collapsed]));
      render();
    }},
      el('span', { class:'chev', text:'▼' }),
      el('span', { class:'fico', html:NAV_ICONS.folder }),
      el('span', { class:'gname', text: g.name || '(未命名)' }),
      g.git && g.git.branch ? el('span', { class:'branch', text: g.git.branch }) : null,
      (() => {
        const u = g.items.filter(isUnread).length;
        return u ? el('span', { class:'ubadge', text: String(u) }) : null;
      })(),
      el('span', { class:'count', style:'margin-left:auto', text: String(g.items.length) }),
    );
    // 长按分组头 → 工作区菜单（重命名 / 删除 / 在此新建）
    let glp = null;
    head.addEventListener('touchstart', () => { glp = setTimeout(() => { glp = null; openWorkspaceMenu(g); }, 480); }, { passive: true });
    head.addEventListener('touchend', () => { if (glp) { clearTimeout(glp); glp = null; } }, { passive: true });
    head.addEventListener('touchmove', () => { if (glp) { clearTimeout(glp); glp = null; } }, { passive: true });
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); openWorkspaceMenu(g); });
    const box = el('div', { class:'group' }, head);
    if (!closed) {
      // 文件夹里置顶的排前面（与全局置顶区一致），其余按更新时间
      const sorted = g.items.slice().sort((a, b) =>
        ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || ((b.updatedAt || 0) - (a.updatedAt || 0)));
      const expanded = state.expandedGroups.has(k);
      const visible = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
      if (!sorted.length) box.append(el('div', { class:'ghint', text:'这个文件夹还没有会话' }));
      for (const s of visible) box.append(sessionRow(s));
      if (sorted.length > PREVIEW_COUNT) {
        box.append(el('button', { class:'showmore', onclick: () => {
          if (state.expandedGroups.has(k)) state.expandedGroups.delete(k);
          else state.expandedGroups.add(k);
          render();
        }}, expanded ? '收起' : `显示更多（还有 ${sorted.length - PREVIEW_COUNT} 条）`));
      }
    }
    main.append(box);
  }
  if (!opts.noPull) installPullToRefresh(main);
  wrap.append(main);
}

// ---------------------------------------------------------------- 会话详情
// 会话页的「增量渲染」骨架：header / 列表 / 卡片 / composer 各建一次，
// 之后只动列表和卡片，输入框不会因为来帧而重建（否则会丢焦点、丢输入）。

export { renderList };
