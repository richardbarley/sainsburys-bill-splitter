// netlify/functions/plans-push-send.js
// Sends a web push to the signed-in owner's registered devices.
//
// Deliberately uses the caller's own JWT with the anon key rather than the
// service key: reading the ledger and pruning pp_push_subscriptions is
// exactly what RLS already lets a member do, so no elevated credential is
// needed. Only the VAPID private key lives server-side, because it must.
//
// This is also how the real daily reminder can be tested on demand, before
// (or without) the scheduled job being configured.
//
// Modes (POST body):
//   { test: true }    — a fixed "push is working" notification
//   { digest: true }  — today's actual reminder; reports back if there is
//                       nothing worth sending rather than sending noise
//
// Required Netlify environment variables:
//   PLANS_SUPABASE_URL, PLANS_SUPABASE_ANON_KEY
//   PLANS_VAPID_PUBLIC, PLANS_VAPID_PRIVATE, PLANS_VAPID_SUBJECT

const { createClient } = require('@supabase/supabase-js');
const { deliver } = require('./lib/push');
const { buildDigest, londonToday } = require('./lib/digest');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const ok   = (b)      => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const fail = (s, msg) => ({ statusCode: s,   headers: CORS, body: JSON.stringify({ error: msg }) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return fail(405, 'Method not allowed');

  const { PLANS_SUPABASE_URL, PLANS_SUPABASE_ANON_KEY } = process.env;
  if (!PLANS_SUPABASE_URL || !PLANS_SUPABASE_ANON_KEY) return fail(500, 'Server misconfigured');

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail(401, 'Missing Authorization header');

  // The caller's token is passed through on every query, so RLS applies
  // exactly as it does in the browser.
  const sb = createClient(PLANS_SUPABASE_URL, PLANS_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return fail(401, 'Invalid or expired token');

  const { data: members, error: memberErr } = await sb.from('pp_members').select('email');
  if (memberErr) return fail(500, memberErr.message);
  if (!members || !members.length) return fail(403, 'Not a member of this ledger');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return fail(400, 'Bad JSON'); }

  const { data: subs, error: subErr } = await sb.from('pp_push_subscriptions').select('*');
  if (subErr) return fail(500, subErr.message);
  if (!subs || !subs.length) {
    return ok({ sent: 0, removed: 0, message: 'No devices are registered for notifications yet.' });
  }

  let payload;

  if (body.digest) {
    const [bills, people, shares, instalments, paymentsIn, paymentsOut, prefs] = await Promise.all([
      sb.from('pp_bills').select('*'),
      sb.from('pp_people').select('*'),
      sb.from('pp_shares').select('*'),
      sb.from('pp_instalments').select('*'),
      sb.from('pp_payments_in').select('*'),
      sb.from('pp_payments_out').select('*'),
      sb.from('pp_reminder_prefs').select('*').eq('email', user.email).maybeSingle(),
    ]);
    const firstErr = [bills, people, shares, instalments, paymentsIn, paymentsOut].find(r => r.error);
    if (firstErr) return fail(500, firstErr.error.message);

    payload = buildDigest({
      bills: bills.data, people: people.data, shares: shares.data,
      instalments: instalments.data, paymentsIn: paymentsIn.data, paymentsOut: paymentsOut.data,
    }, prefs.data || {}, londonToday());

    if (!payload) {
      return ok({
        sent: 0, removed: 0, empty: true,
        message: 'Nothing due, overdue or to pay out today — so no reminder would be sent.',
      });
    }
  } else {
    payload = {
      title: (body.title || 'Payment Plans').slice(0, 120),
      body:  (body.body  || 'Push notifications are working.').slice(0, 400),
      url:   body.url || '/plans',
      tag:   body.tag || 'pp-test',
    };
  }

  try {
    const result = await deliver(sb, subs, payload);
    return ok({ ...result, payload });
  } catch (err) {
    return fail(500, String(err.message || err));
  }
};
