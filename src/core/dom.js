import { render, toast } from './bus.js';
import { state } from './state.js';

const $ = (s, el=document) => el.querySelector(s);

const el = (tag, props={}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};

const root = typeof document !== 'undefined' ? $('#root') : null;

function showFatal(e) {
  try {
    root.replaceChildren();
    const acts = el('div', { class:'acts' },
      el('button', { class:'btn ok', onclick: () => location.reload() }, '重新加载'),
      el('button', { class:'btn', onclick: () => { state.view = 'list'; render(); } }, '回到列表'),
    );
    const detail = el('div', {
      class:'cfact',
      style:'white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px',
      text: String((e && (e.stack || e.message)) || e),
    });
    const card = el('div', { class:'card' },
      el('div', { class:'ct', style:'color:var(--warn)', text:'页面出错' }),
      detail,
      acts,
    );
    root.append(el('div', { class:'app', style:'padding:24px' }, card));
  } catch {}
}


async function pasteInto(inp, digitsOnly = false) {
  try {
    const t = String(await navigator.clipboard.readText()).trim();
    if (!t) { toast('剪贴板是空的'); inp.focus(); return; }
    inp.value = digitsOnly ? t.replace(/\D/g, '').slice(0, 6) : t;
    inp.dispatchEvent(new Event('input', { bubbles:true }));
    inp.focus();
  } catch {
    inp.focus();
    toast('无法直接读剪贴板，请长按输入框选择「粘贴」');
  }
}


async function copyText(text) {
  const s = String(text == null ? '' : text);
  try { await navigator.clipboard.writeText(s); return true; }
  catch {
    try {
      const t = document.createElement('textarea');
      t.value = s; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.append(t); t.select();
      const ok = document.execCommand('copy'); t.remove();
      return ok;
    } catch { return false; }
  }
}

// 代码块右上角「复制」：只复制 code 内容，不混入按钮文字

function decorateCodeCopies(mdNode) {
  for (const pre of [...mdNode.querySelectorAll('pre.code')]) {
    if (pre.parentElement && pre.parentElement.classList.contains('codewrap')) continue;
    const wrap = el('div', { class:'codewrap' });
    pre.replaceWith(wrap);
    wrap.append(pre);
    const btn = el('button', { class:'codecopy', text:'复制', onclick: async (e) => {
      e.stopPropagation();
      const code = pre.querySelector('code');
      const txt = (code ? code.textContent : pre.textContent) || '';
      if (await copyText(txt)) {
        btn.textContent = '✓ 已复制';
        btn.classList.add('copied');
        clearTimeout(btn._t);
        btn._t = setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 1200);
        toast('已复制代码');
      } else toast('复制失败');
    }});
    wrap.append(btn);
  }
}


export { copyText, decorateCodeCopies, el, pasteInto, root, showFatal };
