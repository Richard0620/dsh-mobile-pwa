/**
 * 开发用同源反代 —— 把 Caddy 上线后的那条规则在本地复现：
 *
 *   / 与静态文件      → 本地 pwa/ 目录
 *   /api/**, /__lan_pair → DSH 宿主的 web 端口（手机 API 挂在它上面）
 *
 * 为什么必须同源：实测该 API 不返回 Access-Control-Allow-Origin，OPTIONS 预检直接 401，
 * 浏览器跨域一律失败。所以前端只能与 API 同源。
 *
 * 用法： node dev-proxy.mjs  [端口，默认 8080]  [宿主 web 端口，可选]
 *        宿主端口没给就自动探测（dsh web 每次重启端口都会变）
 */
import http from 'node:http';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] || 8080);
// 宿主自己的 web 端口（手机 API 挂在它上面）。18787 是 LAN/中转 sidecar 的端口，
// 那边对 /api/mobile/v1/* 强制要求设备 token —— 本地开发转发过去永远配不上对。
// 宿主端口每次重启都可能变（dsh web 会打印新端口），所以这里按顺序取：
//   第 3 个参数 > DSH_WEB_PORT > 自动探测本机监听端口里的 /api/mobile/v1/health
const UPSTREAM = { host: '127.0.0.1', port: Number(process.argv[3] || process.env.DSH_WEB_PORT || 0) };

function listeningPorts() {
  try {
    const out = process.platform === 'win32'
      ? execSync('netstat -ano', { encoding: 'utf8' })
      : execSync('ss -ltn', { encoding: 'utf8' });
    const re = process.platform === 'win32' ? /127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING/gi : /127\.0\.0\.1:(\d+)/g;
    return [...new Set([...out.matchAll(re)].map((m) => Number(m[1])))];
  } catch {
    return [];
  }
}

/** 宿主 web 端口没给定就自己找：只有 dsh-mobile 插件会回这个 service 字段。 */
async function resolveUpstream() {
  if (UPSTREAM.port) return UPSTREAM.port;
  for (const p of listeningPorts().filter((p) => p > 1023 && p !== PORT)) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 400);
      const r = await fetch(`http://127.0.0.1:${p}/api/mobile/v1/health`, { signal: ctl.signal });
      clearTimeout(timer);
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.service === 'dsh-mobile-plugin') { UPSTREAM.port = p; return p; }
    } catch { /* 下一个 */ }
  }
  throw new Error('找不到 DSH 宿主 web 端口：node dev-proxy.mjs 8080 <port>，或设 DSH_WEB_PORT');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function proxy(req, res) {
  try { await resolveUpstream(); } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: { code: 'upstream', message: String(e.message || e) } }));
    return;
  }
  const up = http.request(
    { ...UPSTREAM, method: req.method, path: req.url, headers: { ...req.headers, host: `${UPSTREAM.host}:${UPSTREAM.port}` } },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);           // SSE 也走这条：不缓冲、不聚合
    },
  );
  up.on('error', (err) => {
    // 头已经发出去了就不能再 writeHead（否则 ERR_HTTP_HEADERS_SENT 直接把进程带走）
    if (res.headersSent) { try { res.destroy(); } catch {} return; }
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: { code: 'upstream', message: String(err.message || err) } }));
  });
  // 客户端断开（SSE 场景很常见）时，把上游也收掉，别留悬挂连接
  res.on('close', () => { try { up.destroy(); } catch {} });
  req.on('error', () => { try { up.destroy(); } catch {} });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__lan_pair')) return proxy(req, res);

  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '') path = '/index.html';
  const file = normalize(join(HERE, path));
  if (!file.startsWith(normalize(HERE))) { res.writeHead(403).end('forbidden'); return; }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      // SW 需要作用域在根
      ...(path.endsWith('sw.js') ? { 'service-worker-allowed': '/' } : {}),
    });
    res.end(body);
  } catch {
    // SPA 兜底
    try {
      const body = await readFile(join(HERE, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  let target = `${UPSTREAM.host}:${UPSTREAM.port || '自动探测'}`;
  try { target = `${UPSTREAM.host}:${await resolveUpstream()}`; } catch (e) { target = String(e.message || e); }
  console.log(`DSH Mobile dev proxy → http://127.0.0.1:${PORT}/   (api → ${target})`);
});
