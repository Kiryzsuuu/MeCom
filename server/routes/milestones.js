const router    = require('express').Router();
const Milestone = require('../models/Milestone');
const Task      = require('../models/Task');
const auth      = require('../middleware/auth');
const { requireRole, TOP_TIER_ROLES } = require('../middleware/roles');

// GET /api/milestones
router.get('/', auth, async (req, res) => {
  const { direktoratId, status } = req.query;
  const filter = {};
  if (direktoratId) filter.direktoratId = direktoratId;
  if (status) filter.status = status;

  // dosen hanya lihat direktorat sendiri (jika tidak filter)
  if (req.user.role === 'dosen' && !direktoratId) {
    filter.$or = [
      { direktoratId: req.user.direktoratId?._id || req.user.direktoratId },
      { direktoratId: null },
    ];
  }

  const milestones = await Milestone.find(filter)
    .populate('direktoratId', 'nama kode')
    .populate('createdBy', 'namaLengkap')
    .populate('taskIds', 'judul status')
    .sort({ tanggal: 1 });

  res.json({ milestones });
});

// POST /api/milestones
router.post('/', auth, async (req, res) => {
  const { judul, deskripsi, tanggal, direktoratId, taskIds, warna } = req.body;
  if (!judul || !tanggal) return res.status(400).json({ message: 'Judul dan tanggal wajib diisi' });

  const ms = await Milestone.create({
    judul, deskripsi, tanggal: new Date(tanggal),
    direktoratId: direktoratId || null,
    taskIds: taskIds || [],
    warna: warna || '#6366F1',
    createdBy: req.user._id,
  });

  // Sinkronkan milestoneId ke task terpilih
  if (Array.isArray(taskIds) && taskIds.length) {
    await Task.updateMany({ _id: { $in: taskIds } }, { milestoneId: ms._id });
  }

  await ms.populate([
    { path: 'direktoratId', select: 'nama kode' },
    { path: 'createdBy', select: 'namaLengkap' },
  ]);

  res.status(201).json({ message: 'Milestone dibuat', milestone: ms });
});

// PUT /api/milestones/:id
router.put('/:id', auth, async (req, res) => {
  const ms = await Milestone.findById(req.params.id);
  if (!ms) return res.status(404).json({ message: 'Milestone tidak ditemukan' });

  const { judul, deskripsi, tanggal, status, direktoratId, taskIds, warna } = req.body;
  if (judul)        ms.judul        = judul;
  if (deskripsi !== undefined) ms.deskripsi = deskripsi;
  if (tanggal)      ms.tanggal      = new Date(tanggal);
  if (status)       ms.status       = status;
  if (direktoratId !== undefined) ms.direktoratId = direktoratId || null;
  if (warna)        ms.warna        = warna;

  if (taskIds) {
    const oldIds = (ms.taskIds || []).map(t => t.toString());
    const newIds = taskIds.map(t => t.toString());
    const added   = newIds.filter(id => !oldIds.includes(id));
    const removed = oldIds.filter(id => !newIds.includes(id));
    if (added.length)   await Task.updateMany({ _id: { $in: added } },   { milestoneId: ms._id });
    if (removed.length) await Task.updateMany({ _id: { $in: removed } }, { milestoneId: null });
    ms.taskIds = taskIds;
  }

  await ms.save();
  res.json({ message: 'Milestone diupdate', milestone: ms });
});

// POST /api/milestones/:id/tasks — tambah task ke milestone
router.post('/:id/tasks', auth, async (req, res) => {
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });

  const ms = await Milestone.findById(req.params.id);
  if (!ms) return res.status(404).json({ message: 'Milestone tidak ditemukan' });

  if (!ms.taskIds.some(t => t.toString() === taskId)) {
    ms.taskIds.push(taskId);
    await ms.save();
  }
  // Sinkronisasi milestoneId di task
  await Task.findByIdAndUpdate(taskId, { milestoneId: ms._id });

  res.json({ message: 'Task ditambahkan ke milestone' });
});

// DELETE /api/milestones/:id/tasks/:taskId — hapus task dari milestone
router.delete('/:id/tasks/:taskId', auth, async (req, res) => {
  const ms = await Milestone.findById(req.params.id);
  if (!ms) return res.status(404).json({ message: 'Milestone tidak ditemukan' });

  ms.taskIds = ms.taskIds.filter(t => t.toString() !== req.params.taskId);
  await ms.save();
  await Task.findByIdAndUpdate(req.params.taskId, { milestoneId: null });

  res.json({ message: 'Task dihapus dari milestone' });
});

// DELETE /api/milestones/:id
router.delete('/:id', auth, async (req, res) => {
  const ms = await Milestone.findById(req.params.id);
  if (!ms) return res.status(404).json({ message: 'Milestone tidak ditemukan' });

  if (ms.createdBy.toString() !== req.user._id.toString() && !TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Tidak diizinkan' });

  await ms.deleteOne();
  res.json({ message: 'Milestone dihapus' });
});

module.exports = router;
