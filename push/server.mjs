/**
 * DSH Push —— 给 PWA 发 Web Push 的小服务。
 *
 * 为什么需要它：iOS/Android 的 Web Push 要求发送方用 VAPID 私钥签名，浏览器只负责转发。
 * 手机不在线时，只有这个服务能主动投递（宿主插件把事件 POST 过来）。
 *
 * 端口 18789，只监听 127.0.0.1，通过 Caddy 的 /push/* 暴露。
 *
 * 环境变量（/etc/dsh-push.env）：
 *   VAPID_PUBLIC / VAPID_PRIVATE   来自 `web-push generate-vapid-keys`
 *   PUSH_SECRET                    宿主插件调 /notify 时带的共享密钥
 */
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import webpush from 'web-push';

const PORT = Number(process.env.PORT || 18789);
const DATA = process.env.DATA_FILE || '/opt/dsh-push/data/subs.json';
const SECRET = process.env.PUSH_SECRET || '';
const PUB = process.env.VAPID_PUBLIC || '';
const PRIV = process.env.VAPID_PRIVATE || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@easymana.online';

if (!PUB || !PRIV) {
  console.error('缺少 VAPID 环境变量');
  process.exit(1);
}
webpush.setVapidDetails(SUBJECT, PUB, PRIV);

// ---------------------------------------------------------------- 订阅存储
let subs = [];   // [{ deviceId, endpoint, keys:{p256dh,auth}, at, ua }]
let active = {}; // { deviceId: lastActiveAt }

function load() {
  try {
    const j = JSON.parse(readFileSync(DATA, 'utf8'));
    subs = Array.isArray(j.subs) ? j.subs : [];
    active = j.active && typeof j.active === 'object' ? j.active : {};
  } catch { subs = []; active = {}; }
}
function save() {
  try {
    mkdirSync(dirname(DATA), { recursive: true });
    const tmp = DATA + '.tmp';
    writeFileSync(tmp, JSON.stringify({ subs, active, savedAt: Date.now() }));
    renameSync(tmp, DATA);
  } catch (e) { console.error('保存失败', e.message); }
}
load();

// ---------------------------------------------------------------- 工具
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

/** 向所有订阅发一条；失效的（404/410）顺手清掉 */
async function broadcast(payload) {
  const body = JSON.stringify(payload);
  const results = { sent: 0, dropped: 0, failed: 0 };
  const keep = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 3600 });
      results.sent++;
      keep.push(s);
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) { results.dropped++; continue; }  // 端点已失效
      results.failed++;
      console.error('send failed', code, e && e.message);
      keep.push(s);
    }
  }
  if (results.dropped) { subs = keep; save(); }
  return results;
}

// ---------------------------------------------------------------- HTTP
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/push/healthz') {
    return json(res, 200, { ok: true, subs: subs.length, service: 'dsh-push' });
  }
  // 前端拿公钥自己 subscribe
  if (req.method === 'GET' && p === '/push/vapid') {
    return json(res, 200, { ok: true, publicKey: PUB });
  }

  if (req.method === 'POST' && p === '/push/subscribe') {
    let b;
    try { b = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    const sub = b.subscription;
    const deviceId = String(b.deviceId || '').slice(0, 80) || 'unknown';
    if (!sub || !sub.endpoint || !sub.keys) return json(res, 400, { ok: false, error: '缺少 subscription' });
    subs = subs.filter(s => s.endpoint !== sub.endpoint);      // 同一端点只留一条
    subs.push({ deviceId, endpoint: sub.endpoint, keys: sub.keys, at: Date.now(), ua: String(b.ua || '').slice(0, 120) });
    active[deviceId] = Date.now();
    save();
    return json(res, 200, { ok: true, subs: subs.length });
  }

  if (req.method === 'POST' && p === '/push/unsubscribe') {
    let b;
    try { b = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    const before = subs.length;
    subs = subs.filter(s => s.endpoint !== b.endpoint);
    save();
    return json(res, 200, { ok: true, removed: before - subs.length });
  }

  // PWA 打开时打点：宿主据此判断"人在不在看"
  if (req.method === 'POST' && p === '/push/active') {
    let b = {};
    try { b = await readBody(req); } catch {}
    const deviceId = String(b.deviceId || '').slice(0, 80) || 'unknown';
    active[deviceId] = Date.now();
    save();
    return json(res, 200, { ok: true });
  }

  // 宿主插件调用：发推送
  if (req.method === 'POST' && p === '/push/notify') {
    if (SECRET && req.headers['x-push-secret'] !== SECRET) return json(res, 401, { ok: false, error: 'bad secret' });
    let b;
    try { b = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    const payload = {
      title: String(b.title || 'DSH').slice(0, 80),
      body: String(b.body || '').slice(0, 240),
      sessionId: b.sessionId || undefined,
      badge: Number.isFinite(b.badge) ? b.badge : undefined,
      tag: b.tag || undefined,
      kind: b.kind || undefined,
    };
    // 「已完成 / 失败」这类：你刚还在 App 里（60 秒内有心跳）就别打扰
    if (payload.kind && /^(completed|failed|done|turn-end)$/.test(String(payload.kind))) {
      const quietMs = Number(process.env.DONE_QUIET_MS || 60000);
      const last = Object.values(active).reduce((a, b) => Math.max(a, Number(b) || 0), 0);
      if (last && Date.now() - last < quietMs) {
        return json(res, 200, { ok: true, skipped: 'active', sent: 0, dropped: 0, failed: 0 });
      }
    }
    const results = await broadcast(payload);
    return json(res, 200, { ok: true, ...results });
  }

  return json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dsh-push listening on 127.0.0.1:${PORT} · subs=${subs.length}`);
});
