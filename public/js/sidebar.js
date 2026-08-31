/* WorkPulse AILO — Sidebar dinamis + Socket.io notifikasi realtime */

function buildSidebar(user, activePage) {
  if (!user) return '';

  // super_admin, direktur_coe, wakil_direktur_coe, dan sekretaris_coe adalah level top-tier/admin yang setara
  const isSuperAdminAccount = user.role === 'super_admin';
  const isSuperadmin = user.role === 'direktur_coe';
  const isDireksi    = user.role === 'sekretaris_coe';
  const isKomisaris  = user.role === 'wakil_direktur_coe';
  const isTopTier    = isSuperAdminAccount || isSuperadmin || isDireksi || isKomisaris;
  // dosen & member: role dasar, tanpa akses KPI/Administrasi — hanya Task & Workspace
  const isBasicRole  = user.role === 'dosen' || user.role === 'member';
  const inits     = (user.namaLengkap || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const avColors  = ['#5B4FE8','#16A34A','#EA580C','#0D9488','#DB2777'];
  const avColor   = avColors[inits.charCodeAt(0) % avColors.length];

  // Task list pages share one sidebar entry
  const taskListIds = ['tasks', 'board', 'gantt', 'calendar'];
  const isTaskList  = taskListIds.includes(activePage);

  const pages = [
    { id: 'dashboard',  href: '/dashboard', icon: 'ti-layout-dashboard', label: 'Dashboard',  section: 'tasks' },
    { id: 'my-tasks',   href: '/my-tasks',  icon: 'ti-checkbox',         label: 'My Tasks',   section: 'tasks' },
    { id: 'tasks',      href: '/list',       icon: 'ti-clipboard-list',   label: 'Task List',  section: 'tasks', activeIds: taskListIds },
    ...(isTopTier ? [
      { id: 'approval', href: '/approval', icon: 'ti-checks', label: 'Task Approval', section: 'tasks' },
    ] : []),
    { id: 'inbox',      href: '/inbox',      icon: 'ti-bell',             label: 'Notifikasi', section: 'tasks', badge: true },
    { id: 'messages',   href: '/messages',   icon: 'ti-message-circle',   label: 'Pesan',      section: 'workspace', badgeId: 'sb-dm-badge' },
    { id: 'channel',    href: '/channel',    icon: 'ti-messages',         label: 'Channel',    section: 'workspace' },
    ...(isBasicRole ? [] : [
      { id: 'kpi', href: '/stats', icon: 'ti-chart-bar', label: 'KPI', section: 'workspace' },
    ]),
    { id: 'milestones', href: '/milestones', icon: 'ti-flag',             label: 'Milestones', section: 'workspace' },
    { id: 'workload',   href: '/workload',   icon: 'ti-users-group',      label: 'Workload',   section: 'workspace' },
    ...(isTopTier ? [
      { id: 'users',  href: '/settings', icon: 'ti-users',        label: 'Manajemen User', section: 'admin' },
      { id: 'audit',  href: '/audit',    icon: 'ti-shield-check', label: 'Audit Trail',    section: 'admin' },
      { id: 'admin-tasks',   href: '/admin-tasks',   icon: 'ti-subtask',  label: 'Manajemen Task', section: 'admin' },
      { id: 'site-settings', href: '/site-settings', icon: 'ti-settings', label: 'Site Settings', section: 'admin' },
      { id: 'disaster',      href: '/disaster',      icon: 'ti-alert-triangle', label: 'Disaster Settings', section: 'admin' },
    ] : []),
  ];

  const sections = [
    { key: 'tasks',     label: 'Tasks' },
    { key: 'workspace', label: 'Workspace' },
    { key: 'admin',     label: 'Administrasi' },
  ];

  const navLinks = sections.map(sec => {
    const items = pages.filter(p => p.section === sec.key);
    if (!items.length) return '';
    return `<div class="sb-section">
      <div class="sb-section-label">${sec.label}</div>
      ${items.map(p => {
        const isActive = p.activeIds ? p.activeIds.includes(activePage) : activePage === p.id;
        return `<a href="${p.href}" class="sb-link${isActive ? ' active' : ''}" data-page="${p.id}">
          <i class="ti ${p.icon}" aria-hidden="true"></i>
          ${p.label}
          ${p.badge ? `<span class="sb-badge" id="sb-notif-badge" style="display:none">0</span>` : ''}
          ${p.badgeId ? `<span class="sb-badge" id="${p.badgeId}" style="display:none">0</span>` : ''}
        </a>`;
      }).join('')}
    </div>`;
  }).join('');

  const fotoHtml = user.fotoProfil
    ? `<img src="${user.fotoProfil}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`
    : `<div class="sb-av" style="background:${avColor}">${inits}</div>`;

  const basicRoleLabel = user.role === 'member' ? 'Member' : 'Dosen';
  const roleLabel = isSuperAdminAccount ? 'Super Admin' : isSuperadmin ? 'Direktur CoE' : isDireksi ? 'Sekretaris CoE' : isKomisaris ? 'Wakil Direktur CoE' : (user.direktoratId?.nama || basicRoleLabel);

  return `
    <div class="sb-logo">
      <div class="sb-mark" style="background:transparent;padding:4px">
        <img src="/img/logo.png" alt="Logo" style="width:100%;height:100%;object-fit:contain" onerror="this.parentElement.innerHTML='I'">
      </div>
      <div>
        <div class="sb-name" id="sb-app-name">WorkPulse AILO</div>
        <div class="sb-ws">${roleLabel}</div>
      </div>
    </div>
    <div class="sb-scroll">
      ${navLinks}
    </div>
    <div class="sb-user" style="display:flex;align-items:center;gap:8px">
      <div onclick="window.location='/profile'" style="cursor:pointer;display:flex;align-items:center;gap:10px;flex:1;min-width:0">
        ${fotoHtml}
        <div style="min-width:0">
          <div class="sb-uname">${user.namaLengkap}</div>
          <div class="sb-urole">${roleLabel}</div>
        </div>
      </div>
      <button onclick="event.stopPropagation();sidebarLogout()" title="Keluar dari akun" aria-label="Logout"
        style="background:none;border:none;cursor:pointer;color:#A1A1AA;padding:6px;border-radius:6px;display:flex;align-items:center;flex-shrink:0"
        onmouseover="this.style.color='#EF4444';this.style.background='rgba(239,68,68,.1)'"
        onmouseout="this.style.color='#A1A1AA';this.style.background='none'">
        <i class="ti ti-logout" style="font-size:17px"></i>
      </button>
    </div>`;
}

function injectImpersonateBanner(targetName, adminName) {
  const style = document.createElement('style');
  style.textContent = `
    #impersonate-banner {
      position:fixed;bottom:0;left:0;right:0;z-index:9999;
      background:#92400E;color:#FEF3C7;
      display:flex;align-items:center;justify-content:center;gap:12px;
      padding:10px 20px;font-size:13px;font-weight:600;
      box-shadow:0 -2px 12px rgba(0,0,0,.2);
    }
    #impersonate-banner i { font-size:16px; }
    #impersonate-banner button {
      background:#FEF3C7;color:#92400E;border:none;border-radius:6px;
      padding:5px 14px;font-size:12px;font-weight:700;cursor:pointer;
      transition:opacity .15s;
    }
    #impersonate-banner button:hover { opacity:.85 }
    .main { padding-bottom: 48px !important; }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  banner.id = 'impersonate-banner';
  banner.innerHTML = `
    <i class="ti ti-user-check"></i>
    Anda menyamar sebagai <strong style="margin:0 4px">${targetName}</strong> (sebagai ${adminName})
    <button onclick="exitImpersonate()">Keluar dari Mode Penyamaran</button>
  `;
  document.body.appendChild(banner);
}

function exitImpersonate() {
  Auth.stopImpersonate();
  window.location.reload();
}

async function sidebarLogout() {
  const ok = (typeof showConfirm === 'function')
    ? await showConfirm('Keluar dari akun?', { title: 'Keluar', okLabel: 'Keluar', cancelLabel: 'Batal', type: 'warning' })
    : window.confirm('Keluar dari akun?');
  if (!ok) return;
  try { await Auth.logout(); } catch { window.location.href = '/login'; }
}

// Mobile overlay sidebar
function injectMobileToggle() {
  // Inject style
  const style = document.createElement('style');
  style.textContent = `
    #sb-mobile-toggle {
      display:none;position:fixed;top:12px;left:12px;z-index:1200;
      background:var(--accent);color:#fff;border:none;border-radius:9px;
      width:38px;height:38px;cursor:pointer;align-items:center;justify-content:center;font-size:19px;
      box-shadow:0 2px 8px rgba(91,79,232,.4);
    }
    #sb-overlay {
      display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1099;backdrop-filter:blur(2px);
    }
    @media(max-width:768px){
      #sb-mobile-toggle{display:flex!important;}
    }
  `;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'sb-mobile-toggle';
  btn.innerHTML = '<i class="ti ti-menu-2"></i>';
  document.body.appendChild(btn);

  const overlay = document.createElement('div');
  overlay.id = 'sb-overlay';
  document.body.appendChild(overlay);

  const openSidebar = () => {
    document.querySelector('.sidebar')?.classList.add('open');
    overlay.style.display = 'block';
    btn.innerHTML = '<i class="ti ti-x"></i>';
  };
  const closeSidebar = () => {
    document.querySelector('.sidebar')?.classList.remove('open');
    overlay.style.display = 'none';
    btn.innerHTML = '<i class="ti ti-menu-2"></i>';
  };

  btn.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);
}

async function initSidebar(activePage) {
  const el = document.getElementById('sidebar');
  if (!el) return;

  injectMobileToggle();

  // Ambil user dari cache atau API
  let user = getUser();
  if (!user) {
    try { const r = await Auth.me(); user = r?.user || r; localStorage.setItem('wt_user', JSON.stringify(user)); }
    catch { window.location.href = '/login'; return; }
  }

  el.innerHTML = buildSidebar(user, activePage);

  // Banner impersonasi
  if (Auth.isImpersonating()) {
    const by = JSON.parse(localStorage.getItem('wt_impersonated_by') || '{}');
    injectImpersonateBanner(user.namaLengkap, by.nama || 'Direktur CoE');
  }

  // Sinkron data user dari server (mis. role baru diubah admin) tanpa perlu login ulang.
  Auth.me().then(resp => {
    const fresh = resp?.user || resp;
    if (!fresh || !fresh.role) return;
    const dirId  = id => id?._id || id || '';
    const changed = fresh.role !== user.role ||
                    dirId(fresh.direktoratId) !== dirId(user.direktoratId) ||
                    fresh.namaLengkap !== user.namaLengkap ||
                    fresh.fotoProfil !== user.fotoProfil;
    localStorage.setItem('wt_user', JSON.stringify(fresh));
    if (changed) el.innerHTML = buildSidebar(fresh, activePage);
  }).catch(() => {});

  // Load app name dari site settings
  fetch('/api/site-settings').then(r => r.json()).then(s => {
    const el = document.getElementById('sb-app-name');
    if (el && s.appName) el.textContent = s.appName;
    if (s.accentColor) document.documentElement.style.setProperty('--accent', s.accentColor);
  }).catch(() => {});

  // Socket.io koneksi untuk notifikasi realtime
  initSocketNotif(user);

  // Load badge count
  loadNotifBadge();
  loadDmBadge();
}

async function loadNotifBadge() {
  try {
    const { unreadCount } = await Notifikasi.list({ limit: 1 });
    const badge = document.getElementById('sb-notif-badge');
    if (badge) {
      badge.textContent = unreadCount;
      badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }
  } catch {}
}

async function loadDmBadge() {
  try {
    const { unreadCount } = await DM.unreadCount();
    const badge = document.getElementById('sb-dm-badge');
    if (badge) {
      badge.textContent = unreadCount;
      badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }
  } catch {}
}

function initSocketNotif(user) {
  if (typeof io === 'undefined') return;
  const token = getToken();
  if (!token) return;

  const socket = io(window.location.origin, { auth: { token } });

  socket.on('notifikasi:baru', (notif) => {
    // Update badge
    const badge = document.getElementById('sb-notif-badge');
    if (badge) {
      const current = parseInt(badge.textContent || '0');
      badge.textContent = current + 1;
      badge.style.display = 'flex';
    }
    // Toast
    showToast(`🔔 ${notif.judul}: ${notif.isi}`);
  });

  socket.on('dm:message', ({ conversationId, message }) => {
    // Jangan tambah badge kalau lagi buka percakapan itu (halaman messages.html menandainya sendiri)
    if (window.__activeDmConversationId === conversationId) return;
    if (message.senderId?._id === user._id || message.senderId === user._id) return;

    const badge = document.getElementById('sb-dm-badge');
    if (badge) {
      const current = parseInt(badge.textContent || '0');
      badge.textContent = current + 1;
      badge.style.display = 'flex';
    }
    showToast(`💬 ${message.senderId?.namaLengkap || 'Pesan baru'}: ${message.isi}`);
  });
}

function injectGlobalSearchBtn() {
  // Add search button to topbar-right if present
  const topbarRight = document.querySelector('.topbar-right');
  if (!topbarRight) return;
  const btn = document.createElement('button');
  btn.className = 'btn-icon';
  btn.title = 'Cari (Ctrl+K)';
  btn.innerHTML = `<i class="ti ti-search"></i>`;
  btn.style.cssText = 'position:relative';
  btn.addEventListener('click', () => typeof openGlobalSearch === 'function' && openGlobalSearch());

  // Add keyboard shortcut hint badge
  const hint = document.createElement('span');
  hint.style.cssText = `position:absolute;top:-4px;right:-4px;background:var(--accent);color:#fff;border-radius:4px;font-size:9px;padding:0 3px;font-weight:700;pointer-events:none`;
  hint.textContent = '⌘K';
  btn.appendChild(hint);

  topbarRight.prepend(btn);
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('sidebar');
  if (!el) return;
  const page = el.dataset.page || '';
  initSidebar(page);
  injectGlobalSearchBtn();
});
