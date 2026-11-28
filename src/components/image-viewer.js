import { el } from '../core/dom.js';
import { api } from '../core/api.js';

function openImageFull(src, gallery, startIndex) {
  const list = (Array.isArray(gallery) && gallery.length ? gallery : [src]).slice();
  let idx = Number.isInteger(startIndex) ? startIndex : list.indexOf(src);
  if (idx < 0 || idx >= list.length) idx = 0;
  const img = el('img', { src: list[idx], alt: '' });
  const count = el('div', { class:'lbcount', text: list.length > 1 ? `${idx + 1} / ${list.length}` : '' });
  const hint = el('div', { class:'lbhint' });
  const prevBtn = list.length > 1 ? el('button', { class:'lbnav prev', text:'‹', onclick: (e) => { e.stopPropagation(); show(idx - 1); } }) : null;
  const nextBtn = list.length > 1 ? el('button', { class:'lbnav next', text:'›', onclick: (e) => { e.stopPropagation(); show(idx + 1); } }) : null;
  const mask = el('div', { class:'lightbox' },
    img,
    el('div', { class:'lbclose', text:'✕', onclick: (e) => { e.stopPropagation(); mask.remove(); } }),
    count,
    hint,
    prevBtn,
    nextBtn,
  );
  document.body.append(mask);

  const MIN = 1, MAX = 5;
  let scale = 1, tx = 0, ty = 0;
  let mode = '', sx = 0, sy = 0, ox = 0, oy = 0;
  let pinchDist = 0, pinchScale = 1;
  let moved = false, lastTap = 0, lastToggle = 0;
  let swipeDx = 0, swipeDy = 0;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  function apply() {
    const w = img.clientWidth || 0, h = img.clientHeight || 0;
    // 放大后允许拖动的范围：多出来的那一半（图片按 contain 居中）
    const mx = Math.max(0, (w * (scale - 1)) / 2);
    const my = Math.max(0, (h * (scale - 1)) / 2);
    tx = clamp(tx, -mx, mx);
    ty = clamp(ty, -my, my);
    img.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${scale})`;
    hint.textContent = scale > 1.01
      ? '放大中 · 单指拖动 · 双击还原'
      : (list.length > 1 ? '左右滑动切换 · 双指缩放 · 点空白处关闭' : '双指缩放 · 双击放大 · 点空白处关闭');
  }
  function reset() { scale = 1; tx = 0; ty = 0; apply(); }
  function show(i) {
    if (list.length < 2) return;
    idx = (i + list.length) % list.length;
    img.src = list[idx];
    count.textContent = `${idx + 1} / ${list.length}`;
    reset();
  }
  apply();
  function toggleZoom() {
    lastToggle = Date.now();
    if (scale > 1.01) reset();
    else { scale = 2.5; tx = 0; ty = 0; apply(); }
  }

  mask.addEventListener('touchstart', (e) => {
    moved = false;
    swipeDx = 0; swipeDy = 0;
    if (e.touches.length >= 2) {
      mode = 'pinch';
      pinchDist = dist(e.touches[0], e.touches[1]);
      pinchScale = scale;
    } else if (e.touches.length === 1) {
      mode = 'pan';
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; ox = tx; oy = ty;
    }
  }, { passive: true });

  mask.addEventListener('touchmove', (e) => {
    if (mode === 'pinch' && e.touches.length >= 2) {
      // 拦下浏览器自己的双指缩放（iOS 上会连整个页面一起缩）
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      if (pinchDist > 0) scale = clamp(pinchScale * (d / pinchDist), MIN, MAX);
      moved = true;
      apply();
    } else if (mode === 'pan' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (scale > 1.01) {
        e.preventDefault();
        tx = ox + dx; ty = oy + dy;
        apply();
      } else {
        swipeDx = dx; swipeDy = dy;
      }
    }
  }, { passive: false });

  mask.addEventListener('touchend', (e) => {
    if (mode === 'pinch') {
      if (scale <= 1.05) reset(); else apply();
      if (!e.touches || e.touches.length === 0) mode = '';
      return;
    }
    mode = '';
    if (scale <= 1.01 && Math.abs(swipeDx) > 60 && Math.abs(swipeDx) > Math.abs(swipeDy)) {
      show(idx + (swipeDx < 0 ? 1 : -1));
      return;
    }
    if (moved) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (t && t.target === img) {
      const now = Date.now();
      if (now - lastTap < 300) { lastTap = 0; toggleZoom(); }
      else lastTap = now;
    }
  }, { passive: true });

  // 桌面：滚轮缩放
  mask.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = clamp(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN, MAX);
    if (scale <= 1.01) reset(); else apply();
  }, { passive: false });

  mask.addEventListener('click', (e) => {
    // 拖动/双指刚结束后的合成 click 不算「点关闭」
    if (moved) { moved = false; return; }
    if (Date.now() - lastToggle < 400) return;
    if (e.target === img && scale > 1.01) return;
    mask.remove();
  });
}

// 正文图：dsh-local-image 的编号 → 字节。带鉴权头所以只能 fetch 成 data URL，<img src> 直接引会 401。

const imgCache = new Map();
// 同一 .mholder（一条回复/一条用户消息）里的图片作为一组，支持大图里左右滑动

function openImageFromNode(node) {
  const holder = node.closest('.mholder') || node.closest('.msg') || document;
  const els = [...holder.querySelectorAll('img')].filter(i => i.src && (i.dataset.lid || i.dataset.att || i.closest('.md') || i.closest('.imgrow')));
  const list = els.map(i => i.src);
  const idx = Math.max(0, els.indexOf(node));
  openImageFull(list[idx] || node.src, list, idx);
}

async function hydrateImages(rootEl) {
  for (const node of [...rootEl.querySelectorAll('img[data-lid]')]) {
    if (node.dataset.loaded) continue;
    node.dataset.loaded = '1';
    const id = node.dataset.lid;
    try {
      let url = imgCache.get(id);
      if (!url) {
        const r = await api('/api/mobile/v1/session/local-image', { method:'POST', body: { id } });
        url = `data:${r.mediaType || 'image/png'};base64,${r.data}`;
        imgCache.set(id, url);
      }
      node.src = url;
      node.addEventListener('click', () => openImageFromNode(node));
    } catch (e) {
      node.replaceWith(el('span', { class:'imgph', text:'🖼 图片取不回来' }));
    }
  }
}

// 分片上传：begin → chunk(base64) → finish → 拿 uploadId / 落盘路径

export { hydrateImages, openImageFromNode, openImageFull };
