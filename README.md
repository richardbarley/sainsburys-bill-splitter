# Bill apps

Two separate apps deployed from this repo to the same Netlify site.

| App | URL | What it does |
|---|---|---|
| **Sainsbury's Bill Splitter** | `/` | Parses a Sainsbury's receipt PDF and splits the line items between household members |
| **Payment Plans** | `/plans` | Records a big bill (holiday, large purchase), splits it between people, puts them on a monthly plan, and tracks money in and out |

They share a design system and an auth approach but no data. See
[PAYMENT-PLANS.md](PAYMENT-PLANS.md) for the newer app, and
[SUGGESTIONS.md](SUGGESTIONS.md) for the splitter's assignment-suggestion engine.

---

## Sainsbury's Bill Splitter — `/`

### Features

- **PDF Receipt Parsing**: Automatically extracts all items from Sainsbury's receipt PDFs
- **Quick Assignment**: One-click buttons to assign items to groups
- **Custom Percentage Splits**: Fine-tune splits with adjustable percentages per person
- **Quantity-Based Splits**: Divide multi-item purchases by quantity
- **Smart Auto-Redistribution**: Automatically adjusts percentages to always total 100%
- **Assignment Indicators**: See how items were previously assigned when reviewing
- **Individual Breakdowns**: Shows exactly how much each person owes

### How to Use

1. Open the app and sign in
2. Upload your Sainsbury's receipt PDF (drag & drop or click to browse)
3. For each item, choose how to split amongst individuals

### Custom Splits

**Percentage split** — adjust each person's percentage with +/- or manual
input; the remainder distributes among un-adjusted people, always totalling
100%. Reset returns to an equal split.

**Quantity split** — for items with quantity > 1, allocate specific
quantities to groups; cost is calculated proportionally.

### Data

Its own Supabase project (`config` and `bill_history` tables — see
[supabase-schema.sql](supabase-schema.sql)), reached through the
`client-config`, `data`, `users` and `notify` Netlify functions using a
service key. That project is in a free Supabase org, so it pauses after a
period of inactivity.

---

## Payment Plans — `/plans`

Full write-up in **[PAYMENT-PLANS.md](PAYMENT-PLANS.md)**. In short: enter a
bill, split it between people (equally, by percentage or by fixed amounts),
generate a monthly repayment schedule, then record what comes in and what you
pay out. Screens for this month's position, per-person balances across every
bill, and month-by-month cashflow.

Installable to the Home Screen, with a daily push reminder of what's due —
on iPhone the two go together, since iOS only allows web push for apps added
to the Home Screen. Sign-in is passwordless — Supabase emails a six-digit
code — with password sign-in kept as a fallback. Data lives in the `pp_` tables of the "Home" Supabase project
([payment-plans-schema.sql](payment-plans-schema.sql)), protected by RLS so
the browser talks to Supabase directly. The only server-side piece is the
`plans-config` function.

---

## Technical

- Single HTML file per app — no build step
- React 18 + Babel standalone, loaded from CDN and pinned to exact versions
- PDF.js for receipt parsing (splitter only)
- Supabase for auth and storage
- Netlify for hosting and functions

### Netlify environment variables

| Variable | Used by |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Splitter — `client-config` |
| `SUPABASE_SERVICE_KEY` | Splitter — `data`, `users`, `notify` |
| `ADMIN_EMAIL` | Splitter — `users` |
| `RESEND_API_KEY`, `SITE_URL` | Splitter — `notify` |
| `PLANS_SUPABASE_URL`, `PLANS_SUPABASE_ANON_KEY` | Payment Plans — `plans-config`, `plans-push-send` |
| `PLANS_VAPID_PUBLIC`, `PLANS_VAPID_PRIVATE`, `PLANS_VAPID_SUBJECT` | Payment Plans — web push |
| `PLANS_SUPABASE_SERVICE_KEY` | Payment Plans — `plans-reminders` (the scheduled job only) |

### Browser support

Modern browsers (Chrome, Firefox, Safari, Edge). Both apps are built
mobile-first at a 480px shell and follow the system light/dark setting, with
a manual override.
