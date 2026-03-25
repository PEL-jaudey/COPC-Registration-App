require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase client ──────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service-role key — keep server-side only
);

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
  const { slotId, fname, lname, email, questions, waiverAccepted } = req.body;

  // Validate inputs
  if (!slotId || !fname || !lname || !email) {
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
        slot_id:        slotId,
        slot_label:     `${slot.date} at ${slot.time}`,
        fname:          fname.trim(),
        lname:          lname.trim(),
        email:          email.trim().toLowerCase(),
        questions:      (questions || '').trim(),
        waiver_accepted: true,
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
    questions:      r.questions,
    waiverAccepted: r.waiver_accepted,
    registeredAt:   r.registered_at,
  };
}

app.listen(PORT, () => {
  console.log(`Registration app running at http://localhost:${PORT}`);
});
