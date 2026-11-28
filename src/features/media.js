import { IMG_EXT, PDF_EXT, TEXTY_EXT, isIOS } from '../core/config.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { toast } from '../core/toast.js';
import { fmtBytes, isVideoName, mimeOfName } from '../core/format.js';
import { api, apiUrl } from '../core/api.js';
import { openSheet, sheetIconSVG } from '../components/sheet.js';
import { openImageFromNode } from '../components/image-viewer.js';
import { openViewer } from '../components/viewer.js';
import { openFileDrawer } from '../components/file-drawer.js';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// 非图片附件（视频/文件）落到会话工作区的 _uploads/ 下：
//   1) 只有工作区里的文件，宿主才允许 session/file 读回来 → 手机上才能播放/保存；
//   2) 也顺手让 agent 能直接读，不用再给一个收件箱里的绝对路径。
// 目录不存在就先建（directory/create = 宿主 createDirectory，参数是「父目录 + 新目录名」）。

let uploadDirCache = { cwd: '', dir: '' };

async function ensureUploadDir() {
  const cwd = String(state.sessionCwd || '');
  if (!cwd) return '';
  if (uploadDirCache.cwd === cwd) return uploadDirCache.dir;
  const dir = cwd.replace(/[\\/]+$/, '') + '\\_uploads';
  try { await api('/api/mobile/v1/directory/create', { method:'POST', body: { path: cwd, name: '_uploads' } }); } catch {}
  uploadDirCache = { cwd, dir };
  return dir;
}


async function uploadFile(file, onProgress) {
  const isImg = /^image\//i.test(file.type || '');
  const destPath = isImg ? '' : await ensureUploadDir();
  const begin = await api('/api/mobile/v1/upload/begin', { method:'POST', body: {
    name: file.name, size: file.size,
    ...(destPath ? { destPath, sessionId: state.sessionId } : {}),
  }});
  const uploadId = begin.uploadId;
  // 分片大小：宿主会同时给「起步值」和「上限」。视频动辄几十上百 MB，按起步值 256KB 一片
  // 等于上千次请求，走中转时用户要等几分钟；直接爬到 2MB 一片能把请求数压到 1/8。
  const start = Math.max(64 * 1024, Number(begin.chunkSize) || 262144);
  const cap = Math.max(start, Number(begin.maxChunkSize) || start);
  const chunkSize = Math.min(cap, Math.max(start, 2 * 1024 * 1024));
  const total = Math.max(1, Math.ceil(file.size / chunkSize));
  for (let i = 0; i < total; i++) {
    const blob = file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize));
    const data = await blobToBase64(blob);
    await api('/api/mobile/v1/upload/chunk', { method:'POST', body: { uploadId, index: i, data } });
    onProgress?.(i + 1, total, file);
  }
  const fin = await api('/api/mobile/v1/upload/finish', { method:'POST', body: { uploadId } });
  return { uploadId, path: fin.path, name: fin.name || file.name };
}

// 视频附件：/session/send 只收 text / image 块，视频只能「上传 + 把路径写进正文」。
// 拿不到可播放的文件流，所以不做内嵌播放，但至少要在气泡里标清楚它是视频文件，
// 别让人以为那是一张裂图（以前缩略图拿 <img> 显示 video 的 objectURL，就是裂的）。

function splitAttachmentNotes(text) {
  const kept = [];
  const files = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    const m = /^(?:🎬\s*已上传视频|📎\s*已上传文件)[：:]\s*(.+)$/.exec(t);
    if (m && m[1]) { files.push(m[1].trim()); continue; }
    // 别的客户端（AI-HUB）用的是 `@"绝对路径"` 这种引用形式；同一个文件在消息里
    // 也该是一张文件卡，而不是一段没人看得懂的路径文本
    const ref = /^@(?:"([^"]+)"|(\S+))$/.exec(t);
    if (ref) {
      const p = (ref[1] || ref[2] || '').trim();
      if (/[\\/]/.test(p) && /\.[A-Za-z0-9]{2,6}$/.test(p)) { files.push(p); continue; }
    }
    kept.push(line);
  }
  // 行内的引用（别的客户端会把 `@"绝对路径"` 和正文放在同一段里）：
  // 全局扫一遍，命中就抽出来当文件，正文里留一个空格
  let out = kept.join('\n');
  const quoted = /@"([^"\n]+)"/g;
  out = out.replace(quoted, (whole, p) => {
    const path = String(p).trim();
    if (/[\\/]/.test(path) && /\.[A-Za-z0-9]{2,6}$/.test(path)) { files.push(path); return ' '; }
    return whole;
  });
  return { text: out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), files };
}
// 宿主文件走 POST + 分片接口（/session/file），<video> / <a download> 没法直接吃 URL，
// 所以按 4MB 分片取回来拼成 Blob，再交给播放器或下载。

async function fetchHostFile(path, onProgress, apiPath = '/api/mobile/v1/session/file') {
  // 宿主对分段有硬约束：必须是正整数、不超过 2MiB（且非尾段要 64KiB 对齐）
  const CHUNK = 2 * 1024 * 1024;
  let total = 0;
  try { const st = await api('/api/mobile/v1/file/stat', { method:'POST', body: { path } }); total = Number(st.size) || 0; } catch {}
  const parts = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(apiUrl(apiPath), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
        ...(state.instanceId ? { 'x-dsh-instance': state.instanceId } : {}),
      },
      // /session/file 只认会话工作区；/file/read 认整片允许区（工作区 ∪ 项目），
      // 文件浏览器用它——两个接口的分段规则是同一套
      body: JSON.stringify({ sessionId: state.sessionId, path, offset, length: CHUNK }),
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch {}
      throw new Error(msg);
    }
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) break;
    parts.push(buf);
    offset += buf.byteLength;
    onProgress && onProgress(offset, total);
    if (buf.byteLength < CHUNK) break;
    if (total && offset >= total) break;
  }
  return new Blob(parts, { type: mimeOfName(path) });
}

// 按扩展名分派：能当文本看的 / 图片 / PDF / 其它二进制

async function saveBlobToPhone(blob, label) {
  const url = URL.createObjectURL(blob);
  const size = fmtBytes(blob.size);
  if (isIOS()) {
    let file = null;
    try { file = new File([blob], label, { type: blob.type || 'application/octet-stream' }); } catch {}
    const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    const items = [];
    if (canShare) items.push({ label:'存储到「文件」/ 分享', icon:'⤓', run: async () => {
      try { await navigator.share({ files: [file], title: label }); }
      catch (e) { if (String(e && e.name) !== 'AbortError') toast('分享失败：' + String(e.message || e)); }
    } });
    items.push({ label:'在浏览器打开（可再分享保存）', icon:'🌐', run: () => {
      const a = el('a', { href:url, target:'_blank', rel:'noopener' });
      document.body.append(a); a.click(); a.remove();
    } });
    openSheet(items, `已取回 ${label} · ${size}`);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    return;
  }
  const a = el('a', { href:url, download:label, style:'display:none' });
  document.body.append(a);
  a.click();
  setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch {} }, 60_000);
  toast(`已保存 ${label}（${size}）`);
}

// 文件浏览器 → 存到手机

async function downloadHostFile(path, name) {
  const label = name || String(path).split(/[\\/]/).pop() || '文件';
  toast(`正在取回 ${label}…`);
  try {
    const blob = await fetchHostFile(path, (done, total) => {
      if (!total) return;
      const pct = Math.min(99, Math.round((done / total) * 100));
      toast(`正在取回 ${label} · ${pct}%`);
    }, '/api/mobile/v1/file/read');
    await saveBlobToPhone(blob, label);
  } catch (e) {
    toast('下载失败：' + String(e.message || e));
  }
}

// PDF / 图片：取回后直接看，不用先下载再找。
// iOS 的 Safari 内嵌 PDF 只显示第一页，所以额外给「在浏览器打开」。

async function openHostMedia(path, name) {
  const label = name || String(path).split(/[\\/]/).pop() || '文件';
  const isPdf = PDF_EXT.test(label);
  const mask = el('div', { class:'viewer' });
  let url = null;
  const status = el('div', { class:'vmeta', text: `正在取回 ${label}…` });
  // 媒体区吃满剩余高度：不再给底部按钮留一条空白
  const body = el('div', { class:'vbody media' });
  const close = () => { try { if (url) URL.revokeObjectURL(url); } catch {} mask.remove(); };
  const iconBtn = (icon, title, run) => el('button', { class:'ico', title, 'aria-label':title,
    html: sheetIconSVG(icon), onclick: run });
  const saveBtn = iconBtn('download', '存到手机', async () => {
    try { const blob = await fetchHostFile(path, null, '/api/mobile/v1/file/read'); await saveBlobToPhone(blob, label); }
    catch (e) { toast('失败：' + String(e.message || e)); }
  });
  // 打开按钮一开始就放右上角（PDF 在 iOS 上内嵌可能只显示第一页，用户随时能出去看）
  const openBtn = iconBtn('openExternal', '在浏览器打开', () => {
    if (!url) { toast('还没取回完'); return; }
    const a = el('a', { href:url, target:'_blank', rel:'noopener' });
    document.body.append(a); a.click(); a.remove();
  });
  mask.append(
    el('div', { class:'vhead' },
      el('button', { class:'ico', html:sheetIconSVG('chevronLeft'), title:'返回', 'aria-label':'返回', onclick: close }),
      el('b', { class:'vtitle', text:label }),
      openBtn, saveBtn),
    status, body);
  document.body.append(mask);
  try {
    const blob = await fetchHostFile(path, (done, total) => {
      if (total) status.textContent = `正在取回 ${label} · ${Math.min(99, Math.round((done / total) * 100))}%`;
    }, '/api/mobile/v1/file/read');
    url = URL.createObjectURL(blob);
    status.textContent = `${fmtBytes(blob.size)}${isPdf ? ' · PDF' : ''}`;
    if (isPdf) body.append(el('embed', { src:url, type:'application/pdf' }));
    else body.append(el('img', { src:url, alt:label }));
  } catch (e) {
    status.textContent = '打不开：' + String(e.message || e);
  }
}

// 统一入口：文本进查看器，PDF/图片进媒体预览，其它二进制走下载

function openHostPath(path, name) {
  const label = name || String(path).split(/[\\/]/).pop() || '文件';
  if (TEXTY_EXT.test(label)) return openViewer(path, label);
  if (PDF_EXT.test(label) || IMG_EXT.test(label)) return openHostMedia(path, label);
  return downloadHostFile(path, label);
}

// 文件卡 → 在 App 内播放/保存：视频直接 <video controls>，其它文件给「保存到手机」

async function openHostFile(path, name) {
  const isVid = isVideoName(name);
  const label = name || String(path).split(/[\\/]/).pop() || '文件';
  const mask = el('div', { class:'viewer' });
  let url = null;
  const status = el('div', { class:'vmeta', text: isVid ? '正在取回视频…' : '正在取回文件…' });
  const body = el('div', { class:'vbody media' });
  const close = () => { try { if (url) URL.revokeObjectURL(url); } catch {} mask.remove(); };
  const saveBtn = el('button', { class:'ico', title:'存到手机', 'aria-label':'存到手机',
    html: sheetIconSVG('download'), onclick: async () => {
      try { const blob = await fetchHostFile(path, null); await saveBlobToPhone(blob, label); }
      catch (e) { toast('失败：' + String(e.message || e)); }
    }});
  mask.append(
    el('div', { class:'vhead' },
      el('button', { class:'ico', html:sheetIconSVG('chevronLeft'), title:'返回', 'aria-label':'返回', onclick: close }),
      el('b', { class:'vtitle', text:label }), saveBtn),
    status, body);
  document.body.append(mask);
  try {
    const blob = await fetchHostFile(path, (done, total) => {
      const mb = (done / 1048576).toFixed(1);
      status.textContent = total
        ? `正在取回 ${mb} / ${(total / 1048576).toFixed(1)} MB`
        : `已取回 ${mb} MB`;
    });
    url = URL.createObjectURL(blob);
    status.textContent = fmtBytes(blob.size);
    if (isVid) {
      const v = el('video', { controls:'', playsinline:'', autoplay:'' });
      v.src = url;
      body.append(v);
    } else {
      const a = el('a', { class:'btn primary', href:url, download:label, text:'保存到手机' });
      body.append(a);
    }
  } catch (e) {
    status.textContent = '打不开：' + String(e.message || e);
  }
}


function openFileCard(path, isVideo) {
  const name = String(path).split(/[\\/]/).pop();
  const dir = String(path).replace(/[\\/][^\\/]+$/, '');
  openSheet([
    { label: isVideo ? '在 App 内播放' : '保存到手机', icon:'▶', run: () => openHostFile(path, name) },
    { label:'复制路径', icon:'⧉', run: async () => {
      try { await navigator.clipboard.writeText(path); toast('已复制路径'); }
      catch { toast('复制失败，长按消息复制'); }
    } },
    { label:'打开所在目录', icon:'📂', run: () => openFileDrawer(dir) },
  ], `${isVideo ? '🎬 视频文件' : '📎 文件'} · ${name}（作为路径发送）`);
}

// 附件图（消息里 type:'image' 的块）：POST /session/attachment 取 base64

const attCache = new Map();

async function hydrateAttachments(rootEl) {
  for (const node of [...rootEl.querySelectorAll('img[data-att]')]) {
    const id = node.dataset.att;
    if (!id || node.dataset.loaded) continue;
    node.dataset.loaded = '1';
    try {
      let url = attCache.get(id);
      if (!url) {
        const r = await api('/api/mobile/v1/session/attachment', { method:'POST', body: { sessionId: state.sessionId, attachmentId: id } });
        // mediaType 在顶层（实测），兼容两种形状
        const mt = r.mediaType || (r.attachment && r.attachment.mediaType) || 'image/jpeg';
        url = `data:${mt};base64,${r.data}`;
        attCache.set(id, url);
      }
      node.src = url;
      node.addEventListener('click', () => openImageFromNode(node));
    } catch {
      node.replaceWith(el('span', { class:'imgph', text:'🖼 图片已不可读' }));
    }
  }
}

// 运行计时：只在客户端亲眼看到「这一轮开始」时计时；
// 打开页面时已经在跑的会话不计时（没有起点，从 0 起算反而误导）

export { downloadHostFile, hydrateAttachments, openFileCard, openHostPath, splitAttachmentNotes, uploadFile };
