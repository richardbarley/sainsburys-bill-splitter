// netlify/functions/notify.js
// Sends an email notification when an assignee marks a bill as complete.
// Uses Resend (https://resend.com) — free tier covers this easily.
//
// Required Netlify environment variables:
//   RESEND_API_KEY  — from your Resend dashboard
//   SITE_URL        — your Netlify URL (e.g. https://yourapp.netlify.app)

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const caller = await getCallerUser(supabase, event);
  if (!caller) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { completedBy, receiptDate, billId, assignedBy } = JSON.parse(event.body || '{}');

  if (!completedBy || !assignedBy) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'completedBy and assignedBy are required' }) };
  }

  // Skip silently if Resend is not configured
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, skipped: 'RESEND_API_KEY not set' }) };
  }

  const siteUrl = process.env.SITE_URL || 'https://your-app.netlify.app';
  const completedByName = completedBy.split('@')[0];
  const label = receiptDate || 'a recent receipt';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + resendKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Bill Splitter <onboarding@resend.dev>',
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
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Resend error:', text);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Email send failed' }) };
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};
