/* 松農園 Pine Farm — Service Worker
 * 策略：
 *  - 本站靜態資源（App Shell）：安裝時預先快取，Cache First
 *  - 頁面導覽（HTML）：Network First，離線時退回快取的 index.html
 *  - 跨網域資源（Tailwind / FontAwesome / Google Fonts / Unsplash）：
 *    Stale-While-Revalidate，首次連線後即可離線瀏覽
 * 更新網站內容時，請調高 VERSION 以讓舊快取失效。
 */
const VERSION = 'v2.0.1';
const SHELL_CACHE = `pinefarm-shell-${VERSION}`;
const RUNTIME_CACHE = `pinefarm-runtime-${VERSION}`;
const MAX_RUNTIME_ENTRIES = 80;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('pinefarm-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;

  // GA4 / Google 分析請求不攔截，直接交給網路，避免追蹤資料被快取
  if (/(^|\.)(google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net)$/.test(url.hostname)) return;

  // 1) 頁面導覽：Network First → 快取 → 離線時回 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () =>
          (await caches.match(req)) ||
          (await caches.match('./index.html')) ||
          (await caches.match('./'))
        )
    );
    return;
  }

  // 2) 同網域靜態資源：Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // 3) 跨網域資源：Stale-While-Revalidate（含 opaque 回應，如圖片）
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// 讓頁面可以通知 SW 立即啟用新版本
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
