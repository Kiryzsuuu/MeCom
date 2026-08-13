const mongoose = require('mongoose');

const featureSchema = new mongoose.Schema({
  icon: { type: String, default: 'ti-star' },
  text: { type: String, default: '' },
}, { _id: false });

const siteSettingsSchema = new mongoose.Schema({
  appName:      { type: String, default: 'MeCom AILO' },
  appLogo:      { type: String, default: null },
  accentColor:  { type: String, default: '#0E7C91' },

  // Login page — left panel
  heroLine1:    { type: String, default: 'Kelola task.' },
  heroLine2:    { type: String, default: 'Pantau KPI tim.' },
  heroSub:      { type: String, default: 'MeCom AILO membantu Sekretaris CoE dan Dosen merencanakan, melacak, dan menyelesaikan pekerjaan dengan sistem approval dan KPI otomatis.' },
  loginFeatures: {
    type: [featureSchema],
    default: [
      { icon: 'ti-layout-kanban', text: 'Kanban board & list view untuk monitoring task' },
      { icon: 'ti-chart-bar',     text: 'Perhitungan KPI otomatis per Dosen' },
      { icon: 'ti-bell',          text: 'Notifikasi realtime & pengingat deadline' },
    ],
  },

  // Login page — right panel
  loginTitle:   { type: String, default: 'Selamat datang' },
  loginSubtitle:{ type: String, default: 'Masuk ke akun MeCom AILO Anda' },

  // SMTP
  smtpHost:   { type: String, default: '' },
  smtpPort:   { type: Number, default: 587 },
  smtpSecure: { type: Boolean, default: false },
  smtpUser:   { type: String, default: '' },
  smtpPass:   { type: String, default: '' },
  smtpFrom:   { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
