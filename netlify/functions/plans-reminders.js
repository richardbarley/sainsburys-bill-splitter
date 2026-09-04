// netlify/functions/plans-reminders.js
// Scheduled: runs hourly, sends at most one reminder per person per day.
//
// Why hourly rather than a single daily cron: Netlify's scheduler is UTC
// only, so a fixed daily cron would drift an hour twice a year against UK
// wall-clock time. Running hourly and comparing against Europe/London keeps
// the reminder at 08:00 whether it's BST or GMT, and makes the send hour a
// user preference rather than a deploy.
//
// It runs with no user session, so RLS has no JWT to gate on. It used to hold
// the project's service key for that reason — which ignores RLS on everything
// in the project, and the project is also the house and the door code. It now
// connects as `pp_reminders`, a Postgres role whose grants are exactly the
// reads and the three writes below (see payment-plans-reminders-role.sql).
//
// Required Netlify environment variables:
//   PLANS_REMINDERS_DATABASE_URL
//       postgresql://pp_reminders.<project ref>:<password>@<pooler host>:6543/postgres
//       The transaction-pooler string from the dashboard's Connect dialog with
//       the user swapped for `pp_reminders.<project ref>`.
//   SUPABASE_CA_CERT
//       Supabase's root certificate as PEM text, pasted whole: Project Settings
//       → Database → SSL Configuration → Download certificate, open the file,
//       copy from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.
//       The pooler's certificate is signed by Supabase's own root rather than a
//       public one, so without this Node refuses the connection with
//       "self-signed certificate in certificate chain".
//   PLANS_VAPID_PUBLIC, PLANS_VAPID_PRIVATE, PLANS_VAPID_SUBJECT
//
// PLANS_SUPABASE_SERVICE_KEY is no longer read. Remove it.

const { Client } = require('pg');
const { deliver, sqlStore } = require('./lib/push');
const { buildDigest, londonToday, londonHour } = require('./lib/digest');

const all = async (db, table) => (await db.query(`select * from ${table}`)).rows;

exports.handler = async () => {
  const { PLANS_REMINDERS_DATABASE_URL } = process.env;
  // Netlify may store a pasted multi-line value with literal "\n" sequences.
  const CA = (process.env.SUPABASE_CA_CERT || '').replace(/\\n/g, '\n').trim();

  if (!PLANS_REMINDERS_DATABASE_URL) {
    // Not an error worth failing the schedule over — the app works fine
    // without automatic reminders, and this makes the reason visible.
    console.log('plans-reminders: PLANS_REMINDERS_DATABASE_URL not set — skipping.');
    return { statusCode: 200, body: JSON.stringify({ skipped: 'no database url' }) };
  }
  if (!CA) {
    // Loud, not skipped: the URL is set, so somebody meant this to run.
    console.error('plans-reminders: SUPABASE_CA_CERT not set — cannot verify the pooler, not connecting.');
    return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_CA_CERT not set' }) };
  }

  const today = londonToday();
  const hour  = londonHour();

  // The pooler's certificate chains to Supabase's own root, which Node does
  // not trust by default: the first run without this failed with
  // "self-signed certificate in certificate chain". Pinning that root keeps
  // verification on; turning it off would let anyone between Netlify and
  // Supabase read the role's password and the ledger.
  const db = new Client({ connectionString: PLANS_REMINDERS_DATABASE_URL, ssl: { ca: CA, rejectUnauthorized: true } });
  try {
    await db.connect();
  } catch (err) {
    console.error('plans-reminders: could not connect as pp_reminders —', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  try {
    const prefsRows = await all(db, 'pp_reminder_prefs');
    const due = prefsRows.filter(p => p.daily_digest && Number(p.send_hour) === hour);
    if (!due.length) {
      return { statusCode: 200, body: JSON.stringify({ hour, today, sent: 0, reason: 'no one scheduled this hour' }) };
    }

    // Read the ledger once, not per recipient.
    const [bills, people, shares, instalments, paymentsIn, paymentsOut, subs] = await Promise.all([
      all(db, 'pp_bills'), all(db, 'pp_people'), all(db, 'pp_shares'), all(db, 'pp_instalments'),
      all(db, 'pp_payments_in'), all(db, 'pp_payments_out'), all(db, 'pp_push_subscriptions'),
    ]);
    const ledger = { bills, people, shares, instalments, paymentsIn, paymentsOut };
    const store = sqlStore(db);

    const report = [];

    for (const prefs of due) {
      const payload = buildDigest(ledger, prefs, today);
      if (!payload) { report.push({ email: prefs.email, skipped: 'nothing to report' }); continue; }

      // Claim the day BEFORE sending. The unique constraint is the lock: a
      // retry, an overlapping run or a redeploy mid-flight all lose the race
      // and send nothing, which is the right way round — a missed reminder is
      // recoverable, a duplicate at 8am is just annoying.
      const dedupeKey = `digest:${prefs.email}:${today}`;
      try {
        await db.query(
          'insert into pp_reminders_sent (dedupe_key, email, title, body) values ($1, $2, $3, $4)',
          [dedupeKey, prefs.email, payload.title, payload.body]
        );
      } catch (claimErr) {
        report.push({ email: prefs.email, skipped: 'already sent today' });
        continue;
      }

      // Every device belongs to the one owner in this app, so there is no
      // per-recipient filtering to do.
      if (!subs.length) { report.push({ email: prefs.email, skipped: 'no devices' }); continue; }

      try {
        const result = await deliver(store, subs, payload);
        report.push({ email: prefs.email, ...result, title: payload.title });
      } catch (err) {
        console.error('plans-reminders: send failed —', err.message);
        // Release the claim so the next hourly run can retry rather than the
        // day being silently burned by a transient VAPID/config failure.
        await db.query('delete from pp_reminders_sent where dedupe_key = $1', [dedupeKey]);
        report.push({ email: prefs.email, error: String(err.message || err) });
      }
    }

    console.log('plans-reminders:', JSON.stringify({ today, hour, report }));
    return { statusCode: 200, body: JSON.stringify({ today, hour, report }) };
  } catch (err) {
    console.error('plans-reminders: failed —', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await db.end().catch(() => {});
  }
};
