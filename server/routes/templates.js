const router   = require('express').Router();
const Template = require('../models/TaskTemplate');
const Task     = require('../models/Task');
const Subtask  = require('../models/Subtask');
const auth     = require('../middleware/auth');
const { TOP_TIER_ROLES } = require('../middleware/roles');

// GET /api/templates
router.get('/', auth, async (req, res) => {
  const templates = await Template.find({ isPublic: true })
    .populate('createdBy', 'namaLengkap')
    .sort({ createdAt: -1 });
  res.json({ templates });
});

// POST /api/templates — buat template baru
router.post('/', auth, async (req, res) => {
  const { nama, deskripsi, prioritas, durasiHari, tags, subtasks } = req.body;
  if (!nama) return res.status(400).json({ message: 'Nama template wajib diisi' });

  const tpl = await Template.create({
    nama, deskripsi, prioritas, durasiHari,
    tags: tags || [],
    subtasks: subtasks || [],
    createdBy: req.user._id,
  });
  res.status(201).json({ message: 'Template disimpan', template: tpl });
});

// POST /api/templates/from-task/:taskId — simpan task yang ada sebagai template
router.post('/from-task/:taskId', auth, async (req, res) => {
  const task = await Task.findById(req.params.taskId);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const subtasks = await Subtask.find({ taskId: task._id }).sort({ urutan: 1 });

  const durasiHari = task.deadline && task.approvedAt
    ? Math.max(1, Math.round((new Date(task.deadline) - new Date(task.approvedAt)) / 86400000))
    : 7;

  const { nama: namaOverride } = req.body;
  const tpl = await Template.create({
    nama:      namaOverride || `Template: ${task.judul}`,
    deskripsi: task.deskripsi,
    prioritas: task.prioritas,
    durasiHari,
    tags:      task.tags || [],
    subtasks:  subtasks.map((s, i) => ({ judul: s.judul, urutan: i })),
    createdBy: req.user._id,
  });
  res.status(201).json({ message: 'Template disimpan dari task', template: tpl });
});

// POST /api/templates/:id/apply — buat task dari template
router.post('/:id/apply', auth, async (req, res) => {
  const tpl = await Template.findById(req.params.id);
  if (!tpl) return res.status(404).json({ message: 'Template tidak ditemukan' });

  const { assignees, direktoratId, deadline, judul: judulOverride } = req.body;
  if (!assignees?.length || !direktoratId || !deadline)
    return res.status(400).json({ message: 'Assignee, direktorat, dan deadline wajib diisi' });

  const task = await Task.create({
    judul:        judulOverride || tpl.nama,
    deskripsi:    tpl.deskripsi,
    prioritas:    tpl.prioritas,
    assignees,
    direktoratId,
    deadline:     new Date(deadline),
    dibuatOleh:   req.user._id,
    templateId:   tpl._id,
  });

  // Buat subtasks dari template
  for (const [i, st] of tpl.subtasks.entries()) {
    await Subtask.create({ taskId: task._id, judul: st.judul, urutan: i });
  }

  await task.populate([
    { path: 'assignees', select: 'namaLengkap email' },
    { path: 'direktoratId', select: 'nama kode' },
  ]);

  res.status(201).json({ message: 'Task dibuat dari template', task });
});

// DELETE /api/templates/:id
router.delete('/:id', auth, async (req, res) => {
  const tpl = await Template.findById(req.params.id);
  if (!tpl) return res.status(404).json({ message: 'Template tidak ditemukan' });
  if (tpl.createdBy.toString() !== req.user._id.toString() && !TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Tidak diizinkan' });

  await tpl.deleteOne();
  res.json({ message: 'Template dihapus' });
});

module.exports = router;
