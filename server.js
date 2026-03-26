require('dotenv').config();
const express      = require('express');
const path         = require('path');
const crypto       = require('crypto');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service-role key — server-side only
);

// ── Config ────────────────────────────────────────────────────────────────────
const app            = express();
const PORT           = process.env.PORT || 3000;
const MAX_CAPACITY   = 75;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE_SECRET  = process.env.COOKIE_SECRET;
const WAIVER_VERSION = '2026-v1';

const SLOTS = [
  { id: 'slot1', date: 'May 15, 2026',  time: '12:00 PM' },
  { id: 'slot2', date: 'May 30, 2026',  time: '12:00 PM' },
  { id: 'slot3', date: 'June 13, 2026', time: '12:00 PM' },
  { id: 'slot4', date: 'June 27, 2026', time: '12:00 PM' },
];

// Field length limits
const FIELD_LIMITS = {
  fname:     100,
  lname:     100,
  email:     254,
  phone:      30,
  ecName:    100,
  ecPhone:    30,
  questions: 2000,
};

// ── Auth helpers ──────────────────────────────────────────────────────────────
// Produces a stable HMAC token from the cookie secret — stateless, no DB needed
function makeAdminToken() {
  return crypto
    .createHmac('sha256', COOKIE_SECRET)
    .update('pelotonia-admin-v1')
    .digest('hex');
}

function isAdminAuthenticated(req) {
  const token = req.cookies && req.cookies.adminToken;
  return !!(COOKIE_SECRET && token && token === makeAdminToken());
}

// Middleware: protect API routes — returns 401 JSON if not authenticated
function requireAdmin(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  return res.status(401).json({ error: 'Unauthorized.' });
}

// ── Security middleware ───────────────────────────────────────────────────────
// Trust Railway's reverse proxy so rate limiting uses real client IPs
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // allow Google Fonts to load
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Strict limit on registration submissions to prevent slot flooding
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,
  message: { error: 'Too many registration attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// Strict limit on admin login to prevent brute-force
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => res.redirect('/admin?error=locked'),
});

// General API backstop
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

app.use('/api/', apiLimiter);

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /admin — serve dashboard if authenticated, otherwise serve login page
app.get('/admin', (req, res) => {
  if (isAdminAuthenticated(req)) {
    return res.sendFile(path.join(__dirname, 'views', 'admin.html'));
  }
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// POST /admin — process login form (password in POST body, never in URL)
app.post('/admin', adminLoginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD || !COOKIE_SECRET) {
    return res.status(500).send('Server misconfiguration: ADMIN_PASSWORD and COOKIE_SECRET must be set.');
  }
  const submitted = (req.body.pw || '').trim();
  if (submitted === ADMIN_PASSWORD) {
    res.cookie('adminToken', makeAdminToken(), {
      httpOnly: true,                                  // not accessible from JS
      secure:   process.env.NODE_ENV !== 'development', // HTTPS only in production
      sameSite: 'strict',                              // CSRF protection
      maxAge:   8 * 60 * 60 * 1000,                  // 8-hour session
      path:     '/',
    });
    return res.redirect('/admin');
  }
  res.redirect('/admin?error=1');
});

// POST /admin/logout — clear the session cookie
app.post('/admin/logout', (req, res) => {
  res.clearCookie('adminToken', { path: '/' });
  res.redirect('/admin');
});

// ── GET /api/slots — slot info with live counts ───────────────────────────────
app.get('/api/slots', async (req, res) => {
  try {
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

// ── POST /api/register — submit a registration ────────────────────────────────
app.post('/api/register', registerLimiter, async (req, res) => {
  const { slotId, fname, lname, email, phone, ecName, ecPhone, questions, waiverAccepted } = req.body;

  // ── Required field checks ──
  if (!slotId || !fname || !lname || !email || !phone || !ecName || !ecPhone) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!waiverAccepted) {
    return res.status(400).json({ error: 'Waiver must be accepted to register.' });
  }

  // ── Length validation ──
  const fieldValues = { fname, lname, email, phone, ecName, ecPhone, questions: questions || '' };
  for (const [field, maxLen] of Object.entries(FIELD_LIMITS)) {
    if ((fieldValues[field] || '').length > maxLen) {
      return res.status(400).json({ error: `${field} is too long (max ${maxLen} characters).` });
    }
  }

  // ── Format validation ──
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  const phonePattern = /^[\d\s()\-+.]+$/;
  if (!phonePattern.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number format.' });
  }
  if (!phonePattern.test(ecPhone)) {
    return res.status(400).json({ error: 'Invalid emergency contact phone format.' });
  }

  // ── Valid slot check ──
  const slot = SLOTS.find(s => s.id === slotId);
  if (!slot) {
    return res.status(400).json({ error: 'Invalid session selected.' });
  }

  try {
    // ── Capacity check (also enforced at DB level via trigger) ──
    const { count: slotCount, error: countErr } = await supabase
      .from('registrations')
      .select('*', { count: 'exact', head: true })
      .eq('slot_id', slotId);

    if (countErr) throw countErr;

    if (slotCount >= MAX_CAPACITY) {
      return res.status(409).json({ error: 'This session is full.' });
    }

    // ── Duplicate email check ──
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

    // ── Insert ──
    const { data: newReg, error: insertErr } = await supabase
      .from('registrations')
      .insert({
        slot_id:           slotId,
        slot_label:        `${slot.date} at ${slot.time}`,
        fname:             fname.trim(),
        lname:             lname.trim(),
        email:             email.trim().toLowerCase(),
        phone:             phone.trim(),
        ec_name:           ecName.trim(),
        ec_phone:          ecPhone.trim(),
        questions:         (questions || '').trim(),
        waiver_accepted:   true,
        waiver_accepted_at: new Date().toISOString(),
        waiver_version:    WAIVER_VERSION,
      })
      .select()
      .single();

    if (insertErr) {
      // DB-level capacity trigger raises P0001
      if (insertErr.code === 'P0001') {
        return res.status(409).json({ error: 'This session is full.' });
      }
      throw insertErr;
    }

    res.status(201).json({ success: true, registration: toPublic(newReg) });
  } catch (err) {
    console.error('POST /api/register error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── GET /api/registrations — admin only ───────────────────────────────────────
app.get('/api/registrations', requireAdmin, async (req, res) => {
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

// ── DELETE /api/registrations/:id — admin only ────────────────────────────────
app.delete('/api/registrations/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  // Basic UUID format check to reject obviously malformed IDs
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid registration ID.' });
  }
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

// ── Helper ────────────────────────────────────────────────────────────────────
function toPublic(r) {
  return {
    id:               r.id,
    slotId:           r.slot_id,
    slotLabel:        r.slot_label,
    fname:            r.fname,
    lname:            r.lname,
    email:            r.email,
    phone:            r.phone,
    ecName:           r.ec_name,
    ecPhone:          r.ec_phone,
    questions:        r.questions,
    waiverAccepted:   r.waiver_accepted,
    waiverAcceptedAt: r.waiver_accepted_at,
    waiverVersion:    r.waiver_version,
    registeredAt:     r.registered_at,
  };
}

app.listen(PORT, () => {
  console.log(`Registration app running at http://localhost:${PORT}`);
});
