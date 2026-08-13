// MeCom AILO Service Worker — Web Push

self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); }
  catch { data = { title: 'MeCom AILO', body: event.data.text(), url: '/' }; }

  const options = {
    body:    data.body  || '',
    icon:    data.icon  || '/icons/icon.svg',
    badge:   '/icons/icon.svg',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open',    title: 'Buka' },
      { action: 'dismiss', title: 'Tutup' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'MeCom AILO', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Fokus ke tab yang sudah buka MeCom AILO
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(self.location.origin + url);
          return;
        }
      }
      // Buka tab baru
      return clients.openWindow(self.location.origin + url);
    })
  );
});
