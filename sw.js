/* DSH Mobile 的 service worker。
   做三件事：
   1. 让页面可安装（Android 上 WebAPK 需要 SW + fetch handler）
   2. 对静态外壳做离线兜底（API 与 SSE 一律不缓存、不拦截）
   3. 接收 Web Push：即使 App 已被杀掉，也能被推送唤醒并弹通知、点角标 */
const CACHE = 'dsh-mobile-v72';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

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
      || url.pathname.startsWith('/__lan_pair')) return;
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

// ---------------------------------------------------------------- Web Push

/** 角标：Badging API 在 SW 里可用（iOS 16.4+ / Chrome），失败就算了 */
async function setBadge(n) {
  try {
    if (typeof n === 'number' && self.navigator && self.navigator.setAppBadge) {
      if (n > 0) await self.navigator.setAppBadge(n);
      else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
    }
  } catch {}
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch { d = { title: 'DSH', body: e.data ? e.data.text() : '' }; }

  const title = d.title || 'DSH';
  const opts = {
    body: d.body || '',
    tag: d.tag || ('dsh-' + Date.now()),
    renotify: true,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { sessionId: d.sessionId || '', url: './' },
  };

  e.waitUntil((async () => {
    await self.registration.showNotification(title, opts);
    await setBadge(typeof d.badge === 'number' ? d.badge : undefined);
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const sid = (e.notification.data && e.notification.data.sessionId) || '';

  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      try {
        await c.focus();
        if (sid) c.postMessage({ type: 'open-session', sessionId: sid });
        return;
      } catch {}
    }
    // 没有已开窗口：带 sessionId 打开，App 启动后会自己进那个会话
    const url = sid ? './?session=' + encodeURIComponent(sid) : './';
    await self.clients.openWindow(url);
  })());
});
