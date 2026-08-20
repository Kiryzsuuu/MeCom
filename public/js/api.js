/**
 * WorkPulse AILO API helper — semua komunikasi ke backend melalui file ini
 */

const API_BASE = window.location.origin + '/api';

// Konversi File ke base64 string (data URI)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

function getToken() {
  return localStorage.getItem('wt_token');
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('wt_user') || 'null');
  } catch { return null; }
}

function saveSession(token, user) {
  localStorage.setItem('wt_token', token);
  localStorage.setItem('wt_user', JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem('wt_token');
  localStorage.removeItem('wt_user');
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/pages/login.html';
    return false;
  }
  return true;
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, { ...options, headers });

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearSession();
    window.location.href = '/pages/login.html';
    throw new Error('Sesi berakhir, silakan login kembali');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Terjadi kesalahan'), { status: res.status });
  return data;
}

async function apiUpload(path, formData) {
  const token = getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, { method: 'POST', headers, body: formData });

  if (res.status === 401) {
    clearSession();
    window.location.href = '/pages/login.html';
    throw new Error('Sesi berakhir');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Upload gagal');
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
const Auth = {
  async login(email, password) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    saveSession(data.token, data.user);
    return data;
  },
  async logout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    localStorage.removeItem('wt_token_real');
    localStorage.removeItem('wt_user_real');
    localStorage.removeItem('wt_impersonated_by');
    window.location.href = '/pages/login.html';
  },
  async impersonate(userId) {
    const data = await apiFetch('/auth/impersonate/' + userId, { method: 'POST' });
    localStorage.setItem('wt_token_real', getToken());
    localStorage.setItem('wt_user_real', localStorage.getItem('wt_user'));
    saveSession(data.token, data.user);
    localStorage.setItem('wt_impersonated_by', JSON.stringify(data.impersonatedBy));
    return data;
  },
  stopImpersonate() {
    const realToken = localStorage.getItem('wt_token_real');
    const realUser  = localStorage.getItem('wt_user_real');
    if (!realToken) return;
    localStorage.setItem('wt_token', realToken);
    localStorage.setItem('wt_user',  realUser);
    localStorage.removeItem('wt_token_real');
    localStorage.removeItem('wt_user_real');
    localStorage.removeItem('wt_impersonated_by');
  },
  isImpersonating() {
    return !!localStorage.getItem('wt_token_real');
  },
  async me() {
    return apiFetch('/auth/me');
  },
  async verifyIdentity(enik, password) {
    return apiFetch('/auth/verify-identity', { method: 'POST', body: JSON.stringify({ enik, password }) });
  },
  async changePassword({ passwordLama, passwordBaru }) {
    return apiFetch('/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify({ passwordLama, passwordBaru }),
    });
  },
};

// ── Users ─────────────────────────────────────────────────────────────────────
const Users = {
  async list(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch('/users' + (qs ? '?' + qs : ''));
  },
  async managersByDirektorat(id) {
    return apiFetch(`/users/dosen-direktorat/${id}`);
  },
  // Daftar user aktif yang bisa dipilih sebagai assignee (semua user login)
  async selectable(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch('/users/selectable' + (qs ? '?' + qs : ''));
  },
  async get(id) { return apiFetch(`/users/${id}`); },
  async create(data) {
    return apiFetch('/users', { method: 'POST', body: JSON.stringify(data) });
  },
  async update(id, data) {
    return apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async updateMe(data) {
    return apiFetch('/users/me', { method: 'PUT', body: JSON.stringify(data) });
  },
  async toggleStatus(id, statusAktif) {
    return apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ statusAktif }) });
  },
  async resetPassword(id, passwordBaru) {
    return apiFetch(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ passwordBaru }),
    });
  },
  async uploadAvatar(file) {
    const base64 = await fileToBase64(file);
    return apiFetch('/users/me/avatar', { method: 'POST', body: JSON.stringify({ base64 }) });
  },
};

// ── Direktorat ────────────────────────────────────────────────────────────────
const Direktorat = {
  async list() { return apiFetch('/direktorat'); },
  async create(data) { return apiFetch('/direktorat', { method: 'POST', body: JSON.stringify(data) }); },
  async update(id, data) { return apiFetch(`/direktorat/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
};

// ── Tasks ─────────────────────────────────────────────────────────────────────
const Tasks = {
  async list(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch('/tasks' + (qs ? '?' + qs : ''));
  },
  async get(id) { return apiFetch(`/tasks/${id}`); },
  async create(data) {
    return apiFetch('/tasks', { method: 'POST', body: JSON.stringify(data) });
  },
  async update(id, data) {
    return apiFetch(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async updateStatus(id, statusBaru, catatan = '') {
    return apiFetch(`/tasks/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ statusBaru, catatan }),
    });
  },
  // Assignee menandai bagiannya selesai (atau membatalkan)
  async completeMine(id, done = true) {
    return apiFetch(`/tasks/${id}/complete-mine`, { method: 'POST', body: JSON.stringify({ done }) });
  },
  // Validator menyetujui penyelesaian (atau menolak/revisi)
  async approve(id, approve = true) {
    return apiFetch(`/tasks/${id}/approve`, { method: 'POST', body: JSON.stringify({ approve }) });
  },
  // Antrian approval (Task Approval) — task & subtask menunggu approval
  async pendingApproval() {
    return apiFetch('/tasks/pending-approval');
  },
  // Clean Reset Data (top-tier) — butuh re-auth + kalimat konfirmasi
  async resetData({ enik, password, confirm }) {
    return apiFetch('/tasks/reset-data', { method: 'POST', body: JSON.stringify({ enik, password, confirm }) });
  },
  async delete(id) {
    return apiFetch(`/tasks/${id}`, { method: 'DELETE' });
  },
  async bulkStatus(taskIds, statusBaru, catatan = '') {
    return apiFetch('/tasks/bulk-status', { method: 'PUT', body: JSON.stringify({ taskIds, statusBaru, catatan }) });
  },
  async uploadCover(taskId, file) {
    const base64 = await fileToBase64(file);
    return apiFetch(`/tasks/${taskId}/cover`, { method: 'POST', body: JSON.stringify({ base64 }) });
  },
};

// ── Channels ──────────────────────────────────────────────────────────────────
const Channels = {
  async list()                    { return apiFetch('/channels'); },
  async get(id)                   { return apiFetch(`/channels/${id}`); },
  async create(data)              { return apiFetch('/channels', { method: 'POST', body: JSON.stringify(data) }); },
  async update(id, data)          { return apiFetch(`/channels/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  async delete(id)                { return apiFetch(`/channels/${id}`, { method: 'DELETE' }); },
  async join(id)                  { return apiFetch(`/channels/${id}/join`, { method: 'POST' }); },
  async leave(id)                 { return apiFetch(`/channels/${id}/leave`, { method: 'POST' }); },
  async invite(id, userId)        { return apiFetch(`/channels/${id}/invite`, { method: 'POST', body: JSON.stringify({ userId }) }); },
  async messages(id, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/channels/${id}/messages` + (qs ? '?' + qs : ''));
  },
  async sendMessage(id, isi)      { return apiFetch(`/channels/${id}/messages`, { method: 'POST', body: JSON.stringify({ isi }) }); },
  async deleteMessage(id, msgId)  { return apiFetch(`/channels/${id}/messages/${msgId}`, { method: 'DELETE' }); },
};

// ── Subtasks ──────────────────────────────────────────────────────────────────
const Subtasks = {
  async list(taskId) { return apiFetch(`/subtasks?taskId=${taskId}`); },
  // data dapat berisi { judul, parentId, assignees, dueDate, priority }
  async create(taskId, data) {
    return apiFetch('/subtasks', { method: 'POST', body: JSON.stringify({ taskId, ...data }) });
  },
  async update(id, data) {
    return apiFetch(`/subtasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  // Assignee kirim pekerjaan subtask ke Task Approval
  async submit(id, workNote) {
    return apiFetch(`/subtasks/${id}/submit`, { method: 'POST', body: JSON.stringify({ workNote }) });
  },
  // Validator (Task Approval) menyetujui/menolak subtask
  async approve(id, approve = true) {
    return apiFetch(`/subtasks/${id}/approve`, { method: 'POST', body: JSON.stringify({ approve }) });
  },
  async delete(id) { return apiFetch(`/subtasks/${id}`, { method: 'DELETE' }); },
  async reorder(items) {
    return apiFetch('/subtasks/reorder/batch', { method: 'PUT', body: JSON.stringify({ items }) });
  },
};

// ── Evidence ──────────────────────────────────────────────────────────────────
const Evidence = {
  async list(taskId, subtaskId) {
    let url = `/evidence?taskId=${taskId}`;
    if (subtaskId !== undefined) url += `&subtaskId=${subtaskId}`;
    return apiFetch(url);
  },
  async upload(taskId, file, subtaskId) {
    const fd = new FormData();
    fd.append('taskId', taskId);
    if (subtaskId) fd.append('subtaskId', subtaskId);
    fd.append('file', file);
    return apiUpload('/evidence', fd);
  },
  async delete(id) { return apiFetch(`/evidence/${id}`, { method: 'DELETE' }); },
};

// ── Komentar ──────────────────────────────────────────────────────────────────
const Komentar = {
  async list(taskId) { return apiFetch(`/komentar?taskId=${taskId}`); },
  async create(taskId, isi) {
    return apiFetch('/komentar', { method: 'POST', body: JSON.stringify({ taskId, isi }) });
  },
  async update(id, isi) {
    return apiFetch(`/komentar/${id}`, { method: 'PUT', body: JSON.stringify({ isi }) });
  },
  async delete(id) { return apiFetch(`/komentar/${id}`, { method: 'DELETE' }); },
};

// ── Notifikasi ────────────────────────────────────────────────────────────────
const Notifikasi = {
  async list(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch('/notifikasi' + (qs ? '?' + qs : ''));
  },
  async baca(id) { return apiFetch(`/notifikasi/${id}/baca`, { method: 'PUT' }); },
  async markRead(id) { return apiFetch(`/notifikasi/${id}/baca`, { method: 'PUT' }); },
  async bacaSemua() { return apiFetch('/notifikasi/baca-semua/all', { method: 'PUT' }); },
  async markAllRead() { return apiFetch('/notifikasi/baca-semua/all', { method: 'PUT' }); },
};

// ── KPI ───────────────────────────────────────────────────────────────────────
const KPI = {
  async me(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch('/kpi/me' + (qs ? '?' + qs : ''));
  },
  async semua(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch('/kpi/semua' + (qs ? '?' + qs : ''));
  },
  async manager(id, params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/kpi/manager/${id}` + (qs ? '?' + qs : ''));
  },
  async riwayat(userId) { return apiFetch(`/kpi/riwayat/${userId}`); },
};

// ── Site Settings ────────────────────────────────────────────────────────────
const SiteSettings = {
  async get() { return apiFetch('/site-settings'); },
  async update(data) {
    return apiFetch('/site-settings', { method: 'PUT', body: JSON.stringify(data) });
  },
  async uploadLogo(file) {
    const fd = new FormData();
    fd.append('logo', file);
    return apiUpload('/site-settings/logo', fd);
  },
};

// ── Dependencies ─────────────────────────────────────────────────────────────
const Dependency = {
  async list(taskId)      { return apiFetch(`/tasks/${taskId}/dependencies`); },
  async add(taskId, dependsOnId) {
    return apiFetch(`/tasks/${taskId}/dependencies`, { method: 'POST', body: JSON.stringify({ dependsOnId }) });
  },
  async remove(taskId, depId) {
    return apiFetch(`/tasks/${taskId}/dependencies/${depId}`, { method: 'DELETE' });
  },
};

// ── Recurrence ────────────────────────────────────────────────────────────────
const Recurrence = {
  async set(taskId, tipe, interval = 1) {
    return apiFetch(`/tasks/${taskId}/recurrence`, { method: 'POST', body: JSON.stringify({ tipe, interval }) });
  },
};

// ── Templates ─────────────────────────────────────────────────────────────────
const TaskTemplates = {
  async list()             { return apiFetch('/templates'); },
  async create(data)       { return apiFetch('/templates', { method: 'POST', body: JSON.stringify(data) }); },
  async fromTask(taskId, nama) {
    return apiFetch(`/templates/from-task/${taskId}`, { method: 'POST', body: JSON.stringify({ nama }) });
  },
  async apply(id, data) {
    return apiFetch(`/templates/${id}/apply`, { method: 'POST', body: JSON.stringify(data) });
  },
  async delete(id)         { return apiFetch(`/templates/${id}`, { method: 'DELETE' }); },
};

// ── Milestones ────────────────────────────────────────────────────────────────
const Milestones = {
  async list(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch('/milestones' + (qs ? '?' + qs : ''));
  },
  async create(data)         { return apiFetch('/milestones', { method: 'POST', body: JSON.stringify(data) }); },
  async update(id, data)     { return apiFetch(`/milestones/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  async delete(id)           { return apiFetch(`/milestones/${id}`, { method: 'DELETE' }); },
  async addTask(id, taskId)  { return apiFetch(`/milestones/${id}/tasks`, { method: 'POST', body: JSON.stringify({ taskId }) }); },
  async removeTask(id, taskId) { return apiFetch(`/milestones/${id}/tasks/${taskId}`, { method: 'DELETE' }); },
};

// ── Workload ──────────────────────────────────────────────────────────────────
const Workload = {
  async get(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiFetch('/reports/workload' + (qs ? '?' + qs : ''));
  },
};

// ── Reports ───────────────────────────────────────────────────────────────────
const Reports = {
  downloadKpiPdf(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const token = getToken();
    window.open(`${API_BASE}/reports/kpi/pdf${qs ? '?' + qs : ''}&_token=${token}`);
  },
  downloadKpiExcel(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const token = getToken();
    window.open(`${API_BASE}/reports/kpi/excel${qs ? '?' + qs : ''}&_token=${token}`);
  },
};

// ── Utils ─────────────────────────────────────────────────────────────────────
function formatTanggal(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRelative(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'baru saja';
  if (m < 60)  return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `${d} hari lalu`;
}

function statusLabel(status) {
  const map = {
    to_do:              'To Do',
    on_progress:        'On Progress',
    partially_complete: 'Partially Complete',
    complete:           'Complete',
    // legacy fallbacks
    menunggu_approval: 'To Do',
    in_progress:       'On Progress',
    perlu_review:      'On Progress',
    revisi:            'On Progress',
    done:              'Complete',
    ditolak:           'To Do',
  };
  return map[status] || status;
}

function statusBadgeClass(status) {
  const map = {
    to_do:              'badge-todo',
    on_progress:        'badge-progress',
    partially_complete: 'badge-review',
    complete:           'badge-done',
    // legacy
    menunggu_approval: 'badge-todo',
    in_progress:       'badge-progress',
    perlu_review:      'badge-review',
    revisi:            'badge-revisi',
    done:              'badge-done',
    ditolak:           'badge-rejected',
  };
  return map[status] || 'badge-todo';
}

function prioritasLabel(p) {
  const map = { normal: 'Normal', moderate: 'Moderate', urgent: 'Urgent', low: 'Normal', medium: 'Moderate', high: 'Urgent', critical: 'Urgent' };
  return map[p] || p;
}

function prioritasBadgeClass(p) {
  const map = { normal: 'badge-todo', moderate: 'badge-review', urgent: 'badge-rejected' };
  return map[p] || 'badge-todo';
}

function isOverdue(task) {
  return task.deadline && new Date(task.deadline) < new Date() &&
    task.status !== 'complete';
}

// Nama assignee (gabungan) untuk ditampilkan di list/board/dll
function assigneeNames(t) {
  const a = t.assignees || [];
  if (!a.length) return '-';
  return a.map(x => x.namaLengkap || '').filter(Boolean).join(', ') || '-';
}
// Assignee pertama (untuk avatar ringkas)
function firstAssignee(t) {
  return (t.assignees || [])[0] || null;
}
// Apakah task ini di-assign ke user tertentu
function isMyTask(t, userId) {
  return (t.assignees || []).some(a => (a._id || a) === userId);
}
// Gabungan nama dari array user ref
function namesOf(arr) {
  if (!arr || !arr.length) return '-';
  return arr.map(x => x.namaLengkap || '').filter(Boolean).join(', ') || '-';
}
// Daftar nama task creator (utama + co-creator)
function creatorNames(t) {
  const main = t.dibuatOleh ? [t.dibuatOleh] : [];
  return namesOf([...main, ...(t.creators || [])]);
}

function initials(nama) {
  if (!nama) return '?';
  return nama.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function showToast(pesan, tipe = 'success') {
  let t = document.getElementById('wt-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'wt-toast';
    t.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:9999;
      background:var(--surface);border:0.5px solid var(--border);
      border-radius:8px;padding:12px 16px;font-size:13px;
      box-shadow:0 4px 16px rgba(0,0,0,.12);display:none;
      max-width:320px;word-break:break-word;
    `;
    document.body.appendChild(t);
  }
  t.textContent = pesan;
  t.style.borderLeft = tipe === 'error' ? '3px solid var(--red)' : '3px solid var(--green)';
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3500);
}
