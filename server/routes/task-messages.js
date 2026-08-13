const router      = require('express').Router();
const TaskMessage = require('../models/TaskMessage');
const Task        = require('../models/Task');
const auth        = require('../middleware/auth');
const { getIO }   = require('../socket');
const { TOP_TIER_ROLES } = require('../middleware/roles');

function canAccess(user, task) {
  if (TOP_TIER_ROLES.includes(user.role)) return true;
  if (task.dibuatOleh?.toString() === user._id.toString()) return true;
  return (task.assignees || []).some(c => c.toString() === user._id.toString());
}

// GET /api/tasks/:taskId/messages
router.get('/', auth, async (req, res) => {
  const { taskId } = req.params;
  const task = await Task.findById(taskId);
  if (!task || task.isDeleted) return res.status(404).json({ message: 'Task tidak ditemukan' });
  if (!canAccess(req.user, task)) return res.status(403).json({ message: 'Akses ditolak' });

  const msgs = await TaskMessage.find({ taskId })
    .populate('userId', 'namaLengkap fotoProfil')
    .sort({ createdAt: 1 })
    .limit(200);
  res.json(msgs);
});

// POST /api/tasks/:taskId/messages
router.post('/', auth, async (req, res) => {
  const { taskId } = req.params;
  const { isi } = req.body;
  if (!isi?.trim()) return res.status(400).json({ message: 'Pesan tidak boleh kosong' });

  const task = await Task.findById(taskId);
  if (!task || task.isDeleted) return res.status(404).json({ message: 'Task tidak ditemukan' });
  if (!canAccess(req.user, task)) return res.status(403).json({ message: 'Akses ditolak' });

  const msg = await TaskMessage.create({ taskId, userId: req.user._id, isi: isi.trim() });
  await msg.populate('userId', 'namaLengkap fotoProfil');

  // Emit realtime ke room task
  const io = getIO();
  if (io) io.to(`task:${taskId}`).emit('task:message', msg);

  res.status(201).json(msg);
});

// DELETE /api/tasks/:taskId/messages/:msgId
router.delete('/:msgId', auth, async (req, res) => {
  const msg = await TaskMessage.findById(req.params.msgId);
  if (!msg) return res.status(404).json({ message: 'Pesan tidak ditemukan' });

  const isOwner = msg.userId.toString() === req.user._id.toString();
  const isAdmin = TOP_TIER_ROLES.includes(req.user.role);
  if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Akses ditolak' });

  await msg.deleteOne();

  const io = getIO();
  if (io) io.to(`task:${req.params.taskId}`).emit('task:message-deleted', { _id: req.params.msgId });

  res.json({ message: 'Pesan dihapus' });
});

module.exports = router;
