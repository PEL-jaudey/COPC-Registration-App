require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase client ──────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service-role key — keep server-side only
);

// ── Admin password ───────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const app  = express();
const PORT = process.env.PORT || 3000;
const MAX_CAPACITY = 75;

const SLOTS = [
  { id: 'slot1', date: 'May 15, 2026',  time: '12:00 PM' },
  { id: 'slot2', date: 'May 30, 2026',  time: '12:00 PM' },
  { id: 'slot3', date: 'June 13, 2026', time: '12:00 PM' },
  { id: 'slot4', date: 'June 27, 2026', time: '12:00 PM' },
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /admin — password-protected admin dashboard ──────────────────────────
app.get('/admin', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).send('ADMIN_PASSWORD environment variable is not set.');
  }
  if (req.query.pw !== ADMIN_PASSWORD) {
    // Show a simple login form
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin Login — Pelotonia</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Barlow',Arial,sans-serif;background:#1e1e1e;min-height:100vh;display:flex;align-items:center;justify-content:center;}
    .card{background:#fff;border-radius:4px;padding:2.5rem 2rem;width:100%;max-width:360px;box-shadow:0 12px 32px rgba(0,0,0,.4);}
    .arrow{color:#44D62C;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:1.5rem;}
    h1{font-family:'Barlow Condensed',Arial,sans-serif;font-weight:800;font-size:1.4rem;letter-spacing:.04em;text-transform:uppercase;margin:.5rem 0 1.5rem;}
    label{display:block;font-size:.78rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#757575;margin-bottom:.4rem;font-family:'Barlow Condensed',Arial,sans-serif;}
    input{width:100%;border:1.5px solid #e0e0e0;border-radius:4px;padding:.65rem .85rem;font-size:.95rem;font-family:'Barlow',Arial,sans-serif;margin-bottom:1.25rem;}
    input:focus{outline:none;border-color:#44D62C;box-shadow:0 0 0 3px rgba(68,214,44,.15);}
    button{width:100%;font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;font-size:1rem;letter-spacing:.08em;text-transform:uppercase;background:#44D62C;color:#000;border:none;border-radius:9999px;padding:.7rem;cursor:pointer;}
    button:hover{background:#35b020;}
    .err{color:#d32f2f;font-size:.85rem;margin-bottom:1rem;}
  </style>
</head>
<body>
  <div class="card">
    <div class="arrow">→</div>
    <h1>Admin Login</h1>
    ${req.query.pw !== undefined ? '<p class="err">Incorrect password. Try again.</p>' : ''}
    <form method="GET" action="/admin">
      <label for="pw">Password</label>
      <input type="password" id="pw" name="pw" placeholder="Enter admin password" autofocus />
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`);
  }
  // Correct password — serve the admin dashboard
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ── GET /api/slots — slot info with live counts ──────────────────────────────
app.get('/api/slots', async (req, res) => {
  try {
    // Count registrations per slot in one query
    const { data, error } = await supabase
      .from('registrations')
      .select('slot_id');

    if (error) throw error;

    const counts = {};
    (data || []).forEach(r => {
      counts[r.slot_id] = (counts[r.slot_id] || 0) + 1;
    });

    const slots = SLOTS.map(slot => {
      const count = counts[slot.id] || 0;
      return {
        ...slot,
        registered: count,
        capacity:   MAX_CAPACITY,
        remaining:  MAX_CAPACITY - count,
        full:       count >= MAX_CAPACITY,
      };
    });

    res.json(slots);
  } catch (err) {
    console.error('GET /api/slots error:', err.message);
    res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

// ── POST /api/register — submit a registration ───────────────────────────────
app.post('/api/register', async (req, res) => {
  const { slotId, fname, lname, email, phone, ecName, ecPhone, questions, waiverAccepted } = req.body;

  // Validate inputs
  if (!slotId || !fname || !lname || !email || !phone || !ecName || !ecPhone) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!waiverAccepted) {
    return res.status(400).json({ error: 'Waiver must be accepted to register.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  const slot = SLOTS.find(s => s.id === slotId);
  if (!slot) {
    return res.status(400).json({ error: 'Invalid session selected.' });
  }

  try {
    // Check current count for capacity enforcement
    const { count: slotCount, error: countErr } = await supabase
      .from('registrations')
      .select('*', { count: 'exact', head: true })
      .eq('slot_id', slotId);

    if (countErr) throw countErr;

    if (slotCount >= MAX_CAPACITY) {
      return res.status(409).json({ error: 'This session is full.' });
    }

    // Check for duplicate email in the same slot
    const { data: existing, error: dupErr } = await supabase
      .from('registrations')
      .select('id')
      .eq('slot_id', slotId)
      .ilike('email', email.trim())
      .maybeSingle();

    if (dupErr) throw dupErr;

    if (existing) {
      return res.status(409).json({ error: 'This email is already registered for that session.' });
    }

    // Insert new registration
    const { data: newReg, error: insertErr } = await supabase
      .from('registrations')
      .insert({
        slot_id:          slotId,
        slot_label:       `${slot.date} at ${slot.time}`,
        fname:            fname.trim(),
        lname:            lname.trim(),
        email:            email.trim().toLowerCase(),
        phone:            phone.trim(),
        ec_name:          ecName.trim(),
        ec_phone:         ecPhone.trim(),
        questions:        (questions || '').trim(),
        waiver_accepted:  true,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    res.status(201).json({ success: true, registration: toPublic(newReg) });
  } catch (err) {
    console.error('POST /api/register error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── GET /api/registrations — admin: all registrations (optional ?slotId=) ───
app.get('/api/registrations', async (req, res) => {
  try {
    let query = supabase
      .from('registrations')
      .select('*')
      .order('registered_at', { ascending: true });

    if (req.query.slotId) {
      query = query.eq('slot_id', req.query.slotId);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json((data || []).map(toPublic));
  } catch (err) {
    console.error('GET /api/registrations error:', err.message);
    res.status(500).json({ error: 'Failed to load registrations.' });
  }
});

// ── DELETE /api/registrations/:id — admin: remove a registration ─────────────
app.delete('/api/registrations/:id', async (req, res) => {
  const id = req.params.id;   // UUID from Supabase
  try {
    const { error } = await supabase
      .from('registrations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/registrations/:id error:', err.message);
    res.status(500).json({ error: 'Failed to remove registration.' });
  }
});

// ── Helper: map snake_case DB columns → camelCase for the frontend ────────────
function toPublic(r) {
  return {
    id:             r.id,
    slotId:         r.slot_id,
    slotLabel:      r.slot_label,
    fname:          r.fname,
    lname:          r.lname,
    email:          r.email,
    phone:          r.phone,
    ecName:         r.ec_name,
    ecPhone:        r.ec_phone,
    questions:      r.questions,
    waiverAccepted: r.waiver_accepted,
    registeredAt:   r.registered_at,
  };
}

app.listen(PORT, () => {
  console.log(`Registration app running at http://localhost:${PORT}`);
});
