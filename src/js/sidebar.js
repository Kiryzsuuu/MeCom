/* MeCom AILO — injects sidebar & sets active link */
function buildSidebar(activePage, activeProject) {
  const pages = [
    { id:'dashboard',  href:'dashboard.html', icon:'ti-layout-dashboard', label:'Dashboard' },
    { id:'my-issues',  href:'my-issues.html', icon:'ti-checkbox',         label:'My issues', badge:4 },
    { id:'inbox',      href:'inbox.html',      icon:'ti-bell',             label:'Inbox',     badge:2 },
  ];
  const projects = [
    { id:'backend',  color:'#5B4FE8', name:'MeCom AILO Backend',  href:'board.html', count:14 },
    { id:'frontend', color:'#16A34A', name:'MeCom AILO Frontend', href:'board.html', count:9  },
    { id:'design',   color:'#EA580C', name:'Design system',    href:'board.html', count:6  },
    { id:'docs',     color:'#DB2777', name:'Docs & API',       href:'board.html', count:5  },
  ];

  const navLinks = pages.map(p => `
    <a href="${p.href}" class="sb-link${activePage===p.id?' active':''}">
      <i class="ti ${p.icon}" aria-hidden="true"></i>
      ${p.label}
      ${p.badge ? `<span class="sb-badge">${p.badge}</span>` : ''}
    </a>`).join('');

  const projLinks = projects.map(p => `
    <a href="${p.href}" class="proj-link${activeProject===p.id?' active':''}">
      <span class="proj-dot" style="background:${p.color}"></span>
      <span class="proj-name">${p.name}</span>
      <span class="proj-count">${p.count}</span>
    </a>`).join('');

  return `
    <div class="sb-logo">
      <div class="sb-mark">P</div>
      <div>
        <div class="sb-name">MeCom AILO</div>
        <div class="sb-ws">My Workspace</div>
      </div>
      <i class="ti ti-chevron-down sb-ws-chevron" aria-hidden="true"></i>
    </div>
    <div class="sb-scroll">
      <div class="sb-section">
        <div class="sb-section-label">Menu</div>
        ${navLinks}
      </div>
      <div class="sb-section" style="margin-top:8px">
        <div class="sb-section-label">Projects</div>
        ${projLinks}
        <a href="create-project.html" class="proj-link" style="color:#52525B;margin-top:2px">
          <i class="ti ti-plus" style="font-size:13px;width:7px" aria-hidden="true"></i>
          <span class="proj-name">New project</span>
        </a>
      </div>
    </div>
    <div class="sb-user">
      <div class="sb-av av av-v">AR</div>
      <div>
        <div class="sb-uname">Andi Rachman</div>
        <div class="sb-urole">Admin</div>
      </div>
      <i class="ti ti-chevron-down" style="font-size:12px;color:#52525B;margin-left:auto" aria-hidden="true"></i>
    </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('sidebar');
  if (!el) return;
  const page    = el.dataset.page    || '';
  const project = el.dataset.project || 'backend';
  el.innerHTML  = buildSidebar(page, project);
});
