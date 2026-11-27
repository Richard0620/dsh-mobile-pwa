import { loadFiles, render } from '../core/bus.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { fmtTok } from '../core/format.js';

const NAV_ICONS = {
  chat: '<svg viewBox="0 0 24 24"><path d="M20 12.5c0 3.9-3.6 7-8 7-1 0-2-.15-2.9-.43L4 20.5l1.3-3.6C4.1 15.6 3.5 14.1 3.5 12.5c0-3.9 3.6-7 8.5-7s8 3.1 8 7z"/></svg>',
  files: '<svg viewBox="0 0 24 24"><path d="M7 4.5h6.5L18 9v10.5H7z"/><path d="M13.5 4.5V9H18"/><path d="M4.5 7.5v12h9"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M3.5 8h9M17 8h3.5M3.5 16h3.5M11 16h9.5"/><circle cx="14.5" cy="8" r="2.2"/><circle cx="8.5" cy="16" r="2.2"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5A1.5 1.5 0 015 6h4l2 2.5h8A1.5 1.5 0 0120.5 10v7A1.5 1.5 0 0119 18.5H5A1.5 1.5 0 013.5 17V7.5z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 3.5h6l-1 5 3 3v1H7v-1l3-3-1-5z"/><path d="M12 12.5V20"/></svg>',
  model: '<svg viewBox="0 0 24 24"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1l7-2.6z"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 017.6-1.7"/></svg>',
};


function tabBar(active) {
  const btn = (id, label, icon, run) => el('button', { class: active === id ? 'on' : '', onclick: run },
    el('span', { html: NAV_ICONS[icon] }), el('span', { text: label }));
  return el('nav', { class:'tabbar' },
    btn('list', '会话', 'chat', () => { if (state.view !== 'list') { state.view = 'list'; render(); } }),
    btn('files', '文件', 'files', () => {
      state.view = 'files';
      if (state.filesListing) render();
      else loadFiles(state.sessionCwd || '');
    }),
    btn('settings', '设置', 'gear', () => { if (state.view !== 'settings') { state.view = 'settings'; render(); } }),
  );
}


function heroHeader(title, sub, action) {
  return el('div', { class:'hero' },
    el('div', {}, el('h1', { text: title }), sub ? el('div', { class:'sub', text: sub }) : null),
    action ? el('div', { class:'acts' }, action) : null);
}


function openConnectionSettings() {
  state.view = 'sub'; state.subPage = 'conn'; render();
}

// 列表 / 设置共用的当前连接状态；点按进入「设置 → 连接」

function connPill({ interactive = true } = {}) {
  const info = state.netInfo || {};
  const ch = info.channel;
  const label = ch === 'lan' ? '直连' : ch ? '中转' : '连接中';
  const cls = ch === 'lan' ? 'direct' : ch ? 'relay' : 'unknown';
  const ms = Number(info.ms) || 0;
  const props = {
    class: `connpill ${cls}${interactive ? '' : ' static'}`,
    title: ch ? `当前${label}${ms ? ' · ' + ms + 'ms' : ''}，点击查看连接设置` : '正在探测连接',
    'aria-label': ch ? `当前${label}${ms ? '，' + ms + ' 毫秒' : ''}` : '正在探测连接',
  };
  if (interactive) { props.type = 'button'; props.onclick = openConnectionSettings; }
  return el(interactive ? 'button' : 'span', props,
    el('i', { class:'dot' }),
    el('b', { text: label }),
    ms ? el('span', { class:'ms', text: ms + 'ms' }) : (ch ? el('span', { class:'ms', text:'—' }) : null));
}


function paintConnPills() {
  document.querySelectorAll('.connpill').forEach(old => {
    try { old.replaceWith(connPill()); } catch {}
  });
}

// 二级页沿用「返回在左、标题紧随」的规范，不再把返回箭头丢到右上角

function heroBackHeader(title, sub, back, action) {
  return el('div', { class:'hero hero-back' },
    back || null,
    el('div', { class:'hero-main' }, el('h1', { text: title }), sub ? el('div', { class:'sub', text: sub }) : null),
    action ? el('div', { class:'acts' }, action) : null);
}


function headerEl(title, left, right) {
  const h = el('header', {}, left || el('span'));
  h.append(el('h1', {}, typeof title === 'string' ? el('span', { text: title }) : title));
  h.append(right || el('span'));
  return h;
}


function openInfoBox(title, rows, actions, extra) {
  const mask = el('div', { class:'mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
  const box = el('div', { class:'sheet' },
    el('div', { style:'font-size:13px;color:var(--dim);padding:0 6px 8px', text: title }));
  for (const [k, v] of rows) {
    box.append(el('div', { class:'kvrow' }, el('span', { class:'kk', text: k }), el('span', { class:'vv', text: String(v) })));
  }
  if (extra) box.append(extra);
  if (actions && actions.length) {
    const acts = el('div', { class:'acts', style:'margin-top:10px' });
    for (const a of actions) acts.append(el('button', { class:'btn', onclick: () => { mask.remove(); a.run(); } }, a.label));
    box.append(acts);
  }
  box.append(el('div', { class:'cancel', text:'关闭', onclick: () => mask.remove() }));
  mask.append(box);
  document.body.append(mask);
}

// 近 N 天输出 tokens 的柱状图（纯 div，不引图表库）

function miniBars(days, pick) {
  const wrap = el('div', { class:'bars' });
  const vals = days.map(d => pick(d) || 0);
  const max = Math.max(1, ...vals);
  days.forEach((d, i) => {
    const h = Math.max(2, Math.round((vals[i] / max) * 54));
    wrap.append(el('div', { class:'barcol', title: `${d.day} · ${fmtTok(vals[i])}` },
      el('div', { class:'barv', text: vals[i] ? fmtTok(vals[i]) : '' }),
      el('div', { class:'bar', style:`height:${h}px` }),
      el('div', { class:'barlbl', text: String(d.day || '').slice(5) })));
  });
  return wrap;
}

// 最近 N 天的活跃热力图（纯 div；强度按输出 tokens 分三档，0 = 空格）

function heatmap(days, n = 35) {
  const list = (days || []).slice(-n);
  if (!list.length) return null;
  const max = Math.max(1, ...list.map(d => d.outputTokens || 0));
  const wrap = el('div', { class:'heat' });
  for (const d of list) {
    const v = d.outputTokens || 0;
    const lvl = v === 0 ? 0 : v < max / 3 ? 1 : v < (max * 2) / 3 ? 2 : 3;
    wrap.append(el('div', { class:'hcell l' + lvl, title:`${d.day || ''} · 输出 ${fmtTok(v)}` }));
  }
  return wrap;
}


export { NAV_ICONS, connPill, headerEl, heatmap, heroBackHeader, miniBars, openInfoBox, paintConnPills, tabBar };
