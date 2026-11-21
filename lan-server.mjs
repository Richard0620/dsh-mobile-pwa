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
import dgram from 'node:dgram';
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
                      [--name laptop.local --no-mdns]
                      [--root 静态目录]`;

const argv = process.argv.slice(2);
const flags = {
  host: '0.0.0.0',
  port: 8080,
  upstream: '127.0.0.1:18787',
  cert: '',
  key: '',
  pfx: '',
  passphrase: '',
  // 稳定的名字：换 Wi-Fi 内网 IP 会变，<机器名>.local 不变，证书按名字签一次就够
  name: `${os.hostname().toLowerCase().split('.')[0]}.local`,
  mdns: true,
  root: HERE,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--host') flags.host = argv[++i];
  else if (a === '--port') flags.port = Number(argv[++i]);
  else if (a === '--upstream') flags.upstream = argv[++i];
  else if (a === '--cert') flags.cert = argv[++i];
  else if (a === '--key') flags.key = argv[++i];
  else if (a === '--pfx') flags.pfx = argv[++i];
  else if (a === '--passphrase') flags.passphrase = argv[++i];
  else if (a === '--name') flags.name = String(argv[++i] || '').toLowerCase();
  else if (a === '--no-mdns') flags.mdns = false;
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
  // iOS 认这个 content-type 才会弹「安装描述文件」，用 octet-stream 只会存进「文件」
  '.cer': 'application/x-x509-ca-cert',
  '.crt': 'application/x-x509-ca-cert',
  '.mobileconfig': 'application/x-apple-aspen-config',
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
  // 手机装证书的短地址：不用记路径，Safari 打开就直接弹「安装描述文件」
  if (path === '/lan-ca.cer' || path === '/ca.cer') path = '/certs/lan-ca.cer';

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

// ---------------------------------------------------------------- CORS
// 为什么需要：页面装在中转域名上（https://dsh.easymana.online:8443），切到局域网时
// API 要打到 https://<内网IP>:8443 —— 这是跨源，没有 CORS 头浏览器一律拦掉。
// 只放行「内网/本机来源 + 中转域名」，其余一律不回 CORS 头（不构成放行）。
// 注意这层不替代鉴权：每条 API 仍旧要 Bearer 凭据。
const CORS_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
const CORS_EXTRA = (process.env.LAN_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const CORS_ALLOW_HEADERS = 'authorization, content-type, x-dsh-instance, x-dsh-fresh, accept';
const CORS_ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (!CORS_EXTRA.includes(origin) && !CORS_ORIGIN.test(origin) && origin !== 'https://dsh.easymana.online:8443') {
    // 明确不加头，浏览器自会拦
    return false;
  }
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-headers', CORS_ALLOW_HEADERS);
  res.setHeader('access-control-allow-methods', CORS_ALLOW_METHODS);
  res.setHeader('access-control-max-age', '600');
  // Chrome 的「私有网络访问」预检要这个头才放行 https 页面 → 内网地址
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('access-control-allow-private-network', 'true');
  }
  return true;
}

// ---------------------------------------------------------------- mDNS（<机器名>.local）
// 为什么要它：换 Wi-Fi 内网 IP 就变，IP 一变证书就对不上。名字不变，证书签一次就够。
// Windows 自己不回应 mDNS 查询，所以这里当一个小应答器：只答 A 记录，地址每次现算
// （join 之后 IP 变了也不用重启），手机侧 iOS 原生支持 .local 解析。
// 注意：开的端口就是 mDNS 的 5353，多播被网络拦掉时（访客网络/企业网）这条路不通，
// 那种网络下客户端隔离本身就直连不了，不是这里的锅。
function encodeName(name) {
  const parts = name.replace(/\.$/, '').split('.').filter(Boolean);
  const bufs = parts.map((p) => {
    const b = Buffer.alloc(1 + Buffer.byteLength(p));
    b[0] = Buffer.byteLength(p);
    b.write(p, 1, 'ascii');
    return b;
  });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

function buildMdnsResponse(name, ips) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);        // id = 0（mDNS 响应固定 0）
  header.writeUInt16BE(0x8400, 2);   // 响应 + AA
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(ips.length, 6);  // ancount
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const answers = ips.map((ip) => {
    const rr = Buffer.alloc(14);
    rr.writeUInt16BE(1, 0);          // type A
    rr.writeUInt16BE(0x8001, 2);     // class IN + cache-flush
    rr.writeUInt32BE(120, 4);        // ttl 120s：换网后最多两分钟就学到新地址
    rr.writeUInt16BE(4, 8);
    ip.split('.').forEach((oct, i) => rr.writeUInt8(Number(oct) & 0xff, 10 + i));
    return Buffer.concat([encodeName(name), rr]);
  });
  return Buffer.concat([header, ...answers]);
}

function parseMdnsQuestions(buf) {
  if (buf.length < 12) return [];
  const qd = buf.readUInt16BE(4);
  const out = [];
  let off = 12;
  for (let i = 0; i < qd && off < buf.length; i++) {
    const labels = [];
    while (off < buf.length) {
      const len = buf[off];
      if (len === 0) { off += 1; break; }
      if (len & 0xc0) { off += 2; break; }  // 压缩指针：问题区里很少见，直接放弃这条
      labels.push(buf.slice(off + 1, off + 1 + len).toString('ascii'));
      off += 1 + len;
    }
    if (off + 4 > buf.length) break;
    const qtype = buf.readUInt16BE(off);
    const qclass = buf.readUInt16BE(off + 2);
    off += 4;
    // qclass 最高位是「希望单播回应」（QU），取值时掩掉
    out.push({ name: labels.join('.').toLowerCase(), qtype, unicast: Boolean(qclass & 0x8000) });
  }
  return out;
}

function startMdns({ name, ips }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const target = name.toLowerCase();
  socket.on('error', (err) => {
    console.warn(`  ! mDNS 起不来（${err.code || err.message}）—— 不影响 IP 直连，只是 .local 名字不可用`);
    try { socket.close(); } catch {}
  });
  socket.on('message', (msg, rinfo) => {
    let questions;
    try { questions = parseMdnsQuestions(msg); } catch { return; }
    if (!questions.some((q) => q.name === target && (q.qtype === 1 || q.qtype === 255))) return;
    let list;
    try { list = ips(); } catch { return; }
    if (!list.length) return;
    const packet = buildMdnsResponse(name, list);
    // 标准做法是多播回应；请求方要了单播（QU）就再单发一份，两种解析器都照顾到
    try { socket.send(packet, 5353, '224.0.0.251'); } catch {}
    if (questions.some((q) => q.unicast)) {
      try { socket.send(packet, rinfo.port, rinfo.address); } catch {}
    }
  });
  socket.bind(5353, () => {
    try { socket.setMulticastTTL(255); } catch {}
    const join = (addr) => { try { socket.addMembership('224.0.0.251', addr); } catch {} };
    join();  // 默认出口
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) join(i.address);
    }
  });
  return socket;
}

// ---------------------------------------------------------------- 启动
const handler = (req, res) => {
  const path = (req.url || '/').split('?')[0];
  const cors = applyCors(req, res);
  if (req.method === 'OPTIONS' && cors) {
    res.writeHead(204);
    res.end();
    return;
  }
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
  // 名字入口：换 Wi-Fi、IP 变了它也不变，证书按这个名字签一次就够
  if (flags.mdns) {
    console.log(`  换网不变的名字  ${scheme}://${flags.name}:${flags.port}/`);
    try { startMdns({ name: flags.name, ips: lanAddresses }); }
    catch (err) { console.log(`  ! mDNS 没起来：${err.message}`); }
  } else {
    console.log(`  （mDNS 已关闭：--no-mdns）`);
  }
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
