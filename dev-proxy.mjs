/**
 * 开发用同源反代 —— 把 Caddy 上线后的那条规则在本地复现：
 *
 *   / 与静态文件      → 本地 pwa/ 目录
 *   /api/**, /__lan_pair → http://127.0.0.1:18787（dsh-mobile 插件）
 *
 * 为什么必须同源：实测该 API 不返回 Access-Control-Allow-Origin，OPTIONS 预检直接 401，
 * 浏览器跨域一律失败。所以前端只能与 API 同源。
 *
 * 用法： node dev-proxy.mjs  [端口，默认 8080]
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] || 8080);
const UPSTREAM = { host: '127.0.0.1', port: 18787 };

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

function proxy(req, res) {
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`DSH Mobile dev proxy → http://127.0.0.1:${PORT}/   (api → ${UPSTREAM.host}:${UPSTREAM.port})`);
});
