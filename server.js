require('dotenv').config();
// Force IPv4 DNS resolution process-wide — Railway containers cannot route IPv6.
// Must be called before any network activity (including module loads that connect).
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express      = require('express');
const path         = require('path');
const crypto       = require('crypto');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const nodemailer   = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// ── Startup validation — fail loudly rather than silently ─────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ADMIN_PASSWORD', 'COOKIE_SECRET'];
const MISSING_ENV  = REQUIRED_ENV.filter(k => !process.env[k]);
if (MISSING_ENV.length) {
  console.error('FATAL: Missing required environment variables:', MISSING_ENV.join(', '));
  process.exit(1);
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service-role key — server-side only
);

// ── Config ────────────────────────────────────────────────────────────────────
const app            = express();
const PORT           = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE_SECRET  = process.env.COOKIE_SECRET;
const WAIVER_VERSION = '2026-v1';

// ── Email ─────────────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host:    'smtp.gmail.com',
  port:    587,
  secure:  false,   // STARTTLS
  // family:4 passed via NODE_OPTIONS=--dns-result-order=ipv4first in Railway env
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_PASSWORD,  // Gmail App Password (16-char, no spaces)
  },
  tls: { rejectUnauthorized: true },
});

// HTML-escape helper for email template — prevents HTML injection from user input
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendConfirmation({ fname, lname, email, slotDate, slotTime }) {
  if (!process.env.EMAIL_FROM || !process.env.EMAIL_PASSWORD) return;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:4px;overflow:hidden;">
        <tr><td style="background:#1e1e1e;padding:28px 32px;">
          <span style="color:#44D62C;font-size:1.4rem;font-weight:900;">&#8594;</span>
          <span style="color:#ffffff;font-size:1.2rem;font-weight:900;letter-spacing:3px;text-transform:uppercase;margin-left:6px;">PELOTONIA</span>
        </td></tr>
        <tr><td style="background:#44D62C;height:4px;"></td></tr>
        <tr><td style="padding:36px 32px 28px;">
          <h1 style="margin:0 0 8px;font-size:1.5rem;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#1e1e1e;">You're Registered!</h1>
          <p style="margin:0 0 24px;font-size:1rem;color:#757575;">New Rider Clinic — Confirmation</p>
          <p style="margin:0 0 20px;font-size:1rem;color:#3b3b3b;line-height:1.6;">
            Hi ${escHtml(fname)},<br><br>
            Thank you for registering for the <strong>New Rider Clinic</strong> presented for the Pelotonia Community by teamCOPC and Friends. We're excited to have you join us!
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;border-left:4px solid #44D62C;border-radius:0 4px 4px 0;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 6px;font-size:.72rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#757575;">Your Session</p>
              <p style="margin:0 0 4px;font-size:1.2rem;font-weight:900;color:#1e1e1e;">${escHtml(slotDate)}</p>
              <p style="margin:0 0 16px;font-size:1rem;color:#3b3b3b;">${escHtml(slotTime)}</p>
              <p style="margin:0 0 4px;font-size:.72rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#757575;">Location</p>
              <p style="margin:0;font-size:.95rem;color:#3b3b3b;">Rocky Fork Metro Park<br>7180 Walnut St, New Albany, OH 43054</p>
            </td></tr>
          </table>
          <p style="margin:0 0 10px;font-size:.72rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#757575;">What to Expect</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#3b3b3b;font-size:.95rem;line-height:1.8;">
            <li>Learn about safe cycling practices &amp; laws</li>
            <li>Ride together on a supported group ride</li>
            <li>Build comfort and confidence before the big ride</li>
          </ul>
          <p style="margin:0;font-size:.9rem;color:#757575;line-height:1.6;font-style:italic;">
            Your address and contact information will be shared only with Columbus Outdoor Pursuits for the purpose of providing insurance coverage.
          </p>
        </td></tr>
        <tr><td style="background:#1e1e1e;padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:.78rem;color:rgba(255,255,255,.4);letter-spacing:1px;text-transform:uppercase;">
            &copy; 2026 <span style="color:#44D62C;">Pelotonia</span> &mdash; Ending Cancer, One Ride at a Time
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await mailer.sendMail({
    from:    `"New Rider Clinic" <${process.env.EMAIL_FROM}>`,
    to:      email,
    subject: 'Thank you for registering for the New Rider Clinic!',
    html,
  });
}

// ── Slots ─────────────────────────────────────────────────────────────────────
const SLOTS = [
  { id: 'slot1', date: 'May 16, 2026',  time: '12:00 PM', capacity: 50  },
  { id: 'slot2', date: 'May 30, 2026',  time: '12:00 PM', capacity: 100 },
  { id: 'slot3', date: 'June 13, 2026', time: '12:00 PM', capacity: 100 },
  { id: 'slot4', date: 'June 27, 2026', time: '12:00 PM', capacity: 100 },
];

// ── Field length limits ───────────────────────────────────────────────────────
const FIELD_LIMITS = {
  fname:     100,
  lname:     100,
  email:     254,
  phone:      30,
  address:   255,
  ecName:    100,
  ecPhone:    30,
  questions: 2000,
};

// ── Session store (H1 fix — revocable sessions) ───────────────────────────────
// In-memory Map: token -> expiry timestamp. Tokens are random, invalidated on logout.
const adminSessions = new Map();

function createAdminSession() {
  const token  = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
  adminSessions.set(token, expiry);
  return token;
}

function isValidAdminSession(token) {
  if (!token || !adminSessions.has(token)) return false;
  const expiry = adminSessions.get(token);
  if (Date.now() > expiry) { adminSessions.delete(token); return false; }
  return true;
}

function deleteAdminSession(token) {
  if (token) adminSessions.delete(token);
}

// Purge expired sessions periodically to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of adminSessions) {
    if (now > expiry) adminSessions.delete(token);
  }
}, 60 * 60 * 1000); // every hour

function isAdminAuthenticated(req) {
  const token = req.cookies && req.cookies.adminToken;
  return isValidAdminSession(token);
}

// Middleware: protect API routes
function requireAdmin(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  return res.status(401).json({ error: 'Unauthorized.' });
}

// ── App setup ─────────────────────────────────────────────────────────────────
// Trust Railway's single reverse proxy hop — adjust if deploying behind a CDN
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],                // no unsafe-inline — scripts are external files
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:         ["'self'", 'data:'],
      connectSrc:     ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => res.redirect('/admin?error=locked'),
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

app.use('/api/', apiLimiter);

// ── Admin routes ──────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  // No caching — admin page contains sensitive structure
  res.set('Cache-Control', 'no-store, no-cache, private');
  if (isAdminAuthenticated(req)) {
    return res.sendFile(path.join(__dirname, 'views', 'admin.html'));
  }
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/admin', adminLoginLimiter, (req, res) => {
  const submitted = (req.body.pw || '').trim();
  if (submitted === ADMIN_PASSWORD) {
    const token = createAdminSession();
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV !== 'development',
      sameSite: 'strict',
      maxAge:   8 * 60 * 60 * 1000,
      path:     '/',
    });
    return res.redirect('/admin');
  }
  res.redirect('/admin?error=1');
});

app.post('/admin/logout', (req, res) => {
  // Invalidate the session server-side — token is now useless even if captured
  deleteAdminSession(req.cookies && req.cookies.adminToken);
  res.clearCookie('adminToken', { path: '/' });
  res.redirect('/admin');
});

// ── GET /api/slots ────────────────────────────────────────────────────────────
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
        remaining:  slot.capacity - count,
        full:       count >= slot.capacity,
      };
    });

    res.json(slots);
  } catch (err) {
    console.error('GET /api/slots error:', err.message);
    res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

// ── POST /api/register ────────────────────────────────────────────────────────
app.post('/api/register', registerLimiter, async (req, res) => {
  const { slotId, fname, lname, email, phone, address, ecName, ecPhone, questions, waiverAccepted } = req.body;

  // Required fields
  if (!slotId || !fname || !lname || !email || !phone || !address || !ecName || !ecPhone) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!waiverAccepted) {
    return res.status(400).json({ error: 'Waiver must be accepted to register.' });
  }

  // Length validation
  const fieldValues = { fname, lname, email, phone, address, ecName, ecPhone, questions: questions || '' };
  for (const [field, maxLen] of Object.entries(FIELD_LIMITS)) {
    if ((fieldValues[field] || '').length > maxLen) {
      return res.status(400).json({ error: `${field} is too long (max ${maxLen} characters).` });
    }
  }

  // Format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const phonePattern = /^[\d\s()\-+.]+$/;
  // Minimum 7 digits required for a valid phone number
  if (!phonePattern.test(phone) || phone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  if (!phonePattern.test(ecPhone) || ecPhone.replace(/\D/g, '').length < 7) {
    return res.status(400).json({ error: 'Please enter a valid emergency contact phone number.' });
  }

  const slot = SLOTS.find(s => s.id === slotId);
  if (!slot) {
    return res.status(400).json({ error: 'Invalid session selected.' });
  }

  try {
    // Capacity check (also enforced at DB level via trigger)
    const { count: slotCount, error: countErr } = await supabase
      .from('registrations')
      .select('*', { count: 'exact', head: true })
      .eq('slot_id', slotId);

    if (countErr) throw countErr;
    if (slotCount >= slot.capacity) {
      return res.status(409).json({ error: 'This session is full.' });
    }

    // Duplicate email check
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

    // Insert
    const { data: newReg, error: insertErr } = await supabase
      .from('registrations')
      .insert({
        slot_id:            slotId,
        slot_label:         `${slot.date} at ${slot.time}`,
        fname:              fname.trim(),
        lname:              lname.trim(),
        email:              email.trim().toLowerCase(),
        phone:              phone.trim(),
        address:            address.trim(),
        ec_name:            ecName.trim(),
        ec_phone:           ecPhone.trim(),
        questions:          (questions || '').trim(),
        waiver_accepted:    true,
        waiver_accepted_at: new Date().toISOString(),
        waiver_version:     WAIVER_VERSION,
      })
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === 'P0001') {
        return res.status(409).json({ error: 'This session is full.' });
      }
      throw insertErr;
    }

    // Respond immediately, then send email asynchronously
    res.status(201).json({ success: true, registration: toPublic(newReg) });

    sendConfirmation({
      fname:    fname.trim(),
      lname:    lname.trim(),
      email:    email.trim().toLowerCase(),
      slotDate: slot.date,
      slotTime: slot.time,
    }).catch(err => console.error('Confirmation email failed:', err.message));

  } catch (err) {
    console.error('POST /api/register error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── GET /api/registrations — admin only ──────────────────────────────────────
app.get('/api/registrations', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, private');
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
    address:          r.address,
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
