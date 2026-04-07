  let slots    = [];
  let allRegs  = [];
  let activeFilter = 'all';

  // ── Escape helper (XSS defence for innerHTML) ──
  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── CSV formula-injection defence ──
  function csvSafe(v) {
    const s = String(v == null ? '' : v);
    // Strip leading chars that spreadsheet apps treat as formula starters
    return s.replace(/^[=+\-@\t\r]+/, '');
  }

  // ── API helper ──
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ── Load everything ──
  async function loadAll() {
    try {
      [slots, allRegs] = await Promise.all([
        api('GET', '/api/slots'),
        api('GET', '/api/registrations'),
      ]);
      renderSummary();
      renderFilters();
      renderTable();
    } catch(e) {
      // Use a static message — never interpolate e.message from a network response
      document.getElementById('summaryGrid').innerHTML =
        '<div style="color:var(--danger);padding:1rem">Failed to load data. Please refresh the page.</div>';
    }
  }

  // ── Summary cards ──
  function renderSummary() {
    const total = allRegs.length;
    const grid  = document.getElementById('summaryGrid');
    const totalCapacity = slots.reduce((sum, s) => sum + s.capacity, 0);

    const cards = [
      { label: 'Total Registered', count: total, sub: `of ${totalCapacity} total spots`, cls: 'total' },
      ...slots.map(s => {
        const count = allRegs.filter(r => r.slotId === s.id).length;
        return { label: s.date, count, sub: `${s.capacity - count} spots remaining` };
      }),
    ];

    // M2 fix: escape all dynamic values written into innerHTML
    grid.innerHTML = cards.map(c => `
      <div class="summary-card ${esc(c.cls || '')}">
        <div class="card-label">${esc(c.label)}</div>
        <div class="card-count">${esc(String(c.count))}</div>
        <div class="card-sub">${esc(c.sub)}</div>
      </div>
    `).join('');
  }

  // ── Filter buttons ──
  function renderFilters() {
    const container = document.getElementById('adminFilters');
    const options = [
      { id: 'all', label: 'All Sessions' },
      ...slots.map(s => ({ id: s.id, label: s.date })),
    ];
    container.innerHTML = '';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn' + (activeFilter === opt.id ? ' active' : '');
      btn.textContent = opt.label;
      btn.dataset.filterId = opt.id;
      container.appendChild(btn);
    });
    // Attach listeners via event delegation — no inline JS
    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-filter-id]');
      if (btn) { activeFilter = btn.dataset.filterId; renderFilters(); renderTable(); }
    }, { once: true });
  }

  // ── Registration table ──
  function renderTable() {
    const tbody = document.getElementById('regTableBody');
    const regs  = activeFilter === 'all'
      ? allRegs
      : allRegs.filter(r => r.slotId === activeFilter);

    if (regs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No registrations yet.</td></tr>';
      return;
    }

    tbody.innerHTML = regs.map((r, i) => `
      <tr>
        <td>${esc(String(i + 1))}</td>
        <td>${esc(r.fname)} ${esc(r.lname)}</td>
        <td>${esc(r.email)}</td>
        <td style="white-space:nowrap">${esc(r.phone || '—')}</td>
        <td>${esc(r.address || '—')}</td>
        <td>${esc(r.ecName || '—')}</td>
        <td style="white-space:nowrap">${esc(r.ecPhone || '—')}</td>
        <td>${esc(r.slotLabel)}</td>
        <td>${r.questions ? esc(r.questions) : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="white-space:nowrap">${esc(new Date(r.registeredAt).toLocaleString())}</td>
        <td><button class="btn btn-danger btn-sm" data-delete-id="${esc(String(r.id))}">Remove</button></td>
      </tr>
    `).join('');
  }

  // ── Delete via event delegation (no inline onclick) ──
  document.getElementById('regTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-delete-id]');
    if (!btn) return;
    if (!confirm('Remove this registration? This cannot be undone.')) return;
    try {
      await api('DELETE', `/api/registrations/${btn.dataset.deleteId}`);
      showToast('Registration removed.', 'success');
      await loadAll();
    } catch(err) {
      showToast('Failed to remove registration.', 'error');
    }
  });

  // ── Remove All ──
  document.getElementById('removeAllBtn').addEventListener('click', async () => {
    const regs = activeFilter === 'all'
      ? allRegs
      : allRegs.filter(r => r.slotId === activeFilter);
    if (regs.length === 0) { showToast('No registrations to remove.', 'error'); return; }
    const label = activeFilter === 'all' ? 'all' : 'this session\'s';
    if (!confirm(`Remove ${label} ${regs.length} registration${regs.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await api('DELETE', '/api/registrations', { ids: regs.map(r => r.id) });
      showToast(`${regs.length} registration${regs.length !== 1 ? 's' : ''} removed.`, 'success');
      await loadAll();
    } catch(err) {
      showToast('Failed to remove registrations.', 'error');
    }
  });

  // ── CSV Export ──
  document.getElementById('exportBtn').addEventListener('click', () => {
    const regs = activeFilter === 'all'
      ? allRegs
      : allRegs.filter(r => r.slotId === activeFilter);

    if (regs.length === 0) { showToast('No registrations to export.', 'error'); return; }

    const header = ['First Name','Last Name','Email','Phone','Address','Emergency Contact','EC Phone','Session','Additional Comments','Waiver Accepted','Registered At'];
    // L5 fix: csvSafe() strips formula-injection chars; double-quotes escape CSV quotes
    const rows = regs.map(r => [
      r.fname, r.lname, r.email,
      r.phone || '',
      r.address || '',
      r.ecName || '',
      r.ecPhone || '',
      r.slotLabel,
      r.questions || '',
      r.waiverAccepted ? 'Yes' : 'No',
      new Date(r.registeredAt).toLocaleString(),
    ].map(v => `"${csvSafe(String(v)).replace(/"/g,'""')}"`).join(','));

    const csv = [header.join(','), ...rows].join('\r\n');
    const a   = document.createElement('a');
    a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `registrations-${activeFilter}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    showToast('CSV downloaded.', 'success');
  });

  // ── Toast ──
  let toastTimer;
  function showToast(msg, type) {
    type = type || '';
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ''; }, 3500);
  }

  // ── Init ──
  loadAll();
