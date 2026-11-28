import { LS, MIME_BY_EXT, VIDEO_EXT } from './config.js';

const fmtMsgTime = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return hm;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}/${md} ${hm}`;
};

// 时间分隔改成「按天」：长会话里每 10 分钟一条太密，一天一条就够。
// 精确时间放到 title 上（桌面悬停），手机点一下分隔条用 toast 显示。

const dayKeyOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const fmtDayLabel = (ts) => {
  const d = new Date(ts);
  const now = new Date();
  if (dayKeyOf(ts) === dayKeyOf(now.getTime())) return '今天';
  if (dayKeyOf(ts) === dayKeyOf(now.getTime() - 86400000)) return '昨天';
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
};

const fmtExactTime = (ts) => {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ---- legacy 路径：限额（120 条 / 10 会话）与体积兜底都不动 ----

const getDrafts = () => { try { return JSON.parse(localStorage.getItem(LS.draft) || '{}'); } catch { return {}; } };

const saveDraft = (sid, text) => {
  if (!sid) return;
  const d = getDrafts();
  if (text && text.trim()) d[sid] = text.slice(0, 4000); else delete d[sid];
  const keys = Object.keys(d);
  if (keys.length > 40) for (const k of keys.slice(0, keys.length - 40)) delete d[k];
  try { localStorage.setItem(LS.draft, JSON.stringify(d)); } catch {}
};

const fmtTime = ms => {  if (!ms) return '';
  const d = new Date(ms), diff = (Date.now() - d.getTime())/1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff/60)} 分钟前`;
  if (diff < 86400) return d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'});
};

// 列表预览：把 markdown 压成纯文本（app 的列表预览也是纯文本）

const plain = s => String(s || '')
  .replace(/```[\s\S]*?```/g, ' [代码] ')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s{0,3}#{1,6}\s*/gm, '')
  .replace(/[*_~]/g, '')
  .replace(/\|/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// ---------------------------------------------------------------- markdown（内联极简渲染器：离线可用，只支持常见语法）

const fmtTok = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0);

const fmtDur = ms => {
  const m = Math.round((ms || 0) / 60000);
  if (m < 60) return m + ' 分';
  const h = Math.floor(m / 60);
  return h + ' 时 ' + (m % 60) + ' 分';
};

// ---------------- 统计 ----------------
// 统计也走「设置 → 统计」子页（同一套分组卡片），不再弹临时 sheet

const isVideoName = (name) => VIDEO_EXT.test(String(name || ''));

const isVideoFile = (a) => /^video\//i.test((a && a.mediaType) || '') || isVideoName(a && a.name);
// 从消息正文里拆出「已上传视频/文件」那几行，渲染成文件卡片

const fmtBytes = n => n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(1) + 'KB' : (n / 1048576).toFixed(1) + 'MB';
// Blob 一定要带类型：不带的话 blob: URL 是没有 MIME 的，<embed type=application/pdf>
// 或 <video> 会把它当纯文本渲染 —— 之前 PDF 显示成一屏源码就是这个原因

function mimeOfName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'application/octet-stream';
}

// 把取回的字节交给手机。
// 关键：iOS Safari **不支持** `blob:` + `<a download>`（点了什么都不发生），
// 必须走系统分享（存储到「文件」）或在新标签里打开。桌面/安卓的 <a download> 照旧。

export { dayKeyOf, fmtBytes, fmtDayLabel, fmtDur, fmtExactTime, fmtMsgTime, fmtTime, fmtTok, getDrafts, isVideoFile, isVideoName, mimeOfName, plain, saveDraft };
