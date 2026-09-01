# Payment Plans

A second app in this repo, at **`/plans`**. Enter a big bill — a holiday, a
large purchase — split it between people, put each person on a monthly
payment plan, and track both directions of cash: what comes in from them,
and what you pay out to clear the bill.

The Sainsbury's receipt splitter is untouched and still lives at `/`.

## Why it's a separate app, not a mode of the splitter

They look similar and share almost no logic. The splitter's loop is
*parse a receipt → assign line items → settle once*. This one is
*record one bill → schedule it over months → track a running balance*.
Forcing them together would compromise both.

What **is** reused, by copying rather than by abstraction: the whole design
system (tokens, dark mode, the 480px mobile shell, chips, badges, sheets,
toasts, empty states), the person colour palette, and the Supabase auth
approach.

## Where the data lives

The `pp_` tables sit in the **"Home" Supabase project**, not the splitter's.
The splitter's project is in a free org, so it pauses after a period of
inactivity; Home is in the Pro org and never does. Sharing a project between
apps under a table prefix is the existing pattern here (`home_`, `trip_`,
`mp_`, `mtg_`).

Consequences worth knowing:

- **Different auth pool from the splitter.** Signing in to one does not sign
  you in to the other. It *does* share a login with the Home app.
- **No service-key proxy.** Every `pp_` table has RLS gating on
  `pp_is_member()` / `pp_is_owner()`, which read the caller's verified JWT
  email, so the browser talks to Supabase directly. The only Netlify function
  is `plans-config.js`, which hands out the project URL and publishable key
  from `PLANS_SUPABASE_URL` / `PLANS_SUPABASE_ANON_KEY`.
### Signing in

Passwordless by default: type your email, Supabase sends a message, you enter
the six-digit code. There is one user, so a password was only ever friction
and one more thing to lose. Password sign-in is still there as a fallback
behind "Use a password instead".

`signInWithOtp` is called with `shouldCreateUser: false` — a stranger typing
their address must not silently mint an account, even though RLS would give
it nothing.

Two bits of Supabase config this depends on:

- **Authentication → Emails → Magic Link** must include `{{ .Token }}` in the
  template, or the email contains only a link and there is no code to type.
- **Authentication → URL Configuration → Redirect URLs** must list
  `https://barleybils.netlify.app/plans` for the link half to work.

The page sets `detectSessionInUrl`, so if the template hasn't been changed and
the email carries only a link, clicking it still signs you in — the session
arrives in the URL fragment and is picked up and scrubbed. Either half of the
email works.

Supabase returns one error message, `Token has expired or is invalid`, for
both a mistyped code and a stale one. The UI doesn't guess between them:
telling someone their code "expired" when they simply fat-fingered a digit
sends them off to request a replacement they don't need.

### Access

- Access is granted by adding an address to `pp_members`. A signed-in
  non-member gets an explicit "no access" screen rather than a
  confusingly-empty app.
- Defence in depth: `anon` holds no table grants at all on the `pp_` tables,
  so an unauthenticated caller is refused before RLS is even consulted.
  `pp_is_member()` / `pp_is_owner()` have EXECUTE revoked from `PUBLIC`
  (not merely from `anon` — functions grant EXECUTE to `PUBLIC` by default
  and `anon` inherits it, so revoking from `anon` alone does nothing).
  `authenticated` keeps both the table grants and EXECUTE, because RLS needs
  them; the policies are what narrow it to members and the owner.

## The one decision everything else follows from

**Payments are never matched to a specific instalment.**

`pp_instalments` says what *should* have arrived by a given date.
`pp_payments_in` records what *actually* arrived. A person's position is the
difference between the two running totals:

```
outstanding = owed − paid
due to date = Σ instalments due on/before today, not waived, capped at owed
arrears     = max(0, due to date − paid)
```

That is the whole model, and it is what makes every awkward real-world case
work with no reconciliation UI at all:

| What happens | Why it just works |
|---|---|
| Someone pays three months at once | Their paid total already exceeds what's due; no arrears appear for months |
| Someone pays a round £150 instead of £166.67 | The shortfall is simply the difference; nothing is "unmatched" |
| A month is agreed off | Waive that instalment — it leaves what's expected, but what they owe overall doesn't change |
| The bill total changes | Rebuild the schedule; payments already made still count in full |
| The schedule outlives the debt | Due-to-date is capped at what's owed, so an over-long plan can't invent arrears |

## Money handling

Everything is integer pence internally. Pounds appear only when parsing input
and formatting output, so no total is ever a sum of floats. (`8.20 * 100` is
`819.9999999999999` in IEEE 754 — that class of bug is designed out rather
than rounded away.)

Two different splitting rules, deliberately:

- **Between people** — largest-remainder (`allocate`). Each share gets its
  floor, then the leftover pennies go to whoever had the largest fractional
  part. Always sums exactly; the odd penny lands on whoever was closest to
  earning it rather than always on the same person. £1,000 three ways is
  `£333.34 / £333.33 / £333.33`.
- **Across months** — every month identical, the final one absorbing the
  remainder (`splitOverMonths`). Not largest-remainder, because a schedule is
  read by a human: `£142.85 × 6 then £142.90` is obviously intentional, where
  six months of `£142.86` and one of `£142.85` just looks like a bug.

Dates are held and manipulated as `YYYY-MM-DD` strings, never as `Date`
objects — BST would otherwise quietly shift a 1st-of-the-month into the 31st.
Due day is capped at 28 in the schema so no month is ever skipped.

## Splitting a bill

One mode selector decides what the per-person input box *means*, and a blank
box always means "an equal share of whatever is left":

- **Split equally** — everyone selected pays the same.
- **By percentage** — set a % for anyone; blanks split the remainder.
- **Set amounts** — set an exact amount for anyone; blanks split the remainder.

Resolution order is fixed amounts → percentages → equal shares on what's
left. That ordering is what makes *"Rosie owes exactly £300, the rest of us
split the remainder"* work with no special handling. Under- and
over-allocation are both surfaced rather than silently clamped.

## Your own share

One person can be flagged `is_me`. Their share still counts toward the bill
being fully allocated, but is never money you're owed and never goes on a
repayment schedule. So on a £4,000 holiday split four ways, you're owed
£3,000, not £4,000, and your net position after everyone pays is −£1,000 —
which is exactly what the holiday cost you.

## Money out

Recorded per bill, in whatever shape reality takes: paid in full upfront, in
card instalments, or ad hoc as each stage falls due. A payment can be marked
**committed but not yet made**, which keeps it out of "what has actually
left" while still showing in the forward cashflow.

## The screens

| Screen | Answers |
|---|---|
| **Bills** | What am I owed overall, and how far out of pocket am I right now? |
| **Bill detail** | Overview (who owes what), Schedule (what lands when), Money (every payment both ways) |
| **Month** | What should be in my account by the end of this month that isn't? |
| **Cashflow** | Month by month: in, out, running position. How deep does it get, and when am I back to even? |
| **People** | What does each person owe me across every bill? |

Cashflow reports actuals for past and present months and the plan for future
ones — mixing the two would double-count the month a payment was both
expected and received. "Back to even" is the month after the *last* time the
running position is negative, not the first time it pokes above zero: a
holiday balance falling due later in the year drags it back under, and
reporting the earlier crossing would promise a recovery that never happens.
