/**
 * WorkPulse AILO Global Search — Command Palette (Ctrl+K / Cmd+K)
 * Inject via <script src="/js/search.js"></script> on every page
 */
(function () {
  let overlay, modal, input, resultsEl;
  let searchTimer;
  let isOpen = false;

  const STATUS_COLOR = {
    done:              '#10B981',
    in_progress:       '#3B82F6',
    perlu_review:      '#8B5CF6',
    revisi:            '#EF4444',
    menunggu_approval: '#F59E0B',
    to_do:             '#6B7280',
    ditolak:           '#9CA3AF',
  };

  function inject() {
    const style = document.createElement('style');
    style.textContent = `
      #gs-overlay {
        display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9900;
        backdrop-filter:blur(6px);align-items:flex-start;justify-content:center;padding-top:80px;
      }
      #gs-overlay.open { display:flex }
      #gs-modal {
        width:100%;max-width:600px;background:var(--surface);border:0.5px solid var(--border);
        border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.3);overflow:hidden;
      }
      #gs-input-wrap {
        display:flex;align-items:center;gap:12px;padding:16px 20px;
        border-bottom:0.5px solid var(--border);
      }
      #gs-input {
        flex:1;background:transparent;border:none;outline:none;font-size:16px;
        color:var(--text);caret-color:var(--accent);
      }
      #gs-input::placeholder { color:var(--text-3) }
      #gs-kbd {
        font-size:11px;color:var(--text-3);background:var(--surface-2);
        border:0.5px solid var(--border);border-radius:5px;padding:2px 7px;flex-shrink:0;
      }
      #gs-results { max-height:400px;overflow-y:auto }
      .gs-section { padding:8px 0 }
      .gs-section-label {
        font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;
        letter-spacing:.8px;padding:6px 20px 4px;
      }
      .gs-item {
        display:flex;align-items:center;gap:12px;padding:10px 20px;cursor:pointer;
        transition:background .08s;text-decoration:none;color:var(--text);
      }
      .gs-item:hover, .gs-item.active { background:var(--surface-2) }
      .gs-item-icon {
        width:32px;height:32px;border-radius:8px;flex-shrink:0;
        display:flex;align-items:center;justify-content:center;font-size:14px;
      }
      .gs-item-title { font-size:13px;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
      .gs-item-sub   { font-size:11px;color:var(--text-3);margin-top:1px }
      .gs-item-badge { font-size:10px;font-weight:700;padding:2px 8px;border-radius:100px;flex-shrink:0 }
      .gs-empty { padding:40px;text-align:center;font-size:13px;color:var(--text-3) }
      .gs-empty i { font-size:32px;opacity:.3;display:block;margin-bottom:8px }
      #gs-footer {
        display:flex;align-items:center;gap:16px;padding:10px 20px;
        border-top:0.5px solid var(--border);font-size:11px;color:var(--text-3);
      }
      .gs-hint { display:flex;align-items:center;gap:5px }
      .gs-hint kbd { background:var(--surface-2);border:0.5px solid var(--border);border-radius:4px;padding:1px 5px;font-size:10px }
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'gs-overlay';
    overlay.innerHTML = `
      <div id="gs-modal" role="dialog" aria-modal="true" aria-label="Cari">
        <div id="gs-input-wrap">
          <i class="ti ti-search" style="font-size:18px;color:var(--text-3);flex-shrink:0"></i>
          <input id="gs-input" placeholder="Cari task, pengguna..." autocomplete="off" spellcheck="false">
          <kbd id="gs-kbd">Esc</kbd>
        </div>
        <div id="gs-results">
          <div class="gs-empty"><i class="ti ti-search"></i>Ketik untuk mulai mencari...</div>
        </div>
        <div id="gs-footer">
          <div class="gs-hint"><kbd>↑↓</kbd> navigasi</div>
          <div class="gs-hint"><kbd>Enter</kbd> buka</div>
          <div class="gs-hint"><kbd>Esc</kbd> tutup</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    input     = document.getElementById('gs-input');
    resultsEl = document.getElementById('gs-results');

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(doSearch, 250);
    });
    input.addEventListener('keydown', onKeydown);
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    overlay.classList.add('open');
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    isOpen = false;
    overlay.classList.remove('open');
    input.value = '';
    resultsEl.innerHTML = '<div class="gs-empty"><i class="ti ti-search"></i>Ketik untuk mulai mencari...</div>';
  }

  function onKeydown(e) {
    const items = resultsEl.querySelectorAll('.gs-item');
    const active = resultsEl.querySelector('.gs-item.active');
    let idx = Array.from(items).indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      items[(idx + 1) % items.length]?.classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      items[(idx - 1 + items.length) % items.length]?.classList.add('active');
    } else if (e.key === 'Enter') {
      const cur = resultsEl.querySelector('.gs-item.active') || items[0];
      if (cur) { cur.click(); }
    } else if (e.key === 'Escape') {
      close();
    }
  }

  async function doSearch() {
    const q = input.value.trim();
    if (q.length < 2) {
      resultsEl.innerHTML = '<div class="gs-empty"><i class="ti ti-search"></i>Ketik minimal 2 karakter...</div>';
      return;
    }

    resultsEl.innerHTML = '<div class="gs-empty"><i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>Mencari...</div>';

    try {
      const [taskRes, userRes] = await Promise.all([
        apiFetch(`/tasks?search=${encodeURIComponent(q)}&limit=6`).catch(() => ({ tasks: [] })),
        apiFetch(`/users?search=${encodeURIComponent(q)}&limit=4`).catch(() => ({ users: [] })),
      ]);

      const tasks = taskRes.tasks || [];
      const users = userRes.users || [];

      if (!tasks.length && !users.length) {
        resultsEl.innerHTML = `<div class="gs-empty"><i class="ti ti-mood-empty"></i>Tidak ada hasil untuk "<strong>${q}</strong>"</div>`;
        return;
      }

      let html = '';

      if (tasks.length) {
        html += `<div class="gs-section">
          <div class="gs-section-label"><i class="ti ti-clipboard-list" style="font-size:10px;margin-right:4px"></i>Task</div>`;
        tasks.forEach(t => {
          const sc = STATUS_COLOR[t.status] || '#6B7280';
          const overdueTag = isOverdue(t) ? '<span style="color:#EF4444;font-size:10px;font-weight:700;margin-left:6px">⚠ Overdue</span>' : '';
          html += `
            <a class="gs-item" href="/task?id=${t._id}" onclick="closeGlobalSearch()">
              <div class="gs-item-icon" style="background:${sc}20">
                <i class="ti ti-clipboard" style="color:${sc}"></i>
              </div>
              <div style="flex:1;min-width:0">
                <div class="gs-item-title">${highlight(t.judul, q)}${overdueTag}</div>
                <div class="gs-item-sub">${assigneeNames(t)} · ${t.direktoratId?.kode || ''} · ${formatTanggal(t.deadline)}</div>
              </div>
              <span class="gs-item-badge" style="background:${sc}20;color:${sc}">${statusLabel(t.status)}</span>
            </a>`;
        });
        html += '</div>';
      }

      if (users.length) {
        html += `<div class="gs-section" style="border-top:0.5px solid var(--border)">
          <div class="gs-section-label"><i class="ti ti-user" style="font-size:10px;margin-right:4px"></i>Pengguna</div>`;
        users.forEach(u => {
          const inits = (u.namaLengkap || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
          const avHtml = u.fotoProfil
            ? `<img src="${u.fotoProfil}" style="width:32px;height:32px;border-radius:8px;object-fit:cover">`
            : `<div style="width:32px;height:32px;border-radius:8px;background:#5B4FE8;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">${inits}</div>`;
          html += `
            <a class="gs-item" href="/list?assigneeId=${u._id}" onclick="closeGlobalSearch()">
              ${avHtml}
              <div style="flex:1;min-width:0">
                <div class="gs-item-title">${highlight(u.namaLengkap, q)}</div>
                <div class="gs-item-sub">${u.role} · ${u.direktoratId?.nama || ''}</div>
              </div>
            </a>`;
        });
        html += '</div>';
      }

      resultsEl.innerHTML = html;

      // Wire up anchor clicks to close search
      resultsEl.querySelectorAll('.gs-item').forEach(el => {
        el.addEventListener('click', () => { isOpen = false; overlay.classList.remove('open'); });
      });

    } catch (e) {
      resultsEl.innerHTML = `<div class="gs-empty"><i class="ti ti-alert-triangle"></i>${e.message}</div>`;
    }
  }

  function highlight(text, q) {
    if (!q) return text;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
    return text.replace(regex, '<mark style="background:var(--accent);color:#fff;border-radius:2px;padding:0 1px">$1</mark>');
  }

  // Also expose open/close globally so inline onclick attrs can call them
  window.openGlobalSearch  = open;
  window.closeGlobalSearch = close;

  // Keyboard shortcut
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      isOpen ? close() : open();
    }
    if (e.key === 'Escape' && isOpen) close();
  });

  // Init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
