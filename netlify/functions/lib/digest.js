// netlify/functions/lib/digest.js
//
// Builds the reminder notification from the raw ledger rows. Pure functions
// with no I/O, so the wording and the arithmetic can be tested directly.
//
// Not a function endpoint: it lives in a subdirectory that doesn't match a
// filename, so Netlify won't register it as one.

const toPence  = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const toPounds = (p) => (p || 0) / 100;

const GBP = new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const fmtP = (p) => GBP.format(toPounds(p));

/** Today's date in Europe/London as YYYY-MM-DD — the ledger's dates are UK
 *  wall-clock dates, so a UTC "today" would be wrong for an hour each night
 *  during BST. */
function londonToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Current hour (0-23) in Europe/London. Compared against the user's
 *  preferred send hour so the reminder keeps the same wall-clock time either
 *  side of the BST/GMT switch, which a UTC cron alone cannot do. */
function londonHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: 'numeric', hour12: false,
  }).format(now));
}

/**
 * Work out what is worth telling someone about today.
 *
 * `data` is the raw tables: { bills, people, shares, instalments, paymentsIn,
 * paymentsOut }. Mirrors the arithmetic in plans.html exactly — payments are
 * never matched to instalments, so a position is always the difference
 * between two running totals.
 */
function buildDigest(data, prefs = {}, today = londonToday()) {
  const {
    bills = [], people = [], shares = [],
    instalments = [], paymentsIn = [], paymentsOut = [],
  } = data;

  const peopleById = Object.fromEntries(people.map(p => [p.id, p]));
  const billById   = Object.fromEntries(bills.map(b => [b.id, b]));
  const live       = new Set(bills.filter(b => b.status === 'active').map(b => b.id));

  const dueToday = [];   // { name, billTitle, amountP }
  const overdue  = [];   // { name, billTitle, amountP }

  shares.forEach((s) => {
    if (!live.has(s.bill_id)) return;
    const person = peopleById[s.person_id];
    // The ledger owner's own share is not a receivable and never lands on a
    // schedule, so there is nothing to chase.
    if (!person || person.is_me) return;

    const owedP = toPence(s.amount_owed);
    const mine  = instalments.filter(i => i.bill_id === s.bill_id && i.person_id === s.person_id && !i.waived);
    const paidP = paymentsIn
      .filter(p => p.bill_id === s.bill_id && p.person_id === s.person_id)
      .reduce((a, p) => a + toPence(p.amount), 0);

    const todayP = mine.filter(i => i.due_date === today)
                       .reduce((a, i) => a + toPence(i.amount), 0);

    // Arrears as of YESTERDAY. Something falling due today is not late, and
    // reporting it as overdue on the morning it lands would be wrong.
    const dueBeforeP = Math.min(owedP, mine.filter(i => i.due_date < today)
                                           .reduce((a, i) => a + toPence(i.amount), 0));
    const behindP = Math.max(0, dueBeforeP - paidP);

    const title = billById[s.bill_id]?.title || 'a bill';

    // Someone who has already paid ahead is not chased for today's instalment.
    const dueThroughTodayP = Math.min(owedP, dueBeforeP + todayP);
    if (todayP > 0 && paidP < dueThroughTodayP) {
      dueToday.push({ name: person.name, billTitle: title, amountP: Math.min(todayP, dueThroughTodayP - paidP) });
    }
    if (behindP > 0) overdue.push({ name: person.name, billTitle: title, amountP: behindP });
  });

  // Outgoings I committed to but haven't made, now due.
  const payoutsDue = paymentsOut
    .filter(p => p.scheduled && p.paid_on <= today && live.has(p.bill_id))
    .map(p => ({
      payee: p.payee || billById[p.bill_id]?.vendor || billById[p.bill_id]?.title || 'a payment',
      amountP: toPence(p.amount),
      overdue: p.paid_on < today,
    }));

  const wantDue     = prefs.notify_due     !== false;
  const wantOverdue = prefs.notify_overdue !== false;
  const wantPayouts = prefs.notify_payouts !== false;

  const useDue     = wantDue     ? dueToday   : [];
  const useOverdue = wantOverdue ? overdue    : [];
  const usePayouts = wantPayouts ? payoutsDue : [];

  if (!useDue.length && !useOverdue.length && !usePayouts.length) return null;

  const dueTotalP     = useDue.reduce((a, r) => a + r.amountP, 0);
  const overdueTotalP = useOverdue.reduce((a, r) => a + r.amountP, 0);
  const payoutTotalP  = usePayouts.reduce((a, r) => a + r.amountP, 0);

  // Title leads with whichever number actually needs attention.
  let title;
  if (useDue.length)          title = `${fmtP(dueTotalP)} due in today`;
  else if (useOverdue.length) title = `${fmtP(overdueTotalP)} overdue`;
  else                        title = `${fmtP(payoutTotalP)} to pay out`;

  const names = (rows) => {
    const byName = {};
    rows.forEach(r => { byName[r.name] = (byName[r.name] || 0) + r.amountP; });
    return Object.entries(byName)
      .sort((a, b) => b[1] - a[1])
      .map(([n, p]) => `${n} ${fmtP(p)}`)
      .join(' · ');
  };

  const lines = [];
  if (useDue.length)     lines.push(names(useDue));
  if (useOverdue.length) lines.push(`Behind: ${names(useOverdue)}`);
  if (usePayouts.length) {
    const late = usePayouts.some(p => p.overdue);
    lines.push(`You owe ${fmtP(payoutTotalP)} to ${usePayouts.map(p => p.payee).join(', ')}${late ? ' (overdue)' : ''}`);
  }

  return {
    title,
    body: lines.join('\n').slice(0, 400),
    tag: 'pp-digest',
    url: '/plans',
    counts: { due: useDue.length, overdue: useOverdue.length, payouts: usePayouts.length },
    totals: { dueP: dueTotalP, overdueP: overdueTotalP, payoutP: payoutTotalP },
  };
}

module.exports = { buildDigest, londonToday, londonHour, toPence, toPounds, fmtP };
