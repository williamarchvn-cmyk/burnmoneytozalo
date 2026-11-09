// sw.js — giúp Burn Money MỞ ĐƯỢC KHI MẤT MẠNG (lưu sẵn giao diện + font).
// Dữ liệu không nằm ở đây: dữ liệu lưu trên máy (localStorage) và đồng bộ qua /api/sync.
const CACHE = 'burn-money-v2';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add('/')).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const withTimeout = (p, ms) => new Promise((ok, fail) => { const t = setTimeout(() => fail(new Error('timeout')), ms); p.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); fail(e); }); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;     // dữ liệu luôn đi thẳng máy chủ
  if (req.mode === 'navigate') {
    // Có mạng: lấy bản mới nhất (để cập nhật app). Mạng chậm/mất: dùng bản đã lưu.
    e.respondWith(withTimeout(fetch(req), 5000).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); }
      return res;
    }).catch(() => caches.match('/').then(hit => hit || Response.error())));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
  }
});
