import { SKIN_KEY, THEME_KEY } from './config.js';

function applyTheme(mode) {
  const v = mode === 'light' || mode === 'dark' ? mode : '';
  if (v) document.documentElement.dataset.theme = v;
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, v); } catch {}
}

// 皮肤：paper（纸面，跟系统浅/深）| carbon（碳黑，恒深色）。只换 token，不改结构。

function applySkin(id) {
  const v = id === 'carbon' ? 'carbon' : (id === 'auto' ? 'auto' : 'paper');
  document.documentElement.dataset.skin = v;
  try { localStorage.setItem(SKIN_KEY, v); } catch {}
}

// ---- legacy 路径：回退开关 = '0' 时的唯一路径，逻辑与原版逐字节一致 ----

export { applySkin, applyTheme };
