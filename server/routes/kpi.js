const router      = require('express').Router();
const User        = require('../models/User');
const KpiSnapshot = require('../models/KpiSnapshot');
const auth        = require('../middleware/auth');
const { requireRole, TOP_TIER_ROLES, BASIC_ROLES, KPI_SUBJECT_ROLES } = require('../middleware/roles');
const { hitungKpiManager, simpanSnapshot, hitungGrade, labelGrade } = require('../services/kpi');

// GET /api/kpi/me — KPI diri sendiri (real-time)
router.get('/me', auth, async (req, res) => {
  const now    = new Date();
  const bulan  = parseInt(req.query.bulan)  || now.getMonth() + 1;
  const tahun  = parseInt(req.query.tahun)  || now.getFullYear();

  const kpi = await hitungKpiManager(req.user._id, bulan, tahun);
  res.json({ userId: req.user._id, bulan, tahun, ...kpi });
});

// GET /api/kpi/manager/:id — top-tier lihat KPI Dosen tertentu
router.get('/manager/:id', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const now   = new Date();
  const bulan = parseInt(req.query.bulan) || now.getMonth() + 1;
  const tahun = parseInt(req.query.tahun) || now.getFullYear();

  const kpi = await hitungKpiManager(req.params.id, bulan, tahun);
  const user = await User.findById(req.params.id).populate('direktoratId', 'nama kode').select('-passwordHash');
  res.json({ user, bulan, tahun, ...kpi });
});

// GET /api/kpi/semua — top-tier lihat semua KPI Dosen (tabel)
router.get('/semua', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const now        = new Date();
  const bulan      = parseInt(req.query.bulan)      || now.getMonth() + 1;
  const tahun      = parseInt(req.query.tahun)      || now.getFullYear();
  const direktoratId = req.query.direktoratId;

  const filter = { role: { $in: KPI_SUBJECT_ROLES }, statusAktif: true };
  if (direktoratId) filter.direktoratId = direktoratId;

  const managers = await User.find(filter).populate('direktoratId', 'nama kode').select('-passwordHash');

  const result = await Promise.all(managers.map(async m => {
    const kpi = await hitungKpiManager(m._id, bulan, tahun);
    return {
      user: m,
      userId: m._id,
      namaLengkap: m.namaLengkap,
      direktorat: m.direktoratId?.nama || '',
      role: m.role,
      bulan, tahun,
      ...kpi,
    };
  }));

  res.json({ managers: result });
});

// GET /api/kpi/riwayat/:userId — Riwayat 12 bulan
router.get('/riwayat/:userId', auth, async (req, res) => {
  const isSelf    = req.user._id.toString() === req.params.userId;
  const isDireksi = TOP_TIER_ROLES.includes(req.user.role);
  if (!isSelf && !isDireksi)
    return res.status(403).json({ message: 'Akses ditolak: KPI bersifat privat' });

  const snaps = await KpiSnapshot.find({ userId: req.params.userId })
    .sort({ periodeTahun: -1, periodeBulan: -1 })
    .limit(12);

  res.json(snaps);
});

// POST /api/kpi/simpan-snapshot — simpan snapshot bulan ini (bisa dipanggil manual/cron)
router.post('/simpan-snapshot', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const { userId, bulan, tahun, targetKpi } = req.body;
  const snap = await simpanSnapshot(userId, bulan, tahun, targetKpi);
  res.json(snap);
});

// PUT /api/kpi/target — top-tier set target KPI
router.put('/target', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const { userId, target } = req.body;
  if (!userId || target === undefined)
    return res.status(400).json({ message: 'userId dan target wajib' });

  const now = new Date();
  const snap = await KpiSnapshot.findOneAndUpdate(
    { userId, periodeBulan: now.getMonth() + 1, periodeTahun: now.getFullYear() },
    { targetKpi: target },
    { upsert: true, new: true }
  );
  res.json(snap);
});

module.exports = router;
