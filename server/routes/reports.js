const router   = require('express').Router();
const PDFDocument = require('pdfkit');
const ExcelJS  = require('exceljs');
const User     = require('../models/User');
const Task     = require('../models/Task');
const auth     = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { hitungKpiManager, hitungGrade, labelGrade } = require('../services/kpi');

// GET /api/reports/kpi/pdf
router.get('/kpi/pdf', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const now        = new Date();
  const bulan      = parseInt(req.query.bulan) || now.getMonth() + 1;
  const tahun      = parseInt(req.query.tahun) || now.getFullYear();
  const BULAN_NAMA = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  const managers = await User.find({ role: 'dosen', statusAktif: true }).populate('direktoratId', 'nama');
  const rows = await Promise.all(managers.map(async m => ({
    nama:        m.namaLengkap,
    direktorat:  m.direktoratId?.nama || '-',
    kpi:         await hitungKpiManager(m._id, bulan, tahun),
  })));

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=kpi-${tahun}-${bulan}.pdf`);
  doc.pipe(res);

  // Header
  doc.fontSize(18).font('Helvetica-Bold').text('MeCom AILO — Laporan KPI', { align: 'center' });
  doc.fontSize(11).font('Helvetica').text(`Periode: ${BULAN_NAMA[bulan - 1]} ${tahun}`, { align: 'center' });
  doc.moveDown(1.5);

  // Tabel
  const cols = [200, 120, 60, 60, 60, 60, 50];
  const headers = ['Nama Dosen', 'Direktorat', 'Tepat Waktu', 'Volume', 'Kualitas', 'Skor', 'Grade'];
  let x = 40;
  doc.font('Helvetica-Bold').fontSize(9);
  headers.forEach((h, i) => { doc.text(h, x, doc.y, { width: cols[i], lineBreak: false }); x += cols[i]; });
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();

  rows.forEach(r => {
    const y = doc.y + 4;
    const vals = [
      r.nama, r.direktorat,
      r.kpi.skorWaktu + '%',
      r.kpi.skorVolume + '%',
      r.kpi.skorKualitas + '%',
      r.kpi.skorTotal.toFixed(1),
      r.kpi.grade,
    ];
    let xx = 40;
    doc.font('Helvetica').fontSize(9);
    vals.forEach((v, i) => { doc.text(v, xx, y, { width: cols[i], lineBreak: false }); xx += cols[i]; });
    doc.moveDown(0.6);
  });

  doc.end();
});

// GET /api/reports/kpi/excel
router.get('/kpi/excel', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const now   = new Date();
  const bulan = parseInt(req.query.bulan) || now.getMonth() + 1;
  const tahun = parseInt(req.query.tahun) || now.getFullYear();

  const managers = await User.find({ role: 'dosen', statusAktif: true }).populate('direktoratId', 'nama');
  const rows = await Promise.all(managers.map(async m => ({
    nama:       m.namaLengkap,
    email:      m.email,
    direktorat: m.direktoratId?.nama || '-',
    kpi:        await hitungKpiManager(m._id, bulan, tahun),
  })));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('KPI');

  ws.columns = [
    { header: 'Nama Dosen',   key: 'nama',       width: 25 },
    { header: 'Email',          key: 'email',      width: 28 },
    { header: 'Direktorat',     key: 'direktorat', width: 22 },
    { header: 'Tepat Waktu (%)',key: 'waktu',      width: 15 },
    { header: 'Volume (%)',     key: 'volume',     width: 12 },
    { header: 'Kualitas (%)',   key: 'kualitas',   width: 13 },
    { header: 'Skor Total',     key: 'skor',       width: 12 },
    { header: 'Grade',          key: 'grade',      width: 10 },
    { header: 'Label',          key: 'label',      width: 20 },
    { header: 'Total Done',     key: 'done',       width: 12 },
    { header: 'Total Assigned', key: 'assigned',   width: 15 },
  ];

  ws.getRow(1).font = { bold: true };
  rows.forEach(r => {
    ws.addRow({
      nama:       r.nama,
      email:      r.email,
      direktorat: r.direktorat,
      waktu:      r.kpi.skorWaktu,
      volume:     r.kpi.skorVolume,
      kualitas:   r.kpi.skorKualitas,
      skor:       r.kpi.skorTotal,
      grade:      r.kpi.grade,
      label:      r.kpi.label,
      done:       r.kpi.totalDone,
      assigned:   r.kpi.totalAssigned,
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=kpi-${tahun}-${bulan}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

// GET /api/reports/tasks/excel — Export task per direktorat
router.get('/tasks/excel', auth, async (req, res) => {
  const filter = { isDeleted: false };
  if (req.user.role === 'dosen') {
    filter.direktoratId = req.user.direktoratId?._id || req.user.direktoratId;
  } else if (req.query.direktoratId) {
    filter.direktoratId = req.query.direktoratId;
  }

  const tasks = await Task.find(filter)
    .populate('assignees', 'namaLengkap')
    .populate('direktoratId', 'nama')
    .sort({ createdAt: -1 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tasks');
  ws.columns = [
    { header: 'Judul',       key: 'judul',      width: 40 },
    { header: 'Assignee',    key: 'pic',        width: 22 },
    { header: 'Direktorat',  key: 'dir',        width: 22 },
    { header: 'Status',      key: 'status',     width: 18 },
    { header: 'Prioritas',   key: 'prioritas',  width: 12 },
    { header: 'Deadline',    key: 'deadline',   width: 14 },
    { header: 'Dibuat',      key: 'dibuat',     width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  tasks.forEach(t => ws.addRow({
    judul:    t.judul,
    pic:      (t.assignees || []).map(a => a.namaLengkap).join(', ') || '-',
    dir:      t.direktoratId?.nama || '-',
    status:   t.status,
    prioritas:t.prioritas,
    deadline: t.deadline ? new Date(t.deadline).toLocaleDateString('id-ID') : '-',
    dibuat:   t.createdAt ? new Date(t.createdAt).toLocaleDateString('id-ID') : '-',
  }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=tasks.xlsx');
  await wb.xlsx.write(res);
  res.end();
});

// ── GET /api/reports/workload — beban kerja per user ─────────────────────────
router.get('/workload', auth, async (req, res) => {
  const ACTIVE_STATUS = ['to_do','on_progress','partially_complete'];

  // Hanya top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) bisa lihat semua; dosen hanya direktoratnya
  const userFilter = { statusAktif: true, role: 'dosen' };
  if (req.user.role === 'dosen') {
    const userDirId = req.user.direktoratId?._id || req.user.direktoratId;
    userFilter.direktoratId = userDirId;
  }

  const users = await User.find(userFilter)
    .populate('direktoratId', 'nama kode')
    .select('namaLengkap email fotoProfil role direktoratId');

  const now = new Date();

  const workload = await Promise.all(users.map(async u => {
    const [active, done, overdue] = await Promise.all([
      Task.countDocuments({ assignees: u._id, status: { $in: ACTIVE_STATUS }, isDeleted: false }),
      Task.countDocuments({ assignees: u._id, status: 'complete', isDeleted: false }),
      Task.countDocuments({ assignees: u._id, status: { $in: ACTIVE_STATUS }, deadline: { $lt: now }, isDeleted: false }),
    ]);
    const breakdown = {};
    for (const s of ACTIVE_STATUS) {
      breakdown[s] = await Task.countDocuments({ assignees: u._id, status: s, isDeleted: false });
    }
    return {
      user: { _id: u._id, namaLengkap: u.namaLengkap, email: u.email, fotoProfil: u.fotoProfil, role: u.role, direktoratId: u.direktoratId },
      active, done, overdue, breakdown,
    };
  }));

  workload.sort((a, b) => b.active - a.active);
  res.json({ workload });
});

module.exports = router;
