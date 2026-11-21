/* DSH Mobile 的 service worker。
   做四件事：
   1. 让页面可安装（Android 上 WebAPK 需要 SW + fetch handler）
   2. 对静态外壳做离线兜底（API 与 SSE 一律不缓存、不拦截）
   3. 接收 Web Push：即使 App 已被杀掉，也能被推送唤醒并弹通知、点角标
   4. 记住"通知对应的会话"，让点击后能真正跳过去
      —— iOS 上点击通知只会用 start_url 拉起 App，URL 参数传不进来，
         notification.data 也不保证保留，所以必须自己持久化。 */
const CACHE = 'dsh-mobile-v89';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

const OPEN_CACHE = 'dsh-open';
const PENDING_KEY = './__pending-open';
const LAST_PUSH_KEY = './__last-push';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API / 推送 / 配对 / 流式一律直通网络（绝不缓存，绝不吃掉 SSE）
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/push/')
      || url.pathname.startsWith('/__lan_pair') || url.pathname.startsWith('/agents/')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html'))),
  );
});

// ---------------------------------------------------------------- 推送

async function setBadge(n) {
  try {
    if (typeof n === 'number' && self.navigator && self.navigator.setAppBadge) {
      if (n > 0) await self.navigator.setAppBadge(n);
      else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
    }
  } catch {}
}

/** 记住最近一条推送对应的会话（按 tag 也存一份，便于点击时按 tag 回查） */
async function rememberPush(tag, sessionId) {
  try {
    const c = await caches.open(OPEN_CACHE);
    const rec = JSON.stringify({ tag: tag || '', sessionId: sessionId || '', at: Date.now() });
    await c.put(new Request(LAST_PUSH_KEY), new Response(rec));
    if (tag) await c.put(new Request(PENDING_KEY + '?tag=' + encodeURIComponent(tag)), new Response(rec));
  } catch {}
}

async function lookupPush(tag) {
  try {
    const c = await caches.open(OPEN_CACHE);
    const key = tag ? PENDING_KEY + '?tag=' + encodeURIComponent(tag) : '';
    const hit = key ? await c.match(new Request(key)) : null;
    const res = hit || await c.match(new Request(LAST_PUSH_KEY));
    if (!res) return '';
    const j = await res.json().catch(() => null);
    if (!j || !j.sessionId) return '';
    if (Date.now() - (j.at || 0) > 10 * 60 * 1000) return '';   // 太老的记录不用
    return j.sessionId;
  } catch { return ''; }
}

/** 给页面留一张"待打开会话"的便条：不管 App 是冷启还是已在后台，页面自会来取 */
async function writePendingOpen(sessionId) {
  try {
    const c = await caches.open(OPEN_CACHE);
    await c.put(new Request(PENDING_KEY),
      new Response(JSON.stringify({ sessionId: sessionId || '', at: Date.now() })));
  } catch {}
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch { d = { title: 'DSH', body: e.data ? e.data.text() : '' }; }

  const title = d.title || 'DSH';
  const tag = d.tag || ('dsh-' + Date.now());
  const sessionId = d.sessionId || '';
  const opts = {
    body: d.body || '',
    tag,
    renotify: true,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { sessionId, url: './' },
  };

  e.waitUntil((async () => {
    await rememberPush(tag, sessionId);
    await self.registration.showNotification(title, opts);
    await setBadge(typeof d.badge === 'number' ? d.badge : undefined);
  })());
});

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  n.close();
  const dataSid = (n.data && n.data.sessionId) || '';

  e.waitUntil((async () => {
    const sid = dataSid || await lookupPush(n.tag);
    await writePendingOpen(sid);

    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) {
      // App 已在（后台/前台）：聚焦并先试一次 postMessage；页面也会在回到前台时读便条
      for (const c of wins) {
        try {
          await c.focus();
          if (sid) c.postMessage({ type: 'open-session', sessionId: sid });
          return;
        } catch {}
      }
    }
    // 冷启动：iOS 会按 start_url 打开 App，参数传不进去 —— 靠上面写的便条
    try { await self.clients.openWindow('./'); } catch {}
  })());
});
