// netlify/functions/plans-reminders.js
// Scheduled: runs hourly, sends at most one reminder per person per day.
//
// Why hourly rather than a single daily cron: Netlify's scheduler is UTC
// only, so a fixed daily cron would drift an hour twice a year against UK
// wall-clock time. Running hourly and comparing against Europe/London keeps
// the reminder at 08:00 whether it's BST or GMT, and makes the send hour a
// user preference rather than a deploy.
//
// This is the one place that genuinely needs the service key: it runs with
// no user session, so RLS has no JWT to gate on. Everything else in the app
// goes through the caller's own token.
//
// Required Netlify environment variables:
//   PLANS_SUPABASE_URL, PLANS_SUPABASE_SERVICE_KEY
//   PLANS_VAPID_PUBLIC, PLANS_VAPID_PRIVATE, PLANS_VAPID_SUBJECT

const { createClient } = require('@supabase/supabase-js');
const { deliver } = require('./lib/push');
const { buildDigest, londonToday, londonHour } = require('./lib/digest');

exports.handler = async () => {
  const { PLANS_SUPABASE_URL, PLANS_SUPABASE_SERVICE_KEY } = process.env;

  if (!PLANS_SUPABASE_URL || !PLANS_SUPABASE_SERVICE_KEY) {
    // Not an error worth failing the schedule over — the app works fine
    // without automatic reminders, and this makes the reason visible.
    console.log('plans-reminders: PLANS_SUPABASE_SERVICE_KEY not set — skipping.');
    return { statusCode: 200, body: JSON.stringify({ skipped: 'no service key' }) };
  }

  const sb = createClient(PLANS_SUPABASE_URL, PLANS_SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const today = londonToday();
  const hour  = londonHour();

  const { data: prefsRows, error: prefsErr } = await sb.from('pp_reminder_prefs').select('*');
  if (prefsErr) {
    console.error('plans-reminders: could not read prefs —', prefsErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: prefsErr.message }) };
  }

  const due = (prefsRows || []).filter(p => p.daily_digest && Number(p.send_hour) === hour);
  if (!due.length) {
    return { statusCode: 200, body: JSON.stringify({ hour, today, sent: 0, reason: 'no one scheduled this hour' }) };
  }

  // Read the ledger once, not per recipient.
  const [bills, people, shares, instalments, paymentsIn, paymentsOut, subs] = await Promise.all([
    sb.from('pp_bills').select('*'),
    sb.from('pp_people').select('*'),
    sb.from('pp_shares').select('*'),
    sb.from('pp_instalments').select('*'),
    sb.from('pp_payments_in').select('*'),
    sb.from('pp_payments_out').select('*'),
    sb.from('pp_push_subscriptions').select('*'),
  ]);

  const readErr = [bills, people, shares, instalments, paymentsIn, paymentsOut, subs].find(r => r.error);
  if (readErr) {
    console.error('plans-reminders: read failed —', readErr.error.message);
    return { statusCode: 500, body: JSON.stringify({ error: readErr.error.message }) };
  }

  const ledger = {
    bills: bills.data, people: people.data, shares: shares.data,
    instalments: instalments.data, paymentsIn: paymentsIn.data, paymentsOut: paymentsOut.data,
  };

  const report = [];

  for (const prefs of due) {
    const payload = buildDigest(ledger, prefs, today);
    if (!payload) { report.push({ email: prefs.email, skipped: 'nothing to report' }); continue; }

    // Claim the day BEFORE sending. The unique constraint is the lock: a
    // retry, an overlapping run or a redeploy mid-flight all lose the race
    // and send nothing, which is the right way round — a missed reminder is
    // recoverable, a duplicate at 8am is just annoying.
    const dedupeKey = `digest:${prefs.email}:${today}`;
    const { error: claimErr } = await sb.from('pp_reminders_sent').insert({
      dedupe_key: dedupeKey, email: prefs.email, title: payload.title, body: payload.body,
    });
    if (claimErr) {
      report.push({ email: prefs.email, skipped: 'already sent today' });
      continue;
    }

    // Every device belongs to the one owner in this app, so there is no
    // per-recipient filtering to do.
    const targets = (subs.data || []);
    if (!targets.length) { report.push({ email: prefs.email, skipped: 'no devices' }); continue; }

    try {
      const result = await deliver(sb, targets, payload);
      report.push({ email: prefs.email, ...result, title: payload.title });
    } catch (err) {
      console.error('plans-reminders: send failed —', err.message);
      // Release the claim so the next hourly run can retry rather than the
      // day being silently burned by a transient VAPID/config failure.
      await sb.from('pp_reminders_sent').delete().eq('dedupe_key', dedupeKey);
      report.push({ email: prefs.email, error: String(err.message || err) });
    }
  }

  console.log('plans-reminders:', JSON.stringify({ today, hour, report }));
  return { statusCode: 200, body: JSON.stringify({ today, hour, report }) };
};
