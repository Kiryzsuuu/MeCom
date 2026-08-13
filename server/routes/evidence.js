const router   = require('express').Router();
const path     = require('path');
const Evidence = require('../models/Evidence');
const Task     = require('../models/Task');
const auth     = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { TOP_TIER_ROLES } = require('../middleware/roles');

// Req #3: semua user bisa melihat task & evidence
function canAccessEvidence() { return true; }

function canEditEvidence(user, task) {
  if (TOP_TIER_ROLES.includes(user.role)) return true;
  if ((task.dibuatOleh?.toString() || '') === user._id.toString()) return true;
  return (task.assignees || []).map(c => c.toString()).includes(user._id.toString());
}

// GET /api/evidence?taskId=xxx[&subtaskId=yyy]
router.get('/', auth, async (req, res) => {
  const { taskId, subtaskId } = req.query;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });

  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const q = { taskId };
  // subtaskId='none' → lampiran level task saja; ada id → lampiran subtask itu
  if (subtaskId === 'none') q.subtaskId = null;
  else if (subtaskId)       q.subtaskId = subtaskId;

  const evidences = await Evidence.find(q).populate('uploaderId', 'namaLengkap').sort({ createdAt: -1 });
  res.json(evidences);
});

// POST /api/evidence — upload file
router.post('/', auth, upload.single('file'), async (req, res) => {
  const { taskId, subtaskId } = req.body;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });
  if (!req.file) return res.status(400).json({ message: 'File wajib diupload' });

  const task = await Task.findById(taskId);
  if (!task || task.isDeleted)
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  // Untuk lampiran subtask: assignee subtask boleh upload; selain itu creator/assignee task
  let allowed = canEditEvidence(req.user, task);
  if (subtaskId) {
    const Subtask = require('../models/Subtask');
    const sub = await Subtask.findById(subtaskId);
    if (sub && (sub.assignees || []).map(a => a.toString()).includes(req.user._id.toString())) allowed = true;
  }
  if (!allowed)
    return res.status(403).json({ message: 'Hanya assignee atau pembuat yang dapat upload file' });

  const count = await Evidence.countDocuments({ taskId, subtaskId: subtaskId || null });
  if (count >= 10)
    return res.status(400).json({ message: 'Maksimal 10 file per item' });

  const ev = await Evidence.create({
    taskId,
    subtaskId:  subtaskId || null,
    uploaderId: req.user._id,
    namaFile:   req.file.originalname,
    urlFile:    `/uploads/evidence/${req.file.filename}`,
    ukuran:     req.file.size,
    mimeType:   req.file.mimetype,
  });

  res.status(201).json(ev);
});

// DELETE /api/evidence/:id
router.delete('/:id', auth, async (req, res) => {
  const ev   = await Evidence.findById(req.params.id);
  if (!ev) return res.status(404).json({ message: 'Evidence tidak ditemukan' });

  const task = await Task.findById(ev.taskId);

  if (task.status === 'complete') {
    if (!TOP_TIER_ROLES.includes(req.user.role))
      return res.status(403).json({ message: 'File task selesai hanya dapat dihapus oleh Direktur CoE/Wakil Direktur CoE/Sekretaris CoE' });
  } else {
    if (!canEditEvidence(req.user, task))
      return res.status(403).json({ message: 'Hanya assignee atau pembuat yang dapat menghapus file' });
  }

  // Hapus file fisik
  const fs = require('fs');
  const filePath = path.join(__dirname, '../../', ev.urlFile);
  fs.unlink(filePath, () => {});

  await ev.deleteOne();
  res.json({ message: 'Evidence dihapus' });
});

module.exports = router;
