import { openDrawer, openFileDrawer, refreshAll, reloadApp, render } from './bus.js';
import { state, ui } from './state.js';
import { el } from './dom.js';

function installViewportSync() {
  const vv = window.visualViewport;
  const de = document.documentElement;
  // iOS 独立模式下键盘弹起会直接缩小 innerHeight（不缩小 layout viewport），
  // 所以只能拿"见过的最小/最大高度"当基准：maxH - ih > 120 就是键盘。
  let maxH = window.innerHeight;
  window.__maxH = maxH;

  const apply = () => {
    const ih = window.innerHeight;
    if (ih > maxH) { maxH = ih; window.__maxH = maxH; }
    // 改高度前先判断「是不是在看最新消息」——高度一变这个差值就不准了
    const wasNear = ui && ui.body && ui.body.isConnected
      ? ui.body.scrollHeight - ui.body.scrollTop - ui.body.clientHeight < 90 : false;
    const shrunk = maxH - ih;
    // 关键：iOS 有时不缩 innerHeight，只缩 visualViewport。两个信号取大的那个。
    const vvShrunk = vv ? maxH - Math.round(vv.height) : 0;
    const kb = Math.max(shrunk, vvShrunk) > 120;
    // 没有键盘时一律用 innerHeight：从通知冷启动或切回前台时，visualViewport 可能是
    // 键盘弹出期间留下的旧值（表现为输入框停在屏幕中间、下面一大片空白）。
    const vvh = Math.round(kb && vv ? vv.height : ih);
    de.style.setProperty('--vvh', vvh + 'px');
    de.classList.toggle('kb-open', kb);

    // iOS 会把页面往上顶（offsetTop/scrollY 变成几百），把滚动位置强行拉回 0
    if (window.scrollY !== 0 || (vv && vv.offsetTop !== 0)) {
      try { window.scrollTo(0, 0); } catch {}
    }
    // 键盘弹起 / 窗口缩放后可视区变矮：原本在看最新消息就重贴底部。
    // iOS 键盘动画会分几段完成，rAF 之后再补 260ms / 700ms；
    // 用户中途自己上翻（scroll 里把 atBottom 置 false）就停止。
    if (wasNear) ui.atBottom = true;
    if (ui && ui.body && ui.body.isConnected && ui.atBottom) {
      const pin = () => {
        if (!ui || !ui.body || !ui.body.isConnected || !ui.atBottom) return;
        try { ui.body.scrollTop = ui.body.scrollHeight; } catch {}
      };
      requestAnimationFrame(pin);
      setTimeout(pin, 260);
      setTimeout(pin, 700);
    }
  };
  vv && vv.addEventListener('resize', apply);
  vv && vv.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  document.addEventListener('focusin', () => { setTimeout(apply, 120); setTimeout(apply, 320); setTimeout(apply, 700); });
  document.addEventListener('focusout', () => { setTimeout(apply, 120); setTimeout(apply, 400); });
  apply();
  // 从后台/通知回来时 iOS 不一定补发 resize，这里主动补量几次
  window.__syncViewport = apply;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { setTimeout(apply, 60); setTimeout(apply, 350); }
  });
  window.addEventListener('pageshow', () => { setTimeout(apply, 60); setTimeout(apply, 350); });
  window.addEventListener('focus', () => setTimeout(apply, 60));
  setTimeout(apply, 400); setTimeout(apply, 1200);
}

// 从会话回到列表（返回按钮和左滑手势共用）

function goBackToList() {
  state.live?.close();
  clearInterval(state.poll);
  state.view = 'list';
  ui.sessionId = null;
  render();
  refreshAll();
}

// 左滑返回：单页应用没有浏览历史，iOS 自带的边缘手势不会触发，自己实现。
// 从左缘 40px 内起手、水平位移 > 70px、纵向位移 < 70px，才算返回，避免和竖向滚动打架。

function installSwipeBack() {
  let sx = 0, sy = 0, mode = '', appEl = null;
  const resetShift = () => {
    if (!appEl) return;
    appEl.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
    appEl.style.transform = '';
    const elRef = appEl;
    appEl = null;
    setTimeout(() => { elRef.style.transition = ''; }, 240);
  };
  document.addEventListener('touchstart', (e) => {
    if (state.view !== 'session' || e.touches.length !== 1) return;
    if (document.querySelector('.drawer-mask') || document.querySelector('.rpanel-mask')) { mode = ''; return; }
    const t = e.touches[0];
    const w = window.innerWidth;
    // 左缘右滑 → 会话抽屉；右缘左滑 → 文件面板
    mode = t.clientX <= 40 ? 'left' : (t.clientX >= w - 44 ? 'right' : '');
    sx = t.clientX; sy = t.clientY;
    appEl = mode ? document.querySelector('.app') : null;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!mode || !appEl || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dy) > 48 && Math.abs(dy) > Math.abs(dx)) { mode = ''; resetShift(); return; }
    const pull = mode === 'left' ? Math.max(0, Math.min(28, dx * 0.28)) : Math.min(0, Math.max(-28, dx * 0.28));
    appEl.style.transition = 'none';
    appEl.style.transform = pull ? `translateX(${pull.toFixed(1)}px)` : '';
  }, { passive: true });
  document.addEventListener('touchcancel', () => { mode = ''; resetShift(); }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!mode) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    const m = mode; mode = '';
    resetShift();
    if (Math.abs(dy) >= 70) return;
    if (m === 'left' && dx > 70) openDrawer();
    if (m === 'right' && dx < -70) openFileDrawer(state.sessionCwd || '');
  }, { passive: true });
}


function installOfflineBar() {
  const bar = el('div', { class:'offbar', text:'网络已断开，正在等恢复…' });
  document.body.append(bar);
  const sync = () => {
    const off = navigator.onLine === false;
    bar.classList.toggle('on', off);
    state.offline = off;
  };
  window.addEventListener('online', () => { sync(); if (state.offline === false) { try { refreshAll(true); } catch {} } });
  window.addEventListener('offline', sync);
  sync();
}


function installPullToRefresh(scroller) {
  const hint = el('div', { class:'ptr', text:'下拉刷新' });
  scroller.prepend(hint);
  let startY = 0, pulling = false, dist = 0;
  scroller.addEventListener('touchstart', e => {
    if (scroller.scrollTop <= 0) { startY = e.touches[0].clientY; pulling = true; dist = 0; }
  }, { passive: true });
  scroller.addEventListener('touchmove', e => {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0) { hint.style.height = '0'; hint.classList.remove('on'); return; }
    hint.classList.add('on');
    hint.style.height = Math.min(52, dist * 0.55) + 'px';
    hint.textContent = dist > 72 ? '松开刷新' : '下拉刷新';
  }, { passive: true });
  scroller.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    if (dist > 72) { hint.textContent = '刷新中…'; reloadApp(); }
    else { hint.classList.remove('on'); hint.style.height = '0'; }
  });
}

// ---------------------------------------------------------------- sheet

export { installOfflineBar, installPullToRefresh, installSwipeBack, installViewportSync };
