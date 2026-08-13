const router   = require('express').Router();
const Komentar = require('../models/Komentar');
const Task     = require('../models/Task');
const User     = require('../models/User');
const auth     = require('../middleware/auth');
const notifSvc = require('../services/notifikasi');
const push     = require('../services/push');
const { TOP_TIER_ROLES } = require('../middleware/roles');

// GET /api/komentar?taskId=xxx
router.get('/', auth, async (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });
  const list = await Komentar.find({ taskId })
    .populate('userId', 'namaLengkap fotoProfil role')
    .sort({ createdAt: 1 });
  res.json(list);
});

// POST /api/komentar
router.post('/', auth, async (req, res) => {
  const { taskId, isi } = req.body;
  if (!taskId || !isi) return res.status(400).json({ message: 'taskId dan isi wajib' });

  const task = await Task.findById(taskId).populate('dibuatOleh');
  if (!task || task.isDeleted)
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  // Cek akses: top-tier, creator, atau assignee
  const isDireksi  = TOP_TIER_ROLES.includes(req.user.role);
  const isCreator  = (task.dibuatOleh._id?.toString() || task.dibuatOleh.toString()) === req.user._id.toString();
  const isAssignee = (task.assignees || []).map(c => c.toString()).includes(req.user._id.toString());
  if (!isDireksi && !isCreator && !isAssignee)
    return res.status(403).json({ message: 'Hanya top-tier, pembuat, atau assignee yang dapat menambah notes' });

  // Parse mentions @[nama] → cari user id
  const mentionMatches = [...isi.matchAll(/@\[([^\]]+)\]/g)];
  const mentions = [];
  for (const m of mentionMatches) {
    const u = await User.findOne({ namaLengkap: m[1] });
    if (u) mentions.push(u._id);
  }

  const kom = await Komentar.create({ taskId, userId: req.user._id, isi, mentions });

  // Notifikasi ke assignee, pembuat, dan mention
  const notifTargets = new Set([
    ...(task.assignees || []).map(a => a.toString()),
    task.dibuatOleh._id?.toString() || task.dibuatOleh.toString(),
    ...mentions.map(m => m.toString()),
  ]);
  await notifSvc.notifKomentarBaru([...notifTargets], task, req.user);

  // Push notif ke semua yang terlibat kecuali pengirim
  const pushTargets = [...notifTargets].filter(id => id !== req.user._id.toString());
  push.sendPushMany(pushTargets, {
    title: `📝 Note baru di "${task.judul}"`,
    body:  `${req.user.namaLengkap}: ${isi.slice(0, 80)}`,
    url:   `/pages/task.html?id=${task._id}`,
  }).catch(() => {});

  await kom.populate('userId', 'namaLengkap fotoProfil role');
  res.status(201).json(kom);
});

// PUT /api/komentar/:id — edit dalam 30 menit
router.put('/:id', auth, async (req, res) => {
  const kom = await Komentar.findById(req.params.id);
  if (!kom) return res.status(404).json({ message: 'Komentar tidak ditemukan' });

  const isOwner = kom.userId.toString() === req.user._id.toString();
  if (!isOwner) return res.status(403).json({ message: 'Hanya pemilik yang dapat mengedit komentar' });

  const batas = 30 * 60 * 1000;
  if (Date.now() - kom.createdAt.getTime() > batas)
    return res.status(400).json({ message: 'Komentar hanya dapat diedit dalam 30 menit setelah diposting' });

  kom.isi = req.body.isi;
  await kom.save();
  res.json(kom);
});

// DELETE /api/komentar/:id
router.delete('/:id', auth, async (req, res) => {
  const kom = await Komentar.findById(req.params.id);
  if (!kom) return res.status(404).json({ message: 'Komentar tidak ditemukan' });

  const isOwner   = kom.userId.toString() === req.user._id.toString();
  const isDireksi = TOP_TIER_ROLES.includes(req.user.role);

  const batas = 30 * 60 * 1000;
  if (!isDireksi && (!isOwner || Date.now() - kom.createdAt.getTime() > batas))
    return res.status(403).json({ message: 'Tidak dapat menghapus komentar ini' });

  await kom.deleteOne();
  res.json({ message: 'Komentar dihapus' });
});

module.exports = router;
