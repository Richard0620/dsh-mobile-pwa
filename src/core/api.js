import { render } from './bus.js';
import { LS } from './config.js';
import { state } from './state.js';

function apiUrl(path) {
  return state.apiBase ? state.apiBase.replace(/\/+$/, '') + path : path;
}

// 探一发健康接口：能连通说明这条通道可用，顺便量延迟。
// 跨域靠 lan-server 的 CORS；证书没被手机信任时这里会是 Failed to fetch，正好当作「不可用」。

async function api(path, { method='GET', body, auth=true } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(body ? { 'content-type':'application/json' } : {}),
      ...(auth && state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(state.instanceId ? { 'x-dsh-instance': state.instanceId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!data || typeof data !== 'object') {
    const e = new Error(`不是 JSON 响应（HTTP ${res.status}）：${text.slice(0, 80)}`);
    e.code = 'not-json'; throw e;
  }
  if (!res.ok || data.ok === false) {
    const errObj = (data && data.error) || null;
    // 宿主的老配对接口回的是字符串（{"ok":false,"error":"配对码错误"}），
    // 新接口回的是对象；两种都要取出可读的 message，否则界面只剩「401: Unauthorized」
    const errMsg = (typeof errObj === 'string' ? errObj : (errObj && errObj.message))
      || (data && typeof data.message === 'string' ? data.message : '')
      || res.statusText || '请求失败';
    const code = (errObj && errObj.code) || res.status;
    // 设备被吊销/凭据失效：直接回配对页，别让界面停在"还没有会话"这种误导性的空状态
    if (auth && (res.status === 401 || code === 'device-revoked')) {
      state.authError = `登录已失效（${errMsg}），请重新配对或用恢复链接登录`;
      state.token = ''; state.instanceId = '';
      try { localStorage.removeItem(LS.token); localStorage.removeItem(LS.inst); } catch {}
      state.view = 'list'; render();
    }
    const e = new Error(errMsg);
    e.code = code;
    e.status = res.status;
    throw e;
  }
  return data;
}

// ---------------------------------------------------------------- SSE

function friendlyAuthError(e, mode = 'pair') {
  const code = String((e && e.code) || '');
  const raw = String((e && e.message) || e || '').trim();
  if (code === 'device-revoked') return '这台设备已被解除绑定，请重新配对';
  if (code === 'device-expired') return '这台设备的授权已过期，请重新配对';
  const authish = /401|unauthor|缺少或无效|失效/i.test(code + ' ' + raw);
  if (authish) {
    return mode === 'link'
      ? '这条恢复链接已失效，请在电脑端「设置 → 移动端」重新复制一条'
      : '配对码不对，或这台电脑暂时不允许新设备配对';
  }
  if (/failed to fetch|network|load failed|closed/i.test(raw)) {
    return '连不上电脑：确认手机和电脑在同一网络，或中转/隧道是否在线';
  }
  return raw || '连接失败，请再试一次';
}

// ---------------------------------------------------------------- 列表（按工作区分组）

async function rawText(path, { method='GET', body } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(body ? { 'content-type':'application/json' } : {}),
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(state.instanceId ? { 'x-dsh-instance': state.instanceId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 120);
    try { const j = JSON.parse(text); msg = j.error?.message || j.error?.code || msg; } catch {}
    throw new Error(msg);
  }
  return text;
}

// ---------------- 文件浏览 ----------------

export { api, apiUrl, friendlyAuthError, rawText };
