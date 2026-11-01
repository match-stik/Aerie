// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Web push for a browser running the house without the Android app.
//
// THIS WORKER DOES TWO THINGS AND NOTHING ELSE: it shows a notification when
// the house pushes one, and a tap brings the house forward. It has no fetch
// handler and caches nothing, and it is registered with a scope no page lives
// under, so it never controls a page. The May 2026 worker cached the app shell
// and sat in every page load, which is why it was pulled; this one cannot.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Aerie';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    icon: '/icon.svg',
    data: { url: data.url || '/', threadId: data.threadId || null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const win of windows) {
      if (new URL(win.url).origin === self.location.origin) {
        try { await win.focus(); } catch { /* focus can be refused; the window is still there */ }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
