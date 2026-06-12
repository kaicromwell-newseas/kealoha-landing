/**
 * KeAloha Volleyball — tryout lead capture
 * Express + Postgres + Gmail SMTP (Nodemailer) + Meta Pixel/CAPI
 *
 * Required env vars (set these in Railway → Variables):
 *   DATABASE_URL          provided automatically when you add a Postgres plugin
 *   GMAIL_USER            kealohavolleyball@gmail.com
 *   GMAIL_APP_PASSWORD    16-char Google App Password (NOT the normal password)
 *   REGISTRATION_URL      the single SportsEngine registration link
 * Optional:
 *   META_PIXEL_ID         e.g. 1234567890  (enables the browser pixel)
 *   META_CAPI_TOKEN       Conversions API access token (enables server-side tracking)
 *   ADMIN_TOKEN           secret string to protect the CSV export endpoint
 *   PGSSL                 set to "require" if your DB needs SSL (Railway internal does NOT)
 *   PORT                  provided automatically by Railway
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
  DATABASE_URL,
  GMAIL_USER,
  GMAIL_APP_PASSWORD,
  REGISTRATION_URL = '',
  META_PIXEL_ID = '',
  META_CAPI_TOKEN = '',
  ADMIN_TOKEN = '',
  PGSSL = '',
  PORT = 3000,
} = process.env;

/* ----------------------------- Postgres ----------------------------- */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: PGSSL === 'require' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id          SERIAL PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      parent_name TEXT NOT NULL,
      email       TEXT NOT NULL,
      phone       TEXT NOT NULL,
      age_groups  TEXT,
      ip          TEXT,
      user_agent  TEXT
    );
  `);
  console.log('[db] leads table ready');
}

/* ----------------------------- Email -------------------------------- */
let transporter = null;
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

function confirmationEmail(parentName) {
  const first = (parentName || '').trim().split(/\s+/)[0] || 'there';
  const text =
`Hi ${first},

Thanks for your interest in KeAloha Volleyball tryouts! You're one step away.

Complete your registration here:
${REGISTRATION_URL}

Tryouts are held at the Chesterton and Valparaiso Boys & Girls Clubs in June and July 2026. If you have any questions, just reply to this email.

See you on the court,
KeAloha Volleyball`;

  const html =
`<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0b2545;line-height:1.5">
  <h2 style="color:#0b2545">Thanks for your interest, ${first}! 🏐</h2>
  <p>You're one step away from KeAloha Volleyball tryouts. Tap below to complete your registration:</p>
  <p style="text-align:center;margin:26px 0">
    <a href="${REGISTRATION_URL}" style="background:#ff5a4d;color:#fff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:50px;display:inline-block">Complete Registration →</a>
  </p>
  <p style="font-size:13px;color:#5b6b82">Tryouts are held at the Chesterton &amp; Valparaiso Boys &amp; Girls Clubs, June–July 2026. Questions? Just reply to this email.</p>
  <p style="font-size:13px;color:#5b6b82">See you on the court,<br>KeAloha Volleyball</p>
</div>`;

  return {
    from: `KeAloha Volleyball <${GMAIL_USER}>`,
    subject: 'Complete your KeAloha Volleyball tryout registration',
    text,
    html,
  };
}

async function sendConfirmation(to, parentName) {
  if (!transporter) {
    console.warn('[email] skipped — GMAIL_USER / GMAIL_APP_PASSWORD not set');
    return;
  }
  const msg = confirmationEmail(parentName);
  await transporter.sendMail({ ...msg, to });
  console.log('[email] confirmation sent to', to);
}

/* ------------------------- Meta Conversions API ---------------------- */
const sha256 = (v) =>
  crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

async function sendCapiLead(req, { email, phone }) {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) return; // optional
  try {
    const body = {
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: `https://${req.headers.host}/`,
          user_data: {
            em: [sha256(email)],
            ph: [sha256(phone.replace(/\D/g, ''))],
            client_user_agent: req.headers['user-agent'] || '',
            client_ip_address: (req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
          },
        },
      ],
    };
    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.warn('[capi] non-200:', r.status, await r.text());
    else console.log('[capi] Lead event sent');
  } catch (err) {
    console.warn('[capi] error (non-fatal):', err.message);
  }
}

/* ------------------------- Serve the page --------------------------- */
const PUBLIC_DIR = path.join(__dirname, 'public');
const rawHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

function renderPage() {
  return rawHtml
    .split('__META_PIXEL_ID__').join(META_PIXEL_ID)
    .split('__REGISTRATION_URL__').join(REGISTRATION_URL || '#');
}

app.get('/', (_req, res) => res.type('html').send(renderPage()));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* serve any other static assets (favicon, images) but NOT index.html raw */
app.use(express.static(PUBLIC_DIR, { index: false }));

/* ------------------------- Lead endpoint ---------------------------- */
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const phoneDigits = (v) => String(v || '').replace(/\D/g, '');

app.post('/api/lead', async (req, res) => {
  try {
    const parentName = (req.body.parentName || '').trim();
    const email = (req.body.email || '').trim();
    const phone = (req.body.phone || '').trim();
    let ageGroups = req.body.ageGroups || [];
    if (typeof ageGroups === 'string') ageGroups = [ageGroups];
    const ageStr = Array.isArray(ageGroups) ? ageGroups.join(', ') : '';

    // server-side validation (mirrors the client)
    if (!parentName) return res.status(400).json({ ok: false, error: 'Name required' });
    if (!isEmail(email)) return res.status(400).json({ ok: false, error: 'Valid email required' });
    const d = phoneDigits(phone);
    if (d.length < 10 || d.length > 11)
      return res.status(400).json({ ok: false, error: 'Valid phone required' });

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const ua = req.headers['user-agent'] || '';

    await pool.query(
      `INSERT INTO leads (parent_name, email, phone, age_groups, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [parentName, email, phone, ageStr, ip, ua]
    );

    // fire-and-forget: don't block the redirect on email / capi
    sendConfirmation(email, parentName).catch((e) => console.error('[email] failed:', e.message));
    sendCapiLead(req, { email, phone });

    res.json({ ok: true, redirect: REGISTRATION_URL || '/' });
  } catch (err) {
    console.error('[lead] error:', err);
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

/* ------------------- CSV export (for SportsEngine import) ------------ */
app.get('/api/leads.csv', async (req, res) => {
  if (!ADMIN_TOKEN || req.query.token !== ADMIN_TOKEN) return res.status(403).send('Forbidden');
  const { rows } = await pool.query('SELECT * FROM leads ORDER BY created_at DESC');
  const headers = ['created_at', 'parent_name', 'email', 'phone', 'age_groups'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(',')),
  ].join('\n');
  res.type('text/csv').attachment('kealoha-leads.csv').send(csv);
});

/* ------------------------------ Boot -------------------------------- */
initDb()
  .then(() => app.listen(PORT, () => console.log(`[server] listening on ${PORT}`)))
  .catch((err) => {
    console.error('[boot] failed to init DB:', err);
    process.exit(1);
  });
