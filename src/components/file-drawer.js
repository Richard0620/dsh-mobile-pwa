import { createWorkspaceAt, downloadHostFile, openHostPath, paint } from '../core/bus.js';
import { state, ui } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { saveDraft } from '../core/format.js';
import { api } from '../core/api.js';
import { sheetIconSVG } from './sheet.js';

async function fetchListing(path) {
  const r = await api('/api/mobile/v1/directory/listing?path=' + encodeURIComponent(path || ''));
  return r.listing || null;
}

/** 两个目录路径是否同一层：Windows 不区分大小写，尾部分隔符不算差异。 */

function samePath(a, b) {
  const norm = (x) => String(x || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}


function closeRPanel() {
  const m = document.querySelector('.rpanel-mask');
  if (!m) return;
  m.classList.remove('on');
  setTimeout(() => m.remove(), 220);
}


const fileIcon = (kind, name) => {
  if (kind === 'folder') return '📁';
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼';
  if (['zip', 'gz', '7z', 'rar'].includes(ext)) return '🗜';
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  return '📄';
};


async function openFileDrawer(path, opts = {}) {
  closeRPanel();
  const pick = !!opts.pick;                       // 工作区选择模式：只列目录，底部给「用这个文件夹」
  const roots = Array.isArray(opts.roots) ? opts.roots : [];
  const mask = el('div', { class:'rpanel-mask', onclick: (e) => { if (e.target === mask) closeRPanel(); } });
  const panel = el('div', { class:'rpanel' });
  const st = { path: path || state.sessionCwd || '', listing: null, filter: '', showHidden: false, err: '',
    sort: 'name', selecting: false, selected: new Set() };
  const body = el('div', { class:'rpbody' });

  const nav = async (p) => {
    st.err = '';
    st.filter = '';   // 换一层目录时旧的筛选词会把新目录过滤成「空」
    try { st.listing = await fetchListing(p); st.path = (st.listing && st.listing.path) || p; }
    catch (e) { st.listing = null; st.err = '打不开这个目录：' + (e.message || e); }
    paint();
  };

  const head = el('div', { class:'drhead' },
    el('button', { class:'ico', text: pick ? '✕' : '‹', onclick: closeRPanel }),
    el('b', { text: pick ? '选择工作区目录' : '目录' }),
    el('span', { style:'flex:1' }),
  );

  // 选择模式：完整路径与盘符固定在列表上方，滚动时不会跟着跑掉
  const pickbar = el('div', { class:'rpickbar' });
  function paintPickbar() {
    if (!pick) return;
    pickbar.replaceChildren(el('div', { class:'rppath', text: '当前目录：' + (st.path || '…') }));
    const bar = el('div', { class:'rproots' });
    const chip = (name, target, on) => el('span', { class:'rproot' + (on ? ' on' : ''), text: name,
      onclick: target ? () => nav(target) : null });
    const L = st.listing;
    if (L && L.home) bar.append(chip('主目录', L.home, samePath(st.path, L.home)));
    if (roots.length > 1) {
      for (const r of roots) bar.append(chip(r.name, r.path, samePath(st.path, r.path)));
    }
    if (bar.children.length) pickbar.append(bar);
  }

  function paint() {
    body.replaceChildren();
    if (pick) paintPickbar();
    if (st.err) { body.append(el('div', { class:'empty', text: st.err })); return; }
    const L = st.listing;
    if (!L) { body.append(el('div', { class:'empty', text:'加载中…' })); return; }
    const filter = el('input', { class:'rpfilter', placeholder:'输入名称筛选这一层', value: st.filter });
    filter.addEventListener('input', () => { st.filter = filter.value; paintList(); });
    const crumbs = el('div', { class:'crumbs' });
    for (const c of (L.crumbs || [])) {
      crumbs.append(el('span', { class:'crumb', text: c.name, onclick: () => nav(c.path) }));
    }
    const counts = el('div', { class:'rpcount' });
    const listBox = el('div', { class:'rplist' });
    body.append(filter, crumbs, counts, listBox);

    function paintList() {
      const q = st.filter.trim().toLowerCase();
      const all = (L.entries || []).filter(e => st.showHidden || !e.hidden);
      const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
      const byTime = (a, b) => (b.modified || 0) - (a.modified || 0);
      const dirs = all.filter(e => e.kind === 'folder' && e.name.toLowerCase().includes(q)).sort(byName);
      const files = pick ? [] : all.filter(e => e.kind !== 'folder' && e.name.toLowerCase().includes(q))
        .sort(st.sort === 'time' ? byTime : byName);
      counts.replaceChildren(
        el('span', { text: pick ? `${dirs.length} 个文件夹` : `${dirs.length} 个文件夹 · ${files.length} 个文件` }),
        el('span', { style:'flex:1' }),
        ...(pick ? [] : [
          el('button', { class:'ico', text: st.sort === 'time' ? '🕒' : '⇅',
            title: st.sort === 'time' ? '按修改时间排序' : '按名称排序',
            onclick: () => { st.sort = st.sort === 'time' ? 'name' : 'time'; paintList(); } }),
          el('button', { class:'ico', text: st.selecting ? '☑' : '☐', title:'多选引用',
            onclick: () => { st.selecting = !st.selecting; if (!st.selecting) st.selected.clear(); paintList(); paintFoot(); } }),
        ]),
        el('button', { class:'ico', text:'⟳', title:'刷新', onclick: () => nav(st.path) }),
      );
      listBox.replaceChildren();
      const rowOf = (e, isDir) => {
        const sel = st.selected.has(e.path);
        return el('div', { class:'frow' + (sel ? ' sel' : ''), onclick: () => {
          if (st.selecting) {
            if (st.selected.has(e.path)) st.selected.delete(e.path); else st.selected.add(e.path);
            paintList(); paintFoot();
            return;
          }
          if (isDir) nav(e.path); else openHostPath(e.path, e.name);
        }},
          el('span', { class:'fico' + (isDir ? ' dir' : ''), html: st.selecting ? sheetIconSVG(sel ? 'check' : 'box') : sheetIconSVG(isDir ? 'folder' : 'file') }),
          el('span', { class:'fname', text: e.name }),
          st.selecting ? null
            : isDir ? el('span', { class:'chev', text:'›' })
            : el('button', { class:'fdl', title:'存到手机', 'aria-label':'存到手机', html: sheetIconSVG('download'),
                onclick: (ev) => { ev.stopPropagation(); downloadHostFile(e.path, e.name); } }));
      };
      for (const e of dirs) listBox.append(rowOf(e, true));
      if (files.length) listBox.append(el('div', { class:'rpsect', text:'文件' }));
      for (const e of files) listBox.append(rowOf(e, false));
      if (!dirs.length && !files.length) listBox.append(el('div', { class:'empty', text:'这一层是空的' }));
    }
    paintList();
  }

  // 底部操作栏：平时是上传/新建/隐藏；多选模式下变成「引用到对话」
  const foot = el('div', { class:'drfoot' });

  function applyRefs() {
    const paths = [...st.selected];
    if (!paths.length) { toast('先选几个文件'); return; }
    const ta = ui && ui.ta;
    if (!ta) { toast('不在会话里，没法引用'); return; }
    const base = (ta.innerText || '').replace(/\u00a0/g, '');
    const refs = paths.map(p => (/\s/.test(p) ? `"${p}"` : p)).join(' ');
    ta.textContent = (base.trim() ? base.replace(/\s*$/, '') + ' ' : '') + refs;
    try { saveDraft(state.sessionId, ta.textContent); } catch {}
    ta.focus();
    closeRPanel();
    toast(`已引用 ${paths.length} 个文件`);
  }

  function paintFoot() {
    foot.replaceChildren();
    if (pick) {
      const mkdir = async () => {
        const name = prompt('新文件夹名字');
        if (!name || !name.trim()) return;
        try {
          await api('/api/mobile/v1/directory/create', { method:'POST', body: { path: st.path, name: name.trim() } });
          nav(st.path);
        } catch (e) { toast('新建失败：' + (e.message || e)); }
      };
      const manual = async () => {
        const typed = prompt('电脑上的绝对路径（例如 D:\\Vibe\\项目）', st.path || '');
        if (typed === null || !typed.trim()) return;
        const p = typed.trim();
        if (typeof opts.onPick === 'function') { if (await opts.onPick(p) !== false) closeRPanel(); return; }
        if (await createWorkspaceAt(p)) closeRPanel();
      };
      foot.append(
        el('button', { class:'drbtn', style:'color:#fff;background:var(--accent);border-color:var(--accent);'
            + 'font-size:13px;padding:8px 14px', onclick: async () => {
          if (!st.path) { toast('还没进到目录里'); return; }
          if (typeof opts.onPick === 'function') { const keep = await opts.onPick(st.path); if (keep !== false) closeRPanel(); return; }
          if (await createWorkspaceAt(st.path)) closeRPanel();
        } }, el('span', { class:'bi', html: sheetIconSVG('check') }), '用这个文件夹'),
        el('button', { class:'drbtn', onclick: mkdir }, el('span', { class:'bi', html: sheetIconSVG('folder') }), '新建文件夹'),
        el('button', { class:'drbtn', onclick: () => { st.showHidden = !st.showHidden; nav(st.path); } }, el('span', { class:'bi', html: sheetIconSVG('eye') }), '隐藏文件'),
        el('button', { class:'drbtn', onclick: manual }, el('span', { class:'bi', html: sheetIconSVG('file') }), '手输路径'),
      );
      return;
    }
    if (st.selecting) {
      foot.append(
        el('button', { class:'drbtn', onclick: () => { st.selecting = false; st.selected.clear(); paint(); } }, '取消'),
        el('span', { class:'drbtn', style:'opacity:.75;pointer-events:none', text:`已选 ${st.selected.size}` }),
        el('button', { class:'drbtn', style: st.selected.size
            ? 'color:#fff;background:var(--accent);border-color:var(--accent)'
            : 'opacity:.5',
          onclick: () => { if (st.selected.size) applyRefs(); } }, '引用到对话'),
      );
      return;
    }
    foot.append(
      el('button', { class:'drbtn', onclick: () => pickUploadToDir(st.path, () => nav(st.path)) }, el('span', { class:'bi', html: sheetIconSVG('upload') }), '上传'),
      el('button', { class:'drbtn', onclick: async () => {
        const name = prompt('新文件夹名字');
        if (!name || !name.trim()) return;
        try {
          await api('/api/mobile/v1/directory/create', { method:'POST', body: { path: st.path, name: name.trim() } });
          nav(st.path);
        } catch (e) { toast('新建失败：' + (e.message || e)); }
      } }, el('span', { class:'bi', html: sheetIconSVG('folder') }), '新建文件夹'),
      el('button', { class:'drbtn', onclick: () => { st.showHidden = !st.showHidden; nav(st.path); } }, el('span', { class:'bi', html: sheetIconSVG('eye') }), '隐藏文件'),
    );
  }
  paintFoot();

  panel.append(head, ...(pick ? [pickbar] : []), body, foot);
  // 面板内右滑关闭
  let rx = 0, ry = 0, drag = false;
  panel.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    rx = e.touches[0].clientX; ry = e.touches[0].clientY; drag = true;
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (!drag) return;
    drag = false;
    const t = e.changedTouches[0];
    if (t.clientX - rx > 60 && Math.abs(t.clientY - ry) < 60) closeRPanel();
  }, { passive: true });
  mask.append(panel);
  document.body.append(mask);
  requestAnimationFrame(() => mask.classList.add('on'));
  await nav(st.path);
}


// 上传（该接口只能写 UTF-8 文本，二进制会被拒绝）

function pickUploadToDir(dir, done) {
  const inp = el('input', { type:'file', style:'display:none' });
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (!f) return;
    const textExt = /\.(md|txt|json|js|mjs|ts|tsx|jsx|css|html|yml|yaml|sh|ps1|py|ini|conf|csv|log|xml|env)$/i;
    if (!textExt.test(f.name) && !(f.type || '').startsWith('text/')) {
      toast('这个接口只能往目录里写文本文件（md/txt/json/代码等），二进制不支持');
      return;
    }
    try {
      const content = await f.text();
      const target = dir.replace(/[\\/]+$/, '') + '\\' + f.name;
      await api('/api/mobile/v1/file/create', { method:'POST', body: { path: target, content, overwrite: false } });
      toast('已上传：' + f.name);
      done && done();
    } catch (e) {
      const msg = String(e.message || e);
      toast(msg.includes('file-exists') ? '同名文件已存在' : ('上传失败：' + msg));
    }
  });
  document.body.append(inp);
  inp.click();
}

// ---------------- 全屏文件查看器 ----------------

export { openFileDrawer, samePath };
