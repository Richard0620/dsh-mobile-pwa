import { openGit, openSession, paintSession, refreshAll, render } from '../core/bus.js';
import { APP_VERSION } from '../core/version.js';
import { FALLBACK_COMMANDS, LS, SKIN_KEY, THEME_KEY } from '../core/config.js';
import { state, ui } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { applySkin, applyTheme } from '../core/theme.js';
import { saveListCache } from '../core/cache.js';
import { api } from '../core/api.js';
import { setNetMode } from '../core/net.js';
import { openSheet } from '../components/sheet.js';
import { openInfoBox } from '../components/chrome.js';
import { openFileDrawer, samePath } from '../components/file-drawer.js';

function workspaceOf(sessionId) {
  for (const w of state.workspaces) {
    if (Array.isArray(w.sessionIds) && w.sessionIds.includes(sessionId)) return w;
  }
  return null;
}

// 新建会话：先选工作区（AI-HUB 的新会话页也是这个模型），再让宿主建
// ---------------- 新会话页：大输入框 + 工作区/模式 chips，写完直接发第一条 ----------------

function openNewSession() {
  state.view = 'new';
  state.newDraft = '';
  state.newIsolate = !!state.newIsolate;
  if (state.newWs === undefined) state.newWs = null;
  render();
}


function openNewSessionSheet() {
  openNewSession();
}


async function newSessionInNewWorkspace() {
  await openWorkspacePicker(state.sessionCwd || '', async (path) => {
    const ws = await createWorkspaceAt(path);
    if (!ws || !ws.workspaceId) return false;   // createWorkspaceAt 已经提示过原因
    await createSession(ws.workspaceId);
    return true;
  });
}


async function createSession(workspaceId) {
  try {
    const r = await api('/api/mobile/v1/session/new', {
      method: 'POST',
      body: workspaceId ? { workspaceId } : {},
    });
    await refreshAll(true);
    const found = state.sessions.find(s => s.sessionId === r.sessionId);
    openSession(found || { sessionId: r.sessionId, title: '新会话', running: false });
  } catch (e) {
    toast('新建失败：' + (e.message || e));
  }
}

// 会话长按菜单：重命名 / 置顶

function openSessionMenu(s) {
  openSheet([
    { label:'重命名', icon:'✎', run: () => renameSession(s) },
    s.pinned
      ? { label:'取消置顶', icon:'📌', run: () => unpinSession(s) }
      : { label:'置顶会话', icon:'📌', run: () => pinSession(s) },
    { label:'归档会话', icon:'🗄', run: () => archiveSession(s) },
    { label:'打开', icon:'›', run: () => openSession(s) },
  ], s.title || '(无标题)');
}


async function unpinSession(s) {
  const was = s.pinned;
  s.pinned = false;
  render();
  try {
    await api('/api/mobile/v1/workspace/unpin-session', { method:'POST', body: { sessionId: s.sessionId } });
    await refreshAll(true);
    toast('已取消置顶');
  } catch (e) {
    s.pinned = was;
    render();
    toast('取消置顶失败：' + (e.message || e));
  }
}


async function archiveSession(s) {
  if (!confirm(`归档「${s.title || '这个会话'}」？\n会从列表里移除，日志保留。`)) return;
  try {
    await api('/api/mobile/v1/workspace/archive-session', { method:'POST', body: { sessionId: s.sessionId } });
    await refreshAll(true);
  } catch (e) { toast('归档失败：' + (e.message || e)); }
}


async function renameSession(s) {
  const next = prompt('新的会话标题', s.title || '');
  if (next === null) return;
  const title = next.trim();
  if (!title) return;
  try {
    await api('/api/mobile/v1/session/rename', { method:'POST', body: { sessionId: s.sessionId, title } });
    await refreshAll(true);
  } catch (e) { toast('重命名失败：' + (e.message || e)); }
}


async function pinSession(s) {
  const w = workspaceOf(s.sessionId);
  const was = s.pinned;
  s.pinned = true;
  render();
  try {
    await api('/api/mobile/v1/workspace/pin-session', { method:'POST', body: {
      sessionId: s.sessionId, ...(w ? { workspaceId: w.workspaceId } : {}),
    }});
    await refreshAll(true);
  } catch (e) {
    s.pinned = was;
    render();
    toast('置顶失败：' + (e.message || e));
  }
}

// 工作区操作：重命名 / 删除 / 在此新建会话（长按分组头触发）

function openWorkspaceMenu(g) {
  const w = state.workspaces.find(x => `w:${x.workspaceId}` === g.key) || null;
  const items = [];
  if (w) {
    items.push({ label:'在此新建会话', icon:'＋', run: () => createSession(w.workspaceId) });
    if (w.git && w.git.isRepo) {
      items.push({ label:'Git 概览', icon:'⑂', run: () => openGit(w.workspaceId, w.title) });
    }
    items.push({ label:'浏览文件', icon:'📂', run: () => openFileDrawer(w.path) });
    items.push({ label:'重命名工作区', icon:'✎', run: async () => {
      const t = prompt('工作区名称', w.title || w.path);
      if (t === null || !t.trim()) return;
      try {
        await api('/api/mobile/v1/workspace/rename', { method:'POST', body: { workspaceId: w.workspaceId, title: t.trim() } });
        await refreshAll(true);
      } catch (e) { toast('重命名失败：' + (e.message || e)); }
    } });
    items.push({ label:'删除工作区', icon:'🗑', run: async () => {
      if (!confirm(`删除工作区「${w.title || w.path}」？\n目录和会话日志会保留，只是从列表里移除。`)) return;
      try {
        await api('/api/mobile/v1/workspace/delete', { method:'POST', body: { workspaceId: w.workspaceId } });
        await refreshAll(true);
      } catch (e) { toast('删除失败：' + (e.message || e)); }
    } });
  } else if (g.path) {
    items.push({ label:'把此目录加为工作区', icon:'＋', run: async () => {
      try {
        await api('/api/mobile/v1/workspace/create', { method:'POST', body: { path: g.path } });
        await refreshAll(true);
      } catch (e) { toast('添加失败：' + (e.message || e)); }
    } });
  }
  if (items.length) openSheet(items, g.name || '工作区');
}

// 新建工作区 = 在电脑的目录树里「点进去选」，不是让手机键盘敲一条绝对路径。
// 起始目录优先当前会话所在目录（最常加的往往就是它旁边），否则由宿主回主目录。

async function newWorkspace() {
  await openWorkspacePicker(state.sessionCwd || '');
}

// 选目录的公共入口：onPick 不给就是普通「加为工作区」；给了就让调用方接手后续
// （例如在选中的目录里开新会话）。onPick 返回 false 时选择器不关，方便重选。

async function openWorkspacePicker(start, onPick) {
  let roots = [];
  try { roots = await loadRoots(); } catch {}
  await openFileDrawer(start || state.sessionCwd || '', {
    pick: true, roots, onPick: typeof onPick === 'function' ? onPick : null,
  });
}

// 盘符/挂载卷清单：宿主主目录永远在 C 盘（macOS 在 /Users/…），没有这一层就跨不到别的盘。
// 只成功一次就记住；失败也不挡路——目录树本身还能用，只是少了盘符入口。

async function loadRoots() {
  if (Array.isArray(state.roots)) return state.roots;
  try {
    const r = await api('/api/mobile/v1/directory/roots');
    state.roots = (r.roots || []).filter(x => x && typeof x.path === 'string' && x.path);
  } catch { state.roots = []; }
  return state.roots;
}

// 把目录采纳成工作区；成功（含「已经在列表里」）返回工作区项，失败返回 null。

async function createWorkspaceAt(path) {
  const t = String(path || '').trim();
  // 盘符根 "D:\" 去掉尾部分隔符会变成没有意义的 "D:"，单独保住。
  const target = /^[A-Za-z]:[\\/]$/.test(t) ? t : t.replace(/[\\/]+$/, '');
  if (!target) { toast('路径是空的'); return null; }
  try {
    const r = await api('/api/mobile/v1/workspace/create', { method:'POST', body: { path: target } });
    let ws = r.workspace || null;
    await refreshAll(true);
    if (!ws) ws = (state.workspaces || []).find(w => samePath(w.path, target)) || null;
    toast(r.created ? '已添加工作区：' + target : '这个目录已经在列表里了');
    return ws;
  } catch (e) { toast('添加失败：' + (e.message || e)); return null; }
}

// 连接信息：延迟 + 中转健康
// 连接信息就是「设置 → 连接」那一页：诊断数据和连接方式放同一处，
// 用同一套 groupcard/srow 样式（以前这里是个临时 sheet，和新设计规范不一致）

function openConnInfo() {
  state.view = 'sub'; state.subPage = 'conn'; render();
}

// 文件读取：这个接口直接回原文，不是 JSON 信封，所以单独走 raw

async function ensureCommands() {
  if (state.commands && state.commands.length) return state.commands;
  try {
    const r = await api('/api/mobile/v1/commands?sessionId=' + encodeURIComponent(state.sessionId));
    state.commands = (r.items && r.items.length) ? r.items : FALLBACK_COMMANDS;
  } catch {
    state.commands = FALLBACK_COMMANDS;
  }
  return state.commands;
}

// ---------------- 关于 / 设置 ----------------
// ---------------- Web Push（通知提醒） ----------------

function openSkinSheet() {
  const cur = (() => { try { return localStorage.getItem(SKIN_KEY) || 'paper'; } catch { return 'paper'; } })();
  const mark = k => cur === k ? '✓ ' : '';
  // 「皮肤」= 配色家族（纸面 / 碳黑）；「主题」才是跟随系统/浅色/深色。
  // 两处都叫「跟随系统」会让人分不清，这里改成「自动」并用副标题说明规律。
  openSheet([
    { label: mark('auto') + '自动', sub:'跟随系统明暗：浅色用纸面，深色用碳黑', icon:'🌓', run: () => { applySkin('auto'); toast('皮肤：跟随系统'); } },
    { label: mark('paper') + '纸面', sub:'浅色纸张', icon:'☀️', run: () => { applySkin('paper'); toast('皮肤：纸面'); } },
    { label: mark('carbon') + '碳黑', sub:'深色碳灰', icon:'🌙', run: () => { applySkin('carbon'); toast('皮肤：碳黑'); } },
  ], '皮肤');
}


function openThemeSheet() {
  const cur = (() => { try { return localStorage.getItem(THEME_KEY) || ''; } catch { return ''; } })();
  const mark = k => cur === k ? '✓ ' : '';
  openSheet([
    { label: mark('') + '跟随系统', icon:'🌓', run: () => { applyTheme(''); toast('主题：跟随系统'); } },
    { label: mark('light') + '浅色', icon:'☀️', run: () => { applyTheme('light'); toast('主题：浅色'); } },
    { label: mark('dark') + '深色', icon:'🌙', run: () => { applyTheme('dark'); toast('主题：深色'); } },
  ], '主题');
}

// 版本自检：本地 APP_VERSION / SW 缓存 vs 线上 /VERSION（Caddy 静态目录里那份）

async function openVersionCheck() {
  const rows = [['本地 APP', APP_VERSION]];
  try {
    const sw = await fetch('./sw.js', { cache:'no-store' }).then(r => r.text());
    const m = /const CACHE = '([^']+)'/.exec(sw);
    rows.push(['本地 SW 缓存', m ? m[1] : '?']);
  } catch { rows.push(['本地 SW 缓存', '读不到']); }
  try {
    const r = await fetch('./VERSION', { cache:'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    // dev-proxy 没有 VERSION 时会 SPA 兜底回 index.html，不能把 HTML 当版本戳解析
    if (txt.trim().startsWith('<')) throw new Error('不是 VERSION 文件（本地开发正常）');
    const appM = /^app=(v\d+)/m.exec(txt);
    if (!appM) throw new Error('VERSION 内容不合法');
    const app = appM[1];
    const swv = (/^sw=([^\n]+)/m.exec(txt) || [])[1] || '?';
    const commit = (/^commit=([^\n]+)/m.exec(txt) || [])[1] || '?';
    rows.push(['线上 VERSION', `${app} / ${swv} / ${commit}`]);
    rows.push(['是否一致', app === APP_VERSION ? '✅ 一致' : `⚠️ 本地 ${APP_VERSION}，线上 ${app}`]);
  } catch (e) {
    rows.push(['线上 VERSION', '读不到：' + (e.message || e)]);
  }
  openInfoBox('版本自检', rows);
}


async function openAbout() {
  let devices = '';
  try {
    const r = await api('/api/mobile/v1/paired-devices');
    const n = (r.devices || r.items || []).length;
    if (n) devices = ` · ${n} 台设备`;
  } catch {}
  const host = location.host;
  const inst = (state.instanceId || '').slice(0, 8);
  const chan = state.netInfo && state.netInfo.channel === 'lan'
    ? `局域网${state.netInfo.ms ? ' ' + state.netInfo.ms + 'ms' : ''}`
    : '中转';
  openSheet([
    { label:'连接方式', icon:'⇄', run: openConnectionSheet },
    { label:'皮肤', icon:'◐', run: openSkinSheet },
    { label:'主题', icon:'🎨', run: openThemeSheet },
    { label:'版本自检', icon:'🩺', run: openVersionCheck },
    { label:'通知提醒', icon:'🔔', run: openPushSettings },
    { label:'推送诊断', icon:'🩺', run: openPushDiag },
    { label:'重新加载', icon:'↻', run: reloadApp },
    { label:'恢复链接', icon:'🔗', run: openRecovery },
    { label:'清除缓存并重载', icon:'🧹', run: async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      } catch {}
      location.reload();
    } },
    { label:'退出登录', icon:'⏏', run: () => { clearLocalCaches(); state.token=''; state.view='list'; render(); } },
  ], `${APP_VERSION} · ${chan} · 宿主 ${inst || '?'}${devices}\n${state.apiBase || host}`);
}

// 连接方式面板：当前通道 + 自动/仅中转/仅局域网三档 + 手填局域网入口

function openConnectionSheet() {
  const info = state.netInfo || {};
  const label = state.mode === 'auto' ? '自动' : state.mode === 'lan' ? '仅局域网' : '仅中转';
  const cur = info.channel === 'lan' ? `局域网${info.ms ? ' · ' + info.ms + 'ms' : ''}` : '中转（公网）';
  const probe = info.at
    ? `${new Date(info.at).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })} · ${info.error ? '不可用：' + info.error : '正常'}`
    : '还没探测';
  const inputStyle = 'width:100%;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 11px;font-size:14px;margin-top:6px';
  const nameIn = el('input', { value: state.lanName || '', placeholder:'laptop-oc45injj.local（lan-server 启动时会打印）',
    autocapitalize:'off', autocorrect:'off', spellcheck:'false', style: inputStyle });
  const addr = el('input', { value: state.lanBase || '', placeholder:'https://192.168.1.23:8443（留空 = 自动发现）',
    autocapitalize:'off', autocorrect:'off', spellcheck:'false', style: inputStyle });
  const port = el('input', { value: state.lanPort || '8443', inputmode:'numeric', placeholder:'8443', style: inputStyle });
  const save = el('button', { class:'btn', style:'margin-top:10px', onclick: () => {
    state.lanPort = String(port.value || '8443').trim();
    try { localStorage.setItem(LS.lanPort, state.lanPort); } catch {}
    state.lanName = String(nameIn.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    try { localStorage.setItem(LS.lanName, state.lanName); } catch {}
    setNetMode(state.mode, addr.value);
    try { document.querySelector('.mask')?.remove(); } catch {}
    toast('已保存，正在重新探测');
  } }, '保存并重新探测');
  const extra = el('div', { style:'padding:2px 6px 0' },
    el('div', { style:'font-size:12px;color:var(--dim);margin-top:10px;line-height:1.6', text:'稳定名字（换 Wi-Fi、换路由器都不用改，推荐）' }),
    nameIn,
    el('div', { style:'font-size:12px;color:var(--dim);margin-top:10px;line-height:1.6', text:'局域网入口（必须是 https；上面填了名字这里可以留空）' }),
    addr,
    el('div', { style:'font-size:12px;color:var(--dim);margin-top:10px', text:'局域网端口（lan-server 监听的那个，默认 8443）' }),
    port,
    save,
    el('div', { style:'font-size:11.5px;color:var(--dim);margin-top:8px;line-height:1.6',
      text:'自动档：每次打开、回到前台、以及每分钟探一次 —— 通了就切局域网，断了自动回中转。' }),
  );
  openInfoBox(`连接方式 · ${label}`, [
    ['当前通道', cur],
    ['请求发往', state.apiBase || `${location.origin}（同源中转）`],
    ['稳定名字', state.lanName || '（未设置，靠 IP 候选）'],
    ['上次探测', probe],
  ], [
    { label:'自动', run: () => setNetMode('auto') },
    { label:'仅中转', run: () => setNetMode('relay') },
    { label:'仅局域网', run: () => setNetMode('lan') },
  ], extra);
}

// ---------------- 通用信息面板（label/value 两列） ----------------

function openStats() {
  state.view = 'sub'; state.subPage = 'stats'; render();
}

// ---------------- Git 概览 ----------------

async function unarchiveSession(s) {
  try {
    await api('/api/mobile/v1/workspace/unarchive-session', { method:'POST', body: { sessionId: s.sessionId } });
    state.archived = (state.archived || []).filter(x => x.sessionId !== s.sessionId);
    render();
    refreshAll(true);
    toast('已取消归档');
  } catch (e) { toast('取消归档失败：' + (e.message || e)); }
}

// 归档列表：新版宿主（含当前版本 sessions.js）对 archived=1 只返回已归档子集，直接用；
// 旧版宿主会返回全量，这时用「全量 − 默认列表」做差集兜底。
// 判据：返回里出现了默认列表中的会话 → 说明它给的是全量。
// 两边都带 fresh=1，避免 30 秒缓存让差集把「刚取消归档的」又算回归档里。

async function loadArchived() {
  const tok = state.token;
  try {
    const [all, act] = await Promise.all([
      api('/api/mobile/v1/sessions?archived=1&fresh=1'),
      api('/api/mobile/v1/sessions?fresh=1'),
    ]);
    if (state.token !== tok) return;   // 退登/换账号后回来的旧响应：别写进新账号的列表和缓存
    const allItems = Array.isArray(all.items) ? all.items : [];
    const gotActive = Array.isArray(act.items);
    const activeItems = gotActive ? act.items : [];
    const activeIds = new Set(activeItems.map(x => x.sessionId));
    const looksFullList = allItems.some(x => activeIds.has(x.sessionId));
    state.archived = looksFullList ? allItems.filter(x => !activeIds.has(x.sessionId)) : allItems;
    state.archivedError = '';
    // 顺带把列表数据对齐（取消归档 / 在别处归档后），但不重绘当前归档视图
    if (gotActive) { state.sessions = activeItems; saveListCache(activeItems); }
  } catch (e) {
    state.archived = [];
    state.archivedError = '取归档列表失败：' + (e.message || e);
  }
  if (state.view === 'list' && state.tab === 'archived') render();
}

// terminal group (herdr bridge)

async function forkSessionAt(m, atSeq) {
  const ok = confirm('从这条消息分叉出一个新会话？\n原会话不受影响，新会话保留到这条为止的上下文。');
  if (!ok) return;
  try {
    const r = await api('/api/mobile/v1/session/fork', { method:'POST', body: {
      sessionId: state.sessionId, atSeq, increaseTitle: true,
    }});
    await refreshAll(true);
    const newId = r.sessionId || (r.session && r.session.sessionId);
    toast('已创建分支会话');
    if (newId) {
      const s = state.sessions.find(x => x.sessionId === newId) || { sessionId: newId, title: r.title || '分支会话' };
      openSession(s);
    }
  } catch (e) { toast('分叉失败：' + (e.message || e)); }
}


function openRecovery() {
  const link = `${location.origin}${location.pathname}#token=${encodeURIComponent(state.token)}`
    + (state.instanceId ? `&inst=${encodeURIComponent(state.instanceId)}` : '');
  const ta = el('textarea', { class:'rec', readonly:'readonly' });
  ta.value = link;
  const tip = el('div', { class:'cmeta', style:'margin-top:8px;line-height:1.6', html:
    '存到备忘录 / 密码管理器里。<br>以后图标被删、清了网站数据，点这条链接就直接登录，<b>不用配对码</b>。<br>⚠️ 它等于你的钥匙，别转发给别人；丢了的设备可以在电脑端吊销。' });
  const copy = el('button', { class:'btn primary', style:'margin-top:0', text:'复制链接', onclick: async () => {
    try { await navigator.clipboard.writeText(link); copy.textContent = '已复制 ✓'; }
    catch { ta.select(); document.execCommand('copy'); copy.textContent = '已复制 ✓'; }
    setTimeout(() => { copy.textContent = '复制链接'; }, 1600);
  }});
  const mask = el('div', { class:'mask', onclick: e => { if (e.target === mask) mask.remove(); } });
  const sheet = el('div', { class:'sheet' },
    el('div', { style:'font-size:13px;color:var(--dim);padding:0 6px 8px', text:'恢复链接（免配对码登录）' }),
    ta, tip,
    el('div', { class:'acts', style:'margin-top:10px' }, copy),
    el('div', { class:'cancel', text:'关闭', onclick: () => mask.remove() }),
  );
  mask.append(sheet);
  document.body.append(mask);
  setTimeout(() => ta.select(), 100);
}

// 重新加载整页（顺带让 SW 检查一次更新）——独立 PWA 没有浏览器刷新按钮，只能靠这个

async function reloadApp() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {}
  setTimeout(() => location.reload(), 60);
}

// 下拉刷新：PWA 独立模式下浏览器不给，只能自己实现

async function loadModel() {
  try {
    const r = await api(`/api/mobile/v1/session/models?sessionId=${encodeURIComponent(state.sessionId)}`);
    state.modelGroups = r.groups || [];
    state.modelMeta = r.current || null;
    let label = null;
    const cur = r.current;
    if (cur) {
      const grp = state.modelGroups.find(g => g.id === cur.provider);
      const mm = grp && (grp.models || []).find(x => x.id === cur.model);
      label = (mm && (mm.name || mm.id)) || cur.model;
      if (cur.reasoningEffort) label += ` · ${cur.reasoningEffort}`;
    }
    state.model = label;
    if (ui.modelEl) {
      const b = ui.modelEl.querySelector('b');
      if (b) b.textContent = String(label || '模型').split(' · ')[0].replace(/^DeepSeek[- ]?/i, '');
    }
    if (ui.effortEl) ui.effortEl.textContent = (cur && cur.reasoningEffort) || '推理';
  } catch {}
}

// 模型 + 推理等级选择器（两步：先选模型，再选推理强度）

function openModelPicker() {
  const groups = state.modelGroups || [];
  if (!groups.length) { toast('这个会话拿不到模型列表'); return; }
  const cur = state.modelMeta || null;
  const items = [];
  for (const g of groups) {
    for (const m of (g.models || [])) {
      const isCur = !!(cur && cur.provider === g.id && cur.model === m.id);
      // 同一模型在两个来源下会重复出现：副标题写清来源，当前项打勾，避免「四个一样的选项」
      const sub = [g.name || g.id, isCur && cur.reasoningEffort ? cur.reasoningEffort : '']
        .filter(Boolean).join(' · ');
      items.push({
        label: m.name || m.id,
        sub,
        icon: '◈',
        checked: isCur,
        run: () => pickEffort(g.id, m),
      });
    }
  }
  openSheet(items, `模型 · 当前 ${state.model || '?'}`);
}


function pickEffort(provider, m) {
  const efforts = (m.reasoning && m.reasoning.efforts) || [];
  if (!efforts.length) return applyModel(provider, m.id);
  openSheet(efforts.map(e => ({
    label: `${e.name || e.id}${e.description ? ' · ' + e.description.slice(0, 24) : ''}`,
    icon: '·',
    run: () => applyModel(provider, m.id, e.id),
  })), `推理等级 · ${m.name || m.id}`);
}


async function applyModel(provider, model, reasoningEffort) {
  try {
    await api('/api/mobile/v1/session/select-model', { method:'POST', body: {
      sessionId: state.sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}),
    }});
    await loadModel();
    if (state.view === 'session') paintSession();
  } catch (e) { toast('切换模型失败：' + (e.message || e)); }
}


export { createWorkspaceAt, ensureCommands, forkSessionAt, loadArchived, loadModel, loadRoots, newWorkspace, openAbout, openConnInfo, openConnectionSheet, openModelPicker, openNewSessionSheet, openRecovery, openSessionMenu, openSkinSheet, openStats, openThemeSheet, openVersionCheck, openWorkspaceMenu, openWorkspacePicker, reloadApp, unarchiveSession, workspaceOf };
