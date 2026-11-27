import { render } from '../core/bus.js';
import { state, ui } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { saveDraft } from '../core/format.js';
import { api, rawText } from '../core/api.js';
import { sheetIconSVG } from '../components/sheet.js';
import { heroBackHeader } from '../components/chrome.js';
import { downloadHostFile, openHostPath } from '../features/media.js';
import { loadRoots, workspaceOf } from '../features/session-actions.js';

async function openFiles(path) {
  state.view = 'files';
  state.filesPath = path || '';
  render();
  await loadFiles(state.filesPath);
}


async function loadFiles(path) {
  try {
    const r = await api('/api/mobile/v1/directory/listing?path=' + encodeURIComponent(path || ''));
    state.filesListing = r.listing || null;
    state.filesPath = (r.listing && r.listing.path) || path;
  } catch (e) {
    state.filesListing = null;
    state.filesError = String(e.message || e);
  }
  if (state.view === 'files') render();
}


function renderFiles(wrap) {
  const back = state.sessionId ? el('button', { class:'ico', html:sheetIconSVG('chevronLeft'), title:'返回会话', 'aria-label':'返回会话', onclick: () => {
    state.view = 'session'; render();
  }}) : null;
  const selBtn = el('button', { class:'ico', text: state.filesSelecting ? '取消' : '选择',
    style:'width:auto;padding:0 8px;font-size:12.5px;font-weight:600', onclick: () => {
      state.filesSelecting = !state.filesSelecting;
      if (!state.filesSelecting) state.filesSel.clear();
      render();
    }});
  const L = state.filesListing;
  const entriesAll = L ? (L.entries || []).filter(e => !e.hidden || state.showHidden) : [];
  const dirsAll = entriesAll.filter(e => e.kind === 'folder');
  const filesAll = entriesAll.filter(e => e.kind !== 'folder');
  const wsName = (() => {
    const w = workspaceOf(state.sessionId);
    if (w) return w.title || w.path;
    const p = String(state.sessionCwd || '');
    return p ? p.split(/[\\/]/).filter(Boolean).pop() : '';
  })();
  const sub = L ? `${dirsAll.length} 个文件夹 · ${filesAll.length} 个文件` : '加载中…';
  wrap.append(heroBackHeader('文件', (wsName ? wsName + ' · ' : '') + sub, back,
    el('div', { style:'display:flex;gap:2px;align-items:center' }, selBtn)));

  // 盘符 / 根目录切换（Windows 上就是 C: / D: / 主目录）
  const rootRow = el('div', { class:'rootrow' });
  const rootsNow = state.roots;
  if (Array.isArray(rootsNow) && rootsNow.length) {
    const curPath = String((L && L.path) || state.filesPath || '').replace(/[\\/]+$/, '');
    const norm = (x) => String(x || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    for (const r of rootsNow) {
      const on = norm(curPath) === norm(r.path) || norm(curPath).startsWith(norm(r.path) + '/');
      rootRow.append(el('span', { class:'rootchip' + (on ? ' on' : ''), text: r.name || r.path,
        onclick: () => loadFiles(r.path) }));
    }
  } else if (rootsNow === null) {
    loadRoots().then(() => { if (state.view === 'files') render(); }).catch(() => {});
  }
  if (rootRow.children.length) wrap.append(rootRow);

  const crumbs = el('div', { class:'crumbrow' });
  const cr = (L && L.crumbs) || [];
  cr.forEach((c, i) => {
    if (i) crumbs.append(el('span', { class:'crumbsep', text:'/' }));
    crumbs.append(el('span', { class:'crumbchip' + (i === cr.length - 1 ? ' on' : ''), text: c.name,
      onclick: () => loadFiles(c.path) }));
  });
  if (cr.length) wrap.append(crumbs);

  const main = el('div', { class:'fbody2' });
  if (!L) {
    main.append(el('div', { class:'empty', text: state.filesError || '加载中…' }));
    wrap.append(main);
    return;
  }

  const extOf = (name) => {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return ext && ext !== String(name).toLowerCase() ? ext.slice(0, 4).toUpperCase() : 'FILE';
  };
  const stamp = (t) => {
    if (!t) return '';
    const d = new Date(t); const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const row = (e, isDir) => {
    const sel = state.filesSel.has(e.path);
    return el('div', { class:'flrow' + (sel ? ' sel' : ''), onclick: () => {
      if (state.filesSelecting) {
        if (state.filesSel.has(e.path)) state.filesSel.delete(e.path); else state.filesSel.add(e.path);
        render();
        return;
      }
      if (isDir) loadFiles(e.path); else openHostPath(e.path, e.name);
    }},
      state.filesSelecting ? el('span', { class:'fselbox', text:'✓' }) : null,
      el('div', { class:'ftile' + (isDir ? ' dir' : '') }, el('span', { text: isDir ? 'DIR' : extOf(e.name) })),
      el('div', { class:'fname2' },
        el('b', { text: e.name }),
        el('span', { text: stamp(e.modified) || (isDir ? '文件夹' : '文件') })),
      state.filesSelecting ? null
        : isDir ? el('span', { class:'chev', text:'›' })
        : el('button', { class:'fdl', title:'存到手机', 'aria-label':'存到手机',
            html: sheetIconSVG('download'),
            onclick: (ev) => { ev.stopPropagation(); downloadHostFile(e.path, e.name); } }));
  };

  if (dirsAll.length) {
    main.append(el('div', { class:'fsect' }, el('b', { text:'文件夹' }), el('span', { text:String(dirsAll.length) })));
    for (const e of dirsAll) main.append(row(e, true));
  }
  if (filesAll.length) {
    main.append(el('div', { class:'fsect' }, el('b', { text:'文件' }), el('span', { text:String(filesAll.length) })));
    for (const e of filesAll) main.append(row(e, false));
  }
  if (!entriesAll.length) main.append(el('div', { class:'empty', text:'空目录' }));
  main.append(el('button', { class:'showhidden', text: state.showHidden ? '隐藏隐藏文件' : '显示隐藏文件',
    onclick: () => { state.showHidden = !state.showHidden; render(); } }));
  wrap.append(main);

  if (state.filesSelecting) {
    const paths = [...state.filesSel];
    wrap.append(el('div', { class:'fselbar' },
      el('span', { class:'t', text: paths.length ? `已选 ${paths.length} 个` : '选择要引用的文件' }),
      el('button', { text:'引用到会话', onclick: () => {
        if (!paths.length) { toast('先选几个文件'); return; }
        const ta = ui && ui.ta;
        if (!ta) { toast('要先进一个会话，才能把文件引用进去'); return; }
        const base = (ta.innerText || '').replace(/\u00a0/g, '');
        const refs = paths.map(p => (/\s/.test(p) ? `"${p}"` : p)).join(' ').trim();
        if (!refs) { toast('先选文件或文件夹'); return; }
        ta.textContent = (base.trim() ? base.replace(/\s*$/, '') + ' ' : '') + refs;
        try { saveDraft(state.sessionId, ta.textContent); } catch {}
        state.filesSelecting = false; state.filesSel.clear();
        toast(`已引用 ${paths.length} 个文件`);
        render();
      }})));
  }
}

async function previewFile(path, name) {
  const mask = el('div', { class:'mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
  const box = el('div', { class:'sheet', style:'max-height:80vh;overflow:auto' },
    el('div', { style:'font-size:13px;color:var(--dim);padding:0 6px 8px', text: name || path }));
  const pre = el('pre', { class:'filepv', text:'加载中…' });
  box.append(pre, el('div', { class:'acts' }, el('button', { class:'btn', onclick: () => mask.remove() }, '关闭')));
  mask.append(box);
  document.body.append(mask);
  try {
    const text = await rawText('/api/mobile/v1/file/read', { method:'POST', body: { path } });
    pre.textContent = text.length > 40000 ? text.slice(0, 40000) + '\n\n…（已截断）' : text;
  } catch (e) {
    pre.textContent = '读不出来：' + (e.message || e);
  }
}

// ---------------- 右侧文件面板（对齐 AI-HUB） ----------------

export { loadFiles, renderFiles };
