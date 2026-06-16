/**
 * KeAloha Volleyball — lead handler (Google Apps Script Web App)
 * Logs every landing-page submission to this Google Sheet AND emails the
 * parent a confirmation from kealohavolleyball@gmail.com (over HTTPS, so it
 * works even though Railway blocks SMTP).
 *
 * ── HOW TO DEPLOY ───────────────────────────────────────────────
 * 1. Create a new Google Sheet (in the kealohavolleyball@gmail.com account).
 *    Name it e.g. "KeAloha Tryout Leads".
 * 2. In that sheet: Extensions → Apps Script.
 * 3. Delete any starter code, paste THIS entire file, and Save.
 * 4. Click Deploy → New deployment → (gear) Web app.
 *      - Description: KeAloha lead handler
 *      - Execute as:  Me (kealohavolleyball@gmail.com)
 *      - Who has access: Anyone
 *    Click Deploy, then Authorize access (approve the Gmail + Sheets prompts).
 * 5. Copy the "Web app" URL it shows (ends in /exec) and send it to me.
 *    I'll plug it into Railway and the form will start writing to this sheet
 *    and sending emails. (After that you can revoke the Gmail App Password.)
 * ────────────────────────────────────────────────────────────────
 */

// Must match LEAD_WEBHOOK_SECRET in Railway. (Already set for you.)
const SHARED_SECRET = '6e4d9634a2db7c6456df44f0cbddc5edf46ff5c9';
const SHEET_NAME = 'Leads';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    // 1) Append the submission to the sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(['Submitted', 'Parent / Guardian', 'Email', 'Phone', 'Age groups']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      new Date(),
      body.parentName || '',
      body.email || '',
      body.phone || '',
      body.ageGroups || ''
    ]);

    // 2) Send the confirmation email from this Gmail account
    if (body.email) {
      const first = (body.parentName || 'there').trim().split(/\s+/)[0] || 'there';
      const regUrl = body.registrationUrl || '';
      const subject = 'Complete your KeAloha Volleyball tryout registration';
      const html =
        '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0b2545;line-height:1.5">' +
          '<h2 style="color:#0b2545">Thanks for your interest, ' + escapeHtml_(first) + '!</h2>' +
          '<p>You’re one step away from KeAloha Volleyball tryouts. Tap below to complete your registration:</p>' +
          '<p style="text-align:center;margin:26px 0">' +
            '<a href="' + regUrl + '" style="background:#ff5a4d;color:#fff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:50px;display:inline-block">Complete Registration →</a>' +
          '</p>' +
          '<p style="font-size:14px;color:#0b2545;background:#fff3f2;border-left:4px solid #ff5a4d;padding:12px 14px;border-radius:8px"><strong>You are not finished registering yet.</strong> You must complete your registration in SportsEngine using the button above to reserve a tryout spot. If you show up without completing your SportsEngine registration, your spot is not guaranteed.</p>' +
          '<p style="font-size:14px;color:#0b2545"><strong>Registration fees:</strong> $40 for new players, $20 for returning players.</p>' +
          '<p style="font-size:13px;color:#5b6b82">Tryouts are held at the Chesterton &amp; Valparaiso Boys &amp; Girls Clubs, June–July 2026. Questions? Just reply to this email.</p>' +
          '<p style="font-size:13px;color:#5b6b82">See you on the court,<br>KeAloha Volleyball</p>' +
        '</div>';
      const plain = 'Thanks for your interest, ' + first + '!\n\n' +
        'Complete your KeAloha Volleyball tryout registration here:\n' + regUrl + '\n\n' +
        'IMPORTANT: You are not finished registering yet. You must complete your registration in SportsEngine (link above) to reserve a tryout spot. If you show up without completing your SportsEngine registration, your spot is not guaranteed.\n\n' +
        'Registration fees: $40 for new players, $20 for returning players.\n\n' +
        'Tryouts are at the Chesterton & Valparaiso Boys & Girls Clubs, June–July 2026.\n' +
        'Questions? Just reply to this email.\n\nSee you on the court,\nKeAloha Volleyball';
      GmailApp.sendEmail(body.email, subject, plain, { htmlBody: html, name: 'KeAloha Volleyball' });
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
