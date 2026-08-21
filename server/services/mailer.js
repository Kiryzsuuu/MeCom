const nodemailer = require('nodemailer');

async function getSmtpConfig() {
  try {
    const SiteSettings = require('../models/SiteSettings');
    const s = await SiteSettings.findOne().lean();
    console.log('[Mailer] DB smtp check — host:', s?.smtpHost, '| user:', s?.smtpUser, '| pass set:', !!s?.smtpPass);
    if (s && s.smtpUser && s.smtpPass) {
      const host = s.smtpHost || 'smtp.gmail.com';
      console.log('[Mailer] Using DB SMTP config, host:', host);
      return {
        host,
        port:   s.smtpPort || 587,
        secure: s.smtpSecure || false,
        user:   s.smtpUser,
        pass:   s.smtpPass,
        from:   s.smtpFrom || `"WorkPulse AILO" <${s.smtpUser}>`,
      };
    }
  } catch (err) {
    console.error('[Mailer] Gagal baca SiteSettings dari DB:', err.message);
  }
  // Fallback ke .env
  if (process.env.MAIL_USER && process.env.MAIL_PASS) {
    console.log('[Mailer] Using .env SMTP fallback, user:', process.env.MAIL_USER);
    return {
      host:   process.env.MAIL_HOST || 'smtp.gmail.com',
      port:   parseInt(process.env.MAIL_PORT) || 587,
      secure: false,
      user:   process.env.MAIL_USER,
      pass:   process.env.MAIL_PASS,
      from:   process.env.MAIL_FROM || `"WorkPulse AILO" <${process.env.MAIL_USER}>`,
    };
  }
  return null;
}

async function sendMail({ to, subject, html, text }) {
  const cfg = await getSmtpConfig();
  if (!cfg) {
    console.log('[Mailer] SMTP tidak dikonfigurasi, skip:', subject);
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transporter.sendMail({ from: cfg.from, to, subject, html, text });
  } catch (err) {
    console.error('[Mailer] Gagal kirim email:', err.message);
    throw err;
  }
}

// ── Template helpers ──────────────────────────────────────────────────────────

function emailLayout(title, body) {
  return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, Arial, sans-serif; background: #F2F2F5; margin: 0; padding: 20px; }
    .wrap { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; }
    .hdr  { background: #0E7C91; padding: 20px 28px; }
    .hdr h1 { color: #fff; margin: 0; font-size: 16px; }
    .hdr span { color: #F5821F; }
    .body { padding: 28px; color: #18181B; font-size: 14px; line-height: 1.6; }
    .body h2 { font-size: 16px; margin: 0 0 12px; }
    .pill { display: inline-block; padding: 3px 10px; border-radius: 100px; font-size: 12px; font-weight: 600; }
    .pill-purple { background: #E4F3F5; color: #0A6275; }
    .pill-orange { background: #FEF1E4; color: #9A3412; }
    .pill-green  { background: #DCFCE7; color: #166534; }
    .pill-red    { background: #FEF2F2; color: #991B1B; }
    .btn { display: inline-block; background: #0E7C91; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; margin-top: 16px; }
    .ftr { padding: 16px 28px; background: #F7F7F9; font-size: 12px; color: #71717A; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr"><h1>Work<span>Pulse</span></h1></div>
    <div class="body">
      <h2>${title}</h2>
      ${body}
    </div>
    <div class="ftr">WorkPulse AILO — Sistem internal perusahaan. Jangan balas email ini.</div>
  </div>
</body>
</html>`;
}

async function mailTaskApproved(user, task) {
  await sendMail({
    to: user.email,
    subject: `[WorkPulse AILO] Task Anda disetujui: ${task.judul}`,
    html: emailLayout('Task Disetujui', `
      <p>Halo <strong>${user.namaLengkap}</strong>,</p>
      <p>Task berikut telah disetujui dan siap dikerjakan:</p>
      <p><strong>${task.judul}</strong></p>
      <p>Deadline: <strong>${new Date(task.deadline).toLocaleDateString('id-ID')}</strong></p>
      <a href="${process.env.APP_URL}/task?id=${task._id}" class="btn">Lihat Task</a>
    `),
  });
}

async function mailTaskRejected(user, task, catatan) {
  await sendMail({
    to: user.email,
    subject: `[WorkPulse AILO] Task Anda ditolak: ${task.judul}`,
    html: emailLayout('Task Ditolak', `
      <p>Halo <strong>${user.namaLengkap}</strong>,</p>
      <p>Task berikut <strong>ditolak</strong>:</p>
      <p><strong>${task.judul}</strong></p>
      <p>Catatan: <em>${catatan}</em></p>
      <a href="${process.env.APP_URL}/task?id=${task._id}" class="btn">Lihat Task</a>
    `),
  });
}

async function mailTaskRevisi(user, task, catatan) {
  await sendMail({
    to: user.email,
    subject: `[WorkPulse AILO] Task perlu direvisi: ${task.judul}`,
    html: emailLayout('Task Dikembalikan untuk Revisi', `
      <p>Halo <strong>${user.namaLengkap}</strong>,</p>
      <p>Task berikut dikembalikan untuk revisi:</p>
      <p><strong>${task.judul}</strong></p>
      <p>Catatan revisi: <em>${catatan}</em></p>
      <a href="${process.env.APP_URL}/task?id=${task._id}" class="btn">Kerjakan Revisi</a>
    `),
  });
}

async function mailTaskDone(user, task) {
  await sendMail({
    to: user.email,
    subject: `[WorkPulse AILO] Hasil kerja disetujui: ${task.judul}`,
    html: emailLayout('Hasil Kerja Disetujui', `
      <p>Halo <strong>${user.namaLengkap}</strong>,</p>
      <p>Kerja bagus! Hasil kerja Anda pada task berikut telah disetujui:</p>
      <p><strong>${task.judul}</strong></p>
      <span class="pill pill-green">✓ Done</span>
    `),
  });
}

async function mailDeadlineReminder(user, task, hariSisa) {
  await sendMail({
    to: user.email,
    subject: `[WorkPulse AILO] Pengingat deadline: ${task.judul} (H-${hariSisa})`,
    html: emailLayout(`Deadline Task H-${hariSisa}`, `
      <p>Halo <strong>${user.namaLengkap}</strong>,</p>
      <p>Task berikut akan jatuh tempo dalam <strong>${hariSisa} hari</strong>:</p>
      <p><strong>${task.judul}</strong></p>
      <p>Deadline: <strong>${new Date(task.deadline).toLocaleDateString('id-ID')}</strong></p>
      <a href="${process.env.APP_URL}/task?id=${task._id}" class="btn">Lihat Task</a>
    `),
  });
}

async function mailPasswordReset(user, tempPassword) {
  await sendMail({
    to: user.email,
    subject: '[WorkPulse AILO] Reset Password',
    html: emailLayout('Reset Password', `
      <p>Halo <strong>${user.namaLengkap}</strong>,</p>
      <p>Password Anda telah direset. Berikut password sementara Anda:</p>
      <p style="font-size:20px;font-weight:700;letter-spacing:2px;color:#0E7C91">${tempPassword}</p>
      <p>Segera login dan ganti password Anda.</p>
      <a href="${process.env.APP_URL}" class="btn">Login Sekarang</a>
    `),
  });
}

async function mailDailyDigest(user, stats) {
  await sendMail({
    to: user.email,
    subject: `[WorkPulse AILO] Ringkasan Harian — ${new Date().toLocaleDateString('id-ID')}`,
    html: emailLayout('Ringkasan Harian', `
      <p>Halo <strong>${user.namaLengkap}</strong>, berikut ringkasan hari ini:</p>
      <ul>
        <li>Task menunggu approval: <strong>${stats.pendingApproval}</strong></li>
        <li>Task overdue: <strong>${stats.overdue}</strong></li>
        <li>Task deadline hari ini: <strong>${stats.dueToday}</strong></li>
      </ul>
      <a href="${process.env.APP_URL}/dashboard" class="btn">Buka Dashboard</a>
    `),
  });
}

module.exports = {
  sendMail,
  resetTransporter: () => {}, // no-op, kept for backward compatibility
  mailTaskApproved,
  mailTaskRejected,
  mailTaskRevisi,
  mailTaskDone,
  mailDeadlineReminder,
  mailPasswordReset,
  mailDailyDigest,
};
