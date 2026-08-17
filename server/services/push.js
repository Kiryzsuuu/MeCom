const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:admin@WorkPulseailo.id',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

/**
 * Kirim push notification ke satu user (semua device-nya)
 * @param {string|ObjectId} userId
 * @param {{ title: string, body: string, url?: string, icon?: string }} payload
 */
async function sendPush(userId, { title, body, url = '/', icon = '/icons/icon-192.png' }) {
  const subs = await PushSubscription.find({ userId });
  if (!subs.length) return;

  const data = JSON.stringify({ title, body, url, icon });

  await Promise.allSettled(
    subs.map(async (doc) => {
      try {
        await webpush.sendNotification(doc.subscription, data);
      } catch (err) {
        // Subscription kadaluarsa / dicabut → hapus dari DB
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.deleteOne({ _id: doc._id });
        }
      }
    })
  );
}

/**
 * Kirim push ke banyak userId sekaligus
 */
async function sendPushMany(userIds, payload) {
  await Promise.allSettled(userIds.map(id => sendPush(id, payload)));
}

module.exports = { sendPush, sendPushMany };
