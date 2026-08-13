const router   = require('express').Router();
const AuditLog = require('../models/AuditLog');
const auth     = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/audit — hanya top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE)
router.get('/', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const { userId, aksi, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (userId) filter.userId = userId;
  if (aksi)   filter.aksi   = { $regex: aksi, $options: 'i' };

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('userId', 'namaLengkap email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit)),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ logs, total, page: parseInt(page) });
});

module.exports = router;
