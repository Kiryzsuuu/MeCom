const router   = require('express').Router();
const Subtask  = require('../models/Subtask');
const Task     = require('../models/Task');
const User     = require('../models/User');
const Evidence = require('../models/Evidence');
const auth     = require('../middleware/auth');
const push     = require('../services/push');
const notifSvc = require('../services/notifikasi');
const { TOP_TIER_ROLES } = require('../middleware/roles');

function idStr(v) { return v?._id?.toString() || v?.toString() || ''; }
function isCreator(user, task) {
  if (idStr(task.dibuatOleh) === user._id.toString()) return true;
  return (task.creators || []).map(idStr).includes(user._id.toString());
}
function isDireksi(user) { return TOP_TIER_ROLES.includes(user.role); }
function canManage(user, task) { return isDireksi(user) || isCreator(user, task); }
function isSubAssignee(user, sub) { return (sub.assignees || []).map(idStr).includes(user._id.toString()); }
// Direktur CoE/Wakil Direktur CoE/Sekretaris CoE = validator global, atau ditunjuk eksplisit pada subtask
const APPROVER_ROLES = TOP_TIER_ROLES;
function isSubValidator(user, sub) {
  if (APPROVER_ROLES.includes(user.role)) return true;
  return (sub.validators || []).map(idStr).includes(user._id.toString());
}

// GET /api/subtasks?taskId=xxx — semua subtask (termasuk nested) untuk task
router.get('/', auth, async (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ message: 'taskId wajib' });
  const subtasks = await Subtask.find({ taskId })
    .populate('assignees', 'namaLengkap fotoProfil')
    .populate('validators', 'namaLengkap fotoProfil')
    .populate('approvedBy', 'namaLengkap')
    .sort({ urutan: 1 });
  res.json(subtasks);
});

// POST /api/subtasks — pembuat task. Mirip task: judul, deskripsi, assignees, validators, dueDate.
router.post('/', auth, async (req, res) => {
  const { taskId, parentId, judul, deskripsi, assignees, validators, dueDate, priority } = req.body;
  if (!taskId || !judul) return res.status(400).json({ message: 'taskId dan judul wajib' });

  const task = await Task.findById(taskId);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });
  if (!canManage(req.user, task))
    return res.status(403).json({ message: 'Hanya pembuat task yang dapat menambah subtask' });

  if (parentId) {
    const parent = await Subtask.findById(parentId);
    if (!parent || parent.taskId.toString() !== taskId.toString())
      return res.status(400).json({ message: 'Parent subtask tidak valid' });
  }

  const last = await Subtask.findOne({ taskId, parentId: parentId || null }).sort({ urutan: -1 });
  const urutan = last ? last.urutan + 1 : 0;

  const sub = await Subtask.create({
    taskId, parentId: parentId || null, judul, urutan,
    deskripsi: deskripsi || '',
    assignees: assignees || [],
    validators: validators || [],
    dueDate: dueDate || null,
    priority: priority || 'medium',
  });
  await sub.populate('assignees', 'namaLengkap fotoProfil');
  await sub.populate('validators', 'namaLengkap fotoProfil');
  res.status(201).json(sub);
});

// PUT /api/subtasks/reorder/batch — harus di atas /:id
router.put('/reorder/batch', auth, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ message: 'items harus array' });
  await Promise.all(items.map(i => Subtask.findByIdAndUpdate(i._id, { urutan: i.urutan })));
  res.json({ message: 'Urutan diupdate' });
});

// POST /api/subtasks/:id/submit — assignee kirim pekerjaan ke Task Approval
router.post('/:id/submit', auth, async (req, res) => {
  const sub = await Subtask.findById(req.params.id);
  if (!sub) return res.status(404).json({ message: 'Subtask tidak ditemukan' });
  if (!isSubAssignee(req.user, sub) && !TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Hanya assignee subtask yang dapat mengirim' });

  if (req.body.workNote !== undefined) sub.workNote = req.body.workNote;
  sub.status = 'review';
  sub.pendingApproval = true;
  await sub.save();

  // Notif ke Task Approval — in-app + push. Top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) = validator global.
  const direktur = await User.find({ role: { $in: ['sekretaris_coe','wakil_direktur_coe'] }, statusAktif: true }).select('_id');
  const targetIds = new Set([
    ...(sub.validators || []).map(idStr),
    ...direktur.map(d => d._id.toString()),
  ]);
  for (const vid of targetIds) {
    notifSvc.buatNotifikasi({
      userId: vid, jenis: 'subtask_menunggu_approval',
      judul: 'Subtask menunggu approval Anda',
      isi: `Subtask "${sub.judul}" siap divalidasi.`,
      taskId: sub.taskId,
    }).catch(() => {});
    push.sendPush(vid, {
      title: 'Subtask menunggu approval', body: sub.judul,
      url: `/approval`,
    }).catch(() => {});
  }
  await sub.populate('assignees', 'namaLengkap fotoProfil');
  await sub.populate('validators', 'namaLengkap fotoProfil');
  res.json({ message: 'Pekerjaan dikirim ke Task Approval', subtask: sub });
});

// POST /api/subtasks/:id/approve — validator subtask (Task Approval)
router.post('/:id/approve', auth, async (req, res) => {
  const { approve } = req.body;
  const sub = await Subtask.findById(req.params.id);
  if (!sub) return res.status(404).json({ message: 'Subtask tidak ditemukan' });
  if (!isSubValidator(req.user, sub) && !TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Hanya Task Approval yang ditunjuk yang dapat approve' });

  if (approve === false) {
    // Subtask asal jadi log (gray/rejected), lalu buat subtask revisi "Review Task (...)".
    const origJudul = sub.judul;

    // Subtask revisi baru — mewarisi data subtask asal, di level yang sama.
    const last = await Subtask.findOne({ taskId: sub.taskId, parentId: sub.parentId || null }).sort({ urutan: -1 });
    const revisi = await Subtask.create({
      taskId:     sub.taskId,
      parentId:   sub.parentId || null,
      judul:      `Review Task (${origJudul})`.slice(0, 100),
      deskripsi:  sub.deskripsi || '',
      status:     'on_progress',
      workNote:   sub.workNote || '',
      assignees:  sub.assignees || [],
      validators: sub.validators || [],
      dueDate:    sub.dueDate || null,
      priority:   sub.priority || 'medium',
      revisionOf: sub._id,
      urutan:     last ? last.urutan + 1 : 0,
    });

    // Salin lampiran (evidence) subtask asal ke subtask revisi.
    // File fisik DIGANDAKAN agar log (subtask asal) tetap utuh meski file revisi dihapus.
    const fs   = require('fs');
    const path = require('path');
    const lampiran = await Evidence.find({ subtaskId: sub._id });
    for (const ev of lampiran) {
      let urlFileBaru = ev.urlFile;
      try {
        const srcAbs = path.join(__dirname, '../../', ev.urlFile);
        const ext    = path.extname(ev.urlFile);
        const namaBaru = `${path.basename(ev.urlFile, ext)}-rev${Date.now()}${ext}`;
        const dstRel = path.posix.join(path.posix.dirname(ev.urlFile), namaBaru);
        const dstAbs = path.join(__dirname, '../../', dstRel);
        if (fs.existsSync(srcAbs)) { fs.copyFileSync(srcAbs, dstAbs); urlFileBaru = dstRel; }
      } catch { /* fallback: pakai urlFile lama bila copy gagal */ }
      await Evidence.create({
        taskId: ev.taskId, subtaskId: revisi._id, uploaderId: ev.uploaderId,
        namaFile: ev.namaFile, urlFile: urlFileBaru, ukuran: ev.ukuran, mimeType: ev.mimeType,
      });
    }

    // Tandai subtask asal sebagai ditolak (jadi riwayat).
    sub.status = 'rejected';
    sub.pendingApproval = false;
    sub.isDone = false;
    sub.replacedBy = revisi._id;
    await sub.save();

    // Pemberitahuan ke assignee: in-app notif + push.
    for (const uid of (sub.assignees || []).map(idStr)) {
      notifSvc.buatNotifikasi({
        userId: uid, jenis: 'subtask_revisi',
        judul: 'Kerjaan ditolak, harap direvisi',
        isi: `Subtask "${origJudul}" ditolak. Lanjutkan revisi di "Review Task (${origJudul})".`,
        taskId: sub.taskId,
      }).catch(() => {});
      push.sendPush(uid, { title: 'Kerjaan ditolak, harap direvisi', body: origJudul, url: `/task?id=${sub.taskId}` }).catch(() => {});
    }
  } else {
    sub.status = 'done';
    sub.isDone = true;
    sub.pendingApproval = false;
    sub.approvedBy = req.user._id;
    await sub.save();
    for (const uid of (sub.assignees || []).map(idStr)) {
      push.sendPush(uid, { title: 'Subtask disetujui (Done)', body: sub.judul, url: `/task?id=${sub.taskId}` }).catch(() => {});
    }
  }
  await sub.populate('assignees', 'namaLengkap fotoProfil');
  await sub.populate('validators', 'namaLengkap fotoProfil');
  await sub.populate('approvedBy', 'namaLengkap');
  res.json({ message: approve === false ? 'Subtask dikembalikan untuk revisi' : 'Subtask disetujui', subtask: sub });
});

// PUT /api/subtasks/:id
router.put('/:id', auth, async (req, res) => {
  const sub = await Subtask.findById(req.params.id);
  if (!sub) return res.status(404).json({ message: 'Subtask tidak ditemukan' });

  const task = await Task.findById(sub.taskId);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const manage   = canManage(req.user, task);
  const assignee = isSubAssignee(req.user, sub);
  const isSuper  = TOP_TIER_ROLES.includes(req.user.role);

  // Status & catatan kerja: hanya assignee subtask. Tidak boleh set 'done' manual (lewat approval).
  if (req.body.status !== undefined || req.body.workNote !== undefined || req.body.isDone !== undefined) {
    if (!assignee && !isSuper)
      return res.status(403).json({ message: 'Subtask hanya dikerjakan oleh assignee' });
    if (req.body.workNote !== undefined) sub.workNote = req.body.workNote;
    if (req.body.status !== undefined) {
      const allowed = isSuper ? ['to_do','on_progress','review','done'] : ['to_do','on_progress','review'];
      if (!allowed.includes(req.body.status))
        return res.status(400).json({ message: 'Status tidak valid (Done hanya lewat approval)' });
      sub.status = req.body.status;
      sub.isDone = req.body.status === 'done';
      sub.pendingApproval = req.body.status === 'review';
    }
  }

  // Detail subtask: hanya pengelola task
  const manageFields = ['judul','deskripsi','urutan','assignees','validators','dueDate','priority'];
  if (manageFields.some(k => req.body[k] !== undefined)) {
    if (!manage) return res.status(403).json({ message: 'Hanya pembuat task yang dapat mengubah detail subtask' });
    if (req.body.judul      !== undefined) sub.judul      = req.body.judul;
    if (req.body.deskripsi  !== undefined) sub.deskripsi  = req.body.deskripsi;
    if (req.body.urutan     !== undefined) sub.urutan     = req.body.urutan;
    if (req.body.assignees  !== undefined) sub.assignees  = req.body.assignees || [];
    if (req.body.validators !== undefined) sub.validators = req.body.validators || [];
    if (req.body.dueDate    !== undefined) sub.dueDate    = req.body.dueDate || null;
    if (req.body.priority   !== undefined) sub.priority   = req.body.priority;
  }

  await sub.save();
  await sub.populate('assignees', 'namaLengkap fotoProfil');
  await sub.populate('validators', 'namaLengkap fotoProfil');
  // Catatan: status main task TIDAK dipengaruhi subtask (independen).
  res.json(sub);
});

// DELETE /api/subtasks/:id — creator saja, hapus juga turunannya
router.delete('/:id', auth, async (req, res) => {
  const sub = await Subtask.findById(req.params.id);
  if (!sub) return res.status(404).json({ message: 'Subtask tidak ditemukan' });

  const task = await Task.findById(sub.taskId);
  if (!task || !canManage(req.user, task))
    return res.status(403).json({ message: 'Hanya pembuat task yang dapat menghapus subtask' });

  await deleteDescendants(sub._id);
  await sub.deleteOne();
  res.json({ message: 'Subtask dihapus' });
});

async function deleteDescendants(parentId) {
  const children = await Subtask.find({ parentId });
  for (const c of children) {
    await deleteDescendants(c._id);
    await c.deleteOne();
  }
}

module.exports = router;
