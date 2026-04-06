  // ── State ──
  let slots = [];
  let selectedSlot = null;
  let pendingPayload = null;

  // ── API helpers ──
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ── Escape helper ──
  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Slots ──
  async function loadSlots() {
    try {
      slots = await api('GET', '/api/slots');
      renderSlots();
    } catch(e) {
      document.getElementById('slotsGrid').innerHTML =
        '<div class="empty-state" style="grid-column:1/-1;color:var(--danger)">Failed to load sessions. Is the server running?</div>';
    }
  }

  function renderSlots() {
    const grid = document.getElementById('slotsGrid');
    grid.innerHTML = '';
    slots.forEach(slot => {
      const card = document.createElement('div');
      card.className = 'slot-card' + (slot.full ? ' full' : '') + (selectedSlot === slot.id ? ' selected' : '');
      card.dataset.slotId = slot.id;
      card.innerHTML = `
        <div class="slot-arrow">&#8594;</div>
        <div class="slot-date">${esc(slot.date)}</div>
        <div class="slot-time">${esc(slot.time)}</div>
        <div class="slot-badge">${slot.full ? 'Full' : `${esc(String(slot.remaining))} spot${slot.remaining !== 1 ? 's' : ''} left`}</div>
        <div class="slot-capacity">${esc(String(slot.registered))} / ${esc(String(slot.capacity))} registered</div>
      `;
      if (!slot.full) card.addEventListener('click', () => selectSlot(slot.id));
      grid.appendChild(card);
    });
  }

  function selectSlot(slotId) {
    selectedSlot = slotId;
    const slot = slots.find(s => s.id === slotId);
    const note = document.getElementById('slotSelectNote');
    note.textContent = '';
    const arrow = document.createTextNode('\u2192 Selected: ');
    const strong = document.createElement('strong');
    strong.textContent = slot.date + ' at ' + slot.time;
    note.appendChild(arrow);
    note.appendChild(strong);
    document.getElementById('submitBtn').disabled = false;
    renderSlots();
    document.getElementById('submitBtn').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Form submit → open waiver ──
  document.getElementById('regForm').addEventListener('submit', function(e) {
    e.preventDefault();
    if (!selectedSlot) { showToast('Please select a session first.', 'error'); return; }

    const fname     = document.getElementById('fname').value.trim();
    const lname     = document.getElementById('lname').value.trim();
    const email     = document.getElementById('email').value.trim();
    const phone     = document.getElementById('phone').value.trim();
    const address   = document.getElementById('address').value.trim();
    const ecName    = document.getElementById('ecName').value.trim();
    const ecPhone   = document.getElementById('ecPhone').value.trim();
    const questions = document.getElementById('questions').value.trim();

    if (!fname || !lname) { showToast('Please enter your full name.', 'error'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Please enter a valid email address.', 'error'); return;
    }
    if (!phone)   { showToast('Please enter your phone number.', 'error'); return; }
    if (!address) { showToast('Please enter your home address.', 'error'); return; }
    if (!ecName)  { showToast('Please enter an emergency contact name.', 'error'); return; }
    if (!ecPhone) { showToast('Please enter an emergency contact phone number.', 'error'); return; }

    pendingPayload = { slotId: selectedSlot, fname, lname, email, phone, address, ecName, ecPhone, questions };
    openWaiver();
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    document.getElementById('regForm').reset();
    selectedSlot = null;
    pendingPayload = null;
    document.getElementById('slotSelectNote').textContent = '\u2190 Select a session above to continue.';
    document.getElementById('submitBtn').disabled = true;
    renderSlots();
  });

  // ── Waiver modal ──
  function openWaiver() {
    document.getElementById('waiverCheck').checked = false;
    document.getElementById('waiverSubmit').disabled = true;
    document.getElementById('waiverBody').scrollTop = 0;
    document.getElementById('waiverModal').classList.add('open');
  }

  function closeWaiver() {
    document.getElementById('waiverModal').classList.remove('open');
  }

  document.getElementById('waiverCheck').addEventListener('change', function() {
    document.getElementById('waiverSubmit').disabled = !this.checked;
  });

  document.getElementById('waiverCancel').addEventListener('click', closeWaiver);

  document.getElementById('waiverModal').addEventListener('click', function(e) {
    if (e.target === this) closeWaiver();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeWaiver();
  });

  document.getElementById('waiverSubmit').addEventListener('click', async () => {
    if (!pendingPayload) return;
    const btn = document.getElementById('waiverSubmit');
    btn.disabled = true;
    btn.textContent = 'Registering\u2026';

    try {
      await api('POST', '/api/register', Object.assign({}, pendingPayload, { waiverAccepted: true }));
      closeWaiver();
      const slot = slots.find(s => s.id === pendingPayload.slotId);
      showToast('Registered for ' + slot.date + '!', 'success');
      document.getElementById('regForm').reset();
      selectedSlot = null;
      pendingPayload = null;
      document.getElementById('slotSelectNote').textContent = '\u2190 Select a session above to continue.';
      document.getElementById('submitBtn').disabled = true;
      await loadSlots();
    } catch(err) {
      closeWaiver();
      showToast(err.message, 'error');
    } finally {
      btn.textContent = 'I Agree & Register';
    }
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
  loadSlots();
