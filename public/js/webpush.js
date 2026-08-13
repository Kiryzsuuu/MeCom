/**
 * MeCom AILO Web Push — daftarkan Service Worker & subscribe browser push
 * Di-load di semua halaman setelah login (via sidebar.js atau inline)
 */
(function () {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  async function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function registerAndSubscribe() {
    try {
      // 1. Daftarkan service worker
      const reg = await navigator.serviceWorker.register('/sw.js');

      // 2. Minta izin notifikasi (hanya kalau belum)
      if (Notification.permission === 'denied') return;
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
      }

      // 3. Ambil VAPID public key dari server
      const { publicKey } = await apiFetch('/push/vapid-public-key').catch(() => ({}));
      if (!publicKey) return;

      // 4. Subscribe ke push server
      const existing = await reg.pushManager.getSubscription();
      let sub = existing;
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: await urlBase64ToUint8Array(publicKey),
        });
      }

      // 5. Kirim subscription ke backend
      await apiFetch('/push/subscribe', {
        method: 'POST',
        body:   JSON.stringify({ subscription: sub.toJSON() }),
      });

    } catch (err) {
      // Silent — push bersifat opsional
    }
  }

  // Jalankan setelah user login (apiFetch tersedia setelah api.js load)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerAndSubscribe);
  } else {
    registerAndSubscribe();
  }
})();
