// netlify/functions/notify.js
// Sends an email when a receipt is uploaded ("tell the others") or when an
// assignee marks a bill as complete. Uses Resend (https://resend.com).
//
// The caller is checked with the Home project's PUBLISHABLE key, not a
// service key: `auth.getUser(token)` asks Supabase whether the bearer token
// is a live session, and that needs no privilege at all. The old version
// held the splitter project's service role key for the same one question,
// which is a master key kept for a job a door key does. Since the move to
// the suite there is no service key on this site anywhere.
//
// It also asks, as the caller, whether they are on the list for Bills —
// being signed in to the suite is not the same as being allowed in here.
//
// Required Netlify environment variables:
//   PLANS_SUPABASE_URL, PLANS_SUPABASE_ANON_KEY — the Home project (shared with Plans)
//   RESEND_API_KEY  — from your Resend dashboard
//   SITE_URL        — this site's URL

const { createClient } = require('@supabase/supabase-js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const getCallerUser = async (supabase, event) => {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
};

const FROM_ADDRESS = 'Bill Splitter <onboarding@resend.dev>';

async function sendEmail(resendKey, payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + resendKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Resend error:', text);
    return { ok: false, error: text };
  }
  return { ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth  = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const supabase = createClient(
    process.env.PLANS_SUPABASE_URL,
    process.env.PLANS_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: token ? { Authorization: 'Bearer ' + token } : {} },
    }
  );

  const caller = await getCallerUser(supabase, event);
  if (!caller) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: member, error: memberErr } = await supabase.rpc('bills_is_member');
  if (memberErr) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: memberErr.message }) };
  if (member !== true) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Not on the list for Bills' }) };

  const body = JSON.parse(event.body || '{}');
  const kind = body.kind || 'complete';   // 'complete' (default, legacy) | 'newReceipt'

  // Skip silently if Resend is not configured
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, skipped: 'RESEND_API_KEY not set' }) };
  }

  const siteUrl = process.env.SITE_URL || 'https://your-app.netlify.app';

  // ── newReceipt mode ─ notify selected recipients that a fresh receipt is up
  if (kind === 'newReceipt') {
    const { recipients, receiptDate, total, itemCount } = body;
    const uploadedBy = body.uploadedBy || caller.email;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'recipients[] is required' }) };
    }

    const cleanRecipients = [...new Set(
      recipients.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean)
    )];
    if (cleanRecipients.length === 0) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'recipients[] contained no valid emails' }) };
    }

    const label = receiptDate || 'a new';
    const totalLine = typeof total === 'number'
      ? '<p style="margin:6px 0;color:#374151"><strong>Total:</strong> £' + total.toFixed(2) + (itemCount ? ' across ' + itemCount + ' items' : '') + '</p>'
      : '';

    const subject = '🧾 New ' + (receiptDate ? receiptDate + ' ' : '') + "Sainsbury's receipt ready to split";
    const html = [
      '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">',
      '<h2 style="color:#1e40af;margin:0 0 12px">🧾 New receipt available</h2>',
      '<p><strong>' + uploadedBy + '</strong> has uploaded a new <strong>' + label + '</strong> Sainsbury\'s receipt. It\'s ready for you to review and assign items.</p>',
      totalLine,
      '<p><a href="' + siteUrl + '" style="display:inline-block;padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:8px;font-weight:bold;margin-top:8px">Open Bill Splitter →</a></p>',
      '<p style="color:#9ca3af;font-size:12px;margin-top:20px">Sainsbury\'s Bill Splitter</p>',
      '</div>',
    ].join('');

    const results = await Promise.all(cleanRecipients.map((to) =>
      sendEmail(resendKey, { from: FROM_ADDRESS, to: [to], subject, html })
    ));
    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;

    if (sent === 0) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Email send failed', failed }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, sent, failed }) };
  }

  // ── default: assignment-complete notification (legacy behaviour) ─────
  const { completedBy, receiptDate, assignedBy } = body;

  if (!completedBy || !assignedBy) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'completedBy and assignedBy are required' }) };
  }

  const completedByName = completedBy.split('@')[0];
  const label = receiptDate || 'a recent receipt';

  const result = await sendEmail(resendKey, {
    from: FROM_ADDRESS,
    to: [assignedBy],
    subject: '✅ ' + completedByName + ' has finished assigning the ' + label + ' receipt',
    html: [
      '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">',
      '<h2 style="color:#065f46">✅ Assignment complete</h2>',
      '<p><strong>' + completedBy + '</strong> has finished assigning items on your <strong>' + label + '</strong> Sainsbury\'s receipt.</p>',
      '<p><a href="' + siteUrl + '" style="display:inline-block;padding:12px 24px;background:#667eea;color:white;text-decoration:none;border-radius:8px;font-weight:bold">View receipt →</a></p>',
      '<p style="color:#9ca3af;font-size:12px">Sainsbury\'s Bill Splitter</p>',
      '</div>',
    ].join(''),
  });

  if (!result.ok) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Email send failed' }) };
  }
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
