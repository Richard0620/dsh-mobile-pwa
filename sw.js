/* DSH Mobile 的 service worker。
   只做两件事：让页面可安装（Android 上 WebAPK 需要 SW + fetch handler），
   以及对静态外壳做离线兜底。API 与 SSE 一律不缓存、不拦截。 */
const CACHE = 'dsh-mobile-v67';
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
  // API / 配对 / 流式一律直通网络（绝不缓存，绝不吃掉 SSE）
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__lan_pair')) return;
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
