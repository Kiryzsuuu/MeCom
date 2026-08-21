const router      = require('express').Router();
const crypto      = require('crypto');
const User        = require('../models/User');
const auth        = require('../middleware/auth');
const { requireRole, requireSuperadmin, TOP_TIER_ROLES } = require('../middleware/roles');
const { uploadAvatar } = require('../middleware/upload');
const { mailPasswordReset } = require('../services/mailer');
const audit = require('../services/audit');

// GET /api/users — Sekretaris CoE/Wakil Direktur CoE/Direktur CoE: semua user; Dosen: tidak bisa
router.get('/', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const { direktoratId, role, search, limit } = req.query;
  const filter = {};
  if (direktoratId) filter.direktoratId = direktoratId;
  if (role) filter.role = role;
  if (search) filter.namaLengkap = { $regex: search, $options: 'i' };

  let q = User.find(filter)
    .populate('direktoratId', 'nama kode')
    .select('-passwordHash')
    .sort({ namaLengkap: 1 });
  if (limit) q = q.limit(parseInt(limit));

  const users = await q;
  res.json(users);
});

// GET /api/users/selectable — daftar user aktif untuk dipilih sebagai assignee (semua user login)
router.get('/selectable', auth, async (req, res) => {
  const { search } = req.query;
  const filter = { statusAktif: true };
  if (search) filter.namaLengkap = { $regex: search, $options: 'i' };
  const users = await User.find(filter)
    .select('namaLengkap email fotoProfil role direktoratId statusAktif')
    .populate('direktoratId', 'nama kode')
    .sort({ namaLengkap: 1 });
  res.json(users);
});

// GET /api/users/mention — autocomplete @mention, semua authenticated user bisa akses
router.get('/mention', auth, async (req, res) => {
  const { q } = req.query;
  const filter = { statusAktif: true };
  if (q) filter.namaLengkap = { $regex: q, $options: 'i' };
  const users = await User.find(filter)
    .select('namaLengkap email fotoProfil role direktoratId')
    .populate('direktoratId', 'kode')
    .sort({ namaLengkap: 1 })
    .limit(10);
  res.json(users);
});

// GET /api/users/dosen-direktorat/:id — dosen dalam direktorat tertentu
router.get('/dosen-direktorat/:id', auth, async (req, res) => {
  // Dosen hanya bisa lihat direktorat sendiri
  if (req.user.role === 'dosen') {
    const userDirId = req.user.direktoratId?._id?.toString() || req.user.direktoratId?.toString();
    if (userDirId !== req.params.id) {
      return res.status(403).json({ message: 'Akses ditolak' });
    }
  }
  const users = await User.find({ direktoratId: req.params.id, role: 'dosen', statusAktif: true })
    .select('-passwordHash')
    .sort({ namaLengkap: 1 });
  res.json(users);
});

// POST /api/users — Sekretaris CoE/Wakil Direktur CoE/Direktur CoE buat user baru
router.post('/', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const { namaLengkap, email, password, role, direktoratId, nomorWa } = req.body;
  if (!namaLengkap || !email || !role)
    return res.status(400).json({ message: 'Nama, email, dan role wajib diisi' });
  if (password && password.length < 6)
    return res.status(400).json({ message: 'Password minimal 6 karakter' });

  // Hanya level top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) yang bisa buat akun top-tier baru
  if (TOP_TIER_ROLES.includes(role) && !TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Hanya Direktur CoE/Wakil Direktur CoE/Sekretaris CoE yang bisa membuat akun level tersebut' });

  if (role === 'dosen' && !direktoratId)
    return res.status(400).json({ message: 'Dosen wajib memiliki direktorat' });

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(400).json({ message: 'Email sudah terdaftar' });

  // Pakai password yang diketik admin di form kalau ada; kalau kosong, generate random & kirim via email
  const usedGeneratedPassword = !password;
  const finalPassword = password || crypto.randomBytes(6).toString('hex');

  const user = await User.create({
    namaLengkap,
    email,
    passwordHash: finalPassword,
    role,
    direktoratId: TOP_TIER_ROLES.includes(role) ? null : direktoratId,
    nomorWa: nomorWa || null,
    isFirstLogin: true,
  });

  if (usedGeneratedPassword) await mailPasswordReset(user, finalPassword);

  audit.log(req, 'user.create', { target:'User', targetId: user._id, detail: { email, role } });
  res.status(201).json({
    message: usedGeneratedPassword ? 'User berhasil dibuat, password dikirim via email' : 'User berhasil dibuat',
    user: user.toPublic(),
  });
});

// PUT /api/users/me — shortcut untuk edit profil sendiri
router.put('/me', auth, async (req, res) => {
  const user = req.user;
  if (req.body.namaLengkap !== undefined) user.namaLengkap = req.body.namaLengkap;
  if (req.body.notifEmail  !== undefined) user.notifEmail  = req.body.notifEmail;
  if (req.body.notifWa     !== undefined) user.notifWa     = req.body.notifWa;
  if (req.body.nomorWa     !== undefined) user.nomorWa     = req.body.nomorWa;
  await user.save();
  res.json({ message: 'Profil diupdate', user: user.toPublic() });
});

// GET /api/users/:id
router.get('/:id', auth, async (req, res) => {
  const user = await User.findById(req.params.id).populate('direktoratId', 'nama kode').select('-passwordHash');
  if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
  res.json(user);
});

// PUT /api/users/:id — top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) edit user, atau user edit diri sendiri (profil)
router.put('/:id', auth, async (req, res) => {
  const isSelf = req.user._id.toString() === req.params.id;
  const isTopTier = TOP_TIER_ROLES.includes(req.user.role);
  if (!isSelf && !isTopTier)
    return res.status(403).json({ message: 'Akses ditolak' });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

  // Akun top-tier hanya bisa diedit oleh sesama top-tier
  if (TOP_TIER_ROLES.includes(user.role) && !isTopTier)
    return res.status(403).json({ message: 'Akses ditolak' });

  if (isSelf) {
    // User bisa update profil sendiri
    if (req.body.namaLengkap) user.namaLengkap = req.body.namaLengkap;
    if (req.body.notifEmail !== undefined) user.notifEmail = req.body.notifEmail;
    if (req.body.notifWa    !== undefined) user.notifWa    = req.body.notifWa;
    if (req.body.nomorWa    !== undefined) user.nomorWa    = req.body.nomorWa;
  }

  if (isTopTier) {
    // Direktur CoE/Wakil Direktur CoE/Sekretaris CoE bisa update field umum
    if (req.body.namaLengkap !== undefined) user.namaLengkap = req.body.namaLengkap;
    if (req.body.email       !== undefined) user.email       = req.body.email;
    if (req.body.direktoratId!== undefined) user.direktoratId= req.body.direktoratId;
    if (req.body.statusAktif !== undefined) user.statusAktif = req.body.statusAktif;
    if (req.body.nomorWa     !== undefined) user.nomorWa     = req.body.nomorWa;
    // Hanya top-tier yang bisa ganti role
    if (req.body.role !== undefined) {
      if (!isTopTier)
        return res.status(403).json({ message: 'Hanya Direktur CoE/Wakil Direktur CoE/Sekretaris CoE yang bisa mengubah role' });
      user.role = req.body.role;
    }
  }

  await user.save();
  res.json({ message: 'User berhasil diupdate', user: user.toPublic() });
});

// POST /api/users/:id/reset-password — Sekretaris CoE/Wakil Direktur CoE/Direktur CoE reset password
router.post('/:id/reset-password', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

  const newPassword = req.body.passwordBaru || crypto.randomBytes(6).toString('hex');
  user.passwordHash = newPassword;
  user.isFirstLogin = true;
  await user.save();

  if (!req.body.passwordBaru) await mailPasswordReset(user, newPassword);
  audit.log(req, 'user.reset_password', { target:'User', targetId: user._id, detail: { email: user.email } });
  res.json({ message: 'Password berhasil direset' });
});

// DELETE /api/users/:id — hanya top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE)
router.delete('/:id', auth, requireSuperadmin, async (req, res) => {
  if (req.user._id.toString() === req.params.id)
    return res.status(400).json({ message: 'Tidak bisa menghapus akun sendiri' });
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });
  audit.log(req, 'user.delete', { target:'User', targetId: user._id, detail: { email: user.email, role: user.role } });
  res.json({ message: `User ${user.email} berhasil dihapus` });
});

// POST /api/users/me/avatar — Upload foto profil (base64)
router.post('/me/avatar', auth, async (req, res) => {
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ message: 'Data foto tidak ditemukan' });
  // Validasi format
  if (!base64.startsWith('data:image/')) return res.status(400).json({ message: 'Format tidak valid, harus image' });
  // Validasi ukuran (max ~2MB base64 ≈ 1.5MB asli)
  if (base64.length > 2.8 * 1024 * 1024) return res.status(400).json({ message: 'Ukuran foto maksimal 2MB' });
  req.user.fotoProfil = base64;
  await req.user.save();
  res.json({ message: 'Foto profil diupdate', user: req.user.toPublic() });
});

module.exports = router;
