/**
 * MeCom AILO Custom Dialogs — pengganti alert / confirm / prompt bawaan browser
 * Ekspor: showAlert(msg), showConfirm(msg, opts), showPrompt(msg, opts)
 */
(function () {
  const style = document.createElement('style');
  style.textContent = `
    #dlg-overlay {
      display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);
      backdrop-filter:blur(6px);z-index:9800;
      align-items:center;justify-content:center;padding:20px;
    }
    #dlg-overlay.open { display:flex }
    #dlg-box {
      background:var(--surface,#1C1C1E);border:0.5px solid var(--border,#2D2D30);
      border-radius:20px;width:100%;max-width:420px;
      box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden;
      animation:dlgIn .18s cubic-bezier(.34,1.2,.64,1);
    }
    @keyframes dlgIn { from{opacity:0;transform:scale(.94) translateY(10px)} to{opacity:1;transform:none} }
    #dlg-header {
      background:#18181B;padding:20px 24px 16px;position:relative;overflow:hidden;
    }
    #dlg-header::before {
      content:'';position:absolute;top:-40px;right:-40px;width:140px;height:140px;
      border-radius:50%;background:var(--accent,#5B4FE8);opacity:.08;
    }
    #dlg-icon {
      width:40px;height:40px;border-radius:12px;margin-bottom:12px;
      display:flex;align-items:center;justify-content:center;position:relative;z-index:1;
    }
    #dlg-icon i { font-size:20px }
    #dlg-title {
      font-size:16px;font-weight:700;color:#FAFAFA;
      margin:0 0 4px;position:relative;z-index:1;
    }
    #dlg-msg {
      font-size:13px;color:#71717A;margin:0;
      position:relative;z-index:1;line-height:1.5;
    }
    #dlg-body { padding:20px 24px 4px }
    #dlg-input-wrap { display:none }
    #dlg-input {
      width:100%;padding:10px 13px;background:var(--surface-2,#27272A);
      border:0.5px solid var(--border,#2D2D30);border-radius:10px;
      font-size:14px;color:var(--text,#FAFAFA);outline:none;box-sizing:border-box;
      transition:border-color .15s;font-family:inherit;
    }
    #dlg-input:focus { border-color:var(--accent,#5B4FE8);box-shadow:0 0 0 3px rgba(91,79,232,.15) }
    #dlg-input-hint { font-size:11px;color:var(--text-3,#52525B);margin-top:6px }
    #dlg-footer { display:flex;gap:8px;padding:16px 24px 20px }
    .dlg-btn {
      flex:1;padding:10px;border-radius:10px;font-size:14px;font-weight:600;
      cursor:pointer;border:0.5px solid var(--border,#2D2D30);transition:opacity .15s,background .15s;
    }
    .dlg-btn-cancel { background:var(--surface-2,#27272A);color:var(--text-2,#A1A1AA) }
    .dlg-btn-cancel:hover { background:var(--border,#3F3F46) }
    .dlg-btn-ok { background:var(--accent,#5B4FE8);color:#fff;border-color:var(--accent,#5B4FE8);flex:2 }
    .dlg-btn-ok:hover { opacity:.88 }
    .dlg-btn-ok.danger { background:#EF4444;border-color:#EF4444 }
    .dlg-btn-ok.warning { background:#F59E0B;border-color:#F59E0B }
    .dlg-btn-ok.success { background:#16A34A;border-color:#16A34A }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'dlg-overlay';
  overlay.innerHTML = `
    <div id="dlg-box" role="dialog" aria-modal="true">
      <div id="dlg-header">
        <div id="dlg-icon"></div>
        <div id="dlg-title"></div>
        <p id="dlg-msg"></p>
      </div>
      <div id="dlg-body">
        <div id="dlg-input-wrap">
          <input id="dlg-input" type="text" autocomplete="off">
          <div id="dlg-input-hint"></div>
        </div>
      </div>
      <div id="dlg-footer">
        <button class="dlg-btn dlg-btn-cancel" id="dlg-cancel">Batal</button>
        <button class="dlg-btn dlg-btn-ok"     id="dlg-ok">Oke</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let _resolve  = null;
  let _canClick = false; // guard click-through dari tombol pemicu

  function _dlgClose(val) {
    overlay.classList.remove('open');
    _canClick = false;
    document.removeEventListener('keydown', _onKey);
    if (_resolve) { _resolve(val); _resolve = null; }
  }

  function _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); _dlgClose(null); }
    if (e.key === 'Enter')  { e.preventDefault(); _submit(); }
  }

  function _submit() {
    const wrap = document.getElementById('dlg-input-wrap');
    if (wrap.style.display === 'block') {
      _dlgClose(document.getElementById('dlg-input').value.trim());
    } else {
      _dlgClose(true);
    }
  }

  document.getElementById('dlg-ok').addEventListener('click', () => { if (_canClick) _submit(); });
  document.getElementById('dlg-cancel').addEventListener('click', () => { if (_canClick) _dlgClose(null); });
  overlay.addEventListener('click', e => { if (_canClick && e.target === overlay) _dlgClose(null); });

  const ICONS = {
    info:    { bg:'rgba(91,79,232,.15)',  color:'#818CF8', icon:'ti-info-circle' },
    success: { bg:'rgba(16,185,129,.15)', color:'#34D399', icon:'ti-circle-check' },
    warning: { bg:'rgba(245,158,11,.15)', color:'#FBBF24', icon:'ti-alert-triangle' },
    danger:  { bg:'rgba(239,68,68,.15)',  color:'#F87171', icon:'ti-alert-circle' },
    prompt:  { bg:'rgba(91,79,232,.15)',  color:'#818CF8', icon:'ti-pencil' },
  };

  function _open({ title, msg, type = 'info', okLabel = 'Oke', cancelLabel = 'Batal', showCancel = true, showInput = false, placeholder = '', hint = '', inputType = 'text', okClass = '' }) {
    const ic = ICONS[type] || ICONS.info;
    document.getElementById('dlg-icon').style.background = ic.bg;
    document.getElementById('dlg-icon').innerHTML = `<i class="ti ${ic.icon}" style="color:${ic.color}"></i>`;
    document.getElementById('dlg-title').textContent = title;
    document.getElementById('dlg-msg').textContent   = msg || '';

    const wrap  = document.getElementById('dlg-input-wrap');
    const input = document.getElementById('dlg-input');
    const hint_ = document.getElementById('dlg-input-hint');
    wrap.style.display = showInput ? 'block' : 'none'; // 'block' bukan '' agar tidak kalah sama CSS
    document.getElementById('dlg-body').style.display = showInput ? 'block' : 'none';
    if (showInput) {
      input.type        = inputType;
      input.placeholder = placeholder;
      input.value       = '';
      hint_.textContent = hint;
    }

    const cancelBtn = document.getElementById('dlg-cancel');
    const okBtn     = document.getElementById('dlg-ok');
    cancelBtn.style.display = showCancel ? '' : 'none';
    cancelBtn.textContent   = cancelLabel;
    okBtn.textContent       = okLabel;
    okBtn.className         = 'dlg-btn dlg-btn-ok' + (okClass ? ' ' + okClass : '') + (type === 'danger' || type === 'warning' || type === 'success' ? ' ' + type : '');

    overlay.classList.add('open');
    document.addEventListener('keydown', _onKey);

    // Delay singkat agar click event dari tombol pemicu tidak tembus ke dialog
    _canClick = false;
    setTimeout(() => {
      _canClick = true;
      if (showInput) input.focus();
    }, 120);

    return new Promise(r => { _resolve = r; });
  }

  window.showAlert = function (msg, { title = 'Informasi', type = 'info' } = {}) {
    return _open({ title, msg, type, showCancel: false, okLabel: 'Tutup' });
  };

  window.showConfirm = function (msg, { title = 'Konfirmasi', okLabel = 'Oke', cancelLabel = 'Batal', type = 'warning' } = {}) {
    return _open({ title, msg, type, okLabel, cancelLabel, showCancel: true });
  };

  window.showPrompt = function (msg, { title = 'Masukkan', placeholder = '', hint = '', inputType = 'text', okLabel = 'Simpan', type = 'prompt' } = {}) {
    return _open({ title, msg, type, showInput: true, placeholder, hint, inputType, okLabel });
  };
})();
