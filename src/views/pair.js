import { render } from '../core/bus.js';
import { APP_VERSION } from '../core/version.js';
import { CACHE_V2, LS } from '../core/config.js';
import { state, uuid } from '../core/state.js';
import { el, pasteInto, root } from '../core/dom.js';
import { idbInit, idbState } from '../core/cache.js';
import { api, friendlyAuthError } from '../core/api.js';
import { refreshAll } from '../features/sync.js';

function renderPair() {
  const input = el('input', { inputmode:'numeric', maxlength:'6', placeholder:'000000', autocomplete:'one-time-code' });
  input.addEventListener('input', () => {
    const v = input.value.replace(/\D/g, '').slice(0, 6);
    if (v !== input.value) input.value = v;
  });
  const pasteBtn = el('button', { class:'btn', style:'width:auto;flex:none;padding:0 14px;font-size:12px',
    onclick: () => pasteInto(input, true) }, '粘贴');
  const err = el('div', { class:'err', text: state.authError || '' });
  const btn = el('button', { class:'btn primary', style:'padding:14px', onclick: async () => {
    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) { err.textContent = '配对码是 6 位数字'; return; }
    btn.textContent = '连接中…'; btn.disabled = true; err.textContent = '';
    try {
      const payload = { code, device: { deviceId: uuid(), name: 'DSH PWA', platform: 'web',
        osVersion: navigator.userAgent.slice(0,32), appVersion: '0.2.0' } };
      let r;
      try { r = await api('/__lan_pair', { method:'POST', body: payload, auth:false }); }
      catch { r = await api('/api/mobile/v1/pair', { method:'POST', body: payload, auth:false }); }
      state.token = r.deviceCredential || r.token;
      state.instanceId = r.instanceId || '';
      localStorage.setItem(LS.token, state.token);
      localStorage.setItem(LS.inst, state.instanceId);
      state.view = 'list';
      state.authError = '';
      render();
      // 退登后同一页重登：v2 缓存层已复位，这里把库重新起起来（不 await，别挡首屏）
      if (CACHE_V2 && !idbState.ready) idbInit();
      refreshAll();
    } catch (e) {
      err.textContent = friendlyAuthError(e, 'pair');
      btn.textContent = '连接'; btn.disabled = false;
    }
  }}, '连接');

  // 从浏览器登录过、但添加到主屏后是新容器（iOS 两套 localStorage）——直接粘恢复链接即可
  const recHint = el('div', { style:'text-align:center;color:var(--dim);font-size:11.5px;line-height:1.5;margin-top:14px',
    text:'或者粘贴一条恢复链接（整条含 #token=…）' });
  const rec = el('input', { placeholder:'粘贴恢复链接', style:'margin-top:8px' });
  const recPaste = el('button', { class:'btn', style:'margin-top:8px', onclick: () => pasteInto(rec) }, '从剪贴板粘贴链接');
  const recBtn = el('button', { class:'btn', style:'margin-top:8px', onclick: () => {
    const s = rec.value.trim();
    const t = /[#&]token=([^&\s]+)/.exec(s);
    if (!t) { err.textContent = '这条链接里没找到凭据（#token=）'; return; }
    const i = /[#&]inst=([^&\s]+)/.exec(s);
    state.token = decodeURIComponent(t[1]);
    if (i) state.instanceId = decodeURIComponent(i[1]);
    localStorage.setItem(LS.token, state.token);
    if (state.instanceId) localStorage.setItem(LS.inst, state.instanceId);
    state.authError = '';
    state.view = 'list';
    render();
    // 恢复链接是「退登后同页重登」的主要路径：同样要把 v2 库重新起起来
    if (CACHE_V2 && !idbState.ready) idbInit();
    refreshAll();
  }}, '用链接登录');

  root.append(el('div', { class:'pair' },
    el('div', { class:'logo', style:'justify-content:center' },
      el('span', { class:'mark', text:'A' }), el('span', { text:'AI-HUB' })),
    el('div', { style:'text-align:center;color:var(--dim);font-size:13px;line-height:1.7',
      html:'输入电脑端「设置 → 移动端」的 6 位配对码<br>直连你自己的 DSH，不经第三方' }),
    el('div', { style:'display:flex;gap:8px;align-items:stretch' },
      el('div', { style:'flex:1;min-width:0;display:flex' }, input), pasteBtn),
    btn, err, recHint, rec, recPaste, recBtn,
    el('div', { style:'text-align:center;color:var(--dim);font-size:11.5px;opacity:.7;margin-top:10px',
      text:`版本 ${APP_VERSION}` }),
  ));
  setTimeout(() => input.focus(), 60);
}

// 把登录/配对的接口错误翻成下一步能照做的话（服务端只给状态码时尤其需要）

export { renderPair };
