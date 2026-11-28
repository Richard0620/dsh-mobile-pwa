import { state } from '../core/state.js';
import { plain } from '../core/format.js';
import { readMsgCache } from '../core/cache.js';

function cachedMessageHits(sessionId, q) {
  const c = readMsgCache(sessionId);
  if (!c || !Array.isArray(c.messages)) return [];
  const hits = [];
  for (const m of c.messages) {
    const text = String((m && m.text) || '');
    if (!text) continue;
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) continue;
    hits.push({ role: m.role, text, idx });
  }
  return hits;
}

function snippetAround(text, idx, q) {
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + q.length + 46);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}

function buildSearchResults(q) {
  const out = [];
  for (const s of state.sessions) {
    const titleHit = String(s.title || '').toLowerCase().includes(q);
    const prevRaw = String((s.lastMessage && s.lastMessage.text) || '');
    const prevPlain = plain(prevRaw);
    const prevIdx = prevPlain.toLowerCase().indexOf(q);
    const hits = cachedMessageHits(s.sessionId, q);
    if (!titleHit && prevIdx < 0 && !hits.length) continue;
    const first = hits[0];
    let snippet = '', meta = '';
    if (first) {
      snippet = `${first.role === 'user' ? '我' : '助手'}：${snippetAround(first.text, first.idx, q)}`;
      meta = hits.length > 1 ? `缓存消息命中 ${hits.length} 条` : '缓存消息命中';
    } else if (prevIdx >= 0) {
      snippet = snippetAround(prevPlain, prevIdx, q);
      meta = '最近一条命中';
    } else {
      snippet = plain(prevRaw);
      meta = '标题命中';
    }
    out.push({ s, snippet, meta, hits: hits.length, titleHit });
  }
  // 标题命中的排前面，其次正文命中条数多的，最后按更新时间
  out.sort((a, b) => (Number(b.titleHit) - Number(a.titleHit))
    || (b.hits - a.hits)
    || ((b.s.updatedAt || 0) - (a.s.updatedAt || 0)));
  return out.slice(0, 40);
}

// 搜索命中高亮：用 textContent 拼节点，不拼 HTML，天然免疫转义问题

function hlText(text, q) {
  const s = String(text == null ? '' : text);
  const needle = String(q || '').trim();
  const frag = document.createDocumentFragment();
  if (!needle) { frag.append(s); return frag; }
  const lower = s.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  while (true) {
    const at = lower.indexOf(n, i);
    if (at < 0) { frag.append(s.slice(i)); break; }
    if (at > i) frag.append(s.slice(i, at));
    const m = document.createElement('mark');
    m.className = 'hl';
    m.textContent = s.slice(at, at + needle.length);
    frag.append(m);
    i = at + needle.length;
  }
  return frag;
}


export { buildSearchResults, hlText, snippetAround };
