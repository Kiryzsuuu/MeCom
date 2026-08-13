const router         = require('express').Router();
const Channel        = require('../models/Channel');
const ChannelMessage = require('../models/ChannelMessage');
const User           = require('../models/User');
const auth           = require('../middleware/auth');
const { TOP_TIER_ROLES } = require('../middleware/roles');
const { getIO }      = require('../socket');

// GET /api/channels — list channel yang bisa diakses user
router.get('/', auth, async (req, res) => {
  const channels = await Channel.find({
    $or: [
      { isPrivate: false },
      { members: req.user._id },
      { createdBy: req.user._id },
    ],
  })
    .populate('createdBy', 'namaLengkap fotoProfil')
    .sort({ updatedAt: -1 });
  res.json(channels);
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
