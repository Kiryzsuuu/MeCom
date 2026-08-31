const cron     = require('node-cron');
const Task     = require('../models/Task');
const User     = require('../models/User');
const notifSvc = require('../services/notifikasi');
const mailer   = require('../services/mailer');
const wa       = require('../services/whatsapp');
const { simpanSnapshot } = require('../services/kpi');
const push     = require('../services/push');
const { TOP_TIER_ROLES, KPI_SUBJECT_ROLES } = require('../middleware/roles');

function hariKerja(tanggal) {
  const hari = tanggal.getDay();
  return hari !== 0 && hari !== 6;
}

function startCronJobs() {
  // ── Setiap jam 08:00 — reminder deadline H-3 dan H-1 ────────────────────────
  cron.schedule('0 8 * * 1-5', async () => {
    try {
      const now = new Date();

      for (const hari of [3, 1]) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + hari);
        targetDate.setHours(23, 59, 59, 999);
        const mulai = new Date(targetDate);
        mulai.setHours(0, 0, 0, 0);

        const tasks = await Task.find({
          isDeleted:    false,
          archivedAt:   null,
          status:       { $ne: 'complete' },
          deadline:     { $gte: mulai, $lte: targetDate },
        }).populate('assignees');

        for (const task of tasks) {
          const assignees = task.assignees || [];
          for (const pic of assignees) {
            if (!pic) continue;
            await notifSvc.notifDeadlineReminder(pic, task, hari);
            if (pic.notifEmail) await mailer.mailDeadlineReminder(pic, task, hari).catch(() => {});
            await wa.sendWADeadlineReminder(pic, task, hari);
          }

          // H-1: notif ke top-tier (Direktur CoE/Wakil Direktur CoE/Sekretaris CoE) juga
          if (hari === 1) {
            const namaAssignee = assignees.map(a => a.namaLengkap).join(', ') || '-';
            const direksi = await User.find({ role: { $in: TOP_TIER_ROLES }, statusAktif: true });
            for (const d of direksi) {
              await notifSvc.buatNotifikasi({
                userId: d._id,
                jenis:  'reminder_deadline_direksi',
                judul:  `Task mendekati deadline H-1`,
                isi:    `Task "${task.judul}" (${namaAssignee}) deadline besok`,
                taskId: task._id,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[Cron Reminder]', err.message);
    }
  });

  // ── Setiap jam 09:00 — reminder overdue HARIAN ke assignee ──────────────────
  // Berjalan tiap hari (termasuk weekend) selama task masih overdue & belum complete.
  cron.schedule('0 9 * * *', async () => {
    try {
      const now = new Date();

      // SEMUA task yang sudah lewat deadline & belum complete (bukan hanya H+1)
      const tasks = await Task.find({
        isDeleted:  false,
        archivedAt: null,
        status:     { $ne: 'complete' },
        deadline:   { $lt: now },
      }).populate('assignees');

      const direksi = await User.find({ role: { $in: TOP_TIER_ROLES }, statusAktif: true });

      for (const task of tasks) {
        const assignees = task.assignees || [];
        // Notif harian ke tiap assignee — tetap dikirim walau sudah overdue lama
        for (const pic of assignees) {
          if (!pic) continue;
          await notifSvc.notifOverdue(pic, task).catch(() => {});
          push.sendPush(pic._id, {
            title: '⚠ Task Overdue', body: `${task.judul} sudah lewat deadline — segera selesaikan`,
            url: `/task?id=${task._id}`,
          }).catch(() => {});
        }
        const namaAssignee = assignees.map(a => a.namaLengkap).join(', ') || '-';
        for (const d of direksi) {
          await notifSvc.buatNotifikasi({
            userId: d._id,
            jenis:  'task_overdue_direksi',
            judul:  'Task overdue',
            isi:    `Task "${task.judul}" (${namaAssignee}) sudah melewati deadline`,
            taskId: task._id,
          });
        }
      }
    } catch (err) {
      console.error('[Cron Overdue]', err.message);
    }
  });

  // ── Setiap jam 10:00 hari kerja — approval terbengkalai > 2 hari kerja ───────
  cron.schedule('0 10 * * 1-5', async () => {
    try {
      const tasks = await Task.find({
        isDeleted:  false,
        archivedAt: null,
        pendingApproval: true,
        status:     { $ne: 'complete' },
      }).populate('dibuatOleh');

      for (const task of tasks) {
        const lastUpdate = task.updatedAt;
        let hariKerjaCount = 0;
        const check = new Date(lastUpdate);
        while (check <= new Date()) {
          if (hariKerja(check)) hariKerjaCount++;
          check.setDate(check.getDate() + 1);
          if (hariKerjaCount > 2) break;
        }
        if (hariKerjaCount > 2) {
          const creator = task.dibuatOleh;
          if (creator) await notifSvc.buatNotifikasi({
            userId: creator._id,
            jenis:  'approval_terbengkalai',
            judul:  'Menunggu approval Anda',
            isi:    `Task "${task.judul}" menunggu persetujuan penyelesaian`,
            taskId: task._id,
          });
        }
      }
    } catch (err) {
      console.error('[Cron Approval]', err.message);
    }
  });

  // ── Setiap jam 08:00 hari Senin — auto-archive task Done > 90 hari ──────────
  cron.schedule('0 8 * * 1', async () => {
    try {
      const batas = new Date();
      batas.setDate(batas.getDate() - 90);
      await Task.updateMany(
        { status: 'complete', doneAt: { $lt: batas }, archivedAt: null, isDeleted: false },
        { archivedAt: new Date() }
      );
    } catch (err) {
      console.error('[Cron Archive]', err.message);
    }
  });

  // ── Setiap hari pertama bulan jam 07:00 — simpan KPI snapshot bulanan ────────
  cron.schedule('0 7 1 * *', async () => {
    try {
      const now      = new Date();
      const bulan    = now.getMonth() === 0 ? 12 : now.getMonth();
      const tahun    = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const managers = await User.find({ role: { $in: KPI_SUBJECT_ROLES }, statusAktif: true });
      for (const m of managers) {
        await simpanSnapshot(m._id, bulan, tahun).catch(() => {});
      }
      console.log(`[Cron KPI] Snapshot ${bulan}/${tahun} disimpan untuk ${managers.length} anggota`);
    } catch (err) {
      console.error('[Cron KPI]', err.message);
    }
  });

  // ── Setiap hari jam 08:05 — daily digest untuk top-tier ──────────────────────
  cron.schedule('5 8 * * 1-5', async () => {
    try {
      const direksi = await User.find({ role: { $in: TOP_TIER_ROLES }, statusAktif: true });
      const now = new Date();
      const today = new Date(now); today.setHours(23, 59, 59, 999);
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

      const [pendingApproval, overdueTasks, dueToday] = await Promise.all([
        Task.countDocuments({ pendingApproval: true, isDeleted: false }),
        Task.countDocuments({ status: { $ne: 'complete' }, deadline: { $lt: now }, isDeleted: false }),
        Task.countDocuments({ deadline: { $gte: todayStart, $lte: today }, status: { $ne: 'complete' }, isDeleted: false }),
      ]);

      for (const d of direksi) {
        if (d.notifEmail) {
          await mailer.mailDailyDigest(d, { pendingApproval, overdue: overdueTasks, dueToday }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[Cron Digest]', err.message);
    }
  });

  // ── Setiap jam 07:00 — spawn task recurring yang sudah due ──────────────────
  cron.schedule('0 7 * * *', async () => {
    try {
      const now = new Date();
      const tasks = await Task.find({
        'recurrence.tipe': { $ne: 'none' },
        'recurrence.nextRun': { $lte: now },
        isDeleted: false,
      });

      for (const parent of tasks) {
        const interval = parent.recurrence.interval || 1;
        const tipe     = parent.recurrence.tipe;

        // Hitung deadline baru
        const oldDeadline = new Date(parent.deadline);
        const newDeadline = new Date(oldDeadline);
        if (tipe === 'daily')   newDeadline.setDate(newDeadline.getDate() + interval);
        if (tipe === 'weekly')  newDeadline.setDate(newDeadline.getDate() + interval * 7);
        if (tipe === 'monthly') newDeadline.setMonth(newDeadline.getMonth() + interval);

        await Task.create({
          judul:        parent.judul,
          deskripsi:    parent.deskripsi,
          assignees:    parent.assignees,
          dibuatOleh:   parent.dibuatOleh,
          direktoratId: parent.direktoratId,
          prioritas:    parent.prioritas,
          deadline:     newDeadline,
          templateId:   parent.templateId,
          recurrence: { tipe, interval, parentId: parent._id },
        });

        // Update nextRun di parent
        const nextRun = new Date(newDeadline);
        if (tipe === 'daily')   nextRun.setDate(nextRun.getDate() + interval);
        if (tipe === 'weekly')  nextRun.setDate(nextRun.getDate() + interval * 7);
        if (tipe === 'monthly') nextRun.setMonth(nextRun.getMonth() + interval);
        parent.recurrence.nextRun = nextRun;
        await parent.save();
      }

      if (tasks.length) console.log(`[Cron Recurring] Dibuat ${tasks.length} task baru`);
    } catch (err) {
      console.error('[Cron Recurring]', err.message);
    }
  });

  console.log('[Cron] Job terjadwal aktif');
}

module.exports = { startCronJobs };
