import { APP_VERSION } from '../core/version.js';
import { el } from '../core/dom.js';

const SHEET_ICONS = {
  '🌓': 'theme', '☀️': 'sun', '🌙': 'moon', '🎨': 'palette', '🛡': 'shield', '🔓': 'unlock',
  '🤖': 'dot', '📁': 'folder', '📂': 'folderOpen', '📊': 'bars', '⏱': 'clock', '🔔': 'bell',
  '🔕': 'bellOff', '🩺': 'pulse', '🔗': 'link', '⌘': 'term', 'ⓘ': 'info', '↻': 'refresh',
  '⟳': 'refresh', '🔄': 'refresh', '⏏': 'logout', '📌': 'pin', '◈': 'spark', '☑': 'check',
  '☐': 'box', '↩': 'back', '×': 'close', '✎': 'edit', '🗄': 'archive', '🗑': 'trash',
  '🧹': 'broom', '📣': 'megaphone', '⑂': 'git', '⇄': 'swap', '⧉': 'copy', '◐': 'contrast',
  '◑': 'contrast', '›': 'chevronRight', '‹': 'chevronLeft', '＋': 'plus', '·': 'dot',
};

const SHEET_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';


function sheetIconSVG(name) {
  const P = {
    theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 000 17c1.2 0 1.8-.9 1.8-1.9 0-1.9 1.4-2.4 2.7-2.4h1.2a2.8 2.8 0 002.8-2.8c0-5.5-4-9.9-8.5-9.9z"/>',
    shield: '<path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1l7-2.6z"/>',
    unlock: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 017.6-1.7"/>',
    dot: '<circle cx="12" cy="12" r="2"/>',
    folder: '<path d="M3.5 7.5A1.5 1.5 0 015 6h4l2 2.5h8A1.5 1.5 0 0120.5 10v7A1.5 1.5 0 0119 18.5H5A1.5 1.5 0 013.5 17V7.5z"/>',
    bars: '<path d="M5 19V11M12 19V5M19 19v-6"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    bell: '<path d="M6.5 10a5.5 5.5 0 0111 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5z"/><path d="M10 19a2 2 0 004 0"/>',
    pulse: '<path d="M3 12h4l2-4 3 8 2-4h7"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l2.8-2.8a4 4 0 00-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 00-5.7 0L5.5 12.8a4 4 0 005.7 5.7l1.3-1.3"/>',
    term: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 10l2.2 2.2-2.2 2.2M12.5 14.5h4"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
    refresh: '<path d="M19 12a7 7 0 11-2-4.9M19 4v4h-4"/>',
    logout: '<path d="M14 5.5H6.5v13H14M12 12h8M17 8.5l3.5 3.5-3.5 3.5"/>',
    pin: '<path d="M9 3.5h6l-1 5 3 3v1H7v-1l3-3-1-5z"/><path d="M12 12.5V20"/>',
    spark: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    box: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
    back: '<path d="M9 6l-5 6 5 6"/><path d="M4 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    edit: '<path d="M4.5 19.5l4.2-.9L19 8.3a2.1 2.1 0 00-3-3L5.4 15.3l-.9 4.2z"/><path d="M14.8 6.5l2.7 2.7"/>',
    archive: '<rect x="4" y="4.5" width="16" height="4.5" rx="1.2"/><path d="M6 9v10.5h12V9"/><path d="M12 11.5v5.5M9.8 14.2L12 16.4l2.2-2.2"/>',
    trash: '<path d="M5 7h14M9 7V4.5h6V7M7.5 7l.8 12.5h7.4L16.5 7"/><path d="M10 10.5v5M14 10.5v5"/>',
    folderOpen: '<path d="M3.5 7.5A1.5 1.5 0 015 6h4l2 2.5h7.5A1.5 1.5 0 0120 10v7.5H4L3.5 17V7.5z"/><path d="M3.5 17.5l2.2-6h15.1l-2.3 6"/>',
    bellOff: '<path d="M6.5 10a5.5 5.5 0 018.2-4.8M18 12.5c0 2 .5 3.2 1 4H9M10 19a2 2 0 004 0"/><path d="M4 4l16 16"/>',
    broom: '<path d="M14.5 4.5l5 5M16.5 6.5l-7.8 7.8M8.5 14.5l-4 5M6.5 12.5l5 5M7 16.5l-3.5 3"/>',
    megaphone: '<path d="M4 10v4h3l7 4V6L7 10H4z"/><path d="M17 9.5a4 4 0 010 5M19.5 7a7 7 0 010 10"/>',
    git: '<circle cx="7" cy="6" r="2"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/><path d="M7 8v8M9 6h4a4 4 0 014 4v6"/>',
    swap: '<path d="M4 8h13M13.5 4.5L17 8l-3.5 3.5M20 16H7M10.5 12.5L7 16l3.5 3.5"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-3h-11v11h3"/>',
    contrast: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 000-16z" fill="currentColor" stroke="none"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>',
    chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14"/>',
    download: '<path d="M12 4.5v10.5M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
    openExternal: '<path d="M14 4.5h5.5V10M19.5 4.5l-8.5 8.5M11 4.5H6.5A1.5 1.5 0 005 6v11.5A1.5 1.5 0 006.5 19H18a1.5 1.5 0 001.5-1.5V13"/>',
    eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    file: '<path d="M7 4.5h6.5L18 9v10.5H7z"/><path d="M13.5 4.5V9H18"/>',
    code: '<path d="M9 7.5L4.5 12 9 16.5M15 7.5L19.5 12 15 16.5"/>',
    mic: '<rect x="9" y="3.2" width="6" height="9.6" rx="3"/><path d="M5.5 11.2a6.5 6.5 0 0 0 13 0"/><path d="M12 17.7v2.6"/>',
    speaker: '<path d="M4.5 9.4h3L12 6v12l-4.5-3.4h-3z"/><path d="M15.4 9.3a3.7 3.7 0 0 1 0 5.4"/><path d="M18 6.9a7.2 7.2 0 0 1 0 10.2"/>',
    square: '<rect x="8" y="8" width="8" height="8" rx="1.6"/>',
  };
  const d = P[name];
  return d ? '<svg viewBox="0 0 24 24">' + d + '</svg>' : '';
}


function openSheet(items, footerText) {
  const mask = el('div', { class:'mask', onclick: (e) => { if (e.target === mask) close(); } });
  const sheet = el('div', { class:'sheet', role:'dialog', 'aria-modal':'true', tabindex:'-1' });
  sheet.append(el('div', { class:'grab' }));
  const txt = String(footerText || '').trim();
  const isVer = /^版本\s/.test(txt);
  if (txt && !isVer) {
    sheet.append(el('div', { class:'shead', text: txt }));
    sheet.setAttribute('aria-label', txt);
  }
  for (const it of items) {
    let label = String(it.label == null ? '' : it.label);
    let checked = !!it.checked;
    if (label.startsWith('✓ ')) { checked = true; label = label.slice(2); }
    let icon = null;
    const raw = String(it.icon || '').trim();
    if (raw) {
      const name = SHEET_ICONS[raw];
      if (name) {
        const svg = sheetIconSVG(name);
        if (svg) icon = el('span', { class:'sic', html: svg });
      }
      // 没登记的图标也至少显示原字符，绝不留空
      if (!icon) icon = el('span', { class:'sic', text: raw });
    }
    // 可选副标题（模型来源、最近一条摘要之类），单行主标题仍然省略号截断
    const sub = String(it.sub == null ? '' : it.sub).trim();
    const labelEl = sub
      ? el('span', { class:'sl2' },
          el('span', { class:'ilabel', text: label }),
          el('span', { class:'ssub', text: sub }))
      : el('span', { class:'ilabel', text: label });
    sheet.append(el('button', { class:'item', type:'button', onclick: () => { close(); it.run(); } },
      icon,
      labelEl,
      checked ? el('span', { class:'chk', html: SHEET_CHECK }) : null));
  }
  if (isVer) sheet.append(el('div', { class:'ver', text: txt || `版本 ${APP_VERSION}` }));
  const cancelBtn = el('button', { class:'cancel', type:'button', text:'取消', onclick: close });
  sheet.append(cancelBtn);
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    mask.classList.add('closing');
    setTimeout(() => mask.remove(), 180);
  }
  document.addEventListener('keydown', onKey, true);
  mask.append(sheet);
  document.body.append(mask);
  // 键盘 / 读屏：焦点落在弹层本身（不是第一行）。
  // 落在第一行会让 iOS 上「:focus-visible」判定成立，弹层一打开第一行就套一圈黑框，
  // 看起来像被选中了；落在容器上同样能被读屏读出 dialog 名称，按 Tab 才进第一项。
  requestAnimationFrame(() => {
    try { sheet.focus({ preventScroll: true }); } catch {}
  });
}

// ---------------------------------------------------------------- F3 子代理
// 目录只提供元数据（id / 标题 / 状态 / 时间 / 模式），列表与入口条都只画这些；
// 子会话消息要带 durable parent address 才能读，只在「只读视图」里单独取，失败也不挡状态条和打断。

export { openSheet, sheetIconSVG };
