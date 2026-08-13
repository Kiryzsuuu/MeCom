const router    = require('express').Router();
const Task      = require('../models/Task');
const User      = require('../models/User');
const Subtask   = require('../models/Subtask');
const Evidence  = require('../models/Evidence');
const StatusLog = require('../models/StatusLog');
const auth      = require('../middleware/auth');
const { requireRole, TOP_TIER_ROLES } = require('../middleware/roles');
const notifSvc  = require('../services/notifikasi');
const mailer    = require('../services/mailer');
const wa        = require('../services/whatsapp');
const { simpanSnapshot } = require('../services/kpi');
const push      = require('../services/push');
const audit     = require('../services/audit');

// ── Helpers ───────────────────────────────────────────────────────────────────
function idStr(v) { return v?._id?.toString() || v?.toString() || ''; }

function assigneeIds(task) {
  return (task.assignees || []).map(idStr);
}

function isAssignee(user, task) {
  return assigneeIds(task).includes(user._id.toString());
}

// Creator utama
function isMainCreator(user, task) {
  return idStr(task.dibuatOleh) === user._id.toString();
}
// Creator (utama atau co-creator)
function isCreator(user, task) {
  if (isMainCreator(user, task)) return true;
  return (task.creators || []).map(idStr).includes(user._id.toString());
}
// Role yang otomatis jadi approver/validator (semua top-tier: direktur/wakil direktur/sekretaris CoE)
const APPROVER_ROLES = TOP_TIER_ROLES;
// Validator: semua top-tier otomatis validator, ATAU ditunjuk eksplisit
function isValidator(user, task) {
  if (APPROVER_ROLES.includes(user.role)) return true;
  return (task.validators || []).map(idStr).includes(user._id.toString());
}

function isDireksiRole(user) {
  return TOP_TIER_ROLES.includes(user.role);
}

// Status MAIN TASK independen dari subtask (req: subtask tidak memengaruhi main task).
// Hanya berdasar completedBy vs assignees.
function deriveMainTaskState(task) {
  const totalA = assigneeIds(task).length;
  const doneA  = (task.completedBy || []).length;
  if (totalA && doneA >= totalA) return { status: 'partially_complete', pendingApproval: true };
  if (doneA > 0)                 return { status: 'partially_complete', pendingApproval: false };
  return { status: task.status === 'on_progress' ? 'on_progress' : 'to_do', pendingApproval: false };
}

// Req #3: semua user bisa MELIHAT semua task
function canView() { return true; }

// Buat subtask (mendukung nested) dari struktur pohon { judul, assignees, dueDate, priority, children[] }
async function createSubtasksRecursive(taskId, parentId, nodes) {
  let urutan = 0;
  for (const s of (nodes || [])) {
    if (!s || !s.judul) continue;
    const sub = await Subtask.create({
      taskId, parentId: parentId || null, judul: s.judul, urutan: urutan++,
      deskripsi: s.deskripsi || '',
      assignees: s.assignees || [], validators: s.validators || [],
      dueDate: s.dueDate || null, priority: s.priority || 'medium',
    });
    if (Array.isArray(s.children) && s.children.length) {
      await createSubtasksRecursive(taskId, sub._id, s.children);
    }
  }
}

// Notif & snapshot saat task benar-benar complete (sudah di-approve creator)
async function onTaskComplete(task) {
  task.doneAt     = new Date();
  task.approvedAt = new Date();
  const now = new Date();
  for (const uid of assigneeIds(task)) {
    const u = await User.findById(uid);
    if (!u) continue;
    await notifSvc.notifTaskDone(u, task).catch(() => {});
    push.sendPush(u._id, { title: 'Task Selesai!', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
    await simpanSnapshot(u._id, now.getMonth() + 1, now.getFullYear()).catch(() => {});
  }
  if (!assigneeIds(task).includes(idStr(task.dibuatOleh))) {
    push.sendPush(task.dibuatOleh, { title: 'Task Selesai!', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
  }
}

// ── GET /api/tasks ────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  const { status, prioritas, direktoratId, assigneeId, mine, search, page = 1, limit = 50, arsip } = req.query;

  const filter = { isDeleted: false };

  if (arsip === 'true') filter.archivedAt = { $ne: null };
  else                  filter.archivedAt = null;

  // Req #3: tidak ada isolasi direktorat — semua user lihat semua task
  if (direktoratId)            filter.direktoratId = direktoratId;
  if (status)                  filter.status       = status;
  if (prioritas)               filter.prioritas    = prioritas;
  if (assigneeId)              filter.assignees    = assigneeId;
  if (mine === 'true')         filter.assignees    = req.user._id; // task yang di-assign ke saya
  if (search)                  filter.judul        = { $regex: search, $options: 'i' };

  // Req #11e: user biasa (dosen) hanya melihat task yang terkait dirinya.
  // Direktur CoE/Wakil Direktur CoE/Sekretaris CoE = pemantau global → lihat semua task.
  const GLOBAL_VIEW_ROLES = ['direktur_coe', 'sekretaris_coe', 'wakil_direktur_coe'];
  if (!GLOBAL_VIEW_ROLES.includes(req.user.role) && mine !== 'true') {
    const uid = req.user._id;
    filter.$or = [
      { assignees: uid },   // di-assign ke saya
      { dibuatOleh: uid },  // saya pembuat utama
      { creators: uid },    // saya co-creator
      { validators: uid },  // saya validator/task approval
    ];
  }

  const total = await Task.countDocuments(filter);
  const tasks = await Task.find(filter)
    .populate('assignees', 'namaLengkap email fotoProfil')
    .populate('dibuatOleh', 'namaLengkap')
    .populate('creators', 'namaLengkap')
    .populate('validators', 'namaLengkap')
    .populate('direktoratId', 'nama kode')
    .populate('milestoneId', 'judul warna')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  // Lampirkan jumlah subtask (total & done) per task
  const ids = tasks.map(t => t._id);
  if (ids.length) {
    const counts = await Subtask.aggregate([
      { $match: { taskId: { $in: ids } } },
      { $group: {
        _id: '$taskId',
        total: { $sum: 1 },
        done:  { $sum: { $cond: [{ $or: [{ $eq: ['$status', 'done'] }, { $eq: ['$isDone', true] }] }, 1, 0] } },
      } },
    ]);
    const map = {};
    counts.forEach(c => { map[c._id.toString()] = { total: c.total, done: c.done }; });
    tasks.forEach(t => {
      const c = map[t._id.toString()] || { total: 0, done: 0 };
      t.subtaskTotal = c.total; t.subtaskDone = c.done;
    });
  }

  res.json({ total, page: parseInt(page), tasks });
});

// ── GET /api/tasks/deleted — Sekretaris CoE lihat arsip soft-delete ──────────
router.get('/deleted', auth, requireRole('sekretaris_coe'), async (req, res) => {
  const tasks = await Task.find({ isDeleted: true })
    .populate('assignees', 'namaLengkap')
    .populate('direktoratId', 'nama kode')
    .sort({ deletedAt: -1 });
  res.json(tasks);
});

// ── PUT /api/tasks/bulk-status — batch status update ─────────────────────────
router.put('/bulk-status', auth, async (req, res) => {
  const { taskIds, statusBaru, catatan } = req.body;
  if (!taskIds?.length || !statusBaru)
    return res.status(400).json({ message: 'taskIds dan statusBaru wajib diisi' });

  const validStatus = ['to_do','on_progress','partially_complete','complete'];
  if (!validStatus.includes(statusBaru))
    return res.status(400).json({ message: 'Status tidak valid' });

  const isDireksi = isDireksiRole(req.user);

  let updated = 0;
  for (const id of taskIds) {
    try {
      const task = await Task.findById(id);
      if (!task) continue;

      // Hanya creator / assignee / top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) yang bisa ubah status
      if (!isDireksi && !isCreator(req.user, task) && !isAssignee(req.user, task)) continue;

      task.status = statusBaru;
      if (statusBaru === 'complete') { task.doneAt = new Date(); task.pendingApproval = false; }
      await task.save();
      updated++;
    } catch {}
  }

  res.json({ message: `${updated} task berhasil diupdate`, updated });
});

// ── POST /api/tasks ───────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  const { judul, deskripsi, assignees, prioritas, deadline, subtasks, creators, validators } = req.body;

  if (!judul || !deskripsi || !assignees?.length || !deadline)
    return res.status(400).json({ message: 'Judul, deskripsi, assignee, dan deadline wajib diisi' });
  if (new Date(deadline) < new Date())
    return res.status(400).json({ message: 'Deadline tidak boleh di masa lalu' });
  if (judul.length > 150)
    return res.status(400).json({ message: 'Judul maksimal 150 karakter' });

  // Validasi assignee ada
  const users = await User.find({ _id: { $in: assignees } });
  if (!users.length) return res.status(400).json({ message: 'Assignee tidak ditemukan' });

  const task = await Task.create({
    judul: judul.trim(),
    deskripsi,
    assignees,
    dibuatOleh: req.user._id,
    creators: (creators || []).filter(id => idStr(id) !== req.user._id.toString()),
    validators: validators || [],
    // Direktorat task = direktorat creator (untuk pelaporan)
    direktoratId: req.user.direktoratId?._id || req.user.direktoratId,
    prioritas: prioritas || 'normal',
    status: 'to_do',
    deadline: new Date(deadline),
  });

  // Subtask boleh dikirim saat pembuatan (opsional). Mendukung nested via `children`.
  if (Array.isArray(subtasks) && subtasks.length) {
    await createSubtasksRecursive(task._id, null, subtasks);
  }

  await StatusLog.create({ taskId: task._id, userId: req.user._id, statusLama: null, statusBaru: 'to_do', catatan: 'Task dibuat' });

  // Notif ke semua assignee (selain creator)
  for (const u of users) {
    if (u._id.toString() !== req.user._id.toString())
      await notifSvc.notifTaskApproved(u, task).catch(() => {});
  }

  await task.populate(['assignees', 'dibuatOleh', 'direktoratId']);
  audit.log(req, 'task.create', { target:'Task', targetId: task._id, detail: { judul: task.judul } });
  res.status(201).json({ task });
});

// ── GET /api/tasks/pending-approval — antrian approval untuk validator ────────
// (Harus sebelum '/:id' agar tidak dianggap id)
router.get('/pending-approval', auth, async (req, res) => {
  // Semua top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) = validator global → lihat SEMUA antrian approval.
  const isApprover = APPROVER_ROLES.includes(req.user.role);
  const filter = { isDeleted: false, status: { $ne: 'complete' }, pendingApproval: true };
  if (!isApprover) filter.validators = req.user._id;
  const tasks = await Task.find(filter)
    .populate('assignees', 'namaLengkap fotoProfil')
    .populate('dibuatOleh', 'namaLengkap')
    .populate('validators', 'namaLengkap')
    .populate('direktoratId', 'nama kode')
    .sort({ deadline: 1 });

  // Subtask yang menunggu approval (Task Approval)
  const subFilter = { status: 'review', pendingApproval: true };
  if (!isApprover) subFilter.validators = req.user._id;
  const subtasks = await Subtask.find(subFilter)
    .populate('assignees', 'namaLengkap fotoProfil')
    .populate('validators', 'namaLengkap')
    .populate('taskId', 'judul')
    .sort({ dueDate: 1 });

  res.json({ tasks, subtasks });
});

// ── GET /api/tasks/:id ────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  const task = await Task.findById(req.params.id)
    .populate('assignees', 'namaLengkap email fotoProfil direktoratId')
    .populate('dibuatOleh', 'namaLengkap email')
    .populate('creators', 'namaLengkap email fotoProfil')
    .populate('validators', 'namaLengkap email fotoProfil')
    .populate('approvedBy', 'namaLengkap')
    .populate('direktoratId', 'nama kode')
    .populate('completedBy', 'namaLengkap fotoProfil')
    .populate('milestoneId', 'judul warna');

  if (!task || (task.isDeleted && !TOP_TIER_ROLES.includes(req.user.role)))
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  const [subtasks, evidences, logs] = await Promise.all([
    Subtask.find({ taskId: task._id }).populate('assignees', 'namaLengkap fotoProfil').sort({ urutan: 1 }),
    Evidence.find({ taskId: task._id }).populate('uploaderId', 'namaLengkap'),
    StatusLog.find({ taskId: task._id }).populate('userId', 'namaLengkap').sort({ createdAt: 1 }),
  ]);

  res.json({ task, subtasks, evidences, logs });
});

// ── PUT /api/tasks/:id — hanya CREATOR (req #10) ─────────────────────────────
router.put('/:id', auth, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task || task.isDeleted)
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  const isDireksi = isDireksiRole(req.user);
  if (!isDireksi && !isCreator(req.user, task))
    return res.status(403).json({ message: 'Hanya pembuat task yang dapat mengedit' });

  const allowed = ['judul', 'deskripsi', 'prioritas', 'deadline', 'assignees', 'milestoneId'];
  if (isDireksi) allowed.push('catatanDireksi');

  // creators & validators hanya boleh diatur oleh CREATOR UTAMA (req)
  if (isMainCreator(req.user, task) || isDireksi) {
    if (req.body.creators !== undefined)
      task.creators = (req.body.creators || []).filter(id => idStr(id) !== idStr(task.dibuatOleh));
    if (req.body.validators !== undefined)
      task.validators = req.body.validators || [];
  }

  allowed.forEach(f => {
    if (req.body[f] !== undefined) task[f] = req.body[f];
  });

  await task.save();
  await task.populate(['assignees', 'dibuatOleh', 'creators', 'validators', 'direktoratId']);
  res.json({ message: 'Task berhasil diupdate', task });
});

// ── POST /api/tasks/:id/cover — Upload cover image (base64) ──────────────────
router.post('/:id/cover', auth, async (req, res) => {
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ message: 'Data foto tidak ditemukan' });
  if (!base64.startsWith('data:image/')) return res.status(400).json({ message: 'Format tidak valid' });
  if (base64.length > 2.8 * 1024 * 1024) return res.status(400).json({ message: 'Ukuran foto maksimal 2MB' });

  const task = await Task.findById(req.params.id);
  if (!task || task.isDeleted) return res.status(404).json({ message: 'Task tidak ditemukan' });

  if (!isDireksiRole(req.user) && !isCreator(req.user, task) && !isAssignee(req.user, task))
    return res.status(403).json({ message: 'Akses ditolak' });

  task.coverImage = base64;
  await task.save();
  res.json({ coverImage: base64 });
});

// ── PUT /api/tasks/:id/status — ubah status manual ───────────────────────────
// Creator/top-tier bisa set status apa saja. Assignee bisa set to_do/on_progress.
router.put('/:id/status', auth, async (req, res) => {
  const { statusBaru } = req.body;
  const validStatuses = ['to_do', 'on_progress', 'partially_complete', 'complete'];
  if (!statusBaru || !validStatuses.includes(statusBaru))
    return res.status(400).json({ message: 'Status tidak valid' });

  const task = await Task.findById(req.params.id).populate('assignees').populate('dibuatOleh');
  if (!task || task.isDeleted)
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  const isSuper   = TOP_TIER_ROLES.includes(req.user.role);
  const creator   = isCreator(req.user, task);
  const assignee  = isAssignee(req.user, task);
  const validator = isValidator(req.user, task);

  if (!isSuper && !creator && !assignee && !validator)
    return res.status(403).json({ message: 'Akses ditolak' });

  // 'complete' lewat approval validator, ATAU override manual oleh creator/top-tier
  // (creator boleh menutup main task kapan saja, terlepas dari progress subtask).
  if (statusBaru === 'complete' && !isSuper && !creator)
    return res.status(403).json({ message: 'Task hanya bisa di-Complete lewat approval validator atau oleh creator' });

  const statusLama = task.status;
  task.status = statusBaru;
  if (statusBaru === 'complete') {
    task.pendingApproval = false;
    await onTaskComplete(task);
  } else {
    task.doneAt = null;
  }

  await task.save();
  await StatusLog.create({ taskId: task._id, userId: req.user._id, statusLama, statusBaru });

  audit.log(req, `task.status`, { target:'Task', targetId: task._id, detail: { judul: task.judul, statusLama, statusBaru } });
  res.json({ message: 'Status berhasil diubah', task });
});

// ── POST /api/tasks/:id/complete-mine — assignee menandai bagiannya selesai ──
// Req #1 (decision): tiap assignee selesai sendiri; task complete saat semua selesai + approval creator
router.post('/:id/complete-mine', auth, async (req, res) => {
  const { done } = req.body; // true = tandai selesai, false = batalkan
  const task = await Task.findById(req.params.id).populate('assignees').populate('dibuatOleh');
  if (!task || task.isDeleted) return res.status(404).json({ message: 'Task tidak ditemukan' });

  if (!isAssignee(req.user, task))
    return res.status(403).json({ message: 'Hanya assignee yang dapat menandai bagiannya selesai' });

  const uid = req.user._id.toString();
  const already = (task.completedBy || []).map(idStr);

  if (done === false) {
    task.completedBy = (task.completedBy || []).filter(c => idStr(c) !== uid);
    task.pendingApproval = false;
    if (task.status === 'complete') task.status = 'on_progress';
  } else {
    if (!already.includes(uid)) task.completedBy.push(req.user._id);
  }

  // Hitung progress
  const total    = assigneeIds(task).length;
  const doneCnt  = (task.completedBy || []).length;

  if (doneCnt === 0)            task.status = 'to_do' === task.status ? 'to_do' : 'on_progress';
  else if (doneCnt < total)     task.status = 'partially_complete';
  else if (doneCnt >= total)    { task.status = 'partially_complete'; task.pendingApproval = true; }

  await task.save();
  await task.populate('completedBy', 'namaLengkap fotoProfil');

  // Notif saat semua assignee selesai → minta approval (in-app + push).
  // Semua top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) adalah validator global, jadi semua dapat notif (plus validator eksplisit).
  if (task.pendingApproval) {
    const direktur = await User.find({ role: { $in: TOP_TIER_ROLES }, statusAktif: true }).select('_id');
    const targetIds = new Set([
      ...(task.validators || []).map(idStr),
      ...direktur.map(d => d._id.toString()),
    ]);
    for (const vid of targetIds) {
      notifSvc.buatNotifikasi({
        userId: vid, jenis: 'task_menunggu_approval',
        judul: 'Task menunggu approval Anda',
        isi: `Task "${task.judul}" siap divalidasi.`,
        taskId: task._id,
      }).catch(() => {});
      push.sendPush(vid, {
        title: 'Menunggu Approval Anda', body: `Task siap divalidasi: ${task.judul}`,
        url: `/pages/approval.html`,
      }).catch(() => {});
    }
  }

  res.json({ message: done === false ? 'Ditandai belum selesai' : 'Ditandai selesai', task });
});

// ── POST /api/tasks/:id/approve — VALIDATOR menyetujui (1 approve = complete) ──
router.post('/:id/approve', auth, async (req, res) => {
  const { approve } = req.body; // true = setujui jadi complete, false = tolak/revisi
  const task = await Task.findById(req.params.id).populate('assignees').populate('dibuatOleh');
  if (!task || task.isDeleted) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const isSuper = TOP_TIER_ROLES.includes(req.user.role);
  if (!isSuper && !isValidator(req.user, task))
    return res.status(403).json({ message: 'Hanya Task Approval (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) yang ditunjuk yang dapat approve' });

  const statusLama = task.status;
  if (approve === false) {
    // Tolak / minta revisi: kembalikan ke on_progress
    task.pendingApproval = false;
    task.completedBy = [];
    task.status = 'on_progress';
    task.revisiCount = (task.revisiCount || 0) + 1;
    await task.save();
    await StatusLog.create({ taskId: task._id, userId: req.user._id, statusLama, statusBaru: 'on_progress', catatan: 'Ditolak validator — revisi' });
    // beri tahu assignee
    for (const uid of assigneeIds(task)) {
      push.sendPush(uid, { title: 'Perlu Revisi', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
    }
    return res.json({ message: 'Task dikembalikan untuk revisi', task });
  }

  // Satu validator approve → langsung complete (tanpa menunggu validator lain)
  task.status = 'complete';
  task.pendingApproval = false;
  task.approvedBy = req.user._id;
  await onTaskComplete(task);
  await task.save();
  await StatusLog.create({ taskId: task._id, userId: req.user._id, statusLama, statusBaru: 'complete', catatan: `Disetujui ${req.user.namaLengkap}` });
  audit.log(req, 'task.approve', { target:'Task', targetId: task._id, detail: { judul: task.judul } });
  res.json({ message: 'Task disetujui & selesai', task });
});

// ── GET /api/tasks/:id/dependencies ──────────────────────────────────────────
router.get('/:id/dependencies', auth, async (req, res) => {
  const task = await Task.findById(req.params.id)
    .populate('dependencies', 'judul status prioritas deadline assignees');
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });
  res.json({ dependencies: task.dependencies || [] });
});

// ── POST /api/tasks/:id/dependencies — tambah dependency ─────────────────────
router.post('/:id/dependencies', auth, async (req, res) => {
  const { dependsOnId } = req.body;
  if (!dependsOnId) return res.status(400).json({ message: 'dependsOnId wajib diisi' });
  if (dependsOnId === req.params.id) return res.status(400).json({ message: 'Task tidak bisa bergantung pada dirinya sendiri' });

  const [task, dep] = await Promise.all([
    Task.findById(req.params.id),
    Task.findById(dependsOnId),
  ]);
  if (!task || !dep) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const alreadyAdded = task.dependencies.map(d => d.toString()).includes(dependsOnId);
  if (alreadyAdded) return res.status(400).json({ message: 'Dependency sudah ada' });

  task.dependencies.push(dependsOnId);
  await task.save();
  await task.populate('dependencies', 'judul status prioritas deadline');
  res.json({ message: 'Dependency ditambahkan', dependencies: task.dependencies });
});

// ── DELETE /api/tasks/:id/dependencies/:depId ─────────────────────────────────
router.delete('/:id/dependencies/:depId', auth, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  task.dependencies = task.dependencies.filter(d => d.toString() !== req.params.depId);
  await task.save();
  res.json({ message: 'Dependency dihapus' });
});

// ── POST /api/tasks/:id/recurrence — set recurrence ──────────────────────────
router.post('/:id/recurrence', auth, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const { tipe, interval } = req.body;
  const validTipe = ['none','daily','weekly','monthly'];
  if (!validTipe.includes(tipe)) return res.status(400).json({ message: 'Tipe recurrence tidak valid' });

  task.recurrence.tipe     = tipe;
  task.recurrence.interval = Math.max(1, parseInt(interval) || 1);
  task.recurrence.nextRun  = tipe !== 'none' ? nextRunDate(task.deadline, tipe, task.recurrence.interval) : null;
  await task.save();
  res.json({ message: 'Recurrence diset', recurrence: task.recurrence });
});

function nextRunDate(fromDate, tipe, interval) {
  const d = new Date(fromDate);
  if (tipe === 'daily')   d.setDate(d.getDate() + interval);
  if (tipe === 'weekly')  d.setDate(d.getDate() + interval * 7);
  if (tipe === 'monthly') d.setMonth(d.getMonth() + interval);
  return d;
}

// ── POST /api/tasks/reset-data — Clean Reset Data (top-tier: Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) ──
// Hapus SEMUA data task & turunannya, TANPA menyentuh user/akun.
const RESET_PHRASE = 'Saya yang bertanggung jawab dalam menghapus data ini';
router.post('/reset-data', auth, async (req, res) => {
  if (!TOP_TIER_ROLES.includes(req.user.role))
    return res.status(403).json({ message: 'Hanya admin (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) yang dapat reset data' });

  const { enik, password, confirm } = req.body;
  // Re-auth wajib
  if (!enik || !password) return res.status(400).json({ message: 'ENIK dan password wajib diisi' });
  const val = String(enik).trim();
  const cocokEnik = (req.user.enik && req.user.enik === val) ||
                    (req.user.email && req.user.email.toLowerCase() === val.toLowerCase());
  if (!cocokEnik) return res.status(401).json({ message: 'ENIK tidak cocok dengan akun Anda' });
  const okPw = await req.user.comparePassword(password);
  if (!okPw) return res.status(401).json({ message: 'Password salah' });

  // Kalimat konfirmasi harus persis
  if ((confirm || '').trim() !== RESET_PHRASE)
    return res.status(400).json({ message: `Ketik persis: "${RESET_PHRASE}"` });

  const Komentar    = require('../models/Komentar');
  const TaskMessage = require('../models/TaskMessage');
  const Milestone   = require('../models/Milestone');
  const KpiSnapshot = require('../models/KpiSnapshot');

  const results = {};
  results.subtasks    = (await Subtask.deleteMany({})).deletedCount;
  results.evidences   = (await Evidence.deleteMany({})).deletedCount;
  results.notes       = (await Komentar.deleteMany({})).deletedCount;
  results.statusLogs  = (await StatusLog.deleteMany({})).deletedCount;
  results.taskMessages= (await TaskMessage.deleteMany({})).deletedCount;
  results.milestones  = (await Milestone.deleteMany({})).deletedCount;
  results.kpiSnapshots= (await KpiSnapshot.deleteMany({})).deletedCount;
  results.tasks       = (await Task.deleteMany({})).deletedCount;

  audit.log(req, 'data.reset', { target: 'System', detail: results });
  res.json({ message: 'Clean reset selesai. Data task dihapus, akun user tetap aman.', results });
});

// ── DELETE /api/tasks/:id (soft delete) ── top-tier saja ─────────────────────
router.delete('/:id', auth, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  // Top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) atau creator task itu sendiri (req batch 4b)
  const boleh = isDireksiRole(req.user) || isCreator(req.user, task);
  if (!boleh)
    return res.status(403).json({ message: 'Hanya pembuat task atau admin yang dapat menghapus task' });

  task.isDeleted = true;
  task.deletedAt = new Date();
  await task.save();
  res.json({ message: 'Task berhasil dihapus' });
});

module.exports = router;
