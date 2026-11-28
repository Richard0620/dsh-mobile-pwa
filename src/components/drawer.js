import { openFileDrawer, openNewSessionSheet, openStats, reloadApp, render, renderList } from '../core/bus.js';
import { state } from '../core/state.js';
import { el } from '../core/dom.js';
import { sheetIconSVG } from './sheet.js';

function paintOpenDrawer() {
  const drBox = document.querySelector('.drawer-mask .drlist');
  if (!drBox) return;
  drBox.replaceChildren();
  renderList(drBox, { noHeader: true, noPull: true });
}

// 键盘适配：iOS 上键盘不改变 layout viewport，只改 visualViewport。
// 用它的高度设 --vvh，让 .app 正好等于可见区域，输入框就贴在键盘上方，不会留一条缝。

function closeDrawer() {
  const m = document.querySelector('.drawer-mask');
  if (!m) return;
  m.classList.remove('on');
  setTimeout(() => m.remove(), 220);
}


function openDrawer() {
  if (document.querySelector('.drawer-mask')) return;
  const mask = el('div', { class:'drawer-mask', onclick: (e) => { if (e.target === mask) closeDrawer(); } });
  const panel = el('div', { class:'drawer' });

  const head = el('div', { class:'drhead' },
    el('b', { text:'会话' }),
    el('span', { style:'flex:1' }),
    el('button', { class:'ico', text:'＋', onclick: () => { closeDrawer(); openNewSessionSheet(); } }),
    el('button', { class:'ico', text:'✕', onclick: closeDrawer }),
  );
  const listBox = el('div', { class:'drlist' });
  renderList(listBox, { noHeader: true, noPull: true });

  // 图标化的一行底部操作。通知入口并入「设置」里的「通知提醒」，不再单独占位。
  const iconBtn = (name, label, run) => el('button', {
    class:'drbtn', title:label, 'aria-label':label, onclick: run, html: sheetIconSVG(name),
  });
  const foot = el('div', { class:'drfoot icons' },
    iconBtn('sliders', '设置', () => { closeDrawer(); state.view = 'settings'; state.subPage = ''; render(); }),
    iconBtn('bars', '统计', () => { closeDrawer(); openStats(); }),
    iconBtn('folder', '文件', () => { closeDrawer(); openFileDrawer(state.sessionCwd || ''); }),
    iconBtn('refresh', '重载', () => { closeDrawer(); reloadApp(); }),
  );

  panel.append(head, listBox, foot);
  // 抽屉内左滑关闭
  let dx0 = 0, dy0 = 0, active = false;
  panel.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    dx0 = e.touches[0].clientX; dy0 = e.touches[0].clientY; active = true;
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (!active) return;
    active = false;
    const t = e.changedTouches[0];
    if (dx0 - t.clientX > 60 && Math.abs(t.clientY - dy0) < 60) closeDrawer();
  }, { passive: true });
  mask.append(panel);
  document.body.append(mask);
  requestAnimationFrame(() => mask.classList.add('on'));
}
// 指令面板的兜底：接口取不到时也能用（离线/400 都不至于面板空白）

export { closeDrawer, openDrawer, paintOpenDrawer };
