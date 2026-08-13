/**
 * WhatsApp notification via whatsapp-web.js
 * Scan QR sekali, sesi tersimpan di .wwebjs_auth/
 * Set WHATSAPP_ENABLED=true di .env untuk mengaktifkan
 */

let client = null;
let isReady = false;

async function initWhatsApp() {
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    console.log('[WhatsApp] Dinonaktifkan (WHATSAPP_ENABLED != true)');
    return;
  }

  try {
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const qrcode = require('qrcode-terminal');

    client = new Client({
      authStrategy: new LocalAuth({ clientId: 'mecomailo' }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    client.on('qr', (qr) => {
      console.log('[WhatsApp] Scan QR code berikut untuk login:');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      isReady = true;
      console.log('[WhatsApp] Client siap');
    });

    client.on('disconnected', () => {
      isReady = false;
      console.log('[WhatsApp] Client terputus');
    });

    await client.initialize();
  } catch (err) {
    console.error('[WhatsApp] Gagal inisialisasi:', err.message);
  }
}

async function sendWA(nomorWa, pesan) {
  if (!isReady || !client) return;
  if (!nomorWa) return;

  try {
    // Format nomor: 08xxx → 628xxx@c.us
    const nomor = nomorWa.replace(/^0/, '62').replace(/\D/g, '') + '@c.us';
    await client.sendMessage(nomor, pesan);
  } catch (err) {
    console.error('[WhatsApp] Gagal kirim pesan:', err.message);
  }
}

async function sendWATaskApproved(user, task) {
  if (!user.notifWa || !user.nomorWa) return;
  await sendWA(user.nomorWa,
    `✅ *MeCom AILO* — Task Disetujui\n\nHalo ${user.namaLengkap}, task Anda telah disetujui:\n*${task.judul}*\nDeadline: ${new Date(task.deadline).toLocaleDateString('id-ID')}`
  );
}

async function sendWATaskRejected(user, task, catatan) {
  if (!user.notifWa || !user.nomorWa) return;
  await sendWA(user.nomorWa,
    `❌ *MeCom AILO* — Task Ditolak\n\nHalo ${user.namaLengkap}, task Anda ditolak:\n*${task.judul}*\nAlasan: ${catatan}`
  );
}

async function sendWADeadlineReminder(user, task, hariSisa) {
  if (!user.notifWa || !user.nomorWa) return;
  await sendWA(user.nomorWa,
    `⏰ *MeCom AILO* — Pengingat Deadline H-${hariSisa}\n\nHalo ${user.namaLengkap}, task berikut deadline ${hariSisa} hari lagi:\n*${task.judul}*\nDeadline: ${new Date(task.deadline).toLocaleDateString('id-ID')}`
  );
}

module.exports = {
  initWhatsApp,
  sendWA,
  sendWATaskApproved,
  sendWATaskRejected,
  sendWADeadlineReminder,
};
