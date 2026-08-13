const router     = require('express').Router();
const Direktorat = require('../models/Direktorat');
const auth       = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

// GET /api/direktorat
router.get('/', auth, async (req, res) => {
  const list = await Direktorat.find().sort({ nama: 1 });
  res.json(list);
});

// POST /api/direktorat — top-tier saja
router.post('/', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const { nama, kode } = req.body;
  if (!nama || !kode) return res.status(400).json({ message: 'Nama dan kode wajib diisi' });
  const d = await Direktorat.create({ nama, kode });
  res.status(201).json(d);
});

// PUT /api/direktorat/:id
router.put('/:id', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const d = await Direktorat.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!d) return res.status(404).json({ message: 'Direktorat tidak ditemukan' });
  res.json(d);
});

module.exports = router;
