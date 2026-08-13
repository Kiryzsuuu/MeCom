const Notifikasi = require('../models/Notifikasi');
const { emitToUser } = require('../socket');

async function buatNotifikasi({ userId, jenis, judul, isi, taskId = null }) {
  const notif = await Notifikasi.create({ userId, jenis, judul, isi, taskId });
  // Kirim realtime via socket
  emitToUser(userId.toString(), 'notifikasi:baru', {
    _id:    notif._id,
    jenis,
    judul,
    isi,
    taskId,
    createdAt: notif.createdAt,
  });
  return notif;
}

// Helpers per event

async function notifTaskMenungguApproval(direksiUsers, task, pembuat) {
  for (const d of direksiUsers) {
    await buatNotifikasi({
      userId: d._id,
      jenis:  'task_menunggu_approval',
      judul:  'Task baru menunggu persetujuan',
      isi:    `${pembuat.namaLengkap} membuat task: "${task.judul}"`,
      taskId: task._id,
    });
  }
}

async function notifTaskApproved(pic, task) {
  await buatNotifikasi({
    userId: pic._id,
    jenis:  'task_diapprove',
    judul:  'Task Anda disetujui',
    isi:    `Task "${task.judul}" disetujui dan siap dikerjakan.`,
    taskId: task._id,
  });
}

async function notifTaskRejected(pembuat, task, catatan) {
  await buatNotifikasi({
    userId: pembuat._id,
    jenis:  'task_ditolak',
    judul:  'Task Anda ditolak',
    isi:    `Task "${task.judul}" ditolak. Alasan: ${catatan}`,
    taskId: task._id,
  });
}

async function notifSubmitReview(direksiUsers, task, pic) {
  for (const d of direksiUsers) {
    await buatNotifikasi({
      userId: d._id,
      jenis:  'submit_review',
      judul:  'Task siap direview',
      isi:    `${pic.namaLengkap} mengajukan review task: "${task.judul}"`,
      taskId: task._id,
    });
  }
}

async function notifTaskDone(pic, task) {
  await buatNotifikasi({
    userId: pic._id,
    jenis:  'task_done',
    judul:  'Hasil kerja disetujui',
    isi:    `Task "${task.judul}" selesai dan disetujui.`,
    taskId: task._id,
  });
}

async function notifTaskRevisi(pic, task, catatan) {
  await buatNotifikasi({
    userId: pic._id,
    jenis:  'task_revisi',
    judul:  'Task perlu direvisi',
    isi:    `Task "${task.judul}" dikembalikan untuk revisi. Catatan: ${catatan}`,
    taskId: task._id,
  });
}

async function notifKomentarBaru(userIds, task, komentator) {
  for (const uid of userIds) {
    if (uid.toString() === komentator._id.toString()) continue;
    await buatNotifikasi({
      userId: uid,
      jenis:  'komentar_baru',
      judul:  'Komentar baru',
      isi:    `${komentator.namaLengkap} menambahkan komentar di task "${task.judul}"`,
      taskId: task._id,
    });
  }
}

async function notifDeadlineReminder(pic, task, hari) {
  await buatNotifikasi({
    userId: pic._id,
    jenis:  `reminder_h${hari}`,
    judul:  `Pengingat deadline H-${hari}`,
    isi:    `Task "${task.judul}" deadline ${hari} hari lagi (${new Date(task.deadline).toLocaleDateString('id-ID')})`,
    taskId: task._id,
  });
}

async function notifOverdue(pic, task) {
  await buatNotifikasi({
    userId: pic._id,
    jenis:  'task_overdue',
    judul:  'Task overdue',
    isi:    `Task "${task.judul}" sudah melewati deadline dan belum selesai.`,
    taskId: task._id,
  });
}

async function notifRevisiTerbengkalai(pic, task) {
  await buatNotifikasi({
    userId: pic._id,
    jenis:  'revisi_terbengkalai',
    judul:  'Revisi belum dikerjakan',
    isi:    `Task "${task.judul}" masih dalam status revisi selama lebih dari 2 hari kerja.`,
    taskId: task._id,
  });
}

module.exports = {
  buatNotifikasi,
  notifTaskMenungguApproval,
  notifTaskApproved,
  notifTaskRejected,
  notifSubmitReview,
  notifTaskDone,
  notifTaskRevisi,
  notifKomentarBaru,
  notifDeadlineReminder,
  notifOverdue,
  notifRevisiTerbengkalai,
};
