import { state, ui } from '../core/state.js';
import { copyText, decorateCodeCopies, el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { saveDraft } from '../core/format.js';
import { hl, mdToHtml } from '../core/markdown.js';
import { rawText } from '../core/api.js';

async function openViewer(path, name) {
  const mask = el('div', { class:'viewer' });
  const title = el('b', { class:'vtitle', text: name || path });
  const meta = el('div', { class:'vmeta' });
  const pre = el('pre', { class:'vbody' });
  const isMd = /\.(md|markdown)$/i.test(name || path);
  const mdBody = el('div', { class:'vmd md' });
  let mdMode = isMd;
  const findbar = el('div', { class:'vfind' });
  let raw = '';
  let wrapOn = true;

  const close = () => mask.remove();
  const mdToggle = isMd ? el('button', { class:'vtool', text:'源码', onclick: () => {
    mdMode = !mdMode;
    syncView();
  } }) : null;
  function syncView() {
    pre.style.display = mdMode ? 'none' : '';
    mdBody.style.display = mdMode ? 'block' : 'none';
    if (mdToggle) {
      mdToggle.textContent = mdMode ? '源码' : '预览';
      mdToggle.classList.toggle('on', mdMode);
    }
    findbar.classList.remove('on');
  }
  const head = el('div', { class:'vhead' },
    el('button', { class:'ico', text:'‹', onclick: close }),
    title,
    el('span', { style:'flex:1' }) );

  const tools = el('div', { class:'vtools' },
    mdToggle,
    el('button', { class:'vtool on', text:'折行', onclick: (e) => {
      wrapOn = !wrapOn;
      e.target.classList.toggle('on', wrapOn);
      pre.classList.toggle('nowrap', !wrapOn);
    } }),
    el('button', { class:'vtool', text:'查找', onclick: () => {
      if (mdMode) { mdMode = false; syncView(); }
      findbar.classList.add('on');
      const inp = findbar.querySelector('input');
      if (inp) inp.focus();
    } }),
    el('button', { class:'vtool', text:'复制全文', onclick: async () => {
      if (await copyText(raw)) toast('已复制全文'); else toast('复制失败');
    } }));

  const foot = el('div', { class:'vfoot' },
    el('button', { class:'vgo', text:'引用到会话', onclick: () => {
      const ta = ui && ui.ta;
      if (!ta) { toast('要先进一个会话，才能引用文件'); return; }
      const ref = /\s/.test(path) ? `"${path}"` : path;
      const base = (ta.innerText || '').replace(/\u00a0/g, '');
      ta.textContent = (base.trim() ? base.replace(/\s*$/, '') + ' ' : '') + ref;
      try { saveDraft(state.sessionId, ta.textContent); } catch {}
      close();
      toast('已引用到输入框');
    }}));
  mask.append(head, meta, tools, findbar, pre, mdBody, foot);
  document.body.append(mask);

  try {
    raw = await rawText('/api/mobile/v1/file/read', { method:'POST', body: { path } });
  } catch (e) {
    pre.textContent = '读不出来：' + (e.message || e);
    return;
  }
  const ext = String(name || path).split('.').pop().toLowerCase();
  const metaText = `${path} · ${ext}${raw.length > 40000 ? ' · 已截断到 4 万字符' : ''}`;
  meta.textContent = metaText + (isMd ? ' · Markdown 预览' : '');
  const content = raw.length > 40000 ? raw.slice(0, 40000) : raw;
  if (isMd) {
    mdBody.innerHTML = mdToHtml(content);
    decorateCodeCopies(mdBody);
  }
  syncView();

  // 逐行渲染（带行号），行内做轻量高亮
  const lines = content.split('\n');
  const nodes = [];
  pre.replaceChildren();
  for (let i = 0; i < lines.length; i++) {
    const row = el('div', { class:'vline' });
    row.innerHTML = hl(lines[i], ext) || '&nbsp;';
    nodes.push(row);
    pre.append(row);
  }

  // 查找：匹配行高亮 + 上一个/下一个
  const inp = el('input', { placeholder:'查找内容' });
  const cnt = el('span', { class:'vcount' });
  const prev = el('button', { class:'vtool', text:'▲', onclick: () => jump(-1) });
  const next = el('button', { class:'vtool', text:'▼', onclick: () => jump(1) });
  findbar.append(inp, cnt, prev, next);
  let hits = [], at = -1;
  const jump = (dir) => {
    if (!hits.length) return;
    at = (at + dir + hits.length) % hits.length;
    hits.forEach(n => n.classList.remove('hit'));
    const n = hits[at];
    n.classList.add('hit');
    n.scrollIntoView({ block:'center', behavior:'smooth' });
    cnt.textContent = `${at + 1}/${hits.length}`;
  };
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    hits.forEach(n => n.classList.remove('hit'));
    hits = []; at = -1;
    if (!q) { cnt.textContent = ''; return; }
    lines.forEach((ln, i) => { if (ln.toLowerCase().includes(q)) hits.push(nodes[i]); });
    cnt.textContent = hits.length ? `0/${hits.length}` : '无匹配';
    if (hits.length) jump(1);
  });
}

export { openViewer };
