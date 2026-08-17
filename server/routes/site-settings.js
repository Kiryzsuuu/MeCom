const router       = require('express').Router();
const path         = require('path');
const fs           = require('fs');
const multer       = require('multer');
const auth         = require('../middleware/auth');
const { requireSuperadmin } = require('../middleware/roles');
const SiteSettings = require('../models/SiteSettings');

const logoStorage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(__dirname, '../../public/img');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, 'logo' + ext);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (/image\/(png|jpeg|jpg|svg\+xml|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Hanya file gambar yang diizinkan'));
  },
});

async function getSettings() {
  let s = await SiteSettings.findOne();
  if (!s) s = await SiteSettings.create({});
  return s;
}

// GET /api/site-settings — publik
router.get('/', async (req, res) => {
  const s = await getSettings();
  res.json(s);
});

// PUT /api/site-settings — top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE)
router.put('/', auth, requireSuperadmin, async (req, res) => {
  const {
    appName, accentColor,
    heroLine1, heroLine2, heroSub, loginFeatures,
    loginTitle, loginSubtitle,
    smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, smtpFrom,
  } = req.body;

  const s = await getSettings();
  if (appName      !== undefined) s.appName      = appName;
  if (accentColor  !== undefined) s.accentColor  = accentColor;
  if (heroLine1    !== undefined) s.heroLine1    = heroLine1;
  if (heroLine2    !== undefined) s.heroLine2    = heroLine2;
  if (heroSub      !== undefined) s.heroSub      = heroSub;
  if (loginTitle   !== undefined) s.loginTitle   = loginTitle;
  if (loginSubtitle!== undefined) s.loginSubtitle= loginSubtitle;
  if (Array.isArray(loginFeatures)) s.loginFeatures = loginFeatures;
  if (smtpHost   !== undefined) s.smtpHost   = smtpHost;
  if (smtpPort   !== undefined) s.smtpPort   = Number(smtpPort) || 587;
  if (smtpSecure !== undefined) s.smtpSecure = Boolean(smtpSecure);
  if (smtpUser   !== undefined) s.smtpUser   = smtpUser;
  if (smtpPass)                 s.smtpPass   = smtpPass; // skip empty string — preserve existing password
  if (smtpFrom   !== undefined) s.smtpFrom   = smtpFrom;

  await s.save();

  res.json({ message: 'Pengaturan disimpan', settings: s });
});

// POST /api/site-settings/smtp-test — kirim email test
router.post('/smtp-test', auth, requireSuperadmin, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ message: 'Email tujuan diperlukan' });
  const mailer = require('../services/mailer');
  try {
    await mailer.sendMail({
      to,
      subject: '[WorkPulse AILO] Test SMTP Berhasil',
      html: `<div style="font-family:Arial;padding:20px"><h2 style="color:#5B4FE8">✓ SMTP Berfungsi</h2><p>Konfigurasi SMTP WorkPulse AILO Anda berjalan dengan baik.</p><p style="color:#71717A;font-size:12px">Dikirim: ${new Date().toLocaleString('id-ID')}</p></div>`,
      text: 'Test SMTP WorkPulse AILO berhasil.',
    });
    res.json({ message: 'Email test berhasil dikirim ke ' + to });
  } catch (err) {
    res.status(500).json({ message: 'Gagal: ' + err.message });
  }
});

// GET /api/site-settings/smtp-debug — top-tier only, cek config aktif
router.get('/smtp-debug', auth, requireSuperadmin, async (req, res) => {
  const s = await getSettings();
  res.json({
    db: {
      smtpHost:   s.smtpHost   || '(kosong)',
      smtpPort:   s.smtpPort,
      smtpUser:   s.smtpUser   || '(kosong)',
      smtpPassSet: !!s.smtpPass,
      smtpFrom:   s.smtpFrom   || '(kosong)',
      smtpSecure: s.smtpSecure,
    },
    env: {
      MAIL_HOST: process.env.MAIL_HOST || '(tidak di-set)',
      MAIL_USER: process.env.MAIL_USER || '(tidak di-set)',
      MAIL_PASS_SET: !!process.env.MAIL_PASS,
    },
    activeSource: (s.smtpHost && s.smtpUser && s.smtpPass) ? 'DATABASE' : 'ENV (.env)',
  });
});

// POST /api/site-settings/logo — upload logo
router.post('/logo', auth, requireSuperadmin, uploadLogo.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'File tidak ditemukan' });
  const logoUrl = '/img/' + req.file.filename;
  const s = await getSettings();
  s.appLogo = logoUrl;
  await s.save();
  res.json({ message: 'Logo diperbarui', logoUrl, settings: s });
});

module.exports = router;
