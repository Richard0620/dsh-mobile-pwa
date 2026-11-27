
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function inlineMd(s){
  return esc(s)
    // 图片：http(s) 直接显示；dsh-local-image 走 /session/local-image 取字节（见 hydrateImages）
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
      if (/^https?:/i.test(url)) return `<img src="${url}" alt="${alt}" loading="lazy">`;
      const m = /^dsh-local-image:([^?)\s]+)/.exec(url);
      if (m) return `<img class="mdimg" data-lid="${m[1]}" alt="${alt}">`;
      return `<span class="imgph">🖼 ${alt || '图片'}</span>`;
    })
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}
// 极简代码高亮：单趟扫描字符串/注释/数字/关键字。
// 只对**确定认识的语言**上色，其余一律纯文本 —— 旧版对任何代码块都硬套一套
// JS 规则，YAML 的 `key: value`、JSX、PowerShell 的 `#` 变量都会串色。
// 能上的：js/ts/jsx/tsx、json、py、sh。别的（yaml、html、diff、无标注代码块）保持纯文本。

const KW = new Set(('const let var function return if else for while class import export from new await async try catch '
  + 'throw switch case break continue default typeof instanceof in of this null undefined true false def elif lambda '
  + 'pass with as None True False echo then fi do done esac local cd sudo rm cp mv grep cat curl git npm pnpm node').split(' '));

const HL_LANGS = {
  js:'js', javascript:'js', mjs:'js', cjs:'js', jsx:'js', ts:'js', typescript:'js', tsx:'js',
  json:'json', py:'py', python:'py', sh:'sh', bash:'sh', zsh:'sh', shell:'sh', console:'sh',
};

const hlFamily = (lang) => {
  const key = String(lang || '').trim().toLowerCase().replace(/^\./, '').split(/[\s,;]/)[0];
  return HL_LANGS[key] || '';
};

const HL_STR = '"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`';

const HL_TRIPLE = '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'';

const HL_NUM = '\\b\\d+(?:\\.\\d+)?\\b';

const HL_WORD = '[A-Za-z_$][\\w$-]*';

function hl(code, lang) {
  // 调用方明确给了语言（mdToHtml / 文件查看器）就按白名单；没有标注的代码块保持纯文本
  const family = hlFamily(lang);
  if (family === '') return esc(code);
  let src;
  if (family === 'py') src = `(${HL_TRIPLE}|${HL_STR})|(#[^\\n]*)|(${HL_NUM})|(${HL_WORD})`;
  else if (family === 'sh') src = `(${HL_STR})|(#[^\\n]*)|(${HL_NUM})|(${HL_WORD})`;
  else if (family === 'json') src = `(${HL_STR})|(${HL_NUM})|(${HL_WORD})`;
  else src = `(${HL_STR})|(//[^\\n]*|/\\*[\\s\\S]*?\\*/)|(${HL_NUM})|(${HL_WORD})`;
  const re = new RegExp(src, 'g');
  const numGroup = family === 'json' ? 2 : 3;
  const commentGroup = family === 'json' ? 0 : 2;
  const wordGroup = family === 'json' ? 3 : 4;
  const out = [];
  let last = 0, m;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(esc(code.slice(last, m.index)));
    if (m[1]) out.push(`<span class="s">${esc(m[1])}</span>`);
    else if (commentGroup && m[commentGroup]) out.push(`<span class="c">${esc(m[commentGroup])}</span>`);
    else if (m[numGroup]) out.push(`<span class="n">${esc(m[numGroup])}</span>`);
    else {
      const word = m[wordGroup] || '';
      out.push(KW.has(word) ? `<span class="k">${esc(word)}</span>` : esc(word));
    }
    last = re.lastIndex;
  }
  out.push(esc(code.slice(last)));
  return out.join('');
}


function mdToHtml(src){
  const lines = String(src || '').replace(/\r/g,'').split('\n');
  const out = [];
  let i = 0;
  const isList = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim();
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${hl(buf.join('\n'), lang)}</code></pre>`);
      continue;
    }
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i+1])) {
      const cells = r => r.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(cells(lines[i])); i++; }
      out.push('<div class="tbl"><table><thead><tr>' + head.map(h => `<th>${inlineMd(h)}</th>`).join('') +
        '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { const n = Math.min(4, h[1].length); out.push(`<h${n}>${inlineMd(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/,''));
      out.push('<blockquote>' + inlineMd(buf.join('\n')).replace(/\n/g,'<br>') + '</blockquote>');
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && isList(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/,''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(t => `<li>${inlineMd(t)}</li>`).join('') + `</${tag}>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^\s*```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])
      && !isList(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !lines[i].includes('|')) buf.push(lines[i++]);
    out.push('<p>' + inlineMd(buf.join('\n')).replace(/\n/g,'<br>') + '</p>');
  }
  return out.join('');
}

// ---------------------------------------------------------------- 状态

export { esc, hl, hlFamily, inlineMd, mdToHtml };
