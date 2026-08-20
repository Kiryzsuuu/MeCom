const router         = require('express').Router();
const Conversation   = require('../models/Conversation');
const DirectMessage  = require('../models/DirectMessage');
const User           = require('../models/User');
const auth           = require('../middleware/auth');
const { emitToUser } = require('../socket');

// GET /api/dm/conversations — daftar percakapan user, terbaru dulu, lengkap unread count
router.get('/conversations', auth, async (req, res) => {
  const myId = req.user._id.toString();
  const convos = await Conversation.find({ participants: req.user._id })
    .populate('participants', 'namaLengkap fotoProfil role statusAktif')
    .sort({ lastMessageAt: -1 });

  const result = await Promise.all(convos.map(async (c) => {
    const other = c.participants.find(p => p._id.toString() !== myId);
    const lastReadAt = c.lastRead.get(myId) || new Date(0);
    const unreadCount = await DirectMessage.countDocuments({
      conversationId: c._id,
      senderId: { $ne: req.user._id },
      createdAt: { $gt: lastReadAt },
    });
    return {
      _id: c._id,
      user: other || null,
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt,
      lastSenderId: c.lastSenderId,
      unreadCount,
    };
  }));

  res.json(result);
});

// GET /api/dm/unread-count — total unread untuk badge sidebar
router.get('/unread-count', auth, async (req, res) => {
  const myId = req.user._id.toString();
  const convos = await Conversation.find({ participants: req.user._id }).select('lastRead');

  let total = 0;
  for (const c of convos) {
    const lastReadAt = c.lastRead.get(myId) || new Date(0);
    total += await DirectMessage.countDocuments({
      conversationId: c._id,
      senderId: { $ne: req.user._id },
      createdAt: { $gt: lastReadAt },
    });
  }
  res.json({ unreadCount: total });
});

// POST /api/dm/conversations — buka/buat percakapan dengan user lain (idempotent)
router.post('/conversations', auth, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'userId wajib diisi' });
  if (userId === req.user._id.toString()) return res.status(400).json({ message: 'Tidak bisa chat dengan diri sendiri' });

  const target = await User.findById(userId);
  if (!target) return res.status(404).json({ message: 'Pengguna tidak ditemukan' });

  let c = await Conversation.findOne({
    participants: { $all: [req.user._id, userId], $size: 2 },
  }).populate('participants', 'namaLengkap fotoProfil role statusAktif');

  if (!c) {
    c = await Conversation.create({ participants: [req.user._id, userId] });
    await c.populate('participants', 'namaLengkap fotoProfil role statusAktif');
  }

  const other = c.participants.find(p => p._id.toString() !== req.user._id.toString());
  res.status(201).json({
    _id: c._id, user: other, lastMessage: c.lastMessage,
    lastMessageAt: c.lastMessageAt, lastSenderId: c.lastSenderId, unreadCount: 0,
  });
});

// GET /api/dm/conversations/:id/messages?before=&limit=
router.get('/conversations/:id/messages', auth, async (req, res) => {
  const c = await Conversation.findById(req.params.id);
  if (!c) return res.status(404).json({ message: 'Percakapan tidak ditemukan' });
  if (!c.participants.some(p => p.toString() === req.user._id.toString()))
    return res.status(403).json({ message: 'Akses ditolak' });

  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const query = { conversationId: req.params.id };
  if (req.query.before) query.createdAt = { $lt: new Date(req.query.before) };

  const messages = await DirectMessage.find(query)
    .populate('senderId', 'namaLengkap fotoProfil')
    .sort({ createdAt: -1 })
    .limit(limit);

  res.json(messages.reverse());
});

// POST /api/dm/conversations/:id/messages
router.post('/conversations/:id/messages', auth, async (req, res) => {
  const { isi } = req.body;
  if (!isi || !isi.trim()) return res.status(400).json({ message: 'Pesan tidak boleh kosong' });

  const c = await Conversation.findById(req.params.id);
  if (!c) return res.status(404).json({ message: 'Percakapan tidak ditemukan' });
  if (!c.participants.some(p => p.toString() === req.user._id.toString()))
    return res.status(403).json({ message: 'Akses ditolak' });

  const msg = await DirectMessage.create({
    conversationId: c._id,
    senderId: req.user._id,
    isi: isi.trim(),
  });
  await msg.populate('senderId', 'namaLengkap fotoProfil');

  c.lastMessage   = isi.trim().slice(0, 200);
  c.lastMessageAt = msg.createdAt;
  c.lastSenderId  = req.user._id;
  c.lastRead.set(req.user._id.toString(), msg.createdAt);
  await c.save();

  // Real-time ke kedua partisipan
  for (const p of c.participants) {
    emitToUser(p.toString(), 'dm:message', { conversationId: c._id.toString(), message: msg });
  }

  res.status(201).json(msg);
});

// PUT /api/dm/conversations/:id/read — tandai sudah dibaca
router.put('/conversations/:id/read', auth, async (req, res) => {
  const c = await Conversation.findById(req.params.id);
  if (!c) return res.status(404).json({ message: 'Percakapan tidak ditemukan' });
  if (!c.participants.some(p => p.toString() === req.user._id.toString()))
    return res.status(403).json({ message: 'Akses ditolak' });

  c.lastRead.set(req.user._id.toString(), new Date());
  await c.save();

  // Beritahu partisipan lain bahwa pesan sudah dibaca (mis. centang biru)
  const other = c.participants.find(p => p.toString() !== req.user._id.toString());
  if (other) emitToUser(other.toString(), 'dm:read', { conversationId: c._id.toString(), readBy: req.user._id.toString() });

  res.json({ message: 'Ditandai sudah dibaca' });
});

// DELETE /api/dm/conversations/:id/messages/:msgId — hapus pesan sendiri
router.delete('/conversations/:id/messages/:msgId', auth, async (req, res) => {
  const msg = await DirectMessage.findById(req.params.msgId);
  if (!msg) return res.status(404).json({ message: 'Pesan tidak ditemukan' });
  if (msg.senderId.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'Hanya pengirim yang dapat menghapus pesan ini' });

  await msg.deleteOne();

  const c = await Conversation.findById(req.params.id);
  if (c) {
    for (const p of c.participants) {
      emitToUser(p.toString(), 'dm:message-deleted', { conversationId: req.params.id, msgId: req.params.msgId });
    }
  }

  res.json({ message: 'Pesan dihapus' });
});

module.exports = router;
