const CACHE = 'tagesplaner-v20';
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

// ================= PUSH-ABO SELBSTHEILUNG =================
// Chrome erneuert Push-Tokens gelegentlich von selbst (pushsubscriptionchange).
// Ohne diesen Handler wuerde die Datenbank weiter den toten Endpunkt halten
// und alle Erinnerungen ins Leere laufen. Wir melden uns neu an und
// aktualisieren das passende Dokument direkt in Firestore.
function idbGetMeta() {
  return new Promise(function (resolve) {
    try {
      const req = indexedDB.open('tagesplaner-meta', 1);
      req.onupgradeneeded = function (e) { e.target.result.createObjectStore('meta'); };
      req.onsuccess = function (e) {
        try {
          const store = e.target.result.transaction('meta', 'readonly').objectStore('meta');
          const get = store.get('push');
          get.onsuccess = function () { resolve(get.value || null); };
          get.onerror = function () { resolve(null); };
        } catch (err) { resolve(null); }
      };
      req.onerror = function () { resolve(null); };
    } catch (e) { resolve(null); }
  });
}
function swUrlB64ToUint8Array(b64) { const padding = '='.repeat((4 - b64.length % 4) % 4); const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(base64); const arr = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i); return arr; }
function swB64Of(key) { if (!key) return ''; const arr = new Uint8Array(key); let s = ''; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]); return btoa(s); }

self.addEventListener('pushsubscriptionchange', function (e) {
  e.waitUntil((async function () {
    try {
      const meta = await idbGetMeta();
      if (!meta || !meta.familyCode || !meta.subId) return;
      const API_KEY = 'AIzaSyDnxOWelFO4nNgxHNgX9j2x-zb0IrV0SHg';
      const base = 'https://firestore.googleapis.com/v1/projects/familienplaner-6ac08/databases/(default)/documents/families/' + meta.familyCode;
      const authRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + API_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const tok = (await authRes.json()).idToken;
      const cfgRes = await fetch(base + '/pushConfig/vapid', { headers: { Authorization: 'Bearer ' + tok } });
      const cfg = (await cfgRes.json()).fields || {};
      const key = (cfg.publicKey && cfg.publicKey.stringValue) ? String(cfg.publicKey.stringValue).trim() : null;
      if (!key) return;
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: swUrlB64ToUint8Array(key) });
      const fields = {
        endpoint: { stringValue: sub.endpoint },
        p256dh: { stringValue: swB64Of(sub.getKey('p256dh')) },
        auth: { stringValue: swB64Of(sub.getKey('auth')) },
        ua: { stringValue: navigator.userAgent },
        updatedAt: { stringValue: new Date().toISOString() }
      };
      await fetch(base + '/pushSubs/' + meta.subId, { method: 'PATCH', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fields }) });
    } catch (err) { }
  })());
});
