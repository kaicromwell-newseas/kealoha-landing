# KeAloha Volleyball — Tryout Landing Page

A one-page lead-capture site for girls volleyball tryouts. A parent fills out the
form → the lead is saved to Postgres → they get a confirmation email with the
SportsEngine registration link → they're redirected to that same registration
page. A Meta "Lead" event fires for ad optimization.

**Stack:** Node/Express + Postgres + Gmail SMTP (Nodemailer) + Meta Pixel/CAPI.
Built to deploy on Railway.

---

## Before you deploy — gather 3 things

### 1. Gmail App Password (so the site can email from your address)
The site sends from `kealohavolleyball@gmail.com` using Gmail's SMTP. You need an
**App Password** (a normal Gmail password won't work):

1. The Gmail account must have **2-Step Verification ON**
   (Google Account → Security → 2-Step Verification).
2. Go to **https://myaccount.google.com/apppasswords**.
3. Create a password named e.g. "KeAloha Landing". Google gives you a 16-character
   code — copy it. That's your `GMAIL_APP_PASSWORD`.

> Free Gmail can send to ~500 recipients/day. Plenty for tryout confirmations.

### 2. Meta Pixel (optional but recommended)
1. In **Meta Events Manager**, create/select a Pixel and copy its **Pixel ID** →
   `META_PIXEL_ID`.
2. For server-side tracking (more accurate), generate a **Conversions API access
   token** under the pixel's Settings → `META_CAPI_TOKEN`.
   You can skip CAPI and just use the browser pixel to start.

### 3. SportsEngine registration URL
The single registration link parents should land on → `REGISTRATION_URL`.

---

## Deploy to Railway

1. **Push this folder to a GitHub repo** (or use `railway up` from the Railway CLI).
2. In Railway: **New Project → Deploy from GitHub repo** (pick this repo).
3. **Add a database:** in the project, **New → Database → PostgreSQL**. Railway
   automatically exposes `DATABASE_URL` to your service.
4. **Set the variables** (service → **Variables** tab). Copy from `.env.example`:
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD`
   - `REGISTRATION_URL`
   - `META_PIXEL_ID`, `META_CAPI_TOKEN` (optional)
   - `ADMIN_TOKEN` (any long random string — protects the CSV export)
   - Leave `PGSSL` blank.
5. Railway runs `npm install` then `npm start` automatically. Once it's live, open
   the generated URL (Settings → **Generate Domain**), or attach a custom domain.

The `leads` table is created automatically on first boot.

---

## Test it end-to-end

1. Open the live URL on your phone.
2. Submit the form with a real email you can check.
3. Confirm: (a) you see the thank-you state, (b) you're redirected to SportsEngine,
   (c) the confirmation email arrives, (d) in Meta Events Manager → Test Events the
   `Lead` event shows up.
4. Check the lead landed in the DB via the CSV export below.

---

## Get leads out (for SportsEngine import)

Download all leads as CSV:

```
https://YOUR-DOMAIN/api/leads.csv?token=YOUR_ADMIN_TOKEN
```

Open in Excel/Sheets, map the columns to SportsEngine's **Member Import Template**,
and upload in SportsEngine HQ. (Not everyone who registers interest will join, so
this manual review step is intentional.)

Columns exported: `created_at, parent_name, email, phone, age_groups`.

---

## Run locally (optional)

```bash
npm install
cp .env.example .env   # fill in values; point DATABASE_URL at a local/remote Postgres
npm start              # http://localhost:3000
```

## Where things live
- `public/index.html` — the page. The server injects `META_PIXEL_ID` and
  `REGISTRATION_URL` at request time, so you never hardcode them here.
- `server.js` — page serving, `/api/lead`, email, CAPI, `/api/leads.csv`.
