/**
 * KeAloha Volleyball — tryout lead capture
 * Express + Postgres + Google Apps Script webhook (Sheet + email) + Meta Pixel/CAPI
 *
 * Required env vars (set these in Railway → Variables):
 *   DATABASE_URL          provided automatically when you add a Postgres plugin
 *   REGISTRATION_URL      the single SportsEngine registration link
 *   LEAD_WEBHOOK_URL      Google Apps Script web-app URL (logs to Sheet + emails parent)
 *   LEAD_WEBHOOK_SECRET   shared secret that must match SHARED_SECRET in the Apps Script
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
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
  DATABASE_URL,
  LEAD_WEBHOOK_URL = '',
  LEAD_WEBHOOK_SECRET = '',
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

/* --------------- Lead webhook (Google Apps Script: Sheet + email) --------------- */
// Posts the lead to a Google Apps Script web app over HTTPS. The script logs it
// to a Google Sheet and emails the parent a confirmation from the club's Gmail.
// (HTTPS sidesteps Railway's outbound-SMTP block.)
async function postToWebhook(lead) {
  if (!LEAD_WEBHOOK_URL) {
    console.warn('[webhook] skipped — LEAD_WEBHOOK_URL not set');
    return;
  }
  try {
    const r = await fetch(LEAD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: LEAD_WEBHOOK_SECRET,
        parentName: lead.parentName,
        email: lead.email,
        phone: lead.phone,
        ageGroups: lead.ageGroups,
        registrationUrl: REGISTRATION_URL,
      }),
    });
    if (!r.ok) console.warn('[webhook] non-200:', r.status);
    else console.log('[webhook] lead sent to sheet + email for', lead.email);
  } catch (err) {
    console.error('[webhook] failed:', err.message);
  }
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

    // fire-and-forget: don't block the redirect on webhook / capi
    postToWebhook({ parentName, email, phone, ageGroups: ageStr });
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
