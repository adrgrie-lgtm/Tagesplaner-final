const CACHE = 'tagesplaner-v19';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-512.png', './icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === self.origin) {
    const isPage = e.request.mode === 'navigate' || url.pathname.slice(-10) === 'index.html' || url.pathname === '/Tagesplaner-final/' || url.pathname === '/Tagesplaner-final';
    if (isPage) {
      e.respondWith(
        fetch(e.request).then(function (resp) {
          const copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          return resp;
        }).catch(function () {
          return caches.match(e.request).then(function (hit) { return hit || caches.match('./index.html'); });
        })
      );
      return;
    }
    e.respondWith(
      caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (resp) {
          const copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          return resp;
        });
      })
    );
  } else if (url.hostname.indexOf('gstatic.com') !== -1) {
    e.respondWith(
      caches.match(e.request).then(function (hit) {
        const net = fetch(e.request).then(function (resp) {
          const copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          return resp;
        }).catch(function () { return hit; });
        return hit || net;
      })
    );
  }
});

self.addEventListener('push', function (e) {
  let data = { title: '', body: '' };
  try { data = e.data.json(); } catch (err) { try { data.body = e.data.text(); } catch (err2) { } }
  e.waitUntil(self.registration.showNotification(data.title || '📅 Familien-Tagesplaner', {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'tagesplaner-erinnerung'
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(function (list) {
    for (let i = 0; i < list.length; i++) { const c = list[i]; if ('focus' in c) return c.focus(); }
    return clients.openWindow('./');
  }));
});
