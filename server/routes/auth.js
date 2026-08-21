const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User   = require('../models/User');
const auth   = require('../middleware/auth');
const { TOP_TIER_ROLES } = require('../middleware/roles');
const { sendMail } = require('../services/mailer');

// OTP store: { email -> { otp, expiry, userId } }
const otpStore = new Map();

function genOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: 'Email dan password wajib diisi' });

  const val  = email.trim().toLowerCase();
  const user = await User.findOne({ email: val }).populate('direktoratId');
  if (!user)
    return res.status(401).json({ message: 'Email atau password salah' });
  if (!user.statusAktif)
    return res.status(401).json({ message: 'Akun Anda tidak aktif. Hubungi administrator.' });

  const ok = await user.comparePassword(password);
  if (!ok)
    return res.status(401).json({ message: 'Email atau password salah' });

  const token = jwt.sign(
    { id: user._id, namaLengkap: user.namaLengkap },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  );

  res.json({ token, user: user.toPublic() });
});

// POST /api/auth/logout  (client-side: buang token)
router.post('/logout', auth, (req, res) => {
  res.json({ message: 'Berhasil logout' });
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

// PUT /api/auth/change-password
router.put('/change-password', auth, async (req, res) => {
  const { passwordLama, passwordBaru } = req.body;
  if (!passwordLama || !passwordBaru)
    return res.status(400).json({ message: 'Password lama dan baru wajib diisi' });
  if (passwordBaru.length < 8)
    return res.status(400).json({ message: 'Password baru minimal 8 karakter' });

  const ok = await req.user.comparePassword(passwordLama);
  if (!ok) return res.status(400).json({ message: 'Password lama salah' });

  req.user.passwordHash  = passwordBaru;
  req.user.isFirstLogin  = false;
  await req.user.save();

  res.json({ message: 'Password berhasil diubah' });
});

// POST /api/auth/verify-identity — re-auth (ENIK + password) untuk fitur sensitif
router.post('/verify-identity', auth, async (req, res) => {
  const { enik, password } = req.body;
  if (!enik || !password) return res.status(400).json({ message: 'ENIK dan password wajib diisi' });

  const val = String(enik).trim();
  const cocokEnik = (req.user.enik && req.user.enik === val) ||
                    (req.user.email && req.user.email.toLowerCase() === val.toLowerCase());
  if (!cocokEnik) return res.status(401).json({ message: 'ENIK tidak cocok dengan akun Anda' });

  const ok = await req.user.comparePassword(password);
  if (!ok) return res.status(401).json({ message: 'Password salah' });

  res.json({ ok: true });
});

// POST /api/auth/forgot-password — kirim OTP ke email
router.post('/forgot-password', async (req, res) => {
  const { identifier } = req.body; // bisa ENIK atau email
  if (!identifier) return res.status(400).json({ message: 'ENIK atau email wajib diisi' });

  const val  = identifier.trim();
  const user = await User.findOne({ $or: [{ enik: val }, { email: val.toLowerCase() }] });
  if (!user) return res.status(404).json({ message: 'Akun tidak ditemukan' });
  if (!user.statusAktif) return res.status(403).json({ message: 'Akun tidak aktif' });

  const otp    = genOTP();
  const expiry = Date.now() + 10 * 60 * 1000; // 10 menit
  otpStore.set(user.email, { otp, expiry, userId: user._id.toString() });

  // Kirim email
  const mailSent = process.env.MAIL_USER && process.env.MAIL_PASS;
  if (mailSent) {
    await sendMail({
      to: user.email,
      subject: '[WorkPulse AILO] Kode OTP Reset Password',
      html: `
        <!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>body{font-family:-apple-system,Arial,sans-serif;background:#F2F2F5;margin:0;padding:20px}
        .wrap{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden}
        .hdr{background:#0E7C91;padding:18px 24px}.hdr h1{color:#fff;margin:0;font-size:15px}
        .hdr span{color:#F5821F}.body{padding:28px;color:#18181B;font-size:14px;line-height:1.6}
        .otp{font-size:36px;font-weight:800;letter-spacing:8px;color:#0E7C91;text-align:center;padding:20px;background:#E4F3F5;border-radius:10px;margin:20px 0}
        .ftr{padding:14px 24px;background:#F7F7F9;font-size:12px;color:#71717A}</style></head>
        <body><div class="wrap">
        <div class="hdr"><h1>Work<span>Pulse</span></h1></div>
        <div class="body">
          <p>Halo <strong>${user.namaLengkap}</strong>,</p>
          <p>Gunakan kode OTP berikut untuk mereset password Anda:</p>
          <div class="otp">${otp}</div>
          <p>Kode berlaku selama <strong>10 menit</strong>. Jangan bagikan kode ini kepada siapapun.</p>
          <p style="font-size:12px;color:#71717A">Jika Anda tidak merasa meminta reset password, abaikan email ini.</p>
        </div>
        <div class="ftr">WorkPulse AILO — Sistem internal perusahaan.</div>
        </div></body></html>`,
    });
  }

  // Dev mode: tampilkan OTP di response (hapus di production)
  const devInfo = process.env.NODE_ENV !== 'production' ? { _devOtp: otp } : {};
  res.json({
    message: `Kode OTP telah dikirim ke email ${user.email.replace(/(.{2}).+(@.+)/, '$1***$2')}`,
    email: user.email.replace(/(.{2}).+(@.+)/, '$1***$2'),
    ...devInfo,
  });
});

// POST /api/auth/verify-otp — verifikasi OTP, return reset token
router.post('/verify-otp', async (req, res) => {
  const { identifier, otp } = req.body;
  if (!identifier || !otp) return res.status(400).json({ message: 'Identifier dan OTP wajib diisi' });

  const val  = identifier.trim();
  const user = await User.findOne({ $or: [{ enik: val }, { email: val.toLowerCase() }] });
  if (!user) return res.status(404).json({ message: 'Akun tidak ditemukan' });

  const record = otpStore.get(user.email);
  if (!record)                      return res.status(400).json({ message: 'OTP tidak ditemukan atau sudah kadaluarsa' });
  if (Date.now() > record.expiry)   { otpStore.delete(user.email); return res.status(400).json({ message: 'OTP sudah kadaluarsa, minta kode baru' }); }
  if (record.otp !== otp.trim())    return res.status(400).json({ message: 'Kode OTP salah' });

  // OTP valid — buat reset token (berlaku 15 menit)
  const resetToken = crypto.randomBytes(32).toString('hex');
  record.resetToken = resetToken;
  record.resetExpiry = Date.now() + 15 * 60 * 1000;
  otpStore.set(user.email, record);

  res.json({ message: 'OTP valid', resetToken });
});

// POST /api/auth/reset-password — ganti password dengan reset token
router.post('/reset-password', async (req, res) => {
  const { identifier, resetToken, passwordBaru } = req.body;
  if (!identifier || !resetToken || !passwordBaru)
    return res.status(400).json({ message: 'Data tidak lengkap' });
  if (passwordBaru.length < 6)
    return res.status(400).json({ message: 'Password minimal 6 karakter' });

  const val  = identifier.trim();
  const user = await User.findOne({ $or: [{ enik: val }, { email: val.toLowerCase() }] });
  if (!user) return res.status(404).json({ message: 'Akun tidak ditemukan' });

  const record = otpStore.get(user.email);
  if (!record || record.resetToken !== resetToken)
    return res.status(400).json({ message: 'Token tidak valid' });
  if (Date.now() > record.resetExpiry)
    { otpStore.delete(user.email); return res.status(400).json({ message: 'Token kadaluarsa, ulangi proses' }); }

  user.passwordHash = passwordBaru;
  await user.save();
  otpStore.delete(user.email);

  res.json({ message: 'Password berhasil direset, silakan login' });
});

// POST /api/auth/impersonate/:userId — top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) menyamar sebagai user lain
router.post('/impersonate/:userId', auth, async (req, res) => {
  if (!TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Hanya Direktur CoE/Wakil Direktur CoE/Sekretaris CoE yang dapat melakukan impersonasi' });

  const target = await User.findById(req.params.userId).populate('direktoratId');
  if (!target) return res.status(404).json({ message: 'User tidak ditemukan' });
  if (!target.statusAktif) return res.status(400).json({ message: 'Akun target tidak aktif' });
  if (TOP_TIER_ROLES.includes(target.role)) return res.status(400).json({ message: 'Tidak dapat menyamar sebagai akun top-tier lain' });

  const token = jwt.sign(
    { id: target._id, impersonatedBy: req.user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '2h' }
  );

  res.json({ token, user: target.toPublic(), impersonatedBy: { id: req.user._id, nama: req.user.namaLengkap } });
});

// POST /api/auth/stop-impersonate — kembalikan ke session asli (client-side)
// (frontend cukup restore token asli, endpoint ini hanya untuk logging jika perlu)
router.post('/stop-impersonate', auth, (req, res) => {
  res.json({ message: 'ok' });
});

module.exports = router;
