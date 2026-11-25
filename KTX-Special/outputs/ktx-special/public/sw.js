const CACHE = 'ktx-special-shell-v2';
const FILES = ['/', '/index.html', '/app.js', '/style.css', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.method !== 'GET' || !FILES.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const clone = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, clone))); }
    return response;
  }).catch(() => caches.match(event.request)));
});
self.addEventListener('push', event => {
  let data;
  try { data = event.data.json(); } catch { data = { title: '특실로', body: '앱에서 새 소식을 확인해 주세요.' }; }
  event.waitUntil(self.registration.showNotification(String(data.title || '특실로').slice(0, 80), { body: String(data.body || '').slice(0, 300), icon: '/icon-192.png', badge: '/icon-192.png', tag: String(data.tag || 'ktx-special'), data: { url: typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/' } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/', self.location.origin);
  if (destination.origin !== self.location.origin) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(destination.href); return existing.focus(); }
    return clients.openWindow(destination.href);
  }));
});
