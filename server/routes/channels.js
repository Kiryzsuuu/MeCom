const router         = require('express').Router();
const path           = require('path');
const Channel        = require('../models/Channel');
const ChannelMessage = require('../models/ChannelMessage');
const User           = require('../models/User');
const auth           = require('../middleware/auth');
const { TOP_TIER_ROLES } = require('../middleware/roles');
const { getIO }      = require('../socket');
const { uploadChatFile } = require('../middleware/upload');

// GET /api/channels — list channel yang bisa diakses user, lengkap unread count
router.get('/', auth, async (req, res) => {
  const myId = req.user._id.toString();
  const channels = await Channel.find({
    $or: [
      { isPrivate: false },
      { members: req.user._id },
      { createdBy: req.user._id },
    ],
  })
    .populate('createdBy', 'namaLengkap fotoProfil')
    .sort({ updatedAt: -1 });

  const result = await Promise.all(channels.map(async (ch) => {
    const lastReadAt = ch.lastRead.get(myId) || new Date(0);
    const unreadCount = await ChannelMessage.countDocuments({
      channelId: ch._id,
      userId: { $ne: req.user._id },
      createdAt: { $gt: lastReadAt },
    });
    const obj = ch.toObject();
    obj.unreadCount = unreadCount;
    return obj;
  }));

  res.json(result);
});

// POST /api/channels — buat channel baru
router.post('/', auth, async (req, res) => {
  const { nama, deskripsi, isPrivate } = req.body;
  if (!nama) return res.status(400).json({ message: 'Nama channel wajib' });

  const ch = await Channel.create({
    nama, deskripsi: deskripsi || '', isPrivate: !!isPrivate,
    createdBy: req.user._id,
    members: [req.user._id],
  });
  await ch.populate('createdBy', 'namaLengkap fotoProfil');
  res.status(201).json(ch);
});

// GET /api/channels/:id
router.get('/:id', auth, async (req, res) => {
  const ch = await Channel.findById(req.params.id)
    .populate('createdBy', 'namaLengkap fotoProfil')
    .populate('members', 'namaLengkap fotoProfil role');
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });

  const isMember = ch.members.some(m => m._id.toString() === req.user._id.toString());
  if (ch.isPrivate && !isMember && ch.createdBy._id.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'Akses ditolak' });

  res.json(ch);
});

// PUT /api/channels/:id — edit channel (hanya creator)
router.put('/:id', auth, async (req, res) => {
  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });
  if (ch.createdBy.toString() !== req.user._id.toString() && !TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Hanya pembuat yang dapat mengedit channel' });

  if (req.body.nama        !== undefined) ch.nama      = req.body.nama;
  if (req.body.deskripsi   !== undefined) ch.deskripsi = req.body.deskripsi;
  if (req.body.isPrivate   !== undefined) ch.isPrivate = req.body.isPrivate;
  await ch.save();
  res.json(ch);
});

// DELETE /api/channels/:id — hapus channel (creator atau top-tier)
router.delete('/:id', auth, async (req, res) => {
  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });
  if (ch.createdBy.toString() !== req.user._id.toString() && !TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Hanya pembuat yang dapat menghapus channel' });

  await ChannelMessage.deleteMany({ channelId: ch._id });
  await ch.deleteOne();
  res.json({ message: 'Channel dihapus' });
});

// POST /api/channels/:id/join
router.post('/:id/join', auth, async (req, res) => {
  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });
  if (ch.isPrivate) return res.status(403).json({ message: 'Channel ini privat' });

  const alreadyMember = ch.members.some(m => m.toString() === req.user._id.toString());
  if (!alreadyMember) {
    ch.members.push(req.user._id);
    await ch.save();
  }
  res.json({ message: 'Berhasil join channel' });
});

// POST /api/channels/:id/leave
router.post('/:id/leave', auth, async (req, res) => {
  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });
  if (ch.createdBy.toString() === req.user._id.toString())
    return res.status(400).json({ message: 'Pembuat tidak dapat meninggalkan channel' });

  ch.members = ch.members.filter(m => m.toString() !== req.user._id.toString());
  await ch.save();
  res.json({ message: 'Berhasil keluar dari channel' });
});

// POST /api/channels/:id/invite — tambah member (creator saja)
router.post('/:id/invite', auth, async (req, res) => {
  const { userId } = req.body;
  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });
  if (ch.createdBy.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'Hanya pembuat yang dapat mengundang member' });

  const alreadyInvited = ch.members.some(m => m.toString() === userId.toString());
  if (!alreadyInvited) {
    ch.members.push(userId);
    await ch.save();
  }
  res.json({ message: 'Member ditambahkan' });
});

// GET /api/channels/:id/messages?before=&limit=
router.get('/:id/messages', auth, async (req, res) => {
  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });

  const isMember = ch.members.some(m => m.toString() === req.user._id.toString());
  if (ch.isPrivate && !isMember)
    return res.status(403).json({ message: 'Akses ditolak' });

  const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
  const query  = { channelId: req.params.id };
  if (req.query.before) query.createdAt = { $lt: new Date(req.query.before) };

  const messages = await ChannelMessage.find(query)
    .populate('userId', 'namaLengkap fotoProfil role')
    .sort({ createdAt: -1 })
    .limit(limit);

  res.json(messages.reverse());
});

// POST /api/channels/:id/messages
router.post('/:id/messages', auth, async (req, res) => {
  const { isi } = req.body;
  if (!isi) return res.status(400).json({ message: 'Pesan tidak boleh kosong' });

  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });

  const isMember = ch.members.some(m => m.toString() === req.user._id.toString());
  if (!isMember && ch.isPrivate)
    return res.status(403).json({ message: 'Anda bukan member channel ini' });

  // Auto-join public channel jika belum member
  if (!isMember) {
    ch.members.push(req.user._id);
    await ch.save();
  }

  // Parse mentions
  const mentionMatches = [...isi.matchAll(/@\[([^\]]+)\]/g)];
  const mentions = [];
  for (const m of mentionMatches) {
    const u = await User.findOne({ namaLengkap: m[1] });
    if (u) mentions.push(u._id);
  }

  const msg = await ChannelMessage.create({
    channelId: req.params.id,
    userId: req.user._id,
    isi, mentions,
  });
  await msg.populate('userId', 'namaLengkap fotoProfil role');

  // Update channel updatedAt
  ch.updatedAt = new Date();
  await ch.save();

  // Real-time ke semua member di channel room
  const io = getIO();
  if (io) io.to(`ch:${req.params.id}`).emit('channel:message', msg);

  res.status(201).json(msg);
});

// POST /api/channels/:id/messages/attachment — kirim pesan dengan lampiran file/gambar
router.post('/:id/messages/attachment', auth, uploadChatFile.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File wajib diunggah' });

  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });

  const isMember = ch.members.some(m => m.toString() === req.user._id.toString());
  if (!isMember && ch.isPrivate)
    return res.status(403).json({ message: 'Anda bukan member channel ini' });
  if (!isMember) { ch.members.push(req.user._id); await ch.save(); }

  const isi = (req.body.isi || '').toString().slice(0, 4000);

  const msg = await ChannelMessage.create({
    channelId: req.params.id,
    userId: req.user._id,
    isi,
    attachments: [{
      url: `/uploads/chat/${req.file.filename}`,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    }],
  });
  await msg.populate('userId', 'namaLengkap fotoProfil role');

  ch.updatedAt = new Date();
  await ch.save();

  const io = getIO();
  if (io) io.to(`ch:${req.params.id}`).emit('channel:message', msg);

  res.status(201).json(msg);
});

// PUT /api/channels/:id/messages/:msgId — edit pesan (pengirim saja)
router.put('/:id/messages/:msgId', auth, async (req, res) => {
  const { isi } = req.body;
  if (!isi || !isi.trim()) return res.status(400).json({ message: 'Pesan tidak boleh kosong' });

  const msg = await ChannelMessage.findById(req.params.msgId);
  if (!msg) return res.status(404).json({ message: 'Pesan tidak ditemukan' });
  if (msg.userId.toString() !== req.user._id.toString())
    return res.status(403).json({ message: 'Hanya pengirim yang dapat mengedit pesan ini' });

  msg.isi = isi.trim();
  msg.editedAt = new Date();
  await msg.save();
  await msg.populate('userId', 'namaLengkap fotoProfil role');

  const io = getIO();
  if (io) io.to(`ch:${req.params.id}`).emit('channel:message:edited', msg);

  res.json(msg);
});

// POST /api/channels/:id/messages/:msgId/react — toggle reaksi emoji
router.post('/:id/messages/:msgId/react', auth, async (req, res) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ message: 'Emoji wajib diisi' });

  const msg = await ChannelMessage.findById(req.params.msgId);
  if (!msg) return res.status(404).json({ message: 'Pesan tidak ditemukan' });

  let entry = msg.reactions.find(r => r.emoji === emoji);
  const uid = req.user._id.toString();
  if (entry) {
    const has = entry.users.some(u => u.toString() === uid);
    if (has) {
      entry.users = entry.users.filter(u => u.toString() !== uid);
      if (!entry.users.length) msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
    } else {
      entry.users.push(req.user._id);
    }
  } else {
    msg.reactions.push({ emoji, users: [req.user._id] });
  }
  await msg.save();

  const io = getIO();
  if (io) io.to(`ch:${req.params.id}`).emit('channel:reaction', {
    channelId: req.params.id, msgId: msg._id.toString(), reactions: msg.reactions,
  });

  res.json({ reactions: msg.reactions });
});

// PUT /api/channels/:id/read — tandai channel sudah dibaca
router.put('/:id/read', auth, async (req, res) => {
  const ch = await Channel.findById(req.params.id);
  if (!ch) return res.status(404).json({ message: 'Channel tidak ditemukan' });

  ch.lastRead.set(req.user._id.toString(), new Date());
  await ch.save();
  res.json({ message: 'Ditandai sudah dibaca' });
});

// DELETE /api/channels/:id/messages/:msgId
router.delete('/:id/messages/:msgId', auth, async (req, res) => {
  const msg = await ChannelMessage.findById(req.params.msgId);
  if (!msg) return res.status(404).json({ message: 'Pesan tidak ditemukan' });

  const isOwner     = msg.userId.toString() === req.user._id.toString();
  const isSuperadmin = TOP_TIER_ROLES.includes(req.user.role);
  const ch = await Channel.findById(req.params.id);
  const isCreator   = ch && ch.createdBy.toString() === req.user._id.toString();

  if (!isOwner && !isSuperadmin && !isCreator)
    return res.status(403).json({ message: 'Tidak dapat menghapus pesan ini' });

  await msg.deleteOne();
  res.json({ message: 'Pesan dihapus' });
});

module.exports = router;
