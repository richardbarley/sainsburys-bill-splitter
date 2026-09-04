// netlify/functions/lib/push.js
// Shared web-push delivery, used by both the manual send and the scheduled
// reminder so the subscription-pruning rules can't drift between them.
//
// The two callers reach the database differently — the manual send with the
// caller's own JWT through supabase-js, the scheduled reminder as the
// `pp_reminders` Postgres role through the pooler — so delivery takes a small
// `store` with the three writes it makes, and each caller supplies one.

const webpush = require('web-push');

function configure() {
  const { PLANS_VAPID_PUBLIC, PLANS_VAPID_PRIVATE, PLANS_VAPID_SUBJECT } = process.env;
  if (!PLANS_VAPID_PUBLIC || !PLANS_VAPID_PRIVATE) {
    throw new Error('VAPID keys not set (PLANS_VAPID_PUBLIC / PLANS_VAPID_PRIVATE)');
  }
  webpush.setVapidDetails(
    PLANS_VAPID_SUBJECT || 'mailto:noreply@barleybils.netlify.app',
    PLANS_VAPID_PUBLIC,
    PLANS_VAPID_PRIVATE
  );
}

/** The three writes delivery makes, over a supabase-js client. */
function supabaseStore(sb) {
  return {
    markSent: (id) => sb.from('pp_push_subscriptions')
      .update({ last_used_at: new Date().toISOString(), fail_count: 0, last_error: null })
      .eq('id', id),
    remove: (id) => sb.from('pp_push_subscriptions').delete().eq('id', id),
    markFailed: (id, failCount, error) => sb.from('pp_push_subscriptions')
      .update({ fail_count: failCount, last_error: error })
      .eq('id', id),
  };
}

/** The same three writes, over a node-postgres client. */
function sqlStore(db) {
  return {
    markSent: (id) => db.query(
      'update pp_push_subscriptions set last_used_at = now(), fail_count = 0, last_error = null where id = $1', [id]),
    remove: (id) => db.query('delete from pp_push_subscriptions where id = $1', [id]),
    markFailed: (id, failCount, error) => db.query(
      'update pp_push_subscriptions set fail_count = $2, last_error = $3 where id = $1', [id, failCount, error]),
  };
}

/**
 * Push one payload to many subscriptions, pruning as it goes.
 *
 * 404/410 from the push service is definitive — the browser has discarded
 * the subscription and it will never work again — so the row is deleted.
 * Any other failure might be a transient outage at Apple or Google, so the
 * row survives and only fail_count moves. Losing someone's device because a
 * push service had a bad minute would be worse than keeping a stale row.
 */
async function deliver(store, subs, payload) {
  configure();
  const body = JSON.stringify(payload);

  const settled = await Promise.allSettled((subs || []).map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, body, { TTL: 12 * 60 * 60 });
      await store.markSent(s.id);
      return { id: s.id, ok: true };
    } catch (err) {
      const status = err.statusCode || 0;
      if (status === 404 || status === 410) {
        await store.remove(s.id);
        return { id: s.id, ok: false, gone: true };
      }
      await store.markFailed(s.id, (s.fail_count || 0) + 1, String(err.message || err).slice(0, 300));
      return { id: s.id, ok: false, status, error: String(err.message || err).slice(0, 200) };
    }
  }));

  const rows = settled.map(r => r.status === 'fulfilled'
    ? r.value
    : { ok: false, error: String(r.reason).slice(0, 200) });

  return {
    attempted: rows.length,
    sent:      rows.filter(r => r.ok).length,
    removed:   rows.filter(r => r.gone).length,
    failed:    rows.filter(r => !r.ok && !r.gone),
  };
}

module.exports = { deliver, configure, supabaseStore, sqlStore };
