// netlify/functions/lib/push.js
// Shared web-push delivery, used by both the manual send and the scheduled
// reminder so the subscription-pruning rules can't drift between them.

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

/**
 * Push one payload to many subscriptions, pruning as it goes.
 *
 * 404/410 from the push service is definitive — the browser has discarded
 * the subscription and it will never work again — so the row is deleted.
 * Any other failure might be a transient outage at Apple or Google, so the
 * row survives and only fail_count moves. Losing someone's device because a
 * push service had a bad minute would be worse than keeping a stale row.
 */
async function deliver(sb, subs, payload) {
  configure();
  const body = JSON.stringify(payload);

  const settled = await Promise.allSettled((subs || []).map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, body, { TTL: 12 * 60 * 60 });
      await sb.from('pp_push_subscriptions')
        .update({ last_used_at: new Date().toISOString(), fail_count: 0, last_error: null })
        .eq('id', s.id);
      return { id: s.id, ok: true };
    } catch (err) {
      const status = err.statusCode || 0;
      if (status === 404 || status === 410) {
        await sb.from('pp_push_subscriptions').delete().eq('id', s.id);
        return { id: s.id, ok: false, gone: true };
      }
      await sb.from('pp_push_subscriptions')
        .update({
          fail_count: (s.fail_count || 0) + 1,
          last_error: String(err.message || err).slice(0, 300),
        })
        .eq('id', s.id);
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

module.exports = { deliver, configure };
