/**
 * 局域网直连服务 —— 把「静态 PWA + 同源 /api 反代」整条链路搬到手机上能访问的地址。
 *
 *   /                      → 本目录静态文件（index.html / sw.js / 图标）
 *   /api/**                → http://127.0.0.1:18787（dsh-mobile 插件的局域网端口）
 *   /__lan_pair            → 同上（局域网配对入口）
 *   /healthz、/push/**、/blob/** → 同上
 *
 * 为什么必须同源：该 API 不返回 Access-Control-Allow-Origin，跨域一律失败，
 * 所以页面和 API 只能出自同一个 origin。这与线上 Caddy 的规则完全一致。
 *
 * 用法：
 *   node lan-server.mjs                          # http://<内网IP>:8080
 *   node lan-server.mjs 9000                     # 换端口
 *   node lan-server.mjs --cert lan-cert.pem --key lan-key.pem   # 自签 https
 *   node lan-server.mjs --host 127.0.0.1         # 只给本机（调样式用）
 *   node lan-server.mjs --upstream 127.0.0.1:64197   # 直接打到 DSH web 端口
 *
 * 注意：http 下浏览器不算「安全上下文」，所以没有 Service Worker / 离线缓存 /
 * 主屏安装 / 通知；要这些能力必须走 --cert/--key 的 https（见 LAN.md）。
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// ---------------------------------------------------------------- 参数
const HELP = `局域网直连服务

  node lan-server.mjs [端口] [--host 0.0.0.0] [--upstream 127.0.0.1:18787]
                      [--cert 证书.pem --key 私钥.pem]
                      [--pfx 证书.pfx --passphrase 口令]
                      [--root 静态目录]`;

const argv = process.argv.slice(2);
const flags = { host: '0.0.0.0', port: 8080, upstream: '127.0.0.1:18787', cert: '', key: '', pfx: '', passphrase: '', root: HERE };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--host') flags.host = argv[++i];
  else if (a === '--port') flags.port = Number(argv[++i]);
  else if (a === '--upstream') flags.upstream = argv[++i];
  else if (a === '--cert') flags.cert = argv[++i];
  else if (a === '--key') flags.key = argv[++i];
  else if (a === '--pfx') flags.pfx = argv[++i];
  else if (a === '--passphrase') flags.passphrase = argv[++i];
  else if (a === '--root') flags.root = resolve(argv[++i]);
  else if (/^\d+$/.test(a)) flags.port = Number(a);
  else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
  else { console.error(`未知参数：${a}\n\n${HELP}`); process.exit(2); }
}

const [UP_HOST, UP_PORT] = flags.upstream.includes(':')
  ? [flags.upstream.slice(0, flags.upstream.lastIndexOf(':')), Number(flags.upstream.slice(flags.upstream.lastIndexOf(':') + 1))]
  : [flags.upstream, 80];

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
  '.txt': 'text/plain; charset=utf-8',
};

// 要转给插件的路径前缀。只放行这些，其余一律当静态文件。
const API_PREFIXES = ['/api/', '/__lan_pair', '/healthz', '/push/', '/blob/', '/tunnel'];

// 逐跳头不能透传（RFC 7230 4.1）：留着会让上游/下游各自以为对方管连接生命周期
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function cleanHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  return out;
}

// ---------------------------------------------------------------- 反代
// 上游始终是明文 http：插件只在本机 18787 上开 HTTP，TLS 由这一层终结。
function proxy(req, res) {
  const up = http.request(
    {
      host: UP_HOST,
      port: UP_PORT,
      method: req.method,
      path: req.url,
      headers: { ...cleanHeaders(req.headers), host: `${UP_HOST}:${UP_PORT}` },
    },
    (upRes) => {
      if (res.headersSent) { upRes.destroy(); return; }
      const headers = cleanHeaders(upRes.headers);
      // SSE 一定不能被任何中间层攒起来：显式告诉下游别缓存、别变形
      if (String(headers['content-type'] || '').includes('text/event-stream')) {
        headers['cache-control'] = 'no-cache, no-transform';
        headers['x-accel-buffering'] = 'no';
      }
      res.writeHead(upRes.statusCode || 502, headers);
      upRes.pipe(res);
    },
  );
  up.on('error', (err) => {
    // 头已经发出去了就不能再 writeHead（否则 ERR_HTTP_HEADERS_SENT 直接把进程带走）
    if (res.headersSent) { try { res.destroy(); } catch {} return; }
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: { code: 'upstream', message: String(err.message || err) } }));
  });
  // 手机断网/切后台时 SSE 常被硬拆，别把上游也吊死
  res.on('close', () => { try { up.destroy(); } catch {} });
  req.on('error', () => { try { up.destroy(); } catch {} });
  req.pipe(up);
}

// ---------------------------------------------------------------- 静态
async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '') path = '/index.html';

  const file = normalize(join(flags.root, path));
  if (!file.startsWith(normalize(flags.root))) return send(res, 403, 'forbidden');
  if (/(^|[\\/])\./.test(path)) return send(res, 404, 'not found'); // 别把 .git/.env 端出来

  try {
    const st = await stat(file);
    if (!st.isFile()) return send(res, 404, 'not found');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      // 局域网上改了文件要立刻生效，别让浏览器吃缓存
      'cache-control': 'no-store',
      // SW 必须能作用到根
      ...(path.endsWith('/sw.js') ? { 'service-worker-allowed': '/' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    // SPA 兜底：未知路径回 index.html（hash 路由都在这一个文件里）
    try {
      const body = await readFile(join(flags.root, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      send(res, 404, 'not found');
    }
  }
}

function send(res, code, text) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// ---------------------------------------------------------------- 启动
const handler = (req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (API_PREFIXES.some((p) => path === p || path.startsWith(p))) return proxy(req, res);
  serveStatic(req, res).catch((err) => {
    if (!res.headersSent) send(res, 500, `internal error: ${err && err.message}`);
    else try { res.destroy(); } catch {}
  });
};

const tlsOn = Boolean(flags.pfx || flags.cert);
const server = flags.pfx
  ? https.createServer({ pfx: await readFile(flags.pfx), passphrase: flags.passphrase || undefined }, handler)
  : flags.cert
    ? https.createServer({ cert: await readFile(flags.cert), key: await readFile(flags.key) }, handler)
    : http.createServer(handler);

// WebSocket / upgrade 帧级透传：现在 PWA 只用 SSE，将来加 HMR 也能直接过
server.on('upgrade', (req, socket, head) => {
  const path = (req.url || '/').split('?')[0];
  if (!API_PREFIXES.some((p) => path === p || path.startsWith(p))) { socket.destroy(); return; }
  const up = net.connect(UP_PORT, UP_HOST, () => {
    const lines = [`${req.method || 'GET'} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => { try { socket.destroy(); } catch {} });
  socket.on('error', () => { try { up.destroy(); } catch {} });
});

const scheme = tlsOn ? 'https' : 'http';
server.listen(flags.port, flags.host, () => {
  const lan = lanAddresses();
  console.log(`\nDSH Mobile LAN server  ·  ${scheme}://${flags.host}:${flags.port}`);
  console.log(`  静态目录  ${flags.root}`);
  console.log(`  API 上游  ${UP_HOST}:${UP_PORT}`);
  console.log('');
  if (!lan.length) console.log('  ! 没有找到内网地址，检查 Wi-Fi / 网线是否连上');
  for (const ip of lan) console.log(`  手机上打开  ${scheme}://${ip}:${flags.port}/`);
  console.log('');
  if (!tlsOn) {
    console.log('  提示：http 下浏览器不算安全上下文 —— 能用，但没有离线缓存、主屏安装、通知。');
    console.log('        要完整能力跑一次 lan-cert.ps1，再加 --pfx 启动（见 LAN.md）。\n');
  } else {
    console.log('  提示：自签证书必须先在手机上安装并信任，否则页面会被拦（见 LAN.md）。\n');
  }
  checkUpstream();
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      // 排除代理/TUN 的假地址（Clash、Tailscale 的 100.64/198.18 段），手机拨过去没有意义
      if (/^198\.(18|19)\./.test(i.address) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address)) continue;
      out.push(i.address);
    }
  }
  return out;
}

async function checkUpstream() {
  const req = http.request(
    { host: UP_HOST, port: UP_PORT, path: '/api/mobile/v1/health', method: 'GET', timeout: 3000 },
    (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          let info = '';
          try { const j = JSON.parse(body); info = `instance ${String(j.instanceId || '').slice(0, 8)}`; } catch {}
          console.log(`  ✓ 上游插件在线（/api/mobile/v1/health 200）${info ? ' · ' + info : ''}`);
        } else {
          console.log(`  ✗ 上游插件返回 ${res.statusCode}：DSH 里的「移动端」是不是没开？`);
        }
        console.log(`  配对码：DSH 桌面端 设置 → 移动端（手机是新的 origin，必须重新配对一次）\n`);
      });
    },
  );
  req.on('error', (err) => {
    console.log(`  ✗ 连不上上游 ${UP_HOST}:${UP_PORT} —— ${err.message}`);
    console.log(`    DSH 桌面端「设置 → 移动端」里打开局域网，端口默认 18787。\n`);
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.end();
}
